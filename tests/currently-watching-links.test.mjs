/**
 * Currently Watching links into the film archive must point at records that
 * actually exist. The page lists six films and only two of them are in
 * data/archive.json, so the failure modes worth guarding are a guessed slug
 * that 404s in the dialog, a link that points at the wrong record, and a
 * book or series being wired to a film.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const page = await readFile(path.join(root, 'currently-watching.html'), 'utf8');
const readingLog = await readFile(path.join(root, 'reading-log.html'), 'utf8');
const archive = JSON.parse(await readFile(path.join(root, 'data/archive.json'), 'utf8'));
const byId = new Map(archive.entries.map(entry => [entry.id, entry]));

const anchors = [...page.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attributes, inner]) => ({
  attributes,
  href: attributes.match(/href="([^"]*)"/)?.[1] ?? '',
  text: inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}));

const noteLinks = anchors.filter(anchor => /class="[^"]*note-card-link/.test(anchor.attributes));
const filmLinks = noteLinks.filter(anchor => anchor.href.includes('#film/'));

// Titles shown on the page that have no archive record and must stay plain text.
const unlinkedTitles = ['Blade Runner 2049', 'City of God', 'A Quiet Place', 'The Batman'];

const normalise = value => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

test('the two archive-backed films are linked and nothing else is', () => {
  assert.equal(filmLinks.length, 2, `expected 2 archive links, found ${filmLinks.length}: ${filmLinks.map(link => link.href).join(', ')}`);
  assert.deepEqual(filmLinks.map(link => link.text).sort(), ['Interstellar', 'Perfect Days']);
});

test('every film link uses a route and slug that exist in the archive', () => {
  for (const link of filmLinks) {
    const match = link.href.match(/^index\.html#film\/([a-z0-9-]+)$/);
    assert.ok(match, `${link.text} links to "${link.href}", which is not an index.html#film/<id> route`);
    assert.ok(byId.has(match[1]), `${link.text} links to "${match[1]}", which is not in data/archive.json`);
  }
});

test('film links only ever target film records, never a book or series', () => {
  for (const link of filmLinks) {
    const id = link.href.split('#film/')[1];
    assert.equal(byId.get(id).type, 'film', `${link.text} points at a ${byId.get(id).type}, not a film`);
  }
});

test('each linked title is the record it points at', () => {
  for (const link of filmLinks) {
    const id = link.href.split('#film/')[1];
    assert.equal(normalise(link.text), normalise(byId.get(id).title), `${link.text} points at "${byId.get(id).title}"`);
  }
});

test('films without an archive record stay unlinked instead of guessing a route', () => {
  for (const title of unlinkedTitles) {
    const wrapped = anchors.some(anchor => normalise(anchor.text) === normalise(title));
    assert.equal(wrapped, false, `${title} has no archive record but is wrapped in a link`);
  }
});

test('the reading log never links a book into the film archive', () => {
  assert.equal(readingLog.includes('#film/'), false, 'reading-log.html contains a film route');
});
