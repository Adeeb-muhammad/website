import { cp, mkdir, readFile, readdir, rm, access, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateArchive } from '../assets/js/core.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const CACHE_VERSION = '23';
const data = JSON.parse(await readFile(path.join(root, 'data/archive.json'), 'utf8'));
const errors = validateArchive(data);
if (errors.length) throw new Error(`Invalid archive:\n${errors.join('\n')}`);
for (const entry of data.entries) {
  for (const key of ['image', 'poster']) if (entry[key].startsWith('assets/')) await access(path.join(root, entry[key]));
}
const htmlFiles = ['index.html', 'studio.html', 'currently-watching.html', 'reading-log.html', 'tools.html', 'vault-archive.html', 'canvas-pro.html', '404.html', 'LICENSES/index.html', 'music-studio/index.html'];

for (const file of htmlFiles) {
  const html = await readFile(path.join(root, file), 'utf8');

  // Every local reference must exist, including absolute /paths (404.html) and ../ paths (music-studio).
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = match[1];
    if (/^(?:https?:|#|mailto:|data:|javascript:)/.test(ref)) continue;
    const clean = ref.split(/[?#]/)[0];
    if (!clean) continue;
    const target = clean.startsWith('/')
      ? path.join(root, clean)
      : path.join(root, path.dirname(file), clean);
    await access(target);
  }

  // Cache versions must be bumped in source, not only rewritten in dist.
  for (const match of html.matchAll(/(?:\.\.\/|\/)?assets\/css\/style\.css\?v=(\d+)/g)) {
    if (match[1] !== CACHE_VERSION) {
      throw new Error(`${file}: style.css?v=${match[1]} should be ?v=${CACHE_VERSION}`);
    }
  }
  if (html.includes('misc-nav.js') && !/misc-nav\.js\?v=\d+/.test(html)) {
    throw new Error(`${file}: misc-nav.js needs a ?v= cache version`);
  }
}

// Stylesheet url() references resolve relative to the stylesheet itself, which is
// how the poster-backdrop bug shipped once.
for (const name of await readdir(path.join(root, 'assets/css'))) {
  if (!name.endsWith('.css')) continue;
  const css = await readFile(path.join(root, 'assets/css', name), 'utf8');
  for (const match of css.matchAll(/url\((['"]?)([^)'"\s]+)\1\)/g)) {
    const ref = match[2];
    if (/^(?:https?:|data:|%23|#)/.test(ref)) continue;
    await access(path.join(root, 'assets/css', ref.split(/[?#]/)[0]));
  }
}
const fonts = await readFile(path.join(root, 'assets/fonts/fonts.css'), 'utf8');
if (!fonts.includes('@font-face')) throw new Error('Self-hosted fonts have not been installed.');
for (const match of fonts.matchAll(/url\(['"]?(\.\/[^)'"\s]+)['"]?\)/g)) await access(path.join(root, 'assets/fonts', match[1]));
await rm(path.join(root, 'dist'), { recursive: true, force: true });
await mkdir(path.join(root, 'dist'), { recursive: true });
for (const file of ['index.html', 'studio.html', 'currently-watching.html', 'reading-log.html', 'tools.html', 'vault-archive.html', 'canvas-pro.html', '404.html', 'CNAME', '.nojekyll', 'robots.txt', 'sitemap.xml', 'assets', 'data', 'LICENSES', 'music-studio']) await cp(path.join(root, file), path.join(root, 'dist', file), { recursive: true });

for (const file of htmlFiles) {
  const output = path.join(root, 'dist', file);
  let html = await readFile(output, 'utf8');
  html = html.replace(/((?:\.\.\/|\/)?assets\/css\/style\.css)\?v=\d+/g, (match, assetPath) => assetPath + '?v=' + CACHE_VERSION);
  const versions = [...html.matchAll(/(?:\.\.\/|\/)?assets\/css\/style\.css\?v=(\d+)/g)].map(match => match[1]);
  if (versions.some(version => version !== CACHE_VERSION)) throw new Error('Inconsistent stylesheet cache version in ' + file);
  await writeFile(output, html);
}
for (const file of ['assets/js/tools.js', 'assets/js/notebook.js']) {
  const output = path.join(root, 'dist', file);
  let source = await readFile(output, 'utf8');
  source = source.replace(/(\.\/tools-core\.js)\?v=\d+/g, (match, modulePath) => modulePath + '?v=' + CACHE_VERSION);
  if (!source.includes('./tools-core.js?v=' + CACHE_VERSION)) throw new Error('Missing shared tools-core version in ' + file);
  await writeFile(output, source);
}
console.log(`Static site built: ${data.entries.length} archive entries, ${data.projects.length} projects. No backend or runtime dependencies.`);
