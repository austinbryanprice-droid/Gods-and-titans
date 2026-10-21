// Soldier ranks (DESIGN 5.9): who earns experience, what it comes from, the rank
// thresholds and stat bonuses, and what the snapshot, the delta codec and the
// events carry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MORTALS, UNITS, BUILDINGS, PANTHEON_LIST, godsFor, xpValue } from '../../src/data/index.js';
import { canRank, rankForXp, rankBonus, killXp, nextRankXp, RANK_NAMES, RANK_MAX } from '../../src/data/ranks.js';
import { RANK_XP, RANK_HP, RANK_DAMAGE, RANK_ARMOR, HEAL_XP, BUILDING_XP_HP } from '../../src/config.js';
import { UPGRADES } from '../../src/data/upgrades.js';
import { encode, apply, EVENT_SHAPES } from '../../src/net/delta.js';
import { liveCombat } from '../../src/ai/unit-info.js';
import { makeWorld, run, runUntil, place, spawn, clearUnits, eventsOf, PLAIN_PANTHEONS } from './helpers.js';

const json = (v) => JSON.parse(JSON.stringify(v));

function arena() {
  const w = makeWorld({ pantheons: PLAIN_PANTHEONS });
  clearUnits(w, 0);
  clearUnits(w, 1);
  w.events.length = 0;
  return w;
}

/** Kill n fresh enemy warriors, one after the other, with `killer`. */
function slay(w, killer, n, type = 'warrior') {
  for (let i = 0; i < n; i++) w.killEntity(spawn(w, 1, type, 30 + i * 0.01, 30), killer);
}

const viewOf = (w, u) => w.getSnapshot().entities.find((e) => e.id === u.id);

test('the Barracks soldiers rank; workers, gods, titans, creatures and minions do not', () => {
  for (const id of ['warrior', 'archer', 'priest', 'battering_ram']) assert.ok(canRank(MORTALS[id]), id);
  assert.ok(!canRank(MORTALS.worshipper));
  assert.ok(!canRank(null));
  for (const p of PANTHEON_LIST) {
    for (const u of [...p.gods, p.titan, ...p.creatures, ...p.minions]) assert.ok(!canRank(u), u.id);
  }
});

test('rank thresholds and bonuses come from the config table', () => {
  assert.equal(RANK_XP[0], 0);
  assert.equal(RANK_MAX, RANK_XP.length - 1);
  assert.equal(RANK_NAMES.length, RANK_XP.length);
  RANK_XP.forEach((xp, r) => {
    assert.equal(rankForXp(xp), r, `exactly ${xp} xp is rank ${r}`);
    if (xp > 0) assert.equal(rankForXp(xp - 0.01), r - 1);
    assert.equal(nextRankXp(r), r < RANK_MAX ? RANK_XP[r + 1] : null);
  });
  assert.equal(rankForXp(1e9), RANK_MAX);
  assert.deepEqual({ ...rankBonus(0) }, { hp: 0, damage: 0, armor: 0 });
  assert.ok(Math.abs(rankBonus(2).hp - 2 * RANK_HP) < 1e-12);
  assert.ok(Math.abs(rankBonus(2).damage - 2 * RANK_DAMAGE) < 1e-12);
  assert.ok(Math.abs(rankBonus(2).armor - 2 * RANK_ARMOR) < 1e-12);
  assert.equal(rankBonus(99), rankBonus(RANK_MAX), 'clamped');
  assert.equal(rankBonus(undefined), rankBonus(0));
});

test('a kill is worth what gods earn for it; a Warrior is about thirty and the first rank needs a couple', () => {
  const w = arena();
  const victim = spawn(w, 1, 'warrior', 30, 30);
  assert.equal(killXp(victim), xpValue(MORTALS.warrior));
  assert.equal(killXp(victim), 31);
  assert.ok(RANK_XP[1] > killXp(victim) && RANK_XP[1] <= 3 * killXp(victim), 'Veteran takes two or three kills');
  const god = spawn(w, 1, godsFor(w.players[1].pantheon)[0].id, 31, 30);
  assert.equal(killXp(god), 100);
  assert.equal(killXp(place(w, 1, 'house', 10, 10)), 500 / BUILDING_XP_HP);
  assert.equal(killXp(place(w, 1, 'house', 14, 10, false)), 0, 'a foundation is worth nothing');
});

