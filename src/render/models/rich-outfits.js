// The pantheon outfits: what each people's rich characters wear. `outfitFor(pantheon)` is the
// default look (rich-outfit-default.js, the Norse) with that pantheon's overrides laid over it:
// a pantheon file exports only the layers (legs, torso, arms, armor, cloaks, head, extras) in
// which its people dress differently, and may set `shield` (a richShield style, rich-gear.js) and
// `skinPaint(E)` (a paint for every bare surface of the body, made before the body is built).
import { DEFAULT, LAYERS } from './rich-outfit-default.js';
import { GREEK } from './rich-outfits-greek.js';
import { EGYPTIAN } from './rich-outfits-egyptian.js';

export { LAYERS };

/** Pantheon id -> its overrides. */
export const OUTFITS = { greek: GREEK, egyptian: EGYPTIAN };

/** The layer functions (and shield style) for a pantheon. */
export function outfitFor(pantheon) {
  return { ...DEFAULT, ...(OUTFITS[pantheon] || {}) };
}
