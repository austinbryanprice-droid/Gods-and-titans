import test from 'node:test';
import assert from 'node:assert/strict';
import { SPELL_VS_BUILDING, ABILITY_LEVEL_SCALE } from '../../src/config.js';
import { MORTALS, godsFor } from '../../src/data/index.js';
import { EFFECT_TYPES } from '../../src/data/schema.js';
import { makeWorld, run, runCollect, runUntil, place, spawn, clearUnits, defineUnit, ability, eventsOf, errorsOf } from './helpers.js';

function arena() {
  const w = makeWorld({ width: 64, height: 64, map: { width: 64, height: 64 } });
  clearUnits(w, 0);
  clearUnits(w, 1);
  w.events.length = 0;
  return w;
}

function caster(w, abilities, extra = {}) {
  const id = defineUnit({ abilities, attack: null, ...extra });
  return spawn(w, 0, id, 20, 20);
}

function dummy(w, owner, x, y, type = 'warrior') {
  const u = spawn(w, owner, type, x, y);
  w.setOrder(u, { type: 'hold', target: 0 });
  return u;
}

function cast(w, u, abilityId, opts = {}) {
  w.issueCommand(u.owner, { type: 'cast', unit: u.id, ability: abilityId, ...opts });
  w.tick();
}

const covered = new Set();
const ab = (id, effects, extra) => {
  for (const e of effects) covered.add(e.type);
  return ability(id, effects, extra);
};

test('damage effect in a radius, vs buildings × SPELL_VS_BUILDING, emits cast + effect', () => {
  const w = arena();
  const a = ab('t_dmg', [{ type: 'damage', amount: 100, radius: 2, at: 'target' }], { vfx: { element: 'lightning', shape: 'strike' } });
  const c = caster(w, [a]);
  const e1 = dummy(w, 1, 25, 20);
  const e2 = dummy(w, 1, 26, 20.5);
  const ally = dummy(w, 0, 25, 22.5);
  const house = place(w, 1, 'house', 24, 18);
  cast(w, c, 't_dmg', { x: 25, y: 20 });
  assert.equal(e1.maxHp - e1.hp, 100);
  assert.equal(e2.maxHp - e2.hp, 100);
  assert.equal(ally.hp, ally.maxHp);
  assert.ok(Math.abs(house.maxHp - house.hp - 100 * SPELL_VS_BUILDING) < 1e-6);
  const casts = eventsOf(w.events, 'cast');
  assert.equal(casts.length, 1);
  assert.equal(casts[0].src, c.id);
  assert.equal(casts[0].ability, 't_dmg');
  const fx = eventsOf(w.events, 'effect');
  assert.equal(fx.length, 1);
  assert.equal(fx[0].el, 'lightning');
  assert.equal(fx[0].shape, 'strike');
  assert.equal(fx[0].x, 25);
  assert.equal(fx[0].r, 2);
  assert.ok(fx[0].duration > 0);
});

test('cooldown, not ready error, cooldown in snapshot', () => {
  const w = arena();
  const c = caster(w, [ab('t_cd', [{ type: 'damage', amount: 10, radius: 1 }], { cooldown: 5 })]);
  cast(w, c, 't_cd', { x: 22, y: 20 });
  assert.ok(c.cooldowns.t_cd > 4.8);
  w.events.length = 0;
  cast(w, c, 't_cd', { x: 22, y: 20 });
  assert.deepEqual(errorsOf(w.events), ['That ability is not ready.']);
  const v = w.getSnapshot().entities.find((e) => e.id === c.id);
  assert.ok(v.cd.t_cd > 4.5);
  run(w, 5);
  assert.equal(c.cooldowns.t_cd, undefined);
  assert.deepEqual(w.getSnapshot().entities.find((e) => e.id === c.id).cd, {});
});

test('cast order walks into range first; cast time holds the caster', () => {
  const w = arena();
  const c = caster(w, [ab('t_far', [{ type: 'damage', amount: 50, radius: 1 }], { range: 4, castTime: 0.5 })]);
  const e = dummy(w, 1, 32, 20);
  cast(w, c, 't_far', { x: 32, y: 20 });
  assert.equal(c.state, 'move');
  runUntil(w, () => c.state === 'cast', 10);
  assert.ok(Math.hypot(c.x - 32, c.y - 20) <= 4.1);
  const x = c.x;
  run(w, 0.3);
  assert.equal(c.state, 'cast');
  assert.equal(c.x, x);
  assert.equal(e.hp, e.maxHp);
  run(w, 0.3);
  assert.equal(e.maxHp - e.hp, 50);
});

