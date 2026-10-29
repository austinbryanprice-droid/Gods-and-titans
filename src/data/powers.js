// God powers (DESIGN 4.11): each pantheon's three one-use divine powers, one unlocked per
// settlement tier and cast by the player from the power bar beside the minimap, with no unit
// casting them. Village: a blessing that helps the caster's own people; Town: a strike on a spot
// the caster's team can see; City: a cataclysm over a wide area. Their effects are the ability
// effects of DESIGN 4.4 (applied by sim/abilities.js with the player as the caster) plus two of
// their own, run by sim/powers.js:
//   boon     { stat: 'gather'|'faith', pct, duration }  for a while every load of gold and wood brought in,
//                                                     or the faith from prayer, of the whole player rises by pct
//   barrage  { count, amount, radius, spread, every, stun? }    bolts fall one after another on random spots
//                                                               within `spread` of the target, each hitting `radius`
import { ELEMENTS, VFX_SHAPES, EFFECT_TYPES, EFFECT_AFFECTS, BUFF_STATS } from './schema.js';

export const POWER_KINDS = ['blessing', 'strike', 'cataclysm']; // one per tier, in this order
export const POWER_EFFECTS = [...EFFECT_TYPES, 'boon', 'barrage'];
export const BOON_STATS = ['gather', 'faith'];
export const BOON_TEXT = { gather: 'Harvest', faith: 'Prayer' };
export const POWER_USES = ['economy', 'heal', 'damage'];
export const BARRAGE_MAX_SECONDS = 4; // the renderer telegraphs an effect at most this far ahead
const HARMFUL = new Set(['damage', 'stun', 'slow', 'dot', 'knockback', 'pull', 'barrage']);

// ---- builders (the numbers per kind live here, so the ten pantheons stay comparable) ----

const boon = (stat, pct, duration = 60) => ({ type: 'boon', stat, pct, duration });
const healRain = () => [
  { type: 'heal', amount: 120, radius: 7 },
  { type: 'field', duration: 15, radius: 7, hps: 30 },
];
const barrage = (count, amount, every, extra = {}) => ({ type: 'barrage', count, amount, radius: 1.7, spread: 4.5, every, ...extra });

function power(pantheon, slug, tier, o) {
  return {
    id: `${pantheon}_power_${slug}`,
    pantheon,
    tier,
    kind: POWER_KINDS[tier - 1],
    target: 'point',
    ...o,
  };
}

