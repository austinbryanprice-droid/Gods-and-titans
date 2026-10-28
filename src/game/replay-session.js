// Replay playback (DESIGN 9.4): a session with the surface of HostSession (setup, myIndex, mapData,
// viewState, onChat, onEnd, start, stop, …) whose World is driven by a replay's recorded commands
// instead of players and AIs. It plays at 0.5× to 8× (the ticker runs that many times faster, a
// snapshot every few ticks), pauses, jumps ahead (running the ticks in slices of a few milliseconds so
// the page stays alive), and shows the game through any player's eyes or all of them. The view's
// clock is a playback clock that runs at the same speed and stops while paused, so the units move
// smoothly between snapshots at every speed. Going back means starting over (the Game builds a new
// session that jumps ahead to the moment): a World cannot run backwards, nor can the 3D trees regrow.
import { HOST_VIEW_DELAY_MS } from '../net/session.js';
import { Ticker } from '../net/ticker.js';
import { ViewState } from './view-state.js';
import { worldChecksum } from './replay.js';
import { TICK_RATE } from '../config.js';

export const REPLAY_SPEEDS = [0.5, 1, 2, 4, 8];
const SEEK_SLICE_MS = 24; // run ticks of a jump for this long, then let the page breathe

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Local time for the view that runs `speed` times as fast as real time, and not at all while stopped. */
export class PlaybackClock {
  constructor(speed = 1, time = now) {
    this.time = time;
    this.speed = speed;
    this.running = false;
    this.base = 0;
    this.anchor = time();
  }

  now() {
    return this.running ? this.base + (this.time() - this.anchor) * this.speed : this.base;
  }

  rebase() {
    this.base = this.now();
    this.anchor = this.time();
  }

  setSpeed(s) {
    this.rebase();
    this.speed = s;
  }

  setRunning(on) {
    if (on === this.running) return;
    this.rebase();
    this.running = on;
  }
}

export class ReplaySession {
  /**
   * @param {object} o
   * @param {object} o.record a checked replay (sanitizeReplay)
   * @param {(setup: object) => object} o.createWorld createWorld from src/sim/world.js
   * @param {number} [o.startAt] jump to this tick before playing (going back: a fresh session)
   * @param {number} [o.viewer] whose eyes to start with (-1: everyone's)
   * @param {number} [o.speed] one of REPLAY_SPEEDS
   * @param {boolean} [o.autoTick] run the ticker on start() (tests step with step())
   * @param {boolean} [o.useWorker] allow the background-proof worker metronome
   */
  constructor({ record, createWorld, startAt = 0, viewer = -1, speed = 1, autoTick = true, useWorker = true, viewDelayMs = HOST_VIEW_DELAY_MS }) {
    if (!record || !record.setup) throw new Error('ReplaySession needs a replay record.');
    this.record = record;
    this.setup = record.setup;
    this.isHost = true;
    this.isReplay = true;
    this.autoTick = autoTick;
    this.world = createWorld(this.setup);
    this.mapData = this.world.mapData;
    this.length = record.ticks;
    this.speed = REPLAY_SPEEDS.includes(speed) ? speed : 1;
    this.clock = new PlaybackClock(this.speed);
    this.viewState = new ViewState({ setup: this.setup, mapData: this.mapData, myIndex: -1, interpDelayMs: viewDelayMs, clock: () => this.clock.now() });
    this.myIndex = -1;
    this.chatLog = [];
    this.chatCbs = new Set();
    this.endCbs = new Set();
    this.changeCbs = new Set();
    this.cmdAt = 0;
    this.chatAt = 0;
    this.sumAt = 0;
    this.drift = null; // the first tick at which this build's game parted from the recorded one
    this.checked = 0; // checksums that matched
    this.started = false;
    this.stopped = false;
    this.ended = false; // the last recorded tick has played
    this.userPaused = false;
    this.holdPaused = false; // the in-game menu holds the replay still
    this.seeking = null; // { target, timer }
    this.ticksSinceSnap = 0;
    this.errors = 0;
    this.ticker = new Ticker({ onTick: () => this.tickOnce(), onBatch: () => this.afterTicks(), rate: TICK_RATE, maxCatchUp: this.catchUp(), useWorker });
    this.ticker.setSpeed(this.speed);
    this.pendingStart = Math.max(0, Math.min(this.length, Math.floor(startAt) || 0));
    this.pendingViewer = viewer;
    this.takeSnapshot();
  }

