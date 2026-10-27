// How to Play (src/ui/menu-howto.js): the Town Center is introduced once with its on-screen
// names, and the controls that exist but are easy to miss are listed. Fake DOM.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { BUILDINGS } from '../../src/data/index.js';

let text;
before(async () => {
  installFakeDom();
  // menu-dom's h() asks `instanceof Node`; the fake nodes carry a nodeType instead.
  globalThis.Node = class {
    static [Symbol.hasInstance](x) {
      return !!x && (x.nodeType === 1 || x.nodeType === 3);
    }
  };
  const { renderHowToContent } = await import('../../src/ui/menu-howto.js');
  text = renderHowToContent().textContent;
});

test('the Town Center is introduced with its Village Hall / Town Hall / City Palace names', () => {
  const [village, town, city] = BUILDINGS.town_center.tierNames;
  assert.match(text, new RegExp(`a Town Center \\(your ${village}, which becomes a ${town} and then a ${city}\\)`));
  assert.equal(text.split(village).length - 1, 1, 'said once, not at every mention');
});

test('the Decade of Peace game mode is explained with its lengths', () => {
  assert.match(text, /Decade of Peace game mode/);
  assert.match(text, /for 30, 45 or 60 minutes no player can harm another/);
  assert.match(text, /countdown beside the game clock/);
  assert.match(text, /creatures still fight/);
});

test('controls that were undocumented are listed', () => {
  for (const part of [
    'The same, with a single click', // Ctrl+click
    'queues up to 5 at once', // Shift + train
    'keep placing more', // Shift + place
    'take back its last queued unit', // Esc on a producer
    'Shift or Ctrl: select all of them', // idle worshippers
    'another command hotkey replaces the pending order',
    'Zoom in and out (smoothly on a trackpad)',
  ]) assert.ok(text.includes(part), part);
});

test('soldier ranks are explained with the numbers from the config', () => {
  assert.match(text, /rise from Recruit to Veteran, Elite and Champion/);
  assert.match(text, /Each rank adds 5% damage, 10% health and 0\.5 armor/);
});

test('the pantheon soldier and the pantheon blessings are explained, with the Barracks key for the soldier', () => {
  assert.ok(text.includes('Know your pantheon'));
  assert.match(text, /two blessings that work from the first second/);
  assert.match(text, /one elite soldier that only your pantheon fields/);
  assert.match(text, /your pantheon's own soldier/);
});

test('walls are explained: the build key, dragging a line, the stone upgrade, towers and the keys', () => {
  assert.match(text, /C Town Center · W Wooden Wall/, 'the build menu lists the wall');
  assert.match(text, /press on a tile and drag to lay a whole line of wall/);
  assert.match(text, /choose Wooden Wall in the build menu \(W\)/);
  assert.match(text, /a line of up to 48 segments/);
  assert.match(text, /goes up only within 24 tiles of the Worshippers you order/);
  assert.match(text, /Walls block every ground unit, yours too/);
  assert.match(text, /upgrade it to stone \(1000 health and 6 armor instead of 350 and 1\)/);
  assert.match(text, /A Tower raised on a wall, or in line with one, becomes part of the wall/);
  assert.match(text, /Wall segments: upgrade to stone \(U\) or dismantle \(D\)/);
});

test('team pings and markers are explained: the gestures, the buttons and who sees them', () => {
  assert.ok(text.includes('Team signals'));
  assert.match(text, /Alt\+ClickPing your team at that spot on the map or the minimap/);
  assert.match(text, /not while aiming an order or placing a building/);
  assert.match(text, /Middle-clickThe same with the middle button/);
  assert.match(text, /Beside the minimap: Ping, Attack, Defend, Help and Gather/);
  assert.match(text, /Only your teammates/);
});
