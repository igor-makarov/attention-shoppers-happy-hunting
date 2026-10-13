import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  EVIDENCE_SCHEMA_VERSION,
  RECIPES,
  expandSteps,
  sanitizeUrl,
  sanitizeExcerpt,
  parsePucksTotals,
  parseCoffeemanTotals,
  parseCoffee4uTotals,
  buildEvidenceRecord,
  validateEvidence,
  listRecipes,
  runRecipe
} from '../scripts/research-workflow.mjs';

const PUCKS_500G = `סיכום הזמנה
2
lavazza crema e gusto classico-250 גרם קפה טחון
60 ₪
תשלום
סכום ביניים 60 ₪
משלוח 30 ₪
דרכי משלוח: משלוח עד הבית 30 ₪
משלוח חינם בהזמנה מעל 100 ₪
סך הכל 90 ₪`;

const PUCKS_1KG_FREE = `סיכום הזמנה
4
lavazza crema e gusto classico-250 גרם קפה טחון
120 ₪
סכום ביניים 120 ₪
משלוח
חינם
משלוח חינם בהזמנה מעל 100 ₪
סך הכל 120 ₪`;

const COFFEEMAN = `סיכום הזמנה
סכום ביניים 66 ₪
משלוח 25 ₪
סה"כ 91 ₪`;

// The real Coffee4U checkout layout captured on 2026-10-13: the tracked
// product line and its amount are on separate lines, the method cards print
// their option prices before a method is applied, and the applied summary fee
// is a bare "משלוח" label followed by "₪30" on the next line.
const COFFEE4U_500G = `דף רכישה
Lavazza Crema e gusto 250 gr טחון
₪ 76
משלוח ותשלום
*בחר שיטת משלוח
משלוח לנקודת איסוף צ\`יטה שופס (עד 7 ימי עסקים - עד 5 ק"ג 30*30*30) - 15 ₪
שליחות מדלת לדלת עד 1-5 ימי עסקים - 30 ₪
(ברצוני לבצע איסוף עצמי להזמנה)
משלוח
₪30
סכום כולל מע"מ
₪106`;

test('the Coffee4U parser reads the real checkout layout with label and amount on separate lines', () => {
  const totals = parseCoffee4uTotals(COFFEE4U_500G);
  assert.equal(totals.itemSubtotalIls, 76, 'the product-line amount is the item subtotal');
  assert.equal(totals.shippingIls, 30, 'the applied summary fee is read, not a method-card option price');
  assert.equal(totals.deliveredTotalIls, 106);
  assert.equal(totals.currency, 'ILS');
});

test('recipes cover the three tracked vendors with whole-pack cart steps', () => {
  const list = listRecipes();
  assert.deepEqual(list.map(item => item.id).sort(), ['coffee4u', 'coffeeman', 'pucks']);
  for (const recipe of list) {
    assert.ok(recipe.productUrl.startsWith('https://'), recipe.id);
    assert.ok(recipe.cartUrl.startsWith('https://'), recipe.id);
    assert.equal(recipe.packGrams, 250, recipe.id);
    assert.ok(recipe.steps >= 5, `${recipe.id} has a cart/estimator navigation`);
  }
});

test('recipe placeholders expand to the run parameters', () => {
  const steps = expandSteps(RECIPES.pucks, { productUrl: 'https://example.test/p', cartUrl: 'https://example.test/c', grams: 500, locality: 'תל אביב', postcode: '6100000' });
  assert.equal(steps[0].url, 'https://example.test/p');
  assert.equal(steps.find(step => step.action === 'gotoUnlessText').url, 'https://example.test/c');
  const city = steps.find(step => step.action === 'fill' && step.selector === '#city');
  const zip = steps.find(step => step.action === 'fill' && step.selector === '#zip');
  assert.equal(city.value, 'תל אביב');
  assert.equal(city.optional, false, 'a quote attributed to a locality must set it on the page');
  assert.equal(zip.value, '6100000');
  assert.equal(zip.optional, false, 'the postcode is required for a destination quote');
  assert.equal(city.verifies, 'destination');
  assert.equal(zip.verifies, 'destination');
  assert.equal(steps.some(step => step.action === 'selectLabel'), false, 'the only <select> on the Pucks estimator is the language dropdown, so the recipe never uses a generic select step');
  const method = steps.find(step => step.action === 'clickAnyText');
  assert.deepEqual(method.texts, ['משלוח עד הבית'], 'the recipe selects the actual delivery method');
  assert.equal(method.optional, false, 'a quote without a chosen method would not show the fee, so the step is required');
  assert.equal(method.confirmsService, 'home_delivery', 'the method step confirms the delivery method the quote belongs to');
});

