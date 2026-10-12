# Deployment notes and owner handoffs

Current state (2026-10-12): handoff 1 (OpenCode key plus loop control) is complete, and the owner
reports the Cloudflare side connected and serving **https://attention-shoppers.igormaka.workers.dev**
with the production Worker name `attention-shoppers`. On 2026-10-12 15:51-15:54 UTC the coding loop
independently verified that URL from the runner with read-only public GETs (no Cloudflare credentials,
admin API or deploy): HTTP 200, exactly one catalog product, five persisted observations, and a
request-triggered initial refresh that completed at 15:52:12.546Z and advanced `lastRefreshAt`; evidence
in docs/evidence/production-verification-20261012T1554Z.json. The loop still does not administer
Cloudflare. The outstanding production checks are listed at the end of this file and in docs/STATUS.md.

## 1. OpenCode key

Add OPENCODE_API_KEY under repository Settings → Secrets and variables → Actions → New repository secret. Paste it only in GitHub's secret form, never into chat, a prompt, a dispatch input or a commit.

The repository variable SHURIK_ENABLED starts false, so scheduled recovery and manual dispatch cannot start a model loop before setup is finished. The owner has added the key and authorized DeepSeek V4.1 Flash on OpenCode Go. After the key is present, the maintainer sets SHURIK_ENABLED true and dispatches:

```sh
gh workflow run shurik.yml --repo igor-makarov/attention-shoppers-happy-hunting --ref main \
  -f command=start -f loop_id=main -f seconds=1800
```

Provider, model and reasoning are fixed in the workflow's control action to opencode-go / deepseek-v4.1-flash / max. Further model changes require an owner instruction and a workflow update. The initial loop writes directly to main. Unless a deadline is supplied it continues until stopped, including after ordinary agent answers. Provider availability and the owner's OpenCode Go allowance apply.

To stop, dispatch command=stop and loop_id=main. Record the durable stop before turning SHURIK_ENABLED false. To resume, use command=resume, loop_id=main; the workflow supplies max reasoning again and updates the saved model to DeepSeek V4.1 Flash. Control/session history and Actions logs are public; do not add private material to this task.

## 2. Cloudflare Git integration

Expected as configured by the owner; the coding loop does not administer Cloudflare. The owner connects the repo from the Cloudflare dashboard, not through Shurik.

- Workers & Pages → Create application → Import a repository.
- Select igor-makarov/attention-shoppers-happy-hunting.
- Worker name: `attention-shoppers` (must match `name` in wrangler.jsonc).
- Production branch: main. Root directory: repository root.
- Build command: `npm ci --ignore-scripts && npm run verify`. The verify script runs the node:test suite and `wrangler deploy --dry-run --outdir dist`, which builds the Worker bundle locally without any Cloudflare credential. Confirm Node 24.14.0 where supported.
- Deploy command: `npx --no-install wrangler deploy`.
- Disable builds and previews for non-production branches, especially `shurik-control/*`.
- Keep CF credentials inside Cloudflare. No CLOUDFLARE_API_TOKEN or CF account secret belongs in GitHub.
- Minimum token scope for Workers Builds: Workers Scripts:Edit for this Worker only (the deploy command creates/updates the script and applies the Durable Object migration). No account-wide or unrelated permissions are needed. The runtime needs no administrative credential at all.

## Required bindings and provisioning

`wrangler.jsonc` declares everything; the owner needs no manual dashboard resource creation:

| Binding | Type | Provisioning |
| --- | --- | --- |
| `env.BOARD` | Durable Object, class `BoardStore`, SQLite-backed | Created by migration tag `v1` (`new_sqlite_classes: ["BoardStore"]`) during `wrangler deploy` |
| `env.ASSETS` | Static assets from `public/` | Packaged from the repository |

Nothing else is required: the Worker persists observations, vendor refresh state, FX rates and run history in the Durable Object's SQLite tables (`observations`, `vendor_state`, `meta`, `runs`; refresh leases live under `meta` as `lease:*` keys) and reads vendor pages over plain outbound HTTPS.

Alternative storage was considered and rejected: KV or R2 would add a separate consistency problem and still need a migration path for the lease/last-known-good semantics; the SQLite-backed Durable Object is created by the deployment itself with no extra credential.

## Cron behavior

