// Integration tests for GameRenderer (src/render/game-renderer.js) driven by a
// real World and ViewState, drawing through a stub WebGL renderer (Node has no
// GL): it builds the scene, starts on the local town center, creates views
// only for what the local player may see, picks / box-selects / projects, turns
// view-state events into VFX, keeps update() cheap with hundreds of units, and
// dispose() leaves an empty scene.
import test, { mock } from 'node:test';
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
const { FOW_UNIFORMS } = await import('../../src/render/fog.js');
const { createWorld } = await import('../../src/sim/world.js');
const { ViewState } = await import('../../src/game/view-state.js');
const { PLAYER_COLORS, DT } = await import('../../src/config.js');

const W = 1280;
const H = 720;

/**
 * A stand-in for THREE.WebGLRenderer. With `post`, it also has the render-target
 * API, so medium / high / ultra draw through the post-processing pipeline
 * (post.js) as in the browser; `log` lists every draw as [scene, target].
 */
function stubWebgl({ post = false } = {}) {
  const gl = {
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
      assert.ok((scene.isScene || scene.isMesh) && camera.isCamera);
      if (scene.isScene) this.renders++;
      if (this.log) this.log.push([scene.name || scene.type, this.target ? this.target.texture.name : 'canvas']);
    },
    compile() {
      this.compiled++;
    },
    dispose() {
      this.disposed = true;
    },
  };
  if (!post) return gl;
  return Object.assign(gl, {
    log: [],
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
      return v.set(this.size[0] * (this.pixelRatio || 1), this.size[1] * (this.pixelRatio || 1));
    },
    clear() {},
  });
}

/** A small 2-player match: world, view state for player 0, renderer, and a frame stepper. */
function makeMatch({ quality = 'medium', myIndex = 0, pantheons = ['greek', 'norse'], post = false } = {}) {
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
  const webgl = stubWebgl({ post });
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
  assert.ok(webgl.compiled >= 2, 'shader warm-up ran for the world and for the overlays');
  assert.equal(r.flags.items.length, 1, 'one hidden rally flag is primed');
  assert.equal(r.flags.items[0].g.visible, false);
  assert.ok(r.placement.ghost && !r.placement.ghost.model.root.visible, 'a hidden placement ghost is primed');
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
  // (this stub has no render targets, so even medium takes the direct path low uses;
  // the post-processed path is covered below)
  assert.equal(webgl.renders, 2, 'world, then the overlays on top');
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
  // quality: unit shadows only on high and ultra
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

test('GameRenderer: resize picks up a new devicePixelRatio (capped by quality); shadows use PCF', async () => {
  const THREE = await import('three');
  const had = 'window' in globalThis;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    for (const [quality, cap] of [['low', 1], ['medium', 1.5], ['high', 2], ['ultra', 2]]) {
      const { r, webgl } = makeMatch({ quality });
      assert.equal(webgl.pixelRatio, 1);
      assert.equal(webgl.shadowMap.type, THREE.PCFShadowMap, 'PCFSoftShadowMap is gone from three');
      globalThis.window.devicePixelRatio = 2; // browser zoom, or the window moved to a HiDPI screen
      r.resize(W, H);
      assert.equal(webgl.pixelRatio, Math.min(2, cap), quality);
      globalThis.window.devicePixelRatio = 1;
      r.resize(W, H);
      assert.equal(webgl.pixelRatio, 1);
      r.dispose();
    }
  } finally {
    if (!had) delete globalThis.window;
  }
});

