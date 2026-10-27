// Background music, synthesized live with WebAudio (no audio files). It shares the page's one
// AudioContext and master limiter with the sound effects (sfx.js), so the browser's "start audio
// on a click" unlock happens once, for both.
//
//   music.init({ volume, muted })   once at boot; safe to call again
//   music.play(themeId)             'menu' or a pantheon id; crossfades from what is playing. It starts
//                                   as soon as the browser allows audio (after the first click or key press)
//   music.stop(fadeSeconds)         fade out and keep quiet until the next play()
//   music.setIntensity(v)           0 calm .. 1 battle; the score eases toward it (quickly up, slowly down)
//   music.setVolume(v) / music.mute(on)
//   music.duck(depth, seconds)      dip under a stinger (sound effects named in DUCKS do it by themselves)
//   music.state()                   { theme, level, target, playing, ready, muted, volume }
// Every call is a safe no-op where WebAudio is missing (Node, old browsers). What plays is
// composed bar by bar by music-composer.js from the themes in music-themes.js.
import { sfx, kit as makeKit, makeNoiseBuffer } from './sfx.js';
import { THEMES, themeFor } from './music-themes.js';
import { createScore, composeBar } from './music-composer.js';
import { playVoice } from './music-voices.js';

const HORIZON = 1.6; // seconds of music scheduled ahead of the clock: rides out a stalled frame
const TICK_MS = 250;
const MAX_ERRORS = 5; // scheduler faults before the music gives up (it must never break the game)
const LEVEL_UP = 1.5; // seconds the intensity takes to close most of the way up ...
const LEVEL_DOWN = 7; // ... and down: a fight ends slowly
const MUSIC_GAIN = 0.63; // overall loudness of the music at full volume (balanced against the sound effects by measuring)
const MIN_GAIN = 0.0001;

// Each layer of the score is a bus with its own loudness and how much of it goes to the reverb.
const LAYERS = {
  pad: { gain: 1.0, wet: 0.5 },
  drone: { gain: 1.3, wet: 0.3 },
  bass: { gain: 0.72, wet: 0.0 },
  arp: { gain: 1.0, wet: 0.35 },
  lead: { gain: 1.1, wet: 0.45 },
  perc: { gain: 0.68, wet: 0.1 },
  war: { gain: 0.4, wet: 0.15 },
  fx: { gain: 1.0, wet: 0.7 },
};

/** Sound effects that make the music step back, as [how much (0..1), seconds]. */
export const DUCKS = {
  summon_god: [0.4, 3],
  summon_titan: [0.6, 4],
  victory: [0.7, 4.5],
  defeat: [0.7, 4.5],
  tier_up: [0.3, 2],
  horn: [0.3, 2.5],
};

/** A dark hall: noise that dies away, smoothed more the longer it lasts. */
function makeHall(ctx, seconds = 2.8) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const x = i / len;
      lp += ((Math.random() * 2 - 1) - lp) * (1 - (0.35 + 0.6 * x));
      d[i] = lp * Math.pow(1 - x, 2.4) * 1.6;
    }
  }
  return buf;
}

/**
 * The music's own part of the graph: layers → run mix → bus → duck → hide → the shared limiter, with
 * a reverb fed by each run's send. `out` is where the music joins (the sound effects' limiter).
 */
