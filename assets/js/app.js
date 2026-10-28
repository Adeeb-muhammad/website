import { DRAFT_KEY, archiveStats, escapeHTML as e, loadArchive, ratingMarkup, safeURL, selectEntries, validateArchive } from './core.js?v=6';

const $ = selector => document.querySelector(selector);
let archive;
let collection = 'films';
let renderedCollection = null;
let lastRoute = 'films';
let layout = 'grid';
let toastTimer;
let entryFocus;
let entryScrollY = 0;
const collectionInfo = {
  films: ['THE WATCHED FILES / A PERSONAL COLLECTION', 'FILM_', 'ARCHIVE', 'Films, ratings, and the thoughts that stay after the credits.'],
  series: ['THE LONGER STORIES / EPISODE BY EPISODE', 'SERIES_', 'ARCHIVE', 'Longer stories, across languages. Some finished, some still unfolding.'],
  anime: ['ANOTHER WAY TO TELL A STORY', 'ANIME_', 'ARCHIVE', 'Science, curiosity, and stories that stay with me. A small collection of anime I enjoy.'],
  watchlist: ['THE UNWATCHED FILES / UP NEXT', 'THE_', 'WATCHLIST', 'Not watched. Not forgotten. Just waiting for the right evening.']
};

function toast(message) {
  clearTimeout(toastTimer);
  const feedback = $('#entry-feedback');
  if ($('#entry-dialog').open && feedback) feedback.textContent = message;
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => { $('#toast').classList.remove('visible'); if (feedback) feedback.textContent = ''; }, 3200);
}

async function copy(text) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const field = document.createElement('textarea');
      field.value = text; field.style.cssText = 'position:fixed;opacity:0';
      document.body.append(field); field.select();
      const copied = document.execCommand('copy'); field.remove();
      if (!copied) throw new Error('Copy unavailable');
    }
    toast('LINK COPIED. SEND IT SOMEWHERE GOOD.');
  } catch { toast('Could not copy automatically. Copy the link from your address bar.'); }
}

function poster(entry, { featured = false, index = 0 } = {}) {
  const image = safeURL(featured ? entry.image || entry.poster : entry.poster, { image: true });
  return `<div class="${featured ? 'feature-media' : 'poster-frame'} poster-tone-${index % 5}${image ? ' has-image' : ''}"><div class="poster-fallback" aria-hidden="true"><span class="micro">Adeeb’s Vault / ${e(entry.year)}</span><span class="poster-type">${e(entry.title)}</span><span class="micro">${e(entry.director || entry.type.toUpperCase())}</span></div>${image ? `<img src="${e(image)}" alt="${e(entry.title)}${featured ? ' — film artwork' : entry.category === 'anime' ? ' cover art' : ' poster'}" loading="lazy" decoding="async" ${featured ? 'width="512" height="512"' : 'width="500" height="750"'}>` : ''}<span class="poster-arrow" aria-hidden="true">↗</span></div>`;
}

function filmCard(entry, index, featured = false) {
  return `<article class="${featured ? 'featured-card' : 'film-card'}"><a class="film-card-link" href="#film/${e(entry.id)}" aria-label="Open ${e(entry.title)}"><div class="card-record"><span>REC_${String(index + 1).padStart(3, '0')}</span><span>${entry.status === 'watchlist' ? 'ON THE RADAR' : entry.isSample ? 'STARTER ENTRY' : entry.status === 'watching' ? 'IN PROGRESS' : 'ON RECORD'}</span></div>${poster(entry, { featured, index })}<div class="film-card-content"><div class="film-meta"><span>${e(entry.year)}</span><span>${e((entry.languages || []).join(' / ') || entry.genres.slice(0, 2).join(' / '))}</span>${featured && entry.runtime ? `<span>${entry.runtime} MIN</span>` : ''}</div><h3>${e(entry.title)}</h3><div class="card-rating">${entry.status === 'watchlist' ? '<span class="unrated">WAITING FOR THE RIGHT EVENING</span>' : ratingMarkup(entry.rating, { sample: entry.isSample, favourite: entry.favourite })}</div>${featured ? `<p>${e(entry.review || 'Sometimes a rating says enough.')}</p><span class="text-link card-inspect">INSPECT ENTRY <span>↗</span></span>` : `<p class="card-director">${e(entry.director || (entry.type === 'series' ? 'Series' : 'Film'))}</p>`}</div></a></article>`;
}

