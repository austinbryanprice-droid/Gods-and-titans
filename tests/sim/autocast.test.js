import test from 'node:test';
import assert from 'node:assert/strict';
import { NEUTRAL } from '../../src/config.js';
import { UNITS, godsFor, creaturesFor, titanFor } from '../../src/data/index.js';
import { isAutocastOn } from '../../src/sim/abilities.js';
import { chooseCast } from '../../src/sim/cast-choice.js';
import { ViewState } from '../../src/game/view-state.js';
import { getCommandCard } from '../../src/ui/command-card.js';
import { makeWorld, run, runCollect, spawn, clearUnits, defineUnit, ability, eventsOf } from './helpers.js';

function arena() {
  const w = makeWorld({ width: 64, height: 64, map: { width: 64, height: 64 } });
  clearUnits(w, 0);
  clearUnits(w, 1);
  w.events.length = 0;
  return w;
}

function caster(w, abilities, extra = {}) {
  return spawn(w, 0, defineUnit({ abilities, attack: null, ...extra }), 20, 20);
}

function dummy(w, owner, x, y, type = 'warrior') {
  const u = spawn(w, owner, type, x, y);
  w.setOrder(u, { type: 'hold', target: 0 });
  return u;
}

const casts = (events, id) => eventsOf(events, 'cast').filter((e) => !id || e.ability === id);

test('every ability of gods, creatures and titans starts on autocast; worshippers and creeps keep the data default', () => {
  const w = arena();
  for (const p of ['greek', 'norse', 'aztec', 'japanese']) {
    for (const def of [...godsFor(p), ...creaturesFor(p), titanFor(p)]) {
      const u = spawn(w, 0, def.id, 30, 30);
      assert.equal(u.manualMask, 0, `${def.id} has a manual ability`);
      for (const ab of def.abilities) assert.ok(isAutocastOn(u, ab), `${ab.id} off`);
      assert.equal(u.autocast.length, def.abilities.length);
    }
  }
  const priest = spawn(w, 0, 'priest', 30, 30);
  assert.equal(priest.autocast.length, 1);
  // A neutral creep with a manual (non-data-autocast) ability keeps it manual.
  const creepType = defineUnit({ class: 'creature', abilities: [ability('t_creep_nuke', [{ type: 'damage', amount: 100, radius: 2 }])] });
  const creep = spawn(w, NEUTRAL, creepType, 30, 30);
  assert.equal(creep.autocast.length, 0);
  assert.equal(spawn(w, 0, creepType, 30, 30).autocast.length, 1, 'the same type owned by a player autocasts');
});

test('a damage spell autocasts on a clump of enemies and keeps the unit on its attack order', () => {
  const w = arena();
  const c = caster(w, [ability('t_blast', [{ type: 'damage', amount: 120, radius: 2.2, at: 'target' }], { range: 7 })], { attack: { ...UNITS.archer.attack } });
  const e1 = dummy(w, 1, 25, 20);
  dummy(w, 1, 25.6, 20.4);
  dummy(w, 1, 25.2, 19.4);
  w.issueCommand(0, { type: 'attack', units: [c.id], target: e1.id });
  const ev = runCollect(w, 1);
  assert.equal(casts(ev, 't_blast').length, 1);
  assert.ok(e1.hp < e1.maxHp);
  assert.ok(c.cooldowns.t_blast > 0);
  assert.equal(c.order && c.order.type, 'attack', 'resumes the attack');
});

test('nothing is cast with no enemy around, and a moving unit does not stop to autocast', () => {
  const w = arena();
  const c = caster(w, [ability('t_blast2', [{ type: 'damage', amount: 120, radius: 2.2, at: 'target' }], { range: 7 })]);
  assert.equal(casts(runCollect(w, 2)).length, 0, 'idle, no enemies');
  dummy(w, 1, 24, 20);
  dummy(w, 1, 24.5, 20.5);
  w.issueCommand(0, { type: 'move', units: [c.id], x: 20, y: 40 });
  assert.equal(casts(runCollect(w, 1)).length, 0, 'a move order is the player\'s call');
});

