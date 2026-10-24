// More hand-held gear for the rich humanoids, beyond the common swords, axes, spears and bows of
// rich-gear.js: the signature weapons and emblems of the gods and their people (tridents, bolts,
// scepters, scythes ...). Same grip frame as rich-gear.js (origin = palm, +Y along the weapon,
// blade width along X, thickness along Z). Anything not built here keeps its low-poly model.
import { ps } from './rich-kit.js';
import { shadeC, mixC, tintC, withMat } from './unit-geo.js';
import { grip, grain, sstep } from './rich-gear.js';
import { featherFan } from './rich-feathers.js';
import { mul, lerp, tint, dye } from './rich-paint.js';
import { severedHead } from './rich-dullahan.js';

const PI = Math.PI;
const TAU = PI * 2;

/** Rows of [y, rx, rz] to stations on the weapon's axis. */
const along = (rows, s) => rows.map(([y, rx, rz]) => ps(0, y * s, 0, rx * s, (rz ?? rx) * s));

/** A trident: a long shaft and three barbed prongs, the outer two curving out and up from a socket. */
function trident(kit, pal, s, { shaftColor = null } = {}) {
  const shaft = shaftColor || pal.wood;
  const metal = pal.accentMetal;
  kit.loft(along([[-0.46, 0.016], [-0.12, 0.0195], [0.4, 0.0185], [0.86, 0.0165]], s), {
    ref: [1, 0, 0], rings: 9, sides: 8, start: 'round', end: null, capDepth: 0.008 * s, color: shaft, mat: 'wood', paint: grain(),
  });
  grip(kit, -0.1 * s, 0.1 * s, 0.0235 * s, pal.leather, 5);
  kit.loft(along([[0.82, 0.0215], [0.875, 0.031], [0.935, 0.0215]], s), { ref: [1, 0, 0], rings: 5, sides: 10, start: null, end: null, color: shadeC(metal, 0.74), mat: 'metal' });
  // the middle prong: a long leaf with a barbed head
  kit.loft(along([[0.93, 0.016, 0.012], [1.08, 0.0125, 0.0105], [1.22, 0.0105, 0.009], [1.275, 0.027, 0.0105], [1.34, 0.019, 0.008], [1.42, 0.003, 0.003]], s), {
    ref: [1, 0, 0], rings: 12, sides: 8, start: null, end: 'round', capDepth: 0.02 * s, color: metal, mat: 'metal',
    paint: (o, x, y, z, u) => mul(o, 0.92 + 0.14 * sstep(0.6, 1, u)),
  });
  // the outer prongs sweep out from the socket, then straight up, each ending in a barb
  for (const side of [1, -1]) {
    const pts = [[0.0, 0.935], [0.045, 0.955], [0.088, 1.0], [0.104, 1.07], [0.104, 1.16], [0.1, 1.24]];
    const st = pts.map(([x, y], i) => ps(side * x * s, y * s, 0, (0.0125 - i * 0.0006) * s, (0.0115 - i * 0.0005) * s));
    st.push(ps(side * 0.1 * s, 1.275 * s, 0, 0.0085 * s, 0.026 * s));
    st.push(ps(side * 0.1 * s, 1.33 * s, 0, 0.005 * s, 0.014 * s));
    st.push(ps(side * 0.1 * s, 1.38 * s, 0, 0.002 * s, 0.002 * s));
    kit.loft(st, { ref: [0, 0, 1], rings: 12, sides: 8, start: 'round', end: 'round', capDepth: [0.008 * s, 0.012 * s], color: metal, mat: 'metal' });
  }
}

/** A bolt of lightning: a glowing, jagged, double pointed plate on a short gold grip. */
function lightningBolt(kit, pal, s, { color = null } = {}) {
  const edge = color || pal.glow;
  const core = mixC(edge, '#fff2b0', 0.7);
  const glow = edge;
  const metal = pal.accentMetal;
  grip(kit, -0.12 * s, 0.1 * s, 0.021 * s, pal.leather, 3);
  kit.loft(along([[0.09, 0.027], [0.115, 0.034], [0.14, 0.027]], s), { ref: [1, 0, 0], rings: 4, sides: 8, start: null, end: null, color: metal, mat: 'metal' });
  kit.loft(along([[-0.12, 0.024], [-0.15, 0.02]], s), { ref: [1, 0, 0], sides: 8, start: 'round', end: null, capDepth: 0.008 * s, color: metal, mat: 'metal' });
  // the classic zigzag: a long bolt, a shorter broken spark beside it
  const bolt = [[0.62, 1.0], [0.18, 0.46], [0.44, 0.46], [0.3, 0.0], [0.86, 0.6], [0.58, 0.6], [0.8, 1.0]].map(([x, y]) => [(x - 0.55) * 0.32 * s, 0.17 * s + y * 0.66 * s]);
  kit.slab(bolt, {
    depth: 0.034 * s, bevel: 0.012 * s, color: glow, mat: 'gem', glow: 0.8,
    paint: (o, x, y, z) => {
      // a hot yellow-white face, the color of the bolt along the bevelled rim
      const k = sstep(0.4, 1, Math.abs(z) / (0.017 * s));
      o.r = lerp(edge.r, core.r, k);
      o.g = lerp(edge.g, core.g, k);
      o.b = lerp(edge.b, core.b, k);
      o.glow = 0.45 + 0.4 * k;
    },
  });
}

/** A scepter: a gold rod with a jeweled head held in two horns. */
function scepter(kit, pal, s, { gem = null } = {}) {
  const metal = pal.accentMetal;
  const dark = shadeC(pal.darkMetal, 1.15);
  const jewel = gem || tintC(pal.glow, 0.22);
  kit.loft(along([[-0.22, 0.015], [0.0, 0.0175], [0.4, 0.0165], [0.62, 0.0155]], s), {
    ref: [1, 0, 0], rings: 8, sides: 8, start: 'round', end: null, capDepth: 0.008 * s, color: shadeC(metal, 0.9), mat: 'metal',
  });
  grip(kit, -0.08 * s, 0.1 * s, 0.021 * s, pal.leather, 4);
  for (const y of [0.28, 0.6]) {
    kit.loft(along([[y - 0.022, 0.0175], [y, 0.026], [y + 0.022, 0.0175]], s), { ref: [1, 0, 0], rings: 4, sides: 10, start: null, end: null, color: metal, mat: 'gold' });
  }
  kit.loft(along([[0.7, 0.026], [0.745, 0.046], [0.8, 0.05], [0.855, 0.04], [0.89, 0.016]], s), {
    ref: [1, 0, 0], rings: 8, sides: 12, start: 'round', end: 'round', capDepth: 0.014 * s, color: jewel, mat: 'gem', glow: 0.85,
    paint: (o, x, y, z, u) => mul(o, 0.86 + 0.3 * Math.sin(u * PI)),
  });
  // two horns of dark metal curling up around the stone
  for (const side of [1, -1]) {
    const pts = [[0.012, 0.64], [0.05, 0.68], [0.082, 0.76], [0.08, 0.86], [0.052, 0.95], [0.02, 0.99]];
    kit.loft(pts.map(([x, y], i) => ps(side * x * s, y * s, 0, (0.011 - i * 0.0012) * s)), {
      ref: [0, 0, 1], rings: 9, sides: 6, start: 'round', end: 'round', capDepth: [0.008 * s, 0.003 * s], color: dark, mat: 'iron',
    });
  }
}

