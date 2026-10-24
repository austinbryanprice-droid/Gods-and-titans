// The Greek look: bare limbs in sandals, a pinned chiton or a long peplos with a meander hem, a
// hero's cuirass of sculpted bronze over a kilt of leather strips, greaves, a short chlamys, laurel
// wreaths and crowns, the Corinthian helmet with its brush, the round hoplon. Gods dress as their
// myths show them (Zeus in a himation over bare skin, Poseidon in a sea-green kilt, Hades in black
// robes, Athena armored over a peplos, Kronos in bronze), the Cyclops in a hide. Overrides only the
// layers where the Greeks dress differently from the default (rich-outfit-default.js).
import { TEAM, shadeC, mixC, tintC, withMat } from './unit-geo.js';
import { vs } from './rich-kit.js';
import { torsoStations, torsoRing, armStations, addSandals, addBareLegs, legStations } from './rich-body.js';
import {
  addTunic, addBelt, addCape, addFurMantle, addPauldrons, addMuscleCuirass, addPteruges, addGreaves, addDrape, addChlamys, addMeander, addLongSkirt, addWaistBelt,
} from './rich-clothing.js';
import { addHairCap, addLongHair, addBeard, addHelmet, addLaurel, addCrown, addTallCrown } from './rich-headgear.js';
import { gradY, hash, mul } from './rich-paint.js';
import { DEFAULT } from './rich-outfit-default.js';

const BRONZE = withMat('#c48d44', 'gold');
const GOLD = withMat('#dcb55a', 'gold');
const OLIVE = withMat('#7b8a3a', 'cloth');
const PALE_GOLD = withMat('#e8d28c', 'gold');

/** How each god is dressed (the rest follow their build): the garment, and the metal of their arms. */
const GODS = {
  greek_zeus: { dress: 'himation' },
  greek_poseidon: { dress: 'kilt' },
  greek_hades: { dress: 'robe' },
  greek_athena: { dress: 'peplos', metal: PALE_GOLD, trim: GOLD },
  greek_kronos: { dress: 'titan', metal: BRONZE },
};

/** The garment of a unit: himation, kilt, robe, peplos, titan, hide (Cyclops), hoplite (armored), chiton (short), or robe for workers and priests. */
function dressOf(E) {
  const god = GODS[E.ctx.unit.id];
  if (god) return god.dress;
  if (E.bare && !E.armor) return 'hide';
  if (E.robe) return 'robe';
  return E.armor ? 'hoplite' : 'chiton';
}

/** The metal of a unit's armor and helmet: bronze for the people, a god's own where it is set, else the accent. */
function metalOf(E) {
  const god = GODS[E.ctx.unit.id];
  if (god && god.metal) return god.metal;
  return E.ctx.mortal ? BRONZE : E.pal.accentMetal;
}

/** The trim of a unit's metalwork: a god's own where it is set (Athena's gold on ivory), else a shade of the metal. */
function trimOf(E) {
  const god = GODS[E.ctx.unit.id];
  return god && god.trim ? god.trim : shadeC(metalOf(E), 0.72);
}

/** Skin torso (a bare chest). */
function bareTorso(E) {
  const { kit, D, bind, skin, skinPaint } = E;
  kit.loft(torsoStations(D), { rings: 11, start: null, end: 'round', color: skin, bind: bind.torso, paint: skinPaint });
}

/** A girdle just under the breast with a cord that hangs from it. */
function girdle(E, color) {
  const { kit, D, bind } = E;
  const a = torsoRing(D, 0.4, 0.02);
  const b = torsoRing(D, 0.47, 0.018);
  kit.loft([vs(a.y, a.rx, a.rz, a.dx), vs(b.y, b.rx, b.rz, b.dx)], { sides: 16, rings: 3, start: null, end: null, color, mat: 'trim', bind: bind.torso });
}

/** The fold of a peplos over the upper body: a second layer from under the breast to the neck. */
function overfold(E, color, trim) {
  const { kit, D, bind } = E;
  const r = torsoRing(D, 0.34, 0.032);
  kit.loft([vs(r.y, r.rx, r.rz, r.dx), ...torsoStations(D, 0.032, 0.4)], {
    rings: 9, start: null, end: 'round', capDepth: 0.01, color, bind: bind.torso, paint: gradY(r.y, D.shoulderY, 0.84, 1),
  });
  kit.loft([vs(r.y - 0.006, r.rx + 0.003, r.rz + 0.003, r.dx), vs(r.y + 0.014, r.rx + 0.002, r.rz + 0.002, r.dx)], { sides: 16, start: null, end: null, color: trim, mat: 'trim', bind: bind.torso });
}

