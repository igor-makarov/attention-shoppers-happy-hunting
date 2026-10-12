# Project status

Stage: **Ready for Cloudflare handoff.** The Worker implements the real self-updating board with three
independent vendor adapters and two tracked products; the owner still has to connect Cloudflare Workers
Builds (steps at the end of this file and in docs/DEPLOYMENT.md). No Cloudflare deployment, credential or
remote resource was created by the coding loop.

## What the deployed Worker does

- **Comparison board** (`/`, `/api/board`): ranks delivered offers for Lavazza ground coffee in a vacuum
  brick by item price + shipping + mandatory fees in ILS, normalized to delivered ILS/kg and to the packs
  a shopper actually buys. Two products are tracked today, **Crema e Gusto** and **Qualità Oro**, with a
  product selector; destination (six Israeli locality/postcode areas, including "Elsewhere in Israel"),
  target grams and blend variant are selectable; no street address is collected. Ranked offers also show
  minimum order, free-shipping threshold, locality restrictions, offset labels and any additional
  published shipping service (for example Coffee4U's ₪15 delivery to a pickup point).
- **Products and variants stay separate**: Classico, Forte, Ricco, Risveglio and decaf are filtered
  independently, and a listing whose page does not state the blend variant (Coffee4U; all Qualità Oro
  listings, whose line publishes no variant) is stored as *Variant not stated*. The crema board reports
  how many offers the selected variant excluded, so they are discoverable instead of merged.
- **Honest unknowns**: unknown shipping, unknown FX, unknown availability, stale observations and
  out-of-stock offers remain visible with plain-language reasons. Missing data never becomes zero and
  never wins. Pickup is shown separately and never competes with delivery.
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

Retrieved 2026-10-12 12:57 UTC with `npm run check:sources` (bounded fetcher + production parsers) and
stored under `.shurik-local/sources/`; review copy in
`docs/evidence/source-check-2026-10-12T1257Z.json`. Full source record: docs/SOURCES.md.

| Vendor | Listing | Price | Stock | Shipping | Certainty |
| --- | --- | --- | --- | --- | --- |
| CoffeeMan (IL) | Crema e Gusto Classico 250 g ground, SKU 930333 | ₪33 (regular ₪36) | in stock (schema.org microdata) | ₪25 courier; free self-pickup | verified |
| CoffeeMan (IL) | Crema e Gusto Classico 4 × 250 g ground, SKU 930334 | ₪124.00 | in stock | ₪25 courier; free self-pickup | verified |
| CoffeeMan (IL) | Crema e Gusto Classico 8 × 250 g ground, SKU 930335 | ₪240.00 | in stock | courier price not published | unknown (unranked) |
| CoffeeMan (IL) | Qualità Oro 250 g ground, SKU 930339 | ₪37.00 | in stock | ₪25 courier; free self-pickup | verified |
| CoffeeMan (IL) | Qualità Oro 4 × 250 g ground, SKU 930340 | ₪125.00 | in stock | ₪25 courier; free self-pickup | verified |
| CoffeeMan (IL) | Qualità Oro 8 × 250 g ground, SKU 930341 | ₪239.00 | in stock | courier price not published | unknown (unranked) |
| Pucks (IL) | Crema e Gusto Classico 250 g ground, SKU Lav69, GTIN 8000070038769 | ₪30.00 | in stock (JSON-LD) | calculated at checkout | unknown (unranked) |
| Pucks (IL) | Qualità Oro 250 g ground, SKU lav11, GTIN 8000070019911 | ₪35.00 | in stock (JSON-LD) | calculated at checkout | unknown (unranked) |
| Coffee4U (IL) | Crema e gusto 250 g ground, SKU 2010561, variant not stated | ₪38.00 | in stock (schema.org microdata) | ₪30 door-to-door courier; ₪15 pickup-point delivery; free self-pickup | verified |

Observed board results (local Worker, 13:01 UTC):

- Crema e Gusto, 500 g to Tel Aviv: best delivered total ₪91.00 = 2 × ₪33 + ₪25 shipping for CoffeeMan
  single packs (₪182.00/kg); the 4-pack is ranked second at ₪149.00. At 1 kg the 4-pack wins at ₪149.00
  against ₪157.00 for four single packs, so the best choice changes with the shopper's quantity using
  only observed prices. Pucks and the 8-pack stay visible as unranked with plain-language reasons:
  shipping is not published before checkout, and the 8-pack page lists no courier rate, so neither is
  treated as free.
- Qualità Oro, 500 g to Tel Aviv: best ₪99.00 = 2 × ₪37 + ₪25 (₪198.00/kg); the 4-pack is second at
  ₪150.00. At 1 kg the 4-pack wins at ₪150.00 against ₪173.00 for four single packs. The Pucks ₪35 offer
  and the 8-pack stay unranked because their shipping is unknown.
- Selecting *Variant not stated* on the crema board ranks the Coffee4U offer at ₪106.00 for 500 g
  (₪212.00/kg) with the ₪15 pickup-point delivery shown as an alternative service; it is never merged
  into the Classico ranking.
- FX: the 12:57 live check fetched the official Bank of Israel table dated 2026-10-12 (USD 3.078);
  earlier checks on 2026-10-12 saw the 2026-10-09 table (USD 3.055).

## Verification performed (2026-10-12, all local)

1. `npm ci --ignore-scripts` — clean install from the pinned lockfile, 0 vulnerabilities.
2. `npm run verify` — **66/66** `node:test` cases pass, then `wrangler deploy --dry-run` builds the
   Worker bundle with no Cloudflare credential (70.12 KiB, gzip 18.05 KiB; bindings `BOARD` + `ASSETS`).
   Covered acceptance cases include: shipping changes the winner; unknown shipping cannot win;
   stale/out-of-stock/unknown availability stay unranked; variants and multipacks stay separate;
   quantity rounding, minimum order and free-shipping thresholds; missing FX is not zero; destination
   coverage; pickup separated; shipping alternatives are converted but never replace the ranked amount;
   the variant filter reports excluded offers; the second tracked product keeps its own board and
   default variant; an unknown variant id falls back to the product default in both the Worker and the
   offline QA server (object-prototype keys are never treated as variant ids); a board whose scheduled
   refresh stopped is reported as stale (and a fresh one is not); leases; backoff; allowlist;
   crawl-delay pacing; and the fixture-backed QA server keeping the browser harness aligned with the
   production quote engine.
3. `npm run check:sources` (live) — CoffeeMan (six listings), Pucks (two) and Coffee4U (one) PASS
   against the real pages at 12:57 UTC: prices ₪33 / ₪124 / ₪240 / ₪37 / ₪125 / ₪239 / ₪30 / ₪35 / ₪38,
   all listed in stock, verified ₪25 courier on four CoffeeMan pages, verified ₪30 door-to-door plus a
   ₪15 pickup-point alternative on the Coffee4U page, unknown shipping on both 8-packs and both Pucks
   pages. The same adapters fetched the same pages during the live local refresh at 12:59 UTC and
   parsed identically. The Pucks unknown-shipping label was reconfirmed the same day against the
   public terms page (delivery fees "according to rates set by Pucks from time to time", no amount or
   free threshold published): `docs/evidence/vendor-research-2026-10-12T1305Z-pucks-shipping.json`.
4. `npm run cron:offline` — full refresh pipeline against recorded Windows-1255/JSON-LD fixtures: 10
   bounded requests, 9 offers persisted (CoffeeMan 6, Pucks 2, Coffee4U 1) and the FX table. The command
   was run twice in a row with identical results; `tests/simulate-cron.test.js` now runs it twice in a
   temporary directory and asserts 10 requests, no backoff skips, 9 fresh offers and an FX reference
   rate, so the repeatability cannot regress. Offline runs use their own state file
   (`.shurik-local/board-offline.json`, reset per run) and never consume the live schedule.
5. `npm run cron:local -- --fresh` — live pipeline at 12:59:06→12:59:44 UTC: 10 bounded requests,
   CoffeeMan saved 6, Pucks 2, Coffee4U 1, Bank of Israel rates fetched (table dated 2026-10-12),
   `nextAttemptAt` +6 h, 0 failures.
6. Local Worker runtime (`npx wrangler dev --port 8789`, SQLite Durable Object, fresh storage, no
   browser opened): `GET /health` started the initial refresh; it completed at 13:00:55 UTC — 10
   bounded requests, all three vendors saved, 9 observations persisted, `nextAttemptAt` +6 h, FX
   fetched. `/api/board` then served both ranked product boards and the unranked offers described
   above. This is the refresh-while-no-browser-open path. Evidence:
   `docs/evidence/worker-runtime-status-2026-10-12T1301Z.json`.
7. Scheduled handler against a second fresh Durable Object store, triggered only through the documented
   local endpoint (`curl http://127.0.0.1:8789/cdn-cgi/local/scheduled`, no browser, no `/health`):
   the run recorded trigger `scheduled`, started 13:13:28 UTC, made 10 bounded requests, persisted 9
   observations and the Bank of Israel table, and set `nextAttemptAt` +6 h. A second trigger 58 s later
   correctly made 0 requests because every vendor was inside its six-hour window, and both runs are in
   the persisted run history. The curl call itself timed out client-side on the first trigger while the
   ~40 s run was still executing; `/api/status` after completion shows the persisted result. Evidence:
   `docs/evidence/worker-runtime-status-2026-10-12T1315Z.json`.
8. `npm run qa:browser` — headless Chrome (chromedriver 154) QA, **47/47 checks pass offline, exit 0**,
   desktop 1440 px and mobile 390 px, screenshots and JSON report in `.shurik-local/qa/`. The command is
   self-contained: it starts `scripts/qa-server.mjs` on an ephemeral port, which serves `public/` plus
   the read-only API computed from `tests/fixtures/` by the production quote engine, so no Worker,
   network or vendor site is needed. Expectations are derived from the API response (not hard-coded
   prices). Checks include: best delivered total and per-kg math, written stock labels, unknown-shipping
   reason, pickup shown separately, destination, quantity, product and variant controls, shareable URL
   updates, keyboard Tab focus with a visible 3 px focus outline and Enter activation, Hebrew text
   isolated with `dir="auto"`, no emoji anywhere in the visible text, no horizontal overflow, 44 px
   touch targets on mobile, and a footer that reports the last completed refresh instead of a static
   "waiting" message. A shared URL with an untracked variant id is checked to fall back to the product
   default and still rank the default offer. Product checks cover the selector listing both products,
   Qualità Oro's own default variant, its own ranked best (₪99.00 for 500 g) and the shareable URL.
   Seven extra checks run against a second fixture server with one clearly labelled QA-only demo offer
   to verify minimum order, free-shipping threshold, free-shipping-met labelling and a locality
   delivery restriction, plus one check that a board whose scheduled refresh stopped for 30 hours is
   labelled in the footer.
9. `npm run qa:browser -- http://127.0.0.1:8789` — live mode passed **45/45** against the local
   `wrangler dev` Worker at 13:11 UTC (earlier runs at 13:01 and 13:09 UTC passed 44/44; fixture-only
   checks are skipped in live mode, and the new variant-fallback check runs in both modes); the run
   also re-verified the no-browser refresh path described in item 6. One earlier browser QA attempt
   (3-51) aborted on a transient WebDriver timeout before any UI check ran; a manual WebDriver session
   then confirmed the page renders (`boardState=ready`) and the repeat runs passed cleanly.

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

## Committed evidence snapshots

Historical evidence snapshots are committed for review and are not live data:

- `docs/evidence/source-check-2026-10-12T1257Z.json` — live adapter observations for all nine offers
  from CoffeeMan, Pucks and Coffee4U (12:57 UTC), the evidence behind the table above.
- `docs/evidence/browser-qa-fixtures-2026-10-12T1312Z.json` — 47 offline browser checks, including the
  product selector, the Qualità Oro board, the unstated-variant ranking, the untracked-variant URL
  fallback, the labelled shipping alternative and the stale-refresh footer warning.
- `docs/evidence/browser-qa-live-2026-10-12T1311Z.json` — 45 live browser checks against a local
  `wrangler dev` Worker with real observations, re-run after the variant fallback change.
- `docs/evidence/worker-runtime-status-2026-10-12T1301Z.json` — `/health`, `/api/status`, `/api/catalog`
  and both product boards from the local Worker after its no-browser initial refresh (three vendors, 9
  observations, fresh, `nextAttemptAt` +6 h).
- `docs/evidence/worker-runtime-status-2026-10-12T1315Z.json` — the scheduled-handler path triggered
  through `curl /cdn-cgi/local/scheduled` against a second fresh Durable Object store: one 10-request
  run and one correct zero-request backoff skip, 9 observations persisted, plus `/api/status` and both
  product boards after the run.
- `docs/evidence/vendor-research-2026-10-12T1305Z-pucks-shipping.json` — public-product-page, cart and
  terms-page quotes supporting the Pucks unknown-shipping label instead of a guessed amount.
- Earlier snapshots from iterations 3-49 to 3-53 remain in `docs/evidence/` as history, including the
  13:01 and 13:09 UTC QA pairs and the source check behind the table above.

## Repository and security checks

- No account IDs, API tokens, checkout sessions or addresses in source, docs or history (secret scan run).
- `wrangler.jsonc` defines the Durable Object class and migration, so no manual CF provisioning is
  needed and no administrative credential lives in GitHub.
- Research blockers recorded honestly in docs/SOURCES.md: rami-levy.co.il returns 403 (anti-bot, not
  bypassed); tivtaam.co.il and espresso-club.co.il are JS-only SPA shells; super-pharm.co.il serves a
  bot-detection challenge; amazon.com has no public evidence of delivery to Israel for the tracked
  listing, so it is excluded rather than guessed.
- The Coffee4U adapter fetches one allowlisted product URL per six-hour run and honours the site's
  `Crawl-delay: 7` request; no checkout, cart or account endpoint is touched.

## Remaining owner steps (Cloudflare handoff)

1. Stop the coding loop for the setup window (maintainer action; see docs/DEPLOYMENT.md handoff 1).
2. In Cloudflare: Workers & Pages → Create application → Import a repository → select
   igor-makarov/attention-shoppers-happy-hunting. Worker name `attention-shoppers-happy-hunting`.
3. Production branch `main`; build command `npm ci --ignore-scripts && npm run verify`; deploy command
   `npx --no-install wrangler deploy`; Node 24.x.
4. Disable builds/previews for every other branch, especially `shurik-control/*`.
5. Use the minimum build credential (Workers Scripts:Edit for this Worker only). Never add a CF token to
   GitHub or to the Worker.
6. After the first deploy, confirm `/health` reports `lastRefreshAt`, the board shows the nine observed
   offers across Crema e Gusto and Qualità Oro, the product selector lists both, the comparison table
   appears for 1 kg, the variant control lists Classico and "Variant not stated", and the 6-hour cron
   trigger is listed. Then verify that one later main push is picked up by Workers Builds.
7. If anything fails, report the Cloudflare error back to the loop; do not paste credentials.

## Loop notes

- Model/provider: opencode-go / deepseek-v4.1-flash at max reasoning (owner-authorized). Iterations
  2-45…2-47 hit provider 429 "Endpoint is unavailable" before any work landed; sessions 3-48, 3-51 and
  3-52 timed out, but their checkpoints are preserved and 3-52's second product landed. Iterations 3-49,
  3-50, 3-51 and 3-53 ran normally.
- Next useful task for the loop: a fourth vendor adapter only with evidenced Israeli delivery (for
  example a vendor that publishes delivery rates next to the product), or a third tracked product; also
  useful would be a permitted public page that makes Pucks' checkout-only shipping known so its cheaper
  prices can rank honestly. Keep `npm run check:sources` green against live pages and re-run both
  `npm run qa:browser` modes after any UI change.
