const $ = (s) => document.querySelector(s), W = 1400, H = 900;
/*PURE*/
const G0 = { exp: 0, con: 0, hi: 0, sh: 0, temp: 0, tint: 0, sat: 0, hue: 0, fade: 0, split: 0, vig: 0, grain: 0 };
const G = { ...G0, sc: '#1f6f8b', hc: '#ff9a4d' };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const gradeActive = () => Object.keys(G0).some((k) => G[k] !== 0);
function grade(d, w, h) {
  const ev = 2 ** (G.exp / 50), f = (259 * (G.con * 2.55 + 255)) / (255 * (259 - G.con * 2.55)), fd = G.fade / 100 * .15;
  const lut = [0, 1, 2].map((c) => {
    const t = new Uint8ClampedArray(256), k = c === 0 ? 1 + G.temp / 250 + G.tint / 700 : c === 2 ? 1 - G.temp / 250 + G.tint / 700 : 1 - G.tint / 250;
    for (let i = 0; i < 256; i++) {
      let v = Math.min(1, Math.max(0, ((i / 255) * k * ev - .5) * f + .5));
      v += G.sh / 100 * .3 * (1 - v) * (1 - v) + G.hi / 100 * .3 * v * v;
      t[i] = (fd + Math.min(1, Math.max(0, v)) * (1 - fd)) * 255;
    }
    return t;
  });
  const sat = 1 + G.sat / 100, hue = G.hue, a = hue * Math.PI / 180, co = Math.cos(a), si = Math.sin(a), sa = G.split / 100 * .45;
  const s1 = hex(G.sc), s2 = hex(G.hc), vg = G.vig / 100, gn = G.grain * .9, R = lut[0], Gn = lut[1], B = lut[2];
  const m00 = .213 + co * .787 - si * .213, m01 = .715 - co * .715 - si * .715, m02 = .072 - co * .072 + si * .928;
  const m10 = .213 - co * .213 + si * .143, m11 = .715 + co * .285 + si * .14, m12 = .072 - co * .072 - si * .283;
  const m20 = .213 - co * .213 - si * .787, m21 = .715 - co * .715 + si * .715, m22 = .072 + co * .928 + si * .072;
  const r1 = s1[0], g1 = s1[1], b1 = s1[2], r2 = s2[0], g2 = s2[1], b2 = s2[2]; let seed = 1234567, i = 0; const xs = new Float64Array(w); for (let x = 0; x < w; x++) xs[x] = (x / w - .5) ** 2;
  for (let y = 0; y < h; y++) {
    const yy = (y / h - .5) ** 2;
    for (let x = 0; x < w; x++, i += 4) {
      let r = R[d[i]], g = Gn[d[i + 1]], b = B[d[i + 2]];
      if (hue) { const nr = r * m00 + g * m01 + b * m02, ng = r * m10 + g * m11 + b * m12; b = r * m20 + g * m21 + b * m22; r = nr; g = ng; }
      const l = .299 * r + .587 * g + .114 * b;
      if (sat !== 1) { r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat; }
      if (sa) { const u = l / 255, ws = (1 - u) * (1 - u) * sa, wh = u * u * sa; r += (r1 - r) * ws + (r2 - r) * wh; g += (g1 - g) * ws + (g2 - g) * wh; b += (b1 - b) * ws + (b2 - b) * wh; }
      if (vg) { let t = (2 * (xs[x] + yy) - .15) * 1.1765; t = t < 0 ? 0 : t > 1 ? 1 : t; const m = 1 - vg * t; r *= m; g *= m; b *= m; }
      if (gn) { seed = (seed * 1664525 + 1013904223) >>> 0; const n = ((seed >>> 24) / 255 - .5) * gn; r += n; g += n; b += n; }
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  }
}
/*END*/
const PRESETS = {
  Original: {},
  Cinematic: { con: 18, sat: -8, temp: 8, tint: -4, sh: -10, hi: -8, split: 55, vig: 25, grain: 10, fade: 10, sc: '#0f5c73', hc: '#ff9a4d' },
  Noir: { sat: -100, con: 35, exp: -8, vig: 40, grain: 25, fade: 5 },
  Vintage: { temp: 25, sat: -20, fade: 35, con: -5, vig: 30, grain: 30, tint: 6 },
  'Vault neon': { con: 25, sat: 25, temp: -10, split: 70, vig: 35, grain: 8, sc: '#2b1055', hc: '#faff00' },
  Dream: { exp: 12, con: -15, sat: 18, temp: -8, tint: 10, fade: 25, sh: 20, hi: -10, split: 25, sc: '#6a5acd', hc: '#ffb6c1' },
  'Warm film': { temp: 35, con: 12, sat: 10, fade: 15, grain: 18, vig: 20 }
};
const SLIDERS = [['exp', 'Exposure', -100, 100], ['con', 'Contrast', -100, 100], ['hi', 'Highlights', -100, 100], ['sh', 'Shadows', -100, 100], ['temp', 'Temperature', -100, 100], ['tint', 'Tint', -100, 100], ['sat', 'Saturation', -100, 100], ['hue', 'Hue shift', -180, 180], ['fade', 'Fade', 0, 100], ['split', 'Split-tone amount', 0, 100], ['vig', 'Vignette', 0, 100], ['grain', 'Film grain', 0, 100]];

const view = $('#cp-view'), vx = view.getContext('2d'), comp = document.createElement('canvas'), stroke = document.createElement('canvas');
view.width = comp.width = stroke.width = W; view.height = comp.height = stroke.height = H;
const cx = comp.getContext('2d', { willReadFrequently: true }), sx = stroke.getContext('2d');
const st = { tool: 'brush', brush: 'pen', color: '#1a1a1a', size: 12, opacity: 100, smooth: 40, sym: 'off', n: 6, fill: false, paper: '#f5f2ec' };
let layers = [], cur = 0, undo = [], redo = [], down = false, start, last, sp, hold = false, raf = 0;
const say = (m) => { $('#cp-status').textContent = m; };

function mk() { const c = document.createElement('canvas'); c.width = W; c.height = H; return { c, x: c.getContext('2d', { willReadFrequently: true }), vis: true }; }
function listLayers() {
  const box = $('#cp-layers'); box.replaceChildren();
  layers.forEach((l, i) => {
    const row = document.createElement('div'), a = document.createElement('button'), b = document.createElement('button');
    row.className = 'cp-layer' + (i === cur ? ' on' : ''); a.type = b.type = 'button'; a.className = b.className = 'small-tool-button';
    a.textContent = 'Layer ' + (i + 1); a.onclick = () => { cur = i; listLayers(); };
    b.textContent = l.vis ? 'HIDE' : 'SHOW'; b.setAttribute('aria-label', (l.vis ? 'Hide' : 'Show') + ' layer ' + (i + 1));
    b.onclick = () => { l.vis = !l.vis; listLayers(); paint(); };
    row.append(a, b); box.append(row);
  });
}
function btns() { $('#cp-undo').disabled = !undo.length; $('#cp-redo').disabled = !redo.length; }
function snap() { undo.push({ i: cur, d: layers[cur].x.getImageData(0, 0, W, H) }); if (undo.length > 12) undo.shift(); redo = []; btns(); }
function step(from, to) { const e = from.pop(); if (!e) return; to.push({ i: e.i, d: layers[e.i].x.getImageData(0, 0, W, H) }); layers[e.i].x.putImageData(e.d, 0, 0); btns(); paint(); }

const hl = () => st.tool === 'brush' && st.brush === 'hl';
function composite() {
  cx.globalAlpha = 1; cx.globalCompositeOperation = 'source-over'; cx.fillStyle = st.paper; cx.fillRect(0, 0, W, H);
  layers.forEach((l, i) => {
    if (!l.vis) return; cx.drawImage(l.c, 0, 0);
    if (i === cur && down && st.tool !== 'eraser') { cx.save(); cx.globalAlpha = st.opacity / 100; if (hl()) cx.globalCompositeOperation = 'multiply'; cx.drawImage(stroke, 0, 0); cx.restore(); }
  });
}
function paint() {
  composite();
  if (gradeActive() && !down && !hold) { const im = cx.getImageData(0, 0, W, H); grade(im.data, W, H); vx.putImageData(im, 0, 0); } else vx.drawImage(comp, 0, 0);
}
const later = () => { raf = raf || requestAnimationFrame(() => { raf = 0; paint(); }); };

function pos(e) { const r = view.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height, p: e.pointerType === 'pen' ? e.pressure || .5 : 1 }; }
function mirrors(x, y) {
  const X = W / 2, Y = H / 2, m = st.sym; let c = [[x, y]];
  if (m === 'mx') c.push([2 * X - x, y]); else if (m === 'my') c.push([x, 2 * Y - y]); else if (m === 'quad') c.push([2 * X - x, y], [x, 2 * Y - y], [2 * X - x, 2 * Y - y]);
  else if (m === 'rad' || m === 'kal') {
    c = []; const dx = x - X, dy = y - Y;
    for (let i = 0; i < st.n; i++) { const a = 6.2832 * i / st.n, co = Math.cos(a), si = Math.sin(a); c.push([X + dx * co - dy * si, Y + dx * si + dy * co]); if (m === 'kal') c.push([X + dx * co + dy * si, Y + dx * si - dy * co]); }
  }
  return c;
}
function stamp(g, x, y, p) {
  const b = st.tool === 'eraser' ? 'pen' : st.brush; let s = st.size * (.4 + .6 * p); if (b === 'hl') s *= 1.7;
  g.fillStyle = st.color; g.globalAlpha = 1;
  if (b === 'spray') { g.globalAlpha = .55; for (let i = 0; i < s; i++) { const a = Math.random() * 6.2832, r = Math.random() * s; g.fillRect(x + Math.cos(a) * r, y + Math.sin(a) * r, 1.7, 1.7); } }
  else if (b === 'air') { const r = s * 1.2, q = g.createRadialGradient(x, y, 0, x, y, r); q.addColorStop(0, st.color + '38'); q.addColorStop(1, st.color + '00'); g.fillStyle = q; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
  else if (b === 'pencil') { g.globalAlpha = .4; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(x + (Math.random() - .5) * s * .6, y + (Math.random() - .5) * s * .6, Math.max(.6, s * .18), 0, 6.2832); g.fill(); } }
  else if (b === 'callig') { g.save(); g.translate(x, y); g.rotate(-.8); g.scale(1, .25); g.beginPath(); g.arc(0, 0, s * .7, 0, 6.2832); g.fill(); g.restore(); }
  else { g.globalAlpha = b === 'marker' ? .55 : 1; g.beginPath(); g.arc(x, y, s / 2, 0, 6.2832); g.fill(); }
  g.globalAlpha = 1;
}
function seg(a, b) {
  const er = st.tool === 'eraser', g = er ? layers[cur].x : sx, soft = st.brush === 'spray' || st.brush === 'air';
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, st.size * (soft ? .3 : .12))));
  if (er) g.globalCompositeOperation = 'destination-out';
  for (let i = 1; i <= n; i++) { const t = i / n; for (const [q, r] of mirrors(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) stamp(g, q, r, a.p + (b.p - a.p) * t); }
  g.globalCompositeOperation = 'source-over';
}
function shape(a, b) {
  sx.clearRect(0, 0, W, H); sx.strokeStyle = sx.fillStyle = st.color; sx.lineWidth = st.size; sx.lineCap = sx.lineJoin = 'round'; sx.beginPath();
  if (st.tool === 'line') { sx.moveTo(a.x, a.y); sx.lineTo(b.x, b.y); }
  else if (st.tool === 'rect') sx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
  else sx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, 6.2832);
  if (st.fill && st.tool !== 'line') sx.fill(); else sx.stroke();
}
function pick(p) {
  composite(); const d = cx.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
  st.color = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join(''); $('#cp-color').value = st.color; say('Picked ' + st.color + ' (before grading).');
}
const isShape = () => ['line', 'rect', 'ellipse'].includes(st.tool);
function finish(p) {
  if (!down) return; if (isShape()) shape(start, p); else seg(last, p);
  down = false;
  if (st.tool !== 'eraser') { const l = layers[cur].x; l.save(); l.globalAlpha = st.opacity / 100; if (hl()) l.globalCompositeOperation = 'multiply'; l.drawImage(stroke, 0, 0); l.restore(); }
  sx.clearRect(0, 0, W, H); paint();
}
view.addEventListener('pointerdown', (e) => {
  if (e.button) return; e.preventDefault(); const p = pos(e);
  if (st.tool === 'pick') return pick(p);
  if (!layers[cur].vis) return say('This layer is hidden. Show it to draw.');
  view.setPointerCapture(e.pointerId); snap(); sx.clearRect(0, 0, W, H); down = true; start = last = sp = p;
  if (!isShape()) seg(p, p); later();
});
view.addEventListener('pointermove', (e) => {
  if (!down) return; const p = pos(e);
  if (isShape()) shape(start, p); else { const k = 1 - st.smooth / 100 * .9; sp = { x: sp.x + (p.x - sp.x) * k, y: sp.y + (p.y - sp.y) * k, p: sp.p + (p.p - sp.p) * k }; seg(last, sp); last = sp; }
  later();
});
['pointerup', 'pointercancel'].forEach((n) => view.addEventListener(n, (e) => finish(pos(e))));