function robe(E) {
  const { kit, D, ctx, pal, bind, tunicColor } = E;
  const gold = pal.accentMetal;
  addTunic(kit, D, tunicColor, bind, 0.04);
  const sk = addLongSkirt(kit, D, bind, ctx.skirt || pal.primary);
  addMeander(kit, bind, sk.y0 - 0.004, sk.rx + 0.004, sk.rz + 0.004, { color: gold, ink: shadeC(pal.secondary, 0.6) });
  // priests and gods wear a second garment folded over the chest; the people's team color stays on the tunic
  if (!E.worker) overfold(E, ctx.mortal ? pal.secondary : shadeC(pal.secondary, 1.1), gold);
  girdle(E, E.worker ? pal.secondary : gold);
}

function kilt(E) {
  // Poseidon: a bare chest, a sash of sea-foam, a kilt of sea-green with a hem in waves
  const { kit, D, pal, bind } = E;
  bareTorso(E);
  const y1 = D.hipY - 0.2;
  const foam = tintC(pal.secondary, 0.1);
  const kt = torsoRing(D, 0.12, 0.024);
  kit.loft([vs(y1, D.depth * 0.5 + 0.1, D.waistW * 0.5 + 0.115), vs(D.hipY - 0.1, D.depth * 0.5 + 0.075, D.waistW * 0.5 + 0.088), vs(D.hipY, D.depth * 0.5 + 0.045, D.waistW * 0.5 + 0.055), vs(kt.y, kt.rx, kt.rz, kt.dx)], {
    rings: 7, sides: 36, start: null, end: null, color: pal.primary, bind: bind.skirt,
    warp: (p, a, u) => {
      const k = 1 - u;
      p[1] += 0.032 * k * k * Math.sin(a * 5 + 0.7);
      const s = Math.sin(a * 9) * 0.006 * k;
      p[0] += Math.cos(a) * s;
      p[2] += Math.sin(a) * s;
    },
    paint: (o, x, y, z, u) => {
      const k = Math.max(0, 1 - u * 3.2);
      if (k > 0) {
        o.r += (foam.r - o.r) * 0.55 * k;
        o.g += (foam.g - o.g) * 0.55 * k;
        o.b += (foam.b - o.b) * 0.55 * k;
      }
      mul(o, 0.84 + 0.16 * u);
    },
  });
  addDrape(kit, D, bind, shadeC(pal.primary, 0.72), pal.accentMetal, { side: 1, width: 0.3 });
  addWaistBelt(kit, D, bind, shadeC(pal.accentMetal, 0.85), pal.accentMetal);
}

function himation(E) {
  // Zeus: a bare chest, a long wrap about the hips, the himation drawn across from the shoulder
  const { kit, D, pal, bind } = E;
  bareTorso(E);
  const sk = addLongSkirt(kit, D, bind, pal.primary, { pleat: 0.011, top: 0.024 });
  addMeander(kit, bind, sk.y0 - 0.004, sk.rx + 0.004, sk.rz + 0.004, { color: pal.accentMetal, ink: shadeC(pal.secondary, 0.7) });
  addDrape(kit, D, bind, pal.primary, pal.accentMetal, { side: 1, width: 0.34 });
  addWaistBelt(kit, D, bind, shadeC(pal.accentMetal, 0.85), pal.accentMetal);
}

function peplos(E) {
  // Athena: a long peplos under her armor, a gold meander at the hem
  const { kit, D, pal, bind, tunicColor } = E;
  addTunic(kit, D, tunicColor, bind, 0.04);
  const sk = addLongSkirt(kit, D, bind, pal.primary, { pleat: 0.01 });
  addMeander(kit, bind, sk.y0 - 0.004, sk.rx + 0.004, sk.rz + 0.004, { color: trimOf(E), ink: shadeC(pal.secondary, 0.65) });
}

function hoplite(E) {
  // the soldier: a team tunic, a kilt of linen strips under the bronze
  const { kit, D, pal, bind, tunicColor } = E;
  addTunic(kit, D, tunicColor, bind, 0.02);
  addPteruges(kit, D, pal, bind, { color: TEAM(0.86), lower: TEAM(0.72), edge: pal.leather });
}

