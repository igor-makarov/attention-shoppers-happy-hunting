# Project status

Stage: **Crema e Gusto scope enforced and the owner's blend/variant removal implemented (2026-10-12):
there is no variant selector, menu entry, warning, "other variant" count or variant filtering in the API or
UI, and every eligible tracked Crema e Gusto vacuum-packed ground listing — including the Coffee4U listing
whose blend wording is not stated — is compared in one board for the selected quantity, locality and
delivery method. The Canton Zürich product index + dedicated product page, the browser-researched shipping
rates and the progressive-disclosure layout are validated locally (124/124 tests, 78/78 offline and 76/76
live browser checks) and in production (**76/76** live browser checks against the deployed site, which
already serves the unified-comparison build and applies the researched Pucks rule to the old persisted
store at read time); the local-live Worker with real vendor data ranks Pucks ₪90, CoffeeMan ₪91 and
Coffee4U ₪106 at 500 g in the same comparison, and obsolete `variant=` URLs resolve to that one board.**
Production still serves the earlier build until the next main-push Workers Builds deploy; the researched
rates reach the production store at the next scheduled cron tick, and production verification remains
outstanding (listed below).
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
After the supervisor published the 3-61 commits, a second read-only probe at 16:17-16:18 UTC found
`/health` serving `lastObservationAt` — a field only the 3-61 code emits — so the pushed build is live in
production and the main-push Workers Builds path is independently verified from the runner; the Durable
Object store persisted across the deploy with the same refresh timestamps, and headless-Chrome browser QA
driven against the production URL passed **53/53** checks with zero console errors. Iteration 3-59 kept the single-product scope and improved freshness honesty and
comparison quality: the board's `lastRefreshAt` now advances only when at least one vendor actually saved
an observation (an FX-only or empty run can no longer look freshly checked), every offer stores one
step of previous-check evidence so the UI shows the unit-price change since the last successful check in
ILS (or explains why the comparison is impossible), and the cheapest per-kilogram offer is called out
when it differs from the cheapest delivered total. Iteration 3-60 adds written shipping-certainty labels
next to every ranked rate, a `+₪ vs best` line on each comparison row, an approximate next-source-check
time in the board footer, and records the fresh vendor-coverage probes (Zap, FreshCafe, Brioso) that
found no fourth vendor carrying the tracked ground listing. Iteration 3-61 adds a board-freshness fallback
so an interrupted refresh with fresh saved observations is not reported as never refreshed, and records the
first independently verified production refresh from the runner. Iteration 3-62 fixed a cron phase-lock in
that runtime: because a vendor's stored due time is `run time + 6 h` while the cron fires at fixed clock
times, a tick landing seconds early skipped every vendor and would silently drift the cadence to twelve
hours (with the board reporting stale for hours between runs). Successful vendors now count as due up to
15 minutes early; failure backoff stays strict. The fix is locally verified (**90/90** tests, fixture
refresh, **57/57** offline browser checks) and waits for the next main-push deployment. Iteration 3-63
added the repeatable read-only production probe and the multi-tick cron cadence test, and re-verified the
live sources at 16:50-16:53 UTC. Iteration 3-64 finished and verified the **failed-attempt disclosure**
that session 3-63 saved just before its timeout: when a vendor check fails, the attempt time and reason
are stamped on that offer's last successful observation row, so the board keeps ranking the last known
good price and stock while saying the most recent attempt failed instead of presenting the row as freshly
re-checked. Verified locally with **94/94** `node:test` cases, `wrangler deploy --dry-run` (80.12 KiB /
gzip 20.60 KiB), the fixture refresh (6 bounded requests, five offers), a live `check:sources` pass at
17:22 UTC (five listings unchanged), a live `cron:local -- --fresh` pass at 17:24 UTC (6 requests, five
offers, USD 3.078), **63/63** offline and **59/59** live browser checks including six new failed-attempt
checks. The same 3-64 code is live in production: read-only GETs at 17:31 UTC found the production board
quotes carrying `lastAttemptFailed`/`lastError` and the deployed `app.js` containing the failed-attempt
labels, and live browser QA against the production URL passed **59/59** with zero console errors.

The 2026-10-12 owner correction retired Qualità Oro, Qualità Rossa, Suerte and every other Lavazza
product line. They are no longer catalog entries, fetch targets or UI options. Their names survive only
as tombstones in `src/catalog.js` (so old links and historical pages are refused with an explicit reason)
and as historical evidence in docs/SOURCES.md and `tests/fixtures/historical-retired/`. Re-adding any
product line requires an explicit new owner instruction.

## What the Worker does now

- **One-product comparison board** (`/`, `/api/board`): ranks delivered offers for Lavazza Crema e Gusto
  ground coffee in a vacuum brick by item price + shipping + mandatory fees in ILS, normalized to
  delivered ILS/kg and to the packs a shopper actually buys. Destination (six Israeli locality/postcode
  areas, including "Elsewhere in Israel") and target grams are selectable; no street
  address is collected or stored. `/api/catalog` exposes exactly one product, no variant menu, and the
  three vendor adapters.
- **No blend/variant feature (owner correction, 2026-10-12)**: every eligible Crema e Gusto ground
  listing is compared together. The Coffee4U listing, which states no blend wording, is included rather
  than hidden behind a selector; a listing that prints Classico/Forte wording keeps that wording only as
  raw listing identity inside its optional offer details. `quoteBoard()` has no variant filter or
  exclusion count, `?variant=` is ignored by the Worker and the offline harness, and old shared URLs keep
  product/quantity/locality while the product page strips the obsolete parameter from the address bar.
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
- **Failed attempts stay visible**: when a vendor check fails, the failure is stamped on that offer's last
  successful observation row (`attemptedAt` + `lastError`) instead of a detached marker, so the board still
  ranks the last known good price and stock while saying `Last attempt: Failed … — showing the last
  successful observation`. The comparison table repeats `Last attempt failed …` next to the checked time,
  the unknown list names the failure reason in plain language, and the footer lists each failing source
  with its consecutive failures, next attempt and last error. A successful check clears the failure mark.
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
- **Shipping evidence, honestly framed**: each published or browser-observed rate carries a structured
  coverage caveat where the vendor terms make home delivery subject to a locality list the product page
  does not publish, so the board discloses the geographic restriction instead of claiming country-wide
  delivery. Every rate is also labelled in words: `Published rate (verified)`, `Checkout rate (observed,
  conditional)`, `Estimated rate` or `Not published before checkout`. Availability and shipping evidence
  are stamped with the retrieval time of the page (or estimator) they came from, and the best-offer card
  and comparison table show unit price × packs bought = ILS line total so the delivered total is
  auditable. A cart-observed rate is never relabelled as published and is never stretched to an
  unobserved cart size (the CoffeeMan 8-pack quote carries its 2000 g limit); a genuinely missing rate
  keeps the `Not published before checkout` label and never becomes zero.
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
  lingering historical row cannot mask a stale board. A successful vendor is stored as due at `run time +
  6 h`, and because the cron fires on fixed clock times a successful vendor also counts as due up to 15
  minutes early (`EARLY_DUE_TOLERANCE_MS`); a tick landing seconds before the due time therefore still
  refreshes instead of skipping every vendor and silently drifting to a twelve-hour cadence, while vendors
  inside a failure backoff keep their strict due time. The board footer also names the earliest vendor `nextAttemptAt` as an approximate next source
  check time, so a shopper can see the board is scheduled to keep updating.
- **Bounded fetching**: host allowlists per adapter, 12 s timeout, 1.5 MB response cap, max two vendors
  in flight, one attempt per offer per run, published crawl delays honoured (`Crawl-delay: 7` on
  CoffeeMan and Coffee4U), 30 min→12 h backoff per vendor. Public routes never fetch a visitor-supplied
  URL and never start unbounded scraping. Responses are cacheable
  (`public, max-age=300, stale-while-revalidate=3600`).
- **No LLM or paid scraper in the public runtime**: only deterministic adapters, official Bank of Israel
  rates and native Cloudflare storage.

## Live observations (recorded evidence)

Retrieved 2026-10-12 15:39 UTC and re-checked at 16:50 and 17:22 UTC with `npm run check:sources` (bounded
fetcher + production parsers) and stored under `.shurik-local/sources/`; review copies in
`docs/evidence/source-check-20261012T1544Z.json`, `docs/evidence/source-check-20261012T1650Z.json` and
`docs/evidence/source-check-20261012T1722Z.json`.
Full source record: docs/SOURCES.md. Exactly five listings are active; no retired line is fetched. Prices,
stock and shipping were unchanged across the 15:12, 15:39, 16:50 and 17:22 UTC checks, and the 3-60 re-check
of the CoffeeMan 8-pack page and the Pucks cart again found no published shipping rate
(`docs/evidence/vendor-probe-2026-10-12T1536Z.json`).

| Vendor | Listing | Price | Stock | Shipping | Certainty |
| --- | --- | --- | --- | --- | --- |
| CoffeeMan (IL) | Crema e Gusto Classico 250 g ground, SKU 930333 | ₪33 (regular ₪36) | in stock (schema.org microdata) | ₪25 courier; ₪15 distribution-center alternative (cart-observed for 0.5-1 kg carts); free self-pickup | verified |
| CoffeeMan (IL) | Crema e Gusto Classico 4 × 250 g ground, SKU 930334 | ₪124.00 | in stock | ₪25 courier; ₪15 distribution-center alternative (cart-observed for the 1 kg cart); free self-pickup | verified |
| CoffeeMan (IL) | Crema e Gusto Classico 8 × 250 g ground, SKU 930335 | ₪240.00 | in stock | ₪20 home courier / ₪20 distribution-center / free self-pickup on the observed 2 kg cart | checkout_quote (conditional, cart ≤ 2000 g) |
| Pucks (IL) | Crema e Gusto Classico 250 g ground, SKU Lav69, GTIN 8000070038769 | ₪30.00 | in stock (JSON-LD) | ₪30 home delivery, free above ₪100 item subtotal (observed 1-4 packs) | checkout_quote (conditional) |
| Coffee4U (IL) | Crema e gusto 250 g ground, SKU 2010561, variant not stated | ₪38.00 | in stock (schema.org microdata) | ₪30 door-to-door courier; ₪15 pickup-point alternative; free self-pickup | verified |

