// server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');

const google = require('./services/google');
const claude = require('./services/mistral');
const processor = require('./services/emailProcessor');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend/public')));

// In-memory token store (use a DB / session in production)
let storedTokens = null;
// Chat history per session (simple in-memory, keyed by sessionId)
const chatSessions = {};

// ─── Auth Status ──────────────────────────────────────────────────────────────

function isAuthed() {
  return storedTokens && (storedTokens.access_token || storedTokens.refresh_token);
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────

// Step 1: Get the Google OAuth URL
app.get('/auth/url', (req, res) => {
  const url = google.getAuthUrl();
  res.json({ url });
});

// Step 2: Google redirects here after login
app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect(`/?error=${encodeURIComponent(error)}`);
  }

  try {
    const tokens = await google.exchangeCode(code);
    storedTokens = tokens;
    google.setTokens(tokens);
    res.redirect('/?authed=1');
  } catch (err) {
    console.error('OAuth error:', err.message);
    res.redirect(`/?error=${encodeURIComponent('OAuth failed')}`);
  }
});

// Check auth status
app.get('/auth/status', (req, res) => {
  res.json({
    authed: isAuthed(),
    email: process.env.USER_EMAIL || null,
  });
});

// Logout
app.post('/auth/logout', (req, res) => {
  storedTokens = null;
  res.json({ ok: true });
});

// ─── Auth Middleware ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (!isAuthed()) {
    return res.status(401).json({ error: 'Not authenticated. Please connect Google account.' });
  }
  google.setTokens(storedTokens);
  next();
}

// ─── Email Routes ─────────────────────────────────────────────────────────────

// Manually trigger email poll
app.post('/emails/poll', requireAuth, async (req, res) => {
  try {
    await processor.processNewEmails();
    res.json({ ok: true, message: 'Email poll complete' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get activity log
app.get('/emails/log', requireAuth, (req, res) => {
  res.json(processor.getLog());
});

// Get recent emails from Gmail (for display)
app.get('/emails/inbox', requireAuth, async (req, res) => {
  try {
    const emails = await google.listNewEmails();
    res.json(emails);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Calendar Routes ──────────────────────────────────────────────────────────

// Get today's events
app.get('/calendar/today', requireAuth, async (req, res) => {
  try {
    const events = await google.getTodayEvents();
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get next 7 days
app.get('/calendar/week', requireAuth, async (req, res) => {
  try {
    const events = await google.getWeekEvents();
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add event manually
app.post('/calendar/events', requireAuth, async (req, res) => {
  const { summary, startTime, endTime, description, attendeeEmail } = req.body;

  if (!summary || !startTime || !endTime) {
    return res.status(400).json({ error: 'summary, startTime, endTime are required' });
  }

  try {
    const event = await google.addCalendarEvent({
      summary,
      description: description || '',
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      attendeeEmail,
    });

    processor.log('event_added', `Manual event added: "${summary}"`, { eventId: event.id });
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete event
app.delete('/calendar/events/:id', requireAuth, async (req, res) => {
  try {
    await google.deleteCalendarEvent(req.params.id);
    processor.log('event_added', `Event deleted: ${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check availability for a time range
app.get('/calendar/availability', requireAuth, async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end required (ISO strings)' });

  try {
    const result = await google.checkAvailability(new Date(start), new Date(end));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Chat Assistant Route ─────────────────────────────────────────────────────

app.post('/chat', requireAuth, async (req, res) => {
  const { message, sessionId = 'default' } = req.body;

  if (!message) return res.status(400).json({ error: 'message is required' });

  if (!chatSessions[sessionId]) chatSessions[sessionId] = [];

  try {
    // Get calendar context
    const weekEvents = await google.getWeekEvents();
    const calendarContext = weekEvents.length
      ? weekEvents.map(e => {
          const start = new Date(e.start).toLocaleString('en-IN', {
            weekday: 'short', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true,
          });
          return `• ${e.summary} — ${start}`;
        }).join('\n')
      : 'No upcoming events';

    const { text, action } = await claude.chatWithAssistant({
      message,
      history: chatSessions[sessionId],
      calendarContext,
    });

    // Execute any calendar actions the AI requested
    let actionResult = null;
    if (action) {
      actionResult = await executeAction(action);
    }

    // Update chat history
    chatSessions[sessionId].push({ role: 'user', content: message });
    chatSessions[sessionId].push({ role: 'assistant', content: text });

    // Keep last 20 messages
    if (chatSessions[sessionId].length > 20) {
      chatSessions[sessionId] = chatSessions[sessionId].slice(-20);
    }

    processor.log('chat', `Assistant: ${text.slice(0, 80)}...`, { sessionId, action });

    res.json({ reply: text, action, actionResult });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

async function executeAction(action) {
  if (action.type === 'ADD_EVENT') {
    const { summary, date, startHour, startMinute, durationMinutes, description } = action.data;
    const startTime = new Date(`${date}T${String(startHour).padStart(2,'0')}:${String(startMinute).padStart(2,'0')}:00`);
    const endTime = new Date(startTime.getTime() + durationMinutes * 60000);

    const event = await google.addCalendarEvent({ summary, description: description || '', startTime, endTime });
    processor.log('event_added', `Chat added event: "${summary}" on ${date}`, { eventId: event.id });
    return { success: true, eventId: event.id };
  }

  if (action.type === 'DELETE_EVENT') {
    const { eventId, summary } = action.data;
    await google.deleteCalendarEvent(eventId);
    processor.log('event_added', `Chat deleted event: "${summary}"`, { eventId });
    return { success: true };
  }

  return null;
}

// ─── Auto-poll Emails ─────────────────────────────────────────────────────────

const pollSeconds = parseInt(process.env.POLL_INTERVAL_SECONDS || 60);
const cronExpression = `*/${Math.max(pollSeconds, 60)} * * * * *`; // Min 60s

cron.schedule(cronExpression, async () => {
  if (!isAuthed()) return;
  console.log('[CRON] Polling Gmail...');
  google.setTokens(storedTokens);
  await processor.processNewEmails();
});

// ─── Fallback to frontend ─────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀 Schedulr AI running at http://localhost:${PORT}`);
  console.log(`📧 Email poll interval: every ${pollSeconds}s`);
  console.log(`⏰ Office hours: ${process.env.OFFICE_HOURS_START || 9}:00 – ${process.env.OFFICE_HOURS_END || 20}:00\n`);
});
