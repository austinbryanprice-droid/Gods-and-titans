// Computer allies answer a teammate's markers (DESIGN 10, "Answering team marks"): an Attack
// marker sends a share of the army there and keeps a guard home, Help pulls the army to the
// marked spot, enemies never see it, an order expires and a newer one replaces it, the AI's
// voice answers to the team only, and it all stays deterministic through replays and saves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../../src/sim/world.js';
import { createAI } from '../../src/ai/ai.js';
import { AIVoices, createVoices } from '../../src/ai/voice.js';
import { MARK_SHARE } from '../../src/ai/marks.js';
import { TEAM_ORDER_LIFE, teamOrderFor } from '../../src/sim/team-orders.js';
import { normalizeCommand } from '../../src/sim/commands.js';
import { compactCommand, worldChecksum, ReplayRecorder } from '../../src/game/replay.js';
import { ReplaySession } from '../../src/game/replay-session.js';
import { HostSession } from '../../src/net/session.js';
import { buildSetup } from '../../src/net/lobby.js';
import { packMatch, unpackMatch } from '../../src/game/save-game.js';
import { TICK_RATE } from '../../src/config.js';

/**
 * A 2v2: player 0 is the human (idle here), 1 its computer ally; 2 and 3 the enemies, AIs when
 * `enemyAI`, else idle. Each AI side gets a ready army of 16 warriors next to its Town Center.
 */
function teamGame({ seed = 7, enemyAI = false, difficulty = 'normal', army = 16 } = {}) {
  const kinds = ['human', 'ai', enemyAI ? 'ai' : 'human', enemyAI ? 'ai' : 'human'];
  const world = createWorld({
    version: '0.1.0',
    seed,
    mapSize: 'medium',
    players: kinds.map((kind, i) => ({ index: i, name: `P${i}`, team: i < 2 ? 1 : 2, pantheon: ['greek', 'norse', 'egyptian', 'celtic'][i], kind, difficulty: kind === 'ai' ? difficulty : null })),
  });
  const ais = new Map();
  kinds.forEach((k, i) => {
    if (k === 'ai') ais.set(i, createAI(world, i, difficulty));
  });
  const tc = (i) => world.buildingsOf(i).find((b) => b.type === 'town_center');
  for (const i of ais.keys()) {
    const t = tc(i);
    for (let k = 0; k < army; k++) world.spawnUnit(i, 'warrior', t.x + 5 + (k % 4), t.y + 5 + Math.floor(k / 4), { silent: true });
  }
  const step = (seconds) => {
    const n = Math.round(seconds * TICK_RATE);
    for (let k = 0; k < n && !world.gameOver; k++) {
      for (const a of ais.values()) a.tick();
      world.tick();
      world.events.length = 0;
      world.felled.length = 0;
    }
  };
  const mark = (from, kind, x, y) => world.issueCommand(from, { type: 'teamMark', kind, x, y });
  const warriors = (i) => world.unitsOf(i).filter((u) => u.type === 'warrior' && !u.dead);
  return { world, ais, step, mark, tc, warriors };
}

const near = (u, p, r) => Math.hypot(u.x - p.x, u.y - p.y) <= r;
const headingTo = (u, p, r) => !!u.order && Number.isFinite(u.order.x) && Math.hypot(u.order.x - p.x, u.order.y - p.y) <= r;

test('the sim keeps one standing order per player, for their own team only, until it expires', () => {
  const g = teamGame();
  g.mark(0, 'attack', 40, 40);
  g.mark(0, 'ping', 10, 10); // not an order kind: ignored
  g.step(0.1);
  let o = teamOrderFor(g.world, 1);
  assert.equal(o.kind, 'attack');
  assert.equal(o.from, 0);
  assert.equal(teamOrderFor(g.world, 0), null, 'not the sender\'s own');
  assert.equal(teamOrderFor(g.world, 2), null, 'never an enemy');
  assert.equal(teamOrderFor(g.world, 3), null);
  g.mark(0, 'help', 20, 30); // a newer one replaces it
  g.step(0.1);
  o = teamOrderFor(g.world, 1);
  assert.equal(o.kind, 'help');
  assert.equal(g.world.teamMarks.length, 1);
  g.step(TEAM_ORDER_LIFE.help);
  assert.equal(teamOrderFor(g.world, 1), null, 'expired');
  // A defeated player still marks for the team.
  g.world.players[0].defeated = true;
  g.mark(0, 'defend', 30, 30);
  g.step(0.1);
  assert.equal(teamOrderFor(g.world, 1).kind, 'defend');
  // Snapshots go to everyone: the order is never in one.
  assert.ok(!JSON.stringify(g.world.getSnapshot()).includes('teamMark'));
});

