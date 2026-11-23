/**
 * Runtime validation for imported project JSON.
 *
 * A syntactically valid JSON file can still break the mixer, piano roll or
 * scheduler. Validate every nested value and cross-reference here, before the
 * store replaces the current project. Errors are shown to the user verbatim.
 */
import type {
  Channel,
  DrumType,
  FilterType,
  FxInstance,
  FxType,
  MixerTrack,
  Note,
  Pattern,
  Project,
  StepData,
  SynthParams,
  Waveform,
} from '../types/project';

export const MAX_PROJECT_FILE_BYTES = 5 * 1024 * 1024;
export const PROJECT_LIMITS = Object.freeze({
  patterns: 128,
  channels: 64,
  mixerTracks: 64,
  effectsPerTrack: 32,
  songTracks: 64,
  clipsPerTrack: 1000,
  notesPerPattern: 20000,
  pathLength: 200,
});

const DRUM_TYPES: readonly DrumType[] = ['kick', 'snare', 'clap', 'closedHat', 'openHat', 'tom'];
const FX_TYPES: readonly FxType[] = [
  'reverb', 'feedbackDelay', 'pingPongDelay', 'eq3', 'filter', 'autoFilter',
  'compressor', 'chorus', 'phaser', 'distortion', 'bitCrusher', 'tremolo',
  'limiter', 'stereoWidener',
];
const WAVEFORMS: readonly Waveform[] = ['sine', 'square', 'sawtooth', 'triangle'];
const FILTER_TYPES: readonly FilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];
const BARS = [1, 2, 4, 8] as const;
const FX_PARAM_KEYS: Record<FxType, readonly string[]> = {
  reverb: ['decay', 'preDelay', 'wet'],
  feedbackDelay: ['delayTime', 'feedback', 'wet'],
  pingPongDelay: ['delayTime', 'feedback', 'wet'],
  eq3: ['low', 'mid', 'high', 'lowFrequency', 'highFrequency'],
  filter: ['type', 'frequency', 'q'],
  autoFilter: ['frequency', 'depth', 'baseFrequency', 'octaves', 'wet'],
  compressor: ['threshold', 'knee', 'ratio', 'attack', 'release'],
  chorus: ['frequency', 'delayTime', 'depth', 'wet'],
  phaser: ['frequency', 'octaves', 'wet'],
  distortion: ['distortion', 'wet'],
  bitCrusher: ['bits', 'wet'],
  tremolo: ['frequency', 'depth'],
  limiter: ['threshold'],
  stereoWidener: ['width'],
};

class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectValidationError';
  }
}

const fail = (message: string): never => {
  throw new ProjectValidationError(message);
};

const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
};

const array = (value: unknown, label: string, min: number, max: number): unknown[] => {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  const list = value as unknown[];
  if (list.length < min || list.length > max) fail(`${label} must contain ${min}–${max} items.`);
  return list;
};

const text = (value: unknown, label: string, max = 120): string => {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a non-empty string.`);
  const string = value as string;
  if (string.length > max) fail(`${label} is too long.`);
  if (/[\u0000-\u001f\u007f]/.test(string)) fail(`${label} contains control characters.`);
  return string;
};

const id = (value: unknown, label: string): string => text(value, label, PROJECT_LIMITS.pathLength);

const finite = (value: unknown, label: string, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${label} must be a number between ${min} and ${max}.`);
  }
  return value as number;
};

const integer = (value: unknown, label: string, min: number, max: number): number => {
  const number = finite(value, label, min, max);
  if (!Number.isInteger(number)) fail(`${label} must be a whole number.`);
  return number;
};

const boolean = (value: unknown, label: string): boolean => {
  if (typeof value !== 'boolean') fail(`${label} must be true or false.`);
  return value as boolean;
};

const oneOf = <T extends string>(value: unknown, label: string, allowed: readonly T[]): T => {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(`${label} has an unsupported value.`);
  return value as T;
};

