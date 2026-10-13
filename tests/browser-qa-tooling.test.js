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
    'product-live-failing-offer-card.png',
    'product-live-2kg-winner-card.png'
  ]) {
    assert.ok(source.includes(`'${name}'`), `missing element screenshot ${name}`);
  }
  assert.match(source, /\/element\/\$\{id\}\/screenshot/);
});

test('browser QA measures a real content viewport instead of an outer window size', () => {
  assert.match(source, /async function setContentViewport/);
  assert.match(source, /Emulation\.setDeviceMetricsOverride/);
  assert.match(source, /content viewport \$\{width\}×\$\{height\} not reached/);
  // The old fallback let a total or warning below the real 701 px content
  // viewport pass against the 844 px outer window; it must not come back.
  assert.doesNotMatch(source, /Math\.max\((?:mobile|liveWinner2kg|mobileWinner2kg)\.innerHeight/);
  assert.match(source, /the measured content viewport really is the requested 390×844/);
  assert.match(source, /ends inside the real content viewport, with no outer-window fallback/);
  assert.match(source, /the necessary conditional\/coverage warning ends inside the real content viewport/);
});

test('browser QA requires full warning sentences and complete card captures', () => {
  assert.match(source, /async function completeCardScreenshot/);
  assert.match(source, /inside\.bottom > inside\.innerHeight/);
  assert.match(source, /failureRect\?\.bottom <= liveWinner2kg\.innerHeight/);
  assert.match(source, /failureRect\?\.bottom <= mobileWinner2kg\.innerHeight/);
  assert.match(source, /failureRect\?\.bottom <= mobileCoffeeMan500\.innerHeight/);
  assert.match(source, /the saved 500 g best-card view is complete, not the visible intersection/);
  assert.match(source, /including the full failure sentence/);
  assert.match(source, /pngSize/);
});

test('browser QA captures the live 2 kg winner in the real failed state on mobile', () => {
  assert.match(source, /live mobile: the real 2 kg winner shows vendor, packs\/grams, item, named method\/charge and total in the first viewport/);
  assert.match(source, /live mobile: the real 2 kg winner with the failed last check keeps its full warning sentence inside the real content viewport/);
  assert.match(source, /api2000\.best\.lastAttemptFailed/);
  assert.match(source, /product-live-2kg-winner-viewport\.png/);
});
