const crypto = require('crypto');

function safeEqual(a, b) {
  const ab = Buffer.from(a || '', 'utf8');
  const bb = Buffer.from(b || '', 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function statsBasicAuth(req, res, next) {
  const user = process.env.STATS_AUTH_USER;
  const pass = process.env.STATS_AUTH_PASS;

  if (!user || !pass) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).send('Stats auth not configured');
    }
    return next();
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) {
    res.set('WWW-Authenticate', 'Basic realm="vero-stats"');
    return res.status(401).send('Authentication required');
  }

  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const idx = decoded.indexOf(':');
  const u = idx >= 0 ? decoded.slice(0, idx) : '';
  const p = idx >= 0 ? decoded.slice(idx + 1) : '';

  if (!safeEqual(u, user) || !safeEqual(p, pass)) {
    res.set('WWW-Authenticate', 'Basic realm="vero-stats"');
    return res.status(401).send('Invalid credentials');
  }

  next();
}

module.exports = { statsBasicAuth };
