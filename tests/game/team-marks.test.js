// Team pings and markers on this screen (src/game/team-marks.js, and Game.sendMark / Game.onMark):
// how long each stands, what replaces what, the caps, the pace a player may send at, and the chime
// and message a teammate's marker brings. Methods run on small fake Game objects, as the other game
// tests do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TeamMarks } from '../../src/game/team-marks.js';
import { Game } from '../../src/game/game.js';
import { sfx } from '../../src/audio/sfx.js';
import { RateLimiter } from '../../src/net/protocol.js';
import { MARKS, MARK_MAX_PER_PLAYER, MARK_MAX_TOTAL, MARK_SEND_RATE } from '../../src/data/marks.js';

// ---------------------------------------------------------------- the store

test('a mark stands for the lifetime of its kind and is gone after it', () => {
  const marks = new TeamMarks();
  const ping = marks.add({ from: 1, kind: 'ping', x: 4, y: 5 }, 1000);
  const attack = marks.add({ from: 1, kind: 'attack', x: 6, y: 7 }, 1000);
  assert.equal(ping.t1 - ping.t0, MARKS.ping.life * 1000);
  assert.equal(attack.t1 - attack.t0, MARKS.attack.life * 1000);
  assert.ok(MARKS.ping.life < MARKS.attack.life, 'a ping is brief, a marker lasts');
  assert.deepEqual(marks.active(1000).map((m) => m.kind), ['ping', 'attack']);
  assert.deepEqual(marks.active(1000 + 5999).map((m) => m.kind), ['ping', 'attack']);
  assert.deepEqual(marks.active(1000 + 6000).map((m) => m.kind), ['attack'], 'the ping is gone at its time');
  assert.deepEqual(marks.active(1000 + 12000), []);
  assert.equal(TeamMarks.age(ping, 1000), 0);
  assert.equal(TeamMarks.age(ping, 1000 + 3000), 0.5);
  assert.equal(TeamMarks.age(ping, 99999), 1);
});

test('a typed marker moves when its sender calls it again; pings and other senders’ markers stay', () => {
  const marks = new TeamMarks();
  marks.add({ from: 1, kind: 'attack', x: 1, y: 1 }, 0);
  marks.add({ from: 2, kind: 'attack', x: 2, y: 2 }, 0);
  marks.add({ from: 1, kind: 'ping', x: 3, y: 3 }, 0);
  marks.add({ from: 1, kind: 'ping', x: 4, y: 4 }, 0);
  const moved = marks.add({ from: 1, kind: 'attack', x: 9, y: 9 }, 100);
  const list = marks.active(100);
  assert.equal(list.filter((m) => m.from === 1 && m.kind === 'attack').length, 1, 'one Attack per player');
  assert.deepEqual([moved.x, moved.y], [9, 9]);
  assert.equal(list.filter((m) => m.from === 2 && m.kind === 'attack').length, 1, 'the other player’s stays');
  assert.equal(list.filter((m) => m.kind === 'ping').length, 2, 'pings add up');
});

test('one player has a few marks up at once, then the oldest makes way; the screen has a total cap too', () => {
  const marks = new TeamMarks();
  for (let i = 0; i < MARK_MAX_PER_PLAYER + 3; i++) marks.add({ from: 1, kind: 'ping', x: i, y: 0 }, i);
  const mine = marks.active(10).filter((m) => m.from === 1);
  assert.equal(mine.length, MARK_MAX_PER_PLAYER);
  assert.deepEqual(mine.map((m) => m.x), [3, 4, 5], 'the newest ones');
  marks.add({ from: 2, kind: 'ping', x: 0, y: 0 }, 11);
  assert.equal(marks.active(11).filter((m) => m.from === 1).length, MARK_MAX_PER_PLAYER, 'another player does not push mine out');
  const crowd = new TeamMarks();
  for (let p = 0; p < MARK_MAX_TOTAL; p++) {
    for (let i = 0; i < MARK_MAX_PER_PLAYER; i++) crowd.add({ from: p, kind: 'ping', x: i, y: p }, p);
  }
  assert.equal(crowd.active(100).length, MARK_MAX_TOTAL);
  assert.equal(crowd.active(100)[crowd.active(100).length - 1].from, MARK_MAX_TOTAL - 1, 'the newest is kept');
});

test('a mark of an unknown kind or at a spot that is not a number is refused', () => {
  const marks = new TeamMarks();
  for (const bad of [
    null, undefined, {}, { from: 1, kind: 'nuke', x: 1, y: 1 }, { from: 1, kind: '__proto__', x: 1, y: 1 }, { from: 1, kind: 'ping', x: NaN, y: 1 },
    { from: 1, kind: 'ping', x: 1, y: Infinity }, { from: 1, kind: 'ping', x: '1', y: 1 },
  ]) assert.equal(marks.add(bad, 0), null, JSON.stringify(bad));
  assert.equal(marks.active(0).length, 0);
  marks.add({ from: 1, kind: 'ping', x: 1, y: 1 }, 0);
  marks.clear();
  assert.equal(marks.active(0).length, 0);
});

