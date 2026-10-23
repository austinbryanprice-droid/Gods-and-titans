// What a rich humanoid wears. buildRichTemplate (rich-humanoid.js) makes the body, then asks
// the unit's pantheon for each layer in turn: legs, torso, arms, armor, cloaks, head. A
// pantheon file overrides only the layers where its people dress differently from the
// default (the Norse look: wool tunics and trousers, boots, fur, cuirasses with pauldrons);
// the others fall through. Every layer takes the dressing environment E:
//   { kit, D, ctx, v, pal, ex, bind, spec, skin, skinPaint, lava, bare, worker, armor, robe, tunicColor }
// and adds primitives to E.kit.
import { TEAM, shadeC, mixC } from './unit-geo.js';
import { vs } from './rich-kit.js';
import {
  legStations, legFrom, bootTop, armStations, torsoStations, addBoots,
} from './rich-body.js';
import {
  addTunic, addBelt, addCuirass, addPauldrons, addFurMantle, addCape,
} from './rich-clothing.js';
import {
  addHairCap, addLongHair, addBeard, addHood, addHornedHelm, addHornPair,
} from './rich-headgear.js';
import { gradY } from './rich-paint.js';

/** Forged black iron (a fire giant's armor). */
export const IRON = '#37292a';

// ---------------------------------------------------------------------------
// the default look (Norse)
// ---------------------------------------------------------------------------

function legs(E) {
  const { kit, D, pal, bind, ex, bare, robe, skin, skinPaint, lava } = E;
  if (bare) {
    for (const side of [1, -1]) kit.loft(legStations(D, side), { rings: 8, start: null, end: null, color: skin, bind: bind.leg[side], paint: skinPaint });
    addBoots(kit, D, pal, bind, lava ? IRON : ex.has('armor') ? shadeC(pal.accentMetal, 0.7) : shadeC(skin, 0.8), null);
  } else if (robe) {
    addBoots(kit, D, pal, bind, pal.leather, shadeC(pal.leather, 0.8));
  } else {
    const pants = shadeC(pal.primary, 0.78);
    for (const side of [1, -1]) {
      kit.loft(legFrom(D, side, 0.011, bootTop(D) - 0.012), { rings: 7, start: null, end: null, color: pants, bind: bind.leg[side], paint: gradY(0.2, D.hipY, 0.85, 1) });
    }
    addBoots(kit, D, pal, bind, pal.leather, shadeC(pal.leather, 0.85));
  }
}

function torso(E) {
  const { kit, D, ctx, pal, bind, ex, bare, robe, armor, skin, skinPaint, tunicColor } = E;
  if (bare && !armor) {
    kit.loft(torsoStations(D), { rings: 11, start: null, end: 'round', color: skin, bind: bind.torso, paint: skinPaint });
    return;
  }
  if (robe) {
    addTunic(kit, D, tunicColor, bind, 0.04);
    // long skirt to the boots
    const y0 = D.ankleY + 0.05;
    const st = [vs(y0, D.depth * 0.5 + 0.12, D.waistW * 0.5 + 0.13), vs(y0 + 0.12, D.depth * 0.5 + 0.09, D.waistW * 0.5 + 0.1), vs(D.hipY - 0.04, D.depth * 0.5 + 0.045, D.waistW * 0.5 + 0.055), vs(D.hipY + 0.07, D.depth * 0.5 + 0.02, D.waistW * 0.5 + 0.025)];
    kit.loft(st, {
      rings: 7, sides: 18, start: null, end: null, color: ctx.skirt || pal.primary, bind: bind.skirt,
      warp: (p, a, u) => {
        const k = 1 - u;
        const s = Math.sin(a * 9) * 0.006 * k;
        p[0] += Math.cos(a) * s;
        p[2] += Math.sin(a) * s;
      },
      paint: gradY(y0, D.hipY, 0.8, 1),
    });
    kit.loft([vs(y0 - 0.002, D.depth * 0.5 + 0.126, D.waistW * 0.5 + 0.136), vs(y0 + 0.03, D.depth * 0.5 + 0.119, D.waistW * 0.5 + 0.129)],
      { sides: 18, start: null, end: null, color: pal.secondary, bind: bind.skirt });
  } else {
    addTunic(kit, D, tunicColor, bind, armor && ctx.mortal ? 0.02 : 0.09);
    if (armor && ctx.mortal) {
      // pteruges: a short team kilt of leather-edged strips under the cuirass
      const y1 = D.hipY - 0.12;
      kit.loft([vs(y1, D.depth * 0.5 + 0.075, D.waistW * 0.5 + 0.09), vs(D.hipY + 0.02, D.depth * 0.5 + 0.035, D.waistW * 0.5 + 0.04)],
        { sides: 18, rings: 3, start: null, end: null, color: TEAM(0.8), bind: bind.skirt,
          warp: (p, a, u) => { const s = Math.sin(a * 12) * 0.005 * (1 - u); p[0] += Math.cos(a) * s; p[2] += Math.sin(a) * s; } });
      kit.loft([vs(y1 - 0.004, D.depth * 0.5 + 0.077, D.waistW * 0.5 + 0.092), vs(y1 + 0.022, D.depth * 0.5 + 0.073, D.waistW * 0.5 + 0.088)],
        { sides: 18, start: null, end: null, color: pal.leather, mat: 'leather', bind: bind.skirt });
    } else if (ctx.grand) {
      // a long tabard front and back, with a metal hem
      for (const dir of [1, -1]) {
        const x0 = dir * (D.depth * 0.5 + 0.03);
        kit.sheet(4, 5, (u, vv, out) => {
          out[0] = x0 + dir * 0.012 * vv;
          out[1] = D.hipY + 0.05 - vv * 0.3;
          out[2] = (u - 0.5) * D.waistW * 0.78 * (1 + 0.1 * vv);
          if (dir < 0) out[2] = -out[2];
        }, { thick: 0.007, color: TEAM(0.9), inner: shadeC(pal.secondary, 0.8), bind: bind.skirt, flip: dir });
      }
    }
  }
  addBelt(kit, D, pal, bind);
  void ex;
}

