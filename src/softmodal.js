const BASE_URL = 'https://softmodal.com';

function buildParams({ origin, destination, size }) {
  return new URLSearchParams({
    request_id: Math.random().toString(36).slice(2, 8),
    truck_mode: 'van',
    tarps: 'false',
    dray_date: '18',
    hybrid_rates: '0',
    valid: new Date().toISOString().slice(0, 10),
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
    s28: '',
    origin,
    destination,
    size: String(size ?? 53),
    _: Date.now().toString(),
  });
}

function cleanCookie(raw) {
  if (!raw) return '';
  // remove URL-encoded newlines and any actual newlines
  return raw.replace(/%0A/gi, '').replace(/\r?\n/g, '').trim();
}

export async function fetchQuote({ origin, destination, size = 53 }) {
  if (!origin || !destination) {
    throw new Error('origin and destination are required');
  }

  const rawCookie = process.env.SOFTMODAL_COOKIE;
  const cookie = cleanCookie(rawCookie);

  if (!cookie || !cookie.startsWith('rack.session=')) {
    throw new Error('Invalid or missing SOFTMODAL_COOKIE (must start with rack.session=...)');
  }

  const url = `${BASE_URL}/rates/dtd?${buildParams({ origin, destination, size }).toString()}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      Accept: '*/*',
      Referer: 'https://softmodal.com/dist/',
      Cookie: cookie,
    },
  });

  // Capture body once (for both error + success)
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Softmodal error ${res.status}: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    // Sometimes APIs return HTML on auth failure — surface it clearly
    throw new Error(`Invalid JSON from Softmodal: ${text.slice(0, 300)}`);
  }
}
