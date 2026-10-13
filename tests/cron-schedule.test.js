// The deployed Worker has exactly one trigger: the Cloudflare cron expression in
// wrangler.jsonc (`17 */6 * * *`). A stored vendor `nextAttemptAt` is a backoff
// *deadline*, not a run time — after CoffeeMan's 06:17 UTC failure its deadline was
// 07:17:42Z, but no tick can execute it until 12:17 UTC. These tests pin the helper
// used by the production probe/reports to the deployed cron trigger so "next
// attempt" cannot silently become a due time again.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CRON_EXPRESSION, nextCronTick, firstTickAtOrAfter } from '../scripts/cron-schedule.mjs';

const wrangler = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));

test('the schedule helper matches the deployed wrangler cron trigger', () => {
  assert.deepEqual(wrangler.triggers?.crons, [CRON_EXPRESSION]);
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
  assert.equal(firstTickAtOrAfter(due), '2026-10-13T12:17:00.000Z');
  // A deadline already inside a tick minute still waits for the next tick when it
  // is after that tick's second zero; the helper reports the certain attempt time.
  assert.equal(firstTickAtOrAfter('2026-10-13T12:17:42.285Z'), '2026-10-13T18:17:00.000Z');
  assert.equal(firstTickAtOrAfter(null), null);
  assert.equal(firstTickAtOrAfter('not-a-date'), null);
});

test('the helper rejects a schedule shape it cannot compute honestly', () => {
  assert.throws(() => nextCronTick('2026-10-13T06:00:00Z', '17 */6 * * 1'), /unsupported cron expression/);
  assert.throws(() => nextCronTick('2026-10-13T06:00:00Z', '17 6 * *'), /five fields/);
});
