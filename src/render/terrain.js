// Terrain for the game renderer (DESIGN 8): one smooth-shaded mesh built from
// mapData.heights (8 triangles per tile) and textured per pixel from a
// procedural texture array (terrain-textures.js: lush and dry grass, dirt,
// sand, rock, forest floor, lake bed). A one-texel-per-tile map of ground
// types is looked up through a noise-warped grid, so borders meander instead
// of following tile edges, and neighboring types blend by their texture
// heights (grass tufts poke through dirt, sand fills between pebbles). On
// top: macro color variation and a repetition breaker against visible tiling,
// rock on steep slopes, a darker, glossier wet band along the shore, per-pixel
// bump lighting from the texture heights (screen-space derivatives, no
// tangents), animated caustics on the lake bed; the water (terrain-water.js)
// and a misty dark border beyond the map edge. Every material samples the fog
// of war; the lit ones get the drifting cloud shadows (shading.js).
//
//   const t = createTerrain(mapData, { quality: 'medium' });
//   scene.add(t.group); t.update(timeSec); t.setQuality('high'); t.dispose();
import * as THREE from 'three';
import { TERRAIN } from '../config.js';
import { heightAt } from './height.js';
import { patchFowMaterial, FOW_UNIFORMS } from './fog.js';
import { patchWorldMaterial } from './shading.js';
import { LAYER, LAYER_COUNT, createTerrainTextures } from './terrain-textures.js';
import { WATER_LEVEL, buildWater, setWaterQuality } from './terrain-water.js';

export { WATER_LEVEL, buildWater };

function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x, y, s) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, s);
  const b = hash2(x0 + 1, y0, s);
  const c = hash2(x0, y0 + 1, s);
  const d = hash2(x0 + 1, y0 + 1, s);
  return a + (b - a) * sx + (c - a + (d - c - b + a) * sx) * sy;
}

/**
 * Per-layer shading parameters: x = texture repeats per tile, y = height-blend
 * bias (how readily the type wins at a border), z = bump depth (world units
 * for the full texture height range), w = roughness.
 */
const LAYER_PARAMS = [];
LAYER_PARAMS[LAYER.GRASS] = [1 / 3, 0.04, 0.024, 0.93];
LAYER_PARAMS[LAYER.DRY] = [1 / 3, 0.02, 0.024, 0.95];
LAYER_PARAMS[LAYER.DIRT] = [1 / 3.5, 0, 0.04, 0.9];
LAYER_PARAMS[LAYER.SAND] = [1 / 4, -0.02, 0.03, 0.86];
LAYER_PARAMS[LAYER.ROCK] = [1 / 4.5, 0.1, 0.07, 0.78];
LAYER_PARAMS[LAYER.FOREST] = [1 / 3, 0.03, 0.04, 0.96];
LAYER_PARAMS[LAYER.BED] = [1 / 3.5, 0, 0.04, 0.7];

/** Shader detail per quality tier (GLSL defines). */
const QUALITY_DEFINES = {
  low: {},
  medium: { TERRAIN_BUMP: '', TERRAIN_CAUSTICS: '' },
  high: { TERRAIN_BUMP: '', TERRAIN_CAUSTICS: '', TERRAIN_ANTITILE: '' },
  ultra: { TERRAIN_BUMP: '', TERRAIN_CAUSTICS: '', TERRAIN_ANTITILE: '' },
};
const ANISOTROPY = { low: 1, medium: 4, high: 8, ultra: 8 };

/**
 * Ground layer of every tile (LAYER codes, row-major): the terrain type, with
 * grass split into lush and dry meadows by a broad noise (drier next to sand,
 * lusher next to forest).
 * @returns {Uint8Array}
 */
