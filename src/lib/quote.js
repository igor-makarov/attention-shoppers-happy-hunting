// Pure quote and ranking engine.
//
// Comparison total = item price + shipping + mandatory fees, normalized to ILS.
// Unknown shipping, unknown FX, stale observations, unknown availability and
// out-of-stock observations never become zero and never win.
// Pickup options are kept separate from delivered offers.

import { toIls } from './fx.js';

export const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
export const CLOCK_SKEW_MS = 5 * 60 * 1000;

export const DESTINATIONS = [
  { id: 'tel-aviv', label: 'Tel Aviv–Yafo', postcode: '6100000', country: 'IL' },
  { id: 'jerusalem', label: 'Jerusalem', postcode: '9100000', country: 'IL' },
  { id: 'haifa', label: 'Haifa', postcode: '3100000', country: 'IL' },
  { id: 'beer-sheva', label: "Be'er Sheva", postcode: '8400000', country: 'IL' },
  { id: 'eilat', label: 'Eilat', postcode: '8800000', country: 'IL' },
  { id: 'other', label: 'Elsewhere in Israel', postcode: null, country: 'IL' }
];

export function findDestination(id) {
  return DESTINATIONS.find(item => item.id === id) ?? DESTINATIONS[DESTINATIONS.length - 1];
}

const AVAILABILITY_LABELS = {
  in_stock: 'In stock (observed)',
  out_of_stock: 'Out of stock (observed)',
  unknown: 'Availability unknown'
};

