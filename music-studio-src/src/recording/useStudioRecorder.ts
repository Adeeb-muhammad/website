/**
 * React binding for the Music Studio recorder.
 *
 * Three sources share one lifecycle: the microphone (phase 1), the song's
 * master output (phase 2) and both together (phase 3). The take stays in
 * memory until it is downloaded; the microphone and the capture graph are
 * released on stop, discard, page hide and unmount. The capture graph runs on
 * the engine's existing Tone.js context, so there is still one audio clock.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import {
  createMicRecorder,
  type MicRecorder,
  type RecorderError,
  type RecorderState,
  type Take,
} from './micRecorder';
import {
  createCaptureGraph,
  type CaptureAudioContext,
  type CaptureMode,
  type MasterSource,
} from './captureGraph';

export type { CaptureMode };

export interface StudioRecorderView {
  state: RecorderState;
  error: RecorderError | null;
  elapsed: number;
  take: Take | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  discard: () => void;
}

function buildRecorder(mode: CaptureMode, maxSeconds: number): MicRecorder {
  return createMicRecorder({
    maxSeconds,
    // Song-only takes never ask for microphone permission.
    needsMic: mode !== 'master',
    createRecordStream:
      mode === 'mic'
        ? undefined
        : (micStream) =>
            createCaptureGraph({
              context: Tone.getContext().rawContext as unknown as CaptureAudioContext,
              master: Tone.getDestination() as unknown as MasterSource,
              mode: mode as Exclude<CaptureMode, 'mic'>,
              micStream,
            }),
  });
}

export function useStudioRecorder(mode: CaptureMode, maxSeconds = 180): StudioRecorderView {
  const recorder = useMemo(() => buildRecorder(mode, maxSeconds), [mode, maxSeconds]);
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;

  const startedAtRef = useRef(0);
  const [state, setState] = useState<RecorderState>('idle');
  const [error, setError] = useState<RecorderError | null>(null);
  const [take, setTake] = useState<Take | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setState(recorder.state);
    return recorder.onState((next) => {
      setState(next);
      if (next === 'recording') {
        startedAtRef.current = performance.now();
        setElapsed(0);
      }
      if (next === 'stopped') setTake(recorder.result);
      if (next === 'idle' || next === 'error') setTake(null);
    });
  }, [recorder]);

  useEffect(() => {
    // A new source must not inherit the previous take or a half-open microphone.
    setError(null);
    setTake(null);
    setElapsed(0);
    return () => recorder.discard();
  }, [recorder]);

  useEffect(() => {
    if (state !== 'recording') return;
    const id = window.setInterval(() => {
      const seconds = (performance.now() - startedAtRef.current) / 1000;
      setElapsed(Math.min(maxSeconds, seconds));
    }, 200);
    return () => window.clearInterval(id);
  }, [state, maxSeconds]);

  useEffect(() => {
    const release = () => recorderRef.current.discard();
    window.addEventListener('pagehide', release);
    return () => window.removeEventListener('pagehide', release);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setTake(null);
    try {
      await recorder.start();
    } catch (caught) {
      setError(caught as RecorderError);
    }
  }, [recorder]);

  const stop = useCallback(async () => {
    if (recorder.state !== 'recording') return;
    try {
      await recorder.stop();
    } catch (caught) {
      setError(caught as RecorderError);
    }
  }, [recorder]);

  const discard = useCallback(() => {
    recorder.discard();
    setError(null);
    setTake(null);
    setElapsed(0);
  }, [recorder]);

  return { state, error, elapsed, take, start, stop, discard };
}