export function tileLayers(map) {
  const W = map.width;
  const H = map.height;
  const T = map.terrain;
  const seed = (Number(map.seed) | 0) || 7;
  const out = new Uint8Array(W * H);
  const near = (tx, ty, code) => {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const x = tx + ox;
        const y = ty + oy;
        if (x >= 0 && y >= 0 && x < W && y < H && T[y * W + x] === code) return true;
      }
    }
    return false;
  };
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const i = ty * W + tx;
      switch (T[i]) {
        case TERRAIN.DIRT: out[i] = LAYER.DIRT; break;
        case TERRAIN.SAND: out[i] = LAYER.SAND; break;
        case TERRAIN.ROCK: out[i] = LAYER.ROCK; break;
        case TERRAIN.FOREST: out[i] = LAYER.FOREST; break;
        case TERRAIN.WATER: out[i] = LAYER.BED; break;
        default: {
          let dry = vnoise((tx + 0.5) / 15, (ty + 0.5) / 15, seed + 1) * 0.75 + vnoise((tx + 0.5) / 4, (ty + 0.5) / 4, seed + 2) * 0.25;
          if (near(tx, ty, TERRAIN.SAND)) dry += 0.12;
          if (near(tx, ty, TERRAIN.FOREST)) dry -= 0.1;
          out[i] = dry > 0.64 ? LAYER.DRY : LAYER.GRASS;
        }
      }
    }
  }
  return out;
}

/**
 * Per-vertex shade (linear RGB multipliers on the textured ground) for the
 * corner grid, tile centers and the midpoints of horizontal (top/bottom) and
 * vertical (left/right) tile edges: darker under the forest canopy and on deep
 * lake beds, a touch brighter on hilltops, a little per-vertex variation.
 * Corners average their four tiles, edge midpoints their two, centers lean
 * 25% toward their neighbors.
 * @returns {{corner: Float32Array, center: Float32Array, hEdge: Float32Array, vEdge: Float32Array}}
 */
export function terrainColors(map) {
  const W = map.width;
  const H = map.height;
  const T = map.terrain;
  const seed = (Number(map.seed) | 0) || 7;
  const hs = map.heights;
  const VW = W + 1;
  const hAt = (vx, vy) => (hs ? hs[vy * VW + vx] : 0);
  // shade from height and forest share; a faint cool tint in the forest shadow
  const write = (out, o, h, forestShare, hash) => {
    let k = 0.96 + 0.08 * hash;
    k *= 1 - 0.22 * forestShare;
    if (h > 0.25) k *= 1 + (h - 0.25) * 0.12;
    if (h < -0.3) k *= 0.8 + 0.33 * Math.max(0, h + 0.6);
    out[o] = k * (1 - 0.04 * forestShare);
    out[o + 1] = k;
    out[o + 2] = k * (1 + 0.03 * forestShare);
  };
  let n = 0;
  let f = 0;
  const addTile = (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return;
    n++;
    if (T[ty * W + tx] === TERRAIN.FOREST) f++;
  };
  const share = () => {
    const s = n ? f / n : 0;
    n = f = 0;
    return s;
  };
  const corner = new Float32Array(VW * (H + 1) * 3);
  for (let vy = 0; vy <= H; vy++) {
    for (let vx = 0; vx <= W; vx++) {
      addTile(vx - 1, vy - 1);
      addTile(vx, vy - 1);
      addTile(vx - 1, vy);
      addTile(vx, vy);
      write(corner, (vy * VW + vx) * 3, hAt(vx, vy), share(), hash2(vx, vy, seed + 3));
    }
  }
  const hEdge = new Float32Array(W * (H + 1) * 3);
  for (let vy = 0; vy <= H; vy++) {
    for (let tx = 0; tx < W; tx++) {
      addTile(tx, vy - 1);
      addTile(tx, vy);
      write(hEdge, (vy * W + tx) * 3, (hAt(tx, vy) + hAt(tx + 1, vy)) / 2, share(), hash2(tx * 2 + 1, vy * 2, seed + 5));
    }
  }
  const vEdge = new Float32Array(VW * H * 3);
  for (let ty = 0; ty < H; ty++) {
    for (let vx = 0; vx <= W; vx++) {
      addTile(vx - 1, ty);
      addTile(vx, ty);
      write(vEdge, (ty * VW + vx) * 3, (hAt(vx, ty) + hAt(vx, ty + 1)) / 2, share(), hash2(vx * 2, ty * 2 + 1, seed + 5));
    }
  }
  const center = new Float32Array(W * H * 3);
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const i = ty * W + tx;
      addTile(tx - 1, ty);
      addTile(tx + 1, ty);
      addTile(tx, ty - 1);
      addTile(tx, ty + 1);
      const own = T[i] === TERRAIN.FOREST ? 1 : 0;
      const h = (hAt(tx, ty) + hAt(tx + 1, ty) + hAt(tx, ty + 1) + hAt(tx + 1, ty + 1)) / 4;
      write(center, i * 3, h, 0.75 * own + 0.25 * share(), hash2(i, 77, seed + 4));
    }
  }
  return { corner, center, hEdge, vEdge };
}

