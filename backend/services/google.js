// services/google.js
// Handles OAuth, Gmail reading, and Google Calendar operations

const { google } = require('googleapis');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
];

// ─── Auth ─────────────────────────────────────────────────────────────────────

function getAuthUrl() {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

async function exchangeCode(code) {
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  return tokens;
}

function setTokens(tokens) {
  oauth2Client.setCredentials(tokens);
}

function getTokens() {
  return oauth2Client.credentials;
}

// ─── Gmail ────────────────────────────────────────────────────────────────────

async function listNewEmails(sinceHistoryId = null) {
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  let messageIds = [];

  if (sinceHistoryId) {
    // Use history API to get only new messages since last check
    try {
      const history = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: sinceHistoryId,
        historyTypes: ['messageAdded'],
        labelId: 'INBOX',
      });

      const records = history.data.history || [];
      records.forEach(record => {
        (record.messagesAdded || []).forEach(m => messageIds.push(m.message.id));
      });
    } catch (e) {
      // historyId expired — fall back to recent unread
      messageIds = await getRecentUnreadIds(gmail);
    }
  } else {
    messageIds = await getRecentUnreadIds(gmail);
  }

  const emails = await Promise.all(messageIds.map(id => getEmailById(gmail, id)));
  return emails.filter(Boolean);
}

async function getRecentUnreadIds(gmail) {
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: 'is:unread in:inbox',
    maxResults: 20,
  });
  return (res.data.messages || []).map(m => m.id);
}

async function getEmailById(gmail, id) {
  try {
    const res = await gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'full',
    });

    const msg = res.data;
    const headers = msg.payload.headers;
    const get = name => (headers.find(h => h.name.toLowerCase() === name.toLowerCase()) || {}).value || '';

    const body = extractBody(msg.payload);

    return {
      id: msg.id,
      threadId: msg.threadId,
      historyId: msg.historyId,
      from: get('From'),
      to: get('To'),
      subject: get('Subject'),
      date: get('Date'),
      body: body.trim(),
      snippet: msg.snippet,
      labelIds: msg.labelIds || [],
    };
  } catch {
    return null;
  }
}

function extractBody(payload) {
  if (!payload) return '';

  if (payload.body && payload.body.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  if (payload.parts) {
    // Prefer text/plain
    const plain = payload.parts.find(p => p.mimeType === 'text/plain');
    if (plain) return extractBody(plain);

    // Fall back to first part
    return extractBody(payload.parts[0]);
  }

  return '';
}

async function sendEmail({ to, subject, body, threadId }) {
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const userEmail = process.env.USER_EMAIL;

  const raw = [
    `From: ${userEmail}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    threadId ? `In-Reply-To: ${threadId}` : '',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ]
    .filter(Boolean)
    .join('\r\n');

  const encoded = Buffer.from(raw).toString('base64url');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encoded,
      ...(threadId ? { threadId } : {}),
    },
  });
}

async function markAsRead(messageId) {
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { removeLabelIds: ['UNREAD'] },
  });
}

async function getProfile() {
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const res = await gmail.users.getProfile({ userId: 'me' });
  return res.data;
}

// ─── Google Calendar ──────────────────────────────────────────────────────────

async function getCalendarEvents(startTime, endTime) {
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: startTime.toISOString(),
    timeMax: endTime.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  return (res.data.items || []).map(e => ({
    id: e.id,
    summary: e.summary || '(No title)',
    start: e.start.dateTime || e.start.date,
    end: e.end.dateTime || e.end.date,
    description: e.description || '',
    attendees: (e.attendees || []).map(a => a.email),
  }));
}

async function checkAvailability(startTime, endTime) {
  const events = await getCalendarEvents(startTime, endTime);
  return {
    isFree: events.length === 0,
    conflicts: events,
  };
}

async function addCalendarEvent({ summary, description, startTime, endTime, attendeeEmail }) {
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const event = {
    summary,
    description,
    start: { dateTime: startTime.toISOString(), timeZone: 'Asia/Kolkata' },
    end: { dateTime: endTime.toISOString(), timeZone: 'Asia/Kolkata' },
    attendees: attendeeEmail ? [{ email: attendeeEmail }] : [],
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 60 },
        { method: 'popup', minutes: 10 },
      ],
    },
  };

  const res = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: event,
    sendNotifications: true,
  });

  return res.data;
}

async function deleteCalendarEvent(eventId) {
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  await calendar.events.delete({ calendarId: 'primary', eventId });
}

async function getTodayEvents() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return getCalendarEvents(start, end);
}

async function getWeekEvents() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setDate(end.getDate() + 7);
  end.setHours(23, 59, 59, 999);
  return getCalendarEvents(start, end);
}

// Find free slots within office hours on a given date
async function findFreeSlots(date, durationMinutes) {
  const start = new Date(date);
  start.setHours(parseInt(process.env.OFFICE_HOURS_START || 9), 0, 0, 0);
  const end = new Date(date);
  end.setHours(parseInt(process.env.OFFICE_HOURS_END || 20), 0, 0, 0);

  const events = await getCalendarEvents(start, end);
  const slots = [];
  let cursor = new Date(start);

  // Sort events by start time
  events.sort((a, b) => new Date(a.start) - new Date(b.start));

  for (const event of events) {
    const evStart = new Date(event.start);
    const gapMinutes = (evStart - cursor) / 60000;
    if (gapMinutes >= durationMinutes) {
      slots.push({ start: new Date(cursor), end: new Date(evStart) });
    }
    const evEnd = new Date(event.end);
    if (evEnd > cursor) cursor = evEnd;
  }

  // Check remaining time after last event
  const remaining = (end - cursor) / 60000;
  if (remaining >= durationMinutes) {
    slots.push({ start: new Date(cursor), end: new Date(end) });
  }

  return slots;
}

module.exports = {
  getAuthUrl, exchangeCode, setTokens, getTokens,
  listNewEmails, getEmailById, sendEmail, markAsRead, getProfile,
  getCalendarEvents, checkAvailability, addCalendarEvent, deleteCalendarEvent,
  getTodayEvents, getWeekEvents, findFreeSlots,
};
