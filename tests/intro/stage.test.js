// The intro film's set (src/intro/stage.js): a seeded village and two armies on the real simulation,
// played in Node with no renderer. The whole film is run through, so what the script points the camera
// at (the god, the titan, the ten finale gods) is shown to exist when the shots need it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IntroStage, CUE_TIMES } from '../../src/intro/stage.js';
import { SHOTS, FILM_LENGTH } from '../../src/intro/script.js';
import { PANTHEON_LIST } from '../../src/data/index.js';
import { DT } from '../../src/config.js';

const STEP = 0.05;

/** Play the stage on to film second `t` (a frame is 0.05 s, the film's own pace on a fast machine). */
function runTo(stage, t) {
  while (stage.time + stage.acc < t - 1e-9) stage.advance(Math.min(STEP, t - stage.time - stage.acc));
}

/** What the film is made of, in one string: every unit's kind and place, so two runs can be compared. */
function fingerprint(stage) {
  return stage.world.unitList
    .filter((u) => !u.dead)
    .map((u) => `${u.owner}:${u.type}:${u.x.toFixed(2)},${u.y.toFixed(2)}:${Math.round(u.hp)}`)
    .sort()
    .join('|');
}

test('the set: a Greek village with its temple and Titan Gate, two armies, the anchors the script uses', () => {
  const stage = new IntroStage();
  const w = stage.world;
  const types = new Set(w.buildingsOf(0).map((b) => b.type));
  for (const t of ['town_center', 'temple', 'titan_gate', 'barracks', 'house', 'storehouse', 'shrine', 'tower']) assert.ok(types.has(t), `the village has a ${t}`);
  assert.ok(w.unitsOf(0).length >= 25 && w.unitsOf(1).length >= 20, 'two armies and a village at work');
  assert.equal(stage.vs.myIndex, -1, 'a spectator: nothing is hidden');
  assert.equal(w.mapData.camps.length, 0, 'no neutral creatures');
  const { width, height } = w.mapData;
  for (const [name, a] of Object.entries(stage.anchors)) {
    assert.ok(a.x > 0 && a.y > 0 && a.x < width && a.y < height, `${name} is on the map`);
  }
});

test('every place the script points the camera at is an anchor, an actor of the stage, or the crowd', () => {
  const stage = new IntroStage();
  const named = new Set();
  for (const s of SHOTS) for (const c of s.cam) named.add(c.at);
  for (const name of named) {
    const known = name === 'crowd' || name in stage.anchors || ['zeus', 'kronos', 'surtr', 'thor'].includes(name);
    assert.ok(known, `the script looks at "${name}"`);
  }
});

test('the film runs from start to end without a failure, a runaway tick or an emptied stage', () => {
  const stage = new IntroStage();
  let ticks = 0;
  const run = stage.advance.bind(stage);
  stage.advance = (dt) => {
    const n = run(dt);
    ticks += n;
    return n;
  };
  runTo(stage, FILM_LENGTH);
  assert.ok(Math.abs(stage.time - FILM_LENGTH) < DT * 2, `ran ${stage.time} s`);
  assert.ok(ticks >= Math.floor(FILM_LENGTH / DT) - 2 && ticks <= Math.ceil(FILM_LENGTH / DT) + 2, `${ticks} ticks`);
  assert.ok(stage.world.unitsOf(0).length > 10, 'the Greeks still stand');
});

test('the cast arrives on cue: Zeus at the temple, the two titans from their gates, ten gods at the end', () => {
  const stage = new IntroStage();
  const t = CUE_TIMES;
  runTo(stage, t.summon - 0.3);
  assert.equal(stage.actor('zeus'), null, 'no god before the prayer is answered');
  runTo(stage, t.summon + 0.3);
  const zeus = stage.actor('zeus');
  assert.ok(zeus, 'Zeus is there');
  assert.equal(zeus.owner, 0);
  assert.equal(zeus.def.class, 'god');
  const temple = stage.anchors.temple;
  assert.ok(Math.hypot(zeus.x - temple.x, zeus.y - temple.y) < 6, 'at the temple');

  runTo(stage, t.titans - 0.3);
  assert.equal(stage.actor('kronos'), null);
  runTo(stage, t.titans + 0.5);
  assert.equal(stage.actor('kronos').def.class, 'titan');
  assert.equal(stage.actor('surtr').def.class, 'titan');
  assert.notEqual(stage.actor('kronos').owner, stage.actor('surtr').owner);

  runTo(stage, t.lineup - 0.3);
  assert.equal(stage.finale.size, 0);
  runTo(stage, FILM_LENGTH);
  assert.equal(stage.finale.size, PANTHEON_LIST.length, 'a god of every mythology');
  const gods = [...stage.finale].map((id) => stage.world.getEntity(id));
  assert.ok(gods.every((g) => g && !g.dead && g.def.class === 'god' && g.owner === 0), 'all alive, all on the player\'s side');
  assert.equal(new Set(gods.map((g) => g.type)).size, PANTHEON_LIST.length, 'ten different gods');
  assert.deepEqual(new Set(gods.map((g) => g.type)), new Set(PANTHEON_LIST.map((p) => p.gods[0].id)), 'each pantheon\'s first god');
});

