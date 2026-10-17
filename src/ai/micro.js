// AI micro: gods and titans cast their abilities (scored generically from the
// ability data: damage on the biggest clump, heals on the most wounded,
// buffs and summons in fights, crowd control on dangerous enemies, escapes
// when low), wounded gods retreat to the temple, and ranged units focus fire.
import { abilityProfile, unitInfo } from './unit-info.js';
import { getUnitType } from '../data/index.js';

const SCAN_R = 14;
const MAX_NEAR = 36;
const MAX_CAND = 10;
const FOCUS_PER_THINK = 20; // units examined for re-targeting per think at most

function weight(u) {
  const c = u.def.class;
  if (c === 'god') return 3 + (u.level || 1) * 0.3;
  if (c === 'titan') return 4;
  if (c === 'worker') return 0.45;
  return 0.6 + (u.def.pop || 1) * 0.25;
}

function inFight(u, enemies, r = 8) {
  for (const e of enemies) if (Math.hypot(e.x - u.x, e.y - u.y) < r) return true;
  return false;
}

/** Collect nearby enemies (players' and neutral) and allies of a caster. */
function gatherNear(ai, caster, r) {
  const world = ai.world;
  const tmp = ai._mtmp;
  tmp.length = 0;
  world.hash.query(caster.x, caster.y, r + 1, tmp);
  const enemies = [];
  const allies = [];
  const D = new Map(); // unit -> distance to the caster (kept off the sim's unit objects)
  for (const u of tmp) {
    if (u.dead || u.kind !== 'unit') continue;
    const d = Math.hypot(u.x - caster.x, u.y - caster.y);
    if (d > r) continue;
    if (world.areEnemies(caster.owner, u.owner)) {
      if (u.invuln) continue;
      enemies.push(u);
    } else allies.push(u);
    D.set(u, d);
  }
  const byD = (a, b) => D.get(a) - D.get(b);
  if (enemies.length > MAX_NEAR) {
    enemies.sort(byD);
    enemies.length = MAX_NEAR;
  }
  if (allies.length > MAX_NEAR) {
    allies.sort(byD);
    allies.length = MAX_NEAR;
  }
  return { enemies, allies, d: D };
}

/** Units of `list` within r of (x, y) (edge distance). */
function within(list, x, y, r, out) {
  out.length = 0;
  for (const u of list) if (Math.hypot(u.x - x, u.y - y) - u.radius <= r) out.push(u);
  return out;
}

/** Units of `list` inside a line rectangle from (ox, oy) along (dx, dy). */
function inLine(list, ox, oy, dx, dy, len, width, out) {
  out.length = 0;
  for (const u of list) {
    const rx = u.x - ox;
    const ry = u.y - oy;
    const along = rx * dx + ry * dy;
    const perp = Math.abs(-rx * dy + ry * dx);
    if (along < -u.radius || along > len + u.radius || perp > width / 2 + u.radius) continue;
    out.push(u);
  }
  return out;
}

const tmpA = [];
const tmpB = [];

/**
 * Score one effect landing at center (cx, cy). ctx: { caster, enemies, allies, scale, prof, tx, ty, target, stats }.
 */
