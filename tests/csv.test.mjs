import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV, csvToObjects, jsonToCSV, csvCell } from '../assets/js/csv-core.js';

test('CSV fields, empty cells and trailing delimiters are kept', () => {
  assert.deepEqual(parseCSV('a,b,c\n1,2,3'), [['a', 'b', 'c'], ['1', '2', '3']]);
  // Explicit delimiters are a real row of empty cells, not a blank line.
  assert.deepEqual(parseCSV('a,b,\n1,,3'), [['a', 'b', ''], ['1', '', '3']]);
  assert.deepEqual(csvToObjects('a,b,c\n1,,3'), [{ a: '1', b: '', c: '3' }]);
});

test('quoted commas, escaped quotes and newlines inside quotes survive', () => {
  const rows = parseCSV('"a,b",c\n"he said ""hi""","line\nbreak"');
  assert.deepEqual(rows, [['a,b', 'c'], ['he said "hi"', 'line\nbreak']]);
  assert.deepEqual(csvToObjects('name,note\n"Smith, J","two\nlines"'), [{ name: 'Smith, J', note: 'two\nlines' }]);
});

test('CRLF, LF and lone CR all end a record, and blank lines are skipped', () => {
  assert.deepEqual(parseCSV('a,b\r\n1,2\r\n3,4'), [['a', 'b'], ['1', '2'], ['3', '4']]);
  assert.deepEqual(parseCSV('a,b\r1,2\r3,4'), [['a', 'b'], ['1', '2'], ['3', '4']]);
  assert.deepEqual(parseCSV('a,b\n\n1,2\n\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCSV(''), []);
  assert.deepEqual(parseCSV('   \n\n'), [['   ']]);
});

test('an unclosed quoted field is an error, not a silently truncated row', () => {
  assert.throws(() => parseCSV('a,b\n"open,2'), /unclosed quoted field/);
  assert.throws(() => csvToObjects('a\n"open'), /unclosed quoted field/);
});

test('duplicate headers are rejected instead of overwriting a column', () => {
  // The old Text & code converter silently produced [{ a: "2" }] for this input.
  assert.throws(() => csvToObjects('a,a\n1,2'), /headers must be unique/);
  // Trimmed duplicates are duplicates too.
  assert.throws(() => csvToObjects('a, a\n1,2'), /headers must be unique/);
});

test('empty and whitespace-only headers are rejected', () => {
  assert.throws(() => csvToObjects('a,\n1,2'), /headers must be non-empty/);
  assert.throws(() => csvToObjects('a,   \n1,2'), /headers must be non-empty/);
});

test('a row with more cells than headers is an error, not data loss', () => {
  assert.throws(() => csvToObjects('a,b\n1,2,3'), /row 2 has 3 cells but there are 2 headers/);
});

test('empty CSV and header-only CSV agree, and short rows pad with empty strings', () => {
  assert.deepEqual(csvToObjects(''), []);
  assert.deepEqual(csvToObjects('\n\n'), []);
  assert.deepEqual(csvToObjects('a,b'), []);
  assert.deepEqual(csvToObjects('a,b\n1'), [{ a: '1', b: '' }]);
  assert.deepEqual(csvToObjects(' a , b \n1,2'), [{ a: '1', b: '2' }]);
});

test('unicode, BOM and multi-byte text survive the round trip', () => {
  assert.deepEqual(csvToObjects('\ufeffname\nAdeeb 👋'), [{ name: 'Adeeb 👋' }]);
  const data = [{ name: 'Adeeb 👋', note: 'comma, quote " and\nnewline' }];
  assert.deepEqual(csvToObjects(jsonToCSV(data)), data);
});

test('JSON to CSV quotes and escapes values and keeps nested objects', () => {
  const csv = jsonToCSV([{ a: 'x,y', b: 'say "hi"', c: null, d: { deep: 1 } }]);
  assert.equal(csv.split('\r\n')[0], 'a,b,c,d');
  assert.equal(csv.split('\r\n')[1], '"x,y","say ""hi""",,"{""deep"":1}"');
  assert.equal(csvCell('plain'), 'plain');
  assert.throws(() => jsonToCSV([]), /non-empty array of objects/);
  assert.throws(() => jsonToCSV([1, 2]), /non-empty array of objects/);
});

test('both Utility Desk converters use this one implementation', () => {
  const source = readFileSync(new URL('../assets/js/tools.js', import.meta.url), 'utf8');
  assert.match(source, /import \{[^}]*csvToObjects[^}]*\} from '\.\/csv-core\.js\?v=\d+'/);
  for (const local of ['function csvParse(', 'function csvParseFile(', 'function csvToJSON(', 'function csvCell(', 'function csvEscape(', 'function jsonToCSV(']) {
    assert.equal(source.includes(local), false, `${local} should not exist in tools.js any more`);
  }
  assert.equal((source.match(/csvToObjects\(/g) || []).length, 2, 'text and file converters both call csvToObjects');
});
