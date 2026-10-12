// Shared rendering helpers for the home product index and the product page.
//
// All vendor text is inserted as text: fetched pages are untrusted data. `el()`
// accepts a DOM node for `text` (used by `bidi()`, which wraps Hebrew runs in a
// dir="auto" span) and appends it instead of stringifying it — a Node assigned
// to textContent would render as "[object HTMLSpanElement]".

export const VARIANT_LABELS = {
  classico: 'Classico (strength 7)',
  forte: 'Forte',
  ricco: 'Ricco',
  risveglio: 'Risveglio',
  decaf: 'Decaffeinated',
  unspecified: 'Variant not stated'
};

export const ILS = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2 });
export const IL_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem', dateStyle: 'medium', timeStyle: 'short'
});

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') {
      // A Node (for example the dir="auto" wrapper built by bidi()) must be
      // appended as a child; assigning it to textContent would print
      // "[object HTMLSpanElement]".
      if (value instanceof Node) node.append(value);
      else node.textContent = String(value);
    }
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

export function money(amount) {
  return amount == null ? null : ILS.format(amount);
}

/** Short single-line text for cards; never a raw payload. */
export function truncate(text, max = 120) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

const HEBREW = /[\u0590-\u05FF]/;

/** Wrap Hebrew-containing text in an isolated dir="auto" span for mixed IL/Latin names. */
export function bidi(text) {
  const value = text == null ? '' : String(text);
  if (!HEBREW.test(value)) return value;
  return el('span', { class: 'bidi', attrs: { dir: 'auto', lang: 'he' }, text: value });
}

export function timeLabel(iso) {
  if (!iso) return 'never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown time';
  const hours = (Date.now() - date.getTime()) / 3_600_000;
  const relative = hours < 0.1 ? 'just now' : hours < 1 ? `${Math.round(hours * 60)} min ago` : hours < 48 ? `${Math.round(hours)} h ago` : `${Math.round(hours / 24)} d ago`;
  return `${IL_TIME.format(date)} (${relative})`;
}

/** Format a future due time. Vendor nextAttemptAt is a due time, not a promise, so the copy says so. */
export function dueLabel(iso) {
  if (!iso) return 'not scheduled';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown time';
  const hours = (date.getTime() - Date.now()) / 3_600_000;
  const relative = hours <= 0 ? 'due now' : hours < 1 ? `in ${Math.round(hours * 60)} min` : `in ${Math.round(hours)} h`;
  return `${IL_TIME.format(date)} (${relative})`;
}

/** Accurate pack description: a multipack must never read as a single 250 g pack. */
export function packDescription(quote) {
  const product = quote.product ?? {};
  const per = product.packGrams != null ? `${product.packGrams} g` : 'weight not stated';
  if ((product.packCount ?? 1) > 1) {
    return `${product.packCount} × ${per} multipack${product.totalGrams != null ? ` (${product.totalGrams} g)` : ''}`;
  }
  return `${per} pack`;
}

/** What the shopper actually buys for the selected target quantity. */
export function quantityDescription(quote) {
  const product = quote.product ?? {};
  const units = quote.units ?? 1;
  if ((product.packCount ?? 1) > 1) {
    return `${units} multipack${units === 1 ? '' : 's'} (${product.packCount} × ${product.packGrams} g) = ${quote.orderedGrams} g`;
  }
  return `${units} × ${product.packGrams ?? '?'} g pack${units === 1 ? '' : 's'} = ${quote.orderedGrams} g`;
}

export function itemSubtotalText(quote) {
  if (quote.itemTotalIls != null) return money(quote.itemTotalIls);
  const amount = quote.itemPrice?.amount;
  if (amount == null) return 'Unknown';
  return `${money(amount)} ${quote.itemPrice.currency ?? ''}`.trim();
}

export function shippingValueText(quote) {
  const shipping = quote.shipping ?? {};
  if (shipping.amountIls != null) {
    if (shipping.amountIls === 0) return shipping.freeThreshold != null ? 'Free (threshold met)' : 'Free';
    return money(shipping.amountIls);
  }
  if (shipping.amount != null) return `${money(shipping.amount)} ${shipping.currency ?? ''} (not converted)`.trim();
  return 'Shipping not published';
}

/**
 * The delivery method a charge buys, separate from how certain the evidence is.
 * Falls back to the shipping mode; an unknown method says so instead of showing
 * the certainty label in its place.
 */
export function shippingMethodLabel(quote) {
  const shipping = quote.shipping ?? {};
  if (shipping.serviceLabel) return shipping.serviceLabel;
  return shipping.mode === 'pickup' ? 'Self-pickup' : 'Delivery method not stated';
}

export function shippingCertaintyText(quote) {
  return quote.shipping?.certaintyLabel ?? 'Not published before checkout';
}

export function statusBadge(status, label) {
  const kind = status === 'in_stock' ? 'in_stock' : status === 'out_of_stock' ? 'out_of_stock' : 'unknown';
  return el('span', { class: `status status--${kind}`, text: label });
}

