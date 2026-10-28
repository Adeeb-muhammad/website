import { createImagePDF, analyzeLinks, classifyHTTP, linksCSV, safeFilename, validateNotebook } from './tools-core.js?v=1';
import { escapeHTML as e } from './core.js?v=6';

const $ = selector => document.querySelector(selector);
const setStatus = (id, message, error = false) => { const node = $(id); node.textContent = message; node.dataset.error = String(error); };

function download(data, name, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.hidden = true;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function confirmChange(message) {
  const dialog = $('#tool-confirm');
  $('#confirm-copy').textContent = message;
  return new Promise(resolve => {
    const finish = accepted => {
      dialog.close();
      $('#confirm-cancel').removeEventListener('click', cancel);
      $('#confirm-accept').removeEventListener('click', accept);
      dialog.removeEventListener('cancel', cancel);
      resolve(accepted);
    };
    const cancel = event => { event?.preventDefault(); finish(false); };
    const accept = () => finish(true);
    $('#confirm-cancel').addEventListener('click', cancel);
    $('#confirm-accept').addEventListener('click', accept);
    dialog.addEventListener('cancel', cancel);
    dialog.showModal(); $('#confirm-cancel').focus();
  });
}

function routeTool(focus = false) {
  const key = ['images', 'markdown', 'notes', 'links'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'images';
  for (const panel of document.querySelectorAll('.tool-panel')) panel.hidden = panel.id !== `tool-${key}`;
  for (const link of document.querySelectorAll('.tool-switcher a')) {
    if (link.hash === `#${key}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const heading = $(`#${key}-heading`);
  document.title = `${heading.textContent} // Adeeb’s Vault`;
  if (focus) heading.focus({ preventScroll: true });
}
window.addEventListener('hashchange', () => routeTool(true));
routeTool();

// Images to PDF: decode locally, flatten transparency onto white, then embed
// the resized JPEGs into a standards-based PDF without an external service.
const images = [];
let imageBusy = false;
let originalBytes = 0;
function renderImages(focusIndex = -1) {
  $('#image-list').innerHTML = images.map((image, i) => `<li><img src="${image.preview}" alt="Page ${i + 1} preview"><div class="image-info"><strong>${e(image.name)}</strong><span>PAGE ${String(i + 1).padStart(2, '0')} · ${image.width} × ${image.height}</span></div><div class="image-actions"><button type="button" data-image="up" data-index="${i}" aria-label="Move page ${i + 1} up" ${i === 0 || imageBusy ? 'disabled' : ''}>↑</button><button type="button" data-image="down" data-index="${i}" aria-label="Move page ${i + 1} down" ${i === images.length - 1 || imageBusy ? 'disabled' : ''}>↓</button><button type="button" data-image="remove" data-index="${i}" aria-label="Remove page ${i + 1}" ${imageBusy ? 'disabled' : ''}>×</button></div></li>`).join('');
  $('#images-empty').hidden = images.length > 0;
  $('#image-export').disabled = imageBusy || !images.length;
  $('#image-clear').disabled = imageBusy || !images.length;
  $('#image-files').disabled = imageBusy;
  if (focusIndex >= 0) $(`[data-image="remove"][data-index="${focusIndex}"]`)?.focus();
}

async function convertImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error(`${file.name}: use a JPG, PNG, or WebP image.`);
  if (file.size > 15 * 1024 * 1024) throw new Error(`${file.name}: the limit is 15 MB per image.`);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error(`${file.name}: this image could not be read.`)); img.src = url; });
    if (!img.naturalWidth || img.naturalWidth * img.naturalHeight > 40000000) throw new Error(`${file.name}: please resize this very large image first (maximum 40 megapixels).`);
    const ratio = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image conversion is not available in this browser.');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .88));
    if (!blob) throw new Error(`${file.name}: could not convert this image.`);
    return { name: file.name, originalSize: file.size, width: canvas.width, height: canvas.height, bytes: new Uint8Array(await blob.arrayBuffer()), preview: URL.createObjectURL(blob) };
  } finally { URL.revokeObjectURL(url); }
}

