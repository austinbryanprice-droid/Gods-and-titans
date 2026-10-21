// Decade of Peace: until the peace runs out no player harms another with weapons,
// spells or auras, neutral creatures stay fair game, and the peace ends once, on time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NEUTRAL, PEACE_LENGTHS, TICK_RATE } from '../../src/config.js';
import { peaceSeconds, peaceClock } from '../../src/sim/peace.js';
import { dealDamage } from '../../src/sim/combat.js';
import { makeWorld, run, runCollect, place, spawn, clearUnits, defineUnit, ability, eventsOf, errorsOf } from './helpers.js';

function arena(opts = {}) {
  const w = makeWorld({ map: { width: 64, height: 64 }, peaceMinutes: 30, ...opts });
  clearUnits(w, 0);
  clearUnits(w, 1);
  w.events.length = 0;
  return w;
}

/** Jump to the end of the peace (the real countdown is thirty-plus game minutes). */
function endPeace(w) {
  w.peaceEnd = w.time;
  w.tick();
  w.events.length = 0;
}

/** A unit that stands still and cannot fight back, so only the spell under test touches it. */
function target(w, owner, x, y) {
  const u = spawn(w, owner, DUMMY, x, y);
  w.setOrder(u, { type: 'hold', target: 0 });
  return u;
}

const DUMMY = defineUnit({ attack: null, abilities: [] });
const has = (u, type) => u.statuses.some((s) => s.type === type);
const hurt = (u) => u.hp < u.maxHp;

test('a setup has a peace only when it names one of the lobby lengths', () => {
  assert.deepEqual(PEACE_LENGTHS, [30, 45, 60]);
  for (const m of PEACE_LENGTHS) assert.equal(peaceSeconds({ peaceMinutes: m }), m * 60);
  for (const bad of [undefined, null, 0, 10, 31, 90, -30, '30', NaN, Infinity, {}, [30]]) assert.equal(peaceSeconds({ peaceMinutes: bad }), 0, String(bad));
  assert.equal(peaceSeconds({}), 0);
  assert.equal(peaceSeconds(null), 0);
  assert.equal(makeWorld({ peaceMinutes: 45 }).peaceLeft(), 45 * 60);
});

test('the peace clock rounds up, so 0:00 only shows once the peace is over', () => {
  assert.equal(peaceClock(1800), '30:00');
  assert.equal(peaceClock(1799.01), '30:00');
  assert.equal(peaceClock(59.2), '1:00');
  assert.equal(peaceClock(0.05), '0:01');
  assert.equal(peaceClock(0), '0:00');
  assert.equal(peaceClock(-3), '0:00');
  assert.equal(peaceClock(undefined), '0:00');
  assert.equal(peaceClock(3600), '1:00:00');
  assert.equal(peaceClock(3599.5), '1:00:00');
});

test('a normal game has no peace: rivals fight at once and canHarm is areEnemies', () => {
  const w = arena({ peaceMinutes: 0 });
  assert.equal(w.peace, false);
  assert.equal(w.peaceLeft(), 0);
  assert.equal(w.canHarm(0, 1), true);
  assert.equal(w.peaceBlocks(0, 1), false);
  const a = spawn(w, 0, 'warrior', 20, 20);
  const b = spawn(w, 1, 'warrior', 20.75, 20);
  const ev = runCollect(w, 3);
  assert.ok(hurt(a) || hurt(b), 'the idle rivals fought');
  assert.equal(eventsOf(ev, 'peaceEnd').length, 0);
});

test('canHarm: rivals are safe from each other in the peace, creatures and the rest are not', () => {
  const w = makeWorld({ players: 3, teams: [1, 1, 2], peaceMinutes: 30 });
  assert.equal(w.canHarm(0, 2), false);
  assert.equal(w.canHarm(2, 1), false);
  assert.equal(w.peaceBlocks(0, 2), true);
  assert.equal(w.peaceBlocks(0, 1), false, 'teammates were never enemies');
  assert.equal(w.canHarm(0, 1), false);
  assert.equal(w.canHarm(0, NEUTRAL), true);
  assert.equal(w.canHarm(NEUTRAL, 2), true);
  assert.equal(w.peaceBlocks(0, NEUTRAL), false);
  assert.equal(w.canHarm(0, 0), false);
  endPeace(w);
  assert.equal(w.canHarm(0, 2), true);
  assert.equal(w.canHarm(2, 1), true);
  assert.equal(w.canHarm(0, 1), false);
  assert.equal(w.canHarm(0, NEUTRAL), true);
});

