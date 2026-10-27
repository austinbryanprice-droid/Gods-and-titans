// The instruments of the score, synthesized with WebAudio (no sample files): plucked strings,
// mallets, breath and bowed leads, pads, drums, bells and horns. Each is a recipe that takes the
// shared synth kit, a destination node, a start time and an event, builds its nodes and lets
// them stop themselves; every note ends in silence, so none can click or leak.
//   playVoice(kit, dest, t, ev) → end time (0 when the instrument is unknown)
// An event is { inst, midi | midis, dur (s), vel (0..1), bright?, tune? }; where it sits in the stereo
// field is the destination's business (music.js hands each voice a bus that is already panned).
//
// A score plays dozens of notes a second, and every live node costs the audio thread a little for as long
// as it lives, so the recipes are built to be cheap: as few nodes as will do, tails cut where nobody can
// hear them, vibrato drawn as a curve instead of an oscillator, sweeps evaluated once per render block.
import { midiToHz } from './music-theory.js';

/** Harmonic amplitudes 1/n^p for n = 1..count. */
const harmonics = (count, p, skip = 0) => Array.from({ length: count }, (_, i) => ((skip && (i + 1) % skip === 0) ? 0.35 : 1) / Math.pow(i + 1, p));

// ------------------------------------------------------------------ presets

/** Plucked strings: one oscillator with a rich wave through a lowpass that closes as the string rings down. */
const PLUCKS = {
  harp: { partials: harmonics(10, 1.15), bright: 6, floor: 1.5, decay: 2.6, attack: 0.004, level: 0.1384, click: 0.10 },
  lyre: { partials: harmonics(12, 0.85, 4), bright: 9, floor: 2.2, decay: 1.2, attack: 0.003, level: 0.2116, click: 0.20 },
  koto: { partials: harmonics(12, 0.95), bright: 10, floor: 2.0, decay: 1.6, attack: 0.002, level: 0.1907, click: 0.22, bend: 0.18 },
  guzheng: { partials: harmonics(12, 0.9), bright: 10, floor: 2.1, decay: 2.1, attack: 0.002, level: 0.17, click: 0.18, bend: 0.1 },
  kora: { partials: harmonics(10, 1.0), bright: 8, floor: 2.0, decay: 1.3, attack: 0.003, level: 0.2059, click: 0.16 },
  sitar: { partials: harmonics(18, 0.55), bright: 13, floor: 3.2, decay: 2.0, attack: 0.002, level: 0.2182, click: 0.2, q: 3.2, bend: 0.3 },
  tanpura: { partials: harmonics(22, 0.4), bright: 12, floor: 2.4, decay: 5.0, attack: 0.01, level: 0.1536, click: 0, q: 2.2 },
  oud: { partials: harmonics(7, 1.5), bright: 4.5, floor: 1.4, decay: 1.0, attack: 0.003, level: 0.3065, click: 0.1 },
  bassPluck: { partials: [1, 0.4, 0.14, 0.05], bright: 3.2, floor: 1.2, decay: 0.95, attack: 0.004, level: 0.3327, click: 0 },
};

/** Mallets (struck bars): a few inharmonic sine partials that fade at different speeds. */
const MALLETS = {
  marimba: { partials: [[1, 1, 1], [4, 0.28, 0.4], [10, 0.08, 0.2]], decay: 0.8, level: 0.2065, click: 0.1 },
};

