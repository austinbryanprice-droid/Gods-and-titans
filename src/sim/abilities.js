// Abilities: cast orders (walk into range, wind-up, cooldown), every effect
// type from DESIGN 4.4 (with delays and god level scaling), ground fields,
// reveals, and autocast: every fighting unit's abilities cast themselves by
// default; a player can set any ability to manual per unit.
import { DT, ABILITY_LEVEL_SCALE, TICK_RATE } from '../config.js';
import { getUnitType } from '../data/index.js';
import { dealDamage, heal, acquisitionRange } from './combat.js';
import { addStatus } from './status.js';
import { moveToPoint, moveToEntity, stopMove } from './movement.js';
import { hyp, distToEntity, round2 } from './common.js';
import { chooseCast } from './cast-choice.js';

const HARMFUL = new Set(['damage', 'stun', 'slow', 'dot', 'chain', 'line', 'knockback', 'pull', 'dash']);
const FIELD_TICK = 0.5;
const DASH_SPEED = 20;

/**
 * Is an ability on autocast when its unit spawns? Every fighting unit's
 * abilities are; a worshipper's only when the data marks them autocast.
 */
export function autocastByDefault(def, ab) {
  return def.class !== 'worker' || !!ab.autocast;
}

/** Manual-cast bit mask a new unit of this type starts with (bit i = abilities[i] is manual). */
export function defaultManualMask(def, owner = 0) {
  const list = def.abilities || [];
  let mask = 0;
  for (let i = 0; i < list.length && i < 31; i++) {
    // Neutral creeps keep their designed behaviour: only data-autocast abilities.
    const auto = owner < 0 ? !!list[i].autocast : autocastByDefault(def, list[i]);
    if (!auto) mask |= 1 << i;
  }
  return mask;
}

/** Rebuild u.autocast (the abilities tryAutocast looks at) from u.manualMask. */
export function refreshAutocast(u) {
  const list = u.def.abilities || [];
  u.autocast = list.filter((ab, i) => i < 31 && !(u.manualMask & (1 << i)));
}

/** Is this ability of the unit on autocast? */
export function isAutocastOn(u, ab) {
  const i = u.def.abilities.indexOf(ab);
  return i >= 0 && i < 31 && !(u.manualMask & (1 << i));
}

/**
 * Turn autocast on or off for one ability of a unit (abilityId) or for all of
 * them (abilityId undefined). Returns true when anything changed.
 */
export function setAutocast(u, abilityId, on) {
  const list = u.def.abilities || [];
  let mask = u.manualMask;
  for (let i = 0; i < list.length && i < 31; i++) {
    if (abilityId !== undefined && list[i].id !== abilityId) continue;
    if (on) mask &= ~(1 << i);
    else mask |= 1 << i;
  }
  if (mask === u.manualMask) return false;
  u.manualMask = mask;
  refreshAutocast(u);
  // A cast autocast had already started for an ability now set to manual is dropped.
  const o = u.order;
  if (!on && o && o.type === 'cast' && o.auto && !isAutocastOn(u, findAbility(u, o.ability))) o.phase = 'drop';
  return true;
}

export function findAbility(u, abilityId) {
  const list = u.def.abilities;
  for (let i = 0; i < list.length; i++) if (list[i].id === abilityId) return list[i];
  return null;
}

/** Gods unlock abilities by level; other units have them all. */
export function isUnlocked(u, ab) {
  return u.def.class !== 'god' || (u.level || 1) >= (ab.unlockLevel || 1);
}

/** Ability amount multiplier from god level. */
export function abilityScale(u) {
  return u.def.class === 'god' ? 1 + ABILITY_LEVEL_SCALE * ((u.level || 1) - 1) : 1;
}

export function cooldownLeft(u, ab) {
  return u.cooldowns[ab.id] || 0;
}

/** Largest effect radius of an ability (used for self-centred targeting). */
export function abilityRadius(ab) {
  let r = 0;
  for (const e of ab.effects) r = Math.max(r, e.radius || 0, e.type === 'line' ? (e.length || 0) : 0);
  return r;
}

