// Entry point: boots settings and audio, shows the menu, and hands a started
// lobby to the Game (DESIGN 11). Returning to the menu tears the game down
// completely, so matches can be played one after another without a reload.
import { getSettings, onSettingsChange } from './settings.js';
import { sfx } from './audio/sfx.js';
import { createMenu, showMenu, hideMenu } from './ui/menu.js';

export { showMenu, hideMenu };

let current = null; // the running Game
let gameModule = null;

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
  const root = document.getElementById('game-root');
  if (root) root.hidden = true;
  showMenu('title');
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
  try {
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
      // Nothing on screen to show the error: go back to the menu.
      showMenu('title');
    }
  }
}

function boot() {
  const settings = getSettings();
  sfx.init({ volume: settings.volume });
  sfx.setVolume(settings.volume);
  onSettingsChange((s, changed) => {
    if (changed.includes('volume')) sfx.setVolume(s.volume);
  });
  createMenu({ root: document.getElementById('menu-root'), onStart: startGame });
  const msg = document.getElementById('boot-message');
  if (msg) msg.remove();
  // Warm the game module while the player is in the menu.
  setTimeout(() => loadGameModule().catch(() => {}), 1500);
}

try {
  boot();
} catch (err) {
  console.error('[main] boot failed', err);
  const msg = document.getElementById('boot-message');
  if (msg) msg.textContent = `Failed to start: ${err && err.message ? err.message : err}`;
}