The two product-page courier rates (CoffeeMan ₪25, Coffee4U ₪30) and the two browser-researched
estimator rates (Pucks ₪30 with the ₪100 free-shipping threshold, CoffeeMan 8-pack ₪20 with a 2000 g cart
limit) each carry their disclosed caveat: the vendor terms make home delivery subject to a locality list
that the product page does not publish, and the estimator rates were sampled for the recorded carts and
localities, so the board shows a structured "Delivery coverage" caveat instead of claiming country-wide
delivery. The estimator rates are stored as `checkout_quote` and rendered as **Checkout rate (observed,
conditional)**, never as `Published rate (verified)`; the exact conditions live in the shipping evidence
disclosure and docs/SOURCES.md. No rate is invented for an unobserved cart size: the 8-pack quote carries
`maxTotalGrams: 2000`, so a larger cart stays unranked with the exact reason.

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
  at all, so neither is treated as free. Three pickup rows are shown separately. *(This was the state
  before the researched estimator rates were integrated; the 3-70 run below supersedes it.)*
- **Crema e Gusto, 1 kg to Tel Aviv**: the 4-pack wins at **₪149.00** against ₪157.00 for four single
  packs, so the best choice changes with the shopper's quantity using only observed prices. *(Pre-integration state.)*
- **Crema e Gusto, 500 g / 1 kg / 2 kg to Tel Aviv after the estimator rates were integrated (3-70 live
  run at 19:35 UTC, `docs/evidence/worker-runtime-status-2026-10-12T1941Z.json`)**: Pucks wins all three
  targets with **₪90.00** (2 × ₪30 + ₪30) at 500 g, **₪120.00** (4 × ₪30, free-shipping threshold met) at
  1 kg and **₪240.00** (8 × ₪30, free) at 2 kg; CoffeeMan's single pack (₪91.00), 4-pack (₪149.00) and
  8-pack (₪260.00) stay ranked behind it, and the CoffeeMan 8-pack is the cheapest per kilogram at 500 g
  (₪130.00/kg). All four ranked offers carry a written certainty label; there are zero unrankable offers
  for the Classico variant and three separate pickup rows remain.
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

> Dated verification record for the 3-58 to 3-64 build. It describes the board as it was before the
> owner's blend/variant removal; the current implementation and its verification are recorded in
> **Iteration 3-75** at the end of this file (124/124 tests, 78/78 offline and 76/76 live browser checks).

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
    build predates 3-61, so its `/health` did not yet carry `lastObservationAt`. Evidence:
    `docs/evidence/production-verification-20261012T1554Z.json`.
13. 3-61 post-deploy production verification (read-only, 16:17-16:18 UTC, after the supervisor published
    the 3-61 commits): `/health` returned
    `{lastRefreshAt: 15:52:12.546Z, lastObservationAt: 15:51:52.931Z}` and `/api/status` reported the same
    five observations, the same single completed initial run and `freshness.dataAsOf`
    `15:52:12.546Z` (ageHours 0.4, stale false). `lastObservationAt` exists only in the 3-61 code, so a
    build containing this iteration's changes is serving in production; the Durable Object store persisted
    across the deploy. The 500 g / 1 kg / unstated / retired-URL boards were unchanged (₪91.00 / ₪149.00 /
    ₪106.00 / Qualità Oro fallback). No `cf-cache-status` header was present. The 6-hour cron tick itself
    has still not been observed firing. The deployed UI was then driven end-to-end by
    `npm run qa:browser -- https://attention-shoppers.igormaka.workers.dev` — **53/53** checks passed
    against production with zero console errors, covering the best-choice card, comparison rows, written
    stock and shipping-certainty labels, the retired-URL notice, the coverage caveat, Hebrew isolation,
    keyboard focus, mobile reflow and the footer freshness/next-check lines. Evidence:
    `docs/evidence/production-verification-20261012T1618Z.json` and
    `docs/evidence/browser-qa-production-20261012T1620Z.json`.
14. 3-62 fixed a self-updating-runtime defect found while reviewing the production cron phase. A
    successful run stores each vendor as due at `run time + 6 h`, but the cron fires at fixed clock times
    (`17 */6 * * *`); a tick landing even a few seconds before the due time skipped every vendor, made
    only the rate-table request, saved no observation and left `lastRefreshAt` unchanged. In steady state
    that alternates into a twelve-hour refresh cadence, and the board (stale after eight hours) would
    report stale for hours between runs. `isVendorDue()` now counts a vendor with no consecutive failures
    as due up to `EARLY_DUE_TOLERANCE_MS` (15 minutes) early; vendors inside a failure backoff keep their
    strict due time, so backoff is not weakened. `npm run verify` — **90/90** `node:test` cases pass (three
    new: the early-due rule, a cron tick 30 seconds before the six-hour mark refreshing all three vendors
    and saving observations, and a fixture-QA-server check that a historical retired row cannot anchor the
    offline board's freshness). The fixture QA server now applies the same tracked-product freshness
    filter as the Worker, so the browser harness verifies production behavior. `wrangler deploy --dry-run`
    then builds the bundle (79.00 KiB, gzip 20.17 KiB; bindings `BOARD` + `ASSETS`). `npm run cron:offline` — **6 bounded requests**, five
    offers persisted, `pruned: 0`. `npm run qa:browser` — **57/57** offline checks pass. The reproduced
    before/after pipeline scenario (successful run at 00:17:20Z, next tick at 06:17:00Z, 20 s before the
    stored due times) is recorded in `docs/evidence/cron-phase-lock-20261012T163945Z.json`: the pre-fix
    `refresh.js` from commit 0f8ccae makes **1** request, skips all three vendors and saves **0**
    observations on the tick, while the fixed code makes **6** requests, skips none and saves all three.
    The fixed pipeline was then exercised live: `npm run cron:local -- --fresh` ran 16:34:59.732Z →
    16:35:16.549Z UTC with **6 bounded requests**, saved the same five Crema e Gusto offers (₪33 / ₪124 /
    ₪240 / ₪30 / ₪38, all in stock) and fetched the Bank of Israel table (USD 3.078, asOf
    12:23:04.599Z). The loop does not deploy: the fix reaches production with the next main push.
15. 3-63 added a repeatable **read-only production probe** (`npm run probe:production`,
    `scripts/probe-production.mjs`): fixed public GETs to `/health`, `/api/status`, `/api/catalog` and the
    500 g / 1 kg / unstated-variant / retired-URL boards, with no credentials, no POSTs and no remote
    change; it asserts the single-product scope (exactly one catalog product, no retired product row in any
    board, the retired URL falling back with a written notice) and writes a JSON snapshot under
    `.shurik-local/production/` or to `--out`. The probe passed **17/17** checks against
    https://attention-shoppers.igormaka.workers.dev at 16:53:20 UTC (evidence
    `docs/evidence/production-probe-20261012T1653Z.json`) and **17/17** against a fresh-store local
    `wrangler dev` Worker. `runRefresh` also gained a deterministic completion timestamp (`timeSource`,
    production default unchanged) so a new multi-tick cron test can simulate the production sequence on one
    timeline: off-phase initial refresh at 15:52:12 → 18:17 tick recorded with **0 requests** and no marker
    change → 00:17/06:17/12:17/18:17 ticks all refreshing (the 06:17 tick lands 15 s before the stored due
    time, so the early-due tolerance is what keeps the cadence) → completed refreshes stay **6 h ± 1 min**
    apart and never reach the 8 h stale threshold after the first on-phase refresh. `npm run verify` —
    **91/91** `node:test` cases pass; `wrangler deploy --dry-run` builds the bundle (79.47 KiB, gzip
    20.37 KiB; bindings `BOARD` + `ASSETS`). `npm run cron:offline` — **6 bounded requests**, five offers
    persisted, `pruned: 0`. `npm run check:sources` (live, 16:50 UTC) — the same five listings, same prices,
    stock and shipping as 15:39 UTC. `npm run cron:local -- --fresh` (live, 16:55 UTC) — **6 bounded
    requests**, all three vendors saved, five offers, Bank of Israel table USD 3.078 asOf 12:23:04Z. Local
    Worker runtime (`npx wrangler dev --port 8789`, fresh SQLite state, no browser opened): the first
    `/health` started the initial refresh (16:55:51.383 → 16:56:09.733 UTC, 6 requests, five observations,
    all three vendors) and the probe passed against it. `npm run qa:browser` — **57/57** offline checks;
    `npm run qa:browser -- http://127.0.0.1:8789` — **53/53** live checks against the fresh-store Worker.
    The 3-63 commits were then pushed to main, and a second read-only production probe at 17:04 UTC passed
    **18/18** checks (the new `health reports ok with storage available` check included; evidence
    `docs/evidence/production-probe-20261012T1704Z.json`), followed by
    `npm run qa:browser -- https://attention-shoppers.igormaka.workers.dev` — **53/53** live checks with
    zero console errors at 17:05 UTC (evidence `docs/evidence/browser-qa-production-20261012T1705Z.json`),
    so the deployed site still serves the tracked board after the push. The 3-63 Worker change
    (`timeSource`) has no public-API marker, so the build version itself is not distinguishable from the
    outside; the deploy path was last verified with the 3-61 push.

## Owner-reported deployment vs independently verified

