import { createImagePDF, analyzeLinks, classifyHTTP, linksCSV, safeFilename } from './tools-core.js?v=4';
import { initNotebook } from './notebook.js?v=2';
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
  const key = ['images', 'image-convert', 'image-compress', 'markdown', 'notes', 'links'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'images';
  for (const panel of document.querySelectorAll('.tool-panel')) panel.hidden = panel.id !== `tool-${key}`;
  for (const link of document.querySelectorAll('.tool-switcher a')) {
    if (link.hash === (key === 'notes' ? '#notes' : '#utilities')) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const heading = $(`#${key}-heading`);
  $('#utility-picker').hidden = key === 'notes';
  if (key !== 'notes') $('#utility-select').value = key;
  document.title = `${heading.textContent} // Adeeb’s Vault`;
  if (focus) heading.focus({ preventScroll: true });
}
window.addEventListener('hashchange', () => routeTool(true));
routeTool();
$('#utility-select').addEventListener('change', event => { location.hash = event.target.value; });

// Images to PDF: decode locally, flatten transparency onto white, then embed
// the resized JPEGs into a standards-based PDF without an external service.
const images = [];
let imageBusy = false;
let originalBytes = 0;
function renderImages(focusIndex = -1) {
  $('#image-list').innerHTML = images.map((image, i) => `<li draggable="true" data-image-row="${i}"><img src="${image.preview}" alt="Page ${i + 1} preview"><div class="image-info"><strong>${e(image.name)}</strong><span>PAGE ${String(i + 1).padStart(2, '0')} · ${image.width} × ${image.height}</span></div><div class="image-actions"><button type="button" data-image="up" data-index="${i}" aria-label="Move page ${i + 1} up" ${i === 0 || imageBusy ? 'disabled' : ''}>↑</button><button type="button" data-image="down" data-index="${i}" aria-label="Move page ${i + 1} down" ${i === images.length - 1 || imageBusy ? 'disabled' : ''}>↓</button><button type="button" data-image="rotate" data-index="${i}" aria-label="Rotate page ${i + 1} clockwise">↻</button><button type="button" data-image="remove" data-index="${i}" aria-label="Remove page ${i + 1}" ${imageBusy ? 'disabled' : ''}>×</button></div></li>`).join('');
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
$('#image-quality').addEventListener('input', event => { $('#image-quality-value').textContent = event.target.value + '%'; });
$('#image-margin').addEventListener('input', event => { $('#image-margin-value').textContent = Math.round(Number(event.target.value) * 25.4 / 72) + ' mm'; });
$('#image-list').addEventListener('click', event => {
  const button = event.target.closest('[data-image]');
  if (!button || imageBusy) return;
  const index = Number(button.dataset.index), action = button.dataset.image;
  if (action === 'rotate') { const image = images[index]; imageBusy = true; renderImages(); try { const updated = await convertImage(image.sourceFile, image.rotation + 90, Number($('#image-quality').value) / 100); URL.revokeObjectURL(image.preview); Object.assign(image, updated, { originalSize: image.originalSize }); } catch (error) { setStatus('#image-status', error.message, true); } finally { imageBusy = false; renderImages(index); } return; }
  if (action === 'remove') { const [image] = images.splice(index, 1); originalBytes -= image.originalSize; URL.revokeObjectURL(image.preview); }
  else { const target = action === 'up' ? index - 1 : index + 1; if (target < 0 || target >= images.length) return; [images[index], images[target]] = [images[target], images[index]]; }
  renderImages(Math.min(action === 'up' ? index - 1 : action === 'down' ? index + 1 : index, images.length - 1));
  if (!images.length) $('#image-files').focus();
});
let draggedImageIndex = -1;
$('#image-list').addEventListener('dragstart', event => { const row = event.target.closest('[data-image-row]'); if (!row || imageBusy) return; draggedImageIndex = Number(row.dataset.imageRow); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(draggedImageIndex)); });
$('#image-list').addEventListener('dragover', event => { if (event.target.closest('[data-image-row]')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } });
$('#image-list').addEventListener('drop', event => { const row = event.target.closest('[data-image-row]'); if (!row || imageBusy) return; event.preventDefault(); const from = draggedImageIndex, to = Number(row.dataset.imageRow); draggedImageIndex = -1; if (from < 0 || from >= images.length || to < 0 || to >= images.length || from === to) return; const moved = images.splice(from, 1)[0]; images.splice(to, 0, moved); renderImages(to); });
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
    const quality = Number($('#image-quality').value) / 100;
    const exportImages = await Promise.all(images.map(image => convertImage(image.sourceFile || image.file, image.rotation || 0, quality)));
    const pdf = createImagePDF(exportImages, { size: $('#image-paper').value, orientation: $('#image-orientation').value, margin: Number($('#image-margin').value) * 72 / 25.4 });
    exportImages.forEach(image => URL.revokeObjectURL(image.preview));
    download(pdf, `${safeFilename($('#image-name').value, 'my-document')}.pdf`, 'application/pdf');
    setStatus('#image-status', `Your ${images.length}-page PDF is ready. Your images stayed on this device.`);
  } catch (error) { setStatus('#image-status', `Could not create the PDF: ${error.message}`, true); }
  finally { imageBusy = false; renderImages(); }
});

