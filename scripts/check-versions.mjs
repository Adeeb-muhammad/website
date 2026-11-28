// Enforce the repository cache-version rule:
// - every local assets/css or assets/js reference is explicitly versioned;
// - a changed asset has one consistent ?v= value;
// - that value differs from the same reference on the base branch.
//
// Usage: node scripts/check-versions.mjs [base-ref]   (default origin/main)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

const base = process.argv[2] || 'origin/main';
const root = process.cwd();
const localAsset = /^(?:\.\.\/)*assets\/(?:css|js)\/[^?#]+\.(?:css|js)$/;
const versioned = /\?v=(\d+)$/;

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function list(files) {
  return files.flatMap(pattern => git(['ls-files', pattern]).split('\n')).filter(Boolean);
}

function assetPath(fromFile, reference) {
  const clean = reference.split('#')[0].split('?')[0];
  if (!clean.startsWith('.') && !clean.startsWith('assets/')) return null;
  const absolute = clean.startsWith('assets/')
    ? resolve(root, clean)
    : resolve(root, dirname(fromFile), clean);
  let path = relative(root, absolute).split(sep).join('/');
  if (!path.startsWith('assets/css/') && !path.startsWith('assets/js/')) return null;
  if (path.includes('/vendor/')) return null;
  return path;
}

function referencesIn(file, source) {
  const refs = [];
  const patterns = file.endsWith('.html')
    ? [/(?:src|href)="([^"]+)"/g]
    : [/(?:from|import)\s*\(?\s*['"]([^'"]+\.js(?:\?[^'"]*)?)['"]/g];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const path = assetPath(file, match[1]);
      if (!path) continue;
      const version = match[1].match(versioned)?.[1] ?? null;
      refs.push({ file, path, version, reference: match[1] });
    }
  }
  return refs;
}

const sourceFiles = [...new Set([...list(['*.html']), ...list(['*.js'])])]
  .filter(file => !file.startsWith('music-studio/') && !file.startsWith('dist/'))
  .filter(file => !file.includes('node_modules/'));

const currentRefs = [];
const unversioned = [];
for (const file of sourceFiles) {
  for (const ref of referencesIn(file, readFileSync(file, 'utf8'))) {
    currentRefs.push(ref);
    if (!ref.version) unversioned.push(`${file} → ${ref.reference}`);
  }
}
if (unversioned.length) {
  console.error('Local CSS/JS references must include ?v=<number>:');
  for (const item of unversioned) console.error(`  ${item}`);
  process.exit(1);
}

let changed = [];
try {
  changed = git(['diff', '--name-only', `${base}...HEAD`, '--', 'assets/css', 'assets/js'])
    .split('\n').filter(Boolean).filter(file => /\.(css|js)$/.test(file))
    // A deleted asset no longer has a page or module reference to version.
    .filter(file => existsSync(resolve(root, file)));
} catch {
  console.warn(`Could not compare against ${base}; checking version presence only.`);
}

const byAsset = new Map();
for (const ref of currentRefs) {
  if (!byAsset.has(ref.path)) byAsset.set(ref.path, []);
  byAsset.get(ref.path).push(ref);
}

let failed = false;
for (const asset of changed) {
  const refs = byAsset.get(asset) || [];
  if (!refs.length) {
    console.error(`${asset} changed but no versioned page/module reference was found.`);
    failed = true;
    continue;
  }
  const versions = new Set(refs.map(ref => ref.version));
  if (versions.size !== 1) {
    console.error(`${asset} has inconsistent versions: ${[...versions].join(', ')}.`);
    failed = true;
    continue;
  }
  const [version] = versions;
  let baseVersions = new Set();
  for (const file of new Set(refs.map(ref => ref.file))) {
    let source = '';
    try { source = git(['show', `${base}:${file}`]); } catch { continue; }
    for (const ref of referencesIn(file, source)) {
      if (ref.path === asset && ref.version) baseVersions.add(ref.version);
    }
  }
  if (baseVersions.has(version)) {
    console.error(`${asset} changed but ${refs[0].file} still uses ?v=${version}; bump it in every reference.`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`Cache versions are consistent (${changed.length} changed asset${changed.length === 1 ? '' : 's'}).`);
