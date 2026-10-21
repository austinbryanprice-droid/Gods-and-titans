// Status effects (stun, slow, buffs, damage over time, shields, invulnerability),
// passive auras and the derived per-tick unit stats they produce.
import { DT } from '../config.js';
import { hyp } from './common.js';

const DOT_INTERVAL = 0.5;

/**
 * Add or refresh a status on a unit. Statuses with the same key refresh
 * (longest remaining time, strongest value) instead of stacking.
 * @param {object} u unit
 * @param {object} s { type, key, rem, ... }
 */
export function addStatus(u, s) {
  if (u.dead || u.kind !== 'unit') return;
  const list = u.statuses;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o.type === s.type && o.key === s.key) {
      o.rem = Math.max(o.rem, s.rem);
      if (s.type === 'slow') o.pct = Math.max(o.pct, s.pct);
      else if (s.type === 'buff') o.amount = Math.abs(s.amount) > Math.abs(o.amount) ? s.amount : o.amount;
      else if (s.type === 'shield') o.amount = Math.max(o.amount, s.amount);
      else if (s.type === 'dot') {
        o.dps = Math.max(o.dps, s.dps);
        o.src = s.src;
      }
      computeDerived(u);
      return;
    }
  }
  list.push({ acc: 0, ...s });
  computeDerived(u);
}

/** Remove all statuses of a type (used for cleanses and death). */
export function clearStatuses(u, type) {
  u.statuses = type ? u.statuses.filter((s) => s.type !== type) : [];
}

/**
 * Advance status timers and apply damage over time. dealDamage is injected
 * to avoid a module cycle with combat.js.
 */
export function tickStatuses(world, u, dealDamage) {
  const list = u.statuses;
  if (list.length === 0) return;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.type === 'dot') {
      s.acc += DT;
      if (s.acc >= DOT_INTERVAL - 1e-9) {
        s.acc -= DOT_INTERVAL;
        dealDamage(world, u, s.dps * DOT_INTERVAL, s.src, { spell: true });
        if (u.dead) return;
      }
    }
    s.rem -= DT;
    if (s.rem > 1e-9 && !(s.type === 'shield' && s.amount <= 0)) list[w++] = s;
  }
  list.length = w;
}

/** Absorb damage with shields. Returns the damage left over. */
export function absorbShield(u, amount) {
  if (u.shield <= 0) return amount;
  let left = amount;
  for (const s of u.statuses) {
    if (s.type !== 'shield' || s.amount <= 0) continue;
    const take = Math.min(s.amount, left);
    s.amount -= take;
    left -= take;
    if (left <= 0) break;
  }
  u.shield = Math.max(0, u.shield - (amount - left));
  return left;
}

/** Recompute derived stats from base stats, statuses and auras. */
export function computeDerived(u) {
  let dmg = 0;
  let armor = 0;
  let speed = 0;
  let atk = 0;
  let lifesteal = u.passiveLifesteal;
  let regen = u.baseRegen;
  let slow = 0;
  let stun = false;
  let invuln = false;
  let shield = 0;
  let buff = false;
  let debuff = false;
  let dot = false;
  const list = u.statuses;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    switch (s.type) {
      case 'stun': stun = true; break;
      case 'slow': if (s.pct > slow) slow = s.pct; break;
      case 'invuln': invuln = true; break;
      case 'shield': shield += s.amount; break;
      case 'dot': dot = true; break;
      case 'buff':
        if (s.amount >= 0) buff = true;
        else debuff = true;
        if (s.stat === 'damage') dmg += s.amount;
        else if (s.stat === 'armor') armor += s.amount;
        else if (s.stat === 'speed') speed += s.amount;
        else if (s.stat === 'attackSpeed') atk += s.amount;
        else if (s.stat === 'lifesteal') lifesteal += s.amount;
        else if (s.stat === 'regen') regen += s.amount;
        break;
      default: break;
    }
  }
  const a = u.aura;
  if (a) {
    dmg += a.damage;
    armor += a.armor;
    speed += a.speed;
    atk += a.attackSpeed;
    regen += a.regen;
    for (const k in a.pos) if (a.pos[k] > 0) buff = true;
    for (const k in a.neg) if (a.neg[k] < 0) debuff = true;
  }
  if (slow > 0.95) slow = 0.95;
  u.slowPct = slow;
  u.stunned = stun;
  u.invuln = invuln;
  u.shield = shield;
  u.dmgMult = Math.max(0.1, 1 + dmg);
  u.armorNow = u.baseArmor + armor;
  u.speedNow = stun ? 0 : u.baseSpeed * Math.max(0.1, 1 + speed) * (1 - slow);
  u.atkSpeedMult = Math.max(0.1, 1 + atk) * (1 - slow);
  u.lifesteal = lifesteal;
  u.regen = regen;
  u.fxBuff = buff;
  u.fxDebuff = debuff;
  u.fxDot = dot;
}

/** Status codes for the snapshot (DESIGN 6.3 fx). */
export function statusCodes(u) {
  const out = [];
  if (u.stunned) out.push('stun');
  if (u.slowPct > 0) out.push('slow');
  if (u.shield > 0) out.push('shield');
  if (u.invuln) out.push('invuln');
  if (u.fxBuff) out.push('buff');
  if (u.fxDebuff) out.push('debuff');
  if (u.fxDot) out.push('dot');
  return out;
}

const AURA_STATS = ['damage', 'armor', 'speed', 'attackSpeed', 'regen'];

/**
 * Recompute aura contributions for every unit. Auras of the same stat do not
 * stack: the strongest positive and the strongest negative apply.
 */
export function updateAuras(world) {
  const units = world.unitList;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.aura) u.aura = null;
  }
  const holders = world.auraHolders;
  if (holders.length === 0) return;
  const tmp = world._tmpQuery;
  for (const h of holders) {
    if (h.dead) continue;
    for (const p of h.def.passives) {
      if (p.type !== 'aura' || !AURA_STATS.includes(p.stat)) continue;
      const r = p.radius || 6;
      tmp.length = 0;
      world.hash.query(h.x, h.y, r + 1.6, tmp);
      const wantEnemies = p.affects === 'enemies';
      for (let i = 0; i < tmp.length; i++) {
        const t = tmp[i];
        if (t.dead) continue;
        const enemy = world.areEnemies(h.owner, t.owner);
        if (enemy !== wantEnemies) continue;
        if (enemy && !world.canHarm(h.owner, t.owner)) continue; // Decade of Peace: no debuff auras on other players
        if (hyp(t.x - h.x, t.y - h.y) - t.radius > r) continue;
        if (!t.aura) t.aura = { damage: 0, armor: 0, speed: 0, attackSpeed: 0, regen: 0, pos: {}, neg: {} };
        const amt = p.amount;
        const a = t.aura;
        if (amt >= 0) {
          const prev = a.pos[p.stat] || 0;
          if (amt > prev) {
            a[p.stat] += amt - prev;
            a.pos[p.stat] = amt;
          }
        } else {
          const prev = a.neg[p.stat] || 0;
          if (amt < prev) {
            a[p.stat] += amt - prev;
            a.neg[p.stat] = amt;
          }
        }
      }
    }
  }
}
