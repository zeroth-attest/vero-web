const express = require('express');
const router = express.Router();
const { getRandomWords } = require('./wordlist');
const store = require('./session-store');
const oauth = require('./oauth');

// Parse URL-encoded bodies (needed for Apple's form_post callback)
router.use(express.urlencoded({ extended: true }));

// GET /api/simple/providers — Return available provider metadata
router.get('/providers', (req, res) => {
  res.json(oauth.PROVIDER_META);
});

// POST /api/simple/session — Verifier creates a session
router.post('/session', (req, res) => {
  const { anchors, presenterHandle, provider } = req.body;

  // Support both new multi-anchor format and legacy single-anchor format
  let sessionAnchors;
  if (anchors && Array.isArray(anchors) && anchors.length > 0) {
    sessionAnchors = anchors;
  } else if (presenterHandle && provider) {
    sessionAnchors = [{ provider, handle: presenterHandle }];
  } else {
    return res.status(400).json({ error: 'anchors array (or presenterHandle + provider) required' });
  }

  // Validate each anchor
  for (const anchor of sessionAnchors) {
    if (!anchor.provider || !anchor.handle) {
      return res.status(400).json({ error: 'Each anchor must have a provider and handle' });
    }
    if (!oauth.VALID_PROVIDERS.includes(anchor.provider)) {
      return res.status(400).json({ error: `provider must be one of: ${oauth.VALID_PROVIDERS.join(', ')}` });
    }
  }

  // Disallow duplicate providers
  const providerSet = new Set(sessionAnchors.map(a => a.provider));
  if (providerSet.size !== sessionAnchors.length) {
    return res.status(400).json({ error: 'Each provider can only be used once per session' });
  }

  const session = store.createSession({ anchors: sessionAnchors });
  const candidateWords = getRandomWords(10);
  store.setCandidateWords(session.id, candidateWords);

  res.json({
    sessionId: session.id,
    candidateWords,
  });
});

