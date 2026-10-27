// A strict fake AudioContext for the audio tests: it throws on the automation mistakes a real
// browser throws on (non-finite values, negative times, exponential ramps to or from zero,
// a source started twice or stopped before it starts, connecting to something that is not a
// node), and it records every node so a test can follow the graph and count what a piece of
// code created.
export function finite(v, what) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${what}: non-finite ${v}`);
}

export class FakeParam {
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
    if (t < 0) throw new RangeError('negative time');
    this.events.push(['lin', v, t]);
    return this;
  }
  exponentialRampToValueAtTime(v, t) {
    finite(v, 'expRamp value');
    finite(t, 'expRamp time');
    if (t < 0) throw new RangeError('negative time');
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
    if (t < 0) throw new RangeError('negative time');
    if (c < 0) throw new RangeError('negative time constant');
    this.events.push(['target', v, t, c]);
    return this;
  }
  cancelScheduledValues(t) {
    finite(t, 'cancelScheduledValues time');
    this.events = this.events.filter((e) => e[2] < t);
    return this;
  }
}

export class FakeNode {
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

export class FakeSource extends FakeNode {
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

export class FakeAudioContext {
  constructor({ state = 'running', sampleRate = 8000 } = {}) {
    this.nodes = [];
    this.sources = [];
    this.currentTime = 0;
    this.sampleRate = sampleRate;
    this.state = state;
    this.resumed = 0;
    this.destination = new FakeNode(this);
  }
  resume() {
    this.resumed++;
    this.state = 'running';
    return Promise.resolve();
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
    n.setPeriodicWave = (wave) => {
      if (!wave || !wave.isFakeWave) throw new TypeError('setPeriodicWave: not a PeriodicWave');
      n.wave = wave;
    };
    return n;
  }
  createPeriodicWave(real, imag) {
    if (!(real instanceof Float32Array) || !(imag instanceof Float32Array) || real.length !== imag.length || real.length < 2) throw new RangeError('bad PeriodicWave tables');
    return { isFakeWave: true, real, imag };
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

/** Can sound from `node` reach `target` by following connections? */
export function reaches(node, target, seen = new Set()) {
  if (node === target) return true;
  if (seen.has(node)) return false;
  seen.add(node);
  return node.outputs.some((o) => (o instanceof FakeNode ? reaches(o, target, seen) : false));
}
