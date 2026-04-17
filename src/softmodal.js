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

// ─── Query builder ───────────────────────────────────────────────────────────

function laneQS({ origin, destination, size }) {
  return new URLSearchParams({
    origin,
    destination,
    size: String(size),
    truck_mode: 'van',
    tarps: 'false',
    mileage_routing: 'practical',
  }).toString();
}

function dtdQS({ origin, destination, size }) {
  return new URLSearchParams({
    origin,
    destination,
    size: String(size),
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
  }).toString();
}

// ─── Streaming response parser ───────────────────────────────────────────────
// Softmodal flushes multiple JSON objects back-to-back as rail carriers respond:
//   {"results":[...]}{"results":[...]}{"results":[...]}
// We split on brace depth, parse each chunk, and deduplicate by vendor id,
// keeping the lowest rate seen across all chunks.

function parseStreamedDTD(text) {
  const best = new Map(); // vendor id → item

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
          // Keep this vendor's entry; prefer lower total, but always prefer a
          // non-error entry over an error entry.
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

// ─── Provider formatter ──────────────────────────────────────────────────────
// Returns a provider object for EVERY vendor (including no-rate ones) so
// Lovable can show the full log panel matching what Softmodal shows.

function safeJson(str) {
  if (typeof str !== 'string' || !str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

function formatProvider(item) {
  const name = item?.vendor?.name ?? 'Unknown';
  const hasRate = item.total > 0 && !item.error;

  if (!hasRate) {
    return {
      name,
      rate: null,
      range: null,
      available: false,
      error: item.error || 'No rate',
    };
  }

  const base = { name, rate: Math.round(item.total), range: null, available: true, error: null };
  const actual = safeJson(item.actual);

  // Triple Crown — actual: { success, equipSize, payload: [{ prices: [{ totalCharge, available }] }] }
  if (actual?.success !== undefined && actual?.payload) {
    const prices = actual.payload[0]?.prices ?? [];
    const available = prices.filter((p) => p.available).map((p) => Math.round(p.totalCharge));
    if (available.length > 1) {
      base.range = { min: Math.min(...available), max: Math.max(...available) };
    }
    return base;
  }

  // Loup — actual: [{ totalPrice: { amount }, capacityAvailable }]
  if (Array.isArray(actual) && actual[0]?.totalPrice) {
    const amounts = actual
      .filter((p) => p.capacityAvailable)
      .map((p) => p.totalPrice.amount);
    if (amounts.length > 0) {
      base.range = { min: Math.min(...amounts), max: Math.max(...amounts) };
    }
    base.transitDays = actual[0]?.estimatedTransitDays ?? null;
    return base;
  }

  // CSX — actual: { Price, TransitTime, QuoteReferenceNumber, ... }
  if (actual?.Price !== undefined) {
    base.transitDays = actual.TransitTime ?? null;
    base.quoteRef = actual.QuoteReferenceNumber ?? null;
    return base;
  }

  return base;
}

// ─── Truck rate ──────────────────────────────────────────────────────────────
// The /truck endpoint returns a simple JSON object.
// The rate lives at different paths depending on Softmodal's response shape.

function extractTruckRate(data) {
  if (!data || data.raw) return null; // failed / HTML response
  // Try common paths
  const candidates = [
    data?.rate,
    data?.truck,
    data?.total,
    data?.rates?.[0]?.rate,
    data?.rates?.[0]?.total,
    data?.price,
  ];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return null;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Fetch all rates for a lane and return a clean object for Lovable.
 *
 * Response shape:
 * {
 *   origin, destination, size,
 *   intermodal: 1669.89,   // lowest DTD total (null if none)
 *   truck: 1557.36,        // truck rate (null if unavailable)
 *   providers: [
 *     { name, rate, range, available, error, transitDays?, quoteRef? },
 *     ...
 *   ]
 * }
 */
export async function fetchQuote({ origin, destination, size = '53' }) {
  console.log('[softmodal] fetchQuote', { origin, destination, size });

  const qs = laneQS({ origin, destination, size });
  const dqs = dtdQS({ origin, destination, size });

  // Fire DTD (streaming) and truck in parallel
  const [dtdText, truckData] = await Promise.all([
    authedText(`/rates/dtd?${dqs}`).catch((e) => {
      console.error('[softmodal] DTD error:', e.message);
      return '';
    }),
    authedJson(`/truck?${qs}`).catch((e) => {
      console.error('[softmodal] truck error:', e.message);
      return null;
    }),
  ]);

  const items = parseStreamedDTD(dtdText);
  const providers = items.map(formatProvider).sort((a, b) => {
    // Sort: rates first (ascending), then no-rate entries
    if (a.available && !b.available) return -1;
    if (!a.available && b.available) return 1;
    return (a.rate ?? Infinity) - (b.rate ?? Infinity);
  });

  const lowestIntermodal = providers.find((p) => p.available)?.rate ?? null;
  const truck = extractTruckRate(truckData);

  console.log('[softmodal] result:', { intermodal: lowestIntermodal, truck, providerCount: providers.length });

  return {
    origin,
    destination,
    size,
    intermodal: lowestIntermodal,
    truck,
    providers,
  };
}
