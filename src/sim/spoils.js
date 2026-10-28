// Pantheon blessings that pay out while the game is played (data/pantheons/<id>.js
// `identity.blessings`, folded into p.mods.perks by data/upgrades.js computeMods):
//   plunder      Norse: a slain enemy's gold and wood cost, in part, as gold for the killer
//   sacrifice    Aztec: faith for every population point of an enemy unit slain
//   karma        Hindu: faith each second from every worshipper at work
//   shrineFaith  Japanese: faith each second from each finished Shrine / Temple, with or without prayer
import { DT } from '../config.js';

/** Most Shrines and Temples that trickle faith for the shrineFaith perk. */
export const SHRINE_FAITH_BUILDINGS = 4;

/** Worshipper states that count as work for karma (a repairing worshipper is in 'build'). */
const WORKING = new Set(['gather', 'return', 'build']);

const r2 = (v) => Math.round(v * 100) / 100;

/**
 * An enemy unit or building of `dead` fell to a unit of player `killer`: pay plunder and
 * sacrifice. Creeps already pay a gold bounty, so they are not plundered; summoned units
 * and unfinished sites are worth nothing.
 */
export function awardSpoils(world, dead, killer) {
  const kp = world.players[killer];
  if (!kp || dead.summoned) return;
  const perks = kp.mods.perks;
  const x = r2(dead.x);
  const y = r2(dead.y);
  if (perks.plunder > 0 && dead.owner >= 0 && (dead.kind === 'unit' || dead.constructed)) {
    const c = dead.def.cost || {};
    const gold = Math.round(perks.plunder * ((c.gold || 0) + (c.wood || 0)));
    if (gold > 0) {
      kp.gold += gold;
      world.emit({ type: 'bounty', player: killer, amount: gold, x, y, res: 'g' });
    }
  }
  if (perks.sacrifice > 0 && dead.kind === 'unit') {
    const faith = Math.round(perks.sacrifice * (dead.def.pop || 0));
    if (faith > 0) {
      kp.faith += faith;
      kp.stats.faith += faith;
      world.emit({ type: 'bounty', player: killer, amount: faith, x, y, res: 'f' });
    }
  }
}

/** Add this tick's karma and shrine-trickle faith to each player's faith and faith rate. */
export function accrueBlessedFaith(world) {
  const players = world.players;
  let workers = null;
  if (players.some((p) => p.mods.perks.karma > 0)) {
    workers = new Array(players.length).fill(0);
    for (const u of world.unitList) {
      if (!u.dead && u.owner >= 0 && u.def.class === 'worker' && WORKING.has(u.state)) workers[u.owner]++;
    }
  }
  for (const p of players) {
    const { karma, shrineFaith } = p.mods.perks;
    let rate = karma > 0 ? karma * workers[p.index] : 0;
    if (shrineFaith > 0) {
      let n = 0;
      for (const b of world.buildingList) {
        if (!b.dead && b.owner === p.index && b.constructed && b.def.prayerSlots > 0 && ++n >= SHRINE_FAITH_BUILDINGS) break;
      }
      rate += shrineFaith * n;
    }
    if (rate <= 0) continue;
    p.faithRate += rate;
    p.faith += rate * DT;
    p.stats.faith += rate * DT;
  }
}
