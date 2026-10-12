import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVIDENCE_SCHEMA_VERSION,
  RECIPES,
  expandSteps,
  sanitizeUrl,
  sanitizeExcerpt,
  parsePucksTotals,
  parseCoffeemanTotals,
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
  assert.equal(steps.find(step => step.action === 'selectLabel').label, 'תל אביב');
  assert.equal(steps.find(step => step.action === 'fill').value, '6100000');
  const method = steps.find(step => step.action === 'clickAnyText');
  assert.deepEqual(method.texts, ['משלוח עד הבית'], 'the recipe selects the actual delivery method');
  assert.equal(method.optional, false, 'a quote without a chosen method would not show the fee, so the step is required');
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

test('CoffeeMan totals parse without inventing a threshold', () => {
  const totals = parseCoffeemanTotals(COFFEEMAN);
  assert.equal(totals.itemSubtotalIls, 66);
  assert.equal(totals.shippingIls, 25);
  assert.equal(totals.deliveredTotalIls, 91);
  assert.equal(totals.freeThresholdIls, null, 'no free-shipping rule is inferred from one cart');
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
    fill: async () => { calls.push(['fill']); },
    setQuantity: async () => { calls.push(['setQuantity']); throw new Error('no quantity input found'); },
    waitText: async () => true,
    sleep: async () => {},
    getText: async () => PUCKS_500G,
    currentUrl: async () => 'https://pucks.co.il/payment/request'
  };
  const record = await runRecipe({ recipe: RECIPES.pucks, driver, params: { grams: 500, locality: 'תל אביב' }, now: Date.parse('2026-10-12T18:09:20Z') });
  // The two clickText steps and the cart-link click are optional, so the run
  // reaches the estimator and reads the totals after selecting home delivery.
  assert.equal(record.status, 'partial', 'a read quote without a verified cart quantity is partial, not quoted');
  assert.match(record.qualification, /quantity was not verified/);
  assert.ok(record.steps.some(step => step.step === 'clickText' && step.ok === false && step.optional === true));
  const methodStep = record.steps.find(step => step.step === 'clickAnyText');
  assert.equal(methodStep.ok, true);
  assert.match(methodStep.detail, /clicked: משלוח עד הבית/, 'the evidence records the method that was selected');
  assert.equal(record.itemSubtotalIls, 60);
  assert.equal(record.shippingIls, 30);
  assert.equal(validateEvidence(record).ok, true);
});

test('a run blocks when the required delivery method cannot be selected', async () => {
  const driver = {
    goto: async () => {},
    gotoUnlessText: async () => 'navigated',
    clickText: async () => {},
    clickAnyText: async () => { throw new Error('no clickable element matched any of ["משלוח עד הבית"]'); },
    clickSelector: async () => 'a.slide_cart__btn-checkout',
    selectLabel: async () => {},
    fill: async () => {},
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

test('runRecipe marks a hard failure as blocked with the exact step', async () => {
  const driver = {
    goto: async () => { throw new Error('navigation timeout'); },
    gotoUnlessText: async () => 'navigated',
    clickText: async () => {},
    clickAnyText: async () => 'משלוח עד הבית',
    clickSelector: async () => 'a.slide_cart__btn-checkout',
    selectLabel: async () => {},
    fill: async () => {},
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
