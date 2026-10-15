// Product-detail client for one tracked product.
//
// The page keeps the shopping decision compact: product identity, quantity and
// locality controls, then the best eligible offer with item subtotal, named
// shipping method/charge and delivered total visible together. There is no
// blend/variant selection: every eligible Crema e Gusto ground listing takes
// part in one comparison, and an obsolete `variant=` URL parameter is ignored.
// Everything else — other offers, delivery alternatives and conditions, pickup,
// missing-information offers, check history and diagnostics — is progressively
// disclosed in native <details> sections. All vendor text is inserted as text.

import {
  el, money, bidi, timeLabel, dueLabel, truncate,
  packDescription, quantityDescription, itemSubtotalText,
  totalsBlock, statusBadge, offerLink, conditionsList, caveatBlock,
  coverageQualifier, failedCheckNote, diagnosticsDisclosure
} from './ui.js';

const params = new URLSearchParams(location.search);
const pathProduct = decodeURIComponent(location.pathname.replace(/^\/product\/?/, '')) || null;

// Old shared URLs may still carry an obsolete `variant=` parameter. Discard it
// from the address bar (quantity and locality stay) so the URL resolves to the
// one unified comparison instead of implying a second, filtered view.
if (params.has('variant')) {
  const cleaned = new URLSearchParams(params);
  cleaned.delete('variant');
  const query = cleaned.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
}

const state = {
  grams: Number(params.get('grams')) || 500,
  quantity: params.has('quantity') ? Number(params.get('quantity')) : null,
  destination: params.get('dest') || 'tel-aviv',
  product: pathProduct,
  requestedProduct: params.get('product') || pathProduct,
  catalog: null,
  board: null,
  error: null
};

// Monotonic request token: board requests can overlap when a shopper changes the
// quantity or destination while a previous request is still in flight. Only the
// newest request may write state.
let loadToken = 0;

function packLine(quote) {
  return `${packDescription(quote)} · ${quantityDescription(quote)}`;
}

function destinationLabel(id) {
  const found = (state.catalog?.destinations ?? []).find(item => item.id === id);
  return found?.label ?? id;
}

async function load() {
  const token = ++loadToken;
  try {
    const catalogResponse = await fetch('/api/catalog').then(response => response.json());
    if (token !== loadToken) return;
    state.catalog = catalogResponse;
    applyProductDefaults();
    // The requested id (which may name a retired line) is sent as requested so
    // the API can report the fallback instead of hiding it.
    const requestedProduct = state.requestedProduct ?? state.product;
    const query = new URLSearchParams({ product: requestedProduct, dest: state.destination });
    query.set(currentProduct()?.quantity?.mode === 'units' ? 'quantity' : 'grams', String(state.quantity ?? state.grams));
    const board = await fetch(`/api/board?${query}`).then(response => response.json());
    if (token !== loadToken) return;
    state.board = board;
    if (board.product?.id) state.product = board.product.id;
    // A malformed shared URL (for example `grams=abc` or an unknown `dest`) is
    // clamped or resolved by the API. Adopt exactly what was quoted so the
    // controls, the address bar and the board never disagree.
    normalizeQuotedSelection();
    state.error = null;
  } catch (error) {
    if (token !== loadToken) return;
    state.error = error?.message ?? String(error);
  }
  if (token !== loadToken) return;
  document.body.dataset.boardState = state.error ? 'error' : 'ready';
  render();
}

/** Keep the selected product valid for the tracked catalog. */
function applyProductDefaults() {
  const catalogProducts = state.catalog?.products ?? [];
  if (!catalogProducts.length) return;
  const requested = catalogProducts.find(item => item.id === state.requestedProduct);
  if (requested) state.product = requested.id;
  if (!catalogProducts.some(item => item.id === state.product)) state.product = catalogProducts[0].id;
  const config = currentProduct()?.quantity;
  if (config?.mode === 'units') {
    const requestedQuantity = state.quantity ?? (params.has('grams') ? state.grams / config.unitGrams : config.default);
    state.quantity = config.options.includes(requestedQuantity) ? requestedQuantity : config.default;
    state.grams = state.quantity * config.unitGrams;
  } else {
    state.quantity = null;
  }
}

