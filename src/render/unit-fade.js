// Fade units in and out where they cross the edge of the local player's vision
// (instead of popping). Unit materials are shared by every unit of a team
// color, so a per-unit opacity cannot live on them: while a unit fades, its
// meshes use variants of their materials quantized to FADE_LEVELS opacity
// steps. Opaque materials get alpha hashing (a stable dither: still opaque,
// depth-correct, no sorting), transparent ones (ghost parts, auras, flyer
// shadows) a scaled opacity. Variants are created lazily, cached per base
// material and level and shared by every fading unit, so fading allocates
// nothing per frame and the extra shader programs are a handful (one per
// morph-target count), compiled at warm-up.
import * as THREE from 'three';

export const FADE_SECONDS = 0.25;
export const FADE_LEVELS = 8;

/** Opacity level (0..FADE_LEVELS) for a fade fraction 0..1; 0 = hidden, FADE_LEVELS = base material. */
export function fadeLevel(f) {
  if (!(f > 0)) return 0;
  if (f >= 1) return FADE_LEVELS;
  return Math.min(FADE_LEVELS - 1, Math.max(1, Math.round(f * FADE_LEVELS)));
}

/** Cache of fade variants: base material → array indexed by level. */
export class FadeMaterials {
  constructor() {
    this.cache = new Map();
    this.created = 0;
  }

  /**
   * The variant of `base` drawn at `level` (1..FADE_LEVELS − 1); FADE_LEVELS
   * (or anything that cannot be faded) returns `base` itself.
   * @param {THREE.Material} base
   * @param {number} level
   * @returns {THREE.Material}
   */
  get(base, level) {
    if (!base || level >= FADE_LEVELS || !base.isMaterial || base.isShaderMaterial) return base;
    let list = this.cache.get(base);
    if (!list) {
      list = new Array(FADE_LEVELS).fill(null);
      this.cache.set(base, list);
    }
    let m = list[level];
    if (!m) {
      m = makeVariant(base, level / FADE_LEVELS);
      list[level] = m;
      this.created++;
    }
    return m;
  }

  dispose() {
    for (const list of this.cache.values()) for (const m of list) if (m) m.dispose();
    this.cache.clear();
  }
}

function makeVariant(base, k) {
  // Material.copy JSON-clones userData (it holds shared uniform objects such as
  // the unit team color), and onBeforeCompile / customProgramCacheKey are own
  // properties copy() does not carry: share all three with the base.
  const m = base.clone();
  m.userData = base.userData;
  if (Object.prototype.hasOwnProperty.call(base, 'onBeforeCompile')) m.onBeforeCompile = base.onBeforeCompile;
  if (Object.prototype.hasOwnProperty.call(base, 'customProgramCacheKey')) m.customProgramCacheKey = base.customProgramCacheKey;
  if (base.transparent) {
    m.opacity = base.opacity * k;
  } else {
    m.alphaHash = true;
    m.opacity = k;
  }
  m.name = `${base.name || 'mat'}|fade${Math.round(k * FADE_LEVELS)}`;
  return m;
}

/**
 * Per-unit fade state over a model root. Collects the root's meshes once and
 * swaps their materials only when the quantized level changes.
 */
export class UnitFader {
  /** @param {THREE.Object3D} root */
  constructor(root) {
    this.root = root;
    this.meshes = null;
    this.base = null;
    this.shadows = null;
    this.level = FADE_LEVELS;
  }

  collect() {
    const meshes = [];
    this.root.traverse((o) => {
      if (o.isMesh && !Array.isArray(o.material)) meshes.push(o);
    });
    this.meshes = meshes;
    this.base = meshes.map((o) => o.material);
    this.shadows = meshes.map((o) => o.castShadow);
  }

  /**
   * Show the model at fade fraction f (0 hidden … 1 normal).
   * @param {number} f
   * @param {FadeMaterials} mats
   * @returns {boolean} whether the root is visible
   */
  apply(f, mats) {
    const level = fadeLevel(f);
    this.root.visible = level > 0;
    if (level === this.level || level === 0) return level > 0;
    if (!this.meshes) this.collect();
    const full = level >= FADE_LEVELS;
    for (let i = 0; i < this.meshes.length; i++) {
      const o = this.meshes[i];
      o.material = full ? this.base[i] : mats.get(this.base[i], level);
      // the shadow depth pass ignores alpha hashing: no shadow while see-through
      o.castShadow = full ? this.shadows[i] : false;
    }
    this.level = level;
    return true;
  }

  /** Remember the meshes' current cast-shadow flags as their full-opacity state. */
  syncShadows() {
    if (!this.meshes) return;
    for (let i = 0; i < this.meshes.length; i++) this.shadows[i] = this.meshes[i].castShadow;
  }
}
