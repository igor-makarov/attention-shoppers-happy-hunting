import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  areaCoversTelAviv,
  areaLocalities,
  isIsraeliRetailer,
  isTestRetailer,
  parseRetailerConfig,
  summarizeSweep,
  telAvivDeliveryAreas
} from '../scripts/telaviv-platform-sweep.mjs';

function rawConfig(overrides = {}) {
  const retailer = {
    id: 1062,
    name: 'Tiv Taam style store',
    title: 'חנות מכולת',
    domain: 'www.realgrocer.co.il',
    countryIso: 'IL',
    settings: { minimumOrderPrice: '300' },
    branches: [
      {
        id: 924,
        name: 'online',
        city: 'תל אביב יפו',
        isOnline: true,
        areas: [
          { id: 2446, name: 'ת"א צפון', deliveryTypeId: 1, deliveryMinimumCost: null, retailerBranchProductDeliveryPrice: 29.9 },
          { id: 2193, name: 'איסוף מיוחד', deliveryTypeId: 2, deliveryMinimumCost: 600, retailerBranchProductDeliveryPrice: 0 }
        ]
      }
    ],
    ...overrides
  };
  return `window.sp = {\n    frontendData: ${JSON.stringify({ rid: retailer.id, retailer })}\n};\n`;
}

describe('platform retailer config parsing', () => {
  test('reads the published site minimum, online branches and delivery areas', () => {
    const config = parseRetailerConfig(rawConfig(), { retailerId: 1062 });
    assert.equal(config.minimumOrderPrice, 300);
    assert.equal(config.countryIso, 'IL');
    assert.equal(config.branches.length, 1);
    assert.equal(config.branches[0].isOnline, true);
    assert.equal(config.branches[0].areas.length, 2);
    assert.equal(isIsraeliRetailer(config), true);
  });

  test('ignores a config body that carries no frontend data', () => {
    assert.equal(parseRetailerConfig('<html>nope</html>', { retailerId: 1 }), null);
  });

  test('a non-Israeli retailer is excluded from the sweep summary', () => {
    const config = parseRetailerConfig(rawConfig({ countryIso: 'US' }), { retailerId: 1 });
    assert.equal(isIsraeliRetailer(config), false);
    assert.equal(summarizeSweep([config]).israeliRetailers, 0);
  });
});

describe(' Tel Aviv–Yafo area classification', () => {
  test('splits union area names into their named localities', () => {
    assert.deepEqual(areaLocalities('פתח תקווה, רמת גן, בני ברק, תל אביב'), ['פתח תקווה', 'רמת גן', 'בני ברק', 'תל אביב']);
  });

  test('recognises Tel Aviv–Yafo coverage, including union areas and the short form', () => {
    assert.equal(areaCoversTelAviv('תל אביב'), true);
    assert.equal(areaCoversTelAviv('ת"א צפון'), true);
    assert.equal(areaCoversTelAviv('צפון תל אביב'), true);
    assert.equal(areaCoversTelAviv('פתח תקווה, רמת גן, בני ברק, תל אביב'), true);
    assert.equal(areaCoversTelAviv('ירושלים'), false);
    assert.equal(areaCoversTelAviv('רמת גן וגבעתיים'), false);
    assert.equal(areaCoversTelAviv(''), false);
  });

  test('only home-delivery areas count; pickup and scan-and-go stay out', () => {
    const config = parseRetailerConfig(rawConfig(), { retailerId: 1062 });
    const areas = telAvivDeliveryAreas(config);
    assert.equal(areas.length, 1);
    assert.equal(areas[0].areaId, 2446);
    assert.equal(areas[0].areaName, 'ת"א צפון');
    assert.equal(areas[0].deliveryPrice, 29.9);
  });

  test('the binding minimum is the area minimum when published, otherwise the site minimum', () => {
    const withAreaMinimum = parseRetailerConfig(rawConfig({
      settings: { minimumOrderPrice: '300' },
      branches: [{ id: 1, city: 'תל אביב', isOnline: true, areas: [{ id: 9, name: 'תל אביב', deliveryTypeId: 1, deliveryMinimumCost: 150, retailerBranchProductDeliveryPrice: 35 }] }]
    }), { retailerId: 1 });
    assert.equal(telAvivDeliveryAreas(withAreaMinimum)[0].bindingMinimum, 150);

    const withoutAreaMinimum = parseRetailerConfig(rawConfig({
      settings: { minimumOrderPrice: '300' },
      branches: [{ id: 1, city: 'תל אביב', isOnline: true, areas: [{ id: 9, name: 'תל אביב', deliveryTypeId: 1, deliveryMinimumCost: null, retailerBranchProductDeliveryPrice: 29.9 }] }]
    }), { retailerId: 1 });
    assert.equal(telAvivDeliveryAreas(withoutAreaMinimum)[0].bindingMinimum, 300);
  });
  test('a platform test retailer is recorded but never used for a conclusion', () => {
    const demo = parseRetailerConfig(rawConfig({
      id: 9876,
      name: 'demo-retailer',
      title: 'אתר טסט',
      domain: 'demo.sites.self-point.com',
      settings: {},
      branches: [{ id: 1, city: 'תל אביב', isOnline: true, areas: [{ id: 9, name: 'תל אביב', deliveryTypeId: 1, deliveryMinimumCost: null, retailerBranchProductDeliveryPrice: null }] }]
    }), { retailerId: 9876 });
    assert.equal(isTestRetailer(demo), true);
    const summary = summarizeSweep([demo]);
    assert.deepEqual(summary.excludedTestRetailers, ['demo-retailer']);
    assert.equal(summary.liveIsraeliRetailers, 0);
    assert.equal(summary.storesPublishingTelAvivDelivery, 0);
    assert.deepEqual(summary.storesThatCouldRankABatch, []);
  });

  test('a Tel Aviv area published from a non-Israeli branch is not Tel Aviv–Yafo delivery', () => {
    const foreign = parseRetailerConfig(rawConfig({
      id: 10,
      name: 'overseas store',
      settings: { minimumOrderPrice: '0' },
      branches: [{ id: 90, city: 'Cedarhurst', isOnline: true, areas: [{ id: 2762, name: 'תל אביב', deliveryTypeId: 1, deliveryMinimumCost: null, retailerBranchProductDeliveryPrice: null }] }]
    }), { retailerId: 10 });
    assert.equal(telAvivDeliveryAreas(foreign).length, 0);
    const summary = summarizeSweep([foreign]);
    assert.equal(summary.storesPublishingTelAvivDelivery, 0);
    assert.deepEqual(summary.storesWithNoPublishedTelAvivMinimum, []);
  });
});

