// The music engine (src/audio/music.js) against a strict fake AudioContext: it must wait for the
// browser to allow audio, follow the theme it is asked for, crossfade, ease the intensity, obey
// volume, mute and the hidden tab, step back under big sounds, schedule only ahead of the clock
// and never hand the browser a value it would throw on. The score itself is checked in
// music-composer.test.js.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext, reaches } from './fake-audio.js';
import { sfx } from '../../src/audio/sfx.js';
import { MusicEngine, DUCKS, MUSIC_GAIN, MUSIC_THEME_IDS, renderMusicOffline, COMPOSE_AHEAD } from '../../src/audio/music.js';
import { THEMES } from '../../src/audio/music-themes.js';
import { createScore, composeBar } from '../../src/audio/music-composer.js';

const warn = console.warn;
beforeEach(() => {
  console.warn = warn;
});

/** A fresh context handed to the sound engine, and a fresh music engine on top of it. */
function setup({ state = 'running', volume = 0.5, muted = false } = {}) {
  const ctx = new FakeAudioContext({ state, sampleRate: 8000 });
  sfx.init({ context: ctx });
  const engine = new MusicEngine();
  engine._startTimer = () => {
    engine.timerStarts = (engine.timerStarts || 0) + 1;
  };
  engine.init({ volume, muted });
  return { ctx, engine };
}

/** Move the clock and let the engine schedule. */
function advance(ctx, engine, seconds, step = 0.25) {
  const to = ctx.currentTime + seconds;
  while (ctx.currentTime < to - 1e-9) {
    ctx.currentTime = Math.min(to, ctx.currentTime + step);
    engine.tick();
  }
}

const lastTarget = (param) => [...param.events].reverse().find((e) => e[0] === 'target');

test('in Node, with no audio at all, every call is a safe no-op', () => {
  const engine = new MusicEngine();
  engine.init({ volume: 0.4 });
  engine.play('greek');
  engine.setIntensity(0.9);
  engine.setVolume(0.2);
  engine.mute(true);
  engine.mute(false);
  engine.duck(0.5, 2);
  engine.tick();
  engine.stop();
  const s = engine.state();
  assert.equal(s.ready, false);
  assert.equal(s.playing, false);
  assert.equal(s.volume, 0.2);
  engine._stopTimer();
});

test('play before the browser allows audio is remembered, and starts when the context runs', () => {
  const { ctx, engine } = setup({ state: 'suspended' });
  engine.play('norse');
  assert.equal(engine.state().wanted, 'norse');
  assert.equal(engine.state().playing, false);
  engine.tick();
  assert.equal(ctx.sources.length, 0, 'nothing is scheduled into a suspended context');
  assert.equal(engine.state().theme, null);
  ctx.state = 'running'; // the player's first click
  engine.tick();
  assert.ok(ctx.sources.length > 0);
  assert.equal(engine.state().theme, 'norse');
  assert.equal(engine.state().playing, true);
  assert.ok(engine.timerStarts >= 1, 'the scheduler timer was started');
});

test('an unknown theme falls back to the title theme; the same theme again changes nothing', () => {
  const { ctx, engine } = setup();
  engine.play('no-such-pantheon');
  engine.tick();
  assert.equal(engine.state().theme, 'menu');
  const run = engine.run;
  const sources = ctx.sources.length;
  engine.play('menu');
  engine.tick();
  assert.equal(engine.run, run, 'still the same piece');
  assert.equal(ctx.sources.length, sources, 'and nothing new at the same instant');
});

test('bars are composed ahead of the clock, but each note is created only shortly before it sounds', () => {
  const { ctx, engine } = setup();
  const bar = THEMES.greek.bar;
  engine.play('greek');
  engine.tick();
  assert.ok(Math.min(...ctx.sources.map((s) => s.started)) >= 0, 'nothing in the past');
  assert.ok(engine.run.nextBar >= 1.6 && engine.run.nextBar < 1.6 + bar, `bars are composed up to the horizon (${engine.run.nextBar})`);
  assert.ok(Math.max(...ctx.sources.map((s) => s.started)) < 0.7, 'but only the notes of the next fraction of a second exist');
  assert.ok(engine.run.pending.length > 0, 'the rest wait as data');
  assert.ok(engine.run.pending.every((p) => p.at >= 0.6), 'and none of them is due');
  const before = ctx.sources.length;
  advance(ctx, engine, 10);
  assert.ok(ctx.sources.length > before);
  for (const s of ctx.sources) assert.ok(s.started >= 0 && s.stopped >= s.started, 'every source starts, then stops');
  assert.ok(engine.run.nextBar >= 10 + 1.6 && engine.run.nextBar < 10 + 1.6 + bar, `still about the horizon ahead (${engine.run.nextBar})`);
  assert.ok(Math.max(...ctx.sources.map((s) => s.started)) < 10 + 0.7, 'no note is created more than a moment early');
  assert.ok(engine.run.bars >= 3);
});

