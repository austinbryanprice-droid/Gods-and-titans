// The view's playback clock (src/game/view-state.js) after the sim stood still:
// a single-player pause re-anchors it on resume (Game.setPaused), and any
// stall that makes every snapshot of a second come late is absorbed within
// that second instead of creeping 2 ms per snapshot (during which the view
// would render past its newest snapshot, so units step at the tick rate).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ViewState } from '../../src/game/view-state.js';
import { Game } from '../../src/game/game.js';
import { makeFakeMap } from '../../src/net/fake-world.js';

const setup = { version: '0.1.0', seed: 1, mapSize: 'small', players: [{ index: 0, name: 'Me', team: 1, pantheon: 'greek', color: '#d63a3a', kind: 'human' }] };
const players = [{ i: 0, name: 'Me', team: 1, defeated: false }];
const unit = (x) => ({ id: 1, k: 'u', t: 'warrior', o: 0, x, y: 10, f: 0, hp: 420, mhp: 420, sh: 0, st: 'move', tg: 0, c: 0, cd: {}, fx: [] });

/** A 20 Hz stream of snapshots arriving `latency` ms after their sim time (local clock starts at 1000). */
function stream(vs) {
  let tick = 0;
  let local = 1000;
  const latency = 30;
  return {
    get local() {
      return local;
    },
    /** n more ticks of sim time, one snapshot each, 50 ms apart. */
    run(n) {
      for (let i = 0; i < n; i++) {
        tick++;
        local += 50;
        vs.pushSnapshot({ tick, time: tick * 0.05, players, entities: [unit(10 + tick * 0.1)], fields: [], reveals: [], events: [], felled: [], gameOver: null }, local + latency);
      }
    },
    /** Local time passes with the sim frozen (paused). */
    wait(ms) {
      local += ms;
    },
    /** How far (ms) the view renders past its newest snapshot right after the latest one arrived. */
    ahead() {
      const now = local + latency + 10;
      return now - vs.clockOffset - vs.interpDelayMs - vs.time * 1000;
    },
  };
}

test('a 0.7 s stall: the clock follows within a second instead of rendering ahead for many seconds', () => {
  const vs = new ViewState({ setup, mapData: makeFakeMap(48, 48), myIndex: 0, interpDelayMs: 100 });
  const s = stream(vs);
  s.run(40);
  assert.ok(s.ahead() < 0, `interpolating before the stall (${s.ahead()} ms)`);
  s.wait(700);
  s.run(1);
  assert.ok(s.ahead() > 500, 'right after the stall the view is ahead (nothing to interpolate)');
  s.run(20);
  assert.ok(s.ahead() < 0, `a second later it interpolates again (${s.ahead()} ms ahead)`);
});

test('jitter still barely moves the clock: one late snapshot in a second does not shift it', () => {
  const vs = new ViewState({ setup, mapData: makeFakeMap(48, 48), myIndex: 0, interpDelayMs: 100 });
  const s = stream(vs);
  s.run(25);
  const before = vs.clockOffset;
  s.wait(300); // one snapshot 300 ms late…
  s.run(1);
  s.wait(-300); // …the rest on time again
  s.run(30);
  assert.ok(vs.clockOffset - before <= 2, `moved ${vs.clockOffset - before} ms`);
});

test('Game.setPaused(false) re-anchors the view clock on the next snapshot', () => {
  const vs = new ViewState({ setup, mapData: makeFakeMap(48, 48), myIndex: 0, interpDelayMs: 100 });
  const s = stream(vs);
  s.run(40);
  const ticker = { started: 0, stopped: 0, start() { this.started++; }, stop() { this.stopped++; } };
  const game = { paused: false, viewState: vs, session: { isHost: true, ticker, clients: new Map(), stopped: false } };
  assert.equal(Game.prototype.setPaused.call(game, true), true);
  s.wait(700);
  assert.equal(Game.prototype.setPaused.call(game, false), false);
  assert.equal(ticker.started, 1);
  s.run(1);
  assert.ok(s.ahead() < 0, `interpolating at once after the pause (${s.ahead()} ms ahead)`);
});