  /** The tick the replay has reached. */
  get tick() {
    return this.world.tickCount;
  }

  get playing() {
    return this.started && !this.stopped && !this.ended && !this.userPaused && !this.holdPaused && !this.seeking;
  }

  catchUp() {
    return Math.max(5, Math.ceil(this.speed * 5));
  }

  /** Snapshots every few ticks at high speed (the view interpolates between them). */
  snapEvery() {
    return Math.max(1, Math.floor(this.speed / 2));
  }

  // ------------------------------------------------------------ the session surface

  onChat(cb) {
    this.chatCbs.add(cb);
    return () => this.chatCbs.delete(cb);
  }

  onEnd(cb) {
    this.endCbs.add(cb);
    return () => this.endCbs.delete(cb);
  }

  /** cb() whenever playing, speed, viewer, position or drift change (the replay bar). */
  onChange(cb) {
    this.changeCbs.add(cb);
    return () => this.changeCbs.delete(cb);
  }

  emitChange() {
    for (const cb of [...this.changeCbs]) {
      try {
        cb(this);
      } catch (err) {
        console.error('[replay] change listener failed', err);
      }
    }
  }

  playerName(i) {
    const p = i >= 0 ? this.setup.players[i] : null;
    return p ? p.name : '';
  }

  sendCommand() {} // a replay takes no orders
  sendChat() {}

  start() {
    if (this.started || this.stopped) return;
    this.started = true;
    if (this.pendingViewer !== -1) this.setViewer(this.pendingViewer);
    if (this.pendingStart > 0) this.seek(this.pendingStart);
    else this.sync();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.ticker.stop();
    this.clock.setRunning(false);
    if (this.seeking && this.seeking.timer) clearTimeout(this.seeking.timer);
    this.seeking = null;
  }

  /** Run `n` ticks now (tests). */
  step(n = 1) {
    if (!this.started) this.start();
    this.ticker.run(n);
  }

  // ------------------------------------------------------------ playback

  /** Ticker and clock follow the state: running exactly while playing. */
  sync() {
    const on = this.playing;
    if (on && this.autoTick && !this.ticker.running) {
      this.viewState.resetClock();
      this.ticker.start();
    } else if (!on && this.ticker.running) this.ticker.stop();
    this.clock.setRunning(on);
    this.emitChange();
  }

  setPaused(on) {
    this.userPaused = !!on;
    this.sync();
  }

  togglePause() {
    if (this.ended) {
      this.restart();
      return;
    }
    this.setPaused(!this.userPaused);
  }

  /** The in-game menu holds playback while it is open (the player's own pause is kept apart). */
  hold(on) {
    this.holdPaused = !!on;
    this.sync();
  }

  setSpeed(s) {
    if (!REPLAY_SPEEDS.includes(s) || s === this.speed) return;
    this.speed = s;
    this.clock.setSpeed(s);
    this.ticker.maxCatchUp = this.catchUp();
    this.ticker.setSpeed(s);
    this.viewState.resetClock();
    this.emitChange();
  }

  /** One step up or down REPLAY_SPEEDS. */
  nudgeSpeed(dir) {
    const i = REPLAY_SPEEDS.indexOf(this.speed);
    const j = Math.max(0, Math.min(REPLAY_SPEEDS.length - 1, i + Math.sign(dir)));
    this.setSpeed(REPLAY_SPEEDS[j]);
  }

  /** Whose eyes the view uses: a player index, or -1 for everything. */
  setViewer(i) {
    this.viewState.setViewer(i);
    this.myIndex = this.viewState.myIndex;
    this.emitChange();
  }

  /** From the start again (the replay bar's play button after the end; the Game builds a new session). */
  restart() {
    if (this.onRestart) this.onRestart(0);
  }

