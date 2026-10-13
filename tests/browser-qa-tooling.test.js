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

test('browser QA saves an unscrolled first screen before any card scrolling and restores scroll after card captures', () => {
  assert.match(source, /async function firstScreenScreenshot/);
  // The helper resets scroll explicitly, records the measured scrollY/innerWidth/
  // innerHeight and requires the saved PNG to be exactly the requested size.
  assert.match(source, /window\.scrollTo\(\{ top: 0, left: 0, behavior: 'instant' \}\)/);
  assert.match(source, /scrollY === 0/);
  assert.match(source, /exactly 390×844/);
  // completeCardScreenshot must restore the pre-capture scroll position so a
  // later "viewport" capture cannot silently be a scrolled card view.
  assert.ok(source.includes('top: ${rect.scrollY}'), 'completeCardScreenshot must restore the pre-capture scroll position');
  const firstIdx = source.indexOf("firstScreenScreenshot(wd, 'product-live-2kg-winner-first-screen.png')");
  const cardIdx = source.indexOf("completeCardScreenshot(wd, `document.querySelector('#best-offer')`, 'product-live-2kg-winner-card.png')");
  assert.ok(firstIdx !== -1, 'missing live 2 kg winner first-screen capture');
  assert.ok(cardIdx !== -1, 'missing live 2 kg winner complete-card capture');
  assert.ok(firstIdx < cardIdx, 'the live 2 kg first-screen capture must be saved before the complete-card capture');
  // The fixture-backed failed 2 kg flow must keep the same ordering.
  const failedFirstIdx = source.indexOf("firstScreenScreenshot(wd, 'product-2kg-mobile-failed-390.png')");
  const failedCardIdx = source.indexOf("completeCardScreenshot(wd, `document.querySelector('#best-offer')`, 'product-2kg-mobile-winner-card.png')");
  assert.ok(failedFirstIdx !== -1, 'missing fixture 2 kg failed-state first-screen capture');
  assert.ok(failedCardIdx !== -1, 'missing fixture 2 kg failed-state complete-card capture');
  assert.ok(failedFirstIdx < failedCardIdx, 'the fixture 2 kg first-screen capture must be saved before the complete-card capture');
  for (const name of [
    'product-mobile-390.png',
    'home-mobile-390.png',
    'product-2kg-mobile-failed-390.png',
    'product-live-2kg-winner-first-screen.png'
  ]) {
    assert.ok(source.includes(`firstScreenScreenshot(wd, '${name}')`), `missing unscrolled first-screen capture ${name}`);
  }
  // The 3-91 mislabelled capture (a scrolled card view named "viewport") is gone.
  assert.doesNotMatch(source, /product-live-2kg-winner-viewport\.png/);
  assert.match(source, /product-live-failing-offer-scrolled-view\.png/);
  // Fixture and live captures must not share a directory or overwrite each other;
  // a local live run can override with QA_OUT.
  assert.match(source, /const OUT = process\.env\.QA_OUT \?\? `\.shurik-local\/qa\/\$\{LIVE_BASE \? 'live' : 'fixtures'\}`/);
  assert.match(source, /firstScreenCaptures/);
});

test('browser QA captures the live 2 kg winner in the real failed state on mobile', () => {
  assert.match(source, /live mobile: the unscrolled first screen keeps the heading, quantity\/locality controls and the real 2 kg winner decision values/);
  assert.match(source, /live mobile: the real 2 kg winner with the failed last check keeps its full warning sentence inside the real content viewport/);
  assert.match(source, /api2000\.best\.lastAttemptFailed/);
  assert.match(source, /product-live-2kg-winner-first-screen\.png/);
  assert.match(source, /product-live-2kg-winner-card\.png/);
  // The first-screen evidence must prove the heading and the quantity/locality
  // controls were in the same viewport as the decision values, not just that
  // the card bottom fit.
  assert.match(source, /titleRect: rect\(document\.getElementById\('product-title'\)\)/);
  assert.match(source, /quantityRect: rect\(document\.getElementById\('quantity-group'\)\)/);
  assert.match(source, /destinationRect: rect\(document\.getElementById\('destination'\)\)/);
  assert.match(source, /the unscrolled first screen keeps the page heading, quantity and locality controls inside the real content viewport/);
  assert.match(source, /fixtureBackedCaptures/);
});