test('a note that is long past its time is dropped if it is short, and played at once if it is long', () => {
  const { ctx, engine } = setup();
  engine.play('greek');
  engine.tick();
  const run = engine.run;
  run.pending.length = 0;
  const shortNote = { layer: 'arp', inst: 'lyre', midi: 64, t: 0, dur: 0.4, vel: 0.7 };
  const longNote = { layer: 'pad', inst: 'strings', midis: [50, 57, 62, 65], t: 0, dur: 3, vel: 0.7 };
  const isNoise = (s) => 'loop' in s; // a pluck's click is the only buffer source here
  ctx.currentTime = 3; // two seconds after their time the scheduler finally gets to run
  let count = ctx.sources.length;
  run.pending.push({ at: 1, ev: shortNote }, { at: 1, ev: longNote });
  run.play(3.6, 3);
  let made = ctx.sources.slice(count);
  assert.ok(made.length > 0 && made.every((s) => s.started >= 3), 'the long one starts now, not in the past');
  assert.ok(!made.some(isNoise), 'the short one was skipped');
  assert.equal(run.pending.length, 0);
  // The same short note on time does play.
  count = ctx.sources.length;
  run.pending.push({ at: 3.2, ev: shortNote });
  run.play(3.6, 3);
  made = ctx.sources.slice(count);
  assert.ok(made.some(isNoise) && made.some((s) => !isNoise(s)), 'on time, it plays');
  // And one not yet due waits.
  count = ctx.sources.length;
  run.pending.push({ at: 5, ev: shortNote });
  run.play(3.6, 3);
  assert.equal(ctx.sources.length, count);
  assert.equal(run.pending.length, 1);
});

test('after a long stall the music carries on from now instead of catching up', () => {
  const { ctx, engine } = setup();
  engine.play('aztec');
  engine.tick();
  const count = ctx.sources.length;
  ctx.currentTime = 600; // a hidden tab's timers slept for ten minutes
  engine.tick();
  const added = ctx.sources.slice(count);
  assert.ok(added.length > 0);
  assert.ok(added.every((s) => s.started >= 600), 'no sound in the past');
  assert.ok(added.length < count * 6, 'and not a pile of bars at once');
});

test('every source the music creates is started, stopped and reaches the shared output', () => {
  const { ctx, engine } = setup();
  engine.setIntensity(0.85);
  engine.play('hindu');
  advance(ctx, engine, 20);
  assert.ok(ctx.sources.length > 50);
  for (const s of ctx.sources) {
    assert.notEqual(s.started, null);
    assert.notEqual(s.stopped, null);
    assert.ok(reaches(s, ctx.destination), 'sound reaches the speakers');
    assert.ok(reaches(s, sfx.shared.out), 'through the sound effects\' own limiter');
  }
  assert.equal(engine.run.bad.size, 0, 'no instrument threw');
});

test('every theme at every intensity schedules only values the browser accepts', () => {
  for (const id of MUSIC_THEME_IDS) {
    for (const level of [0, 0.2, 0.45, 0.7, 1]) {
      const { ctx, engine } = setup();
      engine.setIntensity(level);
      engine.play(id);
      advance(ctx, engine, 14); // the strict fake throws on bad automation; Run.bad would remember it
      assert.equal(engine.run.bad.size, 0, `${id} at ${level}: ${[...engine.run.bad]}`);
      assert.ok(ctx.sources.length > 0, `${id} at ${level} makes sound`);
      assert.equal(engine.errors, 0);
    }
  }
});

test('a voice that fails is muted for the rest of the piece and the music plays on', () => {
  const { ctx, engine } = setup();
  const create = ctx.createPeriodicWave.bind(ctx);
  ctx.createPeriodicWave = () => {
    throw new Error('no custom waves today');
  };
  console.warn = () => {};
  engine.setIntensity(0.5);
  engine.play('greek'); // its bass (oud) and arp (lyre) are plucked strings built on a custom wave
  advance(ctx, engine, 8);
  assert.deepEqual([...engine.run.bad].sort(), ['lyre', 'oud'], 'only the instruments that threw were dropped');
  assert.equal(engine.disabled, false);
  assert.equal(engine.errors, 0, 'a failed voice is not a scheduler fault');
  ctx.createPeriodicWave = create;
  const had = ctx.sources.length;
  advance(ctx, engine, 8);
  assert.ok(ctx.sources.length > had, 'the others kept playing');
  assert.ok(engine.run.bad.has('lyre'), 'and the ones that failed stay quiet');
});

