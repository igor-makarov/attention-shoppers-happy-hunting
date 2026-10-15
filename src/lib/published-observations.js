// Read-only merge of the checked-in published observation snapshot into a board
// read (src/data/published-observations.js).
//
// Why this exists: the deployed Worker's own scheduled refresh can be blocked or
// pending — for the grocery adapters the store WAFs answer the Worker's egress
// with HTTP 403 — while the same bounded public fetch succeeds from the GitHub
// Actions runner. That runner evidence is real, recorded and sanitized, so the
// public board can show it instead of an unexplained blank board. The snapshot is
// checked-in data, never runtime state: it is merged into reads only, never
// written into the store, and it never claims to be a Worker refresh.
//
// Precedence, per offer (vendor + listing URL):
//   1. a stored observation that is still inside the stale window always wins —
//      the live pipeline's own current data is authoritative;
//   2. otherwise the newer of the stored row and the published row wins, with the
//      stored row winning an exact tie, so an older published snapshot can never
//      revive stock that a newer stored observation says is unavailable;
//   3. a stored row without `observedAt` is a failure marker, not an observation:
//      it never outranks anything, and its failure is folded into the winner's
//      `liveCheck` block so the failed or pending check stays visible.
//
// Every quote the engine produces already carries its own freshness rule, so a
// published row older than the stale window stays visible as dated evidence and
// stops ranking exactly like a stored row.

import { offerIdentity, observationIsStale, DEFAULT_STALE_AFTER_MS } from './quote.js';
import { PUBLISHED_SNAPSHOT } from '../data/published-observations.js';
import { registeredVendors } from '../vendors/index.js';

/** Rows of the snapshot that are usable board evidence. */
export function publishedObservationRows(snapshot = PUBLISHED_SNAPSHOT) {
  return (snapshot?.observations ?? []).filter(row => row?.vendor?.id && row?.itemUrl && row?.observedAt);
}

/**
 * Public summary of the snapshot for the board API and the UI. Everything a
 * shopper (or an overseer) needs to judge the evidence: what run it came from,
 * when it was recorded, which adapters produced it and whether any row is still
 * inside the freshness window. No row payloads are duplicated here.
 */
export function publishedSnapshotSummary(snapshot = PUBLISHED_SNAPSHOT, now = Date.now(), staleAfterMs = DEFAULT_STALE_AFTER_MS) {
  const rows = publishedObservationRows(snapshot);
  const times = rows.map(row => Date.parse(row.observedAt)).filter(Number.isFinite);
  const fresh = rows.filter(row => !observationIsStale(row, now, staleAfterMs));
  return {
    id: snapshot?.id ?? null,
    label: snapshot?.label ?? null,
    origin: snapshot?.origin ?? null,
    source: snapshot?.source ?? null,
    recordedAt: snapshot?.recordedAt ?? null,
    evidence: snapshot?.evidence ?? null,
    note: snapshot?.note ?? null,
    adapters: [...(snapshot?.adapters ?? [])],
    unavailableVendors: [...(snapshot?.unavailableVendors ?? [])],
    observationCount: rows.length,
    vendors: [...new Set(rows.map(row => row.vendor.id))].sort(),
    productIds: [...new Set(rows.map(row => row.product?.productId).filter(Boolean))].sort(),
    oldestObservedAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    newestObservedAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
    freshObservationCount: fresh.length,
    // When every row is past the stale window the snapshot no longer ranks
    // anything; it stays published as dated evidence only.
    expired: rows.length > 0 && fresh.length === 0
  };
}

/**
 * A failure-only marker row is stored as `${vendorId}:offer:${offerId}` because
 * the refresh pipeline had no parsed key for it. Map it back to the offer's real
 * listing identity so the marker can be folded into the right row; return null
 * for anything unrecognised so the row passes through untouched.
 */
function markerIdentity(row, vendors) {
  const match = /^([A-Za-z0-9._-]+):offer:(.+)$/.exec(String(row?.key ?? ''));
  if (!match) return null;
  const vendor = vendors.find(candidate => candidate.id === match[1]);
  const offer = (vendor?.offers ?? []).find(candidate => candidate.id === match[2]);
  if (!offer) return null;
  return offerIdentity({ vendor: { id: vendor.id }, itemUrl: offer.itemUrl ?? offer.url });
}

