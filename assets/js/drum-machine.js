import { createMasterLimiter } from './master-limiter.js?v=1';

const tracks = [
  { id: 'kick', name: 'Kick', pattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1] },
  { id: 'snare', name: 'Snare', pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0] },
  { id: 'hihat', name: 'Hi-Hat', pattern: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0] },
  { id: 'clap', name: 'Clap', pattern: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0] }
];

const state = {
  bpm: 110,
  currentStep: 0,
  isPlaying: false,
  schedulerId: null,
  audioContext: null,
  noiseBuffer: null,
  masterGain: null,
  masterLimiter: null,
  nextNoteTime: 0,
  displayedStep: -1,
  visualTimers: new Set(),
  scheduledSources: new Map()
};

const sequencer = document.getElementById('sequencer');
const playToggle = document.getElementById('play-toggle');
const tempoSlider = document.getElementById('tempo-slider');
const tempoDisplay = document.getElementById('tempo-display');
const randomizeButton = document.getElementById('randomize');
const resetButton = document.getElementById('reset-pattern');
const copyrightYear = document.getElementById('copyright-year');
if (copyrightYear) copyrightYear.textContent = new Date().getFullYear();

function getAudioContext() {
  if (!state.audioContext) state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  return state.audioContext;
}

// Shared master bus. New modules (chords, voice, looper) connect here so the
// final-stage limiter protects the complete mix without changing voice levels.
function getMasterGain() {
  const audioContext = getAudioContext();
  if (!state.masterGain) {
    const masterGain = audioContext.createGain();
    const masterLimiter = createMasterLimiter(audioContext);
    masterGain.gain.value = 1;
    masterGain.connect(masterLimiter);
    masterLimiter.connect(audioContext.destination);
    state.masterGain = masterGain;
    state.masterLimiter = masterLimiter;
  }
  return state.masterGain;
}

const listeners = { step: new Set(), stop: new Set() };

function emit(type, detail) {
  listeners[type].forEach((listener) => {
    try {
      listener(detail);
    } catch (error) {
      // A faulty listener must never break the scheduler.
      console.error('StepEngine listener failed.', error);
    }
  });
}

function trackScheduledSource(source, startAt) {
  state.scheduledSources.set(source, startAt);
  source.onended = () => state.scheduledSources.delete(source);
}

function buildSequencer() {
  const rows = tracks.map((track) => {
    const steps = Array.from({ length: 16 }, (_, index) => {
      const active = track.pattern[index] ? 'active' : '';
      return `<button type="button" class="step ${active}" data-track="${track.id}" data-step="${index}" aria-label="${track.name} step ${index + 1}" aria-pressed="${Boolean(track.pattern[index])}"></button>`;
    }).join('');
    return `<div class="track-row"><span class="track-name">${track.name}</span>${steps}</div>`;
  }).join('');

  sequencer.innerHTML = rows;
  updateStepState();
}

function updateTempo() {
  tempoDisplay.textContent = `${state.bpm} BPM`;
  tempoSlider.value = String(state.bpm);
}

function updateStepState() {
  document.querySelectorAll('.step').forEach((button) => {
    const track = button.dataset.track;
    const step = Number(button.dataset.step);
    const active = tracks.find((entry) => entry.id === track)?.pattern[step];
    button.classList.toggle('active', Boolean(active));
    button.setAttribute('aria-pressed', String(Boolean(active)));
    button.classList.toggle('playing', Number(button.dataset.step) === state.displayedStep && state.isPlaying);
  });
}

function toggleStep(trackId, stepIndex) {
  const track = tracks.find((entry) => entry.id === trackId);
  if (!track) return;
  track.pattern[stepIndex] = track.pattern[stepIndex] ? 0 : 1;
  updateStepState();
}

