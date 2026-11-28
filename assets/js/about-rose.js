/* About page: a chrome rose that turns with the pointer and opens with the
   scroll.

   The two renders are never blended. A blend of two differently shaped flowers
   shows both through each other wherever the scroll stops, so the stage cuts
   once — closed bud to open bloom — with a short light bloom covering the
   change, and the scale, tilt and highlight carry the rest. */

const scene = document.querySelector('[data-rose-scene]');

if (scene) {
  const stage = scene.querySelector('[data-rose-stage]');
  const bloomText = scene.querySelector('[data-rose-live="bloom"]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');

  const state = { open: false, tiltX: 0, tiltY: 0, targetX: 0, targetY: 0, bloom: -1 };

  const clamp01 = value => (value < 0 ? 0 : value > 1 ? 1 : value);

  const progress = () => {
    const rect = scene.getBoundingClientRect();
    const travel = rect.height - stage.offsetHeight;
    if (rect.height < 10 || travel < 2) return 0;
    return clamp01(-rect.top / travel);
  };

  // A light bloom that rises into the change of frame and falls away after it,
  // so the cut reads as the flower bursting open rather than as a swap.
  const flareAt = value => {
    const rise = 0.455;
    const peak = 0.54;
    const fall = 0.585;
    if (value <= rise || value >= fall) return 0;
    return value < peak ? (value - rise) / (peak - rise) : (fall - value) / (fall - peak);
  };

  const setOpen = open => {
    if (open === state.open) return;
    state.open = open;
    scene.dataset.bloom = open ? 'open' : 'bud';
  };

  scene.dataset.bloom = 'bud';

  const tick = () => {
    requestAnimationFrame(tick);
    if (document.hidden) return;

    const scrolled = reduced.matches ? 1 : progress();
    // One change of frame, with a little hysteresis so it cannot flicker.
    if (scrolled > 0.54) setOpen(true);
    else if (scrolled < 0.46) setOpen(false);

    state.tiltX += (state.targetX - state.tiltX) * 0.08;
    state.tiltY += (state.targetY - state.tiltY) * 0.08;

    scene.style.setProperty('--rx', (state.tiltY * -4.5).toFixed(2) + 'deg');
    scene.style.setProperty('--ry', (state.tiltX * 8).toFixed(2) + 'deg');
    const flare = reduced.matches ? 0 : flareAt(scrolled);
    scene.style.setProperty('--flare', flare.toFixed(3));
    scene.style.setProperty('--zoom', (1 + 0.07 * scrolled + 0.05 * flare).toFixed(3));
    scene.style.setProperty('--lift', (scrolled * -16).toFixed(1) + 'px');
    scene.style.setProperty('--mx', (50 + state.tiltX * 55).toFixed(1) + '%');
    scene.style.setProperty('--my', (46 + state.tiltY * 55).toFixed(1) + '%');

    const bloom = Math.round(8 + 92 * scrolled);
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
