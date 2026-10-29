// Building models, layer 2: the shared materials. The surface shader draws stylized detail
// (stone courses, bricks, planks, roof-tile rows, thatch) per surface class from the object-space
// position and normal, plus grime and ambient occlusion near the ground; glowing parts store HDR
// colors so they bloom; doorways and windows show only the light from inside (and the lamps after
// dusk). Also the team, construction-clip, gold and gate-vortex materials and the animation clock.
import * as THREE from 'three';
import { patchWorldMaterial, WORLD_UNIFORMS } from '../shading.js';
import {
  PLINTH, C, clamp01, CLS, CONTACT_RANGE, GLOW,
  INTERIOR_FLOOR, INTERIOR_DARK,
} from './building-core.js';

// ---------------------------------------------------------------------------
// materials (shared)
// ---------------------------------------------------------------------------

export const TIME = { value: 0 };
const MATS = {};
const TEAM_MATS = new Map();
const VORTEX_MATS = new Map();
// a faint sky-colored rim on lit parts (patchWorldMaterial), so silhouettes read against the ground
const RIM = 0.12;

// ---- detail texture: the patterns the surface shader draws, tileable, mipmapped

const DETAIL = { value: null };
const DETAIL_MEAN = { value: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) }; // channel averages (zero-mean patterns)

/**
 * 256² RGBA: (r) bevelled blocks in a running bond, 8 rows × 4 blocks, 0 in
 * the joints; (g) a random value per block; (b) fine value noise; (a) streaks
 * running along U (wood grain, straw, brush marks). Made on first use.
 */
