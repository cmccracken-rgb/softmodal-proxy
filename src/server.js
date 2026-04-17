import express from 'express';
import { fetchQuote } from './softmodal.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SHARED_TOKEN = process.env.PROXY_SHARED_TOKEN;

if (!SHARED_TOKEN) {
  console.warn('[softmodal-proxy] WARNING: PROXY_SHARED_TOKEN is not set — endpoint is unprotected.');
}

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.get('/quote', async (req, res) => {
  if (SHARED_TOKEN && req.header('x-proxy-token') !== SHARED_TOKEN) {
    return res.status(401).json({ error: 'Invalid proxy token' });
  }

  const origin = String(req.query.origin || '').trim();
  const destination = String(req.query.destination || '').trim();
  const size = String(req.query.size || '53').trim();
  if (!origin || !destination) {
    return res.status(400).json({ error: 'origin and destination are required' });
  }

  try {
    const quote = await fetchQuote({ origin, destination, size });
    return res.json(quote);
  } catch (err) {
    console.error('[softmodal-proxy] quote error:', err);
    return res.status(502).json({ error: err.message || 'Failed to fetch quote' });
  }
});

app.listen(PORT, () => {
  console.log(`[softmodal-proxy] listening on :${PORT}`);
});
