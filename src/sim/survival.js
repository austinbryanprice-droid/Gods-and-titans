// Trial of the Titans (survival game mode, DESIGN 5.11): every player is on one team
// against waves of mythical monsters that come out of the map's edges on a fixed
// clock, larger and stronger each time, with a hostile Titan leading every fifth
// wave. The game ends when the players' last building falls; the score is the
// wave reached. The schedule helpers here are shared with the HUD (ViewState),
// the wave director (createSurvival / updateSurvival) runs inside World.tick.
import { NEUTRAL, SURVIVAL_FIRST_WAVE, SURVIVAL_INTERVAL, SURVIVAL_BOSS_EVERY, SURVIVAL_MAX_ALIVE, TICK_RATE } from '../config.js';
import { PANTHEON_LIST } from '../data/index.js';
import { RNG, hashSeed } from './rng.js';
import { groupOrder } from './commands.js';
import { hyp } from './common.js';

/** Is this GameSetup a Trial of the Titans? */
export function survivalOn(setup) {
  return !!setup && setup.survival === true;
}

/** Game second at which wave n (1, 2, ...) comes out. */
export function waveTime(n) {
  return SURVIVAL_FIRST_WAVE + (n - 1) * SURVIVAL_INTERVAL;
}

/** How many waves have come out by this game second. */
export function wavesBy(time) {
  if (!(time >= SURVIVAL_FIRST_WAVE - 1e-9)) return 0;
  return Math.floor((time - SURVIVAL_FIRST_WAVE + 1e-9) / SURVIVAL_INTERVAL) + 1;
}

/** Seconds until the next wave comes out. */
export function nextWaveIn(time) {
  return Math.max(0, waveTime(wavesBy(time) + 1) - (time || 0));
}

/** Does a Titan lead wave n? */
export function isBossWave(n) {
  return n > 0 && n % SURVIVAL_BOSS_EVERY === 0;
}

/** More players face more monsters: 1 player 1.0, 2 players 1.4, 4 players 2.2. */
export function playerFactor(players) {
  return 0.6 + 0.4 * Math.max(1, players);
}

/** Population worth of the monsters in wave n (a tier-1 creature is 2, tier 2 is 3, tier 3 is 5). */
export function waveBudget(n, players) {
  return Math.round((4 + 3 * n) * playerFactor(players));
}

/** Health and damage multipliers of wave n's creatures: they toughen a little every wave, faster later on. */
export function waveBoost(n) {
  const k = Math.max(0, n - 1);
  return { hp: 1 + 0.05 * k + 0.003 * k * k, dmg: 1 + 0.04 * k + 0.002 * k * k };
}

/** The boss Titan's multipliers: half a Titan at wave 5 for one player, a whole one at wave 10, more for more players. */
export function bossBoost(n, players) {
  return { hp: (n / 10) * (0.7 + 0.3 * Math.max(1, players)), dmg: 0.6 + 0.04 * n };
}

/** Gold each surviving player gets when every monster of wave n is dead. */
export function waveReward(n) {
  return 40 + 20 * n;
}

let pools = null;
/** Creature type ids by tier, and whether they fly, from every pantheon. */
function creaturePools() {
  if (pools) return pools;
  pools = { 1: [], 2: [], 3: [], titans: [] };
  for (const p of PANTHEON_LIST) {
    for (const c of p.creatures) if (pools[c.tier]) pools[c.tier].push({ id: c.id, air: !!c.air, pop: c.pop || c.tier + 1 });
    if (p.titan) pools.titans.push(p.titan.id);
  }
  return pools;
}

/** Which tier the next monster of wave n is: only the small ones at first, the big ones from wave 7. */
function pickTier(n, rng) {
  const r = rng.next();
  if (n <= 2) return 1;
  if (n <= 6) return r < 0.6 ? 1 : 2;
  if (n <= 11) return r < 0.35 ? 1 : r < 0.75 ? 2 : 3;
  return r < 0.2 ? 1 : r < 0.6 ? 2 : 3;
}

/**
 * The monsters of wave n as unit type ids, boss first (deterministic for a given rng).
 * Flyers stay out until wave 6 (the first Barracks has no archers yet) and are at most a third of a wave.
 */
export function wavePlan(n, players, rng) {
  const P = creaturePools();
  const out = [];
  const boss = isBossWave(n);
  if (boss) out.push(rng.pick(P.titans));
  let budget = Math.round(waveBudget(n, players) * (boss ? 0.6 : 1));
  let air = 0;
  for (let guard = 0; budget >= 2 && guard < 200; guard++) {
    let tier = pickTier(n, rng);
    while (tier > 1 && P[tier][0].pop > budget) tier--;
    const flyOk = n >= 6 && (air + 1) * 3 <= out.length + 1;
    const pool = P[tier].filter((c) => flyOk || !c.air);
    const c = rng.pick(pool.length ? pool : P[1].filter((x) => !x.air));
    out.push(c.id);
    if (c.air) air++;
    budget -= c.pop;
  }
  return out;
}

// ---------------------------------------------------------------- the wave director

/** The director's state for a world whose setup is a survival game (null otherwise). */
export function createSurvival(world) {
  if (!survivalOn(world.setup)) return null;
  return {
    wave: 0, // waves that have come out
    rng: new RNG(hashSeed(`${world.setup.seed}:survival`)),
    monsters: [], // living wave monsters (pruned once a second)
    alive: new Map(), // wave -> monsters of it alive
    rewarded: new Set(), // waves whose clearing has been paid
  };
}