/**
 * Terrain geometry: every tile is an 8-triangle fan around a center vertex,
 * through its four corners and four edge midpoints. Corner heights come from
 * map.heights, edge midpoints and centers from the bilinear surface, so the mesh
 * matches heightAt() at every vertex. Smooth vertex normals.
 */
export function buildTerrainGeometry(map) {
  const W = map.width;
  const H = map.height;
  const VW = W + 1;
  const nCorner = VW * (H + 1);
  const cBase = nCorner; // tile centers
  const hBase = cBase + W * H; // horizontal edge midpoints
  const vBase = hBase + W * (H + 1); // vertical edge midpoints
  const nVert = vBase + VW * H;
  const pos = new Float32Array(nVert * 3);
  const col = new Float32Array(nVert * 3);
  const hs = map.heights;
  const hAt = (vx, vy) => (hs ? hs[vy * VW + vx] : 0);
  const { corner, center, hEdge, vEdge } = terrainColors(map);
  const put = (i, x, y, z) => {
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
  };
  for (let vy = 0; vy <= H; vy++) for (let vx = 0; vx <= W; vx++) put(vy * VW + vx, vx, hAt(vx, vy), vy);
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const h = (hAt(tx, ty) + hAt(tx + 1, ty) + hAt(tx, ty + 1) + hAt(tx + 1, ty + 1)) / 4;
      put(cBase + ty * W + tx, tx + 0.5, h, ty + 0.5);
    }
  }
  for (let vy = 0; vy <= H; vy++) {
    for (let tx = 0; tx < W; tx++) put(hBase + vy * W + tx, tx + 0.5, (hAt(tx, vy) + hAt(tx + 1, vy)) / 2, vy);
  }
  for (let ty = 0; ty < H; ty++) {
    for (let vx = 0; vx <= W; vx++) put(vBase + ty * VW + vx, vx, (hAt(vx, ty) + hAt(vx, ty + 1)) / 2, ty + 0.5);
  }
  col.set(corner, 0);
  col.set(center, cBase * 3);
  col.set(hEdge, hBase * 3);
  col.set(vEdge, vBase * 3);

  const idx = new Uint32Array(W * H * 24);
  let k = 0;
  const tri = (a, b, c) => {
    idx[k++] = a;
    idx[k++] = b;
    idx[k++] = c;
  };
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const c = cBase + ty * W + tx;
      const tl = ty * VW + tx;
      const tr = tl + 1;
      const bl = tl + VW;
      const br = bl + 1;
      const top = hBase + ty * W + tx;
      const bottom = top + W;
      const left = vBase + ty * VW + tx;
      const right = left + 1;
      // counter-clockwise seen from above (+Y): x east, z south
      tri(c, tr, top);
      tri(c, top, tl);
      tri(c, br, right);
      tri(c, right, tr);
      tri(c, bl, bottom);
      tri(c, bottom, br);
      tri(c, tl, left);
      tri(c, left, bl);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

// ---------------------------------------------------------------------------
// ground material
// ---------------------------------------------------------------------------

const TERRAIN_PARS_VERTEX = /* glsl */ `
varying vec3 vTerrainW;
varying vec3 vTerrainN;`;

const TERRAIN_VERTEX = /* glsl */ `
vTerrainW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vTerrainN = normalize( mat3( modelMatrix ) * objectNormal );`;

