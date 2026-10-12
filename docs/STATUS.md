# Project status

Stage: **Ready for Cloudflare handoff.** The Worker implements the real self-updating board; the owner
still has to connect Cloudflare Workers Builds (steps at the end of this file and in docs/DEPLOYMENT.md).
No Cloudflare deployment, credential or remote resource was created by the coding loop.

## What the deployed Worker does

- **Comparison board** (`/`, `/api/board`): ranks delivered offers for Lavazza Crema e Gusto vacuum-packed
  ground coffee by item price + shipping + mandatory fees in ILS, normalized to delivered ILS/kg and to
  the packs a shopper actually buys. Destination (six Israeli locality/postcode areas), target grams and
  variant are selectable; no street address is collected. Ranked offers also show minimum order,
  free-shipping threshold, locality restrictions and offset labels.
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
| CoffeeMan (IL) | Lavazza Crema e Gusto Classico 4 × 250 g ground, SKU 930334 | ₪124.00 | in stock (schema.org microdata) | ₪25 courier; free self-pickup | verified |
| CoffeeMan (IL) | Lavazza Crema e Gusto Classico 8 × 250 g ground, SKU 930335 | ₪240.00 | in stock (schema.org microdata) | courier price not published | unknown (unranked) |
| Pucks (IL) | Lavazza Crema e Gusto Classico 250 g ground, SKU Lav69, GTIN 8000070038769 | ₪30.00 | in stock (JSON-LD) | calculated at checkout | unknown (unranked) |

Live board at 500 g to Tel Aviv: best delivered total ₪91.00 = 2 × ₪33 + ₪25 shipping for CoffeeMan single
packs (₪182.00/kg); the 4-pack is ranked second at ₪149.00. At 1 kg the recorded 4-pack wins at ₪149.00
against ₪157.00 for four single packs, so the best choice changes with the shopper's quantity using only
observed prices. Pucks and the 8-pack stay visible as unranked with plain-language reasons: shipping is
not published before checkout and the 8-pack page lists no courier rate, so neither is treated as free.
FX reference table from the Bank of Israel dated 2026-10-09.

## Verification performed (2026-10-12, all local)

1. `npm ci --ignore-scripts` — clean install from the pinned lockfile, 0 vulnerabilities.
2. `npm run verify` — 43/43 `node:test` cases pass, then `wrangler deploy --dry-run` builds the Worker
   bundle with no Cloudflare credential (55.37 KiB, gzip 15.00 KiB; bindings `BOARD` + `ASSETS` shown).
   Covered acceptance cases include: shipping changes the winner; unknown shipping cannot win;
   stale/out-of-stock/unknown availability stay unranked; variants and multipacks stay separate;
   quantity rounding, minimum order and free-shipping thresholds; missing FX is not zero; destination
   coverage; pickup separated; leases; backoff; allowlist; and the fixture-backed QA server keeping the
   browser harness aligned with the production quote engine.
3. `npm run check:sources` (live) — CoffeeMan (all three listings) and Pucks PASS against the real pages at
   11:48 UTC: prices ₪33 / ₪124 / ₪240 / ₪30, all listed in stock, verified ₪25 courier on the 250 g and
   4-pack pages, unknown shipping on the 8-pack and Pucks. The same adapters fetched the same pages
   during the live local refresh at 11:48 UTC and parsed identically.
4. `npm run cron:offline` — full refresh pipeline against recorded Windows-1255/JSON-LD fixtures, all
   four offers and the FX table persisted.
5. `npm run cron:local` — live pipeline at 11:48 UTC: 5 bounded requests, CoffeeMan saved 3 and Pucks
   saved 1, Bank of Israel rates fetched (USD 3.055), `nextAttemptAt` +6 h.
6. Local Worker runtime (`npx wrangler dev --persist-to ...`, SQLite Durable Object, fresh storage, no
   browser opened): `GET /health` started the initial refresh at 11:49 UTC — 5 bounded requests, both
   vendors saved, 4 observations persisted, `nextAttemptAt` +6 h, FX fetched. A following
   `/cdn-cgi/local/scheduled` made 0 requests and skipped both vendors on backoff. `/api/board` then
   served the ranked board from storage. This is the refresh-while-no-browser-open path.
