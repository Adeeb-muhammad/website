// Regression tests for stopping a playing loop without a click.
//
// The old stopSources() called source.stop() at once, cutting the waveform mid-cycle. Each source now has its own
// gain that ramps to zero before the source stops. These tests check that fade on every path that stops a track, and
// that a source which has not started yet still stops immediately.
//
// The fakes are the shared ones from tests/looper-fakes.mjs. Their GainNode records scheduled automation as a
// timeline instead of applying values at once. Nothing here produces real audio, so whether the click is actually
// gone can only be judged by ear on a real device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recordedWorld } from './looper-fakes.mjs';

const FADE = 0.008;
const STOP_DELAY = 0.01;

const nextLoopStart = (world, cycle) => Math.ceil(world.engine.absolute / cycle) * cycle;

// Finish a take and step into its first playback, plus one more step so the source is already sounding.
async function playingTake({ bars = 1, index = 0 } = {}) {
  const { world, looper } = await recordedWorld({ index, bars });
  const cycle = 16 * bars;
  const start = nextLoopStart(world, cycle);
  world.engine.tick(start - world.engine.absolute + 1);
  world.engine.tick(1); // move the audio clock past the source's start time
  const source = world.ctx.sources.at(-1);
  const sourceGain = source.connections[0];
  assert.ok(world.ctx.currentTime > source.startTime, 'the source is sounding');
  return { world, looper, source, sourceGain };
}

// Finish a take and reach its first playback, but stop before the audio clock reaches the scheduled start.
async function scheduledTake({ bars = 1, index = 0 } = {}) {
  const { world, looper } = await recordedWorld({ index, bars });
  const cycle = 16 * bars;
  const start = nextLoopStart(world, cycle);
  world.engine.tick(start - world.engine.absolute + 1);
  const source = world.ctx.sources.at(-1);
  const sourceGain = source.connections[0];
  assert.ok(world.ctx.currentTime < source.startTime, 'the source is scheduled for the future');
  return { world, looper, source, sourceGain };
}

const typesOf = gain => gain.timeline.map(event => event.type);

test('transport stop ramps the source gain to zero and stops after the ramp', async () => {
  const { world, source, sourceGain } = await playingTake();
  const now = world.ctx.currentTime;
  world.engine.stop();

  assert.deepEqual(typesOf(sourceGain.gain), ['set', 'linear'], 'one pinned start value and one linear ramp');
  assert.deepEqual(sourceGain.gain.timeline[0], { type: 'set', value: 1, time: now }, 'the ramp is pinned at the current level');
  assert.deepEqual(sourceGain.gain.timeline[1], { type: 'linear', value: 0, time: now + FADE }, 'it reaches zero after 8 ms');
  assert.equal(source.stopCalls.length, 1);
  assert.equal(source.stopCalls[0], now + STOP_DELAY, 'the source stops 10 ms after the stop request');
  assert.ok(source.stopCalls[0] > sourceGain.gain.timeline[1].time, 'the stop is after the ramp ends');
});

test('the fade starts from the gain value in force, with no jump', async () => {
  const { world, sourceGain } = await playingTake();
  sourceGain.gain.value = 0.4; // simulate any level the source gain happens to be at
  const now = world.ctx.currentTime;
  world.engine.stop();

  assert.equal(sourceGain.gain.value, 0.4, 'the level is not changed instantly');
  assert.deepEqual(sourceGain.gain.timeline[0], { type: 'set', value: 0.4, time: now });
  assert.deepEqual(sourceGain.gain.timeline[1], { type: 'linear', value: 0, time: now + FADE });
});

test('a tempo mismatch fades the playing loops out', async () => {
  const { world, source, sourceGain } = await playingTake();
  world.engine.bpm = 100;
  world.engine.tick(1);
  const now = world.ctx.currentTime;

  assert.deepEqual(typesOf(sourceGain.gain), ['set', 'linear']);
  assert.equal(sourceGain.gain.timeline[1].time, now + FADE);
  assert.equal(source.stopCalls[0], now + STOP_DELAY);
});

test('clearing a track fades the playing take out', async () => {
  const { world, looper, source, sourceGain } = await playingTake();
  const now = world.ctx.currentTime;
  looper.clearTrack(0);

  assert.deepEqual(typesOf(sourceGain.gain), ['set', 'linear']);
  assert.equal(sourceGain.gain.timeline[1].time, now + FADE);
  assert.equal(source.stopCalls[0], now + STOP_DELAY);
});

test('dispose uses the same fade path, silences at once and stays idempotent', async () => {
  const { world, looper, source, sourceGain } = await playingTake();
  const bus = world.ctx.gains.find(node => node.connections.includes(world.engine.master));
  assert.ok(bus, 'the looper bus feeds the master gain');
  const now = world.ctx.currentTime;
  looper.dispose();

  // dispose() is the pagehide teardown, so it must guarantee silence immediately: the bus is detached at once even
  // though the source still gets the same scheduled ramp as every other stop. That ramp is not audible on dispose.
  assert.deepEqual(typesOf(sourceGain.gain), ['set', 'linear'], 'it still uses the shared stop path');
  assert.equal(sourceGain.gain.timeline[1].time, now + FADE);
  assert.equal(source.stopCalls[0], now + STOP_DELAY);
  assert.deepEqual(bus.connections, [], 'the bus is detached at once, so nothing can be heard');

  const stops = source.stopCalls.length;
  const events = sourceGain.gain.timeline.length;
  looper.dispose();
  assert.equal(source.stopCalls.length, stops, 'a second dispose adds no stop');
  assert.equal(sourceGain.gain.timeline.length, events, 'a second dispose adds no automation');
});

test('a source that has not started yet stops immediately, without a ramp', async () => {
  const { world, looper, source, sourceGain } = await scheduledTake();
  assert.ok(source.startTime > world.ctx.currentTime);
  looper.clearTrack(0);

  assert.equal(sourceGain.gain.timeline.length, 0, 'no fade for a source nobody has heard');
  assert.equal(source.stopCalls.length, 1);
  assert.equal(source.stopCalls[0], undefined, 'stop() is called at once');
  assert.equal(source.connections.length, 0, 'the source is disconnected at once');
  assert.equal(sourceGain.connections.length, 0, 'its gain is disconnected at once');
});

test('both nodes are disconnected on the ended event', async () => {
  const { world, source, sourceGain } = await playingTake();
  world.engine.stop();
  assert.equal(source.connections.length, 1, 'still connected while the fade plays');
  assert.equal(sourceGain.connections.length, 1);

  source.onended();
  assert.equal(source.connections.length, 0, 'the source is detached');
  assert.equal(sourceGain.connections.length, 0, 'and so is its gain');
});

test('a second stop on the same track is harmless', async () => {
  const { world, looper, source, sourceGain } = await playingTake();
  world.engine.stop();
  const stops = source.stopCalls.length;
  const events = sourceGain.gain.timeline.length;

  assert.doesNotThrow(() => world.engine.stop());
  assert.doesNotThrow(() => looper.clearTrack(0));
  assert.equal(source.stopCalls.length, stops, 'no extra stop call');
  assert.equal(sourceGain.gain.timeline.length, events, 'no extra automation');
});
