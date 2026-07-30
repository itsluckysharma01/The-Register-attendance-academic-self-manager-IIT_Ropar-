const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const ATTENDANCE_SLOTS = {
  morning: { label: "Morning", start: "08:00", end: "12:30" },
  evening: { label: "Evening", start: "16:00", end: "21:30" },
};

function todayISO(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function formatTime(d){ return d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}); }
function formatDatePretty(iso){ const d = new Date(iso+"T00:00:00"); return d.toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"}); }
function minutesFromHHMM(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours * 60) + minutes;
}
function currentMinutes(d = new Date()) {
  return (d.getHours() * 60) + d.getMinutes();
}
function isSlotOpen(slot, d = new Date()) {
  const window = ATTENDANCE_SLOTS[slot];
  const now = currentMinutes(d);
  return now >= minutesFromHHMM(window.start) && now <= minutesFromHHMM(window.end);
}
function getSlotTime(entry, slot) {
  if (!entry) return "";
  if (slot === "morning") return entry.morning_time || entry.time || "";
  return entry.evening_time || "";
}
function isAttendanceComplete(entry) {
  return Boolean(getSlotTime(entry, "morning") && getSlotTime(entry, "evening"));
}
function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}
function normalizeScheduleEntry(entry) {
  return {
    id: entry.id,
    className: entry.class_name,
    room: entry.room,
    day: entry.day,
    date: entry.date || "",
    startTime: entry.start_time,
    endTime: entry.end_time,
  };
}

const state = {
  token: localStorage.getItem("register_token") || null,
  email: localStorage.getItem("register_email") || null,
  view: "loading", // loading | login | signup | app
  authError: "",
  tab: "dashboard",
  banner: null,
  stamping: false,
  attendance: [],
  todos: [],
  classes: [],
  newTodo: { title: "", category: "Class", dueDate: "" },
  classForm: { id: null, className: "", room: "", day: DAY_NAMES[new Date().getDay()], date: "", startTime: "", endTime: "" },
  pushStatus: "unknown", // unknown | unsupported | default | granted | subscribed | denied
};

// ---------- API helper ----------
async function api(path, options = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
  if (state.token) headers["Authorization"] = `Bearer ${state.token}`;
  const res = await fetch(path, Object.assign({}, options, { headers }));
  let body = null;
  try { body = await res.json(); } catch (e) {}
  if (!res.ok) {
    const err = new Error((body && body.error) || "Something went wrong.");
    err.status = res.status;
    throw err;
  }
  return body;
}

function logout() {
  state.token = null;
  state.email = null;
  localStorage.removeItem("register_token");
  localStorage.removeItem("register_email");
  state.view = "login";
  state.authError = "";
  render();
}

async function handleLogin(email, password) {
  state.authError = "";
  try {
    const res = await api("/api/login", { method: "POST", body: JSON.stringify({ email, password }) });
    state.token = res.token;
    state.email = res.email;
    localStorage.setItem("register_token", res.token);
    localStorage.setItem("register_email", res.email);
    await enterApp();
  } catch (e) {
    state.authError = e.message;
    render();
  }
}

async function handleSignup(email, password) {
  state.authError = "";
  try {
    const res = await api("/api/signup", { method: "POST", body: JSON.stringify({ email, password }) });
    state.token = res.token;
    state.email = res.email;
    localStorage.setItem("register_token", res.token);
    localStorage.setItem("register_email", res.email);
    await enterApp();
  } catch (e) {
    state.authError = e.message;
    render();
  }
}

async function enterApp() {
  state.view = "app";
  await loadData();
  await setupPush();
  checkReminderBanner();
  render();
  setInterval(checkReminderBanner, 60000);
}

async function loadData() {
  try {
    const [attendance, todos, classes] = await Promise.all([api("/api/attendance"), api("/api/todos"), api("/api/classes")]);
    state.attendance = attendance;
    state.todos = todos.map((t) => ({ ...t, dueDate: t.due_date }));
    state.classes = classes.map(normalizeScheduleEntry);
  } catch (e) {
    if (e.status === 401) logout();
  }
}

