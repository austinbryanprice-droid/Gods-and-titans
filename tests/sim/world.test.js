import test from 'node:test';
import assert from 'node:assert/strict';
import { godsFor } from '../../src/data/index.js';
import { makeWorld, run, runCollect, runUntil, place, spawn, clearUnits, defineUnit, eventsOf, errorsOf } from './helpers.js';

const workers = (w, p = 0) => w.unitsOf(p).filter((u) => u.type === 'worshipper');

test('snapshot shape: top level and player view', () => {
  const w = makeWorld();
  w.tick();
  const s = w.getSnapshot();
  assert.deepEqual(Object.keys(s).sort(), ['entities', 'events', 'felled', 'fields', 'gameOver', 'players', 'relics', 'reveals', 'sacred', 'sites', 'tick', 'time'].sort());
  assert.equal(s.tick, 1);
  assert.equal(s.time, 0.05);
  assert.equal(s.gameOver, null);
  const p = s.players[0];
  for (const k of ['i', 'name', 'team', 'pantheon', 'color', 'kind', 'gold', 'wood', 'faith', 'faithRate', 'pop', 'popCap', 'tier', 'defeated', 'gods', 'fallen', 'titan', 'stats']) {
    assert.ok(k in p, `player.${k}`);
  }
  assert.deepEqual(Object.keys(p.stats).sort(), ['buildings', 'gathered', 'kills', 'losses', 'unitsTrained']);
  // events are cleared by getSnapshot
  assert.deepEqual(w.getSnapshot().events, []);
});

test('snapshot shape: entity views with omission rules', () => {
  const w = makeWorld();
  const godDef = godsFor(w.players[0].pantheon)[0];
  const g = spawn(w, 0, godDef.id, 20, 20);
  const minion = defineUnit({ class: 'minion', pop: 0 });
  const m = spawn(w, 0, minion, 22, 22, { summoned: true, expire: 10 });
  const wk = workers(w)[0];
  w.issueCommand(0, { type: 'build', units: [wk.id], building: 'house', tx: 30, ty: 30 });
  w.tick();
  const s = w.getSnapshot();
  const by = new Map(s.entities.map((e) => [e.id, e]));
  const common = ['id', 'k', 't', 'o', 'x', 'y', 'f', 'hp', 'mhp', 'sh', 'st', 'tg'];
  for (const e of s.entities) for (const k of common) assert.ok(k in e, `${e.k}.${k}`);
  const gv = by.get(g.id);
  assert.equal(gv.k, 'u');
  assert.equal(gv.lv, 1);
  assert.equal(gv.xp, 0);
  assert.deepEqual(gv.cd, {});
  assert.deepEqual(gv.fx, []);
  assert.equal(gv.c, 0);
  assert.ok(!('ex' in gv));
  assert.ok(!('bo' in gv));
  assert.ok(!('tx' in gv));
  const wv = by.get(wk.id);
  assert.ok(!('lv' in wv) && !('xp' in wv));
  assert.deepEqual(wv.bo, { b: 'house', tx: 30, ty: 30 });
  assert.ok(by.get(m.id).ex > 9);
  const tc = s.entities.find((e) => e.k === 'b' && e.t === 'town_center' && e.o === 0);
  for (const k of ['tx', 'ty', 'bp', 'q', 'tr', 'rp']) assert.ok(k in tc, `building.${k}`);
  assert.equal(tc.bp, 1);
  assert.equal(tc.tr, 1);
  assert.equal(tc.rp, null);
  assert.ok(!('pr' in tc));
  assert.ok(!('c' in tc) && !('cd' in tc));
  const mine = s.entities.find((e) => e.k === 'm');
  assert.equal(mine.amt, 12000);
  assert.equal(mine.o, -1);
  // rounding
  for (const e of s.entities) {
    assert.equal(e.x, Math.round(e.x * 100) / 100);
    assert.ok(Number.isInteger(e.hp));
  }
  // JSON-safe
  assert.doesNotThrow(() => JSON.stringify(s));
});

