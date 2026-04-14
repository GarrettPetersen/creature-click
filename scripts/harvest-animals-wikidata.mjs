/**
 * Grow animal-sources from Wikimedia — use APIs, not HTML scraping.
 *
 * Modes (--mode):
 *   commons (default) — Walk Commons categories (Featured pictures of …) via
 *     action=query&list=categorymembers. Names come from filenames (rough).
 *   wikidata — Batched SPARQL with VALUES over scripts/wikidata-species-seeds.json
 *     (Wikidata Q-ids). Needs P18 + taxon rank species (P105=Q7432). Fast on WDQS.
 *
 * Unbounded “all species with P18” queries time out on query.wikidata.org; seeds are required.
 *
 * Licensing: verify files suit your use; run npm run verify:animals before build:animals.
 *
 * Usage:
 *   node scripts/harvest-animals-wikidata.mjs --max-total 150 --out scripts/animal-candidates.json
 *   node scripts/harvest-animals-wikidata.mjs --mode wikidata --max-total 120 --out scripts/wd.json
 *   node scripts/harvest-animals-wikidata.mjs --commons-category "Featured pictures of reptiles"
 *   node scripts/harvest-animals-wikidata.mjs --merge-into scripts/animal-sources.json --max-total 100
 *   node scripts/harvest-animals-wikidata.mjs --mode wikidata-bulk --bulk-fetch 700 --max-total 400 --merge-into scripts/animal-sources.json
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEFAULT_SEEDS = path.join(__dirname, 'wikidata-species-seeds.json');

const WDQS = 'https://query.wikidata.org/sparql';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

const UA =
  'CreatureClick/1.0 (https://creature.click; harvest-animals-wikidata; educational game build)';

const DEFAULT_COMMONS_CATEGORIES = [
  'Featured pictures of mammals',
  'Featured pictures of birds',
  'Featured pictures of Fish',
  'Featured pictures of insects',
  'Featured pictures of amphibians',
  'Featured pictures of reptiles',
];

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = {
    mode: 'commons',
    batchSize: 50,
    maxTotal: 400,
    out: path.join(__dirname, 'animal-candidates.json'),
    mergeInto: null,
    commonsCategory: null,
    seedsPath: DEFAULT_SEEDS,
    bulkFetch: 700,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') o.mode = argv[++i];
    else if (a === '--batch') o.batchSize = Math.min(80, Math.max(5, +argv[++i] || 50));
    else if (a === '--bulk-fetch') o.bulkFetch = Math.min(5000, Math.max(50, +argv[++i] || 700));
    else if (a === '--max-total') o.maxTotal = Math.max(1, +argv[++i] || 400);
    else if (a === '--out') o.out = path.resolve(ROOT, argv[++i]);
    else if (a === '--merge-into') o.mergeInto = path.resolve(ROOT, argv[++i]);
    else if (a === '--commons-category') o.commonsCategory = argv[++i];
    else if (a === '--seeds') o.seedsPath = path.resolve(ROOT, argv[++i]);
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--help' || a === '-h') {
      console.log('See file header in harvest-animals-wikidata.mjs');
      process.exit(0);
    }
  }
  return o;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function decodeFileName(raw) {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' ')).trim();
  } catch {
    return raw.trim();
  }
}

/** @param {string} file */
function isUsableImageFile(file) {
  const lower = file.toLowerCase();
  if (lower.endsWith('.svg')) return false;
  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return false;
  if (lower.includes('/')) return false;
  return /\.(jpe?g|png|webp|gif)$/i.test(file);
}

/** @param {string[]} qids - e.g. ["Q140","Q19939"] */
function valuesBlock(qids) {
  const body = qids.map((id) => {
    const q = id.startsWith('Q') ? id : `Q${id}`;
    return `wd:${q}`;
  });
  return `{ ${body.join(' ')} }`;
}

/** @param {number} limit */
async function fetchDistinctSpeciesQids(limit) {
  const query = `
SELECT DISTINCT ?species WHERE {
  ?species wdt:P105 wd:Q7432 .
  ?species wdt:P18 ?i .
}
LIMIT ${limit}
`.trim();
  const url = `${WDQS}?query=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/sparql-results+json',
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`WDQS HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const out = [];
  for (const b of data.results?.bindings ?? []) {
    const u = b.species?.value;
    const m = typeof u === 'string' ? u.match(/entity\/(Q\d+)/) : null;
    if (m) out.push(m[1]);
  }
  return out;
}

/**
 * @param {string[]} seeds - Q-id strings
 * @param {number} batchSize
 * @param {number} maxTotal
 */
async function harvestWikidataFromQidList(seeds, batchSize, maxTotal) {
  if (!Array.isArray(seeds)) throw new Error('Seeds must be an array of Q-ids');

  const rows = [];
  const seenFiles = new Set();

  for (let i = 0; i < seeds.length && rows.length < maxTotal; i += batchSize) {
    const batch = seeds.slice(i, i + batchSize);
    const query = `
SELECT ?species ?speciesLabel ?fileName WHERE {
  VALUES ?species ${valuesBlock(batch)} .
  ?species wdt:P105 wd:Q7432 .
  ?species wdt:P18 ?image .
  BIND(STRAFTER(STR(?image), "Special:FilePath/") AS ?fileName)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
`.trim();

    const url = `${WDQS}?query=${encodeURIComponent(query)}&format=json`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/sparql-results+json',
      },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`WDQS HTTP ${res.status}: ${t.slice(0, 300)}`);
    }
    const data = await res.json();
    for (const b of data.results?.bindings ?? []) {
      const name = b.speciesLabel?.value?.trim();
      const file = decodeFileName(b.fileName?.value?.trim());
      if (!name || !file || !isUsableImageFile(file)) continue;
      const key = file.toLowerCase();
      if (seenFiles.has(key)) continue;
      seenFiles.add(key);
      rows.push({ name, file });
      if (rows.length >= maxTotal) break;
    }
    await sleep(600);
  }

  return rows;
}

