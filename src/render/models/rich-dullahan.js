// The two pieces of the Celtic Dullahan that no other unit carries (rich-centaur-outfits.js dresses him with them, through the
// pantheon's `gear` hook): his own head, held aloft in the fist, and the whip he lashes crowds with, a human spine. Both are rigid
// pieces in the grip frame of rich-gear.js (origin = palm, +Y along the weapon), built from the same lofts as the rest.
import * as THREE from 'three';
import { ps, vs } from './rich-kit.js';
import { shadeC, tintC, withMat } from './unit-geo.js';
import { headStations, faceWarp } from './rich-body.js';
import { mul, lerp } from './rich-paint.js';

const PI = Math.PI;
const TAU = PI * 2;

/**
 * A head cut from its body, in the hand: waxen and grey-green, lit from within, its eyes burning, the mouth open in a wide grin
 * of teeth, long dark hair hanging from it over the fist. Built in its own frame (the neck's cut at the origin, the face toward +X,
 * the crown up +Y) and set on the end of the grip's frame so that it sits on top of the fist, along the forearm and looking away
 * from the body when the arm is raised, as the Dullahan carries it. opts: flesh (the skin's color), pivot (see below).
 */
export function severedHead(kit, pal, size, opts = {}) {
  const hs = 0.95 * size;
  const hy = 0.17 * hs; // the middle of the face, above the cut of the neck
  const hx = 0;
  const H = { hs, headX: hx, headCY: hy };
  const flesh = opts.flesh || withMat('#a9b497', 'skin');
  // (opts.pivot: on a bone of its own at the palm, upright and facing ahead, resting on the hand: the neck's cut a little above the palm;
  // else in the grip frame, set on the end of the fist along the forearm)
  const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, opts.pivot ? 0 : PI / 2));
  const place = new THREE.Matrix4().compose(new THREE.Vector3(opts.pivot ? 0 : -0.05 * size, opts.pivot ? 0.04 * size : 0, 0), rot, new THREE.Vector3(1, 1, 1));
  const glow = tintC(pal.glow, 0.5);
  const hair = withMat('#17141a', 'hair');
  const faceX = (z) => hx - 0.002 * hs + 0.102 * hs * Math.sqrt(Math.max(0, 1 - (z / (0.09 * hs)) ** 2));
  kit.placed(place, (k) => {
    // the skull and face, the hollows under the cheeks and round the eyes darker, the whole of it faintly alight
    const eyeAt = (z) => [faceX(z), hy + 0.012 * hs, z];
    k.loft(headStations(H), {
      rings: 12, capDepth: [0.012 * hs, 0.02 * hs], warp: faceWarp(H), color: flesh, mat: 'skin', glow: 0.34,
      paint: (o, x, y, z) => {
        let hollow = 0;
        for (const side of [1, -1]) {
          const [ex, ey, ez] = eyeAt(side * 0.041 * hs);
          hollow = Math.max(hollow, 1 - Math.min(1, Math.hypot((y - ey) * 1.2, z - ez, (x - ex) * 0.6) / (0.03 * hs)));
          const cheek = Math.hypot(y - (hy - 0.04 * hs), z - side * 0.06 * hs, (x - hx - 0.07 * hs) * 0.5);
          hollow = Math.max(hollow, 0.45 * (1 - Math.min(1, cheek / (0.034 * hs))));
        }
        mul(o, 1 - 0.55 * hollow);
        o.glow = 0.34 * (1 - 0.6 * hollow);
      },
    });
    // ears
    for (const side of [1, -1]) {
      k.loft([ps(hx - 0.004 * hs, hy - 0.004 * hs, side * 0.082 * hs, 0.017 * hs, 0.027 * hs), ps(hx - 0.004 * hs, hy - 0.004 * hs, side * 0.103 * hs, 0.012 * hs, 0.022 * hs)],
        { ref: [1, 0, 0], sides: 8, capDepth: 0.006 * hs, color: flesh, mat: 'skin', glow: 0.3 });
    }
    // burning eyes in the sockets
    for (const side of [1, -1]) {
      const z = side * 0.041 * hs;
      k.loft([ps(faceX(z) - 0.014 * hs, hy + 0.012 * hs, z, 0.012 * hs, 0.017 * hs), ps(faceX(z) - 0.002 * hs, hy + 0.012 * hs, z, 0.011 * hs, 0.0155 * hs)],
        { ref: [0, 1, 0], sides: 8, capDepth: 0.005 * hs, color: glow, mat: 'gem', glow: 1 });
      // a heavy brow over each
      k.loft([ps(faceX(side * 0.018 * hs) + 0.004 * hs, hy + 0.039 * hs, side * 0.018 * hs, 0.005 * hs, 0.0055 * hs), ps(faceX(side * 0.042 * hs) + 0.006 * hs, hy + 0.044 * hs, side * 0.042 * hs, 0.0056 * hs, 0.006 * hs), ps(faceX(side * 0.066 * hs) + 0.004 * hs, hy + 0.034 * hs, side * 0.066 * hs, 0.004 * hs, 0.0045 * hs)],
        { ref: [1, 0, 0], rings: 5, sides: 6, capDepth: 0.004 * hs, color: hair, mat: 'hair' });
    }
    // the grin: a dark mouth across the face, curling up at its corners, with a row of teeth along its upper edge
    const my = hy - 0.056 * hs;
    const arc = [-0.05, -0.03, 0, 0.03, 0.05].map((zf) => {
      const z = zf * hs;
      return [faceX(z) - 0.003 * hs, my + 0.014 * hs * (zf / 0.05) ** 2, z];
    });
    k.loft(arc.map(([x, y, z]) => ps(x, y, z, 0.006 * hs, 0.0105 * hs)), { ref: [1, 0, 0], rings: 6, sides: 6, start: 'round', end: 'round', capDepth: 0.006 * hs, color: shadeC(pal.mouth, 0.3), mat: 'skin', glow: 0.1 });
    arc.slice(0, 5).forEach(([x, y, z], i) => {
      if (i === 2) return;
      k.loft([ps(x - 0.002 * hs, y + 0.007 * hs, z, 0.0032 * hs, 0.0045 * hs), ps(x - 0.002 * hs, y - 0.002 * hs, z, 0.0028 * hs, 0.004 * hs)],
        { ref: [0, 1, 0], sides: 4, start: null, end: 'flat', color: withMat('#e9e4cf', 'bone'), mat: 'bone', glow: 0.15 });
    });
    k.loft([ps(faceX(0) - 0.002 * hs, my + 0.007 * hs, 0, 0.0034 * hs, 0.0055 * hs), ps(faceX(0) - 0.002 * hs, my - 0.002 * hs, 0, 0.003 * hs, 0.0048 * hs)],
      { ref: [0, 1, 0], sides: 4, start: null, end: 'flat', color: withMat('#e9e4cf', 'bone'), mat: 'bone', glow: 0.15 });
    // the neck: a stump ending in a raw cut, the end that sits in the fist
    k.loft([vs(-0.012 * hs, 0.05 * hs, 0.052 * hs, hx), vs(0.03 * hs, 0.047 * hs, 0.049 * hs, hx), vs(0.078 * hs, 0.044 * hs, 0.046 * hs, hx)], {
      rings: 4, start: 'flat', end: null, color: flesh, mat: 'skin', glow: 0.2,
      paint: (o, x, y) => {
        if (y < -0.008 * hs) {
          o.r = pal.mouth.r * 0.6;
          o.g = pal.mouth.g * 0.4;
          o.b = pal.mouth.b * 0.4;
        }
      },
    });
    // long hair from the crown, falling behind and beside the head and down over the fist
    const locks = 11;
    for (let i = 0; i < locks; i++) {
      const phi = lerp(0.55, TAU - 0.55, (i + 0.5) / locks) + 0.3 * Math.sin(i * 2.3);
      const c = Math.cos(phi);
      const sn = Math.sin(phi);
      const w = 1 + 0.2 * Math.sin(i * 1.7);
      const len = (0.2 + 0.07 * Math.abs(Math.sin(i * 1.3 + 0.4))) * hs;
      const pts = [[0.06, hy + 0.098, 0.014], [0.102, hy + 0.04, 0.012], [0.118, hy - 0.04, 0.0095], [0.124, hy - 0.11, 0.0072], [0.122, hy - 0.11 - len / hs, 0.004]];
      k.loft(pts.map(([r, y, rad]) => ps(hx - 0.004 * hs + c * r * hs * w, y * hs, sn * r * hs * w, rad * hs)), {
        ref: [1, 0, 0], rings: 5, sides: 4, start: 'round', end: 'round', capRings: 1, capDepth: 0.004 * hs, color: hair, mat: 'hair',
        paint: (o, x, y, z, u) => mul(o, 0.7 + 0.5 * u * (i & 1 ? 1 : 0.6)),
      });
    }
  });
}

