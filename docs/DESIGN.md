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
- Headings are left aligned and compact. The hero reads **"Attention shoppers"** with no trailing
  period, keeps no sub-copy, and does not push the offers below the first screen: the best card top is
  ≈452 px at 1440×857 and ≈829 px inside a 390×844 first screen (measured 2026-10-12, iteration 3-70).
  The ranked-section intro carries the selected product/pack/quantity/destination once; the quantity
  buttons stay on one 44 px row at 390 px.
- No emoji in the typography. Wayfinding uses plain text and monochrome glyphs; Hebrew vendor/product
  text is wrapped in isolated `dir="auto" lang="he"` spans.

## Layout and components

- A single centered column (max 1240 px) with a responsive control grid that reflows to one column on
  mobile. No horizontal page scrolling at 1440 px or 390 px.
- **Offer cards** replace the former wide comparison table. The best known delivered offer carries a
  blue rule, the written tag "Best known delivered total" and its selection context; other ranked
  offers state their difference (`+₪x vs best delivered total`).
- Each card keeps the decision values together in one `.totals` row: **item subtotal**, **shipping
  charge and service** (with the written certainty label) and the **delivered total** plus per-kilogram
  normalization. On mobile the three cells stack but remain in the same card, inside the viewport.
- Conditions are one short list per offer (free-shipping threshold, minimum order, delivery area,
  alternative services, self-pickup, delivery time, cart-size limit). A coverage caveat is written once
  on its card; pickup-only offers live in their own section and never compete in the delivered ranking.
  Pickup-only entries are one compact row each (vendor, pack/quantity, item subtotal, pickup fee and the
  written "Delivered total: Not applicable"), with the repeated pickup terms behind a `Pickup terms`
  disclosure, so three pickup offers cost about half the vertical space they used to.
- Debug/provenance metadata (previous checks, failed attempts, the adapter's shipping terms,
  shipping evidence, FX, per-vendor refresh state, next source check) lives behind
  `Check history and evidence` / `Refresh diagnostics` disclosures instead of the first screen.
  A cart-observed alternative (for example CoffeeMan's distribution-center delivery) carries its
  cart condition in the short label and its full observation in the disclosure.
- Unknown shipping says **"Shipping not published"** with the exact reason and is never shown as zero;
  a published rate with unconfirmed destination coverage is labelled as such, not as a guaranteed
  checkout total.

## Validation (2026-10-12)

- Token contrast (computed): black/white 21.0:1, secondary/white 5.74:1, secondary/surface 5.36:1,
  Blau/white 5.28:1, white/Blau 5.28:1, Blau/Softblau 4.79:1, amber/amber-soft 6.26:1,
  green/green-soft 4.61:1, red/white 4.55:1, cyan/white 3.01:1 (non-text only).
- Rendered contrast: `scripts/browser-qa.mjs` walks visible text in the offer cards, controls, hero,
  footer, pickup and unknown sections and compares the computed text color with the effective
  background; the check passes with no violations (82/82 offline checks, 2026-10-12 iteration 3-71).
- Keyboard: Tab reaches the quantity controls, the focus outline is 3 px `rgb(0, 112, 180)` and Enter
  activates the focused quantity; the total recalculates. Skip link and `main` landmark are present.
- Layout: production (read-only GET) at 1440 px has no table, no horizontal overflow and the delivered
  total cell ends at x=1290; at 390 px there is no horizontal overflow, quantity buttons keep a 44 px
  tap target and pickup rows are grouped. Measurements and screenshots:
  `docs/evidence/visual-review/2026-10-12-production-layout.json`.
- The available file-read tool rejects PNG input, so screenshots were not machine-inspected by the
  model; the visual review above is based on rendered layout/DOM measurements, with screenshots kept
  as artifacts for a human reviewer.
