import test from 'node:test';
import assert from 'node:assert/strict';
import { chordName, createChordMode } from '../assets/js/chord-mode.js';
import { midiToFrequency } from '../assets/js/chord-theory.js';

const EPSILON = 1e-9;
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < EPSILON, `${message || 'value'}: ${actual} != ${expected}`);

function param(value = 0) {
  return {
    value,
    events: [],
    setValueAtTime(v, time) { this.events.push({ type: 'set', value: v, time }); },
    linearRampToValueAtTime(v, time) { this.events.push({ type: 'ramp', value: v, time }); },
    cancelScheduledValues(time) { this.events.push({ type: 'cancel', time }); },
    setTargetAtTime(v, time) { this.events.push({ type: 'target', value: v, time }); this.value = v; }
  };
}

function fakeContext() {
  const ctx = { currentTime: 0, all: [], oscillators: [], destination: null };
  const make = kind => {
    const node = {
      kind, connections: [], startCalls: [], stopCalls: [], type: '',
      gain: param(1), frequency: param(440), detune: param(0), Q: param(1),
      threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25),
      connect(to) { this.connections.push(to); return to; },
      disconnect() { this.connections = []; },
      start(time) { this.startCalls.push(time); },
      stop(time) { this.stopCalls.push(time); }
    };
    ctx.all.push(node);
    if (kind === 'oscillator') ctx.oscillators.push(node);
    return node;
  };
  ctx.make = make;
  ctx.destination = make('destination');
  ctx.createGain = () => make('gain');
  ctx.createOscillator = () => make('oscillator');
  ctx.createBiquadFilter = () => make('filter');
  ctx.createDynamicsCompressor = () => make('compressor');
  return ctx;
}

function fakeEngine(ctx = fakeContext()) {
  const handlers = { step: new Set(), stop: new Set() };
  const master = ctx.make('master');
  return {
    ctx, master, handlers,
    on(type, listener) { handlers[type].add(listener); return () => handlers[type].delete(listener); },
    getAudioContext: () => ctx,
    getMasterGain: () => master,
    step(step, when, stepDuration = 0.125) { handlers.step.forEach(listener => listener({ step, when, bpm: 120, stepDuration })); },
    stop() { handlers.stop.forEach(listener => listener()); }
  };
}

test('chordName names triads and sevenths in major and natural minor', () => {
  assert.equal(chordName([48, 52, 55]), 'C');
  assert.equal(chordName([50, 53, 57]), 'Dm');
  assert.equal(chordName([59, 62, 65]), 'Bdim');
  assert.equal(chordName([48, 52, 55, 59]), 'Cmaj7');
  assert.equal(chordName([55, 59, 62, 65]), 'G7');
  assert.equal(chordName([57, 60, 64, 67]), 'Am7');
  assert.equal(chordName([59, 62, 65, 69]), 'Bm7b5');
  assert.equal(chordName([49, 53, 56]), 'C#');
  assert.equal(chordName([48, 50, 55]), 'C?', 'a shape outside the known chords is marked, not guessed');
  assert.throws(() => chordName([60, 64]), TypeError);
  assert.throws(() => chordName('C'), TypeError);
});

test('plan names come out right for each progression and voicing', () => {
  const names = settings => createChordMode(fakeEngine(), settings).getPlan().map(item => item.name);
  assert.deepEqual(names({ key: 'C', progressionId: 'I-V-vi-IV' }), ['C', 'G', 'Am', 'F']);
  assert.deepEqual(names({ key: 'C', progressionId: 'I-V-vi-IV', voicing: 'seventh' }), ['Cmaj7', 'G7', 'Am7', 'Fmaj7']);
  assert.deepEqual(names({ key: 'A', progressionId: 'i-iv-v-i' }), ['Am', 'Dm', 'Em', 'Am']);
  assert.deepEqual(names({ key: 'C', progressionId: 'i-VI-III-VII' }), ['Cm', 'G#', 'D#', 'A#']);
  const plan = createChordMode(fakeEngine()).getPlan();
  assert.deepEqual(plan.map(item => item.step), [0, 4, 8, 12]);
});

