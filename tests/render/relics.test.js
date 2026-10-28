// Relics in the 3D view (src/render/relics.js): a jewel under a light beam on the ground, smaller
// over a carrier's head, over the Temple where it rests, hidden where the player cannot know it.
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
const { RelicLayer } = await import('../../src/render/relics.js');

function fakeVs(relics, { explored = true, visible = true } = {}) {
  return {
    relics,
    relicKnown: () => explored,
    isEntityVisible: () => visible,
    relicsIn: (id) => relics.filter((r) => r.s === 'h' && r.b === id),
  };
}

test('one view per relic, placed by its state, and gone when the relic list drops it', () => {
  const root = new THREE.Group();
  const layer = new RelicLayer(root, () => 2);
  const unitRoot = new THREE.Object3D();
  unitRoot.position.set(5, 1, 6);
  const units = new Map([[7, { visible: true, fade: 1, far: false, height: 1.5, model: { root: unitRoot } }]]);
  const buildings = new Map([[9, { x: 12, y: 14, baseY: 0.5, height: 3, e: { id: 9 } }]]);
  const relics = [
    { i: 0, t: 'golden_fleece', s: 'k', x: 20, y: 30 },
    { i: 1, t: 'kusanagi', s: 'c', c: 7, o: 0 },
    { i: 2, t: 'amrita', s: 'h', b: 9, o: 0 },
  ];
  layer.update(fakeVs(relics), 1, units, buildings);
  assert.equal(root.children.length, 3);
  const [g, c, h] = [0, 1, 2].map((i) => layer.views.get(i));
  assert.ok(g.root.visible && g.beam.visible, 'a guarded relic stands under its beam');
  assert.deepEqual([g.root.position.x, g.root.position.y, g.root.position.z], [20, 2, 30]);
  assert.ok(c.root.visible && !c.beam.visible);
  assert.equal(c.root.position.x, 5);
  assert.ok(c.root.position.y > 1 + 1.5, 'over the carrier\'s head');
  assert.ok(c.jewel.scale.x < 1, 'smaller while carried');
  assert.ok(h.root.visible && h.root.position.y > 3.5, 'over the Temple roof');
  // the carrier walks out of sight, the ground relic out of what was explored
  units.get(7).visible = false;
  layer.update(fakeVs(relics, { explored: false }), 2, units, buildings);
  assert.equal(c.root.visible, false);
  assert.equal(g.root.visible, false);
  // a relic that is no longer listed goes; a different type at an index gets a new view
  layer.update(fakeVs([{ i: 0, t: 'peaches', s: 'g', x: 1, y: 1 }]), 3, units, buildings);
  assert.equal(root.children.length, 1);
  assert.equal(layer.views.get(0).type, 'peaches');
  layer.dispose();
  assert.equal(root.children.length, 0);
});
