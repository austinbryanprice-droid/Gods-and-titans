// Pantheon identity in the simulation (DESIGN 4.10): each pantheon's blessings are folded into the
// player's mods from the first tick, and every perk they raise has one rule: plunder and sacrifice on
// a kill, karma and shrine faith each second, faster building and research, shorter god cooldowns,
// cheaper revivals. The elite soldier is trained at the Barracks of its own pantheon only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { UNITS, MORTALS, BUILDINGS, PANTHEON_LIST, godsFor, producibleAt } from '../../src/data/index.js';
import { computeMods, buildingMods, unitMods, reviveMult } from '../../src/data/upgrades.js';
import { REVIVE_COST_MULT, NEUTRAL, CARRY_AMOUNT } from '../../src/config.js';
import { SHRINE_FAITH_BUILDINGS } from '../../src/sim/spoils.js';
import { makeWorld, run, runUntil, runCollect, spawn, place, clearUnits, defineUnit, ability, eventsOf, errorsOf } from './helpers.js';

const rich = (w, p = 0) => Object.assign(w.players[p], { gold: 5000, wood: 5000, faith: 5000 });
const workers = (w, p = 0) => w.unitsOf(p).filter((u) => u.type === 'worshipper');
const duel = (pantheon, other = 'greek', opts = {}) => makeWorld({ pantheons: [pantheon, other], ...opts });

/** Queue a research and tick until it is done; returns the seconds it took. */
function research(w, b, upId) {
  w.issueCommand(b.owner, { type: 'research', building: b.id, upgrade: upId });
  w.tick();
  const item = b.queue.find((q) => q.u === upId);
  assert.ok(item, `${upId} queued`);
  return runUntil(w, () => w.players[b.owner].upgrades[upId], item.time + 2);
}

function cmd(w, c, p = 0) {
  w.events.length = 0;
  w.issueCommand(p, c);
  w.tick();
  return errorsOf(w.events, p);
}

test('every player starts with their pantheon blessings in p.mods, and researching keeps them', () => {
  for (const p of PANTHEON_LIST) {
    const w = duel(p.id);
    assert.deepEqual(w.players[0].mods, computeMods([], p.id), p.id);
  }
  const w = duel('norse');
  rich(w);
  w.players[0].tier = 2;
  const barracks = place(w, 0, 'barracks', 20, 14);
  assert.equal(buildingMods(w.players[0].mods, 'barracks').train, 0.2, 'Mead Hall');
  research(w, barracks, 'barracks_drill_yard');
  assert.equal(buildingMods(w.players[0].mods, 'barracks').train, 0.2 + 0.25, 'stacks with Drill Yard');
  assert.deepEqual(w.players[0].mods, computeMods(['barracks_drill_yard'], 'norse'));
  assert.deepEqual(w.players[1].mods, computeMods([], 'greek'), 'the opponent keeps their own');
});

test('blessing effects: building damage, kin soldiers share their mortal\'s upgrades, speed and revive', () => {
  const egypt = computeMods([], 'egyptian');
  assert.equal(buildingMods(egypt, 'tower').damage, 0.25);
  assert.equal(buildingMods(egypt, 'town_center').damage, 0.25);
  for (const id of Object.keys(BUILDINGS)) assert.equal(buildingMods(egypt, id).armor, 0, `${id}: no armor, so the Eye of Horus does not stack`);
  assert.equal(egypt.perks.buildSpeed, 0.35);

  const greek = computeMods(['barracks_bronze_weapons', 'barracks_hoplite_shields'], 'greek');
  const hoplite = unitMods(greek, UNITS.greek_hoplite);
  assert.ok(Math.abs(hoplite.damage - 0.15) < 1e-9, 'Bronze Weapons name the Warrior; the Hoplite is its kin');
  assert.equal(hoplite.armor, 1 + 2, 'Hoplite Drill (infantry) and Hoplite Shields (kin)');
  assert.equal(hoplite.hp, 0.08);
  assert.equal(unitMods(greek, MORTALS.warrior).armor, 1 + 2);
  assert.equal(unitMods(greek, MORTALS.archer).armor, 2, 'archers are not infantry');

  // an effect that names only the Archer reaches the archer-kin elites and not the warrior-kin ones
  const archersOnly = { units: [{ type: 'unit', units: ['archer'], stat: 'damage', amount: 0.1 }] };
  for (const p of PANTHEON_LIST) assert.equal(unitMods(archersOnly, p.elite).damage, p.elite.kin === 'archer' ? 0.1 : 0, p.elite.id);

  const celtic = computeMods([], 'celtic');
  assert.equal(unitMods(celtic, MORTALS.warrior).speed, 0.08);
  assert.equal(unitMods(celtic, UNITS.celtic_woad_raider).speed, 0.08);
  assert.equal(unitMods(celtic, godsFor('celtic')[0]).speed, 0.08);
  assert.equal(unitMods(celtic, MORTALS.worshipper).speed, 0, 'workers keep their pace');
  assert.equal(celtic.chop, 0.3);

  assert.equal(reviveMult(computeMods([], 'greek')), REVIVE_COST_MULT);
  assert.ok(Math.abs(reviveMult(computeMods([], 'hindu')) - REVIVE_COST_MULT * 0.6) < 1e-9);
  assert.equal(computeMods([], 'west_african').carry.g, 1);
  assert.equal(computeMods([], 'greek').godLevel, 1);
});

