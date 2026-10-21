import test from 'node:test';
import assert from 'node:assert/strict';
import { MORTALS, godsFor, xpValue, getUnitType } from '../../src/data/index.js';
import { PROJECTILE_SPEED, CREEP_LEASH_RANGE, GOD_XP_LEVELS } from '../../src/config.js';
import { armorMultiplier, damageAfterArmor } from '../../src/sim/combat.js';
import { makeWorld, run, runCollect, runUntil, place, spawn, clearUnits, defineUnit, eventsOf, PLAIN_PANTHEONS } from './helpers.js';

function arena(opts = {}) {
  const w = makeWorld(opts);
  clearUnits(w, 0);
  clearUnits(w, 1);
  w.events.length = 0;
  return w;
}

test('armor formula matches WC3', () => {
  assert.equal(armorMultiplier(0), 1);
  assert.ok(Math.abs(armorMultiplier(5) - (1 - 0.3 / 1.3)) < 1e-12);
  assert.ok(Math.abs(armorMultiplier(-3) - (2 - Math.pow(0.94, 3))) < 1e-12);
  assert.ok(Math.abs(damageAfterArmor(100, 2) - 100 * (1 - 0.12 / 1.12)) < 1e-9);
});

test('melee attack lands at the swing with armor applied', () => {
  const w = arena();
  const a = spawn(w, 0, 'warrior', 20, 20);
  const b = spawn(w, 1, 'warrior', 20.75, 20);
  w.setOrder(b, { type: 'hold', target: 0 });
  w.issueCommand(0, { type: 'attack', units: [a.id], target: b.id });
  w.tick();
  const hits = eventsOf(w.events, 'hit').filter((e) => e.dst === b.id);
  assert.equal(hits.length, 1);
  const expected = MORTALS.warrior.attack.damage * armorMultiplier(MORTALS.warrior.armor);
  assert.ok(Math.abs(b.maxHp - b.hp - expected) < 1e-6);
  assert.equal(hits[0].amount, Math.round(expected));
  assert.ok(eventsOf(w.events, 'attack').some((e) => e.src === a.id && e.dst === b.id && e.ranged === false));
  // next swing after cooldown
  const before = b.hp;
  run(w, MORTALS.warrior.attack.cooldown - 0.1);
  assert.equal(b.hp, before);
  run(w, 0.2);
  assert.ok(b.hp < before);
});

test('ranged attack: projectile event with flight time, damage on arrival', () => {
  const w = arena();
  const a = spawn(w, 0, 'archer', 20, 20);
  const b = spawn(w, 1, 'warrior', 25, 20);
  w.setOrder(b, { type: 'hold', target: 0 });
  w.issueCommand(0, { type: 'attack', units: [a.id], target: b.id });
  w.tick();
  const pe = eventsOf(w.events, 'projectile');
  assert.equal(pe.length, 1);
  assert.equal(pe[0].kind, 'arrow');
  assert.equal(pe[0].src, a.id);
  assert.equal(pe[0].dst, b.id);
  const flight = 5 / PROJECTILE_SPEED;
  assert.ok(Math.abs(pe[0].flight - flight) < 0.01);
  assert.equal(b.hp, b.maxHp);
  const ticks = Math.ceil(flight * 20);
  for (let i = 0; i < ticks - 1; i++) w.tick();
  assert.equal(b.hp, b.maxHp, 'not yet');
  w.tick();
  assert.ok(b.hp < b.maxHp, 'landed');
});

test('projectile misses when the target dies in flight', () => {
  const w = arena();
  const a = spawn(w, 0, 'archer', 20, 20);
  const b = spawn(w, 1, 'warrior', 25, 20);
  w.issueCommand(0, { type: 'attack', units: [a.id], target: b.id });
  w.tick();
  assert.equal(w.projectiles.length, 1);
  w.killEntity(b, null);
  run(w, 1);
  assert.equal(w.projectiles.length, 0);
});