function currentProduct() {
  return (state.catalog?.products ?? []).find(item => item.id === state.product) ?? null;
}

function render() {
  renderIdentity();
  renderControls();
  updateFooterStatus();
  const board = document.getElementById('board');
  board.replaceChildren();
  if (state.error) {
    board.append(el('div', { class: 'empty' },
      el('strong', { text: 'The comparison could not be loaded.' }),
      el('p', { text: `Reason: ${state.error}. The stored observations are safe; try again in a moment.` })));
    return;
  }
  if (!state.board) return;
  const boardData = state.board;
  const fallbackNotice = renderFallbackNotice(boardData);
  if (fallbackNotice) board.append(fallbackNotice);
  board.append(renderDecision(boardData));
}

/** Product heading names the product; the masthead carries the compact branding. */
function renderIdentity() {
  const product = state.board?.product ?? currentProduct();
  const title = document.getElementById('product-title');
  const subtitle = document.getElementById('product-subtitle');
  if (title && product) {
    title.textContent = `${product.brand} ${product.line}`;
    document.title = `${title.textContent} — delivered prices`;
  }
  if (subtitle && product) {
    subtitle.textContent = product.detailDescription ?? product.description;
  }
}

function renderFallbackNotice(board) {
  if (board.requestedRetiredProduct) {
    return el('div', { class: 'notice', attrs: { id: 'retired-product-notice', role: 'note' } },
      el('strong', { text: 'Retired product line' }),
      el('p', {},
        'This link asked for Lavazza ',
        bidi(board.requestedRetiredProduct.line),
        '. That Lavazza line is retired. The comparison below covers Crema e Gusto offers only.'));
  }
  const requested = state.requestedProduct;
  if (requested && board.product && requested !== board.product.id) {
    return el('div', { class: 'notice', attrs: { id: 'unknown-product-notice', role: 'note' } },
      el('strong', { text: 'Untracked product link' }),
      el('p', { text: `This link asked for product “${requested}”, which is not tracked. Showing the tracked product instead.` }));
  }
  return null;
}

/** Default view: best eligible offer plus progressively disclosed comparison. */
function renderDecision(board) {
  const section = el('section', { class: 'decision', attrs: { id: 'decision' } });
  if (board.batchComparisons) section.append(renderBatches(board));
  if (!board.best) {
    section.append(el('div', { class: 'empty' },
      el('strong', { text: 'No offer can be ranked for this selection right now.' }),
      el('p', { text: board.product?.sourcing?.note ?? 'Ranking needs a fresh confirmed stock observation and a published or observed shipping rate. The offers with missing information below explain exactly what is missing.' })));
    const sources = board.product?.sourcing?.sources ?? [];
    if (sources.length) section.append(el('details', { class: 'disclosure' },
      el('summary', { text: 'Product listings to check' }),
      el('div', { class: 'disclosure__body' },
        el('p', { text: 'These listings have no verified delivered total for the selected batch and locality.' }),
        ...sources.map(source => el('p', {}, el('a', { href: source.url, text: source.label, attrs: { target: '_blank', rel: 'noopener noreferrer' } }))))));
  } else {
    section.append(renderBestOffer(board.best, board));
    const others = board.ranked.slice(1);
    if (others.length) section.append(renderCompareDisclosure(others, board));
  }
  const pickup = board.pickup ?? [];
  if (pickup.length && !board.deliveryOnly) section.append(renderPickupDisclosure(pickup));
  const unknownEntries = [...(board.unrankable ?? []), ...(board.staleOrUnavailable ?? [])];
  if (unknownEntries.length) section.append(renderUnknownDisclosure(unknownEntries));
  const perKgWinner = board.bestPerKg && board.best && board.bestPerKg.key !== board.best.key ? board.bestPerKg : null;
  if (perKgWinner) {
    const quantity = (perKgWinner.packCount ?? 1) > 1
      ? `${perKgWinner.units} multipack${perKgWinner.units === 1 ? '' : 's'} (${perKgWinner.packCount} × ${perKgWinner.packGrams} g) = ${perKgWinner.orderedGrams} g`
      : `${perKgWinner.units} × ${perKgWinner.packGrams} g pack${perKgWinner.units === 1 ? '' : 's'} = ${perKgWinner.orderedGrams} g`;
    section.append(el('p', { class: 'meta-line' },
      'Cheapest per kilogram: ',
      bidi(perKgWinner.vendor?.name ?? ''),
      ` — ${money(perKgWinner.ilsPerKg)} per kg (${quantity}, delivered ${money(perKgWinner.totalIls)})`));
  }
  section.append(el('p', { class: 'meta-line', text: 'Comparison total = item subtotal + shipping + mandatory fees, converted to ILS where a stored Bank of Israel reference rate is needed. This is not a personalized checkout quote.' }));
  section.append(renderFooterStatus(board));
  return section;
}