/** Sustained single notes (winds, bowed strings, reeds): oscillators, a formant, breath noise and vibrato. */
const LEADS = {
  aulos: { oscs: [{ type: 'sawtooth', amp: 0.7 }, { type: 'square', amp: 0.3, detune: 4 }], bp: [2, 1.1, 0.7], lp: 6, breath: [0.03, 3], vib: [7, 5.2, 0.2], attack: 0.04, release: 0.16, level: 0.1336 },
  ney: { oscs: [{ type: 'triangle', amp: 0.8 }, { type: 'sine', mult: 2, amp: 0.2 }], lp: 7, breath: [0.1, 4], vib: [8, 5.0, 0.25], attack: 0.07, release: 0.2, level: 0.2138, scoop: 30 },
  shakuhachi: { oscs: [{ type: 'sine', amp: 1 }, { type: 'sine', mult: 2, amp: 0.2 }, { type: 'sine', mult: 3, amp: 0.08 }], lp: 8, breath: [0.2, 3], vib: [14, 5.0, 0.35], attack: 0.1, release: 0.3, level: 0.1436, scoop: 45 },
  dizi: { oscs: [{ type: 'triangle', amp: 0.7 }, { type: 'square', amp: 0.18, detune: 6 }], lp: 9, breath: [0.07, 5], vib: [9, 5.6, 0.2], attack: 0.04, release: 0.14, level: 0.2119, scoop: 20 },
  whistle: { oscs: [{ type: 'sine', amp: 1 }, { type: 'sine', mult: 3, amp: 0.12 }], lp: 8, breath: [0.05, 4], vib: [5, 5.4, 0.35], attack: 0.025, release: 0.1, level: 0.1469 },
  bansuri: { oscs: [{ type: 'sine', amp: 1 }, { type: 'triangle', mult: 2, amp: 0.2 }], lp: 7, breath: [0.13, 3], vib: [9, 4.6, 0.3], attack: 0.09, release: 0.24, level: 0.1469, scoop: 35 },
  clay: { oscs: [{ type: 'sine', amp: 1 }, { type: 'sine', mult: 2, amp: 0.05 }], lp: 6, breath: [0.07, 3], vib: [12, 6.8, 0.1], attack: 0.06, release: 0.18, level: 0.1469, scoop: 60 },
  conch: { oscs: [{ type: 'sawtooth', amp: 0.8 }, { type: 'sine', amp: 0.4 }], lp: 3, breath: [0.1, 2], vib: [14, 4.2, 0.4], attack: 0.22, release: 0.4, level: 0.135, scoop: 80 },
  erhu: { oscs: [{ type: 'sawtooth', amp: 0.8 }, { type: 'sawtooth', amp: 0.4, detune: 7 }], bp: [2.2, 1.6, 0.8], lp: 5, breath: [0.02, 3], vib: [16, 5.8, 0.25], attack: 0.1, release: 0.22, level: 0.1394, scoop: 70 },
  fiddle: { oscs: [{ type: 'sawtooth', amp: 0.8 }, { type: 'sawtooth', amp: 0.5, detune: 8 }], lp: 4.5, breath: [0.015, 3], vib: [10, 5.5, 0.35], attack: 0.07, release: 0.18, level: 0.1968, scoop: 30 },
  nyckelharpa: { oscs: [{ type: 'sawtooth', amp: 0.7 }, { type: 'square', amp: 0.25, detune: 5 }], lp: 3.2, breath: [0.03, 2.5], vib: [8, 5.0, 0.4], attack: 0.12, release: 0.3, level: 0.2159 },
  shawm: { oscs: [{ type: 'sawtooth', amp: 0.8 }, { type: 'square', amp: 0.4, detune: 5 }], bp: [3, 1.6, 0.9], lp: 6, breath: [0.04, 3], vib: [18, 5.5, 0.15], attack: 0.03, release: 0.16, level: 0.1345, scoop: 40 },
  duduk: { oscs: [{ type: 'sawtooth', amp: 0.8 }, { type: 'triangle', mult: 0.5, amp: 0.5 }], bp: [2.4, 1.2, 0.8], lp: 4, breath: [0.04, 2], vib: [10, 4.8, 0.3], attack: 0.1, release: 0.28, level: 0.14 },
  lur: { oscs: [{ type: 'sawtooth', amp: 0.9 }, { type: 'sawtooth', amp: 0.5, detune: -9 }], lp: 2.6, breath: [0.04, 2], vib: [8, 4.6, 0.4], attack: 0.2, release: 0.4, level: 0.14, scoop: 50 },
};

