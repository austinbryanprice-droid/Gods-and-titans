// The music director (src/game/music-director.js): what happens in the match becomes the music's
// battle intensity. A real ViewState is fed snapshots with events at chosen game times; the music
// is a stub that records what it was told.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MusicDirector, TensionMeter, HEAT, HEAT_TAU, HEAT_SCALE, PEACE_CEILING } from '../../src/game/music-director.js';
import { ViewState } from '../../src/game/view-state.js';
import { godsFor, titanFor } from '../../src/data/index.js';
import { makeWorld } from '../sim/helpers.js';

/** A match seen by player 0 (Greek; player 1 is Norse). */
function scene({ world: worldOpts = {}, myIndex = 0 } = {}) {
  const world = makeWorld(worldOpts);
  const base = JSON.parse(JSON.stringify(world.getSnapshot()));
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex });
  const calls = [];
  const music = {
    play: (id) => calls.push(['play', id]),
    setIntensity: (v) => calls.push(['intensity', v]),
  };
  const director = new MusicDirector({ viewState: vs, music }).attach();
  let seq = 0;
  let time = 0;
  const mine = base.entities.find((e) => e.k === 'u' && e.o === 0);
  const foe = base.entities.find((e) => e.k === 'u' && e.o === 1);
  const house = base.entities.find((e) => e.k === 'b' && e.o === 0);
  /** Show a snapshot at game time `t` carrying these events (and the edit). */
  const at = (t, events = [], edit) => {
    const snap = JSON.parse(JSON.stringify(base));
    time = t;
    snap.time = t;
    snap.tick = 1000 + ++seq;
    snap.events = events;
    if (edit) edit(snap);
    vs.pushSnapshot(snap, 50);
  };
  /** One game second of fighting: `n` blows on my units, a frame at the end. */
  const fight = (n, { dst = mine.id, src = foe.id } = {}) => {
    at(time, Array.from({ length: n }, () => ({ type: 'hit', dst, src, amount: 5 })));
    return director.update(1);
  };
  const last = () => calls.filter((c) => c[0] === 'intensity').at(-1)?.[1];
  return { world, vs, director, music, calls, at, fight, mine, foe, house, last };
}

test('the meter: heat adds up, cools by 1/e every tau seconds, and maps to 0..1', () => {
  const m = new TensionMeter();
  assert.equal(m.step(1), 0);
  m.add(HEAT_SCALE);
  assert.ok(Math.abs(m.level() - (1 - Math.exp(-1))) < 1e-9, 'one scale of heat is 63%');
  const before = m.heat;
  m.step(HEAT_TAU);
  assert.ok(Math.abs(m.heat - before / Math.E) < 1e-9);
  m.add(NaN);
  m.add(-5);
  m.add(undefined);
  assert.ok(Math.abs(m.heat - before / Math.E) < 1e-9, 'junk is ignored');
  m.add(1e9);
  assert.ok(m.level() < 1 && m.level() > 0.99, 'the heat is capped');
  m.reset();
  assert.equal(m.level(), 0);
  assert.equal(m.step(-5), 0, 'a negative step cools nothing and breaks nothing');
});

test('the theme starts with the first snapshot: my pantheon, a spectator hears the first player', () => {
  const s = scene();
  assert.deepEqual(s.calls, [], 'nothing before the first snapshot');
  s.at(0);
  assert.deepEqual(s.calls, [['play', 'greek'], ['intensity', 0]]);
  s.at(1);
  assert.equal(s.calls.filter((c) => c[0] === 'play').length, 1, 'only once');

  const norse = scene({ world: { pantheons: ['norse', 'greek'] } });
  norse.at(0);
  assert.deepEqual(norse.calls[0], ['play', 'norse']);

  const watcher = scene({ myIndex: -1 });
  watcher.at(0);
  assert.deepEqual(watcher.calls[0], ['play', 'greek']);
});