test('rivals face to face do not fight in the peace, and do the moment it ends', () => {
  const w = arena();
  const a = spawn(w, 0, 'warrior', 20, 20);
  const b = spawn(w, 1, 'warrior', 20.75, 20);
  const bow = spawn(w, 1, 'archer', 24, 20);
  const ev = runCollect(w, 10);
  assert.equal(eventsOf(ev, 'hit').length, 0);
  assert.equal(eventsOf(ev, 'attack').length, 0);
  assert.equal(eventsOf(ev, 'projectile').length, 0);
  for (const u of [a, b, bow]) assert.equal(u.hp, u.maxHp);
  endPeace(w);
  run(w, 4);
  assert.ok(hurt(a) && hurt(b), 'once the peace ends they fight');
});

test('neutral creatures stay fair game: they fight a player and a player fights back', () => {
  const w = makeWorld({ map: { camps: [{ x: 24, y: 24, level: 1 }] }, peaceMinutes: 30 });
  clearUnits(w, 0);
  clearUnits(w, 1);
  const creeps = w.unitsOf(NEUTRAL);
  assert.ok(creeps.length >= 2);
  const hero = spawn(w, 0, 'warrior', 24, 20);
  w.issueCommand(0, { type: 'attackMove', units: [hero.id], x: 24, y: 24 });
  run(w, 6);
  assert.ok(creeps.some((c) => c.creepState === 'fight'), 'the camp woke');
  assert.ok(creeps.some(hurt), 'the player hit a creep');
  assert.ok(hurt(hero), 'a creep hit the player');
});

test('an attack order on another player becomes a walk, with one message per order', () => {
  const w = arena();
  const group = [19, 20, 21].map((y) => spawn(w, 0, 'warrior', 20, y));
  const foe = spawn(w, 1, 'warrior', 30, 20);
  w.setOrder(foe, { type: 'hold', target: 0 });
  w.issueCommand(0, { type: 'attack', units: group.map((u) => u.id), target: foe.id });
  w.tick();
  const errs = errorsOf(w.events);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /^The Decade of Peace holds for another \d+:\d\d: no attacking yet\.$/);
  assert.ok(group.every((u) => u.order && u.order.type === 'move'), 'they were sent to walk there');
  w.events.length = 0;
  const ev = runCollect(w, 12);
  assert.equal(eventsOf(ev, 'hit').length, 0);
  assert.equal(foe.hp, foe.maxHp);
  assert.ok(group.every((u) => Math.hypot(u.x - 30, u.y - 20) < 3), 'they walked up to it');
});

test('a right-click on a rival unit or building is a move, and a creature is still attacked', () => {
  const w = arena();
  const a = spawn(w, 0, 'warrior', 20, 20);
  const foe = target(w, 1, 28, 20);
  const house = place(w, 1, 'house', 30, 24);
  const creep = target(w, NEUTRAL, 20, 28);
  for (const t of [foe, house]) {
    w.issueCommand(0, { type: 'smart', units: [a.id], target: t.id });
    w.tick();
    assert.equal(a.order.type, 'move', `${t.kind} → move`);
    assert.equal(errorsOf(w.events).length, 1);
    w.events.length = 0;
  }
  w.issueCommand(0, { type: 'smart', units: [a.id], target: creep.id });
  w.tick();
  assert.equal(a.order.type, 'attack');
  assert.equal(a.order.target, creep.id);
  assert.equal(errorsOf(w.events).length, 0);
});

