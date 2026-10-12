# Observed sources and vendor research

All observations below were retrieved by the deterministic adapters in `src/vendors/`
through the bounded fetcher. Re-run them at any time with `npm run check:sources`;
each run writes its evidence to `.shurik-local/sources/<timestamp>.json`; review snapshots are copied to
`docs/evidence/`.

## Tracked listings (live checks)

### CoffeeMan / Amigo — coffeeman.co.il (Israel)

Tracked listings (six offers across the two tracked products, never merged):

- **250 g single pack** — `https://www.coffeeman.co.il/product/250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico`
  - Retrieved: 2026-10-12 11:04, 11:20, 11:29, 11:48 and 12:57 UTC (adapters `coffeeman/1` and `coffeeman/2`)
  - Establishes: name "250 גרם קפה טחון lavazza Crema e Gusto Classico חוזק 7", SKU 930333, variant Classico, ground, 250 g single pack, price ₪33 (regular ₪36), schema.org availability `InStock`, and the published delivery options on the page: courier delivery ₪25, free self-pickup, plus a distribution-center option whose price is not published.
  - Shipping certainty: **verified** for the published courier rate. Coverage: country-wide (IL) per the vendor's own delivery options list.
- **4 × 250 g multipack** — `https://www.coffeeman.co.il/product/4-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA-250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico`
  - Retrieved: 2026-10-12 11:46, 11:48 and 12:57 UTC (adapters `coffeeman/1` and `coffeeman/2`)
  - Establishes: name "4 אריזות 250 גרם קפה טחון lavazza Crema e Gusto Classico", SKU 930334, variant Classico, ground, 4 × 250 g = 1000 g, price ₪124.00, schema.org availability `InStock`, courier ₪25 published on the page.
  - Shipping certainty: **verified** (₪25 courier, country-wide).
- **8 × 250 g multipack** — `https://www.coffeeman.co.il/product/8-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA-250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico`
  - Retrieved: 2026-10-12 11:46, 11:48 and 12:57 UTC (adapters `coffeeman/1` and `coffeeman/2`)
  - Establishes: name "8 אריזות 250 גרם קפה טחון lavazza Crema e Gusto Classico", SKU 930335, variant Classico, ground, 8 × 250 g = 2000 g, price ₪240.00, schema.org availability `InStock`.
  - Shipping certainty: **unknown** — the page lists the courier option without a price (only free self-pickup and an unpriced distribution-center option), so the offer stays visible and unranked rather than being treated as free.

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

- Parser: schema.org microdata in the legacy Windows-1255 pages; the adapter decodes the declared charset before parsing and uses the same parser for all six listings (Crema e Gusto and Qualità Oro).
- Fixtures: `tests/fixtures/coffeeman-product.windows-1255.html` (single, plus derived out-of-stock variant),
  `coffeeman-4pack-product.windows-1255.html` and `coffeeman-8pack-product.windows-1255.html` for Crema e Gusto,
  plus `coffeeman-qualita-oro-product.windows-1255.html`, `coffeeman-qualita-oro-4pack-product.windows-1255.html`
  and `coffeeman-qualita-oro-8pack-product.windows-1255.html` for Qualità Oro; all are minimized
  excerpts of the pages retrieved on 2026-10-12.

### Pucks — pucks.co.il (Ramla, Israel)

Tracked listings (two offers, never merged):

- **Crema e Gusto Classico 250 g** — `https://pucks.co.il/product/lavazza-crema-e-gusto-ground-coffee-250g`
  - Retrieved: 2026-10-12 11:04, 11:20, 11:29 and 12:57 UTC (adapters `pucks/1` and `pucks/2`)
  - Establishes: name "lavazza crema e gusto classico-250 גרם קפה טחון", SKU Lav69, GTIN 8000070038769, variant Classico, ground, 250 g single pack, price ₪30.00, schema.org JSON-LD availability `InStock`.
  - Shipping certainty: **unknown** — the page states shipping is calculated at checkout, so the offer stays visible and unranked. It is never treated as free.
- **Qualità Oro 250 g** — `https://pucks.co.il/product/lavazza-qualita-oro-ground-coffee-250gr`
  - Retrieved: 2026-10-12 12:57 UTC (adapter `pucks/2`)
  - Establishes: name "Lavazza Qualità Oro ground coffee -קפה טחון 250 גרם", SKU lav11, GTIN 8000070019911, ground coffee, 250 g single pack, price ₪35.00, schema.org JSON-LD availability `InStock`.
  - Variant: the page states no blend variant, so the listing is stored as *Variant not stated* and is only compared on the Qualità Oro board.
  - Shipping certainty: **unknown** — shipping is calculated at checkout; never treated as free.
