import fetch from 'node-fetch';
import { getSessionCookie } from './auth.js';

const BASE = 'https://readonly.softmodal.com';

function extractCSRF(html) {
  const match = html.match(/name="authenticity_token" value="([^"]+)"/);
  if (!match) return null;
  return match[1];
}

export async function fetchQuote({ origin, destination, size }) {
  try {
    // STEP 1 — Load login page
    const loginPage = await fetch(`${BASE}/sessions/login`);
    const html = await loginPage.text();

    const csrf = extractCSRF(html);
    if (!csrf) {
      throw new Error('CSRF token not found');
    }

    // STEP 2 — Login
    const loginRes = await fetch(`${BASE}/sessions/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        email: process.env.SOFTMODAL_EMAIL,
        password: process.env.SOFTMODAL_PASSWORD,
        authenticity_token: csrf,
      }),
      redirect: 'manual',
    });

    const cookies = loginRes.headers.get('set-cookie');
    if (!cookies) {
      throw new Error('Login failed — no cookie returned');
    }

    const sessionCookie = cookies.split(';')[0];

    // STEP 3 — Fetch quote page
    const query = `${origin} to ${destination}`;

    const res = await fetch(`${BASE}/`, {
      headers: {
        cookie: sessionCookie,
      },
    });

    const page = await res.text();

    // TODO: parse actual quote (for now return raw page)
    return {
      success: true,
      debug: page.slice(0, 500),
    };

  } catch (err) {
    return {
      error: err.message,
    };
  }
}
