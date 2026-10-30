// Diatonic chord and progression helpers. Pure logic: no DOM, no Web Audio, no storage.

export const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Scale degrees in semitones from the tonic.
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10], // natural minor
};

// A voicing names how many stacked thirds the chord contains.
const VOICINGS = { triad: 3, seventh: 4 };

export const PROGRESSIONS = [
  { id: 'I-V-vi-IV', label: 'I–V–vi–IV', mode: 'major', degrees: [1, 5, 6, 4] },
  { id: 'vi-IV-I-V', label: 'vi–IV–I–V', mode: 'major', degrees: [6, 4, 1, 5] },
  { id: 'I-vi-IV-V', label: 'I–vi–IV–V', mode: 'major', degrees: [1, 6, 4, 5] },
  { id: 'i-VI-III-VII', label: 'i–VI–III–VII', mode: 'minor', degrees: [1, 6, 3, 7] },
  { id: 'i-iv-v-i', label: 'i–iv–v–i', mode: 'minor', degrees: [1, 4, 5, 1] },
];

// MIDI 60 is C4, so octave 3 puts C at 48.
function keyOffset(key) {
  const offset = KEYS.indexOf(key);
  if (offset < 0) throw new RangeError(`Unknown key: ${String(key)}`);
  return offset;
}

function scaleFor(mode) {
  if (!Object.hasOwn(SCALES, mode)) throw new RangeError(`Unknown mode: ${String(mode)}`);
  return SCALES[mode];
}

export function midiToFrequency(midi) {
  if (!Number.isFinite(midi)) throw new RangeError(`Invalid MIDI note: ${String(midi)}`);
  return 440 * 2 ** ((midi - 69) / 12);
}

export function chordNotes(key, mode, degree, { octave = 3, voicing = 'triad' } = {}) {
  const tonic = (octave + 1) * 12 + keyOffset(key);
  const scale = scaleFor(mode);

  if (!Number.isInteger(degree) || degree < 1 || degree > 7) {
    throw new RangeError(`Unknown degree: ${String(degree)}`);
  }
  if (!Object.hasOwn(VOICINGS, voicing)) throw new RangeError(`Unknown voicing: ${String(voicing)}`);
  if (!Number.isInteger(octave)) throw new RangeError(`Invalid octave: ${String(octave)}`);

  // Stacked thirds: every other scale step, wrapping up an octave when it runs past the seventh.
  const notes = [];
  for (let step = 0; step < VOICINGS[voicing]; step++) {
    const position = degree - 1 + step * 2;
    notes.push(tonic + scale[position % 7] + 12 * Math.floor(position / 7));
  }

  if (notes.some(note => note < 0 || note > 127)) {
    throw new RangeError(`Chord falls outside the MIDI range at octave ${octave}.`);
  }
  return notes;
}

export function progressionToSteps(key, progressionId, { octave = 3, voicing = 'triad' } = {}) {
  keyOffset(key); // fail on an unknown key before looking up the progression
  const progression = PROGRESSIONS.find(item => item.id === progressionId);
  if (!progression) throw new RangeError(`Unknown progression: ${String(progressionId)}`);

  const steps = Array.from({ length: 16 }, () => null);
  progression.degrees.forEach((degree, index) => {
    steps[index * 4] = chordNotes(key, progression.mode, degree, { octave, voicing });
  });
  return steps;
}
