// The campaign's chapter screen (DESIGN 9.6, 5.16): the five missions of Chapter I down the left (locked, open, won
// with the best time), and the chosen one's briefing on the right, read aloud by the narrator, with its objectives
// and a Begin button. A mission opens once the one before it is won (src/game/campaign-progress.js).
//
//   campaignScreen({ go, onBegin, mission, brief }) → { el, focus, onEscape, cleanup }
import { h, setChildren } from './menu-dom.js';
import { CAMPAIGN, MISSIONS, MISSION_BY_ID } from '../data/campaign.js';
import { PANTHEONS } from '../data/index.js';
import { getProgress, isUnlocked, nextToPlay, wonCount } from '../game/campaign-progress.js';
import { CampaignVoice } from '../game/campaign-voice.js';
import { getSettings } from '../settings.js';

function clock(sec) {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

/** "Raiders of Jarl Hrolf (Norse)" for the mission's enemies, "Legions of the Pharaoh (Egyptian)" for its allies. */
function sides(m) {
  const hero = m.players[0];
  const list = (pred) => m.players.slice(1).filter(pred).map((p) => `${p.name} (${(PANTHEONS[p.pantheon] || {}).name || p.pantheon})`);
  return { enemies: list((p) => p.team !== hero.team), allies: list((p) => p.team === hero.team) };
}

/**
 * @param {object} o
 * @param {(name: string, opts?: object) => void} o.go the menu's screen switch
 * @param {(id: string) => void} o.onBegin start a mission
 * @param {string} [o.mission] the mission to show first (else the next one to play)
 * @param {(m: object) => CampaignVoice} [o.makeVoice] tests
 */
export function campaignScreen({ go, onBegin, mission = null, makeVoice = (m) => new CampaignVoice({ mission: m, parts: ['briefing'] }) }) {
  const progress = getProgress();
  let selected = mission && MISSION_BY_ID[mission] && isUnlocked(mission, progress) ? MISSION_BY_ID[mission] : nextToPlay(progress);
  let voice = null;
  let live = true; // false once the screen is left or a mission begins: a late briefing must not start
  let briefTimer = 0;
  const backBtn = h('button.mw-btn.mw-btn--ghost', { type: 'button', onclick: () => go('title') }, '‹ Back');
  const list = h('ol.mw-mission-list', { 'aria-label': 'Missions' });
  const detail = h('div.mw-briefing', { 'aria-live': 'polite' });
  const items = MISSIONS.map((m) => {
    const open = isUnlocked(m.id, progress);
    const won = progress.won[m.id];
    const b = h('button.mw-mission', {
      type: 'button',
      class: [open ? '' : 'is-locked', won ? 'is-won' : ''].join(' '),
      disabled: !open,
      title: open ? `Mission ${m.n}: ${m.title}` : 'Win the mission before it to open this one',
      onclick: () => choose(m, true),
    },
    h('span.mw-mission-n', won ? '✓' : open ? String(m.n) : '🔒'),
    h('span.mw-mission-body', h('span.mw-mission-title', m.title), h('span.mw-mission-place', open ? m.place : 'Locked')),
    won ? h('span.mw-mission-best', { title: 'Your best time' }, clock(won.best)) : null);
    list.appendChild(h('li', b));
    return b;
  });

  function speak() {
    if (!live) return false;
    if (voice) voice.stop();
    voice = makeVoice(selected);
    return voice.say(selected.briefing);
  }

  function render() {
    MISSIONS.forEach((m, i) => items[i].classList.toggle('is-selected', m === selected));
    const m = selected;
    const { enemies, allies } = sides(m);
    const narrating = getSettings().narration;
    const begin = h('button.mw-btn.mw-btn--primary.mw-begin-btn', { type: 'button', onclick: () => {
      leave();
      onBegin(m.id);
    } }, 'Begin Mission');
    const hear = h('button.mw-btn.mw-btn--small.mw-btn--ghost', { type: 'button', onclick: () => speak(), title: narrating ? 'The narrator reads the briefing' : 'Narration is off in Settings', disabled: !narrating }, '🔊 Hear the briefing');
    setChildren(detail,
      h('p.mw-briefing-kicker', `Mission ${m.n} of ${MISSIONS.length} · ${m.place}`),
      h('h3.mw-briefing-title', m.title),
      h('p.mw-briefing-text', m.briefing),
      h('div.mw-briefing-sides',
        enemies.length ? h('span', h('b', 'Against: '), enemies.join(', ')) : null,
        allies.length ? h('span', h('b', 'Beside you: '), allies.join(', ')) : null),
      h('h4.mw-label', 'Objectives'),
      h('ul.mw-briefing-goals', m.objectives.filter((o) => !o.hidden).map((o) => h('li', { class: o.optional ? 'is-optional' : o.kind === 'protect' ? 'is-protect' : '' }, h('span.mw-goal-icon', o.icon || '•'), h('span', o.text)))),
      h('div.mw-briefing-btns', begin, hear));
    return begin;
  }

  function choose(m, say) {
    selected = m;
    const begin = render();
    if (say) {
      speak();
      begin.focus({ preventScroll: true });
    }
  }

  const won = wonCount(progress);
  const el = h('div.mw-center-screen.mw-wide-screen',
    h('section.mw-panel.mw-howto-panel.mw-campaign-panel',
      h('header.mw-panel-head', backBtn, h('h2.mw-h2', `${CAMPAIGN.chapter}: ${CAMPAIGN.title}`), h('span.mw-head-spacer')),
      h('div.mw-scroll',
        h('div.mw-campaign-body',
          h('aside.mw-campaign-side',
            h('p.mw-campaign-blurb', CAMPAIGN.blurb),
            list,
            h('p.mw-hint', `${won} of ${MISSIONS.length} won. Your progress is kept in this browser on this device.`)),
          detail))));
  const focus = render();
  // The briefing is read when the screen opens (a browser that has not had a click yet stays quiet until one).
  briefTimer = setTimeout(() => {
    if (el.isConnected) speak();
  }, 350);
  function leave() {
    live = false;
    clearTimeout(briefTimer);
    if (voice) voice.stop();
  }
  return {
    el,
    focus,
    onEscape: () => go('title'),
    cleanup: leave,
  };
}
