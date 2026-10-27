// The score under the intro film (src/intro/score.js): which piece it plays, that the story's curve conducts it a bar
// ahead, that it steps back for the voice and swells between the lines, and that it leaves the way the film does
// (carried on into the title screen, or faded out inside the dip to black). First against a stand-in for the music
// engine (what it is told, and in what order); then through the real engine on a strict fake audio context, with the
// real narrator and a stand-in for the browser's speech, over the whole film: the mix, second by second.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext } from '../audio/fake-audio.js';
import { sfx } from '../../src/audio/sfx.js';
import { MusicEngine, COMPOSE_AHEAD } from '../../src/audio/music.js';
import { barSeconds } from '../../src/audio/music-composer.js';
import { THEMES } from '../../src/audio/music-themes.js';
import { TITLE_INTENSITY } from '../../src/audio/audio.js';
import { Narrator } from '../../src/intro/narrator.js';
import { FILM_LENGTH, CAPTIONS, AUDIO_CUES, SCORE_END, musicAt } from '../../src/intro/script.js';
import { FilmScore, createFilmScore, THEME, SEED, LIFT, UNDER, LEAD, barLevel, liftFor, stageCurve } from '../../src/intro/score.js';

const realWarn = console.warn;
let warnings;
beforeEach(() => {
  warnings = [];
  console.warn = (...a) => warnings.push(a.map(String).join(' '));
});
afterEach(() => {
  console.warn = realWarn;
});

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------- against a stand-in for the engine

/** A stand-in for the music engine that writes down what it is told. */
function recorder({ volume = 0.5, waiting = false } = {}) {
  const calls = [];
  const note = (name) => (...args) => calls.push([name, ...args]);
  return {
    calls,
    volume,
    waiting,
    state() {
      return { volume: this.volume, waiting: this.waiting };
    },
    conduct: note('conduct'),
    setStage: note('setStage'),
    setStingers: note('setStingers'),
    play: note('play'),
    stop: note('stop'),
  };
}

test('the piece is the title theme with a seed that fixes it, and the film settles to the title\'s own level', () => {
  assert.equal(THEME, 'menu', 'the title screen goes on playing the very piece the film played');
  assert.ok(THEMES[THEME], 'a theme that exists');
  assert.ok(Number.isInteger(SEED) && SEED > 0);
  assert.equal(SCORE_END, TITLE_INTENSITY, 'the last frame is at the title screen\'s intensity: no seam when the music goes on');
  assert.equal(new FilmScore({ music: recorder() }).seed, SEED, 'the same overture on every visit');
  assert.equal(new FilmScore({ music: recorder(), seed: 5 }).seed, 5);
});

test('LEAD: the story is read as far ahead as a bar is composed ahead of its sound, to its middle', () => {
  assert.equal(LEAD, COMPOSE_AHEAD + THEMES[THEME].bar / 2);
  assert.ok(LEAD > 2 && LEAD < 6);
  assert.equal(barLevel(0), musicAt(THEMES[THEME].bar / 2));
  assert.equal(barLevel(20), musicAt(20 + THEMES[THEME].bar / 2));
});

test('liftFor: lifted above the settings\' level, but never past what the Music slider\'s top would give', () => {
  assert.equal(liftFor(0.5), LIFT, 'at the default setting');
  assert.equal(liftFor(1), 1, 'a slider at the top has nowhere to go');
  for (let v = 0.02; v <= 1.0001; v += 0.02) {
    const lift = liftFor(v);
    assert.ok(lift >= 1 && lift <= LIFT + 1e-12, `${v}: ${lift}`);
    assert.ok(lift * Math.pow(Math.min(1, v), 1.5) <= 1 + 1e-9, `${v}: never louder than the slider's top`);
  }
  for (const odd of [0, -1, NaN, undefined, Infinity]) {
    const lift = liftFor(odd);
    assert.ok(Number.isFinite(lift) && lift >= 1 && lift <= LIFT, `${odd} counts for something sensible: ${lift}`);
  }
  assert.ok(UNDER > 0.1 && UNDER < 0.5, 'the score is a good way down under the voice, and not gone');
});

