const express = require('express');
const stats = require('./stats-logger');

const router = express.Router();

function parseWindow(req) {
  const w = String(req.query.window || 'all').toLowerCase();
  if (['all', '7d', '24h'].includes(w)) return w;
  return 'all';
}

router.get('/summary', async (req, res) => {
  try {
    const result = await stats.getSummary({ window: parseWindow(req) });
    res.json(result);
  } catch (err) {
    console.warn('[stats] summary failed:', err.message);
    res.status(500).json({ error: 'stats_unavailable' });
  }
});

router.get('/providers', async (req, res) => {
  try {
    const result = await stats.getProviderBreakdown({ window: parseWindow(req) });
    res.json(result);
  } catch (err) {
    console.warn('[stats] providers failed:', err.message);
    res.status(500).json({ error: 'stats_unavailable' });
  }
});

router.get('/daily', async (req, res) => {
  try {
    const result = await stats.getDailyBuckets({ days: req.query.days });
    res.json(result);
  } catch (err) {
    console.warn('[stats] daily failed:', err.message);
    res.status(500).json({ error: 'stats_unavailable' });
  }
});

router.get('/health', async (_req, res) => {
  try {
    const result = await stats.getHealth();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
