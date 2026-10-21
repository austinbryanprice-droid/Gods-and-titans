// Tests for the ground field (src/render/ground-field.js): the smooth height surface
// that heightAt, the terrain mesh and the water mesh all share. Pure typed arrays.
import test from 'node:test';
import assert from 'node:assert/strict';

const { groundField, GroundField, FIELD_RES, WATER_LEVEL, RISE_MAX, SHORE_MIN, SHORE_MAX } = await import('../../src/render/ground-field.js');
const { TERRAIN } = await import('../../src/config.js');

/** A W×H map of one ground type at one height; edit terrain / heights afterwards. */
function flatMap(W = 24, H = 24, h = 0.3, type = TERRAIN.GRASS) {
  const heights = new Float32Array((W + 1) * (H + 1)).fill(h);
  const terrain = new Uint8Array(W * H).fill(type);
  return { width: W, height: H, heights, terrain, seed: 5, decor: [], mines: [], starts: [] };
}

/** Fill the tile rectangle [x0, x1) × [y0, y1) with a ground type (water gets sunken heights like mapgen's). */
function paint(map, x0, y0, x1, y1, type) {
  const V = map.width + 1;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) map.terrain[y * map.width + x] = type;
  if (type === TERRAIN.WATER) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) map.heights[y * V + x] = -0.6;
}

const lakeMap = () => {
  const m = flatMap();
  paint(m, 8, 8, 16, 16, TERRAIN.WATER);
  return m;
};

test('ground field: one sample grid, the sim heights on open land, a clamped lookup', () => {
  const m = flatMap(20, 16);
  const V = m.width + 1;
  for (let y = 0; y <= m.height; y++) for (let x = 0; x <= m.width; x++) m.heights[y * V + x] = 0.3 + Math.sin(x * 0.7) * 0.15 + Math.cos(y * 0.45) * 0.12;
  const f = groundField(m);
  assert.ok(f instanceof GroundField);
  assert.equal(f.nx, m.width * FIELD_RES + 1);
  assert.equal(f.ny, m.height * FIELD_RES + 1);
  assert.equal(f.hgt.length, f.nx * f.ny);
  // the surface passes through every vertex height (the sim's cosmetic heights are what it is built on)
  for (let y = 0; y <= m.height; y++) for (let x = 0; x <= m.width; x++) assert.ok(Math.abs(f.heightAt(x, y) - m.heights[y * V + x]) < 1e-5, `vertex ${x},${y}`);
  // outside the map the border answers
  assert.equal(f.heightAt(-4, -4), f.heightAt(0, 0));
  assert.equal(f.heightAt(99, 99), f.heightAt(m.width, m.height));
  assert.ok(f.hMin <= f.heightAt(3.3, 4.4) && f.heightAt(3.3, 4.4) <= f.hMax);
});

test('ground field: the slope has no creases across tile edges', () => {
  const m = flatMap(20, 16);
  const V = m.width + 1;
  for (let y = 0; y <= m.height; y++) for (let x = 0; x <= m.width; x++) m.heights[y * V + x] = 0.3 + Math.sin(x * 1.3) * 0.2 + Math.cos(y * 0.9) * 0.15;
  const f = groundField(m);
  const e = 0.02;
  let worst = 0;
  // the slope along x on either side of every interior tile edge: a bilinear patchwork jumps there
  for (let ty = 2; ty < m.height - 2; ty += 3) {
    for (let tx = 2; tx < m.width - 2; tx++) {
      const y = ty + 0.37;
      const left = (f.heightAt(tx, y) - f.heightAt(tx - e, y)) / e;
      const right = (f.heightAt(tx + e, y) - f.heightAt(tx, y)) / e;
      worst = Math.max(worst, Math.abs(right - left));
    }
  }
  // (the field itself is sampled four times per tile, so the slope is piecewise linear on 0.25-tile cells:
  // a crease would be a jump of the order of the slope itself, about 0.3 here)
  assert.ok(worst < 0.12, `largest slope jump ${worst}`);
});