function renderBatches(board) {
  const table = el('table', { class: 'batch-comparison', attrs: { id: 'batch-comparison' } },
    el('caption', { text: 'Lowest total including delivery · 250 g tubs' }),
    el('thead', {}, el('tr', {},
      el('th', { text: 'Batch', attrs: { scope: 'col' } }),
      el('th', { text: 'Items + delivery', attrs: { scope: 'col' } }),
      el('th', { text: 'Lowest total', attrs: { scope: 'col' } }))));
  const body = el('tbody');
  for (const batch of board.batchComparisons) {
    const best = batch.best;
    body.append(el('tr', { class: batch.quantity === board.targetQuantity ? 'batch-comparison__selected' : '' },
      el('th', { attrs: { scope: 'row' } }, el('button', { type: 'button', text: `${batch.quantity} tubs`,
        attrs: { 'aria-pressed': String(batch.quantity === board.targetQuantity) }, onClick: () => update({ quantity: batch.quantity }) })),
      el('td', { class: 'num', text: best ? `${money(best.itemTotalIls)} + ${money(best.shippingIls)}` : 'Unverified' }),
      el('td', {}, el('strong', { class: 'num', text: best ? money(best.totalIls) : 'Not available' }),
        best ? el('div', { class: 'meta-line' }, bidi(best.vendor.name)) : null)));
  }
  table.append(body);
  return table;
}

/** Best eligible offer: vendor, pack/grams, the three money values and a short warning. */
function renderBestOffer(quote, board) {
  const card = el('article', { class: 'offer offer--best', attrs: { id: 'best-offer' } });
  // One compact identity row: the best-offer label, the vendor and its stock
  // label. The full comparison values follow immediately below so the money is
  // in the first mobile viewport instead of below a second heading row.
  card.append(el('div', { class: 'offer__top' },
    el('span', { class: 'tag tag--best', text: 'Best known delivered total' }),
    el('div', { class: 'offer__vendor' }, bidi(quote.vendor.name), ' ', statusBadge(quote.availability, quote.availabilityLabel))));
  card.append(el('p', { class: 'offer__pack', text: packLine(quote) }));
  card.append(totalsBlock(quote));
  const failedNote = failedCheckNote(quote);
  if (failedNote) card.append(el('p', { class: 'qualifier qualifier--failure', text: failedNote }));
  const qualifier = coverageQualifier(quote);
  if (qualifier) card.append(el('p', { class: 'qualifier' }, el('strong', { text: 'Conditional total: ' }), bidi(qualifier)));
  const delivery = deliveryOptionsDisclosure(quote);
  if (delivery) card.append(delivery);
  card.append(el('p', { class: 'offer__links' }, offerLink(quote, 'Open the vendor page')));
  card.append(diagnosticsDisclosure(quote));
  return card;
}

