// The intro film's clock (src/intro/film.js): the stage, the script and a renderer put together.
// The renderer here is a stand-in that records what the film asks of it, so the film's own logic
// (the clock, the camera that follows the cast, the sky) runs in Node with no WebGL.
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
const { IntroFilm } = await import('../../src/intro/film.js');
const { FILM_LENGTH, SHOTS, hourAt, fadeAt, barsAt, captionAt, shotAt } = await import('../../src/intro/script.js');
const { CUE_TIMES } = await import('../../src/intro/stage.js');

class FakeRenderer {
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.opts = opts;
    this.free = null;
    this.camera = { setFree: (pose) => (this.free = pose) };
    this.bars = { add: () => 'bar added' };
    this.status = { addRank: () => 'rank added', addIcons: () => 'icons added' };
    this.scene = new THREE.Scene();
    this.terrain = { border: { visible: true } };
    this.threeCamera = new THREE.PerspectiveCamera();
    this.atmo = {
      hours: [],
      state: {
        skyZenith: new THREE.Color('#223366'),
        skyHorizon: new THREE.Color('#ffcc88'),
        haze: new THREE.Color('#ccaa88'),
        keyHue: new THREE.Color('#ffddaa'),
        sunDir: new THREE.Vector3(0.3, 0.6, 0.2).normalize(),
        moonDir: new THREE.Vector3(-0.3, 0.5, -0.2).normalize(),
        sunElevation: 30,
        moonElevation: -20,
        night: 0,
      },
      setMode: (h) => this.atmo.hours.push(h),
    };
    this.updates = [];
    this.frames = 0;
    this.disposed = false;
    this.size = null;
  }
  update(dt) {
    this.updates.push(dt);
  }
  render() {
    this.frames++;
  }
  resize(w, h) {
    this.size = [w, h];
  }
  dispose() {
    this.disposed = true;
  }
}

const make = (o = {}) => new IntroFilm({ canvas: { id: 'canvas' }, Renderer: FakeRenderer, ...o });
const run = (film, to, step = 0.05) => {
  while (film.t < to - 1e-9) film.advance(Math.min(step, to - film.t));
};

test('the renderer is built on the film\'s own stage, at the first hour of the script, and made quiet', () => {
  const film = make({ quality: 'high' });
  const r = film.renderer;
  assert.equal(r.canvas.id, 'canvas');
  assert.equal(r.opts.quality, 'high');
  assert.equal(r.opts.timeOfDay, hourAt(0));
  assert.equal(r.opts.viewState, film.stage.vs);
  assert.equal(r.opts.setup, film.stage.setup);
  assert.equal(r.free, film.pose, 'the camera is the film\'s pose');
  // a film has no bars, rank pips or status icons over the heads
  assert.equal(r.bars.add(), undefined);
  assert.equal(r.status.addRank(), undefined);
  assert.equal(r.status.addIcons(), undefined);
  // and no dark mist at the map's edge: a sky dome instead
  assert.equal(r.terrain.border.visible, false);
  assert.ok(r.scene.children.includes(film.sky.mesh));
});

test('quality low thins the cast, every other tier plays the whole of it', () => {
  assert.equal(make({ quality: 'low' }).stage.density, 0.6);
  for (const q of ['medium', 'high', 'ultra']) assert.equal(make({ quality: q }).stage.density, 1);
});

test('the clock: advance moves the film on, a frame is capped, the end is a wall', () => {
  const film = make();
  assert.equal(film.t, 0);
  assert.equal(film.done, false);
  film.advance(0.016);
  assert.ok(Math.abs(film.t - 0.016) < 1e-9);
  film.advance(5); // a long frame (a tab that was away) moves the film by 0.1 s at most
  assert.ok(Math.abs(film.t - 0.116) < 1e-9);
  film.advance(-1);
  film.advance(NaN);
  assert.ok(Math.abs(film.t - 0.116) < 1e-9, 'never backwards');
  run(film, FILM_LENGTH - 0.05);
  assert.equal(film.done, false);
  film.advance(0.1);
  assert.equal(film.t, FILM_LENGTH);
  assert.equal(film.done, true);
  film.advance(0.1);
  assert.equal(film.t, FILM_LENGTH, 'it stops at the end');
});

test('each frame feeds the renderer the hour, the time and its look, and paints the overlay\'s view', () => {
  const film = make();
  const r = film.renderer;
  run(film, 12.3);
  assert.equal(r.atmo.hours[r.atmo.hours.length - 1], hourAt(film.t));
  assert.ok(Math.abs(r.updates.reduce((a, b) => a + b, 0) - film.t) < 0.06, 'the renderer was updated for the whole film time');
  assert.equal(film.view.t, film.t);
  assert.equal(film.view.fade, fadeAt(film.t));
  assert.equal(film.view.bars, barsAt(film.t));
  assert.deepEqual(film.view.caption, captionAt(film.t));
  assert.equal(film.shot, shotAt(film.t));
  assert.equal(film.view.caption.text, 'Pray. Summon the gods.');
});

