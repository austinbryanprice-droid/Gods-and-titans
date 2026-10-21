// Visual effects: projectiles, ability shapes, hits, deaths, level ups, summons
// and dust. One VFXSystem per renderer; feed it events, call update(dt) every
// frame. Everything is pooled (particles in typed arrays, meshes reused), the
// particle count is capped and degrades gracefully under load, and update()
// allocates nothing. Positions are sim coords: (x east, y south) → Three
// (x, ground + h, y). See DESIGN.md section 8.
//
// Colors are linear and hot cores go past 1 (HDR) so post.js blooms them; the
// brightest flashes, meteors and fireball heads also light the world around
// them through a small fixed pool of point lights (`lights`, LightPool).
import * as THREE from 'three';
import { PROJECTILE_SPEED } from '../config.js';
import { CELL, makeAtlasTexture } from './vfx-textures.js';
import { getPalette, COLORS } from './vfx-palette.js';
import {
  ParticleLayer, GlowBatch, LightPool, createDecalPool, createRibbonPool, createFlarePool, createPillarPool, createDomePool,
  disposePool, RIBBON_MAX, FLARE_HOT,
} from './vfx-layers.js';
import { createProjectileBatches, PROJECTILE_SPECS } from './vfx-projectiles.js';
import { SHAPES, INTERNAL, STYLE, boltPath, BOLT_N } from './vfx-shapes.js';

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
/**
 * Point lights: intensities at the call sites are relative, LIGHT_GAIN turns
 * them into candela (the scene is in full daylight: a light has to be strong
 * to show). LIGHT_PER_FLARE: intensity per unit of flare size (flareFx).
 * LIGHT_LIFT: every VFX light sits at least this high above the ground, so it
 * makes a soft pool instead of a hot spot (big flares sit higher still).
 * LIGHT_GROUND_MAX: the most a light adds to the ground right under it, in
 * irradiance (the sun gives flat ground ~2): above that the pool no longer
 * tints the ground but bleaches it, and the effect drawn on it loses contrast.
 * Intensities are soft-capped to it for the light's height (lightCap).
 * LIGHT_LUM: lights are dimmed to about this luminance per unit of intensity,
 * so pale hues (holy, ice, wind, physical) do not just brighten everything.
 */
const LIGHT_GAIN = 2.6;
const LIGHT_PER_FLARE = 3.2;
const LIGHT_LIFT = 3;
export const LIGHT_GROUND_MAX = 1.9;
const LIGHT_LUM = 0.45;
/** Point lights the pool owns (the most any tier uses). */
const LIGHTS_MAX = 4;

// lights: point lights in the scene per tier (each one costs every lit pixel:
// medium, which must hold 60 fps on integrated GPUs at up to 1.5x pixel ratio,
// gets 2). The count is part of every lit shader, so it only follows the tier
// when the renderer rebuilds them all anyway (see setQuality).
const QUALITY = {
  low: { particles: 1600, mult: 0.5, lights: 0 },
  medium: { particles: 3000, mult: 0.8, lights: 2 },
  high: { particles: 4000, mult: 1, lights: 4 },
};

/** Max ribbons one effect can own (chain hops). */
const FX_RIBBONS = 16;
const FX_POINTS = 24;
/** Seconds a following effect takes to fade once its unit leaves the local player's sight. */
const HIDDEN_FADE = 0.25;

/** One running effect (pooled). Handlers keep their state in these generic fields. */
class Fx {
  constructor() {
    this.ribs = new Array(FX_RIBBONS).fill(null);
    this.pts = new Float32Array(FX_POINTS * 3);
    this.slots = new Int16Array(12);
    this.reset();
  }

  reset() {
    this.h = null; // handler { start, update }
    this.shape = '';
    this.pal = null;
    this.t = 0;
    this.dur = 1;
    this.wait = 0;
    this.teleR = 0;
    this.tele = null;
    this.x = 0; this.y = 0; this.gz = 0;
    this.r = 1;
    this.fx = 0; this.fy = 0; this.hasFrom = false;
    this.npts = 0;
    this.scale = 1;
    this.style = null;
    this.c = null; this.cc = null;
    this.r0 = 0; this.r1 = 0;
    this.fin = 0.1; this.fout = 0.3; this.alpha = 1; this.spin = 0;
    this.flatY = null;
    this.d0 = null; this.d1 = null; this.d2 = null;
    this.f0 = null; this.f1 = null;
    this.p0 = null; this.dome = null;
    this.nrib = 0;
    this.g0 = -1; this.g1 = -1; this.g2 = -1;
    this.nslots = 0;
    this.rock = -1;
    this.acc0 = 0; this.acc1 = 0; this.acc2 = 0;
    this.timer = 0; this.stage = 0;
    this.k0 = 0; this.k1 = 0; this.k2 = 0; this.k3 = 0; this.k4 = 0; this.k5 = 0;
    this.follow = null;
    this.flag = false;
    this.light = -1;
  }
}

/** One projectile in flight (pooled). */
class Proj {
  constructor() {
    this.reset();
  }

  reset() {
    this.kind = '';
    this.spec = null;
    this.pal = null;
    this.t = 0; this.flight = 1; this.arc = 0;
    this.ax = 0; this.ah = 0; this.ay = 0;
    this.bx = 0; this.bh = 0; this.by = 0; this.toH = 0;
    this.batch = null; this.slot = -1;
    this.glow = -1; this.rib = null;
    this.acc = 0; this.acc2 = 0;
    this.spin = 0; this.roll = 0;
    this.axX = 0; this.axY = 1; this.axZ = 0;
    this.scale = 1;
    this.big = 1;
    this.burstR = 0;
    this.track = null;
    this.magic = false;
    this.light = -1;
  }
}

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _X = new THREE.Vector3(1, 0, 0);
const _c = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);
const _track = { x: 0, y: 0, h: 0, hidden: false };
const BOLT = new Float32Array(BOLT_N * 3);
const _lc = { r: 1, g: 1, b: 1 };

/**
 * Soft cap of a light's intensity (candela) for its height h above the ground:
 * the ground right under it gets at most about LIGHT_GROUND_MAX (I / h²);
 * weaker lights pass nearly unchanged.
 */
function lightCap(I, h) {
  const cap = LIGHT_GROUND_MAX * h * h;
  return cap * Math.tanh(I / cap);
}

/**
 * VFX for the game renderer.
 *
 *   const vfx = new VFXSystem(scene, (x, y) => heightAt(mapData, x, y), { quality: 'high' });
 *   vfx.spawnProjectile({ kind: 'arrow', el: 'physical', from: { x, y, h: 1 }, to: { x, y, h: 0.8 }, flight: 0.4 });
 *   vfx.update(dt); // every frame; read vfx.shake (world units) for camera shake
 */
