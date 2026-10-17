// Integration tests for GameRenderer (src/render/game-renderer.js) driven by a
// real World and ViewState, drawing through a stub WebGL renderer (Node has no
// GL): it builds the scene, starts on the local town center, creates views
// only for what the local player may see, picks / box-selects / projects, turns
// view-state events into VFX, keeps update() cheap with hundreds of units, and
// dispose() leaves an empty scene.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Map the browser import map ('three', 'three/addons/…') onto the vendored copy.
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
const { PLAYER_COLORS, DT } = await import('../../src/config.js');

const W = 1280;
const H = 720;

function stubWebgl() {
  return {
    shadowMap: { enabled: false, type: 0, autoUpdate: true },
    info: { render: { calls: 0, triangles: 0 } },
    renderLists: { dispose() {} },
    renders: 0,
    compiled: 0,
    disposed: false,
    setClearColor() {},
    setPixelRatio(r) {
      this.pixelRatio = r;
    },
    setSize(w, h) {
      this.size = [w, h];
    },
    render(scene, camera) {
      assert.ok(scene.isScene && camera.isCamera);
      this.renders++;
    },
    compile() {
      this.compiled++;
    },
    dispose() {
      this.disposed = true;
    },
  };
}

/** A small 2-player match: world, view state for player 0, renderer, and a frame stepper. */
function makeMatch({ quality = 'medium', myIndex = 0, pantheons = ['greek', 'norse'] } = {}) {
  const setup = {
    version: '0.1.0',
    seed: 4242,
    mapSize: 'small',
    players: pantheons.map((p, i) => ({ index: i, name: `P${i}`, team: i + 1, pantheon: p, color: PLAYER_COLORS[i], kind: 'human', difficulty: 'normal' })),
  };
  const world = createWorld(setup);
  const vs = new ViewState({ setup, mapData: world.mapData, myIndex, interpDelayMs: 50 });
  let now = 1000;
  vs.pushSnapshot(world.getSnapshot(), now);
  const webgl = stubWebgl();
  const canvas = { clientWidth: W, clientHeight: H, width: W, height: H, style: {} };
  const r = new GameRenderer(canvas, { viewState: vs, setup, quality, webgl });
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
  return { setup, world, vs, r, webgl, step };
}

const tcOf = (vs, o) => [...vs.entities.values()].find((e) => e.k === 'b' && e.o === o && e.t === 'town_center');

test('GameRenderer: builds the scene, warms shaders, starts on the local town center', () => {
  const { vs, r, webgl, step } = makeMatch();
  assert.ok(webgl.compiled >= 1, 'shader warm-up ran');
  assert.deepEqual(webgl.size, [W, H]);
  step(0.5);
  const tc = tcOf(vs, 0);
  assert.ok(tc);
  assert.ok(Math.hypot(r.camera.target.x - tc.x, r.camera.target.y - tc.y) < 3, 'camera starts on my town center');
  // own town center, workers and the nearby mine have views; the enemy base is fogged and unseen
  assert.ok(r.buildings.has(tc.id));
  const enemyTc = tcOf(vs, 1);
  assert.ok(!r.buildings.has(enemyTc.id), 'enemy base never seen');
  const mine = [...r.units.values()].filter((v) => v.e.o === 0);
  assert.ok(mine.length >= 3, `${mine.length} own unit views`);
  for (const v of r.units.values()) assert.ok(!v.visible || vs.isEntityVisible(v.e));
  assert.ok(r.mines.size >= 1);
  r.render();
  assert.equal(webgl.renders, 1);
  const s = r.getStats();
  for (const k of ['drawCalls', 'triangles', 'entities', 'updateMs']) assert.ok(Number.isFinite(s[k]), k);
  assert.ok(s.entities >= mine.length);
  r.dispose();
});

