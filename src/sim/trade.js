// Team market (DESIGN 5.7): a player sends gold, wood or faith to a living
// teammate. The market keeps TRADE_TAX_PCT of every transfer (rounded up), so
// feeding one player costs the team. Pure rules shared by the sim and the HUD.
import { TRADE_RESOURCES, TRADE_TAX_PCT, TRADE_MIN, TRADE_MAX } from '../config.js';

/** What the teammate receives when `amount` is sent. */
export function tradeReceived(amount) {
  const a = Math.floor(amount);
  return a > 0 ? a - Math.ceil((a * TRADE_TAX_PCT) / 100) : 0;
}

/** Players `from` may send to: living teammates other than themselves (indices, ascending). */
export function tradePartners(players, from) {
  const me = players[from];
  if (!me) return [];
  const out = [];
  players.forEach((p, i) => {
    if (i !== from && p && !p.defeated && p.team === me.team) out.push(i);
  });
  return out;
}

const RES_NAME = { gold: 'gold', wood: 'wood', faith: 'faith' };

/**
 * Why a transfer cannot happen (null = it can). `players` is world.players or
 * the snapshot's players (both carry team, defeated and the resource amounts).
 */
export function tradeError(players, from, to, res, amount) {
  const me = players[from];
  if (!me || me.defeated) return 'You cannot trade now.';
  if (!TRADE_RESOURCES.includes(res)) return 'Choose gold, wood or faith to send.';
  const them = Number.isInteger(to) ? players[to] : null;
  if (!them || to === from) return 'Choose a teammate to send to.';
  if (them.team !== me.team) return 'You can only send resources to a teammate.';
  if (them.defeated) return 'That ally has been defeated.';
  const a = Math.floor(amount);
  if (!(a >= TRADE_MIN)) return `Send at least ${TRADE_MIN} ${RES_NAME[res]}.`;
  if (a > TRADE_MAX) return `Send at most ${TRADE_MAX} ${RES_NAME[res]} at once.`;
  if (me[res] + 1e-6 < a) return `Not enough ${RES_NAME[res]}.`;
  return null;
}

/** Apply a `trade` command for `from` (validated here: commands are untrusted). */
export function issueTrade(world, from, to, res, amount) {
  const err = tradeError(world.players, from, to, res, amount);
  if (err) return world.error(from, err);
  const a = Math.floor(amount);
  const got = tradeReceived(a);
  const me = world.players[from];
  me[res] = Math.max(0, me[res] - a);
  world.players[to][res] += got;
  world.emit({ type: 'trade', from, to, res, amt: a, got });
}
