/**
 * Minimal PNG codec (RGBA8 / truecolour+alpha, no interlace).
 *
 * Extracted from `measure-object-bases.mjs` in T-23.02, when
 * `measure-building-bodies.mjs` needed the same decoder. Copying seventy lines
 * of bit-twiddling into a second script would have been two decoders to keep
 * correct, and the second copy is the one nobody re-reads.
 *
 * Deliberately hand-rolled rather than a dependency: these scripts are
 * developer tooling that must run from a bare checkout, and the pack is plain
 * RGBA8 throughout.
 *
 * **Phase U added the encoder**, which is why the header no longer says
 * "decode". `prepare-assets.mjs` stopped needing a codec in T-7.02 and its
 * header said that if a transform were ever needed again, the right move was to
 * bring the codec back rather than reach for a native dependency. A transform
 * was needed again: `border-image` slices a nine-slice from the *source image's
 * own outer edges*, so the pack's 48x16 button plate — a sub-region of an
 * 848x544 atlas — cannot be sliced where it sits. Cutting each frame into its
 * own file is the whole fix, and `cropPng` + `encodePng` are what cuts it.
 */

import { deflateSync, inflateSync } from 'node:zlib';


/* ------------------------------------------------------------------ *
 * Minimal PNG decode (RGBA8 / truecolour+alpha, no interlace)
 * ------------------------------------------------------------------ */

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colourType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNGs are not supported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    pos += 12 + len;
  }

  if (bitDepth !== 8 || colourType !== 6) {
    throw new Error(`expected 8-bit RGBA, got depth ${bitDepth} colourType ${colourType}`);
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = Buffer.alloc(height * stride);

  // Undo the per-scanline filters. Byte-for-byte the spec's algorithm.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);

    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? cur[i - 4] : 0;
      const b = prev[i];
      const c = i >= 4 ? prev[i - 4] : 0;
      const x = line[i];
      let v;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`bad filter ${filter}`);
      cur[i] = v & 0xff;
    }
  }

  return { width, height, data: out };
}

export const alphaAt = (img, x, y) => img.data[(y * img.width + x) * 4 + 3];


/* ------------------------------------------------------------------ *
 * Crop
 * ------------------------------------------------------------------ */

/**
 * Cut `w`x`h` out of `img` at `(x, y)`, as a new image.
 *
 * Bounds are checked rather than clamped. A crop rectangle that runs off the
 * sheet is a measurement that has gone stale — the pack was reorganised, or a
 * number was typed rather than measured — and silently returning a short image
 * would turn that into a nine-slice with one blank edge, which reads as a
 * rendering bug three files away from its cause.
 */
export function cropPng(img, x, y, w, h) {
  if (w <= 0 || h <= 0) throw new Error(`crop ${w}x${h}: dimensions must be positive`);
  if (x < 0 || y < 0 || x + w > img.width || y + h > img.height) {
    throw new Error(
      `crop ${w}x${h} at (${x},${y}) does not fit in ${img.width}x${img.height}`,
    );
  }

  const out = Buffer.alloc(w * h * 4);
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * img.width + x) * 4;
    img.data.copy(out, row * w * 4, from, from + w * 4);
  }
  return { width: w, height: h, data: out };
}


/* ------------------------------------------------------------------ *
 * Minimal PNG encode (RGBA8 / truecolour+alpha, no interlace)
 * ------------------------------------------------------------------ */

/**
 * CRC-32, the PNG spec's Annex D table, built once on first use.
 *
 * Node has no public CRC-32, and `zlib.crc32` only arrived in Node 20.15 —
 * newer than this repo promises to run on, and not worth a version floor for
 * fourteen lines.
 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  // The CRC covers the type and the data, but not the length. Spec §5.3.
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * Write `{width, height, data}` (RGBA8) as a PNG buffer.
 *
 * **Every scanline is filter type 0 (None).** The adaptive filtering the spec
 * describes exists to help the deflate stage, and these outputs are sixteen
 * pixels tall — the difference is bytes, and the cost of getting Paeth wrong in
 * an encoder nothing else validates is a corrupt asset that still opens in half
 * the tools that read it.
 *
 * There is no unit test because `scripts/` belongs to no package and the repo
 * has no root test runner. `prepare-assets.mjs` does better than one anyway: it
 * decodes every crop it writes and compares it pixel-for-pixel against the
 * source rectangle, so the codec is re-proved on every `pnpm assets` rather
 * than once in CI — and the same check catches a crop rectangle that has gone
 * stale against a reorganised pack.
 */
export function encodePng({ width, height, data }) {
  const stride = width * 4;
  if (data.length !== stride * height) {
    throw new Error(`expected ${stride * height} bytes for ${width}x${height}, got ${data.length}`);
  }

  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive (the only one defined)
  ihdr[12] = 0; // interlace: none

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
