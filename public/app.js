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

/**
 * Plain-language item-price arithmetic for one quote: unit price × packs bought,
 * with the ILS line total when the quote has one. Keeps the delivered total
 * auditable in the UI instead of showing a bare unit price next to a sum.
 */
function itemPriceLine(quote) {
  const amount = quote?.itemPrice?.amount;
  if (amount == null) return 'Unknown';
  const currency = quote.itemPrice.currency ?? '';
  const units = quote.units ?? 1;
  const total = quote.itemTotalIls != null
    ? money(quote.itemTotalIls)
    : (Number.isFinite(amount) ? money(amount * units) : null);
  if (total == null) return `${money(amount)} ${currency} × ${units}`;
  const converted = currency && currency !== 'ILS' ? ' ILS (converted)' : '';
  return `${money(amount)} ${currency} × ${units} = ${total}${converted}`;
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
  if (boardData.pickup.length) board.append(renderPickupSection(boardData.pickup));
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
  const last = state.board?.freshness?.lastRefreshAt;
  const stale = state.board?.freshness?.stale;
  const age = state.board?.freshness?.ageHours;
  node.textContent = last
    ? `Last completed refresh: ${timeLabel(last)}.${stale ? ` No completed scheduled refresh for ${age} h — prices may be out of date.` : ''}`
    : (stale
      ? 'No scheduled refresh has completed yet — prices may be missing or out of date.'
      : 'No completed refresh yet; the first scheduled run will populate the board.');
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
    el('div', { class: 'section__number', text: '01 / Best known delivered choice' }),
    el('div', {},
      el('h2', { attrs: { id: 'ranked-title' }, text: 'Delivered total, item plus shipping' }),
      el('p', { class: 'section__intro', text: `For ${board.product?.line ?? product?.line ?? 'the tracked product'} (${board.product?.form ?? 'ground'}, ${board.product?.packaging ?? 'vacuum brick'}), ${board.targetGrams} g to ${board.destination.label}. Pack sizes are rounded up to whole packs; the board shows the packs you would actually buy.` }))));

  if (!board.best) {
    section.append(el('div', { class: 'empty' },
      el('strong', { text: 'No offer can be ranked right now.' }),
      el('p', { text: 'Ranking needs a fresh confirmed stock observation, a published shipping price and a stored exchange rate where needed. The observations below explain exactly what is missing.' })));
    return section;
  }

  const best = board.best;
  const main = el('div', { class: 'best__main' },
    el('div', { class: 'best__vendor' }, bidi(best.vendor.name)),
    el('h3', { class: 'best__product' }, bidi(best.product.name ?? 'Tracked product')),
    el('p', { class: 'best__variant', text: `${best.product.packCount > 1 ? `${best.product.packCount} × ` : ''}${best.product.packGrams} g vacuum brick · ${best.product.variantLabel}` }),
    el('div', { class: 'best__total-label', text: 'Delivered total for the selected quantity' }),
    el('div', { class: 'best__total', text: money(best.totalIls) }),
    el('div', { class: 'best__perkg', text: best.ilsPerKg != null ? `${money(best.ilsPerKg)} per kilogram · buys ${best.units} pack${best.units === 1 ? '' : 's'} (${best.orderedGrams} g)` : '' }),
    offerLink(best));

  const rows = [
    ['Item price', itemPriceLine(best)],
    ['Shipping', best.shipping.amountIls === 0 ? 'Free' : best.shipping.amountIls != null ? money(best.shipping.amountIls) : 'Unknown'],
    ['Shipping certainty', best.shipping.certaintyLabel ?? 'Not published before checkout'],
    ['Stock', statusBadge(best.availability, best.availabilityLabel)],
    ['Checked', timeLabel(best.observedAt)]
  ];
  if (best.shipping.minOrder != null) rows.push(['Minimum order', `${money(best.shipping.minOrder)} ${best.shipping.minOrderCurrency ?? ''}`.trim()]);
  if (best.shipping.freeThreshold != null) rows.push(['Free shipping', `from ${money(best.shipping.freeThreshold)} ${best.shipping.freeThresholdCurrency ?? ''}`.trim()]);
  const bestChange = priceChangeText(best);
  if (bestChange) rows.push(['Price change', bestChange]);
  const bestStockChange = stockChangeText(best);
  if (bestStockChange) rows.push(['Stock change', bestStockChange]);
  const perKgWinner = board.bestPerKg && board.bestPerKg.key !== best.key ? board.bestPerKg : null;
  if (perKgWinner) {
    rows.push(['Cheapest per kilogram', el('span', {},
      bidi(perKgWinner.vendor?.name ?? ''),
      ` — ${money(perKgWinner.ilsPerKg)} per kg (${perKgWinner.units} × ${perKgWinner.packGrams} g, delivered ${money(perKgWinner.totalIls)})`)]);
  }
  if (best.shipping.destination?.scope === 'localities') rows.push(['Delivery area', `Only: ${(best.shipping.destination.localities ?? []).join(', ')}`]);
  if (best.shipping.coverageCaveat) rows.push(['Delivery coverage', best.shipping.coverageCaveat]);
  for (const alternative of best.shipping.alternatives ?? []) {
    rows.push([alternative.label, alternative.amountIls != null
      ? `${money(alternative.amountIls)} (published alternative shipping service)`
      : `${alternative.amount ?? 'unknown'} ${alternative.currency ?? ''} (not converted)`.trim()]);
  }
  for (const fee of best.mandatoryFees ?? []) rows.push([fee.label, money(fee.amountIls)]);
  if (best.shipping.deliveryTime) rows.push(['Delivery time', best.shipping.deliveryTime]);
  if (best.shipping.pickup?.available) rows.push(['Pickup', 'Free self-pickup is available and shown separately']);
  const side = el('div', { class: 'best__side' });
  const dl = el('dl');
  for (const [term, value] of rows) {
    dl.append(el('dt', { text: term }));
    dl.append(el('dd', {}, value instanceof Node ? value : document.createTextNode(value)));
  }
  side.append(dl);
  if (best.shipping.note) side.append(el('p', { class: 'unknown__reason', text: best.shipping.note }));
  if (best.labels.length) side.append(el('p', { class: 'unknown__reason', text: best.labels.join(' · ') }));
  if (best.estimate) side.append(el('p', {}, el('span', { class: 'status status--estimate', text: 'Estimate' }), el('span', { class: 'estimate-note', text: 'includes a converted or estimated component' })));

  section.append(el('div', { class: 'best' }, main, side));

  if (board.ranked.length > 1) {
    section.append(renderCompareTable(board.ranked, board));
  }
  if (board.counts?.excludedByVariant > 0) {
    const labels = (board.counts.excludedVariants ?? []).map(id => VARIANT_LABELS[id] ?? id).join(', ');
    section.append(el('p', { class: 'meta-line', text: `${board.counts.excludedByVariant} observed offer(s) for another blend variant (${labels || 'unspecified'}) stay out of this comparison so variants are never merged. Switch the product variant control to compare them.` }));
  }
  section.append(el('p', { class: 'meta-line', text: `Comparison total = item price + shipping + mandatory fees, converted to ILS where a Bank of Israel reference rate is stored. This is not a personalized checkout quote.` }));
  return section;
}