function chiton(E) {
  // a short pinned chiton with a belt
  const { kit, D, pal, bind, tunicColor } = E;
  addTunic(kit, D, tunicColor, bind, 0.11);
  kit.loft([vs(D.hipY - 0.115, D.depth * 0.5 + 0.075, D.waistW * 0.5 + 0.088), vs(D.hipY - 0.085, D.depth * 0.5 + 0.07, D.waistW * 0.5 + 0.082)],
    { sides: 18, start: null, end: null, color: pal.secondary, mat: 'trim', bind: bind.skirt });
  addBelt(kit, D, pal, bind, pal.leather, pal.accentMetal);
}

function titan(E) {
  // Kronos: a bronze cuirass over a dark tunic, a heavy kilt of leather strips
  const { kit, D, pal, bind, tunicColor } = E;
  addTunic(kit, D, tunicColor, bind, 0.05);
  addPteruges(kit, D, pal, bind, { color: shadeC(pal.leather, 1.1), lower: shadeC(pal.leather, 0.85), edge: shadeC(pal.accentMetal, 0.9), strips: 18, len: 1.15 });
  addBelt(kit, D, pal, bind, pal.leather, pal.accentMetal);
}

function hide(E) {
  // the Cyclops: a skin torso, a rough hide about the loins
  const { kit, D, pal, bind } = E;
  bareTorso(E);
  const col = shadeC(pal.fur, 0.62);
  kit.loft([vs(D.hipY - 0.17, D.depth * 0.5 + 0.075, D.waistW * 0.5 + 0.09), vs(D.hipY - 0.06, D.depth * 0.5 + 0.055, D.waistW * 0.5 + 0.065), vs(D.hipY + 0.05, D.depth * 0.5 + 0.03, D.waistW * 0.5 + 0.038)], {
    rings: 5, sides: 18, start: null, end: null, color: col, mat: 'fur', bind: bind.skirt,
    warp: (p, a, u) => {
      const k = 1 - u;
      p[1] -= 0.045 * k * k * hash(Math.round(a * 4), 2, 5);
      p[0] += (hash(Math.round(a * 6), 4, 1) - 0.5) * 0.012 * k;
    },
    paint: (o, x, y, z, u) => mul(o, 0.8 + 0.3 * hash(Math.round(x * 40), Math.round(z * 40), 1)),
  });
  addWaistBelt(kit, D, bind, pal.secondary, pal.accentMetal, 'leather');
}

export function legs(E) {
  const { kit, D, pal, bind, skin, skinPaint, armor, ctx } = E;
  const dress = dressOf(E);
  const robed = dress === 'robe' || dress === 'peplos' || dress === 'himation';
  const knee = D.hipY - D.thigh;
  // a robe hides the leg above the knee
  addBareLegs(kit, D, bind, skin, skinPaint, robed ? knee + D.thigh * 0.4 : Infinity);
  addSandals(kit, D, pal, bind, {
    skin, skinPaint, sole: shadeC(pal.leather, 0.9),
    strap: ctx.mortal ? pal.leather : shadeC(pal.accentMetal, 0.9),
    ladder: dress === 'chiton' && ctx.mortal && !E.worker ? 3 : 0,
  });
  if (armor && !robed) addGreaves(kit, D, pal, bind, metalOf(E), trimOf(E));
}

export function torso(E) {
  switch (dressOf(E)) {
    case 'robe': robe(E); break;
    case 'kilt': kilt(E); break;
    case 'himation': himation(E); break;
    case 'peplos': peplos(E); break;
    case 'hoplite': hoplite(E); break;
    case 'titan': titan(E); break;
    case 'hide': hide(E); break;
    default: chiton(E);
  }
}