/**
 * What the Worker's own scheduled check last did for one vendor. `checked` means
 * the live pipeline is current, so the stored row speaks for itself and nothing
 * extra is disclosed. `failed` means the last attempt(s) failed (the store keeps
 * the last good observation). `pending` means no scheduled check has run for that
 * vendor on this deployment at all.
 */
export function vendorCheckState(state) {
  if (!state || (!state.lastAttemptAt && !state.lastSuccessAt)) return 'pending';
  if ((state.consecutiveFailures ?? 0) > 0) return 'failed';
  return 'checked';
}

export function liveCheckForVendor(state) {
  const status = vendorCheckState(state);
  if (status === 'checked') return null;
  return {
    state: status,
    attemptedAt: state?.lastAttemptAt ?? null,
    error: status === 'failed' ? (state?.lastErrors?.[0] ?? null) : null,
    consecutiveFailures: state?.consecutiveFailures ?? 0,
    nextAttemptAt: state?.nextAttemptAt ?? null
  };
}

/**
 * Merge the published snapshot into a set of stored rows for one board read.
 * Returns the merged rows plus the audit trail of what happened:
 * `backfilled` (shown from the snapshot), `superseded` (published row that lost)
 * and `sources` (per-offer origin). The input array is never mutated.
 */
export function mergePublishedObservations(observations = [], {
  snapshot = PUBLISHED_SNAPSHOT,
  now = Date.now(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  liveChecks = null,
  vendors = registeredVendors()
} = {}) {
  const stored = Array.isArray(observations) ? [...observations] : [];
  const publishedByIdentity = new Map();
  for (const row of publishedObservationRows(snapshot)) {
    const identity = offerIdentity(row);
    const current = publishedByIdentity.get(identity);
    if (!current || Date.parse(row.observedAt) > Date.parse(current.observedAt)) {
      publishedByIdentity.set(identity, row);
    }
  }

  const groups = new Map();
  for (const row of stored) {
    const identity = row?.observedAt ? offerIdentity(row) : (markerIdentity(row, vendors) ?? offerIdentity(row));
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push(row);
  }

  const merged = [];
  const backfilled = [];
  const superseded = [];
  const sources = new Map();
  const identities = [...new Set([...groups.keys(), ...publishedByIdentity.keys()])];

  for (const identity of identities) {
    const rows = groups.get(identity) ?? [];
    const storedBest = rows
      .filter(row => row.observedAt)
      .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0] ?? null;
    const publishedRow = publishedByIdentity.get(identity) ?? null;
    const markerRows = rows.filter(row => !row.observedAt);

    if (!storedBest && !publishedRow) {
      // Nothing to show for this identity: keep the failure marker(s) exactly as
      // stored so an offer that never succeeded still reports its last attempt.
      merged.push(...markerRows);
      continue;
    }

    const storedFresh = storedBest ? !observationIsStale(storedBest, now, staleAfterMs) : false;
    const publishedNewer = !storedBest || Date.parse(publishedRow?.observedAt ?? '') > Date.parse(storedBest.observedAt);
    const usePublished = Boolean(publishedRow) && !storedFresh && publishedNewer;

    if (usePublished) {
      const vendorId = publishedRow.vendor?.id ?? null;
      merged.push({
        ...publishedRow,
        // The published row keeps every recorded field, including its own
        // `observedAt`; the snapshot block and the live-check block say where it
        // came from and what the Worker's scheduled check last did.
        published: {
          snapshotId: snapshot?.id ?? null,
          origin: snapshot?.origin ?? null,
          source: snapshot?.source ?? null,
          recordedAt: publishedRow.observedAt ?? null,
          evidence: snapshot?.evidence ?? null,
          note: snapshot?.note ?? null
        },
        liveCheck: (liveChecks && vendorId ? liveChecks[vendorId] : null) ?? null
      });
      sources.set(identity, 'published_snapshot');
      backfilled.push({ identity, vendorId, itemUrl: publishedRow.itemUrl ?? null, observedAt: publishedRow.observedAt ?? null });
      continue;
    }

    // The stored row wins. It already carries its own `lastError`/`attemptedAt`
    // when the last attempt failed, so the live-check block is only added when it
    // describes something the row itself does not.
    const liveCheck = storedBest.lastError ? null : ((liveChecks && storedBest.vendor?.id ? liveChecks[storedBest.vendor.id] : null) ?? null);
    merged.push(liveCheck ? { ...storedBest, liveCheck } : storedBest);
    sources.set(identity, 'worker_refresh');
    if (publishedRow) {
      superseded.push({
        identity,
        vendorId: storedBest.vendor?.id ?? null,
        reason: storedFresh ? 'live-observation-current' : 'newer-stored-observation'
      });
    }
  }

  return {
    observations: merged,
    sources,
    backfilled,
    superseded,
    published: {
      snapshotId: snapshot?.id ?? null,
      observationCount: publishedByIdentity.size,
      applied: backfilled.length
    }
  };
}

