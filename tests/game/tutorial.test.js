// The guided first match (DESIGN 5.12, 9.2): its setup and board, the sleeping raiders, and a
// scripted learner who follows every objective in order through a real HostSession and wins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../../src/sim/world.js';
import { findPlacement } from '../../src/sim/construction.js';
import { HostSession } from '../../src/net/session.js';
import { createAI } from '../../src/ai/ai.js';
import { TUTORIAL, tutorialSetup, isTutorial } from '../../src/sim/tutorial.js';
import { TutorialDirector, TUTORIAL_STEPS, medalFor, MEDALS } from '../../src/game/tutorial.js';
import { TERRAIN } from '../../src/config.js';

const TPS = 20;

test('the tutorial setup: one learner against a sleeping camp, on a fixed small map', () => {
  const s = tutorialSetup({ name: 'Ada' });
  assert.equal(isTutorial(s), true);
  assert.equal(isTutorial({ players: [] }), false);
  assert.equal(s.seed, TUTORIAL.seed);
  assert.equal(s.mapSize, 'small');
  assert.deepEqual(s.players.map((p) => [p.name, p.kind, p.team, p.difficulty]), [['Ada', 'human', 1, null], [TUTORIAL.enemyName, 'ai', 2, 'tutorial']]);
});

test('the tutorial board: a head start, no creeps, a weaker guarded Town Center for the raiders', () => {
  const w = createWorld(tutorialSetup());
  const [me, raiders] = w.players;
  assert.deepEqual([me.gold, me.wood, me.faith], [TUTORIAL.start.gold, TUTORIAL.start.wood, TUTORIAL.start.faith]);
  assert.deepEqual([raiders.gold, raiders.wood, raiders.faith], [400, 200, 50]);
  assert.equal(w.unitList.filter((u) => u.owner < 0).length, 0, 'no neutral creeps');
  const tc = w.buildingList.find((b) => b.owner === 1 && b.type === 'town_center');
  assert.equal(tc.hp, TUTORIAL.enemyTownHp);
  assert.equal(tc.maxHp, TUTORIAL.enemyTownHp);
  const guards = w.unitList.filter((u) => u.owner === 1 && u.def.class !== 'worker');
  assert.equal(guards.length, TUTORIAL.guards.reduce((n, [, k]) => n + k, 0));
  for (const g of guards) assert.ok(Math.hypot(g.x - tc.x, g.y - tc.y) < 6, 'a guard stands by the Town Center');
  // Each start has its mine close by and a forest edge within a short walk.
  w.players.forEach((p, i) => {
    const home = w.buildingList.find((b) => b.owner === i && b.type === 'town_center');
    const mine = w.mineList[i];
    assert.ok(Math.hypot(mine.x - home.x, mine.y - home.y) < 9, `player ${i}'s mine is close`);
    let near = Infinity;
    for (let y = 0; y < w.map.height; y++) {
      for (let x = 0; x < w.map.width; x++) if (w.map.terrain[y * w.map.width + x] === TERRAIN.FOREST) near = Math.min(near, Math.hypot(x + 0.5 - home.x, y + 0.5 - home.y));
    }
    assert.ok(near < 14, `player ${i}'s forest is ${near.toFixed(1)} tiles away`);
  });
});

test('medals go by the time of the victory', () => {
  assert.equal(medalFor(5 * 60).id, 'gold');
  assert.equal(medalFor(MEDALS[0].within).id, 'gold');
  assert.equal(medalFor(MEDALS[0].within + 1).id, 'silver');
  assert.equal(medalFor(60 * 60).id, 'bronze');
  assert.equal(medalFor(NaN).id, 'bronze');
});

/**
 * A learner who does what each objective asks, as soon as it can. Returns the game time of each
 * finished step and the director at the end.
 */
