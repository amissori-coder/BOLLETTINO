#!/usr/bin/env node
/**
 * Recupera una web app deployata su Firebase Hosting a partire dal solo URL
 * pubblico, e -- se il build include i source map -- ne ricostruisce l'albero
 * dei sorgenti originali.
 *
 *   node tools/recover-from-hosting.mjs https://esempio.web.app [outDir]
 *
 * Dietro un proxy (es. sessioni Claude Code) serve Node >= 22.21 e:
 *   NODE_USE_ENV_PROXY=1 node tools/recover-from-hosting.mjs <url>
 *
 * Produce due cartelle sotto outDir (default: "recovered"):
 *   dist/  -> i file deployati, byte per byte (app funzionante)
 *   src/   -> i sorgenti originali estratti dai .map (se presenti)
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, posix } from 'node:path';

const BASE = process.argv[2];
const OUT = process.argv[3] ?? 'recovered';

if (!BASE) {
  console.error('uso: node tools/recover-from-hosting.mjs <url-del-sito> [outDir]');
  process.exit(1);
}

const baseUrl = new URL(BASE.endsWith('/') ? BASE : BASE + '/');
const DIST = join(OUT, 'dist');
const SRC = join(OUT, 'src');

// estensioni che vale la pena scaricare
const FETCHABLE = /\.(html?|js|mjs|cjs|jsx|ts|tsx|css|map|json|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|eot|otf|txt|xml|webmanifest|wasm|pdf|mp[34]|webm)$/i;
// file dentro cui cercare altri riferimenti
const SCANNABLE = /\.(html?|js|mjs|cjs|css|json|webmanifest)$/i;
const TEXTUAL = /\.(html?|js|mjs|cjs|jsx|ts|tsx|css|map|json|svg|txt|xml|webmanifest)$/i;

const seen = new Set();
const savedPaths = new Set();
const queue = [];
const ok = [];
const failed = [];
const probeMisses = [];
const PROBES = new Set();

function enqueue(rawUrl, from) {
  let u;
  try {
    u = new URL(rawUrl, from ?? baseUrl);
  } catch {
    return;
  }
  if (u.origin !== baseUrl.origin) return; // solo same-origin
  u.hash = '';
  u.search = '';
  const key = u.href;
  if (seen.has(key)) return;
  seen.add(key);
  queue.push(u);
}

/** percorso locale relativo per un URL */
function localPath(u) {
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  p = p.replace(/^\/+/, '');
  // niente traversal fuori da DIST
  p = normalize(p).replace(/^(\.\.[/\\])+/, '');
  return p || 'index.html';
}

