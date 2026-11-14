/**
 * Microphone recorder core, ported from the hand-written drum machine's
 * voice-recorder.js (retired at commit 046befd) and kept framework-free so it
 * can be tested against a fake browser in tests/mic-recorder.test.mjs.
 *
 * It deliberately creates no AudioContext: phase 1 only needs MediaRecorder,
 * so the single audio clock stays the Tone.js context owned by the engine.
 */

const MIME_CANDIDATES = Object.freeze([
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
]);

/** Music capture: every browser "clean-up" processor colours the take. */
export const MIC_AUDIO_CONSTRAINTS: MediaTrackConstraints = Object.freeze({
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
});

const ERROR_MESSAGES: Record<string, string> = Object.freeze({
  denied: 'Microphone access was denied. Allow microphone access in your browser settings and try again.',
  'no-device': 'No microphone was found. Connect or enable a microphone and try again.',
  busy: 'The microphone is unavailable. Close other apps using it and try again.',
  insecure: 'Microphone access requires a secure connection, such as HTTPS or localhost.',
  unsupported: 'Microphone recording is not supported in this browser.',
  unknown: 'The microphone could not be started. Please try again.',
  empty: 'The recording contains no audio. Try recording again.',
});

export interface RecorderError {
  code: string;
  message: string;
}

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'stopped' | 'error';

export interface Take {
  blob: Blob;
  mimeType: string;
  extension: string;
}

type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;
type RecorderConstructor = typeof MediaRecorder;
type TimerHandle = ReturnType<typeof setTimeout>;

export interface MicRecorder {
  readonly state: RecorderState;
  readonly result: Take | null;
  start(): Promise<void>;
  stop(): Promise<Take>;
  discard(): void;
  onState(listener: (state: RecorderState) => void): () => void;
}

export interface CreateMicRecorderOptions {
  getUserMedia?: GetUserMedia;
  MediaRecorder?: RecorderConstructor;
  maxSeconds?: number;
  constraints?: MediaTrackConstraints;
  setTimeout?: (handler: () => void, ms: number) => TimerHandle;
  clearTimeout?: (handle: TimerHandle) => void;
}

function errorResult(code: string): RecorderError {
  return { code, message: ERROR_MESSAGES[code] ?? ERROR_MESSAGES.unknown };
}

