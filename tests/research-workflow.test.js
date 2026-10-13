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
  runRecipe,
  matchCartIdentity
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
  assert.deepEqual(list.map(item => item.id).sort(), ['coffee4u', 'coffeeman', 'coffeeman-4pack', 'coffeeman-8pack', 'pucks']);
  for (const recipe of list) {
    assert.ok(recipe.productUrl.startsWith('https://'), recipe.id);
    assert.ok(recipe.cartUrl.startsWith('https://'), recipe.id);
    assert.ok([250, 1000, 2000].includes(recipe.packGrams), recipe.id);
    assert.ok(recipe.steps >= 5, `${recipe.id} has a cart/estimator navigation`);
  }
  // The 4-pack recipe must target the 4 × 250 g listing, not the single pack.
  assert.match(RECIPES['coffeeman-4pack'].productUrl, /4-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA/);
  assert.equal(RECIPES['coffeeman-4pack'].packGrams, 1000);
  // The 8-pack recipe must target the 8 × 250 g listing, where one cart unit is
  // the whole 2000 g multipack (the ₪20 quote's observed cart).
  assert.match(RECIPES['coffeeman-8pack'].productUrl, /8-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA/);
  assert.equal(RECIPES['coffeeman-8pack'].packGrams, 2000);
  assert.equal(RECIPES['coffeeman-8pack'].sku, '930335');
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

// The real rendered checkout text captured by the reusable CoffeeMan recipe on
// 2026-10-13 for the 8 × 250 g cart: the automatic 10% promotion is applied
// (₪-26.40), the checkout omits the applied shipping row, and both rendered
// method options display ₪0. The footer disclaimer also contains the word
// "הנחה" without an amount, so the discount reader must not treat it as one.
const COFFEEMAN_8_SINGLES_FREE = `עגלת הקניות
8
מוצרים בעגלה
חסר לך עוד ₪ 226.00 לקבלת ספלי legend אספרסו עם לוגו Miscela D’Oro
250 גרם קפה טחון lavazza Crema e Gusto Classico חוזק 7
₪ 264.00
+-
מבצע מיכל ואקום שקוף חשמלי לאיחסון קפה חל על מוצר זה
בכל קנייה באתר של קפה, קפסולות ואביזרים מעל 990 ש"ח קבל מיכל ואקום שקוף חשמלי לאיחסון קפה בשווי של 299 ש"ח , מתנה !
מבצע כל הקפה טחון ב-10% הנחה.-
₪ -26.40
פרטי תשלום כולל משלוח
*בחר שיטת משלוח
משלוח לבית הלקוח עם שליח - 0 ₪
משלוח ממרכז חלוקה עד 5 ק"ג - 0 ₪
סכום כולל מע"מ
₪237.60
משלוחים מהירים עד
באתר החברה ניתנת לעיתים הנחה למחיר הקטלוגי. הנחה זו אינה מבצע.
מעקב משלוחים`;

function freeCartDriver(text, locality = 'תל אביב - יפו') {
  return {
    goto: async () => 'navigated',
    gotoUnlessText: async () => 'navigated',
    clickText: async () => 'clicked',
    clickAnyText: async () => 'קנה עכשיו',
    clickSelector: async () => 'a',
    selectLabel: async (selector, label) => (selector === '#delivery' ? 'משלוח לבית הלקוח עם שליח - 0 ₪' : label),
    fill: async (selector, value) => ({ selector, value }),
    setQuantity: async () => 8,
    waitText: async () => true,
    sleep: async () => {},
    readValue: async selector => (selector === '#hfd_cities' ? locality : null),
    readSelectedLabel: async selector => (selector === '#hfd_cities' ? locality : null),
    // The rendered cart row for the tracked single listing: its own link carries
    // pid=930333 and its wording states the 250 g pack; quantity 8 is the
    // whole-pack cart size the run set.
    readCartLines: async () => [singleCartLine()],
    getText: async () => text,
    currentUrl: async () => 'https://www.coffeeman.co.il/checkout.asp'
  };
}

