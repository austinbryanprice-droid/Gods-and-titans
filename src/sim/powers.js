// God powers (DESIGN 4.11): one-use divine powers a player casts from the power bar, one
// unlocked per settlement tier. The effects are the ability effects of sim/abilities.js, applied
// with the player standing in for a caster (kills, plunder and alerts are theirs), plus the
// powers' own boon (a timed bonus for the whole player) and barrage (bolts falling one by one).
import { DT } from '../config.js';
import { powersFor, POWERS, isHarmfulPower, powerRadius } from '../data/powers.js';
import { applyEffect } from './abilities.js';
import { hyp, round2 } from './common.js';
import { peaceClock } from './peace.js';

const DEFAULT_SIGHT = 6;

/** A player's god power state at the start of a game. */
export function newPowerState() {
  return { used: 0, boons: [] }; // used: bit i = the tier i+1 power is spent
}

/** Index (0..2) of a power among its pantheon's, or -1. */
function slotOf(pantheon, powerId) {
  return powersFor(pantheon).findIndex((pw) => pw.id === powerId);
}

/** How much a player's boons raise one stat right now (0.5 = +50%). */
export function boonPct(p, stat) {
  if (!p || !p.powers) return 0;
  let s = 0;
  for (const b of p.powers.boons) if (b.stat === stat) s += b.pct;
  return s;
}

/** Can this player's team see the spot (a unit's or building's sight, or a reveal)? */
export function teamSees(world, owner, x, y) {
  const team = world.teamOf(owner);
  for (const v of world.reveals) if (v.team === team && hyp(v.x - x, v.y - y) <= v.r) return true;
  const near = world.queryRadius(x, y, 16, (e) => e.kind !== 'mine' && e.owner >= 0 && !world.areEnemies(owner, e.owner));
  for (const e of near) {
    if (e.kind === 'building' && !e.constructed) continue;
    const sight = (e.def && typeof e.def.sight === 'number' ? e.def.sight : DEFAULT_SIGHT);
    if (hyp(e.x - x, e.y - y) <= sight) return true;
  }
  return false;
}

/**
 * Why this player cannot cast this power at (x, y) now, or null when they can. The HUD asks the
 * same questions of the snapshot; these are the words both show.
 */
export function powerRefusal(world, player, powerId, x, y) {
  const p = world.players[player];
  const pw = POWERS[powerId];
  if (!p || !pw) return 'Unknown god power.';
  const slot = slotOf(p.pantheon, powerId);
  if (slot < 0) return 'That power belongs to another pantheon.';
  if (p.powers.used & (1 << slot)) return `${pw.name} has already been used.`;
  if (p.tier < pw.tier) return pw.tier === 2 ? 'Requires Town.' : 'Requires City.';
  if (isHarmfulPower(pw)) {
    if (world.peace) return `The Decade of Peace holds for another ${peaceClock(world.peaceEnd - world.time)}: no god powers against other players yet.`;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 'Choose a spot to strike.';
    if (!teamSees(world, player, x, y)) return 'You must be able to see the target.';
  } else if (pw.target === 'point' && (!Number.isFinite(x) || !Number.isFinite(y))) return 'Choose a spot.';
  return null;
}

/** The stand-in caster of a power: the player, with no body to hurt, move or rank up. */
function playerCaster(player, x, y) {
  return { id: 0, kind: 'power', owner: player, dead: true, x, y, facing: 0, radius: 0, def: { class: 'power' } };
}

