// Soldier ranks in the selection panel (src/ui/hud-info.js): the rank and xp line
// with its bar, the portrait badge, the grid cells' numerals and the stats with
// the rank bonus. Real World + ViewState, a tiny fake DOM.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { ViewState } from '../../src/game/view-state.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { InfoView, rankBonusText, rankProgressText } from '../../src/ui/hud-info.js';
import { godsFor, MORTALS } from '../../src/data/index.js';
import { RANK_COLORS, RANK_NUMERALS } from '../../src/data/ranks.js';
import { RANK_XP } from '../../src/config.js';
import { makeWorld, spawn } from '../sim/helpers.js';
import { installFakeDom } from './fake-dom.js';

before(installFakeDom);

let clock = 0;
const push = (world, vs) => vs.pushSnapshot(world.getSnapshot(), (clock += 50));

/** Player 0's view with a Warrior, an Archer, a Worshipper and a god of mine in the open. */
function scene() {
  const world = makeWorld({ pantheons: ['norse', 'greek'] }); // Norse blessings leave a Warrior's plain stats alone
  const tc = world.buildingsOf(0).find((b) => b.type === 'town_center');
  const warrior = spawn(world, 0, 'warrior', tc.x + 4, tc.y + 5);
  const archer = spawn(world, 0, 'archer', tc.x + 5, tc.y + 5);
  const worker = world.unitsOf(0).find((u) => u.type === 'worshipper');
  const god = spawn(world, 0, godsFor(world.players[0].pantheon)[0].id, tc.x + 6, tc.y + 5);
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  push(world, vs);
  const sel = new Selection(vs);
  const root = document.createElement('div');
  const info = new InfoView(root, { selection: sel, viewState: vs, onSelectOnly() {}, onRemove() {}, onSelectType() {}, onCancelQueue() {}, onPortrait() {} });
  const read = () => {
    info.update();
    const fill = root.find('is-xp') ? root.find('is-xp').children[0] : null;
    return {
      xpText: root.find('hi-xp-text') && root.find('hi-xp-text').textContent,
      xpBar: root.find('is-xp'),
      fill: fill && fill.style.width,
      xpTitle: root.find('hi-xp') && root.find('hi-xp').title,
      badge: root.find('hi-level'),
      stats: root.findAll('hi-stat-v').map((n) => n.textContent),
      sub: root.find('hi-sub') && root.find('hi-sub').textContent,
    };
  };
  const earn = (u, kills) => {
    for (let i = 0; i < kills; i++) world.killEntity(spawn(world, 1, 'warrior', 40, 40 + i * 0.01), u);
    push(world, vs);
  };
  return { world, vs, sel, root, info, read, earn, warrior, archer, worker, god };
}

test('a fresh Warrior shows a Recruit bar with its progress to Veteran, no badge and its plain stats', () => {
  const { sel, read, warrior } = scene();
  sel.set([warrior.id]);
  const p = read();
  assert.equal(p.xpText, `Recruit · XP 0 / ${RANK_XP[1]}`);
  assert.ok(p.xpBar && p.xpBar.className.includes('is-rank'), 'a rank bar, not the gods\' purple one');
  assert.equal(p.fill, '0.0%');
  assert.equal(p.badge.hidden, true);
  assert.equal(p.stats[0], String(MORTALS.warrior.attack.damage));
  assert.equal(p.stats[2], String(MORTALS.warrior.armor));
  assert.equal(p.xpTitle, rankBonusText());
});

