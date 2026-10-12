// Text, charset and HTML helpers shared by deterministic vendor adapters.
// Fetched pages are untrusted data. We only extract values with narrow patterns.

const WINDOWS_1255 = 'windows-1255';

export function decodeBuffer(bytes, charset) {
  const encodings = [];
  if (charset) encodings.push(charset.toLowerCase());
  encodings.push(WINDOWS_1255, 'utf-8');
  for (const encoding of encodings) {
    try {
      return new TextDecoder(encoding, { fatal: false }).decode(bytes);
    } catch {
      // Try the next candidate.
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/** Detect the declared charset from a meta tag, defaulting to UTF-8. */
export function declaredCharset(html) {
  const probe = html.slice(0, 4096).toLowerCase();
  const meta = /charset=["']?\s*([a-z0-9_-]+)/i.exec(probe);
  return meta ? meta[1] : 'utf-8';
}

export function decodeHtml(bytes, htmlHint = '') {
  const hint = declaredCharset(htmlHint || decodeBuffer(bytes, 'utf-8'));
  return decodeBuffer(bytes, hint);
}

/**
 * Decode HTML entities in extracted text. Vendor titles publish names such as
 * "Lavazza Qualit&#224; Oro", and an undecoded entity would hide the line name.
 * Only entities are decoded here; fetched markup is still never treated as
 * instructions and never rendered as HTML.
 */
export function decodeEntities(text) {
  if (text == null) return '';
  const NAMED = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '', hellip: '…', ndash: '–', mdash: '—',
    agrave: 'à', aacute: 'á', auml: 'ä', egrave: 'è', eacute: 'é', igrave: 'ì', ograve: 'ò', oacute: 'ó', ugrave: 'ù', ccedil: 'ç',
    Agrave: 'À', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü'
  };
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity) => {
    if (entity.startsWith('#')) {
      const hex = entity[1] === 'x' || entity[1] === 'X';
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return Object.prototype.hasOwnProperty.call(NAMED, entity) ? NAMED[entity] : match;
  });
}

export function stripTags(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

export function collapse(text) {
  return text.replace(/\s+/g, ' ').trim();
}

export function textOf(html) {
  return collapse(stripTags(html));
}

export function firstMatch(text, pattern) {
  const match = pattern.exec(text);
  return match ? match[1] : null;
}

/** Parse a decimal number from a price-like string, tolerating thousands separators. */
export function parseDecimal(value) {
  if (value == null) return null;
  const cleaned = String(value).replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '');
  if (!/\d/.test(cleaned)) return null;
  const parsed = Number(cleaned.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Extract product/offer JSON from an application/ld+json script block. */
export function jsonLdBlocks(html) {
  const blocks = [];
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(match[1]));
    } catch {
      blocks.push(null);
    }
  }
  return blocks;
}

export function findJsonLd(html, type) {
  for (const block of jsonLdBlocks(html)) {
    const items = Array.isArray(block) ? block : [block];
    for (const item of items) {
      if (item && item['@type'] === type) return item;
    }
  }
  return null;
}
