// Tests for the VFX system (src/render/vfx.js + vfx-*.js helpers): every schema
// shape, projectile kind and element is covered, nothing produces NaNs, the
// particle cap holds under load, everything is released when it finishes,
// camera shake decays, delays / homing / follow behave, and dispose() cleans up.
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
const { VFXSystem } = await import('../../src/render/vfx.js');
const { SHAPES } = await import('../../src/render/vfx-shapes.js');
const { PROJECTILE_SPECS } = await import('../../src/render/vfx-projectiles.js');
const { getPalette } = await import('../../src/render/vfx-palette.js');
const { VFX_SHAPES, PROJECTILES, ELEMENTS } = await import('../../src/data/schema.js');
const { ELEMENT_COLORS } = await import('../../src/config.js');

const hills = (x, y) => Math.sin(x * 0.31) * 0.6 + Math.cos(y * 0.23) * 0.4;
const DT = 1 / 60;
const KINDS = PROJECTILES.filter(Boolean);
const COUNTERS = ['effects', 'projectiles', 'particles', 'glows', 'decals', 'ribbons', 'flares', 'pillars', 'domes', 'instances'];

function make(opts) {
  const scene = new THREE.Scene();
  const vfx = new VFXSystem(scene, hills, opts);
  return { scene, vfx };
}

function step(vfx, seconds, each) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    vfx.update(DT);
    if (each) each(i);
  }
}

function assertIdle(vfx, what) {
  const s = vfx.stats();
  for (const k of COUNTERS) assert.equal(s[k], 0, `${what}: ${k} still active (${s[k]})`);
}

/** First non-finite value in the live part of every dynamic buffer, or null. */
function findNaN(vfx) {
  for (const layer of [vfx.add, vfx.alpha]) {
    for (const [name, arr, w] of [['pos', layer.aPos, 3], ['col', layer.aCol, 4], ['par', layer.aPar, 3]]) {
      for (let i = 0; i < layer.count * w; i++) if (!Number.isFinite(arr[i])) return `${layer.points.name}.${name}[${i}]`;
    }
  }
  for (let i = 0; i < vfx.glows.high * 3; i++) if (!Number.isFinite(vfx.glows.aPos[i])) return `glows.pos[${i}]`;
  for (const [k, b] of Object.entries(vfx.batches)) {
    const m = b.mesh.instanceMatrix.array;
    for (let i = 0; i < m.length; i++) if (!Number.isFinite(m[i])) return `${k}.instanceMatrix[${i}]`;
  }
  for (const r of vfx.ribbons.items || []) {
    if (!r.inUse) continue;
    const p = r.mesh.geometry.getAttribute('position').array;
    for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) return `ribbon.pos[${i}]`;
  }
  return null;
}

test('covers every schema shape, projectile kind and element', () => {
  for (const s of VFX_SHAPES) assert.ok(SHAPES[s], `no handler for shape ${s}`);
  for (const k of KINDS) assert.ok(PROJECTILE_SPECS[k], `no spec for projectile ${k}`);
  for (const el of ELEMENTS) {
    assert.ok(ELEMENT_COLORS[el], `config has no color for ${el}`);
    const p = getPalette(el);
    assert.equal(p.el, el);
    for (const c of [p.glow, p.core, p.mid, p.alt, p.tint, p.smoke]) {
      for (const v of [c.r, c.g, c.b]) assert.ok(v >= 0 && v <= 1, `${el} palette channel out of range`);
    }
  }
  assert.equal(getPalette('no-such-element').el, 'arcane');
});

test('every shape x element runs without NaNs and releases everything', () => {
  const { scene, vfx } = make();
  for (const shape of VFX_SHAPES) {
    for (const el of ELEMENTS) {
      vfx.spawnEffect({ el, shape, x: 20, y: 20, r: 2.5, fx: 14, fy: 17, points: [[14, 17], [18, 19], [21, 18], [24, 21]], duration: 2 });
    }
    step(vfx, 0.4);
    const bad = findNaN(vfx);
    assert.equal(bad, null, `${shape}: non-finite value in ${bad}`);
  }
  let peak = 0;
  step(vfx, 12, () => {
    const s = vfx.stats();
    peak = Math.max(peak, s.particles);
    assert.ok(s.particles <= s.particleCap, 'particle cap exceeded');
  });
  assert.ok(peak >= 0);
  assertIdle(vfx, 'shapes');
  assert.equal(findNaN(vfx), null);
  vfx.dispose();
  assert.equal(scene.children.length, 0);
});

