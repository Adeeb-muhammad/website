/**
 * Microphone recorder tests for Music Studio (phase 1).
 *
 * The fake MediaRecorder behaves like the browser: stop() returns before the
 * final dataavailable and stop events, which arrive on a later microtask. The
 * fake getUserMedia takes a turn before answering, like a permission prompt.
 * The core is TypeScript; Node's type stripping imports it directly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMicRecorder,
  describeMicError,
  extensionFor,
  MIC_AUDIO_CONSTRAINTS,
  pickMimeType
} from '../music-studio-src/src/recording/micRecorder.ts';

const MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus'
];

function makeStream() {
  const tracks = [
    { stopCalls: 0, stop() { this.stopCalls += 1; } },
    { stopCalls: 0, stop() { this.stopCalls += 1; } }
  ];
  return {
    tracks,
    getTracks() { return tracks; },
    get stopCalls() { return tracks.reduce((sum, track) => sum + track.stopCalls, 0); }
  };
}

function makeMediaRecorderClass({ mimeType = 'audio/webm;codecs=opus', payload = 'take audio', startError, stopError, empty = false } = {}) {
  return class FakeMediaRecorder {
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
      // Like the browser: the final chunk and stop arrive after stop() returns.
      queueMicrotask(() => {
        const data = new Blob(empty ? [] : [payload], { type: this.mimeType });
        this.ondataavailable?.({ data });
        this.onstop?.();
      });
    }
  };
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
  const getUserMedia = options.getUserMedia ?? (async (constraints) => {
    calls.push(constraints);
    await Promise.resolve();
    return stream;
  });
  const recorder = createMicRecorder({
    getUserMedia,
    MediaRecorder,
    maxSeconds: options.maxSeconds ?? 10,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout
  });
  return { recorder, stream, MediaRecorder, timers, calls };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

/* MIME selection and plain-language errors */

test('pickMimeType returns the first supported candidate in order', () => {
  assert.equal(pickMimeType(() => true), 'audio/webm;codecs=opus');
  assert.equal(pickMimeType(type => type.startsWith('audio/mp4')), 'audio/mp4;codecs=mp4a.40.2');
  assert.equal(pickMimeType(type => type === 'audio/ogg;codecs=opus'), 'audio/ogg;codecs=opus');
});

test('pickMimeType copes with a missing or throwing support probe', () => {
  assert.equal(pickMimeType(), '');
  assert.equal(pickMimeType(() => false), '');
  assert.equal(pickMimeType(() => { throw new Error('probe failed'); }), '');
});

test('extensionFor ignores codec parameters and case', () => {
  assert.equal(extensionFor('audio/webm;codecs=opus'), 'webm');
  assert.equal(extensionFor('AUDIO/MP4'), 'm4a');
  assert.equal(extensionFor('audio/ogg;codecs=opus'), 'ogg');
  assert.equal(extensionFor('audio/wav'), 'bin');
  assert.equal(extensionFor(undefined), 'bin');
});

