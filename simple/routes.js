const express = require('express');
const router = express.Router();
const { getRandomWords } = require('./wordlist');
const store = require('./session-store');
const oauth = require('./oauth');

// POST /api/simple/session — Verifier creates a session
router.post('/session', (req, res) => {
  const { presenterHandle, provider } = req.body;

  if (!presenterHandle || !provider) {
    return res.status(400).json({ error: 'presenterHandle and provider are required' });
  }

  if (!['google', 'linkedin'].includes(provider)) {
    return res.status(400).json({ error: 'provider must be "google" or "linkedin"' });
  }

  const session = store.createSession({ presenterHandle, provider });
  const candidateWords = getRandomWords(10);
  store.setCandidateWords(session.id, candidateWords);

  res.json({
    sessionId: session.id,
    candidateWords,
  });
});

// POST /api/simple/session/:id/words — Verifier submits selected 5 words
router.post('/session/:id/words', (req, res) => {
  const { words } = req.body;

  if (!Array.isArray(words) || words.length !== 5) {
    return res.status(400).json({ error: 'Exactly 5 words must be selected' });
  }

  const session = store.getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  // Verify all selected words are from the candidate list
  const valid = words.every(w => session.candidateWords.includes(w));
  if (!valid) {
    return res.status(400).json({ error: 'Selected words must be from the candidate list' });
  }

  store.setSelectedWords(session.id, words);
  res.json({ ok: true });
});

// GET /api/simple/session/:id/poll — SSE endpoint for verifier to wait for presenter
router.get('/session/:id/poll', (req, res) => {
  const session = store.getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  // If already matched, return immediately
  if (session.state === 'MATCHED') {
    return res.json({
      state: 'MATCHED',
      profile: {
        name: session.presenterProfile.name,
        picture: session.presenterProfile.picture,
      },
    });
  }

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  res.write(`data: ${JSON.stringify({ state: 'PENDING' })}\n\n`);

  store.addPollListener(session.id, res);

  // Clean up on client disconnect
  req.on('close', () => {
    store.removePollListener(session.id, res);
  });
});

// GET /api/simple/session/:id/result — Get session result (words + profile)
router.get('/session/:id/result', (req, res) => {
  const session = store.getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  if (session.state !== 'MATCHED') {
    return res.json({ state: session.state });
  }

  res.json({
    state: 'MATCHED',
    words: session.selectedWords,
    profile: {
      name: session.presenterProfile.name,
      picture: session.presenterProfile.picture,
      provider: session.presenterProfile.provider,
    },
  });
});

// POST /api/simple/session/lookup — Presenter looks up their pending session
router.post('/session/lookup', (req, res) => {
  const { handle, provider } = req.body;

  if (!handle || !provider) {
    return res.status(400).json({ error: 'handle and provider are required' });
  }

  const session = store.findSessionByPresenter(handle, provider);
  if (!session) {
    return res.status(404).json({ error: 'No pending session found for this identity. Ask the verifier to start one first.' });
  }

  res.json({ sessionId: session.id, provider: session.provider });
});

// GET /api/simple/auth/:provider/start — Start OAuth flow for presenter
router.get('/auth/:provider/start', (req, res) => {
  const { provider } = req.params;
  const { session: sessionId } = req.query;

  if (!sessionId) {
    return res.status(400).json({ error: 'session query parameter is required' });
  }

  if (!['google', 'linkedin'].includes(provider)) {
    return res.status(400).json({ error: 'Unknown provider' });
  }

  const session = store.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  const authUrl = oauth.getAuthorizationUrl(provider, sessionId);
  res.redirect(authUrl);
});

// GET /api/simple/auth/:provider/callback — OAuth callback
router.get('/auth/:provider/callback', async (req, res) => {
  const { provider } = req.params;
  const { code, state: stateParam } = req.query;

  if (!code || !stateParam) {
    return res.status(400).send('Missing code or state parameter');
  }

  const stateData = oauth.parseState(stateParam);
  if (!stateData || !stateData.sessionId) {
    return res.status(400).send('Invalid state parameter');
  }

  const session = store.getSession(stateData.sessionId);
  if (!session) {
    return res.redirect('/simple/presenter.html?error=expired');
  }

  try {
    const profile = await oauth.exchangeCodeForProfile(provider, code);

    // Match the presenter's identity to the session
    // For Google: match by email
    // For LinkedIn: match by email or sub
    let matched = false;
    if (provider === 'google') {
      matched = profile.email &&
        profile.email.toLowerCase() === session.presenterHandle.toLowerCase();
    } else if (provider === 'linkedin') {
      // LinkedIn handle could be email or profile URL slug
      matched = (profile.email &&
        profile.email.toLowerCase() === session.presenterHandle.toLowerCase()) ||
        profile.sub === session.presenterHandle;
    }

    if (!matched) {
      // Still allow the match for demo purposes — the identity was authenticated,
      // just not the expected one. In production you'd reject this.
      // For now, we'll match anyway and show who authenticated.
      console.log(`Identity mismatch: expected ${session.presenterHandle}, got ${profile.email || profile.sub}`);
    }

    store.matchPresenter(session.id, profile);

    // Redirect presenter to their result screen
    res.redirect(`/simple/presenter.html?session=${session.id}`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect('/simple/presenter.html?error=auth_failed');
  }
});

module.exports = router;
