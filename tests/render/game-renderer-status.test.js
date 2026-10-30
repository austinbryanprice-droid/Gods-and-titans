// Tests for the renderer polish pass: enemy units fade in / out at the edge of
// vision (src/render/unit-fade.js), persistent status markers
// (src/render/status-markers.js), flyers' rings at their flying height, and
// buildings that are clickable as soon as they are in the ViewState. Real
// World + ViewState, stub WebGL (Node has no GL).
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
const { FadeMaterials, UnitFader, fadeLevel, FADE_LEVELS, FADE_SECONDS } = await import('../../src/render/unit-fade.js');
const { StatusLayer, STATUS_ICONS, RANK_ICON } = await import('../../src/render/status-markers.js');
const { RANK_COLORS, rankName } = await import('../../src/data/ranks.js');
const { AIR_HOVER_HEIGHT } = await import('../../src/render/models/unit-models.js');
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
    setClearColor() {},
    setPixelRatio() {},
    setSize() {},
    render() {},
    compile() {},
    dispose() {},
  };
}

function makeMatch({ myIndex = 0, pantheons = ['greek', 'norse'], quality = 'medium' } = {}) {
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
  const canvas = { clientWidth: W, clientHeight: H, width: W, height: H, style: {} };
  const r = new GameRenderer(canvas, { viewState: vs, setup, quality, webgl: stubWebgl() });
  let acc = 0;
  const tick = () => {
    world.tick();
    vs.pushSnapshot(world.getSnapshot(), now);
  };
  const step = (seconds, fps = 30, after = null, before = null) => {
    const n = Math.max(1, Math.round(seconds * fps));
    for (let i = 0; i < n; i++) {
      now += 1000 / fps;
      acc += 1000 / fps;
      while (acc >= DT * 1000) {
        acc -= DT * 1000;
        tick();
      }
      if (before) before(i);
      vs.update(now);
      r.update(1 / fps);
      if (after) after(i);
    }
  };
  return { world, vs, r, step, tick };
}

const tcOf = (vs, o) => [...vs.entities.values()].find((e) => e.k === 'b' && e.o === o && e.t === 'town_center');

/** A passable tile center the local player sees right now, about `d` tiles from (x, y). */
function visibleSpot(world, vs, x, y, d) {
  for (let a = 0; a < Math.PI * 2; a += 0.15) {
    const px = x + Math.cos(a) * d;
    const py = y + Math.sin(a) * d;
    if (vs.isVisibleAt(px, py) && world.map.isPassable(Math.floor(px), Math.floor(py))) return { x: Math.floor(px) + 0.5, y: Math.floor(py) + 0.5 };
  }
  return null;
}

// ------------------------------------------------------------------ unit-fade parts

test('fade: levels quantize, variants share the base shader setup and are cached', () => {
  assert.equal(fadeLevel(0), 0);
  assert.equal(fadeLevel(-1), 0);
  assert.equal(fadeLevel(1), FADE_LEVELS);
  assert.equal(fadeLevel(0.001), 1, 'barely visible is still drawn');
  assert.equal(fadeLevel(0.999), FADE_LEVELS - 1, 'almost opaque is still a variant');
  assert.equal(fadeLevel(0.5), FADE_LEVELS / 2);

  const mats = new FadeMaterials();
  const uTeam = { value: new THREE.Color('#ff0000') };
  const opaque = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  opaque.userData.uTeamColor = uTeam;
  opaque.onBeforeCompile = function onc() {};
  opaque.customProgramCacheKey = () => 'unit-key';
  const v = mats.get(opaque, 3);
  assert.notEqual(v, opaque);
  assert.equal(v.alphaHash, true, 'opaque materials dither');
  assert.equal(v.transparent, false, 'and stay in the opaque pass');
  assert.ok(Math.abs(v.opacity - 3 / FADE_LEVELS) < 1e-9);
  assert.equal(v.userData, opaque.userData, 'shared uniforms (team color) stay shared');
  assert.equal(v.userData.uTeamColor, uTeam);
  assert.equal(v.onBeforeCompile, opaque.onBeforeCompile);
  assert.equal(v.customProgramCacheKey(), 'unit-key');
  assert.equal(v.flatShading, true);
  assert.equal(mats.get(opaque, 3), v, 'cached');
  assert.equal(mats.get(opaque, FADE_LEVELS), opaque, 'full level is the base itself');

  const glow = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8 });
  const g = mats.get(glow, 4);
  assert.equal(g.alphaHash, false, 'transparent materials just scale their opacity');
  assert.ok(Math.abs(g.opacity - 0.4) < 1e-9);
  const shader = new THREE.ShaderMaterial();
  assert.equal(mats.get(shader, 2), shader, 'custom shaders are left alone');

  let disposed = 0;
  v.addEventListener('dispose', () => disposed++);
  g.addEventListener('dispose', () => disposed++);
  mats.dispose();
  assert.equal(disposed, 2);
});

