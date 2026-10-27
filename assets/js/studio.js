import { DRAFT_KEY, escapeHTML as e, loadArchive, makeSlug, ratingMarkup, safeURL, validateArchive } from './core.js?v=2';

const $ = selector => document.querySelector(selector);
const BASE_KEY = 'adeeb-vault-base-v1';
let archive, published;
let selectedEntry = null, selectedProject = null;
let formDirty = false, storageAvailable = true;
const entryForm = $('#entry-form'), projectForm = $('#project-form'), profileForm = $('#profile-form');
const value = (form, name) => form.elements.namedItem(name).value.trim();
const split = text => [...new Set(text.split(',').map(x => x.trim()).filter(Boolean))];

function notice(text, error = false) {
  $('#studio-notice').textContent = error ? '' : text;
  $('#studio-error').textContent = error ? text : '';
  $('#studio-error').hidden = !error;
  if (error) $('#studio-error').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function check(data) {
  const errors = validateArchive(data);
  if (errors.length) { notice(errors.join('\n'), true); return false; }
  return true;
}

function saveDraft(message = 'Draft saved in this browser. Publish when you’re ready.') {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(archive)); storageAvailable = true; }
  catch { storageAvailable = false; }
  $('#storage-warning').hidden = storageAvailable;
  formDirty = false;
  $('#studio-status').textContent = storageAvailable ? JSON.stringify(archive) === JSON.stringify(published) ? 'UP TO DATE' : 'DRAFT SAVED LOCALLY' : 'DRAFT IN THIS TAB ONLY';
  notice(storageAvailable ? message : 'Draft updated in this tab. Download a backup before closing it.');
}

function allowDiscard() {
  return !formDirty || window.confirm('Discard the changes in the current form? Your previously saved draft will stay.');
}

function renderEntries() {
  const query = $('#editor-search').value.trim().toLowerCase();
  const entries = archive.entries.filter(x => [x.title, x.director].join(' ').toLowerCase().includes(query));
  $('#entry-list').innerHTML = entries.length ? entries.map(entry => {
    const poster = safeURL(entry.poster, { image: true });
    return `<button type="button" data-edit-entry="${e(entry.id)}" class="${selectedEntry === entry.id ? 'active' : ''}">${poster ? `<img class="editor-mini-poster" src="${e(poster)}" alt="" width="31" height="43" loading="lazy">` : '<span class="editor-mini-poster" aria-hidden="true">V</span>'}<span class="editor-entry-copy"><strong>${e(entry.title)}</strong><span>${entry.year} · ${entry.status === 'watchlist' ? 'WATCHLIST' : entry.rating === null ? 'UNRATED' : `${entry.rating.toFixed(1)} / 5`}${entry.isSample ? ' <span class="sample-flag">/ SAMPLE</span>' : ''}</span></span></button>`;
  }).join('') : '<p class="micro">No matching records. Add your first one above.</p>';
  $('#remove-samples').hidden = !archive.entries.some(x => x.isSample);
}

function updateEntryOptions() {
  const film = entryForm.elements.type.value === 'film';
  const watching = [...entryForm.elements.status.options].find(x => x.value === 'watching');
  watching.disabled = film;
  if (film && entryForm.elements.status.value === 'watching') entryForm.elements.status.value = 'watched';
  const watchlist = entryForm.elements.status.value === 'watchlist';
  entryForm.elements.rating.disabled = watchlist;
  entryForm.elements.watchedOn.disabled = watchlist;
  entryForm.elements.favourite.disabled = watchlist;
  if (watchlist) { entryForm.elements.rating.value = ''; entryForm.elements.watchedOn.value = ''; entryForm.elements.favourite.checked = false; }
  $('#rating-preview').innerHTML = watchlist ? '<span class="unrated">WATCHLIST ENTRY / NO RATING YET</span>' : ratingMarkup(value(entryForm, 'rating') ? Number(value(entryForm, 'rating')) : null, { sample: entryForm.elements.isSample.checked, favourite: entryForm.elements.favourite.checked });
}