test('the killing blow earns experience; ranks come at the thresholds with a rankUp event', () => {
  const w = arena();
  const a = spawn(w, 0, 'warrior', 20, 20);
  assert.equal(a.rank, 0);
  slay(w, a, 1);
  assert.equal(a.xp, 31);
  assert.equal(a.rank, 0);
  assert.deepEqual(eventsOf(w.events, 'rankUp'), []);
  slay(w, a, 1);
  assert.equal(a.xp, 62);
  assert.equal(a.rank, 1);
  assert.deepEqual(eventsOf(w.events, 'rankUp'), [{ type: 'rankUp', id: a.id, rank: 1 }]);
  w.events.length = 0;
  slay(w, a, 3);
  assert.equal(a.rank, 2, '155 xp');
  assert.deepEqual(eventsOf(w.events, 'rankUp').map((e) => e.rank), [2]);
  slay(w, a, 5);
  assert.equal(a.rank, 3, '310 xp');
  w.events.length = 0;
  slay(w, a, 4);
  assert.equal(a.rank, 3, 'the top rank stays');
  assert.deepEqual(eventsOf(w.events, 'rankUp'), []);
});

test('a big kill can skip a rank: one event with the rank reached', () => {
  const w = arena();
  const a = spawn(w, 0, 'archer', 20, 20);
  const god = spawn(w, 1, godsFor(w.players[1].pantheon)[0].id, 25, 20, { level: 3 });
  w.killEntity(god, a);
  assert.equal(a.xp, 300);
  assert.equal(a.rank, 3);
  assert.deepEqual(eventsOf(w.events, 'rankUp').map((e) => e.rank), [3]);
});

test('each rank adds hp, damage and armor, and raises current hp by the same amount', () => {
  const w = arena();
  const a = spawn(w, 0, 'warrior', 20, 20);
  a.hp = 100;
  slay(w, a, 2); // Veteran
  const def = MORTALS.warrior;
  assert.equal(a.maxHp, Math.round(def.hp * (1 + RANK_HP)));
  assert.equal(a.hp, 100 + (a.maxHp - def.hp), 'the new max hp is added to the current hp');
  assert.ok(Math.abs(a.baseDamage - def.attack.damage * (1 + RANK_DAMAGE)) < 1e-9);
  assert.equal(a.baseArmor, def.armor + RANK_ARMOR);
  w.tick();
  assert.equal(a.armorNow, def.armor + RANK_ARMOR, 'derived stats follow on the next tick');
  slay(w, a, 8); // 310 xp, Champion
  assert.equal(a.rank, 3);
  assert.equal(a.maxHp, Math.round(def.hp * (1 + 3 * RANK_HP)));
  assert.ok(Math.abs(a.baseDamage - def.attack.damage * (1 + 3 * RANK_DAMAGE)) < 1e-9);
  assert.equal(a.baseArmor, def.armor + 3 * RANK_ARMOR);
  // The swing really hurts more: a Champion hits a training dummy harder than a Recruit.
  const dummy = spawn(w, 1, 'warrior', 20.75, 20);
  const fresh = spawn(w, 0, 'warrior', 19.2, 20);
  w.setOrder(dummy, { type: 'hold', target: 0 });
  w.issueCommand(0, { type: 'attack', units: [a.id], target: dummy.id });
  w.tick();
  const champion = dummy.maxHp - dummy.hp;
  dummy.hp = dummy.maxHp;
  w.issueCommand(0, { type: 'attack', units: [fresh.id], target: dummy.id });
  runUntil(w, () => dummy.hp < dummy.maxHp, 3);
  assert.ok(champion > dummy.maxHp - dummy.hp, `${champion} vs ${dummy.maxHp - dummy.hp}`);
});

