import test from 'node:test';
import assert from 'node:assert/strict';
import { barSeconds, fitToLoop, isLoopStart, loopFrames } from '../assets/js/loop-math.js';

const ramp = length => Float32Array.from({ length }, (_, index) => index + 1); // sample k holds k + 1
const ones = length => new Float32Array(length).fill(1);

test('barSeconds is four beats by default and rejects bad tempos', () => {
  assert.equal(barSeconds(120), 2);
  assert.equal(barSeconds(60), 4);
  assert.equal(barSeconds(60, 3), 3);
  for (const bad of [39, 241, NaN, Infinity, '120', null, undefined]) assert.throws(() => barSeconds(bad), RangeError, String(bad));
  for (const bad of [0, 1.5, 17, '4']) assert.throws(() => barSeconds(120, bad), RangeError, `beats ${bad}`);
});

test('loopFrames gives exact whole frame counts', () => {
  assert.equal(loopFrames(44100, 120, 1), 88200);
  assert.equal(loopFrames(44100, 120, 2), 176400);
  assert.equal(loopFrames(44100, 120, 4), 352800);
  assert.equal(loopFrames(48000, 120, 1), 96000);
  assert.equal(loopFrames(48000, 110, 1), Math.round(60 / 110 * 4 * 48000)); // 104727.27 rounds to 104727
  assert.equal(loopFrames(48000, 110, 1), 104727);
  assert.equal(loopFrames(44100, 170, 1), 62259);
  assert.equal(loopFrames(44100, 70, 4), Math.round(60 / 70 * 4 * 4 * 44100));
  for (const rate of [44100, 48000]) for (const bpm of [70, 110, 123, 170]) for (const bars of [1, 2, 4]) {
    assert.ok(Number.isInteger(loopFrames(rate, bpm, bars)), `${rate} ${bpm} ${bars}`);
  }
});

test('loopFrames rejects bad sample rates and bar counts', () => {
  for (const bad of [0, -1, 1.5, NaN, 7999, 384001, '44100', undefined]) assert.throws(() => loopFrames(bad, 120, 1), RangeError, `rate ${bad}`);
  for (const bad of [0, 3, 5, 8, 1.5, '2', null]) assert.throws(() => loopFrames(44100, 120, bad), RangeError, `bars ${bad}`);
  assert.throws(() => loopFrames(44100, 10, 1), RangeError);
});

test('fitToLoop returns exactly one loop for a short clip, a long clip and an exact clip', () => {
  const frames = loopFrames(44100, 120, 1);
  for (const length of [1000, frames, frames + 5000, frames * 3]) {
    const [out] = fitToLoop([ramp(length)], 44100, 120, 1);
    assert.equal(out.length, frames, `clip of ${length}`);
    assert.ok(out instanceof Float32Array);
  }
});

test('fitToLoop keeps every channel the same length and works channel by channel', () => {
  const left = ones(50000);
  const right = new Float32Array(50000).fill(0.5);
  const [outLeft, outRight] = fitToLoop([left, right], 44100, 120, 1, { fadeSeconds: 0 });
  assert.equal(outLeft.length, outRight.length);
  assert.equal(outLeft[100], 1);
  assert.equal(outRight[100], 0.5);
  assert.equal(outLeft[60000], 0, 'padded with silence after the clip ends');
});

test('fitToLoop never modifies its input and returns new arrays', () => {
  const input = ramp(60000);
  const copy = Float32Array.from(input);
  const [out] = fitToLoop([input], 44100, 120, 1, { offsetSeconds: 0.01 });
  assert.deepEqual(input, copy);
  assert.notEqual(out, input);
  assert.notEqual(out.buffer, input.buffer);
});

test('a positive offset drops audio from the start, a negative one adds silence', () => {
  const rate = 44100;
  const input = ramp(100000);
  const offsetFrames = 441; // 0.01 s
  const [late] = fitToLoop([input], rate, 120, 1, { offsetSeconds: 0.01, fadeSeconds: 0 });
  assert.equal(late[0], input[offsetFrames]);
  assert.equal(late[1000], input[1000 + offsetFrames]);
  const [early] = fitToLoop([input], rate, 120, 1, { offsetSeconds: -0.01, fadeSeconds: 0 });
  assert.equal(early[0], 0);
  assert.equal(early[offsetFrames - 1], 0);
  assert.equal(early[offsetFrames], input[0]);
  assert.equal(early[offsetFrames + 1000], input[1000]);
});

