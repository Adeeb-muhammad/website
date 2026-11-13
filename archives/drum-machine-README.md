# Drum machine — original snapshot

A restore archive for the drum machine page exactly as it is on `main` at commit
[`046befd`](https://github.com/Adeeb-muhammad/website/commit/046befd1e98d6aebfde423a8dff04c32bf86e947)
(“Merge pull request #48 from Adeeb-muhammad/fix/looper-stop-fade”, 2026-11-13).

| | |
| --- | --- |
| Archive | `archives/drum-machine-original.zip` |
| Contents | 44 files: 1 page, 29 assets, 14 tests |
| Archive size | 391,966 bytes |
| Archive SHA-256 | `68386fdc11c3e90f89bb82f3976887d512b1ceee41d2bfbba672cccf80829a3a` |
| Source commit | `046befd1e98d6aebfde423a8dff04c32bf86e947` |

This README sits next to the zip; it is **not** inside the zip, so copy both if you move the archive.

## What is inside

Zip paths start at the site root, so `drum-machine.html` is at the top level.

```
drum-machine.html                       the page: markup, inline SVG, the <audio> player
assets/favicon.svg                      the only image the page or its styles reference

assets/css/style.css                    site shell (header, nav, footer, typography)
assets/css/drum-machine.css             sequencer, pads, transport
assets/css/chord-mode.css               CHORD_MODE panel
assets/css/voice-recorder.css           VOICE_REC panel
assets/css/looper.css                   LOOP_STATION panel

assets/fonts/fonts.css                  @font-face declarations
assets/fonts/geist-400.ttf              body text
assets/fonts/geist-500.ttf
assets/fonts/geist-700.ttf
assets/fonts/jetbrains-mono-400.ttf     labels and readouts
assets/fonts/jetbrains-mono-500.ttf
assets/fonts/syne-400.ttf               headings and brand
assets/fonts/syne-700.ttf
assets/fonts/syne-800.ttf

assets/js/misc-nav.js                   mobile nav toggle (classic script, loads first)
assets/js/drum-machine.js               sequencer, synthesized voices, look-ahead scheduler,
                                        exposes window.StepEngine
assets/js/master-limiter.js             final peak limiter between master gain and speakers
assets/js/chord-theory.js               pure music maths (keys, progressions, MIDI to Hz)
assets/js/synth-voice.js                playChord pad voice
assets/js/chord-mode.js                 chord progression engine on StepEngine steps
assets/js/chord-mode-ui.js              CHORD_MODE panel wiring
assets/js/voice-recorder.js             microphone recorder with injected browser APIs
assets/js/voice-recorder-view.js        pure panel logic (labels, buttons, filenames)
assets/js/voice-recorder-ui.js          VOICE_REC panel wiring
assets/js/loop-math.js                  pure loop maths: frame counts, fitToLoop, edge fades
assets/js/looper.js                     looper engine, four tracks, per-source stop fade
assets/js/looper-view.js                pure LOOP_STATION panel logic
assets/js/looper-ui.js                  LOOP_STATION panel wiring

tests/chord-mode.test.mjs
tests/chord-theory.test.mjs
tests/loop-math.test.mjs
tests/looper-count-in.test.mjs
tests/looper-fakes.mjs                  shared fake AudioContext / StepEngine / recorder
tests/looper-latency-freeze.test.mjs
tests/looper-stop-fade.test.mjs
tests/looper-ui-lifecycle.test.mjs
tests/looper-view.test.mjs
tests/looper.test.mjs
tests/master-limiter.test.mjs
tests/synth-voice.test.mjs
tests/voice-recorder-view.test.mjs
tests/voice-recorder.test.mjs
```

The 14 tests are every test that imports one of the modules above, plus the shared
`looper-fakes.mjs` helper they import. `archive.test.mjs` and `tools.test.mjs` belong to other
pages and are deliberately not included.

### Not in the archive

- Every other page: `index.html`, `currently-watching.html`, `reading-log.html`, `studio.html`,
  `tools.html`, `canvas-pro.html`, `404.html`. The nav and footer link to them, but the drum
  machine does not load them.
- Their code: `app.js`, `core.js`, `studio.js`, `tools.js`, `tools-core.js`, `notebook.js`,
  `canvas-pro.js`.
- Repo tooling: `package.json`, `scripts/build.mjs`, `scripts/check-js.mjs`, `data/archive.json`
  and the CSS/HTML of pages not listed above. None of it is needed to run the page or the tests.
- No audio samples, poster images or other data: every drum and chord sound is synthesized by
  `drum-machine.js` / `synth-voice.js` in the browser.

## Dependencies

**Runtime — none to install.** There is no framework, library, CDN, bundler or build step.
The page runs from static files only.

Browser features it uses:

| Feature | Used for |
| --- | --- |
| ES modules (`<script type="module">`) | loading `drum-machine.js` and the three panel UIs |
| Web Audio API — `AudioContext`, `AudioBufferSourceNode`, `GainNode`, `BiquadFilterNode`, `DynamicsCompressorNode`, `OscillatorNode` | drum voices, the chord pad, the limiter and the scheduler clock |
| `MediaRecorder`, `navigator.mediaDevices.getUserMedia` | VOICE_REC and LOOP_STATION recording (microphone permission is requested only when REC is pressed) |
| `Blob`, `URL.createObjectURL`, `<audio>` | playing back a recorded take |
| CSS custom properties, `clamp()`, `backdrop-filter`, `:focus-visible` | layout and styling |
| Local TrueType fonts and an SVG favicon | typography and tab icon |

The audio path is: drum voices and the chord pad → master gain → `master-limiter.js` → speakers.
One clock only: features schedule on `StepEngine` step events and `AudioContext.currentTime`;
there is no second timer.

**Tests — Node only.** `node:test` and `node:assert/strict` are built in; there are no npm
dependencies. The tests import `../assets/js/*.js` and `./looper-fakes.mjs`, so `tests/` must
stay next to `assets/`. Verified on Node v26.13.0; Node 18+ is expected to work.

**Serving — any static file server.** `file://` will not work because ES modules are blocked by
the browser's origin rules. GitHub Pages serves the live site; for a local check, any static
server rooted at the folder works.

## Restore steps

The zip's root is the site root. Restoring into a clone overwrites the current versions of
exactly these 44 files and touches nothing else.

```sh
# 1. Get the repo (or any folder you want to restore into)
git clone https://github.com/Adeeb-muhammad/website.git
cd website

# 2. Check the archive first (recommended)
unzip -t archives/drum-machine-original.zip
#    Windows PowerShell equivalent:
#    Expand-Archive archives/drum-machine-original.zip -DestinationPath . -Force

# 3. Restore over the tree
unzip archives/drum-machine-original.zip -d .

# 4. Run the 14 drum machine tests (no npm install needed)
node --test tests/chord-mode.test.mjs tests/chord-theory.test.mjs tests/loop-math.test.mjs \
  tests/looper-count-in.test.mjs tests/looper-latency-freeze.test.mjs \
  tests/looper-stop-fade.test.mjs tests/looper-ui-lifecycle.test.mjs \
  tests/looper-view.test.mjs tests/looper.test.mjs tests/master-limiter.test.mjs \
  tests/synth-voice.test.mjs tests/voice-recorder-view.test.mjs tests/voice-recorder.test.mjs

# 5. Serve the folder over HTTP and open drum-machine.html
#    e.g. any static server rooted here; the page is /drum-machine.html
```

If you only want to look at the page, steps 1–3 and 5 are enough: unzip into an empty folder,
serve that folder, open `drum-machine.html`. Press START LOOP to hear it (the microphone is
only touched when you press RECORD / REC).

To restore the whole repo's own checks as well, run `npm run check` from a full clone; it needs
`package.json` and `scripts/`, which this archive intentionally leaves out.

## Verification performed on this archive

- `unzip -t archives/drum-machine-original.zip` → 44 files tested, **“No errors detected in
  compressed data”**.
- Extracted with `unzip` into a new empty folder: **44 files, SHA-256 identical to the copies in
  the repo** (0 mismatches).
- Ran the 13 test files from that extracted folder with `node --test`: **143 tests, 143 pass,
  0 fail**, with no `package.json` and no `npm install`.
- Served the extracted folder on `http://127.0.0.1:8137` and loaded
  `http://127.0.0.1:8137/drum-machine.html` in headless Chrome 153.0.8010.53 at 1280×900:
  - **29 network responses, zero 4xx/5xx, zero failed requests, zero 404s in the server log.**
  - **Zero console messages and zero uncaught exceptions.**
  - `window.StepEngine` present with `getAudioContext`, `getBpm`, `getMasterGain`, `isPlaying`,
    `on`; the CHORD_MODE, VOICE_REC and LOOP_STATION panels became visible; 4 looper tracks and
    4 sequencer rows; 6 stylesheets loaded; `document.fonts.status === "loaded"`.
  - After a synthetic click on START LOOP: `StepEngine.isPlaying()` → `true`, AudioContext
    `state` → `running`, button text → `STOP LOOP ×`.
- `npm run check` on the repo after adding the archive: syntax check, 163 tests passing, build
  succeeds. (The archive files themselves are not part of that check.)

## What was not verified

- **Nobody listened to it.** Headless Chrome was launched with `--mute-audio`; the test above
  proves the page loads, the modules run and the audio context starts, not how the drums,
  chords or looper sound.
- **The microphone path was not exercised.** Headless Chrome has no microphone and no
  permission prompt, so `MediaRecorder` / `getUserMedia` / take playback were not run. Those
  paths are covered only by the Node fakes in `tests/`.
- **No real-device or mobile check.** No phone, no touch input, no 390 px layout review, no
  BFCache/pagehide check on a real browser.
- **Not tested on GitHub Pages.** The local Node server sent `text/javascript` for `.js` and
  `font/ttf` for `.ttf`; GitHub Pages' MIME types and CDN caching were not observed.
- The single external reference on the page is the `rel="canonical"` URL, which is inert and
  was not fetched.