async function addImages(files) {
  if (imageBusy || !files.length) return;
  imageBusy = true; renderImages();
  const errors = []; let added = 0;
  for (const file of files) {
    if (images.length >= 20) { errors.push('The limit is 20 images.'); break; }
    if (originalBytes + file.size > 60 * 1024 * 1024) { errors.push(`${file.name}: this batch would exceed 60 MB. Add fewer or smaller files.`); continue; }
    setStatus('#image-status', `Preparing image ${added + 1}…`);
    try { const image = await convertImage(file); images.push(image); originalBytes += file.size; added++; }
    catch (error) { errors.push(error.message); }
  }
  imageBusy = false; $('#image-files').value = ''; renderImages();
  setStatus('#image-status', `${added} image${added === 1 ? '' : 's'} added. ${images.length} page${images.length === 1 ? '' : 's'} ready.${errors.length ? ` ${errors.join(' ')}` : ' Adjust the order, then download your PDF.'}`, errors.length > 0);
}
$('#image-files').addEventListener('change', event => addImages([...event.target.files]));
const drop = $('#image-drop');
for (const type of ['dragover', 'dragenter']) drop.addEventListener(type, event => { event.preventDefault(); drop.classList.add('is-dragging'); });
for (const type of ['dragleave', 'drop']) drop.addEventListener(type, event => { event.preventDefault(); drop.classList.remove('is-dragging'); });
drop.addEventListener('drop', event => addImages([...event.dataTransfer.files]));
$('#image-list').addEventListener('click', event => {
  const button = event.target.closest('[data-image]');
  if (!button || imageBusy) return;
  const index = Number(button.dataset.index), action = button.dataset.image;
  if (action === 'remove') { const [image] = images.splice(index, 1); originalBytes -= image.originalSize; URL.revokeObjectURL(image.preview); }
  else { const target = action === 'up' ? index - 1 : index + 1; if (target < 0 || target >= images.length) return; [images[index], images[target]] = [images[target], images[index]]; }
  renderImages(Math.min(action === 'up' ? index - 1 : action === 'down' ? index + 1 : index, images.length - 1));
  if (!images.length) $('#image-files').focus();
});
$('#image-clear').addEventListener('click', () => {
  if (imageBusy) return;
  images.forEach(image => URL.revokeObjectURL(image.preview)); images.length = 0; originalBytes = 0;
  renderImages(); setStatus('#image-status', 'Images removed. Choose a new set whenever you’re ready.'); $('#image-files').focus();
});
$('#image-export').addEventListener('click', async () => {
  if (imageBusy || !images.length) return;
  imageBusy = true; renderImages(); setStatus('#image-status', 'Putting your PDF together…');
  await new Promise(resolve => requestAnimationFrame(resolve));
  try {
    const pdf = createImagePDF(images, { size: $('#image-paper').value, orientation: $('#image-orientation').value, margin: $('#image-margin').checked ? 28 : 0 });
    download(pdf, `${safeFilename($('#image-name').value, 'my-document')}.pdf`, 'application/pdf');
    setStatus('#image-status', `Your ${images.length}-page PDF is ready. Your images stayed on this device.`);
  } catch (error) { setStatus('#image-status', `Could not create the PDF: ${error.message}`, true); }
  finally { imageBusy = false; renderImages(); }
});

