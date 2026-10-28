// Campaign missions in the sim (src/sim/campaign.js): the setup, the board each mission starts from, the scripted
// events, the objectives and how a mission ends, the snapshot record the HUD reads, and that the sim stays a pure
// function of setup + commands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../../src/sim/world.js';
import { createAI } from '../../src/ai/ai.js';
import { campaignSetup, campaignOn, missionOf, DONE, FAILED, OPEN } from '../../src/sim/campaign.js';
import { MISSIONS, MISSION_BY_ID } from '../../src/data/campaign.js';

function world(id) {
  return createWorld(campaignSetup(id, { name: 'Ada' }));
}

function run(w, seconds, ais = []) {
  const end = w.time + seconds;
  while (!w.gameOver && w.time < end - 1e-9) {
    for (const a of ais) a.tick();
    w.tick();
  }
}

const tagged = (w, tag) => w.buildingList.filter((b) => !b.dead && b.cTag === tag).concat(w.unitList.filter((u) => !u.dead && u.cTag === tag));

test('a mission setup is a solo game: the hero as player 0, the mission\'s computer players after', () => {
  const s = campaignSetup('twilight', { name: 'Ada', version: '9.9.9' });
  assert.equal(s.campaign, 'twilight');
  assert.equal(s.version, '9.9.9');
  assert.equal(s.players.length, 3);
  assert.deepEqual(s.players.map((p) => [p.kind, p.team, p.pantheon]), [['human', 1, 'greek'], ['ai', 2, 'norse'], ['ai', 1, 'egyptian']]);
  assert.equal(s.players[0].name, 'Ada');
  assert.ok(campaignOn(s));
  assert.equal(missionOf(s), MISSION_BY_ID.twilight);
  assert.equal(campaignOn({ campaign: 'nope' }), false);
  assert.equal(campaignOn({}), false);
  assert.throws(() => campaignSetup('nope'));
});

test('each mission starts from its own board: purses, tagged buildings, units, and a guarded or weakened Town Center', () => {
  for (const m of MISSIONS) {
    const w = world(m.id);
    m.start.forEach((s, i) => {
      const p = w.players[i];
      for (const r of ['gold', 'wood', 'faith']) if (Number.isFinite(s[r])) assert.equal(p[r], s[r], `${m.id} p${i} ${r}`);
      for (const b of s.buildings || []) assert.ok(w.buildingList.some((x) => x.owner === i && x.type === b.type && x.constructed && (!b.tag || x.cTag === b.tag)), `${m.id} p${i} has a ${b.type}`);
      if (s.townHp) assert.equal(w.buildingList.find((b) => b.owner === i && b.type === 'town_center').maxHp, s.townHp);
    });
    assert.equal(tagged(w, 'home').length, 1, `${m.id}: the hero's Town Center is tagged`);
    for (const o of m.objectives.filter((x) => x.kind === 'destroy' || x.kind === 'protect')) assert.ok(tagged(w, o.tag).length > 0, `${m.id}/${o.id}`);
    const creeps = w.unitList.filter((u) => u.owner < 0).length;
    if (m.creeps === false) assert.equal(creeps, 0, `${m.id} has no creep camps`);
    const snap = w.getSnapshot();
    assert.ok(snap.cp && snap.cp.o.length === m.objectives.length, `${m.id} snapshot record`);
    assert.ok(snap.cp.o.every(([s]) => s === OPEN));
  }
});

test('a timed raid comes ashore, shows its objective, and killing it (with the Temple and a god) wins the first mission', () => {
  const w = world('shore');
  const m = MISSION_BY_ID.shore;
  const raid = m.objectives.findIndex((o) => o.id === 'raid');
  assert.equal(w.campaign.shown[raid], false, 'hidden before the raid');
  run(w, 271);
  assert.equal(w.campaign.shown[raid], true);
  const raiders = tagged(w, 'raid');
  assert.equal(raiders.length, 6);
  assert.ok(raiders.every((u) => u.owner === 1 && u.order), 'they march');
  // Do the rest by hand: a Temple and a god for the hero, the raiders dead.
  const tc = w.buildingList.find((b) => b.cTag === 'home');
  const spot = { tx: Math.floor(tc.x) + 6, ty: Math.floor(tc.y) + 6 };
  w.createBuilding(0, 'temple', spot.tx, spot.ty, true, true);
  w.spawnUnit(0, 'greek_athena', tc.x + 3, tc.y + 3);
  for (const u of raiders) w.killEntity(u, null);
  run(w, 2);
  assert.deepEqual(w.gameOver, { winningTeam: 1, how: 'campaign' });
  assert.equal(w.campaign.state[raid], DONE);
  assert.equal(w.getSnapshot().cp.o[raid][0], DONE);
});

test('losing a protected building fails the mission', () => {
  const w = world('pass');
  const oracle = w.buildingList.find((b) => b.cTag === 'oracle');
  w.killEntity(oracle, null);
  run(w, 2);
  assert.deepEqual(w.gameOver, { winningTeam: 2, how: 'campaign' });
  const i = MISSION_BY_ID.pass.objectives.findIndex((o) => o.id === 'oracle');
  assert.equal(w.campaign.state[i], FAILED);
});

