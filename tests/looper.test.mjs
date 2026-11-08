import test from 'node:test';
import assert from 'node:assert/strict';
import { createLooper } from '../assets/js/looper.js';
import { loopFrames } from '../assets/js/loop-math.js';

const STEP = 0.125; // seconds per 16th step at 120 BPM
const RATE = 48000;
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };

function makeNode(kind) {
  return {
    kind, connections: [], startCalls: [], stopCalls: [], buffer: null, onended: null,
    gain: { value: 1, calls: [], setTargetAtTime(value, time) { this.value = value; this.calls.push({ value, time }); } },
    connect(to) { this.connections.push(to); return to; },
    disconnect() { this.connections = []; },
    start(time) { this.startCalls.push(time); },
    stop(time) { this.stopCalls.push(time); }
  };
}

function makeWorld({ bpm = 120, signal = null, recorderStart = null } = {}) {
  const ctx = {
    currentTime: 0, sources: [], gains: [],
    createGain() { const node = makeNode('gain'); ctx.gains.push(node); return node; },
    createBufferSource() { const node = makeNode('source'); ctx.sources.push(node); return node; },
    createBuffer(channels, length, sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, length, sampleRate, getChannelData: index => data[index], copyToChannel(source, index) { data[index].set(source); } };
    }
  };
  const handlers = { step: new Set(), stop: new Set() };
  const master = makeNode('master');
  const engine = {
    ctx, master, handlers, bpm, playing: false, absolute: 0, base: 0,
    on(type, listener) { handlers[type].add(listener); return () => handlers[type].delete(listener); },
    getAudioContext: () => ctx,
    getMasterGain: () => master,
    getBpm: () => engine.bpm,
    isPlaying: () => engine.playing,
    start() { engine.playing = true; engine.absolute = 0; engine.base = ctx.currentTime + 0.05; },
    // Emit `count` consecutive steps. The audio clock runs 50 ms behind each event's time, like the real lookahead.
    tick(count = 1) {
      for (let index = 0; index < count; index++) {
        const when = engine.base + engine.absolute * (60 / engine.bpm / 4);
        ctx.currentTime = when - 0.05;
        handlers.step.forEach(listener => listener({ step: engine.absolute % 16, when, bpm: engine.bpm, stepDuration: 60 / engine.bpm / 4 }));
        engine.absolute++;
      }
    },
    whenOf: absolute => engine.base + absolute * (60 / engine.bpm / 4),
    stop() { engine.playing = false; handlers.stop.forEach(listener => listener()); engine.absolute = 0; }
  };
  const recorders = [];
  const world = {
    ctx, engine, recorders,
    options: {
      createRecorder() {
        const recorder = {
          started: false, stopped: false, discarded: false,
          async start() {
            if (recorderStart) await recorderStart(recorder);
            await Promise.resolve();
            recorder.started = true;
          },
          async stop() {
            await Promise.resolve();
            recorder.stopped = true;
            return { blob: { arrayBuffer: async () => new ArrayBuffer(8) }, mimeType: 'audio/webm', extension: 'webm' };
          },
          discard() { recorder.discarded = true; }
        };
        recorders.push(recorder);
        return recorder;
      },
      decode: async () => {
        const data = signal ?? Float32Array.from({ length: 700000 }, (_, index) => index + 1); // sample k holds k + 1
        return { numberOfChannels: 1, sampleRate: RATE, getChannelData: () => data };
      }
    }
  };
  return world;
}

// Arm track `index` at step 4, then play through the whole take. Returns the looper and the world.
async function recordedWorld({ index = 0, bars = 1, armAt = 4, ...worldOptions } = {}) {
  const world = makeWorld(worldOptions);
  const looper = createLooper(world.engine, world.options);
  world.engine.start();
  world.engine.tick(armAt + 1);
  await looper.recordTrack(index, bars);
  const cycle = 16 * bars;
  const captureStart = Math.ceil((armAt + 16) / cycle) * cycle;
  world.engine.tick(captureStart + cycle + 4 - world.engine.absolute + 1);
  await flush();
  return { world, looper, captureStart };
}

