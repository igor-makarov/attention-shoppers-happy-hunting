#!/usr/bin/env node
// Reusable interactive browser-research helper (research/development only).
//
// It keeps ONE real headless Google Chrome + ChromeDriver session alive between
// shell invocations, so a researcher can navigate a real vendor site, read the
// rendered page, click/fill/select, wait for JavaScript and take screenshots
// step by step instead of asserting a fixed list of labels.
//
//   npm run research:browser -- start
//   npm run research:browser -- goto https://example.com/product
//   npm run research:browser -- text --limit 200
//   npm run research:browser -- elements "button, a[href*='cart']"
//   npm run research:browser -- click --text "Add to cart"
//   npm run research:browser -- fill "#city" "Tel Aviv"
//   npm run research:browser -- select "#city" --label "תל אביב"
//   npm run research:browser -- wait --text "Shipping" --timeout 15000
//   npm run research:browser -- shot pucks-cart --viewport 1440x1200
//   npm run research:browser -- stop
//
// The session file lives in .shurik-local/browser-research/ (git-ignored) and
// must never be committed: it contains a WebDriver session id, which is a
// browser secret. Screenshots and text dumps are written under
// .shurik-local/browser-research/ too; only curated, secret-free excerpts are
// copied into docs/evidence/.
//
// This helper is deliberately NOT part of the Worker runtime and is never
// imported by src/.

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { RECIPES, listRecipes, recipeById, runRecipe, validateEvidence } from './research-workflow.mjs';

const STATE_DIR = process.env.BROWSER_RESEARCH_DIR ?? '.shurik-local/browser-research';
const SESSION_FILE = path.join(STATE_DIR, 'session.json');
const PORT = Number(process.env.BROWSER_RESEARCH_PORT ?? 9515);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME_BINARY = process.env.CHROME_BINARY ?? '/usr/bin/google-chrome';

const argv = process.argv.slice(2);
const command = argv[0];
const rest = argv.slice(1);

function flag(name, fallback = null) {
  const index = rest.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = rest[index + 1];
  return value && !value.startsWith('--') ? value : true;
}
function positional() {
  const out = [];
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i].startsWith('--')) { if (rest[i + 1] && !rest[i + 1].startsWith('--')) i += 1; continue; }
    out.push(rest[i]);
  }
  return out;
}

async function http(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  return { status: response.status, json, text };
}

async function loadSession() {
  if (!existsSync(SESSION_FILE)) return null;
  try { return JSON.parse(await readFile(SESSION_FILE, 'utf8')); } catch { return null; }
}

async function sessionAlive(session) {
  if (!session?.sessionId) return false;
  const status = await http('GET', `${BASE}/status`).catch(() => null);
  if (!status || status.status !== 200) return false;
  const sessions = status.json?.value?.ready !== undefined ? await http('GET', `${BASE}/sessions`).catch(() => null) : null;
  if (sessions?.json?.value) return sessions.json.value.some(s => s.id === session.sessionId);
  return true;
}

async function requireSession() {
  const session = await loadSession();
  if (!session || !(await sessionAlive(session))) {
    console.error('no live browser session; run: npm run research:browser -- start');
    process.exit(2);
  }
  return session;
}

const wd = (session, method, url, body) => http(method, `${BASE}/session/${session.sessionId}${url}`, body);
const wdValue = async (session, method, url, body) => {
  const result = await wd(session, method, url, body);
  if (result.status >= 400) throw new Error(`${method} ${url} -> ${result.status}: ${result.text.slice(0, 500)}`);
  return result.json?.value;
};

async function evaluate(session, script, args = []) {
  return wdValue(session, 'POST', '/execute/sync', { script, args });
}

async function waitForDriver(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await http('GET', `${BASE}/status`).catch(() => null);
    if (status?.status === 200) return true;
    await delay(250);
  }
  return false;
}