/**
 * Delivery alternatives, pickup terms, free-shipping conditions, coverage prose
 * and rate limits for one offer, collapsed behind one disclosure. Returns null
 * when there is nothing to disclose, so empty sections are never rendered.
 */
function deliveryOptionsDisclosure(quote) {
  const body = el('div', { class: 'disclosure__body' });
  const conditions = conditionsList(quote, destinationLabel);
  if (conditions) body.append(conditions);
  const caveat = caveatBlock(quote);
  if (caveat) body.append(caveat);
  if (!body.childNodes.length) return null;
  return el('details', { class: 'disclosure', attrs: { id: `delivery-options-${slug(quote.key)}` } },
    el('summary', { text: 'Delivery options and conditions' }), body);
}

/** Other ranked offers, collapsed: one compact card each with its own details. */
function renderCompareDisclosure(others, board) {
  const details = el('details', { class: 'disclosure disclosure--compare', attrs: { id: 'compare-other-offers' } });
  details.append(el('summary', { text: `Compare other offers (${others.length})` }));
  const list = el('div', { class: 'offer-list offer-list--compact' });
  for (const quote of others) list.append(renderOtherOffer(quote, board));
  details.append(list);
  return details;
}

function renderOtherOffer(quote, board) {
  const card = el('article', { class: 'offer offer--compact' });
  card.append(el('div', { class: 'offer__top' },
    el('div', { class: 'offer__vendor' }, bidi(quote.vendor.name), ' ', statusBadge(quote.availability, quote.availabilityLabel)),
    el('div', { class: 'offer__delta', text: offerDeltaText(quote, board) })));
  card.append(el('p', { class: 'offer__pack', text: packLine(quote) }));
  card.append(totalsBlock(quote));
  const failedNote = failedCheckNote(quote);
  if (failedNote) card.append(el('p', { class: 'qualifier qualifier--failure', text: failedNote }));
  const qualifier = coverageQualifier(quote);
  if (qualifier) card.append(el('p', { class: 'qualifier', text: qualifier }));
  const delivery = deliveryOptionsDisclosure(quote);
  if (delivery) card.append(delivery);
  card.append(el('p', { class: 'offer__links' }, offerLink(quote, 'Open the vendor page')));
  card.append(diagnosticsDisclosure(quote));
  return card;
}

function offerDeltaText(quote, board) {
  const delta = board.best && Number.isFinite(quote.totalIls) && Number.isFinite(board.best.totalIls)
    ? Math.round((quote.totalIls - board.best.totalIls) * 100) / 100
    : null;
  if (delta == null) return '';
  if (delta === 0) return 'Same delivered total as the best offer';
  return `+${money(delta)} vs best delivered total`;
}

/** Self-pickup stays separate from the delivered ranking and collapsed by default. */
function renderPickupDisclosure(pickup) {
  const details = el('details', { class: 'disclosure disclosure--pickup', attrs: { id: 'pickup-options' } });
  details.append(el('summary', { text: `Self-pickup options (${pickup.length}) — not a delivered price` }));
  const body = el('div', { class: 'disclosure__body' });
  body.append(el('p', { text: 'Pickup never competes in the delivered ranking. Pickup that accompanies a delivered offer is also shown on that offer card.' }));
  for (const quote of pickup) {
    const pickupFee = quote.pickup?.amount?.amount;
    const feeText = pickupFee === 0 ? 'Free' : pickupFee != null ? money(pickupFee) : 'See vendor policy';
    const terms = [quote.pickup?.note, quote.labels.join('. ')].filter(Boolean).join(' ');
    body.append(el('div', { class: 'pickup-row' },
      el('div', { class: 'pickup-row__head' },
        el('strong', {}, bidi(quote.vendor.name)),
        el('span', { class: 'pickup-row__pack', text: packLine(quote) })),
      el('div', { class: 'pickup-row__facts' },
        el('span', { text: `Item subtotal: ${itemSubtotalText(quote)}` }),
        el('span', { text: `Pickup fee: ${feeText}` }),
        el('span', { text: 'Self-pickup, not delivery' })),
      terms ? el('details', { class: 'disclosure' }, el('summary', { text: 'Pickup terms' }), el('p', { class: 'disclosure__body' }, bidi(terms))) : null,
      el('p', { class: 'pickup-row__link' }, offerLink(quote, 'Open the vendor page'))));
  }
  details.append(body);
  return details;
}

