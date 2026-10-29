const STORAGE_KEY = "football-coach-start-v1";
const defaultState = {
  coachName: "", teamName: "", emblem: "🛡️", teamLogoIndex: 1, avatarIndex: 1, seasonNumber: 1, avatarChangeUsedSeason: 0,
  xp: 0, permanentRating: 0, seasonRating: 0, respect: 0, gameDay: 1, players: [], relationships: {},
  careerCoachId: null, careerTeamId: null, careerPlayerIds: {}, careerHistory: { officialMatches: [], seasons: {} }
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
      return cloudRequest("POST", {
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
    }
    const result = await cloudRequest("GET");
    if (result.initialized) {
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
  $("gameDate").textContent = `День ${state.gameDay}`;
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
});

const pages = {
  cabinet: {title:"Кабинет тренера", eyebrow:"УПРАВЛЕНИЕ КОМАНДОЙ", render: renderCabinet},
  players: {title:"Футболисты", eyebrow:"СОСТАВ", render: renderPlayers},
  mail: {title:"Почта", eyebrow:"СООБЩЕНИЯ", render: () => placeholder("Новых сообщений пока нет.")},
  training: {title:"Тренировка", eyebrow:"РАЗВИТИЕ", render: renderTraining},
  upbringing: {title:"Воспитание", eyebrow:"ОТНОШЕНИЯ", render: () => placeholder("Раздел воспитания пока пустой. Позже добавим отношения, события и решения тренера.")},
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
      p=panel(key==="team"?"Футболисты команды":"Отношения с футболистами",key==="team"?"Состав вашей команды. Выберите игрока, чтобы открыть его профиль.":"Уровень доверия каждого игрока к тренеру.");
      const list=document.createElement("div");list.className="cabinet-roster";
      roster.forEach((player,i)=>{const row=document.createElement("button");row.type="button";row.className="cabinet-roster-row";const img=document.createElement("img");img.src=getPortrait(player.portraitIndex||teamsPlayerIndex(team,player));img.alt="";img.loading="lazy";img.onerror=()=>img.remove();const info=document.createElement("span");info.className="cabinet-roster-info";info.append(safeText("b",player.name),safeText("small",player.position+" · "+player.nationality));row.append(img,info);if(key==="relations")row.append(makeRelationBadge(team,player));else row.append(safeText("span","Открыть профиль","cabinet-row-action"));row.addEventListener("click",()=>openPlayerProfile(team,player,i));list.append(row);});
      p.append(list);
    } else if(key==="stats"){
      p=panel("Статистика команды","Сводка по составу на текущий момент.");const positions=["ВР","ЗЩ","ПЗ","НП"];const grid=document.createElement("div");grid.className="cabinet-metrics";
      [["Всего футболистов",String(roster.length)],...positions.map(pos=>["Позиция "+pos,String(roster.filter(player=>player.position===pos).length)]),["Средние отношения",roster.length?Math.round(roster.reduce((sum,player)=>sum+getPlayerRelation(team,player),0)/roster.length)+"%":"—"]].forEach(([label,value])=>{const card=document.createElement("div");card.className="cabinet-metric";card.append(safeText("small",label),safeText("b",value));grid.append(card);});
      p.append(grid,safeText("p","Игровая статистика, результаты и голы появятся по мере проведения матчей.","muted"));
    } else if(key==="table"){
      p=panel("Турнирная таблица",team?.league||state.selectedLeague||"Нижняя лига");
      p.append(safeText("p","Турнирная таблица появится после проведения матчей чемпионата. Сейчас результаты сезона ещё не сформированы.","muted"));
    } else if(key==="matches"){
      p=panel("Матчи команды","Ближайшие встречи и история результатов.");p.append(safeText("p","Когда начнётся сезон, здесь появятся ближайшие игры и результаты сыгранных матчей.","muted"));
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
  if (team) { team.name = state.teamName || "Моя команда"; team.coach = state.coachName || "Тренер"; }
  return team || null;
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
    stats.append(safeText("span",known?key+" "+p.skills[key]:key+" ···",known?"skill-known":"skill-hidden"));
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
    const info=document.createElement("div"); info.className="player-card-info"; info.append(safeText("b",p.name),safeText("small",p.position+" · "+p.nationality));
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
  const bio=document.createElement("div");bio.append(safeText("h2",p.name),safeText("p",team.name===" {teamName}"?state.teamName:(team.name==="{teamName}"?state.teamName:team.name),"player-team-name"));
  const nation=document.createElement("div");nation.className="player-nationality";const flag=getFlag(p.nationality);if(flag){const f=document.createElement("img");f.src=flag;f.alt="";nation.append(f);}nation.append(safeText("span",p.nationality+" · "+p.position));bio.append(nation,safeText("p","Тренер: "+(team.coach==="(имя тренера)"?state.coachName:team.coach),"muted"));head.append(bio);wrap.append(head);
  wrap.append(makeRelationBadge(team,p));
  const stats=document.createElement("div");stats.className="skill-bars";
  const relation=getPlayerRelation(team,p);const unlocked=getUnlockedSkills(p,relation);
  ["ВР","ЗЩ","ПЗ","НП"].forEach(k=>{
    const known=unlocked.includes(k);const line=document.createElement("div");line.className="skill-line"+(known?"":" skill-line-locked");
    line.append(safeText("span",k),safeText("b",known?String(p.skills[k]):"Скрыто"));
    if(known){const track=document.createElement("div");track.className="skill-track";const fill=document.createElement("div");fill.className="skill-fill";fill.style.width=Math.max(0,Math.min(100,p.skills[k]))+"%";track.append(fill);line.append(track);}
    else line.append(safeText("small", "Откроется при росте отношений"));
    stats.append(line);
  });
  wrap.append(stats);
  if(relation<50)wrap.append(safeText("p","При 50% отношений откроется показатель по позиции футболиста.","muted"));
  else if(relation<80)wrap.append(safeText("p","Новые характеристики открываются при 60%, 70% и 80% отношений.","muted"));
  if(relation>=90)wrap.append(safeText("p","Потенциал пока неизвестен.","muted"));
  else wrap.append(safeText("p","Потенциал откроется при 90% отношений.","muted"));
  const back=document.createElement("button");back.className="back-button";back.textContent="← К составу";back.addEventListener("click",()=>openPage("players"));wrap.append(back);
  $("pageTitle").textContent=p.name;$("pageEyebrow").textContent="КАРТОЧКА ФУТБОЛИСТА";const content=$("pageContent");content.replaceChildren(wrap);
}
function renderTraining() {
  const wrap = document.createElement("div");
  wrap.append(placeholder("Тренировочные занятия скоро станут доступны."));
  return wrap;
}

if (!state.coachName || !state.teamName) showSetup();
else { $("onboarding").classList.add("hidden"); render(); }