test('constructor rejects a bad engine and bad settings', () => {
  assert.throws(() => createChordMode(null), TypeError);
  assert.throws(() => createChordMode({}), TypeError);
  assert.throws(() => createChordMode(fakeEngine(), { key: 'H' }), RangeError);
  assert.throws(() => createChordMode(fakeEngine(), { volume: 3 }), RangeError);
  assert.throws(() => createChordMode(fakeEngine(), { volume: -1 }), RangeError);
});

test('does nothing until it is enabled', () => {
  const engine = fakeEngine();
  const mode = createChordMode(engine);
  assert.equal(mode.isEnabled(), false);
  [0, 4, 8, 12].forEach(step => engine.step(step, 1));
  assert.equal(engine.ctx.oscillators.length, 0);
  assert.equal(engine.ctx.all.filter(node => node.kind === 'gain').length, 0, 'no audio nodes are built while disabled');
});

test('schedules a chord on beats 0, 4, 8 and 12 only, on the exact step time', () => {
  const engine = fakeEngine();
  const mode = createChordMode(engine);
  mode.setEnabled(true);
  for (let step = 0; step < 16; step++) engine.step(step, 2 + step * 0.125);
  assert.equal(engine.ctx.oscillators.length, 4 * 3 * 2, 'four triads of two oscillators per note');
  const starts = [...new Set(engine.ctx.oscillators.flatMap(oscillator => oscillator.startCalls))];
  assert.deepEqual(starts.map(time => Number(time.toFixed(6))), [2, 2.5, 3, 3.5]);
});

test('the first chord is C major with each chord held for four steps', () => {
  const engine = fakeEngine();
  const mode = createChordMode(engine);
  mode.setEnabled(true);
  engine.step(0, 1, 0.125);
  const frequencies = engine.ctx.oscillators.map(oscillator => oscillator.frequency.value);
  for (const note of [48, 52, 55]) assert.equal(frequencies.filter(value => Math.abs(value - midiToFrequency(note)) < 1e-6).length, 2, `note ${note}`);
  // hold 4 x 0.125 = 0.5s, release 0.35s and the 0.05s tail from synth-voice
  engine.ctx.oscillators.forEach(oscillator => near(oscillator.stopCalls[0], 1 + 0.5 + 0.35 + 0.05, 'stop time'));
});

test('sound goes through a pad bus and limiter into the master gain, never ctx.destination', () => {
  const engine = fakeEngine();
  const mode = createChordMode(engine);
  mode.setEnabled(true);
  engine.step(0, 1);
  const intoMaster = engine.ctx.all.filter(node => node.connections.includes(engine.master));
  assert.equal(intoMaster.length, 1);
  assert.equal(intoMaster[0].kind, 'compressor');
  const bus = engine.ctx.all.find(node => node.connections.includes(intoMaster[0]));
  assert.equal(bus.kind, 'gain');
  assert.ok(engine.ctx.all.every(node => !node.connections.includes(engine.ctx.destination)), 'nothing bypasses the master');
  assert.equal(engine.ctx.all.filter(node => node.kind === 'compressor').length, 1);
  engine.step(4, 1.5);
  assert.equal(engine.ctx.all.filter(node => node.kind === 'compressor').length, 1, 'the bus is built once, not per chord');
});

test('pad volume sets the bus gain, including before the bus exists', () => {
  const engine = fakeEngine();
  const mode = createChordMode(engine, { volume: 0.5 });
  mode.setEnabled(true);
  engine.step(0, 1);
  const compressor = engine.ctx.all.find(node => node.kind === 'compressor');
  const bus = engine.ctx.all.find(node => node.connections.includes(compressor));
  assert.equal(bus.gain.value, 0.5);
  mode.update({ volume: 1.5 });
  assert.equal(bus.gain.events.at(-1).type, 'target');
  assert.equal(bus.gain.value, 1.5);
});

