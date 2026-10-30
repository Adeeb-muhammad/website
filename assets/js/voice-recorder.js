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

export function createRecorder({
  getUserMedia = browserGetUserMedia(),
  MediaRecorder = globalThis.MediaRecorder,
  maxSeconds = 120,
  setTimeout = browserSetTimeout,
  clearTimeout = browserClearTimeout
} = {}) {
  let currentState = 'idle';
  let stream = null;
  let recorder = null;
  let chunks = [];
  let timerId = null;
  let lastResult = null;
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

  const makeResult = () => {
    const mimeType = recorder?.mimeType || recorder?.options?.mimeType || '';
    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size === 0) {
      const error = { code: 'empty', message: 'The recording contained no audio.' };
      setState('error');
      return Promise.reject(error);
    }
    return Promise.resolve({ blob, mimeType, extension: extensionFor(mimeType) });
  };

  const finish = (resultPromise, nextState = 'stopped') => {
    clearMaxTimer();
    stopTracks();
    return resultPromise.then((result) => {
      lastResult = result;
      setState(nextState);
      return result;
    }, (error) => {
      setState('error');
      throw error;
    });
  };

  const stopInternal = () => {
    if (!recorder) {
      stopTracks();
      setState('error');
      return Promise.reject({ code: 'unknown', message: 'The recorder is unavailable.' });
    }

    const result = new Promise((resolve, reject) => {
      recorder.__resolve = resolve;
      recorder.__reject = reject;
    });

    try {
      recorder.stop();
    } catch (error) {
      recorder.__reject(describeMicError(error));
    }

    return finish(result.then(() => makeResult()), 'stopped');
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

      lastResult = null;
      setState('requesting');
      try {
        stream = await getUserMedia({ audio: true });
        const requestedMimeType = pickMimeType((mimeType) => MediaRecorder.isTypeSupported(mimeType));
        const mediaRecorder = requestedMimeType
          ? new MediaRecorder(stream, { mimeType: requestedMimeType })
          : new MediaRecorder(stream);
        recorder = mediaRecorder;
        chunks = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) chunks.push(event.data);
        };
        mediaRecorder.onerror = (event) => {
          const error = describeMicError(event.error || event);
          clearMaxTimer();
          stopTracks();
          if (mediaRecorder.__reject) mediaRecorder.__reject(error);
          setState('error');
        };
        mediaRecorder.onstop = () => {
          if (mediaRecorder.__resolve) mediaRecorder.__resolve();
        };
        mediaRecorder.start();
        setState('recording');
        timerId = setTimeout(() => {
          if (currentState === 'recording') {
            stopInternal().catch(() => {});
          }
        }, Math.max(0, maxSeconds) * 1000);
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
    clearMaxTimer();
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
