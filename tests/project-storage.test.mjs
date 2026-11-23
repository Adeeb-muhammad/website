import test from 'node:test';
import assert from 'node:assert/strict';
import { createDebouncedStorage } from '../music-studio-src/src/stores/projectStorage.ts';

function fakeStorage() {
  const data = new Map();
  const state = { failWrites: false, failReads: false, failRemoves: false };
  return {
    data,
    state,
    getItem(name) {
      if (state.failReads) throw new Error('SecurityError');
      return data.get(name) ?? null;
    },
    setItem(name, value) {
      if (state.failWrites) throw new Error('QuotaExceededError');
      data.set(name, value);
    },
    removeItem(name) {
      if (state.failRemoves) throw new Error('SecurityError');
      data.delete(name);
    },
  };
}

const tick = ms => new Promise(resolve => setTimeout(resolve, ms));

test('autosave is debounced, flushes the latest value and reports success', async () => {
  const storage = fakeStorage();
  let errors = 0, successes = 0;
  const debounced = createDebouncedStorage(storage, {
    debounceMs: 5,
    onError: () => errors++,
    onSuccess: () => successes++,
  });

  debounced.setItem('project', 'one');
  debounced.setItem('project', 'two');
  assert.equal(storage.data.has('project'), false);
  await tick(20);
  assert.equal(storage.data.get('project'), 'two');
  assert.equal(errors, 0);
  assert.equal(successes, 1);

  debounced.setItem('project', 'three');
  debounced.flush();
  assert.equal(storage.data.get('project'), 'three');
});

test('quota failures are reported and a later save clears the error', () => {
  const storage = fakeStorage();
  let errors = 0, successes = 0, lastError = null;
  const debounced = createDebouncedStorage(storage, {
    onError: error => { errors++; lastError = error; },
    onSuccess: () => successes++,
  });

  storage.state.failWrites = true;
  debounced.setItem('project', 'unsaved');
  debounced.flush();
  assert.equal(errors, 1);
  assert.match(lastError.message, /Quota/);
  assert.equal(storage.data.has('project'), false, 'a failed write stores nothing');
  assert.equal(successes, 0);

  storage.state.failWrites = false;
  debounced.setItem('project', 'saved');
  debounced.flush();
  assert.equal(storage.data.get('project'), 'saved');
  assert.equal(successes, 1, 'a later success clears the storage-error state');
});

test('blocked reads and removes return safely and report the error', () => {
  const storage = fakeStorage();
  let errors = 0;
  const debounced = createDebouncedStorage(storage, { onError: () => errors++ });
  storage.state.failReads = true;
  assert.equal(debounced.getItem('project'), null);
  assert.equal(errors, 1);

  storage.state.failRemoves = true;
  debounced.removeItem('project');
  assert.equal(errors, 2);
});

test('remove cancels a pending save instead of writing it later', () => {
  const storage = fakeStorage();
  const debounced = createDebouncedStorage(storage, { debounceMs: 5 });
  debounced.setItem('project', 'stale');
  debounced.removeItem('project');
  debounced.flush();
  assert.equal(storage.data.has('project'), false);
});
