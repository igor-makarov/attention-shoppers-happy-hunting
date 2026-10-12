// Rendered-label regressions for timestamps that are actually in the future.
//
// The policy `reviewBy` date and a failing vendor's `nextAttemptAt` are due
// times, not observation times. Before iteration 3-77 they were formatted with
// timeLabel(), which printed a future date as "(just now)" — the rendered
// product page read "re-check by 11 Nov 2026, 02:00 (just now)".

import test from 'node:test';
import assert from 'node:assert/strict';
import { timeLabel, dueLabel } from '../public/ui.js';

test('timeLabel never calls a future timestamp "just now"', () => {
  const inHours = timeLabel(new Date(Date.now() + 5 * 3_600_000).toISOString());
  assert.match(inHours, /\(in 5 h\)/);
  assert.doesNotMatch(inHours, /just now/);

  const inDays = timeLabel(new Date(Date.now() + 29 * 24 * 3_600_000).toISOString());
  assert.match(inDays, /\(in 29 d\)/);
  assert.doesNotMatch(inDays, /just now/);
});

test('timeLabel still formats past observations as an age', () => {
  assert.match(timeLabel(new Date(Date.now() - 30_000).toISOString()), /\(just now\)/);
  assert.match(timeLabel(new Date(Date.now() - 5 * 3_600_000).toISOString()), /\(5 h ago\)/);
  assert.equal(timeLabel(null), 'never');
  assert.equal(timeLabel('not-a-date'), 'unknown time');
});

test('dueLabel formats future due times in hours and days and past ones as due now', () => {
  assert.match(dueLabel(new Date(Date.now() + 5 * 3_600_000).toISOString()), /\(in 5 h\)/);
  assert.match(dueLabel(new Date(Date.now() + 29 * 24 * 3_600_000).toISOString()), /\(in 29 d\)/);
  assert.match(dueLabel(new Date(Date.now() - 3_600_000).toISOString()), /\(due now\)/);
  assert.equal(dueLabel(null), 'not scheduled');
});
