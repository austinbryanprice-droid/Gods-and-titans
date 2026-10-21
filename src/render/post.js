// Post-processing for the game view (DESIGN 8): the world is drawn into a
// multisampled half-float (HDR) target, then a few full-screen passes add
// screen-space ambient occlusion (depth only, half resolution, bilateral blur),
// bloom (soft-threshold prefilter + dual-filter down/up chain) and one final
// composite: AO, bloom, a glow haze over the far part of the picture, exposure,
// Khronos PBR Neutral tone mapping, color grading (contrast, saturation, warm
// highlights / cool shadows), vignette, optional sharpening when the scene is
// upscaled, sRGB encoding and dithering.
// The composite also copies the scene depth into the canvas' depth buffer
// (gl_FragDepth), so overlays drawn afterwards straight to the canvas (health
// bars, selection rings, markers) keep their exact colors yet are still hidden
// behind the units and buildings in front of them.
//
//   const post = new PostFX(webglRenderer, 'high');
//   post.setSize(drawingBufferWidth, drawingBufferHeight, nowMs);
//   post.render(scene, camera, overlayScene, nowMs);   // whole frame
//   post.setQuality('medium'); post.setRenderScale(0.8); post.dispose();
//
// Everything is plain three.js (render targets + ShaderMaterials on one
// full-screen triangle); nothing allocates per frame.
import * as THREE from 'three';

/** Per quality: MSAA samples, bloom chain length, AO taps (0 = off). Low draws without post. */
export const POST_QUALITY = {
  low: null,
  medium: { samples: 4, bloomLevels: 5, aoTaps: 0 },
  high: { samples: 4, bloomLevels: 6, aoTaps: 10 },
  ultra: { samples: 4, bloomLevels: 6, aoTaps: 16 },
};

/**
 * A changed canvas size reallocates the targets only after it has held still this
 * long (ms): dragging a window edge fires a resize event per frame, and every
 * reallocation frees and rebuilds the multisampled HDR, bloom and AO targets.
 */
export const RESIZE_SETTLE_MS = 120;

/** Look of the final image; tweakable live through `post.look`. */
export const DEFAULT_LOOK = {
  exposure: 1.0,
  bloomStrength: 0.55,
  bloomThreshold: 0.92, // linear luminance where bloom starts (soft knee below)
  bloomKnee: 0.45,
  bloomRadius: 0.82, // 0 tight … 1 wide
  aoStrength: 0.85,
  aoRadius: 0.75, // world units
  aoBias: 0.025,
  aoFloor: -1e6, // world height below which AO fades out (the water surface)
  contrast: 1.1,
  saturation: 1.04,
  shadowTint: [0.93, 0.98, 1.08], // multiplied in, weighted to the dark end
  highlightTint: [1.07, 1.01, 0.9], // … and the bright end
  vignette: 0.34,
  glow: 0, // a luminous haze over the far (upper) part of the picture, in glowColor (linear): the sky's glow
  glowColor: [1, 1, 1],
  sharpen: 0.35, // only when the scene renders below the canvas resolution
};

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

const COMMON = /* glsl */ `
float luma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
`;

// --------------------------------------------------------------------------- bloom