/**
 * Live-check block per vendor, keyed by vendor id. `vendorStates` is the store's
 * vendor_state map (possibly empty); every registered vendor with an offer for
 * the product gets an entry so a source that has never been attempted still
 * reports `pending` instead of disappearing from the board.
 */
export function liveChecksForProduct(vendorStates = {}, productId, vendors = registeredVendors()) {
  const states = vendorStates ?? {};
  const checks = {};
  for (const vendor of vendors) {
    if (!(vendor.offers ?? []).some(offer => (offer.productId ?? null) === productId)) continue;
    const state = states[vendor.id] ?? null;
    if (!state) checks[vendor.id] = liveCheckForVendor(null);
    else checks[vendor.id] = liveCheckForVendor(state);
  }
  return checks;
}

/** Plain-language reason for one vendor's live-check state, for the UI. */
export function liveCheckNote(check) {
  if (!check) return null;
  if (check.state === 'failed') {
    const when = check.attemptedAt ? ` (last attempt ${check.attemptedAt})` : '';
    return `The Worker's scheduled check for this source is failing${when}: ${check.error ?? 'no error recorded'}.`;
  }
  if (check.state === 'pending') {
    return 'No scheduled check has run for this source on this deployment yet.';
  }
  return null;
}

/**
 * Per-vendor live-check rows for the board API. Every registered vendor with an
 * offer for the product is listed — including one whose store row does not exist
 * yet, which reports `pending` — so a failed or pending runtime check stays
 * visible even when the database never saved that vendor's offer. `sources` is
 * the merge's per-offer origin map, so the row also says how many of the offers
 * a shopper actually sees came from the published snapshot.
 */
export function vendorCheckEntries({ vendors = registeredVendors(), vendorStates = {}, productId, sources = new Map() } = {}) {
  const states = vendorStates ?? {};
  const out = [];
  for (const vendor of vendors) {
    const offers = (vendor.offers ?? []).filter(offer => (offer.productId ?? null) === productId);
    if (!offers.length) continue;
    const state = states[vendor.id] ?? null;
    let publishedObservations = 0;
    let storedObservations = 0;
    for (const offer of offers) {
      const identity = offerIdentity({ vendor: { id: vendor.id }, itemUrl: offer.itemUrl ?? offer.url });
      const origin = sources.get(identity);
      if (origin === 'published_snapshot') publishedObservations += 1;
      else if (origin === 'worker_refresh') storedObservations += 1;
    }
    out.push({
      vendorId: vendor.id,
      lastAttemptAt: state?.lastAttemptAt ?? null,
      lastSuccessAt: state?.lastSuccessAt ?? null,
      consecutiveFailures: state?.consecutiveFailures ?? 0,
      nextAttemptAt: state?.nextAttemptAt ?? null,
      lastErrors: state?.lastErrors ?? [],
      state: vendorCheckState(state),
      publishedObservations,
      storedObservations,
      note: liveCheckNote(liveCheckForVendor(state))
    });
  }
  return out;
}
