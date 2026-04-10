// Messaging module for Vero Voice verification delivery (SMS via Twilio, Email via nodemailer)

let twilioClient = null;
let emailTransport = null;

// --- Lazy initialization ---

function getTwilioClient() {
  if (twilioClient) return twilioClient;

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!sid || !token) {
    throw new Error('Twilio credentials not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)');
  }

  const twilio = require('twilio');
  twilioClient = twilio(sid, token);
  return twilioClient;
}

function getEmailTransport() {
  if (emailTransport) return emailTransport;

  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP credentials not configured (SMTP_HOST, SMTP_USER, SMTP_PASS)');
  }

  const nodemailer = require('nodemailer');
  emailTransport = nodemailer.createTransport({
    host,
    port: parseInt(port, 10) || 587,
    secure: parseInt(port, 10) === 465,
    auth: { user, pass },
  });
  return emailTransport;
}

// --- Sending helpers ---

async function sendSms(to, body) {
  const client = getTwilioClient();
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!from) {
    throw new Error('TWILIO_PHONE_NUMBER not configured');
  }

  try {
    const message = await client.messages.create({ body, from, to });
    return message.sid;
  } catch (err) {
    console.error('SMS send failed:', err.message);
    throw err;
  }
}

async function sendEmail(to, subject, text) {
  const transport = getEmailTransport();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  try {
    const info = await transport.sendMail({ from, to, subject, text });
    return info.messageId;
  } catch (err) {
    console.error('Email send failed:', err.message);
    throw err;
  }
}

// --- Public API ---

/**
 * Send verification words directly to a sole SMS/email anchor.
 * @param {'sms'|'email'} type - delivery channel
 * @param {string} handle - phone number or email address
 * @param {string[]} words - the 3 secret words
 */
async function sendVerificationWords(type, handle, words) {
  const wordList = words.join(', ');
  const body = `Your Vero verification words are: ${wordList}. Read these aloud when asked.`;

  if (type === 'sms') {
    return sendSms(handle, body);
  } else if (type === 'email') {
    return sendEmail(handle, 'Vero Voice Verification', body);
  } else {
    throw new Error(`Unsupported message type: ${type}`);
  }
}

/**
 * Send a 6-digit PIN for multi-anchor verification sessions.
 * @param {'sms'|'email'} type - delivery channel
 * @param {string} handle - phone number or email address
 * @param {string} pin - the 6-digit PIN
 */
async function sendVerificationPin(type, handle, pin) {
  const body = `Your Vero verification PIN is: ${pin}. Enter this on the verification screen.`;

  if (type === 'sms') {
    return sendSms(handle, body);
  } else if (type === 'email') {
    return sendEmail(handle, 'Vero Voice Verification PIN', body);
  } else {
    throw new Error(`Unsupported message type: ${type}`);
  }
}

/**
 * Check whether the given delivery channel has credentials configured.
 * @param {'sms'|'email'} type - delivery channel
 * @returns {boolean}
 */
function isConfigured(type) {
  if (type === 'sms') {
    return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
  } else if (type === 'email') {
    return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  }
  return false;
}

module.exports = { sendVerificationWords, sendVerificationPin, isConfigured };
