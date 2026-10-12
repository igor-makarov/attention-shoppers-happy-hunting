# Architecture and authority

There are two independent loops:

1. Shurik on GitHub Actions develops and checkpoints source to main. It uses only OPENCODE_API_KEY and the repository GITHUB_TOKEN. Its state/history is public on shurik-control/main.
2. The deployed Worker refreshes vendor observations using deterministic scheduled adapters, persists them through runtime bindings and serves the public comparison board. It does not need Shurik or an LLM to keep refreshing.

Cloudflare Workers Builds will be connected by the owner after the second handoff. It observes main pushes and performs validation before deploying. No CF deployment workflow or CF API secret belongs in GitHub. Exclude shurik-control/* and all other branches from Cloudflare builds and previews.

This prevents Shurik's Actions process from directly authenticating to CF. It is not a sandbox for agent-authored code: Shurik writes main, so its code and configuration can influence the CF build and live Worker. CF build commands can run source-controlled code in a credentialed environment. Restrict the CF build token to this Worker and the minimum required permissions; avoid broad account permissions or unrelated build/runtime secrets. Prefer runtime bindings over administrative API tokens. Never give the public Worker an administrative CF token.

GitHub normally does not trigger another push workflow for a push using GITHUB_TOKEN. Do not rely on CI being automatically triggered by every Shurik checkpoint. Shurik must run local verification, and Cloudflare's build command must run npm run verify for every deployment. After connecting CF, verify one actual Shurik push reaches Workers Builds; never assume third-party webhook behavior from GitHub Actions behavior alone.

Start with vendor-specific adapters, a shared product/offer schema, a pure quote/ranking module, persistence and the scheduled-handler pipeline. Keep fetching separate from parsing and pricing. Fixture tests should cover unstable vendor HTML and quote edge cases. Store observation timestamps independently from refresh-attempt timestamps. Public routes are read-only and use cached snapshots; public shoppers must not be able to initiate unlimited vendor traffic.

Initial scaffold: static assets plus /health and /api/catalog. No real offers, storage or cron are implemented yet. The target product exists, but prices and availability remain explicitly unknown. The coding agent is responsible for building and proving the runtime described in PROMPT.md.
