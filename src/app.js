const STORAGE_KEY = "football-coach-start-v1";
const GAME_DAY_DURATION_MS = 60000;
const GAME_DAY_TIPS = [
 {key:"training",title:"ТРЕНИРОВКИ",text:"Развивай игроков и готовь команду.",page:"training"},
 {key:"respect",title:"ПОДНЯТЬ УВАЖЕНИЕ",text:"Позаботься о репутации тренера и отношении к команде.",page:"cabinet"},
 {key:"ratings",title:"ТРЕНЕРСКИЙ РЕЙТИНГ",text:"Посмотри, как ты продвигаешься среди других тренеров.",page:"ratings"},
 {key:"shop",title:"МАГАЗИН",text:"Загляни за наградами и полезными покупками.",page:"shop"},
 {key:"help",title:"FAQ / ПОМОЩЬ",text:"Изучи советы и узнай больше о возможностях игры.",page:"help"}
];
const defaultState = {
  coachName: "", teamName: "", emblem: "🛡️", teamLogoIndex: 1, avatarIndex: 1, seasonNumber: 1, avatarChangeUsedSeason: 0,
  xp: 0, shopCoins: 0, shopOwnedItems: [], shopEquippedItems: {}, permanentRating: 0, seasonRating: 0, respect: 0, gameDay: 1, players: [], relationships: {},
  careerCoachId: null, careerTeamId: null, careerPlayerIds: {}, careerHistory: { officialMatches: [], seasons: {} }, gameDayStartedAt: null, gameDayTipKey: null, gameDayPreviousTipKey: null
};
let state = loadState();
let gameDayTimerInterval = null;
let leagueData = null;
let resolveLeagueDataReady;
const leagueDataReady = new Promise(resolve => { resolveLeagueDataReady = resolve; });
Promise.all([fetch("/data/league.json"), fetch("/data/player-database.json")]).then(async ([leagueResponse, playerDatabaseResponse]) => { if (!leagueResponse.ok || !playerDatabaseResponse.ok) throw new Error("Не удалось загрузить данные лиги или базу футболистов"); const [data, playerDatabase] = await Promise.all([leagueResponse.json(), playerDatabaseResponse.json()]); data.playerDatabase = playerDatabase; return data; }).then(data => { leagueData = data; if(state.coachName && state.teamName){ applySavedLeagueStructure(); ensureLeagueMembershipSnapshot(Number(state.seasonNumber)||1); } resolveLeagueDataReady(data); simulateScheduledLeagueResultsForDay(Number(state.gameDay)||1); if(END_SEASON_FRIENDLIES[Number(state.gameDay)])simulateEndSeasonFriendlyDay(Number(state.gameDay)); deliverScheduledCoachMail(Number(state.gameDay)||1); saveState(); if (state.coachName && state.teamName) render(); setTimeout(showNextGameEventPopup,120); if (!$("pageView")?.classList.contains("hidden") && $("pageTitle")?.textContent === "Тренировка") openPage("training"); }).catch(err => { resolveLeagueDataReady(null); console.error(err); });

const $ = (id) => document.getElementById(id);
function loadState() {
  try { return { ...defaultState, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") }; }
  catch { return { ...defaultState }; }
}
// 2.8.5: trainer XP and shop currency are independent balances.
function awardTrainerXp(amount) {
  const earned = Math.max(0, Number(amount) || 0);
  if (!earned) return 0;
  state.xp = Math.max(0, Number(state.xp) || 0) + earned;
  state.shopCoins = Math.max(0, Number(state.shopCoins) || 0) + earned;
  return earned;
}
function getShopBalance() { return Math.max(0, Number(state.shopCoins) || 0); }
function isShopItemOwned(itemId) {
  return Array.isArray(state.shopOwnedItems) && state.shopOwnedItems.includes(String(itemId));
}
function purchaseShopItem(item) {
  if (!item || typeof item !== "object" || !String(item.id || "").trim()) return { ok: false, reason: "invalid-item" };
  const itemId = String(item.id).trim();
  const price = Number(item.price);
  if (!Number.isSafeInteger(price) || price < 0) return { ok: false, reason: "invalid-price" };
  state.shopOwnedItems = Array.isArray(state.shopOwnedItems) ? state.shopOwnedItems : [];
  if (state.shopOwnedItems.includes(itemId)) return { ok: false, reason: "already-owned" };
  if (getShopBalance() < price) return { ok: false, reason: "insufficient-funds" };
  state.shopCoins = getShopBalance() - price;
  state.shopOwnedItems.push(itemId);
  if (item.equipSlot) {
    state.shopEquippedItems = state.shopEquippedItems && typeof state.shopEquippedItems === "object" ? state.shopEquippedItems : {};
    state.shopEquippedItems[String(item.equipSlot)] = itemId;
  }
  saveState();
  return { ok: true, balance: getShopBalance(), itemId };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  scheduleCloudSnapshotSave();
}

const SUPABASE_URL = "https://qfkekaipmbtzxtuspjqv.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uEoHSnOBVXtlJm--cZF_IQ_IRXmG55x";
const cloudClient = window.supabase?.createClient
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;

// Account controls: guest play remains available; linking a guest preserves its Supabase user ID.
let accountMode = "login";
let accountRecoveryMode = false;
const CLOUD_FORCE_RESTORE_KEY = "football-coach-force-cloud-restore-once";
const LOCAL_CAREER_BACKUP_KEY = STORAGE_KEY + "-before-account-login";

function setAccountStatus(message, type = "") {
  const el = $("accountStatus");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("account-status-error", type === "error");
  el.classList.toggle("account-status-success", type === "success");
}

function setAccountMode(mode) {
  accountMode = mode;
  accountRecoveryMode = false;
  $("accountForm")?.classList.remove("hidden");
  $("accountNewPasswordForm")?.classList.add("hidden");
  $("accountConfirmWrap")?.classList.toggle("hidden", mode !== "register");
  $("accountPasswordConfirm")?.classList.toggle("hidden", mode !== "register");
  $("accountPassword")?.setAttribute("autocomplete", mode === "register" ? "new-password" : "current-password");
  $("accountPassword")?.setAttribute("placeholder", mode === "register" ? "Не менее 8 символов" : "Твой пароль");
  $("accountPassword").required = true;
  $("accountPasswordConfirm").required = mode === "register";
  $("accountSubmit").textContent = mode === "register" ? "СОЗДАТЬ АККАУНТ" : "ВОЙТИ";
  $("accountActions")?.classList.remove("hidden");
  setAccountStatus(mode === "register"
    ? "Создай аккаунт: текущая гостевая карьера будет привязана к электронной почте."
    : "Войди, чтобы загрузить карьеру, сохранённую в твоём аккаунте.");
}

function openAccountPanel() {
  $("accountPanel")?.classList.remove("hidden");
  $("accountToggle")?.setAttribute("aria-expanded", "true");
}
function closeAccountPanel() {
  $("accountPanel")?.classList.add("hidden");
  $("accountToggle")?.setAttribute("aria-expanded", "false");
}

async function refreshAccountUI(userOverride = null) {
  let user = userOverride;
  if (!user && cloudClient) {
    const { data, error } = await cloudClient.auth.getUser();
    if (error) console.warn("Не удалось получить статус аккаунта:", error.message);
    user = data?.user || null;
  }
  const signedIn = Boolean(user && user.email && !user.is_anonymous);
  $("accountForm")?.classList.toggle("hidden", signedIn || accountRecoveryMode);
  $("accountActions")?.classList.toggle("hidden", signedIn || accountRecoveryMode);
  $("accountSignedIn")?.classList.toggle("hidden", !signedIn);
  if (signedIn) {
    $("accountEmailLabel").textContent = user.email;
    $("accountToggle").textContent = "АККАУНТ · ВХОД";
    setAccountStatus("Аккаунт подключён. Прогресс сохраняется в облаке.", "success");
  } else {
    $("accountToggle").textContent = "АККАУНТ";
    if (!accountRecoveryMode) {
      $("accountForm")?.classList.remove("hidden");
      $("accountActions")?.classList.remove("hidden");
    }
  }
}

async function initializeAccountControls() {
  if (!cloudClient) {
    setAccountStatus("Не удалось загрузить Supabase. Проверь интернет-соединение и попробуй ещё раз.", "error");
    $("accountSubmit").disabled = true;
    return;
  }
  $("accountToggle")?.addEventListener("click", async () => {
    if ($( "accountPanel").classList.contains("hidden")) openAccountPanel();
    else closeAccountPanel();
    await refreshAccountUI();
  });
  $("accountClose")?.addEventListener("click", closeAccountPanel);
  $("accountModeLogin")?.addEventListener("click", () => setAccountMode("login"));
  $("accountModeRegister")?.addEventListener("click", () => setAccountMode("register"));
  $("accountForgot")?.addEventListener("click", async () => {
    const email = $("accountEmail").value.trim();
    if (!email) { setAccountStatus("Сначала введи электронную почту.", "error"); $("accountEmail").focus(); return; }
    try {
      const { error } = await cloudClient.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
      if (error) throw error;
      setAccountStatus("Если для этой почты существует аккаунт, придёт письмо со ссылкой для сброса пароля. Проверь также папку «Спам».", "success");
    } catch (error) { setAccountStatus("Не удалось отправить письмо: " + (error.message || "неизвестная ошибка"), "error"); }
  });
  $("accountForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const email = $("accountEmail").value.trim();
    const password = $("accountPassword").value;
    const button = $("accountSubmit");
    if (accountMode === "register" && password !== $("accountPasswordConfirm").value) {
      setAccountStatus("Пароли не совпадают.", "error"); return;
    }
    if (password.length < 8) { setAccountStatus("Пароль должен содержать не менее 8 символов.", "error"); return; }
    button.disabled = true;
    try {
      if (accountMode === "register") {
        const sessionResult = await cloudClient.auth.getSession();
        if (sessionResult.error) throw sessionResult.error;
        let user = sessionResult.data.session?.user;
        if (!user) {
          const created = await cloudClient.auth.signInAnonymously();
          if (created.error) throw created.error;
          user = created.data.user;
        }
        if (user?.is_anonymous) {
          const { data, error } = await cloudClient.auth.updateUser({ email, password });
          if (error) throw error;
          setAccountStatus("Данные аккаунта добавлены. Если включено подтверждение почты, открой письмо от Supabase и подтверди адрес. Текущая карьера привязана к этому аккаунту.", "success");
          await refreshAccountUI(data?.user);
          if (data?.user?.email && !data.user.is_anonymous) {
            setAccountStatus("Аккаунт создан, гостевая карьера сохранена за ним.", "success");
          }
        } else {
          const { data, error } = await cloudClient.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
          if (error) throw error;
          setAccountStatus(data.session ? "Аккаунт создан и выполнен вход." : "Регистрация принята. Проверь почту и подтверди адрес, затем войди в аккаунт.", "success");
          await refreshAccountUI(data.user);
        }
      } else {
        // Keep a recoverable local copy before switching to an existing account.
        if (state.coachName && state.teamName) {
          localStorage.setItem(LOCAL_CAREER_BACKUP_KEY, JSON.stringify({ savedAt: new Date().toISOString(), state }));
        }
        const { error } = await cloudClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        sessionStorage.setItem(CLOUD_FORCE_RESTORE_KEY, "1");
        setAccountStatus("Вход выполнен. Загружаю карьеру из облака…", "success");
        window.location.reload();
      }
    } catch (error) {
      const message = error?.message || "неизвестная ошибка";
      setAccountStatus("Не удалось выполнить действие: " + message, "error");
    } finally { button.disabled = false; }
  });
  $("accountSignOut")?.addEventListener("click", async () => {
    const { error } = await cloudClient.auth.signOut();
    if (error) { setAccountStatus("Не удалось выйти: " + error.message, "error"); return; }
    setAccountStatus("Вы вышли из аккаунта. Можно продолжить играть в гостевом режиме.", "success");
    await refreshAccountUI(null);
    window.location.reload();
  });
  $("accountNewPasswordForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const password = $("accountNewPassword").value;
    if (password.length < 8) { setAccountStatus("Пароль должен содержать не менее 8 символов.", "error"); return; }
    try {
      const { error } = await cloudClient.auth.updateUser({ password });
      if (error) throw error;
      accountRecoveryMode = false;
      $("accountNewPasswordForm").classList.add("hidden");
      setAccountStatus("Пароль изменён. Теперь можно войти с новым паролем.", "success");
      await refreshAccountUI();
    } catch (error) { setAccountStatus("Не удалось изменить пароль: " + (error.message || "неизвестная ошибка"), "error"); }
  });
  cloudClient.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      accountRecoveryMode = true;
      openAccountPanel();
      $("accountForm")?.classList.add("hidden");
      $("accountActions")?.classList.add("hidden");
      $("accountNewPasswordForm")?.classList.remove("hidden");
      setAccountStatus("Укажи новый пароль для своего аккаунта.");
    } else if (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "SIGNED_OUT") {
      void refreshAccountUI(session?.user || null);
    }
  });
  const { data } = await cloudClient.auth.getSession();
  if (data?.session?.user?.recovery_sent_at || window.location.hash.includes("type=recovery")) {
    accountRecoveryMode = true;
    openAccountPanel();
    $("accountForm")?.classList.add("hidden");
    $("accountActions")?.classList.add("hidden");
    $("accountNewPasswordForm")?.classList.remove("hidden");
    setAccountStatus("Укажи новый пароль для своего аккаунта.");
  } else {
    setAccountMode("login");
    await refreshAccountUI(data?.session?.user || null);
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { void initializeAccountControls(); });
else void initializeAccountControls();

let cloudSyncPromise = null;
let cloudSnapshotReady = false;
let cloudSnapshotBlocked = false;
let cloudSnapshotRevision = 0;
let cloudSnapshotSaveTimer = null;
let cloudSnapshotSavePromise = null;
let cloudSnapshotConflictAlerted = false;
let cloudSnapshotInitPromise = null;
let cloudCareerInitPromise = null;
const CLOUD_SNAPSHOT_SCHEMA_VERSION = 1;
const CLOUD_SNAPSHOT_BACKUP_PREFIX = STORAGE_KEY + "-before-cloud-restore-";

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

