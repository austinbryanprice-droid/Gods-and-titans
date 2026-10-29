// Team colours as this screen shows them (DESIGN 9): the lobby's colours, or a colour-blind-safe
// set picked by the `teamColors` setting. Only what is drawn changes: the match, its setup and
// every other player keep the colours chosen in the lobby, so one player's setting never reaches another.
//
// The safe set swaps each lobby colour for one that stays apart from the others under protanopia,
// deuteranopia and tritanopia (Machado 2009 simulation, CIELAB distance; the worst pair of the eight is
// about 21 against 2 for the lobby set's blue and purple), and the selection rings and order markers
// trade green and red for blue and orange.
import { PLAYER_COLORS } from './config.js';

export const TEAM_PALETTES = ['standard', 'colorblind'];

/** The colour-blind-safe stand-in of each PLAYER_COLORS entry, in the same order. */
export const SAFE_PLAYER_COLORS = [
  '#e8620c', // red → vermilion
  '#2563eb', // blue → blue
  '#f2f2f2', // green → white
  '#f5e23a', // gold → yellow
  '#a884f0', // purple → lavender
  '#8a5a2b', // orange → brown
  '#7cd4f5', // teal → sky blue
  '#0e8f73', // pink → sea green
];

// Selection rings and hover (game-renderer.js), relation text in the HUD.
const RELATIONS = {
  standard: { own: '#3dff4a', ally: '#c4f23a', enemy: '#ff3a2a', neutral: '#ffd83a' },
  colorblind: { own: '#3aa8ff', ally: '#f2f2f2', enemy: '#ff6a1a', neutral: '#ffd83a' },
};
// Order markers on the ground (overlays.js MarkerLayer).
const MARKERS = {
  standard: { move: '#4dff5a', attack: '#ff3a2a', gather: '#ffd23a' },
  colorblind: { move: '#3aa8ff', attack: '#ff6a1a', gather: '#ffd23a' },
};

const SAFE_OF = new Map(PLAYER_COLORS.map((c, i) => [c.toLowerCase(), SAFE_PLAYER_COLORS[i]]));

let palette = 'standard';
const listeners = new Set();

/** Choose the palette ('standard' | 'colorblind'); listeners hear of a change. */
export function setTeamPalette(id) {
  const next = TEAM_PALETTES.includes(id) ? id : 'standard';
  if (next === palette) return false;
  palette = next;
  for (const cb of [...listeners]) {
    try {
      cb(palette);
    } catch (err) {
      console.error('[team-colors] listener failed', err);
    }
  }
  return true;
}

export function teamPalette() {
  return palette;
}

/** Subscribe to palette changes: cb(paletteId). Returns the unsubscribe. */
export function onTeamPaletteChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * How a player's colour is drawn: under the colour-blind palette a lobby colour becomes its safe
 * stand-in; any other value (a neutral grey, a colour from an old save) is returned as it is.
 */
export function displayColor(color, pal = palette) {
  if (pal !== 'colorblind' || typeof color !== 'string') return color;
  return SAFE_OF.get(color.toLowerCase()) || color;
}

/** The colour of a selection ring for a relation ('own' | 'ally' | 'enemy' | 'neutral'). */
export function relationColor(relation, pal = palette) {
  const set = RELATIONS[pal] || RELATIONS.standard;
  return set[relation] || set.neutral;
}

/** The ground marker colours of move, attack and gather orders. */
export function markerColors(pal = palette) {
  return { ...(MARKERS[pal] || MARKERS.standard) };
}
