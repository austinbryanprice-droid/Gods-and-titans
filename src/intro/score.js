// The score under the intro film (DESIGN 11.1, 9): the title theme played as an overture, the same piece the
// title screen goes on playing when the film ends. It is conducted from the film's clock (script.js `musicAt`: a
// quiet dawn building through the prayer and the march to the full battle of the titans, then settling to the title's
// own level) and mixed to the voice: it steps back while the narrator speaks and swells again between the lines.
// No recorded audio: the music engine (src/audio/music.js) composes and plays it live.
//
//   const score = createFilmScore();    // the page's music engine (tests pass { music: a stand-in })
//   score.start();                      // the title theme from the quiet, at the story's first intensity (as the film's first frame shows)
//   score.update(t);                    // once a frame, with the film's second: the intensity follows the story
//   score.speaking(on);                 // the narrator began / finished a line: step back / swell again
//   score.waiting();                    // true while only a click is missing (the browser has not allowed audio)
//   score.end('handover' | 'cut');      // the film is over. 'handover': the piece plays on for the title screen;
//                                       // 'cut' (skipped, failed): it fades out inside the dip to black
//
// What it never does is get in the film's way: every call is guarded, and without audio (Node, a browser that has
// not been clicked yet) the engine's own calls are quiet no-ops, so the film plays on in silence. A first visit's
// click can come at any moment of the film: the engine then asks `joinAt` where the piece should come in, and the
// bars before that second are composed without a sound, so it enters on the section the story is in, not its first.
import { music as engine, COMPOSE_AHEAD } from '../audio/music.js';
import { THEMES } from '../audio/music-themes.js';
import { musicAt } from './script.js';

/** The piece: the title theme, with a seed that fixes what is played (the same overture every time). */
export const THEME = 'menu';
export const SEED = 82;

/** The score is lifted this much above the settings' level between the lines, but never past what the Music slider's top gives. */
export const LIFT = 1.4;
/** While a line is spoken the score is this fraction of that (about -11 dB): narration over a bed, not a duet. */
export const UNDER = 0.28;
const ATTACK = 0.1; // time constant (s) of the step back: nearly done a third of a second after the line is handed over
const RELEASE = 0.55; // time constant (s) of the swell after it: back to the lift in about two seconds
const RELEASE_AFTER = 0.2; // seconds after the last word before the swell begins
const CUT_FADE = 0.3; // seconds the score takes to fade when the film is cut short (the dip to black is 0.32 s)
const RESET_AFTER = 0.36; // seconds after a cut that the stage goes back to 1: the fading piece is 40 dB down and the title's own, begun with the end of the dip, barely heard
const GLIDE = 1.5; // time constant (s) of the lift going away once the film hands over to the title screen

/**
 * How far ahead of the film's clock the intensity is read. The engine composes a bar `COMPOSE_AHEAD` seconds before
 * it sounds and the bar lasts `bar` seconds, so the story's value for the middle of the bar being composed is this far on.
 */
export const LEAD = COMPOSE_AHEAD + THEMES[THEME].bar / 2;

/** The intensity a bar that starts at `barStart` seconds is composed at, for a render that is not live (it composes at the bar's start). */
export function barLevel(barStart) {
  return musicAt(barStart + THEMES[THEME].bar / 2);
}

/** The lift for a Music volume setting: LIFT, held so that the music is never louder than the slider's top would make it. */
export function liftFor(volume) {
  const v = Number.isFinite(volume) ? Math.max(0.01, Math.min(1, volume)) : 0.5;
  return Math.min(LIFT, 1 / Math.pow(v, 1.5));
}

/**
 * The mix stage over a film second, for a render that is not live: the lift, stepping back to `UNDER` of it over each
 * of the `speech` windows ([from, to] in film seconds) with the same time constants as the live score.
 * @returns {(t: number) => number}
 */
export function stageCurve(speech, volume = 0.5, rate = 100) {
  const lift = liftFor(volume);
  const n = Math.ceil((Math.max(0, ...speech.map(([, b]) => b)) + 10) * rate) + 1;
  const values = new Float32Array(n);
  const down = 1 - Math.exp(-1 / (rate * ATTACK)); // the share of the way to a target that one sample covers
  const up = 1 - Math.exp(-1 / (rate * RELEASE));
  let g = lift;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    if (speech.some(([a, b]) => t >= a && t < b)) g += (lift * UNDER - g) * down; // a line is being said: step back
    else if (!speech.some(([, b]) => t >= b && t < b + RELEASE_AFTER)) g += (lift - g) * up; // after the pause that follows it: swell
    values[i] = g;
  }
  return (t) => values[Math.min(n - 1, Math.max(0, Math.round(t * rate)))];
}

