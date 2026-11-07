import test from 'node:test';
import assert from 'node:assert/strict';
import { describeVoiceState, filenameFor, formatElapsed, userMessageFor } from '../assets/js/voice-recorder-view.js';

test('userMessageFor shows the recorder message and stays silent for cancel and discard', () => {
  assert.equal(userMessageFor({ code: 'denied', message: 'Microphone access was denied.' }), 'Microphone access was denied.');
  assert.equal(userMessageFor({ code: 'cancelled', message: 'x' }), null);
  assert.equal(userMessageFor({ code: 'discarded', message: 'x' }), null);
  assert.equal(userMessageFor(null), null);
  assert.equal(userMessageFor(undefined), null);
  assert.match(userMessageFor({ code: 'weird' }), /could not be started/);
  assert.match(userMessageFor({ code: 'weird', message: '' }), /could not be started/);
  assert.match(userMessageFor(new Error('boom')), /boom/);
});

test('formatElapsed formats minutes and seconds and tolerates bad input', () => {
  assert.equal(formatElapsed(0), '0:00');
  assert.equal(formatElapsed(7.9), '0:07');
  assert.equal(formatElapsed(65), '1:05');
  assert.equal(formatElapsed(120), '2:00');
  for (const bad of [-5, NaN, Infinity, null, undefined, '12']) assert.equal(formatElapsed(bad), '0:00', String(bad));
});

test('filenameFor builds a local timestamped name and never trusts the extension', () => {
  const date = new Date(2026, 9, 31, 8, 5, 9); // 31 Oct 2026 08:05:09 local time
  assert.equal(filenameFor('webm', date), 'voice-take-20261031-080509.webm');
  assert.equal(filenameFor('m4a', date), 'voice-take-20261031-080509.m4a');
  for (const bad of ['', '../x', 'web m', 'toolong', undefined, null, 5]) assert.equal(filenameFor(bad, date), 'voice-take-20261031-080509.bin', String(bad));
});

test('each recorder state allows exactly the right buttons', () => {
  const view = (state, extra) => describeVoiceState({ state, ...extra });
  const flags = v => [v.canRecord, v.canStop, v.canDiscard];
  assert.deepEqual(flags(view('idle')), [true, false, false]);
  assert.deepEqual(flags(view('idle', { hasTake: true })), [true, false, true]);
  assert.deepEqual(flags(view('requesting')), [false, false, true], 'the prompt can be cancelled with Discard');
  assert.deepEqual(flags(view('recording')), [false, true, true]);
  assert.deepEqual(flags(view('stopped')), [true, false, true]);
  assert.deepEqual(flags(view('error')), [true, false, false]);
  assert.deepEqual(flags(view('error', { hasTake: true })), [true, false, true]);
  assert.deepEqual(flags(view(undefined)), [true, false, false], 'an unknown state behaves like idle');
});

test('status text tells the user what is happening and what to do', () => {
  assert.match(describeVoiceState({ state: 'idle' }).status, /headphones/);
  assert.match(describeVoiceState({ state: 'requesting' }).status, /permission/);
  assert.match(describeVoiceState({ state: 'recording' }).status, /Recording/);
  assert.match(describeVoiceState({ state: 'stopped' }).status, /Take ready/);
  assert.equal(describeVoiceState({ state: 'error', errorMessage: 'No microphone was found.' }).status, 'No microphone was found.');
  assert.match(describeVoiceState({ state: 'error' }).status, /could not be started/);
  const tones = ['idle', 'requesting', 'recording', 'stopped', 'error'].map(state => describeVoiceState({ state }).tone);
  assert.deepEqual(tones, ['idle', 'info', 'live', 'ok', 'error']);
});

test('an unsupported browser disables every button whatever the state', () => {
  for (const state of ['idle', 'requesting', 'recording', 'stopped', 'error']) {
    const view = describeVoiceState({ state, supported: false, hasTake: true });
    assert.deepEqual([view.canRecord, view.canStop, view.canDiscard], [false, false, false], state);
    assert.match(view.status, /not supported/);
  }
});
