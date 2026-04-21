// Stats event log for Vero Voice — PII-free aggregate usage tracking.
//
// Writes append-only events to Firestore collection `stats_events`.
// All public functions are fire-and-forget: internal try/catch swallows
// errors so a Firestore outage never breaks user flows.
//
// Stored fields are whitelisted explicitly — never spread caller input.
// Never persist: handles, emails, phones, names, pictures, sub, profile
// objects, tokens, IPs, user agents.
//
// sessionId is the random 32-char hex from crypto.randomBytes — not PII
// today. If we ever log it alongside identity elsewhere, re-evaluate.

const { Firestore, FieldValue } = require('@google-cloud/firestore');

const COLLECTION = 'stats_events';
const VALID_TYPES = new Set([
  'session_created',
  'anchor_matched',
  'anchor_mismatch',
  'session_confirmed',
  'session_rejected',
  'code_sent',
]);
const VALID_PROVIDER_TYPES = new Set(['oauth', 'sms', 'email']);
const VALID_SOURCES = new Set(['try', 'voice_subdomain', 'video', 'direct', 'other']);

let db = null;
try {
  db = new Firestore();
} catch (err) {
  console.warn('[stats] Firestore init failed — stats disabled:', err.message);
}

let VALID_PROVIDERS_SET = null;
function getValidProviders() {
  if (VALID_PROVIDERS_SET) return VALID_PROVIDERS_SET;
  const { VALID_PROVIDERS } = require('./oauth');
  VALID_PROVIDERS_SET = new Set(VALID_PROVIDERS);
  return VALID_PROVIDERS_SET;
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function cleanElapsed(ms) {
  if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return null;
  return Math.min(Math.round(ms), 24 * 60 * 60 * 1000); // clamp at 24h
}

async function write(payload) {
  if (!db) return;
  try {
    await db.collection(COLLECTION).add(payload);
  } catch (err) {
    console.warn('[stats] write failed:', err.message);
  }
}

function recordSessionCreated({ sessionId, providers, source }) {
  const validProviders = getValidProviders();
  const cleanProviders = Array.isArray(providers)
    ? providers.filter(p => typeof p === 'string' && validProviders.has(p))
    : [];
  const providersKey = [...cleanProviders].sort().join(',');
  const cleanSource = VALID_SOURCES.has(source) ? source : 'direct';
  return write({
    type: 'session_created',
    sessionId: String(sessionId || ''),
    provider: null,
    providerType: null,
    providers: cleanProviders,
    providersKey,
    anchorCount: cleanProviders.length,
    source: cleanSource,
    elapsedMs: null,
    isResend: null,
    ts: FieldValue.serverTimestamp(),
    day: todayUTC(),
  });
}

function recordAnchorMatched({ sessionId, provider, providerType, elapsedMs, matchIndex }) {
  if (!getValidProviders().has(provider)) return;
  if (!VALID_PROVIDER_TYPES.has(providerType)) return;
  return write({
    type: 'anchor_matched',
    sessionId: String(sessionId || ''),
    provider,
    providerType,
    providers: null,
    providersKey: null,
    anchorCount: null,
    source: null,
    elapsedMs: cleanElapsed(elapsedMs),
    matchIndex: typeof matchIndex === 'number' ? matchIndex : null,
    isResend: null,
    ts: FieldValue.serverTimestamp(),
    day: todayUTC(),
  });
}

function recordAnchorMismatch({ sessionId, provider, providerType }) {
  if (!getValidProviders().has(provider)) return;
  if (!VALID_PROVIDER_TYPES.has(providerType)) return;
  return write({
    type: 'anchor_mismatch',
    sessionId: String(sessionId || ''),
    provider,
    providerType,
    providers: null,
    providersKey: null,
    anchorCount: null,
    source: null,
    elapsedMs: null,
    isResend: null,
    ts: FieldValue.serverTimestamp(),
    day: todayUTC(),
  });
}

function recordSessionConfirmed({ sessionId, elapsedMs }) {
  return write({
    type: 'session_confirmed',
    sessionId: String(sessionId || ''),
    provider: null,
    providerType: null,
    providers: null,
    providersKey: null,
    anchorCount: null,
    source: null,
    elapsedMs: cleanElapsed(elapsedMs),
    isResend: null,
    ts: FieldValue.serverTimestamp(),
    day: todayUTC(),
  });
}

function recordSessionRejected({ sessionId, elapsedMs }) {
  return write({
    type: 'session_rejected',
    sessionId: String(sessionId || ''),
    provider: null,
    providerType: null,
    providers: null,
    providersKey: null,
    anchorCount: null,
    source: null,
    elapsedMs: cleanElapsed(elapsedMs),
    isResend: null,
    ts: FieldValue.serverTimestamp(),
    day: todayUTC(),
  });
}

function recordCodeSent({ sessionId, provider, providerType, isResend }) {
  if (!getValidProviders().has(provider)) return;
  if (!VALID_PROVIDER_TYPES.has(providerType)) return;
  return write({
    type: 'code_sent',
    sessionId: String(sessionId || ''),
    provider,
    providerType,
    providers: null,
    providersKey: null,
    anchorCount: null,
    source: null,
    elapsedMs: null,
    isResend: Boolean(isResend),
    ts: FieldValue.serverTimestamp(),
    day: todayUTC(),
  });
}

// ── Aggregation reads, cached 60s to protect against dashboard refresh loops ──

const cache = new Map(); // key → { value, expiresAt }
const CACHE_TTL_MS = 60 * 1000;

async function cached(key, loader) {
  const now = Date.now();
  const entry = cache.get(key);
  if (entry && entry.expiresAt > now) return entry.value;
  const value = await loader();
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

function windowStart(windowName) {
  if (windowName === '24h') return new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (windowName === '7d') return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return null; // all-time
}

async function countByType(type, since) {
  if (!db) return 0;
  let q = db.collection(COLLECTION).where('type', '==', type);
  if (since) q = q.where('ts', '>=', since);
  const snap = await q.count().get();
  return snap.data().count || 0;
}

async function countByTypeAndResend(type, isResend, since) {
  if (!db) return 0;
  let q = db.collection(COLLECTION)
    .where('type', '==', type)
    .where('isResend', '==', isResend);
  if (since) q = q.where('ts', '>=', since);
  const snap = await q.count().get();
  return snap.data().count || 0;
}

async function countByProvider(provider, since) {
  if (!db) return 0;
  let q = db.collection(COLLECTION)
    .where('type', '==', 'anchor_matched')
    .where('provider', '==', provider);
  if (since) q = q.where('ts', '>=', since);
  const snap = await q.count().get();
  return snap.data().count || 0;
}

async function countByDay(type, day) {
  if (!db) return 0;
  const snap = await db.collection(COLLECTION)
    .where('type', '==', type)
    .where('day', '==', day)
    .count().get();
  return snap.data().count || 0;
}

async function avgElapsedFor(type, since) {
  if (!db) return null;
  try {
    let q = db.collection(COLLECTION).where('type', '==', type);
    if (since) q = q.where('ts', '>=', since);
    const { AggregateField } = require('@google-cloud/firestore');
    const snap = await q.aggregate({
      count: AggregateField.count(),
      avg: AggregateField.average('elapsedMs'),
    }).get();
    const data = snap.data();
    return {
      count: data.count || 0,
      avgMs: data.avg != null ? Math.round(data.avg) : null,
    };
  } catch (err) {
    console.warn('[stats] avg query failed:', err.message);
    return { count: 0, avgMs: null };
  }
}

// Fetches session_created docs in window, projecting only the fields we need.
// Cached 60s. Drives anchor-count histogram, provider combinations, and source mix.
async function fetchCreatedDetails(windowName) {
  return cached(`created_details:${windowName}`, async () => {
    if (!db) return [];
    const since = windowStart(windowName);
    let q = db.collection(COLLECTION)
      .where('type', '==', 'session_created')
      .select('providersKey', 'anchorCount', 'source');
    if (since) q = q.where('ts', '>=', since);
    const snap = await q.get();
    return snap.docs.map(d => d.data());
  });
}

async function getSummary({ window = 'all' } = {}) {
  return cached(`summary:${window}`, async () => {
    const since = windowStart(window);
    const [created, confirmed, rejected] = await Promise.all([
      countByType('session_created', since),
      countByType('session_confirmed', since),
      countByType('session_rejected', since),
    ]);
    const abandoned = Math.max(0, created - confirmed - rejected);
    const conversionRate = created > 0 ? confirmed / created : 0;
    const rejectionRate = created > 0 ? rejected / created : 0;
    const abandonmentRate = created > 0 ? abandoned / created : 0;
    return {
      window,
      sessionsCreated: created,
      sessionsConfirmed: confirmed,
      sessionsRejected: rejected,
      sessionsAbandoned: abandoned,
      conversionRate,
      rejectionRate,
      abandonmentRate,
      generatedAt: new Date().toISOString(),
    };
  });
}

async function getProviderBreakdown({ window = 'all' } = {}) {
  return cached(`providers:${window}`, async () => {
    const { VALID_PROVIDERS } = require('./oauth');
    const since = windowStart(window);
    const counts = await Promise.all(
      VALID_PROVIDERS.map(p => countByProvider(p, since))
    );
    return {
      window,
      providers: VALID_PROVIDERS.map((provider, i) => ({
        provider,
        matches: counts[i],
      })),
      generatedAt: new Date().toISOString(),
    };
  });
}

async function getDailyBuckets({ days = 30 } = {}) {
  const safeDays = Math.max(1, Math.min(90, Number(days) || 30));
  return cached(`daily:${safeDays}`, async () => {
    const dayList = [];
    const today = new Date();
    for (let i = safeDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(today.getUTCDate() - i);
      dayList.push(d.toISOString().slice(0, 10));
    }
    const queries = dayList.flatMap(day => [
      countByDay('session_created', day),
      countByDay('session_confirmed', day),
    ]);
    const results = await Promise.all(queries);
    const buckets = dayList.map((date, i) => ({
      date,
      created: results[i * 2],
      confirmed: results[i * 2 + 1],
    }));
    return { days: safeDays, buckets, generatedAt: new Date().toISOString() };
  });
}

async function getAnchorCountHistogram({ window = 'all' } = {}) {
  return cached(`anchor_count:${window}`, async () => {
    const rows = await fetchCreatedDetails(window);
    const buckets = { '1': 0, '2': 0, '3+': 0 };
    for (const r of rows) {
      const n = r.anchorCount || 0;
      if (n <= 1) buckets['1']++;
      else if (n === 2) buckets['2']++;
      else buckets['3+']++;
    }
    return { window, buckets, total: rows.length, generatedAt: new Date().toISOString() };
  });
}

async function getProviderCombinations({ window = 'all', limit = 10 } = {}) {
  return cached(`combos:${window}:${limit}`, async () => {
    const rows = await fetchCreatedDetails(window);
    const counts = new Map();
    for (const r of rows) {
      const key = r.providersKey || '';
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const combos = Array.from(counts.entries())
      .map(([key, count]) => ({ combo: key.split(',').filter(Boolean), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, Math.max(1, Math.min(50, Number(limit) || 10)));
    return { window, combos, generatedAt: new Date().toISOString() };
  });
}

async function getSourceBreakdown({ window = 'all' } = {}) {
  return cached(`source:${window}`, async () => {
    const rows = await fetchCreatedDetails(window);
    const counts = {};
    for (const s of VALID_SOURCES) counts[s] = 0;
    for (const r of rows) {
      const s = VALID_SOURCES.has(r.source) ? r.source : 'direct';
      counts[s]++;
    }
    return { window, counts, total: rows.length, generatedAt: new Date().toISOString() };
  });
}

async function getTiming({ window = 'all' } = {}) {
  return cached(`timing:${window}`, async () => {
    const since = windowStart(window);
    const [confirmedStats, rejectedStats] = await Promise.all([
      avgElapsedFor('session_confirmed', since),
      avgElapsedFor('session_rejected', since),
    ]);
    return {
      window,
      confirmed: confirmedStats || { count: 0, avgMs: null },
      rejected: rejectedStats || { count: 0, avgMs: null },
      generatedAt: new Date().toISOString(),
    };
  });
}

async function getSignals({ window = 'all' } = {}) {
  return cached(`signals:${window}`, async () => {
    const since = windowStart(window);
    const [mismatches, codeSends, codeResends] = await Promise.all([
      countByType('anchor_mismatch', since),
      countByTypeAndResend('code_sent', false, since),
      countByTypeAndResend('code_sent', true, since),
    ]);
    const totalSends = codeSends + codeResends;
    const resendRate = totalSends > 0 ? codeResends / totalSends : 0;
    return {
      window,
      anchorMismatches: mismatches,
      codeSends,
      codeResends,
      resendRate,
      generatedAt: new Date().toISOString(),
    };
  });
}

async function getHealth() {
  if (!db) return { ok: false, firestore: 'uninitialized' };
  try {
    const snap = await db.collection(COLLECTION).orderBy('ts', 'desc').limit(1).get();
    if (snap.empty) return { ok: true, firestore: 'reachable', lastWriteAgo: null };
    const ts = snap.docs[0].get('ts');
    const lastMs = ts && ts.toMillis ? ts.toMillis() : null;
    return {
      ok: true,
      firestore: 'reachable',
      lastWriteAgo: lastMs ? `${Math.round((Date.now() - lastMs) / 1000)}s` : null,
    };
  } catch (err) {
    return { ok: false, firestore: 'unreachable', error: err.message };
  }
}

// Classify an incoming request's traffic source into the VALID_SOURCES enum.
// Based on Referer + Host. No PII.
function classifySource(req) {
  try {
    const host = (req.hostname || '').toLowerCase();
    if (host === 'voice.vero.technology') {
      // Lives on the voice subdomain — categorize by referer path when available
      const ref = req.get && req.get('Referer');
      if (ref) {
        const u = new URL(ref);
        const refHost = u.hostname.toLowerCase();
        if (refHost === 'voice.vero.technology') return 'voice_subdomain';
        if (u.pathname.startsWith('/try')) return 'try';
        if (u.pathname.startsWith('/video')) return 'video';
        return 'other';
      }
      return 'voice_subdomain';
    }
    const ref = req.get && req.get('Referer');
    if (!ref) return 'direct';
    const u = new URL(ref);
    if (u.pathname.startsWith('/try')) return 'try';
    if (u.pathname.startsWith('/video')) return 'video';
    if (u.hostname.toLowerCase() === 'voice.vero.technology') return 'voice_subdomain';
    return 'other';
  } catch {
    return 'direct';
  }
}

module.exports = {
  recordSessionCreated,
  recordAnchorMatched,
  recordAnchorMismatch,
  recordSessionConfirmed,
  recordSessionRejected,
  recordCodeSent,
  getSummary,
  getProviderBreakdown,
  getDailyBuckets,
  getAnchorCountHistogram,
  getProviderCombinations,
  getSourceBreakdown,
  getTiming,
  getSignals,
  getHealth,
  classifySource,
};
