// The campaign's missions in the sim (DESIGN 5.16): the board each mission starts from, its scripted
// events (lines, enemy raids, reinforcements) and its objectives, ticked off here so the mission's end is
// part of the match like any victory, a pure function of setup + commands. The missions themselves are
// data (src/data/campaign.js); the setup names one with `campaign: '<mission id>'`. The hero is player 0.
//
//   campaignSetup(id, { name, version }) → GameSetup    the match a mission's Begin button starts
//   campaignOn(setup) / missionOf(setup)
//   campaignStart(world)        called once by the World after the start positions (instead of the creeps)
//   createCampaign(world)       the director's state (null in other games)
//   updateCampaign(world)       every tick, from World.tick
//   campaignVictory(world)      World.checkVictory in a mission: the hero beaten loses, every enemy beaten wins
//                               (once the objectives the mission's `waitFor` names are done)
//   campaignView(world)         the snapshot's `cp` record
import { PLAYER_COLORS, TICK_RATE } from '../config.js';
import { MISSIONS, MISSION_BY_ID } from '../data/campaign.js';
import { findPlacement } from './construction.js';
import { groupOrder } from './commands.js';
import { hyp } from './common.js';

export const HERO = 0;
export const OPEN = 0;
export const DONE = 1;
export const FAILED = 2;

/** The mission a setup plays, or null. */
export function missionOf(setup) {
  const id = setup && typeof setup.campaign === 'string' ? setup.campaign : null;
  return id && Object.hasOwn(MISSION_BY_ID, id) ? MISSION_BY_ID[id] : null;
}

export function campaignOn(setup) {
  return !!missionOf(setup);
}

/**
 * The GameSetup of a mission: the hero (player 0) and the mission's computer players.
 * @param {string} id mission id
 * @param {{ name?: string, version?: string }} [o]
 */
export function campaignSetup(id, { name = 'Player', version = '0.1.0' } = {}) {
  const m = MISSION_BY_ID[id];
  if (!m) throw new Error(`No such mission: ${id}`);
  return {
    version,
    seed: m.seed,
    mapSize: m.mapSize,
    campaign: m.id,
    players: m.players.map((p, i) => ({
      index: i,
      name: i === HERO ? name : p.name,
      team: p.team,
      pantheon: p.pantheon,
      color: PLAYER_COLORS[i],
      kind: i === HERO ? 'human' : 'ai',
      difficulty: i === HERO ? null : p.difficulty || 'normal',
    })),
  };
}

/** A player's Town Center (or any building of theirs while it stands), or null. */
function homeOf(world, owner) {
  let any = null;
  for (const b of world.buildingList) {
    if (b.dead || b.owner !== owner || b.def.wall) continue;
    if (b.type === 'town_center') return b;
    any = any || b;
  }
  return any;
}

/** Unit vector from a building toward the nearest Town Center of another team (else the map's middle). */
function frontDir(world, b) {
  const team = world.players[b.owner] ? world.players[b.owner].team : -1;
  let to = { x: world.map.width / 2, y: world.map.height / 2 };
  let bd = Infinity;
  for (const o of world.buildingList) {
    if (o.dead || o.type !== 'town_center' || o.owner < 0 || !world.players[o.owner] || world.players[o.owner].team === team) continue;
    const d = hyp(o.x - b.x, o.y - b.y);
    if (d < bd) {
      bd = d;
      to = o;
    }
  }
  const len = hyp(to.x - b.x, to.y - b.y) || 1;
  return { x: (to.x - b.x) / len, y: (to.y - b.y) / len };
}

/** Spawn units in a short line across the front of a building. */
function spawnFront(world, owner, b, list, reach, opts = {}) {
  const f = frontDir(world, b);
  const total = list.reduce((n, [, k]) => n + k, 0);
  const out = [];
  let k = 0;
  for (const [type, n] of list) {
    for (let i = 0; i < n; i++, k++) {
      const row = Math.floor(k / 6);
      const side = ((k % 6) - (Math.min(6, total - row * 6) - 1) / 2) * 1.2;
      const r = reach + row * 1.3;
      const u = world.spawnUnit(owner, type, b.x + f.x * r - f.y * side, b.y + f.y * r + f.x * side, { facing: Math.atan2(f.y, f.x), silent: true });
      if (u) out.push(u);
    }
  }
  return out;
}