function editEntry(id = null) {
  if (!allowDiscard()) return;
  const entry = archive.entries.find(x => x.id === id);
  selectedEntry = entry?.id || null;
  entryForm.reset();
  for (const name of ['id', 'title', 'year', 'type', 'category', 'status', 'rating', 'director', 'runtime', 'watchedOn', 'review', 'poster', 'image']) entryForm.elements.namedItem(name).value = entry ? entry[name] ?? (name === 'category' ? 'general' : '') : ({ type: 'film', category: 'general', status: 'watched', runtime: 0 }[name] ?? '');
  entryForm.elements.genres.value = entry ? entry.genres.join(', ') : '';
  entryForm.elements.languages.value = entry ? (entry.languages || []).join(', ') : '';
  entryForm.elements.favourite.checked = entry?.favourite || false;
  entryForm.elements.isSample.checked = entry?.isSample || false;
  $('#entry-form-label').textContent = entry ? `EDITING / ${entry.title.toUpperCase()}` : 'NEW RECORD / MAKE IT YOURS';
  $('#delete-entry').hidden = !entry;
  $('#entry-start').hidden = true; entryForm.hidden = false; formDirty = false;
  updateEntryOptions(); renderEntries();
  if (window.innerWidth < 651) entryForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  entryForm.elements.title.focus({ preventScroll: true });
}

entryForm.addEventListener('submit', event => {
  event.preventDefault();
  if (!entryForm.reportValidity()) return;
  const existingId = value(entryForm, 'id');
  const title = value(entryForm, 'title');
  const watchlist = value(entryForm, 'status') === 'watchlist';
  const entry = { id: existingId || makeSlug(title, archive.entries), title, year: Number(value(entryForm, 'year')), type: value(entryForm, 'type'), category: value(entryForm, 'category'), languages: split(value(entryForm, 'languages')), status: value(entryForm, 'status'), director: value(entryForm, 'director'), genres: split(value(entryForm, 'genres')), runtime: Number(value(entryForm, 'runtime') || 0), rating: watchlist || !value(entryForm, 'rating') ? null : Number(value(entryForm, 'rating')), review: value(entryForm, 'review'), watchedOn: watchlist ? '' : value(entryForm, 'watchedOn'), favourite: !watchlist && entryForm.elements.favourite.checked, poster: value(entryForm, 'poster'), image: value(entryForm, 'image'), isSample: entryForm.elements.isSample.checked };
  const next = structuredClone(archive);
  const index = next.entries.findIndex(x => x.id === existingId);
  if (index >= 0) next.entries[index] = entry; else next.entries.unshift(entry);
  if (!check(next)) return;
  archive = next; selectedEntry = entry.id;
  entryForm.elements.id.value = entry.id; $('#delete-entry').hidden = false;
  $('#entry-form-label').textContent = `EDITING / ${entry.title.toUpperCase()}`;
  saveDraft(`${entry.title} saved to your draft. Use Publish to make it public.`); renderEntries();
});

$('#entry-list').addEventListener('click', event => { const button = event.target.closest('[data-edit-entry]'); if (button) editEntry(button.dataset.editEntry); });
$('#new-entry').addEventListener('click', () => editEntry());
$('#new-entry-empty').addEventListener('click', () => editEntry());
$('#editor-search').addEventListener('input', renderEntries);
entryForm.addEventListener('input', () => { formDirty = true; updateEntryOptions(); });
entryForm.addEventListener('change', () => { formDirty = true; updateEntryOptions(); });
$('#cancel-entry').addEventListener('click', () => { if (!allowDiscard()) return; formDirty = false; selectedEntry = null; entryForm.hidden = true; $('#entry-start').hidden = false; renderEntries(); });
$('#delete-entry').addEventListener('click', () => {
  const entry = archive.entries.find(x => x.id === selectedEntry);
  if (!entry || !window.confirm(`Delete “${entry.title}” from your draft? Your public site stays unchanged until you publish.`)) return;
  archive.entries = archive.entries.filter(x => x.id !== selectedEntry);
  selectedEntry = null; entryForm.hidden = true; $('#entry-start').hidden = false;
  saveDraft('Entry removed from the draft.'); renderEntries();
});
$('#remove-samples').addEventListener('click', () => {
  if (!allowDiscard()) return;
  const count = archive.entries.filter(x => x.isSample).length;
  if (!count || !window.confirm(`Remove all ${count} starter entries from your draft? Your own entries will stay.`)) return;
  archive.entries = archive.entries.filter(x => !x.isSample); selectedEntry = null;
  entryForm.hidden = true; $('#entry-start').hidden = false; saveDraft('Starter entries removed. Your archive is ready for your own films.'); renderEntries();
});

function fillProfile() {
  for (const name of ['name', 'shortName', 'bio', 'note', 'instagram']) profileForm.elements.namedItem(name).value = archive.profile[name] || '';
  profileForm.elements.interests.value = archive.profile.interests.join(', ');
}
profileForm.addEventListener('input', () => { formDirty = true; });
profileForm.addEventListener('submit', event => {
  event.preventDefault(); if (!profileForm.reportValidity()) return;
  const next = structuredClone(archive);
  for (const name of ['name', 'shortName', 'bio', 'note', 'instagram']) next.profile[name] = value(profileForm, name);
  next.profile.interests = split(value(profileForm, 'interests'));
  if (!check(next)) return;
  archive = next; saveDraft('Profile saved to your draft.');
});

