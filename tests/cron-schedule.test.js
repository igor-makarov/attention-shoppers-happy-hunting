// The deployed Worker has exactly one trigger: the Cloudflare cron expression in
// wrangler.jsonc (`17 */6 * * *`). A stored vendor `nextAttemptAt` is a backoff
// *deadline*, not a run time. These tests pin the helper used by the production
// probe/reports to the deployed cron trigger AND to the Worker's own due rule:
//
// - CoffeeMan's post-06:17 failure deadline of 07:17:42Z is strict (it has
//   consecutive failures), so the first tick that can attempt it is 12:17 UTC.
// - Pucks/Coffee4U store a success deadline of 12:17:42Z; because
//   `isVendorDue` allows EARLY_DUE_TOLERANCE_MS (15 min) for a vendor with no
//   consecutive failures, the same 12:17 UTC tick attempts them. Predicting
//   18:17 for those vendors would be as wrong as calling 07:17 a retry.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CRON_EXPRESSION, EARLY_DUE_TOLERANCE_MS, nextCronTick, firstTickAtOrAfter, firstAttemptAtOrAfter } from '../scripts/cron-schedule.mjs';
import { isVendorDue } from '../src/refresh.js';

const wrangler = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));

test('the schedule helper matches the deployed wrangler cron trigger', () => {
  assert.deepEqual(wrangler.triggers?.crons, [CRON_EXPRESSION]);
});

test('the helper uses the runtime early-due tolerance, not a copy', () => {
  assert.equal(EARLY_DUE_TOLERANCE_MS, 15 * 60 * 1000);
});

test('nextCronTick returns the next six-hourly tick strictly after a time', () => {
  assert.equal(nextCronTick('2026-10-13T06:18:00Z'), '2026-10-13T12:17:00.000Z');
  assert.equal(nextCronTick('2026-10-13T12:16:59.999Z'), '2026-10-13T12:17:00.000Z');
  assert.equal(nextCronTick('2026-10-13T00:17:00.500Z'), '2026-10-13T06:17:00.000Z');
  // Exactly at a tick the next tick is the following one, because the current
  // tick may already have fired when a probe runs.
  assert.equal(nextCronTick('2026-10-13T12:17:00.000Z'), '2026-10-13T18:17:00.000Z');
  // Rolls into the next UTC day.
  assert.equal(nextCronTick('2026-10-13T23:59:00Z'), '2026-10-14T00:17:00.000Z');
});

test('a backoff deadline between ticks is not presented as an attempt time', () => {
  // The recorded CoffeeMan deadline after its second consecutive 403.
  const due = '2026-10-13T07:17:42.285Z';
  assert.equal(nextCronTick(due), '2026-10-13T12:17:00.000Z');
  // Strict deadline view: the first tick at or after the deadline.
  assert.equal(firstTickAtOrAfter(due), '2026-10-13T12:17:00.000Z');
  // Due-aware view: the vendor failed, so the strict deadline applies and the
  // 12:17 tick is still the first attempt after the deadline.
  assert.equal(
    firstAttemptAtOrAfter({ dueAt: due, consecutiveFailures: 2, from: '2026-10-13T06:18:00Z' }),
    '2026-10-13T12:17:00.000Z'
  );
  // A strict deadline seconds after a tick waits for the following tick.
  assert.equal(firstTickAtOrAfter('2026-10-13T12:17:42.285Z'), '2026-10-13T18:17:00.000Z');
  assert.equal(
    firstAttemptAtOrAfter({ dueAt: '2026-10-13T12:17:42.285Z', consecutiveFailures: 1, from: '2026-10-13T06:18:00Z' }),
    '2026-10-13T18:17:00.000Z'
  );
  assert.equal(firstTickAtOrAfter(null), null);
  assert.equal(firstTickAtOrAfter('not-a-date'), null);
});