/** Pads: a chord's oscillators share one lowpass and one slow envelope. cut = [dark, bright] Hz. */
const PADS = {
  strings: { oscs: [{ type: 'sawtooth', detune: 7 }, { type: 'sawtooth', detune: -7 }], cut: [650, 2300], attack: 0.34, release: 0.5, level: 0.0379 },
  organ: { oscs: [{ type: 'sawtooth', detune: 4, amp: 0.6 }, { type: 'square', detune: -4, amp: 0.5 }], cut: [600, 1900], attack: 0.18, release: 0.4, level: 0.0446 },
  glass: { oscs: [{ type: 'sine' }, { type: 'triangle', mult: 2, amp: 0.35 }, { type: 'sine', mult: 3, amp: 0.12, detune: 5 }], cut: [1500, 4200], attack: 0.4, release: 0.55, level: 0.0345 },
  choir: { oscs: [{ type: 'sawtooth', detune: 8 }, { type: 'sawtooth', detune: -8 }], formants: [[800, 6, 1], [1150, 7, 0.55], [2900, 9, 0.18]], cut: [1800, 4200], attack: 0.4, release: 0.55, level: 0.0366, vib: [10, 4.7] },
  drone: { oscs: [{ type: 'sawtooth', detune: 5 }, { type: 'sawtooth', detune: -5 }, { type: 'sine', mult: 0.5, amp: 0.8 }], cut: [220, 520], attack: 0.3, release: 0.4, level: 0.0367 },
};

/** Drums: a body tone that falls in pitch plus a burst of noise. */
const DRUMS = {
  frame: { f: 175, f2: 108, glide: 0.06, r: 0.32, peak: 0.5, noise: { type: 'lowpass', f: 1500, r: 0.05, peak: 0.22 } },
  bodhran: { f: 128, f2: 80, glide: 0.07, r: 0.45, peak: 0.5472, noise: { type: 'lowpass', f: 950, r: 0.07, peak: 0.2371 } },
  taiko: { f: 108, f2: 50, glide: 0.09, r: 0.9, peak: 0.4671, noise: { type: 'lowpass', f: 520, r: 0.1, peak: 0.1978 }, partials: [[2.1, 0.16, 0.4]] },
  tom: { f: 165, f2: 92, glide: 0.07, r: 0.4, peak: 0.55, noise: { type: 'lowpass', f: 1100, r: 0.05, peak: 0.2 } },
  huehuetl: { f: 90, f2: 62, glide: 0.05, r: 0.7, peak: 0.5396, noise: { type: 'bandpass', f: 700, q: 0.8, r: 0.06, peak: 0.1937 } },
  slit: { f: 330, f2: 318, glide: 0.02, r: 0.24, peak: 0.32, partials: [[2.76, 0.25, 0.5], [5.4, 0.1, 0.3]] },
  dayan: { f: 430, f2: 405, glide: 0.03, r: 0.3, peak: 0.3, partials: [[2, 0.3, 0.6], [3, 0.15, 0.4]], noise: { type: 'highpass', f: 3000, r: 0.015, peak: 0.1 } },
  bayan: { f: 118, f2: 150, glide: 0.1, r: 0.42, peak: 0.55, noise: { type: 'lowpass', f: 600, r: 0.04, peak: 0.14 } },
  djembeBass: { f: 118, f2: 72, glide: 0.08, r: 0.52, peak: 0.5217, noise: { type: 'lowpass', f: 700, r: 0.05, peak: 0.1346 } },
  djembeTone: { f: 255, f2: 225, glide: 0.04, r: 0.22, peak: 0.38, noise: { type: 'bandpass', f: 1500, q: 1, r: 0.05, peak: 0.2 } },
  djembeSlap: { f: 430, f2: 380, glide: 0.02, r: 0.1, peak: 0.2, noise: { type: 'bandpass', f: 2600, q: 1, r: 0.08, peak: 0.45 } },
  clave: { f: 1150, f2: 1050, glide: 0.01, r: 0.05, peak: 0.26, noise: { type: 'bandpass', f: 3200, q: 2, r: 0.025, peak: 0.1 } },
  woodblock: { f: 820, f2: 780, glide: 0.01, r: 0.07, peak: 0.28, partials: [[2.3, 0.25, 0.5]] },
  shaker: { noiseOnly: { type: 'highpass', f: 6500, a: 0.012, r: 0.055, peak: 0.2 } },
  sistrum: { noiseOnly: { type: 'bandpass', f: 7200, q: 1.4, a: 0.004, r: 0.14, peak: 0.22 } },
  cymbal: { noiseOnly: { type: 'highpass', f: 5200, a: 0.003, r: 1.5, peak: 0.1505 } },
};

// ------------------------------------------------------------------ helpers

