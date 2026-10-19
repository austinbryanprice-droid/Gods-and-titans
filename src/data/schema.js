// Vocabulary and validation for game data. The content files, the simulation,
// the AI and the 3D model builders all agree on the values listed here.
// See DESIGN.md section 4 for field meanings.

export const UNIT_CLASSES = ['worker', 'infantry', 'ranged', 'support', 'siege', 'creature', 'god', 'titan', 'minion'];

export const PRODUCED_AT = ['town_center', 'barracks', 'shrine', 'temple', 'titan_gate', null];

export const PROJECTILES = [null, 'arrow', 'spear', 'orb', 'bolt', 'rock', 'fireball', 'feather', 'wave', 'skull', 'sunray', 'moonbeam', 'leaf', 'ice'];

export const ELEMENTS = ['lightning', 'fire', 'water', 'holy', 'sun', 'shadow', 'death', 'nature', 'wind', 'earth', 'ice', 'war', 'moon', 'chaos', 'physical', 'sand', 'poison', 'arcane'];

// ---- Abilities ----
export const ABILITY_KEYS = ['Q', 'W', 'E', 'R'];
export const ABILITY_TARGETS = ['none', 'point', 'unit', 'ally', 'enemy'];
export const EFFECT_TYPES = [
  'damage', 'heal', 'stun', 'slow', 'buff', 'dot', 'field', 'summon', 'chain', 'line',
  'knockback', 'pull', 'blink', 'dash', 'shield', 'invulnerable', 'reveal', 'resource',
];
export const EFFECT_AT = ['target', 'self'];
export const EFFECT_AFFECTS = ['enemies', 'allies', 'all', 'self'];
export const BUFF_STATS = ['damage', 'armor', 'speed', 'attackSpeed', 'lifesteal', 'regen'];
export const VFX_SHAPES = [
  'strike', 'nova', 'beam', 'cone', 'wave', 'field', 'buff', 'summon', 'blink', 'projectile',
  'meteor', 'heal', 'chain', 'quake', 'storm', 'shield', 'dash',
];
export const AI_USES = ['damage', 'heal', 'buff', 'cc', 'summon', 'escape', 'economy'];

export const PASSIVE_TYPES = ['aura', 'regen', 'lifesteal', 'cleave', 'thorns', 'evasion', 'critical', 'onHitSlow', 'onHitDot'];

// ---- Visual spec vocabulary (procedural low-poly models) ----
export const BODIES = [
  'humanoid', // two-legged person; default for mortals and most gods
  'giant', // bulky humanoid with thick limbs, for titans and big brutes
  'quadruped', // four-legged animal: wolf, lion, horse, dog, boar, bull
  'centaur', // horse body with humanoid torso
  'serpent', // long segmented snake (naga uses humanoid torso + serpent tail: use 'naga')
  'naga', // humanoid torso on a serpent tail
  'bird', // winged bird or winged beast in flight
  'insect', // beetle / scorpion style, six legs
  'spirit', // floating ghostly figure with no legs, translucent
  'hydra', // multi-headed serpent body; heads = count
  'dragon', // long winged or wingless dragon
  'elephant', // elephant body
  'beast_biped', // upright beast: minotaur, oni, monkey warrior
  'ram', // siege vehicle: wheeled frame with a log
];
export const HEADS = [
  'human', 'jackal', 'falcon', 'bull', 'lion', 'monkey', 'fox', 'wolf', 'bird', 'serpent', 'skull',
  'cat', 'crocodile', 'ram', 'boar', 'horse', 'elephant', 'dragon', 'demon', 'none',
];
export const HEADGEAR = [
  'none', 'crown', 'laurel', 'helmet', 'horned_helmet', 'winged_helmet', 'sun_disk', 'crescent', 'feathers',
  'hood', 'nemes', 'halo', 'antlers', 'horns', 'topknot', 'veil', 'tiara', 'flame', 'tall_crown', 'headdress',
];
export const WEAPONS = [
  'none', 'sword', 'spear', 'trident', 'hammer', 'axe', 'double_axe', 'bow', 'staff', 'scepter', 'club',
  'scythe', 'discus', 'lightning_bolt', 'fan', 'drum', 'mace', 'whip', 'torch', 'ankh', 'claws', 'halberd',
  'katana', 'cauldron', 'harp',
];
export const OFFHANDS = ['none', 'shield', 'orb', 'book', 'lantern', 'torch', 'ankh', 'drum', 'mirror', 'shell'];
export const EXTRAS = [
  'cape', 'wings', 'tail', 'multi_arms', 'beard', 'long_hair', 'third_eye', 'aura_ring', 'skirt', 'armor',
  'fur', 'spikes', 'rider', 'mane', 'shell', 'flames', 'eye_glow', 'chains', 'jewelry', 'feather_cloak',
];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function validateAbility(a, where, errors, unitIds) {
  const w = `${where}.ability(${a && a.id})`;
  if (!a || typeof a !== 'object') return errors.push(`${where}: ability is not an object`);
  if (typeof a.id !== 'string' || !a.id) errors.push(`${w}: missing id`);
  if (typeof a.name !== 'string') errors.push(`${w}: missing name`);
  if (!ABILITY_KEYS.includes(a.key)) errors.push(`${w}: bad key ${a.key}`);
  if (!isNum(a.cooldown) || a.cooldown <= 0) errors.push(`${w}: bad cooldown`);
  if (!ABILITY_TARGETS.includes(a.target)) errors.push(`${w}: bad target ${a.target}`);
  if (a.target !== 'none' && !(isNum(a.range) && a.range > 0)) errors.push(`${w}: targeted ability needs range`);
  if (!Array.isArray(a.effects) || a.effects.length === 0) errors.push(`${w}: needs effects`);
  for (const e of a.effects || []) {
    if (!EFFECT_TYPES.includes(e.type)) errors.push(`${w}: bad effect type ${e.type}`);
    if (e.at && !EFFECT_AT.includes(e.at)) errors.push(`${w}: bad effect at ${e.at}`);
    if (e.affects && !EFFECT_AFFECTS.includes(e.affects)) errors.push(`${w}: bad effect affects ${e.affects}`);
    if (e.type === 'buff' && !BUFF_STATS.includes(e.stat)) errors.push(`${w}: bad buff stat ${e.stat}`);
    if (e.type === 'summon' && unitIds && !unitIds.has(e.unit)) errors.push(`${w}: summon of unknown unit ${e.unit}`);
    if (['damage', 'heal', 'chain', 'line', 'dash', 'shield'].includes(e.type) && !isNum(e.amount)) errors.push(`${w}: ${e.type} needs amount`);
    if (['stun', 'slow', 'buff', 'dot', 'field', 'shield', 'invulnerable', 'reveal'].includes(e.type) && !isNum(e.duration)) errors.push(`${w}: ${e.type} needs duration`);
  }
  if (!a.vfx || !ELEMENTS.includes(a.vfx.element) || !VFX_SHAPES.includes(a.vfx.shape)) errors.push(`${w}: bad vfx`);
  if (!a.ai || !AI_USES.includes(a.ai.use)) errors.push(`${w}: bad ai hint`);
  if (typeof a.description !== 'string') errors.push(`${w}: missing description`);
}

