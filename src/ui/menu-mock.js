// Stand-in for src/net/lobby.js, used when the page URL has ?mockLobby=1
// (screenshots and UI work without a network). Same surface as DESIGN 7's
// LobbyHost / LobbyClient, with a scripted friend joining and chatting.
import { GAME_VERSION, MAX_PLAYERS, PLAYER_COLORS } from '../config.js';
import { PANTHEON_LIST } from '../data/index.js';

const later = (ms) => new Promise((r) => setTimeout(r, ms));

function slot(kind, extra = {}) {
  return { kind, name: '', pantheon: 'random', team: 1, color: 0, difficulty: 'normal', peerId: null, ...extra };
}

class Emitter {
  constructor() {
    this.changeCbs = new Set();
    this.chatCbs = new Set();
  }

  onChange(cb) {
    this.changeCbs.add(cb);
    return () => this.changeCbs.delete(cb);
  }

  onChat(cb) {
    this.chatCbs.add(cb);
    return () => this.chatCbs.delete(cb);
  }

  emitChange() {
    for (const cb of [...this.changeCbs]) cb(this.state);
  }

  /** Same line shape as the real lobby: { from: slot index | -1, name, text, system }. */
  emitChat(from, text) {
    const index = from === null ? -1 : this.state.slots.findIndex((s) => s.name === from);
    const line = { from: index, name: from || '', text, system: from === null };
    for (const cb of [...this.chatCbs]) cb(line);
  }
}

function aiName(d) {
  return `AI (${d[0].toUpperCase()}${d.slice(1)})`;
}

function buildSetup(state, mySlotIndex) {
  const seed = Math.floor(Math.random() * 1e9);
  let pick = seed;
  const players = [];
  let myIndex = 0;
  state.slots.forEach((s, i) => {
    if (!['host', 'human', 'ai'].includes(s.kind)) return;
    pick = (pick * 1103515245 + 12345) >>> 0;
    const pantheon = s.pantheon === 'random' ? PANTHEON_LIST[pick % PANTHEON_LIST.length].id : s.pantheon;
    if (i === mySlotIndex) myIndex = players.length;
    players.push({
      index: players.length,
      name: s.kind === 'ai' ? aiName(s.difficulty) : s.name,
      team: s.team,
      pantheon,
      color: PLAYER_COLORS[s.color],
      kind: s.kind === 'ai' ? 'ai' : 'human',
      difficulty: s.kind === 'ai' ? s.difficulty : null,
    });
  });
  const setup = { version: GAME_VERSION, seed, mapSize: state.mapSize, players };
  if (state.peace) setup.peaceMinutes = state.peace;
  else if (state.survival) {
    setup.survival = true;
    for (const p of players) p.team = 1;
  }
  if (state.sacred) setup.sacredVictory = true;
  return { setup, myIndex };
}

export class LobbyHost extends Emitter {
  /** @param {{ transport: string, name: string }} opts */
  static async create({ transport = 'none', name = 'Player' } = {}) {
    await later(transport === 'none' ? 0 : 350);
    return new LobbyHost(transport, name);
  }

  constructor(transport, name) {
    super();
    this.transport = transport;
    this.roomCode = transport === 'none' ? null : 'K7QX2';
    const online = transport !== 'none';
    this.state = {
      roomCode: this.roomCode,
      mapSize: 'small',
      peace: 0,
      sacred: false,
      slots: [
        slot('host', { name, pantheon: 'greek', team: 1, color: 0 }),
        online ? slot('open', { team: 1, color: 1 }) : slot('ai', { name: aiName('normal'), team: 2, color: 1 }),
        online ? slot('open', { team: 2, color: 2 }) : slot('closed', { team: 2, color: 2 }),
        online ? slot('ai', { name: aiName('hard'), difficulty: 'hard', team: 2, color: 3 }) : slot('closed', { team: 2, color: 3 }),
      ],
    };
    this.closed = false;
    if (online) this.scriptFriend();
  }

  async scriptFriend() {
    await later(450);
    if (this.closed || this.state.slots[1].kind !== 'open') return;
    this.state.slots[1] = slot('human', { name: 'Sigrun', pantheon: 'norse', team: 1, color: 1, peerId: 'mock-peer-1' });
    this.emitChange();
    this.emitChat(null, 'Sigrun joined the lobby.');
    await later(250);
    if (!this.closed) this.emitChat('Sigrun', 'Ready when you are! I will take the Norse.');
    await later(200);
    if (!this.closed) this.emitChat(this.state.slots[0].name, 'Nice. Thor up front, I will bring Zeus.');
  }

  setSlot(i, patch) {
    const s = this.state.slots[i];
    if (!s || !patch) return;
    if (patch.kind && patch.kind !== s.kind) {
      if (s.kind === 'host') return;
      if (s.kind === 'human') this.emitChat(null, `${s.name} was removed from the lobby.`);
      s.kind = patch.kind;
      s.peerId = null;
      s.name = patch.kind === 'ai' ? aiName(patch.difficulty || s.difficulty) : '';
    }
    for (const k of ['pantheon', 'team', 'color', 'difficulty', 'name']) if (patch[k] !== undefined) s[k] = patch[k];
    if (s.kind === 'ai') s.name = aiName(s.difficulty);
    this.emitChange();
  }

