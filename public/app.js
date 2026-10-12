// Board client. Fetches the read-only snapshot API and renders the comparison.
// All vendor text is inserted with textContent: fetched pages are untrusted data.

const state = {
  grams: 500,
  destination: 'tel-aviv',
  variant: 'classico',
  showUnknown: true,
  catalog: null,
  board: null,
  error: null
};

const GRAMS_OPTIONS = [250, 500, 750, 1000, 2000];

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

function statusBadge(status, label) {
  const kind = status === 'in_stock' ? 'in_stock' : status === 'out_of_stock' ? 'out_of_stock' : 'unknown';
  return el('span', { class: `status status--${kind}`, text: label });
}

function offerLink(quote, label = 'Open the vendor page') {
  return el('a', { href: quote.itemUrl, rel: 'noopener noreferrer nofollow', target: '_blank', text: label });
}

async function load() {
  try {
    const [catalog, board] = await Promise.all([
      fetch('/api/catalog').then(response => response.json()),
      fetch(`/api/board?grams=${state.grams}&dest=${encodeURIComponent(state.destination)}&variant=${encodeURIComponent(state.variant)}`).then(response => response.json())
    ]);
    state.catalog = catalog;
    state.board = board;
    state.error = null;
  } catch (error) {
    state.error = error?.message ?? String(error);
  }
  document.body.dataset.boardState = state.error ? 'error' : 'ready';
  render();
}

function render() {
  renderControls();
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
  board.append(renderRankedSection(boardData));
  if (boardData.pickup.length) board.append(renderPickupSection(boardData.pickup));
  if (state.showUnknown) board.append(renderUnknownSection(boardData));
  board.append(renderFooterStatus(boardData));
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
  const variants = state.board?.variants?.length ? state.board.variants : ['classico'];
  const signature = variants.join(',');
  if (variant.dataset.signature !== signature) {
    variant.replaceChildren();
    const labels = { classico: 'Classico (strength 7)', forte: 'Forte', ricco: 'Ricco', risveglio: 'Risveglio', decaf: 'Decaffeinated', unspecified: 'Variant not stated' };
    for (const id of variants) variant.append(el('option', { value: id, text: labels[id] ?? id }));
    variant.dataset.signature = signature;
    variant.addEventListener('change', () => update({ variant: variant.value }));
  }
  variant.value = state.variant;

  const showUnknown = document.getElementById('show-unknown');
  showUnknown.checked = state.showUnknown;
  showUnknown.onchange = () => update({ showUnknown: showUnknown.checked });
}

function update(patch) {
  Object.assign(state, patch);
  const params = new URLSearchParams({
    grams: String(state.grams),
    dest: state.destination,
    variant: state.variant,
    unknown: state.showUnknown ? '1' : '0'
  });
  history.replaceState(null, '', `?${params}`);
  renderControls();
  load();
}

function renderRankedSection(board) {
  const section = el('section', { class: 'section', attrs: { id: 'ranked', 'aria-labelledby': 'ranked-title' } });
  section.append(el('div', { class: 'section__head' },
    el('div', { class: 'section__number', text: '01 / Best known delivered choice' }),
    el('div', {},
      el('h2', { attrs: { id: 'ranked-title' }, text: 'Delivered total, item plus shipping' }),
      el('p', { class: 'section__intro', text: `For ${board.targetGrams} g to ${board.destination.label}. Pack sizes are rounded up to whole packs; the board shows the packs you would actually buy.` }))));

  if (!board.best) {
    section.append(el('div', { class: 'empty' },
      el('strong', { text: 'No offer can be ranked right now.' }),
      el('p', { text: 'Ranking needs a fresh confirmed stock observation, a published shipping price and a stored exchange rate where needed. The observations below explain exactly what is missing.' })));
    return section;
  }

  const best = board.best;
  const main = el('div', { class: 'best__main' },
    el('div', { class: 'best__vendor' }, bidi(best.vendor.name)),
    el('h3', { class: 'best__product' }, bidi(best.product.name ?? 'Lavazza Crema e Gusto')),
    el('p', { class: 'best__variant', text: `${best.product.packCount > 1 ? `${best.product.packCount} × ` : ''}${best.product.packGrams} g vacuum brick · ${best.product.variantLabel}` }),
    el('div', { class: 'best__total-label', text: 'Delivered total for the selected quantity' }),
    el('div', { class: 'best__total', text: money(best.totalIls) }),
    el('div', { class: 'best__perkg', text: best.ilsPerKg != null ? `${money(best.ilsPerKg)} per kilogram · buys ${best.units} pack${best.units === 1 ? '' : 's'} (${best.orderedGrams} g)` : '' }),
    offerLink(best));

  const rows = [
    ['Item price', `${money(best.itemPrice.amount)} ${best.itemPrice.currency} × ${best.units}`],
    ['Shipping', best.shipping.amountIls === 0 ? 'Free' : best.shipping.amountIls != null ? money(best.shipping.amountIls) : 'Unknown'],
    ['Stock', statusBadge(best.availability, best.availabilityLabel)],
    ['Checked', timeLabel(best.observedAt)]
  ];
  if (best.shipping.minOrder != null) rows.push(['Minimum order', `${money(best.shipping.minOrder)} ${best.shipping.minOrderCurrency ?? ''}`.trim()]);
  if (best.shipping.freeThreshold != null) rows.push(['Free shipping', `from ${money(best.shipping.freeThreshold)} ${best.shipping.freeThresholdCurrency ?? ''}`.trim()]);
  if (best.shipping.destination?.scope === 'localities') rows.push(['Delivery area', `Only: ${(best.shipping.destination.localities ?? []).join(', ')}`]);
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
    row.append(el('td', { class: 'num' , text: `${money(quote.itemPrice.amount)} ${quote.itemPrice.currency}` }));
    row.append(el('td', { class: 'num' },
      quote.shipping.amountIls === 0 ? 'Free' : money(quote.shipping.amountIls),
      quote.shipping.minOrder != null || quote.shipping.freeThreshold != null
        ? el('div', { class: 'unknown__meta', text: [quote.shipping.minOrder != null ? `min ${money(quote.shipping.minOrder)}` : null, quote.shipping.freeThreshold != null ? `free from ${money(quote.shipping.freeThreshold)}` : null].filter(Boolean).join(' · ') })
        : null));
    row.append(el('td', { class: 'num' }, el('strong', { text: money(quote.totalIls) }), quote.estimate ? el('span', { class: 'estimate-note', text: ' est.' }) : null));
    row.append(el('td', { class: 'num', text: money(quote.ilsPerKg) }));
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
          el('span', { text: `Last successful check: ${timeLabel(quote.observedAt)}` }),
          el('span', { text: `Last attempt: ${timeLabel(quote.attemptedAt)}` })),
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
  if (board.freshness?.fx) {
    wrap.append(el('div', { text: `Exchange rates: ${board.freshness.fx.source ?? 'Bank of Israel'} published ${board.freshness.fx.asOf ?? 'unknown'} · fetched ${timeLabel(board.freshness.fx.fetchedAt)}` }));
  } else {
    wrap.append(el('div', { text: 'Exchange rates: no official rate table stored yet, so foreign-currency offers cannot be ranked.' }));
  }
  for (const vendor of vendors) {
    wrap.append(el('div', { text: `${vendor.vendorId}: last success ${timeLabel(vendor.lastSuccessAt)} · last attempt ${timeLabel(vendor.lastAttemptAt)}` }));
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
state.variant = params.get('variant') || 'classico';
state.showUnknown = params.get('unknown') !== '0';
load();
