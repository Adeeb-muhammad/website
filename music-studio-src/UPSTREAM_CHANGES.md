# Upstream changes

Pinned source: the commit in `UPSTREAM_COMMIT` (unchanged by this work).

The recorder is implemented in new files under `src/recording/`. Upstream
files are edited only for the mount and for accessible names on custom
sliders:

| File | Change |
| --- | --- |
| `src/App.tsx` | One import of `RecorderDock` and one `<RecorderDock />` element next to `<SideNav />`. No other logic touched. |
| `src/components/ui/Knob.tsx` | Optional `ariaLabel` prop used as the slider's accessible name when there is no visible label. |
| `src/components/ui/Fader.tsx` | Same optional `ariaLabel` prop. |
| `src/components/layout/TopBar.tsx` | `ariaLabel="Master volume"` on the master knob. |
| `src/components/Mixer/ChannelStrip.tsx` | Accessible names on each channel fader and pan knob. |

New files (not upstream):

- `src/recording/micRecorder.ts` — framework-free recorder core, ported from
  `assets/js/voice-recorder.js` at commit `046befd` of the site repo. It takes
  an optional microphone and an optional stream factory, so song-only takes
  never request microphone permission.
- `src/recording/captureGraph.ts` — mixes the song's master output (and, in
  combined mode, the microphone) into a `MediaStreamDestination`. It runs on
  the Tone.js context the engine already owns and never creates an
  `AudioContext`; the microphone is never connected to the speakers.
- `src/recording/useStudioRecorder.ts` — React binding for the three sources,
  elapsed time, page-hide release (formerly `useMicRecorder.ts`).
- `src/recording/RecorderDock.tsx` — the dock button, source picker and
  recorder panel.

Recording phases: microphone only, the song's master output, or both. All
three produce a downloadable take in the page; none is placed on a track,
because NeonDAW has pattern clips rather than audio clip tracks. The panel
traps Tab, restores focus to its button, and locks background scrolling while
open.

`micRecorder.ts` and `captureGraph.ts` are covered by
`tests/mic-recorder.test.mjs` and `tests/capture-graph.test.mjs` in the site
repo's root test suite, so `npm run check` exercises them without needing the
Vite build.


## Project import validation (site fix)

- `src/utils/projectValidation.ts` (new): runtime validator for imported project
  JSON, including nested IDs, mixer/channel references, patterns, step lengths,
  note bounds, effects, song clips and the 5 MB file limit.
- `src/stores/projectStore.ts`: `importProject` validates before clearing
  history or replacing state; rejected files leave the project unchanged.
- `src/utils/projectIO.ts`: refuses files over 5 MB before reading.
- `src/components/Files/Files.tsx`: validates first, then stops playback, so a
  bad file cannot stop the current song.

The deployed bundle was rebuilt after these changes. CI now typechecks/builds
`music-studio-src` and fails when `music-studio/assets` is stale.


## Audio unlock and storage reliability

- `src/audio/unlock.ts` (new): serialises `Tone.start()` attempts and clears the
  in-flight promise in `finally`, so a rejected resume cannot block retries.
- `src/audio/noteGate.ts` (new): in-flight/waiting MIDI note bookkeeping; a
  failed note-on removes the key instead of leaving it stuck down.
- `src/audio/engine.ts`: uses both helpers, rejects an unlock that leaves the
  context suspended, clears the audio-error state on success, and converts
  unlock failures in `play`, `noteOn` and preview methods into a UI notice
  instead of an unhandled rejection.
- `src/stores/projectStorage.ts` (new): debounced storage adapter that reports
  quota/security failures and successful retries.
- `src/stores/projectStore.ts`: uses the adapter; failed autosaves mark the UI
  error state while the in-memory project is preserved.
- `src/stores/uiStore.ts`, `src/App.tsx`, `src/i18n/ui.ts`: accessible notice
  for blocked audio and failed autosave, with English and Chinese copy.
- The deployed bundle was rebuilt; no project schema or storage key changed.


## Dark theme (Adeeb's Vault)

Visual only; no audio, state or storage changes.

- `src/index.css`: design tokens switched to the site palette (`--bg #080808`,
  panel `#0e0e0e`, surface `#131313`, ink `#e8e5df`, muted `#888780`), Geist
  font, plus an unlayered override block at the end (accent `#faff00` for
  selected states, dim borders, dark text on neon and inline-coloured fills).
- Hard-coded light colours replaced in: `ui/IconButton`, `ui/Tooltip`,
  `Keyboard/LiveKeys` (black keys, beat dots, labels), `Synth/Synth`,
  `Synth/SynthPanel` (strokes), `Song/Song`, `ChannelRack/StepGrid`,
  `ChannelRack/ChannelList`, `layout/HomeGrid`, and the grid lines and
  velocity tint in `PianoRoll/{GridArea,PianoRoll,VelocityStrip}`.
- The built output in `music-studio/assets/` was regenerated.
