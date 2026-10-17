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
import { UNITS, BUILDINGS } from '../data/index.js';
import { Hud } from '../ui/hud.js';
import { InputController } from '../ui/input.js';
import { Selection } from '../ui/hud-selection.js';
import { tierName } from '../ui/hud-data.js';
import { sanitizeName } from '../net/protocol.js';

const AMBIENT_MS = 800; // worker chop / mine / build sounds near the camera
const MAX_DT = 0.1;
const SPELL_SOUNDS = { lightning: 'lightning', fire: 'fire', sun: 'fire', holy: 'heal' };
const PROJECTILE_SOUNDS = { arrow: 'attack_ranged', spear: 'attack_ranged', rock: 'attack_ranged', feather: 'attack_ranged', leaf: 'attack_ranged', ice: 'attack_ranged', bolt: 'lightning', fireball: 'fire', sunray: 'fire' };

/** Stand-in AI until src/ai/ai.js exists: the AI players stand still. */
const idleAI = () => ({ tick() {} });

async function loadAI() {
  try {
    const mod = await import('../ai/ai.js');
    if (typeof mod.createAI === 'function') return mod.createAI;
    console.warn('[game] src/ai/ai.js has no createAI; AI players will stand still.');
  } catch (err) {
    console.warn('[game] AI module unavailable; AI players will stand still.', err && err.message ? err.message : err);
  }
  return idleAI;
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
   * @param {Function} [o.Renderer] override the renderer class (tests)
   */
  constructor({ launch = null, session = null, settings = null, onExit = null, root = null, createAI = null, Renderer = null } = {}) {
    this.launch = launch;
    this.session = session;
    this.settings = settings || getSettings();
    this.onExit = onExit;
    this.root = root || document.getElementById('game-root');
    this.canvas = this.root.querySelector('#game-canvas') || this.root.querySelector('canvas');
    this.hudRoot = this.root.querySelector('#hud-root');
    this.renderer = null;
    this.hud = null;
    this.input = null;
    this.selection = null;
    this.viewState = null;
    this.raf = 0;
    this.lastFrame = 0;
    this.disposed = false;
    this.paused = false;
    this.showAllBarsHeld = false;
    this.overShown = false;
    this.ended = false;
    this.offs = [];
    this.lastAmbient = 0;
    this.stats = { frames: 0, cpuMs: 0, maxMs: 0, renderMs: 0, hudMs: 0, last: [] };
    this.errors = [];
    if (typeof window !== 'undefined') window.__game = this;
    this.ready = this.init({ createAI, Renderer }).catch((err) => {
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

  async init({ createAI, Renderer }) {
    this.root.hidden = false;
    const [aiFactory, RendererClass] = await Promise.all([
      createAI ? Promise.resolve(createAI) : this.session ? Promise.resolve(idleAI) : loadAI(),
      Renderer ? Promise.resolve(Renderer) : import('../render/game-renderer.js').then((m) => m.GameRenderer),
    ]);
    if (this.disposed) return;

    if (!this.session) {
      const l = this.launch;
      if (!l || !l.setup) throw new Error('Game needs a launch or a session.');
      if (l.role === 'client') this.session = new ClientSession({ setup: l.setup, myIndex: l.myIndex, conn: l.conn });
      else this.session = new HostSession({ setup: l.setup, myIndex: l.myIndex ?? 0, conns: l.conns || new Map(), createWorld, createAI: aiFactory });
    }
    const session = this.session;
    this.viewState = session.viewState;
    this.selection = new Selection(this.viewState);

    this.hud = new Hud({ root: this.hudRoot, game: this });
    if (session.mapMismatch) this.hud.setMapMismatch(true);
    this.offs.push(session.onChat((line) => this.onChat(line)));
    this.offs.push(session.onEnd((info) => this.onEnd(info)));
    this.offs.push(this.viewState.on('*', (ev) => this.onEvent(ev)));
    this.offs.push(onSettingsChange((s, changed) => this.onSettings(s, changed)));
    for (const line of session.chatLog || []) this.hud.chat(line);
    session.start();

    // Clients wait for the first full snapshot.
    if (!session.isHost && !this.viewState.snapshot) {
      this.hud.overlays.showWaiting();
      await new Promise((resolve) => {
        if (typeof session.onReady === 'function') session.onReady(resolve);
        else session.ready.then(resolve);
        this.offs.push(session.onEnd(() => resolve()));
      });
      if (this.disposed || this.ended) return;
      this.hud.overlays.hideWaiting();
    }

    const tr = performance.now();
    this.renderer = new RendererClass(this.canvas, { viewState: this.viewState, setup: session.setup, quality: this.settings.quality });
    this.stats.rendererInitMs = performance.now() - tr;
    this.resize();
    this.applyShowAllBars();
    this.centerOnStart();
    this.input = new InputController({ game: this, canvas: this.canvas, overlayRoot: this.hudRoot });
    this.selection.onChange(() => this.renderer && this.renderer.setSelection(this.selection.ids));

    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    this.offs.push(() => window.removeEventListener('resize', onResize));
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /** Startup failed: show the reason with a way back to the menu. */
  fail(err) {
    this.errors.push(err);
    if (this.disposed) return;
    try {
      if (!this.hud && this.viewState) this.hud = new Hud({ root: this.hudRoot, game: this });
      if (this.hud) this.hud.overlays.showEnded(`The game could not start: ${err && err.message ? err.message : err}`);
      else this.quitToMenu();
    } catch {
      this.quitToMenu();
    }
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
    let t1 = t0;
    let t2 = t0;
    try {
      // Paused (single player, F10 menu): the world is frozen, so the last
      // picture stays on the canvas; redraw only after a resize or option change.
      if (!this.paused || this.needsRender) {
        this.needsRender = false;
        this.viewState.update(now);
        this.selection.prune();
        this.input.update(dt);
        this.renderer.update(this.paused ? 0 : dt);
        this.renderer.render();
      }
      t1 = performance.now();
      const cam = this.renderer.camera;
      if (cam && cam.target) sfx.setListener(cam.target.x, cam.target.y);
      this.hud.update(now);
      this.checkEnd();
      this.ambientSounds(now);
      t2 = performance.now();
    } catch (err) {
      this.errors.push(err);
      if (this.errors.length <= 5) console.error('[game] frame failed', err);
    }
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

  surrender() {
    this.command({ type: 'surrender' });
  }

  /** Pause the simulation (single player only). Returns true if the game is paused. */
  setPaused(on) {
    const s = this.session;
    const solo = s && s.isHost && s.ticker && (!s.clients || s.clients.size === 0) && !s.stopped;
    if (!solo) return false;
    if (on && !this.paused) {
      s.ticker.stop();
      this.paused = true;
    } else if (!on && this.paused) {
      this.paused = false;
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
  }

  // ---------------------------------------------------------------- events

  onChat(line) {
    if (!this.hud) return;
    this.hud.chat(line);
    if (!line.system && line.from !== this.myIndex) sfx.play('select', { volume: 0.6 });
  }

  onEnd({ reason } = {}) {
    if (this.disposed) return;
    this.ended = true;
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
      const result = wt === null || wt === undefined ? 'draw' : wt === vs.myTeam ? 'victory' : 'defeat';
      if (this.input) this.input.cancelMode();
      sfx.play(result === 'victory' ? 'victory' : 'defeat');
      // Give the last explosions a moment before the screen.
      setTimeout(() => {
        if (!this.disposed) this.hud.overlays.showGameOver({ result, winningTeam: wt });
      }, 1200);
    } else if (!vs.gameOver && vs.me && vs.me.defeated && !this.hud.overlays.defeatShown) {
      if (this.input) this.input.cancelMode();
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
        hud.message(base ? 'Your base is under attack!  (Space)' : 'Your forces are under attack!  (Space)', 'alert');
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
          sfx.play('horn');
        }
        break;
      }
      case 'levelUp': {
        const e = vs.entities.get(ev.id);
        if (!e || e.o !== me) break;
        const t = UNITS[e.t];
        hud.message(`${t ? t.name : 'Your god'} reached level ${ev.level}!`, 'good');
        sfx.play('tier_up', { volume: 0.55 });
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
          hud.message(`${t.name}, ${t.title || 'god'}, answers your call!`, 'good');
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
          hud.message(`${b ? b.name : 'Building'} completed.`, 'info');
          sfx.play('building_complete');
        }
        break;
      case 'tierUp':
        if (ev.player === me) {
          hud.showBanner(`Your ${tierName(ev.tier - 1)} has grown into a ${tierName(ev.tier)}!`, 'good');
          sfx.play('tier_up');
        }
        break;
      case 'playerDefeated':
        if (ev.player !== me) hud.message(`${this.playerName(ev.player)} has been defeated.`, 'system');
        break;
      case 'bounty':
        // The renderer shows the floating "+N" gold.
        if (ev.player === me) this.worldSound('mine', ev.x, ev.y, 0.7);
        break;
      case 'resourceDepleted': {
        const m = vs.entities.get(ev.id);
        if (!m || vs.isExplored(m.x, m.y)) hud.message('A gold mine has collapsed.', 'info');
        break;
      }
      case 'death': {
        // Once defeated, the whole army dies at once: no list of losses under the defeat screen.
        if (ev.o === me && !(vs.me && vs.me.defeated)) {
          const t = ev.k === 'b' ? BUILDINGS[ev.t] : UNITS[ev.t];
          if (ev.k === 'b' && t) hud.message(`Your ${t.name} was destroyed.`, 'alert');
          else if (t && t.class === 'god') hud.message(`${t.name} has fallen! Revive them at a Temple.`, 'alert');
          else if (t && t.class === 'titan') hud.message(`${t.name} has fallen!`, 'alert');
        }
        this.worldSound('death', ev.x, ev.y, ev.k === 'b' ? 1 : 0.8);
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
        const name = ev.shape === 'heal' ? 'heal' : SPELL_SOUNDS[ev.el] || 'magic';
        this.worldSound(name, ev.x, ev.y);
        break;
      }
      default:
        break;
    }
  }

  worldSoundAt(id, name, volume = 1) {
    const p = this.entityPos(id);
    if (p) this.worldSound(name, p.x, p.y, volume);
  }

  /** Occasional chop / mine / hammer / prayer sounds from own workers near the camera. */
  ambientSounds(now) {
    if (now - this.lastAmbient < AMBIENT_MS || !this.renderer) return;
    this.lastAmbient = now;
    const cam = this.renderer.camera;
    if (!cam || !cam.target) return;
    const vs = this.viewState;
    const cands = [];
    for (const e of vs.entities.values()) {
      if (e.k !== 'u' || e.o !== vs.myIndex) continue;
      if (e.st !== 'gather' && e.st !== 'build' && e.st !== 'pray') continue;
      const d = Math.hypot(e.x - cam.target.x, e.y - cam.target.y);
      if (d < 16) cands.push(e);
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
    this.dispose();
    if (this.onExit) this.onExit();
  }
}
