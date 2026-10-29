#!/usr/bin/env node
// Do computer allies' answers to team markers (DESIGN 10, "Answering team marks") change a 2v2?
// Headless A/B: team 1 is a "human" (player 0, played by an AI of --human difficulty, the weak
// link the enemy goes for) with a computer ally (player 1); team 2 is two AIs. In the "marks" run
// the human calls Help at its base when it is struck (at most every 30 s) and Attack at the
// target of each of its own waves, as a player would; in the "none" run it never marks. Same
// seeds, same AIs, sides swapped on odd seeds (team 2 gets the 0/1 start spots).
//
// Usage: node tools/ally-marks.mjs [--seeds=1-8] [--human=easy] [--ally=normal] [--enemy=normal] [--max=25]
import { createWorld } from '../src/sim/world.js';
import { createAI } from '../src/ai/ai.js';
import { TICK_RATE } from '../src/config.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const [s0, s1] = (args.seeds || '1-8').split('-').map(Number);
const HUMAN = args.human || 'easy';
const ALLY = args.ally || 'normal';
const ENEMY = args.enemy || 'normal';
const MAX = Number(args.max || 25);
const PANTHEONS = ['greek', 'norse', 'egyptian', 'celtic', 'hindu', 'japanese', 'chinese', 'aztec'];

function play(seed, marks) {
  const pan = (k) => PANTHEONS[(seed * 3 + k) % PANTHEONS.length];
  const swap = seed % 2 === 1;
  // Player indices 0..3; team 1 = the human (h) and its ally (a).
  const h = swap ? 2 : 0;
  const a = swap ? 3 : 1;
  const players = [0, 1, 2, 3].map((i) => {
    const team = i === h || i === a ? 1 : 2;
    const difficulty = i === h ? HUMAN : i === a ? ALLY : ENEMY;
    return { index: i, name: `P${i}`, team, pantheon: pan(i), kind: i === h ? 'human' : 'ai', difficulty };
  });
  const world = createWorld({ version: '0.1.0', seed, mapSize: 'medium', players });
  const ais = players.map((p) => createAI(world, p.index, p.difficulty));
  const hai = ais[h].ai;
  let lastHelp = -999;
  let lastWave = 0;
  const helps = [];
  let nMarks = 0;
  const maxTicks = MAX * 60 * TICK_RATE;
  let humanOut = null;
  for (let t = 0; t < maxTicks && !world.gameOver; t++) {
    for (const ai of ais) ai.tick();
    world.tick();
    if (marks) {
      for (const e of world.events) {
        if (e.type === 'underAttack' && e.player === h && world.time - lastHelp >= 30) {
          lastHelp = world.time;
          world.issueCommand(h, { type: 'teamMark', kind: 'help', x: e.x, y: e.y });
          helps.push({ t: world.time, x: e.x, y: e.y });
          nMarks++;
        }
      }
      if (hai.mil.mode === 'attack' && hai.mil.waves !== lastWave) {
        lastWave = hai.mil.waves;
        const tp = hai.mil.target;
        const b = world.buildingsOf(tp).find((x) => x.type === 'town_center') || world.buildingsOf(tp)[0];
        if (b) {
          world.issueCommand(h, { type: 'teamMark', kind: 'attack', x: b.x, y: b.y });
          nMarks++;
        }
      }
    } else {
      for (const e of world.events) if (e.type === 'underAttack' && e.player === h && world.time - lastHelp >= 30) {
        lastHelp = world.time;
        helps.push({ t: world.time, x: e.x, y: e.y });
      }
    }
    // 30 s after each call for help: how much of the ally's army stands within 15 tiles of the spot.
    for (const hp of helps) {
      if (hp.share === undefined && world.time >= hp.t + 30) {
        let near = 0;
        let all = 0;
        for (const u of world.unitsOf(a)) {
          if (u.dead || u.def.class === 'worker' || u.summoned) continue;
          all += u.def.pop || 1;
          if (Math.hypot(u.x - hp.x, u.y - hp.y) <= 15) near += u.def.pop || 1;
        }
        hp.share = all ? near / all : 0;
        if (args.verbose) {
          const am = ais[a].ai.mil;
          const o = am.mark;
          const home = ais[a].ai.home();
          console.log(`  help at ${(hp.t / 60).toFixed(1)}m: ${(hp.share * 100).toFixed(0)}% there, ally ${am.mode}${o ? ` (${o.kind})` : ''}, army ${all} pop, ${Math.hypot(home.x - hp.x, home.y - hp.y).toFixed(0)} tiles from its home`);
        }
      }
    }
    if (humanOut === null && world.players[h].defeated) humanOut = world.time;
    world.events.length = 0;
    world.felled.length = 0;
  }
  const done = helps.filter((x) => x.share !== undefined);
  return {
    seed,
    win: world.gameOver ? world.gameOver.winningTeam === 1 : null,
    minutes: world.time / 60,
    humanOut: humanOut === null ? null : humanOut / 60,
    marks: nMarks,
    helpShare: done.length ? done.reduce((s, x) => s + x.share, 0) / done.length : null,
    helps: done.length,
  };
}

const rows = { none: [], marks: [] };
for (let seed = s0; seed <= s1; seed++) {
  for (const mode of ['none', 'marks']) {
    const r = play(seed, mode === 'marks');
    rows[mode].push(r);
    console.log(`${mode.padEnd(5)} seed ${seed}: ${r.win === null ? 'draw' : r.win ? 'WIN ' : 'loss'} at ${r.minutes.toFixed(1)}m, human out ${r.humanOut === null ? '-' : r.humanOut.toFixed(1) + 'm'}, marks ${r.marks}, ally army near help spots 30 s later ${r.helpShare === null ? '-' : (r.helpShare * 100).toFixed(0) + '%'} (${r.helps})`);
  }
}
for (const mode of ['none', 'marks']) {
  const rs = rows[mode];
  const wins = rs.filter((r) => r.win).length;
  const outs = rs.map((r) => (r.humanOut === null ? MAX : r.humanOut));
  const share = rs.filter((r) => r.helpShare !== null);
  console.log(`${mode}: team 1 won ${wins}/${rs.length}; human lasted ${(outs.reduce((s, x) => s + x, 0) / outs.length).toFixed(1)} min on average; ally army near a call for help ${share.length ? ((share.reduce((s, r) => s + r.helpShare, 0) / share.length) * 100).toFixed(0) : '-'}%`);
}