/** One rendered CoffeeMan cart row for the tracked single 250 g listing. */
function singleCartLine(overrides = {}) {
  return {
    selector: 'ul.cart_items_ul > li',
    text: '250 גרם קפה טחון lavazza Crema e Gusto Classico חוזק 7',
    links: ['https://www.coffeeman.co.il/product.asp?cat2cat1id=106&Cat2ID=280&pid=930333'],
    quantity: 8,
    attrs: {},
    ...overrides
  };
}

/** One rendered CoffeeMan cart row for the tracked 8 × 250 g multipack. */
function eightPackCartLine(overrides = {}) {
  return {
    selector: 'ul.cart_items_ul > li',
    text: '8 אריזות 250 גרם קפה טחון lavazza Crema e Gusto Classico',
    links: ['https://www.coffeeman.co.il/product.asp?cat2cat1id=106&Cat2ID=280&pid=930335'],
    quantity: 1,
    attrs: {},
    ...overrides
  };
}

test('CoffeeMan free-cart text distinguishes the pre-discount subtotal, the applied discount and the paid total', () => {
  const totals = parseCoffeemanTotals(COFFEEMAN_8_SINGLES_FREE);
  assert.equal(totals.itemSubtotalBeforeDiscountIls, 264);
  assert.equal(totals.itemSubtotalIls, 264, 'the displayed item subtotal is the pre-discount amount');
  assert.equal(totals.discountIls, -26.4);
  assert.equal(totals.discountPercent, 10);
  assert.match(totals.discountLabel, /10% הנחה/);
  assert.equal(totals.discountAmbiguous, false);
  assert.equal(totals.paidItemTotalIls, 237.6);
  assert.equal(totals.shippingIls, null, 'an omitted applied shipping row is never invented as free by the parser');
  assert.equal(totals.deliveredTotalIls, 237.6);
  assert.deepEqual(totals.methodOptions.map(option => option.amountIls), [0, 0], 'both rendered method options show zero for this cart');
});

test('the recipe records a schema-valid free quote when the omitted row is independently evidenced', async () => {
  const record = await runRecipe({
    recipe: RECIPES.coffeeman,
    driver: freeCartDriver(COFFEEMAN_8_SINGLES_FREE),
    params: { grams: 2000, locality: 'תל אביב - יפו' },
    now: Date.parse('2026-10-13T09:30:00Z')
  });
  assert.equal(record.status, 'quoted');
  assert.equal(record.schemaVersion, EVIDENCE_SCHEMA_VERSION);
  assert.equal(record.sku, '930333');
  // The observed side is the rendered cart line, not a copy of the declared SKU.
  assert.equal(record.cartIdentityVerified, true);
  assert.equal(record.cartIdentitySource, 'rendered-cart-line');
  assert.equal(record.expectedCartIdentity.sku, '930333');
  assert.equal(record.expectedCartIdentity.listingPacks, 1);
  assert.equal(record.expectedCartIdentity.packGrams, 250);
  assert.equal(record.observedCartIdentity.sku, '930333');
  assert.equal(record.observedCartIdentity.listingPacks, 1);
  assert.equal(record.observedCartIdentity.packGrams, 250);
  assert.equal(record.observedCartIdentity.quantity, 8);
  assert.match(record.observedCartIdentity.lineText, /250 גרם/);
  assert.equal(record.cartIdentityNote, null);
  assert.equal(record.itemSubtotalBeforeDiscountIls, 264);
  assert.equal(record.discountIls, -26.4);
  assert.equal(record.discountPercent, 10);
  assert.equal(record.paidItemTotalIls, 237.6);
  assert.equal(record.shippingIls, 0);
  assert.equal(record.shippingLabel, 'free');
  assert.equal(record.shippingEvidenceSource, 'selected-method-option');
  assert.match(record.shippingEvidenceNote, /omitted the applied shipping row/);
  assert.equal(record.deliveredTotalIls, 237.6);
  assert.equal(record.serviceLabel, 'משלוח לבית הלקוח עם שליח - 0 ₪');
  assert.equal(record.serviceConfirmed, true);
  assert.equal(record.destinationVerified, true);
  assert.equal(record.observedPacks, 8);
  assert.equal(record.arithmeticOk, true);
  assert.deepEqual(validateEvidence(record), { ok: true, errors: [] });
  assert.ok(record.steps.some(step => step.step === 'selectLabel' && /selected: .*0 ₪/.test(step.detail ?? '')), 'the method-selection step keeps its displayed zero rate');
  assert.ok(record.moneyLines.some(line => /-26\.40/.test(line)), 'the applied discount line is kept as sanitized evidence');
});

