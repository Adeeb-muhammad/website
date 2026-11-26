import test from 'node:test';
import assert from 'node:assert/strict';
import { notebookSyncAction } from '../assets/js/notebook-sync.js';

const KEY = 'adeeb-vault-notebook-v2';

test('an idle tab adopts a newer notebook written by another tab', () => {
  assert.equal(notebookSyncAction({ key: KEY, eventKey: KEY, incomingValue: '{new}', currentValue: '{old}' }), 'adopt');
});

test('a tab with unsaved work warns instead of overwriting or adopting', () => {
  assert.equal(notebookSyncAction({ key: KEY, eventKey: KEY, incomingValue: '{new}', currentValue: '{old}', busy: true }), 'warn');
});

test('its own save echoed back, a cleared value and unrelated keys are ignored', () => {
  assert.equal(notebookSyncAction({ key: KEY, eventKey: KEY, incomingValue: '{same}', currentValue: '{same}' }), 'ignore');
  assert.equal(notebookSyncAction({ key: KEY, eventKey: KEY, incomingValue: null, currentValue: '{old}' }), 'ignore');
  assert.equal(notebookSyncAction({ key: KEY, eventKey: 'something-else', incomingValue: '{new}', currentValue: '{old}' }), 'ignore');
  assert.equal(notebookSyncAction({ eventKey: KEY, incomingValue: '{new}', currentValue: '{old}' }), 'ignore', 'a missing expected key never adopts');
  assert.equal(notebookSyncAction(), 'ignore');
});