test('target out of range error when the point cannot be reached', () => {
  const w = makeWorld({ map: { width: 64, height: 64, water: [{ x: 40, y: 0, w: 24, h: 64 }] } });
  clearUnits(w, 0);
  const c = caster(w, [ab('t_oor', [{ type: 'damage', amount: 5, radius: 1 }], { range: 2 })]);
  w.issueCommand(0, { type: 'cast', unit: c.id, ability: 't_oor', x: 55, y: 20 });
  const ev = runCollect(w, 20);
  assert.ok(errorsOf(ev).includes('Target out of range.'));
});

test('god abilities lock by level and scale with level', () => {
  const w = arena();
  const godDef = godsFor(w.players[0].pantheon)[0];
  const g = spawn(w, 0, godDef.id, 20, 20);
  const w2 = godDef.abilities.find((a) => a.unlockLevel === 2);
  w.events.length = 0;
  cast(w, g, w2.id, { x: 21, y: 20, target: g.id });
  assert.deepEqual(errorsOf(w.events), [`That ability unlocks at level ${w2.unlockLevel}.`]);
  // scaling: a test god with a damage Q
  const scaled = defineUnit({ class: 'god', abilities: [ab('t_scale', [{ type: 'damage', amount: 100, radius: 1 }])], attack: null });
  const g2 = spawn(w, 0, scaled, 30, 30);
  w.gainXp(g2, 300);
  assert.equal(g2.level, 3);
  const e = dummy(w, 1, 33, 30, 'worshipper');
  cast(w, g2, 't_scale', { x: 33, y: 30 });
  assert.ok(Math.abs(e.maxHp - e.hp - 100 * (1 + ABILITY_LEVEL_SCALE * 2)) < 1e-6);
});

test('heal never exceeds max hp; target ally', () => {
  const w = arena();
  const c = caster(w, [ab('t_heal', [{ type: 'heal', amount: 100, radius: 0 }], { target: 'ally', ai: { use: 'heal' } })]);
  const f = dummy(w, 0, 22, 20);
  f.hp = f.maxHp - 30;
  cast(w, c, 't_heal', { target: f.id });
  assert.equal(f.hp, f.maxHp);
});

test('stun stops movement and attacks; slow reduces speed', () => {
  const w = arena();
  const c = caster(w, [
    ab('t_stun', [{ type: 'stun', duration: 1, radius: 1.5 }]),
    ab('t_slow', [{ type: 'slow', pct: 0.5, duration: 3, radius: 1.5 }], { key: 'W' }),
  ]);
  const e = spawn(w, 1, 'warrior', 25, 20);
  w.setOrder(e, { type: 'move', x: 25, y: 40, group: null });
  cast(w, c, 't_stun', { x: 25, y: 20 });
  assert.ok(e.statuses.some((s) => s.type === 'stun'));
  const y = e.y;
  run(w, 0.8);
  assert.ok(Math.abs(e.y - y) < 0.05, 'stunned units do not move');
  assert.ok(w.getSnapshot().entities.find((v) => v.id === e.id).fx.includes('stun'));
  run(w, 0.5);
  assert.ok(e.y > y + 0.2, 'moves after the stun');
  cast(w, c, 't_slow', { x: e.x, y: e.y });
  run(w, 0.05);
  assert.ok(Math.abs(e.speedNow - MORTALS.warrior.speed * 0.5) < 1e-9);
  assert.ok(e.atkSpeedMult <= 0.5 + 1e-9);
  assert.ok(w.getSnapshot().entities.find((v) => v.id === e.id).fx.includes('slow'));
});

