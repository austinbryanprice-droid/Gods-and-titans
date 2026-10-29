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
import { rankName, RANK_COLORS } from '../data/ranks.js';
import { wallConnections } from '../data/walls.js';
import { buildUnitModel, preloadUnitModels, clearUnitModelCache, AIR_HOVER_HEIGHT } from './models/unit-models.js';
import { unitLook } from './models/unit-looks.js';
import { RICH_PANTHEONS } from './models/rich-humanoid.js';
import { buildBuildingModel, buildGoldMineModel, setBuildingTime, clearBuildingCaches, setBuildingDetail, pruneBuildingCaches } from './models/building-models.js';
import { createForest, createDecor, decorOffOutcrops } from './models/props.js';
import { createGroundCover } from './models/ground-cover.js';
import { heightAt, footprintHeight } from './height.js';
import { VFXSystem } from './vfx.js';
import { CameraController, CAMERA_DEFAULTS } from './camera.js';
import { hazeStretch, shadowShare, aoShare, overlayScale, crowdScale, ringLineScale, ringRadiusScale, detailPixels, terrainStride, forestFar, unitFar, NEAR_RANGE } from './zoom-lod.js';
import { FarUnits } from './far-units.js';
import { FogOfWar, patchFowObject, FOW_UNIFORMS } from './fog.js';
import { createTerrain, WATER_LEVEL } from './terrain.js';
import { RingLayer, BlobLayer, StarLayer, BarLayer, MarkerLayer, FloatingTextLayer, RallyFlags, healthColor } from './overlays.js';
import { PlacementLayer } from './placement.js';
import { FireLayer } from './fires.js';
import { SacredSiteLayer } from './sacred-sites.js';
import { FadeMaterials, UnitFader, FADE_SECONDS, FADE_LEVELS } from './unit-fade.js';
import { StatusLayer } from './status-markers.js';
import { RelicLayer } from './relics.js';
import { PostFX, RESIZE_SETTLE_MS, DEFAULT_LOOK } from './post.js';
import { createEnvironment, setCloudShadows, applyAtmosphere, setLampSpots, LAMP_SPOTS, SUN_DIR, WORLD_UNIFORMS } from './shading.js';
import { Atmosphere } from './atmosphere.js';
import { displayColor, relationColor, onTeamPaletteChange } from '../team-colors.js';

/** World units above the ground the shadow box keeps in view (roofs, heads, gods, hills): see updateShadowCamera. */
const SHADOW_LIFT = 8;

// Low draws straight to the canvas; the others go through the post-processing
// pipeline (post.js: MSAA, bloom, + ambient occlusion on high / ultra), which
// also does the antialiasing, so the canvas itself never needs it.
// `minScale` bounds adaptive resolution (scene drawn below the canvas size
// while frames are slow); `vfx` is the VFX tier (it has no 'ultra'); `detail` is
// the building models' detail level (building-core.js Kit: 0 essential forms only).
const QUALITY = {
  low: { pixelRatio: 1, shadows: false, shadowSize: 0, shadowRadius: 1, clouds: 0, minScale: 1, vfx: 'low', detail: 0 },
  medium: { pixelRatio: 1.5, shadows: true, shadowSize: 2048, shadowRadius: 2.2, clouds: 0.3, minScale: 0.6, vfx: 'medium', detail: 1 },
  high: { pixelRatio: 2, shadows: true, shadowSize: 4096, shadowRadius: 2.6, clouds: 0.34, minScale: 0.6, vfx: 'high', detail: 1 },
  ultra: { pixelRatio: 2, shadows: true, shadowSize: 4096, shadowRadius: 3, clouds: 0.34, minScale: 0.7, vfx: 'high', detail: 1 },
};

// The overlays' own fixed light rig (linear, drawn after post): their colors stay exact at any
// time of day. The world's lights follow the time of day (atmosphere.js, updateLook).
const SUN_COLOR = 0xffe4bd;
const SKY_COLOR = 0xbccff2;
const GROUND_COLOR = 0x4c4230;
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

// Selection rings by relation, in the team palette (team-colors.js); filled in by setTeamPalette.
const RELATION_COLORS = { own: new THREE.Color(), ally: new THREE.Color(), enemy: new THREE.Color(), neutral: new THREE.Color() };
function paintRelationColors() {
  for (const k of Object.keys(RELATION_COLORS)) RELATION_COLORS[k].set(relationColor(k));
}
paintRelationColors();
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
const NO_TINT = [1, 1, 1];
// the lit buildings nearest the view, for the lamp pools (updateLamps)
const _lampD = new Float64Array(LAMP_SPOTS);
const _lampB = new Array(LAMP_SPOTS).fill(null);
const _lampSpots = new Float32Array(LAMP_SPOTS * 4);