/** Points just inside the map's edges where a wave can come out: corners and the middle of each side. */
function edgePoints(world) {
  const w = world.map.width;
  const h = world.map.height;
  const m = 3;
  const pts = [];
  for (const fx of [0, 0.5, 1]) {
    for (const fy of [0, 0.5, 1]) {
      if (fx === 0.5 && fy === 0.5) continue;
      pts.push({ x: m + fx * (w - 2 * m), y: m + fy * (h - 2 * m) });
    }
  }
  return pts;
}

/** Where wave n comes out: one edge point early on, two from wave 5, three from wave 15, away from the players' buildings. */
function spawnPoints(world, sv, n) {
  const blds = world.buildingList.filter((b) => !b.dead && b.owner >= 0 && !b.def.wall);
  const scored = edgePoints(world).map((p) => {
    let d = Infinity;
    for (const b of blds) d = Math.min(d, hyp(b.x - p.x, b.y - p.y));
    return { ...p, d };
  });
  let far = scored.filter((p) => p.d >= 30);
  if (far.length < 2) far = scored.sort((a, b) => b.d - a.d).slice(0, 4);
  sv.rng.shuffle(far);
  const k = n >= 15 ? 3 : n >= 5 ? 2 : 1;
  return far.slice(0, Math.min(k, far.length));
}

/** The nearest building of a player still in the game (walls are broken through on the way, not hunted). */
export function nearestTarget(world, x, y) {
  let best = null;
  let bd = Infinity;
  for (const b of world.buildingList) {
    if (b.dead || b.owner < 0 || b.def.wall) continue;
    const p = world.players[b.owner];
    if (!p || p.defeated) continue;
    const d = hyp(b.x - x, b.y - y);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

/** A compass word for a point on a w × h map, seen from its middle ("north-east"). */
export function edgeName(w, h, x, y) {
  const ns = y < h / 3 ? 'north' : y > (2 * h) / 3 ? 'south' : '';
  const ew = x < w / 3 ? 'west' : x > (2 * w) / 3 ? 'east' : '';
  return ns && ew ? `${ns}-${ew}` : ns || ew || 'centre';
}

function spawnWave(world, sv, n) {
  const players = world.players.length;
  const plan = wavePlan(n, players, sv.rng);
  const points = spawnPoints(world, sv, n);
  const room = Math.max(0, SURVIVAL_MAX_ALIVE - sv.monsters.length);
  const boost = waveBoost(n);
  const bboost = bossBoost(n, players);
  const spawned = [];
  let boss = '';
  for (let i = 0; i < plan.length && spawned.length < room; i++) {
    const type = plan[i];
    const titan = i === 0 && isBossWave(n);
    const p = points[i % points.length];
    const a = sv.rng.next() * Math.PI * 2;
    const r = titan ? 0 : 1 + sv.rng.next() * 2.5;
    const u = world.spawnUnit(NEUTRAL, type, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, { boost: titan ? bboost : boost, silent: true });
    if (!u) continue;
    u.wave = n;
    if (titan) boss = type;
    spawned.push(u);
  }
  sv.monsters.push(...spawned);
  // A wave the cap left empty is never "beaten": no reward for it.
  if (spawned.length) sv.alive.set(n, spawned.length);
  // Each group marches on the players' nearest building.
  for (const p of points) {
    const group = spawned.filter((u) => hyp(u.x - p.x, u.y - p.y) < 12);
    send(world, group);
  }
  const p0 = points[0] || { x: world.map.width / 2, y: 0 };
  world.emit({ type: 'wave', n, count: spawned.length, boss, x: Math.round(p0.x), y: Math.round(p0.y) });
}

/** Send monsters with nothing to do at the nearest player building. */
function send(world, units) {
  if (!units.length) return;
  let cx = 0;
  let cy = 0;
  for (const u of units) {
    cx += u.x;
    cy += u.y;
  }
  const t = nearestTarget(world, cx / units.length, cy / units.length);
  if (t) groupOrder(world, units, t.x, t.y, 'attackMove', false);
}

/** One tick of the director: waves come out on the clock; once a second the dead are counted and idle monsters sent on. */
export function updateSurvival(world) {
  const sv = world.survival;
  if (!sv || world.gameOver) return;
  while (world.time >= waveTime(sv.wave + 1) - 1e-9) {
    sv.wave++;
    spawnWave(world, sv, sv.wave);
  }
  if (world.tickCount % TICK_RATE !== 0) return;
  const counts = new Map();
  const idle = [];
  sv.monsters = sv.monsters.filter((u) => !u.dead);
  for (const u of sv.monsters) {
    counts.set(u.wave, (counts.get(u.wave) || 0) + 1);
    if (!u.order && !u.forced && !u.orders.length) idle.push(u);
  }
  for (const n of sv.alive.keys()) {
    const left = counts.get(n) || 0;
    sv.alive.set(n, left);
    if (left === 0) {
      sv.alive.delete(n);
      if (sv.rewarded.has(n)) continue;
      sv.rewarded.add(n);
      const gold = waveReward(n);
      for (const p of world.players) if (!p.defeated) p.gold += gold;
      world.emit({ type: 'waveCleared', n, gold });
    }
  }
  // Idle monsters (their building fell, or they finished a fight) go for the next one, each on its own.
  for (const u of idle) send(world, [u]);
}

/** Snapshot record of the trial: waves out so far and wave monsters alive. */
export function survivalView(world) {
  const sv = world.survival;
  return sv ? { w: sv.wave, m: sv.monsters.reduce((n, u) => n + (u.dead ? 0 : 1), 0) } : null;
}
