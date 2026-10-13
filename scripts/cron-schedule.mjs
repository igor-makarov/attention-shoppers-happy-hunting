// The deployed Worker has exactly one trigger: the Cloudflare cron expression in
// wrangler.jsonc (`17 *\/6 * * *`). A stored vendor `nextAttemptAt` is a *due* time,
// not a run: after a failure the backoff deadline can fall between two cron ticks,
// and the vendor is not attempted until the next tick. Iterations 3-94/3-96 nearly
// recorded CoffeeMan's 07:17:42Z backoff deadline as a "retry at 07:17" even though
// the next tick that can execute it is 12:17 UTC.
//
// The prediction must follow the Worker's own rule, not just the deadline. In
// src/refresh.js `isVendorDue` lets a *successful* vendor count as due up to
// EARLY_DUE_TOLERANCE_MS (15 min) before its stored deadline, because the cron
// fires at fixed clock times while the deadline is stored as run-time + 6 h. A
// deadline seconds after a tick is therefore attempted at that tick, while a
// vendor inside a failure backoff keeps the strict deadline and waits for the
// first tick at or after it. `firstAttemptAtOrAfter` imports `isVendorDue` from
// the runtime module so this helper cannot drift from the actual semantics.
//
// Only the deployed cadence shape is supported (fixed minute, hour step/list, no
// day-of-month/day-of-week restriction); anything else throws so a future schedule
// change is a loud failure instead of a silently wrong timestamp.

import { EARLY_DUE_TOLERANCE_MS, isVendorDue } from '../src/refresh.js';

export const CRON_EXPRESSION = '17 */6 * * *';
export { EARLY_DUE_TOLERANCE_MS };
export const MINUTE_MS = 60_000;

function parseNumber(field, min, max, whole) {
  const value = Number(field);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`unsupported cron field "${field}": expected an integer ${min}-${max}`);
  }
  return value;
}

function parseField(field, min, max, label) {
  if (field === '*') return Array.from({ length: max - min + 1 }, (_, index) => min + index);
  const values = new Set();
  for (const part of field.split(',')) {
    const stepMatch = /^\*\/(\d+)$/.exec(part);
    if (stepMatch) {
      const step = parseNumber(stepMatch[1], 1, max - min + 1);
      for (let value = min; value <= max; value += step) values.add(value);
      continue;
    }
    const rangeMatch = /^(\d+)-(\d+)$/.exec(part);
    if (rangeMatch) {
      const from = parseNumber(rangeMatch[1], min, max);
      const to = parseNumber(rangeMatch[2], min, max);
      if (to < from) throw new Error(`unsupported cron ${label} range "${part}": end before start`);
      for (let value = from; value <= to; value += 1) values.add(value);
      continue;
    }
    values.add(parseNumber(part, min, max));
  }
  if (!values.size) throw new Error(`unsupported cron ${label} field "${field}"`);
  return [...values].sort((a, b) => a - b);
}

/**
 * The first cron tick strictly after `from` (UTC), as an ISO string.
 *
 * @param {number|string|Date} from timestamp, ISO string or Date
 * @param {string} expression deployed cron shape (default CRON_EXPRESSION)
 */
export function nextCronTick(from = Date.now(), expression = CRON_EXPRESSION) {
  const fields = String(expression ?? '').trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`unsupported cron expression "${expression}": expected five fields`);
  const [minuteField, hourField, dayOfMonth, month, dayOfWeek] = fields;
  // The Worker's schedule does not restrict days; refuse to guess for one that does.
  if (dayOfMonth !== '*' || month !== '*' || dayOfWeek !== '*') {
    throw new Error(`unsupported cron expression "${expression}": only a daily hour/minute cadence is supported`);
  }
  const minutes = parseField(minuteField, 0, 59, 'minute');
  const hours = parseField(hourField, 0, 23, 'hour');
  const fromMs = from instanceof Date ? from.getTime() : typeof from === 'string' ? Date.parse(from) : Number(from);
  if (!Number.isFinite(fromMs)) throw new Error(`invalid cron reference time "${from}"`);
  const startOfDay = Date.UTC(new Date(fromMs).getUTCFullYear(), new Date(fromMs).getUTCMonth(), new Date(fromMs).getUTCDate());
  for (let dayOffset = 0; dayOffset <= 2; dayOffset += 1) {
    const dayStart = startOfDay + dayOffset * 86_400_000;
    for (const hour of hours) {
      for (const minute of minutes) {
        const tick = dayStart + hour * 3_600_000 + minute * MINUTE_MS;
        if (tick > fromMs) return new Date(tick).toISOString();
      }
    }
  }
  throw new Error(`no cron tick within three days for "${expression}"`);
}

/**
 * The first cron tick at or after a vendor's stored due time, ignoring the
 * success tolerance: the strict backoff-deadline tick. Returns null when the due
 * time is absent or unparseable (which the refresh treats as immediately due).
 * This is the deadline-only view used to explain a failure backoff; for the tick
 * at which the Worker will actually attempt the vendor use
 * `firstAttemptAtOrAfter`, which applies the runtime due rule.
 */
export function firstTickAtOrAfter(dueAt, expression = CRON_EXPRESSION) {
  if (dueAt == null) return null;
  const dueMs = Date.parse(dueAt);
  if (!Number.isFinite(dueMs)) return null;
  return nextCronTick(dueMs - 1, expression);
}

/**
 * The first cron tick strictly after `from` at which the Worker's own due rule
 * (`isVendorDue` in src/refresh.js) would attempt a vendor with this state.
 *
 * A successful vendor (`consecutiveFailures` 0) may be attempted up to
 * EARLY_DUE_TOLERANCE_MS before its stored deadline, so a deadline seconds after
 * a tick is still attempted at that tick. A vendor inside a failure backoff
 * keeps the strict deadline. A missing/unparseable deadline means the vendor is
 * immediately due and is attempted at the next tick. Returns null only when
 * `from` itself is invalid.
 *
 * @param {{dueAt?: string|null, consecutiveFailures?: number, from?: number|string|Date, expression?: string}} options
 */
export function firstAttemptAtOrAfter({ dueAt = null, consecutiveFailures = 0, from = Date.now(), expression = CRON_EXPRESSION } = {}) {
  const fromMs = from instanceof Date ? from.getTime() : typeof from === 'string' ? Date.parse(from) : Number(from);
  if (!Number.isFinite(fromMs)) throw new Error(`invalid cron reference time "${from}"`);
  const state = { nextAttemptAt: dueAt ?? null, consecutiveFailures };
  let tick = nextCronTick(fromMs, expression);
  for (let guard = 0; guard < 1000; guard += 1) {
    if (isVendorDue(state, Date.parse(tick))) return tick;
    tick = nextCronTick(Date.parse(tick), expression);
  }
  throw new Error(`no attempt tick within 1000 cron ticks for "${expression}"`);
}
