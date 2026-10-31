const MIME_CANDIDATES = Object.freeze([
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus'
]);

const ERROR_MESSAGES = Object.freeze({
  denied: 'Microphone access was denied. Allow microphone access in your browser settings and try again.',
  'no-device': 'No microphone was found. Connect or enable a microphone and try again.',
  busy: 'The microphone is unavailable. Close other apps using it and try again.',
  insecure: 'Microphone access requires a secure connection, such as HTTPS or localhost.',
  unsupported: 'Microphone recording is not supported in this browser.',
  unknown: 'The microphone could not be started. Please try again.',
  empty: 'The recording contains no audio. Try recording again.'
});

function errorResult(code) {
  return { code, message: ERROR_MESSAGES[code] ?? ERROR_MESSAGES.unknown };
}

/** Return the first MIME type the supplied MediaRecorder support check accepts. */
export function pickMimeType(isTypeSupported) {
  if (typeof isTypeSupported !== 'function') return '';

  for (const mimeType of MIME_CANDIDATES) {
    try {
      if (isTypeSupported(mimeType)) return mimeType;
    } catch {
      // A browser's support probe should not prevent trying the next candidate.
    }
  }
  return '';
}

/** Return a file extension based on the MIME type, ignoring codec parameters and case. */
export function extensionFor(mimeType) {
  const mediaType = typeof mimeType === 'string'
    ? mimeType.split(';', 1)[0].trim().toLowerCase()
    : '';

  if (mediaType === 'audio/webm') return 'webm';
  if (mediaType === 'audio/mp4') return 'm4a';
  if (mediaType === 'audio/ogg') return 'ogg';
  return 'bin';
}

/** Convert browser microphone errors into stable codes and plain-language messages. */
export function describeMicError(error) {
  if (error == null) return errorResult('unsupported');

  const name = typeof error?.name === 'string' ? error.name : '';
  let code = 'unknown';

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    code = 'denied';
  } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    code = 'no-device';
  } else if (name === 'NotReadableError' || name === 'TrackStartError') {
    code = 'busy';
  } else if (name === 'SecurityError') {
    code = 'insecure';
  }

  return errorResult(code);
}

function defaultGetUserMedia() {
  const mediaDevices = globalThis.navigator?.mediaDevices;
  return typeof mediaDevices?.getUserMedia === 'function'
    ? mediaDevices.getUserMedia.bind(mediaDevices)
    : undefined;
}

function stopTracks(stream) {
  try {
    for (const track of stream?.getTracks?.() ?? []) {
      try { track.stop(); } catch { /* A track may already have ended. */ }
    }
  } catch {
    // A malformed or already-closed stream must not block recorder cleanup.
  }
}

function clearTimer(timer, clearTimerFn) {
  if (timer !== null) {
    try { clearTimerFn(timer); } catch { /* Cleanup should continue if an injected timer throws. */ }
  }
}

/**
 * Create an independently testable MediaRecorder controller. No browser API is
 * accessed until start() is called; all browser-facing dependencies are injectable.
 */