/** A scythe: a long ash shaft and a great curved blade set on a socket, edge toward +X. */
function scythe(kit, pal, s, { shaftColor = null } = {}) {
  const shaft = shaftColor || pal.wood;
  const steel = mixC(pal.accentMetal, '#cfd6dc', 0.35);
  kit.loft(along([[-0.4, 0.0165], [-0.1, 0.0195], [0.5, 0.0185], [1.02, 0.017]], s), {
    ref: [1, 0, 0], rings: 10, sides: 8, start: 'round', end: null, capDepth: 0.008 * s, color: shaft, mat: 'wood', paint: grain(0.09),
  });
  grip(kit, -0.1 * s, 0.1 * s, 0.0235 * s, pal.leather, 5);
  // a second hand grip further up (the snath's peg), and the socket collar
  kit.loft([ps(0.012 * s, 0.38 * s, 0, 0.013 * s), ps(0.075 * s, 0.4 * s, 0, 0.01 * s)], { ref: [0, 0, 1], sides: 6, start: 'round', end: 'round', capDepth: 0.008 * s, color: shaft, mat: 'wood' });
  kit.loft(along([[0.98, 0.021], [1.03, 0.03], [1.09, 0.021]], s), { ref: [1, 0, 0], rings: 5, sides: 10, start: null, end: null, color: shadeC(pal.accentMetal, 0.7), mat: 'iron' });
  // the blade: a long crescent, thick at the heel, drawn out to a point; the cutting edge on the inside curve
  const outer = [[0.0, 1.2], [0.1, 1.285], [0.26, 1.33], [0.43, 1.31], [0.58, 1.23], [0.68, 1.12], [0.73, 1.0]];
  const inner = [[0.64, 1.15], [0.52, 1.215], [0.38, 1.24], [0.22, 1.235], [0.1, 1.2], [0.0, 1.13]];
  kit.slab([...outer, ...inner].map(([x, y]) => [x * s, y * s]), {
    depth: 0.02 * s, bevel: 0.007 * s, color: steel, mat: 'metal',
    paint: (o, x, y, z, u, a) => {
      // the cutting edge (inner curve) is brighter, the back darker
      mul(o, 0.84 + 0.3 * sstep(0.2, 1, 1 - a));
    },
  });
  // a rib along the back of the blade
  kit.loft([ps(0.04 * s, 1.215 * s, 0, 0.013 * s), ps(0.26 * s, 1.318 * s, 0, 0.011 * s), ps(0.52 * s, 1.265 * s, 0, 0.009 * s)], {
    ref: [0, 0, 1], rings: 6, sides: 6, start: 'round', end: 'round', capDepth: 0.006 * s, color: shadeC(steel, 0.7), mat: 'iron',
  });
}

/** A conch: a spiral shell, wide at the lip and drawn out to a point, ridged along its whorls, held mouth down. */
function conch(kit, pal, s0) {
  const s = s0 * 0.8;
  const body = mixC(pal.white, '#f4e4d4', 0.5);
  const lip = mixC(pal.white, '#f0a898', 0.55);
  const at = (y, rx, rz = rx) => ps(-(y - 0.03) * 0.3 * s, y * s, 0, rx * s, rz * s);
  kit.loft([at(0.03, 0.058, 0.05), at(0.09, 0.063, 0.057), at(0.15, 0.049, 0.045), at(0.2, 0.031, 0.029), at(0.245, 0.014, 0.013), at(0.28, 0.002)], {
    ref: [1, 0, 0], rings: 12, sides: 14, start: null, end: 'round', capDepth: 0.02 * s, color: body, mat: 'bone',
    warp: (p, a, u) => {
      const k = 0.006 * s * Math.sin(a * 2 - u * 17);
      p[0] += Math.cos(a) * k;
      p[2] += Math.sin(a) * k;
    },
    paint: (o, x, y, z, u, a) => mul(o, 0.88 + 0.16 * Math.sin(a * TAU * 2 - u * 17 + 1.2)),
  });
  // the flared lip, pink inside, rolled over at the edge
  kit.loft([at(0.04, 0.056, 0.048), at(0.005, 0.07, 0.064), at(-0.02, 0.079, 0.07), at(-0.034, 0.072, 0.063)], {
    ref: [1, 0, 0], rings: 6, sides: 14, start: null, end: 'round', capDepth: 0.01 * s, color: lip, mat: 'bone',
    paint: (o, x, y, z, u) => mul(o, 1.04 - 0.14 * u),
  });
}

/** An ankh: a gold cross topped by a loop, held by the foot of its shaft (a wrapped grip); also an offhand emblem. */
function ankh(kit, pal, s, { color = null } = {}) {
  const gold = color || pal.accentMetal;
  grip(kit, -0.085 * s, 0.075 * s, 0.0195 * s, pal.leather, 4);
  kit.loft(along([[-0.125, 0.021], [-0.1, 0.0195], [0.0, 0.0155], [0.15, 0.0145], [0.3, 0.0145]], s), {
    ref: [1, 0, 0], rings: 8, sides: 8, start: 'round', end: null, capDepth: 0.008 * s, color: gold, mat: 'gold', glow: 0.1,
  });
  // the arms: a bar across the top of the shaft, its ends flaring a little
  const by = 0.292;
  kit.loft([
    ps(-0.118 * s, by * s, 0, 0.0155 * s, 0.0125 * s), ps(-0.06 * s, by * s, 0, 0.0125 * s, 0.0115 * s),
    ps(0, by * s, 0, 0.0145 * s, 0.0125 * s), ps(0.06 * s, by * s, 0, 0.0125 * s, 0.0115 * s), ps(0.118 * s, by * s, 0, 0.0155 * s, 0.0125 * s),
  ], { ref: [0, 1, 0], rings: 8, sides: 8, start: 'round', end: 'round', capDepth: 0.01 * s, color: gold, mat: 'gold', glow: 0.1 });
  // the loop: an oval ring rising from the crossing, open at its foot where the shaft meets it
  const n = 22;
  const loop = [];
  for (let i = 0; i < n; i++) {
    const t = -PI / 2 + 0.3 + (i / (n - 1)) * (TAU - 0.6);
    loop.push(ps(Math.cos(t) * 0.056 * s, (0.398 + Math.sin(t) * 0.088) * s, 0, 0.0128 * s, 0.0118 * s));
  }
  kit.loft(loop, { ref: [0, 0, 1], sides: 8, start: 'round', end: 'round', capDepth: 0.009 * s, color: gold, mat: 'gold', glow: 0.1 });
}

