const express = require('express');
const stats = require('./stats-logger');

const router = express.Router();

function parseWindow(req) {
  const w = String(req.query.window || 'all').toLowerCase();
  if (['all', '7d', '24h'].includes(w)) return w;
  return 'all';
}

function wrap(loader) {
  return async (req, res) => {
    try {
      const result = await loader(req);
      res.json(result);
    } catch (err) {
      console.warn('[stats] endpoint failed:', err.message);
      res.status(500).json({ error: 'stats_unavailable' });
    }
  };
}

router.get('/summary',      wrap(req => stats.getSummary({ window: parseWindow(req) })));
router.get('/providers',    wrap(req => stats.getProviderBreakdown({ window: parseWindow(req) })));
router.get('/daily',        wrap(req => stats.getDailyBuckets({ days: req.query.days })));
router.get('/anchor-count', wrap(req => stats.getAnchorCountHistogram({ window: parseWindow(req) })));
router.get('/combinations', wrap(req => stats.getProviderCombinations({ window: parseWindow(req), limit: req.query.limit })));
router.get('/sources',      wrap(req => stats.getSourceBreakdown({ window: parseWindow(req) })));
router.get('/timing',       wrap(req => stats.getTiming({ window: parseWindow(req) })));
router.get('/signals',      wrap(req => stats.getSignals({ window: parseWindow(req) })));

router.get('/health', async (_req, res) => {
  try {
    res.json(await stats.getHealth());
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
