import test from 'node:test';
import assert from 'node:assert/strict';
import { TICK_RATE } from '../../src/config.js';
import { edgeDist } from '../../src/sim/common.js';
import { hasFreeSpot } from '../../src/sim/surround.js';
import { makeWorld, spawn, clearUnits, runUntil, run, place } from './helpers.js';

// Melee surround and re-targeting (DESIGN 5.4): attackers spread over free
// spots on the target's perimeter instead of piling up behind each other.

function arena() {
  const w = makeWorld({ map: { width: 64, height: 64, starts: [{ x: 2, y: 2 }, { x: 56, y: 56 }] } });
  clearUnits(w, 0);
  clearUnits(w, 1);
  w.events.length = 0;
  return w;
}

/** A tough enemy that stands still and deals no damage. */
function dummy(w, x, y, type = 'warrior') {
  const f = spawn(w, 1, type, x, y);
  f.hp = f.maxHp = 1e6;
  f.def = { ...f.def, attack: { ...f.def.attack, damage: 0 } };
  w.setOrder(f, { type: 'hold', target: 0 });
  return f;
}

function crowd(w, n, x0 = 20, y0 = 28) {
  const us = [];
  for (let i = 0; i < n; i++) us.push(spawn(w, 0, 'warrior', x0 + (i % 5) * 0.9, y0 + Math.floor(i / 5) * 0.9));
  return us;
}

const WINDOW = 1.5; // s, longer than the warrior's 1.35 s attack cooldown

/**
 * Tick `seconds`; returns, per WINDOW, how many of `us` swung at least once
 * during that window.
 */
function watch(w, us, seconds) {
  const ids = new Set(us.map((u) => u.id));
  const perSecond = [];
  for (let s = 0; s < seconds / WINDOW - 1e-9; s++) {
    const swung = new Set();
    for (let i = 0; i < WINDOW * TICK_RATE; i++) {
      w.tick();
      for (const e of w.events) if (e.type === 'attack' && ids.has(e.src)) swung.add(e.src);
      w.events.length = 0;
    }
    perSecond.push(swung.size);
  }
  return perSecond;
}

/** Smallest centre distance between two of `us`, as a fraction of their radii sum. */
function worstOverlap(us) {
  let worst = Infinity;
  for (let a = 0; a < us.length; a++) {
    for (let b = a + 1; b < us.length; b++) {
      const A = us[a];
      const B = us[b];
      if (A.dead || B.dead) continue;
      worst = Math.min(worst, Math.hypot(A.x - B.x, A.y - B.y) / (A.radius + B.radius));
    }
  }
  return worst;
}

/** Swung in a window of seconds [from, to) (union). */
function swungIn(w, us, seconds) {
  const ids = new Set(us.map((u) => u.id));
  const swung = new Set();
  for (let i = 0; i < seconds * TICK_RATE; i++) {
    w.tick();
    for (const e of w.events) if (e.type === 'attack' && ids.has(e.src)) swung.add(e.src);
    w.events.length = 0;
  }
  return swung.size;
}

test('20 attack-moving warriors vs 4 spread enemies: most are hitting within a few seconds', () => {
  const w = arena();
  for (let i = 0; i < 4; i++) dummy(w, 32 + (i % 2) * 3, 32 + Math.floor(i / 2) * 3);
  const us = crowd(w, 20);
  w.issueCommand(0, { type: 'attackMove', units: us.map((u) => u.id), x: 34, y: 34 });
  const per = watch(w, us, 6);
  const tail = swungIn(w, us, 2);
  assert.ok(per[3] >= 16, `swinging per 1.5 s ${per.join(' ')}`);
  assert.ok(tail >= 18, `swinging in seconds 7-9: ${tail}`);
  assert.ok(worstOverlap(us) > 0.75, `overlap ${worstOverlap(us).toFixed(2)}`);
});

test('20 attack-moving warriors vs 4 clumped enemies spread over all of them', () => {
  const w = arena();
  const foes = [];
  for (let i = 0; i < 4; i++) foes.push(dummy(w, 32 + (i % 2) * 1.2, 32 + Math.floor(i / 2) * 1.2));
  const us = crowd(w, 20);
  w.issueCommand(0, { type: 'attackMove', units: us.map((u) => u.id), x: 34, y: 34 });
  watch(w, us, 7);
  const n = swungIn(w, us, 2);
  assert.ok(n >= 16, `swinging in seconds 7-9: ${n}`);
  const targets = new Set(us.map((u) => u.order && u.order.target).filter(Boolean));
  assert.ok(targets.size >= 3, `targets ${[...targets]}`);
  assert.ok(worstOverlap(us) > 0.75, `overlap ${worstOverlap(us).toFixed(2)}`);
});

