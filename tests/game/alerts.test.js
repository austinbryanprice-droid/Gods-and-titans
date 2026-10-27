// The alert engine (src/game/alerts.js): warnings and reminders that keep a player in the match.
// A real ViewState is fed snapshots at chosen game times, so every timer is game time and the
// tests need no waiting. `notify` collects what the Game would turn into lines, sounds, pings and
// the flash of a background tab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AlertEngine, milestoneStep } from '../../src/game/alerts.js';
import { ViewState } from '../../src/game/view-state.js';
import { godsFor, titanFor, UPGRADES } from '../../src/data/index.js';
import { PEACE_WARNINGS, peaceWarning } from '../../src/ui/hud-data.js';
import { makeWorld } from '../sim/helpers.js';

/**
 * A match seen by player 0; at(time, { edit, events }) shows the next snapshot, edited first.
 * The Worshippers are at work unless `idle` (a fresh world has five standing about, which would speak up).
 */
function scene({ settings = {}, world: worldOpts = {}, idle = false } = {}) {
  const world = makeWorld(worldOpts);
  const base = JSON.parse(JSON.stringify(world.getSnapshot()));
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  const prefs = { alerts: 'all', tabAlerts: 'title', ...settings };
  const out = [];
  const engine = new AlertEngine({ viewState: vs, notify: (a) => out.push(a), settings: () => prefs }).attach();
  let seq = 0;
  const worker = base.entities.find((e) => e.k === 'u' && e.o === 0);
  const town = base.entities.find((e) => e.k === 'b' && e.o === 0);
  const at = (time, { edit, events = [] } = {}) => {
    const snap = JSON.parse(JSON.stringify(base));
    snap.time = time;
    snap.tick = 1000 + ++seq;
    snap.events = events;
    if (!idle) for (const e of snap.entities) if (e.k === 'u' && e.o === 0) e.st = 'gather';
    if (edit) edit(snap);
    vs.pushSnapshot(snap, 50);
  };
  /** Alerts delivered since the last call. */
  const take = () => out.splice(0);
  /** A unit like the player's Worshipper, as another type or owner. */
  const unit = (id, type, owner, x, y, extra = {}) => ({ ...worker, id, t: type, o: owner, x, y, st: 'idle', ...extra });
  const building = (id, type, owner, x, y, extra = {}) => ({ ...town, id, t: type, o: owner, x, y, tx: Math.floor(x) - 1, ty: Math.floor(y) - 1, bp: 1, q: [], ...extra });
  return { world, vs, engine, prefs, take, at, unit, building, town, worker };
}

const ids = (alerts) => alerts.map((a) => a.id);

test('milestoneStep: the highest step reached, 0 below the first', () => {
  const steps = [1, 10, 25];
  assert.equal(milestoneStep(steps, 0), 0);
  assert.equal(milestoneStep(steps, 1), 1);
  assert.equal(milestoneStep(steps, 24), 10);
  assert.equal(milestoneStep(steps, 25), 25);
  assert.equal(milestoneStep(steps, 9999), 25);
});

// ---------------------------------------------------------------- the settings

test('the alerts setting: all lets everything through, important only the warnings, off only the tab flash', () => {
  const reminder = { id: 'idle_workers', level: 'all', kind: 'info', text: 'Idle.', sound: 'nudge', attention: null };
  const warning = { id: 'enemies_near', level: 'important', kind: 'alert', text: 'Enemies!', sound: 'drums', ping: { x: 1, y: 2, color: '#fff' }, jump: { x: 1, y: 2 }, attention: 'Enemies are near your base!' };
  const run = (alerts, tabAlerts, a) => {
    const s = scene({ settings: { alerts, tabAlerts } });
    s.engine.emit(a);
    return s.take();
  };
  assert.deepEqual(ids(run('all', 'title', reminder)), ['idle_workers']);
  assert.equal(run('all', 'title', reminder)[0].sound, 'nudge');

  assert.deepEqual(run('important', 'title', reminder), [], 'a reminder with nothing for the tab is dropped');
  const w = run('important', 'title', warning)[0];
  assert.equal(w.text, 'Enemies!');
  assert.equal(w.sound, 'drums');
  assert.deepEqual(w.ping, { x: 1, y: 2, color: '#fff' });
  assert.deepEqual(w.jump, { x: 1, y: 2 });

  const off = run('off', 'title', warning)[0];
  assert.equal(off.text, null);
  assert.equal(off.sound, null);
  assert.equal(off.ping, null);
  assert.equal(off.jump, null);
  assert.equal(off.attention, 'Enemies are near your base!', 'the tab flash belongs to the tabAlerts setting');

  assert.deepEqual(run('off', 'off', warning), [], 'nothing left to say');
  const quietTab = run('all', 'off', warning)[0];
  assert.equal(quietTab.attention, null);
  assert.equal(quietTab.text, 'Enemies!');
});

