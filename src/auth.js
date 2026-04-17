const LOGIN_URL =
  process.env.SOFTMODAL_LOGIN_URL ||
  'https://readonly.softmodal.com/sessions/login';

const COOKIE_TTL_MS = 25 * 60 * 1000;

let cachedCookie = null;
let cachedAt = 0;
let inFlight = null;

async function loginAndExtractCookie() {
  const email = process.env.SOFTMODAL_EMAIL;
  const password = process.env.SOFTMODAL_PASSWORD;

  if (!email || !password) {
    throw new Error('Missing SOFTMODAL_EMAIL or SOFTMODAL_PASSWORD');
  }

  // Step 1: get CSRF token + cookies
  const loginPage = await fetch(LOGIN_URL, {
    method: 'GET',
  });

  const html = await loginPage.text();

  const csrfMatch = html.match(/name="authenticity_token" value="([^"]+)"/);
  if (!csrfMatch) {
    throw new Error('Could not find CSRF token');
  }

  const csrfToken = csrfMatch[1];

  const cookies = loginPage.headers.raw()['set-cookie'] || [];
  const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');

  // Step 2: submit login
  const res = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieHeader,
    },
    body: new URLSearchParams({
      'email': email,
      'password': password,
      'authenticity_token': csrfToken,
    }),
    redirect: 'manual',
  });

  const setCookies = res.headers.raw()['set-cookie'] || [];
  const session = setCookies.find(c => c.includes('rack.session'));

  if (!session) {
    throw new Error('Login failed: no session cookie returned');
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