test('draw hands the frame to the renderer', () => {
  const film = make();
  film.draw(1234);
  film.draw(1250);
  assert.equal(film.renderer.frames, 2);
  film.resize(800, 450);
  assert.deepEqual(film.renderer.size, [800, 450]);
});

test('the sky dome follows the camera and takes the hour\'s look', () => {
  const film = make();
  film.renderer.threeCamera.position.set(12, 8, 40);
  film.advance(0.05);
  assert.deepEqual(film.sky.mesh.position.toArray(), [12, 8, 40]);
  const u = film.sky.material.uniforms;
  assert.ok(u.uZenith.value.equals(film.renderer.atmo.state.skyZenith));
  assert.equal(u.uTime.value, film.t);
  film.renderer.atmo.state.night = 1;
  film.advance(0.05);
  assert.equal(u.uNight.value, 1);
});

test('the camera pose follows the script: the dawn pull-in, the god, the line of gods', () => {
  const film = make();
  film.advance(0.05);
  const first = SHOTS[0].cam[0];
  assert.ok(Math.abs(film.pose.dist - first.dist) < 1, `starts at ${first.dist}, is ${film.pose.dist}`);
  assert.ok(Math.abs(film.pose.pitch - first.pitch) < 1);
  run(film, 8);
  assert.ok(film.pose.dist < first.dist - 30, 'the dawn shot comes in');
  // the god shot looks at Zeus
  run(film, 17);
  const zeus = film.stage.actor('zeus');
  assert.ok(zeus, 'Zeus is up by now');
  assert.ok(Math.hypot(film.pose.x - zeus.x, film.pose.y - zeus.y) < 2.5, 'the camera is on him');
  // the last shot looks at the line of gods
  run(film, FILM_LENGTH - 2);
  const line = film.stage.anchors.lineup;
  assert.ok(Math.hypot(film.pose.x - line.x, film.pose.y - line.y) < 6, 'on the line');
});

test('the camera follows its subject smoothly and a cut starts on the new subject at once', () => {
  const film = make();
  run(film, CUE_TIMES.titans + 0.1);
  const before = film.pose.x;
  run(film, 30 - 1e-6); // the titans shot starts at 30
  const kronos = film.stage.actor('kronos');
  assert.ok(kronos);
  film.advance(0.05);
  assert.ok(Math.hypot(film.pose.x - kronos.x, film.pose.y - kronos.y) < 4, 'the cut lands on the titan');
  // no jump between two frames inside a shot
  let prev = { x: film.pose.x, y: film.pose.y };
  for (let i = 0; i < 60; i++) {
    film.advance(0.05);
    assert.ok(Math.hypot(film.pose.x - prev.x, film.pose.y - prev.y) < 1.2, 'the look-at moves smoothly');
    prev = { x: film.pose.x, y: film.pose.y };
  }
  assert.notEqual(before, film.pose.x);
});

test('rawPoint: an anchor, the crowd, an actor where it stands, where it last stood, and where it will appear', () => {
  const film = make();
  const stage = film.stage;
  assert.deepEqual(film.rawPoint('temple'), stage.anchors.temple);
  const crowd = film.rawPoint('crowd');
  assert.ok(Number.isFinite(crowd.x) && Number.isFinite(crowd.y));
  // before Zeus is summoned the camera waits at the temple
  assert.deepEqual(film.rawPoint('zeus'), stage.anchors.temple);
  assert.deepEqual(film.rawPoint('kronos'), stage.anchors.gate);
  assert.equal(film.rawPoint('nobody'), null);
  run(film, CUE_TIMES.summon + 0.5);
  const zeus = stage.actor('zeus');
  assert.deepEqual(film.rawPoint('zeus'), { x: zeus.x, y: zeus.y });
  // once it has fallen the camera keeps its last place
  const last = { x: zeus.x, y: zeus.y };
  stage.world.killEntity(zeus, null, true);
  stage.advance(0.1);
  assert.equal(stage.actor('zeus'), null);
  const gone = film.rawPoint('zeus');
  assert.ok(Math.hypot(gone.x - last.x, gone.y - last.y) < 1, 'where it fell');
});

test('dispose frees the renderer and takes the sky out of the scene', () => {
  const film = make();
  const sky = film.sky.mesh;
  film.dispose();
  assert.equal(film.renderer.disposed, true);
  assert.ok(!film.renderer.scene.children.includes(sky));
});
