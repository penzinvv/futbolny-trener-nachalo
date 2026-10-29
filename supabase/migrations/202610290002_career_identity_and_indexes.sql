-- Extend career persistence with stable player keys, profile fields and indexes.
-- This migration has already been applied to the dedicated project qfkekaipmbtzxtuspjqv.
alter table public.players add column if not exists source_player_key text;
create unique index if not exists players_source_player_key_uidx
  on public.players(source_player_key) where source_player_key is not null;
create unique index if not exists coach_profiles_owner_user_id_uidx
  on public.coach_profiles(owner_user_id);
create unique index if not exists teams_one_active_owned_team_uidx
  on public.teams(owner_user_id) where owner_user_id is not null and archived_at is null;

alter table public.players add column if not exists position text;
alter table public.players add column if not exists nationality text;
alter table public.players add column if not exists skills jsonb not null default '{}'::jsonb;
alter table public.players add column if not exists potential integer;
alter table public.players add constraint players_position_check
  check (position is null or position in ('ВР','ЗЩ','ПЗ','НП')) not valid;
alter table public.players validate constraint players_position_check;
alter table public.players add constraint players_potential_check
  check (potential is null or potential between 1 and 100) not valid;
alter table public.players validate constraint players_potential_check;

create index if not exists career_achievements_season_idx on public.career_achievements(season_id);
create index if not exists coach_season_stats_season_idx on public.coach_season_stats(season_id);
create index if not exists coach_season_stats_team_idx on public.coach_season_stats(team_id);
create index if not exists coach_team_history_team_idx on public.coach_team_history(team_id);
create index if not exists match_events_player_idx on public.match_events(player_id);
create index if not exists match_events_secondary_player_idx on public.match_events(secondary_player_id);
create index if not exists match_events_team_idx on public.match_events(team_id);
create index if not exists match_player_stats_team_idx on public.match_player_stats(team_id);
create index if not exists matches_coach_idx on public.matches(coach_id);
create index if not exists player_season_stats_team_idx on public.player_season_stats(team_id);
create index if not exists player_team_history_team_idx on public.player_team_history(team_id);
create index if not exists players_debut_season_idx on public.players(debut_season_id);
create index if not exists team_season_stats_season_idx on public.team_season_stats(season_id);