// The Delete key (DESIGN 9): the selected own units are destroyed. A few plain units go at once; a
// bigger group, a god or a Titan asks for a second press first, because there is no taking it back.
// Pure: input.js passes the view entities of the selected own units.
import { UNITS } from '../data/index.js';

export const DELETE_CONFIRM_ABOVE = 5; // a selection of more units than this asks for a second press
export const DELETE_CONFIRM_MS = 2500; // the second press must follow within this (the prompt itself shows for 2.6 s)

/** "Zeus", "Zeus and Hera", "Zeus, Hera and Kronos". */
function listNames(names) {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * What a Delete press does to these units (view entities `{ id, t }`, all the player's own).
 * @returns {{ ids: number[], confirm: boolean, prompt: string }} `confirm`: a second press is needed first,
 *   and `prompt` says what it would destroy
 */
export function deletePlan(units) {
  const ids = units.map((u) => u.id);
  const named = [];
  for (const u of units) {
    const def = UNITS[u.t];
    if (def && (def.class === 'god' || def.class === 'titan')) named.push(def.name);
  }
  const confirm = ids.length > DELETE_CONFIRM_ABOVE || named.length > 0;
  if (!confirm) return { ids, confirm, prompt: '' };
  const what = ids.length === 1 ? named[0] || 'this unit' : `${ids.length} units`;
  const among = ids.length > 1 && named.length ? `, including ${listNames(named)}` : '';
  return { ids, confirm, prompt: `Press Delete again to destroy ${what}${among}.` };
}