function buildSliders() {
  const box = $('#cp-grade');
  SLIDERS.forEach(([k, name, min, max]) => {
    const lab = document.createElement('label'), out = document.createElement('span'), inp = document.createElement('input');
    lab.className = 'tool-field'; out.className = 'range-value'; out.id = 'cp-v-' + k; out.textContent = '0';
    Object.assign(inp, { type: 'range', min, max, value: 0, id: 'cp-g-' + k });
    inp.addEventListener('input', () => { G[k] = +inp.value; out.textContent = inp.value; later(); });
    lab.append(name + ' ', out, inp); box.append(lab);
  });
  const sel = $('#cp-preset');
  Object.keys(PRESETS).forEach((n) => sel.add(new Option(n, n)));
  sel.onchange = () => { applyGrade({ ...G0, sc: '#1f6f8b', hc: '#ff9a4d', ...PRESETS[sel.value] }); say(sel.value + ' grade applied. Drawings are untouched.'); };
}
function applyGrade(v) {
  Object.assign(G, v); SLIDERS.forEach(([k]) => { $('#cp-g-' + k).value = G[k]; $('#cp-v-' + k).textContent = G[k]; });
  $('#cp-sc').value = G.sc; $('#cp-hc').value = G.hc; paint();
}
function exportPNG(graded) {
  composite(); const o = document.createElement('canvas'); o.width = W; o.height = H; const x = o.getContext('2d'); x.drawImage(comp, 0, 0);
  if (graded && gradeActive()) { const im = x.getImageData(0, 0, W, H); grade(im.data, W, H); x.putImageData(im, 0, 0); }
  o.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = (graded ? 'vault-graded' : 'vault-canvas') + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); });
}