test('blessings change the stats of new units and buildings: Greek infantry, Celtic speed, Egyptian walls, Chinese towers, Mesopotamian houses', () => {
  const g = duel('greek', 'norse');
  const warrior = spawn(g, 0, 'warrior', 16, 20);
  assert.equal(warrior.baseArmor, MORTALS.warrior.armor + 1);
  assert.equal(warrior.maxHp, Math.round(MORTALS.warrior.hp * 1.08));
  assert.equal(spawn(g, 0, 'archer', 17, 20).baseArmor, MORTALS.archer.armor, 'only infantry drill');
  assert.equal(spawn(g, 1, 'warrior', 30, 30).baseArmor, MORTALS.warrior.armor, 'other pantheons are not affected');
  assert.equal(spawn(g, 0, 'greek_hoplite', 18, 20).baseArmor, UNITS.greek_hoplite.armor + 1);

  const c = duel('celtic');
  assert.ok(Math.abs(spawn(c, 0, 'warrior', 16, 20).baseSpeed - MORTALS.warrior.speed * 1.08) < 1e-9);
  assert.equal(spawn(c, 0, 'worshipper', 17, 20).baseSpeed, MORTALS.worshipper.speed);

  const e = duel('egyptian');
  assert.equal(place(e, 0, 'tower', 14, 14).dmgMult, 1.25);
  assert.equal(place(e, 0, 'barracks', 20, 14).dmgMult, 1);

  const ch = duel('chinese');
  const tower = place(ch, 0, 'tower', 18, 10);
  assert.equal(tower.maxHp, BUILDINGS.tower.hp + 300);
  assert.equal(tower.armor, BUILDINGS.tower.armor + 3);
  assert.equal(tower.rangeBonus, 1);
  assert.equal(place(ch, 0, 'house', 14, 14).armor, BUILDINGS.house.armor, 'only towers');

  const cap = (pantheon) => {
    const w = duel(pantheon);
    place(w, 0, 'house', 14, 14);
    w.recomputePopCap(0);
    return w.players[0].popCap;
  };
  assert.equal(cap('mesopotamian'), cap('greek') + 2, 'Crowded Cities');
});

test('Norse plunder: a kill pays 12% of the victim\'s gold and wood cost, for units and finished buildings only', () => {
  const w = duel('norse');
  clearUnits(w, 0);
  clearUnits(w, 1);
  const p = w.players[0];
  const killer = spawn(w, 0, 'warrior', 20, 20);
  const archer = spawn(w, 1, 'archer', 22, 20);
  w.events.length = 0;
  const gold0 = p.gold;
  w.killEntity(archer, killer);
  const cost = MORTALS.archer.cost;
  const loot = Math.round(0.12 * (cost.gold + cost.wood));
  assert.ok(loot > 0);
  assert.equal(p.gold - gold0, loot);
  assert.deepEqual(eventsOf(w.events, 'bounty').map((e) => [e.player, e.amount, e.res]), [[0, loot, 'g']]);

  const barracks = place(w, 1, 'barracks', 30, 30);
  const razed0 = p.gold;
  w.killEntity(barracks, killer);
  assert.equal(p.gold - razed0, Math.round(0.12 * (BUILDINGS.barracks.cost.gold + BUILDINGS.barracks.cost.wood)));

  const site = place(w, 1, 'house', 30, 36, false);
  const site0 = p.gold;
  w.killEntity(site, killer);
  assert.equal(p.gold, site0, 'an unfinished site is worth nothing');

  const summoned = spawn(w, 1, 'warrior', 24, 20, { summoned: true });
  const sum0 = p.gold;
  w.killEntity(summoned, killer);
  assert.equal(p.gold, sum0, 'summoned units are worth nothing');

  const own = spawn(w, 0, 'warrior', 26, 20);
  const own0 = p.gold;
  w.killEntity(own, killer);
  assert.equal(p.gold, own0, 'no plunder from a friend');

  const creep = spawn(w, NEUTRAL, 'warrior', 28, 20);
  const creep0 = p.gold;
  w.killEntity(creep, killer);
  assert.equal(p.gold - creep0, 10 + 10 * (creep.def.tier || 1), 'creeps keep their own bounty and are not plundered on top');

  // other pantheons loot nothing
  const g = duel('greek', 'norse');
  clearUnits(g, 0);
  clearUnits(g, 1);
  const gk = spawn(g, 0, 'warrior', 20, 20);
  const gv = spawn(g, 1, 'archer', 22, 20);
  const gg0 = g.players[0].gold;
  g.killEntity(gv, gk);
  assert.equal(g.players[0].gold, gg0);
});

