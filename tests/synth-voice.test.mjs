import test from 'node:test';
import assert from 'node:assert/strict';
import { playChord } from '../assets/js/synth-voice.js';
import { midiToFrequency } from '../assets/js/chord-theory.js';

// Audio times are floating point sums, so compare them with a tolerance.
const EPSILON = 1e-9;
const assertNear = (actual, expected, message) => {
  assert.ok(Math.abs(actual - expected) <= EPSILON, message ?? `expected ${expected}, got ${actual}`);
};
const assertTimes = (actual, expected, message) => {
  assert.equal(actual.length, expected.length, message ?? `expected ${expected.length} times, got ${actual.length}`);
  actual.forEach((time, index) => assertNear(time, expected[index], `${message ?? 'time'} #${index}`));
};
const assertAutomation = (param, expected) => {
  assert.deepEqual(param.events.map(event => event.type), expected.map(event => event.type));
  expected.forEach((want, index) => {
    const got = param.events[index];
    if ('value' in want) assertNear(got.value, want.value, `value at event ${index}`);
    assertNear(got.time, want.time, `time at event ${index}`);
  });
};

// --- Minimal fake AudioContext ------------------------------------------------
// It records the graph and every scheduling call instead of making sound.

function fakeParam(value = 0) {
  return {
    value,
    events: [],
    setValueAtTime(next, time) {
      this.events.push({ type: 'set', value: next, time });
      this.value = next;
      return this;
    },
    linearRampToValueAtTime(next, time) {
      this.events.push({ type: 'ramp', value: next, time });
      this.value = next;
      return this;
    },
    cancelScheduledValues(time) {
      this.events.push({ type: 'cancel', time });
      return this;
    },
  };
}

function fakeNode(kind) {
  return {
    kind,
    connections: [],
    disconnectCalls: 0,
    connect(target) {
      this.connections.push(target);
      return target;
    },
    disconnect() {
      this.disconnectCalls += 1;
    },
  };
}

function fakeContext(currentTime = 0) {
  const ctx = {
    currentTime,
    destination: fakeNode('destination'),
    oscillators: [],
    gains: [],
    filters: [],
  };
  ctx.createOscillator = () => {
    const node = fakeNode('oscillator');
    node.type = 'sine';
    node.frequency = fakeParam(0);
    node.detune = fakeParam(0);
    node.startCalls = [];
    node.stopCalls = [];
    node.start = time => node.startCalls.push(time);
    node.stop = time => node.stopCalls.push(time);
    node.onended = null;
    ctx.oscillators.push(node);
    return node;
  };
  ctx.createGain = () => {
    const node = fakeNode('gain');
    node.gain = fakeParam(1);
    ctx.gains.push(node);
    return node;
  };
  ctx.createBiquadFilter = () => {
    const node = fakeNode('filter');
    node.type = 'lowpass';
    node.frequency = fakeParam(350);
    ctx.filters.push(node);
    return node;
  };
  return ctx;
}

const envelopeOf = ctx => ctx.gains.find(gain => gain.connections.includes(ctx.filters[0]));

// --- Graph shape ---------------------------------------------------------------

test('creates two oscillators per note plus one shared envelope and filter', () => {
  const ctx = fakeContext();
  playChord(ctx, ctx.destination, [60, 64, 67], 1, 2);
  assert.equal(ctx.oscillators.length, 6);
  assert.equal(ctx.gains.length, 7, 'six voice gains and one envelope');
  assert.equal(ctx.filters.length, 1);
});

test('tunes each oscillator to its note and detunes the pair apart', () => {
  const ctx = fakeContext();
  const notes = [48, 55, 64];
  playChord(ctx, ctx.destination, notes, 0, 1, { detune: 9 });
  notes.forEach((note, index) => {
    const sharp = ctx.oscillators[index * 2];
    const flat = ctx.oscillators[index * 2 + 1];
    assert.equal(sharp.frequency.value, midiToFrequency(note));
    assert.equal(flat.frequency.value, midiToFrequency(note));
    assert.equal(sharp.detune.value, 9);
    assert.equal(flat.detune.value, -9);
    assert.equal(sharp.type, 'sawtooth');
    assert.equal(flat.type, 'sawtooth');
  });
});

test('honours the waveform option', () => {
  const ctx = fakeContext();
  playChord(ctx, ctx.destination, [60], 0, 1, { waveform: 'square' });
  assert.ok(ctx.oscillators.every(oscillator => oscillator.type === 'square'));
});

