// The foliage in a real GameRenderer (stub WebGL: Node has no GL): switching the quality tier
// swaps crowns and bushes to the other puff material, which must keep the fog of war.
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
const { PLAYER_COLORS } = await import('../../src/config.js');

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

function makeRenderer(quality) {
  const setup = {
    version: '0.1.0',
    seed: 4242,
    mapSize: 'small',
    players: ['greek', 'norse'].map((p, i) => ({ index: i, name: `P${i}`, team: i + 1, pantheon: p, color: PLAYER_COLORS[i], kind: 'human', difficulty: 'normal' })),
  };
  const world = createWorld(setup);
  const vs = new ViewState({ setup, mapData: world.mapData, myIndex: 0, interpDelayMs: 50 });
  vs.pushSnapshot(world.getSnapshot(), 1000);
  const canvas = { clientWidth: W, clientHeight: H, width: W, height: H, style: {} };
  return new GameRenderer(canvas, { viewState: vs, setup, quality, webgl: stubWebgl() });
}

/** Names of the foliage meshes whose material the fog of war has not patched. */
function unfogged(r) {
  const bad = [];
  for (const root of [r.forest.object3d, r.decor.object3d, r.undergrowth && r.undergrowth.object3d]) {
    if (!root) continue;
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) if (!m.userData.__fow) bad.push(`${o.name}:${m.name || m.type}`);
    });
  }
  return bad;
}

test('switching the quality tier keeps the fog of war on the swapped foliage materials', () => {
  const r = makeRenderer('medium');
  const puffs = (q) => r.forest.object3d.children.filter((m) => m.name === 'forest-broadleaf').map((m) => m.material);
  assert.deepEqual(unfogged(r), [], 'medium at the start');
  const medium = puffs()[0];
  r.setQuality('low');
  const low = puffs()[0];
  assert.notEqual(low, medium, 'low draws the puffs with their own material');
  assert.deepEqual(unfogged(r), [], 'after switching to low');
  r.setQuality('high');
  assert.equal(puffs()[0], medium, 'back to the first puff material');
  assert.deepEqual(unfogged(r), [], 'after switching back up');
  r.dispose();
});
