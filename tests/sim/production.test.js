import test from 'node:test';
import assert from 'node:assert/strict';
import { MORTALS, godsFor, titanFor, creaturesFor, getUnitType } from '../../src/data/index.js';
import { REVIVE_COST_MULT } from '../../src/config.js';
import { makeWorld, run, runCollect, runUntil, place, eventsOf, errorsOf, spawn } from './helpers.js';

const tcOf = (w, p = 0) => w.buildingsOf(p).find((b) => b.type === 'town_center');

function cmd(w, c, p = 0) {
  w.events.length = 0;
  w.issueCommand(p, c);
  w.tick();
  return errorsOf(w.events, p);
}

test('train: cost and pop reserved on queue, refunded on cancel', () => {
  const w = makeWorld();
  const tc = tcOf(w);
  assert.deepEqual(cmd(w, { type: 'train', building: tc.id, unit: 'worshipper' }), []);
  assert.equal(w.players[0].gold, 350);
  assert.equal(w.players[0].popUsed, 6);
  assert.equal(tc.queue.length, 1);
  cmd(w, { type: 'train', building: tc.id, unit: 'worshipper' });
  cmd(w, { type: 'cancelTrain', building: tc.id, index: 1 });
  assert.equal(w.players[0].gold, 350);
  assert.equal(w.players[0].popUsed, 6);
  assert.equal(tc.queue.length, 1);
  const snap = w.getSnapshot();
  const v = snap.entities.find((e) => e.id === tc.id);
  assert.equal(v.q.length, 1);
  assert.equal(v.q[0].u, 'worshipper');
});

test('train: spawn after build time at the footprint edge toward the rally', () => {
  const w = makeWorld();
  const tc = tcOf(w);
  cmd(w, { type: 'rally', building: tc.id, x: 20, y: 8 });
  cmd(w, { type: 'train', building: tc.id, unit: 'worshipper' });
  const ev = runCollect(w, MORTALS.worshipper.buildTime + 0.2);
  const sp = eventsOf(ev, 'spawn');
  assert.equal(sp.length, 1);
  const u = w.getEntity(sp[0].id);
  assert.equal(u.type, 'worshipper');
  assert.ok(u.x > tc.tx + tc.size - 0.5, 'spawned on the east side');
  assert.equal(w.players[0].stats.unitsTrained, 1);
  runUntil(w, () => u.order === null, 10);
  assert.ok(Math.hypot(u.x - 20, u.y - 8) < 0.5);
  assert.deepEqual(w.getSnapshot().entities.find((e) => e.id === tc.id).rp, [20, 8]);
});

test('rally on a mine sends new workers to gather', () => {
  const w = makeWorld();
  const tc = tcOf(w);
  const mine = w.mineList[0];
  cmd(w, { type: 'rally', building: tc.id, x: mine.x, y: mine.y, target: mine.id });
  cmd(w, { type: 'train', building: tc.id, unit: 'worshipper' });
  const ev = runCollect(w, MORTALS.worshipper.buildTime + 0.2);
  const u = w.getEntity(eventsOf(ev, 'spawn')[0].id);
  assert.equal(u.order.type, 'gather');
  assert.equal(u.order.mine, mine.id);
});

test('rally on a tree sends new workers to chop', () => {
  const w = makeWorld({ map: { forest: [{ x: 2, y: 16, w: 4, h: 2 }] } });
  const tc = tcOf(w);
  cmd(w, { type: 'rally', building: tc.id, x: 3.5, y: 16.5 });
  cmd(w, { type: 'train', building: tc.id, unit: 'worshipper' });
  const ev = runCollect(w, MORTALS.worshipper.buildTime + 0.2);
  const u = w.getEntity(eventsOf(ev, 'spawn')[0].id);
  assert.equal(u.order.type, 'gather');
  assert.ok(u.order.tree);
});

