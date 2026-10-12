# Project status

Stage: **Crema e Gusto scope enforced; production deployment and refresh independently verified from the
runner by read-only public GETs; the 3-61 freshness fallback awaits the owner-side build.**
The Worker implements the self-updating board for exactly one product line — **Lavazza Crema e Gusto
vacuum-packed ground coffee** — with three independent Israeli vendor adapters and five observed
listings. The owner reports the site deployed at
**https://attention-shoppers.igormaka.workers.dev** with Worker name `attention-shoppers` and main-push
auto-deploy through Cloudflare Workers Builds. On 2026-10-12 15:51-15:54 UTC the coding loop independently
verified the public site from the runner with read-only GETs (no Cloudflare credentials, no admin API, no
deploy): `/health`, `/api/status`, `/api/catalog` and `/api/board` answered HTTP 200, the catalog exposed
exactly one product, the store held five observations, and the probe's first `/health` GET started the
site's documented initial refresh, which completed at 15:52:12.546 UTC and advanced `lastRefreshAt`. That
probe also exposed the gap iteration 3-61 fixes: before it, production had five saved observations and
vendor successes from 13:34/13:46 UTC but `lastRefreshAt` was null (an interrupted run), so the board read
as never refreshed even though its offers were recent. Outstanding production checks are listed below.
Iteration 3-59 kept the single-product scope and improved freshness honesty and
comparison quality: the board's `lastRefreshAt` now advances only when at least one vendor actually saved
an observation (an FX-only or empty run can no longer look freshly checked), every offer stores one
step of previous-check evidence so the UI shows the unit-price change since the last successful check in
ILS (or explains why the comparison is impossible), and the cheapest per-kilogram offer is called out
when it differs from the cheapest delivered total. Iteration 3-60 adds written shipping-certainty labels
next to every ranked rate, a `+₪ vs best` line on each comparison row, an approximate next-source-check
time in the board footer, and records the fresh vendor-coverage probes (Zap, FreshCafe, Brioso) that
found no fourth vendor carrying the tracked ground listing. Iteration 3-61 adds a board-freshness fallback
so an interrupted refresh with fresh saved observations is not reported as never refreshed, and records the
first independently verified production refresh from the runner.

The 2026-10-12 owner correction retired Qualità Oro, Qualità Rossa, Suerte and every other Lavazza
product line. They are no longer catalog entries, fetch targets or UI options. Their names survive only
as tombstones in `src/catalog.js` (so old links and historical pages are refused with an explicit reason)
and as historical evidence in docs/SOURCES.md and `tests/fixtures/historical-retired/`. Re-adding any
product line requires an explicit new owner instruction.

## What the Worker does now

- **One-product comparison board** (`/`, `/api/board`): ranks delivered offers for Lavazza Crema e Gusto
  ground coffee in a vacuum brick by item price + shipping + mandatory fees in ILS, normalized to
  delivered ILS/kg and to the packs a shopper actually buys. Destination (six Israeli locality/postcode
  areas, including "Elsewhere in Israel"), target grams and blend variant are selectable; no street
  address is collected or stored. `/api/catalog` exposes exactly one product, its variants and the
  three vendor adapters.
- **Variants and packs stay separate**: Classico, Forte, Ricco, Risveglio and decaf are filtered
  independently, and the Coffee4U listing (which states no blend variant) is stored as *Variant not
  stated*. The board reports how many offers the selected variant excluded instead of merging them.
  Single 250 g, 4 × 250 g and 8 × 250 g offers are never merged.
- **Retired lines cannot reappear**: `classifyListing()` rejects a retired listing with a reason naming
  the retired line; `resolveProductRequest()` maps an old `?product=lavazza-qualita-oro-vacuum-ground`
  (or Rossa/Suerte) URL back to the tracked product and returns `requestedRetiredProduct` so the board
  can explain the fallback; `pruneRetiredObservations()` deletes any stored retired observation or
  attempt marker on every refresh. The UI shows the tracked product as a static label (no dead
  one-option picker) and displays a written retired-line notice when a query URL asked for one.
- **Honest unknowns**: unknown shipping, unknown FX, unknown availability, stale observations and
  out-of-stock offers remain visible with plain-language reasons. Missing data never becomes zero and
  never wins. Pickup is shown separately and never competes with delivery.
- **Provenance**: every offer keeps its vendor link, product identity (variant, form, pack grams, pack
  count, SKU/GTIN), availability with its structured-data evidence URL, last successful check, last
  attempt, parser version and shipping certainty.
- **Previous-check comparison**: each refresh stores the previous successful price, stock and pack weight
  for the same offer, and the board shows the unit-price change since that check in ILS with its timestamp
  ("Unit price down ₪2.00 since the previous check"). A pack-size change or a missing exchange rate makes
  the comparison say why instead of claiming no change, and a stock change is labelled separately.
- **Bulk-value callout**: when the cheapest delivered total is not the cheapest per-kilogram offer (for
  example, two single 250 g packs at 500 g versus the 4 × 250 g pack), the best-offer card and the
  comparison table name the per-kilogram winner without changing the delivered ranking.
- **Readable comparison rows**: every ranked row states its difference from the cheapest delivered total
  (`+₪58.00 vs best`; the best row says `Cheapest delivered total`, an equal total says
  `Same delivered total as best`), so the ranking is auditable without recomputing the arithmetic.
- **Shipping evidence, honestly framed**: both ranked courier rates carry a structured coverage caveat
  taken from the vendor's terms page — home delivery is subject to a locality list the product page does
  not publish — so the board discloses the geographic restriction instead of claiming country-wide
  delivery. Every rate is also labelled in words: `Published rate (verified)`, `Estimated rate` or
  `Not published before checkout`. Availability and shipping evidence are stamped with the retrieval time
  of the page they came from, and the best-offer card and comparison table show unit price × packs bought
  = ILS line total so the delivered total is auditable. Pucks publishes no rate at all and keeps no
  invented caveat.
