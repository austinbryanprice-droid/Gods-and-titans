// The zoom curves and detail levels (src/render/zoom-lod.js): pure functions of the camera distance and the
// window height, so the numbers a look depends on are pinned here.
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

const { CAMERA_DEFAULTS } = await import('../../src/render/camera.js');
const Z = await import('../../src/render/zoom-lod.js');

const near = CAMERA_DEFAULTS.midDistance;
const far = CAMERA_DEFAULTS.maxDistance;
const steps = (a, b, n = 60) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);

test('zoom: haze, shadow and ambient occlusion keep the old look up to the old far limit', () => {
  assert.equal(Z.NEAR_RANGE, near);
  for (const d of steps(CAMERA_DEFAULTS.minDistance, near)) assert.equal(Z.hazeStretch(d), 1, `haze at ${d}`);
  for (const d of steps(CAMERA_DEFAULTS.minDistance, 48)) assert.equal(Z.shadowShare(d), 1, `shadow at ${d}`);
  for (const d of steps(CAMERA_DEFAULTS.minDistance, 60)) assert.equal(Z.aoShare(d), 1, `ao at ${d}`);
});

test('zoom: the curves are continuous and run one way, to the ends they promise', () => {
  const ds = steps(CAMERA_DEFAULTS.minDistance, far, 300);
  const mono = (f, dir, name) => {
    for (let i = 1; i < ds.length; i++) assert.ok(dir * (f(ds[i]) - f(ds[i - 1])) >= -1e-12, `${name} turns back at ${ds[i]}`);
  };
  const smooth = (f, name, jump) => {
    for (let i = 1; i < ds.length; i++) assert.ok(Math.abs(f(ds[i]) - f(ds[i - 1])) < jump, `${name} jumps at ${ds[i]}`);
  };
  mono(Z.hazeStretch, 1, 'haze');
  mono(Z.shadowShare, -1, 'shadow');
  mono(Z.aoShare, -1, 'ao');
  mono((d) => Z.overlayScale(d), 1, 'overlay');
  smooth(Z.hazeStretch, 'haze', 0.03);
  smooth(Z.shadowShare, 'shadow', 0.05);
  smooth(Z.aoShare, 'ao', 0.05);
  smooth((d) => Z.overlayScale(d), 'overlay', 0.03);
  assert.equal(Z.shadowShare(88), 0);
  assert.equal(Z.shadowShare(far), 0);
  assert.equal(Z.aoShare(110), 0);
  assert.ok(Z.hazeStretch(far) > 2 && Z.hazeStretch(far) < 3, `haze at the far end: ${Z.hazeStretch(far)}`);
  assert.equal(Z.smoothstep(0, 1, -5), 0);
  assert.equal(Z.smoothstep(0, 1, 5), 1);
  assert.equal(Z.smoothstep(0, 1, 0.5), 0.5);
});

test('zoom: overlays grow like they always did up to the old limit and keep growing past it', () => {
  const old = (d) => Math.min(1.45, Math.max(0.78, (d / CAMERA_DEFAULTS.defaultDistance) ** 0.55));
  for (const d of steps(CAMERA_DEFAULTS.minDistance, 49)) assert.ok(Math.abs(Z.overlayScale(d) - old(d)) < 1e-9, `overlay at ${d}`);
  assert.ok(Z.overlayScale(far) > 2.2 && Z.overlayScale(far) < 4.5, `overlay at the far end: ${Z.overlayScale(far)}`);
  // slower than the view shrinks: the drawn size (scale / distance) still falls
  for (let i = 1; i < 100; i++) {
    const a = 44 + i;
    assert.ok(Z.overlayScale(a + 1) / (a + 1) < Z.overlayScale(a) / a, `overlays outgrow the view at ${a}`);
  }
});

test('zoom: what is drawn over a crowd follows the zoom as the overlays do up to their old limit, then more slowly', () => {
  for (const d of steps(CAMERA_DEFAULTS.minDistance, 49)) assert.ok(Math.abs(Z.crowdScale(d) - Z.overlayScale(d)) < 1e-9, `crowd scale at ${d}`);
  let prev = 0;
  for (const d of steps(CAMERA_DEFAULTS.minDistance, far, 200)) {
    const k = Z.crowdScale(d);
    assert.ok(k >= prev - 1e-12, `crowd scale turns back at ${d}`);
    assert.ok(k <= Z.overlayScale(d) + 1e-12, `a crowd's bars are never bigger than the others at ${d}`);
    prev = k;
  }
  assert.ok(Z.crowdScale(far) > 2 && Z.crowdScale(far) < 3.2, `${Z.crowdScale(far)}`);
  // the size on the screen falls with the zoom, and faster than the other overlays'
  for (let d = 50; d < far; d++) assert.ok(Z.crowdScale(d + 1) / (d + 1) < Z.crowdScale(d) / d);
  assert.ok(Z.crowdScale(far) / far < Z.overlayScale(far) / far);
});