/**
 * Validate a cast target for an ability. Returns { x, y, target } or null.
 * target is the entity for unit/ally/enemy abilities.
 */
export function resolveCastTarget(world, u, ab, x, y, targetId) {
  if (ab.target === 'none') return { x: u.x, y: u.y, target: null };
  const t = targetId ? world.entities.get(targetId) : null;
  if (ab.target === 'point') {
    if (t && !t.dead && t.kind !== 'mine') return { x: t.x, y: t.y, target: null };
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return { x: Math.max(0, Math.min(world.map.width, x)), y: Math.max(0, Math.min(world.map.height, y)), target: null };
    }
    return null;
  }
  if (!t || t.dead || t.kind === 'mine') return null;
  if (ab.target === 'unit') return t.kind === 'unit' ? { x: t.x, y: t.y, target: t } : null;
  if (ab.target === 'ally') return t.kind === 'unit' && !world.areEnemies(u.owner, t.owner) ? { x: t.x, y: t.y, target: t } : null;
  if (ab.target === 'enemy') return world.areEnemies(u.owner, t.owner) ? { x: t.x, y: t.y, target: t } : null;
  return null;
}

/**
 * Advance a cast order. Returns true when the order is finished.
 * o = { type: 'cast', ability, x, y, target, phase, timer, auto }
 */
export function updateCastOrder(world, u, o) {
  const ab = findAbility(u, o.ability);
  if (!ab || o.phase === 'drop') return true;
  const t = o.target ? world.entities.get(o.target) : null;
  if (o.target && (!t || t.dead)) return true;
  if (u.stunned) {
    o.phase = 'approach';
    u.state = 'idle';
    return false;
  }
  const px = t ? t.x : o.x;
  const py = t ? t.y : o.y;
  if (o.phase !== 'wind') {
    // Blinks and dashes aimed at a point clamp to their range instead of walking there.
    const clampOnly = !t && ab.target === 'point' && hasEffect(ab, ['blink', 'dash']);
    if (ab.target !== 'none' && !clampOnly) {
      const d = t ? distToEntity(u.x, u.y, t) : hyp(px - u.x, py - u.y);
      if (d > ab.range + 0.05) {
        if (o.auto) return true; // autocasts never chase
        u.state = 'move';
        u.target = t ? t.id : 0;
        const mv = t ? moveToEntity(world, u, t) : moveToPoint(world, u, px, py);
        if (mv.failed || (mv.arrived && !t)) {
          stopMove(u);
          world.error(u.owner, 'Target out of range.');
          return true;
        }
        return false;
      }
    }
    o.phase = 'wind';
    o.timer = ab.castTime || 0;
    stopMove(u);
  }
  u.state = 'cast';
  u.target = t ? t.id : 0;
  if (ab.target !== 'none' && (Math.abs(px - u.x) > 1e-3 || Math.abs(py - u.y) > 1e-3)) u.facing = Math.atan2(py - u.y, px - u.x);
  if (o.timer > 1e-9) {
    o.timer -= DT;
    if (o.timer > 1e-9) return false;
  }
  if (!isUnlocked(u, ab)) {
    world.error(u.owner, `That ability unlocks at level ${ab.unlockLevel || 1}.`);
    return true;
  }
  if (cooldownLeft(u, ab) > 0) {
    if (!o.auto) world.error(u.owner, 'That ability is not ready.');
    return true;
  }
  executeAbility(world, u, ab, { x: px, y: py, target: t });
  return true;
}