/** Unknown, stale and unavailable offers stay visible with their exact reason. */
function renderUnknownDisclosure(entries) {
  const details = el('details', { class: 'disclosure disclosure--unknown', attrs: { id: 'unknown-offers' } });
  details.append(el('summary', { text: `Offers with missing information (${entries.length})` }));
  const body = el('div', { class: 'disclosure__body' });
  body.append(el('p', { text: 'These observations stay visible with their source and the exact reason a delivered total cannot be calculated. Missing shipping is never treated as zero.' }));
  const list = el('div', { class: 'unknown-list' });
  for (const quote of entries) {
    const card = el('article', { class: 'unknown' });
    card.append(el('div', { class: 'unknown__vendor' }, bidi(quote.vendor.name), ' ', statusBadge(quote.availability, quote.availabilityLabel)));
    card.append(el('div', { class: 'unknown__meta', text: packLine(quote) }));
    card.append(el('div', { class: 'unknown__grid' },
      el('span', { text: `Item subtotal: ${itemSubtotalText(quote)}` }),
      el('span', { text: `Shipping: ${quote.shipping?.amountIls != null ? money(quote.shipping.amountIls) : 'Shipping not published'}` }),
      el('span', { text: `Last successful check: ${timeLabel(quote.observedAt)}` }),
      quote.lastAttemptFailed ? el('span', { text: `Last attempt failed ${timeLabel(quote.attemptedAt)}${quote.lastError ? ` — ${truncate(quote.lastError)}` : ''}` }) : null));
    if (quote.shipping?.certainty === 'unknown' || quote.shipping?.amount == null) {
      card.append(el('p', { class: 'unknown__reason', text: 'Shipping not published. Needed for a delivered total: a published rate or a public checkout-estimator quote for this quantity and locality. A missing rate is never counted as free.' }));
    }
    card.append(el('p', { class: 'unknown__reason', text: quote.reasons.join('. ') || quote.labels.join('. ') || 'Not enough verified information yet.' }));
    const caveat = caveatBlock(quote);
    if (caveat) card.append(caveat);
    card.append(el('p', {}, offerLink(quote, 'Check this vendor page')));
    list.append(card);
  }
  body.append(list);
  details.append(body);
  return details;
}

function renderControls() {
  const config = currentProduct()?.quantity;
  const isUnits = config?.mode === 'units';
  const options = config?.options ?? [250, 500, 750, 1000, 2000];
  const quantityGroup = document.getElementById('quantity-group');
  const signature = JSON.stringify(config);
  quantityGroup.setAttribute('aria-label', isUnits ? 'Batch size in tubs' : 'Target quantity in grams');
  if (quantityGroup.dataset.ready !== signature) {
    quantityGroup.replaceChildren();
    for (const value of options) {
      quantityGroup.append(el('button', {
        type: 'button',
        text: isUnits ? `${value} tubs` : value >= 1000 ? `${value / 1000} kg` : `${value} g`,
        dataset: isUnits ? { quantity: String(value) } : { grams: String(value) },
        onClick: () => update(isUnits ? { quantity: value } : { grams: value })
      }));
    }
    quantityGroup.dataset.ready = signature;
  }
  for (const button of quantityGroup.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(isUnits ? Number(button.dataset.quantity) === state.quantity : Number(button.dataset.grams) === state.grams));
  }

  const destination = document.getElementById('destination');
  if (state.catalog?.destinations && !destination.dataset.ready) {
    for (const item of state.catalog.destinations) {
      destination.append(el('option', { value: item.id, text: item.postcode ? `${item.label} · ${item.postcode}` : item.label }));
    }
    destination.dataset.ready = 'true';
    destination.addEventListener('change', () => update({ destination: destination.value }));
  }
  destination.value = state.destination;
}

