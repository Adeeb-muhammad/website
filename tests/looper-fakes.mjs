// Shared fake browser audio for the looper tests. There is no real AudioContext, microphone or clock here: the
// fakes record the node graph, scheduling calls and audio buffers so tests can assert on them.
//
// The recorder resolves its result asynchronously on purpose. A fake that finished instantly would hide the
// ordering bugs around stop() and decode(), which is exactly what the latency-freeze test is about.
import { createLooper } from '../assets/js/looper.js';

export const STEP = 0.125; // seconds per 16th step at 120 BPM
export const RATE = 48000;
export const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };

export function makeNode(kind) {
  return {
    kind, connections: [], startCalls: [], stopCalls: [], buffer: null, onended: null,
    // `timeline` records scheduled gain automation in order. Values are not applied instantly, so a test can see
    // exactly when a ramp starts and ends, and that it starts from the value in force when the stop was requested.
    gain: {
      value: 1,
      calls: [],
      timeline: [],
      setTargetAtTime(value, time) { this.value = value; this.calls.push({ value, time }); },
      setValueAtTime(value, time) { this.timeline.push({ type: 'set', value, time }); return this; },
      linearRampToValueAtTime(value, time) { this.timeline.push({ type: 'linear', value, time }); return this; }
    },
    connect(to) { this.connections.push(to); return to; },
    disconnect() { this.connections = []; },
    start(time) { this.startCalls.push(time); },
    stop(time) { this.stopCalls.push(time); }
  };
}

// `stopTurns` is how many microtasks the fake recorder takes to resolve its result. The default (1) matches the
// original fakes; a larger number gives a test a wider window to act while stop()/decode() are still pending.
export function makeWorld({ bpm = 120, signal = null, recorderStart = null, stopTurns = 1 } = {}) {
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
            for (let turn = 0; turn < stopTurns; turn++) await Promise.resolve();
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
export async function recordedWorld({ index = 0, bars = 1, armAt = 4, ...worldOptions } = {}) {
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
