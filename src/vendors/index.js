// Vendor adapter registry.
//
// Adapters are deterministic: fetch a fixed, allowlisted product URL, parse it
// with a versioned parser and return one observation per tracked offer. They
// never follow vendor content as instructions and never bypass access controls.
//
// Adding a vendor: create src/vendors/<id>.js exporting an adapter with
// { id, name, homepage, allowedHosts, parserVersion, offers, observe() } and
// register it here. Fixtures for its parser belong in tests/fixtures/.

import { pucks } from './pucks.js';
import { coffeeman } from './coffeeman.js';
import { coffee4u } from './coffee4u.js';

export function registeredVendors() {
  return [coffeeman, pucks, coffee4u];
}

/** Every host any adapter may contact. Used for the refresh-time allowlist. */
export function vendorHosts(vendors = registeredVendors()) {
  return [...new Set(vendors.flatMap(vendor => vendor.allowedHosts))];
}

export function createObservation({ vendor, itemUrl, product, price, availability, availabilityEvidence, shipping, promotions = [], mandatoryFees = [], now }) {
  const observedAt = new Date(now ?? Date.now()).toISOString();
  const key = [
    vendor.id,
    product.sku ?? product.productId,
    product.variantId ?? 'unspecified',
    product.form,
    `${product.totalGrams ?? 'x'}g`,
    `x${product.packCount ?? 1}`
  ].join(':');
  // Availability and shipping terms are read from the same product-page fetch as
  // the price. Stamp their evidence with that retrieval time unless the adapter
  // already knows a more precise one, so every claim on the board carries when
  // it was observed instead of an unexplained null.
  const stamp = entry => (entry ? { ...entry, retrievedAt: entry.retrievedAt ?? observedAt } : null);
  return {
    key,
    vendor: { id: vendor.id, name: vendor.name, homepage: vendor.homepage },
    itemUrl,
    product,
    price,
    availability,
    availabilityEvidence: stamp(availabilityEvidence),
    shipping: shipping
      ? { ...shipping, evidence: stamp(shipping.evidence) }
      : shipping,
    // A parsed row always carries the promotions array (possibly empty): an
    // empty array means "the page was checked and no banner was found", which
    // must never be re-enriched from the checked-in fallback. Only rows stored
    // before banner parsing have no field at all and may use the fallback.
    promotions: promotions.map(promotion => (promotion ? { ...promotion, evidence: stamp(promotion.evidence) } : promotion)),
    mandatoryFees,
    observedAt,
    evidence: [
      { url: itemUrl, retrievedAt: observedAt, note: 'Item price and listed availability parsed from the vendor product page.' }
    ],
    parserVersion: vendor.parserVersion
  };
}

export function parseError(message, details) {
  const error = new Error(message);
  error.name = 'VendorParseError';
  if (details) error.details = details;
  return error;
}
