import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateMap, mapHash, validateMap, START_MINE_GAP, CAMP_MIN_START_DIST } from '../../src/sim/mapgen.js';
import { TERRAIN, TREE_WOOD, GOLD_MINE_AMOUNT, EXPANSION_MINE_AMOUNT, MAP_SIZES } from '../../src/config.js';

const { GRASS, DIRT, WATER, FOREST, SAND } = TERRAIN;
const open = (t) => t === GRASS || t === DIRT || t === SAND;
const SIZES = ['small', 'medium'];
const COUNTS = [2, 3, 4];
const SEEDS = [1, 42, 9001, 'mythic'];

// Generate each configuration once and share it between tests.
const cache = new Map();
function map(seed, mapSize, playerCount) {
  const key = `${seed}|${mapSize}|${playerCount}`;
  if (!cache.has(key)) cache.set(key, generateMap({ seed, mapSize, playerCount }));
  return cache.get(key);
}
function* allMaps() {
  for (const size of SIZES) for (const pc of COUNTS) for (const seed of SEEDS) yield { size, pc, seed, m: map(seed, size, pc) };
}

const gap = (ax, ay, as, bx, by, bs) => Math.max(0, bx - (ax + as), ax - (bx + bs), by - (ay + as), ay - (by + bs));
const rectDist = (px, py, x, y, s) => Math.hypot(Math.max(x - px, 0, px - (x + s)), Math.max(y - py, 0, py - (y + s)));
const ring = (n, x, y, s) => {
  const out = [];
  for (let ty = y - 1; ty <= y + s; ty++) {
    for (let tx = x - 1; tx <= x + s; tx++) {
      if (tx >= x && tx < x + s && ty >= y && ty < y + s) continue;
      out.push([tx, ty]);
    }
  }
  return out;
};

test('same input gives identical maps and hash; different seeds differ', () => {
  for (const [size, pc] of [['small', 2], ['medium', 4], ['medium', 3]]) {
    const a = generateMap({ seed: 777, mapSize: size, playerCount: pc });
    const b = generateMap({ seed: 777, mapSize: size, playerCount: pc });
    assert.deepEqual(a.terrain, b.terrain);
    assert.deepEqual(a.wood, b.wood);
    assert.deepEqual(a.heights, b.heights);
    assert.deepEqual(a.starts, b.starts);
    assert.deepEqual(a.mines, b.mines);
    assert.deepEqual(a.camps, b.camps);
    assert.deepEqual(a.decor, b.decor);
    assert.equal(mapHash(a), mapHash(b));
    assert.match(mapHash(a), /^[0-9a-f]{8}$/);
    const c = generateMap({ seed: 778, mapSize: size, playerCount: pc });
    assert.notEqual(mapHash(a), mapHash(c));
  }
  // string seeds work and differ from each other
  assert.notEqual(mapHash(map('mythic', 'small', 2)), mapHash(map('war', 'small', 2)));
});

test('mapHash covers terrain, wood, starts, mines and camps', () => {
  const m = map(1, 'small', 2);
  const h = mapHash(m);
  const clone = { ...m, terrain: m.terrain.slice(), wood: m.wood.slice(), starts: m.starts.map((s) => ({ ...s })), mines: m.mines.map((x) => ({ ...x })), camps: m.camps.map((c) => ({ ...c })) };
  assert.equal(mapHash(clone), h);
  clone.terrain[500] = clone.terrain[500] === GRASS ? DIRT : GRASS;
  assert.notEqual(mapHash(clone), h);
  clone.terrain[500] = m.terrain[500];
  clone.mines[0].amount--;
  assert.notEqual(mapHash(clone), h);
  clone.mines[0].amount++;
  clone.camps[0].level = clone.camps[0].level === 1 ? 2 : 1;
  assert.notEqual(mapHash(clone), h);
});

test('every size and player count produces a valid map', () => {
  for (const { size, pc, seed, m } of allMaps()) {
    const n = MAP_SIZES[size];
    const where = `${size} p${pc} seed ${seed}`;
    assert.equal(m.width, n, where);
    assert.equal(m.height, n, where);
    assert.equal(m.seed, seed);
    assert.ok(m.terrain instanceof Uint8Array && m.terrain.length === n * n, where);
    assert.ok(m.wood instanceof Uint16Array && m.wood.length === n * n, where);
    assert.ok(m.heights instanceof Float32Array && m.heights.length === (n + 1) * (n + 1), where);
    assert.equal(m.starts.length, pc, where);
    assert.deepEqual(validateMap(m), [], where);
    const expansions = m.mines.length - pc;
    assert.ok(expansions >= pc && expansions <= 2 * pc, `${where}: ${expansions} expansions`);
  }
});

