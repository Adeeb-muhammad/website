// Soft polyphonic pad built on Web Audio. Pure graph construction: no DOM, no
// globals, no timers. Every time value comes from the AudioContext clock.
import { midiToFrequency } from './chord-theory.js';

const DEFAULTS = Object.freeze({
  attack: 0.04,
  release: 0.35,
  level: 0.22,
  waveform: 'sawtooth',
  detune: 6,
  cutoff: 1400,
});

const WAVEFORMS = new Set(['sine', 'triangle', 'sawtooth', 'square']);
const MAX_NOTES = 8;
const MIN_ENVELOPE = 0.001;
// Oscillators outlive the envelope so the release tail is never clipped.
const STOP_TAIL = 0.05;

function finiteNumber(value, name) {
  if (typeof value !== 'number') throw new TypeError(`${name} must be a number.`);
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be a finite number.`);
  return value;
}

export function playChord(ctx, destination, midiNotes, when, duration, options = {}) {
  if (!Array.isArray(midiNotes)) throw new TypeError('midiNotes must be an array.');
  if (midiNotes.length < 1 || midiNotes.length > MAX_NOTES) {
    throw new RangeError(`midiNotes must hold between 1 and ${MAX_NOTES} notes.`);
  }
  for (const note of midiNotes) {
    if (typeof note !== 'number') throw new TypeError('Every MIDI note must be a number.');
    if (!Number.isFinite(note)) throw new RangeError('MIDI notes must be finite numbers.');
  }

  // A chord that starts in the past starts now, so the envelope is never scheduled backwards.
  const start = Math.max(finiteNumber(when, 'when'), ctx.currentTime);
  const length = finiteNumber(duration, 'duration');
  if (length <= 0) throw new RangeError('duration must be greater than zero.');

  const settings = options ?? {};
  const attack = finiteNumber(settings.attack ?? DEFAULTS.attack, 'attack');
  const release = finiteNumber(settings.release ?? DEFAULTS.release, 'release');
  const level = finiteNumber(settings.level ?? DEFAULTS.level, 'level');
  const detune = finiteNumber(settings.detune ?? DEFAULTS.detune, 'detune');
  const cutoff = finiteNumber(settings.cutoff ?? DEFAULTS.cutoff, 'cutoff');
  const waveform = settings.waveform ?? DEFAULTS.waveform;

  if (attack < MIN_ENVELOPE) throw new RangeError(`attack must be at least ${MIN_ENVELOPE} seconds.`);
  if (release < MIN_ENVELOPE) throw new RangeError(`release must be at least ${MIN_ENVELOPE} seconds.`);
  if (!(level > 0 && level <= 1)) throw new RangeError('level must be greater than 0 and at most 1.');
  if (typeof waveform !== 'string') throw new TypeError('waveform must be a string.');
  if (!WAVEFORMS.has(waveform)) throw new RangeError(`Unknown waveform: ${String(waveform)}`);

  // A shorter duration wins, so the peak can never land after the hold ends.
  const peakTime = start + Math.min(attack, length);
  const holdEnd = start + length;
  const naturalEnd = holdEnd + release;

  const envelope = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;

  envelope.gain.setValueAtTime(0, start);
  envelope.gain.linearRampToValueAtTime(level, peakTime);
  envelope.gain.setValueAtTime(level, holdEnd);
  envelope.gain.linearRampToValueAtTime(0, naturalEnd);

  const voiceLevel = 1 / (2 * midiNotes.length);
  const oscillators = [];
  const nodes = [envelope, filter];

  for (const midi of midiNotes) {
    const frequency = midiToFrequency(midi);
    for (const cents of [detune, -detune]) {
      const oscillator = ctx.createOscillator();
      oscillator.type = waveform;
      oscillator.frequency.value = frequency;
      oscillator.detune.value = cents;

      const voice = ctx.createGain();
      voice.gain.value = voiceLevel;

      oscillator.connect(voice);
      voice.connect(envelope);
      oscillator.start(start);
      oscillator.stop(naturalEnd + STOP_TAIL);

      oscillators.push(oscillator);
      nodes.push(oscillator, voice);
    }
  }

  envelope.connect(filter);
  filter.connect(destination);

  let stopIssued = false;
  let finished = false;

  // Value of the scheduled envelope at a point in time, used to ramp down
  // smoothly when the chord is cut short.
  const valueAt = time => {
    if (time <= start) return 0;
    if (time < peakTime) return level * ((time - start) / (peakTime - start));
    if (time <= holdEnd) return level;
    if (time >= naturalEnd) return 0;
    return level * (1 - (time - holdEnd) / release);
  };

  const chord = {
    endTime: naturalEnd,
    stop(at = ctx.currentTime) {
      if (stopIssued || finished) return;
      const requested = finiteNumber(at, 'stop time');
      // Already in (or past) the natural release: it is fading out on its own,
      // and stopping now would only stretch the tail past its natural end.
      if (ctx.currentTime >= chord.endTime || requested >= holdEnd) return;

      stopIssued = true;
      const from = Math.max(requested, start);
      envelope.gain.cancelScheduledValues(from);
      // Ramp (not jump) to the envelope value at `from`, so a stop scheduled for
      // later keeps following the original attack or release curve until then.
      envelope.gain.linearRampToValueAtTime(valueAt(from), from);
      envelope.gain.linearRampToValueAtTime(0, from + release);
      chord.endTime = from + release;
      for (const oscillator of oscillators) oscillator.stop(chord.endTime + STOP_TAIL);
    },
  };

  let endedCount = 0;
  let disconnected = false;
  for (const oscillator of oscillators) {
    oscillator.onended = () => {
      endedCount += 1;
      if (endedCount !== oscillators.length) return;
      finished = true;
      if (disconnected) return;
      disconnected = true;
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch {
          // A node that is already detached is not an error.
        }
      }
    };
  }

  return chord;
}
