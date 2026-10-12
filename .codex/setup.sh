#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$repo_root"

required_node="24.14.0"
if ! command -v node >/dev/null || [[ "$(node --version)" != "v$required_node" ]]; then
  printf 'Install Node %s (pinned in mise.toml) and put it on PATH before setup.\n' "$required_node" >&2
  exit 1
fi

# Managed cloud home directories may be read-only. These defaults stay inside
# ignored project directories; saved environment variables can override them.
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$repo_root/.wrangler/codex-config}"
export npm_config_cache="${npm_config_cache:-$repo_root/.wrangler/codex-npm-cache}"
export WRANGLER_SEND_METRICS=false
mkdir -p -- "$XDG_CONFIG_HOME" "$npm_config_cache"

npm ci --ignore-scripts --no-audit --no-fund
npm run verify
