// AI economy under the WC3 mining rules (DESIGN 5.2/10): gold workers sized
// to what a mine can take (2 mine at once, 5–6 saturate it), an expansion
// before the start mine runs out, and builders and woodcutters that get
// stuck on the way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../../src/sim/world.js';
import { createAI } from '../../src/ai/ai.js';
import { minersFor } from '../../src/ai/economy.js';
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

test('gold workers match what each mine can take, and the AI expands before the start mine runs dry', () => {
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
      if (expandedAt === null && ai.ai.pairs.filter((p) => !p.far).length >= 2) expandedAt = t;
    }
    const avgWait = waitSum / samples;
    // About (workers − MINE_SLOTS − walkers) wait at a saturated mine; more means idle hands.
    assert.ok(avgWait <= 2.5, `${pantheon}: ${avgWait.toFixed(1)} miners waiting on average (MINE_SLOTS ${MINE_SLOTS})`);
    assert.ok(over <= samples * 0.15, `${pantheon}: a mine had too many gold workers in ${over}/${samples} samples`);
    assert.ok(expandedAt !== null && expandedAt <= 8.5 * 60, `${pantheon}: second mine at ${expandedAt}`);
    assert.equal(ai.ai.errors, 0);
  }
});

test('a builder stuck on its way is stopped and the building still goes up', () => {
  const g = soloGame(5, 'japanese', 'normal');
  const { world, ai } = g;
  g.step(40);
  // Catch a worker walking to an unplaced building and freeze it there (as an
  // empty path does): the AI must stop it, refunding the order, and build anyway.
  let stuck = null;
  for (let k = 0; k < 600 && !stuck; k++) {
    g.step(0.5);
    stuck = world.unitsOf(0).find((u) => u.def.class === 'worker' && u.order && u.order.type === 'build' && !u.order.site && u.order.paid && u.state === 'move') || null;
  }
  assert.ok(stuck, 'a worker walks to a build spot');
  const type = stuck.order.b;
  const before = world.buildingsOf(0).filter((b) => b.type === type).length;
  stuck.baseSpeed = 0;
  let released = false;
  g.step(30, () => {
    if (!released && (!stuck.order || stuck.order.type !== 'build')) released = true;
  });
  assert.ok(released, 'the stuck builder was stopped');
  g.step(60);
  const after = world.buildingsOf(0).filter((b) => b.type === type).length;
  assert.ok(after > before, `another ${type} was placed (${before} -> ${after})`);
  assert.equal(ai.ai.errors, 0);
});

test('a woodcutter stuck on the way to its tree is sent to another one', () => {
  const g = soloGame(6, 'celtic', 'normal');
  const { world, ai } = g;
  g.step(60);
  let stuck = null;
  for (let k = 0; k < 400 && !stuck; k++) {
    g.step(0.25);
    stuck = world.unitsOf(0).find((u) => u.def.class === 'worker' && u.order && u.order.type === 'gather' && u.order.tree && u.order.phase === 'go') || null;
  }
  assert.ok(stuck, 'a woodcutter walks to a tree');
  const tree = { ...stuck.order.tree };
  stuck.baseSpeed = 0; // frozen short of the tree, as an empty path leaves it
  g.step(12);
  const o = stuck.order;
  assert.ok(o && o.type === 'gather' && o.tree, 'still a woodcutter');
  assert.ok(o.tree.tx !== tree.tx || o.tree.ty !== tree.ty, 'sent to another tree');
  assert.ok(ai.ai.badTrees && ai.ai.badTrees.size >= 1, 'the tree is avoided for a while');
  assert.equal(ai.ai.errors, 0);
});