export function createRecorder({
  getUserMedia = defaultGetUserMedia(),
  MediaRecorder: MediaRecorderClass = globalThis.MediaRecorder,
  maxSeconds = 120,
  setTimeout: setTimer = globalThis.setTimeout?.bind(globalThis),
  clearTimeout: clearTimerFn = globalThis.clearTimeout?.bind(globalThis)
} = {}) {
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0) {
    throw new RangeError('maxSeconds must be a positive finite number.');
  }
  if (typeof setTimer !== 'function' || typeof clearTimerFn !== 'function') {
    throw new TypeError('A working setTimeout and clearTimeout are required.');
  }

  let currentState = 'idle';
  let stream = null;
  let mediaRecorder = null;
  let chunks = [];
  let timer = null;
  let generation = 0;
  let pendingStop = null;
  let lastResult = null;
  const stateListeners = new Set();

  function setState(nextState) {
    if (currentState === nextState) return;
    currentState = nextState;
    for (const listener of [...stateListeners]) {
      try { listener(currentState); } catch { /* Observers must not interrupt recorder state changes. */ }
    }
  }

  function cancelTimer() {
    clearTimer(timer, clearTimerFn);
    timer = null;
  }

  function detachRecorder(recorder) {
    if (!recorder) return;
    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.onerror = null;
  }

  function releaseMedia({ stopRecorder = false } = {}) {
    cancelTimer();
    const recorder = mediaRecorder;
    detachRecorder(recorder);
    if (stopRecorder && recorder) {
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch { /* Tracks are still stopped below. */ }
    }
    stopTracks(stream);
    stream = null;
    mediaRecorder = null;
  }

  function fail(error, token = generation) {
    if (token !== generation) return;
    generation += 1;
    releaseMedia({ stopRecorder: true });
    chunks = [];
    lastResult = null;
    const result = error && typeof error.code === 'string' && typeof error.message === 'string'
      ? error
      : describeMicError(error);
    setState('error');
    if (pendingStop) {
      const reject = pendingStop.reject;
      pendingStop = null;
      reject(result);
    }
  }

  function completeStop(token, recorder) {
    if (token !== generation || recorder !== mediaRecorder) return;

    cancelTimer();
    const actualMimeType = typeof recorder.mimeType === 'string' ? recorder.mimeType : '';
    const blob = new Blob(chunks, { type: actualMimeType });
    const result = {
      blob,
      mimeType: actualMimeType,
      extension: extensionFor(actualMimeType)
    };

    // MediaRecorder's final dataavailable event precedes stop. Release the tracks only
    // after onstop so the final encoded bytes are already in chunks.
    stopTracks(stream);
    stream = null;
    detachRecorder(recorder);
    mediaRecorder = null;
    chunks = [];

    const stopWaiter = pendingStop;
    pendingStop = null;

    if (blob.size === 0) {
      lastResult = null;
      const emptyError = errorResult('empty');
      setState('error');
      stopWaiter?.reject(emptyError);
      return;
    }

    setState('stopped');
    lastResult = result;
    stopWaiter?.resolve(result);
  }

  function requestStop() {
    if (currentState !== 'recording' || !mediaRecorder || pendingStop) {
      throw new Error('Cannot stop: the recorder is not recording.');
    }

    cancelTimer();
    const recorder = mediaRecorder;
    const token = generation;
    const completion = new Promise((resolve, reject) => {
      pendingStop = { resolve, reject };
    });

    try {
      recorder.stop();
    } catch (error) {
      fail(error, token);
    }

    return completion;
  }

  function start() {
    if (currentState === 'requesting' || currentState === 'recording') {
      throw new Error('Cannot start while recorder is ' + currentState + '.');
    }

    generation += 1;
    const token = generation;
    chunks = [];
    lastResult = null;
    cancelTimer();
    setState('requesting');

    return (async () => {
      try {
        if (typeof getUserMedia !== 'function' || typeof MediaRecorderClass !== 'function') {
          const unsupported = errorResult('unsupported');
          fail(unsupported, token);
          throw unsupported;
        }

        const acquiredStream = await getUserMedia({ audio: true });
        if (token !== generation || currentState !== 'requesting') {
          stopTracks(acquiredStream);
          throw { code: 'cancelled', message: 'The recording request was cancelled.' };
        }

        stream = acquiredStream;
        const mimeType = pickMimeType(
          typeof MediaRecorderClass.isTypeSupported === 'function'
            ? MediaRecorderClass.isTypeSupported.bind(MediaRecorderClass)
            : undefined
        );
        const recorder = mimeType
          ? new MediaRecorderClass(stream, { mimeType })
          : new MediaRecorderClass(stream);
        mediaRecorder = recorder;

        recorder.ondataavailable = event => {
          if (token !== generation || recorder !== mediaRecorder) return;
          const data = event?.data;
          if (data && (typeof data.size !== 'number' || data.size > 0)) chunks.push(data);
        };
        recorder.onstop = () => completeStop(token, recorder);
        recorder.onerror = event => fail(event?.error ?? event, token);

        recorder.start();
        if (token !== generation) {
          throw { code: 'cancelled', message: 'The recording request was cancelled.' };
        }
        setState('recording');
        timer = setTimer(() => {
          if (token === generation && currentState === 'recording') {
            requestStop().catch(() => { /* The error state is reported through onState. */ });
          }
        }, maxSeconds * 1000);
      } catch (error) {
        if (token === generation) fail(error, token);
        throw error && typeof error.code === 'string'
          ? error
          : describeMicError(error);
      }
    })();
  }

  function stop() {
    return requestStop();
  }

  function discard() {
    generation += 1;
    releaseMedia({ stopRecorder: true });
    chunks = [];
    lastResult = null;
    const stopWaiter = pendingStop;
    pendingStop = null;
    stopWaiter?.reject({ code: 'discarded', message: 'The recording was discarded.' });
    setState('idle');
  }

  function onState(listener) {
    if (typeof listener !== 'function') throw new TypeError('onState expects a function.');
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  }

  const api = {
    get state() { return currentState; },
    start,
    stop,
    discard,
    onState
  };
  Object.defineProperty(api, 'result', { get: () => lastResult, enumerable: false });
  return api;
}
