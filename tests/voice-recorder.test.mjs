import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecorder,
  describeMicError,
  extensionFor,
  pickMimeType
} from '../assets/js/voice-recorder.js';

const MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus'
];

function makeStream() {
  const tracks = [{ stopCalls: 0, stop() { this.stopCalls += 1; } }, { stopCalls: 0, stop() { this.stopCalls += 1; } }];
  return {
    tracks,
    getTracks() { return tracks; },
    get stopCalls() { return tracks.reduce((sum, track) => sum + track.stopCalls, 0); }
  };
}

function makeMediaRecorderClass({ mimeType = 'audio/webm;codecs=opus', startError, stopError } = {}) {
  class FakeMediaRecorder {
    static supported = new Set(MIME_TYPES);
    static calls = [];
    static isTypeSupported(type) { return this.supported.has(type); }

    constructor(stream, options) {
      this.stream = stream;
      this.options = options;
      this.mimeType = mimeType;
      this.state = 'inactive';
      this.ondataavailable = null;
      this.onstop = null;
      this.onerror = null;
      this.stopCalls = 0;
      FakeMediaRecorder.calls.push(this);
    }

    start() {
      if (startError) throw startError;
      this.state = 'recording';
    }

    stop() {
      this.stopCalls += 1;
      if (stopError) throw stopError;
      this.state = 'inactive';
      this.onstop?.();
    }

    emitData(value = 'test audio') {
      const data = new Blob([value], { type: this.mimeType });
      this.ondataavailable?.({ data });
    }

    emitEmptyData() {
      this.ondataavailable?.({ data: new Blob([], { type: this.mimeType }) });
    }

    emitError(error = Object.assign(new Error('device failed'), { name: 'NotReadableError' })) {
      this.onerror?.({ error });
    }
  }
  return FakeMediaRecorder;
}

function makeTimers() {
  let nextId = 1;
  const scheduled = new Map();
  const cleared = [];
  return {
    scheduled,
    cleared,
    setTimeout(fn, delay) {
      const id = nextId++;
      scheduled.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) {
      cleared.push(id);
      scheduled.delete(id);
    },
    fire(id) {
      const timer = scheduled.get(id);
      assert.ok(timer, 'timer ' + id + ' exists');
      scheduled.delete(id);
      timer.fn();
    },
    firstId() { return scheduled.keys().next().value; }
  };
}

function makeHarness(options = {}) {
  const stream = options.stream ?? makeStream();
  const MediaRecorder = options.MediaRecorder ?? makeMediaRecorderClass(options.recorderOptions);
  const timers = options.timers ?? makeTimers();
  const calls = [];
  const getUserMedia = options.getUserMedia ?? (async constraints => {
    calls.push(constraints);
    return stream;
  });
  const recorder = createRecorder({
    getUserMedia,
    MediaRecorder,
    maxSeconds: options.maxSeconds ?? 10,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout
  });
  return { recorder, stream, MediaRecorder, timers, calls, getUserMedia };
}

// MIME selection and error descriptions

test('pickMimeType returns the first supported candidate in the required order', () => {
  const checked = [];
  const selected = pickMimeType(type => {
    checked.push(type);
    return type === 'audio/mp4';
  });
  assert.equal(selected, 'audio/mp4');
  assert.deepEqual(checked, MIME_TYPES.slice(0, 4));
});

test('pickMimeType returns an empty string when no type is supported or probe is absent', () => {
  assert.equal(pickMimeType(() => false), '');
  assert.equal(pickMimeType(undefined), '');
});

test('pickMimeType continues when a support probe throws', () => {
  const checked = [];
  assert.equal(pickMimeType(type => {
    checked.push(type);
    if (type === MIME_TYPES[0]) throw new Error('probe failed');
    return type === MIME_TYPES[1];
  }), MIME_TYPES[1]);
  assert.deepEqual(checked, MIME_TYPES.slice(0, 2));
});

