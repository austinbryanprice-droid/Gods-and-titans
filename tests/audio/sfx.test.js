// WebAudio sound effects (src/audio/sfx.js), driven by a strict fake AudioContext
// that rejects the automation mistakes a real browser would throw on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sfx, SFX_NAMES, distanceGain } from '../../src/audio/sfx.js';

const DESIGN_NAMES = ['click', 'select', 'move', 'attack_melee', 'attack_ranged', 'hit', 'death', 'build', 'building_complete',
  'train', 'summon_god', 'summon_titan', 'lightning', 'fire', 'magic', 'heal', 'error', 'victory', 'defeat', 'tier_up',
  'chop', 'mine', 'pray', 'horn', 'ping', 'ping_urgent'];

function finite(v, what) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${what}: non-finite ${v}`);
}

class FakeParam {
  constructor(ctx, value = 0) {
    this.ctx = ctx;
    this.value = value;
    this.events = [];
  }
  setValueAtTime(v, t) {
    finite(v, 'setValueAtTime value');
    finite(t, 'setValueAtTime time');
    if (t < 0) throw new RangeError('negative time');
    this.events.push(['set', v, t]);
    return this;
  }
  linearRampToValueAtTime(v, t) {
    finite(v, 'linearRamp value');
    finite(t, 'linearRamp time');
    this.events.push(['lin', v, t]);
    return this;
  }
  exponentialRampToValueAtTime(v, t) {
    finite(v, 'expRamp value');
    finite(t, 'expRamp time');
    if (!(v > 0)) throw new RangeError(`exponential ramp to ${v}`);
    const prev = this.events[this.events.length - 1];
    if (prev && !(prev[1] > 0)) throw new RangeError('exponential ramp from a non-positive value');
    this.events.push(['exp', v, t]);
    return this;
  }
  setTargetAtTime(v, t, c) {
    finite(v, 'setTarget value');
    finite(t, 'setTarget time');
    finite(c, 'setTarget constant');
    this.events.push(['target', v, t]);
    return this;
  }
  cancelScheduledValues() {
    this.events = [];
    return this;
  }
}

class FakeNode {
  constructor(ctx) {
    this.ctx = ctx;
    this.outputs = [];
    ctx.nodes.push(this);
  }
  connect(dest) {
    if (!dest || !(dest instanceof FakeNode || dest instanceof FakeParam)) throw new TypeError('connect to a non-node');
    this.outputs.push(dest);
    return dest;
  }
  disconnect() {
    this.outputs = [];
  }
}

class FakeSource extends FakeNode {
  constructor(ctx) {
    super(ctx);
    this.started = null;
    this.stopped = null;
    ctx.sources.push(this);
  }
  start(t = 0) {
    finite(t, 'start');
    if (this.started !== null) throw new Error('started twice');
    this.started = t;
  }
  stop(t = 0) {
    finite(t, 'stop');
    if (this.started === null) throw new Error('stop before start');
    this.stopped = t;
  }
}

class FakeAudioContext {
  constructor() {
    this.nodes = [];
    this.sources = [];
    this.currentTime = 0;
    this.sampleRate = 8000;
    this.state = 'running';
    this.destination = new FakeNode(this);
  }
  createGain() {
    const n = new FakeNode(this);
    n.gain = new FakeParam(this, 1);
    return n;
  }
  createOscillator() {
    const n = new FakeSource(this);
    n.type = 'sine';
    n.frequency = new FakeParam(this, 440);
    n.detune = new FakeParam(this, 0);
    return n;
  }
  createBufferSource() {
    const n = new FakeSource(this);
    n.buffer = null;
    n.loop = false;
    n.playbackRate = new FakeParam(this, 1);
    return n;
  }
  createBiquadFilter() {
    const n = new FakeNode(this);
    n.type = 'lowpass';
    n.frequency = new FakeParam(this, 350);
    n.Q = new FakeParam(this, 1);
    n.gain = new FakeParam(this, 0);
    return n;
  }
  createDynamicsCompressor() {
    const n = new FakeNode(this);
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new FakeParam(this, 0);
    return n;
  }
  createConvolver() {
    const n = new FakeNode(this);
    n.buffer = null;
    return n;
  }
  createStereoPanner() {
    const n = new FakeNode(this);
    n.pan = new FakeParam(this, 0);
    return n;
  }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, getChannelData: (c) => data[c] };
  }
}

const ctx = new FakeAudioContext();
sfx.init({ context: ctx, volume: 0.7 });

test('every DESIGN 9 sound name exists', () => {
  assert.deepEqual([...SFX_NAMES].sort(), [...DESIGN_NAMES].sort());
});

test('every sound schedules valid nodes and stops every source', () => {
  for (const name of SFX_NAMES) {
    ctx.currentTime += 10; // far apart: no rate limiting
    const before = ctx.sources.length;
    assert.equal(sfx.play(name), true, name);
    const made = ctx.sources.slice(before);
    assert.ok(made.length > 0, `${name} made no sources`);
    for (const s of made) {
      assert.ok(s.started !== null && s.stopped !== null && s.stopped > s.started, `${name}: source not stopped after start`);
      assert.ok(s.stopped - ctx.currentTime < 8, `${name}: lasts too long`);
      if (s.frequency) {
        const f = s.frequency.events.length ? s.frequency.events : [['set', s.frequency.value, 0]];
        for (const [, v] of f) assert.ok(v > 0 && v < 4000 * 4, `${name}: frequency ${v}`);
      }
    }
  }
});

test('unknown names, zero volume and mute play nothing', () => {
  ctx.currentTime += 10;
  assert.equal(sfx.play('nope'), false);
  assert.equal(sfx.play('hit', { volume: 0 }), false);
  sfx.mute(true);
  assert.equal(sfx.play('hit'), false);
  sfx.mute(false);
  assert.equal(sfx.play('hit'), true);
});

test('rate limiting: a volley of 50 arrows plays a handful of sounds', () => {
  ctx.currentTime += 10;
  let played = 0;
  for (let i = 0; i < 50; i++) if (sfx.play('attack_ranged')) played++;
  assert.equal(played, 1, 'same instant');
  // spread over one second: limited by the min gap and the voice cap
  played = 0;
  for (let i = 0; i < 50; i++) {
    ctx.currentTime += 0.02;
    if (sfx.play('attack_ranged')) played++;
  }
  assert.ok(played >= 5 && played <= 22, `played ${played}`);
});

test('distance attenuation: full near the listener, silent beyond 30 tiles', () => {
  assert.equal(distanceGain(0), 1);
  assert.equal(distanceGain(8), 1);
  assert.ok(distanceGain(20) > 0 && distanceGain(20) < 1);
  assert.equal(distanceGain(30), 0);
  assert.equal(distanceGain(45), 0);
  sfx.setListener(50, 50);
  ctx.currentTime += 10;
  assert.equal(sfx.play('hit', { x: 90, y: 50 }), false);
  ctx.currentTime += 10;
  assert.equal(sfx.play('hit', { x: 55, y: 52 }), true);
  ctx.currentTime += 10;
  assert.equal(sfx.play('hit'), true, 'no position = not attenuated');
  sfx.setListener(NaN, 0);
  ctx.currentTime += 10;
  assert.equal(sfx.play('hit', { x: 1000, y: 1000 }), true, 'no listener = not attenuated');
});

test('the listener scale stretches the hearing range, so a zoomed-out view still hears its far side', () => {
  sfx.setListener(50, 50, 1);
  ctx.currentTime += 10;
  assert.equal(sfx.play('hit', { x: 85, y: 50 }), false, '35 tiles is silent at the default zoom');
  sfx.setListener(50, 50, 1.8);
  ctx.currentTime += 10;
  assert.equal(sfx.play('hit', { x: 85, y: 50 }), true, 'but heard with the camera pulled back');
  sfx.setListener(50, 50, NaN);
  assert.equal(sfx.listener.scale, 1, 'a bad scale is ignored');
  sfx.setListener(50, 50, -2);
  assert.equal(sfx.listener.scale, 1);
  sfx.setListener(NaN, 0);
});

test('the audio unlock stays armed for the life of the page: a context suspended or interrupted later is resumed by the next gesture', async () => {
  class SuspendedContext extends FakeAudioContext {
    constructor() {
      super();
      this.state = 'suspended';
      this.resumed = 0;
    }
    resume() {
      this.resumed++;
      this.state = 'running';
      return Promise.resolve();
    }
  }
  const handlers = new Map();
  const removed = [];
  const saved = { window: globalThis.window, AudioContext: globalThis.AudioContext };
  globalThis.window = { addEventListener: (type, fn) => handlers.set(type, fn), removeEventListener: (type) => removed.push(type) };
  globalThis.AudioContext = SuspendedContext;
  try {
    const s = (await import('../../src/audio/sfx.js?unlock')).sfx;
    s.init();
    const gesture = handlers.get('pointerdown');
    assert.equal(typeof gesture, 'function');
    gesture();
    assert.equal(s.ctx.resumed, 1);
    assert.equal(s.ready, true);
    gesture();
    assert.equal(s.ctx.resumed, 1, 'a running context is left alone');
    s.ctx.state = 'interrupted'; // Safari, after a call or an output change
    assert.equal(s.ready, false);
    gesture();
    assert.equal(s.ctx.resumed, 2);
    assert.equal(s.ready, true);
    assert.deepEqual(removed, [], 'no listener was taken down');
  } finally {
    globalThis.window = saved.window;
    globalThis.AudioContext = saved.AudioContext;
    if (saved.window === undefined) delete globalThis.window;
    if (saved.AudioContext === undefined) delete globalThis.AudioContext;
  }
});

test('volume and mute drive the master gain', () => {
  sfx.setVolume(0.5);
  assert.equal(sfx.volume, 0.5);
  sfx.setVolume(3);
  assert.equal(sfx.volume, 1);
  sfx.setVolume(NaN);
  assert.equal(sfx.volume, 1);
  sfx.mute(true);
  assert.equal(sfx.muted, true);
  sfx.mute(false);
  sfx.setVolume(0.7);
});

test('a fresh engine without WebAudio is a silent no-op (Node)', async () => {
  const mod = await import('../../src/audio/sfx.js?fresh');
  const s = mod.sfx;
  assert.doesNotThrow(() => s.init());
  assert.equal(s.play('click'), false);
  assert.doesNotThrow(() => s.setListener(1, 2));
  assert.doesNotThrow(() => s.setVolume(0.3));
  assert.doesNotThrow(() => s.mute(true));
  assert.doesNotThrow(() => s.unlock());
});