function renderCompareTable(quotes, board) {
  const table = el('table', { class: 'compare' });
  table.append(el('caption', { text: `All ranked offers for ${board.targetGrams} g to ${board.destination.label}` }));
  const head = el('tr');
  for (const label of ['Vendor', 'Pack / quantity', 'Item price', 'Shipping', 'Delivered total', 'Per kg', 'Stock', 'Checked']) {
    head.append(el('th', { attrs: { scope: 'col' }, text: label }));
  }
  table.append(el('thead', {}, head));
  const body = el('tbody');
  for (const quote of quotes) {
    const row = el('tr');
    row.append(el('td', {}, el('span', { class: 'vendor-name' }, bidi(quote.vendor.name)), el('br'), offerLink(quote, 'Vendor page')));
    row.append(el('td', { class: 'num', text: `${quote.units} × ${quote.product.packGrams} g = ${quote.orderedGrams} g` }));
    row.append(el('td', { class: 'num' }, itemPriceLine(quote),
      priceChangeText(quote) ? el('div', { class: 'unknown__meta', text: priceChangeText(quote) }) : null));
    row.append(el('td', { class: 'num' },
      quote.shipping.amountIls === 0 ? 'Free' : money(quote.shipping.amountIls),
      el('div', { class: 'unknown__meta', text: quote.shipping.certaintyLabel ?? 'Not published before checkout' }),
      (quote.shipping.alternatives ?? []).map(alternative => el('div', { class: 'unknown__meta', text: `${alternative.label}: ${alternative.amountIls != null ? money(alternative.amountIls) : 'unknown'}` })),
      quote.shipping.minOrder != null || quote.shipping.freeThreshold != null
        ? el('div', { class: 'unknown__meta', text: [quote.shipping.minOrder != null ? `min ${money(quote.shipping.minOrder)}` : null, quote.shipping.freeThreshold != null ? `free from ${money(quote.shipping.freeThreshold)}` : null].filter(Boolean).join(' · ') })
        : null,
      quote.shipping.coverageCaveat ? el('div', { class: 'unknown__meta', text: quote.shipping.coverageCaveat }) : null));
    const totalDelta = board.best && quote.key !== board.best.key && Number.isFinite(quote.totalIls) && Number.isFinite(board.best.totalIls)
      ? Math.round((quote.totalIls - board.best.totalIls) * 100) / 100
      : null;
    row.append(el('td', { class: 'num' }, el('strong', { text: money(quote.totalIls) }), quote.estimate ? el('span', { class: 'estimate-note', text: ' est.' }) : null,
      el('div', { class: 'unknown__meta', text: totalDelta == null ? 'Cheapest delivered total' : totalDelta === 0 ? 'Same delivered total as best' : `+${money(totalDelta)} vs best` })));
    row.append(el('td', { class: 'num' }, el('span', { text: money(quote.ilsPerKg) }),
      board.bestPerKg?.key === quote.key && board.best?.key !== quote.key
        ? el('div', { class: 'unknown__meta', text: 'Cheapest per kilogram' })
        : null));
    row.append(el('td', {}, statusBadge(quote.availability, quote.availabilityLabel)));
    row.append(el('td', { class: 'num', text: timeLabel(quote.observedAt) }));
    body.append(row);
  }
  table.append(body);
  return el('div', { class: 'table-wrap' }, table);
}