test('the cart identity matcher verifies the rendered listing, never the declared SKU', () => {
  const verified = matchCartIdentity({ recipe: RECIPES.coffeeman, lines: [singleCartLine()] });
  assert.equal(verified.verified, true);
  assert.equal(verified.source, 'rendered-cart-line');
  assert.equal(verified.observed.sku, '930333');
  assert.equal(verified.observed.quantity, 8);
  assert.deepEqual(verified.reasons, []);

  // Duplicate renders of the same row (desktop/mobile copies) are one line.
  const duplicates = matchCartIdentity({ recipe: RECIPES.coffeeman, lines: [singleCartLine(), singleCartLine(), singleCartLine()] });
  assert.equal(duplicates.verified, true, 'identical rendered copies must not read as a mixed cart');

  // Another multipack is not the tracked single listing, even before money.
  const multipack = matchCartIdentity({ recipe: RECIPES.coffeeman, lines: [eightPackCartLine({ quantity: 8 })] });
  assert.equal(multipack.verified, false);
  assert.ok(multipack.reasons.some(reason => /listing 930335, not the tracked 930333/.test(reason)));
  assert.ok(multipack.reasons.some(reason => /8 × 250 g/.test(reason)));
  assert.equal(multipack.observed, null, 'a mismatch never records an observed match');

  // The same SKU rendered with multipack wording is still another pack identity.
  const sameSkuMultipack = matchCartIdentity({ recipe: RECIPES.coffeeman, lines: [singleCartLine({ text: '8 אריזות 250 גרם קפה טחון lavazza Crema e Gusto Classico' })] });
  assert.equal(sameSkuMultipack.verified, false);
  assert.ok(sameSkuMultipack.reasons.some(reason => /not the tracked 1 × 250 g listing/.test(reason)));

  // Mixed cart lines stay unverified and record no observed identity.
  const mixed = matchCartIdentity({ recipe: RECIPES.coffeeman, lines: [singleCartLine(), eightPackCartLine()] });
  assert.equal(mixed.verified, false);
  assert.ok(mixed.reasons.some(reason => /distinct rendered lines/.test(reason)));
  assert.equal(mixed.observed, null);

  // A line with no rendered SKU or no pack wording is ambiguous, not a match.
  const noSku = matchCartIdentity({ recipe: RECIPES.coffeeman, lines: [singleCartLine({ links: ['https://www.coffeeman.co.il/product.asp?cat2id=280'] })] });
  assert.equal(noSku.verified, false);
  assert.ok(noSku.reasons.some(reason => /unambiguous listing SKU/.test(reason)));
  const noPack = matchCartIdentity({ recipe: RECIPES.coffeeman, lines: [singleCartLine({ text: 'קפה טחון lavazza Crema e Gusto Classico חוזק 7' })] });
  assert.equal(noPack.verified, false);
  assert.ok(noPack.reasons.some(reason => /pack identity/.test(reason)));

  // No rendered line at all and no declared SKU are both unverified.
  const empty = matchCartIdentity({ recipe: RECIPES.coffeeman, lines: [] });
  assert.equal(empty.verified, false);
  assert.ok(empty.reasons.some(reason => /no rendered cart line/.test(reason)));
  const declaredOnly = matchCartIdentity({ recipe: { ...RECIPES.coffeeman, sku: null }, lines: [singleCartLine()] });
  assert.equal(declaredOnly.verified, false);
  assert.ok(declaredOnly.reasons.some(reason => /does not declare a tracked listing SKU/.test(reason)));
});

test('the 8-pack recipe verifies its own multipack line and rejects the single line', () => {
  const verified = matchCartIdentity({ recipe: RECIPES['coffeeman-8pack'], lines: [eightPackCartLine()] });
  assert.equal(verified.verified, true);
  assert.equal(verified.observed.listingPacks, 8);
  assert.equal(verified.observed.packGrams, 250);
  const wrong = matchCartIdentity({ recipe: RECIPES['coffeeman-8pack'], lines: [singleCartLine({ quantity: 1 })] });
  assert.equal(wrong.verified, false);
  assert.ok(wrong.reasons.some(reason => /not the tracked 8 × 250 g listing/.test(reason)));
});

