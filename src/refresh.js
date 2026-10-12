// Scheduled refresh pipeline.
//
// The pipeline is deterministic and bounded: allowlisted hosts, per-request
// timeouts and size limits, concurrency capped, one attempt per offer per run.
// A failing vendor keeps its previous good observation; a missing FX rate keeps
// the previous rate table. Nothing here needs a browser, an LLM or the coding
// loop to be running.

import { createBoundedFetcher } from './lib/http.js';
import { parseBoiRates, FX_SOURCE } from './lib/fx.js';
import { registeredVendors, vendorHosts } from './vendors/index.js';

export const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // About every six hours.
export const BACKOFF_BASE_MS = 30 * 60 * 1000;
export const BACKOFF_MAX_MS = 12 * 60 * 60 * 1000;
export const LEASE_TTL_MS = 10 * 60 * 1000;
export const MAX_CONCURRENCY = 2;
export const INITIAL_REFRESH_THROTTLE_MS = 10 * 60 * 1000;

export const FX_URL = 'https://www.boi.org.il/currency.xml';
export const FX_HOSTS = ['www.boi.org.il', 'boi.org.il'];

export function backoffMs(consecutiveFailures) {
  if (!consecutiveFailures || consecutiveFailures <= 0) return 0;
  return Math.min(BACKOFF_BASE_MS * 2 ** (consecutiveFailures - 1), BACKOFF_MAX_MS);
}

export function isVendorDue(state, now) {
  if (!state?.nextAttemptAt) return true;
  return Date.parse(state.nextAttemptAt) <= now;
}

export async function runRefresh({
  store,
  vendors = registeredVendors(),
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  includeFx = true,
  trigger = 'scheduled',
  holderId = `refresh-${now}-${Math.random().toString(36).slice(2, 8)}`,
  logger = null
} = {}) {
  const acquired = await store.acquireLease('refresh', holderId, LEASE_TTL_MS);
  if (!acquired) {
    return { skipped: true, reason: 'another refresh holds the lease', trigger };
  }
  const startedAt = new Date(now).toISOString();
  let requests = 0;
  const counter = () => { requests += 1; };
  const fxHosts = FX_HOSTS;
  const results = [];
  try {
    const queued = [];
    for (const vendor of vendors) {
      const state = await store.getVendorState(vendor.id);
      if (!isVendorDue(state, now)) {
        results.push({ vendorId: vendor.id, skipped: true, reason: 'backoff', nextAttemptAt: state.nextAttemptAt });
        continue;
      }
      queued.push({ vendor, state });
    }

    for (let index = 0; index < queued.length; index += MAX_CONCURRENCY) {
      const batch = queued.slice(index, index + MAX_CONCURRENCY);
      const batchResults = await Promise.all(batch.map(({ vendor, state }) => refreshVendor({ store, vendor, state, fetchImpl, now, counter, logger })));
      results.push(...batchResults);
    }

    let fx = null;
    if (includeFx) fx = await refreshFxCached({ store, fetchImpl, now, counter, logger });

    const finishedAt = new Date(Date.now()).toISOString();
    const summary = {
      trigger,
      startedAt,
      finishedAt,
      requests,
      vendors: results,
      fx: fx ? { ok: fx.ok, asOf: fx.fx?.asOf ?? null, error: fx.error ?? null } : { skipped: true }
    };
    await store.recordRun(summary);
    await store.setMeta('lastRefreshAt', { value: finishedAt, trigger });
    return summary;
  } finally {
    await store.releaseLease('refresh');
  }
}