// ---------- attendance actions ----------
async function markAttendance(slot) {
  const today = todayISO();
  if (!ATTENDANCE_SLOTS[slot]) return;
  if (!isSlotOpen(slot)) {
    const window = ATTENDANCE_SLOTS[slot];
    alert(`${window.label} attendance can be marked from ${window.start} to ${window.end}.`);
    return;
  }
  if (getSlotTime(state.attendance.find((a) => a.date === today), slot)) return;
  const now = new Date();
  try {
    const entry = await api("/api/attendance", {
      method: "POST",
      body: JSON.stringify({ date: today, day: DAY_NAMES[now.getDay()], time: formatTime(now), slot }),
    });
    const existingIndex = state.attendance.findIndex((a) => a.date === today);
    if (existingIndex >= 0) state.attendance[existingIndex] = entry;
    else state.attendance.unshift(entry);
    state.stamping = true;
    state.banner = null;
    render();
    setTimeout(() => { state.stamping = false; render(); }, 900);
  } catch (e) {
    alert(e.message);
  }
}

async function deleteAttendance(id) {
  await api(`/api/attendance/${id}`, { method: "DELETE" });
  state.attendance = state.attendance.filter((a) => a.id !== id);
  render();
}

// ---------- todo actions ----------
async function addTodo() {
  if (!state.newTodo.title.trim()) return;
  const res = await api("/api/todos", {
    method: "POST",
    body: JSON.stringify({
      title: state.newTodo.title.trim(),
      category: state.newTodo.category,
      dueDate: state.newTodo.dueDate || null,
    }),
  });
  state.todos.unshift({
    id: res.id,
    title: state.newTodo.title.trim(),
    category: state.newTodo.category,
    dueDate: state.newTodo.dueDate || null,
    status: "pending",
  });
  state.newTodo = { title: "", category: "Class", dueDate: "" };
  render();
}

async function toggleTodo(id) {
  const res = await api(`/api/todos/${id}`, { method: "PATCH" });
  const t = state.todos.find((t) => t.id === id);
  if (t) t.status = res.status;
  render();
}

async function deleteTodo(id) {
  await api(`/api/todos/${id}`, { method: "DELETE" });
  state.todos = state.todos.filter((t) => t.id !== id);
  render();
}

// ---------- class schedule actions ----------
function resetClassForm() {
  state.classForm = { id: null, className: "", room: "", day: DAY_NAMES[new Date().getDay()], date: "", startTime: "", endTime: "" };
}

async function saveClassSchedule() {
  const form = state.classForm;
  if (!form.className.trim() || !form.room.trim() || !form.day || !form.startTime || !form.endTime) {
    alert("Please add class name, room, day, start time, and end time.");
    return;
  }
  const payload = {
    className: form.className.trim(),
    room: form.room.trim(),
    day: form.day,
    date: form.date || null,
    startTime: form.startTime,
    endTime: form.endTime,
  };
  const path = form.id ? `/api/classes/${form.id}` : "/api/classes";
  const method = form.id ? "PUT" : "POST";
  const entry = await api(path, { method, body: JSON.stringify(payload) });
  const normalized = normalizeScheduleEntry(entry);
  if (form.id) {
    state.classes = state.classes.map((item) => item.id === form.id ? normalized : item);
  } else {
    state.classes.push(normalized);
  }
  resetClassForm();
  render();
}

function editClassSchedule(id) {
  const entry = state.classes.find((item) => item.id === id);
  if (!entry) return;
  state.classForm = { ...entry };
  render();
}

function cancelClassEdit() {
  resetClassForm();
  render();
}

async function deleteClassSchedule(id) {
  await api(`/api/classes/${id}`, { method: "DELETE" });
  state.classes = state.classes.filter((item) => item.id !== id);
  if (state.classForm.id === id) resetClassForm();
  render();
}

// ---------- push subscription ----------
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function setupPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    state.pushStatus = "unsupported";
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;
    if (Notification.permission === "denied") {
      state.pushStatus = "denied";
      return;
    }
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      state.pushStatus = "subscribed";
      return;
    }
    state.pushStatus = Notification.permission === "granted" ? "granted" : "default";
  } catch (e) {
    state.pushStatus = "unsupported";
  }
}

async function enablePush() {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      state.pushStatus = permission === "denied" ? "denied" : "default";
      render();
      return;
    }
    const { key } = await api("/api/push/vapid-public-key");
    if (!key) {
      alert("Push notifications aren't configured on the server yet (missing VAPID keys).");
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
    await api("/api/push/subscribe", { method: "POST", body: JSON.stringify(sub) });
    state.pushStatus = "subscribed";
  } catch (e) {
    console.error(e);
    alert("Couldn't turn on notifications: " + e.message);
  }
  render();
}