function randomizePattern() {
  tracks.forEach((track) => {
    track.pattern = Array.from({ length: 16 }, () => (Math.random() < (track.id === 'hihat' ? 0.65 : 0.35) ? 1 : 0));
    if (track.id === 'kick' || track.id === 'snare') {
      track.pattern = track.pattern.map((step, index) => (index % 4 === 0 && track.id === 'kick' ? 1 : step));
      track.pattern = track.pattern.map((step, index) => (index % 4 === 2 && track.id === 'snare' ? 1 : step));
    }
  });
  buildSequencer();
}

function createNoiseBuffer() {
  const audioContext = getAudioContext();
  const frameCount = audioContext.sampleRate * 0.2;
  const buffer = audioContext.createBuffer(1, frameCount, audioContext.sampleRate);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i += 1) channelData[i] = Math.random() * 2 - 1;
  return buffer;
}

function triggerKick(when) {
  const audioContext = getAudioContext();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const now = Number.isFinite(when) ? when : audioContext.currentTime;

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(58, now);
  oscillator.frequency.exponentialRampToValueAtTime(34, now + 0.12);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.75, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

  oscillator.connect(gain);
  gain.connect(getMasterGain());
  trackScheduledSource(oscillator, now);
  oscillator.start(now);
  oscillator.stop(now + 0.2);
}

function triggerSnare(when) {
  const audioContext = getAudioContext();
  const noiseBuffer = state.noiseBuffer || (state.noiseBuffer = createNoiseBuffer());
  const source = audioContext.createBufferSource();
  const filter = audioContext.createBiquadFilter();
  const gain = audioContext.createGain();
  const now = Number.isFinite(when) ? when : audioContext.currentTime;

  source.buffer = noiseBuffer;
  filter.type = 'highpass';
  filter.frequency.value = 1800;

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.44, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(getMasterGain());
  trackScheduledSource(source, now);
  source.start(now);
  source.stop(now + 0.12);
}

function triggerHiHat(when) {
  const audioContext = getAudioContext();
  const noiseBuffer = state.noiseBuffer || (state.noiseBuffer = createNoiseBuffer());
  const source = audioContext.createBufferSource();
  const filter = audioContext.createBiquadFilter();
  const gain = audioContext.createGain();
  const now = Number.isFinite(when) ? when : audioContext.currentTime;

  source.buffer = noiseBuffer;
  filter.type = 'highpass';
  filter.frequency.value = 7000;

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(getMasterGain());
  trackScheduledSource(source, now);
  source.start(now);
  source.stop(now + 0.08);
}

function triggerClap(when) {
  const audioContext = getAudioContext();
  const noiseBuffer = state.noiseBuffer || (state.noiseBuffer = createNoiseBuffer());
  [0, 0.02, 0.04].forEach((offset) => {
    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();
    const now = (Number.isFinite(when) ? when : audioContext.currentTime) + offset;

    source.buffer = noiseBuffer;
    filter.type = 'bandpass';
    filter.frequency.value = 1800;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(getMasterGain());
    trackScheduledSource(source, now);
    source.start(now);
    source.stop(now + 0.09);
  });
}

function triggerTrack(trackId, when) {
  switch (trackId) {
    case 'kick':
      triggerKick(when);
      break;
    case 'snare':
      triggerSnare(when);
      break;
    case 'hihat':
      triggerHiHat(when);
      break;
    case 'clap':
      triggerClap(when);
      break;
    default:
      break;
  }
}

function scheduleVisualStep(step, when) {
  const audioContext = getAudioContext();
  const delay = Math.max(0, (when - audioContext.currentTime) * 1000);
  let timerId;

  timerId = window.setTimeout(() => {
    state.visualTimers.delete(timerId);
    if (!state.isPlaying) return;
    state.displayedStep = step;
    updateStepState();
  }, delay);

  state.visualTimers.add(timerId);
}

