// services/emailProcessor.js
// Core automation: reads email → AI analysis → calendar check → respond

const google = require('./google');
const claude = require('./mistral');

const OFFICE_START = parseInt(process.env.OFFICE_HOURS_START || 9);
const OFFICE_END = parseInt(process.env.OFFICE_HOURS_END || 20);

// In-memory store for processed email IDs (use a DB in production)
const processedIds = new Set();
// Activity log (in-memory, last 100 entries)
const activityLog = [];

function log(type, message, meta = {}) {
  const entry = {
    id: Date.now() + Math.random(),
    type,       // 'email_received' | 'ai_analysis' | 'calendar_check' | 'event_added' | 'declined' | 'error' | 'chat'
    message,
    meta,
    timestamp: new Date().toISOString(),
  };
  activityLog.unshift(entry);
  if (activityLog.length > 100) activityLog.pop();
  console.log(`[${type.toUpperCase()}] ${message}`);
  return entry;
}

function getLog() { return activityLog; }

// ─── Main Processor ───────────────────────────────────────────────────────────

async function processNewEmails() {
  try {
    const emails = await google.listNewEmails();

    for (const email of emails) {
      if (processedIds.has(email.id)) continue;
      processedIds.add(email.id);

      await processEmail(email);
    }
  } catch (err) {
    log('error', `Failed to fetch emails: ${err.message}`);
  }
}

async function processEmail(email) {
  log('email_received', `New email from ${email.from}: "${email.subject}"`, {
    emailId: email.id,
    from: email.from,
    subject: email.subject,
  });

  // ── Step 1: AI analysis ──
  let analysis;
  try {
    analysis = await claude.analyzeEmail(email.body, email.subject, email.from);
    log('ai_analysis', `AI analyzed email — meeting request: ${analysis.isMeetingRequest}, confidence: ${analysis.confidence}`, {
      analysis,
      emailId: email.id,
    });
  } catch (err) {
    log('error', `AI analysis failed: ${err.message}`, { emailId: email.id });
    return;
  }

  // Not a meeting request — skip
  if (!analysis.isMeetingRequest || analysis.confidence === 'low') {
    log('ai_analysis', `Not a meeting request — skipping`, { emailId: email.id });
    await google.markAsRead(email.id);
    return;
  }

  // ── Step 2: Parse requested time ──
  if (!analysis.requestedDate || !analysis.requestedTime) {
    log('ai_analysis', `Could not extract date/time from email`, { emailId: email.id });
    await google.markAsRead(email.id);
    return;
  }

  const [hour, minute] = analysis.requestedTime.split(':').map(Number);
  const requestedStart = new Date(`${analysis.requestedDate}T${analysis.requestedTime}:00`);
  const requestedEnd = new Date(requestedStart.getTime() + (analysis.durationMinutes || 60) * 60000);

  // ── Step 3: Check office hours ──
  const isOutsideHours = hour < OFFICE_START || hour >= OFFICE_END;

  if (isOutsideHours) {
    log('calendar_check', `Requested time (${analysis.requestedTime}) is outside office hours`, {
      emailId: email.id,
      requestedTime: analysis.requestedTime,
    });

    await sendDeclineAndSuggest(email, analysis, requestedStart, 'outside_hours');
    await google.markAsRead(email.id);
    return;
  }

  // ── Step 4: Check calendar availability ──
  log('calendar_check', `Checking calendar for ${analysis.requestedDate} at ${analysis.requestedTime}`);

  let availability;
  try {
    availability = await google.checkAvailability(requestedStart, requestedEnd);
  } catch (err) {
    log('error', `Calendar check failed: ${err.message}`, { emailId: email.id });
    return;
  }

  log('calendar_check', `Calendar check: ${availability.isFree ? 'FREE' : 'BUSY'}`, {
    conflicts: availability.conflicts,
    emailId: email.id,
  });

  if (!availability.isFree) {
    await sendDeclineAndSuggest(email, analysis, requestedStart, 'busy');
    await google.markAsRead(email.id);
    return;
  }

  // ── Step 5: Add to calendar ──
  try {
    const event = await google.addCalendarEvent({
      summary: analysis.purpose || email.subject,
      description: `Meeting requested via email from ${email.from}.\n\nOriginal email:\n${email.body}`,
      startTime: requestedStart,
      endTime: requestedEnd,
      attendeeEmail: analysis.requesterEmail,
    });

    log('event_added', `Event added: "${analysis.purpose}" on ${analysis.requestedDate} at ${analysis.requestedTime}`, {
      eventId: event.id,
      emailId: email.id,
      summary: analysis.purpose,
      start: requestedStart.toISOString(),
    });

    // ── Step 6: Send confirmation email ──
    const confirmBody = await claude.generateAcceptReply({
      requesterName: analysis.requesterName,
      purpose: analysis.purpose,
      startTime: requestedStart,
      endTime: requestedEnd,
    });

    await google.sendEmail({
      to: analysis.requesterEmail,
      subject: `Re: ${email.subject}`,
      body: confirmBody,
      threadId: email.threadId,
    });

    log('email_received', `Confirmation sent to ${analysis.requesterEmail}`, {
      emailId: email.id,
      to: analysis.requesterEmail,
    });

  } catch (err) {
    log('error', `Failed to add event or send reply: ${err.message}`, { emailId: email.id });
  }

  await google.markAsRead(email.id);
}

async function sendDeclineAndSuggest(email, analysis, requestedDate, reason) {
  // Find free slots on nearby dates
  let alternativeSlots = [];
  try {
    // Check next 3 working days
    for (let d = 0; d < 5 && alternativeSlots.length < 3; d++) {
      const checkDate = new Date(requestedDate);
      checkDate.setDate(checkDate.getDate() + d);
      // Skip weekends
      if (checkDate.getDay() === 0 || checkDate.getDay() === 6) continue;

      const slots = await google.findFreeSlots(checkDate, analysis.durationMinutes || 60);
      alternativeSlots = [...alternativeSlots, ...slots.slice(0, 2)];
    }
  } catch (err) {
    log('error', `Could not find alternative slots: ${err.message}`);
  }

  const declineBody = await claude.generateDeclineReply({
    requesterName: analysis.requesterName,
    purpose: analysis.purpose,
    requestedDate: analysis.requestedDate,
    requestedTime: analysis.requestedTime,
    alternativeSlots,
    userEmail: process.env.USER_EMAIL,
  });

  await google.sendEmail({
    to: analysis.requesterEmail,
    subject: `Re: ${email.subject}`,
    body: declineBody,
    threadId: email.threadId,
  });

  log('declined', `Declined and suggested alternatives to ${analysis.requesterEmail} (reason: ${reason})`, {
    emailId: email.id,
    reason,
    alternativesCount: alternativeSlots.length,
  });
}

module.exports = { processNewEmails, processEmail, getLog, log };
