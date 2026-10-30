// Wires the chord panel in drum-machine.html to the chord mode engine.
import { KEYS, PROGRESSIONS } from './chord-theory.js';
import { createChordMode } from './chord-mode.js?v=1';

const byId = id => document.getElementById(id);

function start(engine) {
  const panel = byId('chord-panel');
  const toggle = byId('chord-toggle');
  const keySelect = byId('chord-key');
  const progressionSelect = byId('chord-progression');
  const voicingSelect = byId('chord-voicing');
  const volume = byId('chord-volume');
  const volumeDisplay = byId('chord-volume-display');
  const chips = byId('chord-chips');
  const status = byId('chord-status');
  if (![panel, toggle, keySelect, progressionSelect, voicingSelect, volume, volumeDisplay, chips, status].every(Boolean)) return;

  const mode = createChordMode(engine);
  KEYS.forEach(key => keySelect.add(new Option(key, key)));
  PROGRESSIONS.forEach(item => progressionSelect.add(new Option(item.label, item.id)));
  keySelect.value = mode.settings.key;
  progressionSelect.value = mode.settings.progressionId;
  voicingSelect.value = mode.settings.voicing;

  function renderChips() {
    chips.replaceChildren(...mode.getPlan().map(({ name }) => {
      const item = document.createElement('li');
      item.textContent = name;
      return item;
    }));
  }

  // Visual-only timers (the sound itself is scheduled on the audio clock, not here).
  const timers = new Set();
  function clearHighlight() {
    timers.forEach(id => window.clearTimeout(id));
    timers.clear();
    chips.querySelectorAll('[aria-current]').forEach(item => item.removeAttribute('aria-current'));
  }
  mode.onChord(event => {
    if (!event) return clearHighlight();
    const delay = Math.max(0, (event.when - engine.getAudioContext().currentTime) * 1000);
    const id = window.setTimeout(() => {
      timers.delete(id);
      chips.querySelectorAll('[aria-current]').forEach(item => item.removeAttribute('aria-current'));
      chips.children[event.index]?.setAttribute('aria-current', 'true');
    }, delay);
    timers.add(id);
  });

  function applyChange(partial) {
    try {
      mode.update(partial);
      renderChips();
    } catch (error) {
      status.textContent = 'That chord setting is not valid, so nothing changed.';
      keySelect.value = mode.settings.key;
      progressionSelect.value = mode.settings.progressionId;
      voicingSelect.value = mode.settings.voicing;
      console.error('Chord mode setting rejected.', error);
    }
  }

  toggle.addEventListener('click', () => {
    const on = !mode.isEnabled();
    mode.setEnabled(on);
    toggle.setAttribute('aria-pressed', String(on));
    toggle.textContent = on ? 'CHORDS: ON' : 'CHORDS: OFF';
    toggle.classList.toggle('button-accent', on);
    toggle.classList.toggle('button-outline', !on);
    status.textContent = !on ? 'Chords off.' : engine.isPlaying() ? 'Chords on.' : 'Chords on. Press START LOOP to hear them.';
  });
  keySelect.addEventListener('change', () => applyChange({ key: keySelect.value }));
  progressionSelect.addEventListener('change', () => applyChange({ progressionId: progressionSelect.value }));
  voicingSelect.addEventListener('change', () => applyChange({ voicing: voicingSelect.value }));
  volume.addEventListener('input', () => {
    volumeDisplay.textContent = `${volume.value}%`;
    applyChange({ volume: Number(volume.value) / 100 });
  });

  renderChips();
  panel.hidden = false;
}

if (window.StepEngine) start(window.StepEngine);
else document.addEventListener('stepengine:ready', () => start(window.StepEngine), { once: true });
