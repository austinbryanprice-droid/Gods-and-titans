// Entry point: boots settings and audio, shows the menu, and hands a started
// lobby to the Game (DESIGN 11). Returning to the menu tears the game down
// completely, so matches can be played one after another without a reload. Replays
// (DESIGN 9.4) play in a Game of their own, from the Career screen or the game-over screen.
import { getSettings, onSettingsChange } from './settings.js';
import { initAudio, syncAudio, quietMusic, playTitleMusic } from './audio/audio.js';
import { createMenu, showMenu, hideMenu } from './ui/menu.js';
import { introWanted, playIntro } from './ui/intro.js';
import { isSoloLaunch, saveSkirmish, launchFrom } from './game/rematch.js';
import { readSave, saveInfo } from './game/save-store.js';
import { dailyLaunch } from './game/daily.js';

export { showMenu, hideMenu };

let current = null; // the running Game
let gameModule = null;
let menu = null; // the menu API from createMenu (toasts)

function loadGameModule() {
  if (!gameModule) {
    gameModule = import('./game/game.js').catch((err) => {
      gameModule = null;
      throw err;
    });
  }
  return gameModule;
}

/** Tear down the running game (if any) and show the title screen (or another menu screen). */
function backToMenu(screen = 'title') {
  if (current) {
    const g = current;
    current = null;
    g.dispose();
  }
  clearStartNotice();
  const root = document.getElementById('game-root');
  if (root) root.hidden = true;
  showMenu(screen);
}

/** Full-screen "loading" notice between Start and the first frame (the HUD draws over it). */
function showStartNotice(text = 'Raising the battlefield…') {
  clearStartNotice();
  const app = document.getElementById('app');
  if (!app) return null;
  const el = document.createElement('div');
  el.id = 'start-message';
  el.setAttribute('role', 'status');
  el.textContent = text;
  app.appendChild(el);
  return el;
}

/** Resolves once the browser has painted a frame (or soon after, in a hidden tab), before heavy start-up work blocks it. */
function paintedFrame() {
  return new Promise((resolve) => {
    const fallback = setTimeout(resolve, 100); // hidden tabs run no animation frames
    requestAnimationFrame(() => setTimeout(() => {
      clearTimeout(fallback);
      resolve();
    }, 0));
  });
}

function clearStartNotice(el = document.getElementById('start-message')) {
  if (el) el.remove();
}

/**
 * Called by the menu when a lobby starts.
 * @param {{ role: 'host'|'client', setup: object, myIndex: number, conns?: Map<number, object>, conn?: object, lobby: object }} launch
 */
export async function startGame(launch) {
  globalThis.__mythicwarLaunch = launch; // debug / test hook
  hideMenu();
  if (current) {
    current.dispose();
    current = null;
  }
  const notice = showStartNotice();
  // A game against the computer only: remember its lobby for Quick Match, and offer Play Again at its end.
  // The daily challenge (DESIGN 9.4) is not a lobby to remember: Play Again tries the same day's challenge again.
  const daily = launch && launch.daily ? launch.daily : null;
  const skirmish = !daily && isSoloLaunch(launch) ? launch.skirmish || (launch.lobby && launch.lobby.state) || null : null;
  if (skirmish) import('./net/lobby.js').then((mod) => saveSkirmish(mod, skirmish)).catch(() => {});
  try {
    await paintedFrame();
    const { Game } = await loadGameModule();
    const game = new Game({
      launch,
      settings: getSettings(),
      onExit: () => {
        if (current === game) current = null;
        backToMenu();
      },
      onRematch: daily ? () => retryDaily(daily) : skirmish ? () => rematch(skirmish) : null,
      onReplay: (record, opts) => startReplay(record, opts),
    });
    current = game;
    await game.ready;
  } catch (err) {
    console.error('[main] the game failed to start', err);
    if (!current) {
      // Nothing on screen to show the error: go back to the menu (which also closes
      // the lobby, so joined friends hear that the room is gone) and say what happened.
      showMenu('title');
      if (menu) menu.toast('The game could not start. Reload the page (Ctrl+Shift+R) and try again.');
    }
  } finally {
    clearStartNotice(notice);
  }
}

/**
 * Watch a replay: a kept one by its id (the Career screen), or a record (a file, the game-over screen,
 * or a replay starting over at an earlier moment, with { startAt, viewer, speed, camera }).
 */
export async function startReplay(what, opts = {}) {
  hideMenu();
  if (current) {
    current.dispose();
    current = null;
  }
  const notice = showStartNotice('Unrolling the chronicle…');
  try {
    await paintedFrame();
    let record = what;
    if (typeof what === 'string') {
      const store = await import('./game/replay-store.js');
      record = await store.loadReplay(what);
    }
    if (!record) throw new Error('that replay could not be read');
    const { Game } = await loadGameModule();
    const game = new Game({
      replay: { ...opts, record },
      settings: getSettings(),
      onExit: () => {
        if (current === game) current = null;
        backToMenu('career');
      },
      onReplay: (r, o) => startReplay(r, o),
    });
    current = game;
    await game.ready;
  } catch (err) {
    console.error('[main] the replay failed to start', err);
    if (!current) {
      showMenu('career');
      if (menu) menu.toast('That replay could not be played.');
    }
  } finally {
    clearStartNotice(notice);
  }
}

