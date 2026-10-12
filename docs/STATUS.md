# Project status

Stage: Scaffold; not ready for Cloudflare handoff.

- Public repository created for the shopping board.
- Shurik v1 consumer workflow configured for opencode-go/step-5-preview-free, reasoning high, task branch main, no PR.
- SHURIK_ENABLED is false. No model run has been started. The owner must add OPENCODE_API_KEY first.
- Cloudflare is not connected. No CF API token, account credential or deployment workflow exists in GitHub.
- Worker/static-assets scaffold shows the target coffee and an honest research-pending state. /api/catalog has no offers and no successful-check timestamp.
- Vendor research, adapters, quote ranking, persistence and scheduled refreshes remain to be implemented by Shurik.
- Bootstrap verification passed: three Worker tests, Wrangler 4.149.0 deploy --dry-run, and actionlint with ShellCheck for both workflows. No real deployment or model request was performed.
- Model compatibility issue found during setup: Shurik v1's pinned Pi AI catalog lacks step-5-preview-free. Resolve the engine's model discovery before launching the loop; do not substitute a paid model.

Next task: resolve model catalog compatibility, then owner key handoff; implement the first evidence-backed vendor adapters and quote schema after launch.
