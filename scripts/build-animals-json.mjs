/**
 * Resolves scripts/animal-sources.json against Wikimedia Commons and writes
 * data/animals.json with display + thumbnail URLs (no runtime API calls in the game).
 *
 * Requires network. Uses a descriptive User-Agent (required by Wikimedia).
 *
 * Usage: node scripts/build-animals-json.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SOURCES_PATH = path.join(__dirname, 'animal-sources.json');
const OUT_PATH = path.join(ROOT, 'data', 'animals.json');

const API = 'https://commons.wikimedia.org/w/api.php';
const UA =
  'CreatureClick/1.0 (https://creature.click; static educational game for children; build script)';

/** @param {string} s */
function normTitle(s) {
  return s
    .replace(/^File:/i, '')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * @param {string[]} fullTitles - include "File:" prefix
 * @param {number} iiurlwidth
 */
async function queryBatch(fullTitles, iiurlwidth) {
  const body = new URLSearchParams({
    action: 'query',
    titles: fullTitles.join('|'),
    prop: 'imageinfo',
    iiprop: 'url|size|mime',
    iiurlwidth: String(iiurlwidth),
    format: 'json',
    formatversion: '2',
  });
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
    },
    body,
  });
  if (!res.ok) throw new Error(`Commons API HTTP ${res.status}`);
  return res.json();
}

const FOCUS_DIRECTIONS = new Set(['left', 'right', 'up', 'down']);

/** @param {import('node:fs').PathLike} file */
async function mapSourcesToPages(file) {
  const raw = await readFile(file, 'utf8');
  /** @type {{ name: string, file: string, direction?: string }[]} */
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) throw new Error('animal-sources.json must be a JSON array');

  const chunkSize = 12;
  /** @type {Map<string, { title: string, pageid: number, imageUrl?: string, thumbUrl?: string, originalUrl?: string, commonsPage?: string, width?: number, height?: number, mime?: string }>} */
  const byNorm = new Map();

  for (let i = 0; i < list.length; i += chunkSize) {
    const chunk = list.slice(i, i + chunkSize);
    const titles = chunk.map((s) =>
      s.file.startsWith('File:') ? s.file : `File:${s.file}`
    );

    for (const width of [1920, 640]) {
      const data = await queryBatch(titles, width);
      const pages = data.query?.pages ?? [];
      for (const page of pages) {
        if (page.missing || !page.imageinfo?.[0]?.url) continue;
        const info = page.imageinfo[0];
        const key = normTitle(page.title);
        let row = byNorm.get(key);
        if (!row) {
          row = {
            title: page.title,
            pageid: page.pageid,
            width: info.width,
            height: info.height,
            mime: info.mime,
          };
          byNorm.set(key, row);
        }
        if (width === 1920) {
          row.imageUrl = info.thumburl || info.url;
          row.originalUrl = info.url;
          if (info.descriptionurl) row.commonsPage = info.descriptionurl;
        } else {
          row.thumbUrl = info.thumburl || info.url;
        }
      }
    }
    // polite pause between chunks
    await new Promise((r) => setTimeout(r, 150));
  }

  const animals = [];
  const errors = [];

  for (const src of list) {
    const key = normTitle(src.file);
    const row = byNorm.get(key);
    if (!row?.imageUrl || !row?.thumbUrl) {
      errors.push(`No imageinfo for "${src.name}" (${src.file})`);
      continue;
    }
    const entry = {
      id: String(row.pageid),
      name: src.name,
      commonsTitle: row.title,
      commonsPage: row.commonsPage || `https://commons.wikimedia.org/wiki/${encodeURI(row.title.replace(/ /g, '_'))}`,
      imageUrl: row.imageUrl,
      thumbUrl: row.thumbUrl,
      originalUrl: row.originalUrl,
      width: row.width,
      height: row.height,
      mime: row.mime,
    };
    if (src.direction && FOCUS_DIRECTIONS.has(src.direction)) {
      entry.direction = src.direction;
    }
    animals.push(entry);
  }

  return { animals, errors };
}

const { animals, errors } = await mapSourcesToPages(SOURCES_PATH);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const payload = {
  version: 1,
  generatedAt: new Date().toISOString(),
  note:
    'Curated Commons files + resolved URLs. Regenerate with: node scripts/build-animals-json.mjs',
  displayMaxWidth: 1920,
  thumbMaxWidth: 640,
  animals,
};

await mkdir(path.dirname(OUT_PATH), { recursive: true });
await writeFile(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`Wrote ${animals.length} animals to ${path.relative(ROOT, OUT_PATH)}`);
