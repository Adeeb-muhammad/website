/**
 * React binding for the microphone recorder core. Holds the take in memory,
 * ticks the elapsed time and makes sure the microphone is released when the
 * page is hidden or the component goes away.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createMicRecorder,
  type MicRecorder,
  type RecorderError,
  type RecorderState,
  type Take,
} from './micRecorder';

export interface MicRecorderView {
  state: RecorderState;
  error: RecorderError | null;
  elapsed: number;
  take: Take | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  discard: () => void;
}

export function useMicRecorder(maxSeconds = 180): MicRecorderView {
  const recorderRef = useRef<MicRecorder | null>(null);
  if (!recorderRef.current) recorderRef.current = createMicRecorder({ maxSeconds });

  const startedAtRef = useRef(0);
  const [state, setState] = useState<RecorderState>('idle');
  const [error, setError] = useState<RecorderError | null>(null);
  const [take, setTake] = useState<Take | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    return recorder.onState((next) => {
      setState(next);
      if (next === 'recording') {
        startedAtRef.current = performance.now();
        setElapsed(0);
      }
      if (next === 'stopped') setTake(recorder.result);
      if (next === 'idle' || next === 'error') setTake(null);
    });
  }, []);

  useEffect(() => {
    if (state !== 'recording') return;
    const id = window.setInterval(() => {
      const seconds = (performance.now() - startedAtRef.current) / 1000;
      setElapsed(Math.min(maxSeconds, seconds));
    }, 200);
    return () => window.clearInterval(id);
  }, [state, maxSeconds]);

  useEffect(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    const release = () => recorder.discard();
    window.addEventListener('pagehide', release);
    return () => {
      window.removeEventListener('pagehide', release);
      release();
    };
  }, []);

  const start = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    setError(null);
    setTake(null);
    try {
      await recorder.start();
    } catch (caught) {
      setError(caught as RecorderError);
    }
  }, []);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    try {
      await recorder.stop();
    } catch (caught) {
      setError(caught as RecorderError);
    }
  }, []);

  const discard = useCallback(() => {
    recorderRef.current?.discard();
    setError(null);
    setTake(null);
    setElapsed(0);
  }, []);

  return { state, error, elapsed, take, start, stop, discard };
}