test('gives every oscillator its own gain of 1 / (2 * noteCount)', () => {
  const ctx = fakeContext();
  const notes = [60, 64, 67, 71];
  playChord(ctx, ctx.destination, notes, 0, 1);
  const envelope = envelopeOf(ctx);
  const voiceGains = ctx.gains.filter(gain => gain !== envelope);
  assert.equal(voiceGains.length, notes.length * 2);
  for (const gain of voiceGains) assert.equal(gain.gain.value, 1 / (2 * notes.length));
});

test('connects osc -> gain -> envelope -> lowpass filter -> destination', () => {
  const ctx = fakeContext();
  const notes = [60, 67];
  playChord(ctx, ctx.destination, notes, 0, 1, { cutoff: 900 });

  const envelope = envelopeOf(ctx);
  const filter = ctx.filters[0];
  assert.ok(envelope, 'one gain feeds the filter');
  assert.equal(envelope.connections.length, 1);
  assert.equal(envelope.connections[0], filter);

  assert.equal(filter.type, 'lowpass');
  assert.equal(filter.frequency.value, 900);
  assert.deepEqual(filter.connections, [ctx.destination]);

  for (const oscillator of ctx.oscillators) {
    assert.equal(oscillator.connections.length, 1);
    const voice = oscillator.connections[0];
    assert.equal(voice.kind, 'gain');
    assert.notEqual(voice, envelope);
    assert.deepEqual(voice.connections, [envelope]);
  }
});

// --- Envelope and timing -------------------------------------------------------

test('schedules the documented envelope shape', () => {
  const ctx = fakeContext();
  playChord(ctx, ctx.destination, [60], 1, 2);
  assertAutomation(envelopeOf(ctx).gain, [
    { type: 'set', value: 0, time: 1 },
    { type: 'ramp', value: 0.22, time: 1.04 },
    { type: 'set', value: 0.22, time: 3 },
    { type: 'ramp', value: 0, time: 3.35 },
  ]);
});

test('applies custom level and attack to the envelope', () => {
  const ctx = fakeContext();
  playChord(ctx, ctx.destination, [60], 0, 1, { level: 0.5, attack: 0.2, release: 0.1 });
  assertAutomation(envelopeOf(ctx).gain, [
    { type: 'set', value: 0, time: 0 },
    { type: 'ramp', value: 0.5, time: 0.2 },
    { type: 'set', value: 0.5, time: 1 },
    { type: 'ramp', value: 0, time: 1.1 },
  ]);
});

test('starts and stops oscillators around the envelope', () => {
  const ctx = fakeContext();
  const chord = playChord(ctx, ctx.destination, [60, 64], 5, 2);
  assertNear(chord.endTime, 7.35);
  for (const oscillator of ctx.oscillators) {
    assertTimes(oscillator.startCalls, [5]);
    assertTimes(oscillator.stopCalls, [7.4], 'envelope end plus the 0.05 tail');
  }
});

test('clamps attack to a duration that is shorter than it', () => {
  const ctx = fakeContext();
  const chord = playChord(ctx, ctx.destination, [60], 0, 0.01, { attack: 0.04 });
  assertAutomation(envelopeOf(ctx).gain, [
    { type: 'set', value: 0, time: 0 },
    { type: 'ramp', value: 0.22, time: 0.01 },
    { type: 'set', value: 0.22, time: 0.01 },
    { type: 'ramp', value: 0, time: 0.36 },
  ]);
  assertNear(chord.endTime, 0.36);
});

test('clamps a start time in the past to ctx.currentTime', () => {
  const ctx = fakeContext(10);
  const chord = playChord(ctx, ctx.destination, [60], 4, 2);
  assertNear(chord.endTime, 12.35);
  for (const oscillator of ctx.oscillators) {
    assertTimes(oscillator.startCalls, [10]);
    assertTimes(oscillator.stopCalls, [12.4]);
  }
  assertTimes(envelopeOf(ctx).gain.events.map(event => event.time), [10, 10.04, 12, 12.35]);
});

test('never schedules timers', () => {
  const realSetTimeout = globalThis.setTimeout;
  const realSetInterval = globalThis.setInterval;
  let calls = 0;
  globalThis.setTimeout = () => {
    calls += 1;
    return 0;
  };
  globalThis.setInterval = () => {
    calls += 1;
    return 0;
  };
  try {
    const ctx = fakeContext();
    playChord(ctx, ctx.destination, [60, 64, 67], 0, 1);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.setInterval = realSetInterval;
  }
  assert.equal(calls, 0);
});

// --- stop() ---------------------------------------------------------------------

