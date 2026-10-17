// Temporary generic pantheon so the registry loads while real content is written.
// Content files replace their `makePlaceholderPantheon(...)` call with full data.

const vis = (body, scale, extra = {}) => ({
  body, scale,
  colors: { skin: '#d8b090', primary: '#8888cc', secondary: '#444477', accent: '#ffd84a' },
  head: 'human', headgear: 'none', weapon: 'none', offhand: 'none', extras: [], aura: null, ...extra,
});

function god(pid, n) {
  const id = `${pid}_god${n}`;
  return {
    id, name: `${pid} God ${n}`, title: 'Placeholder', pantheon: pid, class: 'god', tier: 1,
    cost: { gold: 100, wood: 0, faith: 200 }, pop: 5, buildTime: 35, producedAt: 'temple',
    hp: 1000, armor: 4, speed: 3.1, radius: 0.55, sight: 10, air: false,
    attack: { damage: 32, range: 0.5, cooldown: 1.5, canHitAir: true, projectile: null, element: 'physical', splash: 0, buildingMult: 1 },
    abilities: [
      { id: `${id}_q`, name: 'Smite', key: 'Q', unlockLevel: 1, cooldown: 10, target: 'point', range: 7, castTime: 0.3,
        effects: [{ type: 'damage', amount: 130, radius: 2, at: 'target' }], vfx: { element: 'holy', shape: 'strike' }, ai: { use: 'damage' }, icon: '✴️', description: 'Damages enemies in an area.' },
      { id: `${id}_w`, name: 'Bless', key: 'W', unlockLevel: 2, cooldown: 18, target: 'none', range: 0, castTime: 0.2,
        effects: [{ type: 'heal', amount: 150, radius: 5, at: 'self' }], vfx: { element: 'holy', shape: 'heal' }, ai: { use: 'heal' }, icon: '💖', description: 'Heals nearby allies.' },
      { id: `${id}_r`, name: 'Wrath', key: 'R', unlockLevel: 4, cooldown: 90, target: 'point', range: 9, castTime: 0.5,
        effects: [{ type: 'field', dps: 60, radius: 4, duration: 6, at: 'target' }], vfx: { element: 'fire', shape: 'storm' }, ai: { use: 'damage' }, icon: '🔥', description: 'A storm burns an area.' },
    ],
    passives: [], visual: vis('humanoid', 1.6, { weapon: 'sword', headgear: 'crown', aura: '#ffd84a' }),
    icon: '👑', description: 'Placeholder god.',
  };
}

function creature(pid, tier) {
  const stats = [
    { hp: 420, dmg: 13, cd: 1.3, cost: { gold: 80, wood: 0, faith: 40 }, pop: 2, t: 20, scale: 1.0 },
    { hp: 650, dmg: 22, cd: 1.4, cost: { gold: 120, wood: 20, faith: 100 }, pop: 3, t: 28, scale: 1.4 },
    { hp: 1200, dmg: 45, cd: 1.6, cost: { gold: 180, wood: 60, faith: 180 }, pop: 5, t: 40, scale: 2.0 },
  ][tier - 1];
  return {
    id: `${pid}_creature${tier}`, name: `${pid} Creature ${tier}`, pantheon: pid, class: 'creature', tier,
    cost: stats.cost, pop: stats.pop, buildTime: stats.t, producedAt: 'shrine',
    hp: stats.hp, armor: 2, speed: 2.8, radius: 0.35 + 0.15 * tier, sight: 8, air: false,
    attack: { damage: stats.dmg, range: 0.5, cooldown: stats.cd, canHitAir: false, projectile: null, element: 'physical', splash: tier === 3 ? 1.2 : 0, buildingMult: tier === 3 ? 2 : 1 },
    abilities: [], passives: [], visual: vis('quadruped', stats.scale, { head: 'wolf' }),
    icon: '🐾', description: 'Placeholder creature.',
  };
}

export function makePlaceholderPantheon(id, name) {
  return {
    id, name, culture: name, description: `${name} pantheon (placeholder).`,
    colors: { wall: '#d8d0c0', roof: '#8a4a3a', trim: '#4a6a9a', accent: '#d4af37' },
    style: { roof: 'gable', wall: 'stone', ornament: 'banners' },
    gods: [1, 2, 3, 4].map((n) => god(id, n)),
    titan: {
      id: `${id}_titan`, name: `${name} Titan`, title: 'Placeholder', pantheon: id, class: 'titan', tier: 3,
      cost: { gold: 400, wood: 200, faith: 800 }, pop: 10, buildTime: 60, producedAt: 'titan_gate',
      hp: 5500, armor: 7, speed: 2.2, radius: 1.4, sight: 12, air: false,
      attack: { damage: 120, range: 0.8, cooldown: 1.5, canHitAir: true, projectile: null, element: 'earth', splash: 1.5, buildingMult: 2 },
      abilities: [
        { id: `${id}_titan_q`, name: 'Stomp', key: 'Q', unlockLevel: 1, cooldown: 25, target: 'none', range: 0, castTime: 0.5,
          effects: [{ type: 'damage', amount: 200, radius: 4, at: 'self' }, { type: 'stun', duration: 1.5, radius: 4, at: 'self' }], vfx: { element: 'earth', shape: 'quake' }, ai: { use: 'cc' }, icon: '💥', description: 'Stuns nearby enemies.' },
        { id: `${id}_titan_r`, name: 'Cataclysm', key: 'R', unlockLevel: 1, cooldown: 75, target: 'point', range: 10, castTime: 0.8,
          effects: [{ type: 'damage', amount: 500, radius: 5, at: 'target', delay: 0.8 }], vfx: { element: 'fire', shape: 'meteor' }, ai: { use: 'damage' }, icon: '☄️', description: 'Devastates an area.' },
      ],
      passives: [], visual: vis('giant', 4.0, { aura: '#ff7a1a' }), icon: '🗿', description: 'Placeholder titan.',
    },
    creatures: [1, 2, 3].map((t) => creature(id, t)),
    minions: [],
  };
}
