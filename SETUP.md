# Schedulr AI — Setup Guide

## Project Structure
```
schedulr/
├── backend/
│   ├── server.js              ← Express server (main entry)
│   ├── package.json
│   ├── .env                   ← YOUR API KEYS GO HERE
│   └── services/
│       ├── google.js          ← Gmail + Calendar API
│       ├── claude.js          ← Anthropic Claude API
│       └── emailProcessor.js  ← Core automation logic
└── frontend/
    └── public/
        └── index.html         ← Full UI (served by backend)
```

---

## Step 1 — Get your API keys

### A) Anthropic API key
1. Go to https://console.anthropic.com
2. Create an API key
3. Copy it

### B) Google OAuth credentials
1. Go to https://console.cloud.google.com
2. Create a new project (e.g. "Schedulr")
3. Enable these APIs:
   - Gmail API
   - Google Calendar API
4. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client ID"
5. Application type: **Web application**
6. Add Authorized redirect URI: `http://localhost:3001/auth/callback`
7. Copy the Client ID and Client Secret

---

## Step 2 — Fill in your .env

Open `backend/.env` and fill in:

```env
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/callback

ANTHROPIC_API_KEY=your_anthropic_api_key_here

PORT=3001
FRONTEND_URL=http://localhost:3001

USER_EMAIL=your_email@gmail.com

OFFICE_HOURS_START=9
OFFICE_HOURS_END=20

POLL_INTERVAL_SECONDS=60
```

---

## Step 3 — Install and run

```bash
cd schedulr/backend
npm install
npm start
```

Then open: http://localhost:3001

---

## Step 4 — Connect your Google account

1. Open http://localhost:3001
2. Click "Connect with Google"
3. Sign in and allow the permissions
4. You'll be redirected back to the app

---

## How it works

```
Every 60 seconds (or manual "Check emails now"):
  1. Gmail API → fetch unread emails
  2. Claude AI → analyze each email for meeting requests
  3. Extract: date, time, duration, purpose
  4. Check: is it within 9 AM – 8 PM?
  5. Google Calendar → check if time slot is free
  6. If FREE → add event → send confirmation email
  7. If BUSY or outside hours → find alternative slots → send decline email

AI Assistant tab:
  - Natural language → add/delete calendar events
  - Full calendar context sent to Claude each message
```

---

## Deploy to production (optional)

### Option A: Railway (easiest)
```bash
npm install -g railway
railway login
railway init
railway up
```
Set environment variables in Railway dashboard.
Change GOOGLE_REDIRECT_URI to your Railway URL + /auth/callback.

### Option B: Render
1. Push to GitHub
2. Create new Web Service on render.com
3. Set root directory to `backend/`
4. Build command: `npm install`
5. Start command: `node server.js`
6. Add all .env vars in the Environment tab

### Option C: VPS (DigitalOcean / Linode)
```bash
# On server
git clone your-repo
cd schedulr/backend
npm install
# Use PM2 to keep it running
npm install -g pm2
pm2 start server.js --name schedulr
pm2 save
pm2 startup
```

For production: use nginx as reverse proxy + Let's Encrypt SSL.

---

## Troubleshooting

**"OAuth failed"** — Check redirect URI matches exactly in Google Console

**"Not authenticated"** — Click "Connect with Google" again

**Emails not processing** — Check OFFICE_HOURS in .env, check Activity Log tab

**Calendar events not showing** — Ensure Google Calendar API is enabled in GCloud console

**Claude not responding** — Verify ANTHROPIC_API_KEY in .env