test('stop() ramps the envelope down and is idempotent', () => {
  const ctx = fakeContext();
  const chord = playChord(ctx, ctx.destination, [60, 64], 0, 4);
  assertNear(chord.endTime, 4.35);

  chord.stop(1.5);
  const envelope = envelopeOf(ctx);
  assertAutomation(
    { events: envelope.gain.events.slice(-3) },
    [
      { type: 'cancel', time: 1.5 },
      { type: 'ramp', value: 0.22, time: 1.5 },
      { type: 'ramp', value: 0, time: 1.85 },
    ],
  );
  assertNear(chord.endTime, 1.85, 'endTime follows the early stop');
  for (const oscillator of ctx.oscillators) assertTimes(oscillator.stopCalls, [4.4, 1.9]);

  const events = envelope.gain.events.length;
  const stops = ctx.oscillators.map(oscillator => oscillator.stopCalls.length);
  chord.stop(1.2); // earlier than the first stop, so only the repeat guard can block it
  assertNear(chord.endTime, 1.85);
  assert.equal(envelope.gain.events.length, events, 'second stop adds no automation');
  assert.deepEqual(ctx.oscillators.map(oscillator => oscillator.stopCalls.length), stops);
});

test('stop() before the peak ramps from the current attack value', () => {
  const ctx = fakeContext();
  const chord = playChord(ctx, ctx.destination, [60], 0, 4, { attack: 1, level: 1 });
  chord.stop(0.25);
  const events = envelopeOf(ctx).gain.events;
  const anchor = events.at(-2);
  assert.equal(anchor.type, 'ramp');
  assertNear(anchor.value, 0.25, 'a quarter of the way up a one second attack');
});

test('stop() does nothing once the chord has ended', () => {
  const ctx = fakeContext();
  const chord = playChord(ctx, ctx.destination, [60], 0, 1);
  const envelope = envelopeOf(ctx);
  const events = envelope.gain.events.length;

  ctx.currentTime = 99;
  chord.stop();
  assert.equal(envelope.gain.events.length, events);
  assertNear(chord.endTime, 1.35);

  const late = fakeContext();
  const lateChord = playChord(late, late.destination, [60], 0, 1);
  const lateEvents = envelopeOf(late).gain.events.length;
  lateChord.stop(50);
  assert.equal(envelopeOf(late).gain.events.length, lateEvents);
  assertNear(lateChord.endTime, 1.35);
});

test('plays into the destination it is given, never ctx.destination', () => {
  const ctx = fakeContext();
  const output = fakeNode('master-gain');
  playChord(ctx, output, [60, 64, 67], 0, 1);
  assert.deepEqual(ctx.filters[0].connections, [output]);
  const everyNode = [...ctx.gains, ...ctx.filters, ...ctx.oscillators];
  assert.ok(everyNode.every(node => !node.connections.includes(ctx.destination)), 'nothing bypasses the given destination');
});

test('stop() during the natural release changes nothing and keeps the natural end', () => {
  const ctx = fakeContext();
  const chord = playChord(ctx, ctx.destination, [60, 64], 0, 1); // holds to 1, releases to 1.35
  const envelope = envelopeOf(ctx);
  const events = envelope.gain.events.length;
  const stops = ctx.oscillators.map(oscillator => oscillator.stopCalls.length);
  chord.stop(1.2);
  assert.equal(envelope.gain.events.length, events, 'no new automation');
  assert.deepEqual(ctx.oscillators.map(oscillator => oscillator.stopCalls.length), stops);
  assertNear(chord.endTime, 1.35, 'the tail is not stretched past its natural end');
});

// Evaluates recorded gain automation the way Web Audio does: cancelScheduledValues(T) drops
// events at or after T, and a linear ramp interpolates from the previous event to its own time.
function gainCurve(events, initial = 1) {
  let timeline = [];
  for (const event of events) {
    if (event.type === 'cancel') timeline = timeline.filter(item => item.time < event.time);
    else {
      timeline.push(event);
      timeline.sort((a, b) => a.time - b.time);
    }
  }
  return time => {
    let previous = null;
    let next = null;
    for (const item of timeline) {
      if (item.time <= time) previous = item;
      else {
        next = item;
        break;
      }
    }
    if (!previous) return initial;
    if (next && next.type === 'ramp') return previous.value + (next.value - previous.value) * ((time - previous.time) / (next.time - previous.time));
    return previous.value;
  };
}

