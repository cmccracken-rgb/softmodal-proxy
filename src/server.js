import express from 'express';
import { fetchQuote } from './softmodal.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Read once at startup — do NOT re-declare inside routes
const SHARED_TOKEN = process.env.PROXY_SHARED_TOKEN;

if (!SHARED_TOKEN || SHARED_TOKEN === 'off') {
  console.warn(
    '[server] WARNING: PROXY_SHARED_TOKEN is not set or is "off" — /quote is unprotected!'
  );
}

// ── CORS ─────────────────────────────────────────────────────────────────────
// Required so Lovable (and any browser app) can call this API directly.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-proxy-token');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireToken(req, res, next) {
  if (!SHARED_TOKEN || SHARED_TOKEN === 'off') return next();
  const provided = req.header('x-proxy-token');
  if (provided !== SHARED_TOKEN) {
    return res.status(401).json({ error: 'Invalid or missing x-proxy-token header' });
  }
  next();
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.get('/quote', requireToken, async (req, res) => {
  const origin = String(req.query.origin || '').trim();
  const destination = String(req.query.destination || '').trim();
  const size = String(req.query.size || '53').trim();

  if (!origin || !destination) {
    return res
      .status(400)
      .json({ error: '`origin` and `destination` query params are required' });
  }

  try {
    const quote = await fetchQuote({ origin, destination, size });
    return res.json(quote);
  } catch (err) {
    console.error('[server] quote error:', err);
    return res.status(502).json({ error: err.message || 'Failed to fetch quote' });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] softmodal-proxy listening on :${PORT}`);
});
