// Walls in the 3D view (DESIGN 8): wall segments run on to the segments beside them and to a
// tower that joined the wall, a wooden wall turns to stone in place, the line being dragged has
// a ghost, and a long wall stays cheap (two draws a segment, slim overlays). Real World and
// ViewState, stub WebGL (Node has no GL).
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const VENDOR = new URL('../../vendor/three/', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(`${VENDOR}three.module.js`)}, shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: ${JSON.stringify(VENDOR + 'addons/')} + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`)}`);

const { GameRenderer } = await import('../../src/render/game-renderer.js');
const { createWorld } = await import('../../src/sim/world.js');
const { ViewState } = await import('../../src/game/view-state.js');
const { checkWallLine } = await import('../../src/game/placement.js');
const { WALL_N, WALL_E, WALL_S, WALL_W, WALL_TOWER_SHIFT } = await import('../../src/data/walls.js');
const { PLAYER_COLORS, DT, MAX_WALL_LINE } = await import('../../src/config.js');

const W = 1280;
const H = 720;

function stubWebgl() {
  return {
    shadowMap: { enabled: false, type: 0, autoUpdate: true },
    info: { render: { calls: 0, triangles: 0 } },
    renderLists: { dispose() {} },
    setClearColor() {},
    setPixelRatio() {},
    setSize() {},
    render() {},
    compile() {},
    dispose() {},
  };
}

function makeMatch({ quality = 'medium', pantheons = ['greek', 'norse'] } = {}) {
  const setup = {
    version: '0.1.0',
    seed: 4242,
    mapSize: 'small',
    players: pantheons.map((p, i) => ({ index: i, name: `P${i}`, team: i + 1, pantheon: p, color: PLAYER_COLORS[i], kind: 'human', difficulty: 'normal' })),
  };
  const world = createWorld(setup);
  const vs = new ViewState({ setup, mapData: world.mapData, myIndex: 0, interpDelayMs: 50 });
  let now = 1000;
  vs.pushSnapshot(world.getSnapshot(), now);
  const canvas = { clientWidth: W, clientHeight: H, width: W, height: H, style: {} };
  const r = new GameRenderer(canvas, { viewState: vs, setup, quality, webgl: stubWebgl() });
  let acc = 0;
  const step = (seconds, fps = 30) => {
    const n = Math.max(1, Math.round(seconds * fps));
    for (let i = 0; i < n; i++) {
      now += 1000 / fps;
      acc += 1000 / fps;
      while (acc >= DT * 1000) {
        acc -= DT * 1000;
        world.tick();
        vs.pushSnapshot(world.getSnapshot(), now);
      }
      vs.update(now);
      r.update(1 / fps);
    }
  };
  return { world, vs, r, step };
}

/** A free rectangle of w×h tiles near the local town center: { x, y } of its top-left tile. */
function clearSpot(world, w, h) {
  const tc = world.buildingList.find((b) => b.owner === 0 && b.type === 'town_center');
  const m = world.map;
  const free = (x, y) => m.inBounds(x, y) && m.isPassable(x, y) && !m.occ[y * m.width + x];
  for (let dy = -9; dy <= 9; dy++) {
    for (let dx = -12; dx <= 12; dx++) {
      const x = tc.tx + dx;
      const y = tc.ty + dy;
      let ok = true;
      for (let j = 0; j < h && ok; j++) for (let i = 0; i < w && ok; i++) ok = free(x + i, y + j);
      if (ok && Math.hypot(dx, dy) > 4) return { x, y };
    }
  }
  throw new Error('no clear spot near the town center');
}

const wall = (world, owner, type, x, y) => world.createBuilding(owner, type, x, y, true, true);
const viewAt = (r, x, y) => [...r.buildings.values()].find((b) => b.tx === x && b.ty === y);
const meshesOf = (obj) => {
  let n = 0;
  obj.traverse((o) => {
    if (o.isMesh) n++;
  });
  return n;
};

