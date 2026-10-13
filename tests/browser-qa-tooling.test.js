// Guards for the browser-QA tooling invariants the owner's Canton Zürich design
// direction depends on: the rendered WCAG-contrast walk and the cropped
// element views of the affected offers.
//
// Iteration 3-75 rewrote scripts/browser-qa.mjs for the index/product split and
// silently dropped the rendered-contrast walk, while docs/DESIGN.md kept
// claiming it ran. The walk itself needs headless Chrome, so these source-level
// assertions keep the capability from disappearing again in `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/browser-qa.mjs', import.meta.url), 'utf8');

test('browser QA walks rendered contrast on every shopping state', () => {
  assert.match(source, /async function contrastReport/);
  for (const state of [
    'the home index (desktop)',
    'the product page (desktop, 500 g)',
    'the product page (mobile 390 px, 500 g)',
    'the 2 kg CoffeeMan winner with the failed-check warning (mobile)',
    'the 500 g CoffeeMan comparison card with the failed-check warning (mobile)',
    'the stale-refresh warning state (mobile)',
    'the unknown-shipping offer state (desktop)'
  ]) {
    assert.ok(source.includes(`contrastReport(wd, 'body', '${state}')`), `missing contrast walk for ${state}`);
  }
  assert.match(source, /required = large \? 3 : 4\.5/);
  assert.match(source, /4\.5:1 normal, 3:1 large/);
});

test('browser QA composites the actual background instead of assuming white', () => {
  assert.match(source, /effectiveBackground/);
  assert.match(source, /blend\(layers\[i\], out\)/);
  assert.match(source, /fg\.a < 1 \? blend\(fg, bg\) : fg/);
});

test('browser QA measures the focus outline against the control background', () => {
  assert.match(source, /the focus outline reaches 3:1 against the control background/);
  assert.match(source, /outlineRatio/);
});

test('browser QA saves cropped element views of the affected offer cards', () => {
  assert.match(source, /async function elementScreenshot/);
  for (const name of [
    'home-card-desktop.png',
    'product-500g-best-card-desktop.png',
    'product-500g-best-card-mobile.png',
    'product-2kg-mobile-winner-card.png',
    'product-500g-mobile-coffeeman-card.png',
    'product-live-failing-offer-card.png'
  ]) {
    assert.ok(source.includes(`'${name}'`), `missing element screenshot ${name}`);
  }
  assert.match(source, /\/element\/\$\{id\}\/screenshot/);
});
