// Game controller feedback (src/game/game.js): spell sounds by shape, the hearing
// range following the zoom, independent frame stages, quiet ambient sounds while
// paused or walking, one defeat jingle, and pausing a solo match in a hidden tab.
// Methods run on small fake Game objects, as the other game tests do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, effectSound, hearingScale } from '../../src/game/game.js';
import { sfx } from '../../src/audio/sfx.js';

/** Record sfx.play calls while fn runs. */
function recordSounds(fn) {
  const calls = [];
  sfx.play = (name, opts) => {
    calls.push([name, opts]);
    return true;
  };
  try {
    fn();
  } finally {
    delete sfx.play;
  }
  return calls;
}

test('spell sounds: quakes, meteors and storms are not the sparkling chime; offensive holy spells are not the heal bells', () => {
  assert.deepEqual(effectSound({ shape: 'heal', el: 'water' }), ['heal', 1]);
  assert.equal(effectSound({ shape: 'quake', el: 'earth' })[0], 'lightning');
  assert.equal(effectSound({ shape: 'meteor', el: 'moon' })[0], 'fire');
  assert.deepEqual(effectSound({ shape: 'storm', el: 'lightning' }), ['lightning', 1]);
  assert.equal(effectSound({ shape: 'storm', el: 'wind' })[0], 'lightning');
  assert.ok(effectSound({ shape: 'storm', el: 'wind' })[1] < 1, 'a wind storm is quieter than a lightning one');
  for (const shape of ['nova', 'chain', 'field', 'strike', 'summon']) assert.equal(effectSound({ shape, el: 'holy' })[0], 'magic', shape);
  for (const shape of ['buff', 'shield']) assert.equal(effectSound({ shape, el: 'holy' })[0], 'heal', shape);
  assert.equal(effectSound({ shape: 'strike', el: 'lightning' })[0], 'lightning');
  assert.equal(effectSound({ shape: 'nova', el: 'sun' })[0], 'fire');
  assert.equal(effectSound({ shape: 'nova', el: 'death' })[0], 'magic');
});

test('an enemy Titan being summoned has its own sound, not the horn of the under-attack alert', () => {
  const banners = [];
  const game = {
    disposed: false,
    viewState: { myIndex: 0, isAlly: () => false, players: [{ name: 'Me' }, { name: 'Foe' }] },
    hud: { showBanner: (text, kind) => banners.push([text, kind]) },
    playerName: (i) => (i === 1 ? 'Foe' : 'Me'),
  };
  const calls = recordSounds(() => Game.prototype.onEvent.call(game, { type: 'titanSummoning', player: 1, t: 'nope' }));
  assert.equal(banners.length, 1);
  assert.equal(banners[0][1], 'danger');
  assert.deepEqual(calls.map((c) => c[0]), ['summon_titan']);
});

test('hearing range follows the zoom: wider zoomed out, narrower zoomed in, never extreme', () => {
  const cam = (distance) => ({ distance, opts: { defaultDistance: 25 } });
  assert.equal(hearingScale(cam(25)), 1);
  assert.ok(hearingScale(cam(44)) > 1.5 && hearingScale(cam(44)) <= 1.8);
  assert.equal(hearingScale(cam(10)), 0.8);
  assert.equal(hearingScale(cam(500)), 1.8);
  assert.equal(hearingScale({}), 1, 'a camera without a distance is neutral');
  assert.equal(hearingScale(null), 1);
});

test('a stage that throws every frame does not freeze the HUD or the game-over check, and the error list stays short', () => {
  globalThis.requestAnimationFrame = () => 0;
  const quiet = console.error;
  console.error = () => {};
  try {
    let hudCalls = 0;
    let endCalls = 0;
    let ambientCalls = 0;
    const game = {
      disposed: false,
      raf: 0,
      lastFrame: 0,
      paused: false,
      needsRender: false,
      errors: [],
      stats: { frames: 0, cpuMs: 0, maxMs: 0, renderMs: 0, hudMs: 0, last: [] },
      viewState: { update() {} },
      selection: { prune() {} },
      input: { update() {} },
      renderer: {
        camera: { target: { x: 10, y: 10 }, distance: 25 },
        update() {
          throw new Error('renderer fault');
        },
        render() {},
      },
      hud: { update: () => hudCalls++ },
      checkEnd: () => endCalls++,
      ambientSounds: () => ambientCalls++,
      frameFault: Game.prototype.frameFault,
    };
    for (let i = 0; i < 200; i++) Game.prototype.frame.call(game, 16 * (i + 1));
    assert.equal(hudCalls, 200, 'the HUD kept updating');
    assert.equal(endCalls, 200, 'and so did the game-over check');
    assert.equal(ambientCalls, 200);
    assert.ok(game.errors.length > 0 && game.errors.length <= 20, `kept ${game.errors.length} errors`);
    assert.equal(game.stats.frames, 200);
  } finally {
    console.error = quiet;
    delete globalThis.requestAnimationFrame;
    sfx.setListener(NaN, NaN);
  }
});

