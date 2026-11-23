import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readTar, loadScript } from '../assets/js/tools-core.js';

const bytes = (length, seed = 0) => Uint8Array.from({ length }, (_, i) => (i * 31 + seed) & 255);
const ascii = (buffer, start, end) => String.fromCharCode(...buffer.slice(start, end));
const writeAscii = (buffer, offset, value, length = 100) => {
  buffer.fill(0, offset, offset + length);
  buffer.set(new TextEncoder().encode(value), offset);
};
const withValidChecksum = (tar, change) => {
  const copy = tar.slice();
  copy.fill(32, 148, 156);
  change(copy);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += copy[i];
  copy.set(new TextEncoder().encode(sum.toString(8).padStart(6, '0') + '\0 '), 148);
  return copy;
};

function systemTar(t, files, paths) {
  try { execFileSync('tar', ['--version'], { stdio: 'ignore' }); }
  catch { t.skip('system tar is unavailable'); return null; }
  const dir = mkdtempSync(join(tmpdir(), 'vault-tar-'));
  for (const [name, data] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  }
  const archive = join(dir, 'fixture.tar');
  execFileSync('tar', ['--format=ustar', '--owner=0', '--group=0', '--numeric-owner', '-cf', archive, '-C', dir, ...paths]);
  return { dir, tar: new Uint8Array(readFileSync(archive)) };
}

test('a system USTAR archive reads sizes, padding, directories and empty files', t => {
  const sizes = [0, 7, 8, 9, 63, 64, 1000, 4095, 4096, 12345];
  const files = { 'plain.txt': 'hello' };
  for (let i = 0; i < sizes.length; i++) files[`sizes/file-${i}.bin`] = bytes(sizes[i], i);
  files['nested/dir/data.bin'] = bytes(12345, 7);
  const fixture = systemTar(t, files, ['plain.txt', 'sizes', 'nested']);
  if (!fixture) return;
  try {
    const entries = readTar(fixture.tar);
    const byName = new Map(entries.map(entry => [entry.name, entry]));
    assert.equal(new TextDecoder().decode(byName.get('plain.txt').data), 'hello');
    assert.equal(byName.get('plain.txt').dir, false);
    assert.equal(byName.get('sizes/').dir, true);
    assert.equal(byName.get('nested/dir/').dir, true);
    assert.deepEqual(byName.get('nested/dir/data.bin').data, files['nested/dir/data.bin']);
    for (let i = 0; i < sizes.length; i++) {
      assert.deepEqual(byName.get(`sizes/file-${i}.bin`).data, files[`sizes/file-${i}.bin`]);
    }
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('long USTAR paths read back through the prefix field', t => {
  const long = 'collection/' + 'a'.repeat(90) + '/' + 'b'.repeat(90) + '.txt';
  const fixture = systemTar(t, { [long]: bytes(3) }, ['collection']);
  if (!fixture) return;
  try {
    const entries = readTar(fixture.tar);
    assert.equal(entries.find(entry => entry.name === long)?.data.length, 3);
    assert.ok(entries.some(entry => entry.name.endsWith('/')));
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('bad checksums, unsafe paths, invalid octal and truncated archives are rejected', t => {
  const fixture = systemTar(t, { 'file.txt': bytes(700) }, ['file.txt']);
  if (!fixture) return;
  try {
    const tar = fixture.tar;
    assert.equal(ascii(tar, 0, 8), 'file.txt');
    const changed = tar.slice();
    changed[0] ^= 1;
    assert.throws(() => readTar(changed), /checksum/i);

    const decimal = withValidChecksum(tar, copy => copy.set(new TextEncoder().encode('00000000008\0'), 124));
    assert.throws(() => readTar(decimal), /size field/i);

    const unsafe = withValidChecksum(tar, copy => writeAscii(copy, 0, '../escape.txt'));
    assert.throws(() => readTar(unsafe), /unsafe/i);

    const absolute = withValidChecksum(tar, copy => writeAscii(copy, 0, '/absolute.txt'));
    assert.throws(() => readTar(absolute), /absolute/i);

    assert.throws(() => readTar(tar.slice(0, 900)), /truncated/i);
    assert.throws(() => readTar(tar.slice(0, 512 + 1024)), /end marker/i);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

/* ---------------- CDN script loader ---------------- */

function fakeDocument() {
  const doc = {
    scripts: [],
    head: {
      append(script) { doc.scripts.push(script); script.parentNode = doc.head; },
      removeChild(script) { doc.scripts = doc.scripts.filter(item => item !== script); script.parentNode = null; }
    }
  };
  doc.createElement = () => {
    const script = {
      src: '', async: false, dataset: {}, listeners: new Map(), parentNode: null,
      addEventListener(type, fn) { script.listeners.set(type, fn); },
      removeEventListener(type, fn) { if (script.listeners.get(type) === fn) script.listeners.delete(type); },
      remove() { doc.head.removeChild(script); },
      emit(type) { const fn = script.listeners.get(type); if (fn) fn(); }
    };
    return script;
  };
  return doc;
}

let loadId = 0;
const url = () => `https://cdn.example.test/library-${++loadId}.js`;

test('script loader resolves once and caches successful loads', async () => {
  const doc = fakeDocument();
  const src = url();
  const first = loadScript(src, { documentRef: doc, timeoutMs: 200 });
  assert.equal(doc.scripts.length, 1);
  doc.scripts[0].emit('load');
  await first;
  assert.equal(doc.scripts[0].dataset.loaded, 'yes');
  await loadScript(src, { documentRef: doc, timeoutMs: 200 });
  assert.equal(doc.scripts.length, 1);
});

test('concurrent script requests share one element and promise', async () => {
  const doc = fakeDocument();
  const src = url();
  const first = loadScript(src, { documentRef: doc, timeoutMs: 200 });
  const second = loadScript(src, { documentRef: doc, timeoutMs: 200 });
  assert.equal(doc.scripts.length, 1);
  doc.scripts[0].emit('load');
  await Promise.all([first, second]);
  assert.equal(doc.scripts[0].dataset.loaded, 'yes');
});

test('a failed script is removed and a later retry creates a fresh one', async () => {
  const doc = fakeDocument();
  const src = url();
  const first = loadScript(src, { documentRef: doc, timeoutMs: 200 });
  doc.scripts[0].emit('error');
  await assert.rejects(first, /Could not load/);
  assert.equal(doc.scripts.length, 0);

  const retry = loadScript(src, { documentRef: doc, timeoutMs: 200 });
  assert.equal(doc.scripts.length, 1);
  doc.scripts[0].emit('load');
  await retry;
  assert.equal(doc.scripts[0].dataset.loaded, 'yes');
});

test('a script that never settles rejects on timeout and can be retried', async () => {
  const doc = fakeDocument();
  const src = url();
  const first = loadScript(src, { documentRef: doc, timeoutMs: 20 });
  await assert.rejects(first, /took too long/);
  assert.equal(doc.scripts.length, 0);

  const retry = loadScript(src, { documentRef: doc, timeoutMs: 200 });
  doc.scripts[0].emit('load');
  await retry;
});

test('permanent failure rejects every waiter exactly once', async () => {
  const doc = fakeDocument();
  const src = url();
  const first = loadScript(src, { documentRef: doc, timeoutMs: 200 });
  const second = loadScript(src, { documentRef: doc, timeoutMs: 200 });
  doc.scripts[0].emit('error');
  doc.scripts[0]?.emit('error');
  const results = await Promise.allSettled([first, second]);
  assert.deepEqual(results.map(result => result.status), ['rejected', 'rejected']);
  assert.equal(doc.scripts.length, 0);
});
