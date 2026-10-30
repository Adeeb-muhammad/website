import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRecorder,
  describeMicError,
  extensionFor,
  pickMimeType
} from '../assets/js/voice-recorder.js';

class FakeTimers {
  constructor() {
    this.nextId = 1;
    this.jobs = new Map();
  }

  setTimeout = (callback, delay) => {
    const id = this.nextId++;
    this.jobs.set(id, { callback, delay });
    return id;
  };

  clearTimeout = (id) => {
    this.jobs.delete(id);
  };

  runAll() {
    const jobs = [...this.jobs.values()];
    this.jobs.clear();
    jobs.forEach(({ callback }) => callback());
  }
}

class FakeTrack {
  stopped = false;

  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  constructor() {
    this.tracks = [new FakeTrack(), new FakeTrack()];
  }

  getTracks() {
    return this.tracks;
  }
}

class FakeMediaRecorder {
  static supported = ['audio/webm;codecs=opus'];
  static instances = [];

  static isTypeSupported(type) {
    return this.supported.includes(type);
  }

  constructor(stream, options = {}) {
    this.stream = stream;
    this.options = options;
    this.mimeType = options.mimeType || 'audio/webm';
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onstop = null;
    this.onerror = null;
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio']) });
    this.onstop?.();
  }

  fail(error) {
    this.onerror?.({ error });
  }
}

class EmptyMediaRecorder extends FakeMediaRecorder {
  stop() {
    this.state = 'inactive';
    this.onstop?.();
  }
}

class ThrowingMediaRecorder {
  static isTypeSupported() {
    return false;
  }

  constructor() {
    throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
  }
}

function setup(options = {}) {
  const timers = new FakeTimers();
  const stream = new FakeStream();
  let getUserMediaCalls = 0;
  const getUserMedia = options.getUserMedia || (async () => {
    getUserMediaCalls += 1;
    return stream;
  });
  FakeMediaRecorder.instances = [];
  const recorder = createRecorder({
    getUserMedia,
    MediaRecorder: options.MediaRecorder || FakeMediaRecorder,
    maxSeconds: options.maxSeconds ?? 120,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout
  });
  return { recorder, stream, timers, getUserMediaCalls: () => getUserMediaCalls };
}

test('picks the first supported MIME type and falls back to empty', () => {
  assert.equal(pickMimeType((type) => type === 'audio/mp4'), 'audio/mp4');
  assert.equal(pickMimeType(() => false), '');
  assert.equal(pickMimeType(undefined), '');
});

test('maps extensions while ignoring codec parameters and case', () => {
  assert.equal(extensionFor('Audio/WebM;codecs=opus'), 'webm');
  assert.equal(extensionFor('audio/mp4; codecs=mp4a.40.2'), 'm4a');
  assert.equal(extensionFor('audio/ogg;codecs=opus'), 'ogg');
  assert.equal(extensionFor('audio/wav'), 'bin');
});

test('describes microphone errors and unsupported APIs', () => {
  assert.deepEqual(describeMicError({ name: 'NotAllowedError' }), {
    code: 'denied',
    message: 'Microphone permission was denied.'
  });
  assert.equal(describeMicError({ name: 'PermissionDeniedError' }).code, 'denied');
  assert.equal(describeMicError({ name: 'NotFoundError' }).code, 'no-device');
  assert.equal(describeMicError({ name: 'DevicesNotFoundError' }).code, 'no-device');
  assert.equal(describeMicError({ name: 'NotReadableError' }).code, 'busy');
  assert.equal(describeMicError({ name: 'TrackStartError' }).code, 'busy');
  assert.equal(describeMicError({ name: 'SecurityError' }).code, 'insecure');
  assert.equal(describeMicError({ code: 'unsupported' }).code, 'unsupported');
  assert.equal(describeMicError({ name: 'OtherError', message: 'Nope' }).code, 'unknown');
  assert.equal(describeMicError(null).code, 'unsupported');
});

