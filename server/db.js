const { createSqliteStore } = require("./storage/sqlite");

async function createStore() {
  if (process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    const { createGoogleSheetsStore } = require("./storage/google-sheets");
    return createGoogleSheetsStore();
  }

  return createSqliteStore();
}

module.exports = { createStore };
