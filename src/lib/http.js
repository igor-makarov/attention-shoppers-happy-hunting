// Bounded HTTP fetching for the scheduled refresh pipeline.
// Public routes never call this with user-supplied URLs: hosts come from the
// vendor registry and every request has a timeout and a response size limit.

export const DEFAULT_HTTP_OPTIONS = {
  timeoutMs: 12_000,
  maxBytes: 1_500_000,
  userAgent: 'AttentionShoppersBot/0.1 (+https://github.com/igor-makarov/attention-shoppers-happy-hunting; shopping board refresh)'
};

export class FetchLimitError extends Error {}

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function hostAllowed(url, allowedHosts) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowedHosts.some(allowed => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * Create a fetch helper restricted to an explicit host allowlist.
 * Errors are returned, never thrown, so a broken source cannot abort a refresh.
 *
 * `minIntervalMs` spaces requests to the same host (a vendor robots.txt
 * Crawl-delay); the wait happens before the request, so it is not counted
 * against the per-request timeout, and it is bounded by the number of tracked
 * offers. `sleep` and `clock` are injectable so tests never really wait.
 */
export function createBoundedFetcher({ fetchImpl = globalThis.fetch, allowedHosts = [], onRequest, minIntervalMs = 0, sleep = defaultSleep, clock = () => Date.now(), ...overrides } = {}) {
  const options = { ...DEFAULT_HTTP_OPTIONS, ...overrides };
  const lastRequestAt = new Map();
  return async function fetchText(url, { accept, headers = {}, maxBytes } = {}) {
    if (!hostAllowed(url, allowedHosts)) {
      return { ok: false, status: 0, error: `host not allowed: ${safeHost(url)}`, bytes: 0 };
    }
    const host = safeHost(url).toLowerCase();
    if (minIntervalMs > 0) {
      const previous = lastRequestAt.get(host);
      if (previous != null) {
        const waitMs = previous + minIntervalMs - clock();
        if (waitMs > 0) await sleep(waitMs);
      }
      lastRequestAt.set(host, clock());
    }
    onRequest?.(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), options.timeoutMs);
    const limit = maxBytes ?? options.maxBytes;
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': options.userAgent,
          accept: accept ?? 'text/html,application/json;q=0.9,*/*;q=0.5',
          ...headers
        }
      });
      if (response.url && !hostAllowed(response.url, allowedHosts)) {
        return { ok: false, status: response.status, error: `redirect left allowlist: ${safeHost(response.url)}`, bytes: 0 };
      }
      const reader = response.body ? response.body.getReader() : null;
      const chunks = [];
      let bytes = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > limit) {
            controller.abort('size');
            return { ok: false, status: response.status, error: `response exceeded ${limit} bytes`, bytes };
          }
          chunks.push(value);
        }
      }
      const buffer = concat(chunks, bytes);
      return {
        ok: response.ok,
        status: response.status,
        url: response.url || url,
        contentType: response.headers.get('content-type') || '',
        bytes,
        buffer,
        text: new TextDecoder('utf-8', { fatal: false }).decode(buffer)
      };
    } catch (error) {
      const reason = controller.signal.aborted
        ? (String(controller.signal.reason) === 'size' ? 'response too large' : `timeout after ${options.timeoutMs}ms`)
        : `fetch failed: ${error?.message ?? error}`;
      return { ok: false, status: 0, error: reason, bytes: 0 };
    } finally {
      clearTimeout(timer);
    }
  };
}

function concat(chunks, total) {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalid-url';
  }
}