- **Self-updating runtime**: `wrangler.jsonc` triggers `17 */6 * * *` (about every six hours); the first
  `/health` or `/api/board` after deployment starts one throttled initial refresh. Observations, vendor
  state, FX rates, run history and leases persist in the SQLite-backed `BoardStore` Durable Object. The
  board API and footer report board-level fresh/stale freshness and warn in plain language when no
  completed refresh is recent. A run only advances `lastRefreshAt` when at least one vendor actually saved
  an observation, so neither an empty run (every vendor inside its backoff window) nor a run that fetched
  only the exchange-rate table can mask a stalled pipeline as fresh; both are still recorded in the run
  history. When no completion marker exists (a run interrupted after saving observations, for example by a
  redeploy), the board falls back to the newest saved observation for the age, exposes it as
  `lastObservationAt`/`freshness.dataAsOf`, and names it in the footer instead of claiming no refresh ever
  happened; a recorded but old completion still reads as stale, because that is the scheduled pipeline
  having stopped. Only observations for product lines that are still tracked count toward freshness, so a
  lingering historical row cannot mask a stale board. The board footer also names the earliest vendor `nextAttemptAt` as an approximate next source
  check time, so a shopper can see the board is scheduled to keep updating.
- **Bounded fetching**: host allowlists per adapter, 12 s timeout, 1.5 MB response cap, max two vendors
  in flight, one attempt per offer per run, published crawl delays honoured (`Crawl-delay: 7` on
  CoffeeMan and Coffee4U), 30 min→12 h backoff per vendor. Public routes never fetch a visitor-supplied
  URL and never start unbounded scraping. Responses are cacheable
  (`public, max-age=300, stale-while-revalidate=3600`).
- **No LLM or paid scraper in the public runtime**: only deterministic adapters, official Bank of Israel
  rates and native Cloudflare storage.

## Live observations (recorded evidence)

Retrieved 2026-10-12 15:39 UTC with `npm run check:sources` (bounded fetcher + production parsers) and
stored under `.shurik-local/sources/`; review copy in
`docs/evidence/source-check-20261012T1544Z.json`. Full source record: docs/SOURCES.md. Exactly five
listings are active; no retired line is fetched. Prices and stock were unchanged from the 15:12 UTC check,
and the 3-60 re-check of the CoffeeMan 8-pack page and the Pucks cart again found no published shipping
rate (`docs/evidence/vendor-probe-2026-10-12T1536Z.json`).

| Vendor | Listing | Price | Stock | Shipping | Certainty |
| --- | --- | --- | --- | --- | --- |
| CoffeeMan (IL) | Crema e Gusto Classico 250 g ground, SKU 930333 | ₪33 (regular ₪36) | in stock (schema.org microdata) | ₪25 courier; free self-pickup | verified |
| CoffeeMan (IL) | Crema e Gusto Classico 4 × 250 g ground, SKU 930334 | ₪124.00 | in stock | ₪25 courier; free self-pickup | verified |
| CoffeeMan (IL) | Crema e Gusto Classico 8 × 250 g ground, SKU 930335 | ₪240.00 | in stock | courier price not published | unknown (unranked) |
| Pucks (IL) | Crema e Gusto Classico 250 g ground, SKU Lav69, GTIN 8000070038769 | ₪30.00 | in stock (JSON-LD) | calculated at checkout | unknown (unranked) |
| Coffee4U (IL) | Crema e gusto 250 g ground, SKU 2010561, variant not stated | ₪38.00 | in stock (schema.org microdata) | ₪30 door-to-door courier; ₪15 pickup-point alternative; free self-pickup | verified |

Both ranked courier rates (CoffeeMan ₪25, Coffee4U ₪30) carry the same disclosed caveat: the vendor terms
make home delivery subject to a locality list that the product page does not publish, so the board shows a
structured "Delivery coverage" caveat instead of claiming country-wide delivery. The caveat source URLs and
the exact terms quotes are recorded in docs/SOURCES.md. Pucks publishes no rate, so no caveat is invented
for it; its offer stays unranked.

Observed board results on the local Worker after the initial refresh on a fresh store (14:50 UTC, evidence
`docs/evidence/worker-runtime-status-2026-10-12T1451Z.json`; the 3-59 re-run on a second fresh store at
15:13-15:15 UTC reproduced the same results with the new code and is recorded in
`docs/evidence/worker-runtime-status-2026-10-12T1515Z.json`; the 3-60 fresh-store run at 15:43 UTC
reproduced the same delivered totals again and additionally exercised the written shipping-certainty
labels and the next-source-check footer line, recorded in
`docs/evidence/worker-runtime-status-2026-10-12T1543Z.json`):

- **Crema e Gusto, 500 g to Tel Aviv**: best delivered total **₪91.00** = 2 × ₪33 + ₪25 shipping for
  CoffeeMan single packs (₪182.00/kg); the 4-pack is ranked second at ₪149.00. The Pucks ₪30 item and
  the 8-pack stay visible and unranked because shipping is not published before checkout / not published
  at all, so neither is treated as free. Three pickup rows are shown separately.
- **Crema e Gusto, 1 kg to Tel Aviv**: the 4-pack wins at **₪149.00** against ₪157.00 for four single
  packs, so the best choice changes with the shopper's quantity using only observed prices.