function scoreEffect(ctx, eff, cx, cy) {
  const { caster, enemies, allies, scale } = ctx;
  const type = eff.type;
  const r = eff.radius || 0;
  const harmful = type === 'damage' || type === 'stun' || type === 'slow' || type === 'dot' || type === 'knockback' || type === 'pull'
    || (type === 'buff' && eff.amount < 0) || (type === 'field' && (eff.dps > 0 || eff.slowPct > 0));
  const affects = eff.affects || (harmful ? 'enemies' : 'allies');
  let list;
  if (affects === 'self') list = [caster];
  else {
    const pool = affects === 'enemies' ? enemies : affects === 'allies' ? allies : null;
    if (pool) {
      if (r <= 0) list = ctx.target ? (pool.includes(ctx.target) ? [ctx.target] : []) : within(pool, cx, cy, 0.6, tmpA).slice(0, 1);
      else list = within(pool, cx, cy, r, tmpA);
    } else {
      // affects 'all': allies hit count against the cast.
      const en = r <= 0 ? [] : within(enemies, cx, cy, r, tmpA).slice();
      const al = r <= 0 ? [] : within(allies, cx, cy, r, tmpB);
      let v = 0;
      for (const e of en) v += harmValue(eff, e, scale, ctx);
      for (const a of al) v -= harmValue(eff, a, scale, ctx) * 1.5;
      return v;
    }
  }
  let v = 0;
  if (harmful) {
    for (const e of list) {
      v += harmValue(eff, e, scale, ctx);
      ctx.hits++;
      if (e.def.class === 'god' || e.def.class === 'titan') ctx.heroHit = true;
      if (e.owner >= 0) ctx.playerHits++;
    }
    return v;
  }
  switch (type) {
    case 'heal': {
      for (const a of list) {
        const miss = a.maxHp - a.hp;
        v += (Math.min(eff.amount * scale, miss) / 100) * weight(a) * 1.2;
        ctx.healed += Math.min(eff.amount * scale, miss);
      }
      return v;
    }
    case 'field': {
      if (eff.hps > 0) {
        for (const a of within(allies, cx, cy, r, tmpB)) {
          const miss = a.maxHp - a.hp;
          const amt = eff.hps * scale * Math.min(eff.duration || 0, 6);
          v += (Math.min(amt, miss) / 100) * weight(a);
          ctx.healed += Math.min(amt, miss);
        }
      }
      return v;
    }
    case 'shield': {
      for (const a of list) {
        if (!inFight(a, enemies, 9)) continue;
        v += (Math.min(eff.amount * scale, a.maxHp * 0.6) / 100) * weight(a) * 0.8;
        ctx.buffed++;
      }
      return v;
    }
    case 'buff': {
      const amt = eff.stat === 'armor' ? eff.amount / 16 : eff.stat === 'regen' ? eff.amount / 40 : eff.stat === 'speed' ? eff.amount * 0.4 : eff.amount;
      for (const a of list) {
        if (!inFight(a, enemies, a === caster ? 7 : 9)) continue;
        v += amt * Math.min(eff.duration || 0, 12) * weight(a) * 0.3;
        ctx.buffed++;
      }
      return v;
    }
    case 'invulnerable': {
      const targets = r > 0 || eff.affects ? list : [caster];
      for (const a of targets) {
        if (!inFight(a, enemies, 9)) continue;
        if (a.hp < a.maxHp * 0.55) v += weight(a) * 1.6;
        ctx.buffed++;
      }
      return v;
    }
    case 'summon': {
      if (!enemies.length) return 0;
      const def = getUnitType(eff.unit);
      const inf = def ? unitInfo(def.id) : null;
      const n = Math.max(1, eff.count || 1);
      ctx.summons += n;
      return inf ? (n * inf.str) / 35 : n;
    }
    case 'resource':
      return ((eff.gold || 0) + (eff.wood || 0) + (eff.faith || 0) * 1.3) / 60;
    default:
      return 0;
  }
}

function harmValue(eff, e, scale, ctx) {
  const w = weight(e);
  const hp = e.hp + (e.shield || 0);
  switch (eff.type) {
    case 'damage':
    case 'line':
    case 'dash': {
      const amt = (eff.amount || 0) * scale;
      return (Math.min(amt, hp) / 100) * w + (amt >= hp ? 0.6 * w : 0);
    }
    case 'dot': {
      const amt = (eff.dps || 0) * (eff.duration || 0) * scale;
      return (Math.min(amt, hp) / 100) * w * 0.85;
    }
    case 'field': {
      const amt = (eff.dps || 0) * Math.min(eff.duration || 0, 4) * scale * 0.7;
      return (Math.min(amt, hp) / 100) * w + (eff.slowPct || 0) * 0.5 * w;
    }
    case 'stun':
      return (eff.duration || 0) * 0.7 * w * (e.def.attack ? 1 : 0.3);
    case 'slow':
      return (eff.pct || 0.3) * Math.min(eff.duration || 0, 6) * 0.18 * w;
    case 'knockback':
    case 'pull':
      return 0.2 * w;
    case 'buff':
      return Math.abs(eff.amount) * (eff.stat === 'armor' ? 1 / 16 : 1) * Math.min(eff.duration || 0, 10) * 0.3 * w;
    default:
      return 0;
  }
}