test('smart command resolution', () => {
  const w = makeWorld({ map: { forest: [{ x: 2, y: 20, w: 4, h: 4 }] } });
  const [w1, w2, w3, w4, w5] = workers(w);
  const war = spawn(w, 0, 'warrior', 12, 16);
  const enemy = spawn(w, 1, 'warrior', 30, 30);
  const mine = w.mineList[0];
  const shrine = place(w, 0, 'shrine', 18, 12);
  const smart = (units, extra) => w.issueCommand(0, { type: 'smart', units: units.map((u) => u.id), ...extra });
  smart([war, w1], { target: enemy.id, x: enemy.x, y: enemy.y });
  smart([w2], { target: mine.id, x: mine.x, y: mine.y });
  smart([w3], { x: 3.5, y: 21.5 });
  smart([w4], { target: shrine.id, x: shrine.x, y: shrine.y });
  smart([w5], { target: war.id, x: war.x, y: war.y });
  w.tick();
  assert.equal(war.order.type, 'attack');
  assert.equal(w1.order.type, 'attack');
  assert.equal(w2.order.type, 'gather');
  assert.equal(w2.order.mine, mine.id);
  assert.equal(w3.order.type, 'gather');
  assert.deepEqual(w3.order.tree, { tx: 3, ty: 21 });
  assert.equal(w4.order.type, 'pray');
  assert.equal(w5.order.type, 'follow');
  // non-worker on a mine or own building just moves
  smart([war], { target: mine.id, x: mine.x, y: mine.y });
  w.tick();
  assert.equal(war.order.type, 'move');
  // worker carrying cargo + own drop-off -> return cargo
  w2.carry = 'g';
  w2.carryAmount = 10;
  const tc = w.buildingsOf(0).find((b) => b.type === 'town_center');
  const gold = w.players[0].gold;
  smart([w2], { target: tc.id, x: tc.x, y: tc.y });
  w.tick();
  assert.ok(w2.order.type === 'return' || (w.players[0].gold === gold + 10 && w2.order.type === 'gather'));
  runUntil(w, () => w2.carry === 0, 10);
  assert.equal(w.players[0].gold, gold + 10);
  // worker + own unfinished building -> help build
  const site = w.createBuilding(0, 'house', 30, 8, false);
  smart([w1], { target: site.id, x: site.x, y: site.y });
  w.tick();
  assert.equal(w1.order.type, 'build');
  assert.equal(w1.order.site, site.id);
  // plain ground -> move
  smart([w5], { x: 25, y: 25 });
  w.tick();
  assert.equal(w5.order.type, 'move');
  // melee vs flyer -> move instead
  const bird = spawn(w, 1, defineUnit({ air: true }), 35, 20);
  smart([war], { target: bird.id, x: bird.x, y: bird.y });
  w.tick();
  assert.equal(war.order.type, 'move');
});

test('queued orders (shift) run in sequence', () => {
  const w = makeWorld();
  const u = spawn(w, 0, 'warrior', 20, 20);
  w.issueCommand(0, { type: 'move', units: [u.id], x: 25, y: 20 });
  w.issueCommand(0, { type: 'move', units: [u.id], x: 25, y: 26, queue: true });
  w.tick();
  assert.equal(u.orders.length, 1);
  runUntil(w, () => !u.order, 20);
  assert.ok(Math.hypot(u.x - 25, u.y - 26) < 0.3);
});

test('Shift-placing buildings with a mining worker builds them in turn (queued orders replace gather)', () => {
  const w = makeWorld();
  const u = workers(w)[0];
  w.issueCommand(0, { type: 'gather', units: [u.id], target: w.mineList[0].id });
  run(w, 3);
  const gold = w.players[0].gold + (u.carry === 'g' ? u.carryAmount : 0);
  w.issueCommand(0, { type: 'build', units: [u.id], building: 'house', tx: 14, ty: 14, queue: true });
  w.issueCommand(0, { type: 'build', units: [u.id], building: 'house', tx: 17, ty: 14, queue: true });
  w.tick();
  assert.equal(u.order.type, 'build');
  assert.deepEqual(u.orders.map((o) => o.type), ['build']);
  const houses = () => w.buildingList.filter((b) => b.type === 'house' && b.owner === 0);
  const t = runUntil(w, () => houses().length === 2 && houses().every((b) => b.constructed), 120);
  assert.ok(t > 0, 'both houses built');
  run(w, 0.1);
  assert.equal(u.order, null);
  // Paid exactly twice (mined gold deposited before the order change stays).
  assert.ok(w.players[0].gold <= gold - 2 * 80 + 10);
});

