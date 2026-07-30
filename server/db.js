const { createLocalJsonStore } = require("./storage/local-json");

async function createStore() {
  if (process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    const { createGoogleSheetsStore } = require("./storage/google-sheets");
    return createGoogleSheetsStore();
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Google Sheets credentials are required in production. Set GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, and GOOGLE_PRIVATE_KEY so registered users stay permanent."
    );
  }

  return createLocalJsonStore();
}

module.exports = { createStore };
