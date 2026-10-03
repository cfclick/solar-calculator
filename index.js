import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { estimate, siteSunHours, shadingAnalysis, sizeFromUsage } from './server/services/estimate.js';
import { readBill } from './server/services/billReader.js';
import { getNearbyObstacles } from './server/services/buildings.js';
import { geocode } from './server/services/geocode.js';
import { hasCustomKey } from './server/services/pvwatts.js';
import { DEFAULT_LOSSES, MOUNTING, MODULES } from './server/engine/pvModels.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3080;

app.disable('x-powered-by');
// A bill arrives as a base64 photo or PDF (10 MB file ≈ 13.4 MB encoded). Parsed
// here first, so the smaller global limit below skips it.
app.post('/api/bill/read', express.json({ limit: '14mb' }), async (req, res, next) => {
  try {
    res.json(await readBill(req.body || {}));
  } catch (err) {
    next(err);
  }
});
// Shading requests carry building footprints, so allow more than a plain form post.
app.use(express.json({ limit: '2mb' }));

const api = express.Router();

api.get('/health', (_req, res) =>
  res.json({
    ok: true,
    nrelKey: hasCustomKey() ? 'custom' : 'DEMO_KEY',
    billReader: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  })
);

api.get('/defaults', (_req, res) =>
  res.json({
    losses: DEFAULT_LOSSES,
    arrayTypes: Object.entries(MOUNTING).map(([value, m]) => ({ value, label: m.label })),
    moduleTypes: Object.entries(MODULES).map(([value, m]) => ({ value, label: m.label, gamma: m.gamma })),
  })
);

api.get('/geocode', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.status(400).json({ error: 'Query too short' });
    res.json(await geocode(q));
  } catch (err) {
    next(err);
  }
});

api.get('/sun-hours', async (req, res, next) => {
  try {
    res.json(await siteSunHours(req.query));
  } catch (err) {
    next(err);
  }
});

api.get('/obstacles', async (req, res, next) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat/lon required' });
    res.json(await getNearbyObstacles(lat, lon, Number(req.query.radius) || 150));
  } catch (err) {
    next(err);
  }
});

api.post('/shading', async (req, res, next) => {
  try {
    res.json(await shadingAnalysis(req.body || {}));
  } catch (err) {
    next(err);
  }
});

api.post('/size', async (req, res, next) => {
  try {
    res.json(await sizeFromUsage(req.body || {}));
  } catch (err) {
    next(err);
  }
});

api.post('/estimate', async (req, res, next) => {
  try {
    res.json(await estimate(req.body || {}));
  } catch (err) {
    next(err);
  }
});

app.use('/api', api);

// Serve the built Vue client in production.
const dist = path.join(__dirname, 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.source ? 502 : err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Internal error' });
});

app.listen(PORT, () => console.log(`Solar calculator API listening on http://localhost:${PORT}`));
