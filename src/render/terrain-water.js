// Lake surface for the terrain (DESIGN 8): one flat mesh at WATER_LEVEL over every
// cell of the ground field that dips below it (ground-field.js), with the per-vertex
// depth (water level − ground height) interpolating to the exact depth of the ground
// under every pixel, so the shader has a precise shoreline without reading the depth
// buffer:
//
//   - animated normals: two scrolling ripple layers (fx texture slopes) on a few
//     analytic swells, calmer in the shallows;
//   - depth color: pale aqua over the sand shelf, clear teal further out, a deep
//     blue-green in the middle, and an opacity that follows (the bed shows through
//     the shallows);
//   - Fresnel reflection of the sky the Lighting thread keeps (zenith, horizon, with
//     the drifting clouds mirrored in it), lit by the key light, which is the sun by
//     day and the moon at night;
//   - sun (or moon) glints: a soft sheen on the swells and sparkles from a fine,
//     fast-moving ripple normal, strong enough to bloom;
//   - soft foam: a lace line along the shore and washes rolling in over the shallows;
//   - at night a cyan glow rises out of the water (uNight), strongest over the
//     shallows and in the foam, so lakes never go flat and black.
//
// Output is premultiplied (reflections add light, the body absorbs what is behind),
// linear in the HDR target and tone mapped on the low path; the fog of war goes
// through fowApply like every other world material.
import * as THREE from 'three';
import { FOW_UNIFORMS, FOW_PARS_FRAGMENT } from './fog.js';
import { WORLD_UNIFORMS } from './shading.js';
import { WATER_LEVEL, FIELD_RES, groundField } from './ground-field.js';

export { WATER_LEVEL };

const lin = (hex) => new THREE.Color(hex); // sRGB hex → linear working space

// The Lighting thread's shared uniforms (shading.js WORLD_UNIFORMS) are read by
// reference so the lake follows the time of day. Builds without them (older
// shading.js) get fixed stand-ins with the same shape, tuned to a clear noon.
const STAND_IN = {};
function shared(name, make) {
  const u = WORLD_UNIFORMS[name];
  if (u) return u;
  return STAND_IN[name] || (STAND_IN[name] = { value: make() });
}

const WATER_VS = /* glsl */ `
attribute float aDepth;
varying float vDepth;
varying vec3 vWPos;
#include <common>
#include <fog_pars_vertex>
void main() {
  vDepth = aDepth;
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vWPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WATER_FS = /* glsl */ `
uniform float uTime;
uniform sampler2D uFx;
uniform sampler2D uNoise;
uniform sampler2D uCloudTex;
uniform vec4 uCloud;
uniform vec3 uSunDirW;
uniform vec3 uSunColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyAmbient;
uniform float uNight;
uniform vec3 uShallow;
uniform vec3 uMid;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec3 uGlow;
varying float vDepth;
varying vec3 vWPos;
#include <common>
#include <fog_pars_fragment>
${FOW_PARS_FRAGMENT.replace('varying vec2 vFowXZ;', '')}

// broad swells: analytic slope of a few long sine trains (direction, wavelength, speed)
vec2 swell( vec2 p, float t ) {
  vec2 s = vec2( 0.0 );
  vec2 d1 = vec2( 0.8, 0.6 );
  vec2 d2 = vec2( -0.45, 0.9 );
  vec2 d3 = vec2( 0.96, -0.28 );
  s += d1 * cos( dot( d1, p ) * 1.9 + t * 1.15 ) * 0.035;
  s += d2 * cos( dot( d2, p ) * 2.7 - t * 1.4 ) * 0.025;
  s += d3 * cos( dot( d3, p ) * 4.3 + t * 2.1 ) * 0.015;
  return s;
}

