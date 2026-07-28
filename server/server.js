require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const cron = require("node-cron");
const path = require("path");

const db = require("./db");
const { signToken, authMiddleware } = require("./auth");
const webpush = require("./push");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// ---------- auth ----------

app.post("/api/signup", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: "Enter a valid email and a password of at least 6 characters." });
  }
  const normalizedEmail = String(email).toLowerCase().trim();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: "An account with that email already exists." });
  }
  const passwordHash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare("INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)")
    .run(normalizedEmail, passwordHash, new Date().toISOString());
  const user = { id: info.lastInsertRowid, email: normalizedEmail };
  res.json({ token: signToken(user), email: user.email });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = String(email || "").toLowerCase().trim();
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(normalizedEmail);
  if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }
  res.json({ token: signToken(user), email: user.email });
});

app.get("/api/me", authMiddleware, (req, res) => {
  res.json({ email: req.user.email });
});

// ---------- attendance ----------

app.get("/api/attendance", authMiddleware, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM attendance WHERE user_id = ? ORDER BY date DESC")
    .all(req.user.id);
  res.json(rows);
});

app.post("/api/attendance", authMiddleware, (req, res) => {
  const { date, day, time } = req.body || {};
  if (!date || !day || !time) {
    return res.status(400).json({ error: "Missing date, day, or time." });
  }
  const existing = db
    .prepare("SELECT id FROM attendance WHERE user_id = ? AND date = ?")
    .get(req.user.id, date);
  if (existing) {
    return res.status(409).json({ error: "Already marked for today." });
  }
  const id = `${date}-${Date.now()}`;
  db.prepare("INSERT INTO attendance (id, user_id, date, day, time) VALUES (?, ?, ?, ?, ?)").run(
    id,
    req.user.id,
    date,
    day,
    time
  );
  res.json({ id, date, day, time });
});

app.delete("/api/attendance/:id", authMiddleware, (req, res) => {
  db.prepare("DELETE FROM attendance WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------- todos ----------

app.get("/api/todos", authMiddleware, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC")
    .all(req.user.id);
  res.json(rows);
});

app.post("/api/todos", authMiddleware, (req, res) => {
  const { title, category, dueDate } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: "Task needs a title." });
  }
  const id = `t-${Date.now()}`;
  db.prepare(
    "INSERT INTO todos (id, user_id, title, category, due_date, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)"
  ).run(id, req.user.id, String(title).trim(), category || "Other", dueDate || null, new Date().toISOString());
  res.json({ id });
});

app.patch("/api/todos/:id", authMiddleware, (req, res) => {
  const todo = db.prepare("SELECT * FROM todos WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!todo) return res.status(404).json({ error: "Task not found." });
  const nextStatus = todo.status === "completed" ? "pending" : "completed";
  db.prepare("UPDATE todos SET status = ? WHERE id = ?").run(nextStatus, todo.id);
  res.json({ status: nextStatus });
});

app.delete("/api/todos/:id", authMiddleware, (req, res) => {
  db.prepare("DELETE FROM todos WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------- push notifications ----------

app.get("/api/push/vapid-public-key", (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || "" });
});

app.post("/api/push/subscribe", authMiddleware, (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: "Invalid subscription." });
  }
  db.prepare(
    "INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, subscription) VALUES (?, ?, ?)"
  ).run(req.user.id, subscription.endpoint, JSON.stringify(subscription));
  res.json({ ok: true });
});

app.post("/api/push/unsubscribe", authMiddleware, (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) {
    db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").run(endpoint, req.user.id);
  }
  res.json({ ok: true });
});

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
  const users = db.prepare("SELECT * FROM users").all();
  const body =
    slot === "morning"
      ? "It's past 10 AM and today's attendance isn't marked yet."
      : "It's past 2 PM - last call to mark today's attendance.";

  for (const user of users) {
    const marked = db.prepare("SELECT id FROM attendance WHERE user_id = ? AND date = ?").get(user.id, today);
    if (marked) continue;

    const subs = db.prepare("SELECT * FROM push_subscriptions WHERE user_id = ?").all(user.id);
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          JSON.parse(sub.subscription),
          JSON.stringify({ title: "Attendance reminder", body })
        );
      } catch (err) {
        // 404/410 means the subscription is dead (browser data cleared, uninstalled, etc.) - clean it up.
        if (err.statusCode === 404 || err.statusCode === 410) {
          db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(sub.id);
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
app.listen(PORT, () => console.log(`The Register server running on port ${PORT}`));