test('wall segments run on to the segments beside them and to a tower in the line', () => {
  const { world, r, step } = makeMatch();
  const { x, y } = clearSpot(world, 12, 3);
  for (let i = 0; i < 4; i++) wall(world, 0, 'wooden_wall', x + i, y);
  wall(world, 0, 'tower', x + 4, y); // 2×2: the wall row meets its top row
  for (let i = 6; i < 10; i++) wall(world, 0, 'wooden_wall', x + i, y);
  wall(world, 0, 'wooden_wall', x + 8, y + 1); // a branch going south
  step(0.3);
  assert.equal(viewAt(r, x, y).mask, WALL_E, 'the end of a run reaches the next segment only');
  assert.equal(viewAt(r, x + 1, y).mask, WALL_E | WALL_W);
  assert.equal(viewAt(r, x + 3, y).mask, WALL_W | WALL_E | (WALL_E << WALL_TOWER_SHIFT), 'it reaches into the tower, which sits well inside its footprint');
  assert.equal(viewAt(r, x + 6, y).mask, WALL_W | (WALL_W << WALL_TOWER_SHIFT) | WALL_E);
  assert.equal(viewAt(r, x + 8, y).mask, WALL_W | WALL_E | WALL_S, 'a T');
  assert.equal(viewAt(r, x + 8, y + 1).mask, WALL_N, 'the branch ends');
  assert.equal(viewAt(r, x + 9, y).mask, WALL_W);
  // the tower is the tower it was: no wall arms on it, nothing about its look changes
  const tower = viewAt(r, x + 4, y);
  assert.equal(tower.def.id, 'tower');
  assert.equal(tower.mask, 0);
  r.dispose();
});

test('walls of other players, and walls that are apart, are not joined', () => {
  const { world, r, step } = makeMatch();
  const { x, y } = clearSpot(world, 8, 2);
  wall(world, 0, 'wooden_wall', x, y);
  wall(world, 0, 'wooden_wall', x + 2, y); // a tile apart
  wall(world, 1, 'wooden_wall', x + 1, y); // an enemy's, in between
  r.vs.revealAll = true; // (the enemy's wall would be fogged otherwise)
  step(0.3);
  assert.equal(viewAt(r, x, y).mask, 0, 'a lone post');
  assert.equal(viewAt(r, x + 2, y).mask, 0);
  assert.equal(viewAt(r, x + 1, y).mask, 0, 'it does not reach for a wall of another player either');
  r.dispose();
});

test('a wall segment that falls: its neighbours stop reaching for it at once', () => {
  const { world, vs, r, step } = makeMatch();
  const { x, y } = clearSpot(world, 6, 2);
  const run = [];
  for (let i = 0; i < 5; i++) run.push(wall(world, 0, 'stone_wall', x + i, y));
  step(0.3);
  assert.equal(viewAt(r, x + 1, y).mask, WALL_E | WALL_W);
  const dead = run[2];
  world.killEntity(dead, null);
  step(0.3);
  assert.ok(!r.buildings.has(dead.id), 'its view is gone');
  assert.ok(!vs.entities.has(dead.id));
  assert.equal(viewAt(r, x + 1, y).mask, WALL_W, 'the gap is a gap');
  assert.equal(viewAt(r, x + 3, y).mask, WALL_E);
  assert.equal(viewAt(r, x, y).mask, WALL_E, 'the rest is untouched');
  r.dispose();
});

