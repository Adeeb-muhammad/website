/* Original smooth reticle cursor. Native cursors return over inputs and canvases. */
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

  const setNative = (element) => {
    document.body.classList.toggle('vault-native-cursor', !!element?.closest?.(nativeSelector));
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
    setNative(event.target);
    document.body.classList.toggle('vault-cursor-hover', !!event.target?.closest?.(interactiveSelector));
    show();
  }, { passive: true });

  document.addEventListener('pointerover', (event) => setNative(event.target), { passive: true });
  document.addEventListener('pointerout', (event) => { if (!event.relatedTarget) setNative(null); }, { passive: true });
  document.addEventListener('pointerdown', () => { pressed = true; document.body.classList.add('vault-cursor-pressed'); }, { passive: true });
  document.addEventListener('pointerup', () => { pressed = false; document.body.classList.remove('vault-cursor-pressed'); }, { passive: true });
  document.addEventListener('pointercancel', () => { pressed = false; document.body.classList.remove('vault-cursor-pressed'); }, { passive: true });
  document.addEventListener('pointerleave', () => document.body.classList.add('vault-cursor-hidden'));
  document.addEventListener('pointerenter', () => { if (pressed) return; document.body.classList.remove('vault-cursor-hidden'); });
  window.addEventListener('blur', () => document.body.classList.add('vault-cursor-hidden'));
  window.addEventListener('focus', () => { if (shown) document.body.classList.remove('vault-cursor-hidden'); });

  requestAnimationFrame(render);
})();