function buildMusicGraph(ctx, out) {
  const hide = ctx.createGain();
  hide.connect(out);
  const duck = ctx.createGain();
  duck.connect(hide);
  const bus = ctx.createGain();
  bus.connect(duck);
  let reverbIn = null;
  try {
    const conv = ctx.createConvolver();
    conv.buffer = makeHall(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.9;
    conv.connect(wet);
    wet.connect(bus);
    reverbIn = conv;
  } catch {
    reverbIn = null;
  }
  return { bus, duck, hide, reverbIn };
}

/** One piece of music playing: a score, its layer buses, and the clock position of the next bar. */
class Run {
  /** @param {{ ctx: object, nodes: object, kit: object }} env */
  constructor(env, theme, seed, now, fadeIn) {
    const { ctx, nodes } = env;
    this.env = env;
    this.theme = theme;
    this.score = createScore(theme, seed);
    this.mix = ctx.createGain();
    this.mix.gain.value = MIN_GAIN;
    this.mix.gain.setValueAtTime(MIN_GAIN, now);
    this.mix.gain.linearRampToValueAtTime(1, now + Math.max(0.01, fadeIn));
    this.mix.connect(nodes.bus);
    this.send = ctx.createGain();
    if (nodes.reverbIn) this.send.connect(nodes.reverbIn);
    this.bus = {};
    for (const [name, L] of Object.entries(LAYERS)) {
      const g = ctx.createGain();
      g.gain.value = L.gain;
      g.connect(this.mix);
      if (L.wet > 0 && nodes.reverbIn) {
        const w = ctx.createGain();
        w.gain.value = L.wet;
        g.connect(w);
        w.connect(this.send);
      }
      this.bus[name] = g;
    }
    this.nextBar = now + 0.12;
    this.bars = 0;
    this.fading = false;
    this.bad = new Set(); // instruments that threw: left out from then on
  }

  /** Compose and schedule every bar that starts before `until`. */
  advance(until, level) {
    const { ctx, kit } = this.env;
    if (this.fading) return;
    // After a stall (a hidden tab, a long frame) do not catch up: carry on from now.
    if (this.nextBar < ctx.currentTime - 0.5) this.nextBar = ctx.currentTime + 0.1;
    while (this.nextBar < until) {
      const bar = composeBar(this.score, level);
      const t0 = this.nextBar;
      for (const ev of bar.events) {
        if (this.bad.has(ev.inst)) continue;
        try {
          playVoice(kit, this.bus[ev.layer], t0 + ev.t, ev);
        } catch (err) {
          this.bad.add(ev.inst);
          console.warn(`[music] ${ev.inst} failed and is muted`, err);
        }
      }
      this.nextBar += bar.dur;
      this.bars++;
    }
  }

  fadeOut(seconds, now) {
    if (this.fading) return;
    this.fading = true;
    const tc = Math.max(0.05, seconds / 4);
    for (const p of [this.mix.gain, this.send.gain]) {
      try {
        p.cancelScheduledValues(now);
        p.setValueAtTime(p.value, now);
        p.setTargetAtTime(0, now, tc);
      } catch {
        p.value = 0;
      }
    }
    this.endsAt = now + seconds * 1.6;
  }

  dispose() {
    try {
      this.mix.disconnect();
      this.send.disconnect();
      for (const g of Object.values(this.bus)) g.disconnect();
    } catch {
      // already gone
    }
  }
}

class MusicEngine {
  constructor() {
    this.ctx = null;
    this.env = null;
    this.volume = 0.5;
    this.muted = false;
    this.want = null; // the theme that should be playing: { id, theme, seed } or null
    this.run = null; // the run on the air
    this.fading = []; // runs fading out
    this.target = 0;
    this.level = 0;
    this.lastTick = null;
    this.timer = null;
    this.errors = 0;
    this.disabled = false;
    this.inited = false;
    this.hidden = false;
    this.fadeIn = 2.5;
    this.fadeOutSeconds = 2.2;
  }

  /**
   * Set up the engine: take the starting volume, arm the audio unlock (the sound effects' own) and
   * the hidden-tab fade, and listen for sounds that should make the music step back. Idempotent.
   * @param {{ volume?: number, muted?: boolean }} [opts]
   */
  init(opts = {}) {
    if (typeof opts.volume === 'number' && Number.isFinite(opts.volume)) this.volume = Math.min(1, Math.max(0, opts.volume));
    if (typeof opts.muted === 'boolean') this.muted = opts.muted;
    if (this.inited) {
      this._applyVolume();
      return this;
    }
    this.inited = true;
    sfx.init();
    sfx.onPlay((name) => {
      const d = DUCKS[name];
      if (d) this.duck(d[0], d[1]);
    });
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => {
        this.hidden = !!document.hidden;
        this._applyHidden();
      });
      this.hidden = !!document.hidden;
    }
    return this;
  }

  /** True when music would be heard right now. */
  get ready() {
    return !!(this.ctx && this.ctx.state === 'running' && !this.muted && this.volume > 0);
  }

  /** The audio context and graph, made on first use once the sound engine has an unlocked context. */
  _attach() {
    const sh = sfx.shared;
    if (!sh) return false;
    if (this.ctx === sh.ctx) return true;
    this.ctx = sh.ctx;
    const nodes = buildMusicGraph(sh.ctx, sh.out);
    this.env = { ctx: sh.ctx, nodes, kit: makeKit(sh.ctx, sh.noise) };
    this.run = null;
    this.fading = [];
    this._applyVolume();
    this._applyHidden();
    return true;
  }

  _applyVolume() {
    if (!this.env) return;
    const g = this.muted ? 0 : MUSIC_GAIN * Math.pow(this.volume, 1.5);
    const p = this.env.nodes.bus.gain;
    try {
      p.cancelScheduledValues(this.ctx.currentTime);
      p.setTargetAtTime(g, this.ctx.currentTime, 0.04);
    } catch {
      p.value = g;
    }
  }

  _applyHidden() {
    if (!this.env) return;
    const p = this.env.nodes.hide.gain;
    const now = this.ctx.currentTime;
    try {
      p.cancelScheduledValues(now);
      p.setTargetAtTime(this.hidden ? 0 : 1, now, this.hidden ? 0.25 : 0.5);
    } catch {
      p.value = this.hidden ? 0 : 1;
    }
  }

  /**
   * Start a theme ('menu' or a pantheon id), crossfading from the one playing. Playing the theme
   * that is already on is a no-op. Before the browser allows audio it is remembered and starts then.
   * @param {string} id
   * @param {{ seed?: number, fade?: number }} [opts]
   */
  play(id, opts = {}) {
    if (this.disabled) return;
    const theme = themeFor(id);
    if (this.want && this.want.theme === theme && !(this.run && this.run.fading)) return;
    this.want = { id: theme.id, theme, seed: opts.seed ?? Math.floor(Math.random() * 0x7fffffff), fade: opts.fade };
    this._startTimer();
    this.tick();
  }

  /** Fade out and stay quiet until the next play(). */
  stop(fade = 2.2) {
    this.want = null;
    if (!this.env || !this.run) return;
    this.run.fadeOut(fade, this.ctx.currentTime);
    this.fading.push(this.run);
    this.run = null;
  }

  /** Battle intensity 0 (calm) .. 1 (full battle). */
  setIntensity(v) {
    if (!Number.isFinite(v)) return;
    this.target = Math.min(1, Math.max(0, v));
  }

  setVolume(v) {
    if (!Number.isFinite(v)) return;
    this.volume = Math.min(1, Math.max(0, v));
    this._applyVolume();
    if (this.volume > 0 && !this.muted && this.want) this._startTimer();
  }

  mute(on = true) {
    this.muted = !!on;
    this._applyVolume();
    if (!this.muted && this.want) this._startTimer();
  }

  /** Lower the music by `depth` (0..1) for about `seconds`, then bring it back. */
  duck(depth = 0.5, seconds = 2) {
    if (!this.env || !(depth > 0)) return;
    const p = this.env.nodes.duck.gain;
    const now = this.ctx.currentTime;
    const floor = Math.max(0.05, 1 - Math.min(1, depth));
    try {
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.setTargetAtTime(floor, now, 0.05);
      p.setTargetAtTime(1, now + Math.max(0.2, seconds * 0.6), Math.max(0.15, seconds * 0.25));
    } catch {
      p.value = 1;
    }
  }

  state() {
    return {
      theme: this.run ? this.run.theme.id : null,
      wanted: this.want ? this.want.id : null,
      level: this.level,
      target: this.target,
      playing: !!(this.run && !this.run.fading && this.ready),
      ready: this.ready,
      muted: this.muted,
      volume: this.volume,
      bars: this.run ? this.run.bars : 0,
    };
  }

  _startTimer() {
    if (this.timer || typeof setInterval !== 'function') return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    if (this.timer && typeof this.timer.unref === 'function') this.timer.unref();
  }

  _stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One scheduler step: attach to the audio context, follow the wanted theme, ease the intensity, schedule ahead. */
  tick() {
    if (this.disabled) return;
    try {
      this._tick();
      this.errors = 0;
    } catch (err) {
      if (++this.errors >= MAX_ERRORS) {
        this.disabled = true;
        this._stopTimer();
        console.warn('[music] stopped after repeated faults', err);
      } else console.warn('[music] scheduler fault', err);
    }
  }

  _tick() {
    if (!this.want && !this.run && !this.fading.length) {
      this._stopTimer();
      return;
    }
    if (!this._attach()) return;
    const ctx = this.ctx;
    if (ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // Finished fades are taken down.
    for (let i = this.fading.length - 1; i >= 0; i--) {
      if (now >= this.fading[i].endsAt) this.fading.splice(i, 1)[0].dispose();
    }
    const silent = this.muted || this.volume <= 0;
    if (silent || !this.want) {
      if (this.run) {
        this.run.fadeOut(silent ? 0.3 : this.fadeOutSeconds, now);
        this.fading.push(this.run);
        this.run = null;
      }
      this.lastTick = now;
      return;
    }
    if (!this.run || this.run.theme !== this.want.theme) {
      const hadRun = !!this.run;
      if (this.run) {
        this.run.fadeOut(this.fadeOutSeconds, now);
        this.fading.push(this.run);
      }
      const fade = this.want.fade ?? (hadRun ? 3 : this.fadeIn);
      // The new piece comes in a little after the old one starts to leave, so two keys never ring together for long.
      this.run = new Run(this.env, this.want.theme, this.want.seed, now + (hadRun ? 0.9 : 0), fade);
      this.level = this.target;
    }
    const dt = this.lastTick === null ? 0 : Math.max(0, now - this.lastTick);
    this.lastTick = now;
    const tau = this.target > this.level ? LEVEL_UP : LEVEL_DOWN;
    this.level += (this.target - this.level) * (1 - Math.exp(-dt / tau));
    this.run.advance(now + HORIZON, this.level);
  }
}