test('queue full, population and resource errors', () => {
  const w = makeWorld();
  const tc = tcOf(w);
  w.players[0].gold = 10000;
  for (let i = 0; i < 5; i++) assert.deepEqual(cmd(w, { type: 'train', building: tc.id, unit: 'worshipper' }), []);
  assert.deepEqual(cmd(w, { type: 'train', building: tc.id, unit: 'worshipper' }), ['Production queue is full.']);
  const b = place(w, 0, 'barracks', 20, 20);
  w.players[0].popCap = 12; // 5 workers + 5 queued = 10 used
  assert.deepEqual(cmd(w, { type: 'train', building: b.id, unit: 'warrior' }), []);
  assert.deepEqual(cmd(w, { type: 'train', building: b.id, unit: 'warrior' }), ['Not enough population. Build more Houses.']);
  w.players[0].gold = 0;
  assert.deepEqual(cmd(w, { type: 'train', building: b.id, unit: 'archer' }), ['Not enough gold.']);
  w.players[0].gold = 1000;
  assert.deepEqual(cmd(w, { type: 'train', building: b.id, unit: 'priest' }), ['Requires Town.']);
});

test('tier up requires a Shrine, blocks training, raises tier', () => {
  const w = makeWorld();
  const tc = tcOf(w);
  w.players[0].gold = 5000;
  w.players[0].wood = 5000;
  w.players[0].faith = 500;
  assert.deepEqual(cmd(w, { type: 'upgradeTier', building: tc.id }), ['Requires a Shrine.']);
  place(w, 0, 'shrine', 20, 20);
  assert.deepEqual(cmd(w, { type: 'upgradeTier', building: tc.id }), []);
  assert.equal(w.players[0].gold, 5000 - 300);
  assert.equal(tc.queue[0].u, 'tier_up');
  assert.deepEqual(cmd(w, { type: 'train', building: tc.id, unit: 'worshipper' }), ['The Town Center is growing.']);
  const ev = runCollect(w, 61);
  assert.deepEqual(eventsOf(ev, 'tierUp').map((e) => [e.player, e.tier]), [[0, 2]]);
  assert.equal(w.players[0].tier, 2);
  assert.equal(tc.tier, 2);
  assert.equal(w.getSnapshot().entities.find((e) => e.id === tc.id).tr, 2);
  assert.deepEqual(cmd(w, { type: 'upgradeTier', building: tc.id }), ['Requires a Temple.']);
  place(w, 0, 'temple', 26, 20);
  assert.deepEqual(cmd(w, { type: 'upgradeTier', building: tc.id }), []);
  run(w, 81);
  assert.equal(w.players[0].tier, 3);
});

test('creatures need tier; shrine summons pantheon creatures', () => {
  const w = makeWorld();
  const shrine = place(w, 0, 'shrine', 20, 20);
  w.players[0].gold = 5000;
  w.players[0].wood = 5000;
  w.players[0].faith = 5000;
  place(w, 0, 'house', 30, 30);
  const [c1, c2] = creaturesFor(w.players[0].pantheon);
  assert.deepEqual(cmd(w, { type: 'train', building: shrine.id, unit: c2.id }), ['Requires Town.']);
  assert.deepEqual(cmd(w, { type: 'train', building: shrine.id, unit: c1.id }), []);
  // a unit of another pantheon is not producible here
  const foreign = creaturesFor('egyptian')[0];
  cmd(w, { type: 'train', building: shrine.id, unit: foreign.id });
  assert.equal(shrine.queue.length, 1);
  run(w, c1.buildTime + 0.5);
  assert.equal(w.unitsOf(0).filter((u) => u.type === c1.id).length, 1);
});

test('god rules: unique, max 3, slot tiers; titan rule', () => {
  const w = makeWorld();
  const p = w.players[0];
  p.gold = 99999;
  p.wood = 99999;
  p.faith = 99999;
  place(w, 0, 'shrine', 20, 20);
  const temple = place(w, 0, 'temple', 26, 20);
  for (let i = 0; i < 4; i++) place(w, 0, 'house', 30 + i * 3, 30);
  const gods = godsFor(p.pantheon);
  assert.deepEqual(cmd(w, { type: 'train', building: temple.id, unit: gods[0].id }), []);
  assert.deepEqual(cmd(w, { type: 'train', building: temple.id, unit: gods[0].id }), ['You already have that god.']);
  assert.deepEqual(cmd(w, { type: 'train', building: temple.id, unit: gods[1].id }), ['Your next god requires Town.']);
  p.tier = 2;
  assert.deepEqual(cmd(w, { type: 'train', building: temple.id, unit: gods[1].id }), []);
  assert.deepEqual(cmd(w, { type: 'train', building: temple.id, unit: gods[2].id }), ['Your next god requires City.']);
  p.tier = 3;
  assert.deepEqual(cmd(w, { type: 'train', building: temple.id, unit: gods[2].id }), []);
  assert.deepEqual(cmd(w, { type: 'train', building: temple.id, unit: gods[3].id }), ['You can only have 3 gods.']);
  const gate = place(w, 0, 'titan_gate', 6, 30);
  const titan = titanFor(p.pantheon);
  w.events.length = 0;
  w.issueCommand(0, { type: 'train', building: gate.id, unit: titan.id });
  w.tick();
  assert.deepEqual(eventsOf(w.events, 'titanSummoning').map((e) => e.t), [titan.id]);
  assert.deepEqual(cmd(w, { type: 'train', building: gate.id, unit: titan.id }), ['You already have a Titan.']);
});