test('fade: a fader swaps materials only while see-through and hides at zero', () => {
  const mats = new FadeMaterials();
  const base = new THREE.MeshLambertMaterial();
  const root = new THREE.Group();
  const a = new THREE.Mesh(new THREE.BoxGeometry(), base);
  const b = new THREE.Mesh(new THREE.BoxGeometry(), base);
  a.castShadow = true;
  root.add(a);
  a.add(b);
  const f = new UnitFader(root);
  assert.equal(f.apply(1, mats), true);
  assert.equal(a.material, base, 'nothing to do at full opacity');
  f.apply(0.5, mats);
  assert.equal(a.material.alphaHash, true);
  assert.equal(b.material, a.material, 'meshes sharing a material share its variant');
  assert.equal(a.castShadow, false, 'no shadow while see-through');
  assert.equal(root.visible, true);
  assert.equal(f.apply(0, mats), false);
  assert.equal(root.visible, false);
  f.apply(1, mats);
  assert.equal(root.visible, true);
  assert.equal(a.material, base);
  assert.equal(b.material, base);
  assert.equal(a.castShadow, true, 'shadow flag restored');
  mats.dispose();
});

// ------------------------------------------------------------------ status layer parts

test('status layer: icons in a fixed order centered over the unit, bubbles, caps', () => {
  const root = new THREE.Group();
  const s = new StatusLayer(root, 5, 2);
  s.begin(1.5);
  assert.equal(s.addIcons(0, 3, 0, ['stun', 'shield', 'invuln'], 0.5, 1, 0), 0, 'stun / shield / invuln are not icons');
  assert.equal(s.addIcons(2, 3, 4, ['dot', 'buff', 'slow'], 0.5, 0.5, 0.3), 3);
  s.addBubble(1, 1, 1, 0.8, 1, 0);
  s.addBubble(1, 1, 1, 0.8, 1, 0);
  s.addBubble(1, 1, 1, 0.8, 1, 0);
  s.end();
  assert.equal(s.icons.count, 3);
  assert.equal(s.bubbles.count, 2, 'bubble cap');
  const a = s.aIcon.array;
  assert.deepEqual([a[0], a[4], a[8]], [STATUS_ICONS.buff, STATUS_ICONS.slow, STATUS_ICONS.dot], 'buff, debuff, slow, dot order');
  assert.ok(Math.abs(a[3] + a[11]) < 1e-9 && a[7] === 0, 'row centered');
  assert.equal(a[5], 0.5, 'alpha (fading units)');
  assert.equal(a[1], 0.375, 'buff icons (auras) a little lighter');
  const m = new THREE.Matrix4();
  s.icons.getMatrixAt(0, m);
  assert.deepEqual([m.elements[0], m.elements[12], m.elements[13], m.elements[14]], [0.5, 2, 3, 4]);
  s.begin(2);
  s.addIcons(0, 0, 0, ['buff', 'debuff', 'slow', 'dot'], 1, 1, 0);
  s.addIcons(0, 0, 0, ['buff', 'debuff', 'slow', 'dot'], 1, 1, 0);
  s.end();
  assert.equal(s.icons.count, 5, 'icon cap');
  assert.equal(s.uniforms.uTime.value, 2);
  s.dispose();
  assert.equal(root.children.length, 0);
});

