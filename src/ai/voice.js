// AI chat voices (DESIGN 10.1): computer players say a short in-character line at the moments
// that matter: a greeting (to allies when there is no enemy player), first contact, the first blow struck against them, the end of a
// Decade of Peace, summoning a god or a Titan, losing a god, being nearly beaten, defeat and
// victory. Runs on the host only, beside the AIs; it reads the World and the snapshot events
// and returns chat lines (it never changes the World). Rate-limited so that the feed stays a
// conversation, not a stream: an ordinary line waits VOICE.playerGap after the same AI's last
// one and VOICE.globalGap after any AI's, and a line that cannot go out is dropped, not queued.
import { getUnitType } from '../data/index.js';
import { RNG, hashSeed } from '../sim/rng.js';
import { VOICE_LINES, fillLine } from './voice-lines.js';
import { teamOrderFor } from '../sim/team-orders.js';

export const VOICE = {
  greetAt: 6, // game seconds before the first greeting; each later AI waits greetStagger more
  greetStagger: 7,
  greetChance: 0.7, // not every AI says hello
  playerGap: 45, // game seconds between two ordinary lines of one AI
  globalGap: 15, // game seconds between two ordinary lines of any AIs
  urgentGap: 2, // urgent lines (a Titan, nearly beaten) skip the gaps above but keep this apart
  repeatGap: 150, // game seconds before one AI says another line of the same kind
  maxLines: 24, // lines one AI says in a whole match
  contactEvery: 2, // game seconds between first-contact scans
  contactRange: 14, // tiles: an enemy player's unit this close to one of the AI's means they have met
  scanUnits: 48, // at most this many of the AI's units looked around per scan
  beatenShare: 0.35, // nearly beaten: buildings down to this share of the most it ever had...
  beatenMin: 5, // ...once it had at least this many
  ackGap: 20, // game seconds between two answers of one AI to its teammates' markers
  maxAcks: 30, // answers one AI gives in a whole match (apart from maxLines)
};

const URGENT = new Set(['titan', 'beaten']);
const FINAL = new Set(['defeat', 'victory']); // the last word goes out whatever was said just before

/**
 * The voices of a match's computer players.
 * @param {object} world authoritative World
 * @param {number[]} players indices of the AI players that speak
 */
export class AIVoices {
  constructor(world, players) {
    this.world = world;
    const seed = world.setup ? world.setup.seed : 1;
    this.rng = new RNG(hashSeed(`${seed}:voices`));
    this.voices = new Map();
    let order = 0;
    for (const i of players) {
      const p = world.players[i];
      if (!p) continue;
      const lines = VOICE_LINES[p.pantheon] || VOICE_LINES.greek;
      this.voices.set(i, {
        index: i,
        lines,
        last: -Infinity,
        said: 0,
        greetAt: VOICE.greetAt + VOICE.greetStagger * order++,
        greeted: false,
        met: false,
        struck: false,
        beaten: false,
        done: false, // said its last word (defeat or victory)
        peak: 0,
        next: {}, // trigger -> index of the next line (each list is walked in a shuffled order)
        order: {},
        lastOf: {}, // trigger -> game time of its last line
        gods: new Set(), // gods that have arrived once
        ackId: 0, // the newest teammate's marker (sim/team-orders.js) it has seen
        lastAck: -Infinity,
        acks: 0,
      });
    }
    this.lastAny = -Infinity;
    this.nextScan = VOICE.contactEvery;
    this.ended = false;
    this._tmp = [];
  }

  /**
   * A loaded game (DESIGN 9.4) carries on where it was saved: the greetings and first contacts of the
   * time before are not said again, nor the arrival of the gods already on the field.
   */
  resume() {
    const world = this.world;
    const now = world.time;
    for (const v of this.voices.values()) {
      if (now < v.greetAt) continue;
      v.greeted = true;
      v.met = true;
    }
    for (const v of this.voices.values()) v.ackId = world.markSeq || 0; // (the markers of the time before are not answered again)
    for (const u of world.unitList || []) {
      const v = !u.dead && this.voices.get(u.owner);
      const def = v && getUnitType(u.type);
      if (def && def.class === 'god') v.gods.add(u.type);
    }
    this.nextScan = now + VOICE.contactEvery;
  }

