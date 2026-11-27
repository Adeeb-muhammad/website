import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeBase64, jsonToXML } from '../assets/js/convert-core.js';

test('JSON to XML keeps every item of a primitive array', () => {
  assert.equal(
    jsonToXML({ tags: ['one', 'two'], name: 'A & B' }),
    '<root><tags>one</tags><tags>two</tags><name>A &amp; B</name></root>'
  );
  assert.equal(
    jsonToXML({ items: [{ x: 1 }, { x: 2 }] }),
    '<root><items><x>1</x></items><items><x>2</x></items></root>'
  );
});

test('JSON to XML restores attributes and escapes text', () => {
  assert.equal(
    jsonToXML({ user: { '@id': '7', 'name': '<Ada>', 'active': true, 'missing': null } }),
    '<root><user id="7"><name>&lt;Ada&gt;</name><active>true</active><missing></missing></user></root>'
  );
  // Keys that are not valid XML names fall back to an <item> element.
  assert.equal(jsonToXML({ 'bad key': 1 }), '<root><item>1</item></root>');
});

test('Base64 decoding ignores the line breaks that wrapping adds', () => {
  assert.equal(decodeBase64('SGVs\nbG8g\nd29y\nbGQ='), 'Hello world');
  assert.equal(decodeBase64('  SGVsbG8=  '), 'Hello');
  // Unpadded Base64 is accepted by atob when the length is otherwise valid.
  assert.equal(decodeBase64('SGVsbG8'), 'Hello');
  const unicode = Buffer.from('Tamil: தமிழ் · emoji 🎬', 'utf8').toString('base64').replace(/(.{8})/g, '$1\n');
  assert.equal(decodeBase64(unicode), 'Tamil: தமிழ் · emoji 🎬');
});

test('Base64 decoding explains bad input instead of leaking atob errors', () => {
  assert.throws(() => decodeBase64(''), /Enter Base64 text/);
  assert.throws(() => decodeBase64('***'), /not valid Base64/);
  assert.throws(() => decodeBase64('A'), /incomplete or malformed/);
  assert.throws(() => decodeBase64('//79'), /UTF-8/);
});
