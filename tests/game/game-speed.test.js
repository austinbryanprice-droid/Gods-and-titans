// Game speed (DESIGN 9): a match against the computer runs its ticker faster or slower
// (src/net/ticker.js), the view plays back at the same pace (src/game/view-state.js) and
// Game.applySpeed only does so when nobody else is in the match. The interface size is a
// CSS factor on the HUD root.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ticker } from '../../src/net/ticker.js';
import { ViewState } from '../../src/game/view-state.js';
import { Game } from '../../src/game/game.js';
import { makeFakeMap } from '../../src/net/fake-world.js';
import { GAME_SPEEDS, UI_SCALES } from '../../src/config.js';
import { GAME_SPEED_IDS, UI_SCALE_IDS } from '../../src/settings.js';
import { GAME_SPEED_OPTIONS, UI_SCALE_OPTIONS } from '../../src/ui/speed-options.js';

const setup = { version: '0.1.0', seed: 1, mapSize: 'small', players: [{ index: 0, name: 'Me', team: 1, pantheon: 'greek', color: '#d63a3a', kind: 'human' }] };
const players = [{ i: 0, name: 'Me', team: 1, defeated: false }];
const unit = (x) => ({ id: 1, k: 'u', t: 'warrior', o: 0, x, y: 10, f: 0, hp: 420, mhp: 420, sh: 0, st: 'move', tg: 0, c: 0, cd: {}, fx: [] });

test('the option lists match the settings ids and the config factors', () => {
  assert.deepEqual(GAME_SPEED_OPTIONS.map((o) => o[0]), GAME_SPEED_IDS);
  assert.deepEqual(UI_SCALE_OPTIONS.map((o) => o[0]), UI_SCALE_IDS);
  assert.equal(GAME_SPEEDS.normal, 1);
  assert.equal(UI_SCALES.normal, 1);
});

test('Ticker.setSpeed: twice as fast runs twice the ticks in the same real time', () => {
  const t = new Ticker({ onTick() {}, rate: 20, useWorker: false });
  t.setSpeed(2);
  assert.equal(t.interval, 25);
  t.running = true; // drive wake() by hand
  t.t0 = 0;
  assert.equal(t.wake(100), 4, 'four ticks in 100 ms instead of two');
  t.running = false;
  t.setSpeed(0.5);
  assert.equal(t.interval, 100);
  t.setSpeed(-3);
  assert.equal(t.speed, 1, 'a bad factor falls back to normal');
});

test('Ticker.setSpeed on a running ticker re-anchors it at the new pace', () => {
  const t = new Ticker({ onTick() {}, rate: 20, useWorker: false });
  t.start();
  t.due = 7;
  t.setSpeed(1.5);
  assert.ok(t.running);
  assert.equal(t.due, 0);
  assert.ok(Math.abs(t.interval - 1000 / 30) < 1e-9);
  t.stop();
});

test('ViewState.setRate: at double speed the view interpolates with snapshots arriving twice as fast', () => {
  const vs = new ViewState({ setup, mapData: makeFakeMap(48, 48), myIndex: 0, interpDelayMs: 100 });
  vs.setRate(2);
  let local = 1000;
  for (let tick = 1; tick <= 40; tick++) {
    local += 25; // 20 Hz of game time at 2x: one snapshot every 25 real ms
    vs.pushSnapshot({ tick, time: tick * 0.05, players, entities: [unit(10 + tick * 0.1)], fields: [], reveals: [], events: [], felled: [], gameOver: null }, local + 15);
  }
  vs.update(local + 20);
  assert.ok(vs.renderTime < vs.time, 'renders behind the newest snapshot');
  assert.ok(vs.time - vs.renderTime < 0.2, `but close to it (${vs.time - vs.renderTime} s)`);
  // and game time advances twice as fast as local time between frames
  const before = vs.renderTime;
  vs.update(local + 30);
  assert.ok(Math.abs(vs.renderTime - before - 0.02) < 1e-9);
  vs.setRate(1);
  assert.equal(vs.clockOffset, null, 'a new rate re-anchors on the next snapshot');
});

function fakeGame({ solo, gameSpeed = 'faster', uiScale = 'large' } = {}) {
  const calls = [];
  const props = new Map();
  return {
    calls,
    props,
    solo,
    settings: { gameSpeed, uiScale },
    session: { ticker: { setSpeed: (m) => calls.push(['ticker', m]) } },
    viewState: { setRate: (m) => calls.push(['view', m]) },
    renderer: { setSpeed: (m) => calls.push(['render', m]) },
    hudRoot: { style: { setProperty: (k, v) => props.set(k, v) } },
  };
}

test('Game.applySpeed: the chosen speed in a match against the computer, normal otherwise', () => {
  const g = fakeGame({ solo: true });
  Game.prototype.applySpeed.call(g);
  assert.deepEqual(g.calls, [['ticker', 2], ['view', 2], ['render', 2]]);
  assert.equal(g.speed, 2);
  const online = fakeGame({ solo: false });
  Game.prototype.applySpeed.call(online);
  assert.deepEqual(online.calls, [['ticker', 1], ['view', 1], ['render', 1]]);
});

test('Game.onSettings applies a new speed or interface size at once', () => {
  const g = fakeGame({ solo: true, gameSpeed: 'normal' });
  Game.prototype.onSettings.call(Object.assign(g, { applySpeed: Game.prototype.applySpeed, applyUiScale: Game.prototype.applyUiScale }), { gameSpeed: 'slow', uiScale: 'small' }, ['gameSpeed', 'uiScale']);
  assert.deepEqual(g.calls, [['ticker', 0.5], ['view', 0.5], ['render', 0.5]]);
  assert.equal(g.props.get('--hud-scale'), String(UI_SCALES.small));
});