/**
 * A gada: a long rod ending in a great ribbed ball with a spike on top, in the unit's gold (Hanuman's, the royal champions').
 * opts: color, head ('pear': the Mesopotamian mace, a smooth pear-shaped head set with rows of studs, no spike).
 */
function mace(kit, pal, s, { color = null, head = null } = {}) {
  const metal = color || pal.accentMetal;
  if (head === 'pear') {
    pearMace(kit, pal, s, metal);
    return;
  }
  kit.loft(along([[-0.2, 0.017], [-0.1, 0.0205], [0.3, 0.0185], [0.58, 0.0175]], s), {
    ref: [1, 0, 0], rings: 5, sides: 7, start: 'round', end: null, capRings: 2, capDepth: 0.008 * s, color: shadeC(metal, 0.78), mat: 'metal',
  });
  grip(kit, -0.1 * s, 0.12 * s, 0.0235 * s, pal.leather, 5);
  // the foot: a flared knob; a collar under the ball
  kit.loft(along([[-0.185, 0.02], [-0.215, 0.032], [-0.255, 0.021]], s), { ref: [1, 0, 0], rings: 4, sides: 8, start: null, end: 'round', capRings: 2, capDepth: 0.014 * s, color: metal, mat: 'gold' });
  kit.loft(along([[0.5, 0.0185], [0.545, 0.034], [0.6, 0.0235]], s), { ref: [1, 0, 0], rings: 4, sides: 10, start: null, end: null, color: metal, mat: 'gold' });
  // the ball: ribbed, brightest at its belly
  kit.loft(along([[0.58, 0.022], [0.615, 0.05], [0.675, 0.075], [0.74, 0.082], [0.8, 0.072], [0.855, 0.048], [0.885, 0.02]], s), {
    ref: [1, 0, 0], rings: 10, sides: 14, start: null, end: 'round', capRings: 2, capDepth: 0.012 * s, color: metal, mat: 'gold',
    warp: (p, a, u) => {
      const k = 0.007 * s * Math.sin(a * 7) * Math.sin(u * PI);
      p[0] += Math.cos(a) * k;
      p[2] += Math.sin(a) * k;
    },
    paint: (o, x, y, z, u, a) => mul(o, 0.82 + 0.26 * Math.sin(u * PI) + 0.08 * Math.sin(a * 7)),
  });
  kit.loft(along([[0.87, 0.028], [0.935, 0.016], [1.03, 0.002]], s), {
    ref: [1, 0, 0], rings: 4, sides: 6, start: null, end: 'round', capRings: 2, capDepth: 0.01 * s, color: shadeC(metal, 0.9), mat: 'gold',
  });
}

/** The Mesopotamian mace: a rod with a pear-shaped head of metal, wide toward its top, set with two rows of studs (the war god's). */
function pearMace(kit, pal, s, metal) {
  kit.loft(along([[-0.2, 0.017], [-0.1, 0.0205], [0.3, 0.0185], [0.55, 0.0175]], s), {
    ref: [1, 0, 0], rings: 5, sides: 7, start: 'round', end: null, capRings: 2, capDepth: 0.008 * s, color: shadeC(metal, 0.78), mat: 'metal',
  });
  grip(kit, -0.1 * s, 0.12 * s, 0.0235 * s, pal.leather, 5);
  kit.loft(along([[-0.185, 0.02], [-0.215, 0.034], [-0.255, 0.022]], s), { ref: [1, 0, 0], rings: 4, sides: 8, start: null, end: 'round', capRings: 2, capDepth: 0.014 * s, color: metal, mat: 'gold' });
  kit.loft(along([[0.5, 0.0185], [0.54, 0.034], [0.585, 0.024]], s), { ref: [1, 0, 0], rings: 4, sides: 10, start: null, end: null, color: metal, mat: 'gold' });
  // the head: narrow at the rod, swelling to its greatest girth two thirds up, then closing in to a flat crown
  const prof = [[0.58, 0.024], [0.625, 0.05], [0.7, 0.074], [0.79, 0.09], [0.87, 0.088], [0.925, 0.066], [0.955, 0.036]];
  kit.loft(along(prof, s), {
    ref: [1, 0, 0], rings: 9, sides: 14, start: null, end: 'round', capRings: 2, capDepth: 0.008 * s, color: metal, mat: 'metal',
    paint: (o, x, y, z, u) => mul(o, 0.82 + 0.26 * Math.sin(u * PI)),
  });
  // two rows of studs, short cones standing out of the head
  const stud = (y, r0, n, off) => {
    for (let i = 0; i < n; i++) {
      const a = (i + off) / n * TAU;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      kit.loft([ps(c * r0 * s, y * s, sn * r0 * s, 0.014 * s), ps(c * (r0 + 0.03) * s, y * s, sn * (r0 + 0.03) * s, 0.0025 * s)], {
        ref: [0, 1, 0], sides: 4, start: null, end: 'round', capRings: 1, capDepth: 0.004 * s, color: shadeC(metal, 1.1), mat: 'gold',
      });
    }
  };
  stud(0.725, 0.072, 7, 0);
  stud(0.83, 0.088, 7, 0.5);
  kit.loft(along([[0.945, 0.03], [0.975, 0.024], [1.0, 0.004]], s), { ref: [1, 0, 0], rings: 3, sides: 8, start: null, end: 'round', capRings: 1, capDepth: 0.01 * s, color: metal, mat: 'gold' });
}

