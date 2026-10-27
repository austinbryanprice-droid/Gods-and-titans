// Sound effects synthesized with WebAudio (no audio files). DESIGN 9.
//   sfx.init()                       arm the AudioContext unlock on the first user gesture
//   sfx.play(name, { x, y, volume }) positional when x, y are given (tile coords)
//   sfx.setListener(x, y, scale)     usually the camera target; scale > 1 widens the hearing range (zoomed out)
//   sfx.setVolume(v) / sfx.mute(bool)
// Every call is a safe no-op where WebAudio is missing (Node, old browsers).

export const SFX_NAMES = [
  'click', 'select', 'move', 'attack_melee', 'attack_ranged', 'hit', 'death', 'build',
  'building_complete', 'train', 'summon_god', 'summon_titan', 'lightning', 'fire', 'magic',
  'heal', 'error', 'victory', 'defeat', 'tier_up', 'chop', 'mine', 'pray', 'horn', 'ping', 'ping_urgent',
];

const HEAR_FULL = 8; // tiles: full volume within this distance of the listener
const HEAR_MAX = 30; // tiles: silent beyond this
const MAX_VOICES = 40; // global cap on overlapping sounds
const MIN_GAIN = 0.0001; // exponential ramps cannot reach 0

// Per-name rate limits: `gap` = min seconds between starts, `voices` = max overlapping.
// `ui` sounds bypass the global voice cap.
const LIMITS = {
  click: { gap: 0.03, voices: 3, ui: true },
  select: { gap: 0.06, voices: 2, ui: true },
  move: { gap: 0.08, voices: 2, ui: true },
  error: { gap: 0.25, voices: 1, ui: true },
  attack_melee: { gap: 0.05, voices: 5 },
  attack_ranged: { gap: 0.045, voices: 5 },
  hit: { gap: 0.04, voices: 6 },
  death: { gap: 0.09, voices: 4 },
  build: { gap: 0.12, voices: 3 },
  building_complete: { gap: 0.4, voices: 2, ui: true },
  train: { gap: 0.25, voices: 2, ui: true },
  summon_god: { gap: 1.0, voices: 2, ui: true },
  summon_titan: { gap: 2.0, voices: 1, ui: true },
  lightning: { gap: 0.12, voices: 3 },
  fire: { gap: 0.1, voices: 3 },
  magic: { gap: 0.08, voices: 4 },
  heal: { gap: 0.15, voices: 3 },
  victory: { gap: 3, voices: 1, ui: true },
  defeat: { gap: 3, voices: 1, ui: true },
  tier_up: { gap: 1.0, voices: 1, ui: true },
  chop: { gap: 0.07, voices: 3 },
  mine: { gap: 0.07, voices: 3 },
  pray: { gap: 0.6, voices: 2 },
  horn: { gap: 4, voices: 1, ui: true },
  ping: { gap: 0.25, voices: 2, ui: true },
  ping_urgent: { gap: 0.6, voices: 1, ui: true },
};
const DEFAULT_LIMIT = { gap: 0.05, voices: 4 };

// Overall loudness per sound, balanced by measuring rendered peaks.
const LEVEL = {
  click: 1.3, select: 1.0, move: 1.15, attack_melee: 0.45, attack_ranged: 1.1, hit: 0.85,
  death: 0.5, build: 0.5, building_complete: 0.8, train: 1.2, summon_god: 1, summon_titan: 1,
  lightning: 0.9, fire: 0.7, magic: 1.2, heal: 0.85, error: 0.65, victory: 0.9, defeat: 0.9,
  tier_up: 1.1, chop: 0.85, mine: 1.0, pray: 1.0, horn: 1.0, ping: 1.0, ping_urgent: 1.0,
};

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI note → Hz

/** Volume factor for a sound at `d` tiles from the listener. */
export function distanceGain(d) {
  if (!(d > HEAR_FULL)) return 1;
  if (d >= HEAR_MAX) return 0;
  return Math.pow((HEAR_MAX - d) / (HEAR_MAX - HEAR_FULL), 1.6);
}

// ------------------------------------------------------------------ synth kit