/** Score an ability cast on a candidate target. Returns ctx with .score and validity counters. */
function scoreCast(ctx, prof, cand) {
  ctx.hits = 0;
  ctx.playerHits = 0;
  ctx.heroHit = false;
  ctx.healed = 0;
  ctx.buffed = 0;
  ctx.summons = 0;
  ctx.target = cand.unit || null;
  const caster = ctx.caster;
  let score = 0;
  const px = cand.x;
  const py = cand.y;
  // Direction / clamped destination for lines, dashes and blinks.
  let dx = px - caster.x;
  let dy = py - caster.y;
  let d = Math.hypot(dx, dy);
  if (d < 1e-3) {
    dx = Math.cos(caster.facing);
    dy = Math.sin(caster.facing);
    d = 0;
  } else {
    dx /= d;
    dy /= d;
  }
  const dest = prof.moves ? { x: caster.x + dx * Math.min(d, prof.range), y: caster.y + dy * Math.min(d, prof.range) } : null;
  for (const eff of prof.effects) {
    if (eff.type === 'blink' || eff.type === 'reveal') continue;
    if (eff.type === 'chain') {
      score += scoreChain(ctx, eff, cand);
      continue;
    }
    if (eff.type === 'line') {
      const len = eff.length || prof.range || 6;
      for (const e of inLine(ctx.enemies, caster.x, caster.y, dx, dy, len, eff.width || 1.5, tmpA)) {
        score += harmValue(eff, e, ctx.scale, ctx);
        ctx.hits++;
        if (e.owner >= 0) ctx.playerHits++;
        if (e.def.class === 'god' || e.def.class === 'titan') ctx.heroHit = true;
      }
      continue;
    }
    if (eff.type === 'dash') {
      const len = Math.min(d, prof.range);
      for (const e of inLine(ctx.enemies, caster.x, caster.y, dx, dy, len, eff.width || 1.5, tmpA)) {
        score += harmValue(eff, e, ctx.scale, ctx);
        ctx.hits++;
        if (e.owner >= 0) ctx.playerHits++;
        if (e.def.class === 'god' || e.def.class === 'titan') ctx.heroHit = true;
      }
      continue;
    }
    let at = eff.at || (prof.target === 'none' ? 'self' : 'target');
    let cx;
    let cy;
    if (at === 'self') {
      if (prof.moves === 'blink' || (prof.moves === 'dash' && eff.delay > 0)) {
        cx = dest.x;
        cy = dest.y;
      } else {
        cx = caster.x;
        cy = caster.y;
      }
      // A self-centred effect with no radius affects the caster.
      if (!(eff.radius > 0) && !eff.affects) {
        const v = scoreEffect({ ...ctx, target: caster }, { ...eff, affects: 'self' }, cx, cy);
        score += v;
        continue;
      }
    } else {
      cx = px;
      cy = py;
    }
    score += scoreEffect(ctx, eff, cx, cy);
  }
  ctx.score = score;
  return ctx;
}

function scoreChain(ctx, eff, cand) {
  let cur = cand.unit && ctx.enemies.includes(cand.unit) ? cand.unit : null;
  if (!cur) return 0;
  const hit = new Set();
  let amount = (eff.amount || 0) * ctx.scale;
  const bounces = eff.bounces ?? 3;
  const range = eff.bounceRange || 4;
  const falloff = eff.falloff ?? 0.8;
  let v = 0;
  for (let k = 0; k <= bounces && cur; k++) {
    hit.add(cur);
    v += harmValue({ type: 'damage', amount }, cur, 1, ctx);
    ctx.hits++;
    if (cur.owner >= 0) ctx.playerHits++;
    if (cur.def.class === 'god' || cur.def.class === 'titan') ctx.heroHit = true;
    amount *= falloff;
    let best = null;
    let bestD = range;
    for (const e of ctx.enemies) {
      if (hit.has(e)) continue;
      const dd = Math.hypot(e.x - cur.x, e.y - cur.y);
      if (dd <= bestD) {
        bestD = dd;
        best = e;
      }
    }
    cur = best;
  }
  return v;
}