/** A chakra: a disk standing in the forward-and-up plane on a short rod, a hub with spokes, a glowing inner ring and an outer rim set with slanting teeth (Vishnu's Sudarshana). */
function discus(kit, pal, s) {
  const metal = pal.accentMetal;
  const edge = mixC(metal, '#f6f2e2', 0.4);
  const R = 0.128 * s;
  const cy = 0.19 * s;
  grip(kit, -0.07 * s, 0.07 * s, 0.021 * s, pal.leather, 3);
  kit.loft(along([[0.06, 0.016], [0.11, 0.014], [0.2, 0.0125]], s), { ref: [1, 0, 0], rings: 3, sides: 6, start: null, end: null, color: metal, mat: 'gold' });
  // the hub, a boss through the disk, and the spokes out to the inner ring
  kit.loft([ps(0, cy, -0.026 * s, 0.032 * s), ps(0, cy, 0, 0.04 * s), ps(0, cy, 0.026 * s, 0.032 * s)], { ref: [1, 0, 0], rings: 3, sides: 10, start: 'round', end: 'round', capRings: 1, capDepth: 0.012 * s, color: metal, mat: 'gold' });
  const n = 24;
  const ring = (r, d, w, color, opts = {}) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * TAU;
      pts.push(ps(Math.cos(t) * r, cy + Math.sin(t) * r, 0, d, w));
    }
    kit.loft(pts, { ref: [0, 0, 1], sides: 6, start: null, end: null, color, ...opts });
  };
  ring(R, 0.011 * s, 0.02 * s, metal, { mat: 'gold', glow: 0.1 });
  ring(R * 0.62, 0.008 * s, 0.011 * s, tintC(pal.glow, 0.3), { mat: 'gem', glow: 0.9 });
  const spokes = 6;
  for (let i = 0; i < spokes; i++) {
    const t = (i / spokes) * TAU + 0.2;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    kit.loft([ps(c * R * 0.08, cy + sn * R * 0.08, 0, 0.007 * s, 0.009 * s), ps(c * R * 0.62, cy + sn * R * 0.62, 0, 0.006 * s, 0.0085 * s)],
      { ref: [0, 0, 1], sides: 4, start: null, end: null, color: metal, mat: 'gold' });
  }
  // the teeth of the rim lean the way the disk spins
  const teeth = 14;
  for (let i = 0; i < teeth; i++) {
    const t = (i / teeth) * TAU;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    const tx = -sn;
    const ty = c;
    const at = (r, lean) => [c * r + tx * lean, cy + sn * r + ty * lean];
    const [x0, y0] = at(R * 0.96, 0);
    const [x1, y1] = at(R + 0.026 * s, 0.01 * s);
    const [x2, y2] = at(R + 0.058 * s, 0.026 * s);
    kit.loft([ps(x0, y0, 0, 0.0075 * s, 0.017 * s), ps(x1, y1, 0, 0.006 * s, 0.011 * s), ps(x2, y2, 0, 0.0015 * s, 0.0015 * s)],
      { ref: [0, 0, 1], rings: 3, sides: 4, start: null, end: 'round', capRings: 1, capDepth: 0.004 * s, color: edge, mat: 'metal' });
  }
}

/** A damaru: an hourglass drum with a skin over each end, held at its waist, a pair of cords with beads hanging from it (Shiva's). Its axis runs across the grip. */
function drum(kit, pal, s) {
  const wood = mixC(pal.wood, '#5a3416', 0.35);
  const metal = pal.accentMetal;
  const skin = mixC(pal.white, '#e2c690', 0.55);
  const y0 = 0.035 * s;
  const at = (z, r) => ps(0, y0, z * s, r * s, r * s);
  const body = [[-0.108, 0.062], [-0.095, 0.067], [-0.072, 0.05], [-0.038, 0.027], [0, 0.0185], [0.038, 0.027], [0.072, 0.05], [0.095, 0.067], [0.108, 0.062]];
  kit.loft(body.map(([z, r]) => at(z, r)), { ref: [1, 0, 0], rings: 9, sides: 10, start: null, end: null, color: wood, mat: 'wood', paint: (o, x, y, z, u) => mul(o, 0.86 + 0.2 * Math.sin(u * PI)) });
  for (const sg of [1, -1]) {
    // the skin: a shallow dome over the end, a gold hoop round its edge
    kit.loft([at(sg * 0.1, 0.064), at(sg * 0.108, 0.066), at(sg * 0.114, 0.0)], { ref: [1, 0, 0], rings: 3, sides: 10, start: null, end: 'round', capRings: 1, capDepth: 0.006 * s, color: skin, mat: 'cloth' });
    kit.loft([at(sg * 0.094, 0.068), at(sg * 0.108, 0.07)], { ref: [1, 0, 0], sides: 10, start: null, end: null, color: metal, mat: 'gold' });
    // a cord from the waist with a bead on its end
    const cord = [[0.0, 0.0], [sg * 0.012, -0.05], [sg * 0.03, -0.1]].map(([z, d]) => ps(0.004 * s, y0 - 0.016 * s + d * s, z * s, 0.0036 * s));
    kit.loft(cord, { ref: [1, 0, 0], rings: 3, sides: 4, start: 'round', end: null, capRings: 1, capDepth: 0.003 * s, color: pal.secondary, mat: 'cloth' });
    kit.loft([ps(0.004 * s, y0 - 0.1 * s, sg * 0.03 * s, 0.012 * s), ps(0.004 * s, y0 - 0.12 * s, sg * 0.033 * s, 0.012 * s)],
      { ref: [1, 0, 0], sides: 6, start: 'round', end: 'round', capRings: 1, capDepth: 0.01 * s, color: metal, mat: 'gold' });
  }
  // the hand's waistband
  kit.loft([at(-0.014, 0.0235), at(0.014, 0.0235)], { ref: [1, 0, 0], sides: 8, start: null, end: null, color: pal.leather, mat: 'leather' });
}

/**
 * A talking drum (dundun), the Yoruba's: a long hourglass of wood with a skin over each end, held at its waist, the two skins laced
 * to each other by a cage of cords standing off the waist (squeezed, they change its voice), a band of leather round each rim. Its
 * axis runs across the grip like the damaru's. opts: skin, cord, wood.
 */