7. `npm run qa:browser` — headless Chrome (chromedriver 154) QA: **34/34 checks pass offline, exit 0**,
   desktop 1440 px and mobile 390 px, screenshots and JSON report in `.shurik-local/qa/`. The command is
   self-contained: it starts `scripts/qa-server.mjs` on an ephemeral port, which serves `public/` plus the
   read-only API computed from `tests/fixtures/` by the production quote engine, so no Worker, network or
   vendor site is needed. Expectations are derived from the API response (not hard-coded prices). Checks
   include: best delivered total and per-kg math, written stock labels, unknown-shipping reason, pickup
   shown separately, destination and quantity controls, shareable URL updates, keyboard Tab focus with a
   visible 3 px focus outline and Enter activation, Hebrew text isolated with `dir="auto"`, no emoji
   anywhere in the visible text, no horizontal overflow, and 44 px touch targets on mobile. Six more
   checks run against a second fixture server with one clearly labelled QA-only demo offer to verify that
   minimum order, free-shipping threshold, free-shipping-met labelling and a locality delivery restriction
   are rendered, and that the restriction moves the offer to the unknown list for an excluded destination.
   The comparison table is checked against every ranked offer from the API. Live mode
   (`npm run qa:browser -- http://127.0.0.1:8789`) passed **32/32** against a real `wrangler dev` Worker on
   2026-10-12 11:49 UTC (fixture-only checks are skipped in live mode); the run also re-verified the
   no-browser refresh path described in item 6.

This iteration (3-49) fixed three real defects found by the new QA: quantity buttons were dead because
`el()` registered `addEventListener('Click')` instead of `click`; the browser QA harness misread the
W3C element id, never polled page conditions (`waitFor` misuse) and deleted the wrong session path; and
Hebrew vendor/product names were not direction-isolated. Added `npm run check:sources` and
`npm run qa:browser` for repeatable evidence.

This iteration (3-50) made the browser QA repeatable. It previously failed with `ERR_CONNECTION_REFUSED`
on a clean checkout because it assumed a dev server already on port 8789 and compared the DOM to
hard-coded live prices. Now `npm run qa:browser` starts a fixture-backed server derived from the recorded
vendor pages, and every UI expectation comes from the API response. Added `scripts/qa-server.mjs`,
`tests/qa-server.test.js` and live-mode support, standardised `npm run dev` on the documented port 8789,
and corrected the stale scaffold note in docs/ARCHITECTURE.md. The refresh lease is now a synchronous
read-check-write in the Durable Object SQL and memory store, so two runs started in the same tick cannot
both acquire it; a new concurrency test covers that.

The same iteration closed a visible-terms gap: ranked offers now show minimum order, free-shipping
threshold, locality delivery restrictions and mandatory fees, plus their offset labels (for example
"Free shipping threshold met"). The QA-only demo offer described above verifies those rows in a real
browser without pretending it is a vendor.

Finally, the CoffeeMan adapter grew from one listing to three observed listings: the single 250 g pack,
the 4 × 250 g multipack (SKU 930334) and the 8 × 250 g multipack (SKU 930335), each fetched from its own
allowlisted URL with its own price, availability, SKU and shipping terms. The 8-pack page publishes no
courier price, so it stays unranked. This turns the board into a real comparison with a quantity-dependent
winner: 2 single packs deliver for ₪91 at 500 g, while the 4-pack delivers for ₪149 at 1 kg versus ₪157
for four single packs. New minimized Windows-1255 fixtures and parser/worker tests cover both multipacks.

Static evidence snapshots are committed for review: `docs/evidence/source-check-2026-10-12T1148Z.json`
(live adapter observations for all four offers), `docs/evidence/browser-qa-fixtures-2026-10-12T1151Z.json`
(34 offline browser checks), `docs/evidence/browser-qa-live-2026-10-12T1149Z.json` (32 live browser
checks) and `docs/evidence/worker-runtime-status-2026-10-12T1149Z.json` (initial-refresh and backoff run
records from the local Worker). They are historical evidence, not live data.

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
6. After the first deploy, confirm `/health` reports `lastRefreshAt`, the board shows the four observed
   offers (three CoffeeMan listings and Pucks), the comparison table appears for 1 kg, and the 6-hour cron
   trigger is listed. Then verify that one later main push is picked up by Workers Builds.
7. If anything fails, report the Cloudflare error back to the loop; do not paste credentials.

## Loop notes

- Model/provider: opencode-go / deepseek-v4.1-flash at max reasoning (owner-authorized). Iterations
  2-45…2-47 hit provider 429 "Endpoint is unavailable" before any work landed; session 3-48 timed out
  mid vendor research, but its checkpoints are preserved. Iterations 3-49 and 3-50 ran normally.
- Next useful task for the loop: add a third independent vendor adapter only with evidenced Israeli
  delivery (or a public, permitted international listing with documented IL shipping); the board already
  ranks more than one delivered offer from CoffeeMan. Keep `npm run check:sources` green against live
  pages and re-run `npm run qa:browser` after any UI change.
