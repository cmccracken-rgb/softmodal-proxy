import { chromium } from 'playwright';

const LOGIN_URL =
  process.env.SOFTMODAL_LOGIN_URL ||
  'https://readonly.softmodal.com/sessions/login';

const COOKIE_TTL_MS = 25 * 60 * 1000;

let cachedCookie = null;
let cachedAt = 0;

async function loginAndGetCookie() {
  const email = process.env.SOFTMODAL_EMAIL;
  const password = process.env.SOFTMODAL_PASSWORD;

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

    // click login button
    await page.click('text=LOG IN');

    await page.waitForSelector('input[name="email"]:visible');

    await page.fill('input[name="email"]:visible', email);
    await page.fill('input[name="password"]:visible', password);

    await page.click('button[type="submit"]');

    // wait for cookie
    let session = null;
    for (let i = 0; i < 10; i++) {
      const cookies = await context.cookies();
      session = cookies.find((c) => c.name === 'rack.session');
      if (session) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!session) throw new Error('No session cookie');

    return `rack.session=${session.value}`;
  } finally {
    await browser.close();
  }
}

export async function getSessionCookie() {
  const isFresh =
    cachedCookie && Date.now() - cachedAt < COOKIE_TTL_MS;

  if (isFresh) {
    return cachedCookie;
  }

  const cookie = await loginAndGetCookie();

  cachedCookie = cookie;
  cachedAt = Date.now();

  return cookie;
}