test('buff and debuff change derived stats and expire', () => {
  const w = arena();
  const c = caster(w, [
    ab('t_buff', [{ type: 'buff', stat: 'damage', amount: 0.5, duration: 2, radius: 3, at: 'self' }], { target: 'none' }),
    ab('t_armor', [{ type: 'buff', stat: 'armor', amount: -4, duration: 2, radius: 2 }], { key: 'W' }),
    ab('t_misc', [
      { type: 'buff', stat: 'speed', amount: 0.3, duration: 2, radius: 3, at: 'self' },
      { type: 'buff', stat: 'attackSpeed', amount: 0.25, duration: 2, radius: 3, at: 'self' },
      { type: 'buff', stat: 'lifesteal', amount: 0.2, duration: 2, radius: 3, at: 'self' },
      { type: 'buff', stat: 'regen', amount: 10, duration: 2, radius: 3, at: 'self' },
    ], { key: 'E', target: 'none' }),
  ]);
  const f = dummy(w, 0, 21, 20);
  const e = dummy(w, 1, 26, 20);
  cast(w, c, 't_buff');
  run(w, 0.05);
  assert.ok(Math.abs(f.dmgMult - 1.5) < 1e-9);
  cast(w, c, 't_armor', { x: 26, y: 20 });
  run(w, 0.05);
  assert.equal(e.armorNow, MORTALS.warrior.armor - 4);
  assert.ok(w.getSnapshot().entities.find((v) => v.id === e.id).fx.includes('debuff'));
  cast(w, c, 't_misc');
  run(w, 0.05);
  assert.ok(Math.abs(f.speedNow - MORTALS.warrior.speed * 1.3) < 1e-9);
  assert.ok(Math.abs(f.atkSpeedMult - 1.25) < 1e-9);
  assert.ok(Math.abs(f.lifesteal - 0.2) < 1e-9);
  assert.equal(f.regen, 10);
  run(w, 2.1);
  assert.equal(f.dmgMult, 1);
  assert.equal(e.armorNow, MORTALS.warrior.armor);
});

test('shield absorbs damage before hp; invulnerable takes none', () => {
  const w = arena();
  const c = caster(w, [
    ab('t_shield', [{ type: 'shield', amount: 50, duration: 5, radius: 0 }], { target: 'ally', ai: { use: 'buff' } }),
    ab('t_inv', [{ type: 'invulnerable', duration: 2 }], { key: 'W', target: 'none', ai: { use: 'escape' } }),
  ]);
  const f = dummy(w, 0, 22, 20);
  cast(w, c, 't_shield', { target: f.id });
  run(w, 0.05);
  assert.equal(f.shield, 50);
  assert.equal(w.getSnapshot().entities.find((v) => v.id === f.id).sh, 50);
  const e = spawn(w, 1, 'archer', 26, 20);
  w.issueCommand(1, { type: 'attack', units: [e.id], target: f.id });
  run(w, 1);
  assert.equal(f.hp, f.maxHp, 'shield took the hit');
  assert.ok(f.shield < 50);
  cast(w, c, 't_inv');
  run(w, 0.05);
  assert.ok(c.invuln);
  w.issueCommand(1, { type: 'attack', units: [e.id], target: c.id });
  run(w, 1.5);
  assert.equal(c.hp, c.maxHp);
  assert.ok(w.getSnapshot().entities.find((v) => v.id === c.id).fx.includes('invuln'));
});

test('dot ticks damage over time', () => {
  const w = arena();
  const c = caster(w, [ab('t_dot', [{ type: 'dot', dps: 20, duration: 2, radius: 1 }])]);
  const e = dummy(w, 1, 24, 20);
  cast(w, c, 't_dot', { x: 24, y: 20 });
  assert.ok(w.getSnapshot().entities.find((v) => v.id === e.id).fx.includes('dot'));
  run(w, 2.2);
  assert.ok(Math.abs(e.maxHp - e.hp - 40) < 1e-6, `took ${e.maxHp - e.hp}`);
});

test('field ticks every 0.5 s: damages enemies, heals allies, slows; shows in snapshot', () => {
  const w = arena();
  const c = caster(w, [ab('t_field', [{ type: 'field', duration: 3, radius: 2, dps: 20, hps: 10, slowPct: 0.3 }], { vfx: { element: 'fire', shape: 'field' } })]);
  const e = dummy(w, 1, 25, 20);
  const f = dummy(w, 0, 23.3, 20.9);
  f.hp = 200;
  cast(w, c, 't_field', { x: 25, y: 20 });
  const snap = w.getSnapshot();
  assert.equal(snap.fields.length, 1);
  assert.equal(snap.fields[0].el, 'fire');
  assert.equal(snap.fields[0].r, 2);
  assert.ok(snap.fields[0].rem > 2.5);
  assert.ok(e.slowPct > 0 || e.statuses.some((s) => s.type === 'slow'));
  run(w, 3.2);
  assert.ok(Math.abs(e.maxHp - e.hp - 60) < 1e-6, `field dealt ${e.maxHp - e.hp}`);
  assert.ok(Math.abs(f.hp - 230) < 1e-6);
  assert.equal(w.getSnapshot().fields.length, 0);
});