test('two alert sounds close together: the second is silent unless it matters more; a gap later it sounds again', () => {
  const s = scene();
  const say = (id, sound) => s.engine.emit({ id, level: 'all', text: id, sound });
  s.vs.time = 100;
  say('idle_workers', 'nudge');
  say('pop_capped', 'nudge');
  s.vs.time = 100.5;
  say('enemies_near', 'drums');
  s.vs.time = 103;
  say('pop_capped', 'nudge');
  const got = s.take();
  assert.deepEqual(got.map((a) => a.sound), ['nudge', null, 'drums', 'nudge']);
  assert.deepEqual(got.map((a) => a.text), ['idle_workers', 'pop_capped', 'enemies_near', 'pop_capped'], 'the lines are never dropped');
});

test('dispose stops listening', () => {
  const s = scene();
  s.at(0);
  s.engine.dispose();
  s.at(1, { events: [{ type: 'peaceEnd' }] });
  assert.deepEqual(s.take(), []);
});

// ---------------------------------------------------------------- warnings

test('my things under attack: only the tab flash (the Game writes the line and blows the horn), and the enemies-near alert keeps quiet right after', () => {
  const s = scene();
  s.at(1);
  s.at(5, { events: [{ type: 'underAttack', player: 0, x: 8, y: 8, id: s.town.id }] });
  const [a] = s.take();
  assert.equal(a.id, 'under_attack');
  assert.equal(a.attention, 'Your base is under attack!');
  assert.equal(a.text, null);
  assert.equal(a.sound, null);
  s.at(6, { events: [{ type: 'underAttack', player: 0, x: 11, y: 8, id: s.worker.id }] });
  assert.equal(s.take()[0].attention, 'Your forces are under attack!');
  // The raiders the horn already announced are not announced again as "sighted".
  const raider = s.unit(900, 'warrior', 1, 14.5, 12.5, { hp: 420, mhp: 420 });
  s.at(7, { edit: (snap) => snap.entities.push(raider) });
  s.at(8, { edit: (snap) => snap.entities.push(raider) });
  assert.deepEqual(s.take(), []);
});

test('enemy units sighted near the base: one alert per incursion, with a ping and a Space target; the first look and a peace stay quiet', () => {
  const s = scene();
  const raider = s.unit(900, 'warrior', 1, 14.5, 12.5, { hp: 420, mhp: 420 });
  const withRaider = { edit: (snap) => snap.entities.push(raider) };
  s.at(1, withRaider); // the match is first seen with them there: nothing to announce
  s.at(2, withRaider);
  assert.deepEqual(s.take(), []);
  s.at(20);
  s.at(31); // gone for 10 s or more
  s.at(32, withRaider);
  const [a] = s.take();
  assert.equal(a.id, 'enemies_near');
  assert.equal(a.kind, 'alert');
  assert.equal(a.text, 'An enemy unit has been sighted near your base!  [[Space]]');
  assert.equal(a.icon, '🚨');
  assert.equal(a.sound, 'drums');
  assert.deepEqual(a.ping, { x: 14.5, y: 12.5, color: '#ffae2e' });
  assert.deepEqual(a.jump, { x: 14.5, y: 12.5 });
  assert.equal(a.attention, 'An enemy is near your base!');
  for (let t = 33; t < 40; t++) s.at(t, withRaider);
  assert.deepEqual(s.take(), [], 'one alert while they stay');
  for (let t = 41; t <= 55; t++) s.at(t); // they leave for 10 s or more
  s.at(56, withRaider);
  assert.deepEqual(s.take(), [], 'a second sighting too soon is not repeated');
  for (let t = 60; t <= 75; t++) s.at(t);
  s.at(80, withRaider);
  assert.equal(s.take().length, 1, 'but a fresh incursion later is');
});