test('extensionFor ignores codec parameters and MIME type case', () => {
  assert.equal(extensionFor('audio/webm;codecs=opus'), 'webm');
  assert.equal(extensionFor(' AUDIO/WEBM ; codecs=opus '), 'webm');
  assert.equal(extensionFor('audio/mp4;codecs=mp4a.40.2'), 'm4a');
  assert.equal(extensionFor('AUDIO/OGG;codecs=opus'), 'ogg');
  assert.equal(extensionFor('audio/wav'), 'bin');
  assert.equal(extensionFor(''), 'bin');
});

test('describeMicError maps every specified browser error name', () => {
  const cases = [
    ['NotAllowedError', 'denied'], ['PermissionDeniedError', 'denied'],
    ['NotFoundError', 'no-device'], ['DevicesNotFoundError', 'no-device'],
    ['NotReadableError', 'busy'], ['TrackStartError', 'busy'],
    ['SecurityError', 'insecure'], ['SomeOtherError', 'unknown']
  ];
  for (const [name, code] of cases) {
    const result = describeMicError({ name });
    assert.equal(result.code, code, name);
    assert.ok(result.message.length > 0, name + ' has a message');
    assert.equal(typeof result.message, 'string');
  }
  assert.equal(describeMicError(undefined).code, 'unsupported');
  assert.equal(describeMicError(null).code, 'unsupported');
});

// Recorder lifecycle

test('creating a recorder does not request microphone access', () => {
  let requests = 0;
  const MediaRecorder = makeMediaRecorderClass();
  const recorder = createRecorder({
    getUserMedia: async () => { requests += 1; return makeStream(); },
    MediaRecorder,
    setTimeout: () => 1,
    clearTimeout: () => {}
  });
  assert.equal(recorder.state, 'idle');
  assert.equal(requests, 0);
});

test('start requests audio only when called and resolves after recording begins', async () => {
  const h = makeHarness();
  assert.equal(h.calls.length, 0);
  await h.recorder.start();
  assert.deepEqual(h.calls, [{ audio: true }]);
  assert.equal(h.recorder.state, 'recording');
  assert.equal(h.MediaRecorder.calls.length, 1);
  assert.equal(h.MediaRecorder.calls[0].state, 'recording');
  assert.deepEqual(h.MediaRecorder.calls[0].options, { mimeType: MIME_TYPES[0] });
});

test('browser chooses MIME type when no supported type is reported', async () => {
  const MediaRecorder = makeMediaRecorderClass({ mimeType: 'audio/ogg;codecs=opus' });
  MediaRecorder.supported.clear();
  const h = makeHarness({ MediaRecorder });
  await h.recorder.start();
  assert.equal(h.MediaRecorder.calls[0].options, undefined);
  h.MediaRecorder.calls[0].emitData();
  const result = await h.recorder.stop();
  assert.equal(result.mimeType, 'audio/ogg;codecs=opus');
  assert.equal(result.extension, 'ogg');
});

test('start throws immediately when called while requesting or recording', async () => {
  let resolveStream;
  const MediaRecorder = makeMediaRecorderClass();
  const recorder = createRecorder({
    getUserMedia: () => new Promise(resolve => { resolveStream = resolve; }),
    MediaRecorder,
    setTimeout: () => 1,
    clearTimeout: () => {}
  });
  const pendingStart = recorder.start();
  assert.throws(() => recorder.start(), /already|while recorder is requesting/);
  resolveStream(makeStream());
  await pendingStart;
  assert.throws(() => recorder.start(), /already|while recorder is recording/);
});

