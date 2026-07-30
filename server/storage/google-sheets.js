const TABLES = {
  users: {
    sheet: "Users",
    headers: ["id", "email", "password_hash", "created_at"],
  },
  attendance: {
    sheet: "Attendance",
    headers: ["id", "user_id", "date", "day", "morning_time", "evening_time"],
  },
  todos: {
    sheet: "Todos",
    headers: ["id", "user_id", "title", "category", "due_date", "status", "created_at"],
  },
  classSchedules: {
    sheet: "ClassSchedules",
    headers: ["id", "user_id", "class_name", "room", "day", "date", "start_time", "end_time", "created_at", "updated_at"],
  },
  pushSubscriptions: {
    sheet: "PushSubscriptions",
    headers: ["id", "user_id", "endpoint", "subscription"],
  },
};

function rowToObject(headers, row, rowNumber) {
  const record = { _rowNumber: rowNumber };
  headers.forEach((header, index) => {
    record[header] = row[index] || "";
  });
  return record;
}

function objectToRow(headers, record) {
  return headers.map((header) => (record[header] == null ? "" : String(record[header])));
}

function normalizePrivateKey(privateKey) {
  return privateKey.replace(/\\n/g, "\n");
}

function normalizeAttendanceEntry(entry) {
  return {
    ...entry,
    morning_time: entry.morning_time || entry.time || "",
    evening_time: entry.evening_time || "",
  };
}

