import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveFilterParams, readArchiveFilters, normaliseArchiveQuery, FILTER_QUERY_LIMIT } from '../assets/js/core.js';

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

test('a very long search is capped in the link as well as on the way back in', () => {
  const long = 'a'.repeat(FILTER_QUERY_LIMIT + 250);
  const params = archiveFilterParams({ q: long });
  assert.equal(params.get('q').length, FILTER_QUERY_LIMIT);
  // The address bar the page writes reopens exactly the query the page was showing.
  assert.equal(readArchiveFilters('?' + params).q, long.slice(0, FILTER_QUERY_LIMIT));
  assert.equal(readArchiveFilters('?' + params).q, params.get('q'));
  // Short searches are untouched.
  assert.equal(archiveFilterParams({ q: '  the  ' }).get('q'), 'the');
});

test('queries of 199, 200 and 201 ASCII characters are capped at 200 code points', () => {
  const q199 = 'a'.repeat(199);
  const q200 = 'b'.repeat(200);
  const q201 = 'c'.repeat(201);
  assert.equal(normaliseArchiveQuery(q199), q199);
  assert.equal(normaliseArchiveQuery(q200), q200);
  assert.equal(normaliseArchiveQuery(q201), q201.slice(0, 200));
  assert.equal(archiveFilterParams({ q: q201 }).get('q'), q201.slice(0, 200));
});

test('a query longer than 200 characters is normalised once, everywhere', () => {
  const long = 'a'.repeat(500);
  const normalised = normaliseArchiveQuery(long);
  assert.equal(normalised, long.slice(0, FILTER_QUERY_LIMIT));
  assert.equal(normalised.length, FILTER_QUERY_LIMIT);
  // The live search, the URL and the state read back all share this exact value.
  assert.equal(archiveFilterParams({ q: long }).get('q'), normalised);
  assert.equal(readArchiveFilters('?' + archiveFilterParams({ q: long })).q, normalised);
});

test('199 ASCII characters followed by an emoji sit exactly on the cap, intact', () => {
  const q = 'a'.repeat(199) + '🎬';
  const normalised = normaliseArchiveQuery(q);
  assert.equal(normalised, q);
  assert.equal([...normalised].length, 200);
  assert.equal(normaliseArchiveQuery(q + 'a'), q);
});

test('200 emojis are 200 code points, so they survive the cap untouched', () => {
  const emojis = '🎬'.repeat(200);
  assert.equal(normaliseArchiveQuery(emojis), emojis);
  assert.equal([...normaliseArchiveQuery(emojis)].length, 200);
  assert.equal(normaliseArchiveQuery(emojis + '🎬'), emojis);
});

test('emoji survive the URL round trip', () => {
  const q = '🎬'.repeat(50);
  const params = archiveFilterParams({ q });
  assert.equal(params.get('q'), q);
  assert.equal(readArchiveFilters('?' + params).q, q);
});

test('leading and trailing whitespace is trimmed before the cap', () => {
  assert.equal(normaliseArchiveQuery('   the   '), 'the');
  const padded = '   ' + 'a'.repeat(210) + '   ';
  assert.equal(normaliseArchiveQuery(padded), 'a'.repeat(200));
  assert.equal(readArchiveFilters('?q=%20%20dune%20%20').q, 'dune');
});

test('no truncated query ever contains an unmatched surrogate', () => {
  const queries = [
    'a'.repeat(201),
    'a'.repeat(199) + '🎬',
    'a'.repeat(200) + '🎬',
    '🎬'.repeat(200) + 'a',
    '🎬'.repeat(201),
    '🧑🏽‍🚀'.repeat(100),
    'a'.repeat(198) + '😀' + 'b'.repeat(10),
    'a'.repeat(199) + '🎬' + 'b'.repeat(99),
  ];
  for (const q of queries) {
    const capped = normaliseArchiveQuery(q);
    assert.ok(capped.isWellFormed(), `unmatched surrogate in ${JSON.stringify(q)}`);
    assert.ok([...capped].length <= FILTER_QUERY_LIMIT, `over the cap for ${JSON.stringify(q)}`);
  }
});

test('the normalised value is the exact query the live search and URL share', () => {
  const q = '🎬'.repeat(199) + 'abc' + 'x'.repeat(100);
  const normalised = normaliseArchiveQuery(q);
  assert.equal(normalised, [...q].slice(0, FILTER_QUERY_LIMIT).join(''));
  assert.ok(normalised.isWellFormed());
  const params = archiveFilterParams({ q });
  assert.equal(params.get('q'), normalised);
  assert.equal(readArchiveFilters('?' + params).q, normalised);
  // Feeding the read-back value through again changes nothing.
  assert.equal(normaliseArchiveQuery(normalised), normalised);
});
