// make-icon.js - generate the app icon as a multi-size .ico, with no image dependencies.
//
// Draws into a supersampled float buffer (so edges are antialiased), box-downsamples to each
// size, and writes uncompressed 32-bit BMP entries - the ICO format Windows handles most
// reliably at every size, including 16x16 in the taskbar.
//
//   node scripts/make-icon.js [--out=assets/asteria-farm.ico]
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const OUT = path.resolve(ROOT, argv.out || 'assets/asteria-farm.ico');
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const SS = 4;                        // supersampling factor

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- geometry
/** Rounded rectangle in normalised 0..1 space, with a corner radius in the same units. */
function inRoundRect(u, v, x0, y0, x1, y1, r) {
  if (u < x0 || u > x1 || v < y0 || v > y1) return false;
  const cx = clamp(u, x0 + r, x1 - r);
  const cy = clamp(v, y0 + r, y1 - r);
  const dx = u - cx, dy = v - cy;
  return dx * dx + dy * dy <= r * r;
}

/** Barycentric point-in-triangle. */
function inTri(u, v, ax, ay, bx, by, cx, cy) {
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(d) < 1e-9) return false;
  const l1 = ((by - cy) * (u - cx) + (cx - bx) * (v - cy)) / d;
  const l2 = ((cy - ay) * (u - cx) + (ax - cx) * (v - cy)) / d;
  const l3 = 1 - l1 - l2;
  return l1 >= 0 && l2 >= 0 && l3 >= 0;
}

/** Four-point star (astroid), used as the "Asteria" sparkle. */
function inStar(u, v, cx, cy, r, power = 0.55) {
  const dx = Math.abs(u - cx) / r, dy = Math.abs(v - cy) / r;
  if (dx > 1 || dy > 1) return false;
  return Math.pow(dx, power) + Math.pow(dy, power) <= 1;
}

// ---------------------------------------------------------------- raster
function render(size) {
  const N = size * SS;
  const buf = new Float32Array(N * N * 4);   // straight (non-premultiplied) rgba, 0..1

  const over = (i, r, g, b, a) => {
    if (a <= 0) return;
    const dr = buf[i], dg = buf[i + 1], db = buf[i + 2], da = buf[i + 3];
    const na = a + da * (1 - a);
    if (na <= 0) { buf[i] = buf[i + 1] = buf[i + 2] = buf[i + 3] = 0; return; }
    buf[i] = (r * a + dr * da * (1 - a)) / na;
    buf[i + 1] = (g * a + dg * da * (1 - a)) / na;
    buf[i + 2] = (b * a + db * da * (1 - a)) / na;
    buf[i + 3] = na;
  };

  const X0 = 0.035, Y0 = 0.035, X1 = 0.965, Y1 = 0.965, R = 0.235;
  const BORDER = 0.028;

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N, v = (y + 0.5) / N;
      const i = (y * N + x) * 4;

      // 1. plate: vertical gradient, dark slate
      if (inRoundRect(u, v, X0, Y0, X1, Y1, R)) {
        const t = (v - Y0) / (Y1 - Y0);
        over(i, lerp(0.086, 0.031, t), lerp(0.125, 0.055, t), lerp(0.169, 0.078, t), 1);
      }

      // 2. rim: green ring just inside the edge
      if (inRoundRect(u, v, X0, Y0, X1, Y1, R) &&
        !inRoundRect(u, v, X0 + BORDER, Y0 + BORDER, X1 - BORDER, Y1 - BORDER, R - BORDER * 0.7)) {
        const t = (v - Y0) / (Y1 - Y0);
        over(i, lerp(0.29, 0.09, t), lerp(0.96, 0.72, t), lerp(0.71, 0.48, t), 0.85);
      }

      // 3. play triangle (kept generous so it still reads at 16x16)
      if (inTri(u, v, 0.365, 0.255, 0.365, 0.745, 0.745, 0.500)) {
        const t = clamp((u - 0.365) / 0.38, 0, 1);
        over(i, lerp(0.42, 0.09, t), lerp(1.0, 0.78, t), lerp(0.72, 0.52, t), 1);
      }

      // 4. sparkle (skipped on tiny sizes where it would just be mud)
      if (size >= 48 && inStar(u, v, 0.735, 0.275, 0.085)) {
        over(i, 0.85, 1.0, 0.93, 0.95);
      }
    }
  }

  // box downsample N -> size
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = (((y * SS + sy) * N) + (x * SS + sx)) * 4;
          const pa = buf[i + 3];
          r += buf[i] * pa; g += buf[i + 1] * pa; b += buf[i + 2] * pa; a += pa;
        }
      }
      const n = SS * SS, o = (y * size + x) * 4;
      if (a <= 0) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; continue; }
      out[o] = Math.round(clamp(r / a, 0, 1) * 255);
      out[o + 1] = Math.round(clamp(g / a, 0, 1) * 255);
      out[o + 2] = Math.round(clamp(b / a, 0, 1) * 255);
      out[o + 3] = Math.round(clamp(a / n, 0, 1) * 255);
    }
  }
  return out;
}

