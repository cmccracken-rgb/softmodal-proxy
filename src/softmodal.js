import { chromium } from 'playwright';

const LOGIN_URL =
  process.env.SOFTMODAL_LOGIN_URL ||
  'https://readonly.softmodal.com/sessions/login';

const COOKIE_TTL_MS = 25 * 60 * 1000;

let cachedCookie = null;
let cachedAt = 0;
let inFlight = null;

async function loginAndGetCookie() {
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

    // fill login form
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
      page.click('button[type="submit"]'),
    ]);

    const cookies = await context.cookies();

    const session = cookies.find((c) => c.name === 'rack.session');

    if (!session) {
      throw new Error('No rack.session cookie found');
    }

    return `rack.session=${session.value}`;
  } finally {
    await browser.close();
  }
}

async function getSessionCookie() {
  const fresh = cachedCookie && Date.now() - cachedAt < COOKIE_TTL_MS;
  if (fresh) return cachedCookie;

  if (!inFlight) {
    inFlight = loginAndGetCookie()
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

// 🔥 THIS IS THE IMPORTANT PART
export async function fetchQuote({ origin, destination, size = 53 }) {
  const cookie = await getSessionCookie();

  const params = new URLSearchParams({
    request_id: Math.random().toString(36).substring(2, 9),
    truck_mode: 'van',
    tarps: 'false',
    dray_date: '18',
    hybrid_rates: '0',
    valid: new Date().toISOString().split('T')[0],
    restricted: 'false',
    o_stay: 'true',
    o_drop: 'true',
    o_oneway: 'true',
    d_stay: 'true',
    d_drop: 'true',
    d_oneway: 'true',
    o_stop: 'false',
    d_stop: 'false',
    priv: 'false',
    empty: 'false',
    hazardous: 'false',
    embargoed: '30',
    o_days: '2',
    d_days: '2',
    placeholder: '0',
    dray_rate_flag: '5',
    mileage_routing: 'practical',
    tipe: 'imc',
    add_dray_rate: '1',
    origin,
    destination,
    size: String(size),
    _: Date.now().toString(),
  });

  const url = `https://softmodal.com/rates/dtd?${params.toString()}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Cookie: cookie,
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146 Safari/537.36',
      Accept: '*/*',
      Referer: 'https://softmodal.com/dist/',
    },
  });

  if (!res.ok) {
    throw new Error(`Softmodal request failed: ${res.status}`);
  }

  const data = await res.json();

  return data;
}