test('a run whose rendered cart line is another listing is blocked, never quoted', async () => {
  const driver = {
    ...freeCartDriver(COFFEEMAN_8_SINGLES_FREE),
    readCartLines: async () => [eightPackCartLine({ quantity: 8 })]
  };
  const record = await runRecipe({ recipe: RECIPES.coffeeman, driver, params: { grams: 2000, locality: 'תל אביב - יפו' } });
  assert.equal(record.status, 'blocked');
  assert.equal(record.shippingIls, null, 'a different listing must not take the omitted-row zero');
  assert.equal(record.shippingEvidenceSource, null);
  assert.equal(record.cartIdentityVerified, false);
  assert.equal(record.observedCartIdentity, null);
  assert.match(record.blocker, /Cart identity check failed/);
  assert.ok(record.steps.some(step => step.step === 'readCartLines' && step.ok === true), 'the identity read is recorded as a step');
  assert.equal(validateEvidence(record).ok, true);
});

test('a cart line whose quantity disagrees with the recipe step stays blocked', async () => {
  const driver = {
    ...freeCartDriver(COFFEEMAN_8_SINGLES_FREE),
    readCartLines: async () => [singleCartLine({ quantity: 7 })]
  };
  const record = await runRecipe({ recipe: RECIPES.coffeeman, driver, params: { grams: 2000, locality: 'תל אביב - יפו' } });
  assert.equal(record.status, 'blocked');
  assert.equal(record.cartIdentityVerified, false);
  assert.match(record.cartIdentityNote, /holds 7 pack\(s\), not the 8/);
  assert.equal(validateEvidence(record).ok, true);
});

test('a mismatched rendered identity also blocks an applied-line quote', () => {
  const record = buildEvidenceRecord({
    recipe: RECIPES.coffeeman,
    params: { grams: 2000, locality: 'תל אביב - יפו' },
    status: 'quoted',
    totals: parseCoffeemanTotals(COFFEEMAN),
    cartIdentity: matchCartIdentity({ recipe: RECIPES.coffeeman, lines: [eightPackCartLine({ quantity: 8 })] }),
    now: Date.parse('2026-10-13T09:30:00Z')
  });
  assert.equal(record.status, 'blocked', 'a different listing cannot be published as the tracked listing quote');
  assert.match(record.blocker, /Cart identity check failed/);
  assert.equal(validateEvidence(record).ok, true);
});

test('the checked-in 8-single free-cart records keep the discount and method evidence', () => {
  // The 2026-10-13 live recipe runs for the exact 8 × 250 g cart at two named
  // destinations are the reusable evidence that replaced the historical blocked
  // record. They must stay schema-valid quoted records with the displayed
  // pre-discount subtotal, the applied 10% discount, the confirmed selected
  // method at ₪0 and the verified destination, so the omitted shipping row is
  // only ever read as free with all of that independent evidence present.
  const dir = new URL('../docs/evidence/browser-research/', import.meta.url);
  const names = [
    '2026-10-13-coffeeman-free-8singles-telaviv-recipe.json',
    '2026-10-13-coffeeman-free-8singles-eilat-recipe.json'
  ];
  const localities = new Set();
  for (const name of names) {
    const record = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
    const validation = validateEvidence(record);
    assert.equal(validation.ok, true, `${name}: ${JSON.stringify(validation.errors)}`);
    assert.equal(record.schemaVersion, 2, name);
    assert.equal(record.status, 'quoted', name);
    assert.equal(record.sku, '930333', name);
    assert.equal(record.observedPacks, 8, name);
    assert.equal(record.itemSubtotalBeforeDiscountIls, 264, name);
    assert.equal(record.discountIls, -26.4, name);
    assert.equal(record.discountPercent, 10, name);
    assert.equal(record.paidItemTotalIls, 237.6, name);
    assert.equal(record.shippingIls, 0, name);
    assert.equal(record.shippingEvidenceSource, 'selected-method-option', name);
    assert.equal(record.deliveredTotalIls, 237.6, name);
    assert.equal(record.service, 'home_delivery', name);
    assert.equal(record.serviceConfirmed, true, name);
    assert.equal(record.destinationVerified, true, name);
    assert.match(record.serviceLabel, /0 ₪/, name);
    assert.ok(record.locality, name);
    localities.add(record.locality);
    assert.ok(record.steps.some(step => step.ok && /selected: .*0 ₪/.test(step.detail ?? '')), `${name}: method-selection step`);
    assert.ok(record.moneyLines.some(line => /-26\.40/.test(line)), `${name}: applied discount line`);
    assert.ok((record.methodOptions ?? []).some(option => option.amountIls === 0), `${name}: rendered method option at zero`);
  }
  assert.equal(localities.size, 2, 'the fresh records cover two sampled named destinations');

  // The old limitation stays visible as historical evidence instead of being
  // rewritten: the manual coverage session recorded the omitted shipping row.
  const historical = JSON.parse(readFileSync(new URL('2026-10-13-coffeeman-free-cart-destination-recheck.json', dir), 'utf8'));
  assert.equal(historical.kind, 'browser-research-coverage');
  assert.equal(historical.renderedSummary?.appliedShippingLine, null);
  assert.equal(historical.renderedSummary?.totalLine, '₪237.60');
});