/** Validate one unit type. Returns nothing; pushes messages into errors. */
export function validateUnit(u, errors, unitIds) {
  const w = `unit(${u && u.id})`;
  if (!u || typeof u !== 'object') return errors.push('unit is not an object');
  for (const f of ['id', 'name', 'description', 'icon']) if (typeof u[f] !== 'string') errors.push(`${w}: missing ${f}`);
  if (!UNIT_CLASSES.includes(u.class)) errors.push(`${w}: bad class ${u.class}`);
  if (![1, 2, 3].includes(u.tier)) errors.push(`${w}: bad tier`);
  if (!u.cost || !isNum(u.cost.gold) || !isNum(u.cost.wood) || !isNum(u.cost.faith)) errors.push(`${w}: bad cost`);
  for (const f of ['pop', 'buildTime', 'hp', 'armor', 'speed', 'radius', 'sight']) if (!isNum(u[f])) errors.push(`${w}: bad ${f}`);
  if (!PRODUCED_AT.includes(u.producedAt)) errors.push(`${w}: bad producedAt ${u.producedAt}`);
  if (typeof u.air !== 'boolean') errors.push(`${w}: air must be boolean`);
  if (u.attack) {
    const a = u.attack;
    if (!isNum(a.damage) || !isNum(a.range) || !isNum(a.cooldown)) errors.push(`${w}: bad attack numbers`);
    if (!PROJECTILES.includes(a.projectile ?? null)) errors.push(`${w}: bad projectile ${a.projectile}`);
    if (a.element && !ELEMENTS.includes(a.element)) errors.push(`${w}: bad attack element ${a.element}`);
    if (a.range > 1.5 && !a.projectile) errors.push(`${w}: ranged attack needs a projectile`);
  }
  if (!Array.isArray(u.abilities)) errors.push(`${w}: abilities must be an array`);
  for (const a of u.abilities || []) validateAbility(a, w, errors, unitIds);
  const keys = (u.abilities || []).map((a) => a.key);
  if (new Set(keys).size !== keys.length) errors.push(`${w}: duplicate ability keys`);
  if (!Array.isArray(u.passives)) errors.push(`${w}: passives must be an array`);
  for (const p of u.passives || []) if (!PASSIVE_TYPES.includes(p.type)) errors.push(`${w}: bad passive ${p.type}`);
  const v = u.visual;
  if (!v) errors.push(`${w}: missing visual`);
  else {
    if (!BODIES.includes(v.body)) errors.push(`${w}: bad body ${v.body}`);
    if (!isNum(v.scale)) errors.push(`${w}: bad visual scale`);
    if (!v.colors || ['skin', 'primary', 'secondary', 'accent'].some((c) => typeof v.colors[c] !== 'string')) errors.push(`${w}: bad visual colors`);
    if (!HEADS.includes(v.head)) errors.push(`${w}: bad head ${v.head}`);
    if (!HEADGEAR.includes(v.headgear)) errors.push(`${w}: bad headgear ${v.headgear}`);
    if (!WEAPONS.includes(v.weapon)) errors.push(`${w}: bad weapon ${v.weapon}`);
    if (!OFFHANDS.includes(v.offhand)) errors.push(`${w}: bad offhand ${v.offhand}`);
    if (!Array.isArray(v.extras) || v.extras.some((x) => !EXTRAS.includes(x))) errors.push(`${w}: bad extras ${v.extras}`);
  }
  if (u.class === 'god') {
    if ((u.abilities || []).length !== 3) errors.push(`${w}: gods need exactly 3 abilities (Q, W, R)`);
    if (typeof u.title !== 'string') errors.push(`${w}: gods need a title`);
  }
  if (u.class === 'titan' && (u.abilities || []).length !== 2) errors.push(`${w}: titans need exactly 2 abilities (Q, R)`);
}

