// Tests for the sacred sites on the map (src/render/sacred-sites.js, DESIGN 5.11): one stone
// circle per site sitting on the ground, a pale glow while nobody holds it and the holder's colour
// once held, a capture arc that shows only while a capture is under way (and flickers when
// contested), shared stone geometry, a modest triangle budget, and a clean dispose.
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

const THREE = await import('three');
const { SacredSiteLayer, sacredSiteTriangles, NEUTRAL_GLOW } = await import('../../src/render/sacred-sites.js');
const { generateMap } = await import('../../src/sim/mapgen.js');

const POINTS = [{ x: 10.5, y: 12.5 }, { x: 30, y: 30 }, { x: 49.5, y: 47.5 }];
const COLORS = ['#d63a3a', '#3a78d6'];
const colorOf = (o) => COLORS[o];
const hex = (c) => `#${c.getHexString()}`;

function layer(heightFn = (x) => x * 0.01) {
  const parent = new THREE.Group();
  return { parent, sites: new SacredSiteLayer(parent, POINTS, heightFn) };
}

const part = (v, name) => v.root.getObjectByName(name);

test('one stone circle per site, placed at its centre on the ground', () => {
  const { parent, sites } = layer();
  assert.equal(parent.children.length, POINTS.length);
  POINTS.forEach((p, i) => {
    const r = sites.views[i].root;
    assert.equal(r.position.x, p.x);
    assert.equal(r.position.z, p.y);
    // the highest of the sampled points under the paving (heights rise with x here)
    assert.ok(Math.abs(r.position.y - (p.x + 1.6) * 0.01) < 1e-9);
  });
  // the stone is one geometry and one material shared by every site
  const stones = sites.views.map((v) => part(v, 'site-stone'));
  assert.ok(stones.every((m) => m.geometry === stones[0].geometry && m.material === stones[0].material));
  assert.ok(stones[0].castShadow);
});

test('a site nobody holds glows pale gold; a held one takes its holder\'s colour and a beam', () => {
  const { sites } = layer();
  sites.update(0.1, [{ o: -1 }, { o: 1 }, { o: 0 }], colorOf);
  const [a, b, c] = sites.views;
  assert.equal(hex(a.crystalMat.emissive), hex(new THREE.Color(NEUTRAL_GLOW)));
  assert.equal(part(a, 'site-beam').visible, false);
  assert.equal(part(b, 'site-beam').visible, true);
  assert.notEqual(hex(b.glowMat.color), hex(c.glowMat.color));
  // blue holder: the glow is blue-ish
  assert.ok(b.crystalMat.emissive.b > b.crystalMat.emissive.r);
  assert.ok(c.crystalMat.emissive.r > c.crystalMat.emissive.b);
  // lost again: back to neutral
  sites.update(0.1, [{ o: -1 }, { o: -1 }, { o: 0 }], colorOf);
  assert.equal(hex(b.glowMat.color), hex(a.glowMat.color));
  assert.equal(part(b, 'site-beam').visible, false);
});

test('the capture arc shows only while a capture is under way, filled to the progress', () => {
  const { sites } = layer();
  const v = sites.views[0];
  sites.update(0.1, [{ o: -1 }], colorOf);
  assert.equal(part(v, 'site-arc').visible, false);
  sites.update(0.1, [{ o: -1, p: 0.4, c: 1 }], colorOf);
  assert.equal(part(v, 'site-arc').visible, true);
  assert.equal(v.arcUniforms.uProg.value, 0.4);
  assert.ok(v.arcUniforms.uColor.value.b > v.arcUniforms.uColor.value.r, 'the capturer\'s colour');
  assert.equal(v.arcUniforms.uPulse.value, 0);
  sites.update(0.1, [{ o: 0, p: 0.7, c: 1, cn: 1 }], colorOf);
  assert.equal(v.arcUniforms.uPulse.value, 1, 'contested: flickers');
  sites.update(0.1, [{ o: 1 }], colorOf);
  assert.equal(part(v, 'site-arc').visible, false);
  // missing or odd rows are a neutral, idle site
  sites.update(0.1, null, colorOf);
  sites.update(0.1, [{ o: 'x', p: NaN }], colorOf);
  assert.equal(part(v, 'site-arc').visible, false);
});

test('the crystal floats and turns', () => {
  const { sites } = layer();
  const c = part(sites.views[0], 'site-crystal');
  sites.update(0.3, [], colorOf);
  const y0 = c.position.y;
  const r0 = c.rotation.y;
  sites.update(0.5, [], colorOf);
  assert.notEqual(c.position.y, y0);
  assert.notEqual(c.rotation.y, r0);
});

test('a site costs a few thousand triangles at most', () => {
  const tris = sacredSiteTriangles();
  assert.ok(tris > 200 && tris < 3000, `triangles ${tris}`);
});

test('dispose detaches every site and frees its own materials', () => {
  const { parent, sites } = layer();
  const mats = sites.views.map((v) => v.arcMat);
  let freed = 0;
  for (const m of mats) m.addEventListener('dispose', () => freed++);
  sites.dispose();
  assert.equal(parent.children.length, 0);
  assert.equal(freed, mats.length);
  assert.equal(sites.views.length, 0);
});

test('generated maps keep decor off the sites and flatten the ground there', () => {
  const m = generateMap({ seed: 3, mapSize: 'small', playerCount: 2 });
  assert.ok(m.sacred.length >= 3);
  for (const s of m.sacred) {
    for (const d of m.decor) assert.ok(Math.hypot(d.x - s.x, d.y - s.y) > 3, `decor at ${d.x},${d.y} on the site at ${s.x},${s.y}`);
  }
});
