/**
 * Builds og-image.png from real catalog thumbnails, styled like in-game polaroids
 * (white frame, square photo, caption band, rounded corners, drop shadow).
 *
 * Requires network to fetch Commons thumbnails. Run after build:animals.
 *
 * Usage: node scripts/generate-og-image.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ANIMALS_PATH = path.join(ROOT, 'data', 'animals.json');
const OUT_PATH = path.join(ROOT, 'og-image.png');

const UA =
  'CreatureClick/1.0 (https://creature.click; static game; og-image build script)';

/** Display names to feature — must exist in data/animals.json */
const FEATURE_NAMES = ['Red panda', 'Tiger', 'Penguin'];

const CANVAS_W = 1200;
const CANVAS_H = 630;

/* Match css/styles.css .polaroid--thumb + .polaroid__caption (1rem = 16px) */
const REM = 16;
const PAD_TOP = Math.round(0.5 * REM);
const PAD_H = Math.round(0.6 * REM);
const PHOTO = 248;
const CAPTION_H = Math.round(0.65 * REM + 2.35 * REM + 1.05 * REM);
const FONT_PX = Math.round(0.88 * REM);
const CARD_RX = 2;

const W_CARD = PHOTO + 2 * PAD_H;
const H_CARD = PAD_TOP + PHOTO + CAPTION_H;

const ROTATIONS_DEG = [-11, 5, 14];
const LAYOUT_LEFT = [72, 418, 738];
const LAYOUT_TOP = 138;

/** Approximate .polaroid box-shadow as two blurred rounded rects (no SVG feDropShadow — avoids huge raster bounds). */
const SHADOW_DY1 = 2;
const SHADOW_BLUR1 = 2.5;
const SHADOW_FILL1 = 0.5;
const SHADOW_DY2 = 9;
const SHADOW_BLUR2 = 14;
const SHADOW_FILL2 = 0.45;

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function coverGravity(direction) {
  const m = { left: 'west', right: 'east', up: 'north', down: 'south' };
  return m[direction] ?? 'center';
}

async function fetchImage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Flat polaroid: white frame + dark photo well + image + caption (matches DOM structure). */
function polaroidSvg(name, jpegBase64) {
  const textY = PAD_TOP + PHOTO + CAPTION_H - Math.round(0.55 * REM);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W_CARD}" height="${H_CARD}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <rect x="0" y="0" width="${W_CARD}" height="${H_CARD}" rx="${CARD_RX}" ry="${CARD_RX}" fill="#ffffff"/>
  <rect x="${PAD_H}" y="${PAD_TOP}" width="${PHOTO}" height="${PHOTO}" fill="#0a1810"/>
  <image xlink:href="data:image/jpeg;base64,${jpegBase64}"
    href="data:image/jpeg;base64,${jpegBase64}"
    x="${PAD_H}" y="${PAD_TOP}" width="${PHOTO}" height="${PHOTO}" preserveAspectRatio="xMidYMid slice"/>
  <text x="${W_CARD / 2}" y="${textY}" text-anchor="middle"
    font-family="Segoe Print, Bradley Hand, Snell Roundhand, Comic Sans MS, cursive"
    font-size="${FONT_PX}" font-weight="600" fill="#2a2825">${escapeXml(name)}</text>
</svg>`;
}

async function renderGradientBackground() {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${CANVAS_W}" height="${CANVAS_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#f3efe8"/>
      <stop offset="100%" style="stop-color:#e0d8cc"/>
    </linearGradient>
  </defs>
  <rect width="${CANVAS_W}" height="${CANVAS_H}" fill="url(#bg)"/>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function blurredRoundedShadow(fillOpacity, blurSigma) {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W_CARD}" height="${H_CARD}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${W_CARD}" height="${H_CARD}" rx="${CARD_RX}" ry="${CARD_RX}" fill="#000000" fill-opacity="${fillOpacity}"/>
</svg>`;
  return sharp(Buffer.from(svg))
    .resize(W_CARD, H_CARD)
    .blur(blurSigma)
    .png()
    .toBuffer();
}

async function dropShadowStack() {
  const [s1, s2] = await Promise.all([
    blurredRoundedShadow(SHADOW_FILL1, SHADOW_BLUR1),
    blurredRoundedShadow(SHADOW_FILL2, SHADOW_BLUR2),
  ]);
  return { s1, s2 };
}

async function main() {
  const raw = await readFile(ANIMALS_PATH, 'utf8');
  const data = JSON.parse(raw);
  const list = data.animals;
  if (!Array.isArray(list)) throw new Error('animals.json missing animals array');

  const picked = FEATURE_NAMES.map((name) => {
    const a = list.find((x) => x.name === name);
    if (!a) throw new Error(`No animal named "${name}" in data/animals.json`);
    const url = a.thumbUrl || a.imageUrl;
    if (!url) throw new Error(`No image URL for "${name}"`);
    return { name: a.name, url, direction: a.direction };
  });

  const bg = await renderGradientBackground();
  const shadow = await dropShadowStack();

  const composites = [];

  for (let i = 0; i < picked.length; i++) {
    const { name, url, direction } = picked[i];
    const rawImg = await fetchImage(url);
    const squareJpeg = await sharp(rawImg)
      .rotate()
      .resize(PHOTO, PHOTO, {
        fit: 'cover',
        position: coverGravity(direction),
      })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();

    const b64 = squareJpeg.toString('base64');
    const svg = polaroidSvg(name, b64);

    const cardPng = await sharp(Buffer.from(svg))
      .resize(W_CARD, H_CARD)
      .png()
      .toBuffer();

    const deg = ROTATIONS_DEG[i] ?? 0;

    const rotShadow1 = await sharp(shadow.s1)
      .rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const rotShadow2 = await sharp(shadow.s2)
      .rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const rotCard = await sharp(cardPng)
      .rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const lx = LAYOUT_LEFT[i] ?? 100;
    const ly = LAYOUT_TOP;

    composites.push(
      { input: rotShadow1, left: lx, top: ly + SHADOW_DY1 },
      { input: rotShadow2, left: lx, top: ly + SHADOW_DY2 },
      { input: rotCard, left: lx, top: ly }
    );
  }

  const out = await sharp(bg)
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toBuffer();

  await writeFile(OUT_PATH, out);
  console.log(
    `Wrote ${path.relative(ROOT, OUT_PATH)} (${CANVAS_W}×${CANVAS_H}) from ${picked.map((p) => p.name).join(', ')}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
