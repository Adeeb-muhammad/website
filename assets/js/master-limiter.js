// Final-stage peak control for the shared drum and synth output.
// A hard-knee, high-ratio DynamicsCompressorNode only attenuates peaks above -1 dBFS.
const SETTINGS = Object.freeze({
  threshold: -1,
  knee: 0,
  ratio: 20,
  attack: 0.003,
  release: 0.12
});

/**
 * Create the shared output limiter. Connect the master gain to this node and
 * this node to AudioContext.destination so every voice passes through it.
 */
export function createMasterLimiter(audioContext) {
  if (!audioContext || typeof audioContext.createDynamicsCompressor !== 'function') {
    throw new TypeError('createMasterLimiter requires an AudioContext with DynamicsCompressorNode support.');
  }

  const limiter = audioContext.createDynamicsCompressor();
  for (const [name, value] of Object.entries(SETTINGS)) {
    if (!limiter[name] || !('value' in limiter[name])) {
      throw new TypeError('The output limiter is missing its ' + name + ' AudioParam.');
    }
    limiter[name].value = value;
  }

  return limiter;
}
