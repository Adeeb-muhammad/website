# Upstream changes

Pinned source: the commit in `UPSTREAM_COMMIT` (unchanged by this work).

The recorder is implemented in new files under `src/recording/`. Only one
upstream file is edited, and only to mount the panel:

| File | Change |
| --- | --- |
| `src/App.tsx` | One import of `RecorderDock` and one `<RecorderDock />` element next to `<SideNav />`. No other logic touched. |

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
because NeonDAW has pattern clips rather than audio clip tracks.

`micRecorder.ts` and `captureGraph.ts` are covered by
`tests/mic-recorder.test.mjs` and `tests/capture-graph.test.mjs` in the site
repo's root test suite, so `npm run check` exercises them without needing the
Vite build.
