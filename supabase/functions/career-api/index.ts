import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!["GET", "POST"].includes(req.method)) return respond({ ok: false, error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return respond({ ok: false, error: "Server environment is not configured" }, 500);

  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return respond({ ok: false, error: "Authorization token is required" }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return respond({ ok: false, error: "Invalid or expired session" }, 401);
  const userId = authData.user.id;

  try {
    if (req.method === "GET") {
      const { data: coach, error: coachError } = await admin.from("coach_profiles").select("*").eq("owner_user_id", userId).maybeSingle();
      if (coachError) throw coachError;
      if (!coach) return respond({ ok: true, initialized: false, season: null, coach: null, team: null, roster: [] });
      const { data: team, error: teamError } = await admin.from("teams").select("*").eq("owner_user_id", userId).is("archived_at", null).maybeSingle();
      if (teamError) throw teamError;
      const { data: season, error: seasonError } = await admin.from("seasons").select("*").eq("season_number", 1).maybeSingle();
      if (seasonError) throw seasonError;
      let roster: unknown[] = [];
      if (team) {
        const { data: history, error: historyError } = await admin.from("player_team_history").select("player_id").eq("team_id", team.id).is("left_at", null);
        if (historyError) throw historyError;
        const ids = (history || []).map((x: { player_id: string }) => x.player_id);
        if (ids.length) {
          const { data: players, error: playersError } = await admin.from("players").select("*").in("id", ids);
          if (playersError) throw playersError;
          roster = players || [];
        }
      }
      const { data: stats, error: statsError } = await admin.from("coach_season_stats").select("*").eq("coach_id", coach.id).order("season_id");
      if (statsError) throw statsError;
      const { data: matches, error: matchesError } = await admin.from("matches").select("id,source_match_key,season_id,competition_name,home_team_id,away_team_id,home_score,away_score,finalized_at").eq("coach_id", coach.id).eq("is_official", true).eq("status", "finalized").order("finalized_at", { ascending: false }).limit(100);
      if (matchesError) throw matchesError;
      return respond({ ok: true, initialized: true, coach, team, season, roster, seasonStats: stats || [], officialMatches: matches || [] });
    }

    let payload: any;
    try { payload = await req.json(); } catch { return respond({ ok: false, error: "Request body must be JSON" }, 400); }

    if (payload?.action === "get-online-ratings") {
      const [xpResult, generalResult] = await Promise.all([
        admin.from("online_coach_ratings").select("coach_name,team_name,season_number,avatar_index,team_logo_index,awards,xp,general_rating,updated_at").order("xp", { ascending: false }).order("updated_at", { ascending: true }).limit(50),
        admin.from("online_coach_ratings").select("coach_name,team_name,season_number,avatar_index,team_logo_index,awards,xp,general_rating,updated_at").order("general_rating", { ascending: false }).order("updated_at", { ascending: true }).limit(50)
      ]);
      if (xpResult.error) throw xpResult.error;
      if (generalResult.error) throw generalResult.error;
      return respond({ ok: true, xpRatings: xpResult.data || [], generalRatings: generalResult.data || [] });
    }

    if (payload?.action === "submit-online-rating") {
      const ratingType = payload.ratingType === "xp" || payload.ratingType === "general" ? payload.ratingType : null;
      const coachName = String(payload.coachName || "").trim().slice(0, 40);
      const teamName = String(payload.teamName || "").trim().slice(0, 60);
      const seasonNumber = Number(payload.seasonNumber);
      const avatarIndex = Number(payload.avatarIndex);
      const teamLogoIndex = Number(payload.teamLogoIndex);
      const xp = payload.xp === undefined ? null : Number(payload.xp);
      const generalRating = payload.generalRating === undefined ? null : Number(payload.generalRating);
      const validScore = (value: number | null) => value === null || (Number.isSafeInteger(value) && value >= 0 && value <= 1000000000);
      if (!ratingType || !coachName || !teamName ||
          !Number.isSafeInteger(seasonNumber) || seasonNumber < 1 || seasonNumber > 10000 ||
          !Number.isInteger(avatarIndex) || avatarIndex < 1 || avatarIndex > 6 ||
          !Number.isInteger(teamLogoIndex) || teamLogoIndex < 1 || teamLogoIndex > 6 ||
          !validScore(xp) || !validScore(generalRating) ||
          (ratingType === "xp" && xp === null) || (ratingType === "general" && generalRating === null)) {
        return respond({ ok: false, error: "Некорректные данные рейтинга. Обнови игру и попробуй снова." }, 400);
      }
      const incomingAwards = Array.isArray(payload.awards) ? payload.awards.slice(0, 80) : [];
      const awards = incomingAwards.filter((item: any) =>
        item && typeof item.icon === "string" && /^[a-z0-9_-]{1,80}$/i.test(item.icon)
      ).map((item: any) => ({
        icon: item.icon,
        label: String(item.label || "Награда").slice(0, 100),
        caption: String(item.caption || "").slice(0, 120),
        season: Math.max(1, Math.min(10000, Math.floor(Number(item.season) || seasonNumber))),
        round: Math.max(0, Math.min(10000, Math.floor(Number(item.round) || 0)))
      }));
      const { data: existing, error: existingError } = await admin.from("online_coach_ratings")
        .select("xp,general_rating,xp_submitted_at,general_rating_submitted_at")
        .eq("owner_user_id", userId).maybeSingle();
      if (existingError) throw existingError;
      const now = new Date().toISOString();
      const row = {
        owner_user_id: userId,
        coach_name: coachName,
        team_name: teamName,
        season_number: seasonNumber,
        avatar_index: avatarIndex,
        team_logo_index: teamLogoIndex,
        awards,
        xp: ratingType === "xp" ? xp : Number(existing?.xp || 0),
        general_rating: ratingType === "general" ? generalRating : Number(existing?.general_rating || 0),
        xp_submitted_at: ratingType === "xp" ? now : (existing?.xp_submitted_at || null),
        general_rating_submitted_at: ratingType === "general" ? now : (existing?.general_rating_submitted_at || null),
        updated_at: now
      };
      const { error: saveError } = await admin.from("online_coach_ratings").upsert(row, { onConflict: "owner_user_id" });
      if (saveError) throw saveError;
      return respond({ ok: true, updated: true, ratingType, updatedAt: now });
    }

    if (payload?.action !== "bootstrap") return respond({ ok: false, error: "Unsupported action" }, 400);
    const coachName = String(payload.coachName || "").trim().slice(0, 40);
    const teamName = String(payload.teamName || "").trim().slice(0, 60);
    if (!coachName || !teamName) return respond({ ok: false, error: "Coach and team names are required" }, 400);
    if (!Array.isArray(payload.roster) || payload.roster.length !== 10) {
      return respond({ ok: false, error: "The initial roster must contain exactly 10 players" }, 400);
    }
    const inputRoster = payload.roster;
    const names = inputRoster.map((p: any) => String(p?.name || "").trim());
    if (names.some((name: string) => !name) || new Set(names.map((name: string) => name.toLocaleLowerCase())).size !== names.length) {
      return respond({ ok: false, error: "All 10 roster players must have unique, non-empty names" }, 400);
    }

    const { data: season, error: seasonError } = await admin.from("seasons").upsert({
      season_number: 1, name: "Сезон 1", status: "active"
    }, { onConflict: "season_number" }).select("*").single();
    if (seasonError) throw seasonError;

    const { data: existingCoach, error: existingCoachError } = await admin.from("coach_profiles").select("*").eq("owner_user_id", userId).maybeSingle();
    if (existingCoachError) throw existingCoachError;
    let coach = existingCoach;
    if (!coach) {
      const { data, error } = await admin.from("coach_profiles").insert({ owner_user_id: userId, display_name: coachName }).select("*").single();
      if (error) throw error;
      coach = data;
    } else if (coach.display_name !== coachName) {
      const { data, error } = await admin.from("coach_profiles").update({ display_name: coachName, updated_at: new Date().toISOString() }).eq("id", coach.id).select("*").single();
      if (error) throw error;
      coach = data;
    }

    const { data: existingTeam, error: existingTeamError } = await admin.from("teams").select("*").eq("owner_user_id", userId).is("archived_at", null).maybeSingle();
    if (existingTeamError) throw existingTeamError;
    let team = existingTeam;
    if (!team) {
      const { data, error } = await admin.from("teams").insert({ owner_user_id: userId, name: teamName }).select("*").single();
      if (error) throw error;
      team = data;
    } else if (team.name !== teamName) {
      const { data, error } = await admin.from("teams").update({ name: teamName }).eq("id", team.id).select("*").single();
      if (error) throw error;
      team = data;
    }

    const rosterIds: string[] = [];
    for (let i = 0; i < inputRoster.length; i++) {
      const p = inputRoster[i] || {};
      const suppliedKey = String(p.careerId || "").trim();
      // Scope the static league identity to this authenticated coach. One user's bootstrap
      // must never mutate another user's player record.
      const sourceKey = suppliedKey ? userId + ":" + suppliedKey : userId + ":starter:" + i;
      const name = String(p.name || "").trim().slice(0, 60);
      const position = ["ВР", "ЗЩ", "ПЗ", "НП"].includes(p.position) ? p.position : null;
      const incoming = p.skills && typeof p.skills === "object" && !Array.isArray(p.skills) ? p.skills : {};
      const skills: Record<string, number> = {};
      for (const key of ["ВР", "ЗЩ", "ПЗ", "НП"]) {
        const value = Number(incoming[key] ?? 0);
        if (!Number.isFinite(value) || value < 0 || value > 100) {
          return respond({ ok: false, error: "Player skills must be numbers from 0 to 100" }, 400);
        }
        skills[key] = Math.round(value);
      }
      let player: any = null;
      const { data: found, error: findError } = await admin.from("players").select("*").eq("source_player_key", sourceKey).maybeSingle();
      if (findError) throw findError;
      player = found;
      if (!player) {
        const { data, error } = await admin.from("players").insert({
          source_player_key: sourceKey, display_name: name, position,
          nationality: String(p.nationality || "").slice(0, 40) || null,
          skills, debut_season_id: season.id
        }).select("*").single();
        if (error) throw error;
        player = data;
      } else {
        const { data, error } = await admin.from("players").update({
          display_name: name, position, nationality: String(p.nationality || "").slice(0, 40) || null, skills,
          updated_at: new Date().toISOString()
        }).eq("id", player.id).select("*").single();
        if (error) throw error;
        player = data;
      }
      rosterIds.push(player.id);
      const { data: activeLink, error: linkError } = await admin.from("player_team_history").select("id,team_id").eq("player_id", player.id).is("left_at", null).maybeSingle();
      if (linkError) throw linkError;
      if (!activeLink) {
        const { error } = await admin.from("player_team_history").insert({ player_id: player.id, team_id: team.id });
        if (error) throw error;
      } else if (activeLink.team_id !== team.id) {
        return respond({ ok: false, error: "A roster player is already assigned to another active team; no transfer was performed." }, 409);
      }
    }

    const { data: activeCoachLink, error: coachLinkError } = await admin.from("coach_team_history").select("id,team_id").eq("coach_id", coach.id).is("left_at", null).maybeSingle();
    if (coachLinkError) throw coachLinkError;
    if (!activeCoachLink) {
      const { error } = await admin.from("coach_team_history").insert({ coach_id: coach.id, team_id: team.id });
      if (error) throw error;
    } else if (activeCoachLink.team_id !== team.id) {
      return respond({ ok: false, error: "Coach already has an active team; no transfer was performed." }, 409);
    }

    const { error: coachStatsError } = await admin.from("coach_season_stats").upsert({
      coach_id: coach.id, season_id: season.id, team_id: team.id
    }, { onConflict: "coach_id,season_id,team_id", ignoreDuplicates: true });
    if (coachStatsError) throw coachStatsError;
    const { error: teamStatsError } = await admin.from("team_season_stats").upsert({
      team_id: team.id, season_id: season.id
    }, { onConflict: "team_id,season_id", ignoreDuplicates: true });
    if (teamStatsError) throw teamStatsError;

    return respond({ ok: true, initialized: true, coach, team, season, rosterPlayerIds: rosterIds, rosterCount: rosterIds.length });
  } catch (error) {
    console.error("career-api error", error);
    return respond({ ok: false, error: error instanceof Error ? error.message : "Internal server error" }, 500);
  }
});