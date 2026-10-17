// Each match draws on a fresh copy of the page's canvas (src/game/game.js): a
// canvas keeps its first WebGL context, whose attributes (antialias) cannot
// change, so reusing it would keep the first match's quality until a reload.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../src/game/game.js';

class FakeCanvas {
  constructor(id) {
    this.id = id;
    this.className = '';
    this.parent = null;
    this.contextAttrs = null;
  }
  cloneNode() {
    return new FakeCanvas(this.id);
  }
  replaceWith(n) {
    const kids = this.parent.kids;
    kids[kids.indexOf(this)] = n;
    n.parent = this.parent;
    this.parent = null;
  }
}

function fakeRoot() {
  const canvas = new FakeCanvas('game-canvas');
  const hud = { id: 'hud-root', textContent: '' };
  const root = {
    kids: [canvas, hud],
    hidden: true,
    clientWidth: 1280,
    clientHeight: 720,
    querySelector(sel) {
      if (sel === '#game-canvas' || sel === 'canvas') return this.kids.find((k) => k instanceof FakeCanvas) || null;
      if (sel === '#hud-root') return hud;
      return null;
    },
  };
  canvas.parent = root;
  return root;
}

test('every Game gets a new canvas in place of the old one (same id), so context attributes follow the settings', async () => {
  const root = fakeRoot();
  const first = root.querySelector('#game-canvas');
  const quiet = console.error;
  console.error = () => {};
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  try {
    const games = [];
    for (let i = 0; i < 2; i++) {
      // No launch: startup fails at once and tears down (all this test needs is the constructor).
      const g = new Game({ root, settings: { quality: 'high' }, Renderer: class {}, createAI: () => ({ tick() {} }) });
      games.push(g);
      await g.ready.catch(() => {});
    }
    const [a, b] = games.map((g) => g.canvas);
    assert.ok(a !== first && b !== a, 'a new canvas each match');
    assert.equal(root.querySelector('#game-canvas'), b, 'the latest one is in the page');
    assert.equal(b.id, 'game-canvas');
    assert.equal(root.kids.length, 2);
  } finally {
    console.error = quiet;
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
});
