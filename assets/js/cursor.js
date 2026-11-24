/* Original smooth reticle cursor. Native cursors return over prose, inputs and canvases. */
(() => {
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  if (!finePointer.matches || reducedMotion.matches) return;

  const dot = document.createElement('div');
  const ring = document.createElement('div');
  dot.className = 'vault-cursor-dot';
  ring.className = 'vault-cursor-ring';
  dot.setAttribute('aria-hidden', 'true');
  ring.setAttribute('aria-hidden', 'true');
  document.body.append(dot, ring);
  document.body.classList.add('vault-cursor-hidden');

  let targetX = -100, targetY = -100, dotX = -100, dotY = -100, ringX = -100, ringY = -100;
  let shown = false;
  let pressed = false;

  const nativeSelector = 'canvas, input, textarea, select, [contenteditable="true"], [data-native-cursor]';
  const interactiveSelector = 'a, button, summary, [role="button"], [role="link"], label';
  const textSelector = 'p, li, blockquote, dd, dt, figcaption, td, th, time, h1, h2, h3, h4, h5, h6';

  // An interactive ancestor wins over the text inside it, so a paragraph or heading
  // wrapped in a card link keeps the pointer cursor instead of the selection caret.
  let state = '';
  const setState = (element) => {
    const target = element && typeof element.closest === 'function' ? element : null;
    let next = '';
    if (target && target.closest(nativeSelector)) next = 'native';
    else if (target && target.closest(interactiveSelector)) next = 'interactive';
    else if (target && target.closest(textSelector)) next = 'text';
    if (next === state) return;
    state = next;
    document.body.classList.toggle('vault-native-cursor', next === 'native');
    document.body.classList.toggle('vault-text-cursor', next === 'text');
    document.body.classList.toggle('vault-cursor-hover', next === 'interactive');
  };

  const render = () => {
    dotX += (targetX - dotX) * 0.72;
    dotY += (targetY - dotY) * 0.72;
    ringX += (targetX - ringX) * 0.2;
    ringY += (targetY - ringY) * 0.2;
    dot.style.transform = `translate3d(${dotX}px, ${dotY}px, 0) translate(-50%, -50%)`;
    ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) translate(-50%, -50%)`;
    requestAnimationFrame(render);
  };

  const show = () => {
    if (shown) return;
    shown = true;
    document.body.classList.add('vault-cursor-ready');
    document.body.classList.remove('vault-cursor-hidden');
  };

  document.addEventListener('pointermove', (event) => {
    if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    targetX = event.clientX;
    targetY = event.clientY;
    setState(event.target);
    show();
  }, { passive: true });

  document.addEventListener('pointerover', (event) => setState(event.target), { passive: true });
  document.addEventListener('pointerout', (event) => { if (!event.relatedTarget) setState(null); }, { passive: true });
  document.addEventListener('pointerdown', () => { pressed = true; document.body.classList.add('vault-cursor-pressed'); }, { passive: true });
  document.addEventListener('pointerup', () => { pressed = false; document.body.classList.remove('vault-cursor-pressed'); }, { passive: true });
  document.addEventListener('pointercancel', () => { pressed = false; document.body.classList.remove('vault-cursor-pressed'); }, { passive: true });
  document.addEventListener('pointerleave', () => document.body.classList.add('vault-cursor-hidden'));
  document.addEventListener('pointerenter', () => { if (pressed) return; document.body.classList.remove('vault-cursor-hidden'); });
  window.addEventListener('blur', () => document.body.classList.add('vault-cursor-hidden'));
  window.addEventListener('focus', () => { if (shown) document.body.classList.remove('vault-cursor-hidden'); });

  requestAnimationFrame(render);
})();
