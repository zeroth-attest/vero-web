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
const VALID_TYPES = new Set(['session_created', 'anchor_matched', 'session_confirmed', 'session_rejected']);
const VALID_PROVIDER_TYPES = new Set(['oauth', 'sms', 'email']);

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

async function write(payload) {
  if (!db) return;
  try {
    await db.collection(COLLECTION).add(payload);
  } catch (err) {
    console.warn('[stats] write failed:', err.message);
  }
}

function recordSessionCreated({ sessionId, providers }) {
  if (!VALID_TYPES.has('session_created')) return;
  const validProviders = getValidProviders();
  const cleanProviders = Array.isArray(providers)
    ? providers.filter(p => typeof p === 'string' && validProviders.has(p))
    : [];
  return write({
    type: 'session_created',
    sessionId: String(sessionId || ''),
    provider: null,
    providerType: null,
    providers: cleanProviders,
    ts: FieldValue.serverTimestamp(),
    day: todayUTC(),
  });
}

function recordAnchorMatched({ sessionId, provider, providerType }) {
  if (!getValidProviders().has(provider)) return;
  if (!VALID_PROVIDER_TYPES.has(providerType)) return;
  return write({
    type: 'anchor_matched',
    sessionId: String(sessionId || ''),
    provider,
    providerType,
    providers: null,
    ts: FieldValue.serverTimestamp(),
    day: todayUTC(),
  });
}

function recordSessionConfirmed({ sessionId }) {
  return write({
    type: 'session_confirmed',
    sessionId: String(sessionId || ''),
    provider: null,
    providerType: null,
    providers: null,
    ts: FieldValue.serverTimestamp(),
    day: todayUTC(),
  });
}

function recordSessionRejected({ sessionId }) {
  return write({
    type: 'session_rejected',
    sessionId: String(sessionId || ''),
    provider: null,
    providerType: null,
    providers: null,
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

async function getSummary({ window = 'all' } = {}) {
  return cached(`summary:${window}`, async () => {
    const since = windowStart(window);
    const [created, confirmed, rejected] = await Promise.all([
      countByType('session_created', since),
      countByType('session_confirmed', since),
      countByType('session_rejected', since),
    ]);
    const conversionRate = created > 0 ? confirmed / created : 0;
    const rejectionRate = created > 0 ? rejected / created : 0;
    return {
      window,
      sessionsCreated: created,
      sessionsConfirmed: confirmed,
      sessionsRejected: rejected,
      conversionRate,
      rejectionRate,
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

module.exports = {
  recordSessionCreated,
  recordAnchorMatched,
  recordSessionConfirmed,
  recordSessionRejected,
  getSummary,
  getProviderBreakdown,
  getDailyBuckets,
  getHealth,
};
