// What the two centaurs wear (rich-outfits.js lays it over their pantheon's outfit for a unit of the body 'centaur'): the Greek
// Centaur, an archer on a buckskin horse, bare to the waist, with a quiver on his back and a bow, and the Celtic Dullahan, a headless rider in
// black iron on a black steed, who holds his own head aloft by its hair and carries a whip of a spine. Each layer dresses the
// person; the `legs` layer builds the horse (rich-centaur.js addHorse), where a person's legs would be.
import { TEAM, shadeC, mixC, withMat } from './unit-geo.js';
import { ps, vs } from './rich-kit.js';
import { torsoStations, torsoRing, armStations } from './rich-body.js';
import { addTunic, addBelt, addCuirass, addPauldrons, addCape } from './rich-clothing.js';
import { addHorse } from './rich-centaur.js';
import { feather } from './rich-feathers.js';
import { hash, lerp, mul } from './rich-paint.js';
import { DEFAULT } from './rich-outfit-default.js';

const TAU = Math.PI * 2;
const LEATHER = withMat('#6a4528', 'leather');
const DARK_LEATHER = withMat('#4a3020', 'leather');
const BRONZE = withMat('#c48d44', 'gold');
const WHITE_FEATHER = withMat('#f0ead8', 'feather');
const BROWN_FEATHER = withMat('#8a5a34', 'feather');

// ---------------------------------------------------------------------------
// the Greek Centaur
// ---------------------------------------------------------------------------

function bareTorso(E) {
  const { kit, D, bind, skin, skinPaint } = E;
  kit.loft(torsoStations(D), { rings: 11, start: null, end: 'round', color: skin, bind: bind.torso, paint: skinPaint });
  baldric(E);
}

/** A baldric of the team's cloth over the right shoulder and under the left arm, across the chest and the back, that the quiver hangs from. */
function baldric(E) {
  const { kit, D, bind } = E;
  const N = 9;
  for (const [th0, th1] of [[1.15, -1.2], [1.95, 4.1]]) {
    const path = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const r = torsoRing(D, 1.02 - 0.92 * t, 0.012);
      const th = lerp(th0, th1, t);
      path.push(ps(r.dx + r.rx * Math.cos(th), r.y, r.rz * Math.sin(th), 0.0075, 0.019));
    }
    kit.loft(path, { ref: [1, 0, 0], rings: N, sides: 6, start: 'round', end: 'round', capDepth: 0.006, color: TEAM(0.95, 'cloth'), bind: bind.torso });
  }
}

function bareArms(E) {
  const { kit, D, bind, skin, skinPaint } = E;
  for (const side of [1, -1]) {
    const bd = bind.arm[side];
    kit.loft(armStations(D, side), { rings: 8, start: null, end: null, color: skin, bind: bd, paint: skinPaint });
    // a bracer of leather on the forearm
    const w = D.shoulderY - 0.02 - D.upper - D.fore;
    kit.loft([vs(w + 0.012, D.armR * 0.66 + 0.007, D.armR * 0.64 + 0.007, 0, side * D.shoulderZ), vs(w + D.fore * 0.52, D.armR * 0.86 + 0.007, D.armR * 0.84 + 0.007, 0.002, side * D.shoulderZ)],
      { sides: 12, rings: 3, start: null, end: null, color: LEATHER, mat: 'leather', bind: bd });
  }
}

/**
 * A quiver on the back, leaning up over the right shoulder: a tube of leather with a band at its mouth and its foot, the arrows
 * standing out of it with their fletching. opts: color (the leather), trim (the bands), fletch (the feathers' colors, cycled), n.
 */
