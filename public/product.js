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
  coverageQualifier, diagnosticsDisclosure
} from './ui.js';

const GRAMS_OPTIONS = [250, 500, 750, 1000, 2000];

const params = new URLSearchParams(location.search);
const pathProduct = decodeURIComponent(location.pathname.replace(/^\/product\/?/, '')) || null;

const state = {
  grams: Number(params.get('grams')) || 500,
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
    const query = new URLSearchParams({ product: requestedProduct, grams: String(state.grams), dest: state.destination });
    const board = await fetch(`/api/board?${query}`).then(response => response.json());
    if (token !== loadToken) return;
    state.board = board;
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
  if (!catalogProducts.some(item => item.id === state.product)) state.product = catalogProducts[0].id;
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
  if (title && product) title.textContent = `${product.brand} ${product.line}`;
  if (subtitle && product) {
    subtitle.textContent = `${product.form} coffee · ${product.packaging} · delivery in Israel`;
  }
}

function renderFallbackNotice(board) {
  if (board.requestedRetiredProduct) {
    return el('div', { class: 'notice', attrs: { id: 'retired-product-notice', role: 'note' } },
      el('strong', { text: 'Retired product line' }),
      el('p', {},
        'This link asked for Lavazza ',
        bidi(board.requestedRetiredProduct.line),
        '. Only Lavazza Crema e Gusto vacuum-packed ground coffee is tracked now, so the comparison below covers Crema e Gusto offers only. Re-tracking another product line needs an explicit new owner instruction.'));
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
  if (!board.best) {
    section.append(el('div', { class: 'empty' },
      el('strong', { text: 'No offer can be ranked for this selection right now.' }),
      el('p', { text: 'Ranking needs a fresh confirmed stock observation and a published or observed shipping rate. The offers with missing information below explain exactly what is missing.' })));
  } else {
    section.append(renderBestOffer(board.best, board));
    const others = board.ranked.slice(1);
    if (others.length) section.append(renderCompareDisclosure(others, board));
  }
  const pickup = board.pickup ?? [];
  if (pickup.length) section.append(renderPickupDisclosure(pickup));
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
  const quantityGroup = document.getElementById('quantity-group');
  if (!quantityGroup.dataset.ready) {
    for (const grams of GRAMS_OPTIONS) {
      quantityGroup.append(el('button', {
        type: 'button',
        text: grams >= 1000 ? `${grams / 1000} kg` : `${grams} g`,
        dataset: { grams: String(grams) },
        attrs: { 'aria-pressed': String(state.grams === grams) },
        onClick: () => update({ grams })
      }));
    }
    quantityGroup.dataset.ready = 'true';
  }
  for (const button of quantityGroup.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.grams) === state.grams));
  }

  const destination = document.getElementById('destination');
  if (state.catalog?.destinations && !destination.dataset.ready) {
    for (const item of state.catalog.destinations) {
      destination.append(el('option', { value: item.id, text: item.postcode ? `${item.label} · ${item.postcode} area` : item.label }));
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
  // The obsolete `variant` parameter is deliberately not written back: one
  // unified comparison is the only view.
  const query = new URLSearchParams({
    grams: String(state.grams),
    dest: state.destination
  });
  history.replaceState(null, '', `/product/${encodeURIComponent(state.product)}?${query}`);
  renderControls();
  load();
}

function updateFooterStatus() {
  const node = document.getElementById('footer-status');
  if (!node) return;
  if (state.error) {
    node.textContent = 'The comparison could not be loaded from the snapshot API. Stored observations are safe; try again in a moment.';
    return;
  }
  const f = state.board?.freshness;
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
  const vendors = board.freshness?.vendors ?? [];
  const failing = vendors.filter(vendor => (vendor.consecutiveFailures ?? 0) > 0);
  const freshness = board.freshness ?? {};
  const dataAsOf = freshness.dataAsOf ?? freshness.lastRefreshAt ?? freshness.lastObservationAt ?? null;
  const wrap = el('div', { class: 'meta-line' });
  wrap.append(el('div', { text: `Board data as of: ${timeLabel(dataAsOf)} · Offers observed: ${board.counts.observed} · Ranked: ${board.counts.ranked}` }));
  if (freshness.stale) {
    const age = freshness.ageHours;
    wrap.append(el('div', { class: 'status status--stale', text: freshness.lastRefreshAt
      ? `Scheduled refresh overdue by ${age} h — prices may be out of date.`
      : freshness.lastObservationAt
        ? `No completed scheduled refresh; the newest offer observation is ${age} h old — prices may be out of date.`
        : 'No scheduled refresh has completed yet — prices may be missing or out of date.' }));
  }
  if (failing.length) wrap.append(el('div', { class: 'status status--stale', text: `${failing.length} source(s) failing` }));
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
    body.append(el('div', { text: `${vendor.vendorId}: ${vendor.consecutiveFailures} consecutive failure(s) · next attempt ${timeLabel(vendor.nextAttemptAt)}${vendor.lastErrors?.[0] ? ` · last error: ${vendor.lastErrors[0]}` : ''}` }));
  }
  wrap.append(el('details', { class: 'disclosure' }, el('summary', { text: 'Refresh diagnostics' }), body));
  return wrap;
}

function slug(value) {
  return String(value ?? 'offer').replace(/[^a-z0-9]+/gi, '-').slice(0, 60);
}

load();