test('a wooden wall upgraded to stone is the same building with a stone model, still joined', () => {
  const { world, r, step } = makeMatch();
  const { x, y } = clearSpot(world, 6, 2);
  const run = [];
  for (let i = 0; i < 4; i++) run.push(wall(world, 0, 'wooden_wall', x + i, y));
  step(0.3);
  const before = viewAt(r, x + 1, y);
  const id = before.id;
  const oldRoot = before.model.root;
  assert.equal(before.model.type, 'wooden_wall');
  world.changeBuildingType(run[1], 'stone_wall');
  step(0.3);
  const after = viewAt(r, x + 1, y);
  assert.equal(after.id, id, 'the same building');
  assert.strictEqual(after, before, 'the same view, with a new model');
  assert.equal(after.def.id, 'stone_wall');
  assert.equal(after.model.type, 'stone_wall');
  assert.notStrictEqual(after.model.root, oldRoot);
  assert.equal(oldRoot.parent, null, 'the wooden model left the scene');
  assert.equal(after.model.root.parent, r.entityRoot);
  assert.equal(after.mask, WALL_E | WALL_W, 'the stone segment runs on to both neighbours');
  assert.ok(after.height > 0.8 && after.height < 2);
  // a wooden and a stone segment of one wall are joined too
  assert.equal(viewAt(r, x, y).mask, WALL_E);
  assert.equal(viewAt(r, x + 2, y).mask, WALL_E | WALL_W);
  r.dispose();
});

test('a long wall stays cheap: two meshes a segment, no yard worn into the grass, no fires', () => {
  const { world, r, step } = makeMatch();
  const { x, y } = clearSpot(world, 12, 5);
  step(0.2); // the town center's yard first
  let yards = 0;
  const paint = r.terrain.paintYard;
  r.terrain.paintYard = (...a) => {
    yards++;
    return paint.apply(r.terrain, a);
  };
  const run = [];
  for (let i = 0; i < 12; i++) run.push(wall(world, 0, i % 2 ? 'stone_wall' : 'wooden_wall', x + i, y));
  for (const w of run) w.hp = w.maxHp * 0.2; // badly hurt: a building would burn
  step(0.3);
  assert.equal(r.buildings.size >= 12, true);
  for (const w of run) {
    const v = r.buildings.get(w.id);
    assert.ok(v, 'every segment has a view');
    assert.equal(meshesOf(v.model.root), 2, `${w.type}: body and team color`);
  }
  assert.equal(yards, 0, 'a fence does not wear the meadow bare');
  assert.equal(r.fires.fires, 0, 'damaged wall segments do not burn');
  const house = wall(world, 0, 'house', x, y + 4);
  step(0.3);
  assert.ok(r.buildings.has(house.id));
  assert.equal(yards, 1, 'a house still does');
  r.dispose();
});

test('selected wall segments get slim rings but no bar each; hurt or hovered ones get a bar', () => {
  const { world, r, step } = makeMatch();
  const { x, y } = clearSpot(world, 12, 2);
  const run = [];
  for (let i = 0; i < 12; i++) run.push(wall(world, 0, 'wooden_wall', x + i, y));
  step(0.3);
  const ids = run.map((w) => w.id);
  r.setSelection(ids);
  step(0.1);
  const onScreen = [...r.buildings.values()].filter((b) => ids.includes(b.id)).length;
  assert.equal(onScreen, 12);
  assert.ok(r.rings.mesh.count >= 12, `a ring each (${r.rings.mesh.count})`);
  assert.equal(r.bars.mesh.count, 0, 'twelve selected, unhurt segments: no bars');
  run[3].hp = run[3].maxHp * 0.5;
  step(0.1);
  assert.equal(r.bars.mesh.count, 1, 'the hurt one shows its health');
  r.setSelection([]);
  r.setHover(run[5].id);
  step(0.1);
  assert.equal(r.bars.mesh.count, 2, 'and the one under the cursor');
  r.dispose();
});