const TERRAIN_PARS_FRAGMENT = /* glsl */ `
uniform sampler2DArray uGround;
uniform sampler2D uTNoise;
uniform sampler2D uTFx;
uniform sampler2D uTiles;
uniform vec4 uTileSize; // width, height (tiles)
uniform vec4 uLayer[ ${LAYER_COUNT} ];
uniform float uTTime;
uniform float uWaterLevel;
varying vec3 vTerrainW;
varying vec3 vTerrainN;

int tileLayer( ivec2 c ) {
  c = clamp( c, ivec2( 0 ), ivec2( uTileSize.xy ) - 1 );
  return int( texelFetch( uTiles, c, 0 ).r * 255.0 + 0.5 );
}

// One ground layer at world point p (tiles), with explicit gradients so it can
// be sampled inside the per-pixel branches below.
vec4 groundTex( int layer, vec2 p, vec2 dx, vec2 dy, float sel ) {
  float s = uLayer[ layer ].x;
  vec2 uv = p * s;
  float fl = float( layer );
  #ifdef TERRAIN_ANTITILE
    // repetition breaker (after I. Quilez): a slow noise picks one of a series
    // of random offsets, neighboring picks cross-fade, preferring the higher texel
    float l = sel * 6.0;
    float ia = floor( l );
    float f = l - ia;
    vec2 oa = sin( vec2( 3.0, 7.0 ) * ia + fl );
    vec2 ob = sin( vec2( 3.0, 7.0 ) * ( ia + 1.0 ) + fl );
    vec4 a = textureGrad( uGround, vec3( uv + oa, fl ), dx * s, dy * s );
    vec4 b = textureGrad( uGround, vec3( uv + ob, fl ), dx * s, dy * s );
    return mix( a, b, smoothstep( 0.3, 0.7, f + ( b.a - a.a ) * 0.35 ) );
  #else
    return textureGrad( uGround, vec3( uv, fl ), dx * s, dy * s );
  #endif
}`;