function renderProjects() {
  $('#project-editor-list').innerHTML = archive.projects.length ? archive.projects.map((project, index) => `<button data-edit-project="${e(project.id)}" class="${selectedProject === project.id ? 'active' : ''}"><span class="editor-project-icon">${String(index + 1).padStart(2, '0')}</span><span class="editor-entry-copy"><strong>${e(project.name)}</strong><span>${e(project.status)}</span></span></button>`).join('') : '<p class="micro">No projects yet. Add your first experiment.</p>';
}

function editProject(id = null) {
  if (!allowDiscard()) return;
  const project = archive.projects.find(x => x.id === id);
  selectedProject = project?.id || null; projectForm.reset();
  for (const name of ['id', 'name', 'category', 'status', 'description', 'note', 'url', 'linkLabel', 'visual']) projectForm.elements.namedItem(name).value = project ? (name === 'visual' && project[name] === 'aura' ? 'phantom' : project[name]) || '' : name === 'visual' ? 'vault' : '';
  projectForm.elements.tags.value = project ? project.tags.join(', ') : '';
  $('#project-form-label').textContent = project ? `EDITING / ${project.name.toUpperCase()}` : 'NEW PROJECT / SHOW THE WORK';
  $('#delete-project').hidden = !project; $('#project-start').hidden = true; projectForm.hidden = false; formDirty = false; renderProjects();
  if (window.innerWidth < 651) projectForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  projectForm.elements.namedItem('name').focus({ preventScroll: true });
}

$('#project-editor-list').addEventListener('click', event => { const button = event.target.closest('[data-edit-project]'); if (button) editProject(button.dataset.editProject); });
$('#new-project').addEventListener('click', () => editProject());
projectForm.addEventListener('input', () => { formDirty = true; });
projectForm.addEventListener('submit', event => {
  event.preventDefault(); if (!projectForm.reportValidity()) return;
  const project = {}, existingId = value(projectForm, 'id');
  for (const name of ['name', 'category', 'status', 'description', 'note', 'url', 'linkLabel', 'visual']) project[name] = value(projectForm, name);
  project.id = existingId || makeSlug(project.name, archive.projects); project.tags = split(value(projectForm, 'tags'));
  const next = structuredClone(archive), index = next.projects.findIndex(x => x.id === existingId);
  if (index >= 0) next.projects[index] = project; else next.projects.push(project);
  if (!check(next)) return;
  archive = next; selectedProject = project.id; projectForm.elements.id.value = project.id;
  $('#delete-project').hidden = false; saveDraft(`${project.name} saved to your draft.`); renderProjects();
});
$('#cancel-project').addEventListener('click', () => { if (!allowDiscard()) return; formDirty = false; selectedProject = null; projectForm.hidden = true; $('#project-start').hidden = false; renderProjects(); });
$('#delete-project').addEventListener('click', () => {
  const project = archive.projects.find(x => x.id === selectedProject);
  if (!project || !window.confirm(`Remove “${project.name}” from the draft?`)) return;
  archive.projects = archive.projects.filter(x => x.id !== selectedProject); selectedProject = null;
  projectForm.hidden = true; $('#project-start').hidden = false; saveDraft('Project removed from the draft.'); renderProjects();
});

function switchTab(tab) {
  if (!allowDiscard()) return;
  if (formDirty) {
    entryForm.hidden = true; $('#entry-start').hidden = false; selectedEntry = null;
    projectForm.hidden = true; $('#project-start').hidden = false; selectedProject = null;
    formDirty = false; renderEntries(); renderProjects();
  }
  document.querySelectorAll('[data-tab]').forEach(button => { const active = button.dataset.tab === tab; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== tab; });
  if (tab === 'profile') fillProfile();
}
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => { if (archive) switchTab(button.dataset.tab); }));