/** Fire an ability now: cooldown, events, and effects (delayed ones are scheduled). */
export function executeAbility(world, u, ab, tgt) {
  u.cooldowns[ab.id] = ab.cooldown;
  const ctx = {
    caster: u,
    owner: u.owner,
    ab,
    scale: abilityScale(u),
    px: tgt.x,
    py: tgt.y,
    targetId: tgt.target ? tgt.target.id : 0,
    ox: u.x,
    oy: u.y,
  };
  world.emit({ type: 'cast', src: u.id, ability: ab.id, x: round2(tgt.x), y: round2(tgt.y), target: ctx.targetId });
  emitCastVfx(world, ctx);
  const effs = ab.effects;
  for (let i = 0; i < effs.length; i++) {
    const eff = effs[i];
    if (eff.delay > 0) world.delayed.push({ t: world.time + eff.delay, ctx, eff, i });
    else applyEffect(world, ctx, eff, i);
  }
}

function effectAt(ctx, eff) {
  return eff.at || (ctx.ab.target === 'none' ? 'self' : 'target');
}

function effectCenter(world, ctx, eff) {
  if (effectAt(ctx, eff) === 'self') {
    const c = ctx.caster;
    return c.dead ? { x: ctx.ox, y: ctx.oy, unit: null, self: true } : { x: c.x, y: c.y, unit: null, self: true };
  }
  if (ctx.targetId) {
    const t = world.entities.get(ctx.targetId);
    if (t && !t.dead) {
      ctx.px = t.x;
      ctx.py = t.y;
      return { x: t.x, y: t.y, unit: t, self: false };
    }
  }
  return { x: ctx.px, y: ctx.py, unit: null, self: false };
}

function effectDuration(ab) {
  let d = 0;
  for (const e of ab.effects) {
    if (e.duration > d) d = e.duration;
    if (e.delay > 0 && e.delay + 0.5 > d) d = e.delay + 0.5;
  }
  return d > 0 ? d : 0.6;
}

function lineGeometry(ctx, eff) {
  let dx = ctx.px - ctx.ox;
  let dy = ctx.py - ctx.oy;
  let d = hyp(dx, dy);
  if (d < 1e-3) {
    dx = Math.cos(ctx.caster.facing);
    dy = Math.sin(ctx.caster.facing);
    d = 1;
  }
  const len = eff.length || ctx.ab.range || 6;
  return { dirx: dx / d, diry: dy / d, len };
}

/** One VFX request per cast (chain/blink/dash emit theirs when they resolve). */
function emitCastVfx(world, ctx) {
  const ab = ctx.ab;
  const effs = ab.effects;
  if (effs.some((e) => e.type === 'chain' || e.type === 'blink' || e.type === 'dash')) return;
  const first = effs[0];
  const c = effectCenter(world, ctx, first);
  let r = 0;
  let minDelay = Infinity;
  for (const e of effs) {
    r = Math.max(r, e.radius || 0, e.type === 'line' ? (e.width || 1.5) / 2 : 0);
    minDelay = Math.min(minDelay, e.delay > 0 ? e.delay : 0);
  }
  const vfx = ab.vfx || { element: 'arcane', shape: 'nova' };
  const evt = { type: 'effect', el: vfx.element, shape: vfx.shape, x: round2(c.x), y: round2(c.y), r: round2(r), duration: round2(effectDuration(ab)), src: ctx.caster.id, ability: ab.id };
  const line = effs.find((e) => e.type === 'line');
  if (line) {
    const g = lineGeometry(ctx, line);
    evt.fx = round2(ctx.ox);
    evt.fy = round2(ctx.oy);
    evt.x = round2(ctx.ox + g.dirx * g.len);
    evt.y = round2(ctx.oy + g.diry * g.len);
  }
  if (minDelay > 0 && minDelay < Infinity) evt.delay = round2(minDelay);
  world.emit(evt);
}

