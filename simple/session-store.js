const crypto = require('crypto');

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // Check every minute

const sessions = new Map();

// Periodic cleanup of expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}, CLEANUP_INTERVAL_MS);

function createSession({ presenterHandle, provider }) {
  const id = crypto.randomBytes(16).toString('hex');
  const session = {
    id,
    presenterHandle: presenterHandle.toLowerCase().trim(),
    provider, // 'google' or 'linkedin'
    state: 'PENDING',
    candidateWords: [],
    selectedWords: [],
    presenterProfile: null,
    createdAt: Date.now(),
    pollListeners: [], // SSE response objects waiting for updates
  };
  sessions.set(id, session);
  return session;
}

function getSession(id) {
  const session = sessions.get(id);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(id);
    return null;
  }
  return session;
}

function setCandidateWords(id, words) {
  const session = getSession(id);
  if (!session) return null;
  session.candidateWords = words;
  return session;
}

function setSelectedWords(id, words) {
  const session = getSession(id);
  if (!session) return null;
  session.selectedWords = words;
  return session;
}

function matchPresenter(id, profile) {
  const session = getSession(id);
  if (!session || session.state !== 'PENDING') return null;
  session.presenterProfile = profile;
  session.state = 'MATCHED';

  // Notify all SSE listeners
  for (const listener of session.pollListeners) {
    try {
      listener.write(`data: ${JSON.stringify({ state: 'MATCHED', profile: { name: profile.name, picture: profile.picture } })}\n\n`);
      listener.end();
    } catch (e) { /* client may have disconnected */ }
  }
  session.pollListeners = [];

  return session;
}

function addPollListener(id, res) {
  const session = getSession(id);
  if (!session) return false;
  if (session.state === 'MATCHED') return false; // Already matched, caller should check
  session.pollListeners.push(res);
  return true;
}

function removePollListener(id, res) {
  const session = getSession(id);
  if (!session) return;
  session.pollListeners = session.pollListeners.filter(l => l !== res);
}

// Find a pending session by presenter handle and provider
function findSessionByPresenter(handle, provider) {
  const normalized = handle.toLowerCase().trim();
  for (const [, session] of sessions) {
    if (
      session.state === 'PENDING' &&
      session.provider === provider &&
      session.presenterHandle === normalized &&
      Date.now() - session.createdAt <= SESSION_TTL_MS
    ) {
      return session;
    }
  }
  return null;
}

module.exports = {
  createSession,
  getSession,
  setCandidateWords,
  setSelectedWords,
  matchPresenter,
  addPollListener,
  removePollListener,
  findSessionByPresenter,
};
