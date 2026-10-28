// The smarter Hard and Brutal AIs (DESIGN 10): worker raids, wounded soldiers
// stepping back to a Priest, the Brutal profile above Hard, and the army centre
// every AI marches by.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, World } from '../../src/sim/world.js';
import { createAI } from '../../src/ai/ai.js';
import { PROFILES, profileFor } from '../../src/ai/profiles.js';
import { DIFFICULTIES as LOBBY_DIFFICULTIES } from '../../src/net/lobby.js';
import { DIFFICULTIES as MENU_DIFFICULTIES, slotKindOptions, kindPatch } from '../../src/ui/menu-model.js';
import { TICK_RATE, AI_THINK_INTERVAL, AI_INCOME_BONUS, CARRY_AMOUNT } from '../../src/config.js';
import { deposit } from '../../src/sim/economy.js';
import { makeMap, makeSetup } from '../sim/helpers.js';

function step(world, ais, seconds, each) {
  for (let i = 0; i < seconds * TICK_RATE; i++) {
    for (const a of ais) a.tick();
    world.tick();
    if (each) each(world.events);
    world.events.length = 0;
    world.felled.length = 0;
  }
}

test('Brutal is a difficulty everywhere: lobby, menu, AI profile and think rate', () => {
  assert.deepEqual(LOBBY_DIFFICULTIES, ['easy', 'normal', 'hard', 'brutal']);
  assert.deepEqual(MENU_DIFFICULTIES, LOBBY_DIFFICULTIES);
  const opts = slotKindOptions({ kind: 'open' }, 1, { myIndex: 0, online: false });
  assert.ok(opts.some((o) => o.value === 'ai:brutal' && o.label === `AI — Brutal (gathers ${Math.round(AI_INCOME_BONUS.brutal * 100)}% faster)`));
  assert.deepEqual(kindPatch('ai:brutal'), { kind: 'ai', difficulty: 'brutal' });
  assert.equal(profileFor('brutal'), PROFILES.brutal);
  assert.ok(AI_THINK_INTERVAL.brutal < AI_THINK_INTERVAL.hard);
  const { hard, brutal } = PROFILES;
  // Hard's play, thinking faster and raiding more often; its edge is the gather bonus the menu names.
  assert.ok(brutal.raids.every < hard.raids.every && brutal.raids.from < hard.raids.from);
  assert.equal(brutal.pullWounded, hard.pullWounded);
  assert.ok(AI_INCOME_BONUS.brutal > 0);
  for (const d of ['easy', 'normal', 'hard']) assert.ok(!AI_INCOME_BONUS[d], d);
  assert.ok(opts.some((o) => o.value === 'ai:hard' && o.label === 'AI — Hard'));
  // Easy and Normal play as before: no raids, no wounded pull.
  for (const d of ['easy', 'normal']) {
    assert.equal(PROFILES[d].raids, null, d);
    assert.equal(PROFILES[d].pullWounded, 0, d);
  }
  const ai = createAI(createWorld({ version: '0.1.0', seed: 1, mapSize: 'small', players: [
    { index: 0, name: 'A', team: 1, pantheon: 'greek', kind: 'ai', difficulty: 'brutal' },
    { index: 1, name: 'B', team: 2, pantheon: 'norse', kind: 'ai', difficulty: 'normal' },
  ] }), 0, 'brutal');
  assert.equal(ai.ai.difficulty, 'brutal');
});

test('only a Brutal computer player gets the gather bonus, on every load it delivers', () => {
  const world = createWorld({ version: '0.1.0', seed: 1, mapSize: 'small', players: [
    { index: 0, name: 'You', team: 1, pantheon: 'norse', kind: 'human', difficulty: null },
    { index: 1, name: 'AI (Hard)', team: 2, pantheon: 'norse', kind: 'ai', difficulty: 'hard' },
    { index: 2, name: 'AI (Brutal)', team: 3, pantheon: 'norse', kind: 'ai', difficulty: 'brutal' },
    { index: 3, name: 'Odd', team: 4, pantheon: 'norse', kind: 'human', difficulty: 'brutal' },
  ] });
  const got = world.players.map((p, i) => {
    const u = world.unitsOf(i).find((w) => w.def.class === 'worker');
    const before = p.gold;
    u.carry = 'g';
    u.carryAmount = CARRY_AMOUNT;
    deposit(world, u);
    return p.gold - before;
  });
  assert.deepEqual(got, [CARRY_AMOUNT, CARRY_AMOUNT, CARRY_AMOUNT * (1 + AI_INCOME_BONUS.brutal), CARRY_AMOUNT]);
});