test('each shape draws something on its own', () => {
  const { vfx } = make();
  for (const shape of VFX_SHAPES) {
    vfx.spawnEffect({ el: 'fire', shape, x: 10, y: 10, r: 2, fx: 5, fy: 9, points: [[5, 9], [10, 10], [12, 13]], duration: 1.5 });
    let drew = false;
    step(vfx, 1.0, () => {
      const s = vfx.stats();
      if (s.particles + s.decals + s.ribbons + s.flares + s.pillars + s.domes + s.instances + s.glows > 0) drew = true;
    });
    assert.ok(drew, `${shape} drew nothing`);
    vfx.clear();
    assertIdle(vfx, `${shape} after clear()`);
  }
  vfx.dispose();
});

test('every projectile kind x element flies, lands and cleans up', () => {
  const { vfx } = make();
  for (const kind of [...KINDS, null, 'not-a-kind']) {
    for (const el of ELEMENTS) {
      vfx.spawnProjectile({ kind, el, from: { x: 2, y: 3, h: 1.1 }, to: { x: 14, y: 9, h: 0.8 } });
    }
  }
  assert.equal(vfx.stats().projectiles, (KINDS.length + 2) * ELEMENTS.length);
  step(vfx, 0.3);
  assert.equal(findNaN(vfx), null);
  step(vfx, 10);
  assertIdle(vfx, 'projectiles');
  vfx.dispose();
});

test('projectile flight time and homing', () => {
  const { vfx } = make();
  vfx.spawnProjectile({ kind: 'arrow', el: 'physical', from: { x: 0, y: 0, h: 1 }, to: { x: 6, y: 0, h: 1 }, flight: 0.5 });
  step(vfx, 0.4);
  assert.equal(vfx.stats().projectiles, 1, 'landed too early');
  step(vfx, 0.2);
  assert.equal(vfx.stats().projectiles, 0, 'did not land on time');

  // homing: the target moves; the projectile still lands (no NaNs), and a vanished target ends it
  const target = { x: 8, y: 0 };
  let calls = 0;
  vfx.spawnProjectile({
    kind: 'orb', el: 'arcane', from: { x: 0, y: 0, h: 1 }, to: { x: 8, y: 0, h: 1 }, flight: 0.8,
    track(out) { calls++; target.y += 0.05; out.x = target.x; out.y = target.y; return true; },
  });
  vfx.spawnProjectile({ kind: 'fireball', el: 'fire', from: { x: 0, y: 0, h: 1 }, to: { x: 8, y: 4, h: 1 }, flight: 0.8, track: () => false });
  step(vfx, 0.3);
  assert.ok(calls > 0, 'track callback never called');
  assert.equal(findNaN(vfx), null);
  step(vfx, 6);
  assertIdle(vfx, 'homing');
  vfx.dispose();
});

test('unit event effects (hit, death, level up, summon, dust) run and clean up', () => {
  const { vfx } = make();
  for (const el of ELEMENTS) vfx.spawnHit({ x: 5, y: 5, h: 0.7, el });
  vfx.spawnHit({ x: 5, y: 5 });
  for (const scale of [0.6, 1, 2, 4, 6]) vfx.spawnDeath({ x: 8, y: 8, scale });
  vfx.spawnDeath({ x: 8, y: 8 });
  vfx.spawnLevelUp({ x: 3, y: 9 });
  for (const scale of [1, 1.7, 4]) for (const el of ['lightning', 'fire', 'nature', 'shadow']) vfx.spawnSummon({ x: 12, y: 4, scale, el });
  vfx.spawnSummon({ x: 12, y: 4 });
  for (const size of [0.5, 1, 3, 5]) vfx.spawnDust({ x: 2, y: 2, size });
  vfx.spawnDust({ x: 2, y: 2 });
  step(vfx, 0.5);
  assert.ok(vfx.stats().particles > 0);
  assert.equal(findNaN(vfx), null);
  step(vfx, 8);
  assertIdle(vfx, 'unit events');
  vfx.dispose();
});

