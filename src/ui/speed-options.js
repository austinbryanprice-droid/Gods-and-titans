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

/** The explanation of one option id ('' for an unknown one). */
export function optionNote(options, id) {
  const o = options.find((x) => x[0] === id);
  return o ? o[2] : '';
}