const MIN_GAIN = 0.0001;
const FALL_DB = 45; // a note's exponential fall is cut this far below its peak (the rest is inaudible)
const CURVE_RATE = 64; // points per second in a vibrato curve
const BREATH_MIN = 0.05; // breath noise quieter than this is not worth three nodes

// Loudest oscillator layer of a lead or a pad: its amplitude is folded into the envelope, so it needs no gain node.
for (const set of [LEADS, PADS]) {
  for (const P of Object.values(set)) {
    P.topAmp = Math.max(...P.oscs.map((d) => d.amp ?? 1));
    // A formant that sums the tone with a band of it, gain 1 + bp[2] * 2.2 at the peak, is a peaking filter of that many dB.
    if (P.bp) P.formantDb = 20 * Math.log10(1 + P.bp[2] * 2.2);
  }
}

/**
 * Have the browser evaluate swept or modulated parameters once per render block (about 3 ms) rather than
 * once per sample. For a filter sweep, a pitch scoop or a vibrato nobody can hear the difference, and
 * it is the difference between a filter costing its own price and costing five times that. A browser
 * that cannot do it carries on at audio rate.
 */
function slow(...params) {
  for (const p of params) {
    try {
      p.automationRate = 'k-rate';
    } catch {
      // stays a-rate
    }
  }
}

const waveCache = new WeakMap();

/** A PeriodicWave for a partial list, made once per AudioContext. */
function wave(ctx, key, partials) {
  let m = waveCache.get(ctx);
  if (!m) waveCache.set(ctx, (m = new Map()));
  let w = m.get(key);
  if (!w) {
    const real = new Float32Array(partials.length + 1);
    const imag = new Float32Array(partials.length + 1);
    partials.forEach((a, i) => {
      imag[i + 1] = a;
    });
    w = ctx.createPeriodicWave(real, imag);
    m.set(key, w);
  }
  return w;
}

/**
 * Attack, hold, then an exponential fall that is cut off FALL_DB below the peak and finished with a short
 * linear fade to silence. The quietest part of a long tail cannot be heard, but a node that rings through
 * it is alive (and paid for) all the same.
 * @returns {number} the time the sound has ended
 */
function envelope(param, t, { a = 0.005, h = 0, r = 0.2, peak = 1 }) {
  const full = 20 * Math.log10(Math.max(peak, MIN_GAIN * 4) / MIN_GAIN);
  const fall = r * Math.min(1, FALL_DB / full);
  const floor = Math.max(MIN_GAIN, peak * Math.pow(10, -FALL_DB / 20));
  param.setValueAtTime(MIN_GAIN, t);
  if (a > 0) param.linearRampToValueAtTime(peak, t + a);
  else param.setValueAtTime(peak, t);
  if (h > 0) param.setValueAtTime(peak, t + a + h);
  param.exponentialRampToValueAtTime(floor, t + a + h + fall);
  param.linearRampToValueAtTime(0, t + a + h + fall + 0.03);
  return t + a + h + fall + 0.03;
}

const vibratoCurves = new Map();

/**
 * Detune values (cents) for a vibrato that swells in after `delay` seconds: `offset` plus a sine of depth
 * `cents`. One long curve is kept per setting and a note takes the start of it.
 */
function vibratoCurve(offset, cents, rate, delay, seconds) {
  const key = `${offset}|${cents}|${rate}|${delay}`;
  const need = Math.ceil(seconds * CURVE_RATE) + 2;
  let c = vibratoCurves.get(key);
  if (!c || c.length < need) {
    if (vibratoCurves.size > 96) vibratoCurves.clear();
    c = new Float32Array(Math.max(need, CURVE_RATE * 6));
    const swell = delay + 0.25;
    for (let i = 0; i < c.length; i++) {
      const x = i / CURVE_RATE;
      c[i] = offset + cents * Math.min(1, x / swell) * Math.sin(2 * Math.PI * rate * x);
    }
    vibratoCurves.set(key, c);
  }
  return c.subarray(0, need);
}

/** Bend an oscillator's pitch in a vibrato for `seconds` from `t`, with no oscillator of its own to pay for. */
function vibrate(o, offset, cents, rate, delay, t, seconds) {
  const curve = vibratoCurve(offset, cents, rate, delay, seconds);
  slow(o.detune);
  o.detune.setValueCurveAtTime(curve, t, (curve.length - 1) / CURVE_RATE);
}

