# The Register - attendance and academic self-manager

A small account-based attendance and schedule app. The frontend is plain
HTML/CSS/JS, and the backend is Node.js + Express.

Data can be stored in Google Sheets for easy free deployment. If Google Sheets
credentials are not configured, the server falls back to a local JSON file so
you can still run the app during development.

## Project Structure

```text
the-register-app/
  public/          Frontend
  server/          Express API, auth, storage, push notifications
```

## Google Sheet Backend

The app uses this spreadsheet by default when you set the env vars:

```text
GOOGLE_SHEET_ID=10bVpeh214Y-ReHvypm6Uya9lX31NnnS9DfklpiHo2Oc
```

On first start, the server creates or updates these tabs:

```text
Users
Attendance
Todos
PushSubscriptions
```

The sheet is not called directly from the browser. The Express server keeps the
Google credentials private, handles login safely, and writes to the Sheet through
the Google Sheets API.

## 1. Prepare Google Access

1. Go to Google Cloud Console and create a project.
2. Enable **Google Sheets API** for that project.
3. Create a **Service account**.
4. Create a JSON key for the service account.
5. Open your Google Sheet and share it with the service account email as
   **Editor**.

From the downloaded JSON key, you need:

```text
client_email      -> GOOGLE_SERVICE_ACCOUNT_EMAIL
private_key       -> GOOGLE_PRIVATE_KEY
```

Keep the private key secret. Do not commit it to git.

## 2. Run Locally

```bash
cd server
npm install
copy .env.example .env
```

Edit `.env`:

```env
JWT_SECRET=replace-with-a-long-random-string
TZ=Asia/Kolkata
GOOGLE_SHEET_ID=10bVpeh214Y-ReHvypm6Uya9lX31NnnS9DfklpiHo2Oc
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Generate push notification keys if you want background reminders:

```bash
npm run generate-vapid
```

Then copy `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` into `.env`.

Start the app:

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## 3. Deploy For Free

Render is the simplest option for this version because the app still needs a
small Node server for auth, push reminders, and secure Google Sheets writes.

1. Push this repo to GitHub.
2. In Render, create a **New Web Service** from the repo.
3. Set:
   - Root directory: `server`
   - Build command: `npm install`
   - Start command: `npm start`
4. Add these environment variables:
   - `JWT_SECRET`
   - `TZ=Asia/Kolkata`
   - `GOOGLE_SHEET_ID`
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_PRIVATE_KEY`
   - `VAPID_PUBLIC_KEY` optional
   - `VAPID_PRIVATE_KEY` optional
5. Deploy.

Because the database is Google Sheets, your data survives Render restarts and
redeploys.

## Notes

- Passwords are hashed with bcrypt before being stored in the Sheet.
- Google Sheets is good for a personal/small app, but it is not ideal for heavy
  multi-user traffic.
- iOS push notifications require the app to be added to the home screen first
  on iOS 16.4+.