test('start: the stingers off, the story\'s first intensity, the lifted stage, then the piece with its seed', () => {
  const m = recorder({ volume: 0.5 });
  const score = new FilmScore({ music: m, seed: 7 });
  score.start();
  assert.deepEqual(m.calls.map((c) => c[0]), ['setStingers', 'conduct', 'setStage', 'play'], 'in this order: the piece opens in the right mix');
  assert.deepEqual(m.calls[0], ['setStingers', false]);
  assert.deepEqual(m.calls[1], ['conduct', musicAt(LEAD)], 'at the intensity of the story a lead on from the first frame');
  assert.equal(m.calls[2][1], liftFor(0.5));
  assert.deepEqual(m.calls[3].slice(0, 2), ['play', THEME]);
  assert.equal(m.calls[3][2].seed, 7);
  assert.equal(typeof m.calls[3][2].joinAt, 'function', 'and where to come in, for a browser that allows audio late');
  score.start();
  assert.equal(m.calls.length, 4, 'once');
});

test('joinAt: where a piece should come in when the browser allows audio part-way through the film: the film\'s second, and the story\'s intensity for every bar of the way', () => {
  const m = recorder();
  const score = new FilmScore({ music: m });
  assert.equal(score.joinAt(), null, 'nowhere before the film has begun');
  score.start();
  const join = m.calls.find((c) => c[0] === 'play')[2].joinAt;
  assert.deepEqual(join(), { seconds: 0, levelAt: barLevel }, 'at the film\'s start, the start of the piece');
  score.update(31.5);
  assert.deepEqual(join(), { seconds: 31.5, levelAt: barLevel });
  assert.equal(join().levelAt(20), musicAt(20 + THEMES[THEME].bar / 2), 'each bar at the intensity of its middle, as the live ones');
  score.end('handover');
  assert.equal(join(), null, 'and nowhere once the film is over: the title screen\'s own music begins at its start');
  const cut = new FilmScore({ music: recorder() });
  cut.start();
  cut.update(10);
  cut.end('cut');
  assert.equal(cut.joinAt(), null);
});

test('update: the intensity follows the story, read a lead ahead; before the start and after the end it does nothing', () => {
  const m = recorder();
  const score = new FilmScore({ music: m });
  score.update(3);
  assert.deepEqual(m.calls, [], 'nothing before the start');
  score.start();
  m.calls.length = 0;
  for (const t of [0, 1.5, 12, 29.7, 40, FILM_LENGTH, FILM_LENGTH + 2]) {
    score.update(t);
    assert.equal(m.calls.length, 1);
    assert.deepEqual(m.calls.pop(), ['conduct', musicAt(t + LEAD)], `at ${t}s`);
  }
  score.end('handover');
  m.calls.length = 0;
  score.update(20);
  assert.deepEqual(m.calls, [], 'nothing after the end');
});

test('speaking: steps back quickly when a line is with the browser, swells slowly after it, and ignores what is no change', () => {
  const m = recorder({ volume: 0.5 });
  const score = new FilmScore({ music: m });
  score.speaking(true);
  assert.deepEqual(m.calls, [], 'nothing before the start');
  score.start();
  m.calls.length = 0;
  const lift = liftFor(0.5);
  score.speaking(true);
  assert.equal(m.calls.length, 1);
  const [name, down, attack, wait] = m.calls[0];
  assert.equal(name, 'setStage');
  assert.ok(close(down, lift * UNDER), 'to a fraction of the lift');
  assert.ok(attack > 0 && attack <= 0.25, 'quickly: the voice must not fight the score for its first words');
  assert.ok(!wait, 'at once');
  score.speaking(true);
  assert.equal(m.calls.length, 1, 'no change, no call');
  score.speaking(false);
  assert.equal(m.calls.length, 2);
  const [, up, release, after] = m.calls[1];
  assert.equal(up, lift, 'back to the lift');
  assert.ok(release > attack * 2, 'the swell is slower than the step back');
  assert.ok(after > 0 && after < 0.5, 'a breath after the last word');
  score.speaking(false);
  score.speaking(0);
  assert.equal(m.calls.length, 2, 'no change, no call');
});