async function refreshVendor({ store, vendor, state, fetchImpl, now, counter, logger }) {
  const fetchText = createBoundedFetcher({
    fetchImpl,
    allowedHosts: vendor.allowedHosts ?? vendorHosts([vendor]),
    onRequest: counter
  });
  const attemptedAt = new Date(now).toISOString();
  let saved = 0;
  const failures = [];
  try {
    const outcome = await vendor.observe({ fetchText, now, logger });
    for (const observation of outcome.observations ?? []) {
      observation.attemptedAt = attemptedAt;
      observation.lastError = null;
      await store.putObservation(observation);
      saved += 1;
    }
    for (const failure of outcome.failures ?? []) {
      failures.push(failure);
      await store.markAttempt({
        key: `${vendor.id}:offer:${failure.offerId}`,
        attemptedAt,
        error: failure.error
      });
    }
  } catch (error) {
    failures.push({ offerId: '*', error: error?.message ?? String(error) });
    for (const offer of vendor.offers ?? []) {
      await store.markAttempt({ key: `${vendor.id}:offer:${offer.id}`, attemptedAt, error: error?.message ?? String(error) });
    }
  }
  const ok = saved > 0;
  const previousFailures = ok ? 0 : (state?.consecutiveFailures ?? 0) + 1;
  const delay = ok ? REFRESH_INTERVAL_MS : Math.max(backoffMs(previousFailures), BACKOFF_BASE_MS);
  const nextAttemptAt = new Date(now + delay).toISOString();
  const nextState = {
    vendorId: vendor.id,
    lastAttemptAt: attemptedAt,
    lastSuccessAt: ok ? attemptedAt : (state?.lastSuccessAt ?? null),
    consecutiveFailures: previousFailures,
    nextAttemptAt,
    lastErrors: failures.map(failure => failure.error).slice(0, 5)
  };
  await store.setVendorState(vendor.id, nextState);
  logger?.info?.(`[refresh] ${vendor.id}: saved=${saved} failures=${failures.length} next=${nextAttemptAt}`);
  return { vendorId: vendor.id, ok, saved, failures, nextAttemptAt };
}

export const FX_MIN_INTERVAL_MS = 3 * 60 * 60 * 1000;

/** Skip the FX fetch when a recent official rate table is already stored. */
export async function refreshFxCached({ store, fetchImpl, now, counter, logger }) {
  const stored = await store.getMeta('fx');
  if (stored?.fetchedAt && now - Date.parse(stored.fetchedAt) < FX_MIN_INTERVAL_MS) {
    return { ok: true, fx: stored, cached: true };
  }
  return refreshFx({ store, fetchImpl, now, counter, logger });
}

export async function refreshFx({ store, fetchImpl, now, counter, logger }) {
  const fetchText = createBoundedFetcher({ fetchImpl, allowedHosts: FX_HOSTS, onRequest: counter });
  const response = await fetchText(FX_URL, { accept: 'application/json' });
  const attemptedAt = new Date(now).toISOString();
  if (!response.ok) {
    logger?.warn?.(`[refresh] fx fetch failed: ${response.error ?? response.status}`);
    return { ok: false, error: response.error ?? `HTTP ${response.status}`, attemptedAt };
  }
  const parsed = (() => {
    try {
      return parseBoiRates(JSON.parse(response.text));
    } catch {
      return null;
    }
  })();
  if (!parsed) return { ok: false, error: 'Bank of Israel feed could not be parsed', attemptedAt };
  const fx = { ...parsed, fetchedAt: attemptedAt, source: FX_SOURCE };
  await store.setMeta('fx', fx);
  return { ok: true, fx, attemptedAt };
}

/**
 * Runs a refresh in the background when the board has never refreshed, for the
 * initial refresh after deployment. Bounded by a lease and a throttle so public
 * traffic can never trigger unlimited scraping.
 */
export async function maybeInitialRefresh({ store, ctx, now = Date.now(), run = runRefresh, ...options } = {}) {
  const last = await store.getMeta('lastRefreshAt');
  if (last?.value) return { skipped: true, reason: 'already refreshed' };
  const attempt = await store.getMeta('initialRefreshAttemptAt');
  if (attempt?.value && now - Date.parse(attempt.value) < INITIAL_REFRESH_THROTTLE_MS) {
    return { skipped: true, reason: 'initial refresh throttled' };
  }
  await store.setMeta('initialRefreshAttemptAt', { value: new Date(now).toISOString() });
  const promise = run({ store, trigger: 'initial', now, ...options }).catch(() => null);
  if (ctx?.waitUntil) ctx.waitUntil(promise);
  return { started: true, promise };
}