// replaces <map_fragment>: picks and blends the ground layers into the albedo
const TERRAIN_ALBEDO = /* glsl */ `
vec2 tp = vTerrainW.xz;
vec2 tdx = dFdx( tp );
vec2 tdy = dFdy( tp );
vec4 tnA = texture2D( uTNoise, tp * 0.029 ); // ~34-tile features
vec4 tnB = texture2D( uTNoise, tp * 0.13 + 0.37 ); // ~8-tile features
// The tile map is looked up through a warped grid, so type borders meander
// across tiles instead of tracing the grid; the four tiles around the warped
// point give bilinear weights, merged where they share a type.
vec2 tg = tp + ( tnB.xy - 0.5 ) * 1.1 + ( tnA.zw - 0.5 ) * 0.8 - 0.5;
vec2 ti = floor( tg );
vec2 tf = tg - ti;
ivec2 t0 = ivec2( ti );
int c0 = tileLayer( t0 );
int c1 = tileLayer( t0 + ivec2( 1, 0 ) );
int c2 = tileLayer( t0 + ivec2( 0, 1 ) );
int c3 = tileLayer( t0 + ivec2( 1, 1 ) );
vec4 tw = vec4( ( 1.0 - tf.x ) * ( 1.0 - tf.y ), tf.x * ( 1.0 - tf.y ), ( 1.0 - tf.x ) * tf.y, tf.x * tf.y );
if ( c1 == c0 ) { tw.x += tw.y; tw.y = 0.0; }
if ( c2 == c0 ) { tw.x += tw.z; tw.z = 0.0; } else if ( c2 == c1 ) { tw.y += tw.z; tw.z = 0.0; }
if ( c3 == c0 ) { tw.x += tw.w; tw.w = 0.0; } else if ( c3 == c1 ) { tw.y += tw.w; tw.w = 0.0; } else if ( c3 == c2 ) { tw.z += tw.w; tw.w = 0.0; }
// bare rock on steep slopes
float tSlopeRock = smoothstep( 0.9, 0.78, normalize( vTerrainN ).y );
tw *= 1.0 - tSlopeRock;
float tSel = tnB.z;
vec4 s0 = vec4( 0.0 );
vec4 s1 = vec4( 0.0 );
vec4 s2 = vec4( 0.0 );
vec4 s3 = vec4( 0.0 );
vec4 sR = vec4( 0.0 );
if ( tw.x > 0.003 ) s0 = groundTex( c0, tp, tdx, tdy, tSel );
if ( tw.y > 0.003 ) s1 = groundTex( c1, tp, tdx, tdy, tSel );
if ( tw.z > 0.003 ) s2 = groundTex( c2, tp, tdx, tdy, tSel );
if ( tw.w > 0.003 ) s3 = groundTex( c3, tp, tdx, tdy, tSel );
if ( tSlopeRock > 0.003 ) sR = groundTex( ${LAYER.ROCK}, tp, tdx, tdy, tSel );
vec4 L0 = uLayer[ c0 ];
vec4 L1 = uLayer[ c1 ];
vec4 L2 = uLayer[ c2 ];
vec4 L3 = uLayer[ c3 ];
vec4 LR = uLayer[ ${LAYER.ROCK} ];
// Height blend: each type scores its weight plus its texel height, and only
// the types within a small band of the best score show. Borders become
// natural, broken edges instead of a smooth cross-fade.
vec4 tsc = tw + ( vec4( s0.a, s1.a, s2.a, s3.a ) + vec4( L0.y, L1.y, L2.y, L3.y ) ) * 0.6;
tsc = mix( vec4( -9.0 ), tsc, step( 0.003, tw ) );
float tscR = tSlopeRock > 0.003 ? tSlopeRock + ( sR.a + LR.y ) * 0.6 : -9.0;
float tm = max( max( max( tsc.x, tsc.y ), max( tsc.z, tsc.w ) ), tscR ) - 0.14;
vec4 tb = max( tsc - tm, 0.0 );
float tbR = max( tscR - tm, 0.0 );
float tbs = 1.0 / max( tb.x + tb.y + tb.z + tb.w + tbR, 1e-4 );
tb *= tbs;
tbR *= tbs;
vec3 tAlbedo = s0.rgb * tb.x + s1.rgb * tb.y + s2.rgb * tb.z + s3.rgb * tb.w + sR.rgb * tbR;
float tBump = dot( tb, vec4( s0.a * L0.z, s1.a * L1.z, s2.a * L2.z, s3.a * L3.z ) ) + tbR * sR.a * LR.z;
float tRough = dot( tb, vec4( L0.w, L1.w, L2.w, L3.w ) ) + tbR * LR.w;
// macro variation: broad brightness and hue drift hides what repetition is left
// (the layers carry little low-frequency content of their own for that reason)
float tMacro = tnA.x * 0.6 + tnB.x * 0.25 + tnB.w * 0.15;
tAlbedo *= 0.85 + 0.3 * tMacro;
tAlbedo = mix( tAlbedo, tAlbedo * vec3( 1.08, 1.03, 0.88 ), smoothstep( 0.45, 0.85, tnA.y ) * 0.5 );
// shore: wet (darker, glossier) just above the water line, which laps a little
float tAbove = vTerrainW.y - uWaterLevel;
float tLap = 0.012 * sin( uTTime * 1.3 + tp.x * 0.7 + tp.y * 0.5 );
float tWet = 1.0 - smoothstep( 0.02, 0.13, tAbove - tLap );
float tUnder = 1.0 - smoothstep( -0.02, 0.0, tAbove );
tAlbedo *= 1.0 - 0.4 * tWet;
tRough = mix( mix( tRough, 0.42, tWet ), 0.9, tUnder );
tBump *= 1.0 - 0.5 * tWet;
diffuseColor.rgb *= tAlbedo;`;

