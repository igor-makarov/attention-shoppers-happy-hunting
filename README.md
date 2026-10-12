# Attention shoppers. Happy hunting.

A public online shopping board for delivery in Israel tracking **one product**: **Lavazza Crema e Gusto vacuum-packed ground coffee** (Classico, Forte and other blend variants and every pack size or multipack kept separate). The board compares actual availability and item price plus shipping for a selected quantity and Israeli locality, with visible source evidence and freshness. Unknown shipping is never silently treated as free, and a published courier rate that the vendor's terms make subject to an unpublished locality list is disclosed as a coverage caveat instead of being assumed country-wide.

The 2026-10-12 owner correction retired the earlier multi-product scope: Lavazza Qualità Oro, Qualità Rossa and Suerte are no longer fetched, ranked or shown. Their old listings survive only as historical evidence in [docs/SOURCES.md](docs/SOURCES.md), labelled as such, and as negative fixtures that prove the adapters refuse them. Re-adding any product line needs an explicit new owner instruction.

Three Israeli vendor adapters currently observe **five real Crema e Gusto listings**: CoffeeMan single 250 g, 4 × 250 g and 8 × 250 g, Pucks 250 g and Coffee4U 250 g. Swiss signage design, meaningful status colors, no emoji typography.

The board is implemented and self-updating: deterministic vendor adapters observe real product pages, a
pure quote engine ranks delivered ILS totals, and a scheduled Durable Object refresh keeps the data
current without a browser or the coding loop. Each refresh keeps the previous successful price and stock
for the same offer, so the board shows the unit-price change since the last check (or explains why a
comparison is impossible), and it reports a completed refresh only when a vendor was actually re-observed.
If a run is interrupted after saving observations, freshness falls back to the newest saved observation
instead of claiming the board never refreshed. A failed vendor check keeps the last successful
observation ranked but stamps the attempt time and reason on it, so the board says the most recent check
failed instead of presenting the row as freshly re-checked. See [current status](docs/STATUS.md),
[observed sources](docs/SOURCES.md), [design](docs/DESIGN.md) and [architecture](docs/ARCHITECTURE.md).

## Coding loop

The workflow uses [igor-makarov/shurik@v1](https://github.com/igor-makarov/shurik), opencode-go/deepseek-v4.1-flash and max reasoning. The owner chose direct work on main and has added the OPENCODE_API_KEY Actions secret. The first handoff is complete; the main loop will develop the tracker while Cloudflare remains disconnected. Check the Actions page and shurik-control/main for live loop state.

DeepSeek V4.1 Flash is present in Shurik's pinned Pi AI catalog and supports low, high and max reasoning. Its native adapter preserves reasoning content across tool calls. The owner authorized this switch after Step 5 returned repeated unavailable-endpoint errors. No further model fallback is permitted without an owner instruction.

## Deployment and refreshing

The owner reports auto-deploy enabled on main pushes from **Cloudflare Workers Builds** with the
production Worker `attention-shoppers`, already served at
https://attention-shoppers.igormaka.workers.dev. On 2026-10-12 15:51-15:54 UTC the coding loop
independently verified that public URL from the runner with read-only GETs (no Cloudflare credentials,
admin API or deploy): the site answered HTTP 200, the catalog exposed exactly one product, five
observations were persisted, and a request-triggered initial refresh completed and advanced
`lastRefreshAt`; see
[the production verification evidence](docs/evidence/production-verification-20261012T1554Z.json). The
loop still does not administer the deployment. GitHub stores no CF credentials and has no deployment job.
Cloudflare Cron Triggers run the Worker's scheduled handler about every six hours, and the
SQLite-backed `BoardStore` Durable Object defined in `wrangler.jsonc` persists the last known
observations, vendor refresh state, FX rates and run history.

Follow [the deployment notes and outstanding production checks](docs/DEPLOYMENT.md). Agent-authored code can affect the CF build and production Worker once auto-deploy is enabled; keeping CF API credentials out of Shurik does not remove that authority.

## Develop locally

Node 24.14.0, pinned dependencies:

```sh
npm ci --ignore-scripts
npm run verify          # node:test suite + wrangler deploy --dry-run
npm run check:sources   # live fetch + parse of every tracked vendor page
npm run cron:offline    # full refresh pipeline against recorded fixtures
npm run cron:local      # full refresh pipeline against the live vendor pages
npm run probe:production # read-only GETs against the deployed board (no credentials, no deploy)
npm run dev             # local Worker with a local SQLite Durable Object
```

`probe:production` checks the deployed site from the outside with fixed public GETs only: one catalog
product, no retired row in any board, the retired-URL fallback, freshness and the ranked totals. It never
authenticates or deploys, and it saves a JSON snapshot under `.shurik-local/production/` (or `--out`) so a
later iteration can diff production state; pass `--url http://127.0.0.1:8789` to check a local Worker.

`cron:offline` starts from a clean `.shurik-local/board-offline.json` on every run, so the fixture
pipeline is repeatable and never consumes the live run's schedule. `cron:local` keeps
`.shurik-local/board.json` and honours the same six-hour vendor window as the deployed cron; add
`npm run cron:local -- --fresh` for a manual live run outside that window.

With `npm run dev` running on port 8789, browser QA is self-contained and offline by default:

```sh
npm run qa:browser                            # fixture server + headless Chrome, no network
npm run qa:browser -- http://127.0.0.1:8789   # live: QA a running local Worker
```

The default mode serves `public/` plus fixture-backed API responses from `scripts/qa-server.mjs`, drives
headless Chrome through the desktop and mobile board, and derives expected totals from the API. The live
mode checks the same UI against a Worker you started. The verification build is `wrangler deploy --dry-run`
and does not publish to Cloudflare.

For a reusable Codex workspace, follow the [Codex Cloud setup](docs/CODEX_CLOUD.md).