export function arms(E) {
  const { kit, D, ctx, pal, bind, armor, skin, skinPaint } = E;
  const dress = dressOf(E);
  const sleeved = (dress === 'robe' && !ctx.grand) || dress === 'chiton';
  const z0 = D.shoulderZ;
  for (const side of [1, -1]) {
    const bd = bind.arm[side];
    kit.loft(armStations(D, side), { rings: 8, start: null, end: null, color: skin, bind: bd, paint: skinPaint });
    if (sleeved) {
      // a short sleeve from the shoulder to the middle of the upper arm
      const color = dress === 'robe' ? E.tunicColor : ctx.sleeve || pal.primary;
      kit.loft(armStations(D, side, 0.009).slice(3), {
        rings: 4, start: null, end: 'round', capDepth: 0.012, color, bind: bd, paint: gradY(D.shoulderY - D.upper * 0.55, D.shoulderY, 0.9, 1),
      });
    }
    if (ctx.grand) {
      // a gold band round the upper arm
      const e = D.shoulderY - 0.02 - D.upper * 0.45;
      kit.loft([vs(e - 0.014, D.armR * 1.06 + 0.01, D.armR * 1.04 + 0.01, 0, side * z0), vs(e + 0.014, D.armR * 1.07 + 0.011, D.armR * 1.05 + 0.011, 0, side * z0)],
        { sides: 12, start: null, end: null, color: metalOf(E), bind: bd });
    }
    if (armor || ctx.grand) {
      const w = D.shoulderY - 0.02 - D.upper - D.fore;
      kit.loft([vs(w + 0.012, D.armR * 0.66 + 0.007, D.armR * 0.64 + 0.007, 0, side * z0), vs(w + D.fore * 0.52, D.armR * 0.86 + 0.007, D.armR * 0.84 + 0.007, 0.002, side * z0)],
        { sides: 12, rings: 3, start: null, end: null, color: ctx.mortal ? pal.leather : metalOf(E), mat: ctx.mortal ? 'leather' : undefined, bind: bd });
    }
  }
}

export function armorLayer(E) {
  const { kit, D, ctx, pal, bind, armor } = E;
  if (!armor) return;
  const metal = metalOf(E);
  const dress = dressOf(E);
  const trim = trimOf(E);
  addMuscleCuirass(kit, D, pal, bind, metal, trim, { medallion: dress === 'peplos' ? tintC(pal.glow, 0.2) : null });
  if (!ctx.mortal) addPauldrons(kit, D, pal, bind, metal, trim);
}

export function cloaks(E) {
  const { kit, D, ctx, pal, bind, ex } = E;
  if (ex.has('fur')) addFurMantle(kit, D, pal, bind);
  if (!ex.has('cape')) return;
  if (ctx.mortal) addChlamys(kit, D, TEAM(1), pal.secondary, shadeC(pal.secondary, 0.7), bind, pal.accentMetal);
  else addCape(kit, D, TEAM(1), pal.accent, shadeC(pal.secondary, 0.7), bind);
}

export function head(E) {
  const { kit, D, ctx, v, pal, bind, ex } = E;
  const gear = v.headgear;
  const mortal = ctx.mortal;
  const metal = metalOf(E);
  if (gear === 'helmet') {
    // the Corinthian helmet: bronze, cheek guards, a flared nape, a tall brush
    addHelmet(kit, D, pal, bind, { steel: metal, trim: trimOf(E), crest: 'brush', crestColor: mortal ? pal.primary : TEAM(1), neck: true });
  } else {
    addHairCap(kit, D, pal, bind);
    if (gear === 'laurel') addLaurel(kit, D, pal, bind, { leaf: mortal ? OLIVE : pal.accentMetal, mat: mortal ? 'cloth' : 'gold', per: mortal ? 8 : 9 });
    else if (gear === 'crown') {
      const king = ctx.cls === 'titan';
      addCrown(kit, D, pal, bind, { metal: pal.accentMetal, gem: king ? withMat('#b02a2a', 'gem') : mixC(pal.secondary, '#40c8b8', 0.5), points: king ? 7 : 5, height: king ? 1.3 : 1.1, band: king ? 0.034 : 0.028 });
    } else if (gear === 'tall_crown') {
      addTallCrown(kit, D, pal, bind, { metal: shadeC(pal.accentMetal, 0.62), trim: pal.accentMetal, gem: tintC(pal.glow, 0.15), spikes: 9, height: 0.7 });
    }
  }
  if (ex.has('long_hair')) addLongHair(kit, D, pal, bind);
  if (ex.has('beard')) addBeard(kit, D, pal, bind, E.lava);
}

/** The hoplon: a great round shield, a deep bowl faced in the team color with a bronze roundel and rim. */
export const shield = {
  w: 0.235, h: 0.235, sides: 20, face: 'team', pattern: 'rings', disc: { k: 0.42, color: 'metal' }, boss: null, dish: 0.05, rim: BRONZE, rimMat: 'gold',
};

export const GREEK = { legs, torso, arms, armor: armorLayer, cloaks, head, extras: DEFAULT.extras, shield };

void legStations;