test('zoom: selection rings keep their line on the screen and widen more slowly than the line', () => {
  for (const d of steps(CAMERA_DEFAULTS.minDistance, near)) {
    assert.equal(Z.ringLineScale(d), 1, `line at ${d}`);
    assert.equal(Z.ringRadiusScale(d), 1, `radius at ${d}`);
  }
  // the line's width in pixels (tiles times pixels per tile) is what it was at the old limit, at every zoom
  const line = (d) => Z.ringLineScale(d) * Z.pixelsPerTile(d, 720);
  for (const d of [60, 100, 140, far]) assert.ok(Math.abs(line(d) - line(near)) < 1e-9, `line width at ${d}`);
  // the radius grows with the view (never smaller than the unit's own ring), but slower than the line
  let prev = 1;
  for (const d of steps(near, far, 100)) {
    assert.ok(Z.ringRadiusScale(d) >= prev - 1e-12, `radius turns back at ${d}`);
    assert.ok(Z.ringRadiusScale(d) <= Z.ringLineScale(d) + 1e-12);
    prev = Z.ringRadiusScale(d);
  }
  assert.ok(Z.ringRadiusScale(far) > 1.8 && Z.ringRadiusScale(far) < 2.2, `${Z.ringRadiusScale(far)}`);
  assert.ok(Z.ringLineScale(far) > 3.5 && Z.ringLineScale(far) < 4.2, `${Z.ringLineScale(far)}`);
  // the ring still shrinks on the screen with the zoom (radius in tiles over the distance): no ring outgrows its unit
  for (let d = 45; d < far; d++) assert.ok(Z.ringRadiusScale(d + 1) / (d + 1) < Z.ringRadiusScale(d) / d, `ring outgrows the view at ${d}`);
});

test('zoom: pixels per tile follow the window height and the distance', () => {
  const ppt = Z.pixelsPerTile(25, 720);
  assert.ok(ppt > 38 && ppt < 41, `${ppt}`);
  assert.ok(Math.abs(Z.pixelsPerTile(50, 720) - ppt / 2) < 1e-9, 'twice as far, half as big');
  assert.ok(Math.abs(Z.pixelsPerTile(25, 1440) - ppt * 2) < 1e-9, 'twice as tall a window, twice as big');
  assert.equal(Z.pixelsPerTile(0, 720), Infinity);
  assert.equal(Z.pixelsPerTile(25, 0), Infinity);
  assert.equal(Z.pixelsPerTile(Number.NaN, 720), Infinity);
});

test('zoom: the ground mesh steps coarser with the pixels, with a way back at a different value', () => {
  assert.equal(Z.terrainStride(40), 1);
  assert.equal(Z.terrainStride(17), 1);
  assert.equal(Z.terrainStride(15), 2);
  assert.equal(Z.terrainStride(6), 4);
  // hysteresis: between the two edges the step in use stays
  assert.equal(Z.terrainStride(17, 2), 2);
  assert.equal(Z.terrainStride(18.9, 2), 2);
  assert.equal(Z.terrainStride(19.1, 2), 1);
  assert.equal(Z.terrainStride(8, 4), 4);
  assert.equal(Z.terrainStride(8.6, 4), 2);
  // a jump over a level is taken in one go, up and down
  assert.equal(Z.terrainStride(5, 1), 4);
  assert.equal(Z.terrainStride(30, 4), 1);
  // every step divides FIELD_RES, so the chunk edges stay whole tiles
  for (const p of [1, 5, 8, 12, 18, 25, 80]) assert.ok([1, 2, 4].includes(Z.terrainStride(p)));
});

test('zoom: the forest and the unit markers switch with a margin', () => {
  assert.equal(Z.forestFar(10), true);
  assert.equal(Z.forestFar(12), false);
  assert.equal(Z.forestFar(12, true), true);
  assert.equal(Z.forestFar(13.5, true), false);
  assert.equal(Z.unitFar(8, 10), true);
  assert.equal(Z.unitFar(12, 10), false);
  assert.equal(Z.unitFar(12, 10, true), true);
  assert.equal(Z.unitFar(15, 10, true), false);
  assert.equal(Z.unitFar(8, 40), false, 'a tiny creature close up is drawn as itself');
  assert.equal(Z.unitFar(8, 25), false, 'so is everything in the old zoom range');
  assert.equal(Z.unitFar(8, 19), true);
  assert.equal(Z.unitFar(8, 21), false);
  assert.equal(Z.unitFar(8, 21, true), true, 'the width of the view has a margin too');
  assert.equal(Z.unitFar(8, 23, true), false);
  assert.equal(Z.unitFar(8, Infinity), false);
  // the levels at the camera limits of a 720 pixel window
  const at = (d) => Z.pixelsPerTile(d, 720);
  assert.equal(Z.terrainStride(at(CAMERA_DEFAULTS.minDistance)), 1);
  assert.equal(Z.forestFar(at(CAMERA_DEFAULTS.midDistance)), false, 'the old zoom range keeps the full trees');
  assert.equal(Z.unitFar(0.1, at(CAMERA_DEFAULTS.midDistance)), false, 'and the models of its units, however small they are drawn');
  assert.equal(Z.unitFar(0.1, at(CAMERA_DEFAULTS.defaultDistance)), false);
  assert.equal(Z.unitFar(5, at(CAMERA_DEFAULTS.maxDistance)), true);
  assert.equal(Z.forestFar(at(far)), true);
  assert.equal(Z.terrainStride(at(far)), 4);
});
