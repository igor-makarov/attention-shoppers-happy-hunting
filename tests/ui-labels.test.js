// Rendered-label regressions for timestamps that are actually in the future.
//
// The policy `reviewBy` date and a failing vendor's `nextAttemptAt` are due
// times, not observation times. Before iteration 3-77 they were formatted with
// timeLabel(), which printed a future date as "(just now)" — the rendered
// product page read "re-check by 11 Nov 2026, 02:00 (just now)".

import test from 'node:test';
import assert from 'node:assert/strict';
import { timeLabel, dueLabel, itemDiscountText, promotionDetailText } from '../public/ui.js';

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
