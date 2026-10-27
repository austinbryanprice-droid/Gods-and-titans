// The music engine (src/audio/music.js) against a strict fake AudioContext: it must wait for the
// browser to allow audio, follow the theme it is asked for, crossfade, ease the intensity, obey
// volume, mute and the hidden tab, step back under big sounds, schedule only ahead of the clock
// and never hand the browser a value it would throw on. The score itself is checked in
// music-composer.test.js.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext, reaches } from './fake-audio.js';
import { sfx } from '../../src/audio/sfx.js';
import { MusicEngine, DUCKS, MUSIC_GAIN, MUSIC_THEME_IDS } from '../../src/audio/music.js';
import { THEMES } from '../../src/audio/music-themes.js';

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
