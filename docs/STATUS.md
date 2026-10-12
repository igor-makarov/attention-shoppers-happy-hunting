# Project status

Stage: Scaffold; not ready for Cloudflare handoff.

- Public repository created for the shopping board.
- Shurik v1 consumer workflow configured for opencode-go/step-5-preview-free, reasoning high, task branch main, no PR.
- The owner has added OPENCODE_API_KEY, verified by secret name only. The first owner handoff is complete. Development is delegated to the Shurik loop on main; consult Actions and shurik-control/main for live state.
- Cloudflare is not connected. No CF API token, account credential or deployment workflow exists in GitHub.
- Worker/static-assets scaffold shows the target coffee and an honest research-pending state. /api/catalog has no offers and no successful-check timestamp.
- Vendor research, adapters, quote ranking, persistence and scheduled refreshes remain to be implemented by Shurik.
- Bootstrap verification passed: three Worker tests, Wrangler 4.149.0 deploy --dry-run, and actionlint with ShellCheck for both workflows. No real deployment or model request was performed.
- Model compatibility resolved by Shurik v1.1.10 (v1 commit b9b3466cbe0e891ff92739ac45a667b7b6bb042a): unlisted IDs use the native provider transport with provisional metadata. step-5-preview-free is accepted by its exact name with high reasoning; no live catalog refresh or paid-model substitution. Upstream CI passed.
- The consumer workflow now declares the reasoning dispatch field that Shurik includes in continuation requests. Workflow validation and CI passed after that correction.
- Live launch on 2026-10-12: generation 2 is running on main and automatically dispatching iterations. Attempts 2-1, 2-2 and 2-3 reached OpenCode but each returned HTTP 429 with "Upstream request failed: Endpoint is unavailable." They produced zero model tokens and no task changes. OpenCode's public Go model list still includes step-5-preview-free. This is a recorded provider response, not evidence that the key is invalid or that the model is globally unavailable. The loop continues retrying the requested model without substitution.
- Codex Cloud repository setup prepared on 2026-10-12: `.codex/setup.sh` checks Node 24.14.0, installs locked dependencies with lifecycle scripts disabled, and runs verification. `docs/CODEX_CLOUD.md` records the Install script, Start skill and writable configuration/cache variables. A fresh installation, all three Worker tests and Wrangler 4.149.0 deploy --dry-run passed under Node 24.14.0. Local Wrangler served `/health`, `/api/catalog` and `/` with HTTP 200; the catalog retained its empty offers and unknown successful-check timestamp. Wrangler initially failed writing to the read-only home directory; using a writable `XDG_CONFIG_HOME` resolved that failure.
- A saved/published Codex Cloud environment has not been created. This task can inspect runtime readiness but has no environment-creation or publishing tool. Next environment step: select this repository in Settings → Codex Cloud → Environments, apply the documented setup, review it and publish. No Cloudflare administration or real deployment was performed.

Next task: once OpenCode serves the requested model, implement the first evidence-backed vendor adapters and quote schema. Cloudflare remains disconnected for the second owner handoff; the tracker is not ready yet.