function validateSynthParams(value: unknown, label: string): SynthParams {
  const p = object(value, label);
  return {
    osc1Waveform: oneOf(p.osc1Waveform, `${label}.osc1Waveform`, WAVEFORMS),
    osc1Octave: integer(p.osc1Octave, `${label}.osc1Octave`, -2, 2),
    osc1Level: finite(p.osc1Level, `${label}.osc1Level`, 0, 1),
    osc2Waveform: oneOf(p.osc2Waveform, `${label}.osc2Waveform`, WAVEFORMS),
    osc2Octave: integer(p.osc2Octave, `${label}.osc2Octave`, -2, 2),
    osc2Detune: finite(p.osc2Detune, `${label}.osc2Detune`, -100, 100),
    osc2Level: finite(p.osc2Level, `${label}.osc2Level`, 0, 1),
    filterType: oneOf(p.filterType, `${label}.filterType`, FILTER_TYPES),
    filterCutoff: finite(p.filterCutoff, `${label}.filterCutoff`, 20, 20000),
    filterQ: finite(p.filterQ, `${label}.filterQ`, 0, 30),
    filterEnvAmount: finite(p.filterEnvAmount, `${label}.filterEnvAmount`, 0, 1),
    attack: finite(p.attack, `${label}.attack`, 0, 30),
    decay: finite(p.decay, `${label}.decay`, 0, 30),
    sustain: finite(p.sustain, `${label}.sustain`, 0, 1),
    release: finite(p.release, `${label}.release`, 0, 30),
    volume: finite(p.volume, `${label}.volume`, 0, 1),
  };
}

function validateChannel(value: unknown, index: number): Channel {
  const c = object(value, `channels[${index}]`);
  const kind = oneOf(c.kind, `channels[${index}].kind`, ['drum', 'synth'] as const);
  const channel: Channel = {
    id: id(c.id, `channels[${index}].id`),
    name: text(c.name, `channels[${index}].name`),
    kind,
    color: typeof c.color === 'string' && /^#[0-9a-f]{6}$/i.test(c.color)
      ? c.color
      : fail(`channels[${index}].color must be a six-digit hex colour.`),
    mixerTrackId: id(c.mixerTrackId, `channels[${index}].mixerTrackId`),
  };
  if (kind === 'drum') {
    channel.drumType = oneOf(c.drumType, `channels[${index}].drumType`, DRUM_TYPES);
    if (c.drumParams !== undefined) {
      const d = object(c.drumParams, `channels[${index}].drumParams`);
      channel.drumParams = {
        tune: d.tune === undefined ? undefined : finite(d.tune, `channels[${index}].drumParams.tune`, -24, 24),
        decay: d.decay === undefined ? undefined : finite(d.decay, `channels[${index}].drumParams.decay`, 0.01, 10),
      };
    }
  } else {
    channel.synthParams = validateSynthParams(c.synthParams, `channels[${index}].synthParams`);
    if (c.sampleInstrument !== undefined) channel.sampleInstrument = text(c.sampleInstrument, `channels[${index}].sampleInstrument`, 200);
  }
  return channel;
}

function validateEffect(value: unknown, label: string): FxInstance {
  const fx = object(value, label);
  const type = oneOf(fx.type, `${label}.type`, FX_TYPES);
  const params = object(fx.params, `${label}.params`);
  const allowed = FX_PARAM_KEYS[type];
  for (const [key, raw] of Object.entries(params)) {
    if (!allowed.includes(key)) fail(`${label}.params has an unsupported parameter "${key}".`);
    finite(raw, `${label}.params.${key}`, -100000, 100000);
  }
  for (const key of allowed) {
    if (!(key in params)) fail(`${label}.params is missing "${key}".`);
  }
  return {
    id: id(fx.id, `${label}.id`),
    type,
    params: Object.fromEntries(allowed.map(key => [key, params[key]])) as Record<string, number>,
    bypass: boolean(fx.bypass, `${label}.bypass`),
  };
}