// ---------------------------------------------------------------- ICO writer
/** One 32-bit BMP entry: BITMAPINFOHEADER + bottom-up BGRA + AND mask. */
function dib(rgba, size) {
  const maskRow = Math.ceil(size / 32) * 4;
  const xor = size * size * 4;
  const and = maskRow * size;
  const b = Buffer.alloc(40 + xor + and);

  b.writeUInt32LE(40, 0);            // biSize
  b.writeInt32LE(size, 4);           // biWidth
  b.writeInt32LE(size * 2, 8);       // biHeight = XOR + AND
  b.writeUInt16LE(1, 12);            // biPlanes
  b.writeUInt16LE(32, 14);           // biBitCount
  b.writeUInt32LE(0, 16);            // biCompression = BI_RGB
  b.writeUInt32LE(xor + and, 20);    // biSizeImage

  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4;      // BMP rows are bottom-up
    let dst = 40 + y * size * 4;
    for (let x = 0; x < size; x++) {
      const s = srcRow + x * 4;
      b[dst++] = rgba[s + 2];        // B
      b[dst++] = rgba[s + 1];        // G
      b[dst++] = rgba[s];            // R
      b[dst++] = rgba[s + 3];        // A
    }
  }
  // AND mask: all zero (fully opaque by mask; the alpha channel does the real work)
  return b;
}

function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);        // 1 = icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  const parts = [];
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size;     // 0 means 256
    dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir[o + 2] = 0;                          // palette
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);             // planes
    dir.writeUInt16LE(32, o + 6);            // bpp
    dir.writeUInt32LE(e.data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.data.length;
    parts.push(e.data);
  });
  return Buffer.concat([header, dir, ...parts]);
}

// ---------------------------------------------------------------- PNG preview
// A minimal PNG writer so the icon can be eyeballed (and diffed) without any library.
const zlib = require('zlib');
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function png(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;                                  // filter: none
    rgba.copy ? rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
      : Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** One sheet showing every size on a checkerboard, so transparency is visible too. */
function contactSheet(sizes, cell = 300) {
  const cols = sizes.length;
  const W = cols * cell, H = cell;
  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const c = ((x >> 3) + (y >> 3)) & 1 ? 210 : 176;
    out[i] = out[i + 1] = out[i + 2] = c; out[i + 3] = 255;
  }
  sizes.forEach((s, ci) => {
    const img = render(s);
    const pad = 14;
    const draw = Math.min(s, cell - pad * 2);
    const ox = ci * cell + Math.round((cell - draw) / 2);
    const oy = Math.round((cell - draw) / 2);
    // nearest-neighbour upscale so the real pixels are visible
    for (let y = 0; y < draw; y++) for (let x = 0; x < draw; x++) {
      const sx = Math.min(s - 1, Math.floor(x * s / draw));
      const sy = Math.min(s - 1, Math.floor(y * s / draw));
      const si = (sy * s + sx) * 4;
      const a = img[si + 3] / 255;
      const di = ((oy + y) * W + ox + x) * 4;
      out[di] = Math.round(img[si] * a + out[di] * (1 - a));
      out[di + 1] = Math.round(img[si + 1] * a + out[di + 1] * (1 - a));
      out[di + 2] = Math.round(img[si + 2] * a + out[di + 2] * (1 - a));
      out[di + 3] = 255;
    }
  });
  return { buf: out, w: W, h: H };
}

// ---------------------------------------------------------------- main
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const entries = SIZES.map(size => ({ size, data: dib(render(size), size) }));
fs.writeFileSync(OUT, ico(entries));

console.log(`wrote ${OUT}`);
console.log(`sizes: ${SIZES.join(', ')}  (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);

if (argv.preview) {
  const sheet = contactSheet(SIZES);
  const p = path.resolve(ROOT, String(argv.preview));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, png(Buffer.from(sheet.buf.buffer, sheet.buf.byteOffset, sheet.buf.length), sheet.w, sheet.h));
  console.log(`preview: ${p} (${sheet.w}x${sheet.h})`);
}