test('rank bonuses stack with building upgrades', () => {
  const w = arena();
  w.completeResearch(0, 'barracks_bronze_weapons');
  w.completeResearch(0, 'barracks_hoplite_shields');
  const up = UPGRADES.barracks_bronze_weapons.effects[0].amount;
  const armorUp = UPGRADES.barracks_hoplite_shields.effects[0].amount;
  const a = spawn(w, 0, 'warrior', 20, 20);
  slay(w, a, 2);
  assert.ok(Math.abs(a.baseDamage - MORTALS.warrior.attack.damage * (1 + up) * (1 + RANK_DAMAGE)) < 1e-9);
  assert.equal(a.baseArmor, MORTALS.warrior.armor + armorUp + RANK_ARMOR);
  // a later upgrade keeps the rank
  w.completeResearch(0, 'house_stone_walls');
  assert.equal(a.rank, 1);
  assert.ok(Math.abs(a.baseDamage - MORTALS.warrior.attack.damage * (1 + up) * (1 + RANK_DAMAGE)) < 1e-9);
});

test('the AI\'s force estimate counts a soldier\'s rank damage', () => {
  const w = arena();
  const a = spawn(w, 0, 'warrior', 20, 20);
  const fresh = liveCombat(a, {});
  slay(w, a, 10); // 310 xp, Champion
  assert.equal(a.rank, 3);
  w.tick();
  const champion = liveCombat(a, {});
  assert.ok(Math.abs(champion.dpsG / fresh.dpsG - (1 + 3 * RANK_DAMAGE)) < 1e-9, `${champion.dpsG} vs ${fresh.dpsG}`);
  assert.ok(champion.hp > fresh.hp, 'health and armor were already counted');
});

test('only soldiers that kill an enemy earn: workers, gods, allies and the dead earn nothing', () => {
  const w = arena();
  const worker = spawn(w, 0, 'worshipper', 20, 20);
  slay(w, worker, 3, 'worshipper');
  assert.equal(worker.xp, 0);
  assert.equal(worker.rank, 0);
  const god = spawn(w, 0, godsFor(w.players[0].pantheon)[0].id, 22, 20);
  const godXp = god.xp;
  w.killEntity(spawn(w, 1, 'warrior', 22.5, 20), god);
  assert.equal(god.rank, 0, 'gods keep levels, not ranks');
  assert.ok(god.xp > godXp, 'and still earn their own xp');
  // killing a teammate's (or your own) unit is no victory
  const a = spawn(w, 0, 'warrior', 24, 20);
  w.killEntity(spawn(w, 0, 'warrior', 24.5, 20), a);
  assert.equal(a.xp, 0);
  // a killer who is already dead gets nothing and nothing throws
  const b = spawn(w, 0, 'warrior', 26, 20);
  b.dead = true;
  w.killEntity(spawn(w, 1, 'warrior', 26.5, 20), b);
  assert.equal(b.xp, 0);
  // no killer (expired summon, defeat) and kills by buildings: no one earns
  const c = spawn(w, 0, 'warrior', 28, 20);
  w.killEntity(spawn(w, 1, 'warrior', 28.5, 20), null);
  w.killEntity(spawn(w, 1, 'warrior', 28.6, 20), place(w, 0, 'tower', 40, 40));
  assert.equal(c.xp, 0);
});

test('kills of enemies earn on any team, kills of teammates never', () => {
  const w = makeWorld({ players: 3, teams: [1, 1, 2] });
  for (const p of [0, 1, 2]) clearUnits(w, p);
  const mate = spawn(w, 1, 'warrior', 20, 20);
  w.killEntity(spawn(w, 2, 'warrior', 21, 20), mate);
  assert.equal(mate.xp, 31);
  w.killEntity(spawn(w, 0, 'warrior', 22, 20), mate); // player 0 is on mate's team
  assert.equal(mate.xp, 31);
  const foe = spawn(w, 2, 'archer', 23, 20);
  w.killEntity(spawn(w, 0, 'archer', 24, 20), foe);
  assert.equal(foe.xp, xpValue(MORTALS.archer));
});