function validateTrack(value: unknown, index: number): MixerTrack {
  const t = object(value, `mixerTracks[${index}]`);
  const effects = array(t.effects, `mixerTracks[${index}].effects`, 0, PROJECT_LIMITS.effectsPerTrack)
    .map((effect, effectIndex) => validateEffect(effect, `mixerTracks[${index}].effects[${effectIndex}]`));
  return {
    id: id(t.id, `mixerTracks[${index}].id`),
    name: text(t.name, `mixerTracks[${index}].name`),
    volume: finite(t.volume, `mixerTracks[${index}].volume`, 0, 1),
    pan: finite(t.pan, `mixerTracks[${index}].pan`, -1, 1),
    mute: boolean(t.mute, `mixerTracks[${index}].mute`),
    solo: boolean(t.solo, `mixerTracks[${index}].solo`),
    effects,
  };
}

function validateNote(value: unknown, label: string, stepCount: number): Note {
  const n = object(value, label);
  return {
    id: id(n.id, `${label}.id`),
    channelId: id(n.channelId, `${label}.channelId`),
    pitch: integer(n.pitch, `${label}.pitch`, 0, 127),
    startStep: integer(n.startStep, `${label}.startStep`, 0, Math.max(0, stepCount - 1)),
    lengthSteps: integer(n.lengthSteps, `${label}.lengthSteps`, 1, stepCount),
    velocity: integer(n.velocity, `${label}.velocity`, 0, 127),
  };
}

function validatePattern(
  value: unknown,
  index: number,
  channelIds: Set<string>,
): Pattern {
  const p = object(value, `patterns[${index}]`);
  const bars = oneOfNumeric(p.bars, `patterns[${index}].bars`, BARS);
  const stepCount = bars * 16;
  const rawSteps = object(p.steps, `patterns[${index}].steps`);
  const steps: Record<string, StepData[]> = {};
  for (const [channelId, rawStepList] of Object.entries(rawSteps)) {
    if (!channelIds.has(channelId)) fail(`patterns[${index}].steps references unknown channel "${channelId}".`);
    const list = array(rawStepList, `patterns[${index}].steps.${channelId}`, stepCount, stepCount);
    steps[channelId] = list.map((raw, stepIndex) => {
      const step = object(raw, `patterns[${index}].steps.${channelId}[${stepIndex}]`);
      return {
        on: boolean(step.on, `patterns[${index}].steps.${channelId}[${stepIndex}].on`),
        velocity: integer(step.velocity, `patterns[${index}].steps.${channelId}[${stepIndex}].velocity`, 0, 127),
      };
    });
  }
  for (const channelId of channelIds) {
    if (!steps[channelId]) steps[channelId] = Array.from({ length: stepCount }, () => ({ on: false, velocity: 100 }));
  }
  const notes = array(p.notes, `patterns[${index}].notes`, 0, PROJECT_LIMITS.notesPerPattern)
    .map((note, noteIndex) => validateNote(note, `patterns[${index}].notes[${noteIndex}]`, stepCount));
  for (const [noteIndex, note] of notes.entries()) {
    if (!channelIds.has(note.channelId)) fail(`patterns[${index}].notes[${noteIndex}] references an unknown channel.`);
    if (note.startStep + note.lengthSteps > stepCount) fail(`patterns[${index}].notes[${noteIndex}] extends past the pattern.`);
  }
  return {
    id: id(p.id, `patterns[${index}].id`),
    name: text(p.name, `patterns[${index}].name`),
    bars,
    steps,
    notes,
  };
}

function oneOfNumeric<T extends number>(value: unknown, label: string, allowed: readonly T[]): T {
  if (typeof value !== 'number' || !allowed.includes(value as T)) fail(`${label} must be one of ${allowed.join(', ')}.`);
  return value as T;
}

