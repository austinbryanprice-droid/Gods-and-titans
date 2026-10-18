// Pure helpers for the menu and lobby screens (no DOM, runs in Node tests).
import { MAX_PLAYERS, PLAYER_COLORS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../config.js';
import { sanitizeName, sanitizeChat, sanitizeReason } from '../net/protocol.js';

/** Emblem shown for each pantheon in slot rows and the picker. */
export const PANTHEON_EMBLEMS = {
  greek: '⚡',
  norse: '🔨',
  egyptian: '☀️',
  hindu: '🔱',
  japanese: '⛩️',
  chinese: '🐉',
  aztec: '🐍',
  celtic: '🌳',
  mesopotamian: '🦁',
  west_african: '🕷️',
  random: '🎲',
};

export const DIFFICULTIES = ['easy', 'normal', 'hard'];
const DIFF_LABEL = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

/** Network params carried over into invite links (so test servers / TURN keep working). */
const NET_PARAMS = ['transport', 'net', 'peerHost', 'peerPort', 'peerPath', 'peerSecure', 'turn', 'turnUser', 'turnPass', 'relay'];

/** Clean a typed or pasted room code (also accepts an invite link). '' when nothing usable. */
export function cleanRoomCode(input) {
  let s = String(input ?? '').trim();
  const m = s.match(/[?&#]join=([^&#\s]+)/i);
  if (m) {
    try {
      s = decodeURIComponent(m[1]);
    } catch {
      s = m[1];
    }
  }
  s = s.toUpperCase();
  // A pasted message ("room code: K7QX2"): take the standalone code-sized word, not letters from every word.
  const words = s.split(/[^A-Z0-9]+/).filter(Boolean);
  if (words.length > 1) {
    const codes = words.filter((w) => isCompleteRoomCode(w));
    if (codes.length) return codes.reverse().find((w) => /\d/.test(w)) || codes[0];
  }
  let out = '';
  for (const ch of s) if (ROOM_CODE_ALPHABET.includes(ch)) out += ch;
  return out.slice(0, ROOM_CODE_LENGTH);
}

/** True for a complete room code. */
export function isCompleteRoomCode(code) {
  return typeof code === 'string' && code.length === ROOM_CODE_LENGTH && [...code].every((c) => ROOM_CODE_ALPHABET.includes(c));
}

/**
 * Invite link for a room: the page URL with only `?join=CODE` plus network override params.
 * The code is cleaned to the room-code alphabet, and only http(s) pages make links.
 * @param {string} href current location.href
 * @param {string} code
 */
export function inviteLink(href, code) {
  const url = new URL(href);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  const keep = new URLSearchParams();
  keep.set('join', cleanRoomCode(code));
  for (const k of NET_PARAMS) {
    const v = url.searchParams.get(k);
    if (v !== null && v !== '') keep.set(k, v);
  }
  url.search = `?${keep.toString()}`;
  url.hash = '';
  return url.toString();
}

/**
 * A plain-words note when the page runs on a non-default network setup (from URL
 * params), else null: friends then need the invite link, which carries the setup.
 * @param {string} href current location.href
 */
export function customServerNote(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const p = url.searchParams;
  if (p.get('transport') === 'local' || p.get('net') === 'local') {
    return 'Local test mode: only other tabs of this browser can join.';
  }
  const host = sanitizeReason(p.get('peerHost') || '', '').slice(0, 60);
  if (host) return `Custom matchmaking server (${host}): send the invite link, since the code alone will not find this room.`;
  if (p.get('turn') || p.get('relay') === '1') return 'Custom relay settings are on: send the invite link so friends use them too.';
  return null;
}

/** True when a slot holds a player (host, connected human or AI). */
export function isFilled(slot) {
  return !!slot && (slot.kind === 'host' || slot.kind === 'human' || slot.kind === 'ai');
}

/** True for a human slot (host or connected player). */
export function isHuman(slot) {
  return !!slot && (slot.kind === 'host' || slot.kind === 'human');
}

/** Display name for a slot. */
export function slotName(slot) {
  if (!slot) return '';
  if (slot.kind === 'ai') return slot.name || `AI (${DIFF_LABEL[slot.difficulty] || 'Normal'})`;
  if (slot.kind === 'open') return 'Open';
  if (slot.kind === 'closed') return 'Closed';
  return slot.name || 'Player';
}

/** Dropdown value for a slot's kind: 'you' | 'human' | 'open' | 'ai:easy' | 'ai:normal' | 'ai:hard' | 'closed'. */
export function slotKindValue(slot, index, myIndex) {
  if (!slot) return 'closed';
  if (index === myIndex) return 'you';
  if (slot.kind === 'host' || slot.kind === 'human') return 'human';
  if (slot.kind === 'ai') return `ai:${DIFFICULTIES.includes(slot.difficulty) ? slot.difficulty : 'normal'}`;
  return slot.kind === 'open' ? 'open' : 'closed';
}

/**
 * Options for a slot's kind/name dropdown (host view).
 * @param {object} slot
 * @param {number} index
 * @param {{ myIndex: number, online: boolean }} ctx
 * @returns {{ value: string, label: string }[]}
 */
export function slotKindOptions(slot, index, { myIndex, online }) {
  if (index === myIndex) return [{ value: 'you', label: `${slot?.name || 'You'} (You)` }];
  const opts = [];
  if (slot && (slot.kind === 'human' || slot.kind === 'host')) opts.push({ value: 'human', label: slot.name || 'Player' });
  if (online) opts.push({ value: 'open', label: slot && slot.kind === 'human' ? 'Open (remove player)' : 'Open' });
  for (const d of DIFFICULTIES) opts.push({ value: `ai:${d}`, label: `AI — ${DIFF_LABEL[d]}` });
  opts.push({ value: 'closed', label: 'Closed' });
  return opts;
}

/** Lobby patch for a kind dropdown value, or null for no change. */
export function kindPatch(value) {
  if (value === 'open') return { kind: 'open' };
  if (value === 'closed') return { kind: 'closed' };
  if (typeof value === 'string' && value.startsWith('ai:')) {
    const difficulty = value.slice(3);
    return { kind: 'ai', difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : 'normal' };
  }
  return null;
}

/** Color indices used by other filled slots. */
export function takenColors(state, exceptIndex) {
  const taken = new Set();
  (state?.slots || []).forEach((s, i) => {
    if (i !== exceptIndex && isFilled(s) && Number.isInteger(s.color)) taken.add(s.color);
  });
  return taken;
}

/**
 * Colors the editor of slot `index` cannot pick: those of other human players, and
 * for clients every color in use (the host may take an AI's color; they swap).
 */
export function blockedColors(state, index, isHost) {
  const blocked = new Set();
  (state?.slots || []).forEach((s, i) => {
    if (i === index || !isFilled(s) || !Number.isInteger(s.color)) return;
    if (!isHost || isHuman(s)) blocked.add(s.color);
  });
  return blocked;
}

/** CSS color for a slot's color index. */
export function slotColor(slot) {
  const i = slot && Number.isInteger(slot.color) ? slot.color : 0;
  return PLAYER_COLORS[((i % PLAYER_COLORS.length) + PLAYER_COLORS.length) % PLAYER_COLORS.length];
}

/** Teams in use: Map<team, slot index[]>. */
export function teamsOf(state) {
  const teams = new Map();
  (state?.slots || []).forEach((s, i) => {
    if (!isFilled(s)) return;
    if (!teams.has(s.team)) teams.set(s.team, []);
    teams.get(s.team).push(i);
  });
  return teams;
}

/**
 * Why the game cannot start yet (mirrors DESIGN 7: ≥ 2 teams with players, every human
 * slot connected), or null when it can.
 */
export function startBlockReason(state) {
  const slots = state?.slots || [];
  const waiting = slots.find((s) => s && s.kind === 'human' && s.connected === false);
  if (waiting) return `Waiting for ${waiting.name || 'a player'} to connect…`;
  const teams = teamsOf(state);
  const filled = slots.filter(isFilled).length;
  if (filled < 2) return 'Add an opponent: set a slot to AI or wait for a player to join.';
  if (teams.size < 2) return 'Everyone is on the same team. Put someone on another team.';
  return null;
}

/**
 * Whether the host can start, with a reason when not. Uses lobby.startProblem()
 * when available, else lobby.canStart() (boolean or { ok, reason }).
 * @param {object} lobby
 * @param {{ online?: boolean }} [ctx] online: friends can still join (shapes the "no opponent yet" hint)
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function startStatus(lobby, { online = false } = {}) {
  const state = lobby?.state;
  try {
    if (typeof lobby?.startProblem === 'function') {
      const problem = lobby.startProblem();
      if (!problem) return { ok: true, reason: null };
      // Nobody to play against yet: say that, not the team rule (a lone host and an open seat).
      const filled = (state?.slots || []).filter(isFilled).length;
      if (state && filled < 2 && /different teams/i.test(String(problem))) {
        return { ok: false, reason: online ? 'Waiting for a friend to join. Share the room code or invite link, or set a slot to AI.' : 'Set a slot to AI to have an opponent.' };
      }
      return { ok: false, reason: String(problem) };
    }
    const res = typeof lobby?.canStart === 'function' ? lobby.canStart() : null;
    if (res && typeof res === 'object') {
      const ok = !!(res.ok ?? res.canStart ?? res.value);
      return { ok, reason: ok ? null : res.reason || startBlockReason(state) || 'Not ready to start.' };
    }
    if (res === true) return { ok: true, reason: null };
    if (res === false) return { ok: false, reason: startBlockReason(state) || 'Waiting for every player to connect…' };
  } catch (err) {
    return { ok: false, reason: err?.message || 'Cannot start.' };
  }
  const reason = startBlockReason(state);
  return { ok: !reason, reason };
}

/** "Team 1: A, B  vs  Team 2: C" style summary parts: [{ team, names: [..], colors: [..] }]. */
export function matchupSummary(state) {
  const out = [];
  const teams = [...teamsOf(state).entries()].sort((a, b) => a[0] - b[0]);
  for (const [team, idx] of teams) {
    out.push({
      team,
      names: idx.map((i) => slotName(state.slots[i])),
      colors: idx.map((i) => slotColor(state.slots[i])),
    });
  }
  return out;
}

/**
 * Normalize a chat callback's arguments into { from, text, system }. Accepts the lobby's
 * `{ from: slotIndex, name, text, system }`, `{ from: name, text }` or `(from, text)`.
 */
export function normalizeChat(a, b) {
  // Names and text come from other players through the host: clean them the same
  // way the network layer does (single line, no control / bidi characters, bounded).
  const name = (v) => sanitizeName(typeof v === 'number' ? '' : v, 'Player');
  if (a && typeof a === 'object') {
    const system = !!a.system || a.from === null || a.from === undefined && !a.name || a.from === -1 || a.from === 'system';
    const from = a.name || (typeof a.from === 'string' && a.from !== 'system' ? a.from : '') || (system ? null : 'Player');
    return { from: system ? null : name(from), text: sanitizeChat(String(a.text ?? '')), system };
  }
  if (b === undefined) return { from: null, text: sanitizeChat(String(a ?? '')), system: true };
  const system = a === null || a === undefined || a === 'system' || a === -1;
  return { from: system ? null : name(String(a)), text: sanitizeChat(String(b ?? '')), system };
}

/**
 * A URL that is safe for href / src: relative, http(s) or mailto. Returns '' for
 * anything else (javascript:, data:, vbscript:, …), also when the scheme is
 * disguised with whitespace or control characters, which browsers ignore.
 */
export function safeUrl(value) {
  if (typeof value !== 'string' && !(value instanceof URL)) return '';
  const s = String(value).trim();
  if (!s) return '';
  // Browsers drop tabs / newlines inside URLs and ignore leading control characters.
  // eslint-disable-next-line no-control-regex
  const probe = s.replace(/[\u0000-\u0020\u007f-\u009f]/g, '').toLowerCase();
  const m = /^([a-z][a-z0-9+.-]*):/.exec(probe);
  if (!m) return s; // relative (or protocol-relative, i.e. http/https)
  return ['http', 'https', 'mailto'].includes(m[1]) ? s : '';
}

/** A message from the other side (kick reason, join error): plain single-line text, at most 300 characters. */
export function cleanMessage(text, fallback = '') {
  return sanitizeReason(typeof text === 'string' ? text : String(text ?? ''), fallback);
}

/** First sentence (or clause) of a description, at most maxLen characters. */
export function oneLine(text, maxLen = 96) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(.+?[.!?])(\s|$)/);
  let line = m ? m[1] : s;
  if (line.length > maxLen) {
    const cut = line.slice(0, maxLen);
    const at = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf(' — '), cut.lastIndexOf('; '));
    line = (at > maxLen * 0.5 ? cut.slice(0, at) : cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : maxLen)).replace(/[,;:\s—-]+$/, '') + '…';
  }
  return line;
}