test('summon spawns minions without pop that expire', () => {
  const minion = defineUnit({ class: 'minion', producedAt: null, cost: { gold: 0, wood: 0, faith: 0 }, pop: 0 });
  const w = arena();
  const c = caster(w, [ab('t_sum', [{ type: 'summon', unit: minion, count: 3, duration: 2, at: 'self' }], { target: 'none', ai: { use: 'summon' } })]);
  const pop = w.players[0].popUsed;
  w.events.length = 0;
  cast(w, c, 't_sum');
  const spawned = eventsOf(w.events, 'spawn');
  assert.equal(spawned.length, 3);
  assert.equal(w.players[0].popUsed, pop);
  const m = w.getEntity(spawned[0].id);
  assert.equal(m.owner, 0);
  const v = w.getSnapshot().entities.find((e) => e.id === m.id);
  assert.ok(v.ex > 1.5 && v.ex <= 2);
  const ev = runCollect(w, 2.1);
  assert.equal(eventsOf(ev, 'death').length, 3);
  assert.equal(w.getEntity(m.id), null);
});

test('chain jumps between enemies with falloff and emits points', () => {
  const w = arena();
  const c = caster(w, [ab('t_chain', [{ type: 'chain', amount: 100, bounces: 2, bounceRange: 4, falloff: 0.5 }], { target: 'enemy', vfx: { element: 'lightning', shape: 'chain' } })]);
  const a = dummy(w, 1, 25, 20, 'worshipper');
  const b = dummy(w, 1, 27, 20, 'worshipper');
  const d = dummy(w, 1, 29, 20, 'worshipper');
  const far = dummy(w, 1, 40, 20, 'worshipper');
  cast(w, c, 't_chain', { target: a.id });
  assert.equal(a.maxHp - a.hp, 100);
  assert.equal(b.maxHp - b.hp, 50);
  assert.equal(d.maxHp - d.hp, 25);
  assert.equal(far.hp, far.maxHp);
  const fx = eventsOf(w.events, 'effect');
  assert.equal(fx.length, 1);
  assert.equal(fx[0].points.length, 4);
});

test('line damages enemies in a rectangle toward the point; event has origin', () => {
  const w = arena();
  const c = caster(w, [ab('t_line', [{ type: 'line', amount: 80, width: 1.5, length: 8 }])]);
  const inLine = dummy(w, 1, 26, 20.3);
  const off = dummy(w, 1, 26, 23);
  const beyond = dummy(w, 1, 30, 20);
  cast(w, c, 't_line', { x: 27, y: 20 });
  assert.ok(inLine.hp < inLine.maxHp);
  assert.equal(off.hp, off.maxHp);
  assert.equal(beyond.hp, beyond.maxHp);
  const fx = eventsOf(w.events, 'effect')[0];
  assert.equal(fx.fx, 20);
  assert.equal(fx.fy, 20);
  assert.equal(fx.x, 28);
});

test('knockback pushes away (stops at obstacles); pull draws in', () => {
  const w = makeWorld({ map: { width: 64, height: 64, rock: [{ x: 27, y: 15, w: 1, h: 10 }] } });
  clearUnits(w, 0);
  clearUnits(w, 1);
  const c = caster(w, [
    ab('t_kb', [{ type: 'knockback', distance: 4, radius: 3, at: 'self' }], { target: 'none' }),
    ab('t_pull', [{ type: 'pull', distance: 3, radius: 6, at: 'self' }], { key: 'W', target: 'none' }),
  ]);
  const e = dummy(w, 1, 22, 20);
  const wall = dummy(w, 1, 25.5, 20);
  cast(w, c, 't_kb');
  run(w, 0.5);
  assert.ok(e.x > 25, `knocked to ${e.x}`);
  assert.ok(wall.x < 27, 'stopped by the rock');
  const before = Math.hypot(e.x - c.x, e.y - c.y);
  cast(w, c, 't_pull');
  run(w, 0.5);
  assert.ok(Math.hypot(e.x - c.x, e.y - c.y) < before - 2);
});