/** Small helpers bound to one AudioContext; every node stops itself. */
function kit(ctx, noiseBuf) {
  const k = {
    ctx,
    gain(value, dest) {
      const g = ctx.createGain();
      g.gain.value = value;
      if (dest) g.connect(dest);
      return g;
    },
    filter(type, freq, q, dest) {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      if (q !== undefined) f.Q.value = q;
      if (dest) f.connect(dest);
      return f;
    },
    /** Attack / hold / exponential release envelope on a gain param. Returns end time. */
    env(param, t, { a = 0.005, h = 0, r = 0.2, peak = 1 }) {
      param.setValueAtTime(MIN_GAIN, t);
      if (a > 0) param.linearRampToValueAtTime(peak, t + a);
      else param.setValueAtTime(peak, t);
      if (h > 0) param.setValueAtTime(peak, t + a + h);
      param.exponentialRampToValueAtTime(MIN_GAIN, t + a + h + r);
      return t + a + h + r;
    },
    /** Oscillator voice with envelope and optional glide / vibrato. */
    osc(dest, t, { type = 'sine', f, f2, glide, detune = 0, vib = 0, vibRate = 5, vibDelay = 0, ...e }) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + (glide ?? (e.a || 0) + (e.h || 0) + (e.r || 0.2)));
      if (detune) o.detune.value = detune;
      const g = ctx.createGain();
      const end = k.env(g.gain, t, e);
      o.connect(g);
      g.connect(dest);
      if (vib > 0) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = vibRate;
        const depth = ctx.createGain();
        depth.gain.setValueAtTime(0, t);
        depth.gain.linearRampToValueAtTime(vib, t + vibDelay + 0.25);
        lfo.connect(depth);
        depth.connect(o.detune);
        lfo.start(t);
        lfo.stop(end + 0.05);
      }
      o.start(t);
      o.stop(end + 0.05);
      return end;
    },
    /** Filtered white noise with envelope and optional filter sweep. */
    noise(dest, t, { type = 'bandpass', f = 1000, f2, f3, glide, q = 1, ...e }) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const total = (e.a || 0) + (e.h || 0) + (e.r || 0.2);
      const fl = ctx.createBiquadFilter();
      fl.type = type;
      fl.Q.value = q;
      fl.frequency.setValueAtTime(f, t);
      if (f2 && f3) {
        fl.frequency.exponentialRampToValueAtTime(f2, t + total * 0.4);
        fl.frequency.exponentialRampToValueAtTime(f3, t + total);
      } else if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + (glide ?? total));
      const g = ctx.createGain();
      const end = k.env(g.gain, t, e);
      src.connect(fl);
      fl.connect(g);
      g.connect(dest);
      src.start(t, Math.random() * 1.5);
      src.stop(end + 0.05);
      return end;
    },
    /** Struck bell: inharmonic sine partials, higher ones decay faster. */
    bell(dest, t, f, { peak = 0.2, r = 1.2 } = {}) {
      const partials = [[1, 1, 1], [2.76, 0.45, 0.6], [5.4, 0.22, 0.35], [8.93, 0.1, 0.22]];
      let end = t;
      const limit = Math.min(12000, ctx.sampleRate * 0.45);
      for (const [ratio, amp, decay] of partials) {
        if (f * ratio > limit) continue;
        end = Math.max(end, k.osc(dest, t, { f: f * ratio, a: 0.002, r: r * decay, peak: peak * amp }));
      }
      return end;
    },
    /** Brass: sawtooth through a lowpass whose cutoff swells with the note. */
    brass(dest, t, f, { a = 0.04, h = 0.2, r = 0.3, peak = 0.15, bright = 2400, dark = 500, vib = 0, bend = 0 } = {}) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 1.5;
      lp.frequency.setValueAtTime(dark, t);
      lp.frequency.exponentialRampToValueAtTime(bright, t + a + Math.min(h, 0.15) + 0.02);
      lp.frequency.exponentialRampToValueAtTime(dark * 1.2, t + a + h + r);
      lp.connect(dest);
      const end = k.osc(lp, t, { type: 'sawtooth', f: bend ? f * (1 - bend) : f, f2: bend ? f : undefined, glide: bend ? 0.22 : undefined, a, h, r, peak, vib, vibRate: 5, vibDelay: 0.3 });
      k.osc(lp, t, { type: 'sawtooth', f: f * 1.003, a, h, r, peak: peak * 0.6, detune: 7 });
      return end;
    },
    /** Choir "aah": detuned saws through vowel formant filters, slow swell. */
    choir(dest, t, f, { a = 0.8, h = 0.6, r = 1.4, peak = 0.06 } = {}) {
      const formants = [[800, 6, 1], [1150, 7, 0.55], [2900, 9, 0.18]];
      const mix = ctx.createGain();
      mix.gain.value = 1;
      for (const [ff, q, amp] of formants) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = ff;
        bp.Q.value = q;
        const fg = ctx.createGain();
        fg.gain.value = amp * 4;
        mix.connect(bp);
        bp.connect(fg);
        fg.connect(dest);
      }
      // A little of the raw tone keeps the body of the chord.
      const body = ctx.createBiquadFilter();
      body.type = 'lowpass';
      body.frequency.value = 900;
      const bg = ctx.createGain();
      bg.gain.value = 0.35;
      mix.connect(body);
      body.connect(bg);
      bg.connect(dest);
      let end = t;
      for (const d of [-11, 0, 9]) {
        end = Math.max(end, k.osc(mix, t, { type: 'sawtooth', f, detune: d, a, h, r, peak, vib: 14, vibRate: 4.6 + d * 0.02, vibDelay: a * 0.6 }));
      }
      return end;
    },
    /** Timpani-like boom. */
    boom(dest, t, f, { peak = 0.4, r = 0.45 } = {}) {
      k.osc(dest, t, { f: f * 1.25, f2: f, glide: 0.08, a: 0.003, r, peak });
      k.noise(dest, t, { type: 'lowpass', f: 260, a: 0.002, r: r * 0.4, peak: peak * 0.5 });
      return t + r;
    },
  };
  return k;
}

