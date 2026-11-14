/**
 * Song/microphone capture graph tests (recording phases 2 and 3).
 *
 * The fake context has no speaker destination at all, so any test that passed
 * by routing audio to the speakers would fail. Nodes record their connections
 * and disconnections the way Web Audio nodes do.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCaptureGraph,
  MASTER_CAPTURE_GAIN
} from '../music-studio-src/src/recording/captureGraph.ts';

function makeNode(kind) {
  const node = {
    kind,
    gain: { value: 1 },
    outputs: [],
    disconnects: 0,
    connect(target) {
      node.outputs.push(target);
      return target;
    },
    disconnect() {
      node.disconnects += 1;
      node.outputs = [];
    }
  };
  return node;
}

function makeMicStream() {
  const tracks = [
    { stopCalls: 0, stop() { this.stopCalls += 1; } }
  ];
  return {
    tracks,
    getTracks() { return tracks; },
    get stopCalls() { return tracks.reduce((sum, track) => sum + track.stopCalls, 0); }
  };
}

function makeContext() {
  const created = [];
  return {
    created,
    // No `destination` (speakers) property: routing there would throw.
    createGain() {
      const node = makeNode('gain');
      created.push(node);
      return node;
    },
    createMediaStreamDestination() {
      const node = makeNode('destination');
      node.stream = { audioOnly: true, getTracks: () => [] };
      created.push(node);
      return node;
    },
    createMediaStreamSource(stream) {
      const node = makeNode('source');
      node.stream = stream;
      created.push(node);
      return node;
    }
  };
}

function makeMaster() {
  return {
    connects: 0,
    disconnects: 0,
    outputs: [],
    connect(node) {
      this.connects += 1;
      this.outputs.push(node);
      return node;
    },
    disconnect(node) {
      this.disconnects += 1;
      this.outputs = this.outputs.filter((connected) => connected !== node);
    }
  };
}

test('song capture taps the master output through a headroom gain', () => {
  const context = makeContext();
  const master = makeMaster();
  const graph = createCaptureGraph({ context, mode: 'master', master });

  const masterGain = context.created.find((node) => node.kind === 'gain');
  const destination = context.created.find((node) => node.kind === 'destination');
  assert.ok(masterGain);
  assert.ok(destination);
  assert.equal(masterGain.gain.value, MASTER_CAPTURE_GAIN);
  assert.ok(MASTER_CAPTURE_GAIN < 1, 'song capture leaves headroom');

  assert.equal(master.connects, 1);
  assert.deepEqual(master.outputs, [masterGain]);
  assert.deepEqual(masterGain.outputs, [destination]);
  assert.equal(graph.stream, destination.stream);
  assert.equal(context.created.filter((node) => node.kind === 'source').length, 0, 'no microphone in song mode');
});

test('combined capture mixes the microphone into the same destination', () => {
  const context = makeContext();
  const master = makeMaster();
  const mic = makeMicStream();
  const graph = createCaptureGraph({ context, mode: 'combined', master, micStream: mic });

  const source = context.created.find((node) => node.kind === 'source');
  const micGain = context.created.filter((node) => node.kind === 'gain')[1];
  const destination = context.created.find((node) => node.kind === 'destination');

  assert.equal(source.stream, mic);
  assert.deepEqual(source.outputs, [micGain]);
  assert.deepEqual(micGain.outputs, [destination]);
  // Every output stays inside the capture graph: nothing reaches the speakers.
  for (const node of [source, micGain, ...context.created]) {
    for (const target of node.outputs ?? []) {
      assert.ok(context.created.includes(target), 'connection stays inside the capture graph');
    }
  }
  assert.equal(graph.stream, destination.stream);
});

test('release disconnects the master tap and the microphone, once', () => {
  const context = makeContext();
  const master = makeMaster();
  const graph = createCaptureGraph({ context, mode: 'combined', master, micStream: makeMicStream() });

  graph.release();
  assert.equal(master.disconnects, 1);
  assert.deepEqual(master.outputs, []);
  const source = context.created.find((node) => node.kind === 'source');
  assert.equal(source.disconnects, 1);
  for (const gain of context.created.filter((node) => node.kind === 'gain')) {
    assert.equal(gain.outputs.length, 0);
  }

  const before = { master: master.disconnects, source: source.disconnects };
  graph.release();
  assert.equal(master.disconnects, before.master, 'release is idempotent');
  assert.equal(source.disconnects, before.source, 'release is idempotent');
});

test('release does not stop microphone tracks; the recorder core owns them', () => {
  const mic = makeMicStream();
  const graph = createCaptureGraph({
    context: makeContext(),
    mode: 'combined',
    master: makeMaster(),
    micStream: mic
  });
  graph.release();
  assert.equal(mic.stopCalls, 0);
});

test('a missing master or microphone fails with a capture error, not a graph', () => {
  assert.throws(
    () => createCaptureGraph({ context: makeContext(), mode: 'master', master: null }),
    (error) => error.code === 'capture' && /song could not be captured/i.test(error.message)
  );
  assert.throws(
    () => createCaptureGraph({ context: makeContext(), mode: 'combined', master: makeMaster(), micStream: null }),
    (error) => error.code === 'capture' && /microphone stream is missing/i.test(error.message)
  );
});

test('a context without stream support fails clearly instead of throwing TypeError', () => {
  const context = { createGain: () => makeNode('gain'), created: [] };
  assert.throws(
    () => createCaptureGraph({ context, mode: 'master', master: makeMaster() }),
    (error) => error.code === 'capture' && /cannot capture the song/i.test(error.message)
  );
});
