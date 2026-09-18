#!/usr/bin/env node
// Regenerate the placeholder images in `public/img/`.
//
// The application has no image data of its own — no uploads, no CMS, no avatar service —
// but `NgOptimizedImage` cannot be demonstrated, gated or measured without real files: the
// directive reads the intrinsic dimensions off the decoded image to check them against the
// `width`/`height` it was given, and a broken `<img>` reports no intrinsic size at all. So
// the fixtures are generated, checked in, and this script is how they are reproduced.
//
// Generated rather than drawn, for the same reason `activity-log.data.ts` generates its
// rows: a fixture nobody can rebuild is a fixture nobody can change. The output is
// byte-identical on every run — fixed palette, fixed geometry, no timestamp, deflate at a
// fixed level — so re-running this on an unmodified tree produces no diff.
//
// They are deliberately plain: flat bands of colour and a diagonal, obviously placeholder
// art. An avatar fixture that looked like a photograph of a person would invite someone to
// ship it, and the actors in `activity-log.data.ts` are `*.sample@example.test` for the
// same reason.
//
// PNG is written here by hand rather than through a dependency. The format's minimum is
// three chunks — IHDR, IDAT, IEND — each length-prefixed and CRC-32 tagged, with IDAT
// holding zlib-deflated scanlines that each open with a filter byte. `node:zlib` supplies
// the deflate, which is the only part worth a library. Adding an image-processing
// dependency to produce four flat-coloured squares would be the larger cost.
//
// Usage:  node scripts/dev/make-placeholder-images.mjs
//         node scripts/dev/make-placeholder-images.mjs --check   (fail if files would change)

import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** sRGB triples, dark enough that white `alt` text over a broken image stays readable. */
const PALETTE = [
  [37, 99, 235], // blue
  [13, 148, 136], // teal
  [147, 51, 234], // violet
  [219, 39, 119], // pink
  [202, 138, 4], // amber
  [5, 150, 105], // emerald
];

/**
 * What gets written.
 *
 * Intrinsic sizes are larger than any rendered size in the application, because a fixed
 * `<img>` under a configured loader is served at `width` and `2 × width` — so the source
 * has to cover the 2× candidate or the retina image is an upscale. The brand mark renders
 * at 28 CSS pixels, the avatars at 32 and the banner at 448×168.
 */
const IMAGES = [
  { path: 'public/img/brand-mark.png', size: 256, colour: PALETTE[0], accent: [255, 255, 255] },
  // The auth banner is the one non-square fixture: it is the largest element painted on
  // `/login` and `/register`, and a 1:1 hero would be a strange thing to put at the top of
  // a card. 896×336 covers the 2× candidate of a 448×168 rendered box.
  {
    path: 'public/img/auth-banner.png',
    width: 896,
    height: 336,
    colour: PALETTE[2],
    accent: [255, 255, 255],
  },
  ...PALETTE.map((colour, index) => ({
    path: `public/img/avatar-${index + 1}.png`,
    size: 128,
    colour,
    accent: [255, 255, 255],
  })),
];

/** CRC-32, as PNG specifies it (reflected, 0xEDB88320, pre/post-inverted). */
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** One length-prefixed, CRC-tagged PNG chunk. */
function chunk(type, data) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 'ascii');

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])), 0);

  return Buffer.concat([header, data, crc]);
}

/**
 * An 8-bit RGB PNG of `size × size`.
 *
 * Filter byte 0 (None) on every scanline: the images are flat colour, so the row filters
 * that exist to help deflate find structure have nothing to improve on, and None keeps the
 * encoder to the few lines above.
 */
function encodePng(width, height, pixel) {
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));

  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const offset = rowStart + 1 + x * 3;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Flat `colour` with an `accent` diagonal band — enough to tell two fixtures apart. */
function placeholder(width, height, colour, accent) {
  const band = Math.round(Math.min(width, height) / 8);
  return (x, y) => {
    // Scaled so the band crosses a non-square fixture corner to corner rather than
    // clipping out of one end of it.
    const distance = Math.abs(x / width + y / height - 1) * Math.min(width, height);
    return distance < band ? accent : colour;
  };
}

const check = process.argv.includes('--check');
let changed = 0;

for (const image of IMAGES) {
  const { path, colour, accent } = image;
  const width = image.width ?? image.size;
  const height = image.height ?? image.size;
  const absolute = join(repoRoot, path);
  const bytes = encodePng(width, height, placeholder(width, height, colour, accent));

  if (check) {
    let existing = null;
    try {
      existing = readFileSync(absolute);
    } catch {
      existing = null;
    }
    if (existing === null || !existing.equals(bytes)) {
      console.error(`::error file=${path}::out of date — run node scripts/dev/make-placeholder-images.mjs`);
      changed += 1;
    }
    continue;
  }

  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, bytes);
  console.log(`${relative(repoRoot, absolute)}  ${width}×${height}  ${bytes.length} bytes`);
}

if (check) {
  if (changed > 0) process.exit(1);
  console.log(`make-placeholder-images --check: clean (${IMAGES.length} image(s) up to date)`);
}