test('blows on my side heat the score; blows I strike heat it less; fights I cannot see add nothing', () => {
  const taking = scene();
  taking.at(0);
  const a = taking.fight(5);
  assert.ok(a > 0.05 && a < 0.2, `five blows taken: ${a}`);

  const giving = scene();
  giving.at(0);
  const b = giving.fight(5, { dst: giving.foe.id, src: giving.mine.id });
  assert.ok(b > 0 && b < a, `blows struck count for less than blows taken (${b} vs ${a})`);

  const far = scene();
  far.at(0);
  // Player 1's units fighting each other, out of my sight (the fresh world shows me only my own corner).
  const e2 = far.vs.entities.get(far.foe.id);
  assert.equal(far.vs.isVisibleAt(e2.x, e2.y), false, 'the enemy start is out of sight');
  const c = far.fight(20, { dst: far.foe.id, src: far.foe.id });
  assert.equal(c, 0, 'a fight I cannot see is no concern of the music');
});

test('the intensity follows the size of the fight: a skirmish is a groove, a battle is the drums', () => {
  const run = (perSecond, seconds = 14) => {
    const s = scene();
    s.at(0);
    let level = 0;
    for (let i = 0; i < seconds; i++) level = s.fight(perSecond);
    return level;
  };
  const skirmish = run(2);
  const clash = run(6);
  const battle = run(14);
  const war = run(30);
  assert.ok(skirmish > 0.15 && skirmish < 0.4, `a skirmish: ${skirmish}`);
  assert.ok(clash > 0.4 && clash < 0.75, `a clash: ${clash}`);
  assert.ok(battle > 0.62, `a battle: ${battle}`);
  assert.ok(war > battle && war <= 1, `a war: ${war}`);
});

test('the heat cools once the fighting stops, so the music settles back to calm', () => {
  const s = scene();
  s.at(0);
  for (let i = 0; i < 12; i++) s.fight(10);
  const hot = s.director.level;
  assert.ok(hot > 0.6, `after twelve seconds of ten blows a second: ${hot}`);
  let level = hot;
  let prev = hot;
  for (let i = 0; i < 40; i++) {
    level = s.director.update(1);
    assert.ok(level <= prev + 1e-12, 'never rises without new fighting');
    prev = level;
  }
  assert.ok(level < 0.08, `forty quiet seconds later: ${level}`);
  assert.equal(s.last(), level, 'the music was told');
});

test('shocks: an attack on me, a fallen god, a Titan rising, the peace ending', () => {
  const underMe = scene();
  underMe.at(0, [{ type: 'underAttack', player: 0, x: 8, y: 8, id: underMe.house.id }]);
  const a = underMe.director.update(0);
  assert.ok(Math.abs(a - (1 - Math.exp(-HEAT.underAttack / HEAT_SCALE))) < 1e-9, `an attack on me: ${a}`);

  const underAlly = scene();
  underAlly.at(0, [{ type: 'underAttack', player: 1, x: 8, y: 8, id: underAlly.foe.id }]);
  assert.equal(underAlly.director.update(0), 0, 'an attack on someone else is no alarm of mine');

  const god = godsFor('greek')[0].id;
  const fell = scene();
  fell.at(0, [{ type: 'death', id: 99, t: god, o: 0, x: 8, y: 8, k: 'u' }]);
  assert.ok(fell.director.update(0) > 0.45, 'a fallen god is a blow');
  const worker = scene();
  worker.at(0, [{ type: 'death', id: 99, t: worker.mine.t, o: 0, x: 8, y: 8, k: 'u' }]);
  const w = worker.director.update(0);
  assert.ok(w > 0 && w < 0.1, `a fallen Worshipper is a small one: ${w}`);
  const foeDied = scene();
  foeDied.at(0, [{ type: 'death', id: 99, t: foeDied.foe.t, o: 1, x: 8, y: 8, k: 'u' }]);
  assert.equal(foeDied.director.update(0), 0, "an enemy's death is quiet by itself");
  const lostHouse = scene();
  lostHouse.at(0, [{ type: 'death', id: lostHouse.house.id, t: lostHouse.house.t, o: 0, x: 8, y: 8, k: 'b' }]);
  assert.ok(lostHouse.director.update(0) > w, 'a lost building is heavier than a lost Worshipper');

  const titan = titanFor('norse').id;
  const rising = scene();
  rising.at(0, [{ type: 'titanSummoning', player: 1, t: titan }]);
  assert.ok(rising.director.update(0) > 0.45, "an enemy's Titan rising");
  const appeared = scene();
  appeared.at(0, [{ type: 'spawn', id: 77, t: titan, o: 1, x: 40, y: 40 }]);
  assert.ok(appeared.director.update(0) > 0.45, 'a Titan appearing');
  const soldier = scene();
  soldier.at(0, [{ type: 'spawn', id: 78, t: soldier.foe.t, o: 1, x: 40, y: 40 }]);
  assert.equal(soldier.director.update(0), 0, 'an ordinary unit appearing is not news');

  const war = scene();
  war.at(0, [{ type: 'peaceEnd' }]);
  assert.ok(war.director.update(0) > 0.5, 'war begins');
});