/**
 * A whip made of a spine: a handle of leather with a knob of bone, and from it a long lash of vertebrae strung on a dark cord,
 * arching up and over forward and hanging at its tip with a hooked last bone, each vertebra a six-sided bead of bone with a spike
 * on the outer side of the curve and a little spur to each side, the beads growing smaller toward the tip. In the grip frame the
 * lash arches up the +Y axis and over toward +X. opts: bone, cord.
 */
export function spineWhip(kit, pal, s, opts = {}) {
  const bone = opts.bone || withMat('#d9d1b8', 'bone');
  const cord = opts.cord || shadeC(pal.leather, 0.75);
  // the handle, bound in cord, and the knob of bone at its foot
  kit.loft([ps(0, -0.1 * s, 0, 0.022 * s), ps(0, 0.04 * s, 0, 0.0215 * s), ps(0, 0.15 * s, 0, 0.0195 * s)], {
    ref: [1, 0, 0], rings: 7, sides: 8, start: 'round', end: null, capDepth: 0.012 * s, color: pal.leather, mat: 'leather',
    warp: (p, a, u) => {
      const k = Math.max(0, Math.sin(u * PI * 5)) ** 2 * 0.0025 * s;
      p[0] += Math.cos(a) * k;
      p[2] += Math.sin(a) * k;
    },
  });
  kit.loft([ps(0, -0.105 * s, 0, 0.03 * s, 0.028 * s), ps(0, -0.13 * s, 0, 0.034 * s, 0.032 * s), ps(0, -0.15 * s, 0, 0.026 * s, 0.024 * s)], { ref: [1, 0, 0], rings: 4, sides: 8, start: null, end: 'round', capDepth: 0.012 * s, color: bone, mat: 'bone' });
  // the lash's path: a Bezier curve in the XY plane, sampled for the cord and the vertebrae
  const P0 = [0, 0.15];
  const P1 = [0.01, 0.4];
  const P2 = [0.27, 0.56];
  const P3 = [0.5, 0.26];
  const at = (u) => {
    const v = 1 - u;
    return [v * v * v * P0[0] + 3 * v * v * u * P1[0] + 3 * v * u * u * P2[0] + u * u * u * P3[0], v * v * v * P0[1] + 3 * v * v * u * P1[1] + 3 * v * u * u * P2[1] + u * u * u * P3[1]];
  };
  const dir = (u) => {
    const v = 1 - u;
    const dx = 3 * v * v * (P1[0] - P0[0]) + 6 * v * u * (P2[0] - P1[0]) + 3 * u * u * (P3[0] - P2[0]);
    const dy = 3 * v * v * (P1[1] - P0[1]) + 6 * v * u * (P2[1] - P1[1]) + 3 * u * u * (P3[1] - P2[1]);
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  const cordPts = [];
  for (let i = 0; i <= 14; i++) {
    const u = i / 14;
    const [x, y] = at(u);
    cordPts.push(ps(x * s, y * s, 0, lerp(0.011, 0.0055, u) * s));
  }
  kit.loft(cordPts, { ref: [0, 0, 1], rings: 15, sides: 4, start: 'round', end: 'round', capRings: 1, capDepth: 0.006 * s, color: cord, mat: 'leather' });
  let reach = 0;
  for (let i = 0; i < 40; i++) {
    const a = at(i / 40);
    const b = at((i + 1) / 40);
    reach += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const N = 11;
  for (let i = 0; i < N; i++) {
    const u = 0.04 + (0.9 * (i + 0.5)) / N;
    const [x, y] = at(u);
    const [tx, ty] = dir(u);
    const r = lerp(0.032, 0.012, u) * s;
    // (a bead is two thirds of the way to the next, so the cord shows between them)
    const half = 0.5 * 0.66 * (0.9 / N) * reach * s;
    const a = [x * s - tx * half, y * s - ty * half, 0];
    const b = [x * s + tx * half, y * s + ty * half, 0];
    kit.loft([ps(a[0], a[1], 0, r * 0.88, r * 0.88), ps((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0, r, r), ps(b[0], b[1], 0, r * 0.88, r * 0.88)], {
      ref: [0, 0, 1], sides: 6, start: 'flat', end: 'flat', color: bone, mat: 'bone',
      paint: (o, xx, yy, zz, uu) => mul(o, 0.84 + 0.2 * Math.sin(uu * PI) + 0.06 * Math.sin(i * 3.1)),
    });
    // the spinous process out of the back (the outer side of the curve), the spurs to each side
    const nx = -ty;
    const ny = tx;
    const spike = (dx, dy, dz, len, w) => kit.loft([ps(x * s + dx * r * 0.7, y * s + dy * r * 0.7, dz * r * 0.7, w * s), ps(x * s + dx * (r * 0.7 + len * s), y * s + dy * (r * 0.7 + len * s), dz * (r * 0.7 + len * s), w * 0.25 * s)],
      { ref: dz ? [1, 0, 0] : [0, 0, 1], sides: 3, start: null, end: 'flat', color: shadeC(bone, 0.92), mat: 'bone' });
    if (i < 8) {
      spike(nx, ny, 0, lerp(0.05, 0.022, u), 0.0095);
      spike(0, 0, 1, 0.022, 0.0075);
      spike(0, 0, -1, 0.022, 0.0075);
    }
  }
  // the last bone hooks down at the tip
  const [ex, ey] = at(0.97);
  const [fx, fy] = dir(0.97);
  kit.loft([ps(ex * s, ey * s, 0, 0.0085 * s), ps((ex + fx * 0.05) * s, (ey + fy * 0.05 - 0.01) * s, 0, 0.0065 * s), ps((ex + fx * 0.08) * s, (ey + fy * 0.06 - 0.06) * s, 0, 0.0028 * s)],
    { ref: [0, 0, 1], rings: 4, sides: 4, start: null, end: 'round', capDepth: 0.004 * s, color: bone, mat: 'bone' });
}