test('air targeting: melee cannot hit flyers, archers can', () => {
  const flyer = defineUnit({ air: true, attack: null, speed: 3 });
  const w = arena();
  const bird = spawn(w, 1, flyer, 20, 20);
  const war = spawn(w, 0, 'warrior', 20.5, 20.6);
  const arch = spawn(w, 0, 'archer', 23, 20);
  w.issueCommand(0, { type: 'attack', units: [war.id], target: bird.id });
  w.tick();
  assert.notEqual(war.order && war.order.type, 'attack');
  w.issueCommand(0, { type: 'attack', units: [arch.id], target: bird.id });
  run(w, 1);
  assert.ok(bird.hp < bird.maxHp);
  // air units do not collide with ground units
  assert.ok(Math.hypot(war.x - bird.x, war.y - bird.y) < war.radius + bird.radius);
});

test('idle units auto-acquire: units that can attack first, then units, then buildings', () => {
  const w = arena();
  const a = spawn(w, 0, 'warrior', 20, 20);
  place(w, 1, 'house', 21, 18);
  const wk = spawn(w, 1, 'worshipper', 21.6, 20);
  w.setOrder(wk, { type: 'gather', mine: w.mineList[1].id, phase: 'go', timer: 0 });
  wk.ghost = true;
  const enemy = spawn(w, 1, 'warrior', 24, 20);
  w.setOrder(enemy, { type: 'hold', target: 0 });
  w.setOrder(wk, { type: 'hold', target: 0 });
  run(w, 0.3);
  assert.equal(a.order && a.order.type, 'attack');
  // The worker can attack too, and is closest.
  assert.equal(a.order.target, wk.id);
});

test('auto-acquire prefers armed units over buildings', () => {
  const unarmed = defineUnit({ attack: null });
  const w = arena();
  const a = spawn(w, 0, 'warrior', 20, 20);
  const house = place(w, 1, 'house', 21, 19);
  const sheep = spawn(w, 1, unarmed, 23, 20.5);
  w.setOrder(sheep, { type: 'hold', target: 0 });
  run(w, 0.3);
  assert.equal(a.order.target, sheep.id);
  w.killEntity(sheep, null);
  run(w, 0.5);
  assert.equal(a.order.target, house.id);
});

test('hold position: attacks only in range, never moves', () => {
  const w = arena();
  const a = spawn(w, 0, 'warrior', 20, 20);
  const e = spawn(w, 1, 'archer', 23, 20);
  w.setOrder(e, { type: 'hold', target: 0 });
  w.issueCommand(0, { type: 'hold', units: [a.id] });
  run(w, 3);
  assert.ok(Math.hypot(a.x - 20, a.y - 20) < 0.05, 'did not move');
  assert.equal(a.state, 'idle');
  const b = spawn(w, 1, 'warrior', 20.8, 20);
  w.setOrder(b, { type: 'hold', target: 0 });
  run(w, 0.5);
  assert.equal(a.state, 'attack');
  assert.ok(b.hp < b.maxHp);
});

test('attack-move engages enemies on the way, then continues', () => {
  const w = arena();
  const a = spawn(w, 0, 'warrior', 10, 20);
  const e = spawn(w, 1, 'worshipper', 18, 20);
  w.setOrder(e, { type: 'hold', target: 0 });
  w.issueCommand(0, { type: 'attackMove', units: [a.id], x: 30, y: 20 });
  runUntil(w, () => e.dead, 30);
  assert.ok(e.dead);
  runUntil(w, () => !a.order, 20);
  assert.ok(Math.hypot(a.x - 30, a.y - 20) < 0.6);
});

test('idle unit fights back when attacked (workers too)', () => {
  const w = arena();
  const wk = spawn(w, 0, 'worshipper', 20, 20);
  const archer = spawn(w, 1, 'archer', 25, 20);
  w.issueCommand(1, { type: 'attack', units: [archer.id], target: wk.id });
  run(w, 1);
  assert.equal(wk.order && wk.order.type, 'attack');
  assert.equal(wk.order.target, archer.id);
  const ev = runCollect(w, 0.1);
  assert.ok(ev.length >= 0);
});