test('an ultimate is not wasted on a lone neutral creep but fires into a big fight', () => {
  const w = arena();
  const ult = ability('t_ult', [{ type: 'damage', amount: 300, radius: 3, at: 'target' }], { range: 8, cooldown: 90 });
  const c = caster(w, [ult]);
  const creep = dummy(w, NEUTRAL, 24, 20);
  assert.equal(casts(runCollect(w, 1)).length, 0, 'lone creep');
  w.killEntity(creep, null);
  for (let i = 0; i < 4; i++) dummy(w, 1, 24 + (i % 2) * 0.7, 20 + Math.floor(i / 2) * 0.7);
  assert.equal(casts(runCollect(w, 1), 't_ult').length, 1, 'four enemy warriors');
});

test('heals autocast on a hurt ally (in a fight or after it) and wait while everyone is healthy', () => {
  const w = arena();
  const heal = ability('t_mend', [{ type: 'heal', amount: 200, radius: 0 }], { target: 'ally', range: 6, ai: { use: 'heal' }, cooldown: 12 });
  const c = caster(w, [heal]);
  const friend = dummy(w, 0, 23, 20);
  assert.equal(casts(runCollect(w, 1)).length, 0, 'nobody hurt');
  friend.hp = friend.maxHp - 150;
  const ev = runCollect(w, 1);
  assert.equal(casts(ev, 't_mend').length, 1);
  assert.equal(friend.hp, friend.maxHp);
});

test('buffs and summons only go off when enemies are near', () => {
  const minion = defineUnit({ class: 'minion', producedAt: null, cost: { gold: 0, wood: 0, faith: 0 }, pop: 0 });
  const w = arena();
  const c = caster(w, [
    ability('t_rally', [{ type: 'buff', stat: 'damage', amount: 0.3, duration: 8, radius: 6, at: 'self' }], { target: 'none', ai: { use: 'buff' } }),
    ability('t_call', [{ type: 'summon', unit: minion, count: 2, duration: 20, at: 'self' }], { key: 'W', target: 'none', ai: { use: 'summon' } }),
  ], { attack: { ...UNITS.warrior.attack } });
  dummy(w, 0, 21, 20);
  assert.equal(casts(runCollect(w, 2)).length, 0, 'no enemy around');
  const e = dummy(w, 1, 21.2, 21);
  dummy(w, 1, 20.4, 21.2);
  w.issueCommand(0, { type: 'attack', units: [c.id], target: e.id });
  const ev = runCollect(w, 2);
  assert.equal(casts(ev, 't_call').length, 1, 'summons in the fight');
  assert.equal(casts(ev, 't_rally').length, 1, 'buffs the engaged allies');
});

test('setting an ability to manual stops its autocast, shows in the snapshot, and a cast order still works', () => {
  const w = arena();
  const blast = ability('t_man', [{ type: 'damage', amount: 120, radius: 2.2, at: 'target' }], { range: 7 });
  const other = ability('t_man2', [{ type: 'damage', amount: 200, radius: 0 }], { key: 'W', target: 'enemy', range: 7, cooldown: 30 });
  const c = caster(w, [blast, other]);
  w.issueCommand(0, { type: 'autocast', units: [c.id], ability: 't_man', on: false });
  w.tick();
  assert.equal(isAutocastOn(c, blast), false);
  assert.equal(isAutocastOn(c, other), true, 'only that ability');
  assert.equal(w.getSnapshot().entities.find((e) => e.id === c.id).mc, 1);
  const e1 = dummy(w, 1, 25, 20);
  dummy(w, 1, 25.6, 20.4);
  dummy(w, 1, 25.2, 19.4);
  const ev = runCollect(w, 1);
  assert.equal(casts(ev, 't_man').length, 0, 'manual: not cast by itself');
  assert.equal(casts(ev, 't_man2').length, 1, 'the other still autocasts');
  w.issueCommand(0, { type: 'cast', unit: c.id, ability: 't_man', x: e1.x, y: e1.y });
  assert.equal(casts(runCollect(w, 0.5), 't_man').length, 1, 'the player\'s own cast always runs');
  // Back to autocast: the snapshot key goes away and it casts itself again after its cooldown.
  w.issueCommand(0, { type: 'autocast', units: [c.id], ability: 't_man', on: true });
  w.tick();
  assert.equal(w.getSnapshot().entities.find((e) => e.id === c.id).mc, undefined);
  c.cooldowns.t_man = 0;
  assert.equal(casts(runCollect(w, 1), 't_man').length, 1);
});