async function start() {
  await mkdir(STATE_DIR, { recursive: true });
  const existing = await loadSession();
  if (existing && (await sessionAlive(existing))) {
    console.log(JSON.stringify({ reused: true, sessionIdPresent: true, startedAt: existing.startedAt, port: PORT }, null, 2));
    return;
  }
  const driverUp = await http('GET', `${BASE}/status`).then(r => r.status === 200).catch(() => false);
  if (!driverUp) {
    const child = spawn('chromedriver', [`--port=${PORT}`, '--allowed-ips='], { detached: true, stdio: 'ignore' });
    child.unref();
    const ready = await waitForDriver(15000);
    if (!ready) throw new Error('chromedriver did not start');
  }
  const created = await http('POST', `${BASE}/session`, {
    capabilities: {
      alwaysMatch: {
        browserName: 'chrome',
        'goog:chromeOptions': {
          binary: CHROME_BINARY,
          args: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--log-level=SEVERE']
        }
      }
    }
  });
  if (created.status >= 400) throw new Error(`session create failed: ${created.text.slice(0, 500)}`);
  const sessionId = created.json.sessionId ?? created.json.value?.sessionId;
  const state = { port: PORT, sessionId, startedAt: new Date().toISOString() };
  await writeFile(SESSION_FILE, JSON.stringify(state, null, 2));
  await wd(state, 'POST', '/timeouts', { implicit: 0, pageLoad: 45_000, script: 30_000 });
  const ua = await evaluate(state, 'return navigator.userAgent;');
  console.log(JSON.stringify({ started: true, startedAt: state.startedAt, port: PORT, userAgent: ua }, null, 2));
}

async function stop() {
  const session = await loadSession();
  if (session) {
    await wd(session, 'DELETE', '').catch(() => null);
  }
  await rm(SESSION_FILE, { force: true });
  // Stop a driver we may have left running; harmless if it is already gone.
  const pids = await new Promise(resolve => {
    const child = spawn('pkill', ['-f', `chromedriver --port=${PORT}`], { stdio: 'ignore' });
    child.on('close', () => resolve(true));
    child.on('error', () => resolve(false));
  }).catch(() => false);
  console.log(JSON.stringify({ stopped: true, driverPkill: pids }));
}

