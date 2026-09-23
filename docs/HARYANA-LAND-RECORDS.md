# Haryana Land Records (HSAC)

Clicking a plot in the Haryana atlas (`config/haryana.atlas.json` → layer `plots`) runs
`getHaryanaLandRecord` from `config/haryana.js`, which looks up owner details for that
Khasra from the Haryana Space Applications Centre EODB service.

```
https://hsac.in/eodb_backend/mapserver/land-record/Owner_name
  ?Dcode1=<n_d_code>&Tcode1=<n_t_code>&Nvcode1=<n_v_code>&Mustno1=<n_murr_no>&Khasra1=<n_khas_no>
```

The response is an ASP.NET `<string>` envelope wrapping an escaped `<root>` document. The
handler unwraps both layers and renders `OWNER` first, then the remaining fields
(`NVCODE` → Village Code, `CKHEWAT` → Khewat No., and any others by tag name).

## Why a bridge is needed

HSAC gates this endpoint:

- Unauthenticated requests get `401 {"message":"Authentication required"}`.
- A request carrying any foreign `Origin` gets `403` with **no CORS headers at all**, so a
  browser on amche.in can never call it directly — with or without credentials.

Their session is established by a phone/OTP login (`/captcha/new` → `/otp/send-otp` →
`/otp/verify-otp`) that returns a `signingKey` alongside a session cookie. Every later
request must carry **both**: the cookie *and* headers

```
X-Device-Id, X-Device-Info, X-Signed-At, X-Signature
X-Signature = HMAC-SHA256("<METHOD>\n<path>\n<signedAt>\n<body>", signingKey) as hex
```

where `<path>` is the URL with query stripped, the `/eodb_backend` prefix removed, trailing
slashes trimmed, and lowercased.

Relaying that login through amche's shared proxy would mean our server handling other
people's phone numbers, OTPs and government session cookies. We don't do that. Instead the
lookup runs **inside the user's own hsac.in tab**.

## Installing the bridge

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey).
2. Add [`tools/hsac-bridge.user.js`](../tools/hsac-bridge.user.js) as a userscript.
   For a one-off session you can instead paste the whole file into the devtools console on
   an open `hsac.in/eodb` tab.
3. On amche, click a Haryana plot and press **Open HSAC tab**. Complete the OTP login there
   if you haven't already; an `amche bridge active` badge appears bottom-right.
4. Back on the map, lookups now resolve through that tab. One tab serves every plot click
   for as long as it stays open.

Reloading amche throws away its handle on the HSAC tab, so the bridge announces itself to
its opener every two seconds. A card offering **Open HSAC tab** upgrades itself to a real
lookup within a heartbeat if that tab is still open — no second tab, no second login. Each
announcement is addressed to one exact origin (the amche origins in
`DEFAULT_ANNOUNCE_ORIGINS`, plus any allowlisted origin that has talked to the bridge
before, remembered in `localStorage.amche_bridge_origins`), never `*`.

## What crosses the boundary

- amche → hsac tab: `{ dCode, tCode, vCode, murabbaNo, khasraNo }` for the clicked plot.
- hsac tab → amche: the XML response text and its HTTP status.

The session cookie, the signing key and your phone number never leave hsac.in, and nothing
passes through amche's proxy. The bridge only answers `postMessage` calls from an allowlist
of amche origins (`amche.in`, `*.amche.in`, `publicmap.github.io`, localhost) and only
serves the one land-record endpoint.

Without the bridge the handler still tries the shared proxy and, on the expected `401`,
shows the plot's Khasra number with a link to hsac.in/eodb/map.

## Tests

`js/tests/haryana-land-record.test.js` covers the bridge's origin allowlist, its request
signing (checked against an independent HMAC implementation), and the handler's parsing,
owner-first ordering and login-gate fallback.
