const Database = require("better-sqlite3");
const path = require("path");

function createSqliteStore() {
  const db = new Database(path.join(__dirname, "..", "data.sqlite"));

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      day TEXT NOT NULL,
      time TEXT NOT NULL,
      UNIQUE(user_id, date),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      subscription TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  return {
    name: "sqlite",

    async getUserByEmail(email) {
      return db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    },

    async createUser({ email, passwordHash, createdAt }) {
      const info = db
        .prepare("INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)")
        .run(email, passwordHash, createdAt);
      return { id: info.lastInsertRowid, email, password_hash: passwordHash, created_at: createdAt };
    },

    async listUsers() {
      return db.prepare("SELECT * FROM users").all();
    },

    async listAttendance(userId) {
      return db.prepare("SELECT * FROM attendance WHERE user_id = ? ORDER BY date DESC").all(userId);
    },

    async getAttendanceByDate(userId, date) {
      return db.prepare("SELECT id FROM attendance WHERE user_id = ? AND date = ?").get(userId, date);
    },

    async createAttendance({ id, userId, date, day, time }) {
      db.prepare("INSERT INTO attendance (id, user_id, date, day, time) VALUES (?, ?, ?, ?, ?)").run(
        id,
        userId,
        date,
        day,
        time
      );
      return { id, user_id: userId, date, day, time };
    },

    async deleteAttendance(id, userId) {
      db.prepare("DELETE FROM attendance WHERE id = ? AND user_id = ?").run(id, userId);
    },

    async listTodos(userId) {
      return db.prepare("SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC").all(userId);
    },

    async getTodo(id, userId) {
      return db.prepare("SELECT * FROM todos WHERE id = ? AND user_id = ?").get(id, userId);
    },

    async createTodo({ id, userId, title, category, dueDate, createdAt }) {
      db.prepare(
        "INSERT INTO todos (id, user_id, title, category, due_date, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)"
      ).run(id, userId, title, category, dueDate, createdAt);
      return { id, user_id: userId, title, category, due_date: dueDate, status: "pending", created_at: createdAt };
    },

    async updateTodoStatus(id, userId, status) {
      db.prepare("UPDATE todos SET status = ? WHERE id = ? AND user_id = ?").run(status, id, userId);
    },

    async deleteTodo(id, userId) {
      db.prepare("DELETE FROM todos WHERE id = ? AND user_id = ?").run(id, userId);
    },

    async upsertPushSubscription(userId, endpoint, subscription) {
      db.prepare("INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, subscription) VALUES (?, ?, ?)").run(
        userId,
        endpoint,
        JSON.stringify(subscription)
      );
    },

    async deletePushSubscription(endpoint, userId) {
      db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").run(endpoint, userId);
    },

    async listPushSubscriptions(userId) {
      return db.prepare("SELECT * FROM push_subscriptions WHERE user_id = ?").all(userId);
    },

    async deletePushSubscriptionById(id) {
      db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(id);
    },
  };
}

module.exports = { createSqliteStore };