/** Candidate targets for an ability. */
function candidates(ai, caster, prof, near, home) {
  const D = near.d;
  const out = [];
  const range = prof.range;
  const { enemies, allies } = near;
  const push = (x, y, unit) => {
    if (out.length < MAX_CAND * 2) out.push({ x, y, unit });
  };
  switch (prof.target) {
    case 'none':
      push(caster.x, caster.y, null);
      break;
    case 'enemy':
      for (const e of enemies) {
        if (D.get(e) - e.radius > range) continue;
        push(e.x, e.y, e);
      }
      break;
    case 'ally':
      for (const a of allies) {
        if (D.get(a) - a.radius > range) continue;
        push(a.x, a.y, a);
      }
      break;
    case 'unit':
      for (const e of enemies) if (D.get(e) - e.radius <= range) push(e.x, e.y, e);
      for (const a of allies) if (D.get(a) - a.radius <= range) push(a.x, a.y, a);
      break;
    default: {
      // point
      if (prof.use === 'escape') {
        if (home) {
          const dx = home.x - caster.x;
          const dy = home.y - caster.y;
          const l = Math.hypot(dx, dy) || 1;
          push(caster.x + (dx / l) * range, caster.y + (dy / l) * range, null);
        }
        break;
      }
      const reach = range + (prof.moves ? 0 : prof.radius * 0.6);
      if (prof.harmful || prof.use === 'summon' || prof.use === 'damage' || prof.use === 'cc') {
        for (const e of enemies) {
          if (D.get(e) > reach) continue;
          if (D.get(e) <= range) push(e.x, e.y, null);
          else {
            const k = range / D.get(e);
            push(caster.x + (e.x - caster.x) * k, caster.y + (e.y - caster.y) * k, null);
          }
        }
      }
      if (prof.helpful && !prof.harmful) {
        for (const a of allies) {
          if (D.get(a) > range) continue;
          if (a.hp < a.maxHp * 0.9 || prof.use !== 'heal') push(a.x, a.y, null);
        }
        if (prof.use === 'summon' && enemies.length) {
          const e = enemies.reduce((m, u) => (D.get(u) < D.get(m) ? u : m), enemies[0]);
          const k = Math.min(1, range / Math.max(0.1, D.get(e))) * 0.7;
          push(caster.x + (e.x - caster.x) * k, caster.y + (e.y - caster.y) * k, null);
        }
      }
      break;
    }
  }
  if (out.length > MAX_CAND) {
    out.sort((a, b) => Math.hypot(a.x - caster.x, a.y - caster.y) - Math.hypot(b.x - caster.x, b.y - caster.y));
    out.length = MAX_CAND;
  }
  return out;
}

/** Is a scored cast worth it? */
function worthIt(ai, prof, ctx, caster, near) {
  const D = near.d;
  const k = ai.prof.castThreshold;
  const ult = prof.ultimate;
  const low = caster.hp < caster.maxHp * 0.45;
  switch (prof.use) {
    case 'escape':
      return caster.hp < caster.maxHp * 0.32 && near.enemies.some((e) => D.get(e) < 8 && e.owner >= 0 || D.get(e) < 5);
    case 'economy':
      return ctx.score > 0.3;
    case 'heal': {
      if (ctx.hits > 0 && ctx.score >= 1.2 * k) return true; // heal-and-hurt spells
      const need = ult ? 380 : 90;
      return ctx.healed >= need * k && ctx.score >= (ult ? 3.5 : 0.8) * k;
    }
    case 'buff':
      if (ctx.hits > 0 && ctx.score >= 1.5 * k) return true;
      return ctx.buffed >= (ult ? 4 : 1) && ctx.score >= (ult ? 3 : 0.9) * k;
    case 'summon':
      if (!near.enemies.some((e) => D.get(e) < 10)) return false;
      if (ult && near.enemies.length < 3 && !near.enemies.some((e) => e.def.class === 'god' || e.def.class === 'titan')) return low;
      return ctx.score >= (ult ? 2.5 : 1) * k;
    default: {
      // damage / cc
      if (ctx.hits === 0) return false;
      const creepsOnly = ctx.playerHits === 0;
      if (ult) {
        if (creepsOnly && !low) return false;
        return (ctx.hits >= 3 || ctx.heroHit || low) && ctx.score >= 3.2 * k;
      }
      return ctx.score >= (ctx.heroHit ? 0.9 : 1.3) * k;
    }
  }
}