// Markdown uses a pinned, self-hosted parser with HTML and network images off.
const parser = window.markdownit?.({ html: false, linkify: false, typographer: false });
if (parser) {
  parser.renderer.rules.image = (tokens, i) => `<span class="markdown-image-note">[Image omitted: ${e(tokens[i].content || 'image')}]</span>`;
  const linkOpen = parser.renderer.rules.link_open || ((tokens, i, options, env, self) => self.renderToken(tokens, i, options));
  parser.renderer.rules.link_open = (tokens, i, options, env, self) => { tokens[i].attrSet('target', '_blank'); tokens[i].attrSet('rel', 'noopener noreferrer'); return linkOpen(tokens, i, options, env, self); };
}
const printDocument = document.createElement('article'); printDocument.id = 'print-document'; printDocument.className = 'document-preview'; document.body.append(printDocument);
function renderMarkdown() {
  const text = $('#markdown-input').value;
  $('#markdown-count').textContent = `${text.length.toLocaleString()} characters`;
  if (!parser) { setStatus('#markdown-status', 'The document renderer could not load. Reload this page to try again.', true); return; }
  const title = $('#markdown-title').value.trim();
  const html = `${title ? `<h1 class="document-title">${e(title)}</h1>` : ''}${parser.render(text)}`;
  $('#markdown-preview').innerHTML = text.trim() || title ? html : '<p class="preview-placeholder">Your document preview will appear here.</p>';
  printDocument.innerHTML = html;
  $('#markdown-print').disabled = !text.trim() && !title;
  $('#markdown-download').disabled = !text.trim();
}
let markdownTimer;
for (const id of ['#markdown-input', '#markdown-title']) $(id).addEventListener('input', () => { clearTimeout(markdownTimer); markdownTimer = setTimeout(renderMarkdown, 150); });
$('#markdown-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 500000) throw new Error('Choose a Markdown or text file smaller than 500 KB.');
    const text = await file.text(); if (text.length > 200000) throw new Error('The document limit is 200,000 characters.');
    if ($('#markdown-input').value.trim() && !await confirmChange('Opening this file replaces the current Markdown draft. Save it as .md first if you want to keep it.')) return;
    $('#markdown-input').value = text; $('#markdown-title').value = ''; renderMarkdown(); setStatus('#markdown-status', `Opened ${file.name}.`);
  } catch (error) { setStatus('#markdown-status', error.message, true); }
  finally { event.target.value = ''; }
});
$('#markdown-example').addEventListener('click', async () => {
  if ($('#markdown-input').value.trim() && !await confirmChange('Loading the example replaces the current Markdown draft. Save it as .md first if you want to keep it.')) return;
  $('#markdown-title').value = '';
  $('#markdown-input').value = '# A page worth keeping\n\nA little space for **an idea**, a plan, or a few notes.\n\n## The plan\n\n1. Make something small.\n2. Give it a little care.\n3. Share it.\n\n> A first draft is a place to begin.\n\n| Task | Status |\n| --- | --- |\n| Write | In progress |\n| Export | Up next |\n\n```js\nconst nextStep = "Keep going";\n```\n';
  renderMarkdown(); setStatus('#markdown-status', 'Example loaded. Edit anything, then print or save as PDF.');
});
$('#markdown-download').addEventListener('click', () => download($('#markdown-input').value, `${safeFilename($('#markdown-title').value, 'my-notes')}.md`, 'text/markdown;charset=utf-8'));
$('#markdown-print').addEventListener('click', () => {
  clearTimeout(markdownTimer); renderMarkdown();
  if ($('#markdown-print').disabled) return;
  document.title = safeFilename($('#markdown-title').value, 'my-document');
  setStatus('#markdown-status', 'Choose Save as PDF in the print dialog. On a phone, use the print preview’s PDF or sharing option.');
  window.print();
});
window.addEventListener('afterprint', () => routeTool());
renderMarkdown();

