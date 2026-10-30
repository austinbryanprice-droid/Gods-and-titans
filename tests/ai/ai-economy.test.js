// AI economy under the MINE_SLOTS rule (DESIGN 5.2/10): gold workers sized to
// what a mine can take (2 mine at once, 5–6 saturate it), a second mine
// before the start mine runs out, and pop-free rebuilds after a raid.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../../src/sim/world.js';
import { createAI } from '../../src/ai/ai.js';
import { minersFor, shiftHelps } from '../../src/ai/economy.js';
import { PANTHEON_LIST } from '../../src/data/index.js';
import { TICK_RATE, MINE_SLOTS } from '../../src/config.js';

/** A generated small map with player 0 run by the AI and player 1 idle. */
function soloGame(seed, pantheon = 'egyptian', difficulty = 'normal') {
  const world = createWorld({
    version: '0.1.0',
    seed,
    mapSize: 'small',
    players: [
      { index: 0, name: 'AI', team: 1, pantheon, kind: 'ai', difficulty },
      { index: 1, name: 'Idle', team: 2, pantheon: 'norse', kind: 'human', difficulty: null },
    ],
  });
  const ai = createAI(world, 0, difficulty);
  const step = (seconds, each) => {
    const n = Math.round(seconds * TICK_RATE);
    for (let i = 0; i < n; i++) {
      ai.tick();
      world.tick();
      world.events.length = 0;
      world.felled.length = 0;
      if (each) each(i);
    }
  };
  return { world, ai, step };
}

/** Gold workers of player 0 per mine id, and how many of them wait their turn. */
function miners(world) {
  const per = new Map();
  let waiting = 0;
  for (const u of world.unitsOf(0)) {
    const o = u.order;
    if (u.def.class !== 'worker' || !o || o.type !== 'gather') continue;
    const m = world.entities.get(o.target);
    if (!m || m.kind !== 'mine') continue;
    per.set(m.id, (per.get(m.id) || 0) + 1);
    if (o.phase === 'wait') waiting++;
  }
  return { per, waiting };
}

test('gold workers match what each mine can take, and the AI takes a second mine early', () => {
  for (const [seed, pantheon] of [[3, 'egyptian'], [8, 'greek']]) {
    const g = soloGame(seed, pantheon, 'normal');
    const { world, ai } = g;
    g.step(150);
    let samples = 0;
    let waitSum = 0;
    let over = 0;
    let expandedAt = null;
    for (let t = 150; t < 9 * 60; t += 10) {
      g.step(10);
      const { per, waiting } = miners(world);
      samples++;
      waitSum += waiting;
      for (const pr of ai.ai.pairs) {
        const n = per.get(pr.mine.id) || 0;
        if (n > minersFor(ai.ai, pr) + 1) over++;
      }
      if (expandedAt === null && ai.ai.pairs.length >= 2) expandedAt = t;
    }
    const avgWait = waitSum / samples;
    // About (workers - MINE_SLOTS - walkers) wait at a saturated mine; more means idle hands.
    assert.ok(avgWait <= 2.5, `${pantheon}: ${avgWait.toFixed(1)} miners waiting on average (MINE_SLOTS ${MINE_SLOTS})`);
    assert.ok(over <= samples * 0.15, `${pantheon}: a mine had too many gold workers in ${over}/${samples} samples`);
    assert.ok(expandedAt !== null && expandedAt <= 8.5 * 60, `${pantheon}: second mine at ${expandedAt}`);
    assert.equal(ai.ai.errors, 0);
  }
});

test('over the pop cap after a raid, the AI still rebuilds its Town Center and houses', () => {
  const g = soloGame(5, 'norse', 'normal');
  const { world, ai } = g;
  ai.ai.prof = { ...ai.ai.prof, firstAttack: 1e9 }; // stay home: the idle opponent must not lose first
  g.step(480);
  const p = world.players[0];
  // A small raid and out: the Town Center and three houses die, no AI unit does.
  world.killEntity(world.buildingsOf(0).find((b) => b.type === 'town_center'), null);
  for (const h of world.buildingsOf(0).filter((b) => b.type === 'house').slice(0, 3)) world.killEntity(h, null);
  assert.ok(p.popUsed > p.popCap, `over the cap (${p.popUsed}/${p.popCap})`);
  g.step(120);
  assert.ok(world.buildingsOf(0).some((b) => b.type === 'town_center' && b.constructed), 'Town Center rebuilt');
  assert.ok(p.popCap >= p.popUsed, `houses back (${p.popUsed}/${p.popCap})`);
  assert.equal(ai.ai.errors, 0);
});

