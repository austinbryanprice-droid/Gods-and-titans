// Protocol version (DESIGN 7): GAME_VERSION plus a short fingerprint of what two
// builds must agree on to talk to each other: message names, the packed event
// shapes of the delta codec, the command whitelist, the team mark kinds and the unit / building /
// ability / pantheon / upgrade ids that snapshots and setups refer to. A friend with a
// stale tab (or cached modules) after a deploy gets different tables, so the
// host refuses the join with "reload the page" instead of the game breaking with
// resync loops. HELLO.version is only ever compared as a string: nothing on the
// wire changes shape.
import { GAME_VERSION } from '../config.js';
import { UNITS, BUILDINGS, ABILITIES, PANTHEONS, UPGRADES } from '../data/index.js';
import { MARK_KINDS } from '../data/marks.js';
import { MSG } from './protocol.js';
import { COMMAND_SPECS } from './sanitize.js';
import { EVENT_SHAPES } from './delta.js';

/** 32-bit FNV-1a of a string, as 8 hex digits. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Fingerprint of the wire surface (8 hex digits); changes whenever one of those tables does. */
export function wireFingerprint() {
  const ids = (o) => Object.keys(o).sort();
  return fnv1a(JSON.stringify([
    MSG, EVENT_SHAPES, COMMAND_SPECS, ids(UNITS), ids(BUILDINGS), ids(ABILITIES), ids(PANTHEONS), ids(UPGRADES), MARK_KINDS,
  ]));
}

/** What HELLO.version and GameSetup.version carry: e.g. '0.1.0+1a2b3c4d' (14 characters; the receivers keep 32). */
export const PROTOCOL_VERSION = `${GAME_VERSION}+${wireFingerprint()}`;
