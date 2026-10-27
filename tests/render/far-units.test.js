// The far unit markers (src/render/far-units.js): one instanced mesh of small team-colored figures.
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
const { FarUnits, farUnitGeometry } = await import('../../src/render/far-units.js');

test('far markers: a small figure of height one, smooth, facing outward, a few dozen triangles', () => {
  const g = farUnitGeometry();
  assert.equal(g.index.count / 3, 54);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const col = g.attributes.color;
  assert.equal(pos.count, nor.count);
  assert.equal(pos.count, col.count);
  g.computeBoundingBox();
  assert.ok(Math.abs(g.boundingBox.min.y) < 1e-9 && Math.abs(g.boundingBox.max.y - 1) < 1e-9, 'foot on the ground, one unit tall');
  assert.ok(g.boundingBox.max.x > 0.1 && g.boundingBox.max.x < 0.25, 'a person is slim');
  for (let i = 0; i < nor.count; i++) {
    assert.ok(Math.abs(Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i)) - 1) < 1e-4);
    assert.ok(col.getX(i) > 0.3 && col.getX(i) <= 1, 'shaded, never black');
  }
  // darker at the foot than at the head
  let foot = 0;
  let head = 0;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < 0.01) foot = col.getX(i);
    if (pos.getY(i) > 0.99) head = col.getX(i);
  }
  assert.ok(head > foot);
  // faces turn outward
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const fn = new THREE.Vector3();
  const idx = g.index.array;
  for (let t = 0; t < idx.length; t += 3) {
    a.fromBufferAttribute(pos, idx[t]);
    b.fromBufferAttribute(pos, idx[t + 1]);
    c.fromBufferAttribute(pos, idx[t + 2]);
    fn.subVectors(b, a).cross(c.clone().sub(a));
    const m = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    m.y = 0;
    assert.ok(fn.lengthSq() < 1e-12 || fn.dot(m) > 0, `face ${t / 3} turns toward the axis`);
  }
});

test('far markers: begin, add and end make one instanced draw of what was added, growing past the first size', () => {
  const root = new THREE.Group();
  const f = new FarUnits(root);
  assert.equal(root.children.length, 1);
  assert.equal(f.mesh.count, 0);
  const red = new THREE.Color('#d03020');
  const blue = new THREE.Color('#2040d0');
  f.begin();
  f.add(10, 2, 20, 1.5, 1, red);
  f.add(11, 2.5, 21, 3, 1.6, blue, 0.5);
  f.end();
  assert.equal(f.mesh.count, 2);
  assert.ok(f.mesh.visible);
  const m = f.mesh.instanceMatrix.array;
  // scale, then translation (the foot of the figure)
  assert.deepEqual([m[0], m[5], m[10], m[12], m[13], m[14], m[15]], [1.5, 1.5, 1.5, 10, 2, 20, 1]);
  const width = 3 * 1.6 * 0.5;
  assert.ok(Math.abs(m[16] - width) < 1e-6 && Math.abs(m[16 + 5] - 1.5) < 1e-6 && Math.abs(m[16 + 10] - width) < 1e-6, 'a fading unit shrinks');
  assert.deepEqual([m[16 + 12], m[16 + 13], m[16 + 14]], [11, 2.5, 21]);
  const c = f.mesh.instanceColor.array;
  assert.ok(Math.abs(c[0] - red.r) < 1e-6 && Math.abs(c[3 + 2] - blue.b) < 1e-6);
  // a new frame starts over
  f.begin();
  f.add(1, 0, 1, 1, 1, red);
  f.end();
  assert.equal(f.mesh.count, 1);
  f.begin();
  f.end();
  assert.equal(f.mesh.count, 0);
  assert.equal(f.mesh.visible, false, 'nothing to draw');
  // more than the first capacity: nothing already added is lost, the mesh is swapped in place
  const first = f.mesh;
  f.begin();
  for (let i = 0; i < 400; i++) f.add(i, i * 0.01, -i, 1 + (i % 3), 1, i % 2 ? red : blue);
  f.end();
  assert.notEqual(f.mesh, first, 'a bigger mesh');
  assert.equal(root.children.length, 1, 'the old one left the scene');
  assert.equal(f.mesh.count, 400);
  assert.ok(f.capacity >= 400);
  const a = f.mesh.instanceMatrix.array;
  for (const i of [0, 127, 128, 255, 399]) {
    assert.equal(a[i * 16 + 12], i);
    assert.equal(a[i * 16 + 14], -i);
    assert.equal(a[i * 16 + 5], 1 + (i % 3));
  }
  assert.equal(f.mesh.frustumCulled, false);
  assert.equal(f.mesh.castShadow, false);
  assert.equal(f.mesh.receiveShadow, false);
  f.dispose();
  assert.equal(root.children.length, 0);
});

test('far markers: the material has the world light and the fog of war', () => {
  const f = new FarUnits(new THREE.Group());
  const m = f.material;
  assert.ok(m.vertexColors);
  assert.ok(m.userData.__world, 'lit like the rest of the world');
  assert.ok(m.userData.__fow, 'hidden by the fog of war');
  f.dispose();
});