test('with every drop-off lost and the Town Center out of reach, the AI puts up a storehouse and its carriers deliver again', () => {
  const g = soloGame(5, 'norse', 'normal');
  const { world, ai } = g;
  ai.ai.prof = { ...ai.ai.prof, firstAttack: 1e9 };
  g.step(240);
  const p = world.players[0];
  for (const b of world.buildingsOf(0).filter((x) => x.def.dropOff)) world.killEntity(b, null);
  Object.assign(p, { gold: 200, wood: 60 }); // a storehouse's worth, not a Town Center's
  const before = p.stats.gathered;
  g.step(90);
  assert.ok(world.buildingsOf(0).some((b) => b.type === 'storehouse' && b.constructed), 'a storehouse stands');
  assert.ok(p.stats.gathered > before, 'the carriers deliver again');
  assert.equal(ai.ai.errors, 0);
});

test('a worker moves between gold and wood only when that closes a real gap', () => {
  // (need of the job it would join, need of the job it would leave; negative = a surplus)
  assert.equal(shiftHelps(2, 0), true); // the other job is full
  assert.equal(shiftHelps(1, -1), true); // the other job has one too many
  assert.equal(shiftHelps(3, 1), true); // both short, this one much more
  assert.equal(shiftHelps(2, 2), false); // both short alike: moving would only swap the gap
  assert.equal(shiftHelps(2, 1), false); // ... and the move back would be just as good
  assert.equal(shiftHelps(1, 0), false);
  assert.equal(shiftHelps(0, -3), false);
});

test('AI workers are not sent back and forth between a mine and the trees', () => {
  // Found in an AI-vs-AI game (seed 3, Hindu v Greek): short of workers for both gold and wood, the
  // AI moved one worker to wood and back to gold every half second for minutes; it never arrived.
  const ids = PANTHEON_LIST.map((p) => p.id);
  const seed = 3;
  const world = createWorld({
    version: '0.1.0',
    seed,
    mapSize: 'small',
    players: [ids[seed % ids.length], ids[(seed * 3 + 1) % ids.length]].map((pantheon, i) => ({ index: i, name: `AI ${i}`, team: i + 1, pantheon, kind: 'ai', difficulty: 'normal' })),
  });
  const ais = [0, 1].map((i) => createAI(world, i, 'normal'));
  const orders = new Map(); // unit id -> ticks of its gather orders
  for (const a of ais) {
    const issue = a.ai.issue.bind(a.ai);
    a.ai.issue = (cmd) => {
      if (cmd.type === 'gather') for (const id of cmd.units) (orders.get(id) || orders.set(id, []).get(id)).push(world.tickCount);
      return issue(cmd);
    };
  }
  const end = 12 * 60 * TICK_RATE;
  while (world.tickCount < end && !world.gameOver) {
    for (const a of ais) a.tick();
    world.tick();
    world.events.length = 0;
    world.felled.length = 0;
  }
  // The most gather orders one worker got within any 30 s.
  let worst = 0;
  for (const ticks of orders.values()) {
    for (let i = 0, j = 0; j < ticks.length; j++) {
      while (ticks[j] - ticks[i] > 30 * TICK_RATE) i++;
      worst = Math.max(worst, j - i + 1);
    }
  }
  assert.ok(worst <= 8, `a worker got ${worst} gather orders within 30 s`);
});

