// Pure maths for the looper: exact loop lengths and fitting a recorded take to one. No DOM, no Web Audio, no storage.
const BEATS_PER_BAR = 4;
const STEPS_PER_BAR = 16;
const ALLOWED_BARS = Object.freeze([1, 2, 4]);
const MIN_BPM = 40;
const MAX_BPM = 240;
const DEFAULT_FADE_SECONDS = 0.005;

function checkBpm(bpm) {
  if (!Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) throw new RangeError(`bpm must be a number from ${MIN_BPM} to ${MAX_BPM}.`);
}
function checkBeats(beatsPerBar) {
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < 1 || beatsPerBar > 16) throw new RangeError('beatsPerBar must be a whole number from 1 to 16.');
}
function checkBars(bars) {
  if (!ALLOWED_BARS.includes(bars)) throw new RangeError(`bars must be one of ${ALLOWED_BARS.join(', ')}.`);
}
function checkSampleRate(sampleRate) {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000) throw new RangeError('sampleRate must be a whole number from 8000 to 384000.');
}

/** Length of one bar in seconds. */
export function barSeconds(bpm, beatsPerBar = BEATS_PER_BAR) {
  checkBpm(bpm);
  checkBeats(beatsPerBar);
  return (60 / bpm) * beatsPerBar;
}

/** The exact whole number of audio frames in `bars` bars (rounded once, so every layer of a loop has the same length). */
export function loopFrames(sampleRate, bpm, bars, beatsPerBar = BEATS_PER_BAR) {
  checkSampleRate(sampleRate);
  checkBars(bars);
  return Math.round(barSeconds(bpm, beatsPerBar) * bars * sampleRate);
}

/**
 * Fit a recorded take to exactly one loop. `channels` is an array of Float32Array; new arrays are returned and the
 * input is never modified. A positive offsetSeconds drops that much audio from the start (the microphone heard the beat
 * late); a negative one adds silence at the start. The end is zero-padded or trimmed to the exact length, and short
 * linear fades at both edges stop the loop point from clicking.
 */
export function fitToLoop(channels, sampleRate, bpm, bars, { offsetSeconds = 0, fadeSeconds = DEFAULT_FADE_SECONDS } = {}) {
  if (!Array.isArray(channels) || channels.length === 0 || !channels.every(channel => channel instanceof Float32Array)) {
    throw new TypeError('channels must be a non-empty array of Float32Array.');
  }
  if (!channels.every(channel => channel.length === channels[0].length)) throw new RangeError('All channels must have the same length.');
  if (!Number.isFinite(offsetSeconds)) throw new RangeError('offsetSeconds must be a finite number.');
  if (!Number.isFinite(fadeSeconds) || fadeSeconds < 0) throw new RangeError('fadeSeconds must be a finite number of 0 or more.');

  const frames = loopFrames(sampleRate, bpm, bars);
  const offsetFrames = Math.round(offsetSeconds * sampleRate);
  const sourceStart = Math.max(0, offsetFrames);
  const targetStart = Math.max(0, -offsetFrames);
  const fadeFrames = Math.min(Math.round(fadeSeconds * sampleRate), Math.floor(frames / 2));

  return channels.map(channel => {
    const output = new Float32Array(frames);
    const count = Math.min(frames - targetStart, channel.length - sourceStart);
    if (count > 0) output.set(channel.subarray(sourceStart, sourceStart + count), targetStart);
    for (let index = 0; index < fadeFrames; index++) {
      const gain = index / fadeFrames;
      output[index] *= gain;
      output[frames - 1 - index] *= gain;
    }
    return output;
  });
}

/** True when `absoluteStep` (16th-note steps counted upward from 0 since the loop began) starts a new loop of `bars` bars. */
export function isLoopStart(absoluteStep, bars) {
  if (!Number.isInteger(absoluteStep) || absoluteStep < 0) throw new RangeError('absoluteStep must be a whole number of 0 or more.');
  checkBars(bars);
  return absoluteStep % (STEPS_PER_BAR * bars) === 0;
}