test('does not access the microphone until start and rejects duplicate starts', async () => {
  let resolveStream;
  let calls = 0;
  const pendingStream = new Promise((resolve) => { resolveStream = resolve; });
  const { recorder } = setup({ getUserMedia: () => {
    calls += 1;
    return pendingStream;
  } });
  assert.equal(recorder.state, 'idle');
  assert.equal(calls, 0);
  const startPromise = recorder.start();
  assert.equal(recorder.state, 'requesting');
  assert.equal(calls, 1);
  assert.throws(() => recorder.start(), /already in progress/);
  resolveStream(new FakeStream());
  await startPromise;
  assert.equal(recorder.state, 'recording');
  assert.throws(() => recorder.start(), /already in progress/);
});

test('stops with the actual recorder MIME type and stops all tracks', async () => {
  const { recorder, stream } = setup();
  await recorder.start();
  const result = await recorder.stop();
  assert.equal(result.mimeType, 'audio/webm;codecs=opus');
  assert.equal(result.extension, 'webm');
  assert.ok(result.blob.size > 0);
  assert.equal(recorder.state, 'stopped');
  assert.ok(stream.tracks.every((track) => track.stopped));
  assert.throws(() => recorder.stop(), /not active/);
});

test('rejects an empty recording and stops all tracks', async () => {
  const { recorder, stream } = setup({ MediaRecorder: EmptyMediaRecorder });
  await recorder.start();
  await assert.rejects(recorder.stop(), { code: 'empty' });
  assert.equal(recorder.state, 'error');
  assert.ok(stream.tracks.every((track) => track.stopped));
});

test('discard returns to idle, drops the recording, and stops all tracks', async () => {
  const { recorder, stream } = setup();
  await recorder.start();
  recorder.discard();
  assert.equal(recorder.state, 'idle');
  assert.equal(recorder.result, null);
  assert.ok(stream.tracks.every((track) => track.stopped));
});

test('reports state changes and unsubscribes listeners', async () => {
  const { recorder } = setup();
  const states = [];
  const unsubscribe = recorder.onState((state) => states.push(state));
  await recorder.start();
  await recorder.stop();
  unsubscribe();
  recorder.discard();
  assert.deepEqual(states, ['requesting', 'recording', 'stopped']);
});

test('rejects microphone errors and enters error state', async () => {
  const error = Object.assign(new Error('permission'), { name: 'NotAllowedError' });
  const { recorder } = setup({ getUserMedia: async () => {
    throw error;
  } });
  await assert.rejects(recorder.start(), { code: 'denied' });
  assert.equal(recorder.state, 'error');
});

test('stops tracks when recorder creation errors', async () => {
  const { recorder, stream } = setup({ MediaRecorder: ThrowingMediaRecorder });
  await assert.rejects(recorder.start(), { code: 'unsupported' });
  assert.equal(recorder.state, 'error');
  assert.ok(stream.tracks.every((track) => track.stopped));
});

test('stops tracks when MediaRecorder reports an error', async () => {
  const { recorder, stream } = setup();
  await recorder.start();
  const mediaRecorder = FakeMediaRecorder.instances[0];
  mediaRecorder.fail(Object.assign(new Error('busy'), { name: 'NotReadableError' }));
  assert.equal(recorder.state, 'error');
  assert.ok(stream.tracks.every((track) => track.stopped));
});

test('automatically stops at max length, keeps its result, and stops all tracks', async () => {
  const { recorder, stream, timers } = setup({ maxSeconds: 2 });
  await recorder.start();
  timers.runAll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(recorder.state, 'stopped');
  assert.ok(recorder.result);
  assert.ok(recorder.result.blob.size > 0);
  assert.ok(stream.tracks.every((track) => track.stopped));
});

test('rejects unsupported APIs', async () => {
  const recorder = createRecorder({
    getUserMedia: undefined,
    MediaRecorder: undefined,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
  });
  await assert.rejects(recorder.start(), { code: 'unsupported' });
  assert.equal(recorder.state, 'error');
});