// ---------------------------------------------------------------- Game.sendMark

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

function fakeGame(over = {}) {
  const sent = [];
  const messages = [];
  const chat = [];
  const game = {
    disposed: false,
    ended: false,
    myIndex: 0,
    marks: new TeamMarks(),
    markLimit: new RateLimiter(...MARK_SEND_RATE),
    session: { sendMark: (m) => { sent.push(m); return m; } },
    hud: { message: (text, kind) => messages.push([text, kind]), chat: (line) => chat.push(line) },
    ...over,
  };
  return { game, sent, messages, chat };
}

test('Game.sendMark gives the session a kind and a spot, and says whether it went', () => {
  const { game, sent } = fakeGame();
  assert.equal(Game.prototype.sendMark.call(game, 'attack', 12.5, 30), true);
  assert.deepEqual(sent, [{ kind: 'attack', x: 12.5, y: 30 }]);
});

test('Game.sendMark paces a player under what the host accepts, says so when it refuses one, and recovers', () => {
  let t = 0;
  const { game, sent, messages } = fakeGame({ markLimit: new RateLimiter(...MARK_SEND_RATE, () => t) });
  let went = 0;
  for (let i = 0; i < 12; i++) if (Game.prototype.sendMark.call(game, 'ping', i, 0)) went++;
  assert.equal(went, MARK_SEND_RATE[1], 'a burst, then no more');
  assert.equal(sent.length, MARK_SEND_RATE[1]);
  assert.equal(messages.length, 12 - went);
  assert.deepEqual(messages[0], ['Slow down: too many pings.', 'error']);
  t += 2000;
  assert.equal(Game.prototype.sendMark.call(game, 'ping', 1, 1), true, 'after a pause it works again');
});

test('Game.sendMark does nothing for an unknown kind, a finished match or a session that cannot mark', () => {
  const a = fakeGame();
  assert.equal(Game.prototype.sendMark.call(a.game, 'nuke', 1, 1), false);
  const b = fakeGame({ ended: true });
  assert.equal(Game.prototype.sendMark.call(b.game, 'ping', 1, 1), false);
  const c = fakeGame({ disposed: true });
  assert.equal(Game.prototype.sendMark.call(c.game, 'ping', 1, 1), false);
  const d = fakeGame({ session: {} });
  assert.equal(Game.prototype.sendMark.call(d.game, 'ping', 1, 1), false);
  const e = fakeGame({ session: { sendMark: () => null } });
  assert.equal(Game.prototype.sendMark.call(e.game, 'ping', 1, 1), false, 'the session refused it');
  assert.equal(a.sent.length + b.sent.length + c.sent.length, 0);
});

// ---------------------------------------------------------------- Game.onMark

test('a teammate’s ping chimes and stands on the screen; a plain ping has no message line', () => {
  const { game, chat } = fakeGame();
  const calls = recordSounds(() => Game.prototype.onMark.call(game, { from: 1, name: 'Ann', kind: 'ping', x: 8, y: 9 }));
  assert.deepEqual(calls.map((c) => c[0]), ['ping']);
  assert.equal(calls[0][1].volume, 1);
  assert.equal(game.marks.active(performance.now()).length, 1);
  assert.deepEqual(chat, []);
});

test('a teammate’s marker also says its words in their colour; the urgent one rings the louder chime', () => {
  const { game, chat } = fakeGame();
  const calls = recordSounds(() => {
    Game.prototype.onMark.call(game, { from: 2, name: 'Ben', kind: 'attack', x: 1, y: 1 });
    Game.prototype.onMark.call(game, { from: 2, name: 'Ben', kind: 'help', x: 2, y: 2 });
  });
  assert.deepEqual(calls.map((c) => c[0]), ['ping', 'ping_urgent']);
  assert.deepEqual(chat, [
    { from: 2, name: 'Ben', text: MARKS.attack.text },
    { from: 2, name: 'Ben', text: MARKS.help.text },
  ]);
});

test('my own mark is quieter, has no message line, and a bad one is ignored', () => {
  const { game, chat } = fakeGame();
  const calls = recordSounds(() => {
    Game.prototype.onMark.call(game, { from: 0, name: 'Me', kind: 'defend', x: 3, y: 3 });
    Game.prototype.onMark.call(game, { from: 1, name: 'Ann', kind: 'nuke', x: 3, y: 3 });
    Game.prototype.onMark.call(game, null);
  });
  assert.equal(calls.length, 1);
  assert.ok(calls[0][1].volume < 1);
  assert.deepEqual(chat, []);
  assert.equal(game.marks.active(performance.now()).length, 1);
  const gone = fakeGame({ disposed: true });
  assert.deepEqual(recordSounds(() => Game.prototype.onMark.call(gone.game, { from: 1, name: 'Ann', kind: 'ping', x: 1, y: 1 })), []);
});
