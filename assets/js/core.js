export const DRAFT_KEY = 'adeeb-vault-draft-v1';

export function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function safeURL(value, { image = false } = {}) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const text = value.trim();
  if (image && /^assets\/images\/[a-zA-Z0-9_./-]+$/.test(text) && !text.includes('..')) return text;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url.href;
  } catch { return ''; }
}

export function validateArchive(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ['Archive must be a JSON object.'];
  if (data.version !== 1) errors.push('Unsupported archive version.');
  if (!data.profile || typeof data.profile.name !== 'string' || !data.profile.name.trim()) errors.push('Profile name is required.');
  for (const key of ['shortName', 'bio', 'note']) if (typeof data.profile?.[key] !== 'string') errors.push(`Profile ${key} must be text.`);
  if (!Array.isArray(data.profile?.interests) || data.profile.interests.some(x => typeof x !== 'string')) errors.push('Profile interests must be a list of text values.');
  if (!Array.isArray(data.projects)) errors.push('Projects must be a list.');
  else {
    const projectIds = new Set();
    for (const project of data.projects) {
    if (!project || typeof project !== 'object' || typeof project.name !== 'string' || !project.name.trim()) { errors.push('Each project needs a name.'); continue; }
    if (typeof project.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(project.id) || projectIds.has(project.id)) errors.push(`Project ${project.name}: IDs must be unique lowercase slugs.`);
    projectIds.add(project.id);
    for (const key of ['category', 'status', 'description', 'note', 'url', 'linkLabel', 'visual']) if (typeof project[key] !== 'string') errors.push(`Project ${project.name}: ${key} must be text.`);
    if (!Array.isArray(project.tags) || project.tags.some(x => typeof x !== 'string')) errors.push(`Project ${project.name}: tags must be text values.`);
    if (project.url && !safeURL(project.url)) errors.push(`Project ${project.name}: use a valid HTTPS link.`);
    }
  }
  if (!Array.isArray(data.entries)) return [...errors, 'Entries must be a list.'];
  const ids = new Set();
  for (const entry of data.entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { errors.push('Every entry must be an object.'); continue; }
    const label = entry.title || entry.id || 'Untitled entry';
    if (typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(entry.id) || ids.has(entry.id)) errors.push(`${label}: entry IDs must be unique, lowercase slugs.`);
    ids.add(entry.id);
    if (typeof entry.title !== 'string' || !entry.title.trim()) errors.push(`${label}: a title is required.`);
    if (!Number.isInteger(entry.year) || entry.year < 1888 || entry.year > 2100) errors.push(`${label}: enter a year between 1888 and 2100.`);
    if (!['film', 'series'].includes(entry.type)) errors.push(`${label}: type must be film or series.`);
    if (!['watched', 'watching', 'watchlist'].includes(entry.status)) errors.push(`${label}: choose a valid watch status.`);
    if (entry.type === 'film' && entry.status === 'watching') errors.push(`${label}: films must be watched or on the watchlist.`);
    if (entry.rating !== null && (!Number.isFinite(entry.rating) || entry.rating < 0.5 || entry.rating > 5 || entry.rating * 2 % 1 !== 0)) errors.push(`${label}: ratings must be half-star steps between 0.5 and 5, or null.`);
    if (entry.status === 'watchlist' && entry.rating !== null) errors.push(`${label}: watchlist entries cannot have a rating.`);
    if (!Array.isArray(entry.genres) || entry.genres.some(x => typeof x !== 'string')) errors.push(`${label}: genres must be text values.`);
    for (const key of ['director', 'review', 'watchedOn', 'poster', 'image']) if (typeof entry[key] !== 'string') errors.push(`${label}: ${key} must be text.`);
    if (entry.watchedOn && !isDate(entry.watchedOn)) errors.push(`${label}: watched date must be a real date in YYYY-MM-DD format.`);
    if (!Number.isInteger(entry.runtime) || entry.runtime < 0 || entry.runtime > 10000) errors.push(`${label}: runtime must be a nonnegative number of minutes.`);
    if (typeof entry.favourite !== 'boolean' || typeof entry.isSample !== 'boolean') errors.push(`${label}: favourite and isSample must be true or false.`);
    for (const key of ['poster', 'image']) if (entry[key] && !safeURL(entry[key], { image: true })) errors.push(`${label}: ${key} must be an HTTPS URL or an assets/images/ path.`);
  }
  return errors;
}

export function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function selectEntries(entries, { collection = 'films', query = '', genre = 'all', sort = 'recent' } = {}) {
  const search = query.trim().toLocaleLowerCase();
  return entries.filter(entry => {
    const inCollection = collection === 'watchlist' ? entry.status === 'watchlist' : entry.type === (collection === 'series' ? 'series' : 'film') && entry.status !== 'watchlist';
    return inCollection && (genre === 'all' || entry.genres.includes(genre)) && (!search || [entry.title, entry.director, entry.review, ...entry.genres].join(' ').toLocaleLowerCase().includes(search));
  }).sort((a, b) => {
    if (sort === 'rating') return (b.rating ?? -1) - (a.rating ?? -1) || a.title.localeCompare(b.title);
    if (sort === 'year') return b.year - a.year || a.title.localeCompare(b.title);
    if (sort === 'title') return a.title.localeCompare(b.title);
    return (b.watchedOn || '').localeCompare(a.watchedOn || '');
  });
}

export function archiveStats(entries) {
  const watched = entries.filter(x => x.status === 'watched' && !x.isSample);
  const rated = watched.filter(x => Number.isFinite(x.rating));
  return { watched: watched.length, watchlist: entries.filter(x => x.status === 'watchlist' && !x.isSample).length, minutes: watched.reduce((sum, x) => sum + (x.type === 'film' ? x.runtime : 0), 0), average: rated.length ? rated.reduce((sum, x) => sum + x.rating, 0) / rated.length : null, samples: entries.filter(x => x.isSample).length };
}

export function ratingMarkup(rating, { sample = false, favourite = false } = {}) {
  if (!Number.isFinite(rating)) return '<span class="unrated">NOT RATED YET</span>';
  const stars = Array.from({ length: 5 }, (_, i) => `<span class="star${rating >= i + 1 ? ' full' : rating >= i + .5 ? ' half' : ''}"></span>`).join('');
  return `<span class="rating" aria-label="${rating} out of 5 stars${sample ? ', sample rating' : ''}${favourite ? ', favourite' : ''}"><span class="stars" aria-hidden="true">${stars}</span><span class="rating-number" aria-hidden="true">${rating.toFixed(1)}<small>/5</small></span>${favourite ? '<span class="favourite" aria-hidden="true">♥</span>' : ''}</span>`;
}

export function makeSlug(title, entries = [], existingId = '') {
  const root = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'entry';
  let slug = root, suffix = 2;
  while (entries.some(x => x.id === slug && x.id !== existingId)) slug = `${root}-${suffix++}`;
  return slug;
}

export async function loadArchive() {
  const response = await fetch(new URL('../../data/archive.json', import.meta.url), { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Archive request failed (${response.status}).`);
  const archive = await response.json();
  const errors = validateArchive(archive);
  if (errors.length) throw new Error(errors.join('\n'));
  return archive;
}
