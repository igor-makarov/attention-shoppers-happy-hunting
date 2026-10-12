# Observed sources and vendor research

**Active scope (owner correction, 2026-10-12): Lavazza Crema e Gusto vacuum-packed ground coffee only.**
The Qualità Oro, Qualità Rossa and Suerte listings further down are **historical evidence** from earlier
iterations. They are not fetch targets, not part of the active catalog, and their page excerpts live in
`tests/fixtures/historical-retired/` as negative test inputs. Historical evidence does not authorize
re-adding a product line; that needs an explicit new owner instruction.

All observations below were retrieved by the deterministic adapters in `src/vendors/`
through the bounded fetcher. Re-run them at any time with `npm run check:sources`;
each run writes its evidence to `.shurik-local/sources/<timestamp>.json`; review snapshots are copied to
`docs/evidence/`.

## Tracked listings (live checks)

### Browser-researched shipping quotes (2026-10-12)

The owner asked for shipping quotes through a real interactive browser rather than product-page disclaimers.
`scripts/browser-research.mjs` kept one headless Chrome/ChromeDriver session alive to navigate each
vendor's product page, add the tracked product to a temporary anonymous cart, open the public
cart/checkout estimator and read the rendered delivery methods and charges. Only locality/postcode fields
were filled; no order, payment, login, account or street address was involved, and cart/session
identifiers are never recorded.

| Vendor | Cart | Locality | Service | Shipping | Item subtotal | Qualification |
| --- | --- | --- | --- | --- | --- | --- |
| Pucks | 2 × 250 g = 500 g | Tel Aviv / 6100000 | home delivery (only method) | ₪30 | ₪60 | free above ₪100 item subtotal; fee unchanged for Eilat / 8800000, no restriction displayed |
| Pucks | 4 × 250 g = 1 kg | Tel Aviv / 6100000 | home delivery | free | ₪120 | free-shipping threshold met; a 1 kg cart to Jerusalem / 9100000 reproduced free delivery on 2026-10-12T22:24Z with the same “free above ₪100” wording (`2026-10-12-pucks-jerusalem-1kg-recipe.json`) |
| CoffeeMan | 8 × 250 g = 2 kg | not requested by the estimator | home courier / distribution center | ₪20 / ₪20 | ₪240 | re-checked in a fresh cart at 20:07 UTC; still no published free-delivery threshold, and this SKU cart did not get the free delivery other large carts received |
| CoffeeMan | 8 × 250 g = 2 kg | not requested | self-pickup | ₪0 | ₪240 | a pickup branch must be chosen |
| CoffeeMan | 2 × 250 g = 500 g | not requested by the estimator | home courier / distribution center | ₪25 / ₪15 | ₪66 | courier matches the product page; the ₪15 distribution-center rate is cart-observed, not published |
| CoffeeMan | 4 × 250 g = 1 kg | not requested | home courier / distribution center | ₪25 / ₪15 | ₪132 | same fee schedule as the 4-pack cart at 1 kg |
| CoffeeMan | 1 × 4-pack = 1 kg | not requested | home courier / distribution center | ₪25 / ₪15 | ₪124 | 4-pack product page rate confirmed in the cart |
| CoffeeMan | 6 × 250 g = 1.5 kg | not requested | home courier / distribution center | ₪25 / free | ₪198 | distribution-center fee dropped to free while the courier stayed ₪25 |
| CoffeeMan | 7 × 250 g = 1.75 kg | not requested | home courier / distribution center | free / free | ₪231 | free delivery observed, but no rule or threshold is published |
| CoffeeMan | 2 × 4-pack = 2 kg | not requested | home courier / distribution center | free / free | ₪248 | free at ₪248, unlike the ₪240 8-pack SKU cart: cart/product dependent, not a published threshold |
| Coffee4U | 1 × 250 g | not requested | door-to-door courier | ₪30 | ₪38 | 1,270-entry destination city list; locality-list caveat |
| Coffee4U | 1 × 250 g | not requested | Chiita Shops pickup point | ₪15 | ₪38 | 421-city list plus a per-city spot |
| Coffee4U | 1 × 250 g | not requested | self-pickup | ₪0 | ₪38 | pickup at the Tel Aviv shop |

Full evidence matrix, rendered-text excerpts and screenshots: `docs/evidence/browser-research/2026-10-12-vendor-shipping-quotes.json` (observed 18:07-18:19 UTC) plus the fresh Pucks re-check `docs/evidence/browser-research/2026-10-12-pucks-recheck.json` (observed 18:55 UTC), the independent all-vendor re-check `docs/evidence/browser-research/2026-10-12-fresh-recheck-3-69.json` (observed 19:07-19:16 UTC, which reproduced the same amounts and added the note that Pucks applies the ₪30 to the summary total only after a delivery method is selected), the CoffeeMan single/4-pack cart batch `docs/evidence/browser-research/2026-10-12-coffeeman-cart-single-4pack.json` (observed 19:56-20:09 UTC, which resolved the unpublished distribution-center fee and the cart-dependent free-delivery behavior) and the recipe-driven Pucks Jerusalem run `docs/evidence/browser-research/2026-10-12-pucks-jerusalem-1kg-recipe.json` (observed 2026-10-12T22:24Z; 4 × 250 g = ₪120 subtotal, free delivery, “free above ₪100”, with the `#city`/`#zip` fields filled and read back). The available file-read tool rejects PNG input, so the screenshots could not be read as images by the model; every amount above is backed by rendered DOM text captured in the same session, and the screenshots are artifacts for a human reviewer. Since iteration 3-70 `scripts/inspect-screenshot.mjs` additionally decodes the PNGs with node:zlib and renders a coarse luminance map plus a Canton Zürich token-pixel report, so layout and colour regions can be checked without image input (see `docs/evidence/visual-review/2026-10-12-revised-layout-review.json`). A cart quote is conditional on its recorded quantity and destination: it is not an unconditional nationwide rate and not a completed checkout.

