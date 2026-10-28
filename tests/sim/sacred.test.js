// Sacred Sites (DESIGN 5.11): capture by Worshippers and Priests, contesting, tearing down a
// rival's hold, faith for the holder, the building keep-out, Sacred Victory, the snapshot rows
// and fair placement by mapgen.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SITE_CAPTURE_TIME, SITE_NEUTRALIZE_TIME, SITE_FAITH, SITE_RADIUS, SITE_CLEAR, SACRED_HOLD,
} from '../../src/config.js';
import { generateMap, SITE_MIN_START_DIST } from '../../src/sim/mapgen.js';
import { canCapture, siteBlocksFootprint, SITE_IN_WAY, teamHoldingAll } from '../../src/sim/sacred.js';
import { encode, apply } from '../../src/net/delta.js';
import { makeWorld, run, runCollect, spawn, clearUnits, eventsOf } from './helpers.js';

const SITES = [{ x: 24.5, y: 16.5 }, { x: 24.5, y: 32.5 }];

function arena(opts = {}) {
  const w = makeWorld({ map: { width: 48, height: 48, sacred: SITES }, ...opts });
  clearUnits(w, 0);
  clearUnits(w, 1);
  w.events.length = 0;
  return w;
}

test('only Worshippers and Priests capture', () => {
  const w = arena();
  const kinds = new Map();
  for (const t of ['worshipper', 'priest', 'warrior', 'archer']) kinds.set(t, canCapture(spawn(w, 0, t, 2, 2).def));
  assert.deepEqual([...kinds], [['worshipper', true], ['priest', true], ['warrior', false], ['archer', false]]);
});

test('a Worshipper captures a neutral site in SITE_CAPTURE_TIME seconds; the holder gets faith each second', () => {
  const w = arena();
  spawn(w, 0, 'worshipper', SITES[0].x + 1, SITES[0].y);
  const ev = runCollect(w, SITE_CAPTURE_TIME - 0.5);
  assert.equal(eventsOf(ev, 'siteCaptured').length, 0);
  assert.ok(w.sites[0].prog > 0.9 && w.sites[0].by === 0);
  const ev2 = runCollect(w, 1);
  assert.deepEqual(eventsOf(ev2, 'siteCaptured').map((e) => [e.site, e.player]), [[0, 0]]);
  assert.equal(w.sites[0].owner, 0);
  const before = w.players[0].faith;
  run(w, 10);
  assert.ok(Math.abs(w.players[0].faith - before - 10 * SITE_FAITH) < 0.2, `faith +${w.players[0].faith - before}`);
  assert.equal(w.players[0].faithRate, SITE_FAITH);
  assert.equal(w.players[1].faithRate, 0);
});

test('soldiers do not capture, and a unit outside the radius does nothing', () => {
  const w = arena();
  spawn(w, 0, 'warrior', SITES[0].x, SITES[0].y);
  spawn(w, 0, 'worshipper', SITES[0].x + SITE_RADIUS + 1.5, SITES[0].y);
  run(w, 5);
  assert.equal(w.sites[0].prog, 0);
  assert.equal(w.sites[0].owner, -1);
});

test('a rival standing at the site freezes the capture; leaving it alone lets the progress fade', () => {
  const w = arena();
  spawn(w, 0, 'worshipper', SITES[0].x + 1, SITES[0].y);
  run(w, 5);
  const p = w.sites[0].prog;
  const foe = spawn(w, 1, 'warrior', SITES[0].x - 1, SITES[0].y);
  w.setOrder(foe, { type: 'hold', target: 0 });
  const mine = w.unitList.find((u) => u.owner === 0);
  w.setOrder(mine, { type: 'hold', target: 0 });
  // (They fight; only check the frozen progress over a moment.)
  run(w, 0.5);
  assert.ok(w.sites[0].contested);
  assert.ok(Math.abs(w.sites[0].prog - p) < 0.05);
  w.killEntity(mine, null);
  w.killEntity(foe, null);
  run(w, 1);
  assert.ok(w.sites[0].prog < p, 'nobody there: the half-done capture fades');
  run(w, SITE_CAPTURE_TIME);
  assert.equal(w.sites[0].prog, 0);
  assert.equal(w.sites[0].by, -1);
});

