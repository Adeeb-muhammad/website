// What the voice recorder panel should say and allow for each recorder state. No DOM here, so it is easy to test.
const IGNORED_CODES = new Set(['cancelled', 'discarded']);
const FALLBACK_ERROR = 'The microphone could not be started. Please try again.';
const IDLE_HELP = 'Press RECORD to start. Use headphones so the drums are not recorded. Takes stay in this tab until you download them.';

/** Plain-language message for a recorder error, or null when the user caused it on purpose (cancel, discard). */
export function userMessageFor(error) {
  if (!error || IGNORED_CODES.has(error.code)) return null;
  return typeof error.message === 'string' && error.message ? error.message : FALLBACK_ERROR;
}

export function formatElapsed(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function filenameFor(extension, date = new Date()) {
  const safeExtension = typeof extension === 'string' && /^[a-z0-9]{1,5}$/.test(extension) ? extension : 'bin';
  const two = value => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
  return `voice-take-${stamp}.${safeExtension}`;
}

/** { status, tone, canRecord, canStop, canDiscard } for the recorder's current state. */
export function describeVoiceState({ state, errorMessage = '', hasTake = false, supported = true } = {}) {
  if (!supported) {
    return { status: 'Microphone recording is not supported in this browser.', tone: 'error', canRecord: false, canStop: false, canDiscard: false };
  }
  switch (state) {
    case 'requesting':
      return { status: 'Waiting for microphone permission. Choose Allow in your browser prompt.', tone: 'info', canRecord: false, canStop: false, canDiscard: true };
    case 'recording':
      return { status: 'Recording. Use headphones so the drums are not picked up.', tone: 'live', canRecord: false, canStop: true, canDiscard: true };
    case 'stopped':
      return { status: 'Take ready. Play it, download it, or record again.', tone: 'ok', canRecord: true, canStop: false, canDiscard: true };
    case 'error':
      return { status: errorMessage || FALLBACK_ERROR, tone: 'error', canRecord: true, canStop: false, canDiscard: hasTake };
    default:
      return { status: IDLE_HELP, tone: 'idle', canRecord: true, canStop: false, canDiscard: hasTake };
  }
}