test('the checked-in 8-pack recipe records reproduce the ₪20 quote at two destinations', () => {
  // The 8 × 250 g multipack recipe (SKU 930335, one cart unit = 2000 g) makes
  // the distinct ₪20 cart quote re-checkable per destination through the same
  // reusable workflow, instead of an ad-hoc session.
  const dir = new URL('../docs/evidence/browser-research/', import.meta.url);
  const names = [
    '2026-10-13-coffeeman-8pack-recipe-telaviv.json',
    '2026-10-13-coffeeman-8pack-recipe-eilat.json'
  ];
  const localities = new Set();
  for (const name of names) {
    const record = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
    const validation = validateEvidence(record);
    assert.equal(validation.ok, true, `${name}: ${JSON.stringify(validation.errors)}`);
    assert.equal(record.status, 'quoted', name);
    assert.equal(record.sku, '930335', name);
    assert.equal(record.pack, '1 × 2000 g = 2000 g', name);
    assert.equal(record.observedPacks, 1, name);
    assert.equal(record.destinationVerified, true, name);
    assert.equal(record.service, 'home_delivery', name);
    assert.equal(record.serviceConfirmed, true, name);
    assert.equal(record.itemSubtotalBeforeDiscountIls, 240, name);
    assert.equal(record.shippingIls, 20, name);
    assert.equal(record.shippingEvidenceSource, 'applied-line', name);
    assert.equal(record.deliveredTotalIls, 260, name);
    assert.equal(record.arithmeticOk, true, name);
    assert.match(record.serviceLabel, /20\.00 ₪/, name);
    assert.ok(record.steps.some(step => step.ok && /1 pack\(s\) in cart/.test(step.detail ?? '')), `${name}: whole-pack quantity step`);
    localities.add(record.locality);
  }
  assert.equal(localities.size, 2, 'the 8-pack recipe re-check covers two named destinations');
});

test('the checked-in two-4-pack free-condition records carry destination evidence', () => {
  // The `fourpack-2` free condition was originally observed without a locality;
  // the checked-in 4-pack recipe re-checks the exact 2 × 4-pack cart per
  // destination, so the condition keeps destination-verified evidence.
  const dir = new URL('../docs/evidence/browser-research/', import.meta.url);
  const names = [
    '2026-10-13-coffeeman-4pack-recipe-telaviv.json',
    '2026-10-13-coffeeman-4pack-recipe-eilat.json'
  ];
  const localities = new Set();
  for (const name of names) {
    const record = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
    const validation = validateEvidence(record);
    assert.equal(validation.ok, true, `${name}: ${JSON.stringify(validation.errors)}`);
    assert.equal(record.status, 'quoted', name);
    assert.equal(record.sku, '930334', name);
    assert.equal(record.pack, '2 × 1000 g = 2000 g', name);
    assert.equal(record.observedPacks, 2, name);
    assert.equal(record.destinationVerified, true, name);
    assert.equal(record.service, 'home_delivery', name);
    assert.equal(record.serviceConfirmed, true, name);
    assert.match(record.serviceLabel, /0 ₪/, name);
    assert.equal(record.itemSubtotalBeforeDiscountIls, 248, name);
    assert.equal(record.discountIls, 0, name);
    assert.equal(record.paidItemTotalIls, 248, name);
    assert.equal(record.shippingIls, 0, name);
    assert.equal(record.shippingEvidenceSource, 'selected-method-option', name);
    assert.equal(record.deliveredTotalIls, 248, name);
    assert.equal(record.arithmeticOk, true, name);
    assert.ok(record.steps.some(step => step.ok && /2 pack\(s\) in cart/.test(step.detail ?? '')), `${name}: whole-pack quantity step`);
    localities.add(record.locality);
  }
  assert.equal(localities.size, 2, 'the 4-pack free-condition re-check covers two named destinations');
});