test('stop resolves the actual recorder MIME type, extension and Blob', async () => {
  const MediaRecorder = makeMediaRecorderClass({ mimeType: 'audio/mp4;codecs=mp4a.40.2' });
  const h = makeHarness({ MediaRecorder });
  await h.recorder.start();
  h.MediaRecorder.calls[0].emitData('captured voice');
  const result = await h.recorder.stop();
  assert.equal(result.mimeType, 'audio/mp4;codecs=mp4a.40.2');
  assert.equal(result.extension, 'm4a');
  assert.ok(result.blob instanceof Blob);
  assert.equal(result.blob.type, result.mimeType);
  assert.equal(await result.blob.text(), 'captured voice');
  assert.equal(h.recorder.state, 'stopped');
  assert.equal(h.stream.stopCalls, 2);
  assert.throws(() => h.recorder.stop(), /not recording/);
});

test('rejects a second stop while the first stop event is still pending', async () => {
  const DelayedStopRecorder = class extends makeMediaRecorderClass() {
    stop() {
      this.stopCalls += 1;
      this.state = 'inactive';
    }
    finishStop() { this.onstop?.(); }
  };
  const h = makeHarness({ MediaRecorder: DelayedStopRecorder });
  await h.recorder.start();
  const recorder = DelayedStopRecorder.calls[0];
  const pending = h.recorder.stop();
  assert.throws(() => h.recorder.stop(), /not recording/);
  recorder.emitData('final chunk');
  recorder.finishStop();
  const result = await pending;
  assert.equal(await result.blob.text(), 'final chunk');
  assert.equal(h.stream.stopCalls, 2);
});

test('stop with zero recorded bytes rejects with the empty code and releases tracks', async () => {
  const h = makeHarness();
  await h.recorder.start();
  await assert.rejects(h.recorder.stop(), error => error.code === 'empty' && /no audio/i.test(error.message));
  assert.equal(h.recorder.state, 'error');
  assert.equal(h.stream.stopCalls, 2);
});

test('stop when not recording throws', () => {
  const h = makeHarness();
  assert.throws(() => h.recorder.stop(), /not recording/);
});

test('discard clears a recording, stops every track and returns to idle', async () => {
  const h = makeHarness();
  await h.recorder.start();
  h.MediaRecorder.calls[0].emitData();
  h.recorder.discard();
  assert.equal(h.recorder.state, 'idle');
  assert.equal(h.stream.stopCalls, 2);
  assert.throws(() => h.recorder.stop(), /not recording/);
  assert.equal(h.timers.scheduled.size, 0);
});

test('discard during a pending permission request stops the late stream and prevents recording', async () => {
  let resolveStream;
  const stream = makeStream();
  const MediaRecorder = makeMediaRecorderClass();
  const recorder = createRecorder({
    getUserMedia: () => new Promise(resolve => { resolveStream = resolve; }),
    MediaRecorder,
    setTimeout: () => 1,
    clearTimeout: () => {}
  });
  const pendingStart = recorder.start();
  recorder.discard();
  resolveStream(stream);
  await assert.rejects(pendingStart, error => error.code === 'cancelled');
  assert.equal(recorder.state, 'idle');
  assert.equal(stream.stopCalls, 2);
  assert.equal(MediaRecorder.calls.length, 0);
});

test('a microphone error while recording stops all tracks and enters error', async () => {
  const h = makeHarness();
  await h.recorder.start();
  h.MediaRecorder.calls[0].emitError(Object.assign(new Error('device busy'), { name: 'NotReadableError' }));
  assert.equal(h.recorder.state, 'error');
  assert.equal(h.stream.stopCalls, 2);
  assert.equal(h.timers.scheduled.size, 0);
});

test('a getUserMedia rejection is mapped to a plain denied result', async () => {
  const MediaRecorder = makeMediaRecorderClass();
  const recorder = createRecorder({
    getUserMedia: async () => { throw Object.assign(new Error('blocked'), { name: 'NotAllowedError' }); },
    MediaRecorder,
    setTimeout: () => 1,
    clearTimeout: () => {}
  });
  await assert.rejects(recorder.start(), error => error.code === 'denied' && typeof error.message === 'string');
  assert.equal(recorder.state, 'error');
});

