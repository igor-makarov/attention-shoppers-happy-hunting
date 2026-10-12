// Board client. Fetches the read-only snapshot API and renders the comparison.
// All vendor text is inserted with textContent: fetched pages are untrusted data.

const state = {
  grams: 500,
  destination: 'tel-aviv',
  product: null,
  variant: null,
  showUnknown: true,
  catalog: null,
  board: null,
  error: null
};

const GRAMS_OPTIONS = [250, 500, 750, 1000, 2000];

const VARIANT_LABELS = { classico: 'Classico (strength 7)', forte: 'Forte', ricco: 'Ricco', risveglio: 'Risveglio', decaf: 'Decaffeinated', unspecified: 'Variant not stated' };

const ILS = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2 });
const IL_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem', dateStyle: 'medium', timeStyle: 'short'
});

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'attrs') for (const [a, v] of Object.entries(value)) node.setAttribute(a, v);
    else node[key] = value;
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function money(amount) {
  return amount == null ? null : ILS.format(amount).replace('₪', '₪');
}

/** Short single-line failure reason for the offer rows; never a raw payload. */
function truncate(text, max = 120) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

const HEBREW = /[\u0590-\u05FF]/;

/**
 * Plain-language price comparison against the previous successful check of the
 * same offer. Rendered as text only when the quote actually carries previous
 * evidence; an impossible comparison says why instead of claiming "no change".
 */
function priceChangeText(quote) {
  const change = quote?.priceChange;
  if (!change) return null;
  const when = timeLabel(change.previousObservedAt);
  if (!change.comparable) return `Previous price not compared: ${change.reason} (previous check ${when})`;
  if (change.direction === 'same') return `Unit price unchanged since the previous check (${when})`;
  return `Unit price ${change.direction === 'down' ? 'down' : 'up'} ${money(change.deltaIls)} since the previous check (${when})`;
}

function stockChangeText(quote) {
  const previous = quote?.previous;
  if (!previous || previous.availability === quote.availability) return null;
  return `Stock changed since the previous check: was ${previous.availabilityLabel ?? previous.availability}`;
}

/** Accurate pack description: a multipack must never read as a single 250 g pack. */
function packDescription(quote) {
  const product = quote.product ?? {};
  const per = product.packGrams != null ? `${product.packGrams} g` : 'weight not stated';
  if ((product.packCount ?? 1) > 1) {
    return `${product.packCount} × ${per} multipack${product.totalGrams != null ? ` (${product.totalGrams} g)` : ''}`;
  }
  return `${per} pack`;
}

/** What the shopper actually buys for the selected target quantity. */
function quantityDescription(quote) {
  const product = quote.product ?? {};
  const units = quote.units ?? 1;
  if ((product.packCount ?? 1) > 1) {
    return `${units} multipack${units === 1 ? '' : 's'} (${product.packCount} × ${product.packGrams} g) = ${quote.orderedGrams} g`;
  }
  return `${units} × ${product.packGrams ?? '?'} g pack${units === 1 ? '' : 's'} = ${quote.orderedGrams} g`;
}

function itemSubtotalText(quote) {
  if (quote.itemTotalIls != null) return money(quote.itemTotalIls);
  const amount = quote.itemPrice?.amount;
  if (amount == null) return 'Unknown';
  return `${money(amount)} ${quote.itemPrice.currency ?? ''}`.trim();
}

function shippingValueText(quote) {
  const shipping = quote.shipping ?? {};
  if (shipping.amountIls != null) {
    if (shipping.amountIls === 0) return shipping.freeThreshold != null ? 'Free (threshold met)' : 'Free';
    return money(shipping.amountIls);
  }
  if (shipping.amount != null) return `${money(shipping.amount)} ${shipping.currency ?? ''} (not converted)`.trim();
  return 'Shipping not published';
}

