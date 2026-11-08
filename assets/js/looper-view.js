// What the looper panel should show and allow for a given looper state. No DOM here, so it is easy to test.
const STATUS = Object.freeze({
  empty: { label: 'EMPTY', tone: 'idle' },
  preparing: { label: 'MIC...', tone: 'info' },
  'count-in': { label: 'COUNT-IN', tone: 'info' },
  recording: { label: 'RECORDING', tone: 'live' },
  processing: { label: 'SAVING...', tone: 'info' },
  ready: { label: 'READY', tone: 'ok' }
});
const BUSY = new Set(['preparing', 'count-in', 'recording', 'processing']);

/** "+25 ms", "-10 ms" or "0 ms" for a latency offset given in seconds. */
export function formatOffset(seconds) {
  const milliseconds = Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
  return `${milliseconds > 0 ? '+' : ''}${milliseconds} ms`;
}

/** Seconds for a slider value in milliseconds, clamped to the engine's limit of 0.5 s. */
export function offsetFromMilliseconds(milliseconds) {
  const value = Number(milliseconds);
  if (!Number.isFinite(value)) return 0;
  return Math.max(-500, Math.min(500, value)) / 1000;
}

/** Plain-language message for a rejected recordTrack, or null when the user cancelled on purpose. */
export function looperMessageFor(error) {
  if (!error || error.code === 'cancelled' || error.code === 'discarded') return null;
  return typeof error.message === 'string' && error.message ? error.message : 'That could not be done. Please try again.';
}

function bannerFor({ snapshot, playing, supported }) {
  if (!supported) return { text: 'Looping is not supported in this browser (it needs a microphone and audio recording).', tone: 'error' };
  if (snapshot.tempoMismatch) {
    return { text: `The tempo changed, so the loops are silent. Set it back to ${snapshot.lockedBpm} BPM, or clear the loops.`, tone: 'error' };
  }
  const failed = snapshot.tracks.find(track => track.message);
  if (failed) return { text: failed.message, tone: 'error' };
  const statuses = new Set(snapshot.tracks.map(track => track.status));
  if (statuses.has('preparing')) return { text: 'Waiting for microphone permission. Choose Allow in your browser prompt.', tone: 'info' };
  if (statuses.has('count-in')) return { text: 'Counting in. Recording starts at the next loop start, so play along with the beat.', tone: 'info' };
  if (statuses.has('recording')) return { text: 'Recording. Keep playing along with the beat.', tone: 'live' };
  if (statuses.has('processing')) return { text: 'Saving your take.', tone: 'info' };
  if (!playing) return { text: 'Press START LOOP, then press REC on a track. Use headphones so the drums are not recorded.', tone: 'idle' };
  if (snapshot.tracks.some(track => track.hasTake)) return { text: 'Loops play on the beat. Mute, replace or clear a track at any time.', tone: 'ok' };
  return { text: 'Press REC on a track to record your first loop.', tone: 'idle' };
}

/** Everything the panel needs: a banner, the tempo lock text, the offset text, and one entry per track. */
export function describeLooperState({ snapshot, playing = false, supported = true } = {}) {
  const busyTrack = snapshot.tracks.find(track => BUSY.has(track.status));
  const canStartRecording = supported && playing && !busyTrack && !snapshot.tempoMismatch;
  return {
    banner: bannerFor({ snapshot, playing, supported }),
    lockText: snapshot.lockedBpm ? `TEMPO LOCKED AT ${snapshot.lockedBpm} BPM` : '',
    offsetText: formatOffset(snapshot.latencyOffset),
    tracks: snapshot.tracks.map(track => {
      const busy = BUSY.has(track.status);
      const canCancel = supported && busy && track.status !== 'processing';
      const status = STATUS[track.status] ?? STATUS.empty;
      let recordLabel = track.hasTake ? '● RE-REC' : '● REC';
      if (canCancel) recordLabel = 'CANCEL';
      else if (track.status === 'processing') recordLabel = 'SAVING...';
      return {
        index: track.index,
        statusLabel: status.label,
        tone: status.tone,
        recordLabel,
        canRecord: canStartRecording,
        canCancel,
        recordEnabled: canStartRecording || canCancel,
        barsDisabled: !supported || Boolean(busyTrack),
        canClear: supported && track.hasTake && !busy,
        canMute: supported && track.hasTake,
        muted: Boolean(track.muted),
        bars: track.bars
      };
    })
  };
}