function talkingDrum(kit, pal, s, { skin = null, cord = null, wood = null } = {}) {
  const body = wood || mixC(pal.wood, '#6a3a1a', 0.4);
  const hide = skin || mixC(pal.white, '#d9b77a', 0.6);
  const lace = cord || mixC(pal.leather, '#c9a46a', 0.45);
  const y0 = 0.04 * s;
  const at = (z, r) => ps(0, y0, z * s, r * s, r * s);
  const prof = [[-0.16, 0.066], [-0.13, 0.064], [-0.07, 0.042], [-0.025, 0.03], [0, 0.028], [0.025, 0.03], [0.07, 0.042], [0.13, 0.064], [0.16, 0.066]];
  kit.loft(prof.map(([z, r]) => at(z, r)), { ref: [1, 0, 0], rings: 10, sides: 12, start: null, end: null, color: body, mat: 'wood', paint: (o, x, y, z, u) => mul(o, 0.84 + 0.22 * Math.sin(u * PI)) });
  for (const sg of [1, -1]) {
    kit.loft([at(sg * 0.158, 0.068), at(sg * 0.166, 0.07), at(sg * 0.172, 0.0)], { ref: [1, 0, 0], rings: 3, sides: 12, start: null, end: 'round', capRings: 1, capDepth: 0.006 * s, color: hide, mat: 'cloth' });
    kit.loft([at(sg * 0.15, 0.073), at(sg * 0.166, 0.074)], { ref: [1, 0, 0], sides: 12, start: null, end: null, color: pal.leather, mat: 'leather' });
  }
  // the cage of cords from rim to rim
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const b = a + PI / n;
    const p0 = [Math.cos(a) * 0.074, Math.sin(a) * 0.074, -0.154];
    const p1 = [Math.cos(b) * 0.074, Math.sin(b) * 0.074, 0.154];
    const m = [(p0[0] + p1[0]) * 0.36, (p0[1] + p1[1]) * 0.36, 0];
    kit.loft([p0, m, p1].map(([x, y, z]) => ps(x * s, y0 + y * s, z * s, 0.0032 * s)), { ref: [1, 0, 0], rings: 2, sides: 3, start: null, end: null, color: lace, mat: 'cloth' });
  }
  // the hand's grip round the cords at the waist
  kit.loft([at(-0.02, 0.034), at(0.02, 0.034)], { ref: [1, 0, 0], sides: 8, start: null, end: null, color: shadeC(lace, 0.8), mat: 'leather' });
}

/** A lotus bloom on a short stem: two rings of pink petals paling toward their tips round a gold heart. */
function lotus(kit, pal, s) {
  const green = mixC('#4f8a48', pal.secondary, 0.1);
  const pink = '#ee93bc';
  kit.loft(along([[-0.1, 0.012], [0.0, 0.0105], [0.12, 0.009]], s), { ref: [1, 0, 0], rings: 3, sides: 5, start: 'round', end: null, capRings: 1, capDepth: 0.006 * s, color: green, mat: 'cloth' });
  kit.loft(along([[0.11, 0.01], [0.135, 0.03], [0.165, 0.022]], s), { ref: [1, 0, 0], rings: 3, sides: 8, start: null, end: 'round', capRings: 1, capDepth: 0.008 * s, color: shadeC(green, 1.1), mat: 'cloth' });
  const layers = [
    { n: 8, tilt: 1.0, len: 0.1, w: 0.032, y: 0.135, turn: 0 },
    { n: 6, tilt: 0.5, len: 0.092, w: 0.027, y: 0.15, turn: 0.52 },
  ];
  for (const L of layers) {
    for (let i = 0; i < L.n; i++) {
      const a = (i / L.n) * TAU + L.turn;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const st = [0, 0.3, 0.65, 1].map((t, k) => {
        const out = 0.014 + Math.sin(L.tilt * (0.3 + 0.8 * t)) * L.len * t * 1.05;
        const up = L.y + Math.cos(L.tilt * (0.3 + 0.8 * t)) * L.len * t;
        return ps(c * out * s, up * s, sn * out * s, [0.2, 0.95, 0.8, 0.1][k] * L.w * s, 0.0045 * s);
      });
      kit.loft(st, {
        ref: [-sn, 0, c], rings: 4, sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: 0.006 * s, color: pink, mat: 'cloth',
        paint: (o, x, y, z, u) => tint(o, { r: 1, g: 0.93, b: 0.95 }, 0.5 * u * u),
      });
    }
  }
  kit.loft([ps(0, 0.15 * s, 0, 0.016 * s), ps(0, 0.178 * s, 0, 0.013 * s)], { ref: [1, 0, 0], sides: 6, start: 'round', end: 'round', capRings: 1, capDepth: 0.01 * s, color: pal.accentMetal, mat: 'gold', glow: 0.2 });
}

/** A flame floating over the palm: a glowing teardrop, hot at its heart. */
function flame(kit, pal, s) {
  const outer = mixC(pal.fire, pal.glow, 0.3);
  kit.loft(along([[0.03, 0.012], [0.075, 0.04], [0.13, 0.037], [0.19, 0.019], [0.25, 0.004]], s), {
    ref: [1, 0, 0], rings: 6, sides: 8, start: 'round', end: 'round', capRings: 2, capDepth: [0.01 * s, 0.02 * s], color: outer, mat: 'gem', glow: 0.95,
    paint: (o, x, y, z, u) => {
      const k = u < 0.5 ? 0.6 : 1 - u;
      o.r = lerp(outer.r, pal.fireHot.r, k);
      o.g = lerp(outer.g, pal.fireHot.g, k);
      o.b = lerp(outer.b, pal.fireHot.b, k);
    },
  });
}

// ---------------------------------------------------------------------------
// Japanese gear: the fans, the mirror, the jewel, the drumstick
// ---------------------------------------------------------------------------

/** A handle for a fan: a slim turned stick from below the palm to the pivot, a gold rivet at the pivot. */
function fanHandle(kit, pal, s, pivotY) {
  kit.loft([ps(0, -0.05 * s, 0, 0.0155 * s), ps(0, (pivotY - 0.04) * s, 0, 0.0135 * s), ps(0, pivotY * s, 0, 0.0115 * s)], {
    ref: [1, 0, 0], rings: 4, sides: 6, start: 'round', end: null, capDepth: 0.008 * s, color: pal.woodDark, mat: 'wood',
  });
  kit.loft([ps(0, pivotY * s, -0.012 * s, 0.011 * s), ps(0, pivotY * s, 0.012 * s, 0.011 * s)], { ref: [1, 0, 0], sides: 8, start: 'round', end: 'round', capRings: 1, capDepth: 0.004 * s, color: pal.accentMetal, mat: 'gold' });
}

/**
 * A folding fan (ogi), open: the paper face between two broad outer ribs with thin ribs fanning from a
 * pivot, a sun disc painted on it in the unit's second color (a priest's). Lies in the grip's X-Y plane.
 */
