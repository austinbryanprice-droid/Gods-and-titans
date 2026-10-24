// A human head for a beast's body (the sphinx, the lamassu): the rich humanoid's face and headgear (rich-body.js,
// rich-headgear.js) built in a nominal human frame and placed on the creature's neck by `kit.placed`, scaled to the beast.
import * as THREE from 'three';
import { shadeC, mixC, withMat } from './unit-geo.js';
import { richDims, addHeadAndNeck } from './rich-body.js';
import { addNemes, addHornedTiara, addCurledBeard, addBeard, addUraeus } from './rich-headgear.js';
import { frameMatrix } from './rich-creature-kit.js';
import { ps } from './rich-kit.js';
import { recolor } from './rich-paint.js';

const GOLD = withMat('#dfb54a', 'gold');

/** The headgear a human head may wear on a beast's body. */
export const HUMAN_HEADGEAR = new Set(['none', 'nemes', 'tall_crown']);

/**
 * Build a human head into `kit`. The face looks along +X from `at` (the skull's base on the neck), pitched `pitch`, `scale`
 * times a human head. o: { ctx, at, pitch, scale, bind: { head, neck }, forward (how far the face centre stands in front of
 * `at`, in model units), up }.
 */
export function humanHead(kit, o) {
  const { ctx, pal } = o;
  const { v, ex } = ctx;
  const D = richDims(ctx, 'humanoid');
  const hs = D.hs;
  const bind = { head: o.bind.head, neck: o.bind.neck ?? o.bind.head, hair: o.bind.head };
  // the human frame: origin at the face's centre; moved so that the skull's base (0.07 below it) sits on `at`
  const to = new THREE.Matrix4().makeTranslation(-D.headX, -D.headCY + 0.07 * hs, 0);
  const M = frameMatrix(o.at, o.pitch ?? 0, 0, o.scale).multiply(to);
  kit.placed(M, () => {
    addHeadAndNeck(kit, D, pal, ctx, bind, null, { neck: false });
    const gear = v.headgear;
    const mes = ctx.unit.pantheon === 'mesopotamian';
    const gold = pal.accentMetal ? withMat(shadeC(pal.accentMetal, 1), 'gold') : GOLD;
    if (gear === 'nemes') {
      const cloth = mixC(pal.skin, '#cdb27a', 0.35);
      addNemes(kit, D, pal, bind, { cloth, stripe: pal.secondary, trim: gold, tail: false, lappets: false });
      // the headcloth flares out from the temples in a wide striped wing on each side
      for (const side of [1, -1]) {
        kit.loft([
          ps(D.headX - 0.01 * hs, D.headCY + 0.01 * hs, side * 0.1 * hs, 0.012 * hs, 0.05 * hs),
          ps(D.headX + 0.0 * hs, D.headCY - 0.07 * hs, side * 0.135 * hs, 0.012 * hs, 0.075 * hs),
          ps(D.headX + 0.012 * hs, D.headCY - 0.16 * hs, side * 0.165 * hs, 0.012 * hs, 0.09 * hs),
          ps(D.headX + 0.03 * hs, D.headCY - 0.25 * hs, side * 0.18 * hs, 0.01 * hs, 0.085 * hs),
        ], {
          ref: [1, 0, 0], rings: 7, sides: 8, start: 'round', end: 'flat', capDepth: 0.004 * hs, color: cloth, bind: bind.neck,
          paint: (oo, x, y, z, u) => {
            if (Math.floor(u * 9) % 2 === 1) recolor(oo, pal.secondary, 1);
          },
        });
      }
    } else if (gear === 'tall_crown') {
      if (mes) addHornedTiara(kit, D, pal, bind, { cap: shadeC(pal.primary, 1.1), horn: GOLD, trim: GOLD, tiers: 2, tall: 0.62 });
      else addUraeus(kit, D, bind, gold);
    }
    if (ex.has('beard')) {
      if (mes) addCurledBeard(kit, D, pal, bind, { len: 0.58, wide: 0.82, color: mixC(pal.hair, '#6b5240', 0.3) });
      else addBeard(kit, D, pal, bind);
    }
  });
  return D;
}

