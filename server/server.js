require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const cron = require("node-cron");
const path = require("path");

const { createStore } = require("./db");
const { signToken, authMiddleware } = require("./auth");
const webpush = require("./push");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

let store;

// ---------- auth ----------

app.post("/api/signup", asyncRoute(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: "Enter a valid email and a password of at least 6 characters." });
  }
  const normalizedEmail = String(email).toLowerCase().trim();
  const existing = await store.getUserByEmail(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: "An account with that email already exists." });
  }
  const passwordHash = bcrypt.hashSync(password, 10);
  const user = await store.createUser({
    email: normalizedEmail,
    passwordHash,
    createdAt: new Date().toISOString(),
  });
  res.json({ token: signToken(user), email: user.email });
}));

app.post("/api/login", asyncRoute(async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = String(email || "").toLowerCase().trim();
  const user = await store.getUserByEmail(normalizedEmail);
  if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }
  res.json({ token: signToken(user), email: user.email });
}));

app.get("/api/me", authMiddleware, (req, res) => {
  res.json({ email: req.user.email });
});

// ---------- attendance ----------

app.get("/api/attendance", authMiddleware, asyncRoute(async (req, res) => {
  const rows = await store.listAttendance(req.user.id);
  res.json(rows);
}));

app.post("/api/attendance", authMiddleware, asyncRoute(async (req, res) => {
  const { date, day, time } = req.body || {};
  if (!date || !day || !time) {
    return res.status(400).json({ error: "Missing date, day, or time." });
  }
  const existing = await store.getAttendanceByDate(req.user.id, date);
  if (existing) {
    return res.status(409).json({ error: "Already marked for today." });
  }
  const id = `${date}-${Date.now()}`;
  const entry = await store.createAttendance({
    id,
    userId: req.user.id,
    date,
    day,
    time,
  });
  res.json(entry);
}));

app.delete("/api/attendance/:id", authMiddleware, asyncRoute(async (req, res) => {
  await store.deleteAttendance(req.params.id, req.user.id);
  res.json({ ok: true });
}));

// ---------- todos ----------

app.get("/api/todos", authMiddleware, asyncRoute(async (req, res) => {
  const rows = await store.listTodos(req.user.id);
  res.json(rows);
}));

app.post("/api/todos", authMiddleware, asyncRoute(async (req, res) => {
  const { title, category, dueDate } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: "Task needs a title." });
  }
  const id = `t-${Date.now()}`;
  await store.createTodo({
    id,
    userId: req.user.id,
    title: String(title).trim(),
    category: category || "Other",
    dueDate: dueDate || null,
    createdAt: new Date().toISOString(),
  });
  res.json({ id });
}));

app.patch("/api/todos/:id", authMiddleware, asyncRoute(async (req, res) => {
  const todo = await store.getTodo(req.params.id, req.user.id);
  if (!todo) return res.status(404).json({ error: "Task not found." });
  const nextStatus = todo.status === "completed" ? "pending" : "completed";
  await store.updateTodoStatus(todo.id, req.user.id, nextStatus);
  res.json({ status: nextStatus });
}));

app.delete("/api/todos/:id", authMiddleware, asyncRoute(async (req, res) => {
  await store.deleteTodo(req.params.id, req.user.id);
  res.json({ ok: true });
}));

// ---------- class schedule ----------

function normalizeClassScheduleInput(body) {
  const className = String(body.className || "").trim();
  const room = String(body.room || "").trim();
  const day = String(body.day || "").trim();
  const date = body.date ? String(body.date).trim() : "";
  const startTime = String(body.startTime || "").trim();
  const endTime = String(body.endTime || "").trim();
  return { className, room, day, date, startTime, endTime };
}

app.get("/api/classes", authMiddleware, asyncRoute(async (req, res) => {
  const rows = await store.listClassSchedules(req.user.id);
  res.json(rows);
}));

app.post("/api/classes", authMiddleware, asyncRoute(async (req, res) => {
  const schedule = normalizeClassScheduleInput(req.body || {});
  if (!schedule.className || !schedule.room || !schedule.day || !schedule.startTime || !schedule.endTime) {
    return res.status(400).json({ error: "Class name, room, day, start time, and end time are required." });
  }
  const now = new Date().toISOString();
  const entry = await store.createClassSchedule({
    id: `c-${Date.now()}`,
    userId: req.user.id,
    createdAt: now,
    updatedAt: now,
    ...schedule,
  });
  res.json(entry);
}));

app.put("/api/classes/:id", authMiddleware, asyncRoute(async (req, res) => {
  const schedule = normalizeClassScheduleInput(req.body || {});
  if (!schedule.className || !schedule.room || !schedule.day || !schedule.startTime || !schedule.endTime) {
    return res.status(400).json({ error: "Class name, room, day, start time, and end time are required." });
  }
  const entry = await store.updateClassSchedule(req.params.id, req.user.id, {
    class_name: schedule.className,
    room: schedule.room,
    day: schedule.day,
    date: schedule.date,
    start_time: schedule.startTime,
    end_time: schedule.endTime,
  });
  if (!entry) return res.status(404).json({ error: "Class not found." });
  res.json(entry);
}));

app.delete("/api/classes/:id", authMiddleware, asyncRoute(async (req, res) => {
  await store.deleteClassSchedule(req.params.id, req.user.id);
  res.json({ ok: true });
}));

// ---------- push notifications ----------

app.get("/api/push/vapid-public-key", (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || "" });
});

app.post("/api/push/subscribe", authMiddleware, asyncRoute(async (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: "Invalid subscription." });
  }
  await store.upsertPushSubscription(req.user.id, subscription.endpoint, subscription);
  res.json({ ok: true });
}));

app.post("/api/push/unsubscribe", authMiddleware, asyncRoute(async (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) {
    await store.deletePushSubscription(endpoint, req.user.id);
  }
  res.json({ ok: true });
}));

// ---------- reminder logic ----------

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function sendReminders(slot) {
  const today = todayISO();
  const users = await store.listUsers();
  const body =
    slot === "morning"
      ? "It's past 10 AM and today's attendance isn't marked yet."
      : "It's past 2 PM - last call to mark today's attendance.";

  for (const user of users) {
    const marked = await store.getAttendanceByDate(user.id, today);
    if (marked) continue;

    const subs = await store.listPushSubscriptions(user.id);
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          JSON.parse(sub.subscription),
          JSON.stringify({ title: "Attendance reminder", body })
        );
      } catch (err) {
        // 404/410 means the subscription is dead (browser data cleared, uninstalled, etc.) - clean it up.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await store.deletePushSubscriptionById(sub.id);
        } else {
          console.error("Push failed for user", user.id, err.message);
        }
      }
    }
  }
}

// Runs in the server's local time - set TZ in .env to your timezone.
cron.schedule("0 10 * * *", () => sendReminders("morning"));
cron.schedule("0 14 * * *", () => sendReminders("afternoon"));

const PORT = process.env.PORT || 3000;
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Server error. Check the server logs." });
});

createStore()
  .then((createdStore) => {
    store = createdStore;
    app.listen(PORT, () => {
      console.log(`The Register server running on port ${PORT} using ${store.name} storage`);
    });
  })
  .catch((err) => {
    console.error("Could not start storage backend:", err);
    process.exit(1);
  });