test('a take is recorded against the beat, cut to exactly one bar, and aligned by the pre-roll', async () => {
  const world = makeWorld();
  const looper = createLooper(world.engine, world.options);
  const seen = [];
  looper.onChange(state => seen.push(state.tracks[0].status));
  world.engine.start();
  world.engine.tick(5); // steps 0 to 4
  await looper.recordTrack(0, 1);
  assert.equal(looper.snapshot().tracks[0].status, 'count-in');
  const recorderStartTime = world.ctx.currentTime;

  world.engine.tick(27); // steps 5 to 31, just before the take starts
  assert.equal(looper.snapshot().tracks[0].status, 'count-in');
  world.engine.tick(1); // step 32 starts the take
  assert.equal(looper.snapshot().tracks[0].status, 'recording');
  const takeStartTime = world.engine.whenOf(32);

  world.engine.tick(19); // steps 33 to 51: one bar of audio plus margin not yet reached
  assert.equal(looper.snapshot().tracks[0].status, 'recording');
  world.engine.tick(1); // step 52 = 32 + 16 + 4: stop the recorder
  assert.equal(looper.snapshot().tracks[0].status, 'processing');
  await flush();

  const state = looper.snapshot();
  assert.equal(state.tracks[0].status, 'ready');
  assert.equal(state.tracks[0].hasTake, true);
  assert.equal(state.lockedBpm, 120);
  assert.deepEqual([...new Set(seen)], ['preparing', 'count-in', 'recording', 'processing', 'ready']);
  assert.equal(world.recorders[0].stopped, true);

  const frames = loopFrames(RATE, 120, 1);
  const dropped = Math.round((takeStartTime - recorderStartTime) * RATE);
  world.engine.tick(12); // steps 53 to 64: the next loop start
  const source = world.ctx.sources[0];
  assert.equal(source.buffer.length, frames, 'exactly one bar of frames');
  assert.equal(source.buffer.getChannelData(0)[5000], 5000 + dropped + 1, 'the pre-roll before the first beat was dropped');
  assert.equal(source.buffer.getChannelData(0)[0], 0, 'and the edge is faded');
});

test('the finished take plays on every loop start, at that step time and no other', async () => {
  const { world } = await recordedWorld();
  const first = world.engine.absolute; // 53
  world.engine.tick(64 - first + 1); // up to and including step 64
  assert.deepEqual(world.ctx.sources.map(source => source.startCalls[0]), [world.engine.whenOf(64)]);
  world.engine.tick(16);
  assert.deepEqual(world.ctx.sources.map(source => source.startCalls[0]), [world.engine.whenOf(64), world.engine.whenOf(80)]);
  const gain = world.ctx.sources[0].connections[0];
  assert.equal(gain.gain.value, 1);
  assert.equal(gain.connections[0].connections[0], world.engine.master, 'track gain, looper bus, then the master gain');
});

test('a two-bar take is two bars long, starts on a two-bar boundary and plays every two bars', async () => {
  const { world, looper, captureStart } = await recordedWorld({ bars: 2 });
  assert.equal(captureStart, 32);
  assert.equal(looper.snapshot().tracks[0].bars, 2);
  // The take finishes at step 68, after the step-64 boundary, so it first plays at step 96 and then every 32 steps.
  world.engine.tick(100 - world.engine.absolute + 1);
  assert.deepEqual(world.ctx.sources.map(source => source.startCalls[0]), [world.engine.whenOf(96)]);
  world.engine.tick(32);
  assert.deepEqual(world.ctx.sources.map(source => source.startCalls[0]), [world.engine.whenOf(96), world.engine.whenOf(128)]);
  assert.equal(world.ctx.sources[0].buffer.length, loopFrames(RATE, 120, 2));
});