/** Look for the best cast of a caster this think and issue it. Returns true if one was cast. */
export function tryCast(ai, caster) {
  if (caster.stunned || caster.dead) return false;
  const o = caster.order;
  if (o && o.type === 'cast') return false;
  for (const q of caster.orders) if (q.type === 'cast') return false;
  const abilities = caster.def.abilities;
  if (!abilities || !abilities.length) return false;
  let ready = 0;
  for (const ab of abilities) {
    if (ab.autocast) continue;
    if ((caster.cooldowns[ab.id] || 0) > 0) continue;
    if (caster.def.class === 'god' && (caster.level || 1) < (ab.unlockLevel || 1)) continue;
    ready++;
  }
  if (!ready) return false;
  let maxR = 0;
  for (const ab of abilities) {
    const p = abilityProfile(ab);
    maxR = Math.max(maxR, p.range + p.radius + 1, p.lineLen);
  }
  const near = gatherNear(ai, caster, Math.min(SCAN_R, Math.max(8, maxR)));
  if (!near.enemies.length) {
    // Out of combat only economy abilities are worth it.
    if (!abilities.some((ab) => abilityProfile(ab).use === 'economy')) return false;
  }
  const scale = caster.def.class === 'god' ? 1 + 0.1 * ((caster.level || 1) - 1) : 1;
  const home = ai.retreatPoint();
  let best = null;
  let bestScore = 0;
  for (const ab of abilities) {
    if (ab.autocast) continue;
    if ((caster.cooldowns[ab.id] || 0) > 0) continue;
    if (caster.def.class === 'god' && (caster.level || 1) < (ab.unlockLevel || 1)) continue;
    const prof = abilityProfile(ab);
    const cands = candidates(ai, caster, prof, near, home);
    const ctx = { caster, enemies: near.enemies, allies: near.allies, scale, hits: 0 };
    for (const cand of cands) {
      scoreCast(ctx, prof, cand);
      if (!worthIt(ai, prof, ctx, caster, near)) continue;
      // Ultimates get a bonus so they are not starved by cheap spells in big fights.
      const s = ctx.score * (prof.ultimate ? 1.25 : 1) + (prof.use === 'escape' ? 50 : 0);
      if (s > bestScore) {
        bestScore = s;
        best = { ab, cand };
      }
    }
  }
  if (!best) return false;
  const cmd = { type: 'cast', unit: caster.id, ability: best.ab.id };
  if (best.cand.unit) cmd.target = best.cand.unit.id;
  else if (best.ab.target !== 'none') {
    cmd.x = Math.round(best.cand.x * 100) / 100;
    cmd.y = Math.round(best.cand.y * 100) / 100;
  }
  ai.issue(cmd);
  ai.stats.casts++;
  return true;
}

