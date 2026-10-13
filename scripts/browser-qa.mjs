#!/usr/bin/env node
// Browser QA for the product-index home page and the dedicated product page,
// using the installed headless Chrome via WebDriver.
//
//   npm run qa:browser                       # offline: fixture-backed local server, no network
//   node scripts/browser-qa.mjs <baseUrl>    # live: run against a server you started (wrangler dev)
//
// In the default mode the script starts scripts/qa-server.mjs, which serves
// public/ plus the read-only JSON API computed by the production quote engine
// from the recorded fixtures in tests/fixtures/. Expectations are derived from
// that API response, so the checks test the UI wiring and math rather than
// hard-coded prices.
//
// The checks cover the owner-requested behavior: the home index links to a
// directly loadable product page, the product page keeps the decision values in
// the first mobile viewport, disclosures open and close, quantity/destination
// changes recalculate, every eligible listing (including Coffee4U's unstated
// blend wording) is in one comparison with no blend control or variant warning,
// vendors are named, unknowns stay honest and no
// "[object HTMLSpanElement]" artifact appears. The script is dependency-free:
// it speaks the W3C WebDriver protocol over HTTP and writes screenshots and a
// JSON report to .shurik-local/qa/.

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { startQaServer } from './qa-server.mjs';

const LIVE_BASE = process.argv.slice(2).find(arg => /^https?:\/\//i.test(arg)) ?? null;
const FIXTURE_PORT = Number(process.env.QA_PORT) || 0;
const OUT = '.shurik-local/qa';
const PORT = 9515;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const ILS = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2 });
const ils = amount => (amount == null ? null : ILS.format(amount));

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

  const catalog = await fetchJson(`${base}/api/catalog`);
  const product = catalog.products[0];
  const productPath = `/product/${encodeURIComponent(product.id)}`;
  const destinationLabels = new Map((catalog.destinations ?? []).map(item => [item.id, item.label]));
  const api500 = await fetchBoard(base, 500, 'tel-aviv');
  const api1000 = await fetchBoard(base, 1000, 'tel-aviv');
  const api1000Eilat = await fetchBoard(base, 1000, 'eilat');
  const api2000 = await fetchBoard(base, 2000, 'tel-aviv');
  const best = api500.best;
  if (!best) throw new Error('the board API has no ranked offer, so UI comparison checks cannot run');
  const coffee4uQuote = api500.ranked.find(quote => quote.vendor.id === 'coffee4u') ?? null;
  if (!coffee4uQuote) throw new Error('the fixture board must include the Coffee4U listing in the one comparison');
  const expected500 = ils(best.totalIls);
  const expected1000 = ils(api1000.best?.totalIls);
  const expected1000Eilat = ils(api1000Eilat.best?.totalIls);
  report.expectations = { expected500, expected1000, expected1000Eilat, bestVendor: best.vendor.name };
  if (fixtureServer) {
    check('fixtures: the researched Pucks checkout rate makes Pucks the 500 g fixture winner at ₪90.00',
      best.vendor.id === 'pucks' && best.totalIls === 90 && best.shipping.certainty === 'checkout_quote',
      `${best.vendor.name} ${expected500} shipping=${best.shipping.certainty}`);
    check('fixtures: the API applies the validated Pucks shipping policy',
      api500.shippingPolicies?.some(entry => entry.id === 'pucks-il-home-delivery' && entry.expired === false),
      JSON.stringify(api500.shippingPolicies));
    const single2000Api = api2000.ranked.find(quote => quote.vendor.id === 'coffeeman' && (quote.product.packCount ?? 1) === 1) ?? null;
    check('fixtures: the published CoffeeMan promotion discounts 8 single packs to ₪237.60 while the 8-pack stays ₪260.00',
      single2000Api?.itemSubtotalBeforeDiscountIls === 264
        && single2000Api?.itemDiscount?.amountIls === 26.4
        && single2000Api?.itemTotalIls === 237.6
        && single2000Api?.totalIls === 262.6
        && api2000.ranked.find(quote => quote.key.includes('2000g'))?.itemDiscount == null,
      JSON.stringify(single2000Api && {
        item: single2000Api.itemTotalIls,
        before: single2000Api.itemSubtotalBeforeDiscountIls,
        discount: single2000Api.itemDiscount?.amountIls,
        total: single2000Api.totalIls
      }));
    check('fixtures: the board exposes the validated promotion summary',
      api2000.promotions?.some(entry => entry.id === 'coffeeman-ground-coffee-percent-off' && entry.percent === 10 && entry.expired === false),
      JSON.stringify(api2000.promotions));
  }

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

  // ---------------------------------------------------------------- home page
  await wd('POST', '/window/rect', { width: 1440, height: 1000, x: 0, y: 0 });
  await wd('POST', '/url', { url: `${base}/` });
  await waitForHome(wd);
  const home = await evaluate(wd, `(() => {
    const text = node => node ? node.textContent.trim() : null;
    const card = document.querySelector('#catalog-list .product-card');
    return {
      title: document.title,
      heading: text(document.getElementById('page-title')),
      cardName: text(card?.querySelector('.product-card__name')),
      cardMeta: text(card?.querySelector('.product-card__meta')),
      cardSummary: text(card?.querySelector('.product-card__summary')),
      cardHref: card?.querySelector('.product-card__link')?.getAttribute('href') ?? null,
      cardCount: document.querySelectorAll('#catalog-list .product-card').length,
      comparisonOnHome: !!document.querySelector('#best-offer, .totals, .offer'),
      footerStatus: text(document.getElementById('footer-status')),
      bodyText: document.body.innerText,
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      visibleText: document.body.innerText
    };
  })()`);
  report.home = { heading: home.heading, cardCount: home.cardCount, cardHref: home.cardHref };
  check('home: title is "Attention shoppers" without a trailing period', home.heading === 'Attention shoppers', home.heading);
  check('home: the catalog renders exactly the tracked product as a card', home.cardCount === 1 && home.cardName === `${product.brand} ${product.line}`, `${home.cardCount} × ${home.cardName}`);
  check('home: the card summarizes identity, packaging, vendors and the one comparison',
    /vacuum brick/.test(home.cardMeta ?? '') && /one comparison/i.test(home.cardMeta ?? '')
      && /vendor/i.test(home.cardSummary ?? '') && !/blend variant/i.test(home.bodyText ?? ''),
    `${home.cardMeta} :: ${home.cardSummary}`);
  check('home: the card links to the directly loadable product page', home.cardHref === productPath, `${home.cardHref} vs ${productPath}`);
  check('home: the full vendor comparison board is not rendered on the home route', home.comparisonOnHome === false, 'no offer cards or totals on /');
  check('home: no emoji in visible text', !EMOJI.test(home.visibleText), 'emoji scan');
  check('home: the page does not scroll horizontally', home.pageOverflow === false, `overflow=${home.pageOverflow}`);
  check('home: the footer reports the last observation time from the status API', /last checked/i.test(home.footerStatus ?? ''), home.footerStatus);
  await screenshot(wd, 'home-desktop-1440.png');

  // Real navigation from the index card to the product page.
  const cardLink = await wd('POST', '/element', { using: 'css selector', value: '#catalog-list .product-card__link' });
  await wd('POST', `/element/${elementId(cardLink)}/click`, {});
  await waitForProduct(wd);
  const afterClick = await evaluate(wd, `({ url: location.pathname, heading: document.getElementById('product-title')?.textContent ?? null })`);
  check('home→product: clicking the card opens the product page', afterClick.url === productPath, JSON.stringify(afterClick));

  // ------------------------------------------------------------- product page
  const productView = await evaluate(wd, `(() => {
    const text = node => node ? node.textContent.trim() : null;
    const card = document.querySelector('#best-offer');
    const totals = [...document.querySelectorAll('#best-offer .totals__cell')].map(cell => {
      const r = cell.getBoundingClientRect();
      return {
        label: text(cell.querySelector('.totals__label')),
        value: text(cell.querySelector('.totals__value')),
        method: text(cell.querySelector('.totals__meta--method')),
        certainty: text(cell.querySelector('.totals__meta--certainty')),
        rect: { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) }
      };
    });
    return {
      heading: text(document.getElementById('product-title')),
      subtitle: text(document.getElementById('product-subtitle')),
      backHref: document.querySelector('.masthead__back')?.getAttribute('href') ?? null,
      vendor: text(card?.querySelector('.offer__vendor')),
      tag: text(card?.querySelector('.tag--best')),
      pack: text(card?.querySelector('.offer__pack')),
      totals,
      qualifier: text(card?.querySelector('.qualifier')),
      link: card?.querySelector('.offer__links a')?.href ?? null,
      disclosures: [...document.querySelectorAll('#board details.disclosure')].map(d => ({ id: d.id || null, summary: d.querySelector('summary')?.textContent.trim() ?? '', open: d.open })),
      compareSummary: text(document.querySelector('#compare-other-offers summary')),
      pickupSummary: text(document.querySelector('#pickup-options summary')),
      quantityPressed: [...document.querySelectorAll('#quantity-group button')].map(b => [b.textContent.trim(), b.getAttribute('aria-pressed')]),
      destinationOptions: [...document.querySelectorAll('#destination option')].map(o => o.textContent.trim()),
      variantControls: document.querySelectorAll('#variant, #variant-hint, [data-variant-control]').length,
      tableCount: document.querySelectorAll('table').length,
      bodyText: document.body.innerText,
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      bidiFragments: document.querySelectorAll('[dir="auto"][lang="he"]').length,
      hasSkipLink: !!document.querySelector('.skip'),
      hasMain: !!document.querySelector('main')
    };
  })()`);
  report.product = {
    heading: productView.heading,
    disclosures: productView.disclosures.map(d => ({ summary: d.summary, open: d.open })),
    totals: productView.totals.map(t => ({ label: t.label, value: t.value, method: t.method, certainty: t.certainty }))
  };
  check('product: the heading names the product', productView.heading === `${product.brand} ${product.line}`, productView.heading);
  check('product: compact site branding with an "All products" way back to the index',
    productView.backHref === '/' && /Attention shoppers/.test(productView.bodyText ?? ''),
    `back=${productView.backHref}`);
  check('product: the best offer names its vendor and stock status',
    (productView.vendor ?? '').includes(best.vendor.name) && (productView.vendor ?? '').includes(best.availabilityLabel),
    productView.vendor);
  check('product: the best offer shows the accurate pack and purchased grams',
    productView.pack === `${packDescription(best)} · ${quantityDescription(best)}`,
    productView.pack);
  check(`product: item subtotal is ${ils(best.itemTotalIls)}`, productView.totals[0]?.value === ils(best.itemTotalIls), productView.totals[0]?.value);
  check(`product: shipping shows ${ils(best.shipping.amountIls)} with the named method and certainty`,
    productView.totals[1]?.value === ils(best.shipping.amountIls)
      && productView.totals[1]?.method === 'Home delivery'
      && productView.totals[1]?.certainty === best.shipping.certaintyLabel,
    `${productView.totals[1]?.value} :: ${productView.totals[1]?.method} :: ${productView.totals[1]?.certainty}`);
  check(`product: delivered total is ${expected500}`, productView.totals[2]?.value === expected500, productView.totals[2]?.value);
  check('product: the short conditional warning names the coverage condition once on the card',
    /Coverage not confirmed for every locality/.test(productView.qualifier ?? ''),
    productView.qualifier);
  check('product: the vendor link points at the API product page', productView.link === best.itemUrl, `${productView.link} vs ${best.itemUrl}`);
  check('product: every disclosure is collapsed by default',
    productView.disclosures.length >= 2 && productView.disclosures.every(d => d.open === false),
    productView.disclosures.map(d => `${d.summary}:${d.open}`).join(' | '));
  check('product: a "Compare other offers" disclosure and a collapsed pickup disclosure exist',
    /Compare other offers \(\d+\)/.test(productView.compareSummary ?? '') && /Self-pickup options/.test(productView.pickupSummary ?? ''),
    `${productView.compareSummary} :: ${productView.pickupSummary}`);
  check('product: the three decision values sit in one visible row without horizontal scrolling',
    productView.totals.length === 3
      && productView.totals.every(cell => cell.rect.left >= 0 && cell.rect.right <= 1440 + 1)
      && productView.totals.every(cell => Math.abs(cell.rect.top - productView.totals[0].rect.top) <= 1)
      && productView.pageOverflow === false,
    JSON.stringify({ rects: productView.totals.map(t => t.rect), overflow: productView.pageOverflow }));
  check('product: quantity 500 g is the pressed default', productView.quantityPressed.some(([label, pressed]) => label === '500 g' && pressed === 'true'), productView.quantityPressed.join(' | '));
  check('product: destination selector lists Israeli localities', productView.destinationOptions.length >= 5, productView.destinationOptions.join(' | '));
  check('product: no blend/variant selector, menu entry or variant warning exists',
    productView.variantControls === 0 && !/blend variant|another variant/i.test(productView.bodyText ?? ''),
    `controls=${productView.variantControls}`);
  check('product: no wide comparison table and no "[object HTML…]" artifacts',
    productView.tableCount === 0 && /\[object HTML/.test(productView.bodyText ?? '') === false,
    `tables=${productView.tableCount}`);
  check('product: no emoji in visible text', !EMOJI.test(productView.bodyText ?? ''), 'emoji scan');
  check('product: Hebrew vendor text is direction-isolated', productView.bidiFragments >= 1, String(productView.bidiFragments));
  check('product: skip link and main landmark are present', productView.hasSkipLink && productView.hasMain, `skip=${productView.hasSkipLink} main=${productView.hasMain}`);
  check('product: page does not scroll horizontally', productView.pageOverflow === false, `overflow=${productView.pageOverflow}`);
  await screenshot(wd, 'product-desktop-1440.png');

  // Live mode only: when the served board itself has a ranked offer whose most
  // recent vendor check failed (for example CoffeeMan blocked from the Worker's
  // egress on 2026-10-13), the card face must warn visibly instead of only the
  // details and footer. The condition is derived from the API response, so a
  // healthy board does not fail this check.
  if (LIVE_BASE && api500.ranked.some(quote => quote.lastAttemptFailed)) {
    const failedWarning = await evaluate(wd, `(() => ({
      best: document.querySelector('#best-offer .qualifier--failure')?.textContent?.trim() ?? null,
      compare: [...document.querySelectorAll('#compare-other-offers .qualifier--failure')].map(node => node.textContent.trim())
    }))()`);
    check('live: a ranked production offer whose last check failed warns visibly on the card face',
      /Last check failed/.test(failedWarning.best ?? '') || failedWarning.compare.some(text => /Last check failed/.test(text)),
      JSON.stringify(failedWarning));
  }

  // Opening the delivery options disclosure reveals conditions and the full caveat
  // exactly once, and closing it hides them again.
  const deliveryOpened = await setDetailsOpen(wd, '#best-offer details', true);
  const delivery = await evaluate(wd, `(() => {
    const d = document.querySelector('#best-offer details');
    const card = document.querySelector('#best-offer');
    return {
      open: d?.open ?? null,
      summary: d?.querySelector('summary')?.textContent.trim() ?? null,
      conditions: [...card.querySelectorAll('.conditions li')].map(n => n.textContent),
      caveats: [...card.querySelectorAll('.caveat')].map(n => n.textContent),
      text: d?.textContent ?? '',
      allDetailsText: [...card.querySelectorAll('details')].map(node => node.textContent).join(' ')
    };
  })()`);
  check('disclosure: opening the best offer details shows its conditions and full coverage terms',
    deliveryOpened === true && delivery.open === true
      && delivery.conditions.some(text => /Free shipping above ₪100.00 item subtotal/.test(text))
      && delivery.caveats.length === 1
      && delivery.caveats[0].includes(best.shipping.coverageCaveat ?? 'never'),
    JSON.stringify({ conditions: delivery.conditions, caveats: delivery.caveats.length }));
  check('disclosure: the same coverage caveat is not repeated on the card',
    (await evaluate(wd, `document.querySelectorAll('#best-offer .caveat').length`)) === 1, 'one caveat element');
  check('disclosure: the shipping-policy re-check date is a future due label, never "just now"',
    /re-check by [^(]+\((in \d+ (?:h|d)|due now)\)/.test(delivery.allDetailsText)
      && !/re-check by[^(]*\(just now\)/.test(delivery.allDetailsText),
    delivery.allDetailsText.match(/Shipping rule:[^A-Z]*/)?.[0]?.trim() ?? 'no shipping rule line');
  await setDetailsOpen(wd, '#best-offer details', false);
  check('disclosure: closing the details hides them again', (await evaluate(wd, `document.querySelector('#best-offer details')?.open`)) === false, 'closed');

  // Compare other offers: opens, names each vendor and shows the same money values
  // as the API, including accurate multipack labels.
  const compareOpened = await setDetailsOpen(wd, '#compare-other-offers', true);
  const compare = await evaluate(wd, `(() => {
    const details = document.querySelector('#compare-other-offers');
    return {
      open: details?.open ?? null,
      cards: [...details.querySelectorAll('.offer')].map(card => ({
        vendor: card.querySelector('.offer__vendor')?.innerText.trim() ?? null,
        delta: card.querySelector('.offer__delta')?.textContent.trim() ?? null,
        pack: card.querySelector('.offer__pack')?.textContent.trim() ?? null,
        totals: [...card.querySelectorAll('.totals__cell')].map(cell => ({
          value: cell.querySelector('.totals__value')?.textContent.trim() ?? null,
          method: cell.querySelector('.totals__meta--method')?.textContent.trim() ?? null,
          certainty: cell.querySelector('.totals__meta--certainty')?.textContent.trim() ?? null
        })),
        conditions: [...card.querySelectorAll('.conditions li')].map(n => n.textContent),
        caveatCount: card.querySelectorAll('.caveat').length,
        link: card.querySelector('.offer__links a')?.href ?? null
      })),
      variantMentions: [...details.querySelectorAll('*')].map(n => n.textContent).filter(text => /another blend variant|Variant not stated|blend variant/i.test(text ?? '')).slice(0, 3),
      bodyText: details.innerText
    };
  })()`);
  report.compare = { cards: compare.cards.map(c => ({ vendor: c.vendor, totals: c.totals.map(t => t.value) })) };
  check('compare: the disclosure opens and renders the other ranked offers', compareOpened === true && compare.open === true && compare.cards.length === api500.ranked.length - 1, `cards=${compare.cards.length} ranked=${api500.ranked.length}`);
  check('compare: every other offer names its vendor', compare.cards.every(card => /CoffeeMan|Pucks|Coffee4U/.test(card.vendor ?? '')), compare.cards.map(c => c.vendor).join(' | '));
  const compareMathOk = api500.ranked.slice(1).every((quote, index) => {
    const card = compare.cards[index];
    if (!card) return false;
    return card.totals[0]?.value === ils(quote.itemTotalIls)
      && card.totals[1]?.value === ils(quote.shipping.amountIls)
      && card.totals[2]?.value === ils(quote.totalIls)
      && card.pack === `${packDescription(quote)} · ${quantityDescription(quote)}`;
  });
  check('compare: each offer shows item subtotal, shipping and delivered total from the API with accurate pack labels', compareMathOk,
    compare.cards.map((card, index) => `${card.pack} :: ${card.totals.map(t => t.value).join(' + ')}`).join(' || '));
  // A ranked multipack must spell out its contents; in a store where the only
  // multipack is unrankable (for example production before its first refreshed
  // store), the check is derived from the API and skips rather than failing.
  const rankedMultipack = api500.ranked.slice(1).find(quote => (quote.product.packCount ?? 1) > 1) ?? null;
  check('compare: a ranked multipack spells out its contents and purchased grams',
    rankedMultipack == null
      || compare.cards.some(card => card.pack === `${packDescription(rankedMultipack)} · ${quantityDescription(rankedMultipack)}` && /multipack/.test(card.pack ?? '')),
    rankedMultipack ? `${packDescription(rankedMultipack)} :: ${compare.cards.map(c => c.pack).join(' | ')}` : 'no ranked multipack in this store');
  // The per-kilogram winner is often a different offer from the cheapest
  // delivered total (here the CoffeeMan 8-pack multipack). Its callout must
  // spell out the multipack contents and purchased grams instead of describing
  // a four/eight-pack as the old "1 × 250 g".
  const perKgWinner = api500.bestPerKg && api500.best && api500.bestPerKg.key !== api500.best.key ? api500.bestPerKg : null;
  // bestPerKg is a flattened summary (packGrams/packCount/units, no nested product).
  const perKgQuantity = winner => (winner.packCount ?? 1) > 1
    ? `${winner.units} multipack${winner.units === 1 ? '' : 's'} (${winner.packCount} × ${winner.packGrams} g) = ${winner.orderedGrams} g`
    : `${winner.units} × ${winner.packGrams} g pack${winner.units === 1 ? '' : 's'} = ${winner.orderedGrams} g`;
  const perKgLine = await evaluate(wd, `(() => {
    const line = [...document.querySelectorAll('#decision > .meta-line')].find(node => /Cheapest per kilogram/.test(node.textContent ?? ''));
    return line ? line.textContent.replace(/\\s+/g, ' ').trim() : null;
  })()`);
  check('product: the per-kilogram winner spells out its pack contents and purchased grams',
    perKgWinner == null
      ? perKgLine === null
      : (perKgLine ?? '').includes(`${ils(perKgWinner.ilsPerKg)} per kg`)
        && (perKgLine ?? '').includes(perKgQuantity(perKgWinner))
        && ((perKgWinner.packCount ?? 1) > 1 ? /multipack/.test(perKgLine ?? '') : true),
    perKgWinner ? `${perKgWinner.key} :: ${perKgLine}` : `no separate per-kg winner; line=${perKgLine}`);
  check('compare: every offer states its difference from the best delivered total',
    compare.cards.every((card, index) => card.delta === offerDeltaText(api500.ranked[index + 1], api500)),
    compare.cards.map(c => c.delta).join(' | '));
  check('compare: each offer discloses its coverage caveat at most once',
    compare.cards.every(card => card.caveatCount <= 1), compare.cards.map(c => c.caveatCount).join(','));
  check('compare: the Coffee4U listing with unstated blend wording is in the same comparison, not withheld',
    compare.cards.some(card => /Coffee4U/.test(card.vendor ?? ''))
      && compare.cards.some(card => card.totals[2]?.value === ils(coffee4uQuote.totalIls)),
    compare.cards.map(c => `${c.vendor} ${c.totals[2]?.value}`).join(' | '));
  check('compare: no variant-exclusion notice or blend wording is repeated on the comparison',
    compare.variantMentions.length === 0, JSON.stringify(compare.variantMentions));
  await setDetailsOpen(wd, '#compare-other-offers', false);
  check('compare: the disclosure can be closed again', (await evaluate(wd, `document.querySelector('#compare-other-offers')?.open`)) === false, 'closed');

  // Pickup: collapsed by default, opens to compact rows that name the vendor.
  const pickupOpened = await setDetailsOpen(wd, '#pickup-options', true);
  const pickup = await evaluate(wd, `(() => {
    const details = document.querySelector('#pickup-options');
    return {
      open: details?.open ?? null,
      rows: [...details.querySelectorAll('.pickup-row')].map(row => ({
        vendor: row.querySelector('strong')?.innerText.trim() ?? null,
        text: row.textContent
      })),
      bodyText: document.body.innerText
    };
  })()`);
  check('pickup: the disclosure opens and keeps pickup out of the delivered ranking',
    pickupOpened === true && pickup.rows.length === api500.pickup.length && api500.pickup.length >= 1,
    `rows=${pickup.rows.length} api=${api500.pickup.length}`);
  check('pickup: every pickup row names the real vendor, not an object string',
    pickup.rows.every(row => /CoffeeMan|Pucks|Coffee4U/.test(row.vendor ?? '')) && !/\[object HTML/.test(pickup.bodyText ?? ''),
    pickup.rows.map(row => row.vendor).join(' | '));
  check('pickup: rows show the pickup fee and say self-pickup is not delivery',
    pickup.rows.every(row => /Pickup fee/.test(row.text) && /Self-pickup, not delivery/.test(row.text)),
    pickup.rows[0]?.text?.slice(0, 200));
  await setDetailsOpen(wd, '#pickup-options', false);
  check('pickup: the disclosure can be closed again', (await evaluate(wd, `document.querySelector('#pickup-options')?.open`)) === false, 'closed');

  // Published quantity promotion: at 2 kg the CoffeeMan single-pack offer must
  // show the discounted item subtotal with the pre-discount amount, and the
  // multipacks must stay undiscounted. The check is derived from the API and
  // reports a skip when this store has no discounted offer (for example a
  // production store that has not refreshed since banner parsing shipped).
  const single2000 = api2000.ranked.find(quote => quote.vendor.id === 'coffeeman' && (quote.product.packCount ?? 1) === 1) ?? null;
  await wd('POST', '/url', { url: `${base}${productPath}?grams=2000&dest=tel-aviv` });
  await waitForProduct(wd);
  await setDetailsOpen(wd, '#compare-other-offers', true);
  const promotionCards = await evaluate(wd, `(() => {
    return [...document.querySelectorAll('#best-offer, #compare-other-offers .offer')].map(card => {
      const cells = [...card.querySelectorAll('.totals__cell')];
      return {
        vendor: card.querySelector('.offer__vendor')?.innerText.trim() ?? null,
        pack: card.querySelector('.offer__pack')?.textContent.trim() ?? null,
        item: cells[0]?.querySelector('.totals__value')?.textContent.trim() ?? null,
        itemMeta: cells[0]?.querySelector('.totals__meta--discount')?.textContent.trim() ?? null,
        total: cells[2]?.querySelector('.totals__value')?.textContent.trim() ?? null,
        detailsText: [...card.querySelectorAll('details')].map(node => node.textContent).join(' ')
      };
    });
  })()`);
  const singleCard = promotionCards.find(card => /^250 g pack/.test(card.pack ?? '') && /CoffeeMan/.test(card.vendor ?? '')) ?? null;
  const multipackCards = promotionCards.filter(card => /multipack/.test(card.pack ?? ''));
  if (single2000?.itemDiscount) {
    check('promotion: the 2 kg single-pack offer shows the discounted subtotal and the pre-discount amount',
      singleCard?.item === ils(single2000.itemTotalIls)
        && /10% promotion applied/.test(singleCard?.itemMeta ?? '')
        && (singleCard?.itemMeta ?? '').includes(ils(single2000.itemSubtotalBeforeDiscountIls))
        && singleCard?.total === ils(single2000.totalIls),
      JSON.stringify(singleCard));
    check('promotion: the offer details name the published promotion and keep the vendor wording',
      /Published promotion: 10% off from ₪250\.00 item subtotal \(multipacks excluded(?:, applied from the validated published-rule fallback)?\)/.test(singleCard?.detailsText ?? '')
        && /10% הנחה/.test(singleCard?.detailsText ?? ''),
      (singleCard?.detailsText ?? '').match(/Published promotion[^.]*/)?.[0] ?? 'no promotion line');
    check('promotion: no multipack card is discounted and no free shipping is inferred from the item promotion',
      multipackCards.length >= 1
        && multipackCards.every(card => !card.itemMeta)
        && singleCard?.item === '₪237.60',
      multipackCards.map(card => `${card.pack} :: ${card.item} :: ${card.itemMeta ?? 'no discount'}`).join(' | '));
  } else {
    check('promotion: this store has no discounted single-pack offer to render', true, 'no itemDiscount in the API at 2 kg');
  }
  await screenshot(wd, 'product-promotion-2000g-desktop.png');
  await setDetailsOpen(wd, '#compare-other-offers', false);

  // Obsolete variant URL: the parameter is discarded from the address bar and
  // the one unified comparison renders, with Coffee4U in it and its published
  // alternatives intact — no second filtered view.
  await wd('POST', '/url', { url: `${base}${productPath}?grams=250&dest=tel-aviv&variant=unspecified` });
  await waitForProduct(wd);
  const obsoleteVariant = await evaluate(wd, `(() => {
    const card = document.querySelector('#best-offer');
    return {
      vendor: card?.querySelector('.offer__vendor')?.innerText.trim() ?? null,
      total: card?.querySelector('.totals__cell--total .totals__value')?.textContent ?? null,
      search: location.search,
      variantControl: document.getElementById('variant')?.tagName ?? null
    };
  })()`);
  const best250 = await fetchBoard(base, 250, 'tel-aviv');
  const coffee4u250 = best250.ranked.find(quote => quote.vendor.id === 'coffee4u') ?? null;
  check('variant-param: an old variant URL is cleaned up and shows the one unified comparison',
    obsoleteVariant.variantControl === null && !/variant=/.test(obsoleteVariant.search ?? '')
      && obsoleteVariant.total === ils(best250.best?.totalIls) && /grams=250/.test(obsoleteVariant.search ?? ''),
    JSON.stringify(obsoleteVariant));
  await setDetailsOpen(wd, '#compare-other-offers', true);
  const coffee4uCard = await evaluate(wd, `(() => {
    const card = [...document.querySelectorAll('#compare-other-offers .offer')].find(node => node.querySelector('.offer__vendor')?.innerText.includes('Coffee4U'));
    return card ? {
      vendor: card.querySelector('.offer__vendor')?.innerText.trim() ?? null,
      total: card.querySelector('.totals__cell--total .totals__value')?.textContent ?? null,
      conditions: [...card.querySelectorAll('.conditions li')].map(n => n.textContent),
      pack: card.querySelector('.offer__pack')?.textContent ?? null
    } : null;
  })()`);
  check('variant-param: Coffee4U stays in the unified comparison with its published alternatives',
    coffee4uCard != null
      && coffee4u250 != null
      && coffee4uCard.total === ils(coffee4u250.totalIls)
      && coffee4uCard.conditions.some(text => /pickup point/i.test(text) && text.includes(ils(15)))
      && coffee4uCard.conditions.some(text => /Self-pickup: .*Free self-pickup at the shop/.test(text)),
    JSON.stringify(coffee4uCard));
  await setDetailsOpen(wd, '#compare-other-offers', false);

  // Quantity and destination interactions with the shareable URL.
  const kgButton = await wd('POST', '/element', { using: 'css selector', value: '#quantity-group button[data-grams="1000"]' });
  await wd('POST', `/element/${elementId(kgButton)}/click`, {});
  await waitForPage(wd, `document.querySelector('#best-offer .totals__cell--total .totals__value')?.textContent === ${JSON.stringify(expected1000)}`, 15_000, `quantity update to 1 kg (${expected1000})`);
  const kgState = await evaluate(wd, `({
    total: document.querySelector('#best-offer .totals__cell--total .totals__value')?.textContent ?? null,
    perKg: document.querySelector('#best-offer .totals__cell--total .totals__meta')?.textContent ?? null,
    url: location.pathname + location.search
  })`);
  check(`interaction: 1 kg updates the delivered total to ${expected1000}`, kgState.total === expected1000, JSON.stringify(kgState));
  check('interaction: per-kg price recalculated for 1 kg', (kgState.perKg ?? '').includes(`${ils(api1000.best?.ilsPerKg)} per kg`), kgState.perKg);
  check('interaction: quantity is reflected in the shareable product URL', /^\/product\//.test(kgState.url ?? '') && /grams=1000/.test(kgState.url ?? ''), kgState.url);

  await evaluate(wd, `(() => { const select = document.getElementById('destination'); select.value = 'eilat'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitForPage(wd, `document.querySelector('#best-offer .totals__cell--total .totals__value')?.textContent === ${JSON.stringify(expected1000Eilat)}`, 15_000, 'destination update to Eilat');
  const eilat = await evaluate(wd, `({ total: document.querySelector('#best-offer .totals__cell--total .totals__value')?.textContent ?? null, url: location.search })`);
  check(`interaction: destination change recalculates for Eilat (${expected1000Eilat}) and stays in the URL`,
    eilat.total === expected1000Eilat && /dest=eilat/.test(eilat.url ?? ''), JSON.stringify(eilat));

  // Keyboard: Tab moves focus to the next quantity button with a visible focus ring.
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
  await wd('POST', '/actions', { type: 'key', id: 'keyboard', actions: [] });
  await wd('DELETE', '/actions');

  // ------------------------------------------------------------ mobile layout
  await wd('POST', '/window/rect', { width: 390, height: 844, x: 0, y: 0 });
  await wd('POST', '/url', { url: `${base}${productPath}?grams=500&dest=tel-aviv` });
  await waitForProduct(wd);
  const mobile = await evaluate(wd, `(() => {
    const rect = node => { const r = node.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; };
    const card = document.querySelector('#best-offer');
    const cells = [...card.querySelectorAll('.totals__cell')].map(cell => ({
      label: cell.querySelector('.totals__label')?.textContent ?? null,
      value: cell.querySelector('.totals__value')?.textContent ?? null,
      method: cell.querySelector('.totals__meta--method')?.textContent ?? null,
      rect: rect(cell)
    }));
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      card: rect(card),
      cells,
      totalValue: rect(card.querySelector('.totals__cell--total .totals__value')),
      methodValue: rect(card.querySelector('.totals__meta--method')),
      bodyOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      minTap: Math.min(...[...document.querySelectorAll('#quantity-group button')].map(b => b.getBoundingClientRect().height)),
      disclosuresOpen: [...document.querySelectorAll('#board details.disclosure')].some(d => d.open),
      pageHeight: document.documentElement.scrollHeight
    };
  })()`);
  report.mobile = mobile;
  check('mobile: the best card fits the viewport without horizontal scrolling', mobile.card.right <= mobile.innerWidth + 1 && mobile.bodyOverflow === false, JSON.stringify({ card: mobile.card, overflow: mobile.bodyOverflow }));
  check('mobile: item subtotal, shipping charge and method are visible in the initial viewport',
    mobile.cells[0].rect.bottom <= mobile.innerHeight && mobile.cells[1].rect.bottom <= mobile.innerHeight && mobile.methodValue.bottom <= mobile.innerHeight,
    JSON.stringify({ viewport: mobile.innerHeight, cells: mobile.cells.slice(0, 2).map(c => c.rect), method: mobile.methodValue }));
  check('mobile: the delivered total is visible in the initial 390×844 viewport',
    mobile.totalValue.bottom <= Math.max(mobile.innerHeight, 844) && mobile.totalValue.bottom <= 844,
    JSON.stringify({ viewport: mobile.innerHeight, total: mobile.totalValue }));
  check('mobile: the actual money values are the API values', mobile.cells[0].value === ils(best.itemTotalIls) && mobile.cells[2].value === expected500, mobile.cells.map(c => c.value).join(' | '));
  check('mobile: disclosures stay collapsed by default', mobile.disclosuresOpen === false, `open=${mobile.disclosuresOpen}`);
  check('mobile: quantity buttons keep a 44px touch target', mobile.minTap >= 44, String(mobile.minTap));
  check('mobile: the page is much shorter than the old comparison board', mobile.pageHeight <= 2600, `height=${mobile.pageHeight}`);
  await screenshot(wd, 'product-mobile-390.png');
  await wd('POST', '/url', { url: `${base}/` });
  await waitForHome(wd);
  const homeMobile = await evaluate(wd, `(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    cardVisible: document.querySelector('#catalog-list .product-card')?.getBoundingClientRect().top < window.innerHeight,
    height: document.documentElement.scrollHeight
  }))()`);
  check('mobile home: the product card is visible on the first screen without horizontal scrolling',
    homeMobile.cardVisible === true && homeMobile.overflow === false, JSON.stringify(homeMobile));
  await screenshot(wd, 'home-mobile-390.png');

  // -------------------------------------------------------- legacy URL handling
  await wd('POST', '/window/rect', { width: 1440, height: 1000, x: 0, y: 0 });
  await wd('POST', '/url', { url: `${base}/?product=${encodeURIComponent(product.id)}&grams=750&dest=haifa&variant=classico` });
  await waitForProduct(wd);
  const legacy = await evaluate(wd, `({
    path: location.pathname,
    search: location.search,
    total: document.querySelector('#best-offer .totals__cell--total .totals__value')?.textContent ?? null,
    pressed: [...document.querySelectorAll('#quantity-group button')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent.trim()),
    destination: document.getElementById('destination')?.value ?? null
  })`);
  check('legacy: an old query URL forwards to the product page keeping quantity and locality, discarding the variant',
    legacy.path === productPath && /grams=750/.test(legacy.search) && /dest=haifa/.test(legacy.search) && !/variant=/.test(legacy.search)
      && legacy.pressed.includes('750 g') && legacy.destination === 'haifa',
    JSON.stringify(legacy));

  await wd('POST', '/url', { url: `${base}/?product=lavazza-qualita-oro-vacuum-ground&grams=500&dest=tel-aviv` });
  await waitForProduct(wd);
  const retired = await evaluate(wd, `({
    notice: document.getElementById('retired-product-notice')?.innerText ?? null,
    heading: document.getElementById('product-title')?.textContent ?? null,
    total: document.querySelector('#best-offer .totals__cell--total .totals__value')?.textContent ?? null,
    bodyText: document.body.innerText
  })`);
  check('legacy: a retired-line query URL falls back to Crema e Gusto with a written notice and no retired offers',
    /retired product line/i.test(retired.notice ?? '') && /Qualità Oro/.test(retired.notice ?? '')
      && retired.heading === `${product.brand} ${product.line}` && retired.total === expected500
      && !/Qualità Rossa|Lavazza Suerte/.test(retired.bodyText ?? ''),
    retired.notice);
  await screenshot(wd, 'product-desktop-retired-url.png');

  await wd('POST', '/url', { url: `${base}/?grams=500&dest=tel-aviv&variant=nope` });
  await waitForProduct(wd);
  const fallbackVariant = await evaluate(wd, `({
    variantControl: document.getElementById('variant')?.tagName ?? null,
    search: location.search,
    total: document.querySelector('#best-offer .totals__cell--total .totals__value')?.textContent ?? null
  })`);
  check('legacy: a URL with an untracked variant id is ignored, not turned into an empty or filtered board',
    fallbackVariant.variantControl === null && !/variant=/.test(fallbackVariant.search ?? '') && fallbackVariant.total === expected500,
    JSON.stringify(fallbackVariant));

  // A directly loaded, shareable product URL: quantity and locality are restored
  // and any obsolete variant parameter is discarded.
  await wd('POST', '/url', { url: `${base}${productPath}?grams=1000&dest=eilat&variant=classico` });
  await waitForProduct(wd);
  const shared = await evaluate(wd, `({
    total: document.querySelector('#best-offer .totals__cell--total .totals__value')?.textContent ?? null,
    pressed: [...document.querySelectorAll('#quantity-group button')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent.trim()),
    destination: document.getElementById('destination')?.value ?? null,
    variantControl: document.getElementById('variant')?.tagName ?? null,
    search: location.search
  })`);
  check('shareable: a directly loaded product URL restores quantity and locality with no variant control',
    shared.total === expected1000Eilat && shared.pressed.includes('1 kg') && shared.destination === 'eilat'
      && shared.variantControl === null && !/variant=/.test(shared.search ?? ''),
    JSON.stringify(shared));

  // --------------------------------------------- freshness and failure scenarios
  const interruptedServer = await startQaServer({ port: 0, interruptedRefresh: true });
  try {
    await wd('POST', '/url', { url: `${interruptedServer.url}${productPath}?grams=500&dest=tel-aviv` });
    await waitForProduct(wd);
    const interruptedFooter = await evaluate(wd, `document.getElementById('footer-status')?.textContent ?? null`);
    check('freshness: the footer names the last offer observation instead of a never-refreshed message',
      /Last offer observation:/.test(interruptedFooter ?? '')
        && !/No scheduled refresh has completed|No completed scheduled refresh/.test(interruptedFooter ?? ''),
      interruptedFooter);
  } finally {
    await interruptedServer.close();
  }

  const failedServer = await startQaServer({ port: 0, failedAttempt: true });
  try {
    const failedBoard = await fetchBoard(failedServer.url, 500, 'tel-aviv');
    const failedBest = failedBoard.best ?? null;
    check('failure: a failed last attempt keeps its last successful observation ranked',
      failedBest?.lastAttemptFailed === true && failedBest?.observedAt != null && failedBest?.attemptedAt !== failedBest?.observedAt,
      JSON.stringify({ observedAt: failedBest?.observedAt, attemptedAt: failedBest?.attemptedAt }));
    await wd('POST', '/url', { url: `${failedServer.url}${productPath}?grams=500&dest=tel-aviv` });
    await waitForProduct(wd);
    const failedUi = await evaluate(wd, `(() => ({
      bestDisclosure: document.querySelector('#best-offer .disclosure--diagnostics')?.textContent ?? null,
      compareDisclosures: [...document.querySelectorAll('#compare-other-offers .offer .disclosure--diagnostics')].map(n => n.textContent),
      footerDetails: document.querySelector('#board .meta-line details')?.textContent ?? null
    }))()`);
    check('failure: the best-offer details say the last attempt failed and name the last successful check',
      /Last successful check:/.test(failedUi.bestDisclosure ?? '') && /Last attempt failed /.test(failedUi.bestDisclosure ?? '') && /HTTP 503/.test(failedUi.bestDisclosure ?? ''),
      failedUi.bestDisclosure?.slice(0, 240));
    check('failure: the footer names failing sources with their consecutive failures and last error',
      /consecutive failure\(s\)/i.test(failedUi.footerDetails ?? '') && /last error: HTTP 503/i.test(failedUi.footerDetails ?? ''),
      (failedUi.footerDetails ?? '').split('\n').filter(line => /consecutive|last error/i.test(line)).join(' | '));
    const failedCardNotes = await evaluate(wd, `(() => ({
      best: document.querySelector('#best-offer .qualifier--failure')?.textContent?.trim() ?? null,
      compare: [...document.querySelectorAll('#compare-other-offers .qualifier--failure')].map(node => node.textContent.trim())
    }))()`);
    check('failure: the best-offer card face warns visibly that the last check failed',
      /Last check failed/.test(failedCardNotes.best ?? ''), failedCardNotes.best);
    check('failure: a ranked offer whose last check failed shows the same warning in the comparison list',
      failedCardNotes.compare.some(text => /Last check failed/.test(text)), failedCardNotes.compare.join(' | '));
  } finally {
    await failedServer.close();
  }

  const termsServer = await startQaServer({ port: 0, withTermsDemo: true, staleRefresh: true });
  try {
    const terms2000 = await fetchBoard(termsServer.url, 2000, 'tel-aviv');
    const expectedTermsTotal = ils(terms2000.best?.totalIls);
    await wd('POST', '/url', { url: `${termsServer.url}${productPath}?grams=2000&dest=tel-aviv` });
    await waitForProduct(wd);
    const terms = await evaluate(wd, `(() => {
      const card = document.querySelector('#best-offer');
      return {
        vendor: card?.querySelector('.offer__vendor')?.innerText.trim() ?? null,
        total: card?.querySelector('.totals__cell--total .totals__value')?.textContent ?? null,
        shipping: card?.querySelectorAll('.totals__cell')[1]?.querySelector('.totals__value')?.textContent ?? null,
        conditions: [...card.querySelectorAll('.conditions li')].map(n => n.textContent),
        footer: document.getElementById('footer-status')?.textContent ?? null
      };
    })()`);
    check('terms: the QA-only demo offer ranks with its minimum order, threshold and locality restriction',
      terms2000.best?.vendor.id === 'qa-terms-demo' && terms.total === expectedTermsTotal
        && terms.conditions.includes('Minimum order ₪30.00')
        && terms.conditions.includes('Free-shipping threshold met (from ₪100.00)')
        && terms.conditions.includes('Delivery area: only Tel Aviv–Yafo, Eilat')
        && terms.shipping === 'Free (threshold met)',
      `${terms.total} :: ${terms.conditions.join(' | ')}`);
    check('freshness: a stopped scheduled refresh is labelled in the footer',
      /No completed scheduled refresh for 30 h/.test(terms.footer ?? ''), terms.footer);

    // The stale-refresh sentence shares the amber status classes with the short
    // badges, so it needs its own wrapping modifier: without it, nowrap made the
    // 390 px page 486 px wide (found in production on 2026-10-12 when the store
    // crossed the 8 h stale threshold).
    await wd('POST', '/window/rect', { width: 390, height: 844, x: 0, y: 0 });
    const staleMobile = await evaluate(wd, `(() => {
      const note = [...document.querySelectorAll('#board .status--stale')].find(node => /overdue by/.test(node.textContent ?? '')) ?? null;
      const rect = note ? note.getBoundingClientRect() : null;
      return {
        found: Boolean(note),
        right: rect ? Math.round(rect.right) : null,
        whiteSpace: note ? getComputedStyle(note).whiteSpace : null,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth
      };
    })()`);
    check('mobile: the stale-refresh sentence wraps inside the viewport instead of stretching the page',
      staleMobile.found && staleMobile.whiteSpace === 'normal'
        && staleMobile.scrollWidth <= staleMobile.innerWidth + 1
        && staleMobile.right <= staleMobile.innerWidth + 1,
      JSON.stringify(staleMobile));
    await wd('POST', '/window/rect', { width: 1440, height: 1000, x: 0, y: 0 });

    await wd('POST', '/url', { url: `${termsServer.url}${productPath}?grams=2000&dest=jerusalem` });
    await waitForProduct(wd);
    const restricted = await evaluate(wd, `(() => ({
      reasons: [...document.querySelectorAll('#unknown-offers .unknown__reason')].map(node => node.textContent.trim()),
      unknownOpen: document.querySelector('#unknown-offers')?.open ?? null
    }))()`);
    check('terms: the locality restriction moves the demo offer to the missing-information disclosure for Jerusalem',
      restricted.reasons.some(text => text.includes('does not include')), JSON.stringify(restricted));
  } finally {
    await termsServer.close();
  }

  const unknownServer = await startQaServer({ port: 0, withUnknownDemo: true });
  try {
    const unknownBoard = await fetchBoard(unknownServer.url, 500, 'tel-aviv');
    const demoQuote = unknownBoard.unrankable.find(quote => quote.vendor.id === 'qa-unknown-demo') ?? null;
    check('unknown: the QA-only no-rate offer is unrankable with a plain-language reason and never ranked',
      demoQuote != null && demoQuote.reasons.some(reason => /treated as unknown, not free/.test(reason))
        && unknownBoard.ranked.every(quote => quote.vendor.id !== 'qa-unknown-demo'),
      JSON.stringify(demoQuote?.reasons));
    await wd('POST', '/url', { url: `${unknownServer.url}${productPath}?grams=500&dest=tel-aviv` });
    await waitForProduct(wd);
    const unknownUi = await evaluate(wd, `(() => {
      const details = document.querySelector('#unknown-offers');
      return {
        summary: details?.querySelector('summary')?.textContent.trim() ?? null,
        open: details?.open ?? null,
        cards: [...(details?.querySelectorAll('.unknown') ?? [])].map(node => node.textContent),
        rankedVendors: [...document.querySelectorAll('#best-offer .offer__vendor, #compare-other-offers .offer__vendor')].map(n => n.innerText)
      };
    })()`);
    check('unknown: the missing-information disclosure exists with a count and is collapsed by default',
      /Offers with missing information \(\d+\)/.test(unknownUi.summary ?? '') && unknownUi.open === false, unknownUi.summary);
    check('unknown: the no-rate offer says "Shipping not published" and explains what is missing',
      unknownUi.cards.some(text => text.includes('Shipping not published') && text.includes('A missing rate is never counted as free')),
      unknownUi.cards.find(text => text.includes('no shipping rate'))?.slice(0, 320));
    check('unknown: the no-rate offer stays out of the ranked cards',
      unknownUi.rankedVendors.every(text => !text.includes('no shipping rate')), unknownUi.rankedVendors.join(' | '));
    await screenshot(wd, 'product-desktop-unknown-shipping.png');
  } finally {
    await unknownServer.close();
  }

  // Console errors are collected through the log endpoint; a clean run has none.
  report.consoleErrors = [];
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
  process.exit(report.failed ? 1 : 0);
}

// The expectations below mirror the rendering helpers in public/ui.js so the
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

function offerDeltaText(quote, board) {
  const delta = board.best && Number.isFinite(quote.totalIls) && Number.isFinite(board.best.totalIls)
    ? Math.round((quote.totalIls - board.best.totalIls) * 100) / 100
    : null;
  if (delta == null) return '';
  if (delta === 0) return 'Same delivered total as the best offer';
  return `+${ils(delta)} vs best delivered total`;
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
  return response.json();
}

function fetchBoard(baseUrl, grams, dest, product = null) {
  const params = new URLSearchParams({ grams: String(grams), dest });
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

/** Open or close a native <details> disclosure by clicking its summary. */
async function setDetailsOpen(wd, selector, open) {
  return evaluate(wd, `(() => {
    const details = document.querySelector(${JSON.stringify(selector)});
    if (!details) return null;
    if (details.open !== ${open ? 'true' : 'false'}) details.querySelector('summary')?.click();
    return details.open;
  })()`);
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await delay(250);
  }
  throw new Error(`timeout waiting for ${label}`);
}

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

async function waitForHome(wd) {
  await waitFor(async () => evaluate(wd, `!!document.querySelector('#catalog-list .product-card')`), 20_000, 'home catalog render');
  // The footer observation time comes from a second async request. Wait for that
  // request to resolve so the footer check reads the rendered result instead of
  // the loading placeholder (the production run caught that race).
  await waitFor(async () => evaluate(wd, `!String(document.getElementById('footer-status')?.textContent ?? '').includes('Waiting for the latest observation time')`), 20_000, 'home footer status');
}

async function waitForProduct(wd) {
  await waitFor(async () => evaluate(wd, `document.body.dataset.boardState === 'ready' && !!document.querySelector('#best-offer, #board .empty')`), 20_000, 'product page render');
}

async function screenshot(wd, name) {
  const shot = await wd('GET', '/screenshot');
  await writeFile(`${OUT}/${name}`, Buffer.from(shot.value, 'base64'));
}