/** The shared music engine. */
export const music = new MusicEngine();

/**
 * Render a theme into an AudioBuffer with an OfflineAudioContext (browser only; used by checks to
 * measure levels and by the music lab). The intensity follows `levelAt(seconds)` when given.
 * @returns {Promise<AudioBuffer|null>}
 */
export async function renderMusicOffline(themeId, { seconds = 60, sampleRate = 44100, seed = 1, level = 0, levelAt = null, volume = 1, only = null } = {}) {
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OAC) return null;
  const ctx = new OAC(2, Math.floor(sampleRate * seconds), sampleRate);
  // The same limiter the sound effects end in, so measured levels match the game.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  comp.connect(ctx.destination);
  const nodes = buildMusicGraph(ctx, comp);
  nodes.bus.gain.value = MUSIC_GAIN * Math.pow(volume, 1.5);
  const env = { ctx, nodes, kit: makeKit(ctx, makeNoiseBuffer(ctx)) };
  const run = new Run(env, themeFor(themeId), seed, 0, 0.01);
  if (only) for (const [name, g] of Object.entries(run.bus)) if (!only.includes(name)) g.gain.value = 0; // solo some layers
  while (run.nextBar < seconds) run.advance(run.nextBar + 0.01, levelAt ? levelAt(run.nextBar) : level);
  return ctx.startRendering();
}

export const MUSIC_THEME_IDS = Object.freeze(Object.keys(THEMES));
