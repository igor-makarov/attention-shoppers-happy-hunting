// Pure quote and ranking engine.
//
// Comparison total = item price + shipping + mandatory fees, normalized to ILS.
// Unknown shipping, unknown FX, stale observations, unknown availability and
// out-of-stock observations never become zero and never win.
// Pickup options are kept separate from delivered offers.

import { toIls } from './fx.js';
import { enrichObservationShipping, policySummary, SHIPPING_POLICIES } from './policies.js';

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

/**
 * Plain-language shipping certainty. The board never presents an unknown rate as
 * free, so the label says where the amount came from (or that it is missing)
 * instead of relying on a color or a bare "verified" flag.
 */
const SHIPPING_CERTAINTY_LABELS = {
  verified: 'Published rate (verified)',
  // A rate read from an anonymous public cart/checkout estimator is observed
  // and usable for the recorded cart, but the vendor never published it on the
  // product page, so the label keeps the condition visible instead of calling
  // it a published or completed checkout price.
  checkout_quote: 'Checkout rate (observed, conditional)',
  estimated: 'Estimated rate',
  unknown: 'Not published before checkout'
};

export function shippingCertaintyLabel(certainty) {
  return SHIPPING_CERTAINTY_LABELS[certainty] ?? SHIPPING_CERTAINTY_LABELS.unknown;
}

/**
 * The delivery method a charge buys. This is deliberately separate from the
 * certainty label: a shopper must be able to tell whether ₪30 buys home
 * courier delivery, pickup-point delivery or a distribution-center service,
 * and how well that rate is evidenced.
 */
const SHIPPING_SERVICE_LABELS = {
  home_delivery: 'Home delivery',
  courier: 'Home courier delivery',
  pickup_point: 'Pickup-point delivery',
  distribution_center: 'Distribution-center delivery',
  self_pickup: 'Self-pickup',
  locker: 'Locker delivery'
};

export function shippingServiceLabel(service, mode = 'delivery') {
  if (service && SHIPPING_SERVICE_LABELS[service]) return SHIPPING_SERVICE_LABELS[service];
  return mode === 'pickup' ? SHIPPING_SERVICE_LABELS.self_pickup : 'Delivery method not stated';
}