// ---------- in-app reminder banner (works while the page is open) ----------
function checkReminderBanner() {
  const today = todayISO();
  const entry = state.attendance.find((a) => a.date === today);
  state.banner = null;
  if (isSlotOpen("morning") && !getSlotTime(entry, "morning")) {
    state.banner = { level: "morning", slot: "morning", text: "Morning attendance is not marked yet." };
  } else if (isSlotOpen("evening") && !getSlotTime(entry, "evening")) {
    state.banner = { level: "evening", slot: "evening", text: "Evening attendance is not marked yet." };
  } else if (entry && !isAttendanceComplete(entry)) {
    state.banner = { level: "pending", text: "One attendance slot is still not marked for today." };
  }
  render();
}

// ---------- rendering ----------
function setTab(t) { state.tab = t; render(); }
function switchView(v) { state.view = v; state.authError = ""; render(); }

function render() {
  const app = document.getElementById("app");
  if (state.view === "loading") { app.innerHTML = `<p style="color:var(--ar-muted); text-align:center; margin-top:4rem;">Loading…</p>`; return; }
  if (state.view === "login") return renderAuth("login");
  if (state.view === "signup") return renderAuth("signup");
  renderApp();
}

function renderAuth(mode) {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="auth-shell">
      <h1 class="title ar-serif" style="text-align:center; margin-bottom:6px;">The register</h1>
      <p class="subtitle" style="text-align:center; margin-bottom:24px;">${mode === "login" ? "Log in to your account" : "Create your account"}</p>
      <div class="auth-card">
        ${state.authError ? `<p class="auth-error">${state.authError}</p>` : ""}
        <div class="auth-field">
          <label>Email</label>
          <input class="ar-input" type="email" id="authEmail" placeholder="you@example.com" />
        </div>
        <div class="auth-field">
          <label>Password</label>
          <input class="ar-input" type="password" id="authPassword" placeholder="At least 6 characters" />
        </div>
        <button class="ar-btn ar-btn-accent" style="width:100%" id="authSubmit">${mode === "login" ? "Log in" : "Sign up"}</button>
        <p class="auth-switch">
          ${mode === "login" ? `New here? <a id="toSignup">Create an account</a>` : `Already have an account? <a id="toLogin">Log in</a>`}
        </p>
      </div>
    </div>
  `;
  document.getElementById("authSubmit").onclick = () => {
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;
    if (mode === "login") handleLogin(email, password); else handleSignup(email, password);
  };
  const enterKeyHandler = (e) => { if (e.key === "Enter") document.getElementById("authSubmit").click(); };
  document.getElementById("authEmail").addEventListener("keydown", enterKeyHandler);
  document.getElementById("authPassword").addEventListener("keydown", enterKeyHandler);
  if (mode === "login") document.getElementById("toSignup").onclick = () => switchView("signup");
  else document.getElementById("toLogin").onclick = () => switchView("login");
}

function renderApp() {
  const app = document.getElementById("app");
  const today = todayISO();
  const todaysEntry = state.attendance.find((a) => a.date === today);
  const sortedAttendance = [...state.attendance].sort((a, b) => (a.date < b.date ? 1 : -1));
  const thisMonth = today.slice(0, 7);
  const monthEntries = state.attendance.filter((a) => a.date.startsWith(thisMonth));

  let streak = 0;
  { let cursor = new Date(); if (!isAttendanceComplete(todaysEntry)) cursor.setDate(cursor.getDate() - 1);
    while (true) { const iso = todayISO(cursor); const entry = state.attendance.find((a) => a.date === iso); if (!isAttendanceComplete(entry)) break; streak++; cursor.setDate(cursor.getDate() - 1); } }

  const pendingTodos = state.todos.filter((t) => t.status === "pending" && (!t.dueDate || t.dueDate >= today));
  const overdueTodos = state.todos.filter((t) => t.status === "pending" && t.dueDate && t.dueDate < today);
  const completedTodos = state.todos.filter((t) => t.status === "completed");
  const upcoming = [...pendingTodos].sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999")).slice(0, 4);
  const todayName = DAY_NAMES[new Date().getDay()];
  const sortedClasses = [...state.classes].sort((a, b) => {
    const dayCompare = DAY_NAMES.indexOf(a.day) - DAY_NAMES.indexOf(b.day);
    if (dayCompare !== 0) return dayCompare;
    return (a.startTime || "").localeCompare(b.startTime || "");
  });
  const todaysClasses = sortedClasses.filter((entry) => entry.date === today || (!entry.date && entry.day === todayName));

  let html = `
    <div class="header-row">
      <div>
        <h1 class="title ar-serif">The register</h1>
        <p class="subtitle">${DAY_NAMES[new Date().getDay()]}, ${formatDatePretty(today)} · ${state.email}</p>
      </div>
      <div class="tabs">
        <button class="ar-tab ${state.tab==='dashboard'?'active':''}" onclick="setTab('dashboard')">Dashboard</button>
        <button class="ar-tab ${state.tab==='log'?'active':''}" onclick="setTab('log')">Attendance log</button>
        <button class="ar-tab ${state.tab==='schedule'?'active':''}" onclick="setTab('schedule')">Schedule</button>
        <button class="ar-tab" onclick="logout()">Log out</button>
      </div>
    </div>
  `;

  if (state.banner) {
    const isEvening = state.banner.level === "evening";
    html += `
      <div class="ar-card banner" style="border-color:${isEvening?'var(--ar-danger)':'var(--ar-accent)'}; background:${isEvening?'var(--ar-danger-bg)':'var(--ar-surface)'}">
        <span style="font-size:14px">${state.banner.text}</span>
        ${state.banner.slot ? `<button class="ar-btn ar-btn-accent" onclick="markAttendance('${state.banner.slot}')">Mark now</button>` : ""}
      </div>`;
  }

  if (state.pushStatus === "granted" || state.pushStatus === "default") {
    html += `
      <div class="ar-card banner">
        <span style="font-size:13px; color:var(--ar-muted)">Turn on background reminders for the morning and evening attendance windows.</span>
        <button class="ar-btn" onclick="enablePush()">Enable</button>
      </div>`;
  } else if (state.pushStatus === "denied") {
    html += `
      <div class="ar-card banner">
        <span style="font-size:13px; color:var(--ar-muted)">Notifications are blocked in your browser settings. Allow them for this site to get background reminders.</span>
      </div>`;
  }

  if (state.tab === "dashboard") {
    const morningTime = getSlotTime(todaysEntry, "morning");
    const eveningTime = getSlotTime(todaysEntry, "evening");
    html += `
      <div class="ar-card attendance-card">
        <div class="attendance-heading">
          <p style="color:var(--ar-muted); font-size:13px; margin:0; text-transform:uppercase; letter-spacing:0.06em;">Today's attendance</p>
          <span class="attendance-summary ${isAttendanceComplete(todaysEntry) ? "complete" : "missing"}">
            ${isAttendanceComplete(todaysEntry) ? "Both marked" : "Attendance pending"}
          </span>
        </div>
        <div class="attendance-slots">
          ${attendanceSlotCard("morning", morningTime)}
          ${attendanceSlotCard("evening", eveningTime)}
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card"><p class="stat-label">Current streak</p><p class="stat-value ar-serif">${streak} ${streak===1?'day':'days'}</p></div>
        <div class="stat-card"><p class="stat-label">This month</p><p class="stat-value ar-serif">${monthEntries.length} days</p></div>
        <div class="stat-card"><p class="stat-label">Classes today</p><p class="stat-value ar-serif">${todaysClasses.length}</p></div>
        <div class="stat-card"><p class="stat-label">Pending tasks</p><p class="stat-value ar-serif">${pendingTodos.length}</p></div>
        <div class="stat-card"><p class="stat-label">Overdue</p><p class="stat-value ar-serif" style="color:${overdueTodos.length?'var(--ar-danger)':'var(--ar-ink)'}">${overdueTodos.length}</p></div>
      </div>

      <div class="ar-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h3 class="ar-serif" style="font-size:16px; margin:0;">Today's classes</h3>
          <button class="ar-tab" style="color:var(--ar-accent)" onclick="setTab('schedule')">Edit schedule</button>
        </div>
        ${todaysClasses.length===0 ? `<p style="color:var(--ar-muted); font-size:13px; margin:0;">No class schedule saved for today.</p>` :
          todaysClasses.map(classRow).join("")}
      </div>

      <div class="ar-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h3 class="ar-serif" style="font-size:16px; margin:0;">Upcoming</h3>
          <button class="ar-tab" style="color:var(--ar-accent)" onclick="setTab('schedule')">View schedule →</button>
        </div>
        ${upcoming.length===0 ? `<p style="color:var(--ar-muted); font-size:13px; margin:0;">Nothing scheduled. Add a task in the Schedule tab.</p>` :
          upcoming.map((t) => `
            <div class="row-item">
              <span>${t.title} <span style="color:var(--ar-muted); font-size:12px;">· ${t.category}</span></span>
              <span class="ar-mono" style="color:var(--ar-muted); font-size:12px;">${t.dueDate ? formatDatePretty(t.dueDate) : 'no date'}</span>
            </div>
          `).join("")}
      </div>
    `;
  }

  if (state.tab === "log") {
    html += `
      <div class="ar-card">
        <h3 class="ar-serif" style="font-size:16px; margin:0 0 14px;">Attendance history (${state.attendance.length} days)</h3>
        ${sortedAttendance.length===0 ? `<p style="color:var(--ar-muted); font-size:13px;">No attendance marked yet.</p>` :
          sortedAttendance.map((a) => `
            <div class="row-item">
              <div><span style="font-size:14px">${formatDatePretty(a.date)}</span><span style="color:var(--ar-muted); font-size:13px;"> · ${a.day}</span></div>
              <div style="display:flex; align-items:center; gap:14px;">
                <span class="attendance-log-time ${getSlotTime(a, "morning") ? "marked" : "missing"}">Morning: ${getSlotTime(a, "morning") || "Not marked"}</span>
                <span class="attendance-log-time ${getSlotTime(a, "evening") ? "marked" : "missing"}">Evening: ${getSlotTime(a, "evening") || "Not marked"}</span>
                <button class="muted-btn" onclick="deleteAttendance('${a.id}')">remove</button>
              </div>
            </div>
          `).join("")}
      </div>
    `;
  }

  if (state.tab === "schedule") {
    const form = state.classForm;
    html += `
      <div class="ar-card">
        <h3 class="ar-serif" style="font-size:16px; margin:0 0 12px;">${form.id ? "Modify class" : "Add class"}</h3>
        <div class="class-form">
          <input class="ar-input" id="className" placeholder="Class name" value="${escapeHtml(form.className)}" />
          <input class="ar-input" id="classRoom" placeholder="Classroom / room" value="${escapeHtml(form.room)}" />
          <select class="ar-select" id="classDay">
            ${DAY_NAMES.map((day) => `<option ${form.day===day?'selected':''}>${day}</option>`).join("")}
          </select>
          <input type="date" class="ar-input" id="classDate" value="${escapeHtml(form.date)}" title="Optional one-day date" />
          <input type="time" class="ar-input" id="classStartTime" value="${escapeHtml(form.startTime)}" />
          <input type="time" class="ar-input" id="classEndTime" value="${escapeHtml(form.endTime)}" />
          <div class="class-form-actions">
            <button class="ar-btn ar-btn-accent" onclick="submitClassSchedule()">${form.id ? "Save changes" : "Add class"}</button>
            ${form.id ? `<button class="ar-btn" onclick="cancelClassEdit()">Cancel</button>` : ""}
          </div>
        </div>
      </div>

      <div class="ar-card">
        <h3 class="ar-serif" style="font-size:16px; margin:0 0 12px;">Class timetable (${sortedClasses.length})</h3>
        ${sortedClasses.length===0 ? `<p style="color:var(--ar-muted); font-size:13px; margin:0;">No classes added yet.</p>` :
          sortedClasses.map((entry) => classRow(entry, true)).join("")}
      </div>

      <div class="ar-card">
        <h3 class="ar-serif" style="font-size:16px; margin:0 0 12px;">Add a task</h3>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <input class="ar-input" id="newTodoTitle" style="flex:2 1 200px" placeholder="e.g. Submit ML assignment" value="${state.newTodo.title}" />
          <select class="ar-select" id="newTodoCategory" style="flex:1 1 120px">
            ${["Class","Assignment","Exam","Project","Other"].map((c) => `<option ${state.newTodo.category===c?'selected':''}>${c}</option>`).join("")}
          </select>
          <input type="date" class="ar-input" id="newTodoDue" style="flex:1 1 150px" value="${state.newTodo.dueDate}" />
          <button class="ar-btn ar-btn-accent" onclick="submitNewTodo()">Add</button>
        </div>
      </div>
      ${todoSection("Overdue", overdueTodos, "var(--ar-danger)")}
      ${todoSection("Pending", pendingTodos, "var(--ar-ink)")}
      ${todoSection("Completed", completedTodos, "var(--ar-muted)")}
    `;
  }

  app.innerHTML = html;

  if (state.tab === "schedule") {
    const titleInput = document.getElementById("newTodoTitle");
    titleInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitNewTodo(); });
    const classFieldMap = {
      className: "className",
      classRoom: "room",
      classDay: "day",
      classDate: "date",
      classStartTime: "startTime",
      classEndTime: "endTime",
    };
    Object.keys(classFieldMap).forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", () => { state.classForm[classFieldMap[id]] = el.value; });
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") submitClassSchedule(); });
    });
  }
}

function classRow(entry, withActions = false) {
  return `
    <div class="row-item class-row">
      <div class="class-main">
        <span class="class-name">${escapeHtml(entry.className)}</span>
        <span class="class-meta">${escapeHtml(entry.day)}${entry.date ? ` · ${formatDatePretty(entry.date)}` : ""}</span>
      </div>
      <div class="class-side">
        <span class="room-pill">${escapeHtml(entry.room)}</span>
        <span class="ar-mono class-time">${escapeHtml(entry.startTime)} - ${escapeHtml(entry.endTime)}</span>
        ${withActions ? `
          <button class="muted-btn" onclick="editClassSchedule('${entry.id}')">edit</button>
          <button class="muted-btn" onclick="deleteClassSchedule('${entry.id}')">delete</button>
        ` : ""}
      </div>
    </div>
  `;
}

function todoSection(title, items, color) {
  return `
    <div class="ar-card">
      <h3 class="ar-serif" style="font-size:16px; margin:0 0 12px; color:${color}">${title} (${items.length})</h3>
      ${items.length===0 ? `<p style="color:var(--ar-muted); font-size:13px; margin:0;">Nothing here.</p>` :
        items.map((t) => `
          <div class="row-item" style="opacity:${t.status==='completed'?0.55:1}">
            <div style="display:flex; align-items:center; gap:10px;">
              <input type="checkbox" ${t.status==='completed'?'checked':''} onchange="toggleTodo('${t.id}')" />
              <div>
                <span style="font-size:14px; text-decoration:${t.status==='completed'?'line-through':'none'}">${t.title}</span>
                <span style="color:var(--ar-muted); font-size:12px;"> · ${t.category}</span>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:12px;">
              ${t.dueDate ? `<span class="ar-mono" style="font-size:12px; color:var(--ar-muted);">${formatDatePretty(t.dueDate)}</span>` : ""}
              <button class="muted-btn" onclick="deleteTodo('${t.id}')">delete</button>
            </div>
          </div>
        `).join("")}
    </div>
  `;
}

function submitNewTodo() {
  state.newTodo.title = document.getElementById("newTodoTitle").value;
  state.newTodo.category = document.getElementById("newTodoCategory").value;
  state.newTodo.dueDate = document.getElementById("newTodoDue").value;
  addTodo();
}

function submitClassSchedule() {
  state.classForm.className = document.getElementById("className").value;
  state.classForm.room = document.getElementById("classRoom").value;
  state.classForm.day = document.getElementById("classDay").value;
  state.classForm.date = document.getElementById("classDate").value;
  state.classForm.startTime = document.getElementById("classStartTime").value;
  state.classForm.endTime = document.getElementById("classEndTime").value;
  saveClassSchedule();
}

function attendanceSlotCard(slot, markedTime) {
  const window = ATTENDANCE_SLOTS[slot];
  const open = isSlotOpen(slot);
  const statusText = markedTime ? `Marked at ${markedTime}` : open ? "Ready to mark" : `Open ${window.start} - ${window.end}`;
  return `
    <div class="attendance-slot ${markedTime ? "marked" : "missing"} ${state.stamping && markedTime ? "stamp-pop" : ""}">
      <div>
        <span class="attendance-slot-label">${window.label}</span>
        <span class="attendance-slot-window">${window.start} - ${window.end}</span>
      </div>
      <strong class="ar-mono">${markedTime || "Not marked"}</strong>
      <span class="attendance-slot-status">${statusText}</span>
      ${markedTime
        ? `<span class="attendance-done">Marked</span>`
        : `<button class="ar-btn ar-btn-accent" ${open ? "" : "disabled"} onclick="markAttendance('${slot}')">Mark ${window.label}</button>`}
    </div>
  `;
}

// ---------- boot ----------
(async function boot() {
  if (state.token) {
    try {
      await api("/api/me");
      await enterApp();
      return;
    } catch (e) {
      logout();
      return;
    }
  }
  state.view = "login";
  render();
})();
