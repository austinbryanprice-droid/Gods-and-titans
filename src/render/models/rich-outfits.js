// The pantheon outfits: what each people's rich characters wear. `outfitFor(pantheon)` is the
// default look (rich-outfit-default.js, the Norse) with that pantheon's overrides laid over it:
// a pantheon file exports only the layers (legs, torso, arms, armor, cloaks, head, extras) in
// which its people dress differently, and may set `shield` (a richShield style, rich-gear.js, or a function of the
// unit's build context that returns one: the sun god's shield is not the soldiers'),
// `skinPaint(E)` (a paint for every bare surface of the body, made before the body is built),
// `palette(pal, ctx)` (the unit's palette recolored: black hair, the people's skin) and `gear(ctx, item, side)` (options for a
// held item in the right hand (side 1) or the left (-1): an iron club, a feather fan, a drum in one hand and its stick in the
// other; `build: true` has rich-gear.js build a weapon it does not build for everyone: the Celts' double axe and torch), and,
// for the bodies that need them, `hands(E)` (in place of the default hands) and `face(E)` (a function of the face surface that builds
// the eyes and mouth in place of the default ones): the spirits'.
import { DEFAULT, LAYERS } from './rich-outfit-default.js';
import { GREEK } from './rich-outfits-greek.js';
import { EGYPTIAN } from './rich-outfits-egyptian.js';
import { HINDU } from './rich-outfits-hindu.js';
import { JAPANESE } from './rich-outfits-japanese.js';
import { CHINESE } from './rich-outfits-chinese.js';
import { AZTEC } from './rich-outfits-aztec.js';
import { CELTIC } from './rich-outfits-celtic.js';
import { MESOPOTAMIAN } from './rich-outfits-mesopotamian.js';
import { WEST_AFRICAN } from './rich-outfits-west-african.js';
import { SPIRIT } from './rich-spirit.js';

export { LAYERS };

/** Pantheon id -> its overrides. */
export const OUTFITS = { greek: GREEK, egyptian: EGYPTIAN, hindu: HINDU, japanese: JAPANESE, chinese: CHINESE, aztec: AZTEC, celtic: CELTIC, mesopotamian: MESOPOTAMIAN, west_african: WEST_AFRICAN };

/**
 * The layer functions (and shield style, or the function that makes one) for a pantheon. A spirit (the body 'spirit') wears
 * the one look of rich-spirit.js whatever its people: the dead are not dressed by their pantheon.
 */
export function outfitFor(pantheon, body = null) {
  if (body === 'spirit') return { ...DEFAULT, ...SPIRIT };
  return { ...DEFAULT, ...(OUTFITS[pantheon] || {}) };
}
