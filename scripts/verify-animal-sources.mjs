/**
 * Verifies every entry in scripts/animal-sources.json exists on Wikimedia Commons
 * as a real file with image metadata (not redlinks, not deleted, not wrong type).
 *
 * Uses the same Commons API as build-animals-json.mjs. Requires network.
 *
 * Usage:
 *   node scripts/verify-animal-sources.mjs
 *   node scripts/verify-animal-sources.mjs --probe   # optional: GET first chunk from each upload URL (throttled)
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCES_PATH = path.join(__dirname, 'animal-sources.json');

const API = 'https://commons.wikimedia.org/w/api.php';
const UA =
  'CreatureClick/1.0 (https://creature.click; verify-animal-sources; educational game)';

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
 */
async function queryBatch(fullTitles) {
  const body = new URLSearchParams({
    action: 'query',
    titles: fullTitles.join('|'),
    prop: 'imageinfo',
    iiprop: 'url|mime|size',
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Confirms upload.wikimedia.org returns bytes (GET + read one chunk).
 * HEAD-only probes were flaky (throttling); Range: bytes=0-0 often returns 416 on Commons.
 *
 * @param {string} url
 * @param {AbortSignal} signal
 */
async function urlLooksReachable(url, signal) {
  const res = await fetch(url, {
    method: 'GET',
    signal,
    headers: { 'User-Agent': UA },
    redirect: 'follow',
  });
  if (!res.ok) return false;
  const reader = res.body?.getReader();
  if (!reader) return true;
  try {
    await reader.read();
  } finally {
    await reader.cancel();
  }
  return true;
}

const probeUrls = process.argv.includes('--probe');

const raw = await readFile(SOURCES_PATH, 'utf8');
/** @type {{ name: string, file: string }[]} */
const sources = JSON.parse(raw);
if (!Array.isArray(sources)) {
  console.error('animal-sources.json must be a JSON array.');
  process.exit(1);
}

const chunkSize = 10;
const failures = [];
let ok = 0;

for (let i = 0; i < sources.length; i += chunkSize) {
  const chunk = sources.slice(i, i + chunkSize);
  const titles = chunk.map((s) => (s.file.startsWith('File:') ? s.file : `File:${s.file}`));
  const data = await queryBatch(titles);
  const pages = data.query?.pages ?? [];

  for (const src of chunk) {
    const key = normTitle(src.file);
    const page = pages.find((p) => normTitle(p.title) === key);

    if (!page) {
      failures.push({
        name: src.name,
        file: src.file,
        reason: 'No matching page in API response (title may be invalid or batch mismatch).',
      });
      continue;
    }
    if (page.missing) {
      failures.push({
        name: src.name,
        file: src.file,
        reason: `Commons has no file with this title (redlink / wrong spelling). API title: ${page.title}`,
      });
      continue;
    }
    const info = page.imageinfo?.[0];
    if (!info?.url) {
      failures.push({
        name: src.name,
        file: src.file,
        reason: 'Page exists but imageinfo has no url.',
      });
      continue;
    }
    if (!info.mime?.startsWith('image/')) {
      failures.push({
        name: src.name,
        file: src.file,
        reason: `Not an image (mime: ${info.mime ?? 'unknown'}).`,
      });
      continue;
    }

    if (probeUrls) {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 25000);
      try {
        let alive = await urlLooksReachable(info.url, ac.signal);
        if (!alive) {
          await sleep(1200);
          alive = await urlLooksReachable(info.url, ac.signal);
        }
        if (!alive) {
          failures.push({
            name: src.name,
            file: src.file,
            reason: `Upload URL failed GET probe: ${info.url}`,
          });
          continue;
        }
      } catch (e) {
        failures.push({
          name: src.name,
          file: src.file,
          reason: `Probe failed: ${e instanceof Error ? e.message : String(e)}`,
        });
        continue;
      } finally {
        clearTimeout(t);
      }
      await sleep(900);
    }

    ok++;
  }

  await new Promise((r) => setTimeout(r, 120));
}

console.log(`Checked ${sources.length} entries against Wikimedia Commons.`);
console.log(`OK: ${ok}`);

if (failures.length) {
  console.error(`\nFAILED: ${failures.length}`);
  for (const f of failures) {
    console.error(`\n  • ${f.name}`);
    console.error(`    file: ${f.file}`);
    console.error(`    ${f.reason}`);
  }
  process.exit(1);
}

console.log('\nAll sources resolve to real Commons image files.');
if (!probeUrls) {
  console.log('(Run with --probe to also fetch the first byte of each upload URL; slower, throttled.)');
}
