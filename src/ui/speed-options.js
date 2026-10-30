// The "Game speed" and "Interface size" choices of the settings screen and the in-game menu.
// Ids are the `gameSpeed` and `uiScale` settings' values (src/settings.js); the factors are in
// src/config.js (GAME_SPEEDS, UI_SCALES) and src/game/game.js applies them.

/** [id, label, one line of explanation] */
export const GAME_SPEED_OPTIONS = [
  ['slow', 'Slow', 'Half speed: time to think and to manage every fight. For games against the computer.'],
  ['normal', 'Normal', 'The standard pace. Online games always run at this speed.'],
  ['fast', 'Fast', 'One and a half times as fast. For games against the computer.'],
  ['faster', 'Very fast', 'Twice as fast: the economy and the armies grow in half the time. For games against the computer.'],
];

export const UI_SCALE_OPTIONS = [
  ['small', 'Small', 'A smaller interface: more of the battlefield shows.'],
  ['normal', 'Normal', 'The interface grows and shrinks with the window.'],
  ['large', 'Large', 'A larger interface, easier to read on a big screen or from a sofa.'],
  ['larger', 'Larger', 'The largest interface.'],
];

// The "Team colours" and "Command keys" choices (settings `teamColors`, src/team-colors.js, and
// `cardKeys`, src/ui/key-bindings.js).
export const TEAM_COLOR_OPTIONS = [
  ['standard', 'Standard', 'The colours chosen in the lobby.'],
  ['colorblind', 'Colour-blind safe', 'Team colours, selection rings and order markers drawn in colours that stay apart with red-green or blue-yellow colour blindness. Only your screen changes.'],
];

export const CARD_KEY_OPTIONS = [
  ['classic', 'Classic', 'Each command has its own letter: M Move, A Attack, B Build, W Warrior…'],
  ['grid', 'Grid', 'The keys follow the card\'s 4 × 3 layout (Q W E R, A S D F, Z X C V by default), whatever is selected. Tips and How to Play still name the Classic letters.'],
];

/** The explanation of one option id ('' for an unknown one). */
export function optionNote(options, id) {
  const o = options.find((x) => x[0] === id);
  return o ? o[2] : '';
}

// The "Graphics quality" choices (setting `quality`, src/render/game-renderer.js QUALITY). The renderer
// changes quality live, so the in-game menu offers them too.
export const QUALITY_OPTIONS = [
  ['low', 'Low', 'No shadows or post-processing, fewer particles. For older laptops.'],
  ['medium', 'Medium', 'Shadows, glow (bloom), smoothed edges and cloud shadows. Recommended.'],
  ['high', 'High', 'Adds ambient occlusion, sharper shadows, unit shadows and the most particles.'],
  ['ultra', 'Ultra', 'Everything at its best and finest. For gaming PCs.'],
];