test('ambient work sounds: not while paused, not from workers still walking, reach grows with the zoom', () => {
  const worker = (o) => ({ k: 'u', o: 0, st: 'gather', tg: 7, x: 50, y: 50, ix: 50, iy: 50, ...o });
  const make = (entities, distance = 25, paused = false) => ({
    paused,
    lastAmbient: -10000,
    renderer: { camera: { target: { x: 50, y: 50 }, distance, opts: { defaultDistance: 25 } } },
    viewState: { myIndex: 0, entities: new Map(entities.map((e, i) => [i + 1, e])) },
  });
  const run = (game) => recordSounds(() => Game.prototype.ambientSounds.call(game, 1000));

  const still = run(make([worker({})]));
  assert.deepEqual(still.map((c) => c[0]), ['mine'], 'a worker at the mine is heard');
  assert.deepEqual(run(make([worker({ tg: 0 })])).map((c) => c[0]), ['chop']);
  assert.equal(run(make([worker({})], 25, true)).length, 0, 'silent while the game is paused');
  assert.equal(run(make([worker({ ix: 49.6 })])).length, 0, 'a worker on its way (drawn behind its newest position) makes no work noise');
  assert.equal(run(make([worker({ x: 70, ix: 70 })])).length, 0, '20 tiles away is out of range at the default zoom');
  assert.equal(run(make([worker({ x: 70, ix: 70 })], 44)).length, 1, 'but in range when zoomed out');
});

test('the defeat jingle plays once: when the local player falls, not again at the game-over screen', () => {
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => 0; // the game-over panel's delay
  try {
    const vs = { gameOver: null, myTeam: 1, me: { defeated: true } };
    const shown = [];
    const game = {
      disposed: false,
      overShown: false,
      defeatSounded: false,
      input: null,
      viewState: vs,
      hud: { overlays: { defeatShown: false, showDefeated: () => shown.push('defeated'), showGameOver: () => shown.push('over') } },
    };
    let calls = recordSounds(() => Game.prototype.checkEnd.call(game));
    assert.deepEqual(calls.map((c) => c[0]), ['defeat']);
    vs.gameOver = { winningTeam: 2 };
    calls = recordSounds(() => Game.prototype.checkEnd.call(game));
    assert.deepEqual(calls, [], 'the team lost, but the jingle was already heard');
    assert.equal(game.overShown, true);

    const fresh = { ...game, overShown: false, defeatSounded: false, viewState: { gameOver: { winningTeam: 2 }, myTeam: 1, me: {} } };
    calls = recordSounds(() => Game.prototype.checkEnd.call(fresh));
    assert.deepEqual(calls.map((c) => c[0]), ['defeat'], 'a loss that ends the match plays it once');
    const won = { ...game, overShown: false, defeatSounded: true, viewState: { gameOver: { winningTeam: 1 }, myTeam: 1, me: {} } };
    calls = recordSounds(() => Game.prototype.checkEnd.call(won));
    assert.deepEqual(calls.map((c) => c[0]), ['victory']);
  } finally {
    globalThis.setTimeout = realTimeout;
  }
});

test('a hidden tab opens the (pausing) game menu in a solo match only', () => {
  const listeners = [];
  globalThis.document = {
    hidden: false,
    addEventListener: (type, fn) => listeners.push([type, fn]),
    removeEventListener: () => {},
  };
  try {
    let opened = 0;
    const make = (over = {}) => ({
      offs: [],
      disposed: false,
      ended: false,
      paused: false,
      session: { isHost: true, ticker: {}, clients: new Map(), stopped: false },
      viewState: { gameOver: null, me: { defeated: false } },
      hud: { overlays: { open: false, openMenu: () => opened++ } },
      ...over,
    });
    const hide = (game) => {
      listeners.length = 0;
      document.hidden = false;
      Game.prototype.watchVisibility.call(game);
      assert.equal(listeners[0][0], 'visibilitychange');
      assert.equal(game.offs.length, 1, 'the listener is removed on teardown');
      document.hidden = false;
      listeners[0][1]();
      assert.equal(opened, 0, 'showing the tab does nothing');
      document.hidden = true;
      listeners[0][1]();
    };
    hide(make());
    assert.equal(opened, 1, 'solo: paused through the menu');
    opened = 0;
    hide(make({ session: { isHost: true, ticker: {}, clients: new Map([[1, {}]]), stopped: false } }));
    assert.equal(opened, 0, 'a host with players connected keeps running');
    hide(make({ session: { isHost: false } }));
    assert.equal(opened, 0, 'a client has no clock to stop');
    hide(make({ paused: true }));
    hide(make({ viewState: { gameOver: { winningTeam: 1 }, me: {} } }));
    hide(make({ viewState: { gameOver: null, me: { defeated: true } } }));
    hide(make({ hud: { overlays: { open: true, openMenu: () => opened++ } } }));
    assert.equal(opened, 0, 'already paused, over, defeated or in a panel: nothing to open');
    // The player switched tabs while the match was still loading: no event will come, so it pauses at once.
    listeners.length = 0;
    document.hidden = true;
    Game.prototype.watchVisibility.call(make());
    assert.equal(opened, 1, 'a tab that is already hidden when the match is up pauses it');
  } finally {
    delete globalThis.document;
  }
});