test('five faults in a row switch the music off for good, and it never throws', () => {
  const { ctx, engine } = setup();
  engine.play('greek');
  engine.tick();
  console.warn = () => {};
  Object.defineProperty(ctx, 'currentTime', {
    get() {
      throw new Error('the audio clock is gone');
    },
  });
  for (let i = 0; i < 5; i++) engine.tick();
  assert.equal(engine.disabled, true);
  engine.play('norse'); // ignored from now on
  engine.tick();
  assert.equal(engine.state().wanted, 'greek');
});

test('a change of theme crossfades: the old piece fades out, the new one fades in, then the old is taken down', () => {
  const { ctx, engine } = setup();
  engine.play('greek');
  engine.tick();
  const first = engine.run;
  advance(ctx, engine, 4);
  engine.play('japanese');
  engine.tick();
  assert.notEqual(engine.run, first);
  assert.equal(engine.run.theme.id, 'japanese');
  assert.equal(first.fading, true);
  assert.deepEqual(engine.fading, [first]);
  assert.equal(lastTarget(first.mix.gain)[1], 0, 'the old one is told to fade to silence');
  assert.ok(first.mix.gain.events.some((e) => e[0] === 'target'));
  const ramp = engine.run.mix.gain.events.find((e) => e[0] === 'lin');
  assert.ok(ramp[2] > ctx.currentTime, 'the new one comes in after the old starts to leave');
  advance(ctx, engine, 8);
  assert.deepEqual(engine.fading, [], 'the faded run is finished with');
  assert.deepEqual(first.mix.outputs, [], 'and its nodes are disconnected');
});

test('stop() fades out, keeps quiet until the next play(), and the timer winds down', () => {
  const { ctx, engine } = setup();
  engine.play('celtic');
  advance(ctx, engine, 3);
  const sources = ctx.sources.length;
  engine.stop(1.5);
  assert.equal(engine.state().wanted, null);
  assert.equal(engine.run, null);
  assert.equal(engine.fading.length, 1);
  advance(ctx, engine, 6);
  assert.equal(ctx.sources.length, sources, 'no new notes after a stop');
  assert.equal(engine.fading.length, 0);
  engine.play('celtic');
  engine.tick();
  assert.ok(ctx.sources.length > sources, 'play() starts again');
});

test('volume maps through a curve, zero is silent and mute is silent but remembers the volume', () => {
  const { ctx, engine } = setup({ volume: 0.5 });
  engine.play('greek');
  engine.tick();
  const gain = () => lastTarget(engine.env.nodes.bus.gain)[1];
  assert.ok(Math.abs(gain() - MUSIC_GAIN * Math.pow(0.5, 1.5)) < 1e-9);
  engine.setVolume(1);
  assert.ok(Math.abs(gain() - MUSIC_GAIN) < 1e-9);
  engine.setVolume(0.25);
  assert.ok(Math.abs(gain() - MUSIC_GAIN * 0.125) < 1e-9, 'a quarter volume is an eighth of the gain');
  engine.setVolume(2);
  assert.equal(engine.volume, 1, 'clamped');
  engine.setVolume(Number.NaN);
  assert.equal(engine.volume, 1, 'garbage is ignored');
  engine.setVolume(0.6);
  engine.mute(true);
  assert.equal(gain(), 0);
  assert.equal(engine.state().ready, false);
  assert.equal(engine.volume, 0.6);
  engine.mute(false);
  assert.ok(Math.abs(gain() - MUSIC_GAIN * Math.pow(0.6, 1.5)) < 1e-9);
  engine.setVolume(0);
  assert.equal(gain(), 0);
  assert.equal(engine.state().ready, false, 'volume zero is not ready');
  assert.ok(ctx.sources.length > 0);
});