test('the mix follows the Music setting: lifted for a quiet slider, held for a loud one', () => {
  for (const volume of [0.05, 0.3, 0.5, 0.7, 0.85, 1]) {
    const m = recorder({ volume });
    const score = new FilmScore({ music: m });
    score.start();
    const lift = liftFor(volume);
    assert.equal(m.calls.find((c) => c[0] === 'setStage')[1], lift, `lift at ${volume}`);
    score.speaking(true);
    assert.ok(close(m.calls.at(-1)[1], lift * UNDER), `under at ${volume}`);
    score.speaking(false);
    assert.equal(m.calls.at(-1)[1], lift, `lift again at ${volume}`);
  }
  const odd = recorder();
  odd.state = () => ({});
  const score = new FilmScore({ music: odd });
  score.start();
  assert.equal(odd.calls.find((c) => c[0] === 'setStage')[1], liftFor(0.5), 'a setting it cannot read counts as the default');
});

test('end("cut"): the stingers are back, the piece fades out inside the dip, the stage is reset as the title\'s own comes in', () => {
  const m = recorder();
  const score = new FilmScore({ music: m });
  score.start();
  score.speaking(true);
  m.calls.length = 0;
  score.end('cut');
  assert.deepEqual(m.calls.map((c) => c[0]), ['setStingers', 'stop', 'setStage']);
  assert.deepEqual(m.calls[0], ['setStingers', true]);
  const fade = m.calls[1][1];
  assert.ok(fade > 0 && fade <= 0.32, `gone within the 0.32 s dip to black (${fade})`);
  const [, gain, , delay] = m.calls[2];
  assert.equal(gain, 1, 'the stage back where the settings have it');
  assert.ok(delay >= fade && delay <= 0.5, `after the piece has gone and before the title\'s own is heard (${delay})`);
  score.speaking(false); // the voice that was cut off may still report its last word
  score.update(3);
  score.end('cut');
  assert.equal(m.calls.length, 3, 'neither a voice cut off nor the story can touch it now, and it is over once');
});

test('end("handover"): the stingers are back and the piece plays on, the lift gliding away', () => {
  const m = recorder();
  const score = new FilmScore({ music: m });
  score.start();
  m.calls.length = 0;
  score.end('handover');
  assert.deepEqual(m.calls.map((c) => c[0]), ['setStingers', 'setStage'], 'no stop: the title screen carries it on');
  assert.deepEqual(m.calls[0], ['setStingers', true]);
  const [, gain, glide, wait] = m.calls[1];
  assert.equal(gain, 1);
  assert.ok(glide >= 1, 'slowly: nothing steps at the hand-over');
  assert.ok(!wait);
  const dflt = recorder();
  const other = new FilmScore({ music: dflt });
  other.start();
  dflt.calls.length = 0;
  other.end();
  assert.deepEqual(dflt.calls.map((c) => c[0]), ['setStingers', 'setStage'], 'a hand-over is what end() means by default');
});

test('end before the start touches nothing, and a score that has ended cannot be started again', () => {
  const m = recorder();
  const score = new FilmScore({ music: m });
  score.end('cut');
  score.start();
  score.update(1);
  score.speaking(true);
  assert.deepEqual(m.calls, [], 'a film that never began to show has no score to take down');
  assert.equal(score.waiting(), false);
});

test('waiting: true while the piece is wanted and only a click is missing', () => {
  const m = recorder({ waiting: true });
  const score = new FilmScore({ music: m });
  assert.equal(score.waiting(), false, 'not before the start');
  score.start();
  assert.equal(score.waiting(), true);
  m.waiting = false;
  assert.equal(score.waiting(), false, 'the click came');
  m.waiting = true;
  score.end('handover');
  assert.equal(score.waiting(), false, 'and not once the film is over');
  const broken = new FilmScore({ music: { ...recorder(), state() { throw new Error('no'); } } });
  broken.start();
  assert.equal(broken.waiting(), false, 'an engine that cannot say counts as not waiting');
});