function normalize(text, limit) {
  const value = String(text ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
  return limit ? value.slice(0, Number(limit)) : value;
}

async function goto(session) {
  const [url] = positional();
  if (!url) throw new Error('goto needs a URL');
  await wd(session, 'POST', '/url', { url });
  await delay(Number(flag('settle', 1500)));
  const info = await evaluate(session, 'return {url: location.href, title: document.title, ready: document.readyState};');
  console.log(JSON.stringify(info, null, 2));
}

async function text(session) {
  const [selector] = positional();
  const limit = flag('limit', 12000);
  const grep = flag('grep');
  const out = await evaluate(session, `return (() => {
    const root = arguments[0] ? document.querySelector(arguments[0]) : document.body;
    if (!root) return null;
    return { url: location.href, title: document.title, text: root.innerText };
  })()`, [selector ?? null]);
  if (!out) { console.log('(selector not found)'); return; }
  let body = normalize(out.text, null);
  if (grep) {
    const re = new RegExp(grep, 'i');
    body = body.split('\n').filter(line => re.test(line)).join('\n');
  }
  console.log(`# ${out.title} — ${out.url}`);
  console.log(normalize(body, limit));
}

async function elements(session) {
  const [selector] = positional();
  if (!selector) throw new Error('elements needs a CSS selector');
  const limit = Number(flag('limit', 60));
  const out = await evaluate(session, `return (() => {
    const nodes = [...document.querySelectorAll(arguments[0])].slice(0, arguments[1]);
    return nodes.map(node => {
      const rect = node.getBoundingClientRect();
      const attrs = {};
      for (const name of ['href', 'name', 'id', 'type', 'value', 'placeholder', 'aria-label', 'data-testid', 'role']) {
        const value = node.getAttribute?.(name);
        if (value) attrs[name] = value.slice(0, 160);
      }
      return {
        tag: node.tagName.toLowerCase(),
        cls: typeof node.className === 'string' ? node.className.slice(0, 80) : '',
        text: (node.innerText ?? node.value ?? '').replace(/\\s+/g, ' ').trim().slice(0, 200),
        visible: rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= innerHeight * 3,
        rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
        attrs
      };
    });
  })()`, [selector, limit]);
  console.log(JSON.stringify(out, null, 2));
}

async function click(session) {
  const textMatch = flag('text');
  const linkMatch = flag('link');
  const [selector] = positional();
  let css = selector ?? null;
  let matched = null;
  if (textMatch || linkMatch) {
    const needle = String(textMatch || linkMatch);
    matched = await evaluate(session, `return (() => {
      const needle = arguments[0].toLowerCase();
      const linkOnly = arguments[1] === true;
      const candidates = [...document.querySelectorAll(linkOnly ? 'a' : 'a, button, input[type=submit], input[type=button], [role=button], label')];
      const score = node => {
        const value = (node.innerText ?? node.value ?? '').replace(/\\s+/g, ' ').trim().toLowerCase();
        if (!value) return -1;
        if (value === needle) return 100;
        if (value.includes(needle)) return 50 - Math.min(20, value.length - needle.length);
        return -1;
      };
      const best = candidates.map(node => ({ node, score: score(node) })).filter(c => c.score >= 0)
        .sort((a, b) => b.score - a.score)[0];
      if (!best) return null;
      best.node.setAttribute('data-research-click', '1');
      best.node.scrollIntoView({ block: 'center', inline: 'center' });
      return { tag: best.node.tagName.toLowerCase(), text: (best.node.innerText ?? best.node.value ?? '').replace(/\\s+/g, ' ').trim().slice(0, 200), score: best.score };
    })()`, [needle, Boolean(linkMatch)]);
    if (!matched) throw new Error(`no clickable element matched ${JSON.stringify(needle)}`);
    css = '[data-research-click="1"]';
  }
  if (!css) throw new Error('click needs a CSS selector or --text/--link');
  const element = await wdValue(session, 'POST', '/element', { using: 'css selector', value: css });
  const elementId = element['element-6066-11e4-a52e-4f735466cecf'];
  await wdValue(session, 'POST', `/element/${elementId}/click`, {});
  if (matched) await evaluate(session, `document.querySelector('[data-research-click="1"]')?.removeAttribute('data-research-click');`);
  await delay(Number(flag('settle', 1200)));
  const info = await evaluate(session, 'return {url: location.href, title: document.title};');
  console.log(JSON.stringify({ clicked: matched ?? css, ...info }, null, 2));
}

async function fill(session) {
  const [selector, value] = positional();
  if (!selector || value === undefined) throw new Error('fill needs <selector> <value>');
  const element = await wdValue(session, 'POST', '/element', { using: 'css selector', value: selector });
  const elementId = element['element-6066-11e4-a52e-4f735466cecf'];
  await wdValue(session, 'POST', `/element/${elementId}/clear`, {});
  await wdValue(session, 'POST', `/element/${elementId}/value`, { text: value });
  await delay(Number(flag('settle', 500)));
  const out = await evaluate(session, `(() => { const el = document.querySelector(arguments[0]); return el ? { value: el.value, tag: el.tagName.toLowerCase() } : null; })()`, [selector]);
  console.log(JSON.stringify({ filled: selector, ...out }, null, 2));
}

async function select(session) {
  const [selector] = positional();
  const value = flag('value');
  const label = flag('label');
  if (!selector || (value === null && label === null)) throw new Error('select needs <selector> and --value or --label');
  const out = await evaluate(session, `return (() => {
    const el = document.querySelector(arguments[0]);
    if (!el) return { ok: false, reason: 'selector not found' };
    const options = [...el.options].map(o => ({ value: o.value, label: o.textContent.trim() }));
    const wantedValue = arguments[1];
    const wantedLabel = arguments[2];
    const option = options.find(o => wantedValue !== null && o.value === wantedValue)
      ?? options.find(o => wantedLabel !== null && o.label.includes(wantedLabel));
    if (!option) return { ok: false, reason: 'option not found', options };
    el.value = option.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, selected: option };
  })()`, [selector, value ?? null, label ?? null]);
  console.log(JSON.stringify(out, null, 2));
  await delay(Number(flag('settle', 1500)));
}

async function wait(session) {
  const timeout = Number(flag('timeout', 15000));
  const needle = flag('text');
  const [selector] = positional();
  if (!selector && !needle) throw new Error('wait needs a CSS selector or --text');
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(session, `return (() => {
      const sel = arguments[0];
      const text = arguments[1];
      if (sel) {
        const node = document.querySelector(sel);
        if (node) return { found: true, kind: 'selector', text: (node.innerText ?? '').slice(0, 200) };
      }
      if (text) {
        const body = document.body?.innerText ?? '';
        if (body.toLowerCase().includes(String(text).toLowerCase())) return { found: true, kind: 'text' };
      }
      return { found: false };
    })()`, [selector ?? null, needle ?? null]);
    if (last?.found) break;
    await delay(300);
  }
  console.log(JSON.stringify({ waitedFor: selector ?? needle, ...last }, null, 2));
}