/** Cast a god power (the `godPower` command). Returns true when it was cast. */
export function castPower(world, player, powerId, x, y) {
  const why = powerRefusal(world, player, powerId, x, y);
  if (why) {
    world.error(player, why);
    return false;
  }
  const p = world.players[player];
  const pw = POWERS[powerId];
  p.powers.used |= 1 << slotOf(p.pantheon, powerId);
  let cx = x;
  let cy = y;
  if (pw.target === 'none' || !Number.isFinite(cx) || !Number.isFinite(cy)) {
    // A blessing on the whole people shines over their first Town Center.
    const tc = world.buildingList.find((b) => !b.dead && b.owner === player && b.type === 'town_center') || world.buildingList.find((b) => !b.dead && b.owner === player);
    cx = tc ? tc.x : world.map.width / 2;
    cy = tc ? tc.y : world.map.height / 2;
  }
  cx = Math.max(0, Math.min(world.map.width, cx));
  cy = Math.max(0, Math.min(world.map.height, cy));
  world.emit({ type: 'godPower', player, power: pw.id, x: round2(cx), y: round2(cy) });
  const r = powerRadius(pw);
  world.emit({ type: 'effect', el: pw.vfx.element, shape: pw.vfx.shape, x: round2(cx), y: round2(cy), r: round2(Math.max(r, 3)), duration: round2(effectSpan(pw)), src: 0, ability: pw.id });
  const ctx = { caster: playerCaster(player, cx, cy), owner: player, ab: pw, scale: 1, px: cx, py: cy, targetId: 0, ox: cx, oy: cy };
  pw.effects.forEach((eff, i) => {
    if (eff.type === 'boon') p.powers.boons.push({ stat: eff.stat, pct: eff.pct, rem: eff.duration, power: pw.id });
    else if (eff.type === 'barrage') barrage(world, ctx, eff, i);
    else if (eff.delay > 0) world.delayed.push({ t: world.time + eff.delay, ctx, eff, i });
    else applyEffect(world, ctx, eff, i);
  });
  return true;
}

/** Seconds the cast's main visual lasts. */
function effectSpan(pw) {
  let d = 0.8;
  for (const e of pw.effects) {
    if (e.type === 'boon') continue;
    d = Math.max(d, e.duration || 0, (e.delay || 0) + 0.6, e.type === 'barrage' ? 0.5 + e.count * e.every : 0);
  }
  return Math.min(d, 20);
}

/** Schedule a barrage's bolts: each a damage (and stun) on a random spot within the spread, shown as it is scheduled. */
function barrage(world, ctx, eff, i) {
  const rng = world.rng;
  const pw = ctx.ab;
  for (let k = 0; k < eff.count; k++) {
    // The first bolt lands on the spot itself; the rest anywhere within the spread (uniform over the disc).
    const a = rng.next() * Math.PI * 2;
    const d = k === 0 ? 0 : Math.sqrt(rng.next()) * eff.spread;
    const bx = Math.max(0, Math.min(world.map.width, ctx.px + Math.cos(a) * d));
    const by = Math.max(0, Math.min(world.map.height, ctx.py + Math.sin(a) * d));
    const delay = 0.5 + k * eff.every;
    const bolt = { ...ctx, px: bx, py: by };
    world.delayed.push({ t: world.time + delay, ctx: bolt, eff: { type: 'damage', amount: eff.amount, radius: eff.radius }, i });
    if (eff.stun > 0) world.delayed.push({ t: world.time + delay, ctx: bolt, eff: { type: 'stun', duration: eff.stun, radius: eff.radius }, i });
    world.emit({ type: 'effect', el: pw.vfx.element, shape: eff.shape || (pw.vfx.shape === 'meteor' ? 'meteor' : 'strike'), x: round2(bx), y: round2(by), r: round2(eff.radius), duration: 0.6, src: 0, ability: pw.id, delay: round2(delay) });
  }
}

/** Count boons down every tick. */
export function updatePowers(world) {
  for (const p of world.players) {
    const list = p.powers.boons;
    if (!list.length) continue;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      list[i].rem -= DT;
      if (list[i].rem > 1e-9) list[w++] = list[i];
    }
    list.length = w;
  }
}

/** The snapshot's view of a player's powers: gp (bit i = the tier i+1 power spent) and gb (boons running: [stat, pct, seconds left]). */
export function powerView(p) {
  const out = { gp: p.powers.used };
  if (p.powers.boons.length) out.gb = p.powers.boons.map((b) => [b.stat, b.pct, Math.ceil(b.rem - 1e-6)]);
  return out;
}
