# The Register — attendance & academic self-manager

A full account-based version: sign up, log in, and your attendance log and
to-do/schedule list are saved to a real database tied to your account.
Background push notifications remind you at 10 AM and 2 PM if you haven't
marked attendance yet — these arrive even if the site isn't open in a tab,
as long as you've enabled notifications once and your device/browser is on.

## What's inside

```
the-register-app/
  server/          Node.js + Express + SQLite backend (auth, data, push)
  public/          Frontend (plain HTML/CSS/JS, no build step)
```

## 1. Run it locally first

You'll need [Node.js](https://nodejs.org) 18 or newer installed.

```bash
cd server
npm install
cp .env.example .env
```

Open `.env` and:
1. Set `JWT_SECRET` to a random string. Generate one with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
2. Generate your push notification keys:
   ```bash
   npm run generate-vapid
   ```
   Copy the two lines it prints (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`) into `.env`.
3. Set `TZ` to your timezone (e.g. `Asia/Kolkata`) so the 10 AM / 2 PM reminders fire at the right local time.

Then start the server:

```bash
npm start
```

Visit `http://localhost:3000` — sign up, mark attendance, add tasks. Click
"Enable" on the notifications banner and allow permission when your browser
asks.

## 2. Deploying it for free

This app needs a server that stays running (unlike the earlier static
version), so GitHub Pages/Netlify Drop won't work here. Use one of these
instead — all have free tiers:

### Option A: Render.com (easiest)

1. Push this whole folder to a GitHub repo.
2. On [render.com](https://render.com), click **New → Web Service**, connect your repo.
3. Set:
   - **Root directory**: `server`
   - **Build command**: `npm install`
   - **Start command**: `npm start`
4. Under **Environment**, add `JWT_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `TZ` (same values as your local `.env`).
5. Deploy. Render gives you a URL like `the-register.onrender.com`.

**Important caveat**: Render's free tier does not include a persistent
disk, so the SQLite file resets whenever the service redeploys or restarts
after sleeping. For a small personal project this is usually fine day-to-day,
but if you want data to survive redeploys/restarts permanently, either:
- Add a Render persistent disk (small paid add-on), or
- Swap SQLite for a free hosted database like [Turso](https://turso.tech) (SQLite-compatible, has a generous free tier) or [Supabase](https://supabase.com) (Postgres, free tier) — ask me and I can wire either one in.

### Option B: Railway.app

Same steps as Render — connect the repo, set root directory to `server`,
add the same environment variables. Railway's free trial includes a volume
you can mount for the SQLite file so it survives restarts.

### Option C: Fly.io

Good if you want a persistent volume on the free allowance. Requires the
`flyctl` CLI; happy to write the `fly.toml` for you if you go this route.

## 3. Using it day to day

- Visit your deployed URL, sign up once.
- On your phone, open it in Chrome/Safari and use "Add to Home Screen" so
  it behaves like an installed app.
- Tap "Enable" on the notifications banner once — after that, reminders
  fire automatically at 10 AM and 2 PM server time if attendance isn't
  marked yet.

## Notes and honest limits

- iOS push notifications require the site to be added to the home screen
  first (iOS 16.4+); it won't work from a regular Safari tab.
- If you uninstall/clear browser data, your push subscription is lost and
  you'll need to hit "Enable" again — your account data is unaffected since
  it lives in the database, not the browser.
- Passwords are hashed with bcrypt before storage; nothing is stored in
  plain text.