const TERRAIN_BUMP = /* glsl */ `
#ifdef TERRAIN_BUMP
{
  // bump from the blended texture height: its screen-space gradient tilts the
  // normal (Mikkelsen's surface-gradient bump; no tangents needed)
  vec3 sx = dFdx( - vViewPosition );
  vec3 sy = dFdy( - vViewPosition );
  vec2 dh = vec2( dFdx( tBump ), dFdy( tBump ) );
  vec3 r1 = cross( sy, normal );
  vec3 r2 = cross( normal, sx );
  float det = dot( sx, r1 ) * faceDirection;
  vec3 grad = sign( det ) * ( dh.x * r1 + dh.y * r2 );
  normal = normalize( abs( det ) * normal - grad );
}
#endif`;

const TERRAIN_CAUSTICS = /* glsl */ `
#ifdef TERRAIN_CAUSTICS
if ( tUnder > 0.0 ) {
  // two scrolling caustic webs, wobbled by the water's ripple texture; they
  // brighten the sunlight reaching the lake bed, strongest in the shallows
  vec2 cw = textureGrad( uTFx, tp * 0.11 + vec2( uTTime * 0.013, uTTime * 0.009 ), tdx * 0.11, tdy * 0.11 ).rg - 0.5;
  vec2 cq = tp * 0.19 + cw * 0.35;
  float ca = textureGrad( uTFx, cq + vec2( - uTTime * 0.009, uTTime * 0.006 ), tdx * 0.19, tdy * 0.19 ).b;
  float cb = textureGrad( uTFx, cq * 1.37 + vec2( uTTime * 0.007, uTTime * 0.01 ) + 0.5, tdx * 0.26, tdy * 0.26 ).b;
  float caust = ( ca + cb ) * 0.5 + ca * cb * 1.6;
  float cfade = smoothstep( 0.0, 0.08, - tAbove ) * ( 1.0 - smoothstep( 0.2, 0.6, - tAbove ) );
  reflectedLight.directDiffuse *= 1.0 + caust * 1.6 * cfade;
}
#endif`;

/**
 * The ground material: a MeshStandardMaterial (rough, so it takes the sky's
 * image-based light like the models) with the layer blending patched in.
 */
function terrainMaterial(textures, tiles, map, time, quality) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  mat.name = 'terrain';
  const uniforms = {
    uGround: { value: textures.ground },
    uTNoise: { value: textures.noise },
    uTFx: { value: textures.fx },
    uTiles: { value: tiles },
    uTileSize: { value: new THREE.Vector4(map.width, map.height, 1 / map.width, 1 / map.height) },
    uLayer: { value: LAYER_PARAMS.map((p) => new THREE.Vector4(...p)) },
    uTTime: time,
    uWaterLevel: { value: WATER_LEVEL },
  };
  mat.userData.terrainUniforms = uniforms;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_PARS_VERTEX}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${TERRAIN_VERTEX}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_PARS_FRAGMENT}`)
      .replace('#include <map_fragment>', TERRAIN_ALBEDO)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${TERRAIN_BUMP}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${TERRAIN_CAUSTICS}`);
  };
  mat.customProgramCacheKey = () => 'mythicwar-terrain-v2';
  setTerrainQuality(mat, quality);
  // order matters: the fog-of-war patch keeps the hooks installed before it
  patchWorldMaterial(mat, { cloud: true });
  patchFowMaterial(mat);
  return mat;
}

function setTerrainQuality(mat, quality) {
  mat.defines = { ...(QUALITY_DEFINES[quality] || QUALITY_DEFINES.medium) };
  mat.needsUpdate = true;
}