test("a rival's site is torn down first, then captured; the holder loses the faith", () => {
  const w = arena();
  w.sites[0].owner = 1;
  spawn(w, 0, 'priest', SITES[0].x, SITES[0].y + 1);
  const ev = runCollect(w, SITE_NEUTRALIZE_TIME + 0.1);
  assert.deepEqual(eventsOf(ev, 'siteLost').map((e) => [e.site, e.player]), [[0, 1]]);
  assert.equal(w.sites[0].owner, -1);
  const ev2 = runCollect(w, SITE_CAPTURE_TIME + 0.1);
  assert.deepEqual(eventsOf(ev2, 'siteCaptured').map((e) => e.player), [0]);
  assert.equal(w.players[1].faithRate, 0);
});

test('teammates share a capture, and the holder\'s own side does nothing to its site', () => {
  const w = arena({ players: 3, teams: [1, 1, 2] });
  clearUnits(w, 2);
  const a = spawn(w, 0, 'worshipper', SITES[0].x + 1, SITES[0].y);
  run(w, 6);
  spawn(w, 1, 'worshipper', SITES[0].x - 1, SITES[0].y);
  w.killEntity(a, null);
  run(w, SITE_CAPTURE_TIME - 6 + 0.2);
  assert.equal(w.sites[0].owner, 1, 'the teammate finished it');
  run(w, 3);
  assert.equal(w.sites[0].prog, 0);
});

test('a defeated holder lets go of its sites', () => {
  const w = arena();
  w.sites[1].owner = 1;
  const ev = (() => {
    w.defeatPlayer(1);
    return runCollect(w, 0.1);
  })();
  assert.equal(w.sites[1].owner, -1);
  assert.deepEqual(eventsOf(ev, 'siteLost').map((e) => e.site), [1]);
});

test('no building comes within SITE_KEEP of a site, for the sim and the shared helper alike', () => {
  const w = arena();
  // A House (2×2) right beside the center is refused; far enough away it is fine.
  const tx = Math.floor(SITES[0].x) + 1;
  const ty = Math.floor(SITES[0].y) - 1;
  assert.equal(w.placementError(0, 'house', tx, ty), SITE_IN_WAY);
  assert.ok(siteBlocksFootprint(w.sites, tx, ty, 2));
  assert.equal(w.placementError(0, 'house', tx + 4, ty), null);
  assert.ok(!siteBlocksFootprint(w.sites, tx + 4, ty, 2));
  assert.ok(!siteBlocksFootprint([], tx, ty, 2));
});

test('Sacred Victory: one side holding every site for SACRED_HOLD seconds wins; losing one stops the clock', () => {
  const w = arena({ sacredVictory: true });
  assert.ok(w.sacredVictory);
  w.sites[0].owner = 0;
  w.sites[1].owner = 0;
  let ev = runCollect(w, 0.1);
  assert.equal(teamHoldingAll(w), 1);
  assert.deepEqual(eventsOf(ev, 'sacredHold').map((e) => e.team), [1]);
  const end = w.sacred.end;
  assert.ok(Math.abs(end - w.time - SACRED_HOLD) < 0.2);
  run(w, 60);
  w.sites[1].owner = 1;
  ev = runCollect(w, 0.1);
  assert.deepEqual(eventsOf(ev, 'sacredBroken').map((e) => e.team), [1]);
  assert.equal(w.sacred, null);
  w.sites[1].owner = 0;
  run(w, SACRED_HOLD - 1);
  assert.equal(w.gameOver, null);
  ev = runCollect(w, 2);
  assert.deepEqual(w.gameOver, { winningTeam: 1, how: 'sacred' });
  assert.deepEqual(eventsOf(ev, 'gameOver'), [{ type: 'gameOver', winningTeam: 1, how: 'sacred' }]);
  const snap = w.getSnapshot();
  assert.deepEqual(snap.gameOver, { winningTeam: 1, how: 'sacred' });
});