test('GameRenderer: adaptive resolution lowers the scene scale on slow frames and restores it at the display rate', () => {
  const { r } = makeMatch({ post: true });
  assert.ok(r.post && r.post.enabled, 'medium draws through post-processing');
  const run = (frames, ms, t0) => {
    let t = t0;
    for (let i = 0; i < frames; i++) r.adaptResolution((t += ms));
    return t;
  };
  const composite = r.post.composite;
  let t = run(600, 1000 / 60, 1000); // vsync-capped 60 Hz
  assert.equal(r.renderScale, 1);
  // one long stall (garbage collection, a shader compile) is not a slow stretch
  t = run(1, 200, t);
  t = run(600, 1000 / 60, t);
  assert.equal(r.renderScale, 1, 'a single hitch keeps the full resolution');
  // a heavy fight: the scene drops a step or more ...
  t = run(300, 30, t);
  assert.ok(r.renderScale < 1, `scale ${r.renderScale} during slow frames`);
  assert.ok(r.post.sw < r.post.width, 'the scene target shrinks');
  r.render((t += 30));
  assert.ok(r.post.composite.uniforms.uSharpen.value > 0, 'the upscaled scene is sharpened');
  assert.equal(r.post.composite, composite, 'without a new composite program');
  // ... and comes back once frames are at the display's 16.7 ms again (vsync never lets them go faster)
  t = run(60 * 60, 1000 / 60, t);
  assert.equal(r.renderScale, 1, 'full resolution again at a steady 60 Hz');
  assert.equal(r.post.sw, r.post.width);
  r.render((t += 1000 / 60));
  assert.equal(r.post.composite.uniforms.uSharpen.value, 0);
  // a 30 fps cap (battery saver) is learned as the display rate: full resolution within a few minutes
  t = run(30 * 180, 1000 / 30, t);
  assert.equal(r.renderScale, 1, 'a 30 Hz cap does not keep the scene blurred');
  // a quality change starts over at full scale
  t = run(300, 60, t);
  assert.ok(r.renderScale < 1, 'frames well past the 30 Hz period are still slow');
  r.setQuality('high');
  assert.equal(r.renderScale, 1);
  t = run(30, 60, t);
  assert.equal(r.renderScale, 1, 'the slow average measured at the old quality does not carry over');
  r.dispose();
});

test('GameRenderer: medium and up draw through post-processing, low straight to the canvas', () => {
  const { r, webgl, step } = makeMatch({ post: true });
  step(0.2);
  assert.ok(r.post && r.post.enabled);
  webgl.log.length = 0;
  r.render();
  const log = webgl.log;
  assert.deepEqual(log[0], ['game', 'post-scene'], 'the world goes into the HDR target first');
  assert.ok(log.some(([, target]) => /^post-bloom/.test(target)), 'bloom passes');
  assert.ok(!log.some(([, target]) => target === 'post-ao'), 'no ambient occlusion on medium');
  assert.deepEqual(log[log.length - 2], ['Mesh', 'canvas'], 'the composite lands on the canvas');
  assert.deepEqual(log[log.length - 1], ['overlays', 'canvas'], 'overlays last, on the canvas, untouched by post');
  assert.ok(FOW_UNIFORMS.uFowPow.value > 1, 'fog factors raised for linear output');
  const [sw, sh] = webgl.size;
  assert.equal(r.post.width, Math.round(sw * webgl.pixelRatio), 'targets follow the drawing buffer');
  assert.equal(r.post.sh, Math.round(sh * webgl.pixelRatio));
  for (const q of ['high', 'ultra']) {
    r.setQuality(q);
    webgl.log.length = 0;
    r.render();
    assert.ok(r.post.aoRaw, `${q}: ambient occlusion targets`);
    assert.ok(webgl.log.some(([, target]) => target === 'post-ao'), `${q}: ambient occlusion pass`);
    assert.equal(r.post.samples, 4);
  }
  r.setQuality('low');
  assert.equal(r.post.enabled, false);
  assert.equal(r.post.scene, null, 'targets freed on low');
  webgl.log.length = 0;
  r.render();
  assert.deepEqual(webgl.log, [['game', 'canvas'], ['overlays', 'canvas']]);
  assert.equal(FOW_UNIFORMS.uFowPow.value, 1);
  r.setQuality('medium');
  assert.ok(r.post.enabled && r.post.scene, 'targets come back live');
  r.dispose();
  assert.equal(r.post.targets.length, 0, 'dispose frees the targets');
});

/** Drive the renderer's real-time clock (performance.now) by hand. */
function fakeClock(start = 50000) {
  let t = start;
  mock.method(performance, 'now', () => t);
  return {
    advance(ms) {
      t += ms;
      return t;
    },
    restore() {
      mock.restoreAll();
    },
  };
}

test('GameRenderer: VFX events queued while the tab was hidden are dropped on return', () => {
  const { vs, r, step } = makeMatch();
  step(0.3);
  const clock = fakeClock();
  try {
    const handled = [];
    const handle = r.handleEvent.bind(r);
    r.handleEvent = (ev) => (handled.push(ev.type), handle(ev));
    // a hidden tab: events keep arriving (the sim runs in a worker) but no frame runs for a while
    for (let i = 0; i < 1200; i++) vs.fire({ type: 'attack', src: -1 - i, dst: -1, ranged: false });
    clock.advance(30000);
    for (let i = 0; i < 3; i++) vs.fire({ type: 'bounty', player: 1, x: 1, y: 1, amount: 5 });
    clock.advance(500);
    assert.equal(r.events.length, 1203);
    // back: the first frame is one capped dt (0.1 s), which never aged the queue before
    r.update(0.1);
    assert.deepEqual(handled, ['bounty', 'bounty', 'bounty'], 'only what happened within the last 1.5 s plays');
    assert.equal(r.events.length, 0, 'the queue is empty again');
    // events handled in the frame they arrive are never stale, however long the frame takes to run
    handled.length = 0;
    vs.fire({ type: 'attack', src: -2, dst: -1, ranged: false });
    clock.advance(40);
    r.update(1 / 30);
    assert.deepEqual(handled, ['attack']);
  } finally {
    clock.restore();
    r.dispose();
  }
});

