## [cite_start]Schedulr AI (Mistral Edition) — Setup Guide [cite: 1]

[cite_start]This project is an AI-powered scheduling assistant that monitors your **Gmail** for meeting requests, analyzes them using **Mistral AI**, and automatically manages your **Google Calendar**[cite: 1].

-----

## [cite_start]📂 Project Structure [cite: 1]

```
schedulr_mistral/
├── backend/
[cite_start]│   ├── server.js              ← Express server (main entry) [cite: 1]
[cite_start]│   ├── package.json           ← Dependencies (Mistral SDK) [cite: 1]
[cite_start]│   ├── .env                   ← Your API Keys [cite: 1]
│   └── services/
[cite_start]│       ├── google.js          ← Gmail + Calendar API logic [cite: 1]
[cite_start]│       ├── mistral.js         ← Mistral AI analysis & chat [cite: 1]
[cite_start]│       └── emailProcessor.js  ← Automation & business logic [cite: 1]
└── frontend/
    └── public/
        [cite_start]└── index.html         ← Web UI [cite: 1]
```

-----

## [cite_start]🚀 Step 1 — Get your API Keys [cite: 1]

### A) Mistral AI Key

1.  Go to [console.mistral.ai](https://console.mistral.ai/).
2.  Create a new API Key.
3.  [cite_start]Copy it for your `.env` file[cite: 1].

### [cite_start]B) Google OAuth Credentials [cite: 1]

1.  [cite_start]Go to [console.cloud.google.com](https://console.cloud.google.com/)[cite: 1].
2.  [cite_start]Enable the **Gmail API** and **Google Calendar API**[cite: 1].
3.  Configure the **OAuth Consent Screen**:
      * [cite_start]Set User Type to **External**[cite: 1].
      * [cite_start]Add your own email to the **Test Users** list (Required for 403 errors)[cite: 1].
      * Add Scopes: `.../auth/gmail.readonly`, `.../auth/gmail.send`, and `.../auth/calendar`.
4.  Create **Credentials** → **OAuth 2.0 Client ID**:
      * [cite_start]Application type: **Web application**[cite: 1].
      * [cite_start]Authorized redirect URI: `http://localhost:3001/auth/callback`[cite: 1].
5.  [cite_start]Copy the **Client ID** and **Client Secret**[cite: 1].

-----

## [cite_start]⚙️ Step 2 — Fill in your `.env` [cite: 1]

Open `backend/.env` and fill in your details:

```env
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/callback

MISTRAL_API_KEY=your_mistral_api_key

PORT=3001
FRONTEND_URL=http://localhost:3001

USER_EMAIL=your_email@gmail.com

OFFICE_HOURS_START=9
OFFICE_HOURS_END=20

POLL_INTERVAL_SECONDS=60
```

-----

## [cite_start]🛠️ Step 3 — Install and Run [cite: 1]

```bash
cd backend
npm install
npm start
```

[cite_start]Then open [http://localhost:3001](https://www.google.com/search?q=http://localhost:3001) in your browser[cite: 1].

-----

## [cite_start]🤖 How it Works [cite: 1]

1.  [cite_start]**Poll**: Every 60 seconds, the app fetches unread emails via the Gmail API[cite: 1].
2.  **Analyze**: Mistral AI analyzes the email content to detect meeting requests, dates, and times.
3.  **Check**: The app checks your Google Calendar to see if the requested slot is within office hours and currently free.
4.  **Respond**:
      * **If Free**: Adds the event to your calendar and sends a confirmation email.
      * **If Busy**: Finds alternative slots and sends a polite decline with suggestions.
5.  [cite_start]**Chat**: Use the "AI Assistant" tab to add or delete events using natural language (e.g., "Delete my meeting at 2 PM")[cite: 1].

-----

## [cite_start]⚠️ Troubleshooting [cite: 1]

  * **401 Unauthorized**: Your `MISTRAL_API_KEY` is invalid or you didn't restart the server after updating `.env`.
  * [cite_start]**403 Access Denied**: You must add your email to the "Test Users" section in the Google Cloud Console[cite: 1].
  * **Insufficient Permission**: When logging in, you must manually check the boxes to allow Gmail and Calendar access.
  * [cite_start]**Redirect URI Mismatch**: Ensure the URI in the Google Console matches your `.env` exactly[cite: 1].