test('bad input is ignored or falls back instead of throwing', () => {
  const { vfx } = make();
  vfx.spawnEffect({ el: 'fire', shape: 'nova', x: NaN, y: 3 });
  vfx.spawnEffect({});
  assert.equal(vfx.stats().effects, 0);
  vfx.spawnEffect({ el: 'nope', shape: 'nope', x: 3, y: 3 });
  vfx.spawnEffect({ el: 'fire', shape: 'chain', x: 3, y: 3, points: [[NaN, 1], null, [4, 4]] });
  vfx.spawnEffect({ el: 'water', shape: 'beam', x: 3, y: 3, fx: 3, fy: 3, r: -1, duration: -5 });
  vfx.spawnProjectile({ kind: 'arrow', el: 'fire' });
  vfx.spawnProjectile({ kind: 'arrow', from: { x: 1, y: 1 }, to: { x: 1, y: 1 } });
  vfx.spawnHit();
  vfx.spawnDeath();
  vfx.spawnSummon();
  vfx.spawnLevelUp();
  vfx.spawnDust();
  vfx.update(NaN);
  vfx.update(-1);
  vfx.update(5);
  step(vfx, 6);
  assert.equal(findNaN(vfx), null);
  assertIdle(vfx, 'bad input');
  vfx.dispose();
});

test('a broken height function does not poison positions', () => {
  const scene = new THREE.Scene();
  const vfx = new VFXSystem(scene, () => NaN);
  vfx.spawnEffect({ el: 'earth', shape: 'quake', x: 4, y: 4, r: 3 });
  vfx.spawnProjectile({ kind: 'rock', el: 'earth', from: { x: 0, y: 0 }, to: { x: 5, y: 5 } });
  step(vfx, 0.3);
  assert.equal(findNaN(vfx), null);
  vfx.dispose();
});

test('decals follow the terrain, or sit at a fixed height when flatY is given', async () => {
  const { createDecalPool, disposePool } = await import('../../src/render/vfx-layers.js');
  const root = new THREE.Group();
  const pool = createDecalPool(root, 2);
  const d = pool.acquire();
  d.layout(hills, 10, 12, 3, 1, 0.5, 2, 0.07);
  for (let k = 0; k < d.pos.length; k += 3) {
    assert.ok(Math.abs(d.pos[k + 1] - (hills(d.pos[k], d.pos[k + 2]) + 0.07)) < 1e-5, 'vertex on the terrain');
    const r = Math.hypot(d.pos[k] - 10, d.pos[k + 2] - 12);
    assert.ok(r > 1 - 1e-4 && r < 3 + 1e-4, `vertex at radius ${r}`);
  }
  d.layout(hills, 10, 12, 3, 0, 0, Math.PI * 2, 0, 4.25);
  for (let k = 0; k < d.pos.length; k += 3) assert.equal(d.pos[k + 1], 4.25);
  disposePool(pool);
});

test('particle cap holds under extreme load and the budget degrades', () => {
  const { vfx } = make({ maxParticles: 600 });
  let minBudget = 1;
  for (let wave = 0; wave < 4; wave++) {
    for (const shape of VFX_SHAPES) for (const el of ELEMENTS) vfx.spawnEffect({ el, shape, x: 10, y: 10, r: 4, fx: 2, fy: 2, duration: 3 });
    for (let i = 0; i < 60; i++) vfx.spawnHit({ x: 10, y: 10, h: 1, el: ELEMENTS[i % ELEMENTS.length] });
    step(vfx, 0.25, () => {
      const s = vfx.stats();
      assert.ok(s.particles <= s.particleCap, `cap exceeded: ${s.particles}/${s.particleCap}`);
      minBudget = Math.min(minBudget, s.budget);
    });
  }
  assert.equal(vfx.stats().particleCap, 600);
  assert.ok(minBudget < 1, 'emission budget never reduced under load');
  step(vfx, 15);
  assertIdle(vfx, 'stress');
  vfx.dispose();
});