test('status layer: a skipped kind is left out of the row, which stays centered', () => {
  const root = new THREE.Group();
  const s = new StatusLayer(root, 8, 2);
  assert.equal(StatusLayer.iconCount(['buff', 'dot', 'slow']), 3);
  assert.equal(StatusLayer.iconCount(['buff', 'dot', 'slow'], 'buff'), 2);
  s.begin(0);
  assert.equal(s.addIcons(0, 1, 0, ['buff'], 0.5, 1, 0, 'buff'), 0, 'nothing but the buff: no row');
  assert.equal(s.addIcons(0, 1, 0, ['buff', 'dot', 'slow'], 0.5, 1, 0, 'buff'), 2);
  s.end();
  assert.equal(s.icons.count, 2);
  const a = s.aIcon.array;
  assert.deepEqual([a[0], a[4]], [STATUS_ICONS.slow, STATUS_ICONS.dot]);
  assert.ok(Math.abs(a[3] + a[7]) < 1e-9 && a[3] < 0, 'two icons centered without the buff');
  s.dispose();
});

test('status layer: rank pips are icons of kind RANK_ICON + rank, in the rank colours, and share the cap', () => {
  const root = new THREE.Group();
  const s = new StatusLayer(root, 4, 2);
  s.begin(0);
  assert.equal(s.addRank(0, 0, 0, 0, 0.4, 1), false, 'a Recruit wears nothing');
  assert.equal(s.addRank(1, 2, 3, 1, 0.4, 0.5), true);
  assert.equal(s.addRank(0, 0, 0, 2, 0.4, 1), true);
  assert.equal(s.addRank(0, 0, 0, 3, 0.4, 1), true);
  assert.equal(s.addRank(0, 0, 0, 9, 0.4, 1), true, 'beyond the top clamps to the top');
  assert.equal(s.addRank(0, 0, 0, 1, 0.4, 1), false, 'icon cap');
  s.end();
  assert.equal(s.icons.count, 4);
  const a = s.aIcon.array;
  assert.deepEqual([a[0], a[4], a[8], a[12]], [RANK_ICON + 1, RANK_ICON + 2, RANK_ICON + 3, RANK_ICON + 3]);
  assert.ok(RANK_ICON >= Math.max(...Object.values(STATUS_ICONS)), 'rank kinds follow the status kinds');
  assert.equal(a[1], 0.5, 'alpha');
  const m = new THREE.Matrix4();
  s.icons.getMatrixAt(0, m);
  assert.ok(Math.abs(m.elements[0] - 0.4) < 1e-6, 'size (float32)');
  assert.deepEqual([m.elements[12], m.elements[13], m.elements[14]], [1, 2, 3]);
  // the fragment shader gets the same colours as the HUD badges (display values)
  const u = s.iconMaterial.uniforms.uRank.value;
  assert.equal(u.length, RANK_COLORS.length - 1);
  RANK_COLORS.slice(1).forEach((hex, i) => {
    const want = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255);
    assert.deepEqual([u[i].x, u[i].y, u[i].z], want, hex);
  });
  assert.equal(s.iconMaterial.uniforms.uTime, s.uniforms.uTime, 'one clock for every icon');
  assert.match(s.iconMaterial.fragmentShader, /uRank\[ 0 \]/);
  s.dispose();
});

// ------------------------------------------------------------------ integration

test('GameRenderer: an enemy walking into sight fades in, and out again when it leaves', () => {
  const { world, vs, r, step } = makeMatch();
  step(0.3);
  const tc = tcOf(vs, 0);
  const spot = visibleSpot(world, vs, tc.x, tc.y, 5);
  assert.ok(spot, 'a visible spot near my base');
  // an enemy warrior far away in the fog
  const u = world.spawnUnit(1, 'warrior', world.mapData.width - 6, world.mapData.height - 6, { silent: true });
  step(0.2);
  assert.ok(!vs.isEntityVisible(vs.entities.get(u.id)));
  assert.ok(!r.units.has(u.id), 'never seen: no view yet');
  // it steps into sight
  u.x = spot.x;
  u.y = spot.y;
  const fades = [];
  let sawVariant = false;
  step(0.5, 30, () => {
    const v = r.units.get(u.id);
    if (!v) return;
    fades.push(v.fade);
    v.model.root.traverse((o) => {
      if (o.isMesh && o.material.alphaHash) sawVariant = true;
    });
  });
  const v = r.units.get(u.id);
  assert.ok(v && v.visible);
  assert.ok(fades.length > 3);
  assert.ok(fades[0] > 0 && fades[0] < 0.5, `starts see-through (${fades[0]})`);
  const rising = fades.filter((f) => f < 1).length;
  assert.ok(rising >= Math.floor(FADE_SECONDS * 30) - 2 && rising <= Math.ceil(FADE_SECONDS * 30) + 2, `about ${FADE_SECONDS} s of fade (${rising} frames)`);
  assert.equal(v.fade, 1);
  assert.ok(sawVariant, 'see-through materials were used');
  v.model.root.traverse((o) => {
    if (o.isMesh) assert.ok(!o.material.alphaHash, 'base materials restored');
  });
  assert.equal(r.pickEntity(v.cx, v.cy), u.id, 'pickable once visible');
  // it leaves: still drawn (fading, unpickable) for a moment, then hidden
  u.x = world.mapData.width - 6;
  u.y = world.mapData.height - 6;
  let mid = null;
  step(0.5, 30, (i) => {
    if (i === 3 && !mid) {
      const w = r.units.get(u.id);
      mid = { visible: w.visible, fade: w.fade, drawn: w.model.root.visible, pick: r.entitiesInRect(0, 0, W, H).includes(u.id) };
    }
  });
  assert.ok(mid && !mid.visible && mid.fade > 0 && mid.fade < 1 && mid.drawn, JSON.stringify(mid));
  assert.equal(mid.pick, false, 'a fading-out unit cannot be selected');
  assert.equal(v.fade, 0);
  assert.equal(v.model.root.visible, false);
  r.dispose();
});