async function createGoogleSheetsStore() {
  const { google } = require("googleapis");
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!spreadsheetId || !clientEmail || !privateKey) {
    throw new Error("Missing Google Sheets credentials.");
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: normalizePrivateKey(privateKey),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  async function getHeaderRow(table) {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${table.sheet}!1:1`,
    });
    return response.data.values && response.data.values[0] ? response.data.values[0] : [];
  }

  async function ensureHeaders(tableKey) {
    const table = TABLES[tableKey];
    const existingHeaders = await getHeaderRow(table);
    const nextHeaders = table.headers.map((header, index) => {
      if (tableKey === "attendance" && header === "morning_time" && existingHeaders[index] === "time") {
        return "morning_time";
      }
      return existingHeaders[index] || header;
    });

    table.headers.forEach((header) => {
      if (!nextHeaders.includes(header)) nextHeaders.push(header);
    });

    if (nextHeaders.join("\u0000") !== existingHeaders.join("\u0000")) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${table.sheet}!A1:${String.fromCharCode(64 + nextHeaders.length)}1`,
        valueInputOption: "RAW",
        requestBody: { values: [nextHeaders] },
      });
    }
  }

  async function ensureWorkbook() {
    const workbook = await sheets.spreadsheets.get({ spreadsheetId });
    const existingTitles = new Set(workbook.data.sheets.map((sheet) => sheet.properties.title));
    const requests = Object.values(TABLES)
      .filter((table) => !existingTitles.has(table.sheet))
      .map((table) => ({ addSheet: { properties: { title: table.sheet } } }));

    if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
    }

    await Promise.all(Object.keys(TABLES).map(ensureHeaders));
  }

  async function list(tableKey) {
    const table = TABLES[tableKey];
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${table.sheet}!A2:${String.fromCharCode(64 + table.headers.length)}`,
    });
    const values = response.data.values || [];
    return values.map((row, index) => rowToObject(table.headers, row, index + 2));
  }

  async function append(tableKey, record) {
    const table = TABLES[tableKey];
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${table.sheet}!A:${String.fromCharCode(64 + table.headers.length)}`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [objectToRow(table.headers, record)] },
    });
  }

  async function update(tableKey, rowNumber, record) {
    const table = TABLES[tableKey];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${table.sheet}!A${rowNumber}:${String.fromCharCode(64 + table.headers.length)}${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [objectToRow(table.headers, record)] },
    });
  }

  async function remove(tableKey, rowNumber) {
    const table = TABLES[tableKey];
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${table.sheet}!A${rowNumber}:${String.fromCharCode(64 + table.headers.length)}${rowNumber}`,
    });
  }

  async function nextNumericId(tableKey) {
    const rows = await list(tableKey);
    const max = rows.reduce((highest, row) => Math.max(highest, Number(row.id) || 0), 0);
    return String(max + 1);
  }

  await ensureWorkbook();

  return {
    name: "google-sheets",

    async getUserByEmail(email) {
      return (await list("users")).find((user) => user.email === email);
    },

    async createUser({ email, passwordHash, createdAt }) {
      const user = { id: await nextNumericId("users"), email, password_hash: passwordHash, created_at: createdAt };
      await append("users", user);
      return user;
    },

    async listUsers() {
      return list("users");
    },

    async listAttendance(userId) {
      return (await list("attendance"))
        .filter((entry) => entry.user_id === String(userId))
        .map(normalizeAttendanceEntry)
        .sort((a, b) => b.date.localeCompare(a.date));
    },

    async getAttendanceByDate(userId, date) {
      const entry = (await list("attendance")).find((entry) => entry.user_id === String(userId) && entry.date === date);
      return entry ? normalizeAttendanceEntry(entry) : entry;
    },

    async createAttendance({ id, userId, date, day, slot, time }) {
      const entry = {
        id,
        user_id: String(userId),
        date,
        day,
        morning_time: slot === "morning" ? time : "",
        evening_time: slot === "evening" ? time : "",
      };
      await append("attendance", entry);
      return entry;
    },

    async updateAttendanceSlot(id, userId, slot, time) {
      const entry = (await list("attendance")).find(
        (candidate) => candidate.id === id && candidate.user_id === String(userId)
      );
      if (!entry) return null;
      const normalized = normalizeAttendanceEntry(entry);
      const next = Object.assign({}, normalized, {
        morning_time: slot === "morning" ? time : normalized.morning_time,
        evening_time: slot === "evening" ? time : normalized.evening_time,
      });
      await update("attendance", entry._rowNumber, next);
      return next;
    },

    async deleteAttendance(id, userId) {
      const entry = (await list("attendance")).find(
        (candidate) => candidate.id === id && candidate.user_id === String(userId)
      );
      if (entry) await remove("attendance", entry._rowNumber);
    },

    async listTodos(userId) {
      return (await list("todos"))
        .filter((todo) => todo.user_id === String(userId))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },

    async getTodo(id, userId) {
      return (await list("todos")).find((todo) => todo.id === id && todo.user_id === String(userId));
    },

    async createTodo({ id, userId, title, category, dueDate, createdAt }) {
      const todo = {
        id,
        user_id: String(userId),
        title,
        category,
        due_date: dueDate || "",
        status: "pending",
        created_at: createdAt,
      };
      await append("todos", todo);
      return todo;
    },

    async updateTodoStatus(id, userId, status) {
      const todo = await this.getTodo(id, userId);
      if (todo) await update("todos", todo._rowNumber, Object.assign({}, todo, { status }));
    },

    async deleteTodo(id, userId) {
      const todo = await this.getTodo(id, userId);
      if (todo) await remove("todos", todo._rowNumber);
    },

    async listClassSchedules(userId) {
      return (await list("classSchedules"))
        .filter((entry) => entry.user_id === String(userId))
        .sort((a, b) => {
          const dayCompare = String(a.day || "").localeCompare(String(b.day || ""));
          if (dayCompare !== 0) return dayCompare;
          return String(a.start_time || "").localeCompare(String(b.start_time || ""));
        });
    },

    async getClassSchedule(id, userId) {
      return (await list("classSchedules")).find(
        (entry) => entry.id === id && entry.user_id === String(userId)
      );
    },

    async createClassSchedule({ id, userId, className, room, day, date, startTime, endTime, createdAt, updatedAt }) {
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
      await append("classSchedules", entry);
      return entry;
    },

    async updateClassSchedule(id, userId, changes) {
      const entry = await this.getClassSchedule(id, userId);
      if (!entry) return null;
      const next = Object.assign({}, entry, changes, { updated_at: new Date().toISOString() });
      await update("classSchedules", entry._rowNumber, next);
      return next;
    },

    async deleteClassSchedule(id, userId) {
      const entry = await this.getClassSchedule(id, userId);
      if (entry) await remove("classSchedules", entry._rowNumber);
    },

    async upsertPushSubscription(userId, endpoint, subscription) {
      const existing = (await list("pushSubscriptions")).find((sub) => sub.endpoint === endpoint);
      const record = {
        id: existing ? existing.id : await nextNumericId("pushSubscriptions"),
        user_id: String(userId),
        endpoint,
        subscription: JSON.stringify(subscription),
      };
      if (existing) await update("pushSubscriptions", existing._rowNumber, record);
      else await append("pushSubscriptions", record);
    },

    async deletePushSubscription(endpoint, userId) {
      const sub = (await list("pushSubscriptions")).find(
        (candidate) => candidate.endpoint === endpoint && candidate.user_id === String(userId)
      );
      if (sub) await remove("pushSubscriptions", sub._rowNumber);
    },

    async listPushSubscriptions(userId) {
      return (await list("pushSubscriptions")).filter((sub) => sub.user_id === String(userId));
    },

    async deletePushSubscriptionById(id) {
      const sub = (await list("pushSubscriptions")).find((candidate) => candidate.id === String(id));
      if (sub) await remove("pushSubscriptions", sub._rowNumber);
    },
  };
}

module.exports = { createGoogleSheetsStore };