function backQuiver(E, { color, trim = null, fletch, n = 6 }) {
  const { kit, D, bind } = E;
  const K = D.k;
  const R = 0.03 * K;
  const p0 = [-0.15 * K, D.hipY + 0.06, -0.045 * K];
  const p1 = [-0.2 * K, D.shoulderY + 0.04, 0.085 * K];
  const at = (u) => [lerp(p0[0], p1[0], u), lerp(p0[1], p1[1], u), lerp(p0[2], p1[2], u)];
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  const dir = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len, (p1[2] - p0[2]) / len];
  kit.loft([0, 0.5, 1].map((u, i) => {
    const q = at(u);
    const r = R * [0.86, 1, 1.1][i];
    return ps(q[0], q[1], q[2], r, r);
  }), {
    ref: [1, 0, 0], rings: 4, sides: 10, start: 'round', end: 'flat', capDepth: 0.012 * K, color, mat: 'leather', bind: bind.chest,
    paint: (o, x, y, z, u) => mul(o, u > 0.985 ? 0.22 : 0.84 + 0.16 * u),
  });
  if (trim) {
    for (const u of [0.08, 0.93]) {
      const a = at(u - 0.035);
      const b = at(u + 0.035);
      const r = R * lerp(0.9, 1.1, u) + 0.004;
      kit.loft([ps(a[0], a[1], a[2], r, r), ps(b[0], b[1], b[2], r, r)], { ref: [1, 0, 0], sides: 10, start: null, end: null, color: trim, mat: 'trim', bind: bind.chest });
    }
  }
  const cols = Array.isArray(fletch) ? fletch : [fletch];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const off = [Math.cos(a) * R * 0.45, 0, Math.sin(a) * R * 0.45];
    const base = at(0.7);
    const top = at(1);
    const L = 0.15 * K * (0.9 + 0.2 * hash(i, 2, 9));
    const b0 = [base[0] + off[0], base[1], base[2] + off[2]];
    const tip = [top[0] + off[0] * 1.8 + dir[0] * L, top[1] + dir[1] * L, top[2] + off[2] * 1.8 + dir[2] * L];
    kit.loft([ps(b0[0], b0[1], b0[2], 0.0042 * K), ps(tip[0], tip[1], tip[2], 0.0042 * K)], { ref: [1, 0, 0], sides: 3, start: null, end: 'round', capDepth: 0.004 * K, color: withMat('#c9a56a', 'wood'), mat: 'wood', bind: bind.chest });
    // the fletching: two vanes along the end of the shaft
    const back = [tip[0] - dir[0] * 0.055 * K, tip[1] - dir[1] * 0.055 * K, tip[2] - dir[2] * 0.055 * K];
    for (const f of [[Math.cos(a), 0, Math.sin(a)], [-Math.sin(a), 0, Math.cos(a)]]) {
      feather(kit, back, dir, f, 0.06 * K, 0.012 * K, { color: cols[i % cols.length], tip: null, bind: bind.chest, rows: 2, thick: 0.0018 });
    }
  }
}

const GREEK = {
  // a buckskin horse, darker than the rider's skin (the same tan read as one body), under the team's saddle cloth
  legs: (E) => addHorse(E, { coat: mixC(E.pal.skin, E.pal.primary, 0.4) }),
  torso: bareTorso,
  arms: bareArms,
  armor() {},
  cloaks() {},
  head: DEFAULT.head,
  extras(E) {
    backQuiver(E, { color: DARK_LEATHER, trim: BRONZE, fletch: [WHITE_FEATHER, BROWN_FEATHER], n: 6 });
  },
};

// ---------------------------------------------------------------------------
// the Celtic Dullahan
// ---------------------------------------------------------------------------

/** Black iron, as his armor is forged: the pantheon's metal, darkened. */
const blackIron = (pal) => withMat(mixC(pal.accentMetal, '#0e0e12', 0.5), 'iron');

const DULLAHAN = {
  // a black steed, dark as the rider's flesh, its tail hanging in grey rags tipped with the green of the grave light
  legs: (E) => addHorse(E, { coat: shadeC(E.pal.skin, 1.0), hair: withMat('#34323a', 'hair'), tip: withMat('#6f8a62', 'hair'), hoof: withMat('#2b2830', 'iron'), tailStrands: 18 }),
  // (a thin tunic of black wool under the iron: the cuirass is what shows)
  torso(E) {
    addTunic(E.kit, E.D, E.tunicColor, E.bind, 0.03);
    addBelt(E.kit, E.D, E.pal, E.bind);
  },
  arms: DEFAULT.arms,
  armor(E) {
    const { kit, D, pal, bind } = E;
    const iron = blackIron(pal);
    const trim = shadeC(pal.secondary, 1.5);
    addCuirass(kit, D, pal, bind, iron, trim);
    addPauldrons(kit, D, pal, bind, iron, trim);
  },
  // a short cape of the team's color, to the horse's back: any longer and it would hang through the barrel
  cloaks(E) {
    const { kit, D, pal, bind } = E;
    addCape(kit, D, TEAM(1), pal.accent, shadeC(pal.secondary, 0.7), bind, { len: 0.42, wide: 1.12 });
  },
  // (he has no head to dress: no hair, no helm; the neck's cut is made with the body, rich-body.js addHeadAndNeck)
  head() {},
  extras() {},
  // his head, held aloft in the left fist where a lantern would hang, and a whip of a spine in the right
  gear(ctx, item) {
    if (item.id === 'lantern') return { head: true, pivot: true };
    if (item.id === 'whip') return { build: true, spine: true };
    return null;
  },
};

/** Pantheon id -> the layers its centaur wears (over the pantheon's own outfit). */
export const CENTAUR_OUTFITS = { greek: GREEK, celtic: DULLAHAN };
