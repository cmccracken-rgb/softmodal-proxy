# Softmodal Proxy

A small Node.js + Playwright service that authenticates with [softmodal.com](https://softmodal.com), maintains a `rack.session` cookie, and exposes a clean `/quote` endpoint that the Lovable app calls via a Supabase edge function.

> ⚠️ Lovable does **not** host this service. Deploy it to Railway / Render / Fly.io and paste the public URL into the `SOFTMODAL_PROXY_URL` secret in Lovable Cloud.

## Endpoints

### `GET /healthz`
Returns `{ ok: true }`.

### `GET /quote?origin=...&destination=...&size=53`
Returns:
```json
{
  "intermodal": 4123,
  "truck": 4890,
  "providers": [
    { "name": "COFC Logistics", "rate": 4251, "range": null },
    { "name": "Loup Logistics", "rate": 4360, "range": { "min": 4360, "max": 4466 } },
    { "name": "CSX RailPlus",  "rate": 5683, "range": null }
  ]
}
```

All requests must include header `x-proxy-token: <PROXY_SHARED_TOKEN>` to prevent abuse.

## Behavior

1. Logs into Softmodal once with Playwright (Chromium headless).
2. Extracts the `rack.session` cookie and caches it in memory for ~25 minutes.
3. Refreshes automatically when expired or on a 401/403.
4. Calls these Softmodal endpoints with the cookie:
   - `/intermodal?origin=...&destination=...&size=...&truck_mode=van&tarps=false`
   - `/truck?origin=...&destination=...&size=...&truck_mode=van&tarps=false`
   - `/rates/dtd?origin=...&destination=...&size=...`
5. Parses provider results, including the special cases:
   - **Loup Logistics** — `actual` is a JSON-encoded array; min/max of `totalPrice.amount`.
   - **CSX RailPlus** — `actual` is a JSON-encoded object; uses `Price`.

## Environment variables

| Name | Required | Description |
| --- | --- | --- |
| `SOFTMODAL_EMAIL` | yes | Login email |
| `SOFTMODAL_PASSWORD` | yes | Login password |
| `PROXY_SHARED_TOKEN` | yes | Random string. Set the same value as `SOFTMODAL_PROXY_TOKEN` in Lovable Cloud secrets. |
| `PORT` | no | Defaults to `3000` |
| `SOFTMODAL_LOGIN_URL` | no | Defaults to `https://softmodal.com/login` |
| `SOFTMODAL_BASE_URL` | no | Defaults to `https://softmodal.com` |

## Run locally

```bash
cd softmodal-proxy
npm install
npx playwright install --with-deps chromium
SOFTMODAL_EMAIL=... SOFTMODAL_PASSWORD=... PROXY_SHARED_TOKEN=dev npm start
```

Then test:
```bash
curl -H "x-proxy-token: dev" \
  "http://localhost:3000/quote?origin=Chicago,%20IL&destination=Atlanta,%20GA&size=53"
```

## Deploy to Railway

1. Push this folder to a repo (or use Railway's deploy-from-folder).
2. Create a new Railway service from the repo, root directory `softmodal-proxy`.
3. Railway auto-detects the `Dockerfile`.
4. Add the env vars above in Railway → Variables.
5. After deploy, copy the public URL (e.g. `https://softmodal-proxy-production.up.railway.app`).
6. In Lovable Cloud, set:
   - `SOFTMODAL_PROXY_URL` = that URL
   - `SOFTMODAL_PROXY_TOKEN` = the same value as `PROXY_SHARED_TOKEN`

The Lovable edge function `softmodal-quote` will call `${SOFTMODAL_PROXY_URL}/quote` with the token header.

## Notes

- Login selectors may need adjustment if Softmodal changes their form. Edit `LOGIN_SELECTORS` in `src/auth.js`.
- The cookie cache is in-memory, so a restart triggers a fresh login.
- Concurrent requests during a refresh share the same in-flight login promise (no thundering herd).