test('several raiders are counted; creatures, units out of sight and the peace do not count', () => {
  const s = scene();
  s.at(1);
  const pack = [s.unit(900, 'warrior', 1, 14.5, 12.5), s.unit(901, 'archer', 1, 15.5, 12.5), s.unit(902, 'warrior', 1, 16.5, 12.5)];
  s.at(2, { edit: (snap) => snap.entities.push(...pack) });
  assert.match(s.take()[0].text, /^3 enemy units have been sighted near your base!  \[\[Space\]\]$/);

  const t = scene();
  t.at(1);
  t.at(2, { edit: (snap) => snap.entities.push(t.unit(900, 'warrior', -1, 14.5, 12.5), t.unit(901, 'warrior', 1, 45.5, 45.5)) });
  assert.deepEqual(t.take(), [], 'a creature camp, and an enemy far away in the fog');

  const p = scene({ world: { peaceMinutes: 30 } });
  p.at(1);
  p.at(2, { edit: (snap) => snap.entities.push(p.unit(900, 'warrior', 1, 14.5, 12.5)) });
  assert.deepEqual(p.take(), [], 'nobody can harm anybody in the Decade of Peace');
});

test('an ally under attack: a softer drum, a ping in the ally\'s colour, Space unless my own alert is fresher; repeated at most every 20 s', () => {
  const s = scene({ world: { players: 3, teams: [1, 1, 2] } });
  s.at(1);
  const hit = { type: 'underAttack', player: 1, x: 40, y: 40, id: 77 };
  s.at(10, { events: [hit] });
  const [a] = s.take();
  assert.equal(a.id, 'ally_attacked');
  assert.equal(a.text, 'P1 is under attack!');
  assert.equal(a.icon, '🛡️');
  assert.equal(a.sound, 'drums');
  assert.equal(a.volume, 0.6);
  assert.deepEqual(a.ping, { x: 40, y: 40, color: '#d63a3a' });
  assert.deepEqual(a.jump, { x: 40, y: 40 });
  assert.equal(a.attention, 'P1 is under attack!');
  s.at(20, { events: [hit] });
  assert.deepEqual(s.take(), [], 'again too soon');
  s.at(31, { events: [{ ...hit, x: 41 }] });
  const [b] = s.take();
  assert.equal(b.id, 'ally_attacked');
  s.at(60, { events: [{ type: 'underAttack', player: 0, x: 8, y: 8, id: s.town.id }] });
  s.take();
  s.at(65, { events: [{ ...hit, x: 42 }] });
  assert.equal(s.take()[0].jump, null, 'my own alert is fresher: Space keeps its target');
  // A rival under attack is not my business.
  s.at(100, { events: [{ type: 'underAttack', player: 2, x: 30, y: 30, id: 78 }] });
  assert.deepEqual(s.take(), []);
});

