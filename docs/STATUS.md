# Project status

Stage: **Ready for Cloudflare handoff.** The Worker implements the real self-updating board; the owner
still has to connect Cloudflare Workers Builds (steps at the end of this file and in docs/DEPLOYMENT.md).
No Cloudflare deployment, credential or remote resource was created by the coding loop.

## What the deployed Worker does

- **Comparison board** (`/`, `/api/board`): ranks delivered offers for Lavazza Crema e Gusto vacuum-packed
  ground coffee by item price + shipping + mandatory fees in ILS, normalized to delivered ILS/kg and to
  the packs a shopper actually buys. Destination (six Israeli locality/postcode areas), target grams and
  variant are selectable; no street address is collected.
- **Honest unknowns**: unknown shipping, unknown FX, unknown availability, stale observations and
  out-of-stock offers remain visible with plain-language reasons. Missing data never becomes zero and
  never wins. Pickup is shown separately and never competes with delivery.
- **Provenance**: every offer keeps its vendor link, product identity (variant, form, pack grams, pack
  count, SKU/GTIN), availability with its structured-data evidence URL, last successful check, last
  attempt, parser version and shipping certainty.
- **Self-updating runtime**: `wrangler.jsonc` triggers `17 */6 * * *` (about every six hours); the first
  `/health` or `/api/board` after deployment starts one throttled initial refresh. Observations, vendor
  state, FX rates, run history and leases persist in the SQLite-backed `BoardStore` Durable Object.
- **Bounded fetching**: host allowlists per adapter, 12 s timeout, 1.5 MB response cap, max two vendors
  in flight, one attempt per offer per run, 30 min→12 h backoff per vendor. Public routes never fetch a
  visitor-supplied URL and never start unbounded scraping. Responses are cacheable
  (`public, max-age=300, stale-while-revalidate=3600`) and freshness/partial failures are exposed in the
  API and the board footer.
- **No LLM or paid scraper in the public runtime**: only deterministic adapters, official Bank of Israel
  rates and native Cloudflare storage.

## Live observations (recorded evidence)

Retrieved 2026-10-12 with `npm run check:sources` (bounded fetcher + production parsers) and stored under
`.shurik-local/sources/`. Full source record: docs/SOURCES.md.

| Vendor | Listing | Price | Stock | Shipping | Certainty |
| --- | --- | --- | --- | --- | --- |
| CoffeeMan (IL) | Lavazza Crema e Gusto Classico 250 g ground, SKU 930333 | ₪33 (regular ₪36) | in stock (schema.org microdata) | ₪25 courier; free self-pickup | verified |
| Pucks (IL) | Lavazza Crema e Gusto Classico 250 g ground, SKU Lav69, GTIN 8000070038769 | ₪30.00 | in stock (JSON-LD) | calculated at checkout | unknown (unranked) |

Live board at 500 g to Tel Aviv: best delivered total ₪91.00 = 2 × ₪33 + ₪25 shipping for CoffeeMan
(₪182.00/kg); Pucks is visible as unranked with the reason "shipping is not published before checkout,
so it is treated as unknown, not free". FX reference table from the Bank of Israel dated 2026-10-09.

## Verification performed (2026-10-12, all local)

1. `npm ci --ignore-scripts` — clean install from the pinned lockfile, 0 vulnerabilities.
2. `npm run verify` — 37/37 `node:test` cases pass, then `wrangler deploy --dry-run` builds the Worker
   bundle with no Cloudflare credential (54.60 KiB, gzip 14.89 KiB; bindings `BOARD` + `ASSETS` shown).
   Covered acceptance cases include: shipping changes the winner; unknown shipping cannot win;
   stale/out-of-stock/unknown availability stay unranked; variants and multipacks stay separate;
   quantity rounding, minimum order and free-shipping thresholds; missing FX is not zero; destination
   coverage; pickup separated; leases; backoff; allowlist.
3. `npm run check:sources` (live) — CoffeeMan and Pucks both PASS against the real pages at
   11:04 UTC and 11:20 UTC.