- **Variant not stated, 500 g to Tel Aviv**: the Coffee4U offer ranks at **₪106.00** (₪212.00/kg) with
  the ₪15 pickup-point delivery shown as a labelled alternative service; at 250 g the same offer is
  **₪68.00** (₪272.00/kg). It is never merged into the Classico ranking, and the ranked rate keeps the
  disclosed locality-list caveat.
- **Retired query URL** `?product=lavazza-qualita-oro-vacuum-ground`: the API falls back to Crema e
  Gusto, returns `requestedRetiredProduct: {id, line: "Qualità Oro"}`, and the page shows the retired-line
  notice plus the normal ₪91.00 Crema e Gusto board. No retired offer appears anywhere in the payload.
- **FX**: the 15:39 `check:sources` run does not fetch FX; the 14:50:40, 15:13:59 and 15:43:04 initial
  Worker refreshes and the 14:53 and 15:46 live `cron:local` pipelines fetched the official Bank of
  Israel table dated 2026-10-12 (USD 3.078, asOf 12:23:04Z).

## Verification performed (2026-10-12, all local)

1. `npm ci --ignore-scripts` — clean install from the pinned lockfile, 0 vulnerabilities.
2. `npm run verify` — **83/83** `node:test` cases pass, then `wrangler deploy --dry-run` builds the
   Worker bundle with no Cloudflare credential (77.23 KiB, gzip 19.81 KiB; bindings `BOARD` + `ASSETS`).
   Covered acceptance cases include: shipping changes the winner; unknown shipping cannot win;
   stale/out-of-stock/unknown availability stay unranked; variants and multipacks stay separate;
   quantity rounding, minimum order and free-shipping thresholds; missing FX is not zero; destination
   coverage; a disclosed locality-list caveat ranks but is labelled, while an excluding locality list
   still blocks; a stale pickup observation is labelled; pickup separated; shipping alternatives are
   converted but never replace the ranked amount; the variant filter reports excluded offers; an empty or
   FX-only run does not claim a completed offer refresh; previous-check price capture across refresh runs
   and its ILS down/up/same, missing-FX, pack-size-change and stock-change handling; the separate
   per-kilogram winner; written shipping-certainty labels for verified/estimated/unknown rates; leases; backoff;
   allowlist; crawl-delay pacing;
   retired fixtures are refused by both adapters; retired ids fall back with an explicit reason; the
   catalog exposes exactly one product; a retired `?product=` URL falls back to Crema e Gusto and never
   mixes a retired observation into the board; retired observations and attempt markers are pruned from
   the store; retired product URLs have no fixture route, so the offline tools cannot serve them; parser
   observations stamp availability and shipping evidence with the page retrieval time and keep the
   vendor's coverage caveat; the fixture-backed QA server keeps the browser harness aligned with the
   production quote engine.
3. `npm run check:sources` (live, 15:39 UTC) — CoffeeMan (three listings), Pucks (one) and Coffee4U
   (one) PASS against the real pages: ₪33 / ₪124 / ₪240 / ₪30 / ₪38, all five observed **in stock**
   (unchanged from the 15:12 UTC check). Verified ₪25 courier shipping on the CoffeeMan single and
   4-pack pages, unknown shipping on the 8-pack page and the Pucks page, and ₪30 door-to-door plus a
   ₪15 pickup-point alternative on the Coffee4U page. The check output also prints the structured
   coverage caveat for each offer: Amigo's and Coffee4U's terms pages make home delivery subject to an
   unpublished locality list. Review copy: `docs/evidence/source-check-20261012T1544Z.json`.
4. `npm run cron:offline` — full refresh pipeline against the recorded fixtures: **6 bounded requests**,
   five offers persisted (CoffeeMan 3, Pucks 1, Coffee4U 1) and the fixture FX table.
   `tests/simulate-cron.test.js` runs it twice in a temporary directory with identical results and
   asserts 6 requests, no backoff skips, five fresh offers and an FX reference rate, so the
   repeatability cannot regress. Offline runs use their own state file
   (`.shurik-local/board-offline.json`, reset per run) and never consume the live schedule.
5. `npm run cron:local -- --fresh` (live CLI pipeline, file-backed store, 15:46 UTC): **6 bounded
   requests**, all three vendors saved (CoffeeMan 3, Pucks 1, Coffee4U 1), **five live offers**
   persisted, `pruned: 0`, and the Bank of Israel table dated 2026-10-12 fetched (USD 3.078, asOf
   12:23:04Z). The 3-59 run at 14:53 UTC produced the same five offers and the same rate.
6. Local Worker runtime (`npx wrangler dev --port 8789`, **fresh** SQLite Durable Object state, no
   browser opened, 15:42-15:44 UTC): the first `/health` request on the empty store started the
   **initial refresh after deployment** path itself. It ran 15:43:04.260 → 15:43:21.907 UTC — **6 bounded
   requests**, all three vendors saved, **five observations persisted**, the Bank of Israel table fetched
   and `nextAttemptAt` +6 h; `/health` then reported a non-null `lastRefreshAt`. `/api/board` served
   ₪91.00 at 500 g (2 × ₪33 + ₪25), ₪149.00 at 1 kg (4-pack), the unstated-variant board ₪106.00, and
   the retired URL returned `requestedRetiredProduct` Qualità Oro with the Crema e Gusto board. The new
   `shipping.certaintyLabel` field was present on every quote, and the footer's approximate next-source
   check line rendered from the stored `nextAttemptAt`. This is the refresh-while-no-browser-open path
   plus the post-deployment initial refresh. Evidence:
   `docs/evidence/worker-runtime-status-2026-10-12T1543Z.json`. The 3-59 run additionally triggered the
   documented scheduled endpoint (`/cdn-cgi/local/scheduled`) once and observed **0 requests** with
   `lastRefreshAt` unchanged because every vendor was inside its six-hour window.