test('GameRenderer: projection, picking and box selection agree with the view', () => {
  const { vs, r, step } = makeMatch();
  step(0.3);
  const tc = tcOf(vs, 0);
  // worldToScreen / screenToWorld round trip
  const p = r.worldToScreen(tc.x + 2.3, tc.y + 3.1);
  assert.ok(p.onScreen);
  const g = r.screenToWorld(p.sx, p.sy);
  assert.ok(g && Math.hypot(g.x - (tc.x + 2.3), g.y - (tc.y + 3.1)) < 0.05, JSON.stringify(g));
  assert.equal(r.screenToWorld(W / 2, -4000), null, 'above the horizon / off the map');
  // a worker under the cursor wins over the ground and over the town center behind it
  const worker = [...r.units.values()].find((v) => v.e.o === 0 && v.onScreen);
  assert.ok(worker);
  assert.equal(r.pickEntity(worker.cx, worker.cy), worker.id);
  // the town center by its body
  const c = r.worldToScreen(tc.x, tc.y, 0.6);
  const picked = r.pickEntity(c.sx, c.sy);
  const pe = vs.entities.get(picked);
  assert.ok(pe && (pe.id === tc.id || pe.k === 'u'), 'town center or a unit in front of it');
  // empty ground far from everything
  const far = r.worldToScreen(r.camera.target.x + 9, r.camera.target.y - 2);
  const hit = r.pickEntity(far.sx, far.sy);
  assert.ok(hit === null || vs.entities.has(hit));
  // box: every visible on-screen unit, own first
  const all = r.entitiesInRect(0, 0, W, H);
  const onScreen = [...r.units.values()].filter((v) => v.visible && v.onScreen).map((v) => v.id);
  assert.deepEqual([...all].sort(), [...onScreen].sort());
  const firstOther = all.findIndex((id) => vs.entities.get(id).o !== 0);
  if (firstOther >= 0) assert.ok(all.slice(firstOther).every((id) => vs.entities.get(id).o !== 0));
  assert.deepEqual(r.entitiesInRect(5, 5, 6, 6), []);
  r.dispose();
});

test('GameRenderer: selection, hover, bars, placement ghost, markers, rally flag and text', () => {
  const { world, vs, r, step } = makeMatch();
  step(0.3);
  const tc = tcOf(vs, 0);
  const worker = [...r.units.values()].find((v) => v.e.o === 0);
  world.issueCommand(0, { type: 'rally', building: tc.id, x: tc.x + 5, y: tc.y + 4 });
  r.setSelection([tc.id, worker.id]);
  r.setHover(worker.id);
  step(0.2);
  assert.ok(r.rings.mesh.count >= 2, 'selection rings');
  assert.ok(r.bars.mesh.count >= 2, 'bars for the selection');
  assert.ok(r.blobs.mesh.count >= 1, 'blob shadows');
  assert.equal(r.flags.n, 1, 'rally flag of the selected town center');
  assert.ok(r.flags.dots.count > 2, 'dotted rally line');
  r.setSelection([]);
  r.setHover(null);
  r.setShowAllBars(true);
  step(0.1);
  assert.ok(r.bars.mesh.count >= r.units.size, 'show-all bars');
  assert.equal(r.flags.n, 0);
  r.setShowAllBars(false);

  r.showPlacement('barracks', tc.tx + 7, tc.ty, true);
  step(0.05);
  let ghost = 0;
  r.overlayRoot.traverseVisible((o) => {
    if (o.isMesh && o.renderOrder >= 5) ghost++;
  });
  assert.ok(ghost > 0, 'placement ghost visible');
  r.hidePlacement();
  r.showCommandMarker(tc.x + 3, tc.y + 3, 'attack');
  r.showCommandMarker(Number.NaN, 1, 'move');
  r.showFloatingText(tc.x, tc.y, '+25');
  step(0.05);
  step(2);
  assert.ok(r.markers.items.length >= 1, 'the attack marker was shown');
  assert.equal(r.markers.items.filter((m) => m.live).length, 0, 'markers expired');
  r.dispose();
});

