// Regression tests for the looper count-in.
//
// StepEngine sends step events ahead of their audio time, and at slow tempos the real audio clock can already be
// well past the most recent event's `when` before the next event arrives. The looper used to arm from the integer
// step index alone, so a track armed in that gap could get less than a full bar of count-in. These tests move the
// fake audio clock on its own, without emitting a new step event, and check where the looper puts the capture start.
//
// The fakes are the shared ones from tests/looper-fakes.mjs: a fake AudioContext, a fake StepEngine and an
// asynchronous recorder. Nothing here produces real audio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLooper } from '../assets/js/looper.js';
import { makeWorld } from './looper-fakes.mjs';

const STEPS_PER_BAR = 16;
const COUNT_IN_STEPS = 16;

const clamp = value => Math.min(1, Math.max(0, value));

// Play `armedAt + 1` steps, then move the audio clock `clockSteps` of a step past the last event's `when` without
// emitting a new event. Arm the track there and tick until it starts recording, returning the step that happened on.
async function armAt({ bpm, bars = 1, armedAt = 0, clockSteps = 0 }) {
  const world = makeWorld({ bpm });
  const looper = createLooper(world.engine, world.options);
  world.engine.start();
  world.engine.tick(armedAt + 1); // the last emitted event is step `armedAt`
  const lastWhen = world.engine.whenOf(armedAt);
  world.ctx.currentTime = lastWhen + clockSteps * (60 / bpm / 4);
  await looper.recordTrack(0, bars);

  const cycle = STEPS_PER_BAR * bars;
  for (let tick = 0; tick < 1000; tick++) {
    const step = world.engine.absolute;
    world.engine.tick(1);
    if (looper.snapshot().tracks[0].status === 'recording') return { world, looper, captureStart: step, cycle, armedAt, clockSteps };
  }
  throw new Error('the track never started recording');
}

// The capture start must be a loop boundary at least COUNT_IN_STEPS steps after the real arming position.
function assertFullCountIn({ captureStart, cycle, armedAt, clockSteps }, label) {
  const position = armedAt + clamp(clockSteps);
  assert.equal(captureStart % cycle, 0, `${label}: capture start ${captureStart} must be a multiple of the ${cycle}-step loop`);
  const countIn = captureStart - position;
  assert.ok(countIn >= COUNT_IN_STEPS - 1e-9, `${label}: count-in was ${countIn.toFixed(3)} steps, expected at least ${COUNT_IN_STEPS}`);
}

test('arming just after a step, before the next event, still counts in a full bar', async () => {
  const result = await armAt({ bpm: 120, bars: 1, armedAt: 0, clockSteps: 0.9 });
  assertFullCountIn(result, '120 BPM, 1 bar');
  assert.equal(result.captureStart, 32, 'the extra fraction pushes the capture start to the next loop boundary');
});

test('arming exactly on a step keeps the count-in a full bar', async () => {
  const result = await armAt({ bpm: 120, bars: 1, armedAt: 4, clockSteps: 0 });
  assertFullCountIn(result, 'on a step');
  assert.equal(result.captureStart, 32, 'exactly 28 steps of count-in, starting on a loop boundary');
});

for (const bpm of [70, 160]) {
  test(`a mid-step arming at ${bpm} BPM still counts in a full bar`, async () => {
    const result = await armAt({ bpm, bars: 1, armedAt: 0, clockSteps: 0.9 });
    assertFullCountIn(result, `${bpm} BPM`);
    assert.equal(result.captureStart, 32);
  });
}

for (const { bars, armedAt } of [{ bars: 1, armedAt: 0 }, { bars: 2, armedAt: 16 }, { bars: 4, armedAt: 48 }]) {
  test(`a ${bars}-bar track armed mid-step counts in at least a bar and starts on a loop boundary`, async () => {
    const result = await armAt({ bpm: 120, bars, armedAt, clockSteps: 0.9 });
    assertFullCountIn(result, `${bars} bars`);
    assert.equal(result.captureStart, 32 * bars, 'the next loop boundary after one full bar of count-in');
  });
}

test('the clock is never extrapolated more than one step', async () => {
  // The next event is overdue by 1.5 steps; the clamp must stop at one step, so the capture start stays at 32
  // rather than jumping to 48 as it would with an unclamped fraction of 1.5.
  const result = await armAt({ bpm: 120, bars: 1, armedAt: 15, clockSteps: 1.5 });
  assertFullCountIn(result, 'overdue event');
  assert.equal(result.captureStart, 32);
});
