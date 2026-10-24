// Pantheon looks for the shared mortals (data/pantheons/<id>.js `looks`): a Greek
// Warrior and a Norse Warrior have the same stats but wear their own colors and gear.
// Render-only: the sim and the data registry never see the dressed copies.
import { PANTHEONS } from '../../data/pantheon-list.js';

const DRESSED = new Map(); // `${pantheon}|${unit id}` → unit type with the look folded into its visual

/**
 * The unit type to build a model from for a unit owned by a player of `pantheonId`:
 * the shared mortal with that pantheon's look laid over its visual (colors merge key by
 * key, every other key replaces), or `unitType` itself when there is nothing to change.
 * The copy is cached, so the model template cache (which keys on the visual) shares it.
 */
export function unitLook(unitType, pantheonId) {
  if (!pantheonId || unitType.pantheon) return unitType;
  const look = PANTHEONS[pantheonId]?.looks?.[unitType.id];
  if (!look) return unitType;
  const key = `${pantheonId}|${unitType.id}`;
  let dressed = DRESSED.get(key);
  if (!dressed || dressed.base !== unitType) {
    const { colors, ...rest } = look;
    const visual = { ...unitType.visual, ...rest, colors: { ...unitType.visual.colors, ...colors } };
    // lookOf: whose look this is, for the rich outfits (rich-outfits.js), which dress by pantheon
    dressed = { base: unitType, def: { ...unitType, visual, lookOf: pantheonId } };
    DRESSED.set(key, dressed);
  }
  return dressed.def;
}