7. `npm run qa:browser` — headless Chrome (chromedriver 154) QA, **55/55 checks pass offline, exit 0**,
   desktop 1440 px and mobile 390 px, screenshots and JSON report in `.shurik-local/qa/`. The command is
   self-contained: it starts `scripts/qa-server.mjs` on an ephemeral port, which serves `public/` plus
   the read-only API computed from `tests/fixtures/` by the production quote engine, so no Worker,
   network or vendor site is needed. Expectations are derived from the API response (not hard-coded
   prices). Checks include: best delivered total and per-kg math, written stock labels, unknown-shipping
   reason, pickup shown separately, destination, quantity and variant controls, shareable URL updates,
   keyboard Tab focus with a visible 3 px focus outline and Enter activation, Hebrew text isolated with
   `dir="auto"`, no emoji anywhere in the visible text, no horizontal overflow, 44 px touch targets on
   mobile, and a footer that reports the last completed refresh. New scope checks: the catalog exposes
   only Crema e Gusto, the product control is a static tracked-product label rather than a picker, and
   an old `?product=lavazza-qualita-oro-vacuum-ground` URL falls back with the written notice, the
   Crema e Gusto ranking, and no Rossa/Suerte content. Two 3-58 checks: the best-offer card discloses
   the API's structured delivery-coverage caveat, and every ranked item-price cell shows
   `unit price × packs bought = ILS line total`. Five 3-59 checks: the fixture server's synthetic
   previous check makes the best-offer card show the API's unit-price change line, the comparison table
   repeats it for the best offer, the QA-only previous metadata itself is asserted, the fixture board's
   per-kilogram winner differs from its delivered winner, and that winner is called out in both the card
   and the table. Three 3-60 checks: every ranked rate carries a written shipping-certainty label in
   both the best-offer card and the comparison table, every comparison row states `+₪… vs best` (or
   `Cheapest delivered total` for the winner), and the board footer reports the approximate next source
   check due from the stored vendor `nextAttemptAt`. Seven extra checks run against a second fixture
   server with one clearly labelled QA-only demo offer to verify minimum order, free-shipping threshold,
   free-shipping-met labelling and a locality delivery restriction, plus one check that a board whose
   scheduled refresh stopped for 30 hours is labelled in the footer. Evidence:
   `docs/evidence/browser-qa-fixtures-20261012T1544Z.json`.
8. `npm run qa:browser -- http://127.0.0.1:8789` — live mode passed **51/51** against the local
   `wrangler dev` Worker at 15:43 UTC with the real persisted observations, including the retired-URL
   notice, the unstated-variant ranking, the disclosed coverage caveat, the written shipping-certainty
   labels, the item-price arithmetic, the `+₪ vs best` rows, the next-check footer line and the
   per-kilogram callout (the fixture-only previous-check and demo-offer checks are skipped or conditional
   in live mode). Evidence: `docs/evidence/browser-qa-live-20261012T1544Z.json`.
9. 3-59 record (kept as history): local Worker runtime re-run with the 3-59 code (`npx wrangler dev
   --port 8789`, **fresh** SQLite Durable Object state, no browser opened, 15:13-15:15 UTC): the first
   `/health` started the initial refresh, which ran 15:13:59.987 → 15:14:17.855 UTC with **6 bounded
   requests**, five observations saved and the Bank of Israel table fetched; `/health` then reported a
   non-null `lastRefreshAt`. The documented scheduled trigger (`/cdn-cgi/local/scheduled`) made **0
   requests** and left `lastRefreshAt` unchanged, so an empty run cannot mask freshness. `/api/board`
   served ₪91.00 at 500 g and ₪149.00 at 1 kg, the unstated-variant board ₪106.00, and the retired URL
   returned `requestedRetiredProduct` Qualità Oro with the Crema e Gusto board. First observations
   correctly show `priceChange: null` (nothing to compare with yet). Evidence:
   `docs/evidence/worker-runtime-status-2026-10-12T1515Z.json`; a 15:23 UTC re-capture with the
   comparison-quality code recorded `bestPerKg` = the CoffeeMan 4 × 250 g pack at ₪149.00/kg while the
   500 g delivered best stayed the single pack at ₪91.00 (`worker-runtime-status-2026-10-12T1523Z.json`).
10. Bounded vendor-coverage probes (15:19 and 15:35-15:41 UTC, 8-second timeouts, no bypass): the 15:19
   pass found no new vendor (blocked hosts still 403/247/526/timeout; espressocoffeeshop.com allows only
   whitelisted crawlers; coffeecircle.com's 1,535-URL sitemap has no Lavazza product; bringit.co.il is
   not a store). The 3-60 pass searched Zap.co.il for the exact product and followed its two new
   storefront leads: FreshCafe carries only Crema e Gusto capsules/pods and no ground listing, and
   Brioso serves a referer/JS gate instead of public robots rules, so neither was bypassed or added.
   The same pass re-checked the Pucks cart widget (still "shipping calculated at payment") and the
   CoffeeMan 8-pack page (still no courier price), so both unknown-shipping labels remain current vendor
   evidence. No fourth vendor found, so the board stays with the three observed adapters. Evidence:
   `docs/evidence/vendor-probe-2026-10-12T1519Z.json` and
   `docs/evidence/vendor-probe-2026-10-12T1536Z.json`.
