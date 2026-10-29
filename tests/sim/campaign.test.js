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

test('an objective with a limit fails the mission when time runs out, and counts if done in time', () => {
  const w = world('lyngvi');
  const i = MISSION_BY_ID.lyngvi.objectives.findIndex((o) => o.id === 'shrines');
  const limit = MISSION_BY_ID.lyngvi.objectives[i].limit;
  w.time = limit - 2;
  w.tickCount = Math.round(w.time * 20);
  run(w, 1);
  assert.equal(w.gameOver, null, 'still in time');
  run(w, 3);
  assert.deepEqual(w.gameOver, { winningTeam: 2, how: 'campaign' });
  assert.equal(w.campaign.state[i], FAILED);
  const b = world('lyngvi');
  for (const s of tagged(b, 'serpent')) b.killEntity(s, null);
  run(b, 2);
  assert.deepEqual(b.gameOver, { winningTeam: 1, how: 'campaign' });
  assert.equal(b.campaign.state[i], DONE);
});

test('Chapter II: the raid makes for the winter stores, and losing them fails the mission', () => {
  const w = world('hordaland');
  const stores = tagged(w, 'stores');
  assert.equal(stores.length, 1);
  assert.equal(stores[0].type, 'storehouse');
  assert.equal(stores[0].owner, 0);
  run(w, 271);
  const raid = tagged(w, 'raid');
  assert.equal(raid.length, 6);
  for (const u of raid) assert.ok(u.order && Math.hypot(u.order.x - stores[0].x, u.order.y - stores[0].y) < 6, 'aimed at the stores');
  w.killEntity(stores[0], null);
  run(w, 2);
  assert.equal(w.gameOver.winningTeam, 2);
});

test('Chapter II ends with Loki on Vigrid: he walks for the north at 13:00, the Greeks beside the hero against two northern players', () => {
  const s = campaignSetup('vigrid', {});
  assert.deepEqual(s.players.map((p) => [p.team, p.pantheon]), [[1, 'norse'], [2, 'norse'], [1, 'greek'], [2, 'norse']]);
  const w = world('vigrid');
  const e = w.campaign.m.events.find((x) => x.spawn && x.spawn.tag === 'loki');
  w.time = e.at - 0.5;
  run(w, 1);
  const loki = tagged(w, 'loki');
  assert.equal(loki.filter((u) => u.type === 'norse_loki').length, 1);
  assert.ok(loki.every((u) => u.owner === 1));
  const k = w.campaign.m.objectives.findIndex((o) => o.id === 'loki');
  assert.equal(w.campaign.shown[k], true);
});

test('The Burning Bridge: razing Helheim\'s town early does not win it; the hold still runs out to Heimdall\'s horn', () => {
  const w = world('bifrost');
  for (const b of w.buildingList.filter((x) => x.owner === 1)) w.killEntity(b, null);
  run(w, 2);
  assert.equal(w.players[1].defeated, true);
  assert.equal(w.gameOver, null, 'not over before the horn');
  const hold = w.campaign.m.objectives.findIndex((o) => o.id === 'hold');
  assert.equal(w.campaign.state[hold], OPEN);
  w.time = 538;
  run(w, 1);
  assert.equal(w.gameOver, null);
  run(w, 3);
  assert.equal(w.campaign.state[hold], DONE);
  assert.deepEqual(w.gameOver, { winningTeam: 1, how: 'campaign' });
  assert.ok(tagged(w, 'asgard').length > 0, 'the host of Asgard came down');
});

test('Ragnarök: breaking Loki\'s host early does not win it; Loki still comes at 13:00 and must fall', () => {
  const w = world('vigrid');
  const lokiHome = w.campaign.homes[1];
  for (const b of w.buildingList.filter((x) => x.owner === 1 || x.owner === 3)) w.killEntity(b, null);
  run(w, 2);
  assert.equal(w.gameOver, null, 'not over without Loki');
  const conquer = w.campaign.m.objectives.findIndex((o) => o.id === 'conquer');
  const loki = w.campaign.m.objectives.findIndex((o) => o.id === 'loki');
  assert.equal(w.campaign.state[conquer], DONE);
  assert.equal(w.campaign.state[loki], OPEN);
  w.time = 779.5;
  run(w, 2);
  const host = tagged(w, 'loki');
  const god = host.find((u) => u.type === 'norse_loki');
  assert.ok(god && god.owner === 1, 'Loki walks for his beaten host');
  assert.ok(Math.hypot(god.x - lokiHome.x, god.y - lokiHome.y) < 12, 'from where its Town Center stood');
  assert.equal(w.campaign.shown[loki], true);
  run(w, 5);
  assert.equal(w.gameOver, null, 'not over while Loki lives');
  for (const u of tagged(w, 'loki')) w.killEntity(u, null);
  run(w, 2);
  assert.equal(w.campaign.state[loki], DONE);
  assert.deepEqual(w.gameOver, { winningTeam: 1, how: 'campaign' });
});

test('Ragnarök: Loki slain while his host still stands, the host must still be broken; then it is won', () => {
  const w = world('vigrid');
  w.time = 779.5;
  run(w, 2);
  for (const u of tagged(w, 'loki')) w.killEntity(u, null);
  run(w, 2);
  assert.equal(w.gameOver, null);
  for (const b of w.buildingList.filter((x) => x.owner === 1 || x.owner === 3)) w.killEntity(b, null);
  run(w, 2);
  assert.deepEqual(w.gameOver, { winningTeam: 1, how: 'campaign' });
});

