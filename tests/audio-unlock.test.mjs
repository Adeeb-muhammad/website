import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnlockGate } from '../music-studio-src/src/audio/unlock.ts';
import { NoteGate } from '../music-studio-src/src/audio/noteGate.ts';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test('audio unlock is retryable after a rejected resume', async () => {
  let state = 'suspended';
  let attempts = 0;
  let first = deferred();
  const gate = createUnlockGate(
    () => state,
    () => {
      attempts++;
      return attempts === 1 ? first.promise : Promise.resolve();
    },
  );

  const one = gate();
  const two = gate();
  assert.equal(one, two, 'concurrent gestures share one unlock attempt');
  first.reject(new Error('blocked'));
  await assert.rejects(one, /blocked/);
  assert.equal(state, 'suspended');
  assert.equal(attempts, 1);

  await gate();
  assert.equal(attempts, 2, 'the next gesture starts a fresh attempt');

  state = 'running';
  await gate();
  assert.equal(attempts, 2, 'a running context needs no further attempt');
});

test('audio unlock does nothing while the context is already running', async () => {
  let attempts = 0;
  const gate = createUnlockGate(() => 'running', async () => { attempts++; });
  await gate();
  await gate();
  assert.equal(attempts, 0);
});

test('a failed note-on leaves no stale in-flight or waiting entry', () => {
  const gate = new NoteGate();
  gate.begin('ch-1', 60);
  gate.fail('ch-1', 60);
  assert.equal(gate.noteOff('ch-1', 60), false, 'key-up is not recorded for a failed note');
  assert.equal(gate.complete('ch-1', 60), false, 'no stale in-flight entry remains');
});

test('key-up during unlock is consumed once and skips the attack', () => {
  const gate = new NoteGate();
  gate.begin('ch-1', 64);
  assert.equal(gate.noteOff('ch-1', 64), true);
  assert.equal(gate.complete('ch-1', 64), true, 'attack must be skipped');
  assert.equal(gate.noteOff('ch-1', 64), false, 'the in-flight entry is gone');
  assert.equal(gate.complete('ch-1', 64), false, 'the waiting entry is gone');
});

test('clear removes every in-flight and waiting note', () => {
  const gate = new NoteGate();
  gate.begin('ch-1', 60);
  gate.begin('ch-2', 67);
  gate.noteOff('ch-1', 60);
  gate.clear();
  assert.equal(gate.complete('ch-1', 60), false);
  assert.equal(gate.noteOff('ch-2', 67), false);
});
