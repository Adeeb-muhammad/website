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
  intervalId: null,
  audioContext: null,
  noiseBuffer: null
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
  if (state.isPlaying) {
    clearInterval(state.intervalId);
    state.intervalId = setInterval(() => advanceStep(), (60 / state.bpm) * 1000 / 4);
  }
}

function updateStepState() {
  document.querySelectorAll('.step').forEach((button) => {
    const track = button.dataset.track;
    const step = Number(button.dataset.step);
    const active = tracks.find((entry) => entry.id === track)?.pattern[step];
    button.classList.toggle('active', Boolean(active));
    button.setAttribute('aria-pressed', String(Boolean(active)));
    button.classList.toggle('playing', Number(button.dataset.step) === state.currentStep && state.isPlaying);
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

function triggerKick() {
  const audioContext = getAudioContext();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(58, now);
  oscillator.frequency.exponentialRampToValueAtTime(34, now + 0.12);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.75, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.2);
}

function triggerSnare() {
  const audioContext = getAudioContext();
  const noiseBuffer = state.noiseBuffer || (state.noiseBuffer = createNoiseBuffer());
  const source = audioContext.createBufferSource();
  const filter = audioContext.createBiquadFilter();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;

  source.buffer = noiseBuffer;
  filter.type = 'highpass';
  filter.frequency.value = 1800;

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.44, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(audioContext.destination);
  source.start(now);
  source.stop(now + 0.12);
}

function triggerHiHat() {
  const audioContext = getAudioContext();
  const noiseBuffer = state.noiseBuffer || (state.noiseBuffer = createNoiseBuffer());
  const source = audioContext.createBufferSource();
  const filter = audioContext.createBiquadFilter();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;

  source.buffer = noiseBuffer;
  filter.type = 'highpass';
  filter.frequency.value = 7000;

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(audioContext.destination);
  source.start(now);
  source.stop(now + 0.08);
}

function triggerClap() {
  const audioContext = getAudioContext();
  const noiseBuffer = state.noiseBuffer || (state.noiseBuffer = createNoiseBuffer());
  [0, 0.02, 0.04].forEach((offset) => {
    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime + offset;

    source.buffer = noiseBuffer;
    filter.type = 'bandpass';
    filter.frequency.value = 1800;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);
    source.start(now);
    source.stop(now + 0.09);
  });
}

function triggerTrack(trackId) {
  switch (trackId) {
    case 'kick':
      triggerKick();
      break;
    case 'snare':
      triggerSnare();
      break;
    case 'hihat':
      triggerHiHat();
      break;
    case 'clap':
      triggerClap();
      break;
    default:
      break;
  }
}

function advanceStep() {
  const activeTrackIds = tracks.filter((track) => track.pattern[state.currentStep]).map((track) => track.id);
  activeTrackIds.forEach((trackId) => triggerTrack(trackId));

  document.querySelectorAll('.step').forEach((button) => {
    const matchesStep = Number(button.dataset.step) === state.currentStep;
    button.classList.toggle('playing', state.isPlaying && matchesStep);
  });

  state.currentStep = (state.currentStep + 1) % 16;
}

function startLoop() {
  const audioContext = getAudioContext();
  if (audioContext.state === 'suspended') audioContext.resume();
  state.isPlaying = true;
  playToggle.textContent = 'STOP LOOP ×';
  state.intervalId = setInterval(() => advanceStep(), (60 / state.bpm) * 1000 / 4);
  advanceStep();
}

function stopLoop() {
  state.isPlaying = false;
  playToggle.textContent = 'START LOOP ↗';
  clearInterval(state.intervalId);
  state.intervalId = null;
  updateStepState();
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

randomizeButton.addEventListener('click', () => {
  randomizePattern();
  if (state.isPlaying) {
    clearInterval(state.intervalId);
    state.intervalId = setInterval(() => advanceStep(), (60 / state.bpm) * 1000 / 4);
  }
});

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

buildSequencer();
updateTempo();
