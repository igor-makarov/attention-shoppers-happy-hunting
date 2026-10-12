# Project instructions

Read PROMPT.md, docs/DESIGN.md, docs/ARCHITECTURE.md and docs/STATUS.md before work.

- Work directly on main, as authorized by the owner. Keep each checkpoint useful and testable. Do not change Shurik's control branch or engine.
- No direct Cloudflare administration: no CF API calls, deploy commands, login, token discovery, or remote resource creation. Local Wrangler dev and deploy --dry-run are allowed. The owner alone connects Cloudflare Workers Builds.
- Never request or publish secrets, addresses, sessions or customer checkout details. OPENCODE_API_KEY and the GitHub token stay in the runner environment.
- Never invent stock, product identity, prices, shipping, delivery times or successful refreshes. Publish evidence and timestamps; preserve unknowns and previous good data on errors.
- Colors must convey status or meaning. No emoji in the website typography. Use labels and monochrome vector wayfinding symbols.
- Run npm run verify before completing each change. Keep dependencies pinned and package-lock.json current.
- Finish each iteration by updating docs/STATUS.md with completed work, test results, next task and any blocking evidence.
- Mark the site ready for the owner's Cloudflare handoff only when the acceptance checks in PROMPT.md pass. Do not deploy it yourself.