test('the Decade of Peace: a gong at each mark the HUD speaks at, louder as it nears, the tab for the last two; nothing for marks already passed', () => {
  const total = 45 * 60;
  const s = scene({ world: { peaceMinutes: 45 } });
  s.at(total - 400);
  s.at(total - 301);
  assert.deepEqual(s.take(), []);
  s.at(total - 300);
  const [m1] = s.take();
  assert.equal(m1.id, 'peace_mark');
  assert.equal(m1.sound, 'gong');
  assert.equal(m1.volume, 0.6);
  assert.equal(m1.text, null, 'the HUD writes the line');
  assert.equal(m1.attention, null);
  s.at(total - 299);
  assert.deepEqual(s.take(), [], 'once per mark');
  s.at(total - 60);
  const [m2] = s.take();
  assert.equal(m2.volume, 0.85);
  assert.equal(m2.attention, peaceWarning(60));
  s.at(total - 10);
  const [m3] = s.take();
  assert.equal(m3.volume, 1);
  assert.equal(m3.attention, peaceWarning(10));
  s.at(total);
  assert.deepEqual(s.take(), []);

  const late = scene({ world: { peaceMinutes: 45 } });
  late.at(total - 30); // first seen with the 5:00 and 1:00 marks behind it
  late.at(total - 20);
  assert.deepEqual(late.take(), []);
  late.at(total - 10);
  assert.equal(late.take().length, 1);
  assert.deepEqual(PEACE_WARNINGS, [300, 60, 10]);
});

test('the big events: an enemy Titan rising, my god or Titan answering, the peace ending, my settlement growing, the match ending', () => {
  const s = scene({ world: { players: 3, teams: [1, 1, 2] } });
  const titan = titanFor('norse');
  s.at(1);
  s.at(2, { events: [{ type: 'titanSummoning', player: 2, t: titan.id }] });
  assert.equal(s.take()[0].attention, `${titan.name} is being summoned by P2!`);
  s.at(3, { events: [{ type: 'titanSummoning', player: 1, t: titan.id }, { type: 'titanSummoning', player: 0, t: titan.id }] });
  assert.deepEqual(s.take(), [], 'my own and my ally\'s Titan are no threat');

  const god = godsFor('greek')[0];
  s.at(4, { events: [{ type: 'spawn', id: 5000, t: god.id, o: 0 }, { type: 'spawn', id: 5001, t: 'warrior', o: 0 }, { type: 'spawn', id: 5002, t: god.id, o: 2 }] });
  assert.deepEqual(s.take().map((a) => a.attention), [`${god.name} is ready!`], 'only my own god, not a soldier or a rival\'s god');

  s.at(5, { events: [{ type: 'peaceEnd' }, { type: 'tierUp', player: 0, tier: 2 }, { type: 'tierUp', player: 2, tier: 2 }] });
  assert.deepEqual(s.take().map((a) => a.attention), ['The Decade of Peace is over: war begins!', 'Your settlement has grown!']);

  s.at(6, { events: [{ type: 'gameOver', winningTeam: 1 }], edit: (snap) => { snap.gameOver = { winningTeam: 1 }; } });
  assert.deepEqual(s.take().map((a) => a.attention), ['Victory! The battle is won.']);

  const lost = scene();
  lost.at(1);
  lost.at(2, { events: [{ type: 'gameOver', winningTeam: 2 }], edit: (snap) => { snap.gameOver = { winningTeam: 2 }; } });
  assert.deepEqual(lost.take().map((a) => a.attention), ['Defeat. The battle is lost.']);
  const draw = scene();
  draw.at(1);
  draw.at(2, { events: [{ type: 'gameOver', winningTeam: null }], edit: (snap) => { snap.gameOver = { winningTeam: null }; } });
  assert.deepEqual(draw.take().map((a) => a.attention), ['The battle is over: a draw.']);

  const fell = scene();
  fell.at(1);
  fell.at(2, { events: [{ type: 'playerDefeated', player: 0 }], edit: (snap) => { snap.players[0].defeated = true; } });
  assert.deepEqual(fell.take().map((a) => a.attention), ['Defeat. Your last building has fallen.']);
  fell.at(3, { events: [{ type: 'peaceEnd' }], edit: (snap) => { snap.players[0].defeated = true; } });
  assert.deepEqual(fell.take(), [], 'a defeated player is not alerted any more');
});

// ---------------------------------------------------------------- reminders

