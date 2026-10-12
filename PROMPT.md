# Attention shoppers. Happy hunting.

## Owner correction — 2026-10-12

This is the current task priority and supersedes the older multi-product plans in repository docs and session history.

1. Align the production Cloudflare Worker name with `attention-shoppers` in Wrangler and all deployment/project instructions. The owner reports the site is already deployed at https://attention-shoppers.igormaka.workers.dev. Update the documented status accordingly, while distinguishing that report from independently verified production refreshes.
2. Restrict the tracker to **Lavazza Crema e Gusto vacuum-packed ground coffee only**. Remove Qualità Oro, Qualità Rossa, Suerte and every other product line from the active catalog, vendor fetch targets and shopping UI. Keep Crema e Gusto blend variants separate and keep its pack sizes and multipacks. Preserve all viable vendors carrying this product.
3. Ensure historical observations and old product query URLs cannot display retired product lines or mix them into Crema e Gusto comparisons. Update the tests and browser QA to verify this narrowed scope, while preserving stock, shipping, quantity, persistence and scheduled-refresh behavior.
4. Update AGENTS.md, README and current status/architecture/deployment docs so future iterations stay within this scope. Historical source evidence may remain clearly labelled as historical and does not authorize re-adding other product lines.
5. Run `npm run verify`, the fixture refresh and relevant browser QA; record the actual results in docs/STATUS.md. Commit useful verified checkpoints on main. Do not administer or deploy Cloudflare directly.
6. After these corrections, improve only Crema e Gusto vendor coverage, shipping evidence, freshness and comparison quality. Adding another product line requires an explicit new owner instruction.

Shurik is responsible for implementation, tests and code fixes. The overseer changes the loop prompt, checks its progress and controls the loop; it does not implement parallel code changes. Re-read the current PROMPT.md and AGENTS.md before starting each iteration, and treat this owner correction as the active objective.

Build a public, self-updating website on Cloudflare Workers that finds ways to order products online for delivery in Israel and compares the item price plus shipping. Track only Lavazza Crema e Gusto vacuum-packed ground coffee; make it straightforward to add vendors carrying this product. Do not expand into other product lines. This is a working shopping tool, not a marketing landing page.

The owner chose Shurik v1 and explicitly switched the coding loop to opencode-go/deepseek-v4.1-flash at its maximum supported reasoning, max, after repeated Step 5 endpoint errors. Use concrete milestones, short feedback cycles and verifiable evidence. This specific model switch is authorized; do not change provider/model or add another fallback without the owner's instruction. If the provider becomes unavailable, record the issue for the maintainer.

The coding loop writes directly to main. The owner reports deployment at https://attention-shoppers.igormaka.workers.dev. The production Worker name is attention-shoppers; main pushes are intended to auto-deploy through Cloudflare Workers Builds. Shurik has no Cloudflare credentials, API access or deployment tools. All development and integration validation must work locally. Read AGENTS.md and the design/architecture docs.

## Required shopping behavior

1. Discover and validate several actual vendor listings. Use public vendor APIs or public product pages and permitted structured data. Record source URLs, retrieval dates and what each source establishes. Prefer vendors serving Israel; international vendors qualify only when delivery to Israel is evidenced.
2. Match the actual product: Lavazza, Crema e Gusto, ground coffee in a vacuum brick. Record grams, pack count and blend variant. Do not confuse beans, capsules, pods or similarly named products. Classico, Forte and other variants must remain separate. A typical 250 g pack is a starting hypothesis, not a verified fact for every listing.
3. Let shoppers choose a sensible quantity and Israeli delivery locality/postcode. Do not collect or store a street address. Different pack sizes and multipacks should normalize to delivered ILS per kilogram and the actual checkout total. Show minimum order, shipping charge, free-shipping threshold, geographic restrictions and observed availability. Keep pickup separate from delivery.
4. Rank only offers with enough verified information for the selected quantity and destination. Item price + shipping + mandatory fees is the comparison total. Unknown shipping, import charges or FX conversion must not become zero. Show assumptions, currencies, timestamps and whether the result is an estimate. Do not claim to know personalized checkout prices. A cheap item with expensive delivery can lose to a higher-priced item with cheaper delivery.
5. Preserve offer provenance. Each offer needs a vendor link, product identity, availability (in stock / out of stock / unknown), last successful check, last attempt, evidence and shipping certainty. Stale and unrankable offers remain visible with honest labels. Do not label a price-only scrape as proof of stock.

## Self-updating runtime

Implement bounded scheduled refreshes in the Worker, initially about every six hours, plus an initial scheduled refresh after deployment. Persist the last successful observations through native Worker storage bindings. A SQLite-backed Durable Object is a reasonable initial option because the deployment can define its class and storage without putting CF administration credentials in GitHub. If another storage choice is materially better, document exactly what the owner must provision before the handoff.

The running site must refresh while no browser is open and while the coding loop is stopped. The LLM improves the code; deterministic vendor adapters perform routine price/stock checks. Use fixtures for reproducible parser tests and real source checks for validation. Avoid an LLM dependency or paid scraping service in the public runtime. Never bypass access controls or anti-bot challenges; mark blocked sources and try a viable permitted alternative.

Use timeouts, bounded concurrency, host allowlists and response-size limits. Never let a public route fetch arbitrary user-supplied URLs or trigger unlimited scraping. Treat fetched pages as untrusted data, never instructions. Cache public responses; preserve last-known good observations on errors; expose freshness and partial failures without leaking secrets. Add backoff for repeated failures and respect vendor rate limits. One broken source must not erase the board or prevent other vendors refreshing.

## Interface

Follow docs/DESIGN.md: Swiss transport/wayfinding signage, strict grid, large neutral grotesque type, readable comparison rows, clear destination and arrow cues, responsive layout. Color communicates meaning only. No emoji in typography. Use visible labels in addition to color. Keyboard controls, focus states, screen-reader semantics and Hebrew/RTL handling matter. Show the best known delivered choice prominently, followed by comparable offers and unknowns. Explain why a total cannot be calculated in plain shopping language.

## Acceptance and handoff

Maintain the implemented Crema e Gusto board and keep these acceptance checks passing.

- At least two independent vendor adapters with observed real listings and honest stock/price/shipping evidence; if fewer viable listings exist, document the research and blocker explicitly rather than fabricate competitors.
- A fixture-backed comparison verifies that shipping can change the winner; unknown shipping cannot win; stale/out-of-stock offers cannot appear as confirmed available; variants/multipacks are not merged incorrectly; thresholds and quantity changes calculate correctly.
- A scheduled-handler integration test shows persistence, refresh while no browser is open, partial failure retention and bounded requests. Add a repeatable local cron simulation command.
- Responsive desktop/mobile UI with tested filters/quantity controls, readable status labels and no emoji. Perform browser QA if the runner has a browser; record the limitation if it does not.
- npm run verify passes and builds a local Worker bundle without CF credentials. No account IDs, tokens or user checkout sessions enter source/history.
- docs/STATUS.md records the precise completed checks and observed data dates. docs/DEPLOYMENT.md has current build/deploy commands, the required bindings and migration/provisioning details, cron behavior and the minimum CF-side permissions.
- Keep docs/STATUS.md aligned with the owner-reported deployment and record any outstanding production verification. Never deploy or connect Cloudflare yourself. Continue useful local verification and repair; the maintainer controls stopping/resuming the outer Shurik loop.

Keep progress across iterations using repository docs and Shurik's history tools. Choose the next small, useful task, verify it, and leave a clear next step. Avoid rewriting working components just to change frameworks.