function ogi(kit, pal, s) {
  const pivotY = 0.1;
  const R = 0.28 * s;
  const span = 0.97;
  const paper = withMat(mixC(pal.primary, '#fff8e8', 0.45), 'cloth');
  const at = (th, r) => [Math.sin(th) * r, pivotY * s + Math.cos(th) * r];
  fanHandle(kit, pal, s, pivotY);
  const outline = [];
  const n = 10;
  for (let i = 0; i <= n; i++) outline.push(at(-span + (i / n) * 2 * span, R));
  for (let i = n; i >= 0; i--) outline.push(at(-span + (i / n) * 2 * span, R * 0.16));
  kit.slab(outline, { depth: 0.009 * s, bevel: 0.0025 * s, color: paper, mat: 'cloth', paint: (o, x, y, z, u, a) => mul(o, 0.92 + 0.1 * Math.abs(Math.sin(u * 22))) });
  // the sun disc, on both faces
  const [dx, dy] = at(0, R * 0.58);
  kit.loft([ps(dx, dy, -0.0058 * s, R * 0.22, R * 0.22), ps(dx, dy, 0.0058 * s, R * 0.22, R * 0.22)], { ref: [1, 0, 0], sides: 16, start: 'flat', end: 'flat', color: pal.secondary, mat: 'lacquer' });
  // ribs: two broad outer ones (gold-edged) and thin ones between
  const rib = (th, rx, rz, color, mat) => {
    const [x0, y0] = at(th, R * 0.1);
    const [x1, y1] = at(th, R * 1.0);
    kit.loft([ps(x0, y0, 0, rx, rz), ps(x1, y1, 0, rx * 0.9, rz * 0.9)], { ref: [0, 0, 1], sides: 4, start: 'round', end: 'round', capRings: 1, capDepth: rz, color, mat });
  };
  for (const sg of [-1, 1]) rib(sg * span, 0.0075 * s, 0.0085 * s, pal.accentMetal, 'gold');
  for (const f of [-0.6, -0.3, 0, 0.3, 0.6]) rib(f * span, 0.0058 * s, 0.0032 * s, shadeC(pal.woodDark, 1.2), 'wood');
}

/**
 * A hauchiwa: the tengu's great fan of feathers, a fan of dark leaf-shaped vanes from a short handle,
 * tipped in the unit's pale color, a cord of red at the pivot. Lies in the grip's X-Y plane.
 */
function hauchiwa(kit, pal, s) {
  const pivotY = 0.08;
  fanHandle(kit, pal, s, pivotY);
  const dark = withMat(mixC(pal.secondary, '#1a1a22', 0.35), 'feather');
  const tip = mixC(pal.primary, '#ffffff', 0.2);
  featherFan(kit, [0, pivotY * s, 0], [0, 1, 0], [0, 0, 1], -1.12, 1.12, 7, (k) => (0.36 - 0.07 * Math.abs(k - 0.5) * 2) * s, 0.055 * s, (i, k) => ({
    color: shadeC(dark, 0.94 + 0.12 * (i % 2)), tip, mat: 'feather', cup: 0.1, rows: 4, thick: 0.004 * s, shape: 0.5,
  }));
  kit.loft([ps(0, (pivotY + 0.03) * s, 0, 0.014 * s, 0.03 * s), ps(0, (pivotY + 0.06) * s, 0, 0.011 * s, 0.026 * s)], { ref: [1, 0, 0], sides: 8, start: null, end: null, color: pal.accent, mat: 'cloth' });
}

/**
 * A feather fan (yushan): a fan of long white crane feathers from a short handle, dark at their tips, a silk cord and tassel
 * hung at the pivot. Lies in the grip's X-Y plane.
 */
function craneFan(kit, pal, s) {
  const pivotY = 0.09;
  fanHandle(kit, pal, s, pivotY);
  const white = withMat(mixC(pal.primary, '#ffffff', 0.55), 'feather');
  const tip = mixC(pal.secondary, '#2a2022', 0.6);
  featherFan(kit, [0, pivotY * s, 0], [0, 1, 0], [0, 0, 1], -0.95, 0.95, 9, (k) => (0.4 - 0.1 * Math.abs(k - 0.5) * 2) * s, 0.05 * s, (i) => ({
    color: shadeC(white, 0.96 + 0.08 * (i % 2)), tip, mat: 'feather', cup: 0.1, rows: 4, thick: 0.004 * s, shape: 0.55,
  }));
  kit.loft([ps(0, (pivotY + 0.02) * s, 0, 0.014 * s, 0.03 * s), ps(0, (pivotY + 0.05) * s, 0, 0.011 * s, 0.026 * s)], { ref: [1, 0, 0], sides: 8, start: null, end: null, color: pal.accentMetal, mat: 'gold' });
  kit.loft([ps(0.012 * s, (pivotY - 0.01) * s, 0, 0.004 * s), ps(0.03 * s, (pivotY - 0.06) * s, 0, 0.007 * s), ps(0.034 * s, (pivotY - 0.11) * s, 0, 0.011 * s), ps(0.034 * s, (pivotY - 0.16) * s, 0, 0.002 * s)],
    { ref: [0, 0, 1], rings: 5, sides: 6, start: 'round', end: 'round', capDepth: 0.006 * s, color: pal.secondary, mat: 'cloth' });
}

/** The weapon fan of a unit: a priest's folding fan, or (opts.fan 'hauchiwa') the tengu's feather fan, or ('crane') a scholar's of white feathers. */
function fan(kit, pal, s, { fan: style = 'ogi' } = {}) {
  if (style === 'hauchiwa') hauchiwa(kit, pal, s);
  else if (style === 'crane') craneFan(kit, pal, s);
  else ogi(kit, pal, s);
}

/**
 * A palace lantern, hung from the hand by a cord: a flared gold roof, a body of glowing paper in eight ribs of gold swelling at
 * the middle, a gold rim, and a tassel of silk below. Hangs along the grip's +Y (down when the elbow is bent). With opts.head the
 * Dullahan's own head in its place (rich-dullahan.js).
 */
