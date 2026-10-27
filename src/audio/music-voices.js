// The instruments of the score, synthesized with WebAudio (no sample files): plucked strings,
// mallets, breath and bowed leads, pads, drums, bells and horns. Each is a recipe that takes the
// shared synth kit, a destination node, a start time and an event, builds its nodes and lets
// them stop themselves; every note ends in silence, so none can click or leak.
//   playVoice(kit, dest, t, ev) → end time (0 when the instrument is unknown)
// An event is { inst, midi | midis, dur (s), vel (0..1), pan?, bright?, tune? }.
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
  aulos: { oscs: [{ type: 'sawtooth', amp: 0.7 }, { type: 'square', amp: 0.3, detune: 4 }], bp: [2, 1.1, 0.7], lp: 6, breath: [0.03, 3], vib: [7, 5.2, 0.2], attack: 0.04, release: 0.16, level: 0.1164 },
  ney: { oscs: [{ type: 'triangle', amp: 0.8 }, { type: 'sine', mult: 2, amp: 0.2 }], lp: 7, breath: [0.1, 4], vib: [8, 5.0, 0.25], attack: 0.07, release: 0.2, level: 0.2138, scoop: 30 },
  shakuhachi: { oscs: [{ type: 'sine', amp: 1 }, { type: 'sine', mult: 2, amp: 0.2 }, { type: 'sine', mult: 3, amp: 0.08 }], lp: 8, breath: [0.2, 3], vib: [14, 5.0, 0.35], attack: 0.1, release: 0.3, level: 0.1436, scoop: 45 },
  dizi: { oscs: [{ type: 'triangle', amp: 0.7 }, { type: 'square', amp: 0.18, detune: 6 }], lp: 9, breath: [0.07, 5], vib: [9, 5.6, 0.2], attack: 0.04, release: 0.14, level: 0.2119, scoop: 20 },
  whistle: { oscs: [{ type: 'sine', amp: 1 }, { type: 'sine', mult: 3, amp: 0.12 }], lp: 8, breath: [0.05, 4], vib: [5, 5.4, 0.35], attack: 0.025, release: 0.1, level: 0.1469 },
  bansuri: { oscs: [{ type: 'sine', amp: 1 }, { type: 'triangle', mult: 2, amp: 0.2 }], lp: 7, breath: [0.13, 3], vib: [9, 4.6, 0.3], attack: 0.09, release: 0.24, level: 0.1469, scoop: 35 },
  clay: { oscs: [{ type: 'sine', amp: 1 }, { type: 'sine', mult: 2, amp: 0.05 }], lp: 6, breath: [0.07, 3], vib: [12, 6.8, 0.1], attack: 0.06, release: 0.18, level: 0.1469, scoop: 60 },
  conch: { oscs: [{ type: 'sawtooth', amp: 0.8 }, { type: 'sine', amp: 0.4 }], lp: 3, breath: [0.1, 2], vib: [14, 4.2, 0.4], attack: 0.22, release: 0.4, level: 0.135, scoop: 80 },
  erhu: { oscs: [{ type: 'sawtooth', amp: 0.8 }, { type: 'sawtooth', amp: 0.4, detune: 7 }], bp: [2.2, 1.6, 0.8], lp: 5, breath: [0.02, 3], vib: [16, 5.8, 0.25], attack: 0.1, release: 0.22, level: 0.12, scoop: 70 },
  fiddle: { oscs: [{ type: 'sawtooth', amp: 0.8 }, { type: 'sawtooth', amp: 0.5, detune: 8 }], lp: 4.5, breath: [0.015, 3], vib: [10, 5.5, 0.35], attack: 0.07, release: 0.18, level: 0.1968, scoop: 30 },
  nyckelharpa: { oscs: [{ type: 'sawtooth', amp: 0.7 }, { type: 'square', amp: 0.25, detune: 5 }], lp: 3.2, breath: [0.03, 2.5], vib: [8, 5.0, 0.4], attack: 0.12, release: 0.3, level: 0.2159 },
  shawm: { oscs: [{ type: 'sawtooth', amp: 0.8 }, { type: 'square', amp: 0.4, detune: 5 }], bp: [3, 1.6, 0.9], lp: 6, breath: [0.04, 3], vib: [18, 5.5, 0.15], attack: 0.03, release: 0.16, level: 0.1213, scoop: 40 },
  duduk: { oscs: [{ type: 'sawtooth', amp: 0.8 }, { type: 'triangle', mult: 0.5, amp: 0.5 }], bp: [2.4, 1.2, 0.8], lp: 4, breath: [0.04, 2], vib: [10, 4.8, 0.3], attack: 0.1, release: 0.28, level: 0.1219 },
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

