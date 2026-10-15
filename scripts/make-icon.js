// Draws the app icon (gradient rounded square with a power symbol) and writes assets/icon.png.
// Pure Node — no image libraries needed.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;

function roundedBoxSdf(x, y, half, radius) {
  const qx = Math.abs(x) - half + radius;
  const qy = Math.abs(y) - half + radius;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

function segmentSdf(px, py, ax, ay, bx, by, r) {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = clamp01((pax * bax + pay * bay) / (bax * bax + bay * bay));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
}

function powerSdf(x, y) {
  const R = 62, T = 13, GAP = (40 * Math.PI) / 180;
  const angleFromTop = Math.atan2(x, -y);
  let ring;
  if (Math.abs(angleFromTop) > GAP) {
    ring = Math.abs(Math.hypot(x, y) - R) - T;
  } else {
    const cx = R * Math.sin(GAP), cy = -R * Math.cos(GAP);
    ring = Math.min(Math.hypot(x - cx, y - cy), Math.hypot(x + cx, y - cy)) - T;
  }
  const bar = segmentSdf(x, y, 0, -84, 0, -14, T);
  return Math.min(ring, bar);
}

const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    const x = px + 0.5 - SIZE / 2;
    const y = py + 0.5 - SIZE / 2 - 11; // symbol spans y -97..75, so shift to centre it
    const bgAlpha = clamp01(0.5 - roundedBoxSdf(x, y + 11, SIZE / 2 - 8, 58));
    const t = (px + py) / (2 * SIZE);
    // #6366f1 -> #a855f7
    let r = lerp(0x63, 0xa8, t), g = lerp(0x66, 0x55, t), b = lerp(0xf1, 0xf7, t);
    const fg = clamp01(0.5 - powerSdf(x, y));
    r = lerp(r, 255, fg);
    g = lerp(g, 255, fg);
    b = lerp(b, 255, fg);
    const i = (py * SIZE + px) * 4;
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = bgAlpha * 255;
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'assets', 'icon.png');
fs.writeFileSync(out, png);
console.log(`Wrote ${out}`);