test('Aztec Flower War: every enemy unit slain pays 3 faith per population point, creeps included', () => {
  const w = duel('aztec');
  clearUnits(w, 0);
  clearUnits(w, 1);
  const p = w.players[0];
  const killer = spawn(w, 0, 'warrior', 20, 20);
  const victim = spawn(w, 1, 'warrior', 22, 20);
  w.events.length = 0;
  const faith0 = p.faith;
  const gold0 = p.gold;
  w.killEntity(victim, killer);
  assert.equal(p.faith - faith0, 3 * MORTALS.warrior.pop);
  assert.equal(p.gold, gold0, 'faith only');
  assert.deepEqual(eventsOf(w.events, 'bounty').map((e) => [e.amount, e.res]), [[3 * MORTALS.warrior.pop, 'f']]);

  const creep = spawn(w, NEUTRAL, 'warrior', 26, 20);
  const f1 = p.faith;
  w.events.length = 0;
  w.killEntity(creep, killer);
  assert.equal(p.faith - f1, 3 * creep.def.pop);
  assert.deepEqual(eventsOf(w.events, 'bounty').map((e) => e.res || 'g').sort(), ['f', 'g'], 'the creep bounty stays gold');

  const b = place(w, 1, 'house', 30, 30);
  const f2 = p.faith;
  w.killEntity(b, killer);
  assert.equal(p.faith, f2, 'buildings are not sacrificed');
});

test('Hindu Karma: every worshipper at work earns faith; idle ones do not', () => {
  const w = duel('hindu');
  const g = duel('greek', 'hindu');
  for (const world of [w, g]) {
    world.players[0].faith = 0;
    const ws = workers(world);
    world.issueCommand(0, { type: 'gather', units: ws.map((u) => u.id), target: world.mineList[0].id });
  }
  run(w, 12);
  run(g, 12);
  const working = workers(w).filter((u) => ['gather', 'return', 'build'].includes(u.state)).length;
  assert.ok(working >= 2);
  assert.ok(Math.abs(w.players[0].faithRate - 0.06 * working) < 1e-9, `${w.players[0].faithRate} vs ${working} workers`);
  assert.ok(w.players[0].faith > 3, 'faith accumulates while they work');
  assert.equal(g.players[0].faithRate, 0);
  assert.equal(g.players[0].faith, 0, 'nothing for another pantheon');

  const idle = duel('hindu');
  idle.players[0].faith = 0;
  run(idle, 5);
  assert.equal(idle.players[0].faith, 0);
});

test('Japanese Kami of the Shrine: each finished Shrine or Temple trickles faith, up to four, with nobody praying', () => {
  const w = duel('japanese');
  const p = w.players[0];
  p.faith = 0;
  run(w, 1);
  assert.equal(p.faithRate, 0);
  place(w, 0, 'shrine', 18, 10);
  place(w, 0, 'temple', 24, 10);
  run(w, 1);
  assert.ok(Math.abs(p.faithRate - 2 * 0.35) < 1e-9);
  const f0 = p.faith;
  run(w, 10);
  assert.ok(Math.abs(p.faith - f0 - 10 * 2 * 0.35) < 0.2);
  place(w, 0, 'shrine', 30, 10, false); // a site pays nothing
  for (let i = 0; i < 4; i++) place(w, 0, 'shrine', 18 + i * 5, 24);
  run(w, 1);
  assert.ok(Math.abs(p.faithRate - SHRINE_FAITH_BUILDINGS * 0.35) < 1e-9, 'capped');
  const g = duel('greek');
  place(g, 0, 'shrine', 18, 10);
  run(g, 2);
  assert.equal(g.players[0].faithRate, 0);
});

