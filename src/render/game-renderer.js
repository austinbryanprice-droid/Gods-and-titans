// The game's Three.js view (DESIGN 8). Reads only the ViewState (interpolated
// e.ix / e.iy / e.if, fog of war, last-seen enemy buildings, events) — never the
// World — so host and clients render identically.
//
//   const r = new GameRenderer(canvas, { viewState, setup, quality: 'medium' });
//   // per frame: viewState.update(now); r.update(dt); r.render();
//   r.camera.pan(dx, dy); r.camera.zoomBy(steps); r.camera.centerOn(x, y);
//   r.pickEntity(sx, sy); r.entitiesInRect(x0, y0, x1, y1); r.screenToWorld(sx, sy);
//
// Screen coordinates are CSS pixels relative to the canvas' top-left corner.
import * as THREE from 'three';
import { NEUTRAL_COLOR, PLAYER_COLORS, GOLD_MINE_AMOUNT, EXPANSION_MINE_AMOUNT, TERRAIN } from '../config.js';
import { UNITS, BUILDINGS, PANTHEONS } from '../data/index.js';
import { buildUnitModel, preloadUnitModels, clearUnitModelCache, AIR_HOVER_HEIGHT } from './models/unit-models.js';
import { buildBuildingModel, buildGoldMineModel, setBuildingTime, clearBuildingCaches } from './models/building-models.js';
import { createForest, createDecor } from './models/props.js';
import { createGroundCover } from './models/ground-cover.js';
import { heightAt, footprintHeight } from './height.js';
import { VFXSystem } from './vfx.js';
import { CameraController, CAMERA_DEFAULTS } from './camera.js';
import { FogOfWar, patchFowObject, FOW_UNIFORMS } from './fog.js';
import { createTerrain, WATER_LEVEL } from './terrain.js';
import { RingLayer, BlobLayer, StarLayer, BarLayer, MarkerLayer, FloatingTextLayer, RallyFlags, healthColor } from './overlays.js';
import { PlacementLayer } from './placement.js';
import { FireLayer } from './fires.js';
import { FadeMaterials, UnitFader, FADE_SECONDS, FADE_LEVELS } from './unit-fade.js';
import { StatusLayer } from './status-markers.js';
import { PostFX, RESIZE_SETTLE_MS } from './post.js';
import { createEnvironment, setCloudShadows, SUN_DIR, WORLD_UNIFORMS } from './shading.js';

// Low draws straight to the canvas; the others go through the post-processing
// pipeline (post.js: MSAA, bloom, + ambient occlusion on high / ultra), which
// also does the antialiasing, so the canvas itself never needs it.
// `minScale` bounds adaptive resolution (scene drawn below the canvas size
// while frames are slow); `vfx` is the VFX tier (it has no 'ultra').
const QUALITY = {
  low: { pixelRatio: 1, shadows: false, shadowSize: 0, shadowRadius: 1, clouds: 0, minScale: 1, vfx: 'low' },
  medium: { pixelRatio: 1.5, shadows: true, shadowSize: 2048, shadowRadius: 2.2, clouds: 0.3, minScale: 0.6, vfx: 'medium' },
  high: { pixelRatio: 2, shadows: true, shadowSize: 4096, shadowRadius: 2.6, clouds: 0.34, minScale: 0.6, vfx: 'high' },
  ultra: { pixelRatio: 2, shadows: true, shadowSize: 4096, shadowRadius: 3, clouds: 0.34, minScale: 0.7, vfx: 'high' },
};

// Light rig (linear, tone-mapped by post.js / the low path's Neutral mapping)
const SUN_COLOR = 0xfff1dc;
const SUN_INTENSITY = 2.6;
const SKY_COLOR = 0xd6e4ff;
const GROUND_COLOR = 0x5a5638;
const HEMI_INTENSITY = 0.85;
const ENV_INTENSITY = 0.55;
const EXPOSURE = 1.0;
// Adaptive resolution (frame times in ms, smoothed): slower than SLOW_FRAME_MS (and
// well past the display's own frame period) lowers the scene scale a step; frames
// that keep up with the display, or run faster than FAST_FRAME_MS on a high-refresh
// screen, raise it again.
const SLOW_FRAME_MS = 24;
const FAST_FRAME_MS = 15;
const SCALE_SETTLE = 90; // frames the average settles for after any step
const SCALE_UP_WAIT = 240; // frames before a step up (doubled while steps up keep being undone)
const SCALE_UP_WAIT_MAX = 3600;
const MAX_VSYNC_MS = 34; // no display or browser cap runs slower than 30 Hz: longer is the GPU
const AIR_RING_LIFT = AIR_HOVER_HEIGHT - 0.14; // flyers' rings: just under the hovering body
const DEATH_SECONDS = 1.65; // keep animating 'dead' this long (topple + sink)
const COLLAPSE_SECONDS = 1.6; // destroyed buildings sink this long
const EVENT_STALE = 1.5; // seconds of real time: queued VFX events older than this are dropped (hidden tab)
// Unit animation CPU budget per frame (ms). Past it, small on-screen units
// animate round robin (every 2nd..5th frame, accumulating dt).
const ANIM_MS = 2.0;
const ANIM_MIN = 60; // never fewer animations per frame than this
// Models built per frame for units coming into sight (they fade in, so a frame or
// two of delay is invisible): ~0.2 ms each, so a revealed army is spread out.
const NEW_VIEW_MS = 3;
const SHOW_SUMMON = new Set(['god', 'titan', 'creature', 'minion']);
const FILL_FROM = new Set(['beam', 'cone', 'wave', 'projectile', 'dash', 'blink']);
const FOLLOW_SHAPES = new Set(['buff', 'shield', 'heal']);

const STATUS_SLOW = new THREE.Color('#8fd4ff');
const STATUS_INVULN = new THREE.Color('#ffd76a');

const RELATION_COLORS = {
  own: new THREE.Color('#3dff4a'),
  ally: new THREE.Color('#c4f23a'),
  enemy: new THREE.Color('#ff3a2a'),
  neutral: new THREE.Color('#ffd83a'),
};
const PROGRESS_COLOR = new THREE.Color('#e9c64a');
const TRAIN_COLOR = new THREE.Color('#58b8ff');

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();
const _ray = { origin: new THREE.Vector3(), dir: new THREE.Vector3() };
const _vp = new THREE.Matrix4();
const _box = new THREE.Box3();
const _hit = new THREE.Vector3();
const _rayObj = new THREE.Ray();

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

const now = typeof performance !== 'undefined' && performance.now ? () => performance.now() : () => Date.now();

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + dx * t - px;
  const y = ay + dy * t - py;
  return Math.sqrt(x * x + y * y);
}

