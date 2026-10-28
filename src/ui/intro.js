// The intro film on the page (DESIGN 11.1): a full-screen overlay over the menu that plays the
// film (src/intro/film.js, the real renderer on a set the simulation runs) between letterbox
// bars with a line of text at a time, then hands over to the title screen. Esc (or Enter,
// Space, or the Skip button) cuts it short at any moment, even while it is still loading.
// A voice (src/intro/narrator.js, saying the recorded lines of src/intro/voiceover.js) reads each line aloud as it comes up, unless the player turned that off, and
// the title theme plays under it as a score (src/intro/score.js) that steps back for the voice and swells between.
//
// Sound is the player's to start: a browser keeps audio and speech off until a key press or a click. The page
// asks for it at load (src/audio/sfx.js `init`), and a browser that allows it (a site set to "Sound: Allow") plays the
// film with its sound from the first frame. Where it does not, and the player wants sound (`gate`), the film waits at
// its first frame behind a card, "Press any key or click to begin", and starts with that input, so the score, the voice
// and the effects are there from the first second instead of coming in late at some click.
//
//   if (introWanted({ enabled: settings.intro, search: location.search, ... })) {
//     const intro = playIntro({ root, quality, narrate: settings.narration, volume: settings.volume, gate: true, onHandover: () => showMenu('title') });
//     await intro.done;                                  // 'finished' | 'skipped' | 'failed'
//   }
//
// Light by design: no video files, the film is drawn live; the renderer and the stage load
// only when the film plays, and the renderer's GL context is freed before the title shows.
import { h } from './menu-dom.js';
import { FILM_LENGTH, AUDIO_CUES } from '../intro/script.js';
import { createNarrator } from '../intro/narrator.js';
import { recordedSpeech } from '../intro/voiceover.js';
import { createFilmScore } from '../intro/score.js';
import { sfx } from '../audio/sfx.js';

const SKIP_KEYS = new Set(['Escape', 'Enter', ' ']);
// What is not "any key" on the card that waits for one: Esc skips the film, a modifier alone is no key press to the
// browsers (they do not unlock audio for it), and a browser shortcut (Ctrl+R, F5) is not the player starting the film.
const NOT_A_KEY = /^(Escape|Shift|Control|Alt|AltGraph|Meta|OS|CapsLock|NumLock|ScrollLock|Fn|FnLock|Hyper|Super|Dead|Process|Unidentified|F\d{1,2})$/;
const beginsFilm = (e) => !NOT_A_KEY.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey;
const DIP_MS = 320; // a skip dips to black this fast
const REVEAL_MS = 900; // the black lifts off the title screen this slowly
const SLOW_FRAME = 0.2; // seconds: a film that averages worse than this (5 fps) is dropped
const SLOW_AFTER = 3.5; // film seconds before the speed check starts (the first frames compile shaders)
const SLOW_WINDOW = 24; // frames averaged by the check

/**
 * Whether the film plays on this page load: the player's setting, unless the address says
 * otherwise. `?intro=0` never; `?intro=1` always (screenshots, looking at it on purpose);
 * an invite link (`?join=`), an automated browser and a reduced-motion preference skip it.
 * Without WebGL 2 there is nothing to draw it with.
 * @param {{ enabled?: boolean, search?: string, webdriver?: boolean, reducedMotion?: boolean, webgl2?: boolean }} o
 */
export function introWanted({ enabled = true, search = '', webdriver = false, reducedMotion = false, webgl2 = true } = {}) {
  let q;
  try {
    q = new URLSearchParams(search);
  } catch {
    q = new URLSearchParams('');
  }
  const forced = q.get('intro');
  if (forced === '0' || !webgl2) return false;
  if (forced === '1') return true;
  if (q.has('join') || webdriver || reducedMotion) return false;
  return enabled !== false;
}

/** The renderer and the film: fetched only when the film plays. */
async function defaultLoad() {
  const [{ IntroFilm }, { GameRenderer }] = await Promise.all([import('../intro/film.js'), import('../render/game-renderer.js')]);
  return { IntroFilm, Renderer: GameRenderer };
}

/** Let the browser paint once (a timer covers a hidden tab, where frames do not run). */
function nextPaint() {
  return new Promise((resolve) => {
    const fallback = setTimeout(resolve, 100);
    if (typeof requestAnimationFrame !== 'function') return;
    requestAnimationFrame(() => setTimeout(() => {
      clearTimeout(fallback);
      resolve();
    }, 0));
  });
}