**Certainty labels:** a rate published on the vendor's product page keeps `certainty: verified` and the label `Published rate (verified)`. A rate that only exists in the vendor's anonymous cart/checkout estimator is stored as `certainty: checkout_quote` and rendered as `Checkout rate (observed, conditional)` (Pucks and the CoffeeMan 8 × 250 g cart). Coffee4U publishes its courier and pickup-point rates on the product page, so it keeps `verified`.

**Versioned policy promotion and staleness (iterations 3-73 and 3-76):** a validated quote is promoted by hand into `src/lib/policies.js` as a versioned policy (vendor, product/SKU scope, service, destination scope, amount or free-shipping rule with the vendor's `above`/`at_least` wording, evidence URL and retrieval time, `reviewBy`). The read-time evaluator in the same module enriches an observation whose own shipping is unknown, never overwrites a fresher parsed rate, treats conflicting policies as `inconsistent`, and stops applying a policy once `reviewBy` passes (the offer then shows explicit unknown shipping again). Two policies are checked in: Pucks' ₪30 / free-above-₪100 rule is `pucks-il-home-delivery` v1, observed 2026-10-12T18:10:10Z; CoffeeMan's ₪20 one-8-pack (2 kg) checkout quote is `coffeeman-8pack-il-cart-quote` v1, observed 2026-10-12T20:07:00Z and scoped to the 8-pack offer URL with `maxTotalGrams: 2000` and no free threshold. Both carry `reviewBy` 2026-11-11; re-checking the rendered estimator renews the evidence and version, and `/api/status` exposes the current version, observation time and review date. Each policy is also the adapter's single source for its rate, so the parsed row, the read-time evaluator and the tests share one researched rule. Enrichment never changes the offer's price/stock observation time or the refresh completion marker.

**Recipe-driven rechecks:** `scripts/research-workflow.mjs` defines per-vendor navigation recipes (Pucks, CoffeeMan, Coffee4U) and one common evidence schema (`browser-research-quote`, schema v1). `npm run research:browser -- recipes` lists them and `npm run research:browser -- recipe <id> --grams 500 --locality "תל אביב" --postcode 6100000 --out <file>` executes one against the live Chrome session, then writes a sanitized record whose `status` is `quoted`, `partial` (rate read but cart quantity unverified or arithmetic inconsistent), `blocked` (public flow stopped, with the exact step and rendered excerpt) or `failed`. URLs lose query strings/fragments and session/token-like runs are redacted before anything is written. A live Pucks recipe run on 2026-10-12 21:06-21:10 UTC verified the product page and the add-to-cart label (`הוסף לעגלה`, cart showed 1 × 250 g = ₪30) but direct navigation to `https://pucks.co.il/payment/request` did not keep the cart in that session; the cart-checkout link (`a.slide_cart__btn-checkout`) is now a recipe step and reached the estimator. Iteration 3-76 fixed the destination step after a live run recorded a locality that was never set: the Pucks estimator's only `<select>` is the language dropdown, so the recipe now fills the named `#city` and `#zip` text inputs as **required** steps (a run that cannot set them is `blocked`, not attributed to a destination) and each `fill` records the value the page actually holds in the evidence steps. The fixed recipe produced the 2026-10-12T22:24Z Jerusalem quote below.

### CoffeeMan / Amigo — coffeeman.co.il (Israel)

Tracked listings (three Crema e Gusto offers, never merged):

- **250 g single pack** — `https://www.coffeeman.co.il/product/250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico`
  - Retrieved: 2026-10-12 11:04, 11:20, 11:29, 11:48, 12:57, 15:12, 16:50 and 17:22 UTC (adapters `coffeeman/1` to `coffeeman/5`)
  - Establishes: name "250 גרם קפה טחון lavazza Crema e Gusto Classico חוזק 7", SKU 930333, variant Classico, ground, 250 g single pack, price ₪33 (regular ₪36), schema.org availability `InStock`, and the published delivery options on the page: courier delivery ₪25, free self-pickup, plus a distribution-center option whose price is not published.
  - Cart research (2026-10-12 19:56-20:09 UTC, anonymous cart): the 500 g and 1 kg carts quoted ₪25 home courier (matching the page) and ₪15 distribution-center delivery up to 5 kg; the distribution-center fee became free at a ₪198 (1.5 kg) cart and the courier at ₪231 (1.75 kg). The free-delivery rule is not published and the ₪240 8-pack cart was still charged, so the board keeps the published ₪25 as the ranked rate and shows the ₪15 distribution-center option as a conditional alternative.
  - Shipping certainty: **verified** for the published courier rate. Coverage caveat: the terms page (`https://www.coffeeman.co.il/page/%D7%AA%D7%A0%D7%90%D7%99-%D7%A9%D7%99%D7%9E%D7%95%D7%A9`, section 4) states home delivery is performed "subject to Amigo's list of localities where home delivery is performed", and the product page does not publish that list, so the observation carries a structured coverage caveat instead of claiming country-wide coverage. A shipping-policy page (`page.asp?page=237`) linked from the terms now returns HTTP 404, so no additional flat rate is available.
- **4 × 250 g multipack** — `https://www.coffeeman.co.il/product/4-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA-250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico`
  - Retrieved: 2026-10-12 11:46, 11:48, 12:57, 15:12, 16:50 and 17:22 UTC (adapters `coffeeman/1` to `coffeeman/5`)
  - Establishes: name "4 אריזות 250 גרם קפה טחון lavazza Crema e Gusto Classico", SKU 930334, variant Classico, ground, 4 × 250 g = 1000 g, price ₪124.00, schema.org availability `InStock`, courier ₪25 published on the page.
  - Cart research (2026-10-12 20:04-20:09 UTC, anonymous cart): the 1 kg cart quoted ₪25 home courier (matching the page) and ₪15 distribution-center delivery up to 5 kg; a 2 kg two-4-pack cart was shown free delivery, but the rule is not published, so the board keeps the published ₪25 and shows the ₪15 option as a conditional alternative.
  - Shipping certainty: **verified** (₪25 courier; the same terms-page locality-list caveat applies).
- **8 × 250 g multipack** — `https://www.coffeeman.co.il/product/8-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA-250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico`
  - Retrieved: 2026-10-12 11:46, 11:48, 12:57, 15:12, 16:50 and 17:22 UTC (adapters `coffeeman/1` to `coffeeman/5`)
  - Establishes: name "8 אריזות 250 גרם קפה טחון lavazza Crema e Gusto Classico", SKU 930335, variant Classico, ground, 8 × 250 g = 2000 g, price ₪240.00, schema.org availability `InStock`.
  - Shipping certainty: **checkout_quote** for the researched anonymous-checkout quote, even though the product page still publishes the courier option without a price (only free self-pickup and an unpriced distribution-center option). The interactive browser research quoted the 2 kg cart at ₪20 home courier and ₪20 distribution-center delivery (2026-10-12 18:16 UTC, re-checked in a fresh cart at 20:07 UTC with the same result); self-pickup was ₪0 with a required branch choice, and no free-delivery threshold was displayed. The 2 kg 8-pack cart did not receive the free delivery that the 1.75 kg single-pack and 2 kg two-4-pack carts showed, so no free-shipping rule is inferred from those observations. The adapter stores the ₪20 rate with `maxTotalGrams: 2000` (the observed cart size), so a larger cart stays unranked with the exact reason instead of stretching the quote, plus the same unpublished locality-list caveat. The ₪25 single/4-pack page rate and the ₪20 eight-pack cart quote are both recorded as observed; the difference is not explained publicly and is never averaged or guessed. Since iteration 3-76 the quote is the checked-in policy `coffeeman-8pack-il-cart-quote` v1: the adapter derives its constant from that policy, and the read-time evaluator applies the same rule to an older persisted 8-pack row whose shipping was unknown, without touching its ₪240 price or its 2026-10-12 15:51 UTC observation time.

### Historical CoffeeMan listings (retired 2026-10-12 — evidence only, do not re-track)

These pages were observed while earlier iterations tracked other Lavazza lines. Their adapter offers
were removed by the owner correction, and their excerpts now live in
`tests/fixtures/historical-retired/` where the tests prove every adapter refuses them.

- **Qualità Oro 250 g single pack** — `https://www.coffeeman.co.il/product/lavazza-qualita-oro-ground-250-gr--%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F`
  - Retrieved: 2026-10-12 12:57 UTC (adapter `coffeeman/2`)
  - Establishes: name "Lavazza Qualita Oro ground 250 gr -קפה טחון - חוזק 5", SKU 930339, ground coffee, 250 g single pack, price ₪37.00, schema.org availability `InStock`, and the same product-page delivery list: courier ₪25, free self-pickup, plus a distribution-center option whose price is not published.
  - Shipping certainty: **verified** for the published courier rate (country-wide IL).
  - Variant: the CoffeeMan page states no blend variant for Qualità Oro, so the listing is stored as *Variant not stated*; it can never enter the Crema e Gusto board.
- **Qualità Oro 4 × 250 g multipack** — `https://www.coffeeman.co.il/product/4-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA-250-%D7%92%D7%A8%D7%9D-lavazza-qualit224-oro-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F`
  - Retrieved: 2026-10-12 12:57 UTC (adapter `coffeeman/2`)
  - Establishes: name "4 אריזות 250 גרם Lavazza Qualità Oro קפה טחון", SKU 930340, 4 × 250 g = 1000 g, price ₪125.00, schema.org availability `InStock`, courier ₪25 published on the page.
  - Shipping certainty: **verified** (₪25 courier).
- **Qualità Oro 8 × 250 g multipack** — `https://www.coffeeman.co.il/product/8-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA-250-%D7%92%D7%A8%D7%9D-lavazza-qualit224-oro-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F`
  - Retrieved: 2026-10-12 12:57 UTC (adapter `coffeeman/2`)
  - Establishes: name "8 אריזות 250 גרם Lavazza Qualità Oro קפה טחון", SKU 930341, 8 × 250 g = 2000 g, price ₪239.00, schema.org availability `InStock`.
  - Shipping certainty: **unknown** — like the Crema e Gusto 8-pack, this page lists the courier option without a price, so the offer stays visible and unranked.

- **Qualità Rossa 250 g single pack** — `https://www.coffeeman.co.il/product/250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-qualita-rossa`
  - Retrieved: 2026-10-12 13:32 UTC (adapter `coffeeman/3` via live `npm run check:sources`)
  - Establishes: name "250 גרם קפה טחון Lavazza Qualita Rossa- חוזק 5", SKU 930336, ground, 250 g single pack, price ₪33.00, schema.org availability `InStock`, and the same product-page delivery list: courier ₪25, free self-pickup, plus a distribution-center option whose price is not published.
  - Shipping certainty: **verified** for the published courier rate (country-wide IL).
- **Suerte 250 g single pack** — `https://www.coffeeman.co.il/product/250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-suerte-%D7%97%D7%95%D7%96%D7%A7-10`
  - Retrieved: 2026-10-12 13:46 UTC (adapter `coffeeman/4` via live `npm run check:sources`)
  - Establishes: name "250 גרם קפה טחון LAVAZZA SUERTE חוזק 10", SKU 930661, ground, 250 g single pack, price ₪33.00, schema.org availability `InStock`, and the same product-page delivery list: courier ₪25, free self-pickup, plus a distribution-center option whose price is not published.
  - Shipping certainty: **verified** for the published courier rate (country-wide IL). Packaging: the page states ground coffee but never uses the words "vacuum brick", so the catalog records a ground pack rather than overclaiming.
- Parser: schema.org microdata in the legacy Windows-1255 pages; the adapter decodes the declared charset before parsing and uses the same parser for the three tracked Crema e Gusto listings.
- Fixtures: `tests/fixtures/coffeeman-product.windows-1255.html` (single, plus derived out-of-stock variant),
  `coffeeman-4pack-product.windows-1255.html` and `coffeeman-8pack-product.windows-1255.html`; all are minimized
  excerpts of the tracked pages retrieved on 2026-10-12. The retired-line excerpts are kept separately in
  `tests/fixtures/historical-retired/` and are never routed to an adapter.

### Pucks — pucks.co.il (Ramla, Israel)

Tracked listing (one Crema e Gusto offer):

- **Crema e Gusto Classico 250 g** — `https://pucks.co.il/product/lavazza-crema-e-gusto-ground-coffee-250g`
  - Retrieved: 2026-10-12 11:04, 11:20, 11:29, 12:57, 15:12, 16:50 and 17:22 UTC (adapters `pucks/1` to `pucks/5`)
  - Establishes: name "lavazza crema e gusto classico-250 גרם קפה טחון", SKU Lav69, GTIN 8000070038769, variant Classico, ground, 250 g single pack, price ₪30.00, schema.org JSON-LD availability `InStock`.
  - Shipping certainty: **checkout_quote** for the researched anonymous-checkout quote. The product page and the cart widget still say "המשלוח מחושב בתשלום" (shipping is calculated at payment), and the public terms page (`https://pucks.co.il/terms-and-privacy-policy`, checked 13:05 UTC) publishes no amount; the interactive browser research resolved the rate in the public estimator instead of repeating the disclaimer.
  - Researched quote (2026-10-12 18:08-18:10 UTC, re-confirmed 18:55 UTC): the anonymous checkout at `https://pucks.co.il/payment/request` offered home delivery (משלוח עד הבית) only, flat ₪30, with "משלוח חינם בהזמנה מעל 100 ₪" (free shipping above a ₪100 item subtotal). Observed for 1, 2 and 4 × 250 g carts to Tel Aviv / 6100000, and unchanged for Eilat / 8800000 (no locality restriction was displayed). The adapter carries the ₪30 rate with `freeThreshold` ₪100 and a structured coverage caveat: the fee was only sampled for Tel Aviv and Eilat, so country-wide coverage is not claimed. A recipe-driven 1 kg cart to Jerusalem / 9100000 (2026-10-12T22:24Z) reproduced the free-over-₪100 behavior with the destination fields verified on the page; the below-threshold ₪30 fee itself is still evidenced for Tel Aviv and Eilat.
  - Evidence: `docs/evidence/browser-research/2026-10-12-vendor-shipping-quotes.json` and `docs/evidence/browser-research/2026-10-12-pucks-recheck.json` (with screenshots); only locality/postcode were entered, and no order, payment, login or account was submitted. The earlier 13:05 UTC terms-page excerpt remains at `docs/evidence/vendor-research-2026-10-12T1305Z-pucks-shipping.json`.

### Historical Pucks listings (retired 2026-10-12 — evidence only, do not re-track)

Observed before the owner correction; removed from the adapter's offers. The out-of-stock observation
was a real board observation at the time but is historical now.
- **Qualità Oro 250 g** — `https://pucks.co.il/product/lavazza-qualita-oro-ground-coffee-250gr`
  - Retrieved: 2026-10-12 12:57 UTC (adapter `pucks/2`)
  - Establishes: name "Lavazza Qualità Oro ground coffee -קפה טחון 250 גרם", SKU lav11, GTIN 8000070019911, ground coffee, 250 g single pack, price ₪35.00, schema.org JSON-LD availability `InStock`.
  - Variant: the page states no blend variant, so the listing is stored as *Variant not stated* and is only compared on the Qualità Oro board.
  - Shipping certainty: **unknown** — shipping is calculated at checkout; never treated as free. The 2026-10-12 terms-page check above applies to this listing too.
- **Qualità Rossa 250 g (SKU Lav80)** — `https://pucks.co.il/product/lavazza-qualita-rossa-ground-coffee-250g`
  - Retrieved: 2026-10-12 13:32 UTC (adapter `pucks/3`)
  - Establishes: name "Lavazza Qualita Rossa-250 גרם קפה טחון", SKU Lav80, GTIN 8000070035980, ground, 250 g single pack, price ₪30.00, schema.org JSON-LD availability `InStock`.
  - Shipping certainty: **unknown** — shipping is calculated at checkout, so the offer stays visible and unranked; it is never treated as free.
- **Qualità Rossa 250 g (SKU Lav35) — observed out of stock** — `https://pucks.co.il/product/lavazza-qualita-rossa-ground-coffee-powder-250g`
  - Retrieved: 2026-10-12 13:32 UTC (adapter `pucks/3`)
  - Establishes: name "Lavazza Qualita Rossa- לווצה רוסה 250 גרם קפה טחון", SKU Lav35, GTIN 8000070035935, ground, 250 g single pack, price ₪35.00, schema.org JSON-LD availability `OutOfStock`.
  - The price is still an observation; the listing is kept visible and unranked and is never reported as available. This is the board's real out-of-stock example, alongside the derived parser fixtures.
- **Suerte 250 g** — `https://pucks.co.il/product/lavazza-suerte-ground-coffee-250g`
  - Retrieved: 2026-10-12 13:46 UTC (adapter `pucks/4`)
  - Establishes: name "Lavazza Suerte-250 גרם קפה טחון", SKU Lav03, GTIN 8000070083103, ground, 250 g single pack, price ₪35.00, schema.org JSON-LD availability `InStock`.
  - Shipping certainty: **unknown** — shipping is calculated at checkout, so the offer stays visible and unranked; it is never treated as free.
- Parser: `application/ld+json` Product/Offer block on the public product pages.
- Fixtures: `tests/fixtures/pucks-product.html` (plus a derived out-of-stock variant and a preorder variant), a minimized excerpt of the tracked page retrieved on 2026-10-12. The retired-line excerpts are kept separately in `tests/fixtures/historical-retired/`.

### Coffee4U / קופי פור יו — coffee4u.co.il (Tel Aviv, Israel)

- Product page: `https://www.coffee4u.co.il/product/lavazza-crema-e-gusto-250-gr-%D7%98%D7%97%D7%95%D7%9F`
- Retrieved: 2026-10-12 12:02 (research probe), 12:09, 12:57, 15:12, 16:50 and 17:22 UTC (adapter `coffee4u/1` via live `npm run check:sources`)
- Establishes: name "Lavazza Crema e gusto 250 gr טחון", internal SKU 2010561, ground coffee, 250 g single pack, price ₪38, schema.org availability `InStock`, and the delivery options published next to the product:
  - free self-pickup at the shop;
  - delivery to a צ'יטה שופס pickup point, ₪15 (up to 5 kg, up to 7 business days);
  - door-to-door courier, ₪30 (1-5 business days).
- Shipping certainty: **verified** for the door-to-door courier rate, which is the ranked delivered amount. The ₪15 pickup-point service is stored as an alternative shipping option and is never used as the ranked total, and free self-pickup stays in the separate pickup list.
- Rendered checkout confirmation (2026-10-12 18:17-18:19 UTC): the anonymous checkout quoted the 1 × 250 g cart at ₪30 door-to-door without an address; the checkout carries a 1,270-entry destination city list (Tel Aviv–Yafo and Eilat both present). The ₪15 pickup-point method requires a city plus spot from a 421-city list before its fee is shown, and self-pickup shows the shop address. The vendor's page title tag still says "Lavazza Qualita Oro Beans 1 kg" while the rendered body is the Crema e Gusto 250 g listing; the mismatch is a stale vendor-side title and did not change the cart item. Evidence: `docs/evidence/browser-research/2026-10-12-vendor-shipping-quotes.json`. Coverage caveat: the terms page (`https://www.coffee4u.co.il/page/%D7%AA%D7%A7%D7%A0%D7%95%D7%9F-0`, shipping-policy section) states door-to-door delivery is "subject to the company's list of localities where home delivery is performed", which the product page does not enumerate, so the observation carries a structured coverage caveat instead of claiming country-wide coverage.
- Blend wording: the page names only "Crema e gusto" and states no Classico, Forte or other blend wording. Under the 2026-10-12 owner correction there is no variant feature: the listing takes part in the same one comparison as the Classico listings, and its unstated wording is kept only as raw listing identity evidence (never relabelled as Classico, never withheld).
- Parser: schema.org microdata in a legacy Windows-1255 page; the declared charset is decoded before parsing. `robots.txt` allows product pages and asks for `Crawl-delay: 7`; the adapter fetches one fixed URL per six-hour run, so the delay is respected by the refresh interval.
- Fixtures: `tests/fixtures/coffee4u-product.windows-1255.html` plus a derived out-of-stock variant, both minimized excerpts of the page retrieved on 2026-10-12.

### Bank of Israel — official exchange rates (reference data)

- Feed: `https://www.boi.org.il/currency.xml` (JSON mode used by the adapter)
- Retrieved: 2026-10-12 11:20, 11:29 and 12:57 UTC. The 12:57 UTC live run fetched the official table dated 2026-10-12 (USD 3.078); the earlier runs saw the 2026-10-09 table (USD 3.055).
- Establishes: official ILS reference rates used only to convert non-ILS prices into an **estimate**; a missing rate never becomes zero and blocks ranking instead.

## Sources researched and not included

| Source | Observed | Why it is not an adapter |
| --- | --- | --- |
| amazon.com (`/dp/B00IIFU5ZE`) | Product page reachable 2026-10-12; listing "Lavazza Crema e Gusto Ground Coffee, 8.8-Ounce Bricks (Pack of 3)", in stock | Delivery of this specific listing to Israel (and import fees) is only shown after setting a delivery address at checkout. No public evidence of IL delivery, so it cannot rank and is excluded per the vendor rules. |
| rami-levy.co.il | HTTP 403 from the runner for product/search API and pages (rechecked 2026-10-12) | Anti-bot protection. Not bypassed; no permitted alternative path found. |
| shufersal.co.il | 2026-10-12: `/robots.txt` returned a 444-byte empty HTML object from S3/CloudFront instead of robots rules, with no product or shipping data | No stable server-rendered page from the runner; not bypassed, and nothing public to parse. |
| aroma.co.il / cafejoe.co.il / blackcoffee.co.il / coffee-center.co.il | 2026-10-12 13:18 UTC probes: aroma.co.il HTTP 403, cafejoe.co.il and coffee-center.co.il did not resolve, blackcoffee.co.il HTTP 526 (Cloudflare) | No reachable public product page from the runner; not bypassed. A fourth vendor was again not found, so the board stays with the three observed adapters. |
| tivtaam.co.il | HTTP 200 but an AngularJS/ZuZ single-page shell with no product data in the HTML | Product data only appears after client-side API calls; not a stable public product page or documented API. |
| espresso-international.co.uk (Shopify suggest API) | Reachable 2026-10-12; does not carry Lavazza Crema e Gusto | No matching product. |
| eBay / iHerb | HTTP 403 from the runner during earlier research | Anti-bot protection; not bypassed. |
| lavazza.co.il | Official Israeli Lavazza brand site; the Crema e Gusto ground collection page has no price, cart or shipping terms (content only) | Not an e-commerce source, so it cannot produce a delivered total. |
| coffeepoint.co.il | Wix store (Pepyaka server); product and price data is client-rendered and shipping is only calculated at checkout | No stable public product page with published structured data. |
| Bing / DuckDuckGo HTML search | DuckDuckGo returned an anti-bot challenge (HTTP 202); Bing returned a page whose result targets were not extractable | Used only to look for further Israeli vendors; no new viable source found. |
| super-pharm.co.il | HTTP 247 with a JavaScript bot-detection challenge (`kramericaindustries.ac_v2.lib.js`) on both the main and shop hosts | Anti-bot protection; not bypassed, so the chain cannot be used as a third vendor from the runner. |
| espresso-club.co.il | 2026-10-12: reachable, but the root document is an Angular single-page shell (`<base href="/">`, Material icons) and `/catalogsearch/result/?q=lavazza` returned no usable response; `robots.txt` served the same SPA shell | No stable server-rendered product page or published structured data, so no adapter. |
| 365mashbir.co.il | 2026-10-12: Shopify storefront reachable; product sitemaps (29 files) contain no Lavazza Crema e Gusto listing | Not a source for the tracked product. |
| zap.co.il | 2026-10-12: reachable price-comparison aggregator; its model page for the exact ground 250 g product lists only CoffeeMan, and its Lavazza ground category lists capsule/cleaning stores (Caffe Vero, CaffeNU, Pure) | Aggregator prices are not a vendor listing, carry no shipping terms and are used for research only, never as an adapter. |
| coffeeclub.co.il (PAUZA) | 2026-10-12: WooCommerce site reachable, but a product search for "lavazza crema e gusto" returns no product pages | Not a source for the tracked product. |
| caffenu.co.il / caffenu.com / caffevero.co.il | 2026-10-12: Caffenu is a capsule/cleaning brand; caffevero.co.il does not resolve | No ground-coffee listing. |
| mojeek.com / Bing HTML / DuckDuckGo / Ecosia | 2026-10-12: mojeek returned HTTP 403, Bing HTML had no extractable result links, DuckDuckGo returned an anti-bot challenge; a later probe at 13:17 UTC saw lite.duckduckgo.com return HTTP 202 and ecosia.org HTTP 403 | Search engines were used only for research; no viable new source was found through them. |
| searx.be / search.inetol.net / baresearch.org / opnxng.com / html.duckduckgo.com / lite.duckduckgo.com | 2026-10-12 17:05 UTC re-probe: searx.be served a "Verifying your browser…" anti-bot page for both queries, search.inetol.net a "Security check - Substation" page, baresearch.org a "Making sure you're not a bot!" page, opnxng.com HTTP 403, and the DuckDuckGo HTML/lite endpoints returned pages with no extractable result links | Anti-bot protections, not bypassed; search engines remain research-only and found no new viable source. |
| lovecoffee.co.il / justcoffee.co.il / coffeestation.co.il / coffeefactory.co.il / cafepoint.co.il / coffeeandmore.co.il / cupcoffee.co.il / cafe-express.co.il / beancoffee.co.il / coffeemania.co.il / coffeebreak.co.il / coffeemill.co.il | 2026-10-12 17:07 UTC probe: lovecoffee.co.il is a Cold Brew brand with no Lavazza mention, justcoffee.co.il is an own-roast bean shop with no Lavazza mention, coffeestation.co.il serves a Cloudflare "Just a moment..." challenge, and the other nine candidate domains do not resolve from the runner | No Crema e Gusto ground listing and no new viable vendor; the challenge was not bypassed. |

| roastmarket.com | 2026-10-12: storefront reachable; carries "Lavazza Qualità Oro ground coffee value pack 20x250g" (€132.99, InStock) in its public product sitemap | The public Delivery & Shipping page states "We deliver to mainland Spain and the Balearic Islands", handled by Correos. No evidence of delivery to Israel, so it is excluded rather than guessed. |
| freshmarket.co.il | 2026-10-12: `/robots.txt` reachable (`Crawl-delay: 4`) but the public sitemap only lists static and page URLs; search/catalog responses are a small client shell with a bot-detection script and no product data | No stable server-rendered product page from the runner; not bypassed. |
| carrefour.co.il / mega.co.il / victoryonline.co.il | 2026-10-12: carrefour.co.il and mega.co.il return HTTP 403 Cloudflare "Attention Required"; victoryonline.co.il returns a Cloudflare "Just a moment..." challenge for `/robots.txt` | Anti-bot protection; not bypassed. |
| coffeedesk.com | 2026-10-12: `/robots.txt` reachable, but the public catalog search for "lavazza" returns HTTP 404 with no ground listing | Not a source for the tracked products. |
| coffeeshop.co.il / ilcafe.co.il / coffeehen.co.il / yohananof.co.il | 2026-10-12 probes: coffeeshop.co.il timed out after 8 s, ilcafe.co.il and coffeehen.co.il did not resolve, yohananof.co.il failed at the network level | No reachable public product page from the runner. |
| coffeetime.co.il | 2026-10-12: reachable but serves a SeedProd placeholder shell (no product data, no robots rules) | Not an e-commerce source. |
| espressocoffeeshop.com | 2026-10-12 15:19 UTC: `/robots.txt` reachable; it explicitly allows only a whitelist of search/AI crawlers and leaves general crawlers blocked (anti-scraping), per the file's own comments | Blocked by the vendor's robots policy; not bypassed, so no adapter. Recorded in `docs/evidence/vendor-probe-2026-10-12T1519Z.json`. |
| coffeecircle.com | 2026-10-12 15:19 UTC: reachable, `robots.txt` allows crawling; the public sitemap (1,535 URLs) contains no Lavazza product URL | German roaster with no tracked product listing, so it cannot carry Crema e Gusto. |
| bringit.co.il | 2026-10-12 15:19 UTC: reachable; it is BringIT Technologies (a technology company), not a store, with no product or Lavazza content | Not an e-commerce source. |
| rami-levy.co.il / carrefour.co.il / mega.co.il / victoryonline.co.il / aroma.co.il / super-pharm.co.il / blackcoffee.co.il / quik.co.il / keshet-teamim.co.il | 2026-10-12 15:19 UTC re-probe: still HTTP 403, HTTP 247 (bot challenge) or HTTP 526 for `/robots.txt` | Anti-bot protection unchanged; not bypassed. |
| freshmarket.co.il | 2026-10-12 15:19 UTC re-probe: `/robots.txt` returned 200 but the response is a truncated 4,000-byte shell with no usable rules, and the store still serves no server-rendered product data | No stable public product page from the runner; not bypassed. |
| neto.co.il | 2026-10-12 15:19 UTC re-probe: no response within an 8-second bounded timeout | Unreachable from the runner; no adapter. |
| kaffeekontor.de | 2026-10-12: the domain redirects to a "domain for sale" page | Not an e-commerce source. |
| coffeeitalia.co.uk | 2026-10-12: Cloudflare "Just a moment..." challenge on `/robots.txt` | Anti-bot protection; not bypassed. |
| coffeeplus.co.il (טעמים פלוס) | 2026-10-12: reachable; its Lavazza line is beans and capsules only (Crema E Aroma beans, Gran Espresso, Gusto Forte 6 kg beans, A Modo Mio capsules) | No Crema e Gusto vacuum-packed ground listing, so it cannot carry the tracked product. |
| cafeneto.co.il | 2026-10-12: reachable; the public `?s=lavazza` search returns no usable product results | Not a source for the tracked product. |
| coffeexpress.co.il / coffee-shop.co.il / caffeitalia.co.il / espresso.co.il / italcoffee.co.il / coffeeandco.co.il / shop.lavazza.co.il / lavazzashop.co.il / cafeladino.co.il / coffee-world.co.il / coffeestore.co.il | 2026-10-12 probes: the domains do not resolve from the runner | No reachable public product page. |
| beans.co.il | 2026-10-12: redirects to an unrelated health site (pan-il.org) | Not an e-commerce source. |
| kaffekapslen.co.il / kafetov.co.il / coffeezone.co.il / hacafe.co.il / hakave.co.il / coffeeland.co.il / cafe-land.co.il / coffeemax.co.il / espresso-machine.co.il / coffee-machine.co.il / coffeelovers.co.il / coffeeholic.co.il / coffeetogo.co.il / coffeeandtea.co.il / kcity.co.il / osher-ad.co.il / shukhaair.co.il | 2026-10-12 14:44 UTC probes: the domains do not resolve from the runner | No reachable public product page. |
| roasters.co.il | 2026-10-12 14:44 UTC: resolves but serves a "Premium Domain For Sale" page | Not an e-commerce source. |
| mycoffee.co.il | 2026-10-12 14:44 UTC: HTTP 403 on a cPanel "Account Suspended" page | No storefront. |
| superyuda.co.il | 2026-10-12 14:44 UTC: HTTP 403 Forbidden for `/robots.txt` | Anti-bot protection; not bypassed. |
| coffeepoint.co.il | 2026-10-12 14:45 UTC: Wix storefront; the public product sitemap lists 13 products, none of them Lavazza Crema e Gusto | Not a source for the tracked product. |
| pucks.co.il sitemap and ground-coffee category | 2026-10-12 14:40 UTC: the sitemap contains 23 crema-e-gusto URLs, but the ground category carries only the tracked Classico 250 g; `lavazza-crema-e-gusto-forte` and `-dolce` are Nespresso-compatible capsules, `lavazza-crema-e-gusto-classico-12kg-beans` is beans, and `lavazza-decaffeinato-ground-coffee-250g` is a different line (observed out of stock) | Confirms the tracked Pucks offer is the only Crema e Gusto ground listing there; nothing new to track. |
| coffeeman.co.il sitemap | 2026-10-12 14:39 UTC: 2,531 URLs; the 23 crema-e-gusto URLs include the three tracked ground listings, coffee beans, capsules and a `...crema-e-gusto-risveglio-espresso-classico-0` ground URL that redirects to a generic "4 blends 250 g mix your choice of 9 ground blends" page (SKU 930188) which does not name Crema e Gusto | No additional tracked ground listing; the generic mix page cannot be claimed as a Crema e Gusto offer. |
| pricez.co.il | 2026-10-12 14:58 UTC: `/Search.php?q=lavazza+crema+e+gusto` returns two results, both Nespresso-compatible capsules (Forte/Ricco); no ground Crema e Gusto listing | Aggregator used for research only, never an adapter; it adds no tracked listing. |
| coffeebar.co.il | 2026-10-12 14:57 UTC: café chain homepage; ordering runs through Wolt/10bis, no online shop of coffee packs | Not an e-commerce source for the tracked product. |
| coffeelab.co.il | 2026-10-12 14:57 UTC: Wix store; the public product sitemap lists 22 own-brand blends/capsules and no Lavazza | Not a source for the tracked product. |
| barista.co.il | 2026-10-12 14:57 UTC: Wix site with only a pages sitemap, no product store | Not an e-commerce source. |
| mycafe.co.il | 2026-10-12 14:57 UTC: WooCommerce; the public product sitemap lists 23 products, none Lavazza | Not a source for the tracked product. |
| shops.walla.co.il / coffee-room.co.il / ilovecoffee.co.il / coffeetown.co.il / cafeland.co.il / thecoffee.co.il / cafe24.co.il | 2026-10-12 14:57 UTC probes: the domains do not resolve from the runner | No reachable public product page. |
| zap.co.il (exact-product search) | 2026-10-12 15:35 UTC: the public search returns 40 results; the only tracked ground listing is CoffeeMan's 250 g offer and its multipack model, and every other Crema e Gusto result is capsules or pods. Zap labels CoffeeMan courier at ₪15 and the ₪240 multipack as free shipping, while CoffeeMan's own product pages publish ₪25 and no courier price on the 8-pack | Aggregator data, not a vendor listing: it carries no product-page evidence and disagrees with the vendor's own pages, so it is research-only and is never used as board evidence. |
| freshcafe.co.il (פרש קפה / FreshCafe) | 2026-10-12 15:37 UTC: reachable; `robots.txt` allows product pages and asks for `Crawl-delay: 7`; the public product search returns 40 Lavazza products, all beans, capsules or pods | Its twelve Crema e Gusto results are aluminium/Nespresso-compatible capsules; the ground-coffee and brand categories carry no vacuum-packed ground Crema e Gusto listing, so it cannot be an adapter for the tracked product. |
| brioso.co.il (חנות קפה בריוסו) | 2026-10-12 15:36 UTC: the domain resolves, but `robots.txt`, the home page and sitemaps all return a 1,648-byte referer/JS gate (`page_no_referer`) to a non-referring client | No public robots rules or product page; the gate was not bypassed. Zap's index shows only Crema e Gusto capsules/pods there, so it cannot be validated as a permitted source for the tracked ground listing. |

Three independent adapters (CoffeeMan, Pucks and Coffee4U) meet and exceed the "at least two" requirement
with five real Crema e Gusto listings: three CoffeeMan offers (single 250 g ₪33, 4 × 250 g ₪124 and
8 × 250 g ₪240, all observed in stock; the two single/4-pack pages publish a verified ₪25 courier rate and
the 8-pack cart was quoted ₪20 at the anonymous checkout), one Pucks offer (₪30, in stock, with a
researched ₪30 flat home-delivery rate and free shipping above ₪100) and one Coffee4U offer (₪38, in
stock, with a published ₪30 door-to-door courier rate and a ₪15 pickup-point alternative). The 2026-10-12 15:39, 16:50 and 17:22 UTC live checks re-observed exactly
these five listings with the same prices, stock and published shipping evidence as 15:12 UTC:
`docs/evidence/source-check-20261012T1544Z.json`, `docs/evidence/source-check-20261012T1650Z.json` and
`docs/evidence/source-check-20261012T1722Z.json`.
A bounded 15:19 UTC re-probe of previously blocked or unreachable candidates found no new viable vendor:
espressocoffeeshop.com's robots file allows only whitelisted crawlers (not bypassed), coffeecircle.com's
1,535-URL sitemap has no Lavazza product, bringit.co.il is not a store, and the other re-probed hosts are
still blocked or unreachable (`docs/evidence/vendor-probe-2026-10-12T1519Z.json`). The 15:35-15:41 UTC
3-60 pass searched Zap.co.il for the exact product and followed its two new storefront leads: FreshCafe
carries only Crema e Gusto capsules/pods (no ground listing), and Brioso serves a referer/JS gate instead
of public robots rules, so neither was bypassed or added. The same pass re-checked the Pucks cart widget
(still "shipping calculated at payment") and the CoffeeMan 8-pack page (still no courier price), so both
unknown-shipping labels remain current vendor evidence (`docs/evidence/vendor-probe-2026-10-12T1536Z.json`). The two ranked courier rates come with a
structured coverage caveat recorded from the vendors' terms pages (home delivery is subject to an
unpublished locality list), so the board discloses the geographic restriction instead of claiming
country-wide delivery.
Fixture-backed quote tests show that the delivered winner changes with the researched rates: Pucks wins at
500 g (₪90) and 1 kg (₪120, free shipping above the ₪100 threshold) while the CoffeeMan 8 × 250 g pack has
the lowest price per kilogram at 500 g (₪130/kg) without winning the delivered total. The Coffee4U listing
is part of the same one comparison even though the vendor states no blend wording, with its ₪15
pickup-point delivery labelled as an alternative rather than merged into the ranked total. Unknown
shipping can never win: a no-rate offer stays visible and unranked, covered by the quote-engine tests and
a QA-only browser fixture.
More vendors carrying the tracked product can be added by creating `src/vendors/<id>.js` with an
allowlisted product URL and a parser, registering it in `src/vendors/index.js`, and adding fixtures under
`tests/fixtures/`. A further bounded probe pass on 2026-10-12 (14:25 UTC) found no new viable vendor:
coffeeplus.co.il carries only Lavazza beans/capsules, cafeneto.co.il returns no usable search results,
and the other candidate domains do not resolve. The 14:39-14:46 UTC pass checked the CoffeeMan and Pucks
sitemaps and the Pucks ground-coffee category, the coffeepoint.co.il Wix product sitemap, and 21 further
candidate domains; it found no additional tracked ground listing and no new vendor. A second pass at
14:57-14:58 UTC checked pricez.co.il (two capsule results only), coffeebar.co.il (a café chain with no
shop), coffeelab.co.il (22 own-brand products), barista.co.il and mycafe.co.il (23 products), plus seven
non-resolving domains, with the same result. Every probe result is recorded in the table above instead of
guessed. A final 17:05 UTC search-engine re-probe (searx.be, search.inetol.net, baresearch.org,
opnxng.com and the DuckDuckGo HTML/lite endpoints) hit anti-bot pages on every endpoint, so no new vendor
domain surfaced; that blocker row is in the table above. A 17:07 UTC direct-domain batch (twelve further candidate storefronts) likewise found no
Crema e Gusto ground listing: two reachable shops carry no Lavazza, one serves a Cloudflare challenge and
the rest do not resolve; that row is in the table above.

## Product identity rules

The board compares **one product line: Lavazza Crema e Gusto vacuum-packed ground coffee**. Any listing
whose name cannot be tied to that line is rejected instead of being merged, and the retired lines
(Qualità Oro, Qualità Rossa, Suerte) are rejected with an explicit reason even if a historical page or an
old `?product=` URL still names them. Beans, capsules, pods and machines are rejected by
`classifyListing` in `src/catalog.js`. Blend wording is not a shopper-facing variant (owner correction,
2026-10-12): every eligible Crema e Gusto ground listing — including one that states no blend wording —
is compared in one board, and the wording a vendor prints stays attached to that offer only as raw
listing identity evidence. Pack weight and pack
count are parsed per listing and normalized to delivered ILS per kilogram; multipacks are never merged
with single packs into one offer.