/** One oscillator through its own envelope (a bell partial, a drum body). Returns the end time. */
function tone(k, dest, t, { type = 'sine', f, f2, glide, ...e }) {
  const o = k.ctx.createOscillator();
  o.type = type;
  if (f2) {
    slow(o.frequency);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f2, t + (glide ?? (e.a || 0) + (e.h || 0) + (e.r || 0.2)));
  } else o.frequency.value = f;
  const g = k.ctx.createGain();
  const end = envelope(g.gain, t, e);
  o.connect(g);
  g.connect(dest);
  o.start(t);
  o.stop(end + 0.05);
  return end;
}

/** A burst of filtered noise through its own envelope. Returns the end time. */
function burst(k, dest, t, { type = 'bandpass', f, q = 1, ...e }) {
  const src = k.ctx.createBufferSource();
  src.buffer = k.noiseBuf;
  src.loop = true;
  const fl = k.ctx.createBiquadFilter();
  fl.type = type;
  fl.frequency.value = f;
  fl.Q.value = q;
  const g = k.ctx.createGain();
  const end = envelope(g.gain, t, e);
  src.connect(fl);
  fl.connect(g);
  g.connect(dest);
  src.start(t, Math.random() * 1.5);
  src.stop(end + 0.05);
  return end;
}

// ------------------------------------------------------------------ recipes

