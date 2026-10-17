// Fog of war for the renderer (DESIGN 8): one texel per tile in a
// linear-filtered DataTexture, rebuilt from the ViewState's visible / explored
// grids on each snapshot (softened with a small blur) and eased toward its new
// values over ~0.3 s every frame. Materials sample it in world space through
// a fragment-shader patch (patchFowMaterial), so shared / cached materials of
// terrain, water, trees, decor, mines and buildings all darken per pixel:
// visible = full color, explored = dimmed, unexplored = near black, and
// everything fades to black past the map edge.
import * as THREE from 'three';
import { CLOUD_TEXTURE, WORLD_UNIFORMS } from './shading.js';

export const FOW_VISIBLE = 255;
export const FOW_EXPLORED = 128; // ≈ 50% brightness (display space)
export const FOW_UNEXPLORED = 14; // near black
export const FOW_FADE_SECONDS = 0.3;

/**
 * Uniforms shared by every patched material. Module-level so materials that
 * outlive a renderer (the model modules cache them) keep working in the next one.
 */
const CLEAR_TEX = new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
CLEAR_TEX.needsUpdate = true;

export const FOW_UNIFORMS = {
  uFowTex: { value: CLEAR_TEX }, // no fog bound: everything fully lit
  uFowSize: { value: new THREE.Vector4(1e6, 1e6, 1e-6, 1e-6) }, // width, height, 1/width, 1/height
  // 1 when materials write display (sRGB) values, 2.2 when they write linear
  // values into the post-processing target (the factors are tuned for display space)
  uFowPow: { value: 1 },
  uFowNoise: { value: CLOUD_TEXTURE },
  uFowTime: WORLD_UNIFORMS.uTime,
};

export const FOW_PARS_VERTEX = 'varying vec2 vFowXZ;';
/** Needs `transformed` (any built-in vertex shader after begin_vertex). */
export const FOW_VERTEX = `
{
  vec4 fowP = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    fowP = batchingMatrix * fowP;
  #endif
  #ifdef USE_INSTANCING
    fowP = instanceMatrix * fowP;
  #endif
  vFowXZ = ( modelMatrix * fowP ).xz;
}`;
export const FOW_PARS_FRAGMENT = `
uniform sampler2D uFowTex;
uniform vec4 uFowSize;
uniform float uFowPow;
uniform sampler2D uFowNoise;
uniform float uFowTime;
varying vec2 vFowXZ;
float fowFactor( vec2 p ) {
  float f = texture2D( uFowTex, p * uFowSize.zw ).r;
  vec2 d = min( p, uFowSize.xy - p );
  return f * smoothstep( -0.4, 1.6, min( d.x, d.y ) );
}
// Remembered ground loses its color toward a cool grey; unexplored land sits
// under a slowly drifting dark mist instead of flat black.
vec3 fowApply( vec3 c, vec2 p ) {
  float f = fowFactor( p );
  if ( f >= 0.995 ) return c;
  float fog = 1.0 - smoothstep( 0.6, 0.97, f );
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  c = mix( c, vec3( l ) * vec3( 0.86, 0.93, 1.06 ), fog * 0.5 );
  c *= pow( f, uFowPow );
  float shroud = 1.0 - smoothstep( 0.04, 0.4, f );
  if ( shroud > 0.0 ) {
    vec2 q = p * 0.045 + vec2( uFowTime * 0.006, uFowTime * 0.0035 );
    float m = texture2D( uFowNoise, q ).g * 0.6 + texture2D( uFowNoise, q * 2.7 + 0.3 ).r * 0.4;
    vec3 mist = vec3( 0.075, 0.085, 0.1 ) * ( 0.35 + 0.9 * smoothstep( 0.3, 0.8, m ) );
    vec2 d = min( p, uFowSize.xy - p );
    mist *= smoothstep( -0.4, 1.6, min( d.x, d.y ) );
    c += pow( mist, vec3( uFowPow ) ) * shroud;
  }
  return c;
}`;
export const FOW_FRAGMENT = 'gl_FragColor.rgb = fowApply( gl_FragColor.rgb, vFowXZ );';

/**
 * Inject the fog-of-war sample into a built-in material (Lambert, Basic, …).
 * Idempotent; keeps any existing onBeforeCompile and extends the program cache key.
 * ShaderMaterials with a plain `void main() {` and `gl_FragColor` output are
 * patched too (e.g. the titan gate vortex).
 * @param {THREE.Material} mat
 * @returns {boolean} true if the material was patched now
 */
export function patchFowMaterial(mat) {
  if (!mat || !mat.isMaterial || mat.userData.__fow) return false;
  mat.userData.__fow = true;
  const prev = mat.onBeforeCompile;
  const prevKey = typeof mat.customProgramCacheKey === 'function' ? String(mat.customProgramCacheKey()) : '';
  const custom = !!mat.isShaderMaterial;
  mat.onBeforeCompile = function fowCompile(shader, renderer) {
    if (typeof prev === 'function') prev.call(this, shader, renderer);
    shader.uniforms.uFowTex = FOW_UNIFORMS.uFowTex;
    shader.uniforms.uFowSize = FOW_UNIFORMS.uFowSize;
    shader.uniforms.uFowPow = FOW_UNIFORMS.uFowPow;
    shader.uniforms.uFowNoise = FOW_UNIFORMS.uFowNoise;
    shader.uniforms.uFowTime = FOW_UNIFORMS.uFowTime;
    if (custom) injectCustom(shader);
    else injectBuiltin(shader);
  };
  mat.customProgramCacheKey = () => `${prevKey}|fow2`;
  mat.needsUpdate = true;
  return true;
}

