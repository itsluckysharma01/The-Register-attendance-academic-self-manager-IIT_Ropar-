# The Register

Attendance and schedule manager with a plain HTML/CSS/JS frontend and a Node.js
Express backend.

Production data is stored in Google Sheets. If Google credentials are missing,
the server uses a local `data.json` file for development.

## Google Sheets Backend


The server creates these tabs automatically:

```text
Users
Attendance
Todos
ClassSchedules
PushSubscriptions
```

Registered users are stored in the `Users` tab with hashed passwords. App updates
should not delete or recreate that tab; keep the same `GOOGLE_SHEET_ID`,
`GOOGLE_SERVICE_ACCOUNT_EMAIL`, and `GOOGLE_PRIVATE_KEY` environment variables
across deployments so credentials remain permanent.

In production, the server requires Google Sheets credentials and will not fall
back to local `data.json`. This protects registered accounts from being stored
in temporary server storage after a deploy or code change.

Attendance is stored as one row per day, with separate `morning_time` and
`evening_time` columns. Morning attendance can be marked from 8:00 AM to
12:30 PM, and evening attendance can be marked from 4:00 PM to 9:30 PM.


## Local Setup

```bash
cd server
npm install
copy .env.example .env
npm start
```


Optional push notification keys:

```bash
npm run generate-vapid
```

Add the generated values:

```env
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
```

Open:

```text
http://localhost:3000
```

## Render Deploy

Create a Render **Web Service** with:

```text
Root Directory: server
Build Command: npm install
Start Command: npm start
Instance Type: Free
```


After pushing changes to GitHub, use **Manual Deploy -> Clear build cache &
deploy** if Render previously failed during `npm install`.

## Notes

- Passwords are hashed before storage.
- Google Sheets is suitable for a small personal app, not heavy traffic.
- The backend pins Node to `20.x` for stable Render builds.
