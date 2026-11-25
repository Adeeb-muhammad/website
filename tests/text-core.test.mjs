import test from 'node:test';
import assert from 'node:assert/strict';
import { countLines } from '../assets/js/text-core.js';

test('line count has one documented rule', () => {
  assert.equal(countLines(''), 0);
  assert.equal(countLines('a'), 1);
  assert.equal(countLines('a\n'), 1);
  assert.equal(countLines('a\nb'), 2);
  assert.equal(countLines('a\n\n'), 2);
  assert.equal(countLines('a\n\nb'), 3);
});

test('a trailing newline never adds a line, whatever the ending', () => {
  assert.equal(countLines('a\r\n'), 1);
  assert.equal(countLines('a\r'), 1);
  assert.equal(countLines('a\r\nb\r\n'), 2);
  assert.equal(countLines('a\nb\nc\n'), 3);
  assert.equal(countLines('a\n\n\n'), 3);
});

test('blank lines between text still count and whitespace lines are lines', () => {
  assert.equal(countLines('\n'), 1);
  assert.equal(countLines('\n\n'), 2);
  assert.equal(countLines('a\n \nb'), 3);
  assert.equal(countLines('   '), 1);
});

test('values that are not text are treated as empty rather than one line', () => {
  assert.equal(countLines(null), 0);
  assert.equal(countLines(undefined), 0);
});
