// Exchange-rate handling.
//
// The public runtime never invents a conversion. Rates come from the Bank of
// Israel daily reference feed (www.boi.org.il/currency.xml, JSON) and are stored
// with their publication timestamp. When a rate is missing, an amount in that
// currency cannot be converted and the offer cannot be ranked.

export const FX_SOURCE = {
  name: 'Bank of Israel exchange rates',
  url: 'https://www.boi.org.il/currency.xml',
  note: 'Official daily reference rates published by the Bank of Israel.'
};

export const BASE_CURRENCY = 'ILS';

/** Parse the Bank of Israel JSON payload into a rate table. */
export function parseBoiRates(payload) {
  const entries = Array.isArray(payload?.exchangeRates) ? payload.exchangeRates : [];
  const rates = {};
  let asOf = null;
  for (const entry of entries) {
    if (!entry || typeof entry.key !== 'string') continue;
    const rate = Number(entry.currentExchangeRate);
    const unit = Number(entry.unit) || 1;
    if (!Number.isFinite(rate) || rate <= 0) continue;
    rates[entry.key.toUpperCase()] = { rate, unit };
    if (!asOf && typeof entry.lastUpdate === 'string') asOf = entry.lastUpdate;
  }
  if (Object.keys(rates).length === 0) return null;
  return { base: BASE_CURRENCY, asOf, rates, source: FX_SOURCE };
}

/**
 * Convert an amount to ILS using a stored rate table.
 * Returns { known:false } when the currency is missing; callers must not treat
 * a missing conversion as zero.
 */
export function toIls(amount, currency, fx) {
  if (amount == null || !Number.isFinite(Number(amount))) return { known: false, reason: 'amount unknown' };
  const code = String(currency || '').toUpperCase();
  if (code === BASE_CURRENCY) {
    return { known: true, amount: Number(amount), asOf: fx?.asOf ?? null, converted: false };
  }
  const entry = fx?.rates?.[code];
  if (!entry) {
    return { known: false, reason: `no ${code} reference rate stored`, asOf: fx?.asOf ?? null };
  }
  return {
    known: true,
    amount: (Number(amount) / entry.unit) * entry.rate,
    asOf: fx.asOf,
    converted: true,
    source: fx.source ?? FX_SOURCE
  };
}

export function formatIls(amount) {
  if (amount == null || !Number.isFinite(Number(amount))) return null;
  return `₪${Number(amount).toFixed(2)}`;
}
