// The "Time of day" choices of the settings screen and the in-game menu: the
// running day and night cycle, or one time of day held for the whole match.
// Ids are the `timeOfDay` setting's values (src/settings.js); the sky itself is
// src/render/atmosphere.js.

/** [id, label, one line of explanation] */
export const TIME_OF_DAY_OPTIONS = [
  ['cycle', 'Day & night', 'The sky follows the match clock: it opens on the golden morning, runs through the day, a magenta dusk and a moonlit night, and rises again. Everyone in the match sees the same sky.'],
  ['golden', 'Golden', 'The golden morning, held for the whole match.'],
  ['day', 'Day', 'Bright midday, held for the whole match.'],
  ['dusk', 'Dusk', 'Magenta dusk, held for the whole match.'],
  ['night', 'Night', 'Moonlit blue night with glowing lamps, held for the whole match.'],
  ['dawn', 'Dawn', 'Rose and gold dawn, held for the whole match.'],
];

/** The explanation of one option id ('' for an unknown one). */
export function timeOfDayNote(id) {
  const o = TIME_OF_DAY_OPTIONS.find((x) => x[0] === id);
  return o ? o[2] : '';
}
