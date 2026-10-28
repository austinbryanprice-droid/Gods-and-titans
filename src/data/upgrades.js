// Building upgrades (DESIGN 4.3): one-time researches, each made at a building
// of one type and listed in that building's `upgrades` in buildings.js. Pure
// helpers turn the set of upgrades a player owns into stat changes; the sim
// applies them and the HUD shows the same numbers.
//
// Effect types:
//   { type: 'building', building, stat, amount }  stat: hp | armor | pop | range (flat),
//                                                  damage | faith | train (fraction, 0.25 = +25%)
//   { type: 'unit', classes?, units?, stat, amount } stat: damage | hp | speed (fraction), armor | regen (flat)
//   { type: 'carry', resource: 'g' | 'w', amount }  extra gold / wood per trip
//   { type: 'chop', amount }                         chopping speed (fraction faster)
//   { type: 'work', amount }                         Worshippers mine, chop, build and repair faster (fraction)
//   { type: 'godLevel', amount }                     levels added to newly summoned / revived gods
//   { type: 'perk', stat, amount }                   a pantheon trait the sim reads by name (PERK_STATS in schema.js)
//
// An upgrade line is a chain of levels researched one after the other: each level
// after the first names the previous one in `after` and every level carries the
// same `line` id and hotkey. The command card shows one button per line, always
// the next level to research (offeredUpgrades).
//
// Each pantheon also has blessings (`identity.blessings` in its data file): always-on effects in
// this same vocabulary, folded in by computeMods before any researched upgrade. A building effect
// whose `building` is '*' applies to every building type.
import { BUILDINGS } from './buildings.js';
import { researchHostOf } from './houses.js';
import { PANTHEONS } from './pantheon-list.js';
import { PERK_STATS } from './schema.js';
import { REVIVE_COST_MULT } from '../config.js';
import { getRelic } from './relics.js';

/** Every upgrade by id, each with the `building` that researches it. */
export const UPGRADES = {};
for (const b of Object.values(BUILDINGS)) {
  for (const up of b.upgrades || []) UPGRADES[up.id] = { ...up, building: b.id };
}

export function getUpgrade(id) {
  return typeof id === 'string' && Object.hasOwn(UPGRADES, id) ? UPGRADES[id] : null;
}

/** Upgrades researched at a building type, in card order (a Manor researches the House upgrades). */
export function upgradesFor(buildingId) {
  const host = researchHostOf(buildingId);
  const b = Object.hasOwn(BUILDINGS, host) ? BUILDINGS[host] : null;
  return b && b.upgrades ? b.upgrades.map((u) => UPGRADES[u.id]) : [];
}

const NO_BUILDING_MODS = Object.freeze({ hp: 0, armor: 0, pop: 0, range: 0, damage: 0, faith: 0, train: 0 });
const NO_UNIT_MODS = Object.freeze({ damage: 0, hp: 0, armor: 0, regen: 0, speed: 0 });

/**
 * Pantheon traits a perk effect can raise (PERK_STATS in schema.js), each read by one sim rule:
 *   plunder      share of a slain enemy's gold and wood cost the killer gets, as gold (sim/spoils.js)
 *   sacrifice    faith per population point of every enemy unit slain (sim/spoils.js)
 *   karma        faith per second from each worshipper at work (sim/spoils.js)
 *   shrineFaith  faith per second from each finished Shrine or Temple, up to a few (sim/spoils.js)
 *   buildSpeed   faster construction and repair (fraction)
 *   techSpeed    faster research and growing the Town Center (fraction)
 *   cooldown     shorter god and titan ability cooldowns (fraction)
 *   revive       cheaper, faster revival of fallen gods (fraction off the usual revive price)
 */
const NO_PERKS = Object.freeze(Object.fromEntries(PERK_STATS.map((k) => [k, 0])));

// A building made by combining others (the Manor, from four Houses) holds what they held: an effect on
// the House counts again for it, as many times as the Houses it replaced for what a building shelters
// and holds up (pop, hp), once for the rest (armor). An effect on every building ('*') reaches it directly.
const COMBINED = Object.values(BUILDINGS).filter((b) => b.mergesFrom);
const SUMMED_STATS = ['pop', 'hp'];

function addBuildingEffect(mods, id, stat, amount) {
  const m = mods.buildings[id] || (mods.buildings[id] = { ...NO_BUILDING_MODS });
  m[stat] += amount;
}