test('explicit attack on one enemy: the ring fills, the rest wait outside and keep the target', () => {
  const w = arena();
  const foe = dummy(w, 32, 32);
  const us = crowd(w, 20);
  w.issueCommand(0, { type: 'attack', units: us.map((u) => u.id), target: foe.id });
  const per = watch(w, us, 7.5);
  // A warrior-sized target has room for about 8–9 warriors around it.
  assert.ok(per[4] >= 7, `swinging per 1.5 s ${per.join(' ')}`);
  assert.ok(us.every((u) => u.order && u.order.type === 'attack' && u.order.target === foe.id), 'explicit orders keep their target');
  const ring = us.filter((u) => edgeDist(u, foe) <= u.def.attack.range + 0.05);
  assert.ok(ring.length >= 7 && ring.length <= 10, `ring ${ring.length}`);
  assert.equal(hasFreeSpot(w, us.find((u) => !ring.includes(u)), foe), false, 'surrounded');
  assert.ok(worstOverlap(us) > 0.75, `overlap ${worstOverlap(us).toFixed(2)}`);
  // Waiting attackers stand clear of the ring and the lane around it instead of pushing in.
  const waiting = us.filter((u) => !ring.includes(u));
  for (const u of waiting) assert.ok(edgeDist(u, foe) > 1.2, `waiter ${u.id} at ${edgeDist(u, foe).toFixed(2)}`);
  // When the ring opens (an attacker leaves), a waiting one takes the spot.
  const leaver = ring[0];
  w.issueCommand(0, { type: 'move', units: [leaver.id], x: 50, y: 50 });
  watch(w, us, 3);
  const ring2 = us.filter((u) => u !== leaver && edgeDist(u, foe) <= u.def.attack.range + 0.05);
  assert.ok(ring2.length >= ring.length - 1 && ring2.some((u) => !ring.includes(u)), 'a waiter stepped in');
});

test('20 warriors surround a barracks', () => {
  const w = arena();
  const b = w.createBuilding(1, 'barracks', 30, 30, true, true);
  b.hp = b.maxHp = 1e6;
  const us = crowd(w, 20);
  w.issueCommand(0, { type: 'attack', units: us.map((u) => u.id), target: b.id });
  watch(w, us, 6);
  const n = swungIn(w, us, 2);
  assert.ok(n >= 18, `swinging in seconds 6-8: ${n}`);
  assert.ok(worstOverlap(us) > 0.75, `overlap ${worstOverlap(us).toFixed(2)}`);
});

test('attack-move: an attacker blocked from its target switches to a reachable enemy', () => {
  const w = arena();
  const a = dummy(w, 32, 32);
  const bTarget = dummy(w, 32, 38);
  const u = spawn(w, 0, 'warrior', 25, 32);
  w.issueCommand(0, { type: 'attackMove', units: [u.id], x: 40, y: 32 });
  // Wait until it picks the nearer enemy, then wall that enemy in with allies.
  assert.ok(runUntil(w, () => u.order && u.order.target, 3) > 0);
  assert.equal(u.order.target, a.id);
  const R = a.radius + u.radius + 0.2;
  const wall = [];
  for (let k = 0; k < 7; k++) {
    const ang = (k / 7) * Math.PI * 2;
    const g = spawn(w, 0, 'warrior', a.x + Math.cos(ang) * R, a.y + Math.sin(ang) * R);
    w.setOrder(g, { type: 'hold', target: 0 });
    wall.push(g);
  }
  w.tick();
  assert.equal(hasFreeSpot(w, u, a), false, 'a is walled in');
  let switched = -1;
  for (let i = 0; i < 4 * TICK_RATE; i++) {
    w.tick();
    if (u.order.target === bTarget.id) {
      switched = i / TICK_RATE;
      break;
    }
  }
  assert.ok(switched > 0 && switched < 3, `switched after ${switched} s`);
  const hits = swungIn(w, [u], 5);
  assert.equal(hits, 1, 'hits the reachable enemy');
  assert.ok(bTarget.hp < bTarget.maxHp || edgeDist(u, bTarget) <= u.def.attack.range + 0.05);
});

test('explicit attack on a walled-in enemy keeps the target', () => {
  const w = arena();
  const a = dummy(w, 32, 32);
  dummy(w, 32, 36);
  const R = a.radius + 0.4 + 0.2;
  for (let k = 0; k < 7; k++) {
    const ang = (k / 7) * Math.PI * 2;
    const g = spawn(w, 0, 'warrior', a.x + Math.cos(ang) * R, a.y + Math.sin(ang) * R);
    w.setOrder(g, { type: 'hold', target: 0 });
  }
  const u = spawn(w, 0, 'warrior', 26, 32);
  w.issueCommand(0, { type: 'attack', units: [u.id], target: a.id });
  for (let i = 0; i < 6 * TICK_RATE; i++) {
    w.tick();
    assert.equal(u.order && u.order.target, a.id);
  }
  assert.equal(u.state === 'attack' || u.state === 'move' || u.state === 'idle', true);
});

test('hitting the target clears the count of attack spots no path reached', () => {
  // Two such spots in a row make a building count as shut in (an explicit attack on it is then dropped),
  // so one failed spot from long ago must not add up with a later one once the attacker has reached it.
  const w = makeWorld();
  clearUnits(w, 0);
  clearUnits(w, 1);
  const house = place(w, 1, 'house', 20, 20);
  const u = spawn(w, 0, 'warrior', 20.5, 24);
  w.issueCommand(0, { type: 'attack', units: [u.id], target: house.id });
  assert.ok(runUntil(w, () => u.state === 'attack', 30) > 0, 'it reaches the house');
  u.atk.cut = 1; // an earlier spot had no path
  run(w, 1);
  assert.equal(u.state, 'attack');
  assert.equal(u.atk.cut, 0);
});