export function offerLink(quote, label = 'Open the vendor page') {
  return el('a', { href: quote.itemUrl, rel: 'noopener noreferrer nofollow', target: '_blank', text: label });
}

/** Item subtotal, named shipping method/charge and delivered total stay together. */
export function totalsBlock(quote, { perKg = true } = {}) {
  return el('div', { class: 'totals' },
    el('div', { class: 'totals__cell' },
      el('span', { class: 'totals__label', text: 'Item subtotal' }),
      el('span', { class: 'totals__value num', text: itemSubtotalText(quote) })),
    el('div', { class: 'totals__cell' },
      el('span', { class: 'totals__label', text: 'Shipping' }),
      el('span', { class: 'totals__value num', text: shippingValueText(quote) }),
      el('span', { class: 'totals__meta totals__meta--method', text: shippingMethodLabel(quote) }),
      el('span', { class: 'totals__meta totals__meta--certainty', text: shippingCertaintyText(quote) })),
    el('div', { class: 'totals__cell totals__cell--total' },
      el('span', { class: 'totals__label', text: 'Delivered total' }),
      el('span', { class: 'totals__value num', text: quote.totalIls != null ? money(quote.totalIls) : 'Not calculable' }),
      perKg && quote.ilsPerKg != null ? el('span', { class: 'totals__meta num', text: `${money(quote.ilsPerKg)} per kg` }) : null));
}

/**
 * Plain-language price comparison against the previous successful check of the
 * same offer. Rendered as text only when the quote actually carries previous
 * evidence; an impossible comparison says why instead of claiming "no change".
 */
export function priceChangeText(quote) {
  const change = quote?.priceChange;
  if (!change) return null;
  const when = timeLabel(change.previousObservedAt);
  if (!change.comparable) return `Previous price not compared: ${change.reason} (previous check ${when})`;
  if (change.direction === 'same') return `Unit price unchanged since the previous check (${when})`;
  return `Unit price ${change.direction === 'down' ? 'down' : 'up'} ${money(change.deltaIls)} since the previous check (${when})`;
}

export function stockChangeText(quote) {
  const previous = quote?.previous;
  if (!previous || previous.availability === quote.availability) return null;
  return `Stock changed since the previous check: was ${previous.availabilityLabel ?? previous.availability}`;
}

/** Short conditions shown on a card face; the full list goes in a details block. */
export function conditionsList(quote, destinationLabelFn = id => id) {
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
    const names = (coverage.localities ?? []).map(destinationLabelFn);
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

export function caveatBlock(quote) {
  if (!quote.shipping?.coverageCaveat) return null;
  return el('p', { class: 'caveat' }, el('strong', { text: 'Coverage: ' }), bidi(quote.shipping.coverageCaveat));
}

/** A one-line amber qualification shown next to a conditional total. */
export function coverageQualifier(quote) {
  const shipping = quote.shipping ?? {};
  if (shipping.coverageCaveat) return 'Coverage not confirmed for every locality — full terms under Delivery options.';
  if (shipping.certainty === 'checkout_quote') return 'Rate observed in an anonymous cart; confirm the destination at checkout.';
  if (shipping.certainty === 'estimated') return 'Includes a converted or estimated component.';
  if (shipping.certainty === 'unknown') return 'Shipping not published: a delivered total cannot be established yet.';
  return null;
}

/** Previous-check, failure and evidence provenance, collapsed behind a disclosure. */
export function diagnosticsDisclosure(quote) {
  const rows = [];
  const change = priceChangeText(quote);
  if (change) rows.push(change);
  const stockChange = stockChangeText(quote);
  if (stockChange) rows.push(stockChange);
  rows.push(`Last successful check: ${timeLabel(quote.observedAt)}`);
  if (quote.lastAttemptFailed) rows.push(`Last attempt failed ${timeLabel(quote.attemptedAt)}${quote.lastError ? ` — ${truncate(quote.lastError)}` : ''}`);
  const policy = quote.shipping?.policy;
  if (policy) {
    rows.push(`Shipping rule: ${policy.id} v${policy.version} (${policy.origin === 'observed_cart' ? 'observed anonymous cart quote' : 'published rule'}, observed ${timeLabel(policy.retrievedAt)}, re-check by ${timeLabel(policy.reviewBy)})`);
  }
  if (quote.shipping?.note) rows.push(`Shipping terms: ${quote.shipping.note}`);
  const evidence = quote.shipping?.evidence;
  if (evidence?.url) {
    rows.push(`Shipping evidence: ${evidence.url}${evidence.retrievedAt ? ` (retrieved ${timeLabel(evidence.retrievedAt)})` : ''}${evidence.note ? ` — ${truncate(evidence.note, 160)}` : ''}`);
  }
  const body = el('div', { class: 'disclosure__body' });
  for (const row of rows) body.append(el('div', {}, bidi(row)));
  return el('details', { class: 'disclosure disclosure--diagnostics' }, el('summary', { text: 'Offer details and check history' }), body);
}