test('idle Worshippers: spoken once they have stood idle for 20 s, then at most once a minute, and not about the busy ones', () => {
  const s = scene({ idle: true });
  s.at(0);
  s.at(1);
  s.at(15);
  assert.deepEqual(s.take(), []);
  s.at(22);
  const [a] = s.take();
  assert.equal(a.id, 'idle_workers');
  assert.equal(a.text, '5 Worshippers are idle.  [[.]]');
  assert.equal(a.icon, '🙏');
  assert.equal(a.sound, 'nudge');
  assert.equal(a.kind, 'info');
  s.at(40);
  assert.deepEqual(s.take(), []);
  // Four go to work; the fifth is still idle when the minute is up.
  const busy = (snap) => snap.entities.filter((e) => e.k === 'u' && e.o === 0).slice(1).forEach((e) => { e.st = 'gather'; });
  s.at(83, { edit: busy });
  assert.equal(s.take()[0].text, '1 Worshipper is idle.  [[.]]');

  const t = scene();
  t.at(0);
  const away = (snap) => snap.entities.filter((e) => e.k === 'u' && e.o === 0).forEach((e) => { e.st = 'gather'; });
  for (let time = 1; time < 100; time += 3) t.at(time, { edit: away });
  assert.deepEqual(t.take(), [], 'nobody idle, nothing said');
});

test('the population limit: spoken after 10 s at the cap, not with a House going up or at the ceiling', () => {
  const capped = (snap) => { snap.players[0].pop = 12; snap.players[0].popCap = 12; };
  const s = scene();
  s.at(0, { edit: capped });
  s.at(5, { edit: capped });
  s.at(12, { edit: capped });
  assert.deepEqual(ids(s.take()).filter((id) => id === 'pop_capped'), []);
  s.at(16, { edit: capped });
  const pop = s.take().filter((a) => a.id === 'pop_capped');
  assert.equal(pop.length, 1);
  assert.equal(pop[0].text, 'Your population limit is reached. Build Houses to grow ([[B]], then [[H]]).');
  assert.equal(pop[0].icon, '🏠');
  assert.equal(pop[0].sound, 'nudge');

  const site = scene();
  const house = (snap) => { capped(snap); snap.entities.push(site.building(950, 'house', 0, 14, 14, { bp: 0.4 })); };
  site.at(0, { edit: house });
  site.at(5, { edit: house });
  site.at(30, { edit: house });
  assert.deepEqual(ids(site.take()).filter((id) => id === 'pop_capped'), [], 'a House is being built');

  const full = scene();
  const ceiling = (snap) => { snap.players[0].pop = 200; snap.players[0].popCap = 200; };
  full.at(0, { edit: ceiling });
  full.at(5, { edit: ceiling });
  full.at(30, { edit: ceiling });
  assert.deepEqual(ids(full.take()).filter((id) => id === 'pop_capped'), [], 'nothing more to build');
});

test('a god you can pay for: named at the Temple after 8 s, a fallen one as a revival, nothing while the Temple is busy', () => {
  const rich = (snap) => {
    Object.assign(snap.players[0], { gold: 5000, wood: 5000, faith: 5000, popCap: 100, tier: 3 });
  };
  const temple = (s, extra = {}) => (snap) => {
    rich(snap);
    snap.entities.push(s.building(960, 'temple', 0, 16, 16, extra));
  };
  const s = scene();
  s.at(0, { edit: temple(s) });
  s.at(1, { edit: temple(s) });
  s.at(8, { edit: temple(s) });
  assert.deepEqual(ids(s.take()).filter((id) => id === 'god_ready'), []);
  s.at(10, { edit: temple(s) });
  const [a] = s.take().filter((x) => x.id === 'god_ready');
  assert.match(a.text, /^You can summon .+ at your Temple\.$/);
  assert.equal(a.icon, godsFor('greek').find((g) => a.text.includes(g.name)).icon, 'the card wears the god\'s own emblem');
  assert.equal(a.kind, 'good');
  assert.equal(a.sound, 'nudge');

  const fallenGod = godsFor('greek')[1];
  const f = scene();
  const withFallen = (snap) => {
    temple(f)(snap);
    snap.players[0].fallen = { [fallenGod.id]: 2 };
  };
  f.at(0, { edit: withFallen });
  f.at(1, { edit: withFallen });
  f.at(10, { edit: withFallen });
  assert.equal(f.take().find((x) => x.id === 'god_ready').text, `You can revive ${fallenGod.name} at your Temple.`);

  const b = scene();
  const busy = temple(b, { q: [{ u: godsFor('greek')[0].id, p: 0.3 }] });
  b.at(0, { edit: busy });
  b.at(1, { edit: busy });
  b.at(30, { edit: busy });
  assert.deepEqual(ids(b.take()).filter((id) => id === 'god_ready'), [], 'the Temple is already summoning');

  const poor = scene();
  const broke = (snap) => { temple(poor)(snap); snap.players[0].faith = 0; snap.players[0].gold = 0; };
  poor.at(0, { edit: broke });
  poor.at(1, { edit: broke });
  poor.at(30, { edit: broke });
  assert.deepEqual(ids(poor.take()).filter((id) => id === 'god_ready'), [], 'cannot afford one');
});