11. 3-61 local re-run with the freshness fallback: `npm run verify` — **87/87** `node:test` cases pass
    (two new refresh tests for the interrupted-run fallback and `newestObservationAt`, two new worker tests:
    board/health freshness without a completion marker, and a lingering retired-product row not counting
    toward freshness), then `wrangler deploy --dry-run` builds the
    bundle (78.81 KiB, gzip 20.11 KiB; bindings `BOARD` + `ASSETS`). `npm run cron:offline` — **6 bounded
    requests**, all three vendors saved (CoffeeMan 3, Pucks 1, Coffee4U 1), five offers persisted,
    `pruned: 0`. `npm run qa:browser` — **57/57** offline checks pass, including two new checks that a store
    with fresh observations but no completion marker stays out of the stale state and the footer says
    `Last offer observation: …` instead of a never-refreshed message. `npm run qa:browser --
    http://127.0.0.1:8789` — **53/53** live checks pass against a fresh-store `wrangler dev` Worker
    (`--persist-to .shurik-local/wrangler-3-61b`, no browser opened): the first `/health` started the initial
    refresh (16:08:47.312 → 16:09:06.466 UTC, 6 bounded requests, five observations, Bank of Israel table),
    `/health` reported `lastRefreshAt` **and** `lastObservationAt`, and the boards matched ₪91.00 / ₪149.00 /
    ₪106.00 with the retired URL falling back. Evidence:
    `docs/evidence/worker-runtime-status-2026-10-12T1609Z.json`,
    `docs/evidence/browser-qa-fixtures-20261012T1610Z.json`,
    `docs/evidence/browser-qa-live-20261012T1609Z.json`.
12. 3-61 production verification (read-only, from the runner; no Cloudflare credentials, admin API or
    deploy): ten GETs against https://attention-shoppers.igormaka.workers.dev returned HTTP 200. Before the
    probe `/health` reported `lastRefreshAt: null` while `/api/status` held five observations with
    Pucks/Coffee4U successes at 13:34:41Z/13:46:30Z. The first `/health` GET started the documented initial
    refresh; the persisted run finished 15:51:52.931Z → 15:52:12.546Z with 4 bounded requests (CoffeeMan
    saved 3; Pucks/Coffee4U skipped inside their backoff window). `/api/catalog` listed exactly one product
    and three vendors; the 500 g board best was ₪91.00 (CoffeeMan 2 × 250 g + ₪25), 1 kg best ₪149.00
    (4-pack), unstated variant ₪106.00 (Coffee4U), and the retired Qualità Oro URL returned
    `requestedRetiredProduct` with the Crema e Gusto board and no retired offer in the payload. The deployed
    build predates 3-61, so its `/health` did not yet carry `lastObservationAt`; that field arrives with the
    owner-side build of this push. Evidence: `docs/evidence/production-verification-20261012T1554Z.json`.

## Owner-reported deployment vs independently verified

| Item | Status |
| --- | --- |
| Worker name in `wrangler.jsonc` | `attention-shoppers` (aligned with the owner correction) |
| Production URL reported by owner | https://attention-shoppers.igormaka.workers.dev — **independently verified reachable from the runner** (HTTP 200, 2026-10-12 15:51-15:54 UTC, read-only GETs, no credentials) |
| Production scope | **Independently verified**: `/api/catalog` listed exactly one product (`lavazza-crema-e-gusto-vacuum-ground`) and three vendors; no retired line appeared in any board payload, and the retired Qualità Oro URL returned `requestedRetiredProduct` with the Crema e Gusto board. |
| Production refresh / persistence | **Independently verified once**: the probe's first `/health` GET started the documented initial refresh (15:51:52.931Z → 15:52:12.546Z, 4 bounded requests, CoffeeMan saved 3; Pucks/Coffee4U inside their backoff window). `/api/status` then showed `lastRefreshAt` 15:52:12.546Z, fresh, five observations and the Bank of Israel table asOf 12:23:04.599Z. The 6-hour cron trigger itself has not been observed firing. |
| Production board values | **Independently verified**: 500 g best ₪91.00 (CoffeeMan 2 × ₪33 + ₪25), 1 kg best ₪149.00 (4-pack), unstated variant ₪106.00 (Coffee4U), matching the local runs. |
| Deployed build version | The verified production build predates iteration 3-61 (its `/health` has no `lastObservationAt`); the 3-61 freshness fallback needs the owner-side Workers Builds run after this push. |
| Main-push auto-deploy | Owner reports Workers Builds connected; a later push still needs the owner's confirmation that a build ran. |
| Local refresh-while-no-browser-open | Verified locally through `wrangler dev` + the documented scheduled trigger (item 6 above) and again with the 3-61 fresh store (item 11). |
| No Cloudflare administration | Maintained: no CF API calls, deploys, logins or token discovery in this repository or its history. The production probe used plain public HTTPS GETs only. |

Outstanding production checks for the owner: `/health` should report a non-null `lastRefreshAt`;
`/api/catalog` should list exactly one product; the board should show the five Crema e Gusto offers;
the 6-hour cron trigger should appear in the Cloudflare dashboard; one later main push should be seen by
Workers Builds. Report any Cloudflare error back to the loop without pasting credentials.

## Committed evidence snapshots

Current-scope evidence (committed for review, not live data):

- `docs/evidence/production-verification-20261012T1554Z.json` — the 3-61 read-only production probe from
  the runner: ten HTTP 200 GETs against https://attention-shoppers.igormaka.workers.dev, the interrupted
  state before the probe (`lastRefreshAt` null with five saved observations), the initial refresh the probe
  started (15:51:52.931Z → 15:52:12.546Z, 4 requests), the completed status (fresh, five observations, FX
  asOf 12:23:04.599Z) and the 500 g / 1 kg / unstated / retired-URL board summaries.
- `docs/evidence/worker-runtime-status-2026-10-12T1609Z.json` — `/health`, `/api/status`, `/api/catalog`,
  the 500 g / 1 kg / unstated-variant boards and the retired-URL fallback from the final 3-61 local Worker
  run on a fresh Durable Object store (`--persist-to .shurik-local/wrangler-3-61b`, no browser opened): a
  6-request initial refresh, five observations, `/health` reporting both `lastRefreshAt` and
  `lastObservationAt`, and `freshness.dataAsOf` in the board payload.