function shippingServiceText(quote) {
  if (quote.shipping?.mode === 'pickup') return 'Pickup only';
  return quote.shipping?.certaintyLabel ?? 'Not published before checkout';
}

/** Item subtotal, shipping service and delivered total stay visible together. */
function totalsBlock(quote, { perKg = true } = {}) {
  return el('div', { class: 'totals' },
    el('div', { class: 'totals__cell' },
      el('span', { class: 'totals__label', text: 'Item subtotal' }),
      el('span', { class: 'totals__value num', text: itemSubtotalText(quote) })),
    el('div', { class: 'totals__cell' },
      el('span', { class: 'totals__label', text: 'Shipping' }),
      el('span', { class: 'totals__value num', text: shippingValueText(quote) }),
      el('span', { class: 'totals__meta', text: shippingServiceText(quote) })),
    el('div', { class: 'totals__cell totals__cell--total' },
      el('span', { class: 'totals__label', text: 'Delivered total' }),
      el('span', { class: 'totals__value num', text: quote.totalIls != null ? money(quote.totalIls) : 'Not calculable' }),
      perKg && quote.ilsPerKg != null ? el('span', { class: 'totals__meta num', text: `${money(quote.ilsPerKg)} per kg` }) : null));
}

/** Human label for a destination id, used by locality-restricted delivery areas. */
function destinationLabel(id) {
  const found = (state.catalog?.destinations ?? []).find(item => item.id === id);
  return found?.label ?? id;
}

/** One written conditions list per offer; the same caveat is not repeated on a card. */
function conditionsList(quote) {
  const shipping = quote.shipping ?? {};
  const items = [];
  if (shipping.freeThreshold != null) {
    items.push(quote.itemTotalIls != null && quote.itemTotalIls >= shipping.freeThreshold
      ? `Free-shipping threshold met (from ${money(shipping.freeThreshold)})`
      : `Free shipping from ${money(shipping.freeThreshold)} item subtotal`);
  }
  if (shipping.minOrder != null) items.push(`Minimum order ${money(shipping.minOrder)}`);
  const coverage = shipping.destination;
  if (coverage?.scope === 'localities') {
    const names = (coverage.localities ?? []).map(destinationLabel);
    items.push(names.length ? `Delivery area: only ${names.join(', ')}` : 'Delivery area: restricted locality list not published');
  }
  for (const alternative of shipping.alternatives ?? []) {
    items.push(`${alternative.label}: ${alternative.amountIls != null ? money(alternative.amountIls) : 'rate not published'}`);
  }
  if (shipping.pickup?.available) items.push(shipping.pickup.note ? `Self-pickup: ${shipping.pickup.note}` : 'Free self-pickup available (kept separate from delivery)');
  if (shipping.deliveryTime) items.push(`Delivery time: ${shipping.deliveryTime}`);
  if (shipping.maxTotalGrams != null) items.push(`Rate quoted for carts up to ${shipping.maxTotalGrams} g`);
  if (!items.length) return null;
  const list = el('ul', { class: 'conditions' });
  for (const item of items) list.append(el('li', {}, bidi(item)));
  return list;
}

function caveatBlock(quote) {
  if (!quote.shipping?.coverageCaveat) return null;
  return el('p', { class: 'caveat' }, el('strong', { text: 'Coverage: ' }), bidi(quote.shipping.coverageCaveat));
}

/** Previous-check, failure and evidence provenance, collapsed behind a disclosure. */
function diagnosticsDisclosure(quote) {
  const rows = [];
  const change = priceChangeText(quote);
  if (change) rows.push(change);
  const stockChange = stockChangeText(quote);
  if (stockChange) rows.push(stockChange);
  rows.push(`Last successful check: ${timeLabel(quote.observedAt)}`);
  if (quote.lastAttemptFailed) rows.push(`Last attempt failed ${timeLabel(quote.attemptedAt)}${quote.lastError ? ` — ${truncate(quote.lastError)}` : ''}`);
  const evidence = quote.shipping?.evidence;
  if (evidence?.url) {
    rows.push(`Shipping evidence: ${evidence.url}${evidence.retrievedAt ? ` (retrieved ${timeLabel(evidence.retrievedAt)})` : ''}${evidence.note ? ` — ${truncate(evidence.note, 160)}` : ''}`);
  }
  const body = el('div', { class: 'disclosure__body' });
  for (const row of rows) body.append(el('div', { text: row }));
  return el('details', { class: 'disclosure' }, el('summary', { text: 'Check history and evidence' }), body);
}

