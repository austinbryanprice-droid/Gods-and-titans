// The far zoom in a real GameRenderer (stub WebGL: Node has no GL): the detail levels follow the camera
// (ground mesh step, plain forest crowns, unit markers), the shadow, ambient occlusion and haze follow
// the zoom, and a unit that dies as a marker plays its death on the model.
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

const THREE = await import('three');
const { GameRenderer } = await import('../../src/render/game-renderer.js');
const { CAMERA_DEFAULTS } = await import('../../src/render/camera.js');
const { createWorld } = await import('../../src/sim/world.js');
const { ViewState } = await import('../../src/game/view-state.js');
const { PLAYER_COLORS, DT } = await import('../../src/config.js');
const { DEFAULT_LOOK } = await import('../../src/render/post.js');
const { pixelsPerTile } = await import('../../src/render/zoom-lod.js');

const W = 1280;
const H = 720;

/** A stand-in for THREE.WebGLRenderer with the render-target API, so medium and up build the post pipeline. */
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
    target: null,
    toneMapping: 0,
    autoClear: true,
    extensions: { has: (name) => name === 'EXT_color_buffer_float' },
    capabilities: { maxSamples: 4 },
    setRenderTarget(t) {
      this.target = t;
    },
    getRenderTarget() {
      return this.target;
    },
    getDrawingBufferSize(v) {
      return v.set(W, H);
    },
    clear() {},
  };
}

/** A small match watched by nobody in particular (everything visible), a renderer and a frame stepper. */
function makeMatch({ quality = 'low' } = {}) {
  const setup = {
    version: '0.1.0',
    seed: 4242,
    mapSize: 'small',
    players: ['greek', 'norse'].map((p, i) => ({ index: i, name: `P${i}`, team: i + 1, pantheon: p, color: PLAYER_COLORS[i], kind: 'human', difficulty: 'normal' })),
  };
  const world = createWorld(setup);
  const vs = new ViewState({ setup, mapData: world.mapData, myIndex: -1, interpDelayMs: 50 });
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
  return { world, vs, r, webgl, step };
}

/** A crowd around the camera's target. */
function crowd(world, r, n = 60) {
  const cx = r.camera.target.x;
  const cy = r.camera.target.y;
  const types = ['warrior', 'archer', 'priest', 'worshipper'];
  let made = 0;
  for (let i = 0; i < n; i++) {
    if (world.spawnUnit(i % 2, types[i % types.length], cx - 6 + (i % 10) * 1.2, cy - 4 + Math.floor(i / 10) * 1.4, { silent: true })) made++;
  }
  return made;
}

const rootsShown = (r) => [...r.units.values()].filter((v) => v.model.root.visible).length;

test('zoom: the detail levels follow the camera, in and out', () => {
  const { world, r, step } = makeMatch();
  assert.ok(crowd(world, r) > 40);
  r.camera.setDistance(CAMERA_DEFAULTS.defaultDistance, true);
  step(0.5);
  assert.deepEqual({ stride: r.lod.stride, forestFar: r.lod.forestFar, unitFar: r.lod.unitFar }, { stride: 1, forestFar: false, unitFar: false });
  assert.equal(r.terrain.stride, 1);
  assert.equal(r.forest.far, false);
  assert.equal(r.farUnits.mesh.count, 0, 'no markers up close');
  assert.equal(rootsShown(r), r.units.size, 'every model is drawn');

  r.camera.setDistance(CAMERA_DEFAULTS.maxDistance, true);
  step(0.5);
  assert.equal(r.lod.stride, 4);
  assert.equal(r.lod.forestFar, true);
  assert.equal(r.terrain.stride, 4);
  assert.equal(r.forest.far, true);
  const far = [...r.units.values()].filter((v) => v.far);
  assert.ok(far.length > 40, `${far.length} units became markers`);
  assert.ok(far.every((v) => !v.model.root.visible), 'a marker hides its model');
  assert.equal(r.farUnits.mesh.count, far.length, 'one marker instance each');
  assert.ok(r.farUnits.mesh.visible);
  assert.equal(rootsShown(r), r.units.size - far.length);
  // the colors are the teams'
  const teamHexes = new Set([...r.units.values()].map((v) => v.model.teamColor.getHexString()));
  const arr = r.farUnits.mesh.instanceColor.array;
  for (let i = 0; i < r.farUnits.mesh.count; i++) {
    const hex = new THREE.Color().fromArray(arr, i * 3).getHexString();
    assert.ok(teamHexes.has(hex), `marker color ${hex} is a team color`);
  }
  // a marker stands on the ground where the unit does
  const a = r.farUnits.mesh.instanceMatrix.array;
  const v0 = far[0];
  const positions = [];
  for (let i = 0; i < r.farUnits.mesh.count; i++) positions.push([a[i * 16 + 12], a[i * 16 + 14]]);
  assert.ok(positions.some(([x, z]) => Math.abs(x - v0.x) < 0.01 && Math.abs(z - v0.y) < 0.01), 'a marker at the first unit');

  r.camera.setDistance(CAMERA_DEFAULTS.defaultDistance, true);
  step(0.5);
  assert.deepEqual({ stride: r.lod.stride, forestFar: r.lod.forestFar, unitFar: r.lod.unitFar }, { stride: 1, forestFar: false, unitFar: false });
  assert.equal(r.terrain.stride, 1);
  assert.equal(r.forest.far, false);
  assert.equal(r.farUnits.mesh.count, 0);
  // (what is out of the picture keeps its marker state until the camera brings it back in; what is in the picture is drawn)
  const inView = [...r.units.values()].filter((v) => v.onScreen);
  assert.ok(inView.length > 20 && inView.every((v) => !v.far && v.model.root.visible), 'the models are back');
  r.dispose();
});

