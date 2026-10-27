// The camera's free framing (CameraController.setFree, src/render/camera.js): the intro film places
// the camera by an orbit pose instead of the player's controls. Pure math on a three.js camera.
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
const { CameraController } = await import('../../src/render/camera.js');

const DEG = Math.PI / 180;
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function makeCamera(opts = {}) {
  const cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.5, 400);
  const c = new CameraController(cam, { mapWidth: 96, mapHeight: 96, heightFn: () => 0, ...opts });
  c.setViewport(1600, 900);
  return c;
}

/** The ground point the camera's middle ray hits. */
function lookedAt(c) {
  const ray = c.rayFromNdc(0, 0);
  const t = -ray.origin.y / ray.dir.y;
  return { x: ray.origin.x + ray.dir.x * t, z: ray.origin.z + ray.dir.z * t };
}

test('free camera: yaw 0 frames a point just as the player\'s view does at the same distance and pitch', () => {
  const player = makeCamera();
  player.centerOn(40, 50);
  const free = makeCamera();
  free.setFree({ x: 40, y: 50, dist: player.distance, pitch: player.pitch / DEG, yaw: 0, lift: 0, fov: player.camera.fov });
  for (const k of ['x', 'y', 'z']) assert.ok(close(free.camera.position[k], player.camera.position[k], 1e-9), `position.${k}`);
  const a = lookedAt(free);
  assert.ok(close(a.x, 40, 1e-3) && close(a.z, 50, 1e-3), 'the middle of the screen is the point');
});

test('free camera: yaw swings the camera round the point from due south, and it keeps looking at it', () => {
  const c = makeCamera();
  const pose = { x: 40, y: 50, dist: 20, pitch: 30, yaw: 0, lift: 0, fov: 40 };
  c.setFree(pose);
  const flat = 20 * Math.cos(30 * DEG);
  const at = (yaw) => {
    pose.yaw = yaw;
    c.update(0);
    return c.camera.position;
  };
  let p = at(0);
  assert.ok(close(p.x, 40) && close(p.z, 50 + flat), 'south');
  p = at(90);
  assert.ok(close(p.x, 40 + flat) && close(p.z, 50), 'east');
  p = at(180);
  assert.ok(close(p.x, 40) && close(p.z, 50 - flat), 'north');
  p = at(-90);
  assert.ok(close(p.x, 40 - flat) && close(p.z, 50), 'west');
  for (const yaw of [0, 55, 130, -118, 172]) {
    at(yaw);
    const l = lookedAt(c);
    assert.ok(close(l.x, 40, 1e-3) && close(l.z, 50, 1e-3), `looks at the point from yaw ${yaw}`);
    assert.ok(close(c.camera.position.y, 20 * Math.sin(30 * DEG), 1e-9), 'the same height all the way round');
  }
});

test('free camera: lift raises the whole view, and the ground under the point lifts it too', () => {
  const c = makeCamera({ heightFn: () => 2 });
  c.setFree({ x: 10, y: 10, dist: 12, pitch: 20, yaw: 0, lift: 3, fov: 40 });
  assert.ok(close(c.camera.position.y, 2 + 3 + 12 * Math.sin(20 * DEG), 1e-9));
  assert.equal(c.groundY, 2);
  c.setFree({ x: 10, y: 10, dist: 12, pitch: 20, yaw: 0, lift: 0, fov: 40 });
  assert.ok(close(c.camera.position.y, 2 + 12 * Math.sin(20 * DEG), 1e-9));
});

test('free camera: the lens follows the pose, and pitch reads back in radians', () => {
  const c = makeCamera();
  const pose = { x: 30, y: 30, dist: 10, pitch: 14, yaw: 0, lift: 1, fov: 46 };
  c.setFree(pose);
  assert.equal(c.camera.fov, 46);
  assert.ok(close(c.pitch, 14 * DEG));
  pose.fov = 36;
  c.update(0);
  assert.equal(c.camera.fov, 36);
  delete pose.fov;
  c.update(0);
  assert.equal(c.camera.fov, CameraDefaultFov(), 'no fov in the pose: the game\'s lens');
});

function CameraDefaultFov() {
  return makeCamera().opts.fov;
}

test('free camera: ignores the zoom limits, the map edge and the easing', () => {
  const c = makeCamera();
  const pose = { x: -30, y: 400, dist: 3, pitch: 5, yaw: 40, lift: 0.5, fov: 40 };
  c.setFree(pose);
  assert.equal(c.distance, 3, 'closer than the player can zoom');
  assert.deepEqual([c.target.x, c.target.y], [-30, 400], 'off the map');
  assert.deepEqual([c.goal.x, c.goal.y], [-30, 400]);
  pose.dist = 300;
  pose.x = 12;
  c.update(0); // no time passes, the view is where the pose says all the same
  assert.equal(c.distance, 300, 'farther than the player can zoom');
  assert.equal(c.target.x, 12);
  c.update(5); // and a long frame does not change that
  assert.equal(c.target.x, 12);
});

test('free camera: the pose is read live, so a caller moves the camera by changing its fields', () => {
  const c = makeCamera();
  const pose = { x: 20, y: 20, dist: 15, pitch: 25, yaw: 0, lift: 0, fov: 40 };
  c.setFree(pose);
  const before = c.camera.position.clone();
  pose.x = 26;
  pose.dist = 22;
  c.update(1 / 60);
  assert.ok(c.camera.position.distanceTo(before) > 5);
  const l = lookedAt(c);
  assert.ok(close(l.x, 26, 1e-3) && close(l.z, 20, 1e-3));
});

test('free camera: null hands the camera back to the player\'s controls and the game\'s lens', () => {
  const c = makeCamera();
  const lens = c.camera.fov;
  c.setFree({ x: 70, y: 10, dist: 9, pitch: 10, yaw: 120, lift: 2, fov: 60 });
  assert.equal(c.camera.fov, 60);
  c.setFree(null);
  assert.equal(c.free, null);
  assert.equal(c.camera.fov, lens);
  c.centerOn(40, 40);
  for (let i = 0; i < 400; i++) c.update(1 / 60); // the player's easing settles
  const p = c.camera.position;
  assert.ok(close(p.x, 40, 0.05) && p.z > 40 && p.y > 5, 'framing is the player\'s again: due south of the point and above it');
  assert.ok(c.pitch / DEG > 40, 'with the player\'s steep pitch');
  const l = lookedAt(c);
  assert.ok(close(l.x, 40, 1e-2) && close(l.z, 40, 1e-2));
});

test('free camera: nothing changes for a player who never calls it', () => {
  const c = makeCamera();
  assert.equal(c.free, null);
  c.centerOn(40, 50);
  const p = c.camera.position;
  assert.ok(close(p.x, 40) && p.z > 50 && p.y > 10, 'south of the point and above it, as before');
});