test('quality scales particle counts', () => {
  const count = (quality) => {
    const { vfx } = make({ quality });
    for (let i = 0; i < 40; i++) vfx.spawnEffect({ el: 'holy', shape: 'nova', x: 10, y: 10, r: 2 });
    vfx.update(DT);
    const n = vfx.stats().particles;
    vfx.dispose();
    return n;
  };
  const hi = count('high');
  const lo = count('low');
  assert.ok(hi > 0);
  assert.ok(lo < hi * 0.8, `low quality emitted ${lo} vs high ${hi}`);
  const { vfx } = make();
  vfx.setQuality('low');
  assert.equal(vfx.quality, 'low');
  vfx.setQuality('ultra');
  assert.equal(vfx.quality, 'low');
  vfx.dispose();
});

test('camera shake rises on impacts, decays to zero and is attenuated far away', () => {
  const { vfx } = make();
  vfx.setFocus(10, 10);
  assert.equal(vfx.shake, 0);
  vfx.spawnEffect({ el: 'earth', shape: 'quake', x: 11, y: 10, r: 3 });
  vfx.update(DT);
  const s0 = vfx.shake;
  assert.ok(s0 > 0.1, `quake shake too small: ${s0}`);
  assert.ok(s0 <= 1);
  step(vfx, 0.2);
  assert.ok(vfx.shake < s0 + 0.25, 'shake should be decaying');
  step(vfx, 4);
  assert.equal(vfx.shake, 0);

  vfx.spawnEffect({ el: 'earth', shape: 'quake', x: 90, y: 90, r: 3 });
  vfx.update(DT);
  assert.equal(vfx.shake, 0, 'off-screen quake should not shake the camera');
  vfx.addShake(5, 10, 10);
  assert.ok(vfx.shake <= 1, 'shake is clamped');
  vfx.dispose();
});

test('delayed effects telegraph first and fire after the delay', () => {
  const { vfx } = make();
  vfx.setFocus(5, 5);
  vfx.spawnEffect({ el: 'fire', shape: 'quake', x: 5, y: 5, r: 2, delay: 0.6 });
  step(vfx, 0.3);
  assert.equal(vfx.shake, 0, 'fired before the delay');
  assert.equal(vfx.stats().decals, 1, 'expected only the telegraph ring');
  step(vfx, 0.4);
  assert.ok(vfx.shake > 0, 'did not fire after the delay');
  // meteor and storm handle their own delay (fall time / first strike)
  vfx.spawnEffect({ el: 'fire', shape: 'meteor', x: 5, y: 5, r: 2, delay: 1.2 });
  vfx.spawnEffect({ el: 'lightning', shape: 'storm', x: 5, y: 5, r: 3, delay: 0.5, duration: 2 });
  step(vfx, 8);
  assertIdle(vfx, 'delays');
  vfx.dispose();
});

test('follow keeps shields on a moving unit and survives the unit vanishing', () => {
  const { vfx } = make();
  const unit = { x: 3, y: 3, alive: true };
  vfx.spawnEffect({
    el: 'holy', shape: 'shield', x: unit.x, y: unit.y, r: 1, duration: 3,
    follow(out) { if (!unit.alive) return false; out.x = unit.x; out.y = unit.y; return true; },
  });
  const dome = vfx.domes.items.find((d) => d.inUse);
  assert.ok(dome, 'shield should use a dome');
  step(vfx, 0.5, () => { unit.x += 0.05; });
  assert.ok(Math.abs(dome.mesh.position.x - unit.x) < 0.06, 'dome did not follow the unit');
  unit.alive = false;
  step(vfx, 0.2);
  assert.equal(findNaN(vfx), null);
  step(vfx, 4);
  assertIdle(vfx, 'follow');
  vfx.dispose();
});

test('dispose detaches everything and later calls are no-ops', () => {
  const { scene, vfx } = make();
  vfx.spawnEffect({ el: 'arcane', shape: 'storm', x: 5, y: 5, r: 3, duration: 3 });
  vfx.spawnProjectile({ kind: 'skull', el: 'death', from: { x: 0, y: 0 }, to: { x: 5, y: 5 } });
  step(vfx, 0.5);
  assert.equal(scene.children.length, 1);
  vfx.dispose();
  assert.equal(scene.children.length, 0);
  vfx.dispose();
  vfx.update(DT);
  vfx.spawnEffect({ el: 'fire', shape: 'nova', x: 1, y: 1 });
  vfx.spawnProjectile({ kind: 'arrow', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } });
  assert.equal(vfx.stats().effects, 0);
  assert.equal(scene.children.length, 0);
});