async function shot(session) {
  const [name] = positional();
  if (!name) throw new Error('shot needs a name');
  const viewport = flag('viewport');
  const scroll = flag('scroll');
  const full = Boolean(flag('full', false));
  if (viewport) {
    const [width, height] = String(viewport).split('x').map(Number);
    await wdValue(session, 'POST', '/window/rect', { width, height, x: 0, y: 0 });
  }
  if (full) {
    const height = await evaluate(session, 'return Math.min(12000, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));');
    await wdValue(session, 'POST', '/window/rect', { width: Number(String(viewport ?? '1440').split('x')[0]), height });
  } else if (scroll) {
    await evaluate(session, `document.querySelector(arguments[0])?.scrollIntoView({ block: 'start' }); return true;`, [String(scroll)]);
    await delay(400);
  }
  const result = await wd(session, 'GET', '/screenshot');
  if (result.status >= 400) throw new Error(`screenshot failed: ${result.text.slice(0, 300)}`);
  const buffer = Buffer.from(result.json.value, 'base64');
  await mkdir(STATE_DIR, { recursive: true });
  const file = path.join(STATE_DIR, `${name.replace(/[^a-z0-9_.-]/gi, '_')}.png`);
  await writeFile(file, buffer);
  console.log(JSON.stringify({ file, bytes: buffer.length }, null, 2));
}

async function resize(session) {
  const [size] = positional();
  const [width, height] = String(size ?? '1440x1200').split('x').map(Number);
  const rect = await wdValue(session, 'POST', '/window/rect', { width, height, x: 0, y: 0 });
  const viewport = await evaluate(session, 'return {innerWidth, innerHeight, dpr: devicePixelRatio};');
  console.log(JSON.stringify({ rect, viewport }, null, 2));
}

async function frames(session) {
  const out = await evaluate(session, `return [...document.querySelectorAll('iframe')].map(f => ({ src: f.src, id: f.id, w: f.offsetWidth, h: f.offsetHeight }));`);
  console.log(JSON.stringify(out, null, 2));
}

async function evalCommand(session) {
  const script = positional().join(' ');
  if (!script) throw new Error('eval needs a JS expression');
  const out = await evaluate(session, `return (${script});`);
  console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
}

async function html(session) {
  const [selector] = positional();
  const out = await evaluate(session, `return (() => { const node = arguments[0] ? document.querySelector(arguments[0]) : document.documentElement; return node ? node.outerHTML : null; })()`, [selector ?? null]);
  console.log(normalize(out, flag('limit', 20000)));
}

/**
 * WebDriver adapter for the recipe runner in scripts/research-workflow.mjs.
 * It exposes only navigation/read actions; the runner owns the evidence shape.
 */