/** The powers of each pantheon, Village / Town / City. */
export const GOD_POWERS = {
  greek: [
    power('greek', 'demeters_bounty', 1, {
      name: "Demeter's Bounty", icon: '🌾', target: 'none', effects: [boon('gather', 0.5)],
      vfx: { element: 'nature', shape: 'buff' }, ai: { use: 'economy' },
      description: 'Demeter blesses the fields: every load of gold and wood your Worshippers bring in counts 50% more for 60 seconds.',
    }),
    power('greek', 'lightning_storm', 2, {
      name: "Zeus's Lightning Storm", icon: '⛈️', effects: [barrage(14, 125, 0.25, { stun: 0.6 })],
      vfx: { element: 'lightning', shape: 'strike' }, ai: { use: 'damage' },
      description: 'Fourteen thunderbolts fall on the area, each blasting and stunning what it hits. The target must be in sight.',
    }),
    power('greek', 'earthquake', 3, {
      name: "Poseidon's Earthquake", icon: '🌋',
      effects: [
        { type: 'damage', amount: 120, radius: 8, delay: 0.5 },
        { type: 'stun', duration: 1, radius: 8, delay: 0.5 },
        { type: 'field', duration: 10, radius: 8, dps: 58, slowPct: 0.3 },
      ],
      vfx: { element: 'earth', shape: 'quake' }, ai: { use: 'damage' },
      description: 'The Earth-Shaker splits the ground: a wide quake stuns and shakes every enemy unit and building in it for 10 seconds.',
    }),
  ],
  norse: [
    power('norse', 'iduns_apples', 1, {
      name: "Iðunn's Apples", icon: '🍎', effects: healRain(),
      vfx: { element: 'nature', shape: 'heal' }, ai: { use: 'heal' },
      description: "The apples of youth: heals your and your allies' units in the area and keeps healing them for 15 seconds.",
    }),
    power('norse', 'hammerfall', 2, {
      name: "Thor's Hammerfall", icon: '🔨',
      effects: [
        { type: 'damage', amount: 320, radius: 3.8, delay: 0.6 },
        { type: 'stun', duration: 2, radius: 3.8, delay: 0.6 },
        { type: 'knockback', distance: 2.5, radius: 4.6, delay: 0.6 },
      ],
      vfx: { element: 'lightning', shape: 'meteor' }, ai: { use: 'damage' },
      description: 'Mjölnir falls from the sky: a crushing blow that stuns everything at the spot and hurls the rest aside. The target must be in sight.',
    }),
    power('norse', 'fimbulwinter', 3, {
      name: 'Fimbulwinter', icon: '❄️',
      effects: [
        { type: 'damage', amount: 100, radius: 9 },
        { type: 'stun', duration: 1.5, radius: 9 },
        { type: 'field', duration: 15, radius: 9, dps: 32, slowPct: 0.5 },
      ],
      vfx: { element: 'ice', shape: 'storm' }, ai: { use: 'damage' },
      description: 'The great winter before Ragnarök: a blizzard batters and freezes every enemy in a wide area, then chills and slows them for 15 seconds.',
    }),
  ],
  egyptian: [
    power('egyptian', 'feast_of_opet', 1, {
      name: 'Feast of Opet', icon: '⛵', target: 'none', effects: [boon('faith', 1)],
      vfx: { element: 'sun', shape: 'buff' }, ai: { use: 'economy' },
      description: 'Amun sails up the Nile to his festival: prayer gives twice the faith for 60 seconds.',
    }),
    power('egyptian', 'plague_of_locusts', 2, {
      name: 'Plague of Locusts', icon: '🦗',
      effects: [
        { type: 'dot', dps: 22, duration: 10, radius: 5 },
        { type: 'slow', pct: 0.35, duration: 10, radius: 5 },
      ],
      vfx: { element: 'sand', shape: 'storm' }, ai: { use: 'damage' },
      description: 'A black swarm descends: enemies in the area are eaten away and slowed for 10 seconds. The target must be in sight.',
    }),
    power('egyptian', 'eclipse', 3, {
      name: 'Apep Swallows the Sun', icon: '🌑',
      effects: [
        { type: 'buff', stat: 'damage', amount: 0.3, duration: 30, radius: 12, affects: 'allies' },
        { type: 'buff', stat: 'damage', amount: -0.3, duration: 30, radius: 12, affects: 'enemies' },
        { type: 'reveal', radius: 12, duration: 30 },
        { type: 'damage', amount: 150, radius: 9, delay: 0.5 },
        { type: 'field', duration: 12, radius: 9, dps: 32 },
        { type: 'summon', unit: 'egyptian_mummy', count: 4, duration: 45 },
      ],
      vfx: { element: 'shadow', shape: 'nova' }, ai: { use: 'damage' },
      description: 'Darkness at noon: for 30 seconds your units in a wide area strike 30% harder and enemies 30% weaker, the dark eats at every enemy at its heart for 12 seconds, and four mummies rise to fight.',
    }),
  ],
  hindu: [
    power('hindu', 'festival_of_lamps', 1, {
      name: 'Festival of Lamps', icon: '🕯️', target: 'none', effects: [boon('faith', 1)],
      vfx: { element: 'holy', shape: 'buff' }, ai: { use: 'economy' },
      description: 'Every home lights its lamps for Lakshmi: prayer gives twice the faith for 60 seconds.',
    }),
    power('hindu', 'agnis_rain', 2, {
      name: "Agni's Fire Rain", icon: '☄️', effects: [barrage(8, 135, 0.45, { radius: 2 })],
      vfx: { element: 'fire', shape: 'meteor' }, ai: { use: 'damage' },
      description: 'The fire god pours burning stones on the area: eight blasts, one after another. The target must be in sight.',
    }),
    power('hindu', 'tandava', 3, {
      name: "Shiva's Tandava", icon: '🔱',
      effects: [
        { type: 'damage', amount: 260, radius: 7, delay: 1 },
        { type: 'field', duration: 8, radius: 7, dps: 40 },
      ],
      vfx: { element: 'fire', shape: 'nova' }, ai: { use: 'damage' },
      description: 'The dance that ends worlds: a great blast of fire, then the ground burns for 8 seconds.',
    }),
  ],
  japanese: [
    power('japanese', 'matsuri', 1, {
      name: 'Matsuri', icon: '🏮', target: 'none', effects: [boon('faith', 1)],
      vfx: { element: 'holy', shape: 'buff' }, ai: { use: 'economy' },
      description: 'A festival for the kami: prayer gives twice the faith for 60 seconds.',
    }),
    power('japanese', 'divine_wind', 2, {
      name: 'Divine Wind', icon: '🌀',
      effects: [
        { type: 'damage', amount: 200, radius: 5 },
        { type: 'knockback', distance: 3, radius: 5 },
        { type: 'slow', pct: 0.5, duration: 6, radius: 5 },
      ],
      vfx: { element: 'wind', shape: 'storm' }, ai: { use: 'damage' },
      description: 'The kamikaze of legend: a gale that batters enemies, scatters them and slows them for 6 seconds. The target must be in sight.',
    }),
    power('japanese', 'tsunami', 3, {
      name: "Ryūjin's Tsunami", icon: '🌊',
      effects: [
        { type: 'damage', amount: 220, radius: 8 },
        { type: 'knockback', distance: 3, radius: 8 },
        { type: 'slow', pct: 0.4, duration: 8, radius: 8 },
        { type: 'damage', amount: 200, radius: 11, delay: 1.5 },
      ],
      vfx: { element: 'water', shape: 'wave' }, ai: { use: 'damage' },
      description: 'The dragon king of the sea sends a great wave that smashes and sweeps away everything in a wide area, and its backwash strikes them again.',
    }),
  ],
  chinese: [
    power('chinese', 'five_grains', 1, {
      name: 'Harvest of the Five Grains', icon: '🌾', target: 'none', effects: [boon('gather', 0.5)],
      vfx: { element: 'nature', shape: 'buff' }, ai: { use: 'economy' },
      description: 'Shennong blesses the harvest: every load of gold and wood your Worshippers bring in counts 50% more for 60 seconds.',
    }),
    power('chinese', 'hou_yis_arrows', 2, {
      name: "Hou Yi's Sun Arrows", icon: '🏹', effects: [barrage(9, 120, 0.35)],
      vfx: { element: 'sun', shape: 'strike' }, ai: { use: 'damage' },
      description: 'The archer who shot down nine suns lets them fall on your enemies: nine burning blasts. The target must be in sight.',
    }),
    power('chinese', 'great_flood', 3, {
      name: 'The Great Flood', icon: '🌊',
      effects: [{ type: 'field', duration: 18, radius: 9, dps: 32, slowPct: 0.45 }],
      vfx: { element: 'water', shape: 'wave' }, ai: { use: 'damage' },
      description: 'The flood Yu the Great had to tame: a wide area drowns for 18 seconds, hurting and slowing every enemy in it.',
    }),
  ],
  aztec: [
    power('aztec', 'chinampa_harvest', 1, {
      name: 'Chinampa Harvest', icon: '🌽', target: 'none', effects: [boon('gather', 0.5)],
      vfx: { element: 'nature', shape: 'buff' }, ai: { use: 'economy' },
      description: "Tlaloc's rain on the floating gardens: every load of gold and wood your Worshippers bring in counts 50% more for 60 seconds.",
    }),
    power('aztec', 'fire_serpent', 2, {
      name: 'Xiuhcoatl, the Fire Serpent', icon: '🐍',
      effects: [
        { type: 'damage', amount: 220, radius: 3.5 },
        { type: 'dot', dps: 22, duration: 8, radius: 3.5 },
      ],
      vfx: { element: 'fire', shape: 'meteor' }, ai: { use: 'damage' },
      description: "Huitzilopochtli's fire serpent strikes the spot and leaves enemies burning for 8 seconds. The target must be in sight.",
    }),
    power('aztec', 'nahui_ollin', 3, {
      name: 'Nahui Ollin', icon: '🌋',
      effects: [
        { type: 'damage', amount: 100, radius: 8 },
        { type: 'stun', duration: 1, radius: 8 },
        { type: 'field', duration: 10, radius: 8, dps: 44 },
      ],
      vfx: { element: 'earth', shape: 'quake' }, ai: { use: 'damage' },
      description: 'Four Movement, the earthquake fated to end the Fifth Sun: a wide quake stuns and shakes every enemy unit and building for 10 seconds.',
    }),
  ],
  celtic: [
    power('celtic', 'brigids_well', 1, {
      name: "Brigid's Well", icon: '⛲', effects: healRain(),
      vfx: { element: 'holy', shape: 'heal' }, ai: { use: 'heal' },
      description: "The healing waters of Brigid: heals your and your allies' units in the area and keeps healing them for 15 seconds.",
    }),
    power('celtic', 'morrigans_crows', 2, {
      name: "The Morrígan's Crows", icon: '🐦',
      effects: [
        { type: 'damage', amount: 70, radius: 5 },
        { type: 'dot', dps: 6, duration: 10, radius: 5 },
        { type: 'summon', unit: 'celtic_battle_crow', count: 6, duration: 40 },
        { type: 'buff', stat: 'damage', amount: -0.25, duration: 12, radius: 5, affects: 'enemies' },
      ],
      vfx: { element: 'shadow', shape: 'summon' }, ai: { use: 'damage' },
      description: 'The phantom queen\'s flock tears at every enemy in the area and keeps pecking for 10 seconds, six battle crows stay to fight for 40 seconds, and the enemies lose heart: 25% less damage for 12 seconds. The target must be in sight.',
    }),
    power('celtic', 'taranis_wrath', 3, {
      name: "Taranis's Wrath", icon: '⛈️',
      effects: [
        barrage(20, 160, 0.18, { spread: 7, radius: 2.2, stun: 0.6 }),
        { type: 'field', duration: 8, radius: 7, dps: 20 },
      ],
      vfx: { element: 'lightning', shape: 'strike' }, ai: { use: 'damage' },
      description: 'The wheel-god of thunder unleashes a storm: twenty thunderbolts over a wide area, each blasting and stunning, and the storm rages on for 8 seconds.',
    }),
  ],
  mesopotamian: [
    power('mesopotamian', 'waters_of_enki', 1, {
      name: 'Waters of Enki', icon: '💧', effects: healRain(),
      vfx: { element: 'water', shape: 'heal' }, ai: { use: 'heal' },
      description: "The sweet waters of the Abzu: heals your and your allies' units in the area and keeps healing them for 15 seconds.",
    }),
    power('mesopotamian', 'imhullu', 2, {
      name: 'Imhullu, the Evil Wind', icon: '🌪️',
      effects: [
        { type: 'damage', amount: 160, radius: 5 },
        { type: 'field', duration: 8, radius: 5, dps: 10, slowPct: 0.4 },
      ],
      vfx: { element: 'wind', shape: 'storm' }, ai: { use: 'damage' },
      description: 'The wind Marduk loosed on Tiamat: it batters enemies in the area, then howls on, hurting and slowing them for 8 seconds. The target must be in sight.',
    }),
    power('mesopotamian', 'deluge', 3, {
      name: 'The Deluge', icon: '🌊',
      effects: [{ type: 'field', duration: 15, radius: 10, dps: 35, slowPct: 0.4 }],
      vfx: { element: 'water', shape: 'wave' }, ai: { use: 'damage' },
      description: 'The flood the gods sent in the days of Atrahasis: a very wide area drowns for 15 seconds, hurting and slowing every enemy in it.',
    }),
  ],
  west_african: [
    power('west_african', 'gold_road', 1, {
      name: 'Caravan of the Gold Road', icon: '🐪', target: 'none', effects: [{ type: 'resource', gold: 400, wood: 200 }],
      vfx: { element: 'sun', shape: 'buff' }, ai: { use: 'economy' },
      description: 'A caravan arrives laden with gifts: 400 gold and 200 wood at once.',
    }),
    power('west_african', 'thunderstones', 2, {
      name: "Shango's Thunderstones", icon: '⚡', effects: [barrage(12, 130, 0.3, { stun: 0.5 })],
      vfx: { element: 'lightning', shape: 'strike' }, ai: { use: 'damage' },
      description: 'Shango hurls his thunderstones: twelve bolts, each blasting and stunning what it hits. The target must be in sight.',
    }),
    power('west_african', 'oyas_tempest', 3, {
      name: "Oya's Tempest", icon: '🌪️',
      effects: [
        { type: 'field', duration: 12, radius: 8, dps: 48, slowPct: 0.3 },
        barrage(14, 140, 0.25, { spread: 7 }),
      ],
      vfx: { element: 'wind', shape: 'storm' }, ai: { use: 'damage' },
      description: 'The queen of storms sweeps over a wide area: a gale hurts and slows enemies for 12 seconds while lightning falls.',
    }),
  ],
};