| Item | Status |
| --- | --- |
| Worker name in `wrangler.jsonc` | `attention-shoppers` (aligned with the owner correction) |
| Production URL reported by owner | https://attention-shoppers.igormaka.workers.dev — **independently verified reachable from the runner** (HTTP 200, 2026-10-12 15:51-15:54, 16:17-16:18, 16:53 and 17:26 UTC, read-only GETs, no credentials) |
| Production scope | **Independently verified**: `/api/catalog` listed exactly one product (`lavazza-crema-e-gusto-vacuum-ground`) and three vendors; no retired line appeared in any board payload, and the retired Qualità Oro URL returned `requestedRetiredProduct` with the Crema e Gusto board. Re-verified by the 3-63 probe at 16:53 UTC (17/17 scope checks; `docs/evidence/production-probe-20261012T1653Z.json`) and by the 3-75 probes at 21:49 UTC (20/20 checks; `docs/evidence/production-probe-20261012T2149Z.json`) and 21:52 UTC (22/22 checks including the new inert-variant-parameter and no-variant-catalog regressions; `docs/evidence/production-probe-20261012T2152Z.json`). |
| Production refresh / persistence | **Independently verified**: the probe's first `/health` GET started the documented initial refresh (15:51:52.931Z → 15:52:12.546Z, 4 bounded requests, CoffeeMan saved 3; Pucks/Coffee4U inside their backoff window). `/api/status` then showed `lastRefreshAt` 15:52:12.546Z, fresh, five observations and the Bank of Israel table asOf 12:23:04.599Z. The post-deploy probe, the 16:53 probe and the 3-64 probe at 17:26 UTC found the same persisted store with the same timestamps (ageHours 1.0, stale false) and the same three vendor `nextAttemptAt` values (19:34/19:46/21:52 UTC). The 6-hour cron trigger itself has not been observed firing; the first tick after the store state was written is 18:17 UTC (expected to skip every vendor) and the 00:17 UTC tick should refresh. |
| Production board values | **Independently verified at 21:49 UTC after the 3-75 build deployed**: 500 g best **Pucks ₪90.00** (2 × ₪30 + the researched ₪30 rule applied at read time), CoffeeMan ₪91.00, **Coffee4U ₪106.00 in the same comparison**, CoffeeMan 4-pack ₪149.00; 1 kg best Pucks ₪120.00 (free above the ₪100 item subtotal); the CoffeeMan 8-pack stays unrankable at ₪240 because its cart-observed ₪20 rate is not a shared policy yet. The old persisted Pucks row (observed 13:34 UTC with unknown shipping) gained the validated rule without a vendor refresh, which independently confirms the read-time policy-enrichment/old-store gap fix in production. |
| Production UI | **Independently verified**: the fixture-free live browser QA mode drove the deployed site in headless Chrome — **53/53** checks passed with zero console errors on 2026-10-12 16:20 UTC, again at 17:05 UTC after the 3-63 push, and **59/59** at 17:31 UTC after the failed-attempt build deployed (evidence `docs/evidence/browser-qa-production-20261012T1620Z.json`, `docs/evidence/browser-qa-production-20261012T1705Z.json`, `docs/evidence/browser-qa-production-20261012T1731Z.json`). **The 3-75 unified-comparison UI is live and passed 76/76 checks at 21:59 UTC** — no variant control, Coffee4U in the same comparison, home→product navigation, disclosures, quantity/destination changes and mobile first-viewport money values all verified against the deployed site (evidence `docs/evidence/browser-qa-production-20261012T2200Z.json`). |
| Deployed build version | **The 3-61 build is live** (verified 16:17-16:18 UTC: `/health` carries `lastObservationAt`, a 3-61-only field; `/api/status` reports `freshness.dataAsOf`). **The failed-attempt build (3-63 save / 3-64) is also live**: the production `/api/board` quotes now carry `lastAttemptFailed`/`lastError` (a public field added in commit da47521) and the deployed `public/app.js` contains the `Last attempt failed` / `showing the last successful observation` strings (read-only GETs at 17:31-17:33 UTC; `docs/evidence/production-build-marker-20261012T1733Z.json`). **The 3-75 blend/variant-removal build is live** (verified 21:49-21:52 UTC, read-only GETs): `/api/board` returns no `variantId` and no `counts.excludedByVariant`, `?variant=unspecified` returns the same ranked list as the default request with Coffee4U included, `/api/catalog` notes describe the unified comparison, the served `product.js` strips the obsolete parameter and contains no `#variant` lookup, the served `home.js` says "one comparison for all tracked listings" and drops `variant` when forwarding, and the directly loaded product page contains zero `variant` occurrences. Evidence: `docs/evidence/production-build-marker-20261012T2152Z.json`. The 3-62 phase-lock change has no public-API marker (it only changes vendor due-time evaluation), so the probe cannot confirm which build serves it; the first observable difference is the **06:17 UTC tick on 2026-10-13**, which should refresh instead of skipping. |
| Main-push auto-deploy | **Independently verified for the 3-61 push and again for the 3-64 build**: after the supervisor published the 3-61 commits to main, the serving production build changed to one that includes the 3-61 fields, with the Durable Object store persisting across the deploy; after the da47521/3-64 commits, the production board API began returning the new `lastAttemptFailed`/`lastError` quote fields and the deployed `app.js` gained the failed-attempt labels (read-only GETs at 17:31 UTC). The 3-62 phase-lock push is on main and is expected to deploy the same way, but its effect is only observable through a cron tick. The 6-hour cron trigger and future builds still need the owner's dashboard confirmation. |
| Local refresh-while-no-browser-open | Verified locally through `wrangler dev` + the documented scheduled trigger (item 6 above) and again with the 3-61 fresh store (item 11). |
| No Cloudflare administration | Maintained: no CF API calls, deploys, logins or token discovery in this repository or its history. The production probe used plain public HTTPS GETs only. |

Outstanding production checks for the owner: the 6-hour cron trigger should appear in the Cloudflare
dashboard and one tick should be observed (the loop has only observed request-triggered refreshes); future
main pushes should keep reaching Workers Builds. The other checks below were independently verified from
the runner on 2026-10-12: `/health` reports a non-null `lastRefreshAt` and `lastObservationAt`,
`/api/catalog` lists exactly one product, the board shows the five Crema e Gusto offers, and the 3-61
build is live after the push. The 3-63 read-only probe re-verified all of that at 16:53 UTC (17/17 scope
checks) and the 3-64 baseline probe at 17:26 UTC passed 18/18 checks against the same persisted
15:52:12.546Z store, whose run history still contained only the initial run (no cron tick observed yet).
The 17:31 UTC read-only checks additionally confirmed that the production build now serves the
failed-attempt quote fields and UI labels (a 3-64-only public shape), with **59/59** live browser checks. The 3-62 phase-lock fix is on main; the expected
production sequence for the stored state is: the **18:17 UTC tick** records a run that fetches nothing
while every vendor is inside its six-hour window (does not advance `lastRefreshAt`, expected), the
**00:17 UTC tick** refreshes all three vendors, and the **06:17 UTC tick on 2026-10-13** is the first
place the phase-lock fix is observable: because the run's stored due time lands a few seconds after the
fixed clock tick, the tick should still refresh and save observations with the fix (without it, that tick
would skip and the board would drift toward a twelve-hour cadence and report stale for hours). The loop
can confirm this with `npm run probe:production` (read-only) once the ticks have passed. Report any
Cloudflare error back to the loop without pasting credentials.

The 3-75 read-only probes at 21:49 and 21:52 UTC (20/20 and 22/22 checks, the second with two new
inert-variant-parameter regressions) additionally verified that the blend/variant-removal
build is live in production: the API serves no `variantId`/`excludedByVariant`, `?variant=unspecified`
returns the identical unified ranking with Coffee4U included, and the served assets match the committed
code (`docs/evidence/production-probe-20261012T2149Z.json`,
`docs/evidence/production-build-marker-20261012T2152Z.json`). The production store is still the
15:52:12.546Z snapshot, so the 21:49 board's researched Pucks rate comes from read-time policy
enrichment, not a new vendor fetch — the 00:17 UTC cron tick is still the point where the store itself
picks up the researched observations. The CoffeeMan 8-pack's cart-observed ₪20 rate remains stored only
in a fresh observation (it is not a shared policy), so the old persisted 8-pack row stays honestly
unrankable until the tick.

## Committed evidence snapshots

Current-scope evidence (committed for review, not live data):

- `docs/evidence/browser-research/2026-10-12-coffeeman-cart-single-4pack.json` — the 19:56-20:09 UTC
  anonymous-cart batch for CoffeeMan: the single/4-pack carts quote ₪25 home courier and ₪15
  distribution-center delivery, the distribution-center fee went free at ₪198 and the courier at ₪231,
  but the ₪240 8-pack cart still charged ₪20/₪20; includes the rendered Hebrew excerpts, the locality
  blocker and two cart screenshots. No cart/session identifiers are recorded.
- `docs/evidence/worker-runtime-status-2026-10-12T2016Z.json` — the 3-71 fresh-store `wrangler dev`
  runtime: the request-triggered initial refresh (20:13:39.288Z → 20:13:59.647Z, 6 requests, five
  observations), the ₪90/₪120/₪240 Pucks boards and the CoffeeMan distribution-center alternatives.
- `docs/evidence/browser-qa-fixtures-20261012T2017Z.json` — **82/82** offline browser checks with the
  3-71 code, including the new adapter-shipping-terms disclosure check.
- `docs/evidence/browser-qa-live-20261012T2015Z.json` — **78/78** live browser checks against the
  fresh-store `wrangler dev` Worker with real vendor data.
- `docs/evidence/source-check-20261012T2014Z.json` — the 20:14-20:15 UTC live adapter check of the five
  active Crema e Gusto offers with the new distribution-center alternatives.
- `docs/evidence/production-build-marker-20261012T1733Z.json` — read-only public GETs at 17:33 UTC showing
  the deployed board quotes carrying `lastAttemptFailed`/`lastError` (ranked and unrankable), the deployed
  `app.js` containing the failed-attempt labels, and the intact store (five observations, the 15:52:12.546Z
  refresh, run history still only the initial run): the public marker that the 3-64 build reached
  production through the main-push Workers Builds path.
- `docs/evidence/browser-qa-production-20261012T1731Z.json` — **59/59** live browser checks driven
  directly against https://attention-shoppers.igormaka.workers.dev at 17:31 UTC with zero console
  errors, including the failed-attempt scenario against its own fixture server: the deployed site serves
  the tracked board, the retired-URL fallback, the comparison deltas and the freshness footer with the
  final 3-64 UI code.
