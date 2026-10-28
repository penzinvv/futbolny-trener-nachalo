const STORAGE_KEY = "football-coach-start-v1";
const defaultState = {
  coachName: "", teamName: "", emblem: "🛡️", xp: 0, permanentRating: 0,
  seasonRating: 0, respect: 0, gameDay: 1, players: []
};
let state = loadState();

const $ = (id) => document.getElementById(id);
function loadState() {
  try { return { ...defaultState, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") }; }
  catch { return { ...defaultState }; }
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function showSetup() { $("onboarding").classList.remove("hidden"); $("dashboard").classList.add("hidden"); }
function render() {
  $("coachNameLabel").textContent = state.coachName || "Тренер";
  $("coachLevel").textContent = Math.max(1, Math.floor(Math.sqrt(state.xp / 100)) + 1);
  $("teamName").textContent = state.teamName || "Дворовые";
  $("teamEmblem").textContent = state.emblem || "🛡️";
  $("gameDate").textContent = `День ${state.gameDay}`;
  $("rosterCount").textContent = state.players.length;
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

function shuffleTracks() {
  shuffledTracks = [...musicTracks];
  for (let i = shuffledTracks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledTracks[i], shuffledTracks[j]] = [shuffledTracks[j], shuffledTracks[i]];
  }
  // Не повторяем последнюю песню прошлого круга сразу же.
  if (shuffledTracks.length > 1 && currentTrackIndex >= 0 &&
      shuffledTracks[0] === musicTracks[currentTrackIndex]) {
    [shuffledTracks[0], shuffledTracks[1]] = [shuffledTracks[1], shuffledTracks[0]];
  }
  currentTrackIndex = -1;
}

async function playNextTrack() {
  if (!musicEnabled) return;
  if (currentTrackIndex + 1 >= shuffledTracks.length) shuffleTracks();
  currentTrackIndex += 1;
  musicPlayer.src = shuffledTracks[currentTrackIndex];
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

$("setupForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const coachName = $("coachName").value.trim();
  const teamName = $("teamNameInput").value.trim();
  if (!coachName || !teamName) return;
  state.coachName = coachName.slice(0,24);
  state.teamName = teamName.slice(0,28);
  state.emblem = document.querySelector('input[name="emblem"]:checked')?.value || "🛡️";
  saveState(); $("onboarding").classList.add("hidden"); $("dashboard").classList.remove("hidden"); render();
});

const pages = {
  players: {title:"Футболисты", eyebrow:"СОСТАВ", render: renderPlayers},
  mail: {title:"Почта", eyebrow:"СООБЩЕНИЯ", render: () => placeholder("Почтовая система ещё не реализована. Здесь появятся сообщения, приглашения и важные новости.")},
  training: {title:"Тренировка", eyebrow:"РАЗВИТИЕ", render: renderTraining},
  upbringing: {title:"Воспитание", eyebrow:"ОТНОШЕНИЯ", render: () => placeholder("Раздел воспитания пока пустой. Позже добавим отношения, события и решения тренера.")},
  league: {title:"Лига", eyebrow:"СОРЕВНОВАНИЯ", render: () => placeholder("Лига пока не реализована. Эта страница намеренно оставлена пустой до согласования механик.")},
  goals: {title:"Цели тренера", eyebrow:"ПРОГРЕСС", render: () => placeholder("Система уникальных и периодических целей будет добавлена после согласования чисел и списка целей.")}
};
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
$("backHome").addEventListener("click", () => { $("pageView").classList.add("hidden"); $("dashboard").classList.remove("hidden"); });

function renderPlayers() {
  const wrap = document.createElement("div");
  wrap.append(placeholder("Здесь появятся подготовленные футболисты, их возраст, позиции, характеристики, потенциал и отношения. Начальный состав можно будет загрузить из данных проекта."));
  const list = document.createElement("div"); list.className = "player-list";
  if (!state.players.length) {
    const row = document.createElement("div"); row.className = "player-row";
    row.innerHTML = "<div><b>Состав пока не загружен</b><small>Добавление стартовых игроков — следующий этап</small></div><span>0 / 10</span>";
    list.append(row);
  } else state.players.forEach(player => {
    const row = document.createElement("div"); row.className = "player-row";
    row.innerHTML = `<div><b></b><small></small></div><span></span>`;
    row.querySelector("b").textContent = player.name;
    row.querySelector("small").textContent = `Возраст: ${player.age} · Позиция: ${player.position}`;
    row.querySelector("span").textContent = `${player.relationship || 0}%`;
    list.append(row);
  });
  wrap.append(list); return wrap;
}
function renderTraining() {
  const wrap = document.createElement("div");
  wrap.append(placeholder("Пока подготовлена структура раздела. Индивидуальная «Змейка», таймеры на 4 часа, командная тренировка на 8 часов и тренировочные матчи подключим поэтапно."));
  return wrap;
}

if (!state.coachName || !state.teamName) showSetup();
else { $("onboarding").classList.add("hidden"); render(); }