async function cloudSnapshotRequest(method = "GET", body = null) {
  const session = await getCloudSession();
  const response = await fetch(SUPABASE_URL + "/functions/v1/career-save", {
    method,
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_PUBLISHABLE_KEY,
      "Authorization": "Bearer " + session.access_token
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    const error = new Error(result.error || "Ошибка облачного сохранения (" + response.status + ")");
    error.status = response.status;
    error.payload = result;
    throw error;
  }
  return result;
}

function scheduleCloudSnapshotSave() {
  if (!cloudSnapshotReady || cloudSnapshotBlocked || !state.coachName || !state.teamName) return;
  if (cloudSnapshotSaveTimer) clearTimeout(cloudSnapshotSaveTimer);
  cloudSnapshotSaveTimer = setTimeout(() => {
    cloudSnapshotSaveTimer = null;
    void flushCloudSnapshotSave();
  }, 1500);
}

async function flushCloudSnapshotSave() {
  if (!cloudSnapshotReady || cloudSnapshotBlocked || !state.coachName || !state.teamName) return;
  if (cloudSnapshotSavePromise) return cloudSnapshotSavePromise;
  const serializedState = JSON.stringify(state);
  const expectedRevision = cloudSnapshotRevision;
  cloudSnapshotSavePromise = (async () => {
    try {
      const result = await cloudSnapshotRequest("POST", {
        action: "save",
        state: JSON.parse(serializedState),
        schemaVersion: CLOUD_SNAPSHOT_SCHEMA_VERSION,
        expectedRevision
      });
      if (result.saved && result.snapshot) {
        cloudSnapshotRevision = Number(result.snapshot.revision) || expectedRevision + 1;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
    } catch (error) {
      if (error.status === 409 || error.payload?.conflict) {
        cloudSnapshotBlocked = true;
        if (!cloudSnapshotConflictAlerted) {
          cloudSnapshotConflictAlerted = true;
          console.error("Облачное сохранение остановлено: обнаружена более новая версия карьеры.", error);
          alert("Облачное сохранение остановлено: на сервере есть более новая версия карьеры. Текущая игра сохранена в этом браузере. Не обновляй страницу, если хочешь сохранить текущий прогресс; сначала нужно разрешить конфликт версий.");
        }
      } else {
        console.warn("Облачный снимок не сохранён; локальное сохранение сохранено.", error);
      }
    } finally {
      cloudSnapshotSavePromise = null;
      if (cloudSnapshotReady && !cloudSnapshotBlocked && state.coachName && state.teamName && JSON.stringify(state) !== serializedState) {
        scheduleCloudSnapshotSave();
      }
    }
  })();
  return cloudSnapshotSavePromise;
}

function stableStateString(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStateString).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stableStateString(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

async function performCloudSnapshotInitialization() {
  const response = await cloudSnapshotRequest("GET");
  const snapshot = response.snapshot;
  const forceCloudRestore = sessionStorage.getItem(CLOUD_FORCE_RESTORE_KEY) === "1";
  if (forceCloudRestore) sessionStorage.removeItem(CLOUD_FORCE_RESTORE_KEY);
  const hasLocalCareer = Boolean(state.coachName && state.teamName);
  if (!snapshot) {
    cloudSnapshotRevision = 0;
    // Signing into a different account must never silently upload this browser's
    // guest career into an empty account. The login handler keeps a local backup.
    // Registration from guest mode does not set forceCloudRestore, so the current
    // career can still become the first snapshot for its newly linked account.
    if (forceCloudRestore && hasLocalCareer) {
      state = { ...defaultState };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      cloudSnapshotReady = true;
      setAccountStatus("В этом аккаунте пока нет облачной карьеры. Локальная карьера сохранена в резервной копии и не перенесена автоматически. Можно начать новую карьеру.", "success");
      if (leagueData) render();
      return;
    }
    cloudSnapshotReady = true;
    if (hasLocalCareer) scheduleCloudSnapshotSave();
    return;
  }

  const cloudState = snapshot.state;
  const hasCloudCareer = Boolean(cloudState?.coachName && cloudState?.teamName);
  if (!hasCloudCareer) {
    console.warn("Облачный снимок не содержит имени тренера и команды; он не был применён.");
    cloudSnapshotBlocked = true;
    return;
  }

  cloudSnapshotRevision = Number(snapshot.revision) || 0;

  // При явном входе в существующий аккаунт облачная карьера имеет приоритет.
  // Перед входом локальная карьера сохраняется в отдельной резервной копии.
  if (forceCloudRestore || !hasLocalCareer) {
    state = { ...defaultState, ...cloudState };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    cloudSnapshotReady = true;
    if (leagueData) render();
    return;
  }

  cloudSnapshotReady = true;
  if (stableStateString(state) !== stableStateString({ ...defaultState, ...cloudState })) {
    // Без диалогов подтверждения синхронизируем текущую карьеру из этого браузера в облако.
    scheduleCloudSnapshotSave();
  }
}

function initializeCloudSnapshot() {
  if (cloudSnapshotInitPromise) return cloudSnapshotInitPromise;
  cloudSnapshotInitPromise = performCloudSnapshotInitialization().finally(() => {
    cloudSnapshotInitPromise = null;
  });
  return cloudSnapshotInitPromise;
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden" || !cloudSnapshotReady || cloudSnapshotBlocked) return;
  if (cloudSnapshotSaveTimer) {
    clearTimeout(cloudSnapshotSaveTimer);
    cloudSnapshotSaveTimer = null;
  }
  void flushCloudSnapshotSave();
});

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
      // Не подменяем локальную карьеру данными старого cloud API до того,
      // как career-save сравнит локальный снимок с облачным и предложит выбор.
      const hadLocalCareer = Boolean(state.coachName && state.teamName);
      if (!hadLocalCareer) {
        state.coachName = result.coach?.display_name || state.coachName;
        state.teamName = result.team?.name || state.teamName;
      }
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

async function performCloudCareerInitialization() {
  try {
    // On an explicit account switch, restore the account snapshot first; do not
    // bootstrap a different browser's local guest career into the account API.
    if (sessionStorage.getItem(CLOUD_FORCE_RESTORE_KEY) === "1") {
      await initializeCloudSnapshot();
      if (state.coachName && state.teamName) render();
      return;
    }
    const result = await syncCareerToCloud(false);
    if (!result.initialized && state.coachName && state.teamName && leagueData) {
      await syncCareerToCloud(true);
    } else if (result.initialized) {
      saveState();
      if (state.coachName && state.teamName) render();
    }
    await initializeCloudSnapshot();
  } catch (error) {
    console.warn("Облачная карьера пока не подключена:", error);
    // LocalStorage remains the source of truth when the cloud is unavailable.
  }
}

function initializeCloudCareer() {
  if (cloudCareerInitPromise) return cloudCareerInitPromise;
  cloudCareerInitPromise = performCloudCareerInitialization().finally(() => {
    cloudCareerInitPromise = null;
  });
  return cloudCareerInitPromise;
}

const COACH_AVATAR_COUNT = 4;
const TEAM_LOGO_COUNT = 6;
function avatarPath(index) {
  if (Number(index) === 4) {
    const silhouette = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#102d42"/><stop offset="1" stop-color="#071a25"/></linearGradient><linearGradient id="figure" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#70f2bd"/><stop offset="1" stop-color="#2795a5"/></linearGradient></defs><rect width="160" height="160" rx="18" fill="url(#bg)"/><circle cx="80" cy="80" r="68" fill="none" stroke="#70f2bd" stroke-opacity=".45" stroke-width="2"/><circle cx="80" cy="56" r="25" fill="url(#figure)"/><path d="M31 137c4-29 23-45 49-45s45 16 49 45v5H31z" fill="url(#figure)"/><path d="M58 49c2-16 12-25 22-25 15 0 24 11 25 25-8-7-16-10-25-10s-15 4-22 10z" fill="#071a25" opacity=".85"/></svg>';
    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(silhouette);
  }
  return "/images/avatartrener/avatartrener" + index + ".jpg";
}
function teamLogoPath(index) { return "/images/avatarteam/avatarteam" + index + ".jpg"; }
function makeTeamLogoOptions(containerId, groupName, selectedIndex) {
  const container = $(containerId); container.replaceChildren();
  for (let i = 1; i <= TEAM_LOGO_COUNT; i++) {
    const label = document.createElement("label"); label.className = "avatar-option team-logo-option";
    const radio = document.createElement("input"); radio.type = "radio"; radio.name = groupName; radio.value = String(i); radio.checked = i === Number(selectedIndex); radio.setAttribute("aria-label", "Логотип команды " + i);
    const img = document.createElement("img"); img.src = teamLogoPath(i); img.alt = "Логотип команды " + i; img.loading = "lazy";
    label.append(radio, img); container.append(label);
  }
}
function makeAvatarOptions(containerId, groupName, selectedIndex) {
  const container = $(containerId);
  container.replaceChildren();
  for (let i = 1; i <= COACH_AVATAR_COUNT; i++) {
    const label = document.createElement("label"); label.className = "avatar-option";
    const radio = document.createElement("input"); radio.type = "radio"; radio.name = groupName; radio.value = String(i); radio.checked = i === Number(selectedIndex); radio.setAttribute("aria-label", "Аватар " + i);
    const img = document.createElement("img"); img.src = avatarPath(i); img.alt = i === 4 ? "Анонимный силуэт тренера" : "Аватар " + i; img.loading = "lazy";
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
  state.avatarIndex = Number(selected.value); state.avatarChangeUsedSeason = Number(state.seasonNumber || 1); if(state.shopEquippedItems) delete state.shopEquippedItems.avatar;
  saveState(); closeAvatarChange(); render();
});
function showSetup() { setPageBackground("createTeam"); $("onboarding").classList.remove("hidden"); $("dashboard").classList.add("hidden"); }

function renderTeamRecords(showAll=false) {
  const host=$("teamRecordsList");
  if(!host)return;
  host.replaceChildren();
  const history=Array.isArray(state.careerHistory?.officialMatches)?state.careerHistory.officialMatches:[];
  const ownId=getUserTeam()?.id||state.careerTeamId;
  const matches=history.filter(m=>m&&(m.homeId===ownId||m.awayId===ownId)).map(m=>{
    const ownHome=m.homeId===ownId;
    const gf=Number(m.goalsFor??(ownHome?m.homeScore:m.awayScore)??0);
    const ga=Number(m.goalsAgainst??(ownHome?m.awayScore:m.homeScore)??0);
    return {...m,gf,ga,opponentId:ownHome?m.awayId:m.homeId,result:m.result||(gf>ga?"W":gf<ga?"L":"D")};
  }).sort((a,b)=>(Number(a.season)||1)-(Number(b.season)||1)||(Number(a.day)||0)-(Number(b.day)||0));
  const dateLabel=m=>"Сезон "+(m.season||1)+" · День "+(m.day||officialRoundDay(m.round||1));
  const opponentLabel=m=>m.opponentId===ownId?(state.teamName||"Ваша команда"):(leagueData?.teams?.find(t=>t.id===m.opponentId)?.name||"Соперник");
  const records=[];
  const wins=matches.filter(m=>m.gf>m.ga).sort((a,b)=>(b.gf-b.ga)-(a.gf-a.ga)||b.gf-a.gf);
  const losses=matches.filter(m=>m.gf<m.ga).sort((a,b)=>(b.ga-b.gf)-(a.ga-a.gf)||b.ga-a.ga);
  if(wins.length){const m=wins[0];records.push({icon:"🏆",title:"Самая крупная победа",value:m.gf+" : "+m.ga,detail:(state.teamName||"Команда")+" — "+opponentLabel(m),date:dateLabel(m)});}
  if(losses.length){const m=losses[0];records.push({icon:"🛡️",title:"Самое крупное поражение",value:m.gf+" : "+m.ga,detail:(state.teamName||"Команда")+" — "+opponentLabel(m),date:dateLabel(m)});}
  const players=new Map();
  matches.forEach(m=>(m.events||[]).filter(e=>e.type==="goal").forEach(e=>{
    const side=e.side==="home"?"home":e.side==="away"?"away":null;
    if(!side||!e.scorer)return;
    const teamId=side==="home"?m.homeId:m.awayId;
    if(teamId!==ownId)return;
    const p=players.get(e.scorer)||{name:e.scorer,goals:0,assists:0,lastGoalRecord:m};
    p.goals++;p.lastGoalRecord=m;players.set(e.scorer,p);
    if(e.assist){const a=players.get(e.assist)||{name:e.assist,goals:0,assists:0,lastAssistRecord:m};a.assists++;a.lastAssistRecord=m;players.set(e.assist,a);}
  }));
  const scorers=[...players.values()].filter(p=>p.goals>0).sort((a,b)=>b.goals-a.goals||b.assists-a.assists||a.name.localeCompare(b.name,"ru"));
  const assistants=[...players.values()].filter(p=>p.assists>0).sort((a,b)=>b.assists-a.assists||b.goals-a.goals||a.name.localeCompare(b.name,"ru"));
  if(scorers[0])records.push({icon:"⚽",title:"Лучший бомбардир",value:scorers[0].name+" · "+scorers[0].goals+" гол.",detail:"За всю историю команды",date:dateLabel(scorers[0].lastGoalRecord)});
  if(assistants[0])records.push({icon:"👟",title:"Лучший ассистент",value:assistants[0].name+" · "+assistants[0].assists,detail:"Голевых передач",date:dateLabel(assistants[0].lastAssistRecord)});
  const streak=(kind)=>{let best=0,current=0,start=null,bestStart=null,bestEnd=null;matches.forEach((m,i)=>{const ok=m.result===kind;if(ok){current++;if(current===1)start=m;if(current>best){best=current;bestStart=start;bestEnd=m;}}else current=0;});return {count:best,start:bestStart,end:bestEnd};};
  const winning=streak("W"),losing=streak("L");
  if(winning.count)records.push({icon:"📈",title:"Победная серия",value:winning.count+" матч"+(winning.count===1?"":"ей")+" подряд",detail:"Лучшая серия за историю",date:dateLabel(winning.end)});
  if(losing.count)records.push({icon:"📉",title:"Проигрышная серия",value:losing.count+" матч"+(losing.count===1?"":"ей")+" подряд",detail:"Самая длинная серия",date:dateLabel(losing.end)});
  const highestScoring=[...matches].sort((a,b)=>b.gf-a.gf||b.ga-a.ga)[0];
  if(highestScoring)records.push({icon:"🔥",title:"Самый результативный матч",value:highestScoring.gf+" гол.",detail:"Команда — "+opponentLabel(highestScoring),date:dateLabel(highestScoring)});
  if(!records.length){const empty=safeText("p","Рекорды появятся после первых официальных матчей.","team-records-empty");host.append(empty);return;}
  records.slice(0,showAll?records.length:6).forEach(record=>{
    const row=document.createElement("article");row.className="team-record-row";
    const icon=safeText("span",record.icon,"team-record-icon");
    const body=document.createElement("div");body.className="team-record-body";
    body.append(safeText("span",record.title,"team-record-title"),safeText("strong",record.value,"team-record-value"),safeText("small",record.detail,"team-record-detail"));
    row.append(icon,body,safeText("time",record.date,"team-record-date"));host.append(row);
  });
  const more=$("allTeamRecordsButton");
  if(more){more.textContent=showAll?"Свернуть ›":"Все рекорды ›";more.onclick=()=>renderTeamRecords(!showAll);}
}


function chooseGameDayTip() {
 const options=GAME_DAY_TIPS.filter(t=>t.key!==state.gameDayPreviousTipKey);
 const selected=options[Math.floor(Math.random()*options.length)]||GAME_DAY_TIPS[0];
 state.gameDayPreviousTipKey=selected.key;state.gameDayTipKey=selected.key;return selected;
}
function updateGameDayTimerUI() {
 const panel=$("gameDayTimerPanel");if(!panel)return;
 const started=Number(state.gameDayStartedAt)||0;
 if(!started){panel.classList.add("hidden");const skip=$("skipDayButton");if(skip){skip.classList.remove("hidden");skip.textContent=Number(state.gameDay)>=182?"НАЧАТЬ НОВЫЙ СЕЗОН":"ПРОПУСТИТЬ ДЕНЬ";}const next=$("nextGameDayButton");if(next)next.classList.add("hidden");return}
 panel.classList.remove("hidden");
 const elapsed=Math.max(0,Date.now()-started),remaining=Math.max(0,GAME_DAY_DURATION_MS-elapsed),finished=remaining<=0;
 const seconds=Math.ceil(remaining/1000),value=$("gameDayTimerValue");
 if(value)value.textContent=String(Math.floor(seconds/60)).padStart(2,"0")+":"+String(seconds%60).padStart(2,"0");
 const progress=$("gameDayTimerProgress");if(progress)progress.style.width=(Math.min(1,elapsed/GAME_DAY_DURATION_MS)*100)+"%";
 const title=$("gameDayTimerTitle");if(title)title.textContent=finished?"ДЕНЬ ЗАВЕРШЁН!":"ДЕНЬ НАЧАЛСЯ!";
 const message=$("gameDayTimerMessage");if(message)message.textContent=finished?"Минута прошла. Решай сам, когда переходить к следующему дню.":"САМОЕ ВРЕМЯ СДЕЛАТЬ ЧТО-НИБУДЬ ВАЖНОЕ В ИГРЕ.";
 const tip=GAME_DAY_TIPS.find(t=>t.key===state.gameDayTipKey)||GAME_DAY_TIPS[0];
 const tipTitle=$("gameDayTipTitle");if(tipTitle)tipTitle.textContent=tip.title;
 const tipText=$("gameDayTipText");if(tipText)tipText.textContent=tip.text;
 const tipButton=$("gameDayTipButton");if(tipButton)tipButton.onclick=()=>openPage(tip.page);
 const next=$("nextGameDayButton");if(next)next.classList.toggle("hidden",!finished);
 const skip=$("skipDayButton");if(skip){skip.classList.add("hidden");skip.textContent=Number(state.gameDay)>=182?"НАЧАТЬ НОВЫЙ СЕЗОН":"ПРОПУСТИТЬ ДЕНЬ";}
}
function startGameDayTimer() {
 state.gameDayStartedAt=Date.now();chooseGameDayTip();saveState();render();updateGameDayTimerUI();
 if(gameDayTimerInterval)clearInterval(gameDayTimerInterval);
 gameDayTimerInterval=setInterval(updateGameDayTimerUI,250);
}
function requestNextGameDay() {
 const started=Number(state.gameDayStartedAt)||0;
 if(started&&Date.now()-started<GAME_DAY_DURATION_MS){updateGameDayTimerUI();return}
 const beforeDay=Number(state.gameDay),beforeSeason=Number(state.seasonNumber);
 state.gameDayStartedAt=null;saveState();
 advanceCoachDay();
 if(Number(state.gameDay)!==beforeDay||Number(state.seasonNumber)!==beforeSeason)startGameDayTimer();else updateGameDayTimerUI();
}

function renderHomeRoster() {
  const list = $("homeRosterList"), countLabel = $("homeRosterCount");
  if (!list) return;
  const team = getUserTeam(), roster = team?.players || [];
  if (countLabel) countLabel.textContent = roster.length + " / 10";
  list.replaceChildren();
  if (!roster.length) { list.append(safeText("p", "Состав появится после создания команды.", "home-roster-empty")); return; }
  const season = Number(state.seasonNumber || 1);
  const matches = Object.values(state.leagueResults || {}).filter(match => Number(match.season || season) === season);
  roster.forEach((player, index) => {
    const stats = {played:0,goals:0,assists:0,yellow:0,red:0,ratingTotal:0,ratingCount:0,cleanSheets:0};
    matches.forEach(match => {
      const isHome=match.homeId===team.id,isAway=match.awayId===team.id;
      if(!isHome&&!isAway)return;
      const lineup=isHome?(match.homeLineup||[]):(match.awayLineup||[]);
      const entry=lineup.find(item=>(item.player||item).name===player.name);
      if(!entry)return;
      stats.played++;
      const ratingEntry=(Array.isArray(match.playerRatings)?match.playerRatings:[]).find(item=>item.playerName===player.name&&item.side===(isHome?"home":"away"));
      const rating=Number(entry.rating ?? entry.matchRating ?? entry.averageRating ?? ratingEntry?.rating);
      if(Number.isFinite(rating)&&rating>0){stats.ratingTotal+=rating;stats.ratingCount++;}
      if(player.position==="ВР"&&Number(isHome?match.awayScore:match.homeScore)===0)stats.cleanSheets++;
      const events=Array.isArray(match.events)?match.events:Array.isArray(match.timeline)?match.timeline:[];
      events.forEach(event=>{
        if(event.type==="goal"&&event.scorer===player.name)stats.goals++;
        if(event.type==="goal"&&event.assist===player.name)stats.assists++;
        const type=String(event.type||event.card||"").toLowerCase();
        const involved=event.player===player.name||event.playerName===player.name||event.target===player.name||event.name===player.name;
        if(involved&&/yellow|жк|yellowcard/.test(type))stats.yellow++;
        if(involved&&/red|кк|redcard/.test(type))stats.red++;
      });
    });
    const row=document.createElement("article");row.className="home-roster-player";
    const identity=document.createElement("div");identity.className="home-roster-identity";
    const img=document.createElement("img");img.src=getPortrait(player.portraitIndex||teamsPlayerIndex(team,player));img.alt="";img.loading="lazy";
    img.onerror=()=>{img.onerror=null;img.src="/images/portretplayers/portret1.jpg";};
    const name=document.createElement("div");name.className="home-roster-name";
    name.append(safeText("b",player.name||("Футболист "+(index+1))),safeText("small",player.position||"—"));identity.append(img,name);row.append(identity);
    [["М",stats.played],["Г",stats.goals],["А",stats.assists],["СР. ОЦ.",stats.ratingCount?(stats.ratingTotal/stats.ratingCount).toFixed(2):"—"]].forEach(([label,value])=>{
      const cell=document.createElement("span");cell.className="home-roster-stat";cell.setAttribute("data-label",label);cell.textContent=String(value);row.append(cell);
    });
    if(player.position==="ВР"){const clean=document.createElement("span");clean.className="home-roster-clean-sheets";clean.textContent="Сухие матчи: "+stats.cleanSheets;clean.title="Матчи без пропущенных голов";row.append(clean);}
    list.append(row);
  });
}

function render() {
  if ($("pageView")?.classList.contains("hidden")) setPageBackground($("onboarding") && !$("onboarding").classList.contains("hidden") ? "createTeam" : "home");
  ensureCareerIdentity();
  $("coachNameLabel").textContent = displayedCoachName();
  renderEquippedTitleBadge($("coachTitleBadge"),getEquippedCoachTitle());
  $("coachAvatar").src = displayedAvatarPath();
  $("changeAvatarButton").classList.remove("hidden");
  $("changeAvatarButton").disabled = Number(state.avatarChangeUsedSeason || 0) >= Number(state.seasonNumber || 1);
  $("changeAvatarButton").textContent = $("changeAvatarButton").disabled ? "Аватар уже менялся в этом сезоне" : "Сменить аватар";
  $("coachLevel").textContent = Math.max(1, Math.floor(Math.sqrt(state.xp / 100)) + 1);
  $("teamName").textContent = displayedTeamName();
  renderEquippedTitleBadge($("teamTitleBadge"),getEquippedTeamTitle());
  $("teamEmblem").innerHTML = '<img src="' + displayedTeamLogoPath() + '" alt="Логотип команды">';
  $("gameDate").textContent = calendarDateText();
  const nextRound = Array.from({length:20},(_,i)=>i+1).find(r=>officialRoundDay(r)>Number(state.gameDay||1)||(officialRoundDay(r)===Number(state.gameDay||1)&&!canAdvanceCoachDay()));
  const nextMatch = $("nextMatchDate"); if(nextMatch) nextMatch.textContent = nextRound ? "День "+officialRoundDay(nextRound) : "Сезон завершён";
  const matchDayLabel=$("nextMatchDayLabel"), matchRoundLabel=$("nextMatchRoundLabel");
  const matchUserName=$("nextMatchUserName"), matchOpponentName=$("nextMatchOpponentName");
  const matchUserLogo=$("nextMatchUserLogo"), matchOpponentLogo=$("nextMatchOpponentLogo");
  const matchOpponentNote=$("nextMatchOpponentNote");
  if(matchUserName) matchUserName.textContent=displayedTeamName();
  if(matchUserLogo) matchUserLogo.src=displayedTeamLogoPath();
  const upcomingFixture=nextRound?getOfficialRoundFixtures(nextRound,currentCoachLeague()).find(f=>f.home?.isUserTeam||f.away?.isUserTeam):null;
  const upcomingOpponent=upcomingFixture?(upcomingFixture.home?.isUserTeam?upcomingFixture.away:upcomingFixture.home):null;
  if(matchOpponentName) matchOpponentName.textContent=upcomingOpponent?matchTeamLabel(upcomingOpponent):"Расписание обновляется";
  if(matchOpponentLogo){const logo=upcomingOpponent?teamLogoSource(upcomingOpponent):"";matchOpponentLogo.hidden=!logo;if(logo)matchOpponentLogo.src=logo;}
  if(matchOpponentNote) matchOpponentNote.textContent=upcomingOpponent?(upcomingOpponent.league||"Соперник по лиге"):"Проверь календарь сезона";
  if(matchDayLabel) matchDayLabel.textContent=nextRound?"День "+officialRoundDay(nextRound):"Сезон завершён";
  if(matchRoundLabel) matchRoundLabel.textContent=nextRound?"Тур "+nextRound:"Нет предстоящих матчей";
  renderTeamRecords();
  renderHomeRoster();

  const skipDay = $("skipDayButton"); if(skipDay) skipDay.textContent = Number(state.gameDay)>=182 ? "НАЧАТЬ НОВЫЙ СЕЗОН" : "ПРОПУСТИТЬ ДЕНЬ";
  $("rosterCount").textContent = getUserTeam()?.players?.length || state.players.length || 10;
  const todayRound=officialRoundForDay(Number(state.gameDay)||1,currentCoachLeague()),todayFixture=currentOfficialFixture(),todayKey=todayRound&&todayFixture?roundFixtureKey(todayRound,todayFixture):null;
  const startMatchButton=$("startMatchButton");
  if(startMatchButton){const due=Boolean(todayRound&&todayFixture&&!state.leagueResults?.[todayKey]);startMatchButton.classList.toggle("hidden",!due);startMatchButton.textContent=due?"НАЧАТЬ МАТЧ · ТУР "+todayRound:"НАЧАТЬ МАТЧ";}
  $("xpValue").textContent = `${state.xp} XP`;
  $("permanentRating").textContent = state.permanentRating;
  $("seasonRating").textContent = state.seasonRating;
  $("respectValue").textContent = updateCoachRespect();
}

/* Фоновая музыка: случайный порядок без повторов до конца текущего круга.
   Браузеры требуют первого нажатия пользователя перед воспроизведением со звуком. */
// Список радио хранится рядом с файлами в /music/playlist.json.
// Чтобы добавить песню, загрузите MP3 в папку /music/ и добавьте имя в playlist.json.
let musicTracks = Array.from({ length: 20 }, (_, i) => `/music/footmusic${i + 1}.mp3`);
let musicTracksLoaded = false;
async function loadMusicTracks() {
  if (musicTracksLoaded) return;
  musicTracksLoaded = true;
  try {
    const response = await fetch("/music/playlist.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`Не удалось загрузить плейлист: HTTP ${response.status}`);
    const playlist = await response.json();
    const entries = Array.isArray(playlist) ? playlist : playlist.tracks;
    if (!Array.isArray(entries)) throw new Error("Неверный формат music/playlist.json");
    const tracks = entries
      .filter(name => typeof name === "string" && name.trim())
      .map(name => name.startsWith("/") ? name : "/music/" + encodeURIComponent(name.trim()))
      .filter(path => /\.mp3(?:$|[?#])/i.test(path));
    if (!tracks.length) throw new Error("В плейлисте нет MP3-композиций");
    musicTracks = [...new Set(tracks)];
    shuffledTracks = [];
    currentTrackIndex = -1;
  } catch (error) {
    console.warn("Не удалось загрузить music/playlist.json; используется резервный список footmusic1–20.", error);
  }
  renderCoachChronicle();
}
const musicPlayer = $("backgroundMusic");
const musicToggle = $("musicToggle");
let shuffledTracks = [];
let currentTrackIndex = -1;
let musicEnabled = true;
let lastTrackPath = "";
function setMusicButtonLabel(label) {
  const copy = musicToggle?.querySelector(".radio-copy small");
  if (copy) copy.textContent = label;
  else if (musicToggle) musicToggle.textContent = "♫ " + label;
}

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
  await loadMusicTracks();
  if (currentTrackIndex + 1 >= shuffledTracks.length) shuffleTracks();
  currentTrackIndex += 1;
  musicPlayer.src = shuffledTracks[currentTrackIndex];
  lastTrackPath = shuffledTracks[currentTrackIndex];
  try {
    await musicPlayer.play();
    setMusicButtonLabel("Радио играет · нажми, чтобы выключить");
    musicToggle.setAttribute("aria-pressed", "true");
  } catch (error) {
    musicEnabled = false;
    setMusicButtonLabel("Нажми для запуска музыки");
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
    setMusicButtonLabel("Музыка временно недоступна");
    musicToggle.setAttribute("aria-pressed", "false");
  }
});
musicToggle.addEventListener("click", async () => {
  if (musicEnabled) {
    musicEnabled = false;
    musicPlayer.pause();
    setMusicButtonLabel("Нажми для запуска музыки");
    musicToggle.setAttribute("aria-pressed", "false");
    return;
  }
  musicEnabled = true;
  if (!shuffledTracks.length) shuffleTracks();
  // Разрешённый браузером запуск происходит непосредственно после нажатия кнопки.
  if (musicPlayer.src && musicPlayer.paused && currentTrackIndex >= 0) {
    try {
      await musicPlayer.play();
      setMusicButtonLabel("Радио играет · нажми, чтобы выключить");
      musicToggle.setAttribute("aria-pressed", "true");
    } catch { await playNextTrack(); }
  } else {
    await playNextTrack();
  }
});
// При загрузке пробуем включить радио автоматически. Некоторые браузеры блокируют autoplay;
// в таком случае кнопка предложит запуск после действия пользователя.
if (musicToggle) { setMusicButtonLabel("Нажми для запуска музыки"); musicToggle.setAttribute("aria-pressed", "true"); }
void playNextTrack();

const STARTING_ROSTER_RULES_VERSION = "2.8.1";
const PORTRAIT_ASSIGNMENT_RULES_VERSION = "2.8.13";
function shuffledCopy(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function portraitPlayerKey(player) {
  return String(player?.playerId || player?.careerId || player?.id || player?.name || "");
}
function collectPortraitPlayers(extraPlayers = []) {
  const result = [], seen = new Set();
  const add = player => {
    if (!player || typeof player !== "object") return;
    const key = portraitPlayerKey(player);
    if (!key || seen.has(key)) return;
    seen.add(key); result.push(player);
  };
  (leagueData?.teams || []).forEach(team => (team.players || []).forEach(add));
  (state.leagueReservePlayers || []).forEach(add);
  (state.leagueReserveTeams || []).forEach(team => (team.players || []).forEach(add));
  (state.freeYardPlayerPool || []).forEach(add);
  (state.freeYardPlayers || []).forEach(add);
  extraPlayers.forEach(add);
  return result;
}
function buildPortraitQueue(players) {
  const counts = Array(151).fill(0);
  players.forEach(player => {
    const index = Number(player?.portraitIndex);
    if (Number.isInteger(index) && index >= 1 && index <= 150) counts[index]++;
  });
  const maxCount = Math.max(0, ...counts.slice(1));
  const queue = [];
  if (maxCount === 0) queue.push(...Array.from({length:150}, (_,i)=>i+1));
  else {
    for (let round = 0; round < maxCount; round++) {
      const missing = [];
      for (let index = 1; index <= 150; index++) if (counts[index] <= round) missing.push(index);
      queue.push(...shuffledCopy(missing));
    }
  }
  // The current incomplete round is completed before any portrait enters its next round.
  queue.push(...shuffledCopy(Array.from({length:150}, (_,i)=>i+1)));
  return queue;
}
function ensurePortraitQueue(extraPlayers = []) {
  if (!Array.isArray(state.portraitAssignmentQueue)) {
    state.portraitAssignmentQueue = buildPortraitQueue(collectPortraitPlayers(extraPlayers));
  }
  return state.portraitAssignmentQueue;
}
function assignPlayerPortrait(player, extraPlayers = []) {
  if (!player || typeof player !== "object") return 1;
  state.portraitAssignments = state.portraitAssignments && typeof state.portraitAssignments === "object" ? state.portraitAssignments : {};
  const key = portraitPlayerKey(player);
  const saved = Number(state.portraitAssignments[key]);
  if (Number.isInteger(saved) && saved >= 1 && saved <= 150) {
    player.portraitIndex = saved;
    return saved;
  }
  const current = Number(player.portraitIndex);
  if (Number.isInteger(current) && current >= 1 && current <= 150) {
    if (key) state.portraitAssignments[key] = current;
    return current;
  }
  const queue = ensurePortraitQueue(extraPlayers);
  if (!queue.length) queue.push(...shuffledCopy(Array.from({length:150}, (_,i)=>i+1)));
  const index = queue.shift();
  player.portraitIndex = index;
  if (key) state.portraitAssignments[key] = index;
  return index;
}
function ensurePortraitAssignments() {
  const players = collectPortraitPlayers();
  ensurePortraitQueue(players);
  let changed = false;
  players.forEach(player => {
    const before = Number(player.portraitIndex);
    const index = assignPlayerPortrait(player, players);
    if (before !== index) changed = true;
  });
  if (changed) saveState();
}
function createInitialLeagueForNewCareer() {
  if (!leagueData || state.initialRosterDistributionApplied) return false;
  const teams = leagueData.teams || [];
  const database = leagueData.playerDatabase;
  if (teams.length !== 12) throw new Error("Ожидалось 12 команд для стартового распределения.");
  if (!database || !Array.isArray(database.players) || !Array.isArray(database.teams)) throw new Error("Не загружена база футболистов.");
  const careerPlayers = database.players.map(source => ({
    playerId: source.playerId,
    careerId: source.playerId,
    name: source.name,
    position: source.position,
    nationality: source.nationality,
    skills: { ...(source.skills || {}) },
    portraitIndex: Number(source.portraitIndex) || 1,
    age: 14 + Math.floor(Math.random() * 7)
  }));
  const playerById = new Map(careerPlayers.map(player => [player.playerId, player]));
  careerPlayers.forEach(player => assignPlayerPortrait(player, careerPlayers));
  const activeSourceTeams = database.teams.filter(team => team.group === "active");
  if (activeSourceTeams.length !== 12) throw new Error("В базе должны быть ровно 12 стартовых команд.");
  state.userRoster = [];
  state.externalRosters = {};
  teams.forEach(team => {
    const sourceName = team.isUserTeam || team.name === "{teamName}" ? "(команда тренера)" : team.name;
    const sourceTeam = activeSourceTeams.find(candidate => candidate.name === sourceName);
    if (!sourceTeam) throw new Error("В базе не найдена команда: " + sourceName);
    team.players = sourceTeam.players.map(id => playerById.get(id)).filter(Boolean);
    if (team.players.length !== sourceTeam.players.length) throw new Error("Не удалось восстановить полный состав команды: " + sourceName);
    if (team.isUserTeam || team.name === "{teamName}") state.userRoster = team.players;
    else state.externalRosters[team.id] = team.players;
  });
  const reserveSourceTeams = database.teams.filter(team => team.group === "reserve");
  state.leagueReserveTeams = reserveSourceTeams.map((team, index) => ({
    id: "reserve-" + String(index + 1).padStart(2, "0"),
    name: team.name,
    coach: team.coach || "",
    league: "Резерв",
    players: team.players.map(id => playerById.get(id)).filter(Boolean)
  }));
  state.freeYardPlayerPool = database.freeYardPlayers.map(id => playerById.get(id)).filter(Boolean);
  state.leagueReservePlayers = [];
  state.initialRosterDistributionApplied = true;
  state.initialRosterDistributionVersion = STARTING_ROSTER_RULES_VERSION;
  state.npcTransferHistory = Array.isArray(state.npcTransferHistory) ? state.npcTransferHistory : [];
  return true;
}

$("setupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const coachName = $("coachName").value.trim();
  const teamName = $("teamNameInput").value.trim();
  if (!coachName || !teamName) return;
  const isNewCareer = !state.coachName || !state.teamName;
  if (isNewCareer) {
    await leagueDataReady;
    if (!leagueData) { alert("Не удалось загрузить составы команд. Обнови страницу и попробуй ещё раз."); return; }
    try { createInitialLeagueForNewCareer(); } catch (error) { console.error(error); alert("Не удалось подготовить стартовые составы: " + error.message); return; }
    state.careerRulesVersion = STARTING_ROSTER_RULES_VERSION;
  }
  state.coachName = coachName.slice(0,24);
  state.teamName = teamName.slice(0,28);
  state.teamLogoIndex = Number(document.querySelector('input[name="teamLogoInitial"]:checked')?.value || 1);
  state.emblem = "image";
  state.avatarIndex = Number(document.querySelector('input[name="coachAvatarInitial"]:checked')?.value || 1);
  state.selectedLeague = "Нижняя лига";
  if (!state.seasonNumber) state.seasonNumber = 1;
  ensureLeagueMembershipSnapshot(Number(state.seasonNumber)||1);
  saveState(); $("onboarding").classList.add("hidden"); $("dashboard").classList.remove("hidden"); render();
  // The first cloud initialization must run after the player creates a coach and team.
  void initializeCloudCareer();
});


function onlineRatingEntry(item, place) {
  const row=document.createElement("article");row.className="online-rating-entry online-rating-entry-unified";
  const rank=safeText("span",String(place),"online-rating-place");row.append(rank);
  const identity=document.createElement("div");identity.className="online-rating-identity";
  const coachLine=document.createElement("div");coachLine.className="online-rating-coach-line";
  const avatarRarity=validShopRarity(item.avatar_rarity)||rarityFromShopPath(item.avatar_path,"avatars")||"uncommon";
  const avatarWrap=document.createElement("span");avatarWrap.className="online-rating-art online-rating-avatar-art rarity-"+avatarRarity;
  const avatar=document.createElement("img");avatar.className="online-rating-avatar";avatar.src=item.avatar_path||avatarPath(item.avatar_index||1);avatar.alt="Аватар тренера";avatar.loading="lazy";avatar.onerror=()=>{avatar.src=avatarPath(item.avatar_index||1)};
  avatarWrap.append(avatar);
  coachLine.append(avatarWrap,safeText("b",item.coach_name||"Тренер","online-rating-coach-name"));
  const teamLine=document.createElement("div");teamLine.className="online-rating-team-line";
  const logoRarity=validShopRarity(item.team_logo_rarity)||rarityFromShopPath(item.team_logo_path,"logos")||"uncommon";
  const logoWrap=document.createElement("span");logoWrap.className="online-rating-art online-rating-logo-art rarity-"+logoRarity;
  const logo=document.createElement("img");logo.className="online-rating-team-logo";logo.src=item.team_logo_path||teamLogoPath(item.team_logo_index||1);logo.alt="Эмблема команды";logo.loading="lazy";logo.onerror=()=>{logo.src=teamLogoPath(item.team_logo_index||1)};
  logoWrap.append(logo);teamLine.append(logoWrap,safeText("span",item.team_name||"Команда"));
  identity.append(coachLine,teamLine);
  if(item.coach_title)identity.append(safeText("span",item.coach_title,"equipped-title-badge rarity-"+(validShopRarity(item.coach_title_rarity)||"uncommon")));
  if(item.team_title)identity.append(safeText("span",item.team_title,"equipped-title-badge rarity-"+(validShopRarity(item.team_title_rarity)||"uncommon")));
  const awards=Array.isArray(item.awards)?item.awards:[];
  if(awards.length){const shelf=document.createElement("div");shelf.className="online-rating-awards";shelf.setAttribute("aria-label","Награды тренера");awards.slice(0,80).forEach(award=>{if(!award||!award.icon)return;const icon=awardIconPath(award.icon);icon.className="online-rating-award-icon";icon.alt=award.label||"Награда";icon.title=award.label||"Награда";shelf.append(icon)});if(shelf.childElementCount)identity.append(shelf)}
  const metrics=document.createElement("div");metrics.className="online-rating-metrics";
  const xp=Number(item.xp)||0, permanent=Number(item.general_rating)||0;
  [["ОПЫТ АККАУНТА",xp.toLocaleString("ru-RU")+" XP"],["ПОСТОЯННЫЙ РЕЙТИНГ",permanent.toLocaleString("ru-RU")]].forEach(([label,value])=>{const metric=document.createElement("div");metric.className="online-rating-metric";metric.append(safeText("small",label),safeText("b",value));metrics.append(metric)});
  row.append(identity,metrics);return row;
}
function validShopRarity(value){return ["common","uncommon","rare","epic","legendary"].includes(String(value||""))?String(value):null}
function rarityFromShopPath(path,kind){const match=String(path||"").match(new RegExp("/assets/shop/"+kind+"/(common|uncommon|rare|epic|legendary)/"));return match?match[1]:null}
async function fetchOnlineRatings() {
  return await cloudRequest("POST",{action:"get-online-ratings"});
}
function renderOnlineRatings() {
  const wrap=document.createElement("div");wrap.className="online-ratings-page online-ratings-page-unified";
  const intro=document.createElement("p");intro.className="muted";intro.textContent="Единый рейтинг тренеров по опыту аккаунта. В таблице показаны опыт аккаунта и постоянный рейтинг.";
  const actions=document.createElement("div");actions.className="online-ratings-actions";
  const send=document.createElement("button");send.type="button";send.className="online-submit-button";send.textContent="ОТПРАВИТЬ РЕЗУЛЬТАТ";
  const recordsButton=document.createElement("button");recordsButton.type="button";recordsButton.className="online-submit-button";recordsButton.textContent="ОНЛАЙН РЕКОРДЫ";
  const status=safeText("p","","online-rating-status");status.setAttribute("role","status");status.setAttribute("aria-live","polite");
  const grid=document.createElement("div");grid.className="online-ratings-grid online-ratings-grid-unified";
  const panel=document.createElement("section");panel.className="online-rating-panel online-rating-panel-unified";
  const heading=document.createElement("div");heading.className="online-rating-heading";heading.append(safeText("h2","ОПЫТ АККАУНТА — РЕЙТИНГ ТРЕНЕРОВ"),safeText("p","Сортировка по опыту аккаунта: от большего к меньшему.","muted"));
  const list=document.createElement("div");list.className="online-rating-list online-rating-list-unified";list.append(placeholder("Загружаю онлайн-рейтинг…"));
  const lists={unified:list};panel.append(heading,list);grid.append(panel);
  send.addEventListener("click",()=>submitBothOnlineRatings(send,status,lists));
  recordsButton.addEventListener("click",()=>openPage("onlineRecords"));
  actions.append(send,recordsButton);wrap.append(intro,actions,status,grid);
  void loadOnlineRatings(lists,{unified:status});return wrap;
}
async function loadOnlineRatings(lists,statuses={}) {
  try {
    const result=await fetchOnlineRatings();
    const list=lists.unified;
    if(list){
      list.replaceChildren();
      const rows=(result.xpRatings||result.ratings||[]).slice().sort((a,b)=>(Number(b.xp)||0)-(Number(a.xp)||0));
      if(!rows.length)list.append(placeholder("Пока никто не отправил результат. Будь первым!"));
      else rows.forEach((item,index)=>list.append(onlineRatingEntry(item,index+1)));
    } else {
      [["xp",result.xpRatings||[]],["general",result.generalRatings||[]]].forEach(([type,rows])=>{const target=lists[type];if(!target)return;target.replaceChildren();if(!rows.length){target.append(placeholder("Пока никто не отправил результат. Будь первым!"));return;}rows.forEach((item,index)=>target.append(onlineRatingEntry(item,index+1)))});
    }
  } catch(error) {
    Object.values(lists).forEach(list=>{list.replaceChildren(placeholder("Не удалось загрузить онлайн-рейтинг. Попробуй обновить страницу."))});
    Object.values(statuses).forEach(status=>status.textContent="Ошибка загрузки: "+(error?.message||"неизвестная ошибка"));
  }
}
async function submitOnlineRating(type,button,status,lists) {
  if(button.disabled)return;
  if(!state.coachName||!state.teamName){status.textContent="Сначала создай тренера и команду.";return;}
  const team=getUserTeam();
  if(!team){status.textContent="Не удалось определить команду тренера.";return;}
  button.disabled=true;button.textContent="ОТПРАВКА…";status.textContent="";
  try {
    ensureCareerIdentity();
    const awards=careerAwardsFor("coach",team.id).map(item=>({icon:item.icon,label:item.label||"Награда",caption:item.caption||"",season:Number(item.season)||Number(state.seasonNumber)||1,round:Number(item.round)||0})).filter(item=>/^[a-z0-9_-]{1,80}$/i.test(String(item.icon||""))).slice(0,80);
    const payload={
      action:"submit-online-rating",ratingType:type,
      coachName:state.coachName,teamName:state.teamName,
      seasonNumber:Math.max(1,Math.floor(Number(state.seasonNumber)||1)),
      avatarIndex:Math.max(1,Math.min(6,Math.floor(Number(state.avatarIndex)||1))),
      teamLogoIndex:Math.max(1,Math.min(6,Math.floor(Number(state.teamLogoIndex)||1))),
      avatarPath:displayedAvatarPath(),teamLogoPath:displayedTeamLogoPath(),
      avatarRarity:getEquippedShopItem("avatar")?.rarity||rarityFromShopPath(displayedAvatarPath(),"avatars")||"uncommon",teamLogoRarity:getEquippedShopItem("logo")?.rarity||rarityFromShopPath(displayedTeamLogoPath(),"logos")||"uncommon",
      seasonRating:Math.max(0,Math.floor(Number(state.seasonRating)||0)),respect:Math.max(0,Math.round((Number(updateCoachRespect())||0)*100)/100),
      coachTitle:getEquippedCoachTitle()?.name||"",coachTitleRarity:getEquippedCoachTitle()?.rarity||null,
      teamTitle:getEquippedTeamTitle()?.name||"",teamTitleRarity:getEquippedTeamTitle()?.rarity||null,
      awards
    };
    if(type==="xp")payload.xp=Math.max(0,Math.floor(Number(state.xp)||0));
    else payload.generalRating=Math.max(0,Math.floor(Number(state.permanentRating)||0));
    const result=await cloudRequest("POST",payload);
    await loadOnlineRatings(lists,{});
    status.textContent=result.updated?"Результат отправлен в онлайн-рейтинг!":"Результат успешно отправлен.";
  } catch(error) {
    status.textContent="Не удалось отправить результат: "+(error?.message||"проверь подключение и попробуй снова.");
  } finally {
    button.disabled=false;button.textContent="ОТПРАВИТЬ В ОНЛАЙН";
  }
}


function buildOnlineCareerRecordCandidates() {
  const history=Array.isArray(state.careerHistory?.officialMatches)?state.careerHistory.officialMatches:[];
  const ownId=getUserTeam()?.id||state.careerTeamId;
  const matches=history.filter(m=>m&&(m.homeId===ownId||m.awayId===ownId)).map(m=>{
    const home=m.homeId===ownId;
    const gf=Number(m.goalsFor??(home?m.homeScore:m.awayScore)??0);
    const ga=Number(m.goalsAgainst??(home?m.awayScore:m.homeScore)??0);
    return {...m,gf,ga,result:m.result||(gf>ga?"W":gf<ga?"L":"D")};
  }).sort((a,b)=>(Number(a.season)||1)-(Number(b.season)||1)||(Number(a.day)||0)-(Number(b.day)||0));
  const dateLabel=m=>"Сезон "+(m.season||1)+" · День "+(m.day||officialRoundDay(m.round||1));
  const opp=m=>m.homeId===ownId?(leagueData?.teams?.find(t=>t.id===m.awayId)?.name||"Соперник"):(leagueData?.teams?.find(t=>t.id===m.homeId)?.name||"Соперник");
  const records=[];
  const wins=matches.filter(m=>m.gf>m.ga).sort((a,b)=>(b.gf-b.ga)-(a.gf-a.ga)||b.gf-a.gf);
  const losses=matches.filter(m=>m.gf<m.ga).sort((a,b)=>(b.ga-b.gf)-(a.ga-a.gf)||b.ga-a.ga);
  if(wins[0])records.push({recordType:"biggest_win",metricValue:wins[0].gf-wins[0].ga,snapshot:{value_label:wins[0].gf+" : "+wins[0].ga,detail:(state.teamName||"Команда")+" — "+opp(wins[0]),date_label:dateLabel(wins[0])}});
  if(losses[0])records.push({recordType:"biggest_loss",metricValue:losses[0].ga-losses[0].gf,snapshot:{value_label:losses[0].gf+" : "+losses[0].ga,detail:(state.teamName||"Команда")+" — "+opp(losses[0]),date_label:dateLabel(losses[0])}});
  const players=new Map();
  matches.forEach(m=>(m.events||[]).filter(e=>e.type==="goal").forEach(e=>{
    const side=e.side==="home"?"home":e.side==="away"?"away":null;if(!side||!e.scorer)return;
    if((side==="home"?m.homeId:m.awayId)!==ownId)return;
    const p=players.get(e.scorer)||{name:e.scorer,goals:0,assists:0,lastGoalRecord:m};
    p.goals++;p.lastGoalRecord=m;players.set(e.scorer,p);
    if(e.assist){const a=players.get(e.assist)||{name:e.assist,goals:0,assists:0,lastAssistRecord:m};a.assists++;a.lastAssistRecord=m;players.set(e.assist,a);}
  }));
  const scorers=[...players.values()].filter(p=>p.goals>0).sort((a,b)=>b.goals-a.goals||b.assists-a.assists||a.name.localeCompare(b.name,"ru"));
  const assistants=[...players.values()].filter(p=>p.assists>0).sort((a,b)=>b.assists-a.assists||b.goals-a.goals||a.name.localeCompare(b.name,"ru"));
  if(scorers[0])records.push({recordType:"top_scorer",metricValue:scorers[0].goals,snapshot:{value_label:scorers[0].name+" · "+scorers[0].goals+" гол.",detail:"Лучший бомбардир команды",date_label:dateLabel(scorers[0].lastGoalRecord)}});
  if(assistants[0])records.push({recordType:"top_assistant",metricValue:assistants[0].assists,snapshot:{value_label:assistants[0].name+" · "+assistants[0].assists,detail:"Голевых передач",date_label:dateLabel(assistants[0].lastAssistRecord)}});
  const streak=kind=>{let best=0,current=0,end=null;matches.forEach(m=>{if(m.result===kind){current++;if(current>best){best=current;end=m;}}else current=0;});return {count:best,end};};
  const winning=streak("W"),losing=streak("L");
  if(winning.count)records.push({recordType:"winning_streak",metricValue:winning.count,snapshot:{value_label:winning.count+" матчей подряд",detail:"Победная серия",date_label:dateLabel(winning.end)}});
  if(losing.count)records.push({recordType:"losing_streak",metricValue:losing.count,snapshot:{value_label:losing.count+" матчей подряд",detail:"Проигрышная серия",date_label:dateLabel(losing.end)}});
  const highest=[...matches].sort((a,b)=>(b.gf+b.ga)-(a.gf+a.ga)||b.gf-a.gf)[0];
  if(highest)records.push({recordType:"highest_scoring_match",metricValue:highest.gf+highest.ga,snapshot:{value_label:highest.gf+" : "+highest.ga,detail:(state.teamName||"Команда")+" — "+opp(highest),date_label:dateLabel(highest)}});
  const coachTitle=getEquippedCoachTitle(),teamTitle=getEquippedTeamTitle();
  const base={coach_name:displayedCoachName(),team_name:displayedTeamName(),season_number:Math.max(1,Number(state.seasonNumber)||1),avatar_index:Math.max(1,Math.min(6,Number(state.avatarIndex)||1)),team_logo_index:Math.max(1,Math.min(6,Number(state.teamLogoIndex)||1)),avatar_path:displayedAvatarPath(),team_logo_path:displayedTeamLogoPath(),coach_title:coachTitle?.name||"",coach_title_rarity:coachTitle?.rarity||null,team_title:teamTitle?.name||"",team_title_rarity:teamTitle?.rarity||null};
  return records.map(record=>({...record,snapshot:{...base,...record.snapshot}}));
}
function renderOnlineCareerRecords() {
  const wrap=document.createElement("div");wrap.className="online-career-records-page";
  const actions=document.createElement("div");actions.className="online-ratings-actions";
  const home=document.createElement("button");home.type="button";home.className="back-button";home.textContent="НА ГЛАВНУЮ";home.addEventListener("click",returnToDashboard);
  const send=document.createElement("button");send.type="button";send.className="online-submit-button";send.textContent="ОТПРАВИТЬ ОНЛАЙН";
  const status=safeText("p","","online-rating-status");status.setAttribute("role","status");status.setAttribute("aria-live","polite");
  const list=document.createElement("div");list.className="online-career-records-list";list.append(placeholder("Загружаю онлайн-рекорды…"));
  const names={biggest_win:"Самая крупная победа",biggest_loss:"Самое крупное поражение",top_scorer:"Лучший бомбардир",top_assistant:"Лучший ассистент",winning_streak:"Победная серия",losing_streak:"Проигрышная серия",highest_scoring_match:"Самый результативный матч"};
  let loadedRows=[];
  const renderRows=rows=>{loadedRows=Array.isArray(rows)?rows:[];renderCategoryView();};
  function renderCategoryView(){
    list.replaceChildren();
    const intro=safeText("p","Выбери категорию, чтобы открыть её таблицу. В каждой категории показываются до 100 лучших записей.","muted");intro.className="online-records-intro";list.append(intro);
    const grouped=new Map();loadedRows.forEach(row=>{const key=row.record_type;(grouped.get(key)||grouped.set(key,[]).get(key)).push(row);});
    const grid=document.createElement("div");grid.className="online-record-category-grid";
    Object.keys(names).forEach(type=>{
      const entries=grouped.get(type)||[];const card=document.createElement("button");card.type="button";card.className="online-record-category-card";
      card.append(safeText("strong",names[type],"online-record-category-title"),safeText("span",entries.length+" из 100 записей","online-record-category-count"),safeText("small",entries.length?((entries[0].record_snapshot||{}).value_label||String(entries[0].metric_value)):"Пока нет записей","online-record-category-best"),safeText("span","ОТКРЫТЬ →","online-record-category-open"));
      card.addEventListener("click",()=>renderCategoryDetail(type));grid.append(card);
    });
    list.append(grid);
  }
  function renderCategoryDetail(type){
    list.replaceChildren();const entries=loadedRows.filter(row=>row.record_type===type).slice(0,100);
    const top=document.createElement("div");top.className="online-record-detail-heading";const back=document.createElement("button");back.type="button";back.className="back-button";back.textContent="← ВСЕ КАТЕГОРИИ";back.addEventListener("click",renderCategoryView);
    top.append(back,safeText("h2",names[type]||"Рекорды"));list.append(top,safeText("p",entries.length+" из 100 лучших записей в категории","muted"));
    if(!entries.length){list.append(placeholder("В этой категории пока нет отправленных рекордов."));return;}
    const panel=document.createElement("section");panel.className="online-record-panel online-record-detail-panel";
    entries.forEach((entry,index)=>{
      const snap=entry.record_snapshot||{};const row=document.createElement("article");row.className="online-record-entry";row.append(safeText("span",String(index+1),"online-rating-place"));
      const identity=document.createElement("div");identity.className="online-rating-identity";const avatar=document.createElement("img");avatar.className="online-rating-avatar";avatar.src=snap.avatar_path||avatarPath(snap.avatar_index||1);avatar.alt="Аватар тренера";
      const coachLine=document.createElement("div");coachLine.className="online-rating-coach-line";coachLine.append(avatar,safeText("b",snap.coach_name||"Тренер","online-rating-coach-name"));identity.append(coachLine);
      if(snap.coach_title)identity.append(safeText("span",snap.coach_title,"equipped-title-badge rarity-"+(snap.coach_title_rarity||"uncommon")));
      const teamLine=document.createElement("div");teamLine.className="online-rating-team-line";const logo=document.createElement("img");logo.className="online-rating-team-logo";logo.src=snap.team_logo_path||teamLogoPath(snap.team_logo_index||1);logo.alt="Эмблема команды";teamLine.append(logo,safeText("span",snap.team_name||"Команда"));identity.append(teamLine);
      if(snap.team_title)identity.append(safeText("span",snap.team_title,"equipped-title-badge rarity-"+(snap.team_title_rarity||"uncommon")));
      if(snap.detail)identity.append(safeText("small",snap.detail));const score=document.createElement("div");score.className="online-rating-score";score.append(safeText("b",snap.value_label||String(entry.metric_value)),safeText("small",snap.date_label||"Рекорд"));
      row.append(identity,score);panel.append(row);
    });
    list.append(panel);
  }
  send.addEventListener("click",async()=>{if(send.disabled)return;if(!state.coachName||!state.teamName){status.textContent="Сначала создай тренера и команду.";return;}send.disabled=true;send.textContent="ОТПРАВКА…";status.textContent="";try{ensureCareerIdentity();const records=buildOnlineCareerRecordCandidates();if(!records.length){status.textContent="Сначала сыграй официальные матчи — пока нечего отправлять.";return;}const result=await cloudRequest("POST",{action:"submit-online-career-records",records});const changed=(result.results||[]).filter(x=>x.updated).length;status.textContent=changed?"Обновлено рекордов: "+changed+". Равные и худшие результаты не заменяют прежние.":"Новых рекордов нет: сохранены прежние лучшие результаты.";await loadRecords();}catch(error){status.textContent="Не удалось отправить рекорды: "+(error?.message||"проверь подключение и попробуй снова.");}finally{send.disabled=false;send.textContent="ОТПРАВИТЬ ОНЛАЙН";}});
  async function loadRecords(){try{const result=await cloudRequest("POST",{action:"get-online-career-records"});renderRows(result.records||[]);}catch(error){list.replaceChildren(placeholder("Не удалось загрузить онлайн-рекорды. Попробуй обновить страницу."));status.textContent="Ошибка загрузки: "+(error?.message||"неизвестная ошибка");}}
  actions.append(home,send);wrap.append(actions,status,list);void loadRecords();return wrap;
}
async function submitBothOnlineRatings(button,status,lists) {
  if(button.disabled)return;if(!state.coachName||!state.teamName){status.textContent="Сначала создай тренера и команду.";return;}
  const team=getUserTeam();if(!team){status.textContent="Не удалось определить команду тренера.";return;}
  button.disabled=true;button.textContent="ОТПРАВКА…";status.textContent="";
  try{ensureCareerIdentity();const awards=careerAwardsFor("coach",team.id).map(item=>({icon:item.icon,label:item.label||"Награда",caption:item.caption||"",season:Number(item.season)||Number(state.seasonNumber)||1,round:Number(item.round)||0})).filter(item=>/^[a-z0-9_-]{1,80}$/i.test(String(item.icon||""))).slice(0,80);
    const coachTitle=getEquippedCoachTitle(),teamTitle=getEquippedTeamTitle();const common={coachName:state.coachName,teamName:state.teamName,seasonNumber:Math.max(1,Math.floor(Number(state.seasonNumber)||1)),avatarIndex:Math.max(1,Math.min(6,Math.floor(Number(state.avatarIndex)||1))),teamLogoIndex:Math.max(1,Math.min(6,Math.floor(Number(state.teamLogoIndex)||1))),avatarPath:displayedAvatarPath(),teamLogoPath:displayedTeamLogoPath(),avatarRarity:getEquippedShopItem("avatar")?.rarity||rarityFromShopPath(displayedAvatarPath(),"avatars")||"uncommon",teamLogoRarity:getEquippedShopItem("logo")?.rarity||rarityFromShopPath(displayedTeamLogoPath(),"logos")||"uncommon",seasonRating:Math.max(0,Math.floor(Number(state.seasonRating)||0)),respect:Math.max(0,Math.round((Number(updateCoachRespect())||0)*100)/100),coachTitle:coachTitle?.name||"",coachTitleRarity:coachTitle?.rarity||null,teamTitle:teamTitle?.name||"",teamTitleRarity:teamTitle?.rarity||null,awards};
    await cloudRequest("POST",{action:"submit-online-rating",ratingType:"both",...common,xp:Math.max(0,Math.floor(Number(state.xp)||0)),generalRating:Math.max(0,Math.floor(Number(state.permanentRating)||0))});
    await loadOnlineRatings(lists,{});status.textContent="Опыт и общий рейтинг отправлены."; 
  }catch(error){status.textContent="Не удалось отправить оба показателя: "+(error?.message||"проверь подключение и попробуй снова.");}
  finally{button.disabled=false;button.textContent="ОТПРАВИТЬ РЕЗУЛЬТАТ";}
}


const FAQ_MARKDOWN = "## FAQ — Помощь игрокам\n\nДобро пожаловать в «Футбольный тренер. Начало»!\n\nЗдесь ты не просто управляешь футбольной командой. Ты развиваешь собственных футболистов, выстраиваешь с ними отношения, подбираешь тактику, проводишь тренировки и ведёшь свой двор к победам.\n\nВ этом руководстве собраны ответы на основные вопросы об игре, развитии тренера и футболистов, тренировках, матчах и решении возможных проблем.\n\n---\n\n## 1. С чего начать игру?\n\n**Что нужно делать в самом начале?**\n\nНачни знакомство с командой и возможностями тренера. На главной странице расположены основные игровые разделы:\n\n- **Игровые события** — разговоры с футболистами, новости команды и важные уведомления, которые появляются в нужный игровой день.\n- **Кабинет тренера** — информация о тренере и его развитии.\n- **Цели тренера** — задачи, выполнение которых помогает развиваться.\n- **Тренировки игроков** — развитие футболистов своей команды.\n\nВо дворе города доступны другие важные игровые разделы: турниры, отношения с футболистами, состав команды, свободный двор и трансферный обмен игроками.\n\n**В каком порядке лучше действовать?**\n\nДля начала изучи свою команду, познакомься с футболистами и их амплуа, затем переходи к тренировкам и развитию отношений. Следи за игровым календарём, чтобы не пропускать официальные матчи.\n\n**Что такое двор города?**\n\nЭто основное пространство твоей футбольной команды. Здесь ты работаешь с составом, следишь за турнирами и используешь доступные игровые системы.\n\n---\n\n## 2. Как развивать тренера?\n\n**Что такое опыт тренера (XP)?**\n\nXP — это очки опыта тренера. Они отражают его развитие и начисляются за предусмотренные игрой действия.\n\nОпыт тренера и очки, которые используются для развития характеристик футболистов, — разные игровые показатели. Не путай их между собой.\n\n**Как получать опыт?**\n\nОсновные игровые активности, связанные с развитием тренера, включают:\n\n- выполнение целей;\n- участие в предусмотренных игровых активностях;\n- проведение тренировок;\n- другие действия, за которые игра начисляет опыт.\n\nКоличество начисляемого опыта зависит от конкретной активности и действующих правил игры.\n\n**Что делать с целями тренера?**\n\nРегулярно проверяй раздел целей. Выполняй доступные задания и следи за их условиями. Если задача ограничена игровым периодом, старайся завершить её до окончания этого периода.\n\n---\n\n## 3. Как устроена команда?\n\n**Какие позиции есть у футболистов?**\n\nВ игре предусмотрены четыре основные характеристики, связанные с футбольными амплуа:\n\n- **ВР — вратарь.** Игра на последнем рубеже обороны и отражение ударов.\n- **ЗЩ — защитник.** Отборы, перехваты и помощь команде в обороне.\n- **ПЗ — полузащитник.** Участие в построении атак, передачах и контроле мяча.\n- **НП — нападающий.** Создание голевых моментов и завершение атак.\n\nУ каждого футболиста есть свои сильные стороны. При выборе состава учитывай его позицию и подходящую тактическую схему.\n\n**Как выбрать тактику?**\n\nВыбирай схему с учётом состава и предполагаемого стиля игры. Важно не только определить тактику, но и правильно распределить футболистов по позициям.\n\nДоступные схемы включают:\n\n- 2–2–1 — сбалансированная;\n- 2–1–2 — атакующая;\n- 1–3–1 — с акцентом на полузащиту;\n- 3–1–1 — оборонительная.\n\n**Почему я не вижу характеристики некоторых футболистов?**\n\nВ игре действует система отношений между тренером и футболистом. Информация о характеристиках и скрытом потенциале может быть недоступна, пока отношения не достигнут установленного уровня.\n\nДля игроков, открываемых через «Свободный двор», предусмотрен порог **60% отношений** для раскрытия характеристик и потенциала.\n\nЭто часть игровой механики: тренеру предстоит не только развивать команду, но и лучше узнавать своих футболистов.\n\n---\n\n## 4. Отношения с футболистами\n\n**Зачем нужны отношения?**\n\nОтношения показывают, насколько футболист сблизился с тренером. Это самостоятельная система развития, которая влияет на доступность информации о футболистах и связана с взаимодействием с ними.\n\n**Как повышать отношения?**\n\nИспользуй предусмотренные игрой активности, включая индивидуальные тренировки и соответствующие мини-игры. У разных действий могут быть разные правила начисления.\n\nДля индивидуальных тренировочных мини-игр действует принцип: **100 набранных очков соответствуют +1 процентному пункту отношений**, если конкретная мини-игра использует эту схему.\n\n**Можно ли потерять отношения после поражения?**\n\nПо согласованному правилу официальных матчей поражение не снижает отношения. Личный бонус футболиста за хорошее выступление сохраняется независимо от результата команды.\n\n**Как отношения связаны с характеристиками?**\n\nПо мере развития отношений могут открываться ранее скрытые сведения о футболисте. Поэтому знакомство с игроками — важная часть долгосрочного развития команды.\n\n---\n\n## 5. Тренировки и мини-игры\n\n**Зачем нужны мини-игры?**\n\nМини-игры позволяют взаимодействовать с футболистами и получать предусмотренные награды. Некоторые активности направлены на развитие отношений, другие — на тренировку характеристик.\n\n**Какие мини-игры связаны с футболистами?**\n\nВ тренировочной системе предусмотрены разные типы активности:\n\n- **Вратарь:** ловля мячей.\n- **Защитник:** реакция и ловля появляющихся мячей.\n- **Полузащитник и нападающий:** сбор мячей с препятствиями в игровой механике «Змейка».\n- **Три в ряд:** отдельная мини-игра, в которой собираются одинаковые футбольные символы.\n\nТочный набор доступных действий зависит от текущей версии игры.\n\n**Как сохранять результат мини-игры?**\n\nЕсли в мини-игре есть кнопка «СОХРАНИТЬ РЕЗУЛЬТАТ И ВЫЙТИ», используй её после завершения активности. Это позволяет завершить игру и применить предусмотренные награды.\n\nПеред выходом убедись, что результат сохранён. Не закрывай страницу сразу после завершения мини-игры, если игра ещё обрабатывает результат.\n\n**Как начисляются очки в тренировках?**\n\nКоличество очков и правила их применения зависят от конкретной мини-игры. Очки тренера, очки на развитие характеристики и очки, используемые для расчёта отношений, не следует считать одним и тем же ресурсом.\n\nВ индивидуальных тренировках накопленные очки на развитие характеристики могут сгорать после завершения тренировки — согласно принятому правилу системы.\n\n**Что даёт командная тренировка?**\n\nКомандная тренировка предназначена для работы со всей командой. По согласованному правилу за завершённую командную тренировку тренеру начисляется **+1000 XP**.\n\n---\n\n## 6. Свободный двор\n\n**Что такое «Свободный двор»?**\n\nЭто раздел, в котором можно знакомиться с новыми футболистами и приглашать их в свою команду.\n\n**Как появляются новые игроки?**\n\nПо согласованной концепции игры новый футболист появляется раз в игровой месяц на уровне игрового мира. Если его не пригласили сразу, он должен оставаться доступным, пока кто-нибудь не пригласит его в команду.\n\n**Можно ли увидеть характеристики новичка сразу?**\n\nНет, характеристики и скрытый потенциал открываются при достижении установленного уровня отношений — **60%**.\n\n**Почему я не могу пригласить футболиста?**\n\nПроверь, есть ли свободное место в составе. Максимальный размер команды в рамках принятых правил — 10 футболистов. Если состав заполнен, сначала потребуется освободить место.\n\n---\n\n## 7. Турниры и официальные матчи\n\n**Как узнать, когда состоится матч?**\n\nСледи за игровым календарём и разделом турниров. В день официального матча на главной странице предусмотрена кнопка «НАЧАТЬ МАТЧ».\n\n**Что нужно сделать перед началом матча?**\n\nПеред стартом встречи тренер должен подготовить состав и выбрать тактику. Расстановка должна учитывать позиции футболистов и выбранную игровую схему.\n\n**Что происходит во время матча?**\n\nМатч моделирует игровые события: атаки, голы, передачи, сейвы и другие ситуации. В ходе встречи важно следить за счётом, событиями на поле и возможностями управления составом.\n\n**Что происходит после матча?**\n\nПосле завершения встречи предусмотрено отдельное окно «ИТОГИ ВСТРЕЧИ». В нём планируется отображать:\n\n- итоговый счёт;\n- авторов голов и голевые передачи;\n- статистику ударов и владения мячом;\n- события и ключевые моменты встречи;\n- сведения о составе;\n- результаты других матчей тура;\n- информацию о трибунах и зрителях;\n- изменения отношений с футболистами, если они начислены по правилам игры.\n\nДоступность и полнота отдельных показателей зависят от реализации текущей версии игры.\n\n**Как начисляются отношения после официального матча?**\n\nСогласовано, что учитываются и результат команды, и личное выступление футболиста. Максимальный прирост составляет **+2 процентных пункта за матч на одного игрока**.\n\nПоражение не уменьшает отношения. Запасные футболисты получают командный бонус даже в том случае, если не выходили на поле. Бонус за хорошую личную оценку начинается с оценки 7 из 10.\n\n---\n\n## 8. Как работает календарь?\n\nИгровое время движется по дням. Кнопка «ПРОПУСТИТЬ ДЕНЬ» предназначена для перехода к следующему игровому дню.\n\nВ сезоне предусмотрены игровые туры и перерыв. Если наступил день официального матча, сначала необходимо сыграть и сохранить встречу, а затем продолжать календарь.\n\n**Почему не получается пропустить день?**\n\nПроверь, не назначен ли на сегодня официальный матч. Если матч ещё не сыгран и не сохранён, переход к следующему дню может быть заблокирован.\n\n**Почему футболисты меняют возраст?**\n\nВ игре предусмотрена система возраста и дней рождения футболистов. Возраст меняется по календарю, а продолжительность карьеры футболиста ограничена установленными игровыми правилами.\n\n---\n\n## 9. Частые проблемы и способы решения\n\n### Игра зависла или кнопка не реагирует\n\n1. Подожди несколько секунд, если игра выполняет действие или сохраняет результат.\n2. Проверь интернет-соединение.\n3. Если проблема повторяется, попробуй перезагрузить страницу.\n4. Перед перезагрузкой убедись, что результат мини-игры или матча был сохранён.\n\n### После обновления страницы пропал результат\n\nПроверь, была ли нажата кнопка сохранения результата. Если результат не сохранился, зафиксируй обстоятельства: какая мини-игра была запущена, сколько очков набрано и в какой момент произошла ошибка.\n\n### На телефоне не работают элементы управления\n\nПопробуй обновить страницу и убедись, что используешь актуальную версию браузера. Если проблема сохраняется, сообщи разработчику модель устройства, браузер и название мини-игры.\n\n### Не отображаются портреты футболистов или логотипы\n\nОбнови страницу. Если изображения не появились, сообщи, в каком разделе это произошло и у каких футболистов или команд отсутствуют изображения.\n\n### Не удаётся начать матч\n\nПроверь игровой день, наличие назначенной встречи и доступность кнопки «НАЧАТЬ МАТЧ». Если проблема сохраняется, сообщи номер сезона, день и тур.\n\n### Не начислились очки или опыт\n\nУбедись, что активность завершена и результат сохранён. Если награда не появилась, запиши название активности, результат и ожидаемую награду. Это поможет разобраться в проблеме.\n\n---\n\n## 10. Полезные советы тренеру\n\n- Обращай внимание на всплывающие события и регулярно проверяй цели тренера.\n- Следи за игровым календарём и не пропускай официальные матчи.\n- Подбирай тактику с учётом позиций футболистов.\n- Развивай отношения с игроками, чтобы лучше узнавать их возможности.\n- Перед выходом из мини-игры сохраняй результат, если такая кнопка предусмотрена.\n- Не путай XP тренера, очки мини-игр и очки развития характеристик.\n- Следи за составом и свободными местами для новых футболистов.\n- После каждого матча изучай результаты и делай выводы перед следующей встречей.\n\n---\n\n## 11. Как сообщить об ошибке?\n\nЕсли ты столкнулся с проблемой, укажи:\n\n1. Какой раздел игры использовался.\n2. Что ты делал перед возникновением ошибки.\n3. Что произошло вместо ожидаемого результата.\n4. Используемое устройство и браузер.\n5. Если возможно, приложи скриншот.\n\nЧем подробнее описание, тем легче разобраться в проблеме и исправить её.\n\n---\n\n**Удачи, тренер!**\n\nРазвивай футболистов, строй команду, улучшай тактику и докажи, что именно твой двор достоин победы!";
function renderFaqPage(){
 const wrap=document.createElement("article");wrap.className="faq-content";
 FAQ_MARKDOWN.split("\n").forEach(line=>{
  const value=line.trim();if(!value||value==="---")return;
  let el;
  if(value.startsWith("### "))el=document.createElement("h3"),el.textContent=value.slice(4);
  else if(value.startsWith("## "))el=document.createElement("h2"),el.textContent=value.slice(3);
  else if(value.startsWith("# "))el=document.createElement("h2"),el.textContent=value.slice(2);
  else if(value.startsWith("- "))el=document.createElement("li"),el.textContent=value.slice(2);
  else if(/^\d+\. /.test(value))el=document.createElement("li"),el.textContent=value.replace(/^\d+\. /,"");
  else if(value.startsWith("**")&&value.endsWith("**"))el=document.createElement("h3"),el.textContent=value.slice(2,-2);
  else el=document.createElement("p"),el.textContent=value.replace(/\*\*/g,"");
  if(el.tagName==="LI"){let list=wrap.lastElementChild;if(!list||list.tagName!=="UL"&&list.tagName!=="OL"){list=document.createElement(/^\d+\. /.test(value)?"ol":"ul");wrap.append(list)}list.append(el)}
  else wrap.append(el);
 });
 return wrap;
}
const SHOP_RARITIES=[{key:"uncommon",label:"Необычные",price:7000},{key:"rare",label:"Редкие",price:10000},{key:"epic",label:"Эпические",price:15000},{key:"legendary",label:"Легендарные",price:23000}];
// Поддерживаем до 100 последовательных изображений каждого типа в каждой редкости.
// Отсутствующие файлы автоматически скрываются в магазине, поэтому можно добавлять новые JPG без правки кода.
const SHOP_ITEM_COUNTS={uncommon:{avatar:100,logo:100},rare:{avatar:100,logo:100},epic:{avatar:100,logo:100},legendary:{avatar:100,logo:100}};
const SHOP_TITLE_RARITIES=[
 {key:"uncommon",label:"Необычные",price:2500},
 {key:"rare",label:"Редкие",price:5000},
 {key:"epic",label:"Эпические",price:7500},
 {key:"legendary",label:"Легендарные",price:10000}
];
const SHOP_COACH_TITLES={
 uncommon:["Дворовой Архитектор","Тренер-Самокат","Главный по Сеткам","Командир Лавочки","Мастер Подкатов","Тренер-Свисток","Хранитель Мячей","Наставник с Балкона","Дирижёр Пасов","Тренер «Ещё один»"],
 rare:["Тень Забора","Голос с 5-го Этажа","Последний Мохикан Двора","Тренер-Призрак","Владелец Единственного Мяча","Страж Старых Бутс","Тренер Без Свистка","Легенда Подъезда №3","Хозяин Грязного Поля","Тренер «Я же говорил»"],
 epic:["Властелин Двора","Император Лавочки","Повелитель Подкатов","Гроза Соседей","Командующий Атакой","Несокрушимый Тренер","Король Контрпрессинга","Владыка Штрафной","Главнокомандующий Двора","Тренер Апокалипсиса"],
 legendary:["Дед-Легенда","Вечный Тренер","Живая Легенда Двора","Отец Всех Дворовых","Бессмертный Наставник","Тренер Эпохи","Папа Дворового Футбола","Великий и Ужасный","Легенда, Которую Знают Все","Тренер, Который Видел Всё"]
};
const SHOP_TEAM_TITLES={
 uncommon:["Мячи из Подъезда","Дети Асфальта","Команда с Лавочки","Грязные Бутсы","Футбол После Школы","Команда «Ещё 5 минут»","Парни с 3-го Двора","Сеточные Воины","Команда Без Тренера","Футболисты с Балкона"],
 rare:["Призраки Старого Двора","Последние Мохиканы","Команда Исчезнувшего Поля","Тени Забора","Единственные на Районе","Парни, Которых Нет в Статистике","Команда «Мы ещё вернёмся»","Забытые Чемпионы","Дети Исчезнувших Сеточек","Футболисты Без Имени"],
 epic:["Гроза Района","Непобедимые с 5-го","Империя Двора","Властелины Поля","Короли Подкатов","Легион Лавочки","Армия Асфальта","Гладиаторы Двора","Покорители Штрафной","Воины Грязного Поля"],
 legendary:["Легенды Двора","Вечные Чемпионы","Бессмертная Команда","Отцы Дворового Футбола","Команда, Которую Знает Весь Район","Живая Легенда","Чемпионы Всех Времён","Деды, Которые Всё Видели","Команда Эпохи","Легенда, Которую Нельзя Убить"]
};
const SHOP_AVATAR_LOGO_CATALOG=SHOP_RARITIES.flatMap(r=>[
 ...Array.from({length:SHOP_ITEM_COUNTS[r.key].avatar},(_,i)=>({id:"avatar-"+r.key+"-"+String(i+1).padStart(2,"0"),kind:"avatar",equipSlot:"avatar",rarity:r.key,rarityLabel:r.label,price:r.price,name:"Аватар тренера "+String(i+1).padStart(2,"0"),image:"/assets/shop/avatars/"+r.key+"/coach-"+r.key+"-"+String(i+1).padStart(2,"0")+".jpg"})),
 ...Array.from({length:SHOP_ITEM_COUNTS[r.key].logo},(_,i)=>({id:"logo-"+r.key+"-"+String(i+1).padStart(2,"0"),kind:"logo",equipSlot:"logo",rarity:r.key,rarityLabel:r.label,price:r.price,name:"Эмблема команды "+String(i+1).padStart(2,"0"),image:"/assets/shop/logos/"+r.key+"/team-logo-"+r.key+"-"+String(i+1).padStart(2,"0")+".jpg"}))
]);
const SHOP_TITLE_CATALOG=SHOP_TITLE_RARITIES.flatMap(r=>[
 ...SHOP_COACH_TITLES[r.key].map((name,i)=>({id:"coach-title-"+r.key+"-"+String(i+1).padStart(2,"0"),kind:"coachTitle",equipSlot:"coachTitle",rarity:r.key,rarityLabel:r.label,price:r.price,name})),
 ...SHOP_TEAM_TITLES[r.key].map((name,i)=>({id:"team-title-"+r.key+"-"+String(i+1).padStart(2,"0"),kind:"teamTitle",equipSlot:"teamTitle",rarity:r.key,rarityLabel:r.label,price:r.price,name}))
]);
const SHOP_CATALOG=[...SHOP_AVATAR_LOGO_CATALOG,...SHOP_TITLE_CATALOG];
function getShopItem(id){return SHOP_CATALOG.find(x=>x.id===String(id))||null}
function getEquippedShopItem(slot){const id=state.shopEquippedItems&&state.shopEquippedItems[slot],item=getShopItem(id);return item&&isShopItemOwned(item.id)?item:null}
function displayedAvatarPath(){return getEquippedShopItem("avatar")?.image||avatarPath(state.avatarIndex||1)}
function displayedTeamLogoPath(){return getEquippedShopItem("logo")?.image||teamLogoPath(state.teamLogoIndex||1)}
function equipShopItem(item){if(!item||!isShopItemOwned(item.id)||!item.equipSlot)return false;state.shopEquippedItems=state.shopEquippedItems&&typeof state.shopEquippedItems==="object"?state.shopEquippedItems:{};state.shopEquippedItems[item.equipSlot]=item.id;saveState();render();return true}
function getEquippedCoachTitle(){return getEquippedShopItem("coachTitle")}
function getEquippedTeamTitle(){return getEquippedShopItem("teamTitle")}
function displayedCoachName(){return state.coachName||"Тренер"}
function displayedTeamName(){return state.teamName||"Дворовые"}
function renderEquippedTitleBadge(element,item){if(!element)return;element.className="equipped-title-badge";if(!item){element.textContent="";element.hidden=true;return}element.textContent=item.name;element.classList.add("rarity-"+item.rarity);element.hidden=false}
function renderShopPage(){
 const wrap=document.createElement("section");wrap.className="shop-page-stack";
 const balance=document.createElement("section");balance.className="feature-panel shop-wallet";
 balance.append(safeText("p","БАЛАНС МАГАЗИНА","eyebrow"),safeText("h2",Math.floor(getShopBalance()).toLocaleString("ru-RU")+" монет","shop-wallet-value"),safeText("p","За каждый новый заработанный XP тренера дополнительно начисляется 1 монета. XP тренера не тратится на покупки. Купленные предметы остаются в коллекции навсегда.","muted"));
 const catalog=document.createElement("section");catalog.className="feature-panel shop-catalog";catalog.append(safeText("h2","Коллекция тренера и команды"),safeText("p","Покупай аватары, эмблемы и звания. Купленные предметы сохраняются в коллекции, а звания тренера и команды экипируются независимо.","muted"));
 const kindTabs=document.createElement("div");kindTabs.className="shop-tabs";kindTabs.setAttribute("aria-label","Тип предметов");
 const rarityTabs=document.createElement("div");rarityTabs.className="shop-tabs shop-rarity-tabs";rarityTabs.setAttribute("aria-label","Редкость предметов");
 const grid=document.createElement("div");grid.className="shop-item-grid";let kind="avatar",rarity="uncommon";
 const draw=()=>{
  const walletValue=balance.querySelector(".shop-wallet-value");if(walletValue)walletValue.textContent=Math.floor(getShopBalance()).toLocaleString("ru-RU")+" монет";
  kindTabs.replaceChildren();rarityTabs.replaceChildren();grid.replaceChildren();
  [["avatar","Аватары тренеров"],["logo","Эмблемы команд"],["coachTitle","Звания тренеров"],["teamTitle","Звания команд"]].forEach(([k,label])=>{const b=document.createElement("button");b.type="button";b.className="shop-tab"+(kind===k?" active":"");b.setAttribute("aria-pressed",String(kind===k));b.textContent=label;b.addEventListener("click",()=>{kind=k;draw()});kindTabs.append(b)});
  const raritySource=(kind==="coachTitle"||kind==="teamTitle")?SHOP_TITLE_RARITIES:SHOP_RARITIES;
  raritySource.forEach(r=>{const b=document.createElement("button");b.type="button";b.className="shop-tab rarity-tab rarity-"+r.key+(rarity===r.key?" active":"");b.setAttribute("aria-pressed",String(rarity===r.key));b.textContent=r.label;b.addEventListener("click",()=>{rarity=r.key;draw()});rarityTabs.append(b)});
  SHOP_CATALOG.filter(x=>x.kind===kind&&x.rarity===rarity).forEach(item=>{
   const card=document.createElement("article");card.className="shop-item-card rarity-"+item.rarity+(item.kind==="coachTitle"||item.kind==="teamTitle"?" shop-title-card":"");
   const art=document.createElement("div");art.className="shop-item-art"+(item.kind==="coachTitle"||item.kind==="teamTitle"?" shop-title-art":"");
   if(item.image){const img=document.createElement("img");img.src=item.image;img.alt=item.name;img.loading="lazy";img.decoding="async";img.onerror=()=>{card.remove()};art.append(img)}
   else{const symbol=document.createElement("span");symbol.className="shop-title-symbol";symbol.textContent=item.kind==="coachTitle"?"★":"⚽";const titlePreview=document.createElement("strong");titlePreview.className="shop-title-preview";titlePreview.textContent=item.name;art.append(symbol,titlePreview)}
   const title=safeText("h3",item.name,"shop-item-title"),meta=safeText("p",item.rarityLabel,"shop-item-rarity"),price=safeText("p",item.price.toLocaleString("ru-RU")+" монет","shop-item-price");
   const action=document.createElement("button");action.type="button";action.className="shop-item-action";
   const owned=isShopItemOwned(item.id),equipped=getEquippedShopItem(item.equipSlot)?.id===item.id;
   if(equipped){action.textContent="ИСПОЛЬЗУЕТСЯ";action.disabled=true;action.classList.add("is-equipped")}
   else if(owned){action.textContent="ИСПОЛЬЗОВАТЬ";action.addEventListener("click",()=>{equipShopItem(item);draw()})}
   else if(getShopBalance()<item.price){action.textContent="НЕДОСТАТОЧНО МОНЕТ";action.disabled=true;action.classList.add("is-unaffordable")}
   else{action.textContent="КУПИТЬ";action.addEventListener("click",()=>{const result=purchaseShopItem(item);if(result.ok){render();draw();return}action.textContent=result.reason==="already-owned"?"УЖЕ КУПЛЕНО":result.reason==="insufficient-funds"?"НЕДОСТАТОЧНО МОНЕТ":"ПОКУПКА НЕ УДАЛАСЬ";action.disabled=true})}
   card.append(art,title,meta,price,action);grid.append(card);
  });
 };
 catalog.append(kindTabs,rarityTabs,grid);wrap.append(balance,catalog);draw();return wrap
}
function renderSupportPage(){
 const wrap=document.createElement("section");wrap.className="feature-panel support-page";
 const p=document.createElement("p");p.textContent="Привет, друг! Создание игры отнимает время, силы, и конечно финансы. Если ты хочешь помочь игре в развитии, то можешь это сделать здесь. Если нет, то приятной игры, и не обращай внимания на это.";
 const actions=document.createElement("div");actions.className="support-actions";
 const donate=document.createElement("button");donate.type="button";donate.className="primary";donate.textContent="ПОМОЧЬ";donate.addEventListener("click",()=>window.open("https://www.donationalerts.com/r/valeriydos","_blank","noopener,noreferrer"));
 const back=document.createElement("button");back.type="button";back.className="secondary";back.textContent="ИГРАТЬ ДАЛЬШЕ";back.addEventListener("click",returnToDashboard);
 actions.append(donate,back);wrap.append(p,actions);return wrap;
}
async function resetCareerFromDeveloper(button) {
 const confirmed=window.confirm(
  "НАЧАТЬ КАРЬЕРУ С НУЛЯ?\n\nБудут удалены локальное сохранение и связанное облачное сохранение карьеры, а текущая команда будет закрыта. Весь прогресс карьеры, состав, достижения и игровые события текущей карьеры будут сброшены. Это действие нельзя отменить.\n\nПубличные рейтинги, сообщения онлайн-чата и данные других игроков не удаляются.\n\nДействительно начать заново?"
 );
 if(!confirmed)return;
 if(button) {button.disabled=true;button.textContent="СБРОС КАРЬЕРЫ…";}
 if(cloudSnapshotSaveTimer){clearTimeout(cloudSnapshotSaveTimer);cloudSnapshotSaveTimer=null;}
 cloudSnapshotBlocked=true;
 cloudSnapshotReady=false;
 try {
  const result=await cloudRequest("POST",{action:"reset-career"});
  if(!result?.reset)throw new Error("Сервер не подтвердил сброс карьеры.");
  localStorage.removeItem(STORAGE_KEY);
  const backupKeys=[];
  for(let i=0;i<localStorage.length;i++){
   const key=localStorage.key(i);
   if(key&&key.startsWith(CLOUD_SNAPSHOT_BACKUP_PREFIX))backupKeys.push(key);
  }
  backupKeys.forEach(key=>localStorage.removeItem(key));
  if(gameDayTimerInterval){clearInterval(gameDayTimerInterval);gameDayTimerInterval=null;}
  window.location.reload();
 } catch(error) {
  console.error("Не удалось сбросить карьеру:",error);
  if(button){button.disabled=false;button.textContent="НАЧАТЬ КАРЬЕРУ С НУЛЯ";}
  alert("Не удалось безопасно завершить сброс карьеры на сервере. Данные браузера не очищены. Проверь подключение и попробуй ещё раз.\n\nПричина: "+(error?.message||"неизвестная ошибка"));
 }
}

function renderDeveloperPage(){
 const wrap=document.createElement("section");wrap.className="feature-panel developer-page";
 const p=document.createElement("p");p.textContent="Разработчик: DOSPlay. Музыка: DOSLER, LERDOS.";
 const community=document.createElement("p");
 community.append(document.createTextNode("Переходи в ТГ группу для обсуждения и рекомендаций: "));
 const communityLink=document.createElement("a");
 communityLink.href="https://t.me/dosplayoff";
 communityLink.target="_blank";
 communityLink.rel="noopener noreferrer";
 communityLink.textContent="t.me/dosplayoff";
 communityLink.style.color="var(--accent, #8bd3ff)";
 community.append(communityLink);
 const browserGame=document.createElement("p");
 browserGame.append(document.createTextNode("Играть в браузере: "));
 const browserGameLink=document.createElement("a");
 browserGameLink.href="https://streetfootballstart.ru/";
 browserGameLink.target="_blank";
 browserGameLink.rel="noopener noreferrer";
 browserGameLink.textContent="streetfootballstart.ru";
 browserGameLink.style.color="var(--accent, #8bd3ff)";
 browserGame.append(browserGameLink);
 const warning=document.createElement("p");warning.className="muted";warning.textContent="Здесь можно начать новую карьеру. Сброс затронет только вашу карьеру и её облачное сохранение; публичные рейтинги, сообщения чата и данные других игроков останутся нетронутыми.";
 const reset=document.createElement("button");reset.type="button";reset.id="resetCareerButton";reset.className="reset-career-button";reset.textContent="НАЧАТЬ КАРЬЕРУ С НУЛЯ";
 reset.addEventListener("click",()=>void resetCareerFromDeveloper(reset));
 wrap.append(p,community,browserGame,warning,reset);return wrap
}

function renderCupPage(){
 const wrap=document.createElement("div");wrap.className="cup-page";
 const all=state.cupResults&&typeof state.cupResults==="object"?state.cupResults:{};
 const seasons=[...new Set([...Object.keys(all).filter(k=>Array.isArray(all[k]?.matches)&&all[k].matches.length),String(Number(state.seasonNumber)||1)])].sort((a,b)=>Number(b)-Number(a));
 let selected=seasons.includes(String(Number(state.seasonNumber)||1))?String(Number(state.seasonNumber)||1):seasons[0];
 const heading=document.createElement("section");heading.className="feature-panel cup-intro";
 const emblem=document.createElement("img");emblem.className="cup-page-emblem";emblem.src="/images/awards/awardcupdostatok.png";emblem.alt="Кубок Достаток";emblem.onerror=()=>{emblem.onerror=null;emblem.src="/images/awards/awardcupdostatok.jpg";emblem.onerror=()=>emblem.remove()};
 const intro=document.createElement("div");intro.append(safeText("h2","Кубок «Достаток»"),safeText("p","Ежесезонный кубковый турнир на выбывание. Восемь команд проходят в основную сетку; остальные команды проводят товарищеские встречи в дни кубковых этапов.","muted"));
 heading.append(emblem,intro,safeText("p","Жеребьёвка проводится после 9-го тура. Четвертьфиналы — дни 61, 62, 64 и 65; полуфиналы — дни 68 и 70; финал — день 75.","muted"));wrap.append(heading);
 const controls=document.createElement("section");controls.className="feature-panel cup-season-controls";controls.append(safeText("h3","Архив розыгрышей"));
 const select=document.createElement("select");select.className="league-select";select.setAttribute("aria-label","Выбрать сезон кубка");
 seasons.forEach(season=>select.add(new Option("Сезон "+season,season)));select.value=selected;
 const details=document.createElement("div");details.className="cup-season-content";
 const renderSeason=()=>{
  selected=select.value;details.replaceChildren();
  const cup=all[selected]||{matches:[],championId:null,championName:null};const matches=Array.isArray(cup.matches)?cup.matches:[];
  const stages=[["quarterfinals","Четвертьфиналы"],["semifinals","Полуфиналы"],["finals","Финал"]];
  const champion=cup.championName||(cup.championId?matchTeamLabel(cupBracketTeam(cup.championId)||{name:String(cup.championId)}):"");
  const summary=document.createElement("div");summary.className="cup-summary-grid";
  [["Сезон","№ "+selected],["Участники",String((state.cupDraws?.[selected]?.entrants||getSeasonCupTeams(Number(selected)).entrants.map(t=>t.id)).length)],["Матчи",String(matches.length)],["Победитель",champion||"Ещё не определён"]].forEach(([label,value])=>{const card=document.createElement("div");card.className="cabinet-metric";card.append(safeText("small",label),safeText("b",value));summary.append(card)});
  details.append(summary);
  const draw=state.cupDraws?.[selected];
  if(draw?.entrants?.length){const entrants=document.createElement("section");entrants.className="cup-block";entrants.append(safeText("h3","Участники основного турнира"));entrants.append(safeText("p",draw.entrants.map(id=>matchTeamLabel(cupBracketTeam(id)||{name:String(id)})).join(" · ")));details.append(entrants)}
  stages.forEach(([key,label])=>{
   const section=document.createElement("section");section.className="cup-block";section.append(safeText("h3",label));const rows=matches.filter(m=>m.stage===key);
   if(!rows.length)section.append(safeText("p",label+" ещё не сыграны.","muted"));
   rows.forEach(m=>{const row=document.createElement("article");row.className="cup-match-row";row.append(safeText("b",m.homeName||matchTeamLabel(cupBracketTeam(m.homeId)||{name:String(m.homeId)})),safeText("strong",String(m.homeScore)+":"+String(m.awayScore)),safeText("b",m.awayName||matchTeamLabel(cupBracketTeam(m.awayId)||{name:String(m.awayId)})));const meta=[];if(m.extraTime)meta.push("доп. время "+m.extraTime.home+":"+m.extraTime.away);if(m.penalties)meta.push("пенальти "+m.penalties.home+":"+m.penalties.away);if(meta.length)row.append(safeText("small",meta.join(" · ")));section.append(row)});
   details.append(section);
  });
  const statsPanel=document.createElement("section");statsPanel.className="cup-block";statsPanel.append(safeText("h3","Статистика игроков кубка"));
  const raw=matches.flatMap(m=>Array.isArray(m.playerStats)?m.playerStats:[]);
  if(!raw.length)statsPanel.append(safeText("p",matches.length?"В этом архивном розыгрыше персональная статистика не сохранялась. Новые кубковые матчи будут сохранять голы и передачи игроков.":"Статистика появится после проведения кубковых матчей.","muted"));
  else{
   const agg=new Map();raw.forEach(p=>{const key=String(p.teamId)+"::"+String(p.playerId||p.playerName);const a=agg.get(key)||{...p,goals:0,assists:0,appearances:0};a.goals+=Number(p.goals)||0;a.assists+=Number(p.assists)||0;a.appearances+=Number(p.appearances)||0;agg.set(key,a)});
   const ranked=[...agg.values()].sort((a,b)=>b.goals-a.goals||b.assists-a.assists||b.appearances-a.appearances||String(a.playerName).localeCompare(String(b.playerName),"ru"));
   const table=document.createElement("div");table.className="cup-player-stats";const header=document.createElement("div");header.className="cup-player-stat-row is-header";["Футболист","Команда","Матчи","Голы","Передачи"].forEach(v=>header.append(safeText("span",v)));table.append(header);
   ranked.forEach(p=>{const row=document.createElement("div");row.className="cup-player-stat-row";[p.playerName,p.teamName,String(p.appearances),String(p.goals),String(p.assists)].forEach(v=>row.append(safeText("span",v||"—")));table.append(row)});statsPanel.append(table);
  }
  details.append(statsPanel);
 };
 select.addEventListener("change",renderSeason);controls.append(select);wrap.append(controls,details);renderSeason();
 const history=document.createElement("section");history.className="feature-panel cup-winners-history";history.append(safeText("h2","История победителей кубка"));
 const completed=Object.keys(all).map(season=>({season,cup:all[season]})).filter(x=>x.cup?.championName||x.cup?.championId).sort((a,b)=>Number(b.season)-Number(a.season));
 if(!completed.length)history.append(safeText("p","Пока нет завершённых розыгрышей. Победители будут появляться здесь после финала.","muted"));
 else{const list=document.createElement("div");list.className="cup-winner-list";completed.forEach(({season,cup})=>{const row=document.createElement("article");row.className="cup-winner-row";row.append(safeText("b","Сезон "+season),safeText("strong",cup.championName||matchTeamLabel(cupBracketTeam(cup.championId)||{name:String(cup.championId)})));const final=(cup.matches||[]).find(m=>m.stage==="finals");if(final)row.append(safeText("small",final.homeName+" "+final.homeScore+":"+final.awayScore+" "+final.awayName));list.append(row)});history.append(list)}
 wrap.append(history);return wrap;
}

const pages = {
  cabinet: {title:"Кабинет тренера", eyebrow:"УПРАВЛЕНИЕ КОМАНДОЙ", render: renderCabinet},
  players: {title:"Футболисты во дворе", eyebrow:"СОСТАВ КОМАНДЫ", render: renderPlayers},
  training: {title:"Тренировка", eyebrow:"РАЗВИТИЕ", render: renderTraining},
  upbringing: {title:"Воспитание", eyebrow:"ОТНОШЕНИЯ", render: renderUpbringing},
  league: {title:"Календарь и матчи", eyebrow:"СЕЗОН · ОФИЦИАЛЬНЫЕ МАТЧИ", render: renderLeague},
  cup: {title:"Кубок «Достаток»", eyebrow:"КУБКОВЫЙ ТУРНИР · ИСТОРИЯ И СТАТИСТИКА", render: renderCupPage},
  seasonCalendar: {title:"Календарь сезона", eyebrow:"КАЛЕНДАРЬ · ВСЕ 182 ДНЯ", render: renderSeasonCalendar},
  otherRoundMatches: {title:"Другие встречи", eyebrow:"СЕЗОН · РЕЗУЛЬТАТЫ ВСЕХ КОМАНД", render: renderOtherRoundMatches},
  match: {title:"Матч", eyebrow:"ОФИЦИАЛЬНЫЙ ТУР", render: renderMatchPage},
  matchSummary: {title:"Итоги встречи", eyebrow:"ПОСЛЕ МАТЧА", render: renderMatchSummaryPage},
  goals: {title:"Цели тренера", eyebrow:"ПРОГРЕСС", render: () => placeholder("Система уникальных и периодических целей будет добавлена после согласования чисел и списка целей.")},
  ratings: {title:"Тренерский рейтинг", eyebrow:"РЕЙТИНГИ ТРЕНЕРОВ", render: renderOnlineRatings},
  onlineRecords: {title:"Онлайн рекорды", eyebrow:"ЛУЧШИЕ РЕЗУЛЬТАТЫ КОМАНД", render: renderOnlineCareerRecords},
  shop: {title:"Магазин", eyebrow:"МАГАЗИН НАГРАД", render: renderShopPage},
  help: {title:"FAQ / Помощь", eyebrow:"РУКОВОДСТВО ИГРОКА", render: renderFaqPage},
  support: {title:"Ваша поддержка", eyebrow:"ПОДДЕРЖКА ИГРЫ", render: renderSupportPage},
  developer: {title:"О разработчике", eyebrow:"СОЗДАТЕЛИ ИГРЫ", render: renderDeveloperPage}
};

function renderCabinet() {
  const wrap=document.createElement("div");wrap.className="cabinet-view";
  const tabs=document.createElement("div");tabs.className="cabinet-tabs";tabs.setAttribute("role","tablist");
  const body=document.createElement("div");body.className="cabinet-tab-content";
  const options=[["overview","Обзор"],["team","Футболисты"],["stats","Статистика команды"],["table","Турнирная таблица"],["matches","Матчи"],["career","Карьера тренера"]];
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
      p=panel("Карьера тренера","Постоянная история тренера и команды. Официальная статистика будет расти только от завершённых официальных матчей.");      const grid=document.createElement("div");grid.className="cabinet-metrics";
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
const PAGE_BACKGROUND_MAP = {
  cabinet: "trainer-cabinet", players: "yard-players", training: "training",
  upbringing: "yard-players", league: "league", cup: "cup-dostatok",
  seasonCalendar: "season-calendar", otherRoundMatches: "calendar-matches",
  match: "match", matchSummary: "match", goals: "coach-goals",
  ratings: "coach-rating", shop: "shop", transfers: "transfers",
  freeyard: "free-yard", help: "home", support: "home", developer: "home",
  playerCard: "player-card"
};
function setPageBackground(pageKey) {
  document.body.dataset.pageBg = PAGE_BACKGROUND_MAP[pageKey] || "home";
}

function openPage(key) {
  const page = pages[key]; if (!page) return;
  setPageBackground(key);
  $("dashboard").classList.add("hidden"); $("pageView").classList.remove("hidden");
  $("pageTitle").textContent = page.title; $("pageEyebrow").textContent = page.eyebrow;
  const content = $("pageContent"); content.replaceChildren();
  const rendered = page.render(); if (rendered) content.append(rendered);
}
function returnToDashboard() {
  setPageBackground("home");
  const pageView = $("pageView");
  const dashboard = $("dashboard");
  if (pageView) pageView.classList.add("hidden");
  if (dashboard) dashboard.classList.remove("hidden");
  const avatarPanel = $("avatarChangePanel");
  if (avatarPanel) avatarPanel.classList.add("hidden");
}
document.addEventListener("click", event => {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (!target) return;
  const homeButton = target.closest("#backHome, [data-home]");
  if (homeButton) { event.preventDefault(); returnToDashboard(); return; }
  const skipButton = target.closest("#skipDayButton");
  if (skipButton) { event.preventDefault(); if(!state.gameDayStartedAt){const beforeDay=Number(state.gameDay),beforeSeason=Number(state.seasonNumber);advanceCoachDay();if(Number(state.gameDay)!==beforeDay||Number(state.seasonNumber)!==beforeSeason)startGameDayTimer();return;} requestNextGameDay(); return; }
  const nextDayButton=target.closest("#nextGameDayButton");
  if(nextDayButton){event.preventDefault();requestNextGameDay();return;}
  const calendarButton = target.closest("#seasonCalendarButton");
  if (calendarButton) { event.preventDefault(); openPage("seasonCalendar"); return; }
  const startMatchButton = target.closest("#startMatchButton");
  if (startMatchButton && !startMatchButton.classList.contains("hidden")) { event.preventDefault(); openPage("match"); return; }
  const fullRosterButton = target.closest("#homeRosterFullButton");
  if (fullRosterButton) { event.preventDefault(); openPage("players"); return; }
  const pageButton = target.closest("[data-page]");
  if (pageButton) { event.preventDefault(); openPage(pageButton.dataset.page); }
}, true);
$("openCabinet")?.addEventListener("click", () => openPage("cabinet"));

function makeCareerId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 14);
}
function ensureCareerIdentity() {
  if (!state.coachName || !state.teamName) return;
  ensurePortraitAssignments();
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
function getPortrait(index) { const n=Math.max(1,Number(index)||1); return "/images/portretplayers/portret" + (((n - 1) % 150) + 1) + ".jpg"; }
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
  const seasonNumber=Number(state.seasonNumber)||1;
  const teamMatches=Object.values(state.leagueResults||{}).filter(match=>match&&(match.homeId===team.id||match.awayId===team.id));
  const currentMatches=teamMatches.filter(match=>Number(match.season||seasonNumber)===seasonNumber);
  const summarizeMatches=matches=>matches.reduce((acc,match)=>{
    const home=match.homeId===team.id;
    const forGoals=Number(home?match.homeScore:match.awayScore)||0;
    const againstGoals=Number(home?match.awayScore:match.homeScore)||0;
    acc.played++;acc.wins+=forGoals>againstGoals?1:0;acc.draws+=forGoals===againstGoals?1:0;acc.losses+=forGoals<againstGoals?1:0;
    acc.gf+=forGoals;acc.ga+=againstGoals;acc.points+=forGoals>againstGoals?3:forGoals===againstGoals?1:0;
    return acc;
  },{played:0,wins:0,draws:0,losses:0,gf:0,ga:0,points:0});
  const careerTotals=summarizeMatches(teamMatches),seasonTotals=summarizeMatches(currentMatches);
  const leagueRank=(team.league&&typeof getStandingsForLeague==="function"?getStandingsForLeague(team.league,seasonNumber):[]).findIndex(row=>row.team.id===team.id)+1;
  const grid=document.createElement("div");grid.className="cabinet-metrics coach-profile-metrics";
  const metrics=[
    ["Команда",team.name],
    ["Лига",team.league||"—"],
    ["Футболистов",String((team.players||[]).length)+" / 10"],
    ["Сезон","Сезон "+seasonNumber],
    ["Матчи в сезоне",String(seasonTotals.played)],
    ["Победы / ничьи / поражения",seasonTotals.wins+" / "+seasonTotals.draws+" / "+seasonTotals.losses],
    ["Забито / пропущено",seasonTotals.gf+" / "+seasonTotals.ga],
    ["Очки тренера в лиге",String(seasonTotals.points)],
    ["Место в лиге",leagueRank>0?String(leagueRank):"—"],
    ["Матчи за всю карьеру",String(careerTotals.played)],
    ["Победы / ничьи / поражения за карьеру",careerTotals.wins+" / "+careerTotals.draws+" / "+careerTotals.losses],
    ["Забито / пропущено за карьеру",careerTotals.gf+" / "+careerTotals.ga],
    ["Опыт тренера",isUserTeam?(state.xp||0)+" XP":"—"],
    ["Постоянный рейтинг",isUserTeam?String(state.permanentRating||0):"—"]
  ];
  metrics.forEach(([label,value])=>{const card=document.createElement("div");card.className="cabinet-metric";card.append(safeText("small",label),safeText("b",String(value)));grid.append(card);});
  const note=safeText("p","Результаты берутся из сохранённых официальных матчей, включая симуляции тура. История доступна в текущем сохранении игры; отдельный серверный архив карьеры пока не подключён.","muted");
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
const LEAGUE_MATCH_DAYS = {
 "Верхняя лига":[3,6,13,21,29,37,43,47,51,56,80,91,103,108,116,125,131,137,142,148],
 "Нижняя лига":[5,11,15,20,26,32,35,41,46,52,82,88,96,101,109,112,118,123,129,136]
};
const CUP_QUARTERFINAL_DAYS=[61,62,64,65];
const CUP_SEMIFINAL_DAYS=[68,70];
const CUP_FINAL_DAY=75;
const CUP_FRIENDLY_DAYS=[66,72];
const END_SEASON_FRIENDLIES={153:["Нижняя лига","Верхняя лига"],160:["Нижняя лига","Нижняя лига"],166:["Верхняя лига","Нижняя лига"],172:["Верхняя лига","Верхняя лига"],178:["Нижняя лига","Верхняя лига"]};
function currentCoachLeague(){return getUserTeam()?.league||state.selectedLeague||"Нижняя лига"}
function officialRoundDay(round,leagueName=currentCoachLeague()){return (LEAGUE_MATCH_DAYS[leagueName]||LEAGUE_MATCH_DAYS["Нижняя лига"])[Number(round)-1]||0}
function officialRoundForDay(day,leagueName=currentCoachLeague()){const index=(LEAGUE_MATCH_DAYS[leagueName]||LEAGUE_MATCH_DAYS["Нижняя лига"]).indexOf(Number(day));return index<0?0:index+1}
function officialMatchKey(round,home,away){const leagueName=home?.league||away?.league||currentCoachLeague();return String(state.seasonNumber||1)+"-"+String(leagueName).replace(/\s+/g,"-")+"-"+officialRoundDay(round,leagueName)+"-"+round+"-"+home.id+"-"+away.id}
function allCurrentLeagueTeams(leagueName=currentCoachLeague()){return (leagueData?.teams||[]).filter(t=>t.league===leagueName).map(t=>t.isUserTeam?getUserTeam():t).filter(Boolean)}
function ensureLeagueMembershipSnapshot(season=Number(state.seasonNumber)||1){
 if(!leagueData?.teams?.length||!state.coachName||!state.teamName)return;
 state.leagueMembershipHistory=state.leagueMembershipHistory&&typeof state.leagueMembershipHistory==="object"?state.leagueMembershipHistory:{};
 const key=String(Number(season)||1);if(state.leagueMembershipHistory[key])return;
 const membership={};leagueData.teams.forEach(team=>{if(team.league==="Верхняя лига"||team.league==="Нижняя лига")membership[team.id]=team.league});
 state.leagueMembershipHistory[key]=membership;
}
function applySavedLeagueStructure(){
 if(!leagueData?.teams)return;
 state.leagueMembership=state.leagueMembership&&typeof state.leagueMembership==="object"?state.leagueMembership:{};
 state.generatedLeagueTeams=Array.isArray(state.generatedLeagueTeams)?state.generatedLeagueTeams:[];
 state.generatedLeagueTeams.forEach(saved=>{
  if(!saved?.id||leagueData.teams.some(team=>team.id===saved.id))return;
  leagueData.teams.push({...saved,players:Array.isArray(saved.players)?saved.players:[]});
 });
 leagueData.teams.forEach(team=>{
  const membership=state.leagueMembership[team.id];if(membership)team.league=membership;
  if(team.isUserTeam&&Array.isArray(state.userRoster))team.players=state.userRoster;
  else if(Array.isArray(state.externalRosters?.[team.id]))team.players=state.externalRosters[team.id];
 });
 const own=leagueData.teams.find(team=>team.isUserTeam||team.name==="{teamName}");
 if(own&&(own.league==="Верхняя лига"||own.league==="Нижняя лига"))state.selectedLeague=own.league;
}
function transitionTeamPower(team){
 const players=Array.isArray(team?.players)?team.players:[];if(!players.length)return 0;
 return players.reduce((sum,player)=>sum+Math.max(Number(player.skills?.ВР)||0,Number(player.skills?.ЗЩ)||0,Number(player.skills?.ПЗ)||0,Number(player.skills?.НП)||0),0)/players.length;
}
function transitionRandom(seed){
 let h=2166136261;for(const ch of String(seed))h=Math.imul(h^ch.charCodeAt(0),16777619);
 return ()=>{h+=0x6D2B79F5;let t=h;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296};
}
function playPromotionPlayoff(first,second,season){
 const rand=transitionRandom("promotion-playoff:"+season+":"+first.team.id+":"+second.team.id);
 const powerA=transitionTeamPower(first.team),powerB=transitionTeamPower(second.team);
 const scoreA=Math.max(0,Math.min(5,Math.floor(rand()*3+Math.max(0,(powerA-powerB)/35))));
 const scoreB=Math.max(0,Math.min(5,Math.floor(rand()*3+Math.max(0,(powerB-powerA)/35))));
 const winner=scoreA===scoreB?(rand()<powerA/Math.max(1,powerA+powerB)?first.team:second.team):(scoreA>scoreB?first.team:second.team);
 return {season,day:182,type:"promotion-playoff",homeId:first.team.id,homeName:first.team.name,awayId:second.team.id,awayName:second.team.name,homeScore:scoreA,awayScore:scoreB,penalties:scoreA===scoreB,penaltyWinnerId:scoreA===scoreB?winner.id:null,winnerId:winner.id,winnerName:winner.name,loserId:winner.id===first.team.id?second.team.id:first.team.id,loserName:winner.id===first.team.id?second.team.name:first.team.name};
}
function createReplacementLeagueTeam(season,slot){
 state.leagueReserveTeams=Array.isArray(state.leagueReserveTeams)?state.leagueReserveTeams:[];
 state.generatedLeagueTeams=Array.isArray(state.generatedLeagueTeams)?state.generatedLeagueTeams:[];
 let reserve=state.leagueReserveTeams.shift();
 while(reserve&&(!Array.isArray(reserve.players)||reserve.players.length===0))reserve=state.leagueReserveTeams.shift();
 const id="new-lower-"+season+"-"+slot;
 let team;
 if(reserve){team={...reserve,id,league:"Нижняя лига",players:reserve.players.map(player=>({...player}))};}
 else{
  const roles=["ВР","ВР","ЗЩ","ЗЩ","ЗЩ","ПЗ","ПЗ","ПЗ","НП","НП"];
  const rand=transitionRandom("replacement-roster:"+season+":"+slot);
  const players=roles.map((position,index)=>{const skill=()=>15+Math.floor(rand()*26);return {careerId:makeCareerId(),playerId:"generated-"+season+"-"+slot+"-"+index,name:"Новичок двора "+season+"-"+slot+"-"+(index+1),position,nationality:"Россия",age:14+Math.floor(rand()*7),portraitIndex:1+Math.floor(rand()*150),skills:{ВР:skill(),ЗЩ:skill(),ПЗ:skill(),НП:skill()}}});
  team={id,name:"НОВЫЙ ДВОР "+season+"-"+slot,coach:"Местный тренер",league:"Нижняя лига",players};
 }
 team.id=id;team.league="Нижняя лига";team.isUserTeam=false;
 state.generatedLeagueTeams.push({...team,players:team.players.map(player=>({...player,skills:{...(player.skills||{})}}))});
 leagueData.teams.push(team);state.leagueMembership=state.leagueMembership||{};state.leagueMembership[id]="Нижняя лига";
 return team;
}
function completeSeasonLeagueTransitions(season){
 state.leagueTransitions=state.leagueTransitions&&typeof state.leagueTransitions==="object"?state.leagueTransitions:{};
 const existing=state.leagueTransitions[String(season)];if(existing?.completed)return existing.summary||"Переходы между лигами уже рассчитаны.";
 ensureLeagueMembershipSnapshot(season);
 const upper=getStandingsForLeague("Верхняя лига",season),lower=getStandingsForLeague("Нижняя лига",season);
 if(upper.length<2||lower.length<3)return "Не удалось рассчитать переходы: в одной из лиг недостаточно команд.";
 const promoted=[lower[0].team];
 let playoff=existing?.playoff?.winnerId?existing.playoff:null;
 if(!playoff&&[lower[1].team.id,lower[2].team.id].includes(getUserTeam()?.id)){
  queuePlayableSpecialMatch("playoff",{season,day:182,stage:"promotion-playoff",matchIndex:0,key:"promotion-playoff:"+season,title:"Стыковой матч за выход в верхнюю лигу",transitionSeason:season},lower[1].team,lower[2].team);
  state.leagueTransitions[String(season)]={...(existing||{}),pending:true,season};
  saveState();return null;
 }
 if(!playoff)playoff=playPromotionPlayoff(lower[1],lower[2],season);
 const playoffWinner=leagueData.teams.find(team=>team.id===playoff.winnerId);
 if(playoffWinner)promoted.push(playoffWinner);
 const relegated=upper.slice(-2).map(row=>row.team);
 const userId=getUserTeam()?.id;
 const lowerDepartures=lower.slice().reverse().filter(row=>row.team.id!==userId).slice(0,2).map(row=>row.team);
 const reserveNames=[];
 promoted.forEach(team=>team.league="Верхняя лига");
 relegated.forEach(team=>team.league="Нижняя лига");
 lowerDepartures.forEach(team=>{team.league="Выбывшие команды";state.retiredLeagueTeamIds=Array.isArray(state.retiredLeagueTeamIds)?state.retiredLeagueTeamIds:[];if(!state.retiredLeagueTeamIds.includes(team.id))state.retiredLeagueTeamIds.push(team.id)});
 for(let i=0;i<lowerDepartures.length;i++){const replacement=createReplacementLeagueTeam(season,i+1);reserveNames.push(replacement.name)}
 state.leagueMembership=state.leagueMembership&&typeof state.leagueMembership==="object"?state.leagueMembership:{};
 leagueData.teams.forEach(team=>{state.leagueMembership[team.id]=team.league});
 const own=getUserTeam();if(own)state.selectedLeague=own.league;
 const summary="Повышение: "+promoted.map(team=>team.name).join(", ")+". Стыковой матч: "+playoff.homeName+" "+playoff.homeScore+":"+playoff.awayScore+" "+playoff.awayName+(playoff.penalties?" (победа по пенальти)":"")+". Понижение: "+relegated.map(team=>team.name).join(", ")+". Выбыли из нижней лиги: "+lowerDepartures.map(team=>team.name).join(", ")+". Новые команды: "+reserveNames.join(", ")+".";
 state.leagueTransitions[String(season)]={completed:true,season,playoff,promotedIds:promoted.map(team=>team.id),relegatedIds:relegated.map(team=>team.id),departedIds:lowerDepartures.map(team=>team.id),replacementNames:reserveNames,summary,completedAt:Date.now()};
 saveState();return summary;
}
function getOfficialRoundFixtures(round,leagueName=currentCoachLeague()){
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
 const leagueName=currentCoachLeague(),round=officialRoundForDay(Number(state.gameDay)||1,leagueName);if(!round)return null;
 return getOfficialRoundFixtures(round,leagueName).find(f=>f.home.isUserTeam||f.away.isUserTeam)||null;
}
function getTeamForMatch(id){const t=leagueData?.teams.find(x=>x.id===id);return t?.isUserTeam?getUserTeam():t||null}
function matchPlayerScore(p,role){const s=p?.skills||{};const v=Number(s[role]||0);return Number.isFinite(v)?v:25}
function conditionPlayerKey(player){return String(player?.careerId||player?.id||player?.name||"unknown-player")}
function getPlayerCondition(player){state.playerConditions=state.playerConditions||{};const key=conditionPlayerKey(player);if(!Number.isFinite(Number(state.playerConditions[key])))state.playerConditions[key]=Number.isFinite(Number(player?.condition))?Math.max(0,Math.min(100,Number(player.condition))):100;return Math.max(0,Math.min(100,Number(state.playerConditions[key])||0))}
function setPlayerCondition(player,value){state.playerConditions=state.playerConditions||{};state.playerConditions[conditionPlayerKey(player)]=Math.max(0,Math.min(100,Math.round(Number(value)*100)/100))}
function matchConditionPenalty(player){return Math.floor((100-getPlayerCondition(player))/5)}
function matchEffectivePlayerScore(player,role){return Math.max(0,matchPlayerScore(player,role)-matchConditionPenalty(player))}
function applyMatchMinuteFatigue(session){["home","away"].forEach(side=>(session.lineups?.[side]||[]).filter(entry=>!entry.sentOff).forEach(entry=>{const player=entry.player||entry;const mainSkill=matchPlayerScore(player,player.position||entry.role);const loss=Math.max(0,4-mainSkill*.05);setPlayerCondition(player,getPlayerCondition(player)-loss)}))}
function recoverPlayerConditionForDay(){state.playerConditions=state.playerConditions||{};const seen=new Set(),all=[...(getUserTeam()?.players||[]),...(leagueData?.teams||[]).flatMap(team=>team.players||[])];all.forEach(player=>{const key=conditionPlayerKey(player);if(seen.has(key))return;seen.add(key);setPlayerCondition(player,getPlayerCondition(player)+11)})}
function buildOfficialLineup(team,formation,optimize=false){
 const roster=(team?.players||[]).filter(player=>!(team?.isUserTeam||team?.id===getUserTeam()?.id)||!isPlayerUnavailable(team,player)).slice();if(!roster.length)return [];
 const used=new Set(),take=(role)=>{let pool=roster.filter(x=>!used.has(x));pool.sort((a,b)=>{const sa=(optimize?matchEffectivePlayerScore(a,role):matchPlayerScore(a,role))+(a.position===role?3:0),sb=(optimize?matchEffectivePlayerScore(b,role):matchPlayerScore(b,role))+(b.position===role?3:0);return optimize?sb-sa:(Number(b.position===role)-Number(a.position===role))||(sb-sa)});const p=pool[0];if(p)used.add(p);return p};
 const keeper=take("ВР");const roles=MATCH_FORMATIONS[formation]||MATCH_FORMATIONS["2–2–1"];
 const lineup=[];if(keeper)lineup.push({player:keeper,role:"ВР",sentOff:false});
 roles.forEach(role=>{const player=take(role);if(player)lineup.push({player,role,sentOff:false})});
 return lineup;
}
function chooseNpcFormation(team){let best={formation:"2–2–1",lineup:[],score:-Infinity};Object.keys(MATCH_FORMATIONS).forEach(formation=>{const lineup=buildOfficialLineup(team,formation,true);const score=lineup.reduce((sum,entry)=>sum+matchEffectivePlayerScore(entry.player,entry.role)+(entry.player.position===entry.role?2:0),0);if(lineup.length>best.lineup.length||lineup.length===best.lineup.length&&score>best.score)best={formation,lineup,score}});return best}
function roundFixtureKey(round,fixture){return officialMatchKey(round,fixture.home,fixture.away)}
function scoreRandomTeam(team){
 const roster=(team?.players||[]).filter(player=>!(team?.isUserTeam||team?.id===getUserTeam()?.id)||!isPlayerUnavailable(team,player));const first=roster.find(p=>p.position==="ВР")||roster[0];
 const out=roster.filter(p=>p!==first).slice(0,5);
 const attack=out.reduce((n,p)=>n+matchPlayerScore(p,"НП")*.4+matchPlayerScore(p,"ПЗ")*.35+matchPlayerScore(p,"ЗЩ")*.15,0)/Math.max(1,out.length);
 const defence=out.reduce((n,p)=>n+matchPlayerScore(p,"ЗЩ")*.5+matchPlayerScore(p,"ПЗ")*.2,0)/Math.max(1,out.length);
 const base=1+Math.random()*2.5+(attack-defence)*.018;
 return Math.max(0,Math.min(7,Math.round(base+(Math.random()-.5)*2)));
}
function applySimulatedNpcSkillGrowth(team,teamScore,opponentScore,playerRatings){
 if(!scoutRulesEnabled()||!team||team.isUserTeam||team.name===state.teamName||!Array.isArray(team.players)||!team.players.length)return;
 const lineup=buildOfficialLineup(team,"2–2–1").map(entry=>entry.player||entry).filter(Boolean);
 if(!lineup.length)return;
 const grow=(player,reason)=>{
  if(!player)return;
  player.skills=player.skills||{};
  const keys=["ВР","ЗЩ","ПЗ","НП"],skill=keys[Math.floor(Math.random()*keys.length)];
  const before=Number(player.skills[skill]||0),after=Math.min(100,before+1);
  player.skills[skill]=after;
  if(skill===(player.position||"")&&after>before)processScoutAttributeIncrease(team,player,before,after);
 };
 if(Number(teamScore)>Number(opponentScore)){
  const pool=[...lineup];for(let i=0;i<3&&pool.length;i++)grow(pool.splice(Math.floor(Math.random()*pool.length),1)[0],"Победа команды");
 }else{
  const ratings=new Map((playerRatings||[]).filter(x=>x.played).map(x=>[x.playerName,Number(x.rating)||6]));
  const best=Math.max(...lineup.map(player=>ratings.get(player.name)||6));
  const pool=lineup.filter(player=>(ratings.get(player.name)||6)===best);
  grow(pool[Math.floor(Math.random()*pool.length)],Number(teamScore)===Number(opponentScore)?"Ничья":"Поражение");
 }
 persistScoutRoster(team);
}
function ensureRoundBackgroundResults(round,userFixture,userResult,leagueName=currentCoachLeague(),skipUserFixture=false){
 state.leagueResults=state.leagueResults||{};
 getOfficialRoundFixtures(round,leagueName).forEach(f=>{
  if(skipUserFixture&&(f.home.isUserTeam||f.away.isUserTeam))return;
  const key=roundFixtureKey(round,f);if(state.leagueResults[key])return;
  if(userFixture&&f.home.id===userFixture.home.id&&f.away.id===userFixture.away.id&&userResult){state.leagueResults[key]=userResult;return}
  const homeScore=scoreRandomTeam(f.home),awayScore=scoreRandomTeam(f.away),homeLineup=buildOfficialLineup(f.home,"2–2–1"),awayLineup=buildOfficialLineup(f.away,"2–2–1"),events=[];
  const addGoals=(side,team,lineup,count)=>{const forwards=lineup.filter(x=>x.role==="НП"||x.role==="ПЗ"),pool=forwards.length?forwards:lineup;for(let i=0;i<count;i++){const scorer=pool[Math.floor(Math.random()*pool.length)],helpers=lineup.filter(x=>x.player!==scorer?.player),helper=helpers.length?helpers[Math.floor(Math.random()*helpers.length)]:null;events.push({minute:Math.floor(Math.random()*20)+1,type:"goal",side,scorer:scorer?.player.name||"Игрок",assist:helper?.player.name||null,text:"Гол команды "+matchTeamLabel(team)+": "+(scorer?.player.name||"Игрок")+(helper?" (ассист: "+helper.player.name+")":"")})}};
  addGoals("home",f.home,homeLineup,homeScore);addGoals("away",f.away,awayLineup,awayScore);
  const playerRatings=["home","away"].flatMap(side=>(side==="home"?homeLineup:awayLineup).map(entry=>{const p=entry.player||entry,goals=events.filter(ev=>ev.type==="goal"&&ev.side===side&&ev.scorer===p.name).length,assists=events.filter(ev=>ev.type==="goal"&&ev.side===side&&ev.assist===p.name).length;return {playerName:p.name,side,played:true,goals,assists,rating:Math.min(10,6+goals+assists)}}));state.leagueResults[key]={season:Number(state.seasonNumber)||1,round,day:officialRoundDay(round,leagueName),homeId:f.home.id,awayId:f.away.id,homeScore,awayScore,homeLineup,awayLineup,events,playerRatings,simulated:true};
  if(scoutRulesEnabled()){
   const homeRatings=playerRatings.filter(x=>x.side==="home"),awayRatings=playerRatings.filter(x=>x.side==="away");
   applySimulatedNpcSkillGrowth(f.home,homeScore,awayScore,homeRatings);
   applySimulatedNpcSkillGrowth(f.away,awayScore,homeScore,awayRatings);
  }
 });
}
function ensureAllLeagueRoundResults(round,userFixture,userResult){ensureRoundBackgroundResults(round,userFixture,userResult,currentCoachLeague());}
function simulateScheduledLeagueResultsForDay(day){
 if(!leagueData)return;
 ["Нижняя лига","Верхняя лига"].forEach(leagueName=>{
  const round=officialRoundForDay(day,leagueName);
  if(round)ensureRoundBackgroundResults(round,null,null,leagueName,true);
 });
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
 const playerStats=[];
 const recordGoals=(team,goals)=>{
  const roster=Array.isArray(team?.players)?team.players:[];
  if(!roster.length)return;
  roster.forEach(player=>{const id=String(player.careerId||player.id||player.name);if(!playerStats.some(x=>x.teamId===team.id&&x.playerId===id))playerStats.push({teamId:team.id,teamName:matchTeamLabel(team),playerId:id,playerName:player.name,goals:0,assists:0,appearances:1})});
  for(let goal=0;goal<goals;goal++){
   const scorer=roster[Math.floor(rand()*roster.length)];
   const scorerId=String(scorer.careerId||scorer.id||scorer.name);
   let item=playerStats.find(x=>x.teamId===team.id&&x.playerId===scorerId);
   if(!item){item={teamId:team.id,teamName:matchTeamLabel(team),playerId:scorerId,playerName:scorer.name,goals:0,assists:0,appearances:1};playerStats.push(item)}
   item.goals++;
   if(rand()<0.62&&roster.length>1){
    const helpers=roster.filter(p=>p!==scorer);
    const helper=helpers[Math.floor(rand()*helpers.length)];
    const helperId=String(helper.careerId||helper.id||helper.name);
    let assist=playerStats.find(x=>x.teamId===team.id&&x.playerId===helperId);
    if(!assist){assist={teamId:team.id,teamName:matchTeamLabel(team),playerId:helperId,playerName:helper.name,goals:0,assists:0,appearances:1};playerStats.push(assist)}
    assist.assists++;
   }
  }
 };
 recordGoals(home,homeScore);recordGoals(away,awayScore);
 return {season,stage,homeId:home.id,awayId:away.id,homeName:matchTeamLabel(home),awayName:matchTeamLabel(away),homeScore,awayScore,extraTime,penalties,winnerId:winner.id,winnerName:matchTeamLabel(winner),day:Number(state.gameDay)||1,playerStats};
}
function cupBracketTeam(id){return (leagueData?.teams||[]).find(t=>t.id===id)||null}
function queuePlayableSpecialMatch(type,details,home,away){
 const ownId=getUserTeam()?.id;if(!home||!away||!ownId||![home.id,away.id].includes(ownId))return false;
 const existing=state.pendingSpecialMatch;
 if(existing&&!state.officialMatchSession)return existing.homeId===home.id&&existing.awayId===away.id;
 state.pendingSpecialMatch={type,season:Number(details.season)||Number(state.seasonNumber)||1,day:Number(details.day)||Number(state.gameDay)||1,homeId:home.id,awayId:away.id,stage:details.stage||null,matchIndex:Number(details.matchIndex)||0,key:details.key||"",title:details.title||"Матч",transitionSeason:details.transitionSeason||null};
 publishCoachEventOnce("playable-special:"+state.pendingSpecialMatch.season+":"+type+":"+state.pendingSpecialMatch.key,"news","Время играть: "+state.pendingSpecialMatch.title,matchTeamLabel(getUserTeam())+" предстоит сыграть матч самостоятельно. Открой страницу «Матч», чтобы выбрать состав и провести встречу.",{priority:"high",important:true});
 saveState();return true;
}
function resolveSpecialMatchWinner(home,away,homeScore,awayScore,seed){
 if(homeScore!==awayScore)return homeScore>awayScore?home:away;
 const rand=seededCupRandom("penalties:"+seed+":"+home.id+":"+away.id),powerH=cupTeamPower(home),powerA=cupTeamPower(away);
 let h=0,a=0;for(let i=0;i<5;i++){if(rand()<Math.min(.9,.55+(powerH-powerA)/200))h++;if(rand()<Math.min(.9,.55+(powerA-powerH)/200))a++}
 while(h===a){if(rand()<.5)h++;else a++}
 return h>a?home:away;
}
function simulateCupFriendlyRound(season,stage,excluded){
 state.cupFriendlyResults=Array.isArray(state.cupFriendlyResults)?state.cupFriendlyResults:[];
 for(let i=0;i<excluded.length;i+=2){const home=excluded[i],away=excluded[i+1];if(!home||!away)continue;const key=season+":"+stage+":"+home.id+":"+away.id;if(state.cupFriendlyResults.some(x=>x.key===key))continue;if(queuePlayableSpecialMatch("cup-friendly",{season,day:Number(state.gameDay)||1,stage,key,title:"Товарищеский матч перед кубковым этапом"},home,away))continue;const rand=seededCupRandom("friendly:"+key);state.cupFriendlyResults.push({key,season,stage,day:Number(state.gameDay)||1,homeId:home.id,awayId:away.id,homeName:matchTeamLabel(home),awayName:matchTeamLabel(away),homeScore:Math.floor(rand()*4),awayScore:Math.floor(rand()*4),friendly:true,matchType:"cup-friendly"})}
}
function announceCupDraw(season){
 state.cupDraws=state.cupDraws&&typeof state.cupDraws==="object"?state.cupDraws:{};
 if(state.cupDraws[season])return;
 const draw=getSeasonCupTeams(season),own=getUserTeam(),selected=draw.entrants.some(t=>t.id===own?.id);
 state.cupDraws[season]={entrants:draw.entrants.map(t=>t.id),excluded:draw.excluded.map(t=>t.id),selected};
 const names=draw.entrants.map(t=>matchTeamLabel(t)).join(", ");
 const message="Уважаемые коллеги! Сегодня по утверждённому календарю определены участники кубка «ДОСТАТОК» сезона "+season+". "+(selected?"Ваша команда участвует в розыгрыше.":"Ваша команда в этом сезоне не попала в заявку и сыграет товарищеские матчи с другими командами, не прошедшими отбор.")+" Участники: "+names+". Четвертьфиналы — дни 61, 62, 64 и 65; полуфиналы — дни 68 и 70; финал — день 75.";
 publishCoachEventOnce("cup-draw:"+season,"news","Жеребьёвка кубка «ДОСТАТОК»",message,{priority:"high",important:true});
 saveState();
}
function runCupRound(stage,matchIndex=0){
 const season=Number(state.seasonNumber)||1;state.cupResults=state.cupResults&&typeof state.cupResults==="object"?state.cupResults:{};
 const cup=state.cupResults[season]||(state.cupResults[season]={matches:[],championId:null,championName:null});
 if(cup.matches.some(x=>x.stage===stage&&(x.bracketIndex==null||Number(x.bracketIndex||0)===Number(matchIndex))))return;
 const draw=getSeasonCupTeams(season),entrants=draw.entrants;
 let pair=null;
 if(stage==="quarterfinals"){
  pair=[entrants[matchIndex],entrants[7-matchIndex]];
 }else{
  const prior=stage==="semifinals"?"quarterfinals":"semifinals";
  const prev=cup.matches.filter(x=>x.stage===prior).sort((a,b)=>Number(a.bracketIndex||0)-Number(b.bracketIndex||0));
  const winners=prev.map(x=>cupBracketTeam(x.winnerId)).filter(Boolean);
  pair=stage==="semifinals"?[winners[matchIndex*2],winners[matchIndex*2+1]]:[winners[0],winners[1]];
 }
 if(!pair?.[0]||!pair?.[1]){console.warn("Не удалось сформировать матч кубка",stage,matchIndex);return}
 if(queuePlayableSpecialMatch("cup",{season,day:Number(state.gameDay)||1,stage,matchIndex,key:stage+":"+matchIndex,title:"Кубок «ДОСТАТОК» — "+(stage==="quarterfinals"?"четвертьфинал":stage==="semifinals"?"полуфинал":"финал")},pair[0],pair[1]))return;
 const match=simulateCupFixture(season,stage,pair[0],pair[1],matchIndex);match.bracketIndex=matchIndex;
 cup.matches.push(match);
 const stageName=stage==="quarterfinals"?"Четвертьфинал":stage==="semifinals"?"Полуфинал":"Финал";
 const ownId=getUserTeam()?.id,ownMatch=match.homeId===ownId||match.awayId===ownId;
 if(ownMatch)publishCoachEventOnce("cup-result:"+season+":"+stage+":"+matchIndex+":"+ownId,"news","Кубок «ДОСТАТОК»: "+stageName,match.homeName+" "+match.homeScore+":"+match.awayScore+" "+match.awayName+(match.extraTime?" (с учётом дополнительного времени)":"")+(match.penalties?"; пенальти "+match.penalties.home+":"+match.penalties.away:"")+".",{priority:"high",important:true});
 if(stage==="finals"){
  cup.championId=match.winnerId;cup.championName=match.winnerName;
  const winner=cupBracketTeam(match.winnerId),caption="КУБОК «ДОСТАТОК» · СЕЗОН "+season,score=match.homeName+" "+match.homeScore+":"+match.awayScore+" "+match.awayName+(match.extraTime?" · доп. время":"")+(match.penalties?" · пенальти "+match.penalties.home+":"+match.penalties.away:"");
  if(winner){
   addCareerAward({key:"cup-dostatoch:team:"+season,recipientType:"team",recipientId:winner.id,icon:"awardcupdostatok",label:"Кубок «Достаток»",caption,result:score,season});
   addCareerAward({key:"cup-dostatoch:coach:"+season,recipientType:"coach",recipientId:winner.id,icon:"awardcupdostatok",label:"Кубок «Достаток»",caption,result:score,season});
   (winner.players||[]).forEach(p=>addCareerAward({key:"cup-dostatoch:player:"+season+":"+winner.id+":"+p.name,recipientType:"player",recipientId:winner.id,recipientName:p.name,icon:"awardcupdostatok",label:"Кубок «Достаток»",caption,result:score,season}));
  }
  publishCoachEventOnce("cup-champion:"+season,"news","Обладатель кубка «ДОСТАТОК»","Кубок «ДОСТАТОК» сезона "+season+" выиграла команда "+match.winnerName+". Финальный результат: "+score+". Награда закреплена в профилях команды, тренера и футболистов.",{priority:"high",important:true});
 }
 saveState();
}
function getStandingsForLeague(leagueName,season){
 const seasonKey=String(Number(season)||1),membership=state.leagueMembershipHistory?.[seasonKey];
 const source=membership?(leagueData?.teams||[]).filter(team=>membership[team.id]===leagueName).map(team=>team.isUserTeam?getUserTeam():team).filter(Boolean):allCurrentLeagueTeams(leagueName);
 const teams=source.map(team=>({team,played:0,w:0,d:0,l:0,gf:0,ga:0,pts:0})),byId=Object.fromEntries(teams.map(x=>[x.team.id,x]));
 Object.values(state.leagueResults||{}).filter(r=>Number(r.season||state.seasonNumber)===Number(season)&&isCanonicalLeagueResult(r,leagueName)).forEach(r=>{const h=byId[r.homeId],a=byId[r.awayId];if(!h||!a)return;h.played++;a.played++;h.gf+=Number(r.homeScore)||0;h.ga+=Number(r.awayScore)||0;a.gf+=Number(r.awayScore)||0;a.ga+=Number(r.homeScore)||0;if(r.homeScore>r.awayScore){h.w++;a.l++;h.pts+=3}else if(r.homeScore<r.awayScore){a.w++;h.l++;a.pts+=3}else{h.d++;a.d++;h.pts++;a.pts++}});
 return teams.sort((x,y)=>y.pts-x.pts||(y.gf-y.ga)-(x.gf-x.ga)||y.gf-x.gf||x.team.name.localeCompare(y.team.name,"ru"));
}
function finalizeSeasonCareerAwards(season){
 const key="career-season-awards:"+season;if(state.ratingAwardsApplied?.[key])return;
 const teams=leagueData?.teams||[];if(!teams.length)return;
 ["Верхняя лига","Нижняя лига"].forEach(league=>{
  const standings=getStandingsForLeague(league,season);
  standings.slice(0,3).forEach((row,i)=>{
   const rank=i+1,icon="award"+(league==="Верхняя лига"?"liga1":"liga2")+"medal"+rank,caption=rank+" место · "+league+" · сезон "+season;
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

function ensureCoachCommunicationState(){state.coachMail=Array.isArray(state.coachMail)?state.coachMail:[];state.coachChronicle=Array.isArray(state.coachChronicle)?state.coachChronicle:[];state.coachMailKeys=state.coachMailKeys&&typeof state.coachMailKeys==="object"?state.coachMailKeys:{};const season=Number(state.seasonNumber)||1,day=Number(state.gameDay)||1;state.coachMail.forEach(item=>{if(Number(item.season)!==season||item.popupSeen||item.popupRequested)return;if(item.responseType==="player_absence_request"&&!item.responseStatus||Number(item.day)===day&&!item.read){item.popupRequested=true;item.popupSeen=false}})}
function publishCoachEvent({key,type="news",title,message,priority="normal",day=state.gameDay,season=state.seasonNumber,important=false,responseType=null,playerKey=null,absenceStartAbsDay=null,absenceReturnAbsDay=null,actionPage=null,actionLabel=null,popup=false}){
 ensureCoachCommunicationState();if(!key)return false;if(state.coachMail.some(item=>item.key===key))return false;state.coachMailKeys[key]=true;
 const item={id:makeCareerId(),key,type,title,message,priority,important,season:Number(season)||1,day:Number(day)||1,at:Date.now(),read:false,archived:false,responseType,playerKey,absenceStartAbsDay,absenceReturnAbsDay,actionPage,actionLabel,popupRequested:Boolean(popup),popupSeen:false};
 state.coachMail.unshift(item);state.coachChronicle.unshift({...item});
 const normal=state.coachMail.filter(x=>!x.important);if(normal.length>50){const remove=new Set(normal.slice(50).map(x=>x.id));state.coachMail=state.coachMail.filter(x=>!remove.has(x.id))}
 state.coachChronicle=state.coachChronicle.slice(0,30);saveState();if(item.popupRequested)setTimeout(showNextGameEventPopup,80);return true
}
function publishCoachEventOnce(key,type,title,message,options={}){return publishCoachEvent({key,type,title,message,...options})}
let activeGameEventPopup=false;
function showNextGameEventPopup(){
 if(activeGameEventPopup||!state.coachName||!state.teamName||!document.body)return;
 ensureCoachCommunicationState();
 const item=state.coachMail.filter(x=>x.popupRequested&&!x.popupSeen).sort((a,b)=>(Number(a.season)-Number(b.season))||(Number(a.day)-Number(b.day))||(Number(a.at)-Number(b.at)))[0];
 if(!item)return;
 activeGameEventPopup=true;
 const overlay=document.createElement("div");overlay.id="gameEventPopupOverlay";overlay.setAttribute("role","presentation");
 Object.assign(overlay.style,{position:"fixed",inset:"0",zIndex:"10000",background:"rgba(0,10,7,.82)",display:"flex",alignItems:"center",justifyContent:"center",padding:"18px",backdropFilter:"blur(5px)"});
 const dialog=document.createElement("section");dialog.setAttribute("role","dialog");dialog.setAttribute("aria-modal","true");dialog.setAttribute("aria-labelledby","gameEventPopupTitle");
 Object.assign(dialog.style,{width:"min(620px,100%)",maxHeight:"min(82vh,760px)",overflowY:"auto",background:"linear-gradient(145deg,#0c3024,#041a13)",color:"#f1fff7",border:"1px solid #35d99a",borderRadius:"20px",padding:"clamp(20px,4vw,32px)",boxShadow:"0 24px 80px rgba(0,0,0,.55)",fontFamily:"inherit"});
 const eyebrow=document.createElement("p");eyebrow.textContent=item.responseType==="player_absence_request"?"⚽ ЛИЧНЫЙ РАЗГОВОР":"📣 СОБЫТИЕ ВО ДВОРЕ";Object.assign(eyebrow.style,{color:"#55e9b0",fontWeight:"800",letterSpacing:".12em",fontSize:"12px",margin:"0 0 12px"});
 const title=document.createElement("h2");title.id="gameEventPopupTitle";title.textContent=item.title;Object.assign(title.style,{fontSize:"clamp(21px,4vw,30px)",lineHeight:"1.15",margin:"0 0 12px"});
 const date=document.createElement("p");date.textContent="Сезон "+item.season+" · День "+item.day;Object.assign(date.style,{fontSize:"12px",color:"#a7d8c2",margin:"0 0 16px"});
 const message=document.createElement("p");message.textContent=item.message;Object.assign(message.style,{whiteSpace:"pre-line",lineHeight:"1.65",fontSize:"15px",margin:"0 0 24px"});
 const actions=document.createElement("div");Object.assign(actions.style,{display:"flex",flexWrap:"wrap",gap:"10px",justifyContent:"flex-end"});
 const closePopup=(markSeen=true)=>{if(markSeen){item.popupSeen=true;item.read=true;saveState()}overlay.remove();activeGameEventPopup=false;setTimeout(showNextGameEventPopup,250)};
 const button=(label,kind,handler)=>{const b=document.createElement("button");b.type="button";b.textContent=label;Object.assign(b.style,{border:kind==="primary"?"1px solid #55e9b0":"1px solid #4b8e73",borderRadius:"10px",padding:"12px 16px",fontWeight:"800",fontSize:"13px",cursor:"pointer",background:kind==="primary"?"#36d99a":"#0b3a2b",color:kind==="primary"?"#052217":"#f1fff7",minHeight:"42px"});b.addEventListener("click",handler);actions.append(b);return b};
 if(item.responseType==="player_absence_request"&&!item.responseStatus){
  button("РАЗРЕШИТЬ ПРОПУСТИТЬ МАТЧ","primary",()=>{closePopup();resolvePlayerMailRequest(item,"accept")});
  button("ОТКАЗАТЬ","secondary",()=>{closePopup();resolvePlayerMailRequest(item,"refuse")});
  button("ПРЕДЛОЖИТЬ КОМПРОМИСС","secondary",()=>{closePopup();resolvePlayerMailRequest(item,"compromise")});
 }else{
  if(item.actionPage)button(item.actionLabel||"ПЕРЕЙТИ К РАЗДЕЛУ","primary",()=>{closePopup();openPage(item.actionPage)});
  button("ПОНЯТНО","secondary",()=>closePopup());
  const x=document.createElement("button");x.type="button";x.textContent="×";x.setAttribute("aria-label","Закрыть событие");Object.assign(x.style,{position:"absolute",right:"14px",top:"12px",border:"0",background:"transparent",color:"#b9f5d8",fontSize:"26px",cursor:"pointer"});x.addEventListener("click",()=>closePopup());
  dialog.style.position="relative";dialog.append(x);
 }
 dialog.append(eyebrow,title,date,message,actions);overlay.append(dialog);
 if(item.responseType!=="player_absence_request")overlay.addEventListener("click",e=>{if(e.target===overlay)closePopup()});
 document.body.append(overlay);
 const first=actions.querySelector("button");if(first)first.focus({preventScroll:true});
}
const GAME_DAYS_PER_SEASON=182;
function absoluteGameDay(season=state.seasonNumber,day=state.gameDay){return (Math.max(1,Number(season)||1)-1)*GAME_DAYS_PER_SEASON+Math.max(1,Number(day)||1)}
function gameDateFromAbsolute(value){const absolute=Math.max(1,Math.floor(Number(value)||1));return {season:Math.floor((absolute-1)/GAME_DAYS_PER_SEASON)+1,day:((absolute-1)%GAME_DAYS_PER_SEASON)+1}}
function gameDateLabel(value){const d=gameDateFromAbsolute(value);return "сезон "+d.season+", день "+d.day}

// Правила скаутов версии 2.8.0 включаются только для новых карьер.
// Сохранения, созданные до версии 2.8.0, не мигрируются и не меняются.
const SCOUT_RULES_VERSION = "2.8.0";
const SCOUT_INTEREST_CHANCE = 0.20;
const SCOUT_IMMEDIATE_TRANSFER_CHANCE = 0.10;
const SCOUT_SECOND_LEAGUE_CLUBS = ["ФК «Восток»", "ФК «Смена»", "ФК «Маяк»", "ФК «Тайфун»"];
function scoutRulesEnabled(){return [SCOUT_RULES_VERSION, "2.8.1"].includes(state.careerRulesVersion)}
function scoutPlayerId(player){return String(player?.careerId||player?.id||player?.name||"unknown")}
function scoutTeamById(teamId){
 if(!leagueData?.teams)return null;
 const base=leagueData.teams.find(t=>String(t.id)===String(teamId));if(!base)return null;
 if(base.isUserTeam||base.name==="{teamName}")return typeof getUserTeam==="function"?getUserTeam():base;
 if(Array.isArray(state.externalRosters?.[base.id]))base.players=state.externalRosters[base.id];
 return base;
}
function persistScoutRoster(team){
 if(!team)return;
 const base=leagueData?.teams?.find(t=>String(t.id)===String(team.id));
 if(base&&(base.isUserTeam||base.name==="{teamName}")){state.userRoster=team.players;}
 else {state.externalRosters=state.externalRosters&&typeof state.externalRosters==="object"?state.externalRosters:{};state.externalRosters[team.id]=team.players;if(base)base.players=team.players;}
}
function scoutClubName(player,team){
 const seed=String(player?.careerId||player?.name||team?.id||"player");
 let hash=0;for(let i=0;i<seed.length;i++)hash=(hash*31+seed.charCodeAt(i))>>>0;
 return SCOUT_SECOND_LEAGUE_CLUBS[hash%SCOUT_SECOND_LEAGUE_CLUBS.length];
}
function removePlayerForProfessionalTransfer(team,player,club,reason,transferKey){
 if(!team||!player)return false;
 state.professionalTransfers=Array.isArray(state.professionalTransfers)?state.professionalTransfers:[];
 if(state.professionalTransfers.some(x=>x.key===transferKey))return false;
 const id=scoutPlayerId(player),index=(team.players||[]).findIndex(p=>scoutPlayerId(p)===id||p.name===player.name);
 if(index<0)return false;
 const [departed]=team.players.splice(index,1);
 departed.professionalClub=club;departed.professionalTransferSeason=Number(state.seasonNumber)||1;departed.professionalTransferDay=Number(state.gameDay)||1;
 persistScoutRoster(team);
 state.professionalTransfers.push({key:transferKey,playerId:id,playerName:departed.name,fromTeamId:team.id,fromTeamName:team.name,club,reason,season:Number(state.seasonNumber)||1,day:Number(state.gameDay)||1,absoluteDay:absoluteGameDay(),at:Date.now()});
 if(team.isUserTeam||team.name===state.teamName){
  publishCoachEventOnce("professional-transfer:"+transferKey,"player","Футболист покинул команду",departed.name+" перешёл в профессиональный клуб "+club+" (Вторая лига РФС). Основание: "+reason+".",{priority:"high",important:true,popup:true});
 }
 saveState();return true;
}
function scoutRelation(team,player){return Math.max(0,Math.min(100,Number(state.relationships?.[playerRelationKey(team,player)]||0)))}
function processScoutAttributeIncrease(team,player,beforeValue,afterValue){
 if(!scoutRulesEnabled()||!team||!player)return;
 state.scoutPlayerStates=state.scoutPlayerStates&&typeof state.scoutPlayerStates==="object"?state.scoutPlayerStates:{};
 state.pendingScoutDepartures=Array.isArray(state.pendingScoutDepartures)?state.pendingScoutDepartures:[];
 const playerId=scoutPlayerId(player),baseKey=String(team.id)+"::"+playerId;
 for(let value=Math.max(1,Math.floor(Number(beforeValue)||0)+1);value<=Math.min(100,Math.floor(Number(afterValue)||0));value++){
  if(value<50)continue;
  const club=scoutClubName(player,team),increaseKey=baseKey+"::"+value;
  // Separate 10% chance on every increase of the main position attribute from 50 onward.
  if(Math.random()<SCOUT_IMMEDIATE_TRANSFER_CHANCE){
   const left=removePlayerForProfessionalTransfer(team,player,club,"немедленный переход после повышения главной характеристики до "+value,increaseKey+"::immediate");
   if(left)return;
  }
  if(value>=50&&value<=59&&Math.random()<SCOUT_INTEREST_CHANCE){
   const noticeKey="scout-interest:"+increaseKey;
   if(team.isUserTeam||team.name===state.teamName)publishCoachEventOnce(noticeKey,"player","Скауты заинтересовались футболистом", "Скауты клуба "+club+" (Вторая лига РФС) обратили внимание на "+player.name+". Главный показатель амплуа достиг "+value+".",{priority:"high",important:true,popup:true,actionPage:"players",actionLabel:"Посмотреть футболиста"});
   state.scoutPlayerStates[baseKey]=state.scoutPlayerStates[baseKey]||{};
   state.scoutPlayerStates[baseKey].lastInterestAt=value;
  }
  if(value>=60&&value<=69){
   const negotiationKey="negotiation:"+baseKey;
   if(!state.scoutPlayerStates[baseKey]?.negotiationResolved){
    state.scoutPlayerStates[baseKey]=state.scoutPlayerStates[baseKey]||{};
    state.scoutPlayerStates[baseKey].negotiationResolved=true;
    const relation=scoutRelation(team,player);
    if(team.isUserTeam||team.name===state.teamName)publishCoachEventOnce("scout-negotiation:"+negotiationKey,"player","Скауты начали переговоры", "Скауты клуба "+club+" (Вторая лига РФС) ведут переговоры о переходе "+player.name+". Отношения с футболистом: "+relation.toLocaleString("ru-RU",{maximumFractionDigits:2})+"%. "+(relation<50?"При отношениях ниже 50% футболист может уйти с вероятностью 50%.":"При отношениях 50% и выше футболист гарантированно остаётся на этом этапе."),{priority:"high",important:true,popup:true,actionPage:"players",actionLabel:"Посмотреть отношения"});
    if(relation<50&&Math.random()<0.5){removePlayerForProfessionalTransfer(team,player,club,"исход переговоров при отношениях ниже 50%",negotiationKey+"::leave");return;}
   }
  }
  if(value>=70&&value<=80){
   const pending=state.pendingScoutDepartures.find(x=>x.key===baseKey);
   if(!pending){
    const dueAbsoluteDay=absoluteGameDay()+7;
    state.pendingScoutDepartures.push({key:baseKey,teamId:team.id,playerId,playerName:player.name,club,createdAbsoluteDay:absoluteGameDay(),dueAbsoluteDay,createdSeason:Number(state.seasonNumber)||1,createdDay:Number(state.gameDay)||1,notified:Boolean(team.isUserTeam||team.name===state.teamName)});
    if(team.isUserTeam||team.name===state.teamName)publishCoachEventOnce("scout-departure-warning:"+baseKey,"player","Предложение из Второй лиги РФС",player.name+" сообщил, что хочет развиваться дальше и получил предложение от клуба "+club+". Через 7 игровых дней он покинет команду. У тебя есть время найти замену.",{priority:"high",important:true,popup:true,actionPage:"freeyard",actionLabel:"Найти замену"});
   }
  }
 }
 saveState();
}
function processPendingScoutDepartures(){
 if(!scoutRulesEnabled()||!Array.isArray(state.pendingScoutDepartures)||!state.pendingScoutDepartures.length)return;
 const today=absoluteGameDay(),remaining=[];
 state.pendingScoutDepartures.forEach(item=>{
  if(Number(item.dueAbsoluteDay)>today){remaining.push(item);return;}
  let team=scoutTeamById(item.teamId),player=team?.players?.find(p=>scoutPlayerId(p)===String(item.playerId)||p.name===item.playerName);
  // Если футболиста обменяли до истечения срока, предложение следует за футболистом, а не за прежней командой.
  if(!player&&leagueData?.teams){
   for(const base of leagueData.teams){const candidate=scoutTeamById(base.id);const found=candidate?.players?.find(p=>scoutPlayerId(p)===String(item.playerId)||p.name===item.playerName);if(found){team=candidate;player=found;break;}}
  }
  if(player)removePlayerForProfessionalTransfer(team,player,item.club,"истёк семидневный срок после сообщения о предложении",item.key+"::deadline");
 });
 state.pendingScoutDepartures=remaining;saveState();
}
function getPlayerAbsenceKey(team,player){return playerRelationKey(team,player)}
function isPlayerUnavailable(team,player,absoluteDay=absoluteGameDay()){const record=state.playerAbsences?.[getPlayerAbsenceKey(team,player)];return Boolean(record&&Number(absoluteDay)>=Number(record.startAbsDay)&&Number(absoluteDay)<Number(record.returnAbsDay))}
function setPlayerAbsence(team,player,startAbsDay,returnAbsDay,reason){state.playerAbsences=state.playerAbsences&&typeof state.playerAbsences==="object"?state.playerAbsences:{};const key=getPlayerAbsenceKey(team,player);const existing=state.playerAbsences[key];let start=Number(startAbsDay),end=Number(returnAbsDay);if(existing&&Number(existing.returnAbsDay)>start){start=Math.min(start,Number(existing.startAbsDay)||start);end=Math.max(end,Number(existing.returnAbsDay)||end)}state.playerAbsences[key]={playerName:player.name,startAbsDay:start,returnAbsDay:end,reason:reason||"Временно недоступен"};saveState();return state.playerAbsences[key]}
function nextOfficialMatchDay(afterDay=state.gameDay){const days=LEAGUE_MATCH_DAYS[currentCoachLeague()]||LEAGUE_MATCH_DAYS["Нижняя лига"];return days.find(day=>Number(day)>Number(afterDay))||null}
function publishScheduledInfoMail(day){
 const season=Number(state.seasonNumber)||1;
 if(day===1&&season===1)publishCoachEventOnce("developer-welcome","news","Добро пожаловать во двор!","Привет, тренер! Это твоя команда и твой двор. Познакомься с ребятами, найди подход к каждому и докажи, что даже с обычной площадки начинается большой футбольный путь.",{priority:"high",important:true,day:1,season:1,actionPage:"players",actionLabel:"Познакомиться с командой",popup:true});
 if(day===2)publishCoachEventOnce("league-welcome:"+season,"news","Скоро стартует первый тур!","Уважаемый тренер! Совсем скоро стартует новый сезон лиги. Впереди серьёзные соперники, борьба за место в таблице и возможность показать характер команды. Желаем успешного выступления!",{priority:"normal",day:2,season,actionPage:"league",actionLabel:"Посмотреть календарь",popup:true});
 if(day===12)publishCoachEventOnce("scout-general:"+season,"news","Поиск молодых футбольных талантов","Скаутская служба ФК «Динамо-Владивосток» обращает внимание на вашу команду. Возможно, среди футболистов есть молодой игрок с хорошим потенциалом, которому стоит дать шанс проявить себя. Будем рады сотрудничеству.",{priority:"high",important:true,day:12,season,actionPage:"players",actionLabel:"Посмотреть футболистов",popup:true});
 if(day===48)publishCoachEventOnce("cup-notice:"+season,"news","Скоро начнётся кубок «Достаток»","Первые матчи кубка «Достаток» запланированы на 61-й игровой день. Следите за календарём и готовьтесь к предстоящему этапу!",{priority:"normal",day:48,season,actionPage:"cup",actionLabel:"Посмотреть кубок «Достаток»",popup:true});
}
function publishScheduledPlayerRequest(day,scheduledSeason=state.seasonNumber){
 const team=getUserTeam();if(!team||!Array.isArray(team.players)||!team.players.length)return false;
 const playerIndex=(((Math.max(1,Number(scheduledSeason)||1)-1)*2)+(day===4?0:1))%team.players.length;const player=team.players[playerIndex]||team.players[0];if(!player)return false;
 const matchDay=(LEAGUE_MATCH_DAYS[currentCoachLeague()]||LEAGUE_MATCH_DAYS["Нижняя лига"]).find(value=>Number(value)>Number(day));if(!matchDay)return false;const start=absoluteGameDay(scheduledSeason,matchDay),end=absoluteGameDay(scheduledSeason,matchDay+1);
 const topic=day===4?"Личные проблемы перед ближайшим матчем":"Можно ли пропустить ближайший матч?";
 const message=day===4?"Привет, тренер. В последнее время у меня непростой период в личной жизни, и мне сложно сосредоточиться на футболе. Можно мне пропустить ближайший матч? Мне нужно немного времени, чтобы прийти в себя.\n\nЕсли ты согласишься, я буду недоступен на "+gameDateLabel(start)+" и вернусь в "+gameDateLabel(end)+". Буду ждать твоего ответа.":"Привет, тренер! Сейчас я активно готовлюсь к экзаменам, и учёба отнимает почти всё свободное время. Можно мне пропустить ближайший матч, чтобы спокойно подготовиться?\n\nЕсли ты согласишься, я буду недоступен на "+gameDateLabel(start)+" и вернусь в "+gameDateLabel(end)+". Спасибо за понимание!";
 return publishCoachEventOnce("player-request:"+scheduledSeason+":"+day,"player",topic,player.name+": "+message,{priority:"high",important:true,day,season:scheduledSeason,responseType:"player_absence_request",playerKey:getPlayerAbsenceKey(team,player),absenceStartAbsDay:start,absenceReturnAbsDay:end,popup:true});
}
function deliverScheduledCoachMail(day=state.gameDay){ensureCoachCommunicationState();const currentDay=Math.max(1,Number(day)||1),season=Number(state.seasonNumber)||1;for(let scheduledDay=1;scheduledDay<=Math.min(currentDay,182);scheduledDay++){if([1,2,12,48].includes(scheduledDay))publishScheduledInfoMail(scheduledDay);else if([4,19].includes(scheduledDay))publishScheduledPlayerRequest(scheduledDay,season)}}
function resolvePlayerMailRequest(item,decision){
 if(!item||item.responseType!=="player_absence_request"||item.responseStatus)return;
 const team=getUserTeam(),player=team?.players?.find(p=>getPlayerAbsenceKey(team,p)===item.playerKey);
 if(!team||!player){item.responseStatus="failed";item.responseLabel="Футболист больше не найден в составе.";saveState();return}
 state.relationships=state.relationships&&typeof state.relationships==="object"?state.relationships:{};
 const relationKey=playerRelationKey(team,player),current=getPlayerRelation(team,player),now=absoluteGameDay();
 if(decision==="accept"){
  awardTrainerXp(150);state.relationships[relationKey]=Math.min(100,current+10);
  if(Number(item.absenceStartAbsDay)>=now)setPlayerAbsence(team,player,Number(item.absenceStartAbsDay),Number(item.absenceReturnAbsDay),"Тренер разрешил пропустить ближайший матч");
  item.responseLabel="Запрос принят: +150 XP и +10 п. п. отношений."+(Number(item.absenceStartAbsDay)>=now?" Футболисту разрешено пропустить матч с момента ответа.":" Дата матча уже прошла — решение не применяется задним числом.");
 }else{
  state.relationships[relationKey]=Math.max(0,current-15);item.responseLabel=decision==="compromise"?"Компромисс засчитан как отказ: 0 XP, −15 п. п. отношений.":"Отказ: 0 XP, −15 п. п. отношений.";
  if(Math.random()<0.5){
   const existing=state.playerAbsences?.[item.playerKey],activeOrFuture=existing&&Number(existing.returnAbsDay)>now;
   const start=activeOrFuture?Math.min(now,Number(existing.startAbsDay)||now):now,baseEnd=activeOrFuture?Number(existing.returnAbsDay):now;
   const absence=setPlayerAbsence(team,player,start,baseEnd+7,"Недоволен решением тренера и хочет отдохнуть от футбола"),returned=gameDateLabel(absence.returnAbsDay);
   item.responseLabel+=" Сработало событие 50/50: футболист недоступен до "+returned+".";
   publishCoachEventOnce("player-refusal-absence:"+state.seasonNumber+":"+state.gameDay+":"+item.id,"player","Футболист недоволен решением тренера",player.name+" недоволен решением тренера и хочет отдохнуть от футбола. Он временно недоступен для команды и вернётся в "+returned+".",{priority:"high",important:true,day:state.gameDay,season:state.seasonNumber,popup:true});
  }else item.responseLabel+=" Футболист принял решение тренера и продолжит тренироваться.";
 }
 item.responseStatus=decision;item.read=true;updateCoachRespect();saveState();render();
}
function renderCoachChronicle(){
 ensureCoachCommunicationState();const feed=$("eventFeed");if(!feed)return;feed.replaceChildren();const entries=state.coachChronicle.slice(0,5);
 if(!entries.length){feed.className="empty-state";feed.append(safeText("span","📋"),safeText("b","Пока тихо"),safeText("p","Здесь будут появляться важные события команды."));return}
 feed.className="coach-chronicle-list";entries.forEach(item=>{const row=document.createElement("article");row.className="chronicle-item";row.append(safeText("small","С"+item.season+" · День "+item.day,"muted"),safeText("b",item.title),safeText("p",item.message));row.style.cursor="default";feed.append(row)});
}
function isCanonicalLeagueResult(r,leagueName){
 const home=getTeamForMatch(r?.homeId),away=getTeamForMatch(r?.awayId);
 const seasonKey=String(Number(r?.season)||Number(state.seasonNumber)||1),history=state.leagueMembershipHistory?.[seasonKey];
 const homeLeague=history?.[r?.homeId]||home?.league,awayLeague=history?.[r?.awayId]||away?.league;
 return Boolean(home&&away&&homeLeague===leagueName&&awayLeague===leagueName&&Number(r.day)===officialRoundDay(Number(r.round),leagueName));
}
function getCurrentStandings(leagueName=currentCoachLeague()){
 const teams=allCurrentLeagueTeams(leagueName).map(t=>({team:t,played:0,w:0,d:0,l:0,gf:0,ga:0,pts:0}));
 const byId=Object.fromEntries(teams.map(x=>[x.team.id,x]));
 Object.values(state.leagueResults||{}).filter(r=>Number(r.season||state.seasonNumber)===Number(state.seasonNumber||1)&&isCanonicalLeagueResult(r,leagueName)).forEach(r=>{
  const h=byId[r.homeId],a=byId[r.awayId];if(!h||!a)return;
  h.played++;a.played++;h.gf+=r.homeScore;h.ga+=r.awayScore;a.gf+=r.awayScore;a.ga+=r.homeScore;
  if(r.homeScore>r.awayScore){h.w++;a.l++;h.pts+=3}else if(r.homeScore<r.awayScore){a.w++;h.l++;a.pts+=3}else{h.d++;a.d++;h.pts++;a.pts++}
 });
 return teams.sort((a,b)=>b.pts-a.pts||(b.gf-b.ga)-(a.gf-a.ga)||b.gf-a.gf||a.team.name.localeCompare(b.team.name,"ru"));
}
function calendarDateText(){return "СЕЗОН "+(state.seasonNumber||1)+", День "+(state.gameDay||1)}
function canAdvanceCoachDay(){
 if(state.pendingSpecialMatch)return false;
 const round=officialRoundForDay(Number(state.gameDay)||1);if(!round)return true;
 const f=currentOfficialFixture();if(!f)return true;
 const key=roundFixtureKey(round,f);return Boolean(state.leagueResults?.[key]);
}
function simulateEndSeasonFriendlyDay(day){
 const pair=END_SEASON_FRIENDLIES[Number(day)];if(!pair||!leagueData)return;
 state.seasonFriendlyResults=Array.isArray(state.seasonFriendlyResults)?state.seasonFriendlyResults:[];
 const season=Number(state.seasonNumber)||1,keyPrefix=season+":"+day+":";
 if(state.seasonFriendlyResults.some(x=>String(x.key||"").startsWith(keyPrefix)))return;
 const first=allCurrentLeagueTeams(pair[0]).slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 const second=allCurrentLeagueTeams(pair[1]).slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 const sameLeague=pair[0]===pair[1],offset=(season+Number(day))%Math.max(1,second.length);
 const rotated=second.map((_,i)=>second[(i+offset)%second.length]);
 const fixtures=[];
 if(sameLeague){const rotatedFirst=first.map((_,i)=>first[(i+offset)%first.length]);for(let i=0;i+1<rotatedFirst.length;i+=2)fixtures.push([rotatedFirst[i],rotatedFirst[i+1]])}
 else for(let i=0;i<Math.min(first.length,rotated.length);i++)fixtures.push([first[i],rotated[i]]);
 fixtures.forEach(([home,away])=>{
  if(!home||!away)return;
  const key=keyPrefix+home.id+":"+away.id;if(state.seasonFriendlyResults.some(x=>x.key===key))return;
  const rand=seededCupRandom("season-friendly:"+key),score=team=>Math.max(0,Math.min(6,Math.floor(rand()*3)+Math.floor(cupTeamPower(team)/35)));
  if(queuePlayableSpecialMatch("friendly",{season,day,stage:"season-friendly",matchIndex:0,key,title:"Товарищеский матч",},home,away))return;
  const homeScore=score(home),awayScore=score(away),result={key,season,day,homeId:home.id,awayId:away.id,homeName:matchTeamLabel(home),awayName:matchTeamLabel(away),homeScore,awayScore,friendly:true,matchType:"friendly"};
  state.seasonFriendlyResults.push(result);
  const ownId=getUserTeam()?.id;
  if(home.id===ownId||away.id===ownId)publishCoachEventOnce("season-friendly:"+key,"news","Товарищеский матч",result.homeName+" "+homeScore+":"+awayScore+" "+result.awayName+". Результат не влияет на таблицу лиги.",{priority:"normal"});
 });
}
function simulateNpcTransferExchange() {
 if (!leagueData || state.careerRulesVersion !== "2.8.1" || !state.initialRosterDistributionApplied) return null;
 // Occasional in-world activity: one 8% check per progressed game day, no effect on user-team trades.
 if (Math.random() >= 0.08) return null;
 state.externalRosters = state.externalRosters && typeof state.externalRosters === "object" ? state.externalRosters : {};
 const npcTeams = (leagueData.teams || []).filter(team => !team.isUserTeam && team.name !== "{teamName}").map(base => ({
   base, players: Array.isArray(state.externalRosters[base.id]) ? state.externalRosters[base.id] : base.players
 })).filter(team => team.players.length > 0 && team.players.length <= 10);
 if (npcTeams.length < 2) return null;
 const pair = shuffledCopy(npcTeams).slice(0, 2);
 const [a, b] = pair;
 if (a.players.length > 10 || b.players.length > 10) return null;
 const playerA = a.players[Math.floor(Math.random() * a.players.length)];
 const playerB = b.players[Math.floor(Math.random() * b.players.length)];
 if (!playerA || !playerB || playerA.careerId === playerB.careerId) return null;
 const indexA = a.players.findIndex(p => p.careerId === playerA.careerId);
 const indexB = b.players.findIndex(p => p.careerId === playerB.careerId);
 if (indexA < 0 || indexB < 0) return null;
 // Two-way exchange preserves each team's player count and respects the ten-player limit.
 a.players[indexA] = playerB;
 b.players[indexB] = playerA;
 state.externalRosters[a.base.id] = a.players;
 state.externalRosters[b.base.id] = b.players;
 a.base.players = a.players; b.base.players = b.players;
 const record = {
   id: "npc-transfer-" + String(state.seasonNumber || 1) + "-" + String(state.gameDay || 1) + "-" + Date.now(),
   season: Math.max(1, Number(state.seasonNumber) || 1), day: Math.max(1, Number(state.gameDay) || 1), at: Date.now(),
   teamAId: a.base.id, teamAName: a.base.name, playerAName: playerA.name, playerAId: playerA.careerId || null,
   teamBId: b.base.id, teamBName: b.base.name, playerBName: playerB.name, playerBId: playerB.careerId || null
 };
 state.npcTransferHistory = Array.isArray(state.npcTransferHistory) ? state.npcTransferHistory : [];
 state.npcTransferHistory.push(record);
 if (state.npcTransferHistory.length > 500) state.npcTransferHistory = state.npcTransferHistory.slice(-500);
 const eventKey = "npc-transfer:" + record.season + ":" + record.day;
 publishCoachEventOnce(
   eventKey,
   "news",
   "Обмен между командами",
   "«" + record.teamAName + "» и «" + record.teamBName + "» совершили взаимный обмен. " +
     record.playerAName + " перешёл в «" + record.teamBName + "», а " +
     record.playerBName + " — в «" + record.teamAName + "».",
   { priority: "normal", season: record.season, day: record.day, actionPage: "transfers", actionLabel: "Посмотреть обмены" }
 );
 return record;
}

function advanceCoachDay(){
 if(!leagueData){alert("Календарь ещё загружается.");return}
 if(!canAdvanceCoachDay()){alert("Сегодня официальный матч тура. На главной странице появилась кнопка «НАЧАТЬ МАТЧ».");return}
 if(Number(state.gameDay)>=182){
  const completedSeason=Number(state.seasonNumber)||1;
  const leagueTransitionSummary=completeSeasonLeagueTransitions(completedSeason);
  if(state.pendingSpecialMatch?.type==="playoff"){saveState();render();openPage("match");return}
  awardSeasonRatingBonuses(completedSeason);
  finalizeSeasonCareerAwards(completedSeason);
  state.careerHistory=state.careerHistory||{officialMatches:[],seasons:{}};
  state.careerHistory.seasons=state.careerHistory.seasons||{};
  state.careerHistory.seasons[String(completedSeason)]={...(state.careerHistory.seasons[String(completedSeason)]||{}),finalRating:Number(state.seasonRating)||0};
  state.seasonNumber=completedSeason+1;state.gameDay=1;state.seasonRating=0;state.seasonMatchAwards=[];recoverPlayerConditionForDay();
  processPendingScoutDepartures();
  ensureLeagueMembershipSnapshot(state.seasonNumber);
  const ownAfterTransition=getUserTeam();if(ownAfterTransition)state.selectedLeague=ownAfterTransition.league;
  state.lastCalendarEvent="Сезон "+completedSeason+" завершён. "+leagueTransitionSummary+" Начался новый сезон "+state.seasonNumber+". Общий рейтинг сохранён; сезонный рейтинг нового сезона начинается с 0.";publishCoachEventOnce("season-start:"+state.seasonNumber,"news","Итоги сезона и переходы между лигами",state.lastCalendarEvent,{priority:"high",important:true,day:1,season:state.seasonNumber,popup:true});
  updateCoachRespect();saveState();render();alert(state.lastCalendarEvent);return
}
 state.gameDay=Number(state.gameDay||1)+1;
 recoverPlayerConditionForDay();
 simulateNpcTransferExchange();
 processPendingScoutDepartures();
 deliverScheduledCoachMail(state.gameDay);
 const currentSeason=Number(state.seasonNumber)||1;
 const ownLeague=currentCoachLeague();
 if(state.gameDay===officialRoundDay(9,ownLeague)+1)announceCupDraw(currentSeason);
 const quarterIndex=CUP_QUARTERFINAL_DAYS.indexOf(Number(state.gameDay));
 const semiIndex=CUP_SEMIFINAL_DAYS.indexOf(Number(state.gameDay));
 if(quarterIndex>=0)runCupRound("quarterfinals",quarterIndex);
 if(semiIndex>=0)runCupRound("semifinals",semiIndex);
 if(Number(state.gameDay)===CUP_FINAL_DAY)runCupRound("finals",0);
 if(CUP_FRIENDLY_DAYS.includes(Number(state.gameDay))){
  const draw=getSeasonCupTeams(currentSeason);
  simulateCupFriendlyRound(currentSeason,"friendly-day-"+state.gameDay,draw.excluded);
 }
 simulateScheduledLeagueResultsForDay(state.gameDay);
 if(END_SEASON_FRIENDLIES[state.gameDay])simulateEndSeasonFriendlyDay(state.gameDay);
 let note="";
 if(state.gameDay===61)note="Начинается стадия четвертьфиналов кубка «Достаток». Матчи пройдут в дни 61, 62, 64 и 65.";
 if(state.gameDay===68)note="Сегодня проходят первые полуфиналы кубка «Достаток». Второй полуфинал назначен на день 70.";
 if(state.gameDay===CUP_FINAL_DAY)note="Сегодня состоится финал кубка «Достаток».";
 if(state.gameDay===182)note="Сезон завершён. Следующий переход начнёт новый сезон с дня 1."; setTimeout(showNextGameEventPopup,120);
 state.lastCalendarEvent=note;if(note)publishCoachEventOnce("calendar:"+state.seasonNumber+":"+state.gameDay,"news","Событие календаря",note,{priority:"high",important:true});
 if(Number(state.gameDay)%3===0){ensureCoachCommunicationState();const recent=state.coachChronicle.filter(x=>Number(x.season)===Number(state.seasonNumber)&&Number(x.day)>=Number(state.gameDay)-2&&Number(x.day)<=Number(state.gameDay)&&!String(x.key||"").startsWith("digest:"));if(recent.length)publishCoachEventOnce("digest:"+state.seasonNumber+":"+state.gameDay,"news","Сводка за последние 3 игровых дня","За последние игровые дни произошло событий: "+recent.length+". Последние события: "+recent.slice(0,3).map(x=>x.title).join("; ")+".",{priority:"normal"})}
 saveState();render();
 if(state.pendingSpecialMatch&&!state.officialMatchSession)openPage("match");
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
function renderCompactMatchLineups(session,home,away){
 const panel=document.createElement("section");panel.className="match-rosters panel";
 [["home",home],["away",away]].forEach(([side,team])=>{const col=document.createElement("div");col.className="match-roster-column "+side;const head=document.createElement("div");head.className="match-roster-heading";const logo=teamLogoSource(team);if(logo){const img=document.createElement("img");img.src=logo;img.alt="";img.className="match-roster-logo";img.onerror=()=>img.remove();head.append(img)}head.append(safeText("h3",matchTeamLabel(team)));const formation=side==="home"?(session.homeId===getUserTeam()?.id?session.formation:session.npcFormation):(session.awayId===getUserTeam()?.id?session.formation:session.npcFormation);if(formation)head.append(safeText("small","Схема "+formation,"match-roster-formation"));col.append(head);(session.lineups?.[side]||[]).forEach(entry=>{const player=entry.player||entry,row=document.createElement("div");row.className="match-roster-player"+(entry.sentOff?" is-sent-off":"");row.append(makeMatchPortrait(player,team));const details=document.createElement("div");details.className="match-roster-player-details";details.append(safeText("b",player.name||"Футболист"));const meta=document.createElement("div");meta.className="match-roster-player-meta";meta.append(safeText("span",entry.role||player.position||"—","match-roster-position"));meta.append(safeText("span","СОСТОЯНИЕ","match-condition-label"));const condition=document.createElement("div");condition.className="match-condition";condition.title="СОСТОЯНИЕ: "+getPlayerCondition(player).toFixed(1)+"%";condition.style.height="6px";condition.style.background="#0b3024";condition.style.borderRadius="999px";condition.style.overflow="hidden";condition.style.flex="1";condition.style.minWidth="42px";const bar=document.createElement("div");bar.className="match-condition-bar";bar.style.height="100%";bar.style.width=getPlayerCondition(player)+"%";bar.style.background=getPlayerCondition(player)>60?"#25c981":getPlayerCondition(player)>30?"#e5b34b":"#e45b5b";condition.append(bar);meta.append(condition,safeText("span",getPlayerCondition(player).toFixed(1)+"%","match-condition-value"));details.append(meta);row.append(details);if(entry.sentOff)row.append(safeText("span","Удалён","match-roster-status"));col.append(row)});panel.append(col)});return panel;
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
function appendMatchEventClubIcon(row,event,home,away){const side=getEventTeamSide(event);const team=side==="home"?home:side==="away"?away:null;const src=teamLogoSource(team);if(!src)return;const img=document.createElement("img");img.src=src;img.alt=team?displayTeamName(team):"";img.title=team?displayTeamName(team):"";img.className="match-event-club-logo";img.onerror=()=>img.remove();row.append(img)}
function isImportantMatchEvent(event){return Boolean(event&&(event.type==="goal"||event.card==="yellow"||event.card==="red"||event.type==="injury"||event.injury));}
function getEventTeamSide(event){return event?.type==="goal"?(event.scoringSide||event.side):event?.side||null;}
function deriveMatchStats(session){const events=session.events||[],stats={home:{shots:0,onTarget:0,possessionMinutes:0},away:{shots:0,onTarget:0,possessionMinutes:0}};const minutes=Math.max(1,Math.min(40,Number(session.minute)||40)),hp=Number(session.matchStats?.home?.possessionMinutes)||0,ap=Number(session.matchStats?.away?.possessionMinutes)||0,total=hp+ap||1;stats.home.possessionMinutes=Math.round(minutes*hp/total);stats.away.possessionMinutes=minutes-stats.home.possessionMinutes;events.forEach(e=>{const side=getEventTeamSide(e);if(!stats[side])return;if(e.shot===true||["goal","save","chance","penalty"].includes(e.type))stats[side].shots++;if(e.onTarget===true||["goal","save"].includes(e.type))stats[side].onTarget++;});["home","away"].forEach(side=>{const goals=events.filter(e=>e.type==="goal"&&getEventTeamSide(e)===side).length;stats[side].shots=Math.max(stats[side].shots,goals);stats[side].onTarget=Math.max(stats[side].onTarget,goals);});return stats;}
function calculateMatchPlayerRatings(session){
 const counts={home:{goals:new Map(),assists:new Map()},away:{goals:new Map(),assists:new Map()}};
 (session.events||[]).filter(e=>e.type==="goal").forEach(e=>{const side=getEventTeamSide(e);if(!counts[side])return;if(e.scorer)counts[side].goals.set(e.scorer,(counts[side].goals.get(e.scorer)||0)+1);if(e.assist)counts[side].assists.set(e.assist,(counts[side].assists.get(e.assist)||0)+1);});
 return ["home","away"].flatMap(side=>(session.lineups?.[side]||[]).map(entry=>{const p=entry.player||entry,goals=counts[side].goals.get(p.name)||0,assists=counts[side].assists.get(p.name)||0;return {playerName:p.name,side,played:true,goals,assists,rating:Math.min(10,6+goals+assists)};}));
}
function applyPostMatchSkillGrowth(session,ownSide,result){if(result.skillGrowth)return result.skillGrowth;const team=getUserTeam();if(!team)return {changes:[]};const active=(session.lineups?.[ownSide]||[]).filter(e=>!e.sentOff).map(e=>e.player||e).filter(p=>p&&team.players.some(x=>(x.careerId||x.name)===(p.careerId||p.name)));const changes=[],grow=(p,reason)=>{const keys=["ВР","ЗЩ","ПЗ","НП"],skill=keys[Math.floor(Math.random()*keys.length)];p.skills=p.skills||{};const before=Number(p.skills[skill]||0),after=Math.min(100,before+1);p.skills[skill]=after;changes.push({playerName:p.name,skill,before,after,reason});if(skill===(p.position||"")&&after>before)processScoutAttributeIncrease(team,p,before,after);};const own=ownSide==="home"?result.homeScore:result.awayScore,opp=ownSide==="home"?result.awayScore:result.homeScore;if(own>opp){const pool=[...active];for(let i=0;i<3&&pool.length;i++)grow(pool.splice(Math.floor(Math.random()*pool.length),1)[0],"Победа команды");}else if(active.length){const ratings=new Map((result.playerRatings||[]).filter(x=>x.played).map(x=>[x.playerName,Number(x.rating)||6]));const best=Math.max(...active.map(p=>ratings.get(p.name)||6)),pool=active.filter(p=>(ratings.get(p.name)||6)===best);grow(pool[Math.floor(Math.random()*pool.length)],own===opp?"Ничья":"Поражение");}result.skillGrowth=changes;return changes;}
function createMatchEvent(session,home,away,minute){
 const pick=arr=>arr.length?arr[Math.floor(Math.random()*arr.length)]:null;
 const active=side=>(session.lineups[side]||[]).filter(x=>!x.sentOff);
 const power=side=>{const arr=active(side);return arr.reduce((sum,e)=>sum+matchEffectivePlayerScore(e.player,e.role)*.7+matchEffectivePlayerScore(e.player,"ПЗ")*.3,0)/Math.max(1,arr.length)};
 const homePower=power("home"),awayPower=power("away");
 const side=Math.random()<(homePower/(homePower+awayPower||1))?"home":"away";
 const defSide=side==="home"?"away":"home",attack=active(side),defence=active(defSide);
 const attackTeam=side==="home"?home:away,defTeam=side==="home"?away:home;
 const tactic=session.tactics?.[side]||session.formationTactics?.[side]||(side==="home"?(session.tactic||"balanced"):"balanced");
 const defenceTactic=session.tactics?.[defSide]||session.formationTactics?.[defSide]||(defSide==="home"?(session.tactic||"balanced"):"balanced");
 const forward=attack.filter(x=>x.role==="НП"||x.role==="ПЗ"),scorer=pick(forward.length?forward:attack);
 const helpers=attack.filter(x=>x!==scorer),helper=pick(helpers);
 const keeper=defence.find(x=>x.role==="ВР")||pick(defence);
 const scoreSkill=entry=>Math.max(1,matchEffectivePlayerScore(entry?.player,entry?.role));
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
   if(Math.random()<.30&&scorer){event.text+=" Прямой удар со штрафного — гол! Автор: "+scorer.player.name+(helper?" (ассист: "+helper.player.name+")":"")+". ";event.type="goal";event.scoringSide=side;event.shot=true;event.onTarget=true;event.scorer=scorer.player.name;event.assist=helper?.player.name||null;session.score[side]++}  }
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
function applyNpcHalftimeSubstitutions(session,home,away){
 if(session.npcHalftimeSubsApplied)return [];
 session.npcHalftimeSubsApplied=true;
 session.npcSubstitutions=session.npcSubstitutions||{home:0,away:0};
 session.npcSubstitutedOut=session.npcSubstitutedOut||{home:[],away:[]};
 const made=[];
 ["home","away"].forEach(side=>{
  const team=side==="home"?home:away;
  if(!team||team.isUserTeam||team.id===getUserTeam()?.id)return;
  const lineup=session.lineups?.[side]||[];
  const roster=Array.isArray(team.players)?team.players:[];
  const usedOut=new Set(session.npcSubstitutedOut[side]||[]);
  for(const entry of lineup){
   if(session.npcSubstitutions[side]>=3)break;
   if(entry.sentOff||!entry.player||usedOut.has(entry.player.name))continue;
   const current=entry.player;
   const condition=getPlayerCondition(current);
   if(condition>70)continue;
   const currentScore=matchEffectivePlayerScore(current,entry.role)+(current.position===entry.role?2:0);
   const bench=roster.filter(p=>p&&p.name!==current.name&&!usedOut.has(p.name)&&!lineup.some(x=>x.player?.name===p.name)&&!isPlayerUnavailable(team,p));
   bench.sort((a,b)=>(matchEffectivePlayerScore(b,entry.role)+(b.position===entry.role?2:0))-(matchEffectivePlayerScore(a,entry.role)+(a.position===entry.role?2:0)));
   const incoming=bench[0];
   if(!incoming)continue;
   const incomingScore=matchEffectivePlayerScore(incoming,entry.role)+(incoming.position===entry.role?2:0);
   if(incomingScore-currentScore<2)continue;
   usedOut.add(current.name);session.npcSubstitutedOut[side].push(current.name);
   entry.player=incoming;session.npcSubstitutions[side]++;
   const message=matchTeamLabel(team)+": "+current.name+" заменён на "+incoming.name+" ("+entry.role+"). Эффективность амплуа улучшена с "+currentScore+" до "+incomingScore+".";
   session.events.push({minute:20,type:"substitution",side,text:message,playerOut:current.name,playerIn:incoming.name,role:entry.role,reason:"Усталость и более высокий эффективный показатель запасного"});
   made.push({side,team:team.name,out:current.name,incoming:incoming.name,role:entry.role,before:currentScore,after:incomingScore});
  }
 });
 return made;
}
function autoAdvanceOfficialMatch(session,home,away){
 if(session.autoPlaying||session.finished||session.halfTime)return;
 session.autoPlaying=true;
 if(!Number.isFinite(Number(session.nextTickAt))||Number(session.nextTickAt)<=0)session.nextTickAt=Date.now()+400;
 const step=()=>{
  if(state.officialMatchSession!==session||session.finished||session.halfTime){
   session.autoPlaying=false;session.nextTickAt=null;saveState();
   if(!document.getElementById("pageView")?.classList.contains("hidden")&&document.getElementById("pageTitle")?.textContent==="Матч")openPage("match");
   return;
  }
  if(session.minute===0)session.events.push({minute:0,type:"play",text:"Судья даёт стартовый свисток. Начинается матч."});
  session.minute++;
  applyMatchMinuteFatigue(session);
  session.events.push(createMatchEvent(session,home,away,session.minute));
  if(session.minute===20){
   session.halfTime=true;session.autoPlaying=false;session.nextTickAt=null;
   applyNpcHalftimeSubstitutions(session,home,away);
   session.events.push({minute:20,type:"halftime",text:"Свисток на перерыв. NPC-тренеры автоматически оценили состояние игроков; ты можешь сделать до трёх замен своей команды."});
  }
  if(session.minute>=40){
   session.events.push({minute:40,type:"fulltime",text:"Финальный свисток! Итоговый счёт "+session.score.home+":"+session.score.away+"."});
   session.autoPlaying=false;session.nextTickAt=null;applyOfficialMatchResult(session,home,away);return;
  }
  state.officialMatchSession=session;
  if(session.autoPlaying)session.nextTickAt=(Number(session.nextTickAt)||Date.now())+7500;
  saveState();
  if(!document.getElementById("pageView")?.classList.contains("hidden")&&document.getElementById("pageTitle")?.textContent==="Матч")openPage("match");
  if(session.autoPlaying)setTimeout(step,Math.max(0,Number(session.nextTickAt)-Date.now()));
 };
 setTimeout(step,Math.max(0,Number(session.nextTickAt)-Date.now()));
}
function resumeSavedOfficialMatch(){
 const tryResume=()=>{
  const session=state.officialMatchSession;
  if(!session||session.finished||session.halfTime||!session.autoPlaying)return true;
  if(!leagueData)return false;
  const home=getTeamForMatch(session.homeId),away=getTeamForMatch(session.awayId);
  if(!home||!away)return false;
  session.autoPlaying=false;
  autoAdvanceOfficialMatch(session,home,away);
  return true;
 };
 if(!tryResume()){
  let attempts=0;
  const timer=setInterval(()=>{attempts++;if(tryResume()||attempts>=40)clearInterval(timer);},250);
 }
}
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
 const type=session.matchType||"league",special=session.specialMatch||state.pendingSpecialMatch||{};
 const fixture={home,away};
 const result={season:Number(session.season||state.seasonNumber)||1,round:Number(session.round)||0,day:Number(session.day||state.gameDay)||1,matchType:type,stage:special.stage||null,homeId:home.id,awayId:away.id,homeScore:session.score.home,awayScore:session.score.away,events:session.events,homeLineup:session.lineups.home,awayLineup:session.lineups.away,substitutions:session.substitutions,finished:true};
 result.stats=deriveMatchStats(session);
 result.spectatorNotes=buildPostMatchSpectatorNotes(session,home,away);
 const relationshipReport=calculateOfficialMatchRelations(session,home,away,result);
 result.relationshipChanges=relationshipReport.changes;
 result.playerRatings=calculateMatchPlayerRatings(session);
 const ownSide=home.id===getUserTeam()?.id?"home":"away";
 result.skillGrowth=applyPostMatchSkillGrowth(session,ownSide,result);
 if(type==="cup"||type==="playoff"){
  const winner=resolveSpecialMatchWinner(home,away,result.homeScore,result.awayScore,type+":"+result.season+":"+special.stage+":"+special.matchIndex);
  result.winnerId=winner.id;result.winnerName=matchTeamLabel(winner);
  if(result.homeScore===result.awayScore){const rand=seededCupRandom("special-penalties:"+type+":"+result.season+":"+special.stage+":"+special.matchIndex);let ph=0,pa=0;for(let i=0;i<5;i++){if(rand()<.72)ph++;if(rand()<.72)pa++}while(ph===pa){if(rand()<.5)ph++;else pa++}if((ph>pa?home:away).id!==winner.id){if(winner.id===home.id)ph=Math.max(ph,pa+1);else pa=Math.max(pa,ph+1)}result.penalties={home:ph,away:pa};result.penaltyWinnerId=winner.id;result.events.push({minute:40,type:"play",text:"Победитель определён в серии послематчевых пенальти: "+matchTeamLabel(winner)+" победили "+ph+":"+pa+"."})}
 }
 if(type==="league"){
  state.leagueResults=state.leagueResults||{};
  state.leagueResults[roundFixtureKey(session.round,fixture)]=result;
  publishCoachEventOnce("match:"+result.season+":"+result.round+":"+getUserTeam()?.id,"news","Матч завершён",matchTeamLabel(getUserTeam())+" сыграли "+(getUserTeam()?.id===result.homeId?result.homeScore+" : "+result.awayScore:result.awayScore+" : "+result.homeScore)+". Отчёт матча сохранён.",{priority:"high",important:true});
  ensureAllLeagueRoundResults(session.round,fixture,result);
  state.careerHistory=state.careerHistory||{officialMatches:[],seasons:{}};
  state.careerHistory.officialMatches=Array.isArray(state.careerHistory.officialMatches)?state.careerHistory.officialMatches:[];
  state.careerHistory.officialMatches.push({season:result.season,round:result.round,day:result.day,at:Date.now(),homeId:home.id,awayId:away.id,homeScore:result.homeScore,awayScore:result.awayScore,goalsFor:home.id===getUserTeam()?.id?result.homeScore:result.awayScore,goalsAgainst:home.id===getUserTeam()?.id?result.awayScore:result.homeScore,result:((home.id===getUserTeam()?.id?result.homeScore-result.awayScore:result.awayScore-result.homeScore)>0)?"W":(result.homeScore===result.awayScore?"D":"L"),events:result.events,substitutions:result.substitutions});
  awardOfficialMatchRating(result,fixture);
 }else{
  state.careerHistory=state.careerHistory||{officialMatches:[],seasons:{}};
  state.careerHistory.specialMatches=Array.isArray(state.careerHistory.specialMatches)?state.careerHistory.specialMatches:[];
  state.careerHistory.specialMatches.push({season:result.season,day:result.day,matchType:type,stage:result.stage,homeId:home.id,awayId:away.id,homeScore:result.homeScore,awayScore:result.awayScore,winnerId:result.winnerId||null,penalties:result.penalties||null});
  if(type==="cup"){
   state.cupResults=state.cupResults&&typeof state.cupResults==="object"?state.cupResults:{};
   const cup=state.cupResults[result.season]||(state.cupResults[result.season]={matches:[],championId:null,championName:null});
   const played={...result,bracketIndex:Number(special.matchIndex)||0,winnerId:result.winnerId,winnerName:result.winnerName,playerStats:[]};
   cup.matches.push(played);
   const stageName=result.stage==="quarterfinals"?"Четвертьфинал":result.stage==="semifinals"?"Полуфинал":"Финал";
   publishCoachEventOnce("cup-result:"+result.season+":"+result.stage+":"+played.bracketIndex+":"+getUserTeam()?.id,"news","Кубок «ДОСТАТОК»: "+stageName,result.homeName+" "+result.homeScore+":"+result.awayScore+" "+result.awayName+(result.penalties?"; пенальти "+result.penalties.home+":"+result.penalties.away:"")+".",{priority:"high",important:true});
   if(result.stage==="finals"){
    cup.championId=result.winnerId;cup.championName=result.winnerName;
    const winner=cupBracketTeam(result.winnerId),caption="КУБОК «ДОСТАТОК» · СЕЗОН "+result.season,score=matchTeamLabel(home)+" "+result.homeScore+":"+result.awayScore+" "+matchTeamLabel(away)+(result.penalties?" · пенальти "+result.penalties.home+":"+result.penalties.away:"");
    if(winner){addCareerAward({key:"cup-dostatoch:team:"+result.season,recipientType:"team",recipientId:winner.id,icon:"awardcupdostatok",label:"Кубок «Достаток»",caption,result:score,season:result.season});addCareerAward({key:"cup-dostatoch:coach:"+result.season,recipientType:"coach",recipientId:winner.id,icon:"awardcupdostatok",label:"Кубок «Достаток»",caption,result:score,season:result.season});(winner.players||[]).forEach(p=>addCareerAward({key:"cup-dostatoch:player:"+result.season+":"+winner.id+":"+p.name,recipientType:"player",recipientId:winner.id,recipientName:p.name,icon:"awardcupdostatok",label:"Кубок «Достаток»",caption,result:score,season:result.season}))}
    publishCoachEventOnce("cup-champion:"+result.season,"news","Обладатель кубка «ДОСТАТОК»","Кубок «ДОСТАТОК» сезона "+result.season+" выиграла команда "+result.winnerName+". Финальный результат: "+score+".",{priority:"high",important:true});
   }
  }else if(type==="playoff"){
   state.leagueTransitions=state.leagueTransitions&&typeof state.leagueTransitions==="object"?state.leagueTransitions:{};
   const seasonKey=String(result.season),transition=state.leagueTransitions[seasonKey]||{season:result.season,pending:true};
   transition.pending=false;transition.playoff={season:result.season,day:result.day,type:"promotion-playoff",homeId:home.id,homeName:matchTeamLabel(home),awayId:away.id,awayName:matchTeamLabel(away),homeScore:result.homeScore,awayScore:result.awayScore,penalties:result.penalties||null,penaltyWinnerId:result.penaltyWinnerId||null,winnerId:result.winnerId,winnerName:result.winnerName,loserId:result.winnerId===home.id?away.id:home.id,loserName:result.winnerId===home.id?matchTeamLabel(away):matchTeamLabel(home)};
   state.leagueTransitions[seasonKey]=transition;
   publishCoachEventOnce("promotion-playoff:"+result.season,"news","Стыковой матч завершён",matchTeamLabel(home)+" "+result.homeScore+":"+result.awayScore+" "+matchTeamLabel(away)+". Победитель: "+result.winnerName+".",{priority:"high",important:true});
  }else{
   const key=type==="cup-friendly"?(result.season+":"+special.stage+":"+home.id+":"+away.id):(result.season+":"+result.day+":"+home.id+":"+away.id);
   const record={key,season:result.season,day:result.day,stage:special.stage||"season-friendly",homeId:home.id,awayId:away.id,homeName:matchTeamLabel(home),awayName:matchTeamLabel(away),homeScore:result.homeScore,awayScore:result.awayScore,friendly:true,matchType:type};
   if(type==="cup-friendly"){state.cupFriendlyResults=Array.isArray(state.cupFriendlyResults)?state.cupFriendlyResults:[];state.cupFriendlyResults=state.cupFriendlyResults.filter(x=>x.key!==key);state.cupFriendlyResults.push(record)}
   else{state.seasonFriendlyResults=Array.isArray(state.seasonFriendlyResults)?state.seasonFriendlyResults:[];state.seasonFriendlyResults=state.seasonFriendlyResults.filter(x=>x.key!==key);state.seasonFriendlyResults.push(record)}
   publishCoachEventOnce("played-friendly:"+key,"news","Товарищеский матч сыгран",record.homeName+" "+record.homeScore+":"+record.awayScore+" "+record.awayName+". Результат сохранён в истории сезона.",{priority:"normal"});
  }
 }
 state.lastMatchReport=result;
 updateCoachRespect();
 const shouldShowSummary=!document.getElementById("pageView")?.classList.contains("hidden")&&document.getElementById("pageTitle")?.textContent==="Матч";
 state.officialMatchSession=null;
 const completedPlayoff=type==="playoff";
 if(state.pendingSpecialMatch&&state.pendingSpecialMatch.type===type)state.pendingSpecialMatch=null;
 saveState();render();if(shouldShowSummary)openPage("matchSummary");
 if(completedPlayoff)setTimeout(()=>advanceCoachDay(),0);
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
 header.append(safeText("p","СЕЗОН "+result.season+" · "+((result.matchType||"league")==="league"?"ТУР "+result.round:({cup:"КУБОК «ДОСТАТОК»",playoff:"СТЫКОВОЙ МАТЧ","cup-friendly":"ТОВАРИЩЕСКИЙ МАТЧ",friendly:"ТОВАРИЩЕСКИЙ МАТЧ"}[result.matchType]||"МАТЧ"))+" · ДЕНЬ "+result.day,"eyebrow"));
 const scoreline=document.createElement("div");scoreline.className="match-summary-scoreline";
 const side=(team,score)=>{const el=document.createElement("div");el.className="match-summary-team";const src=teamLogoSource(team);if(src){const img=document.createElement("img");img.src=src;img.alt="";img.className="tournament-team-logo";img.onerror=()=>img.remove();el.append(img)}el.append(safeText("b",matchTeamLabel(team)),safeText("strong",String(score)));return el};
 scoreline.append(side(home,result.homeScore),safeText("span","—","match-summary-divider"),side(away,result.awayScore));header.append(scoreline,safeText("p",result.homeScore>result.awayScore?matchTeamLabel(home)+" победили":result.homeScore<result.awayScore?matchTeamLabel(away)+" победили":"Ничья","match-summary-outcome"));
 const goals=(result.events||[]).filter(e=>e.type==="goal");
 const goalsPanel=document.createElement("section");goalsPanel.className="panel match-summary-panel";goalsPanel.append(safeText("h2","Голы и ключевые моменты"));
 if(!goals.length)goalsPanel.append(safeText("p","Встреча завершилась без голов.","muted"));
 goals.forEach(e=>{const row=document.createElement("div");row.className="match-summary-goal";row.append(safeText("b",e.minute+"'"));appendMatchEventClubIcon(row,e,home,away);row.append(safeText("span","⚽ "+(e.scorer||"Автор гола не указан")+(e.assist?" · пас: "+e.assist:"")));goalsPanel.append(row)});
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
 (result.events||[]).filter(isImportantMatchEvent).slice().reverse().forEach(e=>{const row=document.createElement("div");row.className="match-summary-event";row.append(safeText("b",e.minute+"'"));appendMatchEventClubIcon(row,e,home,away);row.append(safeText("span",e.text));eventsPanel.append(row)});if(!eventsPanel.querySelector(".match-summary-event"))eventsPanel.append(safeText("p","Голов, карточек и травм в матче не было.","muted"));
 const growthPanel=document.createElement("section");growthPanel.className="panel match-summary-panel";growthPanel.append(safeText("h2","Развитие футболистов после матча"));if(result.skillGrowth?.length){result.skillGrowth.forEach(change=>{const row=document.createElement("div");row.className="match-summary-event";row.append(safeText("b","+1 "+change.skill),safeText("span",change.playerName+" · "+change.before+" → "+change.after+" · "+change.reason));growthPanel.append(row)})}else growthPanel.append(safeText("p","Показатели не изменились.","muted"));
 const relationPanel=document.createElement("section");relationPanel.className="panel match-summary-panel";relationPanel.append(safeText("h2","Изменения отношений"));
 if(result.relationshipChanges?.length){result.relationshipChanges.forEach(change=>{const row=document.createElement("div");row.className="match-summary-event";row.append(safeText("b",change.delta>0?"+"+change.delta.toFixed(2).replace(".",",")+" п.п.":"0 п.п."),safeText("span",change.playerName+" · "+change.before.toFixed(2).replace(".",",")+"% → "+change.after.toFixed(2).replace(".",",")+"%"+(change.played?" · играл":" · командный бонус")));relationPanel.append(row)})}
 else relationPanel.append(safeText("p","Отношения не изменились.","muted"));
 relationPanel.append(safeText("p","Командный бонус: победа +0,50 п.п., ничья +0,25 п.п., поражение +0. Личный бонус: оценка от 7,0 — +0,50 п.п.; лучший игрок матча — ещё +0,50 п.п. Запасные получают командный бонус. Максимум +2 п.п. на игрока за матч.","muted"));
 const roundPanel=document.createElement("section");roundPanel.className="panel match-summary-panel";
 if((result.matchType||"league")==="league"){roundPanel.append(safeText("h2","Другие результаты тура"));getOfficialRoundFixtures(result.round,getTeamForMatch(result.homeId)?.league||currentCoachLeague()).forEach(f=>{const key=roundFixtureKey(result.round,f),r=state.leagueResults?.[key];roundPanel.append(tournamentMatchRow(result.round,f,r,f.home.id===ownId||f.away.id===ownId))})}
 else{roundPanel.append(safeText("h2","Матч завершён"),safeText("p",({cup:"Результат сохранён в сетке кубка «ДОСТАТОК».",playoff:"Результат стыкового матча сохранён для расчёта переходов между лигами.","cup-friendly":"Товарищеский матч сохранён в истории кубковых дней.",friendly:"Товарищеский матч сохранён в истории сезона."}[result.matchType]||"Результат сохранён."),"muted"))}
 const actions=document.createElement("div");actions.className="match-summary-actions";actions.append(matchButton("К ТУРНИРНОЙ ТАБЛИЦЕ",()=>openPage("league"),"primary"),matchButton("ВЕРНУТЬСЯ НА ГЛАВНУЮ",returnToDashboard,"secondary"));
 wrap.append(actions,header,lineups,spectators,growthPanel,relationPanel,roundPanel);return wrap;
}
function renderMatchPage(){
 const wrap=document.createElement("div");wrap.className="official-match-view";
 if(!leagueData){wrap.append(placeholder("Загружаю календарь и составы…"));return wrap}
 let session=state.officialMatchSession;
 if(!session){
  const special=state.pendingSpecialMatch;
  let round=0,fixture=null;
  if(special){fixture={home:getTeamForMatch(special.homeId),away:getTeamForMatch(special.awayId)}}
  else{round=officialRoundForDay(Number(state.gameDay)||1);fixture=currentOfficialFixture()}
  if(!fixture?.home||!fixture?.away){wrap.append(safeText("h2","Сегодня нет матча для проведения"),safeText("p","Матчи доступны в дни официальных туров, кубковых этапов, стыковых встреч и назначенных товарищеских игр.","muted"));wrap.append(matchButton("Вернуться на главную",returnToDashboard,"secondary"));return wrap}
  if(!special){const existing=state.leagueResults?.[roundFixtureKey(round,fixture)];if(existing){wrap.append(safeText("h2","Матч тура "+round+" уже завершён"),safeText("p",matchTeamLabel(fixture.home)+" "+existing.homeScore+":"+existing.awayScore+" "+matchTeamLabel(fixture.away)));wrap.append(matchButton("К календарю",()=>openPage("league"),"primary"));return wrap}}
  const matchTitle=special?.title||( "Тур "+round);
  const formation="2–2–1";const setup=document.createElement("section");setup.className="match-setup panel";setup.append(safeText("p","СЕЗОН "+(special?.season||state.seasonNumber)+" · "+matchTitle.toUpperCase()+" · ДЕНЬ "+(special?.day||state.gameDay),"eyebrow"));const matchup=document.createElement("div");matchup.className="match-setup-matchup";[[fixture.home,"home"],[fixture.away,"away"]].forEach(([team,side])=>{const item=document.createElement("div");item.className="match-setup-team "+side;const src=teamLogoSource(team);if(src){const img=document.createElement("img");img.src=src;img.alt="";img.className="match-setup-logo";item.append(img)}item.append(safeText("b",matchTeamLabel(team)));matchup.append(item);if(side==="home")matchup.append(safeText("span","VS","match-setup-vs"))});setup.append(matchup,safeText("p","Выбери тактику и назначь шесть разных футболистов. Схема задаёт роли, а не фиксированный состав.","muted"));const formationLabel=safeText("label","Тактика / расстановка");formationLabel.className="match-formation-label";const formationSelect=document.createElement("select");formationSelect.className="match-formation-select";Object.keys(MATCH_FORMATIONS).forEach(f=>{const o=document.createElement("option");o.value=f;o.textContent=f+" · "+({"2–2–1":"Сбалансированная","2–1–2":"Атакующая","1–3–1":"Контроль центра","3–1–1":"Оборонительная"}[f]);formationSelect.append(o)});const slots=document.createElement("div");slots.className="match-lineup-slots";const preview=document.createElement("div");preview.className="match-lineup-preview";const status=safeText("p","","match-lineup-status");const myTeam=getUserTeam(),roster=(myTeam?.players||[]).filter(player=>!isPlayerUnavailable(myTeam,player)).slice();let startButton;const drawPreview=(preserve=false)=>{const prev=preserve?[...slots.querySelectorAll("select")].map(x=>x.value):[];slots.replaceChildren();preview.replaceChildren();const defaults=buildOfficialLineup(myTeam,formationSelect.value);defaults.forEach((entry,i)=>{const row=document.createElement("label");row.className="match-lineup-slot";row.append(safeText("span",entry.role+" · "+(entry.role==="ВР"?"Вратарь":"Полевой игрок")));const sel=document.createElement("select");sel.className="league-select";roster.forEach(p=>{const o=document.createElement("option");o.value=p.careerId||p.name;o.textContent=p.name+" · "+p.position;o.selected=prev[i]?(prev[i]===(p.careerId||p.name)):p===entry.player;sel.append(o)});sel.addEventListener("change",()=>drawPreview(true));row.append(sel);slots.append(row)});const chosen=[...slots.querySelectorAll("select")].map(sel=>roster.find(p=>(p.careerId||p.name)===sel.value)).filter(Boolean),invalid=chosen.length!==6||new Set(chosen.map(p=>p.careerId||p.name)).size!==6;status.textContent=invalid?"Выбери шесть разных футболистов.":"На поле выбрано 6 из "+roster.length+" игроков.";status.classList.toggle("error-text",invalid);defaults.forEach((entry,i)=>{const p=chosen[i]||entry.player,card=document.createElement("div");card.className="match-lineup-card";card.style.display="flex";card.style.alignItems="center";card.style.gap="10px";card.style.textAlign="left";card.style.minWidth="0";const portrait=makeMatchPortrait(p,myTeam);portrait.style.flex="0 0 40px";const info=document.createElement("div");info.style.display="flex";info.style.flexDirection="column";info.style.gap="4px";info.style.flex="1";info.style.minWidth="0";const name=safeText("b",p.name);name.style.display="block";name.style.whiteSpace="normal";name.style.overflowWrap="anywhere";name.style.lineHeight="1.2";const role=safeText("small",entry.role,"match-role-tag");role.style.alignSelf="flex-start";const conditionWrap=document.createElement("div");conditionWrap.className="match-lineup-condition";conditionWrap.style.display="flex";conditionWrap.style.flexDirection="column";conditionWrap.style.alignItems="stretch";conditionWrap.style.gap="3px";conditionWrap.style.width="100%";conditionWrap.style.marginTop="2px";const conditionHeading=document.createElement("div");conditionHeading.style.display="flex";conditionHeading.style.alignItems="center";conditionHeading.style.justifyContent="space-between";conditionHeading.style.gap="6px";conditionHeading.append(safeText("small","СОСТОЯНИЕ"));const conditionValue=safeText("small",getPlayerCondition(p).toFixed(1)+"%");conditionValue.style.fontWeight="700";conditionHeading.append(conditionValue);const track=document.createElement("div");track.style.height="6px";track.style.background="#0b3024";track.style.borderRadius="999px";track.style.overflow="hidden";track.style.width="100%";const bar=document.createElement("div");bar.style.height="100%";bar.style.width=getPlayerCondition(p)+"%";bar.style.background=getPlayerCondition(p)>60?"#25c981":getPlayerCondition(p)>30?"#e5b34b":"#e45b5b";track.append(bar);conditionWrap.append(conditionHeading,track);info.append(name,role,conditionWrap);card.append(portrait,info);preview.append(card)});if(startButton)startButton.disabled=invalid};formationSelect.addEventListener("change",()=>drawPreview(false));formationLabel.append(formationSelect);setup.append(formationLabel,slots,status,preview);startButton=matchButton("НАЧАТЬ МАТЧ",()=>{const form=formationSelect.value,userHome=fixture.home.isUserTeam,homeTeam=fixture.home,awayTeam=fixture.away,defaults=buildOfficialLineup(getUserTeam(),form),chosen=[...slots.querySelectorAll("select")].map(sel=>roster.find(p=>(p.careerId||p.name)===sel.value)).filter(Boolean);if(chosen.length!==6||new Set(chosen.map(p=>p.careerId||p.name)).size!==6){alert("Выбери шесть разных футболистов.");return}const mine=defaults.map((entry,i)=>({player:chosen[i],role:entry.role,sentOff:false})),npcTeam=userHome?awayTeam:homeTeam,npcChoice=chooseNpcFormation(npcTeam),opponent=npcChoice.lineup;session={season:Number(special?.season||state.seasonNumber)||1,round:Number(round)||0,day:Number(special?.day||state.gameDay)||1,matchType:special?.type||"league",specialMatch:special?{...special}:null,homeId:homeTeam.id,awayId:awayTeam.id,formation:form,npcFormation:npcChoice.formation,minute:0,half:1,halfTime:false,finished:false,score:{home:0,away:0},lineups:{home:userHome?mine:opponent,away:userHome?opponent:mine},events:[],substitutions:0,substitutedOut:[],spectatorSeed:Math.random(),matchStats:{home:{shots:0,onTarget:0,possessionMinutes:0,attacks:0,corners:0},away:{shots:0,onTarget:0,possessionMinutes:0,attacks:0,corners:0}}};state.officialMatchSession=session;saveState();openPage("match")},"primary");setup.append(startButton);drawPreview();wrap.append(setup);return wrap
 }
 const home=getTeamForMatch(session.homeId),away=getTeamForMatch(session.awayId);
 if(!home||!away){wrap.append(placeholder("Не удалось восстановить составы матча."));return wrap}
 const header=document.createElement("section");header.className="match-scoreboard panel";
 header.append(safeText("p","СЕЗОН "+session.season+" · "+(session.matchType&&session.matchType!=="league"?(session.specialMatch?.title||({cup:"КУБОК «ДОСТАТОК»",playoff:"СТЫКОВОЙ МАТЧ","cup-friendly":"ТОВАРИЩЕСКИЙ МАТЧ",friendly:"ТОВАРИЩЕСКИЙ МАТЧ"}[session.matchType]||"МАТЧ")):"ТУР "+session.round)+" · "+session.day+" ДЕНЬ","eyebrow"));
 const scoreline=document.createElement("div");scoreline.className="match-scoreline";
 const homeName=document.createElement("div");homeName.className="match-score-team";const homeLogo=teamLogoSource(home);if(homeLogo){const img=document.createElement("img");img.src=homeLogo;img.alt="";img.className="match-score-logo";homeName.append(img)}homeName.append(safeText("b",matchTeamLabel(home)));
 const score=safeText("strong",session.score.home+" : "+session.score.away);score.className="match-score-number";
 const awayName=document.createElement("div");awayName.className="match-score-team";const awayLogo=teamLogoSource(away);if(awayLogo){const img=document.createElement("img");img.src=awayLogo;img.alt="";img.className="match-score-logo";awayName.append(img)}awayName.append(safeText("b",matchTeamLabel(away)));
 scoreline.append(homeName,score,awayName);header.append(scoreline);const goalScorers=(session.events||[]).filter(e=>e.type==="goal").map(e=>({minute:e.minute,scorer:e.scorer,side:getEventTeamSide(e)}));if(goalScorers.length){const scorers=document.createElement("div");scorers.className="match-score-scorers";goalScorers.forEach(g=>{const team=g.side==="home"?home:away;const item=document.createElement("span");item.className="match-score-scorer";item.append(safeText("b",g.minute+"′"),safeText("span",(g.side==="home"?"● ":"○ ")+(g.scorer||"Автор не указан")));item.title=matchTeamLabel(team)+" — "+(g.scorer||"Автор гола не указан");scorers.append(item)});header.append(scorers)}header.append(safeText("p",session.finished?"МАТЧ ЗАВЕРШЁН":session.halfTime?"ПЕРЕРЫВ · ВАЖНЫЕ МОМЕНТЫ ТАЙМА":"МИНУТА "+session.minute+" / 40","match-clock"));
 const body=document.createElement("div");body.className="match-main-columns";
 const eventPanel=document.createElement("section");eventPanel.className="match-events-panel panel";
 eventPanel.append(safeText("h3","ВАЖНЫЕ МОМЕНТЫ"));
 const eventList=document.createElement("div");eventList.className="match-event-list";
 session.events.filter(isImportantMatchEvent).slice().reverse().forEach(ev=>{const row=document.createElement("article");row.className="match-event "+(ev.type||"play");row.append(safeText("b",ev.minute+"′"));appendMatchEventClubIcon(row,ev,home,away);const text=safeText("span",ev.text);text.className="match-event-text";text.title=ev.text;row.append(text);eventList.append(row)});
 if(!session.events.length)eventList.append(safeText("p","Матч ещё не начался. Нажми «НАЧАТЬ МАТЧ».","muted"));
 eventPanel.append(eventList);
 const spectators=createSpectatorPanel(session,home,away);
 const playerLists=renderCompactMatchLineups(session,home,away);
 body.append(playerLists,spectators);
 const actions=document.createElement("div");actions.className="match-control-row match-control-row-top";
 if(!session.finished){const label=session.halfTime?"ПЕРЕРЫВ":session.autoPlaying?(session.half===2?"ВТОРОЙ ТАЙМ НАЧАЛСЯ":"ПЕРВЫЙ ТАЙМ НАЧАЛСЯ"):session.half===2?"ВТОРОЙ ТАЙМ НАЧАЛСЯ":"НАЧАТЬ МАТЧ";const statusButton=matchButton(session.autoPlaying||session.halfTime?label:"▶ "+label,()=>{if(!session.autoPlaying&&!session.halfTime)autoAdvanceOfficialMatch(session,home,away)},"primary");statusButton.classList.add("match-status-button");statusButton.disabled=Boolean(session.autoPlaying||session.halfTime);actions.append(statusButton)}
 wrap.append(actions,header,eventPanel,body);
 if(session.halfTime&&!session.finished){
  const ht=document.createElement("section");ht.className="halftime-panel panel";ht.append(safeText("h2","ПЕРЕРЫВ — ВАЖНЫЕ МОМЕНТЫ ТАЙМА"));
  const firstHalf=session.events.filter(e=>e.minute<=20&&isImportantMatchEvent(e));
  if(firstHalf.length){firstHalf.slice(-6).reverse().forEach(ev=>ht.append(safeText("p",ev.minute+"' · "+ev.text,"halftime-event")))}else ht.append(safeText("p","В первом тайме опасных моментов не было."));
  ht.append(safeText("p","Замены: "+session.substitutions+" из 3. Можно заменить игроков любой позиции; вышедший игрок больше не возвращается.","muted"));
  const choices=document.createElement("div");choices.className="match-substitution-list";
  const usedOut=new Set(session.substitutedOut||[]);
  ["home","away"].forEach(side=>{
   const team=side==="home"?home:away;if(!team.isUserTeam)return;
   const line=session.lineups[side];const bench=(team.players||[]).filter(p=>!isPlayerUnavailable(team,p)&&!line.some(x=>x.player.name===p.name)&&!usedOut.has(p.name));
   line.filter(x=>!x.sentOff).forEach(entry=>{
    const row=document.createElement("div");row.className="match-substitution-row";
    row.append(makeMatchPortrait(entry.player,team),safeText("span",entry.role+" · "+entry.player.name+" · "+getPlayerCondition(entry.player).toFixed(1)+"%"));const conditionTrack=document.createElement("div");conditionTrack.className="match-substitution-condition";conditionTrack.style.display="flex";conditionTrack.style.alignItems="center";conditionTrack.style.gap="5px";conditionTrack.style.minWidth="110px";conditionTrack.append(safeText("small","СОСТОЯНИЕ"));const conditionBar=document.createElement("div");conditionBar.style.height="6px";conditionBar.style.background="#0b3024";conditionBar.style.borderRadius="999px";conditionBar.style.overflow="hidden";conditionBar.style.flex="1";const conditionFill=document.createElement("div");conditionFill.style.height="100%";conditionFill.style.width=getPlayerCondition(entry.player)+"%";conditionFill.style.background=getPlayerCondition(entry.player)>60?"#25c981":getPlayerCondition(entry.player)>30?"#e5b34b":"#e45b5b";conditionBar.append(conditionFill);conditionTrack.append(conditionBar,safeText("small",getPlayerCondition(entry.player).toFixed(1)+"%"));row.append(conditionTrack);
    const select=document.createElement("select");select.className="match-substitution-select";const blank=document.createElement("option");blank.value="";blank.textContent="Без замены";select.append(blank);
    bench.forEach(p=>{const o=document.createElement("option");o.value=p.name;o.textContent=entry.role+" ← "+p.name+" ("+p.position+") · СОСТОЯНИЕ "+getPlayerCondition(p).toFixed(1)+"%";select.append(o)});
    const go=matchButton("Заменить",()=>{
     if(session.substitutions>=3){alert("За матч разрешено не более трёх замен.");return}
     const name=select.value;if(!name)return;
     const incoming=bench.find(p=>p.name===name);if(!incoming)return;
     session.substitutedOut=session.substitutedOut||[];session.substitutedOut.push(entry.player.name);
     entry.player=incoming;entry.sentOff=false;session.substitutions++;state.officialMatchSession=session;saveState();openPage("match");
    },"secondary");go.disabled=session.substitutions>=3||bench.length===0;row.append(select,go);choices.append(row)
   });
  });
  ht.append(choices,matchButton("НАЧАТЬ ВТОРОЙ ТАЙМ",()=>{session.halfTime=false;session.half=2;session.autoPlaying=false;state.officialMatchSession=session;saveState();autoAdvanceOfficialMatch(session,home,away)},"primary"));wrap.insertBefore(ht,header)
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
 if(team?.isUserTeam||team?.id===getUserTeam()?.id||team?.name==="{teamName}")return displayedTeamLogoPath();
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
 const season=Number(state.seasonNumber||1);
 const leagueNames=["Нижняя лига","Верхняя лига"];
 const ownId=getUserTeam()?.id;
 const viewedLeague=leagueNames.includes(state.seasonCalendarLeague)?state.seasonCalendarLeague:(getUserTeam()?.league||"Нижняя лига");
 const round=officialRoundForDay(Number(state.gameDay)||1,viewedLeague);
 const header=document.createElement("section");header.className="panel calendar-panel";
 const heading=document.createElement("div");heading.className="section-title";heading.append(safeText("p",calendarDateText(),"eyebrow"),safeText("h2","Календарь сезона "+season));
 const leagueToggle=document.createElement("div");leagueToggle.className="tournament-league-toggle";
 leagueNames.forEach(name=>{const b=matchButton(name.toUpperCase(),()=>{state.seasonCalendarLeague=name;saveState();openPage("seasonCalendar")},"secondary");b.classList.toggle("active",name===viewedLeague);leagueToggle.append(b)});
 heading.append(leagueToggle);
 header.append(heading,safeText("p","Нажми на день тура, чтобы посмотреть все матчи этого тура. Дни матчей отмечены зелёным.","muted"));
 const roundPanel=document.createElement("div");roundPanel.className="tournament-selected-round";const days=document.createElement("div");days.className="season-calendar-grid";
 let selectedRound=round||0;
 const showRound=(r,day=Number(state.gameDay)||1)=>{selectedRound=r;roundPanel.replaceChildren();if(!r){let event="В этот день нет запланированного матча лиги.";if(CUP_QUARTERFINAL_DAYS.includes(day))event="Кубок «Достаток»: четвертьфинальный матч.";else if(CUP_SEMIFINAL_DAYS.includes(day))event="Кубок «Достаток»: полуфинальный матч.";else if(day===CUP_FINAL_DAY)event="Кубок «Достаток»: финал.";else if(CUP_FRIENDLY_DAYS.includes(day))event="Товарищеские матчи команд, не участвующих в кубке.";else if(END_SEASON_FRIENDLIES[day])event="Товарищеские матчи: "+END_SEASON_FRIENDLIES[day][0]+" — "+END_SEASON_FRIENDLIES[day][1]+".";else if(day===182)event="Завершение сезона. Следующий сезон начнётся с дня 1.";roundPanel.append(safeText("h3","День "+day),safeText("p",event,"muted"));return}roundPanel.append(safeText("h3","Тур "+r+" · День "+officialRoundDay(r,viewedLeague)));getOfficialRoundFixtures(r,viewedLeague).forEach(f=>roundPanel.append(tournamentMatchRow(r,f,state.leagueResults?.[roundFixtureKey(r,f)]||null,f.home.id===ownId||f.away.id===ownId)));};
 for(let day=1;day<=182;day++){
  const r=officialRoundForDay(day,viewedLeague),cupQuarter=CUP_QUARTERFINAL_DAYS.includes(day),cupSemi=CUP_SEMIFINAL_DAYS.includes(day),cupFinal=day===CUP_FINAL_DAY,cupFriendly=CUP_FRIENDLY_DAYS.includes(day),friendly=Boolean(END_SEASON_FRIENDLIES[day]),b=document.createElement("button");b.type="button";b.className="season-calendar-day"+(day===Number(state.gameDay)?" current":"")+(r?" match-day":"")+((cupQuarter||cupSemi||cupFinal||cupFriendly||friendly)?" cup-day":"")+(r&&r===selectedRound?" selected-round-day":"");
  b.append(safeText("b",String(day)));if(r)b.append(safeText("small","Тур "+r));else if(cupQuarter)b.append(safeText("small","Кубок · 1/4"));else if(cupSemi)b.append(safeText("small","Кубок · 1/2"));else if(cupFinal)b.append(safeText("small","Финал кубка"));else if(cupFriendly)b.append(safeText("small","Тов. матчи"));else if(friendly)b.append(safeText("small","Тов. матчи"));else if(day===182)b.append(safeText("small","Финиш"));
  b.addEventListener("click",()=>{days.querySelectorAll(".season-calendar-day").forEach(el=>el.classList.remove("selected-round-day"));b.classList.add("selected-round-day");showRound(r,day)});days.append(b)
 }
 header.append(days,roundPanel);wrap.append(header);showRound(selectedRound,Number(state.gameDay)||1);
 const back=matchButton("← К ТУРНИРАМ",()=>openPage("league"),"secondary");back.classList.add("calendar-back-button");wrap.append(back);
 return wrap
}
function renderOtherRoundMatches(){
 const wrap=document.createElement("div");wrap.className="tournament-other-matches-page";
 const viewedLeague=["Нижняя лига","Верхняя лига"].includes(state.tournamentViewLeague)?state.tournamentViewLeague:currentCoachLeague();
 const round=officialRoundForDay(Number(state.gameDay)||1,viewedLeague);
 const section=document.createElement("section");section.className="panel tournament-other-matches";
 const header=document.createElement("div");header.className="section-title";header.append(safeText("h2","Другие встречи · "+viewedLeague));
 const leagueToggle=document.createElement("div");leagueToggle.className="tournament-league-toggle";
 ["Нижняя лига","Верхняя лига"].forEach(name=>{const b=matchButton(name.toUpperCase(),()=>{state.tournamentViewLeague=name;saveState();openPage("otherRoundMatches")},"secondary");b.classList.toggle("active",name===viewedLeague);leagueToggle.append(b)});
 header.append(leagueToggle);section.append(header);
 for(let r=1;r<=20;r++){
  const details=document.createElement("details");details.className="tournament-round-details";details.open=r===round;
  const summary=document.createElement("summary");summary.textContent="Тур "+r+" · День "+officialRoundDay(r,viewedLeague);details.append(summary);
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
 const season=Number(state.seasonNumber||1),fixture=currentOfficialFixture();
 const ownId=getUserTeam()?.id;
 const leagueNames=["Нижняя лига","Верхняя лига"];
 const viewedLeague=leagueNames.includes(state.tournamentViewLeague)?state.tournamentViewLeague:currentCoachLeague();
 const round=officialRoundForDay(Number(state.gameDay)||1,viewedLeague),already=round&&fixture&&state.leagueResults?.[roundFixtureKey(round,fixture)];
 const allResults=Object.values(state.leagueResults||{}).filter(r=>Number(r.season||season)===season&&isCanonicalLeagueResult(r,viewedLeague));


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
  (m.playerRatings||m.ratings||[]).forEach(r=>{
   const name=r.playerName||r.name;
   const side=r.side==="home"||r.side==="away"?r.side:null;
   const team=r.teamId===home?.id?home:r.teamId===away?.id?away:side==="home"?home:side==="away"?away:null;
   if(!name||!team||!Number.isFinite(Number(r.rating)))return;
   const lineup=team.id===home?.id?lineups.home:lineups.away;
   const entry=lineup.find(x=>(x.player||x).name===name);
   const player=entry?.player||entry||{name};
   const rec=ensurePlayer(data.ratings,name,team,player);
   rec.stat+=Number(r.rating);rec.played++;
  });
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
 const showStats=i=>{body.replaceChildren();tabs.querySelectorAll("button").forEach((b,j)=>b.classList.toggle("active",i===j));const items=statDefs[i][1]();if(!items.length){body.append(safeText("p",i===2?"После завершённых матчей с сохранёнными оценками здесь появится рейтинг лучших игроков.":"Статистика появится после завершённых матчей.","muted"));return}items.slice(0,15).forEach(item=>body.append(renderStatRow(item,i===4?"coach":"player")))};
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
  const nation=document.createElement("div");nation.className="player-nationality";const flag=getFlag(p.nationality);if(flag){const f=document.createElement("img");f.src=flag;f.alt="";nation.append(f);}nation.append(safeText("span",p.nationality+" · "+p.position+(Number.isFinite(Number(p.age)) && Number(p.age)>0 ? " · "+Number(p.age)+" лет" : "")));
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
  setPageBackground("playerCard");
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
resumeSavedOfficialMatch();
if (state.gameDayStartedAt) { updateGameDayTimerUI(); gameDayTimerInterval=setInterval(updateGameDayTimerUI,250); }
if (leagueData) initializeCloudCareer();
else {
  const cloudInit = setInterval(() => {
    if (leagueData) { clearInterval(cloudInit); initializeCloudCareer(); }
  }, 250);
  setTimeout(() => clearInterval(cloudInit), 10000);
}