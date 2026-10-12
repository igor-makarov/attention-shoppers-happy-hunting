# Attention shoppers. Happy hunting.

A public online shopping board for delivery in Israel, starting with **Lavazza Crema e Gusto vacuum-packed ground coffee**. The goal is to compare actual availability and item price plus shipping for a selected quantity and destination, with visible source evidence and freshness.

Swiss signage design, meaningful status colors, no emoji typography. Unknown shipping is never silently treated as free.

This initial commit is a deployable scaffold, not a completed price tracker. Shurik builds the remaining functionality from [PROMPT.md](PROMPT.md). See [current status](docs/STATUS.md), [design](docs/DESIGN.md) and [architecture](docs/ARCHITECTURE.md).

## Coding loop

The workflow uses [igor-makarov/shurik@v1](https://github.com/igor-makarov/shurik), opencode-go/step-5-preview-free and high reasoning. The owner chose direct work on main and has added the OPENCODE_API_KEY Actions secret. The first handoff is complete; the main loop will develop the tracker while Cloudflare remains disconnected. Check the Actions page and shurik-control/main for live loop state.

Shurik v1.1.10 accepts the exact model ID even when it is absent from Pi AI's bundled catalog, using the native OpenCode Go transport and explicit high reasoning. It does not auto-refresh the catalog. No paid-model fallback is permitted.

## Deployment and refreshing

The owner will enable auto-deploy on main pushes from **Cloudflare Workers Builds** at the second handoff. GitHub stores no CF credentials and has no deployment job. Once implemented, Worker Cron Triggers and native runtime storage will refresh the offer board independently of the coding loop.

Follow [the two handoffs](docs/DEPLOYMENT.md). Agent-authored code can affect the CF build and production Worker once auto-deploy is enabled; keeping CF API credentials out of Shurik does not remove that authority.

## Develop locally

Node 24.14.0, pinned dependencies:

```sh
npm ci --ignore-scripts
npm run verify
npm run dev
```

The verification build is Wrangler deploy --dry-run and does not publish to Cloudflare.

For a reusable Codex workspace, follow the [Codex Cloud setup](docs/CODEX_CLOUD.md).