test('settings change applies from the next chord and keeps the old plan if invalid', () => {
  const engine = fakeEngine();
  const mode = createChordMode(engine);
  const before = mode.getPlan();
  assert.throws(() => mode.update({ key: 'H' }), RangeError);
  assert.throws(() => mode.update({ progressionId: 'nope' }), RangeError);
  assert.throws(() => mode.update({ volume: 5 }), RangeError);
  assert.deepEqual(mode.getPlan(), before, 'plan is unchanged after rejected updates');
  assert.equal(mode.settings.key, 'C');
  mode.update({ key: 'D' });
  assert.deepEqual(mode.getPlan()[0].notes, before[0].notes.map(note => note + 2));
  mode.setEnabled(true);
  engine.step(0, 1);
  assert.ok(engine.ctx.oscillators.some(oscillator => Math.abs(oscillator.frequency.value - midiToFrequency(50)) < 1e-6));
});

test('reports each scheduled chord and the stop to listeners', () => {
  const engine = fakeEngine();
  const mode = createChordMode(engine);
  mode.setEnabled(true);
  const seen = [];
  const off = mode.onChord(event => seen.push(event));
  [0, 4, 8, 12].forEach((step, index) => engine.step(step, 1 + index));
  engine.stop();
  assert.deepEqual(seen, [
    { index: 0, name: 'C', when: 1 }, { index: 1, name: 'G', when: 2 },
    { index: 2, name: 'Am', when: 3 }, { index: 3, name: 'F', when: 4 }, null
  ]);
  off();
  engine.step(0, 9);
  assert.equal(seen.length, 5, 'unsubscribed listeners hear nothing');
});

test('Stop ends sounding chords, and the next loop plays chords again', () => {
  const engine = fakeEngine();
  const mode = createChordMode(engine);
  mode.setEnabled(true);
  engine.step(0, 1);
  engine.ctx.currentTime = 1.2;
  engine.stop();
  engine.ctx.oscillators.forEach(oscillator => {
    assert.equal(oscillator.stopCalls.length, 2, 'stopped a second time with a release');
    assert.ok(oscillator.stopCalls[1] < oscillator.stopCalls[0], 'earlier than the natural end');
  });
  const count = engine.ctx.oscillators.length;
  engine.step(0, 3);
  assert.equal(engine.ctx.oscillators.length, count + 6, 'a new loop schedules chords again');
});

test('turning chords off stops what is sounding and schedules nothing more', () => {
  const engine = fakeEngine();
  const mode = createChordMode(engine);
  const seen = [];
  mode.onChord(event => seen.push(event));
  mode.setEnabled(true);
  engine.step(0, 1);
  mode.setEnabled(false);
  assert.equal(mode.isEnabled(), false);
  assert.ok(engine.ctx.oscillators.every(oscillator => oscillator.stopCalls.length === 2));
  assert.equal(seen.at(-1), null, 'listeners are told to clear');
  const count = engine.ctx.oscillators.length;
  engine.step(4, 2);
  assert.equal(engine.ctx.oscillators.length, count);
});

test('ignores out-of-range steps', () => {
  const engine = fakeEngine();
  createChordMode(engine).setEnabled(true);
  [-1, 16, 99, 0.5].forEach(step => engine.step(step, 1));
  assert.equal(engine.ctx.oscillators.length, 0);
});

test('dispose unsubscribes from the engine and stops everything', () => {
  const engine = fakeEngine();
  const mode = createChordMode(engine);
  mode.setEnabled(true);
  engine.step(0, 1);
  mode.dispose();
  assert.equal(engine.handlers.step.size, 0);
  assert.equal(engine.handlers.stop.size, 0);
  const count = engine.ctx.oscillators.length;
  engine.step(4, 2);
  assert.equal(engine.ctx.oscillators.length, count);
});

test('never uses timers; all timing comes from the engine and the audio clock', () => {
  const realSetTimeout = globalThis.setTimeout;
  const realSetInterval = globalThis.setInterval;
  let calls = 0;
  globalThis.setTimeout = () => { calls++; return 0; };
  globalThis.setInterval = () => { calls++; return 0; };
  try {
    const engine = fakeEngine();
    const mode = createChordMode(engine);
    mode.setEnabled(true);
    [0, 4, 8, 12].forEach(step => engine.step(step, 1 + step * 0.1));
    mode.update({ key: 'E', voicing: 'seventh' });
    engine.stop();
    mode.dispose();
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.setInterval = realSetInterval;
  }
  assert.equal(calls, 0);
});
