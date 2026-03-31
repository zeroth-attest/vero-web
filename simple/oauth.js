const crypto = require('crypto');

// OAuth provider configurations
const providers = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scopes: 'openid profile email',
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
  },
  linkedin: {
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    userinfoUrl: 'https://api.linkedin.com/v2/userinfo',
    scopes: 'openid profile email',
    clientId: () => process.env.LINKEDIN_CLIENT_ID,
    clientSecret: () => process.env.LINKEDIN_CLIENT_SECRET,
  },
};

function getCallbackUrl(provider) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:8080';
  return `${baseUrl}/api/simple/auth/${provider}/callback`;
}

function getAuthorizationUrl(provider, sessionId) {
  const config = providers[provider];
  if (!config) throw new Error(`Unknown provider: ${provider}`);

  const state = Buffer.from(JSON.stringify({
    sessionId,
    nonce: crypto.randomBytes(8).toString('hex'),
  })).toString('base64url');

  const params = new URLSearchParams({
    client_id: config.clientId(),
    redirect_uri: getCallbackUrl(provider),
    response_type: 'code',
    scope: config.scopes,
    state,
  });

  return `${config.authUrl}?${params.toString()}`;
}

async function exchangeCodeForProfile(provider, code) {
  const config = providers[provider];
  if (!config) throw new Error(`Unknown provider: ${provider}`);

  // Exchange code for tokens
  const tokenRes = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId(),
      client_secret: config.clientSecret(),
      code,
      grant_type: 'authorization_code',
      redirect_uri: getCallbackUrl(provider),
    }).toString(),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  const tokens = await tokenRes.json();

  // Fetch user profile
  const profileRes = await fetch(config.userinfoUrl, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!profileRes.ok) {
    throw new Error('Failed to fetch user profile');
  }

  const profile = await profileRes.json();

  return {
    sub: profile.sub,
    name: profile.name,
    email: profile.email,
    picture: profile.picture,
    provider,
  };
}

function parseState(stateParam) {
  try {
    return JSON.parse(Buffer.from(stateParam, 'base64url').toString());
  } catch {
    return null;
  }
}

module.exports = {
  providers,
  getAuthorizationUrl,
  exchangeCodeForProfile,
  parseState,
};