function update(patch) {
  Object.assign(state, patch);
  // Any user interaction replaces the URL's original product request with the
  // tracked product, so a retired-line link is not kept in the shareable URL.
  state.requestedProduct = null;
  applyProductDefaults();
  syncUrl();
  renderControls();
  load();
}

/**
 * Write the quoted quantity and locality into the shareable URL. The obsolete
 * `variant` parameter is deliberately never written back: one unified
 * comparison is the only view. `keepRequestedProduct` is used when the URL is
 * only normalized after load, so a retired-product link keeps its notice.
 */
function syncUrl({ keepRequestedProduct = false } = {}) {
  const query = keepRequestedProduct ? new URLSearchParams(location.search) : new URLSearchParams();
  query.delete('variant');
  const isUnits = currentProduct()?.quantity?.mode === 'units';
  query.delete(isUnits ? 'grams' : 'quantity');
  query.set(isUnits ? 'quantity' : 'grams', String(isUnits ? state.quantity : state.grams));
  query.set('dest', state.destination);
  history.replaceState(null, '', `/product/${encodeURIComponent(state.product)}?${query.toString()}`);
}

/**
 * Adopt the request the API actually quoted. `clampGrams()` falls back to 500 g
 * for a malformed quantity and `findDestination()` resolves an unknown locality
 * to its documented fallback; without this the select would render blank while
 * the board silently quoted a different destination.
 */
function normalizeQuotedSelection() {
  let changed = false;
  if (state.board?.targetQuantity != null && state.quantity !== state.board.targetQuantity) {
    state.quantity = state.board.targetQuantity;
    changed = true;
  }
  const targetGrams = state.board?.targetGrams;
  if (Number.isFinite(targetGrams) && targetGrams !== state.grams) {
    state.grams = targetGrams;
    changed = true;
  }
  const destination = state.board?.destination?.id;
  if (destination && destination !== state.destination) {
    state.destination = destination;
    changed = true;
  }
  // Also rewrite a query that never matched the quoted request (for example
  // `grams=abc`, which the API clamped to the 500 g default) so the address bar
  // can be shared again with the quantity and locality actually shown.
  const current = new URLSearchParams(location.search);
  current.delete('variant');
  const isUnits = currentProduct()?.quantity?.mode === 'units';
  if (current.get(isUnits ? 'quantity' : 'grams') !== String(isUnits ? state.quantity : state.grams)
    || current.has(isUnits ? 'grams' : 'quantity') || current.get('dest') !== state.destination) {
    changed = true;
  }
  if (changed) syncUrl({ keepRequestedProduct: true });
}

/** A product whose sourcing is not fully available still shows the pending label while it has no observations. */
function sourcingPending(status) {
  return status === 'pending' || status === 'partial';
}