test('gathering workers do not fight back; underAttack alert is throttled', () => {
  const w = makeWorld();
  clearUnits(w, 1);
  const ws = w.unitsOf(0);
  w.issueCommand(0, { type: 'gather', units: ws.map((u) => u.id), target: w.mineList[0].id });
  run(w, 3);
  const archer = spawn(w, 1, 'archer', 14, 14);
  w.issueCommand(1, { type: 'attack', units: [archer.id], target: ws[0].id });
  const ev = runCollect(w, 4);
  assert.equal(ws[0].dead || ws[0].order.type, ws[0].dead ? true : 'gather');
  assert.equal(eventsOf(ev, 'underAttack').length, 1);
  const ua = eventsOf(ev, 'underAttack')[0];
  assert.equal(ua.player, 0);
});

test('splash damages nearby enemies at 50%; buildingMult multiplies vs buildings', () => {
  const splasher = defineUnit({ attack: { damage: 100, range: 0.5, cooldown: 2, canHitAir: false, projectile: null, element: 'earth', splash: 2, buildingMult: 2 } });
  const w = arena();
  const a = spawn(w, 0, splasher, 20, 20);
  const t1 = spawn(w, 1, 'worshipper', 20.7, 20);
  const t2 = spawn(w, 1, 'worshipper', 21.5, 20.5);
  const far = spawn(w, 1, 'worshipper', 26, 20);
  for (const u of [t1, t2, far]) w.setOrder(u, { type: 'hold', target: 0 });
  w.issueCommand(0, { type: 'attack', units: [a.id], target: t1.id });
  w.tick();
  assert.ok(Math.abs(t1.maxHp - t1.hp - 100) < 1e-6);
  assert.ok(Math.abs(t2.maxHp - t2.hp - 50) < 1e-6);
  assert.equal(far.hp, far.maxHp);
  const house = place(w, 1, 'house', 30, 30);
  const b = spawn(w, 0, splasher, 29.4, 30.8);
  w.issueCommand(0, { type: 'attack', units: [b.id], target: house.id });
  w.tick();
  const expected = 100 * 2 * armorMultiplier(house.armor);
  assert.ok(Math.abs(house.maxHp - house.hp - expected) < 1e-6);
});

test('battering ram only attacks buildings', () => {
  const w = arena();
  const ram = spawn(w, 0, 'battering_ram', 20, 20);
  const e = spawn(w, 1, 'warrior', 21, 20);
  w.setOrder(e, { type: 'hold', target: 0 });
  w.issueCommand(0, { type: 'attack', units: [ram.id], target: e.id });
  run(w, 1);
  assert.equal(e.hp, e.maxHp);
  const house = place(w, 1, 'house', 22, 22);
  w.issueCommand(0, { type: 'smart', units: [ram.id], target: house.id, x: 23, y: 23 });
  run(w, 4);
  assert.ok(house.hp < house.maxHp);
});

test('towers shoot the closest enemy unit in range', () => {
  const w = arena();
  const tower = place(w, 0, 'tower', 20, 20);
  const near = spawn(w, 1, 'warrior', 24, 21);
  const far = spawn(w, 1, 'warrior', 27, 21);
  for (const u of [near, far]) w.setOrder(u, { type: 'hold', target: 0 });
  const ev = runCollect(w, 1.5);
  const shots = eventsOf(ev, 'projectile').filter((p) => p.src === tower.id);
  assert.ok(shots.length >= 1);
  assert.equal(shots[0].dst, near.id);
  assert.ok(near.hp < near.maxHp);
});