/** Wrap Hebrew-containing text in an isolated dir="auto" span so mixed IL/Latin names render correctly. */
function bidi(text) {
  const value = text == null ? '' : String(text);
  if (!HEBREW.test(value)) return value;
  return el('span', { class: 'bidi', attrs: { dir: 'auto', lang: 'he' }, text: value });
}

function timeLabel(iso) {
  if (!iso) return 'never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown time';
  const hours = (Date.now() - date.getTime()) / 3_600_000;
  const relative = hours < 0.1 ? 'just now' : hours < 1 ? `${Math.round(hours * 60)} min ago` : hours < 48 ? `${Math.round(hours)} h ago` : `${Math.round(hours / 24)} d ago`;
  return `${IL_TIME.format(date)} (${relative})`;
}

/** Format a future due time. Vendor nextAttemptAt is a due time, not a promise, so the copy says so. */
function dueLabel(iso) {
  if (!iso) return 'not scheduled';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown time';
  const hours = (date.getTime() - Date.now()) / 3_600_000;
  const relative = hours <= 0 ? 'due now' : hours < 1 ? `in ${Math.round(hours * 60)} min` : `in ${Math.round(hours)} h`;
  return `${IL_TIME.format(date)} (${relative})`;
}

function statusBadge(status, label) {
  const kind = status === 'in_stock' ? 'in_stock' : status === 'out_of_stock' ? 'out_of_stock' : 'unknown';
  return el('span', { class: `status status--${kind}`, text: label });
}

function offerLink(quote, label = 'Open the vendor page') {
  return el('a', { href: quote.itemUrl, rel: 'noopener noreferrer nofollow', target: '_blank', text: label });
}

async function load() {
  try {
    const catalogResponse = await fetch('/api/catalog').then(response => response.json());
    state.catalog = catalogResponse;
    applyProductDefaults();
    // A product id from the URL is sent as requested, even when it names a
    // retired line, so the API can report the fallback instead of hiding it.
    const requestedProduct = state.requestedProduct ?? state.product;
    const params = new URLSearchParams({ product: requestedProduct, grams: String(state.grams), dest: state.destination, variant: state.variant });
    const board = await fetch(`/api/board?${params}`).then(response => response.json());
    state.board = board;
    state.error = null;
  } catch (error) {
    state.error = error?.message ?? String(error);
  }
  document.body.dataset.boardState = state.error ? 'error' : 'ready';
  render();
}

/** Keep the selected product and variant valid for the catalog's tracked products. */
function applyProductDefaults() {
  const catalogProducts = state.catalog?.products ?? [];
  if (!catalogProducts.length) return;
  if (!catalogProducts.some(item => item.id === state.product)) state.product = catalogProducts[0].id;
  const product = currentProduct();
  const variants = (product?.variants ?? []).map(item => item.id);
  if (!variants.includes(state.variant)) state.variant = product?.defaultVariant ?? variants[0] ?? 'unspecified';
}

function currentProduct() {
  return (state.catalog?.products ?? []).find(item => item.id === state.product) ?? null;
}