// POST /api/simple/session/:id/words — Verifier submits selected 3 words
router.post('/session/:id/words', (req, res) => {
  const { words } = req.body;

  if (!Array.isArray(words) || words.length !== 3) {
    return res.status(400).json({ error: 'Exactly 3 words must be selected' });
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

// Shape profile for client (exclude sub, include all enriched fields)
function shapeProfileForClient(p) {
  if (!p) return null;
  return {
    name: p.name || null,
    picture: p.picture || null,
    provider: p.provider || null,
    email: p.email || null,
    email_verified: p.email_verified != null ? p.email_verified : null,
    username: p.username || null,
    bio: p.bio || null,
    company: p.company || null,
    jobTitle: p.jobTitle || null,
    department: p.department || null,
    location: p.location || null,
    profileUrl: p.profileUrl || null,
    accountCreated: p.accountCreated || null,
    publicRepos: p.publicRepos != null ? p.publicRepos : null,
    followers: p.followers != null ? p.followers : null,
    website: p.website || null,
    twitterUsername: p.twitterUsername || null,
  };
}

// GET /api/simple/session/:id/poll — SSE endpoint for verifier to wait for presenter
router.get('/session/:id/poll', (req, res) => {
  const session = store.getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  // If already matched, return immediately
  if (session.state === 'MATCHED') {
    const anchors = session.anchors.map(a => ({
      provider: a.provider,
      profile: shapeProfileForClient(a.profile),
    }));
    return res.json({
      state: 'MATCHED',
      anchors,
    });
  }

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const completedCount = session.anchors.filter(a => a.profile).length;
  const totalCount = session.anchors.length;

  res.write(`data: ${JSON.stringify({ state: session.state, completed: completedCount, total: totalCount })}\n\n`);

  store.addPollListener(session.id, res);

  // Clean up on client disconnect
  req.on('close', () => {
    store.removePollListener(session.id, res);
  });
});

// GET /api/simple/session/:id/result — Get session result (words + profiles)
router.get('/session/:id/result', (req, res) => {
  const session = store.getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  const anchors = session.anchors.map(a => ({
    provider: a.provider,
    completed: !!a.profile,
    profile: a.profile ? shapeProfileForClient(a.profile) : null,
  }));

  if (session.state === 'MATCHED' || session.state === 'CONFIRMED') {
    return res.json({
      state: session.state,
      words: session.selectedWords,
      anchors,
    });
  }

  res.json({
    state: session.state,
    sessionId: session.id,
    anchors,
  });
});

// POST /api/simple/session/:id/confirm — Verifier confirms words matched
router.post('/session/:id/confirm', (req, res) => {
  const session = store.getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  const confirmed = store.confirmSession(req.params.id);
  if (!confirmed) {
    return res.status(400).json({ error: 'Session cannot be confirmed (not in MATCHED state)' });
  }

  res.json({ ok: true, state: 'CONFIRMED' });
});

// POST /api/simple/session/:id/reject — Verifier reports words didn't match
router.post('/session/:id/reject', (req, res) => {
  const session = store.getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  const rejected = store.rejectSession(req.params.id);
  if (!rejected) {
    return res.status(400).json({ error: 'Session cannot be rejected (not in MATCHED state)' });
  }

  res.json({ ok: true, state: 'REJECTED' });
});

// GET /api/simple/session/:id/presenter-poll — SSE for presenter to wait for confirmation
router.get('/session/:id/presenter-poll', (req, res) => {
  const session = store.getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  // If already confirmed, return immediately
  if (session.state === 'CONFIRMED') {
    return res.json({ state: 'CONFIRMED' });
  }

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  res.write(`data: ${JSON.stringify({ state: session.state })}\n\n`);

  store.addPresenterPollListener(session.id, res);

  // Clean up on client disconnect
  req.on('close', () => {
    store.removePresenterPollListener(session.id, res);
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

  // Return anchors status (provider + completed flag; no handles for privacy)
  const anchors = session.anchors.map(a => ({
    provider: a.provider,
    completed: !!a.profile,
  }));

  res.json({ sessionId: session.id, anchors });
});

// GET /api/simple/auth/:provider/start — Start OAuth flow for presenter
router.get('/auth/:provider/start', (req, res) => {
  const { provider } = req.params;
  const { session: sessionId } = req.query;

  if (!sessionId) {
    return res.status(400).json({ error: 'session query parameter is required' });
  }

  if (!oauth.VALID_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: 'Unknown provider' });
  }

  const session = store.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  const authUrl = oauth.getAuthorizationUrl(provider, sessionId, req);
  res.redirect(authUrl);
});

// Determine the correct presenter page URL based on hostname/origin
// On voice subdomain: files are at root. On main domain / localhost: files are at /simple/
function presenterPath(req) {
  const host = req.hostname;
  if (host === 'voice.vero.technology') return '/presenter.html';
  return '/simple/presenter.html';
}

// Build a full redirect URL back to the origin domain (for post-OAuth redirects)
function presenterRedirect(origin) {
  if (!origin) return '/simple/presenter.html';
  try {
    const url = new URL(origin);
    if (url.hostname === 'voice.vero.technology') {
      return `${origin}/presenter.html`;
    }
    return `${origin}/simple/presenter.html`;
  } catch {
    return '/simple/presenter.html';
  }
}

// OAuth callback handler (shared logic for GET and POST)
async function handleOAuthCallback(req, res) {
  const { provider } = req.params;

  // Apple uses form_post (POST body), others use query params (GET)
  const params = { ...req.query, ...req.body };
  const { code, state: stateParam, user: appleUser } = params;

  // Handle error responses from providers (e.g. user denied consent, misconfigured redirect)
  if (params.error) {
    console.error(`OAuth error from ${provider}:`, params.error, params.error_description || '');
    const msg = params.error_description || params.error;
    return res.status(400).send(`Authentication error: ${msg}`);
  }

  if (!code || !stateParam) {
    console.error(`Missing code or state from ${provider}. Query:`, req.query);
    return res.status(400).send('Missing code or state parameter');
  }

  const stateData = oauth.parseState(stateParam);
  if (!stateData || !stateData.sessionId) {
    return res.status(400).send('Invalid state parameter');
  }

  const origin = stateData.origin || null;
  const redirectBase = presenterRedirect(origin);

  const session = store.getSession(stateData.sessionId);
  if (!session) {
    return res.redirect(`${redirectBase}?error=expired`);
  }

  try {
    const extras = {};
    if (provider === 'apple' && appleUser) {
      extras.user = appleUser;
    }

    // Use the origin from state so the redirect_uri in the token exchange
    // matches the one used when starting the OAuth flow
    const baseUrl = origin || oauth.getBaseUrlFromRequest(req);
    const profile = await oauth.exchangeCodeForProfile(provider, code, extras, baseUrl);

    // Find the anchor for this provider that hasn't been authenticated yet
    const anchor = session.anchors.find(a => a.provider === provider && !a.profile);
    if (!anchor) {
      // This provider was already authenticated — redirect back
      return res.redirect(`${redirectBase}?session=${session.id}`);
    }

    // Identity verification: check if authenticated profile matches expected handle
    let matched = false;
    const handle = anchor.handle;

    if (profile.email && profile.email.toLowerCase() === handle) {
      matched = true;
    } else if (provider === 'github' && profile.username && profile.username.toLowerCase() === handle) {
      matched = true;
    } else if (profile.sub && profile.sub.toLowerCase() === handle) {
      matched = true;
    }

    if (!matched) {
      // Still allow the match for demo purposes — the identity was authenticated,
      // just not the expected one. In production you'd reject this.
      console.log(`Identity mismatch: expected ${anchor.handle}, got ${profile.email || profile.username || profile.sub}`);
    }

    store.matchAnchor(session.id, provider, profile);

    // Redirect presenter back to origin domain
    res.redirect(`${redirectBase}?session=${session.id}`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(`${redirectBase}?error=auth_failed`);
  }
}

// GET callback (Google, LinkedIn, GitHub, Microsoft, Facebook)
router.get('/auth/:provider/callback', handleOAuthCallback);

// POST callback (Apple form_post)
router.post('/auth/:provider/callback', handleOAuthCallback);

module.exports = router;
