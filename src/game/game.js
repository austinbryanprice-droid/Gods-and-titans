// Game controller (DESIGN 11): builds the session (HostSession with the World
// and AIs, or ClientSession), the 3D renderer, the HUD and the input
// controller; runs the frame loop; turns view-state events into sounds and HUD
// messages; handles waiting for the host, pause in single player, game over,
// the host leaving, chat, and a full teardown back to the menu.
//
//   const game = new Game({ launch, settings, onExit });   // launch from the menu
//   await game.ready;                                      // view is up
//   game.quitToMenu();                                     // teardown + onExit()
import { HostSession, ClientSession } from '../net/session.js';
import { createWorld } from '../sim/world.js';
import { getSettings, onSettingsChange } from '../settings.js';
import { sfx } from '../audio/sfx.js';
import { PEACE_NAME } from '../config.js';
import { edgeName } from '../sim/survival.js';
import { UNITS, BUILDINGS } from '../data/index.js';
import { MARKS, MARK_SEND_RATE } from '../data/marks.js';
import { Hud } from '../ui/hud.js';
import { Overlays } from '../ui/hud-overlays.js';
import { el } from '../ui/hud-dom.js';
import { InputController } from '../ui/input.js';
import { Selection } from '../ui/hud-selection.js';
import { tierName, RESOURCE_ICONS } from '../ui/hud-data.js';
import { loadingHint, hintParts } from '../ui/hint-data.js';
import { TabAttention } from '../ui/tab-attention.js';
import { AlertEngine } from './alerts.js';
import { Chronicle } from './chronicle.js';
import { MusicDirector } from './music-director.js';
import { music } from '../audio/music.js';
import { MSG, REASONS, RateLimiter, sanitizeName, sanitizeReason } from '../net/protocol.js';
import { TeamMarks } from './team-marks.js';
import { CareerTracker } from './career-tracker.js';
import { getCareer } from './career.js';

const AMBIENT_MS = 800; // worker chop / mine / build sounds near the camera
const BREACH_MESSAGE_MS = 6000; // between two "wall breached" messages
const AMBIENT_REACH = 16; // tiles from the camera target at the default zoom
const MAX_DT = 0.1;
const MAX_ERRORS = 20; // frame faults kept in game.errors (a fault that repeats every frame must not pile up)
const SPELL_SOUNDS = { lightning: 'lightning', fire: 'fire', sun: 'fire' };
const PROJECTILE_SOUNDS = { arrow: 'attack_ranged', spear: 'attack_ranged', rock: 'attack_ranged', feather: 'attack_ranged', leaf: 'attack_ranged', ice: 'attack_ranged', bolt: 'lightning', fireball: 'fire', sunray: 'fire' };

/**
 * `?tod=night` (or golden, day, dusk, dawn, cycle, or an hour such as 18.5) on the page's
 * address holds that time of day for this page load, whatever the setting says: for screenshots
 * and for looking at one light on purpose. Null when absent.
 */
