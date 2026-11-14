# Upstream changes

Pinned source: the commit in `UPSTREAM_COMMIT` (unchanged by this work).

The recorder is implemented in new files under `src/recording/`. Only one
upstream file is edited, and only to mount the panel:

| File | Change |
| --- | --- |
| `src/App.tsx` | One import of `RecorderDock` and one `<RecorderDock />` element next to `<SideNav />`. No other logic touched. |

New files (not upstream):

- `src/recording/micRecorder.ts` — framework-free recorder core, ported from
  `assets/js/voice-recorder.js` at commit `046befd` of the site repo.
- `src/recording/useMicRecorder.ts` — React binding, elapsed time, page-hide
  release.
- `src/recording/RecorderDock.tsx` — the dock button and the recorder panel.

`src/recording/micRecorder.ts` is covered by `tests/mic-recorder.test.mjs` in
the site repo's root test suite, so `npm run check` exercises it without
needing the Vite build.