test('GameRenderer: own units and units seen at load never fade', () => {
  const { world, vs, r, step } = makeMatch();
  step(0.1);
  for (const v of r.units.values()) assert.equal(v.fade, 1);
  const tc = tcOf(vs, 0);
  const w = world.spawnUnit(0, 'warrior', tc.x + 3, tc.y + 4, { silent: true });
  step(0.1);
  assert.equal(r.units.get(w.id).fade, 1, 'my new unit pops in at once (it has its own spawn effect)');
  r.dispose();
});

test('GameRenderer: statuses show icons, shield bubbles and rings; flyers ring at their height', () => {
  const { world, vs, r, step } = makeMatch({ myIndex: -1 });
  step(0.2);
  const tc = tcOf(vs, 0);
  const a = world.spawnUnit(0, 'warrior', tc.x + 3, tc.y + 5, { silent: true });
  const b = world.spawnUnit(0, 'archer', tc.x + 5, tc.y + 5, { silent: true });
  const flyer = world.spawnUnit(0, 'greek_pegasus', tc.x + 4, tc.y + 7, { silent: true });
  assert.ok(a && b && flyer && flyer.def.air);
  r.camera.centerOn(tc.x + 4, tc.y + 6);
  const force = { [a.id]: ['buff', 'dot', 'shield'], [b.id]: ['debuff', 'slow', 'invuln', 'stun'], [flyer.id]: ['shield'] };
  const apply = () => {
    for (const [id, fx] of Object.entries(force)) {
      const e = vs.entities.get(Number(id));
      if (e) e.fx = fx;
    }
  };
  step(0.4, 30, null, apply);
  assert.equal(r.status.icons.count, 4, 'buff + dot over one, debuff + slow over the other');
  assert.equal(r.status.bubbles.count, 2, 'two shielded units');
  assert.ok(r.stars.mesh.count >= 3, 'stun stars');
  // icons sit above the unit's head, bubbles around its body
  const va = r.units.get(a.id);
  const m = new THREE.Matrix4();
  let found = false;
  for (let i = 0; i < r.status.icons.count; i++) {
    r.status.icons.getMatrixAt(i, m);
    if (Math.abs(m.elements[12] - va.x) < 1e-6) {
      found = true;
      assert.ok(m.elements[13] > va.gh + va.height, 'icon above the head');
    }
  }
  assert.ok(found);
  const vf = r.units.get(flyer.id);
  let bubbleY = [];
  for (let i = 0; i < r.status.bubbles.count; i++) {
    r.status.bubbles.getMatrixAt(i, m);
    bubbleY.push(m.elements[13] - (Math.abs(m.elements[12] - vf.x) < 1e-6 ? vf.gh : va.gh));
  }
  assert.ok(bubbleY.some((y) => y > AIR_HOVER_HEIGHT), 'the flyer bubble surrounds it in the air');
  // selection ring of a flyer at its flying height, of a ground unit on the ground
  r.setSelection([flyer.id, a.id]);
  step(0.1, 30, null, apply);
  const ys = [];
  for (let i = 0; i < r.rings.mesh.count; i++) {
    r.rings.mesh.getMatrixAt(i, m);
    if (Math.abs(m.elements[12] - vf.x) < 1e-6 && Math.abs(m.elements[14] - vf.y) < 1e-6) ys.push(m.elements[13] - vf.gh);
  }
  assert.ok(ys.length >= 1 && ys.every((y) => y > AIR_HOVER_HEIGHT * 0.8), `flyer ring lifts: ${ys}`);
  // statuses gone → markers gone
  for (const k of Object.keys(force)) force[k] = [];
  step(0.1, 30, null, apply);
  assert.equal(r.status.icons.count, 0);
  assert.equal(r.status.bubbles.count, 0);
  r.dispose();
});

