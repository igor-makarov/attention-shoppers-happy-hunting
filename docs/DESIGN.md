# Swiss signage design

The earlier detailed design discussion was not recoverable from the available chat history. This brief records the explicit direction and subsequent owner corrections for this project.

- Use Swiss transport signage as the visual reference: strict alignment, modular grids, numbered sections, clear hierarchy, flat surfaces and strong rules between comparison rows.
- Helvetica/Arial or an equivalent neutral grotesque. Large, tightly composed headings; tabular numerals for ILS totals; comfortable text sizes for conditions and timestamps. Use local/system fonts initially.
- Paper/white backgrounds and near-black type form the neutral structure. Color never decorates an arbitrary heading or vendor.
- Green means verified in-stock availability. Red means out of stock/unavailable. Amber/yellow means pending, uncertain or stale. Always write the status as text; color alone is insufficient. “Best delivered total” should be stated explicitly without a second ambiguous green meaning.
- No emoji in typography. Arrows and wayfinding marks must be monochrome SVG or unambiguous text glyphs that cannot render as colorful emoji. No flags, shopping-cart emoji, coffee emoji or emoji badges.
- Clear rows with consistent columns: vendor, pack/quantity, item price, shipping, delivered total, stock and checked time. At narrow widths reflow each row while preserving the same hierarchy; do not hide shipping conditions.
- Buttons and links require visible keyboard focus. Aim for WCAG AA contrast. Support RTL fragments and Hebrew vendor/product text with correct directionality.
- Prefer factual shopping copy. Distinguish checked data, inferred estimates, stale observations and unknowns. Avoid fake success counters and invented prices.