  applyPreset(preset) {
    const online = this.transport !== 'none';
    const fill = () => (online ? 'open' : 'ai');
    const slots = this.state.slots;
    const human = (s) => s.kind === 'host' || s.kind === 'human';
    const set = (i, kind, team) => {
      const s = slots[i];
      if (!human(s)) {
        s.kind = kind;
        s.difficulty = s.difficulty || 'normal';
        s.name = kind === 'ai' ? aiName(s.difficulty) : '';
      }
      s.team = team;
    };
    if (preset === 'coop') {
      slots.forEach((s, i) => (human(s) ? (s.team = 1) : set(i, 'ai', 2)));
      this.state.mapSize = slots.filter((s) => s.kind !== 'closed').length > 2 ? 'medium' : 'small';
    } else if (preset === '1v1') {
      set(1, fill(), 2);
      if (!human(slots[0])) set(0, fill(), 1);
      slots[0].team = 1;
      set(2, 'closed', 1);
      set(3, 'closed', 2);
      this.state.mapSize = 'small';
    } else if (preset === '2v2') {
      [1, 1, 2, 2].forEach((t, i) => set(i, fill(), t));
      this.state.mapSize = 'medium';
    } else if (preset === 'ffa') {
      [1, 2, 3, 4].forEach((t, i) => set(i, fill(), t));
      this.state.mapSize = 'medium';
    }
    this.emitChange();
  }

  setMapSize(size) {
    this.state.mapSize = size;
    this.emitChange();
  }

  setPeace(minutes) {
    this.state.peace = minutes;
    this.state.survival = false;
    this.emitChange();
  }

  setSurvival(on) {
    this.state.survival = !!on;
    if (on) this.state.peace = 0;
    this.emitChange();
  }

  setSacred(on) {
    this.state.sacred = !!on;
    this.emitChange();
  }

  startProblem() {
    if (this.state.survival) return null;
    const filled = this.state.slots.filter((s) => ['host', 'human', 'ai'].includes(s.kind));
    const teams = new Set(filled.map((s) => s.team));
    return teams.size >= 2 ? null : 'Players must be on at least two different teams.';
  }

  canStart() {
    return this.startProblem() === null;
  }

  kick(i) {
    this.setSlot(i, { kind: 'open' });
  }

  sendChat(text) {
    this.emitChat(this.state.slots[0].name, text);
  }

  start() {
    const { setup, myIndex } = buildSetup(this.state, 0);
    this.closed = true;
    return { setup, myIndex, conns: new Map() };
  }

  close() {
    this.closed = true;
  }
}

export class LobbyClient extends Emitter {
  /** @param {{ transport: string, roomCode: string, name: string }} opts */
  static async join({ roomCode, name = 'Player' } = {}) {
    await later(900);
    if (roomCode === 'ZZZZZ') throw new Error(`Room ${roomCode} was not found. Check the code and that the host is still in the lobby.`);
    if (roomCode === 'VVVVV') throw new Error(`Version mismatch: the host runs v0.0.9 but you have v${GAME_VERSION}. Reload the page (Ctrl+Shift+R) so you both run the same version.`);
    return new LobbyClient(roomCode, name);
  }

  constructor(roomCode, name) {
    super();
    this.roomCode = roomCode;
    this.mySlot = 1;
    this.kickCbs = new Set();
    this.startCbs = new Set();
    this.state = {
      roomCode,
      mapSize: 'medium',
      peace: 45,
      sacred: true,
      slots: [
        slot('host', { name: 'Hestia_42', pantheon: 'egyptian', team: 1, color: 3 }),
        slot('human', { name, pantheon: 'random', team: 1, color: 1, peerId: 'me' }),
        slot('ai', { name: aiName('normal'), team: 2, color: 4 }),
        slot('ai', { name: aiName('normal'), team: 2, color: 5 }),
      ],
    };
    setTimeout(() => this.emitChat('Hestia_42', 'Welcome! Pick a pantheon, I start in a minute.'), 300);
  }

  setMine(patch) {
    Object.assign(this.state.slots[this.mySlot], patch);
    this.emitChange();
  }

  onStart(cb) {
    this.startCbs.add(cb);
    return () => this.startCbs.delete(cb);
  }

  onKicked(cb) {
    this.kickCbs.add(cb);
    return () => this.kickCbs.delete(cb);
  }

  sendChat(text) {
    this.emitChat(this.state.slots[this.mySlot].name, text);
  }

  /** Mock only: pretend the host pressed Start. */
  _mockStart() {
    const { setup, myIndex } = buildSetup(this.state, this.mySlot);
    for (const cb of [...this.startCbs]) cb({ setup, myIndex, conn: null });
  }

  leave() {}
}

export const MOCK_MAX_PLAYERS = MAX_PLAYERS;
