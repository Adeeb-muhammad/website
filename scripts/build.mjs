import { cp, mkdir, readFile, readdir, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateArchive } from '../assets/js/core.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const data = JSON.parse(await readFile(path.join(root, 'data/archive.json'), 'utf8'));
const errors = validateArchive(data);
if (errors.length) throw new Error(`Invalid archive:\n${errors.join('\n')}`);
for (const entry of data.entries) {
  for (const key of ['image', 'poster']) if (entry[key].startsWith('assets/')) await access(path.join(root, entry[key]));
}
for (const file of ['index.html', 'studio.html']) {
  const html = await readFile(path.join(root, file), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="(assets\/[^"]+)"/g)) await access(path.join(root, match[1].split(/[?#]/)[0]));
}
const fonts = await readFile(path.join(root, 'assets/fonts/fonts.css'), 'utf8');
if (!fonts.includes('@font-face')) throw new Error('Self-hosted fonts have not been installed.');
for (const match of fonts.matchAll(/url\(['"]?(\.\/[^)'"\s]+)['"]?\)/g)) await access(path.join(root, 'assets/fonts', match[1]));
await rm(path.join(root, 'dist'), { recursive: true, force: true });
await mkdir(path.join(root, 'dist'), { recursive: true });
for (const file of ['index.html', 'studio.html', '404.html', 'CNAME', '.nojekyll', 'robots.txt', 'sitemap.xml', 'assets', 'data']) await cp(path.join(root, file), path.join(root, 'dist', file), { recursive: true });
console.log(`Static site built: ${data.entries.length} archive entries, ${data.projects.length} projects. No backend or runtime dependencies.`);
