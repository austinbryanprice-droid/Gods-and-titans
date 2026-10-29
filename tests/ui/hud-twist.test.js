// The daily challenge's twist on the HUD (src/ui/hud.js showTwist, DESIGN 9.3): a chip in the top bar
// for the whole match, its icon and name, the rule in the tooltip; none in other games.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Hud } from '../../src/ui/hud.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { ViewState } from '../../src/game/view-state.js';
import { TWISTS } from '../../src/data/twists.js';
import { saveSettings } from '../../src/settings.js';
import { makeWorld } from '../sim/helpers.js';
import { installFakeDom } from './fake-dom.js';

before(() => {
  installFakeDom();
  saveSettings({ tipsDismissed: true });
});

const huds = [];
after(() => {
  for (const h of huds) h.dispose();
});

function setup() {
  const world = makeWorld();
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  vs.pushSnapshot(world.getSnapshot(), 50);
  const root = document.createElement('div');
  const game = { viewState: vs, selection: new Selection(vs), session: null, input: null, renderer: null, command() {}, sendChat() {} };
  const hud = new Hud({ root, game });
  huds.push(hud);
  return hud;
}

test('a normal game has no twist chip', () => {
  const hud = setup();
  hud.update(1000);
  assert.equal(hud.twistChip.hidden, true);
});

test('a daily challenge keeps its twist on a chip: icon and name, the rule in the tooltip', () => {
  for (const tw of TWISTS) {
    const hud = setup();
    hud.showTwist(tw);
    hud.update(1000);
    assert.equal(hud.twistChip.hidden, false, tw.id);
    assert.equal(hud.twistIcon.textContent, tw.icon);
    assert.equal(hud.twistText.textContent, tw.name);
    assert.ok(hud.twistChip.title.includes(tw.name) && hud.twistChip.title.includes(tw.desc), hud.twistChip.title);
    hud.update(2000);
    assert.equal(hud.twistChip.hidden, false, 'it stays for the whole match');
  }
  const hud = setup();
  hud.showTwist(TWISTS[0]);
  hud.showTwist(null);
  assert.equal(hud.twistChip.hidden, true);
});

test('the game controller puts the twist on the chip for a daily challenge, a loaded one too', async () => {
  const src = await readFile(new URL('../../src/game/game.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('if (this.launch && this.launch.daily) {'));
  assert.match(block.slice(0, 400), /this\.hud\.showTwist\(tw\)/);
  assert.match(block.slice(0, 400), /if \(!resumed\) this\.hud\.message/);
});