function updateFooterStatus() {
  const node = document.getElementById('footer-status');
  if (!node) return;
  if (state.error) {
    node.textContent = 'The comparison could not be loaded from the snapshot API. Stored observations are safe; try again in a moment.';
    return;
  }
  const f = state.board?.freshness;
  if (state.board?.counts?.observed === 0 && sourcingPending(state.board?.product?.sourcing?.status)) {
    node.textContent = 'Delivery quotes for this product have not been verified yet.';
    return;
  }
  const last = f?.lastRefreshAt;
  const observed = f?.lastObservationAt;
  const stale = f?.stale;
  const age = f?.ageHours;
  if (last) {
    node.textContent = `Last completed refresh: ${timeLabel(last)}.${stale ? ` No completed scheduled refresh for ${age} h — prices may be out of date.` : ''}`;
  } else if (observed) {
    node.textContent = `Last offer observation: ${timeLabel(observed)}. No refresh has completed on this deployment yet${stale ? ` — offer data is ${age} h old` : ''}.`;
  } else {
    node.textContent = stale
      ? 'No scheduled refresh has completed yet — prices may be missing or out of date.'
      : 'No completed refresh yet; the first scheduled run will populate the comparison.';
  }
}

/** Board-level freshness and per-vendor diagnostics behind one disclosure. */
function renderFooterStatus(board) {
  if (board.counts?.observed === 0 && sourcingPending(board.product?.sourcing?.status)) {
    return el('p', { class: 'meta-line', text: 'No verified offer observations for this product yet.' });
  }
  const vendors = board.freshness?.vendors ?? [];
  const failing = vendors.filter(vendor => (vendor.consecutiveFailures ?? 0) > 0);
  const freshness = board.freshness ?? {};
  const dataAsOf = freshness.dataAsOf ?? freshness.lastRefreshAt ?? freshness.lastObservationAt ?? null;
  const wrap = el('div', { class: 'meta-line' });
  wrap.append(el('div', { text: `Board data as of: ${timeLabel(dataAsOf)} · Offers observed: ${board.counts.observed} · Ranked: ${board.counts.ranked}` }));
  if (freshness.stale) {
    const age = freshness.ageHours;
    wrap.append(el('div', { class: 'status status--stale status--note', text: freshness.lastRefreshAt
      ? `Scheduled refresh overdue by ${age} h — prices may be out of date.`
      : freshness.lastObservationAt
        ? `No completed scheduled refresh; the newest offer observation is ${age} h old — prices may be out of date.`
        : 'No scheduled refresh has completed yet — prices may be missing or out of date.' }));
  }
  if (failing.length) wrap.append(el('div', { class: 'status status--stale status--note', text: `${failing.length} source(s) failing` }));
  const body = el('div', { class: 'disclosure__body' });
  if (freshness.fx) {
    body.append(el('div', { text: `Exchange rates: ${freshness.fx.source ?? 'Bank of Israel'} published ${freshness.fx.asOf ?? 'unknown'} · fetched ${timeLabel(freshness.fx.fetchedAt)}` }));
  } else {
    body.append(el('div', { text: 'Exchange rates: no official rate table stored yet, so foreign-currency offers cannot be ranked.' }));
  }
  for (const vendor of vendors) {
    body.append(el('div', { text: `${vendor.vendorId}: last success ${timeLabel(vendor.lastSuccessAt)} · last attempt ${timeLabel(vendor.lastAttemptAt)}` }));
  }
  const nextDue = vendors.map(vendor => vendor.nextAttemptAt).filter(Boolean).sort()[0] ?? null;
  if (nextDue) body.append(el('div', { text: `Next source check due (approximate, set by each vendor's last run): ${dueLabel(nextDue)}` }));
  for (const vendor of failing) {
    body.append(el('div', { text: `${vendor.vendorId}: ${vendor.consecutiveFailures} consecutive failure(s) · next attempt ${dueLabel(vendor.nextAttemptAt)}${vendor.lastErrors?.[0] ? ` · last error: ${vendor.lastErrors[0]}` : ''}` }));
  }
  wrap.append(el('details', { class: 'disclosure' }, el('summary', { text: 'Refresh diagnostics' }), body));
  return wrap;
}

function slug(value) {
  return String(value ?? 'offer').replace(/[^a-z0-9]+/gi, '-').slice(0, 60);
}

load();
