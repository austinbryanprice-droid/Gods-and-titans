// ViewSnapshot builder (DESIGN 6.3): compact, rounded views of the world.
import { canRank } from '../data/ranks.js';
import { statusCodes } from './status.js';
import { activeMiners } from './economy.js';
import { relicViews } from './relics.js';
import { powerView } from './powers.js';
import { survivalView } from './survival.js';
import { campaignView } from './campaign.js';
import { siteViews } from './sacred.js';
import { BUILDINGS } from '../data/buildings.js';

const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;

function pendingBuild(u) {
  const check = (o) => o && o.type === 'build' && !o.site && !o.helper && o.paid;
  if (check(u.order)) return u.order;
  for (const o of u.orders) if (check(o)) return o;
  return null;
}

/**
 * What a worshipper is busy with, for the HUD's task counts: 'gold', 'wood',
 * 'pray', 'build', 'repair', 'idle', or 'other' (walking, fighting, following).
 */
export function workerTask(u) {
  const o = u.order;
  if (!o) {
    if (pendingBuild(u)) return 'build';
    return u.orders.length ? 'other' : 'idle';
  }
  switch (o.type) {
    case 'gather': return o.mine ? 'gold' : 'wood';
    case 'return': {
      const r = o.resume;
      if (r) return r.mine ? 'gold' : 'wood';
      return u.carry === 'g' ? 'gold' : u.carry === 'w' ? 'wood' : 'other';
    }
    case 'pray': return 'pray';
    case 'build': return 'build';
    case 'repair': return 'repair';
    default: return pendingBuild(u) ? 'build' : 'other';
  }
}

/** Order points a selected unit's path shows: its current one and the next few queued (DESIGN 6.3 wp). */
export const WAYPOINTS_MAX = 5;
const MOVE_ORDERS = new Set(['move', 'attackMove', 'patrol']);
const ATTACK_ORDERS = new Set(['attackMove', 'attack', 'patrol']);

/** Where an order goes, as [x, y], or null when it names no place (Stop, a return trip, a relic run). */
function orderPoint(world, o) {
  if (Number.isFinite(o.x) && Number.isFinite(o.y)) return [o.x, o.y];
  const id = o.target || o.mine || o.building || o.site;
  if (id) {
    const e = world.entities.get(id);
    return e && !e.dead ? [e.x, e.y] : null;
  }
  if (o.tree) return [o.tree.tx + 0.5, o.tree.ty + 0.5];
  if (o.type === 'build' && Number.isFinite(o.tx)) {
    const size = (BUILDINGS[o.b] && BUILDINGS[o.b].size) || 1;
    return [o.tx + size / 2, o.ty + size / 2];
  }
  return null;
}

/**
 * A unit's path for its owner's view: wp = [[x, y, kind, id?], …] (kind 0 move, 1 attack, 2 work; id = the
 * unit the order goes for, when it is one) for its
 * current order and the next queued ones, up to WAYPOINTS_MAX; pe = the patrol's other end when the
 * path ends in a patrol (always last: an order queued after one replaces it). Null for a unit with nothing worth drawing: no
 * queue and a standing order that is not a move (gathering, praying, guarding).
 */
export function unitPath(world, u) {
  const cur = u.order;
  if (!u.orders.length && !(cur && MOVE_ORDERS.has(cur.type))) return null;
  const wp = [];
  let pe = null;
  for (let i = -1; i < u.orders.length && wp.length < WAYPOINTS_MAX; i++) {
    const o = i < 0 ? cur : u.orders[i];
    if (!o) continue;
    const pt = orderPoint(world, o);
    if (!pt) continue;
    const kind = ATTACK_ORDERS.has(o.type) ? 1 : o.type === 'move' || o.type === 'follow' ? 0 : 2;
    // a unit it goes for moves: tenths are enough, and its id lets the view draw it where it is seen (or not at all
    // in the fog, so a queued attack never tracks a hidden enemy)
    const t = o.target && !Number.isFinite(o.x) ? world.entities.get(o.target) : null;
    wp.push(t && t.kind === 'unit' ? [r1(pt[0]), r1(pt[1]), kind, t.id] : [r2(pt[0]), r2(pt[1]), kind]);
    if (o.type === 'patrol') {
      pe = [r2(o.ax), r2(o.ay)];
      break;
    }
  }
  return wp.length ? { wp, pe } : null;
}