test('units attack-moving through a rival do not stop to fight it, and towers hold their fire', () => {
  const w = arena();
  const tower = place(w, 1, 'tower', 28, 20);
  const foe = target(w, 1, 24, 20);
  const a = spawn(w, 0, 'warrior', 18, 20);
  w.issueCommand(0, { type: 'attackMove', units: [a.id], x: 38, y: 20 });
  const ev = runCollect(w, 14);
  assert.equal(eventsOf(ev, 'hit').length, 0);
  assert.equal(eventsOf(ev, 'projectile').length, 0);
  assert.ok(a.x > 34, `walked through to ${a.x}`);
  for (const e of [a, foe, tower]) assert.equal(e.hp, e.maxHp);
  endPeace(w);
  a.x = 26;
  a.y = 20;
  w.hash.rebuild(w.unitList);
  run(w, 4);
  assert.ok(hurt(a), 'the tower fires once the peace is over');
});

// ---- Spells: every harmful effect skips rivals, whatever it is aimed at ----

/** [name, effects, ability extras, did it land on this unit] */
const HARMFUL_EFFECTS = [
  ['damage', [{ type: 'damage', amount: 50, radius: 8 }], {}, hurt],
  ['stun', [{ type: 'stun', duration: 10, radius: 8 }], {}, (u) => has(u, 'stun')],
  ['slow', [{ type: 'slow', duration: 10, radius: 8 }], {}, (u) => has(u, 'slow')],
  ['dot', [{ type: 'dot', dps: 10, duration: 10, radius: 8 }], {}, (u) => has(u, 'dot')],
  ['debuff', [{ type: 'buff', stat: 'armor', amount: -3, duration: 10, radius: 8 }], {}, (u) => has(u, 'buff')],
  ['field', [{ type: 'field', duration: 3, radius: 8, dps: 40 }], {}, hurt],
  ['field slow', [{ type: 'field', duration: 10, radius: 8, slowPct: 0.3 }], {}, (u) => has(u, 'slow')],
  ['line', [{ type: 'line', amount: 60, width: 3, length: 16 }], {}, hurt],
  ['dash', [{ type: 'dash', amount: 60, width: 3 }], { range: 12 }, hurt],
  ['knockback', [{ type: 'knockback', distance: 3, radius: 8 }], {}, (u) => u.moved > 0.3],
  ['pull', [{ type: 'pull', distance: 3, radius: 8 }], {}, (u) => u.moved > 0.3],
];

/** Player 0 casts at (30, 20) with a rival, a creature and its own unit in reach. */
function sandbox(effects, extra, over = false) {
  const w = arena();
  const a = ability('t_peace', effects, { range: 12, ...extra });
  const caster = spawn(w, 0, defineUnit({ abilities: [a], attack: null }), 20, 20);
  const rival = target(w, 1, 24, 20.2);
  const creep = target(w, NEUTRAL, 27, 19.8);
  const own = target(w, 0, 25, 23.5);
  const at = {};
  for (const u of [rival, creep, own]) at[u.id] = { x: u.x, y: u.y };
  if (over) endPeace(w);
  w.issueCommand(0, { type: 'cast', unit: caster.id, ability: 't_peace', x: 30, y: 20 });
  run(w, 3.2);
  for (const u of [rival, creep, own]) u.moved = Math.hypot(u.x - at[u.id].x, u.y - at[u.id].y);
  return { w, caster, rival, creep, own };
}

for (const [name, effects, extra, landed] of HARMFUL_EFFECTS) {
  test(`spell effect ${name}: lands on creatures, never on a rival or a friend in the peace, on a rival after it`, () => {
    const s = sandbox(effects, extra);
    assert.equal(landed(s.creep), true, 'the creature feels it');
    assert.equal(landed(s.rival), false, 'the rival does not');
    assert.equal(landed(s.own), false, 'neither does a friend');
    assert.ok(s.caster.cooldowns.t_peace > 0, 'the spell was cast');
    const after = sandbox(effects, extra, true);
    assert.equal(landed(after.rival), true, 'once the peace is over the rival does');
    assert.equal(landed(after.own), false);
  });
}