- Parser: `application/ld+json` Product/Offer block on the public product pages.
- Fixtures: `tests/fixtures/pucks-product.html` (plus a derived out-of-stock variant and a preorder variant) and `tests/fixtures/pucks-qualita-oro-product.html`, minimized excerpts of the pages retrieved on 2026-10-12.

### Coffee4U / קופי פור יו — coffee4u.co.il (Tel Aviv, Israel)

- Product page: `https://www.coffee4u.co.il/product/lavazza-crema-e-gusto-250-gr-%D7%98%D7%97%D7%95%D7%9F`
- Retrieved: 2026-10-12 12:02 (research probe), 12:09 and 12:57 UTC (adapter `coffee4u/1` via live `npm run check:sources`)
- Establishes: name "Lavazza Crema e gusto 250 gr טחון", internal SKU 2010561, ground coffee, 250 g single pack, price ₪38, schema.org availability `InStock`, and the delivery options published next to the product:
  - free self-pickup at the shop;
  - delivery to a צ'יטה שופס pickup point, ₪15 (up to 5 kg, up to 7 business days);
  - door-to-door courier, ₪30 (1-5 business days).
- Shipping certainty: **verified** for the door-to-door courier rate, which is the ranked delivered amount. The ₪15 pickup-point service is stored as an alternative shipping option and is never used as the ranked total, and free self-pickup stays in the separate pickup list. The product page does not enumerate the courier's locality list, so the geographic caveat is stated instead of assumed.
- Variant: the page names only "Crema e gusto" and states no Classico, Forte or other blend variant, so the listing is stored as **variant unspecified** and is never merged into the Classico ranking. The board reports how many offers another variant excluded.
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
| rami-levy.co.il | HTTP 403 from the runner for product/search API and pages | Anti-bot protection. Not bypassed; no permitted alternative path found. |
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
| mojeek.com / Bing HTML / DuckDuckGo | 2026-10-12: mojeek returned HTTP 403, Bing HTML had no extractable result links, DuckDuckGo returned an anti-bot challenge | Search engines were used only for research; no viable new source was found through them. |

Three independent adapters (CoffeeMan, Pucks and Coffee4U) meet and exceed the "at least two" requirement
with nine real listings across two tracked products: six CoffeeMan offers (Crema e Gusto and Qualità Oro,
single / 4 × 250 g / 8 × 250 g each) with observed prices and stock, four of them with a verified ₪25
courier rate; two Pucks offers (Crema e Gusto ₪30, Qualità Oro ₪35) whose shipping stays unknown; and
one Coffee4U offer with an observed price, listed stock and two published shipping services.
Fixture-backed quote tests show that the CoffeeMan 4 × 250 g Crema e Gusto pack wins at 1 kg (₪149
delivered) while two single packs win at 500 g (₪91 delivered), and that Qualità Oro behaves the same way
on its own board (4-pack ₪150 at 1 kg versus four single packs at ₪173; two single packs ₪99 at 500 g) —
the comparison changes with the shopper's quantity using only observed prices. The Coffee4U listing is
ranked separately from Classico because the vendor does not state the blend variant, with its ₪15
pickup-point delivery labelled as an alternative rather than merged into the ranked total.
More vendors can be added by creating `src/vendors/<id>.js` with an allowlisted product URL and a
parser, registering it in `src/vendors/index.js`, and adding fixtures under `tests/fixtures/`.

## Product identity rules

The board compares **Lavazza ground coffee in a vacuum brick**: Lavazza Crema e Gusto and Lavazza
Qualità Oro are tracked as two separate products, and any listing whose name cannot be tied to one of
them is rejected instead of being merged. Beans, capsules, pods and machines are rejected by
`classifyListing` in `src/catalog.js`, and blend variants (Classico, Forte, Ricco, Risveglio, decaf,
unspecified) are kept as separate variants so they are never merged into one comparison. Qualità Oro
listings carry *Variant not stated* because the line publishes no blend variant. Pack weight and pack
count are parsed per listing and normalized to delivered ILS per kilogram; multipacks are never merged
with single packs into one offer.
