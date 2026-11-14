/**
 * Static page checks that do not need a browser: every local reference exists,
 * stylesheet url() targets resolve from the stylesheet, cache versions agree,
 * and placeholder links are not live.
 *
 * These catch the class of bug where a path looks right in source but resolves
 * somewhere else in the browser (the poster backdrop did exactly that).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const htmlFiles = [
  'index.html',
  'studio.html',
  'currently-watching.html',
  'reading-log.html',
  'tools.html',
  'vault-archive.html',
  'canvas-pro.html',
  '404.html',
  'LICENSES/index.html',
  'music-studio/index.html',
];

const cacheVersion = /const CACHE_VERSION = '(\d+)'/.exec(
  await readFile(path.join(root, 'scripts/build.mjs'), 'utf8'),
)?.[1];

function localTarget(file, ref) {
  const clean = ref.split(/[?#]/)[0];
  if (!clean) return null;
  return clean.startsWith('/')
    ? path.join(root, clean)
    : path.join(root, path.dirname(file), clean);
}

for (const file of htmlFiles) {
  test(`${file}: every local src/href resolves`, async () => {
    const html = await readFile(path.join(root, file), 'utf8');
    const missing = [];
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const ref = match[1];
      if (/^(?:https?:|#|mailto:|data:|javascript:)/.test(ref)) continue;
      const target = localTarget(file, ref);
      if (!target) continue;
      try {
        await access(target);
      } catch {
        missing.push(ref);
      }
    }
    assert.deepEqual(missing, []);
  });
}

test('stylesheet url() targets exist next to the stylesheet', async () => {
  const directory = path.join(root, 'assets/css');
  const missing = [];
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.css')) continue;
    const css = await readFile(path.join(directory, name), 'utf8');
    for (const match of css.matchAll(/url\((['"]?)([^)'"\s]+)\1\)/g)) {
      const ref = match[2];
      // #filter and %23filter are same-document SVG references, not files.
      if (/^(?:https?:|data:|%23|#)/.test(ref)) continue;
      try {
        await access(path.join(directory, ref.split(/[?#]/)[0]));
      } catch {
        missing.push(`${name}: ${ref}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('every stylesheet cache version matches the build version', async () => {
  assert.ok(cacheVersion, 'CACHE_VERSION is defined in scripts/build.mjs');
  const wrong = [];
  for (const file of htmlFiles) {
    const html = await readFile(path.join(root, file), 'utf8');
    for (const match of html.matchAll(/(?:\.\.\/|\/)?assets\/css\/style\.css\?v=(\d+)/g)) {
      if (match[1] !== cacheVersion) wrong.push(`${file}: v${match[1]}`);
    }
  }
  assert.deepEqual(wrong, [], `expected style.css?v=${cacheVersion}`);
});

test('the shared misc nav is cache-versioned', async () => {
  const wrong = [];
  for (const file of htmlFiles) {
    const html = await readFile(path.join(root, file), 'utf8');
    if (html.includes('misc-nav.js') && !/misc-nav\.js\?v=\d+/.test(html)) wrong.push(file);
  }
  assert.deepEqual(wrong, []);
});

test('placeholder links are not live', async () => {
  const offenders = [];
  for (const file of htmlFiles) {
    const html = (await readFile(path.join(root, file), 'utf8')).replace(/<!--[\s\S]*?-->/g, '');
    for (const match of html.matchAll(/href="([^"]*YOUR_[^"]*)"/g)) {
      offenders.push(`${file}: ${match[1]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('sitemap entries point at real pages', async () => {
  const sitemap = await readFile(path.join(root, 'sitemap.xml'), 'utf8');
  const missing = [];
  for (const match of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const url = match[1];
    const pathname = new URL(url).pathname.replace(/^\//, '');
    if (!pathname) continue;
    const target = pathname.endsWith('/')
      ? path.join(root, pathname, 'index.html')
      : path.join(root, pathname);
    try {
      await access(target);
    } catch {
      missing.push(url);
    }
  }
  assert.deepEqual(missing, []);
});