- `docs/evidence/browser-qa-fixtures-20261012T1610Z.json` — **57/57** offline browser checks with the final
  3-61 code, including the two new interrupted-refresh checks (fresh observations without a completion
  marker stay out of the stale state; the footer names the last offer observation).
- `docs/evidence/browser-qa-live-20261012T1609Z.json` — **53/53** live browser checks against the final
  3-61 fresh-store `wrangler dev` Worker with real observations, including the same two interrupted-refresh
  checks against the local fixture server.
- `docs/evidence/source-check-20261012T1544Z.json` — the 15:39 UTC live adapter check of the five
  active Crema e Gusto offers (₪33 / ₪124 / ₪240 / ₪30 / ₪38, all in stock) with coverage caveats and
  evidence timestamps; this is the evidence behind the table above.
- `docs/evidence/worker-runtime-status-2026-10-12T1543Z.json` — `/health`, `/api/status`, `/api/catalog`,
  the 500 g / 1 kg / unstated-variant boards and the retired-URL fallback from the 3-60 local Worker run
  on a fresh Durable Object store: a 6-request initial refresh, five observations, fresh, every quote
  carrying `shipping.certaintyLabel`, and the board footer rendering the approximate next source check
  from the stored vendor `nextAttemptAt`.
- `docs/evidence/browser-qa-fixtures-20261012T1544Z.json` — 55 offline browser checks with the final
  3-60 code, including the three new checks for written shipping-certainty labels, `+₪ vs best`
  comparison rows and the next-source-check footer line.
- `docs/evidence/browser-qa-live-20261012T1544Z.json` — 51 live browser checks against the 3-60 local
  `wrangler dev` Worker with real observations, including the new certainty labels, comparison deltas
  and next-check line.
- `docs/evidence/vendor-probe-2026-10-12T1536Z.json` — the 15:35-15:41 UTC coverage probe (Zap exact
  product search; FreshCafe capsules/pods only; Brioso referer gate not bypassed) plus the re-check of
  the Pucks cart and CoffeeMan 8-pack shipping pages; no fourth vendor, no bypass.
- `docs/evidence/source-check-2026-10-12T1512Z.json` — the previous 15:12 UTC live adapter check of the
  same five offers, kept for comparison (prices and stock were unchanged at 15:39 UTC).
- `docs/evidence/worker-runtime-status-2026-10-12T1515Z.json` — `/health`, `/api/status`, `/api/catalog`,
  the 500 g / 1 kg / unstated-variant boards and the retired-URL fallback from the 3-59 local Worker run
  on a fresh Durable Object store: a 6-request initial refresh, five observations, fresh,
  `priceChange: null` on first observations, then a documented 0-request scheduled run that did not
  change `lastRefreshAt`.
- `docs/evidence/browser-qa-fixtures-2026-10-12T1524Z.json` — 52 offline browser checks with the
  final 3-59 code, including the single-product catalog, static product label, retired-URL notice,
  unstated-variant ranking, the disclosed delivery-coverage caveat, the item-price arithmetic, the
  previous-check price-change line, the per-kilogram callout and the stale-refresh footer warning.
- `docs/evidence/browser-qa-live-2026-10-12T1523Z.json` — 48 live browser checks against the 3-59 local
  `wrangler dev` Worker with real observations and the per-kilogram callout.
- `docs/evidence/worker-runtime-status-2026-10-12T1523Z.json` — `/health`, `/api/status`, and the 500 g /
  1 kg boards from the 15:23 UTC local Worker re-capture with the comparison-quality code: the 500 g
  delivered best is the single pack (₪91.00, ₪182.00/kg) while `bestPerKg` is the 4-pack (₪149.00/kg,
  delivered ₪149.00), and at 1 kg the two coincide.
- `docs/evidence/browser-qa-fixtures-2026-10-12T1515Z.json` — 50 offline browser checks from the first
  3-59 batch (previous-check change line before the per-kilogram callout was added).
- `docs/evidence/browser-qa-live-2026-10-12T1515Z.json` — 47 live browser checks from the first 3-59
  batch against the local `wrangler dev` Worker.
- `docs/evidence/vendor-probe-2026-10-12T1519Z.json` — the bounded coverage re-probe of blocked and
  newly reachable candidate vendors; no new vendor, no bypass.
- `docs/evidence/source-check-2026-10-12T1450Z.json` — the earlier 14:50 UTC live check of the same five
  offers, kept for comparison (prices and stock were unchanged at 15:12 UTC).
- `docs/evidence/worker-runtime-status-2026-10-12T1451Z.json` — `/health`, `/api/status`, `/api/catalog`,
  the 500 g / 1 kg / unstated-variant boards and the retired-URL fallback from the local Worker after
  the post-deployment initial refresh on a fresh Durable Object store: one 6-request run, five
  observations, fresh, `nextAttemptAt` +6 h, then a documented 0-request scheduled run that did not
  change `lastRefreshAt`.
- `docs/evidence/browser-qa-fixtures-2026-10-12T1454Z.json` — 47 offline browser checks, including the
  single-product catalog, static product label, retired-URL notice, unstated-variant ranking, the
  disclosed delivery-coverage caveat, the item-price arithmetic and the stale-refresh footer warning.
- `docs/evidence/browser-qa-live-2026-10-12T1452Z.json` — 45 live browser checks against a local
  `wrangler dev` Worker with real observations.