export function validateProject(data: unknown): Project {
  const root = object(data, 'Project');
  const patternsRaw = array(root.patterns, 'patterns', 1, PROJECT_LIMITS.patterns);
  const channelsRaw = array(root.channels, 'channels', 1, PROJECT_LIMITS.channels);
  const tracksRaw = array(root.mixerTracks, 'mixerTracks', 1, PROJECT_LIMITS.mixerTracks);
  const song = object(root.song, 'song');
  const songTracksRaw = array(song.tracks, 'song.tracks', 1, PROJECT_LIMITS.songTracks);

  const channels = channelsRaw.map(validateChannel);
  const channelIds = new Set<string>();
  for (const channel of channels) {
    if (channelIds.has(channel.id)) fail(`Duplicate channel id "${channel.id}".`);
    channelIds.add(channel.id);
  }

  const tracks = tracksRaw.map(validateTrack);
  const trackIds = new Set<string>();
  for (const track of tracks) {
    if (trackIds.has(track.id)) fail(`Duplicate mixer track id "${track.id}".`);
    trackIds.add(track.id);
    for (const fxId of track.effects.map(effect => effect.id)) {
      if (track.effects.filter(effect => effect.id === fxId).length > 1) fail(`Duplicate effect id "${fxId}".`);
    }
  }
  if (!trackIds.has('track-master')) fail('The project is missing the Master mixer track.');
  for (const channel of channels) {
    if (!trackIds.has(channel.mixerTrackId)) fail(`Channel "${channel.id}" references a missing mixer track.`);
  }

  const patterns = patternsRaw.map((pattern, index) => validatePattern(pattern, index, channelIds));
  const patternIds = new Set<string>();
  for (const pattern of patterns) {
    if (patternIds.has(pattern.id)) fail(`Duplicate pattern id "${pattern.id}".`);
    patternIds.add(pattern.id);
  }

  const noteIds = new Set<string>();
  for (const pattern of patterns) {
    for (const note of pattern.notes) {
      if (noteIds.has(note.id)) fail(`Duplicate note id "${note.id}".`);
      noteIds.add(note.id);
    }
  }

  const songTracks = songTracksRaw.map((value, index) => {
    const track = object(value, `song.tracks[${index}]`);
    const clips = array(track.clips, `song.tracks[${index}].clips`, 0, PROJECT_LIMITS.clipsPerTrack)
      .map((clipValue, clipIndex) => {
        const clip = object(clipValue, `song.tracks[${index}].clips[${clipIndex}]`);
        const patternId = id(clip.patternId, `song.tracks[${index}].clips[${clipIndex}].patternId`);
        if (!patternIds.has(patternId)) fail(`song.tracks[${index}].clips[${clipIndex}] references a missing pattern.`);
        return {
          id: id(clip.id, `song.tracks[${index}].clips[${clipIndex}].id`),
          patternId,
          startBar: integer(clip.startBar, `song.tracks[${index}].clips[${clipIndex}].startBar`, 0, 100000),
        };
      });
    return { id: id(track.id, `song.tracks[${index}].id`), clips };
  });
  const songTrackIds = new Set<string>();
  for (const track of songTracks) {
    if (songTrackIds.has(track.id)) fail(`Duplicate song track id "${track.id}".`);
    songTrackIds.add(track.id);
  }

  const currentPatternId = id(root.currentPatternId, 'currentPatternId');
  if (!patternIds.has(currentPatternId)) fail('currentPatternId references a missing pattern.');

  return {
    bpm: integer(root.bpm, 'bpm', 60, 200),
    currentPatternId,
    patterns,
    channels,
    mixerTracks: tracks,
    song: { tracks: songTracks },
  };
}

export function projectValidationMessage(error: unknown): string {
  return error instanceof ProjectValidationError
    ? error.message
    : 'The project file is not valid.';
}