/** Entities an effect applies to. */
function collect(world, ctx, eff, c, harmful, withBuildings) {
  const caster = ctx.caster;
  const owner = ctx.owner;
  const affects = eff.affects || (harmful ? 'enemies' : 'allies');
  if (affects === 'self') return caster.dead ? [] : [caster];
  const ok = (e) => {
    if (e.dead || e.kind === 'mine') return false;
    if (e.kind === 'building' && !withBuildings) return false;
    if (affects === 'all') return true;
    const enemy = world.areEnemies(owner, e.owner);
    return affects === 'enemies' ? enemy : !enemy;
  };
  const r = eff.radius || 0;
  let list;
  if (r <= 0) {
    if (c.unit) list = ok(c.unit) ? [c.unit] : [];
    else if (c.self) list = !caster.dead && ok(caster) ? [caster] : [];
    else {
      list = world.queryRadius(c.x, c.y, 0.6, ok);
      if (list.length > 1) {
        list.sort((a, b) => hyp(a.x - c.x, a.y - c.y) - hyp(b.x - c.x, b.y - c.y) || a.id - b.id);
        list.length = 1;
      }
    }
  } else {
    list = world.queryRadius(c.x, c.y, r, ok);
  }
  if (eff.maxTargets > 0 && list.length > eff.maxTargets) {
    // The cast's own target first (a pull "at self" drags the enemy it seized), then the nearest.
    const tid = ctx.targetId || 0;
    list.sort((a, b) => (b.id === tid) - (a.id === tid) || hyp(a.x - c.x, a.y - c.y) - hyp(b.x - c.x, b.y - c.y) || a.id - b.id);
    list.length = eff.maxTargets;
  }
  return list;
}

function interruptCast(u) {
  if (u.order && u.order.type === 'cast' && u.order.phase === 'wind') u.order.phase = 'approach';
}

