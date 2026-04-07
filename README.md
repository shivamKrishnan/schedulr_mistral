## Schedulr AI (Mistral Edition) — Setup Guide 

This project is an AI-powered scheduling assistant that monitors your **Gmail** for meeting requests, analyzes them using **Mistral AI**, and automatically manages your **Google Calendar**.

-----

## 📂 Project Structure 

```
schedulr_mistral/
├── backend/
│   ├── server.js              ← Express server (main entry) 
│   ├── package.json           ← Dependencies (Mistral SDK) 
│   ├── .env                   ← Your API Keys 
│   └── services/
│       ├── google.js          ← Gmail + Calendar API logic 
│       ├── mistral.js         ← Mistral AI analysis & chat 
│       └── emailProcessor.js  ← Automation & business logic 
└── frontend/
    └── public/
        └── index.html         ← Web UI 
```

-----

## 🚀 Step 1 — Get your API Keys 

### A) Mistral AI Key

1.  Go to [console.mistral.ai](https://console.mistral.ai/).
2.  Create a new API Key.
3.  Copy it for your `.env` file.

### B) Google OAuth Credentials 

1.  Go to [console.cloud.google.com](https://console.cloud.google.com/).
2.  Enable the **Gmail API** and **Google Calendar API**.
3.  Configure the **OAuth Consent Screen**:
      * Set User Type to **External**.
      * Add your own email to the **Test Users** list (Required for 403 errors).
      * Add Scopes: `.../auth/gmail.readonly`, `.../auth/gmail.send`, and `.../auth/calendar`.
4.  Create **Credentials** → **OAuth 2.0 Client ID**:
      * Application type: **Web application**.
      * Authorized redirect URI: `http://localhost:3001/auth/callback`.
5.  Copy the **Client ID** and **Client Secret**.

-----

## ⚙️ Step 2 — Fill in your `.env` 

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

## 🛠️ Step 3 — Install and Run 

```bash
cd backend
npm install
npm start
```

Then open [http://localhost:3001](https://www.google.com/search?q=http://localhost:3001) in your browser.

-----

## 🤖 How it Works 

1.  **Poll**: Every 60 seconds, the app fetches unread emails via the Gmail API.
2.  **Analyze**: Mistral AI analyzes the email content to detect meeting requests, dates, and times.
3.  **Check**: The app checks your Google Calendar to see if the requested slot is within office hours and currently free.
4.  **Respond**:
      * **If Free**: Adds the event to your calendar and sends a confirmation email.
      * **If Busy**: Finds alternative slots and sends a polite decline with suggestions.
5.  **Chat**: Use the "AI Assistant" tab to add or delete events using natural language (e.g., "Delete my meeting at 2 PM").

-----

## ⚠️ Troubleshooting 

  * **401 Unauthorized**: Your `MISTRAL_API_KEY` is invalid or you didn't restart the server after updating `.env`.
  * **403 Access Denied**: You must add your email to the "Test Users" section in the Google Cloud Console.
  * **Insufficient Permission**: When logging in, you must manually check the boxes to allow Gmail and Calendar access.
  * **Redirect URI Mismatch**: Ensure the URI in the Google Console matches your `.env` exactly.