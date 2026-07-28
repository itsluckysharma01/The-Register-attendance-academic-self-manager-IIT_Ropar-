const { createLocalJsonStore } = require("./storage/local-json");

async function createStore() {
  if (process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    const { createGoogleSheetsStore } = require("./storage/google-sheets");
    return createGoogleSheetsStore();
  }

  return createLocalJsonStore();
}

module.exports = { createStore };
