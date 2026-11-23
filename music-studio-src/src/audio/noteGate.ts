/**
 * In-flight MIDI bookkeeping for the virtual keyboard.
 *
 * `noteOn` waits for the audio context to unlock. A key-up can arrive during
 * that wait, and an unlock can fail. This gate records both cases so a failed
 * note-on never leaves a stale entry that would make the next key press think
 * the key is already down.
 */
export class NoteGate {
  private inflight = new Map<string, Set<number>>();
  private waiting = new Map<string, Set<number>>();

  begin(channelId: string, midi: number): void {
    let notes = this.inflight.get(channelId);
    if (!notes) {
      notes = new Set();
      this.inflight.set(channelId, notes);
    }
    notes.add(midi);
  }

  /** Called when the note-on fails before it sounds: forget it entirely. */
  fail(channelId: string, midi: number): void {
    this.inflight.get(channelId)?.delete(midi);
    this.waiting.get(channelId)?.delete(midi);
  }

  /**
   * Called after unlock succeeds. Removes the in-flight entry and reports
   * whether a key-up arrived while waiting, in which case the attack is skipped.
   */
  complete(channelId: string, midi: number): boolean {
    const releasedEarly = this.waiting.get(channelId)?.delete(midi) ?? false;
    this.inflight.get(channelId)?.delete(midi);
    return releasedEarly;
  }

  /** Record a key-up for an in-flight note. Returns true when it was in flight. */
  noteOff(channelId: string, midi: number): boolean {
    if (!this.inflight.get(channelId)?.has(midi)) return false;
    let waiting = this.waiting.get(channelId);
    if (!waiting) {
      waiting = new Set();
      this.waiting.set(channelId, waiting);
    }
    waiting.add(midi);
    return true;
  }

  clear(): void {
    this.inflight.clear();
    this.waiting.clear();
  }
}
