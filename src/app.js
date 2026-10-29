const STORAGE_KEY = "football-coach-start-v1";
const defaultState = {
  coachName: "", teamName: "", emblem: "🛡️", teamLogoIndex: 1, avatarIndex: 1, seasonNumber: 1, avatarChangeUsedSeason: 0,
  xp: 0, permanentRating: 0, seasonRating: 0, respect: 0, gameDay: 1, players: [], relationships: {},
  careerCoachId: null, careerTeamId: null, careerPlayerIds: {}, careerHistory: { officialMatches: [], seasons: {} }, completedFixtures: []
};
let state = loadState();
let leagueData = null;
fetch("/data/league.json").then(r => { if (!r.ok) throw new Error("Не удалось загрузить данные лиги"); return r.json(); }).then(data => { leagueData = data; if (state.coachName && state.teamName) render(); }).catch(err => console.error(err));

const $ = (id) => document.getElementById(id);
function loadState() {
  try { return { ...defaultState, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") }; }
  catch { return { ...defaultState }; }
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

const DAYS_PER_SEASON = 182;
const DAYS_PER_GAME_YEAR = DAYS_PER_SEASON * 2;
function getAbsoluteGameDay(season = state.seasonNumber, day = state.gameDay) {
  return Math.max(1, (Math.max(1, Number(season) || 1) - 1) * DAYS_PER_SEASON + Math.max(1, Number(day) || 1));
}
function getMatchDayForRound(round) {
  const n = Math.max(1, Math.min(20, Number(round) || 1));
  return n <= 10 ? n * 7 : 70 + 31 + (n - 10) * 7;
}
function getSeasonMatchDays() { return Array.from({length:20}, (_,index) => getMatchDayForRound(index + 1)); }
function isOfficialMatchDay(day = state.gameDay) { return getSeasonMatchDays().includes(Number(day)); }
function getStablePlayerBirthData(player, teamId = "unknown") {
  const identity = String(player.careerId || (teamId + "::" + player.name));
  let hash = 2166136261;
  for (const char of identity) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  const unsigned = hash >>> 0;
  return {ageAtStart:14+(unsigned%7),birthdayDayOfYear:1+((Math.imul(unsigned^0x45d9f3b,0x27d4eb2d)>>>0)%DAYS_PER_GAME_YEAR)};
}
function getPlayerAge(player, teamId = "unknown", absoluteDay = getAbsoluteGameDay()) {
  const fallback = getStablePlayerBirthData(player, teamId);
  const baseAge = Math.max(14, Math.min(21, Number(player.ageAtStart ?? fallback.ageAtStart) || fallback.ageAtStart));
  const birthdayDay = Math.max(1, Math.min(DAYS_PER_GAME_YEAR, Number(player.birthdayDayOfYear ?? fallback.birthdayDayOfYear) || fallback.birthdayDayOfYear));
  const firstBirthday = birthdayDay === 1 ? DAYS_PER_GAME_YEAR + 1 : birthdayDay;
  return baseAge + (absoluteDay >= firstBirthday ? 1 + Math.floor((absoluteDay-firstBirthday)/DAYS_PER_GAME_YEAR) : 0);
}
function isPlayerBirthdayOnDay(player, absoluteDay, teamId = "unknown") {
  const fallback = getStablePlayerBirthData(player, teamId);
  const birthdayDay = Math.max(1, Math.min(DAYS_PER_GAME_YEAR, Number(player.birthdayDayOfYear ?? fallback.birthdayDayOfYear) || fallback.birthdayDayOfYear));
  const firstBirthday = birthdayDay === 1 ? DAYS_PER_GAME_YEAR + 1 : birthdayDay;
  return absoluteDay >= firstBirthday && (absoluteDay-firstBirthday)%DAYS_PER_GAME_YEAR === 0;
}
function getUserRoster() { const team=getUserTeam(); return team?.players || state.players || []; }
function getCurrentOfficialFixture() {
  for (const calendar of Object.values(state.seasonCalendars || {})) {
    if (Number(calendar.seasonNumber)!==Number(state.seasonNumber||1)) continue;
    const fixture=(calendar.rounds||[]).flat().find(item=>Number(item.gameDay||getMatchDayForRound(item.round))===Number(state.gameDay)&&(item.homeIsUser||item.awayIsUser));
    if (fixture) return fixture;
  }
  return null;
}
function isCurrentOfficialMatchCompleted() {
  if (!isOfficialMatchDay()) return false;
  const fixture=getCurrentOfficialFixture();
  if (!fixture) return false;
  return Boolean((state.careerHistory?.officialMatches||[]).some(match=>match.fixtureId===fixture.fixtureId)
    || (state.completedFixtures||[]).includes(fixture.fixtureId));
}
function updateCalendarControls() {
  const date=$("gameDate");
  if(date)date.textContent="СЕЗОН "+(state.seasonNumber||1)+", День "+(state.gameDay||1);
  const next=$("nextMatchDate");
  if(next){
    const currentDay=Number(state.gameDay||1);
    const upcoming=getSeasonMatchDays().find(day=>day>currentDay||(day===currentDay&&!isCurrentOfficialMatchCompleted()));
    next.textContent=upcoming?(upcoming===currentDay?"Сегодня · День "+upcoming:"День "+upcoming):"Следующий сезон";
  }
  const button=$("skipDayButton");
  if(button){
    const blocked=Boolean(state.coachName&&state.teamName&&isOfficialMatchDay()&&!isCurrentOfficialMatchCompleted());
    button.disabled=blocked||!state.coachName||!state.teamName;
    button.textContent=blocked?"СЕГОДНЯ ОФИЦИАЛЬНЫЙ МАТЧ":"ПРОПУСТИТЬ ДЕНЬ";
    button.title=blocked?"Нельзя пропустить день официального матча. Сначала нужно провести матч.":"Перейти к следующему игровому дню";
  }
  const notice=$("dayEventNotice");
  if(notice){const event=state.lastDayEvent;notice.textContent=event?.message||"";notice.classList.toggle("hidden",!event?.message);}
}
function advanceGameDay() {
  if(!state.coachName||!state.teamName)return;
  if(isOfficialMatchDay()&&!isCurrentOfficialMatchCompleted()){
    state.lastDayEvent={message:"Сегодня официальный матч. Сначала проведи матч, затем можно будет перейти к следующему дню."};
    saveState();render();return;
  }
  if(Number(state.gameDay||1)>=DAYS_PER_SEASON){
    state.seasonNumber=Number(state.seasonNumber||1)+1;state.gameDay=1;state.seasonRating=0;
    state.lastDayEvent={message:"Начался СЕЗОН "+state.seasonNumber+". Один игровой год длится два сезона."};
  }else{state.gameDay=Number(state.gameDay||1)+1;state.lastDayEvent=null;}
  const absoluteDay=getAbsoluteGameDay();
  const team=getUserTeam();
  const birthdays=getUserRoster().filter(player=>isPlayerBirthdayOnDay(player,absoluteDay,team?.id));
  if(birthdays.length){
    state.lastDayEvent={message:"🎂 День рождения: "+birthdays.map(player=>player.name+" ("+getPlayerAge(player,team?.id,absoluteDay)+" лет)").join(", ")+ "."};
  }
  saveState();render();
}

const SUPABASE_URL = "https://qfkekaipmbtzxtuspjqv.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uEoHSnOBVXtlJm--cZF_IQ_IRXmG55x";
const cloudClient = window.supabase?.createClient
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;
let cloudSyncPromise = null;

async function getCloudSession() {
  if (!cloudClient) throw new Error("Supabase JS не загрузился. Проверь подключение к интернету и перезагрузи страницу.");
  let { data: { session } } = await cloudClient.auth.getSession();
  if (!session) {
    const { data, error } = await cloudClient.auth.signInAnonymously();
    if (error) throw new Error("Не удалось создать облачную сессию: " + error.message);
    session = data.session;
  }
  if (!session?.access_token) throw new Error("Supabase не выдал токен сессии.");
  return session;
}

async function cloudRequest(method = "GET", body = null) {
  const session = await getCloudSession();
  const response = await fetch(SUPABASE_URL + "/functions/v1/career-api", {
    method,
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_PUBLISHABLE_KEY,
      "Authorization": "Bearer " + session.access_token
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) throw new Error(result.error || "Ошибка серверной карьеры (" + response.status + ")");
  return result;
}

async function syncCareerToCloud(bootstrap = false) {
  if (cloudSyncPromise) return cloudSyncPromise;
  cloudSyncPromise = (async () => {
    ensureCareerIdentity();
    if (bootstrap) {
      const team = getUserTeam();
      const roster = team?.players || [];
      if (!roster.length) throw new Error("Состав ещё не загружен. Перезагрузи страницу и попробуй ещё раз.");
      await cloudRequest("POST", {
        action: "bootstrap",
        coachName: state.coachName,
        teamName: state.teamName,
        roster: roster.slice(0, 10).map(p => ({
          careerId: p.careerId,
          name: p.name,
          position: p.position,
          nationality: p.nationality,
          skills: p.skills || {}
        }))
      });
      // Read back server-generated IDs so local state uses the canonical cloud identities.
      const snapshot = await cloudRequest("GET");
      if (snapshot.initialized) {
        state.careerCoachId = snapshot.coach?.id || state.careerCoachId;
        state.careerTeamId = snapshot.team?.id || state.careerTeamId;
        state.careerPlayerIds = state.careerPlayerIds || {};
        (snapshot.roster || []).forEach(player => {
          if (player.source_player_key) state.careerPlayerIds[player.source_player_key] = player.id;
        });
        state.cloudCareerConnected = true;
        saveState();
      }
      return snapshot;
    }
    const result = await cloudRequest("GET");
    if (result.initialized) {
      state.coachName = result.coach?.display_name || state.coachName;
      state.teamName = result.team?.name || state.teamName;
      state.careerCoachId = result.coach.id;
      state.careerTeamId = result.team?.id || null;
      state.careerPlayerIds = state.careerPlayerIds || {};
      (result.roster || []).forEach(p => {
        if (p.source_player_key) state.careerPlayerIds[p.source_player_key] = p.id;
      });
      state.cloudCareerConnected = true;
      saveState();
    }
    return result;
  })();
  try { return await cloudSyncPromise; }
  finally { cloudSyncPromise = null; }
}

async function initializeCloudCareer() {
  try {
    const result = await syncCareerToCloud(false);
    if (!result.initialized && state.coachName && state.teamName && leagueData) {
      await syncCareerToCloud(true);
    } else if (result.initialized) {
      saveState();
      if (state.coachName && state.teamName) render();
    }
  } catch (error) {
    console.warn("Облачная карьера пока не подключена:", error);
  }
}

const AVATAR_COUNT = 6;
function avatarPath(index) { return "/images/avatartrener/avatartrener" + index + ".jpg"; }
function teamLogoPath(index) { return "/images/avatarteam/avatarteam" + index + ".jpg"; }
function makeTeamLogoOptions(containerId, groupName, selectedIndex) {
  const container = $(containerId); container.replaceChildren();
  for (let i = 1; i <= AVATAR_COUNT; i++) {
    const label = document.createElement("label"); label.className = "avatar-option team-logo-option";
    const radio = document.createElement("input"); radio.type = "radio"; radio.name = groupName; radio.value = String(i); radio.checked = i === Number(selectedIndex); radio.setAttribute("aria-label", "Логотип команды " + i);
    const img = document.createElement("img"); img.src = teamLogoPath(i); img.alt = "Логотип команды " + i; img.loading = "lazy";
    label.append(radio, img); container.append(label);
  }
}
function makeAvatarOptions(containerId, groupName, selectedIndex) {
  const container = $(containerId);
  container.replaceChildren();
  for (let i = 1; i <= AVATAR_COUNT; i++) {
    const label = document.createElement("label"); label.className = "avatar-option";
    const radio = document.createElement("input"); radio.type = "radio"; radio.name = groupName; radio.value = String(i); radio.checked = i === Number(selectedIndex); radio.setAttribute("aria-label", "Аватар " + i);
    const img = document.createElement("img"); img.src = avatarPath(i); img.alt = "Аватар " + i; img.loading = "lazy";
    label.append(radio, img); container.append(label);
  }
}
makeAvatarOptions("avatarPicker", "coachAvatarInitial", state.avatarIndex || 1);
makeTeamLogoOptions("teamLogoPicker", "teamLogoInitial", state.teamLogoIndex || 1);
makeAvatarOptions("avatarChangePicker", "coachAvatarChange", state.avatarIndex || 1);
function closeAvatarChange() { $("avatarChangePanel").classList.add("hidden"); $("dashboard").classList.remove("hidden"); }
$("changeAvatarButton").addEventListener("click", () => {
  if (Number(state.avatarChangeUsedSeason || 0) >= Number(state.seasonNumber || 1)) return;
  makeAvatarOptions("avatarChangePicker", "coachAvatarChange", state.avatarIndex || 1);
  $("avatarChangeMessage").textContent = "Сезон " + (state.seasonNumber || 1) + ": смена доступна один раз за сезон. Имя тренера останется прежним.";
  $("dashboard").classList.add("hidden"); $("pageView").classList.add("hidden"); $("avatarChangePanel").classList.remove("hidden");
});
$("cancelAvatarChange").addEventListener("click", closeAvatarChange);
$("saveAvatarChange").addEventListener("click", () => {
  if (Number(state.avatarChangeUsedSeason || 0) >= Number(state.seasonNumber || 1)) return;
  const selected = document.querySelector('input[name="coachAvatarChange"]:checked'); if (!selected) return;
  state.avatarIndex = Number(selected.value); state.avatarChangeUsedSeason = Number(state.seasonNumber || 1);
  saveState(); closeAvatarChange(); render();
});
function showSetup() { $("onboarding").classList.remove("hidden"); $("dashboard").classList.add("hidden"); }
function render() {
  ensureCareerIdentity();
  $("coachNameLabel").textContent = state.coachName || "Тренер";
  $("coachAvatar").src = avatarPath(state.avatarIndex || 1);
  $("changeAvatarButton").classList.remove("hidden");
  $("changeAvatarButton").disabled = Number(state.avatarChangeUsedSeason || 0) >= Number(state.seasonNumber || 1);
  $("changeAvatarButton").textContent = $("changeAvatarButton").disabled ? "Аватар уже менялся в этом сезоне" : "Сменить аватар";
  $("coachLevel").textContent = Math.max(1, Math.floor(Math.sqrt(state.xp / 100)) + 1);
  $("teamName").textContent = state.teamName || "Дворовые";
  $("teamEmblem").innerHTML = '<img src="' + teamLogoPath(state.teamLogoIndex || 1) + '" alt="Логотип команды">';
  updateCalendarControls();
  $("rosterCount").textContent = getUserTeam()?.players?.length || state.players.length || 10;
  $("xpValue").textContent = `${state.xp} XP`;
  $("permanentRating").textContent = state.permanentRating;
  $("seasonRating").textContent = state.seasonRating;
  $("respectValue").textContent = state.respect;
}

/* Фоновая музыка: случайный порядок без повторов до конца текущего круга.
   Браузеры требуют первого нажатия пользователя перед воспроизведением со звуком. */
const musicTracks = [
  "/music/footmusic1.mp3",
  "/music/footmusic2.mp3",
  "/music/footmusic3.mp3",
  "/music/footmusic4.mp3",
  "/music/footmusic5.mp3",
  "/music/footmusic6.mp3"
];
const musicPlayer = $("backgroundMusic");
const musicToggle = $("musicToggle");
let shuffledTracks = [];
let currentTrackIndex = -1;
let musicEnabled = false;
let lastTrackPath = "";

function shuffleTracks() {
  shuffledTracks = [...musicTracks];
  for (let i = shuffledTracks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledTracks[i], shuffledTracks[j]] = [shuffledTracks[j], shuffledTracks[i]];
  }
  // Не повторяем последнюю песню прошлого круга сразу же.
  if (shuffledTracks.length > 1 && shuffledTracks[0] === lastTrackPath) {
    [shuffledTracks[0], shuffledTracks[1]] = [shuffledTracks[1], shuffledTracks[0]];
  }
  currentTrackIndex = -1;
}

async function playNextTrack() {
  if (!musicEnabled) return;
  if (currentTrackIndex + 1 >= shuffledTracks.length) shuffleTracks();
  currentTrackIndex += 1;
  musicPlayer.src = shuffledTracks[currentTrackIndex];
  lastTrackPath = shuffledTracks[currentTrackIndex];
  try {
    await musicPlayer.play();
    musicToggle.textContent = "♫ Выключить музыку";
    musicToggle.setAttribute("aria-pressed", "true");
  } catch (error) {
    musicEnabled = false;
    musicToggle.textContent = "♫ Повторить запуск музыки";
    musicToggle.setAttribute("aria-pressed", "false");
    console.warn("Не удалось запустить фоновую музыку:", error);
  }
}

musicPlayer.addEventListener("ended", () => { if (musicEnabled) playNextTrack(); });
musicPlayer.addEventListener("error", () => {
  if (!musicEnabled) return;
  // Если отдельный файл недоступен, пробуем следующий трек, не останавливая весь плейлист.
  if (currentTrackIndex + 1 < shuffledTracks.length) playNextTrack();
  else {
    musicEnabled = false;
    musicToggle.textContent = "♫ Музыка недоступна";
    musicToggle.setAttribute("aria-pressed", "false");
  }
});
musicToggle.addEventListener("click", async () => {
  if (musicEnabled) {
    musicEnabled = false;
    musicPlayer.pause();
    musicToggle.textContent = "♫ Включить музыку";
    musicToggle.setAttribute("aria-pressed", "false");
    return;
  }
  musicEnabled = true;
  if (!shuffledTracks.length) shuffleTracks();
  // Разрешённый браузером запуск происходит непосредственно после нажатия кнопки.
  if (musicPlayer.src && musicPlayer.paused && currentTrackIndex >= 0) {
    try {
      await musicPlayer.play();
      musicToggle.textContent = "♫ Выключить музыку";
      musicToggle.setAttribute("aria-pressed", "true");
    } catch { await playNextTrack(); }
  } else {
    await playNextTrack();
  }
});

$("skipDayButton").addEventListener("click", advanceGameDay);

$("setupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const coachName = $("coachName").value.trim();
  const teamName = $("teamNameInput").value.trim();
  if (!coachName || !teamName) return;
  state.coachName = coachName.slice(0,24);
  state.teamName = teamName.slice(0,28);
  state.teamLogoIndex = Number(document.querySelector('input[name="teamLogoInitial"]:checked')?.value || 1);
  state.emblem = "image";
  state.avatarIndex = Number(document.querySelector('input[name="coachAvatarInitial"]:checked')?.value || 1);
  state.selectedLeague = "Нижняя лига";
  if (!state.seasonNumber) state.seasonNumber = 1;
  saveState(); $("onboarding").classList.add("hidden"); $("dashboard").classList.remove("hidden"); render();
  // The first cloud initialization must run after the player creates a coach and team.
  void initializeCloudCareer();
});


/* Предварительный прототип матча по календарю.
   Счёт и статистика не сохраняются; хранится только отметка прохождения календарного дня. */
let lastMatchPreview = null;
function clampMatchValue(value,min,max){return Math.max(min,Math.min(max,value));}
function getMatchFive(team){
  const roster=Array.isArray(team?.players)?team.players:[];
  if(!roster.length)return [];
  const chosen=[];
  const take=(position,count)=>roster.filter(player=>player.position===position&&!chosen.includes(player)).slice(0,count).forEach(player=>chosen.push(player));
  take("ВР",1);take("ЗЩ",1);take("ПЗ",2);take("НП",1);
  for(const player of roster){if(chosen.length>=5)break;if(!chosen.includes(player))chosen.push(player);}
  return chosen.slice(0,5);
}
function averageMatchSkill(players,keys){
  if(!players.length)return 40;
  const values=players.map(player=>{
    const available=keys.filter(key=>Number.isFinite(Number(player.skills?.[key])));
    return available.length?available.reduce((sum,key)=>sum+Number(player.skills[key]),0)/available.length:40;
  });
  return values.reduce((sum,value)=>sum+value,0)/values.length;
}
function makePlayerMatchStats(players){
  return players.map(player=>({
    player,goals:0,assists:0,shots:0,saves:0,tackles:0,keyPasses:0,errors:0
  }));
}
function pickMatchPlayer(stats,positions){
  const eligible=stats.filter(item=>positions.includes(item.player.position));
  const pool=eligible.length?eligible:stats;
  return pool.length?pool[Math.floor(Math.random()*pool.length)]:null;
}
function calculatePlayerMatchRating(item,teamGoalsAgainst,teamResult){
  const player=item.player;
  const position=player.position;
  let score=6.0;
  if(teamResult==="W")score+=0.45;
  else if(teamResult==="L")score-=0.35;
  if(position==="ВР"){
    score+=Math.min(2.0,item.saves*0.45);
    score-=teamGoalsAgainst*0.4;
  }else if(position==="ЗЩ"){
    score+=Math.min(1.6,item.tackles*0.25);
    score-=item.errors*0.8;
    score-=teamGoalsAgainst*0.12;
  }else if(position==="ПЗ"){
    score+=Math.min(1.5,item.keyPasses*0.22);
    score+=item.assists*0.85;
    score+=item.goals*0.45;
    score-=item.errors*0.35;
  }else if(position==="НП"){
    score+=item.goals*1.15;
    score+=item.assists*0.65;
    score+=Math.min(0.8,Math.max(0,item.shots-item.goals)*0.08);
    score-=item.errors*0.3;
  }else{
    score+=item.goals*0.8+item.assists*0.6;
  }
  // Незначительный разброс отражает действия, не вынесенные в отдельную статистику прототипа.
  score+=(Math.random()-0.5)*0.5;
  return Math.round(clampMatchValue(score,1,10)*10)/10;
}
function simulateFixturePreview(fixture){
  const userTeam=getUserTeam();
  const userIsHome=Boolean(fixture.homeIsUser);
  const opponentId=userIsHome?fixture.awayTeamId:fixture.homeTeamId;
  const opponent=(leagueData?.teams||[]).find(item=>String(item.id)===String(opponentId));
  const opponentTeam=opponent||{id:opponentId,name:userIsHome?fixture.awayTeamName:fixture.homeTeamName,players:[]};
  const userFive=getMatchFive(userTeam),opponentFive=getMatchFive(opponentTeam);
  const userStats=makePlayerMatchStats(userFive),opponentStats=makePlayerMatchStats(opponentFive);
  const userAttack=averageMatchSkill(userFive,["НП","ПЗ"]);
  const userDefence=(averageMatchSkill(userFive,["ЗЩ"])+averageMatchSkill(userFive,["ВР"]))/2;
  const opponentAttack=averageMatchSkill(opponentFive,["НП","ПЗ"]);
  const opponentDefence=(averageMatchSkill(opponentFive,["ЗЩ"])+averageMatchSkill(opponentFive,["ВР"]))/2;
  let userGoals=0,opponentGoals=0;
  const events=[];
  // 20 игровых минут, по одной атакующей цепочке за минуту; владение чередуется.
  for(let minute=1;minute<=20;minute++){
    const userHasBall=minute%2===1;
    const attack= userHasBall?userAttack:opponentAttack;
    const defence=userHasBall?opponentDefence:userDefence;
    const attackingStats=userHasBall?userStats:opponentStats;
    const defendingStats=userHasBall?opponentStats:userStats;
    const chanceProbability=clampMatchValue(0.40+(attack-defence)*0.002,0.25,0.58);
    const conversionProbability=clampMatchValue(0.30+attack*0.002,0.28,0.52);
    const midfielder=pickMatchPlayer(attackingStats,["ПЗ"]);
    if(midfielder&&Math.random()<0.65)midfielder.keyPasses++;
    const defender=pickMatchPlayer(defendingStats,["ЗЩ"]);
    if(defender&&Math.random()<0.45)defender.tackles++;
    if(Math.random()<chanceProbability){
      const shooter=pickMatchPlayer(attackingStats,["НП","ПЗ"]);
      if(shooter)shooter.shots++;
      if(Math.random()<conversionProbability){
        if(userHasBall)userGoals++;else opponentGoals++;
        if(shooter)shooter.goals++;
        const assistCandidate=shooter?.player.position==="НП"?pickMatchPlayer(attackingStats,["ПЗ"]):null;
        if(assistCandidate&&assistCandidate!==shooter&&Math.random()<0.7)assistCandidate.assists++;
        events.push({minute,text:minute+"′ — "+(shooter?.player.name|| (userHasBall?state.teamName:opponentTeam.name))+" забивает за "+(userHasBall?state.teamName:opponentTeam.name)+"!"});
      }else{
        const keeper=pickMatchPlayer(defendingStats,["ВР"]);
        if(keeper)keeper.saves++;
        events.push({minute,text:minute+"′ — опасный момент у "+(userHasBall?state.teamName:opponentTeam.name)+", вратарь или защита отражают удар."});
      }
    }
  }
  if(!events.length)events.push({minute:20,text:"Матч прошёл без опасных моментов."});
  const userResult=userGoals>opponentGoals?"W":userGoals<opponentGoals?"L":"D";
  const opponentResult=userResult==="W"?"L":userResult==="L"?"W":"D";
  const rate=(stats,against,result)=>stats.map(item=>({
    name:item.player.name,position:item.player.position,rating:calculatePlayerMatchRating(item,against,result),
    goals:item.goals,assists:item.assists,saves:item.saves,tackles:item.tackles,keyPasses:item.keyPasses,shots:item.shots
  })).sort((a,b)=>b.rating-a.rating);
  const userRatings=rate(userStats,opponentGoals,userResult);
  const opponentRatings=rate(opponentStats,userGoals,opponentResult);
  return {
    fixtureId:fixture.fixtureId,homeName:fixture.homeTeamName,awayName:fixture.awayTeamName,
    homeGoals:userIsHome?userGoals:opponentGoals,awayGoals:userIsHome?opponentGoals:userGoals,
    events,userRatings,opponentRatings
  };
}
function runCalendarMatch(fixture){
  if(!fixture||!isOfficialMatchDay())return;
  if((state.completedFixtures||[]).includes(fixture.fixtureId)
    ||(state.careerHistory?.officialMatches||[]).some(match=>match.fixtureId===fixture.fixtureId))return;
  lastMatchPreview=simulateFixturePreview(fixture);
  state.completedFixtures=Array.isArray(state.completedFixtures)?state.completedFixtures:[];
  state.completedFixtures.push(fixture.fixtureId);
  // Не сохраняем счёт, события, статистику, XP или рейтинг и не отправляем их в Supabase.
  saveState();
  openPage("cabinet");
  const matchesTab=document.querySelector('[data-cabinet-tab="matches"]');
  if(matchesTab)matchesTab.click();
}
function makeMatchPreviewPanel(fixture){
  const panel=document.createElement("section");panel.className="cabinet-panel match-preview-panel";
  panel.append(safeText("h2","Матч по календарю · тестовый протокол"),
    safeText("p","Предварительная симуляция на 20 игровых минут. Счёт и статистика не сохраняются и не отправляются в Supabase.","muted"));
  const button=document.createElement("button");button.type="button";button.className="primary-button";button.textContent="Провести матч";
  button.addEventListener("click",()=>runCalendarMatch(fixture));panel.append(button);return panel;
}
function makeMatchPreviewResult(preview){
  const panel=document.createElement("section");panel.className="cabinet-panel match-preview-result";
  panel.append(safeText("h2","Матч завершён · тестовый результат"),
    safeText("p",preview.homeName+"  "+preview.homeGoals+" : "+preview.awayGoals+"  "+preview.awayName,"match-preview-score"),
    safeText("p","Оценки предварительные: они показывают работу модели и пока не сохраняются в карьеру или историю наград.","muted"));
  const events=document.createElement("div");events.className="match-preview-events";
  preview.events.forEach(event=>events.append(safeText("p",event.text)));
  panel.append(events);
  const makeRatings=(title,ratings)=>{
    const section=document.createElement("section");section.className="match-rating-section";
    section.append(safeText("h3",title));
    const list=document.createElement("div");list.className="match-rating-list";
    ratings.forEach(item=>{
      const row=document.createElement("div");row.className="match-rating-row";
      const identity=document.createElement("div");identity.className="match-rating-identity";
      identity.append(safeText("b",item.name),safeText("span",item.position));
      const score=safeText("strong",item.rating.toFixed(1));score.className="match-rating-score";
      const details=[];
      if(item.goals)details.push("Голы: "+item.goals);
      if(item.assists)details.push("Ассисты: "+item.assists);
      if(item.saves)details.push("Сейвы: "+item.saves);
      if(item.tackles)details.push("Отборы: "+item.tackles);
      if(item.keyPasses)details.push("Ключевые передачи: "+item.keyPasses);
      if(item.shots)details.push("Удары: "+item.shots);
      row.append(identity,safeText("span",details.join(" · ")||"Без ключевых действий","match-rating-details"),score);
      list.append(row);
    });
    section.append(list);return section;
  };
  panel.append(makeRatings("Оценки нашей команды",preview.userRatings),makeRatings("Оценки соперника",preview.opponentRatings));
  return panel;
}

const pages = {
  cabinet: {title:"Кабинет тренера", eyebrow:"УПРАВЛЕНИЕ КОМАНДОЙ", render: renderCabinet},
  players: {title:"Футболисты", eyebrow:"СОСТАВ", render: renderPlayers},
  mail: {title:"Почта", eyebrow:"СООБЩЕНИЯ", render: () => placeholder("Новых сообщений пока нет.")},
  training: {title:"Тренировка", eyebrow:"РАЗВИТИЕ", render: renderTraining},
  upbringing: {title:"Воспитание", eyebrow:"ОТНОШЕНИЯ", render: renderUpbringing},
  league: {title:"Лиги и команды", eyebrow:"СОРЕВНОВАНИЯ", render: renderLeague},
  goals: {title:"Цели тренера", eyebrow:"ПРОГРЕСС", render: () => placeholder("Система уникальных и периодических целей будет добавлена после согласования чисел и списка целей.")}
};

function renderCabinet() {
  const wrap=document.createElement("div");wrap.className="cabinet-view";
  const tabs=document.createElement("div");tabs.className="cabinet-tabs";tabs.setAttribute("role","tablist");
  const body=document.createElement("div");body.className="cabinet-tab-content";
  const options=[["overview","Обзор"],["team","Футболисты"],["relations","Отношения"],["stats","Статистика команды"],["table","Турнирная таблица"],["matches","Матчи"],["career","Карьера тренера"]];
  const panel=(title,subtitle)=>{const el=document.createElement("section");el.className="cabinet-panel";el.append(safeText("h2",title),safeText("p",subtitle,"muted"));return el;};
  const renderTab=(key)=>{
    body.replaceChildren();const team=getUserTeam();const roster=team?.players||[];let p;
    if(key==="overview"){
      p=panel("Кабинет тренера","Главная информация о вашей команде и карьере.");
      const grid=document.createElement("div");grid.className="cabinet-metrics";
      [["Команда",state.teamName||"—"],["Лига",team?.league||state.selectedLeague||"Нижняя лига"],["Футболисты",String(roster.length||state.players.length||10)+" / 10"],["Сезон","Сезон "+(state.seasonNumber||1)],["Опыт тренера",(state.xp||0)+" XP"],["Уважение",String(state.respect||0)]].forEach(([label,value])=>{const card=document.createElement("div");card.className="cabinet-metric";card.append(safeText("small",label),safeText("b",value));grid.append(card);});
      p.append(grid,safeText("p","Здесь собраны состав, отношения с игроками, результаты команды и история вашей тренерской карьеры.","muted"));
    } else if(key==="team"||key==="relations"){
      p=panel(key==="team"?"Футболисты команды":"Отношения с футболистами",key==="team"?"Весь состав команды. Выберите карточку, чтобы открыть профиль футболиста.":"Отношения с каждым футболистом и прогресс до следующего порога.");
      if(key==="team"){
        const grid=document.createElement("div");grid.className="cabinet-player-grid";
        roster.forEach((player,i)=>{
          const card=document.createElement("button");card.type="button";card.className="cabinet-player-card";card.addEventListener("click",()=>openPlayerProfile(team,player,i));
          const img=document.createElement("img");img.src=getPortrait(player.portraitIndex||teamsPlayerIndex(team,player));img.alt=player.name;img.loading="lazy";img.onerror=()=>img.remove();
          const info=document.createElement("span");info.className="cabinet-player-info";info.append(safeText("b",player.name),safeText("small",player.position+" · "+player.nationality+" · "+getPlayerAge(player,team.id)+" лет"));
          const mainSkill=player.skills?.[player.position];if(mainSkill!==undefined)info.append(safeText("span",player.position+": "+mainSkill,"cabinet-player-main-skill"));
          card.append(img,info,makeRelationBadge(team,player),makePlayerSkillSummary(team,player));grid.append(card);
        });
        p.append(grid);
      } else {
        p.append(makeRelationsList(team,roster,(player,i)=>openPlayerProfile(team,player,i)));
        p.append(safeText("p","Отношения сейчас не повышаются автоматически. Когда будут согласованы игровые действия воспитания, здесь появятся реальные способы их улучшать.","muted"));
      }
    } else if(key==="stats"){
      p=panel("Статистика команды","Сводка по текущему составу, развитию игроков и отношениям. Официальные игровые показатели появятся после подключения сохранения матчей.");
      const positions=["ВР","ЗЩ","ПЗ","НП"];
      const grid=document.createElement("div");grid.className="cabinet-metrics team-stat-metrics";
      const avgRelation=roster.length?Math.round(roster.reduce((sum,player)=>sum+getPlayerRelation(team,player),0)/roster.length):0;
      const avgMain=roster.length?Math.round(roster.reduce((sum,player)=>sum+Number(player.skills?.[player.position]||0),0)/roster.length):0;
      const trainingRecords=Object.values(state.trainingHistory||{}).flat().filter(entry=>entry&&entry.type==="individual");
      const statValues=positions.map(pos=>({pos,players:roster.filter(player=>player.position===pos)}));
      const metrics=[
        ["Футболистов в составе",String(roster.length)+" / 10"],
        ["Средние отношения",roster.length?avgRelation+"%":"—"],
        ["Средняя профильная характеристика",roster.length?String(avgMain):"—"],
        ["Проведено индивидуальных тренировок",String(trainingRecords.length)],
        ...positions.map(pos=>["Игроков · "+pos,String(roster.filter(player=>player.position===pos).length)])
      ];
      metrics.forEach(([label,value])=>{const card=document.createElement("div");card.className="cabinet-metric";card.append(safeText("small",label),safeText("b",value));grid.append(card);});
      p.append(grid);
      const bars=document.createElement("section");bars.className="team-stat-section";bars.append(safeText("h3","Распределение по позициям"));
      statValues.forEach(({pos,players})=>{
        const row=document.createElement("div");row.className="team-stat-bar-row";
        const label=safeText("span",pos+" · "+players.length);
        const track=document.createElement("div");track.className="team-stat-track";
        const fill=document.createElement("div");fill.className="team-stat-fill";fill.style.width=(roster.length?players.length/roster.length*100:0)+"%";
        track.append(fill);row.append(label,track);bars.append(row);
      });
      p.append(bars);
      const visibleSection=document.createElement("section");visibleSection.className="team-stat-section";
      visibleSection.append(safeText("h3","Профильные характеристики"));
      visibleSection.append(safeText("p","Показываются только профильные значения, доступные по текущему уровню отношений с тренером.","muted"));
      const visiblePlayers=roster.map(player=>({player,relation:getPlayerRelation(team,player),value:Number(player.skills?.[player.position])})).filter(item=>getUnlockedSkills(item.player,item.relation).includes(item.player.position)&&Number.isFinite(item.value));
      if(visiblePlayers.length){
        visiblePlayers.sort((a,b)=>b.value-a.value);
        visiblePlayers.forEach(({player,value})=>{
          const row=document.createElement("div");row.className="team-stat-player";
          const name=safeText("span",player.name+" · "+player.position);
          const track=document.createElement("div");track.className="team-stat-track";
          const fill=document.createElement("div");fill.className="team-stat-fill";fill.style.width=Math.max(0,Math.min(100,value))+"%";
          const number=safeText("b",String(value));track.append(fill);row.append(name,track,number);visibleSection.append(row);
        });
      } else visibleSection.append(placeholder("Профильные характеристики пока скрыты. Повышай отношения с футболистами, чтобы открыть их."));
      p.append(visibleSection);
      const matches=Array.isArray(state.careerHistory?.officialMatches)?state.careerHistory.officialMatches:[];
      const matchGrid=document.createElement("div");matchGrid.className="cabinet-metrics team-stat-metrics";
      const officialTotals=matches.reduce((acc,match)=>{acc.played++;acc.wins+=match.result==="W"?1:0;acc.draws+=match.result==="D"?1:0;acc.losses+=match.result==="L"?1:0;acc.gf+=Number(match.goalsFor||0);acc.ga+=Number(match.goalsAgainst||0);return acc;},{played:0,wins:0,draws:0,losses:0,gf:0,ga:0});
      [["Официальные матчи",String(officialTotals.played)],["Победы / ничьи / поражения",officialTotals.wins+" / "+officialTotals.draws+" / "+officialTotals.losses],["Забито / пропущено",officialTotals.gf+" / "+officialTotals.ga]].forEach(([label,value])=>{const card=document.createElement("div");card.className="cabinet-metric";card.append(safeText("small",label),safeText("b",value));matchGrid.append(card);});
      const matchSection=document.createElement("section");matchSection.className="team-stat-section";matchSection.append(safeText("h3","Результаты матчей"),matchGrid,safeText("p","В официальную статистику входят только завершённые официальные матчи. Тестовые матчи не учитываются.","muted"));
      p.append(matchSection);
    } else if(key==="table"){
      const activeLeague=team?.league||state.selectedLeague||"Нижняя лига";
      p=panel("Турнирная таблица",activeLeague+" · сезон "+(state.seasonNumber||1));
      const leagueNames=["Нижняя лига","Верхняя лига"];
      const switcher=document.createElement("div");switcher.className="league-table-switcher";
      leagueNames.forEach(name=>{const button=document.createElement("button");button.type="button";button.className="league-table-switch"+(name===activeLeague?" active":"");button.textContent=name;button.setAttribute("aria-pressed",String(name===activeLeague));button.addEventListener("click",()=>renderTabWithLeague(name));switcher.append(button);});
      p.append(switcher);
      const tableWrap=document.createElement("div");tableWrap.className="league-table-scroll";
      const standingsTable=document.createElement("table");standingsTable.className="league-standings";
      const head=document.createElement("thead");const header=document.createElement("tr");
      ["Место","Команда","И","В","Н","П","Мячи","РМ","О"].forEach(label=>header.append(safeText("th",label)));
      head.append(header);const tbody=document.createElement("tbody");standingsTable.append(head,tbody);tableWrap.append(standingsTable);p.append(tableWrap);
      const hint=safeText("p","До завершения официальных матчей у команд нет начисленных очков. Тестовые матчи на положение в таблице не влияют.","muted");p.append(hint);
      function renderTabWithLeague(leagueName){
        const source=Array.isArray(leagueData?.teams)?leagueData.teams:[];
        const teams=source.filter(item=>item.league===leagueName).map(item=>({...item}));
        const placeholderTeam=teams.find(item=>item.name==="{teamName}");
        if(placeholderTeam){placeholderTeam.name=state.teamName||"Моя команда";placeholderTeam.isUser=true;}
        let userRow=teams.find(item=>item.name===(state.teamName||""));
        if(!userRow&&activeLeague===leagueName){
          userRow={id:team?.id||state.careerTeamId||"user-team",name:state.teamName||"Моя команда",league:leagueName,isUser:true};
          teams.push(userRow);
        }
        const playedByTeam=new Map();
        const officialMatches=Array.isArray(state.careerHistory?.officialMatches)?state.careerHistory.officialMatches:[];
        officialMatches.forEach(match=>{
          const opponentId=match.opponentTeamId||match.opponentId;
          if(!opponentId)return;
          const ownId=team?.id||state.careerTeamId;
          const goalsFor=Number(match.goalsFor||0),goalsAgainst=Number(match.goalsAgainst||0);
          const own=playedByTeam.get(ownId)||{played:0,wins:0,draws:0,losses:0,gf:0,ga:0,points:0};
          const opponent=playedByTeam.get(opponentId)||{played:0,wins:0,draws:0,losses:0,gf:0,ga:0,points:0};
          own.played++;own.gf+=goalsFor;own.ga+=goalsAgainst;
          opponent.played++;opponent.gf+=goalsAgainst;opponent.ga+=goalsFor;
          if(goalsFor>goalsAgainst){own.wins++;own.points+=3;opponent.losses++;}
          else if(goalsFor<goalsAgainst){own.losses++;opponent.wins++;opponent.points+=3;}
          else{own.draws++;opponent.draws++;own.points++;opponent.points++;}
          playedByTeam.set(ownId,own);playedByTeam.set(opponentId,opponent);
        });
        const rows=teams.map(item=>{const stats=playedByTeam.get(item.id)||{played:0,wins:0,draws:0,losses:0,gf:0,ga:0,points:0};return {...item,...stats,diff:stats.gf-stats.ga};});
        rows.sort((x,y)=>y.points-x.points||y.diff-x.diff||y.gf-x.gf||x.name.localeCompare(y.name,"ru"));
        tbody.replaceChildren();
        rows.forEach((item,index)=>{
          const row=document.createElement("tr");if(item.isUser)row.className="is-user-team";
          const values=[String(index+1),item.name,String(item.played),String(item.wins),String(item.draws),String(item.losses),item.gf+":"+item.ga,(item.diff>0?"+":"")+item.diff,String(item.points)];
          values.forEach((value,i)=>row.append(safeText(i===1?"th":"td",value)));
          tbody.append(row);
        });
        switcher.querySelectorAll("button").forEach(button=>{const active=button.textContent===leagueName;button.classList.toggle("active",active);button.setAttribute("aria-pressed",String(active));});
      }
      renderTabWithLeague(activeLeague);
    } else if(key==="matches"){
      const activeLeague=team?.league||state.selectedLeague||"Нижняя лига";
      p=panel("Календарь матчей",activeLeague+" · сезон "+(state.seasonNumber||1));
      const leagueTeams=(Array.isArray(leagueData?.teams)?leagueData.teams:[]).filter(item=>item.league===activeLeague).map(item=>({...item}));
      const template=leagueTeams.find(item=>item.name==="{teamName}");
      if(template){template.name=state.teamName||"Моя команда";template.coach=state.coachName||"Тренер";template.isUserTeam=true;}
      let userEntry=leagueTeams.find(item=>item.id===team?.id||item.isUserTeam);
      if(!userEntry){
        userEntry={id:team?.id||state.careerTeamId||"user-team",name:state.teamName||"Моя команда",league:activeLeague,isUserTeam:true};
        leagueTeams.push(userEntry);
      }
      const stableTeams=leagueTeams.slice(0,6);
      const teamSignature=stableTeams.map(item=>String(item.id)+":"+String(item.name)).sort().join("|");
      const calendarKey="S"+(state.seasonNumber||1)+"::"+activeLeague+"::"+teamSignature;
      state.seasonCalendars=state.seasonCalendars||{};
      const shuffle=(items)=>{for(let i=items.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[items[i],items[j]]=[items[j],items[i]];}return items;};
      const generateCalendar=()=>{
        const participants=shuffle(stableTeams.map(item=>({id:String(item.id),name:item.name,isUserTeam:Boolean(item.isUserTeam)})));
        const rotating=participants.slice();const baseRounds=[];
        for(let round=0;round<participants.length-1;round++){
          const pairings=[];
          for(let j=0;j<participants.length/2;j++){
            const first=rotating[j],second=rotating[rotating.length-1-j];
            const flip=Math.random()<0.5;
            pairings.push({home:flip?first:second,away:flip?second:first});
          }
          baseRounds.push(pairings);
          const fixed=rotating[0];const rest=rotating.slice(1);rest.unshift(rest.pop());rotating.splice(0,rotating.length,fixed,...rest);
        }
        const rounds=[];
        for(let leg=0;leg<4;leg++){
          const order=shuffle(baseRounds.map((matches,index)=>({matches,index})));
          order.forEach(({matches})=>{
            const fixtures=matches.map((pair,index)=>{
              const reverse=leg%2===1;
              const home=reverse?pair.away:pair.home,away=reverse?pair.home:pair.away;
              const meeting=leg+1;
              const fixtureId="S"+(state.seasonNumber||1)+"-"+activeLeague.replace(/\s+/g,"-")+"-"+[home.id,away.id].sort().join("-")+"-"+meeting;
              const roundNumber=rounds.length+1;
              return {fixtureId,round:roundNumber,gameDay:getMatchDayForRound(roundNumber),leg:leg+1,homeTeamId:home.id,homeTeamName:home.name,awayTeamId:away.id,awayTeamName:away.name,homeIsUser:Boolean(home.isUserTeam),awayIsUser:Boolean(away.isUserTeam)};
            });
            rounds.push(fixtures);
          });
        }
        return {seasonNumber:Number(state.seasonNumber||1),league:activeLeague,teamSignature,generatedAt:new Date().toISOString(),rounds};
      };
      let calendar=state.seasonCalendars[calendarKey];
      if(!calendar||calendar.teamSignature!==teamSignature||calendar.rounds?.length!==20){
        calendar=generateCalendar();state.seasonCalendars[calendarKey]=calendar;saveState();
      }
      let calendarDatesChanged=false;
      calendar.rounds.forEach((fixtures,index)=>fixtures.forEach(fixture=>{const expectedDay=getMatchDayForRound(index+1);if(Number(fixture.gameDay)!==expectedDay){fixture.gameDay=expectedDay;calendarDatesChanged=true;}}));
      if(calendarDatesChanged){state.seasonCalendars[calendarKey]=calendar;saveState();}
      const ownFixtures=calendar.rounds.map((fixtures,index)=>({round:index+1,gameDay:getMatchDayForRound(index+1),fixture:fixtures.find(item=>item.homeIsUser||item.awayIsUser)})).filter(item=>item.fixture);
      const officialMatches=Array.isArray(state.careerHistory?.officialMatches)?state.careerHistory.officialMatches:[];
      const list=document.createElement("div");list.className="season-fixture-list";
      const completed=ownFixtures.filter(item=>officialMatches.some(match=>match.fixtureId===item.fixture.fixtureId)).length;
      const testCompleted=ownFixtures.filter(item=>(state.completedFixtures||[]).includes(item.fixture.fixtureId)&&!officialMatches.some(match=>match.fixtureId===item.fixture.fixtureId)).length;
      const firstUnplayedRound=ownFixtures.find(item=>!officialMatches.some(match=>match.fixtureId===item.fixture.fixtureId)&&!(state.completedFixtures||[]).includes(item.fixture.fixtureId))?.round;
      const summary=document.createElement("div");summary.className="cabinet-metrics season-fixture-summary";
      [["Матчей в сезоне",String(ownFixtures.length)],["Официально завершено",String(completed)],["Тестово пройдено",String(testCompleted)],["Не сыграно",String(Math.max(0,ownFixtures.length-completed-testCompleted))]].forEach(([label,value])=>{const card=document.createElement("div");card.className="cabinet-metric";card.append(safeText("small",label),safeText("b",value));summary.append(card);});
      p.append(summary);
      const todaysFixture=getCurrentOfficialFixture();
      const currentFixtureIsCompleted=Boolean(todaysFixture&&((state.completedFixtures||[]).includes(todaysFixture.fixtureId)||officialMatches.some(match=>match.fixtureId===todaysFixture.fixtureId)));
      if(todaysFixture&&!currentFixtureIsCompleted)p.append(makeMatchPreviewPanel(todaysFixture));
      if(lastMatchPreview&&todaysFixture&&lastMatchPreview.fixtureId===todaysFixture.fixtureId)p.append(makeMatchPreviewResult(lastMatchPreview));
      const title=safeText("h3","Календарь сезона");title.className="season-fixture-heading";p.append(title);
      ownFixtures.forEach(({round,gameDay,fixture})=>{
        const row=document.createElement("article");row.className="season-fixture-row"+(fixture.homeIsUser||fixture.awayIsUser?" is-user-fixture":"");
        const roundLabel=safeText("span","Тур "+round+" · День "+gameDay);roundLabel.className="season-fixture-round";
        const matchup=document.createElement("div");matchup.className="season-fixture-matchup";
        matchup.append(safeText("b",fixture.homeTeamName),safeText("span","—"),safeText("b",fixture.awayTeamName));
        const result=officialMatches.find(match=>match.fixtureId===fixture.fixtureId);
        const locallyCompleted=(state.completedFixtures||[]).includes(fixture.fixtureId);const status=safeText("span",result?(Number(result.goalsFor||0)+":"+Number(result.goalsAgainst||0)):(locallyCompleted?"Сыгран · без протокола":(round===firstUnplayedRound?"Следующий":"Предстоит")));
        status.className="season-fixture-status"+(result?" is-played":"");
        row.append(roundLabel,matchup,status);list.append(row);
      });
      p.append(list);
      p.append(safeText("p","Сезон длится 182 игровых дня. Матчи 1–10 назначены на дни 7–70 с недельным интервалом; затем идут 31 день каникул, после которых матчи проходят в дни 108–171 с недельным интервалом. Результаты появятся только после подключения официального протокола матча.","muted"));
    } else {
      p=panel("Карьера тренера","Постоянная история тренера и команды. Официальная статистика будет расти только от завершённых официальных матчей.");
      const grid=document.createElement("div");grid.className="cabinet-metrics";
      const history=state.careerHistory||{officialMatches:[],seasons:{}};
      const officialMatches=Array.isArray(history.officialMatches)?history.officialMatches:[];
      const totals=officialMatches.reduce((a,m)=>{a.played++;a.wins+=m.result==="W"?1:0;a.draws+=m.result==="D"?1:0;a.losses+=m.result==="L"?1:0;a.gf+=Number(m.goalsFor||0);a.ga+=Number(m.goalsAgainst||0);return a;},{played:0,wins:0,draws:0,losses:0,gf:0,ga:0});
      [["Текущий сезон","Сезон "+(state.seasonNumber||1)],["Официальные матчи",String(totals.played)],["Победы / ничьи / поражения",totals.wins+" / "+totals.draws+" / "+totals.losses],["Забито / пропущено",totals.gf+" / "+totals.ga],["Опыт аккаунта",(state.xp||0)+" XP"],["Постоянный рейтинг",String(state.permanentRating||0)],["ID тренера",(state.careerCoachId||"не создан").slice(0,8)],["ID команды",(state.careerTeamId||"не создан").slice(0,8)]].forEach(([label,value])=>{const card=document.createElement("div");card.className="cabinet-metric";card.append(safeText("small",label),safeText("b",value));grid.append(card);});
      p.append(grid);
      const note=safeText("p","Важно: тестовые матчи на странице «Тестовая игра» не попадают в официальную статистику. Сейчас результаты официальных матчей ещё не подключены к серверному архиву, поэтому показатели останутся нулевыми, пока не будет подключён защищённый серверный протокол.","muted");
      p.append(note);
      const seasons=Object.values(history.seasons||{}).sort((a,b)=>(a.seasonNumber||0)-(b.seasonNumber||0));
      if(seasons.length){const list=document.createElement("div");list.className="cabinet-roster";seasons.forEach(season=>{const row=document.createElement("div");row.className="cabinet-roster-row";row.append(safeText("b","Сезон "+season.seasonNumber),safeText("span",(season.teamName||state.teamName)+" · место: "+(season.finalPlace??"—")+" · матчи: "+(season.played||0)));list.append(row);});p.append(list);}
      else p.append(safeText("p","Архив сезонов пока пуст. История будет сохраняться отдельно и не будет обнуляться при начале нового сезона или смене клуба.","muted"));
    }
    body.append(p);tabs.querySelectorAll("button").forEach(button=>{const active=button.dataset.cabinetTab===key;button.classList.toggle("active",active);button.setAttribute("aria-selected",String(active));});
  };
  options.forEach(([key,label])=>{const button=document.createElement("button");button.type="button";button.className="cabinet-tab";button.dataset.cabinetTab=key;button.textContent=label;button.setAttribute("role","tab");button.addEventListener("click",()=>renderTab(key));tabs.append(button);});
  wrap.append(tabs,body);renderTab("overview");return wrap;
}

function placeholder(message) {
  const box = document.createElement("div"); box.className = "placeholder"; box.textContent = message; return box;
}

function getNextRelationshipThreshold(relation) {
  return [50,60,70,80,90].find(value => relation < value) ?? null;
}

function makeRelationsList(team, roster, onPlayerClick) {
  const list=document.createElement("div");list.className="cabinet-roster relationship-roster";
  roster.forEach((player,i)=>{
    const relation=getPlayerRelation(team,player);
    const next=getNextRelationshipThreshold(relation);
    const row=document.createElement("button");row.type="button";row.className="cabinet-roster-row relationship-roster-row";
    const img=document.createElement("img");img.src=getPortrait(player.portraitIndex||teamsPlayerIndex(team,player));img.alt="";img.loading="lazy";img.onerror=()=>img.remove();
    const info=document.createElement("span");info.className="cabinet-roster-info";
    info.append(safeText("b",player.name),safeText("small",player.position+" · "+player.nationality));
    const progress=document.createElement("span");progress.className="relationship-next-step";
    progress.textContent=next===null?"Все пороги достигнуты":("Следующий порог: "+next+"% · осталось "+(next-relation)+" п. п.");
    info.append(progress);
    row.append(img,info,makeRelationBadge(team,player));
    row.addEventListener("click",()=>onPlayerClick(player,i));
    list.append(row);
  });
  return list;
}

function renderUpbringing() {
  const wrap=document.createElement("div");
  const team=getUserTeam();
  const roster=team?.players||[];
  const panel=document.createElement("section");panel.className="cabinet-panel";
  panel.append(safeText("h2","Отношения с футболистами"),safeText("p","Следи за доверием каждого игрока и смотри, какие пороги характеристик ещё впереди.","muted"));
  const avg=roster.length?Math.round(roster.reduce((sum,player)=>sum+getPlayerRelation(team,player),0)/roster.length):0;
  const reached=roster.reduce((sum,player)=>sum+[50,60,70,80,90].filter(value=>getPlayerRelation(team,player)>=value).length,0);
  const metrics=document.createElement("div");metrics.className="cabinet-metrics relationship-summary";
  [["Игроков в составе",String(roster.length)],["Средний уровень отношений",avg+"%"],["Достигнутые пороги",String(reached)+" / "+(roster.length*5)]].forEach(([label,value])=>{const card=document.createElement("div");card.className="cabinet-metric";card.append(safeText("small",label),safeText("b",value));metrics.append(card);});
  panel.append(metrics);
  if(roster.length) {
    panel.append(makeRelationsList(team,roster,(player,i)=>openPlayerProfile(team,player,i)));
    panel.append(safeText("p","Пороги: 50%, 60%, 70% и 80% открывают характеристики; 90% — потенциал. Просмотр профиля не меняет отношения. Начисление отношений будет подключено после согласования игровых действий.","muted"));
  } else panel.append(placeholder("Сначала сформируй состав команды — тогда здесь появятся отношения с футболистами."));
  wrap.append(panel);
  return wrap;
}
function openPage(key) {
  const page = pages[key]; if (!page) return;
  $("dashboard").classList.add("hidden"); $("pageView").classList.remove("hidden");
  $("pageTitle").textContent = page.title; $("pageEyebrow").textContent = page.eyebrow;
  const content = $("pageContent"); content.replaceChildren();
  const rendered = page.render(); if (rendered) content.append(rendered);
}
document.querySelectorAll("[data-page]").forEach(button => button.addEventListener("click", () => openPage(button.dataset.page)));
$("openCabinet").addEventListener("click", () => openPage("cabinet"));
$("backHome").addEventListener("click", () => { $("pageView").classList.add("hidden"); $("dashboard").classList.remove("hidden"); });

function makeCareerId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 14);
}
function ensureCareerIdentity() {
  if (!state.coachName || !state.teamName) return;
  let changed=false;
  if (!state.careerCoachId) { state.careerCoachId=makeCareerId(); changed=true; }
  if (!state.careerTeamId) { state.careerTeamId=makeCareerId(); changed=true; }
  if (!state.careerPlayerIds || typeof state.careerPlayerIds!=="object") { state.careerPlayerIds={}; changed=true; }
  if (!state.careerHistory || typeof state.careerHistory!=="object") { state.careerHistory={officialMatches:[],seasons:{}}; changed=true; }
  if (!Array.isArray(state.careerHistory.officialMatches)) { state.careerHistory.officialMatches=[]; changed=true; }
  if (!state.careerHistory.seasons || typeof state.careerHistory.seasons!=="object") { state.careerHistory.seasons={}; changed=true; }
  if (leagueData) {
    leagueData.teams.forEach(team=>{
      (team.players||[]).forEach((player,index)=>{
        const key=team.id+"::"+index;
        if (player.careerId) {
          if (state.careerPlayerIds[key]!==player.careerId) { state.careerPlayerIds[key]=player.careerId; changed=true; }
        } else {
          if (!state.careerPlayerIds[key]) { state.careerPlayerIds[key]=makeCareerId(); changed=true; }
          player.careerId=state.careerPlayerIds[key];
        }
      });
    });
  }
  if (changed) saveState();
}
function getUserTeam() {
  if (!leagueData) return null;
  const team = leagueData.teams.find(t => t.isUserTeam || t.name === "{teamName}");
  if (!team) return null;
  // Возвращаем представление пользовательской команды, не меняя общий справочник лиги.
  // Иначе шаблон {teamName} теряется и календарь перестаёт распознавать матчи пользователя.
  return {
    ...team,
    name: state.teamName || "Моя команда",
    coach: state.coachName || "Тренер",
    isUserTeam: true,
    players: team.players || []
  };
}
function getPortrait(index) { return "/images/portretplayers/portret" + (((index - 1) % 50) + 1) + ".jpg"; }
function getFlag(nationality) {
  const flags = {"Россия":"russia","Беларусь":"belarus","Индия":"india","Казахстан":"kazahstan","Кыргызстан":"kirgizstan","Узбекистан":"uzbekistan","Вьетнам":"vietnam","Южная Корея":"southkorea"};
  return flags[nationality] ? "/images/flags/" + flags[nationality] + ".jpg" : "";
}
function safeText(tag, text, cls) { const el = document.createElement(tag); if (cls) el.className = cls; el.textContent = text ?? ""; return el; }