test('neutral creeps are worth experience too', () => {
  const w = makeWorld({ map: { camps: [{ x: 24, y: 24, level: 1 }] } });
  clearUnits(w, 0);
  clearUnits(w, 1);
  const creep = w.unitsOf(-1)[0];
  const a = spawn(w, 0, 'warrior', 20, 20);
  const value = xpValue(creep.def);
  w.killEntity(creep, a);
  assert.equal(a.xp, value);
});

test('an archer\'s arrow earns the kill when it lands', () => {
  const w = arena();
  const a = spawn(w, 0, 'archer', 20, 20);
  const victim = spawn(w, 1, 'worshipper', 24, 20);
  victim.hp = 3;
  w.setOrder(victim, { type: 'hold', target: 0 });
  w.issueCommand(0, { type: 'attack', units: [a.id], target: victim.id });
  assert.ok(runUntil(w, () => victim.dead, 4) > 0);
  assert.equal(a.xp, xpValue(MORTALS.worshipper));
});

test('destroying a completed building earns its share; a Battering Ram ranks by razing', () => {
  const w = arena();
  const ram = spawn(w, 0, 'battering_ram', 13, 13);
  const halls = [place(w, 1, 'barracks', 14, 10), place(w, 1, 'barracks', 18, 10), place(w, 1, 'barracks', 22, 10)];
  for (const b of halls) b.hp = 1;
  const each = Math.round(BUILDINGS.barracks.hp / BUILDING_XP_HP);
  w.issueCommand(0, { type: 'attack', units: [ram.id], target: halls[0].id });
  assert.ok(runUntil(w, () => halls[0].dead, 20) > 0);
  assert.equal(ram.xp, each);
  assert.equal(ram.rank, 0);
  w.setOrder(ram, { type: 'attackMove', x: 25, y: 12 });
  assert.ok(runUntil(w, () => halls[1].dead && halls[2].dead, 40) > 0);
  assert.equal(ram.xp, 3 * each);
  assert.equal(ram.rank, 1, `${3 * each} xp is Veteran`);
});

test('an unfinished building and a cancelled one earn nothing', () => {
  const w = arena();
  const a = spawn(w, 0, 'warrior', 20, 20);
  const site = place(w, 1, 'barracks', 10, 10, false);
  w.killEntity(site, a);
  assert.equal(a.xp, 0);
  const own = place(w, 0, 'house', 30, 30);
  w.killEntity(own, a);
  assert.equal(a.xp, 0, 'nor does razing your own');
});

test('a Priest earns experience for the health it really restores', () => {
  const w = arena();
  const priest = spawn(w, 0, 'priest', 20, 20);
  const ally = spawn(w, 0, 'warrior', 21.5, 20);
  const full = spawn(w, 0, 'warrior', 18.5, 20);
  ally.hp = ally.maxHp - 60;
  const hp0 = ally.hp;
  run(w, 0.4);
  assert.ok(ally.hp > hp0, 'autocast heal');
  const healed = ally.hp - hp0;
  assert.ok(healed > 0 && Math.abs(priest.xp - healed * HEAL_XP) < 1e-6, `${priest.xp} xp for ${healed} hp`);
  run(w, 10);
  const restored = ally.hp - hp0;
  assert.ok(restored >= 50, `most of the 60 missing hp came back (${restored})`);
  assert.ok(Math.abs(priest.xp - restored * HEAL_XP) < 1e-6, 'exactly the hp restored, no more');
  run(w, 5);
  assert.ok(Math.abs(priest.xp - (ally.hp - hp0) * HEAL_XP) < 1e-6, 'still exactly what it restored');
  assert.equal(full.hp, full.maxHp);
  // a Priest who cannot heal anyone (everyone is whole) earns nothing
  const w2 = arena();
  const idle = spawn(w2, 0, 'priest', 20, 20);
  spawn(w2, 0, 'warrior', 21, 20);
  run(w2, 5);
  assert.equal(idle.xp, 0);
});

