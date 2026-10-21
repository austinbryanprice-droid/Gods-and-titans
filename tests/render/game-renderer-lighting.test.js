// The time of day in the 3D view (atmosphere.js through GameRenderer.updateLook / updateLamps):
// the haze is measured from the point the camera looks at, the grade lives in the post look on
// medium and up and in the lights on low, the lit buildings pool warm light after dusk, and the
// shared shader uniforms follow the sky. Real World and ViewState, stub WebGL (Node has no GL).
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
const { WORLD_UNIFORMS, LAMP_SPOTS, setLampSpots } = await import('../../src/render/shading.js');
const { DEFAULT_LOOK } = await import('../../src/render/post.js');
const { createWorld } = await import('../../src/sim/world.js');
const { ViewState } = await import('../../src/game/view-state.js');
const { PLAYER_COLORS, DT } = await import('../../src/config.js');

const W = 1280;
const H = 720;

/** A stand-in for THREE.WebGLRenderer; with `post` it has the render-target API, so medium and up build the post pipeline. */
function stubWebgl({ post = false } = {}) {
  const gl = {
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
  if (!post) return gl;
  return Object.assign(gl, {
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
  });
}

function makeMatch({ quality = 'medium', post = true } = {}) {
  const setup = {
    version: '0.1.0',
    seed: 4242,
    mapSize: 'small',
    players: ['greek', 'norse'].map((p, i) => ({ index: i, name: `P${i}`, team: i + 1, pantheon: p, color: PLAYER_COLORS[i], kind: 'human', difficulty: 'normal' })),
  };
  const world = createWorld(setup);
  const vs = new ViewState({ setup, mapData: world.mapData, myIndex: 0, interpDelayMs: 50 });
  let now = 1000;
  vs.pushSnapshot(world.getSnapshot(), now);
  const canvas = { clientWidth: W, clientHeight: H, width: W, height: H, style: {} };
  const r = new GameRenderer(canvas, { viewState: vs, setup, quality, webgl: stubWebgl({ post }) });
  const step = (seconds, fps = 30) => {
    const n = Math.max(1, Math.round(seconds * fps));
    for (let i = 0; i < n; i++) {
      now += 1000 / fps;
      world.tick();
      vs.pushSnapshot(world.getSnapshot(), now);
      vs.update(now);
      r.update(1 / fps);
    }
  };
  return { world, vs, r, step };
}

test('the haze is measured from the point the camera looks at, so zooming out does not fog the middle', () => {
  const { r, step } = makeMatch();
  r.setTimeOfDay('golden');
  r.camera.setDistance(20, true);
  step(0.2);
  const fog = r.scene.fog;
  const near = fog.near;
  const far = fog.far;
  assert.ok(near > r.camera.distance - 20 && far > near + 20, 'the haze starts around the middle of the view, not before');
  r.camera.setDistance(40, true);
  step(0.2);
  assert.ok(Math.abs(fog.near - near - 20) < 1e-6, 'zoom out 20 and the haze moves out 20');
  assert.ok(Math.abs(fog.far - far - 20) < 1e-6);
  assert.ok(Math.abs(fog.far - fog.near - (far - near)) < 1e-6, 'it keeps its depth');
  r.dispose();
});

test('medium and up keep the grade in the post look; low bakes it into the lights', () => {
  const med = makeMatch({ quality: 'medium' });
  const low = makeMatch({ quality: 'low', post: false });
  assert.ok(med.r.post && med.r.post.enabled, 'medium grades in post');
  assert.ok(!low.r.post || !low.r.post.enabled, 'low draws without it');
  for (const m of [med, low]) m.r.setTimeOfDay('dusk');
  const s = med.r.atmo.state;
  const look = med.r.post.look;
  assert.deepEqual([...look.highlightTint], [...s.highlightTint]);
  assert.equal(look.glow, s.glow);
  assert.ok(look.glow > 0, 'the dusk glow is on');
  assert.deepEqual([look.glowColor[0], look.glowColor[1], look.glowColor[2]], [s.skyHorizon.r, s.skyHorizon.g, s.skyHorizon.b], 'the glow takes the horizon color');
  // the key light: medium leaves its hue alone (post tints it), low multiplies the tint in
  assert.ok(Math.abs(med.r.sun.color.r - s.keyHue.r) < 1e-6 && Math.abs(med.r.sun.color.b - s.keyHue.b) < 1e-6);
  const t = low.r.atmo.state.highlightTint;
  assert.ok(Math.abs(low.r.sun.color.r - low.r.atmo.state.keyHue.r * t[0]) < 1e-6);
  assert.ok(Math.abs(low.r.sun.color.b - low.r.atmo.state.keyHue.b * t[2]) < 1e-6);
  assert.ok(Math.abs(low.r.sun.intensity - low.r.atmo.state.keyIntensity) < 1e-9);
  med.r.dispose();
  low.r.dispose();
});

test('the post look is its own copy: one renderer cannot repaint the default for the next', () => {
  const a = makeMatch();
  const b = makeMatch();
  const before = JSON.stringify(DEFAULT_LOOK);
  const bGlow = [...b.r.post.look.glowColor];
  const bTint = [...b.r.post.look.highlightTint];
  a.r.setTimeOfDay('night');
  assert.equal(JSON.stringify(DEFAULT_LOOK), before, 'the defaults are untouched');
  for (const k of ['shadowTint', 'highlightTint', 'glowColor']) assert.notStrictEqual(a.r.post.look[k], DEFAULT_LOOK[k], `${k} is copied`);
  assert.notStrictEqual(a.r.post.look.glowColor, b.r.post.look.glowColor);
  assert.deepEqual([...b.r.post.look.glowColor], bGlow, 'the other renderer has not been touched');
  assert.deepEqual([...b.r.post.look.highlightTint], bTint);
  a.r.dispose();
  b.r.dispose();
});

test('after dusk the finished buildings pool warm light, nearest to the view first; by day none', () => {
  const { r, vs, step } = makeMatch();
  const u = WORLD_UNIFORMS.uLampSpot.value;
  r.setTimeOfDay('day');
  step(0.2);
  assert.ok(WORLD_UNIFORMS.uLamp.value < 0.02, 'no lamps at noon');
  assert.ok(u.every((p) => p.w === 0), 'and no pools');

  r.setTimeOfDay('night');
  step(0.2);
  assert.ok(WORLD_UNIFORMS.uLamp.value > 0.9, 'lit at night');
  assert.ok(WORLD_UNIFORMS.uNight.value > 0.9);
  const lit = u.filter((p) => p.w > 0);
  assert.ok(lit.length >= 1 && lit.length <= LAMP_SPOTS, `${lit.length} pools`);
  const tc = [...vs.entities.values()].find((e) => e.k === 'b' && e.o === 0 && e.t === 'town_center');
  const hall = r.buildings.get(tc.id);
  const p = u[0];
  assert.ok(Math.abs(p.x - (hall.tx + hall.size / 2)) < 1e-4, 'in front of the door: centered on the hall');
  assert.ok(Math.abs(p.z - (hall.ty + hall.size + 0.1)) < 1e-4, 'on its south face');
  assert.ok(p.y > hall.model.root.position.y && p.y < hall.model.root.position.y + 3, 'at lantern height');
  assert.ok(p.w > 2, 'with a reach');
  for (let i = 1; i < lit.length; i++) {
    const d = (q) => Math.hypot(q.x - r.camera.target.x, q.z - r.camera.target.y);
    assert.ok(d(u[i - 1]) <= d(u[i]) + 1e-6, 'sorted nearest first');
  }

  // a hall still going up has no lit windows yet
  const bp = hall.e.bp;
  hall.e.bp = 0.4;
  r.updateLamps();
  assert.ok(!u.some((q) => q.w > 0 && Math.abs(q.x - (hall.tx + hall.size / 2)) < 1e-4), 'no pool at a building site');
  hall.e.bp = bp;

  r.setTimeOfDay('golden');
  step(0.2);
  assert.ok(u.every((q) => q.w === 0), 'morning puts the lamps out');
  r.dispose();
});

test('setLampSpots fills the first spots and switches the rest off', () => {
  const u = WORLD_UNIFORMS.uLampSpot.value;
  const spots = new Float32Array(LAMP_SPOTS * 4).fill(1);
  setLampSpots(spots, LAMP_SPOTS);
  assert.ok(u.every((p) => p.w === 1));
  spots.set([4, 5, 6, 7], 0);
  setLampSpots(spots, 1);
  assert.deepEqual([u[0].x, u[0].y, u[0].z, u[0].w], [4, 5, 6, 7]);
  assert.ok(u.slice(1).every((p) => p.w === 0), 'the unused spots reach nowhere');
  setLampSpots(spots, 0);
  assert.ok(u.every((p) => p.w === 0));
});

test('the light shafts rise as the sun goes low and fade for the moon', () => {
  const { r, step } = makeMatch();
  const shaft = (mode) => {
    r.setTimeOfDay(mode);
    step(0.1);
    return WORLD_UNIFORMS.uShaft.value;
  };
  const noon = shaft('day');
  const gold = shaft('golden');
  const dusk = shaft('dusk');
  assert.ok(gold > noon + 0.2 && dusk > noon + 0.2, `low sun streaks the shadows (${noon}, ${gold}, ${dusk})`);
  assert.ok(shaft('night') < gold, 'the moon streaks them less');
  r.dispose();
});

test('a whole day keeps the renderer sane: every frame has finite lights and a valid haze', () => {
  const { r, step } = makeMatch();
  r.setTimeOfDay('cycle');
  const fog = r.scene.fog;
  for (let k = 0; k < 40; k++) {
    step(30, 2); // 30 s of match time a step: past the whole 15-minute day
    const s = r.sun;
    for (const v of [s.intensity, s.color.r, s.color.g, s.color.b, r.hemi.intensity, fog.near, fog.far, r.renderer.toneMappingExposure]) assert.ok(Number.isFinite(v), `frame ${k}`);
    assert.ok(fog.far > fog.near && fog.near > 0);
    assert.ok(s.intensity >= 0 && r.hemi.intensity > 0, 'the light never goes negative, and the ambient never goes out');
  }
  r.dispose();
});
