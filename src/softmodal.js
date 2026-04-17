const SOFTMODAL_URL = 'https://readonly.softmodal.com/rates/dtd';

export async function fetchQuote({ origin, destination, size }) {
  const cookie = process.env.SOFTMODAL_COOKIE;

  if (!cookie) {
    throw new Error('Missing SOFTMODAL_COOKIE env variable');
  }

  const params = new URLSearchParams({
    request_id: Math.random().toString(36).substring(2, 10),
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
    size,
    _: Date.now().toString(),
  });

  const url = `${SOFTMODAL_URL}?${params.toString()}`;

  console.log('REQUEST URL:', url);

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': '*/*',
      'Referer': 'https://readonly.softmodal.com/',
      'Cookie': cookie,
    },
  });

  const text = await res.text();

  console.log('STATUS:', res.status);

  if (!res.ok) {
    throw new Error(`Softmodal HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON (likely logged out): ${text.slice(0, 300)}`);
  }
}