function unitView(world, u) {
  const v = {
    id: u.id, k: 'u', t: u.type, o: u.owner,
    x: r2(u.x), y: r2(u.y), f: r2(u.facing),
    hp: Math.ceil(u.hp), mhp: Math.round(u.maxHp), sh: Math.round(u.shield),
    st: u.state, tg: u.target || 0,
    c: u.carry && u.carryAmount > 0 ? u.carry : 0,
  };
  if (u.def.class === 'god') {
    v.lv = u.level;
    v.xp = Math.floor(u.xp);
  } else if (u.xp >= 1 && canRank(u.def)) {
    // soldiers: omitted until they have earned something
    v.xp = Math.floor(u.xp);
    if (u.rank > 0) v.rk = u.rank;
  }
  if (u.boost && u.boost.dmg !== 1) v.wd = Math.round(u.boost.dmg * 1000) / 1000; // Trial of the Titans: damage boost for the info panel
  const cd = {};
  for (const k in u.cooldowns) cd[k] = r1(u.cooldowns[k]);
  v.cd = cd;
  v.fx = statusCodes(u);
  // abilities set to manual (bit i = def.abilities[i]); omitted when all autocast
  if (u.manualMask && u.owner >= 0) v.mc = u.manualMask;
  if (u.summoned && u.expire > 0) v.ex = r1(u.expire);
  if (u.def.class === 'worker') {
    const b = pendingBuild(u);
    if (b) v.bo = { b: b.b, tx: b.tx, ty: b.ty };
    v.tk = workerTask(u);
  }
  // waiting its turn at a gold mine (all MINE_SLOTS taken); omitted otherwise
  const o = u.order;
  if (o && o.type === 'gather' && o.phase === 'wait') v.mw = 1;
  // a standing order, so the HUD can tell a guard or a patrol from an idle soldier; omitted otherwise
  if (o && o.type === 'hold') v.ho = 1;
  else if (o && o.type === 'patrol') v.pa = 1;
  // a human player's unit: where its orders go, for the dotted path under a selection (only their seats,
  // so the AI's busy queues cost no bandwidth); omitted when there is nothing to draw
  const p = u.owner >= 0 ? world.players[u.owner] : null;
  if (p && p.kind === 'human') {
    const path = unitPath(world, u);
    if (path) {
      v.wp = path.wp;
      if (path.pe) v.pe = path.pe;
    }
  }
  return v;
}

function buildingView(b) {
  const v = {
    id: b.id, k: 'b', t: b.type, o: b.owner,
    x: r2(b.x), y: r2(b.y), f: 0,
    hp: Math.ceil(b.hp), mhp: Math.round(b.maxHp), sh: 0,
    st: b.constructed ? b.state : 'build', tg: b.target || 0,
    tx: b.tx, ty: b.ty,
    bp: b.constructed ? 1 : Math.min(0.99, r2(b.buildProgress)),
    q: b.queue.map((q, i) => ({ u: q.u, p: i === 0 ? Math.min(0.99, r2(q.elapsed / q.time)) : 0 })),
    rp: b.rally ? [r2(b.rally.x), r2(b.rally.y)] : null,
  };
  if (b.type === 'town_center') v.tr = b.tier;
  if (b.def.prayerSlots > 0) v.pr = b.prayingCount || 0;
  return v;
}

function mineView(world, m) {
  return {
    id: m.id, k: 'm', t: m.type, o: m.owner,
    x: r2(m.x), y: r2(m.y), f: 0,
    hp: m.hp, mhp: m.maxHp, sh: 0, st: 'idle', tg: 0,
    tx: m.tx, ty: m.ty, amt: m.amount,
    mn: activeMiners(world, m),
  };
}

/** Build the ViewSnapshot. Does not clear events (World.getSnapshot does). */
export function buildSnapshot(world) {
  const gods = world.players.map(() => []);
  const titan = world.players.map(() => false);
  const army = world.players.map(() => 0); // population in fighting units (not worshippers, not summoned)
  const entities = [];
  for (const e of world.entities.values()) {
    if (e.dead) continue;
    if (e.kind === 'unit') {
      if (e.owner >= 0 && !e.summoned) {
        if (e.def.class === 'god') gods[e.owner].push(e.type);
        else if (e.def.class === 'titan') titan[e.owner] = true;
        if (e.def.class !== 'worker') army[e.owner] += e.def.pop || 0;
      }
      entities.push(unitView(world, e));
    } else if (e.kind === 'building') entities.push(buildingView(e));
    else entities.push(mineView(world, e));
  }
  const players = world.players.map((p, i) => {
    const fallen = {};
    for (const k in p.fallen) fallen[k] = p.fallen[k].level;
    const out = {
      i, name: p.name, team: p.team, pantheon: p.pantheon, color: p.color, kind: p.kind,
      gold: Math.floor(p.gold), wood: Math.floor(p.wood), faith: Math.floor(p.faith + 1e-6), faithRate: r2(p.faithRate),
      pop: p.popUsed, popCap: p.popCap, tier: p.tier, defeated: p.defeated,
      gods: gods[i], fallen, titan: titan[i],
      up: p.upList.slice(), ar: p.autoRepair,
      stats: { ...p.stats, faith: Math.floor(p.stats.faith + 1e-6), army: army[i] },
      ...powerView(p),
    };
    if (p.relics.length) out.rl = p.relics.slice(); // relic types resting in their Temples
    if (p.surrendered) out.sur = true; // fell by surrendering, not in a fight (the career, DESIGN 9.1)
    return out;
  });
  const snap = {
    tick: world.tickCount,
    time: r2(world.time),
    players,
    entities,
    fields: world.fields.map((f) => ({ id: f.id, x: r2(f.x), y: r2(f.y), r: r2(f.r), el: f.el, rem: r1(f.rem) })),
    reveals: world.reveals.map((v) => ({ x: r2(v.x), y: r2(v.y), r: r2(v.r), tm: v.team, rem: r1(v.rem) })),
    relics: relicViews(world),
    events: world.events,
    felled: world.felled,
    sites: siteViews(world), // sacred sites (5.11): { x, y, o, p?, c?, cn? }
    sacred: world.sacred ? { tm: world.sacred.team, end: world.sacred.end } : null, // Sacred Victory countdown
    gameOver: world.gameOver ? { ...world.gameOver } : null,
  };
  if (world.survival) snap.sv = survivalView(world); // Trial of the Titans: { w: waves out, m: wave monsters alive }
  if (world.campaign) snap.cp = campaignView(world); // a campaign mission: its objectives, sites held, the pointer
  return snap;
}
