const STORAGE_KEY = "football-coach-start-v1";
const defaultState = {
  coachName: "", teamName: "", emblem: "🛡️", teamLogoIndex: 1, avatarIndex: 1, seasonNumber: 1, avatarChangeUsedSeason: 0,
  xp: 0, permanentRating: 0, seasonRating: 0, respect: 0, gameDay: 1, players: [], relationships: {},
  careerCoachId: null, careerTeamId: null, careerPlayerIds: {}, careerHistory: { officialMatches: [], seasons: {} }
};
let state = loadState();
let leagueData = null;
fetch("/data/league.json").then(r => { if (!r.ok) throw new Error("Не удалось загрузить данные лиги"); return r.json(); }).then(data => { leagueData = data; if (state.coachName && state.teamName) render(); if (!$("pageView")?.classList.contains("hidden") && $("pageTitle")?.textContent === "Тренировка") openPage("training"); }).catch(err => console.error(err));

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
  $("gameDate").textContent = calendarDateText();
  const nextRound = Array.from({length:20},(_,i)=>i+1).find(r=>officialRoundDay(r)>Number(state.gameDay||1)||(officialRoundDay(r)===Number(state.gameDay||1)&&!canAdvanceCoachDay()));
  const nextMatch = $("nextMatchDate"); if(nextMatch) nextMatch.textContent = nextRound ? "День "+officialRoundDay(nextRound) : "Сезон завершён";
  const skipDay = $("skipDayButton"); if(skipDay) skipDay.textContent = Number(state.gameDay)>=182 ? "НАЧАТЬ НОВЫЙ СЕЗОН" : "ПРОПУСТИТЬ ДЕНЬ";
  $("rosterCount").textContent = getUserTeam()?.players?.length || state.players.length || 10;
  const todayRound=officialRoundForDay(Number(state.gameDay)||1),todayFixture=currentOfficialFixture(),todayKey=todayRound&&todayFixture?roundFixtureKey(todayRound,todayFixture):null;
  const startMatchButton=$("startMatchButton");
  if(startMatchButton){const due=Boolean(todayRound&&todayFixture&&!state.leagueResults?.[todayKey]);startMatchButton.classList.toggle("hidden",!due);startMatchButton.textContent=due?"НАЧАТЬ МАТЧ · ТУР "+todayRound:"НАЧАТЬ МАТЧ";}
  $("xpValue").textContent = `${state.xp} XP`;
  $("permanentRating").textContent = state.permanentRating;
  $("seasonRating").textContent = state.seasonRating;
  $("respectValue").textContent = updateCoachRespect();
}

/* Фоновая музыка: случайный порядок без повторов до конца текущего круга.
   Браузеры требуют первого нажатия пользователя перед воспроизведением со звуком. */
let musicTracks = ["/music/footmusic1.mp3","/music/footmusic2.mp3","/music/footmusic3.mp3","/music/footmusic4.mp3","/music/footmusic5.mp3","/music/footmusic6.mp3","/music/footmusic7.mp3","/music/footmusic8.mp3"];
let musicTracksLoaded = false;
async function loadMusicTracksFromGitHub() {
  if (musicTracksLoaded) return;
  musicTracksLoaded = true;
  try {
    const response = await fetch("https://api.github.com/repos/penzinvv/futbolny-trener-nachalo/contents/music?ref=main");
    if (!response.ok) throw new Error("GitHub music listing unavailable");
    const files = await response.json();
    const tracks = files.filter(file => file.type === "file" && /\.mp3$/i.test(file.name))
      .map(file => "/music/" + encodeURIComponent(file.name));
    if (tracks.length) musicTracks = tracks;
  } catch (error) {
    console.warn("Не удалось обновить список музыки из GitHub; используется встроенный список.", error);
  }
  renderCoachChronicle();
}
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
  await loadMusicTracksFromGitHub();
  if (currentTrackIndex + 1 >= shuffledTracks.length) shuffleTracks();
  currentTrackIndex += 1;
  musicPlayer.src = shuffledTracks[currentTrackIndex];
  lastTrackPath = shuffledTracks[currentTrackIndex];
  try {
    await musicPlayer.play();
    musicToggle.textContent = "♫ Выключить радио";
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
    musicToggle.textContent = "♫ Включить радио";
    musicToggle.setAttribute("aria-pressed", "false");
    return;
  }
  musicEnabled = true;
  if (!shuffledTracks.length) shuffleTracks();
  // Разрешённый браузером запуск происходит непосредственно после нажатия кнопки.
  if (musicPlayer.src && musicPlayer.paused && currentTrackIndex >= 0) {
    try {
      await musicPlayer.play();
      musicToggle.textContent = "♫ Выключить радио";
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
  // The first cloud initialization must run after the player creates a coach and team.
  void initializeCloudCareer();
});