function scheduleNextStep() {
  const audioContext = getAudioContext();
  const step = state.currentStep;
  const when = Math.max(state.nextNoteTime, audioContext.currentTime + 0.005);

  tracks
    .filter((track) => track.pattern[step])
    .forEach((track) => triggerTrack(track.id, when));

  scheduleVisualStep(step, when);
  emit('step', { step, when, bpm: state.bpm, stepDuration: 60 / state.bpm / 4 });
  state.nextNoteTime = when + (60 / state.bpm) / 4;
  state.currentStep = (step + 1) % 16;
}

function scheduleAhead() {
  if (!state.isPlaying) return;
  const audioContext = getAudioContext();

  // Recover gracefully if the browser throttles timers for a while.
  if (state.nextNoteTime < audioContext.currentTime - 0.2) {
    state.nextNoteTime = audioContext.currentTime + 0.02;
  }

  const scheduleAheadTime = 0.1;
  while (state.nextNoteTime < audioContext.currentTime + scheduleAheadTime) {
    scheduleNextStep();
  }
}

async function startLoop() {
  if (state.isPlaying) return;

  const audioContext = getAudioContext();
  state.isPlaying = true;
  playToggle.textContent = 'STOP LOOP ×';

  try {
    if (audioContext.state === 'suspended') await audioContext.resume();
  } catch (error) {
    stopLoop();
    console.error('Unable to start the drum machine audio context.', error);
    return;
  }

  // The loop may have been stopped while the audio context was resuming.
  if (!state.isPlaying) return;

  state.currentStep = 0;
  state.displayedStep = -1;
  state.nextNoteTime = audioContext.currentTime + 0.05;
  state.schedulerId = window.setInterval(scheduleAhead, 25);
  scheduleAhead();
}

function stopLoop() {
  state.isPlaying = false;
  playToggle.textContent = 'START LOOP ↗';

  if (state.schedulerId !== null) window.clearInterval(state.schedulerId);
  state.schedulerId = null;

  // Cancel notes that were scheduled in the future, but let any hit already
  // playing finish naturally.
  if (state.audioContext) {
    for (const [source, startAt] of state.scheduledSources) {
      if (startAt > state.audioContext.currentTime + 0.002) {
        try {
          source.stop();
        } catch {
          // A source may have ended between the check and stop call.
        }
      }
    }
  }

  state.visualTimers.forEach((timerId) => window.clearTimeout(timerId));
  state.visualTimers.clear();
  state.displayedStep = -1;
  updateStepState();
  emit('stop');
}

function resetPattern() {
  // Reset means clear the pattern: leave every step unselected.
  stopLoop();

  tracks.forEach((track) => {
    track.pattern = Array(16).fill(0);
  });

  state.currentStep = 0;
  buildSequencer();
}

playToggle.addEventListener('click', () => {
  if (state.isPlaying) stopLoop(); else startLoop();
});

randomizeButton.addEventListener('click', randomizePattern);

resetButton.addEventListener('click', resetPattern);

tempoSlider.addEventListener('input', (event) => {
  state.bpm = Number(event.target.value);
  updateTempo();
});

sequencer.addEventListener('click', (event) => {
  const button = event.target.closest('.step');
  if (!button) return;
  toggleStep(button.dataset.track, Number(button.dataset.step));
});

// Public timing interface for other modules. 'step' fires for every scheduled
// step with { step, when (audio-clock seconds), bpm, stepDuration }; 'stop'
// fires when playback stops so modules can cancel anything they scheduled.
window.StepEngine = Object.freeze({
  getAudioContext,
  getMasterGain,
  getBpm: () => state.bpm,
  isPlaying: () => state.isPlaying,
  on(type, listener) {
    if (!listeners[type] || typeof listener !== 'function') throw new TypeError('StepEngine.on(type, listener): type must be "step" or "stop".');
    listeners[type].add(listener);
    return () => listeners[type].delete(listener);
  }
});
document.dispatchEvent(new CustomEvent('stepengine:ready'));

buildSequencer();
updateTempo();
