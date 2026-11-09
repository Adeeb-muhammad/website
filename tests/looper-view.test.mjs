import test from 'node:test';
import assert from 'node:assert/strict';
import { describeLooperState, formatOffset, looperMessageFor, offsetFromMilliseconds } from '../assets/js/looper-view.js';

const track = (index, extra = {}) => ({ index, status: 'empty', bars: 1, muted: false, hasTake: false, message: '', ...extra });
const snap = (tracks, extra = {}) => ({ tracks, lockedBpm: null, tempoMismatch: false, latencyOffset: 0, ...extra });
const four = (overrides = {}) => [0, 1, 2, 3].map(index => track(index, overrides[index]));
const view = (snapshot, options = {}) => describeLooperState({ snapshot, playing: true, supported: true, ...options });

test('formatOffset and offsetFromMilliseconds', () => {
  assert.equal(formatOffset(0), '0 ms');
  assert.equal(formatOffset(0.025), '+25 ms');
  assert.equal(formatOffset(-0.01), '-10 ms');
  assert.equal(formatOffset(0.0004), '0 ms');
  for (const bad of [NaN, Infinity, undefined, null]) assert.equal(formatOffset(bad), '0 ms', String(bad));
  assert.equal(offsetFromMilliseconds(25), 0.025);
  assert.equal(offsetFromMilliseconds(-250), -0.25);
  assert.equal(offsetFromMilliseconds(9999), 0.5);
  assert.equal(offsetFromMilliseconds(-9999), -0.5);
  assert.equal(offsetFromMilliseconds('abc'), 0);
  assert.equal(offsetFromMilliseconds(NaN), 0);
});

test('looperMessageFor stays silent for cancel and discard and otherwise gives a message', () => {
  assert.equal(looperMessageFor({ code: 'cancelled', message: 'x' }), null);
  assert.equal(looperMessageFor({ code: 'discarded', message: 'x' }), null);
  assert.equal(looperMessageFor(null), null);
  assert.equal(looperMessageFor({ code: 'tempo-locked', message: 'Set the tempo back.' }), 'Set the tempo back.');
  assert.match(looperMessageFor({ code: 'x' }), /Please try again/);
  assert.match(looperMessageFor(new Error('boom')), /boom/);
});

test('record is only possible while the loop plays and nothing else is recording', () => {
  const idle = view(snap(four()));
  assert.ok(idle.tracks.every(item => item.canRecord && item.recordEnabled && item.recordLabel === '● REC'));
  const stopped = view(snap(four()), { playing: false });
  assert.ok(stopped.tracks.every(item => !item.canRecord && !item.recordEnabled));
  assert.match(stopped.banner.text, /START LOOP/);
  const unsupported = view(snap(four()), { supported: false });
  assert.ok(unsupported.tracks.every(item => !item.recordEnabled && item.barsDisabled && !item.canClear && !item.canMute));
  assert.equal(unsupported.banner.tone, 'error');
  assert.match(unsupported.banner.text, /not supported/);
});

test('while one track records, only that track can be cancelled and the others are blocked', () => {
  for (const status of ['preparing', 'count-in', 'recording']) {
    const result = view(snap(four({ 1: { status } })));
    assert.equal(result.tracks[1].recordLabel, 'CANCEL', status);
    assert.equal(result.tracks[1].canCancel, true, status);
    assert.equal(result.tracks[1].recordEnabled, true, status);
    for (const other of [0, 2, 3]) assert.equal(result.tracks[other].recordEnabled, false, `${status} blocks track ${other}`);
    assert.ok(result.tracks.every(item => item.barsDisabled), `${status} locks the length selectors`);
  }
});

test('a take that is being saved cannot be cancelled', () => {
  const result = view(snap(four({ 2: { status: 'processing' } })));
  assert.equal(result.tracks[2].canCancel, false);
  assert.equal(result.tracks[2].recordEnabled, false);
  assert.equal(result.tracks[2].recordLabel, 'SAVING...');
  assert.equal(result.banner.text, 'Saving your take.');
});

test('ready tracks can be replaced, muted and cleared; empty ones cannot be muted or cleared', () => {
  const result = view(snap(four({ 0: { status: 'ready', hasTake: true, muted: true, bars: 2 } }), { lockedBpm: 110 }));
  const [ready, empty] = result.tracks;
  assert.equal(ready.recordLabel, '● RE-REC');
  assert.equal(ready.recordEnabled, true);
  assert.deepEqual([ready.canClear, ready.canMute, ready.muted, ready.bars, ready.statusLabel, ready.tone], [true, true, true, 2, 'READY', 'ok']);
  assert.deepEqual([empty.canClear, empty.canMute, empty.statusLabel, empty.tone], [false, false, 'EMPTY', 'idle']);
  assert.equal(result.lockText, 'TEMPO LOCKED AT 110 BPM');
  assert.equal(view(snap(four())).lockText, '');
  assert.match(result.banner.text, /Loops play on the beat/);
});

test('a tempo mismatch blocks recording and says exactly what to do', () => {
  const result = view(snap(four({ 0: { status: 'ready', hasTake: true } }), { lockedBpm: 110, tempoMismatch: true }));
  assert.ok(result.tracks.every(item => !item.canRecord));
  assert.equal(result.tracks[0].canClear, true, 'clearing is still allowed so the lock can be released');
  assert.match(result.banner.text, /110 BPM/);
  assert.equal(result.banner.tone, 'error');
});

test('track messages (errors) win over guidance, and each phase has its own banner', () => {
  assert.equal(view(snap(four({ 3: { message: 'Microphone access was denied.' } }))).banner.text, 'Microphone access was denied.');
  assert.match(view(snap(four({ 0: { status: 'preparing' } }))).banner.text, /permission/);
  assert.match(view(snap(four({ 0: { status: 'count-in' } }))).banner.text, /Counting in/);
  assert.match(view(snap(four({ 0: { status: 'recording' } }))).banner.text, /Recording/);
  assert.match(view(snap(four())).banner.text, /first loop/);
  const tones = ['preparing', 'count-in', 'recording', 'processing'].map(status => view(snap(four({ 0: { status } }))).banner.tone);
  assert.deepEqual(tones, ['info', 'info', 'live', 'info']);
});

test('the offset text follows the engine value', () => {
  assert.equal(view(snap(four(), { latencyOffset: 0.03 })).offsetText, '+30 ms');
  assert.equal(view(snap(four(), { latencyOffset: -0.12 })).offsetText, '-120 ms');
});