/** Gods: retreat when badly hurt, rejoin when healed, cast abilities. Titans cast too. */
export function runMicro(ai, s) {
  const prof = ai.prof;
  const rp = ai.retreatPoint();
  for (const g of s.gods) {
    const frac = g.hp / g.maxHp;
    const retreating = ai.godRetreat.has(g.id);
    if (!retreating) {
      if (frac < prof.godRetreat && rp && Math.hypot(g.x - rp.x, g.y - rp.y) > 6) {
        const near = gatherNear(ai, g, 10);
        if (near.enemies.some((e) => e.def.attack && e.owner !== -2)) {
          ai.godRetreat.add(g.id);
          tryCast(ai, g); // escape / self-heal if ready
          ai.issue({ type: 'move', units: [g.id], x: rp.x, y: rp.y });
          ai.cmdMemo.set(g.id, { type: 'move', x: rp.x, y: rp.y, tick: ai.world.tickCount });
          continue;
        }
      }
    } else {
      const homeFight = ai.mil.mode === 'defend' && !ai.mil.ally;
      if (frac >= prof.godRejoin || (homeFight && frac > 0.4) || (rp && Math.hypot(g.x - rp.x, g.y - rp.y) < 5 && frac > prof.godRejoin - 0.2 && !ai.threat)) {
        ai.godRetreat.delete(g.id);
        ai.cmdMemo.delete(g.id);
      } else {
        if (rp && (!g.order || g.order.type !== 'move') && Math.hypot(g.x - rp.x, g.y - rp.y) > 4) {
          ai.issue({ type: 'move', units: [g.id], x: rp.x, y: rp.y });
        }
        tryCast(ai, g);
        continue;
      }
    }
    if (prof.castChance >= 1 || ai.rng.next() < prof.castChance) tryCast(ai, g);
  }
  if (s.titan && (prof.castChance >= 1 || ai.rng.next() < prof.castChance)) tryCast(ai, s.titan);
  for (const id of ai.godRetreat) {
    const u = ai.world.entities.get(id);
    if (!u || u.dead) ai.godRetreat.delete(id);
  }
  if (prof.micro) focusFire(ai, s);
}

/** Switch a unit to another target, then let it resume its attack-move. */
function retarget(ai, u, target) {
  ai.issue({ type: 'attack', units: [u.id], target: target.id });
  const m = ai.cmdMemo.get(u.id);
  if (m && m.type === 'attackMove') ai.issue({ type: 'attackMove', units: [u.id], x: m.x, y: m.y, queue: true });
  else ai.cmdMemo.delete(u.id);
}

/**
 * Army micro: ranged units in combat switch to an enemy they can finish or a
 * wounded enemy god; melee units stuck chasing a target they cannot reach
 * (crowded fights around buildings) hit an enemy already in reach instead.
 */
function focusFire(ai, s) {
  const world = ai.world;
  if ((world.tickCount / ai.prof.think) % 2 >= 1) return; // every other think
  const tmp = ai._ftmp;
  const army = s.army;
  const n = army.length;
  if (!n) return;
  // Rotate through the army so big fights spread the work over several thinks.
  const start = ai._focusAt % n;
  let looked = 0;
  let i = 0;
  for (; i < n && looked < FOCUS_PER_THINK; i++) {
    const u = army[(start + i) % n];
    const atk = u.def.attack;
    if (!atk || atk.buildingsOnly || !u.target) continue;
    const melee = atk.range < 2;
    if (melee ? u.state !== 'move' : u.state !== 'attack') continue;
    if (ai.godRetreat.has(u.id)) continue;
    const cur = world.entities.get(u.target);
    if (!cur || cur.kind !== 'unit') continue;
    looked++;
    const reach = (e) => Math.hypot(e.x - u.x, e.y - u.y) - e.radius - u.radius <= atk.range + (melee ? 0.25 : 0);
    if (melee && reach(cur)) continue;
    tmp.length = 0;
    world.hash.query(u.x, u.y, atk.range + u.radius + 2, tmp);
    const dmg = u.baseDamage * (u.dmgMult || 1);
    let best = null;
    let bestV = 0;
    for (const e of tmp) {
      if (e.dead || e === cur || e.kind !== 'unit' || e.invuln || !world.areEnemies(u.owner, e.owner)) continue;
      if (e.air && !atk.canHitAir) continue;
      if (!reach(e)) continue;
      let v = 0;
      const hero = e.def.class === 'god' || e.def.class === 'titan';
      if (melee) v = 1 + (1 - e.hp / e.maxHp) + (hero ? 1 : 0);
      else if (hero && e.hp < e.maxHp * 0.45) v = 3;
      else if (e.hp <= dmg * 1.5 && cur.hp > dmg * 2) v = 1 + (e.def.pop || 1) * 0.2;
      if (v > bestV) {
        bestV = v;
        best = e;
      }
    }
    if (best) retarget(ai, u, best);
  }
  ai._focusAt = start + i;
}
