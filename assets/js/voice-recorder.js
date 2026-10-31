const MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus'
];

export function pickMimeType(isTypeSupported) {
  if (typeof isTypeSupported !== 'function') return '';
  return MIME_TYPES.find((mimeType) => {
    try {
      return isTypeSupported(mimeType) === true;
    } catch {
      return false;
    }
  }) || '';
}

export function extensionFor(mimeType) {
  const mediaType = String(mimeType || '').split(';', 1)[0].trim().toLowerCase();
  if (mediaType === 'audio/webm') return 'webm';
  if (mediaType === 'audio/mp4') return 'm4a';
  if (mediaType === 'audio/ogg') return 'ogg';
  return 'bin';
}

const MIC_ERRORS = new Map([
  ['NotAllowedError', ['denied', 'Microphone permission was denied.']],
  ['PermissionDeniedError', ['denied', 'Microphone permission was denied.']],
  ['NotFoundError', ['no-device', 'No microphone was found.']],
  ['DevicesNotFoundError', ['no-device', 'No microphone was found.']],
  ['NotReadableError', ['busy', 'The microphone is busy or unavailable.']],
  ['TrackStartError', ['busy', 'The microphone is busy or unavailable.']],
  ['SecurityError', ['insecure', 'Microphone access requires a secure connection.']],
  ['NotSupportedError', ['unsupported', 'This browser does not support microphone recording.']]
]);

export function describeMicError(error) {
  if (!error || error.code === 'unsupported') {
    return { code: 'unsupported', message: 'This browser does not support microphone recording.' };
  }

  const result = MIC_ERRORS.get(error.name);
  if (result) return { code: result[0], message: result[1] };

  return {
    code: 'unknown',
    message: error.message || 'The microphone could not be started.'
  };
}

function browserGetUserMedia() {
  const mediaDevices = globalThis.navigator?.mediaDevices;
  return typeof mediaDevices?.getUserMedia === 'function'
    ? mediaDevices.getUserMedia.bind(mediaDevices)
    : undefined;
}

function browserSetTimeout(...args) {
  return globalThis.setTimeout(...args);
}

function browserClearTimeout(...args) {
  return globalThis.clearTimeout(...args);
}

const CANCELLED = Object.freeze({ code: 'cancelled', message: 'Recording was cancelled.' });
const MAX_SECONDS_LIMIT = 3600;

