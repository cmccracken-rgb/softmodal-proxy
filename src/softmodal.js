import { getSessionCookie } from './auth.js';

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
      Accept: '*/*',
      Referer: 'https://softmodal.com/dist/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146 Safari/537.36',
    },
  });

  if (!res.ok) {
    throw new Error(`Softmodal request failed: ${res.status}`);
  }

  return await res.json();
}
