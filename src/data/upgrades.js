// Building upgrades (DESIGN 4.3): one-time researches, each made at a building
// of one type and listed in that building's `upgrades` in buildings.js. Pure
// helpers turn the set of upgrades a player owns into stat changes; the sim
// applies them and the HUD shows the same numbers.
//
// Effect types:
//   { type: 'building', building, stat, amount }  stat: hp | armor | pop | range (flat),
//                                                  damage | faith | train (fraction, 0.25 = +25%)
//   { type: 'unit', classes?, units?, stat, amount } stat: damage | hp (fraction), armor | regen (flat)
//   { type: 'carry', resource: 'g' | 'w', amount }  extra gold / wood per trip
//   { type: 'chop', amount }                         chopping speed (fraction faster)
//   { type: 'godLevel', amount }                     levels added to newly summoned / revived gods
import { BUILDINGS } from './buildings.js';

/** Every upgrade by id, each with the `building` that researches it. */
export const UPGRADES = {};
for (const b of Object.values(BUILDINGS)) {
  for (const up of b.upgrades || []) UPGRADES[up.id] = { ...up, building: b.id };
}

export function getUpgrade(id) {
  return typeof id === 'string' && Object.hasOwn(UPGRADES, id) ? UPGRADES[id] : null;
}

/** Upgrades researched at a building type, in card order. */
export function upgradesFor(buildingId) {
  const b = Object.hasOwn(BUILDINGS, buildingId) ? BUILDINGS[buildingId] : null;
  return b && b.upgrades ? b.upgrades.map((u) => UPGRADES[u.id]) : [];
}

const NO_BUILDING_MODS = Object.freeze({ hp: 0, armor: 0, pop: 0, range: 0, damage: 0, faith: 0, train: 0 });
const NO_UNIT_MODS = Object.freeze({ damage: 0, hp: 0, armor: 0, regen: 0 });

/**
 * Combined effects of a list of owned upgrade ids (unknown ids are ignored).
 * @param {string[]} ids
 */
export function computeMods(ids) {
  const mods = { buildings: {}, units: [], carry: { g: 0, w: 0 }, chop: 0, godLevel: 0 };
  for (const id of ids || []) {
    const up = getUpgrade(id);
    if (!up) continue;
    for (const e of up.effects) {
      if (e.type === 'building') {
        const m = mods.buildings[e.building] || (mods.buildings[e.building] = { ...NO_BUILDING_MODS });
        m[e.stat] += e.amount;
      } else if (e.type === 'unit') mods.units.push(e);
      else if (e.type === 'carry') mods.carry[e.resource] += e.amount;
      else if (e.type === 'chop') mods.chop += e.amount;
      else if (e.type === 'godLevel') mods.godLevel += e.amount;
    }
  }
  return mods;
}

export const NO_MODS = computeMods([]);

/** Stat changes for a building type. */
export function buildingMods(mods, typeId) {
  return (mods && mods.buildings[typeId]) || NO_BUILDING_MODS;
}

/** Stat changes for a unit type: damage and hp as fractions, armor and regen flat. */
export function unitMods(mods, def) {
  if (!mods || !def || !mods.units.length) return NO_UNIT_MODS;
  let out = null;
  for (const e of mods.units) {
    if (!(e.units ? e.units.includes(def.id) : e.classes && e.classes.includes(def.class))) continue;
    if (!out) out = { ...NO_UNIT_MODS };
    out[e.stat] += e.amount;
  }
  return out || NO_UNIT_MODS;
}

