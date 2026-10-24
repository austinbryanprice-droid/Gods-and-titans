// Pieces the rich battering ram is made of (rich-ram.js): turned and revolved shapes (a wheel's tire, a hub, a socket, a finial), squared
// timbers, a wheel with its spokes, the iron ram's head with its curled horns, a roof of stitched hides stretched over battens, and the banner.
// Each is built into a MeshKit in model space and bound by a bind function (rich-kit.js), so a piece follows whichever bone the caller gives it.
import { ps } from './rich-kit.js';
import { mul, lerp, hash } from './rich-paint.js';

const TAU = Math.PI * 2;

/** Wood grain: long streaks along a timber (they swirl a little along it), a shade darker in the streaks. `k`: how deep they cut. */
export const grain = (k = 0.09, f = 80) => (o, x, y, z) => mul(o, 1 - k + k * Math.sin((z + y * 0.6) * f + Math.sin(x * 17) * 1.3));

/** Stations along the line from a to b: `count` + 1 of them, the section's half sizes going from (rx0, rz0) to (rx1, rz1), `n` its squareness. */
export function run(a, b, count, rx0, rz0, rx1 = rx0, rz1 = rz0, n = 2) {
  const out = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    out.push(ps(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(rx0, rx1, t), lerp(rz0, rz1, t), n));
  }
  return out;
}

/**
 * A squared timber from a to b: its section a rounded square (squareness `n`), `h` and `w` its half sizes (h along `up`, the loft's first
 * radius, w across), ends closed flat. o: { up, n, count (rings), sides, color, mat, bind, paint, start, end, w1, h1 (the far end's sizes) }.
 */
export function timber(kit, a, b, w, h, o = {}) {
  kit.loft(run(a, b, o.count ?? 1, o.h0 ?? h, o.w0 ?? w, o.h1 ?? h, o.w1 ?? w, o.n ?? 6), {
    ref: o.up || [0, 1, 0], sides: o.sides ?? 12, start: o.start ?? 'flat', end: o.end ?? 'flat', capRings: 2, capDepth: o.capDepth ?? Math.min(w, h) * 0.8,
    color: o.color, mat: o.mat ?? 'wood', bind: o.bind, paint: o.paint === undefined ? grain() : o.paint,
  });
}