test('Pucks totals parse the subtotal, flat fee and total, and recognize free shipping', () => {
  const below = parsePucksTotals(PUCKS_500G);
  assert.equal(below.itemSubtotalIls, 60);
  assert.equal(below.shippingIls, 30);
  assert.equal(below.deliveredTotalIls, 90);
  assert.equal(below.freeThresholdIls, 100);
  assert.match(below.freeThresholdText, /Free shipping above ₪100/);
  const free = parsePucksTotals(PUCKS_1KG_FREE);
  assert.equal(free.itemSubtotalIls, 120);
  assert.equal(free.shippingIls, 0, 'a "חינם" shipping line is recorded as free, not as an unknown number');
  assert.equal(free.shippingLabel, 'free');
  assert.equal(free.deliveredTotalIls, 120);
});

test('Pucks totals parse the rendered multi-line summary without reading the threshold banner as free delivery', () => {
  const rendered = `סיכום הזמנה
(1)
90 ₪
2
lavazza crema e gusto classico-250 גרם קפה טחון
60 ₪
תשלום סכום ביניים
60 ₪
משלוח
30 ₪
1
דרכי משלוח
משלוח עד הבית
30 ₪
משלוח חינם בהזמנה מעל 100 ₪
2
פרטי משלוח
סך הכל
90 ₪`;
  const totals = parsePucksTotals(rendered);
  assert.equal(totals.itemSubtotalIls, 60);
  assert.equal(totals.shippingIls, 30, 'the charged ₪30 is read, not the "free above ₪100" banner');
  assert.equal(totals.deliveredTotalIls, 90);
  assert.equal(totals.freeThresholdIls, 100);
  assert.equal(totals.shippingIls + totals.itemSubtotalIls, totals.deliveredTotalIls);

  const freeRendered = `סיכום הזמנה
(1)
120 ₪
4
lavazza crema e gusto classico-250 גרם קפה טחון
120 ₪
תשלום סכום ביניים
120 ₪
משלוח
חינם
1
דרכי משלוח
משלוח עד הבית
חינם
משלוח חינם בהזמנה מעל 100 ₪
סך הכל
120 ₪`;
  const free = parsePucksTotals(freeRendered);
  assert.equal(free.shippingIls, 0);
  assert.equal(free.deliveredTotalIls, 120);

  // Before a method is chosen the summary shows an em dash, not a rate: the
  // delivery-methods card must not be read as the applied charge.
  const unselected = `סיכום הזמנה
60 ₪
תשלום סכום ביניים
60 ₪
משלוח
—
סך הכל
60 ₪
דרכי משלוח
משלוח עד הבית
30 ₪
משלוח חינם בהזמנה מעל 100 ₪`;
  assert.equal(parsePucksTotals(unselected).shippingIls, null, 'an unselected method is not a delivered quote');
});

test('CoffeeMan totals parse without inventing a threshold', () => {
  const totals = parseCoffeemanTotals(COFFEEMAN);
  assert.equal(totals.itemSubtotalIls, 66);
  assert.equal(totals.shippingIls, 25);
  assert.equal(totals.deliveredTotalIls, 91);
  assert.equal(totals.freeThresholdIls, null, 'no free-shipping rule is inferred from one cart');
});