test('a missing getUserMedia or MediaRecorder rejects as unsupported without requesting audio', async () => {
  const timers = makeTimers();
  const noMic = createRecorder({
    getUserMedia: null,
    MediaRecorder: makeMediaRecorderClass(),
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout
  });
  await assert.rejects(noMic.start(), error => error.code === 'unsupported');
  assert.equal(noMic.state, 'error');

  const stream = makeStream();
  let requested = false;
  const noRecorder = createRecorder({
    getUserMedia: async () => { requested = true; return stream; },
    MediaRecorder: null,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout
  });
  await assert.rejects(noRecorder.start(), error => error.code === 'unsupported');
  assert.equal(requested, false, 'do not prompt for a microphone when MediaRecorder is unavailable');
  assert.equal(noRecorder.state, 'error');
});

test('constructor and recorder.start failures release the acquired microphone', async () => {
  class ConstructorFailure {
    static isTypeSupported() { return false; }
    constructor() { throw Object.assign(new Error('not supported'), { name: 'NotReadableError' }); }
  }
  const first = makeHarness({ MediaRecorder: ConstructorFailure });
  await assert.rejects(first.recorder.start(), error => error.code === 'busy');
  assert.equal(first.stream.stopCalls, 2);

  const StartFailure = makeMediaRecorderClass({ startError: Object.assign(new Error('cannot start'), { name: 'TrackStartError' }) });
  const second = makeHarness({ MediaRecorder: StartFailure });
  await assert.rejects(second.recorder.start(), error => error.code === 'busy');
  assert.equal(second.stream.stopCalls, 2);
  assert.equal(second.recorder.state, 'error');
});

test('the max duration automatically stops, releases tracks and keeps its result available', async () => {
  const h = makeHarness({ maxSeconds: 7 });
  await h.recorder.start();
  const timerId = h.timers.firstId();
  assert.equal(h.timers.scheduled.get(timerId).delay, 7000);
  h.MediaRecorder.calls[0].emitData('auto-saved clip');
  h.timers.fire(timerId);
  assert.equal(h.recorder.state, 'stopped');
  assert.equal(h.MediaRecorder.calls[0].stopCalls, 1);
  assert.equal(h.stream.stopCalls, 2);
  const result = h.recorder.result;
  assert.ok(result);
  assert.equal(await result.blob.text(), 'auto-saved clip');
  assert.equal(result.mimeType, MIME_TYPES[0]);
  assert.equal(result.extension, 'webm');
  assert.throws(() => h.recorder.stop(), /not recording/);
});

test('discarding an automatically stopped recording drops its retained result', async () => {
  const h = makeHarness();
  await h.recorder.start();
  h.MediaRecorder.calls[0].emitData('keep until discarded');
  h.timers.fire(h.timers.firstId());
  h.recorder.discard();
  assert.equal(h.recorder.state, 'idle');
  assert.throws(() => h.recorder.stop(), /not recording/);
});

test('onState reports each transition and unsubscribe stops future notifications', async () => {
  const h = makeHarness();
  const seen = [];
  const unsubscribe = h.recorder.onState(state => seen.push(state));
  await h.recorder.start();
  h.MediaRecorder.calls[0].emitData();
  await h.recorder.stop();
  unsubscribe();
  h.recorder.discard();
  assert.deepEqual(seen, ['requesting', 'recording', 'stopped']);
});

test('state observers cannot break recording transitions', async () => {
  const h = makeHarness();
  h.recorder.onState(() => { throw new Error('observer failure'); });
  await h.recorder.start();
  h.MediaRecorder.calls[0].emitData();
  const result = await h.recorder.stop();
  assert.ok(result.blob.size > 0);
  assert.equal(h.recorder.state, 'stopped');
});

test('maxSeconds must be a positive finite number', () => {
  const timers = makeTimers();
  assert.throws(() => createRecorder({ maxSeconds: 0, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout }), RangeError);
  assert.throws(() => createRecorder({ maxSeconds: Infinity, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout }), RangeError);
});