function pluck(k, dest, t, ev, P, key) {
  const ctx = k.ctx;
  const f = midiToHz(ev.midi);
  const o = ctx.createOscillator();
  o.setPeriodicWave(wave(ctx, key, P.partials));
  if (P.bend) {
    slow(o.frequency);
    o.frequency.setValueAtTime(f * Math.pow(2, P.bend / 12), t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
  } else o.frequency.value = f;
  const decay = P.decay * (ev.sustain ?? 1);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = P.q ?? 0.7;
  slow(lp.frequency);
  lp.frequency.setValueAtTime(Math.min(f * P.bright * (0.55 + 0.6 * ev.vel), 14000), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(f * P.floor, 160), t + decay * 0.45);
  const g = ctx.createGain();
  const end = envelope(g.gain, t, { a: P.attack, r: decay, peak: ev.vel * P.level });
  o.connect(lp);
  lp.connect(g);
  g.connect(dest);
  o.start(t);
  o.stop(end + 0.05);
  if (P.click) burst(k, dest, t, { type: 'bandpass', f: Math.min(f * 4, 6000), q: 1.2, a: 0.001, r: 0.03, peak: ev.vel * P.click });
  return end;
}

function mallet(k, dest, t, ev, P) {
  const f = midiToHz(ev.midi);
  let end = t;
  const limit = Math.min(12000, k.ctx.sampleRate * 0.45);
  for (const [ratio, amp, decay] of P.partials) {
    if (f * ratio > limit) continue;
    end = Math.max(end, tone(k, dest, t, { f: f * ratio, a: 0.002, r: P.decay * decay, peak: ev.vel * P.level * amp }));
  }
  if (P.click) burst(k, dest, t, { type: 'bandpass', f: Math.min(f * 3, 5000), q: 1.5, a: 0.001, r: 0.025, peak: ev.vel * P.click });
  return end;
}

function sustained(k, dest, t, ev, P) {
  const ctx = k.ctx;
  const f = midiToHz(ev.midi);
  const dur = Math.max(0.12, ev.dur);
  const attack = Math.min(P.attack, dur * 0.6);
  const hold = Math.max(0, dur - attack);
  const env = ctx.createGain();
  const end = envelope(env.gain, t, { a: attack, h: hold, r: P.release, peak: ev.vel * P.level * P.topAmp });
  env.connect(dest);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(f * P.lp, 9000);
  lp.Q.value = 0.7;
  lp.connect(env);
  let input = lp;
  if (P.bp) {
    // A formant that follows the pitch: a peak in front of the lowpass.
    const peak = ctx.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = Math.min(f * P.bp[0], 5000);
    peak.Q.value = P.bp[1];
    peak.gain.value = P.formantDb;
    peak.connect(lp);
    input = peak;
  }
  const vibrato = P.vib && ev.dur > 0.3;
  const span = end - t + 0.05;
  const fStart = P.scoop ? f * Math.pow(2, -P.scoop / 1200) : f;
  for (const d of P.oscs) {
    const o = ctx.createOscillator();
    o.type = d.type;
    const mult = d.mult || 1;
    if (P.scoop) {
      slow(o.frequency);
      o.frequency.setValueAtTime(fStart * mult, t);
      o.frequency.exponentialRampToValueAtTime(f * mult, t + 0.08);
    } else o.frequency.value = f * mult;
    if (vibrato) vibrate(o, d.detune ?? 0, P.vib[0], P.vib[1], P.vib[2], t, span);
    else if (d.detune) o.detune.value = d.detune;
    const rel = (d.amp ?? 1) / P.topAmp;
    if (rel === 1) o.connect(input);
    else {
      const a = ctx.createGain();
      a.gain.value = rel;
      o.connect(a);
      a.connect(input);
    }
    o.start(t);
    o.stop(end + 0.05);
  }
  if (P.breath && P.breath[0] >= BREATH_MIN) {
    burst(k, env, t, { type: 'bandpass', f: Math.min(f * P.breath[1], 9000), q: 2, a: attack, h: hold, r: P.release, peak: (P.breath[0] * 2) / P.topAmp });
  }
  return end;
}

function padChord(k, dest, t, ev, P) {
  const ctx = k.ctx;
  const dur = Math.max(0.4, ev.dur);
  const attack = Math.min(dur * P.attack, 3.2);
  const release = Math.min(dur * P.release, 4);
  const env = ctx.createGain();
  const end = envelope(env.gain, t, { a: attack, h: Math.max(0, dur - attack), r: release, peak: ev.vel * P.level * P.topAmp });
  env.connect(dest);
  const cut = P.cut[0] + (P.cut[1] - P.cut[0]) * (ev.bright ?? 0.5);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.5;
  slow(lp.frequency);
  lp.frequency.setValueAtTime(cut * 0.65, t);
  lp.frequency.linearRampToValueAtTime(cut, t + attack);
  lp.frequency.linearRampToValueAtTime(cut * 0.8, t + dur + release * 0.5);
  lp.connect(env);
  let input = lp;
  if (P.formants) {
    // A vowel: the voices through three bands (the choir's "aah").
    const mix = ctx.createGain();
    for (const [ff, q, amp] of P.formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = ff;
      bp.Q.value = q;
      const fg = ctx.createGain();
      fg.gain.value = amp * 4;
      mix.connect(bp);
      bp.connect(fg);
      fg.connect(lp);
    }
    input = mix;
  }
  // One gain per quieter oscillator layer, shared by every note of the chord.
  const feeds = P.oscs.map((d) => {
    const rel = (d.amp ?? 1) / P.topAmp;
    if (rel === 1) return input;
    const g = ctx.createGain();
    g.gain.value = rel;
    g.connect(input);
    return g;
  });
  const span = end - t + 0.05;
  const swell = Math.round(attack * 10) / 20; // half the attack, to the nearest 0.05 s (so curves are shared)
  for (const midi of ev.midis) {
    const f = midiToHz(midi);
    P.oscs.forEach((d, i) => {
      const o = ctx.createOscillator();
      o.type = d.type;
      o.frequency.value = f * (d.mult || 1);
      if (P.vib) vibrate(o, d.detune ?? 0, P.vib[0], P.vib[1], swell, t, span);
      else if (d.detune) o.detune.value = d.detune;
      o.connect(feeds[i]);
      o.start(t);
      o.stop(end + 0.05);
    });
  }
  return end;
}

function drum(k, dest, t, ev, P) {
  const v = ev.vel;
  const tune = ev.tune || 1;
  let end = t + 0.05;
  if (P.f) {
    end = Math.max(end, tone(k, dest, t, { f: P.f * tune, f2: P.f2 * tune, glide: P.glide, a: 0.002, r: P.r, peak: P.peak * v }));
    for (const [ratio, amp, decay] of P.partials || []) {
      if (amp > 0) end = Math.max(end, tone(k, dest, t, { f: P.f * tune * ratio, a: 0.001, r: P.r * decay, peak: P.peak * amp * v }));
    }
  }
  const n = P.noise || P.noiseOnly;
  if (n) end = Math.max(end, burst(k, dest, t, { type: n.type, f: n.f, q: n.q ?? 1, a: n.a ?? 0.001, r: n.r, peak: n.peak * v }));
  return end;
}

/**
 * Brass: two detuned sawtooth oscillators through a lowpass whose cutoff swells as the note opens, one envelope
 * after the filter and a vibrato curve on the first oscillator.
 */
function horn(k, dest, t, ev, B) {
  const ctx = k.ctx;
  const f = midiToHz(ev.midi);
  const hold = Math.max(0, ev.dur - B.a);
  const env = ctx.createGain();
  const end = envelope(env.gain, t, { a: B.a, h: hold, r: B.r, peak: B.level * ev.vel });
  env.connect(dest);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 1.5;
  slow(lp.frequency);
  lp.frequency.setValueAtTime(B.dark, t);
  lp.frequency.exponentialRampToValueAtTime(B.bright, t + B.a + Math.min(hold, 0.15) + 0.02);
  lp.frequency.exponentialRampToValueAtTime(B.dark * 1.2, t + B.a + hold + B.r);
  lp.connect(env);
  const main = ctx.createOscillator();
  main.type = 'sawtooth';
  main.frequency.value = f;
  if (ev.dur > 0.5) vibrate(main, 0, B.vib, 5, 0.3, t, end - t + 0.05);
  main.connect(lp);
  main.start(t);
  main.stop(end + 0.05);
  const side = ctx.createOscillator();
  side.type = 'sawtooth';
  side.frequency.value = f * 1.003;
  side.detune.value = 7;
  const sideGain = ctx.createGain();
  sideGain.gain.value = 0.6;
  side.connect(sideGain);
  sideGain.connect(lp);
  side.start(t);
  side.stop(end + 0.05);
  return end;
}

const BRASS = {
  horn: { a: 0.18, r: 0.5, level: 0.155, bright: 1500, dark: 260, vib: 9 },
  brass: { a: 0.04, r: 0.3, level: 0.14, bright: 2800, dark: 500, vib: 8 },
};

/** A struck bell: inharmonic sine partials, the higher ones dying faster. */
function bell(k, dest, t, f, { peak, r }) {
  const partials = [[1, 1, 1], [2.76, 0.45, 0.6], [5.4, 0.22, 0.35], [8.93, 0.1, 0.22]];
  const limit = Math.min(12000, k.ctx.sampleRate * 0.45);
  let end = t;
  for (const [ratio, amp, decay] of partials) {
    if (f * ratio > limit) continue;
    end = Math.max(end, tone(k, dest, t, { f: f * ratio, a: 0.002, r: r * decay, peak: peak * amp }));
  }
  return end;
}

// ------------------------------------------------------------------ the instrument table

const KINDS = {};
for (const [name, P] of Object.entries(PLUCKS)) KINDS[name] = (k, dest, t, ev) => pluck(k, dest, t, ev, P, name);
for (const [name, P] of Object.entries(MALLETS)) KINDS[name] = (k, dest, t, ev) => mallet(k, dest, t, ev, P);
for (const [name, P] of Object.entries(LEADS)) KINDS[name] = (k, dest, t, ev) => sustained(k, dest, t, ev, P);
for (const [name, P] of Object.entries(PADS)) KINDS[name] = (k, dest, t, ev) => padChord(k, dest, t, ev, P);
for (const [name, P] of Object.entries(DRUMS)) KINDS[name] = (k, dest, t, ev) => drum(k, dest, t, ev, P);
for (const [name, B] of Object.entries(BRASS)) KINDS[name] = (k, dest, t, ev) => horn(k, dest, t, ev, B);
KINDS.bell = (k, dest, t, ev) => bell(k, dest, t, midiToHz(ev.midi), { peak: 0.11 * ev.vel, r: Math.max(0.8, ev.dur) });
KINDS.gong = (k, dest, t, ev) => bell(k, dest, t, midiToHz(ev.midi), { peak: 0.16 * ev.vel, r: Math.max(2.5, ev.dur) });

/** Every instrument name a theme may use. */
export const INSTRUMENTS = Object.freeze(Object.keys(KINDS));

/**
 * Play one event.
 * @returns {number} the time the sound ends, or 0 for an unknown instrument
 */
export function playVoice(k, dest, t, ev) {
  const make = KINDS[ev.inst];
  return make ? make(k, dest, t, ev) : 0;
}