const PREFILTER_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel; // source texel size
uniform vec4 uThreshold; // threshold, threshold - knee, 2 * knee, 0.25 / knee
varying vec2 vUv;
${COMMON}
vec3 soft( vec3 c ) {
  float br = max( c.r, max( c.g, c.b ) );
  float rq = clamp( br - uThreshold.y, 0.0, uThreshold.z );
  rq = uThreshold.w * rq * rq;
  return c * max( rq, br - uThreshold.x ) / max( br, 1e-4 );
}
// One tap, capped before the weighting: an overflowed (Inf) texel would turn into NaN
// there and spread through the whole bloom chain as a block. NaN fails >= and is dropped.
vec3 tap( vec2 uv ) {
  vec3 c = texture2D( tSrc, uv ).rgb;
  return ( c.r >= 0.0 && c.g >= 0.0 && c.b >= 0.0 ) ? min( c, vec3( 64.0 ) ) : vec3( 0.0 );
}
void main() {
  // 4 bilinear taps = a 4x4 box; Karis-weighted so single hot pixels do not flicker
  vec3 a = tap( vUv + uTexel * vec2( -1.0, -1.0 ) );
  vec3 b = tap( vUv + uTexel * vec2( 1.0, -1.0 ) );
  vec3 c = tap( vUv + uTexel * vec2( -1.0, 1.0 ) );
  vec3 d = tap( vUv + uTexel * vec2( 1.0, 1.0 ) );
  float wa = 1.0 / ( 1.0 + luma( a ) );
  float wb = 1.0 / ( 1.0 + luma( b ) );
  float wc = 1.0 / ( 1.0 + luma( c ) );
  float wd = 1.0 / ( 1.0 + luma( d ) );
  vec3 col = ( a * wa + b * wb + c * wc + d * wd ) / ( wa + wb + wc + wd );
  gl_FragColor = vec4( soft( col ), 1.0 );
}`;

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  // dual-filter downsample: center x4 + four diagonal bilinear taps
  vec3 s = texture2D( tSrc, vUv ).rgb * 4.0;
  s += texture2D( tSrc, vUv + uTexel * vec2( -1.0, -1.0 ) ).rgb;
  s += texture2D( tSrc, vUv + uTexel * vec2( 1.0, -1.0 ) ).rgb;
  s += texture2D( tSrc, vUv + uTexel * vec2( -1.0, 1.0 ) ).rgb;
  s += texture2D( tSrc, vUv + uTexel * vec2( 1.0, 1.0 ) ).rgb;
  gl_FragColor = vec4( s * 0.125, 1.0 );
}`;

const UP_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uWeight;
varying vec2 vUv;
void main() {
  // dual-filter upsample (tent), added onto the level below by blending
  vec2 t = uTexel;
  vec3 s = texture2D( tSrc, vUv + vec2( -2.0 * t.x, 0.0 ) ).rgb;
  s += texture2D( tSrc, vUv + vec2( -t.x, t.y ) ).rgb * 2.0;
  s += texture2D( tSrc, vUv + vec2( 0.0, 2.0 * t.y ) ).rgb;
  s += texture2D( tSrc, vUv + vec2( t.x, t.y ) ).rgb * 2.0;
  s += texture2D( tSrc, vUv + vec2( 2.0 * t.x, 0.0 ) ).rgb;
  s += texture2D( tSrc, vUv + vec2( t.x, -t.y ) ).rgb * 2.0;
  s += texture2D( tSrc, vUv + vec2( 0.0, -2.0 * t.y ) ).rgb;
  s += texture2D( tSrc, vUv + vec2( -t.x, -t.y ) ).rgb * 2.0;
  gl_FragColor = vec4( s * ( uWeight / 12.0 ), 1.0 );
}`;

// --------------------------------------------------------------------------- ambient occlusion

const AO_FRAG = /* glsl */ `
uniform sampler2D tDepth;
uniform vec2 uDepthTexel; // full-resolution texel
uniform mat4 uProjInv;
uniform vec4 uProj; // P[0][0], P[1][1], radius, bias
uniform mat4 uViewInv;
uniform vec2 uFloor; // world height below which the occlusion fades out, fade width
varying vec2 vUv;

vec3 viewPos( vec2 uv ) {
  // snap to the depth texel's center so the position matches the depth it was read from
  // (half-resolution pixels sit on full-resolution texel edges; mixing them draws stripes)
  uv = ( floor( uv / uDepthTexel ) + 0.5 ) * uDepthTexel;
  float d = texture2D( tDepth, uv ).r;
  vec4 p = uProjInv * vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 );
  return p.xyz / p.w;
}
float ign( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }

