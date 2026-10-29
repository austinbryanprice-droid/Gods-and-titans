// Game controller (DESIGN 11): builds the session (HostSession with the World
// and AIs, or ClientSession), the 3D renderer, the HUD and the input
// controller; runs the frame loop; turns view-state events into sounds and HUD
// messages; handles waiting for the host, pause in single player, game over,
// the host leaving, chat, and a full teardown back to the menu. The host records
// the match (src/game/replay.js) and keeps it at the end; a replay plays in a Game
// of its own, built on a ReplaySession instead of a live one (DESIGN 9.5).
//
//   const game = new Game({ launch, settings, onExit });   // launch from the menu
//   await game.ready;                                      // view is up
//   game.quitToMenu();                                     // teardown + onExit()
import { HostSession, ClientSession } from '../net/session.js';
import { createWorld } from '../sim/world.js';
import { getSettings, onSettingsChange } from '../settings.js';
import { sfx } from '../audio/sfx.js';
import { GAME_SPEEDS, PEACE_NAME, UI_SCALES } from '../config.js';
import { edgeName } from '../sim/survival.js';
import { UNITS, BUILDINGS, buildingIcon } from '../data/index.js';
import { POWERS, isHarmfulPower } from '../data/powers.js';
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
import { MSG, REASONS, RateLimiter, sanitizeName, sanitizeReason, makeRoomCode } from '../net/protocol.js';
import { TeamMarks } from './team-marks.js';
import { readTicket, saveTicket, clearTicket, saveTally } from '../net/rejoin-ticket.js';
import { CareerTracker } from './career-tracker.js';
import { getCareer } from './career.js';
import { recordTutorial } from './career.js';
import { TutorialDirector } from './tutorial.js';
import { isTutorial } from '../sim/tutorial.js';
import { recordDaily, dailyChallenge } from './daily.js';
import { scoreOf } from '../data/score.js';
import { medalFor } from '../data/medals.js';
import { missionOf } from '../sim/campaign.js';
import { nextMission } from '../data/campaign.js';
import { CampaignVoice } from './campaign-voice.js';
import { recordMission } from './campaign-progress.js';
import { ReplayRecorder } from './replay.js';
import { saveReplay } from './replay-store.js';
import { ReplaySession } from './replay-session.js';
import { ReplayBar } from '../ui/hud-replay.js';
import { MatchSaver, loadSaveGame, isSettled, settleMatch } from './game-saves.js';
import { AUTO_SLOT } from './save-store.js';

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

/** The career's id of an online game this client can rejoin (its token), or null. */
export function rejoinMatchId(launch) {
  return launch && launch.role === 'client' && launch.rejoin ? `rejoin:${launch.rejoin}` : null;
}

/** Forget the rejoin ticket of a client's game (DESIGN 7): it is over, or cannot be rejoined. */
function dropTicket(launch) {
  if (launch && launch.role === 'client' && launch.rejoin) clearTicket(undefined, launch.rejoin);
}

/** Forget the ticket a host keeps into its heir's room (DESIGN 7): the game ended, or nobody carries it on. */
function dropHostTicket(launch, token) {
  if (token && !(launch && launch.role === 'client')) clearTicket(undefined, token);
}

