// Combat: WC3 armor formula, attacks (melee swings and homing projectiles),
// splash/cleave/thorns/lifesteal/critical/evasion passives, target
// acquisition priorities, chasing, and tower fire.
import { ARMOR_FACTOR, PROJECTILE_SPEED, SPELL_VS_BUILDING, DT } from '../config.js';
import { hyp, edgeDist, distToEntity } from './common.js';
import { absorbShield, addStatus } from './status.js';
import { moveToEntity, stopMove } from './movement.js';

/** Damage multiplier for an armor value (WC3). */
export function armorMultiplier(armor) {
  if (armor >= 0) return 1 - (ARMOR_FACTOR * armor) / (1 + ARMOR_FACTOR * armor);
  return 2 - Math.pow(0.94, -armor);
}

/** Damage left after armor. */
export function damageAfterArmor(amount, armor) {
  return amount * armorMultiplier(armor);
}

/** Can u's attack physically hit t (ignores ownership)? */
export function canAttackTarget(u, t) {
  const atk = u.def.attack;
  if (!atk || !t || t.dead || t.kind === 'mine') return false;
  if (t.kind === 'unit') {
    if (atk.buildingsOnly) return false;
    if (t.air && !atk.canHitAir) return false;
  }
  return true;
}

/** Valid hostile target for u. */
export function canTarget(world, u, t) {
  return canAttackTarget(u, t) && world.areEnemies(u.owner, t.owner);
}

/** Auto-acquisition range: max(sight × 0.75, range + 1). */
export function acquisitionRange(u) {
  const atk = u.def.attack;
  return Math.max(u.def.sight * 0.75, (atk ? atk.range : 0) + 1);
}

/**
 * Best target for u within range (edge distance). Priority: closest enemy unit
 * that can attack, then other units, then buildings.
 * @param {object} [opts] { unitsOnly, fromX, fromY } measure from another point
 */