function render() {
  renderControls();
  updateFooterStatus();
  const board = document.getElementById('board');
  board.replaceChildren();
  if (state.error) {
    board.append(el('div', { class: 'empty' },
      el('strong', { text: 'The board could not be loaded.' }),
      el('p', { text: `Reason: ${state.error}. The stored observations are safe; try again in a moment.` })));
    return;
  }
  if (!state.board) return;

  const boardData = state.board;
  if (boardData.requestedRetiredProduct) board.append(renderRetiredNotice(boardData.requestedRetiredProduct));
  board.append(renderRankedSection(boardData));
  const pickupSection = renderPickupSection(boardData.pickup);
  if (pickupSection) board.append(pickupSection);
  if (state.showUnknown) board.append(renderUnknownSection(boardData));
  board.append(renderFooterStatus(boardData));
}

function updateFooterStatus() {
  const node = document.getElementById('footer-status');
  if (!node) return;
  if (state.error) {
    node.textContent = 'The board could not be loaded from the snapshot API. Stored observations are safe; try again in a moment.';
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
      : 'No completed refresh yet; the first scheduled run will populate the board.';
  }
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
  const variant = document.getElementById('variant');
  const product = currentProduct();
  const labels = new Map((product?.variants ?? []).map(item => [item.id, item.label]));
  const observed = state.board?.variants ?? [];
  // Show every variant the product can be compared under; mark which ones were
  // actually observed so an empty result is explained rather than silently empty.
  const variants = (product?.variants ?? []).map(item => item.id);
  for (const id of observed) if (!variants.includes(id)) variants.push(id);
  const signature = `${product?.id ?? ''}|${variants.join(',')}`;
  if (variant.dataset.signature !== signature) {
    variant.replaceChildren();
    for (const id of variants) {
      const suffix = observed.includes(id) ? '' : ' — not observed yet';
      variant.append(el('option', { value: id, text: `${labels.get(id) ?? VARIANT_LABELS[id] ?? id}${suffix}` }));
    }
    variant.dataset.signature = signature;
    variant.addEventListener('change', () => update({ variant: variant.value }));
  }
  variant.value = state.variant ?? '';

  const productSelect = document.getElementById('product');
  const productStatic = document.getElementById('product-static');
  const catalogProducts = state.catalog?.products ?? [];
  // Owner correction 2026-10-12: exactly one product line is tracked, so the
  // selector is replaced by a static label instead of a dead one-option control.
  if (productSelect) productSelect.hidden = catalogProducts.length <= 1;
  if (productStatic) {
    productStatic.hidden = catalogProducts.length > 1;
    productStatic.textContent = catalogProducts.length === 1
      ? `${catalogProducts[0].brand} ${catalogProducts[0].line} · ${catalogProducts[0].form} in a ${catalogProducts[0].packaging}`
      : '';
  }
  const productSignature = catalogProducts.map(item => item.id).join(',');
  if (productSelect && productSelect.dataset.signature !== productSignature) {
    productSelect.replaceChildren();
    for (const item of catalogProducts) {
      productSelect.append(el('option', { value: item.id, text: `${item.brand} ${item.line} · ${item.form} ${item.packaging}` }));
    }
    productSelect.dataset.signature = productSignature;
    productSelect.addEventListener('change', () => update({ product: productSelect.value }));
  }
  if (productSelect && state.product) productSelect.value = state.product;

  const showUnknown = document.getElementById('show-unknown');
  showUnknown.checked = state.showUnknown;
  showUnknown.onchange = () => update({ showUnknown: showUnknown.checked });
}

function update(patch) {
  Object.assign(state, patch);
  // Any user interaction replaces the URL's original product request with the
  // tracked product, so a retired-line link is not kept in the shareable URL.
  state.requestedProduct = null;
  // Changing the product resets the variant to that product's default so a
  // Classico selection is never silently applied to a different line.
  if (patch.product) {
    const product = (state.catalog?.products ?? []).find(item => item.id === patch.product);
    state.variant = product?.defaultVariant ?? null;
  }
  applyProductDefaults();
  const params = new URLSearchParams({
    product: state.product ?? '',
    grams: String(state.grams),
    dest: state.destination,
    variant: state.variant ?? '',
    unknown: state.showUnknown ? '1' : '0'
  });
  history.replaceState(null, '', `?${params}`);
  renderControls();
  load();
}