function detailTexture() {
  if (DETAIL.value) return DETAIL.value;
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  const hash = (x, y, s) => {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  // value noise, periodic with px × py cells over the tile
  const vn = (fx, fy, s, px, py) => {
    const x = fx * px;
    const y = fy * py;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const xa = ((x0 % px) + px) % px;
    const xb = (xa + 1) % px;
    const ya = ((y0 % py) + py) % py;
    const yb = (ya + 1) % py;
    const a = hash(xa, ya, s);
    const b = hash(xb, ya, s);
    const c = hash(xa, yb, s);
    const d = hash(xb, yb, s);
    return a + (b - a) * sx + (c - a + (d - c - b + a) * sx) * sy;
  };
  const smooth = (e0, e1, v) => {
    const t = clamp01((v - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
  };
  const ROWS = 8;
  const COLS = 4;
  const rh = S / ROWS;
  const bw = S / COLS;
  // block values: an even spread (mean ½) dealt out in a scrambled order
  const ids = Array.from({ length: ROWS * COLS }, (_, i) => i).sort((a, b) => hash(a, 0, 7) - hash(b, 0, 7));
  const chan = [new Float32Array(S * S), new Float32Array(S * S), new Float32Array(S * S), new Float32Array(S * S)];
  for (let y = 0; y < S; y++) {
    const fy = (y + 0.5) / S;
    const row = Math.floor(y / rh);
    const ly = y + 0.5 - row * rh;
    for (let x = 0; x < S; x++) {
      const fx = (x + 0.5) / S;
      const sx = (x + (row & 1 ? bw / 2 : 0)) % S;
      const col = Math.floor(sx / bw);
      const lx = sx + 0.5 - col * bw;
      // distance to the block edge (texels), corners rounded, edges a little chipped
      const ex = Math.min(lx, bw - lx);
      const ey = Math.min(ly, rh - ly);
      let d = ex < 4 && ey < 4 ? 4 - Math.hypot(4 - ex, 4 - ey) : Math.min(ex, ey);
      d += (vn(fx, fy, 3, 64, 64) - 0.5) * 1.8;
      const id = (ids[row * COLS + col] + 0.5) / (ROWS * COLS);
      const blk = smooth(0.5, 3.2, d) * (0.92 + 0.08 * hash(col, row, 9)) * (0.95 + 0.05 * vn(fx, fy, 5, 32, 32));
      let n = 0;
      let amp = 0.5;
      let norm = 0;
      for (let o = 0; o < 4; o++) {
        const p = 8 << o;
        n += vn(fx, fy, 11 + o, p, p) * amp;
        norm += amp;
        amp *= 0.5;
      }
      n /= norm;
      // streaks: slow along U (x), fast along V (y)
      const st = (vn(fx, fy, 21, 2, 32) * 0.55 + vn(fx, fy, 22, 4, 64) * 0.3 + vn(fx, fy, 23, 8, 128) * 0.15);
      const i = y * S + x;
      chan[0][i] = blk;
      chan[1][i] = id;
      chan[2][i] = (n - 0.5) * 1.7;
      chan[3][i] = (st - 0.5) * 2;
    }
  }
  // noise and streaks centered on ½, so patterns shift a surface's tone without changing its average
  for (const c of [chan[2], chan[3]]) {
    let m = 0;
    for (let i = 0; i < c.length; i++) m += c[i];
    m /= c.length;
    for (let i = 0; i < c.length; i++) c[i] = c[i] - m + 0.5;
  }
  const mean = [0, 0, 0, 0];
  for (let i = 0; i < S * S; i++) {
    for (let k = 0; k < 4; k++) {
      const v = Math.round(clamp01(chan[k][i]) * 255);
      data[i * 4 + k] = v;
      mean[k] += v / 255;
    }
  }
  DETAIL_MEAN.value.set(mean[0] / (S * S), mean[1] / (S * S), mean[2] / (S * S), mean[3] / (S * S));
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 2; // walls seen at a slant from the RTS camera: about 2:1, so 4× adds nothing visible
  tex.colorSpace = THREE.NoColorSpace;
  tex.name = 'building-detail';
  tex.needsUpdate = true;
  DETAIL.value = tex;
  return tex;
}

// ---- shader chunks

const ANIM_PARS = '\nattribute vec2 aAnim;\nuniform float uBldTime;';
const WAVE_GLSL = `
if (aAnim.x > 0.0) {
  float wph = uBldTime * 3.6 + position.x * 6.5 + position.y * 2.3;
  transformed.z += sin(wph) * 0.055 * aAnim.x;
  transformed.y += cos(wph * 0.8) * 0.012 * aAnim.x;
}`;
const FLICKER_GLSL = `
if (aAnim.x > 0.0) {
  float fph = uBldTime * 9.0 + position.x * 17.0 + position.z * 13.0;
  transformed.x += sin(fph + position.y * 21.0) * 0.022 * aAnim.x;
  transformed.z += cos(fph * 1.13 + position.y * 17.0) * 0.022 * aAnim.x;
  transformed.y += (0.5 + 0.5 * sin(fph * 0.73)) * 0.06 * aAnim.x;
}`;
const TWINKLE_GLSL = `
#ifdef USE_COLOR
if (aAnim.y > 0.0) {
  float tw = sin(uBldTime * 2.3 + aAnim.y * 41.0);
  vColor.rgb *= 0.72 + 1.3 * pow(max(tw, 0.0), 10.0);
}
#endif`;
// Glowing colors are HDR (bloom in the post pipeline). Drawn straight to the
// canvas (low quality, tone mapped per material, no bloom) the part above 1
// is compressed instead, so fires stay orange rather than turning white.
const GLOW_LOW_PATH = `
#ifdef TONE_MAPPING
gl_FragColor.rgb = min( gl_FragColor.rgb, vec3( 1.0 ) ) + max( gl_FragColor.rgb - 1.0, vec3( 0.0 ) ) * 0.35;
#endif`;

const SURF_PARS_VERTEX = `
attribute vec4 aSurf;
varying vec4 vSurf;
varying vec3 vObjPos;
varying vec3 vObjN;`;
// pattern space = object space before animation (waving cloth does not swim)
const SURF_VERTEX = `
vSurf = aSurf;
vObjPos = position;
vObjN = objectNormal;`;

const SURFACE_GLSL = `
uniform sampler2D uDetail;
uniform vec4 uDetailMean;
varying vec4 vSurf;
varying vec3 vObjPos;
varying vec3 vObjN;
#define BLD_PLINTH ${PLINTH.toFixed(3)}
#define BLD_CONTACT ${CONTACT_RANGE.toFixed(2)}
#define BLD_INTERIOR ${CLS.INTERIOR.toFixed(1)}
#define BLD_LAMP_LIGHT vec3( 1.5, 0.74, 0.26 )
const vec3 BLD_IN_FLOOR = vec3( ${INTERIOR_FLOOR.toArray().map((v) => v.toFixed(4)).join(', ')} );
const vec3 BLD_IN_DARK = vec3( ${INTERIOR_DARK.toArray().map((v) => v.toFixed(4)).join(', ')} );
// Drawn straight to the canvas (low quality: tone mapped here) the surface
// detail skips its coarse layer and the bump, the costly parts.
#ifdef TONE_MAPPING
#define BLD_LITE
#endif

// Bump mapping from the screen-space derivatives of a height (Mikkelsen 2010):
// no UVs or tangents needed; the height is in world units, so the relief does
// not change with zoom.
vec3 bldBump( vec3 p, vec3 n, vec2 dh ) {
  vec3 dpx = dFdx( p );
  vec3 dpy = dFdy( p );
  vec3 r1 = cross( dpy, n );
  vec3 r2 = cross( n, dpx );
  float det = dot( dpx, r1 );
  vec3 grad = sign( det ) * ( dh.x * r1 + dh.y * r2 );
  return normalize( abs( det ) * n - grad );
}

float bldHash( vec2 p ) {
  return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
}

// Stylized surface detail per class (CLS in building-models.js) from the
// object-space position and normal: the pattern plane is the floor plan for
// level faces, else (along the wall, up the surface) so courses and tile rows
// stay horizontal and keep their spacing on slopes. alb multiplies the vertex
// color, h is a relief height (world units) for bldBump, ao dims ambient
// light. The detail texture's mipmaps fade every pattern into its average with
// distance, so buildings stay calm when zoomed out.
void bldSurface( float cls, float seed, float rough0, float metal0, out vec3 alb, out float rough, out float metal, out float h, out float ao ) {
  // Openings (BLD_INTERIOR) take the plain path; SURF_COLOR makes them unlit.
  // No early return for them: the texture fetches and fwidth below must stay
  // in uniform control flow for every shader compiler (D3D's included).
  alb = vec3( 1.0 );
  rough = rough0;
  metal = metal0;
  h = 0.0;
  ao = 1.0;
  vec3 P = vObjPos;
  vec3 N = normalize( vObjN );
  float sinS = length( N.xz );
  bool roofy = ( cls >= 10.0 && cls <= 12.0 ) || cls == 23.0;
  bool level = abs( N.y ) > ( roofy ? 0.985 : 0.72 );
  vec2 tH = sinS > 1e-4 ? vec2( -N.z, N.x ) / sinS : vec2( 1.0, 0.0 );
  // Roofs are all rectangular: courses run along the nearest axis, so a slope
  // with swept corners or smoothed normals keeps straight, parallel rows.
  float u = dot( P.xz, tH );
  vec2 uv = level ? P.xz : vec2( u, P.y / max( sinS, 0.3 ) );
  if ( cls == 10.0 || cls == 11.0 || cls == 23.0 ) {
    // Roofs are rectangular: rows run along the nearest axis and are measured
    // in plan, from the slope's own direction, so a slope with swept corners or
    // a curved profile keeps straight parallel courses (no contour swirls).
    bool xs = abs( N.x ) > abs( N.z );
    uv = vec2( xs ? P.z : P.x, ( xs ? P.x * sign( N.x ) : P.z * sign( N.z ) ) / 0.86 );
  }
  bool mason = cls >= 1.0 && cls <= 6.0 && cls != 4.0;
  bool beam = cls >= 19.0 && cls <= 21.0;
  bool wood = ( cls >= 7.0 && cls <= 9.0 ) || beam;
  // world size of one texture tile (8 rows x 4 blocks); swap puts U along the grain
  vec2 ts = vec2( 0.6 );
  bool swap = false;
  if ( cls == 1.0 ) ts = vec2( 1.2, 1.2 );
  else if ( cls == 2.0 ) ts = vec2( 1.6, 1.6 );
  else if ( cls == 3.0 ) ts = vec2( 2.4, 2.0 );
  else if ( cls == 4.0 ) ts = vec2( 1.6, 1.6 );
  else if ( cls == 5.0 ) ts = vec2( 0.8, 0.64 );
  else if ( cls == 6.0 ) ts = vec2( 0.64, 0.5 );
  else if ( wood ) {
    float ax = beam ? cls - 12.0 : cls; // 7 grain along y, 8 along x, 9 along z
    ts = vec2( 2.4, 0.8 );
    swap = ( ax == 7.0 && !level ) || ( ax == 9.0 && level );
  } else if ( cls == 10.0 || cls == 23.0 ) ts = vec2( 0.56, 0.88 );
  else if ( cls == 11.0 ) ts = vec2( 1.2, 0.9 );
  else if ( cls == 12.0 ) { ts = vec2( 0.96, 0.6 ); swap = !level; }
  else if ( cls == 15.0 ) ts = vec2( 0.25, 0.25 );
  else if ( cls == 16.0 ) { ts = vec2( 3.0, 1.0 ); swap = !level; }
  else if ( cls == 17.0 ) ts = vec2( 1.4, 1.4 );
  else if ( cls == 18.0 ) ts = vec2( 0.9, 0.9 );
  else if ( cls == 24.0 ) ts = vec2( 1.6, 1.6 );
  if ( mason && level ) ts.y *= 2.0; // paving: squarer slabs
  if ( swap ) uv = uv.yx;
  vec2 uvT = uv / ts + seed * vec2( 0.3711, 0.6133 );
  vec4 d = texture2D( uDetail, uvT );
  // coarse layer: mottling (b) and, on walls, vertical weathering streaks (a)
  #ifdef BLD_LITE
  vec4 c = vec4( 0.5, 0.5, uDetailMean.b, 0.5 );
  #else
  vec4 c = texture2D( uDetail, ( level ? P.xz * 0.27 : vec2( P.y * 0.22, u * 0.55 ) ) + seed * 0.173 );
  #endif
  vec2 fw = fwidth( uvT );
  vec2 uvDx = dFdx( uvT ); // for fetches made inside a branch: the derivatives stay in uniform control flow
  vec2 uvDy = dFdy( uvT );
  // zero-mean terms: patterns move a surface's tone around its vertex color, so
  // seen from afar (mipmapped to the average) it keeps the palette color
  float blk = d.r;
  float blk0 = d.r - uDetailMean.r;
  float bid = d.g - uDetailMean.g;
  float nz = d.b - uDetailMean.b;
  float stk = d.a - uDetailMean.a;
  float mot = c.b - uDetailMean.b;
  if ( mason ) {
    // ashlar, marble, bricks: dark bevelled joints, a tint per block
    float jd = cls == 3.0 ? 0.16 : cls == 2.0 ? 0.3 : cls == 5.0 ? 0.24 : cls == 6.0 ? 0.28 : 0.42;
    float bv = cls == 3.0 ? 0.05 : cls == 6.0 ? 0.18 : 0.12;
    alb *= ( 1.0 + jd * blk0 ) * ( 1.0 + bv * 2.0 * bid ) * ( 1.0 + 0.1 * nz );
    // broad patches of warmer and cooler stone across a wall, the way weather and quarries leave it
    alb *= ( 1.0 + 0.12 * mot ) * vec3( 1.0 + 0.06 * mot, 1.0, 1.0 - 0.08 * mot );
    if ( cls == 2.0 ) alb *= vec3( 1.0 + 0.1 * bid, 1.0, 1.0 - 0.1 * bid );
    rough += 0.14 * ( 1.0 - blk ) + 0.12 * bid;
    h = blk * ( cls == 3.0 ? 0.004 : cls >= 5.0 ? 0.006 : 0.012 );
    ao = mix( cls == 3.0 ? 0.88 : 0.68, 1.0, blk );
    if ( cls == 5.0 ) {
      // mudbrick: a mud wash over most of the wall hides the bricks
      float wash = smoothstep( -0.1, 0.12, mot + 0.15 * nz );
      alb = mix( alb, vec3( 1.0 + 0.08 * nz ), wash * 0.8 );
      h *= 1.0 - wash * 0.8;
      ao = mix( ao, 1.0, wash * 0.8 );
    }
  } else if ( cls == 4.0 ) {
    // plaster
    alb *= 1.0 + 0.12 * mot + 0.06 * nz;
    rough += 0.06 * nz;
  } else if ( wood ) {
    // planks: the blocks stretched along the grain (rows = boards, block ends =
    // butt joints) with grain streaks; a beam is a single board
    float seams = beam ? 1.0 : blk;
    alb *= ( beam ? 1.0 : ( 1.0 + 0.5 * blk0 ) * ( 1.0 + 0.22 * bid ) ) * ( 1.0 + 0.3 * stk );
    rough += 0.12 * stk + 0.1 * ( 1.0 - seams );
    h = seams * 0.006 + stk * 0.0015;
    ao = mix( 0.7, 1.0, seams );
  } else if ( cls == 23.0 ) {
    // tiles or shingles laid in real courses (the rows are geometry): barrel ribs, a tint per
    // column of tiles, a worn and mottled surface
    float colF = uvT.x * 4.0;
    float fc = 1.0 - smoothstep( 0.16, 0.36, fw.x * 4.0 );
    float rib = 0.5 + 0.5 * cos( fract( colF ) * 6.2832 );
    float tid = bldHash( vec2( floor( colF ), seed ) ) - 0.5;
    // every column of tiles is fired a little differently (toward orange or brown), and the roof has
    // aged: dark green moss in patches
    alb *= ( 1.0 + 0.16 * ( rib - 0.5 ) * fc ) * vec3( 1.0 + 0.26 * tid, 1.0 + 0.04 * tid, 1.0 - 0.3 * tid ) * ( 1.0 + 0.14 * nz + 0.12 * mot );
    float moss = smoothstep( 0.1, 0.26, mot + 0.12 * nz ) * 0.55;
    alb = mix( alb, alb * vec3( 0.7, 0.98, 0.55 ), moss );
    rough += 0.12 * nz + 0.08 * ( 1.0 - rib ) + 0.2 * moss;
    h = rib * 0.006 * fc + d.b * 0.004;
  } else if ( cls == 10.0 ) {
    // roof tiles: rows rising up the slope with a shadow under each overlapping
    // lip, barrel ribs across; both fade out once a row is under ~3 pixels
    float rowF = uvT.y * 8.0;
    float colF = uvT.x * 4.0;
    float rowP = fract( rowF );
    float fr = 1.0 - smoothstep( 0.16, 0.36, fw.y * 8.0 );
    float fc = 1.0 - smoothstep( 0.16, 0.36, fw.x * 4.0 );
    float lip = smoothstep( 0.55, 1.0, rowP );
    float rib = 0.5 + 0.5 * cos( fract( colF ) * 6.2832 );
    float tid = bldHash( floor( vec2( colF, rowF ) ) ) - 0.5;
    alb *= ( 1.0 - 0.24 * ( lip - 0.225 ) * fr ) * ( 1.0 + 0.14 * ( rib - 0.5 ) * fc ) * ( 1.0 + 0.14 * tid * fr * fc ) * ( 1.0 + 0.1 * nz + 0.08 * mot );
    rough += 0.1 * nz + 0.08 * ( 1.0 - rib );
    // a soft lip (the drop spans a quarter row) keeps glossy tiles from glinting in lines
    h = ( rowP * ( 1.0 - smoothstep( 0.72, 1.0, rowP ) ) * 0.008 * fr + rib * 0.006 * fc );
    ao = 1.0 - 0.24 * lip * fr;
  } else if ( cls == 11.0 ) {
    // turf: a living sod blanket, no joints: soft patches from yellow-green to deep green, a dry golden
    // tint here and there, grass strokes, tufted bumps and a few flower specks you find up close
    float fb = 1.0 - smoothstep( 0.2, 0.5, max( fw.x * 4.0, fw.y * 8.0 ) );
    float tone = 1.5 * mot + 0.9 * nz;
    vec3 grass = vec3( 1.0 + 0.5 * tone, 1.0 + 0.26 * tone, 1.0 - 0.3 * tone );
    float dry = smoothstep( 0.1, 0.34, mot + 0.3 * nz );
    alb *= mix( grass, vec3( 1.34, 1.08, 0.55 ), dry * 0.45 );
    alb *= vec3( 1.0 + 0.1 * stk, 1.0 + 0.05 * stk, 1.0 - 0.1 * stk );
    float fl = step( 0.994, bldHash( floor( uvT * vec2( 16.0, 22.0 ) ) + seed ) ) * fb;
    alb = mix( alb, vec3( 2.4, 2.2, 1.1 ), fl * 0.7 );
    rough += 0.05 * nz;
    h = d.b * 0.016 + d.a * 0.006;
    ao = 0.82 + 0.18 * d.b;
    #ifndef BLD_LITE
    // a finer pass of the same map: tufts and blades at a third of the scale
    vec4 d2 = textureGrad( uDetail, uvT * vec2( 3.3, 3.7 ) + 0.37, uvDx * vec2( 3.3, 3.7 ), uvDy * vec2( 3.3, 3.7 ) );
    float fine = d2.b - uDetailMean.b;
    float blade = d2.a - uDetailMean.a;
    alb *= vec3( 1.0 + 0.24 * fine, 1.0 + 0.18 * fine, 1.0 - 0.12 * fine ) * ( 1.0 + 0.2 * blade * fb );
    h += d2.b * 0.01;
    ao *= 0.9 + 0.1 * d2.b;
    #endif
  } else if ( cls == 12.0 ) {
    // thatch: straw streaks down the slope, layered courses with a shadowed lip
    float rowP = fract( uvT.x * 8.0 );
    float fr = 1.0 - smoothstep( 0.2, 0.45, fw.x * 8.0 );
    float lip = smoothstep( 0.6, 1.0, rowP );
    alb *= ( 1.0 + 0.32 * stk ) * ( 1.0 - 0.3 * ( lip - 0.2 ) * fr ) * ( 1.0 + 0.12 * mot );
    h = d.a * 0.006 + rowP * ( 1.0 - smoothstep( 0.85, 1.0, rowP ) ) * 0.016 * fr;
    ao = ( 1.0 - 0.3 * lip * fr ) * ( 0.85 + 0.15 * d.a );
  } else if ( cls == 13.0 || cls == 14.0 ) {
    // metal: hammered, worn roughness
    alb *= 1.0 + 0.1 * nz;
    rough += 0.16 * nz + 0.1 * mot;
  } else if ( cls == 15.0 ) {
    alb *= 1.0 + 0.08 * stk + 0.06 * nz;
  } else if ( cls == 16.0 ) {
    // lacquer: faint brush streaks in the gloss
    alb *= 1.0 + 0.04 * stk;
    rough += 0.12 * stk + 0.1 * mot;
  } else if ( cls == 17.0 ) {
    // rock: mottled, faint strata
    alb *= ( 1.0 + 0.25 * nz + 0.22 * mot ) * ( 1.0 + 0.07 * sin( P.y * 26.0 + nz * 4.0 ) );
    rough += 0.14 * nz;
    h = d.b * 0.02;
    ao = 0.8 + 0.2 * d.b;
  } else if ( cls == 24.0 ) {
    // a court of packed earth and gravel with scattered flagstones: stones where the block map's
    // random value is high, dark dirt joints round them, mottled ground elsewhere
    float stn = smoothstep( 0.18, 0.27, bid );
    float jn = smoothstep( 0.08, 0.5, blk );
    float fb = 1.0 - smoothstep( 0.2, 0.5, max( fw.x * 4.0, fw.y * 8.0 ) );
    vec3 dirt = vec3( 1.0 + 0.22 * mot + 0.14 * nz );
    vec3 stoneC = vec3( 1.1, 1.12, 1.14 ) * ( 1.0 + 0.3 * bid ) * mix( 0.78, 1.0, jn );
    alb *= mix( dirt, stoneC, stn * fb );
    rough += 0.1 * ( 1.0 - jn ) * stn * fb;
    h = stn * jn * 0.012 * fb + d.b * 0.01;
    ao = mix( 1.0, mix( 0.72, 1.0, jn ), stn * fb );
  } else if ( cls == 18.0 ) {
    // packed earth set with cobbles: a tint per stone, dark dirt joints
    float cob = smoothstep( 0.08, 0.55, blk );
    float fb = 1.0 - smoothstep( 0.2, 0.5, max( fw.x * 4.0, fw.y * 8.0 ) );
    alb *= mix( 1.0, mix( 0.74, 1.0 + 0.34 * bid, cob ), fb ) * ( 1.0 + 0.2 * mot + 0.12 * nz );
    rough += 0.1 * ( 1.0 - cob ) * fb;
    h = cob * 0.01 * fb + d.b * 0.006;
    ao = mix( 1.0, mix( 0.78, 1.0, cob ), fb );
  } else {
    alb *= 1.0 + 0.05 * nz + 0.04 * mot;
  }
  // walls weather in vertical streaks
  if ( !level && ( mason || cls == 4.0 ) ) alb *= 1.0 - 0.08 * smoothstep( 0.05, 0.3, c.a - 0.5 );
  #ifndef BLD_BASE
  // grime and ambient occlusion toward the ground, and at the foot of a part
  // standing on another (contact height in vSurf.w). Walls only: open floors
  // near the ground (platforms, stylobates, yards) stay clean and sunlit.
  float vert = 1.0 - smoothstep( 0.5, 0.8, abs( N.y ) );
  float gnd = ( 1.0 - smoothstep( BLD_PLINTH, BLD_PLINTH + 0.42, P.y ) ) * vert;
  float grime = clamp( gnd * ( 0.65 + 1.2 * mot ), 0.0, 1.0 );
  alb *= mix( vec3( 1.0 ), vec3( 0.68, 0.61, 0.52 ), grime * ( cls == 3.0 ? 0.4 : 0.55 ) );
  rough = mix( rough, 1.0, grime * 0.4 );
  float aoG = mix( mix( 1.0, 0.52, vert ), 1.0, smoothstep( BLD_PLINTH - 0.05, BLD_PLINTH + 0.5, P.y ) );
  float aoC = 1.0 - 0.38 * vert * ( 1.0 - smoothstep( 0.0, 0.16, vSurf.w * BLD_CONTACT ) );
  ao *= min( aoG, aoC );
  #endif
  rough = clamp( rough, 0.04, 1.0 );
}`;

// Runs after color_fragment: evaluates the surface once for the later chunks.
const SURF_COLOR = `
vec3 bldAlb;
float bldRough;
float bldMetal;
float bldH;
float bldAO;
vec3 bldEmit = vec3( 0.0 );
float bldLit = 1.0;
{
  float code = floor( vSurf.z * 255.0 + 0.5 );
  float cls = floor( code / 8.0 );
  float seed = code - cls * 8.0;
  float rough0 = vSurf.x;
  float metal0 = vSurf.y;
  #ifdef BLD_CLIP
    #ifdef BLD_TEAM
    if ( !gl_FrontFacing ) diffuseColor.rgb *= 0.45;
    #else
    // Construction sites are cut open at uCut; what shows through the cut is
    // the inside (back faces) of walls and roofs, drawn as dark wooden boards,
    // and so are level tops in the last 0.3 below the cut (the course being
    // laid), so a cut-open building reads as a building site rather than a
    // finished flat roof. Floors and foundations (below PLINTH + 0.15) keep
    // their own look.
    if ( !gl_FrontFacing || ( vObjPos.y > uCut - 0.3 && vObjPos.y > BLD_PLINTH + 0.15 && abs( vObjN.y ) > 0.98 * length( vObjN ) ) ) {
      diffuseColor.rgb = vec3( 0.13, 0.068, 0.028 );
      cls = 8.0;
      rough0 = 0.85;
      metal0 = 0.0;
    }
    #endif
  #endif
  bldSurface( cls, seed, rough0, metal0, bldAlb, bldRough, bldMetal, bldH, bldAO );
  // AO on direct light too (half): the stylized look wants dark feet even in sunlight
  diffuseColor.rgb *= bldAlb * mix( 1.0, bldAO, 0.5 );
  if ( cls == BLD_INTERIOR ) {
    // a doorway or window: no light falls on it (no diffuse, no specular), it
    // only shows the light from inside pooling on the floor (vSurf.w is 0 at
    // the floor, 1 at the lintel); the 4th power keeps most of it dark
    float fl = 1.0 - vSurf.w;
    #ifdef BLD_CLIP
    fl = 0.0; // nobody lives on a building site yet
    #endif
    #ifndef BLD_CLIP
    // after dusk the lamps are lit inside: the opening glows warm, brightest at the floor
    // (uLamp is the time of day's lamp level, 0 by day)
    bldEmit += BLD_LAMP_LIGHT * ( uLamp * ( 0.4 + 0.6 * fl ) );
    #endif
    fl *= fl;
    bldEmit += mix( BLD_IN_DARK, BLD_IN_FLOOR, fl * fl );
    bldLit = 0.0;
    diffuseColor.rgb = vec3( 0.0 );
  }
}`;

/**
 * Lit building material (MeshStandardMaterial with vertex colors): per-vertex
 * roughness / metalness and procedural surface detail, optional animation
 * (team: waving cloth) and construction clipping (everything above
 * userData.uCut is cut away, the inside shows as boards). `base` (the
 * foundation) skips ground grime and occlusion.
 */
function patchBuilding(mat, { anim = null, clip = false, base = false } = {}) {
  detailTexture();
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = DETAIL;
    sh.uniforms.uDetailMean = DETAIL_MEAN;
    let vsPars = SURF_PARS_VERTEX;
    let vsBegin = SURF_VERTEX;
    if (anim) {
      sh.uniforms.uBldTime = TIME;
      vsPars += ANIM_PARS;
      vsBegin += WAVE_GLSL;
    }
    let defs = '';
    if (base) defs += '\n#define BLD_BASE';
    if (anim) defs += '\n#define BLD_TEAM';
    if (clip) {
      sh.uniforms.uCut = mat.userData.uCut;
      defs += '\n#define BLD_CLIP\nuniform float uCut;';
    }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>${vsPars}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>${vsBegin}`);
    let fs = sh.fragmentShader
      .replace('#include <common>', `#include <common>${defs}\n${SURFACE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${SURF_COLOR}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = bldRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = bldMetal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n#ifndef BLD_LITE\nnormal = bldBump( - vViewPosition, normal, vec2( dFdx( bldH ), dFdy( bldH ) ) );\n#endif')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += bldEmit;')
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= bldAO;
        reflectedLight.indirectSpecular *= mix( 1.0, bldAO, 0.7 ) * bldLit;
        reflectedLight.directSpecular *= bldLit;`,
      );
    if (clip) fs = fs.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif ( vObjPos.y > uCut ) discard;');
    sh.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => `mythicwar-bld4-${anim || 'none'}-${clip ? 'clip' : 'full'}-${base ? 'base' : 'part'}`;
  return mat;
}

/** Lit building material: patched, then cloud shadows and rim (before the fog of war, which game-renderer adds). */
function litMaterial(o, patch) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, ...o });
  patchBuilding(m, patch);
  patchWorldMaterial(m, { cloud: true, rim: patch.base ? 0 : RIM });
  return m;
}

export function bodyMaterial() {
  if (!MATS.body) {
    MATS.body = litMaterial({}, {});
    MATS.body.name = 'building-body';
  }
  return MATS.body;
}

export function baseMaterial() {
  if (!MATS.base) {
    MATS.base = litMaterial({}, { base: true });
    MATS.base.name = 'building-base';
  }
  return MATS.base;
}

export function glowMaterial() {
  if (!MATS.glow) {
    const m = new THREE.MeshBasicMaterial({ vertexColors: true });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uBldTime = TIME;
      sh.uniforms.uLamp = WORLD_UNIFORMS.uLamp;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>${ANIM_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>${FLICKER_GLSL}`)
        .replace('#include <color_vertex>', `#include <color_vertex>\n${TWINKLE_GLSL}`);
      // lanterns, braziers and fires burn brighter into the dark: the glow follows the lamp level
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uLamp;')
        .replace('#include <tonemapping_fragment>', `gl_FragColor.rgb *= mix( 0.7, 1.35, uLamp );\n${GLOW_LOW_PATH}\n#include <tonemapping_fragment>`);
    };
    m.customProgramCacheKey = () => 'mythicwar-bld4-glow';
    m.name = 'building-glow';
    MATS.glow = m;
  }
  return MATS.glow;
}