test('Egyptian Pyramid Builders raise buildings faster; Chinese Bureaucracy speeds research and growth; Norse Mead Hall trains faster', () => {
  const buildTime = (pantheon) => {
    const w = duel(pantheon);
    rich(w);
    const [u] = workers(w);
    w.issueCommand(0, { type: 'build', units: [u.id], building: 'house', tx: 14, ty: 14 });
    return runUntil(w, () => w.buildingsOf(0).some((b) => b.type === 'house' && b.constructed), 120);
  };
  const greekBuild = buildTime('greek');
  const egyptBuild = buildTime('egyptian');
  assert.ok(greekBuild > 0 && egyptBuild > 0);
  assert.ok(egyptBuild < greekBuild * 0.9 && egyptBuild > greekBuild * 0.6, `${egyptBuild} vs ${greekBuild}`);

  const researchTime = (pantheon) => {
    const w = duel(pantheon);
    rich(w);
    return research(w, place(w, 0, 'barracks', 20, 14), 'barracks_bronze_weapons');
  };
  const slow = researchTime('greek');
  const fast = researchTime('chinese');
  assert.ok(Math.abs(fast - slow / 1.3) < 0.5, `${fast} vs ${slow}`);

  const growTime = (pantheon) => {
    const w = duel(pantheon);
    rich(w);
    place(w, 0, 'shrine', 20, 20);
    const tc = w.buildingsOf(0).find((b) => b.type === 'town_center');
    assert.deepEqual(cmd(w, { type: 'upgradeTier', building: tc.id }), []);
    return runUntil(w, () => w.players[0].tier === 2, 90);
  };
  const growSlow = growTime('greek');
  const growFast = growTime('chinese');
  assert.ok(Math.abs(growFast - growSlow / 1.3) < 0.5, `${growFast} vs ${growSlow}`);

  const trainTime = (pantheon) => {
    const w = duel(pantheon);
    rich(w);
    const b = place(w, 0, 'barracks', 20, 14);
    w.issueCommand(0, { type: 'train', building: b.id, unit: 'warrior' });
    return runUntil(w, () => w.unitsOf(0).some((u) => u.type === 'warrior'), 60);
  };
  assert.ok(Math.abs(trainTime('norse') - trainTime('greek') / 1.2) < 0.5);
});

test('Egyptian Pyramid Builders also mend buildings faster', () => {
  const repaired = (pantheon) => {
    const w = duel(pantheon);
    rich(w);
    const b = place(w, 0, 'house', 14, 14);
    b.hp = 100;
    const [u] = workers(w);
    w.issueCommand(0, { type: 'repair', units: [u.id], target: b.id });
    runUntil(w, () => u.state === 'build', 10);
    run(w, 3);
    const start = b.hp;
    run(w, 4);
    return b.hp - start;
  };
  const ratio = repaired('egyptian') / repaired('greek');
  assert.ok(ratio > 1.2 && ratio < 1.5, `ratio ${ratio}`);
});

test('West African Àṣẹ: god and titan abilities recharge 15% faster; creatures and soldiers do not', () => {
  const cooldownAfterCast = (pantheon, cls) => {
    const w = duel(pantheon);
    clearUnits(w, 0);
    clearUnits(w, 1);
    const id = defineUnit({ class: cls, abilities: [ability('t_ase', [{ type: 'damage', amount: 10, radius: 2, at: 'target' }])], attack: null });
    const u = spawn(w, 0, id, 20, 20);
    w.issueCommand(0, { type: 'cast', unit: u.id, ability: 't_ase', x: 22, y: 20 });
    w.tick();
    return u.cooldowns.t_ase;
  };
  assert.ok(Math.abs(cooldownAfterCast('west_african', 'god') - 10 * 0.85) < 1e-9);
  assert.ok(Math.abs(cooldownAfterCast('west_african', 'titan') - 10 * 0.85) < 1e-9);
  assert.equal(cooldownAfterCast('west_african', 'creature'), 10);
  assert.equal(cooldownAfterCast('greek', 'god'), 10);
});