test('GameRenderer: a window drag reallocates the post targets once, after the size has held still', () => {
  const { r, webgl } = makeMatch({ post: true });
  const clock = fakeClock();
  try {
    const post = r.post;
    const first = post.scene;
    assert.ok(first && post.width === W && post.height === H);
    let allocs = 0;
    const allocate = post.allocate.bind(post);
    post.allocate = () => (allocs++, allocate());
    // dragging the window edge: a resize every frame
    for (let i = 1; i <= 20; i++) {
      r.resize(W - i * 10, H - i * 4);
      // the contract callers rely on: the size is applied at once ...
      assert.equal(r.viewW, W - i * 10);
      assert.equal(r.viewH, H - i * 4);
      assert.deepEqual(webgl.size, [W - i * 10, H - i * 4]);
      assert.ok(Math.abs(r.threeCamera.aspect - (W - i * 10) / (H - i * 4)) < 1e-6, 'the camera follows');
      // ... and the frame is drawn at once, into the old targets
      clock.advance(16);
      r.render();
      assert.equal(post.scene, first, 'no reallocation while the size changes');
    }
    assert.equal(allocs, 0);
    assert.ok(post.sizePending);
    assert.equal(post.canvasW, W - 200, 'the vignette aspect follows the canvas');
    // held still for less than the settle time: still the old targets
    clock.advance(60);
    r.render();
    assert.equal(allocs, 0);
    // settled: the next frame reallocates once, at the final size
    clock.advance(80);
    r.render();
    assert.equal(allocs, 1);
    assert.notEqual(post.scene, first);
    assert.equal(post.width, W - 200);
    assert.equal(post.height, H - 80);
    assert.ok(!post.sizePending);
    clock.advance(500);
    r.render();
    assert.equal(allocs, 1, 'and not again');
    // a repeated resize to the same size does not restart anything
    r.resize(W - 200, H - 80);
    assert.ok(!post.sizePending);
    // quality changes reallocate at the latest size at once
    r.resize(W, H);
    assert.ok(post.sizePending);
    r.setQuality('high');
    assert.ok(!post.sizePending);
    assert.equal(post.width, W);
    assert.ok(post.aoRaw && post.scene.width === W);
  } finally {
    clock.restore();
    r.dispose();
  }
});

test('GameRenderer: a held-back post size still lands when no frame follows (paused game)', () => {
  const { r, webgl } = makeMatch({ post: true });
  const clock = fakeClock();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const post = r.post;
    const first = post.scene;
    r.resize(W - 300, H - 100);
    assert.ok(post.sizePending);
    assert.equal(post.scene, first);
    const renders = webgl.renders;
    clock.advance(130);
    mock.timers.tick(130);
    assert.ok(!post.sizePending, 'the timer applied the size');
    assert.equal(post.width, W - 300);
    assert.equal(webgl.renders, renders + 2, 'and redrew once (world + overlays)');
    // another resize while it waits pushes the reallocation back
    r.resize(W - 310, H - 100);
    clock.advance(100);
    r.resize(W - 320, H - 100);
    clock.advance(40);
    mock.timers.tick(140);
    assert.ok(post.sizePending, 'sized again 40 ms ago');
    clock.advance(100);
    mock.timers.tick(100);
    assert.ok(!post.sizePending);
    assert.equal(post.width, W - 320);
    // no timer outlives the renderer
    r.resize(W - 400, H - 100);
    assert.ok(r.sizeTimer);
    r.dispose();
    assert.equal(r.sizeTimer, 0);
    const renders2 = webgl.renders;
    clock.advance(500);
    mock.timers.tick(500);
    assert.equal(webgl.renders, renders2);
  } finally {
    mock.timers.reset();
    clock.restore();
    r.dispose();
  }
});

test('GameRenderer: resize without a post pipeline just applies the size (stub WebGL)', () => {
  const { r, webgl } = makeMatch();
  assert.equal(r.post, null);
  r.resize(800, 450);
  assert.deepEqual(webgl.size, [800, 450]);
  assert.equal(r.viewW, 800);
  assert.equal(r.sizeTimer, 0);
  r.dispose();
});