test('ground field: a lake is a rounded basin, the dry land stays at the sim height', () => {
  const m = lakeMap();
  const f = groundField(m);
  // out in the lake the bed is well below the water level, far on the land it is the sim's height
  assert.ok(f.heightAt(12, 12) < WATER_LEVEL - 0.25);
  assert.ok(Math.abs(f.heightAt(1.5, 1.5) - 0.3) < 1e-6);
  assert.ok(Math.abs(f.heightAt(22.5, 3.5) - 0.3) < 1e-6);
  // the waterline lies near the edge of the water tiles, the coast a bit onto the land side
  assert.ok(f.heightAt(8.6, 12) < WATER_LEVEL, 'inside the edge: water');
  assert.ok(f.heightAt(7.2, 12) > WATER_LEVEL, 'a good tenth of a tile out: beach');
  // corners round off: the corner of the water square is land, the middle of its edge is not
  assert.ok(f.heightAt(8.1, 8.1) > WATER_LEVEL, 'corner of the square is rounded off');
  assert.ok(f.heightAt(8.1, 12) < WATER_LEVEL, 'edge midpoint is water');
  // the beach climbs gently: no cliff at the shore
  let steepest = 0;
  for (let x = 5; x < 12; x += 0.05) steepest = Math.max(steepest, Math.abs(f.heightAt(x + 0.05, 12) - f.heightAt(x, 12)) / 0.05);
  assert.ok(steepest < 0.8, `steepest shore slope ${steepest}`);
});

test('ground field: shore distance reads + on land and - in the water, in the range the texture holds', () => {
  const m = lakeMap();
  const f = groundField(m);
  assert.ok(f.sample(f.shore, 12, 12) < -1.2);
  assert.ok(f.sample(f.shore, 1.5, 1.5) > 3);
  assert.ok(f.sample(f.shore, 7, 12) > 0 && f.sample(f.shore, 9, 12) < 0);
  const bytes = f.dataBytes();
  assert.equal(bytes.length, f.nx * f.ny * 4);
  // R encodes the distance between SHORE_MIN and SHORE_MAX
  const k = (Math.round(9.5 * FIELD_RES) + Math.round(12 * FIELD_RES) * f.nx) * 4;
  const back = (bytes[k] / 255) * (SHORE_MAX - SHORE_MIN) + SHORE_MIN;
  assert.ok(back < 0 && back > SHORE_MIN, 'near the shore it is inside the range');
  assert.ok(Math.abs(back - f.sample(f.shore, 9.5, 12)) < 0.05, 'shore distance round-trips through the byte');
  // far out in the lake it saturates at the low end
  const deep = (Math.round(12 * FIELD_RES) + Math.round(12 * FIELD_RES) * f.nx) * 4;
  assert.equal(bytes[deep], 0);
  // a map without water has no shore anywhere near
  const dry = groundField(flatMap());
  assert.ok(dry.sample(dry.shore, 12, 12) > SHORE_MAX);
});

test('ground field: rock tiles rise into outcrops, nothing else does', () => {
  const m = flatMap();
  paint(m, 10, 10, 12, 12, TERRAIN.ROCK); // a 2×2 patch
  paint(m, 4, 4, 5, 8, TERRAIN.ROCK); // a tile-wide strip
  const f = groundField(m);
  const top = f.heightAt(11, 11);
  assert.ok(top - 0.3 > 0.45 && top - 0.3 <= RISE_MAX, `patch stands ${top - 0.3}`);
  assert.ok(f.heightAt(4.5, 6) - 0.3 > 0.35, 'even a thin strip stands well clear');
  assert.ok(f.sample(f.rise, 11, 11) > 0.45 && f.sample(f.rise, 11, 11) <= RISE_MAX);
  // flat tops: the rise is almost constant across the middle of the patch
  assert.ok(Math.abs(f.sample(f.rise, 10.8, 10.8) - f.sample(f.rise, 11.2, 11.2)) < 0.35);
  // nothing rises away from the rock
  for (const [x, y] of [[1, 1], [20, 20], [7.5, 11], [14, 11], [11, 7.2], [11, 14.8]]) assert.equal(f.sample(f.rise, x, y), 0, `${x},${y}`);
  assert.ok(Math.abs(f.heightAt(20, 20) - 0.3) < 1e-6);
  assert.ok(f.hMax >= top - 1e-6);
  // the rise is in the data texture's second channel
  const bytes = f.dataBytes();
  const k = (Math.round(11 * FIELD_RES) + Math.round(11 * FIELD_RES) * f.nx) * 4;
  assert.ok(Math.abs((bytes[k + 1] / 255) * RISE_MAX - f.sample(f.rise, 11, 11)) < 0.01);
});

