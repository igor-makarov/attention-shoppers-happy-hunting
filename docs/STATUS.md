# Project status

Stage: **Ready for Cloudflare handoff.** The Worker implements the real self-updating board with three
independent vendor adapters and three tracked products; the owner still has to connect Cloudflare Workers
Builds (steps at the end of this file and in docs/DEPLOYMENT.md). No Cloudflare deployment, credential or
remote resource was created by the coding loop.

## What the deployed Worker does

- **Comparison board** (`/`, `/api/board`): ranks delivered offers for Lavazza ground coffee in a vacuum
  brick by item price + shipping + mandatory fees in ILS, normalized to delivered ILS/kg and to the packs
  a shopper actually buys. Three products are tracked today: **Crema e Gusto**, **Qualità Oro** and
  **Qualità Rossa**, with a product selector; destination (six Israeli locality/postcode areas, including
  "Elsewhere in Israel"), target grams and blend variant are selectable; no street address is collected.
  Ranked offers also show minimum order, free-shipping threshold, locality restrictions, offset labels and
  any additional published shipping service (for example Coffee4U's ₪15 delivery to a pickup point).
- **Products and variants stay separate**: Classico, Forte, Ricco, Risveglio and decaf are filtered
  independently, and a listing whose page does not state the blend variant (Coffee4U; every Qualità Oro
  and Qualità Rossa listing) is stored as *Variant not stated*. The crema board reports how many offers
  the selected variant excluded, so they are discoverable instead of merged.
- **Honest unknowns**: unknown shipping, unknown FX, unknown availability, stale observations and
  out-of-stock offers remain visible with plain-language reasons. Missing data never becomes zero and
  never wins. Pickup is shown separately and never competes with delivery. One real out-of-stock listing
  is tracked today (Pucks Qualità Rossa SKU Lav35), so an observed out-of-stock page is part of the
  normal board data instead of only a test fixture.
- **Provenance**: every offer keeps its vendor link, product identity (variant, form, pack grams, pack
  count, SKU/GTIN), availability with its structured-data evidence URL, last successful check, last
  attempt, parser version and shipping certainty.
- **Self-updating runtime**: `wrangler.jsonc` triggers `17 */6 * * *` (about every six hours); the first
  `/health` or `/api/board` after deployment starts one throttled initial refresh. Observations, vendor
  state, FX rates, run history and leases persist in the SQLite-backed `BoardStore` Durable Object. The
  board API and footer report a board-level fresh/stale freshness field, and the footer warns in plain
  language when no scheduled refresh has completed for more than eight hours, so a broken cron cannot
  silently serve old numbers.
- **Bounded fetching**: host allowlists per adapter, 12 s timeout, 1.5 MB response cap, max two vendors
  in flight, one attempt per offer per run, published crawl delays honoured (`Crawl-delay: 7` on
  CoffeeMan and Coffee4U), 30 min→12 h backoff per vendor. Public routes never fetch a visitor-supplied
  URL and never start unbounded scraping. Responses are cacheable
  (`public, max-age=300, stale-while-revalidate=3600`) and freshness/partial failures are exposed in the
  API and the board footer.
- **No LLM or paid scraper in the public runtime**: only deterministic adapters, official Bank of Israel
  rates and native Cloudflare storage.

## Live observations (recorded evidence)

Retrieved 2026-10-12 13:32 UTC with `npm run check:sources` (bounded fetcher + production parsers) and
stored under `.shurik-local/sources/`; review copy in
`docs/evidence/source-check-2026-10-12T1332Z.json`. Full source record: docs/SOURCES.md.

| Vendor | Listing | Price | Stock | Shipping | Certainty |
| --- | --- | --- | --- | --- | --- |
| CoffeeMan (IL) | Crema e Gusto Classico 250 g ground, SKU 930333 | ₪33 (regular ₪36) | in stock (schema.org microdata) | ₪25 courier; free self-pickup | verified |
| CoffeeMan (IL) | Crema e Gusto Classico 4 × 250 g ground, SKU 930334 | ₪124.00 | in stock | ₪25 courier; free self-pickup | verified |
| CoffeeMan (IL) | Crema e Gusto Classico 8 × 250 g ground, SKU 930335 | ₪240.00 | in stock | courier price not published | unknown (unranked) |
| CoffeeMan (IL) | Qualità Oro 250 g ground, SKU 930339 | ₪37.00 | in stock | ₪25 courier; free self-pickup | verified |
| CoffeeMan (IL) | Qualità Oro 4 × 250 g ground, SKU 930340 | ₪125.00 | in stock | ₪25 courier; free self-pickup | verified |
| CoffeeMan (IL) | Qualità Oro 8 × 250 g ground, SKU 930341 | ₪239.00 | in stock | courier price not published | unknown (unranked) |
| CoffeeMan (IL) | Qualità Rossa 250 g ground, SKU 930336 | ₪33.00 | in stock | ₪25 courier; free self-pickup | verified |
| Pucks (IL) | Crema e Gusto Classico 250 g ground, SKU Lav69, GTIN 8000070038769 | ₪30.00 | in stock (JSON-LD) | calculated at checkout | unknown (unranked) |
| Pucks (IL) | Qualità Oro 250 g ground, SKU lav11, GTIN 8000070019911 | ₪35.00 | in stock (JSON-LD) | calculated at checkout | unknown (unranked) |
| Pucks (IL) | Qualità Rossa 250 g ground, SKU Lav80, GTIN 8000070035980 | ₪30.00 | in stock (JSON-LD) | calculated at checkout | unknown (unranked) |
| Pucks (IL) | Qualità Rossa 250 g ground, SKU Lav35, GTIN 8000070035935 | ₪35.00 | **out of stock** (JSON-LD) | calculated at checkout | unknown (visible, never confirmed available) |
| Coffee4U (IL) | Crema e gusto 250 g ground, SKU 2010561, variant not stated | ₪38.00 | in stock (schema.org microdata) | ₪30 door-to-door courier; ₪15 pickup-point delivery; free self-pickup | verified |

Observed board results on the local Worker after the fresh scheduled refresh (13:38–13:39 UTC):

- Crema e Gusto, 500 g to Tel Aviv: best delivered total ₪91.00 = 2 × ₪33 + ₪25 shipping for CoffeeMan
  single packs (₪182.00/kg); the 4-pack is ranked second at ₪149.00. At 1 kg the 4-pack wins at ₪149.00
  against ₪157.00 for four single packs, so the best choice changes with the shopper's quantity using
  only observed prices. Pucks and the 8-pack stay visible as unranked with plain-language reasons:
  shipping is not published before checkout, and the 8-pack page lists no courier rate, so neither is
  treated as free.
- Qualità Oro, 500 g to Tel Aviv: best ₪99.00 = 2 × ₪37 + ₪25 (₪198.00/kg); the 4-pack is second at
  ₪150.00. At 1 kg the 4-pack wins at ₪150.00 against ₪173.00 for four single packs. The Pucks ₪35 offer
  and the 8-pack stay unranked because their shipping is unknown.
- Qualità Rossa, 500 g to Tel Aviv: best ₪91.00 = 2 × ₪33 + ₪25 (₪182.00/kg, one ranked offer today).
  The cheaper Pucks ₪30 in-stock item is visible but unranked because shipping is only calculated at
  checkout, and the Pucks SKU Lav35 listing is labelled **Out of stock (observed)** and kept out of the
  ranking.
- Selecting *Variant not stated* on the crema board ranks the Coffee4U offer at ₪106.00 for 500 g
  (₪212.00/kg) with the ₪15 pickup-point delivery shown as an alternative service; it is never merged
  into the Classico ranking.
- FX: the 13:36–13:39 Worker refreshes fetched the official Bank of Israel table dated 2026-10-12
  (asOf 12:23:04Z); an earlier same-day refresh at 12:59 UTC saw the same table with USD 3.078, and the
  12:57 UTC adapter check does not fetch FX.

## Verification performed (2026-10-12, all local)

1. `npm ci --ignore-scripts` — clean install from the pinned lockfile, 0 vulnerabilities.
2. `npm run verify` — **71/71** `node:test` cases pass, then `wrangler deploy --dry-run` builds the
   Worker bundle with no Cloudflare credential (71.82 KiB, gzip 18.38 KiB; bindings `BOARD` + `ASSETS`).
   Covered acceptance cases include: shipping changes the winner; unknown shipping cannot win;
   stale/out-of-stock/unknown availability stay unranked; variants and multipacks stay separate;
   quantity rounding, minimum order and free-shipping thresholds; missing FX is not zero; destination
   coverage; pickup separated; shipping alternatives are converted but never replace the ranked amount;
   the variant filter reports excluded offers; the second and third tracked products keep their own
   boards, defaults and offers (including the third product's observed out-of-stock listing); an unknown
   variant id falls back to the product default in both the Worker and the offline QA server
   (object-prototype keys are never treated as variant ids); a board whose scheduled refresh stopped is
   reported as stale (and a fresh one is not); leases; backoff; allowlist; crawl-delay pacing; and the
   fixture-backed QA server keeping the browser harness aligned with the production quote engine.
3. `npm run check:sources` (live) — CoffeeMan (seven listings), Pucks (four) and Coffee4U (one) PASS
   against the real pages at 13:32 UTC: prices ₪33 / ₪124 / ₪240 / ₪37 / ₪125 / ₪239 / ₪33 /
   ₪30 / ₪35 / ₪30 / ₪35 / ₪38. Eleven listings were observed in stock; the Pucks Qualità Rossa
   SKU Lav35 page was observed **out of stock** and is labelled that way. Verified ₪25 courier shipping
   on five CoffeeMan pages, ₪30 door-to-door plus a ₪15 pickup-point alternative on the Coffee4U page,
   and unknown shipping on the two 8-pack pages and all four Pucks pages. Review copy:
   `docs/evidence/source-check-2026-10-12T1332Z.json`. The Pucks unknown-shipping label had already been
   reconfirmed on the same day against the public terms page (delivery fees "according to rates set by
   Pucks from time to time", no amount or free threshold published):
   `docs/evidence/vendor-research-2026-10-12T1305Z-pucks-shipping.json`.
4. `npm run cron:offline` — full refresh pipeline against recorded Windows-1255/JSON-LD fixtures:
   **13 bounded requests**, 12 offers persisted (CoffeeMan 7, Pucks 4, Coffee4U 1) and the FX table.
   `tests/simulate-cron.test.js` runs it twice in a temporary directory with identical results and
   asserts 13 requests, no backoff skips, 12 fresh offers and an FX reference rate, so the repeatability
   cannot regress. Offline runs use their own state file (`.shurik-local/board-offline.json`, reset per
   run) and never consume the live schedule.
5. Local Worker runtime (`npx wrangler dev --port 8789`, fresh SQLite Durable Object, no browser
   opened): `GET /health` started the initial refresh; it completed at 13:36:50 UTC — **13 bounded
   requests**, all three vendors saved (CoffeeMan 7, Pucks 4, Coffee4U 1), **12 observations persisted**,
   the Bank of Israel table fetched, `nextAttemptAt` +6 h. `/api/board` then served all three product
   boards (₪91.00 Crema e Gusto 500 g, ₪99.00 Qualità Oro 500 g, ₪91.00 Qualità Rossa 500 g) with the
   Pucks unknown-shipping and out-of-stock offers visible and unranked. This is the
   refresh-while-no-browser-open path. Evidence:
   `docs/evidence/worker-runtime-status-2026-10-12T1337Z.json`.
6. Scheduled handler against a second fresh Durable Object store, triggered only through the documented
   local endpoint (`curl http://127.0.0.1:8789/cdn-cgi/local/scheduled`, no browser, no `/health`): the
   run recorded trigger `scheduled`, started 13:38:52 UTC, made **13 bounded requests**, persisted 12
   observations and the Bank of Israel table, and set `nextAttemptAt` +6 h. A second trigger on the
   populated store correctly made **0 requests** because every vendor was inside its six-hour window,
   and both runs are in the persisted run history. The curl call itself timed out client-side while the
   ~45 s run was still executing; `/api/status` after completion shows the persisted result. Evidence:
   `docs/evidence/worker-runtime-status-2026-10-12T1339Z-scheduled.json`.
7. `npm run qa:browser` — headless Chrome (chromedriver 154) QA, **51/51 checks pass offline, exit 0**,
   desktop 1440 px and mobile 390 px, screenshots and JSON report in `.shurik-local/qa/`. The command is
   self-contained: it starts `scripts/qa-server.mjs` on an ephemeral port, which serves `public/` plus
   the read-only API computed from `tests/fixtures/` by the production quote engine, so no Worker,
   network or vendor site is needed. Expectations are derived from the API response (not hard-coded
   prices). Checks include: best delivered total and per-kg math, written stock labels, unknown-shipping
   reason, pickup shown separately, destination, quantity, product and variant controls, shareable URL
   updates, keyboard Tab focus with a visible 3 px focus outline and Enter activation, Hebrew text
   isolated with `dir="auto"`, no emoji anywhere in the visible text, no horizontal overflow, 44 px
   touch targets on mobile, and a footer that reports the last completed refresh instead of a static
   "waiting" message. Product checks cover the selector listing all three products, Qualità Oro's own
   default variant, its own ranked best (₪99.00 for 500 g), Qualità Rossa's own best (₪91.00), the
   third product's missing-shipping/out-of-stock offer staying visible with its written label, and the
   shareable URLs. Seven extra checks run against a second fixture server with one clearly labelled
   QA-only demo offer to verify minimum order, free-shipping threshold, free-shipping-met labelling and
   a locality delivery restriction, plus one check that a board whose scheduled refresh stopped for
   30 hours is labelled in the footer.
8. `npm run qa:browser -- http://127.0.0.1:8789` — live mode passed **49/49** against the local
   `wrangler dev` Worker at 13:37 UTC, including the third-product switch, ranking, URL and stock-label
   checks against the real persisted observations (the two fixture-only checks are skipped in live
   mode). Report: `docs/evidence/browser-qa-live-2026-10-12T1337Z.json`.

## Iteration notes

Iteration 3-49 fixed three real defects found by the browser QA: quantity buttons were dead because
`el()` registered `addEventListener('Click')` instead of `click`; the harness misread the W3C element id;
and Hebrew vendor/product names were not direction-isolated. It added `npm run check:sources` and
`npm run qa:browser`.

Iteration 3-50 made the browser QA repeatable offline, added live-mode support, standardised `npm run dev`
on port 8789, made the refresh lease atomic (synchronous read-check-write), and added the ranked-terms
rows: minimum order, free-shipping threshold, locality restrictions, mandatory fees and offset labels.
The CoffeeMan adapter grew from one listing to three observed listings (single, 4-pack, 8-pack).

Iteration 3-51 added the third independent Israeli vendor adapter, **Coffee4U** (`src/vendors/coffee4u.js`,
parser `coffee4u/1`): a Windows-1255 page with schema.org price/currency/availability/SKU microdata and a
per-product delivery list publishing ₪30 door-to-door courier, ₪15 pickup-point delivery and free
self-pickup. The parser refuses the page if the courier rate disappears instead of guessing zero, keeps
the cheap pickup-point service as a labelled alternative, and records the unstated blend variant as
*Variant not stated* so it is never merged into Classico. The quote engine now passes converted shipping
alternatives through to the UI and reports `counts.excludedByVariant`, and the board shows a plain-language
notice when offers for another variant were withheld. The same iteration added board-level freshness:
`refreshFreshness()` reports `stale` when the last completed refresh is missing or older than eight hours,
`/api/board` and `/api/status` expose it, and the site footer warns in plain language instead of silently
serving old numbers.

Iteration 3-52 added the **second tracked product, Lavazza Qualità Oro**, through the same adapters:
`src/catalog.js` now holds a data-driven product list with per-product line patterns and default
variants, `classifyListing()` refuses listings from another line, `/api/catalog` exposes products with
their variants, and the board gained a product selector. CoffeeMan added three Qualità Oro offers
(250 g SKU 930339, 4 × 250 g SKU 930340, 8 × 250 g SKU 930341) and Pucks added lav11
(GTIN 8000070019911); parser versions are `coffeeman/2` and `pucks/2`. The adapters declare the vendors'
published `Crawl-delay: 7`, which the bounded fetcher now honours, and fixture routing was centralised in
`tests/fixtures/vendor-fixtures.mjs` so the offline tools and tests cannot drift from the tracked offers.
The session timed out after committing its evidence; STATUS and SOURCES were updated in 3-53.

Iteration 3-53 fixed a reproducibility defect in the local cron simulation: `cron:offline` and
`cron:local` shared one state file, so a fixture run left a six-hour `nextAttemptAt` that silently
skipped the next live run, and a second offline run was skipped too. Offline runs now use a separate
state file that is reset per run (repeatable), live runs keep the persisted schedule, `--fresh` resets a
live run explicitly, and `tests/simulate-cron.test.js` locks the behaviour in. It then re-ran the full
local verification chain recorded above, added the Qualità Oro source records to docs/SOURCES.md, copied
the new evidence snapshots into `docs/evidence/`, and refreshed this file.

The same iteration hardened variant handling in the board API: a variant id that is not a tracked
variant at all (a typo or an old shared link, including an object-prototype key) now falls back to the
product's default variant like an unknown product or destination, instead of returning an empty board.
The resolution lives in `resolveVariantId()` (`src/catalog.js`) and is shared by the Worker and the
offline QA server so the harness cannot drift from production. Cross-product variant ids stay strict
(a Classico request against Qualità Oro matches no offer, which the tests pin down). The scheduled
handler was also exercised end-to-end through `wrangler dev`'s documented local trigger endpoint
against a fresh Durable Object store: one full run (10 requests, 9 observations, FX, +6 h) and one
correct zero-request backoff skip, with both runs in the persisted history.

Iteration 3-54 added the **third tracked product, Lavazza Qualità Rossa**, after a bounded vendor
research pass found the line at both existing Israeli vendors: CoffeeMan ground-coffee category and
Pucks' Lavazza ground category. The adapters grew by three offers (`coffeeman/3`, `pucks/3`):
CoffeeMan 250 g SKU 930336 at ₪33 with a published ₪25 courier rate, Pucks SKU Lav80 at ₪30 with
shipping calculated at checkout, and a second Pucks listing, SKU Lav35 at ₪35, which the live page
reported **OutOfStock** — a real out-of-stock observation that now stays visible and unranked in the
board data. Fixtures are minimized byte-faithful excerpts of the live pages
(`coffeeman-qualita-rossa-product.windows-1255.html`, `pucks-qualita-rossa-product.html`,
`pucks-qualita-rossa-outofstock-product.html`). Tests grew to 71 with the new product, stock and
strict-cross-line cases, the browser QA grew to 51/51 offline with a third-product check, and the full
live chain (source check, cron fixture run, local Worker initial refresh, scheduled trigger, live
browser QA) was re-run and recorded above. The same iteration recorded the rejected fourth-vendor
candidates (see docs/SOURCES.md), including Roastmarket, which publishes only Spain/Balearic delivery.

## Committed evidence snapshots

Historical evidence snapshots are committed for review and are not live data:

- `docs/evidence/source-check-2026-10-12T1332Z.json` — live adapter observations for all twelve offers
  from CoffeeMan, Pucks and Coffee4U (13:32 UTC), the evidence behind the table above.
- `docs/evidence/browser-qa-fixtures-2026-10-12T1335Z.json` — 51 offline browser checks, including the
  three-product selector, the Qualità Rossa board, the third product's out-of-stock label, the
  unstated-variant ranking, the untracked-variant URL fallback, the labelled shipping alternative and
  the stale-refresh footer warning.
- `docs/evidence/browser-qa-live-2026-10-12T1337Z.json` — 49 live browser checks against a local
  `wrangler dev` Worker with real observations.
- `docs/evidence/worker-runtime-status-2026-10-12T1337Z.json` — `/health`, `/api/status`, `/api/catalog`
  and all three product boards from the local Worker after its no-browser initial refresh (three
  vendors, 12 observations, fresh, `nextAttemptAt` +6 h).
- `docs/evidence/worker-runtime-status-2026-10-12T1339Z-scheduled.json` — the scheduled-handler path
  triggered through `curl /cdn-cgi/local/scheduled` against a second fresh Durable Object store: one
  13-request run, 12 observations persisted, plus `/api/status` and all three product boards.
- `docs/evidence/vendor-research-2026-10-12T1305Z-pucks-shipping.json` — public-product-page, cart and
  terms-page quotes supporting the Pucks unknown-shipping label instead of a guessed amount.
- Earlier snapshots from iterations 3-49 to 3-53 remain in `docs/evidence/` as history, including the
  12:57 UTC source check for nine offers, the 13:01/13:09 UTC QA pairs, and the two 13:xx runtime
  snapshots.

## Repository and security checks

- No account IDs, API tokens, checkout sessions or addresses in source, docs or history (secret scan run).
- `wrangler.jsonc` defines the Durable Object class and migration, so no manual CF provisioning is
  needed and no administrative credential lives in GitHub.
- Research blockers recorded honestly in docs/SOURCES.md: rami-levy.co.il returns 403 (anti-bot, not
  bypassed); shufersal.co.il serves an empty S3 object instead of robots rules; tivtaam.co.il and
  espresso-club.co.il are JS-only SPA shells; super-pharm.co.il serves a bot-detection challenge;
  amazon.com has no public evidence of delivery to Israel for the tracked listing; roastmarket.com
  publishes Spain/Balearic delivery only; freshmarket.co.il exposes no server-rendered product pages.
- The CoffeeMan and Coffee4U adapters honour `Crawl-delay: 7`; Pucks publishes no delay. Each adapter
  fetches one fixed allowlisted product URL per six-hour run; no checkout, cart or account endpoint is
  touched.

## Remaining owner steps (Cloudflare handoff)

1. Stop the coding loop for the setup window (maintainer action; see docs/DEPLOYMENT.md handoff 1).
2. In Cloudflare: Workers & Pages → Create application → Import a repository → select
   igor-makarov/attention-shoppers-happy-hunting. Worker name `attention-shoppers-happy-hunting`.
3. Production branch `main`; build command `npm ci --ignore-scripts && npm run verify`; deploy command
   `npx --no-install wrangler deploy`; Node 24.x.
4. Disable builds/previews for every other branch, especially `shurik-control/*`.
5. Use the minimum build credential (Workers Scripts:Edit for this Worker only). Never add a CF token to
   GitHub or to the Worker.
6. After the first deploy, confirm `/health` reports `lastRefreshAt`, the board shows the twelve observed
   offers across Crema e Gusto, Qualità Oro and Qualità Rossa, the product selector lists all three, the
   comparison table appears for 1 kg, the variant control lists Classico and "Variant not stated", the
   Pucks SKU Lav35 offer is labelled Out of stock, and the 6-hour cron trigger is listed. Then verify
   that one later main push is picked up by Workers Builds.
7. If anything fails, report the Cloudflare error back to the loop; do not paste credentials.

## Loop notes

- Model/provider: opencode-go / deepseek-v4.1-flash at max reasoning (owner-authorized). Iterations
  2-45…2-47 hit provider 429 "Endpoint is unavailable" before any work landed; sessions 3-48, 3-51 and
  3-52 timed out, but their checkpoints are preserved and 3-52's second product landed. Iterations 3-49,
  3-50, 3-51, 3-53 and 3-54 ran normally.
- Next useful task for the loop: a fourth vendor adapter only with evidenced Israeli delivery (a vendor
  that publishes delivery rates next to the product) — the 2026-10-12 probes found no viable new one,
  so candidate domains and their blockers are recorded in docs/SOURCES.md instead of guessed. Another
  good increment is a fourth tracked product with listings at two or more vendors, or resolving a
  Pucks/Coffee4U shipping publication if either vendor starts publishing rates. Keep
  `npm run check:sources` green against live pages and re-run both `npm run qa:browser` modes after any
  UI change.
