(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const STORAGE_KEYS = {
    todos: "tmp_todos_v1",
    sessions: "tmp_pomodoro_sessions_v1",
  };

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function formatMMSS(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${pad2(mm)}:${pad2(ss)}`;
  }

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function load(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return safeJsonParse(raw, fallback);
  }

  function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function uid() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  // ====== 顶部日期 ======
  const todayLabel = $("#todayLabel");
  if (todayLabel) {
    const d = new Date();
    const text = d.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    });
    todayLabel.textContent = text;
  }

  // ====== 番茄钟 ======
  const POMODORO_SECONDS = 25 * 60;
  const RING_CIRCUMFERENCE = 2 * Math.PI * 52; // r=52，与 CSS 保持一致

  const timeText = $("#timeText");
  const timerStatus = $("#timerStatus");
  const startPauseBtn = $("#startPauseBtn");
  const resetBtn = $("#resetBtn");
  const sessionCountEl = $("#sessionCount");
  const ringProgress = document.querySelector(".ring-progress");

  const persistedSessions = load(STORAGE_KEYS.sessions, 0);
  let sessionCount = Number.isFinite(persistedSessions) ? persistedSessions : 0;

  let remainingSeconds = POMODORO_SECONDS;
  let isRunning = false;
  let rafId = null;
  let endAtMs = null;
  let lastWholeSecond = null;

  function setStatus(text) {
    if (timerStatus) timerStatus.textContent = text;
  }

  function setPrimaryButtonText() {
    if (!startPauseBtn) return;
    startPauseBtn.textContent = isRunning ? "暂停" : remainingSeconds === POMODORO_SECONDS ? "开始" : "继续";
  }

  function renderSessionCount() {
    if (sessionCountEl) sessionCountEl.textContent = String(sessionCount);
  }

  function renderTime() {
    if (timeText) timeText.textContent = formatMMSS(remainingSeconds);
  }

  function renderRing() {
    if (!ringProgress) return;
    ringProgress.style.strokeDasharray = String(RING_CIRCUMFERENCE);
    const progress = 1 - remainingSeconds / POMODORO_SECONDS;
    const offset = RING_CIRCUMFERENCE * (1 - progress);
    ringProgress.style.strokeDashoffset = String(offset);
  }

  function renderAll() {
    renderTime();
    renderRing();
    setPrimaryButtonText();
    renderSessionCount();
  }

  function ensureNotificationPermission() {
    try {
      if (!("Notification" in window)) return;
      if (Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    } catch {
      // ignore
    }
  }

  function showCompletionUI() {
    // In-page toast with CTA
    let host = document.querySelector(".toast-host");
    if (!host) {
      host = document.createElement("div");
      host.className = "toast-host";
      document.body.appendChild(host);
    }

    const toast = document.createElement("div");
    toast.className = "completion-toast";
    toast.innerHTML = `
      <div class="completion-toast-header">
        <div class="completion-toast-title">本轮专注完成 🎉</div>
      </div>
      <div class="completion-toast-body">
        很棒，已经坚持完 25 分钟专注。趁热打铁，是否开启下一个任务？
      </div>
      <div class="completion-toast-actions">
        <div class="completion-toast-meta">小提示：先写下下一件最重要的事。</div>
        <div style="display:flex;gap:6px;">
          <button type="button" class="btn completion-toast-close">稍后</button>
          <button type="button" class="btn primary completion-toast-next">开启下一个任务</button>
        </div>
      </div>
    `;

    const close = () => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(4px)";
      setTimeout(() => toast.remove(), 140);
    };

    toast.querySelector(".completion-toast-close")?.addEventListener("click", close);
    toast.querySelector(".completion-toast-next")?.addEventListener("click", () => {
      // reset and immediately start next focus session
      reset();
      start();
      const input = document.querySelector("#todoInput");
      if (input instanceof HTMLInputElement) {
        input.focus();
      }
      close();
    });

    host.appendChild(toast);
  }

  function tick() {
    if (!isRunning || endAtMs == null) return;

    const now = Date.now();
    const msLeft = endAtMs - now;
    const nextRemaining = Math.max(0, Math.ceil(msLeft / 1000));

    if (lastWholeSecond !== nextRemaining) {
      remainingSeconds = nextRemaining;
      lastWholeSecond = nextRemaining;
      renderAll();
    }

    if (msLeft <= 0) {
      finish();
      return;
    }

    rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (isRunning) return;
    isRunning = true;
    setStatus("专注中…");
    endAtMs = Date.now() + remainingSeconds * 1000;
    lastWholeSecond = null;
    setPrimaryButtonText();
    rafId = requestAnimationFrame(tick);
  }

  function pause() {
    if (!isRunning) return;
    isRunning = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;

    if (endAtMs != null) {
      const msLeft = endAtMs - Date.now();
      remainingSeconds = Math.max(0, Math.ceil(msLeft / 1000));
      endAtMs = null;
    }

    setStatus("已暂停");
    renderAll();
  }

  function reset() {
    isRunning = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    endAtMs = null;
    remainingSeconds = POMODORO_SECONDS;
    lastWholeSecond = null;
    setStatus("准备开始");
    renderAll();
  }

  function finish() {
    isRunning = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    endAtMs = null;
    remainingSeconds = 0;
    lastWholeSecond = null;

    sessionCount += 1;
    save(STORAGE_KEYS.sessions, sessionCount);

    setStatus("完成！休息一下吧。");
    renderAll();

    try {
      if ("Notification" in window) {
        const body =
          "本轮 25 分钟专注已结束，做得很棒！可以稍微活动一下，然后挑选下一件最重要的事继续冲刺。";
        if (Notification.permission === "granted") {
          const n = new Notification("🎯 专注完成 · 准备下一轮？", {
            body,
            tag: "pomodoro-finished",
            renotify: true,
          });
          n.onclick = () => {
            window.focus();
          };
        } else if (Notification.permission === "default") {
          Notification.requestPermission().catch(() => {});
        }
      }
    } catch {
      // 忽略通知错误
    }

    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.value = 0.0001;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
      o.stop(ctx.currentTime + 0.62);
      o.onended = () => ctx.close().catch(() => {});
    } catch {
      // 忽略音频错误
    }

    showCompletionUI();
  }

  function toggleStartPause() {
    if (isRunning) pause();
    else start();
  }

  if (startPauseBtn) startPauseBtn.addEventListener("click", toggleStartPause);
  if (resetBtn) resetBtn.addEventListener("click", reset);

  document.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    const isTyping = tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable;
    if (isTyping) return;

    if (e.code === "Space") {
      e.preventDefault();
      toggleStartPause();
      return;
    }
    if (e.key?.toLowerCase() === "r") {
      e.preventDefault();
      reset();
    }
  });

  // 提前请求通知权限（在用户首次开始专注时）
  if (startPauseBtn) {
    startPauseBtn.addEventListener("click", ensureNotificationPermission, { once: true });
  }

  // ====== 待办 ======
  const todoForm = $("#todoForm");
  const todoInput = $("#todoInput");
  const todoList = $("#todoList");
  const emptyState = $("#emptyState");
  const todoSummary = $("#todoSummary");
  const clearCompletedBtn = $("#clearCompletedBtn");
  const clearAllBtn = $("#clearAllBtn");

  // ====== 分享 / 二维码 ======
  const shareUrlInput = $("#shareUrl");
  const genQrBtn = $("#genQrBtn");
  const qrImg = $("#qrImg");
  const copyLinkBtn = $("#copyLinkBtn");
  const shareBtn = $("#shareBtn");
  const shareHint = $("#shareHint");

  function setShareHint(text) {
    if (!shareHint) return;
    shareHint.textContent = text;
  }

  function getDefaultShareUrl() {
    try {
      return window.location.href;
    } catch {
      return "";
    }
  }

  function normalizeUrl(raw) {
    const v = String(raw || "").trim();
    if (!v) return "";
    return v;
  }

  function isFileUrl(url) {
    return /^file:\/\//i.test(url);
  }

  function buildQrImageUrl(data) {
    // 纯前端方案：用公开的二维码图片生成接口（无需额外库）
    // 注意：二维码内容必须是“可被手机访问的链接”。file:// 本地路径无法被别人访问。
    const encoded = encodeURIComponent(data);
    return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=10&data=${encoded}`;
  }

  function generateQrFromInput() {
    const url = normalizeUrl(shareUrlInput?.value || "");
    const effectiveUrl = url || getDefaultShareUrl();
    if (shareUrlInput && !url) shareUrlInput.value = effectiveUrl;

    if (!qrImg) return;

    if (!effectiveUrl) {
      setShareHint("请输入一个链接");
      qrImg.removeAttribute("src");
      return;
    }

    if (isFileUrl(effectiveUrl)) {
      setShareHint("检测到 file:// 本地打开：别人扫码无法访问。请先部署或开启本机服务。");
    } else {
      setShareHint("二维码已生成，手机扫码即可打开");
    }

    qrImg.src = buildQrImageUrl(effectiveUrl);
  }

  async function copyShareLink() {
    const url = normalizeUrl(shareUrlInput?.value || "") || getDefaultShareUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setShareHint("已复制链接");
    } catch {
      // 兼容不支持 clipboard 的环境
      const ok = window.prompt("复制下面的链接（手动长按复制）：", url);
      if (ok != null) setShareHint("已打开复制框");
    }
  }

  async function shareOnMobile() {
    const url = normalizeUrl(shareUrlInput?.value || "") || getDefaultShareUrl();
    if (!url) return;
    if (!navigator.share) {
      setShareHint("当前浏览器不支持一键分享（可用“复制链接”）");
      return;
    }
    try {
      await navigator.share({
        title: "Time Manager",
        text: "来试试这个番茄钟 + 待办清单",
        url,
      });
      setShareHint("已调起系统分享");
    } catch {
      setShareHint("已取消分享");
    }
  }

  /** @type {{id:string,text:string,done:boolean,createdAt:number}[]} */
  let todos = load(STORAGE_KEYS.todos, []);
  if (!Array.isArray(todos)) todos = [];

  function persistTodos() {
    save(STORAGE_KEYS.todos, todos);
  }

  function updateEmptyState() {
    if (!emptyState) return;
    emptyState.hidden = todos.length !== 0;
  }

  function updateSummary() {
    if (!todoSummary) return;
    const done = todos.filter((t) => t.done).length;
    todoSummary.textContent = `${todos.length} 项 · 已完成 ${done}`;
  }

  function createTodoItemEl(todo) {
    const li = document.createElement("li");
    li.className = `todo-item${todo.done ? " done" : ""}`;
    li.dataset.id = todo.id;

    const checkBtn = document.createElement("button");
    checkBtn.type = "button";
    checkBtn.className = "check";
    checkBtn.setAttribute("aria-label", todo.done ? "标记为未完成" : "标记为已完成");
    checkBtn.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13.6 4.2a1 1 0 0 1 .1 1.4l-6.1 7a1 1 0 0 1-1.5.1L2.4 9a1 1 0 1 1 1.4-1.4l2.8 2.8 5.4-6.1a1 1 0 0 1 1.6-.1Z" fill="currentColor"/></svg>';

    const text = document.createElement("div");
    text.className = "todo-text";
    text.textContent = todo.text;
    text.title = todo.text;

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "delete";
    delBtn.setAttribute("aria-label", "删除任务");
    delBtn.textContent = "删除";

    checkBtn.addEventListener("click", () => {
      toggleTodo(todo.id);
    });
    delBtn.addEventListener("click", () => {
      deleteTodo(todo.id);
    });

    li.append(checkBtn, text, delBtn);
    return li;
  }

  function renderTodos() {
    if (!todoList) return;
    todoList.innerHTML = "";
    for (const t of todos) todoList.appendChild(createTodoItemEl(t));
    updateEmptyState();
    updateSummary();
  }

  function addTodo(text) {
    const trimmed = text.trim().replace(/\s+/g, " ");
    if (!trimmed) return;
    todos.unshift({ id: uid(), text: trimmed, done: false, createdAt: Date.now() });
    persistTodos();
    renderTodos();
  }

  function toggleTodo(id) {
    const t = todos.find((x) => x.id === id);
    if (!t) return;
    t.done = !t.done;
    persistTodos();
    renderTodos();
  }

  function deleteTodo(id) {
    todos = todos.filter((x) => x.id !== id);
    persistTodos();
    renderTodos();
  }

  function clearCompleted() {
    todos = todos.filter((x) => !x.done);
    persistTodos();
    renderTodos();
  }

  function clearAll() {
    todos = [];
    persistTodos();
    renderTodos();
  }

  if (todoForm) {
    todoForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!todoInput) return;
      addTodo(todoInput.value);
      todoInput.value = "";
      todoInput.focus();
    });
  }

  if (clearCompletedBtn) clearCompletedBtn.addEventListener("click", clearCompleted);
  if (clearAllBtn) clearAllBtn.addEventListener("click", clearAll);

  // 初始渲染
  renderAll();
  renderTodos();

  // 分享：初始化
  if (shareUrlInput) shareUrlInput.value = getDefaultShareUrl();
  if (genQrBtn) genQrBtn.addEventListener("click", generateQrFromInput);
  if (copyLinkBtn) copyLinkBtn.addEventListener("click", copyShareLink);
  if (shareBtn) shareBtn.addEventListener("click", shareOnMobile);
  if (shareUrlInput) {
    shareUrlInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        generateQrFromInput();
      }
    });
  }
  generateQrFromInput();
})();