function createResearchDriver(session) {
  const evalIn = (script, args = []) => evaluate(session, script, args);
  const findElement = async css => {
    const element = await wdValue(session, 'POST', '/element', { using: 'css selector', value: css });
    return element['element-6066-11e4-a52e-4f735466cecf'];
  };
  /** Mark the best matching node, click it and clear the marker. */
  const clickBest = async (script, args) => {
    const matched = await evalIn(script, args);
    if (!matched) return null;
    const id = await findElement('[data-research-click="1"]');
    await wdValue(session, 'POST', `/element/${id}/click`, {});
    await evalIn(`document.querySelector('[data-research-click="1"]')?.removeAttribute('data-research-click');`);
    await delay(1200);
    return matched;
  };
  return {
    async goto(url) {
      await wd(session, 'POST', '/url', { url });
      await delay(1500);
      return 'navigated';
    },
    /** Navigate only when the page does not already show the expected text. */
    async gotoUnlessText(url, text) {
      const present = await evalIn(`return (document.body?.innerText ?? '').toLowerCase().includes(String(arguments[0]).toLowerCase())`, [text]);
      if (present) return 'skipped';
      await wd(session, 'POST', '/url', { url });
      await delay(1500);
      return 'navigated';
    },
    async clickText(text) {
      const matched = await clickBest(`return (() => {
        const needle = String(arguments[0]).toLowerCase();
        const candidates = [...document.querySelectorAll('a, button, input[type=submit], input[type=button], [role=button], label')];
        const score = node => {
          const value = (node.innerText ?? node.value ?? '').replace(/\\s+/g, ' ').trim().toLowerCase();
          if (!value) return -1;
          if (value === needle) return 100;
          if (value.includes(needle)) return 50 - Math.min(20, value.length - needle.length);
          return -1;
        };
        const best = candidates.map(node => ({ node, score: score(node) })).filter(c => c.score >= 0)
          .sort((a, b) => b.score - a.score)[0];
        if (!best) return null;
        best.node.setAttribute('data-research-click', '1');
        best.node.scrollIntoView({ block: 'center', inline: 'center' });
        return (best.node.innerText ?? best.node.value ?? '').slice(0, 120);
      })()`, [text]);
      if (!matched) throw new Error(`no clickable element matched ${JSON.stringify(text)}`);
      return matched;
    },
    /**
     * Click the first clickable whose visible text matches one of `texts`.
     * Returns the matched label; throws when none matches so the runner records
     * the exact blocker instead of assuming a method was selected.
     */
    async clickAnyText(texts) {
      const matched = await clickBest(`return (() => {
        const needles = (arguments[0] ?? []).map(value => String(value).toLowerCase());
        const candidates = [...document.querySelectorAll('a, button, input[type=submit], input[type=button], [role=button], label, [class*="method" i], [class*="delivery" i]')];
        const score = node => {
          const value = (node.innerText ?? node.value ?? '').replace(/\\s+/g, ' ').trim().toLowerCase();
          if (!value) return -1;
          let best = -1;
          for (const needle of needles) {
            if (value === needle) best = Math.max(best, 100);
            else if (value.includes(needle)) best = Math.max(best, 50 - Math.min(20, value.length - needle.length));
          }
          return best;
        };
        const best = candidates.map(node => ({ node, score: score(node) })).filter(c => c.score >= 0)
          .sort((a, b) => b.score - a.score)[0];
        if (!best) return null;
        best.node.setAttribute('data-research-click', '1');
        best.node.scrollIntoView({ block: 'center', inline: 'center' });
        return (best.node.innerText ?? best.node.value ?? '').replace(/\\s+/g, ' ').trim().slice(0, 120);
      })()`, [texts]);
      if (!matched) throw new Error(`no clickable element matched any of ${JSON.stringify(texts)}`);
      return matched;
    },
    /** Click the first matching CSS selector; returns the selector that worked. */
    async clickSelector(selectors) {
      for (const selector of selectors ?? []) {
        if (!selector) continue;
        const exists = await evalIn(`return !!document.querySelector(arguments[0])`, [selector]);
        if (!exists) continue;
        const id = await findElement(selector);
        await wdValue(session, 'POST', `/element/${id}/click`, {});
        await delay(1200);
        return selector;
      }
      throw new Error(`no element matched any of ${JSON.stringify(selectors)}`);
    },
    async selectLabel(selector, label) {
      const out = await evalIn(`return (() => {
        const el = document.querySelector(arguments[0]);
        if (!el) return { ok: false, reason: 'selector not found' };
        const options = [...el.options].map(o => ({ value: o.value, label: o.textContent.trim() }));
        const option = options.find(o => o.label.includes(String(arguments[1])));
        if (!option) return { ok: false, reason: 'option not found', options: options.slice(0, 20).map(o => o.label) };
        el.value = option.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, selected: option.label };
      })()`, [selector, label]);
      if (!out?.ok) throw new Error(`select ${selector}: ${out?.reason ?? 'failed'}${out?.options ? ` (options: ${out.options.join(', ')})` : ''}`);
      await delay(1500);
      // Return what was selected so the evidence record can verify it against
      // the requested locality instead of trusting the step blindly.
      return out.selected;
    },
    async fill(selector, value) {
      const exists = await evalIn(`return !!document.querySelector(arguments[0])`, [selector]);
      if (!exists) throw new Error(`fill: no element matches ${selector}`);
      const id = await findElement(selector);
      await wdValue(session, 'POST', `/element/${id}/clear`, {});
      await wdValue(session, 'POST', `/element/${id}/value`, { text: String(value) });
      await delay(500);
      // Read the field back so the evidence record can show the value the page
      // actually holds, not just the requested parameter.
      const readback = await evalIn(`return document.querySelector(arguments[0])?.value ?? null`, [selector]);
      return { selector, value: readback };
    },
    /**
     * Set a whole-pack quantity in the cart and return how many packs the page
     * now shows. Handles a classic quantity input and the vendor's stepper
     * markup (value span + increase/decrease buttons, used by Pucks on both the
     * product page and the estimator). Throws when no quantity control is found,
     * so the caller records a blocker instead of assuming a cart size.
     */
    async setQuantity(grams, packGrams) {
      const target = Math.max(1, Math.ceil(Number(grams) / (Number(packGrams) || 250)));
      const quantityScript = `return (() => {
        const apply = arguments[0] === true;
        const target = Number(arguments[1]) || 1;
        const readNumber = node => {
          if (!node) return null;
          const raw = node.value != null && String(node.value).trim() !== '' ? node.value : (node.innerText ?? node.textContent ?? '');
          const n = Number(String(raw).replace(/[^\\d]/g, ''));
          return Number.isFinite(n) && n > 0 ? n : null;
        };
        const visible = node => node.getClientRects().length > 0;
        for (const selector of ['input[name*="qty" i]', 'input[name*="quantity" i]', 'input[id*="qty" i]', 'input[class*="qty" i]']) {
          const input = [...document.querySelectorAll(selector)].find(visible);
          if (!input) continue;
          const before = readNumber(input) ?? 1;
          if (apply && before !== target) {
            input.value = String(target);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return { ok: true, kind: 'input', before, target, after: readNumber(input) ?? target };
        }
        const containers = [...document.querySelectorAll('[class*="qty" i], [class*="quantity" i], [class*="stepper" i]')].filter(visible);
        for (const container of containers) {
          const valueNode = [...container.querySelectorAll('input, [class*="val" i], [class*="value" i], [class*="count" i], [class*="num" i], span')].find(node => readNumber(node) != null);
          const before = readNumber(valueNode);
          if (before == null) continue;
          const buttons = [...container.querySelectorAll('button, [role=button], a')].filter(visible);
          const plus = buttons.find(b => /הגדל|increase|plus|add/i.test((b.getAttribute('aria-label') ?? '') + ' ' + (b.className ?? '')));
          const minus = buttons.find(b => /הקטן|decrease|minus|reduce/i.test((b.getAttribute('aria-label') ?? '') + ' ' + (b.className ?? '')));
          if (!plus && !minus) continue;
          const delta = target - before;
          if (apply && delta !== 0) {
            const button = delta > 0 ? plus : minus;
            if (!button) return { ok: false, reason: 'quantity control has no ' + (delta > 0 ? 'increase' : 'decrease') + ' button' };
            for (let i = 0; i < Math.min(Math.abs(delta), 20); i += 1) button.click();
          }
          return { ok: true, kind: 'stepper', before, target, after: readNumber(valueNode) ?? before };
        }
        return { ok: false, reason: 'no quantity input or stepper found' };
      })()`;
      const applied = await evalIn(quantityScript, [true, target]);
      if (!applied?.ok) throw new Error(applied?.reason ?? 'quantity not set');
      await delay(1200);
      const verified = await evalIn(quantityScript, [false, target]);
      const packs = verified?.ok ? verified.after : applied.after;
      if (!Number.isFinite(packs)) throw new Error('quantity could not be verified after setting it');
      return packs;
    },
    async waitText(text, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = await evalIn(`return (document.body?.innerText ?? '').toLowerCase().includes(String(arguments[0]).toLowerCase())`, [text]);
        if (found) return true;
        await delay(300);
      }
      throw new Error(`timed out waiting for text ${JSON.stringify(text)}`);
    },
    async sleep(ms) {
      await delay(ms);
    },
    async getText() {
      return evalIn('return document.body?.innerText ?? "";');
    },
    async currentUrl() {
      return evalIn('return location.href;');
    }
  };
}