  /**
   * Look at the events since the last call and at the World; returns the lines to send.
   * @param {object[]} [events] the snapshot's events
   * @returns {{ from: number, text: string, team?: boolean }[]} (`team`: to the speaker's team only)
   */
  step(events) {
    const out = [];
    if (!this.voices.size || this.ended) return out;
    const world = this.world;
    const now = world.time;
    for (const ev of events || []) this.onEvent(ev, now, out);
    if (this.ended) return out;
    for (const v of this.voices.values()) {
      if (!v.greeted && now >= v.greetAt) {
        v.greeted = true;
        // With no enemy player (the Trial of the Titans) a greeting to rivals would be wrong: greet the allies.
        if (this.rng.chance(VOICE.greetChance)) this.say(v, this.hasEnemyPlayer(v.index) ? 'greet' : 'greetAlly', {}, now, out);
      }
    }
    this.answerMarks(now, out);
    if (now >= this.nextScan) {
      this.nextScan = now + VOICE.contactEvery;
      this.scanContact(now, out);
      for (const v of this.voices.values()) this.checkBeaten(v, now, out);
    }
    return out;
  }

  onEvent(ev, now, out) {
    if (!ev || typeof ev !== 'object') return;
    const world = this.world;
    switch (ev.type) {
      case 'spawn': {
        const v = this.voices.get(ev.o);
        const def = v && getUnitType(ev.t);
        if (def && def.class === 'god' && !v.gods.has(ev.t)) {
          v.gods.add(ev.t); // its first arrival only, said or not: a revived god comes back quietly
          this.say(v, 'god', { unit: def.name }, now, out);
        }
        break;
      }
      case 'titanSummoning': {
        const v = this.voices.get(ev.player);
        const def = v && getUnitType(ev.t);
        if (def) this.say(v, 'titan', { unit: def.name }, now, out);
        break;
      }
      case 'death': {
        const v = this.voices.get(ev.o);
        if (!v) break;
        if (ev.k === 'u') {
          const def = getUnitType(ev.t);
          if (def && def.class === 'god') this.say(v, 'godLost', { unit: def.name }, now, out);
        } else if (ev.k === 'b') this.checkBeaten(v, now, out);
        break;
      }
      case 'underAttack': {
        const v = this.voices.get(ev.player);
        if (!v || v.struck) break;
        const enemy = this.attackerNear(ev.player, ev.x, ev.y);
        if (enemy < 0) break; // wild creatures, not a player
        v.met = true; // no "first contact" line after this one
        if (this.say(v, 'struck', { enemy: world.players[enemy].name }, now, out)) v.struck = true;
        break;
      }
      case 'peaceEnd': {
        const v = this.pickSpeaker();
        if (v) this.say(v, 'peaceEnd', {}, now, out);
        break;
      }
      case 'playerDefeated': {
        const v = this.voices.get(ev.player);
        if (v && !v.done) {
          this.say(v, 'defeat', {}, now, out);
          v.done = true;
        }
        break;
      }
      case 'gameOver': {
        // One voice for the winning team: the first of its AIs still standing.
        for (const v of this.voices.values()) {
          const p = world.players[v.index];
          if (!v.done && p && !p.defeated && p.team === ev.winningTeam) {
            this.say(v, 'victory', {}, now, out);
            break;
          }
        }
        this.ended = true;
        break;
      }
      default:
    }
  }

  /**
   * A teammate's Attack, Defend or Help marker (sim/team-orders.js, which the AI answers, src/ai/marks.js):
   * one AI of that team says so, to the team only (`team: true`: the enemy must not learn an order was
   * given). Not counted against the ordinary gaps, which would hold most answers back, but at most one
   * every VOICE.ackGap per AI. An Attack marker in a Decade of Peace waits, unanswered, as the AI does.
   */
  answerMarks(now, out) {
    const world = this.world;
    const said = new Set();
    for (const v of this.voices.values()) {
      const m = teamOrderFor(world, v.index);
      if (!m || m.id <= v.ackId) continue;
      if (m.kind === 'attack' && world.peace) continue;
      v.ackId = m.id;
      if (said.has(m.id) || v.done || world.players[v.index].defeated) continue;
      if (v.acks >= VOICE.maxAcks || now - v.lastAck < VOICE.ackGap) continue;
      const text = this.pick(v, m.kind === 'attack' ? 'ackAttack' : 'ackDefend', {});
      if (!text) continue;
      v.lastAck = now;
      v.acks++;
      said.add(m.id);
      out.push({ from: v.index, text, team: true });
    }
  }

  /** Whether any other player is this AI's enemy (none in the Trial of the Titans, where the monsters belong to no one). */
  hasEnemyPlayer(me) {
    const world = this.world;
    return world.players.some((p, i) => p && i !== me && world.areEnemies(me, i));
  }

