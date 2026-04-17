import { getSessionCookie } from './auth.js';

const BASE = 'https://readonly.softmodal.com';

// ✅ Format "Chicago, IL" → "Chicago IL to Atlanta GA"
function formatLane(origin, destination) {
  function clean(loc) {
    return (loc || '')
      .replace(',', '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return `${clean(origin)} to ${clean(destination)}`;
}

// ✅ Build URL safely
function buildUrl(path, params) {
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value);
    }
  });
  return url;
}

// ✅ Safe fetch wrapper
async function softmodalFetch(path, params, session) {
  const url = buildUrl(path, params);

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Cookie: session.cookie,
      'X-CSRF-Token': session.csrf,
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`${path} failed (${res.status})`);
  }

  return res.json();
}

// 🚀 MAIN FUNCTION
export async function getSoftmodalQuote({
  origin,
  destination,
  size = 53,
}) {
  const session = await getSessionCookie();

  // 🔥 Prevent crash if auth failed
  if (!session || !session.cookie || !session.csrf) {
    throw new Error('Invalid session (missing cookie or CSRF)');
  }

  const lane = formatLane(origin, destination);

  const params = {
    origin: lane,
    size,
    truck_mode: 'van',
  };

  let intermodal = null;
  let truck = null;
  let providers = [];
  const debug = {};

  await Promise.all([
    // 🚂 INTERMODAL
    softmodalFetch('/intermodal', params, session)
      .then((data) => {
        intermodal =
          data?.rate ||
          data?.price ||
          data?.total ||
          null;
      })
      .catch((e) => {
        debug.intermodalError = e.message;
      }),

    // 🚛 TRUCK
    softmodalFetch('/truck', params, session)
      .then((data) => {
        truck =
          data?.rate ||
          data?.price ||
          data?.total ||
          null;
      })
      .catch((e) => {
        debug.truckError = e.message;
      }),

    // 📊 PROVIDERS (DTD)
    softmodalFetch('/rates/dtd', params, session)
      .then((data) => {
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.results)
          ? data.results
          : [];

        providers = list.map((p) => ({
          name: p.provider || p.name || 'Unknown',
          price:
            p.price ||
            p.rate ||
            (p.min && p.max ? `${p.min}-${p.max}` : null),
        }));
      })
      .catch((e) => {
        debug.dtdError = e.message;
      }),
  ]);

  return {
    intermodal,
    truck,
    providers,
    _debug: Object.keys(debug).length ? debug : undefined,
  };
}
