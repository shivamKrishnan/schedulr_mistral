// services/mistral.js
// Uses Mistral AI API for email analysis and natural language calendar management

const { Mistral } = require('@mistralai/mistralai');

// Ensure MISTRAL_API_KEY is set in your .env file
const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
const MODEL = "mistral-large-latest";

// ─── Email Analysis ───────────────────────────────────────────────────────────

async function analyzeEmail(emailBody, emailSubject, emailFrom) {
  const prompt = `You are an AI that analyzes emails to detect meeting/appointment requests.
  
  Analyze the following email and extract the details into a structured JSON format.
  
  Email details:
  From: ${emailFrom}
  Subject: ${emailSubject}
  Body:
  ${emailBody}

  Return a JSON object with these keys:
  {
    "isMeetingRequest": boolean,
    "requestedDate": "YYYY-MM-DD" or null,
    "requestedTime": "HH:MM" (24h) or null,
    "durationMinutes": number (default 60 if not specified),
    "purpose": "brief description",
    "requesterName": "sender name",
    "requesterEmail": "${emailFrom}",
    "confidence": "high", "medium", or "low",
    "notes": "context"
  }`;

  try {
    const response = await client.chat.complete({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      responseFormat: { type: "json_object" } // Enforces valid JSON output
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (err) {
    console.error('Mistral Analysis Error:', err);
    return {
      isMeetingRequest: false,
      confidence: 'low',
      notes: 'Failed to parse response',
    };
  }
}

// ─── Reply Generation ─────────────────────────────────────────────────────────

async function generateDeclineReply({ requesterName, purpose, requestedDate, requestedTime, alternativeSlots }) {
  const slotsText = alternativeSlots
    .slice(0, 3)
    .map(s => {
      const d = new Date(s.start);
      return d.toLocaleString('en-IN', {
        weekday: 'long', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
      });
    })
    .join(', ');

  const prompt = `Write a professional, friendly email reply declining a meeting request because the time is unavailable or outside office hours (9AM-8PM).
  
  Details:
  - Name: ${requesterName || 'there'}
  - Purpose: ${purpose || 'the meeting'}
  - Requested: ${requestedDate} at ${requestedTime}
  - Suggested Alternatives: ${slotsText || 'please suggest a different time'}
  
  Write only the email body. Keep it warm and concise.`;

  const response = await client.chat.complete({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }]
  });

  return response.choices[0].message.content.trim();
}

async function generateAcceptReply({ requesterName, purpose, startTime }) {
  const timeStr = new Date(startTime).toLocaleString('en-IN', {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });

  const prompt = `Write a brief (2-3 sentences) professional confirmation email accepting a meeting.
  
  Details:
  - Name: ${requesterName || 'there'}
  - Purpose: ${purpose || 'the meeting'}
  - Confirmed Time: ${timeStr}
  
  Mention that a calendar invite has been sent. Write only the email body.`;

  const response = await client.chat.complete({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }]
  });

  return response.choices[0].message.content.trim();
}

// ─── Chat Assistant ───────────────────────────────────────────────────────────

async function chatWithAssistant({ message, history, calendarContext }) {
  const systemPrompt = `You are a smart scheduling assistant with access to the user's Google Calendar.
  
  Today is: ${new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
  Current time: ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
  Office hours: ${process.env.OFFICE_HOURS_START || 9}:00 AM to ${process.env.OFFICE_HOURS_END || 20}:00 PM
  
  Current Calendar Context (Next 7 Days):
  ${calendarContext || 'No events found.'}
  
  Capabilities:
  - Add events: ACTION:ADD_EVENT:{"summary":"title","date":"YYYY-MM-DD","startHour":14,"startMinute":0,"durationMinutes":60,"description":""}
  - Delete events: ACTION:DELETE_EVENT:{"eventId":"abc123","summary":"title"}
  
  Instructions:
  1. Keep replies short and friendly.
  2. If the user wants to schedule outside office hours, politely decline.
  3. ALWAYS place the ACTION tag at the very end of your response if an action is required.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: message },
  ];

  try {
    const response = await client.chat.complete({
      model: MODEL,
      messages: messages,
    });

    const fullText = response.choices[0].message.content.trim();

    // Parse actions and separate from display text
    const action = parseAction(fullText);
    const displayText = fullText.replace(/ACTION:\w+:\{.*\}$/s, '').trim();

    return { text: displayText, action };
  } catch (err) {
    console.error('Chat Assistant Error:', err);
    throw new Error('Assistant failed to respond.');
  }
}

function parseAction(text) {
  const addMatch = text.match(/ACTION:ADD_EVENT:(\{.*\})/s);
  if (addMatch) {
    try { return { type: 'ADD_EVENT', data: JSON.parse(addMatch[1]) }; } catch { return null; }
  }

  const delMatch = text.match(/ACTION:DELETE_EVENT:(\{.*\})/s);
  if (delMatch) {
    try { return { type: 'DELETE_EVENT', data: JSON.parse(delMatch[1]) }; } catch { return null; }
  }

  return null;
}

module.exports = { analyzeEmail, generateDeclineReply, generateAcceptReply, chatWithAssistant };