function projectVisual(project, scope = 'home') {
  const patternId = `mech-grid-${project.id}-${scope}`;
  if (project.visual === 'mech') return `<svg viewBox="0 0 420 280" class="project-diagram" aria-label="Mech assembly illustration" role="img"><defs><pattern id="${patternId}" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0v28" fill="none" stroke="currentColor" stroke-width=".4" opacity=".2"/></pattern></defs><path fill="url(#${patternId})" d="M0 0h420v280H0z"/><g fill="none" stroke="currentColor" stroke-width="1.5"><path d="M177 70h66l15 20v63l-18 17h-60l-18-17V90zM181 78h58v38h-58zM188 132h44v22h-44zM180 170v43h-25v13h48v-56M240 170v43h25v13h-48v-56M162 98h-34v50h34M258 98h34v50h-34M117 90h-36v24h47M292 90h47v24h-47M180 56V42h-48v23h30M240 56V42h48v23h-30M197 125h26"/><circle cx="210" cy="98" r="10"/><path d="M44 65v-20h20M376 65v-20h-20M44 215v20h20M376 215v20h-20" opacity=".5"/></g><g fill="currentColor" font-family="monospace" font-size="8" opacity=".6"><text x="52" y="258">MODULAR ASSEMBLY / MK.01</text><text x="305" y="258">PROTOTYPE</text></g></svg>`;
  if (project.visual === 'phantom' || project.visual === 'aura') return `<svg viewBox="0 0 420 280" class="project-diagram" aria-label="Modular fixed-wing VTOL aircraft illustration" role="img"><g fill="none" stroke="currentColor"><circle cx="210" cy="137" r="103" opacity=".12"/><circle cx="210" cy="137" r="79" stroke-dasharray="3 7" opacity=".3"/><path d="M210 20v235M70 137h280" opacity=".15"/><g stroke-width="1.5"><path d="M205 60q5-17 10 0l7 65 136 37v17l-139-19-2 43 36 18v10l-43-9-43 9v-10l36-18-2-43-139 19v-17l136-37z"/><path d="M201 84h18M199 115h22M135 146l-4 19M158 139l-4 22M180 133l-4 25M285 146l4 19M262 139l4 22M240 133l4 25" opacity=".6"/><circle cx="210" cy="109" r="6"/><path d="M169 109h82M210 70v78" opacity=".75"/></g><path d="M43 64V43h21M377 64V43h-21M43 214v21h21M377 214v21h-21" opacity=".35"/></g><text x="36" y="263" fill="currentColor" opacity=".6" font-family="monospace" font-size="8">PROJECT PHANTOM / MODULAR VTOL PLATFORM</text></svg>`;
  return '<div class="vault-project-mark" aria-hidden="true">V<span>_</span></div>';
}

function projectCard(project, index, full = false) {
  const url = safeURL(project.url);
  return `<article class="${full ? 'project-full' : 'project-card'}"><div class="project-visual project-visual-${['mech', 'phantom', 'aura', 'vault'].includes(project.visual) ? project.visual : 'vault'}"><div class="project-visual-meta"><span>EXP_${String(index + 1).padStart(2, '0')}</span><span>${e(project.status)}</span></div>${projectVisual(project, full ? 'project' : 'home')}</div><div class="project-content"><p class="eyebrow">${e(project.category)}</p><h${full ? '2' : '3'}>${e(project.name)}</h${full ? '2' : '3'}><p>${e(project.description)}</p>${full ? `<p class="project-note">${e(project.note || '')}</p>` : ''}<div class="tag-list">${project.tags.map(tag => `<span>${e(tag)}</span>`).join('')}</div>${url ? `<a href="${e(url)}" class="text-link" target="_blank" rel="noopener noreferrer">${e(project.linkLabel || 'VIEW PROJECT')} <span>↗</span></a>` : `<span class="micro project-coming">${e(project.linkLabel || 'IN DEVELOPMENT')}</span>`}</div></article>`;
}