/** estrae riferimenti a risorse da un file testuale */
function extractRefs(text, ext) {
  const refs = new Set();

  if (/^\.html?$/i.test(ext)) {
    // src="...", href="...", content="..." (og:image), srcset
    for (const m of text.matchAll(/(?:src|href|content|data-src)\s*=\s*["']([^"']+)["']/gi)) {
      refs.add(m[1]);
    }
    for (const m of text.matchAll(/srcset\s*=\s*["']([^"']+)["']/gi)) {
      for (const part of m[1].split(',')) refs.add(part.trim().split(/\s+/)[0]);
    }
  }

  if (/^\.css$/i.test(ext)) {
    for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) refs.add(m[1]);
    for (const m of text.matchAll(/@import\s+["']([^"']+)["']/gi)) refs.add(m[1]);
  }

  if (/^\.(js|mjs|cjs|json|webmanifest)$/i.test(ext)) {
    // stringhe che sembrano path di asset: "/assets/index-a1b2.js", "./chunk-x.js"
    for (const m of text.matchAll(/["'`](\.{0,2}\/[A-Za-z0-9._@~\-/]+\.[A-Za-z0-9]{2,6})["'`]/g)) {
      refs.add(m[1]);
    }
    // import("...") / from "..."
    for (const m of text.matchAll(/(?:import|from)\s*\(?\s*["']([^"']+)["']/g)) refs.add(m[1]);
  }

  // il source map: //# sourceMappingURL=index-a1b2.js.map
  for (const m of text.matchAll(/[#@]\s*sourceMappingURL\s*=\s*([^\s*'"]+)/g)) {
    if (!m[1].startsWith('data:')) refs.add(m[1]);
  }

  return [...refs].filter((r) => {
    if (!r || r.startsWith('data:') || r.startsWith('#') || r.startsWith('mailto:')) return false;
    if (/^(https?:)?\/\//i.test(r)) {
      try { return new URL(r, baseUrl).origin === baseUrl.origin; } catch { return false; }
    }
    return FETCHABLE.test(r.split('?')[0]);
  });
}

async function save(relPath, buf) {
  const full = join(DIST, relPath);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, buf);
}

async function crawl() {
  enqueue(baseUrl.href);
  // punti d'ingresso tipici che l'HTML spesso non linka
  for (const extra of [
    'index.html', 'manifest.json', 'manifest.webmanifest', 'site.webmanifest',
    'asset-manifest.json', 'service-worker.js', 'sw.js', 'firebase-messaging-sw.js',
    'robots.txt', '404.html', 'favicon.ico',
  ]) {
    PROBES.add(new URL(extra, baseUrl).href);
    enqueue(extra);
  }

  while (queue.length) {
    const u = queue.shift();
    const rel = localPath(u);
    const ext = '.' + (rel.split('.').pop() ?? '');

    if (savedPaths.has(rel)) continue;

    let res;
    try {
      res = await fetch(u, { redirect: 'follow', headers: { 'user-agent': 'recover-from-hosting/1.0' } });
    } catch (err) {
      failed.push([u.href, String(err.message ?? err)]);
      continue;
    }
    if (!res.ok) {
      (PROBES.has(u.href) ? probeMisses : failed).push([u.href, `HTTP ${res.status}`]);
      continue;
    }

    // Firebase Hosting serve index.html per ogni rotta sconosciuta (SPA rewrite):
    // non salvare duplicati dell'index sotto nomi di asset inesistenti.
    const ctype = res.headers.get('content-type') ?? '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (rel !== 'index.html' && /text\/html/i.test(ctype) && !/\.html?$/i.test(rel)) {
      (PROBES.has(u.href) ? probeMisses : failed).push([u.href, 'SPA rewrite: non esiste']);
      continue;
    }

    await save(rel, buf);
    savedPaths.add(rel);
    ok.push([rel, buf.length]);
    console.log(`  ok  ${String(buf.length).padStart(9)}  ${rel}`);

    if (SCANNABLE.test(rel)) {
      const text = buf.toString('utf8');
      for (const ref of extractRefs(text, ext)) enqueue(ref, u);
    }
  }
}

/** ricostruisce i sorgenti originali da tutti i .map scaricati */
async function expandSourceMaps() {
  const { readdir, readFile } = await import('node:fs/promises');
  const maps = [];

  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith('.map')) maps.push(p);
    }
  }
  await walk(DIST);

  if (!maps.length) return { maps: 0, files: 0, skipped: 0 };

  let files = 0;
  let skipped = 0;

  for (const mapPath of maps) {
    let map;
    try { map = JSON.parse(await readFile(mapPath, 'utf8')); } catch { continue; }
    const sources = map.sources ?? [];
    const contents = map.sourcesContent ?? [];
    if (!contents.length) { skipped += sources.length; continue; }

    for (let i = 0; i < sources.length; i++) {
      const content = contents[i];
      if (typeof content !== 'string') { skipped++; continue; }

      let name = String(sources[i] ?? `unknown-${i}.txt`);
      // normalizza i vari prefissi dei bundler
      name = name
        .replace(/^webpack:\/\/\/?/, '')
        .replace(/^vite:\/{2,3}/, '')
        .replace(/^rollup:\/{2,3}/, '')
        .replace(/^file:\/{2,3}/, '')
        .replace(/^[a-z-]+:\/\//i, '')
        .replace(/^\0/, '')
        .replace(/^\.\//, '');
      name = name.split('?')[0];
      // via i ../ iniziali e i path assoluti
      name = name.replace(/^([A-Za-z]:)?[/\\]+/, '').replace(/^(\.\.[/\\])+/, '');
      // le dipendenze vanno in _deps/ per non inquinare i sorgenti dell'app
      const isDep = /(^|\/)node_modules\//.test(name);
      if (isDep) name = '_deps/' + name.replace(/.*?node_modules\//, '');
      name = posix.normalize(name).replace(/^(\.\.\/)+/, '');
      if (!name || name === '.' || name === '/') continue;

      const full = join(SRC, name);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, content);
      if (!isDep) files++;
    }
  }

  return { maps: maps.length, files, skipped };
}

console.log(`\n>> scarico ${baseUrl.origin} -> ${DIST}\n`);
await crawl();

console.log(`\n>> espando i source map -> ${SRC}\n`);
const sm = await expandSourceMaps();

console.log('\n================ RIEPILOGO ================');
console.log(`file deployati scaricati : ${ok.length}`);
console.log(`byte totali              : ${ok.reduce((a, [, n]) => a + n, 0).toLocaleString('it-IT')}`);
console.log(`source map trovati       : ${sm.maps}`);
console.log(`sorgenti dell'app estratti: ${sm.files}${sm.skipped ? `  (${sm.skipped} senza contenuto inline)` : ''}`);
if (probeMisses.length) {
  console.log(`\nentry point ipotizzati e assenti (normale): ${probeMisses.length}`);
}
if (failed.length) {
  console.log(`\nNON SCARICATI (${failed.length}) -- da controllare:`);
  for (const [u, why] of failed.slice(0, 40)) console.log(`  - ${u}  [${why}]`);
  if (failed.length > 40) console.log(`  ... e altri ${failed.length - 40}`);
}
if (!sm.maps) {
  console.log('\nNESSUN SOURCE MAP: recupero dal bundle minificato (più laborioso ma fattibile).');
} else if (sm.files) {
  console.log(`\nSORGENTI RECUPERATI: guarda ${SRC}`);
}
console.log('===========================================\n');
