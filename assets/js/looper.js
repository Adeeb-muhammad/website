// Looper engine. Four tracks that record a microphone take against the beat and play it back in time with the drum
// machine. All timing comes from StepEngine step events (audio-clock times); this file starts no timers of its own.
import { fitToLoop, isLoopStart } from './loop-math.js';
import { createRecorder } from './voice-recorder.js';

const TRACK_COUNT = 4;
const STEPS_PER_BAR = 16;
const COUNT_IN_STEPS = 16; // at least one full bar of count-in before a take begins
// StepEngine events arrive up to about 100 ms before their audio time. Stopping the recorder a beat after the take ends
// guarantees the real clock has passed the end, so the lookahead can never clip the end of a take.
const STOP_MARGIN_STEPS = 4;
const MAX_LATENCY_OFFSET = 0.5;
const ALLOWED_BARS = [1, 2, 4];

function looperError(code, message) {
  return { code, message };
}

export function createLooper(engine, options = {}) {
  for (const name of ['on', 'getAudioContext', 'getMasterGain', 'getBpm', 'isPlaying']) {
    if (!engine || typeof engine[name] !== 'function') throw new TypeError(`createLooper needs a StepEngine with ${name}().`);
  }
  const makeRecorder = options.createRecorder ?? (() => createRecorder({ maxSeconds: 90 }));
  const decode = options.decode ?? (data => engine.getAudioContext().decodeAudioData(data));

  const tracks = Array.from({ length: TRACK_COUNT }, (_, index) => ({
    index, status: 'empty', bars: 1, muted: false, buffer: null, bpm: null, gain: null, sources: new Set(), message: ''
  }));
  const listeners = new Set();
  let bus = null;
  let absolute = -1; // 16th-note steps seen since the loop started, kept in step with StepEngine's 0 to 15
  let latencyOffset = 0;
  let tempoMismatch = false;
  let session = null;
  let disposed = false;

  const lockedBpm = () => tracks.find(track => track.buffer)?.bpm ?? null;
  const snapshot = () => ({
    tracks: tracks.map(({ index, status, bars, muted, buffer, message }) => ({ index, status, bars, muted, hasTake: Boolean(buffer), message })),
    lockedBpm: lockedBpm(),
    tempoMismatch,
    latencyOffset
  });
  const notify = () => { const state = snapshot(); listeners.forEach(listener => listener(state)); };
  const settledStatus = track => (track.buffer ? 'ready' : 'empty');

  function ensureBus(ctx) {
    if (bus) return;
    bus = ctx.createGain();
    bus.connect(engine.getMasterGain());
  }
  function trackGain(track, ctx) {
    if (!track.gain) {
      ensureBus(ctx);
      track.gain = ctx.createGain();
      track.gain.gain.value = track.muted ? 0 : 1;
      track.gain.connect(bus);
    }
    return track.gain;
  }
  function stopSources(track) {
    for (const source of track.sources) {
      try { source.stop(); } catch { /* already ended */ }
    }
    track.sources.clear();
  }
  function playTake(track, ctx, when) {
    const source = ctx.createBufferSource();
    source.buffer = track.buffer;
    source.connect(trackGain(track, ctx));
    track.sources.add(source);
    source.onended = () => {
      track.sources.delete(source);
      try { source.disconnect(); } catch { /* already detached */ }
    };
    source.start(when);
  }

  function abortSession(message) {
    if (!session) return;
    const aborted = session;
    session = null;
    const track = tracks[aborted.index];
    track.status = settledStatus(track);
    track.message = message;
    Promise.resolve(aborted.recorder.discard()).catch(() => {});
    notify();
  }

  async function finishRecording(active) {
    const track = tracks[active.index];
    try {
      const result = await active.recorder.stop();
      if (session !== active) return;
      const audio = await decode(await result.blob.arrayBuffer());
      if (session !== active) return;
      const ctx = engine.getAudioContext();
      const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
      // Audio before the take's first beat is dropped, then the user's latency setting is applied on top.
      const offsetSeconds = (active.takeStartTime - active.recorderStartTime) + latencyOffset;
      const fitted = fitToLoop(channels, audio.sampleRate, active.bpm, active.bars, { offsetSeconds });
      const buffer = ctx.createBuffer(fitted.length, fitted[0].length, audio.sampleRate);
      fitted.forEach((data, index) => buffer.copyToChannel(data, index));
      stopSources(track);
      track.buffer = buffer;
      track.bpm = active.bpm;
      track.bars = active.bars;
      track.status = 'ready';
      track.message = '';
      session = null;
      notify();
    } catch (error) {
      if (session !== active) return;
      session = null;
      track.status = settledStatus(track);
      track.message = error?.message || 'That take could not be processed.';
      notify();
    }
  }

  function advanceRecording(when) {
    if (!session) return;
    const active = session;
    const track = tracks[active.index];
    if (active.phase === 'count-in' && absolute >= active.captureStart) {
      active.phase = 'recording';
      active.takeStartTime = when;
      track.status = 'recording';
      notify();
    }
    if (active.phase === 'recording' && absolute >= active.captureStart + STEPS_PER_BAR * active.bars + STOP_MARGIN_STEPS) {
      active.phase = 'processing';
      track.status = 'processing';
      notify();
      finishRecording(active);
    }
  }

  const offStep = engine.on('step', ({ step, when, bpm }) => {
    absolute = absolute < 0 ? step : absolute + 1;
    absolute += ((step - (absolute % STEPS_PER_BAR)) + STEPS_PER_BAR) % STEPS_PER_BAR; // stay in line with the engine's step

    const locked = lockedBpm();
    const mismatch = locked !== null && bpm !== locked;
    if (mismatch !== tempoMismatch) {
      tempoMismatch = mismatch;
      if (mismatch) tracks.forEach(stopSources);
      notify();
    }
    if (session && bpm !== session.bpm) abortSession('The tempo changed while recording, so the take was dropped.');
    if (mismatch) return;

    const ctx = engine.getAudioContext();
    for (const track of tracks) {
      if (track.buffer && isLoopStart(absolute, track.bars)) playTake(track, ctx, when);
    }
    advanceRecording(when);
  });

  const offStop = engine.on('stop', () => {
    tracks.forEach(stopSources);
    absolute = -1;
    if (tempoMismatch) {
      tempoMismatch = false;
      notify();
    }
    abortSession('Recording stopped because the loop stopped.');
  });

  function checkIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= TRACK_COUNT) throw new RangeError(`index must be a whole number from 0 to ${TRACK_COUNT - 1}.`);
  }

  return {
    snapshot,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Arm a track. Resolves once the microphone is recording and counting in; progress arrives through onChange. */
    async recordTrack(index, bars = 1) {
      checkIndex(index);
      if (!ALLOWED_BARS.includes(bars)) throw new RangeError(`bars must be one of ${ALLOWED_BARS.join(', ')}.`);
      if (!engine.isPlaying()) throw looperError('not-playing', 'Start the loop first, then record a track.');
      if (session) throw looperError('busy', 'Another track is already recording.');
      const bpm = engine.getBpm();
      const others = tracks.filter(track => track.index !== index && track.buffer);
      if (others.length && others[0].bpm !== bpm) {
        throw looperError('tempo-locked', `The other loops were recorded at ${others[0].bpm} BPM. Set the tempo back to ${others[0].bpm}, or clear them first.`);
      }

      const track = tracks[index];
      const active = { index, bars, bpm, recorder: makeRecorder(), phase: 'preparing', recorderStartTime: 0, captureStart: 0, takeStartTime: 0 };
      session = active;
      track.status = 'preparing';
      track.message = '';
      notify();

      try {
        await active.recorder.start();
      } catch (error) {
        if (session === active) {
          session = null;
          track.status = settledStatus(track);
          track.message = error?.code === 'cancelled' || error?.code === 'discarded' ? '' : (error?.message || 'The microphone could not be started.');
          notify();
        }
        throw error;
      }
      if (session !== active) {
        Promise.resolve(active.recorder.discard()).catch(() => {});
        throw looperError('cancelled', 'Recording was cancelled.');
      }

      active.recorderStartTime = engine.getAudioContext().currentTime;
      const armedAt = Math.max(0, absolute);
      const cycle = STEPS_PER_BAR * bars;
      active.captureStart = Math.ceil((armedAt + COUNT_IN_STEPS) / cycle) * cycle; // a loop boundary, at least a bar away
      active.phase = 'count-in';
      track.status = 'count-in';
      notify();
    },

    cancelRecording() {
      abortSession('');
    },

    clearTrack(index) {
      checkIndex(index);
      if (session?.index === index) abortSession('');
      const track = tracks[index];
      stopSources(track);
      track.buffer = null;
      track.bpm = null;
      track.status = 'empty';
      track.message = '';
      if (tempoMismatch && lockedBpm() === null) tempoMismatch = false;
      notify();
    },

    clearAll() {
      if (session) abortSession('');
      tracks.forEach(track => {
        stopSources(track);
        track.buffer = null;
        track.bpm = null;
        track.status = 'empty';
        track.message = '';
      });
      tempoMismatch = false;
      notify();
    },

    setMuted(index, muted) {
      checkIndex(index);
      const track = tracks[index];
      track.muted = Boolean(muted);
      if (track.gain) track.gain.gain.setTargetAtTime(track.muted ? 0 : 1, engine.getAudioContext().currentTime, 0.01);
      notify();
    },

    /** Seconds added to the cut-out point of the next take. Positive drops more of the start, negative adds silence. */
    setLatencyOffset(seconds) {
      if (!Number.isFinite(seconds) || Math.abs(seconds) > MAX_LATENCY_OFFSET) {
        throw new RangeError(`latency offset must be a number from -${MAX_LATENCY_OFFSET} to ${MAX_LATENCY_OFFSET} seconds.`);
      }
      latencyOffset = seconds;
      notify();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      offStep();
      offStop();
      this.clearAll();
      listeners.clear();
      for (const node of [bus, ...tracks.map(track => track.gain)]) {
        try { node?.disconnect(); } catch { /* already detached */ }
      }
      bus = null;
    }
  };
}