export function createRecorder({
  getUserMedia = browserGetUserMedia(),
  MediaRecorder = globalThis.MediaRecorder,
  maxSeconds = 120,
  setTimeout = browserSetTimeout,
  clearTimeout = browserClearTimeout
} = {}) {
  if (typeof maxSeconds !== 'number' || !Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > MAX_SECONDS_LIMIT) {
    throw new RangeError(`maxSeconds must be a number above 0 and at most ${MAX_SECONDS_LIMIT}.`);
  }
  let currentState = 'idle';
  let stream = null;
  let recorder = null;
  let chunks = [];
  let timerId = null;
  let lastResult = null;
  let session = 0; // changes on start() and discard() so late events from an old recording can be ignored
  let stopping = null;
  const subscribers = new Set();

  const setState = (nextState) => {
    if (currentState === nextState) return;
    currentState = nextState;
    subscribers.forEach((listener) => listener(currentState));
  };

  const stopTracks = () => {
    if (!stream) return;
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  };

  const clearMaxTimer = () => {
    if (timerId === null) return;
    clearTimeout(timerId);
    timerId = null;
  };

  const makeResult = (ticket) => {
    if (ticket !== session) return Promise.reject(CANCELLED);
    const mimeType = recorder?.mimeType || recorder?.options?.mimeType || '';
    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size === 0) {
      const error = { code: 'empty', message: 'The recording contained no audio.' };
      setState('error');
      return Promise.reject(error);
    }
    return Promise.resolve({ blob, mimeType, extension: extensionFor(mimeType) });
  };

  const finish = (resultPromise, ticket) => {
    clearMaxTimer();
    stopTracks();
    return resultPromise.then((result) => {
      stopping = null;
      if (ticket !== session) throw CANCELLED; // discarded while stopping: do not bring the recording back
      lastResult = result;
      setState('stopped');
      return result;
    }, (error) => {
      stopping = null;
      if (ticket !== session) throw CANCELLED;
      setState('error');
      throw error;
    });
  };

  const stopInternal = () => {
    if (stopping) return stopping; // a second Stop (or the max-length timer) shares the pending stop
    if (!recorder) {
      stopTracks();
      setState('error');
      return Promise.reject({ code: 'unknown', message: 'The recorder is unavailable.' });
    }

    const ticket = session;
    const active = recorder;
    const result = new Promise((resolve, reject) => {
      active.__resolve = resolve;
      active.__reject = reject;
    });

    try {
      active.stop();
    } catch (error) {
      active.__reject(describeMicError(error));
    }

    stopping = finish(result.then(() => makeResult(ticket)), ticket);
    return stopping;
  };

  const start = () => {
    if (currentState === 'requesting' || currentState === 'recording') {
      throw new Error('A recording is already in progress.');
    }

    return (async () => {
      if (typeof getUserMedia !== 'function' || typeof MediaRecorder !== 'function') {
        const error = describeMicError({ code: 'unsupported' });
        setState('error');
        throw error;
      }

      const mySession = ++session;
      lastResult = null;
      setState('requesting');

      let acquired;
      try {
        acquired = await getUserMedia({ audio: true });
      } catch (error) {
        if (mySession !== session) throw CANCELLED; // discarded while the permission prompt was open
        setState('error');
        throw describeMicError(error);
      }
      if (mySession !== session) {
        // Discarded while the prompt was open and permission was granted afterwards: release the microphone.
        acquired.getTracks().forEach((track) => track.stop());
        throw CANCELLED;
      }
      stream = acquired;

      try {
        const requestedMimeType = pickMimeType((mimeType) => MediaRecorder.isTypeSupported(mimeType));
        const mediaRecorder = requestedMimeType
          ? new MediaRecorder(stream, { mimeType: requestedMimeType })
          : new MediaRecorder(stream);
        recorder = mediaRecorder;
        const ownChunks = [];
        chunks = ownChunks;

        // Events from a recorder that has since been discarded must not touch the current recording.
        mediaRecorder.ondataavailable = (event) => {
          if (recorder !== mediaRecorder) return;
          if (event.data && event.data.size > 0) ownChunks.push(event.data);
        };
        mediaRecorder.onerror = (event) => {
          if (recorder !== mediaRecorder) return;
          const error = describeMicError(event.error || event);
          clearMaxTimer();
          stopTracks();
          if (mediaRecorder.__reject) mediaRecorder.__reject(error);
          setState('error');
        };
        mediaRecorder.onstop = () => {
          if (recorder !== mediaRecorder) return;
          if (mediaRecorder.__resolve) mediaRecorder.__resolve();
        };
        mediaRecorder.start();
        setState('recording');
        timerId = setTimeout(() => {
          if (currentState === 'recording') {
            stopInternal().catch(() => {});
          }
        }, maxSeconds * 1000);
      } catch (error) {
        clearMaxTimer();
        stopTracks();
        setState('error');
        throw describeMicError(error);
      }
    })();
  };

  const stop = () => {
    if (currentState !== 'recording') {
      throw new Error('Recording is not active.');
    }
    return stopInternal();
  };

  const discard = () => {
    session += 1;
    stopping = null;
    clearMaxTimer();
    if (recorder?.__reject) recorder.__reject(CANCELLED); // settle a Stop that is still waiting for the browser
    if (recorder && currentState === 'recording') {
      try {
        recorder.stop();
      } catch {
        // The recording is discarded regardless of the recorder's stop state.
      }
    }
    recorder = null;
    chunks = [];
    lastResult = null;
    stopTracks();
    setState('idle');
  };

  const api = {
    get state() {
      return currentState;
    },
    start,
    stop,
    discard,
    onState(listener) {
      if (typeof listener !== 'function') throw new TypeError('onState requires a function.');
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    }
  };

  Object.defineProperty(api, 'result', {
    get: () => lastResult,
    enumerable: false
  });

  return api;
}