// A fixed-size drawing surface keeps sketches stable across screen sizes.
// The saved format contains plain text and validated vector strokes only.
const NOTE_KEY = 'adeeb-vault-notebook-v1';
const board = $('#notes-canvas'), context = board.getContext('2d');
const ink = document.createElement('canvas'); ink.width = board.width; ink.height = board.height;
const inkContext = ink.getContext('2d');
let strokes = [], redo = [], activeStroke = null, activePointer = null, erase = false, drawFrame = null, saveTimer;
function notebook() { return { kind: 'adeeb-vault-notebook', version: 1, title: $('#notes-title').value, text: $('#notes-text').value, strokes }; }
function saveNotes() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(NOTE_KEY, JSON.stringify(notebook()));
    setStatus('#notes-status', 'Notebook saved in this browser. Download a backup to keep a separate copy.');
  } catch { setStatus('#notes-status', 'This browser could not save the notebook. Download a .json backup before leaving.', true); }
}
function queueSave() {
  setStatus('#notes-status', 'Saving…'); clearTimeout(saveTimer); saveTimer = setTimeout(saveNotes, 400);
}
function renderBoard() {
  if (!context || !inkContext) return;
  inkContext.clearRect(0, 0, board.width, board.height);
  for (const stroke of strokes) {
    inkContext.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
    inkContext.strokeStyle = stroke.color; inkContext.fillStyle = stroke.color;
    inkContext.lineWidth = stroke.width; inkContext.lineCap = 'round'; inkContext.lineJoin = 'round';
    const points = stroke.points;
    if (points.length === 1) { inkContext.beginPath(); inkContext.arc(points[0][0], points[0][1], stroke.width / 2, 0, Math.PI * 2); inkContext.fill(); }
    else { inkContext.beginPath(); inkContext.moveTo(...points[0]); for (const point of points.slice(1)) inkContext.lineTo(...point); inkContext.stroke(); }
  }
  context.fillStyle = '#fbfaf7'; context.fillRect(0, 0, board.width, board.height);
  context.fillStyle = '#d8d2c7';
  for (let x = 24; x < board.width; x += 28) for (let y = 24; y < board.height; y += 28) { context.beginPath(); context.arc(x, y, 1, 0, Math.PI * 2); context.fill(); }
  context.drawImage(ink, 0, 0);
  $('#notes-undo').disabled = strokes.length === 0 || !!activeStroke;
  $('#notes-redo').disabled = redo.length === 0 || !!activeStroke;
}
function queueDraw() { if (drawFrame !== null) return; drawFrame = requestAnimationFrame(() => { drawFrame = null; renderBoard(); }); }
function pointAt(event) {
  const bounds = board.getBoundingClientRect();
  return [Math.max(0, Math.min(1400, (event.clientX - bounds.left) / bounds.width * 1400)), Math.max(0, Math.min(900, (event.clientY - bounds.top) / bounds.height * 900))].map(n => Math.round(n * 10) / 10);
}
function finishStroke() {
  if (!activeStroke) return;
  activeStroke = null; activePointer = null; queueDraw(); queueSave();
}
if (context && inkContext) {
  board.addEventListener('pointerdown', event => {
    if (activePointer !== null || event.button !== 0) return;
    if (strokes.length >= 1000 || strokes.reduce((n, s) => n + s.points.length, 0) >= 60000) { setStatus('#notes-status', 'This canvas is full. Download a backup, then reset the notebook for a new page.', true); return; }
    event.preventDefault(); activePointer = event.pointerId; board.setPointerCapture(activePointer);
    activeStroke = { erase, color: $('#notes-color').value, width: erase ? 45 : Number($('#notes-width').value), points: [pointAt(event)] };
    strokes.push(activeStroke); redo = []; queueDraw();
  });
  board.addEventListener('pointermove', event => {
    if (!activeStroke || event.pointerId !== activePointer) return;
    const point = pointAt(event), last = activeStroke.points.at(-1);
    if (Math.hypot(point[0] - last[0], point[1] - last[1]) < 1) return;
    if (strokes.reduce((n, s) => n + s.points.length, 0) >= 60000) { finishStroke(); setStatus('#notes-status', 'This drawing has reached its limit. Download a backup and start another page.', true); return; }
    activeStroke.points.push(point); queueDraw();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) board.addEventListener(type, event => { if (event.pointerId === activePointer) finishStroke(); });
} else { setStatus('#notes-status', 'Drawing is not available in this browser. You can still use and save text notes.', true); $('#notes-png').disabled = true; }
for (const id of ['#notes-title', '#notes-text']) $(id).addEventListener('input', queueSave);
function choosePen(value) { erase = value; $('#notes-pen').setAttribute('aria-pressed', String(!erase)); $('#notes-eraser').setAttribute('aria-pressed', String(erase)); }
$('#notes-pen').addEventListener('click', () => choosePen(false));
$('#notes-eraser').addEventListener('click', () => choosePen(true));
$('#notes-undo').addEventListener('click', () => { if (activeStroke || !strokes.length) return; redo.push(strokes.pop()); renderBoard(); queueSave(); });
$('#notes-redo').addEventListener('click', () => { if (activeStroke || !redo.length) return; strokes.push(redo.pop()); renderBoard(); queueSave(); });
$('#notes-png').addEventListener('click', () => {
  renderBoard(); board.toBlob(blob => { if (blob) download(blob, `${safeFilename($('#notes-title').value, 'my-sketch')}.png`, 'image/png'); else setStatus('#notes-status', 'Could not export the drawing. Try downloading a notebook backup instead.', true); }, 'image/png');
});
$('#notes-txt').addEventListener('click', () => download(`${$('#notes-title').value}\n\n${$('#notes-text').value}`, `${safeFilename($('#notes-title').value, 'my-notes')}.txt`, 'text/plain;charset=utf-8'));
$('#notes-backup').addEventListener('click', () => download(JSON.stringify(notebook()), `${safeFilename($('#notes-title').value, 'my-notebook')}.json`, 'application/json'));
function loadNotebook(data) { $('#notes-title').value = data.title; $('#notes-text').value = data.text; strokes = data.strokes; redo = []; activeStroke = null; activePointer = null; renderBoard(); }
$('#notes-restore').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 3000000) throw new Error('This backup is too large. Choose a Vault notebook backup under 3 MB.');
    const data = validateNotebook(JSON.parse(await file.text()));
    if ((strokes.length || $('#notes-text').value || $('#notes-title').value) && !await confirmChange('Restoring replaces the drawing and text in this browser. Download a backup of the current notebook first if you want to keep it.')) return;
    loadNotebook(data); saveNotes();
  } catch (error) { setStatus('#notes-status', `Could not restore: ${error.message}`, true); }
  finally { event.target.value = ''; }
});
$('#notes-reset').addEventListener('click', async () => {
  if (!await confirmChange('Reset removes the saved drawing and text from this browser. Download a backup first if you want to keep them.')) return;
  loadNotebook({ title: '', text: '', strokes: [] }); saveNotes();
});
try {
  const saved = localStorage.getItem(NOTE_KEY);
  if (saved) { loadNotebook(validateNotebook(JSON.parse(saved))); setStatus('#notes-status', 'Restored your notebook from this browser.'); }
  else { renderBoard(); setStatus('#notes-status', 'Your drawing and text will save automatically in this browser.'); }
} catch { renderBoard(); setStatus('#notes-status', 'Saved notes could not be loaded. Use a downloaded backup if you have one; new notes may not persist in this browser.', true); }
window.addEventListener('pagehide', () => { if (saveTimer || activeStroke) saveNotes(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && (saveTimer || activeStroke)) saveNotes(); });

