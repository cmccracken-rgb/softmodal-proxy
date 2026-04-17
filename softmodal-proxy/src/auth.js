import { chromium } from 'playwright';

const LOGIN_URL = process.env.SOFTMODAL_LOGIN_URL || 'https://softmodal.com/login';
const COOKIE_TTL_MS = 25 * 60 * 1000; // refresh ~5min before the typical 30min lifetime

// Adjust if Softmodal changes their login form
const LOGIN_SELECTORS = {
  email: 'input[type="email"], input[name="email"], input[name="user[email]"]',
  password: 'input[type="password"], input[name="password"], input[name="user[password]"]',
  submit: 'button[type="submit"], input[type="submit"]',
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

    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.fill(LOGIN_SELECTORS.email, email);
    await page.fill(LOGIN_SELECTORS.password, password);

    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {}),
      page.click(LOGIN_SELECTORS.submit),
    ]);

    // Give the session cookie a moment to be set
    await page.waitForTimeout(1500);

    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === 'rack.session');
    if (!session) {
      throw new Error('Login appeared to succeed but rack.session cookie was not found');
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