void main() {
  float d0 = texture2D( tDepth, vUv ).r;
  if ( d0 >= 1.0 ) { gl_FragColor = vec4( 1.0 ); return; }
  vec2 uv0 = ( floor( vUv / uDepthTexel ) + 0.5 ) * uDepthTexel;
  vec3 P = viewPos( uv0 );
  // normal from the smaller of the two depth differences on each axis (no halos at silhouettes)
  vec3 l = viewPos( uv0 - vec2( uDepthTexel.x, 0.0 ) );
  vec3 r = viewPos( uv0 + vec2( uDepthTexel.x, 0.0 ) );
  vec3 b = viewPos( uv0 - vec2( 0.0, uDepthTexel.y ) );
  vec3 t = viewPos( uv0 + vec2( 0.0, uDepthTexel.y ) );
  vec3 dx = abs( r.z - P.z ) < abs( P.z - l.z ) ? r - P : P - l;
  vec3 dy = abs( t.z - P.z ) < abs( P.z - b.z ) ? t - P : P - b;
  vec3 N = normalize( cross( dx, dy ) );
  float radius = uProj.z;
  // projected radius in uv units
  float rs = radius * uProj.y * 0.5 / max( -P.z, 0.1 );
  rs = min( rs, 0.12 );
  float occ = 0.0;
  float phi = ign( gl_FragCoord.xy ) * 6.2831853;
  float r2 = radius * radius;
  for ( int i = 0; i < AO_TAPS; i ++ ) {
    float fi = ( float( i ) + 0.5 ) / float( AO_TAPS );
    float a = fi * 6.2831853 * 2.6180339 + phi; // 7 spiral turns, golden-ish spacing
    float rr = fi * fi; // denser near the center
    vec2 o = vec2( cos( a ), sin( a ) ) * rs * mix( 0.12, 1.0, rr );
    vec3 v = viewPos( uv0 + o ) - P;
    float vv = dot( v, v );
    float vn = dot( v, N );
    float f = max( r2 - vv, 0.0 ) / r2;
    // angle bias: samples only a few degrees above the tangent plane (depth steps on
    // flat ground seen at a grazing angle) do not occlude
    occ += f * f * max( vn - 0.12 * sqrt( vv ) - uProj.w * -P.z * 0.02, 0.0 ) / ( vv + 0.01 );
  }
  occ = clamp( occ * ( 2.4 / float( AO_TAPS ) ), 0.0, 1.0 );
  // no occlusion under the water surface (the lake bed shows through transparent water)
  float wy = ( uViewInv * vec4( P, 1.0 ) ).y;
  occ *= smoothstep( uFloor.x - uFloor.y, uFloor.x, wy );
  occ = 1.0 - occ;
  gl_FragColor = vec4( occ, occ, occ, 1.0 );
}`;

const AO_BLUR_FRAG = /* glsl */ `
uniform sampler2D tAO;
uniform sampler2D tDepth;
uniform vec2 uDir; // texel step on the AO target
uniform vec2 uNearFar;
varying vec2 vUv;
float linDepth( vec2 uv ) {
  float d = texture2D( tDepth, uv ).r * 2.0 - 1.0;
  return 2.0 * uNearFar.x * uNearFar.y / ( uNearFar.y + uNearFar.x - d * ( uNearFar.y - uNearFar.x ) );
}
void main() {
  float z0 = linDepth( vUv );
  float sum = 0.0;
  float wsum = 0.0;
  for ( int i = -4; i <= 4; i ++ ) {
    vec2 uv = vUv + uDir * float( i );
    float z = linDepth( uv );
    float w = exp( -float( i * i ) * 0.12 ) * max( 0.0, 1.0 - abs( z - z0 ) / ( 0.04 * z0 + 0.05 ) );
    sum += texture2D( tAO, uv ).r * w;
    wsum += w;
  }
  float ao = wsum > 0.0 ? sum / wsum : 1.0;
  gl_FragColor = vec4( ao, ao, ao, 1.0 );
}`;

// --------------------------------------------------------------------------- composite

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tBloom;
uniform sampler2D tAO;
uniform vec2 uSceneTexel;
uniform float uExposure;
uniform float uBloomStrength;
uniform float uAOStrength;
uniform float uContrast;
uniform float uSaturation;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uVignette;
uniform float uGlow;
uniform vec3 uGlowColor;
uniform float uSharpen;
uniform vec2 uAspect;
varying vec2 vUv;
${COMMON}

vec3 neutral( vec3 color ) {
  const float StartCompression = 0.8 - 0.04;
  const float Desaturation = 0.15;
  float x = min( color.r, min( color.g, color.b ) );
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max( color.r, max( color.g, color.b ) );
  if ( peak < StartCompression ) return color;
  float d = 1. - StartCompression;
  float newPeak = 1. - d * d / ( peak + d - StartCompression );
  color *= newPeak / peak;
  float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
  // very bright warm light (fire, explosions) burns through yellow to white like a flame,
  // instead of fading to peach
  float warm = smoothstep( 0.5, 0.95, ( color.r - color.b ) / max( color.r, 1e-4 ) );
  return mix( color, newPeak * mix( vec3( 1.0 ), vec3( 1.0, 0.78, 0.38 ), warm ), g );
}
vec3 toSRGB( vec3 c ) {
  return mix( pow( c, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), c * 12.92, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) );
}
float rand( vec2 co ) { return fract( sin( dot( co, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }

void main() {
  vec3 col = texture2D( tScene, vUv ).rgb;
  // only while the scene is drawn below the canvas size (a uniform, not a define, so
  // adaptive resolution never compiles a new program mid-match)
  if ( uSharpen > 0.0 ) {
    vec3 n = texture2D( tScene, vUv + vec2( 0.0, uSceneTexel.y ) ).rgb + texture2D( tScene, vUv - vec2( 0.0, uSceneTexel.y ) ).rgb
      + texture2D( tScene, vUv + vec2( uSceneTexel.x, 0.0 ) ).rgb + texture2D( tScene, vUv - vec2( uSceneTexel.x, 0.0 ) ).rgb;
    col = max( col + ( col * 4.0 - n ) * ( uSharpen * 0.25 ), vec3( 0.0 ) );
  }
  #ifdef USE_AO
    float ao = texture2D( tAO, vUv ).r;
    // glows and lit sky-facing highlights keep most of their brightness
    ao = mix( ao, 1.0, smoothstep( 1.0, 3.0, luma( col ) ) );
    col *= mix( 1.0, ao, uAOStrength );
  #endif
  #ifdef USE_BLOOM
    col += texture2D( tBloom, vUv ).rgb * uBloomStrength;
  #endif
  // the far part of the picture sits in a luminous haze, tinted by the sky at the horizon;
  // the black of unexplored land stays black
  if ( uGlow > 0.0 ) col += uGlowColor * ( uGlow * vUv.y * vUv.y * vUv.y ) * min( 1.0, luma( col ) * 4.0 );
  col *= uExposure;
  col = neutral( col );
  // grade in a perceptual-ish space
  float l = luma( col );
  col = mix( vec3( l ), col, uSaturation );
  // studio grade: tame acid lime greens toward olive and push the rest of the
  // palette apart, so foliage reads painterly instead of toy-like
  float lime = clamp( ( col.g - max( col.r, col.b ) ) / max( col.g, 1e-3 ), 0.0, 1.0 );
  col = mix( col, vec3( col.g * 0.86, col.g * 0.9, col.g * 0.5 ) * 0.5 + col * 0.5, lime * 0.55 );
  float w = smoothstep( 0.0, 0.6, l );
  col *= mix( uShadowTint, uHighlightTint, w );
  col = max( col, vec3( 0.0 ) );
  vec3 g = toSRGB( col );
  g = clamp( ( g - 0.5 ) * uContrast + 0.5, 0.0, 1.0 );
  // vignette: darker corners, a little more at the top (the far edge of the view)
  vec2 p = ( vUv - 0.5 ) * uAspect;
  float v = dot( p, p ) + max( 0.0, vUv.y - 0.55 ) * 0.25;
  g *= 1.0 - uVignette * smoothstep( 0.18, 0.95, v );
  // dither away 8-bit banding (fog gradients, vignette)
  g += ( rand( gl_FragCoord.xy ) - 0.5 ) / 255.0;
  gl_FragColor = vec4( g, 1.0 );
  gl_FragDepth = texture2D( tDepth, vUv ).r;
}`;

function fullscreenTriangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  return g;
}

function passMaterial(fragmentShader, uniforms, defines = {}) {
  const m = new THREE.ShaderMaterial({
    vertexShader: FS_VERT,
    fragmentShader,
    uniforms,
    defines,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  return m;
}

function colorTarget(w, h, type, name) {
  const rt = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  rt.texture.name = name;
  return rt;
}

/** Whether the renderer can draw into half-float targets (WebGL2 + EXT_color_buffer_float). */
function supportsHalfFloat(renderer) {
  try {
    const ext = renderer.extensions;
    return !!(ext && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float')));
  } catch {
    return false;
  }
}

/** Most MSAA samples an R11F_G11F_B10F render target can have (0 = not renderable). */
function r11fSamples(renderer) {
  try {
    const gl = typeof renderer.getContext === 'function' ? renderer.getContext() : null;
    if (!gl || typeof gl.getInternalformatParameter !== 'function' || !renderer.extensions.has('EXT_color_buffer_float')) return 0;
    const s = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.R11F_G11F_B10F, gl.SAMPLES);
    return s && s.length ? s[0] : 0;
  } catch {
    return 0;
  }
}

export class PostFX {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {'low'|'medium'|'high'|'ultra'} quality
   */
  constructor(renderer, quality = 'medium') {
    this.renderer = renderer;
    this.look = { ...DEFAULT_LOOK, shadowTint: [...DEFAULT_LOOK.shadowTint], highlightTint: [...DEFAULT_LOOK.highlightTint], glowColor: [...DEFAULT_LOOK.glowColor] };
    this.width = 1; // the canvas size the targets are allocated for
    this.height = 1;
    this.canvasW = 1; // the canvas size asked for last; differs from width while a resize is held back
    this.canvasH = 1;
    this.sizeAt = 0; // ms timestamp of the last change of canvasW / canvasH
    this.sized = false; // true once setSize has been called
    this.renderScale = 1;
    this.hdr = supportsHalfFloat(renderer);
    this.type = this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    // The scene target as R11F_G11F_B10F: half the bytes of RGBA16F per MSAA sample
    // (nothing reads its alpha). Needs EXT_color_buffer_float (the half-float extension
    // does not make it renderable) and multisampling in that format.
    this.r11Samples = this.hdr ? r11fSamples(renderer) : 0;
    const caps = renderer.capabilities || {};
    this.maxSamples = caps.maxSamples || 0;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.tri = new THREE.Mesh(fullscreenTriangle(), null);
    this.tri.frustumCulled = false;
    this.targets = [];
    this.bloomDown = [];
    this.scene = null;
    this.aoRaw = null;
    this.aoTmp = null;
    this.projInv = new THREE.Matrix4();

    this.prefilter = passMaterial(PREFILTER_FRAG, {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uThreshold: { value: new THREE.Vector4() },
    });
    this.down = passMaterial(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.up = passMaterial(UP_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } });
    this.up.blending = THREE.CustomBlending;
    this.up.blendEquation = THREE.AddEquation;
    this.up.blendSrc = THREE.OneFactor;
    this.up.blendDst = THREE.OneFactor;
    this.up.transparent = true;
    this.aoBlur = passMaterial(AO_BLUR_FRAG, {
      tAO: { value: null },
      tDepth: { value: null },
      uDir: { value: new THREE.Vector2() },
      uNearFar: { value: new THREE.Vector2(0.5, 400) },
    });
    this.aoMat = null; // built per tap count
    this.composite = null; // built per feature set
    this.setQuality(quality);
  }

  /** True when this quality draws through the pipeline (false on low). */
  get enabled() {
    return !!this.cfg;
  }

  setQuality(q) {
    const cfg = POST_QUALITY[q] === undefined ? POST_QUALITY.medium : POST_QUALITY[q];
    this.quality = q;
    this.cfg = cfg;
    if (!cfg) {
      this.freeTargets();
      return;
    }
    const samples = this.hdr || this.maxSamples ? Math.min(cfg.samples, this.maxSamples || cfg.samples) : 0;
    this.samples = samples;
    this.bloomLevels = cfg.bloomLevels;
    if (cfg.aoTaps && (!this.aoMat || this.aoMat.defines.AO_TAPS !== cfg.aoTaps)) {
      if (this.aoMat) this.aoMat.dispose();
      this.aoMat = passMaterial(AO_FRAG, {
        tDepth: { value: null },
        uDepthTexel: { value: new THREE.Vector2() },
        uProjInv: { value: this.projInv },
        uProj: { value: new THREE.Vector4() },
        uViewInv: { value: new THREE.Matrix4() },
        uFloor: { value: new THREE.Vector2(-1e6, 0.25) },
      }, { AO_TAPS: cfg.aoTaps });
    }
    this.buildComposite();
    this.adoptSize();
    this.freeTargets();
    this.allocate();
  }

  buildComposite() {
    const defines = { USE_BLOOM: '' };
    if (this.cfg && this.cfg.aoTaps) defines.USE_AO = '';
    const key = Object.keys(defines).sort().join(',');
    if (this.composite && this.compositeKey === key) return;
    if (this.composite) this.composite.dispose();
    this.compositeKey = key;
    this.composite = passMaterial(COMPOSITE_FRAG, {
      tScene: { value: null },
      tDepth: { value: null },
      tBloom: { value: null },
      tAO: { value: null },
      uSceneTexel: { value: new THREE.Vector2() },
      uExposure: { value: 1 },
      uBloomStrength: { value: 0.5 },
      uAOStrength: { value: 0.8 },
      uContrast: { value: 1 },
      uSaturation: { value: 1 },
      uShadowTint: { value: new THREE.Vector3(1, 1, 1) },
      uHighlightTint: { value: new THREE.Vector3(1, 1, 1) },
      uVignette: { value: 0 },
      uGlow: { value: 0 },
      uGlowColor: { value: new THREE.Vector3(1, 1, 1) },
      uSharpen: { value: 0 },
      uAspect: { value: new THREE.Vector2(1, 1) },
    }, defines);
    // writes the scene depth into the canvas so overlays depth-test against the world
    this.composite.depthTest = true;
    this.composite.depthWrite = true;
    this.composite.depthFunc = THREE.AlwaysDepth;
  }

  /**
   * Drawing-buffer size of the canvas in device pixels. The first call, and any call
   * without a timestamp, reallocates the targets at once. Otherwise a changed size
   * waits until it has held still for RESIZE_SETTLE_MS (render() or settleSize()
   * then applies it); until then the frame is drawn into the old targets and
   * stretched to the canvas, which keeps the picture's geometry (the camera already
   * has the new aspect) at a briefly lower resolution.
   * @param {number} w
   * @param {number} h
   * @param {number} [t] ms timestamp (same clock as render's)
   */
  setSize(w, h, t) {
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    const changed = w !== this.canvasW || h !== this.canvasH;
    this.canvasW = w;
    this.canvasH = h;
    if (!this.sized || typeof t !== 'number') {
      this.sized = true;
      this.applySize();
    } else if (changed) this.sizeAt = t;
  }

  /** True while a changed canvas size is waiting for the targets to be reallocated. */
  get sizePending() {
    return this.canvasW !== this.width || this.canvasH !== this.height;
  }

  /** Allocate the targets for the latest canvas size from now on. */
  adoptSize() {
    this.width = this.canvasW;
    this.height = this.canvasH;
  }

  applySize() {
    const same = this.canvasW === this.width && this.canvasH === this.height;
    this.adoptSize();
    if (same && this.scene) return;
    this.freeTargets();
    this.allocate();
  }

  /**
   * Reallocate the targets for a held-back size once it has held still for
   * RESIZE_SETTLE_MS (at once without a timestamp).
   * @param {number} [t] ms timestamp
   * @returns {boolean} true if the targets were reallocated
   */
  settleSize(t) {
    if (!this.sizePending) return false;
    if (typeof t === 'number' && t >= this.sizeAt && t - this.sizeAt < RESIZE_SETTLE_MS) return false;
    this.applySize();
    return true;
  }

  /** Scene resolution relative to the canvas (adaptive resolution), 0.5..1. */
  setRenderScale(s) {
    s = Math.max(0.5, Math.min(1, s));
    if (Math.abs(s - this.renderScale) < 0.01) return;
    this.renderScale = s;
    this.adoptSize(); // reallocating anyway: at the latest size
    this.freeTargets();
    this.allocate();
  }

  allocate() {
    if (!this.cfg || this.scene) return;
    const sw = Math.max(1, Math.round(this.width * this.renderScale));
    const sh = Math.max(1, Math.round(this.height * this.renderScale));
    this.sw = sw;
    this.sh = sh;
    const depth = new THREE.DepthTexture(sw, sh);
    depth.type = THREE.UnsignedIntType;
    depth.minFilter = THREE.NearestFilter;
    depth.magFilter = THREE.NearestFilter;
    const r11 = this.r11Samples >= Math.max(1, this.samples);
    this.scene = new THREE.WebGLRenderTarget(sw, sh, {
      type: r11 ? THREE.UnsignedInt101111Type : this.type, // three maps RGB + this type to R11F_G11F_B10F
      format: r11 ? THREE.RGBFormat : THREE.RGBAFormat,
      samples: this.samples,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture: depth,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    this.scene.texture.name = 'post-scene';
    // Without float color buffers the targets are 8-bit: store them sRGB-encoded
    // (SRGB8_ALPHA8: encoded on write, decoded on read and blend) so the dark end of
    // the linear values keeps its precision instead of banding in the fog.
    if (!this.hdr) this.scene.texture.colorSpace = THREE.SRGBColorSpace;
    this.targets.push(this.scene);
    // bloom chain from half resolution down
    let bw = sw;
    let bh = sh;
    for (let i = 0; i < this.bloomLevels; i++) {
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
      const rt = colorTarget(bw, bh, this.type, `post-bloom${i}`);
      if (!this.hdr) rt.texture.colorSpace = THREE.SRGBColorSpace;
      this.bloomDown.push(rt);
      this.targets.push(rt);
      if (bw <= 2 || bh <= 2) break;
    }
    if (this.cfg.aoTaps) {
      const aw = Math.max(1, sw >> 1);
      const ah = Math.max(1, sh >> 1);
      this.aoRaw = colorTarget(aw, ah, THREE.UnsignedByteType, 'post-ao');
      this.aoTmp = colorTarget(aw, ah, THREE.UnsignedByteType, 'post-ao-blur');
      this.targets.push(this.aoRaw, this.aoTmp);
    }
  }

  /** The HDR target the world is drawn into (for compiling programs against it). */
  sceneTarget() {
    if (!this.scene) this.allocate();
    return this.scene;
  }

  freeTargets() {
    for (const rt of this.targets) {
      if (rt.depthTexture) rt.depthTexture.dispose();
      rt.dispose();
    }
    this.targets.length = 0;
    this.bloomDown.length = 0;
    this.scene = null;
    this.aoRaw = null;
    this.aoTmp = null;
  }

  pass(material, target) {
    const r = this.renderer;
    this.tri.material = material;
    r.setRenderTarget(target);
    r.render(this.tri, this.camera);
  }

  /**
   * Draw a frame: the world through the pipeline, then the overlays on top.
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {THREE.Scene} [overlay]
   * @param {number} [t] ms timestamp, to apply a held-back canvas size once it has settled
   */
  render(scene, camera, overlay, t) {
    const r = this.renderer;
    this.settleSize(t);
    if (!this.scene) this.allocate();
    const look = this.look;
    const prevTarget = r.getRenderTarget();
    const prevAuto = r.autoClear;
    const prevTone = r.toneMapping;
    r.toneMapping = THREE.NoToneMapping;
    r.autoClear = true;

    // 1. world → HDR multisampled target (resolved into texture + depth texture)
    r.setRenderTarget(this.scene);
    r.render(scene, camera);
    const depthTex = this.scene.depthTexture;

    // 2. ambient occlusion (half resolution)
    if (this.cfg.aoTaps && this.aoRaw) {
      const P = camera.projectionMatrix.elements;
      this.projInv.copy(camera.projectionMatrixInverse);
      const u = this.aoMat.uniforms;
      u.tDepth.value = depthTex;
      u.uDepthTexel.value.set(1 / this.sw, 1 / this.sh);
      u.uProj.value.set(P[0], P[5], look.aoRadius, look.aoBias);
      u.uViewInv.value.copy(camera.matrixWorld);
      u.uFloor.value.set(look.aoFloor, 0.25);
      this.pass(this.aoMat, this.aoRaw);
      const b = this.aoBlur.uniforms;
      b.tDepth.value = depthTex;
      b.uNearFar.value.set(camera.near, camera.far);
      b.tAO.value = this.aoRaw.texture;
      b.uDir.value.set(1 / this.aoRaw.width, 0);
      this.pass(this.aoBlur, this.aoTmp);
      b.tAO.value = this.aoTmp.texture;
      b.uDir.value.set(0, 1 / this.aoRaw.height);
      this.pass(this.aoBlur, this.aoRaw);
    }

    // 3. bloom: prefilter → downsample chain → upsample back, accumulating
    const chain = this.bloomDown;
    if (chain.length) {
      const k = Math.max(1e-4, look.bloomKnee * look.bloomThreshold);
      const pf = this.prefilter.uniforms;
      pf.tSrc.value = this.scene.texture;
      pf.uTexel.value.set(1 / this.sw, 1 / this.sh);
      pf.uThreshold.value.set(look.bloomThreshold, look.bloomThreshold - k, 2 * k, 0.25 / k);
      this.pass(this.prefilter, chain[0]);
      const du = this.down.uniforms;
      for (let i = 1; i < chain.length; i++) {
        du.tSrc.value = chain[i - 1].texture;
        du.uTexel.value.set(0.5 / chain[i - 1].width, 0.5 / chain[i - 1].height);
        this.pass(this.down, chain[i]);
      }
      const uu = this.up.uniforms;
      r.autoClear = false;
      for (let i = chain.length - 2; i >= 0; i--) {
        const src = chain[i + 1];
        uu.tSrc.value = src.texture;
        uu.uTexel.value.set(0.5 / src.width, 0.5 / src.height);
        uu.uWeight.value = look.bloomRadius;
        this.pass(this.up, chain[i]);
      }
      r.autoClear = true;
    }

    // 4. composite to the canvas (color + scene depth)
    const c = this.composite.uniforms;
    c.tScene.value = this.scene.texture;
    c.tDepth.value = depthTex;
    c.tBloom.value = chain.length ? chain[0].texture : null;
    c.tAO.value = this.aoRaw ? this.aoRaw.texture : null;
    c.uSceneTexel.value.set(1 / this.sw, 1 / this.sh);
    c.uExposure.value = look.exposure;
    // the chain sums ~levels × radius copies of the prefiltered image
    c.uBloomStrength.value = chain.length ? look.bloomStrength / (1 + look.bloomRadius * (chain.length - 1) * 0.5) : 0;
    c.uAOStrength.value = look.aoStrength;
    c.uContrast.value = look.contrast;
    c.uSaturation.value = look.saturation;
    c.uShadowTint.value.fromArray(look.shadowTint);
    c.uHighlightTint.value.fromArray(look.highlightTint);
    c.uVignette.value = look.vignette;
    c.uGlow.value = look.glow;
    c.uGlowColor.value.fromArray(look.glowColor);
    c.uSharpen.value = this.renderScale < 0.999 ? look.sharpen : 0;
    const aspect = this.canvasW / Math.max(1, this.canvasH);
    c.uAspect.value.set(aspect > 1 ? aspect : 1, aspect > 1 ? 1 : 1 / aspect);
    r.setRenderTarget(null);
    r.autoClear = false;
    r.clear(true, true, false);
    this.tri.material = this.composite;
    r.render(this.tri, this.camera);

    // 5. overlays straight to the canvas, depth-tested against the world
    if (overlay) r.render(overlay, camera);

    r.autoClear = prevAuto;
    r.toneMapping = prevTone;
    r.setRenderTarget(prevTarget);
  }

  dispose() {
    this.freeTargets();
    this.tri.geometry.dispose();
    for (const m of [this.prefilter, this.down, this.up, this.aoBlur, this.aoMat, this.composite]) if (m) m.dispose();
  }
}
