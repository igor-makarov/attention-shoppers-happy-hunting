// The local cron simulation must be repeatable: it is the command the handoff
// notes and the agent loop use to prove the scheduled pipeline still works.
// A fixture run must never be silently skipped because a previous run left a
// six-hour backoff window behind, and it must never consume the live run's
// state file either.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/simulate-cron.mjs', import.meta.url));

async function simulate(cwd) {
  const { stdout, stderr } = await run(process.execPath, [script, '--offline'], {
    cwd,
    env: { ...process.env, BOARD_STATE_PATH: '' },
    timeout: 60_000
  });
  return { report: JSON.parse(stdout), stderr };
}

test('cron:offline simulation runs the full fixture pipeline twice in a row', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cron-simulation-'));
  try {
    const first = await simulate(dir);
    const second = await simulate(dir);

    for (const [label, { report }] of [['first', first], ['second', second]]) {
      assert.equal(report.mode, 'offline fixtures', `${label} run mode`);
      assert.equal(report.summary.requests, 13, `${label} run stays inside the request budget`);
      assert.deepEqual(
        report.summary.vendors.map(vendor => [vendor.vendorId, vendor.saved, vendor.skipped ?? false]),
        [['coffeeman', 7, false], ['pucks', 4, false], ['coffee4u', 1, false]],
        `${label} run refreshes every vendor`
      );
      assert.equal(report.offers.length, 12, `${label} run persists all twelve tracked offers`);
      assert.ok(report.offers.every(offer => offer.observedAt === report.summary.startedAt), `${label} run observations are fresh`);
      assert.ok(report.fx?.usd?.rate > 0, `${label} run records an FX reference rate`);
    }

    // The fixture run keeps its own state file so it can never consume the live
    // run's backoff window, and the state really is persisted between runs.
    const state = JSON.parse(await readFile(join(dir, '.shurik-local', 'board-offline.json'), 'utf8'));
    assert.equal(state.observations.length, 12);
    assert.equal(Object.keys(state.vendors).length, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