test('an Attack marker sends most of the ally\'s army there within a few seconds, a guard stays home', () => {
  const g = teamGame();
  g.step(5);
  const target = g.tc(2);
  const spot = { x: target.x, y: target.y + 4 };
  g.mark(0, 'attack', spot.x, spot.y);
  g.step(3);
  const ai = g.ais.get(1).ai;
  assert.equal(ai.mil.mode, 'mark');
  const ws = g.warriors(1);
  const going = ws.filter((u) => headingTo(u, spot, 8));
  const home = ws.length - going.length;
  assert.ok(going.length >= Math.floor(ws.length * MARK_SHARE.attack) - 1, `${going.length} of ${ws.length} sent`);
  assert.ok(home >= 3, `${home} kept home`);
  const before = going.map((u) => Math.hypot(u.x - spot.x, u.y - spot.y));
  g.step(15);
  const after = going.map((u) => Math.hypot(u.x - spot.x, u.y - spot.y));
  const closer = after.filter((d, i) => d < before[i] - 10).length;
  assert.ok(closer >= going.length * 0.8, `${closer} of ${going.length} marched on`);
  assert.equal(ai.errors, 0);
});

test('a Help marker pulls the army to the marked ally base, and the order expires', () => {
  const g = teamGame();
  g.step(5);
  const base = g.tc(0);
  const spot = { x: base.x, y: base.y + 4 };
  g.mark(0, 'help', spot.x, spot.y);
  g.step(45);
  const ai = g.ais.get(1).ai;
  const ws = g.warriors(1);
  const there = ws.filter((u) => near(u, spot, 14)).length;
  assert.ok(there >= Math.floor(ws.length * MARK_SHARE.help) - 1, `${there} of ${ws.length} at the ally's base`);
  // After the order runs out the army goes home to its rally point.
  g.step(TEAM_ORDER_LIFE.help - 45 + 2);
  assert.notEqual(ai.mil.mode, 'mark');
  g.step(40);
  const rally = ai.rallyPoint();
  const back = ws.filter((u) => !u.dead && near(u, rally, 14)).length;
  assert.ok(back >= ws.length * 0.8, `${back} of ${ws.length} back home`);
});

test('the enemy AIs never see a marker', () => {
  const g = teamGame({ enemyAI: true });
  g.step(5);
  const spot = { x: g.tc(3).x, y: g.tc(3).y + 4 };
  g.mark(0, 'attack', spot.x, spot.y);
  for (let k = 0; k < 10; k++) {
    g.step(2);
    for (const i of [2, 3]) assert.notEqual(g.ais.get(i).ai.mil.mode, 'mark');
  }
  assert.equal(g.ais.get(1).ai.mil.mode, 'mark');
});

test('a newer marker replaces the older one; an Attack marker waits out a Decade of Peace', () => {
  const g = teamGame();
  g.step(5);
  const ai = g.ais.get(1).ai;
  g.mark(0, 'attack', g.tc(2).x, g.tc(2).y);
  g.step(2);
  assert.equal(ai.mil.mark.kind, 'attack');
  const base = g.tc(0);
  g.mark(0, 'defend', base.x, base.y + 4);
  g.step(2);
  assert.equal(ai.mil.mark.kind, 'defend');
  assert.ok(g.warriors(1).filter((u) => headingTo(u, { x: base.x, y: base.y + 4 }, 8)).length >= 10);

  const p = teamGame();
  p.world.peace = true;
  p.world.peaceEnd = 1e9;
  p.step(5);
  p.mark(0, 'attack', p.tc(2).x, p.tc(2).y);
  p.step(3);
  assert.notEqual(p.ais.get(1).ai.mil.mode, 'mark');
});

/** Everything that matters of a world, as text. */
function state(world) {
  return JSON.stringify({
    sum: worldChecksum(world),
    units: world.unitList.filter((u) => !u.dead).map((u) => [u.id, u.owner, u.x.toFixed(4), u.y.toFixed(4), u.hp, u.order && u.order.type]),
    marks: world.teamMarks,
  });
}

test('two worlds given the same markers on the same ticks stay identical', () => {
  const run = (marks) => {
    const g = teamGame({ enemyAI: true, seed: 3 });
    for (let s = 0; s < 90; s++) {
      if (marks && s === 10) g.mark(0, 'attack', g.tc(2).x, g.tc(2).y);
      if (marks && s === 50) g.mark(0, 'help', g.tc(0).x, g.tc(0).y + 4);
      g.step(1);
    }
    return state(g.world);
  };
  const a = run(true);
  assert.equal(run(true), a);
  assert.notEqual(run(false), a, 'the markers changed the game');
});