function lantern(kit, pal, size, opts = {}) {
  if (opts.head) {
    severedHead(kit, pal, size, opts);
    return;
  }
  const s = size * 0.72;
  const gold = pal.accentMetal;
  const glow = tintC(pal.glow, 0.3);
  kit.loft([ps(0, -0.02 * s, 0, 0.0055 * s), ps(0, 0.1 * s, 0, 0.0045 * s)], { ref: [1, 0, 0], sides: 4, start: 'round', end: null, capDepth: 0.004 * s, color: shadeC(pal.secondary, 0.8), mat: 'cloth' });
  kit.loft(along([[0.1, 0.012], [0.112, 0.04], [0.13, 0.07], [0.146, 0.078]], s), { ref: [1, 0, 0], rings: 5, sides: 12, start: 'round', end: null, capDepth: 0.006 * s, color: gold, mat: 'gold' });
  kit.loft(along([[0.146, 0.066], [0.18, 0.086], [0.22, 0.092], [0.26, 0.084], [0.294, 0.064]], s), {
    ref: [1, 0, 0], rings: 8, sides: 16, start: null, end: null, color: glow, mat: 'gem', glow: 1,
    paint: (o, x, y, z, u, a) => {
      // the ribs: every other vertex round the lamp is gold, the paper between glowing
      if (Math.round(a * 16) % 2 === 0) {
        dye(o, gold, 0.9);
        o.glow = 0.12;
      } else mul(o, 0.9 + 0.14 * Math.sin(u * PI));
    },
  });
  kit.loft(along([[0.292, 0.066], [0.3, 0.07], [0.314, 0.056]], s), { ref: [1, 0, 0], rings: 3, sides: 12, start: null, end: 'round', capDepth: 0.006 * s, color: gold, mat: 'gold' });
  kit.loft(along([[0.314, 0.01], [0.34, 0.026], [0.38, 0.03], [0.44, 0.004]], s), { ref: [1, 0, 0], rings: 5, sides: 8, start: 'round', end: 'round', capDepth: 0.006 * s, color: pal.secondary, mat: 'cloth', paint: (o, x, y, z, u, a) => mul(o, 0.82 + 0.28 * Math.abs(Math.sin(a * TAU * 4))) });
}

/**
 * The sacred mirror: a round (eight-sided) bronze disc in a gold rim on a lacquered handle, its face a
 * glowing silver the goddess holds up to the light, the back a gold boss. The face looks along the grip's +X.
 * opts.obsidian: the smoking mirror, a disc of black glass in a gold rim with smoke curling up from it.
 */
function mirror(kit, pal, s, { obsidian = false } = {}) {
  const gold = pal.accentMetal;
  const R = (obsidian ? 0.098 : 0.118) * s;
  const cy = 0.27 * s;
  grip(kit, -0.07 * s, 0.14 * s, 0.0195 * s, shadeC(pal.secondary, 0.9), 4);
  kit.loft(along([[0.13, 0.021], [0.16, 0.026], [0.19, 0.02], [0.225, 0.014]], s), { ref: [1, 0, 0], rings: 4, sides: 8, start: null, end: null, color: gold, mat: 'gold' });
  // the rim, a rolled band round the disc
  kit.loft([ps(-0.014 * s, cy, 0, R * 1.1, R * 1.1), ps(0.016 * s, cy, 0, R * 1.1, R * 1.1)], { ref: [0, 1, 0], sides: obsidian ? 14 : 8, start: null, end: null, color: gold, mat: 'gold', glow: 0.12 });
  // the face: glowing, a little inside the rim
  kit.loft([ps(0.008 * s, cy, 0, R * 0.96, R * 0.96), ps(0.019 * s, cy, 0, R * 0.96, R * 0.96)], {
    ref: [0, 1, 0], sides: obsidian ? 14 : 8, start: 'flat', end: 'flat', color: obsidian ? mixC('#0a090e', pal.glow, 0.06) : tintC(pal.glow, 0.55), mat: obsidian ? 'gloss' : 'gem', glow: obsidian ? 0.12 : 1,
    paint: (o, x, y, z, u, a) => mul(o, 0.94 + 0.12 * Math.abs(Math.cos(a * TAU * 4))),
  });
  if (obsidian) {
    // smoke curling up from the rim: three slender wisps, thinning as they rise
    const smoke = mixC('#2a2236', pal.glow, 0.35);
    [[-0.5, 0.0, 0.14], [0.0, 0.07, 0.2], [0.5, -0.04, 0.16]].forEach(([dz, dx, rise], i) => {
      const pts = [];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        pts.push(ps((0.012 + dx * Math.sin(t * 5 + i) * t) * s, cy + R * 1.04 + rise * t * s, dz * R * (1 + 0.5 * t) + Math.sin(t * 6 + i * 2) * 0.03 * s * t, (0.0095 * (1 - t) + 0.0015) * s));
      }
      kit.loft(pts, { ref: [1, 0, 0], rings: 5, sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: 0.004 * s, color: smoke, mat: 'gem', glow: 0.4 });
    });
  }
  // the back: a boss and a ring of bosses
  kit.loft([ps(-0.012 * s, cy, 0, R * 0.9, R * 0.9), ps(-0.02 * s, cy, 0, R * 0.7, R * 0.7), ps(-0.026 * s, cy, 0, R * 0.2, R * 0.2)], {
    ref: [0, 1, 0], sides: 8, start: null, end: 'round', capRings: 1, capDepth: 0.006 * s, color: shadeC(gold, 0.88), mat: 'gold',
  });
}

/**
 * A jewel (hoju): a pointed, drop-shaped gem glowing in a cup of gold petals, the flame of its
 * point licking up, held over the palm (the offhand of the rice goddess).
 */
function jewel(kit, pal, s) {
  const gold = pal.accentMetal;
  const glow = tintC(pal.glow, 0.3);
  kit.loft(along([[0.03, 0.016], [0.06, 0.044], [0.095, 0.052], [0.115, 0.034]], s), { ref: [1, 0, 0], rings: 6, sides: 10, start: 'round', end: null, capDepth: 0.01 * s, color: gold, mat: 'gold',
    warp: (p, a, u) => { const k = 0.01 * s * Math.sin(a * 5) * u; p[0] += Math.cos(a) * k; p[2] += Math.sin(a) * k; } });
  kit.loft(along([[0.1, 0.012], [0.14, 0.048], [0.195, 0.062], [0.255, 0.046], [0.31, 0.018], [0.36, 0.0025]], s), {
    ref: [1, 0, 0], rings: 9, sides: 12, start: 'round', end: 'round', capDepth: [0.01 * s, 0.01 * s], color: glow, mat: 'gem', glow: 1,
    paint: (o, x, y, z, u) => mul(o, 0.86 + 0.3 * Math.sin(u * PI)),
  });
}

/**
 * A pot hung from the hand (along the grip's +Y, down when the elbow is bent): by its neck, a clay jar of the rain god's helpers (opts.jar),
 * a round belly under a flared mouth painted in bands, the water glowing in its mouth; or an iron cauldron on a ring handle with the brew
 * glowing in it. opts: color (the clay), band (the painted bands).
 */