test('the count-in is always at least one bar before a loop boundary', async () => {
  const world = makeWorld();
  const looper = createLooper(world.engine, world.options);
  world.engine.start();
  world.engine.tick(21); // steps 0 to 20, armed at step 20
  await looper.recordTrack(0, 1);
  world.engine.tick(27); // step 47: still counting in
  assert.equal(looper.snapshot().tracks[0].status, 'count-in');
  world.engine.tick(1); // step 48 = ceil((20 + 16) / 16) * 16
  assert.equal(looper.snapshot().tracks[0].status, 'recording');
});

test('recordTrack checks the transport, the arguments and whether another take is in progress', async () => {
  const world = makeWorld();
  const looper = createLooper(world.engine, world.options);
  await assert.rejects(looper.recordTrack(0, 1), { code: 'not-playing' });
  world.engine.start();
  world.engine.tick(3);
  await assert.rejects(looper.recordTrack(4, 1), RangeError);
  await assert.rejects(looper.recordTrack(-1, 1), RangeError);
  await assert.rejects(looper.recordTrack(0.5, 1), RangeError);
  await assert.rejects(looper.recordTrack(0, 3), RangeError);
  await looper.recordTrack(0, 1);
  await assert.rejects(looper.recordTrack(1, 1), { code: 'busy' });
  looper.cancelRecording();
  assert.equal(looper.snapshot().tracks[0].status, 'empty');
  assert.equal(world.recorders[0].discarded, true);
  await looper.recordTrack(1, 1); // allowed again after cancelling
});

test('the tempo is locked while loops exist: other tracks cannot record at a new tempo, and loops fall silent until it returns', async () => {
  const { world, looper } = await recordedWorld();
  world.engine.tick(64 - world.engine.absolute + 1);
  assert.equal(world.ctx.sources.length, 1);

  world.engine.bpm = 100;
  world.engine.tick(1);
  assert.equal(looper.snapshot().tempoMismatch, true);
  assert.deepEqual(world.ctx.sources[0].stopCalls.length, 1, 'the playing loop is stopped at once');
  world.engine.tick(32);
  assert.equal(world.ctx.sources.length, 1, 'nothing new is scheduled while the tempo is wrong');
  await assert.rejects(looper.recordTrack(1, 1), { code: 'tempo-locked' });

  world.engine.bpm = 120;
  world.engine.tick(1);
  assert.equal(looper.snapshot().tempoMismatch, false);
  world.engine.tick(32);
  assert.ok(world.ctx.sources.length >= 2, 'loops play again once the tempo is back');
});

test('changing the tempo while recording drops the take', async () => {
  const world = makeWorld();
  const looper = createLooper(world.engine, world.options);
  world.engine.start();
  world.engine.tick(3);
  await looper.recordTrack(0, 1);
  world.engine.bpm = 90;
  world.engine.tick(1);
  const track = looper.snapshot().tracks[0];
  assert.equal(track.status, 'empty');
  assert.match(track.message, /tempo changed/);
  assert.equal(world.recorders[0].discarded, true);
});

test('stopping the loop stops sounding takes, drops a recording in progress, and restarts from step 0', async () => {
  const { world, looper } = await recordedWorld();
  world.engine.tick(64 - world.engine.absolute + 1);
  world.engine.tick(3);
  await looper.recordTrack(1, 1);
  world.engine.stop();
  assert.equal(world.ctx.sources[0].stopCalls.length, 1);
  assert.equal(looper.snapshot().tracks[1].status, 'empty');
  assert.match(looper.snapshot().tracks[1].message, /loop stopped/);
  assert.equal(world.recorders[1].discarded, true);

  world.engine.start();
  world.engine.tick(1); // step 0 of the new run
  const lastSource = world.ctx.sources.at(-1);
  assert.equal(lastSource.startCalls[0], world.engine.whenOf(0), 'the saved loop plays again from the first step');
});