test('the Titan you can pay for: named at the Titan Gate after 8 s, repeated at most every 4 minutes', () => {
  const titan = titanFor('greek');
  const s = scene();
  const gate = (snap) => {
    Object.assign(snap.players[0], { gold: 9000, wood: 9000, faith: 9000, popCap: 200, tier: 3 });
    snap.entities.push(s.building(970, 'titan_gate', 0, 20, 20));
  };
  s.at(0, { edit: gate });
  s.at(1, { edit: gate });
  s.at(10, { edit: gate });
  const [a] = s.take().filter((x) => x.id === 'titan_ready');
  assert.equal(a.text, `You can summon ${titan.name} at your Titan Gate ([[T]]).`);
  assert.equal(a.icon, titan.icon);
  s.at(100, { edit: gate });
  assert.deepEqual(ids(s.take()).filter((id) => id === 'titan_ready'), []);
  s.at(260, { edit: gate });
  assert.equal(s.take().filter((x) => x.id === 'titan_ready').length, 1);
});

test('an idle army: after 6 minutes of nothing, with most of 6 or more standing about; never in a peace or with raiders at the gates', () => {
  const army = (s, n, idle = n) => (snap) => {
    for (let i = 0; i < n; i++) snap.entities.push(s.unit(800 + i, 'warrior', 0, 12 + (i % 4), 12 + Math.floor(i / 4), { st: i < idle ? 'idle' : 'move' }));
  };
  const s = scene();
  s.at(0, { edit: army(s, 8) });
  s.at(300, { edit: army(s, 8) });
  s.at(361, { edit: army(s, 8) });
  assert.deepEqual(ids(s.take()).filter((id) => id === 'army_idle'), [], 'not for 2 minutes of it');
  s.at(485, { edit: army(s, 8) });
  const [a] = s.take().filter((x) => x.id === 'army_idle');
  assert.equal(a.text, 'Your army has been standing idle for a while. Attack ([[A]]), or send scouts.');
  assert.equal(a.icon, '💤');
  assert.equal(a.sound, 'nudge');
  s.at(600, { edit: army(s, 8) });
  assert.deepEqual(ids(s.take()).filter((id) => id === 'army_idle'), [], 'not again for 5 minutes');

  const busy = scene();
  busy.at(0, { edit: army(busy, 8, 6) });
  busy.at(400, { edit: army(busy, 8, 6) });
  busy.at(600, { edit: army(busy, 8, 6) });
  assert.deepEqual(ids(busy.take()).filter((id) => id === 'army_idle'), [], 'a quarter of it is on the move');

  const small = scene();
  small.at(0, { edit: army(small, 5) });
  small.at(400, { edit: army(small, 5) });
  small.at(600, { edit: army(small, 5) });
  assert.deepEqual(ids(small.take()).filter((id) => id === 'army_idle'), [], 'five soldiers are not an army');

  const peace = scene({ world: { peaceMinutes: 60 } });
  peace.at(0, { edit: army(peace, 8) });
  peace.at(400, { edit: army(peace, 8) });
  peace.at(600, { edit: army(peace, 8) });
  assert.deepEqual(ids(peace.take()).filter((id) => id === 'army_idle'), [], 'masses at home on purpose');

  const siege = scene();
  const besieged = (snap) => {
    army(siege, 8)(snap);
    snap.entities.push(siege.unit(900, 'warrior', 1, 14.5, 12.5, { hp: 420, mhp: 420 }));
  };
  siege.at(0, { edit: besieged });
  siege.at(400, { edit: besieged });
  siege.at(600, { edit: besieged });
  assert.deepEqual(ids(siege.take()).filter((id) => id === 'army_idle'), [], 'the army is not idle, it is waiting for a fight');
});

