import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLinks, classifyHTTP, createImagePDF, imagePlacement, linksCSV, safeFilename, validateNotebook, upgradeNotebook } from '../assets/js/tools-core.js';

test('PDF pages contain images without cropping and can follow each image orientation', () => {
  const fit = imagePlacement(200, 100, 600, 800, 30);
  assert.deepEqual(fit, { x: 30, y: 265, width: 540, height: 270 });
  const image = { width: 200, height: 100, bytes: new Uint8Array([255, 216, 10, 200, 0, 255, 217]) };
  const pdf = createImagePDF([image, { ...image, width: 100, height: 200 }], { size: 'letter' });
  const text = new TextDecoder('latin1').decode(pdf);
  assert.match(text, /^%PDF-1.4/);
  assert.match(text, /\/Count 2/);
  assert.match(text, /\/MediaBox \[0 0 792 612\]/);
  assert.match(text, /\/MediaBox \[0 0 612 792\]/);
  assert.match(text, /\/Filter \/DCTDecode/);
  const offset = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(new TextDecoder().decode(pdf.slice(offset, offset + 4)), 'xref');
  const entries = text.slice(offset).split('\n').slice(3, 11);
  entries.forEach((entry, i) => {
    const objectOffset = Number(entry.slice(0, 10));
    assert.equal(new TextDecoder().decode(pdf.slice(objectOffset, objectOffset + `${i + 1} 0 obj`.length)), `${i + 1} 0 obj`);
  });
  assert.throws(() => createImagePDF([]));
  assert.throws(() => createImagePDF([{ ...image, bytes: new Uint8Array([1, 2, 3, 4]) }]));
  assert.throws(() => imagePlacement(0, 100, 600, 800));
});

test('link analysis rejects unsafe schemes and credentials and identifies duplicate pages', () => {
  const rows = analyzeLinks('example.com\nhttps://EXAMPLE.com/#first\nhttps://example.com/#second\njavascript:alert(1)\nhttps://user:pass@example.com\nnot a url\nhttps://example.com/Other');
  assert.equal(rows[0].url, 'https://example.com/');
  assert.equal(rows[0].state, 'valid');
  assert.equal(rows[1].duplicate, true);
  assert.equal(rows[2].duplicate, true);
  assert.ok(rows.slice(3, 6).every(r => r.state === 'invalid' && !r.url));
  assert.equal(rows[6].duplicate, false);
  assert.equal(analyzeLinks(Array.from({ length: 100 }, (_, i) => `https://example.com/${i}`).join('\n')).length, 50);
  assert.equal(analyzeLinks('mailto:a@example.com')[0].state, 'invalid');
});

test('HTTP outcomes distinguish unavailable pages, restricted responses, and unknown status', () => {
  assert.equal(classifyHTTP(200).state, 'available');
  assert.equal(classifyHTTP(404).state, 'unavailable');
  assert.equal(classifyHTTP(410).state, 'unavailable');
  for (const code of [401, 403, 429]) assert.equal(classifyHTTP(code).state, 'restricted');
  assert.equal(classifyHTTP(500).state, 'error');
  assert.equal(classifyHTTP(0).state, 'unverified');
});

test('CSV reports quote user content and neutralize spreadsheet formula prefixes', () => {
  const csv = linksCSV([{ raw: '=HYPERLINK("bad")', state: 'invalid', message: 'Use "https"', duplicate: false }]);
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
  assert.ok(csv.includes('"Use ""https"""'));
  assert.equal(safeFilename('../../my/notes\u0000'), 'mynotes');
  assert.equal(safeFilename('💡'), 'vault-export');
});

test('notebook restore accepts its own data and rejects invalid or excessive drawing data', () => {
  const notebook = { kind: 'adeeb-vault-notebook', version: 1, title: 'A thought', text: '<script>plain text</script>', strokes: [{ erase: false, color: '#123abc', width: 7, points: [[10, 20], [1400, 900]] }] };
  assert.equal(validateNotebook(notebook), notebook);
  assert.throws(() => validateNotebook({ ...notebook, version: 9 }));
  assert.throws(() => validateNotebook({ ...notebook, strokes: [{ ...notebook.strokes[0], points: [[Infinity, 2]] }] }));
  assert.throws(() => validateNotebook({ ...notebook, strokes: [{ ...notebook.strokes[0], color: 'url(evil)' }] }));
  assert.throws(() => validateNotebook({ ...notebook, text: 'x'.repeat(100001) }));
  assert.throws(() => validateNotebook({ ...notebook, strokes: [{ ...notebook.strokes[0], points: Array.from({ length: 60001 }, () => [0, 0]) }] }));
});

test('legacy notebooks migrate without losing the original drawing or text', () => {
  const original = { kind: 'adeeb-vault-notebook', version: 1, title: 'Existing notebook', text: 'Keep this exact text', strokes: [{ erase: false, color: '#112233', width: 3, points: [[10, 10]] }] };
  const migrated = upgradeNotebook(original);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.title, original.title);
  assert.equal(migrated.activePage, 0);
  assert.deepEqual(migrated.pages[0], { title: 'Page 1', text: original.text, strokes: original.strokes });
  assert.equal(original.version, 1);
});

test('multi-page backups validate page count, selected page, text and stroke bounds', () => {
  const data = { kind: 'adeeb-vault-notebook', version: 2, title: 'Twenty pages', activePage: 19, pages: Array.from({ length: 20 }, (_, i) => ({ title: `Page ${i + 1}`, text: `Notes ${i}`, strokes: [] })) };
  assert.equal(upgradeNotebook(data), data);
  assert.throws(() => validateNotebook({ ...data, pages: [] }));
  assert.throws(() => validateNotebook({ ...data, pages: [...data.pages, data.pages[0]] }));
  assert.throws(() => validateNotebook({ ...data, activePage: 20 }));
  assert.throws(() => validateNotebook({ ...data, activePage: 1.5 }));
  assert.throws(() => validateNotebook({ ...data, pages: [{ ...data.pages[0], title: 'x'.repeat(121) }] }));
  assert.throws(() => validateNotebook({ ...data, activePage: 0, pages: Array.from({ length: 3 }, () => ({ title: '', text: 'x'.repeat(100000), strokes: [] })) }));
});
