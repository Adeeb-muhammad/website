import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { archiveStats, escapeHTML, isDate, makeSlug, ratingMarkup, safeURL, selectEntries, validateArchive } from '../assets/js/core.js';

const published = JSON.parse(readFileSync(new URL('../data/archive.json', import.meta.url), 'utf8'));
const entry = (overrides = {}) => ({ id: 'test-film', title: 'Test film', year: 2024, type: 'film', category: 'general', languages: ['Tamil'], status: 'watched', director: 'Test director', genres: ['Drama'], runtime: 100, rating: 4.4, review: '', watchedOn: '', favourite: false, poster: '', image: '', isSample: false, ...overrides });
const fixture = () => ({ version: 1, profile: { name: 'Test', shortName: 'Test', bio: '', note: '', interests: [] }, projects: [], entries: [entry()] });

test('published collection validates and preserves the dictated ratings', () => {
  assert.deepEqual(validateArchive(published), []);
  const ratings = Object.fromEntries(published.entries.map(x => [x.id, x.rating]));
  assert.deepEqual(ratings, { baththa: 4, meiyazhagan: 4.5, mersal: 4.8, 'perfect-days': 4.5, '24': 4.4, 'ra-one': 4.4, oppenheimer: 4.5, 'small-things-like-these': 4.2, karuppu: 3, 'vishwanath-and-sons': 2, orb: 5, 'dr-stone': 4 });
  assert.equal(published.entries.some(x => x.isSample), false);
  assert.equal(published.entries.some(x => x.id === 'ex-machina'), false);
  assert.equal(published.entries.find(x => x.id === 'orb').review, 'It brought back the scientist inside me.');
});

test('sample entries and in-progress series do not inflate personal statistics', () => {
  const rows = [entry(), entry({ id: 'sample', isSample: true, rating: 5 }), entry({ id: 'unfinished', type: 'series', status: 'watching', rating: 4 }), entry({ id: 'next', status: 'watchlist', rating: null })];
  assert.deepEqual(archiveStats(rows), { watched: 1, watchlist: 1, minutes: 100, average: 4.4, samples: 1 });
});

test('language, genre and text filters combine without mutating the archive', () => {
  const rows = [entry({ id: 'tamil', title: 'Tamil story' }), entry({ id: 'english', languages: ['English'] }), entry({ id: 'bilingual', languages: ['Tamil', 'Hindi'], genres: ['Thriller'] })];
  const before = JSON.stringify(rows);
  assert.deepEqual(selectEntries(rows, { language: 'Tamil', genre: 'Drama', query: 'STORY' }).map(x => x.id), ['tamil']);
  assert.deepEqual(selectEntries(rows, { language: 'Hindi' }).map(x => x.id), ['bilingual']);
  assert.equal(selectEntries(rows, { query: 'English' })[0].id, 'english');
  assert.equal(selectEntries(rows, { language: 'French' }).length, 0);
  assert.equal(JSON.stringify(rows), before);
});

test('anime films and series have their own collection and share the watchlist', () => {
  const rows = [entry(), entry({ id: 'anime-film', category: 'anime' }), entry({ id: 'anime-series', type: 'series', category: 'anime' }), entry({ id: 'live-series', type: 'series' }), entry({ id: 'next-anime', type: 'series', category: 'anime', status: 'watchlist', rating: null })];
  assert.deepEqual(selectEntries(rows, { collection: 'films' }).map(x => x.id), ['test-film']);
  assert.deepEqual(selectEntries(rows, { collection: 'series' }).map(x => x.id), ['live-series']);
  assert.deepEqual(selectEntries(rows, { collection: 'anime' }).map(x => x.id), ['anime-film', 'anime-series']);
  assert.deepEqual(selectEntries(rows, { collection: 'watchlist' }).map(x => x.id), ['next-anime']);
});