test('the command survives the replay\'s compact form, and a save carries the orders and the AI\'s answer', () => {
  const map = { width: 200, height: 200 };
  const cmd = normalizeCommand({ type: 'teamMark', kind: 'help', x: 12.5, y: 40 }, map);
  assert.deepEqual(compactCommand(cmd), { type: 'teamMark', kind: 'help', x: 12.5, y: 40 });
  assert.deepEqual(normalizeCommand(compactCommand(cmd), map), cmd);

  const g = teamGame({ enemyAI: true, seed: 5 });
  g.step(5);
  g.mark(0, 'attack', g.tc(2).x, g.tc(2).y);
  g.step(6);
  assert.equal(g.ais.get(1).ai.mil.mode, 'mark');
  const loaded = unpackMatch(JSON.parse(JSON.stringify(packMatch(g.world, g.ais))));
  assert.deepEqual(loaded.world.teamMarks, g.world.teamMarks);
  assert.equal(loaded.ais.get(1).ai.mil.mode, 'mark');
  for (let k = 0; k < 30 * TICK_RATE; k++) {
    for (const w of [g, loaded]) {
      for (const a of w.ais.values()) a.tick();
      w.world.tick();
      w.world.events.length = 0;
      w.world.felled.length = 0;
    }
  }
  assert.equal(state(loaded.world), state(g.world));
});

test('the ally answers a marker in chat, to the team only, at most every ackGap; campaigns stay quiet', () => {
  const g = teamGame({ enemyAI: true });
  const voices = new AIVoices(g.world, [1, 2, 3]);
  const lines = [];
  const run = (s) => {
    for (let k = 0; k < s * TICK_RATE; k++) {
      for (const a of g.ais.values()) a.tick();
      g.world.tick();
      lines.push(...voices.step(g.world.events));
      g.world.events.length = 0;
    }
  };
  run(20);
  lines.length = 0;
  g.mark(0, 'attack', g.tc(2).x, g.tc(2).y);
  run(1);
  const acks = lines.filter((l) => l.team);
  assert.equal(acks.length, 1);
  assert.equal(acks[0].from, 1, 'the ally answers, never an enemy');
  g.mark(0, 'help', g.tc(0).x, g.tc(0).y);
  run(1);
  assert.equal(lines.filter((l) => l.team).length, 1, 'rate-limited');
  run(20);
  g.mark(0, 'defend', g.tc(0).x, g.tc(0).y);
  run(1);
  assert.equal(lines.filter((l) => l.team).length, 2);
  assert.ok(lines.filter((l) => l.team).every((l) => l.from === 1));
  assert.equal(createVoices({ ...g.world, setup: { ...g.world.setup, campaign: 'ch1-m1' } }, [1]), null);
});

test('a hosted game with markers is recorded, and its replay plays back to the same world', () => {
  const { setup } = buildSetup({
    roomCode: 'ABCD', mapSize: 'small', peace: 0, sacred: false, started: true,
    slots: [
      { kind: 'host', name: 'Me', pantheon: 'greek', team: 1, color: 0, difficulty: 'normal', peerId: 'me' },
      { kind: 'ai', name: '', pantheon: 'norse', team: 1, color: 1, difficulty: 'normal', peerId: null },
      { kind: 'ai', name: '', pantheon: 'egyptian', team: 2, color: 2, difficulty: 'normal', peerId: null },
      { kind: 'closed', team: 4, color: 3 },
    ],
  }, 21);
  const host = new HostSession({ setup, myIndex: 0, createWorld, createAI, autoTick: false, useWorker: false });
  const rec = new ReplayRecorder({ world: host.world, setup, myIndex: 0, now: () => 1000 }).attach();
  host.viewState.on('snapshot', () => rec.sample());
  host.start();
  const enemy = host.world.buildingsOf(2).find((b) => b.type === 'town_center');
  const mine = host.world.buildingsOf(0).find((b) => b.type === 'town_center');
  for (let t = 0; t < 2400; t++) {
    if (t === 600) host.sendMark({ kind: 'attack', x: enemy.x, y: enemy.y });
    if (t === 1500) host.sendMark({ kind: 'help', x: mine.x, y: mine.y });
    host.step(1);
  }
  const record = rec.finish({ result: null });
  assert.equal(record.cmds.filter((c) => c[2].type === 'teamMark').length, 2);
  assert.equal(host.ais.get(1).ai.mil.mode, 'mark');
  const final = worldChecksum(host.world);
  const s = new ReplaySession({ record, createWorld, autoTick: false, useWorker: false });
  s.start();
  while (!s.ended) s.step(50);
  assert.equal(s.drift, null);
  assert.equal(worldChecksum(s.world), final);
  assert.deepEqual(s.world.teamMarks, host.world.teamMarks);
  host.stop();
  s.stop();
});
