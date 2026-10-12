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

### CoffeeMan / Amigo — coffeeman.co.il (Israel)

Tracked listings (three Crema e Gusto offers, never merged):

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
  - Retrieved: 2026-10-12 11:04, 11:20, 11:29 and 12:57 UTC (adapters `pucks/1` and `pucks/2`)
  - Establishes: name "lavazza crema e gusto classico-250 גרם קפה טחון", SKU Lav69, GTIN 8000070038769, variant Classico, ground, 250 g single pack, price ₪30.00, schema.org JSON-LD availability `InStock`.
  - Shipping certainty: **unknown** — the page states shipping is calculated at checkout, so the offer stays visible and unranked. It is never treated as free.
  - Shipping research (2026-10-12 13:05 UTC): the public terms page `https://pucks.co.il/terms-and-privacy-policy` was also checked. Its "משלוחים והחזרות" section says the customer is charged delivery fees "according to rates set by Pucks from time to time" and promises delivery within 7 business days, but publishes no amount or free-shipping threshold; the cart widget repeats "המשלוח מחושב בתשלום" (shipping is calculated at payment). The unknown label is therefore evidence-based. Excerpt quotes: `docs/evidence/vendor-research-2026-10-12T1305Z-pucks-shipping.json`.

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

| roastmarket.com | 2026-10-12: storefront reachable; carries "Lavazza Qualità Oro ground coffee value pack 20x250g" (€132.99, InStock) in its public product sitemap | The public Delivery & Shipping page states "We deliver to mainland Spain and the Balearic Islands", handled by Correos. No evidence of delivery to Israel, so it is excluded rather than guessed. |
| freshmarket.co.il | 2026-10-12: `/robots.txt` reachable (`Crawl-delay: 4`) but the public sitemap only lists static and page URLs; search/catalog responses are a small client shell with a bot-detection script and no product data | No stable server-rendered product page from the runner; not bypassed. |
| carrefour.co.il / mega.co.il / victoryonline.co.il | 2026-10-12: carrefour.co.il and mega.co.il return HTTP 403 Cloudflare "Attention Required"; victoryonline.co.il returns a Cloudflare "Just a moment..." challenge for `/robots.txt` | Anti-bot protection; not bypassed. |
| coffeedesk.com | 2026-10-12: `/robots.txt` reachable, but the public catalog search for "lavazza" returns HTTP 404 with no ground listing | Not a source for the tracked products. |
| coffeeshop.co.il / ilcafe.co.il / coffeehen.co.il / yohananof.co.il | 2026-10-12 probes: coffeeshop.co.il timed out after 8 s, ilcafe.co.il and coffeehen.co.il did not resolve, yohananof.co.il failed at the network level | No reachable public product page from the runner. |
| coffeetime.co.il | 2026-10-12: reachable but serves a SeedProd placeholder shell (no product data, no robots rules) | Not an e-commerce source. |
| kaffeekontor.de | 2026-10-12: the domain redirects to a "domain for sale" page | Not an e-commerce source. |
| coffeeitalia.co.uk | 2026-10-12: Cloudflare "Just a moment..." challenge on `/robots.txt` | Anti-bot protection; not bypassed. |
| coffeeplus.co.il (טעמים פלוס) | 2026-10-12: reachable; its Lavazza line is beans and capsules only (Crema E Aroma beans, Gran Espresso, Gusto Forte 6 kg beans, A Modo Mio capsules) | No Crema e Gusto vacuum-packed ground listing, so it cannot carry the tracked product. |
| cafeneto.co.il | 2026-10-12: reachable; the public `?s=lavazza` search returns no usable product results | Not a source for the tracked product. |
| coffeexpress.co.il / coffee-shop.co.il / caffeitalia.co.il / espresso.co.il / italcoffee.co.il / coffeeandco.co.il / shop.lavazza.co.il / lavazzashop.co.il / cafeladino.co.il / coffee-world.co.il / coffeestore.co.il | 2026-10-12 probes: the domains do not resolve from the runner | No reachable public product page. |
| beans.co.il | 2026-10-12: redirects to an unrelated health site (pan-il.org) | Not an e-commerce source. |

Three independent adapters (CoffeeMan, Pucks and Coffee4U) meet and exceed the "at least two" requirement
with five real Crema e Gusto listings: three CoffeeMan offers (single 250 g ₪33, 4 × 250 g ₪124 and
8 × 250 g ₪240, all observed in stock; the two single/4-pack pages publish a verified ₪25 courier rate,
the 8-pack page does not), one Pucks offer (₪30, in stock, shipping calculated at checkout and therefore
unknown) and one Coffee4U offer (₪38, in stock, with a published ₪30 door-to-door courier rate and a
₪15 pickup-point alternative). The 2026-10-12 14:15 UTC live check re-observed exactly these five
listings: `docs/evidence/source-check-2026-10-12T1415Z.json`.
Fixture-backed quote tests show that the CoffeeMan 4 × 250 g pack wins at 1 kg (₪149 delivered) while two
single packs win at 500 g (₪91 delivered) — the comparison changes with the shopper's quantity using only
observed prices. The Coffee4U listing is ranked separately from Classico because the vendor does not state
the blend variant, with its ₪15 pickup-point delivery labelled as an alternative rather than merged into
the ranked total. Unknown shipping can never win: the cheaper Pucks item and the 8-pack stay visible and
unranked.
More vendors carrying the tracked product can be added by creating `src/vendors/<id>.js` with an
allowlisted product URL and a parser, registering it in `src/vendors/index.js`, and adding fixtures under
`tests/fixtures/`. A further bounded probe pass on 2026-10-12 (14:25 UTC) found no new viable vendor:
coffeeplus.co.il carries only Lavazza beans/capsules, cafeneto.co.il returns no usable search results,
and the other candidate domains do not resolve — all recorded in the table above instead of guessed.

## Product identity rules

The board compares **one product line: Lavazza Crema e Gusto vacuum-packed ground coffee**. Any listing
whose name cannot be tied to that line is rejected instead of being merged, and the retired lines
(Qualità Oro, Qualità Rossa, Suerte) are rejected with an explicit reason even if a historical page or an
old `?product=` URL still names them. Beans, capsules, pods and machines are rejected by
`classifyListing` in `src/catalog.js`, and blend variants (Classico, Forte, Ricco, Risveglio, decaf,
unspecified) are kept as separate variants so they are never merged into one comparison. Pack weight and pack
count are parsed per listing and normalized to delivered ILS per kilogram; multipacks are never merged
with single packs into one offer.