test('the Decade of Peace: skirmishes with creatures stay below the drums, and the horn of war lifts the ceiling', () => {
  const s = scene({ world: { peaceMinutes: 30 } });
  s.at(0);
  assert.equal(s.vs.peaceActive(), true);
  let level = 0;
  for (let i = 0; i < 20; i++) level = s.fight(25);
  assert.ok(level > 0.2 && level <= PEACE_CEILING + 1e-12, `heavy creature fighting in the peace: ${level}`);
  s.at(30 * 60 + 1, [{ type: 'peaceEnd' }]);
  assert.equal(s.vs.peaceActive(), false);
  const after = s.director.update(1);
  assert.ok(after > 0.8, `the ceiling is gone and the heat is still there: ${after}`);
});

test('a decided match is quiet: no new heat, and the meter is emptied', () => {
  const over = (snap) => { snap.gameOver = { winningTeam: 1 }; };
  const won = scene();
  won.at(0);
  for (let i = 0; i < 5; i++) won.fight(10);
  assert.ok(won.director.level > 0.4);
  won.at(5, [], over);
  assert.equal(won.director.update(1), 0);
  won.at(6, [{ type: 'hit', dst: won.mine.id, src: won.foe.id, amount: 3 }], over);
  assert.equal(won.director.update(1), 0, 'the last blows of a finished match add nothing');
  assert.equal(won.last(), 0, 'the music was told');

  const fallen = (snap) => { snap.players[0].defeated = true; };
  const lost = scene();
  lost.at(0);
  for (let i = 0; i < 5; i++) lost.fight(10);
  lost.at(5, [], fallen);
  assert.equal(lost.director.update(1), 0, 'a defeated player hears the calm');
  lost.at(6, [{ type: 'death', id: 99, t: lost.mine.t, o: 0, x: 8, y: 8, k: 'u' }], fallen);
  assert.equal(lost.director.update(1), 0, 'the whole army dying at once is not a crescendo');
});

test('update is robust: a long gap between frames cools by the gap, junk dt is harmless, dispose stops listening', () => {
  const s = scene();
  s.at(0, [{ type: 'peaceEnd' }]);
  const l0 = s.director.update(0);
  assert.ok(l0 > 0.5);
  assert.ok(s.director.update(600) < 0.001, 'ten minutes between frames (a hidden tab): long cold');
  s.at(1, [{ type: 'peaceEnd' }]);
  const l1 = s.director.update(0);
  assert.ok(Math.abs(l1 - l0) < 1e-9, 'and the next shock heats it afresh');
  assert.doesNotThrow(() => s.director.update(NaN));
  assert.doesNotThrow(() => s.director.update(-3));
  assert.doesNotThrow(() => s.director.update(undefined));
  s.director.dispose();
  const before = s.director.meter.heat;
  s.at(1, [{ type: 'peaceEnd' }]);
  assert.equal(s.director.meter.heat, before, 'no more events after dispose');
});

test('the music hears only real changes: a steady level is not repeated every frame', () => {
  const s = scene();
  s.at(0);
  const n = s.calls.length;
  for (let i = 0; i < 100; i++) s.director.update(1 / 60);
  assert.equal(s.calls.length, n, 'a calm match sends nothing more');
  s.at(1, [{ type: 'peaceEnd' }]);
  for (let i = 0; i < 100; i++) s.director.update(1 / 60);
  const sends = s.calls.length - n;
  assert.ok(sends >= 1 && sends <= 100, `${sends} updates for a fading level`);
  for (const [kind, v] of s.calls.slice(n)) assert.ok(kind === 'intensity' && v >= 0 && v <= 1);
});