function addEffect(mods, e) {
  if (e.type === 'building') {
    for (const id of e.building === '*' ? Object.keys(BUILDINGS) : [e.building]) addBuildingEffect(mods, id, e.stat, e.amount);
    if (e.building !== '*') {
      for (const b of COMBINED) {
        if (b.mergesFrom.building === e.building) addBuildingEffect(mods, b.id, e.stat, SUMMED_STATS.includes(e.stat) ? e.amount * b.mergesFrom.count : e.amount);
      }
    }
  } else if (e.type === 'unit') mods.units.push(e);
  else if (e.type === 'carry') mods.carry[e.resource] += e.amount;
  else if (e.type === 'chop') mods.chop += e.amount;
  else if (e.type === 'work') mods.work += e.amount;
  else if (e.type === 'godLevel') mods.godLevel += e.amount;
  else if (e.type === 'perk') mods.perks[e.stat] += e.amount;
}

/** A pantheon's blessings (its identity's always-on effects), or [] for none / an unknown id. */
export function blessingsOf(pantheonId) {
  const p = typeof pantheonId === 'string' && Object.hasOwn(PANTHEONS, pantheonId) ? PANTHEONS[pantheonId] : null;
  return (p && p.identity && p.identity.blessings) || [];
}

/**
 * Combined effects of a pantheon's blessings, a list of owned upgrade ids and the relics resting in
 * the player's Temples (data/relics.js; unknown ids are ignored).
 * @param {string[]} ids
 * @param {string|null} [pantheonId]
 * @param {string[]} [relics]
 */
export function computeMods(ids, pantheonId = null, relics = null) {
  const mods = { buildings: {}, units: [], carry: { g: 0, w: 0 }, chop: 0, work: 0, godLevel: 0, perks: { ...NO_PERKS } };
  for (const bl of blessingsOf(pantheonId)) for (const e of bl.effects) addEffect(mods, e);
  for (const id of ids || []) {
    const up = getUpgrade(id);
    if (up) for (const e of up.effects) addEffect(mods, e);
  }
  for (const id of relics || []) {
    const r = getRelic(id);
    if (r) for (const e of r.effects) addEffect(mods, e);
  }
  return mods;
}

export const NO_MODS = computeMods([]);

/** Stat changes for a building type. */
export function buildingMods(mods, typeId) {
  return (mods && mods.buildings[typeId]) || NO_BUILDING_MODS;
}

/** Fraction of a fallen god's price (and summoning time) that reviving it costs. */
export function reviveMult(mods) {
  return REVIVE_COST_MULT * (1 - ((mods && mods.perks && mods.perks.revive) || 0));
}

/**
 * Stat changes for a unit type: damage, hp and speed as fractions, armor and regen flat.
 * A pantheon's elite soldier lists the mortal it `kin`s with (warrior, archer), so it is
 * covered by every effect that names that mortal.
 */
export function unitMods(mods, def) {
  if (!mods || !def || !mods.units.length) return NO_UNIT_MODS;
  let out = null;
  for (const e of mods.units) {
    if (!(e.units ? e.units.includes(def.id) || (def.kin && e.units.includes(def.kin)) : e.classes && e.classes.includes(def.class))) continue;
    if (!out) out = { ...NO_UNIT_MODS };
    out[e.stat] += e.amount;
  }
  return out || NO_UNIT_MODS;
}

/** How much faster Worshippers mine, build and repair (1 = normal; Work Songs and its later levels raise it). */
export function workSpeed(mods) {
  return 1 + (mods ? mods.work : 0);
}

/** How much faster Worshippers chop: Sharpened Axes on top of the general work speed. */
export function chopSpeed(mods) {
  return mods ? (1 + mods.chop) * (1 + mods.work) : 1;
}

/** Levels of an upgrade line at its building, in order ([] for an upgrade that is not part of a line). */
export function lineOf(up) {
  if (!up || !up.line) return [];
  return upgradesFor(up.building).filter((u) => u.line === up.line);
}

/**
 * The upgrades a building's command card offers, given the upgrade ids the
 * player owns: every single upgrade, and of each line only the next level to
 * research (the last level once the whole line is done). Card order follows the
 * order of `upgrades` in buildings.js, a line standing where its first level does.
 */
export function offeredUpgrades(buildingId, owned) {
  const have = owned instanceof Set ? owned : new Set(owned || []);
  const out = [];
  const lineAt = new Map();
  for (const up of upgradesFor(buildingId)) {
    if (!up.line) {
      out.push(up);
      continue;
    }
    const i = lineAt.get(up.line);
    if (i === undefined) {
      lineAt.set(up.line, out.length);
      out.push(up);
    } else if (have.has(out[i].id)) out[i] = up;
  }
  return out;
}
