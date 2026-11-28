/* Progressive 3D tilt for the About rose specimen. */
const rose = document.querySelector('.about-rose');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');

if (rose) {
  const stage = rose.querySelector('.about-rose-stage');
  let lastEvent = null;
  let frame = 0;

  const apply = () => {
    frame = 0;
    if (!lastEvent || reduced.matches || !finePointer.matches) return;
    const rect = rose.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(-0.5, Math.min(0.5, (lastEvent.clientX - rect.left) / rect.width - 0.5));
    const y = Math.max(-0.5, Math.min(0.5, (lastEvent.clientY - rect.top) / rect.height - 0.5));
    stage.style.setProperty('--rose-ry', `${(x * 9).toFixed(2)}deg`);
    stage.style.setProperty('--rose-rx', `${(-y * 7).toFixed(2)}deg`);
  };

  const queue = (event) => {
    lastEvent = event;
    if (!frame) frame = requestAnimationFrame(apply);
  };

  const reset = () => {
    lastEvent = null;
    cancelAnimationFrame(frame);
    frame = 0;
    stage.style.removeProperty('--rose-rx');
    stage.style.removeProperty('--rose-ry');
  };

  rose.addEventListener('pointermove', queue);
  rose.addEventListener('pointerleave', reset);
  reduced.addEventListener?.('change', reset);
  finePointer.addEventListener?.('change', reset);
}
