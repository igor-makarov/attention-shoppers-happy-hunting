// Scheduled refresh pipeline.
//
// The pipeline is deterministic and bounded: allowlisted hosts, per-request
// timeouts and size limits, concurrency capped, one attempt per offer per run.
// A failing vendor keeps its previous good observation; a missing FX rate keeps
// the previous rate table. Nothing here needs a browser, an LLM or the coding
// loop to be running.

import { createBoundedFetcher } from './lib/http.js';
import { parseBoiRates, FX_SOURCE } from './lib/fx.js';
import { PRODUCTS } from './catalog.js';
import { registeredVendors, vendorHosts } from './vendors/index.js';

export const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // About every six hours.
// A scheduled refresh that has not completed for this long is surfaced to shoppers
// as stale: one missed six-hour run plus slack, so a broken cron does not stay silent.
export const REFRESH_STALE_MS = 8 * 60 * 60 * 1000;
export const BACKOFF_BASE_MS = 30 * 60 * 1000;
export const BACKOFF_MAX_MS = 12 * 60 * 60 * 1000;
export const LEASE_TTL_MS = 10 * 60 * 1000;
export const MAX_CONCURRENCY = 2;
export const INITIAL_REFRESH_THROTTLE_MS = 10 * 60 * 1000;

export const FX_URL = 'https://www.boi.org.il/currency.xml';
export const FX_HOSTS = ['www.boi.org.il', 'boi.org.il'];

/**
 * Test seam for crawl-delay pacing. Production and the real cron simulation use
 * real timers; unit tests and offline simulations replace these with a no-op so
 * they never wait. Pass `sleep`/`clock` to runRefresh for a per-call override.
 */
export const pacingDefaults = { sleep: undefined, clock: undefined };

export function backoffMs(consecutiveFailures) {
  if (!consecutiveFailures || consecutiveFailures <= 0) return 0;
  return Math.min(BACKOFF_BASE_MS * 2 ** (consecutiveFailures - 1), BACKOFF_MAX_MS);
}

/**
 * Newest successful observation time across stored rows. Attempt markers carry no
 * observedAt, so a failed refresh can never make the board look freshly checked.
 * Pass `productIds` to ignore rows for any product line that is no longer tracked:
 * a lingering historical row must not keep the Crema e Gusto board looking fresh.
 */
export function newestObservationAt(observations = [], productIds = null) {
  const allowed = productIds ? new Set(productIds) : null;
  let newestMs = null;
  let newest = null;
  for (const row of observations) {
    if (!row?.observedAt) continue;
    const productId = row?.product?.productId ?? null;
    if (allowed && productId != null && !allowed.has(productId)) continue;
    const parsed = Date.parse(row.observedAt);
    if (!Number.isFinite(parsed)) continue;
    if (newestMs == null || parsed > newestMs) {
      newestMs = parsed;
      newest = row.observedAt;
    }
  }
  return newest;
}

/**
 * Freshness of the board as a whole. `lastRefreshAt` is the last *completed*
 * refresh. A run that is interrupted after saving observations (for example a
 * redeploy stops the background job) never writes that marker, so the board also
 * reports the newest saved observation and falls back to it for the age when no
 * completed refresh exists. A recorded but old completion still reads as stale:
 * that is the scheduled pipeline having stopped, not missing data.
 */
export function refreshFreshness(lastRefreshAt, now = Date.now(), lastObservationAt = null) {
  const refreshMs = lastRefreshAt ? Date.parse(lastRefreshAt) : NaN;
  const observationMs = lastObservationAt ? Date.parse(lastObservationAt) : NaN;
  const dataMs = Number.isFinite(refreshMs) && Number.isFinite(observationMs)
    ? Math.max(refreshMs, observationMs)
    : (Number.isFinite(refreshMs) ? refreshMs : observationMs);
  const ageAnchorMs = Number.isFinite(refreshMs) ? refreshMs : observationMs;
  const ageMs = Number.isFinite(ageAnchorMs) ? now - ageAnchorMs : null;
  return {
    lastRefreshAt: lastRefreshAt ?? null,
    lastObservationAt: lastObservationAt ?? null,
    dataAsOf: Number.isFinite(dataMs) ? new Date(dataMs).toISOString() : null,
    ageHours: ageMs == null ? null : Math.round((ageMs / 3_600_000) * 10) / 10,
    stale: ageMs == null || ageMs > REFRESH_STALE_MS
  };
}

