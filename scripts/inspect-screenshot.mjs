#!/usr/bin/env node
// Dependency-free PNG inspector for the coding loop's own screenshots.
//
// The coding agent's file-read tool rejects image input, so this script decodes
// a PNG with node:zlib and renders a coarse luminance/character map plus a
// colour-region map. It is a review aid for layout, density, alignment and
// colour-region checks (for example the Canton Zürich blue panel), not a
// replacement for a human looking at the image or for DOM geometry checks.
//
// Usage:
//   node scripts/inspect-screenshot.mjs <file.png> [--cols 160] [--rows 48]
//                                      [--crop x,y,w,h] [--map color] [--palette]
//
// Output: one character per downsampled cell. Ink density uses
// ` .:-=+*#%@` (dark pixels = denser character); with --map color, cells that
// are clearly blue/green/red/amber print B/G/R/A instead so colour regions
// are visible without terminal colour support.

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RAMP = ' .:-=+*#%@';

export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Not a PNG file');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  let palette = null;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (bitDepth !== 8) throw new Error(`Unsupported bit depth ${bitDepth} (only 8-bit PNGs)`);
  if (interlace !== 0) throw new Error('Interlaced PNGs are not supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`Unsupported PNG colour type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const row = raw.subarray(pos, pos + stride);
    pos += stride;
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? out[x - channels] : 0;
      const up = prev ? prev[x] : 0;
      const upLeft = prev && x >= channels ? prev[x - channels] : 0;
      let value = row[x];
      switch (filter) {
        case 0: break;
        case 1: value += left; break;
        case 2: value += up; break;
        case 3: value += Math.floor((left + up) / 2); break;
        case 4: value += paeth(left, up, upLeft); break;
        default: throw new Error(`Unsupported PNG filter ${filter}`);
      }
      out[x] = value & 0xff;
    }
  }
  return { width, height, channels, colorType, pixels, palette };
}

export const DESIGN_TOKENS = {
  blue: [0x00, 0x70, 0xb4],
  softblue: [0xed, 0xf5, 0xfa],
  green: [0x1a, 0x7f, 0x1f],
  greenSoft: [0xeb, 0xf6, 0xeb],
  red: [0xd9, 0x3c, 0x1a],
  amber: [0x8a, 0x4b, 0x00],
  amberSoft: [0xff, 0xf4, 0xe5],
  muted: [0x66, 0x66, 0x66],
  divider: [0xcc, 0xcc, 0xcc]
};

/** Count pixels matching the Canton Zürich tokens and report their bounding boxes. */
export function paletteReport(image, { tolerance = 6 } = {}) {
  const stats = {};
  for (const name of Object.keys(DESIGN_TOKENS)) stats[name] = { count: 0, minX: Infinity, maxX: -1, minY: Infinity, maxY: -1 };
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = (y * image.width + x) * image.channels;
      const r = image.pixels[index];
      const g = image.pixels[index + 1];
      const b = image.pixels[index + 2];
      for (const [name, [tr, tg, tb]] of Object.entries(DESIGN_TOKENS)) {
        if (Math.abs(r - tr) <= tolerance && Math.abs(g - tg) <= tolerance && Math.abs(b - tb) <= tolerance) {
          const s = stats[name];
          s.count += 1;
          if (x < s.minX) s.minX = x;
          if (x > s.maxX) s.maxX = x;
          if (y < s.minY) s.minY = y;
          if (y > s.maxY) s.maxY = y;
        }
      }
    }
  }
  return stats;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function pixelAt(image, x, y) {
  const { channels, colorType, pixels, palette } = image;
  const index = (y * image.width + x) * channels;
  if (colorType === 3) {
    const p = pixels[index] * 3;
    return [palette[p], palette[p + 1], palette[p + 2]];
  }
  if (colorType === 0 || colorType === 4) return [pixels[index], pixels[index], pixels[index]];
  return [pixels[index], pixels[index + 1], pixels[index + 2]];
}

function classify(r, g, b) {
  if (b > r + 25 && b > g + 15 && b > 90) return 'B';
  if (g > r + 20 && g > b + 20 && g > 80) return 'G';
  if (r > g + 50 && r > b + 50 && r > 120) return 'R';
  if (r > g + 25 && g > b + 15 && r > 150) return 'A';
  return null;
}

export function renderAscii(image, { cols = 160, rows = 48, crop = null, colorMap = false } = {}) {
  const area = crop
    ? { x: crop[0], y: crop[1], w: crop[2], h: crop[3] }
    : { x: 0, y: 0, w: image.width, h: image.height };
  const cellW = area.w / cols;
  const cellH = area.h / rows;
  const lines = [];
  const colorLines = [];
  for (let row = 0; row < rows; row += 1) {
    let line = '';
    let colorLine = '';
    for (let col = 0; col < cols; col += 1) {
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;
      const x0 = Math.floor(area.x + col * cellW);
      const x1 = Math.max(x0 + 1, Math.floor(area.x + (col + 1) * cellW));
      const y0 = Math.floor(area.y + row * cellH);
      const y1 = Math.max(y0 + 1, Math.floor(area.y + (row + 1) * cellH));
      for (let y = y0; y < Math.min(y1, area.y + area.h, image.height); y += 1) {
        for (let x = x0; x < Math.min(x1, area.x + area.w, image.width); x += 1) {
          const [r, g, b] = pixelAt(image, x, y);
          sumR += r; sumG += g; sumB += b; count += 1;
        }
      }
      if (!count) { line += ' '; colorLine += ' '; continue; }
      const r = sumR / count;
      const g = sumG / count;
      const b = sumB / count;
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const ink = 1 - luminance / 255;
      line += RAMP[Math.min(RAMP.length - 1, Math.round(ink * (RAMP.length - 1)))];
      colorLine += classify(r, g, b) ?? ' ';
    }
    lines.push(line.replace(/\s+$/, ''));
    colorLines.push(colorLine.replace(/\s+$/, ''));
  }
  return { lines, colorLines };
}

function parseArgs(argv) {
  const options = { file: null, cols: 160, rows: 48, crop: null, colorMap: false, palette: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--cols') options.cols = Number(argv[++i]);
    else if (arg === '--rows') options.rows = Number(argv[++i]);
    else if (arg === '--crop') options.crop = argv[++i].split(',').map(Number);
    else if (arg === '--map') options.colorMap = argv[++i] === 'color';
    else if (arg === '--palette') options.palette = true;
    else if (!options.file) options.file = arg;
  }
  return options;
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (invokedDirectly) {
  const options = parseArgs(process.argv.slice(2));
  if (!options.file) {
    console.error('Usage: node scripts/inspect-screenshot.mjs <file.png> [--cols 160] [--rows 48] [--crop x,y,w,h] [--map color] [--palette]');
    process.exit(2);
  }
  const image = decodePng(readFileSync(options.file));
  const { lines, colorLines } = renderAscii(image, options);
  console.log(`${options.file} — ${image.width}×${image.height} (${options.cols}×${options.rows} cells)`);
  lines.forEach((line, i) => console.log(line));
  if (options.colorMap) {
    console.log('\nColour regions (B=blue G=green R=red A=amber, blank=neutral):');
    colorLines.forEach(line => console.log(line));
  }
  if (options.palette) {
    console.log('\nDesign-token pixels (exact match, ±6):');
    for (const [name, s] of Object.entries(paletteReport(image))) {
      console.log(`  ${name.padEnd(10)} ${String(s.count).padStart(8)} px${s.count ? `  bbox x${s.minX}-${s.maxX} y${s.minY}-${s.maxY}` : '  (absent)'}`);
    }
  }
}