// ------------------------------------------------------------------ recipes
// Each recipe schedules nodes into `out` (dry) and `rv` (reverb send) at time t,
// with `v` a small random variation factor around 1, and returns its end time.

const RECIPES = {
  click(k, t, out) {
    k.osc(out, t, { type: 'triangle', f: 1900, f2: 950, glide: 0.035, a: 0.001, r: 0.045, peak: 0.35 });
    k.noise(out, t, { type: 'highpass', f: 3500, a: 0.001, r: 0.018, peak: 0.12 });
    return t + 0.07;
  },
  select(k, t, out) {
    k.osc(out, t, { f: 660, a: 0.004, r: 0.08, peak: 0.28 });
    k.osc(out, t, { type: 'triangle', f: 330, a: 0.004, r: 0.07, peak: 0.1 });
    return k.osc(out, t + 0.05, { f: 990, a: 0.004, r: 0.11, peak: 0.22 });
  },
  move(k, t, out) {
    const lp = k.filter('lowpass', 1800, 0.7, out);
    k.osc(lp, t, { type: 'triangle', f: 540, f2: 400, glide: 0.08, a: 0.003, r: 0.1, peak: 0.32 });
    return k.osc(out, t, { f: 270, a: 0.003, r: 0.09, peak: 0.12 });
  },
  attack_melee(k, t, out, rv, v) {
    k.noise(out, t, { type: 'bandpass', f: 600 * v, f2: 2600 * v, f3: 900, q: 1.4, a: 0.05, r: 0.1, peak: 0.45 });
    const c = t + 0.07;
    const base = 1000 * v;
    let end = c;
    [[1, 0.16, 0.32], [1.48, 0.12, 0.26], [2.17, 0.1, 0.22], [2.9, 0.07, 0.16], [3.86, 0.05, 0.12]].forEach(([ratio, peak, r]) => {
      end = Math.max(end, k.osc(out, c, { f: base * ratio, a: 0.001, r, peak }));
    });
    k.noise(out, c, { type: 'highpass', f: 4200, a: 0.001, r: 0.045, peak: 0.3 });
    if (rv) k.osc(rv, c, { f: base * 1.48, a: 0.001, r: 0.3, peak: 0.05 });
    return end;
  },
  attack_ranged(k, t, out, rv, v) {
    const lp = k.filter('lowpass', 1400, 1, out);
    k.osc(lp, t, { type: 'triangle', f: 190 * v, f2: 150 * v, glide: 0.15, a: 0.002, r: 0.17, peak: 0.42 });
    k.osc(lp, t, { type: 'sawtooth', f: 380 * v, f2: 300 * v, glide: 0.1, a: 0.001, r: 0.06, peak: 0.08 });
    return k.noise(out, t + 0.02, { type: 'bandpass', f: 3400 * v, f2: 1100, q: 2.2, a: 0.012, r: 0.16, peak: 0.32 });
  },
  hit(k, t, out, rv, v) {
    k.osc(out, t, { f: 155 * v, f2: 55, glide: 0.09, a: 0.002, r: 0.13, peak: 0.6 });
    k.noise(out, t, { type: 'lowpass', f: 1000 * v, a: 0.001, r: 0.07, peak: 0.42 });
    return k.noise(out, t, { type: 'bandpass', f: 2200 * v, q: 1.5, a: 0.001, r: 0.035, peak: 0.16 });
  },
  death(k, t, out, rv, v) {
    const lp = k.filter('lowpass', 700, 1, out);
    lp.frequency.setValueAtTime(800, t);
    lp.frequency.exponentialRampToValueAtTime(240, t + 0.5);
    k.osc(lp, t, { type: 'sawtooth', f: 210 * v, f2: 72 * v, glide: 0.48, a: 0.03, h: 0.08, r: 0.36, peak: 0.3, vib: 25, vibRate: 7 });
    const th = t + 0.3;
    k.osc(out, th, { f: 95, f2: 42, glide: 0.18, a: 0.003, r: 0.22, peak: 0.55 });
    return k.noise(out, th, { type: 'lowpass', f: 420, a: 0.002, r: 0.22, peak: 0.35 });
  },
  build(k, t, out, rv, v) {
    let end = t;
    for (const [dt, p] of [[0, 1], [0.17, 0.8]]) {
      const s = t + dt;
      k.osc(out, s, { f: 820 * v, f2: 690 * v, glide: 0.06, a: 0.001, r: 0.075, peak: 0.42 * p });
      k.osc(out, s, { type: 'triangle', f: 1650 * v, a: 0.001, r: 0.03, peak: 0.1 * p });
      end = k.noise(out, s, { type: 'bandpass', f: 1800 * v, q: 3, a: 0.001, r: 0.045, peak: 0.32 * p });
    }
    return end;
  },
  building_complete(k, t, out, rv) {
    const notes = [72, 76, 79, 84];
    let end = t;
    notes.forEach((n, i) => {
      const s = t + i * 0.09;
      k.osc(out, s, { type: 'triangle', f: NOTE(n), a: 0.005, r: 0.55, peak: 0.18 });
      end = k.osc(rv || out, s, { f: NOTE(n + 12), a: 0.005, r: 0.4, peak: 0.05 });
    });
    k.bell(rv || out, t + 0.27, NOTE(84), { peak: 0.1, r: 1.1 });
    k.osc(out, t, { f: NOTE(60), a: 0.06, h: 0.25, r: 0.6, peak: 0.08 });
    k.osc(out, t, { f: NOTE(67), a: 0.06, h: 0.25, r: 0.6, peak: 0.06 });
    return Math.max(end, t + 1.3);
  },
  train(k, t, out, rv) {
    k.brass(out, t, NOTE(67), { a: 0.02, h: 0.06, r: 0.18, peak: 0.13, bright: 2200, dark: 500 });
    const end = k.brass(out, t + 0.13, NOTE(72), { a: 0.02, h: 0.12, r: 0.3, peak: 0.14, bright: 2600, dark: 500 });
    if (rv) k.osc(rv, t + 0.13, { f: NOTE(84), a: 0.01, r: 0.35, peak: 0.04 });
    return end;
  },
  summon_god(k, t, out, rv) {
    const bus = rv || out;
    let end = t;
    // D major choir swell with a deep root and a shimmer of bells.
    for (const n of [50, 57, 62, 66, 69]) {
      end = Math.max(end, k.choir(out, t, NOTE(n), { a: 0.9, h: 0.8, r: 1.6, peak: 0.05 }));
      if (rv) k.choir(rv, t, NOTE(n), { a: 0.9, h: 0.8, r: 1.6, peak: 0.025 });
    }
    k.osc(out, t, { f: NOTE(38), a: 0.8, h: 0.8, r: 1.4, peak: 0.16 });
    k.bell(bus, t + 0.9, NOTE(86), { peak: 0.07, r: 1.8 });
    k.bell(bus, t + 1.25, NOTE(93), { peak: 0.05, r: 1.6 });
    k.noise(bus, t, { type: 'highpass', f: 6000, a: 1.0, h: 0.4, r: 1.0, peak: 0.03 });
    return Math.max(end, t + 3.4);
  },
  summon_titan(k, t, out, rv) {
    // Earth-shaking rumble with a tremor wobble, then a deep horn.
    const trem = k.gain(1, out);
    const lfo = k.ctx.createOscillator();
    lfo.frequency.value = 7.5;
    const depth = k.gain(0.45, null);
    lfo.connect(depth);
    depth.connect(trem.gain);
    lfo.start(t);
    lfo.stop(t + 3.3);
    k.noise(trem, t, { type: 'lowpass', f: 90, f2: 160, f3: 70, q: 0.9, a: 1.0, h: 0.9, r: 1.3, peak: 1.4 });
    k.osc(out, t, { f: 44, f2: 36, glide: 3, a: 0.8, h: 1.0, r: 1.2, peak: 0.45 });
    const h = t + 0.85;
    let end = h;
    for (const [n, p] of [[33, 0.22], [40, 0.16], [45, 0.12]]) {
      end = Math.max(end, k.brass(out, h, NOTE(n), { a: 0.35, h: 0.95, r: 0.9, peak: p, bright: 950, dark: 160, vib: 10, bend: 0.06 }));
      if (rv) k.brass(rv, h, NOTE(n), { a: 0.35, h: 0.95, r: 0.9, peak: p * 0.5, bright: 950, dark: 160 });
    }
    k.boom(out, t + 0.02, 48, { peak: 0.5, r: 0.9 });
    return Math.max(end, t + 3.3);
  },
  lightning(k, t, out, rv, v) {
    k.noise(out, t, { type: 'highpass', f: 2400 * v, a: 0.001, r: 0.08, peak: 0.85 });
    k.noise(out, t + 0.035, { type: 'bandpass', f: 5200, q: 0.8, a: 0.001, r: 0.06, peak: 0.5 });
    k.noise(out, t + 0.07, { type: 'highpass', f: 1800, a: 0.001, r: 0.05, peak: 0.35 });
    k.noise(out, t + 0.02, { type: 'lowpass', f: 320, f2: 110, glide: 0.9, a: 0.06, h: 0.1, r: 0.9, peak: 0.6 });
    if (rv) k.noise(rv, t, { type: 'bandpass', f: 1800, q: 0.6, a: 0.001, r: 0.25, peak: 0.25 });
    k.osc(out, t + 0.02, { f: 62, f2: 34, glide: 0.6, a: 0.01, r: 0.6, peak: 0.3 });
    return t + 1.2;
  },
  fire(k, t, out, rv, v) {
    k.noise(out, t, { type: 'bandpass', f: 320 * v, f2: 1700 * v, f3: 650, q: 0.9, a: 0.12, h: 0.08, r: 0.38, peak: 0.6 });
    k.noise(out, t, { type: 'lowpass', f: 260, a: 0.09, r: 0.42, peak: 0.32 });
    for (let i = 0; i < 9; i++) {
      k.noise(out, t + 0.04 + Math.random() * 0.5, { type: 'highpass', f: 2800 + Math.random() * 2500, a: 0.001, r: 0.012 + Math.random() * 0.012, peak: 0.12 + Math.random() * 0.1 });
    }
    return t + 0.7;
  },
  magic(k, t, out, rv, v) {
    const bus = rv || out;
    k.osc(out, t, { f: 480 * v, f2: 1650 * v, glide: 0.35, a: 0.02, h: 0.08, r: 0.32, peak: 0.13, vib: 40, vibRate: 11 });
    k.osc(out, t, { type: 'triangle', f: 240 * v, f2: 820 * v, glide: 0.35, a: 0.02, h: 0.08, r: 0.3, peak: 0.07 });
    const scale = [1568, 1760, 2093, 2349, 2637, 3136];
    let end = t + 0.5;
    for (let i = 0; i < 6; i++) {
      const f = scale[Math.floor(Math.random() * scale.length)] * v;
      end = Math.max(end, k.osc(bus, t + 0.04 + i * 0.05, { f, a: 0.002, r: 0.16, peak: 0.07 }));
    }
    return end;
  },
  heal(k, t, out, rv) {
    const bus = rv || out;
    let end = t;
    [[76, 0], [83, 0.12], [88, 0.24]].forEach(([n, dt]) => {
      end = Math.max(end, k.bell(out, t + dt, NOTE(n), { peak: 0.13, r: 0.9 }));
      k.osc(bus, t + dt, { f: NOTE(n), a: 0.01, r: 0.7, peak: 0.04 });
    });
    return end;
  },
  error(k, t, out) {
    const lp = k.filter('lowpass', 950, 1, out);
    k.osc(lp, t, { type: 'square', f: 155, a: 0.004, h: 0.07, r: 0.04, peak: 0.16 });
    return k.osc(lp, t + 0.14, { type: 'square', f: 145, a: 0.004, h: 0.08, r: 0.05, peak: 0.16 });
  },
  victory(k, t, out, rv) {
    const melody = [[67, 0, 0.1], [72, 0.15, 0.1], [76, 0.3, 0.1], [79, 0.45, 0.4], [76, 0.95, 0.08], [79, 1.1, 1.1]];
    let end = t;
    for (const [n, dt, h] of melody) {
      end = Math.max(end, k.brass(out, t + dt, NOTE(n), { a: 0.025, h, r: 0.35, peak: 0.12, bright: 3000, dark: 600, vib: h > 0.3 ? 12 : 0 }));
      if (rv) k.brass(rv, t + dt, NOTE(n), { a: 0.025, h, r: 0.35, peak: 0.05, bright: 3000, dark: 600 });
    }
    for (const n of [48, 55, 60, 64]) k.brass(out, t + 1.1, NOTE(n), { a: 0.12, h: 0.9, r: 1.0, peak: 0.06, bright: 1600, dark: 400 });
    k.boom(out, t, NOTE(43), { peak: 0.45 });
    k.boom(out, t + 0.45, NOTE(43), { peak: 0.45 });
    k.boom(out, t + 1.1, NOTE(36), { peak: 0.55, r: 0.9 });
    if (rv) k.bell(rv, t + 1.1, NOTE(91), { peak: 0.05, r: 1.6 });
    return Math.max(end, t + 3.1);
  },
  defeat(k, t, out, rv) {
    const bus = rv || out;
    for (const n of [45, 52]) k.brass(out, t, NOTE(n), { a: 0.6, h: 2.0, r: 1.1, peak: 0.07, bright: 700, dark: 200, vib: 6 });
    const melody = [[57, 0.1, 0.4], [55, 0.65, 0.4], [53, 1.2, 0.4], [52, 1.75, 1.2]];
    let end = t;
    for (const [n, dt, h] of melody) {
      end = Math.max(end, k.brass(out, t + dt, NOTE(n), { a: 0.12, h, r: 0.5, peak: 0.1, bright: 1100, dark: 300, vib: 10 }));
      k.osc(bus, t + dt, { type: 'triangle', f: NOTE(n + 12), a: 0.1, h, r: 0.5, peak: 0.03 });
    }
    k.boom(out, t + 1.75, NOTE(33), { peak: 0.45, r: 1.2 });
    return Math.max(end, t + 3.6);
  },
  tier_up(k, t, out, rv) {
    const bus = rv || out;
    let end = t;
    [60, 64, 67, 72].forEach((n, i) => {
      end = Math.max(end, k.brass(out, t + i * 0.08, NOTE(n), { a: 0.05, h: 0.55, r: 0.8, peak: 0.075, bright: 2400, dark: 450, vib: 8 }));
    });
    k.bell(bus, t + 0.35, NOTE(84), { peak: 0.09, r: 1.4 });
    k.bell(bus, t + 0.5, NOTE(91), { peak: 0.06, r: 1.2 });
    k.boom(out, t, NOTE(36), { peak: 0.45, r: 0.7 });
    return Math.max(end, t + 1.8);
  },
  chop(k, t, out, rv, v) {
    k.noise(out, t, { type: 'bandpass', f: 1150 * v, q: 2.6, a: 0.001, r: 0.065, peak: 0.55 });
    return k.osc(out, t, { f: 215 * v, f2: 140 * v, glide: 0.07, a: 0.001, r: 0.085, peak: 0.42 });
  },
  mine(k, t, out, rv, v) {
    k.osc(out, t, { f: 2100 * v, a: 0.001, r: 0.13, peak: 0.13 });
    k.osc(out, t, { f: 3170 * v, a: 0.001, r: 0.085, peak: 0.09 });
    k.osc(out, t, { f: 4420 * v, a: 0.001, r: 0.05, peak: 0.06 });
    k.noise(out, t, { type: 'highpass', f: 2600, a: 0.001, r: 0.025, peak: 0.25 });
    k.osc(out, t, { f: 310 * v, a: 0.001, r: 0.045, peak: 0.2 });
    return t + 0.2;
  },
  pray(k, t, out, rv, v) {
    const f = NOTE([72, 74, 76, 79][Math.floor(Math.random() * 4)]) * (0.995 + (v - 1) * 0.1);
    const end = k.bell(out, t, f, { peak: 0.1, r: 1.6 });
    if (rv) k.bell(rv, t, f, { peak: 0.06, r: 1.6 });
    return end;
  },
  horn(k, t, out, rv) {
    let end = t;
    for (const [n, p] of [[43, 0.17], [50, 0.11], [55, 0.05]]) {
      end = Math.max(end, k.brass(out, t, NOTE(n), { a: 0.25, h: 0.85, r: 0.55, peak: p, bright: 1150, dark: 260, vib: 12, bend: 0.08 }));
      if (rv) k.brass(rv, t, NOTE(n), { a: 0.25, h: 0.85, r: 0.55, peak: p * 0.6, bright: 1150, dark: 260 });
    }
    return end;
  },
  // A teammate's ping: two soft sonar blips a fifth apart, nothing like the war horn.
  ping(k, t, out, rv) {
    k.osc(out, t, { f: NOTE(81), a: 0.003, r: 0.16, peak: 0.26 });
    k.osc(out, t, { type: 'triangle', f: NOTE(69), a: 0.003, r: 0.12, peak: 0.1 });
    const end = k.osc(out, t + 0.1, { f: NOTE(88), a: 0.003, r: 0.3, peak: 0.24 });
    if (rv) k.osc(rv, t + 0.1, { f: NOTE(88), a: 0.003, r: 0.5, peak: 0.07 });
    return end;
  },
  // "Need help here": three quick blips, the last one higher and longer.
  ping_urgent(k, t, out, rv) {
    let end = t;
    [[0, 84, 0.1], [0.09, 84, 0.1], [0.18, 91, 0.34]].forEach(([dt, n, r]) => {
      end = Math.max(end, k.osc(out, t + dt, { f: NOTE(n), a: 0.002, r, peak: 0.28 }));
      k.osc(out, t + dt, { type: 'triangle', f: NOTE(n - 12), a: 0.002, r: 0.08, peak: 0.1 });
    });
    if (rv) k.osc(rv, t + 0.18, { f: NOTE(91), a: 0.003, r: 0.5, peak: 0.07 });
    return end;
  },
};