test('GameRenderer: ranked soldiers wear pips over their health bar, above which the status row moves', () => {
  const { world, vs, r, step } = makeMatch({ myIndex: -1 });
  step(0.2);
  const tc = tcOf(vs, 0);
  const a = world.spawnUnit(0, 'warrior', tc.x + 3, tc.y + 5, { silent: true });
  const b = world.spawnUnit(0, 'archer', tc.x + 5, tc.y + 5, { silent: true });
  r.camera.centerOn(tc.x + 4, tc.y + 5);
  step(0.3);
  assert.equal(r.status.icons.count, 0, 'Recruits wear nothing');
  world.gainRankXp(a, 60);
  world.gainRankXp(b, 300);
  assert.deepEqual([a.rank, b.rank], [1, 3]);
  step(0.3);
  assert.equal(r.status.icons.count, 2);
  const m = new THREE.Matrix4();
  const iconsOf = (unit) => {
    const v = r.units.get(unit.id);
    const out = [];
    for (let i = 0; i < r.status.icons.count; i++) {
      r.status.icons.getMatrixAt(i, m);
      if (Math.abs(m.elements[12] - v.x) < 1e-6 && Math.abs(m.elements[14] - v.y) < 1e-6) out.push({ kind: r.status.aIcon.array[i * 4], y: m.elements[13] - v.gh - v.height });
    }
    return out;
  };
  const ra = iconsOf(a);
  assert.deepEqual(ra.map((i) => i.kind), [RANK_ICON + 1]);
  assert.deepEqual(iconsOf(b).map((i) => i.kind), [RANK_ICON + 3]);
  assert.ok(ra[0].y > 0.22 && ra[0].y < 1, `over the head and the bar: ${ra[0].y}`);
  // a buff icon moves up one slot so the two never overlap
  const plain = world.spawnUnit(0, 'warrior', tc.x + 3, tc.y + 7, { silent: true });
  step(0.2);
  const force = { [a.id]: ['buff'], [plain.id]: ['buff'] };
  const apply = () => {
    for (const [id, fx] of Object.entries(force)) {
      const e = vs.entities.get(Number(id));
      if (e) e.fx = fx;
    }
  };
  step(0.3, 30, null, apply);
  const buffY = (unit) => iconsOf(unit).find((i) => i.kind === STATUS_ICONS.buff).y;
  assert.ok(buffY(a) > buffY(plain) + 0.2 * r.zoomK(), `the row moves up a slot: ${buffY(a)} vs ${buffY(plain)}`);
  assert.ok(buffY(a) > iconsOf(a).find((i) => i.kind === RANK_ICON + 1).y + 0.2 * r.zoomK(), 'clear of the pips');
  r.dispose();
});

test('GameRenderer: a promotion shows the rank name over the unit with a small effect', () => {
  const { world, vs, r, step } = makeMatch({ myIndex: -1 });
  step(0.2);
  const tc = tcOf(vs, 0);
  const a = world.spawnUnit(0, 'warrior', tc.x + 3, tc.y + 5, { silent: true });
  const foe = (n) => world.spawnUnit(1, 'warrior', tc.x + 3 + n * 0.01, tc.y + 6, { silent: true });
  step(0.2);
  const texts = [];
  r.showFloatingText = (x, y, text, color) => texts.push({ text, color });
  let rings = 0;
  const spawnRankUp = r.vfx.spawnRankUp.bind(r.vfx);
  r.vfx.spawnRankUp = (o) => {
    rings++;
    spawnRankUp(o);
  };
  world.killEntity(foe(0), a);
  step(0.2);
  assert.deepEqual(texts, [], 'a kill that does not promote shows nothing');
  world.killEntity(foe(1), a);
  step(0.2);
  assert.deepEqual(texts, [{ text: rankName(1), color: RANK_COLORS[1] }]);
  assert.equal(rings, 1);
  r.dispose();
});

