/**
 * Serialise audio-context unlock attempts.
 *
 * Browsers may reject `AudioContext.resume()` (autoplay policy, interrupted
 * context, device change). A rejected attempt must not poison later ones:
 * the in-flight promise is cleared in `finally`, and the next gesture or Play
 * press starts a fresh attempt.
 */
export type AudioContextState = 'suspended' | 'running' | 'closed';

export function createUnlockGate(
  getState: () => string,
  start: () => Promise<unknown>,
): () => Promise<void> {
  let pending: Promise<void> | null = null;

  return () => {
    if (getState() === 'running') return Promise.resolve();
    if (pending) return pending;
    pending = (async () => {
      try {
        await start();
      } finally {
        pending = null;
      }
    })();
    return pending;
  };
}