test('the wall line ghost: a segment per tile to build, red where blocked, nothing on a wall that stands', () => {
  const { world, r, step } = makeMatch();
  const { x, y } = clearSpot(world, 12, 2);
  for (let i = 0; i < 3; i++) wall(world, 0, 'wooden_wall', x + i, y); // standing
  step(0.3);
  const tiles = [
    { tx: x + 1, ty: y, state: 'held' },
    { tx: x + 2, ty: y, state: 'held' },
    { tx: x + 3, ty: y, state: 'build' },
    { tx: x + 4, ty: y, state: 'build' },
    { tx: x + 5, ty: y, state: 'blocked' },
    { tx: x + 6, ty: y, state: 'build' },
  ];
  r.showWallLine('wooden_wall', tiles);
  const line = r.placement.line;
  const shown = line.ghosts.filter((g) => g.model.root.visible);
  assert.equal(shown.length, 4, 'build and blocked tiles, not the held ones');
  assert.equal(line.ghosts[0].mask & WALL_W, WALL_W, 'the first new segment runs on to the wall that stands');
  assert.equal(line.ghosts[0].mask & WALL_E, WALL_E);
  assert.equal(line.ghosts[1].mask, WALL_W, 'the one before the blocked tile ends: nothing will be there');
  assert.equal(line.ghosts[3].mask, 0, 'a lone segment beyond the blocked tile');
  assert.deepEqual(line.ghosts.map((g) => g.valid), [true, true, false, true], 'green, green, red, green');
  assert.ok(r.placement.lineGrid.mesh.visible);
  assert.equal(r.placement.lineGrid.n, 4);
  // the same line again changes nothing; a shorter one hides the extra ghosts
  r.showWallLine('wooden_wall', tiles.slice(0, 4));
  assert.equal(line.ghosts.filter((g) => g.model.root.visible).length, 2);
  assert.equal(r.placement.lineGrid.n, 2);
  // the single-building ghost and the line never show together
  r.showPlacement('barracks', x, y + 4, true);
  assert.equal(line.ghosts.filter((g) => g.model.root.visible).length, 0);
  assert.equal(r.placement.lineGrid.mesh.visible, false);
  r.showWallLine('wooden_wall', tiles);
  assert.ok(!r.placement.ghost.model.root.visible && !r.placement.grid.mesh.visible);
  r.hidePlacement();
  assert.equal(line.ghosts.filter((g) => g.model.root.visible).length, 0);
  assert.equal(r.placement.lineGrid.mesh.visible, false);
  // another wall type starts afresh
  r.showWallLine('stone_wall', tiles.slice(2, 4));
  assert.equal(line.type, 'stone_wall');
  assert.equal(line.ghosts.length, 2);
  assert.ok(line.ghosts.every((g) => g.model.type === 'stone_wall'));
  r.showWallLine('barracks', tiles); // not a wall: hidden
  assert.equal(line.ghosts.filter((g) => g.model.root.visible).length, 0);
  r.dispose();
});

test('the wall line ghost follows checkWallLine, even at the longest line', () => {
  const { world, vs, r, step } = makeMatch();
  const { x, y } = clearSpot(world, 12, 2);
  step(0.2);
  const line = checkWallLine(vs, 0, 'wooden_wall', x, y, x + 11, y);
  assert.ok(line.build >= 1);
  r.showWallLine('wooden_wall', line.tiles);
  const build = line.tiles.filter((t) => t.state !== 'held').length;
  assert.equal(r.placement.lineGrid.n, build);
  assert.equal(r.placement.line.ghosts.filter((g) => g.model.root.visible).length, build);
  // the grid has room for the longest line the sim accepts
  const long = [];
  for (let i = 0; i < MAX_WALL_LINE; i++) long.push({ tx: i, ty: 3, state: 'build' });
  r.showWallLine('wooden_wall', long);
  assert.equal(r.placement.lineGrid.n, MAX_WALL_LINE);
  assert.equal(r.placement.line.ghosts.filter((g) => g.model.root.visible).length, MAX_WALL_LINE);
  r.hidePlacement();
  r.dispose();
  assert.equal(r.placement.line.ghosts.length, 0, 'the ghosts went with the renderer');
});