- `wrangler.jsonc` triggers the scheduled handler on `17 */6 * * *` (UTC), about every six hours.
- A successful vendor is stored as due at `run time + 6 h`. Because the cron fires on fixed clock times, a successful vendor also counts as due up to 15 minutes early (`EARLY_DUE_TOLERANCE_MS` in `src/refresh.js`). Without that tolerance a tick landing seconds before the due time skips every vendor, the board drifts to a twelve-hour cadence and reports stale for hours between runs; vendors inside a failure backoff keep their strict due time, so backoff is not weakened.
- The first tick after an off-phase initial refresh can legitimately record a run that saves nothing because every vendor is still inside its six-hour window. That run appears in the run history but does not advance `lastRefreshAt` (no offer was re-observed); the following tick refreshes normally.
- The first `GET /health` or `GET /api/board` after a deployment starts one initial refresh in the background so the board is not empty until the first cron tick. It is lease- and throttle-protected (10 minutes) and can never be triggered repeatedly by public traffic.
- Each run fetches at most one URL per tracked offer plus the Bank of Israel rate file, capped at two vendors concurrently, 12 s per request and 1.5 MB per response, with hosts restricted to each adapter's allowlist. Five Crema e Gusto offers from three independent vendors (CoffeeMan, Pucks, Coffee4U) are tracked today; the product and offers are visible in `/api/catalog`.
- A run that fetched nothing because every vendor is inside its backoff window is recorded in the run history but does not update `lastRefreshAt`, so an empty run cannot mask a stalled pipeline as fresh.
- A run that is interrupted after saving observations (for example a redeploy stops the background job) leaves no completion marker. `/health`, `/api/status` and `/api/board` therefore also report `lastObservationAt` (the newest saved successful observation) and `freshness.dataAsOf`, and use the observation time as the age anchor only when no completed refresh exists. A recorded but old completion still reads as stale: that is the scheduled pipeline having stopped, not missing data.
- Requests to the same host are spaced by the vendor's published crawl delay (`Crawl-delay: 7` on CoffeeMan and Coffee4U, declared as `crawlDelayMs` on the adapter), so a full live run takes about 40 s of wall time but never fires its offers back to back. The pacing waits do not consume CPU and are bounded by the number of tracked offers, so a run stays inside the cron trigger's limits.
- Failures keep the previous good observation, back off (30 min doubling to 12 h) and are surfaced in `/api/status` and the board footer. One broken vendor cannot stop the others. If no scheduled refresh has completed for more than eight hours, `/api/board` and `/api/status` report `freshness.stale` and the site footer says plainly that prices may be out of date. When no refresh has ever completed but saved observations exist, the age anchor is the newest observation instead, and the footer names that observation time rather than claiming the board never refreshed.

## Local verification without a Cloudflare account

```sh
npm ci --ignore-scripts
npm run verify          # node:test suite + wrangler deploy --dry-run
npm run check:sources   # live fetch + parse of every tracked vendor page
npm run cron:offline    # full refresh pipeline against recorded fixtures
npm run cron:local      # full refresh pipeline against the live vendor pages
npm run dev             # local Worker with a local SQLite Durable Object
```

`cron:offline` runs the whole fixture pipeline from a clean `.shurik-local/board-offline.json` every
time, so it is repeatable and never consumes the live run's backoff window; `cron:local` keeps
`.shurik-local/board.json` and honours the same six-hour vendor schedule as the deployed cron, with
`npm run cron:local -- --fresh` as the override for a manual live check.

With `npm run dev` running on port 8789, the same commands used during development are:

```sh
curl -s http://127.0.0.1:8789/api/board?grams=500\&dest=tel-aviv
curl -s http://127.0.0.1:8789/cdn-cgi/local/scheduled   # simulate the cron trigger (wrangler dev only)
npm run qa:browser                            # offline fixture-backed browser QA (no network)
npm run qa:browser -- http://127.0.0.1:8789   # live browser QA against the running Worker
```

The local scheduled trigger waits while the run executes. With the vendors' declared crawl delays a full
run takes about 40 s, so a client-side timeout on that call does not mean the refresh failed; check
`/api/status` for the persisted run, `lastRefreshAt` and the vendors' `nextAttemptAt`.

`npm run qa:browser` without an argument starts `scripts/qa-server.mjs` on an ephemeral port. That server
serves `public/` and the read-only board API computed from `tests/fixtures/` with the production quote
engine, so headless Chrome checks the real UI offline and the script compares the DOM against the API
response instead of hard-coded prices. The live form checks the same UI against a real local Worker.

## Adding a vendor (and the product-line rule)

The active scope is Lavazza Crema e Gusto vacuum-packed ground coffee only. Another product line may
only be added after an explicit new owner instruction; retired lines (Qualità Oro, Qualità Rossa,
Suerte) must not be re-added, and their historical page excerpts under
`tests/fixtures/historical-retired/` are negative test inputs only.

- A new vendor is one module in `src/vendors/` exporting `{ id, name, homepage, allowedHosts, parserVersion, offers, observe() }`, registered in `src/vendors/index.js`. Keep every product URL fixed and allowlisted, parse only published structured data or narrow markup, and never bypass a block page.
- Record the vendor page excerpt as a fixture in `tests/fixtures/` and map it to the offer in `tests/fixtures/vendor-fixtures.mjs`; `npm run check:sources -- --fixture`, `npm run cron:offline` and the browser QA server then cover the new source offline. Live validation is `npm run check:sources` plus `npm run cron:local`.

The real deployment is owner-controlled. The Actions loop has no direct administrative CF access, but its main code pushes become production changes once automatic deployment is enabled.

## Outstanding production checks (owner or later evidence)

1. Confirm the deployed Worker at https://attention-shoppers.igormaka.workers.dev answers `/health` with a non-null `lastRefreshAt` and `/api/catalog` lists exactly one product. (Verified from the coding runner on 2026-10-12 15:51-15:54 UTC by read-only public GETs: see docs/evidence/production-verification-20261012T1554Z.json. A later owner-side deploy is still needed to pick up the 3-61 freshness fallback, which adds `lastObservationAt` to `/health`.)
2. Confirm a scheduled refresh populated the Durable Object with the five Crema e Gusto offers and that a later main push is picked up by Workers Builds.
3. Report any Cloudflare error back to the loop; never paste credentials.