const AXES = {
  x: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  y: [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
  z: [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
};

/**
 * A surface of revolution: `profile` is a list of [t, r] (t along the axis from `at`, r the distance from it) turned about the axis `axis`
 * ('x' | 'y' | 'z') through `at`. An open profile is a cup, a turned post or a boss (an end at r = 0 closes on the axis); a `closed` one is a ring
 * (a tire, a band). The profile runs so that the outside is on its left as it climbs: along an outer wall t increases (a ring's inner wall
 * runs back). o: { at, axis, profile, closed, sides, turn, color, mat, bind, paint }.
 */
export function lathe(kit, o) {
  const { profile } = o;
  const at = o.at || [0, 0, 0];
  const sides = o.sides ?? 16;
  const n = profile.length;
  const B = AXES[o.axis || 'z'];
  const P = [];
  const UV = [];
  const ring = []; // vertex index of ring i, side k (a ring on the axis is one vertex)
  for (let i = 0; i < n; i++) {
    const [t, r] = profile[i];
    const pole = r < 1e-6;
    ring.push([]);
    for (let k = 0; k < sides; k++) {
      if (pole && k > 0) {
        ring[i].push(ring[i][0]);
        continue;
      }
      const a = (k / sides) * TAU + (o.turn || 0);
      const c = Math.cos(a) * r;
      const s = Math.sin(a) * r;
      ring[i].push(P.length / 3);
      P.push(at[0] + B[0][0] * t + B[1][0] * c + B[2][0] * s, at[1] + B[0][1] * t + B[1][1] * c + B[2][1] * s, at[2] + B[0][2] * t + B[1][2] * c + B[2][2] * s);
      UV.push(n > 1 ? i / (n - 1) : 0, k / sides);
    }
  }
  const I = [];
  const rings = o.closed ? n : n - 1;
  for (let i = 0; i < rings; i++) {
    const j = (i + 1) % n;
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      const a = ring[i][k];
      const b = ring[i][k1];
      const c = ring[j][k1];
      const d = ring[j][k];
      if (a !== b && b !== c && a !== c) I.push(a, b, c);
      if (a !== c && c !== d && a !== d) I.push(a, c, d);
    }
  }
  return kit.add(P, I, o.color ?? '#ff00ff', o, o.bind, UV);
}

/** The profile of a wheel's piece seen from the other side: for the wheel on the left (z < 0) the same lathe, mirrored along its axis. */
export const mirrored = (profile, side) => (side > 0 ? profile : profile.map(([t, r]) => [-t, r]).reverse());

/**
 * A spoked wheel, turning about the axis through `at` along Z: an iron tire round a wooden felloe, six spokes into a hub that ends in a cap
 * of metal on the outside (`side`: +1 for a wheel on the right of the ram, -1 for the left). r: the tire's radius.
 * o: { at, side, r, bone, wood, iron, metal }.
 */
export function wheel(kit, o) {
  const { at, side, r, bone } = o;
  const s = r / 0.14;
  const half = (t) => t * s;
  const tire = [[-0.026, 0.14], [0.026, 0.14], [0.032, 0.134], [0.032, 0.116], [-0.032, 0.116], [-0.032, 0.134]].map(([t, rr]) => [half(t), rr * s]);
  const felloe = [[-0.028, 0.119], [0.028, 0.119], [0.028, 0.094], [-0.028, 0.094]].map(([t, rr]) => [half(t), rr * s]);
  const tireWear = (out, x, y, z, u, a) => mul(out, 0.8 + 0.18 * hash(Math.round(a * 16), side, 3) + 0.06 * Math.sin(a * TAU * 16));
  lathe(kit, { at, axis: 'z', closed: true, sides: 14, turn: Math.PI / 14, profile: mirrored(tire, side), color: o.iron, mat: 'iron', bind: bone, paint: tireWear });
  lathe(kit, { at, axis: 'z', closed: true, sides: 14, turn: Math.PI / 14, profile: mirrored(felloe, side), color: o.wood, mat: 'wood', bind: bone, paint: grain(0.1, 60) });
  // the spokes: flat bars from the hub to the felloe
  for (let k = 0; k < 6; k++) {
    const phi = (k / 6) * TAU + 0.26;
    const c = Math.cos(phi);
    const sn = Math.sin(phi);
    const a = [at[0] + c * 0.034 * s, at[1] + sn * 0.034 * s, at[2]];
    const b = [at[0] + c * 0.106 * s, at[1] + sn * 0.106 * s, at[2]];
    kit.loft([ps(a[0], a[1], a[2], 0.013 * s, 0.012 * s, 4), ps(b[0], b[1], b[2], 0.011 * s, 0.009 * s, 4)], {
      ref: [0, 0, 1], sides: 4, start: 'flat', end: 'flat', capRings: 1, color: o.wood, mat: 'wood', bind: bone, paint: grain(0.1, 70),
    });
  }
  // the hub: a barrel of wood ending in a cap of metal on the outside
  const hub = [[-0.036, 0.0], [-0.036, 0.034], [0.03, 0.04], [0.044, 0.034], [0.056, 0.016], [0.058, 0.0]].map(([t, rr]) => [half(t), rr * s]);
  lathe(kit, { at, axis: 'z', sides: 10, profile: mirrored(hub, side), color: o.metal, mat: o.metal.mat, bind: bone });
}

/**
 * The iron head of the ram on the end of the log, forged as a ram's: a flared socket that takes the log, a broad skull with a high brow that
 * slopes down to a blunt muzzle, a horn each side coiled about the cheek. o: { at (where the socket starts on the log), color, horn, bind }; the
 * head points along +X.
 */
export function ramHead(kit, o) {
  const [x, y, z] = o.at;
  const { color, bind } = o;
  const horn = o.horn || color;
  lathe(kit, {
    at: [x, y, z], axis: 'x', sides: 12, color, mat: color.mat, bind,
    profile: [[0, 0.081], [0.014, 0.096], [0.028, 0.1], [0.07, 0.096], [0.1, 0.088], [0.112, 0.084]],
    paint: (out, px, py, pz, u) => mul(out, 0.8 + 0.3 * Math.sin(u * 3.1)),
  });
  // the skull: the brow is high and broad, the nose slopes down from it and ends blunt
  kit.loft([
    ps(x + 0.09, y + 0.005, z, 0.084, 0.088, 2.2), ps(x + 0.14, y + 0.022, z, 0.082, 0.09, 2.2), ps(x + 0.19, y + 0.014, z, 0.07, 0.072, 2.2),
    ps(x + 0.24, y - 0.004, z, 0.054, 0.054, 2.2), ps(x + 0.285, y - 0.02, z, 0.04, 0.04, 2.2), ps(x + 0.308, y - 0.03, z, 0.036, 0.036, 2.2),
  ], {
    ref: [0, 1, 0], rings: 8, sides: 12, start: null, end: 'round', capRings: 2, capDepth: 0.026, color, mat: color.mat, bind,
    paint: (out, px, py, pz, u) => {
      mul(out, 0.9 + 0.1 * Math.sin(u * 3.0));
      // the dark pits of the eyes and of the nostrils
      if (u > 0.28 && u < 0.46 && Math.abs(Math.abs(pz - z) - 0.056) < 0.013 && py > y - 0.015) mul(out, 0.4);
      if (u > 0.88 && Math.abs(Math.abs(pz - z) - 0.016) < 0.008) mul(out, 0.45);
    },
  });
  // a horn each side, coiled about the cheek in a plane tilted up a little (so that it shows from above): it leaves the brow, curls back, down
  // and forward, tapering to a point
  const tilt = 0.35;
  const n = [0, Math.sin(tilt), Math.cos(tilt)];
  const e2 = [0, Math.cos(tilt), -Math.sin(tilt)];
  const c = [x + 0.125, y - 0.005, z + 0.085];
  for (const side of [1, -1]) {
    const st = [];
    const count = 10;
    const turns = 1.12;
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const ang = 1.25 + t * turns * TAU;
      const rad = 0.056 - 0.03 * t;
      const drift = 0.03 * t;
      const px = c[0] + Math.cos(ang) * rad;
      const py = c[1] + Math.sin(ang) * rad * e2[1] + n[1] * drift;
      const pz = c[2] - z + Math.sin(ang) * rad * e2[2] + n[2] * drift;
      const taper = 0.024 * (1 - t) ** 0.85 + 0.0045;
      st.push(ps(px, py, z + side * pz, taper, taper, 2));
    }
    kit.loft(st, {
      ref: [0, 1, 0], sides: 6, start: 'round', end: 'round', capRings: 2, capDepth: 0.014, color: horn, mat: horn.mat, bind,
      paint: (out, px, py, pz, u) => mul(out, 0.86 + 0.14 * Math.abs(Math.sin(u * 28))),
    });
  }
}