test('ground field: normals point up and tilt away from the uphill side', () => {
  const m = flatMap(12, 12);
  const V = m.width + 1;
  for (let y = 0; y <= m.height; y++) for (let x = 0; x <= m.width; x++) m.heights[y * V + x] = 0.2 + 0.1 * x; // rises toward +x
  const f = groundField(m);
  const n = [0, 0, 0];
  f.normalAt(6 * FIELD_RES, 6 * FIELD_RES, n);
  assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-6);
  assert.ok(n[1] > 0.9 && n[0] < -0.05 && Math.abs(n[2]) < 1e-6, `normal ${n}`);
  // a flat map's normals are straight up
  const flat = groundField(flatMap(8, 8));
  flat.normalAt(10, 10, n);
  assert.ok(Math.abs(n[0]) < 1e-9 && Math.abs(n[1] - 1) < 1e-9 && Math.abs(n[2]) < 1e-9);
});

test('ground field: bare, partial and foreign maps do not throw', () => {
  assert.equal(groundField(null), null);
  assert.equal(groundField({}), null);
  const bare = groundField({ width: 6, height: 6 }); // no heights, no terrain: flat ground at 0
  assert.equal(bare.heightAt(3.3, 2.2), 0);
  const noTerrain = groundField({ width: 6, height: 6, heights: new Float32Array(49).fill(0.4) });
  assert.ok(Math.abs(noTerrain.heightAt(2, 2) - 0.4) < 1e-6);
});

test('ground field: built once per map, rebuilt when the map changes, the same every time', () => {
  const m = lakeMap();
  const f = groundField(m);
  assert.strictEqual(groundField(m), f);
  // an equal map built separately gives the very same ground
  const g = groundField(lakeMap());
  assert.notStrictEqual(g, f);
  assert.deepEqual(Array.from(g.hgt.slice(0, 500)), Array.from(f.hgt.slice(0, 500)));
  assert.equal(g.heightAt(12.3, 9.7), f.heightAt(12.3, 9.7));
  // swapping the map's terrain (a new array) is noticed
  m.terrain = new Uint8Array(m.terrain);
  assert.notStrictEqual(groundField(m), f);
});

test('ground field: a generated map has a sound field (sizes, ordering of land and water, cost)', async () => {
  const { generateMap } = await import('../../src/sim/mapgen.js');
  const map = generateMap({ seed: 4242, mapSize: 'small', playerCount: 2, teams: [1, 2] });
  const t0 = performance.now();
  const f = groundField(map);
  const ms = performance.now() - t0;
  assert.ok(ms < 3000, `built in ${ms} ms`);
  assert.equal(f.nx, map.width * FIELD_RES + 1);
  let finite = true;
  for (let i = 0; i < f.hgt.length; i++) if (!Number.isFinite(f.hgt[i])) finite = false;
  assert.ok(finite);
  const W = map.width;
  let wet = 0;
  let lowWet = 0;
  let dry = 0;
  let dryHigh = 0;
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const t = map.terrain[ty * W + tx];
      if (t === TERRAIN.WATER) {
        wet++;
        // the middle of a lake tile is under water (the tiles right at the edge belong to the shoreline)
        if (f.heightAt(tx + 0.5, ty + 0.5) < WATER_LEVEL + 0.02) lowWet++;
      } else if (t === TERRAIN.GRASS || t === TERRAIN.DIRT || t === TERRAIN.FOREST) {
        dry++;
        if (f.heightAt(tx + 0.5, ty + 0.5) > WATER_LEVEL) dryHigh++;
      }
    }
  }
  assert.ok(wet > 0 && lowWet / wet > 0.95, `water tiles under water: ${lowWet}/${wet}`);
  assert.ok(dryHigh / dry > 0.995, `dry tiles above water: ${dryHigh}/${dry}`);
});
