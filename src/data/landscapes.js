// Landscapes (DESIGN 6.7): the kind of land the melee map generator draws.
// Every landscape keeps the same fair base layout (symmetric starts, mines,
// expansions and camps); only the ground between the bases changes.
// The host picks one in the lobby, or Random, which is resolved from the seed
// before the game starts so every browser builds the same map.

import { RNG, hashSeed } from '../sim/rng.js';

/** Landscapes in lobby order. `classic` is the original generator. */
export const LANDSCAPES = [
  { id: 'classic', name: 'Wildlands', icon: '🌳', blurb: 'Meadows and woods with a few lakes and outcrops.' },
  { id: 'highlands', name: 'Highlands', icon: '⛰️', blurb: 'Rocky ridges cut the land; armies meet in the passes.' },
  { id: 'rivers', name: 'Rivers', icon: '🌊', blurb: 'Rivers wind between the bases; cross them at the fords.' },
  { id: 'islands', name: 'Islands', icon: '🏝️', blurb: 'Every base on its own island, joined by sandy land bridges.' },
  { id: 'forest', name: 'Great Forest', icon: '🌲', blurb: 'Deep woods everywhere; narrow trails link the clearings.' },
];

export const LANDSCAPE_IDS = LANDSCAPES.map((l) => l.id);
/** What the lobby can hold: a landscape, or 'random'. */
export const LANDSCAPE_CHOICES = [...LANDSCAPE_IDS, 'random'];
export const RANDOM_LANDSCAPE = { id: 'random', name: 'Random', icon: '🎲', blurb: 'A landscape drawn at random when the game starts.' };

export const isLandscape = (id) => LANDSCAPE_IDS.includes(id);

/** The landscape (or Random) entry for a lobby choice; unknown ids read as the classic Wildlands. */
export function landscapeInfo(id) {
  if (id === 'random') return RANDOM_LANDSCAPE;
  return LANDSCAPES.find((l) => l.id === id) || LANDSCAPES[0];
}

/** A concrete landscape id for a lobby choice: 'random' is drawn from the seed (the same in every browser). */
export function resolveLandscape(choice, seed) {
  if (isLandscape(choice)) return choice;
  if (choice !== 'random') return 'classic';
  return new RNG(hashSeed(`${seed}:landscape`)).pick(LANDSCAPE_IDS);
}