  tickOnce() {
    const w = this.world;
    if (w.tickCount >= this.length) {
      this.finish();
      return;
    }
    const cmds = this.record.cmds;
    while (this.cmdAt < cmds.length && cmds[this.cmdAt][0] <= w.tickCount) {
      const [, p, c] = cmds[this.cmdAt++];
      try {
        w.issueCommand(p, c);
      } catch (err) {
        this.report(err);
      }
    }
    try {
      w.tick();
    } catch (err) {
      this.report(err);
    }
    this.check();
    this.ticksSinceSnap++;
    if (w.tickCount >= this.length) this.finish();
  }

  /** Compare the world with the recorded checksum of this tick, if there is one. */
  check() {
    const sums = this.record.sums;
    const t = this.world.tickCount;
    while (this.sumAt < sums.length && sums[this.sumAt][0] < t) this.sumAt++;
    if (this.sumAt >= sums.length || sums[this.sumAt][0] !== t) return;
    const want = sums[this.sumAt++][1];
    if (this.drift !== null) return;
    if (worldChecksum(this.world) === want) this.checked++;
    else {
      this.drift = t;
      this.emitChange();
    }
  }

  report(err) {
    this.errors++;
    if (this.errors <= 5) console.error('[replay] tick failed', err);
  }

  afterTicks() {
    if (this.stopped) return;
    if (this.ticksSinceSnap >= this.snapEvery() || this.ended) this.takeSnapshot();
    this.emitChange();
  }

  /** The chat lines up to the current tick. */
  playChat() {
    const lines = this.record.chat || [];
    const t = this.world.tickCount;
    while (this.chatAt < lines.length && lines[this.chatAt][0] <= t) {
      const [, from, text, voice, system] = lines[this.chatAt++];
      const line = { from, name: system ? '' : this.playerName(from), text, system: !!system, voice: !!voice };
      this.chatLog.push(line);
      if (this.chatLog.length > 100) this.chatLog.shift();
      if (this.seeking) continue; // a jump skips the talk on the way
      for (const cb of [...this.chatCbs]) {
        try {
          cb(line);
        } catch (err) {
          console.error('[replay] chat listener failed', err);
        }
      }
    }
  }

  takeSnapshot(extra = null) {
    let snap;
    try {
      snap = this.world.getSnapshot();
    } catch (err) {
      this.report(err);
      return null;
    }
    this.ticksSinceSnap = 0;
    this.viewState.pushSnapshot(snap, now(), extra);
    this.playChat();
    return snap;
  }

  finish() {
    if (this.ended) return;
    this.ended = true;
    this.ticker.stop();
    this.clock.setRunning(false);
    this.emitChange();
  }

  /**
   * Jump to a tick at or after the current one (the Game starts a new session for one before it).
   * The ticks run in slices; the view gets one full snapshot at the end.
   */
  seek(target) {
    if (this.stopped) return;
    const to = Math.max(this.world.tickCount, Math.min(this.length, Math.floor(target)));
    if (this.seeking) {
      this.seeking.target = Math.max(this.seeking.target, to);
      return;
    }
    if (to <= this.world.tickCount) return;
    this.seeking = { target: to, timer: null, from: this.world.tickCount };
    this.sync();
    const slice = () => {
      if (this.stopped || !this.seeking) return;
      const w = this.world;
      const t0 = now();
      while (w.tickCount < this.seeking.target && now() - t0 < SEEK_SLICE_MS) {
        this.tickOnce();
        // Nothing of the skipped stretch is shown: drop its events as they come.
        w.events.length = 0;
        if (this.ended) break;
      }
      this.playChat(); // (quietly: the talk of the skipped stretch goes to the log only)
      if (w.tickCount < this.seeking.target && !this.ended) {
        this.emitChange();
        this.seeking.timer = setTimeout(slice, 0);
        return;
      }
      this.seeking = null;
      this.viewState.resetClock();
      // The trees felled on the way fall at once (sync), as for a client that joins late.
      this.takeSnapshot({ felledAll: w.felledAll });
      this.sync();
    };
    slice();
  }

  /** Seek progress 0..1 while a jump runs (the replay bar), else null. */
  seekProgress() {
    const s = this.seeking;
    if (!s) return null;
    const span = Math.max(1, s.target - s.from);
    return Math.max(0, Math.min(1, (this.world.tickCount - s.from) / span));
  }
}