test('validateMap reports broken maps', () => {
  const m = map(42, 'small', 2);
  const broken = { ...m, terrain: m.terrain.slice(), wood: m.wood.slice() };
  const n = m.width;
  const s = m.starts[0];
  const i = (s.y + 5) * n + s.x + 5; // inside the start area
  broken.terrain[i] = FOREST;
  broken.wood[i] = TREE_WOOD;
  assert.ok(validateMap(broken).some((e) => e.includes('area blocked')));
  const far = { ...m, camps: [...m.camps, { x: s.x + 8, y: s.y + 8, level: 1 }] };
  assert.ok(validateMap(far).some((e) => e.includes('too close to start')));
  const moved = { ...m, mines: m.mines.map((x, k) => (k === 0 ? { ...x, tx: x.tx + 1 } : x)) };
  assert.ok(validateMap(moved).some((e) => e.includes('gap')));
});

test('start positions follow the corner order for each player count', () => {
  for (const size of SIZES) {
    const n = MAP_SIZES[size];
    const corner = (s) => `${s.x + 2 < n / 2 ? 'L' : 'R'}${s.y + 2 < n / 2 ? 'T' : 'B'}`;
    assert.deepEqual(map(1, size, 2).starts.map(corner), ['LT', 'RB']);
    assert.deepEqual(map(1, size, 3).starts.map(corner), ['LT', 'RB', 'RT']);
    assert.deepEqual(map(1, size, 4).starts.map(corner), ['LT', 'LB', 'RT', 'RB']);
  }
});

test('start mines sit exactly 3 tiles from the town center, facing away from the center', () => {
  for (const { m, pc, size, seed } of allMaps()) {
    const n = m.width;
    m.starts.forEach((s, p) => {
      const mine = m.mines[p];
      assert.equal(mine.amount, GOLD_MINE_AMOUNT);
      assert.equal(gap(s.x, s.y, 4, mine.tx, mine.ty, 3), START_MINE_GAP, `${size} p${pc} ${seed} player ${p}`);
      const cx = s.x + 2;
      const cy = s.y + 2;
      const dot = (mine.tx + 1.5 - cx) * (n / 2 - cx) + (mine.ty + 1.5 - cy) * (n / 2 - cy);
      assert.ok(dot < 0, 'start mine should be on the far side from the map center');
      // every other mine keeps the town-center placement rule (>= 3 tiles)
      m.mines.forEach((o, i) => {
        if (i !== p) assert.ok(gap(s.x, s.y, 4, o.tx, o.ty, 3) >= 10, `mine ${i} crowds start ${p}`);
      });
    });
    for (let i = pc; i < m.mines.length; i++) assert.equal(m.mines[i].amount, EXPANSION_MINE_AMOUNT);
  }
});

test('start areas are open and buildable within radius 7 (except the start mine)', () => {
  for (const { m } of allMaps()) {
    const n = m.width;
    m.starts.forEach((s, p) => {
      const cx = s.x + 2;
      const cy = s.y + 2;
      const mine = m.mines[p];
      for (let y = Math.floor(cy - 8); y <= cy + 8; y++) {
        for (let x = Math.floor(cx - 8); x <= cx + 8; x++) {
          if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > 7) continue;
          const inMine = x >= mine.tx && x < mine.tx + 3 && y >= mine.ty && y < mine.ty + 3;
          if (inMine) continue;
          assert.ok(x >= 0 && y >= 0 && x < n && y < n);
          const t = m.terrain[y * n + x];
          assert.ok(open(t) && t !== FOREST, `start ${p} tile ${x},${y} is ${t}`);
        }
      }
    });
  }
});

test('a forest edge is 6-10 tiles from each town center, with equal wood near every start', () => {
  for (const { m, size, pc, seed } of allMaps()) {
    const n = m.width;
    const woods = m.starts.map((s) => {
      let nearest = Infinity;
      let wood = 0;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (m.terrain[y * n + x] !== FOREST) continue;
          nearest = Math.min(nearest, rectDist(x + 0.5, y + 0.5, s.x, s.y, 4));
          if (Math.hypot(x + 0.5 - s.x - 2, y + 0.5 - s.y - 2) <= 12) wood += m.wood[y * n + x];
        }
      }
      assert.ok(nearest >= 6 && nearest <= 10, `${size} p${pc} ${seed}: forest edge ${nearest}`);
      // the wood line is on the far side of the base (away from the map center)
      let behind = 0;
      const cx = s.x + 2;
      const cy = s.y + 2;
      for (let y = Math.floor(cy - 12); y <= cy + 12; y++) {
        for (let x = Math.floor(cx - 12); x <= cx + 12; x++) {
          if (x < 0 || y < 0 || x >= n || y >= n || m.terrain[y * n + x] !== FOREST) continue;
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          if (Math.hypot(dx, dy) <= 12 && dx * (n / 2 - cx) + dy * (n / 2 - cy) < 0) behind++;
        }
      }
      assert.ok(behind >= 30, `only ${behind} trees behind start`);
      return wood;
    });
    assert.ok(woods[0] >= 30 * TREE_WOOD, 'plenty of wood within 12 tiles');
    for (const w of woods) assert.equal(w, woods[0], 'every start has the same wood nearby');
  }
});