test('a harmful spell that also reaches friends hurts them but still skips rivals', () => {
  const s = sandbox([{ type: 'damage', amount: 50, radius: 8, affects: 'all' }], {});
  assert.ok(hurt(s.own), 'friendly fire is unchanged');
  assert.ok(hurt(s.creep));
  assert.equal(s.rival.hp, s.rival.maxHp);
  const after = sandbox([{ type: 'damage', amount: 50, radius: 8, affects: 'all' }], {}, true);
  assert.ok(hurt(after.rival) && hurt(after.own));
});

test('helpful spells are untouched: heals and shields reach friends in the peace', () => {
  const w = arena();
  const a = ability('t_heal', [{ type: 'heal', amount: 100, radius: 8 }, { type: 'shield', amount: 50, duration: 5, radius: 8 }], { range: 12, ai: { use: 'heal' } });
  const caster = spawn(w, 0, defineUnit({ abilities: [a], attack: null }), 20, 20);
  const friend = target(w, 0, 26, 20);
  friend.hp = 100;
  const rival = target(w, 1, 27, 20);
  rival.hp = 100;
  w.issueCommand(0, { type: 'cast', unit: caster.id, ability: 't_heal', x: 26, y: 20 });
  run(w, 1);
  assert.equal(friend.hp, 200);
  assert.ok(has(friend, 'shield'));
  assert.equal(rival.hp, 100);
});

test('a chain cannot start on a rival in the peace, does not hop to one, and works on a creature', () => {
  const w = arena();
  const a = ability('t_chain', [{ type: 'chain', amount: 100, bounces: 3, bounceRange: 6, falloff: 0.5 }], { target: 'enemy', range: 14, cooldown: 4 });
  const caster = spawn(w, 0, defineUnit({ abilities: [a], attack: null }), 20, 20);
  const rival = target(w, 1, 26, 20);
  const creep = target(w, NEUTRAL, 28, 20);
  const creep2 = target(w, NEUTRAL, 30, 20);
  w.issueCommand(0, { type: 'cast', unit: caster.id, ability: 't_chain', target: rival.id });
  w.tick();
  assert.equal(errorsOf(w.events).length, 1, 'told why');
  assert.equal(caster.cooldowns.t_chain || 0, 0, 'nothing was spent');
  run(w, 1);
  assert.equal(rival.hp, rival.maxHp);
  w.issueCommand(0, { type: 'cast', unit: caster.id, ability: 't_chain', target: creep.id });
  run(w, 2);
  assert.equal(creep.maxHp - creep.hp, 100);
  assert.equal(creep2.maxHp - creep2.hp, 50);
  assert.equal(rival.hp, rival.maxHp, 'the chain skipped the rival standing between the two');
  endPeace(w);
  caster.cooldowns = {};
  w.issueCommand(0, { type: 'cast', unit: caster.id, ability: 't_chain', target: rival.id });
  run(w, 1);
  assert.equal(rival.maxHp - rival.hp, 100);
});

test('a single-unit harmful spell cannot be aimed at a rival in the peace, a helpful one is not refused', () => {
  const w = arena();
  const stun = ability('t_stun', [{ type: 'stun', duration: 2 }], { target: 'unit', range: 14 });
  const ward = ability('t_ward', [{ type: 'shield', amount: 50, duration: 5 }], { key: 'W', target: 'unit', range: 14, ai: { use: 'buff' } });
  const caster = spawn(w, 0, defineUnit({ abilities: [stun, ward], attack: null }), 20, 20);
  const rival = target(w, 1, 26, 20);
  const creep = target(w, NEUTRAL, 26, 24);
  w.issueCommand(0, { type: 'cast', unit: caster.id, ability: 't_stun', target: rival.id });
  w.tick();
  assert.equal(errorsOf(w.events).length, 1);
  assert.equal(caster.cooldowns.t_stun || 0, 0);
  run(w, 1);
  assert.equal(has(rival, 'stun'), false);
  w.events.length = 0;
  w.issueCommand(0, { type: 'cast', unit: caster.id, ability: 't_stun', target: creep.id });
  run(w, 1);
  assert.equal(has(creep, 'stun'), true);
  assert.equal(errorsOf(w.events).length, 0);
  endPeace(w);
  caster.cooldowns = {};
  w.issueCommand(0, { type: 'cast', unit: caster.id, ability: 't_stun', target: rival.id });
  run(w, 1);
  assert.equal(has(rival, 'stun'), true);
});

