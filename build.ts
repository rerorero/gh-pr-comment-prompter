import { deflateSync } from 'node:zlib';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const isWatch = process.argv.includes('--watch');
const outdir = './dist';

// ---------------------------------------------------------------------------
// Step 1: TypeScript bundle
// ---------------------------------------------------------------------------

async function bundle(): Promise<void> {
  const result = await Bun.build({
    entrypoints: ['./src/content.ts', './src/options.ts', './src/background.ts'],
    outdir,
    target: 'browser',
    format: 'iife',
    minify: !isWatch,
    sourcemap: isWatch ? 'inline' : 'none',
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    throw new Error('Build failed');
  }

  console.log('  bundled content.js, options.js and background.js');
}

// ---------------------------------------------------------------------------
// Step 2: Copy static assets
// ---------------------------------------------------------------------------

async function copyStatics(): Promise<void> {
  await Bun.write(`${outdir}/manifest.json`, Bun.file('./manifest.json'));
  await Bun.write(`${outdir}/options.html`, Bun.file('./public/options.html'));
  console.log('  copied manifest.json and options.html');
}

// ---------------------------------------------------------------------------
// Step 3: Generate icons (simple solid-color PNGs, no external dependencies)
// ---------------------------------------------------------------------------

/** CRC-32 implementation for PNG chunk checksums */
function crc32(data: Uint8Array): number {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Build a PNG chunk: length(4) + type(4) + data(N) + crc(4) */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type); // exactly 4 bytes
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes);
  crcInput.set(data, 4);
  const crc = crc32(crcInput);

  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc, false);
  return chunk;
}

/**
 * Create a minimal valid PNG with a two-tone design:
 * - Indigo (#4F46E5) background
 * - White sparkle (4-pointed star + small circle), matching the toolbar button icon
 *
 * SVG source (viewBox 0 0 16 16):
 *   <path d="M8 1 Q9.5 6.5 15 8 Q9.5 9.5 8 15 Q6.5 9.5 1 8 Q6.5 6.5 8 1 Z"/>
 *   <circle cx="13" cy="3" r="1"/>
 */
function createIconPNG(size: number): Uint8Array {
  const BG_R = 79, BG_G = 70, BG_B = 229;
  const FG_R = 255, FG_G = 255, FG_B = 255;

  const scale = size / 16;

  // Sample a quadratic bezier into line segments
  function sampleQuad(
    p0x: number, p0y: number,
    p1x: number, p1y: number,
    p2x: number, p2y: number,
    steps: number
  ): [number, number][] {
    const pts: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      pts.push([
        (u * u * p0x + 2 * u * t * p1x + t * t * p2x) * scale,
        (u * u * p0y + 2 * u * t * p1y + t * t * p2y) * scale,
      ]);
    }
    return pts;
  }

  // Star polygon approximated from the 4 quadratic bezier curves
  const STEPS = 24;
  const star: [number, number][] = [
    ...sampleQuad(8, 1, 9.5, 6.5, 15, 8, STEPS),
    ...sampleQuad(15, 8, 9.5, 9.5, 8, 15, STEPS),
    ...sampleQuad(8, 15, 6.5, 9.5, 1, 8, STEPS),
    ...sampleQuad(1, 8, 6.5, 6.5, 8, 1, STEPS),
  ];

  // Winding-number point-in-polygon test
  function inStar(px: number, py: number): boolean {
    let w = 0;
    for (let i = 0; i < star.length; i++) {
      const [x1, y1] = star[i]!;
      const [x2, y2] = star[(i + 1) % star.length]!;
      const cross = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
      if (y1 <= py) { if (y2 > py  && cross > 0) w++; }
      else           { if (y2 <= py && cross < 0) w--; }
    }
    return w !== 0;
  }

  // Small circle at (13, 3) r=1
  function inCircle(px: number, py: number): boolean {
    const dx = px - 13 * scale, dy = py - 3 * scale;
    return dx * dx + dy * dy <= scale * scale;
  }

  function isIconPixel(px: number, py: number): boolean {
    const cx = px + 0.5, cy = py + 0.5;
    return inStar(cx, cy) || inCircle(cx, cy);
  }

  // Raw image data: one filter byte + RGB per row
  const raw = new Uint8Array(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const rowOffset = y * (1 + size * 3);
    raw[rowOffset] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const pixOffset = rowOffset + 1 + x * 3;
      if (isIconPixel(x, y)) {
        raw[pixOffset] = FG_R;
        raw[pixOffset + 1] = FG_G;
        raw[pixOffset + 2] = FG_B;
      } else {
        raw[pixOffset] = BG_R;
        raw[pixOffset + 1] = BG_G;
        raw[pixOffset + 2] = BG_B;
      }
    }
  }

  // IHDR: width(4), height(4), bit-depth(1), color-type(1=RGB=2), compress(1), filter(1), interlace(1)
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, size, false);
  ihdrView.setUint32(4, size, false);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // RGB

  const compressed = new Uint8Array(deflateSync(raw));

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = pngChunk('IHDR', ihdr);
  const idatChunk = pngChunk('IDAT', compressed);
  const iendChunk = pngChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(
    sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length
  );
  let offset = 0;
  out.set(sig, offset); offset += sig.length;
  out.set(ihdrChunk, offset); offset += ihdrChunk.length;
  out.set(idatChunk, offset); offset += idatChunk.length;
  out.set(iendChunk, offset);
  return out;
}

async function generateIcons(): Promise<void> {
  const iconsDir = join(outdir, 'icons');
  if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });

  for (const size of [16, 48, 128]) {
    const png = createIconPNG(size);
    await Bun.write(join(iconsDir, `icon${size}.png`), png);
  }
  console.log('  generated icons/icon16.png, icon48.png, icon128.png');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function build(): Promise<void> {
  console.log('Building...');
  if (!existsSync(outdir)) mkdirSync(outdir, { recursive: true });
  await Promise.all([bundle(), copyStatics(), generateIcons()]);
  console.log(`Done → ${outdir}/`);
}

if (isWatch) {
  console.log('Watch mode — rebuilding on changes...');
  await build();
  // Simple watch: re-run build every 500ms if source files changed
  // (bun --watch re-runs this script automatically)
} else {
  await build();
}