test('blink teleports within range to a passable spot', () => {
  const w = makeWorld({ map: { width: 64, height: 64, forest: [{ x: 30, y: 18, w: 4, h: 4 }] } });
  clearUnits(w, 0);
  const c = caster(w, [ab('t_blink', [{ type: 'blink' }], { range: 6, ai: { use: 'escape' }, vfx: { element: 'arcane', shape: 'blink' } })]);
  cast(w, c, 't_blink', { x: 40, y: 20 });
  assert.ok(Math.abs(c.x - 26) < 0.01 && Math.abs(c.y - 20) < 0.01, `${c.x},${c.y}`);
  const fx = eventsOf(w.events, 'effect')[0];
  assert.equal(fx.fx, 20);
  run(w, 4);
  c.cooldowns = {};
  cast(w, c, 't_blink', { x: 31.5, y: 20 });
  assert.ok(w.map.isPassable(Math.floor(c.x), Math.floor(c.y)));
});

test('dash rushes to the point damaging enemies on the way', () => {
  const w = arena();
  const c = caster(w, [ab('t_dash', [{ type: 'dash', amount: 60, width: 1.5 }], { range: 8 })]);
  const a = dummy(w, 1, 24, 20.3);
  const b = dummy(w, 1, 24, 23);
  cast(w, c, 't_dash', { x: 28, y: 20 });
  run(w, 0.6);
  assert.ok(Math.abs(c.x - 28) < 0.3, `at ${c.x}`);
  assert.equal(a.maxHp - a.hp, 60);
  assert.equal(b.hp, b.maxHp);
  const fx = eventsOf(runCollect(w, 0), 'effect');
  assert.equal(fx.length, 0);
});

test('reveal grants team vision in the snapshot; resource grants resources', () => {
  const w = arena();
  const c = caster(w, [
    ab('t_rev', [{ type: 'reveal', radius: 8, duration: 2 }], { range: 30 }),
    ab('t_res', [{ type: 'resource', gold: 50, wood: 20, faith: 30 }], { key: 'W', target: 'none', ai: { use: 'economy' } }),
  ]);
  cast(w, c, 't_rev', { x: 40, y: 40 });
  const snap = w.getSnapshot();
  assert.equal(snap.reveals.length, 1);
  assert.equal(snap.reveals[0].tm, 1);
  assert.equal(snap.reveals[0].r, 8);
  run(w, 2.1);
  assert.equal(w.getSnapshot().reveals.length, 0);
  const g = w.players[0].gold;
  cast(w, c, 't_res');
  assert.equal(w.players[0].gold, g + 50);
});

test('delayed effects land later', () => {
  const w = arena();
  const c = caster(w, [ab('t_meteor', [{ type: 'damage', amount: 200, radius: 2, delay: 0.8 }], { vfx: { element: 'fire', shape: 'meteor' } })]);
  const e = dummy(w, 1, 25, 20);
  cast(w, c, 't_meteor', { x: 25, y: 20 });
  assert.equal(eventsOf(w.events, 'effect')[0].delay, 0.8);
  run(w, 0.7);
  assert.equal(e.hp, e.maxHp);
  run(w, 0.15);
  assert.ok(e.hp < e.maxHp);
});

test('instant self abilities do not interrupt the current order', () => {
  const w = arena();
  const c = caster(w, [ab('t_self', [{ type: 'buff', stat: 'speed', amount: 0.5, duration: 3, at: 'self', radius: 0 }], { target: 'none' })]);
  w.issueCommand(0, { type: 'move', units: [c.id], x: 40, y: 20 });
  w.tick();
  cast(w, c, 't_self');
  assert.equal(c.order.type, 'move');
  assert.ok(c.statuses.some((s) => s.type === 'buff'));
});

test('autocast: priest heals hurt allies automatically', () => {
  const w = arena();
  const priest = spawn(w, 0, 'priest', 20, 20);
  const f = dummy(w, 0, 22, 20);
  f.hp = f.maxHp - 100;
  run(w, 1);
  assert.equal(f.hp, f.maxHp - 75);
  assert.ok(priest.cooldowns.priest_heal > 0);
});

test('autocast creature ability fires during combat and resumes the attack', () => {
  const brute = defineUnit({ abilities: [ab('t_auto', [{ type: 'damage', amount: 30, radius: 2, at: 'self' }], { target: 'none', autocast: true, cooldown: 5 })] });
  const w = arena();
  const u = spawn(w, 0, brute, 20, 20);
  const e = dummy(w, 1, 20.8, 20);
  w.issueCommand(0, { type: 'attack', units: [u.id], target: e.id });
  const ev = runCollect(w, 1);
  assert.equal(eventsOf(ev, 'cast').length, 1);
  assert.equal(u.order.type, 'attack');
});

test('every effect type is exercised', () => {
  for (const t of EFFECT_TYPES) assert.ok(covered.has(t), `effect ${t} not covered`);
});
