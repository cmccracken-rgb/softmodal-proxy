import fetch from 'node-fetch';

const BASE_URL = 'https://softmodal.com';

export async function fetchQuote({ origin, destination, size = 53 }) {
  const cookie = process.env.SOFTMODAL_COOKIE;

  if (!cookie) {
    throw new Error('Missing SOFTMODAL_COOKIE env var');
  }

  const url = `${BASE_URL}/rates/dtd`;

  const params = new URLSearchParams({
    request_id: Math.random().toString(36).substring(2, 8),
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
    s28: '',
    origin,
    destination,
    size: String(size),
    _: Date.now().toString(),
  });

  const fullUrl = `${url}?${params.toString()}`;

  const res = await fetch(fullUrl, {
    method: 'GET',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      Accept: '*/*',
      Referer: 'https://softmodal.com/dist/',
      Cookie: cookie,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Softmodal error ${res.status}: ${text}`);
  }

  const data = await res.json();

  return data;
}
