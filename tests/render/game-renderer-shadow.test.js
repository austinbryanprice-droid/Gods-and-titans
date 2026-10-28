// The sun's shadow box (GameRenderer.updateShadowCamera): fitted to the view as the sun sees it, so it
// covers every point of the view's ground (and what stands on it) at every time of day and zoom, and
// a low sun no longer stretches it far up-sun of the view. Real World and ViewState, stub WebGL.
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
const THREE = await import('three');
const { SUN_DIR } = await import('../../src/render/shading.js');
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

/** The light's frustum as three.js culls with it in the shadow pass. */
function shadowFrustum(r) {
  const sun = r.sun;
  sun.updateMatrixWorld();
  sun.target.updateMatrixWorld();
  sun.shadow.updateMatrices(sun);
  return sun.shadow.getFrustum();
}

test('the shadow box covers the whole view, and what stands on it, at every time of day and zoom', () => {
  const { r, step } = makeMatch();
  r.camera.centerOn(40, 40);
  for (const mode of ['day', 'golden', 'dusk', 'night', 'dawn']) {
    for (const dist of [18, 25, 44]) {
      r.setTimeOfDay(mode);
      r.camera.setDistance(dist, true);
      step(0.1);
      if (r.shadowShare <= 0.002) continue; // zoomed past the shadows
      const f = shadowFrustum(r);
      const quad = r.camera.getViewQuad();
      const gy = r.camera.groundY;
      const p = new THREE.Vector3();
      for (let i = 0; i < 4; i++) {
        const a = quad[i];
        const b = quad[(i + 1) % 4];
        for (let t = 0; t <= 1; t += 0.25) {
          for (const h of [0, 6]) {
            p.set(a.x + (b.x - a.x) * t, gy + h, a.y + (b.y - a.y) * t);
            assert.ok(f.containsPoint(p), `${mode} d${dist}: (${p.x.toFixed(1)}, ${h}, ${p.z.toFixed(1)}) is in the shadow box`);
          }
        }
      }
      // a caster a few units up-sun of the view's middle still draws into the map
      const mid = quad.reduce((s, q) => ({ x: s.x + q.x / 4, y: s.y + q.y / 4 }), { x: 0, y: 0 });
      p.set(mid.x, gy, mid.y).addScaledVector(SUN_DIR, 8 / Math.max(0.2, SUN_DIR.y));
      assert.ok(f.containsPoint(p), `${mode} d${dist}: a tall caster up-sun of the view is in the box`);
    }
  }
  r.dispose();
});

test('a low sun narrows the shadow box instead of stretching it up-sun', () => {
  const { r, step } = makeMatch();
  r.camera.centerOn(40, 40);
  r.camera.setDistance(25, true);
  const box = (mode) => {
    r.setTimeOfDay(mode);
    step(0.1);
    const c = r.sun.shadow.camera;
    return { w: c.right - c.left, h: c.top - c.bottom, sunY: SUN_DIR.y };
  };
  const noon = box('day');
  const gold = box('golden');
  assert.ok(gold.sunY < noon.sunY, 'the golden hour sun is lower');
  assert.ok(gold.h < gold.w, `seen from a low sun the view is shallower than it is wide (${gold.w} x ${gold.h})`);
  // the old square fit was as wide as the view's radius on both axes
  const quad = r.camera.getViewQuad();
  const cx = quad.reduce((s, q) => s + q.x / 4, 0);
  const cy = quad.reduce((s, q) => s + q.y / 4, 0);
  const rad = Math.max(...quad.map((q) => Math.hypot(q.x - cx, q.y - cy)));
  assert.ok(gold.w * gold.h < (2 * rad) ** 2 * 0.75, `the box is well under the old square (${gold.w * gold.h} vs ${(2 * rad) ** 2})`);
  r.dispose();
});
