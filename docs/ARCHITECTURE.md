# Architecture and authority

There are two independent loops:

1. Shurik on GitHub Actions develops and checkpoints source to main. It uses only OPENCODE_API_KEY and the repository GITHUB_TOKEN. Its state/history is public on shurik-control/main.
2. The deployed Worker refreshes vendor observations using deterministic scheduled adapters, persists them through runtime bindings and serves the public comparison board. It does not need Shurik or an LLM to keep refreshing.

Cloudflare Workers Builds is reported connected by the owner and is serving the production Worker; it observes main pushes and performs validation before deploying. The loop independently verified the public deployment once on 2026-10-12 with read-only GETs (docs/evidence/production-verification-20261012T1554Z.json). No CF deployment workflow or CF API secret belongs in GitHub. Exclude shurik-control/* and all other branches from Cloudflare builds and previews.

This prevents Shurik's Actions process from directly authenticating to CF. It is not a sandbox for agent-authored code: Shurik writes main, so its code and configuration can influence the CF build and live Worker. CF build commands can run source-controlled code in a credentialed environment. Restrict the CF build token to this Worker and the minimum required permissions; avoid broad account permissions or unrelated build/runtime secrets. Prefer runtime bindings over administrative API tokens. Never give the public Worker an administrative CF token.

GitHub normally does not trigger another push workflow for a push using GITHUB_TOKEN. Do not rely on CI being automatically triggered by every Shurik checkpoint. Shurik must run local verification, and Cloudflare's build command must run npm run verify for every deployment. After connecting CF, verify one actual Shurik push reaches Workers Builds; never assume third-party webhook behavior from GitHub Actions behavior alone.

## Implemented runtime

The tracked scope is one product line: `src/catalog.js` holds Lavazza Crema e Gusto (a ground vacuum
brick) with its blend variants and strict classification rules. The 2026-10-12 owner correction retired
Qualità Oro, Qualità Rossa and Suerte; their ids remain as tombstones so `classifyListing` and
`resolveProductRequest` reject or explain them instead of reviving them, and each refresh prunes any
stored observation or attempt marker that belongs to a retired line. Vendor-specific adapters under `src/vendors/` (CoffeeMan, Pucks, Coffee4U)
fetch fixed allowlisted product URLs through the bounded fetcher in `src/lib/http.js` and return versioned
observations. `src/lib/quote.js` is a pure, timestamp-aware ranking engine; `src/lib/fx.js` converts
non-ILS amounts with Bank of Israel reference rates and refuses to guess when a rate is missing. It keeps
variants separate, reports how many offers a variant filter withheld, and passes every published shipping
alternative (for example a cheaper pickup-point delivery) through to the UI without using it as the ranked
amount. A vendor that publishes a courier rate but makes home delivery subject to an unpublished locality
list keeps a structured coverage caveat, so the board discloses the geographic restriction instead of
claiming unconditional country-wide delivery; availability and shipping evidence are stamped with the
retrieval time of the page they came from. Each refresh also keeps one step of comparison evidence — the
previous successful price, stock and pack weight of the same offer — so the board can show the unit-price
change since the last check in ILS (and says why when a comparison is impossible), and it advances the
board's `lastRefreshAt` only when at least one vendor actually saved an observation, so a run that fetched
only the exchange-rate table cannot look like a fresh offer check. Board freshness also reports the newest
saved observation and falls back to it for the age when no completion marker exists, so an interrupted run
(for example a redeploy stopping the background job) with fresh saved offers is not labelled never
refreshed, while a recorded but old completion still reports the scheduled pipeline as stopped.
`src/refresh.js` is the deterministic scheduled pipeline (leases, bounded concurrency, per-vendor
backoff, last-known-good retention) and the same function runs in the Worker's `scheduled` handler, the
local cron simulation and tests. `src/store.js` defines the SQLite-backed `BoardStore` Durable Object plus
in-memory and file-backed stores with the same interface. Public routes in `src/index.js` are read-only
snapshots of that storage and never fetch visitor-supplied URLs.

Verification is layered: `tests/*.test.js` covers parsers, quote edge cases, the refresh pipeline and the
Worker routes against recorded fixtures; `scripts/check-sources.mjs` re-checks the live vendor pages;
`scripts/simulate-cron.mjs` runs the full refresh offline or live; `scripts/qa-server.mjs` serves the
production front-end against fixture-backed API data so `npm run qa:browser` drives headless Chrome
offline and derives its expectations from the API. Browser QA also loads an old
`?product=lavazza-qualita-oro-vacuum-ground` URL and checks that the page shows the Crema e Gusto board
with a written retired-line notice rather than reviving the retired line. See docs/STATUS.md for the
latest recorded results.