/** Key of a tile of one owner's wall in GameRenderer.wallTiles (maps stay under 1024 tiles a side, owners under 15). */
function wallKey(owner, tx, ty) {
  return ((ty * 1024 + tx) << 4) | (owner + 1);
}

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
   * @param {string|number} [o.timeOfDay] 'cycle' (the default: follows the match clock), 'golden' | 'day' | 'dusk' | 'night' | 'dawn', or an hour 0..24
   */
  constructor(canvas, { viewState, setup, quality = 'medium', webgl = null, timeOfDay = 'cycle' } = {}) {
    if (!viewState) throw new Error('GameRenderer needs a viewState.');
    this.vs = viewState;
    this.setup = setup || viewState.setup || { players: [] };
    this.map = viewState.map;
    this.width = this.map.width;
    this.height = this.map.height;
    this.quality = QUALITY[quality] ? quality : 'medium';
    const Q = QUALITY[this.quality];
    setBuildingDetail(Q.detail);
    this.canvas = canvas;
    this.disposed = false;
    this.time = 0;
    this.speed = 1; // setSpeed
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
    // The time of day (atmosphere.js) sets every light, the haze and the grade each frame
    // (updateLook); the values here are only what a frame before the first update would show.
    this.atmo = new Atmosphere({ mode: timeOfDay });
    scene.fog = new THREE.Fog(0xaebfcc, 44, 170);
    this.hemi = new THREE.HemisphereLight(SKY_COLOR, GROUND_COLOR, 0.8);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(SUN_COLOR, 3.0);
    // the key light: the sun by day, the moon at night, along SUN_DIR on every quality
    // (with shadows, updateShadowCamera re-centers it each frame)
    this.sun.position.copy(SUN_DIR).multiplyScalar(60);
    this.sun.castShadow = Q.shadows;
    this.sun.shadow.mapSize.set(Q.shadowSize || 1024, Q.shadowSize || 1024);
    this.sun.shadow.radius = Q.shadowRadius;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 140;
    this.shadowR = 0;
    this.shadowHx = 0;
    this.shadowHy = 0;
    this.shadowShare = 1; // the share of the sun's shadow drawn at this zoom (zoom-lod.js)
    scene.add(this.sun);
    scene.add(this.sun.target);
    // image-based lighting from a procedural sky (reflections on metal, stone, lacquer)
    this.env = createEnvironment(this.ownsWebgl ? this.renderer : null, this.atmo.refresh());
    if (this.env) scene.environment = this.env.texture;
    // After a lost context comes back (GPU reset, driver update, mobile tab eviction)
    // three re-uploads textures from their data, but the environment was rendered on
    // the GPU and has none: render it again. (The old one went with the old context;
    // disposing it would delete handles that context owned.) Registered after three's
    // own handler, so the GL state is already rebuilt when this runs.
    this.onContextRestored = () => {
      if (this.disposed || !this.env) return;
      this.env = createEnvironment(this.renderer, this.atmo.state);
      scene.environment = this.env ? this.env.texture : null;
    };
    const dom = this.ownsWebgl ? this.renderer.domElement : null;
    if (dom && typeof dom.addEventListener === 'function') dom.addEventListener('webglcontextrestored', this.onContextRestored);
    setCloudShadows(Q.clouds);
    this.updateLook(true);

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
    this.decor = createDecor({ ...this.map, decor: decorOffOutcrops(this.map, this.map.decor || []) }, this.heightFn, { quality: this.quality });
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
    // the zoom's detail levels (zoom-lod.js): the ground mesh step, plain forest crowns, far unit markers
    this.lod = { stride: 1, forestFar: false, unitFar: false, ppt: Infinity };
    this.lodPin = null; // tools and tests pin a level: { stride?, forestFar?, unitFar? }
    this.farUnits = new FarUnits(this.entityRoot);
    // world-space overlays that belong to the lit, post-processed picture
    this.groundFxRoot = new THREE.Group();
    this.groundFxRoot.name = 'ground-fx';
    scene.add(this.groundFxRoot);
    this.overlayRoot = new THREE.Group();
    this.overlayRoot.name = 'overlays';
    overlayScene.add(this.overlayRoot);

    // sacred sites (DESIGN 5.11): built once from the map; the paving clears the props under it
    this.sacredSites = new SacredSiteLayer(this.entityRoot, this.map.sacred || [], this.heightFn);
    for (const p of this.map.sacred || []) {
      this.decor.hideInRect(p.x - 3, p.y - 3, p.x + 3, p.y + 3);
      this.groundCover.hideInRect(p.x - 2.9, p.y - 2.9, p.x + 2.9, p.y + 2.9);
    }

    this.vfx = new VFXSystem(scene, (x, y) => this.groundAt(x, y), { quality: Q.vfx });
    this.relicLayer = new RelicLayer(scene, (x, y) => heightAt(this.map, x, y));

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
    this.unitDetailMode = 'auto'; // 'auto' (by quality) | 'rich' | 'base': tools and tests pin it
    this.unitDetailBuilt = this.detailKey(); // what the unit views were built from
    this.buildings = new Map(); // id → BuildingView
    this.wallTiles = new Map(); // wallKey(owner, tx, ty) → 1 a wall segment stands there, 2 a tower that joined the wall
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
      onTeamPaletteChange(() => this.setTeamPalette()),
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
    this.forest = createForest({ ...this.map, terrain }, this.heightFn, { quality: this.quality });
    this.scene.add(this.forest.object3d);
    patchFowObject(this.forest.object3d);
    // Undergrowth and shore stones (render only): bushes, ferns and boulders
    // soften the hard line where a forest meets open ground, and half-sunk
    // stones break up the shoreline. A felled tile loses its undergrowth.
    this.undergrowth = this.buildUndergrowth(terrain);
    if (this.undergrowth) {
      this.scene.add(this.undergrowth.object3d);
      patchFowObject(this.undergrowth.object3d);
      for (const [tx, ty] of this.vs.felledAll || []) this.undergrowth.hideInRect(tx, ty, tx + 1, ty + 1);
      const fell = this.forest.fell;
      this.forest.fell = (tx, ty) => {
        const ok = fell(tx, ty);
        if (ok) this.undergrowth.hideInRect(tx, ty, tx + 1, ty + 1);
        return ok;
      };
    }
  }

  /** Render-only undergrowth on forest edges (and some interior gaps) plus stones along shores. */
  buildUndergrowth(T) {
    const W = this.width;
    const H = this.height;
    const { FOREST, WATER, ROCK } = TERRAIN;
    const rich = this.quality !== 'low';
    const decor = [];
    const rnd = (x, y, k) => {
      const h = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453;
      return h - Math.floor(h);
    };
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? FOREST : T[y * W + x]);
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let ty = 0; ty < H; ty++) {
      for (let tx = 0; tx < W; tx++) {
        const t = T[ty * W + tx];
        if (t === FOREST) {
          let ox = 0;
          let oy = 0;
          for (const [dx, dy] of DIRS) {
            const n = at(tx + dx, ty + dy);
            if (n !== FOREST && n !== WATER && n !== ROCK) { ox += dx; oy += dy; }
          }
          const r1 = rnd(tx, ty, 1);
          const r2 = rnd(tx, ty, 2);
          const r3 = rnd(tx, ty, 3);
          if (ox || oy) {
            // edge: a bank of shrubs toward the open side, now and then a boulder or fern
            const len = Math.hypot(ox, oy) || 1;
            const ex = tx + 0.5 + (ox / len) * 0.32;
            const ey = ty + 0.5 + (oy / len) * 0.32;
            const sx = -oy / len;
            const sy = ox / len;
            decor.push({ x: ex + sx * (r1 - 0.5) * 0.7, y: ey + sy * (r1 - 0.5) * 0.7, kind: 'bush', rot: r2 * 6.28, scale: 1.7 + r3 * 0.9 });
            if (rich && r2 > 0.35) {
              const kind = r1 > 0.62 ? 'bush' : r1 > 0.28 ? 'fern' : 'grass';
              decor.push({ x: ex - sx * (r3 - 0.2) * 0.6, y: ey - sy * (r3 - 0.2) * 0.6, kind, rot: r3 * 6.28, scale: kind === 'fern' ? 0.85 + r3 * 0.6 : 1.2 + r1 * 0.8 });
            }
            if (r3 > 0.9) decor.push({ x: ex + sx * 0.25, y: ey + sy * 0.25, kind: 'rock', rot: r1 * 6.28, scale: 1.1 + r2 * 0.9 });
            else if (rich && r3 < 0.12) decor.push({ x: ex, y: ey, kind: 'flowers', rot: r2 * 6.28, scale: 1 });
          } else if (rich && r1 < 0.16) {
            // interior: fill some gaps under the canopy
            const kind = r2 < 0.5 ? 'bush' : r2 < 0.85 ? 'fern' : 'rock';
            decor.push({ x: tx + 0.2 + r2 * 0.6, y: ty + 0.2 + r3 * 0.6, kind, rot: r3 * 6.28, scale: kind === 'fern' ? 0.9 + r1 * 3 : 1.3 + r1 * 2 });
          }
        } else if (t === WATER) {
          // shore stones, half in the water on the land side of an edge tile
          let ox = 0;
          let oy = 0;
          for (const [dx, dy] of DIRS) {
            const n = at(tx + dx, ty + dy);
            if (n !== WATER) { ox += dx; oy += dy; }
          }
          if (!ox && !oy) continue;
          const r1 = rnd(tx, ty, 4);
          if (r1 > (rich ? 0.55 : 0.8)) continue;
          const r2 = rnd(tx, ty, 5);
          const len = Math.hypot(ox, oy) || 1;
          decor.push({ x: tx + 0.5 + (ox / len) * 0.3 + (r2 - 0.5) * 0.4, y: ty + 0.5 + (oy / len) * 0.3 + (r1 - 0.3) * 0.4, kind: 'rock', rot: r2 * 6.28, scale: 0.8 + r1 * 1.2 });
          if (rich && r2 > 0.6) decor.push({ x: tx + 0.5 + (ox / len) * 0.42, y: ty + 0.5 + (oy / len) * 0.42 + (r2 - 0.8), kind: 'grass', rot: r1 * 6.28, scale: 1.2 });
        }
      }
    }
    const kept = decorOffOutcrops(this.map, decor);
    if (!kept.length) return null;
    const d = createDecor({ ...this.map, decor: kept }, this.heightFn, { quality: this.quality });
    d.object3d.name = 'undergrowth';
    return d;
  }

  /** A few boulders on the impassable rock tiles (only where the sandstone outcrop is low, see decorOffOutcrops). */
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
    const kept = decorOffOutcrops(this.map, decor);
    if (!kept.length) return null;
    const d = createDecor({ ...this.map, decor: kept }, this.heightFn);
    d.object3d.name = 'rock-decor';
    return d;
  }

  preload() {
    const types = { rich: [], base: [] }; // by the detail each is drawn at
    const pantheons = new Set();
    for (const p of this.setup.players || []) if (p && p.pantheon) pantheons.add(p.pantheon);
    for (const p of this.vs.players || []) if (p && p.pantheon) pantheons.add(p.pantheon);
    for (const u of Object.values(UNITS)) {
      if (u.pantheon) {
        if (pantheons.has(u.pantheon)) types[this.detailFor(u.pantheon)].push(u);
        continue;
      }
      // the shared mortals, as each pantheon in the match dresses them
      if (!pantheons.size) types[this.detailFor(null)].push(u);
      for (const id of pantheons) types[this.detailFor(id)].push(unitLook(u, id));
    }
    for (const e of this.vs.entities.values()) {
      if (e.k !== 'u' || !UNITS[e.t]) continue;
      const id = this.pantheonOf(e.o);
      types[this.detailFor(id)].push(unitLook(UNITS[e.t], id));
    }
    try {
      preloadUnitModels(types.base, 'base');
      preloadUnitModels(types.rich, 'rich');
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
          const m = buildUnitModel(unitLook(u, p.pantheon), color, { detail: this.detailFor(p.pantheon) });
          add(m);
          if (!fades) continue;
          // the see-through variants enemy units use while fading at the vision edge
          m.root.traverse((o) => {
            if (!o.isMesh || fades.has(o.material)) return;
            fades.add(o.material);
            const mat = this.fadeMats.get(o.material, FADE_LEVELS >> 1);
            const f = o.isSkinnedMesh ? new THREE.SkinnedMesh(o.geometry, mat) : new THREE.Mesh(o.geometry, mat);
            if (f.isSkinnedMesh) f.bind(o.skeleton, o.bindMatrix);
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
    return displayColor((p && p.color) || PLAYER_COLORS[owner % PLAYER_COLORS.length]);
  }

  /**
   * The team palette changed (the `teamColors` setting, team-colors.js): rings and markers take the
   * new colours at once, and every unit and building model is rebuilt in them (units on the next
   * frame, as after a detail change; buildings swap their model where they stand).
   */
  setTeamPalette() {
    paintRelationColors();
    this.markers.setPalette();
    for (const v of this.units.values()) v.dispose();
    this.units.clear();
    for (const v of this.dying) v.dispose();
    this.dying.length = 0;
    this.rebuiltViews = true; // the next frame builds them all, at once and without a fade
    for (const b of this.buildings.values()) {
      const model = this.makeBuildingModel(b.e);
      if (!model) continue;
      const old = b.model;
      model.root.position.copy(old.root.position);
      model.root.traverse((o) => {
        if (o.isMesh) o.receiveShadow = true;
      });
      this.entityRoot.add(model.root);
      old.dispose();
      b.model = model;
      b.height = model.height || 1.5;
      b.bp = -1; // touchBuilding sets the progress and the wall's joins on the new model
      b.tr = b.e.tr || 1;
      b.mask = 0;
    }
    this.preload();
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
    this.forest.setQuality(q);
    this.decor.setQuality(q);
    if (this.undergrowth) this.undergrowth.setQuality(q);
    // crowns and bushes swap to the other puff material, which the fog of war has not patched yet
    patchFowObject(this.forest.object3d);
    patchFowObject(this.decor.object3d);
    if (this.undergrowth) patchFowObject(this.undergrowth.object3d);
    this.groundCover.setQuality(q);
    patchFowObject(this.groundCover.object3d); // meshes built on the first non-low quality
    this.vfx.setQuality(Q.vfx);
    this.refreshBuildingDetail(Q.detail);
    const cast = this.unitsCastShadows();
    for (const v of this.units.values()) v.setCastShadow(cast);
    this.refreshUnitDetail();
  }

  /**
   * Unit model detail of the quality tier: the rich skinned humanoids (rich-humanoid.js) on
   * high and ultra, the low-poly models everywhere else, unless a tool pinned it with setUnitDetail.
   */
  unitDetail() {
    if (this.unitDetailMode !== 'auto') return this.unitDetailMode;
    return this.quality === 'high' || this.quality === 'ultra' ? 'rich' : 'base';
  }

  /** The detail for the units of a player of `pantheonId`: the new characters only where a pantheon has them (RICH_PANTHEONS), all of them when a tool pinned 'rich'. */
  detailFor(pantheonId) {
    const d = this.unitDetail();
    return d === 'rich' && this.unitDetailMode === 'auto' && !RICH_PANTHEONS.has(pantheonId) ? 'base' : d;
  }

  /** What the unit views depend on: the tier's detail, and whether the pantheon gate applies to it. */
  detailKey() {
    const d = this.unitDetail();
    return d === 'rich' && this.unitDetailMode === 'auto' ? 'rich-gated' : d;
  }

  /** Pin the unit model detail ('rich' | 'base') or release it ('auto'). */
  setUnitDetail(mode) {
    this.unitDetailMode = mode === 'rich' || mode === 'base' ? mode : 'auto';
    this.refreshUnitDetail();
  }

  /** Rebuild the unit views when the detail they were built at no longer matches (the next frame recreates them). */
  refreshUnitDetail() {
    const key = this.detailKey();
    if (key === this.unitDetailBuilt) return;
    this.unitDetailBuilt = key;
    for (const v of this.units.values()) v.dispose();
    this.units.clear();
    for (const v of this.dying) v.dispose();
    this.dying.length = 0;
    this.rebuiltViews = true;
    this.preload();
  }

  /** Rebuild the standing buildings' models when the quality changes their detail level (building-core.js Kit). */
  refreshBuildingDetail(detail) {
    if (!setBuildingDetail(detail)) return;
    for (const b of this.buildings.values()) {
      b.model.refresh();
      b.height = b.model.height;
      patchFowObject(b.model.root);
    }
    pruneBuildingCaches();
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

  /**
   * Ghost of a wall line being dragged: one segment per tile (checkWallLine's tiles), joined to the
   * local player's walls and towers that stand.
   * @param {string} typeId wall segment type
   * @param {Array<{tx: number, ty: number, state: string}>} tiles
   */
  showWallLine(typeId, tiles) {
    const me = this.vs.myIndex;
    this.placement.showLine(typeId, tiles, (tx, ty) => this.wallKindAt(me, tx, ty));
  }

  hidePlacement() {
    this.placement.hide();
  }

  /**
   * The enemy Town Centers whose surroundings stay clear of building in a Decade of Peace (game/placement.js
   * peaceAnchors): that ground is tinted under the placement ghost; [] clears it.
   * @param {{ tx: number, ty: number, size: number }[]} anchors
   */
  setNoBuildZones(anchors) {
    this.placement.setZones(anchors);
  }

  /** What one owner has on a tile for the wall's sake: 0 nothing, 1 a wall segment, 2 a tower that joined the wall. */
  wallKindAt(owner, tx, ty) {
    return this.wallTiles.get(wallKey(owner, tx, ty)) || 0;
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
      case 'rankUp':
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
      case 'rankUp': {
        const e = vs.entities.get(ev.id);
        if (!e || !vs.isEntityVisible(e)) break;
        const x = e.ix ?? e.x;
        const y = e.iy ?? e.y;
        vfx.spawnRankUp({ x, y });
        const u = this.units.get(ev.id);
        this.showFloatingText(x, y, rankName(ev.rank), RANK_COLORS[ev.rank] || '#ffe27a', (u ? u.height : 1.4) + 0.7);
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
        // Gold bounty and plunder float low and yellow; sacrificed faith floats higher, in blue.
        if (ev.res === 'f') this.showFloatingText(ev.x, ev.y, `+${ev.amount} faith`, '#9fd8ff', 2.6);
        else this.showFloatingText(ev.x, ev.y, `+${ev.amount}`, '#ffd23a', 1.9);
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
  /** Game speed of a single-player match: animations, effects and the sky run this much faster. */
  setSpeed(m) {
    this.speed = Number.isFinite(m) && m > 0 ? m : 1;
  }

  update(dt) {
    if (this.disposed) return;
    const t0 = now();
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
    const camDt = dt; // the camera keeps real time; the world runs at the game speed
    dt *= this.speed;
    this.time += dt;
    this.frame++;
    const vs = this.vs;

    // camera first so projections (culling, picking) use this frame's view
    const shake = this.vfx.shake;
    if (shake > 0) {
      const t = this.time;
      this.camera.setShake(shake * (Math.sin(t * 41.3) * 0.6 + Math.sin(t * 73.1 + 1.7) * 0.4), shake * (Math.sin(t * 37.7 + 0.6) * 0.6 + Math.sin(t * 67.9 + 2.9) * 0.4));
    } else this.camera.setShake(0, 0);
    this.camera.update(camDt);
    _vp.multiplyMatrices(this.threeCamera.projectionMatrix, this.threeCamera.matrixWorldInverse);
    // the zoom too: the VFX lights go to what is on screen
    this.vfx.setFocus(this.camera.target.x, this.camera.target.y, this.camera.distance);
    this.updateLod();

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
    this.relicLayer.update(vs, this.time, this.units, this.buildings);
    this.flushPendingHits();

    this.fow.update(dt);
    WORLD_UNIFORMS.uTime.value = this.time;
    this.terrain.update(this.time);
    setBuildingTime(this.time);
    this.vfx.update(dt);
    this.sacredSites.update(dt, vs.sites, (o) => this.colorOf(o));
    this.updateOverlays(dt);
    this.updateLook();
    this.updateLamps();
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

  /**
   * The camera distance the zoom curves (zoom-lod.js) go by: the player's zoom. While the camera is free (the intro
   * film) it is never past the original range: those framings are authored, and keep the look the game had for them.
   */
  get zoomDistance() {
    const cam = this.camera;
    return cam.free ? Math.min(cam.distance, NEAR_RANGE) : cam.distance;
  }

  /**
   * The detail levels of the zoom (zoom-lod.js): by pixels on the screen and only past the original zoom range, one
   * step for the whole ground mesh and all the forest, and the unit markers decided per unit in syncUnits. `lodPin`
   * overrides a level.
   */
  updateLod() {
    const lod = this.lod;
    const pin = this.lodPin;
    const ppt = (lod.ppt = detailPixels(this.zoomDistance, this.viewH)); // Infinity inside the old zoom range
    const stride = pin && pin.stride !== undefined ? pin.stride : terrainStride(ppt, lod.stride);
    if (stride !== lod.stride) {
      lod.stride = stride;
      this.terrain.setStride(stride);
    }
    const far = pin && pin.forestFar !== undefined ? pin.forestFar : forestFar(ppt, lod.forestFar);
    if (far !== lod.forestFar) {
      lod.forestFar = far;
      this.forest.setFar(far);
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
    const farUnits = this.farUnits;
    const pin = this.lodPin;
    const lodPpt = this.lod.ppt;
    farUnits.begin();
    let createMs = 0;
    for (const e of vs.entities.values()) {
      if (e.k !== 'u') continue;
      let v = this.units.get(e.id);
      const vis = vs.isEntityVisible(e);
      if (!v) {
        if (!vis) continue;
        // enemies and creeps coming into sight fade in (not at load, never own / allied units)
        const rel = vs.relation(e.o);
        // (nor when every view was rebuilt, for a new detail or team palette: they were on screen already)
        const fadeIn = frame > 1 && !this.rebuiltViews && rel !== 'own' && rel !== 'ally';
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
        // a unit only a few pixels tall is a marker in its team's color: its model is hidden and idle
        const far = pin && pin.unitFar !== undefined ? pin.unitFar : unitFar(v.fy - v.hy, lodPpt, v.far);
        if (far !== v.far) {
          v.far = far;
          v.model.root.visible = !far && v.fade > 0;
        }
        if (far) {
          // (the fader shows the model again for each step of a fade: keep it hidden)
          v.model.root.visible = false;
          // (from the foot to the model's top: a flyer's height counts from the ground, but its foot is up at the hover)
          const markerH = Math.max(0.3, gh + v.height - footY);
          const wide = Math.min(2.2, Math.max(1, v.radius / (0.28 * markerH)));
          farUnits.add(x, footY, y, markerH, wide, v.model.teamColor, v.fade);
          v.skipped = Math.min(0.5, v.skipped + dt);
        } else onScreen.push(v);
      } else {
        v.skipped = Math.min(0.5, v.skipped + dt);
      }
    }
    farUnits.end();
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
    this.rebuiltViews = false;
    // gone from the view state: death animation or removal
    for (const v of this.units.values()) {
      if (v.seen === frame) continue;
      const id = v.id;
      this.units.delete(id);
      if (v.visible && this.deaths.has(id)) {
        v.dyingT = 0;
        // (a marker no more: the death plays on the model)
        if (v.far) {
          v.far = false;
          v.model.root.visible = v.fade > 0;
        }
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
      const pantheon = this.pantheonOf(e.o);
      model = buildUnitModel(unitLook(def, pantheon), this.colorOf(e.o), { detail: this.detailFor(pantheon) });
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
    this.syncWallJoins();
  }

  /**
   * Wall segments run on to the segments of the same owner beside them and to the towers that joined
   * the wall (data/walls.js wallConnections): each takes its model's connection mask from the tiles
   * around it. After the views of a snapshot are in place, so a segment that fell stops being
   * reached for at once.
   */
  syncWallJoins() {
    const tiles = this.wallTiles;
    tiles.clear();
    let walls = 0;
    for (const b of this.buildings.values()) {
      const def = b.def;
      if (!def.wall && !def.joinsWalls) continue;
      const kind = def.wall ? 1 : 2;
      for (let j = 0; j < def.size; j++) for (let i = 0; i < def.size; i++) tiles.set(wallKey(b.e.o, b.tx + i, b.ty + j), kind);
      if (def.wall) walls++;
    }
    if (!walls) return;
    for (const b of this.buildings.values()) {
      if (!b.def.wall) continue;
      const owner = b.e.o;
      const mask = wallConnections(b.tx, b.ty, (x, y) => tiles.get(wallKey(owner, x, y)) || 0);
      if (mask === b.mask) continue;
      b.mask = mask;
      b.model.setConnections(mask);
      patchFowObject(b.model.root);
    }
  }

  /** A building's model in its owner's look, or null when it could not be built. */
  makeBuildingModel(e) {
    try {
      return buildBuildingModel(e.t, PANTHEONS[this.pantheonOf(e.o)] || null, this.colorOf(e.o), e.tr || 1);
    } catch (err) {
      console.error('[render] building model failed', e.t, err);
      return null;
    }
  }

  touchBuilding(e, src, tag) {
    let b = this.buildings.get(e.id);
    const def = BUILDINGS[e.t];
    if (!def) return;
    if (b && b.def !== def) {
      // the same building as another type: a wooden wall upgraded to stone
      const model = this.makeBuildingModel(e);
      if (model) {
        const old = b.model;
        model.root.position.copy(old.root.position);
        model.root.traverse((o) => {
          if (o.isMesh) o.receiveShadow = true;
        });
        this.entityRoot.add(model.root);
        old.dispose();
        b.model = model;
        b.def = def;
        b.height = model.height || 1.5;
        b.bp = -1;
        b.tr = e.tr || 1;
        b.mask = 0;
      }
    }
    if (!b) {
      const model = this.makeBuildingModel(e);
      if (!model) return;
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
      if (this.terrain.paintYard && !def.wall) this.terrain.paintYard(tx, ty, def.size); // a fence does not wear the grass bare
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

  /** Size factor for screen-reading overlays: a bit bigger when zoomed out (zoom-lod.js). */
  zoomK() {
    return overlayScale(this.zoomDistance, CAMERA_DEFAULTS.defaultDistance);
  }

  updateOverlays(dt) {
    const vs = this.vs;
    const rings = this.rings;
    const bars = this.bars;
    const zk = this.zoomK();
    // what is drawn over a crowd (a unit's bar width, rank pips) grows with the zoom more slowly than the rest
    const zd = this.zoomDistance;
    const ck = crowdScale(zd, CAMERA_DEFAULTS.defaultDistance);
    // selection and hover rings: thicker, and for units wider, when the view is far (zoom-lod.js)
    const ringLine = ringLineScale(zd);
    const ringRadius = ringRadiusScale(zd);
    const blobs = this.blobs;
    // (a unit's own shadow is the lighter blob's partner: when the sun's shadow fades out with the zoom the blob takes over)
    let blobAlpha = this.unitsCastShadows() ? 0.36 - 0.16 * this.shadowShare : 0.36;
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
      // a ranked soldier's pips sit just over its health bar (not on a far marker: a few pixels tall, its
      // pips would be bigger than it is)
      if (e.rk > 0 && !v.far) this.status.addRank(v.x, v.gh + v.height + 0.48 * zk, v.y, e.rk, 0.7 * ck, fade);
      if (selected || hovered) {
        const col = RELATION_COLORS[v.relation] || RELATION_COLORS.neutral;
        const r0 = v.radius * 1.22 + 0.14;
        const r = r0 * ringRadius;
        // flyers: a level ring at their flying height, right under the body
        // (on the ground it reads as an empty circle far below the unit)
        const ry = v.air ? v.gh + AIR_RING_LIFT : v.gh + 0.05 + r * 0.12 * (1 - n.y) * 4;
        const line = Math.max(1, r0 * 0.6) * ringLine;
        if (selected) rings.add(v.x, ry, v.y, n, r, col, 0.95 * fade, 0.075 * line);
        if (hovered && !selected) rings.add(v.x, ry, v.y, n, r, col, 0.55 * fade, 0.05 * line, 0.6);
      }
      const mhp = e.mhp || 1;
      const damaged = e.hp < mhp;
      // (a far marker's bar is for what it says, hurt or shielded: the ring shows the selection, and a bar on
      // every unit of a selected army would hide it)
      if (all || (selected && !v.far) || hovered || damaged || e.sh > 0) {
        const w = clamp(0.55 + v.radius * 1.25, 0.72, 2.6) * ck;
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
      // a wall is a run of one-tile segments, up to hundreds on screen: slim rings and bars, and a bar
      // only where it says something (hurt, hovered, upgrading), never fires or a bar per site
      const wall = b.def.wall === true;
      if (selected || hovered) {
        const col = RELATION_COLORS[b.relation] || RELATION_COLORS.neutral;
        const r = wall ? 0.6 : b.size * 0.66;
        if (selected) rings.add(bx, b.baseY + 0.06, by, null, r, col, 0.95, (wall ? 0.07 : 0.1) * ringLine);
        if (hovered && !selected) rings.add(bx, b.baseY + 0.06, by, null, r, col, 0.55, (wall ? 0.05 : 0.07) * ringLine, 0.6);
      }
      const mhp = e.mhp || 1;
      const unfinished = (e.bp ?? 1) < 1;
      const own = b.relation === 'own' || b.relation === 'ally';
      if (!wall && !unfinished && e.hp < mhp * 0.66 && (own || this.visibleAt(bx, by))) {
        fires.addBuilding(e.id, bx, b.baseY, by, b.size, b.height, e.hp / mhp);
      }
      const w = wall ? 0.9 * zk : clamp(b.size * 0.62, 1.3, 2.8) * zk;
      const h = (wall ? 0.1 : 0.13) * zk;
      let y = b.baseY + b.height + (wall ? 0.2 : 0.6) + 0.3 * zk;
      if (all || hovered || e.hp < mhp || (selected && !wall)) {
        const frac = e.hp / mhp;
        bars.add(bx, y, by, w, h, frac, 0, healthColor(frac, _c), 0, 1);
        y -= h * 1.25;
      }
      if (unfinished && (wall ? hovered : own || selected || hovered)) {
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
      if (selected) rings.add(m.x, by + 0.06, m.y, null, 2.0, col, 0.95, 0.1 * ringLine);
      else rings.add(m.x, by + 0.06, m.y, null, 2.0, col, 0.55, 0.07 * ringLine, 0.6);
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
    // (a ranked soldier's pips take the slot under the row)
    // (a far marker keeps the warnings, debuff / slow / damage over time, but not the buff that half an army wears)
    this.status.addIcons(v.x, v.gh + v.height + (v.e.rk > 0 && !v.far ? 0.88 : 0.6) * zk, v.y, fx, 0.42 * zk, fade, v.id * 0.37, v.far ? 'buff' : null);
  }

  updateShadowCamera() {
    if (!this.sun.castShadow) return;
    // zoomed far out the shadows fade and then stop being drawn (their map would cover less than the view, and
    // they would be a pixel wide); a map that is not redrawn is never read at intensity 0
    const share = shadowShare(this.zoomDistance);
    this.sun.shadow.intensity = share;
    this.shadowShare = share;
    const live = share > 0.002;
    if (this.renderer.shadowMap.autoUpdate !== live) {
      this.renderer.shadowMap.autoUpdate = live;
      if (live) this.renderer.shadowMap.needsUpdate = true;
    }
    if (!live) {
      // nothing to fit, but the light still turns with the day (the map is redrawn, and fitted, on the way back in)
      this.sun.position.copy(this.sun.target.position).addScaledVector(SUN_DIR, this.shadowR + 40);
      return;
    }
    const quad = this.camera.getViewQuad(this._quad || (this._quad = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]));
    // The shadow box is fitted to the view in the light's own frame. Everything whose shadow lands on a
    // point of the view sits on that point's ray to the sun, at the same light-space x and y, so the box
    // only has to cover the view's ground seen from the sun. A low sun lays the ground out along its rays:
    // seen from a 14° sun a view 40 tiles deep is 10 wide, and a square box as wide as the view would
    // reach 130 tiles up-sun, drawing every forest chunk along that strip into the map (twice the
    // triangles of the visible scene) and spreading its texels over all of it.
    const right = this._sr || (this._sr = new THREE.Vector3());
    const up = this._su || (this._su = new THREE.Vector3());
    right.set(0, 1, 0).cross(SUN_DIR).normalize(); // the key light moves through the day
    up.crossVectors(SUN_DIR, right).normalize();
    const gy = this.camera.groundY;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, d0 = Infinity, d1 = -Infinity;
    for (const p of quad) {
      _v.set(p.x, gy, p.y);
      const lx = _v.dot(right);
      const ly = _v.dot(up);
      const ld = _v.dot(SUN_DIR);
      x0 = Math.min(x0, lx);
      x1 = Math.max(x1, lx);
      y0 = Math.min(y0, ly);
      y1 = Math.max(y1, ly);
      d0 = Math.min(d0, ld);
      d1 = Math.max(d1, ld);
    }
    // margins: hills and what stands on the ground (a soldier's head, a roof, a god) are seen above it
    const lift = SHADOW_LIFT * Math.max(0, up.y);
    // half sizes quantized, so the texel size changes only in steps (no crawl while zooming)
    const hx = Math.ceil(Math.min((x1 - x0) / 2 + 3, 70) / 2) * 2;
    const hy = Math.ceil(Math.min((y1 - y0) / 2 + lift / 2 + 3, 70) / 2) * 2;
    const r = Math.max(hx, hy);
    const cam = this.sun.shadow.camera;
    // depth: the light stands back far enough for casters well up-sun of the view (a low sun's rays climb
    // slowly: 8 units of height is 33 tiles of ray at 14°) and sees down to the view's farthest ground
    const back = (d1 - d0) / 2 + 50;
    const far = Math.ceil((back + (d1 - d0) / 2 + 20) / 8) * 8;
    if (hx !== this.shadowHx || hy !== this.shadowHy || far !== cam.far) {
      this.shadowR = r;
      this.shadowHx = hx;
      this.shadowHy = hy;
      cam.left = -hx;
      cam.right = hx;
      cam.top = hy;
      cam.bottom = -hy;
      cam.near = 1;
      cam.far = far;
      cam.updateProjectionMatrix();
      this.sun.shadow.bias = -0.083 / (cam.far - cam.near); // the same ~0.08 world units whatever the depth range
    }
    // grazing light needs a bigger push off the surface to keep the terrain from striping itself
    this.sun.shadow.normalBias = 0.03 + 0.06 * clamp((0.65 - SUN_DIR.y) / 0.4, 0, 1);
    // the box's center in the light's frame (lifted a little: the margin is all on the up-sun side, where the
    // view's standing things reach), snapped to shadow texels so edges do not shimmer while panning
    const tx = (2 * hx) / this.sun.shadow.mapSize.x;
    const ty = (2 * hy) / this.sun.shadow.mapSize.y;
    const lx = Math.round((x0 + x1) / 2 / tx) * tx;
    const ly = Math.round(((y0 + y1) / 2 + lift / 2) / ty) * ty;
    const ld = (d0 + d1) / 2;
    _v.set(0, 0, 0).addScaledVector(right, lx).addScaledVector(up, ly).addScaledVector(SUN_DIR, ld);
    this.sun.target.position.copy(_v);
    this.sun.position.copy(_v).addScaledVector(SUN_DIR, back);
    this.sun.target.updateMatrixWorld();
  }

  // ------------------------------------------------------------------ time of day

  /**
   * Follow the match clock ('cycle') or hold one time of day: 'golden', 'day', 'dusk',
   * 'night', 'dawn', or an hour 0..24. Takes effect at once; unknown values are ignored.
   * @param {string|number} mode
   * @returns {boolean} whether the look changed
   */
  setTimeOfDay(mode) {
    const changed = this.atmo.setMode(mode);
    this.updateLook(true);
    return changed;
  }

  /** The time of day now showing: { mode: 'cycle' | 'golden' | … | 'hour', hour: 0..24 }. */
  get timeOfDay() {
    return { mode: this.atmo.mode, hour: this.atmo.hour };
  }

  /**
   * Resolve the time of day for this frame (the cycle follows the sim clock the view
   * state interpolates, so every client agrees) and push it into the lights, the haze,
   * the sky environment, the post-processing look and the shared shader uniforms.
   */
  updateLook(force = false) {
    const vs = this.vs;
    const s = this.atmo.update(Number.isFinite(vs.renderTime) ? vs.renderTime : vs.time);
    applyAtmosphere(s);
    // low draws without the post pipeline, so the grade (warm highlights, cool shadows) goes into the lights
    const graded = !!(this.post && this.post.enabled);
    const hi = graded ? NO_TINT : s.highlightTint;
    const lo = graded ? NO_TINT : s.shadowTint;
    this.sun.color.setRGB(s.keyHue.r * hi[0], s.keyHue.g * hi[1], s.keyHue.b * hi[2]);
    this.sun.intensity = s.keyIntensity;
    this.hemi.color.setRGB(s.hemiSky.r * lo[0], s.hemiSky.g * lo[1], s.hemiSky.b * lo[2]);
    this.hemi.groundColor.setRGB(s.hemiGround.r * lo[0], s.hemiGround.g * lo[1], s.hemiGround.b * lo[2]);
    this.hemi.intensity = s.hemiIntensity;
    // the haze is measured from the point the camera looks at, so zooming out does not fog the middle of the view
    const fog = this.scene.fog;
    const lookDist = this.camera ? this.camera.distance : CAMERA_DEFAULTS.defaultDistance; // the first call comes before the camera exists
    const zoomDist = this.camera ? this.zoomDistance : lookDist;
    const stretch = hazeStretch(zoomDist); // a wide view keeps its far edge out of the haze
    fog.color.copy(s.haze);
    fog.near = Math.max(0.5, lookDist + s.hazeNear * stretch);
    fog.far = Math.max(fog.near + 1, lookDist + s.hazeFar * stretch);
    this.scene.background.copy(s.background);
    this.scene.environmentIntensity = s.envIntensity;
    this.renderer.toneMappingExposure = s.exposure; // the low path's Neutral tone mapping
    const look = this.post && this.post.look;
    if (look) {
      look.exposure = s.exposure;
      look.bloomStrength = s.bloom;
      look.bloomThreshold = s.bloomThreshold;
      look.bloomKnee = s.bloomKnee;
      look.bloomRadius = s.bloomRadius;
      look.contrast = s.contrast;
      look.saturation = s.saturation;
      look.shadowTint = s.shadowTint;
      look.highlightTint = s.highlightTint;
      look.vignette = s.vignette;
      look.glow = s.glow;
      look.aoStrength = DEFAULT_LOOK.aoStrength * aoShare(zoomDist); // gone when the view is wide (nothing to occlude at a pixel)
      look.glowColor[0] = s.skyHorizon.r;
      look.glowColor[1] = s.skyHorizon.g;
      look.glowColor[2] = s.skyHorizon.b;
    }
    if (this.env && this.env.update(s, force)) this.scene.environment = this.env.texture;
  }

  /**
   * After dusk the finished buildings pool warm light round their doorways: the LAMP_SPOTS
   * nearest to the middle of the view light the ground and whatever stands near them (the
   * world shaders' lampLight, scaled by the time of day's lamp level).
   */
  updateLamps() {
    if (WORLD_UNIFORMS.uLamp.value < 0.02) {
      if (this.lampCount) {
        this.lampCount = 0;
        setLampSpots(_lampSpots, 0);
      }
      return;
    }
    const cx = this.camera.target.x;
    const cy = this.camera.target.y;
    let n = 0;
    for (const b of this.buildings.values()) {
      if (b.def.wall || (b.e.bp ?? 1) < 1) continue;
      const dx = b.x - cx;
      const dy = b.y - cy;
      const d2 = dx * dx + dy * dy;
      if (n === LAMP_SPOTS && d2 >= _lampD[n - 1]) continue;
      let i = n < LAMP_SPOTS ? n++ : n - 1; // the nearest few, kept sorted
      while (i > 0 && _lampD[i - 1] > d2) {
        _lampD[i] = _lampD[i - 1];
        _lampB[i] = _lampB[i - 1];
        i--;
      }
      _lampD[i] = d2;
      _lampB[i] = b;
    }
    for (let i = 0; i < n; i++) {
      const b = _lampB[i];
      _lampSpots[i * 4] = b.tx + b.size / 2;
      _lampSpots[i * 4 + 1] = b.model.root.position.y + 1.1;
      _lampSpots[i * 4 + 2] = b.ty + b.size + 0.1; // in front of the door (the south face)
      _lampSpots[i * 4 + 3] = 2 + b.size * 0.7;
    }
    setLampSpots(_lampSpots, n);
    this.lampCount = n;
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
    const top = Math.max(0.9, this.terrain.field.hMax + 0.05); // above the highest outcrop
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
    this.farUnits.dispose();
    this.relicLayer.dispose();
    this.sacredSites.dispose();
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
    if (this.undergrowth) this.undergrowth.dispose();
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
    this.far = false; // drawn as a far marker (far-units.js), the model hidden and not animated
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
    this.mask = 0; // wall segments: the connection mask the model shows (syncWallJoins)
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