export class Game {
  /**
   * @param {object} o
   * @param {object} [o.launch] from the menu: { role: 'host'|'client', setup, myIndex, conns | conn, lobby }
   * @param {object} [o.session] an already built HostSession / ClientSession (instead of launch)
   * @param {object} [o.settings] getSettings()
   * @param {() => void} [o.onExit] called after teardown (main.js shows the menu)
   * @param {() => void} [o.onRematch] Play Again: starts a new game with the same lobby (games against the computer only)
   * @param {(id: string) => void} [o.onNextMission] a campaign mission won: open the next one's briefing (main.js)
   * @param {() => void} [o.onRejoin] a client that lost its link: leave this Game and connect to the room again (main.js)
   * @param {object} [o.replay] play a replay instead of a match: { record (sanitizeReplay), startAt?, viewer?, speed?, camera? }
   * @param {(record: object, opts?: object) => void} [o.onReplay] watch a replay (main.js tears this Game down and
   *   builds the replay's): the game-over screen's Watch Replay, and a replay going back in time
   * @param {(slot: string, leave: (launch: object) => void) => Promise<void>} [o.onLoad] the F10 menu's Load Game
   *   (main.js): reads the slot (rejecting with a message to show), calls leave(launch) and starts the loaded game
   * @param {HTMLElement} [o.root] #game-root (with #game-canvas and #hud-root)
   * @param {Function} [o.createAI] override the AI factory (tests)
   * @param {Function} [o.createVoices] the AIs' chat lines with that override (tests; src/ai/voice.js)
   * @param {Function} [o.Renderer] override the renderer class (tests)
   */
  constructor({ launch = null, session = null, settings = null, onExit = null, onRematch = null, onNextMission = null, onRejoin = null, onLoad = null, replay = null, onReplay = null, root = null, createAI = null, createVoices = null, Renderer = null } = {}) {
    this.launch = launch;
    this.replay = replay && replay.record ? replay : null;
    this.onReplay = onReplay;
    this.recorder = null; // ReplayRecorder: this match, kept for a replay at its end (the host only)
    this.replayRecord = null; // the finished recording
    this.replayBar = null;
    this.session = session;
    this.settings = settings || getSettings();
    this.onExit = onExit;
    this.onRematch = onRematch;
    this.onNextMission = onNextMission;
    this.onRejoin = onRejoin;
    this.onLoad = onLoad;
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
    this.netPause = null; // an online game paused for everyone (session.pause), or null
    this.sessionOffs = []; // listeners on the current session (a new host replaces it, DESIGN 7)
    this.handoffLobby = null; // the room this browser opened after taking the game over from its host
    this.migrating = false; // following the game to its new host
    this.leaving = false; // the host is handing the game over before it goes back to the menu
    this.myToken = (launch && launch.rejoin) || null; // this browser's rejoin token of an online game (DESIGN 7)
    this.solo = false; // a match against the computer, so the game speed applies (set at start)
    this.speed = 1; // game seconds per real second (applySpeed)
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
    this.dailyCounted = false; // a daily challenge's score is kept once (countDaily)
    this.tutorial = null; // TutorialDirector: the objectives of the guided first match (src/game/tutorial.js)
    this.mission = null; // the campaign mission this match plays (src/data/campaign.js), its objectives run in the sim
    this.voice = null; // CampaignVoice: the mission's narrator
    this.saver = null; // MatchSaver: Save Game, Save & Quit and the autosave of a solo match (src/game/game-saves.js)
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
    const needsAI = !createAI && !this.session && !this.replay && !(this.launch && this.launch.role === 'client');
    const resume = (!this.session && this.launch && this.launch.resume) || null; // a saved game to carry on (DESIGN 9.4)
    const [loadedAI, RendererClass, saveGame] = await Promise.all([
      createAI ? Promise.resolve({ createAI, createVoices }) : needsAI ? loadAI() : Promise.resolve({ createAI: idleAI, createVoices: null }),
      Renderer ? Promise.resolve(Renderer) : import('../render/game-renderer.js').then((m) => m.GameRenderer),
      resume ? loadSaveGame() : null,
    ]);
    if (this.disposed) return;
    const aiFailed = needsAI && !loadedAI;
    let resumed = null; // the loaded save's extras
    const aiFactory = (loadedAI && loadedAI.createAI) || idleAI;
    const voiceFactory = (loadedAI && loadedAI.createVoices) || null;

    if (!this.session && this.replay) {
      const r = this.replay;
      this.session = new ReplaySession({ record: r.record, createWorld, startAt: r.startAt || 0, viewer: r.viewer ?? -1, speed: r.speed || 1 });
      if (r.paused) this.session.userPaused = true;
      this.session.onRestart = (tick) => this.replayFrom(tick);
    }
    if (!this.session) {
      const l = this.launch;
      if (!l || !l.setup) throw new Error('Game needs a launch or a session.');
      if (l.role === 'client') this.session = new ClientSession({ setup: l.setup, myIndex: l.myIndex, conn: l.conn });
      else if (resume) {
        // The world and the computer players' minds come from the save; a missing mind starts afresh.
        const loaded = saveGame.unpackMatch(resume);
        resumed = loaded.extra;
        this.session = new HostSession({
          setup: loaded.world.setup, myIndex: l.myIndex ?? 0, conns: new Map(), resumed: true, createVoices: voiceFactory,
          createWorld: () => loaded.world,
          createAI: (world, index, difficulty) => loaded.ais.get(index) || aiFactory(world, index, difficulty),
        });
      } else this.session = new HostSession({ setup: l.setup, myIndex: l.myIndex ?? 0, conns: l.conns || new Map(), createWorld, createAI: aiFactory, createVoices: voiceFactory });
    }
    const session = this.session;
    // An online host takes back players who dropped out (DESIGN 7): the lobby checks their token, the session seats them.
    const lobby = this.launch && this.launch.lobby;
    if (session.isHost && lobby && typeof lobby.setRejoinHandler === 'function' && typeof session.rejoin === 'function') {
      lobby.setRejoinHandler((index, conn) => session.rejoin(index, conn));
      this.offs.push(() => lobby.setRejoinHandler(null));
      // ...and should this browser leave, the game goes on in another player's (host migration).
      if (lobby.online && lobby.started && typeof lobby.gameTokens === 'function' && lobby.hostToken) {
        this.myToken = lobby.hostToken;
        this.prepareHandoff(session, lobby.gameTokens());
      }
    }
    this.viewState = session.viewState;
    this.selection = new Selection(this.viewState);
    // The guided first match (DESIGN 9.2): its objectives, read from the view and the selection; the HUD shows them.
    if (isTutorial(session.setup) && session.isHost && !this.replay) {
      this.tutorial = new TutorialDirector({ viewState: this.viewState, getSelection: () => this.selection.ids, onStep: (next, i, done) => this.onTutorialStep(next, done) });
    }

    // A campaign mission (DESIGN 5.16): the sim runs its objectives; the HUD shows them and the narrator says its lines.
    this.mission = missionOf(session.setup);
    if (this.mission) {
      this.voice = new CampaignVoice({ mission: this.mission, parts: ['victory', 'events'] });
      this.offs.push(() => this.voice.stop());
    }

    this.hud = new Hud({ root: this.hudRoot, game: this });
    this.applyUiScale();
    if (this.replay) {
      this.replayBar = new ReplayBar({ root: this.hudRoot, game: this, onSeekBack: (tick) => this.replayFrom(tick) });
      let speed = session.speed;
      this.offs.push(session.onChange(() => {
        if (session.speed === speed) return;
        speed = session.speed;
        this.applySpeed();
      }));
    }
    if (session.mapMismatch) this.hud.setMapMismatch(true);
    this.listenTo(session);
    this.offs.push(() => this.listenTo(null));
    this.offs.push(this.viewState.on('*', (ev) => this.onEvent(ev)));
    // A replay is watched, not played: no alerts, chronicle, career or recording of its own.
    if (!this.replay) {
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
    } else this.offs.push(() => this.replayBar && this.replayBar.dispose());
    // The host keeps a replay of the match (src/game/replay.js): every command the World takes, with its tick.
    // A game carried on from a save records on from the recording the save carried (a replay plays from the
    // setup); a save without one (an older build's, or a game too long to carry) gets no replay.
    if (!this.replay && !this.tutorial && session.isHost && session.world) {
      if (!resumed) this.recorder = new ReplayRecorder({ world: session.world, setup: session.setup, myIndex: session.myIndex });
      else if (resumed.replay) this.recorder = ReplayRecorder.resume({ world: session.world, carried: resumed.replay });
    }
    if (this.recorder) {
      this.recorder.attach();
      this.offs.push(this.viewState.on('snapshot', () => this.recorder.sample()));
      this.offs.push(session.onChat((line) => this.recorder.chat(line)));
      this.offs.push(() => this.recorder.detach());
    }
    // The career and achievements on this device (src/game/career-tracker.js): nothing goes over the wire.
    // The guided first match is not a game of the career: its medal is kept instead (checkEnd); nor is a
    // campaign mission, whose wins and best times the campaign keeps (src/game/campaign-progress.js).
    // A loaded game the career has already counted (quit as a loss, then carried on from a save) counts nothing more.
    // Likewise a rejoined online game already counted when the player quit it (rejoinMatchId).
    const settled = !!(resumed && isSettled(resumed.matchId)) || isSettled(rejoinMatchId(this.launch));
    if (settled) this.dailyCounted = true;
    if (!this.tutorial && !this.mission && !this.replay && !settled) {
      this.career = new CareerTracker({ viewState: this.viewState, setup: session.setup, onUnlock: (list) => this.onAchievements(list) }).attach();
      this.offs.push(() => this.career.dispose());
      if (rejoinMatchId(this.launch)) this.keepTally();
    }
    // The score of the player's pantheon, calm while building and rising with the fighting (src/game/music-director.js).
    this.director = new MusicDirector({ viewState: this.viewState, music }).attach();
    this.offs.push(() => this.director.dispose());
    this.offs.push(onSettingsChange((s, changed) => this.onSettings(s, changed)));
    for (const line of session.chatLog || []) if (showChatLine(line) && !line.voice) this.hud.chat(line);
    // A campaign mission is not saved: carrying one on would lose its chapter screen, Retry and Next Mission.
    if (session.isHost && !this.tutorial && !this.replay && !this.mission) {
      this.saver = new MatchSaver(this, { resume: resumed });
      if (resumed) this.saver.restore(resumed);
    }
    // The daily challenge (DESIGN 9.3): its twist, said once at the start and kept on a chip in the top bar.
    if (this.launch && this.launch.daily) {
      const tw = dailyChallenge(this.launch.daily).twist;
      this.hud.showTwist(tw);
      if (!resumed) this.hud.message(`Daily challenge: ${tw.name}. ${tw.desc}`, 'info', { icon: tw.icon });
    }
    session.start();
    // Only a match against the computer can run faster or slower: nobody else has to keep up.
    this.solo = !this.replay && isSolo(session);
    this.applySpeed();

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
    this.applySpeed();
    if (!(this.saver && this.saver.restoreCamera())) this.centerOnStart();
    if (resumed) this.hud.message('Saved game loaded.', 'system', { icon: '💾' });
    if (this.replay && this.replay.camera) this.restoreCamera(this.replay.camera);
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
    const who = this.replay ? (vs.myIndex >= 0 ? vs.myIndex : this.replay.record.pov) : vs.myIndex;
    let best = null;
    for (const e of vs.entities.values()) {
      if (e.o !== who) continue;
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
        this.renderer.update(this.paused || this.netPause ? 0 : dt);
        this.renderer.render(now);
      }
    } catch (err) {
      this.frameFault(err);
    }
    const t1 = performance.now();
    try {
      this.hud.update(now);
      if (this.replayBar) this.replayBar.update();
    } catch (err) {
      this.frameFault(err);
    }
    try {
      this.checkEnd();
      if (this.saver) this.saver.tick();
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
    if (this.replay) {
      // The menu holds a replay still; the picture keeps drawing, so the camera stays free.
      if (s && typeof s.hold === 'function') s.hold(on);
      return !!on;
    }
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

  /**
   * The game speed setting (DESIGN 9), for a match against the computer only: the ticker runs more or fewer
   * ticks a second, the view plays back at the same pace, and the renderer's animations follow.
   */
  applySpeed() {
    if (this.replay) {
      // A replay's own speed (the replay bar) runs its ticker and clock; the animations follow it here.
      const r = this.renderer;
      if (r && typeof r.setSpeed === 'function' && this.session) r.setSpeed(this.session.speed);
      return;
    }
    const m = (this.solo && GAME_SPEEDS[this.settings.gameSpeed]) || 1;
    this.speed = m;
    const s = this.session;
    if (s && s.ticker) s.ticker.setSpeed(m);
    if (this.viewState) this.viewState.setRate(m);
    if (this.renderer && typeof this.renderer.setSpeed === 'function') this.renderer.setSpeed(m);
  }

  /** The interface size setting: a factor on the HUD's base font size (hud.css), which every panel is sized in. */
  applyUiScale() {
    if (this.hudRoot && this.hudRoot.style) this.hudRoot.style.setProperty('--hud-scale', String(UI_SCALES[this.settings.uiScale] || 1));
  }

  onSettings(s, changed) {
    this.settings = s;
    if (changed.includes('gameSpeed')) this.applySpeed();
    if (changed.includes('uiScale')) this.applyUiScale();
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
    // A computer player's line (DESIGN 10.1) is a taunt at the top centre with a snarl of drums and brass.
    if (line.voice && !line.system) {
      if (this.hud.showTaunt(line)) sfx.play('taunt');
      return;
    }
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

  onEnd({ reason, handoff = null } = {}) {
    if (this.disposed) return;
    // The host left a game still being played: it goes on with the heir (DESIGN 7).
    if (handoff && !this.overShown && !this.replay && !this.leaving) {
      this.migrate(reason, handoff);
      return;
    }
    this.ended = true;
    this.setLoading(false);
    // Only a lost link can be rejoined, not a game the host closed. (Taken over by another window: that one keeps the ticket.)
    if (reason === REASONS.REPLACED) this.replaced = true;
    else if (reason !== REASONS.HOST_LEFT) dropTicket(this.launch);
    if (!this.hud) return;
    if (this.overShown && (reason === 'game-over' || reason === 'host-quit')) {
      this.hud.message('The host has closed the game.', 'system');
      return;
    }
    this.hud.overlays.showEnded(reason);
  }

  checkEnd() {
    const vs = this.viewState;
    if (this.replay) return; // the replay bar says when it is over
    if (vs.gameOver && !this.overShown) {
      this.overShown = true;
      const wt = vs.gameOver.winningTeam;
      const survival = typeof vs.survivalActive === 'function' && vs.survivalActive();
      const result = survival ? 'survival' : wt === null || wt === undefined ? 'draw' : wt === vs.myTeam ? 'victory' : 'defeat';
      // Trial of the Titans: the score is the wave reached; the career keeps the best (best.wave) for players who took part.
      const wave = survival ? (Number.isInteger(vs.gameOver.wave) ? vs.gameOver.wave : (vs.survival() || {}).wave || 0) : 0;
      const previous = survival ? getCareer().best.wave : 0;
      if (this.input) this.input.cancelMode();
      if (this.saver) this.saver.onGameOver();
      dropTicket(this.launch);
      dropHostTicket(this.launch, this.myToken);
      let unlocked = this.career ? this.career.finish(result, survival ? { wave } : null) : null;
      const record = survival && unlocked ? { best: Math.max(previous, wave), previous, isNew: wave > previous } : null;
      // The guided first match: a victory earns a medal by its game time, kept with the career.
      const medal = this.tutorial && result === 'victory' ? medalFor(vs.time) : null;
      if (medal) unlocked = recordTutorial(medal.rank);
      const daily = this.launch && this.launch.daily ? this.countDaily(result === 'victory') : null;
      if (this.recorder) this.keepReplay(result, wt);
      // A campaign mission: a win is kept (and opens the next one), and the narrator says how the story goes on.
      const mission = this.mission ? { m: this.mission, record: null, next: null } : null;
      if (mission && result === 'victory') {
        mission.record = recordMission(this.mission.id, vs.time);
        mission.next = nextMission(this.mission.id);
        if (this.voice) setTimeout(() => !this.disposed && this.voice.say(this.mission.victory), 1600);
      }
      // (A defeat already heard when the local player fell is not played again.)
      if (result === 'victory') sfx.play('victory');
      else if (!this.defeatSounded) sfx.play('defeat');
      // Give the last explosions a moment before the screen.
      setTimeout(() => {
        if (!this.disposed) this.hud.overlays.showGameOver({ result, winningTeam: wt, unlocked, how: vs.gameOver.how, medal, tutorial: !!this.tutorial, wave, record, daily, mission });
      }, 1200);
    } else if (!vs.gameOver && vs.me && vs.me.defeated && !this.hud.overlays.defeatShown) {
      if (this.input) this.input.cancelMode();
      this.defeatSounded = true;
      sfx.play('defeat');
      this.hud.overlays.showDefeated();
    }
  }

  /** A campaign mission's scripted line: on the screen (a raid or a giant as a banner), and said by the narrator. */
  onCampaignSay(ev) {
    const e = this.mission && this.mission.events[ev.e];
    if (!e || !e.say) return;
    const hud = this.hud;
    const threat = e.spawn && e.spawn.owner !== this.myIndex;
    if (threat) {
      hud.showBanner(e.say, 'danger');
      sfx.play('horn', { volume: 0.7 });
    } else hud.message(e.say, 'info', { icon: '📜' });
    if (this.voice) this.voice.say(e.say);
  }

  /** A campaign objective was finished, failed, or shown for the first time. */
  onObjective(ev) {
    const o = this.mission && this.mission.objectives[ev.i];
    if (!o) return;
    const hud = this.hud;
    if (ev.s === 1) {
      hud.message(`${o.optional ? 'Bonus objective' : 'Objective'} complete: ${o.text}.`, 'good', { icon: '✅' });
      sfx.play('tier_up', { volume: 0.55 });
    } else if (ev.s === 2) {
      hud.message(`Objective failed: ${o.text}.`, 'alert', { icon: '❌' });
    } else {
      hud.message(`New objective: ${o.text}.`, 'info', { icon: o.icon || '📜' });
    }
  }

  /** This browser's rejoin ticket for this game, when it is a client of one (DESIGN 7). */
  rejoinTicket() {
    const l = this.launch;
    const t = l && l.role === 'client' && l.rejoin ? readTicket() : null;
    return t && t.token === l.rejoin ? t : null;
  }

  /**
   * A client of a game it can rejoin (DESIGN 7) keeps the career's running tally with its ticket, every few
   * seconds and when it leaves: a rejoined Game carries on from it (buildings lost, gods summoned, …), so that
   * a reload neither forgets progress nor earns an achievement the match did not.
   */
  keepTally() {
    const token = this.launch.rejoin;
    const t = this.rejoinTicket();
    const career = this.career;
    if (t && t.tally) Object.assign(career.m, t.tally);
    let last = 0;
    // (A window whose seat another window took back writes nothing more: that one keeps the tally now.)
    const keep = () => !this.replaced && saveTally(token, career.m);
    this.offs.push(this.viewState.on('snapshot', () => {
      const ms = Date.now();
      if (ms - last < 3000) return;
      last = ms;
      keep();
    }));
    this.offs.push(keep);
  }

  /** Rejoin on the Game Ended screen: leave this Game and connect to the room again. */
  rejoin() {
    if (typeof this.onRejoin !== 'function' || this.disposed || !this.rejoinTicket()) return;
    const go = this.onRejoin;
    this.dispose();
    go();
  }

  /** Next Mission on the game-over screen: leave this match and open the next mission's briefing. */
  nextMission() {
    const next = this.mission ? nextMission(this.mission.id) : null;
    if (!next || typeof this.onNextMission !== 'function' || this.disposed) return;
    const go = this.onNextMission;
    this.dispose();
    go(next.id);
  }

  /** A step of the guided first match was finished: say so, chime, and ping the next objective on the minimap. */
  onTutorialStep(next, done) {
    if (this.disposed || !this.hud) return;
    if (done) this.hud.message(`Done: ${done.title}.`, 'good', { icon: '✅' });
    sfx.play('tier_up', { volume: 0.55 });
    const t = next && this.tutorial ? this.tutorial.target() : null;
    if (t) this.hud.minimap.ping(t.x, t.y, '#ffd66e');
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
          hud.message(`${b ? b.name : 'Building'} completed.`, 'info', { icon: b && buildingIcon(ev.t, vs.me && vs.me.pantheon) });
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
      case 'campaignSay':
        this.onCampaignSay(ev);
        break;
      case 'objective':
        this.onObjective(ev);
        break;
      case 'waveFront':
        // My share of the wave (it comes just before the 'wave' event): where it comes from, for the banner.
        if (ev.player === vs.myIndex) this.myFront = { n: ev.n, count: ev.count, x: ev.x, y: ev.y };
        break;
      case 'wave': {
        // Trial of the Titans: a wave comes out of the map's edges, a share of it at each player.
        const mine = this.myFront && this.myFront.n === ev.n ? this.myFront : null;
        const at = mine || ev;
        const from = edgeName(vs.width, vs.height, at.x, at.y);
        const boss = ev.boss ? UNITS[ev.boss] : null;
        if (boss) {
          hud.showBanner(ev.count > 1 ? `Wave ${ev.n}: ${boss.name} leads ${ev.count - 1} monsters!` : `Wave ${ev.n}: ${boss.name} comes!`, 'titan');
          sfx.play('summon_titan', { volume: 0.8 });
        } else {
          hud.showBanner(`Wave ${ev.n}: ${ev.count} monsters!`, 'danger');
          sfx.play('horn', { volume: 0.7 });
        }
        if (mine && mine.count < ev.count) hud.message(`${mine.count} of them come at you from the ${from}.`, 'alert', { icon: '🐉' });
        else hud.message(`They come from the ${from}.`, 'alert', { icon: '🐉' });
        hud.minimap.ping(at.x, at.y, boss ? '#ffc840' : '#ff3a2a');
        if (this.input) this.input.noteAlert(at.x, at.y);
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
        // A telegraphed effect (a god power's bolts, a delayed blast) sounds when it lands.
        if (ev.delay > 0) setTimeout(() => !this.disposed && this.worldSound(name, ev.x, ev.y, volume), ev.delay * 1000);
        else this.worldSound(name, ev.x, ev.y, volume);
        break;
      }
      case 'godPower': {
        const pw = Object.hasOwn(POWERS, ev.power) ? POWERS[ev.power] : null;
        if (!pw) break;
        const harm = isHarmfulPower(pw);
        if (ev.player === me) {
          hud.message(`${pw.name}!`, 'good', { icon: pw.icon });
          sfx.play('summon_god', { volume: 0.6 });
        } else if (vs.isAlly(ev.player)) {
          hud.message(`${this.playerName(ev.player)} calls on ${pw.name}.`, 'info', { icon: pw.icon });
          if (harm) hud.minimap.ping(ev.x, ev.y, '#ffd84a');
        } else if (harm) {
          // An enemy's strike or cataclysm: everyone hears of it, and sees where it fell.
          if (pw.tier >= 3) hud.showBanner(`${this.playerName(ev.player)} unleashes ${pw.name}!`, 'danger');
          else hud.message(`${this.playerName(ev.player)} unleashes ${pw.name}!`, 'alert', { icon: pw.icon });
          hud.minimap.ping(ev.x, ev.y, '#ff3a2a');
          if (this.input) this.input.noteAlert(ev.x, ev.y);
        } else hud.message(`${this.playerName(ev.player)} calls on ${pw.name}.`, 'info', { icon: pw.icon });
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
    if (this.recorder) this.keepReplay(null);
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
      this.countDaily(false);
      if (this.saver) this.saver.onGameOver(); // counted: its autosave would bring it back to count again
      settleMatch(rejoinMatchId(this.launch)); // and so would rejoining it (DESIGN 7)
    }
  }

  /**
   * A daily challenge (DESIGN 9.3) counts once, like the career: its chronicle score as a try at today's
   * best, and the day for the streak. Returns what the game-over screen shows, or null for another game.
   */
  countDaily(won) {
    const vs = this.viewState;
    const day = this.launch && this.launch.daily;
    if (!day || this.dailyCounted || !vs || vs.myIndex < 0) return null;
    this.dailyCounted = true;
    try {
      return recordDaily(day, scoreOf(vs.players[vs.myIndex]).total, won);
    } catch (err) {
      console.warn('[game] daily record failed', err);
      return null;
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
    if (this.handoffLobby) this.handoffLobby.close();
    this.handoffLobby = null;
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

  // ---------------------------------------------------------------- replays

  /**
   * Keep this match's replay (once): at the game-over screen with how it ended, or on leaving
   * (result null) when it ran long enough. The save is in the background; the record stays here for
   * Watch Replay.
   */
  keepReplay(result, winningTeam = null) {
    const rec = this.recorder;
    if (!rec || rec.done) return this.replayRecord;
    let record = null;
    try {
      record = rec.finish({ result, winningTeam });
    } catch (err) {
      console.warn('[game] the replay could not be finished', err);
    }
    this.replayRecord = record;
    if (record) saveReplay(record).catch(() => {});
    return record;
  }

  /** Can the game-over screen offer Watch Replay? */
  canWatchReplay() {
    return !!this.replayRecord && typeof this.onReplay === 'function' && !this.disposed;
  }

  /** Watch this match's replay from its start (the game-over screen). */
  watchReplay() {
    if (!this.canWatchReplay()) return;
    const record = this.replayRecord;
    const next = this.onReplay;
    this.countLeave();
    this.dispose();
    next(record, {});
  }

  /** A replay going back: start it over at `tick`, keeping the speed, the eyes and the camera. */
  replayFrom(tick) {
    if (!this.replay || this.disposed || typeof this.onReplay !== 'function') return;
    const s = this.session;
    const record = this.replay.record;
    const opts = { startAt: tick, viewer: s.myIndex, speed: s.speed, paused: !!s.userPaused && !s.ended, camera: this.cameraState() };
    const next = this.onReplay;
    this.dispose();
    next(record, opts);
  }

  cameraState() {
    const c = this.renderer && this.renderer.camera;
    return c ? { x: c.goal.x, y: c.goal.y, distance: c.goalDistance, yaw: c.yaw || 0, tilt: c.tilt || 0 } : null;
  }

  restoreCamera(st) {
    const c = this.renderer && this.renderer.camera;
    if (!c || !st) return;
    c.yaw = Number.isFinite(st.yaw) ? st.yaw : 0;
    c.tilt = Number.isFinite(st.tilt) ? st.tilt : 0;
    if (Number.isFinite(st.distance)) c.setDistance(st.distance, true);
    c.centerOn(st.x, st.y);
  }

  /** True when the game-over screen may offer Play Again (a game against the computer only). */
  canRematch() {
    return typeof this.onRematch === 'function' && !this.disposed;
  }

  /** Play Again: leave this match (counted like Return to Menu) and start the same lobby anew. */
  rematch() {
    if (!this.canRematch()) return;
    const next = this.onRematch;
    this.countLeave();
    this.dispose();
    next();
  }

  /** Can the match be saved now (F10 menu)? A solo match against the computer that is still being played. */
  canSave() {
    return !!(this.saver && this.saver.canSave());
  }

  /** Save to a slot ('1'..'3', or the autosave). Resolves with the slot's info; rejects with a message to show. */
  saveGame(slot) {
    if (!this.saver) return Promise.reject(new Error('This game cannot be saved.'));
    return this.saver.save(slot);
  }

  /**
   * Save & Quit: keep the match in the autosave slot (Continue on the title screen) and leave. The
   * match is not counted in the career yet: it counts when it ends, after it is carried on.
   */
  async saveAndQuit() {
    if (this.disposed) return;
    await this.saveGame(AUTO_SLOT);
    if (this.disposed) return;
    this.dispose();
    if (this.onExit) this.onExit();
  }

  /** Can the F10 menu load a saved game here? A solo match against the computer (the matches that can be saved). */
  canLoad() {
    return typeof this.onLoad === 'function' && this.canSave();
  }

  /** Is this saved game's info (save-store listSaves) a save of this very match? */
  isOwnSave(info) {
    return !!(info && this.saver && info.matchId && info.matchId === this.saver.matchId);
  }

  /**
   * Load Game from the F10 menu (DESIGN 9.4): leave this match for a saved one. Leaving counts like Quit to
   * Menu (a loss after the first minute), except when the save is of this very match: then nothing is counted.
   * Rejects with a message to show when the slot cannot be read (the match goes on).
   */
  loadSave(slot) {
    if (this.disposed || !this.canLoad()) return Promise.reject(new Error('A saved game cannot be loaded now.'));
    return this.onLoad(slot, (launch) => this.leaveForLoad(launch));
  }

  /** The saved game was read: count this match unless the save is of it, and tear it down (no onExit: the loaded game follows). */
  leaveForLoad(launch) {
    if (this.disposed) return;
    const extra = launch && launch.resume && launch.resume.extra;
    const own = !!(extra && this.saver && extra.matchId && extra.matchId === this.saver.matchId);
    if (!own) this.countLeave();
    this.dispose();
  }

  /** Leave the match and go back to the title screen. */
  quitToMenu() {
    if (this.disposed || this.leaving) return;
    this.countLeave();
    const s = this.session;
    // A host with other players hands the game over first (DESIGN 7): it goes on in the heir's browser.
    if (s && s.isHost && s.canHandOff && s.clients && s.clients.size) {
      this.leaving = true;
      if (this.hud) this.hud.overlays.showWaiting(`Handing the game to ${s.playerName(s.heir)}…`, 'Leaving');
      s.handOff().catch((err) => console.warn('[game] hand-over failed', err)).finally(() => {
        if (this.disposed) return;
        this.dispose();
        if (this.onExit) this.onExit();
      });
      return;
    }
    if (s && s.isHost && !s.canHandOff) dropHostTicket(this.launch, this.myToken);
    this.dispose();
    if (this.onExit) this.onExit();
  }

  // ---------------------------------------------------------------- online: pause and host migration (DESIGN 7)

  /** Follow this session's chat, marks, end and pauses (and stop following the one before). */
  listenTo(session) {
    for (const off of this.sessionOffs.splice(0)) off();
    if (!session) return;
    this.sessionOffs.push(session.onChat((line) => this.onChat(line)));
    if (typeof session.onMark === 'function') this.sessionOffs.push(session.onMark((mark) => this.onMark(mark)));
    this.sessionOffs.push(session.onEnd((info) => this.onEnd(info)));
    if (typeof session.onPause === 'function') this.sessionOffs.push(session.onPause((p) => this.onNetPause(p)));
  }

  /** Is this an online game, which pauses for everyone (not a match against the computer only)? */
  get online() {
    const s = this.session;
    return !!(s && !this.replay && typeof s.sendPause === 'function' && (!s.isHost || (s.clients && s.clients.size > 0) || this.handoffLobby || (this.launch && this.launch.lobby && this.launch.lobby.online)))
      && !isSolo(s);
  }

  /** Pause the online game for everyone, or resume it (the Pause key, the game menu, the pause bar). */
  togglePause() {
    const s = this.session;
    if (!this.online || this.ended || this.disposed) return false;
    const vs = this.viewState;
    if (!s.pause && vs && (vs.gameOver || (vs.me && vs.me.defeated))) return false;
    s.sendPause(!s.pause);
    return true;
  }

  onNetPause(p) {
    this.netPause = p ? { ...p } : null;
    if (!p && this.viewState) this.viewState.resetClock();
    if (this.hud && typeof this.hud.setPause === 'function') this.hud.setPause(this.netPause);
    sfx.play(p ? 'click' : 'select', { volume: 0.6 });
  }

  /** How this browser reaches the other players: the lobby's transport ('peer', or 'local' between tabs). */
  netTransport() {
    const l = this.launch || {};
    return l.transport || (l.lobby && l.lobby.transport) || (readTicket() || {}).transport || 'peer';
  }

  /**
   * As host of an online game, keep an heir ready (DESIGN 7): the session sends them the whole game every
   * few seconds. This browser keeps a ticket into the heir's room, so that after a reload it can take its seat back there.
   */
  async prepareHandoff(session, tokens) {
    const humans = session.setup.players.filter((p) => p.kind === 'human').length;
    if (humans < 2 || isTutorial(session.setup) || this.mission) return;
    let mods;
    try {
      mods = await Promise.all([loadSaveGame(), import('../net/handoff.js')]);
    } catch (err) {
      console.warn('[game] host migration is not available', err);
      return;
    }
    if (this.disposed || session !== this.session || session.stopped) return;
    const [saveGame, net] = mods;
    const room = makeRoomCode();
    session.enableHandoff({ room, tokens, pack: (world, ais) => net.encodeState(JSON.stringify(saveGame.packMatch(world, ais))) });
    if (this.myToken) saveTicket({ roomCode: room, token: this.myToken, myIndex: session.myIndex, name: session.playerName(session.myIndex), transport: this.netTransport() });
  }

  /**
   * The host left: carry the game on (DESIGN 7). The heir builds it from the copy the host sent and opens the
   * planned room; everyone else connects there with their token. The view, the HUD and the renderer stay:
   * only the session under them changes. If that fails, the game ends as it always did.
   */
  async migrate(reason, { plan, backup }) {
    const old = this.session;
    const mine = plan.heir === this.myIndex;
    this.migrating = true;
    this.netPause = null;
    if (this.hud) {
      if (typeof this.hud.setPause === 'function') this.hud.setPause(null);
      if (this.input) this.input.cancelMode();
      this.hud.overlays.showWaiting(mine ? 'The host has left. You take the game over…' : `The host has left. ${old.playerName(plan.heir)} takes the game over…`, 'Host Left');
    }
    const transport = this.netTransport();
    const name = old.playerName(this.myIndex);
    // If this does not work out, Rejoin (and the title screen's) tries the new room.
    if (this.myToken && !mine) saveTicket({ roomCode: plan.room, token: this.myToken, myIndex: this.myIndex, name, transport });
    try {
      const net = await import('../net/handoff.js');
      let session;
      let lobby = null;
      if (mine) {
        const [ai, saveGame] = await Promise.all([loadAI(), loadSaveGame()]);
        const aiFactory = (ai && ai.createAI) || idleAI;
        ({ session, lobby } = await net.takeOver({
          plan, backup, transport,
          makeSession: (save) => {
            const loaded = saveGame.unpackMatch(save);
            return new HostSession({
              setup: loaded.world.setup, myIndex: this.myIndex, conns: new Map(), resumed: true, viewState: this.viewState,
              createWorld: () => loaded.world,
              createAI: (world, index, difficulty) => loaded.ais.get(index) || aiFactory(world, index, difficulty),
              createVoices: (ai && ai.createVoices) || null,
            });
          },
        }));
      } else {
        const info = await net.followHeir({ plan, token: this.myToken, name, transport });
        session = new ClientSession({ setup: info.setup, myIndex: info.myIndex, conn: info.conn, mapData: old.mapData, viewState: this.viewState });
      }
      if (this.disposed) {
        session.stop();
        if (lobby) lobby.close();
        return;
      }
      this.adopt(session, lobby);
    } catch (err) {
      console.warn('[game] the game could not move to a new host', err);
      this.migrating = false;
      if (this.disposed) return;
      if (this.hud) this.hud.overlays.hideWaiting();
      this.onEnd({ reason });
    }
  }

  /** Carry on with the session of the game's new host (DESIGN 7): this browser's own, or the heir's. */
  adopt(session, lobby) {
    this.listenTo(session);
    this.session = session;
    if (this.handoffLobby) this.handoffLobby.close();
    this.handoffLobby = lobby;
    this.migrating = false;
    this.ended = false;
    // The game went back a few seconds: the units' motion history is of a future that will not happen.
    this.viewState.resetMotion();
    session.start();
    if (this.hud) {
      this.hud.overlays.hideWaiting();
      this.hud.message(session.isHost ? 'You now host the game. It goes on from a few seconds before the host left.' : 'The game goes on with its new host, from a few seconds before the host left.', 'system', { icon: '🔁' });
      if (typeof this.hud.setPause === 'function') this.hud.setPause(session.pause);
    }
    this.netPause = session.pause ? { ...session.pause } : null;
    // A new host keeps an heir ready in turn (and a ticket into that heir's room).
    if (session.isHost && lobby) this.prepareHandoff(session, lobby.gameTokens());
  }

}
