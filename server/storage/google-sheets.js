const TABLES = {
  users: {
    sheet: "Users",
    headers: ["id", "email", "password_hash", "created_at"],
  },
  attendance: {
    sheet: "Attendance",
    headers: ["id", "user_id", "date", "day", "time"],
  },
  todos: {
    sheet: "Todos",
    headers: ["id", "user_id", "title", "category", "due_date", "status", "created_at"],
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

  async function ensureWorkbook() {
    const workbook = await sheets.spreadsheets.get({ spreadsheetId });
    const existingTitles = new Set(workbook.data.sheets.map((sheet) => sheet.properties.title));
    const requests = Object.values(TABLES)
      .filter((table) => !existingTitles.has(table.sheet))
      .map((table) => ({ addSheet: { properties: { title: table.sheet } } }));

    if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
    }

    await Promise.all(
      Object.values(TABLES).map((table) =>
        sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${table.sheet}!A1:${String.fromCharCode(64 + table.headers.length)}1`,
          valueInputOption: "RAW",
          requestBody: { values: [table.headers] },
        })
      )
    );
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
        .sort((a, b) => b.date.localeCompare(a.date));
    },

    async getAttendanceByDate(userId, date) {
      return (await list("attendance")).find((entry) => entry.user_id === String(userId) && entry.date === date);
    },

    async createAttendance({ id, userId, date, day, time }) {
      const entry = { id, user_id: String(userId), date, day, time };
      await append("attendance", entry);
      return entry;
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