test('the checked-in seven-single free-condition records carry destination evidence', () => {
  // The `singles-7` free condition (₪231) was also observed without a locality;
  // the checked-in single-pack recipe at 1750 g re-checks it per destination.
  const dir = new URL('../docs/evidence/browser-research/', import.meta.url);
  const names = [
    '2026-10-13-coffeeman-7singles-recipe-telaviv.json',
    '2026-10-13-coffeeman-7singles-recipe-eilat.json'
  ];
  const localities = new Set();
  for (const name of names) {
    const record = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
    const validation = validateEvidence(record);
    assert.equal(validation.ok, true, `${name}: ${JSON.stringify(validation.errors)}`);
    assert.equal(record.status, 'quoted', name);
    assert.equal(record.sku, '930333', name);
    assert.equal(record.pack, '7 × 250 g = 1750 g', name);
    assert.equal(record.observedPacks, 7, name);
    assert.equal(record.destinationVerified, true, name);
    assert.equal(record.service, 'home_delivery', name);
    assert.equal(record.serviceConfirmed, true, name);
    assert.match(record.serviceLabel, /0 ₪/, name);
    assert.equal(record.itemSubtotalBeforeDiscountIls, 231, name);
    assert.equal(record.discountIls, 0, name);
    assert.equal(record.paidItemTotalIls, 231, name);
    assert.equal(record.shippingIls, 0, name);
    assert.equal(record.shippingEvidenceSource, 'selected-method-option', name);
    assert.equal(record.deliveredTotalIls, 231, name);
    assert.equal(record.arithmeticOk, true, name);
    assert.ok(record.steps.some(step => step.ok && /7 pack\(s\) in cart/.test(step.detail ?? '')), `${name}: whole-pack quantity step`);
    localities.add(record.locality);
  }
  assert.equal(localities.size, 2, 'the 7-single free-condition re-check covers two named destinations');
});

test('an omitted shipping row without the independent evidence stays blocked, never free', async () => {
  // The selected option is displayed at ₪25 while the applied summary row is
  // missing: the omitted row must not become free from a different option price.
  const paidLabelDriver = {
    ...freeCartDriver(COFFEEMAN_8_SINGLES_FREE),
    selectLabel: async (selector, label) => (selector === '#delivery' ? 'משלוח לבית הלקוח עם שליח - 25.00 ₪' : label)
  };
  const paidLabel = await runRecipe({ recipe: RECIPES.coffeeman, driver: paidLabelDriver, params: { grams: 2000, locality: 'תל אביב - יפו' } });
  assert.equal(paidLabel.status, 'blocked');
  assert.equal(paidLabel.shippingIls, null);
  assert.equal(paidLabel.shippingEvidenceSource, null);
  assert.match(paidLabel.blocker, /not displayed at zero/);
  assert.equal(validateEvidence(paidLabel).ok, true);

  // A method step that cannot confirm any method leaves the omitted row unknown.
  const noMethodDriver = {
    ...freeCartDriver(COFFEEMAN_8_SINGLES_FREE),
    selectLabel: async (selector, label) => {
      if (selector === '#delivery') throw new Error('selectLabel: no option matches משלוח לבית הלקוח');
      return label;
    }
  };
  const noMethod = await runRecipe({ recipe: RECIPES.coffeeman, driver: noMethodDriver, params: { grams: 2000, locality: 'תל אביב - יפו' } });
  assert.equal(noMethod.status, 'blocked');
  assert.equal(noMethod.shippingIls, null);
  assert.equal(noMethod.serviceConfirmed, false);
  assert.match(noMethod.blocker, /Required step "selectLabel" failed/);
  assert.equal(validateEvidence(noMethod).ok, true);
});