  /** An AI still in the game, chosen at random (for a line about the whole match). */
  pickSpeaker() {
    const live = [...this.voices.values()].filter((v) => !v.done && !this.world.players[v.index].defeated);
    return live.length ? this.rng.pick(live) : null;
  }

  /** The enemy player with a unit nearest (x, y), or -1. */
  attackerNear(me, x, y) {
    const world = this.world;
    const tmp = this._tmp;
    tmp.length = 0;
    world.hash.query(x, y, VOICE.contactRange, tmp);
    let best = -1;
    let bestD = Infinity;
    for (const u of tmp) {
      if (u.dead || u.owner < 0 || !world.areEnemies(me, u.owner)) continue;
      const d = (u.x - x) ** 2 + (u.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = u.owner;
      }
    }
    return best;
  }

  /** First contact: an enemy player's unit near one of the AI's units or buildings. */
  scanContact(now, out) {
    const world = this.world;
    const pending = [...this.voices.values()].filter((v) => !v.met && !v.done);
    if (!pending.length) return;
    const spots = new Map(pending.map((v) => [v.index, []]));
    for (const b of world.buildingList) {
      const list = !b.dead && spots.get(b.owner);
      if (list && !b.def.wall) list.push(b.tx + b.size / 2, b.ty + b.size / 2);
    }
    const units = new Map(pending.map((v) => [v.index, []]));
    for (const u of world.unitList) {
      const list = !u.dead && units.get(u.owner);
      if (list) list.push(u);
    }
    for (const v of pending) {
      const list = spots.get(v.index);
      const us = units.get(v.index);
      const stride = Math.max(1, Math.ceil(us.length / VOICE.scanUnits));
      for (let i = 0; i < us.length; i += stride) list.push(us[i].x, us[i].y);
      for (let i = 0; i < list.length; i += 2) {
        const enemy = this.attackerNear(v.index, list[i], list[i + 1]);
        if (enemy < 0) continue;
        if (this.say(v, 'contact', { enemy: world.players[enemy].name }, now, out)) v.met = true;
        break;
      }
    }
  }

  /** Nearly beaten: most of its buildings gone, or its last Town Center. Said once. */
  checkBeaten(v, now, out) {
    if (v.beaten || v.done) return;
    const world = this.world;
    let count = 0;
    let centers = 0;
    for (const b of world.buildingList) {
      if (b.dead || b.owner !== v.index || b.def.wall) continue;
      count++;
      if (b.type === 'town_center') centers++;
    }
    if (count > v.peak) v.peak = count;
    if (count === 0 || world.players[v.index].defeated) return; // the defeat line covers that
    if (v.peak < VOICE.beatenMin) return;
    if (count <= v.peak * VOICE.beatenShare || centers === 0) {
      v.beaten = true;
      this.say(v, 'beaten', {}, now, out);
    }
  }

  /** Say a line of `trigger` if the limits allow; true when it went out. */
  say(v, trigger, vars, now, out) {
    if (v.done || v.said >= VOICE.maxLines) return false;
    if (FINAL.has(trigger)) {
      // always
    } else if (URGENT.has(trigger)) {
      if (now - this.lastAny < VOICE.urgentGap) return false;
    } else if (now - v.last < VOICE.playerGap || now - this.lastAny < VOICE.globalGap) return false;
    if (!FINAL.has(trigger) && now - (v.lastOf[trigger] ?? -Infinity) < VOICE.repeatGap) return false;
    const text = this.pick(v, trigger, vars);
    if (!text) return false;
    v.last = now;
    v.lastOf[trigger] = now;
    v.said++;
    this.lastAny = now;
    out.push({ from: v.index, text });
    return true;
  }

  /** The next line of a trigger for this AI, blanks filled (lines go round in a shuffled order). */
  pick(v, trigger, vars) {
    const list = v.lines[trigger] || VOICE_LINES.greek[trigger];
    if (!list || !list.length) return null;
    if (!v.order[trigger]) {
      v.order[trigger] = this.rng.shuffle(list.map((_, i) => i));
      v.next[trigger] = 0;
    }
    const order = v.order[trigger];
    for (let k = 0; k < order.length; k++) {
      const n = v.next[trigger]++ % order.length;
      const text = fillLine(list[order[n]], vars);
      if (text) return text;
    }
    return null;
  }
}

/**
 * The host's factory (HostSession `createVoices`).
 * @param {object} world
 * @param {number[]} players the AI players that speak
 */
export function createVoices(world, players) {
  // A campaign mission's enemies stay in character: no skirmish banter, its narrator tells the story (DESIGN 5.16).
  if (world.setup && typeof world.setup.campaign === 'string') return null;
  return new AIVoices(world, players);
}