export function queryTimeOfDay() {
  try {
    const v = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('tod') : null;
    return v ? v.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Each match draws on a new copy of the page's canvas, so it starts with a fresh
 * WebGL context (the old one is freed when its renderer is disposed).
 */
function freshCanvas(old) {
  if (!old || typeof old.cloneNode !== 'function' || typeof old.replaceWith !== 'function') return old;
  const canvas = old.cloneNode(false);
  old.replaceWith(canvas);
  return canvas;
}

// In a browser, fetch the renderer's code (Three.js and the models, about 3 MB) in an idle
// moment once this module is in (main.js loads it while the player is in the menu), so Start
// does not sit on an empty screen waiting for it. A failure is ignored: init() asks again.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const warm = () => import('../render/game-renderer.js').catch(() => {});
  if (typeof requestIdleCallback === 'function') requestIdleCallback(warm, { timeout: 4000 });
  else setTimeout(warm, 1500);
}

const GRAPHICS_FAILURE = /webgl|rendering context|getcontext|shader|framebuffer/i;
const LOADING_FAILURE = /dynamically imported module|importing a module script|failed to fetch|networkerror|load failed/i;

/**
 * What the player sees when a match cannot start: a sentence in plain words
 * and the raw message (one short line, for bug reports).
 * @returns {{ text: string, detail: string }}
 */
export function describeStartFailure(err) {
  const detail = sanitizeReason(err && err.message ? err.message : err, '');
  let text = 'Something went wrong while setting up the match. Go back to the menu and try again; if it keeps happening, reload the page.';
  if (GRAPHICS_FAILURE.test(detail)) text = 'Your browser could not start 3D graphics. Check that hardware acceleration is on, or try another browser.';
  else if (LOADING_FAILURE.test(detail)) text = 'Some of the game files could not be loaded. Check your internet connection and reload the page.';
  return { text, detail };
}

/** The loading screen's tip: "Tip: …" with the keys drawn as <kbd>. */
function loadingTip(text) {
  const p = document.createElement('p');
  p.style.cssText = 'max-width:36em;margin:0;padding:0 1em;text-align:center;font:italic 400 16px/1.5 var(--mw-font-body);'
    + 'letter-spacing:0;text-transform:none;color:var(--mw-ink-dim)';
  p.append('Tip: ', ...hintParts(text).map((part) => {
    if (typeof part === 'string') return part;
    const key = document.createElement('kbd');
    key.textContent = part.key;
    return key;
  }));
  return p;
}

/** AI players that never move: for clients, which run no AI, and the fallback when the AI module is missing. */
const idleAI = () => ({ tick() {} });

/** The AI module's { createAI, createVoices }, or null when src/ai/ai.js cannot be loaded. */
async function loadAI() {
  try {
    const mod = await import('../ai/ai.js');
    if (typeof mod.createAI === 'function') return { createAI: mod.createAI, createVoices: typeof mod.createVoices === 'function' ? mod.createVoices : null };
    console.warn('[game] src/ai/ai.js has no createAI; AI players will stand still.');
  } catch (err) {
    console.warn('[game] AI module unavailable; AI players will stand still.', err && err.message ? err.message : err);
  }
  return null;
}

/** Is a chat line shown? An AI's in-character line (DESIGN 10.1) only while the AI chatter setting is on. */
export function showChatLine(line) {
  return !(line && line.voice) || getSettings().aiChat !== false;
}

/** A single-player match: this machine hosts it and nobody else is connected. */
function isSolo(s) {
  return !!(s && s.isHost && s.ticker && (!s.clients || s.clients.size === 0) && !s.stopped);
}

/** Let the browser paint once (a timer covers a hidden tab, where frames do not run). */
function nextPaint() {
  return new Promise((resolve) => {
    const fallback = setTimeout(resolve, 100);
    if (typeof requestAnimationFrame !== 'function') return;
    requestAnimationFrame(() => {
      setTimeout(() => {
        clearTimeout(fallback);
        resolve();
      }, 0);
    });
  });
}

/**
 * How much farther sounds carry than at the default zoom: with the camera pulled
 * back, more of the map is on screen, so a fight at the top edge must stay audible
 * (it keeps growing past the old far limit, up to 4.5: sounds carry 135 tiles, across a whole medium map).
 */
export function hearingScale(cam) {
  const base = (cam && cam.opts && cam.opts.defaultDistance) || 25;
  const k = cam && Number.isFinite(cam.distance) ? cam.distance / base : 1;
  return Math.max(0.8, Math.min(4.5, k));
}

/**
 * Sound and volume for a spell effect. Heals, quakes, meteors and storms are told
 * apart by their shape (most abilities would otherwise share the sparkling 'magic'
 * chime); the rest by element. The healing bells are for heals, buffs and shields only.
 */
export function effectSound(ev) {
  switch (ev.shape) {
    case 'heal':
      return ['heal', 1];
    case 'quake':
      return ['lightning', 0.6]; // its low rumble, without the full crack
    case 'meteor':
      return ['fire', 1];
    case 'storm':
      return ['lightning', ev.el === 'lightning' ? 1 : 0.6];
    default:
      break;
  }
  if (ev.el === 'holy') return [ev.shape === 'buff' || ev.shape === 'shield' ? 'heal' : 'magic', 1];
  return [SPELL_SOUNDS[ev.el] || 'magic', 1];
}

export class Game {
  /**
   * @param {object} o
   * @param {object} [o.launch] from the menu: { role: 'host'|'client', setup, myIndex, conns | conn, lobby }
   * @param {object} [o.session] an already built HostSession / ClientSession (instead of launch)
   * @param {object} [o.settings] getSettings()
   * @param {() => void} [o.onExit] called after teardown (main.js shows the menu)
   * @param {HTMLElement} [o.root] #game-root (with #game-canvas and #hud-root)
   * @param {Function} [o.createAI] override the AI factory (tests)
   * @param {Function} [o.createVoices] the AIs' chat lines with that override (tests; src/ai/voice.js)
   * @param {Function} [o.Renderer] override the renderer class (tests)
   */
  constructor({ launch = null, session = null, settings = null, onExit = null, root = null, createAI = null, createVoices = null, Renderer = null } = {}) {
    this.launch = launch;
    this.session = session;
    this.settings = settings || getSettings();
    this.onExit = onExit;
    this.root = root || document.getElementById('game-root');
    this.canvas = freshCanvas(this.root.querySelector('#game-canvas') || this.root.querySelector('canvas'));
    this.hudRoot = this.root.querySelector('#hud-root');
    this.renderer = null;
    this.hud = null;
    this.input = null;
    this.selection = null;
    this.viewState = null;
    this.marks = new TeamMarks(); // the pings and markers standing on this screen (mine and my teammates')
    this.markLimit = new RateLimiter(...MARK_SEND_RATE);
    this.raf = 0;
    this.lastFrame = 0;
    this.disposed = false;
    this.paused = false;
    this.showAllBarsHeld = false;
    this.overShown = false;
    this.ended = false;
    this.defeatSounded = false;
    this.loadingEl = null;
    this.failed = false;
    this.bareHud = false;
    this.tab = null; // TabAttention: the flashing title of a tab left in the background
    this.alerts = null; // AlertEngine
    this.chronicle = null; // Chronicle: the match's numbers over time, for the game-over screen
    this.director = null; // MusicDirector: the match's tension, as the music's intensity
    this.career = null; // CareerTracker: this match's facts for the career and the achievements
    this.offs = [];
    this.lastAmbient = 0;
    this.lastBreach = -BREACH_MESSAGE_MS;
    this.stats = { frames: 0, cpuMs: 0, maxMs: 0, renderMs: 0, hudMs: 0, last: [] };
    this.errors = [];
    if (typeof window !== 'undefined') window.__game = this;
    this.ready = this.init({ createAI, createVoices, Renderer }).catch((err) => {
      console.error('[game] failed to start', err);
      this.fail(err);
      throw err;
    });
    this.ready.catch(() => {});
  }

  get myIndex() {
    return this.session ? this.session.myIndex : -1;
  }

  get setup() {
    return this.session ? this.session.setup : null;
  }

  // ---------------------------------------------------------------- startup

  async init({ createAI, createVoices, Renderer }) {
    this.root.hidden = false;
    this.setLoading(true);
    // Only a launch that runs the match here needs the AI module (a client's host runs the AIs).
    const needsAI = !createAI && !this.session && !(this.launch && this.launch.role === 'client');
    const [loadedAI, RendererClass] = await Promise.all([
      createAI ? Promise.resolve({ createAI, createVoices }) : needsAI ? loadAI() : Promise.resolve({ createAI: idleAI, createVoices: null }),
      Renderer ? Promise.resolve(Renderer) : import('../render/game-renderer.js').then((m) => m.GameRenderer),
    ]);
    if (this.disposed) return;
    const aiFailed = needsAI && !loadedAI;
    const aiFactory = (loadedAI && loadedAI.createAI) || idleAI;
    const voiceFactory = (loadedAI && loadedAI.createVoices) || null;

    if (!this.session) {
      const l = this.launch;
      if (!l || !l.setup) throw new Error('Game needs a launch or a session.');
      if (l.role === 'client') this.session = new ClientSession({ setup: l.setup, myIndex: l.myIndex, conn: l.conn });
      else this.session = new HostSession({ setup: l.setup, myIndex: l.myIndex ?? 0, conns: l.conns || new Map(), createWorld, createAI: aiFactory, createVoices: voiceFactory });
    }
    const session = this.session;
    this.viewState = session.viewState;
    this.selection = new Selection(this.viewState);

    this.hud = new Hud({ root: this.hudRoot, game: this });
    if (session.mapMismatch) this.hud.setMapMismatch(true);
    this.offs.push(session.onChat((line) => this.onChat(line)));
    if (typeof session.onMark === 'function') this.offs.push(session.onMark((mark) => this.onMark(mark)));
    this.offs.push(session.onEnd((info) => this.onEnd(info)));
    this.offs.push(this.viewState.on('*', (ev) => this.onEvent(ev)));
    // Reminders and warnings beyond the events above (src/game/alerts.js), and the tab flash for a player who looked away.
    this.tab = new TabAttention();
    this.alerts = new AlertEngine({ viewState: this.viewState, notify: (alert) => this.onAlert(alert) }).attach();
    // Score, army, resources and kills every 30 s of game time, for the game-over screen's timeline (src/game/chronicle.js).
    this.chronicle = new Chronicle({ viewState: this.viewState }).attach();
    this.offs.push(() => {
      this.alerts.dispose();
      this.chronicle.dispose();
      this.tab.dispose();
    });
    // The career and achievements on this device (src/game/career-tracker.js): nothing goes over the wire.
    this.career = new CareerTracker({ viewState: this.viewState, setup: session.setup, onUnlock: (list) => this.onAchievements(list) }).attach();
    this.offs.push(() => this.career.dispose());
    // The score of the player's pantheon, calm while building and rising with the fighting (src/game/music-director.js).
    this.director = new MusicDirector({ viewState: this.viewState, music }).attach();
    this.offs.push(() => this.director.dispose());
    this.offs.push(onSettingsChange((s, changed) => this.onSettings(s, changed)));
    for (const line of session.chatLog || []) if (showChatLine(line)) this.hud.chat(line);
    session.start();

    // Clients wait for the first full snapshot.
    if (!session.isHost && !this.viewState.snapshot) {
      this.setLoading(false);
      this.hud.overlays.showWaiting();
      await new Promise((resolve) => {
        if (typeof session.onReady === 'function') session.onReady(resolve);
        else session.ready.then(resolve);
        this.offs.push(session.onEnd(() => resolve()));
      });
      if (this.disposed || this.ended) return;
      this.hud.overlays.hideWaiting();
      this.setLoading(true);
    }

    // The renderer builds its scene in one synchronous go (shader compile, models):
    // let the loading text reach the screen first.
    if (this.loadingEl) await nextPaint();
    if (this.disposed) return;
    const tr = performance.now();
    this.renderer = new RendererClass(this.canvas, { viewState: this.viewState, setup: session.setup, quality: this.settings.quality, timeOfDay: queryTimeOfDay() || this.settings.timeOfDay });
    this.stats.rendererInitMs = performance.now() - tr;
    this.setLoading(false);
    this.resize();
    this.applyShowAllBars();
    this.centerOnStart();
    this.input = new InputController({ game: this, canvas: this.canvas, overlayRoot: this.hudRoot });
    this.selection.onChange(() => this.renderer && this.renderer.setSelection(this.selection.ids));

    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    this.offs.push(() => window.removeEventListener('resize', onResize));
    this.watchPixelRatio();
    this.watchVisibility();
    if (aiFailed) this.hud.showBanner('The AI failed to load: computer players will not move.', 'danger');
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /** "Preparing the battlefield…" over the empty canvas while the renderer's code loads and its scene builds. */
  setLoading(on) {
    if (!on) {
      if (this.loadingEl) this.loadingEl.remove();
      this.loadingEl = null;
      return;
    }
    const root = this.root;
    if (this.loadingEl || typeof document === 'undefined' || !root || typeof root.appendChild !== 'function') return;
    const node = document.createElement('div');
    node.setAttribute('role', 'status');
    node.style.cssText = 'position:absolute;inset:0;z-index:6;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.6em;'
      + 'font:600 18px/1.4 var(--mw-font-display);letter-spacing:0.3em;text-transform:uppercase;color:var(--mw-gold);'
      + 'background:radial-gradient(ellipse at 50% 40%,#121a33,#05070d 70%)';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:0.9em';
    const spin = document.createElement('span');
    spin.className = 'hud-spinner';
    const text = document.createElement('span');
    text.textContent = 'Preparing the battlefield…';
    row.append(spin, text);
    node.append(row);
    const tip = getSettings().hints ? loadingHint() : null;
    if (tip) node.append(loadingTip(tip.text));
    root.appendChild(node);
    this.loadingEl = node;
  }

  /**
   * Startup failed: tell the other players at once, then say why in plain words
   * (no results table: no match was played) with a way back to the menu.
   */
  fail(err) {
    this.errors.push(err);
    this.setLoading(false);
    if (this.disposed) return;
    this.releasePlayers();
    try {
      if (!this.hud && this.viewState) this.hud = new Hud({ root: this.hudRoot, game: this });
      const overlays = this.hud ? this.hud.overlays : this.bareOverlays();
      const { text, detail } = describeStartFailure(err);
      const back = el('button', 'mw-btn hud-obtn mw-btn--primary', 'Return to Menu');
      back.type = 'button';
      back.addEventListener('click', (e) => {
        e.stopPropagation();
        sfx.play('click');
        this.quitToMenu();
      });
      const raw = detail ? el('div', 'hud-ohint hud-startfail-raw', detail) : null;
      if (raw) raw.style.userSelect = 'text'; // the HUD is not selectable; this line is for copying into a bug report
      const node = overlays.panel('Could not start the game', text, raw, el('div', 'hud-obtns', back));
      overlays.show('ended', node, null); // 'ended' also keeps F10 from opening the game menu over it
    } catch {
      this.quitToMenu();
    }
  }

  /**
   * A failed start must not leave the other players waiting: stop the session
   * (hosts tell their clients the game is over; a client leaves, so an AI takes
   * over its army) or, if it was never built, close the lobby connections the
   * launch handed over. Closing twice is harmless.
   */
  releasePlayers() {
    if (this.failed) return;
    this.failed = true;
    try {
      if (this.session) {
        this.session.stop();
        return;
      }
      const l = this.launch;
      if (!l) return;
      const hosting = l.role !== 'client';
      const conns = [l.conn, ...(l.conns && typeof l.conns.values === 'function' ? l.conns.values() : [])];
      for (const conn of conns) {
        if (!conn || typeof conn.close !== 'function') continue;
        try {
          if (hosting && typeof conn.send === 'function') conn.send({ t: MSG.END, reason: REASONS.HOST_QUIT });
        } catch {
          // already gone
        }
        try {
          conn.close(hosting ? 'end' : 'quit');
        } catch {
          // already gone
        }
      }
    } catch (err) {
      console.warn('[game] releasing the other players failed', err);
    }
  }

  /** Overlays for a failure before the HUD could be built (no view state yet). */
  bareOverlays() {
    const layer = el('div', 'hud-overlays');
    this.hudRoot.classList.add('hud');
    this.hudRoot.appendChild(layer);
    this.bareHud = true;
    return new Overlays(layer, this);
  }

  centerOnStart() {
    const vs = this.viewState;
    let best = null;
    for (const e of vs.entities.values()) {
      if (e.o !== vs.myIndex) continue;
      if (e.k === 'b' && e.t === 'town_center') {
        best = e;
        break;
      }
      if (!best) best = e;
    }
    if (best && this.renderer) this.renderer.camera.centerOn(best.x, best.y + (best.k === 'b' ? 1.5 : 0));
  }

  /** Moving the window to a screen with another devicePixelRatio fires no resize: watch for it. */
  watchPixelRatio() {
    if (typeof window.matchMedia !== 'function') return;
    let mq = null;
    const onChange = () => {
      this.resize();
      listen();
    };
    const listen = () => {
      if (mq) mq.removeEventListener('change', onChange);
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
      else mq = null;
    };
    listen();
    this.offs.push(() => mq && mq.removeEventListener('change', onChange));
  }

  /**
   * A single-player match has nobody to wait for, but its ticker runs in a Worker and so
   * keeps simulating in a hidden tab, where the HUD and the alerts stand still: open the
   * game menu (which pauses) when the tab is hidden.
   */
  watchVisibility() {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    const onChange = () => {
      if (!document.hidden || this.disposed || this.ended || this.paused || !this.hud) return;
      const vs = this.viewState;
      if (!isSolo(this.session) || vs.gameOver || (vs.me && vs.me.defeated) || this.hud.overlays.open) return;
      this.hud.overlays.openMenu();
    };
    document.addEventListener('visibilitychange', onChange);
    this.offs.push(() => document.removeEventListener('visibilitychange', onChange));
    onChange(); // the tab may already be hidden: the player switched away while the match was loading
  }

  resize() {
    if (!this.renderer) return;
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    this.renderer.resize(w, h);
    this.needsRender = true;
  }

  // ---------------------------------------------------------------- loop

  frame(now) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(MAX_DT, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    const t0 = performance.now();
    // Each stage has its own guard: a fault in one (the renderer choking on an odd
    // entity, say) must not freeze the HUD or hold back the victory / defeat screen.
    try {
      // Paused (single player, F10 menu): the world is frozen, so the last
      // picture stays on the canvas; redraw only after a resize or option change.
      if (!this.paused || this.needsRender) {
        this.needsRender = false;
        this.viewState.update(now);
        this.selection.prune();
        this.input.update(dt);
        this.renderer.update(this.paused ? 0 : dt);
        this.renderer.render(now);
      }
    } catch (err) {
      this.frameFault(err);
    }
    const t1 = performance.now();
    try {
      this.hud.update(now);
    } catch (err) {
      this.frameFault(err);
    }
    try {
      this.checkEnd();
    } catch (err) {
      this.frameFault(err);
    }
    try {
      const cam = this.renderer.camera;
      if (cam && cam.target) sfx.setListener(cam.target.x, cam.target.y, hearingScale(cam));
      this.ambientSounds(now);
    } catch (err) {
      this.frameFault(err);
    }
    try {
      if (this.director) this.director.update(dt);
    } catch (err) {
      this.frameFault(err);
    }
    const t2 = performance.now();
    const st = this.stats;
    const cpu = t2 - t0;
    st.frames++;
    st.cpuMs += cpu;
    st.renderMs += t1 - t0;
    st.hudMs += t2 - t1;
    if (cpu > st.maxMs) st.maxMs = cpu;
    st.last.push(cpu);
    if (st.last.length > 120) st.last.shift();
  }

  /** Keep a frame fault for the play-test (the first few go to the console too). */
  frameFault(err) {
    if (this.errors.length < MAX_ERRORS) this.errors.push(err);
    if (this.errors.length <= 5) console.error('[game] frame failed', err);
  }

  /** Frame timing summary (play-test). */
  timing() {
    const st = this.stats;
    const n = Math.max(1, st.frames);
    const recent = [...st.last].sort((a, b) => a - b);
    return {
      frames: st.frames,
      avgCpuMs: st.cpuMs / n,
      avgRenderMs: st.renderMs / n,
      avgHudMs: st.hudMs / n,
      maxCpuMs: st.maxMs,
      rendererInitMs: st.rendererInitMs || 0,
      p95RecentMs: recent.length ? recent[Math.floor(recent.length * 0.95)] : 0,
    };
  }

  // ---------------------------------------------------------------- actions

  /** Send a command for the local player. */
  command(cmd) {
    if (this.disposed || !this.session || this.ended) return;
    const me = this.viewState && this.viewState.me;
    if (me && me.defeated) return;
    this.session.sendCommand(cmd);
  }

  sendChat(text) {
    if (this.session && !this.ended) this.session.sendChat(text);
  }

  /**
   * Ping or mark a spot for my team (DESIGN 9). The session shows it here at once and, when I have
   * teammates, tells only them. Returns false when it was not sent: too many in a row (the same pace
   * the host would drop at, so a mark I see is a mark my team sees), or the match is over.
   * @param {string} kind a key of MARKS
   * @param {number} x tile
   * @param {number} y tile
   */
  sendMark(kind, x, y) {
    const s = this.session;
    if (this.disposed || !s || this.ended || typeof s.sendMark !== 'function' || !Object.hasOwn(MARKS, kind)) return false;
    if (!this.markLimit.take()) {
      if (this.hud) this.hud.message('Slow down: too many pings.', 'error');
      return false;
    }
    return !!s.sendMark({ kind, x, y });
  }

  surrender() {
    this.command({ type: 'surrender' });
  }

  /** Pause the simulation (single player only). Returns true if the game is paused. */
  setPaused(on) {
    const s = this.session;
    if (!isSolo(s)) return false;
    if (on && !this.paused) {
      s.ticker.stop();
      this.paused = true;
    } else if (!on && this.paused) {
      this.paused = false;
      // Sim time stood still while local time ran on: re-anchor the playback clock, or
      // the view would render ahead of its newest snapshot (no interpolation) for a while.
      if (this.viewState) this.viewState.resetClock();
      if (!s.stopped) s.ticker.start();
    }
    return this.paused;
  }

  /** Alt held (or the setting) shows every health bar. */
  setShowAllBars(held) {
    this.showAllBarsHeld = !!held;
    this.applyShowAllBars();
  }

  applyShowAllBars() {
    const r = this.renderer;
    if (!r) return;
    const on = this.showAllBarsHeld || !!getSettings().showAllBars;
    if (typeof r.setShowAllBars === 'function') r.setShowAllBars(on);
    else r.showAllBars = on;
    this.needsRender = true;
  }

  onSettings(s, changed) {
    this.settings = s;
    if (changed.includes('showAllBars')) this.applyShowAllBars();
    if (changed.includes('quality') && this.renderer && typeof this.renderer.setQuality === 'function') {
      this.renderer.setQuality(s.quality);
      this.needsRender = true;
    }
    if (changed.includes('timeOfDay') && this.renderer && typeof this.renderer.setTimeOfDay === 'function') {
      this.renderer.setTimeOfDay(s.timeOfDay);
      this.needsRender = true;
    }
  }

  // ---------------------------------------------------------------- events

  onChat(line) {
    if (!this.hud || !showChatLine(line)) return;
    this.hud.chat(line);
    if (!line.system && line.from !== this.myIndex) sfx.play('select', { volume: 0.6 });
  }

  /**
   * A ping or marker from my team (or my own, echoed by the session): stand it up and chime. A teammate's
   * marker also says its words in the message area, in their colour, for a player with the sound off.
   */
  onMark(mark) {
    if (this.disposed || !this.hud || !mark) return;
    const placed = this.marks.add(mark);
    if (!placed) return;
    const def = MARKS[placed.kind];
    const own = placed.from === this.myIndex;
    sfx.play(def.urgent ? 'ping_urgent' : 'ping', { volume: own ? 0.5 : 1 });
    if (!own && def.id !== 'ping') this.hud.chat({ from: placed.from, name: mark.name, text: def.text });
  }

  onEnd({ reason } = {}) {
    if (this.disposed) return;
    this.ended = true;
    this.setLoading(false);
    if (!this.hud) return;
    if (this.overShown && (reason === 'game-over' || reason === 'host-quit')) {
      this.hud.message('The host has closed the game.', 'system');
      return;
    }
    this.hud.overlays.showEnded(reason);
  }

  checkEnd() {
    const vs = this.viewState;
    if (vs.gameOver && !this.overShown) {
      this.overShown = true;
      const wt = vs.gameOver.winningTeam;
      const survival = typeof vs.survivalActive === 'function' && vs.survivalActive();
      const result = survival ? 'survival' : wt === null || wt === undefined ? 'draw' : wt === vs.myTeam ? 'victory' : 'defeat';
      // Trial of the Titans: the score is the wave reached; the career keeps the best (best.wave) for players who took part.
      const wave = survival ? (Number.isInteger(vs.gameOver.wave) ? vs.gameOver.wave : (vs.survival() || {}).wave || 0) : 0;
      const previous = survival ? getCareer().best.wave : 0;
      if (this.input) this.input.cancelMode();
      const unlocked = this.career ? this.career.finish(result, survival ? { wave } : null) : null;
      const record = survival && unlocked ? { best: Math.max(previous, wave), previous, isNew: wave > previous } : null;
      // (A defeat already heard when the local player fell is not played again.)
      if (result === 'victory') sfx.play('victory');
      else if (!this.defeatSounded) sfx.play('defeat');
      // Give the last explosions a moment before the screen.
      setTimeout(() => {
        if (!this.disposed) this.hud.overlays.showGameOver({ result, winningTeam: wt, unlocked, how: vs.gameOver.how, wave, record });
      }, 1200);
    } else if (!vs.gameOver && vs.me && vs.me.defeated && !this.hud.overlays.defeatShown) {
      if (this.input) this.input.cancelMode();
      this.defeatSounded = true;
      sfx.play('defeat');
      this.hud.overlays.showDefeated();
    }
  }

  entityPos(id) {
    const e = id ? this.viewState.entities.get(id) : null;
    return e ? { x: e.ix ?? e.x, y: e.iy ?? e.y, e } : null;
  }

  /** World sound only if the spot is visible to the local player. */
  worldSound(name, x, y, volume = 1) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!this.viewState.isVisibleAt(x, y)) return;
    sfx.play(name, { x, y, volume });
  }

  playerName(i) {
    if (!Number.isInteger(i) || i < 0) return 'A player';
    const p = this.viewState.players[i] || (this.setup && this.setup.players[i]);
    return sanitizeName(p && p.name, `Player ${i + 1}`);
  }

  onEvent(ev) {
    if (this.disposed || !this.hud) return;
    const vs = this.viewState;
    const me = vs.myIndex;
    const hud = this.hud;
    switch (ev.type) {
      case 'error':
        if (ev.player === me) {
          hud.message(ev.message, 'error');
          sfx.play('error');
        }
        break;
      case 'underAttack': {
        if (ev.player !== me) break;
        const e = vs.entities.get(ev.id);
        const base = e && e.k === 'b';
        hud.message(base ? 'Your base is under attack!  [[Space]]' : 'Your forces are under attack!  [[Space]]', 'alert', { icon: '⚔️' });
        sfx.play('horn');
        hud.minimap.ping(ev.x, ev.y, '#ff3a2a');
        if (this.input) this.input.noteAlert(ev.x, ev.y);
        break;
      }
      case 'titanSummoning': {
        const t = UNITS[ev.t];
        const name = t ? t.name : 'A Titan';
        if (ev.player === me) {
          hud.showBanner(`${name} is being summoned!`, 'titan');
          sfx.play('summon_god', { volume: 0.8 });
        } else {
          hud.showBanner(`${name} is being summoned by ${this.playerName(ev.player)}!`, vs.isAlly(ev.player) ? 'titan' : 'danger');
          // Not the horn: an under-attack horn a moment earlier would lock this warning out.
          sfx.play('summon_titan', { volume: 0.7 });
        }
        break;
      }
      case 'levelUp': {
        const e = vs.entities.get(ev.id);
        if (!e || e.o !== me) break;
        const t = UNITS[e.t];
        hud.message(`${t ? t.name : 'Your god'} reached level ${ev.level}!`, 'good', { icon: t && t.icon });
        sfx.play('tier_up', { volume: 0.55 });
        break;
      }
      case 'rankUp': {
        // Soldiers are promoted all through a fight: a soft chime (no message line), the rank shows over the unit.
        const e = vs.entities.get(ev.id);
        if (e && e.o === me) sfx.play('tier_up', { volume: 0.3 });
        break;
      }
      case 'spawn': {
        if (ev.o !== me) {
          const t = UNITS[ev.t];
          if (t && t.class === 'titan') this.worldSoundAt(ev.id, 'summon_titan');
          break;
        }
        const t = UNITS[ev.t];
        if (!t) break;
        if (t.class === 'god') {
          hud.message(`${t.name}, ${t.title || 'god'}, answers your call!`, 'good', { icon: t.icon });
          sfx.play('summon_god');
        } else if (t.class === 'titan') {
          hud.showBanner(`${t.name} has risen!`, 'titan');
          sfx.play('summon_titan');
        } else if (t.class !== 'minion') {
          sfx.play('train', { volume: t.class === 'worker' ? 0.6 : 0.9 });
        } else this.worldSoundAt(ev.id, 'magic', 0.6);
        break;
      }
      case 'construction':
        if (ev.o === me) this.worldSoundAt(ev.id, 'build');
        break;
      case 'buildingComplete':
        if (ev.o === me) {
          const b = BUILDINGS[ev.t];
          hud.message(`${b ? b.name : 'Building'} completed.`, 'info', { icon: b && b.icon });
          sfx.play('building_complete');
        }
        break;
      case 'tierUp':
        if (ev.player === me) {
          hud.showBanner(`Your ${tierName(ev.tier - 1)} has grown into a ${tierName(ev.tier)}!`, 'good');
          sfx.play('tier_up');
        }
        break;
      case 'trade': {
        const what = `${ev.got} ${ev.res}`;
        if (ev.to === me) {
          hud.message(`${this.playerName(ev.from)} sent you ${what}.`, 'good', { icon: RESOURCE_ICONS[ev.res] });
          sfx.play('mine', { volume: 0.8 });
        } else if (ev.from === me) hud.message(`Sent ${what} to ${this.playerName(ev.to)} (the market kept ${ev.amt - ev.got}).`, 'info', { icon: '⚖️' });
        break;
      }
      case 'playerDefeated':
        if (ev.player !== me) hud.message(`${this.playerName(ev.player)} has been defeated.`, 'system', { icon: '🏳️' });
        break;
      case 'wave': {
        // Trial of the Titans: a wave comes out of the map's edge.
        const from = edgeName(vs.width, vs.height, ev.x, ev.y);
        const boss = ev.boss ? UNITS[ev.boss] : null;
        if (boss) {
          hud.showBanner(`Wave ${ev.n}: ${boss.name} comes from the ${from}!`, 'titan');
          sfx.play('summon_titan', { volume: 0.8 });
        } else {
          hud.showBanner(`Wave ${ev.n}: ${ev.count} monsters come from the ${from}!`, 'danger');
          sfx.play('horn', { volume: 0.7 });
        }
        hud.minimap.ping(ev.x, ev.y, boss ? '#ffc840' : '#ff3a2a');
        if (this.input) this.input.noteAlert(ev.x, ev.y);
        break;
      }
      case 'waveCleared':
        if (vs.me && !vs.me.defeated) {
          hud.message(`Wave ${ev.n} is beaten! The gods reward you with ${ev.gold} gold.`, 'good', { icon: '🐉' });
          sfx.play('tier_up', { volume: 0.6 });
        }
        break;
      case 'peaceEnd':
        hud.showBanner(`The ${PEACE_NAME} is over: war begins!`, 'danger');
        sfx.play('horn');
        break;
      case 'bounty':
        // The renderer shows the floating "+N" gold (or faith).
        if (ev.player === me) this.worldSound('mine', ev.x, ev.y, ev.res === 'f' ? 0.5 : 0.7);
        break;
      case 'resourceDepleted': {
        // The mine has already left the view: where it was comes from the view's memory.
        const m = vs.mineMemory.get(ev.id);
        if (m && vs.isExplored(m.x, m.y)) hud.message('A gold mine has collapsed.', 'info', { icon: '⛏️' });
        break;
      }
      case 'death': {
        // Once defeated, the whole army dies at once: no list of losses under the defeat screen.
        if (ev.o === me && !(vs.me && vs.me.defeated)) {
          const t = ev.k === 'b' ? BUILDINGS[ev.t] : UNITS[ev.t];
          // A wall falls piece by piece: one message for the breach, not one per segment.
          if (ev.k === 'b' && t && t.wall) this.noteBreach(hud);
          else if (ev.k === 'b' && t) hud.message(`Your ${t.name} was destroyed.`, 'alert', { icon: '💥' });
          else if (t && t.class === 'god') hud.message(`${t.name} has fallen! Revive them at a Temple.`, 'alert', { icon: '💀' });
          else if (t && t.class === 'titan') hud.message(`${t.name} has fallen!`, 'alert', { icon: '💀' });
        }
        this.worldSound('death', ev.x, ev.y, ev.k === 'b' ? (BUILDINGS[ev.t] && BUILDINGS[ev.t].wall ? 0.5 : 1) : 0.8);
        break;
      }
      case 'attack':
        if (!ev.ranged) {
          const p = this.entityPos(ev.src);
          if (p) this.worldSound('attack_melee', p.x, p.y);
        }
        break;
      case 'projectile': {
        const name = PROJECTILE_SOUNDS[ev.kind] || 'magic';
        this.worldSound(name, ev.fx, ev.fy, name === 'attack_ranged' ? 1 : 0.6);
        break;
      }
      case 'hit': {
        const p = this.entityPos(ev.dst);
        if (p) this.worldSound('hit', p.x, p.y, 0.8);
        break;
      }
      case 'effect': {
        const [name, volume] = effectSound(ev);
        this.worldSound(name, ev.x, ev.y, volume);
        break;
      }
      default:
        break;
    }
  }

  /** Achievements unlocked while the match runs: one line each, with a chime. */
  onAchievements(list) {
    if (this.disposed || !this.hud) return;
    for (const a of list) this.hud.message(`Achievement unlocked: ${a.name}`, 'good', { icon: a.icon });
    sfx.play('tier_up', { volume: 0.7 });
  }

  /**
   * Leaving before the game-over screen counts in the career as a loss: a player already defeated
   * (whose allies fought on), or one who quits a running match after its first minute. A match the
   * host ended, or one left in its first minute, is not counted.
   */
  countLeave() {
    const vs = this.viewState;
    if (!this.career || !vs || vs.gameOver) return;
    const defeated = !!(vs.me && vs.me.defeated);
    if (defeated || (!this.ended && (vs.time || 0) >= 60)) {
      try {
        // A Trial of the Titans left early counts as a trial that reached its current wave, not a loss.
        const sv = typeof vs.survival === 'function' ? vs.survival() : null;
        if (sv) this.career.finish('survival', { wave: sv.wave });
        else this.career.finish('defeat');
      } catch (err) {
        console.warn('[game] career record failed', err);
      }
    }
  }

  /** "Your wall was breached!" at most once every few seconds while segments fall. */
  noteBreach(hud) {
    const now = performance.now();
    if (now - this.lastBreach < BREACH_MESSAGE_MS) return;
    this.lastBreach = now;
    hud.message('Your wall was breached!', 'alert', { icon: '🧱' });
  }

  /**
   * An alert from the AlertEngine (src/game/alerts.js), already cut down to what the settings allow:
   * its HUD line, sound, minimap ping, the spot Space jumps to, and the flash of a tab left behind.
   */
  onAlert(a) {
    const hud = this.hud;
    if (this.disposed || !hud) return;
    if (a.text) hud.message(a.text, a.kind, { icon: a.icon });
    if (a.sound) sfx.play(a.sound, { volume: a.volume });
    if (a.ping) hud.minimap.ping(a.ping.x, a.ping.y, a.ping.color);
    if (a.jump && this.input) this.input.noteAlert(a.jump.x, a.jump.y);
    if (a.attention && this.tab) this.tab.attention(a.attention);
    // No tip while the player is under pressure (a warning that the settings silenced was never shown).
    if (a.kind === 'alert' && (a.text || a.sound || a.ping || a.jump)) hud.holdHints();
  }

  worldSoundAt(id, name, volume = 1) {
    const p = this.entityPos(id);
    if (p) this.worldSound(name, p.x, p.y, volume);
  }

  /** Occasional chop / mine / hammer / prayer sounds from own workers working near the camera. */
  ambientSounds(now) {
    if (now - this.lastAmbient < AMBIENT_MS || !this.renderer || this.paused) return;
    this.lastAmbient = now;
    const cam = this.renderer.camera;
    if (!cam || !cam.target) return;
    const vs = this.viewState;
    const reach = AMBIENT_REACH * hearingScale(cam);
    const cands = [];
    for (const e of vs.entities.values()) {
      if (e.k !== 'u' || e.o !== vs.myIndex) continue;
      if (e.st !== 'gather' && e.st !== 'build' && e.st !== 'pray') continue;
      // A worker on its way to the tree or mine already has the 'gather' state; it is still
      // moving while the drawn position (ix, iy) trails the newest one.
      if (e.ix !== undefined && Math.abs(e.ix - e.x) + Math.abs(e.iy - e.y) > 0.08) continue;
      const d = Math.hypot(e.x - cam.target.x, e.y - cam.target.y);
      if (d < reach) cands.push(e);
    }
    if (!cands.length) return;
    const e = cands[Math.floor(Math.random() * cands.length)];
    if (e.st === 'pray') {
      if (Math.random() < 0.25) sfx.play('pray', { x: e.x, y: e.y, volume: 0.5 });
    } else if (e.st === 'build') sfx.play('build', { x: e.x, y: e.y, volume: 0.45 });
    else sfx.play(e.tg ? 'mine' : 'chop', { x: e.x, y: e.y, volume: 0.5 });
  }

  // ---------------------------------------------------------------- teardown

  /** Stop everything and free the DOM, listeners, the renderer and the session. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.setLoading(false);
    for (const off of this.offs.splice(0)) {
      try {
        off();
      } catch {
        // ignore
      }
    }
    try {
      if (this.session) this.session.stop();
    } catch (err) {
      console.warn('[game] session.stop failed', err);
    }
    try {
      if (this.input) this.input.dispose();
    } catch (err) {
      console.warn('[game] input.dispose failed', err);
    }
    try {
      if (this.renderer) this.renderer.dispose();
    } catch (err) {
      console.warn('[game] renderer.dispose failed', err);
    }
    try {
      if (this.hud) this.hud.dispose();
    } catch (err) {
      console.warn('[game] hud.dispose failed', err);
    }
    if (this.hudRoot) this.hudRoot.textContent = '';
    if (this.bareHud && this.hudRoot.classList) this.hudRoot.classList.remove('hud');
    if (this.canvas) this.canvas.className = '';
    this.root.hidden = true;
    sfx.setListener(NaN, NaN);
    this.renderer = null;
    this.input = null;
    if (typeof window !== 'undefined' && window.__game === this) window.__game = null;
  }

  /** Leave the match and go back to the title screen. */
  quitToMenu() {
    if (this.disposed) return;
    this.countLeave();
    this.dispose();
    if (this.onExit) this.onExit();
  }
}
