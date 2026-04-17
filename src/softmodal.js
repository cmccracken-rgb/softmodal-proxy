const BASE = 'https://readonly.softmodal.com';

// Extract ALL hidden + visible form fields
function extractHiddenFields(html) {
  const inputs = [...html.matchAll(/<input[^>]+>/g)];
  const fields = {};

  for (const input of inputs) {
    const nameMatch = input[0].match(/name="([^"]+)"/);
    const valueMatch = input[0].match(/value="([^"]*)"/);

    if (nameMatch) {
      fields[nameMatch[1]] = valueMatch ? valueMatch[1] : '';
    }
  }

  return fields;
}

export async function fetchQuote({ origin, destination, size }) {
  try {
    // STEP 1 — Load login page (to get hidden fields)
    const loginPage = await fetch(`${BASE}/sessions/login`);
    const html = await loginPage.text();

    const fields = extractHiddenFields(html);

    if (!fields) {
      throw new Error('Could not extract login fields');
    }

    // STEP 2 — Add credentials
    fields.email = process.env.SOFTMODAL_EMAIL;
    fields.password = process.env.SOFTMODAL_PASSWORD;

    // STEP 3 — Login request
    const loginRes = await fetch(`${BASE}/sessions/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields),
      redirect: 'manual',
    });

    const setCookie = loginRes.headers.get('set-cookie');

    if (!setCookie) {
      throw new Error('Login failed — no session cookie returned');
    }

    const sessionCookie = setCookie.split(';')[0];

    // STEP 4 — Go to main app page (logged in)
    const res = await fetch(`${BASE}/`, {
      headers: {
        cookie: sessionCookie,
      },
    });

    const page = await res.text();

    return {
      success: true,
      debug: page.slice(0, 1000), // show first part of page
    };

  } catch (err) {
    return {
      error: err.message,
    };
  }
}
