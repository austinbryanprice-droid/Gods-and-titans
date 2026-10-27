// Team marks (DESIGN 9): the signals a player sends to teammates, by Alt+click or middle-click
// (a ping) or with the marker buttons beside the minimap. One table shared by the net layer (the
// host relays only these kinds), the minimap, the HUD pins and the sound, so a new kind is one
// entry here. Icons stay within Emoji 11.

/**
 * Kind → what it says and how it looks. `life` is how long it stays up, in seconds; `urgent`
 * kinds ring the louder chime; `color` tints the marker button and the pin's badge (the pin's ring
 * and the minimap ring wear the sender's own colour).
 */
export const MARKS = {
  ping: { id: 'ping', name: 'Ping', text: 'Look here!', icon: '📍', color: '#ffe066', life: 6 },
  attack: { id: 'attack', name: 'Attack', text: 'Attack here!', icon: '⚔️', color: '#ff5a48', life: 12 },
  defend: { id: 'defend', name: 'Defend', text: 'Defend here!', icon: '🛡️', color: '#58b0ff', life: 12 },
  help: { id: 'help', name: 'Help', text: 'Need help here!', icon: '🆘', color: '#ffa02e', life: 12, urgent: true },
  gather: { id: 'gather', name: 'Gather', text: 'Gather here!', icon: '🚩', color: '#6fe27c', life: 12 },
};

/** Kind ids in button order; part of the wire fingerprint (src/net/wire-version.js). */
export const MARK_KINDS = Object.keys(MARKS);

/** What Alt+click and middle-click place. */
export const DEFAULT_MARK = 'ping';

/** Marks one player may have standing at once; a new one past this retires their oldest. */
export const MARK_MAX_PER_PLAYER = 3;

/** Marks standing at once on a screen, whoever sent them. */
export const MARK_MAX_TOTAL = 16;

/** Token bucket for receiving marks, [per second, burst]: the host drops more than this from a client. */
export const MARK_RATE = [1.5, 5];

/** The same for sending, a little under MARK_RATE so the host never drops a mark its sender has already seen go up. */
export const MARK_SEND_RATE = [1, 4];