function playerRelationKey(team,p) { return String(team.id || team.name) + "::" + String(p.name); }
function getPlayerRelation(team,p) {
  const value = Number(state.relationships?.[playerRelationKey(team,p)] || 0);
  return Math.max(0,Math.min(100,value));
}
function getUnlockedSkills(p,relation) {
  const order = [p.position,"ВР","ЗЩ","ПЗ","НП"].filter((key,index,arr) => ["ВР","ЗЩ","ПЗ","НП"].includes(key) && arr.indexOf(key)===index);
  const unlocked=[];
  if(relation>=50) unlocked.push(order[0]);
  if(relation>=60) unlocked.push(order[1]);
  if(relation>=70) unlocked.push(order[2]);
  if(relation>=80) ["ВР","ЗЩ","ПЗ","НП"].forEach(key=>{if(!unlocked.includes(key))unlocked.push(key);});
  return unlocked;
}
function makeRelationBadge(team,p) {
  const relation=getPlayerRelation(team,p);
  const box=document.createElement("div");box.className="player-relationship";
  const top=document.createElement("div");top.className="relationship-labels";
  top.append(safeText("span","Отношения с тренером"),safeText("b",relation+"%"));
  const track=document.createElement("div");track.className="relationship-track";
  const fill=document.createElement("div");fill.className="relationship-fill";fill.style.width=relation+"%";
  track.append(fill);box.append(top,track);return box;
}
function makePlayerSkillSummary(team,p) {
  const unlocked=getUnlockedSkills(p,getPlayerRelation(team,p));
  const stats=document.createElement("div");stats.className="player-card-stats";
  ["ВР","ЗЩ","ПЗ","НП"].forEach(key=>{
    const known=unlocked.includes(key);
    stats.append(safeText("span",known?key+" "+p.skills[key]:key+" ???",known?"skill-known":"skill-hidden"));
  });
  return stats;
}

