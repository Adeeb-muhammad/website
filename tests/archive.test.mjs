import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { archiveStats, escapeHTML, isDate, makeSlug, ratingMarkup, safeURL, selectEntries, validateArchive } from '../assets/js/core.js';

const source = JSON.parse(readFileSync(new URL('../data/archive.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(source);

test('the published archive has a valid schema', () => assert.deepEqual(validateArchive(source), []));
test('sample ratings never count as the owner’s viewing history', () => {
  const stats = archiveStats(source.entries);
  assert.equal(stats.watched, 0); assert.equal(stats.average, null); assert.equal(stats.minutes, 0); assert.equal(stats.samples, 10);
  const data = fresh(); data.entries[0].isSample = false;
  assert.deepEqual(archiveStats(data.entries), { watched: 1, watchlist: 0, minutes: 163, average: 4.5, samples: 9 });
});
test('search, type, and genre filters combine without changing the source', () => {
  assert.equal(selectEntries(source.entries, { query: 'GARLAND', genre: 'Thriller' }).length, 1);
  assert.equal(selectEntries(source.entries, { collection: 'series' }).length, 0);
  assert.equal(selectEntries(source.entries, { collection: 'watchlist', query: 'Dune' })[0].id, 'dune-part-two');
  assert.equal(selectEntries(source.entries, { query: 'no such title' }).length, 0);
  assert.equal(source.entries[0].id, 'blade-runner-2049');
});
test('sorting puts the highest rating first and handles unrated entries', () => {
  assert.equal(selectEntries(source.entries, { sort: 'rating' })[0].title, 'Perfect Blue');
  const entries = fresh().entries; entries[1].rating = null;
  assert.equal(selectEntries(entries, { sort: 'rating' }).at(-1).title, 'Perfect Blue');
  assert.equal(selectEntries(source.entries, { sort: 'year' })[0].title, 'Annihilation');
});
test('watched dates sort correctly without invalid dates silently rolling over', () => {
  const entries = fresh().entries; entries[0].watchedOn = '2026-01-05'; entries[1].watchedOn = '2026-02-10';
  assert.equal(selectEntries(entries)[0].title, 'Perfect Blue');
  assert.equal(isDate('2024-02-29'), true); assert.equal(isDate('2025-02-29'), false); assert.equal(isDate('2026-13-01'), false); assert.equal(isDate(null), false);
});
test('ratings must use valid half-star increments and remain absent on watchlists', () => {
  for (const rating of [-1, 0, 3.7, 5.5, '5']) { const data = fresh(); data.entries[0].rating = rating; assert.ok(validateArchive(data).some(x => x.includes('half-star'))); }
  const data = fresh(); data.entries[5].rating = 4;
  assert.ok(validateArchive(data).some(x => x.includes('watchlist entries cannot')));
  assert.equal((ratingMarkup(4.5).match(/class="star full"/g) || []).length, 4);
  assert.equal((ratingMarkup(4.5).match(/class="star half"/g) || []).length, 1);
  assert.ok(ratingMarkup(null).includes('NOT RATED'));
});
test('duplicate IDs and malformed imported entries are rejected before saving', () => {
  const data = fresh(); data.entries[1].id = data.entries[0].id;
  assert.ok(validateArchive(data).some(x => x.includes('IDs must be unique')));
  assert.ok(validateArchive({}).length); assert.ok(validateArchive(null).length);
  const nullEntry = fresh(); nullEntry.entries.push(null); assert.ok(validateArchive(nullEntry).length);
  const malformedProject = fresh(); malformedProject.projects[0].tags = null; assert.ok(validateArchive(malformedProject).length);
});
test('unsafe image and link protocols cannot be published through the editor', () => {
  for (const input of ['javascript:alert(1)', 'data:text/html,test', 'http://example.com/a.jpg', 'https://user:password@example.com', '//example.com/a.jpg', 'assets/images/../../secret']) assert.equal(safeURL(input, { image: true }), '');
  assert.equal(safeURL('assets/images/example.webp', { image: true }), 'assets/images/example.webp');
  assert.equal(safeURL('https://example.com/poster.jpg'), 'https://example.com/poster.jpg');
  const data = fresh(); data.entries[0].poster = 'javascript:alert(1)'; assert.ok(validateArchive(data).length);
  assert.equal(escapeHTML('<img src=x onerror="alert(1)">&'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;');
});
test('new titles receive stable unique slugs without breaking an existing entry ID', () => {
  assert.equal(makeSlug('Perfect Blue', source.entries), 'perfect-blue-2');
  assert.equal(makeSlug('Perfect Blue', source.entries, 'perfect-blue'), 'perfect-blue');
  assert.equal(makeSlug('Été — 2026!'), 'ete-2026');
  assert.equal(makeSlug('🎬', [{ id: 'entry' }]), 'entry-2');
});
test('series currently being watched stay in series, not the watchlist', () => {
  const entry = { ...source.entries[0], id: 'test-series', type: 'series', status: 'watching', runtime: 0, isSample: false };
  const entries = [...source.entries, entry];
  assert.equal(selectEntries(entries, { collection: 'series' }).length, 1);
  assert.equal(selectEntries(entries, { collection: 'watchlist' }).length, 5);
  assert.equal(archiveStats(entries).watched, 0);
});