function renderHome() {
  const films = selectEntries(archive.entries).slice(0, 5);
  $('#featured-grid').innerHTML = films.length ? films.map((entry, index) => filmCard(entry, index, true)).join('') : '<div class="empty-state"><h3>THE FIRST RECORD IS STILL TO COME.</h3><p>For now, have a look at what I’m building.</p><a class="text-link" href="#projects">EXPLORE MY PROJECTS ↗</a></div>';
  $('#home-sample-note').hidden = !films.some(x => x.isSample);
  const stats = archiveStats(archive.entries);
  const starter = stats.watched === 0 && stats.samples > 0;
  const facts = starter ? [[films.length, 'FILM STARTERS'], [archive.entries.filter(x => x.status === 'watchlist').length, 'WATCHLIST STARTERS'], [archive.projects.length, 'ONGOING PROJECTS'], ['∞', 'REASONS TO BE CURIOUS']] : [[stats.watched, 'WATCHED & LOGGED'], [stats.average === null ? '—' : stats.average.toFixed(1), 'AVERAGE RATING / 5'], [stats.watchlist, 'ON THE WATCHLIST'], [archive.projects.length, 'ONGOING PROJECTS']];
  $('#archive-summary').innerHTML = facts.map(([value, label]) => `<div><strong>${typeof value === 'number' && Number.isInteger(value) ? String(value).padStart(2, '0') : value}</strong><span>${label}</span></div>`).join('');
  $('#home-projects').innerHTML = archive.projects.slice(0, 2).map((project, index) => projectCard(project, index)).join('');
  $('#project-list').innerHTML = archive.projects.map((project, index) => projectCard(project, index, true)).join('');
  $('#profile-name').textContent = `${archive.profile.shortName.toUpperCase()}.`;
  $('#profile-full-name').textContent = archive.profile.name;
  $('#profile-bio').textContent = archive.profile.bio;
  $('#profile-note').textContent = archive.profile.note;
  document.querySelectorAll('[data-instagram]').forEach(link => { const url = safeURL(archive.profile.instagram); link.hidden = !url; if (url) link.href = url; });
  $('#interest-tags').innerHTML = archive.profile.interests.map(interest => `<span>${e(interest)}</span>`).join('');
  $('#copyright-year').textContent = new Date().getFullYear();
  for (const name of ['films', 'series', 'anime', 'watchlist']) $(`#${name}-tab-count`).textContent = selectEntries(archive.entries, { collection: name }).length;
}