test('holding out to the clock wins The Narrow Pass; the Spartans march in on time', () => {
  const w = world('pass');
  // Keep the waves off so the clock decides.
  for (const e of w.campaign.m.events) if (e.spawn && e.spawn.owner === 1) w.campaign.fired[w.campaign.m.events.indexOf(e)] = true;
  run(w, 301);
  assert.equal(tagged(w, 'sparta1').length, 4, 'reinforcements at 5:00');
  assert.equal(w.gameOver, null);
  run(w, 300);
  assert.deepEqual(w.gameOver, { winningTeam: 1, how: 'campaign' });
});

test('beating every enemy wins a mission whatever is left undone; the hero beaten loses it', () => {
  const a = world('longhouses');
  for (const b of a.buildingList.filter((x) => x.owner === 1)) a.killEntity(b, null);
  run(a, 2);
  assert.deepEqual(a.gameOver, { winningTeam: 1, how: 'campaign' });
  const b = world('groves');
  for (const x of b.buildingList.filter((y) => y.owner === 0)) b.killEntity(x, null);
  run(b, 2);
  assert.equal(b.gameOver.winningTeam, 2);
});

test('sacred ground counts the seconds held without a break', () => {
  const w = world('groves');
  const o = MISSION_BY_ID.groves.objectives[0];
  const hold = (n) => w.sites.forEach((s, i) => (s.owner = i < n ? 0 : -1));
  run(w, 1);
  hold(3);
  // (No worshipper stands on them, so the sites would decay: pin them every second.)
  for (let s = 0; s < 30; s++) {
    hold(3);
    run(w, 1);
  }
  assert.ok(w.campaign.held >= 29, `held ${w.campaign.held}`);
  hold(2);
  run(w, 1);
  assert.equal(w.campaign.held, 0, 'a break starts the count again');
  for (let s = 0; s < o.seconds + 2 && !w.gameOver; s++) {
    hold(3);
    run(w, 1);
  }
  assert.deepEqual(w.gameOver, { winningTeam: 1, how: 'campaign' });
});

test('Surtr wakes on the last mission\'s clock, owned by the north, and the pointer follows the objective', () => {
  const w = world('twilight');
  const e = w.campaign.m.events.find((x) => x.spawn && x.spawn.tag === 'surtr');
  w.time = e.at - 0.5;
  run(w, 1);
  const surtr = tagged(w, 'surtr');
  assert.equal(surtr.length, 1);
  assert.equal(surtr[0].type, 'norse_surtr');
  assert.equal(surtr[0].owner, 1);
  run(w, 1);
  const cp = w.getSnapshot().cp;
  assert.ok(Array.isArray(cp.at), 'a spot to point at');
});

test('a mission plays the same twice from the same setup and AIs', () => {
  const play = () => {
    const s = campaignSetup('shore', {});
    s.players[0].kind = 'ai';
    s.players[0].difficulty = 'normal';
    const w = createWorld(s);
    const ais = s.players.map((p, i) => createAI(w, i, p.difficulty));
    run(w, 330, ais);
    return JSON.stringify([w.gameOver, w.tickCount, w.campaign.state, w.unitList.length]);
  };
  assert.equal(play(), play());
});

test('a computer playing the hero wins the first mission in good time', () => {
  const s = campaignSetup('shore', {});
  s.players[0].kind = 'ai';
  s.players[0].difficulty = 'normal';
  const w = createWorld(s);
  const ais = s.players.map((p, i) => createAI(w, i, p.difficulty));
  run(w, 15 * 60, ais);
  assert.deepEqual(w.gameOver, { winningTeam: 1, how: 'campaign' });
  assert.ok(w.time < 10 * 60, `won at ${w.time}`);
  assert.equal(w.perf.commandErrors, 0);
});

test('a protected building lost on the same second as the last enemy still fails the mission', () => {
  const w = world('pass');
  w.killEntity(w.buildingList.find((b) => b.cTag === 'oracle'), null);
  for (const b of w.buildingList.filter((x) => x.owner === 1)) w.killEntity(b, null);
  run(w, 2);
  assert.equal(w.gameOver.winningTeam, 2);
  const i = MISSION_BY_ID.pass.objectives.findIndex((o) => o.id === 'oracle');
  assert.equal(w.campaign.state[i], FAILED);
});

test('the enemy AI leaves a scripted raid on its march at the hero', () => {
  const s = campaignSetup('longhouses', {});
  const w = createWorld(s);
  const ais = s.players.map((p, i) => (i === 0 ? null : createAI(w, i, p.difficulty))).filter(Boolean);
  run(w, 421, ais);
  const raid = tagged(w, 'huscarls');
  assert.equal(raid.length, 6);
  run(w, 5, ais);
  const home = w.buildingList.find((b) => b.cTag === 'home');
  for (const u of raid.filter((x) => !x.dead)) {
    const o = u.order;
    assert.ok(o && o.type === 'attackMove', `${u.type} still marching`);
    assert.ok(Math.hypot(o.x - home.x, o.y - home.y) < 15, `${u.type} heads for the hero's base`);
  }
});
