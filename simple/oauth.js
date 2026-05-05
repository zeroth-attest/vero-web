const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// ──────────────────────────────────────────────
// Provider display metadata (shared with frontend)
// ──────────────────────────────────────────────
const PROVIDER_META = {
  google:    { label: 'Google',    icon: 'google',    type: 'oauth', handleLabel: 'Gmail address', handlePlaceholder: 'name@gmail.com' },
  linkedin:  { label: 'LinkedIn',  icon: 'linkedin',  type: 'oauth', handleLabel: 'LinkedIn profile URL or email', handlePlaceholder: 'linkedin.com/in/jane-doe or name@email.com' },
  github:    { label: 'GitHub',    icon: 'github',    type: 'oauth', handleLabel: 'GitHub username or email', handlePlaceholder: 'octocat or name@email.com' },
  microsoft: { label: 'Microsoft', icon: 'microsoft', type: 'oauth', handleLabel: 'Microsoft / Outlook email', handlePlaceholder: 'name@outlook.com' },
  facebook:  { label: 'Facebook',  icon: 'facebook',  type: 'oauth', handleLabel: 'Facebook email', handlePlaceholder: 'name@email.com' },
  apple:     { label: 'Apple',     icon: 'apple',     type: 'oauth', handleLabel: 'Apple ID email', handlePlaceholder: 'name@icloud.com' },
  discord:   { label: 'Discord',   icon: 'discord',   type: 'oauth', handleLabel: 'Discord username or email', handlePlaceholder: 'username or name@email.com' },
  tiktok:    { label: 'TikTok',    icon: 'tiktok',    type: 'oauth', handleLabel: 'TikTok username', handlePlaceholder: '@username' },
  instagram: { label: 'Instagram', icon: 'instagram',  type: 'oauth', handleLabel: 'Instagram username', handlePlaceholder: '@username' },
  youtube:   { label: 'YouTube',   icon: 'youtube',   type: 'oauth', handleLabel: 'YouTube channel URL or email', handlePlaceholder: 'youtube.com/@handle or name@gmail.com' },
  sms:       { label: 'SMS',       icon: 'sms',       type: 'sms',   handleLabel: 'Their phone number', handlePlaceholder: '+1 (555) 123-4567', securityLevel: 'low' },
  email:     { label: 'Email',     icon: 'email',     type: 'email', handleLabel: 'Their email address', handlePlaceholder: 'name@example.com', securityLevel: 'low' },
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
    // Drops `profile` (name/photo) — keeps `email` so we can bind to the
    // verifier-supplied handle. Token is revoked at the provider after use.
    scopes: 'openid email',
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
  },
  linkedin: {
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    userinfoUrl: 'https://api.linkedin.com/v2/userinfo',
    // Drops `profile` (name/photo) — keeps `email` so we can bind to the
    // verifier-supplied handle. LinkedIn has no public revoke endpoint, so
    // the token will expire naturally (~60d).
    scopes: 'openid email',
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
    // No userinfoUrl — we decode the id_token instead of calling Graph /me,
    // which would require User.Read (a much broader permission).
    // Drops `profile` (name/photo) and `User.Read`. Keeps `email` for binding.
    scopes: 'openid email',
    clientId: () => process.env.MICROSOFT_CLIENT_ID,
    clientSecret: () => process.env.MICROSOFT_CLIENT_SECRET,
  },
  facebook: {
    authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    userinfoUrl: 'https://graph.facebook.com/v19.0/me?fields=id,email',
    // public_profile is auto-granted; we only request `email` for binding.
    scopes: 'email',
    clientId: () => process.env.FACEBOOK_CLIENT_ID,
    clientSecret: () => process.env.FACEBOOK_CLIENT_SECRET,
  },
  apple: {
    authUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    // Drops `name` — keeps `email` for binding.
    scopes: 'email',
    clientId: () => process.env.APPLE_CLIENT_ID,
    // Apple uses a JWT client secret — generated on the fly
    clientSecret: () => generateAppleClientSecret(),
  },
  discord: {
    authUrl: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userinfoUrl: 'https://discord.com/api/users/@me',
    scopes: 'identify email',
    clientId: () => process.env.DISCORD_CLIENT_ID,
    clientSecret: () => process.env.DISCORD_CLIENT_SECRET,
  },
  tiktok: {
    authUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    scopes: 'user.info.basic,user.info.profile',
    clientId: () => process.env.TIKTOK_CLIENT_KEY,
    clientSecret: () => process.env.TIKTOK_CLIENT_SECRET,
  },
  instagram: {
    authUrl: 'https://api.instagram.com/oauth/authorize',
    tokenUrl: 'https://api.instagram.com/oauth/access_token',
    scopes: 'user_profile',
    clientId: () => process.env.INSTAGRAM_CLIENT_ID,
    clientSecret: () => process.env.INSTAGRAM_CLIENT_SECRET,
  },
  youtube: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    // Replaces the heavy `youtube.readonly` (which would let us read
    // playlists, subscriptions, watch history) with email-only binding.
    // Verifier should enter the user's Google/YouTube email.
    scopes: 'openid email',
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
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
// In production, always route OAuth callbacks through the main domain
// so each provider only needs one registered callback URL.
// The state parameter carries the original subdomain for post-auth redirect.
const PRODUCTION_CALLBACK_HOST = 'https://vero.technology';