test('CoffeeMan totals parse the current checkout layout with a bare summary shipping line', () => {
  // Minimized excerpt of the real 2026-10-13 checkout.asp body text for a
  // 2 x 250 g cart: the item subtotal sits on the tracked product line, the
  // applied fee is a bare "משלוח" line followed by "₪25.00", and the total is
  // labelled "סכום כולל מע"מ". The method-option labels above it print their own
  // prices and must not be read as the applied charge.
  const checkout = `דף רכישה
עגלת הקניות שלי
250 גרם קפה טחון lavazza Crema e Gusto Classico חוזק 7

₪ 66.00
+-
פרטי המזמין
פרטי תשלום כולל משלוח
שלח
*בחר שיטת משלוח
משלוח לבית הלקוח עם שליח - 25.00 ₪
משלוח ממרכז חלוקה עד 5 ק"ג - 15.00 ₪
(ברצוני לבצע איסוף עצמי להזמנה)
לפרטים על שילוח באמצעות E-post לנק' חלוקה/לוקר אוטומטי לחץ כאן
משלוח
₪25.00
סכום כולל מע"מ
₪91.00
תשלום באמצעות`;
  const courier = parseCoffeemanTotals(checkout);
  assert.equal(courier.itemSubtotalIls, 66, 'the tracked product line amount is the item subtotal');
  assert.equal(courier.shippingIls, 25, 'the bare summary line is the applied fee, not a method-card option price');
  assert.equal(courier.deliveredTotalIls, 91);
  // The same layout after the ₪15 distribution-center option is applied.
  const distribution = parseCoffeemanTotals(checkout.replace('₪25.00\nסכום כולל מע"מ\n₪91.00', '₪15.00\nסכום כולל מע"מ\n₪81.00'));
  assert.equal(distribution.shippingIls, 15);
  assert.equal(distribution.deliveredTotalIls, 81);
});

test('evidence sanitization strips query strings, fragments and token-like runs', () => {
  assert.equal(sanitizeUrl('https://pucks.co.il/payment/request?sess=abc123&cart_id=9#x'), 'https://pucks.co.il/payment/request');
  assert.equal(sanitizeUrl('not a url?with=query'), 'not a url');
  const excerpt = sanitizeExcerpt(`cart 12345 PHPSESSID=abcdef ${'A'.repeat(40)} end`);
  assert.ok(!excerpt.includes('abcdef'));
  assert.ok(!excerpt.includes('A'.repeat(30)));
  assert.match(excerpt, /\[redacted\]/);
});

