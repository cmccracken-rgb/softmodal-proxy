import { chromium } from 'playwright';

const LOGIN_URL =
  process.env.SOFTMODAL_LOGIN_URL || 'https://softmodal.com';

const COOKIE_TTL_MS = 25 * 60 * 1000; // 25 minutes

let cachedCookie = null;
let cachedAt = 0;
let inflightLogin = null; // prevent thundering herd

async function loginAndGetCookie() {
  const email = process.env.SOFTMODAL_EMAIL;
  const password = process.env.SOFTMODAL_PASSWORD;

  if (!email || !password) {
    throw new Error('SOFTMODAL_EMAIL and SOFTMODAL_PASSWORD must be set');
  }

  console.log('[auth] Launching browser...');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    console.log('[auth] Navigating to', LOGIN_URL);
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // ── Step 1: Dismiss any popup/modal that appears on load ──────────────────
    // Common patterns: cookie banners, welcome modals, etc.
    // We try a few selectors and move on if none appear within 3 seconds.
    const popupSelectors = [
      'button:has-text("Close")',
      'button:has-text("Dismiss")',
      'button:has-text("Got it")',
      'button:has-text("Accept")',
      '[aria-label="Close"]',
      '.modal-close',
      '.close',
    ];

    try {
      const popupFound = await Promise.race([
        // Wait up to 3 s for any popup button
        (async () => {
          for (const sel of popupSelectors) {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
              console.log('[auth] Dismissing popup with selector:', sel);
              await btn.click();
              return true;
            }
          }
          return false;
        })(),
        new Promise((r) => setTimeout(() => r(false), 3000)),
      ]);
      if (!popupFound) {
        console.log('[auth] No popup found, continuing...');
      }
    } catch {
      // Non-fatal — just move on
    }

    // ── Step 2: Click the "LOG IN" button to open the login modal/form ────────
    console.log('[auth] Clicking LOG IN button...');
    const loginTrigger = page.locator(
      'a:has-text("Log in"), a:has-text("LOG IN"), button:has-text("Log in"), button:has-text("LOG IN")'
    ).first();

    await loginTrigger.waitFor({ state: 'visible', timeout: 15000 });
    await loginTrigger.click();

    // ── Step 3: Wait for the email input to appear ────────────────────────────
    console.log('[auth] Waiting for email field...');
    const emailInput = page.locator('input[name="email"], input[type="email"]').first();
    await emailInput.waitFor({ state: 'visible', timeout: 10000 });

    // ── Step 4: Fill credentials ──────────────────────────────────────────────
    console.log('[auth] Filling credentials...');
    await emailInput.fill(email);

    const passwordInput = page
      .locator('input[name="password"], input[type="password"]')
      .first();
    await passwordInput.fill(password);

    // ── Step 5: Submit ────────────────────────────────────────────────────────
    console.log('[auth] Submitting login form...');
    const submitBtn = page
      .locator('button[type="submit"], input[type="submit"]')
      .first();
    await submitBtn.click();

    // ── Step 6: Wait for the session cookie ──────────────────────────────────
    console.log('[auth] Waiting for session cookie...');
    let session = null;
    for (let i = 0; i < 20; i++) {
      const cookies = await context.cookies();
      session = cookies.find((c) => c.name === 'rack.session');
      if (session) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!session) {
      // Dump page HTML to help debug selector issues
      const html = await page.content();
      console.error('[auth] Page HTML snippet:', html.slice(0, 2000));
      throw new Error('Login failed — rack.session cookie never appeared');
    }

    console.log('[auth] Login successful, cookie obtained.');
    return `rack.session=${session.value}`;
  } finally {
    await browser.close();
  }
}

/**
 * Returns a cached session cookie, refreshing if stale.
 * Concurrent callers share a single in-flight login promise.
 */
export async function getSessionCookie() {
  if (cachedCookie && Date.now() - cachedAt < COOKIE_TTL_MS) {
    return cachedCookie;
  }

  if (!inflightLogin) {
    inflightLogin = loginAndGetCookie()
      .then((cookie) => {
        cachedCookie = cookie;
        cachedAt = Date.now();
        inflightLogin = null;
        return cookie;
      })
      .catch((err) => {
        inflightLogin = null;
        throw err;
      });
  }

  return inflightLogin;
}

/** Force the next call to re-authenticate (call after a 401/403). */
export function invalidateCookie() {
  cachedCookie = null;
  cachedAt = 0;
}