test('zoom: the levels are held at the edge by their margin, and a pin overrides them', () => {
  const { world, r, step } = makeMatch();
  crowd(world, r, 30);
  // 720 pixels: the ground goes to every other sample under 16 pixels a tile, back above 19
  const at = (ppt) => (H / (2 * ppt)) / Math.tan((CAMERA_DEFAULTS.fov * Math.PI) / 360);
  r.camera.setDistance(at(15), true);
  step(0.2);
  assert.equal(r.lod.stride, 2);
  r.camera.setDistance(at(17), true);
  step(0.2);
  assert.equal(r.lod.stride, 2, 'held between 16 and 19');
  r.camera.setDistance(at(20), true);
  step(0.2);
  assert.equal(r.lod.stride, 1);
  // a pin wins over the camera
  r.camera.setDistance(CAMERA_DEFAULTS.defaultDistance, true);
  r.lodPin = { stride: 2, forestFar: true, unitFar: true };
  step(0.3);
  assert.equal(r.terrain.stride, 2);
  assert.equal(r.forest.far, true);
  assert.ok(r.farUnits.mesh.count > 20, 'every unit in view is a marker');
  r.lodPin = null;
  step(0.3);
  assert.deepEqual({ stride: r.lod.stride, forestFar: r.lod.forestFar, unitFar: r.lod.unitFar }, { stride: 1, forestFar: false, unitFar: false });
  assert.equal(r.farUnits.mesh.count, 0);
  r.dispose();
});

test('zoom: the original range keeps every model and detail level in a short window', () => {
  const { world, r, step } = makeMatch();
  assert.ok(crowd(world, r) > 40);
  const near = CAMERA_DEFAULTS.midDistance;
  r.resize(W, 360); // 11 pixels a tile at 44: by the pixels alone that is marker, crown and coarse-ground territory
  assert.ok(pixelsPerTile(near, 360) < 12);
  r.camera.setDistance(near, true);
  step(0.5);
  assert.deepEqual({ stride: r.lod.stride, forestFar: r.lod.forestFar }, { stride: 1, forestFar: false });
  assert.equal(r.terrain.stride, 1);
  assert.equal(r.forest.far, false);
  assert.equal(r.farUnits.mesh.count, 0, 'no markers at the old limit');
  assert.equal(rootsShown(r), r.units.size, 'every model is drawn');

  r.camera.setDistance(near + 6, true);
  step(0.5);
  assert.equal(r.lod.stride, 2, 'past it the levels follow the pixels');
  assert.equal(r.forest.far, true);
  assert.ok(r.farUnits.mesh.count > 20, `${r.farUnits.mesh.count} markers`);

  r.camera.setDistance(near, true);
  step(0.5);
  assert.equal(r.terrain.stride, 1);
  assert.equal(r.forest.far, false);
  assert.equal(r.farUnits.mesh.count, 0, 'and back at the limit the models are back');
  const inView = [...r.units.values()].filter((v) => v.onScreen);
  assert.ok(inView.length > 20 && inView.every((v) => !v.far && v.model.root.visible));
  r.dispose();
});