test('titan needs City', () => {
  const w = makeWorld();
  const p = w.players[0];
  p.gold = p.wood = p.faith = 99999;
  const gate = place(w, 0, 'titan_gate', 20, 20);
  assert.deepEqual(cmd(w, { type: 'train', building: gate.id, unit: titanFor(p.pantheon).id }), ['Requires City.']);
});

test('revive a fallen god keeps level and xp at reduced cost', () => {
  const w = makeWorld();
  const p = w.players[0];
  p.gold = 5000;
  p.faith = 5000;
  place(w, 0, 'shrine', 20, 20);
  const temple = place(w, 0, 'temple', 26, 20);
  const godDef = godsFor(p.pantheon)[0];
  const g = spawn(w, 0, godDef.id, 30, 30);
  w.gainXp(g, 320);
  assert.equal(g.level, 3);
  w.killEntity(g, null);
  run(w, 0.1);
  assert.deepEqual(p.fallen[godDef.id], { level: 3, xp: 320 });
  assert.deepEqual(w.getSnapshot().players[0].fallen, { [godDef.id]: 3 });
  const g0 = p.gold;
  const f0 = p.faith;
  assert.deepEqual(cmd(w, { type: 'train', building: temple.id, unit: godDef.id }), []);
  assert.equal(g0 - p.gold, Math.round(godDef.cost.gold * REVIVE_COST_MULT));
  assert.equal(f0 - p.faith, Math.round(godDef.cost.faith * REVIVE_COST_MULT));
  assert.equal(p.fallen[godDef.id], undefined);
  const ev = runCollect(w, godDef.buildTime * REVIVE_COST_MULT + 0.2);
  const back = w.getEntity(eventsOf(ev, 'spawn')[0].id);
  assert.equal(back.type, godDef.id);
  assert.equal(back.level, 3);
  assert.equal(back.xp, 320);
  assert.equal(back.maxHp, Math.round(godDef.hp * 1.16));
});

test('cancelling a revive restores the fallen god', () => {
  const w = makeWorld();
  const p = w.players[0];
  p.gold = 5000;
  p.faith = 5000;
  place(w, 0, 'shrine', 20, 20);
  const temple = place(w, 0, 'temple', 26, 20);
  const godDef = godsFor(p.pantheon)[1];
  p.fallen[godDef.id] = { level: 2, xp: 150 };
  cmd(w, { type: 'train', building: temple.id, unit: godDef.id });
  assert.equal(p.fallen[godDef.id], undefined);
  cmd(w, { type: 'cancelTrain', building: temple.id, index: 0 });
  assert.deepEqual(p.fallen[godDef.id], { level: 2, xp: 150 });
  assert.equal(p.gold, 5000);
});

test('god summoned through the temple gets level 1 stats', () => {
  const w = makeWorld();
  const p = w.players[0];
  p.gold = 5000;
  p.faith = 5000;
  place(w, 0, 'shrine', 20, 20);
  const temple = place(w, 0, 'temple', 26, 20);
  const godDef = godsFor(p.pantheon)[0];
  cmd(w, { type: 'train', building: temple.id, unit: godDef.id });
  run(w, godDef.buildTime + 0.2);
  const g = w.unitsOf(0).find((u) => u.type === godDef.id);
  assert.ok(g);
  assert.equal(g.level, 1);
  assert.equal(g.maxHp, godDef.hp);
  const view = w.getSnapshot().entities.find((e) => e.id === g.id);
  assert.equal(view.lv, 1);
  assert.equal(view.xp, 0);
  assert.deepEqual(w.getSnapshot().players[0].gods, [godDef.id]);
  assert.equal(getUnitType(godDef.id).class, 'god');
});
