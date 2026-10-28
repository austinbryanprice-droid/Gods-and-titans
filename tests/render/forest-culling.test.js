// Forest chunks are culled by their instances' bounding box as well as their sphere (props.js
// chunkInFrustum): the sphere of a 20-tile chunk reaches well past its corners, which drew whole
// chunks into the sun's shadow map (and the view) that no tree of theirs could reach.
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
const { createForest } = await import('../../src/render/models/props.js');
const { TERRAIN } = await import('../../src/config.js');

function forestMap(w = 44, h = 24) {
  const terrain = new Uint8Array(w * h).fill(TERRAIN.GRASS);
  for (let y = 3; y < 15; y++) for (let x = 3; x < 17; x++) terrain[y * w + x] = TERRAIN.FOREST;
  for (let y = 4; y < 9; y++) for (let x = 24; x < 30; x++) terrain[y * w + x] = TERRAIN.FOREST;
  return { width: w, height: h, terrain, heights: new Float32Array((w + 1) * (h + 1)), decor: [], seed: 3 };
}

/** A frustum that is just the axis-aligned box `b` (six planes facing in). */
function boxFrustum(b) {
  const P = (nx, ny, nz, c) => new THREE.Plane(new THREE.Vector3(nx, ny, nz), c);
  return new THREE.Frustum(P(1, 0, 0, -b.min.x), P(-1, 0, 0, b.max.x), P(0, 1, 0, -b.min.y), P(0, -1, 0, b.max.y), P(0, 0, 1, -b.min.z), P(0, 0, -1, b.max.z));
}

test('a forest chunk is drawn only where its trees can be, not wherever its bounding sphere reaches', () => {
  const f = createForest(forestMap(), null, { variants: ['pine', 'broadleaf'] });
  const chunks = [];
  f.object3d.traverse((o) => { if (o.isInstancedMesh && /^forest-(pine|broadleaf)$/.test(o.name)) chunks.push(o); });
  assert.ok(chunks.length >= 2, 'a few chunk meshes');
  let culled = 0;
  for (const m of chunks) {
    m.updateMatrixWorld();
    assert.ok(m.boundingBox, `${m.name} keeps its instances' box`);
    const box = m.boundingBox.clone().applyMatrix4(m.matrixWorld);
    const sphere = m.boundingSphere.clone().applyMatrix4(m.matrixWorld);
    // a spot the sphere covers outside the box (beyond a corner or a side), where one exists
    let q = null;
    for (const [x, y, z] of [[1, 1, 1], [-1, 1, -1], [1, 1, -1], [-1, 1, 1], [1, 0, 1], [-1, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [0, 1, 0]]) {
      const d = new THREE.Vector3(x, y, z).normalize();
      for (let t = 0; t < sphere.radius - 0.4 && !q; t += 0.1) {
        const p = sphere.center.clone().addScaledVector(d, t);
        if (!box.containsPoint(p)) q = p.addScaledVector(d, 0.2);
      }
      if (q) break;
    }
    if (q) {
      culled++;
      const beyond = boxFrustum(new THREE.Box3().setFromCenterAndSize(q, new THREE.Vector3(0.05, 0.05, 0.05)));
      assert.equal(beyond.intersectsObject(m), true, 'the sphere test alone would draw it');
      assert.equal(m.intersectsFrustum(beyond), false, `${m.name}: culled there`);
    }
    // and a view of one of its trees still draws it
    const at = new THREE.Matrix4();
    m.getMatrixAt(0, at);
    const tree = new THREE.Vector3().setFromMatrixPosition(at);
    const onTree = boxFrustum(new THREE.Box3().setFromCenterAndSize(tree, new THREE.Vector3(0.5, 0.5, 0.5)));
    assert.equal(m.intersectsFrustum(onTree), true, `${m.name}: drawn where its trees stand`);
  }
  assert.ok(culled >= 1, 'some chunk has sphere outside its box');
  f.dispose();
});