test('muting stops scheduling and fades the piece; unmuting brings the same theme back', () => {
  const { ctx, engine } = setup();
  engine.play('chinese');
  advance(ctx, engine, 3);
  const first = engine.run;
  engine.mute(true);
  advance(ctx, engine, 1);
  assert.equal(engine.run, null);
  assert.equal(first.fading, true);
  const silent = ctx.sources.length;
  advance(ctx, engine, 5);
  assert.equal(ctx.sources.length, silent, 'a muted music schedules nothing');
  engine.mute(false);
  advance(ctx, engine, 1);
  assert.equal(engine.state().theme, 'chinese');
  assert.ok(ctx.sources.length > silent);
});

test('the intensity eases up fast and down slowly, and garbage is ignored', () => {
  const { ctx, engine } = setup();
  engine.play('greek');
  engine.tick();
  assert.equal(engine.state().level, 0);
  engine.setIntensity(1);
  advance(ctx, engine, 1.5);
  const up = engine.state().level;
  assert.ok(up > 0.55 && up < 0.7, `about 63% after 1.5 s (${up})`);
  advance(ctx, engine, 6);
  assert.ok(engine.state().level > 0.98);
  engine.setIntensity(0);
  advance(ctx, engine, 1.5);
  assert.ok(engine.state().level > 0.75, `a fight ends slowly (${engine.state().level})`);
  advance(ctx, engine, 21);
  assert.ok(engine.state().level < 0.05);
  engine.setIntensity(Number.NaN);
  engine.setIntensity(Infinity);
  assert.equal(engine.state().target, 0);
  engine.setIntensity(5);
  assert.equal(engine.state().target, 1);
  engine.setIntensity(-3);
  assert.equal(engine.state().target, 0);
});

test('a new piece starts at the intensity asked for, with no slow climb', () => {
  const { ctx, engine } = setup();
  engine.setIntensity(0.8);
  engine.play('norse');
  engine.tick();
  assert.equal(engine.state().level, 0.8);
  assert.ok(ctx.sources.length > 0);
});

test('duck() dips the music and brings it back; the sound effects named in DUCKS trigger it', () => {
  const { ctx, engine } = setup();
  engine.play('greek');
  engine.tick();
  const duck = engine.env.nodes.duck.gain;
  engine.duck(0.5, 2);
  const targets = duck.events.filter((e) => e[0] === 'target');
  assert.equal(targets[0][1], 0.5);
  assert.equal(targets[1][1], 1, 'and back');
  assert.ok(targets[1][2] > targets[0][2], 'later');
  engine.duck(5, 1); // clamped: never fully silent
  assert.ok(lastTarget(duck) && duck.events.filter((e) => e[0] === 'target').some((e) => e[1] === 0.05));
  engine.duck(0, 1);
  engine.duck(Number.NaN, 1);
  const n = duck.events.length;
  engine.duck(-1, 1);
  assert.equal(duck.events.length, n, 'no depth, no dip');

  const fresh = engine.env.nodes.duck.gain.events.length;
  for (const name of Object.keys(DUCKS)) {
    ctx.currentTime += 5; // the sound engine's own rate limits
    assert.equal(sfx.play(name), true, `${name} plays`);
  }
  assert.ok(engine.env.nodes.duck.gain.events.length > fresh, 'the sounds made the music step back');
  sfx.play('click');
  const after = engine.env.nodes.duck.gain.events.length;
  ctx.currentTime += 5;
  sfx.play('click');
  assert.equal(engine.env.nodes.duck.gain.events.length, after, 'a click does not');
});

test('conduct() sets the intensity exactly, at once and for good: no easing up or down, garbage ignored', () => {
  const { ctx, engine } = setup();
  engine.conduct(0.9);
  assert.equal(engine.state().level, 0.9, 'there at once, not 63% of the way after 1.5 s');
  assert.equal(engine.state().target, 0.9);
  engine.play('menu');
  engine.tick();
  assert.equal(engine.state().level, 0.9, 'a piece started afterwards opens there');
  advance(ctx, engine, 5);
  assert.equal(engine.state().level, 0.9, 'and the engine\'s own easing leaves it alone');
  engine.conduct(0.1);
  assert.equal(engine.state().level, 0.1, 'down at once too (setIntensity would take seconds: a fight ends slowly)');
  advance(ctx, engine, 5);
  assert.equal(engine.state().level, 0.1);
  engine.conduct(Number.NaN);
  engine.conduct(Infinity);
  engine.conduct(undefined);
  assert.equal(engine.state().level, 0.1);
  engine.conduct(7);
  assert.equal(engine.state().level, 1);
  engine.conduct(-2);
  assert.equal(engine.state().level, 0);
  engine.setIntensity(0.6); // the ordinary call still eases from where the conductor left it
  advance(ctx, engine, 1.5);
  assert.ok(engine.state().level > 0.3 && engine.state().level < 0.5, `eased ${engine.state().level}`);
});