test('West African Gold Road adds a gold to every trip; Celtic Woodcraft chops faster', () => {
  const w = duel('west_african', 'greek', { map: { forest: [{ x: 4, y: 16, w: 6, h: 3 }] } });
  const [a] = workers(w);
  w.issueCommand(0, { type: 'gather', units: [a.id], target: w.mineList[0].id });
  runUntil(w, () => a.carry === 'g' && a.carryAmount > 0, 30);
  assert.equal(a.carryAmount, CARRY_AMOUNT + 1);

  const chopTime = (pantheon) => {
    const world = duel(pantheon, 'greek', { map: { forest: [{ x: 4, y: 16, w: 6, h: 3 }] } });
    const [u] = workers(world);
    world.issueCommand(0, { type: 'gather', units: [u.id], tx: 6, ty: 18 });
    runUntil(world, () => u.order && u.order.phase === 'work', 30);
    return runUntil(world, () => u.carryAmount >= CARRY_AMOUNT, 30);
  };
  const slow = chopTime('greek');
  const fast = chopTime('celtic');
  assert.ok(fast < slow * 0.85, `${fast} vs ${slow}`);
});

test('Greek Heroic Birth: gods arrive at level 2; Hindu Samsara revives fallen gods for 40% less', () => {
  const summon = (pantheon) => {
    const w = duel(pantheon);
    rich(w);
    w.players[0].tier = 3;
    place(w, 0, 'shrine', 20, 20);
    const temple = place(w, 0, 'temple', 26, 20);
    const [g] = godsFor(pantheon);
    w.issueCommand(0, { type: 'train', building: temple.id, unit: g.id });
    assert.ok(runUntil(w, () => w.unitsOf(0).some((u) => u.type === g.id), 200) > 0);
    return w.unitsOf(0).find((u) => u.type === g.id);
  };
  assert.equal(summon('greek').level, 2);
  assert.equal(summon('norse').level, 1);

  const revive = (pantheon) => {
    const w = duel(pantheon);
    const p = w.players[0];
    rich(w);
    w.players[0].tier = 3;
    place(w, 0, 'shrine', 20, 20);
    const temple = place(w, 0, 'temple', 26, 20);
    const def = godsFor(pantheon)[0];
    p.fallen[def.id] = { level: 3, xp: 320 };
    const g0 = p.gold;
    const f0 = p.faith;
    assert.deepEqual(cmd(w, { type: 'train', building: temple.id, unit: def.id }), []);
    const item = temple.queue[0];
    return { gold: g0 - p.gold, faith: f0 - p.faith, time: item.time, def };
  };
  const hindu = revive('hindu');
  const usual = revive('greek');
  const share = REVIVE_COST_MULT * 0.6;
  assert.equal(hindu.gold, Math.round(hindu.def.cost.gold * share));
  assert.equal(hindu.faith, Math.round(hindu.def.cost.faith * share));
  assert.ok(Math.abs(hindu.time - hindu.def.buildTime * share) < 1e-9);
  assert.equal(usual.faith, Math.round(usual.def.cost.faith * REVIVE_COST_MULT));
});

test('every pantheon trains its own elite soldier at the Barracks from Town, and no other pantheon can', () => {
  for (const p of PANTHEON_LIST) {
    const elite = p.elite;
    assert.deepEqual(producibleAt('barracks', p.id).slice(-1), [elite.id], p.id);
    const w = duel(p.id, p.id === 'greek' ? 'norse' : 'greek');
    rich(w);
    const barracks = place(w, 0, 'barracks', 20, 14);
    assert.deepEqual(cmd(w, { type: 'train', building: barracks.id, unit: elite.id }), ['Requires Town.'], p.id);
    w.players[0].tier = 2;
    const gold0 = w.players[0].gold;
    const wood0 = w.players[0].wood;
    assert.deepEqual(cmd(w, { type: 'train', building: barracks.id, unit: elite.id }), [], p.id);
    assert.equal(gold0 - w.players[0].gold, elite.cost.gold);
    assert.equal(wood0 - w.players[0].wood, elite.cost.wood);
    assert.equal(w.players[0].popUsed, 5 + elite.pop, 'five workers and the soldier');
    // the pantheon's opponent cannot queue it
    const foe = w.players[1];
    Object.assign(foe, { gold: 5000, wood: 5000, tier: 2 });
    const theirs = place(w, 1, 'barracks', 30, 30);
    assert.deepEqual(cmd(w, { type: 'train', building: theirs.id, unit: elite.id }, 1), [], 'ignored, not an error');
    assert.equal(theirs.queue.length, 0, p.id);
  }
});