/** Validate a pantheon object. */
export function validatePantheon(p, errors, unitIds) {
  const w = `pantheon(${p && p.id})`;
  if (!p) return errors.push('pantheon missing');
  for (const f of ['id', 'name', 'culture', 'description']) if (typeof p[f] !== 'string') errors.push(`${w}: missing ${f}`);
  if (!Array.isArray(p.gods) || p.gods.length !== 4) errors.push(`${w}: needs 4 gods`);
  if (!p.titan) errors.push(`${w}: needs a titan`);
  if (!Array.isArray(p.creatures) || p.creatures.length !== 3) errors.push(`${w}: needs 3 creatures`);
  else p.creatures.forEach((c, i) => { if (c.tier !== i + 1) errors.push(`${w}: creature ${c.id} should be tier ${i + 1}`); });
  if (!p.style || !p.colors) errors.push(`${w}: needs style and colors`);
  for (const u of [...(p.gods || []), p.titan, ...(p.creatures || []), ...(p.minions || [])]) {
    if (!u) continue;
    if (u.pantheon !== p.id) errors.push(`${w}: unit ${u.id} has pantheon ${u.pantheon}`);
    validateUnit(u, errors, unitIds);
  }
}

// ---- Building upgrades (src/data/upgrades.js) ----
export const UPGRADE_EFFECTS = {
  building: ['hp', 'armor', 'pop', 'range', 'damage', 'faith', 'train'],
  unit: ['damage', 'hp', 'armor', 'regen'],
  carry: null,
  chop: null,
  godLevel: null,
};

/** Validate one upgrade listed in a building's `upgrades`. */
export function validateUpgrade(up, buildingId, errors, unitIds) {
  const w = `building(${buildingId}).upgrade(${up && up.id})`;
  if (!up || typeof up !== 'object') return errors.push(`${w}: not an object`);
  for (const f of ['id', 'name', 'icon', 'description']) if (typeof up[f] !== 'string' || !up[f]) errors.push(`${w}: missing ${f}`);
  if (typeof up.hotkey !== 'string' || !/^[A-Z]$/.test(up.hotkey)) errors.push(`${w}: hotkey must be one capital letter`);
  if (!up.cost || ['gold', 'wood', 'faith'].some((k) => !isNum(up.cost[k]) || up.cost[k] < 0)) errors.push(`${w}: bad cost`);
  if (!isNum(up.time) || up.time <= 0) errors.push(`${w}: bad time`);
  if (![1, 2, 3].includes(up.tier)) errors.push(`${w}: bad tier`);
  if (!Array.isArray(up.effects) || up.effects.length === 0) errors.push(`${w}: needs effects`);
  for (const e of up.effects || []) {
    if (!e || !Object.hasOwn(UPGRADE_EFFECTS, e.type)) {
      errors.push(`${w}: bad effect type ${e && e.type}`);
      continue;
    }
    const stats = UPGRADE_EFFECTS[e.type];
    if (stats && !stats.includes(e.stat)) errors.push(`${w}: bad ${e.type} stat ${e.stat}`);
    if (!isNum(e.amount)) errors.push(`${w}: bad amount`);
    if (e.type === 'carry' && e.resource !== 'g' && e.resource !== 'w') errors.push(`${w}: carry resource must be g or w`);
    if (e.type === 'building' && typeof e.building !== 'string') errors.push(`${w}: building effect needs a building`);
    if (e.type === 'unit') {
      if (!e.units && !e.classes) errors.push(`${w}: unit effect needs units or classes`);
      for (const id of e.units || []) if (!unitIds.has(id)) errors.push(`${w}: unknown unit ${id}`);
      for (const c of e.classes || []) if (!UNIT_CLASSES.includes(c)) errors.push(`${w}: unknown class ${c}`);
    }
  }
}
