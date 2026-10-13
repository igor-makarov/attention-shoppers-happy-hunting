# Canton Zürich design system (web-application patterns)

Owner direction, 2026-10-12. This supersedes the earlier generic Swiss transport-signage brief. The
shopping board adapts the **Canton Zürich design system** for a compact web service: flat surfaces,
strict alignment, a responsive grid, a clear type hierarchy and concise disclosures. The product
identity stays our own; there is no cantonal crest, government wordmark or implied affiliation.

Primary references read before implementation:

- Design system overview — https://www.zh.ch/de/webangebote-entwickeln-und-gestalten.html
- Colors — https://www.zh.ch/de/webangebote-entwickeln-und-gestalten/inhalt/designsystem/design-grundlagen/farben.html
- Typography — https://www.zh.ch/de/webangebote-entwickeln-und-gestalten/inhalt/designsystem/design-grundlagen/typografie.html
- Layout and grid — https://www.zh.ch/de/webangebote-entwickeln-und-gestalten/inhalt/designsystem/design-grundlagen/layout-und-raster.html

## Tokens and roles

| Token | Value | Role |
| --- | --- | --- |
| Blau | `#0070B4` | Selected shopping context, the clearly labelled best known delivered offer, links and the focus outline. Used sparingly; vendor names are never painted arbitrary colors. |
| Softblau | `#EDF5FA` | Panel/background for the selected context and the best-offer rule. |
| Black | `#000000` | Primary text and neutral structure. |
| Secondary text | `#666666` | Notes, meta and secondary labels. |
| Surface | `#F7F7F7` | Subtle section surfaces. |
| Divider | `#CCCCCC` | Rules and cell borders. |
| Green | `#1A7F1F` on `#EBF6EB` | Verified in-stock labels only, always with the written status. |
| Red | `#D93C1A` on white | Unavailable/error labels only. |
| Amber | `#8A4B00` on `#FFF4E5` | Unknown shipping, unconfirmed coverage and stale evidence. This is a deliberate shopping-specific extension, **not** an official Canton Zürich token; it preserves the owner's uncertainty semantics. |
| Cyan | `#009EE0` | Non-text active indicator only (3.01:1 on white, so it is never used for small text). |
| Focus | `#0070B4` | 3 px outline on every focusable control (5.28:1 on white, 4.79:1 on Softblau). |

Meaning is never carried by color alone: every status keeps a written label (`In stock (observed)`,
`Shipping not published`, `Published rate (verified)`, `Checkout rate (observed, conditional)`,
`Coverage: …`) and the selected state is distinct. A rate that exists only in the vendor's anonymous
cart/checkout estimator is never called a published rate: it uses the `Checkout rate (observed,
conditional)` label so its quantity/destination condition stays visible.

## Typography

- **Inter**, explicitly supported by the official web-app typography guidance, self-hosted at
  `public/fonts/InterVariable.woff2` under the SIL Open Font License (`public/fonts/Inter-OFL.txt`),
  with a neutral system fallback (`system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif`).
- Recommended font features `ss07`, `ss08`, `cv03`, `cv04`, `cv10` are enabled globally; prices and
  per-kilogram values use tabular numerals (`.num`).
- Headings are left aligned and compact. The home title reads **"Attention shoppers"** with no trailing
  period; the product page heading names the product (**"Lavazza Crema e Gusto"**) with compact
  masthead branding and an "All products" link back to the index. There is no giant branding hero and
  no repeated comparison explanation on both pages.
- No emoji in the typography. Wayfinding uses plain text and monochrome glyphs; Hebrew vendor/product
  text is wrapped in isolated `dir="auto" lang="he"` spans.

## Pages

- **Home `/` — product index.** Renders one card per tracked catalog product (today exactly one:
  Lavazza Crema e Gusto vacuum-packed ground coffee). A card carries identity, packaging and one
  compact line naming the tracked vendors/listings, plus a link to `/product/<id>`. The comparison
  explanation and caveats are not repeated on the index; the full comparison board is not rendered on
  the home route. A legacy board link that still carries
  `product`/`grams`/`dest` state is forwarded to the product page with that state intact; an obsolete
  `variant=` parameter is discarded, not forwarded into a second view.
- **Product `/product/<id>` — decision page.** Directly loadable and shareable; the path plus
  `?grams=&dest=` query restores quantity and locality (a retired-line or unknown id falls back to the
  tracked product with a written notice). There is no blend/variant control, menu entry or warning: every
  eligible tracked listing — including one that states no blend wording — is in the one comparison, and
  a listing's raw wording and any stated blend wording stay inside `Offer details and check history` as
  provenance. Default view: compact product identity and the quantity/locality controls, then the best
  eligible offer with vendor, stock, accurate pack/grams, the three money values and a one-line
  conditional warning. Everything else is progressively disclosed:
  `Delivery options and conditions` and `Offer details and check history` per offer, one
  `Compare other offers (n)` disclosure for the rest of the ranking, one collapsed
  `Self-pickup options (n)` disclosure, and an `Offers with missing information (n)` disclosure that is
  only rendered when something is actually missing.

## Layout and components