test('the runner re-verifies the destination before reading the totals and blocks when it was reset', async () => {
  // CoffeeMan's quantity change re-renders the checkout form and can clear the
  // locality select after the selection step appeared to succeed. The record
  // must not attribute the quote to a destination that no longer holds.
  const resetDriver = {
    ...freeCartDriver(COFFEEMAN_8_SINGLES_FREE),
    readSelectedLabel: async () => 'בחר עיר'
  };
  const record = await runRecipe({
    recipe: RECIPES.coffeeman,
    driver: resetDriver,
    params: { grams: 2000, locality: 'תל אביב - יפו' }
  });
  assert.equal(record.status, 'blocked', 'a reset destination must block the quote');
  assert.equal(record.destinationVerified, false);
  assert.match(record.blocker, /reset before the totals were read/);
  assert.ok(record.steps.some(step => step.step === 'selectLabel:recheck' && step.ok === false), 'the failed re-check is recorded');
  assert.equal(validateEvidence(record).ok, true);

  // The same driver with the destination still holding records the quote.
  const held = await runRecipe({
    recipe: RECIPES.coffeeman,
    driver: freeCartDriver(COFFEEMAN_8_SINGLES_FREE),
    params: { grams: 2000, locality: 'תל אביב - יפו' }
  });
  assert.equal(held.status, 'quoted');
  assert.equal(held.destinationVerified, true);
});

test('the omitted-row decision rejects each missing piece of independent evidence', () => {
  const base = {
    recipe: RECIPES.coffeeman,
    params: { grams: 2000, locality: 'תל אביב - יפו' },
    status: 'quoted',
    totals: parseCoffeemanTotals(COFFEEMAN_8_SINGLES_FREE),
    service: 'home_delivery',
    serviceConfirmed: true,
    serviceLabel: 'משלוח לבית הלקוח עם שליח - 0 ₪',
    destinationVerified: true,
    actualPacks: 8,
    cartIdentity: matchCartIdentity({ recipe: RECIPES.coffeeman, lines: [singleCartLine()] }),
    now: Date.parse('2026-10-13T09:30:00Z')
  };
  const accepted = buildEvidenceRecord(base);
  assert.equal(accepted.status, 'quoted');
  assert.equal(accepted.shippingIls, 0);
  assert.equal(accepted.cartIdentityVerified, true);

  const cases = [
    ['unverified destination', { destinationVerified: false }, /destination was not verified/],
    ['unconfirmed method', { serviceConfirmed: false, service: null, serviceLabel: null }, /not confirmed/],
    ['wrong whole-pack quantity', { actualPacks: 7 }, /not the requested 8/],
    ['non-zero selected option', { serviceLabel: 'משלוח לבית הלקוח עם שליח - 25.00 ₪' }, /not displayed at zero/],
    ['unselected option price', { totals: { ...base.totals, methodOptions: [{ label: 'משלוח לבית הלקוח עם שליח - 25.00 ₪', amountIls: 25 }] } }, /method list did not show the selected method at zero/],
    ['ambiguous promotion', { totals: { ...base.totals, discountIls: null, discountPercent: null, paidItemTotalIls: null, discountAmbiguous: true } }, /promotion could not be read/],
    ['incomplete charges', { totals: { ...base.totals, deliveredTotalIls: 264 } }, /final total is not consistent/],
    ['missing SKU', { recipe: { ...RECIPES.coffeeman, sku: null } }, /SKU was not recorded/],
    ['missing rendered identity', { cartIdentity: null }, /rendered cart line identity was not verified/],
    ['mismatched rendered identity', { cartIdentity: matchCartIdentity({ recipe: RECIPES.coffeeman, lines: [eightPackCartLine({ quantity: 8 })] }) }, /Cart identity check failed/]
  ];
  for (const [name, overrides, expected] of cases) {
    const record = buildEvidenceRecord({ ...base, ...overrides });
    assert.equal(record.status, 'blocked', `${name} must stay blocked`);
    assert.equal(record.shippingIls, null, `${name} must not become free shipping`);
    assert.equal(record.shippingEvidenceSource, null, `${name} must not claim a shipping evidence source`);
    assert.match(record.blocker, expected, name);
    assert.equal(validateEvidence(record).ok, true, `${name} blocked record must validate`);
  }
});