test('zoom: a unit that dies as a marker plays its death on the model', () => {
  const { world, r, step } = makeMatch();
  const cx = r.camera.target.x;
  const cy = r.camera.target.y;
  const a = world.spawnUnit(0, 'archer', cx, cy, { silent: true });
  const b = world.spawnUnit(1, 'warrior', cx + 1, cy + 1, { silent: true });
  assert.ok(a && b);
  b.hp = 1;
  r.lodPin = { unitFar: true };
  step(0.3);
  assert.equal(r.units.get(b.id).far, true);
  assert.equal(r.units.get(b.id).model.root.visible, false);
  world.issueCommand(0, { type: 'attack', units: [a.id], target: b.id });
  let dying = null;
  for (let i = 0; i < 90 && !dying; i++) {
    step(1 / 15, 15);
    dying = r.dying.find((v) => v.id === b.id) || null;
  }
  assert.ok(dying, 'the death animation started');
  assert.equal(dying.far, false);
  assert.equal(dying.model.root.visible, true, 'the dying unit is drawn');
  r.dispose();
});

test('zoom: the sun shadow fades out and stops being drawn, the haze stretches and the ambient occlusion goes', () => {
  const { r, webgl, step } = makeMatch({ quality: 'high' });
  r.camera.setDistance(CAMERA_DEFAULTS.defaultDistance, true);
  step(0.2);
  assert.equal(r.sun.shadow.intensity, 1);
  assert.equal(webgl.shadowMap.autoUpdate, true);
  const fogNear = r.scene.fog.near - r.camera.distance;
  const fogFar = r.scene.fog.far - r.camera.distance;
  assert.equal(r.post.look.aoStrength, DEFAULT_LOOK.aoStrength);
  // in between: a fading shadow still drawn
  r.camera.setDistance(66, true);
  step(0.2);
  assert.ok(r.sun.shadow.intensity > 0.05 && r.sun.shadow.intensity < 0.95, `${r.sun.shadow.intensity}`);
  assert.equal(webgl.shadowMap.autoUpdate, true);
  assert.ok(r.post.look.aoStrength > 0 && r.post.look.aoStrength < DEFAULT_LOOK.aoStrength);
  // far: none, and the map is not redrawn
  r.camera.setDistance(CAMERA_DEFAULTS.maxDistance, true);
  step(0.2);
  assert.equal(r.sun.shadow.intensity, 0);
  assert.equal(webgl.shadowMap.autoUpdate, false, 'the shadow pass is skipped');
  assert.equal(r.post.look.aoStrength, 0);
  // the haze keeps its offsets from the point looked at, stretched
  const stretch = (r.scene.fog.near - r.camera.distance) / fogNear;
  assert.ok(stretch > 2 && stretch < 3, `haze stretch ${stretch}`);
  assert.ok(Math.abs((r.scene.fog.far - r.camera.distance) / fogFar - stretch) < 0.05, 'near and far stretch alike');
  // back in: the shadow map is redrawn at once
  r.camera.setDistance(CAMERA_DEFAULTS.defaultDistance, true);
  step(0.2);
  assert.equal(webgl.shadowMap.autoUpdate, true);
  assert.equal(r.sun.shadow.intensity, 1);
  r.dispose();
});

test('zoom: a selection ring keeps a line a few pixels wide when the camera is far, and the old one up to the old limit', () => {
  const { world, r, step } = makeMatch();
  const cx = r.camera.target.x;
  const cy = r.camera.target.y;
  const u = world.spawnUnit(0, 'warrior', cx, cy, { silent: true });
  step(0.3);
  const b = [...r.buildings.values()][0];
  r.setSelection([u.id, b.e.id]);
  const m = new THREE.Matrix4();
  /** radius and line thickness of the ring at (x, z), in tiles */
  const ringAt = (x, z) => {
    for (let i = 0; i < r.rings.mesh.count; i++) {
      r.rings.mesh.getMatrixAt(i, m);
      if (Math.abs(m.elements[12] - x) < 1e-6 && Math.abs(m.elements[14] - z) < 1e-6) return { radius: Math.hypot(m.elements[0], m.elements[1], m.elements[2]), line: r.rings.aRing.array[i * 3 + 1] };
    }
    return null;
  };
  const rings = (d) => {
    r.camera.setDistance(d, true);
    step(0.2);
    const v = r.units.get(u.id);
    return { unit: ringAt(v.x, v.y), building: ringAt(b.x, b.y), ppt: pixelsPerTile(d, H) };
  };
  const old = rings(CAMERA_DEFAULTS.midDistance);
  const far = rings(CAMERA_DEFAULTS.maxDistance);
  assert.ok(old.unit && old.building && far.unit && far.building, 'a ring each');
  // up to the old limit: the thickness the game always had (0.075 tiles for a unit, 0.1 for a building)
  assert.ok(Math.abs(old.unit.line - 0.075) < 1e-6 && Math.abs(old.building.line - 0.1) < 1e-6, `${old.unit.line}, ${old.building.line}`);
  // far: the line is as wide on the screen as at the old limit, the unit's ring wider, a building's as it was
  assert.ok(Math.abs(far.unit.line * far.ppt - old.unit.line * old.ppt) < 1e-6, 'the unit ring line keeps its pixel width');
  assert.ok(Math.abs(far.building.line * far.ppt - old.building.line * old.ppt) < 1e-6, 'the building ring line keeps its pixel width');
  assert.ok(far.unit.radius > old.unit.radius * 1.8, `${far.unit.radius} against ${old.unit.radius}`);
  assert.equal(far.building.radius, old.building.radius);
  r.dispose();
});