void main() {
  if ( vDepth < -0.06 ) discard; // over dry ground (hidden by it anyway)
  vec2 p = vWPos.xz;
  float t = uTime;
  // The contour of the ground at the water level is smooth, but a noisy margin in the
  // shallows still breaks up the cell-sized kinks of the interpolated depth and gives
  // a living, lapping shoreline.
  float nz = texture2D( uNoise, p * 0.23 ).b;
  float depth = vDepth - 0.06 * ( nz - 0.35 ) - 0.012 * sin( t * 1.1 + p.x * 0.8 + p.y * 0.6 );
  float calm = 0.35 + 0.65 * smoothstep( 0.0, 0.14, depth );

  // ---- surface normal
  vec2 slope = ( texture2D( uFx, p * 0.19 + vec2( t * 0.027, t * 0.016 ) ).rg - 0.5 ) * 0.3;
  #ifdef WATER_HQ
    slope += ( texture2D( uFx, p * vec2( 0.31, 0.29 ) + vec2( - t * 0.021, t * 0.033 ) + 0.41 ).gr - 0.5 ) * 0.22;
  #endif
  slope = slope * calm + swell( p, t ) * calm;
  vec3 N = normalize( vec3( - slope.x, 1.0, - slope.y ) );
  vec3 V = normalize( cameraPosition - vWPos );
  float NdV = saturate( dot( N, V ) );

  // ---- light: the key light (sun by day, moon at night) and the sky
  vec3 L = normalize( uSunDirW );
  float sunI = dot( uSunColor, vec3( 0.2126, 0.7152, 0.0722 ) );
  float ambI = dot( uSkyAmbient, vec3( 0.2126, 0.7152, 0.0722 ) );
  // 1 at a clear noon (ambient about 0.4, sun about 2.5), falling toward dusk and night
  float lightK = saturate( ( ambI + 0.09 * sunI ) / 0.62 );

  // ---- cloud shade (the same drifting clouds that shade the ground)
  float shade = 1.0;
  vec2 cp = ( p - L.xz * ( vWPos.y / max( L.y, 0.2 ) ) ) * uCloud.y + uCloud.zw * t * uCloud.y;
  if ( uCloud.x > 0.0 ) {
    float n = texture2D( uCloudTex, cp ).r;
    shade = 1.0 - uCloud.x * smoothstep( 0.58, 0.72, n ); // as cloudShade (shading.js)
  }

  // ---- body: absorption deepens the color and the opacity with depth
  float dd = 1.0 - exp( - max( depth, 0.0 ) * 3.4 );
  vec3 body = mix( uShallow, uMid, smoothstep( 0.0, 0.5, dd ) );
  body = mix( body, uDeep, smoothstep( 0.4, 0.95, dd ) );
  // lit by the sky and, a little, by the sun that gets in under the surface
  body *= lightK * ( 0.62 + 0.38 * shade );
  float alpha = mix( 0.3, 0.95, smoothstep( 0.0, 0.7, dd ) );
  // refraction-like wobble: the ripples tilt how much of the bed shows through
  alpha = saturate( alpha + ( slope.x - slope.y ) * 0.6 * dd );

  // ---- reflection: Fresnel (a little lifted so the sky reads from above)
  vec3 R = reflect( - V, N );
  float ry = saturate( R.y );
  vec3 sky = mix( uSkyHorizon, uSkyZenith, pow( ry, 0.55 ) );
  #ifdef WATER_HQ
    // clouds mirrored in the water drift with the ones overhead
    vec2 rc = ( p + R.xz / max( R.y, 0.2 ) * 8.0 ) * uCloud.y * 1.3 + uCloud.zw * t * uCloud.y;
    float cl = texture2D( uCloudTex, rc ).r;
    sky = mix( sky, uSkyHorizon * 1.25, smoothstep( 0.48, 0.72, cl ) * 0.55 );
  #endif
  float F = 0.03 + 0.97 * pow( 1.0 - NdV, 5.0 );
  F = min( 1.0, F * 1.9 + 0.04 );
  vec3 refl = sky * F;

  // ---- key light: a soft sheen on the swells, sparkles from a fine, fast ripple normal. The
  // glints are laid out as if the light stood across the lake from the camera (its height and
  // its east-west drift are the key light's, so they travel with the sun) so they show from
  // this high, one-sided view at any time of day, as the sun's own reflection would not
  vec3 Lg = normalize( vec3( L.x, L.y, - abs( L.z ) * 0.8 ) );
  vec3 H = normalize( Lg + V );
  float sheen = pow( saturate( dot( N, H ) ), 20.0 ) * 0.1;
  vec2 fine = ( texture2D( uFx, p * vec2( 0.83, 0.79 ) + vec2( t * 0.07, - t * 0.05 ) ).gr - 0.5 ) * 0.95;
  #ifdef WATER_HQ
    fine += ( texture2D( uFx, p * vec2( 1.37, 1.31 ) + vec2( - t * 0.06, - t * 0.09 ) + 0.27 ).rg - 0.5 ) * 0.7;
  #endif
  vec3 Nf = normalize( vec3( - ( slope.x * 4.0 + fine.x ), 1.0, - ( slope.y * 4.0 + fine.y ) ) );
  float spark = pow( saturate( dot( Nf, H ) ), 260.0 );
  // twinkle: sparkles come and go with a fast-moving noise
  spark *= smoothstep( 0.35, 0.75, texture2D( uFx, p * 0.61 + vec2( t * 0.13, - t * 0.09 ) ).a );
  vec3 sunTint = uSunColor / max( max( uSunColor.r, uSunColor.g ), max( uSunColor.b, 1e-3 ) );
  float sunPow = clamp( sqrt( sunI / 2.5 ), 0.0, 1.4 );
  vec3 sun = sunTint * ( spark * 26.0 + sheen * 2.0 ) * sunPow * shade * calm;

  // ---- foam: a lapping lace line at the shore and bands rolling in over the shallows
  float fn = texture2D( uFx, p * 0.45 + vec2( t * 0.02, - t * 0.015 ) ).a;
  float fn2 = texture2D( uFx, p * 1.1 + vec2( - t * 0.03, t * 0.02 ) ).a;
  float edge = 1.0 - smoothstep( 0.0, 0.03 + 0.016 * sin( t * 1.3 + p.x * 0.7 + p.y * 0.5 ), depth );
  float lace = smoothstep( 0.2, 0.62, fn + 0.3 * edge + 0.18 * ( fn2 - 0.5 ) );
  float phase = depth * 18.0 + t * 0.5 + fn * 1.4;
  float band = smoothstep( 0.7, 0.86, fract( phase ) ) * ( 1.0 - smoothstep( 0.86, 1.0, fract( phase ) ) );
  band *= ( 1.0 - smoothstep( 0.04, 0.17, depth ) ) * smoothstep( 0.32, 0.6, fn );
  float foam = saturate( edge * lace + band * 0.45 );
  // a faint shadow just behind each band reads as a wave lip
  alpha = saturate( alpha + band * 0.1 );

  // ---- night glow: cool cyan rising out of the water, most over the shallows and in the foam
  vec3 glow = uGlow * uNight * ( 0.55 + 0.45 * ( 1.0 - dd ) ) * ( 0.8 + 0.4 * ( fn - 0.5 ) + 2.0 * length( slope ) );

  vec3 col = body * alpha + refl + sun + glow * alpha; // premultiplied
  vec3 foamLit = uFoam * ( 0.35 + 0.65 * lightK ) * ( 0.6 + 0.4 * shade ) + uGlow * uNight * 0.9;
  col = mix( col, foamLit, foam );
  alpha = mix( alpha, 1.0, foam );
  // thin out over the noisy margin (premultiplied: color and alpha together)
  float fade = smoothstep( -0.01, 0.004, depth );
  col *= fade;
  alpha *= fade;
  if ( alpha < 0.004 ) discard; // nothing to show

  // straight color for the tone map / color space / fog / fog-of-war chunks,
  // premultiplied again at the end (premultiplied_alpha_fragment)
  gl_FragColor = vec4( col / max( alpha, 1e-3 ), alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  gl_FragColor.rgb = fowApply( gl_FragColor.rgb, p );
  #include <premultiplied_alpha_fragment>
}`;

/**
 * Water surface over every cell of the ground field that dips below the water
 * level (a small margin of dry cells too, where the shoreline fades out).
 * @param {object} map mapData
 * @param {object} o
 * @param {THREE.Texture} o.fx ripple / foam texture (terrain-textures.js)
 * @param {THREE.Texture} o.noise tileable fbm noise texture (terrain-textures.js)
 * @param {{ value: number }} [o.time] clock uniform (seconds), driven by the owner
 * @param {boolean} [o.hq] a second ripple layer and cloud reflections
 * @param {import('./ground-field.js').GroundField} [o.field] the ground field (default: the map's)
 * @returns {THREE.Mesh|null}
 */
export function buildWater(map, { fx, noise, time = { value: 0 }, hq = true, field = groundField(map) } = {}) {
  if (!field) return null;
  const nx = field.nx;
  const ny = field.ny;
  const R = FIELD_RES;
  const cw = nx - 1;
  const ch = ny - 1;
  const hgt = field.hgt;
  const margin = WATER_LEVEL + 0.06;
  const vertOf = new Int32Array(nx * ny).fill(-1);
  const pos = [];
  const depth = [];
  const idx = [];
  const vert = (i, j) => {
    const k = j * nx + i;
    if (vertOf[k] < 0) {
      vertOf[k] = pos.length / 3;
      pos.push(i / R, WATER_LEVEL, j / R);
      depth.push(WATER_LEVEL - hgt[k]);
    }
    return vertOf[k];
  };
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      const k = j * nx + i;
      if (Math.min(hgt[k], hgt[k + 1], hgt[k + nx], hgt[k + nx + 1]) > margin) continue;
      const tl = vert(i, j);
      const tr = vert(i + 1, j);
      const bl = vert(i, j + 1);
      const br = vert(i + 1, j + 1);
      // counter-clockwise from above
      if ((i + j) & 1) idx.push(tl, bl, br, tl, br, tr);
      else idx.push(tl, bl, tr, tr, bl, br);
    }
  }
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uShallow: { value: lin('#38cdb9') },
    uMid: { value: lin('#119097') },
    uDeep: { value: lin('#07506c') },
    uFoam: { value: lin('#f1f9f6') },
    uGlow: { value: lin('#1ec8e0') },
  }]);
  // shared uniforms by reference: no per-material updates
  uniforms.uTime = time;
  uniforms.uCloudTex = WORLD_UNIFORMS.uCloudTex;
  uniforms.uCloud = WORLD_UNIFORMS.uCloud;
  uniforms.uSunDirW = WORLD_UNIFORMS.uSunDirW;
  uniforms.uSunColor = shared('uSunColor', () => new THREE.Color(0xffe4bd).multiplyScalar(3));
  uniforms.uSkyZenith = shared('uSkyZenith', () => lin('#5d8fd0'));
  uniforms.uSkyHorizon = shared('uSkyHorizon', () => lin('#cfdbe6'));
  uniforms.uSkyAmbient = shared('uSkyAmbient', () => new THREE.Color(0xbccff2).multiplyScalar(0.68));
  uniforms.uNight = shared('uNight', () => 0);
  uniforms.uFx = { value: fx };
  uniforms.uNoise = { value: noise };
  uniforms.uFowTex = FOW_UNIFORMS.uFowTex;
  uniforms.uFowSize = FOW_UNIFORMS.uFowSize;
  uniforms.uFowPow = FOW_UNIFORMS.uFowPow;
  uniforms.uFowNoise = FOW_UNIFORMS.uFowNoise;
  uniforms.uFowTime = FOW_UNIFORMS.uFowTime;
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: WATER_VS,
    fragmentShader: WATER_FS,
    transparent: true,
    premultipliedAlpha: true,
    // no depth writes: selection rings, blob shadows, markers and ground spell
    // effects of units at the shore (whose ground dips below the water level)
    // depth-test against the ground and stay whole
    depthWrite: false,
    fog: true,
  });
  mat.name = 'water';
  setWaterQuality(mat, hq);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'water';
  mesh.renderOrder = 1;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

/** Switch the water shader's detail (recompiles once). */
export function setWaterQuality(mat, hq) {
  const want = !!hq;
  const has = !!mat.defines && 'WATER_HQ' in mat.defines;
  if (want === has && mat.defines) return;
  mat.defines = want ? { WATER_HQ: '' } : {};
  mat.needsUpdate = true;
}
