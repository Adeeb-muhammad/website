import { cp, mkdir, readFile, readdir, rm, access, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateArchive } from '../assets/js/core.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const CACHE_VERSION = '15';
const data = JSON.parse(await readFile(path.join(root, 'data/archive.json'), 'utf8'));
const errors = validateArchive(data);
if (errors.length) throw new Error(`Invalid archive:\n${errors.join('\n')}`);
for (const entry of data.entries) {
  for (const key of ['image', 'poster']) if (entry[key].startsWith('assets/')) await access(path.join(root, entry[key]));
}
for (const file of ['index.html', 'studio.html', 'currently-watching.html', 'reading-log.html', 'tools.html']) {
  const html = await readFile(path.join(root, file), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = match[1];
    if (!ref.startsWith('http') && !ref.startsWith('#') && !ref.startsWith('mailto:') && !ref.startsWith('data:')) await access(path.join(root, ref.split(/[?#]/)[0]));
  }
}
const fonts = await readFile(path.join(root, 'assets/fonts/fonts.css'), 'utf8');
if (!fonts.includes('@font-face')) throw new Error('Self-hosted fonts have not been installed.');
for (const match of fonts.matchAll(/url\(['"]?(\.\/[^)'"\s]+)['"]?\)/g)) await access(path.join(root, 'assets/fonts', match[1]));
await rm(path.join(root, 'dist'), { recursive: true, force: true });
await mkdir(path.join(root, 'dist'), { recursive: true });
for (const file of ['index.html', 'studio.html', 'currently-watching.html', 'reading-log.html', 'tools.html', 'vault-archive.html', 'canvas-pro.html', '404.html', 'CNAME', '.nojekyll', 'robots.txt', 'sitemap.xml', 'assets', 'data', 'LICENSES', 'music-studio']) await cp(path.join(root, file), path.join(root, 'dist', file), { recursive: true });

const htmlFiles = ['index.html', 'studio.html', 'currently-watching.html', 'reading-log.html', 'tools.html', 'vault-archive.html', 'canvas-pro.html', '404.html', 'LICENSES/index.html', 'music-studio/index.html'];
for (const file of htmlFiles) {
  const output = path.join(root, 'dist', file);
  let html = await readFile(output, 'utf8');
  html = html.replace(/((?:\.\.\/|\/)?assets\/css\/style\.css)\?v=\d+/g, \`$1?v=\${CACHE_VERSION}\`);
  const versions = [...html.matchAll(/(?:\.\.\/|\/)?assets\/css\/style\.css\?v=(\d+)/g)].map(match => match[1]);
  if (versions.some(version => version !== CACHE_VERSION)) throw new Error(\`Inconsistent stylesheet cache version in \${file}\`);
  await writeFile(output, html);
}
for (const file of ['assets/js/tools.js', 'assets/js/notebook.js']) {
  const output = path.join(root, 'dist', file);
  let source = await readFile(output, 'utf8');
  source = source.replace(/(\.\/tools-core\.js)\?v=\d+/g, \`$1?v=\${CACHE_VERSION}\`);
  if (!source.includes(\`./tools-core.js?v=\${CACHE_VERSION}\`)) throw new Error(\`Missing shared tools-core version in \${file}\`);
  await writeFile(output, source);
}
console.log(`Static site built: ${data.entries.length} archive entries, ${data.projects.length} projects. No backend or runtime dependencies.`);
