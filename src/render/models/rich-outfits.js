// The pantheon outfits: what each people's rich characters wear. `outfitFor(pantheon)` is the
// default look (rich-outfit-default.js, the Norse) with that pantheon's overrides laid over it:
// a pantheon file exports only the layers (legs, torso, arms, armor, cloaks, head, extras) in
// which its people dress differently, and may set `shield` (a richShield style, rich-gear.js, or a function of the
// unit's build context that returns one: the sun god's shield is not the soldiers'),
// `skinPaint(E)` (a paint for every bare surface of the body, made before the body is built),
// `palette(pal, ctx)` (the unit's palette recolored: black hair) and `gear(ctx, item)` (options for a
// held item: an iron club, a feather fan; `build: true` has rich-gear.js build a weapon it does not
// build for everyone: the Celts' double axe and torch).
import { DEFAULT, LAYERS } from './rich-outfit-default.js';
import { GREEK } from './rich-outfits-greek.js';
import { EGYPTIAN } from './rich-outfits-egyptian.js';
import { HINDU } from './rich-outfits-hindu.js';
import { JAPANESE } from './rich-outfits-japanese.js';
import { CHINESE } from './rich-outfits-chinese.js';
import { AZTEC } from './rich-outfits-aztec.js';
import { CELTIC } from './rich-outfits-celtic.js';
import { MESOPOTAMIAN } from './rich-outfits-mesopotamian.js';

export { LAYERS };

/** Pantheon id -> its overrides. */
export const OUTFITS = { greek: GREEK, egyptian: EGYPTIAN, hindu: HINDU, japanese: JAPANESE, chinese: CHINESE, aztec: AZTEC, celtic: CELTIC, mesopotamian: MESOPOTAMIAN };

/** The layer functions (and shield style, or the function that makes one) for a pantheon. */
export function outfitFor(pantheon) {
  return { ...DEFAULT, ...(OUTFITS[pantheon] || {}) };
}
