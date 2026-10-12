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

Next task: launch the loop and implement the first evidence-backed vendor adapters and quote schema. Cloudflare remains disconnected for the second owner handoff.