/** Set the board: purses, a stronger or weaker Town Center, the buildings and units each side starts with. */
export function campaignStart(world) {
  const m = missionOf(world.setup);
  if (!m) return;
  world.players.forEach((p, i) => {
    const s = m.start[i] || {};
    for (const r of ['gold', 'wood', 'faith']) if (Number.isFinite(s[r])) p[r] = s[r];
    const tc = homeOf(world, i);
    if (!tc) return;
    if (world.campaign) world.campaign.homes[i] = { x: tc.x, y: tc.y, size: tc.size, owner: i };
    if (i === HERO) tc.cTag = 'home';
    if (s.townHp) {
      tc.maxHp = s.townHp;
      tc.hp = s.townHp;
    }
    const f = frontDir(world, tc);
    (s.buildings || []).forEach((sb, k) => {
      // Around the front of the Town Center: one straight ahead, then left and right of it.
      const ring = sb.ring || 7;
      const a = Math.atan2(f.y, f.x) + (k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.75);
      const spot = findPlacement(world, i, sb.type, tc.x + Math.cos(a) * ring, tc.y + Math.sin(a) * ring, 14);
      if (!spot) return;
      const b = world.createBuilding(i, sb.type, spot.tx, spot.ty, true, true);
      if (b && sb.tag) b.cTag = sb.tag;
    });
    if (s.units) spawnFront(world, i, tc, s.units, tc.size / 2 + 2);
  });
}

/** The director's state for a world whose setup is a mission (null otherwise). */
export function createCampaign(world) {
  const m = missionOf(world.setup);
  if (!m) return null;
  return {
    m,
    index: MISSIONS.indexOf(m),
    state: m.objectives.map(() => OPEN),
    value: m.objectives.map(() => 0),
    shown: m.objectives.map((o) => !o.hidden),
    fired: m.events.map(() => false),
    spawned: new Set(), // tags an event has spawned
    held: 0, // seconds the hero's team has held enough sacred sites without a break
    homes: [], // per player, where their Town Center stood at the start ({ x, y, size, owner }): an `always` spawn's fallback
    at: null, // [x, y] of the current objective, for the HUD's pointer
  };
}

/** Every building and unit of a tag, alive. */
function tagged(world, tag) {
  const out = [];
  for (const b of world.buildingList) if (!b.dead && b.cTag === tag) out.push(b);
  for (const u of world.unitList) if (!u.dead && u.cTag === tag) out.push(u);
  return out;
}

function heroTeam(world) {
  return world.players[HERO] ? world.players[HERO].team : 1;
}

function enemiesLeft(world) {
  const team = heroTeam(world);
  return world.players.filter((p) => p.team !== team && !p.defeated).length;
}