function cauldron(kit, pal, s, { jar = false, color = null, band = null } = {}) {
  const glow = tintC(pal.glow, 0.3);
  if (jar) {
    const clay = color || mixC(pal.primary, '#b9693a', 0.6);
    const paintBand = band || pal.secondary;
    kit.loft(along([[0.0, 0.036], [0.012, 0.03], [0.05, 0.027], [0.1, 0.06], [0.17, 0.092], [0.25, 0.08], [0.32, 0.044], [0.345, 0.018]], s), {
      ref: [1, 0, 0], rings: 10, sides: 12, start: null, end: 'round', capRings: 2, capDepth: 0.014 * s, color: clay, mat: 'painted',
      paint: (o, x, y, z, u) => {
        const yy = y / s;
        if ((yy > 0.13 && yy < 0.155) || (yy > 0.21 && yy < 0.232)) dye(o, paintBand, 0.9);
        mul(o, 0.86 + 0.24 * Math.sin(u * PI));
      },
    });
    kit.loft(along([[-0.014, 0.036], [0.0, 0.039]], s), { ref: [1, 0, 0], sides: 12, start: null, end: null, color: shadeC(paintBand, 0.9), mat: 'painted' });
    kit.loft(along([[-0.004, 0.027], [0.0, 0.027]], s), { ref: [1, 0, 0], sides: 12, start: 'flat', end: null, color: glow, mat: 'gem', glow: 1 });
    return;
  }
  const iron = pal.darkMetal;
  kit.loft(along([[0.0, 0.1], [0.012, 0.112], [0.07, 0.128], [0.15, 0.1], [0.2, 0.05], [0.215, 0.02]], s), { ref: [1, 0, 0], rings: 8, sides: 14, start: null, end: 'round', capDepth: 0.012 * s, color: iron, mat: 'iron' });
  kit.loft(along([[-0.006, 0.104], [0.012, 0.116]], s), { ref: [1, 0, 0], sides: 14, start: null, end: null, color: shadeC(iron, 0.8), mat: 'iron' });
  kit.loft(along([[0.004, 0.092], [0.01, 0.092]], s), { ref: [1, 0, 0], sides: 14, start: 'flat', end: null, color: glow, mat: 'gem', glow: 1 });
  for (const side of [1, -1]) kit.loft([ps(0, 0.005 * s, side * 0.1 * s, 0.016 * s), ps(0, -0.07 * s, side * 0.06 * s, 0.01 * s), ps(0, -0.1 * s, 0, 0.01 * s)], { ref: [1, 0, 0], rings: 6, sides: 6, start: 'round', end: 'round', capRings: 1, capDepth: 0.006 * s, color: iron, mat: 'iron' });
}

/** A drumstick (bachi): a straight turned stick of dark wood, the end that strikes ringed in gold and charged with a glow (the thunder god's). */
function bachi(kit, pal, s) {
  kit.loft(along([[-0.12, 0.0165], [0.0, 0.0185], [0.16, 0.0205], [0.34, 0.024], [0.4, 0.0225]], s), {
    ref: [1, 0, 0], rings: 8, sides: 8, start: 'round', end: null, capDepth: 0.009 * s, color: mixC(pal.woodDark, '#2a1a10', 0.3), mat: 'wood', paint: grain(0.08),
  });
  grip(kit, -0.08 * s, 0.1 * s, 0.0225 * s, pal.leather, 4);
  kit.loft(along([[0.4, 0.0235], [0.425, 0.03], [0.45, 0.0235]], s), { ref: [1, 0, 0], rings: 4, sides: 8, start: null, end: null, color: pal.accentMetal, mat: 'gold' });
  kit.loft(along([[0.44, 0.02], [0.475, 0.036], [0.52, 0.034], [0.55, 0.012], [0.562, 0.003]], s), {
    ref: [1, 0, 0], rings: 6, sides: 10, start: null, end: 'round', capDepth: 0.01 * s, color: tintC(pal.glow, 0.3), mat: 'gem', glow: 0.95,
  });
}

/** The stick a talking drum is beaten with (kongo): a slim rod of dark wood bent round at its end into a hook that strikes the skin. */
function drumBeater(kit, pal, s) {
  const path = [[0, -0.07, 0.0115], [0, 0.06, 0.0105], [0.004, 0.17, 0.0095], [0.024, 0.225, 0.009], [0.06, 0.244, 0.009], [0.088, 0.222, 0.0105]];
  kit.loft(path.map(([x, y, r]) => ps(x * s, y * s, 0, r * s, r * s)), {
    ref: [0, 0, 1], rings: 10, sides: 6, start: 'round', end: 'round', capDepth: 0.006 * s, color: mixC(pal.woodDark, '#2a1a10', 0.3), mat: 'wood', paint: grain(0.08),
  });
}

/** The drums a hand may hold, by opts.drum (none: the damaru). */
const DRUMS = { stick: bachi, talking: talkingDrum, beater: drumBeater };

/** The weapons built here, by the visual's weapon id. */
const ARMS = { trident, lightning_bolt: lightningBolt, scepter, scythe, ankh: (kit, pal, s, opts) => ankh(kit, pal, s * 0.82, opts), mace, discus, fan, drum: bachi, cauldron };
export const RICH_ARMS = new Set(Object.keys(ARMS));

/** The offhand items built here, by the visual's offhand id (lotus and flame are only carried by the extra hands of many-armed gods). */
const OFFHANDS = { shell: conch, ankh: (kit, pal, s, opts) => ankh(kit, pal, s * 0.7, opts), drum, lotus, flame, mirror, orb: jewel, lantern };
export const RICH_OFFHANDS = new Set(Object.keys(OFFHANDS));

/**
 * Add weapon or offhand item `id` (one of RICH_ARMS, RICH_OFFHANDS) to `kit` in the grip frame; opts as for richWeapon.
 * The drum is a damaru (the offhand), or with opts.drum 'stick' a drumstick (the weapon): the thunder god beats with both hands;
 * with opts.drum 'talking' it is the Yoruba's talking drum, and 'beater' the hooked stick it is played with.
 * Returns whether it was built.
 */
export function richArm(kit, pal, id, s, opts = {}) {
  const make = id === 'drum' ? DRUMS[opts.drum] || drum : ARMS[id] || OFFHANDS[id];
  if (!make) return false;
  make(kit, pal, s, opts);
  return true;
}

void TAU;