test('without the lobby toggle, or during the Decade of Peace, holding every site wins nothing', () => {
  const plain = arena();
  plain.sites.forEach((s) => (s.owner = 0));
  run(plain, 1);
  assert.equal(plain.sacred, null);
  const peace = arena({ sacredVictory: true, peaceMinutes: 30 });
  peace.sites.forEach((s) => (s.owner = 0));
  run(peace, 1);
  assert.equal(peace.sacred, null);
  peace.peaceEnd = peace.time;
  run(peace, 0.2);
  assert.ok(peace.sacred && peace.sacred.team === 1, 'the clock starts once the peace is over');
});

test('snapshot rows and the Sacred Victory countdown travel through the delta codec', () => {
  const w = arena({ sacredVictory: true });
  spawn(w, 0, 'worshipper', SITES[0].x + 1, SITES[0].y);
  run(w, 1);
  const a = w.getSnapshot();
  assert.deepEqual(a.sites[1], { x: SITES[1].x, y: SITES[1].y, o: -1 });
  assert.equal(a.sites[0].c, 0);
  assert.ok(a.sites[0].p > 0);
  assert.equal(a.sacred, null);
  w.sites.forEach((s) => (s.owner = 0));
  w.tick();
  const b = w.getSnapshot();
  assert.deepEqual(b.sacred, { tm: 1, end: w.sacred.end });
  const got = apply(a, JSON.parse(JSON.stringify(encode(a, b))));
  assert.deepEqual(got.sites, b.sites);
  assert.deepEqual(got.sacred, b.sacred);
  assert.deepEqual(got.events, b.events);
});

test('mapgen: 3 to 5 sites on open, reachable ground, away from starts, placed as whole symmetry orbits', () => {
  for (const mapSize of ['small', 'medium']) {
    for (const [pc, teams] of [[2, null], [3, null], [4, null], [4, [1, 1, 2, 2]], [3, [1, 1, 2]]]) {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const m = generateMap({ seed, mapSize, playerCount: pc, teams });
        const n = m.width;
        assert.ok(m.sacred.length >= 3 && m.sacred.length <= 5, `${mapSize} ${pc} ${seed}: ${m.sacred.length} sites`);
        const key = (x, y) => `${x},${y}`;
        const set = new Set(m.sacred.map((s) => key(s.x, s.y)));
        const order = m.meta.symmetry;
        for (const s of m.sacred) {
          // Rotational images are sites too, so every start is as near to the sites as every other.
          assert.ok(set.has(key(n - s.x, n - s.y)), `180° image of ${key(s.x, s.y)}`);
          if (order === 4) assert.ok(set.has(key(n - s.y, s.x)), `90° image of ${key(s.x, s.y)}`);
          for (const st of m.starts) {
            const dx = Math.max(st.x - s.x, 0, s.x - (st.x + 4));
            const dy = Math.max(st.y - s.y, 0, s.y - (st.y + 4));
            assert.ok(Math.hypot(dx, dy) >= SITE_MIN_START_DIST, 'too close to a start');
          }
          for (let y = Math.floor(s.y - SITE_CLEAR); y <= Math.floor(s.y + SITE_CLEAR); y++) {
            for (let x = Math.floor(s.x - SITE_CLEAR); x <= Math.floor(s.x + SITE_CLEAR); x++) {
              if (Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y) > SITE_CLEAR) continue;
              assert.ok([0, 1, 5].includes(m.terrain[y * n + x]), `site ground blocked at ${x},${y}`);
            }
          }
        }
      }
    }
  }
});