test('GameRenderer: events become effects, deaths play out, quality changes live', () => {
  const { world, vs, r, step } = makeMatch({ quality: 'high' });
  step(0.3);
  const tc = tcOf(vs, 0);
  // two of my units fight each other: attacks, projectiles, hits, a death
  const a = world.spawnUnit(0, 'archer', tc.x + 3, tc.y + 4, { silent: true });
  const b = world.spawnUnit(1, 'warrior', tc.x + 4, tc.y + 5, { silent: true });
  assert.ok(a && b);
  b.hp = 1;
  world.issueCommand(0, { type: 'attack', units: [a.id], target: b.id });
  let effects = 0;
  const vfx = r.vfx;
  const orig = { p: vfx.spawnProjectile.bind(vfx), d: vfx.spawnDeath.bind(vfx), h: vfx.spawnHit.bind(vfx) };
  vfx.spawnProjectile = (o) => (effects++, orig.p(o));
  vfx.spawnDeath = (o) => (effects++, orig.d(o));
  vfx.spawnHit = (o) => (effects++, orig.h(o));
  step(3);
  assert.ok(!world.entities.get(b.id) || world.entities.get(b.id).dead, 'the target died');
  assert.ok(effects >= 2, `${effects} effects spawned`);
  assert.ok(!r.units.has(b.id), 'the dead unit view left the live set');
  step(2);
  assert.equal(r.dying.length, 0, 'death animation finished and was released');
  // a lasting ground zone seen only after its cast gets a visual for its remaining time, once
  const zones = [];
  const spawnEffect = vfx.spawnEffect.bind(vfx);
  vfx.spawnEffect = (o) => (zones.push(o), spawnEffect(o));
  vs.fields = [{ id: 901, x: tc.x + 2, y: tc.y + 2, r: 3, el: 'fire', rem: 4 }, { id: 902, x: 2, y: 2, r: 3, el: 'fire', rem: 4 }];
  r.syncFields();
  r.syncFields();
  assert.equal(zones.length, 1, 'only the visible zone, only once');
  assert.equal(zones[0].shape, 'field');
  assert.equal(zones[0].duration, 4);
  vs.fields = [];
  r.syncFields();
  assert.equal(r.fieldShown.size, 0);
  // quality: unit shadows only on high
  let casts = 0;
  for (const v of r.units.values()) v.model.root.traverse((o) => {
    if (o.isMesh && o.castShadow) casts++;
  });
  assert.ok(casts > 0);
  r.setQuality('low');
  casts = 0;
  for (const v of r.units.values()) v.model.root.traverse((o) => {
    if (o.isMesh && o.castShadow) casts++;
  });
  assert.equal(casts, 0);
  assert.equal(r.sun.castShadow, false);
  step(0.1);
  r.dispose();
});

test('GameRenderer: hundreds of units stay cheap, dispose empties the scene', () => {
  const { world, vs, r, webgl, step } = makeMatch({ myIndex: -1 }); // spectator: everything visible
  const cx = r.camera.target.x;
  const cy = r.camera.target.y;
  const types = ['warrior', 'archer', 'priest', 'worshipper'];
  let n = 0;
  for (let i = 0; i < 300; i++) {
    const p = i % 2;
    const x = cx - 14 + (i % 25) * 1.1;
    const y = cy - 9 + Math.floor(i / 25) * 1.5;
    if (world.spawnUnit(p, types[i % types.length], x, y, { silent: true })) n++;
  }
  assert.ok(n > 200, `${n} spawned`);
  r.camera.setDistance(40, true);
  step(1); // views get built
  const times = [];
  const orig = r.update.bind(r);
  r.update = (dt) => {
    const t0 = performance.now();
    orig(dt);
    times.push(performance.now() - t0);
  };
  step(3);
  const avg = times.reduce((s, t) => s + t, 0) / times.length;
  const sorted = [...times].sort((x, y) => x - y);
  console.log(`# renderer.update with ${r.units.size} unit views: avg ${avg.toFixed(2)} ms, p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(2)} ms (Node)`);
  assert.ok(r.units.size > 200);
  assert.ok(avg < 40, 'update stays far from a frame budget even on a slow CI machine');

  const scene = r.scene;
  r.dispose();
  assert.equal(scene.children.length, 0, 'scene emptied');
  assert.equal(webgl.disposed, false, 'a WebGL renderer passed in stays with its owner');
  assert.equal(r.units.size, 0);
  r.update(0.016); // no-ops after dispose
  r.render();
  assert.equal(vs.listeners.get('*').size, 0, 'view-state listener removed');
});