test('stopping the loop while the permission prompt is open cancels cleanly', async () => {
  let release;
  const world = makeWorld({ recorderStart: () => new Promise(resolve => { release = resolve; }) });
  const looper = createLooper(world.engine, world.options);
  world.engine.start();
  world.engine.tick(3);
  const pending = looper.recordTrack(0, 1);
  pending.catch(() => {});
  await flush();
  assert.equal(looper.snapshot().tracks[0].status, 'preparing');
  world.engine.stop();
  release();
  await assert.rejects(pending, { code: 'cancelled' });
  assert.equal(looper.snapshot().tracks[0].status, 'empty');
  assert.equal(world.recorders[0].discarded, true);
});

test('a microphone error leaves the track as it was and can be retried', async () => {
  let attempt = 0;
  const world = makeWorld({ recorderStart: async () => { if (attempt++ === 0) throw { code: 'denied', message: 'Microphone access was denied.' }; } });
  const looper = createLooper(world.engine, world.options);
  world.engine.start();
  world.engine.tick(3);
  await assert.rejects(looper.recordTrack(0, 1), { code: 'denied' });
  const track = looper.snapshot().tracks[0];
  assert.equal(track.status, 'empty');
  assert.equal(track.message, 'Microphone access was denied.');
  await looper.recordTrack(0, 1);
  assert.equal(looper.snapshot().tracks[0].status, 'count-in');
  assert.equal(looper.snapshot().tracks[0].message, '');
});

test('mute silences a track without dropping out of sync, and unmute brings it back', async () => {
  const { world, looper } = await recordedWorld();
  world.engine.tick(64 - world.engine.absolute + 1);
  const gain = world.ctx.sources[0].connections[0];
  looper.setMuted(0, true);
  assert.equal(gain.gain.value, 0);
  assert.equal(looper.snapshot().tracks[0].muted, true);
  world.engine.tick(16);
  assert.equal(world.ctx.sources.length, 2, 'the loop keeps being scheduled while muted');
  looper.setMuted(0, false);
  assert.equal(gain.gain.value, 1);
  assert.throws(() => looper.setMuted(9, true), RangeError);
});

test('muting before a track has a take is remembered', async () => {
  const world = makeWorld();
  const looper = createLooper(world.engine, world.options);
  looper.setMuted(0, true);
  assert.equal(looper.snapshot().tracks[0].muted, true);
});

test('the latency offset moves the cut-out point of the next take', async () => {
  const base = await recordedWorld();
  base.world.engine.tick(13);
  const reference = base.world.ctx.sources[0].buffer.getChannelData(0)[5000];

  const shifted = makeWorld();
  const looper = createLooper(shifted.engine, shifted.options);
  looper.setLatencyOffset(0.01);
  shifted.engine.start();
  shifted.engine.tick(5);
  await looper.recordTrack(0, 1);
  shifted.engine.tick(53 - shifted.engine.absolute);
  await flush();
  shifted.engine.tick(13);
  assert.equal(shifted.ctx.sources[0].buffer.getChannelData(0)[5000], reference + 480, '0.01 s at 48000 Hz is 480 more frames dropped');
  assert.equal(looper.snapshot().latencyOffset, 0.01);
  for (const bad of [0.6, -0.6, NaN, Infinity, '0.1', null]) assert.throws(() => looper.setLatencyOffset(bad), RangeError, String(bad));
});

test('clearing the last take unlocks the tempo, and clearing a track silences it', async () => {
  const { world, looper } = await recordedWorld();
  world.engine.tick(64 - world.engine.absolute + 1);
  looper.clearTrack(0);
  assert.equal(world.ctx.sources[0].stopCalls.length, 1);
  assert.equal(looper.snapshot().tracks[0].status, 'empty');
  assert.equal(looper.snapshot().lockedBpm, null);
  world.engine.bpm = 90;
  world.engine.tick(1);
  assert.equal(looper.snapshot().tempoMismatch, false, 'no takes means no tempo lock');
  await looper.recordTrack(0, 1);
  assert.throws(() => looper.clearTrack(7), RangeError);
});