// The cron fires on fixed clock times while nextAttemptAt is stored as
// "run time + 6 h", so a tick can land seconds before a vendor's due time. Without
// a small tolerance that tick skips every vendor and the board silently drifts from
// a six-hour to a twelve-hour refresh cadence (and reports stale for hours between
// runs). Successful vendors therefore count as due up to this much early; vendors
// inside a failure backoff keep their strict due time.
export const EARLY_DUE_TOLERANCE_MS = 15 * 60 * 1000;

export function isVendorDue(state, now) {
  if (!state?.nextAttemptAt) return true;
  const due = Date.parse(state.nextAttemptAt);
  if (!Number.isFinite(due)) return true;
  const slack = (state.consecutiveFailures ?? 0) > 0 ? 0 : EARLY_DUE_TOLERANCE_MS;
  return due <= now + slack;
}

export async function runRefresh({
  store,
  vendors = registeredVendors(),
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  includeFx = true,
  trigger = 'scheduled',
  holderId = `refresh-${now}-${Math.random().toString(36).slice(2, 8)}`,
  logger = null,
  sleep = undefined,
  clock = undefined,
  // Test seam for the completion timestamp. Production uses the real clock, so
  // `finishedAt` is the true finish time; a simulation can pass a time source on
  // the same timeline as `now`, which keeps stored freshness deterministic across
  // a multi-tick cron sequence instead of mixing in the real wall clock.
  timeSource = undefined
} = {}) {
  const currentTimeMs = () => (typeof timeSource === 'function' ? timeSource() : Date.now());
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
    // Read the stored observations once, before any vendor writes, so each new
    // observation can carry the previous successful price and stock as
    // comparison evidence. The map is anchored to the pre-run state.
    const previousByKey = new Map();
    for (const row of await store.listObservations()) previousByKey.set(row.key, row);

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
      const batchResults = await Promise.all(batch.map(({ vendor, state }) => refreshVendor({ store, vendor, state, fetchImpl, now, counter, logger, sleep, clock, previousByKey })));
      results.push(...batchResults);
    }

    let fx = null;
    if (includeFx) fx = await refreshFxCached({ store, fetchImpl, now, counter, logger });

    // Owner correction 2026-10-12: only Crema e Gusto is tracked. Historical
    // observations and failure markers for retired product lines are removed
    // from the live store so old data cannot linger or be counted anywhere.
    let pruned = 0;
    try {
      pruned = await pruneRetiredObservations({ store, vendors });
    } catch (error) {
      logger?.warn?.(`[refresh] retired-observation prune failed: ${error?.message ?? error}`);
    }

    const finishedAt = new Date(currentTimeMs()).toISOString();
    const summary = {
      trigger,
      startedAt,
      finishedAt,
      requests,
      pruned,
      vendors: results,
      fx: fx ? { ok: fx.ok, asOf: fx.fx?.asOf ?? null, error: fx.error ?? null } : { skipped: true }
    };
    await store.recordRun(summary);
    // A completed refresh means at least one vendor actually produced a saved
    // observation. A run that fetched only the exchange-rate table (every vendor
    // still inside its backoff window) or fetched nothing at all must not make
    // the board look freshly checked when no offer was re-observed.
    const savedAny = results.some(result => (result.saved ?? 0) > 0);
    if (savedAny) {
      await store.setMeta('lastRefreshAt', { value: finishedAt, trigger });
    }
    return summary;
  } finally {
    await store.releaseLease('refresh');
  }
}