test('ratings accept decimal tenths, reject invalid values, and keep watchlists unrated', () => {
  for (const rating of [0.1, 0.5, 3.9, 4.2, 4.4, 4.8, 5, null]) {
    const data = fixture(); data.entries[0].rating = rating; assert.deepEqual(validateArchive(data), []);
  }
  for (const rating of [-1, 0, 4.44, 5.1, '5', NaN]) {
    const data = fixture(); data.entries[0].rating = rating; assert.ok(validateArchive(data).some(x => x.includes('0.1-star')));
  }
  const data = fixture(); data.entries[0].status = 'watchlist';
  assert.ok(validateArchive(data).some(x => x.includes('watchlist entries cannot')));
});

test('decimal stars preserve exact numeric and accessible ratings', () => {
  const markup = ratingMarkup(4.4);
  assert.ok(markup.includes('aria-label="4.4 out of 5 stars"'));
  assert.equal((markup.match(/--star-fill:100%/g) || []).length, 4);
  assert.ok(markup.includes('--star-fill:40%'));
  assert.ok(ratingMarkup(4.8).includes('--star-fill:80%'));
  assert.ok(ratingMarkup(3.9).includes('--star-fill:90%'));
  assert.ok(ratingMarkup(null).includes('NOT RATED'));
});

test('sorting uses exact ratings, handles unrated titles, and respects years and dates', () => {
  const rows = [entry({ id: 'lower', rating: 4.4, watchedOn: '2026-01-05' }), entry({ id: 'higher', rating: 4.8, watchedOn: '2026-02-10' }), entry({ id: 'unrated', rating: null, year: 2026 })];
  assert.equal(selectEntries(rows, { sort: 'rating' })[0].id, 'higher');
  assert.equal(selectEntries(rows, { sort: 'rating' }).at(-1).id, 'unrated');
  assert.equal(selectEntries(rows, { sort: 'year' })[0].id, 'unrated');
  assert.equal(selectEntries(rows)[0].id, 'higher');
});

test('older drafts without category, languages or Instagram still load', () => {
  const data = fixture(); delete data.entries[0].category; delete data.entries[0].languages;
  assert.deepEqual(validateArchive(data), []);
  assert.equal(selectEntries(data.entries).length, 1);
  assert.equal(selectEntries(data.entries, { collection: 'anime' }).length, 0);
});

test('malformed new fields, duplicate IDs and broken imports are rejected', () => {
  for (const update of [{ category: 'other' }, { languages: 'Tamil' }, { languages: [null] }, { languages: [''] }]) {
    const data = fixture(); Object.assign(data.entries[0], update); assert.ok(validateArchive(data).length);
  }
  const data = fixture(); data.entries.push(entry());
  assert.ok(validateArchive(data).some(x => x.includes('IDs must be unique')));
  assert.ok(validateArchive({}).length); assert.ok(validateArchive(null).length);
  data.entries = [null]; assert.ok(validateArchive(data).length);
});

test('unsafe images, project links and Instagram URLs cannot be published', () => {
  for (const input of ['javascript:alert(1)', 'data:text/html,test', 'http://example.com/a.jpg', 'https://user:password@example.com', '//example.com/a.jpg', 'assets/images/../../secret']) assert.equal(safeURL(input, { image: true }), '');
  assert.equal(safeURL('assets/images/example.webp', { image: true }), 'assets/images/example.webp');
  const data = fixture(); data.profile.instagram = 'javascript:alert(1)'; assert.ok(validateArchive(data).length);
  data.profile.instagram = 'https://www.instagram.com/ax_guy/'; data.entries[0].poster = 'javascript:alert(1)'; assert.ok(validateArchive(data).length);
  assert.equal(escapeHTML('<img src=x onerror="alert(1)">&'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;');
});

test('dates validate without silently rolling into the next month', () => {
  assert.equal(isDate('2024-02-29'), true); assert.equal(isDate('2025-02-29'), false); assert.equal(isDate('2026-13-01'), false); assert.equal(isDate(null), false);
});

test('title slugs stay unique and existing IDs stay stable', () => {
  assert.equal(makeSlug('Test film', [entry()]), 'test-film-2');
  assert.equal(makeSlug('Test film', [entry()], 'test-film'), 'test-film');
  assert.equal(makeSlug('Été — 2026!'), 'ete-2026');
  assert.equal(makeSlug('🎬', [{ id: 'entry' }]), 'entry-2');
});
