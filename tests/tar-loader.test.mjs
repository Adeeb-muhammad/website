import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTar, readTar, loadScript } from '../assets/js/tools-core.js';

const bytes = (length, seed = 0) => Uint8Array.from({ length }, (_, i) => (i * 31 + seed) & 255);
const ascii = (buffer, start, end) => String.fromCharCode(...buffer.slice(start, end));
const headerSum = header => {
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += (i >= 148 && i < 156) ? 32 : header[i];
  return sum;
};

test('TAR headers use octal fields, a valid checksum and USTAR magic', () => {
  const tar = createTar([{ name: 'small.bin', data: bytes(8) }]);
  const header = tar.slice(0, 512);
  assert.equal(ascii(tar, 257, 265), 'ustar\x0000');
  assert.match(ascii(tar, 100, 108), /^[0-7]{7}\0$/);
  assert.equal(parseInt(ascii(tar, 100, 108), 8), 0o644);
  assert.match(ascii(tar, 124, 136), /^[0-7]{11}\0$/);
  assert.equal(parseInt(ascii(tar, 124, 136), 8), 8);
  assert.equal(ascii(tar, 136, 148), '00000000000\0');
  assert.match(ascii(tar, 148, 156), /^[0-7]{6}\0 $/);
  assert.equal(parseInt(ascii(tar, 148, 156), 8), headerSum(header));
  assert.equal(tar[156], 48);
  assert.equal(tar.length, 512 + 512 + 1024);
  assert.ok(tar.slice(-1024).every(byte => byte === 0));
});

test('TAR sizes survive decimal/octal boundary values and round-trip exactly', () => {
  const sizes = [0, 7, 8, 9, 63, 64, 1000, 4095, 4096, 12345];
  const entries = sizes.map((size, i) => ({ name: `nested/file-${i}.bin`, data: bytes(size, i) }));
  const tar = createTar(entries);
  const parsed = readTar(tar);
  assert.equal(parsed.length, entries.length);
  for (let i = 0; i < entries.length; i++) {
    assert.equal(parsed[i].name, entries[i].name);
    assert.equal(parsed[i].dir, false);
    assert.deepEqual(parsed[i].data, entries[i].data);
  }
  // Each block starts with the expected octal size, not its decimal spelling.
  let offset = 0;
  for (const entry of parsed) {
    assert.equal(parseInt(ascii(tar, offset + 124, offset + 136), 8), entry.data.length);
    offset += 512 + Math.ceil(entry.data.length / 512) * 512;
  }
});

test('long paths use the USTAR prefix field and unsafe paths are rejected', () => {
  const long = 'collection/' + 'a'.repeat(90) + '/' + 'b'.repeat(90) + '.txt';
  const tar = createTar([{ name: long, data: bytes(3) }]);
  const header = tar.slice(0, 512);
  assert.ok(ascii(header, 345, 500).replace(/\0.*$/, '').length > 0);
  assert.ok(ascii(header, 0, 100).replace(/\0.*$/, '').length <= 100);
  assert.equal(readTar(tar)[0].name, long);

  assert.throws(() => createTar([{ name: 'x'.repeat(300), data: bytes(1) }]), /too long/i);
  assert.throws(() => createTar([{ name: '../escape.txt', data: bytes(1) }]), /unsafe/i);
  assert.throws(() => createTar([{ name: '/absolute.txt', data: bytes(1) }]), /absolute/i);
  assert.throws(() => createTar([{ name: 'same.txt', data: bytes(1) }, { name: 'same.txt', data: bytes(2) }]), /duplicate/i);
  assert.throws(() => createTar([{ name: 'x', data: bytes(20) }], { maxBytes: 10 }), /limit/i);
  assert.throws(() => createTar([{ name: 'x', data: bytes(1) }], { maxEntries: 0 }), /entries/i);
});

test('directories and empty files round-trip through TAR', () => {
  const tar = createTar([
    { name: 'empty', dir: true },
    { name: 'empty/blank.txt', data: new Uint8Array(0) },
    { name: 'empty/nested/', dir: true },
  ]);
  const entries = readTar(tar);
  assert.deepEqual(entries.map(entry => entry.name), ['empty/', 'empty/blank.txt', 'empty/nested/']);
  assert.deepEqual(entries.map(entry => entry.dir), [true, false, true]);
});

test('bad checksums, invalid octal and truncated archives are rejected', () => {
  const tar = createTar([{ name: 'file.txt', data: bytes(20) }]);
  const changed = tar.slice();
  changed[0] ^= 1;
  assert.throws(() => readTar(changed), /checksum/i);

  const decimal = tar.slice();
  decimal.set(new TextEncoder().encode('00000000008\0'), 124);
  decimal.set(new TextEncoder().encode(headerSum(decimal).toString(8).padStart(6, '0') + '\0 '), 148);
  assert.throws(() => readTar(decimal), /size field/i);

  assert.throws(() => readTar(tar.slice(0, 512 + 512)), /end marker/i);
  assert.throws(() => readTar(createTar([{ name: 'a', data: bytes(700) }]).slice(0, 900)), /truncated/i);
});

test('a system TAR reader accepts the generated archive', t => {
  let available = true;
  try { execFileSync('tar', ['--version'], { stdio: 'ignore' }); } catch { available = false; }
  if (!available) return t.skip('system tar is unavailable');
  const dir = mkdtempSync(join(tmpdir(), 'vault-tar-'));
  try {
    const payload = bytes(12345, 7);
    const tar = createTar([
      { name: 'plain.txt', data: new TextEncoder().encode('hello') },
      { name: 'nested/dir/data.bin', data: payload },
      { name: 'nested/dir/', dir: true },
    ]);
    const path = join(dir, 'test.tar');
    writeFileSync(path, tar);
    const list = execFileSync('tar', ['-tf', path], { encoding: 'utf8' }).trim().split('\n');
    assert.deepEqual(list.sort(), ['nested/dir/', 'nested/dir/data.bin', 'plain.txt'].sort());
    const extracted = execFileSync('tar', ['-xOf', path, 'nested/dir/data.bin']);
    assert.deepEqual(new Uint8Array(extracted), payload);
    const text = execFileSync('tar', ['-xOf', path, 'plain.txt'], { encoding: 'utf8' });
    assert.equal(text, 'hello');
  } finally {
    rmSync(dir, { recursive: true, force: true });
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