/** True on a screen you touch (there is no key to press, and the card says tap). */
function touchScreen() {
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

function buildOverlay(onSkip) {
  const canvas = h('canvas.mw-intro-canvas', { 'aria-hidden': 'true' });
  const caption = h('p.mw-intro-caption', { 'aria-live': 'polite' });
  const skip = h('button.mw-intro-skip.mw-silent', { type: 'button', onclick: onSkip }, h('kbd', 'Esc'), h('span', 'Skip'));
  // shown while the browser will not play sound (the score) or speak (the voice) until the page has had a click (any click on the film does it)
  const hint = h('p.mw-intro-hint', { 'aria-hidden': 'true' }, 'Click for sound');
  const fade = h('div.mw-intro-fade', { 'aria-hidden': 'true' });
  // the card that holds the film at its first frame while the browser will not allow sound (class is-gated): any key or a click begins it
  const touch = touchScreen();
  const begin = h('button.mw-intro-begin.mw-silent', { type: 'button' },
    h('span.mw-intro-begin-do', touch ? 'Tap to begin' : 'Press any key or click to begin'),
    h('span.mw-intro-begin-note', touch ? 'The film has sound' : 'The film has sound · Esc skips it'));
  const loading = h('div.mw-intro-loading', { role: 'status' }, h('span.mw-intro-mark', 'Mythic War'), h('span.mw-intro-pulse', { 'aria-hidden': 'true' }), begin);
  const root = h('section.mw-intro', { 'aria-label': 'Intro film' },
    canvas,
    h('div.mw-intro-vignette', { 'aria-hidden': 'true' }),
    h('div.mw-intro-bar.is-top', { 'aria-hidden': 'true' }),
    h('div.mw-intro-bar.is-bottom', { 'aria-hidden': 'true' }, caption),
    skip, hint, fade, loading);
  root.id = 'intro-root';
  return { root, canvas, caption, skip, fade };
}

/**
 * Play the film.
 * @param {object} o
 * @param {HTMLElement} [o.root] where the overlay goes (the page's #app)
 * @param {'low'|'medium'|'high'|'ultra'} [o.quality] the renderer's quality tier (the player's setting)
 * @param {() => void} [o.onHandover] called once, behind the black, when the title screen should show
 * @param {boolean} [o.manual] tools and tests drive the film themselves (intro.advance moves it on, intro.draw paints a frame); no frame loop runs
 * @param {boolean} [o.guard] drop the film on a machine too slow to show it
 * @param {boolean} [o.narrate] read each caption aloud (the player's setting): the recorded narration (src/intro/voiceover.js), or the browser's speech synthesis where the clips cannot be had; silent where neither can
 * @param {number} [o.volume] the game's volume setting, 0..1: the voice follows it
 * @param {boolean} [o.gate] the player wants sound: when the browser has not allowed it (it waits for a key press or a click), hold the film at its first frame behind a card until one comes, or until the browser allows it. The page passes it; tools and tests, which drive the film themselves, do not
 * @param {() => Promise<{ IntroFilm: Function, Renderer: Function }>} [o.load]
 * @param {(ms: number) => Promise<void>} [o.wait]
 * @param {{ play: Function, ready?: boolean, supported?: boolean, unlock?: Function, onReady?: (cb: () => void) => (() => void) }} [o.audio] the sound engine (the gate reads `ready` and `supported`, starts it with `unlock` and waits on `onReady`; a stand-in without them never gates)
 * @param {(o: { volume: number, onBlocked: (blocked: boolean) => void, onSpeaking: (speaking: boolean) => void }) => { update: Function, retry: Function, stop: Function }} [o.createVoice] makes the narrator (tests pass a stand-in)
 * @param {(() => { start: Function, update: Function, speaking: Function, end: Function, waiting?: Function })|null} [o.createScore] makes the score under the film, which plays the music engine (tests pass a stand-in, or null for none)
 * @returns {{ done: Promise<'finished'|'skipped'|'failed'>, ready: Promise<void>, skip: () => void, advance: (dt: number) => void, draw: () => void, film: object|null, root: HTMLElement }}
 */
/**
 * The narrator the page uses: the recorded clips through the sound engine, the browser's voice as the fallback.
 * `?voice=browser` in the address uses the browser's voice alone (to compare, and for the tools that check that path).
 */
function filmVoice(o) {
  let browserOnly = false;
  try {
    browserOnly = new URLSearchParams(globalThis.location ? globalThis.location.search : '').get('voice') === 'browser';
  } catch {
    // no address to read (tests)
  }
  return createNarrator(browserOnly ? o : { ...o, speech: recordedSpeech() });
}

export function playIntro({
  root = document.getElementById('app'),
  quality = 'medium',
  onHandover = () => {},
  manual = false,
  guard = true,
  narrate = true,
  volume = 1,
  gate = false,
  load = defaultLoad,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  audio = sfx,
  createVoice = filmVoice,
  createScore = createFilmScore,
} = {}) {
  let state = 'loading'; // loading → playing → leaving → done
  let film = null;
  let raf = 0;
  let outcome = 'finished';
  let finished = null;
  const ui = buildOverlay(() => finish('skipped'));
  root.appendChild(ui.root);
  const done = new Promise((resolve) => (finished = resolve));

  // The gate. `held` is true from the start while the player wants sound and the browser has not allowed it (the page
  // tried at load; a browser that says yes has the context running by now, and a stand-in without `ready` never waits).
  // The card tells the player what it takes, a key press or a click, and the film begins with that input, or at once
  // if the browser allows sound after all (`onReady`: a context that starts a moment late). The film loads behind the
  // card meanwhile, so it starts the instant the input comes.
  let held = gate && audio.supported !== false && audio.ready === false;
  let letBegin = () => {};
  const begun = new Promise((resolve) => (letBegin = resolve));
  let unwatch = () => {};
  function release() {
    if (!held) return;
    held = false;
    unwatch();
    ui.root.classList.remove('is-gated');
    letBegin();
  }
  /** The player pressed a key or clicked: the input the browser wants. Start its audio (it may already have, at the event) and the film. */
  function beginFilm() {
    if (!held) return;
    try {
      if (audio.unlock) audio.unlock();
    } catch {
      // the film goes on without sound; the hint says so
    }
    release();
  }
  if (held) {
    ui.root.classList.add('is-gated');
    if (audio.onReady) unwatch = audio.onReady(release) || unwatch;
  }

  // The score: the title theme, conducted by the film's clock (paint). It begins with the film's first frame, not the
  // loading card: its sections fall on the film's beats, so the piece's clock must start where the film's does, however
  // long the code took to load. It steps back for the voice (below) and swells between the lines.
  const score = createScore ? createScore() : null;

  // The voice: it follows the film's clock (paint), and a click on the film lets a browser that refused to speak
  // before any click start. The hint says so while it is refusing.
  const hushed = { voice: false, score: false }; // who is waiting for a click; the hint is up while either is
  const showHint = () => ui.root.classList.toggle('needs-click', hushed.voice || hushed.score);
  const voice = narrate
    ? createVoice({
      volume,
      onBlocked: (blocked) => {
        hushed.voice = blocked;
        showHint();
      },
      onSpeaking: (on) => score && score.speaking(on),
    })
    : null;
  ui.root.addEventListener('click', () => {
    beginFilm(); // a click on the card (anywhere on the film) is the one the browser wants
    if (voice) voice.retry();
  });

  // The menu underneath never sees a key that skips the film (nor one held down, or pressed again
  // while the black lifts): a second Enter must not press the title screen's Play. On the card that
  // waits for a key every key but Esc begins the film (Enter and Space included, for the card says any key), and Esc skips it.
  const onKey = (e) => {
    if (held && beginsFilm(e)) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) beginFilm();
      return;
    }
    if (!SKIP_KEYS.has(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) finish('skipped');
  };
  const onResize = () => film && film.resize(ui.root.clientWidth || window.innerWidth, ui.root.clientHeight || window.innerHeight);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);

  // ---------------------------------------------------------------- the overlay follows the film

  const shown = { fade: -1, bars: -1, caption: '', alpha: -1 };
  let cue = 0;
  function paint(view) {
    const fade = Math.round(view.fade * 200) / 200;
    if (fade !== shown.fade) {
      shown.fade = fade;
      ui.fade.style.opacity = String(fade);
    }
    const bars = Math.round(view.bars * 200) / 200;
    if (bars !== shown.bars) {
      shown.bars = bars;
      ui.root.style.setProperty('--bars', String(bars));
    }
    const text = view.caption ? view.caption.text : '';
    if (text !== shown.caption) {
      shown.caption = text;
      ui.caption.textContent = text;
    }
    const alpha = view.caption ? Math.round(view.caption.alpha * 100) / 100 : 0;
    if (alpha !== shown.alpha) {
      shown.alpha = alpha;
      ui.caption.style.opacity = String(alpha);
    }
    while (cue < AUDIO_CUES.length && AUDIO_CUES[cue].at <= view.t) {
      const c = AUDIO_CUES[cue++];
      try {
        audio.play(c.name, { volume: c.volume });
      } catch {
        // a sound that cannot play must not stop the film
      }
    }
    if (score) {
      score.update(view.t);
      const waiting = score.waiting ? score.waiting() : false;
      if (waiting !== hushed.score) {
        hushed.score = waiting;
        showHint();
      }
    }
    if (voice) voice.update(view.t);
  }

  // ---------------------------------------------------------------- the frame loop

  let last = 0;
  let slowSum = 0;
  let slowFrames = 0;
  /** The film (and the overlay with it) moves on by dt seconds; the end of the film leaves. */
  function tick(dt) {
    film.advance(dt);
    paint(film.view);
    if (film.done) finish('finished');
  }
  function frame(ts) {
    if (state !== 'playing') return;
    raf = requestAnimationFrame(frame);
    const raw = last ? (ts - last) / 1000 : 0;
    last = ts;
    try {
      film.advance(Math.min(0.1, Math.max(0, raw)));
      film.draw(ts);
      paint(film.view);
    } catch (err) {
      console.warn('[intro] a frame failed; leaving the film', err);
      finish('failed');
      return;
    }
    if (film.done) {
      finish('finished');
      return;
    }
    // A machine that cannot keep five frames a second should not sit through a slide show. A gap
    // (a tab left and come back to) counts for at most half a second, so one pause is not "slow".
    if (guard && film.t > SLOW_AFTER) {
      slowSum += Math.min(raw, 0.5);
      slowFrames++;
      if (slowFrames >= SLOW_WINDOW) {
        if (slowSum / slowFrames > SLOW_FRAME) finish('skipped');
        slowSum = 0;
        slowFrames = 0;
      }
    }
  }

  // ---------------------------------------------------------------- loading

  const ready = (async () => {
    try {
      const { IntroFilm, Renderer } = await load();
      if (state !== 'loading') return;
      await nextPaint(); // the title card reaches the screen before the renderer builds its scene in one go
      if (state !== 'loading') return;
      film = new IntroFilm({ canvas: ui.canvas, Renderer, quality });
      film.resize(ui.root.clientWidth || window.innerWidth, ui.root.clientHeight || window.innerHeight);
      film.advance(0.001); // the first frame (shader compiling) happens behind the card
      film.draw(0);
      paint(film.view);
      await nextPaint();
      if (state !== 'loading') return;
      if (held) {
        await begun; // held at the first frame behind the card until a key press, a click, or the browser allowing sound (or a skip, which ends the wait too)
        if (state !== 'loading') return;
      }
      state = 'playing';
      ui.root.classList.add('is-playing');
      if (score) score.start();
      if (!manual) raf = requestAnimationFrame(frame);
    } catch (err) {
      console.warn('[intro] the film could not start', err);
      finish('failed');
    }
  })();

  // ---------------------------------------------------------------- leaving

  function finish(reason) {
    if (state === 'leaving' || state === 'done') return;
    const wasPlaying = state === 'playing';
    state = 'leaving';
    outcome = reason;
    release(); // a film still held at its card ends the wait, so `ready` settles
    // The score and the voice go first, before the dip to black: a film cut short fades its music out inside the dip
    // (the title's own comes in after it); one that ran to its end, or never began to show, leaves its music playing.
    // The score is told first, so the cut-off voice's last word does not make it swell again.
    if (score) score.end(wasPlaying && reason !== 'finished' ? 'cut' : 'handover');
    if (voice) voice.stop();
    if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    raf = 0;
    leave(wasPlaying && reason !== 'finished').catch((err) => console.warn('[intro] leaving failed', err));
  }

  async function leave(dip) {
    if (dip) {
      ui.root.classList.add('is-skipping');
      await wait(DIP_MS);
    }
    ui.root.classList.add('is-black'); // the picture is gone: the card is solid black before the renderer goes
    if (film) {
      try {
        film.dispose();
      } catch (err) {
        console.warn('[intro] disposing the film failed', err);
      }
      film = null;
    }
    ui.canvas.remove();
    try {
      onHandover();
    } catch (err) {
      console.error('[intro] the hand-over failed', err);
    }
    ui.root.classList.add('is-revealing');
    await wait(REVEAL_MS);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    ui.root.remove();
    state = 'done';
    finished(outcome);
  }

  return {
    done,
    ready,
    root: ui.root,
    skip: () => finish('skipped'),
    advance(dt) {
      if (film && state === 'playing') tick(dt);
    },
    draw() {
      if (film && state === 'playing') film.draw(0);
    },
    get film() {
      return film;
    },
    get length() {
      return FILM_LENGTH;
    },
  };
}
