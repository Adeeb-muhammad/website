/* About page: a chrome rose that turns toward the pointer.

   The flower keeps itself moving in CSS — a slow drift, a breathing glow and a
   band of light crossing the metal — so nothing here has to drive a frame by
   frame. This only layers the pointer tilt and moves the highlight with it. */

const scene = document.querySelector('[data-rose-scene]');

if (scene) {
  const stage = scene.querySelector('[data-rose-stage]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');

  const state = { tiltX: 0, tiltY: 0, targetX: 0, targetY: 0 };

  const tick = () => {
    requestAnimationFrame(tick);
    if (document.hidden) return;

    state.tiltX += (state.targetX - state.tiltX) * 0.08;
    state.tiltY += (state.targetY - state.tiltY) * 0.08;

    scene.style.setProperty('--rx', (state.tiltY * -4.5).toFixed(2) + 'deg');
    scene.style.setProperty('--ry', (state.tiltX * 8).toFixed(2) + 'deg');
    scene.style.setProperty('--mx', (50 + state.tiltX * 55).toFixed(1) + '%');
    scene.style.setProperty('--my', (46 + state.tiltY * 55).toFixed(1) + '%');
  };

  if (fine.matches && stage) {
    stage.addEventListener('pointermove', event => {
      if (reduced.matches) return;
      const rect = stage.getBoundingClientRect();
      state.targetX = Math.max(-0.5, Math.min(0.5, (event.clientX - rect.left) / rect.width - 0.5));
      state.targetY = Math.max(-0.5, Math.min(0.5, (event.clientY - rect.top) / rect.height - 0.5));
    });
    stage.addEventListener('pointerleave', () => { state.targetX = 0; state.targetY = 0; });
  }

  reduced.addEventListener?.('change', () => { state.targetX = 0; state.targetY = 0; });
  requestAnimationFrame(tick);
}