test('re-recording replaces a take only after the new one succeeds', async () => {
  const world = makeWorld();
  let failNext = false;
  const options = { ...world.options, decode: async data => { if (failNext) throw new Error('decode failed'); return world.options.decode(data); } };
  const looper = createLooper(world.engine, options);
  world.engine.start();
  world.engine.tick(5);
  await looper.recordTrack(0, 1);
  world.engine.tick(53 - world.engine.absolute);
  await flush();
  assert.equal(looper.snapshot().tracks[0].status, 'ready');

  failNext = true;
  world.engine.tick(8);
  await looper.recordTrack(0, 1);
  world.engine.tick(60);
  await flush();
  const track = looper.snapshot().tracks[0];
  assert.equal(track.status, 'ready', 'the old take is kept when the new one fails');
  assert.equal(track.hasTake, true);
  assert.equal(track.message, 'decode failed');
});

test('a decode failure on a first take leaves the track empty with a message', async () => {
  const world = makeWorld();
  const looper = createLooper(world.engine, { ...world.options, decode: async () => { throw new Error('This audio could not be decoded.'); } });
  world.engine.start();
  world.engine.tick(5);
  await looper.recordTrack(0, 1);
  world.engine.tick(53 - world.engine.absolute);
  await flush();
  const track = looper.snapshot().tracks[0];
  assert.equal(track.status, 'empty');
  assert.equal(track.message, 'This audio could not be decoded.');
});

test('a skipped step does not break the loop count', async () => {
  const { world } = await recordedWorld();
  world.engine.tick(60 - world.engine.absolute); // up to step 59
  world.engine.absolute += 2; // the engine skips steps 60 and 61
  world.engine.tick(6); // 62, 63, then 64 where the loop starts
  assert.equal(world.ctx.sources.length, 1);
  assert.equal(world.ctx.sources[0].startCalls[0], world.engine.whenOf(64));
});

test('every track records and plays independently', async () => {
  const world = makeWorld();
  const looper = createLooper(world.engine, world.options);
  world.engine.start();
  let step = 0;
  for (const index of [0, 1]) {
    world.engine.tick(Math.max(0, 5 - (world.engine.absolute % 16)) + 0);
    await looper.recordTrack(index, 1);
    const target = Math.ceil((world.engine.absolute + 16) / 16) * 16 + 16 + 4 + 1;
    world.engine.tick(target - world.engine.absolute);
    await flush();
    step = world.engine.absolute;
  }
  const state = looper.snapshot();
  assert.deepEqual(state.tracks.map(track => track.status), ['ready', 'ready', 'empty', 'empty']);
  const nextStart = Math.ceil(step / 16) * 16;
  world.engine.tick(nextStart - world.engine.absolute + 1);
  const together = world.ctx.sources.filter(source => source.startCalls[0] === world.engine.whenOf(nextStart));
  assert.equal(together.length, 2, 'both takes start together on the same loop start');
  assert.notEqual(together[0].connections[0], together[1].connections[0], 'each track has its own gain');
});

test('dispose unsubscribes from the engine and silences everything', async () => {
  const { world, looper } = await recordedWorld();
  world.engine.tick(64 - world.engine.absolute + 1);
  looper.dispose();
  assert.equal(world.engine.handlers.step.size, 0);
  assert.equal(world.engine.handlers.stop.size, 0);
  assert.equal(world.ctx.sources[0].stopCalls.length, 1);
  const count = world.ctx.sources.length;
  world.engine.tick(32);
  assert.equal(world.ctx.sources.length, count);
});

test('createLooper needs a complete StepEngine', () => {
  assert.throws(() => createLooper(null), TypeError);
  assert.throws(() => createLooper({ on() {} }), TypeError);
});

test('the engine never uses timers of its own', async () => {
  const realSetTimeout = globalThis.setTimeout;
  const realSetInterval = globalThis.setInterval;
  let calls = 0;
  globalThis.setTimeout = () => { calls++; return 0; };
  globalThis.setInterval = () => { calls++; return 0; };
  try {
    const { world, looper } = await recordedWorld();
    world.engine.tick(70);
    looper.setMuted(0, true);
    world.engine.stop();
    looper.dispose();
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.setInterval = realSetInterval;
  }
  assert.equal(calls, 0);
});