test('a quoted evidence record validates and carries its arithmetic', () => {
  const record = buildEvidenceRecord({
    recipe: RECIPES.pucks,
    params: { grams: 500, locality: 'Tel Aviv', postcode: '6100000' },
    status: 'quoted',
    totals: parsePucksTotals(PUCKS_500G),
    pageUrl: 'https://pucks.co.il/payment/request?PHPSESSID=secret',
    now: Date.parse('2026-10-12T18:09:20Z')
  });
  assert.equal(record.schemaVersion, EVIDENCE_SCHEMA_VERSION);
  assert.equal(record.status, 'quoted');
  assert.equal(record.pack, '2 × 250 g = 500 g');
  assert.equal(record.arithmeticOk, true);
  assert.equal(record.cartUrl, 'https://pucks.co.il/payment/request', 'the session query string is stripped');
  assert.equal(record.observedAt, '2026-10-12T18:09:20.000Z');
  const validation = validateEvidence(record);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test('a blocked record must explain the blocker and a quoted record must be consistent', () => {
  const blocked = buildEvidenceRecord({
    recipe: RECIPES.coffeeman,
    params: { grams: 2000 },
    status: 'blocked',
    totals: {},
    blocker: 'Required step "clickText" failed: no clickable element matched "הוספה לסל"',
    now: Date.parse('2026-10-12T18:00:00Z')
  });
  assert.equal(validateEvidence(blocked).ok, true);
  assert.match(blocked.blocker, /no clickable element/);

  const inconsistent = buildEvidenceRecord({
    recipe: RECIPES.pucks,
    params: { grams: 500, locality: 'Tel Aviv' },
    status: 'quoted',
    totals: { itemSubtotalIls: 60, shippingIls: 30, deliveredTotalIls: 80 },
    now: Date.parse('2026-10-12T18:00:00Z')
  });
  assert.equal(inconsistent.status, 'partial', 'arithmetic that does not add up is not quoted evidence');
  assert.equal(inconsistent.arithmeticOk, false);
  const incomplete = { ...inconsistent, status: 'quoted', shippingIls: null };
  assert.equal(validateEvidence(incomplete).ok, false, 'a quoted record without a shipping line fails validation');

  const missingBlocker = buildEvidenceRecord({ recipe: RECIPES.pucks, status: 'blocked', now: Date.parse('2026-10-12T18:00:00Z') });
  assert.equal(validateEvidence(missingBlocker).ok, false);
});

test('runRecipe records every step and stops at the first required blocker', async () => {
  const calls = [];
  const driver = {
    goto: async url => { calls.push(['goto', url]); },
    gotoUnlessText: async url => { calls.push(['gotoUnlessText', url]); return 'navigated'; },
    clickText: async text => { calls.push(['clickText', text]); throw new Error('not found'); },
    clickAnyText: async texts => { calls.push(['clickAnyText', texts]); return 'משלוח עד הבית 30 ₪'; },
    clickSelector: async () => { calls.push(['clickSelector']); throw new Error('no element matched'); },
    selectLabel: async () => { calls.push(['selectLabel']); },
    fill: async (selector, value) => { calls.push(['fill', selector, value]); return { selector, value }; },
    setQuantity: async () => { calls.push(['setQuantity']); throw new Error('no quantity input found'); },
    waitText: async () => true,
    sleep: async () => {},
    getText: async () => PUCKS_500G,
    currentUrl: async () => 'https://pucks.co.il/payment/request'
  };
  const record = await runRecipe({ recipe: RECIPES.pucks, driver, params: { grams: 500, locality: 'תל אביב' }, now: Date.parse('2026-10-12T18:09:20Z') });
  // The recipe's own URLs are expanded from the recipe, never left as placeholders.
  assert.equal(calls.find(call => call[0] === 'goto')[1], RECIPES.pucks.productUrl);
  assert.equal(calls.find(call => call[0] === 'gotoUnlessText')[1], RECIPES.pucks.cartUrl);
  // The two clickText steps and the cart-link click are optional, so the run
  // reaches the estimator and reads the totals after selecting home delivery.
  assert.equal(record.status, 'partial', 'a read quote without a verified cart quantity is partial, not quoted');
  assert.match(record.qualification, /quantity was not verified/);
  assert.ok(record.steps.some(step => step.step === 'clickText' && step.ok === false && step.optional === true));
  const methodStep = record.steps.find(step => step.step === 'clickAnyText');
  assert.equal(methodStep.ok, true);
  assert.match(methodStep.detail, /clicked: משלוח עד הבית/, 'the evidence records the method that was selected');
  const cityStep = record.steps.find(step => step.step === 'fill' && step.detail);
  assert.match(cityStep.detail, /#city=תל אביב/, 'the evidence records the destination value the page actually holds');
  assert.equal(record.destinationVerified, true, 'a verified #city/#zip fill is recorded as a verified destination');
  assert.equal(record.service, 'home_delivery', 'the successful method step records the actual confirmed method');
  assert.equal(record.serviceConfirmed, true, 'the method is recorded as confirmed by the rendered page step');
  assert.equal(record.itemSubtotalIls, 60);
  assert.equal(record.shippingIls, 30);
  assert.equal(validateEvidence(record).ok, true);
});

test('an unconfirmed delivery method is recorded as unconfirmed, never implied', async () => {
  // CoffeeMan's checkout requires the #delivery method select. A run that
  // reaches the method step but cannot apply the home-courier option must
  // block, and the displayed shipping line must never be attributed to a named
  // method the rendered page did not confirm.
  const driver = {
    goto: async () => {},
    gotoUnlessText: async () => 'navigated',
    clickText: async () => {},
    clickAnyText: async () => 'קנה עכשיו',
    clickSelector: async () => 'a.slide_cart__btn-checkout',
    selectLabel: async (selector, label) => {
      if (selector === '#delivery') throw new Error('selectLabel: no option matches משלוח לבית הלקוח');
      return label;
    },
    fill: async (selector, value) => ({ selector, value }),
    setQuantity: async () => 2,
    waitText: async () => true,
    sleep: async () => {},
    getText: async () => COFFEEMAN,
    currentUrl: async () => 'https://www.coffeeman.co.il/checkout.asp'
  };
  const record = await runRecipe({ recipe: RECIPES.coffeeman, driver, params: { grams: 500, locality: 'תל אביב', postcode: '6100000' } });
  assert.equal(record.status, 'blocked', 'a method the page never applied is not a quote');
  assert.equal(record.service, null, 'no method is recorded when the page never confirmed one');
  assert.equal(record.serviceConfirmed, false, 'the method step was attempted and not confirmed');
  assert.match(record.blocker, /Required step "selectLabel" failed/);
  assert.equal(validateEvidence(record).ok, true, 'the disclosure makes the unconfirmed method valid evidence');
  // The schema rejects a record that claims a confirmed method without naming it.
  assert.equal(validateEvidence({ ...record, serviceConfirmed: true, service: null }).ok, false);
  // A quoted record that could not confirm the method must disclose that
  // instead of implying a method the page never selected.
  const quoted = buildEvidenceRecord({
    recipe: RECIPES.coffeeman,
    params: { grams: 500, locality: 'תל אביב', postcode: '6100000' },
    status: 'quoted',
    totals: { itemSubtotalIls: 66, shippingIls: 25, deliveredTotalIls: 91 },
    service: null,
    serviceConfirmed: false,
    now: Date.parse('2026-10-12T20:24:00Z')
  });
  assert.match(quoted.qualification, /method could not be confirmed/i);
  assert.equal(validateEvidence(quoted).ok, true, 'the disclosure makes the unconfirmed method valid evidence');
  assert.equal(validateEvidence({ ...quoted, qualification: null }).ok, false, 'an unconfirmed quoted method must be disclosed');
});

test('a run blocks when the required delivery method cannot be selected', async () => {
  const driver = {
    goto: async () => {},
    gotoUnlessText: async () => 'navigated',
    clickText: async () => {},
    clickAnyText: async () => { throw new Error('no clickable element matched any of ["משלוח עד הבית"]'); },
    clickSelector: async () => 'a.slide_cart__btn-checkout',
    selectLabel: async () => {},
    fill: async (selector, value) => ({ selector, value }),
    setQuantity: async () => 2,
    waitText: async () => true,
    sleep: async () => {},
    getText: async () => PUCKS_500G,
    currentUrl: async () => 'https://pucks.co.il/payment/request'
  };
  const record = await runRecipe({ recipe: RECIPES.pucks, driver, params: { grams: 500, locality: 'תל אביב' } });
  assert.equal(record.status, 'blocked');
  assert.match(record.blocker, /clickAnyText/);
  assert.equal(record.observedPacks, 2);
  assert.equal(validateEvidence(record).ok, true);
});

test('a run blocks when the required destination fields cannot be set', async () => {
  const driver = {
    goto: async () => {},
    gotoUnlessText: async () => 'navigated',
    clickText: async () => {},
    clickAnyText: async () => 'משלוח עד הבית',
    clickSelector: async () => 'a.slide_cart__btn-checkout',
    selectLabel: async () => {},
    fill: async selector => {
      if (selector === '#city') throw new Error('fill: no element matches #city');
      return { selector, value: '9100000' };
    },
    setQuantity: async () => 4,
    waitText: async () => true,
    sleep: async () => {},
    getText: async () => PUCKS_1KG_FREE,
    currentUrl: async () => 'https://pucks.co.il/payment/request'
  };
  const record = await runRecipe({ recipe: RECIPES.pucks, driver, params: { grams: 1000, locality: 'ירושלים', postcode: '9100000' } });
  assert.equal(record.status, 'blocked', 'a quote must not be attributed to a destination the recipe could not set');
  assert.match(record.blocker, /Required step "fill" failed/);
  assert.ok(record.steps.some(step => step.step === 'fill' && step.ok === false && step.optional === false));
  assert.equal(record.destinationVerified, false);
  assert.equal(validateEvidence(record).ok, true);
});

test('a destination step that sets the wrong value blocks the run and is never trusted', async () => {
  // The Coffee4U checkout renders one closed locality list (select#u_city). If a
  // step sets something else (for example the language dropdown), the run must
  // not claim the locality was set; the required destination step blocks it.
  const driver = {
    goto: async () => {},
    gotoUnlessText: async () => 'navigated',
    clickText: async () => {},
    clickAnyText: async () => 'הוסף לסל',
    clickSelector: async () => 'a.slide_cart__btn-checkout',
    selectLabel: async () => 'עברית',
    fill: async (selector, value) => ({ selector, value }),
    setQuantity: async () => 1,
    waitText: async () => true,
    sleep: async () => {},
    getText: async () => `סיכום הזמנה\nסה"כ מוצרים 38 ₪\nמשלוח 30 ₪\nסה"כ לתשלום 68 ₪`,
    currentUrl: async () => 'https://www.coffee4u.co.il/Checkout.asp'
  };
  const record = await runRecipe({ recipe: RECIPES.coffee4u, driver, params: { grams: 250, locality: 'תל אביב', postcode: '6100000' } });
  assert.equal(record.status, 'blocked');
  assert.match(record.blocker, /destination verification failed/);
  assert.equal(record.destinationVerified, false, 'a language dropdown is not a destination');
  assert.equal(validateEvidence(record).ok, true);

  // Even if a quoted record did carry an unverified destination, the schema
  // requires it to disclose that instead of presenting it as confirmed.
  const quoted = buildEvidenceRecord({
    recipe: RECIPES.coffee4u,
    params: { grams: 250, locality: 'תל אביב', postcode: '6100000' },
    status: 'quoted',
    totals: { itemSubtotalIls: 38, shippingIls: 30, deliveredTotalIls: 68 },
    destinationVerified: false,
    now: Date.parse('2026-10-12T20:24:00Z')
  });
  assert.equal(validateEvidence(quoted).ok, true, 'the disclosure makes it valid');
  assert.match(quoted.qualification, /could not be verified/);
  const stripped = { ...quoted, qualification: null };
  assert.equal(validateEvidence(stripped).ok, false, 'an unverified destination must be disclosed');
});

test('the checked-in quote records carry the confirmed delivery method from their method step', () => {
  // The Coffee4U destination-extension records were produced before the schema
  // gained the field and were backfilled from their recorded successful method
  // step; every checked-in record whose method step succeeded must carry it.
  const dir = new URL('../docs/evidence/browser-research/', import.meta.url);
  let checked = 0;
  for (const name of readdirSync(dir).filter(file => file.endsWith('.json'))) {
    const record = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
    if (record.kind !== 'browser-research-quote') continue;
    const methodStep = (record.steps ?? []).find(step => step.ok && /selected: .*שליחות|clicked: משלוח עד הבית/.test(step.detail ?? ''));
    if (!methodStep) continue;
    checked += 1;
    assert.equal(record.service, 'home_delivery', `${name} records the method its shipping line belongs to`);
    assert.equal(record.serviceConfirmed, true, `${name} marks the method confirmed by the page step`);
    assert.equal(validateEvidence(record).ok, true, `${name} still passes schema validation`);
  }
  assert.ok(checked >= 9, `expected at least nine method-confirmed checked-in records, found ${checked}`);
});

test('runRecipe marks a hard failure as blocked with the exact step', async () => {
  const driver = {
    goto: async () => { throw new Error('navigation timeout'); },
    gotoUnlessText: async () => 'navigated',
    clickText: async () => {},
    clickAnyText: async () => 'משלוח עד הבית',
    clickSelector: async () => 'a.slide_cart__btn-checkout',
    selectLabel: async () => {},
    fill: async (selector, value) => ({ selector, value }),
    setQuantity: async () => 1,
    waitText: async () => true,
    sleep: async () => {},
    getText: async () => '',
    currentUrl: async () => null
  };
  const record = await runRecipe({ recipe: RECIPES.pucks, driver, params: { grams: 500 } });
  assert.equal(record.status, 'blocked');
  assert.match(record.blocker, /Required step "goto" failed/);
  assert.equal(validateEvidence(record).ok, true);
});