function makeTeamRoster(team) {
  const wrap = document.createElement("div"); wrap.className = "roster-view";
  const header = document.createElement("div"); header.className = "team-detail-head";
  if (team.logo) { const img = document.createElement("img"); img.src="/images/logoteams/"+team.logo+".jpg"; img.alt="Эмблема "+team.name; img.className="team-logo-large"; img.onerror=()=>img.remove(); header.append(img); }
  const title = document.createElement("div"); title.append(safeText("h2",team.name), safeText("p","Тренер: "+team.coach), safeText("p",team.league+" · "+team.players.length+" футболистов"));
  header.append(title); wrap.append(header);
  if(team.chant) { const chant=document.createElement("blockquote"); chant.className="team-chant"; chant.textContent="«"+team.chant+"»"; wrap.append(chant); }
  const grid=document.createElement("div"); grid.className="player-cards-grid";
  team.players.forEach((p,i)=>{
    const card=document.createElement("button"); card.type="button"; card.className="player-card"; card.addEventListener("click",()=>openPlayerProfile(team,p,i));
    const img=document.createElement("img"); img.src=getPortrait(p.portraitIndex || teamsPlayerIndex(team,p)); img.alt=p.name; img.loading="lazy"; img.onerror=()=>{img.style.display="none"};
    const info=document.createElement("div"); info.className="player-card-info"; info.append(safeText("b",p.name),safeText("small",p.position+" · "+p.nationality+" · "+getPlayerAge(p,team.id)+" лет"));
    const stats=makePlayerSkillSummary(team,p);
    card.append(img,info,makeRelationBadge(team,p),stats); grid.append(card);
  });
  wrap.append(grid); return wrap;
}
function teamsPlayerIndex(team,p) { let n=1; if(leagueData) for(const t of leagueData.teams){for(const x of t.players){if(t.id===team.id && x.name===p.name)return n;n++;}} return n; }
function renderPlayers() {
  const wrap=document.createElement("div");
  if(!leagueData){wrap.append(placeholder("Загружаю составы команд…"));return wrap;}
  const controls=document.createElement("div"); controls.className="filter-row";
  const select=document.createElement("select"); select.className="league-select"; select.setAttribute("aria-label","Выбрать команду");
  leagueData.teams.forEach(t=>{const o=document.createElement("option");o.value=t.id;o.textContent=(t.name==="{teamName}"?state.teamName:t.name)+" — "+t.league;o.selected=t.id===(getUserTeam()?.id);select.append(o);});
  const detail=document.createElement("div"); detail.className="team-roster-container";
  const show=()=>{const t=leagueData.teams.find(x=>x.id===select.value); if(t){const display={...t,name:t.name==="{teamName}"?state.teamName:t.name,coach:t.coach==="(имя тренера)"?state.coachName:t.coach};detail.replaceChildren(makeTeamRoster(display));}};
  select.addEventListener("change",show); controls.append(select); wrap.append(controls,detail); show(); return wrap;
}
function renderLeague() {
  const wrap=document.createElement("div"); if(!leagueData){wrap.append(placeholder("Загружаю данные лиг…"));return wrap;}
  wrap.append(safeText("p","Сезон 1 · 6 команд в каждой лиге · 20 матчей за сезон","muted"));
  const tabs=document.createElement("div");tabs.className="league-tabs";
  const content=document.createElement("div");
  const renderOne=(leagueName)=>{
    content.replaceChildren();
    const teams=leagueData.teams.filter(t=>t.league===leagueName);
    const table=document.createElement("div");table.className="league-table";
    const head=document.createElement("div");head.className="league-table-row league-table-head";
    ["#","Эмб.","Команда","И","В","Н","П","Мячи","О"].forEach(v=>head.append(safeText("span",v)));table.append(head);
    const sorted=teams.map(t=>({...t,displayName:t.name==="{teamName}"?state.teamName:t.name})).sort((a,b)=>a.name.localeCompare(b.name,"ru"));
    sorted.forEach((t,i)=>{
      const row=document.createElement("button");row.type="button";row.className="league-table-row";row.addEventListener("click",()=>{openPage("players");setTimeout(()=>{const sel=document.querySelector(".league-select");if(sel){sel.value=t.id;sel.dispatchEvent(new Event("change"));}},0);});
      const logo=document.createElement("img");logo.className="league-mini-logo";if(t.logo){logo.src="/images/logoteams/"+t.logo+".jpg";logo.alt="";}else{logo.remove();}
      row.append(safeText("span",String(i+1)),logo,safeText("span",t.displayName),safeText("span","0"),safeText("span","0"),safeText("span","0"),safeText("span","0"),safeText("span","0:0"),safeText("b","0"));table.append(row);
    });
    const note=safeText("p",leagueName==="Верхняя лига"?"Первые 3 команды получат просмотр агентов; последние 2 перейдут в Нижнюю лигу.":"Первые 2 команды перейдут в Верхнюю лигу.","league-note");
    content.append(table,note);
  };
  ["Верхняя лига","Нижняя лига"].forEach(name=>{const b=document.createElement("button");b.type="button";b.className="league-tab"+(name==="Нижняя лига"?" active":"");b.textContent=name;b.addEventListener("click",()=>{tabs.querySelectorAll("button").forEach(x=>x.classList.remove("active"));b.classList.add("active");renderOne(name);});tabs.append(b);});
  wrap.append(tabs,content);renderOne("Нижняя лига");return wrap;
}
function openPlayerProfile(team,p,index) {
  const wrap=document.createElement("div");wrap.className="player-profile";
  const portrait=document.createElement("img");portrait.className="player-profile-portrait";portrait.src=getPortrait(p.portraitIndex || teamsPlayerIndex(team,p));portrait.alt=p.name;
  const head=document.createElement("div");head.className="player-profile-head";head.append(portrait);
  const bio=document.createElement("div");
  const teamName=team.name===" {teamName}"||team.name==="{teamName}"?state.teamName:team.name;
  bio.append(safeText("h2",p.name),safeText("p",teamName,"player-team-name"),safeText("p","Возраст: "+getPlayerAge(p,team.id)+" лет · День рождения: День "+(p.birthdayDayOfYear||getStablePlayerBirthData(p,team.id).birthdayDayOfYear)+" игрового года","muted"));
  const nation=document.createElement("div");nation.className="player-nationality";const flag=getFlag(p.nationality);if(flag){const f=document.createElement("img");f.src=flag;f.alt="";nation.append(f);}nation.append(safeText("span",p.nationality+" · "+p.position));
  bio.append(nation,safeText("p","Тренер: "+(team.coach==="(имя тренера)"?state.coachName:team.coach),"muted"));head.append(bio);wrap.append(head);
  const relation=getPlayerRelation(team,p);
  wrap.append(makeRelationBadge(team,p));
  const tabs=document.createElement("div");tabs.className="player-profile-tabs";tabs.setAttribute("role","tablist");
  const body=document.createElement("div");body.className="player-profile-tab-content";
  const tabItems=[["player","Футболист"],["training","Тренировка"],["relations","Отношения"],["career","Карьера"]];
  const renderTab=(key)=>{
    body.replaceChildren();
    tabs.querySelectorAll("button").forEach(b=>{const active=b.dataset.tab===key;b.classList.toggle("active",active);b.setAttribute("aria-selected",String(active));});
    if(key==="player"){
      const stats=document.createElement("div");stats.className="skill-bars";
      const unlocked=getUnlockedSkills(p,relation);
      ["ВР","ЗЩ","ПЗ","НП"].forEach(k=>{
        const known=unlocked.includes(k);const line=document.createElement("div");line.className="skill-line"+(known?"":" skill-line-locked");
        line.append(safeText("span",k),safeText("b",known?String(p.skills[k]):"???"));
        if(known){const track=document.createElement("div");track.className="skill-track";const fill=document.createElement("div");fill.className="skill-fill";fill.style.width=Math.max(0,Math.min(100,p.skills[k]))+"%";track.append(fill);line.append(track);}
        else line.append(safeText("small","Откроется при росте отношений"));
        stats.append(line);
      });
      body.append(safeText("h3","Игровые характеристики"),stats);
      if(relation<50)body.append(safeText("p","При 50% отношений откроется главная характеристика по позиции футболиста.","muted"));
      else if(relation<80)body.append(safeText("p","Следующие скрытые характеристики открываются при достижении 60%, 70% и 80% отношений.","muted"));
      if(relation>=90)body.append(safeText("p","Порог потенциала достигнут. Значение потенциала пока не задано в игровых данных.","muted"));
      else body.append(safeText("p","Потенциал откроется при 90% отношений. Само раскрытие не повышает навыки.","muted"));
    } else if(key==="training"){
      body.append(safeText("h3","Развитие футболиста"),placeholder("Индивидуальные тренировки и история изменения характеристик будут доступны после реализации тренировочной механики."));
    } else if(key==="relations"){
      body.append(safeText("h3","Отношения с тренером"),makeRelationBadge(team,p));
      const next=relation<50?50:relation<60?60:relation<70?70:relation<80?80:relation<90?90:null;
      body.append(safeText("p",next===null?"Все пороги отношений достигнуты.":"До следующего порога: "+(next-relation)+" п. п. — "+next+"%.","muted"));
      const thresholds=document.createElement("div");thresholds.className="relationship-thresholds";
      [[50,"Главная характеристика"],[60,"Вторая характеристика"],[70,"Третья характеристика"],[80,"Все характеристики"],[90,"Потенциал"]].forEach(([value,label])=>{
        const item=document.createElement("div");item.className="relationship-threshold"+(relation>=value?" reached":"");
        item.append(safeText("b",value+"%"),safeText("span",label));thresholds.append(item);
      });
      body.append(thresholds);
    } else {
      body.append(safeText("h3","История карьеры"),placeholder("История команд, сезонов, переходов и достижений появится по мере реализации и заполнения карьерных данных."));
    }
  };
  tabItems.forEach(([key,label])=>{const b=document.createElement("button");b.type="button";b.className="player-profile-tab";b.dataset.tab=key;b.setAttribute("role","tab");b.textContent=label;b.addEventListener("click",()=>renderTab(key));tabs.append(b);});
  wrap.append(tabs,body);
  const back=document.createElement("button");back.className="back-button";back.textContent="← К составу";back.addEventListener("click",()=>{openPage("cabinet");setTimeout(()=>{const tab=[...document.querySelectorAll(".cabinet-tab")].find(b=>b.textContent.trim()==="Футболисты");if(tab)tab.click();},0);});wrap.append(back);
  $("pageTitle").textContent=p.name;$("pageEyebrow").textContent="КАРТОЧКА ФУТБОЛИСТА";const content=$("pageContent");content.replaceChildren(wrap);renderTab("player");
}
function trainingPlayerKey(team,player,index) {
  return String(player.careerId || playerRelationKey(team,player) || (team.id+"::"+index));
}
function getTrainingCooldown(playerKey) {
  const last=Number(state.individualTraining?.[playerKey]?.lastAt||0);
  return Math.max(0,4*60*60*1000-(Date.now()-last));
}
function formatCooldown(milliseconds) {
  const total=Math.ceil(milliseconds/1000);
  const hours=Math.floor(total/3600);
  const minutes=Math.floor((total%3600)/60);
  const seconds=total%60;
  return [hours,minutes,seconds].map(v=>String(v).padStart(2,"0")).join(":");
}
function renderTraining() {
  const wrap=document.createElement("div");
  const team=getUserTeam();
  const roster=team?.players||[];
  const panel=document.createElement("section");panel.className="cabinet-panel training-panel";
  panel.append(safeText("h2","Индивидуальная тренировка"),safeText("p","Выбери футболиста и характеристику. За успешное занятие характеристика повышается на 1 пункт.","muted"));
  if(!roster.length) {
    panel.append(placeholder("Сначала загрузи состав команды — тогда можно будет проводить тренировки."));
    wrap.append(panel);return wrap;
  }
  const form=document.createElement("div");form.className="training-form";
  const playerLabel=safeText("label","Футболист");playerLabel.htmlFor="trainingPlayer";
  const playerSelect=document.createElement("select");playerSelect.id="trainingPlayer";playerSelect.className="league-select";
  roster.forEach((player,i)=>{const option=document.createElement("option");option.value=String(i);option.textContent=player.name+" · "+player.position;playerSelect.append(option);});
  const skillLabel=safeText("label","Характеристика");skillLabel.htmlFor="trainingSkill";
  const skillSelect=document.createElement("select");skillSelect.id="trainingSkill";skillSelect.className="league-select";
  const info=document.createElement("div");info.className="training-player-summary";
  const status=safeText("p","","training-status");status.setAttribute("aria-live","polite");
  const trainButton=document.createElement("button");trainButton.type="button";trainButton.className="primary-button";trainButton.textContent="Провести тренировку";
  const refreshSkillOptions=()=>{
    const player=roster[Number(playerSelect.value)]||roster[0];
    skillSelect.replaceChildren();
    ["ВР","ЗЩ","ПЗ","НП"].forEach(key=>{
      const option=document.createElement("option");option.value=key;
      const value=Number(player.skills?.[key]||0);
      option.textContent=key+" · "+(getUnlockedSkills(player,getPlayerRelation(team,player)).includes(key)?(value>=100?"максимум 100":"значение "+value):(value>=100?"недоступно":"скрытая характеристика"));
      option.disabled=value>=100;
      skillSelect.append(option);
    });
    const firstAvailable=[...skillSelect.options].find(option=>!option.disabled);
    if(firstAvailable) skillSelect.value=firstAvailable.value;
    updatePlayerSummary();
  };
  const updatePlayerSummary=()=>{
    const player=roster[Number(playerSelect.value)]||roster[0];
    const key=trainingPlayerKey(team,player,Number(playerSelect.value));
    const relation=getPlayerRelation(team,player);
    const remaining=getTrainingCooldown(key);
    const img=document.createElement("img");img.src=getPortrait(player.portraitIndex||teamsPlayerIndex(team,player));img.alt="";img.onerror=()=>img.remove();
    const copy=document.createElement("div");copy.className="training-player-copy";
    copy.append(safeText("b",player.name),safeText("span",player.position+" · "+player.nationality),safeText("span","Отношения: "+relation+"%"));
    const known=getUnlockedSkills(player,relation);
    const skillGrid=document.createElement("div");skillGrid.className="training-skill-preview";
    ["ВР","ЗЩ","ПЗ","НП"].forEach(stat=>{
      const value=Number(player.skills?.[stat]||0);
      skillGrid.append(safeText("span",known.includes(stat)?stat+" "+value:stat+" ???",known.includes(stat)?"skill-known":"skill-hidden"));
    });
    info.replaceChildren();info.append(img,copy,skillGrid);
    if(remaining>0){status.textContent="Следующая тренировка этого футболиста через "+formatCooldown(remaining)+".";trainButton.disabled=true;}
    else if([...skillSelect.options].every(option=>option.disabled)){status.textContent="Все характеристики достигли максимума 100.";trainButton.disabled=true;}
    else {status.textContent="Тренировка доступна. После занятия этот футболист будет ждать 4 часа до следующего.";trainButton.disabled=false;}
  };
  playerSelect.addEventListener("change",refreshSkillOptions);
  skillSelect.addEventListener("change",updatePlayerSummary);
  trainButton.addEventListener("click",()=>{
    const index=Number(playerSelect.value);
    const player=roster[index];if(!player)return;
    const key=trainingPlayerKey(team,player,index);
    if(getTrainingCooldown(key)>0){updatePlayerSummary();return;}
    const stat=skillSelect.value;
    const current=Number(player.skills?.[stat]);
    if(!Number.isFinite(current)||current<0||current>=100){status.textContent="Эту характеристику нельзя повысить дальше.";return;}
    if(!state.individualTraining||typeof state.individualTraining!=="object")state.individualTraining={};
    if(!state.trainingHistory||typeof state.trainingHistory!=="object")state.trainingHistory={};
    player.skills[stat]=Math.min(100,current+1);
    const now=Date.now();
    state.individualTraining[key]={lastAt:now};
    if(!Array.isArray(state.trainingHistory[key]))state.trainingHistory[key]=[];
    state.trainingHistory[key].push({at:now,stat,before:current,after:player.skills[stat],type:"individual"});
    saveState();
    status.textContent="Тренировка завершена: "+player.name+" — характеристика "+stat+" повышена на 1 пункт.";
    refreshSkillOptions();
    updatePlayerSummary();
    trainButton.disabled=true;
    status.textContent+=" Следующая тренировка этого футболиста будет доступна через 04:00:00.";
  });
  form.append(playerLabel,playerSelect,skillLabel,skillSelect,info,status,trainButton);
  panel.append(form,safeText("p","Правила: одна индивидуальная тренировка на футболиста раз в 4 часа; +1 к выбранной характеристике; максимальное значение — 100. Таймер сохраняется в этом браузере.","muted"));
  wrap.append(panel);
  refreshSkillOptions();
  return wrap;
}

if (!state.coachName || !state.teamName) showSetup();
else { $("onboarding").classList.add("hidden"); render(); }
if (leagueData) initializeCloudCareer();
else {
  const cloudInit = setInterval(() => {
    if (leagueData) { clearInterval(cloudInit); initializeCloudCareer(); }
  }, 250);
  setTimeout(() => clearInterval(cloudInit), 10000);
}