export class VFXSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {(x:number, y:number) => number} getHeight ground height at sim (x, y)
   * @param {{ quality?: 'low'|'medium'|'high', maxParticles?: number, lights?: number }} [options]
   *   lights: point lights in the scene above low quality (default per quality: 2 on medium, 4 on high; none on low)
   */
  constructor(scene, getHeight, options = {}) {
    this.scene = scene;
    this.getHeight = typeof getHeight === 'function' ? getHeight : () => 0;
    this.quality = QUALITY[options.quality] ? options.quality : 'high';
    this.mult = QUALITY[this.quality].mult;
    const maxP = Math.max(200, options.maxParticles || QUALITY[this.quality].particles);
    this.maxParticles = maxP;
    this.root = new THREE.Group();
    this.root.name = 'vfx';
    scene.add(this.root);
    this.atlas = makeAtlasTexture();
    this.add = new ParticleLayer(this.root, this.atlas, Math.round(maxP * 0.72), true);
    this.alpha = new ParticleLayer(this.root, this.atlas, maxP - Math.round(maxP * 0.72), false);
    this.glows = new GlowBatch(this.root, this.atlas, 640);
    this.decals = createDecalPool(this.root, 72);
    this.ribbons = createRibbonPool(this.root, 200);
    this.flares = createFlarePool(this.root, 72);
    this.pillars = createPillarPool(this.root, 28);
    this.domes = createDomePool(this.root, 32);
    const pb = createProjectileBatches(this.root);
    this.batches = pb.batches;
    this.projMaterials = pb.materials;
    /** Dynamic point lights (also fed by the renderer's burning buildings). */
    this.lightsOpt = Number.isFinite(options.lights) ? Math.max(0, options.lights | 0) : -1;
    this.lights = new LightPool(this.root, Math.max(LIGHTS_MAX, this.lightsOpt), this.lightCount(this.quality));
    this.effects = [];
    this.fxPool = [];
    this.projectiles = [];
    this.projPool = [];
    /** Camera shake amplitude in world units (decays); the renderer offsets its camera by up to this much. */
    this.shake = 0;
    this.time = 0;
    this.focusX = NaN;
    this.focusY = NaN;
    this.focusR = 20;
    this.budget = 1;
    this.disposed = false;
    this.prewarm();
  }

  /**
   * Create one hidden item in each lazily filled mesh pool, so the renderer's
   * warm-up compile sees their shader programs. Otherwise the first nova,
   * summon pillar or shield dome of a match links its programs mid-fight.
   */
  prewarm() {
    for (const pool of [this.decals, this.ribbons, this.flares, this.pillars, this.domes]) pool.release(pool.acquire());
  }

  // ------------------------------------------------------------------ public API

  /**
   * Launch a projectile. from/to: sim position + h above ground. flight in seconds
   * (default distance / PROJECTILE_SPEED). Optional `track(out)` keeps a homing
   * target: write the target's current { x, y } (and optionally h) into out and
   * return true, or return false when it is gone.
   */
  spawnProjectile({ kind, el, from, to, flight, track } = {}) {
    if (this.disposed || !from || !to) return;
    const fh = Number.isFinite(from.h) ? from.h : 1;
    const th = Number.isFinite(to.h) ? to.h : 0.8;
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    const fl = Number.isFinite(flight) && flight > 0 ? flight : d / PROJECTILE_SPEED;
    this.launch(kind || 'orb', getPalette(el || 'physical'), from.x, this.ground(from.x, from.y) + fh, from.y, to.x, th, to.y, fl, 1, 0, track || null);
  }

  /**
   * Ability visuals. shape ∈ schema VFX_SHAPES; r = effect radius (tiles); fx, fy = origin
   * for beam / cone / wave / blink / projectile / dash (and an optional chain start);
   * points = [[x, y], ...] for chain; duration = seconds for persistent shapes;
   * delay = seconds until impact (telegraphed). Optional follow(out) → bool keeps
   * shield / buff / heal on a moving unit (write its { x, y } into out; return false
   * once it is gone, and also set out.hidden = true when the local player can no
   * longer see it: the effect then fades out instead of staying where it was).
   */
  spawnEffect({ el, shape, x, y, r, fx, fy, points, duration, delay, follow } = {}) {
    if (this.disposed || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const h = SHAPES[shape] || SHAPES.nova;
    const e = this.newFx(h);
    e.shape = SHAPES[shape] ? shape : 'nova';
    e.pal = getPalette(el || 'arcane');
    e.x = x;
    e.y = y;
    e.gz = this.ground(x, y);
    e.r = Number.isFinite(r) && r > 0 ? r : 0;
    e.dur = Number.isFinite(duration) && duration > 0 ? duration : 0;
    e.hasFrom = Number.isFinite(fx) && Number.isFinite(fy);
    e.fx = e.hasFrom ? fx : x;
    e.fy = e.hasFrom ? fy : y;
    e.follow = typeof follow === 'function' ? follow : null;
    e.npts = 0;
    if (Array.isArray(points)) {
      for (let i = 0; i < points.length && e.npts < FX_POINTS; i++) {
        const p = points[i];
        if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
        e.pts[e.npts * 3] = p[0];
        e.pts[e.npts * 3 + 1] = p[1];
        e.npts++;
      }
    }
    const dl = Number.isFinite(delay) && delay > 0 ? Math.min(delay, 4) : 0;
    if (h.ownDelay) {
      e.k5 = dl;
    } else if (dl > 0) {
      e.wait = dl;
      e.teleR = Math.max(e.r, 0.8);
      return;
    }
    h.start(this, e);
  }

  /** Small impact spark where damage lands (h = height above ground). */
  spawnHit({ x, y, h, el } = {}) {
    if (this.disposed || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const pal = getPalette(el || 'physical');
    const wy = this.ground(x, y) + (Number.isFinite(h) ? h : 0.7);
    const phys = pal.el === 'physical';
    const n = this.n(phys ? 5 : 7);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = rnd(1.4, 3.6);
      const up = rnd(0.2, 2.6);
      const p = this.add.add(x, wy, y, Math.cos(a) * sp, up, Math.sin(a) * sp, rnd(0.18, 0.34), rnd(0.13, 0.2), 0.04, pal.core, 1, CELL.SPARK, 7, 1.5);
      this.add.setEnd(p, phys ? COLORS.ember : pal.glow);
    }
    if (this.n(1)) {
      this.add.add(x, wy, y, 0, 0.2, 0, 0.16, phys ? 0.55 : 0.8, phys ? 0.9 : 1.2, phys ? COLORS.white : pal.glow, phys ? 0.55 : 0.85, CELL.GLOW);
    }
    if (!phys && this.n(1)) {
      const p = this.add.add(x, wy, y, 0, 0, 0, 0.2, 0.3, 1.1, pal.glow, 0.7, CELL.RING);
      this.add.setFadeIn(p, 0.01);
    }
  }

  /** Death puff (dust + a fading soul wisp); scale ≈ the unit's visual scale or a building's size. */
  spawnDeath({ x, y, scale } = {}) {
    if (this.disposed || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const s = Number.isFinite(scale) && scale > 0 ? Math.min(scale, 8) : 1;
    const gz = this.ground(x, y);
    const n = this.n(5 + 4 * s);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const rr = Math.random() * 0.35 * s;
      const sp = rnd(0.5, 1.3) * Math.sqrt(s);
      const p = this.alpha.add(x + Math.cos(a) * rr, gz + rnd(0.1, 0.4) * s, y + Math.sin(a) * rr, Math.cos(a) * sp, rnd(0.3, 0.9), Math.sin(a) * sp,
        rnd(0.8, 1.4), rnd(0.45, 0.7) * s, rnd(1.1, 1.6) * s, Math.random() < 0.5 ? COLORS.dust : COLORS.dustDark, 0.5, CELL.SMOKE, -0.2, 2.2);
      this.alpha.setSpin(p, Math.random() * TAU, rnd(-1, 1));
      this.alpha.setFadeIn(p, 0.12);
    }
    if (s < 2.6) {
      const w = this.n(2);
      for (let i = 0; i < w; i++) {
        const p = this.add.add(x + rnd(-0.15, 0.15), gz + 0.6 * s, y + rnd(-0.15, 0.15), rnd(-0.15, 0.15), rnd(0.9, 1.5), rnd(-0.15, 0.15), rnd(1.0, 1.4), 0.55 * s, 0.25, COLORS.soul, 0.45, CELL.GLOW, -0.3, 0.4);
        this.add.setFadeIn(p, 0.25);
      }
      const st = this.n(4);
      for (let i = 0; i < st; i++) {
        this.add.add(x + rnd(-0.3, 0.3) * s, gz + rnd(0.3, 1) * s, y + rnd(-0.3, 0.3) * s, 0, rnd(0.6, 1.4), 0, rnd(0.6, 1.0), 0.18, 0.05, COLORS.soul, 0.8, CELL.STAR);
      }
    } else {
      // building collapse: debris and a heavier cloud
      const d = this.n(8 + 3 * s);
      for (let i = 0; i < d; i++) {
        const a = Math.random() * TAU;
        const sp = rnd(1, 3);
        const p = this.alpha.add(x + rnd(-0.4, 0.4) * s, gz + rnd(0.3, 1.2) * s * 0.5, y + rnd(-0.4, 0.4) * s, Math.cos(a) * sp, rnd(2, 5), Math.sin(a) * sp,
          rnd(1.0, 1.6), rnd(0.18, 0.4), 0.15, COLORS.debris, 1, CELL.SHARD, 14, 0.3);
        this.alpha.setSpin(p, Math.random() * TAU, rnd(-8, 8));
        this.alpha.setFloor(p, gz + 0.05);
      }
      this.addShake(Math.min(0.3, 0.05 * s), x, y);
    }
  }

  /** Golden level-up burst. */
  spawnLevelUp({ x, y } = {}) {
    if (this.disposed || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const e = this.newFx(INTERNAL.levelup);
    e.pal = getPalette('holy');
    e.x = x;
    e.y = y;
    e.gz = this.ground(x, y);
    e.h.start(this, e);
  }

  /** A promoted soldier: a small golden ring and a few sparks (the god level-up column is far too big for a Warrior). */
  spawnRankUp({ x, y } = {}) {
    if (this.disposed || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const gz = this.ground(x, y);
    this.decalFx(STYLE.ring, x, y, 0.2, 1.2, 0.6, COLORS.gold, COLORS.goldCore, 1, 0.03, 0.4);
    this.burst(this.add, x, gz + 0.4, y, 10, 1.2, 2.5, 0.8, 2.2, 0.35, 0.7, 0.2, 0.04, COLORS.goldCore, COLORS.gold, 1, CELL.STAR, 2, 2.2);
  }

  /** Summon pillar for a trained / revived god, titan or creature (scale = visual scale). */
  spawnSummon({ x, y, scale, el } = {}) {
    if (this.disposed || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const e = this.newFx(SHAPES.summon);
    e.shape = 'summon';
    e.pal = getPalette(el || 'holy');
    e.x = x;
    e.y = y;
    e.gz = this.ground(x, y);
    e.scale = Number.isFinite(scale) && scale > 0 ? Math.min(scale, 6) : 1;
    e.r = 0;
    e.h.start(this, e);
  }

  /** Dust cloud (construction, landing, footsteps); size ≈ footprint in tiles. */
  spawnDust({ x, y, size } = {}) {
    if (this.disposed || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.dustAt(x, y, Number.isFinite(size) && size > 0 ? Math.min(size, 8) : 1);
  }

  /** spawnDust without the argument object (used inside update). */
  dustAt(x, y, s) {
    const gz = this.ground(x, y);
    const n = this.n(3 + 3 * s);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const rr = Math.sqrt(Math.random()) * 0.5 * s;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      const sp = rnd(0.3, 0.9);
      const p = this.alpha.add(px, this.ground(px, py) + 0.15, py, Math.cos(a) * sp, rnd(0.25, 0.7), Math.sin(a) * sp,
        rnd(0.9, 1.5), rnd(0.35, 0.55) + 0.12 * s, rnd(0.9, 1.3) + 0.3 * s, Math.random() < 0.6 ? COLORS.dust : COLORS.dustDark, 0.45, CELL.SMOKE, -0.1, 1.6);
      this.alpha.setSpin(p, Math.random() * TAU, rnd(-0.8, 0.8));
      this.alpha.setFadeIn(p, 0.15);
    }
    if (s >= 2) {
      const d = this.n(s * 2);
      for (let i = 0; i < d; i++) {
        const a = Math.random() * TAU;
        const p = this.alpha.add(x + Math.cos(a) * 0.4 * s, gz + 0.2, y + Math.sin(a) * 0.4 * s, Math.cos(a) * rnd(0.5, 1.5), rnd(1.5, 3), Math.sin(a) * rnd(0.5, 1.5),
          rnd(0.6, 0.9), rnd(0.1, 0.2), 0.08, COLORS.debris, 1, CELL.SHARD, 12, 0.2);
        this.alpha.setSpin(p, Math.random() * TAU, rnd(-6, 6));
        this.alpha.setFloor(p, gz + 0.05);
      }
    }
  }

  /** Advance everything by dt seconds and upload buffers. Allocation-free. */
  update(dt) {
    if (this.disposed) return;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    this.time += dt;
    this.updateBudget();
    // effects (handlers may spawn more; those run this frame too)
    const fxs = this.effects;
    let j = 0;
    for (let i = 0; i < fxs.length; i++) {
      const e = fxs[i];
      if (this.stepFx(e, dt)) fxs[j++] = e;
      else this.releaseFx(e);
    }
    fxs.length = j;
    // projectiles
    const ps = this.projectiles;
    j = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (this.stepProj(p, dt)) ps[j++] = p;
      else this.releaseProj(p);
    }
    ps.length = j;
    this.add.update(dt);
    this.alpha.update(dt);
    this.glows.flush();
    for (const k in this.batches) this.batches[k].flush();
    this.lights.update(dt, this.focusX, this.focusY, this.focusR, 1);
    // camera shake decays exponentially
    if (this.shake > 0) {
      this.shake *= Math.exp(-4.5 * dt);
      if (this.shake < 0.004) this.shake = 0;
    }
  }

  /** Remove every running effect, projectile and particle. */
  clear() {
    for (const e of this.effects) this.releaseFx(e);
    this.effects.length = 0;
    for (const p of this.projectiles) this.releaseProj(p);
    this.projectiles.length = 0;
    this.add.clear();
    this.alpha.clear();
    this.glows.clear();
    for (const k in this.batches) this.batches[k].clear();
    this.lights.clear();
    this.shake = 0;
  }

  /** Free all GPU resources and detach from the scene. */
  dispose() {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    this.add.dispose();
    this.alpha.dispose();
    this.glows.dispose();
    disposePool(this.decals);
    disposePool(this.ribbons);
    disposePool(this.flares);
    disposePool(this.pillars);
    disposePool(this.domes);
    for (const k in this.batches) this.batches[k].dispose();
    for (const m of this.projMaterials) m.dispose();
    this.lights.dispose();
    this.atlas.dispose();
    this.root.removeFromParent();
  }

  /**
   * 'low' | 'medium' | 'high': scales particle counts (the cap is fixed at
   * construction). The point lights leave the scene on 'low' and come back
   * above it: the renderer rebuilds every lit shader exactly then (low is the
   * tier without shadows), so a new light count costs nothing more. Medium ↔
   * high keeps the count it has, which would otherwise recompile every shader
   * mid-match.
   */
  setQuality(q) {
    if (!QUALITY[q]) return;
    const was = this.quality;
    this.quality = q;
    this.mult = QUALITY[q].mult;
    if ((was === 'low') !== (q === 'low')) this.lights.setCount(this.lightCount(q));
  }

  /** Point lights in the scene on tier q. */
  lightCount(q) {
    if (q === 'low') return 0;
    return this.lightsOpt >= 0 ? this.lightsOpt : QUALITY[q].lights;
  }

  /**
   * Optional: camera ground target (and zoom distance), so far-away shakes are
   * attenuated and the lights go to what is on screen.
   */
  setFocus(x, y, dist) {
    this.focusX = x;
    this.focusY = y;
    if (Number.isFinite(dist) && dist > 0) this.focusR = Math.max(10, dist * 0.8);
  }

  /** Request camera shake (world units) from an event at (x, y). */
  addShake(amount, x, y) {
    let a = amount;
    if (Number.isFinite(this.focusX) && Number.isFinite(x)) {
      const d = Math.hypot(x - this.focusX, y - this.focusY);
      a *= d < 12 ? 1 : d > 40 ? 0 : 1 - (d - 12) / 28;
    }
    if (a <= 0) return;
    this.shake = Math.min(1, Math.max(this.shake, a) + a * 0.15);
  }

  /** Counters for debugging and tests. */
  stats() {
    return {
      effects: this.effects.length,
      projectiles: this.projectiles.length,
      particles: this.add.count + this.alpha.count,
      particleCap: this.add.cap + this.alpha.cap,
      glows: this.glows.active,
      decals: this.decals.active,
      ribbons: this.ribbons.active,
      flares: this.flares.active,
      pillars: this.pillars.active,
      domes: this.domes.active,
      instances: Object.values(this.batches).reduce((s, b) => s + b.active, 0),
      lights: this.lights.lit,
      budget: this.budget,
      shake: this.shake,
    };
  }

  // ------------------------------------------------------------------ building blocks (used by vfx-shapes.js)

  ground(x, y) {
    const h = this.getHeight(x, y);
    return Number.isFinite(h) ? h : 0;
  }

  updateBudget() {
    const occ = (this.add.count + this.alpha.count) / (this.add.cap + this.alpha.cap);
    this.budget = occ < 0.55 ? 1 : Math.max(0.08, 1 - ((occ - 0.55) / 0.45) * 0.92);
  }

  /** Particle count scaled by quality and the load budget (stochastic rounding). */
  n(count) {
    const v = count * this.mult * this.budget;
    const k = Math.floor(v);
    return k + (Math.random() < v - k ? 1 : 0);
  }

  /** Emission accumulator helper: returns how many particles to emit this frame at `rate`/s. */
  rate(e, field, rate, dt) {
    const v = e[field] + rate * dt * this.mult * this.budget;
    const k = Math.floor(v);
    e[field] = v - k;
    return k;
  }

  newFx(handler) {
    const e = this.fxPool.pop() || new Fx();
    e.reset();
    e.h = handler;
    this.effects.push(e);
    return e;
  }

  stepFx(e, dt) {
    if (e.wait > 0) {
      e.wait -= dt;
      if (e.teleR > 0) this.telegraph(e, dt);
      if (e.wait > 0) return true;
      if (e.tele) {
        this.decals.release(e.tele);
        e.tele = null;
      }
      e.t = 0;
      e.wait = 0;
      e.h.start(this, e);
      return e.h.update(this, e, 0);
    }
    e.t += dt;
    if (e.follow) {
      _track.x = e.x;
      _track.y = e.y;
      _track.hidden = false;
      if (e.follow(_track) && Number.isFinite(_track.x) && Number.isFinite(_track.y)) {
        e.x = _track.x;
        e.y = _track.y;
        e.gz = this.ground(e.x, e.y);
      } else {
        e.follow = null;
        // Its unit walked into the fog: fade out now (no glow marking it in the dark).
        if (_track.hidden) e.dur = Math.min(e.dur, e.t + HIDDEN_FADE);
      }
    }
    return e.h.update(this, e, dt);
  }

  /** Pulsing warning ring while a delayed effect winds up. */
  telegraph(e, dt) {
    if (!e.tele) {
      const d = this.acquireDecal(STYLE.tele, e.pal.glow, e.pal.core);
      if (!d) return;
      d.layout(this.getHeight, e.x, e.y, e.teleR * 1.05);
      e.tele = d;
      e.k0 = e.wait;
    }
    const total = e.k0 > 0 ? e.k0 : 1;
    const p = 1 - Math.max(0, e.wait) / total;
    e.tele.u.uOpacity.value = (0.25 + 0.55 * p) * (0.8 + 0.2 * Math.sin(this.time * 18));
    e.tele.u.uRing.value.set(0.92 - 0.25 * (1 - p), 0.05, 1);
    e.tele.u.uTime.value += dt;
  }

  releaseFx(e) {
    if (e.tele) this.decals.release(e.tele);
    if (e.d0) this.decals.release(e.d0);
    if (e.d1) this.decals.release(e.d1);
    if (e.d2) this.decals.release(e.d2);
    if (e.f0) this.flares.release(e.f0);
    if (e.f1) this.flares.release(e.f1);
    if (e.p0) this.pillars.release(e.p0);
    if (e.dome) this.domes.release(e.dome);
    for (let i = 0; i < e.nrib; i++) {
      if (e.ribs[i]) this.ribbons.release(e.ribs[i]);
      e.ribs[i] = null;
    }
    if (e.g0 >= 0) this.glows.free(e.g0);
    if (e.g1 >= 0) this.glows.free(e.g1);
    if (e.g2 >= 0) this.glows.free(e.g2);
    if (e.light >= 0) this.lights.release(e.light);
    for (let i = 0; i < e.nslots; i++) this.batches.crescent.free(e.slots[i]);
    if (e.rock >= 0) this.batches.rock.free(e.rock);
    e.reset();
    this.fxPool.push(e);
  }

  acquireDecal(style, c, core) {
    const d = this.decals.acquire();
    if (!d) return null;
    d.reset(style.add);
    d.color(c, core);
    const u = d.u;
    u.uRing.value.set(style.ring[0], style.ring[1], style.ring[2]);
    u.uFill.value.set(style.fill[0], style.fill[1], style.fill[2]);
    u.uRunes.value = style.runes || 0;
    u.uNoise.value = style.noise || 0;
    u.uCrack.value = style.crack || 0;
    u.uEdge.value = style.edge || 0;
    return d;
  }

  acquireRibbon(e, c, core, width) {
    if (e.nrib >= FX_RIBBONS) return null;
    const r = this.ribbons.acquire();
    if (!r) return null;
    r.reset().color(c, core);
    r.u.uWidth.value = width;
    e.ribs[e.nrib++] = r;
    return r;
  }

  /**
   * Ground decal effect: radius r0 → r1 (ease-out) over life, envelope fin/fout.
   * flatY: fixed world height (clouds) instead of terrain-conforming.
   */
  decalFx(style, x, y, r0, r1, life, c, core, alpha, fin, fout, spin = 0, flatY = null) {
    const d = this.acquireDecal(style, c, core);
    if (!d) return null;
    const e = this.newFx(INTERNAL.decal);
    e.d0 = d;
    e.x = x;
    e.y = y;
    e.r0 = r0;
    e.r1 = r1;
    e.dur = life;
    e.c = c;
    e.alpha = alpha;
    e.fin = fin;
    e.fout = fout;
    e.spin = spin;
    e.flatY = flatY;
    e.style = style;
    d.u.uOpacity.value = 0;
    d.u.uSpin.value = Math.random() * TAU;
    INTERNAL.decal.layoutAt(this, e, r0);
    return e;
  }

  /**
   * Billboard flash at world (x, wy, z): size0 → size1 over life; hot = HDR gain
   * of its white-hot core. Big ones light their surroundings (from higher up the
   * bigger they are, so the pool spreads with the flash).
   */
  flareFx(x, wy, z, size0, size1, life, c, core, alpha, rays = 0, fin = 0.12, hot = FLARE_HOT) {
    if (size1 >= 1.5) this.flashLight(x, wy, z, c, LIGHT_PER_FLARE * alpha * size1, 2.4 + 1.5 * size1, life * 1.6 + 0.1, fin, Math.max(LIGHT_LIFT, 0.55 * size1));
    const f = this.flares.acquire();
    if (!f) {
      // fall back to a point glow
      this.add.add(x, wy, z, 0, 0, 0, life, size0, size1, c, alpha, CELL.GLOW);
      return null;
    }
    const e = this.newFx(INTERNAL.flare);
    e.f0 = f;
    e.x = x;
    e.k0 = wy;
    e.y = z;
    e.r0 = size0;
    e.r1 = size1;
    e.dur = life;
    e.alpha = alpha;
    e.fin = fin;
    f.u.uColor.value.set(c.r, c.g, c.b);
    f.u.uCore.value.set(core.r, core.g, core.b);
    f.u.uRays.value = rays;
    f.u.uHot.value = hot;
    f.u.uSpin.value = Math.random() * TAU;
    f.u.uOpacity.value = 0;
    f.u.uSize.value = size0;
    f.mesh.position.set(x, wy, z);
    e.spin = rays > 0 ? rnd(-0.8, 0.8) : 0;
    return e;
  }

  /**
   * Point-light flash of hue c at world (x, wy, z), raised to at least `lift`
   * above the ground so it lights a soft pool around it.
   */
  flashLight(x, wy, z, c, intensity, range, life, attack = 0.04, lift = LIGHT_LIFT) {
    if (!this.lights.count) return -1;
    const g = this.ground(x, z);
    const y = Math.max(wy, g + lift);
    const I = lightCap(intensity * LIGHT_GAIN * this.lightColor(c), y - g);
    return this.lights.flash(x, y, z, _lc, I, Math.max(range, 1.6 * (y - g)), life, attack);
  }

  /**
   * A held point light of hue c (see LightPool.hold): move it with moveLight(),
   * let it go with this.lights.release(handle).
   */
  holdLight(x, wy, z, c, intensity, range, attack = 0.08, flicker = 0) {
    if (!this.lights.count) return -1;
    // it may come down to LIGHT_LIFT above the ground while it moves: capped for that
    const I = lightCap(intensity * LIGHT_GAIN * this.lightColor(c), LIGHT_LIFT);
    const g = this.ground(x, z);
    return this.lights.hold(x, Math.max(wy, g + LIGHT_LIFT), z, _lc, I, Math.max(range, 1.6 * LIGHT_LIFT), attack, flicker);
  }

  /** Move a held light, kept at least LIGHT_LIFT above the ground. */
  moveLight(handle, x, wy, z) {
    if (handle >= 0) this.lights.move(handle, x, Math.max(wy, this.ground(x, z) + LIGHT_LIFT), z);
  }

  /**
   * Light hue c into the shared scratch color (the element's own hue, not its
   * white-hot core: a near-white light bleaches the ground instead of tinting
   * it). Returns the intensity factor that keeps pale hues as bright as LIGHT_LUM.
   */
  lightColor(c) {
    const k = 1 / Math.max(c.r, c.g, c.b, 1e-4);
    _lc.r = c.r * k;
    _lc.g = c.g * k;
    _lc.b = c.b * k;
    const lum = 0.2126 * _lc.r + 0.7152 * _lc.g + 0.0722 * _lc.b;
    return Math.min(1, LIGHT_LUM / Math.max(lum, 1e-3));
  }

  /** Column of light at ground (x, y). */
  pillarFx(x, y, radius, height, life, c, core, alpha, fin = 0.15, fout = 0.45) {
    const p = this.pillars.acquire();
    if (!p) return null;
    const e = this.newFx(INTERNAL.pillar);
    e.p0 = p;
    e.x = x;
    e.y = y;
    e.gz = this.ground(x, y);
    e.r0 = radius;
    e.k0 = height;
    e.dur = life;
    e.alpha = alpha;
    e.fin = fin;
    e.fout = fout;
    p.u.uColor.value.set(c.r, c.g, c.b);
    p.u.uCore.value.set(core.r, core.g, core.b);
    p.u.uOpacity.value = 0;
    p.u.uTime.value = Math.random() * 10;
    p.mesh.position.set(x, e.gz - 0.05, y);
    p.mesh.scale.set(radius * 0.5, height, radius * 0.5);
    return e;
  }

  /**
   * Jagged lightning between world points a → b, re-jittered while it lives.
   * jag = displacement as a fraction of length; branches = side forks.
   */
  boltFx(ax, ah, ay, bx, bh, by, life, width, c, core, jag = 0.14, branches = 1, delay = 0) {
    const e = this.newFx(INTERNAL.bolt);
    e.pts[0] = ax; e.pts[1] = ah; e.pts[2] = ay;
    e.pts[3] = bx; e.pts[4] = bh; e.pts[5] = by;
    e.dur = life;
    e.k0 = width;
    e.k1 = jag;
    e.k2 = Math.min(branches, FX_RIBBONS - 1);
    e.c = c;
    e.cc = core;
    if (delay > 0) e.wait = delay;
    else e.h.start(this, e);
    return e;
  }

  /** Write a jagged path a → b into ribbon r (BOLT_N points). */
  layBolt(r, ax, ah, ay, bx, bh, by, jag, n = BOLT_N) {
    boltPath(ax, ah, ay, bx, bh, by, jag, BOLT, n);
    for (let i = 0; i < n; i++) {
      const w = i === 0 || i === n - 1 ? 0.6 : 0.75 + Math.random() * 0.45;
      r.set(i, BOLT[i * 3], BOLT[i * 3 + 1], BOLT[i * 3 + 2], w);
    }
    r.commit(n);
  }

  /** Radial particle burst at world (x, wy, z). */
  burst(layer, x, wy, z, count, spMin, spMax, upMin, upMax, lifeMin, lifeMax, s0, s1, c, cEnd, a, cell, grav = 0, drag = 0) {
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * TAU;
      const sp = rnd(spMin, spMax);
      const p = layer.add(x, wy, z, Math.cos(ang) * sp, rnd(upMin, upMax), Math.sin(ang) * sp, rnd(lifeMin, lifeMax), s0 * rnd(0.8, 1.2), s1, c, a, cell, grav, drag);
      if (cEnd) layer.setEnd(p, cEnd);
      if (cell === CELL.SHARD || cell === CELL.SMOKE || cell === CELL.STAR) layer.setSpin(p, Math.random() * TAU, rnd(-4, 4));
    }
    return n;
  }

  // ------------------------------------------------------------------ projectiles

  /**
   * Launch a projectile from world (ax, ah, ay) to sim (bx, by) at toH above ground.
   * big scales the head (ability orbs); burstR > 0 adds an area burst on arrival.
   */
  launch(kind, pal, ax, ah, ay, bx, toH, by, flight, big = 1, burstR = 0, track = null) {
    const spec = PROJECTILE_SPECS[kind] || PROJECTILE_SPECS.orb;
    const p = this.projPool.pop() || new Proj();
    p.reset();
    p.kind = PROJECTILE_SPECS[kind] ? kind : 'orb';
    p.spec = spec;
    p.pal = pal;
    p.flight = Math.max(0.05, Math.min(flight, 6));
    p.ax = ax; p.ah = ah; p.ay = ay;
    p.bx = bx; p.by = by; p.toH = toH;
    p.bh = this.ground(bx, by) + toH;
    const d = Math.hypot(bx - ax, by - ay);
    p.arc = Math.min(spec.arcMax, spec.arc0 + spec.arcK * d) * (d < 0.5 ? 0.3 : 1);
    p.big = big;
    p.burstR = burstR;
    p.track = typeof track === 'function' ? track : null;
    p.magic = pal.el !== 'physical';
    if (spec.mesh) {
      const b = this.batches[spec.mesh];
      const slot = b.alloc();
      if (slot >= 0) {
        p.batch = b;
        p.slot = slot;
        if (spec.mesh === 'feather') _c.copy(pal.linGlow).lerp(WHITE, 0.55);
        else if (spec.mesh === 'crescent') _c.copy(pal.linGlow);
        else if (spec.mesh === 'leaf' && pal.el !== 'nature') _c.copy(pal.linGlow).lerp(WHITE, 0.5);
        else if (spec.mesh === 'ice' && pal.el !== 'ice') _c.copy(pal.linGlow).lerp(WHITE, 0.4);
        else _c.copy(WHITE);
        b.setColor(slot, _c);
      }
    }
    if (spec.glow > 0 && (p.kind !== 'spear' || p.magic)) p.glow = this.glows.alloc();
    else if (p.kind === 'arrow' && p.magic) p.glow = this.glows.alloc();
    if (spec.trail === 'lightning' || spec.trail === 'ray' || (spec.trail === 'streak' && p.magic)) {
      const r = this.ribbons.acquire();
      if (r) {
        r.reset().color(pal.glow, pal.core);
        r.u.uWidth.value = (p.kind === 'bolt' ? 0.34 : p.kind === 'sunray' ? 0.36 : p.kind === 'moonbeam' ? 0.3 : 0.16) * big;
        r.u.uFade.value.set(0.5, 0.04);
        r.u.uHot.value = p.kind === 'bolt' ? 4 : spec.trail === 'ray' ? 3 : 1.6;
        p.rib = r;
      }
    }
    // fireballs and big (ability) orbs light the ground under their flight
    if (p.kind === 'fireball') p.light = this.holdLight(ax, ah, ay, pal.mid, 4.5 * big, 3.5 + 1.5 * big, 0.06, 0.18);
    else if (p.kind === 'orb' && big > 1.2) p.light = this.holdLight(ax, ah, ay, pal.glow, 3.2 * big, 3 + 1.5 * big, 0.08, 0.06);
    p.spin = spec.spin * rnd(0.7, 1.3) * (Math.random() < 0.5 ? -1 : 1);
    p.roll = Math.random() * TAU;
    if (p.kind === 'rock') {
      _axis.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize();
      p.axX = _axis.x; p.axY = _axis.y; p.axZ = _axis.z;
      p.scale = rnd(0.8, 1.2) * big;
    } else {
      p.scale = big;
    }
    this.projectiles.push(p);
    this.stepProj(p, 0);
    return p;
  }

  /** Position on the flight path at u (0..1) into _v. */
  projPos(p, u) {
    _v.set(p.ax + (p.bx - p.ax) * u, p.ah + (p.bh - p.ah) * u + p.arc * 4 * u * (1 - u), p.ay + (p.by - p.ay) * u);
    return _v;
  }

  stepProj(p, dt) {
    p.t += dt;
    if (p.track && dt > 0) {
      _track.x = p.bx;
      _track.y = p.by;
      _track.h = NaN;
      if (p.track(_track) && Number.isFinite(_track.x) && Number.isFinite(_track.y)) {
        p.bx = _track.x;
        p.by = _track.y;
        p.bh = this.ground(p.bx, p.by) + (Number.isFinite(_track.h) ? _track.h : p.toH);
      } else {
        p.track = null;
      }
    }
    const u = p.t >= p.flight ? 1 : p.t / p.flight;
    const spec = p.spec;
    const pal = p.pal;
    const pos = this.projPos(p, u);
    const x = pos.x;
    const h = pos.y;
    const z = pos.z;
    // direction of travel
    _dir.set(p.bx - p.ax, p.bh - p.ah + p.arc * 4 * (1 - 2 * u), p.by - p.ay);
    if (_dir.lengthSq() < 1e-8) _dir.set(1, 0, 0);
    _dir.normalize();
    if (p.slot >= 0) {
      const k = p.kind;
      let sc = p.scale;
      if (k === 'rock') {
        _q.setFromAxisAngle(_axis.set(p.axX, p.axY, p.axZ), p.roll + p.spin * p.t);
        _s.set(sc, sc, sc);
      } else if (k === 'crescent' || k === 'wave') {
        _dir.y = 0;
        if (_dir.lengthSq() < 1e-8) _dir.set(1, 0, 0);
        _dir.normalize();
        _q.setFromUnitVectors(_X, _dir);
        const grow = Math.min(1, p.t / 0.15);
        _s.set(0.55 * sc, 0.5 * sc * grow, 0.6 * sc * (0.5 + 0.5 * grow));
      } else {
        if (k === 'skull') {
          _dir.y *= 0.3;
          _dir.normalize();
        }
        _q.setFromUnitVectors(_X, _dir);
        let roll = p.roll + p.spin * p.t;
        if (k === 'feather') roll = Math.sin(p.t * 14 + p.roll) * 0.8;
        _q2.setFromAxisAngle(_X, roll);
        _q.multiply(_q2);
        if (k === 'leaf') sc *= 1.3;
        else if (k === 'feather') sc *= 1.25;
        else if (k === 'skull') sc *= 1.35;
        else if (k === 'ice') sc *= 1.2;
        else if (k === 'arrow') sc *= 1.2;
        _s.set(sc, sc, sc);
      }
      _m.compose(pos, _q, _s);
      p.batch.setMatrix(p.slot, _m);
    }
    if (p.glow >= 0) {
      const flick = 0.85 + 0.15 * Math.sin(this.time * 40 + p.roll * 7);
      const g = (p.kind === 'arrow' ? 0.32 : spec.glow) * p.big;
      // the head burns white-hot (HDR) so it blooms; magic arrow / spear tips a little less
      const heat = p.kind === 'arrow' || p.kind === 'spear' ? 0.9 : p.kind === 'skull' ? 1.1 : 1.8;
      this.glows.set(p.glow, x, h, z, g * flick, p.kind === 'fireball' ? pal.core : pal.glow, p.kind === 'skull' ? 0.8 : 1, CELL.GLOW, 0, heat);
    }
    if (p.light >= 0) this.moveLight(p.light, x, h + 0.25, z);
    if (p.rib) this.layProjRibbon(p, u);
    if (dt > 0) this.projTrail(p, x, h, z, dt);
    if (u >= 1) {
      this.projImpact(p, x, h, z);
      return false;
    }
    return true;
  }

  layProjRibbon(p, u) {
    const r = p.rib;
    const dist = Math.hypot(p.bx - p.ax, p.by - p.ay, p.bh - p.ah) || 1;
    const tailLen = p.kind === 'bolt' ? 2.2 : p.kind === 'spear' ? 1.4 : 3.2;
    const u0 = Math.max(0, u - tailLen / dist);
    const n = p.kind === 'bolt' ? 8 : 5;
    for (let i = 0; i < n; i++) {
      const uu = u0 + ((u - u0) * i) / (n - 1);
      const q = this.projPos(p, uu);
      let ox = 0;
      let oy = 0;
      let oz = 0;
      if (p.kind === 'bolt' && i > 0 && i < n - 1) {
        ox = rnd(-0.18, 0.18);
        oy = rnd(-0.18, 0.18);
        oz = rnd(-0.18, 0.18);
      }
      r.set(i, q.x + ox, q.y + oy, q.z + oz, p.kind === 'bolt' ? 0.7 + Math.random() * 0.5 : 0.25 + (0.75 * i) / (n - 1));
    }
    r.commit(n);
    r.u.uOpacity.value = p.kind === 'bolt' ? 0.75 + Math.random() * 0.35 : 0.95;
  }

  projTrail(p, x, h, z, dt) {
    const pal = p.pal;
    const big = p.big;
    switch (p.spec.trail) {
      case 'motes': {
        const n = this.rate(p, 'acc', 50 * big, dt);
        for (let i = 0; i < n; i++) {
          const q = this.add.add(x + rnd(-0.08, 0.08), h + rnd(-0.08, 0.08), z + rnd(-0.08, 0.08), rnd(-0.3, 0.3), rnd(-0.1, 0.4), rnd(-0.3, 0.3), rnd(0.25, 0.4), 0.42 * big, 0.05, pal.glow, 0.85, CELL.GLOW);
          this.add.setEnd(q, pal.alt);
        }
        const s = this.rate(p, 'acc2', 10 * big, dt);
        for (let i = 0; i < s; i++) this.add.add(x, h, z, rnd(-0.5, 0.5), rnd(-0.3, 0.5), rnd(-0.5, 0.5), rnd(0.3, 0.5), 0.16, 0.04, pal.core, 1, CELL.STAR);
        break;
      }
      case 'lightning': {
        const n = this.rate(p, 'acc', 26, dt);
        for (let i = 0; i < n; i++) this.add.add(x, h, z, rnd(-2, 2), rnd(-1, 2), rnd(-2, 2), rnd(0.12, 0.25), 0.16, 0.03, pal.core, 1, CELL.SPARK, 4);
        break;
      }
      case 'fire': {
        const n = this.rate(p, 'acc', 75 * big, dt);
        for (let i = 0; i < n; i++) {
          const q = this.add.add(x + rnd(-0.1, 0.1), h + rnd(-0.1, 0.1), z + rnd(-0.1, 0.1), rnd(-0.25, 0.25), rnd(0.4, 1.1), rnd(-0.25, 0.25), rnd(0.25, 0.42), rnd(0.5, 0.7) * big, 0.12, pal.mid, 0.7, CELL.FLAME);
          this.add.setEnd(q, pal.alt);
        }
        const s = this.rate(p, 'acc2', 14 * big, dt);
        for (let i = 0; i < s; i++) {
          const q = this.alpha.add(x, h + 0.1, z, rnd(-0.2, 0.2), rnd(0.5, 1), rnd(-0.2, 0.2), rnd(0.5, 0.8), 0.25 * big, 0.75 * big, pal.smoke, 0.32, CELL.SMOKE);
          this.alpha.setSpin(q, Math.random() * TAU, rnd(-1, 1));
        }
        break;
      }
      case 'dust': {
        const n = this.rate(p, 'acc', 10, dt);
        for (let i = 0; i < n; i++) {
          const q = this.alpha.add(x, h, z, rnd(-0.2, 0.2), rnd(0, 0.3), rnd(-0.2, 0.2), rnd(0.4, 0.6), 0.22, 0.55, COLORS.dust, 0.35, CELL.SMOKE);
          this.alpha.setSpin(q, Math.random() * TAU, 1);
        }
        break;
      }
      case 'sparkle': {
        const n = this.rate(p, 'acc', 20, dt);
        for (let i = 0; i < n; i++) this.add.add(x, h, z, rnd(-0.3, 0.3), rnd(-0.6, 0.2), rnd(-0.3, 0.3), rnd(0.3, 0.5), 0.2, 0.04, pal.glow, 0.9, CELL.STAR);
        break;
      }
      case 'spray': {
        const water = pal.el === 'water';
        const n = this.rate(p, 'acc', 34, dt);
        for (let i = 0; i < n; i++) {
          const side = rnd(-0.45, 0.45);
          // perpendicular to travel in the ground plane
          const px = x - _dir.z * side;
          const pz = z + _dir.x * side;
          if (water) {
            const q = this.alpha.add(px, h + rnd(0, 0.3), pz, rnd(-0.3, 0.3), rnd(0.6, 1.6), rnd(-0.3, 0.3), rnd(0.3, 0.5), 0.18, 0.4, pal.core, 0.6, CELL.SMOKE, 5);
            this.alpha.setSpin(q, Math.random() * TAU, 2);
          } else {
            this.add.add(px, h + rnd(0, 0.35), pz, rnd(-0.3, 0.3), rnd(0.2, 0.8), rnd(-0.3, 0.3), rnd(0.25, 0.4), 0.3, 0.05, pal.glow, 0.7, CELL.GLOW);
          }
        }
        const s = this.rate(p, 'acc2', 14, dt);
        for (let i = 0; i < s; i++) this.add.add(x, h + 0.2, z, rnd(-0.5, 0.5), rnd(0, 0.8), rnd(-0.5, 0.5), rnd(0.2, 0.35), 0.14, 0.03, pal.core, 1, CELL.SPARK, 3);
        break;
      }
      case 'ghost': {
        const n = this.rate(p, 'acc', 40, dt);
        for (let i = 0; i < n; i++) {
          const q = this.add.add(x + rnd(-0.1, 0.1), h + rnd(-0.1, 0.1), z + rnd(-0.1, 0.1), rnd(-0.2, 0.2), rnd(0.1, 0.5), rnd(-0.2, 0.2), rnd(0.35, 0.55), 0.5, 0.08, pal.glow, 0.6, CELL.GLOW);
          this.add.setEnd(q, pal.alt);
        }
        const s = this.rate(p, 'acc2', 8, dt);
        for (let i = 0; i < s; i++) this.alpha.add(x, h, z, 0, rnd(0.2, 0.5), 0, rnd(0.4, 0.6), 0.3, 0.7, pal.gloom || pal.smoke, 0.3, CELL.SMOKE);
        break;
      }
      case 'ray': {
        if (p.kind === 'moonbeam') {
          const n = this.rate(p, 'acc', 18, dt);
          for (let i = 0; i < n; i++) this.add.add(x + rnd(-0.2, 0.2), h + rnd(-0.2, 0.2), z + rnd(-0.2, 0.2), 0, rnd(-0.2, 0.2), 0, rnd(0.4, 0.7), 0.2, 0.04, pal.core, 0.9, CELL.STAR);
        } else {
          const n = this.rate(p, 'acc', 22, dt);
          for (let i = 0; i < n; i++) this.add.add(x, h, z, rnd(-0.6, 0.6), rnd(-0.3, 0.6), rnd(-0.6, 0.6), rnd(0.2, 0.35), 0.18, 0.04, pal.core, 1, CELL.SPARK);
        }
        break;
      }
      case 'leaves': {
        const n = this.rate(p, 'acc', 12, dt);
        for (let i = 0; i < n; i++) {
          const q = this.alpha.add(x, h, z, rnd(-0.4, 0.4), rnd(-0.2, 0.3), rnd(-0.4, 0.4), rnd(0.5, 0.8), 0.14, 0.1, pal.el === 'nature' ? pal.glow : pal.alt, 0.9, CELL.SHARD, 1.5, 1);
          this.alpha.setSpin(q, Math.random() * TAU, rnd(-6, 6));
        }
        const s = this.rate(p, 'acc2', 8, dt);
        for (let i = 0; i < s; i++) this.add.add(x, h, z, 0, 0.2, 0, 0.35, 0.18, 0.04, pal.glow, 0.8, CELL.STAR);
        break;
      }
      case 'frost': {
        const n = this.rate(p, 'acc', 26, dt);
        for (let i = 0; i < n; i++) this.add.add(x + rnd(-0.1, 0.1), h + rnd(-0.1, 0.1), z + rnd(-0.1, 0.1), rnd(-0.2, 0.2), rnd(-0.4, 0.1), rnd(-0.2, 0.2), rnd(0.3, 0.55), 0.18, 0.04, pal.core, 0.9, CELL.STAR);
        const s = this.rate(p, 'acc2', 6, dt);
        for (let i = 0; i < s; i++) this.alpha.add(x, h, z, 0, 0, 0, 0.5, 0.25, 0.6, pal.smoke, 0.25, CELL.SMOKE);
        break;
      }
      case 'streak':
        if (p.magic) {
          const n = this.rate(p, 'acc', 14, dt);
          for (let i = 0; i < n; i++) this.add.add(x, h, z, 0, 0.1, 0, 0.25, 0.25, 0.04, pal.glow, 0.7, CELL.GLOW);
        }
        break;
      default:
        if (p.kind === 'arrow' && p.magic) {
          const n = this.rate(p, 'acc', 18, dt);
          for (let i = 0; i < n; i++) this.add.add(x, h, z, rnd(-0.2, 0.2), rnd(-0.2, 0.2), rnd(-0.2, 0.2), 0.25, 0.22, 0.04, pal.glow, 0.85, CELL.GLOW);
        }
    }
  }

  projImpact(p, x, h, z) {
    const pal = p.pal;
    const big = p.big;
    switch (p.spec.impact) {
      case 'spark':
        if (p.magic) this.burst(this.add, x, h, z, 5, 1, 2.5, 0, 2, 0.2, 0.32, 0.16, 0.03, pal.core, pal.glow, 1, CELL.SPARK, 5, 1);
        break;
      case 'burst':
        this.add.add(x, h, z, 0, 0, 0, 0.22, 0.9 * big, 1.5 * big, pal.glow, 0.9, CELL.GLOW);
        this.burst(this.add, x, h, z, 9 * big, 1, 3, -0.5, 2, 0.25, 0.4, 0.22, 0.04, pal.core, pal.glow, 1, CELL.STAR, 2, 1.5);
        break;
      case 'zap':
        this.add.add(x, h, z, 0, 0, 0, 0.15, 1.0, 1.4, pal.glow, 1, CELL.GLOW);
        this.burst(this.add, x, h, z, 10, 2, 5, -1, 3, 0.12, 0.25, 0.16, 0.03, pal.core, pal.glow, 1, CELL.SPARK, 6, 1);
        this.flashLight(x, h, z, pal.glow, 7, 4.5, 0.2, 0.02);
        break;
      case 'rock': {
        const gz = this.ground(x, z);
        this.burst(this.alpha, x, gz + 0.2, z, 5, 0.4, 1.1, 0.2, 0.6, 0.6, 0.9, 0.4, 1, COLORS.dust, null, 0.5, CELL.SMOKE, 0, 2);
        const n = this.n(6);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU;
          const q = this.alpha.add(x, gz + 0.25, z, Math.cos(a) * rnd(1, 2.5), rnd(2, 4), Math.sin(a) * rnd(1, 2.5), rnd(0.6, 0.9), rnd(0.12, 0.2), 0.1, COLORS.debris, 1, CELL.SHARD, 14);
          this.alpha.setSpin(q, Math.random() * TAU, rnd(-8, 8));
          this.alpha.setFloor(q, gz + 0.04);
        }
        break;
      }
      case 'explode':
        this.flashLight(x, h, z, pal.mid, 9 * big, 4 + 2 * big, 0.45, 0.03);
        this.add.setHeat(this.add.add(x, h, z, 0, 0, 0, 0.25, 1.2 * big, 2.0 * big, pal.core, 0.95, CELL.GLOW), 1.6);
        this.burst(this.add, x, h, z, 12 * big, 0.8, 2.5, 0.3, 1.8, 0.3, 0.5, 0.55 * big, 0.2, pal.mid, pal.alt, 0.7, CELL.FLAME, -1, 2.5);
        this.burst(this.add, x, h, z, 8, 2, 4.5, 1, 3, 0.4, 0.7, 0.13, 0.04, COLORS.ember, pal.alt, 1, CELL.SPARK, 7, 0.5);
        this.burst(this.alpha, x, h, z, 4 * big, 0.3, 0.8, 0.4, 1, 0.7, 1.1, 0.5 * big, 1.3 * big, pal.smoke, null, 0.35, CELL.SMOKE, -0.3, 1.5);
        break;
      case 'puff':
        this.burst(this.add, x, h, z, 7, 0.6, 2, -0.3, 1, 0.3, 0.5, 0.2, 0.04, pal.glow, null, 0.9, CELL.STAR, 1.5, 1.5);
        if (p.kind === 'leaf') this.burst(this.alpha, x, h, z, 6, 0.6, 1.8, 0.5, 1.5, 0.6, 0.9, 0.14, 0.1, pal.el === 'nature' ? pal.glow : pal.alt, null, 0.9, CELL.SHARD, 3, 1);
        else this.burst(this.alpha, x, h, z, 3, 0.4, 1, 0, 0.6, 0.5, 0.8, 0.2, 0.5, COLORS.white, null, 0.35, CELL.SMOKE, 0, 1);
        break;
      case 'splash': {
        const gz = this.ground(x, z);
        if (pal.el === 'water') {
          this.burst(this.alpha, x, Math.max(gz + 0.2, h - 0.3), z, 12, 0.8, 2.4, 1.5, 3.5, 0.4, 0.65, 0.22, 0.45, pal.core, null, 0.65, CELL.SMOKE, 7, 0.8);
        }
        this.burst(this.add, x, h, z, 10, 1, 2.5, 0.5, 2.5, 0.25, 0.4, 0.3, 0.05, pal.glow, pal.alt, 0.8, CELL.GLOW, 3, 1);
        const q = this.add.add(x, gz + 0.15, z, 0, 0, 0, 0.35, 0.5, 2.2, pal.glow, 0.7, CELL.RING);
        this.add.setFadeIn(q, 0.01);
        break;
      }
      case 'wisp':
        this.add.add(x, h, z, 0, 0, 0, 0.25, 0.9, 1.4, pal.glow, 0.8, CELL.GLOW);
        this.burst(this.add, x, h, z, 10, 0.4, 1.5, 0.5, 1.8, 0.4, 0.7, 0.4, 0.06, pal.glow, pal.alt, 0.7, CELL.GLOW, -0.5, 1.5);
        this.burst(this.alpha, x, h, z, 4, 0.2, 0.6, 0.3, 0.8, 0.6, 0.9, 0.4, 0.9, pal.gloom || pal.smoke, null, 0.35, CELL.SMOKE, 0, 1);
        break;
      case 'flash':
        this.add.add(x, h, z, 0, 0, 0, 0.2, 1.1, 1.8, pal.glow, 0.95, CELL.GLOW);
        this.burst(this.add, x, h, z, 7, 1, 2.8, 0, 2, 0.25, 0.45, 0.24, 0.04, pal.core, pal.glow, 1, CELL.STAR, 2, 1.5);
        break;
      case 'shatter': {
        const gz = this.ground(x, z);
        this.add.add(x, h, z, 0, 0, 0, 0.16, 0.7, 1.2, pal.core, 0.8, CELL.GLOW);
        const n = this.n(9);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU;
          const sp = rnd(1, 2.8);
          const q = this.alpha.add(x, h, z, Math.cos(a) * sp, rnd(0.5, 2.5), Math.sin(a) * sp, rnd(0.45, 0.7), rnd(0.1, 0.18), 0.06, Math.random() < 0.5 ? pal.core : pal.glow, 0.95, CELL.SHARD, 10);
          this.alpha.setSpin(q, Math.random() * TAU, rnd(-10, 10));
          this.alpha.setFloor(q, gz + 0.04);
        }
        this.burst(this.alpha, x, h, z, 3, 0.2, 0.6, 0, 0.3, 0.6, 0.9, 0.3, 0.8, pal.smoke, null, 0.3, CELL.SMOKE);
        break;
      }
      default:
        break;
    }
    if (p.burstR > 0) {
      const gz = this.ground(x, z);
      const R = p.burstR;
      this.flareFx(x, h, z, 1.2 + 0.4 * R, 2.2 + 0.7 * R, 0.35, pal.glow, pal.core, 0.9);
      this.decalFx(STYLE.ring, x, z, 0.2, R * 1.05, 0.5, pal.glow, pal.core, 0.9, 0.04, 0.3);
      this.decalFx(STYLE.flash, x, z, R, R, 0.4, pal.glow, pal.core, 0.6, 0.02, 0.35);
      this.burst(this.add, x, gz + 0.3, z, 14 + 6 * R, R * 1.5, R * 3, 0.5, 2.5, 0.35, 0.6, 0.28, 0.05, pal.core, pal.glow, 1, CELL.STAR, 3, 2.5);
      if (pal.gloom) this.decalFx(STYLE.shadow, x, z, R * 0.6, R, 1.2, pal.gloom, pal.gloom, 0.45, 0.05, 0.8);
    }
  }

  releaseProj(p) {
    if (p.slot >= 0) p.batch.free(p.slot);
    if (p.glow >= 0) this.glows.free(p.glow);
    if (p.light >= 0) this.lights.release(p.light, 0.12);
    if (p.rib) this.ribbons.release(p.rib);
    p.reset();
    this.projPool.push(p);
  }
}

export { RIBBON_MAX };
