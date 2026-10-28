// Play Again and Quick Match (DESIGN 9): a game against the computer only can start again at once
// with the same lobby (fresh seed, so a new map and fresh random pantheons), and the last such lobby is
// kept on this device so the title screen can start it in one click. Online games are not replayed:
// their players would have to agree. The lobby module (src/net/lobby.js, loaded lazily by the menu)
// is passed in, since it builds and checks the setups.

import { SURVIVAL_NAME } from '../config.js';
import { landscapeInfo } from '../data/landscapes.js';

export const LAST_SKIRMISH_KEY = 'mythicwar-last-skirmish';

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // storage blocked
  }
}

/** True for a match hosted here with no other people in it: only AI players besides me. */
export function isSoloLaunch(launch) {
  if (!launch || launch.role !== 'host' || !launch.setup || !Array.isArray(launch.setup.players)) return false;
  if (launch.conns && launch.conns.size > 0) return false;
  return launch.setup.players.every((p) => p.index === launch.myIndex || p.kind === 'ai');
}

/**
 * The lobby state worth replaying, checked like a state from a host (lobby.sanitizeLobbyState), or null:
 * one host slot, nobody else human, and at least two teams unless it is a Trial of the Titans (everyone on one side
 * against the monsters).
 */
export function cleanSkirmish(lobbyMod, raw) {
  const st = lobbyMod.sanitizeLobbyState(raw);
  if (!st) return null;
  const active = st.slots.filter((s) => s.kind === 'host' || s.kind === 'ai');
  if (st.slots.filter((s) => s.kind === 'host').length !== 1 || st.slots.some((s) => s.kind === 'human')) return null;
  if (!st.survival && new Set(active.map((s) => s.team)).size < 2) return null;
  return { ...st, roomCode: null, started: false, slots: st.slots.map((s) => ({ ...s, peerId: null })) };
}

/** Remember the lobby of a game against the computer for Quick Match. */
export function saveSkirmish(lobbyMod, state, store = storage()) {
  const st = cleanSkirmish(lobbyMod, state);
  if (!st || !store) return false;
  try {
    store.setItem(LAST_SKIRMISH_KEY, JSON.stringify(st));
    return true;
  } catch {
    return false;
  }
}

/** The remembered lobby, or null (none yet, unreadable, or no longer a valid game against the computer). */
export function loadSkirmish(lobbyMod, store = storage()) {
  if (!store) return null;
  try {
    const raw = store.getItem(LAST_SKIRMISH_KEY);
    return raw ? cleanSkirmish(lobbyMod, JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/**
 * A launch (as the menu's lobby gives main.startGame) for a new game from a lobby state: a fresh seed,
 * the host slot named `name` when given.
 */
export function launchFrom(lobbyMod, state, name, seed = (Math.floor(Math.random() * 0x7ffffffe) + 1) >>> 0) {
  const st = cleanSkirmish(lobbyMod, state);
  if (!st) return null;
  const host = st.slots.findIndex((s) => s.kind === 'host');
  if (name) st.slots[host] = { ...st.slots[host], name };
  const { setup, slotToPlayer } = lobbyMod.buildSetup(st, seed);
  return { role: 'host', setup, myIndex: slotToPlayer.get(host), conns: new Map(), lobby: null, skirmish: st };
}

/** "1 vs 1 · Normal AI · small map", and the game mode, for the Quick Match button. */
export function skirmishLabel(state) {
  if (!state) return '';
  if (state.survival) {
    const n = state.slots.filter((s) => s.kind === 'host' || s.kind === 'ai').length;
    return [`${SURVIVAL_NAME}`, n > 1 ? `${n} players` : 'alone', `${state.mapSize} map`].join(' · ');
  }
  const active = state.slots.filter((s) => s.kind === 'host' || s.kind === 'ai');
  const host = active.find((s) => s.kind === 'host');
  const mine = active.filter((s) => s.team === host.team).length;
  const teams = new Map();
  for (const s of active) if (s.team !== host.team) teams.set(s.team, (teams.get(s.team) || 0) + 1);
  const sides = [mine, ...teams.values()].join(' vs ');
  const levels = [...new Set(active.filter((s) => s.kind === 'ai').map((s) => s.difficulty))];
  const ai = levels.map((d) => d[0].toUpperCase() + d.slice(1)).join(' / ');
  const parts = [sides, `${ai} AI`, `${state.mapSize} map`];
  if (state.landscape && state.landscape !== 'classic') parts.push(landscapeInfo(state.landscape).name);
  if (state.peace) parts.push(`Decade of Peace ${state.peace} min`);
  if (state.sacred) parts.push('Sacred Victory');
  return parts.join(' · ');
}