/** Every power by id. */
export const POWERS = {};
for (const list of Object.values(GOD_POWERS)) for (const p of list) POWERS[p.id] = p;

/** The three powers of a pantheon (Village, Town, City), or an empty list. */
export function powersFor(pantheonId) {
  return (Object.hasOwn(GOD_POWERS, pantheonId) && GOD_POWERS[pantheonId]) || [];
}

/** Does the power hurt anyone (strikes and cataclysms)? Those need a target in sight and wait out the Decade of Peace. */
export function isHarmfulPower(pw) {
  return pw.effects.some((e) => HARMFUL.has(e.type) || (e.type === 'buff' && e.amount < 0) || (e.type === 'field' && e.dps > 0));
}

/** Radius of the area the power covers (the targeting ring and the AI's search). */
export function powerRadius(pw) {
  let r = 0;
  for (const e of pw.effects) r = Math.max(r, e.radius || 0, e.type === 'barrage' ? (e.spread || 0) + (e.radius || 0) : 0);
  return r;
}

/** Validate every power. Returns an array of error strings (empty when valid). */
export function validatePowers(pantheonIds, unitIds) {
  const errors = [];
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  for (const pid of pantheonIds) {
    const list = GOD_POWERS[pid];
    if (!Array.isArray(list) || list.length !== 3) {
      errors.push(`powers(${pid}): needs three powers`);
      continue;
    }
    list.forEach((pw, i) => {
      const w = `power(${pw && pw.id})`;
      if (pw.tier !== i + 1 || pw.kind !== POWER_KINDS[i]) errors.push(`${w}: power ${i + 1} must be the tier ${i + 1} ${POWER_KINDS[i]}`);
      if (pw.pantheon !== pid) errors.push(`${w}: wrong pantheon`);
      for (const f of ['id', 'name', 'icon', 'description']) if (typeof pw[f] !== 'string' || !pw[f]) errors.push(`${w}: missing ${f}`);
      if (!['none', 'point'].includes(pw.target)) errors.push(`${w}: target must be none or point`);
      if (!pw.vfx || !ELEMENTS.includes(pw.vfx.element) || !VFX_SHAPES.includes(pw.vfx.shape)) errors.push(`${w}: bad vfx`);
      if (!pw.ai || !POWER_USES.includes(pw.ai.use)) errors.push(`${w}: bad ai hint`);
      if (!Array.isArray(pw.effects) || !pw.effects.length) errors.push(`${w}: needs effects`);
      for (const e of pw.effects || []) {
        if (!POWER_EFFECTS.includes(e.type)) errors.push(`${w}: bad effect ${e.type}`);
        if (['blink', 'dash', 'chain', 'line', 'invulnerable'].includes(e.type)) errors.push(`${w}: ${e.type} needs a caster`);
        if (e.at === 'self') errors.push(`${w}: a power has no caster to centre on`);
        if (e.affects && !EFFECT_AFFECTS.includes(e.affects)) errors.push(`${w}: bad affects ${e.affects}`);
        if (e.type === 'buff' && !BUFF_STATS.includes(e.stat)) errors.push(`${w}: bad buff stat ${e.stat}`);
        if (e.type === 'summon' && !unitIds.has(e.unit)) errors.push(`${w}: summon of unknown unit ${e.unit}`);
        if (e.type === 'boon' && (!BOON_STATS.includes(e.stat) || !(e.pct > 0) || !(e.duration > 0))) errors.push(`${w}: bad boon`);
        if (e.type === 'barrage') {
          if (!(e.count >= 1) || !isNum(e.amount) || !(e.spread > 0) || !(e.radius > 0) || !(e.every > 0)) errors.push(`${w}: bad barrage`);
          else if (0.5 + (e.count - 1) * e.every > BARRAGE_MAX_SECONDS) errors.push(`${w}: barrage lasts longer than ${BARRAGE_MAX_SECONDS} s`);
        }
      }
      if (i === 0 && isHarmfulPower(pw)) errors.push(`${w}: the Village power is a blessing and must not hurt anyone`);
      if (i > 0 && (pw.target !== 'point' || !isHarmfulPower(pw))) errors.push(`${w}: strikes and cataclysms are aimed at a spot`);
    });
  }
  return errors;
}
