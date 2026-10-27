// The film's sky (DESIGN 11.1). The game camera looks down on the map and never sees past its edge
// (the world ends in dark mist), but the film's low shots do: this is a dome that follows the camera,
// painted by the hour's look (src/render/atmosphere.js): the gradient from the horizon haze to the zenith,
// the sun and the moon where they stand, soft cloud streaks lit from the sun's side, stars at night.
// Under the horizon it is the haze the far land fades into, so the map's far edge melts into the sky
// instead of ending in black.
//
//   const sky = new FilmSky();  scene.add(sky.mesh);
//   sky.update(atmosphereState, cameraPosition, seconds);     // once a frame, after the look is resolved
import * as THREE from 'three';

const RADIUS = 300; // inside the camera's far plane (400)

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

// Linear HDR like the rest of the scene; the tone mapping and color space chunks make the low quality
// path (no post-processing) come out right too, as the terrain border's shader does.
const FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHaze;
uniform vec3 uSun;
uniform vec3 uSunDir;
uniform vec3 uMoon;
uniform vec3 uMoonDir;
uniform float uNight;
uniform float uTime;
varying vec3 vDir;

float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float noise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
float fbm( vec2 p ) {
  float a = 0.5;
  float s = 0.0;
  for ( int i = 0; i < 4; i++ ) {
    s += a * noise( p );
    p = p * 2.07 + vec2( 17.1, 5.3 );
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 d = normalize( vDir );
  float y = d.y;
  float sunAmt = max( dot( d, uSunDir ), 0.0 );
  vec3 col = mix( uHorizon, uZenith, pow( clamp( y, 0.0, 1.0 ), 0.5 ) );
  // the glow round the sun, wider near the horizon
  col += uSun * ( pow( sunAmt, 6.0 ) * 0.22 + pow( sunAmt, 2.0 ) * 0.05 ) * ( 1.0 - 0.6 * clamp( y, 0.0, 1.0 ) );

  // streaks of cloud, a flat layer seen at a slant: thin near the horizon, drifting slowly
  if ( y > 0.0 ) {
    vec2 cp = d.xz / ( y + 0.16 ) * 0.9 + vec2( uTime * 0.012, uTime * 0.004 );
    float c = fbm( vec2( cp.x * 1.1, cp.y * 2.4 ) );
    float cover = smoothstep( 0.5, 0.82, c ) * smoothstep( 0.0, 0.2, y ) * ( 1.0 - smoothstep( 0.72, 1.0, y ) * 0.6 );
    float lit = pow( sunAmt, 3.0 );
    vec3 cloud = mix( mix( uHorizon, uZenith, 0.35 ) * 0.75, uHorizon * 1.5 + uSun * 0.6, 0.35 + 0.65 * lit );
    col = mix( col, cloud, cover * 0.7 );
  }

  // stars, once it is dark
  if ( uNight > 0.02 && y > 0.0 ) {
    vec2 sp = d.xz / ( y + 0.35 ) * 70.0;
    vec2 cell = floor( sp );
    float star = step( 0.9935, hash( cell ) ) * smoothstep( 0.5, 0.0, length( fract( sp ) - 0.5 ) );
    star *= 0.6 + 0.4 * sin( uTime * 2.0 + hash( cell + 3.7 ) * 40.0 );
    col += vec3( 0.75, 0.85, 1.0 ) * star * 1.4 * uNight * smoothstep( 0.0, 0.25, y );
  }

  // under the horizon the haze the far land fades into
  col = mix( col, uHaze, smoothstep( 0.015, -0.035, y ) );

  col += uSun * ( pow( sunAmt, 900.0 ) * 40.0 + pow( sunAmt, 24.0 ) * 0.45 ) * smoothstep( -0.04, 0.02, y );
  float moonAmt = max( dot( d, uMoonDir ), 0.0 );
  col += uMoon * ( pow( moonAmt, 1400.0 ) * 14.0 + pow( moonAmt, 40.0 ) * 0.2 + pow( moonAmt, 6.0 ) * 0.03 ) * smoothstep( -0.04, 0.02, y );

  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const _moonHue = new THREE.Color('#a9c9ff');

export class FilmSky {
  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uHaze: { value: new THREE.Color() },
        uSun: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uMoon: { value: new THREE.Color() },
        uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
        uNight: { value: 0 },
        uTime: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 40, 20), this.material);
    this.mesh.name = 'film-sky';
    this.mesh.renderOrder = -1000; // before the ground, which is drawn over it
    this.mesh.frustumCulled = false;
  }

  /**
   * @param {import('../render/atmosphere.js').AtmosphereState} s the resolved look
   * @param {{ x: number, y: number, z: number }} at the camera (the dome is always round it)
   * @param {number} seconds film time, drifting the clouds
   */
  update(s, at, seconds) {
    const u = this.material.uniforms;
    u.uZenith.value.copy(s.skyZenith);
    u.uHorizon.value.copy(s.skyHorizon);
    u.uHaze.value.copy(s.haze);
    // the sun's disc and glow fade out as it drops below the horizon; the moon's rise with it (as the sky the scene is lit by)
    const sunUp = Math.min(1, Math.max(0, (s.sunElevation + 6) / 10));
    const moonUp = Math.min(1, Math.max(0, (s.moonElevation + 4) / 10));
    u.uSun.value.copy(s.keyHue).multiplyScalar(sunUp);
    u.uSunDir.value.copy(s.sunDir);
    u.uMoon.value.copy(_moonHue).multiplyScalar(moonUp * (0.35 + 0.65 * s.night));
    u.uMoonDir.value.copy(s.moonDir);
    u.uNight.value = s.night;
    u.uTime.value = seconds;
    this.mesh.position.set(at.x, at.y, at.z);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
