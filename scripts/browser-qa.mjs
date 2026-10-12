#!/usr/bin/env node
// Browser QA for the board using the installed headless Chrome via WebDriver.
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
        availability: observation.availability,
        shipping: observation.shipping?.certainty
      }))
    : null;

  const catalog = await fetchJson(`${base}/api/catalog`);
  const api500 = await fetchBoard(base, 500, 'tel-aviv');
  const api1000 = await fetchBoard(base, 1000, 'tel-aviv');
  const api1000Eilat = await fetchBoard(base, 1000, 'eilat');
  const api500Eilat = await fetchBoard(base, 500, 'eilat');
  const best = api500.best;
  if (!best) throw new Error('the board API has no ranked offer, so UI comparison checks cannot run');
  const expected500 = ils(best.totalIls);
  const expectedPerKg = ils(best.ilsPerKg);
  const expected1000 = ils(api1000.best?.totalIls);
  const expected1000Eilat = ils(api1000Eilat.best?.totalIls);
  const expected500Eilat = ils(api500Eilat.best?.totalIls);
  const unknownReasons = [...api500.unrankable, ...api500.staleOrUnavailable].map(quote => quote.reasons.join(' ')).join(' | ');
  const eilatLabel = catalog.destinations.find(item => item.id === 'eilat')?.label ?? 'Eilat';
  report.expectations = { expected500, expectedPerKg, expected1000, expected1000Eilat, expected500Eilat, bestVendor: best.vendor.name };

  if (fixtureServer) {
    check('fixtures: CoffeeMan is the ranked fixture offer at ₪91.00 for 500 g',
      best.vendor.name.includes('CoffeeMan') && best.totalIls === 91 && expected500 === '₪91.00',
      `${best.vendor.name} ${expected500}`);
    check('fixtures: Pucks stays unranked with unknown shipping',
      api500.unrankable.some(quote => quote.vendor.name.includes('Pucks')) && /Shipping is not published before checkout/.test(unknownReasons),
      unknownReasons);
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
  const desktop = await evaluate(wd, `(() => ({
    bestVendor: document.querySelector('.best__vendor')?.textContent ?? null,
    bestTotal: document.querySelector('.best__total')?.textContent ?? null,
    perKg: document.querySelector('.best__perkg')?.textContent ?? null,
    statuses: [...document.querySelectorAll('.status')].map(n => n.textContent.trim()),
    bestLink: document.querySelector('.best a')?.href ?? null,
    unknownVendors: [...document.querySelectorAll('.unknown__vendor')].map(n => n.textContent.trim()),
    unknownReasons: [...document.querySelectorAll('.unknown__reason')].map(n => n.textContent.trim()),
    pickupRows: document.querySelectorAll('.pickup-row').length,
    rankedRows: document.querySelectorAll('table.compare tbody tr').length,
    visibleText: document.body.innerText,
    bidiFragments: document.querySelectorAll('[dir="auto"][lang="he"]').length,
    hasSkipLink: !!document.querySelector('.skip'),
    hasMain: !!document.querySelector('main'),
    quantityPressed: [...document.querySelectorAll('#quantity-group button')].map(b => [b.textContent.trim(), b.getAttribute('aria-pressed')]),
    destinationOptions: [...document.querySelectorAll('#destination option')].map(o => o.textContent.trim()),
    footerStatus: document.getElementById('footer-status')?.textContent ?? null
  }))()`);
  check('desktop: best vendor matches the API ranking', desktop.bestVendor === best.vendor.name, `${desktop.bestVendor} vs ${best.vendor.name}`);
  check(`desktop: delivered total for 500 g is ${expected500}`, desktop.bestTotal === expected500, desktop.bestTotal);
  check(`desktop: per-kilogram normalization shows ${expectedPerKg}`, (desktop.perKg ?? '').includes(`${expectedPerKg} per kilogram`), desktop.perKg);
  check('desktop: stock status has a written label', desktop.statuses.includes(best.availabilityLabel), `${best.availabilityLabel} in [${desktop.statuses.join(' | ')}]`);
  check('desktop: vendor link points at the API product page', desktop.bestLink === best.itemUrl, `${desktop.bestLink} vs ${best.itemUrl}`);
  check('desktop: comparison table lists every ranked offer', desktop.rankedRows === api500.ranked.length && api500.ranked.length >= 2, `rows=${desktop.rankedRows} ranked=${api500.ranked.length}`);
  check('desktop: unknown-shipping offer stays visible with a plain-language reason',
    /Shipping is not published before checkout/.test(desktop.unknownReasons.join(' ')) && desktop.unknownVendors.length === api500.unrankable.length + api500.staleOrUnavailable.length,
    desktop.unknownReasons[0]);
  check('desktop: pickup is displayed separately from delivery', desktop.pickupRows === api500.pickup.length && api500.pickup.length >= 1, `rows=${desktop.pickupRows} api=${api500.pickup.length}`);
  check('desktop: destination selector lists Israeli localities', desktop.destinationOptions.length >= 5, desktop.destinationOptions.join(' | '));
  check('desktop: quantity control marks 500 g pressed', desktop.quantityPressed.some(([label, pressed]) => label === '500 g' && pressed === 'true'), desktop.quantityPressed.join(' | '));
  check('desktop: no emoji in visible text', !EMOJI.test(desktop.visibleText), 'emoji scan');
  check('desktop: Hebrew vendor text is direction-isolated', desktop.bidiFragments >= 1, String(desktop.bidiFragments));
  check('desktop: skip link and main landmark are present', desktop.hasSkipLink && desktop.hasMain, `skip=${desktop.hasSkipLink} main=${desktop.hasMain}`);
  check('desktop: footer reports the last completed refresh instead of a static waiting message',
    /Last completed refresh:/.test(desktop.footerStatus ?? '') && !/Waiting for the first refresh/.test(desktop.footerStatus ?? ''),
    desktop.footerStatus);

  // Unstated variant: the Coffee4U listing is never merged into the Classico
  // ranking. It is selectable on its own, ranked with the published door-to-door
  // rate, and the cheaper pickup-point delivery stays labelled as an alternative.
  const apiUnstated = await fetchBoard(base, 500, 'tel-aviv', 'unspecified');
  check('desktop: offers for another variant are reported as excluded, not merged',
    Number(api500.counts?.excludedByVariant) >= 1 && /another blend variant/.test(desktop.visibleText),
    `excluded=${api500.counts?.excludedByVariant}`);
  await evaluate(wd, `(() => { const select = document.getElementById('variant'); select.value = 'unspecified'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitForPage(wd, `document.querySelector('.best__vendor')?.textContent.includes('Coffee4U')`, 15_000, 'unstated-variant ranking', `({vendor: document.querySelector('.best__vendor')?.textContent ?? null, total: document.querySelector('.best__total')?.textContent ?? null})`);
  const unstated = await evaluate(wd, `(() => {
    const terms = [...document.querySelectorAll('.best__side dt')].map(node => node.textContent);
    const values = [...document.querySelectorAll('.best__side dd')].map(node => node.textContent);
    return {
      vendor: document.querySelector('.best__vendor')?.textContent ?? null,
      total: document.querySelector('.best__total')?.textContent ?? null,
      variant: document.querySelector('.best__variant')?.textContent ?? null,
      terms,
      values,
      links: [...document.querySelectorAll('.best a')].map(node => node.href),
      rowText: [...document.querySelectorAll('table.compare tbody tr')].map(node => node.innerText)
    };
  })()`);
  const expectedUnstated = ils(apiUnstated.best?.totalIls);
  check(`variant: the unstated-variant listing ranks on its own at ${expectedUnstated}`,
    unstated.vendor?.includes('Coffee4U') && unstated.total === expectedUnstated && /Variant not stated/.test(unstated.variant ?? ''),
    `${unstated.vendor} ${unstated.total} vs ${expectedUnstated} (${unstated.variant})`);
  check('variant: the published door-to-door rate is the ranked shipping amount',
    unstated.terms.includes('Shipping') && unstated.values[unstated.terms.indexOf('Shipping')] === ils(apiUnstated.best?.shipping?.amountIls),
    `${unstated.terms.join(' | ')} :: ${unstated.values.join(' | ')}`);
  check('variant: the cheaper pickup-point delivery is labelled as an alternative shipping service',
    unstated.terms.some(term => /pickup point/i.test(term)) && unstated.values.some(value => /published alternative shipping service/.test(value)),
    unstated.terms.join(' | '));
  check('variant: the ranked offer keeps its vendor page link',
    (unstated.links ?? []).some(href => href === apiUnstated.best?.itemUrl), (unstated.links ?? []).join(' '));
  await screenshot(wd, 'desktop-1440-unstated-variant.png');
  await evaluate(wd, `(() => { const select = document.getElementById('variant'); select.value = 'classico'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitForPage(wd, `document.querySelector('.best__vendor')?.textContent.includes('CoffeeMan')`, 15_000, 'restore classico ranking', `({vendor: document.querySelector('.best__vendor')?.textContent ?? null})`);
  await screenshot(wd, 'desktop-1440.png');

  // Product selector: the second tracked product (Lavazza Qualità Oro) has its own board,
  // its own default variant and its own winner, and it never mixes with the first product.
  // The UI is still on 500 g / Tel Aviv at this point, so the expectation is read at the same settings.
  const apiOro = await fetchBoard(base, 500, 'tel-aviv', 'unspecified', 'lavazza-qualita-oro-vacuum-ground');
  const expectedOro = ils(apiOro.best?.totalIls);
  await evaluate(wd, `(() => { const select = document.getElementById('product'); select.value = 'lavazza-qualita-oro-vacuum-ground'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitForPage(wd, `document.querySelector('.section__intro')?.textContent.includes('Qualità Oro')`, 15_000, 'product switch to Qualità Oro', `({intro: document.querySelector('.section__intro')?.textContent ?? null, product: document.getElementById('product')?.value ?? null})`);
  const oro = await evaluate(wd, `({
    intro: document.querySelector('.section__intro')?.textContent ?? null,
    vendor: document.querySelector('.best__vendor')?.textContent ?? null,
    total: document.querySelector('.best__total')?.textContent ?? null,
    variantOptions: [...document.querySelectorAll('#variant option')].map(node => node.textContent.trim()),
    variantValue: document.getElementById('variant')?.value ?? null,
    productOptions: [...document.querySelectorAll('#product option')].map(node => node.textContent.trim()),
    url: location.search,
    tableRows: document.querySelectorAll('table.compare tbody tr').length
  })`);
  check(`product: switching to ${catalog.products[1].line} ranks its own best offer at ${expectedOro}`,
    oro.vendor === apiOro.best?.vendor.name && oro.total === expectedOro && /Qualità Oro/.test(oro.intro ?? ''),
    `${oro.vendor} ${oro.total} vs ${expectedOro} (${oro.intro})`);
  check('product: the second product uses its own default variant, not the first product\'s',
    oro.variantValue === 'unspecified' && oro.variantOptions.length === 1 && /Variant not stated/.test(oro.variantOptions[0] ?? ''),
    `value=${oro.variantValue} options=${oro.variantOptions.join(' | ')}`);
  check('product: the selector lists every tracked product',
    oro.productOptions.length === catalog.products.length && catalog.products.every(item => oro.productOptions.some(label => label.includes(item.line))),
    oro.productOptions.join(' | '));
  check('product: the switch is reflected in the shareable URL',
    /product=lavazza-qualita-oro-vacuum-ground/.test(oro.url ?? ''), oro.url);
  check('product: only offers of the selected product are compared',
    oro.tableRows === apiOro.ranked.length && apiOro.counts?.observed === 4, `rows=${oro.tableRows} ranked=${apiOro.ranked.length} observed=${apiOro.counts?.observed}`);
  await screenshot(wd, 'desktop-1440-qualita-oro.png');

  // Third tracked product (Lavazza Qualità Rossa): its own board, its own offers and a
  // genuinely out-of-stock listing that must stay visible with its written label
  // instead of being dropped or presented as available.
  const apiRossa = await fetchBoard(base, 500, 'tel-aviv', 'unspecified', 'lavazza-qualita-rossa-vacuum-ground');
  const expectedRossa = ils(apiRossa.best?.totalIls);
  await evaluate(wd, `(() => { const select = document.getElementById('product'); select.value = 'lavazza-qualita-rossa-vacuum-ground'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitForPage(wd, `document.querySelector('.section__intro')?.textContent.includes('Qualità Rossa')`, 15_000, 'product switch to Qualità Rossa', `({intro: document.querySelector('.section__intro')?.textContent ?? null, product: document.getElementById('product')?.value ?? null})`);
  const rossa = await evaluate(wd, `({
    intro: document.querySelector('.section__intro')?.textContent ?? null,
    vendor: document.querySelector('.best__vendor')?.textContent ?? null,
    total: document.querySelector('.best__total')?.textContent ?? null,
    variantValue: document.getElementById('variant')?.value ?? null,
    url: location.search,
    tableRows: document.querySelectorAll('table.compare tbody tr').length,
    unknownText: [...document.querySelectorAll('#unknown .unknown')].map(node => node.innerText).join(' || ')
  })`);
  check(`product: switching to ${catalog.products[2].line} ranks its own best offer at ${expectedRossa}`,
    rossa.vendor === apiRossa.best?.vendor.name && rossa.total === expectedRossa && /Qualità Rossa/.test(rossa.intro ?? ''),
    `${rossa.vendor} ${rossa.total} vs ${expectedRossa} (${rossa.intro})`);
  // The compare table only renders when there is more than one ranked offer.
  const expectedRossaRows = apiRossa.ranked.length > 1 ? apiRossa.ranked.length : 0;
  check('product: the third product compares only its own offers with its own default variant',
    rossa.tableRows === expectedRossaRows && apiRossa.counts?.observed === 3 && rossa.variantValue === 'unspecified'
      && !/Crema e Gusto|Qualità Oro/.test(rossa.unknownText ?? ''),
    `rows=${rossa.tableRows}/${expectedRossaRows} ranked=${apiRossa.ranked.length} observed=${apiRossa.counts?.observed} variant=${rossa.variantValue}`);
  check('product: the third product switch is reflected in the shareable URL',
    /product=lavazza-qualita-rossa-vacuum-ground/.test(rossa.url ?? ''), rossa.url);
  const rossaMissing = (apiRossa.unknown ?? []).find(quote => quote.product.sku === 'Lav80') ?? (apiRossa.unknown ?? [])[0];
  // innerText reflects the CSS text-transform (uppercase), so compare case-insensitively.
  check('product: a missing-shipping or out-of-stock offer stays visible with its written label',
    Boolean(rossaMissing)
      && rossa.unknownText.toLowerCase().includes(String(rossaMissing.availabilityLabel).toLowerCase())
      && rossa.unknownText.includes(rossaMissing.vendor.name),
    `${rossaMissing?.availabilityLabel} :: ${rossa.unknownText.slice(0, 160)}`);
  await screenshot(wd, 'desktop-1440-qualita-rossa.png');
  await screenshot(wd, 'desktop-1440-qualita-oro.png');
  await evaluate(wd, `(() => { const select = document.getElementById('product'); select.value = 'lavazza-crema-e-gusto-vacuum-ground'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitForPage(wd, `document.querySelector('.best__vendor')?.textContent.includes('CoffeeMan')`, 15_000, 'restore the first product', `({vendor: document.querySelector('.best__vendor')?.textContent ?? null})`);

  // A shared URL with an untracked variant id (a typo or an old link) must fall back to
  // the product's default variant instead of rendering an empty board.
  await wd('POST', '/url', { url: `${base}/?grams=500&dest=tel-aviv&variant=nope` });
  await waitForBoard(wd);
  const fallbackVariant = await evaluate(wd, `({
    vendor: document.querySelector('.best__vendor')?.textContent ?? null,
    total: document.querySelector('.best__total')?.textContent ?? null,
    variantValue: document.getElementById('variant')?.value ?? null
  })`);
  check('variant: a URL with an untracked variant id falls back to the product default',
    fallbackVariant.variantValue === 'classico' && fallbackVariant.total === expected500,
    JSON.stringify(fallbackVariant));

  // Quantity interaction: click "1 kg".
  const kgButton = await wd('POST', '/element', { using: 'css selector', value: '#quantity-group button[data-grams="1000"]' });
  await wd('POST', `/element/${elementId(kgButton)}/click`, {});
  await waitForPage(wd, `document.querySelector('.best__total')?.textContent === ${JSON.stringify(expected1000)}`, 15_000, `quantity update to 1 kg (${expected1000})`, `({total: document.querySelector('.best__total')?.textContent ?? null, search: location.search, pressed: [...document.querySelectorAll('#quantity-group button')].map(b => b.getAttribute('aria-pressed'))})`);
  const kgState = await evaluate(wd, `({
    total: document.querySelector('.best__total')?.textContent,
    perKg: document.querySelector('.best__perkg')?.textContent,
    url: location.search
  })`);
  check(`interaction: 1 kg updates the delivered total to ${expected1000}`, kgState.total === expected1000, JSON.stringify(kgState));
  check('interaction: per-kg price recalculated for 1 kg', (kgState.perKg ?? '').includes(`${ils(api1000.best?.ilsPerKg)} per kilogram`), kgState.perKg);
  check('interaction: quantity is reflected in the shareable URL', /grams=1000/.test(kgState.url ?? ''), kgState.url);

  // Destination change.
  await evaluate(wd, `(() => { const select = document.getElementById('destination'); select.value = 'eilat'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitForPage(wd, `document.querySelector('.section__intro')?.textContent.includes(${JSON.stringify(eilatLabel)})`, 15_000, 'destination update');
  const eilat = await evaluate(wd, `({ intro: document.querySelector('.section__intro')?.textContent, total: document.querySelector('.best__total')?.textContent })`);
  check(`interaction: destination change recalculates for ${eilatLabel}`, /Eilat/.test(eilat.intro ?? '') && eilat.total === expected1000Eilat, `${eilat.intro} · ${eilat.total} vs ${expected1000Eilat}`);

  // Unknown toggle.
  await evaluate(wd, `(() => { const box = document.getElementById('show-unknown'); box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitForPage(wd, `!document.getElementById('unknown')`, 15_000, 'unknown section hidden');
  const hiddenUnknown = await evaluate(wd, `document.getElementById('unknown') === null`);
  check('interaction: unrankable offers can be hidden but are visible by default', hiddenUnknown === true);
  await evaluate(wd, `(() => { const box = document.getElementById('show-unknown'); box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitForPage(wd, `!!document.getElementById('unknown')`, 15_000, 'unknown section restored');

  // Keyboard: focus the first quantity button, Tab to the next, then activate it with Enter.
  await evaluate(wd, `(() => { document.querySelector('#quantity-group button[data-grams="250"]').focus(); return true; })()`);
  await wd('POST', '/actions', { actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '\uE004' }, { type: 'keyUp', value: '\uE004' }] }] });
  const keyboard = await evaluate(wd, `(() => {
    const active = document.activeElement;
    const style = getComputedStyle(active);
    return { tag: active.tagName, label: active.textContent, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  })()`);
  check('keyboard: Tab moves focus to the next quantity button', keyboard.tag === 'BUTTON' && keyboard.label === '500 g', JSON.stringify(keyboard));
  check('keyboard: focused control shows a visible outline', keyboard.outlineStyle !== 'none' && parseFloat(keyboard.outlineWidth) >= 2, `${keyboard.outlineStyle} ${keyboard.outlineWidth}`);
  await wd('POST', '/actions', { actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '\uE007' }, { type: 'keyUp', value: '\uE007' }] }] });
  await waitForPage(wd, `document.querySelector('.best__total')?.textContent === ${JSON.stringify(expected500Eilat)}`, 15_000, `keyboard activation of the 500 g quantity (${expected500Eilat} to ${eilatLabel})`, `({total: document.querySelector('.best__total')?.textContent ?? null, search: location.search})`);
  check('keyboard: Enter activates the focused quantity and updates the total', true, `total ${expected500Eilat}`);
  await wd('DELETE', '/actions');

  // Mobile scenario.
  await wd('POST', '/window/rect', { width: 390, height: 844, x: 0, y: 0 });
  await wd('POST', '/url', { url: `${base}/?grams=500&dest=tel-aviv` });
  await waitForBoard(wd);
  const mobile = await evaluate(wd, `(() => {
    const rect = document.querySelector('.best').getBoundingClientRect();
    const controls = getComputedStyle(document.querySelector('.controls')).gridTemplateColumns;
    const table = document.querySelector('table.compare');
    const bodyOverflow = document.documentElement.scrollWidth > window.innerWidth + 1;
    return {
      bestFits: rect.width <= window.innerWidth + 1,
      controlColumns: controls,
      tableScrolls: table ? table.closest('.table-wrap').scrollWidth > table.closest('.table-wrap').clientWidth : 'no table',
      bodyOverflow,
      minTap: Math.min(...[...document.querySelectorAll('#quantity-group button')].map(b => b.getBoundingClientRect().height))
    };
  })()`);
  check('mobile: best-choice panel fits the viewport', mobile.bestFits === true, JSON.stringify(mobile));
  check('mobile: controls reflow to a single column', !mobile.controlColumns.includes(' '), mobile.controlColumns);
  check('mobile: page does not scroll horizontally', mobile.bodyOverflow === false, JSON.stringify(mobile));
  check('mobile: quantity buttons keep a 44px touch target', mobile.minTap >= 44, String(mobile.minTap));
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
      const dl = document.querySelector('.best__side dl');
      const dts = dl ? [...dl.querySelectorAll('dt')] : [];
      const dds = dl ? [...dl.querySelectorAll('dd')] : [];
      return {
        rows: dts.map((dt, index) => [dt.textContent.trim(), (dds[index]?.textContent ?? '').trim()]),
        total: document.querySelector('.best__total')?.textContent ?? null,
        labels: [...document.querySelectorAll('.best__side .unknown__reason')].map(node => node.textContent.trim()),
        footer: document.getElementById('footer-status')?.textContent ?? null
      };
    })()`);
    check('terms: demo offer is the ranked best for 2 kg', terms2000.best?.vendor.id === 'qa-terms-demo' && terms.total === expectedTermsTotal, `${terms.total} vs ${expectedTermsTotal} (${terms2000.best?.vendor.id})`);
    check('terms: minimum order is displayed', terms.rows.some(([term, value]) => term === 'Minimum order' && value === '₪30.00 ILS'), JSON.stringify(terms.rows));
    check('terms: free-shipping threshold is displayed', terms.rows.some(([term, value]) => term === 'Free shipping' && value === 'from ₪100.00 ILS'), JSON.stringify(terms.rows));
    check('terms: locality-restricted delivery area is displayed', terms.rows.some(([term, value]) => term === 'Delivery area' && value === 'Only: tel-aviv, eilat'), JSON.stringify(terms.rows));
    check('terms: met free-shipping threshold shows Free and a written label',
      terms.rows.some(([term, value]) => term === 'Shipping' && value === 'Free') && terms.labels.some(text => text.includes('Free shipping threshold met')),
      JSON.stringify(terms.labels));
    check('freshness: a stopped scheduled refresh is labelled in the footer',
      /No completed scheduled refresh for 30 h/.test(terms.footer ?? ''),
      terms.footer);

    // The locality restriction must actually exclude the offer for Jerusalem.
    await wd('POST', '/url', { url: `${termsServer.url}/?grams=2000&dest=jerusalem` });
    await waitForBoard(wd);
    const restricted = await evaluate(wd, `(() => ({
      bestVendor: document.querySelector('.best__vendor')?.textContent ?? null,
      reasons: [...document.querySelectorAll('.unknown__reason')].map(node => node.textContent.trim())
    }))()`);
    check('terms: locality restriction moves the demo offer to the unknown list for Jerusalem',
      restricted.reasons.some(text => text.includes('does not include')),
      JSON.stringify(restricted.reasons));
  } finally {
    await termsServer.close();
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
  await waitFor(async () => evaluate(wd, `document.body.dataset.boardState === 'ready' && !!document.querySelector('.best, .empty')`), 20_000, 'board render');
}

async function screenshot(wd, name) {
  const shot = await wd('GET', '/screenshot');
  await writeFile(`${OUT}/${name}`, Buffer.from(shot.value, 'base64'));
}