test('each start is equally far from its nearest expansion', () => {
  for (const { m } of allMaps()) {
    const pc = m.starts.length;
    const d = m.starts.map((s) => {
      let best = Infinity;
      for (let i = pc; i < m.mines.length; i++) best = Math.min(best, Math.hypot(m.mines[i].tx + 1.5 - s.x - 2, m.mines[i].ty + 1.5 - s.y - 2));
      return best;
    });
    for (const v of d) assert.ok(Math.abs(v - d[0]) < 1e-9 && v > 15 && v < 50, `nearest expansion ${d}`);
  }
});

test('mines do not overlap anything and stand on open ground with an open ring', () => {
  for (const { m } of allMaps()) {
    const n = m.width;
    const used = new Uint8Array(n * n);
    for (const s of m.starts) for (let y = s.y; y < s.y + 4; y++) for (let x = s.x; x < s.x + 4; x++) used[y * n + x] = 1;
    for (const mine of m.mines) {
      for (let y = mine.ty; y < mine.ty + 3; y++) {
        for (let x = mine.tx; x < mine.tx + 3; x++) {
          assert.equal(used[y * n + x], 0, 'mine overlaps another footprint');
          assert.ok(open(m.terrain[y * n + x]), 'mine on blocked terrain');
          used[y * n + x] = 1;
        }
      }
      for (const [x, y] of ring(n, mine.tx, mine.ty, 3)) assert.ok(open(m.terrain[y * n + x]), 'mine ring blocked');
    }
    for (const c of m.camps) assert.equal(used[Math.floor(c.y) * n + Math.floor(c.x)], 0, 'camp inside a footprint');
  }
});

test('camps: levels 1-3, far from starts, every expansion guarded at 4-6 tiles', () => {
  for (const { m } of allMaps()) {
    const pc = m.starts.length;
    assert.ok(m.camps.some((c) => c.level === 1), 'some level-1 route camps');
    for (const c of m.camps) {
      assert.ok([1, 2, 3].includes(c.level));
      for (const s of m.starts) {
        assert.ok(rectDist(c.x, c.y, s.x, s.y, 4) >= CAMP_MIN_START_DIST, 'camp too close to a start');
        assert.ok(Math.hypot(c.x - s.x - 2, c.y - s.y - 2) >= 18);
      }
    }
    for (let i = pc; i < m.mines.length; i++) {
      const mine = m.mines[i];
      const guard = m.camps.find((c) => {
        const d = Math.hypot(c.x - mine.tx - 1.5, c.y - mine.ty - 1.5);
        return c.level >= 2 && d >= 4 && d <= 6;
      });
      assert.ok(guard, `expansion mine ${i} unguarded`);
    }
  }
});

test('starts, mine rings and camps are all mutually reachable on foot', () => {
  for (const { m, size, pc, seed } of allMaps()) {
    const n = m.width;
    const blocked = new Uint8Array(n * n);
    for (const s of m.starts) for (let y = s.y; y < s.y + 4; y++) for (let x = s.x; x < s.x + 4; x++) blocked[y * n + x] = 1;
    for (const mine of m.mines) for (let y = mine.ty; y < mine.ty + 3; y++) for (let x = mine.tx; x < mine.tx + 3; x++) blocked[y * n + x] = 1;
    const walk = (i) => open(m.terrain[i]) && !blocked[i];
    const seen = new Uint8Array(n * n);
    const s0 = m.starts[0];
    const start = (s0.y + 4) * n + s0.x + 4; // diagonal neighbour of the footprint
    const queue = [start];
    seen[start] = 1;
    while (queue.length) {
      const i = queue.pop();
      const x = i % n;
      const y = (i - x) / n;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const tx = x + dx;
        const ty = y + dy;
        const j = ty * n + tx;
        if (tx < 0 || ty < 0 || tx >= n || ty >= n || seen[j] || !walk(j)) continue;
        seen[j] = 1;
        queue.push(j);
      }
    }
    const where = `${size} p${pc} ${seed}`;
    for (const s of m.starts) for (const [x, y] of ring(n, s.x, s.y, 4)) assert.ok(seen[y * n + x], `${where}: start ring ${x},${y}`);
    for (const mine of m.mines) for (const [x, y] of ring(n, mine.tx, mine.ty, 3)) assert.ok(seen[y * n + x], `${where}: mine ring ${x},${y}`);
    for (const c of m.camps) assert.ok(seen[Math.floor(c.y) * n + Math.floor(c.x)], `${where}: camp ${c.x},${c.y}`);
  }
});

