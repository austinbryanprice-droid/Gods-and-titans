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
    this.base = value; // the value assigned to .value: what the parameter is at time 0, before any automation
    this.events = [];
    this.curves = []; // [start, end] of every value curve
    this.owner = null; // the node this is a parameter of
  }
  /** As in a browser, .value reads what the automation makes of the parameter now (the context's currentTime); assigning sets the value it starts from. */
  get value() {
    return this.valueAt(this.ctx.currentTime);
  }
  set value(v) {
    this.base = v;
  }
  /**
   * What the automation makes of the parameter at time t: steps, linear and exponential ramps, setTarget
   * approaches and value curves, in time order (a later event starts from where the earlier left off).
   */
  valueAt(t) {
    const events = this.events.map((e, i) => [e, i]).sort((a, b) => a[0][2] - b[0][2] || a[1] - b[1]).map(([e]) => e);
    let t0 = 0;
    let v0 = this.base;
    let approach = null; // an active setTarget: { v, c }
    const now = (at) => (approach ? approach.v + (v0 - approach.v) * Math.exp(-(at - t0) / approach.c) : v0);
    for (const e of events) {
      const [kind, v, te] = e;
      if (te > t) {
        if (kind === 'lin' || kind === 'exp') {
          const from = now(t0);
          const k = te > t0 ? (t - t0) / (te - t0) : 1;
          return kind === 'lin' ? from + (v - from) * k : from > 0 && v > 0 ? from * Math.pow(v / from, k) : from;
        }
        break;
      }
      if (kind === 'target') {
        v0 = now(te);
        t0 = te;
        approach = { v, c: Math.max(e[3], 1e-9) };
      } else if (kind === 'curve') {
        const [, , , duration, values] = e;
        if (t < te + duration) {
          const x = ((t - te) / duration) * (values.length - 1);
          const i = Math.min(values.length - 2, Math.floor(x));
          return values[i] + (values[i + 1] - values[i]) * (x - i);
        }
        v0 = values[values.length - 1];
        t0 = te + duration;
        approach = null;
      } else {
        v0 = v;
        t0 = te;
        approach = null;
      }
    }
    return now(t);
  }
  /** A browser refuses an event that lands inside a value curve, and a curve over other events. */
  _checkCurves(t) {
    for (const [a, b] of this.curves) if (t > a && t < b) throw new Error('NotSupportedError: automation event inside a value curve');
  }
  setValueAtTime(v, t) {
    finite(v, 'setValueAtTime value');
    finite(t, 'setValueAtTime time');
    if (t < 0) throw new RangeError('negative time');
    this._checkCurves(t);
    this.events.push(['set', v, t]);
    return this;
  }
  linearRampToValueAtTime(v, t) {
    finite(v, 'linearRamp value');
    finite(t, 'linearRamp time');
    if (t < 0) throw new RangeError('negative time');
    this._checkCurves(t);
    this.events.push(['lin', v, t]);
    return this;
  }
  exponentialRampToValueAtTime(v, t) {
    finite(v, 'expRamp value');
    finite(t, 'expRamp time');
    if (t < 0) throw new RangeError('negative time');
    if (!(v > 0)) throw new RangeError(`exponential ramp to ${v}`);
    this._checkCurves(t);
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
    this._checkCurves(t);
    this.events.push(['target', v, t, c]);
    return this;
  }
  setValueCurveAtTime(values, t, duration) {
    if (!values || !(values.length >= 2)) throw new RangeError('a value curve needs at least two values');
    for (const v of values) finite(v, 'setValueCurveAtTime value');
    finite(t, 'setValueCurveAtTime time');
    finite(duration, 'setValueCurveAtTime duration');
    if (t < 0) throw new RangeError('negative time');
    if (!(duration > 0)) throw new RangeError('a value curve needs a duration');
    for (const e of this.events) if (e[2] > t && e[2] < t + duration) throw new Error('NotSupportedError: value curve over other automation events');
    for (const [a, b] of this.curves) if (t < b && t + duration > a) throw new Error('NotSupportedError: overlapping value curves');
    this.curves.push([t, t + duration]);
    this.events.push(['curve', values[0], t, duration, values]);
    return this;
  }
  cancelScheduledValues(t) {
    finite(t, 'cancelScheduledValues time');
    this.events = this.events.filter((e) => e[2] < t);
    this.curves = this.curves.filter(([a]) => a < t);
    return this;
  }
}

export class FakeNode {
  constructor(ctx) {
    this.ctx = ctx;
    this.outputs = [];
    ctx.nodes.push(this);
  }
  /** A param of this node: remembers its owner. */
  param(value = 0) {
    const p = new FakeParam(this.ctx, value);
    p.owner = this;
    return p;
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
    n.gain = n.param(1);
    return n;
  }
  createOscillator() {
    const n = new FakeSource(this);
    n.type = 'sine';
    n.frequency = n.param(440);
    n.detune = n.param(0);
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
    n.playbackRate = n.param(1);
    return n;
  }
  createBiquadFilter() {
    const n = new FakeNode(this);
    n.type = 'lowpass';
    n.frequency = n.param(350);
    n.Q = n.param(1);
    n.gain = n.param(0);
    return n;
  }
  createDynamicsCompressor() {
    const n = new FakeNode(this);
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = n.param(0);
    return n;
  }
  createConvolver() {
    const n = new FakeNode(this);
    n.buffer = null;
    return n;
  }
  createStereoPanner() {
    const n = new FakeNode(this);
    n.pan = n.param(0);
    return n;
  }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, getChannelData: (c) => data[c] };
  }
}

/**
 * Can sound from `node` reach `target` by following connections? A connection into a parameter
 * (a vibrato's LFO) counts as reaching what the parameter's node reaches.
 */
export function reaches(node, target, seen = new Set()) {
  if (node === target) return true;
  if (seen.has(node)) return false;
  seen.add(node);
  return node.outputs.some((o) => (o instanceof FakeNode ? reaches(o, target, seen) : o.owner ? reaches(o.owner, target, seen) : false));
}
