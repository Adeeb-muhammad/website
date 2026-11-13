// Wires the looper panel in drum-machine.html to the looper engine.
// The microphone is only requested when REC is pressed on a track.
import { createLooper } from './looper.js?v=3';
import { describeLooperState, looperMessageFor, offsetFromMilliseconds } from './looper-view.js?v=1';

const TRACKS = 4;
const BUSY_STATUSES = new Set(['preparing', 'count-in', 'recording', 'processing']);
const EMPTY_SNAPSHOT = Object.freeze({
  tracks: Array.from({ length: TRACKS }, (_, index) => ({ index, status: 'empty', bars: 1, muted: false, hasTake: false, message: '' })),
  lockedBpm: null, tempoMismatch: false, latencyOffset: 0
});

export function mountLooper(engine, options = {}) {
  const doc = options.doc ?? document;
  const nav = options.nav ?? (typeof navigator === 'undefined' ? null : navigator);
  const hasMediaRecorder = options.hasMediaRecorder ?? typeof MediaRecorder !== 'undefined';
  const hasAudioContext = options.hasAudioContext ?? (typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined');
  const win = options.win ?? window;
  const byId = id => doc.getElementById(id);

  const panel = byId('looper-panel');
  const list = byId('looper-tracks');
  const banner = byId('looper-status');
  const lock = byId('looper-lock');
  const offset = byId('looper-offset');
  const offsetValue = byId('looper-offset-value');
  if (![panel, list, banner, lock, offset, offsetValue].every(Boolean) || !engine) return null;

  const supported = Boolean(nav?.mediaDevices?.getUserMedia) && hasMediaRecorder && hasAudioContext;
  const makeLooper = options.createLooper ?? createLooper;
  let looper = null;
  let looperOffChange = null;
  let engineUnsubscribers = [];
  let playing = Boolean(engine.isPlaying?.());
  let localMessage = '';
  let pagehideHadTakes = false;

  function element(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const rows = Array.from({ length: TRACKS }, (_, index) => {
    const item = element('li', 'looper-row');
    const name = element('span', 'looper-name', `TRACK ${index + 1}`);
    const status = element('span', 'looper-status-label', 'EMPTY');
    const bars = element('select', 'looper-bars');
    bars.setAttribute('aria-label', `Track ${index + 1} length for the next recording`);
    [1, 2, 4].forEach(count => {
      const option = element('option', '', count === 1 ? '1 BAR' : `${count} BARS`);
      option.value = String(count);
      bars.add(option);
    });
    const record = element('button', 'button button-accent', '● REC');
    const mute = element('button', 'button button-outline', 'MUTE');
    const clear = element('button', 'button button-outline', 'CLEAR');
    for (const button of [record, mute, clear]) button.type = 'button';
    record.setAttribute('aria-label', `Record track ${index + 1}`);
    mute.setAttribute('aria-label', `Mute track ${index + 1}`);
    clear.setAttribute('aria-label', `Clear track ${index + 1}`);
    item.append(name, status, bars, record, mute, clear);
    list.append(item);
    return { item, status, bars, record, mute, clear };
  });

  function render() {
    const snapshot = looper ? looper.snapshot() : EMPTY_SNAPSHOT;
    const view = describeLooperState({ snapshot, playing, supported });
    view.tracks.forEach((track, index) => {
      const row = rows[index];
      row.status.textContent = track.statusLabel + (snapshot.tracks[index].hasTake ? ` · ${track.bars} ${track.bars === 1 ? 'BAR' : 'BARS'}` : '');
      row.item.dataset.tone = track.tone;
      row.bars.disabled = track.barsDisabled || !looper;
      row.record.textContent = track.recordLabel;
      row.record.disabled = !looper || !track.recordEnabled;
      row.mute.disabled = !looper || !track.canMute;
      row.mute.textContent = track.muted ? 'MUTED' : 'MUTE';
      row.mute.setAttribute('aria-pressed', String(track.muted));
      row.clear.disabled = !looper || !track.canClear;
    });
    banner.textContent = localMessage || view.banner.text;
    panel.dataset.tone = localMessage ? 'error' : view.banner.tone;
    lock.textContent = view.lockText;
    offsetValue.textContent = view.offsetText;
    offset.disabled = !supported || !looper;
  }

  function createLooperSession() {
    if (!supported || looper) return;
    looper = makeLooper(engine, options.looperOptions);
    if (!looper) {
      render();
      return;
    }

    playing = Boolean(engine.isPlaying?.());
    looper.setLatencyOffset(offsetFromMilliseconds(offset.value));
    const offChange = looper.onChange(render);
    looperOffChange = typeof offChange === 'function' ? offChange : null;

    const offStep = engine.on('step', () => {
      if (!playing) {
        playing = true;
        render();
      }
    });
    const offStop = engine.on('stop', () => {
      playing = false;
      render();
    });
    engineUnsubscribers = [offStep, offStop].filter(unsubscribe => typeof unsubscribe === 'function');
    render();
  }

  function disposeLooperSession() {
    if (!looper) return false;

    const current = looper;
    const snapshot = current.snapshot();
    const takesWillBeLost = snapshot.tracks.some(track => track.hasTake || BUSY_STATUSES.has(track.status));

    // Clear the live reference before disposing so repeated pagehide events cannot dispose twice,
    // and event handlers cannot act on an instance that is already being torn down.
    looper = null;
    const offChange = looperOffChange;
    looperOffChange = null;
    offChange?.();
    for (const unsubscribe of engineUnsubscribers.splice(0)) unsubscribe();

    current.dispose();
    render();
    return takesWillBeLost;
  }

  rows.forEach((row, index) => {
    row.record.addEventListener('click', () => {
      const activeLooper = looper;
      if (!activeLooper) return;
      localMessage = '';
      const track = activeLooper.snapshot().tracks[index];
      if (BUSY_STATUSES.has(track.status) && track.status !== 'processing') {
        activeLooper.cancelRecording();
        return;
      }
      activeLooper.recordTrack(index, Number(row.bars.value)).catch(error => {
        if (looper !== activeLooper) return;
        localMessage = looperMessageFor(error) ?? '';
        render();
      });
    });
    row.mute.addEventListener('click', () => {
      const activeLooper = looper;
      if (!activeLooper) return;
      localMessage = '';
      activeLooper.setMuted(index, !activeLooper.snapshot().tracks[index].muted);
    });
    row.clear.addEventListener('click', () => {
      const activeLooper = looper;
      if (!activeLooper) return;
      localMessage = '';
      activeLooper.clearTrack(index);
    });
  });

  offset.addEventListener('input', () => {
    if (!looper) return;
    looper.setLatencyOffset(offsetFromMilliseconds(offset.value));
  });

  win.addEventListener('pagehide', () => {
    pagehideHadTakes = disposeLooperSession() || pagehideHadTakes;
  });
  win.addEventListener('pageshow', event => {
    if (!event?.persisted) return;
    localMessage = pagehideHadTakes
      ? 'Your recorded takes were lost when this page was suspended. Record them again after restoring the page.'
      : '';
    pagehideHadTakes = false;
    createLooperSession();
    render();
  });

  createLooperSession();
  render();
  panel.hidden = false;
  return { get looper() { return looper; } };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (window.StepEngine) mountLooper(window.StepEngine);
  else document.addEventListener('stepengine:ready', () => mountLooper(window.StepEngine), { once: true });
}
