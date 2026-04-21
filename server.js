const express = require('express');
const path = require('path');

// Load .env in development
if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* dotenv optional in prod */ }
}

const simpleRoutes = require('./simple/routes');
const statsRoutes = require('./simple/stats-routes');
const { statsBasicAuth } = require('./simple/stats-auth');

const app = express();
const PORT = process.env.PORT || 8080;

// Trust proxy so req.hostname and req.protocol work behind Cloud Run / load balancer
app.set('trust proxy', true);

app.use(express.json());

// ── Shared assets (available on all domains) ──
// Website assets take priority on the main domain (they live under public/website/assets/)
const websiteAssets = express.static(path.join(__dirname, 'public', 'website', 'assets'));
const sharedAssets = express.static(path.join(__dirname, 'public', 'assets'));
app.use('/assets', (req, res, next) => {
  if (!isVoiceHost(req.hostname) && !isVideoHost(req.hostname)) {
    // Try website assets first, then fall back to shared assets
    return websiteAssets(req, res, () => sharedAssets(req, res, next));
  }
  sharedAssets(req, res, next);
});

// ── API routes (available on all domains) ──
app.use('/api/simple', simpleRoutes);

// Stats API + dashboard (basic-auth gated; health endpoint is public inside router)
app.use('/api/stats', statsBasicAuth, statsRoutes);
app.get('/stats', statsBasicAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'stats.html'));
});

// ── Hostname-based routing ──
// Subdomains serve their respective apps at root.
// Main domain preserves the existing site until cutover.
// Localhost serves everything via path-based routing (for dev).

const VOICE_HOSTS = ['voice.vero.technology'];
const VIDEO_HOSTS = ['video.vero.technology'];

function isVoiceHost(hostname) {
  return VOICE_HOSTS.includes(hostname);
}

function isVideoHost(hostname) {
  return VIDEO_HOSTS.includes(hostname);
}

// Voice subdomain: serve Vero Voice frontend at root
const voiceStatic = express.static(path.join(__dirname, 'simple', 'public'));
app.use((req, res, next) => {
  if (isVoiceHost(req.hostname)) return voiceStatic(req, res, next);
  next();
});

// Video subdomain: serve Vero Video (blink) at root, plus shared public assets
const videoStatic = express.static(path.join(__dirname, 'public', 'blink'));
const publicStatic = express.static(path.join(__dirname, 'public'));
app.use((req, res, next) => {
  if (isVideoHost(req.hostname)) {
    // Try blink-specific files first, then fall back to public/ for shared assets (style.css, etc.)
    return videoStatic(req, res, () => publicStatic(req, res, next));
  }
  next();
});

// ── Path-based routing (main domain + localhost dev) ──
// These still work for the main domain and local development

// Landing page for trying Vero Voice / Vero Video
// Access at vero.technology/try or localhost:8080/try
app.get('/try', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// Serve Vero Voice at /simple and /voice
app.use('/simple', express.static(path.join(__dirname, 'simple', 'public')));
app.use('/voice', express.static(path.join(__dirname, 'simple', 'public')));

// SPA fallback for Vero Voice path-based routes
app.get('/simple/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'simple', 'public', 'index.html'));
});
app.get('/voice/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'simple', 'public', 'index.html'));
});

// Serve Vero Video landing page at /video
app.get('/video', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'blink', 'landing.html'));
});

// The old configure page is also available at /configure
app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'configure.html'));
});

// Serve vero-website for main domain root (before public/ so website index.html wins)
const websiteStatic = express.static(path.join(__dirname, 'public', 'website'));
app.use((req, res, next) => {
  if (!isVoiceHost(req.hostname) && !isVideoHost(req.hostname)) {
    return websiteStatic(req, res, next);
  }
  next();
});

// Serve existing static site (blink demo + assets) — shared assets, /blink, etc.
app.use(express.static(path.join(__dirname, 'public')));

// ── Catch-all fallbacks (hostname-aware) ──
app.get('*', (req, res) => {
  if (isVoiceHost(req.hostname)) {
    return res.sendFile(path.join(__dirname, 'simple', 'public', 'index.html'));
  }
  if (isVideoHost(req.hostname)) {
    return res.sendFile(path.join(__dirname, 'public', 'blink', 'index.html'));
  }
  // Main domain / localhost: serve vero-website (SPA fallback)
  res.sendFile(path.join(__dirname, 'public', 'website', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Vero web server running on port ${PORT}`);
  console.log(`  Existing site: http://localhost:${PORT}`);
  console.log(`  Try Vero:      http://localhost:${PORT}/try`);
  console.log(`  Vero Voice:    http://localhost:${PORT}/voice`);
  console.log(`  Vero Video:    http://localhost:${PORT}/blink`);
});