/** Apply one effect of an ability. */
export function applyEffect(world, ctx, eff, index) {
  const ab = ctx.ab;
  const caster = ctx.caster;
  const key = `${ab.id}:${index}`;
  const scale = ctx.scale;
  const type = eff.type;
  const harmful = HARMFUL.has(type) || (type === 'buff' && eff.amount < 0);
  const c = effectCenter(world, ctx, eff);
  switch (type) {
    case 'damage': {
      for (const e of collect(world, ctx, eff, c, true, true)) dealDamage(world, e, eff.amount * scale, caster, { spell: true });
      break;
    }
    case 'heal': {
      for (const e of collect(world, ctx, eff, c, false, false)) heal(e, eff.amount * scale);
      break;
    }
    case 'stun': {
      for (const e of collect(world, ctx, eff, c, true, false)) {
        addStatus(e, { type: 'stun', key, rem: eff.duration });
        e.stunned = true;
        interruptCast(e);
      }
      break;
    }
    case 'slow': {
      for (const e of collect(world, ctx, eff, c, true, false)) addStatus(e, { type: 'slow', key, pct: eff.pct || 0.3, rem: eff.duration });
      break;
    }
    case 'buff': {
      for (const e of collect(world, ctx, eff, c, harmful, false)) addStatus(e, { type: 'buff', key, stat: eff.stat, amount: eff.amount, rem: eff.duration });
      break;
    }
    case 'dot': {
      for (const e of collect(world, ctx, eff, c, true, true)) {
        if (e.kind === 'unit') addStatus(e, { type: 'dot', key, dps: (eff.dps || 0) * scale, rem: eff.duration, src: caster });
        else dealDamage(world, e, (eff.dps || 0) * scale * eff.duration, caster, { spell: true });
      }
      break;
    }
    case 'field': {
      world.fields.push({
        id: world.nextFieldId++,
        x: c.x,
        y: c.y,
        r: eff.radius || 2,
        el: (ab.vfx && ab.vfx.element) || 'arcane',
        rem: eff.duration,
        dps: (eff.dps || 0) * scale,
        hps: (eff.hps || 0) * scale,
        slowPct: eff.slowPct || 0,
        owner: ctx.owner,
        src: caster,
        acc: FIELD_TICK,
      });
      break;
    }
    case 'summon': {
      const def = getUnitType(eff.unit);
      if (!def) break;
      const n = Math.max(1, eff.count || 1);
      const base = world.rng.next() * Math.PI * 2;
      for (let k = 0; k < n; k++) {
        const a = base + (k * Math.PI * 2) / n;
        const rr = n > 1 ? 1.1 + def.radius : 0.9;
        world.spawnUnit(ctx.owner, eff.unit, c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr, {
          summoned: true,
          expire: eff.duration > 0 ? eff.duration : 0,
          facing: a,
        });
      }
      break;
    }
    case 'chain': {
      let cur = c.unit && !c.unit.dead && c.unit.kind === 'unit' && world.areEnemies(ctx.owner, c.unit.owner) ? c.unit : null;
      if (!cur) {
        const near = world.queryRadius(c.x, c.y, 1.5, (e) => e.kind === 'unit' && world.areEnemies(ctx.owner, e.owner));
        near.sort((a, b) => hyp(a.x - c.x, a.y - c.y) - hyp(b.x - c.x, b.y - c.y) || a.id - b.id);
        cur = near[0] || null;
      }
      const points = [[round2(caster.dead ? ctx.ox : caster.x), round2(caster.dead ? ctx.oy : caster.y)]];
      const hit = new Set();
      let amount = eff.amount * scale;
      const bounces = eff.bounces ?? 3;
      const range = eff.bounceRange || 4;
      const falloff = eff.falloff ?? 0.8;
      for (let k = 0; k <= bounces && cur; k++) {
        hit.add(cur.id);
        points.push([round2(cur.x), round2(cur.y)]);
        const from = cur;
        dealDamage(world, cur, amount, caster, { spell: true });
        amount *= falloff;
        let best = null;
        let bestD = Infinity;
        for (const e of world.queryRadius(from.x, from.y, range, (o) => o.kind === 'unit' && !hit.has(o.id) && world.areEnemies(ctx.owner, o.owner))) {
          const d = hyp(e.x - from.x, e.y - from.y);
          if (d < bestD || (d === bestD && e.id < best.id)) {
            bestD = d;
            best = e;
          }
        }
        cur = best;
      }
      const vfx = ab.vfx || { element: 'lightning', shape: 'chain' };
      world.emit({ type: 'effect', el: vfx.element, shape: vfx.shape, x: round2(c.x), y: round2(c.y), r: 0, points, duration: 0.5, src: caster.id, ability: ab.id });
      break;
    }
    case 'line': {
      const g = lineGeometry(ctx, eff);
      const width = eff.width || 1.5;
      const ox = ctx.ox;
      const oy = ctx.oy;
      const mx = ox + (g.dirx * g.len) / 2;
      const my = oy + (g.diry * g.len) / 2;
      const owner = ctx.owner;
      for (const e of world.queryRadius(mx, my, g.len / 2 + width, (o) => world.areEnemies(owner, o.owner) && o.kind !== 'mine')) {
        const rx = e.x - ox;
        const ry = e.y - oy;
        const along = rx * g.dirx + ry * g.diry;
        const perp = Math.abs(rx * -g.diry + ry * g.dirx);
        const er = e.kind === 'unit' ? e.radius : e.size / 2;
        if (along < -er || along > g.len + er || perp > width / 2 + er) continue;
        dealDamage(world, e, eff.amount * scale, caster, { spell: true });
      }
      break;
    }
    case 'knockback':
    case 'pull': {
      for (const e of collect(world, ctx, eff, c, true, false)) {
        if (e === caster || e.kind !== 'unit') continue;
        let dx = e.x - c.x;
        let dy = e.y - c.y;
        let d = hyp(dx, dy);
        if (d < 1e-3) {
          dx = Math.cos(caster.facing);
          dy = Math.sin(caster.facing);
          d = 1e-3;
        } else {
          dx /= d;
          dy /= d;
        }
        let dist = (eff.distance || 2) / Math.max(1, e.radius / 0.6);
        if (type === 'pull') {
          dist = Math.min(dist, Math.max(0, d - e.radius - 0.4));
          dx = -dx;
          dy = -dy;
        }
        if (dist <= 0.01) continue;
        const dur = 0.25;
        e.forced = { vx: (dx * dist) / dur, vy: (dy * dist) / dur, rem: dur };
        e.mv = null;
        interruptCast(e);
      }
      break;
    }
    case 'blink': {
      if (caster.dead) break;
      const dest = clampedDestination(world, caster, ctx.px, ctx.py, ab.range || 8);
      const fx = caster.x;
      const fy = caster.y;
      caster.x = dest.x;
      caster.y = dest.y;
      caster.mv = null;
      caster.forced = null;
      caster.facing = Math.atan2(dest.y - fy, dest.x - fx) || caster.facing;
      const vfx = ab.vfx || { element: 'arcane', shape: 'blink' };
      world.emit({ type: 'effect', el: vfx.element, shape: vfx.shape, x: round2(dest.x), y: round2(dest.y), r: round2(caster.radius + 0.5), fx: round2(fx), fy: round2(fy), duration: 0.5, src: caster.id, ability: ab.id });
      break;
    }
    case 'dash': {
      if (caster.dead) break;
      const dest = clampedDestination(world, caster, ctx.px, ctx.py, ab.range || 8);
      const dx = dest.x - caster.x;
      const dy = dest.y - caster.y;
      const d = hyp(dx, dy);
      const vfx = ab.vfx || { element: 'physical', shape: 'dash' };
      const width = eff.width || 1.5;
      world.emit({ type: 'effect', el: vfx.element, shape: vfx.shape, x: round2(dest.x), y: round2(dest.y), r: round2(width / 2), fx: round2(caster.x), fy: round2(caster.y), duration: round2(d / DASH_SPEED + 0.3), src: caster.id, ability: ab.id });
      if (d < 0.05) break;
      const hit = new Set();
      const amount = (eff.amount || 0) * scale;
      const owner = ctx.owner;
      const strike = (w, u) => {
        for (const e of w.queryRadius(u.x, u.y, width / 2 + u.radius, (o) => o.kind === 'unit' && !hit.has(o.id) && w.areEnemies(owner, o.owner))) {
          hit.add(e.id);
          dealDamage(w, e, amount, u, { spell: true });
        }
      };
      caster.mv = null;
      caster.facing = Math.atan2(dy, dx);
      const ticks = Math.max(1, Math.ceil((d / DASH_SPEED) * TICK_RATE));
      const sp = d / (ticks * DT);
      caster.forced = { vx: (dx / d) * sp, vy: (dy / d) * sp, rem: ticks * DT - 1e-6, onStep: strike, onEnd: strike };
      strike(world, caster);
      break;
    }
    case 'shield': {
      for (const e of collect(world, ctx, eff, c, false, false)) addStatus(e, { type: 'shield', key, amount: (eff.amount || 0) * scale, rem: eff.duration });
      break;
    }
    case 'invulnerable': {
      const targets = eff.radius > 0 || eff.affects ? collect(world, ctx, eff, c, false, false) : caster.dead ? [] : [caster];
      for (const e of targets) {
        addStatus(e, { type: 'invuln', key, rem: eff.duration });
        e.invuln = true;
      }
      break;
    }
    case 'reveal': {
      const team = world.teamOf(ctx.owner);
      world.reveals.push({ x: c.x, y: c.y, r: eff.radius || 8, team, owner: ctx.owner, rem: eff.duration || 5 });
      break;
    }
    case 'resource': {
      const p = world.players[ctx.owner];
      if (p) {
        p.gold += eff.gold || 0;
        p.wood += eff.wood || 0;
        p.faith += eff.faith || 0;
      }
      break;
    }
    default:
      break;
  }
}

