import test from 'node:test';
import assert from 'node:assert/strict';
import { createMasterLimiter } from '../assets/js/master-limiter.js';

function fakeParam(value = 0) {
  return { value };
}

function fakeCompressor() {
  return {
    threshold: fakeParam(),
    knee: fakeParam(),
    ratio: fakeParam(),
    attack: fakeParam(),
    release: fakeParam()
  };
}

test('creates a hard-knee high-ratio limiter with 1 dB of headroom', () => {
  const compressor = fakeCompressor();
  let calls = 0;
  const context = {
    createDynamicsCompressor() {
      calls += 1;
      return compressor;
    }
  };

  const limiter = createMasterLimiter(context);

  assert.equal(calls, 1);
  assert.equal(limiter, compressor);
  assert.equal(limiter.threshold.value, -1);
  assert.equal(limiter.knee.value, 0);
  assert.equal(limiter.ratio.value, 20);
  assert.equal(limiter.attack.value, 0.003);
  assert.equal(limiter.release.value, 0.12);
});

test('rejects contexts without DynamicsCompressorNode support', () => {
  assert.throws(() => createMasterLimiter(null), TypeError);
  assert.throws(() => createMasterLimiter({}), TypeError);
});

test('rejects a malformed compressor instead of silently bypassing peak control', () => {
  assert.throws(() => createMasterLimiter({
    createDynamicsCompressor: () => ({ threshold: fakeParam() })
  }), /knee AudioParam/);
});