// ---------------------------------------------------------------- a piece joined part-way in (the film's score after a late click)

/** A piece composed from its start at the intensity `levelAt(second a bar starts)`: [{ start, dur, section, index }] for every bar. */
function pieceFromStart(themeId, seed, levelAt, seconds) {
  const score = createScore(THEMES[themeId], seed);
  const bars = [];
  for (let start = 0; start < seconds; ) {
    const bar = composeBar(score, levelAt(start));
    bars.push({ start, dur: bar.dur, section: score.section, index: score.bar - 1 });
    start += bar.dur;
  }
  return bars;
}

const kindOf = (section) => `${section.mode}${section.tune ? '+tune' : ''}${section.shift ? '+octave' : ''}`;

test('joining a piece part-way in: the bars before that second are composed without a sound, and the one in progress is the first to sound', () => {
  const levelAt = (s) => (s < 14 ? 0.2 : 0.9); // calm, then a battle: sections of different kinds on either side
  const piece = pieceFromStart('menu', 82, levelAt, 200);
  assert.ok(new Set(piece.map((b) => kindOf(b.section))).size >= 3, `the piece has sections of several kinds (${[...new Set(piece.map((b) => kindOf(b.section)))]})`);
  for (const at of [0.2, 6, 14.5, 18, 25, 31, 47, 70]) {
    const k = piece.findIndex((b) => b.start + b.dur > at); // the bar in progress at that second
    const { ctx, engine } = setup();
    engine.conduct(0.9); // what the live bars after the join are composed at
    engine.play('menu', { seed: 82, joinAt: () => ({ seconds: at, levelAt }) });
    const run = engine.run;
    assert.equal(run.bars, k + 1, `${at}s: ${k} bars skipped, the one in progress composed`);
    assert.equal(run.score.bar, k + 1);
    const want = piece[k].section;
    const got = run.score.section;
    assert.equal(got.index, want.index, `${at}s: the same section as a piece played from the start (${kindOf(want)})`);
    assert.equal(kindOf(got), kindOf(want));
    assert.deepEqual(got.chords.map((c) => c.name), want.chords.map((c) => c.name));
    assert.ok(ctx.sources.length > 0, 'it sounds at once');
    assert.ok(Math.min(...ctx.sources.map((s) => s.started)) >= 0.12 - 1e-9, 'from the run\'s first bar on, nothing from the skipped ones');
    assert.ok(ctx.sources.some((s) => reaches(s, run.bus.pad)), `${at}s: the pad chord is struck for the bar in progress, whether or not the skipped bars held it`);
    if (at >= 14) {
      // the live bars after the join are the piece's own: the same sections, in the same order
      advance(ctx, engine, 40);
      const j = run.score.bar - 1;
      assert.ok(j > k + 4, `${at}s: it went on for several sections`);
      assert.equal(run.score.section.index, piece[j].section.index, `${at}s: and is in the section the piece is in at that bar`);
      assert.equal(kindOf(run.score.section), kindOf(piece[j].section));
    }
  }
});

test('a piece joined in a bar through which a pad chord is held strikes the chord again, or that bar would have no pad', () => {
  const levelAt = () => 0.9; // the menu theme holds a chord across two bars only in its tense progressions
  const piece = pieceFromStart('menu', 82, levelAt, 60);
  // a bar whose chord is the one before it: the pad was struck a bar back and is held through this one
  const held = piece.findIndex((b) => b.index % 4 !== 0 && b.section.chords[b.index % 4].name === b.section.chords[(b.index % 4) - 1].name);
  assert.ok(held > 0, 'the menu theme holds a chord across two bars somewhere');
  const { ctx, engine } = setup();
  engine.play('menu', { seed: 82, joinAt: () => ({ seconds: piece[held].start + 0.1, levelAt }) });
  assert.equal(engine.run.score.bar, held + 1, 'joined in the bar the chord is held through');
  assert.ok(ctx.sources.some((s) => reaches(s, engine.run.bus.pad)), 'the held chord sounds');
});

