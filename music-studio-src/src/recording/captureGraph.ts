/**
 * Master (song) capture graph for Music Studio.
 *
 * Phase 2 records the song's own master output; phase 3 records the microphone
 * and the master together. Both graph variants are built on the Tone.js
 * context the engine already owns — this module never creates an
 * AudioContext — and the microphone is connected only to a
 * MediaStreamDestination, never to the speakers.
 */

export type CaptureMode = 'mic' | 'master' | 'combined';

/** Leave headroom so a loud mix plus a loud voice does not clip the take. */
export const MASTER_CAPTURE_GAIN = 0.85;

/** A close, loud microphone can reach full scale; trim it slightly. */
export const MIC_CAPTURE_GAIN = 0.9;

/**
 * The output Tone.getDestination() offers. Typed structurally so this module
 * can be tested against a fake without importing Tone.
 */
export interface MasterSource {
  connect(node: AudioNode): unknown;
  disconnect(node?: AudioNode): void;
}

export interface CaptureAudioContext extends BaseAudioContext {
  createMediaStreamDestination(): MediaStreamAudioDestinationNode;
  createMediaStreamSource(stream: MediaStream): MediaStreamAudioSourceNode;
}

export interface CaptureGraphOptions {
  context: CaptureAudioContext;
  mode: Exclude<CaptureMode, 'mic'>;
  master: MasterSource | null | undefined;
  micStream?: MediaStream | null;
}

export interface CaptureGraph {
  stream: MediaStream;
  release(): void;
}

function captureError(message: string): { code: 'capture'; message: string } {
  return { code: 'capture', message };
}

/**
 * Mix the requested sources into one audio-only MediaStream.
 *
 * The caller owns the microphone's lifetime: release() only disconnects this
 * graph, it does not stop microphone tracks (the recorder core does that).
 */
export function createCaptureGraph({
  context,
  mode,
  master,
  micStream,
}: CaptureGraphOptions): CaptureGraph {
  if (!master) {
    throw captureError('The song could not be captured in this browser. Reload the page and try again.');
  }
  if (mode === 'combined' && !micStream) {
    throw captureError('The microphone stream is missing, so the voice-and-song take could not start.');
  }
  if (typeof context.createMediaStreamDestination !== 'function') {
    throw captureError('This browser cannot capture the song. Try recording the microphone instead.');
  }

  const destination = context.createMediaStreamDestination();
  const masterGain = context.createGain();
  masterGain.gain.value = MASTER_CAPTURE_GAIN;

  const taps: Array<{ disconnect(node?: AudioNode): void }> = [masterGain];
  let micSource: MediaStreamAudioSourceNode | null = null;
  let released = false;

  master.connect(masterGain);
  masterGain.connect(destination);

  if (mode === 'combined' && micStream) {
    const source = context.createMediaStreamSource(micStream);
    const gain = context.createGain();
    gain.gain.value = MIC_CAPTURE_GAIN;
    // Microphone → gain → MediaStreamDestination only. No path to the speakers.
    source.connect(gain);
    gain.connect(destination);
    micSource = source;
    taps.push(gain);
  }

  return {
    stream: destination.stream,
    release() {
      if (released) return;
      released = true;
      // Best-effort: a browser may already have dropped a connection.
      try { master.disconnect(masterGain); } catch { /* already disconnected */ }
      try { micSource?.disconnect(); } catch { /* already disconnected */ }
      for (const tap of taps) {
        try { tap.disconnect(); } catch { /* already disconnected */ }
      }
    },
  };
}