function exportText() {
  if (!archive || !check(archive)) return null;
  if (formDirty) { notice('Save or cancel your current form before exporting the draft.', true); return null; }
  return `${JSON.stringify(archive, null, 2)}\n`;
}
function download() {
  const text = exportText(); if (!text) return;
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'archive.json'; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000); notice('Archive downloaded. Keep it as a backup or upload it to data/archive.json in your repository.');
}
$('#download-top').addEventListener('click', download); $('#download-json').addEventListener('click', download);
$('#copy-json').addEventListener('click', async () => {
  const text = exportText(); if (!text) return;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else { const field = document.createElement('textarea'); field.value = text; field.style.cssText = 'position:fixed;opacity:0'; document.body.append(field); field.select(); const result = document.execCommand('copy'); field.remove(); if (!result) throw new Error('Clipboard unavailable'); }
    notice('Archive JSON copied. Open your GitHub file, replace its contents, then commit your changes.');
  } catch { notice('Clipboard access is unavailable. Download the archive instead.', true); }
});

function importText(text) {
  if (text.length > 2 * 1024 * 1024) { notice('Please import an archive smaller than 2 MB.', true); return; }
  let data;
  try { data = JSON.parse(text); } catch { notice('This is not valid JSON. Your current draft is unchanged.', true); return; }
  if (!check(data) || !allowDiscard()) return;
  if (!window.confirm('Replace your local draft with this archive? Your published website will stay unchanged.')) return;
  archive = data; selectedEntry = null; selectedProject = null; entryForm.hidden = true; projectForm.hidden = true; $('#entry-start').hidden = false; $('#project-start').hidden = false;
  saveDraft('Backup imported and validated. Preview it before publishing.'); renderEntries(); renderProjects(); fillProfile();
}
$('#import-json').addEventListener('click', () => importText($('#import-text').value));
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  if (file.size > 2 * 1024 * 1024) { notice('Please choose an archive smaller than 2 MB.', true); event.target.value = ''; return; }
  try { importText(await file.text()); } catch { notice('Could not read that file. Try pasting its JSON instead.', true); }
  event.target.value = '';
});

async function loadLatest() {
  if (!window.confirm('Discard your local draft and load the published archive? Download your draft first if you want to keep it.')) return;
  try {
    const latest = await loadArchive(); archive = structuredClone(latest); published = latest;
    try { localStorage.setItem(BASE_KEY, JSON.stringify(latest)); localStorage.removeItem(DRAFT_KEY); } catch { storageAvailable = false; }
    formDirty = false; selectedEntry = null; selectedProject = null; entryForm.hidden = true; projectForm.hidden = true; $('#entry-start').hidden = false; $('#project-start').hidden = false;
    $('#stale-warning').hidden = true; saveDraft('Loaded the latest published archive.'); renderEntries(); renderProjects(); fillProfile();
  } catch { notice('Could not load the published archive. Your local draft is unchanged.', true); }
}
$('#load-latest').addEventListener('click', loadLatest); $('#load-latest-stale').addEventListener('click', loadLatest);
document.querySelectorAll('a[href="./?preview=1"]').forEach(link => link.addEventListener('click', event => { if (formDirty) { event.preventDefault(); notice('Save the current form before opening your draft preview.', true); } else if (!storageAvailable) { event.preventDefault(); notice('Draft preview needs browser storage. Download your archive to keep it safe.', true); } }));
document.addEventListener('error', event => { if (event.target instanceof HTMLImageElement) event.target.hidden = true; }, true);
window.addEventListener('beforeunload', event => { if (formDirty || (!storageAvailable && archive)) { event.preventDefault(); event.returnValue = ''; } });

async function init() {
  try {
    published = await loadArchive(); archive = structuredClone(published);
    let recovered = false;
    try {
      const stored = localStorage.getItem(DRAFT_KEY), base = localStorage.getItem(BASE_KEY);
      if (stored && stored !== base) {
        try { const draft = JSON.parse(stored); if (!validateArchive(draft).length) { archive = draft; recovered = true; $('#stale-warning').hidden = !base || base === JSON.stringify(published) || stored === JSON.stringify(published); } else notice('An invalid stored draft was ignored. The published archive is open; import a backup to recover it.', true); }
        catch { notice('A damaged stored draft was ignored. Your published archive is safe.', true); }
      }
      if (!recovered) localStorage.removeItem(DRAFT_KEY);
      if (!recovered || !base) localStorage.setItem(BASE_KEY, JSON.stringify(published));
    } catch { storageAvailable = false; $('#storage-warning').hidden = false; }
    $('#studio-status').textContent = recovered ? 'LOCAL DRAFT RESTORED' : 'UP TO DATE';
    $('#studio-content').hidden = false; $('#download-top').disabled = false;
    renderEntries(); renderProjects(); fillProfile();
  } catch (error) { $('#studio-status').textContent = 'ARCHIVE UNAVAILABLE'; notice(`Could not open the archive. Refresh to retry.\n${error.message}`, true); }
}
init();