test('GameRenderer: a promotion in the fog is not drawn', () => {
  const { world, vs, r, step } = makeMatch();
  step(0.2);
  const far = world.spawnUnit(1, 'warrior', world.mapData.width - 6, world.mapData.height - 6, { silent: true });
  step(0.2);
  assert.ok(!vs.isEntityVisible(vs.entities.get(far.id)), 'the enemy is out of sight');
  const texts = [];
  r.showFloatingText = (x, y, text) => texts.push(text);
  let rings = 0;
  const spawnRankUp = r.vfx.spawnRankUp.bind(r.vfx);
  r.vfx.spawnRankUp = (o) => {
    rings++;
    spawnRankUp(o);
  };
  world.gainRankXp(far, 60);
  assert.equal(far.rank, 1);
  step(0.2);
  assert.deepEqual(texts, []);
  assert.equal(rings, 0);
  r.dispose();
});

test('GameRenderer: a building placed since the last frame is clickable at once', () => {
  const { world, vs, r, step, tick } = makeMatch();
  step(0.3);
  const tc = tcOf(vs, 0);
  const spot = world.findPlacement(0, 'barracks', tc.x + 7, tc.y + 1, 12);
  assert.ok(spot);
  const b = world.createBuilding(0, 'barracks', spot.tx, spot.ty, false);
  tick(); // the snapshot lands between two frames: no renderer.update yet
  assert.ok(vs.entities.has(b.id));
  assert.ok(!r.buildings.has(b.id), 'no view before the next frame');
  r.camera.centerOn(b.x, b.y + 1);
  r.camera.update(0);
  const p = r.worldToScreen(b.x, b.y, 0.5);
  // a unit can stand in front; try a few points on the footprint
  let hit = null;
  for (const [dx, dy, h] of [[0, 0, 0.5], [0.6, 0.6, 0.4], [-0.6, 0.6, 0.4], [0, -0.6, 0.8]]) {
    const q = r.worldToScreen(b.x + dx, b.y + dy, h);
    hit = r.pickEntity(q.sx, q.sy);
    if (hit === b.id) break;
  }
  assert.ok(p.onScreen);
  assert.equal(hit, b.id, 'picked before any frame ran');
  assert.ok(r.buildings.has(b.id));
  step(0.1); // and the next frame does not build it twice
  assert.equal([...r.entityRoot.children].filter((o) => o === r.buildings.get(b.id).model.root).length, 1);
  r.dispose();
});

test('GameRenderer: terrain under a unit is resampled when it moves, cached while it stands', async () => {
  const { heightAt } = await import('../../src/render/height.js');
  const { world, vs, r, step } = makeMatch();
  step(0.3);
  const tc = tcOf(vs, 0);
  const u = world.spawnUnit(0, 'warrior', tc.x + 4, tc.y + 4, { silent: true });
  r.camera.centerOn(u.x, u.y);
  r.camera.update(0);
  step(0.2);
  let calls = 0;
  const orig = r.groundNormal.bind(r);
  r.groundNormal = (x, y, out) => {
    calls++;
    return orig(x, y, out);
  };
  // everyone stands still: no ground normals are recomputed
  step(0.3);
  assert.equal(calls, 0, 'standing units reuse their cached terrain sample');
  // walk it around: height and normal follow every frame
  const v = r.units.get(u.id);
  assert.ok(v && v.onScreen);
  let checked = 0;
  for (let k = 0; k < 6; k++) {
    u.x += 0.6;
    u.y += 0.35 * (k % 2 ? -1 : 1);
    step(0.1, 30, () => {
      assert.ok(Math.abs(v.model.root.position.y - heightAt(world.mapData, v.x, v.y)) < 1e-6, 'model on the ground');
      const n = orig(v.x, v.y, new THREE.Vector3());
      assert.ok(v.nOk && Math.abs(v.nx - n.x) < 1e-6 && Math.abs(v.ny - n.y) < 1e-6 && Math.abs(v.nz - n.z) < 1e-6, 'blob normal under the unit');
      checked++;
    });
  }
  assert.ok(calls > 0 && checked >= 18);
  r.dispose();
});