- A single centered column (max 1240 px) with a responsive control grid that reflows on mobile; on
  small screens the quantity group and the locality group each take the full row, so the selected
  locality text is not clipped inside a half-width native `<select>` (verified at 390 px). No
  horizontal page scrolling at 1440 px or 390 px.
- **Offer cards** replace the former wide comparison table. The best known delivered offer carries a
  blue rule, the written tag "Best known delivered total" and its selection context; other ranked
  offers state their difference (`+₪x vs best delivered total`).
- Each card keeps the decision values together in one `.totals` row: **item subtotal**, **shipping
  charge, named delivery method and written certainty label** and the **delivered total** plus
  per-kilogram normalization. The method (`Home delivery`, `Pickup-point delivery`,
  `Distribution-center delivery`, `Self-pickup`, or `Delivery method not stated`) is rendered separately
  from the certainty label, so a shopper can tell what the charge buys. When a published quantity
  promotion reduced the subtotal, the item-subtotal cell adds one muted line (`10% promotion applied —
  was ₪264.00`); the vendor's own wording and the evidence stay inside the offer details. On mobile the
  three cells stack but remain in the same card, inside the first viewport.
- Conditions are one short list per offer (free-shipping threshold, minimum order, delivery area,
  alternative services, self-pickup, delivery time, cart-size limit) inside that offer's
  `Delivery options and conditions` disclosure. A coverage caveat is written once inside the same
  disclosure; the card face keeps only a one-line amber qualification. A free condition that comes
  from an anonymous-cart observation is written as observed and conditional. CoffeeMan's free
  observations are exact cart conditions, not a threshold: when the current cart matches one, the
  shipping cell reads `Free (observed for this cart)`, the certainty line adds
  `free condition cart-observed`, and the qualifier names the exact observed cart and says it must be
  confirmed at checkout; when the cart does not match (for example 3 kg of singles), the published base
  rate is shown and, if the subtotal is at or above an observed free subtotal, the qualifier says free
  delivery was observed only on specific carts. A published threshold (Pucks' free above ₪100) keeps
  the `Free (threshold met)` wording. An observed free condition is never merged into the published
  rate label. Pickup-only offers live in their
  own collapsed disclosure and never compete in the delivered ranking; each is one compact row (vendor,
  pack/quantity, item subtotal, pickup fee and the written "Self-pickup, not delivery"), with the
  repeated pickup terms behind a `Pickup terms` disclosure.
- Debug/provenance metadata (previous checks, failed attempts, the applied shipping-policy version, the
  applied promotion's vendor wording and evidence, the adapter's shipping terms, shipping evidence, FX,
  per-vendor refresh state, next source check) lives behind `Offer details and check history` /
  `Refresh diagnostics` disclosures instead of the first screen. A cart-observed alternative (for
  example CoffeeMan's distribution-center delivery) carries its cart condition in the short label and
  its full observation in the disclosure.
- Unknown shipping says **"Shipping not published"** with the exact reason and is never shown as zero;
  a published rate with unconfirmed destination coverage is labelled as such, not as a guaranteed
  checkout total.
- A ranked offer whose most recent vendor check failed shows one short amber card-face line
  (`Last check failed — showing the last successful observation.`) directly under its money values;
  the attempt time, the error and the last successful check stay in `Offer details and check history`,
  and the footer names the failing source. This warning is deliberately visible: the price still ranks
  but may be out of date, which can change the shopping decision.

## Validation (2026-10-12)

- Token contrast (computed): black/white 21.0:1, secondary/white 5.74:1, secondary/surface 5.36:1,
  Blau/white 5.28:1, white/Blau 5.28:1, Blau/Softblau 4.79:1, amber/amber-soft 6.26:1,
  green/green-soft 4.61:1, red/white 4.55:1, cyan/white 3.01:1 (non-text only).
- Rendered contrast and interaction: `scripts/browser-qa.mjs` walks visible text in the offer cards,
  controls, footer, masthead and disclosures and compares the computed text color with the effective
  background; the suite passes **88/88** offline and **85/85** live production checks (2026-10-13,
  iteration 3-80) with no contrast violations, no horizontal overflow, no emoji, no `[object HTML…]`
  artifacts and 3 px `rgb(0, 112, 180)` focus outlines.
- First mobile screen (390×844 window; measured viewport 390×701 in headless Chrome): the best card
  starts at y≈389, item subtotal and shipping end at y≈629, the named method ends at y≈565 and the
  delivered total ends at y≈678 — all inside the viewport before scrolling. The product page is
  ≈1,589 px tall at 390 px (five offers + disclosures) versus ≈5,491 px before the redesign.
- Home page: the single product card is visible on the first mobile screen, the home route renders no
  offer cards or totals, and the card link navigates to the directly loadable product URL. Screenshots:
  `docs/evidence/ui-review/{home,product}-{desktop-1440x1000,mobile-390x844}-20261012.png`.
- The available file-read tool rejects PNG input ('reading images is not supported'), so screenshots
  were not machine-inspected by the model; the visual review above is based on rendered layout/DOM
  measurements, with screenshots kept as artifacts for a human reviewer. No image-based visual review
  is claimed.