function injectBuiltin(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${FOW_PARS_VERTEX}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${FOW_VERTEX}`);
  let fs = shader.fragmentShader.replace('#include <common>', `#include <common>\n${FOW_PARS_FRAGMENT}`);
  if (fs.includes('#include <fog_fragment>')) fs = fs.replace('#include <fog_fragment>', `#include <fog_fragment>\n${FOW_FRAGMENT}`);
  else fs = appendToMain(fs, FOW_FRAGMENT);
  shader.fragmentShader = fs;
}

function injectCustom(shader) {
  shader.vertexShader = `${FOW_PARS_VERTEX}\n${shader.vertexShader}`.replace(
    /void\s+main\s*\(\s*(void)?\s*\)\s*\{/,
    (m) => `${m}\n  vFowXZ = ( modelMatrix * vec4( position, 1.0 ) ).xz;`,
  );
  shader.fragmentShader = appendToMain(`${FOW_PARS_FRAGMENT}\n${shader.fragmentShader}`, 'gl_FragColor *= pow( fowFactor( vFowXZ ), uFowPow );');
}

function appendToMain(src, code) {
  const i = src.lastIndexOf('}');
  return i < 0 ? src : `${src.slice(0, i)}\n${code}\n${src.slice(i)}`;
}

/** Patch every material under an object (meshes, instanced meshes). */
export function patchFowObject(root) {
  root.traverse((o) => {
    if (!o.material) return;
    if (Array.isArray(o.material)) for (const m of o.material) patchFowMaterial(m);
    else patchFowMaterial(o.material);
  });
}

/** Fog-of-war texture driven by a ViewState. */
export class FogOfWar {
  /**
   * @param {number} width map width in tiles
   * @param {number} height
   */
  constructor(width, height) {
    this.width = width;
    this.height = height;
    const n = width * height;
    this.data = new Uint8Array(n);
    this.cur = new Float32Array(n);
    this.goal = new Uint8Array(n);
    this.raw = new Uint8Array(n);
    this.tmp = new Uint16Array(n);
    this.settled = false;
    this.first = true;
    this.texture = new THREE.DataTexture(this.data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.needsUpdate = true;
    this.texture.name = 'fog-of-war';
    this.bind();
  }

  /** Point the shared uniforms at this fog (done on construction). */
  bind() {
    FOW_UNIFORMS.uFowTex.value = this.texture;
    FOW_UNIFORMS.uFowSize.value.set(this.width, this.height, 1 / this.width, 1 / this.height);
  }

  /**
   * New goal from visibility grids (1 = visible / explored).
   * @param {Uint8Array} visible
   * @param {Uint8Array} explored
   * @param {boolean} [revealAll]
   */
  setGoal(visible, explored, revealAll = false) {
    const W = this.width;
    const H = this.height;
    const raw = this.raw;
    const n = W * H;
    if (revealAll) raw.fill(FOW_VISIBLE);
    else for (let i = 0; i < n; i++) raw[i] = visible[i] ? FOW_VISIBLE : explored[i] ? FOW_EXPLORED : FOW_UNEXPLORED;
    // separable [1 2 1] blur: softer, rounder vision edges
    const tmp = this.tmp;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const c = raw[row + x];
        const l = x > 0 ? raw[row + x - 1] : c;
        const r = x < W - 1 ? raw[row + x + 1] : c;
        tmp[row + x] = l + 2 * c + r;
      }
    }
    const goal = this.goal;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      const up = y > 0 ? row - W : row;
      const dn = y < H - 1 ? row + W : row;
      for (let x = 0; x < W; x++) {
        let v = (tmp[up + x] + 2 * tmp[row + x] + tmp[dn + x]) >> 4;
        // never darken a tile that is visible itself (units at the edge stay lit)
        if (raw[row + x] === FOW_VISIBLE && v < 200) v = 200;
        goal[row + x] = v;
      }
    }
    if (this.first) {
      this.first = false;
      for (let i = 0; i < n; i++) {
        this.cur[i] = goal[i];
        this.data[i] = goal[i];
      }
      this.texture.needsUpdate = true;
      this.settled = true;
      return;
    }
    this.settled = false;
  }

  /** Ease toward the goal; uploads the texture only when something changed. */
  update(dt) {
    if (this.settled) return;
    const step = (FOW_VISIBLE * Math.max(0, dt)) / FOW_FADE_SECONDS;
    if (step <= 0) return;
    const cur = this.cur;
    const goal = this.goal;
    const data = this.data;
    const n = cur.length;
    let moving = false;
    for (let i = 0; i < n; i++) {
      const g = goal[i];
      const c = cur[i];
      if (c === g) continue;
      let v;
      if (c < g) v = c + step > g ? g : c + step;
      else v = c - step < g ? g : c - step;
      cur[i] = v;
      data[i] = v + 0.5;
      moving = true;
    }
    if (moving) this.texture.needsUpdate = true;
    else this.settled = true;
  }

  /** Brightness 0..1 at a sim point (CPU mirror of the shader, nearest tile). */
  sample(x, y) {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return 0;
    return this.cur[ty * this.width + tx] / 255;
  }

  dispose() {
    if (FOW_UNIFORMS.uFowTex.value === this.texture) {
      FOW_UNIFORMS.uFowTex.value = CLEAR_TEX;
      FOW_UNIFORMS.uFowSize.value.set(1e6, 1e6, 1e-6, 1e-6);
    }
    this.texture.dispose();
  }
}