export function quoteBoard({
  observations = [],
  productId,
  variantId = null,
  targetGrams = 500,
  destination = DESTINATIONS[0],
  fx = null,
  now = Date.now(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  // Validated shipping policies enrich observations whose own shipping is
  // unknown. Pass null to disable (tests of the raw stored evidence).
  policies = SHIPPING_POLICIES
} = {}) {
  const grams = clampGrams(targetGrams);
  const quotes = [];
  const variants = new Set();
  const excludedVariants = new Set();
  let excludedByVariant = 0;
  for (const observation of observations) {
    if (productId && observation?.product?.productId !== productId) continue;
    if (observation?.product?.form !== 'ground') continue;
    variants.add(observation?.product?.variantId ?? 'unspecified');
    if (variantId && (observation?.product?.variantId ?? 'unspecified') !== variantId) {
      // Kept out of this ranking on purpose: variants are never merged. The
      // count lets the UI tell the shopper that offers for another variant exist.
      excludedByVariant += 1;
      excludedVariants.add(observation?.product?.variantId ?? 'unspecified');
      continue;
    }
    // Read-time policy enrichment: an old stored row whose shipping was unknown
    // gains a validated rule without waiting for the next vendor refresh. The
    // observation's own price, stock and observedAt are never touched.
    const enriched = policies === null
      ? observation
      : enrichObservationShipping(observation, { policies, now }).observation;
    quotes.push(quoteOffer(enriched, { grams, destination, fx, now, staleAfterMs }));
  }
  const ranked = quotes.filter(quote => quote.rankable).sort(compareQuotes);
  // The cheapest delivered total is not always the cheapest bulk value. Keep the
  // per-kilogram winner as separate structured evidence so the board can call it
  // out without changing the ranking itself.
  const bestPerKgQuote = ranked.length
    ? ranked.reduce((min, quote) => (quote.ilsPerKg < min.ilsPerKg ? quote : min))
    : null;
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
    shippingPolicies: policies === null ? [] : policySummary(now, policies),
    best: ranked[0] ?? null,
    bestPerKg: bestPerKgQuote
      ? {
          key: bestPerKgQuote.key,
          vendor: bestPerKgQuote.vendor,
          ilsPerKg: bestPerKgQuote.ilsPerKg,
          totalIls: bestPerKgQuote.totalIls,
          units: bestPerKgQuote.units,
          orderedGrams: bestPerKgQuote.orderedGrams,
          packGrams: bestPerKgQuote.product.packGrams,
          packCount: bestPerKgQuote.product.packCount
        }
      : null,
    ranked,
    pickup,
    unrankable,
    staleOrUnavailable,
    unknown,
    counts: {
      observed: quotes.length,
      ranked: ranked.length,
      pickup: pickup.length,
      unknown: unknown.length,
      excludedByVariant,
      excludedVariants: [...excludedVariants].sort()
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
    // A failed last attempt keeps the previous good price and stock, but the
    // board must be able to say that the most recent check failed instead of
    // presenting the row as freshly re-checked.
    lastError: observation.lastError ?? null,
    lastAttemptFailed: Boolean(observation.lastError),
    evidence: observation.evidence ?? [],
    previous: summarizePrevious(observation.previous),
    priceChange: priceChangeOf({ current: price, previous: observation.previous, product, fx }),
    units: null,
    orderedGrams: null,
    itemPrice: { amount: price.amount ?? null, currency: price.currency ?? null },
    itemTotalIls: null,
    shipping: {
      mode: shipping.mode ?? 'delivery',
      service: shipping.service ?? null,
      serviceLabel: shippingServiceLabel(shipping.service ?? null, shipping.mode ?? 'delivery'),
      certainty: shipping.certainty ?? 'unknown',
      certaintyLabel: shippingCertaintyLabel(shipping.certainty ?? 'unknown'),
      amount: shipping.amount?.amount ?? null,
      currency: shipping.amount?.currency ?? null,
      amountIls: null,
      freeThreshold: shipping.freeThreshold?.amount ?? null,
      freeThresholdCurrency: shipping.freeThreshold?.currency ?? null,
      // The vendor's own wording decides the boundary: "above ₪100" is strictly
      // greater than the threshold, "from/at least ₪100" is greater-or-equal.
      // The default only applies when no wording was recorded.
      freeThresholdSemantics: shipping.freeThresholdSemantics ?? shipping.policy?.thresholdSemantics ?? 'at_least',
      minOrder: shipping.minOrder?.amount ?? null,
      minOrderCurrency: shipping.minOrder?.currency ?? null,
      destination: shipping.destination ?? { scope: 'country', country: 'IL' },
      deliveryTime: shipping.deliveryTime ?? null,
      maxTotalGrams: shipping.maxTotalGrams ?? null,
      pickup: shipping.pickup ?? null,
      alternatives: (shipping.alternatives ?? []).map(alternative => {
        const converted = toIls(alternative.amount?.amount ?? null, alternative.amount?.currency ?? price.currency, fx);
        return {
          id: alternative.id ?? null,
          label: alternative.label ?? 'Alternative shipping option',
          amount: alternative.amount?.amount ?? null,
          currency: alternative.amount?.currency ?? price.currency ?? null,
          amountIls: converted.known ? round2(converted.amount) : null,
          note: alternative.note ?? null
        };
      }),
      note: shipping.note ?? null,
      policy: shipping.policy ?? null,
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
    if (stale) {
      base.labels.push('Stale observation — the last successful check is too old; treat the item total as out of date');
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

  // A rate observed on a smaller anonymous cart is not silently stretched to a
  // bigger one: the offer stays visible and unrankable with the exact reason.
  if (shipping.maxTotalGrams != null && base.orderedGrams > shipping.maxTotalGrams) {
    reasons.push(`Shipping was quoted only for carts up to ${shipping.maxTotalGrams} g, but this quantity is ${base.orderedGrams} g`);
    return base;
  }

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
  // A published rate whose locality list is not published is a disclosed caveat,
  // not a blocker: the vendor states home delivery is subject to the list, so the
  // board keeps ranking but never claims unconditional coverage of the destination.
  const coverageCaveat = typeof shipping.destination?.caveat === 'string' && shipping.destination.caveat.trim()
    ? shipping.destination.caveat.trim()
    : null;
  if (coverageCaveat) {
    base.shipping.coverageCaveat = coverageCaveat;
    base.labels.push(`Delivery coverage caveat: ${coverageCaveat}`);
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
    // "above ₪100" means the ₪100 boundary itself is not free; only a strictly
    // larger item subtotal is. Never silently relax the vendor's wording.
    const semantics = base.shipping.freeThresholdSemantics;
    const met = threshold.known && (semantics === 'above'
      ? base.itemTotalIls > threshold.amount + 0.005
      : base.itemTotalIls >= threshold.amount - 0.005);
    if (met) {
      shippingIls = 0;
      base.labels.push(`Free shipping threshold met (${semantics === 'above' ? 'above' : 'from'} ${formatAmount(threshold.amount, 'ILS')})`);
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

/** Shape the stored previous-check snapshot for the API without leaking raw payloads. */
function summarizePrevious(previous) {
  if (!previous || typeof previous !== 'object') return null;
  const availability = previous.availability ?? 'unknown';
  return {
    observedAt: previous.observedAt ?? null,
    priceAmount: previous.price?.amount ?? null,
    priceCurrency: previous.price?.currency ?? null,
    availability,
    availabilityLabel: AVAILABILITY_LABELS[availability] ?? AVAILABILITY_LABELS.unknown
  };
}

/**
 * Compare the unit price with the previous successful check.
 * The comparison is in ILS using the stored Bank of Israel rate when needed, is
 * only made between equal pack weights, and is never reported as "no change"
 * when a conversion is impossible.
 */
function priceChangeOf({ current, previous, product, fx }) {
  const previousPrice = previous?.price;
  if (!previous?.observedAt || previousPrice?.amount == null || current?.amount == null) return null;
  const previousObservedAt = previous.observedAt;
  const previousAmount = previousPrice.amount;
  const previousCurrency = previousPrice.currency ?? current.currency ?? null;
  if (previous.totalGrams != null && product.totalGrams != null && previous.totalGrams !== product.totalGrams) {
    return {
      comparable: false,
      reason: 'the pack size changed since the previous check, so the unit prices are not comparable',
      previousObservedAt,
      previousAmount,
      previousCurrency
    };
  }
  const before = toIls(previousAmount, previousCurrency, fx);
  const after = toIls(current.amount, current.currency ?? previousCurrency, fx);
  if (!before.known || !after.known) {
    return {
      comparable: false,
      reason: 'a stored exchange rate is needed to compare the previous price',
      previousObservedAt,
      previousAmount,
      previousCurrency
    };
  }
  const delta = round2(after.amount - before.amount);
  return {
    comparable: true,
    direction: delta < 0 ? 'down' : delta > 0 ? 'up' : 'same',
    deltaIls: Math.abs(delta),
    previousAmount,
    previousCurrency,
    previousIls: round2(before.amount),
    previousObservedAt
  };
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
    labels: [...quote.labels.filter(label => !label.startsWith('Delivery coverage caveat:')), 'Pickup only — not a delivered offer']
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
