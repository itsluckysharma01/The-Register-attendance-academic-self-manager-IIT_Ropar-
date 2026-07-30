const fs = require("fs");
const path = require("path");

const EMPTY_DATA = {
  users: [],
  attendance: [],
  todos: [],
  classSchedules: [],
  pushSubscriptions: [],
};

function createLocalJsonStore() {
  const filePath = path.join(__dirname, "..", "data.json");

  function readData() {
    if (!fs.existsSync(filePath)) return structuredClone(EMPTY_DATA);
    return Object.assign({}, EMPTY_DATA, JSON.parse(fs.readFileSync(filePath, "utf8")));
  }

  function writeData(data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  function nextNumericId(rows) {
    return String(rows.reduce((highest, row) => Math.max(highest, Number(row.id) || 0), 0) + 1);
  }

  return {
    name: "local-json",

    async getUserByEmail(email) {
      return readData().users.find((user) => user.email === email);
    },

    async createUser({ email, passwordHash, createdAt }) {
      const data = readData();
      const user = { id: nextNumericId(data.users), email, password_hash: passwordHash, created_at: createdAt };
      data.users.push(user);
      writeData(data);
      return user;
    },

    async listUsers() {
      return readData().users;
    },

    async listAttendance(userId) {
      return readData()
        .attendance.filter((entry) => entry.user_id === String(userId))
        .sort((a, b) => b.date.localeCompare(a.date));
    },

    async getAttendanceByDate(userId, date) {
      return readData().attendance.find((entry) => entry.user_id === String(userId) && entry.date === date);
    },

    async createAttendance({ id, userId, date, day, time }) {
      const data = readData();
      const entry = { id, user_id: String(userId), date, day, time };
      data.attendance.push(entry);
      writeData(data);
      return entry;
    },

    async deleteAttendance(id, userId) {
      const data = readData();
      data.attendance = data.attendance.filter((entry) => !(entry.id === id && entry.user_id === String(userId)));
      writeData(data);
    },

    async listTodos(userId) {
      return readData()
        .todos.filter((todo) => todo.user_id === String(userId))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },

    async getTodo(id, userId) {
      return readData().todos.find((todo) => todo.id === id && todo.user_id === String(userId));
    },

    async createTodo({ id, userId, title, category, dueDate, createdAt }) {
      const data = readData();
      const todo = {
        id,
        user_id: String(userId),
        title,
        category,
        due_date: dueDate || "",
        status: "pending",
        created_at: createdAt,
      };
      data.todos.push(todo);
      writeData(data);
      return todo;
    },

    async updateTodoStatus(id, userId, status) {
      const data = readData();
      const todo = data.todos.find((entry) => entry.id === id && entry.user_id === String(userId));
      if (todo) todo.status = status;
      writeData(data);
    },

    async deleteTodo(id, userId) {
      const data = readData();
      data.todos = data.todos.filter((todo) => !(todo.id === id && todo.user_id === String(userId)));
      writeData(data);
    },

    async listClassSchedules(userId) {
      return readData()
        .classSchedules.filter((entry) => entry.user_id === String(userId))
        .sort((a, b) => {
          const dayCompare = String(a.day || "").localeCompare(String(b.day || ""));
          if (dayCompare !== 0) return dayCompare;
          return String(a.start_time || "").localeCompare(String(b.start_time || ""));
        });
    },

    async getClassSchedule(id, userId) {
      return readData().classSchedules.find((entry) => entry.id === id && entry.user_id === String(userId));
    },

    async createClassSchedule({ id, userId, className, room, day, date, startTime, endTime, createdAt, updatedAt }) {
      const data = readData();
      const entry = {
        id,
        user_id: String(userId),
        class_name: className,
        room,
        day,
        date: date || "",
        start_time: startTime,
        end_time: endTime,
        created_at: createdAt,
        updated_at: updatedAt,
      };
      data.classSchedules.push(entry);
      writeData(data);
      return entry;
    },

    async updateClassSchedule(id, userId, changes) {
      const data = readData();
      const entry = data.classSchedules.find((candidate) => candidate.id === id && candidate.user_id === String(userId));
      if (!entry) return null;
      Object.assign(entry, changes, { updated_at: new Date().toISOString() });
      writeData(data);
      return entry;
    },

    async deleteClassSchedule(id, userId) {
      const data = readData();
      data.classSchedules = data.classSchedules.filter(
        (entry) => !(entry.id === id && entry.user_id === String(userId))
      );
      writeData(data);
    },

    async upsertPushSubscription(userId, endpoint, subscription) {
      const data = readData();
      const existing = data.pushSubscriptions.find((sub) => sub.endpoint === endpoint);
      const record = {
        id: existing ? existing.id : nextNumericId(data.pushSubscriptions),
        user_id: String(userId),
        endpoint,
        subscription: JSON.stringify(subscription),
      };
      if (existing) Object.assign(existing, record);
      else data.pushSubscriptions.push(record);
      writeData(data);
    },

    async deletePushSubscription(endpoint, userId) {
      const data = readData();
      data.pushSubscriptions = data.pushSubscriptions.filter(
        (sub) => !(sub.endpoint === endpoint && sub.user_id === String(userId))
      );
      writeData(data);
    },

    async listPushSubscriptions(userId) {
      return readData().pushSubscriptions.filter((sub) => sub.user_id === String(userId));
    },

    async deletePushSubscriptionById(id) {
      const data = readData();
      data.pushSubscriptions = data.pushSubscriptions.filter((sub) => sub.id !== String(id));
      writeData(data);
    },
  };
}

module.exports = { createLocalJsonStore };