test('a score whose engine throws never reaches the film: it warns once and the film goes on', () => {
  const calls = [];
  const bad = () => {
    calls.push(1);
    throw new Error('the engine broke');
  };
  const score = new FilmScore({ music: { state: () => ({ volume: 0.5 }), conduct: bad, setStage: bad, setStingers: bad, play: bad, stop: bad } });
  score.start();
  score.update(1);
  score.speaking(true);
  score.speaking(false);
  score.end('cut');
  assert.ok(calls.length >= 4, 'it did try');
  assert.equal(warnings.filter((w) => /the score failed/.test(w)).length, 1, 'said once');
  const none = new FilmScore({ music: {} });
  none.start();
  none.update(2);
  none.speaking(true);
  none.end('handover');
  assert.equal(none.waiting(), false);
});

test('createFilmScore makes a score with the options it is given', () => {
  const m = recorder();
  const score = createFilmScore({ music: m, seed: 11 });
  assert.ok(score instanceof FilmScore);
  score.start();
  assert.deepEqual(m.calls.at(-1).slice(0, 2), ['play', THEME]);
  assert.equal(m.calls.at(-1)[2].seed, 11);
});

// ---------------------------------------------------------------- through the real engine, over the whole film

/**
 * The browser's speech synthesis on the film's own clock: the lines are said one after another, each taking
 * `seconds(text)`; `allowed: false` is a browser that refuses until the page has had a click, `reportsEnd: false`
 * one that never says a line is over.
 */
function fakeSpeech({ seconds = (text) => 0.4 + 0.07 * text.length, allowed = true, reportsEnd = true } = {}) {
  const queue = [];
  const said = [];
  let current = null;
  const browser = {
    allowed,
    said,
    speech: {
      synth: {
        speak(u) {
          queue.push(u);
        },
        cancel() {
          const cut = [...(current ? [current.u] : []), ...queue];
          current = null;
          queue.length = 0;
          for (const u of cut) u.onerror({ error: 'interrupted' });
        },
      },
      Utterance: class {
        constructor(text) {
          this.text = text;
        }
      },
    },
    /** The browser catches up with film second t: the line being said ends, the next one starts. */
    step(t) {
      if (current && t >= current.to) {
        const { u } = current;
        current = null;
        if (reportsEnd) u.onend({});
      }
      while (!current && queue.length) {
        const u = queue.shift();
        if (!browser.allowed) {
          u.onerror({ error: 'not-allowed' });
          continue;
        }
        current = { u, to: t + seconds(u.text) };
        said.push({ text: u.text, from: t, to: current.to });
        u.onstart({});
      }
    },
  };
  return browser;
}

/**
 * The film's score on the real music engine and a strict fake audio context, with the real narrator over a stand-in
 * for the browser's speech, all on one clock: `through(t)` runs the frames up to film second t (60 a second, the
 * engine's timer every quarter second), as the page does, and records the mix stage at every frame.
 * The audio clock is the film's, from the moment the context runs (at once, unless `state` says the browser has not
 * allowed audio yet; `unlock()` is the player's first click).
 */
function playFilm({ seed = SEED, volume = 0.5, state = 'running', narrate = true, speech = {} } = {}) {
  const ctx = new FakeAudioContext({ state, sampleRate: 8000 });
  sfx.init({ context: ctx });
  sfx.last.clear(); // the sound engine is one object for the whole file: forget what other tests played
  sfx.active.clear();
  const engine = new MusicEngine();
  engine._startTimer = () => {};
  engine.init({ volume });
  const score = new FilmScore({ music: engine, seed });
  const browser = fakeSpeech(speech);
  const voice = narrate ? new Narrator({ speech: browser.speech, volume: 1, onSpeaking: (on) => score.speaking(on) }) : null;
  const film = { ctx, engine, score, voice, browser, t: 0, samples: [], bars: [], sections: [], offset: 0, nextTick: 0, onFrame: null };
  film.stage = (t = ctx.currentTime) => engine.env.nodes.stage.gain.valueAt(t);
  film.unlock = () => {
    ctx.state = 'running';
    film.offset = film.t;
    ctx.currentTime = 0;
    film.nextTick = film.t;
  };
  let seen = 0;
  film.through = (to, dt = 1 / 60) => {
    while (film.t < to - 1e-9) {
      const t = (film.t = Math.min(to, film.t + dt));
      if (ctx.state === 'running') ctx.currentTime = t - film.offset;
      score.update(t);
      if (voice) voice.update(t);
      browser.step(t);
      if (film.onFrame) film.onFrame(t);
      if (t >= film.nextTick - 1e-9) {
        film.nextTick += 0.25;
        const before = engine.run ? engine.run.nextBar : ctx.currentTime + 0.12; // where the bar composed now would start
        const bars = engine.run ? engine.run.bars : 0;
        engine.tick();
        const run = engine.run;
        if (run && run.bars > bars) {
          film.bars.push({ at: t, start: before, dur: run.nextBar - before, level: engine.level });
          if (run.score.sections !== seen) {
            seen = run.score.sections;
            const s = run.score.section;
            film.sections.push({ start: before, index: s.index, mode: s.mode, tune: !!s.tune, shift: s.shift, chords: s.chords.map((c) => c.name).join(' ') });
          }
        }
      }
      if (engine.env) film.samples.push([t, film.stage(ctx.currentTime)]);
    }
    return film;
  };
  score.start();
  return film;
}

