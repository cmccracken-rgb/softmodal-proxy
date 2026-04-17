const BASE = 'https://readonly.softmodal.com';
const LOGIN_URL = `${BASE}/sessions/login`;

const COOKIE_TTL_MS = 25 * 60 * 1000;

let cachedCookie = null;
let cachedAt = 0;
let inFlight = null;

function extractCookies(headers) {
  const setCookie = headers.get('set-cookie');
  if (!setCookie) return [];

  // split multiple cookies safely
  return setCookie.split(/,(?=[^;]+=[^;]+)/);
}

async function loginAndExtractCookie() {
  const email = process.env.SOFTMODAL_EMAIL;
  const password = process.env.SOFTMODAL_PASSWORD;

  if (!email || !password) {
    throw new Error('Missing credentials');
  }

  // 1️⃣ GET login page
  const res = await fetch(LOGIN_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
    },
  });

  const html = await res.text();
  const cookies = extractCookies(res.headers);
  const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');

  // 2️⃣ Extract CSRF
  const csrfMatch = html.match(/name="authenticity_token" value="([^"]+)"/);
  if (!csrfMatch) {
    throw new Error('CSRF token not found');
  }

  const csrf = csrfMatch[1];

  // 3️⃣ POST login
  const body = new URLSearchParams({
    email,
    password,
    authenticity_token: csrf,
  });

  const loginRes = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieHeader,
      'User-Agent': 'Mozilla/5.0',
      'Origin': BASE,
      'Referer': LOGIN_URL,
    },
    body,
    redirect: 'manual',
  });

  const loginCookies = extractCookies(loginRes.headers);
  const session = loginCookies.find(c => c.startsWith('rack.session='));

  if (!session) {
    throw new Error('Login failed — no rack.session cookie');
  }

  return session.split(';')[0];
}

export async function getSessionCookie({ forceRefresh = false } = {}) {
  const fresh = cachedCookie && Date.now() - cachedAt < COOKIE_TTL_MS;
  if (!forceRefresh && fresh) return cachedCookie;

  if (!inFlight) {
    inFlight = loginAndExtractCookie()
      .then((cookie) => {
        cachedCookie = cookie;
        cachedAt = Date.now();
        return cookie;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  return inFlight;
}

export function invalidateSession() {
  cachedCookie = null;
  cachedAt = 0;
}