/** Main renderer. */
export class GameRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} o
   * @param {import('../game/view-state.js').ViewState} o.viewState
   * @param {object} [o.setup] GameSetup (defaults to viewState.setup)
   * @param {'low'|'medium'|'high'|'ultra'} [o.quality]
   * @param {THREE.WebGLRenderer} [o.webgl] an existing renderer to draw with (tests / tools)
   */
  constructor(canvas, { viewState, setup, quality = 'medium', webgl = null } = {}) {
    if (!viewState) throw new Error('GameRenderer needs a viewState.');
    this.vs = viewState;
    this.setup = setup || viewState.setup || { players: [] };
    this.map = viewState.map;
    this.width = this.map.width;
    this.height = this.map.height;
    this.quality = QUALITY[quality] ? quality : 'medium';
    const Q = QUALITY[this.quality];
    this.canvas = canvas;
    this.disposed = false;
    this.time = 0;
    this.frame = 0;
    this.lastUpdateMs = 0;
    this.animCost = 0.02; // ms per unit animation (measured)
    this.showAllBars = false;
    this.selection = new Set();
    this.hoverId = null;

    // ---- WebGL
    this.ownsWebgl = !webgl;
    this.renderer = webgl || new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setClearColor(0x050605, 1);
    this.renderer.shadowMap.enabled = Q.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // soft: vogel-disk taps scaled by shadow.radius
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.toneMappingExposure = EXPOSURE;
    if (this.renderer.info) this.renderer.info.autoReset = false; // several render() calls per frame
    // the post pipeline needs a real WebGLRenderer (tests draw through a stub)
    this.post = typeof this.renderer.setRenderTarget === 'function' ? new PostFX(this.renderer, this.quality) : null;
    if (this.post) this.post.look.aoFloor = WATER_LEVEL; // no ambient occlusion on the lake bed under the water
    this.renderScale = 1;
    this.lastRenderAt = 0;
    this.sizeTimer = 0; // fallback that applies a held-back post size when no frame follows
    this.vsyncMs = 1000 / 60; // the display's frame period (learned)
    this.resetAdaptive();
    this.applyPixelRatio();

    // ---- scene, lights
    const scene = (this.scene = new THREE.Scene());
    scene.name = 'game';
    scene.background = new THREE.Color(0x050605);
    // aerial haze: only the far edge of the view at the farthest zoom reaches it
    scene.fog = new THREE.Fog(0xaebfcc, 44, 170);
    this.hemi = new THREE.HemisphereLight(SKY_COLOR, GROUND_COLOR, HEMI_INTENSITY);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
    // along SUN_DIR on every quality (with shadows, updateShadowCamera re-centers it each frame)
    this.sun.position.copy(SUN_DIR).multiplyScalar(60);
    this.sun.castShadow = Q.shadows;
    this.sun.shadow.mapSize.set(Q.shadowSize || 1024, Q.shadowSize || 1024);
    this.sun.shadow.radius = Q.shadowRadius;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 140;
    this.shadowR = 0;
    scene.add(this.sun);
    scene.add(this.sun.target);
    // image-based lighting from a procedural sky (reflections on metal, stone, lacquer)
    this.env = createEnvironment(this.ownsWebgl ? this.renderer : null);
    if (this.env) {
      scene.environment = this.env.texture;
      scene.environmentIntensity = ENV_INTENSITY;
    }
    // After a lost context comes back (GPU reset, driver update, mobile tab eviction)
    // three re-uploads textures from their data, but the environment was rendered on
    // the GPU and has none: render it again. (The old one went with the old context;
    // disposing it would delete handles that context owned.) Registered after three's
    // own handler, so the GL state is already rebuilt when this runs.
    this.onContextRestored = () => {
      if (this.disposed || !this.env) return;
      this.env = createEnvironment(this.renderer);
      scene.environment = this.env ? this.env.texture : null;
    };
    const dom = this.ownsWebgl ? this.renderer.domElement : null;
    if (dom && typeof dom.addEventListener === 'function') dom.addEventListener('webglcontextrestored', this.onContextRestored);
    setCloudShadows(Q.clouds);

    // Overlays that must keep their exact colors (health bars, selection rings,
    // markers, text, rally flags, placement ghosts, status icons) live in their
    // own scene, drawn after post-processing, depth-tested against the world.
    const overlayScene = (this.overlayScene = new THREE.Scene());
    overlayScene.name = 'overlays';
    this.overlayHemi = new THREE.HemisphereLight(SKY_COLOR, GROUND_COLOR, 1.15);
    this.overlaySun = new THREE.DirectionalLight(SUN_COLOR, 2.45);
    this.overlaySun.position.copy(SUN_DIR).multiplyScalar(60);
    overlayScene.add(this.overlayHemi, this.overlaySun);

    // ---- camera
    const cam = new THREE.PerspectiveCamera(CAMERA_DEFAULTS.fov, 16 / 9, 0.5, 400);
    this.camera = new CameraController(cam, { mapWidth: this.width, mapHeight: this.height, heightFn: (x, y) => heightAt(this.map, x, y) });
    this.threeCamera = cam;

    // ---- world layers
    this.fow = new FogOfWar(this.width, this.height);
    this.terrain = createTerrain(this.map, { quality: this.quality });
    scene.add(this.terrain.group);
    this.heightFn = (x, y) => heightAt(this.map, x, y);
    this.buildForest();
    this.decor = createDecor(this.map, this.heightFn);
    this.decor.object3d.traverse((o) => {
      if (o.isMesh) o.receiveShadow = true;
    });
    scene.add(this.decor.object3d);
    patchFowObject(this.decor.object3d);
    this.groundCover = createGroundCover(this.map, this.heightFn, { quality: this.quality });
    scene.add(this.groundCover.object3d);
    patchFowObject(this.groundCover.object3d);
    this.rockDecor = this.buildRockDecor();
    if (this.rockDecor) {
      scene.add(this.rockDecor.object3d);
      patchFowObject(this.rockDecor.object3d);
    }

    this.entityRoot = new THREE.Group();
    this.entityRoot.name = 'entities';
    scene.add(this.entityRoot);
    // world-space overlays that belong to the lit, post-processed picture
    this.groundFxRoot = new THREE.Group();
    this.groundFxRoot.name = 'ground-fx';
    scene.add(this.groundFxRoot);
    this.overlayRoot = new THREE.Group();
    this.overlayRoot.name = 'overlays';
    overlayScene.add(this.overlayRoot);

    this.vfx = new VFXSystem(scene, (x, y) => this.groundAt(x, y), { quality: Q.vfx });

    this.blobs = new BlobLayer(this.groundFxRoot);
    this.rings = new RingLayer(this.overlayRoot);
    this.stars = new StarLayer(this.groundFxRoot);
    this.status = new StatusLayer(this.overlayRoot);
    // burning buildings offer their flickering light to the VFX light pool
    this.fires = new FireLayer(this.groundFxRoot, undefined, this.vfx.lights);
    this.bars = new BarLayer(this.overlayRoot);
    this.markers = new MarkerLayer(this.overlayRoot);
    this.texts = new FloatingTextLayer(this.overlayRoot);
    this.flags = new RallyFlags(this.overlayRoot, 12, (x, y) => heightAt(this.map, x, y));
    this.placement = new PlacementLayer(this.overlayRoot, this.map, () => ({
      pantheon: PANTHEONS[this.pantheonOf(this.vs.myIndex)] || null,
      color: this.colorOf(this.vs.myIndex),
    }));

    // ---- entity views
    this.units = new Map(); // id → UnitView
    this.buildings = new Map(); // id → BuildingView
    this.mines = new Map(); // id → MineView
    this.dying = []; // UnitViews playing their death
    this.fadeMats = new FadeMaterials(); // see-through variants for units fading at the vision edge
    this.collapsing = []; // destroyed building views sinking
    this.deaths = new Map(); // id → time of its death event (renderer clock)
    this.castTargets = new Map(); // caster id → { target, t }
    this.lastHit = new Map(); // dst id → time of the last hit spark
    this.pendingHits = []; // delayed melee sparks
    this.pendingFell = new Map(); // tile index → [tx, ty] felled out of sight
    this.plannedBuilds = [];
    this.fieldShown = new Set(); // ground-zone ids that have a visual
    this.recentZones = []; // lasting effects spawned from events: { x, y, t }
    this.events = [];
    this.lastSnapshot = -1;
    this.mineInitial = new Map();
    for (const m of this.map.mines || []) this.mineInitial.set(`${m.tx},${m.ty}`, m.amount);
    this.extra = { moving: false, attackPhase: undefined, level: 1, carry: 0, gather: undefined, speed: 0 };
    this.screenScratch = { sx: 0, sy: 0, onScreen: false };
    this.stats = { drawCalls: 0, triangles: 0, entities: 0, updateMs: 0 };

    // ---- events
    this.unsub = [
      this.vs.on('*', (ev) => this.onEvent(ev)),
    ];
    for (const [tx, ty] of this.vs.felledAll || []) this.forest.fell(tx, ty);

    this.preload();
    this.warmUp();
    const w = canvas.clientWidth || canvas.width || 1280;
    const h = canvas.clientHeight || canvas.height || 720;
    this.resize(w, h);
    this.centerOnStart();
  }

  // ------------------------------------------------------------------ setup helpers

  applyPixelRatio() {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.renderer.setPixelRatio(Math.min(dpr, QUALITY[this.quality].pixelRatio));
  }

  /** Size the post-processing targets to the canvas' drawing buffer. */
  syncPostSize() {
    if (!this.post || typeof this.renderer.getDrawingBufferSize !== 'function') return;
    const v = this.renderer.getDrawingBufferSize(this._dbs || (this._dbs = new THREE.Vector2()));
    this.post.setSize(v.x, v.y, now());
    this.armSizeSettle();
  }

  /**
   * The post targets are reallocated once a changed size has held still (post.setSize),
   * which render() applies. With no frames following (a paused game redraws only on a
   * resize) a timer applies it and redraws once.
   */
  armSizeSettle() {
    const post = this.post;
    if (this.sizeTimer || this.disposed || !post || !post.enabled || !post.sizePending) return;
    const wait = Math.max(16, post.sizeAt + RESIZE_SETTLE_MS - now() + 8);
    const timer = (this.sizeTimer = setTimeout(() => {
      this.sizeTimer = 0;
      if (this.disposed || !this.post) return;
      if (!this.post.settleSize(now())) this.armSizeSettle(); // sized again meanwhile
      else {
        try {
          this.render();
        } catch (err) {
          console.error('[render] redraw after resize failed', err);
        }
      }
    }, wait));
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  buildForest() {
    // Build from the original forest (felled trees restored) so felled tiles get stumps.
    const terrain = Uint8Array.from(this.map.terrain);
    for (const [tx, ty] of this.vs.felledAll || []) terrain[ty * this.width + tx] = TERRAIN.FOREST;
    this.forest = createForest({ ...this.map, terrain }, this.heightFn);
    this.scene.add(this.forest.object3d);
    patchFowObject(this.forest.object3d);
  }

  /** A few boulders on every impassable rock tile so cliffs read as rock. */
  buildRockDecor() {
    const decor = [];
    const W = this.width;
    const T = this.map.terrain;
    for (let ty = 0; ty < this.height; ty++) {
      for (let tx = 0; tx < W; tx++) {
        if (T[ty * W + tx] !== TERRAIN.ROCK) continue;
        const h = Math.sin(tx * 12.9898 + ty * 78.233) * 43758.5453;
        const r = h - Math.floor(h);
        decor.push({ x: tx + 0.3 + r * 0.4, y: ty + 0.35 + (1 - r) * 0.3, kind: 'rock', rot: r * 6.28, scale: 1.5 + r * 0.7 });
        if (r > 0.45) decor.push({ x: tx + 0.75 - r * 0.3, y: ty + 0.7, kind: 'rock', rot: r * 3.1, scale: 0.9 + r * 0.5 });
      }
    }
    if (!decor.length) return null;
    const d = createDecor({ ...this.map, decor }, this.heightFn);
    d.object3d.name = 'rock-decor';
    return d;
  }

  preload() {
    const types = [];
    for (const u of Object.values(UNITS)) {
      if (!u.pantheon) types.push(u);
    }
    const pantheons = new Set();
    for (const p of this.setup.players || []) if (p && p.pantheon) pantheons.add(p.pantheon);
    for (const p of this.vs.players || []) if (p && p.pantheon) pantheons.add(p.pantheon);
    for (const u of Object.values(UNITS)) if (u.pantheon && pantheons.has(u.pantheon)) types.push(u);
    for (const e of this.vs.entities.values()) if (e.k === 'u' && UNITS[e.t]) types.push(UNITS[e.t]);
    try {
      preloadUnitModels(types);
    } catch (err) {
      console.error('[render] preload failed', err);
    }
  }

  /**
   * Build every building (all tiers, plus a construction stage) and unit model
   * each player can field once, in their colors, and compile their shader
   * programs now (with the overlays' and the VFX pools'), so the first barracks,
   * titan, nova or rally flag of a match does not hitch.
   */
  warmUp() {
    const group = new THREE.Group();
    group.name = 'warmup';
    const models = [];
    const add = (m, fow) => {
      models.push(m);
      group.add(m.root);
      if (fow) patchFowObject(m.root); // as touchBuilding does (units are not fogged)
    };
    const players = (this.vs.players && this.vs.players.length ? this.vs.players : this.setup.players) || [];
    try {
      players.forEach((p, i) => {
        if (!p) return;
        const pantheon = PANTHEONS[p.pantheon] || null;
        const color = this.colorOf(i);
        for (const t of Object.keys(BUILDINGS)) {
          const tiers = t === 'town_center' ? [1, 2, 3] : [1];
          for (const tier of tiers) add(buildBuildingModel(t, pantheon, color, tier), true);
        }
        const site = buildBuildingModel('barracks', pantheon, color, 1);
        site.setProgress(0.5);
        add(site, true);
        const rel = this.vs.relation ? this.vs.relation(i) : 'enemy';
        const fades = rel !== 'own' && rel !== 'ally' ? new Set() : null;
        for (const u of Object.values(UNITS)) {
          if (!u.visual || (u.pantheon && u.pantheon !== p.pantheon)) continue;
          const m = buildUnitModel(u, color);
          add(m);
          if (!fades) continue;
          // the see-through variants enemy units use while fading at the vision edge
          m.root.traverse((o) => {
            if (!o.isMesh || fades.has(o.material)) return;
            fades.add(o.material);
            const f = new THREE.Mesh(o.geometry, this.fadeMats.get(o.material, FADE_LEVELS >> 1));
            f.position.copy(o.position);
            group.add(f);
          });
        }
      });
      this.scene.add(group);
      if (typeof this.renderer.compile === 'function') {
        // compile for the target the world is drawn into (linear HDR) or the canvas (low)
        const target = this.post && this.post.enabled ? this.post.sceneTarget() : null;
        const prevTone = this.renderer.toneMapping;
        if (target) this.renderer.setRenderTarget(target);
        else this.renderer.toneMapping = THREE.NeutralToneMapping;
        this.renderer.compile(this.scene, this.threeCamera);
        if (target) this.renderer.setRenderTarget(null);
        // the overlays (drawn to the canvas, untoned) make some materials on first use
        this.flags.prewarm();
        this.placement.prewarm();
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.compile(this.overlayScene, this.threeCamera);
        this.renderer.toneMapping = prevTone;
      }
    } catch (err) {
      console.error('[render] warm-up failed', err);
    } finally {
      group.removeFromParent();
      for (const m of models) m.dispose();
    }
  }

  /** Center the camera on the local player's town center (or start position). */
  centerOnStart() {
    const me = this.vs.myIndex;
    let best = null;
    for (const e of this.vs.entities.values()) {
      if (e.k === 'b' && e.o === me && e.t === 'town_center') {
        best = e;
        break;
      }
    }
    if (best) this.camera.centerOn(best.x, best.y + 1.5);
    else {
      const s = this.map.starts && this.map.starts[me];
      if (s) this.camera.centerOn(s.x + 2, s.y + 3.5);
      else this.camera.centerOn(this.width / 2, this.height / 2);
    }
    this.camera.update(0);
  }

  // ------------------------------------------------------------------ players

  colorOf(owner) {
    if (owner === undefined || owner === null || owner < 0) return NEUTRAL_COLOR;
    const p = (this.vs.players && this.vs.players[owner]) || (this.setup.players && this.setup.players[owner]);
    return (p && p.color) || PLAYER_COLORS[owner % PLAYER_COLORS.length];
  }

  pantheonOf(owner) {
    if (owner === undefined || owner === null || owner < 0) return null;
    const p = (this.vs.players && this.vs.players[owner]) || (this.setup.players && this.setup.players[owner]);
    return p && PANTHEONS[p.pantheon] ? p.pantheon : null;
  }

  groundAt(x, y) {
    return heightAt(this.map, x, y);
  }

  // ------------------------------------------------------------------ public API

  /** Resize the drawing buffer to w × h CSS pixels (at the current devicePixelRatio, capped by quality). */
  resize(w, h) {
    this.viewW = Math.max(1, Math.floor(w));
    this.viewH = Math.max(1, Math.floor(h));
    this.applyPixelRatio(); // browser zoom or another screen changes devicePixelRatio
    this.renderer.setSize(this.viewW, this.viewH, !!(this.canvas && this.canvas.style));
    this.camera.setViewport(this.viewW, this.viewH);
    this.syncPostSize();
  }

  /**
   * Change quality live: pixel ratio, shadows, VFX density, and the post-processing
   * pipeline with its MSAA (post.js allocates its targets per quality; the canvas
   * itself never has antialiasing).
   */
  setQuality(q) {
    if (!QUALITY[q] || q === this.quality) return;
    this.quality = q;
    const Q = QUALITY[q];
    if (this.post) this.post.setQuality(q);
    this.setRenderScale(1);
    this.resetAdaptive();
    this.resize(this.viewW, this.viewH);
    const was = this.renderer.shadowMap.enabled;
    this.renderer.shadowMap.enabled = Q.shadows;
    this.sun.castShadow = Q.shadows;
    this.sun.shadow.radius = Q.shadowRadius;
    if (Q.shadows) this.sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
    // reallocated at the new size when shadows are on; freed on low (up to 4096²)
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    if (was !== Q.shadows) this.scene.traverse((o) => {
      if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
    });
    setCloudShadows(Q.clouds);
    this.terrain.setQuality(q);
    this.groundCover.setQuality(q);
    patchFowObject(this.groundCover.object3d); // meshes built on the first non-low quality
    this.vfx.setQuality(Q.vfx);
    const cast = this.unitsCastShadows();
    for (const v of this.units.values()) v.setCastShadow(cast);
  }

  /** Unit meshes cast real shadows on high and ultra; blob shadows ground them everywhere. */
  unitsCastShadows() {
    return (this.quality === 'high' || this.quality === 'ultra') && QUALITY[this.quality].shadows;
  }

  /** Scene resolution relative to the canvas (adaptive resolution; post-processed qualities only). */
  setRenderScale(s) {
    const Q = QUALITY[this.quality];
    s = clamp(s, Q.minScale, 1);
    this.renderScale = s;
    if (this.post) this.post.setRenderScale(s);
  }

  /** Start adaptive resolution afresh (new quality: frame times measured before no longer apply). */
  resetAdaptive() {
    this.frameMs = this.vsyncMs;
    this.scaleHold = SCALE_SETTLE; // first-frame shader compiles and uploads settle
    this.upWait = 0;
    this.upWaitNext = SCALE_UP_WAIT;
    this.adaptN = 0;
    this.upAt = -Infinity;
  }

  /**
   * Adaptive resolution: while frames take longer than SLOW_FRAME_MS (smoothed),
   * draw the scene a step smaller; when they keep up with the display again,
   * step back up. Only the 3D scene scales (the composite sharpens it back to the
   * canvas); overlays and the HUD stay crisp.
   * @param {number} t frame timestamp (ms; the requestAnimationFrame time when there is one)
   */
  adaptResolution(t) {
    const last = this.lastRenderAt;
    this.lastRenderAt = t;
    if (!last || !this.post || !this.post.enabled) return;
    const ms = t - last;
    if (!(ms > 0) || ms > 250) return; // tab was hidden, paused, or a long stall
    // The display's frame period: vsync holds frames at it however idle the GPU is.
    // The shortest interval, creeping up so a lower rate (another screen, a 30 fps
    // battery-saver cap) is learned within a minute; one far shorter is a timer glitch.
    const v = (this.vsyncMs = Math.min(ms > this.vsyncMs * 0.4 ? ms : Infinity, this.vsyncMs + 0.01, MAX_VSYNC_MS));
    const slowMs = Math.max(SLOW_FRAME_MS, v * 1.3);
    // one long frame (garbage collection, a first-use shader) barely moves the average
    this.frameMs += (Math.min(ms, 2 * slowMs) - this.frameMs) * 0.05;
    const n = ++this.adaptN;
    if (this.upWait > 0) this.upWait--;
    if (this.scaleHold > 0) {
      this.scaleHold--;
      return;
    }
    const Q = QUALITY[this.quality];
    if (this.frameMs > slowMs && this.renderScale > Q.minScale + 0.01) {
      // undoing a step up made shortly before: wait longer before the next one
      this.upWaitNext = n - this.upAt < 1800 ? Math.min(this.upWaitNext * 2, SCALE_UP_WAIT_MAX) : SCALE_UP_WAIT;
      this.upWait = this.upWaitNext;
      this.setRenderScale(this.renderScale - 0.1);
      this.scaleHold = SCALE_SETTLE;
    } else if (this.frameMs < Math.max(v * 1.12, v + 1, FAST_FRAME_MS) && this.upWait <= 0 && this.renderScale < 0.99) {
      this.setRenderScale(this.renderScale + 0.1);
      this.scaleHold = SCALE_SETTLE;
      this.upWait = SCALE_UP_WAIT;
      this.upAt = n;
    }
  }

  setSelection(ids) {
    this.selection.clear();
    if (ids) for (const id of ids) this.selection.add(id);
  }

  setHover(id) {
    this.hoverId = id || null;
  }

  /** Builds ordered in the current Shift placement ([{ b, tx, ty }]), drawn like pending orders. */
  setPlannedBuilds(list) {
    this.plannedBuilds = list ? list.slice() : [];
  }

  setShowAllBars(on) {
    this.showAllBars = !!on;
  }

  /**
   * Placement ghost for a building with its footprint's top-left tile at (tx, ty).
   * @param {string} buildingTypeId
   * @param {number} tx
   * @param {number} ty
   * @param {boolean} valid
   * @param {ArrayLike<boolean|number>} [tiles] optional per-tile validity, row-major size×size
   */
  showPlacement(buildingTypeId, tx, ty, valid, tiles) {
    this.placement.show(buildingTypeId, tx | 0, ty | 0, valid, tiles || null);
  }

  hidePlacement() {
    this.placement.hide();
  }

  /** Animated ground marker: 'move' (green), 'attack' (red), 'gather' (yellow). */
  showCommandMarker(x, y, kind = 'move') {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const h = Math.max(this.groundAt(x, y), WATER_LEVEL);
    this.markers.spawn(x, h + 0.04, y, kind, this.groundNormal(x, y, _n));
  }

  /** Floating text over a sim point ("+25" bounty, "Level 3"); h = height above ground. */
  showFloatingText(x, y, text, color = '#ffd84a', h = 1.6) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.texts.spawn(x, this.groundAt(x, y) + h, y, text, color);
  }

  /** @returns {{drawCalls:number, triangles:number, entities:number, updateMs:number}} */
  getStats() {
    const info = this.renderer.info.render;
    this.stats.drawCalls = info.calls;
    this.stats.triangles = info.triangles;
    return this.stats;
  }

  // ------------------------------------------------------------------ events

  onEvent(ev) {
    if (this.disposed || !ev) return;
    switch (ev.type) {
      case 'death':
        this.deaths.set(ev.id, this.time);
        break;
      case 'treeFelled':
        this.onTreeFelled(ev);
        return;
      case 'cast':
        this.castTargets.set(ev.src, { target: ev.target || 0, t: this.time });
        return;
      case 'attack':
      case 'projectile':
      case 'hit':
      case 'effect':
      case 'spawn':
      case 'levelUp':
      case 'construction':
      case 'buildingComplete':
      case 'tierUp':
      case 'bounty':
      case 'resourceDepleted':
        break;
      default:
        return;
    }
    if (this.events.length > 1500) this.events.splice(0, this.events.length - 1000);
    // stamped on the real clock: this.time only advances in update() (dt is capped), so
    // it stands still while the tab is hidden and could never tell how old an event is
    this.events.push({ ev, at: now() });
  }

  onTreeFelled(ev) {
    const { tx, ty } = ev;
    if (ev.sync || this.vs.revealAll || this.vs.isVisibleAt(tx + 0.5, ty + 0.5)) {
      if (this.forest.fell(tx, ty) && !ev.sync) this.vfx.spawnDust({ x: tx + 0.5, y: ty + 0.5, size: 0.9 });
    } else {
      this.pendingFell.set(ty * this.width + tx, [tx, ty]);
    }
  }

  processEvents() {
    const list = this.events;
    if (!list.length) return;
    const cutoff = now() - EVENT_STALE * 1000;
    for (let i = 0; i < list.length; i++) {
      const { ev, at } = list[i];
      if (at < cutoff) continue;
      try {
        this.handleEvent(ev);
      } catch (err) {
        if (!this.warnedEvent) console.error('[render] event failed', ev && ev.type, err);
        this.warnedEvent = true;
      }
    }
    list.length = 0;
  }

  visibleAt(x, y) {
    return this.vs.revealAll || this.vs.isVisibleAt(x, y);
  }

  /** Rendered (interpolated) position of an entity id, or null. */
  posOf(id, out = { x: 0, y: 0 }) {
    const e = this.vs.entities.get(id);
    if (!e) return null;
    out.x = e.ix ?? e.x;
    out.y = e.iy ?? e.y;
    return out;
  }

  /** Height above ground to aim projectiles / sparks at. */
  aimHeight(id, k = 0.5) {
    const u = this.units.get(id);
    if (u) {
      if (u.air) return AIR_HOVER_HEIGHT + (u.height - AIR_HOVER_HEIGHT) * k;
      return u.height * k;
    }
    const b = this.buildings.get(id);
    if (b) return b.height * k * 0.9;
    const m = this.mines.get(id);
    if (m) return 0.7;
    return 0.7;
  }

  attackElement(id) {
    const e = this.vs.entities.get(id);
    if (!e) return 'physical';
    const def = e.k === 'u' ? UNITS[e.t] : BUILDINGS[e.t];
    return (def && def.attack && def.attack.element) || 'physical';
  }

  handleEvent(ev) {
    const vs = this.vs;
    const vfx = this.vfx;
    switch (ev.type) {
      case 'attack': {
        const u = this.units.get(ev.src);
        if (u && u.visible) u.startAttack(this.time, !!ev.ranged);
        break;
      }
      case 'projectile': {
        if (!this.visibleAt(ev.fx, ev.fy) && !this.visibleAt(ev.tx, ev.ty)) break;
        const src = vs.entities.get(ev.src);
        const dst = vs.entities.get(ev.dst);
        const fx = src ? src.ix ?? src.x : ev.fx;
        const fy = src ? src.iy ?? src.y : ev.fy;
        const tx = dst ? dst.ix ?? dst.x : ev.tx;
        const ty = dst ? dst.iy ?? dst.y : ev.ty;
        const dstId = ev.dst;
        const toH = this.aimHeight(dstId, 0.5);
        vfx.spawnProjectile({
          kind: ev.kind,
          el: ev.el,
          from: { x: fx, y: fy, h: this.aimHeight(ev.src, 0.62) },
          to: { x: tx, y: ty, h: toH },
          flight: ev.flight,
          track: (out) => {
            const d = this.vs.entities.get(dstId);
            if (!d) return false;
            out.x = d.ix ?? d.x;
            out.y = d.iy ?? d.y;
            out.h = toH;
            return true;
          },
        });
        break;
      }
      case 'hit': {
        const dst = vs.entities.get(ev.dst);
        if (!dst) break;
        const x = dst.ix ?? dst.x;
        const y = dst.iy ?? dst.y;
        if (!this.visibleAt(x, y)) break;
        const last = this.lastHit.get(ev.dst);
        if (last !== undefined && this.time - last < 0.12) break;
        this.lastHit.set(ev.dst, this.time);
        const src = vs.entities.get(ev.src);
        const srcDef = src && (src.k === 'u' ? UNITS[src.t] : BUILDINGS[src.t]);
        const melee = srcDef && srcDef.attack && !srcDef.attack.projectile && src.k === 'u';
        const el = this.attackElement(ev.src);
        const delay = melee ? 0.1 : 0;
        this.pendingHits.push({ t: this.time + delay, id: ev.dst, el });
        break;
      }
      case 'death': {
        if (!this.visibleAt(ev.x, ev.y) && !(this.units.get(ev.id) || {}).visible) break;
        let scale = 1;
        if (ev.k === 'b') scale = (BUILDINGS[ev.t] && BUILDINGS[ev.t].size) || 2;
        else if (UNITS[ev.t]) scale = UNITS[ev.t].visual.scale || 1;
        const u = this.units.get(ev.id);
        const x = u ? u.x : ev.x;
        const y = u ? u.y : ev.y;
        vfx.spawnDeath({ x, y, scale });
        break;
      }
      case 'effect': {
        const visible = this.visibleAt(ev.x, ev.y) || (Number.isFinite(ev.fx) && this.visibleAt(ev.fx, ev.fy));
        if (!visible) break;
        const opts = { ...ev };
        if (FILL_FROM.has(ev.shape) && !(Number.isFinite(ev.fx) && Number.isFinite(ev.fy)) && ev.src) {
          const p = this.posOf(ev.src);
          if (p) {
            opts.fx = p.x;
            opts.fy = p.y;
          }
        }
        if (FOLLOW_SHAPES.has(ev.shape)) {
          const fid = this.followTarget(ev);
          if (fid) {
            opts.follow = (out) => {
              const e = this.vs.entities.get(fid);
              if (!e) return false;
              // Snapshots carry every unit: never track one into the fog.
              if (!this.vs.isEntityVisible(e)) {
                out.hidden = true;
                return false;
              }
              out.x = e.ix ?? e.x;
              out.y = e.iy ?? e.y;
              return true;
            };
          }
        }
        vfx.spawnEffect(opts);
        if ((ev.duration || 0) > 1) {
          const z = this.recentZones;
          z.push({ x: ev.x, y: ev.y, t: this.time });
          if (z.length > 32) z.shift();
        }
        break;
      }
      case 'spawn': {
        const e = vs.entities.get(ev.id);
        if (!e || !vs.isEntityVisible(e)) break;
        const def = UNITS[ev.t];
        if (!def) break;
        if (SHOW_SUMMON.has(def.class)) {
          const el = (def.attack && def.attack.element) || (def.abilities[0] && def.abilities[0].vfx && def.abilities[0].vfx.element) || 'holy';
          vfx.spawnSummon({ x: e.x, y: e.y, scale: def.visual.scale || 1, el });
        } else {
          vfx.spawnDust({ x: e.x, y: e.y, size: 0.7 });
        }
        break;
      }
      case 'levelUp': {
        const e = vs.entities.get(ev.id);
        if (!e || !vs.isEntityVisible(e)) break;
        const x = e.ix ?? e.x;
        const y = e.iy ?? e.y;
        vfx.spawnLevelUp({ x, y });
        const u = this.units.get(ev.id);
        this.showFloatingText(x, y, `Level ${ev.level}`, '#ffe27a', (u ? u.height : 2) + 0.5);
        break;
      }
      case 'construction':
      case 'buildingComplete': {
        const e = vs.entities.get(ev.id);
        if (!e || !vs.isEntityVisible(e)) break;
        const size = (BUILDINGS[ev.t] && BUILDINGS[ev.t].size) || 2;
        vfx.spawnDust({ x: e.x, y: e.y, size });
        break;
      }
      case 'tierUp': {
        for (const e of vs.entities.values()) {
          if (e.k !== 'b' || e.o !== ev.player || e.t !== 'town_center' || !vs.isEntityVisible(e)) continue;
          vfx.spawnSummon({ x: e.x, y: e.y, scale: 3, el: 'holy' });
          vfx.spawnDust({ x: e.x, y: e.y, size: 4 });
        }
        break;
      }
      case 'bounty': {
        if (ev.player !== vs.myIndex || !this.visibleAt(ev.x, ev.y)) break;
        this.showFloatingText(ev.x, ev.y, `+${ev.amount}`, '#ffd23a', 1.9);
        break;
      }
      case 'resourceDepleted': {
        const m = this.mines.get(ev.id);
        if (m && this.visibleAt(m.x, m.y)) vfx.spawnDust({ x: m.x, y: m.y, size: 3 });
        break;
      }
      default:
        break;
    }
  }

  /**
   * Lasting ground zones (vs.fields) whose cast was not seen (out of sight,
   * joined late) get a generic 'field' visual for their remaining time once
   * their center is visible.
   */
  syncFields() {
    const list = this.vs.fields;
    const shown = this.fieldShown;
    if (!list || !list.length) {
      if (shown.size) shown.clear();
      return;
    }
    for (const f of list) {
      if (shown.has(f.id) || !this.visibleAt(f.x, f.y)) continue;
      shown.add(f.id);
      let covered = false;
      for (const z of this.recentZones) {
        if (this.time - z.t < 2 && Math.abs(z.x - f.x) < 0.75 && Math.abs(z.y - f.y) < 0.75) {
          covered = true;
          break;
        }
      }
      if (!covered && f.rem > 0.4) this.vfx.spawnEffect({ el: f.el || 'arcane', shape: 'field', x: f.x, y: f.y, r: f.r || 2, duration: f.rem });
    }
    if (shown.size > list.length) {
      for (const id of shown) if (!list.some((f) => f.id === id)) shown.delete(id);
    }
  }

  /** Unit a buff / shield / heal visual should stay on. */
  followTarget(ev) {
    const near = (id, r) => {
      const e = this.vs.entities.get(id);
      if (!e || e.k !== 'u') return false;
      return Math.hypot(e.x - ev.x, e.y - ev.y) <= r;
    };
    const ct = ev.src ? this.castTargets.get(ev.src) : null;
    if (ct && ct.target && this.time - ct.t < 2 && near(ct.target, 1.5)) return ct.target;
    if (ev.src && near(ev.src, 0.9)) return ev.src;
    // nearest unit at the point
    let best = 0;
    let bd = 0.7;
    for (const e of this.vs.entities.values()) {
      if (e.k !== 'u') continue;
      const d = Math.hypot(e.x - ev.x, e.y - ev.y);
      if (d < bd) {
        bd = d;
        best = e.id;
      }
    }
    return best;
  }

  flushPendingHits() {
    const list = this.pendingHits;
    if (!list.length) return;
    let j = 0;
    for (let i = 0; i < list.length; i++) {
      const h = list[i];
      if (h.t > this.time) {
        list[j++] = h;
        continue;
      }
      const e = this.vs.entities.get(h.id);
      if (!e) continue;
      const b = this.buildings.get(h.id);
      let x = e.ix ?? e.x;
      let y = e.iy ?? e.y;
      if (b) {
        x += (Math.random() - 0.5) * b.size * 0.5;
        y += (Math.random() - 0.5) * b.size * 0.4 + b.size * 0.15;
      }
      this.vfx.spawnHit({ x, y, h: this.aimHeight(h.id, b ? 0.45 : 0.55), el: h.el });
    }
    list.length = j;
  }

  // ------------------------------------------------------------------ sync

  /** Advance one frame: sync meshes with the view state, animate, VFX, overlays. */
  update(dt) {
    if (this.disposed) return;
    const t0 = now();
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
    this.time += dt;
    this.frame++;
    const vs = this.vs;

    // camera first so projections (culling, picking) use this frame's view
    const shake = this.vfx.shake;
    if (shake > 0) {
      const t = this.time;
      this.camera.setShake(shake * (Math.sin(t * 41.3) * 0.6 + Math.sin(t * 73.1 + 1.7) * 0.4), shake * (Math.sin(t * 37.7 + 0.6) * 0.6 + Math.sin(t * 67.9 + 2.9) * 0.4));
    } else this.camera.setShake(0, 0);
    this.camera.update(dt);
    _vp.multiplyMatrices(this.threeCamera.projectionMatrix, this.threeCamera.matrixWorldInverse);
    // the zoom too: the VFX lights go to what is on screen
    this.vfx.setFocus(this.camera.target.x, this.camera.target.y, this.camera.distance);

    const fresh = vs.snapshotCount !== this.lastSnapshot;
    if (fresh) {
      this.lastSnapshot = vs.snapshotCount;
      this.onSnapshot();
    }
    this.processEvents();
    if (fresh) this.syncFields();
    this.syncUnits(dt);
    this.animateDying(dt);
    this.animateBuildings(dt);
    this.flushPendingHits();

    this.fow.update(dt);
    WORLD_UNIFORMS.uTime.value = this.time;
    this.terrain.update(this.time);
    setBuildingTime(this.time);
    this.vfx.update(dt);
    this.updateOverlays(dt);
    this.updateShadowCamera();

    this.lastUpdateMs = now() - t0;
    this.stats.updateMs = this.lastUpdateMs;
  }

  /** Work done once per new snapshot (20 Hz): fog, buildings, mines, trees, build ghosts. */
  onSnapshot() {
    const vs = this.vs;
    this.fow.setGoal(vs.visible, vs.explored, vs.revealAll);
    this.syncStructures();
    if (this.pendingFell.size) {
      for (const [k, [tx, ty]] of this.pendingFell) {
        if (vs.revealAll || vs.isVisibleAt(tx + 0.5, ty + 0.5)) {
          this.forest.fell(tx, ty);
          this.pendingFell.delete(k);
        }
      }
    }
    // pending build orders of my workers (and the ones Shift-queued in the current placement)
    const orders = this._orders || (this._orders = []);
    orders.length = 0;
    for (const e of vs.entities.values()) if (e.k === 'u' && e.bo && e.o === vs.myIndex) orders.push(e.bo);
    for (const bo of this.plannedBuilds) orders.push(bo);
    this.placement.setOrders(orders);
    // forget stale bookkeeping
    if (this.frame % 4 === 0) {
      const t = this.time;
      for (const id of this.deaths.keys()) if (t - this.deaths.get(id) > 5) this.deaths.delete(id);
      for (const id of this.castTargets.keys()) if (t - this.castTargets.get(id).t > 5) this.castTargets.delete(id);
      for (const id of this.lastHit.keys()) if (t - this.lastHit.get(id) > 2) this.lastHit.delete(id);
    }
  }

  syncUnits(dt) {
    const vs = this.vs;
    const frame = this.frame;
    const ex = this.extra;
    const H = this.viewH;
    const W = this.viewW;
    const tanHalf = Math.tan((this.threeCamera.fov * Math.PI) / 360);
    const camPos = this.threeCamera.position;
    let count = 0;
    const onScreen = this._onScreen || (this._onScreen = []);
    const fadeStep = dt / FADE_SECONDS;
    const fadeMats = this.fadeMats;
    let createMs = 0;
    for (const e of vs.entities.values()) {
      if (e.k !== 'u') continue;
      let v = this.units.get(e.id);
      const vis = vs.isEntityVisible(e);
      if (!v) {
        if (!vis) continue;
        // enemies and creeps coming into sight fade in (not at load, never own / allied units)
        const rel = vs.relation(e.o);
        const fadeIn = frame > 1 && rel !== 'own' && rel !== 'ally';
        if (fadeIn && createMs > NEW_VIEW_MS) continue; // over budget: next frame
        const t0 = fadeIn ? now() : 0;
        v = this.createUnitView(e);
        if (fadeIn) createMs += now() - t0;
        if (!v) continue;
        if (fadeIn) v.fade = 0;
      }
      v.seen = frame;
      v.e = e;
      if (v.visible !== vis) {
        v.visible = vis;
        if (vis && v.fade <= 0) v.resetMotion(e);
        // out of sight: keep drawing (unpickable) while it fades out
      }
      const goal = vis ? 1 : 0;
      if (v.fade !== goal) {
        v.fade = vis ? Math.min(1, v.fade + fadeStep) : Math.max(0, v.fade - fadeStep);
        v.fader.apply(v.fade, fadeMats);
      }
      if (!vis && v.fade <= 0) {
        v.onScreen = false;
        continue;
      }
      if (vis) count++;
      // position, speed
      const x = e.ix;
      const y = e.iy;
      const dx = x - v.x;
      const dy = y - v.y;
      v.x = x;
      v.y = y;
      const inst = dt > 0 ? Math.sqrt(dx * dx + dy * dy) / dt : 0;
      v.speed += (Math.min(inst, 25) - v.speed) * (1 - Math.exp(-dt * 12));
      if (v.moving) {
        if (v.speed < 0.15) v.moving = false;
      } else if (v.speed > 0.3) v.moving = true;
      if (x !== v.gx || y !== v.gy) {
        // terrain sample only when the unit moved (most stand still)
        v.gx = x;
        v.gy = y;
        let h = heightAt(this.map, x, y);
        if (v.air && h < WATER_LEVEL) h = WATER_LEVEL;
        v.gh = h;
        v.nOk = false;
      }
      const gh = v.gh;
      const root = v.model.root;
      root.position.set(x, gh, y);
      root.rotation.y = -(e.if ?? e.f ?? 0);
      // screen position for culling, picking, bars
      const footY = gh + (v.air ? AIR_HOVER_HEIGHT - 0.25 : 0.05);
      const headY = gh + v.height * 0.92;
      _v.set(x, (footY + headY) * 0.5, y).applyMatrix4(_vp);
      const inFront = _v.z < 1;
      v.ndcX = _v.x;
      v.ndcY = _v.y;
      v.onScreen = inFront && _v.x > -1.25 && _v.x < 1.25 && _v.y > -1.3 && _v.y < 1.35;
      if (v.onScreen) {
        v.cx = (_v.x * 0.5 + 0.5) * W;
        v.cy = (0.5 - _v.y * 0.5) * H;
        _v.set(x, footY, y).applyMatrix4(_vp);
        v.fx = (_v.x * 0.5 + 0.5) * W;
        v.fy = (0.5 - _v.y * 0.5) * H;
        _v.set(x, headY, y).applyMatrix4(_vp);
        v.hx = (_v.x * 0.5 + 0.5) * W;
        v.hy = (0.5 - _v.y * 0.5) * H;
        const ddx = x - camPos.x;
        const ddy = (footY + headY) * 0.5 - camPos.y;
        const ddz = y - camPos.z;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
        const pxPerWorld = H / (2 * dist * tanHalf);
        v.pr = Math.max(10, (v.radius * 1.15 + 0.18) * pxPerWorld);
        onScreen.push(v);
      } else {
        v.skipped = Math.min(0.5, v.skipped + dt);
      }
    }
    // Animate on-screen units. With many on screen, each animates every
    // `stride`-th frame (round robin, accumulated dt) to bound the CPU cost;
    // big-on-screen units (close zoom, titans) always animate every frame.
    const n = onScreen.length;
    const budget = Math.max(ANIM_MIN, ANIM_MS / this.animCost);
    const stride = n <= budget ? 1 : Math.min(5, Math.ceil(n / budget));
    const ta = now();
    let animated = 0;
    for (let i = 0; i < n; i++) {
      const v = onScreen[i];
      if (stride > 1 && v.pr < 40 && (frame + v.id) % stride !== 0) {
        v.skipped = Math.min(0.5, v.skipped + dt);
        continue;
      }
      const e = v.e;
      ex.moving = v.moving;
      ex.speed = v.speed;
      ex.level = e.lv || 1;
      ex.carry = e.c || 0;
      let st = e.st;
      if (st === 'gather') {
        if (e.mw) {
          // waiting its turn at a full gold mine (`mw`, see notes/interface-requests.md
          // [renderfix → simfix]): stand by facing the mine, no pick swing
          st = 'idle';
          ex.gather = undefined;
        } else {
          const t = e.tg ? vs.entities.get(e.tg) : undefined;
          ex.gather = t !== undefined && t.k === 'm' ? 'g' : 'w';
        }
      } else ex.gather = undefined;
      ex.attackPhase = v.attackPhase(this.time);
      try {
        v.model.animate(st, this.time, Math.min(dt + v.skipped, 0.1), ex);
      } catch (err) {
        if (!this.warnedAnim) console.error('[render] unit animation failed', e.t, err);
        this.warnedAnim = true;
      }
      v.skipped = 0;
      animated++;
    }
    if (animated >= 8) {
      // running average cost of one animation (ms), clamped against timer noise
      const c = clamp((now() - ta) / animated, 0.004, 0.2);
      this.animCost += (c - this.animCost) * 0.1;
    }
    onScreen.length = 0;
    // gone from the view state: death animation or removal
    for (const v of this.units.values()) {
      if (v.seen === frame) continue;
      const id = v.id;
      this.units.delete(id);
      if (v.visible && this.deaths.has(id)) {
        v.dyingT = 0;
        this.dying.push(v);
      } else v.dispose();
    }
    this.unitCount = count;
  }

  createUnitView(e) {
    const def = UNITS[e.t];
    if (!def || !def.visual) return null;
    let model;
    try {
      model = buildUnitModel(def, this.colorOf(e.o));
    } catch (err) {
      console.error('[render] unit model failed', e.t, err);
      return null;
    }
    const v = new UnitView(e, def, model, this.vs.relation(e.o));
    v.setCastShadow(this.unitsCastShadows());
    this.entityRoot.add(model.root);
    this.units.set(e.id, v);
    return v;
  }

  animateDying(dt) {
    const list = this.dying;
    if (!list.length) return;
    let j = 0;
    const ex = this.extra;
    ex.moving = false;
    ex.attackPhase = undefined;
    ex.speed = 0;
    ex.carry = 0;
    ex.gather = undefined;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      v.dyingT += dt;
      if (v.dyingT >= DEATH_SECONDS) {
        v.dispose();
        continue;
      }
      try {
        v.model.animate('dead', this.time, dt, ex);
      } catch (err) {
        v.dispose();
        continue;
      }
      list[j++] = v;
    }
    list.length = j;
  }

  /**
   * Building and mine views for the latest snapshot. Runs at most once per
   * snapshot: from update(), or earlier from pickEntity() when a click comes in
   * after a snapshot but before the next frame (a building placed this tick is
   * clickable at once).
   */
  syncStructures() {
    const n = this.vs.snapshotCount;
    if (this.structureSnapshot === n) return;
    this.structureSnapshot = n;
    this.syncBuildings();
    this.syncMines();
  }

  syncBuildings() {
    const vs = this.vs;
    const tag = (this.buildingTag = (this.buildingTag || 0) + 1);
    const all = vs.revealAll;
    for (const e of vs.entities.values()) {
      if (e.k !== 'b') continue;
      if (all || vs.isAlly(e.o)) this.touchBuilding(e, e, tag);
      else if (e.o < 0 && vs.isEntityVisible(e)) this.touchBuilding(e, e, tag);
    }
    if (!all) {
      for (const ls of vs.lastSeen.values()) {
        const live = vs.entities.get(ls.id);
        const cur = live && vs.isEntityVisible(live) ? live : ls;
        this.touchBuilding(cur, ls, tag);
      }
    }
    for (const b of this.buildings.values()) {
      if (b.tag === tag) continue;
      const id = b.id;
      this.buildings.delete(id);
      if (this.deaths.has(id) && this.visibleAt(b.x, b.y)) {
        b.collapseT = 0;
        b.baseY = b.model.root.position.y;
        this.collapsing.push(b);
      } else b.dispose();
    }
  }

  touchBuilding(e, src, tag) {
    let b = this.buildings.get(e.id);
    const def = BUILDINGS[e.t];
    if (!def) return;
    if (!b) {
      let model;
      try {
        model = buildBuildingModel(e.t, PANTHEONS[this.pantheonOf(e.o)] || null, this.colorOf(e.o), e.tr || 1);
      } catch (err) {
        console.error('[render] building model failed', e.t, err);
        return;
      }
      b = new BuildingView(e, def, model, this.vs.relation(e.o));
      const tx = e.tx ?? Math.floor(e.x - def.size / 2);
      const ty = e.ty ?? Math.floor(e.y - def.size / 2);
      b.tx = tx;
      b.ty = ty;
      model.root.position.set(tx + def.size / 2, footprintHeight(this.map, tx, ty, def.size), ty + def.size / 2);
      model.root.traverse((o) => {
        if (o.isMesh) o.receiveShadow = true;
      });
      this.entityRoot.add(model.root);
      this.decor.hideInRect(tx - 0.2, ty - 0.2, tx + def.size + 0.2, ty + def.size + 0.2);
      this.groundCover.hideInRect(tx - 0.1, ty - 0.1, tx + def.size + 0.1, ty + def.size + 0.1);
      this.buildings.set(e.id, b);
      b.bp = -1;
      b.tr = e.tr || 1;
    }
    b.tag = tag;
    b.e = e;
    b.relation = this.vs.relation(e.o);
    const bp = e.bp ?? 1;
    if (bp !== b.bp) {
      b.model.setProgress(bp);
      b.bp = bp;
      patchFowObject(b.model.root);
    }
    const tr = e.tr || 1;
    if (tr !== b.tr) {
      b.model.setTier(tr);
      b.tr = tr;
      b.height = b.model.height;
      patchFowObject(b.model.root);
    }
  }

  animateBuildings(dt) {
    const list = this.collapsing;
    if (!list.length) return;
    let j = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      b.collapseT += dt;
      const u = b.collapseT / COLLAPSE_SECONDS;
      if (u >= 1) {
        b.dispose();
        continue;
      }
      const root = b.model.root;
      root.position.y = b.baseY - u * u * (b.height + 0.6);
      root.rotation.z = Math.sin(b.collapseT * 31) * 0.02 * (1 - u) + u * 0.05;
      root.rotation.x = u * 0.04;
      list[j++] = b;
    }
    list.length = j;
  }

  syncMines() {
    const vs = this.vs;
    const tag = (this.mineTag = (this.mineTag || 0) + 1);
    for (const e of vs.entities.values()) {
      if (e.k !== 'm') continue;
      if (!vs.isEntityVisible(e)) continue;
      let m = this.mines.get(e.id);
      if (!m) {
        const model = buildGoldMineModel();
        const tx = e.tx ?? Math.floor(e.x - 1.5);
        const ty = e.ty ?? Math.floor(e.y - 1.5);
        model.root.position.set(tx + 1.5, footprintHeight(this.map, tx, ty, 3), ty + 1.5);
        model.root.traverse((o) => {
          if (o.isMesh) o.receiveShadow = true;
        });
        patchFowObject(model.root);
        this.entityRoot.add(model.root);
        this.decor.hideInRect(tx - 0.2, ty - 0.2, tx + 3.2, ty + 3.2);
        this.groundCover.hideInRect(tx - 0.1, ty - 0.1, tx + 3.1, ty + 3.1);
        const init = this.mineInitial.get(`${tx},${ty}`) || Math.max(e.amt || 0, (e.amt || 0) > GOLD_MINE_AMOUNT ? EXPANSION_MINE_AMOUNT : GOLD_MINE_AMOUNT);
        m = { id: e.id, e, model, tx, ty, x: tx + 1.5, y: ty + 1.5, size: 3, height: model.height, initial: init, amt: -1, tag };
        this.mines.set(e.id, m);
      }
      m.tag = tag;
      m.e = e;
      const amt = vs.mineGold(e); // as last seen while fogged
      if (amt !== m.amt) {
        m.amt = amt;
        m.model.setAmountFraction((amt || 0) / m.initial);
      }
    }
    for (const m of this.mines.values()) {
      if (m.tag === tag) continue;
      this.mines.delete(m.id);
      m.model.dispose();
    }
  }

  // ------------------------------------------------------------------ overlays

  /** Ground normal under a unit, cached until it moves (see syncUnits). Returns the shared _n. */
  unitNormal(v) {
    if (!v.nOk) {
      this.groundNormal(v.x, v.y, _n);
      v.nx = _n.x;
      v.ny = _n.y;
      v.nz = _n.z;
      v.nOk = true;
      return _n;
    }
    return _n.set(v.nx, v.ny, v.nz);
  }

  groundNormal(x, y, out) {
    const hx = heightAt(this.map, x + 0.35, y) - heightAt(this.map, x - 0.35, y);
    const hy = heightAt(this.map, x, y + 0.35) - heightAt(this.map, x, y - 0.35);
    return out.set(-hx / 0.7, 1, -hy / 0.7).normalize();
  }

  /** Size factor for screen-reading overlays: a bit bigger when zoomed out. */
  zoomK() {
    return clamp((this.camera.distance / CAMERA_DEFAULTS.defaultDistance) ** 0.55, 0.78, 1.45);
  }

  updateOverlays(dt) {
    const vs = this.vs;
    const rings = this.rings;
    const bars = this.bars;
    const zk = this.zoomK();
    const blobs = this.blobs;
    let blobAlpha = this.unitsCastShadows() ? 0.2 : 0.36;
    // blended in linear light (post-processed qualities): same perceived darkening
    if (this.post && this.post.enabled) blobAlpha = 1 - (1 - blobAlpha) ** 2.2;
    const stars = this.stars;
    rings.begin(this.time);
    bars.begin();
    blobs.begin();
    stars.begin();
    this.status.begin(this.time);
    const fires = this.fires;
    fires.begin(this.time);
    const sel = this.selection;
    const hover = this.hoverId;
    const all = this.showAllBars;
    let entities = 0;

    // units
    for (const v of this.units.values()) {
      const fade = v.fade;
      if (!v.visible) {
        // fading out of sight: its blob shadow fades with it, nothing else
        if (fade > 0 && v.onScreen && !v.air) {
          const br = v.radius * 1.35 + 0.16;
          blobs.add(v.x, v.gh + 0.03, v.y, this.unitNormal(v), br, br * 0.92, 0, blobAlpha * fade);
        }
        continue;
      }
      entities++;
      const e = v.e;
      const selected = sel.has(e.id);
      const hovered = hover === e.id;
      if (!v.onScreen) continue;
      // one ground normal per unit and frame (shared _n, consumed at once by each layer)
      const n = v.air ? null : this.unitNormal(v);
      if (n) {
        const br = v.radius * 1.35 + 0.16;
        blobs.add(v.x, v.gh + 0.03, v.y, n, br, br * 0.92, 0, blobAlpha * fade);
      }
      const fx = e.fx;
      if (fx && fx.length) this.statusOverlay(v, fx, fade, zk, n);
      if (selected || hovered) {
        const col = RELATION_COLORS[v.relation] || RELATION_COLORS.neutral;
        const r = v.radius * 1.22 + 0.14;
        // flyers: a level ring at their flying height, right under the body
        // (on the ground it reads as an empty circle far below the unit)
        const ry = v.air ? v.gh + AIR_RING_LIFT : v.gh + 0.05 + r * 0.12 * (1 - n.y) * 4;
        if (selected) rings.add(v.x, ry, v.y, n, r, col, 0.95 * fade, 0.075 * Math.max(1, r * 0.6));
        if (hovered && !selected) rings.add(v.x, ry, v.y, n, r, col, 0.55 * fade, 0.05 * Math.max(1, r * 0.6), 0.6);
      }
      const mhp = e.mhp || 1;
      const damaged = e.hp < mhp;
      if (all || selected || hovered || damaged || e.sh > 0) {
        const w = clamp(0.55 + v.radius * 1.25, 0.72, 2.6) * zk;
        const h = (v.def.class === 'god' || v.def.class === 'titan' ? 0.13 : 0.105) * zk;
        const y = v.gh + v.height + 0.22 * zk;
        const frac = e.hp / mhp;
        bars.add(v.x, y, v.y, w, h, frac, (e.sh || 0) / mhp, healthColor(frac, _c), 0, fade);
      }
    }

    // buildings
    for (const b of this.buildings.values()) {
      entities++;
      const e = b.e;
      const selected = sel.has(e.id);
      const hovered = hover === e.id;
      const bx = b.x;
      const by = b.y;
      _v.set(bx, b.baseY + b.height * 0.5, by).applyMatrix4(_vp);
      if (_v.z > 1 || _v.x < -1.4 || _v.x > 1.4 || _v.y < -1.5 || _v.y > 1.6) continue;
      if (selected || hovered) {
        const col = RELATION_COLORS[b.relation] || RELATION_COLORS.neutral;
        const r = b.size * 0.66;
        if (selected) rings.add(bx, b.baseY + 0.06, by, null, r, col, 0.95, 0.1);
        if (hovered && !selected) rings.add(bx, b.baseY + 0.06, by, null, r, col, 0.55, 0.07, 0.6);
      }
      const mhp = e.mhp || 1;
      const unfinished = (e.bp ?? 1) < 1;
      const own = b.relation === 'own' || b.relation === 'ally';
      if (!unfinished && e.hp < mhp * 0.66 && (own || this.visibleAt(bx, by))) {
        fires.addBuilding(e.id, bx, b.baseY, by, b.size, b.height, e.hp / mhp);
      }
      const w = clamp(b.size * 0.62, 1.3, 2.8) * zk;
      const h = 0.13 * zk;
      let y = b.baseY + b.height + 0.6 + 0.3 * zk;
      if (all || selected || hovered || e.hp < mhp) {
        const frac = e.hp / mhp;
        bars.add(bx, y, by, w, h, frac, 0, healthColor(frac, _c), 0, 1);
        y -= h * 1.25;
      }
      if (unfinished && (own || selected || hovered)) {
        bars.add(bx, y, by, w, h * 0.8, e.bp || 0, 0, PROGRESS_COLOR, 1, 1);
        y -= h * 1.05;
      }
      if (selected && b.relation === 'own' && e.q && e.q.length && !unfinished) {
        bars.add(bx, y, by, w, h * 0.8, e.q[0].p || 0, 0, TRAIN_COLOR, 1, 1);
      }
    }

    // mines
    for (const m of this.mines.values()) {
      entities++;
      const selected = sel.has(m.id);
      const hovered = hover === m.id;
      if (!selected && !hovered) continue;
      const col = RELATION_COLORS.neutral;
      const by = m.model.root.position.y;
      if (selected) rings.add(m.x, by + 0.06, m.y, null, 2.0, col, 0.95, 0.1);
      else rings.add(m.x, by + 0.06, m.y, null, 2.0, col, 0.55, 0.07, 0.6);
    }

    // dying units keep their blob while they fall, fading out
    for (const v of this.dying) {
      if (v.air || !v.onScreen) continue;
      const k = 1 - v.dyingT / DEATH_SECONDS;
      const br = v.radius * 1.35 + 0.16;
      blobs.add(v.x, v.gh + 0.03, v.y, this.unitNormal(v), br, br * 0.92, 0, blobAlpha * k);
    }

    rings.end();
    bars.end();
    blobs.end();
    stars.end();
    this.status.end();
    fires.end();
    this.stats.entities = entities;

    // rally flags of selected own buildings
    const flags = this.flags;
    flags.begin();
    for (const id of sel) {
      const b = this.buildings.get(id);
      if (!b || b.relation !== 'own' || !b.e.rp) continue;
      const [rx, ry] = b.e.rp;
      const col = this.colorOf(b.e.o);
      flags.add(rx, Math.max(this.groundAt(rx, ry), WATER_LEVEL), ry, col, this.time);
      flags.addLine(b.x, b.y, rx, ry, b.size * 0.55, col, this.time);
    }
    flags.end();

    this.markers.update(dt);
    this.texts.update(dt, zk);
    this.placement.update(dt);
  }

  /**
   * Status visuals: stun stars over the head; icons above the health bar for
   * buff / debuff / slow / damage over time; a bubble around shielded units;
   * a frosty ground ring when slowed and a golden one when invulnerable.
   */
  statusOverlay(v, fx, fade = 1, zk = 1, normal = undefined) {
    let n = null;
    let groundY;
    if (v.air) groundY = v.gh + AIR_RING_LIFT + 0.02;
    else {
      n = normal || this.unitNormal(v);
      groundY = v.gh + 0.06 + (v.radius + 0.2) * 0.5 * (1 - n.y);
    }
    for (let i = 0; i < fx.length; i++) {
      switch (fx[i]) {
        case 'stun': {
          const s = clamp(0.16 + v.radius * 0.18, 0.18, 0.42);
          this.stars.addRing(v.x, v.gh + v.height + 0.12, v.y, 0.18 + v.radius * 0.35, s, v.radius > 0.9 ? 4 : 3, this.time + v.id * 0.37);
          break;
        }
        case 'slow':
          this.rings.add(v.x, groundY, v.y, n, v.radius * 0.95 + 0.1, STATUS_SLOW, 0.75 * fade, 0.06, 0.3);
          break;
        case 'invuln':
          this.rings.add(v.x, groundY, v.y, n, v.radius * 1.4 + 0.2, STATUS_INVULN, 0.85 * fade, 0.09, 1);
          this.rings.add(v.x, groundY + 0.02, v.y, n, v.radius * 1.4 + 0.42, STATUS_INVULN, 0.45 * fade, 0.05, 1);
          break;
        case 'shield': {
          const lo = v.air ? AIR_HOVER_HEIGHT : 0;
          const body = Math.max(0.5, v.height - lo);
          const r = Math.max(body * 0.62, v.radius * 1.3 + 0.2);
          this.status.addBubble(v.x, v.gh + lo + body * 0.5, v.y, r, fade, v.id * 0.7);
          break;
        }
        default:
          break;
      }
    }
    this.status.addIcons(v.x, v.gh + v.height + 0.6 * zk, v.y, fx, 0.42 * zk, fade, v.id * 0.37);
  }

  updateShadowCamera() {
    if (!this.sun.castShadow) return;
    const quad = this.camera.getViewQuad(this._quad || (this._quad = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]));
    let cx = 0;
    let cy = 0;
    for (const p of quad) {
      cx += p.x / 4;
      cy += p.y / 4;
    }
    let r = 0;
    for (const p of quad) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      r = Math.max(r, Math.sqrt(dx * dx + dy * dy));
    }
    r = Math.ceil(Math.min(r * 1.05 + 3, 70) / 4) * 4; // quantized: texel size changes only in steps
    const cam = this.sun.shadow.camera;
    if (r !== this.shadowR) {
      this.shadowR = r;
      cam.left = -r;
      cam.right = r;
      cam.top = r;
      cam.bottom = -r;
      cam.updateProjectionMatrix();
    }
    // snap the center to shadow texels so edges do not shimmer while panning
    const texel = (2 * r) / this.sun.shadow.mapSize.x;
    const right = this._sr || (this._sr = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize());
    const up = this._su || (this._su = new THREE.Vector3().crossVectors(SUN_DIR, right).normalize());
    _v.set(cx, this.camera.groundY, cy);
    const a = Math.round(_v.dot(right) / texel) * texel - _v.dot(right);
    const b = Math.round(_v.dot(up) / texel) * texel - _v.dot(up);
    _v.addScaledVector(right, a).addScaledVector(up, b);
    this.sun.target.position.copy(_v);
    this.sun.position.copy(_v).addScaledVector(SUN_DIR, 60);
    this.sun.target.updateMatrixWorld();
  }

  // ------------------------------------------------------------------ render

  /** @param {number} [frameTime] the requestAnimationFrame timestamp (ms), for adaptive resolution */
  render(frameTime) {
    if (this.disposed) return;
    const r = this.renderer;
    if (r.info && typeof r.info.reset === 'function') r.info.reset();
    if (this.post && this.post.enabled) {
      this.adaptResolution(frameTime > 0 ? frameTime : now());
      // materials write linear values into the HDR target, so the fog's display-space
      // factors are raised to a power; well under 2.2 because the tone curve's toe and
      // the grade darken the dimmed (remembered) ground further (1.4 keeps it at about
      // the ~50% brightness of low quality)
      FOW_UNIFORMS.uFowPow.value = 1.4;
      this.post.look.exposure = EXPOSURE;
      this.post.render(this.scene, this.threeCamera, this.overlayScene, now());
      return;
    }
    // low: straight to the canvas, tone mapped in the material shaders; then the overlays, untouched
    FOW_UNIFORMS.uFowPow.value = 1;
    const prevTone = r.toneMapping;
    const prevAuto = r.autoClear;
    r.toneMapping = THREE.NeutralToneMapping;
    r.render(this.scene, this.threeCamera);
    r.toneMapping = THREE.NoToneMapping;
    r.autoClear = false;
    r.render(this.overlayScene, this.threeCamera);
    r.autoClear = prevAuto;
    r.toneMapping = prevTone;
  }

  // ------------------------------------------------------------------ picking

  /** Normalized device coords of a CSS-pixel screen point. */
  toNdc(sx, sy) {
    return { nx: (sx / this.viewW) * 2 - 1, ny: 1 - (sy / this.viewH) * 2 };
  }

  /**
   * Ground point under a screen point (ray marched against the terrain).
   * @returns {{x:number, y:number}|null} null outside the map
   */
  screenToWorld(sx, sy) {
    const { nx, ny } = this.toNdc(sx, sy);
    const ray = this.camera.rayFromNdc(nx, ny, _ray);
    const o = ray.origin;
    const d = ray.dir;
    if (d.y > -1e-4) return null;
    const top = 0.9;
    const bottom = -0.65;
    let t = Math.max(0, (top - o.y) / d.y);
    const tEnd = (bottom - o.y) / d.y;
    const step = 0.2;
    let prevT = t;
    let hitT = tEnd;
    for (; t <= tEnd + step; t += step) {
      const x = o.x + d.x * t;
      const z = o.z + d.z * t;
      const y = o.y + d.y * t;
      if (y <= Math.max(heightAt(this.map, x, z), WATER_LEVEL)) {
        let lo = prevT;
        let hi = t;
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) / 2;
          const mx = o.x + d.x * mid;
          const mz = o.z + d.z * mid;
          if (o.y + d.y * mid <= Math.max(heightAt(this.map, mx, mz), WATER_LEVEL)) hi = mid;
          else lo = mid;
        }
        hitT = hi;
        break;
      }
      prevT = t;
    }
    const x = o.x + d.x * hitT;
    const y = o.z + d.z * hitT;
    if (x < 0 || y < 0 || x > this.width || y > this.height) return null;
    return { x, y };
  }

  /**
   * Project a sim point to the screen.
   * @param {number} x
   * @param {number} y
   * @param {number} [h] height above the ground
   * @returns {{sx:number, sy:number, onScreen:boolean}}
   */
  worldToScreen(x, y, h = 0) {
    _v.set(x, this.groundAt(x, y) + h, y).project(this.threeCamera);
    const sx = (_v.x * 0.5 + 0.5) * this.viewW;
    const sy = (0.5 - _v.y * 0.5) * this.viewH;
    return { sx, sy, onScreen: _v.z < 1 && _v.x >= -1 && _v.x <= 1 && _v.y >= -1 && _v.y <= 1 };
  }

  /**
   * The visible entity under the cursor: units by their projected silhouette
   * (forgiving radius scaled by size and zoom, own units win close ties),
   * otherwise buildings / mines whose box the cursor ray hits.
   * Fogged enemy buildings (last seen) can be picked too.
   * @returns {number|null}
   */
  pickEntity(sx, sy) {
    if (this.disposed) return null;
    this.syncStructures();
    let best = null;
    let bestScore = Infinity;
    for (const v of this.units.values()) {
      if (!v.visible || !v.onScreen) continue;
      const d = distToSegment(sx, sy, v.fx, v.fy, v.hx, v.hy);
      if (d > v.pr) continue;
      let score = d / v.pr;
      if (v.relation === 'own') score -= 0.18;
      else if (v.relation === 'ally') score -= 0.08;
      if (score < bestScore) {
        bestScore = score;
        best = v;
      }
    }
    if (best) return best.id;
    // structures: ray vs boxes
    const { nx, ny } = this.toNdc(sx, sy);
    const ray = this.camera.rayFromNdc(nx, ny, _ray);
    _rayObj.origin.copy(ray.origin);
    _rayObj.direction.copy(ray.dir);
    let bestT = Infinity;
    let bestId = null;
    const test = (id, tx, ty, size, base, height) => {
      _box.min.set(tx + 0.05, base - 0.3, ty + 0.05);
      _box.max.set(tx + size - 0.05, base + height, ty + size - 0.05);
      if (!_rayObj.intersectBox(_box, _hit)) return;
      const t = _hit.distanceTo(_rayObj.origin);
      if (t < bestT) {
        bestT = t;
        bestId = id;
      }
    };
    for (const b of this.buildings.values()) test(b.id, b.tx, b.ty, b.size, b.baseY, Math.max(0.8, b.height * 0.92));
    for (const m of this.mines.values()) test(m.id, m.tx, m.ty, 3, m.model.root.position.y, 1.3);
    return bestId;
  }

  /**
   * Visible units whose projected position lies inside the screen rectangle
   * (corners in any order), own units first.
   * @returns {number[]}
   */
  entitiesInRect(x0, y0, x1, y1) {
    const ax = Math.min(x0, x1);
    const bx = Math.max(x0, x1);
    const ay = Math.min(y0, y1);
    const by = Math.max(y0, y1);
    const own = [];
    const other = [];
    for (const v of this.units.values()) {
      if (!v.visible || !v.onScreen) continue;
      const pad = Math.min(v.pr * 0.45, 10);
      if (v.cx + pad < ax || v.cx - pad > bx || v.cy + pad < ay || v.cy - pad > by) continue;
      (v.relation === 'own' ? own : other).push(v.id);
    }
    return own.concat(other);
  }

  // ------------------------------------------------------------------ teardown

  /** Free everything this renderer created; the scene is left empty. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.sizeTimer) clearTimeout(this.sizeTimer);
    this.sizeTimer = 0;
    for (const off of this.unsub) off();
    this.unsub = [];
    for (const v of this.units.values()) v.dispose();
    this.units.clear();
    for (const v of this.dying) v.dispose();
    this.dying.length = 0;
    for (const b of this.buildings.values()) b.dispose();
    this.buildings.clear();
    for (const b of this.collapsing) b.dispose();
    this.collapsing.length = 0;
    for (const m of this.mines.values()) m.model.dispose();
    this.mines.clear();
    this.placement.dispose();
    this.blobs.dispose();
    this.stars.dispose();
    this.status.dispose();
    this.fires.dispose();
    this.rings.dispose();
    this.bars.dispose();
    this.markers.dispose();
    this.texts.dispose();
    this.flags.dispose();
    this.vfx.dispose();
    this.fadeMats.dispose();
    this.forest.dispose();
    this.decor.dispose();
    this.groundCover.dispose();
    if (this.rockDecor) this.rockDecor.dispose();
    this.terrain.dispose();
    this.fow.dispose();
    if (this.sun.shadow.map) this.sun.shadow.map.dispose();
    this.sun.dispose();
    this.hemi.dispose();
    this.overlaySun.dispose();
    this.overlayHemi.dispose();
    if (this.post) this.post.dispose();
    if (this.env) this.env.dispose();
    this.scene.environment = null;
    this.scene.clear();
    this.overlayScene.clear();
    clearUnitModelCache();
    clearBuildingCaches();
    if (this.ownsWebgl) {
      const dom = this.renderer.domElement;
      if (dom && typeof dom.removeEventListener === 'function') dom.removeEventListener('webglcontextrestored', this.onContextRestored);
      this.renderer.renderLists.dispose();
      this.renderer.dispose();
      // Free the GPU context now (each match gets a fresh canvas and context).
      const gl = this.renderer.getContext();
      const lose = gl && gl.getExtension && gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
    this.events.length = 0;
    this.pendingHits.length = 0;
  }
}

// ---------------------------------------------------------------------------
// entity views
// ---------------------------------------------------------------------------

class UnitView {
  constructor(e, def, model, relation) {
    this.id = e.id;
    this.e = e;
    this.def = def;
    this.model = model;
    this.relation = relation;
    this.radius = def.radius || 0.4;
    this.air = !!def.air;
    this.height = model.height || 1.2;
    const cd = (def.attack && def.attack.cooldown) || 1.5;
    this.swing = Math.min(0.5, cd * 0.62);
    this.atkT = -1;
    this.visible = true;
    this.onScreen = false;
    this.seen = 0;
    this.skipped = 0;
    this.dyingT = 0;
    this.x = e.ix ?? e.x;
    this.y = e.iy ?? e.y;
    this.gh = 0;
    this.speed = 0;
    this.moving = false;
    this.cx = this.cy = this.fx = this.fy = this.hx = this.hy = 0;
    this.pr = 10;
    this.ndcX = this.ndcY = 0;
    // last terrain sample (syncUnits) and the cached ground normal there
    this.gx = this.gy = NaN;
    this.nx = this.nz = 0;
    this.ny = 1;
    this.nOk = false;
    this.fade = 1; // 0 hidden … 1 fully drawn (vision-edge fade)
    this.fader = new UnitFader(model.root);
  }

  resetMotion(e) {
    this.x = e.ix ?? e.x;
    this.y = e.iy ?? e.y;
    this.speed = 0;
    this.moving = false;
    this.atkT = -1;
  }

  /** An attack event: start the swing so the blow lands with the damage. */
  startAttack(time, ranged) {
    this.atkT = time - this.swing * (ranged ? 0.25 : 0.12);
  }

  attackPhase(time) {
    if (this.atkT < 0) return undefined;
    const p = (time - this.atkT) / this.swing;
    if (p >= 1) {
      this.atkT = -1;
      return undefined;
    }
    return p < 0 ? 0 : p;
  }

  setCastShadow(on) {
    this.model.root.traverse((o) => {
      if (o.isMesh && o.name !== 'shadow' && o.name !== 'aura') o.castShadow = on;
    });
    this.fader.syncShadows();
  }

  dispose() {
    this.model.dispose();
  }
}

class BuildingView {
  constructor(e, def, model, relation) {
    this.id = e.id;
    this.e = e;
    this.def = def;
    this.model = model;
    this.relation = relation;
    this.size = def.size;
    this.x = e.x;
    this.y = e.y;
    this.height = model.height || 1.5;
    this.tx = 0;
    this.ty = 0;
    this.tag = 0;
    this.collapseT = 0;
  }

  get baseY() {
    return this._baseY ?? this.model.root.position.y;
  }

  set baseY(v) {
    this._baseY = v;
  }

  dispose() {
    this.model.dispose();
  }
}
