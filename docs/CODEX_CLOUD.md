# Codex Cloud environment

The repository setup has been tested in a managed cloud workspace. A reusable
environment still needs to be created, saved and published in Codex settings;
this document and `.codex/setup.sh` do not register one automatically.

## Create the environment

In ChatGPT or the Codex desktop app, open Settings → Codex Cloud → Environments →
Create environment. Select `igor-makarov/attention-shoppers-happy-hunting`, use
`main`, and select Get started. Name the environment `Attention shoppers` and keep
Who can use set to Only me.

Ask the setup conversation to install **Node 24.14.0**, matching `mise.toml` and
CI, and ensure it is on PATH in both installation and future task shells. The
setup script checks the version; it does not install Node itself. Keep Wrangler
at the lockfile-pinned version and include development dependencies.

Configure these non-secret environment variables so that later terminal commands
use writable paths too. Exports inside the install script alone do not configure
future task shells.

| Variable | Value |
| --- | --- |
| `XDG_CONFIG_HOME` | `/workspace/.cache/attention-shoppers/config` |
| `npm_config_cache` | `/workspace/.cache/attention-shoppers/npm` |
| `WRANGLER_SEND_METRICS` | `false` |

Enable internet access and use All (unrestricted) for public vendor research,
which needs to discover sources whose hosts are not known yet. Node installation
uses `nodejs.org`; npm uses `registry.npmjs.org`. The Worker itself must still
enforce the bounded fetching and vendor host allowlists required by `PROMPT.md`.

No environment secrets, outbound cloud identities or VPN are required. The
existing OpenCode key belongs to Shurik's GitHub Actions runner. Local Worker
development and verification need no Cloudflare account.

## Install script

Run this from the repository checkout:

```sh
bash .codex/setup.sh
```

This installs the locked dependencies with lifecycle scripts disabled, runs the
Worker tests, and builds with `wrangler deploy --dry-run`. Run it again when
`package.json` or `package-lock.json` changes; repository refresh does not rerun
installation automatically. Generated dependencies, configuration and build
outputs remain ignored by Git.

## Start skill

Use these instructions in the environment's Start skill field:

```text
Work in the attention-shoppers-happy-hunting repository checkout.
Read AGENTS.md and the project documents it names.
Check that node --version reports v24.14.0.
If dependencies or the lockfile changed, run bash .codex/setup.sh.
Run npm run verify before completing source changes.
When a local preview is useful, start npm run dev -- --local --ip 0.0.0.0 --port 8787.
Wait for http://127.0.0.1:8787/health to return HTTP 200 and status "ok".
Check / and /api/catalog; the current scaffold must retain its research-pending state.
Use local Wrangler only; Cloudflare administration and real deployment belong to the owner.
Preserve Shurik's engine and control branch. Checkpoint useful, verified changes on main.
Update docs/STATUS.md with completed checks, the next task and observed blockers.
```

Review the prepared files and setup report, save the draft, and select Publish.
After Environment published appears, start a new task and check Node, verification
and the local preview again. Only that step proves the reusable environment is
available to new tasks.

For the older Code Review / GitHub integration environment settings, select Node
24.14.0 under Set package versions and use `bash .codex/setup.sh` for both setup
and maintenance. The current Codex Cloud environment uses Install script and
Start skill instead.

Reference: [Cloud environments](https://developers.openai.com/codex/environments/cloud-environments).