test('Ragnarök: slaying Loki is done when Loki falls; the wolves at his heel are not part of it', () => {
  const w = world('vigrid');
  w.time = 779.5;
  run(w, 3);
  const loki = tagged(w, 'loki');
  assert.deepEqual(loki.map((u) => u.type), ['norse_loki']);
  const wolves = tagged(w, 'loki_wolves');
  assert.equal(wolves.length, 4);
  assert.ok(wolves.every((u) => u.owner === 1 && u.type === 'norse_wolf_of_fenrir' && u.order), 'the wolves march with him');
  const k = w.campaign.m.objectives.findIndex((o) => o.id === 'loki');
  assert.equal(w.getSnapshot().cp.o[k][1], 1, 'the panel counts Loki alone');
  w.killEntity(loki[0], null);
  run(w, 2);
  assert.equal(w.campaign.state[k], DONE, 'done while his wolves still run');
  assert.ok(tagged(w, 'loki_wolves').length > 0);
});


test('The Gate of the East: the two lamassu stand guard where they spawn, kept out of their owner\'s army', () => {
  const w = world('sinai');
  const ai = createAI(w, 1, 'easy');
  run(w, 3, [ai]);
  const bulls = tagged(w, 'lamassu');
  assert.equal(bulls.length, 2);
  assert.ok(bulls.every((u) => u.owner === 1 && u.type === 'mesopotamian_lamassu' && u.cGuard && !u.cMarch));
  const at = bulls.map((u) => [u.x, u.y]);
  run(w, 240, [ai]);
  bulls.forEach((u, i) => assert.ok(Math.hypot(u.x - at[i][0], u.y - at[i][1]) < 3, 'still at the gate'));
  const k = w.campaign.m.objectives.findIndex((o) => o.id === 'lamassu');
  assert.equal(w.campaign.state[k], OPEN, 'a bonus while they live');
  for (const u of bulls) w.killEntity(u, null);
  run(w, 2, [ai]);
  assert.equal(w.campaign.state[k], DONE);
  assert.equal(w.gameOver, null, 'a bonus does not end the mission');
});

test('The Wells of the Desert: not held in eighteen minutes, the wells turn bitter and the mission is lost', () => {
  const w = world('siwa');
  w.time = 1078;
  run(w, 4);
  const k = w.campaign.m.objectives.findIndex((o) => o.id === 'wells');
  assert.equal(w.campaign.state[k], FAILED);
  assert.equal(w.gameOver.winningTeam, 2);
});

test('The Mother of Monsters: breaking Akkad early does not win it; Tiamat still rises at 13:00 and must fall', () => {
  const s = campaignSetup('eridu', {});
  assert.deepEqual(s.players.map((p) => [p.team, p.pantheon]), [[1, 'egyptian'], [2, 'mesopotamian'], [1, 'norse'], [2, 'mesopotamian']]);
  const w = world('eridu');
  const home = w.campaign.homes[1];
  for (const b of w.buildingList.filter((x) => x.owner === 1 || x.owner === 3)) w.killEntity(b, null);
  run(w, 2);
  assert.equal(w.gameOver, null, 'not over without Tiamat');
  w.time = 779.5;
  run(w, 3);
  const tiamat = tagged(w, 'tiamat');
  assert.deepEqual(tiamat.map((u) => u.type), ['mesopotamian_tiamat']);
  assert.ok(Math.hypot(tiamat[0].x - home.x, tiamat[0].y - home.y) < 14, 'from where the king\'s Town Center stood');
  assert.equal(tagged(w, 'tiamat_brood').length, 3);
  w.killEntity(tiamat[0], null);
  run(w, 2);
  assert.deepEqual(w.gameOver, { winningTeam: 1, how: 'campaign' }, 'won while her brood still crawls');
});

/** The `campaignSay` events a world emits from now on, as event ids. */
function said(w) {
  const out = [];
  const emit = w.emit.bind(w);
  w.emit = (ev) => {
    if (ev && ev.type === 'campaignSay') out.push(MISSION_BY_ID[w.setup.campaign].events[ev.e].after || ev.e);
    return emit(ev);
  };
  return out;
}

test('a line about what to do next is not said as the mission ends with that objective, only while it goes on', () => {
  // Eridu, Akkad already broken: Tiamat's fall wins, and "Now finish the king of Akkad" stays unsaid.
  const w = world('eridu');
  for (const b of w.buildingList.filter((x) => x.owner === 1 || x.owner === 3)) w.killEntity(b, null);
  w.time = 779.5;
  run(w, 3);
  const lines = said(w);
  w.killEntity(tagged(w, 'tiamat')[0], null);
  run(w, 2);
  assert.deepEqual(w.gameOver, { winningTeam: 1, how: 'campaign' });
  assert.deepEqual(lines, []);
  // With Akkad still standing, the same fall says it.
  const w2 = world('eridu');
  w2.time = 779.5;
  run(w2, 3);
  const lines2 = said(w2);
  w2.killEntity(tagged(w2, 'tiamat')[0], null);
  run(w2, 2);
  assert.equal(w2.gameOver, null);
  assert.deepEqual(lines2, ['tiamat']);
  // Sails on the Nile: the Temple and a god up, the raid broken wins without "Finish what you started".
  const w3 = world('delta');
  run(w3, 271);
  const tc = w3.buildingList.find((b) => b.cTag === 'home');
  w3.createBuilding(0, 'temple', Math.floor(tc.x) + 6, Math.floor(tc.y) + 6, true, true);
  w3.spawnUnit(0, 'egyptian_ra', tc.x + 3, tc.y + 3);
  const lines3 = said(w3);
  for (const u of tagged(w3, 'raid')) w3.killEntity(u, null);
  run(w3, 2);
  assert.deepEqual(w3.gameOver, { winningTeam: 1, how: 'campaign' });
  assert.deepEqual(lines3, []);
});
