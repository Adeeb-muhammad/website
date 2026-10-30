// Plain Node test runner: `node tests/chord-theory.test.mjs` exits non-zero on failure.
import assert from 'node:assert/strict';
import { KEYS, PROGRESSIONS, chordNotes, midiToFrequency, progressionToSteps } from '../assets/js/chord-theory.js';

let passed = 0;
const failed = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    failed.push(name);
    console.error(`not ok ${passed + failed.length} - ${name}`);
    console.error(`  ${error.message.split('\n').join('\n  ')}`);
  }
}

const STEPS = [0, 4, 8, 12];

test('KEYS lists the twelve chromatic pitch classes from C', () => {
  assert.deepEqual(KEYS, ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);
  assert.equal(new Set(KEYS).size, 12);
});

test('PROGRESSIONS contains the expected shapes', () => {
  const ids = PROGRESSIONS.map(p => p.id);
  for (const id of ['I-V-vi-IV', 'vi-IV-I-V', 'I-vi-IV-V', 'i-VI-III-VII', 'i-iv-v-i']) {
    assert.ok(ids.includes(id), `missing progression ${id}`);
  }
  for (const progression of PROGRESSIONS) {
    assert.equal(progression.degrees.length, 4, `${progression.id} needs four degrees`);
    assert.ok(['major', 'minor'].includes(progression.mode), `${progression.id} has a bad mode`);
    assert.ok(progression.degrees.every(d => Number.isInteger(d) && d >= 1 && d <= 7), `${progression.id} has a bad degree`);
    assert.equal(typeof progression.label, 'string');
    assert.ok(progression.label.length > 0);
  }
});

test('C major triads match the expected I, IV, V and vi notes', () => {
  assert.deepEqual(chordNotes('C', 'major', 1), [48, 52, 55]);
  assert.deepEqual(chordNotes('C', 'major', 4), [53, 57, 60]);
  assert.deepEqual(chordNotes('C', 'major', 5), [55, 59, 62]);
  assert.deepEqual(chordNotes('C', 'major', 6), [57, 60, 64]);
});

test('A minor i is the A minor triad at octave 3', () => {
  assert.deepEqual(chordNotes('A', 'minor', 1), [57, 60, 64]);
});

test('midiToFrequency uses equal temperament with A4 = 440 Hz', () => {
  assert.equal(midiToFrequency(69), 440);
  assert.ok(Math.abs(midiToFrequency(60) - 261.6256) < 0.0001, `got ${midiToFrequency(60)}`);
  assert.equal(midiToFrequency(81), 880);
  assert.equal(midiToFrequency(57), 220);
});

test('every chord is ascending and inside 36..84 for all keys and progressions at octave 3', () => {
  const chords = [];
  for (const key of KEYS) {
    for (let degree = 1; degree <= 7; degree++) {
      chords.push(chordNotes(key, 'major', degree), chordNotes(key, 'minor', degree));
    }
    for (const progression of PROGRESSIONS) {
      for (const step of progressionToSteps(key, progression.id).filter(Boolean)) chords.push(step);
    }
  }
  assert.equal(chords.length, KEYS.length * (14 + PROGRESSIONS.length * 4));
  for (const chord of chords) {
    for (let i = 1; i < chord.length; i++) {
      assert.ok(chord[i] > chord[i - 1], `chord not ascending: ${chord.join(',')}`);
    }
    for (const note of chord) {
      assert.equal(note, Math.round(note));
      assert.ok(note >= 36 && note <= 84, `note ${note} outside 36..84 in ${chord.join(',')}`);
    }
  }
});

test('seventh voicing returns four stacked diatonic thirds', () => {
  for (const key of KEYS) {
    for (const mode of ['major', 'minor']) {
      for (let degree = 1; degree <= 7; degree++) {
        const triad = chordNotes(key, mode, degree);
        const seventh = chordNotes(key, mode, degree, { voicing: 'seventh' });
        assert.equal(triad.length, 3);
        assert.equal(seventh.length, 4);
        assert.deepEqual(seventh.slice(0, 3), triad, 'seventh should extend the same triad');
        assert.ok(seventh[3] > seventh[2]);
      }
    }
  }
});

test('progressionToSteps places one chord on steps 0, 4, 8 and 12 only', () => {
  for (const key of KEYS) {
    for (const progression of PROGRESSIONS) {
      const steps = progressionToSteps(key, progression.id);
      assert.equal(steps.length, 16);
      steps.forEach((step, index) => {
        if (STEPS.includes(index)) {
          assert.ok(Array.isArray(step), `step ${index} should hold a chord`);
          assert.deepEqual(step, chordNotes(key, progression.mode, progression.degrees[index / 4]));
        } else {
          assert.equal(step, null, `step ${index} should be empty`);
        }
      });
    }
  }
});

test('progressionToSteps honors octave and voicing options', () => {
  const steps = progressionToSteps('C', 'I-V-vi-IV', { octave: 4, voicing: 'seventh' });
  assert.deepEqual(steps[0], [60, 64, 67, 71]);
  assert.deepEqual(steps[4], [67, 71, 74, 77]);
  assert.equal(steps.filter(Boolean).length, 4);
  assert.ok(steps.filter(Boolean).every(chord => chord.length === 4));
});