/** Return the first MIME type the supplied MediaRecorder support check accepts. */
export function pickMimeType(isTypeSupported?: (mimeType: string) => boolean): string {
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
export function extensionFor(mimeType: string): string {
  const mediaType = typeof mimeType === 'string' ? mimeType.split(';', 1)[0].trim().toLowerCase() : '';

  if (mediaType === 'audio/webm') return 'webm';
  if (mediaType === 'audio/mp4') return 'm4a';
  if (mediaType === 'audio/ogg') return 'ogg';
  return 'bin';
}

/** Convert browser microphone errors into stable codes and plain-language messages. */
export function describeMicError(error: unknown): RecorderError {
  if (error == null) return errorResult('unsupported');

  const name = typeof (error as { name?: unknown })?.name === 'string'
    ? String((error as { name: string }).name)
    : '';
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

function defaultGetUserMedia(): GetUserMedia | undefined {
  const mediaDevices = globalThis.navigator?.mediaDevices;
  return typeof mediaDevices?.getUserMedia === 'function'
    ? mediaDevices.getUserMedia.bind(mediaDevices)
    : undefined;
}

function stopTracks(stream: MediaStream | null | undefined): void {
  try {
    for (const track of stream?.getTracks?.() ?? []) {
      try { track.stop(); } catch { /* A track may already have ended. */ }
    }
  } catch {
    // A malformed or already-closed stream must not block recorder cleanup.
  }
}

/**
 * Create an independently testable MediaRecorder controller. No browser API is
 * accessed until start() is called; all browser-facing dependencies are injectable.
 */
export function createMicRecorder({
  getUserMedia = defaultGetUserMedia(),
  MediaRecorder: MediaRecorderClass = globalThis.MediaRecorder,
  maxSeconds = 180,
  constraints = MIC_AUDIO_CONSTRAINTS,
  setTimeout: setTimer = globalThis.setTimeout.bind(globalThis),
  clearTimeout: clearTimerFn = globalThis.clearTimeout.bind(globalThis),
}: CreateMicRecorderOptions = {}): MicRecorder {
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 3600) {
    throw new RangeError('maxSeconds must be a finite number above 0 and at most 3600.');
  }
  if (typeof setTimer !== 'function' || typeof clearTimerFn !== 'function') {
    throw new TypeError('A working setTimeout and clearTimeout are required.');
  }

  let currentState: RecorderState = 'idle';
  let stream: MediaStream | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let timer: TimerHandle | null = null;
  let generation = 0;
  let pendingStop: {
    resolve: (take: Take) => void;
    reject: (error: RecorderError) => void;
  } | null = null;
  let lastResult: Take | null = null;
  const stateListeners = new Set<(state: RecorderState) => void>();

  /** Read through a function so TypeScript does not narrow the mutable state. */
  const isRequesting = (): boolean => currentState === 'requesting';

  function setState(nextState: RecorderState): void {
    if (currentState === nextState) return;
    currentState = nextState;
    for (const listener of [...stateListeners]) {
      try { listener(currentState); } catch { /* Observers must not interrupt recorder state changes. */ }
    }
  }

  function cancelTimer(): void {
    if (timer !== null) {
      try { clearTimerFn(timer); } catch { /* Cleanup should continue if an injected timer throws. */ }
      timer = null;
    }
  }

  function detachRecorder(recorder: MediaRecorder | null): void {
    if (!recorder) return;
    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.onerror = null;
  }

  function releaseMedia({ stopRecorder = false } = {}): void {
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

  function fail(error: unknown, token = generation): void {
    if (token !== generation) return;
    generation += 1;
    releaseMedia({ stopRecorder: true });
    chunks = [];
    lastResult = null;
    const result = error && typeof (error as RecorderError).code === 'string'
      && typeof (error as RecorderError).message === 'string'
      ? (error as RecorderError)
      : describeMicError(error);
    setState('error');
    if (pendingStop) {
      const reject = pendingStop.reject;
      pendingStop = null;
      reject(result);
    }
  }

  function completeStop(token: number, recorder: MediaRecorder): void {
    if (token !== generation || recorder !== mediaRecorder) return;

    cancelTimer();
    const actualMimeType = typeof recorder.mimeType === 'string' ? recorder.mimeType : '';
    const blob = new Blob(chunks, { type: actualMimeType });
    const result: Take = {
      blob,
      mimeType: actualMimeType,
      extension: extensionFor(actualMimeType),
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

    lastResult = result; // store first, so observers of the 'stopped' state can read recorder.result
    setState('stopped');
    stopWaiter?.resolve(result);
  }

  function requestStop(): Promise<Take> {
    if (currentState !== 'recording' || !mediaRecorder || pendingStop) {
      throw new Error('Cannot stop: the recorder is not recording.');
    }

    cancelTimer();
    const recorder = mediaRecorder;
    const token = generation;
    const completion = new Promise<Take>((resolve, reject) => {
      pendingStop = { resolve, reject };
    });

    try {
      recorder.stop();
    } catch (error) {
      fail(error, token);
    }

    return completion;
  }

  function start(): Promise<void> {
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

        const acquiredStream = await getUserMedia({ audio: constraints });
        if (token !== generation || !isRequesting()) {
          stopTracks(acquiredStream);
          throw { code: 'cancelled', message: 'The recording request was cancelled.' } as RecorderError;
        }

        stream = acquiredStream;
        const mimeType = pickMimeType(
          typeof MediaRecorderClass.isTypeSupported === 'function'
            ? MediaRecorderClass.isTypeSupported.bind(MediaRecorderClass)
            : undefined,
        );
        const recorder = mimeType
          ? new MediaRecorderClass(stream, { mimeType })
          : new MediaRecorderClass(stream);
        mediaRecorder = recorder;

        recorder.ondataavailable = event => {
          if (token !== generation || recorder !== mediaRecorder) return;
          const data = (event as BlobEvent | undefined)?.data;
          if (data && (typeof data.size !== 'number' || data.size > 0)) chunks.push(data);
        };
        recorder.onstop = () => completeStop(token, recorder);
        recorder.onerror = event => fail((event as ErrorEvent)?.error ?? event, token);

        recorder.start();
        if (token !== generation) {
          throw { code: 'cancelled', message: 'The recording request was cancelled.' } as RecorderError;
        }
        setState('recording');
        timer = setTimer(() => {
          if (token === generation && currentState === 'recording') {
            try {
              requestStop().catch(() => { /* The error state is reported through onState. */ });
            } catch {
              // A manual Stop is already in progress.
            }
          }
        }, maxSeconds * 1000);
      } catch (error) {
        if (token === generation) fail(error, token);
        throw error && typeof (error as RecorderError).code === 'string'
          ? error
          : describeMicError(error);
      }
    })();
  }

  function discard(): void {
    generation += 1;
    releaseMedia({ stopRecorder: true });
    chunks = [];
    lastResult = null;
    const stopWaiter = pendingStop;
    pendingStop = null;
    stopWaiter?.reject({ code: 'discarded', message: 'The recording was discarded.' });
    setState('idle');
  }

  function onState(listener: (state: RecorderState) => void): () => void {
    if (typeof listener !== 'function') throw new TypeError('onState expects a function.');
    stateListeners.add(listener);
    return () => {
      stateListeners.delete(listener);
    };
  }

  const api: MicRecorder = {
    get state() { return currentState; },
    get result() { return lastResult; },
    start,
    stop: requestStop,
    discard,
    onState,
  };
  return api;
}