test('a successful vendor is attempted at the tick it is due just after (early-due tolerance)', () => {
  // Pucks/Coffee4U after the 06:17 refresh: due 12:17:42.285Z, no failures.
  // The runtime rule counts them due from 12:02:42.285Z, so the 12:17 tick
  // attempts them even though the stored deadline is 42 s later.
  const due = '2026-10-13T12:17:42.285Z';
  assert.equal(isVendorDue({ nextAttemptAt: due, consecutiveFailures: 0 }, Date.parse('2026-10-13T12:17:00.000Z')), true);
  assert.equal(
    firstAttemptAtOrAfter({ dueAt: due, consecutiveFailures: 0, from: '2026-10-13T06:18:00Z' }),
    '2026-10-13T12:17:00.000Z'
  );
  // The same stored deadline with failures is not due at that tick.
  assert.equal(isVendorDue({ nextAttemptAt: due, consecutiveFailures: 1 }, Date.parse('2026-10-13T12:17:00.000Z')), false);
  assert.equal(
    firstAttemptAtOrAfter({ dueAt: due, consecutiveFailures: 1, from: '2026-10-13T06:18:00Z' }),
    '2026-10-13T18:17:00.000Z'
  );
});

test('the early-due boundary is exactly EARLY_DUE_TOLERANCE_MS', () => {
  const tick = '2026-10-13T12:17:00.000Z';
  const exactly = new Date(Date.parse(tick) + EARLY_DUE_TOLERANCE_MS).toISOString();
  const oneMsLate = new Date(Date.parse(tick) + EARLY_DUE_TOLERANCE_MS + 1).toISOString();
  assert.equal(isVendorDue({ nextAttemptAt: exactly, consecutiveFailures: 0 }, Date.parse(tick)), true);
  assert.equal(isVendorDue({ nextAttemptAt: oneMsLate, consecutiveFailures: 0 }, Date.parse(tick)), false);
  assert.equal(firstAttemptAtOrAfter({ dueAt: exactly, consecutiveFailures: 0, from: '2026-10-13T06:18:00Z' }), tick);
  assert.equal(firstAttemptAtOrAfter({ dueAt: oneMsLate, consecutiveFailures: 0, from: '2026-10-13T06:18:00Z' }), '2026-10-13T18:17:00.000Z');
});

test('the predicted attempt tick is exactly where the runtime due rule flips', () => {
  const cases = [
    { dueAt: '2026-10-13T12:17:42.285Z', consecutiveFailures: 0 },
    { dueAt: '2026-10-13T12:17:42.285Z', consecutiveFailures: 3 },
    { dueAt: '2026-10-13T07:17:42.285Z', consecutiveFailures: 2 },
    { dueAt: '2026-10-13T12:32:00.001Z', consecutiveFailures: 0 },
    { dueAt: null, consecutiveFailures: 0 }
  ];
  for (const { dueAt, consecutiveFailures } of cases) {
    const from = '2026-10-13T06:18:00Z';
    const predicted = firstAttemptAtOrAfter({ dueAt, consecutiveFailures, from });
    assert.equal(isVendorDue({ nextAttemptAt: dueAt, consecutiveFailures }, Date.parse(predicted)), true, `due at predicted tick: ${JSON.stringify({ dueAt, consecutiveFailures, predicted })}`);
    // The helper is defined as the *first* such tick after `from`: when a real
    // deadline exists, the previous tick must not satisfy the runtime rule.
    if (dueAt != null && Number.isFinite(Date.parse(dueAt))) {
      const previous = new Date(Date.parse(predicted) - 6 * 60 * 60 * 1000).toISOString();
      assert.equal(isVendorDue({ nextAttemptAt: dueAt, consecutiveFailures }, Date.parse(previous)), false, `not due at previous tick: ${JSON.stringify({ dueAt, consecutiveFailures, previous })}`);
    }
  }
});

test('a missing or unparseable deadline means immediately due at the next tick', () => {
  assert.equal(
    firstAttemptAtOrAfter({ dueAt: null, consecutiveFailures: 0, from: '2026-10-13T06:18:00Z' }),
    '2026-10-13T12:17:00.000Z'
  );
  assert.equal(
    firstAttemptAtOrAfter({ dueAt: 'not-a-date', consecutiveFailures: 2, from: '2026-10-13T06:18:00Z' }),
    '2026-10-13T12:17:00.000Z'
  );
});

test('the helper rejects a schedule shape it cannot compute honestly', () => {
  assert.throws(() => nextCronTick('2026-10-13T06:00:00Z', '17 */6 * * 1'), /unsupported cron expression/);
  assert.throws(() => nextCronTick('2026-10-13T06:00:00Z', '17 6 * *'), /five fields/);
  assert.throws(() => firstAttemptAtOrAfter({ from: 'not-a-date' }), /invalid cron reference time/);
});