describe('sweep summary', () => {
  const blocked = parseRetailerConfig(rawConfig(), { retailerId: 1062 }); // site minimum 300
  const lowMinimum = parseRetailerConfig(rawConfig({
    id: 1576,
    name: 'green corner',
    title: 'הפינה הירוקה',
    settings: {},
    branches: [{ id: 3459, city: 'רמת השרון', isOnline: true, areas: [{ id: 9936, name: 'צפון תל אביב', deliveryTypeId: 1, deliveryMinimumCost: null, retailerBranchProductDeliveryPrice: null }] }]
  }), { retailerId: 1576 });
  const tooHigh = parseRetailerConfig(rawConfig({
    id: 1449,
    name: '7to7',
    title: 'סופרמרקט 7to7',
    settings: {},
    branches: [{ id: 2230, city: 'תל אביב', isOnline: true, areas: [{ id: 5011, name: 'תל אביב', deliveryTypeId: 1, deliveryMinimumCost: 350, retailerBranchProductDeliveryPrice: 10 }] }]
  }), { retailerId: 1449 });
  const elsewhere = parseRetailerConfig(rawConfig({
    id: 1508,
    name: 'verona',
    title: 'ורונה בוטיק מרקט',
    settings: { minimumOrderPrice: '20' },
    branches: [{ id: 2647, city: 'כפר יאסיף', isOnline: true, areas: [{ id: 7011, name: 'כפר יאסיף', deliveryTypeId: 1, deliveryMinimumCost: null, retailerBranchProductDeliveryPrice: 20 }] }]
  }), { retailerId: 1508 });

  test('summarises coverage, the lowest published Tel Aviv minimum and any unblocked store', () => {
    const summary = summarizeSweep([blocked, lowMinimum, tooHigh, elsewhere]);
    assert.equal(summary.israeliRetailers, 4);
    assert.equal(summary.storesPublishingTelAvivDelivery, 3);
    assert.equal(summary.lowestPublishedTelAvivMinimum, 300);
    // A store whose Tel Aviv area publishes no minimum is a lead that still needs
    // a reachable product/cart interface; the sweep records it, it does not rank it.
    assert.deepEqual(summary.storesWithNoPublishedTelAvivMinimum, ['green corner']);
    // An unpublished minimum is a lead to verify, never an assumed zero: the
    // sweep only marks a store as able to rank a batch when it *publishes* a
    // minimum at or below the 4-tub item total.
    assert.deepEqual(summary.storesThatCouldRankABatch, []);
  });

  test('a store outside Tel Aviv is coverage-negative even with the lowest minimum in the market', () => {
    const summary = summarizeSweep([elsewhere]);
    assert.equal(summary.storesPublishingTelAvivDelivery, 0);
    assert.equal(summary.lowestPublishedTelAvivMinimum, null);
    assert.equal(summary.stores[0].telAvivAreas.length, 0);
  });
});

describe('checked-in Tel Aviv platform sweep evidence', () => {
  test('the recorded sweep stays a coverage record, not an observation', async () => {
    const name = (await readFile('docs/evidence/telaviv-platform-sweep-index.json', 'utf8')).trim();
    const evidence = JSON.parse(await readFile(`docs/evidence/${name}`, 'utf8'));

    assert.equal(evidence.kind, 'tel-aviv-selfpoint-platform-sweep');
    assert.match(evidence.scope, /Tel Aviv–Yafo home delivery only/);
    assert.match(evidence.disclaimer, /price or stock observation/);
    assert.deepEqual(evidence.batchItemTotalsIls, [24.4, 36.6, 48.8, 61]);

    const withTelAviv = evidence.stores.filter(store => store.telAvivHomeDeliveryAreas.length);
    assert.equal(withTelAviv.length, evidence.storesThatPublishATelAvivHomeDeliveryArea);
    const minimums = withTelAviv.map(store => store.lowestTelAvivBindingMinimum).filter(value => Number.isFinite(value));
    assert.equal(Math.min(...minimums), evidence.lowestPublishedTelAvivMinimum);
    assert.ok(withTelAviv.length >= 10, 'the sweep must cover the platform, not a handful of stores');

    // Coverage evidence only: no listing price, stock or availability may appear.
    const serialized = JSON.stringify(evidence.stores);
    for (const forbidden of ['"availability"', '"price"', '"stock"', '"in_stock"', '"observedAt"']) {
      assert.ok(!serialized.includes(forbidden), `sweep evidence must not carry ${forbidden}`);
    }
  });
});
