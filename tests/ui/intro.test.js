// The intro film on the page (src/ui/intro.js): when it plays, the overlay that follows the film, and the
// ways out of it (Esc, Enter, Space, the Skip button, the end, a failure) that must all hand over to the
// title screen exactly once, and silence the narration as they do. A fake DOM and a stand-in film; the real
// film is looked at in tools/shot-intro.mjs.
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { FILM_LENGTH, AUDIO_CUES, CAPTIONS, fadeAt, barsAt, captionAt } from '../../src/intro/script.js';

let introWanted;
let playIntro;
let docListeners;
let winListeners;
let warnings;
const realWarn = console.warn;
const realError = console.error;

before(async () => {
  installFakeDom();
  // menu-dom's h() asks `instanceof Node`; the fake nodes carry a nodeType instead.
  globalThis.Node = class {
    static [Symbol.hasInstance](x) {
      return !!x && (x.nodeType === 1 || x.nodeType === 3);
    }
  };
  ({ introWanted, playIntro } = await import('../../src/ui/intro.js'));
});

beforeEach(() => {
  docListeners = [];
  winListeners = [];
  globalThis.document.addEventListener = (type, fn, capture) => docListeners.push({ type, fn, capture });
  globalThis.document.removeEventListener = (type, fn) => {
    docListeners = docListeners.filter((l) => !(l.type === type && l.fn === fn));
  };
  globalThis.window.addEventListener = (type, fn) => winListeners.push({ type, fn });
  globalThis.window.removeEventListener = (type, fn) => {
    winListeners = winListeners.filter((l) => !(l.type === type && l.fn === fn));
  };
  warnings = [];
  console.warn = (...a) => warnings.push(a.map(String).join(' '));
  console.error = (...a) => warnings.push(a.map(String).join(' '));
});

afterEach(() => {
  console.warn = realWarn;
  console.error = realError;
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
});

// ---------------------------------------------------------------- stand-ins

/** The film, as far as the page can tell: a clock, a view for the overlay, a canvas it was given and a dispose. */
class FakeFilm {
  constructor({ canvas, quality }) {
    this.canvas = canvas;
    this.quality = quality;
    this.t = 0;
    this.view = { t: 0, fade: 1, bars: 0, caption: null };
    this.drawn = 0;
    this.size = null;
    this.disposed = false;
    this.log = FakeFilm.log;
    FakeFilm.made.push(this);
  }
  get done() {
    return this.t >= FILM_LENGTH;
  }
  advance(dt) {
    if (FakeFilm.throwOn !== null && this.t >= FakeFilm.throwOn) throw new Error('the film broke');
    this.t = Math.min(FILM_LENGTH, this.t + dt);
    this.view = { t: this.t, fade: fadeAt(this.t), bars: barsAt(this.t), caption: captionAt(this.t) };
  }
  draw() {
    this.drawn++;
  }
  resize(w, h) {
    this.size = [w, h];
  }
  dispose() {
    this.disposed = true;
    this.log.push('dispose');
  }
}
FakeFilm.made = [];
FakeFilm.log = [];
FakeFilm.throwOn = null;

