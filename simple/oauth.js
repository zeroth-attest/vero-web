const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// ──────────────────────────────────────────────
// Provider display metadata (shared with frontend)
// ──────────────────────────────────────────────
const PROVIDER_META = {
  google:    { label: 'Google',    icon: 'google',    handleLabel: 'Gmail address',                handlePlaceholder: 'name@gmail.com' },
  linkedin:  { label: 'LinkedIn',  icon: 'linkedin',  handleLabel: 'LinkedIn handle or email',     handlePlaceholder: 'jane-doe or name@email.com' },
  github:    { label: 'GitHub',    icon: 'github',    handleLabel: 'GitHub username or email',     handlePlaceholder: 'octocat or name@email.com' },
  microsoft: { label: 'Microsoft', icon: 'microsoft', handleLabel: 'Microsoft / Outlook email',    handlePlaceholder: 'name@outlook.com' },
  facebook:  { label: 'Facebook',  icon: 'facebook',  handleLabel: 'Facebook email',               handlePlaceholder: 'name@email.com' },
  apple:     { label: 'Apple',     icon: 'apple',     handleLabel: 'Apple ID email',               handlePlaceholder: 'name@icloud.com' },
};

const VALID_PROVIDERS = Object.keys(PROVIDER_META);

// ──────────────────────────────────────────────
// OAuth provider configurations
// ──────────────────────────────────────────────
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
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userinfoUrl: 'https://api.github.com/user',
    emailUrl: 'https://api.github.com/user/emails',
    scopes: 'read:user user:email',
    clientId: () => process.env.GITHUB_CLIENT_ID,
    clientSecret: () => process.env.GITHUB_CLIENT_SECRET,
  },
  microsoft: {
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userinfoUrl: 'https://graph.microsoft.com/v1.0/me',
    scopes: 'openid profile email User.Read',
    clientId: () => process.env.MICROSOFT_CLIENT_ID,
    clientSecret: () => process.env.MICROSOFT_CLIENT_SECRET,
  },
  facebook: {
    authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    userinfoUrl: 'https://graph.facebook.com/v19.0/me?fields=id,name,email,picture.width(200).height(200)',
    scopes: 'public_profile email',
    clientId: () => process.env.FACEBOOK_CLIENT_ID,
    clientSecret: () => process.env.FACEBOOK_CLIENT_SECRET,
  },
  apple: {
    authUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    scopes: 'name email',
    clientId: () => process.env.APPLE_CLIENT_ID,
    // Apple uses a JWT client secret — generated on the fly
    clientSecret: () => generateAppleClientSecret(),
  },
};

// ──────────────────────────────────────────────
// Apple JWT client secret generation
// ──────────────────────────────────────────────
function generateAppleClientSecret() {
  const privateKey = process.env.APPLE_PRIVATE_KEY;
  if (!privateKey) throw new Error('APPLE_PRIVATE_KEY not configured');

  // The private key might be stored with escaped newlines
  const formattedKey = privateKey.replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: process.env.APPLE_TEAM_ID,
      iat: now,
      exp: now + 86400 * 180, // 6 months max
      aud: 'https://appleid.apple.com',
      sub: process.env.APPLE_CLIENT_ID,
    },
    formattedKey,
    {
      algorithm: 'ES256',
      header: { kid: process.env.APPLE_KEY_ID },
    }
  );
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
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

  // Apple-specific: use form_post so callback receives a POST
  if (provider === 'apple') {
    params.set('response_mode', 'form_post');
  }

  return `${config.authUrl}?${params.toString()}`;
}

// ──────────────────────────────────────────────
// Profile extraction (per-provider)
// ──────────────────────────────────────────────
async function exchangeCodeForProfile(provider, code, extras = {}) {
  const config = providers[provider];
  if (!config) throw new Error(`Unknown provider: ${provider}`);

  // -- Token exchange --
  const tokenHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };
  // GitHub needs Accept header for JSON response
  if (provider === 'github') {
    tokenHeaders['Accept'] = 'application/json';
  }

  const tokenRes = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: tokenHeaders,
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
    throw new Error(`Token exchange failed for ${provider}: ${err}`);
  }

  const tokens = await tokenRes.json();

  // -- Provider-specific profile extraction --
  switch (provider) {
    case 'apple':
      return extractAppleProfile(tokens, extras);
    case 'github':
      return extractGitHubProfile(tokens);
    case 'microsoft':
      return extractMicrosoftProfile(tokens);
    case 'facebook':
      return extractFacebookProfile(tokens);
    default:
      // Google, LinkedIn — standard OIDC userinfo
      return extractStandardProfile(provider, tokens);
  }
}