test('stop() never makes the volume jump, whenever it is called or scheduled', () => {
  // Chord starts at 1.5, peaks at 1.54, holds to 2.5, releases to 2.85. A step above
  // 0.02 in one millisecond (about 10% of the 0.22 peak) would be an audible click.
  const MAX_STEP = 0.02;
  const scenarios = [
    { name: 'scheduled inside the attack', now: 1, at: 1.52 },
    { name: 'scheduled inside the hold', now: 1, at: 2 },
    { name: 'scheduled inside the release', now: 1, at: 2.6 },
    { name: 'called now, during the attack', now: 1.52, at: 1.52 },
    { name: 'called now, during the hold', now: 1.9, at: 1.9 },
    { name: 'called now, during the release', now: 2.6, at: 2.6 },
  ];
  for (const scenario of scenarios) {
    const ctx = fakeContext(1);
    const chord = playChord(ctx, ctx.destination, [60, 64, 67], 1.5, 1);
    ctx.currentTime = scenario.now; // audio before `now` has already been played
    chord.stop(scenario.at);

    const level = gainCurve(envelopeOf(ctx).gain.events);
    assert.ok(chord.endTime <= 2.85 + EPSILON, `${scenario.name}: ends no later than the natural end`);
    assertNear(level(chord.endTime), 0, `${scenario.name}: silent at the end`);
    let previous = level(Math.max(scenario.now, 1.5));
    let worst = 0;
    for (let time = Math.max(scenario.now, 1.5) + 0.001; time <= chord.endTime; time += 0.001) {
      const value = level(time);
      worst = Math.max(worst, Math.abs(value - previous));
      previous = value;
    }
    assert.ok(worst <= MAX_STEP, `${scenario.name}: largest one-millisecond step was ${worst.toFixed(4)}`);
  }
});

test('disconnects every node only when the last oscillator ends', () => {
  const ctx = fakeContext();
  playChord(ctx, ctx.destination, [60, 64], 0, 1);
  const nodes = [...ctx.oscillators, ...ctx.gains, ...ctx.filters];
  assert.equal(nodes.length, 4 + 5 + 1);

  ctx.oscillators.slice(0, -1).forEach(oscillator => oscillator.onended());
  assert.ok(nodes.every(node => node.disconnectCalls === 0), 'no teardown while a voice still rings');

  ctx.oscillators.at(-1).onended();
  assert.ok(nodes.every(node => node.disconnectCalls === 1), 'every node is disconnected exactly once');
});

// --- Validation ------------------------------------------------------------------

test('throws TypeError for wrong types', () => {
  const ctx = fakeContext();
  const call = (...args) => () => playChord(ctx, ctx.destination, ...args);

  assert.throws(call('60', 0, 1), TypeError, 'midiNotes must be an array');
  assert.throws(call([60, '64'], 0, 1), TypeError, 'notes must be numbers');
  assert.throws(call([60], '0', 1), TypeError, 'when must be a number');
  assert.throws(call([60], 0, '1'), TypeError, 'duration must be a number');
  assert.throws(call([60], 0, 1, { attack: '0.04' }), TypeError, 'attack must be a number');
  assert.throws(call([60], 0, 1, { release: '0.35' }), TypeError, 'release must be a number');
  assert.throws(call([60], 0, 1, { level: '0.2' }), TypeError, 'level must be a number');
  assert.throws(call([60], 0, 1, { waveform: 1 }), TypeError, 'waveform must be a string');
});

test('throws RangeError for bad values', () => {
  const ctx = fakeContext();
  const call = (...args) => () => playChord(ctx, ctx.destination, ...args);

  assert.throws(call([], 0, 1), RangeError, 'empty note list');
  assert.throws(call([60, 60, 60, 60, 60, 60, 60, 60, 60], 0, 1), RangeError, 'nine notes');
  assert.throws(call([60, Number.NaN], 0, 1), RangeError, 'NaN note');
  assert.throws(call([60, Number.POSITIVE_INFINITY], 0, 1), RangeError, 'infinite note');
  assert.throws(call([60], Number.NaN, 1), RangeError, 'NaN start');
  assert.throws(call([60], 0, 0), RangeError, 'zero duration');
  assert.throws(call([60], 0, -1), RangeError, 'negative duration');
  assert.throws(call([60], 0, Number.NaN), RangeError, 'NaN duration');
  assert.throws(call([60], 0, 1, { attack: 0 }), RangeError, 'attack below the minimum');
  assert.throws(call([60], 0, 1, { attack: 0.0005 }), RangeError, 'attack below 1ms');
  assert.throws(call([60], 0, 1, { release: 0 }), RangeError, 'release below the minimum');
  assert.throws(call([60], 0, 1, { level: 0 }), RangeError, 'level of zero');
  assert.throws(call([60], 0, 1, { level: 1.5 }), RangeError, 'level above one');
  assert.throws(call([60], 0, 1, { waveform: 'noise' }), RangeError, 'unknown waveform');
});