- `docs/evidence/browser-qa-fixtures-20261012T1723Z.json` — **63/63** offline browser checks with the
  final 3-64 code, including six new failed-attempt checks (a failed last attempt keeps its last
  successful observation ranked; the best card, comparison row, unknown list and footer all disclose the
  failure and its reason).
- `docs/evidence/browser-qa-live-20261012T1722Z.json` — **59/59** live browser checks against a
  fresh-store `wrangler dev` Worker with real observations, zero console errors; the failure-scenario
  checks run against their own fixture server in both modes.
- `docs/evidence/source-check-20261012T1722Z.json` — the 17:22 UTC live adapter check of the five active
  Crema e Gusto offers (₪33 / ₪124 / ₪240 / ₪30 / ₪38, all in stock, same shipping evidence).
- `docs/evidence/worker-runtime-status-2026-10-12T1729Z-scheduled.json` — fresh-store `wrangler dev`
  runtime with the request-triggered initial refresh (17:28:22.779Z → 17:28:40.918Z, 6 requests, five
  observations) followed by a local scheduled tick at 17:29:06.953Z that recorded a **0-request** run
  with all three vendors skipped and left `lastRefreshAt` at the initial refresh; the same snapshot has
  the ₪91.00 board, the retired-URL fallback and the catalog with exactly one product.
- `docs/evidence/production-probe-20261012T1726Z.json` — the 3-64 read-only production baseline probe
  (18/18 checks) before the 18:17 UTC cron tick: persisted 15:52:12.546Z refresh, five observations,
  ₪91.00/₪149.00/₪106.00 boards, retired-URL fallback, and the run history still containing only the
  initial run.
- `docs/evidence/browser-qa-production-20261012T1705Z.json` — **53/53** live browser checks against
  https://attention-shoppers.igormaka.workers.dev at 17:05 UTC after the 3-63 push, with zero console
  errors: the deployed site still serves the tracked board, the retired-URL fallback, the written
  shipping-certainty labels, the comparison deltas and the freshness footer.
- `docs/evidence/production-probe-20261012T1704Z.json` — the second 3-63 read-only production probe
  (18/18 checks, including the `health reports ok with storage available` check) after the push; the
  persisted store, vendor due times and board values were unchanged from the 16:53 probe.
- `docs/evidence/production-probe-20261012T1653Z.json` — the 3-63 read-only production probe (17/17 checks)
  captured with `npm run probe:production`: `/health`/`/api/status` at 16:53:20 UTC still reported the
  persisted 15:52:12.546Z refresh with five observations, freshness ageHours 1.0 and stale false, the
  catalog still exposed exactly one product and three vendors, the 500 g / 1 kg / unstated boards were
  unchanged (₪91.00 / ₪149.00 / ₪106.00), the retired Qualità Oro URL still fell back with
  `requestedRetiredProduct`, and no board payload carried a retired product row. The snapshot also records
  the vendor `nextAttemptAt` values (19:34/19:46/21:52 UTC), which are the basis for the expected
  18:17/00:17/06:17 cron sequence above.
- `docs/evidence/source-check-20261012T1650Z.json` — the 16:50 UTC live adapter check of the five active
  Crema e Gusto offers (₪33 / ₪124 / ₪240 / ₪30 / ₪38, all in stock) with the same published shipping
  evidence as 15:39 UTC, re-confirming that no vendor price or stock changed during the day and that the
  CoffeeMan 8-pack and Pucks offers still publish no shipping rate.
- `docs/evidence/cron-phase-lock-20261012T163945Z.json` — the 3-62 cron phase-lock reproduction: the
  pre-fix `refresh.js` (commit 0f8ccae) and the fixed code each run the real fixture pipeline through a
  successful 00:17:20Z refresh and the 06:17:00Z cron tick 20 s before the stored due times. Pre-fix: 1
  request, 3 vendors skipped, 0 observations saved, no production completion marker. Fixed: 6 requests,
  0 skipped, all three vendors saved. This is the evidence that the fix prevents a silent drift from a
  six-hour to a twelve-hour refresh cadence.
- `docs/evidence/browser-qa-production-20261012T1620Z.json` — **53/53** live browser checks driven
directly against https://attention-shoppers.igormaka.workers.dev on 2026-10-12 16:20 UTC with zero console
  errors: the strongest end-to-end evidence that the deployed 3-61 build serves the tracked board, the
  retired-URL fallback, the shipping labels and the freshness footer correctly in a real browser.
- `docs/evidence/production-verification-20261012T1618Z.json` — the 3-61 **post-deploy** production
  probe: `/health` and `/api/status` now carrying `lastObservationAt`/`freshness.dataAsOf` (a 3-61-only
  shape) with the persisted 15:52:12.546Z refresh and five observations, the unchanged
  ₪91.00/₪149.00/₪106.00 boards and the retired-URL fallback; this is the evidence that the pushed build
  is live and the main-push Workers Builds path deployed it.
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

Current iteration (3-64): completed and verified the **failed-attempt disclosure** whose code session
3-63 saved seconds before its timeout, inside the single Crema e Gusto scope. A vendor failure now stamps
`attemptedAt`/`lastError` on the offer's existing observation row (matched by item URL) instead of leaving
a detached marker, so `quoteOffer` exposes `lastAttemptFailed`/`lastError` while `observedAt`, price and
stock stay at the last success; a later successful check clears the mark. The offline QA server gained a
`failedAttempt` scenario (fixture pages parsed 30 minutes earlier, CoffeeMan single pack and Pucks marked
as failed, vendor state with 1 consecutive failure and a 30-minute backoff), with two new `node:test`
cases — the QA-server scenario and a partial per-offer failure through the real refresh pipeline
(**94/94** total) — and six new browser checks. Verified: `npm run verify` — **94/94** tests, bundle
80.12 KiB / gzip 20.60 KiB; `npm run check:sources` (17:22 UTC) — five listings PASS with unchanged
₪33/₪124/₪240/₪30/₪38 prices, stock and shipping evidence; `npm run cron:offline` — 6 bounded requests,
five offers, `pruned: 0`; `npm run cron:local -- --fresh` (17:24 UTC) — 6 requests, five offers, all three
vendors saved, USD 3.078 asOf 12:23:04Z; fresh-store `wrangler dev` initial refresh (17:19:32 → 17:19:50
UTC, 6 requests, five observations, all three vendors) and, in a second runtime pass, one local scheduled
tick at 17:29:06 UTC that recorded a **0-request** run with all three vendors skipped and left
`lastRefreshAt` at the 17:28:40.918Z initial refresh
(`docs/evidence/worker-runtime-status-2026-10-12T1729Z-scheduled.json`); `npm run qa:browser` — **63/63** offline and
**59/59** live against the local Worker, zero console errors; and `npm run qa:browser --
https://attention-shoppers.igormaka.workers.dev` — **59/59** against the deployed site at 17:31 UTC, zero
console errors. Read-only GETs at 17:31 UTC also showed the production board quotes carrying the new
`lastAttemptFailed`/`lastError` fields and the deployed `app.js` containing the failed-attempt labels, so
the 3-64 build reached Workers Builds through the main push. Evidence:
`docs/evidence/browser-qa-fixtures-20261012T1723Z.json`,
`docs/evidence/browser-qa-live-20261012T1722Z.json`, `docs/evidence/source-check-20261012T1722Z.json`.
The 3-62 cron fix still has no public-API marker, so its production effect remains expected at the 06:17
UTC tick on 2026-10-13 (the expected 18:17/00:17/06:17 sequence is documented below).

Iteration 3-63: added a repeatable **read-only production probe** and closed the test-coverage
gap around the 3-62 cron phase-lock fix. `scripts/probe-production.mjs` (`npm run probe:production`)
sends fixed public GETs to `/health`, `/api/status`, `/api/catalog` and the 500 g / 1 kg /
unstated-variant / retired-URL boards, never authenticates or deploys, asserts the single-product scope
and writes a JSON snapshot; it passed **17/17** checks against the owner-reported production URL at
16:53 UTC and against a fresh-store local `wrangler dev` Worker. `runRefresh` now accepts an optional
`timeSource` (production default unchanged) so a new multi-tick cron test can run the real fixture
pipeline on one simulated timeline: the off-phase 18:17 tick records a **0-request** run without
advancing `lastRefreshAt`, the 00:17 tick refreshes all vendors, the 06:17/12:17/18:17 ticks keep
refreshing through the early-due tolerance, completed refreshes stay **6 h ± 1 min** apart and the board
never reaches the 8 h stale threshold after the first on-phase refresh. The live chain was re-run with
this build: `npm run verify` — **91/91** `node:test` cases pass and `wrangler deploy --dry-run` builds
(79.47 KiB, gzip 20.37 KiB); `npm run check:sources` (16:50 UTC) — five listings, prices/stock/shipping
unchanged; `npm run cron:offline` — 6 bounded requests, five offers, `pruned: 0`; `npm run cron:local --
--fresh` (16:55 UTC) — 6 requests, five offers, USD 3.078 asOf 12:23:04Z; fresh-store `wrangler dev`
initial refresh (16:55:51 → 16:56:09 UTC, 6 requests, five observations, all three vendors) plus the
probe; `npm run qa:browser` — **57/57** offline and **53/53** live against the local Worker. The 3-62 fix
still has no public-API marker, so its production effect is expected at the 06:17 UTC tick on 2026-10-13
(the expected 18:17/00:17/06:17 sequence is documented above). The commits were pushed to main and the
site was re-checked read-only afterwards: 18/18 probe checks at 17:04 UTC and 53/53 live browser
checks at 17:05 UTC with zero console errors. Evidence:
`docs/evidence/production-probe-20261012T1653Z.json`, `docs/evidence/source-check-20261012T1650Z.json`.

