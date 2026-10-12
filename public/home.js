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
const LEGACY_KEYS = ['product', 'grams', 'dest', 'variant', 'unknown'];
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
    // forwarded URL. The product page resolves it against the tracked catalog.
    const target = `/product/${encodeURIComponent(products[0].id)}?${params.toString()}`;
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
  const vendorCount = vendors.length;
  const listingCount = vendors.reduce((sum, vendor) => sum + (vendor.offers?.length ?? 0), 0);
  const vendorNames = vendors.map(vendor => vendor.name).filter(Boolean);
  const card = el('article', { class: 'product-card' },
    el('p', { class: 'product-card__brand', text: product.brand }),
    el('h2', { class: 'product-card__name' }, bidi(`${product.brand} ${product.line}`)),
    el('p', { class: 'product-card__meta', text: `${product.form} coffee in a ${product.packaging} · sold as 250 g packs and multipacks · one comparison for all tracked listings` }),
    el('p', { class: 'product-card__summary', text: `Compare item subtotal, named delivery method and charge, and the delivered total for a chosen quantity and Israeli locality. ${vendorCount} tracked vendor${vendorCount === 1 ? '' : 's'}${listingCount ? ` · ${listingCount} listing${listingCount === 1 ? '' : 's'}` : ''}${vendorNames.length ? `: ${vendorNames.join(', ')}` : ''}.` }),
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