async function extractStandardProfile(provider, tokens) {
  const config = providers[provider];
  const profileRes = await fetch(config.userinfoUrl, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileRes.ok) throw new Error(`Failed to fetch ${provider} profile`);
  const profile = await profileRes.json();
  return {
    sub: profile.sub,
    name: profile.name,
    email: profile.email,
    picture: profile.picture,
    provider,
  };
}

async function extractGitHubProfile(tokens) {
  // Fetch user profile
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!userRes.ok) throw new Error('Failed to fetch GitHub profile');
  const user = await userRes.json();

  // Fetch primary email (may be private)
  let email = user.email;
  if (!email) {
    try {
      const emailRes = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: 'application/vnd.github+json',
        },
      });
      if (emailRes.ok) {
        const emails = await emailRes.json();
        const primary = emails.find(e => e.primary && e.verified);
        email = primary ? primary.email : (emails[0] && emails[0].email);
      }
    } catch { /* email stays null */ }
  }

  return {
    sub: String(user.id),
    name: user.name || user.login,
    email,
    picture: user.avatar_url,
    username: user.login,
    provider: 'github',
  };
}

async function extractMicrosoftProfile(tokens) {
  const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileRes.ok) throw new Error('Failed to fetch Microsoft profile');
  const profile = await profileRes.json();

  // Try to get profile photo (may 404)
  let picture = null;
  try {
    const photoRes = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (photoRes.ok) {
      const blob = await photoRes.arrayBuffer();
      const base64 = Buffer.from(blob).toString('base64');
      const contentType = photoRes.headers.get('content-type') || 'image/jpeg';
      picture = `data:${contentType};base64,${base64}`;
    }
  } catch { /* no photo available */ }

  return {
    sub: profile.id,
    name: profile.displayName,
    email: profile.mail || profile.userPrincipalName,
    picture,
    provider: 'microsoft',
  };
}

async function extractFacebookProfile(tokens) {
  const profileRes = await fetch(
    `https://graph.facebook.com/v19.0/me?fields=id,name,email,picture.width(200).height(200)&access_token=${tokens.access_token}`
  );
  if (!profileRes.ok) throw new Error('Failed to fetch Facebook profile');
  const profile = await profileRes.json();

  return {
    sub: profile.id,
    name: profile.name,
    email: profile.email,
    picture: profile.picture && profile.picture.data ? profile.picture.data.url : null,
    provider: 'facebook',
  };
}

function extractAppleProfile(tokens, extras) {
  // Apple sends identity in the id_token (JWT) — decode it
  const decoded = jwt.decode(tokens.id_token);
  if (!decoded) throw new Error('Failed to decode Apple ID token');

  // Name comes from the `user` POST parameter on first auth only
  let name = null;
  if (extras.user) {
    try {
      const userData = typeof extras.user === 'string' ? JSON.parse(extras.user) : extras.user;
      if (userData.name) {
        name = [userData.name.firstName, userData.name.lastName].filter(Boolean).join(' ');
      }
    } catch { /* user data not available */ }
  }

  return {
    sub: decoded.sub,
    name: name || 'Apple User',
    email: decoded.email,
    picture: null, // Apple never provides a profile photo
    provider: 'apple',
  };
}

// ──────────────────────────────────────────────
// State helpers
// ──────────────────────────────────────────────
function parseState(stateParam) {
  try {
    return JSON.parse(Buffer.from(stateParam, 'base64url').toString());
  } catch {
    return null;
  }
}

module.exports = {
  providers,
  PROVIDER_META,
  VALID_PROVIDERS,
  getAuthorizationUrl,
  exchangeCodeForProfile,
  parseState,
};
