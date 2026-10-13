// Rendered-label regressions for timestamps that are actually in the future.
//
// The policy `reviewBy` date and a failing vendor's `nextAttemptAt` are due
// times, not observation times. Before iteration 3-77 they were formatted with
// timeLabel(), which printed a future date as "(just now)" — the rendered
// product page read "re-check by 11 Nov 2026, 02:00 (just now)".

import test from 'node:test';
import assert from 'node:assert/strict';
import { timeLabel, dueLabel, itemDiscountText, promotionDetailText, failedCheckNote, shippingCertaintyText, coverageQualifier } from '../public/ui.js';

test('timeLabel never calls a future timestamp "just now"', () => {
  const inHours = timeLabel(new Date(Date.now() + 5 * 3_600_000).toISOString());
  assert.match(inHours, /\(in 5 h\)/);
  assert.doesNotMatch(inHours, /just now/);

  const inDays = timeLabel(new Date(Date.now() + 29 * 24 * 3_600_000).toISOString());
  assert.match(inDays, /\(in 29 d\)/);
  assert.doesNotMatch(inDays, /just now/);
});

test('timeLabel still formats past observations as an age', () => {
  assert.match(timeLabel(new Date(Date.now() - 30_000).toISOString()), /\(just now\)/);
  assert.match(timeLabel(new Date(Date.now() - 5 * 3_600_000).toISOString()), /\(5 h ago\)/);
  assert.equal(timeLabel(null), 'never');
  assert.equal(timeLabel('not-a-date'), 'unknown time');
});

test('dueLabel formats future due times in hours and days and past ones as due now', () => {
  assert.match(dueLabel(new Date(Date.now() + 5 * 3_600_000).toISOString()), /\(in 5 h\)/);
  assert.match(dueLabel(new Date(Date.now() + 29 * 24 * 3_600_000).toISOString()), /\(in 29 d\)/);
  assert.match(dueLabel(new Date(Date.now() - 3_600_000).toISOString()), /\(due now\)/);
  assert.equal(dueLabel(null), 'not scheduled');
});

test('a failed last check is warned on the card face and stays silent when the check succeeded', () => {
  assert.equal(failedCheckNote({ lastAttemptFailed: true }), 'Last check failed — showing the last successful observation.');
  assert.equal(failedCheckNote({ lastAttemptFailed: false }), null);
  assert.equal(failedCheckNote({}), null, 'a quote without the field never shows the warning');
});

test('an observed free condition is labelled conditional, never as a verified free rate', () => {
  const free = {
    shipping: {
      certaintyLabel: 'Published rate (verified)',
      freeThresholdOrigin: 'observed_cart',
      amountIls: 0
    }
  };
  assert.equal(shippingCertaintyText(free), 'Published rate (verified) · free condition cart-observed');
  assert.match(coverageQualifier(free), /Free delivery applied from an anonymous-cart observation; confirm it at checkout\./);

  const paid = {
    shipping: {
      certaintyLabel: 'Published rate (verified)',
      freeThresholdOrigin: 'observed_cart',
      amountIls: 25
    }
  };
  assert.equal(shippingCertaintyText(paid), 'Published rate (verified)', 'below the observed subtotal the published rate is not qualified as free');
  assert.equal(coverageQualifier(paid), null);

  assert.equal(
    coverageQualifier({ shipping: { certainty: 'checkout_quote', coverageCaveat: 'locality list not published' } }),
    'Coverage not confirmed for every locality — full terms under Delivery options.',
    'the existing coverage caveat still wins when no free condition is applied'
  );
});

test('an applied promotion is disclosed on the card face and in the offer details', () => {
  const quote = {
    itemTotalIls: 237.6,
    itemSubtotalBeforeDiscountIls: 264,
    itemDiscount: {
      percent: 10,
      minItemSubtotal: 250,
      excludesMultipacks: true,
      source: 'page',
      wording: '10% הנחה אוטומטית בקופה'
    }
  };
  assert.equal(itemDiscountText(quote), '10% promotion applied — was ₪264.00');
  const detail = promotionDetailText(quote);
  assert.match(detail, /Published promotion: 10% off from ₪250\.00 item subtotal \(multipacks excluded\)/);
  assert.match(detail, /Vendor wording: “10% הנחה אוטומטית בקופה”/);
  assert.equal(itemDiscountText({}), null, 'no promotion means no card-face line');
  assert.equal(promotionDetailText({}), null);
  assert.equal(itemDiscountText({ itemDiscount: { percent: 10 } }), '10% promotion applied', 'the line still works without the pre-discount amount');
});