document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
  st.tool = b.dataset.tool; document.querySelectorAll('[data-tool]').forEach((x) => x.setAttribute('aria-pressed', x === b));
}));
const bind = (id, key, num) => $(id).addEventListener('input', (e) => { st[key] = num ? +e.target.value : e.target.value; if (key === 'paper') paint(); });
bind('#cp-brush', 'brush'); bind('#cp-size', 'size', 1); bind('#cp-opacity', 'opacity', 1); bind('#cp-smooth', 'smooth', 1);
bind('#cp-color', 'color'); bind('#cp-paper', 'paper'); bind('#cp-sym', 'sym'); bind('#cp-n', 'n', 1);
$('#cp-fill').onchange = (e) => { st.fill = e.target.checked; };
$('#cp-sc').oninput = (e) => { G.sc = e.target.value; later(); };
$('#cp-hc').oninput = (e) => { G.hc = e.target.value; later(); };
['#cp-size', '#cp-opacity', '#cp-smooth', '#cp-n'].forEach((id) => $(id).addEventListener('input', (e) => { $(id + '-v').textContent = e.target.value; }));
['#1a1a1a', '#ffffff', '#faff00', '#e63946', '#ff9a4d', '#2a9d8f', '#3a86ff', '#8338ec'].forEach((c) => {
  const b = document.createElement('button'); b.type = 'button'; b.style.background = c; b.setAttribute('aria-label', 'Use colour ' + c);
  b.onclick = () => { st.color = c; $('#cp-color').value = c; }; $('#cp-swatches').append(b);
});
$('#cp-undo').onclick = () => step(undo, redo); $('#cp-redo').onclick = () => step(redo, undo);
$('#cp-clear').onclick = () => { snap(); layers[cur].x.clearRect(0, 0, W, H); paint(); say('Layer cleared. Undo brings it back.'); };
$('#cp-add').onclick = () => { if (layers.length >= 5) return say('Up to 5 layers.'); layers.push(mk()); cur = layers.length - 1; listLayers(); };
$('#cp-del').onclick = () => { if (layers.length < 2) return say('Keep at least one layer.'); layers.splice(cur, 1); cur = Math.min(cur, layers.length - 1); undo = []; redo = []; btns(); listLayers(); paint(); say('Layer deleted.'); };
$('#cp-reset-grade').onclick = () => { $('#cp-preset').value = 'Original'; applyGrade({ ...G0, sc: '#1f6f8b', hc: '#ff9a4d' }); };
$('#cp-png-g').onclick = () => exportPNG(true); $('#cp-png').onclick = () => exportPNG(false);
const cmp = $('#cp-compare'); cmp.addEventListener('pointerdown', () => { hold = true; paint(); });
['pointerup', 'pointerleave', 'pointercancel'].forEach((n) => cmp.addEventListener(n, () => { if (hold) { hold = false; paint(); } }));
$('#cp-import').onchange = (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f || !/^image\/(png|jpe?g|webp)$/.test(f.type)) return say('Choose a JPG, PNG or WebP image.');
  if (f.size > 15e6) return say('That image is over 15 MB.');
  const u = URL.createObjectURL(f), im = new Image();
  im.onload = () => { snap(); const k = Math.min(W / im.width, H / im.height), w = im.width * k, h = im.height * k; layers[cur].x.drawImage(im, (W - w) / 2, (H - h) / 2, w, h); URL.revokeObjectURL(u); paint(); say('Image placed on the current layer. Try a grade.'); };
  im.onerror = () => { URL.revokeObjectURL(u); say('Could not read that image.'); }; im.src = u;
};
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName) && document.activeElement.type !== 'range') return;
  e.preventDefault(); e.shiftKey ? step(redo, undo) : step(undo, redo);
});

layers.push(mk()); buildSliders(); listLayers(); btns(); paint();
