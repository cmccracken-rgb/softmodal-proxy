import { getSessionCookie, invalidateCookie } from './auth.js';

const BASE_URL = process.env.SOFTMODAL_BASE_URL || 'https://softmodal.com';

/**
 * Make an authenticated GET request to Softmodal.
 * Retries once after re-login on 401/403.
 */
async function authedGet(path, params, attempt = 0) {
  const cookie = await getSessionCookie();
  const url = `${BASE_URL}${path}?${params.toString()}`;

  console.log(`[softmodal] GET ${url}`);

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json, text/javascript, */*; q=0.01',
      'accept-language': 'en-US,en;q=0.9',
      'x-requested-with': 'XMLHttpRequest',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      referer: BASE_URL + '/',
      cookie,
    },
  });

  console.log(`[softmodal] status ${res.status} for ${path}`);

  if ((res.status === 401 || res.status === 403) && attempt === 0) {
    console.warn('[softmodal] Session rejected, re-authenticating...');
    invalidateCookie();
    return authedGet(path, params, 1);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Softmodal returned ${res.status}: ${body.slice(0, 300)}`);
  }

  const text = await res.text();
  console.log('[softmodal] raw response:', text.slice(0, 400));

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/**
 * Build the shared query params used by all Softmodal rate endpoints.
 */
function baseParams(origin, destination, size, extra = {}) {
  return new URLSearchParams({
    origin,
    destination,
    size,
    truck_mode: 'van',
    tarps: 'false',
    mileage_routing: 'practical',
    valid: new Date().toISOString().split('T')[0],
    _: Date.now().toString(),
    ...extra,
  });
}

/**
 * Parse a provider list out of whatever shape Softmodal returns.
 * The response shape varies per endpoint — this handles the known cases.
 */
function parseProviders(data) {
  if (!data || typeof data !== 'object') return [];

  // data may be an array of provider objects, or a keyed object
  const items = Array.isArray(data) ? data : Object.values(data);

  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return null;

      const name = item.name || item.carrier || item.provider || 'Unknown';
      let rate = null;
      let range = null;

      // Some providers encode `actual` as a JSON string
      if (typeof item.actual === 'string') {
        try {
          const parsed = JSON.parse(item.actual);
          if (Array.isArray(parsed)) {
            // e.g. Loup Logistics — array of { totalPrice: { amount } }
            const amounts = parsed
              .map((r) => r?.totalPrice?.amount ?? r?.amount ?? r?.price)
              .filter((n) => typeof n === 'number');
            if (amounts.length) {
              range = { min: Math.min(...amounts), max: Math.max(...amounts) };
              rate = range.min;
            }
          } else if (typeof parsed === 'object') {
            // e.g. CSX RailPlus — { Price: ... }
            rate = parsed.Price ?? parsed.price ?? parsed.rate ?? null;
          }
        } catch {
          // non-JSON string — treat as raw rate
          const n = parseFloat(item.actual);
          if (!isNaN(n)) rate = n;
        }
      } else {
        rate =
          item.rate ??
          item.price ??
          item.total ??
          item.amount ??
          item.actual ??
          null;
      }

      if (rate === null) return null;
      return { name, rate: Math.round(Number(rate)), range };
    })
    .filter(Boolean)
    .sort((a, b) => a.rate - b.rate);
}

/**
 * Main entry point. Calls the dtd (door-to-door) rates endpoint which
 * returns intermodal + truck rates in one shot.
 */
export async function fetchQuote({ origin, destination, size = '53' }) {
  console.log('[softmodal] fetchQuote', { origin, destination, size });

  // ── Primary: door-to-door rates ─────────────────────────────────────────
  const dtdParams = baseParams(origin, destination, size, {
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
  });

  let dtd = null;
  let intermodalRate = null;
  let truckRate = null;
  let providers = [];

  try {
    dtd = await authedGet('/rates/dtd', dtdParams);

    // The response may look like:
    // { intermodal: 4123, truck: 4890, providers: [...] }
    // or a flat array of providers
    // or nested objects by provider name
    if (dtd && typeof dtd === 'object' && !Array.isArray(dtd)) {
      intermodalRate = dtd.intermodal ?? dtd.intermodal_rate ?? null;
      truckRate = dtd.truck ?? dtd.truck_rate ?? null;
      providers = parseProviders(dtd.providers ?? dtd.rates ?? dtd);
    } else {
      providers = parseProviders(dtd);
    }
  } catch (err) {
    console.error('[softmodal] dtd endpoint failed:', err.message);
    // Fall through to per-mode fallback below
  }

  // ── Fallback: try /intermodal and /truck separately ─────────────────────
  if (intermodalRate === null) {
    try {
      const iData = await authedGet(
        '/intermodal',
        baseParams(origin, destination, size)
      );
      intermodalRate =
        iData?.rate ?? iData?.price ?? iData?.intermodal ?? null;
      if (!providers.length) {
        providers = parseProviders(iData?.providers ?? iData?.rates ?? iData);
      }
    } catch (err) {
      console.warn('[softmodal] /intermodal fallback failed:', err.message);
    }
  }

  if (truckRate === null) {
    try {
      const tData = await authedGet(
        '/truck',
        baseParams(origin, destination, size)
      );
      truckRate = tData?.rate ?? tData?.price ?? tData?.truck ?? null;
    } catch (err) {
      console.warn('[softmodal] /truck fallback failed:', err.message);
    }
  }

  return {
    origin,
    destination,
    size,
    intermodal: intermodalRate !== null ? Math.round(Number(intermodalRate)) : null,
    truck: truckRate !== null ? Math.round(Number(truckRate)) : null,
    providers,
    raw: dtd, // included for debugging — remove once stable
  };
}