test('a Hard AI raids the Worshippers at an unguarded mine, kills some and brings its squad home', () => {
  const world = createWorld({ version: '0.1.0', seed: 4, mapSize: 'small', players: [
    { index: 0, name: 'AI', team: 1, pantheon: 'greek', kind: 'ai', difficulty: 'hard' },
    { index: 1, name: 'Idle', team: 2, pantheon: 'norse', kind: 'human', difficulty: null },
  ] });
  const a = createAI(world, 0, 'hard');
  // Only raids: no waves, no creeping, raids allowed from the start.
  a.ai.prof = { ...a.ai.prof, firstAttack: Infinity, creepFrom: Infinity, raids: { ...a.ai.prof.raids, from: 0 } };
  const enemyTc = world.buildingsOf(1).find((b) => b.type === 'town_center');
  const mine = world.mineList.reduce((m, x) => (Math.hypot(x.x - enemyTc.x, x.y - enemyTc.y) < Math.hypot(m.x - enemyTc.x, m.y - enemyTc.y) ? x : m));
  const workers = world.unitsOf(1).filter((u) => u.def.class === 'worker').map((u) => u.id);
  world.issueCommand(1, { type: 'gather', units: workers, target: mine.id });
  const tc = world.buildingsOf(0).find((b) => b.type === 'town_center');
  for (let i = 0; i < 16; i++) world.spawnUnit(0, 'warrior', tc.x + 5 + (i % 4), tc.y + 5 + Math.floor(i / 4), { silent: true });
  world.recomputePop();
  world.hash.rebuild(world.unitList);
  let killed = 0;
  let raiders = 0;
  step(world, [a], 260, (events) => {
    for (const e of events) if (e.type === 'death' && e.k === 'u' && e.o === 1 && e.t === 'worshipper') killed++;
    if (a.ai.raid && a.ai.raid.ids.size) raiders = Math.max(raiders, a.ai.raid.ids.size);
  });
  assert.ok(a.ai.raid && a.ai.raid.sent >= 1, 'a raid set out');
  assert.ok(raiders >= 3 && raiders < 16, `a squad, not the army (${raiders})`);
  assert.ok(killed >= 3, `Worshippers killed: ${killed}`);
  assert.ok(a.ai.raid.lastEnd > 0, 'the squad came home and rejoined the army');
  assert.equal(a.ai.errors, 0);
});