test('over the whole film the score is at its lift before and between the lines, under each while it is said, and back after', () => {
  const film = playFilm();
  film.through(FILM_LENGTH);
  const lift = liftFor(0.5);
  const under = lift * UNDER;
  const said = film.browser.said;
  assert.deepEqual(said.map((s) => s.text), CAPTIONS.map((c) => c.text), 'every caption was said, once, in order');
  for (const [t, g] of film.samples) assert.ok(g >= under * 0.999 && g <= lift * 1.001, `never outside the two levels: ${g} at ${t}s`);
  for (const [t, g] of film.samples) if (t < said[0].from - 0.05) assert.ok(close(g, lift), `the opening is at the lift (${g} at ${t}s)`);
  for (const [i, line] of said.entries()) {
    const next = said[i + 1] ? said[i + 1].from : FILM_LENGTH + 1;
    let low = Infinity;
    let high = 0;
    for (const [t, g] of film.samples) {
      if (t >= line.from + 0.5 && t <= line.to) {
        assert.ok(g <= under * 1.05, `under "${line.text}" while it is said (${g.toFixed(3)} at ${t.toFixed(2)}s)`);
        low = Math.min(low, g);
      }
      if (t >= line.to + 2 && t < next - 0.05) {
        assert.ok(g >= lift * 0.95, `swelled again after "${line.text}" (${g.toFixed(3)} at ${t.toFixed(2)}s)`);
        high = Math.max(high, g);
      }
    }
    assert.ok(Number.isFinite(low) && high > 0, `"${line.text}": both the narrated stretch and the gap after it were looked at`);
    assert.ok(20 * Math.log10(high / low) >= 10, `"${line.text}": the music is at least 10 dB louder between the lines than under the voice`);
  }
  assert.deepEqual(warnings, []);
});

test('it steps back before the voice has said much, and the swell begins after the last word, not during it', () => {
  const film = playFilm();
  film.through(FILM_LENGTH);
  const lift = liftFor(0.5);
  const under = lift * UNDER;
  const line = film.browser.said[1]; // "Pray. Summon the gods."
  const at = (t) => film.samples.find(([x]) => x >= t)[1];
  assert.ok(at(line.from + 0.35) < under + 0.07 * (lift - under) + 0.01, 'a third of a second in, it has all but gone down');
  assert.ok(at(line.to - 0.02) <= under * 1.05, 'it stays down to the last word');
  assert.ok(at(line.to + 0.15) <= under * 1.05, 'and a breath after it');
  assert.ok(at(line.to + 0.7) > under + 0.2 * (lift - under), 'then it swells');
  assert.ok(at(line.to + 0.2 + 4 * 0.55) > under + 0.97 * (lift - under), 'and is there again in about two seconds');
});