- `docs/evidence/source-check-2026-10-12T1415Z.json` — the 14:15 UTC live check of the same five offers,
  kept for comparison (prices and stock were unchanged at 14:50 UTC).
- `docs/evidence/worker-runtime-status-2026-10-12T1418Z.json` — the 14:18 UTC scheduled-handler runtime
  snapshot from iteration 3-57.
- `docs/evidence/browser-qa-fixtures-2026-10-12T1420Z.json` and
  `docs/evidence/browser-qa-live-2026-10-12T1419Z.json` — the 3-57 offline (45/45) and live (43/43)
  browser QA reports.
- `docs/evidence/vendor-research-2026-10-12T1305Z-pucks-shipping.json` — public product-page, cart and
  terms-page quotes supporting the Pucks unknown-shipping label instead of a guessed amount.

Historical evidence (recorded before the owner correction; kept clearly labelled and not live data):

- `docs/evidence/source-check-2026-10-12T1346Z.json` — the earlier fourteen-offer check across four
  products, including the retired Qualità Oro, Qualità Rossa and Suerte listings and the observed
  out-of-stock Pucks Qualità Rossa SKU Lav35 page.
- `docs/evidence/worker-runtime-status-2026-10-12T1349Z-scheduled.json` and
  `docs/evidence/worker-runtime-status-2026-10-12T1337Z.json` — local Worker snapshots from the
  four-product and three-product builds.
- `docs/evidence/browser-qa-fixtures-2026-10-12T1348Z.json` and
  `docs/evidence/browser-qa-live-2026-10-12T1350Z.json` — browser QA from the four-product build.
- Earlier snapshots from iterations 3-49 to 3-55 remain in `docs/evidence/` as history, including the
  12:57 UTC source check for nine offers and the 13:01/13:09 UTC QA pairs.
- `tests/fixtures/historical-retired/` holds the retired page excerpts used as negative test inputs.

## Iteration notes (historical unless marked current)

Current iteration (3-61): fixed the board-freshness gap that the production probe exposed and recorded
the first independently verified production refresh. Board freshness now reports the newest saved
observation (`lastObservationAt`, `freshness.dataAsOf`) and uses it as the age anchor only when no
completed refresh exists, so an interrupted run (for example a redeploy stopping the background job) with
fresh saved offers is not labelled never refreshed; a recorded but old completion still reads as stale
because the scheduled pipeline stopped. `/health` now reports `lastObservationAt` too, and only rows for
product lines that are still tracked count toward freshness, so a lingering historical row cannot keep the
single-product board looking fresh. Two refresh tests, two worker tests and two browser QA checks cover the
fallback; `npm run verify` passes **87/87** with the
Worker bundle building (78.81 KiB, gzip 20.11 KiB), `npm run cron:offline` saves five offers with 6 bounded
requests, offline browser QA is **57/57** and live browser QA against a fresh-store `wrangler dev` is
**53/53**. Read-only production GETs from the runner independently verified the deployed site (one product,
five observations, a completed initial refresh at 15:52:12.546Z, ₪91.00/₪149.00/₪106.00 boards,
retired-URL fallback) and exposed the interrupted-run state that motivated the fix. Also repaired three
broken evidence-file references in this document. Evidence:
`docs/evidence/production-verification-20261012T1554Z.json`,
`docs/evidence/worker-runtime-status-2026-10-12T1609Z.json`,
`docs/evidence/browser-qa-fixtures-20261012T1610Z.json`,
`docs/evidence/browser-qa-live-20261012T1609Z.json`.

Iteration 3-60: improved Crema e Gusto shipping evidence, freshness and comparison quality
inside the single-product scope, and ran a fresh bounded vendor-coverage hunt. The quote engine now
exposes a written `shipping.certaintyLabel` (`Published rate (verified)` / `Estimated rate` /
`Not published before checkout`), the best-offer card and every comparison row show it, each comparison
row states `+₪… vs best` (or `Cheapest delivered total` / `Same delivered total as best`), and the board
footer names the earliest stored vendor `nextAttemptAt` as an approximate next source check. One new
quote test (83 total) and three new browser-QA checks (55 offline, 51 live) cover the labels and the
deltas; `npm run verify`, the live source check (15:39 UTC, five offers unchanged), the offline fixture
refresh, the live `cron:local` pipeline (15:46 UTC, 6 requests, USD 3.078), a fresh-store `wrangler dev`
initial refresh (15:43 UTC) and both browser QA modes were re-run and recorded above. The 15:35-15:41 UTC
probe searched Zap.co.il for the exact product and followed its two new storefront leads (FreshCafe:
capsules/pods only; Brioso: referer-gated, not bypassed) and re-checked the Pucks cart and CoffeeMan
8-pack pages; no fourth vendor carries the tracked ground listing, so the blockers are recorded in
docs/SOURCES.md and `docs/evidence/vendor-probe-2026-10-12T1536Z.json` instead of being guessed.

Iteration 3-59: improved freshness honesty and comparison quality inside the single-product
scope. The scheduled pipeline now reads the stored observations before writing, attaches the previous
successful price, stock and pack weight to each new observation, and the quote engine exposes a
previous-check unit-price change in ILS (with explicit "not comparable" reasons for a missing exchange
rate or a changed pack size). The board's `lastRefreshAt` now advances only when at least one vendor
actually saved an observation, so a run that fetched only the FX table cannot look like a fresh offer
check. Seven new quote tests and two new refresh tests (82 total) and five new browser-QA checks
(52 offline, 48 live) cover the change and the per-kilogram callout, and the full local chain (verify, live source check, offline
fixtures, post-deployment initial refresh plus a documented 0-request scheduled run through
`wrangler dev`, both browser QA modes) was re-run and recorded above. The board now also names the
cheapest per-kilogram offer when it differs from the cheapest delivered total, without changing the
delivered ranking. A bounded 15:19 UTC re-probe of
blocked and newly reachable candidate vendors found no fourth vendor; the results are recorded in
docs/SOURCES.md and the committed probe evidence instead of being guessed.