test('schema version 3 rejects a selected-method-option record that drops required identity evidence', () => {
  const record = buildEvidenceRecord({
    recipe: RECIPES.coffeeman,
    params: { grams: 2000, locality: 'תל אביב - יפו' },
    status: 'quoted',
    totals: parseCoffeemanTotals(COFFEEMAN_8_SINGLES_FREE),
    service: 'home_delivery',
    serviceConfirmed: true,
    serviceLabel: 'משלוח לבית הלקוח עם שליח - 0 ₪',
    destinationVerified: true,
    actualPacks: 8,
    cartIdentity: matchCartIdentity({ recipe: RECIPES.coffeeman, lines: [singleCartLine()] }),
    now: Date.parse('2026-10-13T09:30:00Z')
  });
  assert.equal(record.schemaVersion, 3);
  assert.equal(validateEvidence(record).ok, true);
  for (const key of ['shippingEvidenceNote', 'sku', 'observedPacks', 'serviceLabel', 'discountIls', 'cartIdentityVerified', 'cartIdentitySource', 'observedCartIdentity']) {
    assert.equal(validateEvidence({ ...record, [key]: null }).ok, false, `dropping ${key} must fail validation`);
  }
  assert.equal(validateEvidence({ ...record, shippingIls: 5 }).ok, false, 'a selected-method-option zero cannot carry a charge');
  assert.equal(validateEvidence({ ...record, arithmeticOk: false }).ok, false);
  assert.equal(validateEvidence({ ...record, cartIdentityVerified: false }).ok, false, 'a selected-method-option zero needs a verified identity');
  assert.equal(validateEvidence({ ...record, observedCartIdentity: { ...record.observedCartIdentity, sku: '930335' } }).ok, false, 'the observed SKU must match the declared listing');
  assert.equal(validateEvidence({ ...record, observedCartIdentity: { ...record.observedCartIdentity, listingPacks: 8 } }).ok, false, 'the observed pack count must match the expected listing');
  assert.equal(validateEvidence({ ...record, expectedCartIdentity: { ...record.expectedCartIdentity, unitGrams: 1000 } }).ok, false, 'the observed pack identity must match the expected cart unit');
});

test('version-1 and version-2 records stay valid historical evidence without observed identity', () => {
  const legacy = {
    kind: 'browser-research-quote',
    schemaVersion: 1,
    vendorId: 'coffeeman',
    vendorName: 'CoffeeMan (Amigo)',
    status: 'blocked',
    observedAt: '2026-10-13T08:48:00.000Z',
    blocker: 'The rendered flow did not display a shipping line for this quantity and destination.'
  };
  assert.deepEqual(validateEvidence(legacy), { ok: true, errors: [] });
  assert.equal(validateEvidence({ ...legacy, schemaVersion: 4 }).ok, false);

  // A version-2 free record is preserved as the historical evidence of what was
  // observed then: it keeps validating under the version-2 rules and is never
  // relabelled with an observed cart identity it does not contain.
  const v2 = {
    ...legacy,
    schemaVersion: 2,
    status: 'quoted',
    itemSubtotalIls: 264,
    shippingIls: 0,
    deliveredTotalIls: 237.6,
    arithmeticOk: true,
    locality: 'תל אביב - יפו',
    itemSubtotalBeforeDiscountIls: 264,
    discountIls: -26.4,
    paidItemTotalIls: 237.6,
    shippingEvidenceSource: 'selected-method-option',
    service: 'home_delivery',
    serviceConfirmed: true,
    serviceLabel: 'משלוח לבית הלקוח עם שליח - 0 ₪',
    destinationVerified: true,
    observedPacks: 8,
    sku: '930333',
    shippingEvidenceNote: 'The checkout omitted the applied shipping row.',
    blocker: null
  };
  assert.deepEqual(validateEvidence(v2), { ok: true, errors: [] }, 'the version-2 rules still apply to historical records');
  assert.equal(v2.observedCartIdentity, undefined, 'historical records are not retroactively labelled as observed');
});