test('the offline mix (stageCurve) is the live one: the same steps back and swells, give or take a couple of frames', () => {
  const film = playFilm();
  film.through(FILM_LENGTH);
  const curve = stageCurve(film.browser.said.map((s) => [s.from, s.to]), 0.5);
  const slack = 2 / 60; // the page learns of a line's end on its next frame
  for (const [t, g] of film.samples) {
    const a = curve(Math.max(0, t - slack));
    const b = curve(t + slack);
    assert.ok(g >= Math.min(a, b) - 0.01 && g <= Math.max(a, b) + 0.01, `${g.toFixed(3)} live against ${a.toFixed(3)}..${b.toFixed(3)} offline at ${t.toFixed(2)}s`);
  }
  assert.ok(close(stageCurve([], 0.5)(10), liftFor(0.5), 1e-6), 'nothing said, nothing stepped back');
  assert.ok(close(stageCurve([[2, 3]], 0.5)(100), liftFor(0.5), 1e-4), 'and long after the last line it is back at the lift');
  assert.ok(stageCurve([[2, 3]], 0.5)(2.9) < liftFor(0.5) * 0.45, 'down while a line is said');
});

test('the story conducts the engine exactly, and each bar is composed at the intensity of its middle', () => {
  const film = playFilm({ narrate: false });
  film.through(FILM_LENGTH);
  assert.ok(film.bars.length > 10);
  const theme = THEMES[THEME];
  for (const b of film.bars) {
    assert.ok(close(b.level, musicAt(b.at + LEAD), 1e-9), `no easing between the story and the engine (${b.at}s)`);
    // composed at b.at, sounding from b.start: its middle is where the story's value should be
    assert.ok(Math.abs(b.level - musicAt(b.start + barSeconds(theme, b.level) / 2)) < 0.06, `the bar at ${b.start.toFixed(1)}s is composed at its middle's intensity (${b.level.toFixed(2)})`);
  }
  assert.equal(film.engine.state().target, film.engine.state().level);
});

test('the overture lines up with the story: the tune comes in with the god, a tense section with the titans, home again for the title', () => {
  const problems = (sections) => {
    const out = [];
    const near = (a, b, d) => Math.abs(a - b) <= d;
    const god = sections.find((s) => near(s.start, 15, 1.5));
    const titans = sections.find((s) => near(s.start, 30, 1.5));
    const last = sections[sections.length - 1];
    if (sections[0].tune) out.push('the dawn has a tune before the god is there');
    if (!god || !god.tune) out.push('no tune comes in with the god at 15 s');
    if (!titans || titans.mode !== 'tense') out.push('no tense section starts with the titans at 30 s');
    else if (!titans.tune || !titans.shift) out.push('the tense section has no tune an octave up');
    if (last.start < 41 || last.mode !== 'calm') out.push(`the last section (from ${last.start.toFixed(1)}s) is not a calm one after 41 s`);
    return out;
  };
  const overture = (seed) => playFilm({ seed, narrate: false }).through(FILM_LENGTH).sections;
  const found = problems(overture(SEED));
  if (found.length) {
    const fits = [];
    for (let seed = 1; seed <= 300 && fits.length < 6; seed++) if (!problems(overture(seed)).length) fits.push(seed);
    assert.fail(`seed ${SEED} no longer plays the overture the film needs (${found.join('; ')}); seeds that do: ${fits.join(', ') || 'none in 1..300'}`);
  }
});

test('the same seed plays the same overture, note for note', () => {
  const a = playFilm({ narrate: false }).through(FILM_LENGTH);
  const b = playFilm({ narrate: false }).through(FILM_LENGTH);
  assert.ok(a.ctx.sources.length > 200, 'a score, not a few notes');
  assert.equal(a.ctx.sources.length, b.ctx.sources.length);
  assert.deepEqual(a.ctx.sources.map((s) => [s.started, s.stopped]), b.ctx.sources.map((s) => [s.started, s.stopped]));
  assert.deepEqual(a.sections, b.sections);
  const other = playFilm({ seed: SEED + 1, narrate: false }).through(FILM_LENGTH);
  const notes = (f) => f.ctx.sources.map((s) => s.started.toFixed(3)).join();
  assert.notEqual(notes(other), notes(a), 'another seed is another piece');
});

test('a browser that never says a line is over: the score still swells when the caption has run out', () => {
  const film = playFilm({ speech: { reportsEnd: false } });
  film.through(FILM_LENGTH);
  const lift = liftFor(0.5);
  const under = lift * UNDER;
  const at = (t) => film.samples.find(([x]) => x >= t)[1];
  const war = CAPTIONS[2]; // "Lead them to war", 20 s to 28.6 s: the browser finished it by 21.6 s but never said so
  assert.ok(at(war.to - 0.2) <= under * 1.05, 'down while the caption is up');
  assert.ok(at(CAPTIONS[3].from - 0.1) >= lift * 0.95, 'up again before the next line, because its caption ran out');
});