/**
 * @param {string} seedsPath
 * @param {number} batchSize
 * @param {number} maxTotal
 */
async function harvestWikidataFromSeeds(seedsPath, batchSize, maxTotal) {
  const raw = await readFile(seedsPath, 'utf8');
  const seeds = JSON.parse(raw);
  if (!Array.isArray(seeds)) throw new Error('Seeds file must be a JSON array of Q-ids');
  return harvestWikidataFromQidList(seeds, batchSize, maxTotal);
}

/**
 * @param {string} categoryTitle
 * @param {number} maxFromCategory
 * @param {Set<string>} seenFiles
 * @param {{ name: string, file: string }[]} rows
 */
async function harvestCommonsCategoryInto(categoryTitle, maxFromCategory, seenFiles, rows) {
  const cat = categoryTitle.startsWith('Category:')
    ? categoryTitle
    : `Category:${categoryTitle}`;
  let cmcontinue = undefined;
  let got = 0;

  while (got < maxFromCategory) {
    const params = new URLSearchParams({
      action: 'query',
      list: 'categorymembers',
      cmtitle: cat,
      cmnamespace: '6',
      cmtype: 'file',
      cmlimit: '50',
      format: 'json',
      formatversion: '2',
    });
    if (cmcontinue) params.set('cmcontinue', cmcontinue);

    const res = await fetch(`${COMMONS_API}?${params}`, {
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) throw new Error(`Commons API HTTP ${res.status} for ${cat}`);
    const data = await res.json();
    const members = data.query?.categorymembers ?? [];
    if (!members.length) break;

    for (const m of members) {
      const title = m.title;
      if (!title?.startsWith('File:')) continue;
      const file = title.slice('File:'.length);
      if (!isUsableImageFile(file)) continue;
      const key = file.toLowerCase();
      if (seenFiles.has(key)) continue;
      seenFiles.add(key);
      const base = file.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
      rows.push({ name: base.slice(0, 100) || file, file });
      got++;
      if (got >= maxFromCategory) break;
    }

    cmcontinue = data.continue?.cmcontinue;
    if (!cmcontinue) break;
    await sleep(300);
  }
}

async function harvestCommonsDefault(maxTotal) {
  const rows = [];
  const seenFiles = new Set();
  const perCat = Math.max(30, Math.ceil(maxTotal / DEFAULT_COMMONS_CATEGORIES.length));

  for (const c of DEFAULT_COMMONS_CATEGORIES) {
    if (rows.length >= maxTotal) break;
    const need = maxTotal - rows.length;
    await harvestCommonsCategoryInto(c, Math.min(perCat, need), seenFiles, rows);
    await sleep(400);
  }
  return rows;
}

function normFileKey(file) {
  return file.replace(/^File:/i, '').replace(/_/g, ' ').trim().toLowerCase();
}

async function main() {
  const opts = parseArgs();
  /** @type {{ name: string, file: string }[]} */
  let harvested = [];

  if (opts.mode === 'wikidata-bulk') {
    console.error(
      `Wikidata bulk: fetch ${opts.bulkFetch} species Q-ids, resolve up to ${opts.maxTotal} images (batch ${opts.batchSize})`
    );
    const qids = await fetchDistinctSpeciesQids(opts.bulkFetch);
    console.error(`WDQS returned ${qids.length} distinct Q-ids.`);
    harvested = await harvestWikidataFromQidList(qids, opts.batchSize, opts.maxTotal);
  } else if (opts.mode === 'wikidata') {
    console.error(`Wikidata seeds: ${path.relative(ROOT, opts.seedsPath)} (batch ${opts.batchSize})`);
    harvested = await harvestWikidataFromSeeds(opts.seedsPath, opts.batchSize, opts.maxTotal);
  } else if (opts.commonsCategory) {
    console.error(`Commons category: ${opts.commonsCategory}`);
    const seen = new Set();
    harvested = [];
    await harvestCommonsCategoryInto(opts.commonsCategory, opts.maxTotal, seen, harvested);
  } else {
    console.error(`Commons default categories (${DEFAULT_COMMONS_CATEGORIES.length}), max ${opts.maxTotal}`);
    harvested = await harvestCommonsDefault(opts.maxTotal);
  }

  console.error(`Harvested ${harvested.length} candidate rows.`);

  if (opts.dryRun) {
    console.log(JSON.stringify(harvested.slice(0, 15), null, 2));
    return;
  }

  if (opts.mergeInto) {
    const existingRaw = await readFile(opts.mergeInto, 'utf8');
    const existing = JSON.parse(existingRaw);
    if (!Array.isArray(existing)) throw new Error('merge target must be a JSON array');

    const seen = new Set(existing.map((e) => normFileKey(e.file)));
    let added = 0;
    for (const row of harvested) {
      const k = normFileKey(row.file);
      if (seen.has(k)) continue;
      seen.add(k);
      existing.push({ name: row.name, file: row.file });
      added++;
    }
    await writeFile(opts.mergeInto, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
    console.error(`Merged +${added} into ${path.relative(ROOT, opts.mergeInto)} (${existing.length} total).`);
    console.error('Next: npm run verify:animals && npm run build:animals');
    return;
  }

  await writeFile(opts.out, `${JSON.stringify(harvested, null, 2)}\n`, 'utf8');
  console.error(`Wrote ${path.relative(ROOT, opts.out)}`);
  console.error('Next: review, merge into animal-sources.json, verify:animals, build:animals');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