function renderCollection(reset = false) {
  reset ||= renderedCollection !== collection;
  renderedCollection = collection;
  const [eyebrow, title, outline, description] = collectionInfo[collection];
  $('#collection-eyebrow').textContent = eyebrow;
  $('#collection-title').innerHTML = `${title}<span class="outline-text">${outline}</span>`;
  $('#collection-description').textContent = description;
  const base = selectEntries(archive.entries, { collection });
  if (reset) {
    $('#archive-search').value = '';
    $('#genre-filter').innerHTML = '<option value="all">ALL GENRES</option>' + [...new Set(base.flatMap(x => x.genres))].sort().map(genre => `<option value="${e(genre)}">${e(genre.toUpperCase())}</option>`).join('');
    $('#language-filter').innerHTML = '<option value="all">ALL LANGUAGES</option>' + [...new Set(base.flatMap(x => x.languages || []))].sort().map(language => `<option value="${e(language)}">${e(language.toUpperCase())}</option>`).join('');
    $('#archive-sort').value = 'recent';
  }
  const query = $('#archive-search').value, genre = $('#genre-filter').value, language = $('#language-filter').value, sort = $('#archive-sort').value;
  const entries = selectEntries(archive.entries, { collection, query, genre, language, sort });
  document.querySelectorAll('[data-collection]').forEach(link => { link.classList.toggle('active', link.dataset.collection === collection); if (link.dataset.collection === collection) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  $('#collection-grid').innerHTML = entries.map((entry, index) => filmCard(entry, index)).join('');
  $('#collection-grid').classList.toggle('list-layout', layout === 'list');
  $('#results-count').textContent = `${String(entries.length).padStart(2, '0')} ${entries.length === 1 ? 'RECORD' : 'RECORDS'}${query.trim() || genre !== 'all' || language !== 'all' ? ` / ${base.length} TOTAL` : ' ON FILE'}`;
  $('#clear-filters').hidden = !query.trim() && genre === 'all' && language === 'all' && sort === 'recent';
  $('#collection-sample-note').hidden = !entries.some(x => x.isSample);
  $('#collection-empty').hidden = entries.length > 0;
  $('#empty-title').textContent = base.length ? 'NO MATCHING RECORDS.' : collection === 'anime' ? 'NO ANIME ON RECORD. YET.' : collection === 'series' ? 'NO SERIES ON RECORD. YET.' : collection === 'watchlist' ? 'AN OPEN EVENING.' : 'THE FIRST RECORD IS STILL TO COME.';
  $('#empty-copy').textContent = base.length ? 'Try another search, language, or genre.' : collection === 'series' || collection === 'anime' ? 'This part of the archive is still unwritten. Explore the films in the meantime.' : collection === 'watchlist' ? 'There’s nothing waiting on this list right now.' : 'A personal archive starts with a single film.';
  $('#empty-link').hidden = collection === 'films';
}

function showView(view) {
  document.querySelectorAll('.view').forEach(section => { section.hidden = section.dataset.view !== view; section.classList.toggle('active', !section.hidden); });
  const key = view === 'collection' ? collection : view;
  document.querySelectorAll('[data-nav]').forEach(link => { const active = link.dataset.nav === key; link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  document.querySelectorAll('#mobile-nav a, .rail-links a').forEach(link => { if (link.getAttribute('href') === `#${view === 'collection' ? collection : view}`) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  closeNavigation();
}

function closeNavigation({ restoreFocus = false } = {}) {
  const wasOpen = !$('#mobile-nav').hidden;
  $('#mobile-nav').hidden = true;
  $('#main').inert = false;
  document.body.classList.remove('nav-open');
  $('.menu-toggle').setAttribute('aria-expanded', 'false');
  $('.menu-toggle').setAttribute('aria-label', 'Open navigation');
  if (wasOpen && restoreFocus) $('.menu-toggle').focus();
}

function openEntry(id) {
  const entry = archive.entries.find(x => x.id === id);
  if (!entry) { location.hash = '#films'; toast('That record is not in the archive.'); return; }
  const art = safeURL(entry.image || entry.poster, { image: true });
  const watchedDate = entry.watchedOn ? new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${entry.watchedOn}T12:00:00Z`)) : '';
  $('#entry-details').innerHTML = `<div class="dialog-art poster-tone-2${art ? ' has-image' : ''}"><span class="poster-type poster-fallback" aria-hidden="true">${e(entry.title)}</span>${art ? `<img src="${e(art)}" alt="${e(entry.title)} artwork" width="512" height="512">` : ''}<span class="micro">REC / ${e(entry.id.toUpperCase())}</span></div><div class="dialog-copy"><p class="eyebrow">${entry.isSample ? 'STARTER ENTRY / SAMPLE RATING' : entry.status === 'watchlist' ? 'ON THE WATCHLIST' : entry.status === 'watching' ? 'CURRENTLY WATCHING' : 'FROM MY ARCHIVE'}</p><h2 id="entry-title">${e(entry.title)}</h2><p class="dialog-subtitle">${entry.year}${entry.runtime ? ` · ${entry.runtime} MIN` : ''}${entry.director ? ` · ${e(entry.director)}` : ''}</p><div class="tag-list">${[...(entry.languages || []), ...entry.genres].map(genre => `<span>${e(genre)}</span>`).join('')}</div><div class="dialog-rating">${entry.status === 'watchlist' ? '<span class="unrated">YET TO BE WATCHED</span>' : ratingMarkup(entry.rating, { sample: entry.isSample, favourite: entry.favourite })}</div><p class="eyebrow">${entry.isSample ? 'A NOTE FROM THE ORIGINAL DESIGN' : 'MY AFTERTHOUGHTS'}</p><p class="review-text">${e(entry.review || (entry.status === 'watchlist' ? 'Waiting for the right evening.' : 'No notes yet. Sometimes a rating is enough.')).replace(/\n/g, '<br>')}</p>${watchedDate ? `<p class="micro watched-date">WATCHED / ${e(watchedDate)}</p>` : ''}${entry.isSample ? '<p class="sample-disclaimer">This entry is sample content from the original design, not a confirmed personal rating.</p>' : ''}<div class="dialog-actions"><button class="button button-outline" data-copy-entry="${e(entry.id)}">COPY ENTRY LINK ↗</button><a class="text-link" href="https://www.themoviedb.org/search?query=${encodeURIComponent(entry.title)}" target="_blank" rel="noopener noreferrer">TITLE DETAILS ↗</a></div><p id="entry-feedback" class="entry-feedback" role="status" aria-live="polite"></p></div>`;
  entryFocus = entry.id;
  if (!$('#entry-dialog').open) $('#entry-dialog').showModal();
  document.body.classList.add('dialog-open');
  document.title = `${entry.title} // Adeeb’s archive`;
}

function route() {
  if (!archive) return;
  let hash;
  try { hash = decodeURIComponent(location.hash.slice(1) || 'home'); } catch { hash = 'home'; }
  if (hash.startsWith('film/')) {
    if (!$('#entry-dialog').open) entryScrollY = $('#view-archive').hidden ? 0 : window.scrollY;
    const entry = archive.entries.find(x => x.id === hash.slice(5));
    const target = entry?.status === 'watchlist' ? 'watchlist' : entry?.category === 'anime' ? 'anime' : entry?.type === 'series' ? 'series' : 'films';
    const reset = collection !== target;
    collection = target; showView('collection'); renderCollection(reset);
    openEntry(hash.slice(5)); return;
  }
  const closingEntry = $('#entry-dialog').open ? entryFocus : null;
  if ($('#entry-dialog').open) $('#entry-dialog').close();
  document.body.classList.remove('dialog-open');
  if (['films', 'series', 'anime', 'watchlist'].includes(hash)) {
    const reset = lastRoute !== hash;
    collection = hash; showView('collection'); renderCollection(reset);
    document.title = `${hash === 'films' ? 'Film archive' : hash === 'series' ? 'Series archive' : hash === 'anime' ? 'Anime archive' : 'Watchlist'} // Adeeb’s Vault`;
  } else {
    const view = ['projects', 'about', 'misc'].includes(hash) ? hash : 'home';
    showView(view);
    document.title = view === 'home' ? 'Adeeb’s Vault' : `${view === 'about' ? 'The operator' : view === 'misc' ? 'Miscellaneous' : 'Projects'} // Adeeb’s Vault`;
  }
  lastRoute = ['films', 'series', 'anime', 'watchlist'].includes(hash) ? hash : 'films';
  if (hash === 'home-latest') requestAnimationFrame(() => $('#home-latest').scrollIntoView({ behavior: 'smooth' }));
  else if (hash === 'contact') requestAnimationFrame(() => $('#contact').scrollIntoView({ behavior: 'smooth' }));
  else window.scrollTo({ top: closingEntry && hash === collection ? entryScrollY : 0, behavior: 'instant' });
  if (closingEntry && ['films', 'series', 'anime', 'watchlist'].includes(hash)) {
    $(`#collection-grid a[href="#film/${closingEntry}"]`)?.focus({ preventScroll: true });
  }
}

function closeEntry() {
  if (location.hash.startsWith('#film/')) { location.hash = `#${collection}`; return; }
  $('#entry-dialog').close(); document.body.classList.remove('dialog-open');
}

document.addEventListener('error', event => {
  if (event.target instanceof HTMLImageElement) { event.target.hidden = true; event.target.parentElement.classList.add('image-unavailable'); }
}, true);
$('#retry-load').addEventListener('click', init);
$('.menu-toggle').addEventListener('click', () => {
  if (!$('#mobile-nav').hidden) { closeNavigation(); return; }
  $('#mobile-nav').hidden = false;
  $('#main').inert = true;
  document.body.classList.add('nav-open');
  $('.menu-toggle').setAttribute('aria-expanded', 'true');
  $('.menu-toggle').setAttribute('aria-label', 'Close navigation');
  $('#mobile-nav a').focus();
});
$('#mobile-nav').addEventListener('click', event => { if (event.target.closest('a')) closeNavigation(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#mobile-nav').hidden) { event.preventDefault(); closeNavigation({ restoreFocus: true }); } });
document.addEventListener('click', event => { if (!$('#mobile-nav').hidden && !event.target.closest('#mobile-nav, .menu-toggle')) closeNavigation(); });
window.matchMedia('(max-width: 1100px)').addEventListener('change', event => { if (!event.matches) closeNavigation(); });
$('#archive-search').addEventListener('input', () => renderCollection());
$('#genre-filter').addEventListener('change', () => renderCollection());
$('#language-filter').addEventListener('change', () => renderCollection());
$('#archive-sort').addEventListener('change', () => renderCollection());
$('#clear-filters').addEventListener('click', () => { renderCollection(true); $('#archive-search').focus(); });
document.querySelectorAll('[data-layout]').forEach(button => button.addEventListener('click', () => { layout = button.dataset.layout; document.querySelectorAll('[data-layout]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); }); renderCollection(); }));
$('.dialog-close').addEventListener('click', closeEntry);
$('#entry-dialog').addEventListener('cancel', event => { event.preventDefault(); closeEntry(); });
$('#entry-dialog').addEventListener('click', event => { if (event.target === $('#entry-dialog')) { const rect = $('#entry-dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeEntry(); } const copyButton = event.target.closest('[data-copy-entry]'); if (copyButton) { const url = new URL(safeURL(archive.profile.website) || location.href); url.hash = `film/${copyButton.dataset.copyEntry}`; copy(url.href); } });
$('#share-site').addEventListener('click', () => copy(safeURL(archive.profile.website) || `${location.origin}${location.pathname}`));
window.addEventListener('hashchange', route);

async function init() {
  $('#loading').hidden = false; $('#error-state').hidden = true;
  try {
    archive = await loadArchive();
    if (new URLSearchParams(location.search).get('preview') === '1') {
      try { const draft = JSON.parse(localStorage.getItem(DRAFT_KEY)); if (draft && !validateArchive(draft).length) archive = draft; } catch { /* A broken local draft never prevents the public archive from opening. */ }
      $('#preview-banner').hidden = false; document.body.classList.add('preview-mode');
    }
    renderHome(); $('#loading').hidden = true; $('#site-content').hidden = false; route();
  } catch (error) {
    console.error('Archive could not be loaded:', error);
    $('#loading').hidden = true; $('#site-content').hidden = true; $('#error-state').hidden = false;
  }
}
init();