test('a raid turns back from defenders it cannot beat', () => {
  const world = createWorld({ version: '0.1.0', seed: 4, mapSize: 'small', players: [
    { index: 0, name: 'AI', team: 1, pantheon: 'greek', kind: 'ai', difficulty: 'hard' },
    { index: 1, name: 'Idle', team: 2, pantheon: 'norse', kind: 'human', difficulty: null },
  ] });
  const a = createAI(world, 0, 'hard');
  a.ai.prof = { ...a.ai.prof, firstAttack: Infinity, creepFrom: Infinity, raids: { ...a.ai.prof.raids, from: 0 } };
  const enemyTc = world.buildingsOf(1).find((b) => b.type === 'town_center');
  const mine = world.mineList.reduce((m, x) => (Math.hypot(x.x - enemyTc.x, x.y - enemyTc.y) < Math.hypot(m.x - enemyTc.x, m.y - enemyTc.y) ? x : m));
  world.issueCommand(1, { type: 'gather', units: world.unitsOf(1).filter((u) => u.def.class === 'worker').map((u) => u.id), target: mine.id });
  const tc = world.buildingsOf(0).find((b) => b.type === 'town_center');
  for (let i = 0; i < 16; i++) world.spawnUnit(0, 'warrior', tc.x + 5 + (i % 4), tc.y + 5 + Math.floor(i / 4), { silent: true });
  world.recomputePop();
  world.hash.rebuild(world.unitList);
  // Let it set out, then put a strong guard at the mine (away from the enemy army's centre, which is the guard itself: so it shows up only once the squad is on its way).
  let guarded = false;
  let lost = 0;
  let wentHome = false;
  step(world, [a], 220, (events) => {
    const r = a.ai.raid;
    if (!guarded && r && r.phase === 'go') {
      guarded = true;
      for (let i = 0; i < 10; i++) {
        const g = world.spawnUnit(1, 'warrior', mine.x + (i % 4) - 1.5, mine.y + 2 + Math.floor(i / 4), { silent: true });
        g.hp = g.maxHp = 2000;
      }
      world.hash.rebuild(world.unitList);
    }
    if (guarded && r && r.phase === 'home') wentHome = true;
    for (const e of events) if (e.type === 'death' && e.k === 'u' && e.o === 0) lost++;
  });
  assert.ok(guarded, 'the raid set out');
  assert.ok(wentHome, 'the squad turned for home');
  assert.ok(lost <= 4, `lost ${lost} of the squad`);
  assert.equal(a.ai.errors, 0);
});

test('a badly hurt Hard soldier steps back to a Priest, is healed, and rejoins', () => {
  const map = makeMap({ width: 64, height: 64, starts: [{ x: 4, y: 4 }, { x: 54, y: 54 }] });
  const world = new World(makeSetup(2, { pantheons: ['norse', 'hindu'] }), map);
  const mine = [];
  for (let i = 0; i < 6; i++) mine.push(world.spawnUnit(0, 'warrior', 28 + (i % 3), 32 + Math.floor(i / 3), { silent: true }));
  const priest = world.spawnUnit(0, 'priest', 24, 33, { silent: true });
  const hurt = mine[0];
  const foes = [];
  for (let i = 0; i < 6; i++) foes.push(world.spawnUnit(1, 'warrior', 32 + (i % 3), 32 + Math.floor(i / 3), { silent: true }).id);
  world.hash.rebuild(world.unitList);
  world.issueCommand(1, { type: 'attackMove', units: foes, x: 26, y: 33 });
  const a = createAI(world, 0, 'hard');
  let pulled = false;
  let healedTo = 0;
  for (let t = 0; t < 30 * TICK_RATE && !hurt.dead; t++) {
    if (t === 3 * TICK_RATE) hurt.hp = Math.round(hurt.maxHp * 0.2);
    a.tick();
    world.tick();
    world.events.length = 0;
    if (a.ai.wounded.has(hurt.id)) {
      pulled = true;
      healedTo = Math.max(healedTo, hurt.hp / hurt.maxHp);
    }
  }
  assert.ok(pulled, 'the hurt warrior stepped back');
  assert.ok(healedTo > 0.3, `healed to ${healedTo.toFixed(2)}`);
  assert.ok(hurt.dead || !a.ai.wounded.has(hurt.id), 'back in the army');
  assert.ok(!priest.dead);
  assert.equal(a.ai.errors, 0);
});

test('an army\'s centre is where most of it stands, not dragged home by stragglers', async () => {
  const { centroid } = await import('../../src/ai/military.js');
  const units = [];
  for (let i = 0; i < 20; i++) units.push({ x: 80 + (i % 5), y: 85 + Math.floor(i / 5), air: false });
  for (let i = 0; i < 9; i++) units.push({ x: 15 + i, y: 18, air: false }); // fresh recruits on their way out
  units.push({ x: 5, y: 5, air: true }); // a flyer far off counts for nothing
  const c = centroid(units);
  assert.ok(Math.hypot(c.x - 82, c.y - 86.5) < 6, `centre ${c.x.toFixed(1)},${c.y.toFixed(1)}`);
  assert.deepEqual(centroid([{ x: 3, y: 4, air: true }]), { x: 3, y: 4 });
  assert.equal(centroid([]), null);
});