export function findTarget(world, u, range, opts = {}) {
  const tmp = world._tmpTarget;
  tmp.length = 0;
  const px = opts.fromX ?? u.x;
  const py = opts.fromY ?? u.y;
  const self = u.kind === 'unit' ? u.radius : 0;
  world.hash.query(px, py, range + self + world.maxRadius, tmp);
  let best = null;
  let bestCat = 9;
  let bestD = Infinity;
  for (let i = 0; i < tmp.length; i++) {
    const t = tmp[i];
    if (t.dead || t === u || !canTarget(world, u, t)) continue;
    const d = hyp(t.x - px, t.y - py) - t.radius - self;
    if (d > range) continue;
    const cat = t.def.attack && !t.ghost ? 0 : 1;
    if (cat < bestCat || (cat === bestCat && d < bestD)) {
      best = t;
      bestCat = cat;
      bestD = d;
    }
  }
  if (bestCat <= 1 || opts.unitsOnly) return best;
  const bl = world.buildingList;
  for (let i = 0; i < bl.length; i++) {
    const b = bl[i];
    if (b.dead || !canTarget(world, u, b)) continue;
    const d = distToEntity(px, py, b) - self;
    if (d > range) continue;
    if (d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

export function heal(u, amount) {
  if (u.dead || amount <= 0) return 0;
  const before = u.hp;
  u.hp = Math.min(u.maxHp, u.hp + amount);
  return u.hp - before;
}

/**
 * Central damage function. opts: { attack (armor applies), melee, spell (× SPELL_VS_BUILDING vs buildings), reflect }.
 * Returns the damage dealt after armor (including what shields absorbed).
 */
export function dealDamage(world, t, amount, src, opts = {}) {
  if (!t || t.dead || !(amount > 0) || t.kind === 'mine') return 0;
  if (t.kind === 'unit' && t.invuln) return 0;
  let a = amount;
  if (opts.attack) a *= armorMultiplier(t.kind === 'unit' ? t.armorNow : t.armor);
  if (opts.spell && t.kind === 'building') a *= SPELL_VS_BUILDING;
  const total = a;
  if (t.kind === 'unit' && t.shield > 0) a = absorbShield(t, a);
  t.hp -= a;
  world.emit({ type: 'hit', dst: t.id, amount: Math.max(1, Math.round(total)), src: src ? src.id : 0 });
  world.onDamaged(t, src, total);
  if (t.hp <= 0.0001) {
    t.hp = 0;
    world.killEntity(t, src);
  }
  return total;
}

function hostileTo(world, owner, e) {
  return world.areEnemies(owner, e.owner);
}

/** Resolve an attack landing on t (melee at the swing, ranged on arrival). */
export function landAttack(world, src, t, dmg, atk, melee) {
  if (!t || t.dead) return;
  if (t.kind === 'unit' && t.evasion > 0 && world.rng.chance(t.evasion)) return;
  const owner = src.owner;
  const amount = t.kind === 'building' ? dmg * (atk.buildingMult ?? 1) : dmg;
  const dealt = dealDamage(world, t, amount, src, { attack: true, melee });
  const srcUnit = src.kind === 'unit' ? src : null;
  if (srcUnit && !srcUnit.dead && dealt > 0 && srcUnit.lifesteal > 0) heal(srcUnit, dealt * srcUnit.lifesteal);
  const passives = srcUnit ? srcUnit.def.passives : null;
  if (passives && passives.length) {
    for (const p of passives) {
      if (p.type === 'onHitSlow' && t.kind === 'unit' && !t.dead) {
        addStatus(t, { type: 'slow', key: `hit:${src.type}`, pct: p.pct, rem: p.duration });
      } else if (p.type === 'onHitDot' && t.kind === 'unit' && !t.dead) {
        addStatus(t, { type: 'dot', key: `hit:${src.type}`, dps: p.dps, rem: p.duration, src });
      } else if (p.type === 'cleave' && melee) {
        const r = p.radius || 1.5;
        for (const o of world.queryRadius(t.x, t.y, r, (e) => e !== t && e.kind === 'unit' && hostileTo(world, owner, e) && (!e.air || atk.canHitAir))) {
          dealDamage(world, o, dmg * p.pct, src, { attack: true, melee: false });
        }
      }
    }
  }
  if (atk.splash > 0) {
    const sx = t.x;
    const sy = t.y;
    for (const o of world.queryRadius(sx, sy, atk.splash, (e) => e !== t && e.kind !== 'mine' && hostileTo(world, owner, e))) {
      if (o.kind === 'unit' && ((o.air && !atk.canHitAir) || atk.buildingsOnly)) continue;
      const m = o.kind === 'building' ? atk.buildingMult ?? 1 : 1;
      dealDamage(world, o, dmg * 0.5 * m, src, { attack: true });
    }
  }
  if (melee && t.kind === 'unit' && t.thorns > 0 && srcUnit && !srcUnit.dead && dealt > 0) {
    dealDamage(world, srcUnit, dealt * t.thorns, t, { reflect: true });
  }
}

/** Start an attack: melee lands now, ranged launches a homing projectile. */
export function performAttack(world, u, t) {
  const atk = u.def.attack;
  u.attackCd = atk.cooldown / Math.max(0.05, u.atkSpeedMult);
  u.facing = Math.atan2(t.y - u.y, t.x - u.x);
  let dmg = u.baseDamage * u.dmgMult;
  const passives = u.def.passives;
  if (passives && passives.length) {
    for (const p of passives) {
      if (p.type === 'critical' && world.rng.chance(p.chance)) {
        dmg *= p.mult;
        break;
      }
    }
  }
  const ranged = !!atk.projectile;
  world.emit({ type: 'attack', src: u.id, dst: t.id, ranged });
  if (ranged) {
    const flight = Math.max(0.05, hyp(t.x - u.x, t.y - u.y) / PROJECTILE_SPEED);
    // +DT: the launch tick already counts down once, so damage lands on the first tick at/after `flight`.
    world.projectiles.push({ src: u, dst: t, dmg, rem: flight + DT, atk });
    world.emit({
      type: 'projectile', src: u.id, dst: t.id, kind: atk.projectile, el: atk.element || 'physical',
      fx: Math.round(u.x * 100) / 100, fy: Math.round(u.y * 100) / 100,
      tx: Math.round(t.x * 100) / 100, ty: Math.round(t.y * 100) / 100,
      flight: Math.round(flight * 1000) / 1000,
    });
  } else {
    landAttack(world, u, t, dmg, atk, true);
  }
}

/** Move homing projectiles; damage lands when their flight time is over. */
export function updateProjectiles(world) {
  const list = world.projectiles;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    p.rem -= DT;
    if (p.rem <= 1e-9) landAttack(world, p.src, p.dst, p.dmg, p.atk, false);
    else list[w++] = p;
  }
  // landAttack never adds projectiles, so the tail is safe to cut.
  list.length = w;
}

/**
 * Fight a target: attack when in range, otherwise chase (if allowed).
 * @returns {'hit'|'approach'|'lost'|'unreachable'}
 */
export function engage(world, u, t, chase = true) {
  if (!canTarget(world, u, t)) return 'lost';
  const atk = u.def.attack;
  const d = edgeDist(u, t);
  const tol = u.state === 'attack' && u.target === t.id ? 0.35 : 0.02;
  if (d <= atk.range + tol) {
    if (u.mv) stopMove(u);
    u.state = 'attack';
    u.target = t.id;
    if (u.attackCd <= 0) performAttack(world, u, t);
    else u.facing = Math.atan2(t.y - u.y, t.x - u.x);
    return 'hit';
  }
  if (!chase) return 'lost';
  u.state = 'move';
  u.target = t.id;
  const mv = moveToEntity(world, u, t);
  if (mv.failed) {
    stopMove(u);
    return 'unreachable';
  }
  return 'approach';
}

/** Towers shoot the closest enemy unit in range. */
export function updateTower(world, b) {
  if (!b.constructed || !b.def.attack) return;
  if (b.attackCd > 0) b.attackCd -= DT;
  const range = b.def.attack.range;
  let t = b.target ? world.entities.get(b.target) : null;
  if (t && (t.dead || !canTarget(world, b, t) || edgeDist(b, t) > range)) t = null;
  if (!t && (world.tickCount + b.id) % 3 === 0) {
    const tmp = world._tmpTarget;
    tmp.length = 0;
    const half = b.size / 2;
    world.hash.query(b.x, b.y, range + half + world.maxRadius, tmp);
    let bestD = Infinity;
    for (const o of tmp) {
      if (o.dead || !canTarget(world, b, o)) continue;
      const d = edgeDist(b, o);
      if (d <= range && d < bestD) {
        bestD = d;
        t = o;
      }
    }
  }
  b.target = t ? t.id : 0;
  b.state = t ? 'attack' : 'idle';
  if (t && b.attackCd <= 0) performAttack(world, b, t);
}