async function refreshVendor({ store, vendor, state, fetchImpl, now, counter, logger, sleep, clock, previousByKey = null }) {
  const fetchText = createBoundedFetcher({
    fetchImpl,
    allowedHosts: vendor.allowedHosts ?? vendorHosts([vendor]),
    onRequest: counter,
    // Respect a vendor's published crawl delay (for example "Crawl-delay: 7")
    // instead of firing every tracked offer back to back.
    minIntervalMs: vendor.crawlDelayMs ?? 0,
    sleep: sleep ?? pacingDefaults.sleep,
    clock: clock ?? pacingDefaults.clock
  });
  const attemptedAt = new Date(now).toISOString();
  let saved = 0;
  const failures = [];
  // A failed fetch has no freshly parsed key, so stamp the failure on the offer's
  // last successful observation row when one exists. The row keeps its observedAt,
  // price and stock, while `attemptedAt`/`lastError` describe the most recent check
  // attempt — including a failed one — instead of leaving a detached marker that no
  // board row can show. Offers that never succeeded keep the marker key. When a
  // legacy blend-keyed row and its stable-keyed replacement both exist for the same
  // listing URL, the marker must land on the newest row because that is the one the
  // board shows.
  const attemptKeyFor = offer => {
    const observedMs = row => {
      const parsed = Date.parse(row?.observedAt ?? '');
      return Number.isFinite(parsed) ? parsed : -Infinity;
    };
    const candidates = previousByKey
      ? [...previousByKey.values()].filter(row => row?.observedAt && row?.itemUrl === offer?.url)
      : [];
    if (candidates.length) {
      return candidates.reduce((newest, row) =>
        observedMs(row) > observedMs(newest) ? row : newest
      ).key;
    }
    return `${vendor.id}:offer:${offer?.id ?? 'unknown'}`;
  };
  try {
    const outcome = await vendor.observe({ fetchText, now, logger });
    for (const observation of outcome.observations ?? []) {
      observation.attemptedAt = attemptedAt;
      observation.lastError = null;
      // Keep one step of comparison evidence: what the same offer showed at the
      // previous successful check. Attempt markers have no observedAt and are
      // skipped, so a failed refresh never fabricates a previous price. A row
      // saved under the pre-correction key (which included the blend wording a
      // listing printed) is still the same offer, so fall back to the newest
      // successful row for the same listing URL and keep the comparison across
      // the key change instead of losing it once.
      let previous = previousByKey?.get(observation.key);
      if (!previous?.observedAt && previousByKey) {
        const observedMs = row => {
          const parsed = Date.parse(row?.observedAt ?? '');
          return Number.isFinite(parsed) ? parsed : -Infinity;
        };
        previous = [...previousByKey.values()]
          .filter(row => row?.observedAt && row?.itemUrl === observation.itemUrl)
          .sort((a, b) => observedMs(b) - observedMs(a))[0];
      }
      if (previous?.observedAt && previous?.price?.amount != null) {
        observation.previous = {
          observedAt: previous.observedAt,
          price: { amount: previous.price.amount, currency: previous.price.currency ?? null },
          availability: previous.availability ?? 'unknown',
          totalGrams: previous.product?.totalGrams ?? null
        };
      }
      await store.putObservation(observation);
      saved += 1;
    }
    for (const failure of outcome.failures ?? []) {
      failures.push(failure);
      const offer = (vendor.offers ?? []).find(candidate => candidate.id === failure.offerId);
      await store.markAttempt({
        key: attemptKeyFor(offer),
        attemptedAt,
        error: failure.error
      });
    }
  } catch (error) {
    failures.push({ offerId: '*', error: error?.message ?? String(error) });
    for (const offer of vendor.offers ?? []) {
      await store.markAttempt({ key: attemptKeyFor(offer), attemptedAt, error: error?.message ?? String(error) });
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
  const promise = run({ store, trigger: 'initial', now, ...options }).catch(error => {
    console.warn(`initial refresh failed: ${error?.message ?? error}`);
    return null;
  });
  if (ctx?.waitUntil) ctx.waitUntil(promise);
  return { started: true, promise };
}

/**
 * Remove stored rows that belong to retired product lines or to offers that are
 * no longer tracked. The tracked product's last-known-good observations are
 * never touched, so a failing vendor still keeps its previous price and stock.
 * Returns the number of rows removed.
 */
export async function pruneRetiredObservations({ store, vendors = registeredVendors() } = {}) {
  if (typeof store?.deleteObservation !== 'function') return 0;
  const activeProductIds = new Set(PRODUCTS.map(product => product.id));
  const trackedAttemptKeys = new Set(vendors.flatMap(vendor =>
    (vendor.offers ?? []).map(offer => `${vendor.id}:offer:${offer.id}`)
  ));
  let pruned = 0;
  for (const row of await store.listObservations()) {
    const productId = row?.product?.productId ?? null;
    const retiredProduct = productId != null && !activeProductIds.has(productId);
    const retiredAttempt = typeof row?.key === 'string'
      && row.key.includes(':offer:')
      && !trackedAttemptKeys.has(row.key);
    if (!retiredProduct && !retiredAttempt) continue;
    await store.deleteObservation(row.key);
    pruned += 1;
  }
  return pruned;
}
