# Project status

Stage: **Crema e Gusto scope enforced and verified locally; production refresh awaiting owner evidence.**
The Worker implements the self-updating board for exactly one product line — **Lavazza Crema e Gusto
vacuum-packed ground coffee** — with three independent Israeli vendor adapters and five observed
listings. The owner reports the site deployed at
**https://attention-shoppers.igormaka.workers.dev** with Worker name `attention-shoppers` and main-push
auto-deploy through Cloudflare Workers Builds. That is an owner report: the coding loop has no Cloudflare
credentials and has **not** independently verified a production refresh. Outstanding production checks
are listed below.

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
- **Self-updating runtime**: `wrangler.jsonc` triggers `17 */6 * * *` (about every six hours); the first
  `/health` or `/api/board` after deployment starts one throttled initial refresh. Observations, vendor
  state, FX rates, run history and leases persist in the SQLite-backed `BoardStore` Durable Object. The
  board API and footer report board-level fresh/stale freshness and warn in plain language when no
  completed refresh is recent. A run that fetched nothing because every vendor is inside its backoff
  window is recorded in the run history but does **not** update `lastRefreshAt`, so an empty run cannot
  mask a stalled pipeline as fresh.
- **Bounded fetching**: host allowlists per adapter, 12 s timeout, 1.5 MB response cap, max two vendors
  in flight, one attempt per offer per run, published crawl delays honoured (`Crawl-delay: 7` on
  CoffeeMan and Coffee4U), 30 min→12 h backoff per vendor. Public routes never fetch a visitor-supplied
  URL and never start unbounded scraping. Responses are cacheable
  (`public, max-age=300, stale-while-revalidate=3600`).
- **No LLM or paid scraper in the public runtime**: only deterministic adapters, official Bank of Israel
  rates and native Cloudflare storage.

## Live observations (recorded evidence)

Retrieved 2026-10-12 14:15 UTC with `npm run check:sources` (bounded fetcher + production parsers) and
stored under `.shurik-local/sources/`; review copy in
`docs/evidence/source-check-2026-10-12T1415Z.json`. Full source record: docs/SOURCES.md. Exactly five
listings are active; no retired line is fetched.

| Vendor | Listing | Price | Stock | Shipping | Certainty |
| --- | --- | --- | --- | --- | --- |
| CoffeeMan (IL) | Crema e Gusto Classico 250 g ground, SKU 930333 | ₪33 (regular ₪36) | in stock (schema.org microdata) | ₪25 courier; free self-pickup | verified |
| CoffeeMan (IL) | Crema e Gusto Classico 4 × 250 g ground, SKU 930334 | ₪124.00 | in stock | ₪25 courier; free self-pickup | verified |
| CoffeeMan (IL) | Crema e Gusto Classico 8 × 250 g ground, SKU 930335 | ₪240.00 | in stock | courier price not published | unknown (unranked) |
| Pucks (IL) | Crema e Gusto Classico 250 g ground, SKU Lav69, GTIN 8000070038769 | ₪30.00 | in stock (JSON-LD) | calculated at checkout | unknown (unranked) |
| Coffee4U (IL) | Crema e gusto 250 g ground, SKU 2010561, variant not stated | ₪38.00 | in stock (schema.org microdata) | ₪30 door-to-door courier; ₪15 pickup-point alternative; free self-pickup | verified |

Observed board results on the local Worker after the fresh scheduled refresh (14:18 UTC):

- **Crema e Gusto, 500 g to Tel Aviv**: best delivered total **₪91.00** = 2 × ₪33 + ₪25 shipping for
  CoffeeMan single packs (₪182.00/kg); the 4-pack is ranked second at ₪149.00. The Pucks ₪30 item and
  the 8-pack stay visible and unranked because shipping is not published before checkout / not published
  at all, so neither is treated as free. Three pickup rows are shown separately.
- **Crema e Gusto, 1 kg to Tel Aviv**: the 4-pack wins at **₪149.00** against ₪157.00 for four single
  packs, so the best choice changes with the shopper's quantity using only observed prices.
- **Variant not stated, 250 g to Tel Aviv**: the Coffee4U offer ranks at **₪68.00** (₪272.00/kg) with
  the ₪15 pickup-point delivery shown as a labelled alternative service; it is never merged into the
  Classico ranking.
- **Retired query URL** `?product=lavazza-qualita-oro-vacuum-ground`: the API falls back to Crema e
  Gusto, returns `requestedRetiredProduct: {id, line: "Qualità Oro"}`, and the page shows the retired-line
  notice plus the normal ₪91.00 Crema e Gusto board. No retired offer appears anywhere in the payload.
