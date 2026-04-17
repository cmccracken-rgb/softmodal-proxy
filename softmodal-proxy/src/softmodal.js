import { getSessionCookie, invalidateSession } from './auth.js';

const BASE_URL = process.env.SOFTMODAL_BASE_URL || 'https://softmodal.com';

const COMMON_HEADERS = {
  accept: 'application/json',
  'user-agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

async function authedFetch(path, { retried = false } = {}) {
  const cookie = await getSessionCookie();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { ...COMMON_HEADERS, cookie },
  });

  if ((res.status === 401 || res.status === 403) && !retried) {
    invalidateSession();
    return authedFetch(path, { retried: true });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Softmodal ${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function buildLaneQuery({ origin, destination, size }) {
  const params = new URLSearchParams({
    origin,
    destination,
    size: String(size),
    truck_mode: 'van',
    tarps: 'false',
  });
  return params.toString();
}

function safeJsonParse(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseProvider(item) {
  if (!item || item.error) return null;
  const name = item?.vendor?.name;
  const baseRate = typeof item?.total === 'number' ? item.total : Number(item?.total);
  if (!name) return null;

  // Loup Logistics — actual is a JSON string array
  if (/loup/i.test(name)) {
    const parsed = safeJsonParse(item.actual);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const amounts = parsed
        .map((p) => Number(p?.totalPrice?.amount))
        .filter((n) => Number.isFinite(n));
      if (amounts.length > 0) {
        const min = Math.min(...amounts);
        const max = Math.max(...amounts);
        return {
          name,
          rate: Number.isFinite(baseRate) ? baseRate : min,
          range: { min, max },
        };
      }
    }
  }

  // CSX RailPlus — actual is a JSON string object
  if (/csx/i.test(name) && /rail\s*plus/i.test(name)) {
    const parsed = safeJsonParse(item.actual);
    const price = Number(parsed?.Price);
    if (Number.isFinite(price)) {
      return {
        name,
        rate: Number.isFinite(baseRate) ? baseRate : price,
        range: null,
      };
    }
  }

  if (!Number.isFinite(baseRate)) return null;
  return { name, rate: baseRate, range: null };
}

export async function fetchQuote({ origin, destination, size }) {
  const qs = buildLaneQuery({ origin, destination, size });

  const [intermodalRes, truckRes, dtdRes] = await Promise.all([
    authedFetch(`/intermodal?${qs}`).catch((e) => ({ __error: e.message })),
    authedFetch(`/truck?${qs}`).catch((e) => ({ __error: e.message })),
    authedFetch(`/rates/dtd?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&size=${encodeURIComponent(size)}`).catch((e) => ({ __error: e.message })),
  ]);

  const intermodal =
    Number(intermodalRes?.rates?.[0]?.total) ||
    null;
  const truck = Number(truckRes?.rate) || null;

  const results = Array.isArray(dtdRes?.results) ? dtdRes.results : [];
  const providers = results
    .map(parseProvider)
    .filter(Boolean)
    .sort((a, b) => a.rate - b.rate);

  return {
    intermodal,
    truck,
    providers,
    _debug: {
      intermodalError: intermodalRes?.__error || null,
      truckError: truckRes?.__error || null,
      dtdError: dtdRes?.__error || null,
    },
  };
}
