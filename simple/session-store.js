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

function createSession({ anchors }) {
  const id = crypto.randomBytes(16).toString('hex');
  const session = {
    id,
    anchors: anchors.map(a => ({
      provider: a.provider,
      handle: a.handle.toLowerCase().trim(),
      profile: null,
    })),
    state: 'PENDING', // PENDING → PARTIAL → MATCHED → CONFIRMED
    candidateWords: [],
    selectedWords: [],
    createdAt: Date.now(),
    pollListeners: [], // SSE response objects waiting for updates (verifier side)
    presenterPollListeners: [], // SSE response objects for presenter waiting for confirmation
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

function matchAnchor(id, provider, profile) {
  const session = getSession(id);
  if (!session) return null;

  // Find the unmatched anchor for this provider
  const anchor = session.anchors.find(a => a.provider === provider && !a.profile);
  if (!anchor) return null;

  anchor.profile = profile;

  const completedCount = session.anchors.filter(a => a.profile !== null).length;
  const totalCount = session.anchors.length;
  const allMatched = completedCount === totalCount;

  if (allMatched) {
    session.state = 'MATCHED';
    // Build anchor data for SSE (exclude sub from each profile for privacy)
    const anchorData = session.anchors.map(a => {
      const { sub, ...clientProfile } = a.profile;
      return { provider: a.provider, profile: clientProfile };
    });
    for (const listener of session.pollListeners) {
      try {
        listener.write(`data: ${JSON.stringify({ state: 'MATCHED', anchors: anchorData })}\n\n`);
        listener.end();
      } catch (e) { /* client may have disconnected */ }
    }
    session.pollListeners = [];
  } else {
    session.state = 'PARTIAL';
    // Send progress update (keep SSE connection open)
    const { sub, ...lastProfile } = profile;
    for (const listener of session.pollListeners) {
      try {
        listener.write(`data: ${JSON.stringify({
          state: 'PARTIAL',
          completed: completedCount,
          total: totalCount,
          lastProvider: provider,
          lastProfile,
        })}\n\n`);
      } catch (e) { /* client may have disconnected */ }
    }
  }

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

function confirmSession(id) {
  const session = getSession(id);
  if (!session) return null;
  if (session.state !== 'MATCHED') return null;

  session.state = 'CONFIRMED';

  // Notify all presenter poll listeners that verification is confirmed
  for (const listener of session.presenterPollListeners) {
    try {
      listener.write(`data: ${JSON.stringify({ state: 'CONFIRMED' })}\n\n`);
      listener.end();
    } catch (e) { /* client may have disconnected */ }
  }
  session.presenterPollListeners = [];

  return session;
}

function rejectSession(id) {
  const session = getSession(id);
  if (!session) return null;
  if (session.state !== 'MATCHED') return null;

  session.state = 'REJECTED';

  // Notify all presenter poll listeners that verification was rejected
  for (const listener of session.presenterPollListeners) {
    try {
      listener.write(`data: ${JSON.stringify({ state: 'REJECTED' })}\n\n`);
      listener.end();
    } catch (e) { /* client may have disconnected */ }
  }
  session.presenterPollListeners = [];

  return session;
}

function addPresenterPollListener(id, res) {
  const session = getSession(id);
  if (!session) return false;
  if (session.state === 'CONFIRMED') return false; // Already confirmed
  session.presenterPollListeners.push(res);
  return true;
}

function removePresenterPollListener(id, res) {
  const session = getSession(id);
  if (!session) return;
  session.presenterPollListeners = session.presenterPollListeners.filter(l => l !== res);
}

// Find a pending or partial session by presenter handle and provider
function findSessionByPresenter(handle, provider) {
  const normalized = handle.toLowerCase().trim();
  for (const [, session] of sessions) {
    if (Date.now() - session.createdAt > SESSION_TTL_MS) continue;
    if (session.state === 'MATCHED') continue; // Already fully matched
    const anchor = session.anchors.find(a =>
      a.provider === provider && a.handle === normalized
    );
    if (anchor) return session;
  }
  return null;
}

module.exports = {
  createSession,
  getSession,
  setCandidateWords,
  setSelectedWords,
  matchAnchor,
  confirmSession,
  rejectSession,
  addPollListener,
  removePollListener,
  addPresenterPollListener,
  removePresenterPollListener,
  findSessionByPresenter,
};