test('an elite soldier is trained like any other, feels its pantheon\'s blessings and the Barracks upgrades of its kin', () => {
  const w = duel('greek');
  rich(w);
  w.players[0].tier = 2;
  const barracks = place(w, 0, 'barracks', 20, 14);
  research(w, barracks, 'barracks_bronze_weapons');
  w.issueCommand(0, { type: 'train', building: barracks.id, unit: 'greek_hoplite' });
  assert.ok(runUntil(w, () => w.unitsOf(0).some((u) => u.type === 'greek_hoplite'), 80) > 0);
  const hoplite = w.unitsOf(0).find((u) => u.type === 'greek_hoplite');
  assert.ok(Math.abs(hoplite.baseDamage - UNITS.greek_hoplite.attack.damage * 1.15) < 1e-9, 'Bronze Weapons');
  assert.equal(hoplite.baseArmor, UNITS.greek_hoplite.armor + 1, 'Hoplite Drill');
  assert.equal(hoplite.maxHp, Math.round(UNITS.greek_hoplite.hp * 1.08));

  // the Phalanx aura gives nearby allies +1 armor
  const near = spawn(w, 0, 'archer', hoplite.x + 1, hoplite.y);
  run(w, 1);
  assert.equal(near.armorNow, MORTALS.archer.armor + 1);
  const far = spawn(w, 0, 'archer', hoplite.x + 12, hoplite.y);
  run(w, 1);
  assert.equal(far.armorNow, MORTALS.archer.armor);
});

test('elite passives work in a fight: Kshatriya cleaves, Dart Hunter poisons, Berserker heals from his blows, Eagle dodges', () => {
  const arena = (pantheon) => {
    const w = duel(pantheon);
    clearUnits(w, 0);
    clearUnits(w, 1);
    w.events.length = 0;
    return w;
  };
  const dummy = (w, x, y) => {
    const u = spawn(w, 1, 'warrior', x, y);
    w.setOrder(u, { type: 'hold', target: 0 });
    return u;
  };

  const cleave = arena('hindu');
  const k = spawn(cleave, 0, 'hindu_kshatriya', 20, 20);
  const target = dummy(cleave, 20.75, 20);
  const beside = dummy(cleave, 20.75, 21.2);
  cleave.issueCommand(0, { type: 'attack', units: [k.id], target: target.id });
  run(cleave, 0.2);
  assert.ok(target.hp < target.maxHp);
  assert.ok(beside.hp < beside.maxHp, 'Sweeping Mace also hurts the enemy beside the target');
  assert.ok(beside.maxHp - beside.hp < (target.maxHp - target.hp) * 0.6, 'for about half');

  const poison = arena('west_african');
  const hunter = spawn(poison, 0, 'west_african_dart_hunter', 20, 20);
  const victim = dummy(poison, 25, 20);
  poison.issueCommand(0, { type: 'attack', units: [hunter.id], target: victim.id });
  run(poison, 1.2);
  assert.ok(victim.statuses.some((st) => st.type === 'dot'), 'Poison Darts');

  const frenzy = arena('norse');
  const bers = spawn(frenzy, 0, 'norse_berserker', 20, 20);
  const bag = dummy(frenzy, 20.75, 20);
  bag.baseDamage = 0; // a punching bag, so only the lifesteal changes his health
  bers.hp = 100;
  frenzy.issueCommand(0, { type: 'attack', units: [bers.id], target: bag.id });
  run(frenzy, 0.2);
  assert.ok(bers.hp > 100, 'Battle Frenzy');

  const eagle = spawn(arena('aztec'), 0, 'aztec_eagle_warrior', 20, 20);
  assert.equal(eagle.evasion, 0.15);
  const known = new Set(['aura', 'evasion', 'thorns', 'lifesteal', 'regen', 'cleave', 'critical', 'onHitDot']);
  for (const pantheon of PANTHEON_LIST) for (const ps of pantheon.elite.passives) assert.ok(known.has(ps.type), `${pantheon.elite.id} ${ps.type}`);
});

test('a fight between pantheons: the Norse elite beats a Greek Warrior; events stay clean', () => {
  const w = duel('norse');
  clearUnits(w, 0);
  clearUnits(w, 1);
  const a = spawn(w, 0, 'norse_berserker', 20, 20);
  const b = spawn(w, 1, 'warrior', 21.2, 20);
  const ev = runCollect(w, 60);
  assert.ok(b.dead && !a.dead, 'a 3-pop elite beats a 2-pop Warrior, even one with Hoplite Drill');
  assert.deepEqual(errorsOf(ev, 0), []);
});
