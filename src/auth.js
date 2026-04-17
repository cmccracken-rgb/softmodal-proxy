import { chromium } from 'playwright';

const LOGIN_URL =
  process.env.SOFTMODAL_LOGIN_URL ||
  'https://readonly.softmodal.com/sessions/login';

export async function getSessionCookie() {
  const email = process.env.SOFTMODAL_EMAIL;
  const password = process.env.SOFTMODAL_PASSWORD;

  if (!email || !password) {
    throw new Error('Missing Softmodal credentials');
  }

  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

    // 🧹 CLOSE POPUP IF EXISTS
    try {
      await page.click('text=Subscribe', { timeout: 2000 });
    } catch {}
    await page.keyboard.press('Escape').catch(() => {});

    // 🔥 CLICK LOG IN BUTTON
    await page.waitForSelector('text=LOG IN', { timeout: 10000 });
    await page.click('text=LOG IN');

    // ✅ WAIT FOR VISIBLE INPUTS
    await page.waitForSelector('input[name="email"]:visible', {
      timeout: 10000,
    });

    // ✍️ FILL FORM
    await page.fill('input[name="email"]:visible', email);
    await page.fill('input[name="password"]:visible', password);

    // 🚀 SUBMIT
    await page.click('button[type="submit"]');

    // ⏳ WAIT FOR COOKIE (RETRY LOOP)
    let session = null;

    for (let i = 0; i < 10; i++) {
      const cookies = await context.cookies();
      session = cookies.find((c) => c.name === 'rack.session');
      if (session) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!session) {
      throw new Error('Failed to get rack.session cookie');
    }

    return `rack.session=${session.value}`;
  } finally {
    await browser.close();
  }
}