function arms(E) {
  const { kit, D, ctx, pal, bind, armor, bare, skin, skinPaint } = E;
  for (const side of [1, -1]) {
    const bd = bind.arm[side];
    if (bare) {
      kit.loft(armStations(D, side), { rings: 8, start: null, end: null, color: skin, bind: bd, paint: skinPaint });
    } else {
      // forearm skin, sleeve over the upper arm
      kit.loft(armStations(D, side).slice(0, 4), { rings: 5, start: null, end: null, color: skin, bind: bd });
      const sleeveColor = ctx.sleeve || (armor ? shadeC(pal.primary, 0.9) : pal.primary);
      kit.loft(armStations(D, side, 0.009, 'elbow'), {
        rings: 5, start: null, end: 'round', capDepth: 0.012, color: sleeveColor, bind: bd, paint: gradY(D.shoulderY - D.upper - 0.05, D.shoulderY, 0.9, 1),
      });
      // sleeve cuff
      const e = D.shoulderY - 0.02 - D.upper;
      kit.loft([vs(e - 0.012, D.armR * 0.96 + 0.012, D.armR * 0.94 + 0.012, 0, side * D.shoulderZ), vs(e + 0.03, D.armR * 1.02 + 0.014, D.armR * 1.0 + 0.014, 0, side * D.shoulderZ)],
        { sides: 12, start: null, end: null, color: ctx.sleeveTrim || pal.leather, bind: bd });
    }
    if (armor || ctx.grand) {
      // bracer
      const w = D.shoulderY - 0.02 - D.upper - D.fore;
      kit.loft([vs(w + 0.012, D.armR * 0.66 + 0.007, D.armR * 0.64 + 0.007, 0, side * D.shoulderZ), vs(w + D.fore * 0.52, D.armR * 0.86 + 0.007, D.armR * 0.84 + 0.007, 0.002, side * D.shoulderZ)],
        { sides: 12, rings: 3, start: null, end: null, color: ctx.mortal ? pal.leather : pal.accentMetal, mat: ctx.mortal ? 'leather' : undefined, bind: bd });
    }
  }
}

function armorLayer(E) {
  const { kit, D, ctx, pal, bind, armor, lava } = E;
  if (!armor) return;
  if (lava) {
    // forged black iron with the fire showing at every edge
    addCuirass(kit, D, pal, bind, IRON, pal.fire, 0.9);
    addPauldrons(kit, D, pal, bind, IRON, pal.fire, 0.9);
  } else {
    addCuirass(kit, D, pal, bind, ctx.mortal ? mixC(pal.accentMetal, '#8a93a0', 0.35) : pal.accentMetal, shadeC(pal.accentMetal, 0.7));
    addPauldrons(kit, D, pal, bind, ctx.mortal ? shadeC(pal.accentMetal, 0.8) : pal.accentMetal, shadeC(pal.leather, 1));
  }
}

function cloaks(E) {
  const { kit, D, ctx, pal, bind, ex } = E;
  if (ex.has('fur')) addFurMantle(kit, D, pal, bind);
  if (ex.has('cape')) addCape(kit, D, TEAM(1), ctx.grand ? pal.accent : pal.secondary, shadeC(pal.secondary, 0.7), bind);
}

function head(E) {
  const { kit, D, ctx, v, pal, bind, ex, lava, worker } = E;
  const gear = v.headgear;
  const hoodColor = ctx.mortal ? (worker ? pal.secondary : shadeC(pal.primary, ctx.cls === 'support' ? 0.95 : 0.8)) : pal.secondary;
  if (gear === 'hood') addHood(kit, D, pal, bind, hoodColor, pal.secondary);
  else if (gear === 'horned_helmet') addHornedHelm(kit, D, pal, bind, pal.accentMetal, shadeC(pal.accentMetal, 0.7), pal.horn);
  else if (lava) {
    // a fire giant has no hair: its mane is flame (flameMane), over great swept horns
    addHornPair(kit, D, bind, mixC(pal.bone, '#2a1814', 0.35), 0, 1.15);
  } else {
    addHairCap(kit, D, pal, bind);
    if (gear === 'horns') addHornPair(kit, D, bind, pal.horn, 0.012 * D.hs);
  }
  // hair peeking out under a hood or helmet is left to the beard and long hair
  if (ex.has('long_hair') && gear !== 'hood') addLongHair(kit, D, pal, bind);
  if (ex.has('beard')) addBeard(kit, D, pal, bind, lava);
}

const DEFAULT = { legs, torso, arms, armor: armorLayer, cloaks, head };

/** Pantheon files register their overrides here (rich-outfits-<pantheon>.js, imported below). */
export const OUTFITS = {};

/** The ordered layer functions for a pantheon. */
export function outfitFor(pantheon) {
  return { ...DEFAULT, ...(OUTFITS[pantheon] || {}) };
}

export const LAYERS = ['legs', 'torso', 'arms', 'armor', 'cloaks', 'head'];
