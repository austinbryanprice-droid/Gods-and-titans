// AI micro: gods and titans cast their abilities (the shared cast scoring in
// sim/cast-choice.js, with the AI profile's pickiness), wounded gods retreat
// to the temple, and ranged units focus fire.
import { chooseCast, gatherNear } from '../sim/cast-choice.js';

const FOCUS_PER_THINK = 20; // units examined for re-targeting per think at most

/** Look for the best cast of a caster this think and issue it. Returns true if one was cast. */
export function tryCast(ai, caster) {
  if (caster.stunned || caster.dead) return false;
  const o = caster.order;
  if (o && o.type === 'cast') return false;
  for (const q of caster.orders) if (q.type === 'cast') return false;
  const abilities = caster.def.abilities;
  if (!abilities || !abilities.length) return false;
  // Light always-on spells (data autocast) are left to the sim's own autocast.
  const own = abilities.filter((ab) => !ab.autocast);
  if (!own.length) return false;
  const best = chooseCast(ai.world, caster, { abilities: own, threshold: ai.prof.castThreshold, home: ai.retreatPoint() });
  if (!best) return false;
  const cmd = { type: 'cast', unit: caster.id, ability: best.ab.id };
  if (best.target) cmd.target = best.target.id;
  else if (best.ab.target !== 'none') {
    cmd.x = Math.round(best.x * 100) / 100;
    cmd.y = Math.round(best.y * 100) / 100;
  }
  ai.issue(cmd);
  ai.stats.casts++;
  return true;
}

/**
 * Pickier AIs (easy: castThreshold > 1) set their gods' and titan's abilities
 * to manual, so only their own cautious casting (tryCast) uses them; the
 * others leave autocast on and cast on top of it.
 */
function keepManual(ai, caster) {
  if (ai.prof.castThreshold <= 1) return;
  for (const ab of caster.autocast) {
    if (!ab.autocast) ai.issue({ type: 'autocast', units: [caster.id], ability: ab.id, on: false });
  }
}

/** Gods: retreat when badly hurt, rejoin when healed, cast abilities. Titans cast too. */
export function runMicro(ai, s) {
  const prof = ai.prof;
  for (const g of s.gods) keepManual(ai, g);
  if (s.titan) keepManual(ai, s.titan);
  const rp = ai.retreatPoint();
  for (const g of s.gods) {
    const frac = g.hp / g.maxHp;
    const retreating = ai.godRetreat.has(g.id);
    if (!retreating) {
      if (frac < prof.godRetreat && rp && Math.hypot(g.x - rp.x, g.y - rp.y) > 6) {
        const near = gatherNear(ai.world, g, 10);
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