function renderRetiredNotice(retired) {
  return el('div', { class: 'notice', attrs: { id: 'retired-product-notice', role: 'note' } },
    el('strong', { text: 'Retired product line' }),
    el('p', {},
      'This link asked for Lavazza ',
      bidi(retired.line),
      '. Only Lavazza Crema e Gusto vacuum-packed ground coffee is tracked now, so the board below compares Crema e Gusto offers only. Re-tracking another product line needs an explicit new owner instruction.'));
}

function renderRankedSection(board) {
  const section = el('section', { class: 'section', attrs: { id: 'ranked', 'aria-labelledby': 'ranked-title' } });
  const product = currentProduct();
  section.append(el('div', { class: 'section__head' },
    el('div', { class: 'section__kicker', text: '01 / Delivered comparison' }),
    el('h2', { attrs: { id: 'ranked-title' }, text: 'Item subtotal + shipping = delivered total' }),
    el('p', { class: 'section__intro', text: `${board.product?.line ?? product?.line ?? 'Crema e Gusto'} ${board.product?.form ?? 'ground'} (${board.product?.packaging ?? 'vacuum brick'}), ${board.targetGrams} g to ${board.destination.label}. Packs round up to whole packs.` })));

  if (!board.best) {
    section.append(el('div', { class: 'empty' },
      el('strong', { text: 'No offer can be ranked right now.' }),
      el('p', { text: 'Ranking needs a fresh confirmed stock observation and a published shipping price. The offers below explain exactly what is missing.' })));
    return section;
  }

  section.append(renderOfferCard(board.best, board, { best: true }));
  const others = board.ranked.slice(1);
  if (others.length) {
    section.append(el('h3', { class: 'section__kicker', text: 'Other ranked offers' }));
    const list = el('div', { class: 'offer-list' });
    for (const quote of others) list.append(renderOfferCard(quote, board, { best: false }));
    section.append(list);
  }
  if (board.counts?.excludedByVariant > 0) {
    const labels = (board.counts.excludedVariants ?? []).map(id => VARIANT_LABELS[id] ?? id).join(', ');
    section.append(el('p', { class: 'meta-line', text: `${board.counts.excludedByVariant} observed offer(s) for another blend variant (${labels || 'unspecified'}) stay out of this comparison so variants are never merged. Switch the variant control to compare them.` }));
  }
  const perKgWinner = board.bestPerKg && board.best && board.bestPerKg.key !== board.best.key ? board.bestPerKg : null;
  if (perKgWinner) {
    const pack = (perKgWinner.packCount ?? 1) > 1
      ? `${perKgWinner.packCount} × ${perKgWinner.packGrams} g multipack`
      : `${perKgWinner.packGrams} g pack`;
    section.append(el('p', { class: 'meta-line' },
      'Cheapest per kilogram: ',
      bidi(perKgWinner.vendor?.name ?? ''),
      ` — ${money(perKgWinner.ilsPerKg)} per kg (${perKgWinner.units} × ${pack}, delivered ${money(perKgWinner.totalIls)})`));
  }
  section.append(el('p', { class: 'meta-line', text: 'Comparison total = item subtotal + shipping + mandatory fees, converted to ILS where a stored Bank of Israel reference rate is needed. This is not a personalized checkout quote.' }));
  return section;
}