test('GameRenderer: a worker waiting its turn at a gold mine (mw) stands by, miners swing', () => {
  const { vs, r, step } = makeMatch();
  step(0.3);
  const tc = tcOf(vs, 0);
  r.camera.centerOn(tc.x, tc.y);
  r.camera.update(0);
  const mine = [...vs.entities.values()].find((e) => e.k === 'm');
  const workers = [...vs.entities.values()].filter((e) => e.k === 'u' && e.o === 0).slice(0, 2);
  assert.ok(mine && workers.length === 2);
  const [waiter, miner] = workers.map((w) => w.id);
  const force = () => {
    for (const id of [waiter, miner]) {
      const e = vs.entities.get(id);
      e.st = 'gather';
      e.tg = mine.id;
      if (id === waiter) e.mw = 1;
      else delete e.mw;
    }
  };
  step(0.3, 30, null, force);
  const w = r.units.get(waiter);
  const m = r.units.get(miner);
  assert.ok(w.onScreen && m.onScreen);
  assert.equal(m.model.state, 'gather');
  assert.equal(m.model.toolKind, 'pick');
  assert.equal(w.model.state, 'idle', 'waiting: no mining swing');
  assert.equal(w.model.toolKind, 'none');
  r.dispose();
});

test('GameRenderer: an army coming into sight at once is built over a few frames', () => {
  const { world, vs, r, step } = makeMatch();
  step(0.3);
  const tc = tcOf(vs, 0);
  const ids = [];
  for (let i = 0; i < 60; i++) {
    const u = world.spawnUnit(1, 'warrior', tc.x - 3 + (i % 10) * 0.8, tc.y + 4 + Math.floor(i / 10) * 0.8, { silent: true });
    if (u) ids.push(u.id);
  }
  assert.ok(ids.length >= 40);
  // model building made slow (≥ 0.3 ms each) so the budget shows
  const orig = r.createUnitView.bind(r);
  r.createUnitView = (e) => {
    const t0 = performance.now();
    while (performance.now() - t0 < 0.3);
    return orig(e);
  };
  const built = [];
  step(1, 30, () => built.push(ids.filter((id) => r.units.has(id)).length));
  const visible = ids.filter((id) => vs.isEntityVisible(vs.entities.get(id)));
  assert.ok(visible.length >= 40, `most of the army is in sight (${visible.length})`);
  const first = built.find((n) => n > 0);
  assert.ok(first > 0 && first < visible.length, `not all at once (${built.join(',')})`);
  assert.ok(built[built.length - 1] >= visible.length, `all built a few frames later (${built.join(',')})`);
  for (const id of visible) assert.ok(r.units.get(id).fade > 0);
  r.dispose();
});

test('GameRenderer: a selected own unit shows its queued orders as a dotted path; others and the unselected show none', () => {
  const { world, vs, r, step } = makeMatch({ myIndex: 0 });
  step(0.2);
  const tc = tcOf(vs, 0);
  const a = world.spawnUnit(0, 'warrior', tc.x + 3, tc.y + 5, { silent: true });
  const e = world.spawnUnit(1, 'warrior', tc.x + 6, tc.y + 5, { silent: true });
  world.issueCommand(0, { type: 'move', units: [a.id], x: tc.x + 3, y: tc.y + 12 });
  world.issueCommand(0, { type: 'patrol', units: [a.id], x: tc.x + 10, y: tc.y + 12, queue: true });
  world.issueCommand(1, { type: 'move', units: [e.id], x: tc.x + 6, y: tc.y + 14 });
  step(0.2);
  assert.equal(r.paths.mesh.count, 0, 'nothing selected, no path');
  r.setSelection([e.id]);
  step(0.1);
  assert.equal(r.paths.mesh.count, 0, "another player's unit shows no path");
  r.setSelection([a.id]);
  step(0.1);
  const n = r.paths.mesh.count;
  assert.ok(n > 15, `${n} dots`);
  const m = new THREE.Matrix4();
  let far = 0;
  for (let i = 0; i < n; i++) {
    r.paths.mesh.getMatrixAt(i, m);
    far = Math.max(far, m.elements[12] - tc.x);
  }
  assert.ok(far > 9.5, 'the path runs out to the patrol end');
  world.issueCommand(0, { type: 'stop', units: [a.id] });
  step(0.2);
  assert.equal(r.paths.mesh.count, 0, 'a stopped unit has no path');
  r.dispose();
});
