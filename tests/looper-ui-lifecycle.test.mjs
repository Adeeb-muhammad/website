import test from 'node:test';
import assert from 'node:assert/strict';
import { mountLooper } from '../assets/js/looper-ui.js';
import { createLooper } from '../assets/js/looper.js?v=3';

const emptySnapshot = () => ({
  tracks: Array.from({ length: 4 }, (_, index) => ({
    index, status: 'empty', bars: 1, muted: false, hasTake: false, message: ''
  })),
  lockedBpm: null,
  tempoMismatch: false,
  latencyOffset: 0
});

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.listeners = new Map();
    this.attributes = {};
    this.dataset = {};
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  add(option) {
    this.children.push(option);
    if (this.value === '') this.value = option.value;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

class FakeWindow {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

class FakeStepEngine {
  constructor() {
    this.listeners = { step: new Set(), stop: new Set() };
    this.unsubscribeCalls = { step: 0, stop: 0 };
  }

  isPlaying() {
    return true;
  }

  on(type, listener) {
    this.listeners[type].add(listener);
    let called = false;
    return () => {
      this.unsubscribeCalls[type] += 1;
      if (called) return;
      called = true;
      this.listeners[type].delete(listener);
    };
  }

  emit(type, payload = {}) {
    for (const listener of [...this.listeners[type]]) listener(payload);
  }
}

function createFakeLooper() {
  let state = emptySnapshot();
  const listeners = new Set();
  let disposed = false;
  const instance = {
    disposeCalls: 0,
    offChangeCalls: 0,
    recordCalls: [],
    audioNodes: [{ kind: 'fake-session-audio-node' }],
    snapshot: () => state,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        instance.offChangeCalls += 1;
        listeners.delete(listener);
      };
    },
    setLatencyOffset(seconds) {
      state = { ...state, latencyOffset: seconds };
      for (const listener of [...listeners]) listener(state);
    },
    recordTrack(index, bars) {
      instance.recordCalls.push({ index, bars });
      return Promise.resolve();
    },
    cancelRecording() {},
    setMuted() {},
    clearTrack() {},
    dispose() {
      if (disposed) return;
      disposed = true;
      instance.disposeCalls += 1;
      state = emptySnapshot();
      for (const listener of [...listeners]) listener(state);
    },
    setTrack(index, changes) {
      state.tracks[index] = { ...state.tracks[index], ...changes };
      for (const listener of [...listeners]) listener(state);
    }
  };
  return instance;
}

function setup() {
  const ids = ['looper-panel', 'looper-tracks', 'looper-status', 'looper-lock', 'looper-offset', 'looper-offset-value'];
  const elements = new Map(ids.map(id => [id, new FakeElement('div')]));
  elements.get('looper-offset').value = '0';
  const doc = {
    getElementById: id => elements.get(id) ?? null,
    createElement: tag => new FakeElement(tag)
  };
  const win = new FakeWindow();
  const engine = new FakeStepEngine();
  const instances = [];
  const mounted = mountLooper(engine, {
    doc,
    win,
    nav: { mediaDevices: { getUserMedia() {} } },
    hasMediaRecorder: true,
    hasAudioContext: true,
    createLooper: () => {
      const instance = createFakeLooper();
      instances.push(instance);
      return instance;
    }
  });
  return { elements, engine, instances, mounted, win };
}

test('normal pagehide disposes the looper once and clears take indicators', () => {
  const { elements, instances, win } = setup();
  const looper = instances[0];
  const status = elements.get('looper-tracks').children[0].children[1];
  const clear = elements.get('looper-tracks').children[0].children[5];

  looper.setTrack(0, { status: 'ready', hasTake: true });
  assert.match(status.textContent, /READY/);
  assert.equal(clear.disabled, false);

  win.dispatch('pagehide', { persisted: false });
  win.dispatch('pagehide', { persisted: true });

  assert.equal(looper.disposeCalls, 1);
  assert.equal(status.textContent, 'EMPTY');
  assert.equal(clear.disabled, true);
  assert.equal(elements.get('looper-tracks').children[0].children[3].disabled, true);
});

test('persisted pageshow creates a fresh looper and its controls use the new instance', async () => {
  const { elements, instances, mounted, win } = setup();
  const previous = instances[0];
  previous.setTrack(0, { status: 'ready', hasTake: true });
  elements.get('looper-offset').value = '75';
  elements.get('looper-offset').dispatch('input');

  win.dispatch('pagehide', { persisted: true });
  assert.equal(mounted.looper, null);
  win.dispatch('pageshow', { persisted: true });

  assert.equal(instances.length, 2);
  const restored = instances[1];
  assert.notEqual(restored, previous);
  assert.notEqual(restored.audioNodes, previous.audioNodes);
  assert.equal(restored.snapshot().latencyOffset, 0.075);
  assert.equal(mounted.looper, restored);
  assert.match(elements.get('looper-status').textContent, /recorded takes were lost/i);
  assert.equal(elements.get('looper-tracks').children[0].children[1].textContent, 'EMPTY');

  const record = elements.get('looper-tracks').children[0].children[3];
  assert.equal(record.disabled, false);
  record.dispatch('click');
  await Promise.resolve();
  assert.deepEqual(restored.recordCalls, [{ index: 0, bars: 1 }]);
  assert.deepEqual(previous.recordCalls, []);
});

test('non-persisted pageshow does not recreate a disposed looper', () => {
  const { engine, instances, mounted, win } = setup();
  win.dispatch('pagehide', { persisted: false });
  win.dispatch('pageshow', { persisted: false });

  assert.equal(instances.length, 1);
  assert.equal(mounted.looper, null);
  assert.equal(engine.listeners.step.size, 0);
  assert.equal(engine.listeners.stop.size, 0);
});

test('engine and looper change unsubscribers are called exactly once per session', () => {
  const { engine, instances, win } = setup();
  win.dispatch('pagehide');
  win.dispatch('pagehide');

  assert.deepEqual(engine.unsubscribeCalls, { step: 1, stop: 1 });
  assert.equal(instances[0].offChangeCalls, 1);
  assert.equal(instances[0].disposeCalls, 1);

  win.dispatch('pageshow', { persisted: true });
  win.dispatch('pagehide');
  assert.deepEqual(engine.unsubscribeCalls, { step: 2, stop: 2 });
  assert.equal(instances[1].offChangeCalls, 1);
  assert.equal(instances[1].disposeCalls, 1);
});

test('the production looper dispose method is idempotent', () => {
  const engine = new FakeStepEngine();
  engine.getAudioContext = () => ({});
  engine.getMasterGain = () => ({});
  engine.getBpm = () => 120;

  const looper = createLooper(engine);
  looper.dispose();
  looper.dispose();

  assert.deepEqual(engine.unsubscribeCalls, { step: 1, stop: 1 });
});