test('fighting for real: a Warrior that wins a fight earns the kills it landed', () => {
  const w = arena();
  const a = spawn(w, 0, 'warrior', 20, 20);
  const foes = [spawn(w, 1, 'worshipper', 22, 20), spawn(w, 1, 'worshipper', 22, 21)];
  for (const f of foes) w.setOrder(f, { type: 'hold', target: 0 });
  w.setOrder(a, { type: 'attackMove', x: 24, y: 20 });
  assert.ok(runUntil(w, () => foes.every((f) => f.dead), 120) > 0, 'both workers fell');
  assert.ok(!a.dead);
  assert.equal(a.xp, 2 * xpValue(MORTALS.worshipper));
  assert.equal(a.rank, 0, '32 xp is still a Recruit');
});

test('the snapshot carries rk and xp only once earned, and gods keep lv and xp', () => {
  const w = arena();
  const a = spawn(w, 0, 'warrior', 20, 20);
  const worker = spawn(w, 0, 'worshipper', 21, 20);
  const god = spawn(w, 0, godsFor(w.players[0].pantheon)[0].id, 22, 20);
  let v = viewOf(w, a);
  assert.ok(!('rk' in v) && !('xp' in v), 'a fresh soldier sends nothing extra');
  slay(w, a, 1);
  v = viewOf(w, a);
  assert.equal(v.xp, 31);
  assert.ok(!('rk' in v), 'still a Recruit');
  slay(w, a, 1);
  v = viewOf(w, a);
  assert.deepEqual([v.rk, v.xp], [1, 62]);
  assert.ok(!('rk' in viewOf(w, worker)) && !('xp' in viewOf(w, worker)));
  const gv = viewOf(w, god);
  assert.deepEqual([gv.lv, gv.xp], [1, 0]);
  assert.ok(!('rk' in gv));
  a.xp = 62.9;
  assert.equal(viewOf(w, a).xp, 62, 'whole xp');
});

test('rank and xp survive the delta codec, and rankUp is a packed event', () => {
  const w = arena();
  const a = spawn(w, 0, 'warrior', 20, 20);
  const code = EVENT_SHAPES.findIndex((s) => s.type === 'rankUp');
  assert.ok(code >= 0 && JSON.stringify(EVENT_SHAPES[code].keys) === '["id","rank"]');
  let prev = w.getSnapshot();
  let client = json(prev);
  for (let i = 0; i < 12; i++) {
    slay(w, a, 1);
    w.tick();
    const next = w.getSnapshot();
    const d = encode(prev, next);
    const wire = JSON.parse(JSON.stringify(d));
    client = apply(client, wire);
    assert.deepStrictEqual(client, json(next), `kill ${i + 1}`);
    const promoted = eventsOf(next.events, 'rankUp');
    if (promoted.length) assert.ok(wire.e.some((ev) => Array.isArray(ev) && ev[0] === code), 'packed, not sent as an object');
    prev = next;
  }
  const mine = client.entities.find((e) => e.id === a.id);
  assert.equal(mine.rk, a.rank);
  assert.equal(mine.xp, Math.floor(a.xp));
});

test('a Recruit starts every match with no experience and the unit type\'s own stats', () => {
  const w = makeWorld({ pantheons: PLAIN_PANTHEONS });
  for (const u of w.unitList) {
    assert.equal(u.rank, 0);
    assert.equal(u.xp, 0);
  }
  for (const id of ['warrior', 'archer', 'priest', 'battering_ram']) {
    const owner = 0;
    const u = spawn(w, owner, id, 30, 30);
    assert.equal(u.maxHp, UNITS[id].hp);
    assert.equal(u.baseArmor, UNITS[id].armor);
  }
});
