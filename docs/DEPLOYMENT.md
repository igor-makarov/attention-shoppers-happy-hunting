# Two owner handoffs

## 1. OpenCode key

Add OPENCODE_API_KEY under repository Settings → Secrets and variables → Actions → New repository secret. Paste it only in GitHub's secret form, never into chat, a prompt, a dispatch input or a commit.

The repository variable SHURIK_ENABLED starts false, so scheduled recovery and manual dispatch cannot start a model loop before setup is finished. After the key is present and model compatibility is verified, the maintainer sets it true and dispatches:

```sh
gh workflow run shurik.yml --repo igor-makarov/attention-shoppers-happy-hunting --ref main \
  -f command=start -f loop_id=main -f seconds=1800
```

Provider, model and reasoning are fixed in the workflow's control action to opencode-go / step-5-preview-free / high. They cannot accidentally be replaced by a paid model through dispatch defaults. The initial loop writes directly to main. Unless a deadline is supplied it continues until stopped, including after ordinary agent answers. The free model is a limited-time provider offer; availability is not guaranteed.

To stop, dispatch command=stop and loop_id=main. Record the durable stop before turning SHURIK_ENABLED false. To resume, use command=resume, loop_id=main; the workflow supplies high reasoning again. Control/session history and Actions logs are public; do not add private material to this task.

## 2. Cloudflare Git integration

Wait until the maintainer verifies the agent's Ready for Cloudflare handoff status, then stop the coding loop for the owner setup. The owner connects the repo from the Cloudflare dashboard, not through Shurik.

- Workers & Pages → Create application → Import a repository.
- Select igor-makarov/attention-shoppers-happy-hunting.
- Worker name: attention-shoppers-happy-hunting (must match wrangler.jsonc).
- Production branch: main. Root directory: repository root.
- Build command: npm run verify. Confirm the build installs the pinned package-lock.json with npm ci and includes dev dependencies. Use Node 24.14.0 where supported.
- Deploy command: npx --no-install wrangler deploy.
- Disable builds/previews for non-production branches, especially shurik-control/*.
- Keep CF credentials inside Cloudflare. Use a build token scoped only to this Worker and the minimum permissions required for any configured storage. Do not add CLOUDFLARE_API_TOKEN or CF account secrets to GitHub.

The scaffold currently needs only the ASSETS binding declared in wrangler.jsonc; Wrangler packages the public directory. It has no persistence or scheduled refresh yet. Shurik must update this document with the final bindings, migration/provisioning steps, cron expression and local refresh proof before claiming readiness.

Do not configure a bare deploy command that skips verification. A failed test or dry-run build must prevent production deployment. Validate one actual Shurik-authored main push after connecting CF, then confirm /health, the board and the scheduled refresh in the Cloudflare dashboard. CF Git integration is documented at https://developers.cloudflare.com/workers/ci-cd/builds/.

Local checks require no CF account:

```sh
npm ci --ignore-scripts
npm run verify
npm run dev
```

The real deployment remains disabled until the owner enables it from Cloudflare. The Actions loop has no direct administrative CF access, but its main code pushes become production changes once automatic deployment is enabled.
