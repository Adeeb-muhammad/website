# Project notes

Background for any assistant working on this repo. Rules live in `AGENTS.md`; this file is the map. It avoids PR numbers and statuses because those go stale; check GitHub for the current state.

## What this is
Adeeb's personal static site (GitHub Pages, https://adeebmuh.me): a film and series archive, diary and reading log, plus tools. No backend, no accounts, no build-time dependencies. `npm run build` only generates static output from `data/`.

## Pages
`index.html`, `currently-watching.html`, `reading-log.html`, `studio.html` (edit ratings, saves a local draft), `tools.html` (Notes Canvas and Utility Desk), `canvas-pro.html` (Advanced canvas), `drum-machine.html` (drum machine with chord mode), `404.html`.

## Storage
Existing browser storage is in use: the archive draft key `adeeb-vault-draft-v1` (`core.js`) and the Notes Canvas keys (`notebook.js`). Never reuse or clear them. New features use new, clearly prefixed keys, and most (Advanced canvas, chord mode, the recorder) use none.

## Drum machine map
| File | Role |
| --- | --- |
| `assets/js/drum-machine.js` | 4 tracks x 16 steps, synthesized drum voices, look-ahead scheduler on the audio clock, exposes `window.StepEngine` (API in `AGENTS.md`) |
| `assets/js/master-limiter.js` | Final peak limiter (-1 dB threshold, ratio 20) between the master gain and the speakers |
| `assets/js/chord-theory.js` | Pure music maths: keys, 5 progressions, diatonic chords, MIDI to Hz. MIDI 60 = C4, natural minor |
| `assets/js/synth-voice.js` | `playChord`: a soft pad voice (detuned oscillators, lowpass, envelope) whose `stop()` fades without clicks |
| `assets/js/chord-mode.js` | Engine: plays the progression on `StepEngine` steps 0, 4, 8, 12 through a pad bus and limiter |
| `assets/js/chord-mode-ui.js`, `assets/css/chord-mode.css` | The CHORD_MODE panel; hidden until `StepEngine` exists |
| `assets/js/voice-recorder.js` | Microphone recorder logic with injected browser APIs (not yet wired to a page) |

Audio path: drum voices and the chord pad bus feed the master gain, then the master limiter, then the speakers. One clock only: new audio features schedule on `StepEngine` events and the `AudioContext`, never with their own `setInterval`.

## Other code
`app.js` and `studio.js` render and edit the archive (`core.js` holds shared helpers, with tests). `tools.js` handles Utility Desk routing and `tools-core.js` its browser-independent helpers. `notebook.js` is the Notes Canvas. `canvas-pro.js` is the Advanced canvas (brushes, symmetry, layers, colour grading, no storage).

## How to verify work
- `npm run check` (JavaScript syntax checks, the tests, and the build).
- Tests are `tests/*.test.mjs` using Node's built-in runner.
- For audio logic, run the real module against a fake `AudioContext` and a fake clock, and check scheduled times and the node graph. For anything that races (microphone, permission prompts, stop/discard), make the fake behave like the browser (asynchronous).
- After writing tests, inject deliberate bugs and confirm the tests fail. A passing suite is not proof of a good suite.
- Anything judged by ear or on a phone is verified by Adeeb, not by an assistant.

## Not yet verified by a human
Nobody has listened to chord mode on a real device. The pad level (0.22), pad filter cutoff (1400 Hz) and pad limiter settings are untuned starting values.

## Roadmap (may be stale; confirm against open PRs)
1. Recorder UI (record, stop, play, download, plain-language permission errors, and a latency-offset slider to align a voice take to the beat).
2. Multi-track looper, built last on `StepEngine` and the recorder: normalise every clip to an exact bar length and schedule on the audio clock.