/**
 * Gold veins of a mine: polished gold that catches the sky, with a faint
 * glow of its own and sparkles (twinkle) bright enough to bloom.
 */
export function mineGoldMaterial() {
  if (!MATS.mineGold) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.24, metalness: 0.85 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uBldTime = TIME;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>${ANIM_PARS}\nvarying float vSpark;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vSpark = aAnim.y > 0.0 ? pow( max( sin( uBldTime * 2.3 + aAnim.y * 41.0 ), 0.0 ), 10.0 ) : 0.0;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vSpark;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += vColor.rgb * ( 0.28 + 3.2 * vSpark );`);
    };
    m.customProgramCacheKey = () => 'mythicwar-bld3-minegold';
    patchWorldMaterial(m, { cloud: true, rim: 0 });
    m.name = 'mine-gold';
    MATS.mineGold = m;
  }
  return MATS.mineGold;
}

export function teamMaterial(teamColor) {
  const col = C(teamColor ?? '#888888');
  const key = col.getHexString();
  let m = TEAM_MATS.get(key);
  if (!m) {
    m = litMaterial({ color: new THREE.Color().copy(col) }, { anim: 'team' });
    m.name = `building-team-${key}`;
    TEAM_MATS.set(key, m);
  }
  return m;
}

/** Per-model clone used while under construction (clips everything above uCut). */
export function clipMaterial(base, anim) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, color: base.color, side: THREE.DoubleSide });
  m.userData.uCut = { value: 0 };
  m.name = `${base.name}-clip`;
  patchBuilding(m, { anim, clip: true });
  patchWorldMaterial(m, { cloud: true, rim: RIM });
  return m;
}

const VORTEX_VS = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
// Colors are linear; the swirl is HDR (× uGain) so it blooms. Straight to the
// canvas (low quality: tone mapped here, no bloom) it is added onto an already
// tone-mapped gate, so it is kept under 1 there or it washes out to white.
const VORTEX_FS = `
uniform float uTime;
uniform float uGain;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColC;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float arms = sin(a * 3.0 + log(r + 0.04) * 5.5 - uTime * 3.2);
  float arms2 = sin(a * 5.0 - log(r + 0.04) * 3.0 + uTime * 1.7);
  float band = smoothstep(-0.2, 0.9, arms) * 0.75 + smoothstep(0.3, 1.0, arms2) * 0.35;
  vec3 col = mix(uColC, uColB, band);
  col = mix(col, uColA, smoothstep(0.55, 0.0, r) * 0.9);
  col += vec3(1.0) * pow(max(0.0, 1.0 - r * 2.4), 2.0);
  float edge = smoothstep(1.0, 0.82, r);
  float rim = smoothstep(0.78, 0.95, r) * edge;
  col += uColB * rim * 0.8;
  float gain = uGain;
  #ifdef TONE_MAPPING
  gain = 0.75;
  #endif
  gl_FragColor = vec4(col * edge * gain, edge);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function vortexMaterial(colA, colB, colC) {
  const key = `${C(colA).getHexString()}${C(colB).getHexString()}${C(colC).getHexString()}`;
  let m = VORTEX_MATS.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      uniforms: { uTime: TIME, uGain: { value: GLOW.portal }, uColA: { value: C(colA) }, uColB: { value: C(colB) }, uColC: { value: C(colC) } },
      vertexShader: VORTEX_VS,
      fragmentShader: VORTEX_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    m.name = `building-vortex-${key}`;
    // additive and no depth writes: the faces add up in any order, so one pass draws what three.js's two-pass
    // back-then-front draw of a transparent double-sided material does, without its extra draw and its two program lookups a frame
    m.forceSinglePass = true;
    VORTEX_MATS.set(key, m);
  }
  return m;
}