/** One offer card: identity, pack/quantity, the three money values together and the conditions. */
function renderOfferCard(quote, board, { best }) {
  const card = el('article', { class: best ? 'offer offer--best' : 'offer' });
  if (best) card.append(el('div', { class: 'offer__top' }, el('span', { class: 'tag tag--best', text: 'Best known delivered total' })));
  card.append(el('div', { class: 'offer__top' },
    el('div', { class: 'offer__vendor' }, bidi(quote.vendor.name), statusBadge(quote.availability, quote.availabilityLabel)),
    el('div', { class: 'offer__delta', text: offerDeltaText(quote, board, best) })));
  card.append(el('p', { class: 'offer__product' }, bidi(quote.product.name ?? 'Tracked product')));
  card.append(el('p', { class: 'offer__pack', text: `${packDescription(quote)} · ${quantityDescription(quote)} · ${quote.product.variantLabel}` }));
  card.append(totalsBlock(quote));
  if (quote.estimate) card.append(el('p', { class: 'unknown__meta' }, el('span', { class: 'status status--estimate', text: 'Estimate' }), ' includes a converted or estimated component'));
  const conditions = conditionsList(quote);
  if (conditions) card.append(conditions);
  const caveat = caveatBlock(quote);
  if (caveat) card.append(caveat);
  card.append(el('div', { class: 'offer__links' }, offerLink(quote, 'Open the vendor page')));
  card.append(diagnosticsDisclosure(quote));
  return card;
}

function offerDeltaText(quote, board, best) {
  if (best) return 'Cheapest delivered total for this selection';
  const delta = board.best && Number.isFinite(quote.totalIls) && Number.isFinite(board.best.totalIls)
    ? Math.round((quote.totalIls - board.best.totalIls) * 100) / 100
    : null;
  if (delta == null) return '';
  if (delta === 0) return 'Same delivered total as the best offer';
  return `+${money(delta)} vs best delivered total`;
}

function renderPickupSection(pickup) {
  const only = pickup.filter(quote => quote.shipping?.mode === 'pickup');
  if (!only.length) return null;
  const section = el('section', { class: 'section', attrs: { id: 'pickup', 'aria-labelledby': 'pickup-title' } });
  section.append(el('div', { class: 'section__head' },
    el('div', { class: 'section__kicker', text: '02 / Pickup only' }),
    el('h2', { attrs: { id: 'pickup-title' }, text: 'Pickup-only offers' }),
    el('p', { class: 'section__intro', text: 'Pickup is not a delivered price and never competes in the delivered ranking. Pickup that accompanies a delivered offer is shown on that offer card.' })));
  for (const quote of only) {
    section.append(el('div', { class: 'pickup-row' },
      el('div', { class: 'unknown__vendor' }, bidi(quote.vendor.name)),
      el('div', { class: 'unknown__meta' }, bidi(quote.product.name ?? '')),
      el('div', { class: 'unknown__meta', text: `${packDescription(quote)} · ${quantityDescription(quote)}` }),
      totalsBlock(quote, { perKg: false }),
      el('p', { class: 'unknown__reason', text: [quote.pickup?.note, quote.labels.join('. ')].filter(Boolean).join(' ') }),
      el('p', {}, offerLink(quote))));
  }
  return section;
}