test('passives: lifesteal, critical, evasion, thorns, cleave, onHit slow/dot, regen, aura', () => {
  const w = arena({ pantheons: PLAIN_PANTHEONS });
  const thief = defineUnit({ passives: [{ type: 'lifesteal', pct: 0.5 }] });
  const crit = defineUnit({ passives: [{ type: 'critical', chance: 1, mult: 2 }] });
  const dodger = defineUnit({ passives: [{ type: 'evasion', pct: 1 }] });
  const spiky = defineUnit({ passives: [{ type: 'thorns', pct: 0.5 }] });
  const cleaver = defineUnit({ passives: [{ type: 'cleave', pct: 0.5, radius: 1.5 }] });
  const frost = defineUnit({ passives: [{ type: 'onHitSlow', pct: 0.4, duration: 2 }, { type: 'onHitDot', dps: 10, duration: 2 }] });
  const troll = defineUnit({ passives: [{ type: 'regen', hps: 5 }] });
  const banner = defineUnit({ passives: [{ type: 'aura', stat: 'armor', amount: 3, radius: 5, affects: 'allies' }] });
  const victim = () => {
    const v = spawn(w, 1, 'warrior', 0, 0);
    w.setOrder(v, { type: 'hold', target: 0 });
    return v;
  };
  const duel = (type, x) => {
    const a = spawn(w, 0, type, x, 10);
    const v = victim();
    v.x = x + 0.75;
    v.y = 10;
    w.hash.rebuild(w.unitList);
    return [a, v];
  };
  const dmg = MORTALS.warrior.attack.damage * armorMultiplier(2);
  {
    const [a, v] = duel(thief, 5);
    a.hp = 100;
    w.issueCommand(0, { type: 'attack', units: [a.id], target: v.id });
    w.tick();
    assert.ok(Math.abs(a.hp - (100 + dmg * 0.5)) < 1e-6, 'lifesteal');
  }
  {
    const [a, v] = duel(crit, 10);
    w.issueCommand(0, { type: 'attack', units: [a.id], target: v.id });
    w.tick();
    assert.ok(Math.abs(v.maxHp - v.hp - dmg * 2) < 1e-6, 'critical');
  }
  {
    const a = spawn(w, 1, 'warrior', 15, 10);
    const d = spawn(w, 0, dodger, 15.75, 10);
    w.setOrder(d, { type: 'hold', target: 0 });
    w.issueCommand(1, { type: 'attack', units: [a.id], target: d.id });
    run(w, 3);
    assert.equal(d.hp, d.maxHp, 'evasion');
  }
  {
    const a = spawn(w, 1, 'warrior', 20, 10);
    const s = spawn(w, 0, spiky, 20.75, 10);
    w.setOrder(s, { type: 'hold', target: 0 });
    w.setOrder(a, { type: 'attack', target: s.id });
    w.tick();
    assert.ok(a.hp < a.maxHp, 'thorns');
  }
  {
    const [a, v] = duel(cleaver, 25);
    const v2 = victim();
    v2.x = 25.75;
    v2.y = 10.8;
    w.hash.rebuild(w.unitList);
    w.issueCommand(0, { type: 'attack', units: [a.id], target: v.id });
    w.tick();
    assert.ok(v2.hp < v2.maxHp, 'cleave');
  }
  {
    const [a, v] = duel(frost, 30);
    w.issueCommand(0, { type: 'attack', units: [a.id], target: v.id });
    w.tick();
    w.tick();
    assert.ok(v.slowPct >= 0.4, 'onHitSlow');
    assert.ok(v.statuses.some((s) => s.type === 'dot'), 'onHitDot');
  }
  {
    const t = spawn(w, 0, troll, 35, 20);
    t.hp = 100;
    run(w, 1);
    assert.ok(Math.abs(t.hp - 105) < 0.01, 'regen');
  }
  {
    const flag = spawn(w, 0, banner, 40, 30);
    const friend = spawn(w, 0, 'warrior', 41, 30);
    w.setOrder(flag, { type: 'hold', target: 0 });
    w.setOrder(friend, { type: 'hold', target: 0 });
    run(w, 0.6);
    assert.equal(friend.armorNow, MORTALS.warrior.armor + 3, 'aura');
    assert.ok(w.getSnapshot().entities.find((e) => e.id === friend.id).fx.includes('buff'));
  }
});

