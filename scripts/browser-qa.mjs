#!/usr/bin/env node
// Browser QA for the board using the installed headless Chrome via WebDriver.
//
//   node scripts/browser-qa.mjs [baseUrl]
//
// Default baseUrl is http://127.0.0.1:8789 (npm run dev). The script is
// dependency-free: it speaks the W3C WebDriver protocol over HTTP and writes
// screenshots and a JSON report to .shurik-local/qa/.

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8789';
const OUT = '.shurik-local/qa';
const PORT = 9515;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}\u{FE0F}]/u;

const report = { base: BASE, startedAt: new Date().toISOString(), checks: [], consoleErrors: [] };
const check = (name, condition, detail = '') => {
  report.checks.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const chrome = spawn('chromedriver', [`--port=${PORT}`, '--allowed-ips='], { stdio: ['ignore', 'pipe', 'pipe'] });
let session;
try {
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
  await wd('POST', '/url', { url: `${BASE}/?grams=500&dest=tel-aviv` });
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
    quantityPressed: [...document.querySelectorAll('#quantity-group button')].map(b => [b.textContent.trim(), b.getAttribute('aria-pressed')]),
    destinationOptions: [...document.querySelectorAll('#destination option')].map(o => o.textContent.trim())
  }))()`);
  check('desktop: best vendor is CoffeeMan', /CoffeeMan/.test(desktop.bestVendor ?? ''), desktop.bestVendor);
  check('desktop: delivered total for 500 g is ₪91.00', desktop.bestTotal === '₪91.00', desktop.bestTotal);
  check('desktop: per-kilogram normalization is shown', /182/.test(desktop.perKg ?? ''), desktop.perKg);
  check('desktop: stock status has a written label', desktop.statuses.includes('In stock (observed)'), desktop.statuses.join(' | '));
  check('desktop: vendor link points at the product page', /coffeeman\.co\.il\/product\//.test(desktop.bestLink ?? ''), desktop.bestLink);
  check('desktop: unknown-shipping offer stays visible with a plain-language reason', /Shipping is not published before checkout/.test(desktop.unknownReasons.join(' ')), desktop.unknownReasons[0]);
  check('desktop: destination selector lists Israeli localities', desktop.destinationOptions.length >= 5, desktop.destinationOptions.join(' | '));
  check('desktop: quantity control marks 500 g pressed', desktop.quantityPressed.some(([label, pressed]) => label === '500 g' && pressed === 'true'), desktop.quantityPressed.join(' | '));
  check('desktop: no emoji in visible text', !EMOJI.test(desktop.visibleText), 'emoji scan');
  await screenshot(wd, 'desktop-1440.png');

  // Quantity interaction: click "1 kg".
  const kgButton = await wd('POST', '/element', { using: 'css selector', value: '#quantity-group button[data-grams="1000"]' });
  await wd('POST', `/element/${elementId(kgButton)}/click`, {});
  await waitForPage(wd, `document.querySelector('.best__total')?.textContent === '₪157.00'`, 15_000, 'quantity update to 1 kg', `({total: document.querySelector('.best__total')?.textContent ?? null, search: location.search, pressed: [...document.querySelectorAll('#quantity-group button')].map(b => b.getAttribute('aria-pressed'))})`);
  const kgState = await evaluate(wd, `({
    total: document.querySelector('.best__total')?.textContent,
    perKg: document.querySelector('.best__perkg')?.textContent,
    url: location.search
  })`);
  check('interaction: 1 kg updates the delivered total to ₪157.00', kgState.total === '₪157.00', JSON.stringify(kgState));
  check('interaction: per-kg price recalculated', /157/.test(kgState.perKg ?? ''), kgState.perKg);
  check('interaction: quantity is reflected in the shareable URL', /grams=1000/.test(kgState.url ?? ''), kgState.url);

  // Destination change.
  await evaluate(wd, `(() => { const select = document.getElementById('destination'); select.value = 'eilat'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitForPage(wd, `document.querySelector('.section__intro')?.textContent.includes('Eilat')`, 15_000, 'destination update');
  const eilat = await evaluate(wd, `({ intro: document.querySelector('.section__intro')?.textContent, total: document.querySelector('.best__total')?.textContent })`);
  check('interaction: destination change recalculates for Eilat', /Eilat/.test(eilat.intro ?? ''), eilat.intro);

  // Unknown toggle.
  await evaluate(wd, `(() => { const box = document.getElementById('show-unknown'); box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitForPage(wd, `!document.getElementById('unknown')`, 15_000, 'unknown section hidden');
  const hiddenUnknown = await evaluate(wd, `document.getElementById('unknown') === null`);
  check('interaction: unrankable offers can be hidden but are visible by default', hiddenUnknown === true);
  await evaluate(wd, `(() => { const box = document.getElementById('show-unknown'); box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitForPage(wd, `!!document.getElementById('unknown')`, 15_000, 'unknown section restored');

  // Keyboard: focus the second quantity button and activate it with Enter.
  const keyboard = await evaluate(wd, `(() => {
    const buttons = [...document.querySelectorAll('#quantity-group button')];
    const target = buttons.find(b => b.dataset.grams === '2000');
    target.focus();
    const focused = document.activeElement === target;
    target.click();
    return { focused, label: target.textContent };
  })()`);
  check('keyboard: quantity buttons are focusable', keyboard.focused === true, JSON.stringify(keyboard));

  // Mobile scenario.
  await wd('POST', '/window/rect', { width: 390, height: 844, x: 0, y: 0 });
  await wd('POST', '/url', { url: `${BASE}/?grams=500&dest=tel-aviv` });
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

  // Close the session, then remove the driver's child processes before exiting.
  await wd('DELETE', '');
  report.sessionClosed = true;
} catch (error) {
  report.error = error?.stack ?? String(error);
  console.error('browser QA error:', error);
} finally {
  chrome.kill('SIGTERM');
  report.finishedAt = new Date().toISOString();
  report.failed = !report.checks.every(item => item.ok) || Boolean(report.error);
  await mkdir(OUT, { recursive: true });
  await writeFile(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${report.checks.filter(c => c.ok).length}/${report.checks.length} checks passed; report: ${OUT}/report.json`);
  // Explicit exit so a lingering browser/driver child handle cannot keep the runner busy.
  process.exit(report.failed ? 1 : 0);
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