test('a skip in the middle of a line: the score fades out and the stage is reset behind it, for the title\'s own score to come in clean', () => {
  const film = playFilm();
  film.through(2.6); // the first line is being said
  const { engine, score, voice } = film;
  const lift = liftFor(0.5);
  assert.ok(film.stage(film.ctx.currentTime) < lift * 0.4, 'under the voice');
  const piece = engine.run;
  // the page's order on a skip: the score is told first, then the voice is cut
  score.end('cut');
  voice.stop();
  assert.equal(engine.state().wanted, null, 'it no longer wants the piece');
  assert.equal(engine.run, null);
  assert.ok(piece.fading && engine.fading.includes(piece), 'the piece is on its way out');
  // the dip to black is 0.32 s; then the page hands over and the title screen asks for its score (playTitleMusic)
  film.through(2.6 + 0.32);
  assert.ok(film.samples.filter(([t]) => t > 2.6).every(([, g]) => g <= lift * UNDER * 1.01), 'the stage did not rise under the dying piece');
  engine.setIntensity(TITLE_INTENSITY);
  engine.play('menu');
  const title = engine.run;
  assert.ok(title && title !== piece, 'a new run of its own');
  assert.equal(engine.state().wanted, 'menu');
  film.through(2.6 + 0.37);
  assert.ok(film.stage() > lift * UNDER * 1.01, 'the stage is going back up ...');
  assert.ok(title.mix.gain.valueAt(film.ctx.currentTime) < 0.05, '... while the title\'s own piece has hardly begun to fade in');
  film.through(2.6 + 1.2);
  assert.ok(close(film.stage(), 1, 0.005), `the stage is back where the settings have it (${film.stage()})`);
  assert.equal(engine.state().stage, 1);
  assert.equal(engine.fading.length, 0, 'and the old piece is gone');
  assert.deepEqual(warnings, []);
});

test('the film runs to its end: the same piece plays on into the title screen at the same intensity, the lift gliding away', () => {
  const film = playFilm();
  film.through(FILM_LENGTH);
  const { engine, score, voice } = film;
  const piece = engine.run;
  assert.equal(engine.state().level, TITLE_INTENSITY, 'the film ends at the title\'s level');
  const before = film.stage();
  score.end('handover');
  voice.stop();
  // the page's hand-over: the title screen asks for its score
  engine.setIntensity(TITLE_INTENSITY);
  engine.play('menu');
  engine.tick();
  assert.equal(engine.run, piece, 'the very same run goes on');
  assert.equal(engine.state().level, TITLE_INTENSITY, 'with no seam in the intensity');
  assert.equal(engine.state().wanted, 'menu');
  const count = film.samples.length;
  film.through(FILM_LENGTH + 8);
  const glide = film.samples.slice(count).map(([, g]) => g);
  assert.ok(Math.abs(glide[0] - before) < 0.02, 'no step at the hand-over');
  assert.ok(glide.every((g, i) => !i || g <= glide[i - 1] + 1e-9), 'the lift only ever goes down');
  assert.ok(close(glide.at(-1), 1, 0.01), `and is gone in a few seconds (${glide.at(-1)})`);
  assert.equal(film.engine.state().stage, 1);
  assert.deepEqual(warnings, []);
});

test('the film\'s own sounds do not make the score step back, and the game\'s do again when the film is over', () => {
  const film = playFilm({ narrate: false });
  const duck = film.engine.env.nodes.duck.gain;
  const n = duck.events.length;
  let cues = 0;
  for (const cue of AUDIO_CUES) {
    film.through(cue.at);
    if (sfx.play(cue.name, { volume: cue.volume })) cues++;
  }
  film.through(FILM_LENGTH);
  assert.ok(cues >= 7, `the cues played (${cues})`);
  assert.equal(duck.events.length, n, 'not one of them moved the music');
  film.score.end('handover');
  film.through(FILM_LENGTH + 6);
  assert.equal(sfx.play('victory'), true);
  assert.ok(duck.events.length > n, 'a victory fanfare after the film makes it step back again');
});

