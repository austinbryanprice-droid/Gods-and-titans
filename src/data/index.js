// Data registry: every unit, building and pantheon in one place.
import { MORTALS } from './mortals.js';
import { BUILDINGS, GOLD_MINE, BUILD_MENU } from './buildings.js';
import { UPGRADES } from './upgrades.js';
import { validatePantheon, validateUnit, validateUpgrade, validateUpgradeLines } from './schema.js';
import greek from './pantheons/greek.js';
import norse from './pantheons/norse.js';
import egyptian from './pantheons/egyptian.js';
import hindu from './pantheons/hindu.js';
import japanese from './pantheons/japanese.js';
import chinese from './pantheons/chinese.js';
import aztec from './pantheons/aztec.js';
import celtic from './pantheons/celtic.js';
import mesopotamian from './pantheons/mesopotamian.js';
import west_african from './pantheons/west_african.js';

export { BUILDINGS, GOLD_MINE, BUILD_MENU, MORTALS, UPGRADES };

export const PANTHEON_LIST = [greek, norse, egyptian, hindu, japanese, chinese, aztec, celtic, mesopotamian, west_african];
export const PANTHEONS = Object.fromEntries(PANTHEON_LIST.map((p) => [p.id, p]));

/** Every unit type by id: mortals plus each pantheon's gods, titan, creatures and minions. */
export const UNITS = { ...MORTALS };
for (const p of PANTHEON_LIST) {
  for (const u of [...p.gods, p.titan, ...p.creatures, ...(p.minions || [])]) UNITS[u.id] = u;
}

/** Every ability by id (abilities are owned by units). */
export const ABILITIES = {};
for (const u of Object.values(UNITS)) for (const a of u.abilities) ABILITIES[a.id] = { ...a, ownerType: u.id };

export function getUnitType(id) {
  return UNITS[id] || null;
}
export function getBuildingType(id) {
  return BUILDINGS[id] || null;
}
export function getPantheon(id) {
  return PANTHEONS[id] || null;
}
export function godsFor(pantheonId) {
  return PANTHEONS[pantheonId]?.gods || [];
}
export function creaturesFor(pantheonId) {
  return PANTHEONS[pantheonId]?.creatures || [];
}
export function titanFor(pantheonId) {
  return PANTHEONS[pantheonId]?.titan || null;
}

/**
 * Unit type ids a building of `buildingId` can produce for a player of `pantheonId`.
 * Resolves the 'creatures' | 'gods' | 'titan' shorthands.
 */
export function producibleAt(buildingId, pantheonId) {
  const b = BUILDINGS[buildingId];
  if (!b) return [];
  if (Array.isArray(b.produces)) return b.produces;
  if (b.produces === 'creatures') return creaturesFor(pantheonId).map((u) => u.id);
  if (b.produces === 'gods') return godsFor(pantheonId).map((u) => u.id);
  if (b.produces === 'titan') return titanFor(pantheonId) ? [titanFor(pantheonId).id] : [];
  return [];
}

/** Experience granted to nearby enemy gods when a unit of this type dies. */
export function xpValue(unitType, level = 1) {
  if (unitType.class === 'god') return 100 * level;
  if (unitType.class === 'titan') return 400;
  return Math.round(10 * unitType.pop + unitType.hp / 40);
}

/** Validate all data. Returns an array of error strings (empty when valid). */
export function validateData() {
  const errors = [];
  const unitIds = new Set(Object.keys(UNITS));
  for (const u of Object.values(MORTALS)) validateUnit(u, errors, unitIds);
  const seen = new Set();
  for (const p of PANTHEON_LIST) {
    validatePantheon(p, errors, unitIds);
    for (const u of [...p.gods, p.titan, ...p.creatures, ...(p.minions || [])]) {
      if (seen.has(u.id)) errors.push(`duplicate unit id ${u.id}`);
      seen.add(u.id);
    }
  }
  const abilityIds = new Set();
  for (const u of Object.values(UNITS)) for (const a of u.abilities) {
    if (abilityIds.has(a.id)) errors.push(`duplicate ability id ${a.id}`);
    abilityIds.add(a.id);
  }
  const upgradeIds = new Set();
  for (const b of Object.values(BUILDINGS)) {
    for (const up of b.upgrades || []) {
      if (upgradeIds.has(up.id)) errors.push(`duplicate upgrade id ${up.id}`);
      upgradeIds.add(up.id);
      validateUpgrade(up, b.id, errors, unitIds);
    }
    validateUpgradeLines(b, errors);
  }
  return errors;
}