function getCallbackUrl(provider, baseUrl) {
  baseUrl = baseUrl || process.env.BASE_URL || 'http://localhost:8080';
  // In production, always use the main domain for callbacks
  if (process.env.NODE_ENV === 'production') {
    return `${PRODUCTION_CALLBACK_HOST}/api/simple/auth/${provider}/callback`;
  }
  return `${baseUrl}/api/simple/auth/${provider}/callback`;
}

// Derive the base URL from an Express request object (works behind proxies)
function getBaseUrlFromRequest(req) {
  if (!req) return null;
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('host');
  return `${protocol}://${host}`;
}

function getAuthorizationUrl(provider, sessionId, req) {
  const config = providers[provider];
  // Non-OAuth providers don't have authorization URLs
  if (!config) {
    if (['sms', 'email'].includes(provider)) {
      throw new Error(`${provider} does not use OAuth — use the PIN verification flow`);
    }
    throw new Error(`Unknown provider: ${provider}`);
  }

  const baseUrl = getBaseUrlFromRequest(req);

  const state = Buffer.from(JSON.stringify({
    sessionId,
    nonce: crypto.randomBytes(8).toString('hex'),
    // Remember which host initiated the flow so the callback can redirect correctly
    origin: baseUrl,
  })).toString('base64url');

  const params = new URLSearchParams({
    client_id: config.clientId(),
    redirect_uri: getCallbackUrl(provider, baseUrl),
    response_type: 'code',
    scope: config.scopes,
    state,
  });

  // Google & Microsoft: always show account picker so user can choose a different account
  if (provider === 'google') {
    params.set('prompt', 'select_account');
  }
  if (provider === 'microsoft') {
    params.set('prompt', 'select_account');
  }

  // Apple-specific: use form_post so callback receives a POST
  if (provider === 'apple') {
    params.set('response_mode', 'form_post');
  }

  // TikTok uses client_key instead of client_id
  if (provider === 'tiktok') {
    params.delete('client_id');
    params.set('client_key', config.clientId());
  }

  if (provider === 'discord') {
    params.set('prompt', 'consent');
  }

  return `${config.authUrl}?${params.toString()}`;
}

