# Project status

Stage: **Ready for Cloudflare handoff.** The Worker implements the real self-updating board with three
independent vendor adapters; the owner still has to connect Cloudflare Workers Builds (steps at the end
of this file and in docs/DEPLOYMENT.md). No Cloudflare deployment, credential or remote resource was
created by the coding loop.

## What the deployed Worker does

- **Comparison board** (`/`, `/api/board`): ranks delivered offers for Lavazza Crema e Gusto vacuum-packed
  ground coffee by item price + shipping + mandatory fees in ILS, normalized to delivered ILS/kg and to
  the packs a shopper actually buys. Destination (six Israeli locality/postcode areas), target grams and
  variant are selectable; no street address is collected. Ranked offers also show minimum order,
  free-shipping threshold, locality restrictions, offset labels and any additional published shipping
  service (for example Coffee4U's ₪15 delivery to a pickup point).
- **Variants stay separate**: Classico, Forte and other stated variants are filtered independently, and a
  listing whose page does not state the blend variant (Coffee4U) is stored as *Variant not stated*. The
  board reports how many offers the selected variant excluded, so they are discoverable instead of merged.
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
| Coffee4U (IL) | Lavazza Crema e gusto 250 g ground, SKU 2010561, variant not stated | ₪38.00 | in stock (schema.org microdata) | ₪30 door-to-door courier; ₪15 pickup-point delivery; free self-pickup | verified |

Live board at 500 g Classico to Tel Aviv: best delivered total ₪91.00 = 2 × ₪33 + ₪25 shipping for
CoffeeMan single packs (₪182.00/kg); the 4-pack is ranked second at ₪149.00. At 1 kg the recorded 4-pack
wins at ₪149.00 against ₪157.00 for four single packs, so the best choice changes with the shopper's
quantity using only observed prices. Pucks and the 8-pack stay visible as unranked with plain-language
reasons: shipping is not published before checkout, and the 8-pack page lists no courier rate, so neither
is treated as free. Selecting "Variant not stated" ranks the Coffee4U offer at ₪106.00 for 500 g
(₪212.00/kg) with the ₪15 pickup-point delivery shown as an alternative service; it is never merged into
the Classico ranking. FX reference table from the Bank of Israel dated 2026-10-09.

## Verification performed (2026-10-12, all local)

1. `npm ci --ignore-scripts` — clean install from the pinned lockfile, 0 vulnerabilities.
2. `npm run verify` — 54/54 `node:test` cases pass, then `wrangler deploy --dry-run` builds the Worker
   bundle with no Cloudflare credential (63.59 KiB, gzip 16.27 KiB; bindings `BOARD` + `ASSETS` shown).
   Covered acceptance cases include: shipping changes the winner; unknown shipping cannot win;
   stale/out-of-stock/unknown availability stay unranked; variants and multipacks stay separate;
   quantity rounding, minimum order and free-shipping thresholds; missing FX is not zero; destination
   coverage; pickup separated; shipping alternatives are converted but never replace the ranked amount;
   the variant filter reports excluded offers; a board whose scheduled refresh stopped is reported as
   stale (and a fresh one is not); leases; backoff; allowlist; and the fixture-backed QA server keeping
   the browser harness aligned with the production quote engine.
3. `npm run check:sources` (live) — CoffeeMan (all three listings), Pucks and Coffee4U PASS against the
   real pages at 12:09 UTC: prices ₪33 / ₪124 / ₪240 / ₪30 / ₪38, all listed in stock, verified ₪25
   courier on the first two CoffeeMan pages, verified ₪30 door-to-door plus a ₪15 pickup-point
   alternative on the Coffee4U page, unknown shipping on the 8-pack and Pucks. The same adapters fetched
   the same pages during the live local refresh at 12:10 UTC and parsed identically.
4. `npm run cron:offline` — full refresh pipeline against recorded Windows-1255/JSON-LD fixtures, all
   five offers and the FX table persisted; 6 bounded requests.
5. `npm run cron:local` — live pipeline at 12:10 UTC: 6 bounded requests, CoffeeMan saved 3, Pucks 1,
   Coffee4U 1, Bank of Israel rates fetched (USD 3.055), `nextAttemptAt` +6 h, 0 failures.
6. Local Worker runtime (`npx wrangler dev --persist-to ...`, SQLite Durable Object, fresh storage, no
   browser opened): `GET /health` started the initial refresh at 12:17 UTC — 6 bounded requests, all
   three vendors saved, 5 observations persisted, `nextAttemptAt` +6 h, FX fetched. `/api/board` then
   served the ranked Classico board (4 observed, 2 ranked, 1 excluded for another variant) and the
   unstated-variant board (Coffee4U ₪106.00 for 500 g with its shipping alternative). This is the
   refresh-while-no-browser-open path.
7. `npm run qa:browser` — headless Chrome (chromedriver 154) QA, **41/41 checks pass offline, exit 0**,
   desktop 1440 px and mobile 390 px, screenshots and JSON report in `.shurik-local/qa/`. The command is
   self-contained: it starts `scripts/qa-server.mjs` on an ephemeral port, which serves `public/` plus the
   read-only API computed from `tests/fixtures/` by the production quote engine, so no Worker, network or
   vendor site is needed. Expectations are derived from the API response (not hard-coded prices). Checks
   include: best delivered total and per-kg math, written stock labels, unknown-shipping reason, pickup
   shown separately, destination and quantity controls, shareable URL updates, keyboard Tab focus with a
   visible 3 px focus outline and Enter activation, Hebrew text isolated with `dir="auto"`, no emoji
   anywhere in the visible text, no horizontal overflow, 44 px touch targets on mobile, and a footer that
   reports the last completed refresh instead of a static "waiting" message. New this iteration: the
   excluded-variant notice, switching the variant control to rank the unstated-variant Coffee4U offer on
   its own, the published door-to-door rate as the ranked shipping amount, and the ₪15 pickup-point
   delivery rendered as a labelled alternative. Seven more checks run against a second fixture server
   with one clearly labelled QA-only demo offer to verify minimum order, free-shipping threshold,
   free-shipping-met labelling and a locality delivery restriction, plus one check that a board whose
   scheduled refresh stopped for 30 hours is labelled in the footer. The comparison table is checked
   against every ranked offer from the API. Live mode
   (`npm run qa:browser -- http://127.0.0.1:8789`) passed **39/39** against a real `wrangler dev` Worker
   on 2026-10-12 12:22 UTC (fixture-only checks are skipped in live mode); the run also re-verified the
   no-browser refresh path described in item 6. One earlier browser QA attempt aborted on a transient
   WebDriver timeout before any UI check ran; a manual WebDriver session then confirmed the page renders
   (`boardState=ready`, no page errors besides a 404 favicon) and the repeat runs passed cleanly.

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
serving old numbers. New fixtures, parser/quote/refresh/worker/QAServer tests and six new browser checks
cover all of that; the vendor research that found Coffee4U (and the sources that were probed and rejected)
is recorded in docs/SOURCES.md.

## Committed evidence snapshots

Historical evidence snapshots are committed for review and are not live data:

- `docs/evidence/source-check-2026-10-12T1209Z.json` — live adapter observations for all five offers from
  CoffeeMan, Pucks and Coffee4U (12:09 UTC). A later live check at 12:23 UTC re-passed all three adapters
  after the Coffee4U shipping-block parser was made tolerant of a longer delivery list
  (`docs/evidence/source-check-2026-10-12T1223Z.json`).
- `docs/evidence/browser-qa-fixtures-2026-10-12T1224Z.json` — 41 offline browser checks, including the
  unstated-variant ranking, the labelled shipping alternative and the stale-refresh footer warning.
- `docs/evidence/browser-qa-live-2026-10-12T1222Z.json` — 39 live browser checks against a local
  `wrangler dev` Worker with real observations.
- `docs/evidence/worker-runtime-status-2026-10-12T1222Z.json` — `/health`, `/api/status` and both board
  variants from the local Worker after its no-browser initial refresh (three vendors, 5 observations,
  fresh, `nextAttemptAt` +6 h).
- Earlier snapshots from iterations 3-49 and 3-50 remain in `docs/evidence/` as history.

## Repository and security checks

- No account IDs, API tokens, checkout sessions or addresses in source, docs or history (secret scan run).
- `wrangler.jsonc` defines the Durable Object class and migration, so no manual CF provisioning is
  needed and no administrative credential lives in GitHub.
- Research blockers recorded honestly in docs/SOURCES.md: rami-levy.co.il returns 403 (anti-bot, not
  bypassed); tivtaam.co.il and espresso-club.co.il are JS-only SPA shells; super-pharm.co.il serves a
  bot-detection challenge; amazon.com has no public evidence of delivery to Israel for the tracked
  listing, so it is excluded rather than guessed.
- The Coffee4U adapter fetches one allowlisted product URL per six-hour run and honours the site's
  `Crawl-delay: 7` request through the refresh interval; no checkout, cart or account endpoint is touched.

## Remaining owner steps (Cloudflare handoff)

1. Stop the coding loop for the setup window (maintainer action; see docs/DEPLOYMENT.md handoff 1).
2. In Cloudflare: Workers & Pages → Create application → Import a repository → select
   igor-makarov/attention-shoppers-happy-hunting. Worker name `attention-shoppers-happy-hunting`.
3. Production branch `main`; build command `npm ci --ignore-scripts && npm run verify`; deploy command
   `npx --no-install wrangler deploy`; Node 24.x.
4. Disable builds/previews for every other branch, especially `shurik-control/*`.
5. Use the minimum build credential (Workers Scripts:Edit for this Worker only). Never add a CF token to
   GitHub or to the Worker.
6. After the first deploy, confirm `/health` reports `lastRefreshAt`, the board shows the five observed
   offers (three CoffeeMan listings, Pucks, Coffee4U), the comparison table appears for 1 kg, the variant
   control lists both Classico and "Variant not stated", and the 6-hour cron trigger is listed. Then
   verify that one later main push is picked up by Workers Builds.
7. If anything fails, report the Cloudflare error back to the loop; do not paste credentials.

## Loop notes

- Model/provider: opencode-go / deepseek-v4.1-flash at max reasoning (owner-authorized). Iterations
  2-45…2-47 hit provider 429 "Endpoint is unavailable" before any work landed; session 3-48 timed out
  mid vendor research, but its checkpoints are preserved. Iterations 3-49, 3-50 and 3-51 ran normally.
- Next useful task for the loop: a fourth vendor adapter only with evidenced Israeli delivery, or a
  permitted international listing with published IL shipping; alternatively add a second tracked product
  (the catalog already models products as a list) so the board is not coffee-only. Keep
  `npm run check:sources` green against live pages and re-run both `npm run qa:browser` modes after any
  UI change.
