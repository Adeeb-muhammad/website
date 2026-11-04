// Wires the voice recorder panel in drum-machine.html to the recorder.
// The microphone is only requested when the user presses RECORD, never on page load.
import { createRecorder } from './voice-recorder.js';
import { describeVoiceState, filenameFor, formatElapsed, userMessageFor } from './voice-recorder-view.js?v=1';

export function mountVoiceRecorder(options = {}) {
  const doc = options.doc ?? document;
  const nav = options.nav ?? (typeof navigator === 'undefined' ? null : navigator);
  const urlApi = options.urlApi ?? URL;
  const win = options.win ?? window;
  const hasMediaRecorder = options.hasMediaRecorder ?? typeof MediaRecorder !== 'undefined';
  const makeRecorder = options.createRecorder ?? createRecorder;
  const byId = id => doc.getElementById(id);

  const panel = byId('voice-panel');
  const recordButton = byId('voice-record');
  const stopButton = byId('voice-stop');
  const discardButton = byId('voice-discard');
  const timeDisplay = byId('voice-time');
  const status = byId('voice-status');
  const takeBox = byId('voice-take');
  const player = byId('voice-player');
  const download = byId('voice-download');
  if (![panel, recordButton, stopButton, discardButton, timeDisplay, status, takeBox, player, download].every(Boolean)) return null;

  const supported = Boolean(nav?.mediaDevices?.getUserMedia) && hasMediaRecorder;
  const recorder = supported ? makeRecorder() : null;
  let take = null;
  let takeUrl = null;
  let errorMessage = '';
  let startedAt = 0;
  let ticker = null;

  function render() {
    const view = describeVoiceState({ state: recorder?.state ?? 'idle', errorMessage, hasTake: Boolean(take), supported });
    recordButton.disabled = !view.canRecord;
    stopButton.disabled = !view.canStop;
    discardButton.disabled = !view.canDiscard;
    status.textContent = view.status;
    panel.dataset.tone = view.tone;
    takeBox.hidden = !take;
  }

  // Visual timer only. The recording length itself is limited inside the recorder.
  function stopTicker() {
    if (ticker !== null) win.clearInterval(ticker);
    ticker = null;
  }
  function startTicker() {
    stopTicker();
    startedAt = win.performance.now();
    timeDisplay.textContent = formatElapsed(0);
    ticker = win.setInterval(() => { timeDisplay.textContent = formatElapsed((win.performance.now() - startedAt) / 1000); }, 250);
  }

  function clearTake() {
    if (takeUrl) urlApi.revokeObjectURL(takeUrl);
    takeUrl = null;
    take = null;
    player.removeAttribute('src');
    download.removeAttribute('href');
    download.removeAttribute('download');
  }

  function showTake(result) {
    clearTake();
    take = result;
    takeUrl = urlApi.createObjectURL(result.blob);
    player.src = takeUrl;
    download.href = takeUrl;
    download.download = filenameFor(result.extension);
  }

  function reportError(error) {
    errorMessage = userMessageFor(error) ?? '';
    render();
  }

  if (recorder) {
    recorder.onState(state => {
      if (state === 'recording') startTicker();
      else stopTicker();
      if (state === 'stopped' && recorder.result && recorder.result !== take) showTake(recorder.result); // covers the max-length auto-stop
      render();
    });

    recordButton.addEventListener('click', async () => {
      errorMessage = '';
      clearTake();
      timeDisplay.textContent = formatElapsed(0);
      try {
        await recorder.start();
      } catch (error) {
        reportError(error);
      }
    });

    stopButton.addEventListener('click', async () => {
      try {
        const result = await recorder.stop();
        if (result !== take) showTake(result); // normally already shown by the 'stopped' notification
        render();
      } catch (error) {
        reportError(error);
      }
    });

    discardButton.addEventListener('click', () => {
      errorMessage = '';
      recorder.discard();
      clearTake();
      timeDisplay.textContent = formatElapsed(0);
      render();
    });

    win.addEventListener('pagehide', () => {
      recorder.discard();
      clearTake();
    });
  }

  render();
  panel.hidden = false;
  return { recorder };
}

if (typeof document !== 'undefined') mountVoiceRecorder();
