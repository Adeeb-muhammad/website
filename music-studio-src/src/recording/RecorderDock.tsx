/**
 * Recorder panel. Three sources share one dock: the microphone (phase 1),
 * the song's master output (phase 2) and both together (phase 3). The take
 * stays in the page: record, play it back, download it. It is intentionally
 * not wired into the song — NeonDAW has pattern clips, not audio clip tracks.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Mic, Square, Trash2, X } from 'lucide-react';
import { useStudioRecorder, type CaptureMode } from './useStudioRecorder';

const MAX_SECONDS = 180;

const SOURCE_OPTIONS: Array<{
  mode: CaptureMode;
  label: string;
  hint: string;
  start: string;
}> = [
  {
    mode: 'mic',
    label: 'MIC',
    hint: 'Record vocals or an instrument. The take stays in this page until you download it — it is not added to the song yet.',
    start: 'START RECORDING',
  },
  {
    mode: 'master',
    label: 'SONG',
    hint: 'Record the song itself, captured from the master output at the volume you hear. Press play first — a stopped song records silence.',
    start: 'RECORD THE SONG',
  },
  {
    mode: 'combined',
    label: 'MIC + SONG',
    hint: 'Record your voice over the song in one take. Use headphones so the microphone does not pick up the speakers.',
    start: 'RECORD VOICE + SONG',
  },
];

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

function takeStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

export function RecorderDock() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CaptureMode>('mic');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const { state, error, elapsed, take, start, stop, discard } = useStudioRecorder(mode, MAX_SECONDS);
  const activeOption = SOURCE_OPTIONS.find((option) => option.mode === mode) ?? SOURCE_OPTIONS[0];

  useEffect(() => {
    if (!take) {
      setAudioUrl(null);
      return;
    }
    const url = URL.createObjectURL(take.blob);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [take]);

  const openRecorder = () => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  };

  const close = () => {
    if (state === 'requesting') discard();
    setOpen(false);
  };

  const changeMode = (next: CaptureMode) => {
    if (next === mode) return;
    if (take && !window.confirm('Switching the source discards this take. Continue?')) return;
    setMode(next);
  };

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const focusable = () => panel
      ? [...panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )]
      : [];

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (!panel?.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previousOverflow;
      // Give focus back to the button that opened the panel (or whatever had it).
      const previous = restoreFocusRef.current;
      restoreFocusRef.current = null;
      previous?.focus?.();
    };
    // close() reads `state`; re-register when it changes so Esc cancels a permission prompt.
  }, [open, state]);

  const download = () => {
    if (!take || !audioUrl) return;
    const link = document.createElement('a');
    link.href = audioUrl;
    link.download = `music-studio-take-${takeStamp()}.${take.extension}`;
    document.body.append(link);
    link.click();
    link.remove();
  };

  const recording = state === 'recording';
  const requesting = state === 'requesting';
  const busy = recording || requesting;
  const remaining = Math.max(0, MAX_SECONDS - elapsed);

  return (
    <>
      <button
        type="button"
        onClick={openRecorder}
        aria-label="Open the recorder"
        className="fixed right-3 bottom-12 z-[75] flex items-center gap-2 rounded-xl border-2 border-ink bg-card px-3 py-2 text-[11px] font-extrabold text-ink shadow-hard-sm transition-transform hover:-translate-y-0.5 active:translate-y-0.5 md:right-4 md:bottom-14"
      >
        <Mic className="h-4 w-4" strokeWidth={2.6} />
        <span className="hidden sm:inline">RECORD</span>
        {recording && <span className="h-2 w-2 animate-pulse rounded-full bg-neon-pink" />}
        {recording && <span className="tabular-nums">{clock(elapsed)}</span>}
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-[96] flex items-end justify-center bg-ink/45 p-3 sm:items-center"
          onClick={(event) => { if (event.target === event.currentTarget) close(); }}
        >
          <section
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="recorder-title"
            className="max-h-[85dvh] w-full max-w-[420px] overflow-y-auto rounded-2xl border-2 border-ink bg-bg-warm p-4 text-ink shadow-hard"
          >
            <header className="mb-3 flex items-center gap-2">
              <Mic className="h-4 w-4" strokeWidth={2.8} />
              <h2 id="recorder-title" className="label-caps">Recorder</h2>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                aria-label="Close recorder"
                className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg border-2 border-ink bg-card shadow-hard-sm transition-transform active:translate-y-0.5"
              >
                <X className="h-4 w-4" strokeWidth={2.8} />
              </button>
            </header>

            <div role="group" aria-label="Recording source" className="mb-3 grid grid-cols-3 gap-2">
              {SOURCE_OPTIONS.map((option) => (
                <button
                  key={option.mode}
                  type="button"
                  aria-pressed={mode === option.mode}
                  disabled={busy}
                  onClick={() => changeMode(option.mode)}
                  className={`rounded-xl border-2 border-ink px-1 py-2 text-[10px] font-extrabold tracking-wide shadow-hard-sm transition-transform active:translate-y-0.5 disabled:opacity-40 ${
                    mode === option.mode ? 'bg-neon-yellow' : 'bg-card'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <p className="mb-3 text-xs font-semibold text-fg-muted">{activeOption.hint}</p>

            {state === 'idle' && (
              <button
                type="button"
                onClick={() => void start()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-ink bg-neon-pink px-3 py-3 text-sm font-extrabold text-ink shadow-hard-sm transition-transform active:translate-y-0.5"
              >
                <Mic className="h-4 w-4" strokeWidth={2.8} /> {activeOption.start}
              </button>
            )}

            {requesting && (
              <div className="rounded-xl border-2 border-ink bg-card p-3">
                <p className="text-sm font-extrabold">
                  {mode === 'master' ? 'Preparing the song capture…' : 'Waiting for microphone permission…'}
                </p>
                <p className="mt-1 text-xs font-semibold text-fg-muted">
                  {mode === 'master'
                    ? 'Nothing is sent to the speakers; the song is captured internally.'
                    : 'Choose Allow in the browser prompt. Your voice is not played through the speakers.'}
                </p>
                <button
                  type="button"
                  onClick={discard}
                  className="mt-3 w-full rounded-xl border-2 border-ink bg-bg-warm px-3 py-2 text-xs font-extrabold shadow-hard-sm"
                >
                  CANCEL
                </button>
              </div>
            )}

            {recording && (
              <div className="rounded-xl border-2 border-ink bg-card p-3">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 animate-pulse rounded-full bg-neon-pink" />
                  <span className="text-sm font-extrabold tabular-nums">{clock(elapsed)}</span>
                  <span className="ml-auto text-[10px] font-bold tracking-widest text-fg-muted uppercase">
                    {clock(remaining)} left
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full border border-ink/20 bg-panel">
                  <div
                    className="h-full bg-neon-pink transition-[width] duration-200"
                    style={{ width: `${Math.min(100, (elapsed / MAX_SECONDS) * 100)}%` }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void stop()}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-ink bg-neon-yellow px-3 py-2.5 text-sm font-extrabold shadow-hard-sm transition-transform active:translate-y-0.5"
                >
                  <Square className="h-4 w-4" strokeWidth={2.8} /> STOP
                </button>
                <p className="mt-2 text-[11px] font-semibold text-fg-muted">
                  {mode === 'mic' && 'Nothing is sent to the speakers here.'}
                  {mode === 'master' && 'Captured from the master output; turning the speakers down does not change the take.'}
                  {mode === 'combined' && 'Use headphones: the song plays while the microphone records, and speaker bleed would be captured too.'}
                </p>
                <p className="mt-1 text-[11px] font-semibold text-fg-muted">
                  Closing this panel keeps recording — reopen it from the RECORD button to stop.
                </p>
              </div>
            )}

            {state === 'stopped' && take && audioUrl && (
              <div className="rounded-xl border-2 border-ink bg-card p-3">
                <p className="mb-2 text-sm font-extrabold">Take ready</p>
                <audio className="w-full" controls src={audioUrl} preload="metadata" />
                <p className="mt-2 text-[11px] font-semibold text-fg-muted">
                  {clock(elapsed)} · {(take.blob.size / 1024).toFixed(0)} KB · {take.extension.toUpperCase()}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={download}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-ink bg-neon-green px-3 py-2 text-xs font-extrabold shadow-hard-sm"
                  >
                    <Download className="h-4 w-4" strokeWidth={2.8} /> DOWNLOAD
                  </button>
                  <button
                    type="button"
                    onClick={discard}
                    className="flex items-center justify-center gap-2 rounded-xl border-2 border-ink bg-bg-warm px-3 py-2 text-xs font-extrabold shadow-hard-sm"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={2.8} /> DISCARD
                  </button>
                </div>
              </div>
            )}

            {state === 'error' && (
              <div className="rounded-xl border-2 border-ink bg-card p-3">
                <p role="alert" className="text-sm font-extrabold text-neon-pink">
                  {error?.message ?? 'The recording stopped before it could finish. Try again.'}
                </p>
                <button
                  type="button"
                  onClick={() => void start()}
                  className="mt-3 w-full rounded-xl border-2 border-ink bg-neon-pink px-3 py-2 text-xs font-extrabold shadow-hard-sm"
                >
                  TRY AGAIN
                </button>
              </div>
            )}

            <p className="mt-3 text-[10px] font-semibold tracking-wide text-fg-muted">
              Maximum {MAX_SECONDS / 60} minutes. The microphone and the capture are released when you stop or leave the page.
            </p>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