4. `npm run cron:offline` — full refresh pipeline against recorded Windows-1255/JSON-LD fixtures, both
   offers and the FX table persisted.
5. `npm run cron:local` — live pipeline: both vendors refreshed, Bank of Israel rates fetched (USD 3.055).
6. Local Worker runtime (`npx wrangler dev --persist-to ...`, SQLite Durable Object, fresh storage, no
   browser opened): triggering only `/cdn-cgi/local/scheduled` at 11:20 UTC produced a scheduled run with
   3 bounded requests, both vendors saved, `nextAttemptAt` +6 h, and persisted `lastRefreshAt`. A second
   scheduled trigger made 0 requests and skipped both vendors on backoff. `/api/board` then served the
   ranked board from storage. This is the refresh-while-no-browser-open path.
7. `npm run qa:browser` — headless Chrome (chromedriver 154) QA: **23/23 checks pass**, exit 0, desktop
   1440 px and mobile 390 px, screenshots and JSON report in `.shurik-local/qa/`. Checks include:
   best delivered total and per-kg math, written stock labels, unknown-shipping reason, destination and
   quantity controls, shareable URL updates, keyboard Tab focus with a visible 3 px focus outline and
   Enter activation, Hebrew text isolated with `dir="auto"`, no emoji anywhere in the visible text, no
   horizontal overflow, and 44 px touch targets on mobile.

This iteration (3-49) fixed three real defects found by the new QA: quantity buttons were dead because
`el()` registered `addEventListener('Click')` instead of `click`; the browser QA harness misread the
W3C element id, never polled page conditions (`waitFor` misuse) and deleted the wrong session path; and
Hebrew vendor/product names were not direction-isolated. Added `npm run check:sources` and
`npm run qa:browser` for repeatable evidence.

Static evidence snapshots are committed for review: `docs/evidence/source-check-2026-10-12T1104Z.json`
(live adapter observations) and `docs/evidence/runtime-and-browser-qa-2026-10-12.json` (scheduled-run
records and the 23 browser QA checks). They are historical evidence, not live data.

## Repository and security checks

- No account IDs, API tokens, checkout sessions or addresses in source, docs or history (secret scan run).
- `wrangler.jsonc` defines the Durable Object class and migration, so no manual CF provisioning is
  needed and no administrative credential lives in GitHub.
- Research blockers recorded honestly in docs/SOURCES.md: rami-levy.co.il returns 403 (anti-bot, not
  bypassed); tivtaam.co.il is a JS-only SPA; amazon.com has no public evidence of delivery to Israel for
  the tracked listing, so it is excluded rather than guessed.

## Remaining owner steps (Cloudflare handoff)

1. Stop the coding loop for the setup window (maintainer action; see docs/DEPLOYMENT.md handoff 1).
2. In Cloudflare: Workers & Pages → Create application → Import a repository → select
   igor-makarov/attention-shoppers-happy-hunting. Worker name `attention-shoppers-happy-hunting`.
3. Production branch `main`; build command `npm ci --ignore-scripts && npm run verify`; deploy command
   `npx --no-install wrangler deploy`; Node 24.x.
4. Disable builds/previews for every other branch, especially `shurik-control/*`.
5. Use the minimum build credential (Workers Scripts:Edit for this Worker only). Never add a CF token to
   GitHub or to the Worker.
6. After the first deploy, confirm `/health` reports `lastRefreshAt`, the board shows the two observed
   offers, and the 6-hour cron trigger is listed. Then verify that one later main push is picked up by
   Workers Builds.
7. If anything fails, report the Cloudflare error back to the loop; do not paste credentials.

## Loop notes

- Model/provider: opencode-go / deepseek-v4.1-flash at max reasoning (owner-authorized). Iterations
  2-45…2-47 hit provider 429 "Endpoint is unavailable" before any work landed; session 3-48 timed out
  mid vendor research, but its checkpoints are preserved. This iteration ran normally.
- Next useful task for the loop: add a third vendor adapter only with evidenced Israeli delivery, keep
  `npm run check:sources` green against live pages, and re-run `npm run qa:browser` after UI changes.
