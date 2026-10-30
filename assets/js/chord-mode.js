// Chord mode engine. Plays a chord progression as a soft synth pad, scheduled on
// the drum machine's audio clock through window.StepEngine. No DOM in this file.
import { KEYS, progressionToSteps } from './chord-theory.js';
import { playChord } from './synth-voice.js';

const DEFAULTS = Object.freeze({ key: 'C', progressionId: 'I-V-vi-IV', voicing: 'triad', octave: 3, volume: 1 });
const MAX_VOLUME = 2;
const SUFFIXES = Object.freeze({
  '0,4,7': '', '0,3,7': 'm', '0,3,6': 'dim',
  '0,4,7,11': 'maj7', '0,4,7,10': '7', '0,3,7,10': 'm7', '0,3,6,10': 'm7b5'
});

/** Name a chord from its ascending MIDI notes, e.g. [57, 60, 64] -> "Am". Sharps are used for black keys. */
export function chordName(notes) {
  if (!Array.isArray(notes) || notes.length < 3 || !notes.every(Number.isFinite)) {
    throw new TypeError('chordName needs an array of at least three MIDI numbers.');
  }
  const suffix = SUFFIXES[notes.map(note => note - notes[0]).join(',')] ?? '?';
  return KEYS[((notes[0] % 12) + 12) % 12] + suffix;
}

function validate(settings) {
  if (!Number.isFinite(settings.volume) || settings.volume < 0 || settings.volume > MAX_VOLUME) {
    throw new RangeError(`volume must be between 0 and ${MAX_VOLUME}.`);
  }
  // progressionToSteps validates key, progression, octave and voicing (throws RangeError).
  return progressionToSteps(settings.key, settings.progressionId, { octave: settings.octave, voicing: settings.voicing });
}

/**
 * engine: the StepEngine interface ({ on, getAudioContext, getMasterGain }).
 * Returns a controller. Chords are scheduled only while enabled and while the loop plays.
 */
export function createChordMode(engine, initial = {}) {
  if (!engine || typeof engine.on !== 'function') throw new TypeError('createChordMode needs a StepEngine.');
  let settings = { ...DEFAULTS, ...initial };
  let plan = validate(settings);
  let enabled = false;
  let bus = null;
  let compressor = null;
  const active = new Set();
  const listeners = new Set();

  const announce = detail => listeners.forEach(listener => listener(detail));

  function ensureBus(ctx) {
    if (bus) return;
    bus = ctx.createGain();
    bus.gain.value = settings.volume;
    // A gentle limiter on the pad only, so stacked chords cannot clip. Drums are untouched.
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.25;
    bus.connect(compressor);
    compressor.connect(engine.getMasterGain());
  }

  function stopAll() {
    if (active.size) {
      const stopping = [...active];
      active.clear();
      stopping.forEach(chord => chord.stop());
    }
    announce(null);
  }

  const offStep = engine.on('step', ({ step, when, stepDuration }) => {
    if (!enabled) return;
    const notes = plan[step];
    if (!notes) return;
    const ctx = engine.getAudioContext();
    ensureBus(ctx);
    active.forEach(chord => { if (chord.endTime <= ctx.currentTime) active.delete(chord); });
    active.add(playChord(ctx, bus, notes, when, stepDuration * 4));
    announce({ index: step / 4, name: chordName(notes), when });
  });
  const offStop = engine.on('stop', stopAll);

  return {
    get settings() { return { ...settings }; },
    isEnabled: () => enabled,
    setEnabled(value) {
      const next = Boolean(value);
      if (!next && enabled) stopAll();
      enabled = next;
    },
    /** Change settings; they take effect from the next chord. Throws RangeError and changes nothing if invalid. */
    update(partial) {
      const next = { ...settings, ...partial };
      const nextPlan = validate(next);
      settings = next;
      plan = nextPlan;
      if (bus) bus.gain.setTargetAtTime(settings.volume, engine.getAudioContext().currentTime, 0.03);
    },
    /** The chords of the current progression: [{ step, name, notes }]. */
    getPlan: () => plan.flatMap((notes, step) => (notes ? [{ step, name: chordName(notes), notes }] : [])),
    /** fn({ index, name, when }) for each scheduled chord, and fn(null) when chords stop. Returns an unsubscribe function. */
    onChord(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      offStep();
      offStop();
      enabled = false;
      stopAll();
      listeners.clear();
      for (const node of [bus, compressor]) {
        try { node?.disconnect(); } catch { /* already detached */ }
      }
      bus = compressor = null;
    }
  };
}
