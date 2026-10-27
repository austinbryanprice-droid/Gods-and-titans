// The "Alerts" choices of the settings screen and the in-game menu: how much the game speaks up
// (src/game/alerts.js) and what a tab in the background does when the game needs the player
// (src/ui/tab-attention.js). Ids are the `alerts` and `tabAlerts` settings' values (src/settings.js).
import { notificationState } from './tab-attention.js';

/** [id, label, one line of explanation] */
export const ALERT_OPTIONS = [
  ['all', 'All', 'Warnings and reminders: enemies near your base, an ally under attack, idle Worshippers, a full population, a god or Titan you can afford, an idle army, finished research and milestones.'],
  ['important', 'Warnings only', 'Only the warnings: enemies near your base, an ally under attack and the end of the Decade of Peace.'],
  ['off', 'Off', 'No extra alerts. The game\'s own battle warnings (your forces under attack, a Titan rising) still sound.'],
];

/** [id, label, one line of explanation] */
export const TAB_ALERT_OPTIONS = [
  ['off', 'Off', 'Nothing happens to this tab while you are away.'],
  ['title', 'Flash the tab', 'While you are in another tab or window, the tab\'s title flashes when your base is attacked, the peace ends or a god is ready.'],
  ['notify', 'Notification', 'The title flashes and your computer shows a notification too. The browser asks for permission the first time.'],
];

/** The explanation of one `alerts` id ('' for an unknown one). */
export function alertNote(id) {
  const o = ALERT_OPTIONS.find((x) => x[0] === id);
  return o ? o[2] : '';
}

/**
 * The explanation of one `tabAlerts` id. 'notify' says why only the title flashes when the browser
 * blocks or lacks notifications, or the player did not allow them (`state` is notificationState(),
 * `fellBack` that the player just picked 'notify' and got 'title').
 */
export function tabAlertNote(id, state = notificationState(), fellBack = false) {
  if (id === 'notify') {
    if (state === 'unsupported') return 'This browser cannot show notifications, so the tab title flashes instead.';
    if (state === 'denied') return 'Notifications are blocked for this site in your browser, so the tab title flashes instead.';
    if (fellBack) return 'Notifications were not allowed, so the tab title flashes instead.';
  }
  const o = TAB_ALERT_OPTIONS.find((x) => x[0] === id);
  return o ? o[2] : '';
}