test('xp from enemy deaths levels gods up with stat scaling', () => {
  const w = arena();
  const godDef = godsFor(w.players[0].pantheon)[0];
  const g = spawn(w, 0, godDef.id, 20, 20);
  const g2 = spawn(w, 0, godsFor(w.players[0].pantheon)[1].id, 22, 20);
  const victim = spawn(w, 1, 'warrior', 21, 21);
  const val = xpValue(getUnitType('warrior'));
  w.killEntity(victim, g);
  assert.equal(g.xp, Math.round(val / 2));
  assert.equal(g2.xp, Math.round(val / 2));
  w.events.length = 0;
  w.gainXp(g, GOD_XP_LEVELS[1]);
  assert.equal(g.level, 2);
  assert.deepEqual(eventsOf(w.events, 'levelUp').map((e) => [e.id, e.level]), [[g.id, 2]]);
  assert.equal(g.maxHp, Math.round(godDef.hp * 1.08));
  assert.ok(Math.abs(g.baseDamage - godDef.attack.damage * 1.08) < 1e-9);
  assert.equal(g.baseArmor, godDef.armor + 0.5);
  w.gainXp(g, 99999);
  assert.equal(g.level, 6);
  // far-away gods get nothing
  const lonely = spawn(w, 0, godsFor(w.players[0].pantheon)[2].id, 40, 40);
  const v2 = spawn(w, 1, 'warrior', 21, 21);
  w.killEntity(v2, g);
  assert.equal(lonely.xp, 0);
});

test('creeps aggro, leash back to camp and heal, and pay bounty', () => {
  const w = makeWorld({ map: { camps: [{ x: 24, y: 24, level: 1 }] } });
  clearUnits(w, 0);
  clearUnits(w, 1);
  const creeps = w.unitsOf(-1);
  assert.ok(creeps.length >= 2 && creeps.length <= 3);
  for (const c of creeps) assert.equal(c.def.tier, 1);
  const homes = creeps.map((c) => ({ x: c.x, y: c.y }));
  // a unit walking into aggro range wakes the whole camp
  const bait = spawn(w, 0, 'warrior', 24, 24 - 4.5);
  w.setOrder(bait, { type: 'hold', target: 0 });
  run(w, 0.5);
  assert.ok(creeps.every((c) => c.creepState === 'fight'));
  // run away beyond the leash
  bait.def = { ...bait.def };
  w.setOrder(bait, { type: 'move', x: 24, y: 2, group: null });
  bait.baseSpeed = 8;
  run(w, 8);
  assert.ok(creeps.every((c) => c.creepState !== 'fight' || Math.hypot(c.x - 24, c.y - 24) <= CREEP_LEASH_RANGE + 1));
  run(w, 10);
  for (let i = 0; i < creeps.length; i++) {
    const c = creeps[i];
    assert.equal(c.creepState, 'idle');
    assert.equal(c.hp, c.maxHp);
    assert.ok(Math.hypot(c.x - homes[i].x, c.y - homes[i].y) < 0.8);
  }
  // bounty
  const killer = spawn(w, 0, 'warrior', 2, 2);
  const g0 = w.players[0].gold;
  w.killEntity(creeps[0], killer);
  assert.equal(w.players[0].gold - g0, 10 + 10 * creeps[0].def.tier);
  assert.ok(eventsOf(w.events, 'bounty').length === 1);
});

test('creep camp compositions by level', () => {
  const w = makeWorld({ map: { camps: [{ x: 20, y: 24, level: 2 }, { x: 30, y: 30, level: 3 }] } });
  const byCamp = w.camps.map((c) => c.members.map((m) => m.def.tier).sort());
  assert.deepEqual(byCamp[0], [1, 1, 2]);
  assert.deepEqual(byCamp[1], [2, 2, 3]);
  for (const c of w.camps) for (const m of c.members) assert.equal(m.owner, -1);
});