// ──────────────────────────────────────────────
// Profile extraction (per-provider)
// ──────────────────────────────────────────────
async function exchangeCodeForProfile(provider, code, extras = {}, baseUrl = null) {
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
      redirect_uri: getCallbackUrl(provider, baseUrl),
    }).toString(),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Token exchange failed for ${provider}: ${err}`);
  }

  const tokens = await tokenRes.json();

  // -- Provider-specific profile extraction --
  let profile;
  switch (provider) {
    case 'apple':       profile = extractAppleProfile(tokens, extras); break;
    case 'github':      profile = await extractGitHubProfile(tokens); break;
    case 'microsoft':   profile = await extractMicrosoftProfile(tokens); break;
    case 'facebook':    profile = await extractFacebookProfile(tokens); break;
    case 'discord':     profile = await extractDiscordProfile(tokens); break;
    case 'tiktok':      profile = await extractTikTokProfile(tokens); break;
    case 'instagram':   profile = await extractInstagramProfile(tokens); break;
    case 'youtube':     profile = await extractYouTubeProfile(tokens); break;
    default:            profile = await extractStandardProfile(provider, tokens);
  }

  // Revoke our copy of the access token at the provider so it can't be reused.
  // Result: true = revoked, false = revoke attempt failed, null = provider has no public revoke endpoint.
  const tokenRevoked = await revokeToken(provider, tokens);

  return { ...profile, tokenRevoked };
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
    email_verified: profile.email_verified || null,
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
  let email_verified = null;
  try {
    const emailRes = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (emailRes.ok) {
      const emails = await emailRes.json();
      const primary = emails.find(e => e.primary);
      if (!email && primary) email = primary.email;
      if (!email && emails[0]) email = emails[0].email;
      if (primary) email_verified = !!primary.verified;
    }
  } catch { /* email stays as-is */ }

  return {
    sub: String(user.id),
    name: user.name || user.login,
    email,
    picture: user.avatar_url,
    email_verified,
    username: user.login,
    bio: user.bio || null,
    company: user.company || null,
    location: user.location || null,
    profileUrl: user.html_url || null,
    accountCreated: user.created_at || null,
    publicRepos: user.public_repos != null ? user.public_repos : null,
    followers: user.followers != null ? user.followers : null,
    website: user.blog || null,
    twitterUsername: user.twitter_username || null,
    provider: 'github',
  };
}

async function extractMicrosoftProfile(tokens) {
  // Microsoft v2.0 issues an id_token (JWT) under the `openid` scope; with
  // `email` we get the email/preferred_username claim. Decoding the JWT
  // avoids needing the User.Read Graph permission entirely.
  const decoded = tokens.id_token ? jwt.decode(tokens.id_token) : null;
  if (!decoded) throw new Error('Failed to decode Microsoft id_token');
  return {
    sub: decoded.sub || decoded.oid,
    name: null,
    email: decoded.email || decoded.preferred_username || null,
    picture: null,
    email_verified: true, // Microsoft accounts have provider-verified emails
    provider: 'microsoft',
  };
}

async function extractFacebookProfile(tokens) {
  const profileRes = await fetch(
    `https://graph.facebook.com/v19.0/me?fields=id,email&access_token=${encodeURIComponent(tokens.access_token)}`
  );
  if (!profileRes.ok) throw new Error('Failed to fetch Facebook profile');
  const profile = await profileRes.json();
  return {
    sub: profile.id,
    name: null,
    email: profile.email || null,
    picture: null,
    provider: 'facebook',
  };
}

function extractAppleProfile(tokens /* extras unused — name scope dropped */) {
  // Apple sends identity in the id_token (JWT) — decode it.
  // With only `email` scope, we receive sub + email; no name claim.
  const decoded = jwt.decode(tokens.id_token);
  if (!decoded) throw new Error('Failed to decode Apple ID token');
  return {
    sub: decoded.sub,
    name: null,
    email: decoded.email || null,
    picture: null,
    email_verified: decoded.email_verified || null,
    provider: 'apple',
  };
}

async function extractDiscordProfile(tokens) {
  const profileRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileRes.ok) throw new Error('Failed to fetch Discord profile');
  const profile = await profileRes.json();
  const avatarUrl = profile.avatar
    ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
    : null;
  return {
    sub: profile.id,
    name: profile.global_name || profile.username,
    email: profile.email || null,
    email_verified: profile.verified || null,
    picture: avatarUrl,
    username: profile.username,
    provider: 'discord',
  };
}

async function extractTikTokProfile(tokens) {
  const profileRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileRes.ok) throw new Error('Failed to fetch TikTok profile');
  const data = await profileRes.json();
  const user = data.data && data.data.user ? data.data.user : {};
  return {
    sub: user.open_id || user.union_id,
    name: user.display_name || user.username,
    email: null,
    picture: user.avatar_url || null,
    username: user.username || null,
    provider: 'tiktok',
  };
}