Iteration 3-62: fixed the cron **phase-lock** defect that would have silently drifted the production
refresh cadence from six to twelve hours. A successful run stores each vendor as due at `run time + 6 h`,
but the cron fires at fixed clock times, so a tick landing seconds before the due time skipped every
vendor, saved no observation and left `lastRefreshAt` unchanged; the board would then report stale for
hours between runs. `isVendorDue()` now counts a vendor with no consecutive failures as due up to 15
minutes early (`EARLY_DUE_TOLERANCE_MS`); vendors inside a failure backoff keep their strict due time.
`npm run verify` — **90/90** `node:test` cases (three new: the early-due rule, a tick 30 s before the
six-hour mark refreshing all vendors, and a fixture-QA-server freshness filter), bundle 79.00 KiB /
gzip 20.17 KiB; `npm run cron:offline` — 6 requests, five offers, `pruned: 0`; `npm run qa:browser` —
**57/57**; live `cron:local -- --fresh` (16:34:59 → 16:35:16 UTC) — 6 requests, five offers, USD 3.078.
The reproduced before/after scenario is in `docs/evidence/cron-phase-lock-20261012T163945Z.json`:
the pre-fix `refresh.js` from commit 0f8ccae makes 1 request, skips all three vendors and saves 0
observations on the tick, while the fixed code makes 6 requests, skips none and saves all three. The
iteration 3-63 test above extends this to the full multi-tick production sequence.

Iteration 3-61: fixed the board-freshness gap that the production probe exposed and recorded
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
retired-URL fallback) and exposed the interrupted-run state that motivated the fix; after the supervisor
published these commits, a second probe at 16:17-16:18 UTC found the 3-61-only `lastObservationAt` field
serving from production, so the push reached Workers Builds and the persisted store survived the deploy;
live browser QA against the production URL then passed **53/53** with zero console errors. Also repaired
four broken evidence-file references across docs. Evidence:
`docs/evidence/production-verification-20261012T1554Z.json`,
`docs/evidence/production-verification-20261012T1618Z.json`,
`docs/evidence/browser-qa-production-20261012T1620Z.json`,
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

1. The 3-61 build was verified serving in production on 2026-10-12 16:17 UTC (deployed `/health` reports
   both `lastRefreshAt` and `lastObservationAt`). The 3-62 and 3-63 commits are on main and are expected
   to reach Workers Builds the same way, but neither changes a public response shape, so their effect is
   only observable through cron ticks; no action needed unless a later build is expected.
2. Confirm the 6-hour cron trigger is listed in the Cloudflare dashboard and that one scheduled tick is
   observed; the loop has observed request-triggered refreshes and persisted vendor state from earlier
   production runs, but never a cron tick itself. The expected sequence for the persisted store is
   18:17 UTC (skip, 0 observations), 00:17 UTC (refresh all three vendors) and 06:17 UTC on 2026-10-13
   (first observable effect of the 3-62 phase-lock fix). The loop will re-run `npm run probe:production`
   (read-only) after those ticks.
3. If anything fails, report the Cloudflare error back to the loop; do not paste credentials.

## Loop notes

- Model/provider: opencode-go / deepseek-v4.1-flash at max reasoning (owner-authorized). Sessions 3-54,
  3-55 and 3-56 ended in timeout/interruption/model error; their committed checkpoints are preserved and
  the owner correction survived them. Session 3-57 completed the correction locally; session 3-58 added
  the shipping-evidence and comparison-quality improvements; session 3-59 added the previous-check price
  comparison and the honest `lastRefreshAt` rule above; session 3-60 added the written shipping-certainty
  labels, the `+₪ vs best` comparison rows, the approximate next-source-check footer line and the fresh
  vendor-coverage probes; session 3-61 added the interrupted-refresh freshness fallback, verified the
  production deployment and its request-triggered initial refresh from the runner, and then verified the
  pushed 3-61 build serving in production with 53/53 browser checks against the live URL; session 3-62
  reproduced and fixed the cron phase-lock that would have drifted the production cadence to twelve hours
  (successful vendors now count as due up to 15 minutes before their stored due time, failure backoff
  stays strict), with pre-fix/fixed pipeline evidence in
  `docs/evidence/cron-phase-lock-20261012T163945Z.json`; session 3-63 added the repeatable read-only
  production probe, re-verified production and the live sources at 16:50-16:53 UTC, and added the
  multi-tick cron cadence test on a deterministic timeline; session 3-64 completed and verified the
  failed-attempt disclosure whose code session 3-63 saved just before its timeout — the failure stamps the
  offer's last successful observation row, the offline QA server can simulate it, and six browser checks
  plus one unit test cover the ranking, labels and footer; the 3-64 session also verified that the deployed
  production build serves the new `lastAttemptFailed` quote fields and UI labels (59/59 live browser
  checks against the production URL at 17:31 UTC).
- Next useful task for the loop: improve only Crema e Gusto coverage, shipping evidence, freshness and
  comparison quality. Candidates, in order: (a) observe the production cron ticks with the read-only
  probe (`npm run probe:production`) — no cron-tick run had been observed as of the 3-64 checks; the
  18:17Z tick should record a 0-observation run without moving `lastRefreshAt`, the 00:17Z tick should
  refresh all three vendors, and the **06:17Z tick on 2026-10-13** is the first place the 3-62 phase-lock
  fix is observable (it should save observations even though it lands seconds before the stored due
  time) — the 18:17:55.845Z tick was then observed at 19:24 UTC with 0 requests, exactly as predicted;
  (b) re-check whether Pucks or CoffeeMan starts publishing a rate for the currently unrankable
  offers (the 3-60 probe and the 16:50/17:22 UTC live checks found none; the 3-71 CoffeeMan cart batch
  resolved the single/4-pack distribution-center method and left the free-delivery rule open);
  (c) another bounded re-probe of the recorded blocked vendors at a later date for a fourth adapter. The
  2026-10-12 probes (14:25, 14:39-14:58, 15:19 and 15:35-15:41 UTC, the last via Zap and its
  FreshCafe/Brioso leads, plus the 3-63 17:05 UTC search-engine and 17:07 UTC direct-domain batches) found
  no viable new vendor, so candidate domains and their blockers stay recorded in docs/SOURCES.md instead
  of guessed. Adding another product line requires an explicit new
  owner instruction.
- Keep `npm run check:sources` green against live pages and re-run both `npm run qa:browser` modes after
  any UI change.

## Iteration 3-67 (completed in 3-68) — browser shipping quotes and the Canton Zürich UI

Browser research (immediate owner task) was completed with the real headless Chrome/ChromeDriver session kept alive by
`scripts/browser-research.mjs`. Anonymous carts were used only to read public shipping estimators; no order, payment,
login, account, street address or bot-challenge bypass was involved. Evidence matrix and screenshots:
`docs/evidence/browser-research/2026-10-12-vendor-shipping-quotes.json` plus four PNGs in the same directory.
Observed quotes (2026-10-12 18:07-18:19 UTC):

- **Pucks** (Tel Aviv / 6100000, `https://pucks.co.il/payment/request`): home delivery ₪30 for 1 × 250 g (₪30 → ₪60) and
  2 × 250 g (₪60 → ₪90); free above the published ₪100 item subtotal, so 4 × 250 g (₪120) is ₪120 delivered. The fee did
  not change for Eilat / 8800000. The estimator exposed home delivery only.
- **CoffeeMan 8 × 250 g (2 kg)**: the anonymous checkout quoted ₪20 home courier and ₪20 distribution-center delivery
  (₪240 → ₪260); self-pickup ₪0 with a required branch choice. No free-delivery threshold was displayed. The product page
  still publishes no courier price for the 8-pack and ₪25 for the single/4-pack panels (both re-read in the browser).
- **Coffee4U** (1 × 250 g ₪38): door-to-door courier ₪30 (₪68 delivered), Chiita Shops pickup point ₪15 (₪53), free
  self-pickup at the Tel Aviv shop (₪38). The pickup flow requires a city + spot from a 421-city list (Tel Aviv and Eilat
  present); the courier city list has 1,270 entries. The vendor page title tag still says "Lavazza Qualita Oro Beans 1 kg"
  while the body is the Crema e Gusto 250 g listing.
- **Tool limitation**: the available file-read tool rejects PNG input ("reading images is not supported"), so the saved
  screenshots could not be machine-inspected; every quote above is backed by captured rendered text/DOM excerpts. This is
  recorded in the evidence JSON instead of claiming an image review.

The evidenced rates are now integrated: `pucks/6` carries the ₪30 / free-over-₪100 checkout quote with its coverage
caveat, `coffeeman/6` carries the ₪20 two-kilogram-cart quote (`maxTotalGrams: 2000`, so larger carts stay unrankable
with the exact reason), and the quote engine refuses to stretch a cart quote beyond the observed cart size. All 95 unit
tests pass, including new tests for the quote limit and the changed fixture ranking (Pucks now wins at 500 g/1 kg/2 kg).

The shopping page was redesigned on the Canton Zürich design system: self-hosted Inter (`public/fonts/InterVariable.woff2`,
SIL OFL text alongside), Blau #0070B4 / Softblau #EDF5FA for the selected controls and the best known delivered offer,
neutral grey/black structure, green/red stock labels, amber uncertainty labels, tabular numerals, flat surfaces and a
responsive offer-card layout that keeps item subtotal, shipping service/charge and delivered total in one `.totals` row.
The wide comparison table was removed (the old 2289 px row inside a 1325 px container is gone), the hero is now
"Attention shoppers" with no trailing period, multipack labels read "8 × 250 g multipack (2000 g)", repeated pickup rows
were folded into each offer's conditions, and diagnostics moved into disclosures. Measured at 1440 px: delivered total at
x=906-1276 inside the viewport, best card top at 507 px, no horizontal overflow; at 390 px: no horizontal overflow and the
page is ~4413 px for five offers (previously ~5491 px).

## Iteration 3-68 — quotes re-verified, redesigned board regression-fixed and fully validated