test('finished research is named', () => {
  const s = scene();
  s.at(1);
  s.at(2, { events: [{ type: 'researched', player: 0, up: 'tc_iron_picks' }, { type: 'researched', player: 1, up: 'tc_iron_picks' }] });
  const got = s.take();
  assert.equal(got.length, 1);
  assert.equal(got[0].text, 'Iron Picks is researched.');
  assert.equal(got[0].icon, UPGRADES.tc_iron_picks.icon, 'the upgrade\'s own emblem');
  assert.equal(got[0].kind, 'good');
  assert.equal(got[0].sound, 'research');
  s.at(3, { events: [{ type: 'researched', player: 0, up: 'no_such_upgrade' }] });
  const unknown = s.take()[0];
  assert.equal(unknown.text, 'An upgrade is researched.');
  assert.equal(unknown.icon, '📜');
});

test('milestones: counts passed before the first look are not cheered; one cheer at a time, 20 s apart', () => {
  const stats = (kills, gathered = 0) => (snap) => {
    Object.assign(snap.players[0].stats, { kills, gathered });
  };
  const s = scene();
  s.at(0, { edit: stats(30) }); // already past 25 when first seen
  s.at(10, { edit: stats(30) });
  s.at(21, { edit: stats(30) });
  assert.deepEqual(ids(s.take()).filter((id) => id === 'milestone'), []);
  s.at(30, { edit: stats(50) });
  const [a] = s.take().filter((x) => x.id === 'milestone');
  assert.equal(a.text, '50 enemies have fallen before your armies!');
  assert.equal(a.icon, '⚔️');
  assert.equal(a.sound, 'milestone');
  assert.equal(a.kind, 'good');
  s.at(35, { edit: stats(100, 1000) });
  assert.deepEqual(ids(s.take()).filter((id) => id === 'milestone'), [], 'not within 20 s of the last cheer');
  s.at(52, { edit: stats(100, 1000) });
  assert.equal(s.take().find((x) => x.id === 'milestone').text, '100 enemies have fallen before your armies!');
  s.at(75, { edit: stats(100, 1000) });
  const gathered = s.take().find((x) => x.id === 'milestone');
  assert.equal(gathered.text, '1,000 gold and wood gathered.');
  assert.equal(gathered.icon, '💰');

  const first = scene();
  first.at(0, { edit: stats(0) });
  first.at(25, { edit: stats(1) });
  assert.equal(first.take().find((x) => x.id === 'milestone').text, 'First blood! Your first enemy has fallen.');
});

test('a spectator, or no snapshot yet, gets nothing and breaks nothing', () => {
  const world = makeWorld();
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: -1 });
  const out = [];
  new AlertEngine({ viewState: vs, notify: (a) => out.push(a), settings: () => ({ alerts: 'all', tabAlerts: 'notify' }) }).attach();
  const snap = JSON.parse(JSON.stringify(world.getSnapshot()));
  snap.events = [{ type: 'underAttack', player: 0, x: 8, y: 8, id: 3 }, { type: 'peaceEnd' }, { type: 'gameOver', winningTeam: 1 }];
  snap.tick = 5000;
  vs.pushSnapshot(snap, 50);
  vs.pushSnapshot({ ...snap, time: 400, tick: 5001, events: [] }, 50);
  assert.deepEqual(out, []);
});
