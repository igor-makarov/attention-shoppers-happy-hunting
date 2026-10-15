# Architecture and authority

There are two independent loops:

1. Shurik on GitHub Actions develops and checkpoints source to main. It uses only OPENCODE_API_KEY and the repository GITHUB_TOKEN. Its state/history is public on shurik-control/main.
2. The deployed Worker refreshes vendor observations using deterministic scheduled adapters, persists them through runtime bindings and serves the public comparison board. It does not need Shurik or an LLM to keep refreshing.

Cloudflare Workers Builds is reported connected by the owner and is serving the production Worker; it observes main pushes and performs validation before deploying. The loop independently verified the public deployment once on 2026-10-12 with read-only GETs (docs/evidence/production-verification-20261012T1554Z.json). No CF deployment workflow or CF API secret belongs in GitHub. Exclude shurik-control/* and all other branches from Cloudflare builds and previews.

This prevents Shurik's Actions process from directly authenticating to CF. It is not a sandbox for agent-authored code: Shurik writes main, so its code and configuration can influence the CF build and live Worker. CF build commands can run source-controlled code in a credentialed environment. Restrict the CF build token to this Worker and the minimum required permissions; avoid broad account permissions or unrelated build/runtime secrets. Prefer runtime bindings over administrative API tokens. Never give the public Worker an administrative CF token.

GitHub normally does not trigger another push workflow for a push using GITHUB_TOKEN. Do not rely on CI being automatically triggered by every Shurik checkpoint. Shurik must run local verification, and Cloudflare's build command must run npm run verify for every deployment. After connecting CF, verify one actual Shurik push reaches Workers Builds; never assume third-party webhook behavior from GitHub Actions behavior alone.

## Implemented runtime

The tracked scope is two products (owner instruction, 2026-10-15): `src/catalog.js` holds Tnuva 5% plain cottage cheese in 250 g tubs alongside Lavazza Crema e Gusto. Each product declares its quantity controls; the cheese uses exact unit batches `[4, 6, 8, 10]`, while coffee keeps weight controls. `/api/board?product=tnuva-cottage-cheese-5-percent&quantity=6&dest=tel-aviv` returns the selected batch and `batchComparisons` for all four sizes from the same snapshot/time. Equivalent legacy gram links normalize to tubs; unsupported counts use the four-tub default. The dairy comparison excludes self-pickup, respects purchase caps and minimum orders, and refuses multipacks that would overbuy an exact batch. Home-card vendor counts and board freshness are scoped to their product. The cheese currently has no observed offers or grocery adapter, so all batch totals remain null with an explicit pending-evidence note; the coffee refresh does not claim to check cheese. Public listing leads are separate from observations.

The implemented live adapters cover Lavazza Crema e Gusto (a ground vacuum
brick) with strict classification rules. The 2026-10-12 owner correction retired
Qualità Oro, Qualità Rossa and Suerte; their ids remain as tombstones so `classifyListing` and
`resolveProductRequest` reject or explain them instead of reviving them, and each refresh prunes any
stored observation or attempt marker that belongs to a retired line. Vendor-specific adapters under `src/vendors/` (CoffeeMan, Pucks, Coffee4U)
fetch fixed allowlisted product URLs through the bounded fetcher in `src/lib/http.js` and return versioned
observations. `src/lib/quote.js` is a pure, timestamp-aware ranking engine; `src/lib/fx.js` converts
non-ILS amounts with Bank of Israel reference rates and refuses to guess when a rate is missing. It
compares every eligible tracked listing — including one that states no blend wording — in one board and
passes every published shipping
alternative (for example a cheaper pickup-point delivery) through to the UI without using it as the ranked
amount. A vendor that publishes a courier rate but makes home delivery subject to an unpublished locality
list keeps a structured coverage caveat, so the board discloses the geographic restriction instead of
claiming unconditional country-wide delivery; availability and shipping evidence are stamped with the
retrieval time of the page they came from. Each refresh also keeps one step of comparison evidence — the
previous successful price, stock and pack weight of the same offer — so the board can show the unit-price
change since the last check in ILS (and says why when a comparison is impossible), and it advances the
board's `lastRefreshAt` only when at least one vendor actually saved an observation, so a run that fetched
only the exchange-rate table cannot look like a fresh offer check. Board freshness also reports the newest
saved observation and falls back to it for the age when no completion marker exists, so an interrupted run
(for example a redeploy stopping the background job) with fresh saved offers is not labelled never
refreshed, while a recorded but old completion still reports the scheduled pipeline as stopped. A failed
vendor check does not erase the last known good row: the attempt time and reason are stamped on that
offer's existing observation row (or a marker is kept when the offer never succeeded), so the board still
ranks the last successful price and stock while saying the most recent attempt failed, and a later
successful check clears the mark. A stored offer's identity is vendor + SKU/product + form + pack size —
never the blend wording a listing happens to print (owner correction, 2026-10-12), so a listing that
changes or drops that wording cannot persist a second row for one SKU. Rows written under the old
blend-wording key and their stable-key replacements are collapsed at read time by vendor + listing URL,
keeping the newest observation, and failure markers plus the previous-check comparison resolve to the
newest row for the same URL, so the key migration can never show a duplicate offer, hide a failed check
or lose the previous price evidence.

`src/lib/policies.js` is the shared, versioned shipping-evidence model. A policy states the vendor,
product/SKU scope, service, destination scope, the amount or free-shipping threshold rule (with the
vendor's `above`/`at_least` wording preserved), the evidence URL and retrieval time, and a `reviewBy`
date. A rule may also carry **exact cart-observed free conditions** (`rule.freeCartConditions`)
instead of a threshold: each condition names the listing prefix and SKU, pack count, whole-pack units,
ordered grams, the item subtotal before any discount, the paid item total, the named method, the
destination evidence and its own observation time. `quoteBoard()` applies the evaluator at read time:
an observation whose own shipping is unknown is enriched with a matching validated policy, while an
observation that already carries a fresher amount, threshold or destination is never overwritten. A
row already stamped by an **older version of the same policy** whose money/scope is identical gets its
provenance refreshed at read time (newer version, retrieval time, coverage caveat and evidence note)
so a validated coverage or re-check update reaches persisted offers promptly; a version that changes
any amount is left for the next vendor refresh and never swapped in at read time. The one deliberate
exception is a rule **correction** declared in the new policy's `supersedes`: when a row stamped by
the same policy id still carries the exact superseded free threshold (amount, currency, semantics and
origin), the evaluator removes that policy-derived threshold and applies the scoped conditions instead,
so a scope error stops applying without waiting for a vendor refresh; the published base amount, the
item price, stock and observation time are untouched. The evaluator is deterministic and refuses to
guess: conflicting policies for the same scope stay `inconsistent`, a malformed policy is `invalid`,
and a policy past its review date is `expired`, so the offer falls back to explicit unknown shipping
instead of a stale unconditional rate. Enrichment never touches the observation's price, stock,
`observedAt` or the refresh completion marker, so applying a newer shipping rule cannot claim a fresh
vendor price/stock check; `policySummary()` exposes the rule version, observation time, review date and
scoped condition ids through `/api/status`. Four validated policies are checked in: Pucks'
₪30/free-above-₪100 home-delivery rule v2 (its coverage caveat names the five selectable localities
sampled in the estimator), CoffeeMan's published ₪25 single/4-pack rule **v3** with its cart-observed
₪15 distribution-center alternative and the exact cart-observed free conditions (7 singles at ₪231,
8 singles at ₪264 → ₪237.60 and 2 × 4-pack at ₪248; a ₪198 cart was charged ₪25 and the sampled carts
are not monotone, so no threshold is recorded and a larger or repriced cart keeps the published base
rate), CoffeeMan's ₪20 checkout quote for the one-8-pack (2 kg) cart (which carries
`maxTotalGrams: 2000` so the quote engine never stretches it to an unobserved larger cart and records
no free condition for this SKU), and Coffee4U's published ₪30 door-to-door rule with its ₪15
pickup-point alternative and the observed closed-locality-list coverage shape. Secondary delivery
methods are part of the policy representation: the evaluator adds them only when a stored row has
none, and they never replace the ranked amount. Each policy is also the adapter's single source for
the researched values it describes, so the parsed row, the read-time evaluator and the tests share one
representation instead of separate hard-coded strings. The adapters honor the same `reviewBy` gate at
parse time (`policyIsCurrent()`): once a policy is past its review date, its researched rate and any
policy-derived alternative are withheld, so a freshly parsed offer falls back to explicit unknown
shipping rather than carrying a stale quote forward. Page-published rates (CoffeeMan's ₪25 and
Coffee4U's ₪30/₪15) are parsed from the vendor page and stay independent of the policy window.

The browser-research evidence schema (`scripts/research-workflow.mjs`, `browser-research-quote`; current
**v3**, with version-1 and version-2 records still valid historical evidence under their own rules)
records the delivery method a shipping
line belongs to: a recipe step that selects the method declares `confirmsService`, and a successful run
stores `service` plus `serviceConfirmed: true`. A quoted record whose optional method step could not be
confirmed stores `service: null`, `serviceConfirmed: false` and a qualification that the shipping line is
not attributed to a named method; schema validation rejects both a claimed-but-unnamed method and an
undisclosed unconfirmed one. Schema v2 additionally distinguishes the displayed pre-discount item
subtotal, the explicit applied discount, the paid item total, the shipping-evidence source and the
delivered total, and accepts an omitted applied shipping row as a confirmed ₪0 only when the selected
named method is rendered at zero, the whole-pack quantity and destination were verified and the
discount/paid-total arithmetic matches the final total; any missing piece keeps the record
blocked/unknown. Schema v3 adds the observed cart identity: at totals-read time the runner reads the
rendered cart rows (`readCartLines` in the WebDriver adapter), extracts each row's listing SKU from its
own rendered evidence (a link query parameter such as CoffeeMan's `pid=930333`, a data attribute) and
the pack identity stated in its wording (for example “8 אריזות 250 גרם”), folds duplicate renders of the
same row and matches the result against the recipe's declared listing and pack size. The common record
keeps `expectedCartIdentity` versus `observedCartIdentity`, `cartIdentityVerified`, `cartIdentitySource`,
`cartIdentityLines` and `cartIdentityNote`; a declared recipe SKU alone is no longer proof, and missing,
mismatched or ambiguous identity, another multipack or mixed cart lines stay blocked. The Coffee4U
destination-extension records were backfilled from their recorded
successful method step, the Coffee4U policy names the method in `observedFor.method`, and the CoffeeMan
free-cart quotes (8 singles for Tel Aviv–Yafo and Eilat, 7 singles and 2 × 4-pack) are the schema-v3
records that exercise the omitted-row rule with the applied 10% promotion and the observed cart line.

`src/lib/promotions.js` is the shared, validated model for published item-price promotions (quantity
discounts). A promotion states the vendor, product/URL scope, the percent off, the activating
item-subtotal rule (with the vendor's `above`/`at_least` wording preserved), whether multipacks are
excluded, the vendor's own wording and the evidence URL/retrieval time. The adapters parse the vendor's
promotion banner on every fetch (`parseCoffeemanPromotion`), so an ended promotion stops applying with
the next observation; a checked page with no banner records an explicit empty `promotions: []`, which is
never re-enriched. The checked-in fallback (`coffeeman-ground-coffee-percent-off` v1: 10% off ground
coffee from a ₪250 item subtotal, multipacks excluded, observed in the anonymous 8 × 250 g cart at ₪264
→ ₪237.60) only covers persisted rows stored before banner parsing and stops applying past its
`reviewBy`. `quoteOffer()` applies the resolved discount to the item subtotal before shipping, exposes
`itemSubtotalBeforeDiscountIls`/`itemDiscount` and discloses the vendor wording in the offer details;
the base unit price, stock and `observedAt` are never touched, and no shipping discount is inferred
from an item promotion. `promotionSummary()` exposes the rule, percent, threshold and review date
through `/api/status`.

`src/refresh.js` is the deterministic scheduled pipeline (leases, bounded concurrency, per-vendor
backoff, last-known-good retention) and the same function runs in the Worker's `scheduled` handler, the
local cron simulation and tests. Successful vendors count as due up to fifteen minutes before their
stored `nextAttemptAt`, so a cron tick that lands seconds before the six-hour mark still refreshes
instead of silently drifting to a twelve-hour cadence; vendors inside a failure backoff keep their
strict due time. `src/store.js` defines the SQLite-backed `BoardStore` Durable Object plus
in-memory and file-backed stores with the same interface. Public routes in `src/index.js` are read-only
snapshots of that storage and never fetch visitor-supplied URLs. A source can also be blocked at the
network edge instead of failing to parse: on 2026-10-13 the production Worker received HTTP 403 for all
three CoffeeMan product pages while the same bounded request (same user agent, headers, crawl delay and
host allowlist) succeeded from the coding runner. The pipeline treats that like any other failure — the
previous good observation keeps its own `observedAt`, price and stock, the offer details and footer say
the last attempt failed, the retry is scheduled by backoff, and the shopper sees a short card-face
`Last check failed` warning rather than a falsely fresh price. Nothing attempts to evade the vendor's
edge decision.

Verification is layered: `tests/*.test.js` covers parsers, quote edge cases, the shipping-policy
evaluator (including an old persisted Pucks row and an old persisted CoffeeMan 8-pack row each gaining
their evidenced rule after a policy update), the promotion parser/evaluator (including the ₪250 boundary,
the multipack exclusion, a parsed empty `promotions: []` never being re-enriched, and an old persisted
CoffeeMan row gaining the discount at read time), the
refresh pipeline and the Worker routes against recorded fixtures; `scripts/check-sources.mjs` re-checks
the live vendor pages; `scripts/simulate-cron.mjs` runs the full refresh offline or live;
`scripts/research-workflow.mjs` defines the vendor navigation recipes and the common, sanitized
evidence schema, and `scripts/browser-research.mjs` (`npm run research:browser -- recipe <vendor>`)
executes a recipe in the real Chrome session and writes one evidence record whether the run quoted, hit
a public-flow blocker or failed; `scripts/qa-server.mjs` serves the
production front-end against fixture-backed API data so `npm run qa:browser` drives headless Chrome
offline and derives its expectations from the API. The front-end is two pages: the home route renders
the catalog index from `/api/catalog` and links to `/product/<id>`, which the Worker serves as
`product.html` for direct loads; the product page keeps the decision values in the first mobile
viewport and puts comparison, pickup, delivery options and missing-information offers behind native
`<details>` disclosures. `scripts/probe-production.mjs`
(`npm run probe:production`) re-checks a deployed (or local) Worker from the outside with fixed public
GETs only — one catalog product, no retired row in any board, the retired-URL fallback, freshness and the
ranked totals — and writes a snapshot for the status docs. Browser QA also loads an old
`?product=lavazza-qualita-oro-vacuum-ground` URL and checks that the page shows the Crema e Gusto board
with a written retired-line notice rather than reviving the retired line. See docs/STATUS.md for the
latest recorded results.