**Immediate owner task (browser shipping quotes): complete and evidenced.** The 3-67 research was re-verified with a
fresh interactive-browser session on 2026-10-12 18:54-18:56 UTC: the Pucks product page added 2 × 250 g to a temporary
anonymous cart, the public estimator at `https://pucks.co.il/payment/request` was opened with only Tel Aviv / 6100000 in
the locality and postcode fields (name, phone, email, street and building were left empty), and the rendered summary read
`תשלום סכום ביניים 60 ₪ · משלוח 30 ₪ · סך הכל 90 ₪` with the single method `משלוח עד הבית 30 ₪` and
`משלוח חינם בהזמנה מעל 100 ₪`. Evidence: `docs/evidence/browser-research/2026-10-12-pucks-recheck.json` plus the
screenshot `pucks-recheck-2packs-20261012T1855Z.png`. The full 3-67 matrix (Pucks 1/2/4 packs and Eilat, CoffeeMan 8-pack
₪20 courier/₪20 distribution/₪0 pickup, Coffee4U ₪30 courier/₪15 pickup point/₪0 self-pickup) stays in
`2026-10-12-vendor-shipping-quotes.json`. No order, payment, login, account, street address or bot-challenge bypass was
involved and no cart/session identifiers were recorded. **Tool limitation:** the available file-read tool rejects PNG
input ("reading images is not supported"), so screenshots could not be machine-inspected; every amount is backed by the
rendered DOM text captured in the same session, with screenshots kept for a human reviewer.

**Three real defects in the redesigned board found and fixed:**

- The pickup-only section never rendered: `renderPickupSection` filtered on `shipping.mode === 'pickup'`, but the quote
  engine's pickup entries keep `mode: 'delivery'` and carry a top-level `pickup` field. It now renders every entry in
  `board.pickup`.
- Pickup rows showed the courier rate as "Shipping" (₪25) next to a "Not calculable" delivered total. They now show
  `Pickup fee: Free` (or the pickup amount) and `Delivered total: Not applicable — pickup only`.
- Ranked offers with a confirmed locality-restricted delivery area lost the old "Delivery area" condition in the
  redesign. Restored with locality labels (`Delivery area: only Tel Aviv–Yafo, Eilat`).

**`scripts/browser-qa.mjs` rewritten for the offer-card DOM** (the removed `table.compare`, `.best__vendor` and
`.best__total` selectors are gone). It now checks the best card's three decision values in one visible row, pack/quantity
labels (multipacks never read as a single 250 g pack), per-offer conditions and coverage caveats, `+₪ vs best` deltas, the
per-kilogram callout with its real multipack contents, variant separation and the unstated-variant card, retired-line
fallback, quantity/destination/keyboard/mobile behavior, pickup grouping, unknown-shipping text, terms/locality
restriction, interrupted refresh and failed attempts. A QA-only no-rate fixture (`withUnknownDemo`) keeps the
"Shipping not published / never counted as free" path browser-tested now that all three vendors carry rates, and a new
rendered-contrast walker asserts WCAG AA (no violations) with the focus outline in the official Blau `rgb(0, 112, 180)`.

**Verification runs (2026-10-12 UTC):**

- `npm run verify` — 95/95 tests and the `wrangler deploy --dry-run` bundle pass (the fresh workspace needed `npm ci`
  for the pinned wrangler 4.149.0).
- `npm run qa:browser` (offline fixtures) — **81/81** checks.
- `node scripts/browser-qa.mjs http://127.0.0.1:8789` against `wrangler dev` with live vendor data — **77/77** checks;
  the local scheduled trigger refreshed all three vendors (five observations). Both modes were re-run after the mobile
  copy/space compaction and stayed green (81/81 offline, 77/77 live).
- `npm run cron:offline` — full fixture pipeline OK; `npm run cron:local` — live vendors + Bank of Israel wrote five
  observations (Pucks ₪30, CoffeeMan ₪33/₪124/₪240, Coffee4U ₪38; USD 3.078 from the 2026-10-12 BOI table), and the
  immediate re-run skipped all three vendors with 0 requests under the six-hour backoff.
- `npm run probe:production` (read-only) — all checks pass; catalog exposes exactly the tracked product.
- Production read-only GETs: `/app.js` serves the redesigned code (`totals__cell`), `/fonts/InterVariable.woff2` answers
  200, and the hero has no trailing period. The production store still holds pre-research observations, so Pucks and the
  CoffeeMan 8-pack appear as unknown there until the next cron tick: the probe's vendor due times (pucks 19:34,
  coffee4u 19:46, coffeeman 21:51 UTC) are all before the 00:17 UTC tick, and public requests only trigger the
  one-time initial refresh, so that tick is the expected refresh point. This iteration does **not** claim the
  researched rates are live yet.
- `npm run check:sources` (live vendor pages, 19:01 UTC) — all three adapters pass with five observations and the
  researched rates: Pucks `pucks/6` ₪30 verified, CoffeeMan `coffeeman/6` ₪25/₪25/₪20 verified, Coffee4U ₪30 verified
  (`coffee4u/1`).
- Production layout measured read-only: 1440 px — no table, no horizontal overflow, delivered-total cell at x=906-1290
  (the owner-reported defect had it starting at x=1641); 390 px — no horizontal overflow, 44 px quantity taps, pickup rows
  grouped. Metrics and screenshots: `docs/evidence/visual-review/2026-10-12-production-layout.json`.
- Owner copy/space ask: the hero sub-copy was shortened to one factual line and the narrow-viewport spacing tightened,
  moving the best offer card from y=1029 to y=952 at 390 px (hero 174→132 px, controls 597→563 px) with no overflow; the
  hero itself was already compact and period-free.

**Docs:** `docs/DESIGN.md` rewritten to the Canton Zürich direction (tokens/roles, Inter + features, layout and offer-card
components, uncertainty semantics, measured contrast and keyboard/layout validation); `docs/SOURCES.md` now carries the
browser-researched shipping matrix and corrected Pucks / CoffeeMan-8-pack shipping certainty.

**Next steps:** (a) re-run `npm run probe:production` after the per-vendor due times to confirm the researched rates reach
production; (b) keep `npm run verify` and both `npm run qa:browser` modes green after any UI change; (c) further work stays
within Crema e Gusto vendor coverage, shipping evidence, freshness and comparison quality.

## Iteration 3-69 — fresh independent browser re-check of all three shipping flows

The immediate browser task was re-verified in a new live headless Chrome 154 + ChromeDriver 154 session
(`scripts/browser-research.mjs`, one session kept alive across steps, 2026-10-12 19:07-19:16 UTC) against
the real vendor sites. Temporary anonymous carts were used only to read public shipping estimators; no
order, payment, login, account, street address or bot-challenge bypass was involved, and cart/session
identifiers are not recorded. The amounts reproduce the 3-67/3-68 matrix:

- **Pucks**, Tel Aviv / 6100000, `https://pucks.co.il/payment/request`: 2 x 250 g (₪60 subtotal) ->
  `משלוח עד הבית 30 ₪`, total **₪90**; 4 x 250 g (₪120 subtotal, above the published ₪100 threshold) ->
  shipping `חינם` (free), total **₪120**. New nuance recorded: the summary total includes the ₪30 only
  after the delivery-method card is selected; before that the page prints `המשלוח מחושב בתשלום` with a
  ₪60 total, so the quote is conditional on the chosen method rather than automatic.
- **CoffeeMan 8 x 250 g (2 kg)**, anonymous `https://www.coffeeman.co.il/cart.asp`: the public method
  picker lists home courier ₪20, distribution-center delivery up to 5 kg ₪20 and self-pickup ₪0 (branch
  choice required); selecting the courier shows `משלוח ₪20.00 | ₪260.00` for the ₪240 cart. No
  free-delivery threshold is displayed. Still a 2 kg cart quote, not a nationwide rate.
- **Coffee4U 1 x 250 g**, anonymous `https://www.coffee4u.co.il/cart.asp`: door-to-door courier ₪30
  (1-5 business days) -> **₪68**; Chiita Shops pickup point ₪15 (up to 7 business days, up to 5 kg,
  pickup point must be chosen) -> **₪53**; self-pickup ₪0 showing `איסוף מקופי4יו, דרך שלמה 66 תל אביב`
  -> **₪38**. The vendor's title tag still says "Lavazza Qualita Oro Beans 1 kg" while the body and cart
  item are the Crema e Gusto 250 g listing. Coverage remains subject to the vendor's unpublished
  home-delivery locality list already recorded in docs/SOURCES.md.

Evidence: `docs/evidence/browser-research/2026-10-12-fresh-recheck-3-69.json` plus four viewport
screenshots in the same directory. **Tool limitation (unchanged, re-confirmed):** the available file-read
tool rejects PNG input ("reading images is not supported"), so the screenshots could not be
machine-inspected; every amount is backed by rendered visible text captured in the same live session.

Other verification this iteration:

- `npm ci --ignore-scripts` — clean install, 0 vulnerabilities; `npm run verify` — **95/95** tests and the
  `wrangler deploy --dry-run` bundle pass (83.49 KiB, gzip 21.58 KiB; bindings `BOARD` + `ASSETS`).
- `npm run qa:browser` — **81/81** offline checks pass against the fixture QA server.
- `npm run cron:offline` — the fixture pipeline runs again with **6 bounded requests**, all three vendors
  saved (CoffeeMan 3, Pucks 1, Coffee4U 1), five offers persisted and no failures.
- `npm run probe:production` (read-only, 19:13:57 UTC) — all checks pass; `/health`/`/api/status` still
  show the 15:52:12.546Z refresh and five pre-research observations, and the 18:17:55.845Z cron tick was
  recorded with 0 requests (expected: every vendor was inside its six-hour window). Vendor due times
  (pucks 19:34, coffee4u 19:46, coffeeman 21:51 UTC) are all before the 00:17 UTC tick, which remains the
  expected refresh point for the researched rates. This iteration does **not** claim the rates are live in
  production yet.

**Next step:** after the 00:17 UTC tick, re-run `npm run probe:production` to confirm the researched rates
reached the production store, then continue within Crema e Gusto coverage, shipping evidence, freshness
and comparison quality.

## Iteration 3-70 — conditional checkout-rate label, compact pickup rows, first production cron tick observed