function clampedDestination(world, u, px, py, range) {
  let dx = px - u.x;
  let dy = py - u.y;
  const d = hyp(dx, dy);
  if (d > range && d > 0) {
    dx *= range / d;
    dy *= range / d;
  }
  let x = Math.max(u.radius, Math.min(world.map.width - u.radius, u.x + dx));
  let y = Math.max(u.radius, Math.min(world.map.height - u.radius, u.y + dy));
  if (!u.air && !world.map.isPassable(Math.floor(x), Math.floor(y))) {
    const p = world.map.nearestPassable(x, y, 8, false);
    if (p) {
      x = Math.max(p.tx + 0.3, Math.min(p.tx + 0.7, x));
      y = Math.max(p.ty + 0.3, Math.min(p.ty + 0.7, y));
    } else {
      x = u.x;
      y = u.y;
    }
  }
  return { x, y };
}

/** Run scheduled (delayed) effects whose time has come. */
export function updateDelayed(world) {
  const list = world.delayed;
  if (list.length === 0) return;
  const due = [];
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    if (world.time + 1e-9 >= d.t) due.push(d);
    else list[w++] = d;
  }
  list.length = w;
  for (const d of due) applyEffect(world, d.ctx, d.eff, d.i);
}

/** Tick ground fields every 0.5 s and expire fields and reveals. */
export function updateFields(world) {
  const fields = world.fields;
  if (fields.length) {
    let w = 0;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      f.rem -= DT;
      if (f.rem <= 1e-9) continue;
      f.acc += DT;
      if (f.acc >= FIELD_TICK - 1e-9) {
        f.acc -= FIELD_TICK;
        const owner = f.owner;
        if (f.dps > 0 || f.slowPct > 0) {
          for (const e of world.queryRadius(f.x, f.y, f.r, (o) => o.kind !== 'mine' && world.areEnemies(owner, o.owner))) {
            if (f.dps > 0) dealDamage(world, e, f.dps * FIELD_TICK, f.src, { spell: true });
            if (f.slowPct > 0 && e.kind === 'unit' && !e.dead) addStatus(e, { type: 'slow', key: `field${f.id}`, pct: f.slowPct, rem: FIELD_TICK + 0.15 });
          }
        }
        if (f.hps > 0) {
          for (const e of world.queryRadius(f.x, f.y, f.r, (o) => o.kind === 'unit' && !world.areEnemies(owner, o.owner))) heal(e, f.hps * FIELD_TICK);
        }
      }
      fields[w++] = f;
    }
    fields.length = w;
  }
  const rv = world.reveals;
  if (rv.length) {
    let w = 0;
    for (let i = 0; i < rv.length; i++) {
      rv[i].rem -= DT;
      if (rv[i].rem > 1e-9) rv[w++] = rv[i];
    }
    rv.length = w;
  }
}