function renderUnknownSection(board) {
  const section = el('section', { class: 'section', attrs: { id: 'unknown', 'aria-labelledby': 'unknown-title' } });
  section.append(el('div', { class: 'section__head' },
    el('div', { class: 'section__kicker', text: '03 / Not comparable yet' }),
    el('h2', { attrs: { id: 'unknown-title' }, text: 'Offers with missing information' }),
    el('p', { class: 'section__intro', text: 'These observations stay visible with their source, timestamp and the exact reason a delivered total cannot be calculated. Missing shipping is never treated as zero.' })));

  const entries = [...board.unrankable, ...board.staleOrUnavailable];
  if (!entries.length) {
    section.append(el('p', { class: 'meta-line', text: 'Nothing is missing right now: every stored offer has enough verified information to compare.' }));
    return section;
  }
  const list = el('div', { class: 'unknown-list' });
  for (const quote of entries) {
    const card = el('article', { class: 'unknown' });
    card.append(el('div', { class: 'unknown__vendor' }, bidi(quote.vendor.name), ' ', statusBadge(quote.availability, quote.availabilityLabel)));
    card.append(el('div', { class: 'unknown__meta' }, bidi(quote.product.name ?? '')));
    card.append(el('div', { class: 'unknown__meta', text: `${packDescription(quote)} · ${quantityDescription(quote)} · ${quote.product.variantLabel}` }));
    card.append(el('div', { class: 'unknown__grid' },
      el('span', { text: `Item subtotal: ${itemSubtotalText(quote)}` }),
      el('span', { text: `Shipping: ${shippingValueText(quote)}` }),
      el('span', { text: `Last successful check: ${timeLabel(quote.observedAt)}` }),
      quote.lastAttemptFailed ? el('span', { text: `Last attempt failed ${timeLabel(quote.attemptedAt)}${quote.lastError ? ` — ${truncate(quote.lastError)}` : ''}` }) : null));
    if (quote.shipping?.amountIls == null && quote.shipping?.certainty !== 'verified') {
      card.append(el('p', { class: 'unknown__reason', text: 'Shipping not published. Needed for a delivered total: a published rate or a public checkout-estimator quote for this quantity and locality. A missing rate is never counted as free.' }));
    }
    card.append(el('p', { class: 'unknown__reason', text: quote.reasons.join('. ') || quote.labels.join('. ') || 'Not enough verified information yet.' }));
    const caveat = caveatBlock(quote);
    if (caveat) card.append(caveat);
    card.append(el('p', {}, offerLink(quote, 'Check this vendor page')));
    list.append(card);
  }
  section.append(list);
  return section;
}

function renderFooterStatus(board) {
  const vendors = board.freshness?.vendors ?? [];
  const failing = vendors.filter(vendor => (vendor.consecutiveFailures ?? 0) > 0);
  const freshness = board.freshness ?? {};
  const dataAsOf = freshness.dataAsOf ?? freshness.lastRefreshAt ?? freshness.lastObservationAt ?? null;
  const wrap = el('div', { class: 'meta-line' });
  wrap.append(el('div', { text: `Board data as of: ${timeLabel(dataAsOf)} · Offers observed for this variant: ${board.counts.observed} · Ranked: ${board.counts.ranked}` }));
  if (freshness.stale) {
    const age = freshness.ageHours;
    wrap.append(el('div', { class: 'status status--stale', text: freshness.lastRefreshAt
      ? `Scheduled refresh overdue by ${age} h — prices may be out of date.`
      : freshness.lastObservationAt
        ? `No completed scheduled refresh; the newest offer observation is ${age} h old — prices may be out of date.`
        : 'No scheduled refresh has completed yet — prices may be missing or out of date.' }));
  }
  if (failing.length) {
    wrap.append(el('div', { class: 'status status--stale', text: `${failing.length} source(s) failing` }));
  }
  // FX, per-vendor and next-due diagnostics are useful provenance but not
  // decision information, so they live behind a disclosure instead of filling
  // the first screen.
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
  if (nextDue) {
    body.append(el('div', { text: `Next source check due (approximate, set by each vendor's last run): ${dueLabel(nextDue)}` }));
  }
  for (const vendor of failing) {
    body.append(el('div', { text: `${vendor.vendorId}: ${vendor.consecutiveFailures} consecutive failure(s) · next attempt ${timeLabel(vendor.nextAttemptAt)}${vendor.lastErrors?.[0] ? ` · last error: ${vendor.lastErrors[0]}` : ''}` }));
  }
  wrap.append(el('details', { class: 'disclosure' }, el('summary', { text: 'Refresh diagnostics' }), body));
  return wrap;
}

const params = new URLSearchParams(location.search);
state.grams = Number(params.get('grams')) || 500;
state.destination = params.get('dest') || 'tel-aviv';
state.product = params.get('product') || null;
state.requestedProduct = params.get('product') || null;
state.variant = params.get('variant') || null;
state.showUnknown = params.get('unknown') !== '0';
load();