// A blocked cross-origin fetch cannot tell us whether a website is down.
// Report it as unverified; never turn a browser restriction into a false 404.
let linkRows = [], checkController = null;
const stateLabels = { valid: 'VALID URL', invalid: 'INVALID', available: 'RESPONDING', unavailable: 'UNAVAILABLE', restricted: 'RESTRICTED', error: 'SERVER ERROR', unverified: 'UNVERIFIED', checking: 'CHECKING' };
function renderLinks() {
  $('#link-results').innerHTML = linkRows.map(row => `<li><div class="result-url"><span class="result-badge" data-state="${row.state}">${stateLabels[row.state]}</span>${e(row.raw)}</div><p class="result-detail">${e(row.message)}${row.duplicate && !row.message.startsWith('Duplicate') ? ' Duplicate page URL.' : ''}</p>${row.url ? `<a class="result-open" href="${e(row.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" aria-label="Open ${e(row.url)} for a manual check">OPEN ↗</a>` : ''}</li>`).join('');
  $('#links-check').disabled = !!checkController || !linkRows.some(r => r.url);
  $('#links-export').disabled = !!checkController || !linkRows.length;
}
function analyze() {
  const raw = $('#links-input').value;
  linkRows = analyzeLinks(raw); renderLinks();
  const count = raw.split(/\r?\n/).filter(l => l.trim()).length;
  setStatus('#links-status', linkRows.length ? `${linkRows.length} link${linkRows.length === 1 ? '' : 's'} · ${linkRows.filter(r => r.state === 'invalid').length} invalid · ${linkRows.filter(r => r.duplicate).length} duplicate${linkRows.filter(r => r.duplicate).length === 1 ? '' : 's'}.${count > 50 ? ' Only the first 50 links were analyzed.' : ''} Availability has not been checked.` : 'Paste at least one website address, one per line.');
}
$('#links-analyze').addEventListener('click', analyze);
$('#links-input').addEventListener('input', () => {
  checkController?.abort(); linkRows = []; renderLinks();
  setStatus('#links-status', 'Links changed. Choose Analyze links to refresh the results.');
});
async function checkLink(row, signal) {
  if (location.protocol === 'https:' && new URL(row.url).protocol === 'http:') return { state: 'unverified', message: 'This HTTPS page cannot verify an insecure HTTP address. Open it manually.' };
  const controller = new AbortController();
  const stop = () => controller.abort(); signal.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    if (signal.aborted) throw new Error('Cancelled');
    const options = { method: 'HEAD', mode: 'cors', credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal };
    let response = await fetch(row.url, options);
    if (response.status === 405 || response.status === 501) { response = await fetch(row.url, { ...options, method: 'GET' }); }
    response.body?.cancel().catch(() => {});
    return classifyHTTP(response.status);
  } catch {
    return { state: 'unverified', message: signal.aborted ? 'Check stopped. Open manually or try again.' : controller.signal.aborted ? 'Timed out. Open manually to check availability.' : 'Could not verify: the browser could not read a response (site policy or a network error). Open manually.' };
  } finally { clearTimeout(timer); signal.removeEventListener('abort', stop); }
}
$('#links-check').addEventListener('click', async () => {
  if (checkController || !linkRows.length) return;
  checkController = new AbortController();
  const controller = checkController, rows = linkRows;
  const unique = [...new Map(rows.filter(r => r.url).map(r => { const u = new URL(r.url); u.hash = ''; return [u.href, r]; })).entries()];
  let index = 0, completed = 0;
  $('#links-analyze').disabled = true; $('#links-stop').hidden = false; renderLinks();
  const worker = async () => {
    while (index < unique.length && !controller.signal.aborted) {
      const [url, row] = unique[index++];
      row.state = 'checking'; row.message = 'Waiting for a response…'; if (linkRows === rows) renderLinks();
      const result = await checkLink(row, controller.signal);
      for (const match of rows) { if (match.url) { const u = new URL(match.url); u.hash = ''; if (u.href === url) Object.assign(match, result); } }
      completed++;
      if (linkRows === rows) { renderLinks(); setStatus('#links-status', `Checked ${completed} of ${unique.length} unique pages. Browser restrictions will appear as unverified.`); }
    }
  };
  try { await Promise.all(Array.from({ length: Math.min(4, unique.length) }, worker)); }
  finally {
    checkController = null; $('#links-analyze').disabled = false; $('#links-stop').hidden = true; renderLinks();
    if (linkRows === rows) setStatus('#links-status', `${controller.signal.aborted ? 'Checking stopped.' : 'Checks finished.'} ${completed} of ${unique.length} unique pages attempted. Unverified results need a manual check.`);
  }
});
$('#links-stop').addEventListener('click', () => checkController?.abort());
$('#links-export').addEventListener('click', () => download(linksCSV(linkRows), 'link-report.csv', 'text/csv;charset=utf-8'));