function playThrough() {
  const setup = tutorialSetup({ name: 'Learner' });
  const session = new HostSession({ setup, myIndex: 0, createWorld, createAI, autoTick: false, useWorker: false });
  const w = session.world;
  const vs = session.viewState;
  let selected = [];
  const times = {};
  const director = new TutorialDirector({ viewState: vs, getSelection: () => selected, onStep: (next, i, prev) => (times[prev.id] = vs.time) });
  const cmd = (c) => session.sendCommand(c);
  const mine = (ids) => ids.filter((id) => w.entities.get(id) && !w.entities.get(id).dead);
  const workers = () => w.unitList.filter((u) => u.owner === 0 && !u.dead && u.def.class === 'worker').map((u) => u.id);
  const home = w.buildingList.find((b) => b.owner === 0 && b.type === 'town_center');
  const goldMine = w.mineList[0];
  const own = (type) => w.buildingList.find((b) => b.owner === 0 && b.type === type && !b.dead);
  const place = (type, ids) => {
    const spot = findPlacement(w, 0, type, home.x, home.y, 16);
    assert.ok(spot, `room for a ${type}`);
    cmd({ type: 'build', units: ids, building: type, tx: spot.tx, ty: spot.ty });
  };
  const forest = () => {
    let best = null;
    let bd = Infinity;
    for (let y = 0; y < w.map.height; y++) {
      for (let x = 0; x < w.map.width; x++) {
        if (w.map.terrain[y * w.map.width + x] !== TERRAIN.FOREST) continue;
        const d = Math.hypot(x + 0.5 - home.x, y + 0.5 - home.y);
        if (d < bd) [bd, best] = [d, { tx: x, ty: y }];
      }
    }
    return best;
  };
  const step = (seconds) => {
    session.step(Math.round(seconds * TPS));
    director.update();
  };

  const start = workers();
  const [m1, m2, m3, c1, c2] = start;
  let builder = c1;
  let extra = [];
  let sentAttack = false;
  for (let guard = 0; guard < 30 * 60 && !vs.gameOver; guard++) {
    const p = w.players[0];
    const s = director.current && director.current.id;
    if (s === 'select') selected = start.slice();
    else if (s === 'mine') cmd({ type: 'gather', units: [m1, m2, m3], target: goldMine.id });
    else if (s === 'wood') {
      cmd({ type: 'gather', units: [c1, c2], ...forest() });
      cmd({ type: 'train', building: home.id, unit: 'worshipper' });
      cmd({ type: 'train', building: home.id, unit: 'worshipper' });
      cmd({ type: 'rally', building: home.id, x: goldMine.x, y: goldMine.y, target: goldMine.id });
    } else if (s === 'house' && !own('house')) place('house', [builder]);
    else if (s === 'shrine' && !own('shrine') && p.gold >= 100 && p.wood >= 50) place('shrine', [builder]);
    else if (s === 'pray') {
      extra = mine(workers().filter((id) => !start.includes(id)));
      const shrine = own('shrine');
      const who = extra.length >= 2 ? extra.slice(0, 2) : [m3, c2];
      cmd({ type: 'pray', units: who, target: shrine.id });
    } else if (s === 'temple' && !own('temple') && p.gold >= 220 && p.wood >= 120) place('temple', [builder]);
    else if (s === 'god' && p.faith >= 200 && p.gold >= 100 && !own('temple').queue.length) cmd({ type: 'train', building: own('temple').id, unit: 'greek_zeus' });
    else if (s === 'god' && !own('barracks') && p.gold >= 280 && p.wood >= 60) place('barracks', [builder]);
    else if (s === 'barracks' && !own('barracks') && p.gold >= 180 && p.wood >= 60) place('barracks', [builder]);
    else if (s === 'army') {
      const b = own('barracks');
      const queued = b.queue.length + w.unitList.filter((u) => u.owner === 0 && !u.dead && u.def.producedAt === 'barracks').length;
      if (queued < 4 && p.gold >= 135) cmd({ type: 'train', building: b.id, unit: 'warrior' });
    } else if (s === 'attack' && !sentAttack) {
      sentAttack = true;
      const army = w.unitList.filter((u) => u.owner === 0 && !u.dead && u.def.class !== 'worker').map((u) => u.id);
      const tc = w.buildingList.find((b) => b.owner === 1 && b.type === 'town_center');
      cmd({ type: 'attackMove', units: army, x: tc.x, y: tc.y });
    } else if (s === 'attack' && guard % 10 === 0) {
      const army = w.unitList.filter((u) => u.owner === 0 && !u.dead && u.def.class !== 'worker' && u.state === 'idle').map((u) => u.id);
      const target = w.buildingList.find((b) => b.owner === 1 && !b.dead);
      if (army.length && target) cmd({ type: 'attack', units: army, target: target.id });
    }
    if (builder && !w.entities.get(builder)) builder = mine(workers())[0];
    step(1);
  }
  session.stop();
  return { times, director, vs, session };
}