async function extractInstagramProfile(tokens) {
  const profileRes = await fetch(
    `https://graph.instagram.com/me?fields=id,username&access_token=${tokens.access_token}`
  );
  if (!profileRes.ok) throw new Error('Failed to fetch Instagram profile');
  const profile = await profileRes.json();
  return {
    sub: profile.id,
    name: profile.username,
    email: null,
    picture: null,
    username: profile.username,
    provider: 'instagram',
  };
}

async function extractYouTubeProfile(tokens) {
  // With scopes minimized to `openid email`, fall back to Google's userinfo
  // endpoint instead of YouTube's channel API (which would require the
  // youtube.readonly scope).
  const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileRes.ok) throw new Error('Failed to fetch YouTube/Google profile');
  const profile = await profileRes.json();
  return {
    sub: profile.sub,
    name: null,
    email: profile.email || null,
    picture: null,
    email_verified: profile.email_verified || null,
    provider: 'youtube',
  };
}

// ──────────────────────────────────────────────
// Token revocation — best-effort per provider
// ──────────────────────────────────────────────
// Returns true (revoked), false (attempt failed), or null (provider has no
// public revoke endpoint). Never throws — revocation is best-effort and must
// not interrupt the verification flow.
async function revokeToken(provider, tokens) {
  if (!tokens || !tokens.access_token) return null;
  try {
    switch (provider) {
      case 'google':
      case 'youtube':
        return await revokeGoogleToken(tokens.access_token);
      case 'github':
        return await revokeGitHubToken(tokens.access_token);
      case 'discord':
        return await revokeDiscordToken(tokens.access_token);
      case 'apple':
        return await revokeAppleToken(tokens.access_token);
      case 'facebook':
        return await revokeFacebookToken(tokens.access_token);
      case 'tiktok':
        return await revokeTikTokToken(tokens.access_token);
      // linkedin, microsoft, instagram have no public revoke endpoint —
      // tokens expire naturally (LinkedIn 60d, Microsoft ~1h, IG long-lived).
      default:
        return null;
    }
  } catch (err) {
    console.error(`[oauth] revokeToken failed for ${provider}:`, err.message);
    return false;
  }
}

async function revokeGoogleToken(accessToken) {
  const res = await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: accessToken }).toString(),
  });
  return res.ok;
}

async function revokeGitHubToken(accessToken) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return false;
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(`https://api.github.com/applications/${clientId}/token`, {
    method: 'DELETE',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ access_token: accessToken }),
  });
  return res.ok;
}

async function revokeDiscordToken(accessToken) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) return false;
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://discord.com/api/oauth2/token/revoke', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ token: accessToken, token_type_hint: 'access_token' }).toString(),
  });
  return res.ok;
}

async function revokeAppleToken(accessToken) {
  const clientId = process.env.APPLE_CLIENT_ID;
  if (!clientId) return false;
  const clientSecret = generateAppleClientSecret();
  const res = await fetch('https://appleid.apple.com/auth/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      token: accessToken,
      token_type_hint: 'access_token',
    }).toString(),
  });
  return res.ok;
}

async function revokeFacebookToken(accessToken) {
  // DELETE /me/permissions revokes ALL of this app's permissions for the user —
  // exactly the "Vero is no longer connected" behaviour we want.
  const res = await fetch(
    `https://graph.facebook.com/v19.0/me/permissions?access_token=${encodeURIComponent(accessToken)}`,
    { method: 'DELETE' }
  );
  return res.ok;
}

async function revokeTikTokToken(accessToken) {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) return false;
  const res = await fetch('https://open.tiktokapis.com/v2/oauth/revoke/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      token: accessToken,
    }).toString(),
  });
  return res.ok;
}

// Providers that support token revocation (used by the UI to set expectations).
const REVOCATION_SUPPORTED = new Set(['google', 'youtube', 'github', 'discord', 'apple', 'facebook', 'tiktok']);

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
  REVOCATION_SUPPORTED,
  getAuthorizationUrl,
  getCallbackUrl,
  getBaseUrlFromRequest,
  exchangeCodeForProfile,
  parseState,
};