test('a rival foundation by a worked mine does not send its gold workers across the map', () => {
  // Found in a Brutal 2v2 (seed 33): rivals kept placing Storehouse sites by a mine the AI worked
  // and losing them. Each one dropped the mine from the AI's owned mines, its workers were sent to
  // an expansion 110 tiles off, and back when the site fell: two workers walked for minutes, mining nothing.
  const g = soloGame(3, 'greek', 'normal');
  const { world, ai } = g;
  ai.ai.prof = { ...ai.ai.prof, firstAttack: 1e9, raids: null };
  g.step(20);
  const home = world.buildingsOf(0).find((b) => b.type === 'town_center');
  const homeMine = world.mineList.reduce((a, m) => (Math.hypot(m.x - home.x, m.y - home.y) < Math.hypot(a.x - home.x, a.y - home.y) ? m : a));
  // An expansion far away, its Storehouse already standing.
  const enemyHome = world.buildingsOf(1).find((b) => b.type === 'town_center');
  const far = world.mineList
    .filter((m) => Math.hypot(m.x - home.x, m.y - home.y) > 50 && Math.hypot(m.x - enemyHome.x, m.y - enemyHome.y) > 25)
    .sort((a, b) => Math.hypot(b.x - home.x, b.y - home.y) - Math.hypot(a.x - home.x, a.y - home.y))[0];
  assert.ok(far, 'a far mine on the map');
  for (const c of world.camps) if (Math.hypot(c.x - far.x, c.y - far.y) < 10) for (const u of c.members) if (!u.dead) world.killEntity(u, null);
  const sp = world.findPlacement(0, 'storehouse', far.x, far.y, 8);
  world.createBuilding(0, 'storehouse', sp.tx, sp.ty, true, true);
  g.step(2);
  assert.ok(ai.ai.pairs.some((p) => p.mine === far), 'the far mine is owned');
  // Turned round: a worker ordered to a gold mine 40+ tiles from the one it was last sent to, within 2 min.
  let bounces = 0;
  const sentTo = new Map(); // worker id -> { m, t }
  const issue = ai.ai.issue.bind(ai.ai);
  ai.ai.issue = (cmd) => {
    const m = cmd.type === 'gather' && cmd.target ? world.entities.get(cmd.target) : null;
    if (m && m.kind === 'mine') {
      for (const id of cmd.units) {
        const last = sentTo.get(id);
        if (last && Math.hypot(last.m.x - m.x, last.m.y - m.y) >= 40 && world.time - last.t < 120) bounces++;
        sentTo.set(id, { m, t: world.time });
      }
    }
    return issue(cmd);
  };
  // A rival foundation by the home mine every 15 s, gone 6 s later.
  const spot = world.findPlacement(1, 'storehouse', homeMine.x, homeMine.y, 9);
  assert.ok(spot && Math.hypot(spot.tx + 1 - homeMine.x, spot.ty + 1 - homeMine.y) < 10, 'room for a rival site by the home mine');
  let dropped = 0;
  for (let k = 0; k < 6; k++) {
    const site = world.createBuilding(1, 'storehouse', spot.tx, spot.ty, false, true);
    g.step(6);
    if (!ai.ai.pairs.some((p) => p.mine === homeMine)) dropped++;
    world.killEntity(site, null);
    g.step(9);
  }
  assert.equal(dropped, 0, 'the home mine stays owned under a rival foundation');
  assert.equal(bounces, 0, `${bounces} gold workers turned round between mines across the map`);
  // A finished rival Storehouse by it does not take a worked mine either (both sides mine there:
  // in a free-for-all three rivals' drop-offs stood by the contested mines and the AI's workers
  // walked away each time one was finished, and back when it fell); a finished Tower does.
  const b = world.createBuilding(1, 'storehouse', spot.tx, spot.ty, true, true);
  g.step(2);
  assert.ok(ai.ai.pairs.some((p) => p.mine === homeMine), 'a finished rival Storehouse leaves the worked mine owned');
  world.killEntity(b, null);
  const t = world.createBuilding(1, 'tower', spot.tx, spot.ty, true, true);
  g.step(2);
  assert.ok(!ai.ai.pairs.some((p) => p.mine === homeMine), 'a finished rival Tower contests the mine');
  world.killEntity(t, null);
  assert.equal(ai.ai.errors, 0);
});

