import { getSessionCookie, invalidateSession } from './auth.js';

const BASE_URL = process.env.SOFTMODAL_BASE_URL || 'https://softmodal.com';

const COMMON_HEADERS = {
  accept: 'application/json, text/javascript, */*; q=0.01',
  'accept-language': 'en-US,en;q=0.9',
  'x-requested-with': 'XMLHttpRequest',
  'user-agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

// ─── HTTP helpers ────────────────────────────────────────────────────────────

async function authedText(path, { retried = false } = {}) {
  const cookie = await getSessionCookie();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { ...COMMON_HEADERS, cookie, referer: BASE_URL + '/' },
  });

  if ((res.status === 401 || res.status === 403) && !retried) {
    invalidateSession();
    return authedText(path, { retried: true });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Softmodal ${path} → HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.text();
}

async function authedJson(path, { retried = false } = {}) {
  const text = await authedText(path, { retried });
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// ─── Query builders ──────────────────────────────────────────────────────────

// Shared params used by truck and driving endpoints
function commonParams({ origin, destination, size }) {
  return new URLSearchParams({
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
  }).toString();
}

function dtdParams({ origin, destination, size }) {
  return new URLSearchParams({
    truck_mode: 'van',
    tarps: 'false',
    mileage_routing: 'practical',
    tipe: 'imc',
    add_dray_rate: '1',
    dray_rate_flag: '5',
    o_days: '2',
    d_days: '2',
    o_stay: 'true',
    o_drop: 'true',
    o_oneway: 'true',
    d_stay: 'true',
    d_drop: 'true',
    d_oneway: 'true',
    placeholder: '0',
    restricted: 'false',
    embargoed: '30',
    hazardous: 'false',
    empty: 'false',
    priv: 'false',
    valid: new Date().toISOString().split('T')[0],
    _: Date.now().toString(),
    origin,
    destination,
    size: String(size),
  }).toString();
}

// ─── Streaming DTD response parser ───────────────────────────────────────────

function parseStreamedDTD(text) {
  const best = new Map();

  let depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') { if (depth++ === 0) start = i; }
    else if (text[i] === '}') {
      if (--depth === 0 && start !== -1) {
        const chunk = text.slice(start, i + 1);
        start = -1;
        let parsed;
        try { parsed = JSON.parse(chunk); } catch { continue; }

        const items = parsed.results ?? (Array.isArray(parsed) ? parsed : null);
        if (!items) continue;

        for (const item of items) {
          const id = item?.vendor?.id;
          if (!id) continue;
          const existing = best.get(id);
          const hasRate = item.total > 0 && !item.error;
          const existingHasRate = existing && existing.total > 0 && !existing.error;
          if (!existing || (!existingHasRate && hasRate) || (hasRate && item.total < existing.total)) {
            best.set(id, item);
          }
        }
      }
    }
  }

  return [...best.values()];
}

// ─── Provider formatter ───────────────────────────────────────────────────────

function safeJson(str) {
  if (typeof str !== 'string' || !str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

function formatProvider(item) {
  const name = item?.vendor?.name ?? 'Unknown';
  const hasRate = item.total > 0 && !item.error;

  if (!hasRate) {
    return { name, rate: null, range: null, available: false, error: item.error || 'No rate' };
  }

  const base = { name, rate: Math.round(item.total), range: null, available: true, error: null };
  const actual = safeJson(item.actual);

  // Triple Crown — { success, payload: [{ prices: [{ totalCharge, available }] }] }
  if (actual?.success !== undefined && actual?.payload) {
    const prices = actual.payload[0]?.prices ?? [];
    const available = prices.filter((p) => p.available).map((p) => Math.round(p.totalCharge));
    if (available.length > 1) {
      base.range = { min: Math.min(...available), max: Math.max(...available) };
    }
    return base;
  }

  // Loup — [{ totalPrice: { amount }, capacityAvailable, estimatedTransitDays }]
  if (Array.isArray(actual) && actual[0]?.totalPrice) {
    const amounts = actual.filter((p) => p.capacityAvailable).map((p) => p.totalPrice.amount);
    if (amounts.length > 0) base.range = { min: Math.min(...amounts), max: Math.max(...amounts) };
    base.transitDays = actual[0]?.estimatedTransitDays ?? null;
    return base;
  }

  // CSX — { Price, TransitTime, QuoteReferenceNumber }
  if (actual?.Price !== undefined) {
    base.transitDays = actual.TransitTime ?? null;
    base.quoteRef = actual.QuoteReferenceNumber ?? null;
    return base;
  }

  return base;
}

// ─── Truck rate ───────────────────────────────────────────────────────────────
// /rates/truck returns RPM (rate per mile): { rates: [{ name, rpm }] }
// /driving returns mileage:                { miles: 721, ... }
// Truck rate = Static Average rpm × miles

async function fetchTruckRate({ origin, destination, size }) {
  const qs = commonParams({ origin, destination, size });

  const [truckData, drivingData] = await Promise.all([
    authedJson(`/rates/truck?${qs}`).catch((e) => {
      console.error('[softmodal] /rates/truck error:', e.message);
      return null;
    }),
    authedJson(`/driving?${qs}`).catch((e) => {
      console.error('[softmodal] /driving error:', e.message);
      return null;
    }),
  ]);

  console.log('[softmodal] truck raw:', JSON.stringify(truckData));
  console.log('[softmodal] driving raw:', JSON.stringify(drivingData));

  const rates = truckData?.rates;
  if (!Array.isArray(rates)) return null;

  // Find Static Average RPM
  const avgEntry = rates.find((r) => r.name === 'Static Average');
  const rpm = avgEntry?.rpm ?? null;
  if (!rpm) return null;

  // Get miles from driving endpoint
  const miles = drivingData?.miles ?? drivingData?.distance ?? drivingData?.mileage ?? null;
  if (!miles) {
    console.warn('[softmodal] No miles found in driving response, cannot compute truck rate');
    return null;
  }

  const truckRate = Math.round(rpm * miles);
  console.log(`[softmodal] truck rate: ${rpm} rpm × ${miles} miles = $${truckRate}`);
  return truckRate;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchQuote({ origin, destination, size = '53' }) {
  console.log('[softmodal] fetchQuote', { origin, destination, size });

  const dqs = dtdParams({ origin, destination, size });

  const [dtdText, truck] = await Promise.all([
    authedText(`/rates/dtd?${dqs}`).catch((e) => {
      console.error('[softmodal] DTD error:', e.message);
      return '';
    }),
    fetchTruckRate({ origin, destination, size }),
  ]);

  const items = parseStreamedDTD(dtdText);
  const providers = items.map(formatProvider).sort((a, b) => {
    if (a.available && !b.available) return -1;
    if (!a.available && b.available) return 1;
    return (a.rate ?? Infinity) - (b.rate ?? Infinity);
  });

  const intermodal = providers.find((p) => p.available)?.rate ?? null;

  console.log('[softmodal] result:', { intermodal, truck, providerCount: providers.length });

  return { origin, destination, size, intermodal, truck, providers };
}
