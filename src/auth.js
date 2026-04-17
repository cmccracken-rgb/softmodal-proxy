import { chromium } from 'playwright';

const LOGIN_URL =
  process.env.SOFTMODAL_LOGIN_URL ||
  'https://readonly.softmodal.com/sessions/login';

const COOKIE_TTL_MS = 25 * 60 * 1000; // ~25 minutes

// Updated selectors based on real Softmodal login page
const LOGIN_SELECTORS = {
  email: '#email',
  password: '#password',
  submit: 'button[type="submit"]',
};

let cachedCookie = null;
let cachedAt = 0;
let inFlight = null;

async function loginAndExtractCookie() {
  const email = process.env.SOFTMODAL_EMAIL;
  const password = process.env.SOFTMODAL_PASSWORD;

  if (!email || !password) {
    throw new Error('Missing SOFTMODAL_EMAIL or SOFTMODAL_PASSWORD env var');
  }

  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    // Go to login page
    await page.goto(LOGIN_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for form to actually exist
    await page.waitForSelector(LOGIN_SELECTORS.email, { timeout: 10000 });

    // Fill login form
    await page.fill(LOGIN_SELECTORS.email, email);
    await page.fill(LOGIN_SELECTORS.password, password);

    // Submit + wait for navigation
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}),
      page.click(LOGIN_SELECTORS.submit),
    ]);

    // Give cookie time to be set
    await page.waitForTimeout(2000);

    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === 'rack.session');

    if (!session) {
      throw new Error('Login failed: rack.session cookie not found');
    }

    return `rack.session=${session.value}`;
  } finally {
    await browser.close().catch(() => {});
  }
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