test('autocast spells wait for a creature in the peace and fire on a rival after it', () => {
  const nuke = ability('t_auto', [{ type: 'damage', amount: 30, radius: 3, at: 'self' }], { target: 'none', autocast: true, cooldown: 5 });
  const w = arena();
  const brute = defineUnit({ abilities: [nuke] });
  const u = spawn(w, 0, brute, 20, 20);
  const foe = target(w, 1, 21, 20);
  run(w, 3);
  assert.equal(u.cooldowns.t_auto || 0, 0, 'no rival in reach counts');
  assert.equal(foe.hp, foe.maxHp);
  const creep = target(w, NEUTRAL, 20, 22);
  run(w, 1);
  assert.ok(u.cooldowns.t_auto > 0, 'a creature is a fine target');
  assert.ok(hurt(creep));
  assert.equal(foe.hp, foe.maxHp, 'the rival beside it was spared');
  endPeace(w);
  u.cooldowns = {};
  run(w, 2);
  assert.ok(hurt(foe));
});

test('debuff auras skip rivals in the peace but still hit creatures', () => {
  const curse = defineUnit({ attack: null, passives: [{ type: 'aura', stat: 'armor', amount: -3, radius: 6, affects: 'enemies' }] });
  const w = arena();
  spawn(w, 0, curse, 20, 20);
  const rival = target(w, 1, 23, 20);
  const creep = target(w, NEUTRAL, 20, 23);
  run(w, 1);
  assert.equal(rival.armorNow, rival.baseArmor);
  assert.equal(creep.armorNow, creep.baseArmor - 3);
  endPeace(w);
  run(w, 1);
  assert.equal(rival.armorNow, rival.baseArmor - 3);
});

test('damage that gets past every other check is still refused between players', () => {
  const w = arena();
  const src = spawn(w, 0, 'warrior', 20, 20);
  const friend = spawn(w, 0, 'warrior', 22, 20);
  const foe = spawn(w, 1, 'warrior', 24, 20);
  const creep = spawn(w, NEUTRAL, 'warrior', 26, 20);
  const foeHouse = place(w, 1, 'house', 30, 24);
  assert.equal(dealDamage(w, foe, 50, src, { spell: true }), 0);
  assert.equal(dealDamage(w, foeHouse, 50, src, { spell: true }), 0);
  assert.equal(foe.hp, foe.maxHp);
  assert.equal(foeHouse.hp, foeHouse.maxHp);
  assert.ok(dealDamage(w, friend, 50, src, { spell: true }) > 0, 'friendly fire stays');
  assert.ok(dealDamage(w, creep, 50, src, { spell: true }) > 0);
  assert.ok(dealDamage(w, src, 50, creep, { spell: true }) > 0, 'a creature hurts a player');
  assert.ok(dealDamage(w, foe, 50, null) > 0, 'sourceless damage (a trap, a fall) is not a player');
  endPeace(w);
  assert.ok(dealDamage(w, foe, 50, src, { spell: true }) > 0);
});

test('the peace ends exactly once, on time, and says so', () => {
  const w = makeWorld({ peaceMinutes: 30 });
  const seen = [];
  const total = 30 * 60 * TICK_RATE;
  for (let i = 0; i < total + 40; i++) {
    const before = w.time;
    w.tick();
    for (const e of w.events) if (e.type === 'peaceEnd') seen.push(before);
    w.events.length = 0;
    if (i === total - 2) assert.equal(w.peace, true, 'still on a tick before');
  }
  assert.equal(seen.length, 1);
  assert.ok(Math.abs(seen[0] - 1800) < 0.06, `ended at ${seen[0]}`);
  assert.equal(w.peace, false);
  assert.equal(w.peaceLeft(), 0);
});
