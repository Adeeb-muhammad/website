import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveFilterParams, readArchiveFilters } from '../assets/js/core.js';

const defaults = { q: '', genre: 'all', language: 'all', sort: 'recent' };

test('an address without filters opens the unfiltered archive', () => {
  assert.deepEqual(readArchiveFilters(''), defaults);
  assert.deepEqual(readArchiveFilters('?'), defaults);
  assert.equal(archiveFilterParams({}).toString(), '');
});

test('every filter survives a round trip through the URL', () => {
  const state = { q: 'dune', genre: 'Drama', language: 'English', sort: 'rating' };
  assert.deepEqual(readArchiveFilters('?' + archiveFilterParams(state)), state);
});

test('spaces, punctuation and unicode are encoded and read back unchanged', () => {
  for (const q of ['spider man: no way home', 'a & b = c # d % e', '50% off / 24', 'アニメ', 'Zoë’s film']) {
    const url = archiveFilterParams({ q });
    assert.deepEqual(readArchiveFilters('?' + url).q, q.trim(), q);
  }
});

test('a search query alone is shareable', () => {
  assert.equal(archiveFilterParams({ q: 'oppenheimer' }).toString(), 'q=oppenheimer');
});

test('genre, language and sort are each shareable on their own', () => {
  assert.equal(archiveFilterParams({ genre: 'Drama' }).toString(), 'genre=Drama');
  assert.equal(archiveFilterParams({ language: 'Tamil' }).toString(), 'language=Tamil');
  assert.equal(archiveFilterParams({ sort: 'year' }).toString(), 'sort=year');
});

test('defaults are left out of the URL', () => {
  assert.equal(archiveFilterParams({ q: '   ', genre: 'all', language: 'all', sort: 'recent' }).toString(), '');
  assert.equal(readArchiveFilters('?q=&genre=&language=').q, '');
  assert.deepEqual(readArchiveFilters('?q=&genre=&language=&sort='), defaults);
});

test('invalid values fall back to the defaults instead of leaking into the archive', () => {
  assert.equal(readArchiveFilters('?sort=alphabetical').sort, 'recent');
  assert.equal(readArchiveFilters('?sort=delete-everything').sort, 'recent');
  assert.equal(archiveFilterParams({ sort: 'nonsense' }).toString(), '');
  assert.equal(readArchiveFilters('?genre=').genre, 'all');
});

test('once written, an invalid sort is dropped from the URL', () => {
  const sanitized = archiveFilterParams(readArchiveFilters('?q=leo&sort=bogus'));
  assert.equal(sanitized.toString(), 'q=leo');
});

test('a very long query is capped rather than trusted', () => {
  const q = 'x'.repeat(500);
  assert.equal(readArchiveFilters('?' + archiveFilterParams({ q })).q.length, 200);
});
