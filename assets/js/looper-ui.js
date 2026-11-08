// Wires the looper panel in drum-machine.html to the looper engine.
// The microphone is only requested when REC is pressed on a track.
import { createLooper } from './looper.js';
import { describeLooperState, looperMessageFor, offsetFromMilliseconds } from './looper-view.js?v=1';

const TRACKS = 4;
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
  const looper = supported ? (options.createLooper ?? createLooper)(engine, options.looperOptions) : null;
  let playing = Boolean(engine.isPlaying?.());
  let localMessage = '';

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
    [1, 2, 4].forEach(count => bars.add(new Option(count === 1 ? '1 BAR' : `${count} BARS`, String(count))));
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
      row.bars.disabled = track.barsDisabled;
      row.record.textContent = track.recordLabel;
      row.record.disabled = !track.recordEnabled;
      row.mute.disabled = !track.canMute;
      row.mute.textContent = track.muted ? 'MUTED' : 'MUTE';
      row.mute.setAttribute('aria-pressed', String(track.muted));
      row.clear.disabled = !track.canClear;
    });
    banner.textContent = localMessage || view.banner.text;
    panel.dataset.tone = localMessage ? 'error' : view.banner.tone;
    lock.textContent = view.lockText;
    offsetValue.textContent = view.offsetText;
    offset.disabled = !supported;
  }

  if (looper) {
    looper.onChange(render);
    engine.on('step', () => {
      if (!playing) {
        playing = true;
        render();
      }
    });
    engine.on('stop', () => {
      playing = false;
      render();
    });

    rows.forEach((row, index) => {
      row.record.addEventListener('click', () => {
        localMessage = '';
        const track = looper.snapshot().tracks[index];
        if (['preparing', 'count-in', 'recording'].includes(track.status)) {
          looper.cancelRecording();
          return;
        }
        looper.recordTrack(index, Number(row.bars.value)).catch(error => {
          localMessage = looperMessageFor(error) ?? '';
          render();
        });
      });
      row.mute.addEventListener('click', () => {
        localMessage = '';
        looper.setMuted(index, !looper.snapshot().tracks[index].muted);
      });
      row.clear.addEventListener('click', () => {
        localMessage = '';
        looper.clearTrack(index);
      });
    });

    offset.addEventListener('input', () => {
      looper.setLatencyOffset(offsetFromMilliseconds(offset.value));
    });

    win.addEventListener('pagehide', () => looper.dispose());
  }

  render();
  panel.hidden = false;
  return { looper };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (window.StepEngine) mountLooper(window.StepEngine);
  else document.addEventListener('stepengine:ready', () => mountLooper(window.StepEngine), { once: true });
}