test('experience fills the bar, a promotion shows the numeral and the stronger stats', () => {
  const { sel, read, earn, warrior } = scene();
  sel.set([warrior.id]);
  earn(warrior, 1);
  let p = read();
  assert.equal(p.xpText, `Recruit · XP 31 / ${RANK_XP[1]}`);
  assert.equal(p.fill, `${((31 / RANK_XP[1]) * 100).toFixed(1)}%`);
  assert.equal(p.badge.hidden, true);
  earn(warrior, 1);
  p = read();
  assert.equal(p.xpText, `Veteran · XP 62 / ${RANK_XP[2]}`);
  assert.equal(p.fill, `${(((62 - RANK_XP[1]) / (RANK_XP[2] - RANK_XP[1])) * 100).toFixed(1)}%`);
  assert.equal(p.badge.hidden, false);
  assert.equal(p.badge.textContent, RANK_NUMERALS[1]);
  assert.ok(p.badge.classList.contains('is-rank'));
  assert.equal(p.badge.style.getPropertyValue('--rank'), RANK_COLORS[1]);
  assert.equal(p.stats[0], String(Math.round(MORTALS.warrior.attack.damage * 1.05)), 'damage +5%');
  assert.equal(p.stats[2], String(MORTALS.warrior.armor + 0.5), 'armor +0.5');
  earn(warrior, 8);
  p = read();
  assert.equal(p.xpText, 'Champion · Max rank');
  assert.equal(p.fill, '100%');
  assert.equal(p.badge.textContent, RANK_NUMERALS[3]);
  assert.equal(p.badge.style.getPropertyValue('--rank'), RANK_COLORS[3]);
  assert.equal(p.stats[2], String(MORTALS.warrior.armor + 1.5));
});

test('Archers and the other Barracks soldiers have the bar; Worshippers do not; gods keep their level bar', () => {
  const { sel, read, archer, worker, god, earn } = scene();
  sel.set([archer.id]);
  assert.equal(read().xpText, `Recruit · XP 0 / ${RANK_XP[1]}`);
  earn(archer, 3);
  assert.match(read().xpText, /^Veteran · XP 93 /);
  sel.set([worker.id]);
  const w = read();
  assert.equal(w.xpBar, null);
  assert.equal(w.badge.hidden, true);
  sel.set([god.id]);
  const g = read();
  assert.match(g.xpText, /^Level 1 · XP 0 \/ /);
  assert.equal(g.badge.textContent, '1');
  assert.ok(!g.badge.classList.contains('is-rank'), 'the god\'s level badge keeps the god\'s gold');
  assert.ok(!g.xpBar.className.includes('is-rank'));
});

test('grid cells show a soldier\'s numeral and follow promotions without rebuilding the group', () => {
  const { sel, root, info, vs, world, earn, warrior, archer, worker } = scene();
  const second = spawn(world, 0, 'warrior', warrior.x + 1, warrior.y);
  push(world, vs);
  sel.set([warrior.id, second.id, archer.id, worker.id]);
  info.update();
  const cells = root.findAll('hi-cell');
  assert.equal(cells.length, 4);
  const badges = () => cells.map((c) => c.find('hi-cell-lv')).map((b) => (b ? (b.hidden ? '' : b.textContent) : null));
  assert.deepEqual(badges(), ['', '', '', null], 'soldiers have a hidden badge, the worker none');
  earn(warrior, 2);
  earn(archer, 5);
  info.update();
  assert.deepEqual(badges(), [RANK_NUMERALS[1], '', RANK_NUMERALS[2], null]);
  assert.equal(root.findAll('hi-cell')[0], cells[0], 'the grid was not rebuilt');
  assert.equal(cells[0].find('hi-cell-lv').style.getPropertyValue('--rank'), RANK_COLORS[1]);
  assert.equal(cells[2].find('hi-cell-lv').style.getPropertyValue('--rank'), RANK_COLORS[2]);
});

test('the explanations quote the config numbers', () => {
  assert.equal(rankBonusText(), 'Each rank: +5% damage, +10% health, +0.5 armor.');
  assert.equal(rankProgressText(0, 0), `Recruit · XP 0 / ${RANK_XP[1]}`);
  assert.equal(rankProgressText(3, 12345), 'Champion · Max rank');
  assert.equal(rankProgressText(1, 1234.7), `Veteran · XP 1,234 / ${RANK_XP[2]}`);
});