// ------------------------------------------------------------------ engine

function makeNoiseBuffer(ctx) {
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function makeImpulse(ctx, seconds = 2.2, decay = 3) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

/** Master chain on a context: voices → master gain → compressor → destination, plus a reverb bus. */
function buildGraph(ctx) {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  comp.connect(ctx.destination);
  const master = ctx.createGain();
  master.connect(comp);
  let reverb = null;
  try {
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    conv.connect(wet);
    wet.connect(master);
    reverb = conv;
  } catch {
    reverb = null;
  }
  return { master, comp, reverb, noise: makeNoiseBuffer(ctx) };
}

function audioContextClass() {
  if (typeof globalThis === 'undefined') return null;
  return globalThis.AudioContext || globalThis.webkitAudioContext || null;
}

class SfxEngine {
  constructor() {
    this.ctx = null;
    this.graph = null;
    this.kit = null;
    this.volume = 0.7;
    this.muted = false;
    this.listener = null; // { x, y, scale } or null = no attenuation
    this.last = new Map(); // name → last start (ctx time)
    this.active = new Map(); // name → [end times]
    this.voiceEnds = [];
    this.armed = false;
    this.unlockHandler = null;
  }

  /**
   * Arm the AudioContext unlock on the first user gesture. Idempotent.
   * @param {{ context?: AudioContext|object, volume?: number }} [opts] context injects one (tests)
   */
  init(opts = {}) {
    if (typeof opts.volume === 'number') this.volume = Math.min(1, Math.max(0, opts.volume));
    if (opts.context) {
      this._attach(opts.context);
      return this;
    }
    if (this.armed || !audioContextClass() || typeof window === 'undefined' || !window.addEventListener) return this;
    this.armed = true;
    // The listeners stay for the life of the page: a context that the browser later suspends
    // (or, on Safari, interrupts) is resumed by the next click or key press. unlock() does
    // nothing while the context is running.
    const handler = () => this.unlock();
    this.unlockHandler = handler;
    for (const ev of ['pointerdown', 'keydown', 'touchend', 'mousedown']) window.addEventListener(ev, handler, true);
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && this.ctx) this.unlock();
      });
    }
    // Browsers that already saw a gesture (e.g. module loaded late) can start right away.
    try {
      if (navigator.userActivation && navigator.userActivation.hasBeenActive) this.unlock();
    } catch {
      // ignore
    }
    return this;
  }

  /** Create or resume the AudioContext (call from a user gesture). */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = audioContextClass();
        if (!AC) return;
        this._attach(new AC({ latencyHint: 'interactive' }));
      }
      const st = this.ctx.state;
      if (st !== 'running' && st !== 'closed' && this.ctx.resume) this.ctx.resume().catch(() => {});
    } catch (err) {
      console.warn('[sfx] audio unavailable', err);
    }
  }

  _attach(ctx) {
    this.ctx = ctx;
    this.graph = buildGraph(ctx);
    this.kit = kit(ctx, this.graph.noise);
    this._applyVolume();
  }

  _applyVolume() {
    if (!this.graph) return;
    const g = this.muted ? 0 : Math.pow(this.volume, 1.5);
    const p = this.graph.master.gain;
    try {
      p.cancelScheduledValues(this.ctx.currentTime);
      p.setTargetAtTime(g, this.ctx.currentTime, 0.02);
    } catch {
      p.value = g;
    }
  }

  /** True when a sound would actually be heard right now. */
  get ready() {
    return !!(this.ctx && this.graph && this.ctx.state === 'running');
  }

  /**
   * Play a named sound.
   * @param {string} name one of SFX_NAMES
   * @param {{ x?: number, y?: number, volume?: number }} [opts] x, y in tiles for distance attenuation
   * @returns {boolean} whether it was scheduled
   */
  play(name, { x, y, volume = 1 } = {}) {
    if (!this.ready || this.muted || !(volume > 0)) return false;
    const recipe = RECIPES[name];
    if (!recipe) return false;
    let gain = volume * (LEVEL[name] ?? 0.7);
    let pan = 0;
    if (this.listener && Number.isFinite(x) && Number.isFinite(y)) {
      const dx = x - this.listener.x;
      const dy = y - this.listener.y;
      const scale = this.listener.scale;
      gain *= distanceGain(Math.hypot(dx, dy) / scale);
      pan = Math.max(-0.75, Math.min(0.75, dx / (18 * scale)));
    }
    if (gain < 0.01) return false;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const lim = LIMITS[name] || DEFAULT_LIMIT;
    if (now - (this.last.get(name) ?? -1e9) < lim.gap) return false;
    const ends = (this.active.get(name) || []).filter((e) => e > now);
    if (ends.length >= lim.voices) {
      this.active.set(name, ends);
      return false;
    }
    this.voiceEnds = this.voiceEnds.filter((e) => e > now);
    if (!lim.ui && this.voiceEnds.length >= MAX_VOICES) return false;
    // Overlapping copies of one sound get quieter so a volley does not blast.
    gain /= Math.sqrt(1 + ends.length * 0.6);

    try {
      const t = now + 0.005;
      const voice = ctx.createGain();
      voice.gain.value = gain;
      let tail = voice;
      if (pan && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        voice.connect(p);
        tail = p;
      }
      tail.connect(this.graph.master);
      // Reverb send: a separate input, so each recipe chooses what reverberates.
      let send = null;
      if (this.graph.reverb) {
        send = ctx.createGain();
        send.gain.value = gain;
        send.connect(this.graph.reverb);
      }
      const variation = 0.94 + Math.random() * 0.12;
      const end = recipe(this.kit, t, voice, send, variation);
      ends.push(end);
      this.active.set(name, ends);
      this.voiceEnds.push(end);
      this.last.set(name, now);
      const ms = Math.max(100, (end - now) * 1000 + 300);
      const timer = setTimeout(() => {
        try {
          tail.disconnect();
          if (send) send.disconnect();
        } catch {
          // already gone
        }
      }, ms);
      if (timer && typeof timer.unref === 'function') timer.unref();
      return true;
    } catch (err) {
      console.warn(`[sfx] failed to play ${name}`, err);
      return false;
    }
  }

  /**
   * Listener position (tiles), usually the camera target. `scale` stretches the hearing
   * range (and the stereo spread) by that factor: the camera's zoom, so that what is on
   * screen stays audible when the view is pulled back.
   */
  setListener(x, y, scale = 1) {
    if (Number.isFinite(x) && Number.isFinite(y)) this.listener = { x, y, scale: scale > 0 && Number.isFinite(scale) ? scale : 1 };
    else this.listener = null;
  }

  /** Master volume 0..1. */
  setVolume(v) {
    if (!Number.isFinite(v)) return;
    this.volume = Math.min(1, Math.max(0, v));
    this._applyVolume();
  }

  /** Mute or unmute everything. */
  mute(on = true) {
    this.muted = !!on;
    this._applyVolume();
  }
}

/** The shared sound engine. */
export const sfx = new SfxEngine();

/**
 * Render one sound into an AudioBuffer with an OfflineAudioContext (browser only;
 * used by checks to measure levels). Bypasses rate limits and attenuation.
 * @returns {Promise<AudioBuffer|null>}
 */
export async function renderSfxOffline(name, { sampleRate = 44100, seconds = 4 } = {}) {
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OAC || !RECIPES[name]) return null;
  const ctx = new OAC(2, Math.floor(sampleRate * seconds), sampleRate);
  const graph = buildGraph(ctx);
  graph.master.gain.value = 1;
  const k = kit(ctx, graph.noise);
  const voice = ctx.createGain();
  voice.gain.value = LEVEL[name] ?? 0.7;
  voice.connect(graph.master);
  const send = ctx.createGain();
  send.gain.value = LEVEL[name] ?? 0.7;
  if (graph.reverb) send.connect(graph.reverb);
  RECIPES[name](k, 0.01, voice, graph.reverb ? send : null, 1);
  return ctx.startRendering();
}