test('joinAt is asked each time a run is made, so a run made after an unmute joins where the piece is by then', () => {
  const levelAt = () => 0.5;
  const { ctx, engine } = setup();
  let at = 20;
  let asked = 0;
  engine.play('menu', { seed: 7, joinAt: () => (asked++, { seconds: at, levelAt }) });
  assert.equal(asked, 1);
  const first = engine.run;
  const piece = pieceFromStart('menu', 7, levelAt, 90);
  assert.equal(first.bars, piece.findIndex((b) => b.start + b.dur > 20) + 1);
  engine.mute(true);
  advance(ctx, engine, 1);
  assert.equal(engine.run, null, 'muted: the piece is gone');
  at = 61;
  engine.mute(false);
  advance(ctx, engine, 0.25);
  assert.notEqual(engine.run, first, 'unmuted: a run of its own');
  assert.equal(asked, 2, 'which asked again');
  assert.equal(engine.run.bars, piece.findIndex((b) => b.start + b.dur > 61) + 1, 'and came in where the piece is by now');
  engine.play('menu');
  engine.tick();
  assert.equal(asked, 2, 'asking for the piece that is already wanted changes nothing');
});

test('with nowhere to join, or nonsense, a piece begins at its start; a joinAt that fails is warned of once and the music plays', () => {
  const levelAt = () => 0.9;
  const begins = (join) => {
    const { ctx, engine } = setup();
    engine.play('menu', { seed: 82, joinAt: join });
    return { ctx, engine, run: engine.run };
  };
  for (const [what, join] of [
    ['nothing to say', () => null],
    ['no time at all', () => ({ seconds: 0, levelAt })],
    ['a time that is not one', () => ({ seconds: Number.NaN, levelAt })],
    ['a time before the start', () => ({ seconds: -5, levelAt })],
    ['no function at all', 'soon'],
  ]) {
    const { ctx, run } = begins(join);
    assert.equal(run.bars, 1, `${what}: the first bar`);
    assert.equal(run.score.section.index, 0);
    assert.ok(ctx.sources.length > 0);
  }
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  for (const join of [
    () => {
      throw new Error('no clock');
    },
    () => ({ seconds: 20, levelAt: null }),
  ]) {
    const { ctx, engine, run } = begins(join);
    assert.ok(run && ctx.sources.length > 0, 'the music plays on');
    assert.equal(engine.disabled, false, 'one failed join is not a fault of the scheduler');
  }
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /could not join the piece/);
  // a levelAt that answers nonsense is read as calm, and the join still ends
  const { run } = begins(() => ({ seconds: 30, levelAt: () => 'loud' }));
  const piece = pieceFromStart('menu', 82, () => 0, 90);
  assert.equal(run.bars, piece.findIndex((b) => b.start + b.dur > 30) + 1);
  assert.equal(warnings.length, 2, 'with no warning');
});

test('joining is bounded: a time far past the piece composes a few hundred bars and no more, and the music plays on from there', () => {
  const { ctx, engine } = setup();
  const started = Date.now();
  engine.play('menu', { seed: 1, joinAt: () => ({ seconds: Infinity, levelAt: () => 0.5 }) });
  assert.ok(Date.now() - started < 2000, 'quickly');
  assert.ok(engine.run.bars > 100 && engine.run.bars < 1000, `${engine.run.bars} bars`);
  advance(ctx, engine, 5);
  assert.ok(ctx.sources.length > 0);
});

test('the stage is a gain of its own after the volume and the stingers\' dip: setStage eases it, with a delay, and touches no other gain', () => {
  const { ctx, engine } = setup();
  engine.play('menu');
  engine.tick();
  const { bus, duck, stage, hide } = engine.env.nodes;
  assert.ok(reaches(bus, stage.gain.owner) && reaches(duck, stage.gain.owner) && reaches(stage.gain.owner, hide.gain.owner), 'volume → dip → stage → hidden-tab fade');
  assert.ok(reaches(stage.gain.owner, sfx.shared.out), 'and on into the shared limiter');
  const others = [bus, duck, hide].map((n) => n.gain.events.length);
  ctx.currentTime = 10;
  engine.setStage(0.28, 0.1);
  let ev = stage.gain.events.at(-1);
  assert.deepEqual(ev.slice(0, 2), ['target', 0.28]);
  assert.equal(ev[2], 10, 'from now');
  assert.equal(ev[3], 0.1, 'with the time constant asked for');
  assert.equal(engine.state().stage, 0.28);
  ctx.currentTime = 10.1;
  engine.setStage(1.4, 0.55, 0.2);
  ev = stage.gain.events.at(-1);
  assert.deepEqual([ev[0], ev[1], ev[3]], ['target', 1.4, 0.55]);
  assert.ok(Math.abs(ev[2] - 10.3) < 1e-9, 'a beat after now');
  assert.ok(stage.gain.valueAt(10.25) > 0.28 && stage.gain.valueAt(10.25) < 0.7, 'held where the step back had got to, not yet swelling');
  assert.ok(stage.gain.valueAt(13) > 1.35, 'and on its way up, a second and more later');
  assert.deepEqual([bus, duck, hide].map((n) => n.gain.events.length), others, 'the volume, the dip and the fade belong to their own gains');
  engine.setStage(Number.NaN, 1);
  engine.setStage(Infinity, 1);
  assert.equal(engine.state().stage, 1.4);
  engine.setStage(99, 1);
  assert.equal(engine.state().stage, 4, 'held to a sane ceiling');
  engine.setStage(-1, 1);
  assert.equal(engine.state().stage, 0);
});