test('an unworked mine by a finished rival Storehouse is not taken as an owned mine', () => {
  const g = soloGame(3, 'greek', 'normal');
  const { world, ai } = g;
  ai.ai.prof = { ...ai.ai.prof, firstAttack: 1e9, raids: null };
  g.step(10);
  const home = world.buildingsOf(0).find((b) => b.type === 'town_center');
  const far = world.mineList
    .filter((m) => Math.hypot(m.x - home.x, m.y - home.y) > 30)
    .sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y))[0];
  for (const c of world.camps) if (Math.hypot(c.x - far.x, c.y - far.y) < 10) for (const u of c.members) if (!u.dead) world.killEntity(u, null);
  // Both a Storehouse of the AI's and a rival's finished one stand by it in the same tick.
  const mine = world.findPlacement(0, 'storehouse', far.x, far.y, 8);
  world.createBuilding(0, 'storehouse', mine.tx, mine.ty, true, true);
  const theirs = world.findPlacement(1, 'storehouse', far.x, far.y, 9);
  world.createBuilding(1, 'storehouse', theirs.tx, theirs.ty, true, true);
  g.step(2);
  assert.ok(!ai.ai.pairs.some((p) => p.mine === far), 'a mine a rival already holds is not taken up');
  assert.equal(ai.ai.errors, 0);
});

test('faith hovering at its cap does not walk worshippers on and off prayer', () => {
  // Found in Brutal free-for-alls (seeds 41 to 48): faith rose past the cap by prayer and fell
  // under it as a creature was bought, and each time half the worshippers left prayer for a mine
  // (often the far one) and came back seconds later.
  const g = soloGame(5, 'greek', 'hard');
  const { world, ai } = g;
  ai.ai.prof = { ...ai.ai.prof, firstAttack: 1e9, raids: null };
  g.step(20);
  const home = world.buildingsOf(0).find((b) => b.type === 'town_center');
  const sp = world.findPlacement(0, 'temple', home.x + 8, home.y, 10);
  world.createBuilding(0, 'temple', sp.tx, sp.ty, true, true);
  for (let i = 0; i < 16; i++) world.spawnUnit(0, 'worshipper', home.x + 4, home.y + 4, { silent: true });
  const p = world.players[0];
  p.popCap = 200;
  g.step(30);
  let orders = 0;
  const issue = ai.ai.issue.bind(ai.ai);
  ai.ai.issue = (cmd) => {
    if (cmd.type === 'pray') orders += cmd.units.length;
    return issue(cmd);
  };
  // Faith just above and just below the Temple-era cap (700), every 3 s for a minute and a half.
  for (let k = 0; k < 30; k++) {
    p.faith = k % 2 ? 690 : 720;
    g.step(3);
  }
  assert.ok(orders <= 4, `${orders} worshippers sent back to prayer while faith hovered at its cap`);
  assert.equal(ai.ai.errors, 0);
});

test('a wood bank hovering at its full mark does not walk spare hands between the trees and a mine', () => {
  // Spare worshippers chop until the wood bank holds 1200, then queue at a mine: as the bank
  // crossed that mark and back (a building bought, a load delivered) all of them changed job at once.
  const g = soloGame(5, 'greek', 'hard');
  const { world, ai } = g;
  ai.ai.prof = { ...ai.ai.prof, firstAttack: 1e9, raids: null };
  g.step(20);
  const home = world.buildingsOf(0).find((b) => b.type === 'town_center');
  for (let i = 0; i < 20; i++) world.spawnUnit(0, 'worshipper', home.x + 4, home.y + 4, { silent: true });
  const p = world.players[0];
  p.popCap = 200;
  p.wood = 1300;
  g.step(30);
  let orders = 0;
  const issue = ai.ai.issue.bind(ai.ai);
  ai.ai.issue = (cmd) => {
    if (cmd.type === 'gather') orders += cmd.units.length;
    return issue(cmd);
  };
  for (let k = 0; k < 30; k++) {
    p.wood = k % 2 ? 1150 : 1250;
    g.step(3);
  }
  assert.ok(orders <= 20, `${orders} gather orders while the wood bank hovered at its full mark`);
  assert.equal(ai.ai.errors, 0);
});
