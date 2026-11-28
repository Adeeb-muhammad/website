/* About page: a chrome rose that turns with the pointer and opens with the
   scroll. The two frames are photographs, so nothing here is required for the
   scene to show; this only adds the motion. */

const scene = document.querySelector('[data-rose-scene]');

if (scene) {
  const stage = scene.querySelector('[data-rose-stage]');
  const bloomText = scene.querySelector('[data-rose-live="bloom"]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');

  const state = { open: 0, tiltX: 0, tiltY: 0, targetX: 0, targetY: 0, bloom: -1 };

  const clamp01 = value => (value < 0 ? 0 : value > 1 ? 1 : value);
  const between = (from, to, value) => {
    const eased = clamp01((value - from) / (to - from));
    return eased * eased * (3 - 2 * eased);
  };

  const progress = () => {
    const rect = scene.getBoundingClientRect();
    const travel = rect.height - stage.offsetHeight;
    if (rect.height < 10 || travel < 2) return 0;
    return clamp01(-rect.top / travel);
  };

  const tick = () => {
    requestAnimationFrame(tick);
    if (document.hidden) return;

    const scrolled = reduced.matches ? 1 : progress();
    // Without motion the scene rests on the open bloom, not a blend of frames.
    const target = reduced.matches ? 1 : between(0.22, 0.78, scrolled);
    state.open += (target - state.open) * (reduced.matches ? 1 : 0.12);
    state.tiltX += (state.targetX - state.tiltX) * 0.08;
    state.tiltY += (state.targetY - state.tiltY) * 0.08;

    scene.style.setProperty('--open', state.open.toFixed(3));
    scene.style.setProperty('--rx', (state.tiltY * -4.5).toFixed(2) + 'deg');
    scene.style.setProperty('--ry', (state.tiltX * 8).toFixed(2) + 'deg');
    scene.style.setProperty('--zoom', (1 + 0.08 * scrolled).toFixed(3));
    scene.style.setProperty('--lift', (scrolled * -16).toFixed(1) + 'px');
    scene.style.setProperty('--mx', (50 + state.tiltX * 55).toFixed(1) + '%');
    scene.style.setProperty('--my', (46 + state.tiltY * 55).toFixed(1) + '%');

    const bloom = Math.round((0.08 + 0.92 * state.open) * 100);
    if (bloom !== state.bloom && bloomText) {
      state.bloom = bloom;
      bloomText.textContent = String(bloom).padStart(2, '0');
    }
  };

  if (fine.matches) {
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
