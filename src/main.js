// Entry point: boots settings and audio, shows the menu, and hands a started
// lobby to the Game (DESIGN 11). Returning to the menu tears the game down
// completely, so matches can be played one after another without a reload.
import { getSettings, onSettingsChange } from './settings.js';
import { sfx } from './audio/sfx.js';
import { createMenu, showMenu, hideMenu } from './ui/menu.js';
import { introWanted, playIntro } from './ui/intro.js';

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

/** Tear down the running game (if any) and show the title screen. */
function backToMenu() {
  if (current) {
    const g = current;
    current = null;
    g.dispose();
  }
  clearStartNotice();
  const root = document.getElementById('game-root');
  if (root) root.hidden = true;
  showMenu('title');
}

/** Full-screen "loading" notice between Start and the first frame (the HUD draws over it). */
function showStartNotice() {
  clearStartNotice();
  const app = document.getElementById('app');
  if (!app) return null;
  const el = document.createElement('div');
  el.id = 'start-message';
  el.setAttribute('role', 'status');
  el.textContent = 'Raising the battlefield…';
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
 * Play the intro film (DESIGN 11.1) over the hidden menu; the menu comes back on `screen` behind the
 * black when the film ends or is skipped. Resolves once the film is gone, whatever its outcome.
 * @param {string} screen the menu screen to land on
 * @param {boolean} [guard] drop the film on a machine too slow to show it (not when the player asked to watch it)
 */
function watchIntro(screen, guard = true) {
  hideMenu();
  try {
    const intro = playIntro({ root: document.getElementById('app'), quality: getSettings().quality, guard, onHandover: () => showMenu(screen) });
    return intro.done;
  } catch (err) {
    console.error('[main] the intro film could not start', err);
    showMenu(screen);
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
  sfx.init({ volume: settings.volume });
  sfx.setVolume(settings.volume);
  onSettingsChange((s, changed) => {
    if (changed.includes('volume')) sfx.setVolume(s.volume);
  });
  menu = createMenu({ root: document.getElementById('menu-root'), onStart: startGame, onIntro: () => watchIntro('settings', false) });
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