/** Play Again: the same lobby, a fresh seed (a new map, new random pantheons). */
async function rematch(state) {
  try {
    const mod = await import('./net/lobby.js');
    const launch = launchFrom(mod, state, getSettings().name);
    if (!launch) throw new Error('that lobby can no longer start');
    await startGame(launch);
  } catch (err) {
    console.error('[main] the rematch failed to start', err);
    backToMenu();
  }
}

/**
 * Continue / Load Game (DESIGN 9.4): read a saved game and start it. Rejects (the menu shows the
 * message) when the slot cannot be read; a save that cannot be rebuilt fails on the game's start screen.
 */
async function loadGame(slot) {
  let save;
  try {
    save = await readSave(slot);
  } catch (err) {
    console.error('[main] the saved game could not be read', err);
    throw new Error('The saved game could not be read.');
  }
  if (!save || !save.setup) throw new Error('That saved game is gone.');
  const info = saveInfo(slot) || {};
  const extra = save.extra || {};
  await startGame({ role: 'host', setup: save.setup, myIndex: Number.isInteger(extra.myIndex) ? extra.myIndex : 0, conns: new Map(), lobby: null, skirmish: info.skirmish || null, daily: info.daily || null, resume: save });
}

/** Play Again on a daily challenge: the same day's game (same map and sides) once more; the best score is kept. */
async function retryDaily(day) {
  try {
    const mod = await import('./net/lobby.js');
    await startGame(dailyLaunch(mod, day, getSettings().name));
  } catch (err) {
    console.error('[main] the daily challenge failed to start', err);
    backToMenu();
  }
}

/** True when this browser can make a WebGL 2 context (the renderer needs one). The probe context is released at once. */
function hasWebGL2() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * Play the intro film (DESIGN 11.1) over the hidden menu, with its score and its narration if the player has it on;
 * the menu comes back on `screen` behind the black when the film ends or is skipped. Resolves once the film is gone,
 * whatever its outcome.
 * @param {string} screen the menu screen to land on
 * @param {boolean} [guard] drop the film on a machine too slow to show it (not when the player asked to watch it)
 */
function watchIntro(screen, guard = true) {
  hideMenu();
  quietMusic(); // whatever else is playing (a Settings audition) goes: the film starts its own score, the title theme as an overture
  const handover = () => {
    showMenu(screen);
    playTitleMusic(); // a film that ran to its end left that score playing, and this carries it on; one that was cut short faded it out, and the title's own comes in
  };
  try {
    const s = getSettings();
    // A browser keeps sound off until a key press or a click, unless the player has allowed it for the site. When the
    // player wants to hear the film and the browser has not allowed it, the film waits for that input behind a card.
    const wantsSound = s.volume > 0 || (!s.musicMuted && s.musicVolume > 0);
    const intro = playIntro({ root: document.getElementById('app'), quality: s.quality, guard, narrate: s.narration, volume: s.volume, gate: wantsSound, onHandover: handover });
    return intro.done;
  } catch (err) {
    console.error('[main] the intro film could not start', err);
    handover();
    return Promise.resolve('failed');
  }
}

function prefersReducedMotion() {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function boot() {
  const settings = getSettings();
  initAudio(settings); // the sound effects and the music: one audio context, started now where the browser allows it and otherwise at the first key press or click
  onSettingsChange(syncAudio);
  menu = createMenu({ root: document.getElementById('menu-root'), onStart: startGame, onLoad: loadGame, onIntro: () => watchIntro('settings', false), onReplay: (what) => startReplay(what) });
  const msg = document.getElementById('boot-message');
  if (msg) msg.remove();
  const webgl2 = hasWebGL2();
  if (!webgl2) {
    menu.setNotice('This game needs WebGL 2, which this browser is not providing. Turn on hardware acceleration in your browser settings, or try a current Chrome, Edge, Firefox or Safari.');
  }
  const intro = introWanted({ enabled: settings.intro, search: location.search, webdriver: navigator.webdriver === true, reducedMotion: prefersReducedMotion(), webgl2 });
  // the film has the machine to itself; the game's code is fetched once it is over
  if (intro) watchIntro('title').then(warmUp);
  else warmUp();
}

/**
 * Fetch the game while the player is in the menu, so Start Battle does not sit on a
 * black screen: first the game module, then, when the browser is idle, the renderer
 * (three.js, models) and the AI, which the game would otherwise load only after Start.
 * Importing only evaluates modules; no GL context is created here.
 */
function warmUp() {
  const later = (fn, ms) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: ms }) : setTimeout(fn, ms));
  setTimeout(() => {
    loadGameModule().catch(() => {});
    later(() => {
      import('./render/game-renderer.js').catch(() => {});
      import('./ai/ai.js').catch(() => {});
    }, 4000);
  }, 1500);
}

try {
  boot();
} catch (err) {
  console.error('[main] boot failed', err);
  const msg = document.getElementById('boot-message');
  if (msg) msg.textContent = `Failed to start: ${err && err.message ? err.message : err}`;
}
