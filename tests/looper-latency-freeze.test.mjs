// Regression tests for the TAKE TIMING slider. It stays enabled while a take is recording, but the panel says the
// setting applies to the next take. The looper must freeze the offset onto the session when capture starts, so a
// change made mid-take cannot move audio that was already recorded.
//
// The fakes are the shared ones from tests/looper-fakes.mjs: a fake AudioContext, a fake StepEngine clock and a
// recorder whose stop() resolves asynchronously. Nothing here produces real audio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLooper } from '../assets/js/looper.js';
import { flush, makeWorld, RATE } from './looper-fakes.mjs';

// Arming after the step-4 event means 28 steps (3.5 s) plus the 50 ms lookahead pass before capture starts.
const PRE_ROLL_FRAMES = Math.round(3.55 * RATE);
const SAMPLE = 5000; // well inside the take, past the 240-frame edge fade
const HALF_BAR = 16; // steps in one bar at 120 BPM

// The fake creates a buffer only when a take has been fitted, so this records the fitted takes in order.
function captureBuffers(world) {
  const buffers = [];
  const createBuffer = world.ctx.createBuffer.bind(world.ctx);
  world.ctx.createBuffer = (...args) => {
    const buffer = createBuffer(...args);
    buffers.push(buffer);
    return buffer;
  };
  return buffers;
}

// Drive one take from arming to "ready" against a fresh world. The hooks move the slider at three precise moments:
// during the count-in, after capture has started, and after the recorder has been stopped but while its result is
// still resolving asynchronously.
async function runTake({ index = 0, bars = 1, before = 0, duringCountIn, duringCapture, whileFinishing, stopTurns = 1 } = {}) {
  const world = makeWorld({ stopTurns });
  const buffers = captureBuffers(world);
  const looper = createLooper(world.engine, world.options);
  looper.setLatencyOffset(before);
  world.engine.start();
  world.engine.tick(5); // steps 0 to 4, so the take is armed after step 4 like the other looper tests

  const armedAt = world.engine.absolute;
  await looper.recordTrack(index, bars);
  const cycle = HALF_BAR * bars;
  const captureStart = Math.ceil((armedAt + HALF_BAR) / cycle) * cycle;

  // Walk to the last step of the count-in without starting capture.
  world.engine.tick(captureStart - world.engine.absolute);
  assert.equal(looper.snapshot().tracks[index].status, 'count-in');
  if (duringCountIn !== undefined) looper.setLatencyOffset(duringCountIn);

  world.engine.tick(1); // capture starts on this step
  assert.equal(looper.snapshot().tracks[index].status, 'recording');
  const offsetAtCapture = looper.snapshot().latencyOffset;
  if (duringCapture !== undefined) looper.setLatencyOffset(duringCapture);
  world.engine.tick(1); // one more step of the take

  // Walk to the step that stops the recorder, then take that step.
  world.engine.tick(captureStart + cycle + 4 - world.engine.absolute);
  assert.equal(looper.snapshot().tracks[index].status, 'recording');
  world.engine.tick(1);
  assert.equal(looper.snapshot().tracks[index].status, 'processing');

  // finishRecording() is now inside `await active.recorder.stop()`, so this is after capture and before the take ends.
  if (whileFinishing !== undefined) looper.setLatencyOffset(whileFinishing);

  await flush();
  assert.equal(looper.snapshot().tracks[index].status, 'ready');
  return { world, looper, buffers, armedAt, captureStart, offsetAtCapture };
}

const sampleAt = buffer => buffer.getChannelData(0)[SAMPLE];

// A plain loop, so a mismatch reports one frame instead of dumping two 96k-sample arrays into the failure message.
function firstDifference(a, b) {
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index++) if (a[index] !== b[index]) return index;
  return a.length === b.length ? -1 : shared;
}

test('moving TAKE TIMING after capture starts does not move that take', async () => {
  const control = await runTake({ before: 0.01 });
  const raced = await runTake({ before: 0.01, duringCapture: 0.25, whileFinishing: -0.4, stopTurns: 3 });

  assert.equal(raced.offsetAtCapture, 0.01);
  assert.equal(
    firstDifference(raced.buffers[0].getChannelData(0), control.buffers[0].getChannelData(0)),
    -1,
    'the take is identical',
  );
  assert.equal(sampleAt(raced.buffers[0]), SAMPLE + PRE_ROLL_FRAMES + Math.round(0.01 * RATE) + 1);
  assert.equal(raced.looper.snapshot().latencyOffset, -0.4, 'the slider itself really moved');
});

test('moving TAKE TIMING after a take finishes changes only the next take', async () => {
  const world = makeWorld();
  const buffers = captureBuffers(world);
  const looper = createLooper(world.engine, world.options);
  world.engine.start();
  world.engine.tick(5);

  const firstArmedAt = world.engine.absolute;
  await looper.recordTrack(0, 1);
  const firstCapture = Math.ceil((firstArmedAt + HALF_BAR) / HALF_BAR) * HALF_BAR;
  world.engine.tick(firstCapture + HALF_BAR + 4 - world.engine.absolute + 1);
  await flush();
  const firstTake = buffers[0].getChannelData(0).slice();
  const baseline = SAMPLE + PRE_ROLL_FRAMES + 1;
  assert.equal(sampleAt(buffers[0]), baseline);

  looper.setLatencyOffset(0.02); // after the first take is ready

  // The second take is armed at step 53, so its pre-roll is the same 3.55 s as the first.
  const secondArmedAt = world.engine.absolute;
  await looper.recordTrack(1, 1);
  const secondCapture = Math.ceil((secondArmedAt + HALF_BAR) / HALF_BAR) * HALF_BAR;
  assert.equal(secondArmedAt, firstCapture + HALF_BAR + 5);
  world.engine.tick(secondCapture + HALF_BAR + 4 - world.engine.absolute + 1);
  await flush();

  assert.equal(firstDifference(buffers[0].getChannelData(0), firstTake), -1, 'the finished take did not move');
  assert.equal(sampleAt(buffers[0]), baseline);
  assert.equal(sampleAt(buffers[1]), baseline + Math.round(0.02 * RATE), 'only the next take moved');
  assert.equal(looper.snapshot().latencyOffset, 0.02);
});

test('moving TAKE TIMING during the count-in still applies to the take that follows', async () => {
  const { buffers } = await runTake({ before: 0, duringCountIn: 0.015 });
  assert.equal(sampleAt(buffers[0]), SAMPLE + PRE_ROLL_FRAMES + Math.round(0.015 * RATE) + 1);
});

test('a take with no slider change is fitted exactly as before', async () => {
  const { world, looper, buffers } = await runTake({ before: 0 });

  assert.equal(buffers[0].length, Math.round((60 / 120) * 4 * RATE), 'exactly one bar of frames');
  assert.equal(sampleAt(buffers[0]), SAMPLE + PRE_ROLL_FRAMES + 1, 'the pre-roll is dropped, as before');
  assert.equal(buffers[0].getChannelData(0)[0], 0, 'and the edge is faded');
  assert.equal(looper.snapshot().tracks[0].status, 'ready');
  assert.equal(looper.snapshot().latencyOffset, 0);
  assert.equal(world.recorders[0].stopped, true);
});
