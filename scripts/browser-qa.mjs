#!/usr/bin/env node
// Browser QA for the redesigned Canton Zürich board using the installed headless
// Chrome via WebDriver.
//
//   npm run qa:browser                       # offline: fixture-backed local server, no network
//   node scripts/browser-qa.mjs <baseUrl>    # live: run against a server you started (wrangler dev)
//
// In the default mode the script starts scripts/qa-server.mjs, which serves
// public/ plus the read-only JSON API computed by the production quote engine
// from the recorded fixtures in tests/fixtures/. Expectations are derived from
// that API response, so the checks test the UI wiring and math rather than
// hard-coded prices. The report records which data source was used.
//
// The board is a set of offer cards: each ranked offer keeps item subtotal,
// shipping service/charge and delivered total in one `.totals` row, with
// conditions and provenance in short lists/disclosures. The old wide
// comparison table is gone; these checks assert the card behavior instead.
//
// The script is dependency-free: it speaks the W3C WebDriver protocol over HTTP
// and writes screenshots and a JSON report to .shurik-local/qa/.

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { startQaServer } from './qa-server.mjs';

const LIVE_BASE = process.argv.slice(2).find(arg => /^https?:\/\//i.test(arg)) ?? null;
const FIXTURE_PORT = Number(process.env.QA_PORT) || 0; // 0 = ephemeral port, never clashes with a dev server
const OUT = '.shurik-local/qa';
const PORT = 9515;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const ILS = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2 });
const ils = amount => (amount == null ? null : ILS.format(amount));
const BEST_TOTAL_EXPR = `document.querySelector('#ranked .offer--best .totals__cell--total .totals__value')?.textContent ?? null`;
const BEST_VENDOR_EXPR = `document.querySelector('#ranked .offer--best .offer__vendor')?.innerText ?? null`;
const VARIANT_LABELS = { classico: 'Classico (strength 7)', forte: 'Forte', ricco: 'Ricco', risveglio: 'Risveglio', decaf: 'Decaffeinated', unspecified: 'Variant not stated' };

// The expectations below mirror the rendering helpers in public/app.js so the
// browser checks compare rendered text with the same rules the UI uses.

function packDescription(quote) {
  const product = quote.product ?? {};
  const per = product.packGrams != null ? `${product.packGrams} g` : 'weight not stated';
  if ((product.packCount ?? 1) > 1) {
    return `${product.packCount} × ${per} multipack${product.totalGrams != null ? ` (${product.totalGrams} g)` : ''}`;
  }
  return `${per} pack`;
}

function quantityDescription(quote) {
  const product = quote.product ?? {};
  const units = quote.units ?? 1;
  if ((product.packCount ?? 1) > 1) {
    return `${units} multipack${units === 1 ? '' : 's'} (${product.packCount} × ${product.packGrams} g) = ${quote.orderedGrams} g`;
  }
  return `${units} × ${product.packGrams ?? '?'} g pack${units === 1 ? '' : 's'} = ${quote.orderedGrams} g`;
}

const packLine = quote => `${packDescription(quote)} · ${quantityDescription(quote)} · ${quote.product.variantLabel}`;

function shippingValueText(quote) {
  const shipping = quote.shipping ?? {};
  if (shipping.amountIls != null) {
    if (shipping.amountIls === 0) return shipping.freeThreshold != null ? 'Free (threshold met)' : 'Free';
    return ils(shipping.amountIls);
  }
  if (shipping.amount != null) return `${ils(shipping.amount)} ${shipping.currency ?? ''} (not converted)`.trim();
  return 'Shipping not published';
}

function conditionsFor(quote, destinationLabels) {
  const shipping = quote.shipping ?? {};
  const items = [];
  if (shipping.freeThreshold != null) {
    items.push(quote.itemTotalIls != null && quote.itemTotalIls >= shipping.freeThreshold
      ? `Free-shipping threshold met (from ${ils(shipping.freeThreshold)})`
      : `Free shipping from ${ils(shipping.freeThreshold)} item subtotal`);
  }
  if (shipping.minOrder != null) items.push(`Minimum order ${ils(shipping.minOrder)}`);
  if (shipping.destination?.scope === 'localities') {
    const names = (shipping.destination.localities ?? []).map(id => destinationLabels.get(id) ?? id);
    items.push(names.length ? `Delivery area: only ${names.join(', ')}` : 'Delivery area: restricted locality list not published');
  }
  for (const alternative of shipping.alternatives ?? []) {
    items.push(`${alternative.label}: ${alternative.amountIls != null ? ils(alternative.amountIls) : 'rate not published'}`);
  }
  if (shipping.pickup?.available) items.push(shipping.pickup.note ? `Self-pickup: ${shipping.pickup.note}` : 'Free self-pickup available (kept separate from delivery)');
  if (shipping.deliveryTime) items.push(`Delivery time: ${shipping.deliveryTime}`);
  if (shipping.maxTotalGrams != null) items.push(`Rate quoted for carts up to ${shipping.maxTotalGrams} g`);
  return items;
}

function offerDeltaText(quote, board) {
  if (quote.key === board.best?.key) return 'Cheapest delivered total for this selection';
  const delta = board.best && Number.isFinite(quote.totalIls) && Number.isFinite(board.best.totalIls)
    ? Math.round((quote.totalIls - board.best.totalIls) * 100) / 100
    : null;
  if (delta == null) return '';
  if (delta === 0) return 'Same delivered total as the best offer';
  return `+${ils(delta)} vs best delivered total`;
}

