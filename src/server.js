import express from 'express';
import { fetchQuote } from './softmodal.js';

const app = express();

app.get('/quote', async (req, res) => {
  try {
    const { origin, destination, size } = req.query;

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
    stack: err.stack,   // 👈 TEMP add this
  });
}

app.listen(3000, () => {
  console.log('Server running');
});
