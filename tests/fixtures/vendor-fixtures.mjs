// Recorded vendor pages and the URL → fixture routing used by the offline tools.
//
// One source of truth for `npm run check:sources -- --fixture`,
// `npm run cron:offline`, the browser QA fixture server and the unit tests, so a
// new tracked offer cannot silently lose its fixture. Every fixture is a
// minimized excerpt of a real public product page (see docs/SOURCES.md).

import { readFile } from 'node:fs/promises';
import { registeredVendors } from '../../src/vendors/index.js';

/** fixture file per "<vendorId>:<offerId>". */
export const FIXTURE_BY_OFFER = {
  'coffeeman:classico-250g': 'coffeeman-product.windows-1255.html',
  'coffeeman:classico-1000g-4pack': 'coffeeman-4pack-product.windows-1255.html',
  'coffeeman:classico-2000g-8pack': 'coffeeman-8pack-product.windows-1255.html',
  'coffeeman:qualita-oro-250g': 'coffeeman-qualita-oro-product.windows-1255.html',
  'coffeeman:qualita-oro-1000g-4pack': 'coffeeman-qualita-oro-4pack-product.windows-1255.html',
  'coffeeman:qualita-oro-2000g-8pack': 'coffeeman-qualita-oro-8pack-product.windows-1255.html',
  'coffeeman:qualita-rossa-250g': 'coffeeman-qualita-rossa-product.windows-1255.html',
  'coffeeman:suerte-250g': 'coffeeman-suerte-product.windows-1255.html',
  'pucks:classico-250g': 'pucks-product.html',
  'pucks:qualita-oro-250g': 'pucks-qualita-oro-product.html',
  'pucks:qualita-rossa-250g': 'pucks-qualita-rossa-product.html',
  'pucks:qualita-rossa-250g-oos': 'pucks-qualita-rossa-outofstock-product.html',
  'pucks:suerte-250g': 'pucks-suerte-product.html',
  'coffee4u:crema-e-gusto-250g-ground': 'coffee4u-product.windows-1255.html'
};

const WINDOWS_1255 = 'text/html; charset=windows-1255';
const CONTENT_TYPE_BY_FILE = {
  'coffeeman-product.windows-1255.html': WINDOWS_1255,
  'coffeeman-4pack-product.windows-1255.html': WINDOWS_1255,
  'coffeeman-8pack-product.windows-1255.html': WINDOWS_1255,
  'coffeeman-qualita-oro-product.windows-1255.html': WINDOWS_1255,
  'coffeeman-qualita-oro-4pack-product.windows-1255.html': WINDOWS_1255,
  'coffeeman-qualita-oro-8pack-product.windows-1255.html': WINDOWS_1255,
  'coffeeman-qualita-rossa-product.windows-1255.html': WINDOWS_1255,
  'coffeeman-suerte-product.windows-1255.html': WINDOWS_1255,
  'coffeeman-product.outofstock.windows-1255.html': WINDOWS_1255,
  'pucks-product.html': 'text/html; charset=utf-8',
  'pucks-product.outofstock.html': 'text/html; charset=utf-8',
  'pucks-product.preorder.html': 'text/html; charset=utf-8',
  'pucks-qualita-oro-product.html': 'text/html; charset=utf-8',
  'pucks-qualita-rossa-product.html': 'text/html; charset=utf-8',
  'pucks-qualita-rossa-outofstock-product.html': 'text/html; charset=utf-8',
  'pucks-suerte-product.html': 'text/html; charset=utf-8',
  'coffee4u-product.windows-1255.html': WINDOWS_1255,
  'coffee4u-product.outofstock.windows-1255.html': WINDOWS_1255
};

export const FIXTURES_DIR = new URL('./', import.meta.url);

/** Every tracked offer together with the fixture that reproduces its page. */
export function trackedOffers() {
  const offers = [];
  for (const vendor of registeredVendors()) {
    for (const offer of vendor.offers ?? []) {
      const file = FIXTURE_BY_OFFER[`${vendor.id}:${offer.id}`] ?? null;
      offers.push({ vendorId: vendor.id, offerId: offer.id, url: offer.url, productId: offer.productId ?? null, file });
    }
  }
  return offers;
}

const urlToOffer = new Map(trackedOffers().map(offer => [offer.url, offer]));

/** Read a recorded fixture by file name. */
export async function readFixture(file) {
  const bytes = await readFile(new URL(file, FIXTURES_DIR));
  const contentType = CONTENT_TYPE_BY_FILE[file] ?? 'text/html; charset=utf-8';
  return { file, bytes, contentType, text: new TextDecoder('utf-8', { fatal: false }).decode(bytes) };
}

/** Read the fixture that corresponds to a tracked vendor URL, or null. */
export async function readFixtureForUrl(url) {
  const offer = urlToOffer.get(String(url));
  if (!offer?.file) return null;
  return { ...(await readFixture(offer.file)), offer };
}

/** Fixture fetch for the production bounded fetcher shape (returns a Response). */
export function createFixtureFetch() {
  return async (url, init = {}) => {
    const hit = await readFixtureForUrl(url);
    if (!hit) return new Response('no fixture for this URL', { status: 404 });
    void init;
    return new Response(hit.bytes, { status: 200, headers: { 'content-type': hit.contentType } });
  };
}