test('the finale: the war is over, and the ten gods stand where they were summoned', () => {
  const stage = new IntroStage();
  runTo(stage, CUE_TIMES.lineup + 3.5); // the last god has just arrived
  assert.equal(stage.world.unitsOf(1).length, 0, 'no enemy left to draw them in');
  const gods = [...stage.finale].map((id) => stage.world.getEntity(id));
  assert.equal(gods.length, PANTHEON_LIST.length);
  const where = gods.map((g) => [g.x, g.y]);
  runTo(stage, FILM_LENGTH);
  gods.forEach((g, i) => {
    assert.ok(!g.dead, `${g.type} lives`);
    assert.ok(Math.hypot(g.x - where[i][0], g.y - where[i][1]) < 0.75, `${g.type} stays in line`);
  });
  // two ranks, in a line the camera can frame: the whole line is within 25 tiles
  const xs = gods.map((g) => g.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) < 25 && Math.max(...xs) - Math.min(...xs) > 8, 'a line of gods');
});

test('the lineup\'s meadow is open ground: no god is standing in a forest', () => {
  const stage = new IntroStage();
  const { map } = stage.world;
  runTo(stage, FILM_LENGTH);
  for (const id of stage.finale) {
    const g = stage.world.getEntity(id);
    assert.ok(map.isPassable(Math.floor(g.x), Math.floor(g.y)), `${g.type} is on passable ground`);
  }
});

test('the same film every time: two stages run alike', () => {
  const a = new IntroStage();
  const b = new IntroStage();
  runTo(a, 30);
  runTo(b, 30);
  assert.equal(fingerprint(a), fingerprint(b));
});

test('crowd(): between the armies at the start, on the fight while it lasts, always a finite place', () => {
  const stage = new IntroStage();
  const f = stage.anchors.field;
  const c0 = stage.crowd();
  assert.ok(Math.abs(c0.x - f.x) < 8 && Math.abs(c0.y - f.y) < 6, `at the field: ${c0.x}, ${c0.y}`);
  for (let t = 5; t <= FILM_LENGTH; t += 5) {
    runTo(stage, t);
    const c = stage.crowd();
    assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y) && c.n > 0, `crowd at ${t}s`);
  }
});

test('the stage is quiet: no level-up, rank, bounty or error text reaches the view', () => {
  const stage = new IntroStage();
  const seen = new Set();
  const push = stage.vs.pushSnapshot.bind(stage.vs);
  stage.vs.pushSnapshot = (snap, now, extra) => {
    for (const e of snap.events) seen.add(e.type);
    return push(snap, now, extra);
  };
  runTo(stage, FILM_LENGTH);
  for (const quiet of ['levelUp', 'rankUp', 'bounty', 'error']) assert.ok(!seen.has(quiet), `${quiet} is filtered`);
  assert.ok(seen.size > 0, 'but the fight\'s own events (attacks, deaths, spells) still go through');
});

test('density thins the cast for the low quality tier, and never below a third of it', () => {
  const full = new IntroStage({ density: 1 });
  const thin = new IntroStage({ density: 0.6 });
  assert.ok(thin.world.unitList.length < full.world.unitList.length, 'fewer units');
  const floor = new IntroStage({ density: 0 });
  assert.equal(floor.density, 0.3);
  runTo(thin, 25);
  assert.ok(thin.world.unitList.some((u) => !u.dead), 'and still a film');
});

test('a stalled frame does not make the simulation catch up for seconds', () => {
  const stage = new IntroStage();
  const ticks = stage.advance(5); // a tab that was away
  assert.ok(ticks <= 12, `${ticks} ticks in one advance`);
  assert.equal(stage.advance(0), 0);
  assert.equal(stage.advance(-1), 0);
  assert.equal(stage.advance(NaN), 0);
});
