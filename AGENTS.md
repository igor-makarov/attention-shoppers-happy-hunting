# Project instructions

Read PROMPT.md, docs/DESIGN.md, docs/ARCHITECTURE.md and docs/STATUS.md before work.

## Active scope (owner correction, 2026-10-12)

- **Current model (owner instruction, 2026-10-15):** Shurik uses `opencode-go/step-5-preview-free` with `high` reasoning, the model's highest supported level. This explicitly supersedes older DeepSeek/max instructions. Preserve the existing task and history, and do not silently change models on a provider failure.
- **New owner instruction, 2026-10-15:** also track **plain Tnuva 5% cottage cheese in standard 250 g tubs**, with exact batches of **4, 6, 8 and 10**, minimizing the total including shipping and mandatory fees. Show **delivery options only** for this product. This explicitly authorizes this addition and supersedes older single-product instructions. Grocery prices, stock, quantity limits, minimum orders and delivery charges still require evidence. Three grocery adapters are registered: Tiv Taam (₪6.10/tub, ₪29.90 delivery, ₪300 minimum), Super Yuda (₪6.70, ₪35, ₪150 minimum) and Duchan Ganei Shmuel (₪6.30, ₪28, no minimum, free above ₪599). Duchan's local גן שמואל area ranks the four exact batches from anonymous public cart quotes (₪53.20/₪65.80/₪78.40/₪91.00) and is exposed as the selectable `ganei-shmuel` destination; the default Tel Aviv–Yafo locality stays unranked with the exact minimum/coverage reasons. Do not manufacture prices, rank a below-minimum batch, or suggest that a coffee refresh checked the cheese.
- Keep tracking **Lavazza Crema e Gusto vacuum-packed ground coffee**. Qualità Oro, Qualità Rossa, Suerte
  and every other Lavazza product line are retired: they must not be vendored, fetched, culled or shown
  in the shopping UI. Adding another product line requires an explicit new owner instruction.
- Keep Crema e Gusto pack sizes/multipacks as distinct offers, but there is **no blend/variant feature**
  (owner correction, 2026-10-12): every eligible Crema e Gusto vacuum-packed ground listing — including
  a listing that states no blend wording — takes part in one comparison for the selected quantity,
  locality and delivery method. Do not add a blend selector, unobserved-variant menu entries, variant
  warnings, "other variant" counts/links or variant-specific product cards. Raw vendor listing wording
  and any stated blend wording may stay as evidence inside optional offer details, never as a filter or
  a repeated badge, and an unstated listing must never be relabelled as Classico. Old shared URLs with
  an obsolete `variant=` parameter keep their product/quantity/locality and resolve to this unified
  comparison.
- The production Worker name is `attention-shoppers` and must match `wrangler.jsonc`. The owner reports
  the site deployed at https://attention-shoppers.igormaka.workers.dev; on 2026-10-12 the loop independently
  verified the public URL, one request-triggered refresh and the single-product scope with read-only GETs
  (docs/evidence/production-verification-20261012T1554Z.json, docs/evidence/production-probe-20261012T1653Z.json).
  Re-check production read-only with `npm run probe:production` (fixed public GETs, no credentials, no
  deploy). Keep owner reports and verified evidence distinct in docs/STATUS.md, and never administer or
  deploy Cloudflare.
- Improve coverage, shipping evidence, freshness and comparison quality for these two authorized products only.

- Work directly on main, as authorized by the owner. Keep each checkpoint useful and testable. Do not change Shurik's control branch or engine.
- No direct Cloudflare administration: no CF API calls, deploy commands, login, token discovery, or remote resource creation. Local Wrangler dev and deploy --dry-run are allowed. The owner alone connects Cloudflare Workers Builds.
- Never request or publish secrets, addresses, sessions or customer checkout details. OPENCODE_API_KEY and the GitHub token stay in the runner environment.
- Never invent stock, product identity, prices, shipping, delivery times or successful refreshes. Publish evidence and timestamps; preserve unknowns and previous good data on errors.
- Colors must convey status or meaning. No emoji in the website typography. Use labels and monochrome vector wayfinding symbols.
- Run npm run verify before completing each change. Keep dependencies pinned and package-lock.json current.
- For changes to public JavaScript, HTML or CSS, also run npm run qa:browser, inspect the affected desktop/mobile captures, and require zero JavaScript errors before publishing a checkpoint. A successful bundle does not verify page rendering.
- Finish each iteration by updating docs/STATUS.md with completed work, test results, next task and any blocking evidence.
- Mark the site ready for the owner's Cloudflare handoff only when the acceptance checks in PROMPT.md pass. Do not deploy it yourself.