- **FX**: the 14:15 `cron:local` pipeline and the 14:18 Worker refresh fetched the official Bank of
  Israel table dated 2026-10-12 (USD 3.078, asOf 12:23:04Z). The 14:15 UTC adapter check does not fetch FX.

## Verification performed (2026-10-12, all local)

1. `npm ci --ignore-scripts` — clean install from the pinned lockfile, 0 vulnerabilities.
2. `npm run verify` — **69/69** `node:test` cases pass, then `wrangler deploy --dry-run` builds the
   Worker bundle with no Cloudflare credential (71.93 KiB, gzip 18.53 KiB; bindings `BOARD` + `ASSETS`).
   Covered acceptance cases include: shipping changes the winner; unknown shipping cannot win;
   stale/out-of-stock/unknown availability stay unranked; variants and multipacks stay separate;
   quantity rounding, minimum order and free-shipping thresholds; missing FX is not zero; destination
   coverage; pickup separated; shipping alternatives are converted but never replace the ranked amount;
   the variant filter reports excluded offers; a zero-request backoff run does not claim freshness;
   leases; backoff; allowlist; crawl-delay pacing; retired fixtures are refused by both adapters;
   retired ids fall back with an explicit reason; the catalog exposes exactly one product; a retired
   `?product=` URL falls back to Crema e Gusto and never mixes a retired observation into the board;
   retired observations and attempt markers are pruned from the store; retired product URLs have no
   fixture route, so the offline tools cannot serve them; the fixture-backed QA server
   keeps the browser harness aligned with the production quote engine.
3. `npm run check:sources` (live, 14:15 UTC) — CoffeeMan (three listings), Pucks (one) and Coffee4U
   (one) PASS against the real pages: ₪33 / ₪124 / ₪240 / ₪30 / ₪38, all five observed **in stock**.
   Verified ₪25 courier shipping on the CoffeeMan single and 4-pack pages, unknown shipping on the
   8-pack page and the Pucks page, and ₪30 door-to-door plus a ₪15 pickup-point alternative on the
   Coffee4U page. Review copy: `docs/evidence/source-check-2026-10-12T1415Z.json`.
4. `npm run cron:offline` — full refresh pipeline against the recorded fixtures: **6 bounded requests**,
   five offers persisted (CoffeeMan 3, Pucks 1, Coffee4U 1) and the fixture FX table.
   `tests/simulate-cron.test.js` runs it twice in a temporary directory with identical results and
   asserts 6 requests, no backoff skips, five fresh offers and an FX reference rate, so the
   repeatability cannot regress. Offline runs use their own state file
   (`.shurik-local/board-offline.json`, reset per run) and never consume the live schedule.
5. `npm run cron:local -- --fresh` (live CLI pipeline, file-backed store, 14:15 UTC): **6 bounded
   requests**, all three vendors saved (CoffeeMan 3, Pucks 1, Coffee4U 1), **five live offers**
   persisted, `pruned: 0`, and the Bank of Israel table dated 2026-10-12 fetched (USD 3.078).
6. Local Worker runtime (`npx wrangler dev --port 8789`, fresh SQLite Durable Object, no browser
   opened): the scheduled handler was triggered only through the documented local endpoint
   (`curl http://127.0.0.1:8789/cdn-cgi/local/scheduled`). Run 1 started 14:18:20.727 UTC, finished
   14:18:39.094 UTC — **6 bounded requests**, all three vendors saved, **five observations persisted**,
   the Bank of Israel table fetched and `nextAttemptAt` +6 h. `/api/board` then served the results above.
   Run 2 at 14:18:40.112 UTC correctly made **0 requests** because every vendor was inside its six-hour
   window, and `lastRefreshAt` stayed at run 1's value (this is the new empty-run behavior). Both runs
   are in the persisted run history. This is the refresh-while-no-browser-open path. Evidence:
   `docs/evidence/worker-runtime-status-2026-10-12T1418Z.json`.
7. `npm run qa:browser` — headless Chrome (chromedriver 154) QA, **45/45 checks pass offline, exit 0**,
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
   Crema e Gusto ranking, and no Rossa/Suerte content. Seven extra checks run against a second fixture
   server with one clearly labelled QA-only demo offer to verify minimum order, free-shipping threshold,
   free-shipping-met labelling and a locality delivery restriction, plus one check that a board whose
   scheduled refresh stopped for 30 hours is labelled in the footer. Evidence:
   `docs/evidence/browser-qa-fixtures-2026-10-12T1420Z.json`.
