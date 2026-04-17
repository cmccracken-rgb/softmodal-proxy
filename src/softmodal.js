import { getSessionCookie } from './auth.js';

const BASE = 'https://readonly.softmodal.com';

// 🧠 Normalize input → "City ST to City ST"
function formatLane(origin, destination) {
  function clean(loc) {
    return loc.replace(',', '').trim();
  }

  return `${clean(origin)} to ${clean(destination)}`;
}

// 🔧 Build URL with params
function buildUrl(path, params) {
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, v);
    }
  });
  return url;
}

// 🚀 Core fetch helper
async function softmodalFetch(path, params, session) {
  const url = buildUrl(path, params);

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Cookie': session.cookie,
      'X-CSRF-Token': session.csrf,
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Softmodal ${path} failed (${res.status})`);
  }

  return res.json();
}

// 🎯 Main quote function
export async function getSoftmodalQuote({
  origin,
  destination,
  size = 53,
}) {
  const session = await getSessionCookie();

if (!session || !session.cookie) {
  throw new Error('Invalid session from auth.js');
}

  const lane = formatLane(origin, destination);

  const baseParams = {
    origin: lane,
    size,
    truck_mode: 'van',
  };

  let intermodal = null;
  let truck = null;
  let providers = [];
  const debug = {};

  // 🔥 Run all in parallel
  await Promise.all([
    // 🚂 Intermodal
    softmodalFetch('/intermodal', baseParams, session)
      .then((data) => {
        intermodal = data?.rate || data?.price || null;
      })
      .catch((e) => {
        debug.intermodalError = e.message;
      }),

    // 🚛 Truck
    softmodalFetch('/truck', baseParams, session)
      .then((data) => {
        truck = data?.rate || data?.price || null;
      })
      .catch((e) => {
        debug.truckError = e.message;
      }),

    // 📊 Providers (DTD)
    softmodalFetch('/rates/dtd', baseParams, session)
      .then((data) => {
        if (Array.isArray(data)) {
          providers = data.map((p) => ({
            name: p.provider || p.name,
            price:
              p.price ||
              p.rate ||
              (p.min && p.max ? `${p.min}-${p.max}` : null),
          }));
        }
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