test('a learner who follows every objective wins and earns a medal', () => {
  const { times, director, vs } = playThrough();
  assert.deepEqual(Object.keys(times), TUTORIAL_STEPS.map((s) => s.id), `finished: ${JSON.stringify(times)}`);
  assert.ok(vs.gameOver && vs.gameOver.winningTeam === 1, 'the learner won');
  assert.equal(director.finished, true);
  assert.equal(director.medal.id, 'gold', `won at ${Math.round(director.finishedAt)} s`);
  // eslint-disable-next-line no-console
  if (process.env.TUTORIAL_TIMES) console.log(Object.entries(times).map(([k, t]) => `${k} ${Math.round(t)}s`).join(', '));
});

test('the director points at the right spots and lights the right buttons', () => {
  const setup = tutorialSetup();
  const session = new HostSession({ setup, myIndex: 0, createWorld, createAI, autoTick: false, useWorker: false });
  const vs = session.viewState;
  let selected = [];
  const director = new TutorialDirector({ viewState: vs, getSelection: () => selected });
  session.step(2);
  director.update();
  assert.equal(director.current.id, 'select');
  const t0 = director.target();
  const tc = session.world.buildingList.find((b) => b.owner === 0);
  assert.ok(Math.hypot(t0.x - tc.x, t0.y - tc.y) < 5, 'the arrow starts on the Worshippers by the Town Center');
  selected = session.world.unitList.filter((u) => u.owner === 0).map((u) => u.id);
  director.update();
  assert.equal(director.current.id, 'mine');
  const mine = session.world.mineList[0];
  assert.deepEqual(director.target(), { x: mine.x, y: mine.y });
  assert.equal(director.view().progress, '0/3');
  // Jump ahead: the god step lights the Temple's god buttons, the last points at the raiders.
  director.index = TUTORIAL_STEPS.findIndex((s) => s.id === 'god');
  director.update();
  assert.deepEqual(director.view().guide, ['train:greek_zeus', 'train:greek_athena', 'train:greek_poseidon', 'train:greek_hades']);
  assert.match(director.view().text, /200 Faith/);
  director.index = TUTORIAL_STEPS.length - 1;
  director.update();
  const enemy = session.world.buildingList.find((b) => b.owner === 1);
  assert.deepEqual(director.target(), { x: enemy.x, y: enemy.y });
  session.stop();
});

test('the raiders send their Worshippers to the mine and otherwise sleep', () => {
  const w = createWorld(tutorialSetup());
  const ai = createAI(w, 1, 'tutorial');
  for (let i = 0; i < 40 * TPS; i++) {
    ai.tick();
    w.tick();
  }
  const raiders = w.unitList.filter((u) => u.owner === 1 && !u.dead && u.def.class === 'worker');
  assert.ok(raiders.some((u) => u.carry > 0 || u.state === 'gather' || u.state === 'return'), 'they mine');
  assert.equal(w.buildingList.filter((b) => b.owner === 1).length, 1, 'they build nothing');
  assert.equal(w.unitList.filter((u) => u.owner === 1 && !u.dead).length, 5 + 4, 'they train nothing');
});