test('a first visit: silent until the first click, then the score comes in at the story\'s moment, under the voice if one is speaking', () => {
  const film = playFilm({ state: 'suspended', speech: { allowed: false } });
  const { engine, score, ctx, voice, browser } = film;
  const lift = liftFor(0.5);
  film.through(3);
  assert.equal(score.waiting(), true, 'the film shows its hint');
  assert.equal(ctx.sources.length, 0, 'and nothing sounds');
  assert.equal(voice.blocked, true, 'the voice is refused too');
  assert.ok(close(film.stage(), lift), 'the stage waits at the lift');
  film.unlock(); // the click: the browser lets both speak
  browser.allowed = true;
  voice.retry();
  film.through(3.6);
  assert.equal(score.waiting(), false, 'the hint goes');
  assert.ok(ctx.sources.length > 0, 'the music begins');
  assert.ok(close(engine.state().level, musicAt(3.6 + LEAD), 1e-9), 'from the story\'s moment, not from its first bar');
  assert.ok(film.stage() < lift * 0.4, 'under the line that began with the click');
  film.through(9); // the line that began with the click is over by 5.4 s, the next begins at 9.6 s
  assert.ok(film.stage() > lift * 0.95, 'and swelling after it');
  assert.deepEqual(warnings, []);
});

test('a first visit whose click comes late joins the overture where the story is: it comes in on the section the story is in, and goes on from there', () => {
  const whole = playFilm({ narrate: false }).through(FILM_LENGTH).sections;
  assert.deepEqual(whole.map((s) => s.index), [0, 1, 2, 3], 'the whole overture is four sections');
  // seconds clear of a section boundary (the bar in progress at the click is what the piece joins at)
  const nearBoundary = (t) => whole.some((s) => Math.abs(s.start - t) < 0.3);
  for (const clickAt of [0, 3, 9, 14, 17, 22, 28, 31, 36, 42, 46]) {
    assert.ok(!nearBoundary(clickAt), `${clickAt}s is a fair test (no section begins within a third of a second)`);
    const film = playFilm({ state: 'suspended', narrate: false });
    film.through(clickAt);
    assert.equal(film.ctx.sources.length, 0, 'silent until the click');
    film.unlock();
    film.through(FILM_LENGTH);
    const heard = film.sections;
    const there = whole[Math.max(0, whole.findLastIndex((s) => s.start <= clickAt))]; // the section the story is in at the click
    assert.ok(heard.length >= 1 && film.ctx.sources.length > 20, `a click at ${clickAt}s: the music begins`);
    assert.equal(heard[0].index, there.index, `a click at ${clickAt}s: the section the story is in (${there.index}), not the first`);
    assert.equal(heard[0].mode, there.mode, 'calm or tense as the story is');
    heard.forEach((s, i) => assert.equal(s.index, there.index + i, 'and the sections that follow come in order'));
    for (const s of heard) {
      if (s.index === 1) assert.ok(s.tune, 'the tune is in the second section, wherever the click was: it comes with the god');
      if (s.mode === 'tense' && s.tune) assert.ok(s.shift, 'and a tune in a battle is sung an octave up');
    }
    assert.deepEqual(warnings, []);
  }
  const titans = playFilm({ state: 'suspended', narrate: false });
  titans.through(31);
  titans.unlock();
  titans.through(33);
  assert.equal(titans.sections[0].mode, 'tense', 'a click at 31 s is into the titans\' battle, not the dawn');
});

test('with the music muted, or the slider at nothing, the film plays on without a score and without asking for a click', () => {
  for (const setup of [(film) => film.engine.mute(true), (film) => film.engine.setVolume(0)]) {
    const film = playFilm({ narrate: false });
    setup(film);
    film.through(FILM_LENGTH);
    assert.equal(film.score.waiting(), false);
    assert.ok(film.ctx.currentTime > 40);
  }
  const quiet = playFilm({ volume: 0 });
  quiet.through(FILM_LENGTH);
  assert.equal(quiet.ctx.sources.length, 0, 'nothing is made for a music nobody can hear');
  assert.equal(quiet.score.waiting(), false);
  assert.deepEqual(warnings, []);
});