test('zoom: a far marker has its ring and the warnings that matter, not a bar, a rank and a buff for every unit of an army', () => {
  const { world, vs, r, step } = makeMatch();
  const cx = r.camera.target.x;
  const cy = r.camera.target.y;
  const units = [];
  for (let i = 0; i < 24; i++) units.push(world.spawnUnit(0, i % 2 ? 'warrior' : 'archer', cx - 5 + (i % 8) * 1.3, cy - 2 + Math.floor(i / 8) * 1.5, { silent: true }));
  assert.ok(units.every(Boolean));
  const [a, b, c] = units;
  world.gainRankXp(c, 60);
  step(0.3);
  r.setSelection(units.map((u) => u.id));
  const show = () => {
    // statuses the sim does not give these units: set on the views, read by the next frame
    vs.entities.get(a.id).fx = ['buff', 'dot'];
    vs.entities.get(b.id).fx = ['buff'];
    r.update(1 / 30);
    return { bars: r.bars.mesh.count, rings: r.rings.mesh.count, icons: r.status.icons.count, markers: r.farUnits.mesh.count };
  };
  r.camera.setDistance(CAMERA_DEFAULTS.defaultDistance, true);
  step(0.3);
  const near = show();
  assert.equal(near.markers, 0);
  assert.ok(near.bars >= 24, `a bar for each selected unit (${near.bars})`);
  assert.equal(near.icons, 2 + 1 + 1, 'a buff and a dot over one, a buff over another, a rank pip over the third');

  r.camera.setDistance(CAMERA_DEFAULTS.maxDistance, true);
  step(0.3);
  const far = show();
  assert.ok(far.markers >= 24, `${far.markers} markers`);
  assert.ok(far.rings >= 24, 'every selected unit keeps its ring');
  // (a few creatures of the match are hurt, and show it: the bars are theirs, none is for the selection)
  const hurt = () => [...r.units.values()].filter((v) => v.far && (v.e.hp < (v.e.mhp || 1) || v.e.sh > 0)).length;
  const hurtBefore = hurt();
  assert.equal(far.bars, hurtBefore, 'a bar for a hurt unit only, not for the 24 selected');
  assert.equal(far.icons, 1, 'only the dot of the three: no buff, no rank pip');
  // a hurt marker shows its bar
  b.hp = Math.max(1, Math.floor(b.hp / 2));
  step(0.3);
  const after = show();
  assert.equal(hurt(), hurtBefore + 1);
  assert.equal(after.bars, hurtBefore + 1, 'the hurt one gets a bar');
  r.dispose();
});

test('zoom: the overlays are drawn bigger the farther out the camera is', () => {
  const { r, step } = makeMatch();
  r.camera.setDistance(CAMERA_DEFAULTS.defaultDistance, true);
  step(0.1);
  const near = r.zoomK();
  r.camera.setDistance(CAMERA_DEFAULTS.midDistance, true);
  step(0.1);
  const mid = r.zoomK();
  r.camera.setDistance(CAMERA_DEFAULTS.maxDistance, true);
  step(0.1);
  const far = r.zoomK();
  assert.ok(near < mid && mid < far, `${near} < ${mid} < ${far}`);
  assert.ok(mid <= 1.46, 'the old range keeps its old scale');
  r.dispose();
});