/**
 * One panel of the roof: stitched hides stretched over the battens, puffed between them, its hem scalloped, its underside dark.
 * o: { side (+1 for the panel on the right), x0, x1 (its ends), ridge: [y, z], eave: [y, z], battens: [x ...], color, inner, bind, nu, nv, pillow (how far
 * it puffs), scallop (how far the hem rises), paint }.
 */
export function hideRoof(kit, o) {
  const { side, x0, x1, ridge, eave, battens } = o;
  const dy = eave[0] - ridge[0];
  const dz = (eave[1] - ridge[1]) * side;
  const len = Math.hypot(dy, dz);
  const nrm = [0, Math.abs(dz) / len, (side * Math.abs(dy)) / len]; // up and out
  const bayOf = (x) => {
    for (let i = 0; i + 1 < battens.length; i++) if (x >= battens[i] && x <= battens[i + 1]) return (x - battens[i]) / (battens[i + 1] - battens[i]);
    return -1;
  };
  const puff = (x) => {
    const f = bayOf(x);
    return f < 0 ? 0 : Math.sin(Math.PI * f) ** 0.7;
  };
  const at = (u, v, out) => {
    const x = side > 0 ? x1 - u * (x1 - x0) : x0 + u * (x1 - x0);
    const p = puff(x);
    const sag = o.pillow * p * Math.sin(Math.PI * Math.min(1, v * 1.04)) ** 0.8;
    const lift = (o.scallop ?? 0.03) * p * v * v * v; // the hem rises between the battens: a scalloped edge
    out[0] = x;
    out[1] = ridge[0] + dy * v + nrm[1] * sag + lift;
    out[2] = ridge[1] * side + dz * v + nrm[2] * sag;
  };
  layer(kit, o.nu, o.nv, at, { color: o.color, bind: o.bind, paint: o.paint });
  // (the underside is seen only through the open gables: a coarse grid, a little inside the outer one)
  layer(kit, Math.max(2, o.nu >> 1), Math.max(2, o.nv >> 1), (u, v, out) => {
    at(u, v, out);
    out[1] -= nrm[1] * 0.012;
    out[2] -= nrm[2] * 0.012;
  }, { color: o.inner, mat: 'leather', bind: o.bind }, true);
  return at;
}