test('a queued order replaces hold, pray and follow; Return Cargo deposits first', () => {
  const w = makeWorld();
  const shrine = place(w, 0, 'shrine', 12, 12);
  const [prayer, carrier] = workers(w);
  const war = spawn(w, 0, 'warrior', 20, 20);
  const guard = spawn(w, 0, 'warrior', 22, 20);
  w.issueCommand(0, { type: 'pray', units: [prayer.id], target: shrine.id });
  w.issueCommand(0, { type: 'hold', units: [war.id] });
  w.issueCommand(0, { type: 'smart', units: [guard.id], target: war.id });
  w.issueCommand(0, { type: 'gather', units: [carrier.id], target: w.mineList[0].id });
  runUntil(w, () => carrier.carry === 'g', 20);
  w.issueCommand(0, { type: 'stop', units: [carrier.id] });
  w.tick();
  w.issueCommand(0, { type: 'returnCargo', units: [carrier.id] });
  w.tick();
  assert.equal(prayer.order.type, 'pray');
  assert.equal(guard.order.type, 'follow');
  const gold = w.players[0].gold;
  for (const [u, x] of [[prayer, 24], [war, 26], [guard, 28], [carrier, 30]]) w.issueCommand(0, { type: 'move', units: [u.id], x, y: 26, queue: true });
  w.tick();
  assert.ok(!shrine.prayers.includes(prayer.id), 'prayer slot freed');
  assert.equal(carrier.order.type, 'return');
  runUntil(w, () => [prayer, war, guard, carrier].every((u) => !u.order), 30);
  for (const [u, x] of [[prayer, 24], [war, 26], [guard, 28], [carrier, 30]]) assert.ok(Math.hypot(u.x - x, u.y - 26) < 0.5, `${u.type} ${u.id} at ${u.x},${u.y}`);
  assert.equal(w.players[0].gold, gold + 10, 'deposited on the way');
});

test('a queued order replaces a queued gather at the end of the queue', () => {
  const w = makeWorld();
  const u = workers(w)[0];
  w.issueCommand(0, { type: 'move', units: [u.id], x: 20, y: 20 });
  w.issueCommand(0, { type: 'gather', units: [u.id], target: w.mineList[0].id, queue: true });
  w.issueCommand(0, { type: 'move', units: [u.id], x: 22, y: 22, queue: true });
  w.tick();
  assert.equal(u.order.type, 'move');
  assert.deepEqual(u.orders.map((o) => o.type), ['move']);
});

test('commands for units of another player are dropped', () => {
  const w = makeWorld();
  const mine = workers(w, 1)[0];
  w.issueCommand(0, { type: 'move', units: [mine.id], x: 10, y: 10 });
  w.tick();
  assert.equal(mine.order, null);
});

test('defeat when no buildings remain; victory and gameOver', () => {
  const w = makeWorld();
  const tc1 = w.buildingsOf(1)[0];
  const u1 = workers(w, 1);
  w.killEntity(tc1, null);
  const ev = runCollect(w, 0.1);
  assert.ok(u1.every((u) => u.dead));
  assert.deepEqual(eventsOf(ev, 'playerDefeated').map((e) => e.player), [1]);
  assert.deepEqual(eventsOf(ev, 'gameOver').map((e) => e.winningTeam), [1]);
  assert.equal(w.isGameOver(), true);
  assert.equal(w.winningTeam, 1);
  assert.deepEqual(w.getSnapshot().gameOver, { winningTeam: 1 });
  assert.equal(w.players[1].defeated, true);
});

test('the last buildings of both sides falling on one tick is a draw', () => {
  const w = makeWorld();
  for (const p of [0, 1]) for (const b of w.buildingsOf(p)) w.killEntity(b, null);
  const ev = runCollect(w, 0.1);
  assert.deepEqual(eventsOf(ev, 'playerDefeated').map((e) => e.player), [0, 1]);
  assert.deepEqual(eventsOf(ev, 'gameOver').map((e) => e.winningTeam), [null]);
  assert.deepEqual(w.getSnapshot().gameOver, { winningTeam: null });
  // a 2v2 wipe-out on one tick likewise
  const w2 = makeWorld({ players: 4, teams: [1, 1, 2, 2], map: { width: 64, height: 64 } });
  for (const b of w2.buildingList.slice()) w2.killEntity(b, null);
  run(w2, 0.1);
  assert.equal(w2.isGameOver(), true);
  assert.equal(w2.winningTeam, null);
});

test('surrender defeats the issuing player; teams win together', () => {
  const w = makeWorld({ players: 3, teams: [1, 1, 2], map: { width: 64, height: 64 } });
  w.issueCommand(2, { type: 'surrender' });
  const ev = runCollect(w, 0.1);
  assert.equal(w.players[2].defeated, true);
  assert.equal(w.buildingsOf(2).length, 0);
  assert.deepEqual(eventsOf(ev, 'gameOver').map((e) => e.winningTeam), [1]);
});