function initImageBatch(prefix, mode) {
  const files = [];
  const input = document.querySelector('#' + prefix + '-files');
  const drop = document.querySelector('#' + prefix + '-drop');
  const list = document.querySelector('#' + prefix + '-list');
  const run = document.querySelector('#' + prefix + '-export');
  const clear = document.querySelector('#' + prefix + '-clear');
  const status = '#' + prefix + '-status';
  const quality = document.querySelector('#' + prefix + '-quality');
  const qualityValue = document.querySelector('#' + prefix + '-quality-value');
  quality.addEventListener('input', () => qualityValue.textContent = quality.value + '%');
  function render() {
    list.innerHTML = files.map((f, i) => '<li><img src="' + f.preview + '" alt=""><div class="image-info"><strong>' + e(f.name) + '</strong><span>' + (f.size / 1024).toFixed(1) + ' KB · ' + f.width + ' × ' + f.height + '</span></div><div class="image-actions"><button type="button" data-remove="' + i + '" aria-label="Remove image">×</button></div></li>').join('');
    run.disabled = clear.disabled = !files.length;
  }
  async function add(selected) {
    for (const file of selected) {
      if (files.length >= 20) { setStatus(status, 'Maximum 20 images per batch.', true); break; }
      if (file.size > 15 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setStatus(status, file.name + ': use JPG, PNG, or WebP up to 15 MB.', true); continue; }
      const url = URL.createObjectURL(file);
      try { const img = new Image(); await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; }); if (img.naturalWidth * img.naturalHeight > 40000000) throw new Error('Maximum 40 megapixels.'); files.push({ file, name: file.name, size: file.size, width: img.naturalWidth, height: img.naturalHeight, preview: URL.createObjectURL(file) }); }
      catch (err) { setStatus(status, file.name + ': could not read image. ' + (err.message || ''), true); }
      finally { URL.revokeObjectURL(url); }
    }
    input.value = ''; render(); if (files.length) setStatus(status, files.length + ' image(s) ready. Choose settings, then process.');
  }
  input.addEventListener('change', ev => add([...ev.target.files]));
  ['dragover', 'dragenter'].forEach(type => drop.addEventListener(type, ev => { ev.preventDefault(); drop.classList.add('is-dragging'); }));
  ['dragleave', 'drop'].forEach(type => drop.addEventListener(type, ev => { ev.preventDefault(); drop.classList.remove('is-dragging'); }));
  drop.addEventListener('drop', ev => add([...ev.dataTransfer.files]));
  list.addEventListener('click', ev => { const btn = ev.target.closest('[data-remove]'); if (!btn) return; const gone = files.splice(Number(btn.dataset.remove), 1)[0]; if (gone) URL.revokeObjectURL(gone.preview); render(); });
  clear.addEventListener('click', () => { files.forEach(f => URL.revokeObjectURL(f.preview)); files.length = 0; render(); setStatus(status, 'Image list cleared.'); });
  run.addEventListener('click', async () => {
    if (!files.length) return; run.disabled = clear.disabled = input.disabled = true;
    let done = 0, outputTotal = 0; const inputTotal = files.reduce((sum, f) => sum + f.size, 0);
    const format = document.querySelector('#' + prefix + '-format').value;
    const max = document.querySelector('#' + prefix + '-size').value;
    const q = Number(quality.value) / 100;
    const ext = format === 'image/jpeg' ? 'jpg' : format === 'image/png' ? 'png' : 'webp';
    try {
      for (const item of files) {
        setStatus(status, (mode === 'compress' ? 'Compressing ' : 'Converting ') + item.name + '…');
        const url = URL.createObjectURL(item.file);
        try {
          const img = new Image(); await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; });
          const edge = max === 'original' ? Infinity : Number(max); const ratio = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
          const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
          const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas is unavailable.');
          if (format === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); } ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise(resolve => canvas.toBlob(resolve, format, q)); if (!blob || blob.type !== format) throw new Error('This browser cannot export ' + ext.toUpperCase() + '.');
          let base = item.name; const dot = base.lastIndexOf('.'); if (dot > 0) base = base.slice(0, dot);
          download(blob, safeFilename(base, 'image') + '-' + (mode === 'compress' ? 'compressed' : 'converted') + '.' + ext, blob.type); done++; outputTotal += blob.size;
        } catch (err) { setStatus(status, item.name + ': ' + (err.message || 'Conversion failed.'), true); } finally { URL.revokeObjectURL(url); }
      }
      if (done) { const delta = inputTotal - outputTotal; setStatus(status, done + ' file(s) processed. Total: ' + (inputTotal / 1024).toFixed(1) + ' KB → ' + (outputTotal / 1024).toFixed(1) + ' KB. ' + (delta >= 0 ? Math.round(delta / inputTotal * 100) + '% smaller overall.' : 'Output is larger; try WebP or lower quality.')); }
    } finally { input.disabled = false; run.disabled = clear.disabled = !files.length; }
  });
}
initImageBatch('convert', 'convert');
initImageBatch('compress', 'compress');

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

initNotebook({ download, confirmChange });

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