**First production cron tick observed (read-only).** `npm run probe:production` at 19:24:19 UTC passed
**20/20** checks and the production run history now contains
`cron(0 req, 2026-10-12T18:17:55.845Z)` alongside the 15:52:12.546Z initial refresh. That is the first
independently observed firing of the `17 */6 * * *` trigger, and it behaved exactly as the 3-62/3-63
analysis predicted: the tick landed while every vendor was inside its six-hour window, made **0**
requests and did not advance `lastRefreshAt`. The stored observations are still the pre-research
15:52 rows (Pucks and the CoffeeMan 8-pack still unranked in production), so the **00:17 UTC tick** is
still the expected point where the researched rates reach the production store; the probe recorded the
vendor due times (pucks 19:34, coffee4u 19:46, coffeeman 21:51 UTC), all before that tick. Evidence:
`docs/evidence/production-probe-20261012T1924Z.json`.

**Cart-observed rates are no longer called published rates.** The quote engine gained a fourth shipping
certainty, `checkout_quote`, rendered as **Checkout rate (observed, conditional)**. The two
browser-researched estimator rates (Pucks ₪30 with the ₪100 free-shipping threshold, CoffeeMan 8-pack
₪20 with `maxTotalGrams: 2000`) now use it, while product-page rates (CoffeeMan ₪25, Coffee4U ₪30/₪15)
keep `verified` / **Published rate (verified)**. The unrankable-offer card now shows the
"Shipping not published" explanation only when the rate is genuinely unknown or absent, so a cart quote
that is merely out of scope for the selected quantity keeps its own exact reason. One label test, one
quote test, the parser/QA-server assertions, the browser QA Pucks expectation and the worker API
assertion were updated; `docs/DESIGN.md` and `docs/SOURCES.md` document the distinction.

