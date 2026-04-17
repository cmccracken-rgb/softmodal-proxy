import express from 'express';
import { fetchQuote } from './softmodal.js';

const app = express();

// health check
app.get('/', (req, res) => {
  res.send('OK');
});

// request logging
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

app.get('/quote', async (req, res) => {
  try {
    const { origin, destination, size } = req.query;

    if (!origin || !destination) {
      return res.status(400).json({
        error: 'origin and destination are required',
      });
    }

    const data = await fetchQuote({
      origin,
      destination,
      size,
    });

    res.json(data);
  } catch (err) {
    console.error('FULL ERROR:', err);
    console.error('STACK:', err.stack);

    res.status(500).json({
      error: err.message,
      stack: err.stack,
    });
  }
});

app.listen(3000, () => {
  console.log('Server running');
});