test('offsets are rounded to the nearest frame and can exceed the clip', () => {
  const input = ramp(100000);
  const [out] = fitToLoop([input], 44100, 120, 1, { offsetSeconds: 0.0123, fadeSeconds: 0 });
  assert.equal(out[0], input[Math.round(0.0123 * 44100)]);
  const [gone] = fitToLoop([ramp(1000)], 44100, 120, 1, { offsetSeconds: 1, fadeSeconds: 0 });
  assert.ok(gone.every(sample => sample === 0), 'offset beyond the clip leaves silence');
  assert.equal(gone.length, 88200);
  const [late] = fitToLoop([ramp(1000)], 44100, 120, 1, { offsetSeconds: -5, fadeSeconds: 0 });
  assert.ok(late.every(sample => sample === 0), 'a start offset beyond the loop leaves silence');
});

test('fades start and end the loop at zero and leave the middle untouched', () => {
  const rate = 44100;
  const frames = loopFrames(rate, 120, 1);
  const fade = Math.round(0.005 * rate); // 221 frames
  const [out] = fitToLoop([ones(frames)], rate, 120, 1);
  assert.equal(out[0], 0);
  assert.equal(out[frames - 1], 0);
  assert.ok(out[1] > 0 && out[1] < out[fade - 1], 'rises through the fade-in');
  assert.ok(out[frames - 2] > 0 && out[frames - 2] < out[frames - fade], 'falls through the fade-out');
  assert.equal(out[fade], 1);
  assert.equal(out[frames - 1 - fade], 1);
  assert.equal(out[Math.floor(frames / 2)], 1);
  const [plain] = fitToLoop([ones(frames)], rate, 120, 1, { fadeSeconds: 0 });
  assert.ok(plain.every(sample => sample === 1), 'fadeSeconds 0 leaves the clip exactly as it was');
});

test('fades never exceed half the loop', () => {
  const [out] = fitToLoop([ones(100000)], 44100, 120, 1, { fadeSeconds: 100 });
  const frames = out.length;
  assert.equal(out[0], 0);
  assert.equal(out[frames - 1], 0);
  assert.ok(out.every(sample => sample >= 0 && sample <= 1));
});

test('fitToLoop validates its input', () => {
  assert.throws(() => fitToLoop([], 44100, 120, 1), TypeError);
  assert.throws(() => fitToLoop('x', 44100, 120, 1), TypeError);
  assert.throws(() => fitToLoop([[1, 2, 3]], 44100, 120, 1), TypeError);
  assert.throws(() => fitToLoop([new Float64Array(10)], 44100, 120, 1), TypeError);
  assert.throws(() => fitToLoop([ones(10), ones(11)], 44100, 120, 1), RangeError);
  assert.throws(() => fitToLoop([ones(10)], 44100, 120, 3), RangeError);
  assert.throws(() => fitToLoop([ones(10)], 44100, 500, 1), RangeError);
  assert.throws(() => fitToLoop([ones(10)], 44100, 120, 1, { offsetSeconds: NaN }), RangeError);
  assert.throws(() => fitToLoop([ones(10)], 44100, 120, 1, { fadeSeconds: -1 }), RangeError);
});

test('isLoopStart marks where a loop of 1, 2 or 4 bars begins', () => {
  assert.deepEqual([0, 8, 15, 16, 17, 32].map(step => isLoopStart(step, 1)), [true, false, false, true, false, true]);
  assert.deepEqual([0, 16, 32, 48].map(step => isLoopStart(step, 2)), [true, false, true, false]);
  assert.deepEqual([0, 16, 32, 48, 64].map(step => isLoopStart(step, 4)), [true, false, false, false, true]);
  for (const bad of [-1, 1.5, NaN, Infinity, '0', null]) assert.throws(() => isLoopStart(bad, 1), RangeError, String(bad));
  for (const bad of [0, 3, 8, '2']) assert.throws(() => isLoopStart(0, bad), RangeError, `bars ${bad}`);
});
