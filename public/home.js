// Home product index.
//
// The canonical home route shows the tracked catalog as cards, not the vendor
// comparison board. Each card links to the product's own directly loadable page
// (`/product/<id>`). A legacy board link that still carries product/quantity/
// destination query state — including an obsolete variant parameter — is
// forwarded to the product page with that state intact, so old shared URLs keep
// working and a retired product id can still be reported as a fallback instead
// of being silently dropped. The product page ignores the obsolete variant
// parameter and always shows the one unified comparison.

import { el, timeLabel, bidi } from './ui.js';

const params = new URLSearchParams(location.search);
const LEGACY_KEYS = ['product', 'grams', 'quantity', 'dest', 'variant', 'unknown'];
const isLegacyBoardLink = LEGACY_KEYS.some(key => params.has(key));

const list = document.getElementById('catalog-list');
const footer = document.getElementById('footer-status');

async function main() {
  let catalog = null;
  try {
    catalog = await fetch('/api/catalog').then(response => response.json());
  } catch (error) {
    renderError(`The product index could not be loaded (${error?.message ?? error}). The stored observations are safe; try again in a moment.`);
    return;
  }
  const products = catalog?.products ?? [];
  if (!products.length) {
    renderError('No tracked product is configured on this deployment.');
    return;
  }
  if (isLegacyBoardLink) {
    // Keep the old selection state (including a retired product request) in the
    // forwarded URL, but drop the obsolete variant parameter: the product page
    // resolves the request against the tracked catalog and shows one unified
    // comparison. Quantity and locality are preserved.
    const forwarded = new URLSearchParams(params);
    forwarded.delete('variant');
    const query = forwarded.toString();
    const product = products.find(item => item.id === params.get('product')) ?? products[0];
    const target = `/product/${encodeURIComponent(product.id)}${query ? `?${query}` : ''}`;
    location.replace(target);
    return;
  }
  renderCatalog(products, catalog.vendors ?? []);
  renderFooterStatus();
}

function renderCatalog(products, vendors) {
  list.replaceChildren();
  for (const product of products) {
    list.append(productCard(product, vendors));
  }
}

function productCard(product, vendors) {
  vendors = vendors.filter(vendor => vendor.offers?.some(offer => offer.productId === product.id));
  const vendorCount = vendors.length;
  const listingCount = vendors.reduce((sum, vendor) => sum + vendor.offers.filter(offer => offer.productId === product.id).length, 0);
  const vendorNames = vendors.map(vendor => vendor.name).filter(Boolean);
  // Concise index card: identity, packaging and where the offers come from.
  // The comparison workflow and its caveats live on the product page, not here.
  const card = el('article', { class: 'product-card' },
    el('p', { class: 'product-card__brand', text: product.brand }),
    el('h2', { class: 'product-card__name' }, bidi(`${product.brand} ${product.line}`)),
    el('p', { class: 'product-card__meta', text: product.description }),
    el('p', { class: 'product-card__summary', text: vendorCount
      ? `${vendorCount} vendor${vendorCount === 1 ? '' : 's'} · ${listingCount} listing${listingCount === 1 ? '' : 's'}${vendorNames.length ? `: ${vendorNames.join(', ')}` : ''}`
      : 'Batches of 4, 6, 8 or 10 · delivery quotes pending' }),
    el('p', { class: 'product-card__action' },
      el('a', { class: 'product-card__link', href: `/product/${encodeURIComponent(product.id)}`, text: 'Compare delivered offers' })));
  return card;
}

async function renderFooterStatus() {
  if (!footer) return;
  try {
    const status = await fetch('/api/status').then(response => response.json());
    const observed = status?.lastObservationAt ?? status?.freshness?.lastObservationAt ?? null;
    footer.textContent = observed
      ? `Tracked offers last checked ${timeLabel(observed)}.`
      : 'No offer observation is stored yet; the first scheduled refresh will populate the board.';
  } catch {
    footer.textContent = 'Observation time is unavailable right now.';
  }
}

function renderError(message) {
  list.replaceChildren(el('div', { class: 'empty' }, el('strong', { text: 'The product index could not be loaded.' }), el('p', { text: message })));
}

main();