/** Ground type per tile as a texture (texelFetch'ed by the ground shader). */
function tileTexture(map) {
  const tex = new THREE.DataTexture(tileLayers(map), map.width, map.height, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.name = 'terrain-tiles';
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// beyond the map edge
// ---------------------------------------------------------------------------

const BORDER_VS = /* glsl */ `
varying vec2 vXZ;
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vXZ = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// The world ends in the same drifting dark mist that covers unexplored land
// (fog.js fowApply): it rises out of the black rim the fog of war gives the
// last tile and thins out into darkness further away.
const BORDER_FS = /* glsl */ `
uniform vec2 uMapSize;
uniform sampler2D uFowNoise;
uniform float uFowTime;
uniform float uFowPow;
varying vec2 vXZ;
void main() {
  vec2 d = max( max( - vXZ, vXZ - uMapSize ), 0.0 );
  float dist = length( d );
  vec2 q = vXZ * 0.045 + vec2( uFowTime * 0.006, uFowTime * 0.0035 );
  float m = texture2D( uFowNoise, q ).g * 0.6 + texture2D( uFowNoise, q * 2.7 + 0.3 ).r * 0.4;
  vec3 mist = vec3( 0.075, 0.085, 0.1 ) * ( 0.35 + 0.9 * smoothstep( 0.3, 0.8, m ) );
  mist *= smoothstep( 0.2, 3.0, dist ) * ( 1.0 - smoothstep( 6.0, 34.0, dist ) * 0.85 );
  gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // the mist is tuned in display space like the shroud's (see fowApply)
  gl_FragColor.rgb += pow( mist, vec3( uFowPow ) );
}`;

function borderMesh(map) {
  const geo = new THREE.PlaneGeometry(map.width + 600, map.height + 600);
  geo.rotateX(-Math.PI / 2);
  geo.translate(map.width / 2, -0.9, map.height / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMapSize: { value: new THREE.Vector2(map.width, map.height) },
      uFowNoise: FOW_UNIFORMS.uFowNoise,
      uFowTime: FOW_UNIFORMS.uFowTime,
      uFowPow: FOW_UNIFORMS.uFowPow,
    },
    vertexShader: BORDER_VS,
    fragmentShader: BORDER_FS,
  });
  mat.name = 'terrain-border';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain-border';
  // after the ground and everything else opaque: the depth test then skips the
  // (large) part of the plane hidden under the map
  mesh.renderOrder = 1;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

// ---------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------

/**
 * Build terrain, water and the border beyond the map edge for a map.
 * @param {object} map mapData (width, height, terrain, heights, seed)
 * @param {{ quality?: 'low'|'medium'|'high'|'ultra' }} [o]
 * @returns {{group: THREE.Group, terrain: THREE.Mesh, water: THREE.Mesh|null, border: THREE.Mesh,
 *   height: (x:number,y:number)=>number, update: (timeSec:number)=>void, setQuality: (q:string)=>void, dispose: ()=>void}}
 */
export function createTerrain(map, { quality = 'medium' } = {}) {
  const q = QUALITY_DEFINES[quality] ? quality : 'medium';
  const group = new THREE.Group();
  group.name = 'terrain-group';
  const textures = createTerrainTextures(ANISOTROPY[q]);
  const tiles = tileTexture(map);
  const time = { value: 0 };
  const geo = buildTerrainGeometry(map);
  const mat = terrainMaterial(textures, tiles, map, time, q);
  const terrain = new THREE.Mesh(geo, mat);
  terrain.name = 'terrain';
  terrain.receiveShadow = true;
  terrain.matrixAutoUpdate = false;
  terrain.updateMatrix();
  group.add(terrain);

  const water = buildWater(map, { fx: textures.fx, noise: textures.noise, time, hq: q !== 'low' });
  if (water) group.add(water);

  const border = borderMesh(map);
  group.add(border);

  return {
    group,
    terrain,
    water,
    border,
    height: (x, y) => heightAt(map, x, y),
    update(timeSec) {
      time.value = timeSec;
    },
    /** Shader detail and texture filtering for a quality tier. */
    setQuality(next) {
      if (!QUALITY_DEFINES[next]) return;
      setTerrainQuality(mat, next);
      if (water) setWaterQuality(water.material, next !== 'low');
      if (textures.ground.anisotropy !== ANISOTROPY[next]) {
        textures.ground.anisotropy = ANISOTROPY[next];
        textures.ground.needsUpdate = true;
      }
    },
    dispose() {
      group.removeFromParent();
      geo.dispose();
      mat.dispose();
      tiles.dispose();
      textures.dispose();
      if (water) {
        water.geometry.dispose();
        water.material.dispose();
      }
      border.geometry.dispose();
      border.material.dispose();
    },
  };
}