Iteration 3-58: improved Crema e Gusto shipping evidence and comparison quality inside the
single-product scope. The CoffeeMan and Coffee4U adapters now carry a structured coverage caveat from
their terms pages (home delivery is subject to an unpublished locality list), the quote engine labels it
without blocking ranking and keeps it off pickup rows, and availability/shipping evidence are stamped
with the retrieval time of the page they came from. The best-offer card and comparison table now show
`unit price × packs bought = ILS line total`. Four new tests (73 total) and two new browser-QA checks
(47 offline, 45 live) cover the caveat, the timestamp and the arithmetic; the full local chain (verify,
live source check, offline and live cron, post-deployment initial refresh plus a documented 0-request
scheduled run through `wrangler dev`, both browser QA modes) was re-run and recorded above. No new vendor
or tracked listing was found by the 14:39-14:58 UTC sitemap/category/domain probe passes (including
pricez.co.il, coffeebar.co.il, coffeelab.co.il, barista.co.il and mycafe.co.il).

Iteration 3-57 finished the owner correction that checkpoint 3-56 began. Tests, UI, browser QA and docs
were narrowed to the single Crema e Gusto scope; retired fixtures became negative inputs;
`pruneRetiredObservations()` is covered by a unit test; the board shows a retired-line notice for old
product URLs; an empty backoff run no longer updates `lastRefreshAt`.

Checkpoint 3-56 (current-scope code, tests/docs still stale): renamed the Worker to `attention-shoppers`
in `wrangler.jsonc`, reduced the catalog to one product with retired-line tombstones, removed the retired
offers from all three adapters (parser versions `coffeeman/5`, `pucks/5`), added
`pruneRetiredObservations()` and `resolveProductRequest()`, moved the retired fixtures into
`tests/fixtures/historical-retired/`, and updated `wrangler.jsonc`. It did not finish the test, UI and
documentation work; this iteration did.

Iterations 3-49 to 3-55 built the earlier multi-product tracker (four products, fourteen offers) and its
evidence chain. That scope was retired by the owner correction. Those notes are kept only as history:
they do not authorize re-adding a product line, and the corresponding fixtures are no longer routed to
any adapter.

- 3-49 fixed three real defects found by browser QA (dead quantity buttons, a misread WebDriver element
  id, non-isolated Hebrew text) and added `npm run check:sources` and `npm run qa:browser`.
- 3-50 made browser QA repeatable offline, added live mode, standardised `npm run dev` on port 8789, made
  the refresh lease atomic, added ranked-terms rows, and grew CoffeeMan to three listings.
- 3-51 added the Coffee4U adapter with published delivery options, converted shipping alternatives and
  board-level freshness.
- 3-52 added the second tracked product and the data-driven product list (retired by the owner
  correction).
- 3-53 fixed the offline/live cron state-file collision and hardened variant fallback.
- 3-54 added the third and fourth tracked products (retired by the owner correction) and recorded the
  rejected fourth-vendor candidates.
- 3-55 was interrupted after committing two more retired-line fixtures; 3-56 recovered as the owner
  correction landed.

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
- The retired lines are not fetch targets: a scan of `src/vendors/` URLs contains no `qualita` or
  `suerte` path, and the test suite asserts it.

## Remaining owner steps

1. After the 3-61 push, confirm Workers Builds picked it up and the deployed `/health` now reports both
   `lastRefreshAt` and `lastObservationAt` (the verified pre-3-61 build had no `lastObservationAt`).
2. Confirm the 6-hour cron trigger is listed in the Cloudflare dashboard and that one scheduled tick is
   observed; the loop has observed a request-triggered initial refresh and persisted vendor state from
   earlier production runs, but never a cron tick itself.
3. If anything fails, report the Cloudflare error back to the loop; do not paste credentials.

## Loop notes

- Model/provider: opencode-go / deepseek-v4.1-flash at max reasoning (owner-authorized). Sessions 3-54,
  3-55 and 3-56 ended in timeout/interruption/model error; their committed checkpoints are preserved and
  the owner correction survived them. Session 3-57 completed the correction locally; session 3-58 added
  the shipping-evidence and comparison-quality improvements; session 3-59 added the previous-check price
  comparison and the honest `lastRefreshAt` rule above; session 3-60 added the written shipping-certainty
  labels, the `+₪ vs best` comparison rows, the approximate next-source-check footer line and the fresh
  vendor-coverage probes; session 3-61 added the interrupted-refresh freshness fallback and independently
  verified the production deployment and its request-triggered initial refresh from the runner.
- Next useful task for the loop: improve only Crema e Gusto coverage, shipping evidence, freshness and
  comparison quality. Candidates, in order: (a) after the owner-side build of this push, re-verify
  production `/health` reports `lastObservationAt` and that the deployed board still matches the documented
  values; (b) re-check whether Pucks or CoffeeMan starts publishing a rate for the currently unrankable
  offers (the 3-60 probe found none); (c) another bounded re-probe of the recorded blocked vendors at a
  later date for a fourth adapter. The 2026-10-12 probes (14:25, 14:39-14:58, 15:19 and 15:35-15:41 UTC,
  the last via Zap and its FreshCafe/Brioso leads) found no viable new vendor, so candidate domains and
  their blockers stay recorded in docs/SOURCES.md instead of guessed. Adding another product line requires
  an explicit new owner instruction.
- Keep `npm run check:sources` green against live pages and re-run both `npm run qa:browser` modes after
  any UI change.