function panTo(k, dest, pan) {
  if (!pan || !k.ctx.createStereoPanner) return dest;
  const p = k.ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(dest);
  return p;
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

/** A sine LFO that bends the pitch of the given oscillators (vibrato), fading in after `delay`. */
function vibrato(k, oscs, t, end, cents, rate, delay) {
  const ctx = k.ctx;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rate;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, t);
  depth.gain.linearRampToValueAtTime(cents, t + delay + 0.25);
  lfo.connect(depth);
  for (const o of oscs) depth.connect(o.detune);
  lfo.start(t);
  lfo.stop(end + 0.05);
}

// ------------------------------------------------------------------ recipes

function pluck(k, dest, t, ev, P, key) {
  const ctx = k.ctx;
  const f = midiToHz(ev.midi);
  const o = ctx.createOscillator();
  o.setPeriodicWave(wave(ctx, key, P.partials));
  if (P.bend) {
    o.frequency.setValueAtTime(f * Math.pow(2, P.bend / 12), t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
  } else o.frequency.setValueAtTime(f, t);
  const decay = P.decay * (ev.sustain ?? 1);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = P.q ?? 0.7;
  lp.frequency.setValueAtTime(Math.min(f * P.bright * (0.55 + 0.6 * ev.vel), 14000), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(f * P.floor, 160), t + decay * 0.45);
  const g = ctx.createGain();
  const end = k.env(g.gain, t, { a: P.attack, r: decay, peak: ev.vel * P.level });
  const out = panTo(k, dest, ev.pan);
  o.connect(lp);
  lp.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(end + 0.05);
  if (P.click) k.noise(out, t, { type: 'bandpass', f: Math.min(f * 4, 6000), q: 1.2, a: 0.001, r: 0.03, peak: ev.vel * P.click });
  return end;
}

function mallet(k, dest, t, ev, P) {
  const f = midiToHz(ev.midi);
  const out = panTo(k, dest, ev.pan);
  let end = t;
  const limit = Math.min(12000, k.ctx.sampleRate * 0.45);
  for (const [ratio, amp, decay] of P.partials) {
    if (f * ratio > limit) continue;
    end = Math.max(end, k.osc(out, t, { f: f * ratio, a: 0.002, r: P.decay * decay, peak: ev.vel * P.level * amp }));
  }
  if (P.click) k.noise(out, t, { type: 'bandpass', f: Math.min(f * 3, 5000), q: 1.5, a: 0.001, r: 0.025, peak: ev.vel * P.click });
  return end;
}

function sustained(k, dest, t, ev, P) {
  const ctx = k.ctx;
  const f = midiToHz(ev.midi);
  const dur = Math.max(0.12, ev.dur);
  const attack = Math.min(P.attack, dur * 0.6);
  const env = ctx.createGain();
  const end = k.env(env.gain, t, { a: attack, h: Math.max(0, dur - attack), r: P.release, peak: ev.vel * P.level });
  env.connect(panTo(k, dest, ev.pan));
  const lp = k.filter('lowpass', Math.min(f * P.lp, 9000), 0.7, env);
  let tone = lp;
  if (P.bp) {
    // A formant: the tone through a band, mixed back with the plain tone.
    const mix = ctx.createGain();
    const band = k.filter('bandpass', Math.min(f * P.bp[0], 5000), P.bp[1], null);
    const bandGain = ctx.createGain();
    bandGain.gain.value = P.bp[2] * 2.2;
    mix.connect(lp);
    mix.connect(band);
    band.connect(bandGain);
    bandGain.connect(lp);
    tone = mix;
  }
  const oscs = [];
  const fStart = P.scoop ? f * Math.pow(2, -P.scoop / 1200) : f;
  for (const d of P.oscs) {
    const o = ctx.createOscillator();
    o.type = d.type;
    o.frequency.setValueAtTime(fStart * (d.mult || 1), t);
    if (P.scoop) o.frequency.exponentialRampToValueAtTime(f * (d.mult || 1), t + 0.08);
    if (d.detune) o.detune.value = d.detune;
    if (d.amp !== undefined && d.amp !== 1) {
      const a = ctx.createGain();
      a.gain.value = d.amp;
      o.connect(a);
      a.connect(tone);
    } else o.connect(tone);
    o.start(t);
    o.stop(end + 0.05);
    oscs.push(o);
  }
  if (P.vib && ev.dur > 0.3) vibrato(k, oscs, t, end, P.vib[0], P.vib[1], P.vib[2]);
  if (P.breath) k.noise(env, t, { type: 'bandpass', f: Math.min(f * P.breath[1], 9000), q: 2, a: attack, h: Math.max(0, dur - attack), r: P.release, peak: P.breath[0] * 2 });
  return end;
}

function padChord(k, dest, t, ev, P) {
  const ctx = k.ctx;
  const dur = Math.max(0.4, ev.dur);
  const attack = Math.min(dur * P.attack, 3.2);
  const release = Math.min(dur * P.release, 4);
  const env = ctx.createGain();
  const end = k.env(env.gain, t, { a: attack, h: Math.max(0, dur - attack), r: release, peak: ev.vel * P.level });
  env.connect(panTo(k, dest, ev.pan));
  const cut = P.cut[0] + (P.cut[1] - P.cut[0]) * (ev.bright ?? 0.5);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.5;
  lp.frequency.setValueAtTime(cut * 0.65, t);
  lp.frequency.linearRampToValueAtTime(cut, t + attack);
  lp.frequency.linearRampToValueAtTime(cut * 0.8, t + dur + release * 0.5);
  lp.connect(env);
  let input = lp;
  if (P.formants) {
    // A vowel: the voices through three bands (the choir's "aah").
    const mix = ctx.createGain();
    for (const [ff, q, amp] of P.formants) {
      const bp = k.filter('bandpass', ff, q, null);
      const fg = ctx.createGain();
      fg.gain.value = amp * 4;
      mix.connect(bp);
      bp.connect(fg);
      fg.connect(lp);
    }
    input = mix;
  }
  const oscs = [];
  for (const midi of ev.midis) {
    const f = midiToHz(midi);
    for (const d of P.oscs) {
      const o = ctx.createOscillator();
      o.type = d.type;
      o.frequency.value = f * (d.mult || 1);
      if (d.detune) o.detune.value = d.detune;
      if (d.amp !== undefined && d.amp !== 1) {
        const a = ctx.createGain();
        a.gain.value = d.amp;
        o.connect(a);
        a.connect(input);
      } else o.connect(input);
      o.start(t);
      o.stop(end + 0.05);
      oscs.push(o);
    }
  }
  if (P.vib) vibrato(k, oscs, t, end, P.vib[0], P.vib[1], attack * 0.5);
  return end;
}

function drum(k, dest, t, ev, P) {
  const out = panTo(k, dest, ev.pan);
  const v = ev.vel;
  const tune = ev.tune || 1;
  let end = t + 0.05;
  if (P.f) {
    end = Math.max(end, k.osc(out, t, { f: P.f * tune, f2: P.f2 * tune, glide: P.glide, a: 0.002, r: P.r, peak: P.peak * v }));
    for (const [ratio, amp, decay] of P.partials || []) {
      if (amp > 0) end = Math.max(end, k.osc(out, t, { f: P.f * tune * ratio, a: 0.001, r: P.r * decay, peak: P.peak * amp * v }));
    }
  }
  const n = P.noise || P.noiseOnly;
  if (n) end = Math.max(end, k.noise(out, t, { type: n.type, f: n.f, q: n.q ?? 1, a: n.a ?? 0.001, r: n.r, peak: n.peak * v }));
  return end;
}

// ------------------------------------------------------------------ the instrument table

const KINDS = {};
for (const [name, P] of Object.entries(PLUCKS)) KINDS[name] = (k, dest, t, ev) => pluck(k, dest, t, ev, P, name);
for (const [name, P] of Object.entries(MALLETS)) KINDS[name] = (k, dest, t, ev) => mallet(k, dest, t, ev, P);
for (const [name, P] of Object.entries(LEADS)) KINDS[name] = (k, dest, t, ev) => sustained(k, dest, t, ev, P);
for (const [name, P] of Object.entries(PADS)) KINDS[name] = (k, dest, t, ev) => padChord(k, dest, t, ev, P);
for (const [name, P] of Object.entries(DRUMS)) KINDS[name] = (k, dest, t, ev) => drum(k, dest, t, ev, P);

// Brass and bells come from the sound-effect kit's own recipes.
KINDS.horn = (k, dest, t, ev) => k.brass(panTo(k, dest, ev.pan), t, midiToHz(ev.midi), { a: 0.18, h: Math.max(0, ev.dur - 0.18), r: 0.5, peak: 0.155 * ev.vel, bright: 1500, dark: 260, vib: 9 });
KINDS.brass = (k, dest, t, ev) => k.brass(panTo(k, dest, ev.pan), t, midiToHz(ev.midi), { a: 0.04, h: Math.max(0, ev.dur - 0.04), r: 0.3, peak: 0.14 * ev.vel, bright: 2800, dark: 500, vib: ev.dur > 0.5 ? 8 : 0 });
KINDS.bell = (k, dest, t, ev) => k.bell(panTo(k, dest, ev.pan), t, midiToHz(ev.midi), { peak: 0.11 * ev.vel, r: Math.max(0.8, ev.dur) });
KINDS.gong = (k, dest, t, ev) => k.bell(panTo(k, dest, ev.pan), t, midiToHz(ev.midi), { peak: 0.16 * ev.vel, r: Math.max(2.5, ev.dur) });

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