**Pickup rows compacted and the mobile first screen tightened.** The three pickup-only offers were
three near-identical three-cell cards (~400-420 px each at 390 px) with the same note repeated per card.
They are now one compact row each (vendor, pack/quantity, item subtotal, pickup fee, written "Delivered
total: Not applicable") with the repeated terms behind a `Pickup terms` disclosure. In the same pass the
removed hero sub-copy, the shortened ranked-section intro and the one-row quantity control brought the
best offer card onto the mobile first screen: rendered fixture page **5627 → 4996 px** content
(scrollHeight 5237 → 5133), pickup rows **401/420/421 → 199/218/218 px**, mobile best card top
**952 → 829 px** inside a 844 px screen, desktop best card top **484 → 452 px**, hero **132 → 59 px**
mobile / **~132 → 97 px** desktop, quantity control **94 → 44 px** with the five buttons on one row and
the 44 px tap height preserved. The pickup section is still present, still out of the delivered ranking
and still names the fee and the missing delivered total.

**Visual review with a new dependency-free inspector.** The coding agent's file-read tool still rejects
PNG input, so `scripts/inspect-screenshot.mjs` was added: it decodes a PNG with `node:zlib`, prints a
coarse luminance character map and reports pixel counts/bounding boxes for the Canton Zürich design
tokens. Used on before/after full-height screenshots (1440 px and 390 px) it confirmed: soft-blue confined
to the best-offer panel, blue to rules/selected control/best tag/delivered-total value, green to in-stock
labels, amber to uncertainty, no red (no unavailable offer in the fixture board), no horizontal overflow,
the three decision cells in one row ending at x=1290 inside 1440 px, the compacted pickup section and the
best card inside both first screens. Small text is not legible in the character map, so every
amount/label claim remains backed by rendered DOM text and the API; the QA harness separately asserts
WCAG AA rendered contrast. Evidence:
`docs/evidence/visual-review/2026-10-12-revised-layout-review.json` plus before/after screenshots.

**Verification runs (2026-10-12 UTC):**

- `npm ci --ignore-scripts` — clean install from the pinned lockfile, 0 vulnerabilities.
- `npm run verify` — **98/98** `node:test` cases pass (95 task tests plus three smoke tests for the new
  `scripts/inspect-screenshot.mjs` review tool); `wrangler deploy --dry-run` builds the bundle
  (83.90 KiB, gzip 21.73 KiB; bindings `BOARD` + `ASSETS`).
- `npm run qa:browser` — **81/81** offline checks pass against the fixture QA server.
- `npm run qa:browser -- http://127.0.0.1:8789` — **77/77** live checks pass against a fresh-store
  `wrangler dev` Worker with real vendor data and the new label/pickup markup, zero console errors.
- Fresh-store `wrangler dev` initial refresh (19:35:29.524Z → 19:35:47.099Z): **6 bounded requests**,
  all three vendors saved (CoffeeMan 3, Pucks 1, Coffee4U 1), five observations, Bank of Israel table;
  the live board ranks Pucks **₪90** at 500 g, **₪120** at 1 kg and **₪240** at 2 kg, with the
  CoffeeMan 8-pack at ₪260 and the Coffee4U unstated variant at ₪106. Evidence:
  `docs/evidence/worker-runtime-status-2026-10-12T1941Z.json`.
- `npm run check:sources` (live, 19:27 UTC) — all five listings pass with the researched rates:
  Pucks ₪30 `checkout_quote`, CoffeeMan ₪25/₪25/₪20 (`verified`/`verified`/`checkout_quote`),
  Coffee4U ₪30 `verified`. Evidence: `docs/evidence/source-check-20261012T1927Z.json`.

**Docs:** `docs/SOURCES.md` now states the `verified` vs `checkout_quote` distinction for the researched
rates and points to the new screenshot inspector; `docs/DESIGN.md` documents the conditional checkout-rate
label and the compact pickup rows; this file records the first observed production cron tick.

**Next step:** after the 00:17 UTC tick, re-run `npm run probe:production` to confirm the researched
rates (and the new labels once this commit is deployed) reach the production store; then continue within
Crema e Gusto coverage, shipping evidence, freshness and comparison quality.

## Iteration 3-71 — CoffeeMan single/4-pack cart delivery methods resolved in a fresh browser session

**Browser research (immediate owner task, continued).** A fresh live headless Chrome 154 + ChromeDriver
154 session (`scripts/browser-research.mjs`) built temporary anonymous CoffeeMan carts on 2026-10-12
19:56-20:09 UTC and read the public checkout method picker. No order, payment, login, account, street
address or bot-challenge bypass was involved, and cart/session identifiers are not recorded. The batch
resolves what the 18:16 UTC research had left open for the single and 4-pack listings:

- **2 × 250 g (500 g, ₪66)** and **4 × 250 g (1 kg, ₪132)**: ₪25 home courier (matching the published
  page rate) and **₪15 distribution-center delivery up to 5 kg** — a method the product page lists
  without a price. The **1 × 4-pack (1 kg, ₪124)** cart quoted the same ₪25/₪15.
- **Free-delivery behavior (not published)**: the distribution-center fee became free at a ₪198
  (6 × 250 g) cart and the courier at ₪231 (7 × 250 g); a 2 kg two-4-pack cart (₪248) was free too.
  But the **8-pack SKU cart (₪240) was charged ₪20/₪20 again** in a fresh cart at 20:07 UTC, so free
  delivery is cart/product dependent and is **not a published single threshold** — the board keeps the
  published ₪25 ranked rate and never assumes free shipping.
- **Coverage blocker**: the method picker displays both priced methods and self-pickup without asking
  for a locality, city or postcode, so the public flow cannot confirm or exclude any locality before
  personal order details. The recorded terms-page caveat (home delivery subject to Amigo's unpublished
  locality list) remains the only coverage evidence; testing a specific destination would require
  personal delivery details, which this research does not do.

Evidence: `docs/evidence/browser-research/2026-10-12-coffeeman-cart-single-4pack.json` plus the
`coffeeman-8pack-cart-recheck-20261012T2008Z.png` and `coffeeman-4pack-cart-20261012T2009Z.png`
screenshots. **Tool limitation (unchanged):** the file-read tool rejects PNG input, so screenshots could
not be machine-inspected; every amount is backed by rendered visible text captured in the same session.

**Integrated:** `coffeeman/6` now stores the cart-observed ₪15 distribution-center alternative for the
single and 4-pack offers (₪20 for the 8-pack cart) with its cart condition in the label and the full
observation in the note; the ranked rate stays the published ₪25. The offer disclosure now renders the
adapter shipping terms (`Shipping terms: …`), so the cart observations and the free-delivery caveat are
accessible without putting them on the card face.

**Verification (2026-10-12 UTC):**

- `npm run verify` — **99/99** `node:test` cases pass (one new parser test for the alternatives and the
  unchanged ranked rate); `wrangler deploy --dry-run` builds the bundle (86.31 KiB, gzip 22.20 KiB;
  bindings `BOARD` + `ASSETS`).
- `npm run qa:browser` — **82/82** offline checks pass, including a new check that every offer's adapter
  shipping terms stay accessible in its disclosure. The fixture board renders the distribution-center
  alternative on the CoffeeMan single/4-pack/8-pack cards with its cart condition
  (`Distribution-center delivery up to 5 kg (cart-observed for 0.5–1 kg carts): ₪15.00`).
- `npm run qa:browser -- http://127.0.0.1:8789` — **78/78** live checks pass against a fresh-store
  `wrangler dev` Worker with real vendor data, zero console errors. The fresh store's first `/health`
  started the documented initial refresh (20:13:39.288Z → 20:13:59.647Z): **6 bounded requests**, all
  three vendors saved (CoffeeMan 3, Pucks 1, Coffee4U 1), five observations; the live board ranks Pucks
  ₪90 at 500 g, ₪120 at 1 kg and ₪240 at 2 kg, and the CoffeeMan cards expose the ₪15/₪15/₪20
  distribution-center alternatives. Evidence:
  `docs/evidence/worker-runtime-status-2026-10-12T2016Z.json`,
  `docs/evidence/browser-qa-fixtures-20261012T2017Z.json`,
  `docs/evidence/browser-qa-live-20261012T2015Z.json`.
- `npm run cron:offline` — 6 bounded requests, five offers persisted, `pruned: 0`.
- `npm run check:sources` (live, 20:14-20:15 UTC) — all five listings pass; the CoffeeMan single and
  8-pack observations carry the new distribution-center alternatives with their cart conditions and the
  free-shipping caveat in the note. Evidence: `docs/evidence/source-check-20261012T2014Z.json`.
- The production read-only probe at 19:53 UTC passed all checks against the persisted 15:52:12.546Z
  store (5 observations, ₪91.00/₪149.00/₪106.00 boards, retired-URL fallback, the 18:17:55.845Z
  0-request cron run); production still serves the pre-research observations, so the researched rates
  and this build reach the store at the 00:17 UTC tick.
- The deployed `public/app.js`/`style.css` already contain the 3-70 compact pickup-row markup
  (`pickup-row__facts`, `Pickup terms`), so the 3-70 build reached Workers Builds; the 3-71 additions are
  on main and deploy the same way.

**Docs:** `docs/SOURCES.md` gains the single/4-pack cart rows, the cart-dependent free-delivery finding
and the updated 8-pack re-check; this file records the verification counts and the remaining production
check.

**Next step:** after the 00:17 UTC tick, re-run `npm run probe:production` to confirm the researched
rates and this build reach the production store; then continue within Crema e Gusto coverage, shipping
evidence, freshness and comparison quality. One open question for a later session: decide whether the
cart-dependent free-delivery observations should become a structured condition (the rule is not
published, so no threshold is invented now).

## Iteration 3-75 — blend/variant feature removed; one unified Crema e Gusto comparison verified

**Owner correction implemented (2026-10-12): "Get rid of the coffee variant."** The tracked Crema e Gusto
listings are one coffee comparison, not shopper-selectable blends. The selector, unobserved-variant menu
entries, variant warnings, "other variant" counts/links and variant-as-shopping-configuration are gone
from the home page, the product page, the Worker API and the offline QA harness:

- `src/catalog.js` no longer exports `VARIANTS`, `variantById()`, `resolveVariantId()` or
  `variantCatalog()`, and the tracked product no longer carries `defaultVariant`/`variants`. Raw blend
  wording is still detected per listing (`STATED_VARIANTS`, `variantOf()`) and stored as
  `variantId`/`variantLabel` for provenance only. An unstated listing is never relabelled Classico.
- `src/lib/quote.js` compares every eligible ground listing; the `variantId` parameter, the exclusion
  count and the variant list were removed from `quoteBoard()`. `src/index.js` ignores the obsolete
  `?variant=` parameter and `/api/catalog` exposes no variant menu; `scripts/qa-server.mjs` mirrors it.
- `public/product.html`/`product.js` have no blend control; the obsolete `variant=` parameter is stripped
  from the address bar while product/quantity/locality are preserved, and the home card forwards only
  product/grams/dest. Raw vendor listing wording (`Vendor listing name`) and stated blend wording now
  appear only inside `Offer details and check history` (for example the Pucks listing shows
  `Vendor listing name: lavazza crema e gusto classico-250 גרם קפה טחון` and `Stated blend wording:
  Classico`); the Coffee4U offer shows its name without any blend badge.
- `AGENTS.md`, `README.md`, `docs/DESIGN.md`, `docs/ARCHITECTURE.md` and `docs/SOURCES.md` now state the
  unified comparison and the evidence-only role of raw blend wording; browser QA was rewritten for it.

**Verified locally (2026-10-12 UTC):**

- `npm ci --ignore-scripts` — clean install from the pinned lockfile, 0 vulnerabilities.
- `npm run verify` — **124/124** `node:test` cases pass; `wrangler deploy --dry-run` builds the bundle
  (98.13 KiB, gzip 25.43 KiB; bindings `BOARD` + `ASSETS`). New/updated tests cover the unified
  comparison of stated and unstated listings, the absence of `variantId`/`excludedByVariant` in the API,
  and inert `variant=nope|constructor|unspecified|forte` parameters.
- Fresh-store `wrangler dev` initial refresh (21:45:32.407Z → 21:45:52.404Z): **6 bounded requests**, all
  three vendors saved (CoffeeMan 3, Pucks 1, Coffee4U 1), five observations, Bank of Israel table.
  `/api/board?grams=500&dest=tel-aviv` ranks **Pucks ₪90** (2 × ₪30 + ₪30), **CoffeeMan ₪91**
  (2 × ₪33 + ₪25), **Coffee4U ₪106** (2 × ₪38 + ₪30), then the CoffeeMan 4-pack ₪149 and 8-pack ₪260;
  the Coffee4U quote carries its raw `variantLabel: "Variant not stated"` as provenance while ranking in
  the same board. The same request with `&variant=unspecified` or `&variant=classico` returns an
  identical ranking, and no response carries `variantId` or `excludedByVariant`.
  Evidence: `docs/evidence/worker-runtime-status-2026-10-12T2151Z.json`.
- `npm run qa:browser` (offline fixtures) — **78/78** checks pass: home card says "one comparison for all
  tracked listings", the product page has zero variant controls and no "blend variant"/"another variant"
  text, the Coffee4U listing appears in `Compare other offers` with its ₪15 pickup-point alternative and
  free self-pickup, and an old `?variant=unspecified` URL is cleaned to `?grams=250&dest=tel-aviv` with
  the unified winner. Evidence: `docs/evidence/browser-qa-fixtures-20261012T2154Z.json`.
- `npm run qa:browser -- http://127.0.0.1:8789` (live Worker, real vendor data) — **76/76** checks pass
  with zero console errors, including the legacy-URL, retired-line fallback, shareable-URL, mobile
  first-viewport money values, disclosure open/close, named-vendor and unknown-shipping checks.
  Evidence: `docs/evidence/browser-qa-live-20261012T2150Z.json`.
- `npm run cron:offline` — 6 bounded requests, five offers persisted, `pruned: 0`.
- `npm run check:sources` (live, 21:47 UTC) — all five listings pass with unchanged prices: CoffeeMan
  ₪33/₪124/₪240, Pucks ₪30, Coffee4U ₪38, with the recorded rates and coverage caveats. Evidence:
  `docs/evidence/source-check-20261012T2147Z.json`.
- Screenshot review limitation (unchanged): the coding agent's file-read tool rejects PNG input, so the
  saved screenshots were reviewed with `scripts/inspect-screenshot.mjs` character/pixel maps only — those
  cannot establish that text is correct or legible. Token-region output (blue/soft-blue/green/amber,
  no red on the ranked fixture board) and all labels/amounts are corroborated by rendered DOM text and the
  API in the same session; the review record is
  `docs/evidence/visual-review/2026-10-12-variant-removal-review.json`.

- Production read-only probe (21:49 and 21:52 UTC, public HTTPS GETs, no credentials): **20/20 and
  22/22** checks pass. The production build is already the unified-comparison build: `/api/board` has no
  `variantId`/`excludedByVariant`, `?variant=unspecified` returns the same ranking with Coffee4U in it,
  `/api/catalog` carries the unified notes and no variant menu, the served `product.js` strips the
  obsolete parameter, the served `home.js` says "one comparison for all tracked listings", and the
  directly loaded product page has zero `variant` occurrences. The production store is still the
  15:52:12.546Z snapshot, so the ₪90 Pucks 500 g quote comes from read-time policy enrichment of the old
  persisted unknown-shipping row — the old-store gap fix working in production. Evidence:
  `docs/evidence/production-probe-20261012T2149Z.json`,
  `docs/evidence/production-probe-20261012T2152Z.json`,
  `docs/evidence/production-build-marker-20261012T2152Z.json`.

**Production browser QA found and fixed one real defect.** `npm run qa:browser --
https://attention-shoppers.igormaka.workers.dev` passed 72/76 checks: the two failures that were not
data-state differences showed that the read-time policy enrichment attached the researched Pucks ₪30
rule and threshold but **dropped the policy's coverage caveat** for an old persisted row that already
carried a generic `destination: {scope: 'country', country: 'IL'}`. The card then showed only the
conditional-cart qualifier and no coverage caveat, which could read as unconditional country-wide
delivery. `enrichObservationShipping()` now keeps the row's own destination scope and adds the policy
caveat when the row has none (`src/lib/policies.js`), with a regression assertion in
`tests/policy.test.js` that the enriched row exposes `shipping.coverageCaveat` and a
`Delivery coverage caveat` label. `npm run verify` stays **124/124** with the build at 98.42 KiB
(gzip 25.48 KiB); the offline QA stays **78/78** and the fresh-store local-live QA stays **76/76**.
The fix is committed and deploys through the normal main-push path; production will carry the caveat
again on the next build. The other two production-QA failures were honest data-state differences (the
pre-refresh store has no ranked multipack, and its Pucks row had no caveat yet), so the multipack
check is now derived from the API and skips when no multipack is ranked. After the fix deployed, a
re-run of `npm run qa:browser -- https://attention-shoppers.igormaka.workers.dev` passed **76/76**
checks against the live production site with zero console errors (evidence
`docs/evidence/browser-qa-production-20261012T2200Z.json`), and a read-only GET confirmed the old
persisted Pucks row now returns `shipping.coverageCaveat` plus the `Delivery coverage caveat` label
while keeping its 13:34 UTC observation time. Sanitized viewport screenshots are saved under
`docs/evidence/visual-review/production-*-20261012T2200Z.png`; the coding agent's file-read tool still
rejects PNG input, so they were reviewed with coarse token/pixel maps only, and all labels/amounts are
corroborated by rendered DOM text and the API in the same session.

**Next step:** the variant removal is already confirmed live in production (probes above). The remaining
production check is the **00:17 UTC cron tick**, which should refresh the store itself so the researched
observations replace the 15:52 snapshot (the read-time policy enrichment already covers Pucks; the
CoffeeMan 8-pack cart rate is not a shared policy, so its old row stays unrankable until then). Re-run
`npm run probe:production` after that tick, then continue within Crema e Gusto coverage, shipping
evidence, freshness and comparison quality.