function renderPickupSection(pickup) {
  const section = el('section', { class: 'section', attrs: { id: 'pickup', 'aria-labelledby': 'pickup-title' } });
  section.append(el('div', { class: 'section__head' },
    el('div', { class: 'section__number', text: '02 / Pickup' }),
    el('div', {},
      el('h2', { attrs: { id: 'pickup-title' }, text: 'Pickup options, kept separate' }),
      el('p', { class: 'section__intro', text: 'Pickup is not a delivered price and never competes in the delivered ranking.' }))));
  for (const quote of pickup) {
    section.append(el('div', { class: 'pickup-row' },
      el('div', {}, el('span', { class: 'vendor-name' }, bidi(quote.vendor.name)), el('div', { class: 'unknown__meta' }, bidi(quote.product.name ?? ''))),
      el('div', {},
        el('div', { class: 'unknown__grid' },
          el('span', { text: `Item total for ${quote.units ?? 1} pack(s): ${money(quote.itemTotalIls) ?? 'unknown'}` }),
          el('span', { text: `Pickup fee: ${quote.pickup?.amount?.amount === 0 ? 'Free' : quote.pickup?.amount?.amount != null ? money(quote.pickup.amount.amount) : 'See vendor policy'}` }),
          el('span', { text: `Checked ${timeLabel(quote.observedAt)}` })),
        el('p', { class: 'unknown__reason', text: [quote.pickup?.note, quote.labels.join('. ')].filter(Boolean).join(' ') }),
        offerLink(quote))));
  }
  return section;
}