/** A wait() the test releases by hand, so the dip and the reveal can be looked at between. */
function gate() {
  const pending = [];
  const fn = (ms) => new Promise((resolve) => pending.push({ ms, resolve }));
  fn.pending = pending;
  fn.release = async () => {
    const p = pending.shift();
    assert.ok(p, 'something is waiting');
    p.resolve();
    await tick();
    return p.ms;
  };
  return fn;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function start(o = {}) {
  FakeFilm.made = [];
  FakeFilm.log = [];
  FakeFilm.throwOn = null;
  const root = document.createElement('div');
  const handovers = [];
  const plays = [];
  const intro = playIntro({
    root,
    manual: true,
    guard: false,
    quality: 'high',
    load: async () => ({ IntroFilm: FakeFilm, Renderer: class {} }),
    wait: () => Promise.resolve(),
    audio: { play: (name, opts) => plays.push([name, opts.volume]) },
    onHandover: () => handovers.push(FakeFilm.log.length),
    ...o,
  });
  const overlay = root.children[0];
  return { intro, root, overlay, handovers, plays, find: (cls) => overlay.find(cls) };
}

/** A keydown as the page's capture listener would get it; returns the event so the test can see what it did to it. */
function press(key, extra = {}) {
  const ev = { key, repeat: false, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
  for (const l of docListeners.filter((x) => x.type === 'keydown')) l.fn(ev);
  return ev;
}

/** A frame loop the test turns by hand (requestAnimationFrame in Node). */
function fakeFrames() {
  let id = 0;
  let queue = [];
  globalThis.requestAnimationFrame = (cb) => {
    queue.push({ id: ++id, cb });
    return id;
  };
  globalThis.cancelAnimationFrame = (i) => {
    queue = queue.filter((q) => q.id !== i);
  };
  return {
    pump(ts) {
      const run = queue;
      queue = [];
      for (const q of run) q.cb(ts);
    },
    get waiting() {
      return queue.length;
    },
  };
}

// ---------------------------------------------------------------- whether it plays

test('introWanted: the player\'s setting decides, the address and the machine can say otherwise', () => {
  assert.equal(introWanted(), true, 'on by default');
  assert.equal(introWanted({ enabled: true }), true);
  assert.equal(introWanted({ enabled: false }), false, 'the setting turns it off');
  assert.equal(introWanted({ enabled: true, search: '?intro=0' }), false, '?intro=0 never');
  assert.equal(introWanted({ enabled: false, search: '?intro=1' }), true, '?intro=1 always (screenshots, looking at it on purpose)');
  assert.equal(introWanted({ enabled: true, search: '?x=1&intro=0&y=2' }), false);
  assert.equal(introWanted({ search: '?join=ABCDE' }), false, 'an invite link goes straight to the lobby');
  assert.equal(introWanted({ search: '?join=ABCDE&intro=1' }), true, 'unless asked');
  assert.equal(introWanted({ webdriver: true }), false, 'an automated browser (the e2e tests) never waits for it');
  assert.equal(introWanted({ webdriver: true, search: '?intro=1' }), true);
  assert.equal(introWanted({ reducedMotion: true }), false, 'a reduced-motion preference skips a film of camera moves');
  assert.equal(introWanted({ webgl2: false }), false, 'nothing to draw it with');
  assert.equal(introWanted({ webgl2: false, search: '?intro=1' }), false);
  assert.equal(introWanted({ search: 'garbage%' }), true);
});

// ---------------------------------------------------------------- the overlay

test('the overlay covers the page at once with a loading card, and the film comes up behind it', async () => {
  const { intro, root, overlay, find } = start();
  assert.ok(overlay && overlay.className.includes('mw-intro'), 'the overlay is on the page');
  assert.equal(overlay.id, 'intro-root');
  assert.equal(overlay.getAttribute('aria-label'), 'Intro film');
  assert.ok(find('mw-intro-loading').textContent.includes('Mythic War'), 'the card says what is loading');
  assert.equal(find('mw-intro-skip').textContent, 'EscSkip');
  assert.equal(overlay.classList.contains('is-playing'), false);
  assert.equal(FakeFilm.made.length, 0, 'no film until the code has loaded');
  await intro.ready;
  assert.equal(overlay.classList.contains('is-playing'), true);
  assert.equal(FakeFilm.made.length, 1);
  const film = FakeFilm.made[0];
  assert.equal(film.quality, 'high', 'the player\'s quality tier');
  assert.equal(film.canvas, find('mw-intro-canvas'), 'drawn on the overlay\'s canvas');
  assert.deepEqual(film.size, [1280, 720], 'sized to the page');
  assert.equal(film.drawn, 1, 'the first frame was drawn behind the card');
  assert.equal(root.children.length, 1);
  assert.equal(intro.film, film);
  assert.equal(intro.length, FILM_LENGTH);
  intro.skip();
  await intro.done;
});

test('the overlay follows the film: the fade, the bars, the caption and its fade', async () => {
  const { intro, find, overlay } = start();
  await intro.ready;
  const fade = find('mw-intro-fade');
  const caption = find('mw-intro-caption');
  assert.equal(fade.style.opacity, '1', 'opens on black');
  assert.equal(overlay.style.getPropertyValue('--bars'), '0');
  for (let t = 0; t < 5; t += 0.1) intro.advance(0.1);
  assert.equal(fade.style.opacity, '0', 'the picture is clear');
  assert.equal(overlay.style.getPropertyValue('--bars'), '1', 'the bars have closed');
  assert.equal(caption.textContent, 'Raise a city of the faithful');
  assert.equal(caption.style.opacity, '1');
  for (let t = 5; t < 8.4; t += 0.1) intro.advance(0.1);
  assert.equal(caption.textContent, '', 'no line between lines');
  assert.equal(caption.style.opacity, '0');
  intro.skip();
  await intro.done;
});

test('the film\'s sounds play once each, in time, at their volume', async () => {
  const { intro, plays } = start();
  await intro.ready;
  assert.deepEqual(plays, [], 'nothing before its time');
  intro.advance(0.1);
  let t = 0.1;
  while (t < 0.7) {
    intro.advance(0.1);
    t += 0.1;
  }
  assert.deepEqual(plays, [[AUDIO_CUES[0].name, AUDIO_CUES[0].volume]], 'the first horn');
  while (t < FILM_LENGTH - 0.3) {
    intro.advance(0.1);
    t += 0.1;
  }
  assert.deepEqual(plays.map((p) => p[0]), AUDIO_CUES.map((c) => c.name), 'all of them, in order, once');
  assert.deepEqual(plays.map((p) => p[1]), AUDIO_CUES.map((c) => c.volume));
  intro.skip();
  await intro.done;
});

test('a sound that cannot play does not stop the film', async () => {
  const { intro } = start({ audio: { play: () => { throw new Error('no audio'); } } });
  await intro.ready;
  for (let i = 0; i < 30; i++) intro.advance(0.1);
  assert.ok(FakeFilm.made[0].t > 2.9, 'the film ran on');
  intro.skip();
  assert.equal(await intro.done, 'skipped');
});

test('the film is sized again when the window is', async () => {
  const { intro } = start();
  await intro.ready;
  const resize = winListeners.find((l) => l.type === 'resize');
  assert.ok(resize, 'it listens for resizes');
  globalThis.window.innerWidth = 900;
  globalThis.window.innerHeight = 500;
  resize.fn();
  assert.deepEqual(FakeFilm.made[0].size, [900, 500]);
  globalThis.window.innerWidth = 1280;
  globalThis.window.innerHeight = 720;
  intro.skip();
  await intro.done;
});

// ---------------------------------------------------------------- the narration

/** A stand-in narrator factory: what the page makes it with, tells it, and the calls it gets. */
function fakeVoice() {
  const v = { made: null, updates: [], retries: 0, stops: 0 };
  v.create = (o) => {
    v.made = o;
    return { update: (t) => v.updates.push(t), retry: () => v.retries++, stop: () => v.stops++ };
  };
  return v;
}

/** The browser's speech synthesis in Node: what it is asked to say (and when the page shows which caption), until `restore()`. */
function fakeBrowserSpeech({ allowed = true, caption = () => '' } = {}) {
  const had = ['speechSynthesis', 'SpeechSynthesisUtterance'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  const spoken = [];
  const synth = {
    allowed,
    speaking: false,
    pending: false,
    speak(u) {
      spoken.push({ text: u.text, caption: caption(), volume: u.volume, allowed: synth.allowed });
      if (!synth.allowed) u.onerror({ error: 'not-allowed' });
      else {
        synth.speaking = true;
        u.onstart({});
      }
    },
    cancel() {
      spoken.push('cancel');
      synth.speaking = false;
    },
  };
  globalThis.speechSynthesis = synth;
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  return {
    synth,
    spoken,
    restore() {
      for (const [k, d] of had) {
        delete globalThis[k];
        if (d) Object.defineProperty(globalThis, k, d);
      }
    },
  };
}

test('the narration says what the caption on screen says, as the caption comes up, and is cut at the end', async () => {
  let caption = null;
  const speech = fakeBrowserSpeech({ caption: () => caption.textContent });
  try {
    const { intro, find } = start({ volume: 0.5 });
    caption = find('mw-intro-caption');
    await intro.ready;
    const film = FakeFilm.made[0];
    while (!film.done) intro.advance(0.1);
    await intro.done;
    const said = speech.spoken.filter((s) => s !== 'cancel');
    assert.deepEqual(said.map((s) => s.text), CAPTIONS.map((c) => c.text), 'every caption of the script, once, in order');
    for (const s of said) assert.equal(s.caption, s.text, `"${s.text}" is on the screen while it is said`);
    assert.ok(said.every((s) => s.volume === 0.5), 'at the game\'s volume');
    assert.equal(speech.spoken.at(-1), 'cancel', 'and the voice is cut as the film ends');
  } finally {
    speech.restore();
  }
});

test('Esc silences the narration in the same breath, before the dip to black is over', async () => {
  const speech = fakeBrowserSpeech();
  try {
    const wait = gate();
    const { intro } = start({ wait });
    await intro.ready;
    for (let i = 0; i < 20; i++) intro.advance(0.1); // 2 s: the first line is being said
    assert.equal(speech.spoken.length, 1);
    assert.equal(speech.synth.speaking, true);
    press('Escape');
    assert.equal(speech.spoken.at(-1), 'cancel', 'cut at once');
    assert.equal(speech.synth.speaking, false);
    assert.equal(wait.pending.length, 1, 'while the dip to black is still waiting: the voice did not wait for it');
    for (let i = 0; i < 120; i++) intro.advance(0.1); // the film is leaving: its clock no longer moves, and nothing is said
    await wait.release();
    await wait.release();
    assert.equal(await intro.done, 'skipped');
    assert.equal(speech.spoken.filter((s) => s !== 'cancel').length, 1, 'nothing said after the skip');
  } finally {
    speech.restore();
  }
});

test('every way out of the film stops the voice: the keys, the button, skip(), the end, a failure to load, a frame that throws', async () => {
  const exits = {
    Escape: () => press('Escape'),
    Enter: () => press('Enter'),
    Space: () => press(' '),
    'the Skip button': ({ find }) => find('mw-intro-skip').click(),
    'skip()': ({ intro }) => intro.skip(),
    'the end of the film': ({ intro }) => {
      while (!FakeFilm.made[0].done) intro.advance(0.1);
    },
    'a frame that throws': ({ frames }) => {
      FakeFilm.throwOn = 0;
      frames.pump(2000);
    },
  };
  for (const [label, exit] of Object.entries(exits)) {
    const voice = fakeVoice();
    const frames = fakeFrames();
    const run = start({ createVoice: voice.create, manual: label !== 'a frame that throws' });
    await run.intro.ready;
    run.intro.advance(1.5);
    if (label === 'a frame that throws') frames.pump(1000);
    assert.equal(voice.stops, 0, `${label}: not before`);
    exit({ ...run, frames });
    assert.equal(voice.stops, 1, `${label}: the voice is stopped as the film is left`);
    await run.intro.done;
    assert.equal(voice.stops, 1, `${label}: once`);
  }
  const voice = fakeVoice();
  const failed = start({ createVoice: voice.create, load: async () => { throw new Error('the module did not load'); } });
  assert.equal(await failed.intro.done, 'failed');
  assert.equal(voice.stops, 1, 'a film that cannot start stops the voice too');
});

test('the voice is on the film\'s clock: it is told the film\'s second each frame, and the game\'s volume', async () => {
  const voice = fakeVoice();
  const { intro } = start({ createVoice: voice.create, volume: 0.35 });
  await intro.ready;
  assert.equal(voice.made.volume, 0.35);
  const first = voice.updates.length; // the first frame, drawn behind the card
  intro.advance(0.1);
  intro.advance(0.1);
  intro.advance(0.1);
  assert.equal(voice.updates.length, first + 3);
  assert.ok(Math.abs(voice.updates.at(-1) - FakeFilm.made[0].t) < 1e-9, 'it hears the film\'s own second');
  assert.ok(voice.updates.every((t, i) => !i || t >= voice.updates[i - 1]), 'forward in time');
  intro.skip();
  await intro.done;
});

test('narration off: no voice is made, and the browser is never asked to speak', async () => {
  const speech = fakeBrowserSpeech();
  try {
    const voice = fakeVoice();
    const run = start({ narrate: false, createVoice: voice.create });
    await run.intro.ready;
    for (let i = 0; i < 40; i++) run.intro.advance(0.1);
    run.overlay.click();
    press('Escape');
    await run.intro.done;
    assert.equal(voice.made, null, 'no voice');
    const plain = start({ narrate: false });
    await plain.intro.ready;
    for (let i = 0; i < 40; i++) plain.intro.advance(0.1);
    plain.intro.skip();
    await plain.intro.done;
    assert.deepEqual(speech.spoken, [], 'with the real narrator on the page, not a word and not even a cancel');
  } finally {
    speech.restore();
  }
});

test('a browser that will not speak before a click: a hint, and any click on the film starts the voice at the caption on screen', async () => {
  let caption = null;
  const speech = fakeBrowserSpeech({ allowed: false, caption: () => caption.textContent });
  try {
    const { intro, overlay, find } = start();
    caption = find('mw-intro-caption');
    assert.equal(find('mw-intro-hint').textContent, 'Click for narration');
    await intro.ready;
    assert.equal(overlay.classList.contains('needs-click'), false, 'no hint while nothing has been refused');
    const said = () => speech.spoken.filter((s) => s !== 'cancel');
    for (let i = 0; i < 30; i++) intro.advance(0.1); // 3 s: the first line was refused at 1.4
    assert.equal(said().length, 1);
    assert.equal(overlay.classList.contains('needs-click'), true, 'the hint is up');
    speech.synth.allowed = true;
    overlay.click(); // a click anywhere on the film
    assert.equal(overlay.classList.contains('needs-click'), false, 'and goes at once');
    assert.equal(said().length, 2);
    assert.equal(said()[1].text, CAPTIONS[0].text, 'the line on screen is said now');
    assert.equal(said()[1].caption, CAPTIONS[0].text);
    for (let i = 0; i < 80; i++) intro.advance(0.1); // on to 11 s: the second line is said without another click
    assert.equal(said()[2].text, CAPTIONS[1].text);
    assert.equal(overlay.classList.contains('needs-click'), false);
    overlay.click();
    assert.equal(said().length, 3, 'a click on a working voice does nothing');
    intro.skip();
    await intro.done;
  } finally {
    speech.restore();
  }
});

test('the hint follows the narrator\'s word, clicks go to the narrator, and the hint is for the eye alone', async () => {
  const voice = fakeVoice();
  const { intro, overlay, find } = start({ createVoice: voice.create });
  await intro.ready;
  voice.made.onBlocked(true);
  assert.equal(overlay.classList.contains('needs-click'), true);
  voice.made.onBlocked(false);
  assert.equal(overlay.classList.contains('needs-click'), false);
  assert.equal(find('mw-intro-hint').getAttribute('aria-hidden'), 'true', 'a hint for a click, not for a screen reader (the captions are read to it)');
  overlay.click();
  overlay.click();
  assert.equal(voice.retries, 2, 'each click goes to the voice');
  intro.skip();
  await intro.done;
});

// ---------------------------------------------------------------- the ways out

test('the end of the film: hands over to the title once, behind black, and cleans up after itself', async () => {
  const wait = gate();
  const { intro, root, overlay, handovers } = start({ wait });
  await intro.ready;
  const film = FakeFilm.made[0];
  const canvas = film.canvas;
  let blackAtDispose = null;
  const dispose = film.dispose.bind(film);
  film.dispose = () => {
    blackAtDispose = overlay.classList.contains('is-black');
    dispose();
  };
  while (!film.done) intro.advance(0.1);
  await tick();
  // a film that ran to its end has faded to black by itself: no dip of its own
  assert.equal(overlay.classList.contains('is-skipping'), false);
  assert.equal(overlay.classList.contains('is-black'), true);
  assert.equal(blackAtDispose, true, 'the renderer was freed behind the black');
  assert.equal(film.disposed, true);
  assert.equal(canvas.parentNode, null, 'the film\'s canvas is gone');
  assert.deepEqual(handovers, [1], 'handed over once, after the renderer was freed');
  assert.equal(overlay.classList.contains('is-revealing'), true, 'the black lifts off the title');
  assert.equal(root.children.length, 1, 'the overlay stays while the black lifts');
  assert.equal(await wait.release(), 900);
  assert.equal(await intro.done, 'finished');
  assert.equal(root.children.length, 0, 'then it is gone');
  assert.equal(intro.film, null);
  assert.equal(docListeners.length, 0, 'the key listener is gone');
  assert.equal(winListeners.length, 0, 'and the resize listener');
  assert.deepEqual(handovers, [1]);
  intro.advance(0.1); // after the end the page may still call: nothing happens
  intro.draw();
});

for (const [label, key] of [['Escape', 'Escape'], ['Enter', 'Enter'], ['Space', ' ']]) {
  test(`${label} skips the film: a quick dip to black, then the title`, async () => {
    const wait = gate();
    const { intro, overlay, handovers } = start({ wait });
    await intro.ready;
    intro.advance(0.5);
    const ev = press(key);
    assert.equal(ev.prevented && ev.stopped, true, 'the title screen under it never sees the key');
    await tick();
    assert.equal(overlay.classList.contains('is-skipping'), true, 'dipping');
    assert.equal(overlay.classList.contains('is-black'), false);
    assert.equal(FakeFilm.made[0].disposed, false, 'the renderer waits for the black');
    assert.deepEqual(handovers, [], 'the title is not shown yet');
    assert.equal(await wait.release(), 320);
    assert.equal(overlay.classList.contains('is-black'), true);
    assert.equal(FakeFilm.made[0].disposed, true);
    assert.deepEqual(handovers, [1]);
    assert.equal(await wait.release(), 900);
    assert.equal(await intro.done, 'skipped');
    assert.equal(docListeners.length, 0);
  });
}

test('other keys leave the film alone, and a held key does not skip twice or reach the title', async () => {
  const wait = gate();
  const { intro, handovers } = start({ wait });
  await intro.ready;
  for (const key of ['a', 'Tab', 'ArrowLeft', 'p', 'F5']) {
    const ev = press(key);
    assert.equal(ev.prevented || ev.stopped, false, `${key} is the page's`);
  }
  assert.equal(wait.pending.length, 0, 'still playing');
  const held = press('Escape', { repeat: true });
  assert.equal(held.prevented && held.stopped, true, 'a held key is swallowed');
  assert.equal(wait.pending.length, 0, 'but does not skip: it was held from before the film');
  press('Escape');
  await tick();
  assert.equal(wait.pending.length, 1, 'now it dips');
  // a second Enter while the black lifts must not press the title screen's Play
  const again = press('Enter');
  assert.equal(again.prevented && again.stopped, true);
  await wait.release();
  const third = press('Escape');
  assert.equal(third.prevented && third.stopped, true, 'swallowed during the reveal too');
  assert.deepEqual(handovers, [1], 'one hand-over');
  await wait.release();
  assert.equal(await intro.done, 'skipped');
});

test('the Skip button skips, like Esc', async () => {
  const { intro, find, handovers } = start();
  await intro.ready;
  find('mw-intro-skip').click();
  assert.equal(await intro.done, 'skipped');
  assert.deepEqual(handovers, [1]);
});

test('a skip while the film is still loading: no dip, no film, straight to the title', async () => {
  let release;
  const wait = gate();
  const { intro, overlay, handovers } = start({
    wait,
    load: () => new Promise((resolve) => (release = () => resolve({ IntroFilm: FakeFilm, Renderer: class {} }))),
  });
  press('Escape');
  await tick();
  assert.equal(overlay.classList.contains('is-skipping'), false, 'nothing to dip: the card is up');
  assert.equal(overlay.classList.contains('is-black'), true);
  assert.deepEqual(handovers, [0], 'the title shows at once');
  release(); // the code arrives late
  await intro.ready;
  assert.equal(FakeFilm.made.length, 0, 'and no film is built for nobody');
  await wait.release();
  assert.equal(await intro.done, 'skipped');
});

test('a skip while the film\'s first frame is being made drops the film cleanly', async () => {
  // Escape arrives between the film's construction and the page's second paint
  const { intro, handovers } = start({ load: async () => ({ IntroFilm: class extends FakeFilm { constructor(o) { super(o); queueMicrotask(() => press('Escape')); } }, Renderer: class {} }) });
  assert.equal(await intro.done, 'skipped');
  assert.deepEqual(handovers.length, 1, 'handed over once');
  assert.ok(FakeFilm.made.every((f) => f.disposed), 'no renderer is left running');
});

test('a film that cannot load or start is dropped: the title shows, once', async () => {
  const a = start({ load: async () => { throw new Error('the module did not load'); } });
  assert.equal(await a.intro.done, 'failed');
  assert.equal(a.handovers.length, 1);
  assert.ok(warnings.some((w) => /could not start/.test(w)));

  const b = start({ load: async () => ({ IntroFilm: class { constructor() { throw new Error('no WebGL'); } }, Renderer: class {} }) });
  assert.equal(await b.intro.done, 'failed');
  assert.equal(b.handovers.length, 1);
  assert.equal(b.root.children.length, 0, 'the overlay is gone');
});

test('a hand-over that throws does not strand the player behind the black', async () => {
  const { intro } = start({ onHandover: () => { throw new Error('menu broke'); } });
  await intro.ready;
  intro.skip();
  assert.equal(await intro.done, 'skipped');
  assert.ok(warnings.some((w) => /hand-over failed/.test(w)), 'and says so');
});

test('a disposal that throws does not either', async () => {
  const { intro, handovers } = start();
  await intro.ready;
  FakeFilm.made[0].dispose = () => { throw new Error('context already lost'); };
  intro.skip();
  assert.equal(await intro.done, 'skipped');
  assert.equal(handovers.length, 1);
});

// ---------------------------------------------------------------- the frame loop

test('the frame loop runs the film at the page\'s pace, a long gap counting for at most a tenth of a second', async () => {
  const frames = fakeFrames();
  const { intro } = start({ manual: false });
  await intro.ready;
  const film = FakeFilm.made[0];
  assert.equal(frames.waiting >= 1, true, 'the loop is running');
  frames.pump(1000); // the first frame has no earlier one to measure from
  assert.equal(film.t > 0.0009 && film.t < 0.002, true, 'only the first frame\'s nudge');
  frames.pump(1016);
  assert.ok(Math.abs(film.t - 0.017) < 0.002, `one 16 ms frame: ${film.t}`);
  frames.pump(6016); // five seconds later: a tab that was in the background
  assert.ok(Math.abs(film.t - 0.117) < 0.002, `the long gap counts for 0.1 s: ${film.t}`);
  assert.ok(film.drawn >= 4);
  intro.skip();
  await intro.done;
  assert.equal(frames.waiting, 0, 'the loop stopped with the film');
});

test('the frame loop ends the film at its end', async () => {
  const frames = fakeFrames();
  const { intro, handovers } = start({ manual: false });
  await intro.ready;
  let ts = 1000;
  for (let i = 0; i < 700 && frames.waiting; i++) {
    frames.pump(ts);
    ts += 80;
  }
  assert.equal(await intro.done, 'finished');
  assert.equal(handovers.length, 1);
  assert.equal(frames.waiting, 0);
});

test('a frame that throws drops the film and shows the title', async () => {
  const frames = fakeFrames();
  const { intro, handovers } = start({ manual: false });
  await intro.ready;
  frames.pump(1000);
  frames.pump(1016);
  FakeFilm.throwOn = 0; // from now on, advance throws
  frames.pump(1032);
  assert.equal(await intro.done, 'failed');
  assert.equal(handovers.length, 1);
  assert.ok(warnings.some((w) => /a frame failed/.test(w)));
});

test('a machine too slow for the film skips it; a fast one, a hiccup and a guard turned off do not', async () => {
  /** Turn the frame loop `n` frames, `gap` seconds apart (frame `hiccupAt` coming `hiccup` seconds late); what the page had decided by then. */
  const drive = async ({ gap, guard = true, n = 400, hiccupAt = -1, hiccup = 10 }) => {
    const loop = fakeFrames();
    const { intro } = start({ manual: false, guard });
    await intro.ready;
    let outcome = null;
    intro.done.then((o) => (outcome = o));
    let ts = 1000;
    for (let i = 0; i < n && loop.waiting; i++) {
      loop.pump(ts);
      ts += (i === hiccupAt ? hiccup : gap) * 1000;
    }
    await tick();
    const result = { outcome, t: FakeFilm.made[0].t };
    if (outcome === null) {
      intro.skip();
      await intro.done;
    }
    return result;
  };
  const slow = await drive({ gap: 0.3 });
  assert.equal(slow.outcome, 'skipped', 'three frames a second: a slide show, not a film');
  assert.ok(slow.t > 3.5 && slow.t < 10, `judged after the first seconds, not at once: ${slow.t}`);
  assert.equal((await drive({ gap: 0.3, guard: false, n: 150 })).outcome, null, 'the guard can be turned off (a film the player asked to watch)');
  const fast = await drive({ gap: 0.017 });
  assert.equal(fast.outcome, null, 'a fast machine plays on');
  assert.ok(fast.t > 5, `well past the point where the guard judges: ${fast.t}`);
  const hiccup = await drive({ gap: 0.03, hiccupAt: 150 });
  assert.equal(hiccup.outcome, null, 'one long gap (a tab left and come back to) is not a slow machine');
  assert.ok(hiccup.t > 3.5);
});