/**
 * A rolled hem along the lower edge of a roof panel: a rope-thick tube that follows the scalloped edge (the same surface the panel was laid
 * on: `surface(u, v, out)` of hideRoof), a little below it. o: { surface, count (stations), r, color, bind, paint }.
 */
export function hemRoll(kit, o) {
  const out = [0, 0, 0];
  const st = [];
  for (let i = 0; i <= o.count; i++) {
    o.surface(i / o.count, 1, out);
    st.push(ps(out[0], out[1] - 0.004, out[2], o.r, o.r, 2));
  }
  kit.loft(st, { ref: [0, 1, 0], sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: o.r, color: o.color, mat: o.color.mat ?? 'leather', bind: o.bind, paint: o.paint });
}

/** One layer of cloth over a grid of nu by nv quads: fn(u, v, out) writes the surface point; its outer face looks along u x v (`flip`: the other way). */
function layer(kit, nu, nv, fn, o, flip = false) {
  const P = [];
  const UV = [];
  const out = [0, 0, 0];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      fn(i / nu, j / nv, out);
      P.push(out[0], out[1], out[2]);
      UV.push(i / nu, j / nv);
    }
  }
  const stride = nu + 1;
  const I = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * stride + i;
      if (flip) I.push(a, a + stride + 1, a + 1, a, a + stride, a + stride + 1);
      else I.push(a, a + 1, a + stride + 1, a, a + stride + 1, a + stride);
    }
  }
  return kit.add(P, I, o.color ?? '#ff00ff', o, o.bind, UV);
}

/**
 * The flag of the banner: a swallow-tailed cloth hung from the pole at (x, y, z), `w` long and `h` deep, notched at its free end by `notch`.
 * It faces along Z. o: { at, w, h, notch, nu, nv, color, bind, paint }.
 */
export function flagCloth(kit, o) {
  const [x, y, z] = o.at;
  const { w, h, notch } = o;
  kit.sheet(o.nu, o.nv, (u, v, out) => {
    const edge = 1 - notch * (1 - Math.abs(2 * v - 1)); // the free edge pulled in toward the middle
    out[0] = x + u * w * edge;
    out[1] = y - v * h;
    out[2] = z;
  }, { thick: 0.005, color: o.color, inner: o.color, bind: o.bind, paint: o.paint });
}