test('the stage a film set before the engine had a graph is waiting on the new graph, and survives a replaced context', () => {
  const { engine } = setup();
  engine.setStage(0.4, 0.1);
  assert.equal(engine.env, null, 'no graph yet: the first tick makes it');
  engine.play('menu');
  engine.tick();
  assert.equal(engine.env.nodes.stage.gain.valueAt(0), 0.4, 'the graph is made with the stage as it was set');
  const ctx2 = new FakeAudioContext({ state: 'running', sampleRate: 8000 });
  sfx.init({ context: ctx2 });
  engine.tick();
  assert.equal(engine.ctx, ctx2);
  assert.equal(engine.env.nodes.stage.gain.valueAt(0), 0.4, 'and so is the replacement');
});

test('setStingers(false): the sounds in DUCKS no longer make the music step back, and setStingers(true) gives it back', () => {
  const { ctx, engine } = setup();
  sfx.last.clear(); // the sound engine is one object for the whole file: forget when the other tests played these
  sfx.active.clear();
  engine.play('menu');
  engine.tick();
  const duck = engine.env.nodes.duck.gain;
  assert.equal(engine.stingers, true, 'a match has them');
  engine.setStingers(false);
  const n = duck.events.length;
  for (const name of Object.keys(DUCKS)) {
    ctx.currentTime += 5;
    assert.equal(sfx.play(name), true, `${name} plays`);
  }
  assert.equal(duck.events.length, n, 'and the music does not move');
  engine.duck(0.5, 2);
  assert.ok(duck.events.length > n, 'duck() itself still works');
  engine.setStingers(true);
  const m = duck.events.length;
  ctx.currentTime += 5;
  sfx.play('horn');
  assert.ok(duck.events.length > m, 'with the stingers back, a horn does it again');
});

test('renderMusicOffline can follow a mix stage: one value curve over the whole render, from the function it is given', async () => {
  class Offline extends FakeAudioContext {
    constructor(channels, length, sampleRate) {
      super({ sampleRate });
      this.length = length;
    }
    startRendering() {
      return Promise.resolve(this);
    }
  }
  globalThis.OfflineAudioContext = Offline;
  try {
    const r = await renderMusicOffline('menu', { seconds: 6, sampleRate: 8000, stageAt: (t) => (t < 3 ? 1.4 : 0.4), levelAt: () => 0.5 });
    const curves = r.nodes.flatMap((n) => (n.gain ? n.gain.events.filter((e) => e[0] === 'curve').map((e) => [n, e]) : []));
    assert.equal(curves.length, 1, 'one curve, on one gain');
    const [node, e] = curves[0];
    assert.equal(e[2], 0);
    assert.equal(e[3], 6, 'over the whole render');
    assert.ok(Math.abs(node.gain.valueAt(1) - 1.4) < 1e-6 && Math.abs(node.gain.valueAt(5) - 0.4) < 1e-6);
    assert.ok(e[4] instanceof Float32Array && e[4].every(Number.isFinite), 'a legal curve');
    const plain = await renderMusicOffline('menu', { seconds: 2, sampleRate: 8000 });
    assert.equal(plain.nodes.filter((n) => n.gain && n.gain.events.some((x) => x[0] === 'curve')).length, 0, 'without stageAt there is no curve');
  } finally {
    delete globalThis.OfflineAudioContext;
  }
});

test('COMPOSE_AHEAD is the horizon the score is composed to (the film reads its story that far on)', () => {
  assert.equal(COMPOSE_AHEAD, 1.6);
});