test('wood matches forest; forest border ring; lakes have shores', () => {
  for (const { m } of allMaps()) {
    const n = m.width;
    let water = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const t = m.terrain[i];
        assert.equal(m.wood[i], t === FOREST ? TREE_WOOD : 0);
        if (Math.min(x, y, n - 1 - x, n - 1 - y) < 3) assert.equal(t, FOREST, `border ${x},${y}`);
        if (t === WATER) water++;
        assert.ok(t >= 0 && t <= 5);
      }
    }
    assert.ok(water > 0, 'every map has water');
    let sandy = 0;
    for (let i = 0; i < n * n; i++) if (m.terrain[i] === SAND) sandy++;
    assert.ok(sandy > 0, 'lakes have sandy shores');
  }
});

test('terrain is rotationally symmetric (fair) around the map center', () => {
  for (const { m, pc } of allMaps()) {
    const n = m.width;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const t = m.terrain[y * n + x];
        assert.equal(m.terrain[(n - 1 - y) * n + (n - 1 - x)], t);
        if (pc >= 3) assert.equal(m.terrain[x * n + (n - 1 - y)], t);
      }
    }
  }
});

test('heights: gentle land in 0..0.8, water at -0.6, flat around starts', () => {
  for (const { m } of allMaps()) {
    const n = m.width;
    const V = n + 1;
    for (const h of m.heights) assert.ok(h >= -0.6 - 1e-6 && h <= 0.8 + 1e-6);
    for (let y = 1; y < n; y++) {
      for (let x = 1; x < n; x++) {
        const tiles = [m.terrain[(y - 1) * n + x - 1], m.terrain[(y - 1) * n + x], m.terrain[y * n + x - 1], m.terrain[y * n + x]];
        const h = m.heights[y * V + x];
        if (tiles.every((t) => t === WATER)) assert.ok(Math.abs(h + 0.6) < 1e-6);
        if (tiles.every((t) => t !== WATER)) assert.ok(h >= -0.06, 'land stays above water level');
      }
    }
    for (const s of m.starts) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let y = s.y - 4; y <= s.y + 8; y++) {
        for (let x = s.x - 4; x <= s.x + 8; x++) {
          const h = m.heights[y * V + x];
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
      }
      assert.ok(hi - lo < 0.05, `start area not flat: ${hi - lo}`);
    }
  }
});

test('decor: a few hundred props on open tiles, away from starts and mines', () => {
  const kinds = new Set(['rock', 'bush', 'flowers', 'ruin', 'stump', 'grass']);
  for (const { m } of allMaps()) {
    const n = m.width;
    assert.ok(m.decor.length >= 150 && m.decor.length <= 900, `decor count ${m.decor.length}`);
    for (const d of m.decor) {
      assert.ok(kinds.has(d.kind));
      assert.ok(Number.isFinite(d.rot) && d.scale > 0);
      assert.ok(open(m.terrain[Math.floor(d.y) * n + Math.floor(d.x)]), 'decor on blocked tile');
      for (const s of m.starts) assert.ok(Math.hypot(d.x - s.x - 2, d.y - s.y - 2) > 9, 'decor in a start base');
      for (const mine of m.mines) assert.ok(Math.hypot(d.x - mine.tx - 1.5, d.y - mine.ty - 1.5) > 2.6, 'decor on a mine');
    }
  }
});

test('generates a medium map in under 150 ms', () => {
  generateMap({ seed: 5, mapSize: 'small', playerCount: 2 }); // load + warm the module once
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    generateMap({ seed: 1000 + i, mapSize: 'medium', playerCount: 4 });
    best = Math.min(best, performance.now() - t0);
  }
  assert.ok(best < 150, `medium map took ${best.toFixed(1)} ms`);
});

test('deterministic section uses only exactly-rounded Math (no transcendental functions)', () => {
  const src = readFileSync(fileURLToPath(new URL('../../src/sim/mapgen.js', import.meta.url)), 'utf8');
  const marker = src.indexOf('// ==== RENDER-ONLY');
  assert.ok(marker > 0, 'render-only marker present');
  const code = src.slice(0, marker).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const forbidden = code.match(/Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log2|log10|log1p|pow|hypot|cbrt|random)\b|\*\*/g);
  assert.equal(forbidden, null, `forbidden in deterministic code: ${forbidden}`);
  // render-only part may use them, and must come after every deterministic function
  assert.ok(src.indexOf('export function generateMap') < marker);
  assert.ok(src.indexOf('export function mapHash') < marker);
});