function hasEffect(ab, types) {
  return ab.effects.some((e) => types.includes(e.type));
}

function useOf(ab) {
  if (ab.ai && ab.ai.use) return ab.ai.use;
  if (hasEffect(ab, ['heal'])) return 'heal';
  if (hasEffect(ab, ['summon'])) return 'summon';
  if (hasEffect(ab, ['resource'])) return 'economy';
  if (hasEffect(ab, ['buff', 'shield'])) return 'buff';
  return 'damage';
}

function nearestEnemyUnit(world, u, range) {
  let best = null;
  let bestD = Infinity;
  for (const e of world.queryRadius(u.x, u.y, range, (o) => o.kind === 'unit' && world.areEnemies(u.owner, o.owner))) {
    const d = hyp(e.x - u.x, e.y - u.y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** Pick a target for an autocast ability, or null when casting would be wasted. */
export function pickAutocastTarget(world, u, ab) {
  const use = useOf(ab);
  const range = ab.target === 'none' ? Math.max(1.5, abilityRadius(ab)) : ab.range;
  if (use === 'heal') {
    const amt = Math.max(10, ...ab.effects.filter((e) => e.type === 'heal').map((e) => e.amount || 0));
    const hurt = world.queryRadius(u.x, u.y, range, (o) => o.kind === 'unit' && !world.areEnemies(u.owner, o.owner) && o.maxHp - o.hp >= Math.min(amt * 0.6, o.maxHp * 0.25));
    if (hurt.length === 0) return null;
    if (ab.target === 'none') return { x: u.x, y: u.y, target: null };
    if (ab.target === 'point') {
      const h = hurt.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.id - b.id)[0];
      return { x: h.x, y: h.y, target: null };
    }
    hurt.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.id - b.id);
    return { x: hurt[0].x, y: hurt[0].y, target: hurt[0] };
  }
  if (use === 'economy') return ab.target === 'none' ? { x: u.x, y: u.y, target: null } : null;
  const fightRange = Math.max(range, acquisitionRange(u));
  if (use === 'escape') {
    if (u.hp > u.maxHp * 0.35) return null;
    const e = nearestEnemyUnit(world, u, fightRange);
    if (!e) return null;
    if (ab.target === 'none') return { x: u.x, y: u.y, target: null };
    if (ab.target === 'point') {
      const dx = u.x - e.x;
      const dy = u.y - e.y;
      const d = hyp(dx, dy) || 1;
      return { x: u.x + (dx / d) * ab.range, y: u.y + (dy / d) * ab.range, target: null };
    }
    if (ab.target === 'ally' || ab.target === 'unit') return { x: u.x, y: u.y, target: u };
    return null;
  }
  if (use === 'buff' || use === 'summon') {
    const e = nearestEnemyUnit(world, u, fightRange);
    if (!e) return null;
    if (ab.target === 'none') return { x: u.x, y: u.y, target: null };
    if (ab.target === 'ally' || ab.target === 'unit') return { x: u.x, y: u.y, target: u };
    if (ab.target === 'point') return { x: u.x, y: u.y, target: null };
    if (ab.target === 'enemy') return hyp(e.x - u.x, e.y - u.y) - e.radius <= ab.range ? { x: e.x, y: e.y, target: e } : null;
    return null;
  }
  // damage / cc
  let t = u.target ? world.entities.get(u.target) : null;
  if (t && (t.dead || t.kind !== 'unit' || !world.areEnemies(u.owner, t.owner))) t = null;
  if (ab.target === 'none') {
    const e = nearestEnemyUnit(world, u, range);
    return e ? { x: u.x, y: u.y, target: null } : null;
  }
  if (!t || distToEntity(u.x, u.y, t) > ab.range) t = nearestEnemyUnit(world, u, ab.range);
  if (!t || distToEntity(u.x, u.y, t) > ab.range) return null;
  if (ab.target === 'point') return { x: t.x, y: t.y, target: null };
  if (ab.target === 'ally') return null;
  return { x: t.x, y: t.y, target: t };
}

/**
 * Try autocast abilities. Light always-on spells (data autocast: priests'
 * heals, creatures' strikes) use the quick picker above; every other ability
 * on autocast goes through the cast scoring the AI uses (cast-choice.js), so
 * big spells wait for a worthwhile target. When one fires, the current order
 * is kept and resumed after the cast. Returns true if a cast order was started.
 */
export function tryAutocast(world, u) {
  const list = u.autocast;
  let scored = null;
  for (let i = 0; i < list.length; i++) {
    const ab = list[i];
    if (cooldownLeft(u, ab) > 0 || !isUnlocked(u, ab)) continue;
    if (!ab.autocast) {
      (scored || (scored = [])).push(ab);
      continue;
    }
    const tgt = pickAutocastTarget(world, u, ab);
    if (tgt) return startAutocast(u, ab, tgt);
  }
  if (scored) {
    const best = chooseCast(world, u, { abilities: scored });
    if (best) return startAutocast(u, best.ab, best);
  }
  return false;
}

function startAutocast(u, ab, tgt) {
  if (u.order) u.orders.unshift(u.order);
  u.order = { type: 'cast', ability: ab.id, x: tgt.x, y: tgt.y, target: tgt.target ? tgt.target.id : 0, phase: 'approach', timer: 0, auto: true };
  return true;
}