test('state() says when only the browser\'s click is missing: a theme is wanted, nothing mutes it, audio is not running', () => {
  const { ctx, engine } = setup({ state: 'suspended' });
  assert.equal(engine.state().waiting, false, 'nothing wanted yet');
  engine.play('menu');
  engine.tick();
  assert.equal(engine.state().waiting, true, 'a click would start it');
  engine.mute(true);
  assert.equal(engine.state().waiting, false, 'a muted music is not waiting for anything');
  engine.mute(false);
  engine.setVolume(0);
  assert.equal(engine.state().waiting, false, 'nor one at volume zero');
  engine.setVolume(0.5);
  assert.equal(engine.state().waiting, true);
  ctx.state = 'running';
  engine.tick();
  assert.equal(engine.state().waiting, false, 'and once it plays, it is not');
  engine.stop();
  assert.equal(engine.state().waiting, false);
});

test('DUCKS names real sounds and sensible dips', () => {
  for (const [name, [depth, seconds]] of Object.entries(DUCKS)) {
    assert.ok(typeof name === 'string' && name.length > 1);
    assert.ok(depth > 0 && depth <= 1, `${name} depth`);
    assert.ok(seconds >= 1 && seconds <= 8, `${name} seconds`);
  }
});

test('the hidden tab fades the music out and the visible tab brings it back', () => {
  const handlers = {};
  globalThis.document = { hidden: false, addEventListener: (type, fn) => (handlers[type] = fn) };
  try {
    const { engine } = setup();
    engine.play('greek');
    engine.tick();
    const hide = engine.env.nodes.hide.gain;
    assert.equal(typeof handlers.visibilitychange, 'function');
    globalThis.document.hidden = true;
    handlers.visibilitychange();
    assert.equal(lastTarget(hide)[1], 0);
    assert.equal(engine.hidden, true);
    globalThis.document.hidden = false;
    handlers.visibilitychange();
    assert.equal(lastTarget(hide)[1], 1);
  } finally {
    delete globalThis.document;
  }
});

test('a hidden tab stops making notes once its fade is over, and the score resumes from the clock when it is shown', () => {
  const handlers = {};
  globalThis.document = { hidden: false, addEventListener: (type, fn) => (handlers[type] = fn) };
  try {
    const { ctx, engine } = setup();
    engine.play('greek');
    advance(ctx, engine, 6);
    globalThis.document.hidden = true;
    handlers.visibilitychange();
    advance(ctx, engine, 2.5); // the fade-out, and what was already composed ahead
    const made = ctx.sources.length;
    advance(ctx, engine, 30);
    assert.equal(ctx.sources.length, made, 'nothing new is created for a tab nobody can hear');
    assert.equal(engine.state().theme, 'greek', 'the piece is still the one on');
    globalThis.document.hidden = false;
    handlers.visibilitychange();
    const shownAt = ctx.currentTime;
    advance(ctx, engine, 3);
    assert.ok(ctx.sources.length > made, 'the music is back');
    assert.ok(ctx.sources.slice(made).every((s) => s.started >= shownAt - 1e-9), 'the bars missed while hidden are not played to catch up');
  } finally {
    delete globalThis.document;
  }
});

test('init() is idempotent and a second call only updates the volume', () => {
  const { engine } = setup({ volume: 0.3 });
  assert.equal(engine.volume, 0.3);
  engine.init({ volume: 0.8, muted: true });
  assert.equal(engine.volume, 0.8);
  assert.equal(engine.muted, true);
  engine.init({ volume: 7 });
  assert.equal(engine.volume, 1);
  engine.init({ volume: 'loud' });
  assert.equal(engine.volume, 1);
});

test('state() reports what a menu or a test needs', () => {
  const { ctx, engine } = setup();
  engine.setIntensity(0.4);
  engine.play('egyptian');
  advance(ctx, engine, 8);
  const s = engine.state();
  assert.equal(s.theme, 'egyptian');
  assert.equal(s.wanted, 'egyptian');
  assert.equal(s.target, 0.4);
  assert.equal(s.playing, true);
  assert.equal(s.ready, true);
  assert.equal(s.muted, false);
  assert.equal(s.volume, 0.5);
  assert.ok(s.bars >= 2);
});

test('a new audio context (the browser replaced it) rebuilds the music graph and plays on', () => {
  const { ctx, engine } = setup();
  engine.play('greek');
  advance(ctx, engine, 4);
  const ctx2 = new FakeAudioContext({ state: 'running', sampleRate: 8000 });
  sfx.init({ context: ctx2 });
  engine.tick();
  assert.equal(engine.ctx, ctx2);
  assert.ok(ctx2.sources.length > 0, 'the piece starts again on the new context');
  assert.equal(engine.state().theme, 'greek');
});