async function recipeCommand(session) {
  const [id] = positional();
  const recipe = recipeById(id);
  if (!recipe) throw new Error(`unknown recipe ${JSON.stringify(id)}; known recipes: ${Object.keys(RECIPES).join(', ')}`);
  const grams = Number(flag('grams', recipe.packGrams));
  const locality = flag('locality');
  const postcode = flag('postcode');
  const out = flag('out');
  const driver = createResearchDriver(session);
  const record = await runRecipe({ recipe, driver, params: { grams, locality, postcode } });
  const validation = validateEvidence(record);
  const payload = { ...record, validation };
  console.log(JSON.stringify(payload, null, 2));
  if (out) {
    const target = path.resolve(String(out));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`);
  }
  if (!validation.ok) process.exitCode = 1;
}

async function main() {
  switch (command) {
    case 'start': return start();
    case 'stop': return stop();
    case 'goto': return goto(await requireSession());
    case 'text': return text(await requireSession());
    case 'elements': return elements(await requireSession());
    case 'click': return click(await requireSession());
    case 'fill': return fill(await requireSession());
    case 'select': return select(await requireSession());
    case 'wait': return wait(await requireSession());
    case 'shot': return shot(await requireSession());
    case 'resize': return resize(await requireSession());
    case 'frames': return frames(await requireSession());
    case 'eval': return evalCommand(await requireSession());
    case 'html': return html(await requireSession());
    case 'recipes':
      console.log(JSON.stringify(listRecipes(), null, 2));
      return;
    case 'recipe': return recipeCommand(await requireSession());
    default:
      console.log(`browser-research commands:
  start | stop
  goto <url> [--settle ms]
  text [selector] [--limit n] [--grep pattern]
  elements <selector> [--limit n]
  click <selector> | click --text "visible label" | click --link "anchor text"
  fill <selector> <value>
  select <selector> --value v | --label "text"
  wait <selector> | wait --text "text" [--timeout ms]
  shot <name> [--viewport 1440x1200] [--scroll selector] [--full]
  resize [WxH] | frames | eval '<js expression>' | html [selector]
  recipes | recipe <id> [--grams n] [--locality "..."] [--postcode ...] [--out evidence.json]`);
      process.exit(command ? 1 : 0);
  }
}

main().catch(error => {
  console.error(`browser-research: ${error.message}`);
  process.exit(1);
});
