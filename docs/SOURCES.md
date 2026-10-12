# Observed sources and vendor research

All observations below were retrieved by the deterministic adapters in `src/vendors/`
through the bounded fetcher. Re-run them at any time with `npm run check:sources`;
each run writes its evidence to `.shurik-local/sources/<timestamp>.json`.

## Tracked listings (live checks)

### CoffeeMan / Amigo — coffeeman.co.il (Israel)

- Product page: `https://www.coffeeman.co.il/product/250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico`
- Retrieved: 2026-10-12 11:04 UTC and 11:20 UTC (adapter `coffeeman/1`)
- Establishes: name "250 גרם קפה טחון lavazza Crema e Gusto Classico חוזק 7", SKU 930333, variant Classico, ground, 250 g single pack, price ₪33 (regular ₪36), schema.org availability `InStock`, and the published delivery options on the page: courier delivery ₪25, free self-pickup, plus a distribution-center option whose price is not published.
- Parser: schema.org microdata in the legacy Windows-1255 page; the adapter decodes the declared charset before parsing.
- Shipping certainty: **verified** for the published courier rate. Coverage: country-wide (IL) per the vendor's own delivery options list.

### Pucks — pucks.co.il (Ramla, Israel)

- Product page: `https://pucks.co.il/product/lavazza-crema-e-gusto-ground-coffee-250g`
- Retrieved: 2026-10-12 11:04 UTC and 11:20 UTC (adapter `pucks/1`)
- Establishes: name "lavazza crema e gusto classico-250 גרם קפה טחון", SKU Lav69, GTIN 8000070038769, variant Classico, ground, 250 g single pack, price ₪30.00, schema.org JSON-LD availability `InStock`.
- Parser: `application/ld+json` Product/Offer block on the public product page.
- Shipping certainty: **unknown** — the page states shipping is calculated at checkout, so the offer stays visible and unranked. It is never treated as free.

### Bank of Israel — official exchange rates (reference data)

- Feed: `https://www.boi.org.il/currency.xml` (JSON mode used by the adapter)
- Retrieved: 2026-10-12 11:20 UTC; the published rate table is dated 2026-10-09.
- Establishes: official ILS reference rates (e.g. USD 3.055) used only to convert non-ILS prices into an **estimate**; a missing rate never becomes zero and blocks ranking instead.

## Sources researched and not included

| Source | Observed | Why it is not an adapter |
| --- | --- | --- |
| amazon.com (`/dp/B00IIFU5ZE`) | Product page reachable 2026-10-12; listing "Lavazza Crema e Gusto Ground Coffee, 8.8-Ounce Bricks (Pack of 3)", in stock | Delivery of this specific listing to Israel (and import fees) is only shown after setting a delivery address at checkout. No public evidence of IL delivery, so it cannot rank and is excluded per the vendor rules. |
| rami-levy.co.il | HTTP 403 from the runner for product/search API and pages | Anti-bot protection. Not bypassed; no permitted alternative path found. |
| tivtaam.co.il | HTTP 200 but an AngularJS/ZuZ single-page shell with no product data in the HTML | Product data only appears after client-side API calls; not a stable public product page or documented API. |
| espresso-international.co.uk (Shopify suggest API) | Reachable 2026-10-12; does not carry Lavazza Crema e Gusto | No matching product. |
| eBay / iHerb | HTTP 403 from the runner during earlier research | Anti-bot protection; not bypassed. |

Two independent adapters (CoffeeMan and Pucks) meet the "at least two" requirement with real listings.
More vendors can be added by creating `src/vendors/<id>.js` with an allowlisted product URL and a
parser, registering it in `src/vendors/index.js`, and adding fixtures under `tests/fixtures/`.

## Product identity rules

The board only accepts Lavazza Crema e Gusto **ground coffee in a vacuum brick**. Beans, capsules,
pods and machines are rejected by `classifyListing` in `src/catalog.js`, and blend variants
(Classico, Forte, Ricco, Risveglio, decaf, unspecified) are kept as separate variants so they are
never merged into one comparison. Pack weight and pack count are parsed per listing and normalized
to delivered ILS per kilogram.
