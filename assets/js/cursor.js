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

  const DOT_EASE = 0.72;
  const RING_EASE = 0.2;
  // Below a tenth of a pixel the eased tail is invisible, so the loop can stop there.
  const SETTLE = 0.1;

  let targetX = -100, targetY = -100, dotX = -100, dotY = -100, ringX = -100, ringY = -100;
  // The target the pointer last settled on; equal targets mean nothing to animate.
  let restX = NaN, restY = NaN;
  // Pending requestAnimationFrame id, or 0 while the loop is idle.
  let frame = 0;
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

  const paint = () => {
    dot.style.transform = `translate3d(${dotX}px, ${dotY}px, 0) translate(-50%, -50%)`;
    ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) translate(-50%, -50%)`;
  };

  // A frame is only ever scheduled by a new pointer position, and the loop
  // stops itself as soon as both elements sit on that target.
  const render = () => {
    dotX += (targetX - dotX) * DOT_EASE;
    dotY += (targetY - dotY) * DOT_EASE;
    ringX += (targetX - ringX) * RING_EASE;
    ringY += (targetY - ringY) * RING_EASE;
    const dotSettled = Math.abs(targetX - dotX) < SETTLE && Math.abs(targetY - dotY) < SETTLE;
    const ringSettled = Math.abs(targetX - ringX) < SETTLE && Math.abs(targetY - ringY) < SETTLE;
    // Land exactly on the target so a stopped loop never leaves a fractional offset.
    if (dotSettled) { dotX = targetX; dotY = targetY; }
    if (ringSettled) { ringX = targetX; ringY = targetY; }
    paint();
    if (dotSettled && ringSettled) {
      restX = targetX;
      restY = targetY;
      frame = 0;
      return;
    }
    frame = requestAnimationFrame(render);
  };

  // One loop at a time, and none while the pointer has not moved since it rested.
  const start = () => {
    if (frame || reducedMotion.matches) return;
    if (targetX === restX && targetY === restY) return;
    frame = requestAnimationFrame(render);
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
    start();
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

  // Turning reduced motion on mid-visit parks the loop; CSS hides the elements.
  reducedMotion.addEventListener('change', () => {
    if (!reducedMotion.matches) return;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  });
})();
