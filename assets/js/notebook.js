import { upgradeNotebook, validateNotebook, safeFilename } from './tools-core.js?v=3';

export function initNotebook({ download, confirmChange }) {
  const $ = selector => document.querySelector(selector);
  const status = (text, error = false) => { $('#notes-status').textContent = text; $('#notes-status').dataset.error = String(error); };
  const KEY = 'adeeb-vault-notebook-v2', LEGACY_KEY = 'adeeb-vault-notebook-v1';
  const blankPage = title => ({ title, text: '', strokes: [], orientation: window.innerHeight > window.innerWidth ? 'portrait' : 'landscape' });
  const blankBook = () => ({ kind: 'adeeb-vault-notebook', version: 2, title: '', activePage: 0, pages: [blankPage('Page 1')] });
  let book = blankBook(), histories = new WeakMap();
  let activeStroke = null, activePointer = null, erase = false, drawFrame = null, saveTimer = null;
  const board = $('#notes-canvas'), context = board.getContext('2d');
  const ink = document.createElement('canvas'); ink.width = board.width; ink.height = board.height;
  const inkContext = ink.getContext('2d');
  const page = () => book.pages[book.activePage];
  const history = () => { if (!histories.has(page())) histories.set(page(), []); return histories.get(page()); };
  const pointCount = () => book.pages.reduce((n, p) => n + p.strokes.reduce((sum, s) => sum + s.points.length, 0), 0);

  function save() {
    clearTimeout(saveTimer); saveTimer = null;
    try {
      validateNotebook(book);
      localStorage.setItem(KEY, JSON.stringify(book));
      status(`All ${book.pages.length} page${book.pages.length === 1 ? '' : 's'} saved in this browser. Download a backup for a separate copy.`);
    } catch { status('This notebook could not be saved in the browser. Download a .json backup before leaving.', true); }
  }
  function queueSave() { status('Saving…'); clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); }

  function renderBoard() {
    if (!context || !inkContext) return;
    inkContext.clearRect(0, 0, board.width, board.height);
    for (const stroke of page().strokes) {
      inkContext.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
      inkContext.strokeStyle = stroke.color; inkContext.fillStyle = stroke.color;
      inkContext.lineWidth = stroke.width; inkContext.lineCap = 'round'; inkContext.lineJoin = 'round';
      const points = stroke.points;
      inkContext.beginPath();
      if (points.length === 1) { inkContext.arc(points[0][0], points[0][1], stroke.width / 2, 0, Math.PI * 2); inkContext.fill(); }
      else { inkContext.moveTo(...points[0]); for (let i = 1; i < points.length; i++) inkContext.lineTo(...points[i]); inkContext.stroke(); }
    }
    context.fillStyle = '#fbfaf7'; context.fillRect(0, 0, board.width, board.height);
    context.fillStyle = '#d8d2c7';
    for (let x = 24; x < board.width; x += 28) for (let y = 24; y < board.height; y += 28) { context.beginPath(); context.arc(x, y, 1, 0, Math.PI * 2); context.fill(); }
    context.drawImage(ink, 0, 0);
    $('#notes-undo').disabled = !page().strokes.length || !!activeStroke;
    $('#notes-redo').disabled = !history().length || !!activeStroke;
  }
  function queueDraw() { if (drawFrame !== null) return; drawFrame = requestAnimationFrame(() => { drawFrame = null; renderBoard(); }); }
  function renderPages() {
    $('#notes-pages').innerHTML = book.pages.map((p, i) => `<button type="button" data-page="${i}" ${i === book.activePage ? 'aria-current="page"' : ''} aria-label="Go to page ${i + 1}">${String(i + 1).padStart(2, '0')}</button>`).join('');
    $('#notes-page-count').textContent = `${book.activePage + 1} / ${book.pages.length}`;
    $('#notes-page-count').setAttribute('aria-label', `Page ${book.activePage + 1} of ${book.pages.length}`);
    $('#notes-previous').disabled = book.activePage === 0;
    $('#notes-next').disabled = book.activePage === book.pages.length - 1;
    $('#notes-add').disabled = book.pages.length >= 20;
    $('#notes-duplicate').disabled = book.pages.length >= 20;
    $('#notes-delete').disabled = book.pages.length === 1;
    const strip = $('#notes-pages'), selected = strip.querySelector('[aria-current]');
    if (selected) {
      const left = selected.offsetLeft - strip.offsetLeft;
      if (left < strip.scrollLeft) strip.scrollLeft = left;
      else if (left + selected.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = left + selected.offsetWidth - strip.clientWidth;
    }
  }
  function showPage() {
    const [width, height] = page().orientation === 'portrait' ? [900, 1400] : [1400, 900];
    if (board.width !== width || board.height !== height) { board.width = ink.width = width; board.height = ink.height = height; }
    board.style.aspectRatio = `${width} / ${height}`;
    $('#notes-txt').hidden = !book.pages.some(p => p.text);
    renderPages(); renderBoard();
    fitPaper();
  }
  function finishStroke() {
    if (!activeStroke) return;
    activeStroke = null; activePointer = null; queueDraw(); queueSave();
  }
  function switchPage(index) {
    if (index < 0 || index >= book.pages.length) return;
    finishStroke(); book.activePage = index; showPage(); save();
  }
  $('#notes-pages').addEventListener('click', event => { const button = event.target.closest('[data-page]'); if (button) switchPage(Number(button.dataset.page)); });
  $('#notes-pages').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); switchPage(event.key === 'Home' ? 0 : event.key === 'End' ? book.pages.length - 1 : Math.max(0, Math.min(book.pages.length - 1, book.activePage + (event.key === 'ArrowLeft' ? -1 : 1))));
    $('#notes-pages [aria-current]')?.focus({ preventScroll: true });
  });
  $('#notes-previous').addEventListener('click', () => switchPage(book.activePage - 1));
  $('#notes-next').addEventListener('click', () => switchPage(book.activePage + 1));
  function addPage(duplicate) {
    if (book.pages.length >= 20) return;
    finishStroke();
    const added = duplicate ? structuredClone(page()) : blankPage(`Page ${book.pages.length + 1}`);
    if (duplicate) added.title = `${added.title || 'Page'} (copy)`.slice(0, 120);
    const candidate = { ...book, pages: [...book.pages] };
    candidate.pages.splice(book.activePage + 1, 0, added); candidate.activePage++;
    try { validateNotebook(candidate); book = candidate; showPage(); save(); }
    catch { status('This notebook is too large to duplicate. Download a backup, or add a blank page instead.', true); }
  }
  $('#notes-add').addEventListener('click', () => addPage(false));
  $('#notes-duplicate').addEventListener('click', () => addPage(true));
  $('#notes-delete').addEventListener('click', async () => {
    if (book.pages.length === 1 || !await confirmChange(`Delete page ${book.activePage + 1} and its drawing and text? Other pages will stay. Download a backup first if you want to keep this page.`)) return;
    finishStroke(); book.pages.splice(book.activePage, 1); book.activePage = Math.min(book.activePage, book.pages.length - 1); showPage(); save();
  });

  function pointAt(event) {
    const bounds = board.getBoundingClientRect();
    return [Math.max(0, Math.min(board.width, (event.clientX - bounds.left) / bounds.width * board.width)), Math.max(0, Math.min(board.height, (event.clientY - bounds.top) / bounds.height * board.height))].map(n => Math.round(n * 10) / 10);
  }
  if (context && inkContext) {
    board.addEventListener('pointerdown', event => {
      if (activePointer !== null || event.button !== 0) return;
      if (page().strokes.length >= 1000 || page().strokes.reduce((n, s) => n + s.points.length, 0) >= 60000 || pointCount() >= 120000) { status('This drawing has reached its limit. Back up the notebook, then use a new page or notebook.', true); return; }
      event.preventDefault(); activePointer = event.pointerId; board.setPointerCapture(activePointer);
      activeStroke = { erase, color: $('#notes-color').value, width: erase ? 45 : Number($('#notes-width').value), points: [pointAt(event)] };
      page().strokes.push(activeStroke); history().length = 0; queueDraw();
    });
    board.addEventListener('pointermove', event => {
      if (!activeStroke || event.pointerId !== activePointer) return;
      const point = pointAt(event), last = activeStroke.points.at(-1);
      if (Math.hypot(point[0] - last[0], point[1] - last[1]) < 1) return;
      if (page().strokes.reduce((n, s) => n + s.points.length, 0) >= 60000 || pointCount() >= 120000) { finishStroke(); status('Drawing limit reached. Download a backup before starting another notebook.', true); return; }
      activeStroke.points.push(point); queueDraw();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) board.addEventListener(type, event => { if (event.pointerId === activePointer) finishStroke(); });
  } else { status('Drawing is unavailable in this browser. You can still download backups of saved pages.', true); $('#notes-png').disabled = true; }
  function choosePen(value) { erase = value; $('#notes-pen').setAttribute('aria-pressed', String(!erase)); $('#notes-eraser').setAttribute('aria-pressed', String(erase)); }
  $('#notes-pen').addEventListener('click', () => choosePen(false));
  $('#notes-eraser').addEventListener('click', () => choosePen(true));
  $('#notes-undo').addEventListener('click', () => { if (activeStroke || !page().strokes.length) return; history().push(page().strokes.pop()); renderBoard(); queueSave(); });
  $('#notes-redo').addEventListener('click', () => {
    if (activeStroke || !history().length) return;
    if (pointCount() + history().at(-1).points.length > 120000) { status('Notebook drawing limit reached. Back up the notebook before adding more drawing data.', true); return; }
    page().strokes.push(history().pop()); renderBoard(); queueSave();
  });
  $('#notes-png').addEventListener('click', () => {
    renderBoard(); const name = `${safeFilename(book.title, 'my-notebook')}-page-${book.activePage + 1}.png`;
    board.toBlob(blob => { if (blob) download(blob, name, 'image/png'); else status('Could not export the drawing. Try a .json backup instead.', true); }, 'image/png');
  });
  $('#notes-txt').addEventListener('click', () => { download(`${book.title}\n\n${book.pages.map((p, i) => `--- Page ${i + 1}: ${p.title} ---\n${p.text}`).join('\n\n')}`, `${safeFilename(book.title, 'my-notebook')}.txt`, 'text/plain;charset=utf-8'); });
  $('#notes-backup').addEventListener('click', () => { download(JSON.stringify(book), `${safeFilename(book.title, 'my-notebook')}.json`, 'application/json'); });
  function load(data) { book = upgradeNotebook(data); histories = new WeakMap(); activeStroke = null; activePointer = null; showPage(); }
  $('#notes-restore').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 5000000) throw new Error('Choose a Vault notebook backup under 5 MB.');
      const data = upgradeNotebook(JSON.parse(await file.text()));
      if (!await confirmChange('Restoring replaces every page of this notebook. Download a backup first if you want to keep the current pages.')) return;
      clearTimeout(saveTimer); load(data); save();
    } catch (error) { status(`Could not restore: ${error.message}`, true); }
    finally { event.target.value = ''; }
  });
  $('#notes-reset').addEventListener('click', async () => {
    if (!await confirmChange('Reset removes every page of this notebook from this browser. Download a backup first if you want to keep them.')) return;
    clearTimeout(saveTimer); load(blankBook()); save();
  });

  const panel = $('#tool-notes'), enlarge = $('#notes-enlarge');
  function fitPaper() {
    const workspace = $('.notes-workspace'), paper = $('.drawing-paper');
    if (panel.classList.contains('notes-expanded')) {
      const width = Math.min(workspace.clientWidth, workspace.clientHeight * board.width / board.height);
      paper.style.width = `${Math.max(1, Math.floor(width))}px`;
    } else { paper.style.width = ''; }
  }
  new ResizeObserver(fitPaper).observe($('.notes-workspace'));
  function setExpanded(expanded) {
    panel.classList.toggle('notes-expanded', expanded); document.body.classList.toggle('notebook-open', expanded);
    enlarge.textContent = expanded ? 'EXIT ↙' : 'ENLARGE ↗';
    enlarge.setAttribute('aria-pressed', String(expanded));
    if (expanded) panel.scrollTop = 0;
    requestAnimationFrame(fitPaper);
  }
  async function exitExpanded() {
    setExpanded(false);
    if (document.fullscreenElement === panel) { try { await document.exitFullscreen(); } catch {} }
    enlarge.focus({ preventScroll: true });
  }
  enlarge.addEventListener('click', async () => {
    if (panel.classList.contains('notes-expanded')) { await exitExpanded(); return; }
    setExpanded(true);
    try { if (panel.requestFullscreen) await panel.requestFullscreen(); } catch { /* Expanded view also works without the Fullscreen API. */ }
  });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && panel.classList.contains('notes-expanded')) { setExpanded(false); enlarge.focus({ preventScroll: true }); } });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#tool-confirm').open && panel.classList.contains('notes-expanded')) { event.preventDefault(); exitExpanded(); } });
  window.addEventListener('hashchange', () => { if (location.hash !== '#notes' && panel.classList.contains('notes-expanded')) exitExpanded(); });

  try {
    const current = localStorage.getItem(KEY), legacy = current ? null : localStorage.getItem(LEGACY_KEY);
    if (current || legacy) { load(JSON.parse(current || legacy)); if (legacy) save(); else status('Restored all your notebook pages from this browser.'); }
    else { showPage(); status('Start on page one. Add up to 20 drawing pages.'); }
  } catch { showPage(); status('Saved notes could not be loaded. Restore a downloaded backup if available.', true); }
  window.addEventListener('pagehide', () => { if (saveTimer || activeStroke) save(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && (saveTimer || activeStroke)) save(); });
}