test('the autocast command without an ability sets every ability; foreign units are ignored', () => {
  const w = arena();
  const zeus = spawn(w, 0, 'greek_zeus', 20, 20);
  const enemyGod = spawn(w, 1, 'greek_zeus', 30, 30);
  w.issueCommand(0, { type: 'autocast', units: [zeus.id, enemyGod.id], on: false });
  w.tick();
  assert.equal(zeus.autocast.length, 0);
  assert.equal(zeus.manualMask, (1 << zeus.def.abilities.length) - 1);
  assert.equal(enemyGod.autocast.length, zeus.def.abilities.length, 'not ours to change');
  w.issueCommand(0, { type: 'autocast', units: [zeus.id], on: true });
  w.tick();
  assert.equal(zeus.autocast.length, zeus.def.abilities.length);
});

test('a god autocasts nothing it has not unlocked yet', () => {
  const w = arena();
  const zeus = spawn(w, 0, 'greek_zeus', 20, 20);
  for (let i = 0; i < 6; i++) dummy(w, 1, 24 + (i % 3) * 0.6, 20 + Math.floor(i / 3) * 0.6);
  const locked = new Set(zeus.def.abilities.filter((a) => (a.unlockLevel || 1) > 1).map((a) => a.id));
  for (const e of casts(runCollect(w, 3))) assert.ok(!locked.has(e.ability), `${e.ability} cast at level 1`);
});

test('chooseCast is deterministic: two identical worlds pick the same cast', () => {
  const pick = () => {
    const w = arena();
    const zeus = spawn(w, 0, 'greek_zeus', 20, 20);
    for (let i = 0; i < 5; i++) dummy(w, 1, 24 + i * 0.5, 20 + (i % 2) * 0.5);
    const best = chooseCast(w, zeus);
    return best && { ab: best.ab.id, x: best.x, y: best.y, t: best.target && best.target.id };
  };
  const a = pick();
  assert.ok(a, 'Zeus finds a cast');
  assert.deepEqual(pick(), a);
});

test('command card marks autocast from the snapshot and right-click toggles it', () => {
  const w = makeWorld();
  const zeus = spawn(w, 0, 'greek_zeus', 12, 16);
  const view = () => {
    const vs = new ViewState({ setup: w.setup, mapData: w.mapData, myIndex: 0 });
    vs.pushSnapshot(w.getSnapshot(), 50);
    return vs;
  };
  let q = getCommandCard([zeus.id], view())[8];
  assert.equal(q.autocast, true);
  assert.deepEqual(q.toggle, { kind: 'autocast', ability: zeus.def.abilities[0].id, unitType: 'greek_zeus', on: false });
  w.issueCommand(0, { type: 'autocast', units: [zeus.id], ability: zeus.def.abilities[0].id, on: false });
  w.tick();
  q = getCommandCard([zeus.id], view())[8];
  assert.equal(q.autocast, false);
  assert.equal(q.toggle.on, true);
  assert.equal(getCommandCard([zeus.id], view())[9].autocast, true, 'the W ability is still on');
  // An enemy god's card shows no toggle.
  const foe = spawn(w, 1, 'greek_zeus', 20, 20);
  const fq = getCommandCard([foe.id], view())[8];
  assert.ok(!fq || fq.toggle === null);
});