test('no victory while two teams still stand', () => {
  const w = makeWorld({ players: 3, teams: [1, 2, 3], map: { width: 64, height: 64 } });
  w.issueCommand(2, { type: 'surrender' });
  run(w, 0.1);
  assert.equal(w.isGameOver(), false);
  w.issueCommand(1, { type: 'surrender' });
  run(w, 0.1);
  assert.equal(w.winningTeam, 1);
});

test('determinism: same setup and commands give identical snapshots', () => {
  const play = () => {
    const w = makeWorld({ map: { camps: [{ x: 24, y: 24, level: 2 }], forest: [{ x: 2, y: 20, w: 6, h: 6 }] } });
    const ws = workers(w);
    w.issueCommand(0, { type: 'gather', units: ws.slice(0, 3).map((u) => u.id), target: w.mineList[0].id });
    w.issueCommand(0, { type: 'gather', units: ws.slice(3).map((u) => u.id), tx: 5, ty: 21 });
    const army = [];
    for (let i = 0; i < 6; i++) army.push(spawn(w, 0, 'warrior', 14 + (i % 3), 18 + Math.floor(i / 3)));
    w.issueCommand(0, { type: 'attackMove', units: army.map((u) => u.id), x: 24, y: 24 });
    run(w, 30);
    return JSON.stringify(w.getSnapshot());
  };
  assert.equal(play(), play());
});

test('read API helpers', () => {
  const w = makeWorld();
  assert.equal(w.areEnemies(0, 1), true);
  assert.equal(w.areEnemies(0, 0), false);
  assert.equal(w.areEnemies(-1, 0), true);
  assert.equal(w.areEnemies(-1, -1), false);
  assert.equal(w.canAfford(0, { gold: 400, wood: 200, faith: 50 }), true);
  assert.equal(w.canAfford(0, { gold: 401, wood: 0, faith: 0 }), false);
  assert.equal(w.hasBuilding(0, 'town_center'), true);
  assert.equal(w.hasBuilding(0, 'shrine'), false);
  const site = w.createBuilding(0, 'shrine', 20, 20, false);
  assert.equal(w.hasBuilding(0, 'shrine'), false);
  assert.equal(w.hasBuilding(0, 'shrine', false), true);
  assert.equal(w.getEntity(site.id), site);
  assert.equal(w.getEntity(99999), null);
  const near = w.queryRadius(8, 8, 3);
  assert.ok(near.some((e) => e.type === 'town_center'));
  assert.ok(near.some((e) => e.type === 'worshipper'));
  assert.equal(w.queryRadius(8, 8, 3, (e) => e.kind === 'building').length, 1);
  assert.equal(w.map.isPassable(7, 7), false);
  assert.equal(w.map.isBuildable(30, 30), true);
  assert.equal(typeof w.tickCount, 'number');
  assert.equal(w.unitsOf(0).length, 5);
  assert.equal(w.buildingsOf(0).length, 2);
});

test('god death adds to fallen; players snapshot lists gods and titan', () => {
  const w = makeWorld();
  const godDef = godsFor(w.players[0].pantheon)[0];
  const g = spawn(w, 0, godDef.id, 20, 20);
  assert.deepEqual(w.getSnapshot().players[0].gods, [godDef.id]);
  const killer = spawn(w, 1, 'warrior', 21, 20);
  w.killEntity(g, killer);
  run(w, 0.1);
  const s = w.getSnapshot().players[0];
  assert.deepEqual(s.gods, []);
  assert.deepEqual(s.fallen, { [godDef.id]: 1 });
  assert.equal(s.stats.losses, 1);
  assert.equal(w.getSnapshot().players[1].stats.kills, 1);
});

test('unknown pantheon falls back deterministically', () => {
  const w = makeWorld({ pantheons: ['random', 'nope'] });
  assert.ok(w.players[0].pantheon && w.players[0].pantheon !== 'random');
  assert.ok(w.players[1].pantheon !== 'nope');
});

test('error event shape', () => {
  const w = makeWorld();
  const tc = w.buildingsOf(0)[0];
  w.players[0].gold = 0;
  w.issueCommand(0, { type: 'train', building: tc.id, unit: 'worshipper' });
  w.tick();
  const e = eventsOf(w.events, 'error')[0];
  assert.deepEqual(e, { type: 'error', player: 0, message: 'Not enough gold.' });
  assert.deepEqual(errorsOf(w.events, 1), []);
});