export function quoteBoard({
  observations = [],
  productId,
  variantId = null,
  targetGrams = 500,
  destination = DESTINATIONS[0],
  fx = null,
  now = Date.now(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS
} = {}) {
  const grams = clampGrams(targetGrams);
  const quotes = [];
  const variants = new Set();
  for (const observation of observations) {
    if (productId && observation?.product?.productId !== productId) continue;
    if (observation?.product?.form !== 'ground') continue;
    variants.add(observation?.product?.variantId ?? 'unspecified');
    if (variantId && (observation?.product?.variantId ?? 'unspecified') !== variantId) continue;
    quotes.push(quoteOffer(observation, { grams, destination, fx, now, staleAfterMs }));
  }
  const ranked = quotes.filter(quote => quote.rankable).sort(compareQuotes);
  const pickup = [
    ...quotes.filter(quote => quote.group === 'pickup'),
    ...quotes
      .filter(quote => quote.group !== 'pickup' && quote.shipping?.pickup?.available)
      .map(toPickupEntry)
  ];
  const unrankable = quotes.filter(quote => quote.group === 'unrankable');
  const staleOrUnavailable = quotes.filter(quote => quote.group === 'stale_unavailable');
  const unknown = [...unrankable, ...staleOrUnavailable];
  return {
    productId,
    variantId,
    variants: [...variants].sort(),
    targetGrams: grams,
    destination,
    generatedAt: new Date(now).toISOString(),
    fx: fx ? { asOf: fx.asOf ?? null, source: fx.source?.name ?? null } : null,
    best: ranked[0] ?? null,
    ranked,
    pickup,
    unrankable,
    staleOrUnavailable,
    unknown,
    counts: {
      observed: quotes.length,
      ranked: ranked.length,
      pickup: pickup.length,
      unknown: unknown.length
    }
  };
}

export function quoteOffer(observation, { grams, destination, fx, now, staleAfterMs }) {
  const product = observation.product ?? {};
  const price = observation.price ?? {};
  const shipping = observation.shipping ?? {};
  const reasons = [];
  const labels = [];

  const ageMs = observation.observedAt ? now - Date.parse(observation.observedAt) : null;
  const stale = ageMs == null || ageMs > staleAfterMs || ageMs < -CLOCK_SKEW_MS;
  const freshness = ageMs == null ? 'unknown' : stale ? 'stale' : 'fresh';

  const base = {
    key: observation.key,
    vendor: observation.vendor,
    itemUrl: observation.itemUrl,
    product: {
      productId: product.productId,
      name: product.name ?? null,
      variantId: product.variantId ?? 'unspecified',
      variantLabel: product.variantLabel ?? 'Variant not stated',
      form: product.form,
      packGrams: product.packGrams ?? null,
      packCount: product.packCount ?? 1,
      totalGrams: product.totalGrams ?? null,
      sku: product.sku ?? null
    },
    availability: observation.availability ?? 'unknown',
    availabilityLabel: AVAILABILITY_LABELS[observation.availability] ?? AVAILABILITY_LABELS.unknown,
    freshness,
    ageHours: ageMs == null ? null : Math.round((ageMs / 3_600_000) * 10) / 10,
    observedAt: observation.observedAt ?? null,
    attemptedAt: observation.attemptedAt ?? null,
    evidence: observation.evidence ?? [],
    units: null,
    orderedGrams: null,
    itemPrice: { amount: price.amount ?? null, currency: price.currency ?? null },
    itemTotalIls: null,
    shipping: {
      mode: shipping.mode ?? 'delivery',
      certainty: shipping.certainty ?? 'unknown',
      amount: shipping.amount?.amount ?? null,
      currency: shipping.amount?.currency ?? null,
      amountIls: null,
      freeThreshold: shipping.freeThreshold?.amount ?? null,
      freeThresholdCurrency: shipping.freeThreshold?.currency ?? null,
      minOrder: shipping.minOrder?.amount ?? null,
      minOrderCurrency: shipping.minOrder?.currency ?? null,
      destination: shipping.destination ?? { scope: 'country', country: 'IL' },
      deliveryTime: shipping.deliveryTime ?? null,
      pickup: shipping.pickup ?? null,
      note: shipping.note ?? null,
      evidence: shipping.evidence ?? null
    },
    mandatoryFees: [],
    totalIls: null,
    ilsPerKg: null,
    estimate: false,
    rankable: false,
    reasons,
    labels,
    group: 'unrankable'
  };

  if (observation.shipping?.mode === 'pickup') {
    base.group = 'pickup';
    base.labels.push('Pickup only — not a delivered offer');
    if (product.totalGrams) {
      base.units = Math.max(1, Math.ceil(grams / product.totalGrams));
      base.orderedGrams = base.units * product.totalGrams;
    }
    const pickupTotal = toIls(price.amount == null ? null : price.amount * (base.units ?? 1), price.currency, fx);
    if (pickupTotal.known) {
      base.itemTotalIls = round2(pickupTotal.amount);
      base.labels.push('Shown for pickup comparison only');
    }
    return base;
  }

  if (!product.totalGrams || !product.packGrams) {
    reasons.push('Pack weight is not stated, so the delivered price per kilogram cannot be calculated');
    return base;
  }

  const units = Math.max(1, Math.ceil(grams / product.totalGrams));
  base.units = units;
  base.orderedGrams = units * product.totalGrams;

  const itemTotal = toIls(price.amount == null ? null : price.amount * units, price.currency, fx);
  if (!itemTotal.known) {
    reasons.push(price.amount == null
      ? 'Item price was not observed'
      : `No ${price.currency} reference rate is stored, so the total cannot be converted to ILS`);
    if (price.amount != null && Number.isFinite(price.amount)) {
      base.itemPrice.amount = round2(price.amount * units);
    }
    return base;
  }
  base.itemTotalIls = round2(itemTotal.amount);
  if (itemTotal.converted) base.estimate = true;

  if (shipping.minOrder != null) {
    const min = toIls(shipping.minOrder.amount, shipping.minOrder.currency ?? price.currency, fx);
    if (min.known && base.itemTotalIls < min.amount - 0.005) {
      reasons.push(`Order is below the vendor minimum order of ${formatAmount(min.amount, 'ILS')}`);
      return base;
    }
  }

  const coverage = coverageProblem(shipping.destination, destination);
  if (coverage) {
    reasons.push(coverage);
    return base;
  }

  if (observation.availability === 'out_of_stock') {
    base.labels.push('Out of stock at last successful check');
    base.group = 'stale_unavailable';
    return base;
  }
  if (observation.availability !== 'in_stock') {
    reasons.push('Stock was not confirmed by the source, so this offer cannot be confirmed as available');
    base.group = 'stale_unavailable';
    return base;
  }

  const feeSum = { amount: 0, currency: 'ILS' };
  for (const fee of observation.mandatoryFees ?? []) {
    const converted = toIls(fee.amount, fee.currency, fx);
    if (!converted.known) {
      reasons.push(`A mandatory fee (${fee.label ?? 'unlabelled'}) could not be converted to ILS`);
      return base;
    }
    feeSum.amount += converted.amount;
    base.mandatoryFees.push({ label: fee.label ?? 'Mandatory fee', amountIls: round2(converted.amount) });
  }

  let shippingIls = null;
  if (shipping.certainty === 'unknown' || shipping.amount == null) {
    reasons.push(shipping.note
      ? `Shipping is not published before checkout, so it is treated as unknown, not free (${shipping.note})`
      : 'Shipping is not published before checkout, so it is treated as unknown, not free');
    return base;
  }
  const convertedShipping = toIls(shipping.amount.amount ?? shipping.amount, shipping.amount.currency ?? price.currency, fx);
  if (!convertedShipping.known) {
    reasons.push(`Shipping is quoted in ${shipping.amount.currency ?? 'an unknown currency'} with no stored reference rate`);
    return base;
  }
  shippingIls = convertedShipping.amount;
  if (convertedShipping.converted || shipping.certainty === 'estimated') base.estimate = true;

  if (shipping.freeThreshold != null) {
    const threshold = toIls(shipping.freeThreshold.amount, shipping.freeThreshold.currency, fx);
    if (threshold.known && base.itemTotalIls >= threshold.amount - 0.005) {
      shippingIls = 0;
      base.labels.push(`Free shipping threshold met (${formatAmount(threshold.amount, 'ILS')})`);
    }
  }

  base.shipping.amountIls = round2(shippingIls);
  if (stale) {
    labels.push('Stale observation — the last successful check is too old to rank');
    base.group = 'stale_unavailable';
    return base;
  }

  base.totalIls = round2(base.itemTotalIls + shippingIls + feeSum.amount);
  base.ilsPerKg = round2((base.totalIls / base.orderedGrams) * 1000);
  base.rankable = true;
  base.group = 'ranked';
  if (base.estimate) labels.push('Estimate — includes a converted or estimated component');
  return base;
}

function coverageProblem(shippingDestination, destination) {
  if (!shippingDestination) return null;
  if (shippingDestination.scope === 'country') {
    if (destination?.country && shippingDestination.country !== destination.country) {
      return `Vendor does not deliver to ${destination.country}`;
    }
    return null;
  }
  if (shippingDestination.scope === 'localities') {
    const localities = shippingDestination.localities ?? [];
    if (!destination?.id || !localities.includes(destination.id)) {
      return `Vendor delivery list does not include ${destination?.label ?? 'this destination'}`;
    }
    return null;
  }
  return 'Vendor delivery coverage is not documented';
}

function toPickupEntry(quote) {
  const itemTotal = quote.itemTotalIls ?? (quote.itemPrice.amount != null && quote.units
    ? round2(quote.itemPrice.amount * quote.units)
    : null);
  return {
    ...quote,
    key: `${quote.key}:pickup`,
    group: 'pickup',
    rankable: false,
    totalIls: null,
    ilsPerKg: null,
    itemTotalIls: itemTotal,
    pickup: {
      available: true,
      amount: quote.shipping.pickup?.amount ?? null,
      note: quote.shipping.pickup?.note ?? null
    },
    labels: [...quote.labels, 'Pickup only — not a delivered offer']
  };
}

function compareQuotes(a, b) {
  if (a.totalIls !== b.totalIls) return a.totalIls - b.totalIls;
  if (a.ilsPerKg !== b.ilsPerKg) return a.ilsPerKg - b.ilsPerKg;
  return String(a.vendor?.name ?? '').localeCompare(String(b.vendor?.name ?? ''));
}

export function clampGrams(value) {
  const grams = Number(value);
  if (!Number.isFinite(grams) || grams <= 0) return 500;
  return Math.min(Math.max(Math.round(grams), 1), 100_000);
}

export function formatAmount(amount, currency = 'ILS') {
  const symbols = { ILS: '₪', USD: '$', EUR: '€', GBP: '£' };
  const symbol = symbols[String(currency).toUpperCase()] ?? `${currency} `;
  return `${symbol}${Number(amount).toFixed(2)}`;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
