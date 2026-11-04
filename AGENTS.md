# Adeeb’s Vault editing preferences

- When a dictated movie or series title is unclear, leave it out of the published collection and ask Adeeb to confirm the exact title or year. Do not guess or silently substitute a similar title.
- If a title has several versions or sequels and the intended one is unclear, ask which version before adding it.
- Preserve the last rating Adeeb states, exactly, on a five-star scale. Decimal scores such as 4.4 and 4.8 must not be rounded to half stars.
- Do not invent a rating, watched date, review, job title, or professional role. Ask for missing information when it is needed.
- Keep anime in its own collection. Films in any language are welcome.
- Keep this project static, using GitHub Pages and data/archive.json. Public content is published through GitHub; the Studio is a browser-local draft editor.

## Working on the site's code (any AI assistant)

These rules apply to every assistant: Claude, ChatGPT, Gemini, or a free OpenCode model.

- One feature per branch and one pull request. Never push to `main`; Adeeb merges.
- Prefer new files over editing shared ones (`assets/js/drum-machine.js`, `assets/js/tools.js`, `drum-machine.html`, `tools.html`). List any shared-file change in the PR description.
- Do not touch `assets/js/notebook.js`, the Notes Canvas, or existing `localStorage` keys. New storage must use a new, clearly prefixed key, and the PR must say so.
- Bump the `?v=` query string on any CSS or JS file you change, in every page that loads it.
- Keep the site static: no backend and no new npm packages.
- Never put tokens or secrets in prompts, commits, or PR text. Keep them in git credentials or environment variables.
- Do not say something sounds or looks right unless it was checked in a real browser or on a real device. State plainly what was only tested in code.

## Checks before opening a pull request

- Run `npm run check` (syntax checks, tests, and build).
- Run `node --check` on every JS file you change, even if `npm run check` should already cover it. A syntax error in one file can stop a whole page's script from loading.
- Tests use Node's built-in runner and live in `tests/*.test.mjs`; `npm test` runs them. Put new logic tests there.
- Tests for audio, microphone and timing code must use a fake that behaves like the browser. A fake `MediaRecorder` must deliver its final data after `stop()` returns, a fake `getUserMedia` must take time to answer (the permission prompt), and Web Audio parameter automation should be modelled and not only recorded. Fakes that finish instantly hide real race bugs (this once hid a microphone left on after cancelling).
- Confirm every element id a script looks up still exists in the page, and that you added no duplicate top-level function names. In an ES module a duplicate declaration stops the whole script from loading, which is what broke the Notes Canvas once.

## Drum machine timing interface

`assets/js/drum-machine.js` exposes `window.StepEngine`. New features (chords, voice, looper) use it instead of making their own timers.

- `StepEngine.on('step', fn)` receives `{ step, when, bpm, stepDuration }`. `when` is in `AudioContext.currentTime` seconds. Schedule sounds against it. Never add a second `setInterval` clock.
- `StepEngine.on('stop', fn)` fires when playback stops. Cancel anything you scheduled.
- `StepEngine.getMasterGain()` is the shared output. Connect new voices there. `getAudioContext()`, `getBpm()` and `isPlaying()` are also available.
- A `stepengine:ready` event fires on `document` once the API exists. `on()` returns an unsubscribe function.

## Which assistant for which task

Adeeb has several free assistants. Free tiers are limited-time, so any model that fits the row can stand in if one disappears. No assistant can call another; Adeeb runs them and an assistant other than the author reviews the result.

| Task | Good choices |
| --- | --- |
| Pure logic with tests, boilerplate, many similar files | GLM 5.3 Flash, DeepSeek V4.1 Flash, Beam, ChatGPT, Gemini |
| Bug from a screenshot, mobile layout | Gemini, GLM 5.3 Flash, MiMo V2.6 Flash, Nemotron 3.5 Super VL (models that accept images) |
| Reading a very large file or whole repo | 1M-context models: GLM 5.3 Flash, DeepSeek V4.1 Flash, Beam, MiMo V2.6 Flash |
| Small, quick edits | Flint 40B (text-only and new, so verify the result) |
| Wiring into `StepEngine`, timing and audio sync, the looper, anything security-sensitive | Claude or ChatGPT (one writes it, the other reviews it), then Adeeb tests on a real device |
| Reviewing a pull request before merge | The assistant that did not write it (Claude or ChatGPT); see Working together below |
| Browser QA: layout at 390px and 1280px, real Chromium audio measurements, console errors | Copilot with Playwright (it reports and changes no files) |

- Avoid Big Pickle for anything important; the model behind it is not disclosed.
- When any assistant opens a PR, ask a different assistant to review it (see below).

## Working together: Claude and ChatGPT

Claude and ChatGPT (Luna 6) are peer builders on this repo. They cannot talk to each other; Adeeb relays between them, so the repo is the shared memory: this file, `PROJECT_NOTES.md`, and pull request descriptions.

- **The author and the reviewer are different assistants.** Whoever writes a PR does not review it. The other one reviews it before Adeeb merges.
- **Claim work before starting.** Check open PRs and branches first. One assistant per feature, and never edit the same file in parallel branches. If two features need the same shared file, do them one after the other.
- **A review means evidence, not a read-through.** Fetch the PR, confirm only the intended files changed, run `node --check` and `npm run check`, try to break the new code, and inject deliberate bugs ("mutation testing") to see whether the tests catch them. Put the commands and results in the PR, not only in chat.
- **Say what you could not check.** Neither assistant can hear audio or use a real phone. State plainly what was tested only with fakes. Adeeb does the listening and device testing.
- **Do not review by authority.** A reviewer's finding is a claim to be reproduced. If an author disagrees, show a failing test or a command, not an argument.