function renderUnknownSection(board) {
  const section = el('section', { class: 'section', attrs: { id: 'unknown', 'aria-labelledby': 'unknown-title' } });
  section.append(el('div', { class: 'section__head' },
    el('div', { class: 'section__number', text: '03 / Not comparable yet' }),
    el('div', {},
      el('h2', { attrs: { id: 'unknown-title' }, text: 'Offers with missing information' }),
      el('p', { class: 'section__intro', text: 'These observations stay visible with their source, timestamp and the exact reason a delivered total cannot be calculated. Missing shipping or currency data is never treated as zero.' }))));

  const entries = [...board.unrankable, ...board.staleOrUnavailable];
  if (!entries.length) {
    section.append(el('p', { class: 'meta-line', text: 'Nothing is missing right now: every stored offer has enough verified information to compare.' }));
    return section;
  }
  const list = el('div', { class: 'unknown-list' });
  for (const quote of entries) {
    const shipped = quote.shipping.amountIls != null
      ? (quote.shipping.amountIls === 0 ? 'Free' : money(quote.shipping.amountIls))
      : (quote.shipping.amount != null ? `${money(quote.shipping.amount)} ${quote.shipping.currency} (not converted)` : 'Unknown');
    list.append(el('article', { class: 'unknown' },
      el('div', {},
        el('div', { class: 'unknown__vendor' }, bidi(quote.vendor.name)),
        el('div', { class: 'unknown__meta' }, bidi(quote.product.name ?? '')),
        el('div', { class: 'unknown__meta', text: `Variant: ${quote.product.variantLabel} · Pack: ${quote.product.packCount} × ${quote.product.packGrams ?? '?'} g` })),
      el('div', {},
        el('div', { class: 'unknown__grid' },
          el('span', {}, statusBadge(quote.availability, quote.availabilityLabel)),
          el('span', { text: `Item price: ${quote.itemPrice.amount != null ? `${money(quote.itemPrice.amount)} ${quote.itemPrice.currency}` : 'unknown'}` }),
          el('span', { text: `Shipping: ${shipped}` }),
          ...(quote.shipping.alternatives ?? []).map(alternative => el('span', { text: `${alternative.label}: ${alternative.amountIls != null ? money(alternative.amountIls) : 'unknown'}` })),
          el('span', { text: `Last successful check: ${timeLabel(quote.observedAt)}` }),
          el('span', { text: `Last attempt: ${timeLabel(quote.attemptedAt)}` }),
          priceChangeText(quote) ? el('span', { text: priceChangeText(quote) }) : null,
          stockChangeText(quote) ? el('span', { text: stockChangeText(quote) }) : null),
        quote.shipping.coverageCaveat ? el('p', { class: 'unknown__meta', text: `Delivery coverage: ${quote.shipping.coverageCaveat}` }) : null,
        el('p', { class: 'unknown__reason', text: quote.reasons.join('. ') || quote.labels.join('. ') || 'Not enough verified information yet.' }),
        quote.labels.length ? el('p', { class: 'unknown__meta', text: quote.labels.join(' · ') }) : null,
        el('p', {}, offerLink(quote, 'Check this vendor page')))));
  }
  section.append(list);
  return section;
}

function renderFooterStatus(board) {
  const vendors = board.freshness?.vendors ?? [];
  const failing = vendors.filter(vendor => (vendor.consecutiveFailures ?? 0) > 0);
  const wrap = el('div', { class: 'meta-line' });
  wrap.append(el('div', { text: `Board refreshed: ${timeLabel(board.freshness?.lastRefreshAt)} · Offers observed for this variant: ${board.counts.observed} · Ranked: ${board.counts.ranked}` }));
  if (board.freshness?.stale) {
    const age = board.freshness.ageHours;
    wrap.append(el('div', { class: 'status status--stale', text: board.freshness.lastRefreshAt
      ? `Scheduled refresh overdue by ${age} h — prices may be out of date.`
      : 'No scheduled refresh has completed yet — prices may be missing or out of date.' }));
  }
  if (board.freshness?.fx) {
    wrap.append(el('div', { text: `Exchange rates: ${board.freshness.fx.source ?? 'Bank of Israel'} published ${board.freshness.fx.asOf ?? 'unknown'} · fetched ${timeLabel(board.freshness.fx.fetchedAt)}` }));
  } else {
    wrap.append(el('div', { text: 'Exchange rates: no official rate table stored yet, so foreign-currency offers cannot be ranked.' }));
  }
  for (const vendor of vendors) {
    wrap.append(el('div', { text: `${vendor.vendorId}: last success ${timeLabel(vendor.lastSuccessAt)} · last attempt ${timeLabel(vendor.lastAttemptAt)}` }));
  }
  const nextDue = vendors.map(vendor => vendor.nextAttemptAt).filter(Boolean).sort()[0] ?? null;
  if (nextDue) {
    wrap.append(el('div', { text: `Next source check due (approximate, set by each vendor's last run): ${dueLabel(nextDue)}` }));
  }
  if (failing.length) {
    wrap.append(el('div', { class: 'status status--stale', text: `${failing.length} source(s) failing` }));
    for (const vendor of failing) {
      wrap.append(el('div', { text: `${vendor.vendorId}: ${vendor.consecutiveFailures} consecutive failure(s) · next attempt ${timeLabel(vendor.nextAttemptAt)}${vendor.lastErrors?.[0] ? ` · last error: ${vendor.lastErrors[0]}` : ''}` }));
    }
  }
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