8. `npm run qa:browser -- http://127.0.0.1:8789` — live mode passed **43/43** against the local
   `wrangler dev` Worker at 14:19 UTC with the real persisted observations, including the retired-URL
   notice and the unstated-variant ranking (the two fixture-only checks are skipped in live mode).
   Evidence: `docs/evidence/browser-qa-live-2026-10-12T1419Z.json`.

## Owner-reported deployment vs independently verified

| Item | Status |
| --- | --- |
| Worker name in `wrangler.jsonc` | `attention-shoppers` (aligned with the owner correction) |
| Production URL reported by owner | https://attention-shoppers.igormaka.workers.dev — **owner report, not independently verified by the loop** |
| Production refresh / cron evidence | **Not verified from this runner.** The loop has no Cloudflare credentials and does not call the production URL. |
| Main-push auto-deploy | Owner reports Workers Builds connected; a later push still needs the owner's confirmation that a build ran. |
| Local refresh-while-no-browser-open | Verified locally through `wrangler dev` + the documented scheduled trigger (item 6 above). |
| No Cloudflare administration | Maintained: no CF API calls, deploys, logins or token discovery in this repository or its history. |

Outstanding production checks for the owner: `/health` should report a non-null `lastRefreshAt`;
`/api/catalog` should list exactly one product; the board should show the five Crema e Gusto offers;
the 6-hour cron trigger should appear in the Cloudflare dashboard; one later main push should be seen by
Workers Builds. Report any Cloudflare error back to the loop without pasting credentials.

## Committed evidence snapshots

Current-scope evidence (committed for review, not live data):

- `docs/evidence/source-check-2026-10-12T1415Z.json` — live adapter observations for the five active
  Crema e Gusto offers (14:15 UTC), the evidence behind the table above.
- `docs/evidence/worker-runtime-status-2026-10-12T1418Z.json` — `/health`, `/api/status`, `/api/catalog`,
  the 500 g / 1 kg / unstated-variant boards and the retired-URL fallback from the local Worker after a
  scheduled-handler run on a fresh Durable Object store: one 6-request run, five observations, fresh,
  `nextAttemptAt` +6 h, then a 0-request run that did not change `lastRefreshAt`.
- `docs/evidence/browser-qa-fixtures-2026-10-12T1420Z.json` — 45 offline browser checks, including the
  single-product catalog, static product label, retired-URL notice, unstated-variant ranking and the
  stale-refresh footer warning.
- `docs/evidence/browser-qa-live-2026-10-12T1419Z.json` — 43 live browser checks against a local
  `wrangler dev` Worker with real observations.
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

Current iteration (3-57): finished the owner correction that checkpoint 3-56 began. Tests, UI, browser QA
and docs were narrowed to the single Crema e Gusto scope; retired fixtures became negative inputs;
`pruneRetiredObservations()` is covered by a unit test; the board shows a retired-line notice for old
product URLs; a zero-request backoff run no longer updates `lastRefreshAt`; the full local chain (verify,
live source check, offline and live cron, scheduled handler through `wrangler dev`, both browser QA
modes) was re-run and recorded above.

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

1. Confirm the reported production deployment answers `/health` with a non-null `lastRefreshAt`,
   `/api/catalog` lists exactly one product, and the board shows the five Crema e Gusto offers.
2. Confirm the 6-hour cron trigger is listed and that one later main push is picked up by Workers Builds.
3. If anything fails, report the Cloudflare error back to the loop; do not paste credentials.

## Loop notes

- Model/provider: opencode-go / deepseek-v4.1-flash at max reasoning (owner-authorized). Sessions 3-54,
  3-55 and 3-56 ended in timeout/interruption/model error; their committed checkpoints are preserved and
  the owner correction survived them. This session (3-57) completed the correction locally.
- Next useful task for the loop: improve only Crema e Gusto coverage, shipping evidence, freshness and
  comparison quality. A fourth vendor carrying this product is the main candidate; the 2026-10-12 probes
  found no viable new one, so candidate domains and their blockers stay recorded in docs/SOURCES.md
  instead of guessed. Resolving Pucks shipping if the vendor starts publishing rates is another
  candidate. Adding another product line requires an explicit new owner instruction.
- Keep `npm run check:sources` green against live pages and re-run both `npm run qa:browser` modes after
  any UI change.
