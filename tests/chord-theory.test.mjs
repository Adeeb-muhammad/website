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

console.log(`\n${passed} passed, ${failed.length} failed`);
if (failed.length) {
  console.error(`\nFailures:\n${failed.map(name => `  - ${name}`).join('\n')}`);
  process.exit(1);
}