const pages = {
  cabinet: {title:"Кабинет тренера", eyebrow:"УПРАВЛЕНИЕ КОМАНДОЙ", render: renderCabinet},
  players: {title:"Футболисты", eyebrow:"СОСТАВ", render: renderPlayers},
  mail: {title:"Почта тренера", eyebrow:"СООБЩЕНИЯ И УВЕДОМЛЕНИЯ", render: renderCoachMail},
  training: {title:"Тренировка", eyebrow:"РАЗВИТИЕ", render: renderTraining},
  upbringing: {title:"Воспитание", eyebrow:"ОТНОШЕНИЯ", render: renderUpbringing},
  league: {title:"Календарь и матчи", eyebrow:"СЕЗОН · ОФИЦИАЛЬНЫЕ МАТЧИ", render: renderLeague},
  seasonCalendar: {title:"Календарь сезона", eyebrow:"КАЛЕНДАРЬ · ВСЕ 182 ДНЯ", render: renderSeasonCalendar},
  otherRoundMatches: {title:"Другие встречи", eyebrow:"СЕЗОН · РЕЗУЛЬТАТЫ ВСЕХ КОМАНД", render: renderOtherRoundMatches},
  match: {title:"Матч", eyebrow:"ОФИЦИАЛЬНЫЙ ТУР", render: renderMatchPage},
  matchSummary: {title:"Итоги встречи", eyebrow:"ПОСЛЕ МАТЧА", render: renderMatchSummaryPage},
  goals: {title:"Цели тренера", eyebrow:"ПРОГРЕСС", render: () => placeholder("Система уникальных и периодических целей будет добавлена после согласования чисел и списка целей.")},
  ratings: {title:"Онлайн рейтинги", eyebrow:"РЕЙТИНГИ ТРЕНЕРОВ", render: () => placeholder("Раздел онлайн-рейтингов подготовлен. Правила постоянного и сезонного рейтинга будут проработаны отдельно.")}
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
          const info=document.createElement("span");info.className="cabinet-player-info";info.append(safeText("b",player.name),safeText("small",player.position+" · "+player.nationality));
          const mainSkill=player.skills?.[player.position];if(mainSkill!==undefined)info.append(safeText("span",player.position+": "+mainSkill,"cabinet-player-main-skill"));
          card.append(img,info,makeRelationBadge(team,player),makePlayerSkillSummary(team,player));grid.append(card);
        });
        p.append(grid);
      } else {
        p.append(makeRelationsList(team,roster,(player,i)=>openPlayerProfile(team,player,i)));
        p.append(safeText("p","Отношения сейчас не повышаются автоматически. Когда будут согласованы игровые действия воспитания, здесь появятся реальные способы их улучшать.","muted"));
      }
    } else if(key==="stats"){
      p=panel("Статистика команды","Состав, развитие, отношения и результаты официальных матчей текущего сезона. Матчи и статистика пока сохраняются локально в этом браузере; облачный архив ещё не подключён.");
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
      const matches=Object.values(state.leagueResults||{}).filter(match=>Number(match.season||state.seasonNumber)===Number(state.seasonNumber||1)&&(match.homeId===team.id||match.awayId===team.id));
      const matchGrid=document.createElement("div");matchGrid.className="cabinet-metrics team-stat-metrics";
      const officialTotals=matches.reduce((acc,match)=>{const home=match.homeId===team.id,forUs=home?Number(match.homeScore||0):Number(match.awayScore||0),againstUs=home?Number(match.awayScore||0):Number(match.homeScore||0);acc.played++;acc.wins+=forUs>againstUs?1:0;acc.draws+=forUs===againstUs?1:0;acc.losses+=forUs<againstUs?1:0;acc.gf+=forUs;acc.ga+=againstUs;return acc;},{played:0,wins:0,draws:0,losses:0,gf:0,ga:0});
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
        Object.values(state.leagueResults||{}).filter(match=>Number(match.season||state.seasonNumber)===Number(state.seasonNumber||1)).forEach(match=>{
          const home=playedByTeam.get(match.homeId)||{played:0,wins:0,draws:0,losses:0,gf:0,ga:0,points:0};
          const away=playedByTeam.get(match.awayId)||{played:0,wins:0,draws:0,losses:0,gf:0,ga:0,points:0};
          const hs=Number(match.homeScore||0),as=Number(match.awayScore||0);
          home.played++;away.played++;home.gf+=hs;home.ga+=as;away.gf+=as;away.ga+=hs;
          if(hs>as){home.wins++;home.points+=3;away.losses++;}
          else if(hs<as){away.wins++;away.points+=3;home.losses++;}
          else{home.draws++;away.draws++;home.points++;away.points++;}
          playedByTeam.set(match.homeId,home);playedByTeam.set(match.awayId,away);
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
      const ownFixtures=Array.from({length:20},(_,index)=>{const round=index+1,fixture=getOfficialRoundFixtures(round,activeLeague).find(f=>f.home.isUserTeam||f.away.isUserTeam||f.home.id===team?.id||f.away.id===team?.id);return fixture?{round,fixture}:null}).filter(Boolean);
      const resultsForSeason=state.leagueResults||{};
      const getResult=({round,fixture})=>resultsForSeason[roundFixtureKey(round,fixture)]||null;
      const completed=ownFixtures.filter(item=>getResult(item)).length;
      const firstUnplayedRound=ownFixtures.find(item=>!getResult(item))?.round;
      const summary=document.createElement("div");summary.className="cabinet-metrics season-fixture-summary";
      [["Матчей в сезоне",String(ownFixtures.length)],["Завершено официально",String(completed)],["Осталось",String(Math.max(0,ownFixtures.length-completed))]].forEach(([label,value])=>{const card=document.createElement("div");card.className="cabinet-metric";card.append(safeText("small",label),safeText("b",value));summary.append(card);});
      p.append(summary);
      p.append(safeText("h3","Календарь сезона"));
      const list=document.createElement("div");list.className="season-fixture-list";
      ownFixtures.forEach(item=>{
        const fixture=item.fixture,result=getResult(item);
        const row=document.createElement("article");row.className="season-fixture-row is-user-fixture";
        const roundLabel=safeText("span","Тур "+item.round+" · День "+officialRoundDay(item.round));roundLabel.className="season-fixture-round";
        const matchup=document.createElement("div");matchup.className="season-fixture-matchup";
        matchup.append(safeText("b",matchTeamLabel(fixture.home)),safeText("span","—"),safeText("b",matchTeamLabel(fixture.away)));
        const status=safeText("span",result?(result.homeScore+":"+result.awayScore):(item.round===firstUnplayedRound?"Следующий":"Предстоит"));
        status.className="season-fixture-status"+(result?" is-played":"");
        row.append(roundLabel,matchup,status);list.append(row);
      });
      p.append(list);
      p.append(safeText("p","Календарь использует тот же официальный график, что и раздел «Турниры». В сезоне предусмотрено 20 туров и четыре встречи с каждым соперником; результаты берутся из сохранённых официальных матчей.","muted"));
    } else {
      p=panel("Карьера тренера","Постоянная история тренера и команды. Официальная статистика будет расти только от завершённых официальных матчей.");
      const grid=document.createElement("div");grid.className="cabinet-metrics";
      const history=state.careerHistory||{officialMatches:[],seasons:{}};
      const officialMatches=Array.isArray(history.officialMatches)?history.officialMatches:[];
      const totals=officialMatches.reduce((a,m)=>{const ownIsHome=m.homeId===(team?.id||state.careerTeamId),gf=Number(m.goalsFor??(ownIsHome?m.homeScore:m.awayScore)??0),ga=Number(m.goalsAgainst??(ownIsHome?m.awayScore:m.homeScore)??0),result=m.result||(gf>ga?"W":gf<ga?"L":"D");a.played++;a.wins+=result==="W"?1:0;a.draws+=result==="D"?1:0;a.losses+=result==="L"?1:0;a.gf+=gf;a.ga+=ga;return a;},{played:0,wins:0,draws:0,losses:0,gf:0,ga:0});
      [["Текущий сезон","Сезон "+(state.seasonNumber||1)],["Официальные матчи",String(totals.played)],["Победы / ничьи / поражения",totals.wins+" / "+totals.draws+" / "+totals.losses],["Забито / пропущено",totals.gf+" / "+totals.ga],["Опыт аккаунта",(state.xp||0)+" XP"],["Постоянный рейтинг",String(state.permanentRating||0)],["ID тренера",(state.careerCoachId||"не создан").slice(0,8)],["ID команды",(state.careerTeamId||"не создан").slice(0,8)]].forEach(([label,value])=>{const card=document.createElement("div");card.className="cabinet-metric";card.append(safeText("small",label),safeText("b",value));grid.append(card);});
      p.append(grid);
      const note=safeText("p","Тестовые матчи не попадают в официальную статистику. Результаты официальных матчей и текущая статистика сохраняются локально в этом браузере; защищённый серверный архив карьеры ещё не подключён.","muted");
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
$("skipDayButton")?.addEventListener("click", advanceCoachDay);
$("seasonCalendarButton")?.addEventListener("click",()=>openPage("seasonCalendar"));
$("startMatchButton")?.addEventListener("click",()=>openPage("match"));

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
function getPortrait(index) { const n=Math.max(1,Number(index)||1); return "/images/portretplayers/portret" + (((n - 1) % 77) + 1) + ".jpg"; }
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
  const coachButton=document.createElement("button");coachButton.type="button";coachButton.className="team-coach-profile-button";coachButton.textContent="Профиль тренера →";coachButton.addEventListener("click",()=>openCoachProfile(team,wrap));title.append(coachButton);
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
  wrap.append(makeCareerAwardShelf(careerAwardsFor("team",team.id),"Награды команды"));
  wrap.append(grid); return wrap;
}
function openCoachProfile(team,returnView) {
  const wrap=document.createElement("div");wrap.className="coach-profile";
  const back=document.createElement("button");back.type="button";back.className="coach-profile-back";back.textContent="← К команде";back.addEventListener("click",()=>{const container=document.querySelector(".team-roster-container");if(container&&returnView)container.replaceChildren(returnView);else openPage("players");});
  const head=document.createElement("section");head.className="coach-profile-head";
  const details=document.createElement("div");details.className="coach-profile-identity";
  details.append(safeText("p","ПРОФИЛЬ ТРЕНЕРА","eyebrow"),safeText("h2",team.coach||"Тренер"),safeText("p",team.name,"coach-profile-team"),safeText("p",team.league+" · Сезон "+(state.seasonNumber||1),"muted"));
  head.append(details);
  const isUserTeam=Boolean(team.isUserTeam||team.id===getUserTeam()?.id||team.name===state.teamName);
  const history=state.careerHistory||{};
  const officialMatches=isUserTeam&&Array.isArray(history.officialMatches)?history.officialMatches:[];
  const totals=officialMatches.reduce((acc,match)=>{acc.played++;acc.wins+=match.result==="W"?1:0;acc.draws+=match.result==="D"?1:0;acc.losses+=match.result==="L"?1:0;acc.gf+=Number(match.goalsFor||0);acc.ga+=Number(match.goalsAgainst||0);return acc;},{played:0,wins:0,draws:0,losses:0,gf:0,ga:0});
  const grid=document.createElement("div");grid.className="cabinet-metrics coach-profile-metrics";
  const metrics=[
    ["Команда",team.name],
    ["Лига",team.league||"—"],
    ["Футболистов",String((team.players||[]).length)+" / 10"],
    ["Сезон","Сезон "+(state.seasonNumber||1)],
    ["Матчи",isUserTeam?String(totals.played):"—"],
    ["Победы / ничьи / поражения",isUserTeam?totals.wins+" / "+totals.draws+" / "+totals.losses:"—"],
    ["Забито / пропущено",isUserTeam?totals.gf+" / "+totals.ga:"—"],
    ["Опыт тренера",isUserTeam?(state.xp||0)+" XP":"—"],
    ["Постоянный рейтинг",isUserTeam?String(state.permanentRating||0):"—"]
  ];
  metrics.forEach(([label,value])=>{const card=document.createElement("div");card.className="cabinet-metric";card.append(safeText("small",label),safeText("b",value));grid.append(card);});
  const note=safeText("p",isUserTeam?"Показатели взяты из текущего сохранения тренера. Официальные результаты будут отражаться после подключения сохранения матчей.":"Профиль тренера команды доступен. Индивидуальная статистика будет отображаться после появления общей официальной истории матчей лиги.","muted");
  wrap.append(back,head,grid,makeCareerAwardShelf(careerAwardsFor("coach",team.id),"Награды тренера"),note);
  const container=document.querySelector(".team-roster-container");
  if(container)container.replaceChildren(wrap);
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

const MATCH_FORMATIONS = {
  "2–2–1": ["ЗЩ","ЗЩ","ПЗ","ПЗ","НП"],
  "2–1–2": ["ЗЩ","ЗЩ","ПЗ","НП","НП"],
  "1–3–1": ["ЗЩ","ПЗ","ПЗ","ПЗ","НП"],
  "3–1–1": ["ЗЩ","ЗЩ","ЗЩ","ПЗ","НП"]
};
function matchButton(label,onClick,cls){const b=document.createElement("button");b.type="button";b.className=cls||"secondary";b.textContent=label;b.addEventListener("click",onClick);return b}
function officialRoundDay(round){return round<=10?round*7:108+(round-11)*7}
function officialRoundForDay(day){for(let r=1;r<=20;r++)if(officialRoundDay(r)===day)return r;return 0}
function officialMatchKey(round,home,away){return String(state.seasonNumber||1)+"-"+round+"-"+home.id+"-"+away.id}
function allCurrentLeagueTeams(leagueName="Нижняя лига"){return (leagueData?.teams||[]).filter(t=>t.league===leagueName).map(t=>t.isUserTeam?getUserTeam():t).filter(Boolean)}
function getOfficialRoundFixtures(round,leagueName="Нижняя лига"){
 const teams=allCurrentLeagueTeams(leagueName);if(teams.length<2)return [];
 let base=teams.slice(),rounds=[];
 for(let r=0;r<teams.length-1;r++){
  const pairs=[];for(let i=0;i<Math.floor(teams.length/2);i++){let a=base[i],b=base[teams.length-1-i];if((r+i)%2===1)[a,b]=[b,a];pairs.push({home:a,away:b})}
  rounds.push(pairs);base=[base[0],base[base.length-1],...base.slice(1,-1)];
 }
 const perLeg=rounds.length;if(round<1||round>perLeg*4)return [];
 const leg=Math.floor((round-1)/perLeg),roundIndex=(round-1)%perLeg,fixtures=rounds[roundIndex]||[];
 return leg%2===0?fixtures:fixtures.map(f=>({home:f.away,away:f.home}));
}
function currentOfficialFixture(){
 const round=officialRoundForDay(Number(state.gameDay)||1);if(!round)return null;
 return getOfficialRoundFixtures(round).find(f=>f.home.isUserTeam||f.away.isUserTeam)||null;
}
function getTeamForMatch(id){const t=leagueData?.teams.find(x=>x.id===id);return t?.isUserTeam?getUserTeam():t||null}
function matchPlayerScore(p,role){const s=p?.skills||{};const v=Number(s[role]||0);return Number.isFinite(v)?v:25}
function buildOfficialLineup(team,formation){
 const roster=(team?.players||[]).slice();if(!roster.length)return [];
 const used=new Set(),take=(role)=>{let p=roster.find(x=>!used.has(x)&&x.position===role);if(!p)p=roster.find(x=>!used.has(x));if(p)used.add(p);return p};
 const keeper=take("ВР");const roles=MATCH_FORMATIONS[formation]||MATCH_FORMATIONS["2–2–1"];
 const lineup=[];if(keeper)lineup.push({player:keeper,role:"ВР",sentOff:false});
 roles.forEach(role=>{const player=take(role);if(player)lineup.push({player,role,sentOff:false})});
 return lineup;
}
function roundFixtureKey(round,fixture){return officialMatchKey(round,fixture.home,fixture.away)}
function scoreRandomTeam(team){
 const roster=team?.players||[];const first=roster.find(p=>p.position==="ВР")||roster[0];
 const out=roster.filter(p=>p!==first).slice(0,5);
 const attack=out.reduce((n,p)=>n+matchPlayerScore(p,"НП")*.4+matchPlayerScore(p,"ПЗ")*.35+matchPlayerScore(p,"ЗЩ")*.15,0)/Math.max(1,out.length);
 const defence=out.reduce((n,p)=>n+matchPlayerScore(p,"ЗЩ")*.5+matchPlayerScore(p,"ПЗ")*.2,0)/Math.max(1,out.length);
 const base=1+Math.random()*2.5+(attack-defence)*.018;
 return Math.max(0,Math.min(7,Math.round(base+(Math.random()-.5)*2)));
}
function ensureRoundBackgroundResults(round,userFixture,userResult,leagueName="Нижняя лига"){
 state.leagueResults=state.leagueResults||{};
 getOfficialRoundFixtures(round,leagueName).forEach(f=>{
  const key=roundFixtureKey(round,f);if(state.leagueResults[key])return;
  if(userFixture&&f.home.id===userFixture.home.id&&f.away.id===userFixture.away.id&&userResult){state.leagueResults[key]=userResult;return}
  const homeScore=scoreRandomTeam(f.home),awayScore=scoreRandomTeam(f.away),homeLineup=buildOfficialLineup(f.home,"2–2–1"),awayLineup=buildOfficialLineup(f.away,"2–2–1"),events=[];
  const addGoals=(side,team,lineup,count)=>{const forwards=lineup.filter(x=>x.role==="НП"||x.role==="ПЗ"),pool=forwards.length?forwards:lineup;for(let i=0;i<count;i++){const scorer=pool[Math.floor(Math.random()*pool.length)],helpers=lineup.filter(x=>x.player!==scorer?.player),helper=helpers.length?helpers[Math.floor(Math.random()*helpers.length)]:null;events.push({minute:Math.floor(Math.random()*20)+1,type:"goal",side,scorer:scorer?.player.name||"Игрок",assist:helper?.player.name||null,text:"Гол команды "+matchTeamLabel(team)+": "+(scorer?.player.name||"Игрок")+(helper?" (ассист: "+helper.player.name+")":"")})}};
  addGoals("home",f.home,homeLineup,homeScore);addGoals("away",f.away,awayLineup,awayScore);
  const playerRatings=["home","away"].flatMap(side=>(side==="home"?homeLineup:awayLineup).map(entry=>{const p=entry.player||entry,goals=events.filter(ev=>ev.type==="goal"&&ev.side===side&&ev.scorer===p.name).length,assists=events.filter(ev=>ev.type==="goal"&&ev.side===side&&ev.assist===p.name).length;return {playerName:p.name,side,played:true,goals,assists,rating:Math.min(10,6+goals+assists)}}));state.leagueResults[key]={season:Number(state.seasonNumber)||1,round,day:officialRoundDay(round),homeId:f.home.id,awayId:f.away.id,homeScore,awayScore,homeLineup,awayLineup,events,playerRatings,simulated:true};
 });
}
function ensureAllLeagueRoundResults(round,userFixture,userResult){
 ["Нижняя лига","Верхняя лига"].forEach(leagueName=>ensureRoundBackgroundResults(round,userFixture,userResult,leagueName));
}
function addCoachRatingPoints(points,reason=""){
 const value=Math.max(0,Math.floor(Number(points)||0));if(!value)return;
 state.permanentRating=Math.max(0,Number(state.permanentRating)||0)+value;
 state.seasonRating=Math.max(0,Number(state.seasonRating)||0)+value;
 state.ratingLedger=Array.isArray(state.ratingLedger)?state.ratingLedger:[];
 state.ratingLedger.push({season:Number(state.seasonNumber)||1,points:value,reason,at:Date.now()});
}
function updateCoachRespect(){
 if(!leagueData?.teams?.length)return Number(state.respect)||0;
 let total=0,count=0;
 leagueData.teams.forEach(base=>{
  let team=base;
  if(base.isUserTeam)team=getUserTeam()||base;
  else if(Array.isArray(state.externalRosters?.[base.id]))team={...base,players:state.externalRosters[base.id]};
  (team.players||[]).forEach(player=>{total+=getPlayerRelation(team,player);count++});
 });
 state.respect=count?Math.round((total/count)*100)/100:0;
 return state.respect;
}
function ratingAwardKey(key){state.ratingAwardsApplied=state.ratingAwardsApplied&&typeof state.ratingAwardsApplied==="object"?state.ratingAwardsApplied:{};if(state.ratingAwardsApplied[key])return false;state.ratingAwardsApplied[key]=true;return true}
function awardOfficialMatchRating(result,fixture){
 const ownId=getUserTeam()?.id;if(!ownId)return;
 const ownHome=result.homeId===ownId,ownAway=result.awayId===ownId;if(!ownHome&&!ownAway)return;
 const ownScore=ownHome?Number(result.homeScore):Number(result.awayScore),oppScore=ownHome?Number(result.awayScore):Number(result.homeScore);
 const key="match:"+String(result.season)+":"+String(result.round)+":"+String(ownId);
 if(!ratingAwardKey(key))return;
 addCoachRatingPoints(ownScore>oppScore?5:ownScore===oppScore?2:0,"official-match");
 if(Number(result.round)%5===0)announceMonthlyAwards(Number(result.season),Number(result.round));
}
function awardSeasonRatingBonuses(season){
 const doneKey="season-finalized:"+season;if(state.ratingAwardsApplied?.[doneKey])return;
 const own=getUserTeam();if(!own)return;
 const standings=getCurrentStandings(),rank=standings.findIndex(x=>x.team.id===own.id)+1;
 const placeBonus=rank===1?30:rank===2?20:rank===3?10:0;
 if(placeBonus)addCoachRatingPoints(placeBonus,"season-place-"+rank);
 if(rank===1)addCoachRatingPoints(15,"best-coach-season");
 const playerStats=new Map();
 Object.values(state.leagueResults||{}).filter(m=>Number(m.season)===Number(season)&&leagueData?.teams.find(t=>t.id===m.homeId)?.league===own.league).forEach(m=>{
  (m.events||[]).filter(ev=>ev.type==="goal").forEach(ev=>{
   const teamId=ev.side==="home"?m.homeId:m.awayId;
   const add=(name,kind)=>{if(!name)return;const key=teamId+"::"+name;const p=playerStats.get(key)||{teamId,name,goals:0,assists:0};p[kind]++;playerStats.set(key,p)};
   add(ev.scorer,"goals");add(ev.assist,"assists");
  });
 });
 const scorers=[...playerStats.values()].filter(p=>p.goals>0).sort((x,y)=>y.goals-x.goals||y.assists-x.assists||x.name.localeCompare(y.name,"ru"));
 const assistants=[...playerStats.values()].filter(p=>p.assists>0).sort((x,y)=>y.assists-x.assists||y.goals-x.goals||x.name.localeCompare(y.name,"ru"));
 if(scorers[0]?.teamId===own.id)addCoachRatingPoints(15,"league-top-scorer");
 if(assistants[0]?.teamId===own.id)addCoachRatingPoints(15,"league-top-assistant");
 ratingAwardKey(doneKey);
 state.careerHistory=state.careerHistory||{officialMatches:[],seasons:{}};
 state.careerHistory.seasons=state.careerHistory.seasons||{};
 state.careerHistory.seasons[String(season)]={...(state.careerHistory.seasons[String(season)]||{}),finalRank:rank,placeBonus,seasonRatingBeforeReset:Number(state.seasonRating)||0,finalizedAt:Date.now()};
}

function ensureCareerAwards(){state.careerAwards=Array.isArray(state.careerAwards)?state.careerAwards:[];return state.careerAwards}
function addCareerAward(record){
 const all=ensureCareerAwards();if(!record?.key||all.some(x=>x.key===record.key))return false;
 all.push({...record,season:Number(record.season)||Number(state.seasonNumber)||1,awardedAt:Date.now()});return true;
}
function awardIconPath(icon){
 const img=document.createElement("img");img.className="career-award-icon";img.alt="";img.loading="lazy";
 const tries=["/images/awards/"+icon+".png","/images/awards/"+icon+".jpg","/images/awards/"+icon+".webp","/images/rewards/"+icon+".png","/images/"+icon+".png"];let ix=0;
 img.onerror=()=>{ix++;if(ix<tries.length)img.src=tries[ix];else img.remove()};img.src=tries[0];return img;
}
function makeCareerAwardShelf(records,title){
 const section=document.createElement("section");section.className="career-awards-section";
 section.append(safeText("h3",title));
 if(!records.length){section.append(safeText("p","Наград пока нет.","muted"));return section}
 const grid=document.createElement("div");grid.className="career-awards-grid";
 records.slice().sort((x,y)=>Number(y.season)-Number(x.season)||Number(y.round||0)-Number(x.round||0)).forEach(item=>{
  const card=document.createElement("article");card.className="career-award-card";card.append(awardIconPath(item.icon),safeText("b",item.label||"Награда"),safeText("small",item.caption||("Сезон "+item.season)));
  if(item.result)card.append(safeText("small",item.result));grid.append(card);
 });section.append(grid);return section;
}
function careerAwardsFor(type,id,name){
 return ensureCareerAwards().filter(x=>x.recipientType===type&&String(x.recipientId)===String(id)&&(name==null||x.recipientName===name));
}
function getSeasonCupTeams(season){
 const teams=(leagueData?.teams||[]).slice().sort((x,y)=>Number(String(x.id).replace(/\\D/g,""))-Number(String(y.id).replace(/\\D/g,"")));
 if(teams.length!==12)return {entrants:teams.slice(0,8),excluded:teams.slice(8),mode:"fallback"};
 const start=(((Math.max(1,Number(season)||1)-1)*4)%teams.length);
 const rotated=teams.map((_,i)=>teams[(start+i)%teams.length]);
 const excluded=rotated.slice(0,4),entrants=teams.filter(t=>!excluded.some(x=>x.id===t.id));
 return {entrants,excluded,mode:"balanced-40-season-cycle"};
}
function seededCupRandom(seed){
 let x=2166136261;for(const ch of String(seed)){x^=ch.charCodeAt(0);x=Math.imul(x,16777619)}
 return ()=>{x+=0x6D2B79F5;let t=x;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296}
}
function cupTeamPower(team){
 const roster=team?.players||[];if(!roster.length)return 25;
 return roster.reduce((n,p)=>n+(["ВР","ЗЩ","ПЗ","НП"].reduce((m,k)=>m+Number(p.skills?.[k]||25),0)/4),0)/roster.length;
}
function simulateCupFixture(season,stage,home,away,index){
 const rand=seededCupRandom("cup:"+season+":"+stage+":"+home.id+":"+away.id+":"+index);
 const score=team=>{const power=cupTeamPower(team);return Math.max(0,Math.min(6,Math.floor(rand()*3)+Math.floor(power/35)+(rand()<.28?1:0)))};
 let homeScore=score(home),awayScore=score(away),extraTime=null,penalties=null,winner;
 if(homeScore===awayScore){
  const eh=rand()<.45?1:0,ea=rand()<.45?1:0;extraTime={home:eh,away:ea};homeScore+=eh;awayScore+=ea;
  if(homeScore===awayScore){const ph=3+Math.floor(rand()*3),pa=3+Math.floor(rand()*3);penalties={home:ph,away:pa};if(ph===pa)penalties.home++;winner=penalties.home>penalties.away?home:away;}
 }
 winner=winner||(homeScore>awayScore?home:away);
 return {season,stage,homeId:home.id,awayId:away.id,homeName:matchTeamLabel(home),awayName:matchTeamLabel(away),homeScore,awayScore,extraTime,penalties,winnerId:winner.id,winnerName:matchTeamLabel(winner),day:Number(state.gameDay)||1};
}
function cupBracketTeam(id){return (leagueData?.teams||[]).find(t=>t.id===id)||null}
function simulateCupFriendlyRound(season,stage,excluded){
 state.cupFriendlyResults=Array.isArray(state.cupFriendlyResults)?state.cupFriendlyResults:[];
 for(let i=0;i<excluded.length;i+=2){const home=excluded[i],away=excluded[i+1];if(!home||!away)continue;const key=season+":"+stage+":"+home.id+":"+away.id;if(state.cupFriendlyResults.some(x=>x.key===key))continue;const rand=seededCupRandom("friendly:"+key);state.cupFriendlyResults.push({key,season,stage,day:Number(state.gameDay)||1,homeId:home.id,awayId:away.id,homeScore:Math.floor(rand()*4),awayScore:Math.floor(rand()*4),friendly:true})}
}
function announceCupDraw(season){
 state.cupDraws=state.cupDraws&&typeof state.cupDraws==="object"?state.cupDraws:{};
 if(state.cupDraws[season])return;
 const draw=getSeasonCupTeams(season),own=getUserTeam(),selected=draw.entrants.some(t=>t.id===own?.id);
 state.cupDraws[season]={entrants:draw.entrants.map(t=>t.id),excluded:draw.excluded.map(t=>t.id),selected};
 const names=draw.entrants.map(t=>matchTeamLabel(t)).join(", ");
 const message="Уважаемые коллеги! Сегодня по утверждённому календарю определены участники кубка «ДОСТАТОК» сезона "+season+". "+(selected?"Ваша команда участвует в розыгрыше.":"Ваша команда в этом сезоне не попала в заявку и сыграет товарищеские матчи с другими командами, не прошедшими отбор.")+" Участники: "+names+". Четвертьфиналы, полуфиналы и финал пройдут в период перерыва между кругами.";
 publishCoachEventOnce("cup-draw:"+season,"news","Жеребьёвка кубка «ДОСТАТОК»",message,{priority:"high",important:true});
 saveState();
}
function runCupRound(stage){
 const season=Number(state.seasonNumber)||1;state.cupResults=state.cupResults&&typeof state.cupResults==="object"?state.cupResults:{};
 const cup=state.cupResults[season]||(state.cupResults[season]={matches:[],championId:null,championName:null});
 if(cup.matches.some(x=>x.stage===stage))return;
 const draw=getSeasonCupTeams(season),entrants=draw.entrants,excluded=draw.excluded;
 let fixtures=[];
 if(stage==="quarterfinals"){
  for(let i=0;i<4;i++)fixtures.push([entrants[i],entrants[7-i]]);
 }else{
  const prior=stage==="semifinals"?"quarterfinals":"semifinals";
  const prev=cup.matches.filter(x=>x.stage===prior);
  const winners=prev.map(x=>cupBracketTeam(x.winnerId)).filter(Boolean);
  for(let i=0;i<winners.length;i+=2)if(winners[i+1])fixtures.push([winners[i],winners[i+1]]);
 }
 const roundMatches=fixtures.map((pair,i)=>simulateCupFixture(season,stage,pair[0],pair[1],i));
 cup.matches.push(...roundMatches);simulateCupFriendlyRound(season,stage,excluded);
 const stageName=stage==="quarterfinals"?"Четвертьфиналы":stage==="semifinals"?"Полуфиналы":"Финал";
 const ownId=getUserTeam()?.id,ownMatch=roundMatches.find(x=>x.homeId===ownId||x.awayId===ownId);
 if(ownMatch)publishCoachEventOnce("cup-result:"+season+":"+stage+":"+ownId,"news","Кубок «ДОСТАТОК»: "+stageName,ownMatch.homeName+" "+ownMatch.homeScore+":"+ownMatch.awayScore+" "+ownMatch.awayName+(ownMatch.extraTime?" (с учётом дополнительного времени)":"")+(ownMatch.penalties?"; пенальти "+ownMatch.penalties.home+":"+ownMatch.penalties.away:"")+".",{priority:"high",important:true});
 if(stage==="finals"){
  const final=roundMatches[0];if(final){cup.championId=final.winnerId;cup.championName=final.winnerName;
   const winner=cupBracketTeam(final.winnerId),caption="КУБОК «ДОСТАТОК» · СЕЗОН "+season,score=final.homeName+" "+final.homeScore+":"+final.awayScore+" "+final.awayName+(final.extraTime?" · доп. время":"")+(final.penalties?" · пенальти "+final.penalties.home+":"+final.penalties.away:"");
   addCareerAward({key:"cup-dostatoch:team:"+season,recipientType:"team",recipientId:winner.id,icon:"awardcupdostatok",label:"Кубок «Достаток»",caption,result:score,season});
   addCareerAward({key:"cup-dostatoch:coach:"+season,recipientType:"coach",recipientId:winner.id,icon:"awardcupdostatok",label:"Кубок «Достаток»",caption,result:score,season});
   (winner.players||[]).forEach(p=>addCareerAward({key:"cup-dostatoch:player:"+season+":"+winner.id+":"+p.name,recipientType:"player",recipientId:winner.id,recipientName:p.name,icon:"awardcupdostatok",label:"Кубок «Достаток»",caption,result:score,season}));
   publishCoachEventOnce("cup-champion:"+season,"news","Обладатель кубка «ДОСТАТОК»", "Кубок «ДОСТАТОК» сезона "+season+" выиграла команда "+final.winnerName+". Финальный результат: "+score+". Награда закреплена в профилях команды, тренера и футболистов.",{priority:"high",important:true});
  }
 }
 saveState();
}
function getStandingsForLeague(leagueName,season){
 const teams=allCurrentLeagueTeams(leagueName).map(team=>({team,played:0,w:0,d:0,l:0,gf:0,ga:0,pts:0})),byId=Object.fromEntries(teams.map(x=>[x.team.id,x]));
 Object.values(state.leagueResults||{}).filter(r=>Number(r.season||state.seasonNumber)===Number(season)).forEach(r=>{const h=byId[r.homeId],a=byId[r.awayId];if(!h||!a)return;h.played++;a.played++;h.gf+=Number(r.homeScore)||0;h.ga+=Number(r.awayScore)||0;a.gf+=Number(r.awayScore)||0;a.ga+=Number(r.homeScore)||0;if(r.homeScore>r.awayScore){h.w++;a.l++;h.pts+=3}else if(r.homeScore<r.awayScore){a.w++;h.l++;a.pts+=3}else{h.d++;a.d++;h.pts++;a.pts++}});
 return teams.sort((x,y)=>y.pts-x.pts||(y.gf-y.ga)-(x.gf-x.ga)||y.gf-x.gf||x.team.name.localeCompare(y.team.name,"ru"));
}
function finalizeSeasonCareerAwards(season){
 const key="career-season-awards:"+season;if(state.ratingAwardsApplied?.[key])return;
 const teams=leagueData?.teams||[];if(!teams.length)return;
 ["Верхняя лига","Нижняя лига"].forEach(league=>{
  const standings=getStandingsForLeague(league,season);
  standings.slice(0,3).forEach((row,i)=>{
   const rank=i+1,icon="award"+(league==="Верхняя лига"?"liga1":"liga2")+"medal"+rank,caption=rank+" место · "+league+" · сезон "+season;
   addCareerAward({key:"league-medal:team:"+season+":"+league+":"+rank,recipientType:"team",recipientId:row.team.id,icon,label:rank+" место",caption,season});
   (row.team.players||[]).forEach(p=>addCareerAward({key:"league-medal:player:"+season+":"+league+":"+rank+":"+row.team.id+":"+p.name,recipientType:"player",recipientId:row.team.id,recipientName:p.name,icon,label:rank+" место",caption,season}));
  });
  const winner=standings[0]?.team;
  if(winner){
   addCareerAward({key:"league-cup:team:"+season+":"+league,recipientType:"team",recipientId:winner.id,icon:league==="Верхняя лига"?"awardliga1cup":"awardliga2cup",label:"Кубок лиги",caption:league+" · сезон "+season,season});
   addCareerAward({key:"league-cup:coach:"+season+":"+league,recipientType:"coach",recipientId:winner.id,icon:league==="Верхняя лига"?"awardliga1cup":"awardliga2cup",label:"Кубок лиги",caption:league+" · сезон "+season,season});
  }
  const stats=new Map();
  Object.values(state.leagueResults||{}).filter(m=>Number(m.season)===Number(season)&&teams.find(t=>t.id===m.homeId)?.league===league).forEach(m=>{
   (m.events||[]).filter(ev=>ev.type==="goal").forEach(ev=>{const id=(ev.side==="home"?m.homeId:m.awayId)+"::"+(ev.side==="home"?ev.scorer:ev.scorer);if(!ev.scorer)return;const x=stats.get(id)||{teamId:ev.side==="home"?m.homeId:m.awayId,name:ev.scorer,goals:0,assists:0};x.goals++;stats.set(id,x);if(ev.assist){const aid=x.teamId+"::"+ev.assist,as=stats.get(aid)||{teamId:x.teamId,name:ev.assist,goals:0,assists:0};as.assists++;stats.set(aid,as)}});
  });
  const topGoal= [...stats.values()].filter(x=>x.goals>0).sort((x,y)=>y.goals-x.goals||y.assists-x.assists||x.name.localeCompare(y.name,"ru"))[0];
  const topAssist=[...stats.values()].filter(x=>x.assists>0).sort((x,y)=>y.assists-x.assists||y.goals-x.goals||x.name.localeCompare(y.name,"ru"))[0];
  [[topGoal,"awardbestgoal"+(league==="Верхняя лига"?"liga1":"liga2"),"Лучший бомбардир"],[topAssist,"awardbestassist"+(league==="Верхняя лига"?"liga1":"liga2"),"Лучший ассистент"]].forEach(([p,icon,label])=>{if(!p)return;addCareerAward({key:"season-individual:"+season+":"+league+":"+label,recipientType:"player",recipientId:p.teamId,recipientName:p.name,icon,label,caption:league+" · сезон "+season,season})});
 });
 const own=getUserTeam(),ownRank=own?getStandingsForLeague(own.league,season).findIndex(x=>x.team.id===own.id)+1:0;
 if(own&&ownRank===1)addCareerAward({key:"best-coach:"+season+":"+own.id,recipientType:"coach",recipientId:own.id,icon:"awardbesttrainerseason",label:"Лучший тренер сезона",caption:"Сезон "+season,season});
 state.ratingAwardsApplied=state.ratingAwardsApplied||{};state.ratingAwardsApplied[key]=true;saveState();
}
function announceMonthlyAwards(season,round){
 const key="monthly-player:"+season+":"+round;if(state.ratingAwardsApplied?.[key])return;
 const leagueWinners=[];
 ["Верхняя лига","Нижняя лига"].forEach(league=>{
  const eligible=Object.values(state.leagueResults||{}).filter(m=>Number(m.season)===Number(season)&&Number(m.round)>=round-4&&Number(m.round)<=round&&teamsLeagueForMatch(m)===league);
  const stats=new Map();
  eligible.forEach(m=>["home","away"].forEach(side=>{
   const teamId=side==="home"?m.homeId:m.awayId,team=cupBracketTeam(teamId),lineup=m[side+"Lineup"]||[];
   lineup.forEach(entry=>{const p=entry.player||entry,name=p?.name;if(!name)return;const evs=(m.events||[]).filter(e=>e.type==="goal"&&getEventTeamSide(e)===side),goals=evs.filter(e=>e.scorer===name).length,assists=evs.filter(e=>e.assist===name).length;
    const stored=(m.playerRatings||[]).find(x=>x.side===side&&x.playerName===name),rating=Number(stored?.rating);const actual=Number.isFinite(rating)&&rating>0?rating:Math.min(10,6+goals+assists);
    const id=teamId+"::"+name,x=stats.get(id)||{teamId,name,teamName:matchTeamLabel(team),ratingTotal:0,played:0,goals:0,assists:0};x.ratingTotal+=actual;x.played++;x.goals+=goals;x.assists+=assists;stats.set(id,x);
   });
  }));
  const best=[...stats.values()].filter(x=>x.played>0).sort((x,y)=>(y.ratingTotal/y.played)-(x.ratingTotal/x.played)||y.played-x.played||y.goals-x.goals||y.assists-x.assists||x.name.localeCompare(y.name,"ru"))[0];
  if(best){const team=cupBracketTeam(best.teamId);leagueWinners.push({...best,league,average:Math.round(best.ratingTotal/best.played*100)/100});
   addCareerAward({key:"monthly-best-player:"+season+":"+round+":"+league,recipientType:"player",recipientId:best.teamId,recipientName:best.name,icon:"awardbestplayermonth",label:"Лучший игрок месяца",caption:"Сезон "+season+" · "+Math.ceil(round/5)+" круговой отрезок",result:"Средняя оценка "+(Math.round(best.ratingTotal/best.played*100)/100).toFixed(2),season,round});
  }
 });
 const own=getUserTeam();if(own&&leagueWinners.some(x=>x.teamId===own.id))addCoachRatingPoints(10,"monthly-best-player");
 state.ratingAwardsApplied=state.ratingAwardsApplied||{};state.ratingAwardsApplied[key]=true;
 const msg="Уважаемые коллеги! Награды лучшему футболисту месяца вручены. "+leagueWinners.map(x=>x.league+": "+x.name+" ("+x.teamName+"), средняя оценка за последние пять туров — "+x.average.toFixed(2)+".").join(" ");
 publishCoachEventOnce("monthly-award-mail:"+season+":"+round,"news","Лучший игрок месяца — туры "+(round-4)+"–"+round,msg,{priority:"high",important:true});
 saveState();
}
function teamsLeagueForMatch(match){return cupBracketTeam(match.homeId)?.league||cupBracketTeam(match.awayId)?.league||""}

function ensureCoachCommunicationState(){state.coachMail=Array.isArray(state.coachMail)?state.coachMail:[];state.coachChronicle=Array.isArray(state.coachChronicle)?state.coachChronicle:[];state.coachMailKeys=state.coachMailKeys&&typeof state.coachMailKeys==="object"?state.coachMailKeys:{}}
function publishCoachEvent({key,type="news",title,message,priority="normal",day=state.gameDay,season=state.seasonNumber,important=false}){
 ensureCoachCommunicationState();if(!key||state.coachMailKeys[key])return false;state.coachMailKeys[key]=true;
 const item={id:makeCareerId(),key,type,title,message,priority,important,season:Number(season)||1,day:Number(day)||1,at:Date.now(),read:false,archived:false};
 state.coachMail.unshift(item);state.coachChronicle.unshift({...item});
 const normal=state.coachMail.filter(x=>!x.important);if(normal.length>50){const remove=new Set(normal.slice(50).map(x=>x.id));state.coachMail=state.coachMail.filter(x=>!remove.has(x.id))}
 state.coachChronicle=state.coachChronicle.slice(0,30);saveState();return true
}
function publishCoachEventOnce(key,type,title,message,options={}){return publishCoachEvent({key,type,title,message,...options})}
function renderCoachMail(){
 ensureCoachCommunicationState();const wrap=document.createElement("div");wrap.className="coach-mail-view";const tabs=document.createElement("div");tabs.className="cabinet-tabs";const body=document.createElement("div");body.className="cabinet-tab-content";let category="inbox";
 const choices=[["inbox","Входящие"],["news","Новости"],["players","Футболисты"],["archive","Архив"]];
 const draw=()=>{tabs.replaceChildren();body.replaceChildren();choices.forEach(([id,label])=>{const b=document.createElement("button");b.type="button";b.className="cabinet-tab"+(category===id?" active":"");b.textContent=label;b.addEventListener("click",()=>{category=id;draw()});tabs.append(b)});
 const items=state.coachMail.filter(x=>category==="archive"?x.archived:!x.archived&&(category==="inbox"||category==="news"&&x.type==="news"||category==="players"&&x.type==="player"));
 if(!items.length){body.append(placeholder(category==="archive"?"Архив пока пуст.":"Сообщений в этой категории пока нет."));return}
 items.forEach(item=>{const card=document.createElement("article");card.className="panel";card.style.marginBottom="10px";card.style.padding="14px";if(!item.read)card.style.borderLeft="3px solid var(--accent,#65dca0)";
 const top=document.createElement("div");top.className="section-title";top.append(safeText("b",item.title),safeText("small","Сезон "+item.season+" · День "+item.day,"muted"));const msg=safeText("p",item.message);msg.style.margin="10px 0";
 const actions=document.createElement("div");actions.className="button-row";actions.append(B(item.read?"Прочитано":"Отметить прочитанным",()=>{item.read=true;saveState();draw()},"secondary"),B(item.archived?"Вернуть во входящие":"В архив",()=>{item.archived=!item.archived;saveState();draw()},"secondary"));card.append(top,msg,actions);body.append(card)})};
 wrap.append(tabs,body);draw();return wrap
}
function renderCoachChronicle(){
 ensureCoachCommunicationState();const feed=$("eventFeed");if(!feed)return;feed.replaceChildren();const entries=state.coachChronicle.slice(0,5);
 if(!entries.length){feed.className="empty-state";feed.append(safeText("span","📋"),safeText("b","Пока тихо"),safeText("p","Здесь будут появляться важные события команды."));return}
 feed.className="coach-chronicle-list";entries.forEach(item=>{const row=document.createElement("article");row.className="chronicle-item";row.append(safeText("small","С"+item.season+" · День "+item.day,"muted"),safeText("b",item.title),safeText("p",item.message));row.addEventListener("click",()=>openPage("mail"));row.style.cursor="pointer";feed.append(row)});
 const footer=document.createElement("button");footer.type="button";footer.className="secondary";footer.textContent="Открыть почту тренера";footer.addEventListener("click",()=>openPage("mail"));feed.append(footer)
}
function getCurrentStandings(leagueName="Нижняя лига"){
 const teams=allCurrentLeagueTeams(leagueName).map(t=>({team:t,played:0,w:0,d:0,l:0,gf:0,ga:0,pts:0}));
 const byId=Object.fromEntries(teams.map(x=>[x.team.id,x]));
 Object.values(state.leagueResults||{}).filter(r=>Number(r.season||state.seasonNumber)===Number(state.seasonNumber||1)).forEach(r=>{
  const h=byId[r.homeId],a=byId[r.awayId];if(!h||!a)return;
  h.played++;a.played++;h.gf+=r.homeScore;h.ga+=r.awayScore;a.gf+=r.awayScore;a.ga+=r.homeScore;
  if(r.homeScore>r.awayScore){h.w++;a.l++;h.pts+=3}else if(r.homeScore<r.awayScore){a.w++;h.l++;a.pts+=3}else{h.d++;a.d++;h.pts++;a.pts++}
 });
 return teams.sort((a,b)=>b.pts-a.pts||(b.gf-b.ga)-(a.gf-a.ga)||b.gf-a.gf||a.team.name.localeCompare(b.team.name,"ru"));
}
function calendarDateText(){return "СЕЗОН "+(state.seasonNumber||1)+", День "+(state.gameDay||1)}
function canAdvanceCoachDay(){
 const round=officialRoundForDay(Number(state.gameDay)||1);if(!round)return true;
 const f=currentOfficialFixture();if(!f)return true;
 const key=roundFixtureKey(round,f);return Boolean(state.leagueResults?.[key]);
}
function advanceCoachDay(){
 if(!leagueData){alert("Календарь ещё загружается.");return}
 if(!canAdvanceCoachDay()){alert("Сегодня официальный матч тура. На главной странице появилась кнопка «НАЧАТЬ МАТЧ».");return}
 if(Number(state.gameDay)>=182){
  const completedSeason=Number(state.seasonNumber)||1;
  awardSeasonRatingBonuses(completedSeason);
  finalizeSeasonCareerAwards(completedSeason);
  state.careerHistory=state.careerHistory||{officialMatches:[],seasons:{}};
  state.careerHistory.seasons=state.careerHistory.seasons||{};
  state.careerHistory.seasons[String(completedSeason)]={...(state.careerHistory.seasons[String(completedSeason)]||{}),finalRating:Number(state.seasonRating)||0};
  state.seasonNumber=completedSeason+1;state.gameDay=1;state.seasonRating=0;state.seasonMatchAwards=[];
  state.lastCalendarEvent="Начался новый сезон "+state.seasonNumber+". Общий рейтинг сохранён; сезонный рейтинг нового сезона начинается с 0.";publishCoachEventOnce("season-start:"+state.seasonNumber,"news","Начался новый сезон",state.lastCalendarEvent,{priority:"high",important:true});
  updateCoachRespect();saveState();render();alert(state.lastCalendarEvent);return
}
 state.gameDay=Number(state.gameDay||1)+1;
 const currentSeason=Number(state.seasonNumber)||1;
 if(state.gameDay===63)announceCupDraw(currentSeason);
 if(state.gameDay===78)runCupRound("quarterfinals");
 if(state.gameDay===85)runCupRound("semifinals");
 if(state.gameDay===92)runCupRound("finals");
 let note="";
 if(state.gameDay===71)note="Начался перерыв между кругами. Следующий тур состоится в день 108.";
 if(state.gameDay===101)note="Перерыв завершён скоро: второй круг начнётся в день 108.";
 if(state.gameDay===182)note="Сезон завершён. Завтра начнётся новый сезон.";
 state.lastCalendarEvent=note;if(note)publishCoachEventOnce("calendar:"+state.seasonNumber+":"+state.gameDay,"news","Событие календаря",note);
 if(Number(state.gameDay)%3===0){ensureCoachCommunicationState();const recent=state.coachChronicle.filter(x=>Number(x.season)===Number(state.seasonNumber)&&Number(x.day)>=Number(state.gameDay)-2&&Number(x.day)<=Number(state.gameDay)&&!String(x.key||"").startsWith("digest:"));if(recent.length)publishCoachEventOnce("digest:"+state.seasonNumber+":"+state.gameDay,"news","Сводка за последние 3 игровых дня","За последние игровые дни произошло событий: "+recent.length+". Последние события: "+recent.slice(0,3).map(x=>x.title).join("; ")+".",{priority:"normal"})}
 saveState();render();
 if(note)alert(note);
}
function matchTeamLabel(team){return team?.isUserTeam?(state.teamName||team.name):team?.name||"Команда"}
function makeMatchPortrait(player,team){
 const img=document.createElement("img");img.className="match-player-photo";img.src=getPortrait(player.portraitIndex||teamsPlayerIndex(team,player));img.alt=player.name;img.loading="lazy";img.onerror=()=>{img.src="/images/portretplayers/portret1.jpg"};return img;
}
function matchPositionCoordinates(lineup,side){
 const roleCount={};return lineup.map((entry,index)=>{
  const role=entry.role;roleCount[role]=(roleCount[role]||0)+1;
  const same=lineup.filter(x=>x.role===role).length,order=roleCount[role]-1;
  const ys=same===1?[50]:same===2?[36,64]:same===3?[25,50,75]:[20,40,60,80];
  const xByRole={"ВР":8,"ЗЩ":25,"ПЗ":39,"НП":47};
  let x=xByRole[role]??35;if(side==="away")x=100-x;
  return {...entry,x,y:ys[order]||50,index};
 });
}
function createSpectatorPanel(session,home,away){
 const box=document.createElement("aside");box.className="match-spectators compact-spectators";
 box.append(safeText("h3","НА ТРИБУНАХ"),safeText("p","Небольшая компания болельщиков следит за матчем.","muted"));
 const comments=[
  "На трибуне мама одного из футболистов громко поддерживает сына.",
  "У ограждения замечены отец игрока и его друзья.",
  "Несколько футболистов из соседнего двора наблюдают за соперниками.",
  "На трибуне обсуждают тактику тренеры других команд.",
  "Болельщики спорят, был ли фол перед опасным моментом.",
  "Ребята с соседней площадки аплодируют красивому сейву.",
  "Кто-то из родителей снимает матч на телефон.",
  "У бровки замечен тренер команды из Верхней лиги."
 ];
 const chosen=[comments[(session.round+session.minute+1)%comments.length],comments[(session.round*3+session.minute+4)%comments.length]];
 chosen.forEach((s,i)=>box.append(safeText("p","• "+s,"spectator-note")));
 return box;
}
function renderTacticalPitch(session,home,away){
 const field=document.createElement("div");field.className="official-match-pitch";
 const center=document.createElement("div");center.className="match-pitch-center";
 const circle=document.createElement("div");circle.className="match-pitch-circle";center.append(circle);field.append(center);
 [["home",home,session.lineups.home,"home"],["away",away,session.lineups.away,"away"]].forEach(([side,team,lineup])=>{
  matchPositionCoordinates(lineup.filter(x=>!x.sentOff),side).forEach(item=>{
   const marker=document.createElement("div");marker.className="match-pitch-player "+side;marker.style.left=item.x+"%";marker.style.top=item.y+"%";
   marker.append(makeMatchPortrait(item.player,team));
   const role=document.createElement("span");role.className="match-position-badge";role.textContent=item.role;marker.append(role);
   const name=document.createElement("small");name.textContent=item.player.name;marker.append(name);
   marker.title=item.player.name+" — "+item.role;field.append(marker);
  });
 });
 return field;
}
function chooseAttackingSide(session){
 const home=session.lineups.home.filter(x=>!x.sentOff),away=session.lineups.away.filter(x=>!x.sentOff);
 const power=arr=>arr.reduce((n,x)=>n+matchPlayerScore(x.player,x.role)*.7+matchPlayerScore(x.player,"ПЗ")*.3,0)/Math.max(1,arr.length);
 const homeP=power(home),awayP=power(away);
 return Math.random()<(homeP/(homeP+awayP||1))?"home":"away";
}
function isImportantMatchEvent(event){return Boolean(event&&(event.type==="goal"||event.card==="yellow"||event.card==="red"||event.type==="injury"||event.injury));}
function getEventTeamSide(event){return event?.type==="goal"?(event.scoringSide||event.side):event?.side||null;}
function deriveMatchStats(session){const events=session.events||[],stats={home:{shots:0,onTarget:0,possessionMinutes:0},away:{shots:0,onTarget:0,possessionMinutes:0}};const minutes=Math.max(1,Math.min(40,Number(session.minute)||40)),hp=Number(session.matchStats?.home?.possessionMinutes)||0,ap=Number(session.matchStats?.away?.possessionMinutes)||0,total=hp+ap||1;stats.home.possessionMinutes=Math.round(minutes*hp/total);stats.away.possessionMinutes=minutes-stats.home.possessionMinutes;events.forEach(e=>{const side=getEventTeamSide(e);if(!stats[side])return;if(e.shot===true||["goal","save","chance","penalty"].includes(e.type))stats[side].shots++;if(e.onTarget===true||["goal","save"].includes(e.type))stats[side].onTarget++;});["home","away"].forEach(side=>{const goals=events.filter(e=>e.type==="goal"&&getEventTeamSide(e)===side).length;stats[side].shots=Math.max(stats[side].shots,goals);stats[side].onTarget=Math.max(stats[side].onTarget,goals);});return stats;}
function calculateMatchPlayerRatings(session){
 const counts={home:{goals:new Map(),assists:new Map()},away:{goals:new Map(),assists:new Map()}};
 (session.events||[]).filter(e=>e.type==="goal").forEach(e=>{const side=getEventTeamSide(e);if(!counts[side])return;if(e.scorer)counts[side].goals.set(e.scorer,(counts[side].goals.get(e.scorer)||0)+1);if(e.assist)counts[side].assists.set(e.assist,(counts[side].assists.get(e.assist)||0)+1);});
 return ["home","away"].flatMap(side=>(session.lineups?.[side]||[]).map(entry=>{const p=entry.player||entry,goals=counts[side].goals.get(p.name)||0,assists=counts[side].assists.get(p.name)||0;return {playerName:p.name,side,played:true,goals,assists,rating:Math.min(10,6+goals+assists)};}));
}
function applyPostMatchSkillGrowth(session,ownSide,result){if(result.skillGrowth)return result.skillGrowth;const team=getUserTeam();if(!team)return {changes:[]};const active=(session.lineups?.[ownSide]||[]).filter(e=>!e.sentOff).map(e=>e.player||e).filter(p=>p&&team.players.some(x=>(x.careerId||x.name)===(p.careerId||p.name)));const changes=[],grow=(p,reason)=>{const keys=["ВР","ЗЩ","ПЗ","НП"],skill=keys[Math.floor(Math.random()*keys.length)];p.skills=p.skills||{};const before=Number(p.skills[skill]||0),after=Math.min(100,before+1);p.skills[skill]=after;changes.push({playerName:p.name,skill,before,after,reason});};const own=ownSide==="home"?result.homeScore:result.awayScore,opp=ownSide==="home"?result.awayScore:result.homeScore;if(own>opp){const pool=[...active];for(let i=0;i<3&&pool.length;i++)grow(pool.splice(Math.floor(Math.random()*pool.length),1)[0],"Победа команды");}else if(active.length){const ratings=new Map((result.playerRatings||[]).filter(x=>x.played).map(x=>[x.playerName,Number(x.rating)||6]));const best=Math.max(...active.map(p=>ratings.get(p.name)||6)),pool=active.filter(p=>(ratings.get(p.name)||6)===best);grow(pool[Math.floor(Math.random()*pool.length)],own===opp?"Ничья":"Поражение");}result.skillGrowth=changes;return changes;}
function createMatchEvent(session,home,away,minute){
 const pick=arr=>arr.length?arr[Math.floor(Math.random()*arr.length)]:null;
 const active=side=>(session.lineups[side]||[]).filter(x=>!x.sentOff);
 const power=side=>{const arr=active(side);return arr.reduce((sum,e)=>sum+matchPlayerScore(e.player,e.role)*.7+matchPlayerScore(e.player,"ПЗ")*.3,0)/Math.max(1,arr.length)};
 const homePower=power("home"),awayPower=power("away");
 const side=Math.random()<(homePower/(homePower+awayPower||1))?"home":"away";
 const defSide=side==="home"?"away":"home",attack=active(side),defence=active(defSide);
 const attackTeam=side==="home"?home:away,defTeam=side==="home"?away:home;
 const tactic=session.tactics?.[side]||session.formationTactics?.[side]||(side==="home"?(session.tactic||"balanced"):"balanced");
 const defenceTactic=session.tactics?.[defSide]||session.formationTactics?.[defSide]||(defSide==="home"?(session.tactic||"balanced"):"balanced");
 const forward=attack.filter(x=>x.role==="НП"||x.role==="ПЗ"),scorer=pick(forward.length?forward:attack);
 const helpers=attack.filter(x=>x!==scorer),helper=pick(helpers);
 const keeper=defence.find(x=>x.role==="ВР")||pick(defence);
 const scoreSkill=entry=>Math.max(1,matchPlayerScore(entry?.player,entry?.role));
 const avgAttack=attack.reduce((n,x)=>n+scoreSkill(x),0)/Math.max(1,attack.length);
 const avgDefence=defence.reduce((n,x)=>n+scoreSkill(x),0)/Math.max(1,defence.length);
 session.matchStats=session.matchStats||{home:{shots:0,onTarget:0,possessionMinutes:0,attacks:0,corners:0},away:{shots:0,onTarget:0,possessionMinutes:0,attacks:0,corners:0}};
 ["home","away"].forEach(k=>{session.matchStats[k].attacks=Number(session.matchStats[k].attacks)||0;session.matchStats[k].possessionMinutes=Number(session.matchStats[k].possessionMinutes)||0});
 session.matchStats[side].possessionMinutes++;session.matchStats[side].attacks++;
 const attackMode=["attack","attacking","press","pressing"].includes(String(tactic).toLowerCase());
 const defendMode=["defence","defense","defensive"].includes(String(defenceTactic).toLowerCase());
 let danger=.35+(avgAttack-avgDefence)/250+(attackMode?.12:0)-(defendMode?.10:0);
 danger=Math.max(.12,Math.min(.70,danger));
 let event;
 if(Math.random()<.09){
  const offender=pick(defence)||pick(attack);
  if(Math.random()<.08){
   event={minute,text:"ПЕНАЛЬТИ! Судья указывает на точку после нарушения в штрафной.",type:"penalty",side,shot:true,onTarget:false};
   const conversion=.55+(avgAttack-avgDefence)/300+(attackMode?.05:0);
   if(Math.random()<Math.min(.95,Math.max(.30,Math.min(.82,conversion))*2.5)&&scorer){event.text+=" "+scorer.player.name+" реализует пенальти — ГОЛ!"+(helper?" Ассист: "+helper.player.name+".":"");event.type="goal";event.scoringSide=side;event.shot=true;event.onTarget=true;event.scorer=scorer.player.name;event.assist=helper?.player.name||null;session.score[side]++}
   else event.text+=" Вратарь угадывает направление удара и спасает команду!";
  }else{
   event={minute,text:"Фол: "+(offender?.player.name||"Игрок")+" нарушает правила. Судья назначает штрафной.",type:"foul",side:defSide};
   if(Math.random()<.025){event.text+=" Судья показывает красную карточку.";event.card="red";event.player=offender?.player.name;if(offender)offender.sentOff=true}
   else if(Math.random()<.18){event.text+=" Жёлтая карточка за грубую игру.";event.card="yellow";event.player=offender?.player.name}
   if(Math.random()<.30&&scorer){event.text+=" Прямой удар со штрафного — гол! Автор: "+scorer.player.name+(helper?" (ассист: "+helper.player.name+")":"")+". ";event.type="goal";event.scoringSide=side;event.shot=true;event.onTarget=true;event.scorer=scorer.player.name;event.assist=helper?.player.name||null;session.score[side]++}
  }
 }else if(Math.random()<danger){
  const accuracy=Math.max(.25,Math.min(.78,.5+(avgAttack-50)/200+(attackMode?.06:0)));
  if(Math.random()<accuracy){
   const conversion=Math.min(.95,Math.max(.08,.28+(avgAttack-avgDefence)/230+(attackMode?.05:0)-(defendMode?.08:0))*2.5);
   if(Math.random()<conversion&&scorer){
    event={minute,text:"ГОЛ! "+scorer.player.name+" забивает за "+matchTeamLabel(attackTeam)+"!"+(helper?" Ассист: "+helper.player.name+".":""),type:"goal",scorer:scorer.player.name,assist:helper?.player.name||null,side,scoringSide:side,shot:true,onTarget:true};session.score[side]++;
   }else{
    event={minute,text:"Опасный удар! "+(scorer?.player.name||"Игрок атаки")+" бьёт по воротам, но "+(keeper?.player.name||"вратарь")+" спасает команду.",type:"save",side,shot:true,onTarget:true};
   }
  }else{
   event={minute,text:"Удар мимо ворот: "+(scorer?.player.name||"Игрок атаки")+" завершает атаку неточно.",type:"chance",side,shot:true,onTarget:false};
  }
  if(Math.random()<.30){session.matchStats[side].corners=(Number(session.matchStats[side].corners)||0)+1;event.text+=" Назначен угловой."}
 }else{
  const flavor=["Команда разыгрывает мяч через центр и ищет свободного игрока.","Пас на фланг, прострел в штрафную — защита перехватывает передачу.","Борьба в центре поля. Мяч переходит к сопернику.","Защитник вовремя читает передачу и начинает новую атаку.","Вратарь уверенно забирает навес и вводит мяч в игру.","Игроки прессингуют, тренер подсказывает команде с бровки."];
  event={minute,text:flavor[Math.floor(Math.random()*flavor.length)],type:"play",side};
 }
 if(event.type==="goal"&&!event.scorer&&scorer){event.scorer=scorer.player.name;event.assist=helper?.player.name||null}
 if(["goal","save","chance","penalty"].includes(event.type)){session.matchStats[side].shots++;if(["goal","save"].includes(event.type)||event.onTarget===true)session.matchStats[side].onTarget++}
 return event;
}
function autoAdvanceOfficialMatch(session,home,away){if(session.autoPlaying||session.finished||session.halfTime)return;session.autoPlaying=true;const step=()=>{if(state.officialMatchSession!==session||session.finished||session.halfTime){session.autoPlaying=false;saveState();if(!document.getElementById("pageView")?.classList.contains("hidden"))openPage("match");return}if(session.minute===0)session.events.push({minute:0,type:"play",text:"Судья даёт стартовый свисток. Начинается матч."});session.minute++;session.events.push(createMatchEvent(session,home,away,session.minute));if(session.minute===20){session.halfTime=true;session.events.push({minute:20,type:"halftime",text:"Свисток на перерыв. Тренер может разобрать ключевые эпизоды и сделать до трёх замен."});session.autoPlaying=false}if(session.minute>=40){session.events.push({minute:40,type:"fulltime",text:"Финальный свисток! Итоговый счёт "+session.score.home+":"+session.score.away+"."});session.autoPlaying=false;applyOfficialMatchResult(session,home,away);return}state.officialMatchSession=session;saveState();openPage("match");if(session.autoPlaying)setTimeout(step,7500)};setTimeout(step,400)}
function calculateOfficialMatchRelations(session,home,away,result){
 const userTeam=getUserTeam();
 if(!userTeam)return {changes:[],ratings:[]};
 const userIsHome=home.id===userTeam.id;
 const ownSide=userIsHome?"home":"away";
 const ownLineup=session.lineups?.[ownSide]||[];
 const allPlayers=userTeam.players||[];
 const goalsByName=new Map(),assistsByName=new Map();
 (session.events||[]).filter(e=>e.type==="goal"&&getEventTeamSide(e)===ownSide).forEach(e=>{
  if(e.scorer)goalsByName.set(e.scorer,(goalsByName.get(e.scorer)||0)+1);
  if(e.assist)assistsByName.set(e.assist,(assistsByName.get(e.assist)||0)+1);
 });
 const goalDiff=userIsHome?result.homeScore-result.awayScore:result.awayScore-result.homeScore;
 const teamBonus=goalDiff>0?0.5:goalDiff===0?0.25:0;
 const starters=new Set(ownLineup.map(x=>(x.player||x).name));
 const players=allPlayers.map(p=>{
  const goals=goalsByName.get(p.name)||0,assists=assistsByName.get(p.name)||0;
  const played=starters.has(p.name);
  const rating=played?Math.min(10,6+goals+assists):null;
  return {player:p,played,goals,assists,rating};
 });
 const performers=players.filter(x=>x.played);
 const bestScore=Math.max(0,...performers.map(x=>x.goals*2+x.assists));
 const changes=[];
 players.forEach(item=>{
  let personalBonus=0;
  if(item.played&&item.rating>=7)personalBonus+=0.5;
  if(item.played&&bestScore>0&&item.goals*2+item.assists===bestScore)personalBonus+=0.5;
  const raw=teamBonus+personalBonus;
  const delta=Math.min(2,Math.round(raw*100)/100);
  if(delta<=0)return;
  const key=playerRelationKey(userTeam,item.player);
  const before=getPlayerRelation(userTeam,item.player);
  const after=Math.min(100,Math.round((before+delta)*100)/100);
  state.relationships=state.relationships||{};
  state.relationships[key]=after;
  changes.push({playerId:item.player.id||null,playerName:item.player.name,played:item.played,rating:item.rating,teamBonus,personalBonus,delta:Math.round((after-before)*100)/100,before,after});
 });
 return {changes,ratings:players.map(x=>({playerName:x.player.name,played:x.played,rating:x.rating,goals:x.goals,assists:x.assists}))};
}
function applyOfficialMatchResult(session,home,away){
 if(session.finished)return;
 session.finished=true;session.finishedAtDay=Number(state.gameDay)||1;
 const fixture={home,away};const result={season:Number(state.seasonNumber)||1,round:session.round,day:session.day,homeId:home.id,awayId:away.id,homeScore:session.score.home,awayScore:session.score.away,events:session.events,homeLineup:session.lineups.home,awayLineup:session.lineups.away,substitutions:session.substitutions,finished:true};
 result.stats=deriveMatchStats(session);
 result.spectatorNotes=buildPostMatchSpectatorNotes(session,home,away);
 const relationshipReport=calculateOfficialMatchRelations(session,home,away,result);
 result.relationshipChanges=relationshipReport.changes;
 result.playerRatings=calculateMatchPlayerRatings(session);const ownSide=home.id===getUserTeam()?.id?"home":"away";result.skillGrowth=applyPostMatchSkillGrowth(session,ownSide,result);state.leagueResults=state.leagueResults||{};state.leagueResults[roundFixtureKey(session.round,fixture)]=result;
 state.lastMatchReport=result;
 publishCoachEventOnce("match:"+result.season+":"+result.round+":"+getUserTeam()?.id,"news","Матч завершён",matchTeamLabel(getUserTeam())+" сыграли "+(getUserTeam()?.id===result.homeId?result.homeScore+" : "+result.awayScore:result.awayScore+" : "+result.homeScore)+". Отчёт матча сохранён.",{priority:"high",important:true});
 ensureAllLeagueRoundResults(session.round,fixture,result);
 state.careerHistory=state.careerHistory||{officialMatches:[],seasons:{}};
 state.careerHistory.officialMatches=Array.isArray(state.careerHistory.officialMatches)?state.careerHistory.officialMatches:[];
 state.careerHistory.officialMatches.push({season:result.season,round:result.round,day:result.day,at:Date.now(),homeId:home.id,awayId:away.id,homeScore:result.homeScore,awayScore:result.awayScore,goalsFor:home.id===getUserTeam()?.id?result.homeScore:result.awayScore,goalsAgainst:home.id===getUserTeam()?.id?result.awayScore:result.homeScore,result:((home.id===getUserTeam()?.id?result.homeScore-result.awayScore:result.awayScore-result.homeScore)>0)?"W":(result.homeScore===result.awayScore?"D":"L"),events:result.events,substitutions:result.substitutions});
 awardOfficialMatchRating(result,fixture);
 updateCoachRespect();
 state.officialMatchSession=null;saveState();render();openPage("matchSummary");
}
function buildPostMatchSpectatorNotes(session,home,away){
 const crowd=[
  "Мама одного из футболистов громче всех поддерживала команду.",
  "Отец одного из игроков после финального свистка обсуждал спорный эпизод у ворот.",
  "На трибуне замечены футболисты соседнего двора — они внимательно следили за игрой.",
  "Тренер другой команды записывал удачные розыгрыши и работу защитников.",
  "После красивого сейва зрители за ограждением дружно зааплодировали.",
  "Ребята с соседней площадки спорили, кому стоило отдать передачу в решающем эпизоде.",
  "Несколько родителей снимали концовку встречи на телефоны.",
  "Юные болельщики повторяли имена авторов голевых моментов."
 ];
 const seed=Math.abs(Math.floor(Number(session.spectatorSeed||0)*100000));
 return [crowd[seed%crowd.length],crowd[(seed+session.round+session.minute+3)%crowd.length]];
}
function renderMatchSummaryPage(){
 const wrap=document.createElement("div");wrap.className="match-summary-view";
 const result=state.lastMatchReport;
 if(!result){wrap.append(safeText("h2","Итоги встречи пока недоступны"),safeText("p","После завершения официального матча здесь появится подробный отчёт.","muted"),matchButton("К турнирам",()=>openPage("league"),"secondary"));return wrap}
 const home=getTeamForMatch(result.homeId),away=getTeamForMatch(result.awayId),ownId=getUserTeam()?.id;
 const header=document.createElement("section");header.className="match-summary-score panel";
 header.append(safeText("p","СЕЗОН "+result.season+" · ТУР "+result.round+" · ДЕНЬ "+result.day,"eyebrow"));
 const scoreline=document.createElement("div");scoreline.className="match-summary-scoreline";
 const side=(team,score)=>{const el=document.createElement("div");el.className="match-summary-team";const src=teamLogoSource(team);if(src){const img=document.createElement("img");img.src=src;img.alt="";img.className="tournament-team-logo";img.onerror=()=>img.remove();el.append(img)}el.append(safeText("b",matchTeamLabel(team)),safeText("strong",String(score)));return el};
 scoreline.append(side(home,result.homeScore),safeText("span","—","match-summary-divider"),side(away,result.awayScore));header.append(scoreline,safeText("p",result.homeScore>result.awayScore?matchTeamLabel(home)+" победили":result.homeScore<result.awayScore?matchTeamLabel(away)+" победили":"Ничья","match-summary-outcome"));
 const goals=(result.events||[]).filter(e=>e.type==="goal");
 const goalsPanel=document.createElement("section");goalsPanel.className="panel match-summary-panel";goalsPanel.append(safeText("h2","Голы и ключевые моменты"));
 if(!goals.length)goalsPanel.append(safeText("p","Встреча завершилась без голов.","muted"));
 goals.forEach(e=>{const row=document.createElement("div");row.className="match-summary-goal";row.append(safeText("b",e.minute+"'"),safeText("span","⚽ "+(e.scorer||"Автор гола не указан")+(e.assist?" · пас: "+e.assist:"")));goalsPanel.append(row)});
 const stats=result.stats||{home:{shots:0,onTarget:0,possessionMinutes:0},away:{shots:0,onTarget:0,possessionMinutes:0}};
 const h=stats.home||{},a=stats.away||{},total=(Number(h.possessionMinutes)||0)+(Number(a.possessionMinutes)||0)||1;
 const statsPanel=document.createElement("section");statsPanel.className="panel match-summary-panel";statsPanel.append(safeText("h2","Статистика матча"));
 const table=document.createElement("div");table.className="match-summary-stats";
 const addStat=(label,left,right)=>{const row=document.createElement("div");row.className="match-summary-stat-row";row.append(safeText("b",String(left)),safeText("span",label),safeText("b",String(right)));table.append(row)};
 addStat("Удары",h.shots||0,a.shots||0);addStat("Удары в створ",h.onTarget||0,a.onTarget||0);
 addStat("Владение мячом",Math.round((h.possessionMinutes||0)/total*100)+"%",Math.round((a.possessionMinutes||0)/total*100)+"%");
 const countSide=(side,predicate)=>(result.events||[]).filter(e=>e.side===side&&predicate(e)).length;
 addStat("Угловые",countSide("home",e=>e.type==="corner"),countSide("away",e=>e.type==="corner"));
 addStat("Фолы",countSide("home",e=>e.type==="foul"),countSide("away",e=>e.type==="foul"));
 addStat("Офсайды",countSide("home",e=>e.type==="offside"),countSide("away",e=>e.type==="offside"));
 addStat("Сейвы вратарей",countSide("home",e=>e.type==="save"),countSide("away",e=>e.type==="save"));
 addStat("Жёлтые карточки",countSide("home",e=>e.card==="yellow"),countSide("away",e=>e.card==="yellow"));
 addStat("Красные карточки",countSide("home",e=>e.card==="red"),countSide("away",e=>e.card==="red"));
 statsPanel.append(table);
 const lineups=document.createElement("section");lineups.className="panel match-summary-panel";lineups.append(safeText("h2","Составы и голы игроков"));
 const list=document.createElement("div");list.className="match-summary-lineups";
 [[home,result.homeLineup||[]],[away,result.awayLineup||[]]].forEach(([team,entries])=>{
  const col=document.createElement("div");col.className="match-summary-lineup";col.append(safeText("h3",matchTeamLabel(team)));
  entries.forEach(entry=>{const player=entry.player||entry;const row=document.createElement("div");row.className="match-summary-player";row.append(makeMatchPortrait(player,team),safeText("span",player.name+" · "+(entry.role||player.position||"—")));const side=team.id===result.homeId?"home":"away",marks=goals.filter(g=>getEventTeamSide(g)===side&&g.scorer===player.name).length,rating=(result.playerRatings||[]).find(r=>r.side===side&&r.playerName===player.name)?.rating;if(Number.isFinite(rating))row.append(safeText("b","★ "+rating.toFixed(1)));if(marks)row.append(safeText("b","⚽ "+marks));col.append(row)});
  list.append(col);
 });lineups.append(list);
 const spectators=document.createElement("section");spectators.className="panel match-summary-panel";spectators.append(safeText("h2","Что обсуждали на трибунах"));
 (result.spectatorNotes||[]).forEach(note=>spectators.append(safeText("p","💬 "+note,"spectator-note")));
 const eventsPanel=document.createElement("section");eventsPanel.className="panel match-summary-panel";eventsPanel.append(safeText("h2","Важные события матча"));
 (result.events||[]).filter(isImportantMatchEvent).slice().reverse().forEach(e=>{const row=document.createElement("div");row.className="match-summary-event";row.append(safeText("b",e.minute+"'"),safeText("span",e.text));eventsPanel.append(row)});if(!eventsPanel.querySelector(".match-summary-event"))eventsPanel.append(safeText("p","Голов, карточек и травм в матче не было.","muted"));
 const growthPanel=document.createElement("section");growthPanel.className="panel match-summary-panel";growthPanel.append(safeText("h2","Развитие футболистов после матча"));if(result.skillGrowth?.length){result.skillGrowth.forEach(change=>{const row=document.createElement("div");row.className="match-summary-event";row.append(safeText("b","+1 "+change.skill),safeText("span",change.playerName+" · "+change.before+" → "+change.after+" · "+change.reason));growthPanel.append(row)})}else growthPanel.append(safeText("p","Показатели не изменились.","muted"));
 const relationPanel=document.createElement("section");relationPanel.className="panel match-summary-panel";relationPanel.append(safeText("h2","Изменения отношений"));
 if(result.relationshipChanges?.length){result.relationshipChanges.forEach(change=>{const row=document.createElement("div");row.className="match-summary-event";row.append(safeText("b",change.delta>0?"+"+change.delta.toFixed(2).replace(".",",")+" п.п.":"0 п.п."),safeText("span",change.playerName+" · "+change.before.toFixed(2).replace(".",",")+"% → "+change.after.toFixed(2).replace(".",",")+"%"+(change.played?" · играл":" · командный бонус")));relationPanel.append(row)})}
 else relationPanel.append(safeText("p","Отношения не изменились.","muted"));
 relationPanel.append(safeText("p","Командный бонус: победа +0,50 п.п., ничья +0,25 п.п., поражение +0. Личный бонус: оценка от 7,0 — +0,50 п.п.; лучший игрок матча — ещё +0,50 п.п. Запасные получают командный бонус. Максимум +2 п.п. на игрока за матч.","muted"));
 const roundPanel=document.createElement("section");roundPanel.className="panel match-summary-panel";roundPanel.append(safeText("h2","Другие результаты тура"));
 getOfficialRoundFixtures(result.round).forEach(f=>{const key=roundFixtureKey(result.round,f),r=state.leagueResults?.[key];roundPanel.append(tournamentMatchRow(result.round,f,r,f.home.id===ownId||f.away.id===ownId))});
 const actions=document.createElement("div");actions.className="match-summary-actions";actions.append(matchButton("К ТУРНИРНОЙ ТАБЛИЦЕ",()=>openPage("league"),"primary"),matchButton("ВЕРНУТЬСЯ НА ГЛАВНУЮ",()=>{$("pageView").classList.add("hidden");$("dashboard").classList.remove("hidden")},"secondary"));
 wrap.append(actions,roundPanel,header,goalsPanel,statsPanel,lineups,spectators,eventsPanel,relationPanel,growthPanel);return wrap;
}
function renderMatchPage(){
 const wrap=document.createElement("div");wrap.className="official-match-view";
 if(!leagueData){wrap.append(placeholder("Загружаю календарь и составы…"));return wrap}
 let session=state.officialMatchSession;
 if(!session){
  const round=officialRoundForDay(Number(state.gameDay)||1),fixture=currentOfficialFixture();
  if(!round||!fixture){wrap.append(safeText("h2","Сегодня нет официального матча"),safeText("p","Матчи назначены по календарю сезона. Продолжай календарь кнопкой «Пропустить день».","muted"));wrap.append(matchButton("Вернуться на главную",()=>{$("pageView").classList.add("hidden");$("dashboard").classList.remove("hidden")},"secondary"));return wrap}
  const existing=state.leagueResults?.[roundFixtureKey(round,fixture)];
  if(existing){wrap.append(safeText("h2","Матч тура "+round+" уже завершён"),safeText("p",matchTeamLabel(fixture.home)+" "+existing.homeScore+":"+existing.awayScore+" "+matchTeamLabel(fixture.away)));wrap.append(matchButton("К календарю",()=>openPage("league"),"primary"));return wrap}
  const formation="2–2–1";const setup=document.createElement("section");setup.className="match-setup panel";setup.append(safeText("p","СЕЗОН "+state.seasonNumber+" · ТУР "+round+" · ДЕНЬ "+state.gameDay,"eyebrow"));const matchup=document.createElement("div");matchup.className="match-setup-matchup";[[fixture.home,"home"],[fixture.away,"away"]].forEach(([team,side])=>{const item=document.createElement("div");item.className="match-setup-team "+side;const src=teamLogoSource(team);if(src){const img=document.createElement("img");img.src=src;img.alt="";img.className="match-setup-logo";item.append(img)}item.append(safeText("b",matchTeamLabel(team)));matchup.append(item);if(side==="home")matchup.append(safeText("span","VS","match-setup-vs"))});setup.append(matchup,safeText("p","Выбери тактику и назначь шесть разных футболистов. Схема задаёт роли, а не фиксированный состав.","muted"));const formationLabel=safeText("label","Тактика / расстановка");formationLabel.className="match-formation-label";const formationSelect=document.createElement("select");formationSelect.className="match-formation-select";Object.keys(MATCH_FORMATIONS).forEach(f=>{const o=document.createElement("option");o.value=f;o.textContent=f+" · "+({"2–2–1":"Сбалансированная","2–1–2":"Атакующая","1–3–1":"Контроль центра","3–1–1":"Оборонительная"}[f]);formationSelect.append(o)});const slots=document.createElement("div");slots.className="match-lineup-slots";const preview=document.createElement("div");preview.className="match-lineup-preview";const status=safeText("p","","match-lineup-status");const myTeam=getUserTeam(),roster=(myTeam?.players||[]).slice();let startButton;const drawPreview=(preserve=false)=>{const prev=preserve?[...slots.querySelectorAll("select")].map(x=>x.value):[];slots.replaceChildren();preview.replaceChildren();const defaults=buildOfficialLineup(myTeam,formationSelect.value);defaults.forEach((entry,i)=>{const row=document.createElement("label");row.className="match-lineup-slot";row.append(safeText("span",entry.role+" · "+(entry.role==="ВР"?"Вратарь":"Полевой игрок")));const sel=document.createElement("select");sel.className="league-select";roster.forEach(p=>{const o=document.createElement("option");o.value=p.careerId||p.name;o.textContent=p.name+" · "+p.position;o.selected=prev[i]?(prev[i]===(p.careerId||p.name)):p===entry.player;sel.append(o)});sel.addEventListener("change",()=>drawPreview(true));row.append(sel);slots.append(row)});const chosen=[...slots.querySelectorAll("select")].map(sel=>roster.find(p=>(p.careerId||p.name)===sel.value)).filter(Boolean),invalid=chosen.length!==6||new Set(chosen.map(p=>p.careerId||p.name)).size!==6;status.textContent=invalid?"Выбери шесть разных футболистов.":"На поле выбрано 6 из "+roster.length+" игроков.";status.classList.toggle("error-text",invalid);defaults.forEach((entry,i)=>{const p=chosen[i]||entry.player,card=document.createElement("div");card.className="match-lineup-card";card.append(makeMatchPortrait(p,myTeam),safeText("b",p.name),safeText("small",entry.role,"match-role-tag"));preview.append(card)});if(startButton)startButton.disabled=invalid};formationSelect.addEventListener("change",()=>drawPreview(false));formationLabel.append(formationSelect);setup.append(formationLabel,slots,status,preview);startButton=matchButton("НАЧАТЬ МАТЧ",()=>{const form=formationSelect.value,userHome=fixture.home.isUserTeam,homeTeam=fixture.home,awayTeam=fixture.away,defaults=buildOfficialLineup(getUserTeam(),form),chosen=[...slots.querySelectorAll("select")].map(sel=>roster.find(p=>(p.careerId||p.name)===sel.value)).filter(Boolean);if(chosen.length!==6||new Set(chosen.map(p=>p.careerId||p.name)).size!==6){alert("Выбери шесть разных футболистов.");return}const mine=defaults.map((entry,i)=>({player:chosen[i],role:entry.role,sentOff:false})),opponent=buildOfficialLineup(userHome?awayTeam:homeTeam,form);session={season:Number(state.seasonNumber)||1,round,day:Number(state.gameDay)||1,homeId:homeTeam.id,awayId:awayTeam.id,formation:form,minute:0,half:1,halfTime:false,finished:false,score:{home:0,away:0},lineups:{home:userHome?mine:opponent,away:userHome?opponent:mine},events:[],substitutions:0,substitutedOut:[],spectatorSeed:Math.random(),matchStats:{home:{shots:0,onTarget:0,possessionMinutes:0,attacks:0,corners:0},away:{shots:0,onTarget:0,possessionMinutes:0,attacks:0,corners:0}}};state.officialMatchSession=session;saveState();openPage("match")},"primary");setup.append(startButton);drawPreview();wrap.append(setup);return wrap
 }
 const home=getTeamForMatch(session.homeId),away=getTeamForMatch(session.awayId);
 if(!home||!away){wrap.append(placeholder("Не удалось восстановить составы матча."));return wrap}
 const header=document.createElement("section");header.className="match-scoreboard panel";
 header.append(safeText("p","СЕЗОН "+session.season+" · ТУР "+session.round+" · "+session.day+" ДЕНЬ","eyebrow"));
 const scoreline=document.createElement("div");scoreline.className="match-scoreline";
 const homeName=document.createElement("div");homeName.className="match-score-team";const homeLogo=teamLogoSource(home);if(homeLogo){const img=document.createElement("img");img.src=homeLogo;img.alt="";img.className="match-score-logo";homeName.append(img)}homeName.append(safeText("b",matchTeamLabel(home)));
 const score=safeText("strong",session.score.home+" : "+session.score.away);score.className="match-score-number";
 const awayName=document.createElement("div");awayName.className="match-score-team";const awayLogo=teamLogoSource(away);if(awayLogo){const img=document.createElement("img");img.src=awayLogo;img.alt="";img.className="match-score-logo";awayName.append(img)}awayName.append(safeText("b",matchTeamLabel(away)));
 scoreline.append(homeName,score,awayName);header.append(scoreline,safeText("p",session.finished?"МАТЧ ЗАВЕРШЁН":session.halfTime?"ПЕРЕРЫВ · ВАЖНЫЕ МОМЕНТЫ ТАЙМА":"МИНУТА "+session.minute+" / 40","match-clock"));
 const body=document.createElement("div");body.className="match-main-columns";
 const eventPanel=document.createElement("section");eventPanel.className="match-events-panel panel";
 eventPanel.append(safeText("h3","ВАЖНЫЕ МОМЕНТЫ"));
 const eventList=document.createElement("div");eventList.className="match-event-list";
 session.events.filter(isImportantMatchEvent).slice().reverse().forEach(ev=>{const row=document.createElement("article");row.className="match-event "+(ev.type||"play");row.append(safeText("b",ev.minute+"'"),safeText("span",ev.text));eventList.append(row)});
 if(!session.events.length)eventList.append(safeText("p","Матч ещё не начался. Нажми «НАЧАТЬ МАТЧ».","muted"));
 eventPanel.append(eventList);
 const spectators=createSpectatorPanel(session,home,away);
 body.append(spectators);
 const pitch=renderTacticalPitch(session,home,away);
 const actions=document.createElement("div");actions.className="match-control-row match-control-row-top";
 if(!session.finished&&!session.halfTime)actions.append(matchButton("▶ НАЧАТЬ МАТЧ",()=>autoAdvanceOfficialMatch(session,home,away),"primary"));
 wrap.append(actions,header,eventPanel,pitch,body);
 if(session.halfTime&&!session.finished){
  const ht=document.createElement("section");ht.className="halftime-panel panel";ht.append(safeText("h2","ПЕРЕРЫВ — ВАЖНЫЕ МОМЕНТЫ ТАЙМА"));
  const firstHalf=session.events.filter(e=>e.minute<=20&&isImportantMatchEvent(e));
  if(firstHalf.length){firstHalf.slice(-6).reverse().forEach(ev=>ht.append(safeText("p",ev.minute+"' · "+ev.text,"halftime-event")))}else ht.append(safeText("p","В первом тайме опасных моментов не было."));
  ht.append(safeText("p","Замены: "+session.substitutions+" из 3. Можно заменить игроков любой позиции; вышедший игрок больше не возвращается.","muted"));
  const choices=document.createElement("div");choices.className="match-substitution-list";
  const usedOut=new Set(session.substitutedOut||[]);
  ["home","away"].forEach(side=>{
   const team=side==="home"?home:away;if(!team.isUserTeam)return;
   const line=session.lineups[side];const bench=(team.players||[]).filter(p=>!line.some(x=>x.player.name===p.name)&&!usedOut.has(p.name));
   line.filter(x=>!x.sentOff).forEach(entry=>{
    const row=document.createElement("div");row.className="match-substitution-row";
    row.append(makeMatchPortrait(entry.player,team),safeText("span",entry.role+" · "+entry.player.name));
    const select=document.createElement("select");select.className="match-substitution-select";const blank=document.createElement("option");blank.value="";blank.textContent="Без замены";select.append(blank);
    bench.forEach(p=>{const o=document.createElement("option");o.value=p.name;o.textContent=entry.role+" ← "+p.name+" ("+p.position+")";select.append(o)});
    const go=matchButton("Заменить",()=>{
     if(session.substitutions>=3){alert("За матч разрешено не более трёх замен.");return}
     const name=select.value;if(!name)return;
     const incoming=bench.find(p=>p.name===name);if(!incoming)return;
     session.substitutedOut=session.substitutedOut||[];session.substitutedOut.push(entry.player.name);
     entry.player=incoming;entry.sentOff=false;session.substitutions++;state.officialMatchSession=session;saveState();openPage("match");
    },"secondary");go.disabled=session.substitutions>=3||bench.length===0;row.append(select,go);choices.append(row)
   });
  });
  ht.append(choices,matchButton("НАЧАТЬ ВТОРОЙ ТАЙМ",()=>{session.halfTime=false;session.half=2;state.officialMatchSession=session;saveState();openPage("match")},"primary"),matchButton("АВТОМАТИЧЕСКИ СЫГРАТЬ ВТОРОЙ ТАЙМ",()=>{session.halfTime=false;session.half=2;session.autoPlaying=false;state.officialMatchSession=session;saveState();autoAdvanceOfficialMatch(session,home,away)},"secondary"));wrap.append(ht)
 }else if(!session.finished){/* Кнопка запуска находится над табло. */
 }else{
  wrap.append(safeText("h2","Матч завершён"),matchButton("К календарю",()=>openPage("league"),"primary"))
 }
 return wrap
}

function displayTeamName(team){
 const name=matchTeamLabel(team);
 return name.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+$/u,"").trim();
}
function teamLogoSource(team){
 if(team?.isUserTeam||team?.id===getUserTeam()?.id||team?.name==="{teamName}")return teamLogoPath(state.teamLogoIndex||1);
 return team?.logo?"/images/logoteams/"+team.logo+".jpg":"";
}
function makeTournamentTeamLink(team){
 const button=document.createElement("button");button.type="button";button.className="tournament-team-link";
 const src=teamLogoSource(team);
 if(src){const img=document.createElement("img");img.className="tournament-team-logo";img.src=src;img.alt="";img.loading="lazy";img.onerror=()=>img.remove();button.append(img)}
 button.append(safeText("span",displayTeamName(team)));
 button.addEventListener("click",()=>{openPage("players");setTimeout(()=>{const select=document.querySelector("#pageContent .filter-row select");if(select&&team?.id){select.value=team.id;select.dispatchEvent(new Event("change"))}},0)});
 return button;
}
function makeTournamentPlayerLink(playerName,teamId){
 const button=document.createElement("button");button.type="button";button.className="tournament-player-link";button.textContent=playerName||"—";
 button.addEventListener("click",()=>{
  const teams=(leagueData?.teams||[]).map(t=>t.isUserTeam?getUserTeam():t).filter(Boolean);
  let found=null,idx=-1;
  for(const team of teams){const i=(team.players||[]).findIndex(p=>p.name===playerName&&(!teamId||team.id===teamId));if(i>=0){found={team,player:team.players[i]};idx=i;break}}
  if(!found){for(const team of teams){const i=(team.players||[]).findIndex(p=>p.name===playerName);if(i>=0){found={team,player:team.players[i]};idx=i;break}}}
  if(found)openPlayerProfile(found.team,found.player,idx);
  else alert("Профиль футболиста пока не найден в составах лиги.");
 });
 return button;
}
function makeTournamentCoachLink(team){
 const button=document.createElement("button");button.type="button";button.className="tournament-player-link";button.textContent=team?.coach||"Тренер";
 button.addEventListener("click",()=>openTournamentCoachProfile(team));return button;
}
function openTournamentCoachProfile(team){
 const wrap=document.createElement("div");wrap.className="coach-profile";
 const back=matchButton("← К турниру",()=>openPage("league"),"coach-profile-back");
 const head=document.createElement("section");head.className="coach-profile-head";
 const logoSrc=teamLogoSource(team);if(logoSrc){const img=document.createElement("img");img.className="tournament-team-logo coach-profile-logo";img.src=logoSrc;img.alt="";img.onerror=()=>img.remove();head.append(img)}
 const identity=document.createElement("div");identity.className="coach-profile-identity";
 identity.append(safeText("p","ПРОФИЛЬ ТРЕНЕРА","eyebrow"),safeText("h2",team?.coach||"Тренер"),safeText("p",displayTeamName(team),"coach-profile-team"),safeText("p",(team?.league||"Лига не указана")+" · Сезон "+(state.seasonNumber||1),"muted"));head.append(identity);
 const grid=document.createElement("div");grid.className="cabinet-metrics coach-profile-metrics";
 const matches=Object.values(state.leagueResults||{}).filter(m=>Number(m.season||state.seasonNumber)===Number(state.seasonNumber||1)&&(m.homeId===team?.id||m.awayId===team?.id));
 const totals=matches.reduce((a,m)=>{const home=m.homeId===team.id,forG=Number(home?m.homeScore:m.awayScore),against=Number(home?m.awayScore:m.homeScore);a.played++;a.wins+=forG>against?1:0;a.draws+=forG===against?1:0;a.losses+=forG<against?1:0;return a},{played:0,wins:0,draws:0,losses:0});
 [["Команда",displayTeamName(team)],["Лига",team?.league||"—"],["Матчи",totals.played],["Победы / ничьи / поражения",totals.wins+" / "+totals.draws+" / "+totals.losses],["Очки лиги",getCurrentStandings().find(x=>x.team.id===team?.id)?.pts??0]].forEach(([label,value])=>{const card=document.createElement("div");card.className="cabinet-metric";card.append(safeText("small",label),safeText("b",String(value)));grid.append(card)});
 wrap.append(back,head,grid,safeText("p","Профиль использует результаты текущего сезона. Данные других сезонов появятся по мере сохранения истории карьеры.","muted"));
 $("pageTitle").textContent=team?.coach||"Профиль тренера";$("pageEyebrow").textContent="ПРОФИЛЬ ТРЕНЕРА";$("pageContent").replaceChildren(wrap);
}
function tournamentMatchRow(round,fixture,result,own=false){
 const row=document.createElement("div");row.className="tournament-match-row"+(own?" is-user-fixture":"");
 const meta=safeText("span","Тур "+round+" · День "+(result?.day||officialRoundDay(round)),"tournament-match-meta");
 const matchup=document.createElement("div");matchup.className="tournament-matchup";
 matchup.append(makeTournamentTeamLink(fixture.home),safeText("b",result?result.homeScore+":"+result.awayScore:"—"),makeTournamentTeamLink(fixture.away));
 const status=safeText("span",result?(result.simulated?"Симуляция":"Завершён"):"Предстоит","tournament-match-status"+(result?" is-played":""));
 row.append(meta,matchup,status);return row;
}
function renderSeasonCalendar(){
 const wrap=document.createElement("div");wrap.className="season-calendar-page";
 const season=Number(state.seasonNumber||1),round=officialRoundForDay(Number(state.gameDay)||1);
 const leagueNames=["Нижняя лига","Верхняя лига"];
 const ownId=getUserTeam()?.id;
 const viewedLeague=leagueNames.includes(state.seasonCalendarLeague)?state.seasonCalendarLeague:(getUserTeam()?.league||"Нижняя лига");
 const header=document.createElement("section");header.className="panel calendar-panel";
 const heading=document.createElement("div");heading.className="section-title";heading.append(safeText("p",calendarDateText(),"eyebrow"),safeText("h2","Календарь сезона "+season));
 const leagueToggle=document.createElement("div");leagueToggle.className="tournament-league-toggle";
 leagueNames.forEach(name=>{const b=matchButton(name.toUpperCase(),()=>{state.seasonCalendarLeague=name;saveState();openPage("seasonCalendar")},"secondary");b.classList.toggle("active",name===viewedLeague);leagueToggle.append(b)});
 heading.append(leagueToggle);
 header.append(heading,safeText("p","Нажми на день тура, чтобы посмотреть все матчи этого тура. Дни матчей отмечены зелёным.","muted"));
 const roundPanel=document.createElement("div");roundPanel.className="tournament-selected-round";const days=document.createElement("div");days.className="season-calendar-grid";
 let selectedRound=round||1;
 const showRound=r=>{selectedRound=r;roundPanel.replaceChildren();if(!r){roundPanel.append(safeText("p","В этот день нет официального тура.","muted"));return}roundPanel.append(safeText("h3","Тур "+r+" · День "+officialRoundDay(r)));getOfficialRoundFixtures(r,viewedLeague).forEach(f=>roundPanel.append(tournamentMatchRow(r,f,state.leagueResults?.[roundFixtureKey(r,f)]||null,f.home.id===ownId||f.away.id===ownId)));};
 for(let day=1;day<=182;day++){
  const r=officialRoundForDay(day),b=document.createElement("button");b.type="button";b.className="season-calendar-day"+(day===Number(state.gameDay)?" current":"")+(r?" match-day":"")+(day>=71&&day<=101?" break-day":"")+(r&&r===selectedRound?" selected-round-day":"");
  b.append(safeText("b",String(day)));if(r)b.append(safeText("small","Тур "+r));else if(day>=71&&day<=101)b.append(safeText("small","Перерыв"));else if(day===182)b.append(safeText("small","Финиш"));
  b.addEventListener("click",()=>{days.querySelectorAll(".season-calendar-day").forEach(el=>el.classList.remove("selected-round-day"));b.classList.add("selected-round-day");showRound(r)});days.append(b)
 }
 header.append(days,roundPanel);wrap.append(header);showRound(selectedRound);
 const back=matchButton("← К ТУРНИРАМ",()=>openPage("league"),"secondary");back.classList.add("calendar-back-button");wrap.append(back);
 return wrap
}
function renderOtherRoundMatches(){
 const wrap=document.createElement("div");wrap.className="tournament-other-matches-page";
 const viewedLeague=["Нижняя лига","Верхняя лига"].includes(state.tournamentViewLeague)?state.tournamentViewLeague:"Нижняя лига";
 const round=officialRoundForDay(Number(state.gameDay)||1);
 const section=document.createElement("section");section.className="panel tournament-other-matches";
 const header=document.createElement("div");header.className="section-title";header.append(safeText("h2","Другие встречи · "+viewedLeague));
 const leagueToggle=document.createElement("div");leagueToggle.className="tournament-league-toggle";
 ["Нижняя лига","Верхняя лига"].forEach(name=>{const b=matchButton(name.toUpperCase(),()=>{state.tournamentViewLeague=name;saveState();openPage("otherRoundMatches")},"secondary");b.classList.toggle("active",name===viewedLeague);leagueToggle.append(b)});
 header.append(leagueToggle);section.append(header);
 for(let r=1;r<=20;r++){
  const details=document.createElement("details");details.className="tournament-round-details";details.open=r===round;
  const summary=document.createElement("summary");summary.textContent="Тур "+r+" · День "+officialRoundDay(r);details.append(summary);
  const list=document.createElement("div");list.className="tournament-round-list";
  getOfficialRoundFixtures(r,viewedLeague).forEach(f=>{const result=state.leagueResults?.[roundFixtureKey(r,f)]||null;list.append(tournamentMatchRow(r,f,result,f.home.id===getUserTeam()?.id||f.away.id===getUserTeam()?.id))});
  details.append(list);section.append(details)
 }
 wrap.append(section);
 wrap.append(matchButton("← К ТУРНИРАМ",()=>openPage("league"),"secondary"));
 return wrap
}
function renderLeague() {
 const wrap=document.createElement("div");wrap.className="league-calendar-view";
 if(!leagueData){wrap.append(placeholder("Загружаю данные лиг…"));return wrap}
 const season=Number(state.seasonNumber||1),round=officialRoundForDay(Number(state.gameDay)||1),fixture=currentOfficialFixture(),already=round&&fixture&&state.leagueResults?.[roundFixtureKey(round,fixture)];
 const ownId=getUserTeam()?.id;
 const leagueNames=["Нижняя лига","Верхняя лига"];
 const viewedLeague=leagueNames.includes(state.tournamentViewLeague)?state.tournamentViewLeague:"Нижняя лига";
 const allResults=Object.values(state.leagueResults||{}).filter(r=>Number(r.season||season)===season&&leagueData.teams.find(t=>t.id===r.homeId)?.league===viewedLeague);
 const resultsSection=document.createElement("section");resultsSection.className="panel tournament-results-panel";
 const resultsTitle=document.createElement("div");resultsTitle.className="section-title";resultsTitle.append(safeText("h2","Результаты встреч · "+viewedLeague));
 const otherToggle=matchButton("ДРУГИЕ ВСТРЕЧИ",()=>openPage("otherRoundMatches"),"secondary");otherToggle.classList.add("tournament-inline-link");resultsTitle.append(otherToggle);resultsSection.append(resultsTitle);
 const leaguePlayed=allResults.slice().sort((a,b)=>b.round-a.round||b.day-a.day);
 if(!leaguePlayed.length)resultsSection.append(safeText("p","В этой лиге пока нет завершённых матчей.","muted"));
 leaguePlayed.forEach(r=>{const homeTeam=getTeamForMatch(r.homeId),awayTeam=getTeamForMatch(r.awayId);resultsSection.append(tournamentMatchRow(r.round,{home:homeTeam,away:awayTeam},r,r.homeId===ownId||r.awayId===ownId))});
 if(round&&fixture&&!already){const action=matchButton("ПОДГОТОВИТЬСЯ И ИГРАТЬ СЕГОДНЯ",()=>openPage("match"),"primary");action.classList.add("tournament-play-button");resultsSection.append(action)}
 wrap.append(resultsSection);

 const standings=document.createElement("section");standings.className="panel standings-panel";
 const standingsHeader=document.createElement("div");standingsHeader.className="section-title";standingsHeader.append(safeText("h2",viewedLeague+" · таблица сезона"));
 const leagueToggle=document.createElement("div");leagueToggle.className="tournament-league-toggle";
 leagueNames.forEach(name=>{const button=matchButton(name.toUpperCase(),()=>{state.tournamentViewLeague=name;saveState();openPage("league")},"secondary");button.classList.toggle("active",name===viewedLeague);button.setAttribute("aria-pressed",String(name===viewedLeague));leagueToggle.append(button)});
 standingsHeader.append(leagueToggle);standings.append(standingsHeader);
 const table=document.createElement("div");table.className="league-table";
 const head=document.createElement("div");head.className="league-table-row league-table-head";
 ["#","Команда","И","В","Н","П","Мячи","О"].forEach(v=>head.append(safeText("span",v)));table.append(head);
 getCurrentStandings(viewedLeague).forEach((x,i)=>{
  const row=document.createElement("div");row.className="league-table-row"+(x.team.isUserTeam?" user-team-row":"");
  row.append(safeText("span",String(i+1)));
  const nameCell=document.createElement("div");nameCell.className="league-standing-team";nameCell.append(makeTournamentTeamLink(x.team));row.append(nameCell);
  [String(x.played),String(x.w),String(x.d),String(x.l),x.gf+":"+x.ga,String(x.pts)].forEach((value,j)=>row.append(safeText(j===5?"b":"span",value)));
  table.append(row);
 });
 standings.append(table);wrap.append(standings);
 const stats=document.createElement("section");stats.className="panel tournament-statistics-panel";stats.append(safeText("h2","Статистика турнира"));
 const tabs=document.createElement("div");tabs.className="tournament-stat-tabs";const body=document.createElement("div");body.className="tournament-stat-body";
 const data={goals:new Map(),assists:new Map(),keepers:new Map(),coaches:new Map(),ratings:new Map()};
 const ensurePlayer=(map,name,team,player)=>{const key=(team?.id||"team")+"::"+name;if(!map.has(key))map.set(key,{name,team,player,stat:0,extra:0,played:0});return map.get(key)};
 allResults.forEach(m=>{
  const home=getTeamForMatch(m.homeId),away=getTeamForMatch(m.awayId);
  const lineups={home:m.homeLineup||[],away:m.awayLineup||[]};
  (m.events||[]).forEach(e=>{
   if(e.type!=="goal")return;
   const side=e.side==="away"?"away":e.side==="home"?"home":(lineups.home.some(x=>(x.player||x).name===e.scorer)?"home":"away");
   const team=side==="home"?home:away,line=lineups[side];
   const scorer=line.find(x=>(x.player||x).name===e.scorer)?.player||line.find(x=>(x.player||x).name===e.scorer)||{name:e.scorer};
   if(e.scorer)ensurePlayer(data.goals,e.scorer,team,scorer).stat++;
   if(e.assist){const assistSide=lineups.home.some(x=>(x.player||x).name===e.assist)?"home":lineups.away.some(x=>(x.player||x).name===e.assist)?"away":side;const at=assistSide==="home"?home:away,al=lineups[assistSide];const player=al.find(x=>(x.player||x).name===e.assist)?.player||{name:e.assist};ensurePlayer(data.assists,e.assist,at,player).stat++}
  });
  [["home",home,m.homeLineup||[],Number(m.awayScore||0)],["away",away,m.awayLineup||[],Number(m.homeScore||0)]].forEach(([side,team,line,against])=>{
   const keeperEntry=line.find(x=>x.role==="ВР"),keeper=keeperEntry?.player||keeperEntry;
   if(keeper?.name){const rec=ensurePlayer(data.keepers,keeper.name,team,keeper);rec.played++;rec.extra+=against;if(!against)rec.stat++}
  });
  (m.playerRatings||m.ratings||[]).forEach(r=>{const name=r.playerName||r.name;const team=r.teamId===home?.id?home:r.teamId===away?.id?away:null;if(name&&team){const rec=ensurePlayer(data.ratings,name,team,{name});rec.stat+=Number(r.rating||0);rec.played++}});
  [[home,Number(m.homeScore||0),Number(m.awayScore||0)],[away,Number(m.awayScore||0),Number(m.homeScore||0)]].forEach(([team,forG,against])=>{if(!team?.coach)return;const key=team.id+"::"+team.coach;if(!data.coaches.has(key))data.coaches.set(key,{name:team.coach,team,stat:0,played:0});const c=data.coaches.get(key);c.played++;c.stat+=forG>against?3:forG===against?1:0});
 });
 const sorted=map=>[...map.values()].sort((a,b)=>b.stat-a.stat||a.name.localeCompare(b.name,"ru"));
 const statDefs=[
  ["БОМБАРДИРЫ",()=>sorted(data.goals).map(x=>({...x,description:x.stat+" гол."}))],
  ["АССИСТЕНТЫ",()=>sorted(data.assists).map(x=>({...x,description:x.stat+" ассист."}))],
  ["ЛУЧШИЕ ИГРОКИ",()=>sorted(data.ratings).filter(x=>x.played).map(x=>({...x,stat:x.stat/x.played,description:(x.stat/x.played).toFixed(1)+" · средняя оценка"}))],
  ["ЛУЧШИЕ ВРАТАРИ",()=>[...data.keepers.values()].sort((a,b)=>b.stat-a.stat||a.extra-b.extra).map(x=>({...x,description:x.stat+" матч. на ноль · "+x.extra+" проп."}))],
  ["ЛУЧШИЕ ТРЕНЕРЫ",()=>sorted(data.coaches).map(x=>({...x,description:x.stat+" очк. · "+x.played+" матч."}))]
 ];
 const renderStatRow=(item,type)=>{
  const row=document.createElement("div");row.className="tournament-stat-row";
  if(type==="coach"){const logo=teamLogoSource(item.team);if(logo){const img=document.createElement("img");img.className="tournament-team-logo";img.src=logo;img.alt="";img.onerror=()=>img.remove();row.append(img)}row.append(makeTournamentCoachLink(item.team))}
  else{const img=document.createElement("img");img.className="tournament-stat-portrait";img.src=getPortrait(item.player?.portraitIndex||teamsPlayerIndex(item.team,item.player||{name:item.name}));img.alt="";img.loading="lazy";img.onerror=()=>img.remove();row.append(img,makeTournamentPlayerLink(item.name,item.team?.id));const logo=teamLogoSource(item.team);if(logo){const teamLogo=document.createElement("img");teamLogo.className="tournament-team-logo";teamLogo.src=logo;teamLogo.alt="";teamLogo.onerror=()=>teamLogo.remove();row.append(teamLogo)}row.append(safeText("span",displayTeamName(item.team),"tournament-stat-team"))}
  row.append(safeText("b",item.description||String(item.stat)));return row;
 };
 const showStats=i=>{body.replaceChildren();tabs.querySelectorAll("button").forEach((b,j)=>b.classList.toggle("active",i===j));const items=statDefs[i][1]();if(!items.length){body.append(safeText("p",i===2?"Оценки игроков пока не записываются в результаты матчей. Когда система оценок будет сохранять оценки после каждого матча, здесь появится рейтинг лучших игроков.":"Статистика появится после завершённых матчей.","muted"));return}items.slice(0,15).forEach(item=>body.append(renderStatRow(item,i===4?"coach":"player")))};
 statDefs.forEach((d,i)=>tabs.append(matchButton(d[0],()=>showStats(i),"secondary")));stats.append(tabs,body);wrap.append(stats);showStats(0);

 return wrap
}
function openPlayerProfile(team,p,index) {
  const wrap=document.createElement("div");wrap.className="player-profile";
  const portrait=document.createElement("img");portrait.className="player-profile-portrait";portrait.src=getPortrait(p.portraitIndex || teamsPlayerIndex(team,p));portrait.alt=p.name;
  const head=document.createElement("div");head.className="player-profile-head";head.append(portrait);
  const bio=document.createElement("div");
  const teamName=team.name===" {teamName}"||team.name==="{teamName}"?state.teamName:team.name;
  bio.append(safeText("h2",p.name),safeText("p",teamName,"player-team-name"));
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
      body.append(safeText("h3","История индивидуальных тренировок"));const trainingKey=trainingPlayerKey(team,p,index),historySource=state.trainingHistory||[],trainingHistory=Array.isArray(historySource)?historySource.filter(item=>item&&item.team===team.id&&item.player===p.name&&(item.type==="individual"||item.type==="match3-relations")):(historySource[trainingKey]||[]);if(!trainingHistory.length){body.append(safeText("p","В этой локальной карьере тренировок пока нет.","muted"));}else{trainingHistory.slice().reverse().forEach(item=>{const label=item.type==="match3-relations"?"Три в ряд: "+item.score+" очков; отношения +"+Number(item.delta||0).toFixed(2)+" п. п.":(item.stat||"Характеристика")+": "+(item.before??"—")+" → "+(item.after??"—")+"; очки "+(item.score??0);body.append(safeText("p",new Date(item.at).toLocaleString("ru-RU")+" · "+label));});}body.append(safeText("p","Новую тренировку можно провести в разделе «Тренировка». История хранится в этом браузере.","muted"));
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
      body.append(makeCareerAwardShelf(careerAwardsFor("player",team.id,p.name),"Награды футболиста"));body.append(safeText("h3","Официальная статистика футболиста"));let played=0,goals=0,assists=0,cleanSheets=0;Object.values(state.leagueResults||{}).filter(m=>Number(m.season||state.seasonNumber)===Number(state.seasonNumber||1)).forEach(m=>{const isHome=m.homeId===team.id,isAway=m.awayId===team.id;if(!isHome&&!isAway)return;const lineup=isHome?(m.homeLineup||[]):(m.awayLineup||[]);if(!lineup.some(x=>(x.player||x).name===p.name))return;played++;(m.events||[]).forEach(ev=>{if(ev.type==="goal"&&ev.scorer===p.name)goals++;if(ev.type==="goal"&&ev.assist===p.name)assists++});if(p.position==="ВР"&&((isHome&&m.awayScore===0)||(isAway&&m.homeScore===0)))cleanSheets++});const grid=document.createElement("div");grid.className="cabinet-metrics";[["Матчи",played],["Голы",goals],["Ассисты",assists],["Матчи на ноль",cleanSheets]].forEach(([label,value])=>{const card=document.createElement("div");card.className="cabinet-metric";card.append(safeText("small",label),safeText("b",String(value)));grid.append(card)});body.append(grid);if(!played)body.append(safeText("p","Официальной статистики пока нет. Она появится после сохранения официальных матчей; тестовые матчи не учитываются.","muted"));
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