function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return { h: 0, s: 0, l: 0.5 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

/** The two most vivid of a pantheon's wall / roof / trim colors (card header gradient). */
export function headerColors(colors = {}) {
  const list = [colors.wall, colors.roof, colors.trim].filter((c) => typeof c === 'string');
  if (!list.length) return ['#7a4a3a', '#3a4a6a'];
  const score = (c) => {
    const { s, l } = hexToHsl(c);
    return s * (1 - Math.abs(l - 0.45) * 1.4) * (l > 0.8 ? 0.2 : 1);
  };
  const sorted = [...list].sort((a, b) => score(b) - score(a));
  return [sorted[0], sorted[1] || sorted[0]];
}

/**
 * Summary of a pantheon for the picker card.
 * @param {object} p pantheon data (DESIGN 4.2)
 */
export function pantheonSummary(p) {
  const unit = (u) => u && {
    id: u.id,
    icon: u.icon || '✦',
    name: u.name,
    title: u.title || '',
    line: oneLine(u.description),
    description: u.description || '',
    tier: u.tier,
    air: !!u.air,
  };
  return {
    id: p.id,
    name: p.name,
    culture: p.culture,
    description: p.description,
    emblem: PANTHEON_EMBLEMS[p.id] || (p.gods?.[0]?.icon ?? '✦'),
    colors: p.colors || {},
    head: headerColors(p.colors),
    gods: (p.gods || []).map(unit),
    titan: unit(p.titan),
    creatures: (p.creatures || []).map(unit),
  };
}

/** Label for the lobby header. */
export function lobbyModeLabel(role, transport) {
  if (transport === 'none') return 'Skirmish vs AI';
  if (role === 'client') return 'Online — Joined';
  return transport === 'local' ? 'Online — Hosting (local test)' : 'Online — Hosting';
}

/** Number of slots shown in the lobby. */
export const SLOT_COUNT = MAX_PLAYERS;

/** Friendly text for a join / lobby error. */
export function friendlyJoinError(err, code) {
  const msg = cleanMessage((err && (err.message || err.reason)) || err || '');
  code = cleanRoomCode(code);
  if (!msg) return 'Could not join the game. Please try again.';
  // The network layer's own explanations (src/net/transport.js PEER_MESSAGES) are
  // already plain; a custom server name inside them must not trip the rules below.
  if (/^Couldn't (reach the matchmaking server|connect to the host)\b/.test(msg)) return msg;
  if (/not found|peer-unavailable|could not connect to peer/i.test(msg)) return `Room not found: no game is waiting with code ${code || 'that code'}. Check the code and make sure the host is still in the lobby.`;
  if (/version/i.test(msg)) return msg.startsWith('Version mismatch') ? msg : `Version mismatch: ${msg}`;
  if (/full/i.test(msg)) return 'That game is full.';
  if (/already (has )?started/i.test(msg)) return 'That game has already started.';
  if (/timeout|timed out/i.test(msg)) return 'The connection timed out. Check the code and your internet connection, then try again.';
  return msg;
}
