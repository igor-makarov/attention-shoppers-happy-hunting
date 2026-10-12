// Smoke tests for the dependency-free screenshot inspector used by the visual
// review (scripts/inspect-screenshot.mjs). The tool decodes real Chrome PNGs
// with node:zlib; these tests lock the decode, the ASCII renderer and the
// Canton Zürich token-pixel report so the review path cannot silently rot.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { decodePng, renderAscii, paletteReport, DESIGN_TOKENS } from '../scripts/inspect-screenshot.mjs';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

/** Minimal 8-bit RGBA PNG encoder (filter 0), only for test fixtures. */
function makePng(width, height, pixels) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

test('the inspector decodes an 8-bit RGBA PNG and reports its pixels', () => {
  const pixels = Buffer.from([
    0, 112, 180, 255, 237, 245, 250, 255,
    255, 255, 255, 255, 26, 127, 31, 255
  ]);
  const image = decodePng(makePng(2, 2, pixels));
  assert.equal(image.width, 2);
  assert.equal(image.height, 2);
  assert.equal(image.channels, 4);
  const ascii = renderAscii(image, { cols: 2, rows: 2 });
  assert.equal(ascii.lines.length, 2);
  assert.equal(ascii.colorLines[0][0], 'B', 'the official Blau pixel is classified as blue');
  assert.equal(ascii.colorLines[1][1], 'G', 'the in-stock green pixel is classified as green');
  const palette = paletteReport(image);
  assert.equal(palette.blue.count, 1);
  assert.equal(palette.softblue.count, 1);
  assert.equal(palette.green.count, 1);
  assert.equal(palette.red.count, 0);
});

test('the inspector decodes a real Chrome screenshot and finds the design tokens', () => {
  const image = decodePng(readFileSync('docs/evidence/visual-review/production-390-20261012.png'));
  assert.equal(image.width, 390);
  assert.ok(image.height > 600, `expected a mobile viewport screenshot, got ${image.height}px`);
  const palette = paletteReport(image);
  assert.ok(palette.softblue.count > 100, `expected soft-blue surfaces, got ${palette.softblue.count} px`);
  assert.ok(palette.blue.count > 100, `expected blue rules/values, got ${palette.blue.count} px`);
  for (const name of Object.keys(DESIGN_TOKENS)) {
    assert.ok(Number.isFinite(palette[name].count), `${name} is reported`);
  }
});

test('the inspector rejects non-PNG input instead of guessing', () => {
  assert.throws(() => decodePng(Buffer.from('not a png')), /Not a PNG file/);
});