test('describeMicError maps every browser error name to a plain message', () => {
  const denied = describeMicError(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
  assert.equal(denied.code, 'denied');
  assert.match(denied.message, /denied/i);

  assert.equal(describeMicError(Object.assign(new Error('x'), { name: 'NotFoundError' })).code, 'no-device');
  assert.equal(describeMicError(Object.assign(new Error('x'), { name: 'NotReadableError' })).code, 'busy');
  assert.equal(describeMicError(Object.assign(new Error('x'), { name: 'SecurityError' })).code, 'insecure');
  assert.equal(describeMicError(new Error('x')).code, 'unknown');
  assert.equal(describeMicError(null).code, 'unsupported');
});

/* Recording lifecycle */

test('creating the recorder does not request the microphone', () => {
  const h = makeHarness();
  assert.equal(h.recorder.state, 'idle');
  assert.equal(h.calls.length, 0);
});

test('start asks for music-friendly audio and waits for the permission answer', async () => {
  const h = makeHarness();
  const pending = h.recorder.start();
  assert.equal(h.recorder.state, 'requesting');

  await pending;
  assert.equal(h.recorder.state, 'recording');
  assert.equal(h.calls.length, 1);
  const constraints = h.calls[0];
  assert.deepEqual(constraints.audio, MIC_AUDIO_CONSTRAINTS);
  assert.equal(constraints.audio.echoCancellation, false);
  assert.equal(constraints.audio.noiseSuppression, false);
  assert.equal(constraints.audio.autoGainControl, false);
  assert.equal(h.MediaRecorder.calls.length, 1);
});

test('stop resolves the real MIME type, extension and blob and releases the mic', async () => {
  const MediaRecorder = makeMediaRecorderClass({ mimeType: 'audio/mp4;codecs=mp4a.40.2' });
  const h = makeHarness({ MediaRecorder });
  await h.recorder.start();
  const result = await h.recorder.stop();

  assert.equal(result.mimeType, 'audio/mp4;codecs=mp4a.40.2');
  assert.equal(result.extension, 'm4a');
  assert.equal(await result.blob.text(), 'take audio');
  assert.equal(h.recorder.state, 'stopped');
  assert.equal(h.stream.stopCalls, 2);
  assert.throws(() => h.recorder.stop(), /not recording/);
});

test('a second stop while the first is pending throws instead of queueing', async () => {
  const DelayedStopRecorder = class extends makeMediaRecorderClass() {
    stop() {
      this.stopCalls += 1;
      this.state = 'inactive';
    }
    finishStop() { this.onstop?.(); }
  };
  const h = makeHarness({ MediaRecorder: DelayedStopRecorder });
  await h.recorder.start();
  const fake = DelayedStopRecorder.calls[0];
  const pending = h.recorder.stop();
  assert.throws(() => h.recorder.stop(), /not recording/);

  fake.ondataavailable?.({ data: new Blob(['final chunk'], { type: fake.mimeType }) });
  fake.finishStop();
  const result = await pending;
  assert.equal(await result.blob.text(), 'final chunk');
  assert.equal(h.stream.stopCalls, 2);
});

test('an empty take rejects with the empty code and still releases the mic', async () => {
  const h = makeHarness({ recorderOptions: { empty: true } });
  await h.recorder.start();
  await assert.rejects(h.recorder.stop(), error => error.code === 'empty' && /no audio/i.test(error.message));
  assert.equal(h.recorder.state, 'error');
  assert.equal(h.stream.stopCalls, 2);
});

test('discard stops every track, clears the timer and returns to idle', async () => {
  const h = makeHarness();
  await h.recorder.start();
  h.recorder.discard();
  assert.equal(h.recorder.state, 'idle');
  assert.equal(h.stream.stopCalls, 2);
  assert.equal(h.timers.scheduled.size, 0);
  assert.throws(() => h.recorder.stop(), /not recording/);
});

test('discard during the permission prompt stops the late stream and never records', async () => {
  let resolveStream;
  const stream = makeStream();
  const MediaRecorder = makeMediaRecorderClass();
  const recorder = createMicRecorder({
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

test('a denied permission becomes a plain denied error and records nothing', async () => {
  const MediaRecorder = makeMediaRecorderClass();
  const recorder = createMicRecorder({
    getUserMedia: async () => { throw Object.assign(new Error('blocked'), { name: 'NotAllowedError' }); },
    MediaRecorder,
    setTimeout: () => 1,
    clearTimeout: () => {}
  });

  await assert.rejects(recorder.start(), error => error.code === 'denied' && /denied/i.test(error.message));
  assert.equal(recorder.state, 'error');
  assert.equal(MediaRecorder.calls.length, 0);
});

test('a microphone error while recording stops the tracks and clears the timer', async () => {
  const h = makeHarness();
  await h.recorder.start();
  h.MediaRecorder.calls[0].onerror?.({
    error: Object.assign(new Error('device busy'), { name: 'NotReadableError' })
  });
  assert.equal(h.recorder.state, 'error');
  assert.equal(h.stream.stopCalls, 2);
  assert.equal(h.timers.scheduled.size, 0);
});

test('the maximum length stops the take automatically and keeps the result', async () => {
  const h = makeHarness({ maxSeconds: 1 });
  await h.recorder.start();
  h.timers.fire(h.timers.firstId());
  await flush();

  assert.equal(h.recorder.state, 'stopped');
  assert.ok(h.recorder.result);
  assert.equal(await h.recorder.result.blob.text(), 'take audio');
  assert.equal(h.stream.stopCalls, 2);
});

test('result is already readable when observers hear "stopped"', async () => {
  const h = makeHarness();
  const seen = [];
  h.recorder.onState(state => { if (state === 'stopped') seen.push(h.recorder.result?.blob.size); });
  await h.recorder.start();
  await h.recorder.stop();
  assert.equal(seen.length, 1);
  assert.ok(seen[0] > 0);
});

test('unsupported browsers fail without asking for the microphone', async () => {
  const calls = [];
  const recorder = createMicRecorder({
    getUserMedia: async (constraints) => { calls.push(constraints); return makeStream(); },
    MediaRecorder: undefined,
    setTimeout: () => 1,
    clearTimeout: () => {}
  });
  await assert.rejects(recorder.start(), error => error.code === 'unsupported');
  assert.equal(calls.length, 0);
});
