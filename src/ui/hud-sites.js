// The Sacred Sites chip in the HUD's top bar (DESIGN 5.11 and 9): how many of the map's
// sacred sites your side holds and, with Sacred Victory on, the countdown of whichever side
// holds them all. Pure: reads the ViewState, returns what to show (hud.js draws it).
import { SITE_FAITH, SACRED_HOLD, SACRED_NAME } from '../config.js';
import { peaceClock } from '../sim/peace.js';

/** The emblem of a sacred site (chip, alerts, How to Play). */
export const SITE_ICON = '🛐';

/** Seconds left on a Sacred Victory countdown at which the alerts speak up once. */
export const SACRED_WARNINGS = [120, 60, 30];

/** The chip's tooltip. */
export function siteChipTitle(vs) {
  const lines = [`Sacred sites held by your side. A Worshipper or Priest standing at a site with no enemy near captures it; each site you hold gives ${SITE_FAITH} faith a second.`];
  if (vs.sacredVictoryOn()) lines.push(`${SACRED_NAME} is on: the side that holds every site for ${SACRED_HOLD / 60} minutes in a row wins.`);
  return lines.join('\n');
}

/**
 * What the chip shows: { hidden, text, cls } where cls is '' (nobody holds them all), 'is-ours' (my
 * side's Sacred Victory clock runs) or 'is-theirs' (a rival's does).
 */
export function siteChip(vs) {
  const total = vs.sites.length;
  if (!total) return { hidden: true, text: '', cls: '' };
  const team = vs.myTeam;
  const held = team === null || team === undefined ? 0 : vs.sitesHeld(team);
  let text = `${held}/${total}`;
  let cls = '';
  if (vs.sacred) {
    text += ` · ${peaceClock(vs.sacredLeft())}`;
    cls = vs.sacred.tm === team ? 'is-ours' : 'is-theirs';
  }
  return { hidden: false, text, cls };
}

/** The line shown once as a game with Sacred Victory opens. */
export function sacredStartText() {
  return `${SACRED_NAME} is on: hold every sacred site ${SITE_ICON} for ${SACRED_HOLD / 60} minutes to win. Send a Worshipper or Priest to capture one.`;
}

/** "2 minutes" / "30 seconds". */
export function sacredWhen(sec) {
  return sec >= 60 ? `${Math.round(sec / 60)} minute${sec === 60 ? '' : 's'}` : `${sec} seconds`;
}
