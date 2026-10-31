(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const toggle = $("fullscreenToggle");
  if (toggle) {
    const updateFullscreenLabel = () => {
      const active = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
      toggle.setAttribute("aria-pressed", String(active));
      toggle.textContent = active ? "⤢ ВЫЙТИ ИЗ ПОЛНОГО ЭКРАНА" : "⛶ НА ВЕСЬ ЭКРАН";
      toggle.title = active ? "Выйти из полноэкранного режима" : "Развернуть игру на весь экран";
    };
    toggle.addEventListener("click", async () => {
      try {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          if (document.exitFullscreen) await document.exitFullscreen();
          else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        } else {
          const root = document.documentElement;
          if (root.requestFullscreen) await root.requestFullscreen();
          else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
          else throw new Error("Полноэкранный режим не поддерживается этим браузером.");
        }
      } catch (error) {
        console.warn("Fullscreen error:", error);
        alert("Не удалось включить полноэкранный режим. Попробуй открыть игру в обычной вкладке браузера.");
      }
      updateFullscreenLabel();
    });
    document.addEventListener("fullscreenchange", updateFullscreenLabel);
    document.addEventListener("webkitfullscreenchange", updateFullscreenLabel);
    updateFullscreenLabel();
  }

  const collapseButton = $("chatCollapseToggle");
  const chatPanel = $("homeChatPanel");
  const chatBody = $("chatPanelBody");
  if (collapseButton && chatPanel && chatBody) {
    collapseButton.addEventListener("click", () => {
      const collapsed = chatPanel.classList.toggle("is-collapsed");
      collapseButton.setAttribute("aria-expanded", String(!collapsed));
      collapseButton.setAttribute("aria-label", collapsed ? "Развернуть чат" : "Свернуть чат");
      collapseButton.textContent = collapsed ? "+" : "−";
    });
  }

  const form = $("coachChatForm");
  if (!form) return;
  const messages = $("coachChatMessages");
  const status = $("coachChatStatus");
  const input = $("coachChatInput");
  const send = $("coachChatSend");
  const URL = "https://qfkekaipmbtzxtuspjqv.supabase.co";
  const KEY = "sb_publishable_uEoHSnOBVXtlJm--cZF_IQ_IRXmG55x";
  let client = null;
  let loading = false;
  let lastSend = 0;

  const setStatus = (value) => { if (status) status.textContent = value; };
  const textEl = (tag, value, className) => {
    const node = document.createElement(tag);
    node.textContent = value == null ? "" : String(value);
    if (className) node.className = className;
    return node;
  };
  const timeText = (value) => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return date.toLocaleTimeString("ru-RU", {hour:"2-digit", minute:"2-digit"});
  };
  const renderMessages = (rows) => {
    const wasBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 60;
    messages.replaceChildren();
    if (!rows.length) {
      messages.append(textEl("p", "Пока сообщений нет. Начни разговор!", "muted"));
      return;
    }
    rows.slice().reverse().forEach((row) => {
      const item = document.createElement("article");
      item.className = "coach-chat-message";
      const head = document.createElement("div");
      head.className = "coach-chat-message-head";
      head.append(
        textEl("strong", (row.coach_name || "Тренер") + (row.team_name ? " · " + row.team_name : "")),
        textEl("time", timeText(row.created_at))
      );
      item.append(head, textEl("p", row.message));
      messages.append(item);
    });
    if (wasBottom) messages.scrollTop = messages.scrollHeight;
  };
  const ensureSession = async () => {
    const {data:{session},error:sessionError} = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (session?.access_token) return;
    const {error} = await client.auth.signInAnonymously();
    if (error) throw error;
  };
  const loadMessages = async (quiet = false) => {
    if (loading || !client) return;
    loading = true;
    try {
      const {data,error} = await client.from("coach_chat_messages")
        .select("id,coach_name,team_name,message,created_at")
        .order("id",{ascending:false}).limit(50);
      if (error) throw error;
      renderMessages(data || []);
      setStatus("● Онлайн · " + (data || []).length + " сообщений");
    } catch (error) {
      console.warn("Coach chat load error:", error);
      setStatus("Чат временно недоступен");
      if (!quiet && messages.childElementCount === 0) messages.replaceChildren(textEl("p","Не удалось загрузить чат. Попробуй обновить страницу.","muted"));
    } finally {
      loading = false;
    }
  };
  const init = async () => {
    if (!window.supabase?.createClient) {
      setStatus("Не загрузилась библиотека чата");
      return;
    }
    client = window.supabase.createClient(URL, KEY, { auth: { storageKey: "football-coach-chat-auth-token" } });
    try {
      await ensureSession();
      await loadMessages();
      window.setInterval(() => loadMessages(true), 5000);
    } catch (error) {
      console.warn("Coach chat init error:", error);
      setStatus("Не удалось подключиться к чату");
    }
  };
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = String(input.value || "").trim();
    if (!message || !client) return;
    if (message.length > 300) {
      setStatus("Максимум 300 символов");
      return;
    }
    const now = Date.now();
    if (now - lastSend < 2000) {
      setStatus("Подожди пару секунд перед следующим сообщением");
      return;
    }
    lastSend = now;
    send.disabled = true;
    try {
      await ensureSession();
      const coachName = String($("coachNameLabel")?.textContent || "Тренер").trim().slice(0,40);
      const teamName = String($("teamName")?.textContent || "Команда").trim().slice(0,60);
      const {error} = await client.from("coach_chat_messages").insert({
        coach_name: coachName || "Тренер",
        team_name: teamName || "Команда",
        message
      });
      if (error) throw error;
      input.value = "";
      await loadMessages();
      setStatus("Сообщение отправлено");
    } catch (error) {
      console.warn("Coach chat send error:", error);
      setStatus("Не удалось отправить сообщение");
    } finally {
      send.disabled = false;
    }
  });
  init();
})();