test('invalid inputs throw RangeError', () => {
  assert.throws(() => chordNotes('H', 'major', 1), RangeError);
  assert.throws(() => chordNotes('c', 'major', 1), RangeError);
  assert.throws(() => chordNotes('C', 'dorian', 1), RangeError);
  assert.throws(() => chordNotes('C', 'Major', 1), RangeError);
  assert.throws(() => chordNotes('C', 'major', 0), RangeError);
  assert.throws(() => chordNotes('C', 'major', 8), RangeError);
  assert.throws(() => chordNotes('C', 'major', 1.5), RangeError);
  assert.throws(() => chordNotes('C', 'major', '1'), RangeError);
  assert.throws(() => chordNotes('C', 'major', 1, { voicing: 'ninth' }), RangeError);
  assert.throws(() => chordNotes('C', 'major', 1, { octave: 3.5 }), RangeError);
  assert.throws(() => chordNotes('C', 'major', 1, { octave: 12 }), RangeError);
  assert.throws(() => chordNotes('C', 'major', 1, { octave: -3 }), RangeError);
  assert.throws(() => progressionToSteps('C', 'nope'), RangeError);
  assert.throws(() => progressionToSteps('H', 'I-V-vi-IV'), RangeError);
  assert.throws(() => midiToFrequency('440'), RangeError);
});

test('major-scale chords have the right quality on every degree (M m m M M m dim)', () => {
  const intervals = notes => `${notes[1] - notes[0]},${notes[2] - notes[1]}`;
  const expected = ['4,3', '3,4', '3,4', '4,3', '4,3', '3,4', '3,3'];
  expected.forEach((shape, index) => {
    assert.equal(intervals(chordNotes('C', 'major', index + 1)), shape, `major degree ${index + 1}`);
  });
});

test('natural-minor chords have the right quality on every degree (m dim M m m M M)', () => {
  const intervals = notes => `${notes[1] - notes[0]},${notes[2] - notes[1]}`;
  const expected = ['3,4', '3,3', '4,3', '3,4', '3,4', '4,3', '4,3'];
  expected.forEach((shape, index) => {
    assert.equal(intervals(chordNotes('C', 'minor', index + 1)), shape, `minor degree ${index + 1}`);
  });
});

test('C natural minor chords match exact notes', () => {
  assert.deepEqual(chordNotes('C', 'minor', 1), [48, 51, 55]); // Cm
  assert.deepEqual(chordNotes('C', 'minor', 3), [51, 55, 58]); // Eb
  assert.deepEqual(chordNotes('C', 'minor', 4), [53, 56, 60]); // Fm
  assert.deepEqual(chordNotes('C', 'minor', 5), [55, 58, 62]); // Gm
  assert.deepEqual(chordNotes('C', 'minor', 6), [56, 60, 63]); // Ab
  assert.deepEqual(chordNotes('C', 'minor', 7), [58, 62, 65]); // Bb
});

test('each progression keeps its exact mode and degrees', () => {
  const expected = {
    'I-V-vi-IV': ['major', [1, 5, 6, 4]],
    'vi-IV-I-V': ['major', [6, 4, 1, 5]],
    'I-vi-IV-V': ['major', [1, 6, 4, 5]],
    'i-VI-III-VII': ['minor', [1, 6, 3, 7]],
    'i-iv-v-i': ['minor', [1, 4, 5, 1]],
  };
  for (const [id, [mode, degrees]] of Object.entries(expected)) {
    const progression = PROGRESSIONS.find(item => item.id === id);
    assert.ok(progression, `missing ${id}`);
    assert.equal(progression.mode, mode, `${id} mode`);
    assert.deepEqual(progression.degrees, degrees, `${id} degrees`);
  }
});

test('progressionToSteps plays the right chords in C for major and minor progressions', () => {
  const major = progressionToSteps('C', 'I-V-vi-IV');
  assert.deepEqual([major[0], major[4], major[8], major[12]], [[48, 52, 55], [55, 59, 62], [57, 60, 64], [53, 57, 60]]);
  const minor = progressionToSteps('C', 'i-iv-v-i');
  assert.deepEqual([minor[0], minor[4], minor[8], minor[12]], [[48, 51, 55], [53, 56, 60], [55, 58, 62], [48, 51, 55]]);
});

test('transposing the key up one semitone moves every note up one', () => {
  for (const progression of PROGRESSIONS) {
    for (let index = 0; index < 11; index++) {
      const lower = progressionToSteps(KEYS[index], progression.id);
      const higher = progressionToSteps(KEYS[index + 1], progression.id);
      lower.forEach((chord, step) => {
        if (chord === null) return assert.equal(higher[step], null);
        assert.deepEqual(higher[step], chord.map(note => note + 1));
      });
    }
  }
});

console.log(`\n${passed} passed, ${failed.length} failed`);
if (failed.length) {
  console.error(`\nFailures:\n${failed.map(name => `  - ${name}`).join('\n')}`);
  process.exit(1);
}