/** The nearest standing building of the hero's side, from a point. */
function nearestHeroBuilding(world, x, y) {
  const team = heroTeam(world);
  let best = null;
  let bd = Infinity;
  for (const b of world.buildingList) {
    if (b.dead || b.owner < 0 || b.def.wall) continue;
    const p = world.players[b.owner];
    if (!p || p.defeated || p.team !== team) continue;
    const d = hyp(b.x - x, b.y - y);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

/** Send marching units at their target building (a tag) or the hero's nearest building. */
function march(world, units, targetTag) {
  if (!units.length) return;
  let cx = 0;
  let cy = 0;
  for (const u of units) {
    cx += u.x;
    cy += u.y;
  }
  cx /= units.length;
  cy /= units.length;
  const want = targetTag ? tagged(world, targetTag).find((e) => e.kind === 'building') : null;
  const t = want || nearestHeroBuilding(world, cx, cy);
  if (t) groupOrder(world, units, t.x, t.y, 'attackMove', false);
}

function fire(world, cp, i) {
  const e = cp.m.events[i];
  cp.fired[i] = true;
  if (e.reveal) {
    const k = cp.m.objectives.findIndex((o) => o.id === e.reveal);
    if (k >= 0 && !cp.shown[k]) {
      cp.shown[k] = true;
      world.emit({ type: 'objective', i: k, s: cp.state[k] });
    }
  }
  if (e.spawn) {
    const s = e.spawn;
    cp.spawned.add(s.tag);
    const owner = s.owner;
    const p = world.players[owner];
    // An `always` spawn comes even once its owner is beaten (a story beat the mission waits for): from
    // where their Town Center stood at the start.
    let from = p && !p.defeated ? homeOf(world, owner) : null;
    if (!from && p && s.always) from = (cp.homes && cp.homes[owner]) || null;
    if (from) {
      const units = spawnFront(world, owner, from, s.units, from.size / 2 + 3);
      for (const u of units) {
        u.cTag = s.tag;
        if (s.march) u.cMarch = s.target || true;
      }
      if (s.march) march(world, units, s.target);
    }
  }
  if (e.say) world.emit({ type: 'campaignSay', e: i });
}

/** Is an objective done now (for the sticky kinds), and its number for the panel. */
function judge(world, cp, o) {
  switch (o.kind) {
    case 'build': {
      let n = 0;
      for (const b of world.buildingList) if (!b.dead && b.owner === HERO && b.type === o.type && b.constructed) n++;
      return [n >= o.count, n];
    }
    case 'gods': {
      let n = 0;
      for (const u of world.unitList) if (!u.dead && u.owner === HERO && u.def.class === 'god') n++;
      return [n >= o.count, n];
    }
    case 'army': {
      let n = 0;
      for (const u of world.unitList) if (!u.dead && u.owner === HERO && !u.summoned && u.def.class !== 'worker' && u.def.class !== 'god' && u.def.class !== 'titan') n++;
      return [n >= o.count, n];
    }
    case 'kill': {
      const n = tagged(world, o.tag).length;
      return [cp.spawned.has(o.tag) && n === 0, n];
    }
    case 'destroy': {
      const n = tagged(world, o.tag).length;
      return [n === 0, n];
    }
    case 'survive':
      return [world.time >= o.seconds - 1e-9, Math.max(0, Math.ceil(o.seconds - world.time))];
    case 'hold':
      return [cp.held >= o.seconds, cp.held];
    case 'conquer': {
      const n = enemiesLeft(world);
      return [n === 0, n];
    }
    case 'protect':
      return [false, tagged(world, o.tag).length];
    default:
      return [false, 0];
  }
}

/**
 * The objective the panel's pin is about: the first open, shown one that is neither optional nor a protect one, else
 * the first open optional one (-1 for none). Shared with the HUD (hud-campaign.js).
 */
export function currentObjective(objectives, state, shown) {
  let bonus = -1;
  for (let i = 0; i < objectives.length; i++) {
    const o = objectives[i];
    if (state[i] !== OPEN || !shown[i] || o.kind === 'protect') continue;
    if (!o.optional) return i;
    if (bonus < 0) bonus = i;
  }
  return bonus;
}

/** Where the HUD's pointer goes: the current objective's spot, if it has one. */
function pointAt(world, cp) {
  const i = currentObjective(cp.m.objectives, cp.state, cp.shown);
  const o = i >= 0 ? cp.m.objectives[i] : null;
  if (!o) return null;
  const team = heroTeam(world);
  if (o.kind === 'kill' || o.kind === 'destroy') {
    const list = tagged(world, o.tag);
    if (!list.length) return null;
    let x = 0;
    let y = 0;
    for (const e of list) {
      x += e.x;
      y += e.y;
    }
    return [Math.round((x / list.length) * 10) / 10, Math.round((y / list.length) * 10) / 10];
  }
  if (o.kind === 'hold') {
    const home = homeOf(world, HERO);
    if (!home) return null;
    let best = null;
    let bd = Infinity;
    for (const s of world.sites) {
      if (s.owner >= 0 && world.players[s.owner] && world.players[s.owner].team === team) continue;
      const d = hyp(s.x - home.x, s.y - home.y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best ? [best.x, best.y] : null;
  }
  if (o.kind === 'conquer') {
    let best = null;
    for (const b of world.buildingList) {
      if (b.dead || b.owner < 0 || b.def.wall || !world.players[b.owner] || world.players[b.owner].team === team) continue;
      if (!best || b.type === 'town_center') best = b;
      if (b.type === 'town_center') break;
    }
    return best ? [best.x, best.y] : null;
  }
  return null;
}

function end(world, win) {
  if (world.gameOver) return;
  const team = heroTeam(world);
  let winningTeam = team;
  if (!win) {
    const other = world.players.find((p) => p.team !== team);
    winningTeam = other ? other.team : null;
  }
  world.winningTeam = winningTeam;
  world.gameOver = { winningTeam, how: 'campaign' };
  world.emit({ type: 'gameOver', winningTeam, how: 'campaign' });
}

/** Is a mission's "every enemy beaten" win still waiting for a story objective (the mission's `waitFor`)? */
function waiting(cp) {
  const ids = cp && cp.m.waitFor;
  if (!ids || !ids.length) return false;
  return cp.m.objectives.some((o, i) => ids.includes(o.id) && cp.state[i] !== DONE);
}

/**
 * World.checkVictory in a mission: the hero beaten loses; every enemy beaten wins, whatever is left undone,
 * except an objective the mission's `waitFor` names: then the mission goes on until it is done (updateCampaign
 * ends it, won once every objective is).
 */
export function campaignVictory(world) {
  if (world.gameOver) return;
  const me = world.players[HERO];
  if (!me || me.defeated) return end(world, false);
  if (enemiesLeft(world) > 0) return;
  const cp = world.campaign;
  if (waiting(cp)) return;
  // A protected building that fell since the last once-a-second look still fails the mission.
  if (cp && cp.m.objectives.some((o, i) => o.kind === 'protect' && cp.state[i] !== FAILED && tagged(world, o.tag).length === 0)) {
    cp.m.objectives.forEach((o, i) => {
      if (o.kind !== 'protect' || cp.state[i] === FAILED || tagged(world, o.tag).length) return;
      cp.state[i] = FAILED;
      cp.shown[i] = true;
      world.emit({ type: 'objective', i, s: FAILED });
    });
    return end(world, false);
  }
  end(world, true);
}

/** One tick of the director: events on the clock; once a second the objectives, the pointer and the end. */
export function updateCampaign(world) {
  const cp = world.campaign;
  if (!cp || world.gameOver) return;
  const m = cp.m;
  for (let i = 0; i < m.events.length; i++) {
    if (cp.fired[i]) continue;
    const e = m.events[i];
    if (Number.isFinite(e.at) && world.time >= e.at - 1e-9) fire(world, cp, i);
  }
  if (world.tickCount % TICK_RATE !== 0) return;
  // Sacred ground: the seconds the hero's team has held enough sites at once.
  const hold = m.objectives.find((o) => o.kind === 'hold');
  if (hold) {
    const team = heroTeam(world);
    const n = world.sites.reduce((k, s) => k + (s.owner >= 0 && world.players[s.owner] && world.players[s.owner].team === team ? 1 : 0), 0);
    cp.held = n >= hold.count ? cp.held + 1 : 0;
  }
  let failed = false;
  for (let i = 0; i < m.objectives.length; i++) {
    const o = m.objectives[i];
    const [ok, v] = judge(world, cp, o);
    cp.value[i] = v;
    if (cp.state[i] !== OPEN) continue;
    if (o.kind === 'protect') {
      if (v === 0) {
        cp.state[i] = FAILED;
        cp.shown[i] = true;
        failed = true;
        world.emit({ type: 'objective', i, s: FAILED });
      }
    } else if (ok) {
      cp.state[i] = DONE;
      world.emit({ type: 'objective', i, s: DONE });
      m.events.forEach((e, k) => {
        if (!cp.fired[k] && e.after === o.id) fire(world, cp, k);
      });
    } else if (Number.isFinite(o.limit) && world.time >= o.limit - 1e-9) {
      // Out of time: not done by its limit, the objective fails, and the mission with it.
      cp.state[i] = FAILED;
      cp.shown[i] = true;
      failed = true;
      world.emit({ type: 'objective', i, s: FAILED });
    }
  }
  // Raiders with nothing left to do march on again (their target fell, or they won a fight).
  const idle = [];
  for (const u of world.unitList) if (!u.dead && u.cMarch && !u.order && !u.forced && !u.orders.length) idle.push(u);
  for (const u of idle) march(world, [u], u.cMarch === true ? null : u.cMarch);
  cp.at = pointAt(world, cp);
  if (failed) return end(world, false);
  const won = m.objectives.every((o, i) => o.optional || o.kind === 'protect' || cp.state[i] === DONE);
  if (won) end(world, true);
  // Every enemy beaten while the mission waited for a story objective: that wait is over now.
  else if (m.waitFor && !waiting(cp) && enemiesLeft(world) === 0) campaignVictory(world);
}

/** Snapshot record: { o: per objective [state, value, shown 0/1], h: seconds held, at: [x, y] | null }. */
export function campaignView(world) {
  const cp = world.campaign;
  if (!cp) return null;
  return { o: cp.state.map((s, i) => [s, cp.value[i], cp.shown[i] ? 1 : 0]), h: cp.held, at: cp.at ? cp.at.slice() : null };
}