export class FilmScore {
  /** @param {{ music?: object, seed?: number }} [o] the music engine (the page's by default) and the seed of the piece */
  constructor({ music = engine, seed = SEED } = {}) {
    this.music = music;
    this.seed = seed;
    this.phase = 'idle'; // idle → playing → over
    this.t = 0; // the film's second at the last update
    this.talking = false;
    this.warned = false;
  }

  /** The music engine's volume setting, 0..1. */
  get volume() {
    const s = this.music.state && this.music.state();
    return s && Number.isFinite(s.volume) ? s.volume : 0.5;
  }

  /** The mix stage's gain right now: the lift, stepped back while a line is spoken. */
  get gain() {
    return liftFor(this.volume) * (this.talking ? UNDER : 1);
  }

  /** Begin the overture. The engine remembers it for a browser that has not allowed audio yet and starts it at the first click. */
  start() {
    if (this.phase !== 'idle') return;
    this.phase = 'playing';
    this.guard(() => {
      const m = this.music;
      m.setStingers(false); // the film's own sounds are mixed by this score, not ducked by the engine's rules for a match
      m.conduct(musicAt(LEAD));
      m.setStage(this.gain, ATTACK);
      m.play(THEME, { seed: this.seed, joinAt: () => this.joinAt() });
    });
  }

  /**
   * Where the piece should come in when the engine makes its run: the film's second now, with the story's intensity
   * for each bar of the way, so a browser that allows audio only at a click part-way through the film (a first visit)
   * still plays the sections the story needs, the tune with the god and the titans' battle, not the piece from its first bar.
   * Nothing once the film is over: the title screen's music begins at the start.
   */
  joinAt() {
    return this.phase === 'playing' ? { seconds: this.t, levelAt: barLevel } : null;
  }

  /** True while the score is wanted but the browser has not allowed audio yet: a click would start it (the film shows a hint). */
  waiting() {
    if (this.phase !== 'playing') return false;
    try {
      const s = this.music.state();
      return !!(s && s.waiting);
    } catch {
      return false;
    }
  }

  /** The film is at second t: the intensity of the score follows the story, read `LEAD` seconds on. */
  update(t) {
    if (this.phase !== 'playing') return;
    this.t = t;
    this.guard(() => this.music.conduct(musicAt(t + LEAD)));
  }

  /** The voice began (a line is with the browser) or finished: step back under it, swell again after it. */
  speaking(on) {
    const talking = !!on;
    if (this.phase !== 'playing' || talking === this.talking) return;
    this.talking = talking;
    this.guard(() => {
      if (talking) this.music.setStage(this.gain, ATTACK);
      else this.music.setStage(this.gain, RELEASE, RELEASE_AFTER);
    });
  }

  /**
   * The film is over. `'handover'` (it ran to its end): the piece plays on for the title screen and the lift glides
   * away (a score that never began, for a film left while it loaded, has nothing to hand over). `'cut'` (skipped,
   * failed, too slow): it fades out in the dip to black, so the title screen's own score can come in clean after it.
   */
  end(how = 'handover') {
    if (this.phase === 'over') return;
    const wasPlaying = this.phase === 'playing';
    this.phase = 'over';
    this.talking = false;
    if (!wasPlaying) return;
    this.guard(() => {
      const m = this.music;
      m.setStingers(true);
      if (how === 'cut') {
        m.stop(CUT_FADE);
        m.setStage(1, 0.05, RESET_AFTER); // behind the fade and as the title's own score begins, so it finds the stage as the settings have it
      } else {
        m.setStage(1, GLIDE);
      }
    });
  }

  guard(fn) {
    try {
      fn();
    } catch (err) {
      if (!this.warned) console.warn('[intro] the score failed; the film goes on without it', err);
      this.warned = true;
    }
  }
}

/** A score for the film: see FilmScore. */
export function createFilmScore(options) {
  return new FilmScore(options);
}
