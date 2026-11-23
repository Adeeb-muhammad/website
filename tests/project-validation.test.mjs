import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PROJECT_FILE_BYTES,
  PROJECT_LIMITS,
  projectValidationMessage,
  validateProject,
} from '../music-studio-src/src/utils/projectValidation.ts';

const emptySteps = (bars = 1) => Array.from({ length: bars * 16 }, () => ({ on: false, velocity: 100 }));

function validProject() {
  return {
    bpm: 120,
    currentPatternId: 'pattern-1',
    channels: [{
      id: 'ch-kick',
      name: 'Kick',
      kind: 'drum',
      color: '#00E5FF',
      drumType: 'kick',
      mixerTrackId: 'track-kick',
    }],
    mixerTracks: [
      { id: 'track-kick', name: 'Kick', volume: 0.8, pan: 0, mute: false, solo: false, effects: [] },
      {
        id: 'track-master', name: 'Master', volume: 0.85, pan: 0, mute: false, solo: false,
        effects: [{ id: 'fx-1', type: 'limiter', params: { threshold: -1 }, bypass: false }],
      },
    ],
    patterns: [{
      id: 'pattern-1',
      name: 'Pattern 1',
      bars: 1,
      steps: { 'ch-kick': emptySteps() },
      notes: [{ id: 'note-1', channelId: 'ch-kick', pitch: 36, startStep: 0, lengthSteps: 1, velocity: 100 }],
    }],
    song: { tracks: [{ id: 'song-track-1', clips: [{ id: 'clip-1', patternId: 'pattern-1', startBar: 0 }] }] },
  };
}

test('a valid exported project is accepted and missing step channels are filled', () => {
  const project = validProject();
  delete project.patterns[0].steps['ch-kick'];
  const parsed = validateProject(project);
  assert.equal(parsed.bpm, 120);
  assert.equal(parsed.patterns[0].steps['ch-kick'].length, 16);
  assert.equal(parsed.patterns[0].notes[0].pitch, 36);
  assert.equal(projectValidationMessage(new Error('plain')), 'The project file is not valid.');
  assert.equal(MAX_PROJECT_FILE_BYTES, 5 * 1024 * 1024);
});

test('missing and wrong top-level fields are rejected', () => {
  for (const key of ['patterns', 'channels', 'mixerTracks', 'song', 'currentPatternId', 'bpm']) {
    const project = validProject();
    delete project[key];
    assert.throws(() => validateProject(project), /must|missing/i, key);
  }
  assert.throws(() => validateProject(null), /object/i);
  assert.throws(() => validateProject({ ...validProject(), bpm: 59 }), /bpm/i);
  assert.throws(() => validateProject({ ...validProject(), bpm: 120.5 }), /whole/i);
  assert.throws(() => validateProject({ ...validProject(), currentPatternId: 'pattern-missing' }), /missing pattern/i);
});

test('duplicate ids and broken channel/mixer references are rejected', () => {
  let project = validProject();
  project.channels.push({ ...project.channels[0] });
  assert.throws(() => validateProject(project), /Duplicate channel id/);

  project = validProject();
  project.channels[0].mixerTrackId = 'track-missing';
  assert.throws(() => validateProject(project), /missing mixer track/);

  project = validProject();
  project.mixerTracks = project.mixerTracks.filter(track => track.id !== 'track-master');
  assert.throws(() => validateProject(project), /Master/);

  project = validProject();
  project.patterns.push({ ...project.patterns[0] });
  assert.throws(() => validateProject(project), /Duplicate pattern id/);

  project = validProject();
  project.song.tracks[0].clips[0].patternId = 'pattern-missing';
  assert.throws(() => validateProject(project), /missing pattern/);
});

test('pattern bars, step arrays, notes and channel references are validated', () => {
  let project = validProject();
  project.patterns[0].bars = 3;
  assert.throws(() => validateProject(project), /bars/i);

  project = validProject();
  project.patterns[0].steps['ch-kick'] = project.patterns[0].steps['ch-kick'].slice(0, 15);
  assert.throws(() => validateProject(project), /contain 16/);

  project = validProject();
  project.patterns[0].steps['ch-missing'] = emptySteps();
  assert.throws(() => validateProject(project), /unknown channel/);

  project = validProject();
  project.patterns[0].steps['ch-kick'][0].velocity = 128;
  assert.throws(() => validateProject(project), /velocity/i);

  project = validProject();
  project.patterns[0].notes[0].pitch = 128;
  assert.throws(() => validateProject(project), /pitch/i);

  project = validProject();
  project.patterns[0].notes[0].startStep = 1;
  project.patterns[0].notes[0].lengthSteps = 16;
  assert.throws(() => validateProject(project), /extends past/);

  project = validProject();
  project.patterns[0].notes[0].channelId = 'ch-missing';
  assert.throws(() => validateProject(project), /unknown channel/);

  project = validProject();
  project.patterns[0].notes.push({ ...project.patterns[0].notes[0] });
  assert.throws(() => validateProject(project), /Duplicate note id/);
});

test('effects must use known types and complete finite parameter sets', () => {
  let project = validProject();
  project.mixerTracks[1].effects[0].type = 'unknown';
  assert.throws(() => validateProject(project), /unsupported value/);

  project = validProject();
  delete project.mixerTracks[1].effects[0].params.threshold;
  assert.throws(() => validateProject(project), /missing "threshold"/);

  project = validProject();
  project.mixerTracks[1].effects[0].params.threshold = Number.NaN;
  assert.throws(() => validateProject(project), /threshold/i);

  project = validProject();
  project.mixerTracks[1].effects[0].params.extra = 1;
  assert.throws(() => validateProject(project), /unsupported parameter/);
});

test('excessive collections are rejected with clear limits', () => {
  const project = validProject();
  project.patterns = Array.from({ length: PROJECT_LIMITS.patterns + 1 }, () => ({
    ...validProject().patterns[0],
  }));
  assert.throws(() => validateProject(project), /1–128|must contain/);
});

test('synth channels require every synth parameter', () => {
  const project = validProject();
  project.channels.push({
    id: 'ch-synth', name: 'Bass', kind: 'synth', color: '#FF3DBE', mixerTrackId: 'track-kick',
    synthParams: {
      osc1Waveform: 'triangle', osc1Octave: 0, osc1Level: 0.9,
      osc2Waveform: 'sine', osc2Octave: 1, osc2Detune: 3, osc2Level: 0.2,
      filterType: 'lowpass', filterCutoff: 4500, filterQ: 0.6, filterEnvAmount: 0.12,
      attack: 0.002, decay: 1.8, sustain: 0, release: 1.4, volume: 0.8,
    },
  });
  assert.equal(validateProject(project).channels[1].kind, 'synth');
  delete project.channels[1].synthParams.filterQ;
  assert.throws(() => validateProject(project), /filterQ/);
});
