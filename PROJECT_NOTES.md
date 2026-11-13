# Project notes

Background for any assistant working on this repo. Rules live in `AGENTS.md`; this file is the map. It avoids PR numbers and statuses because those go stale; check GitHub for the current state.

## What this is
Adeeb's personal static site (GitHub Pages, https://adeebmuh.me): a film and series archive, diary and reading log, plus tools. No backend, no accounts, no build-time dependencies. `npm run build` only generates static output from `data/`.

## Pages
`index.html`, `currently-watching.html`, `reading-log.html`, `studio.html` (edit ratings, saves a local draft), `tools.html` (Notes Canvas and Utility Desk), `canvas-pro.html` (Advanced canvas), `music-studio/index.html` (the music page, a pinned prebuilt DAW), `LICENSES/index.html` (third-party credits), `404.html`.

## Storage
Existing browser storage is in use: the archive draft key `adeeb-vault-draft-v1` (`core.js`) and the Notes Canvas keys (`notebook.js`). Never reuse or clear them. New features use new, clearly prefixed keys and must not reuse or clear these.

## Music Studio
`music-studio/index.html` is the music page: a pinned, prebuilt NeonDAW build (step drums, piano roll, mixer, song arrangement, WAV export). It is static and browser-only. Samples ship in `music-studio/samples/`, credits are in `LICENSES/index.html`, and the source lives in `music-studio-src/`, which GitHub Pages does not serve. Update the page by rebuilding from that source and replacing `music-studio/`; do not hand-edit the hashed bundle.

The hand-written drum machine, chord mode, the voice recorder, the looper and their tests were removed from the live site. Their final code, styles and tests live in git history at commit `046befd`; an archived copy with notes is in `archives/`.

## Other code
`app.js` and `studio.js` render and edit the archive (`core.js` holds shared helpers, with tests). `tools.js` handles Utility Desk routing and `tools-core.js` its browser-independent helpers. `notebook.js` is the Notes Canvas. `canvas-pro.js` is the Advanced canvas (brushes, symmetry, layers, colour grading, no storage).

## How to verify work
- `npm run check` (JavaScript syntax checks, the tests, and the build).
- Tests are `tests/*.test.mjs` using Node's built-in runner.
- For audio logic, run the real module against a fake `AudioContext` and a fake clock, and check scheduled times and the node graph. For anything that races (microphone, permission prompts, stop/discard), make the fake behave like the browser (asynchronous).
- After writing tests, inject deliberate bugs and confirm the tests fail. A passing suite is not proof of a good suite.
- Anything judged by ear or on a phone is verified by Adeeb, not by an assistant.

## Not yet verified by a human
Nobody has listened to Music Studio's audio on a real device, and its layout has not been checked at 390 px or 1280 px by an assistant. Adeeb verifies anything judged by ear or on a phone.

## Roadmap (may be stale; confirm against open PRs)
1. Real-device checks by Adeeb: Music Studio audio, touch targets and phone layout, plus a Copilot browser pass at 390px and 1280px.
2. A final hardening pass: deliberate-bug testing across the project, then fixes.
