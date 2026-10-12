# Project instructions

Read PROMPT.md, docs/DESIGN.md, docs/ARCHITECTURE.md and docs/STATUS.md before work.

## Active scope (owner correction, 2026-10-12)

- Track **Lavazza Crema e Gusto vacuum-packed ground coffee only**. Qualità Oro, Qualità Rossa, Suerte
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
- Improve only Crema e Gusto vendor coverage, shipping evidence, freshness and comparison quality.

- Work directly on main, as authorized by the owner. Keep each checkpoint useful and testable. Do not change Shurik's control branch or engine.
- No direct Cloudflare administration: no CF API calls, deploy commands, login, token discovery, or remote resource creation. Local Wrangler dev and deploy --dry-run are allowed. The owner alone connects Cloudflare Workers Builds.
- Never request or publish secrets, addresses, sessions or customer checkout details. OPENCODE_API_KEY and the GitHub token stay in the runner environment.
- Never invent stock, product identity, prices, shipping, delivery times or successful refreshes. Publish evidence and timestamps; preserve unknowns and previous good data on errors.
- Colors must convey status or meaning. No emoji in the website typography. Use labels and monochrome vector wayfinding symbols.
- Run npm run verify before completing each change. Keep dependencies pinned and package-lock.json current.
- Finish each iteration by updating docs/STATUS.md with completed work, test results, next task and any blocking evidence.
- Mark the site ready for the owner's Cloudflare handoff only when the acceptance checks in PROMPT.md pass. Do not deploy it yourself.
