# Attention shoppers. Happy hunting.

A public online shopping board for delivery in Israel, starting with **Lavazza Crema e Gusto vacuum-packed ground coffee**. The goal is to compare actual availability and item price plus shipping for a selected quantity and destination, with visible source evidence and freshness.

Three Lavazza vacuum-ground products are tracked today — Crema e Gusto, Qualità Oro and Qualità Rossa — across three Israeli vendors, and more products or vendors can be added per adapter. Swiss signage design, meaningful status colors, no emoji typography. Unknown shipping is never silently treated as free.

The board is implemented and self-updating: deterministic vendor adapters observe real product pages, a
pure quote engine ranks delivered ILS totals, and a scheduled Durable Object refresh keeps the data
current without a browser or the coding loop. See [current status](docs/STATUS.md),
[observed sources](docs/SOURCES.md), [design](docs/DESIGN.md) and [architecture](docs/ARCHITECTURE.md).

## Coding loop

The workflow uses [igor-makarov/shurik@v1](https://github.com/igor-makarov/shurik), opencode-go/deepseek-v4.1-flash and max reasoning. The owner chose direct work on main and has added the OPENCODE_API_KEY Actions secret. The first handoff is complete; the main loop will develop the tracker while Cloudflare remains disconnected. Check the Actions page and shurik-control/main for live loop state.

DeepSeek V4.1 Flash is present in Shurik's pinned Pi AI catalog and supports low, high and max reasoning. Its native adapter preserves reasoning content across tool calls. The owner authorized this switch after Step 5 returned repeated unavailable-endpoint errors. No further model fallback is permitted without an owner instruction.

## Deployment and refreshing

The owner will enable auto-deploy on main pushes from **Cloudflare Workers Builds** at the second handoff. GitHub stores no CF credentials and has no deployment job. Once connected, Cloudflare Cron Triggers run the Worker's scheduled handler about every six hours, and the SQLite-backed `BoardStore` Durable Object defined in `wrangler.jsonc` persists the last known observations, vendor refresh state, FX rates and run history.

Follow [the two handoffs](docs/DEPLOYMENT.md). Agent-authored code can affect the CF build and production Worker once auto-deploy is enabled; keeping CF API credentials out of Shurik does not remove that authority.

## Develop locally

Node 24.14.0, pinned dependencies:

```sh
npm ci --ignore-scripts
npm run verify          # node:test suite + wrangler deploy --dry-run
npm run check:sources   # live fetch + parse of every tracked vendor page
npm run cron:offline    # full refresh pipeline against recorded fixtures
npm run cron:local      # full refresh pipeline against the live vendor pages
npm run dev             # local Worker with a local SQLite Durable Object
```

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