const report = {
  mode: LIVE_BASE ? 'live' : 'fixtures',
  base: LIVE_BASE,
  startedAt: new Date().toISOString(),
  checks: [],
  consoleErrors: []
};
const check = (name, condition, detail = '') => {
  report.checks.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

let fixtureServer = null;
let base = LIVE_BASE;
const chrome = spawn('chromedriver', [`--port=${PORT}`, '--allowed-ips='], { stdio: ['ignore', 'pipe', 'pipe'] });
let session;
try {
  if (!base) {
    fixtureServer = await startQaServer({ port: FIXTURE_PORT });
    base = fixtureServer.url;
  }
  report.base = base;
  report.dataSource = fixtureServer
    ? `recorded fixtures via scripts/qa-server.mjs (${fixtureServer.observations.length} observations)`
    : 'server supplied on the command line';
  report.fixtureObservations = fixtureServer
    ? fixtureServer.observations.map(observation => ({
        key: observation.key,
        vendor: observation.vendor?.name,
        price: observation.price,
        previousPrice: observation.previous?.price ?? null,
        availability: observation.availability,
        shipping: observation.shipping?.certainty
      }))
    : null;

  const catalog = await fetchJson(`${base}/api/catalog`);
  const destinationLabels = new Map((catalog.destinations ?? []).map(item => [item.id, item.label]));
  const api500 = await fetchBoard(base, 500, 'tel-aviv');
  const api1000 = await fetchBoard(base, 1000, 'tel-aviv');
  const api1000Eilat = await fetchBoard(base, 1000, 'eilat');
  const api500Eilat = await fetchBoard(base, 500, 'eilat');
  const apiUnstated = await fetchBoard(base, 500, 'tel-aviv', 'unspecified');
  const best = api500.best;
  if (!best) throw new Error('the board API has no ranked offer, so UI comparison checks cannot run');
  const expected500 = ils(best.totalIls);
  const expectedPerKg = ils(best.ilsPerKg);
  const expected1000 = ils(api1000.best?.totalIls);
  const expected1000Eilat = ils(api1000Eilat.best?.totalIls);
  const expected500Eilat = ils(api500Eilat.best?.totalIls);
  const eilatLabel = catalog.destinations.find(item => item.id === 'eilat')?.label ?? 'Eilat';
  report.expectations = { expected500, expectedPerKg, expected1000, expected1000Eilat, expected500Eilat, bestVendor: best.vendor.name };

  if (fixtureServer) {
    const eightPack = api500.ranked.find(quote => quote.key.endsWith('x8')) ?? null;
    check('fixtures: the researched Pucks checkout rate makes Pucks the 500 g fixture winner at ₪90.00',
      best.vendor.id === 'pucks' && best.totalIls === 90 && best.shipping.certainty === 'verified' && expected500 === '₪90.00',
      `${best.vendor.name} ${expected500} shipping=${best.shipping.certainty}`);
    check('fixtures: the CoffeeMan 8-pack (2 kg) carries the ₪20 checkout quote and its 2000 g cart limit',
      eightPack?.shipping?.amountIls === 20 && eightPack?.shipping?.maxTotalGrams === 2000 && eightPack?.units === 1,
      JSON.stringify(eightPack ? { amountIls: eightPack.shipping.amountIls, maxTotalGrams: eightPack.shipping.maxTotalGrams, units: eightPack.units } : null));
    check('fixtures: every recorded fixture offer is rankable now that all three vendors carry rates',
      api500.unrankable.length === 0 && api500.staleOrUnavailable.length === 0,
      `unrankable=${api500.unrankable.length} stale=${api500.staleOrUnavailable.length}`);
    check('fixtures: the per-kilogram winner differs from the delivered winner at 500 g',
      api500.bestPerKg?.key != null && api500.bestPerKg.key !== best.key,
      `perKg=${api500.bestPerKg?.key} best=${best.key}`);
  }
  check('api: ranked offer exists with a verified delivered total', Number.isFinite(best.totalIls) && best.shipping.certainty !== 'unknown', `${expected500} shipping=${best.shipping.certainty}`);

  await waitFor(() => fetch(`http://127.0.0.1:${PORT}/status`).then(r => r.json()).then(() => true).catch(() => false), 15_000, 'chromedriver start');

  session = await webdriver('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        browserName: 'chrome',
        'goog:chromeOptions': {
          binary: '/usr/bin/google-chrome',
          args: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--log-level=SEVERE']
        }
      }
    }
  });
  const sessionId = session.sessionId ?? session.value?.sessionId;
  const wd = (method, path, body) => webdriver(method, `/session/${sessionId}${path}`, body);

  await wd('POST', '/timeouts', { implicit: 0, pageLoad: 30_000, script: 20_000 });
  await mkdir(OUT, { recursive: true });

  // Desktop scenario.
  await wd('POST', '/window/rect', { width: 1440, height: 1000, x: 0, y: 0 });
  await wd('POST', '/url', { url: `${base}/?grams=500&dest=tel-aviv` });
  await waitForBoard(wd);
  const desktop = await evaluate(wd, `(() => {
    const text = node => node ? node.textContent.trim() : null;
    const cardShape = node => ({
      best: node.classList.contains('offer--best'),
      vendor: node.querySelector('.offer__vendor')?.innerText.trim() ?? null,
      delta: text(node.querySelector('.offer__delta')),
      pack: text(node.querySelector('.offer__pack')),
      product: text(node.querySelector('.offer__product')),
      totals: [...node.querySelectorAll('.totals__cell')].map(cell => ({
        label: text(cell.querySelector('.totals__label')),
        value: text(cell.querySelector('.totals__value')),
        meta: text(cell.querySelector('.totals__meta')),
        rect: (() => { const r = cell.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top) }; })()
      })),
      conditions: [...node.querySelectorAll('.conditions li')].map(n => n.textContent),
      caveats: [...node.querySelectorAll('.caveat')].map(n => n.textContent),
      disclosure: text(node.querySelector('.disclosure')),
      link: node.querySelector('.offer__links a')?.href ?? null
    });
    const cards = [...document.querySelectorAll('#ranked .offer')].map(cardShape);
    const bestCard = document.querySelector('#ranked .offer--best');
    // The refresh diagnostics disclosure is the last .meta-line block inside #board.
    const footerDetails = document.querySelector('#board > .meta-line details');
    return {
      cards,
      bestTop: bestCard ? Math.round(bestCard.getBoundingClientRect().top) : null,
      bestTag: text(document.querySelector('.offer--best .tag--best')),
      metaLines: [...document.querySelectorAll('#ranked .meta-line')].map(n => n.innerText),
      unknownSection: !!document.getElementById('unknown'),
      unknownText: text(document.getElementById('unknown')),
      unknownCards: [...document.querySelectorAll('#unknown .unknown')].map(n => n.textContent),
      pickupRows: [...document.querySelectorAll('#pickup .pickup-row')].map(n => n.textContent),
      pickupHeader: text(document.querySelector('#pickup h2')),
      footerStatus: text(document.getElementById('footer-status')),
      footerDetails: footerDetails ? footerDetails.textContent : null,
      visibleText: document.body.innerText,
      tableCount: document.querySelectorAll('table').length,
      bidiFragments: document.querySelectorAll('[dir="auto"][lang="he"]').length,
      hasSkipLink: !!document.querySelector('.skip'),
      hasMain: !!document.querySelector('main'),
      hero: text(document.querySelector('#page-title')),
      productStatic: text(document.getElementById('product-static')),
      productSelectHidden: document.getElementById('product')?.hidden ?? null,
      productOptions: [...document.querySelectorAll('#product option')].map(o => o.textContent.trim()),
      variantOptions: [...document.querySelectorAll('#variant option')].map(o => o.textContent.trim()),
      quantityPressed: [...document.querySelectorAll('#quantity-group button')].map(b => [b.textContent.trim(), b.getAttribute('aria-pressed')]),
      destinationOptions: [...document.querySelectorAll('#destination option')].map(o => o.textContent.trim()),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
    };
  })()`);
  report.desktop = { bestTop: desktop.bestTop, cardCount: desktop.cards.length, metaLines: desktop.metaLines };

  // Rendered contrast: walk visible text elements and compare their computed color
  // with the effective (first opaque ancestor) background. Normal text must reach
  // 4.5:1 and large text 3:1, as the owner's design direction requires.
  const contrast = await evaluate(wd, `(() => {
    const parse = value => { const m = String(value).match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const parts = m[1].split(',').map(Number); return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 }; };
    const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const ratio = (a, b) => { const la = lum(a), lb = lum(b); const hi = Math.max(la, lb), lo = Math.min(la, lb); return (hi + 0.05) / (lo + 0.05); };
    const effectiveBg = node => {
      let el = node;
      while (el) {
        const bg = parse(getComputedStyle(el).backgroundColor);
        if (bg && bg.a > 0.9) return bg;
        el = el.parentElement;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };
    const results = [];
    for (const node of document.querySelectorAll('#ranked .offer *, #ranked .meta-line, .controls *, .site-footer *, .masthead *, .hero *, #unknown *, #pickup *')) {
      if (!node.offsetParent && node.tagName !== 'BODY') continue;
      const text = [...node.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();
      if (!text) continue;
      const style = getComputedStyle(node);
      const fg = parse(style.color);
      if (!fg) continue;
      const bg = effectiveBg(node);
      const value = ratio(fg, bg);
      const size = parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      const large = size >= 24 || (size >= 18.66 && bold);
      const required = large ? 3 : 4.5;
      if (value + 0.01 < required) results.push({ text: text.slice(0, 40), color: style.color, bg: 'rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ')', ratio: Math.round(value * 100) / 100, size, required });
    }
    return results;
  })()`);
  report.contrastViolations = contrast;
  check('desktop: rendered text meets WCAG AA contrast (4.5:1 normal, 3:1 large)', contrast.length === 0,
    contrast.length ? JSON.stringify(contrast.slice(0, 5)) : 'no violations across cards, controls, footer, hero and unknown/pickup sections');

  const bestCard = desktop.cards[0];
  check('desktop: the best card is the API-ranked best offer', bestCard?.best === true && (bestCard.vendor ?? '').includes(best.vendor.name), `${bestCard?.vendor} vs ${best.vendor.name}`);
  check(`desktop: delivered total for 500 g is ${expected500}`, bestCard?.totals?.[2]?.value === expected500, bestCard?.totals?.[2]?.value);
  check('desktop: item subtotal is shown next to shipping and the delivered total', bestCard?.totals?.[0]?.value === ils(best.itemTotalIls), bestCard?.totals?.[0]?.value);
  check(`desktop: shipping shows ${ils(best.shipping.amountIls)} with the written certainty label`,
    bestCard?.totals?.[1]?.value === ils(best.shipping.amountIls) && bestCard?.totals?.[1]?.meta === best.shipping.certaintyLabel,
    `${bestCard?.totals?.[1]?.value} :: ${bestCard?.totals?.[1]?.meta}`);
  check(`desktop: per-kilogram normalization shows ${expectedPerKg}`, (bestCard?.totals?.[2]?.meta ?? '').includes(`${expectedPerKg} per kg`), bestCard?.totals?.[2]?.meta);
  const totalsTogether = bestCard?.totals?.length === 3
    && bestCard.totals.every(cell => cell.rect.left >= 0 && cell.rect.right <= desktop.viewportWidth + 1)
    && bestCard.totals.every(cell => Math.abs(cell.rect.top - bestCard.totals[0].rect.top) <= 1)
    && desktop.pageOverflow === false;
  check('desktop: the three decision values sit in one visible row without horizontal scrolling', totalsTogether,
    JSON.stringify({ rects: bestCard?.totals?.map(cell => cell.rect), viewportWidth: desktop.viewportWidth, pageOverflow: desktop.pageOverflow }));
  check('desktop: the best card carries the written best-total label and selection context',
    desktop.bestTag === 'Best known delivered total' && bestCard?.delta === 'Cheapest delivered total for this selection',
    `${desktop.bestTag} :: ${bestCard?.delta}`);
  check('desktop: the hero is "Attention shoppers" without a trailing period', desktop.hero === 'Attention shoppers', desktop.hero);
  check('desktop: the best offer is visible on the first screen', desktop.bestTop != null && desktop.bestTop < desktop.viewportHeight, `top=${desktop.bestTop} viewport=${desktop.viewportHeight}`);
  check('desktop: every ranked offer is rendered as an offer card', desktop.cards.length === api500.ranked.length, `cards=${desktop.cards.length} ranked=${api500.ranked.length}`);
  check('desktop: the wide comparison table was removed in favor of offer cards', desktop.tableCount === 0, `tables=${desktop.tableCount}`);
  check('desktop: stock status has a written label', (bestCard?.vendor ?? '').toLowerCase().includes(best.availabilityLabel.toLowerCase()), `${best.availabilityLabel} in [${bestCard?.vendor}]`);
  check('desktop: vendor link points at the API product page', bestCard?.link === best.itemUrl, `${bestCard?.link} vs ${best.itemUrl}`);
  const packLabelsOk = desktop.cards.length === api500.ranked.length
    && desktop.cards.every((card, index) => card.pack === packLine(api500.ranked[index]));
  check('desktop: pack and quantity labels match the API (multipacks never read as a single 250 g pack)', packLabelsOk,
    desktop.cards.map((card, index) => `${card.pack} vs ${packLine(api500.ranked[index])}`).join(' | '));
  const eightPackIndex = api500.ranked.findIndex(quote => (quote.product.packCount ?? 1) === 8);
  const eightPackCard = eightPackIndex >= 0 ? desktop.cards[eightPackIndex] : null;
  check('desktop: a multipack card spells out its contents and purchased grams',
    eightPackCard != null && /8 × 250 g multipack \(2000 g\)/.test(eightPackCard.pack) && /1 multipack \(8 × 250 g\) = 2000 g/.test(eightPackCard.pack),
    eightPackCard?.pack);
  const deltasOk = desktop.cards.slice(1).every((card, index) => card.delta === offerDeltaText(api500.ranked[index + 1], api500));
  check('desktop: every other ranked offer states its difference from the best delivered total', deltasOk,
    desktop.cards.slice(1).map(card => card.delta).join(' | '));
  const conditionsOk = desktop.cards.length === api500.ranked.length
    && desktop.cards.every((card, index) => JSON.stringify(card.conditions) === JSON.stringify(conditionsFor(api500.ranked[index], destinationLabels)));
  check('desktop: each offer shows exactly its API conditions (thresholds, alternatives, pickup, limits)', conditionsOk,
    desktop.cards.map((card, index) => `${card.conditions.join(' / ')} vs ${conditionsFor(api500.ranked[index], destinationLabels).join(' / ')}`).join(' || '));
  const caveatsOk = desktop.cards.length === api500.ranked.length
    && desktop.cards.every((card, index) => {
      const caveat = api500.ranked[index].shipping?.coverageCaveat;
      const expected = caveat ? [`Coverage: ${caveat}`] : [];
      return card.caveats.length <= 1 && JSON.stringify(card.caveats) === JSON.stringify(expected);
    });
  check('desktop: an unconfirmed coverage caveat is disclosed once on its own card', caveatsOk,
    desktop.cards.map(card => card.caveats.join(' / ')).join(' || '));
  const perKgWinner = api500.bestPerKg;
  const perKgCalledOut = !perKgWinner || perKgWinner.key === best.key
    || desktop.metaLines.some(line => line.includes('Cheapest per kilogram')
      && line.includes(perKgWinner.vendor.name)
      && line.includes(`${ils(perKgWinner.ilsPerKg)} per kg`)
      && line.includes(`${perKgWinner.packCount} × ${perKgWinner.packGrams} g multipack`)
      && line.includes(`delivered ${ils(perKgWinner.totalIls)}`));
  check('desktop: the cheapest per-kilogram offer is called out with its real pack contents when it differs from the cheapest total', perKgCalledOut,
    perKgWinner ? `perKg=${perKgWinner.key} ${ils(perKgWinner.ilsPerKg)} best=${best.key}` : 'no separate per-kg winner');
  const excludedOk = fixtureServer
    ? Number(api500.counts?.excludedByVariant) >= 1
      && desktop.metaLines.some(line => line.includes(`${api500.counts.excludedByVariant} observed offer(s) for another blend variant`) && line.includes('Switch the variant control'))
    : Number(api500.counts?.excludedByVariant) === 0 || desktop.metaLines.some(line => line.includes('another blend variant'));
  check('desktop: offers for another variant are reported as excluded, not merged', excludedOk,
    `excluded=${api500.counts?.excludedByVariant}`);
  const unknownOk = fixtureServer
    ? desktop.unknownSection === true && desktop.unknownCards.length === 0 && /Nothing is missing right now/.test(desktop.unknownText ?? '')
    : desktop.unknownSection === true && (desktop.unknownCards.length === 0 ? /Nothing is missing right now/.test(desktop.unknownText ?? '') : desktop.unknownCards.every(text => text.trim().length > 0));
  check('desktop: the missing-information section either explains that nothing is missing or lists each unknown with its reason',
    unknownOk, desktop.unknownText?.slice(0, 200));
  check('desktop: pickup-only offers stay in their own section, out of the delivered ranking',
    desktop.pickupRows.length === api500.pickup.length && (fixtureServer ? api500.pickup.length >= 1 : true) && desktop.pickupHeader === 'Pickup-only offers',
    `rows=${desktop.pickupRows.length} api=${api500.pickup.length} header=${desktop.pickupHeader}`);
  const pickupShowsFee = desktop.pickupRows.every(text => /Pickup fee/.test(text) && /Not applicable/.test(text) && /Self-pickup, not delivery/.test(text));
  check('desktop: pickup rows show the pickup fee and say a delivered total does not apply', pickupShowsFee,
    desktop.pickupRows[0]?.slice(0, 240));
  check('desktop: destination selector lists Israeli localities', desktop.destinationOptions.length >= 5, desktop.destinationOptions.join(' | '));
  check('desktop: quantity control marks 500 g pressed', desktop.quantityPressed.some(([label, pressed]) => label === '500 g' && pressed === 'true'), desktop.quantityPressed.join(' | '));
  check('desktop: no emoji in visible text', !EMOJI.test(desktop.visibleText), 'emoji scan');
  check('desktop: Hebrew vendor text is direction-isolated', desktop.bidiFragments >= 1, String(desktop.bidiFragments));
  check('desktop: skip link and main landmark are present', desktop.hasSkipLink && desktop.hasMain, `skip=${desktop.hasSkipLink} main=${desktop.hasMain}`);
  check('desktop: footer reports the last completed refresh instead of a static waiting message',
    /Last completed refresh:/.test(desktop.footerStatus ?? '') && !/Waiting for the first refresh/.test(desktop.footerStatus ?? ''),
    desktop.footerStatus);
  check('desktop: footer reports when the next source check is due',
    /Next source check due \(approximate/.test(desktop.footerDetails ?? ''),
    (desktop.footerDetails ?? '').split('\n').find(line => /Next source check due/.test(line)) ?? 'not found');

  // The synthetic previous check in the offline fixtures belongs to the CoffeeMan
  // single pack, so the price change must appear in that offer's own disclosure
  // (not on the best card, which has no previous evidence).
  const changeTextOk = api500.ranked.every((quote, index) => {
    const disclosure = desktop.cards[index]?.disclosure ?? '';
    if (!quote.priceChange) return !/Unit price (up|down|unchanged)/.test(disclosure);
    if (!quote.priceChange.comparable) return disclosure.includes('Previous price not compared:');
    if (quote.priceChange.direction === 'same') return disclosure.includes('Unit price unchanged since the previous check');
    return new RegExp(`Unit price ${quote.priceChange.direction} ${ils(quote.priceChange.deltaIls).replace('.', '\\.')} since the previous check`).test(disclosure);
  });
  check('desktop: a price change is shown in the owning offer disclosure when previous evidence exists', changeTextOk,
    desktop.cards.map(card => card.disclosure?.slice(0, 160)).join(' || '));
  check('desktop: every offer disclosure states its last successful check',
    desktop.cards.every(card => /Last successful check:/.test(card.disclosure ?? '')),
    desktop.cards.map(card => card.disclosure?.split('\n')[0]).join(' | '));

  // Variant scenario: the Coffee4U listing has no stated blend variant, so it is
  // compared on its own instead of being merged into Classico. Its published
  // pickup-point alternative and free self-pickup must be discoverable on the card.
  await evaluate(wd, `(() => { const select = document.getElementById('variant'); select.value = 'unspecified'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitForPage(wd, `${BEST_VENDOR_EXPR}?.includes('Coffee4U')`, 15_000, 'unstated-variant ranking', `({vendor: ${BEST_VENDOR_EXPR}, total: ${BEST_TOTAL_EXPR}})`);
  const unstated = await evaluate(wd, `(() => {
    const card = document.querySelector('#ranked .offer--best');
    return {
      vendor: card?.querySelector('.offer__vendor')?.innerText.trim() ?? null,
      total: card?.querySelector('.totals__cell--total .totals__value')?.textContent ?? null,
      pack: card?.querySelector('.offer__pack')?.textContent ?? null,
      shipping: card?.querySelectorAll('.totals__cell')[1]?.querySelector('.totals__value')?.textContent ?? null,
      conditions: [...(card?.querySelectorAll('.conditions li') ?? [])].map(n => n.textContent),
      caveats: [...(card?.querySelectorAll('.caveat') ?? [])].map(n => n.textContent),
      link: card?.querySelector('.offer__links a')?.href ?? null,
      variantOptions: [...document.querySelectorAll('#variant option')].map(n => n.textContent.trim()),
      excludedLine: [...document.querySelectorAll('#ranked .meta-line')].map(n => n.innerText).find(line => /another blend variant/.test(line)) ?? null
    };
  })()`);
  const expectedUnstated = ils(apiUnstated.best?.totalIls);
  check(`variant: the unstated-variant listing ranks on its own at ${expectedUnstated}`,
    (unstated.vendor ?? '').includes('Coffee4U') && unstated.total === expectedUnstated && (unstated.pack ?? '').includes('Variant not stated'),
    `${unstated.vendor} ${unstated.total} vs ${expectedUnstated} (${unstated.pack})`);
  check('variant: the published door-to-door rate is the ranked shipping amount',
    unstated.shipping === ils(apiUnstated.best?.shipping?.amountIls), `${unstated.shipping} vs ${ils(apiUnstated.best?.shipping?.amountIls)}`);
  check('variant: the published pickup-point alternative and free self-pickup are on the card',
    unstated.conditions.some(text => /pickup point/i.test(text) && text.includes(ils(15)))
      && unstated.conditions.some(text => /Self-pickup: .*Free self-pickup at the shop/.test(text)),
    unstated.conditions.join(' | '));
  check('variant: the unstated-variant coverage caveat is disclosed on the card',
    unstated.caveats.some(text => text.includes(apiUnstated.best?.shipping?.coverageCaveat ?? 'never')),
    unstated.caveats.join(' | '));
  check('variant: the variant control offers "Variant not stated" without a hidden reveal',
    unstated.variantOptions.some(text => text.startsWith('Variant not stated')), unstated.variantOptions.join(' | '));
  const excludedLabels = (apiUnstated.counts?.excludedVariants ?? []).map(id => VARIANT_LABELS[id] ?? id).join(', ');
  const expectedExcluded = `${apiUnstated.counts?.excludedByVariant} observed offer(s) for another blend variant (${excludedLabels})`;
  check('variant: the excluded Classico offers are named in the comparison note',
    (unstated.excludedLine ?? '').includes(expectedExcluded), `${unstated.excludedLine} vs ${expectedExcluded}`);
  check('variant: the ranked offer keeps its vendor page link',
    unstated.link === apiUnstated.best?.itemUrl, `${unstated.link} vs ${apiUnstated.best?.itemUrl}`);
  await screenshot(wd, 'desktop-1440-unstated-variant.png');
  await evaluate(wd, `(() => { const select = document.getElementById('variant'); select.value = 'classico'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitForPage(wd, `${BEST_VENDOR_EXPR}?.includes('Pucks')`, 15_000, 'restore classico ranking', `({vendor: ${BEST_VENDOR_EXPR}})`);
  await screenshot(wd, 'desktop-1440.png');

  // Owner correction 2026-10-12: exactly one product line is tracked. The UI must not
  // offer a picker for a retired line, and an old shared URL that names one must fall
  // back to Crema e Gusto with a written explanation instead of reviving that board.
  check('product: the catalog exposes only the tracked Crema e Gusto line',
    catalog.products.length === 1 && catalog.products[0].id === 'lavazza-crema-e-gusto-vacuum-ground',
    catalog.products.map(item => item.id).join(' | '));
  check('product: the selector is a static tracked-product label, not a retired-line picker',
    desktop.productSelectHidden === true && desktop.productOptions.length === 1
      && /Lavazza Crema e Gusto/.test(desktop.productStatic ?? ''),
    JSON.stringify({ hidden: desktop.productSelectHidden, options: desktop.productOptions, label: desktop.productStatic }));
  await screenshot(wd, 'desktop-1440-product-scope.png');

  // An old product query URL naming a retired line falls back to the tracked product
  // and says so; the page must not render that line's offers or its name as a board.
  await wd('POST', '/url', { url: `${base}/?product=lavazza-qualita-oro-vacuum-ground&grams=500&dest=tel-aviv` });
  await waitForBoard(wd);
  const retiredUrl = await evaluate(wd, `(() => ({
    notice: document.getElementById('retired-product-notice')?.innerText ?? null,
    bestVendor: ${BEST_VENDOR_EXPR},
    bestTotal: ${BEST_TOTAL_EXPR},
    bodyText: document.body.innerText,
    staticLabel: document.getElementById('product-static')?.textContent ?? null
  }))()`);
  check('product: a retired-line query URL falls back to Crema e Gusto with a written notice',
    /retired product line/i.test(retiredUrl.notice ?? '') && /Qualità Oro/.test(retiredUrl.notice ?? '')
      && /Lavazza Crema e Gusto/.test(retiredUrl.staticLabel ?? '')
      && (retiredUrl.bestVendor ?? '').includes(best.vendor.name) && retiredUrl.bestTotal === expected500
      && !/Qualità Rossa|Lavazza Suerte/.test(retiredUrl.bodyText ?? ''),
    retiredUrl.notice);
  await screenshot(wd, 'desktop-1440-retired-url.png');
  await wd('POST', '/url', { url: `${base}/?grams=500&dest=tel-aviv` });
  await waitForBoard(wd);

  // A shared URL with an untracked variant id (a typo or an old link) must fall back to
  // the product's default variant instead of rendering an empty board.
  await wd('POST', '/url', { url: `${base}/?grams=500&dest=tel-aviv&variant=nope` });
  await waitForBoard(wd);
  const fallbackVariant = await evaluate(wd, `({
    vendor: ${BEST_VENDOR_EXPR},
    total: ${BEST_TOTAL_EXPR},
    variantValue: document.getElementById('variant')?.value ?? null
  })`);
  check('variant: a URL with an untracked variant id falls back to the product default',
    fallbackVariant.variantValue === 'classico' && fallbackVariant.total === expected500,
    JSON.stringify(fallbackVariant));

  // Quantity interaction: click "1 kg".
  const kgButton = await wd('POST', '/element', { using: 'css selector', value: '#quantity-group button[data-grams="1000"]' });
  await wd('POST', `/element/${elementId(kgButton)}/click`, {});
  await waitForPage(wd, `${BEST_TOTAL_EXPR} === ${JSON.stringify(expected1000)}`, 15_000, `quantity update to 1 kg (${expected1000})`, `({total: ${BEST_TOTAL_EXPR}, search: location.search, pressed: [...document.querySelectorAll('#quantity-group button')].map(b => b.getAttribute('aria-pressed'))})`);
  const kgState = await evaluate(wd, `({
    total: ${BEST_TOTAL_EXPR},
    perKg: document.querySelector('#ranked .offer--best .totals__cell--total .totals__meta')?.textContent ?? null,
    url: location.search
  })`);
  check(`interaction: 1 kg updates the delivered total to ${expected1000}`, kgState.total === expected1000, JSON.stringify(kgState));
  check('interaction: per-kg price recalculated for 1 kg', (kgState.perKg ?? '').includes(`${ils(api1000.best?.ilsPerKg)} per kg`), kgState.perKg);
  check('interaction: quantity is reflected in the shareable URL', /grams=1000/.test(kgState.url ?? ''), kgState.url);

  // Destination change.
  await evaluate(wd, `(() => { const select = document.getElementById('destination'); select.value = 'eilat'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitForPage(wd, `document.querySelector('.section__intro')?.textContent.includes(${JSON.stringify(eilatLabel)})`, 15_000, 'destination update');
  const eilat = await evaluate(wd, `({ intro: document.querySelector('.section__intro')?.textContent, total: ${BEST_TOTAL_EXPR} })`);
  check(`interaction: destination change recalculates for ${eilatLabel}`, /Eilat/.test(eilat.intro ?? '') && eilat.total === expected1000Eilat, `${eilat.intro} · ${eilat.total} vs ${expected1000Eilat}`);

  // Keyboard: focus the first quantity button, Tab to the next, then activate it with Enter.
  await evaluate(wd, `(() => { document.querySelector('#quantity-group button[data-grams="250"]').focus(); return true; })()`);
  await wd('POST', '/actions', { actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '\uE004' }, { type: 'keyUp', value: '\uE004' }] }] });
  const keyboard = await evaluate(wd, `(() => {
    const active = document.activeElement;
    const style = getComputedStyle(active);
    return { tag: active.tagName, label: active.textContent, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor };
  })()`);
  check('keyboard: Tab moves focus to the next quantity button', keyboard.tag === 'BUTTON' && keyboard.label === '500 g', JSON.stringify(keyboard));
  check('keyboard: focused control shows a visible outline in the official Blau focus color',
    keyboard.outlineStyle !== 'none' && parseFloat(keyboard.outlineWidth) >= 2 && keyboard.outlineColor === 'rgb(0, 112, 180)',
    `${keyboard.outlineStyle} ${keyboard.outlineWidth} ${keyboard.outlineColor}`);
  await wd('POST', '/actions', { actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '\uE007' }, { type: 'keyUp', value: '\uE007' }] }] });
  await waitForPage(wd, `${BEST_TOTAL_EXPR} === ${JSON.stringify(expected500Eilat)}`, 15_000, `keyboard activation of the 500 g quantity (${expected500Eilat} to ${eilatLabel})`, `({total: ${BEST_TOTAL_EXPR}, search: location.search})`);
  check('keyboard: Enter activates the focused quantity and updates the total', true, `total ${expected500Eilat}`);
  await wd('DELETE', '/actions');

  // Mobile scenario.
  await wd('POST', '/window/rect', { width: 390, height: 844, x: 0, y: 0 });
  await wd('POST', '/url', { url: `${base}/?grams=500&dest=tel-aviv` });
  await waitForBoard(wd);
  const mobile = await evaluate(wd, `(() => {
    const bestCard = document.querySelector('#ranked .offer--best');
    const rect = bestCard.getBoundingClientRect();
    const controls = getComputedStyle(document.querySelector('.controls')).gridTemplateColumns;
    const cells = [...document.querySelectorAll('#ranked .offer--best .totals__cell')].map(cell => {
      const r = cell.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right) };
    });
    return {
      bestFits: rect.width <= window.innerWidth + 1,
      bestTop: Math.round(rect.top),
      cells,
      controlColumns: controls,
      bodyOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      minTap: Math.min(...[...document.querySelectorAll('#quantity-group button')].map(b => b.getBoundingClientRect().height)),
      pickupRows: document.querySelectorAll('#pickup .pickup-row').length
    };
  })()`);
  report.mobile = mobile;
  check('mobile: best-choice card fits the viewport', mobile.bestFits === true, JSON.stringify(mobile));
  check('mobile: the decision values stay inside the viewport', mobile.cells.every(cell => cell.left >= 0 && cell.right <= 390 + 1), JSON.stringify(mobile.cells));
  check('mobile: controls reflow to a single column', !mobile.controlColumns.includes(' '), mobile.controlColumns);
  check('mobile: page does not scroll horizontally', mobile.bodyOverflow === false, JSON.stringify(mobile));
  check('mobile: quantity buttons keep a 44px touch target', mobile.minTap >= 44, String(mobile.minTap));
  check('mobile: the best offer is not pushed far below the first screen', mobile.bestTop < 2 * 844, `top=${mobile.bestTop}`);
  check('mobile: pickup-only offers remain visible in their own section', mobile.pickupRows === api500.pickup.length, `rows=${mobile.pickupRows}`);
  await screenshot(wd, 'mobile-390.png');

  // Shipping-terms scenario: a second fixture server adds one clearly labelled QA-only demo
  // offer that publishes a minimum order, a free-shipping threshold and a locality restriction,
  // so the UI rendering of those terms is verified too. It never runs in production.
  const termsServer = await startQaServer({ port: 0, withTermsDemo: true, staleRefresh: true });
  try {
    report.termsDataSource = 'QA-only demo offer added to the recorded fixtures (not a vendor)';
    const terms2000 = await fetchBoard(termsServer.url, 2000, 'tel-aviv');
    const expectedTermsTotal = ils(terms2000.best?.totalIls);
    await wd('POST', '/url', { url: `${termsServer.url}/?grams=2000&dest=tel-aviv` });
    await waitForBoard(wd);
    const terms = await evaluate(wd, `(() => {
      const card = document.querySelector('#ranked .offer--best');
      return {
        vendor: card?.querySelector('.offer__vendor')?.innerText.trim() ?? null,
        total: card?.querySelector('.totals__cell--total .totals__value')?.textContent ?? null,
        shipping: card?.querySelectorAll('.totals__cell')[1]?.querySelector('.totals__value')?.textContent ?? null,
        conditions: [...(card?.querySelectorAll('.conditions li') ?? [])].map(n => n.textContent),
        footer: document.getElementById('footer-status')?.textContent ?? null
      };
    })()`);
    check('terms: demo offer is the ranked best for 2 kg', terms2000.best?.vendor.id === 'qa-terms-demo' && terms.total === expectedTermsTotal, `${terms.total} vs ${expectedTermsTotal} (${terms2000.best?.vendor.id})`);
    check('terms: minimum order is displayed', terms.conditions.includes('Minimum order ₪30.00'), terms.conditions.join(' | '));
    check('terms: met free-shipping threshold shows Free and a written label',
      terms.conditions.includes('Free-shipping threshold met (from ₪100.00)') && terms.shipping === 'Free (threshold met)',
      `${terms.shipping} :: ${terms.conditions.join(' | ')}`);
    check('terms: locality-restricted delivery area is displayed with locality labels',
      terms.conditions.includes('Delivery area: only Tel Aviv–Yafo, Eilat'), terms.conditions.join(' | '));
    check('freshness: a stopped scheduled refresh is labelled in the footer',
      /No completed scheduled refresh for 30 h/.test(terms.footer ?? ''),
      terms.footer);

    // The locality restriction must actually exclude the offer for Jerusalem.
    await wd('POST', '/url', { url: `${termsServer.url}/?grams=2000&dest=jerusalem` });
    await waitForBoard(wd);
    const restricted = await evaluate(wd, `(() => ({
      bestVendor: ${BEST_VENDOR_EXPR},
      reasons: [...document.querySelectorAll('#unknown .unknown__reason')].map(node => node.textContent.trim())
    }))()`);
    check('terms: locality restriction moves the demo offer to the unknown list for Jerusalem',
      restricted.reasons.some(text => text.includes('does not include')),
      JSON.stringify(restricted.reasons));
  } finally {
    await termsServer.close();
  }

  // Unknown-shipping scenario: a QA-only offer with no published rate must stay
  // visible with the exact reason and must never be counted as free or ranked.
  const unknownServer = await startQaServer({ port: 0, withUnknownDemo: true });
  try {
    report.unknownDataSource = 'QA-only offer without a shipping rate added to the recorded fixtures (not a vendor)';
    const unknownBoard = await fetchBoard(unknownServer.url, 500, 'tel-aviv');
    const demoQuote = unknownBoard.unrankable.find(quote => quote.vendor.id === 'qa-unknown-demo') ?? null;
    check('unknown: the QA-only no-rate offer is unrankable with a plain-language reason',
      demoQuote != null && demoQuote.reasons.some(reason => /treated as unknown, not free/.test(reason)),
      JSON.stringify(demoQuote?.reasons));
    check('unknown: the no-rate offer never appears in the ranked delivered totals',
      unknownBoard.ranked.every(quote => quote.vendor.id !== 'qa-unknown-demo') && unknownBoard.best?.vendor.id !== 'qa-unknown-demo',
      `ranked=${unknownBoard.ranked.map(quote => quote.vendor.id).join(',')}`);
    await wd('POST', '/url', { url: `${unknownServer.url}/?grams=500&dest=tel-aviv` });
    await waitForBoard(wd);
    const unknownUi = await evaluate(wd, `(() => ({
      rankedVendors: [...document.querySelectorAll('#ranked .offer__vendor')].map(n => n.innerText),
      cards: [...document.querySelectorAll('#unknown .unknown')].map(node => node.textContent),
      bodyText: document.body.innerText
    }))()`);
    const demoCard = unknownUi.cards.find(text => text.includes('no shipping rate')) ?? null;
    check('unknown: the no-rate offer is rendered with "Shipping not published" and the missing-rate explanation',
      demoCard != null
        && demoCard.includes('Shipping not published')
        && demoCard.includes('A missing rate is never counted as free')
        && demoCard.includes('Item subtotal: ₪48.00'),
      demoCard?.slice(0, 320));
    check('unknown: the no-rate offer stays out of the ranked cards',
      unknownUi.rankedVendors.every(text => !text.includes('no shipping rate')),
      unknownUi.rankedVendors.join(' | '));

    // The "Show offers that cannot be ranked" toggle hides and restores the section.
    await evaluate(wd, `(() => { const box = document.getElementById('show-unknown'); box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await waitForPage(wd, `!document.getElementById('unknown')`, 15_000, 'unknown section hidden');
    check('unknown: unrankable offers can be hidden but are visible by default', await evaluate(wd, `document.getElementById('unknown') === null`) === true);
    await evaluate(wd, `(() => { const box = document.getElementById('show-unknown'); box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await waitForPage(wd, `!!document.getElementById('unknown')`, 15_000, 'unknown section restored');
    await screenshot(wd, 'desktop-1440-unknown-shipping.png');
  } finally {
    await unknownServer.close();
  }

  // Interrupted-refresh scenario: the store holds fresh saved observations but the
  // background run never wrote a completion marker (for example a redeploy stopped it).
  // The footer must report the observation time instead of claiming "never refreshed".
  const interruptedServer = await startQaServer({ port: 0, interruptedRefresh: true });
  try {
    const interruptedBoard = await fetchBoard(interruptedServer.url, 500, 'tel-aviv');
    check('freshness: an interrupted refresh keeps fresh observations out of the stale state',
      interruptedBoard.freshness?.lastRefreshAt === null
        && interruptedBoard.freshness?.lastObservationAt != null
        && interruptedBoard.freshness?.stale === false,
      JSON.stringify(interruptedBoard.freshness));
    await wd('POST', '/url', { url: `${interruptedServer.url}/?grams=500&dest=tel-aviv` });
    await waitForBoard(wd);
    const interruptedFooter = await evaluate(wd, `document.getElementById('footer-status')?.textContent ?? null`);
    check('freshness: the footer names the last offer observation instead of a never-refreshed message',
      /Last offer observation:/.test(interruptedFooter ?? '')
        && !/No scheduled refresh has completed|No completed scheduled refresh/.test(interruptedFooter ?? ''),
      interruptedFooter);
  } finally {
    await interruptedServer.close();
  }

  // Failed-attempt scenario: the most recent check failed, but the last successful
  // observation is preserved and still ranks. The board must say the last attempt
  // failed instead of presenting the row as freshly re-checked.
  const failedServer = await startQaServer({ port: 0, failedAttempt: true });
  try {
    const failedBoard = await fetchBoard(failedServer.url, 500, 'tel-aviv');
    const failedBest = failedBoard.best ?? null;
    check('failure: a failed last attempt keeps its last successful observation ranked',
      failedBest?.lastAttemptFailed === true
        && failedBest?.lastError != null
        && failedBest?.observedAt != null
        && failedBest?.attemptedAt != null
        && failedBest.attemptedAt !== failedBest.observedAt,
      JSON.stringify({ observedAt: failedBest?.observedAt, attemptedAt: failedBest?.attemptedAt, lastError: failedBest?.lastError }));
    const failedSingle = failedBoard.ranked.find(quote => quote.vendor.id === 'coffeeman' && (quote.product.packCount ?? 1) === 1) ?? null;
    const cleanFourPack = failedBoard.ranked.find(quote => quote.vendor.id === 'coffeeman' && (quote.product.packCount ?? 1) === 4) ?? null;
    check('failure: only the failed vendor rows carry the failed attempt',
      failedSingle?.lastAttemptFailed === true && cleanFourPack?.lastAttemptFailed === false,
      JSON.stringify({ single: failedSingle?.lastAttemptFailed, fourPack: cleanFourPack?.lastAttemptFailed }));
    await wd('POST', '/url', { url: `${failedServer.url}/?grams=500&dest=tel-aviv` });
    await waitForBoard(wd);
    const failedUi = await evaluate(wd, `(() => ({
      cards: [...document.querySelectorAll('#ranked .offer')].map(node => ({
        vendor: node.querySelector('.offer__vendor')?.innerText ?? null,
        pack: node.querySelector('.offer__pack')?.textContent ?? null,
        disclosure: node.querySelector('.disclosure')?.textContent ?? null
      })),
      visibleText: document.body.innerText,
      footerDetails: document.querySelector('#board > .meta-line details')?.textContent ?? null
    }))()`);
    const failedBestCard = failedUi.cards[0] ?? null;
    const failedSingleCard = failedUi.cards.find(card => /CoffeeMan/.test(card.vendor ?? '') && /^250 g pack ·/.test(card.pack ?? '')) ?? null;
    check('failure: best-offer disclosure says the last attempt failed and names the last successful check',
      /Last successful check:/.test(failedBestCard?.disclosure ?? '') && /Last attempt failed /.test(failedBestCard?.disclosure ?? '') && /HTTP 503/.test(failedBestCard?.disclosure ?? ''),
      failedBestCard?.disclosure?.slice(0, 240));
    check('failure: the affected other offer repeats the failed attempt in its own disclosure',
      /Last attempt failed /.test(failedSingleCard?.disclosure ?? ''),
      failedSingleCard?.disclosure?.slice(0, 240));
    check('failure: footer names the failing sources, their consecutive failures and next attempt',
      /source\(s\) failing/i.test(failedUi.visibleText ?? '')
        && /consecutive failure\(s\)/i.test(failedUi.footerDetails ?? '')
        && /last error: HTTP 503/i.test(failedUi.footerDetails ?? ''),
      (failedUi.footerDetails ?? '').split('\n').filter(line => /failing|consecutive|last error/i.test(line)).join(' | '));
  } finally {
    await failedServer.close();
  }

  // Close the session, then remove the driver's child processes before exiting.
  await wd('DELETE', '');
  report.sessionClosed = true;
} catch (error) {
  report.error = error?.stack ?? String(error);
  console.error('browser QA error:', error);
} finally {
  chrome.kill('SIGTERM');
  if (fixtureServer) await fixtureServer.close();
  report.finishedAt = new Date().toISOString();
  report.failed = !report.checks.every(item => item.ok) || Boolean(report.error);
  await mkdir(OUT, { recursive: true });
  await writeFile(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${report.checks.filter(c => c.ok).length}/${report.checks.length} checks passed; report: ${OUT}/report.json`);
  // Explicit exit so a lingering browser/driver child handle cannot keep the runner busy.
  process.exit(report.failed ? 1 : 0);
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
  return response.json();
}

function fetchBoard(baseUrl, grams, dest, variant = 'classico', product = null) {
  const params = new URLSearchParams({ grams: String(grams), dest, variant });
  if (product) params.set('product', product);
  return fetchJson(`${baseUrl}/api/board?${params}`);
}

async function webdriver(method, path, body) {
  const response = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

/** W3C WebDriver returns the element key `element-6066-...`; legacy drivers use `ELEMENT`. */
function elementId(found) {
  const value = found?.value ?? {};
  const id = value['element-6066-11e4-a52e-4f735466cecf'] ?? value.ELEMENT;
  if (!id) throw new Error(`element not found: ${JSON.stringify(found).slice(0, 200)}`);
  return id;
}

async function evaluate(wd, script) {
  const expression = script.trim().startsWith('return') ? script : `return ${script}`;
  const result = await wd('POST', '/execute/sync', { script: expression, args: [] });
  return result.value;
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await delay(250);
  }
  throw new Error(`timeout waiting for ${label}`);
}

/** Poll a page-side expression until it is truthy; report page state on timeout. */
async function waitForPage(wd, expression, timeoutMs, label, probe) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(wd, expression)) return true;
    } catch {
      // Transient evaluate failures (for example during a re-render) are retried.
    }
    await delay(250);
  }
  let detail = '';
  if (probe) {
    try {
      detail = `; page state: ${JSON.stringify(await evaluate(wd, probe))}`;
    } catch (error) {
      detail = `; page state unavailable: ${error?.message ?? error}`;
    }
  }
  throw new Error(`timeout waiting for ${label}${detail}`);
}

async function waitForBoard(wd) {
  await waitFor(async () => evaluate(wd, `document.body.dataset.boardState === 'ready' && !!document.querySelector('#ranked .offer, .empty')`), 20_000, 'board render');
}

async function screenshot(wd, name) {
  const shot = await wd('GET', '/screenshot');
  await writeFile(`${OUT}/${name}`, Buffer.from(shot.value, 'base64'));
}
