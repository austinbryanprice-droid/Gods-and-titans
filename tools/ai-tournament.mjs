#!/usr/bin/env node
// Headless AI tournament: full games (World + AIs, no rendering) for given
// pantheons, difficulties and seeds, on up to 2 worker threads. Prints each
// game's winner, length, final army/economy, gods (levels), titans and
// abilities cast, then per-pantheon and per-difficulty win rate tables.
//
// Usage:
//   node tools/ai-tournament.mjs [--pantheons=greek,norse,...] [--seeds=1-4]
//        [--d0=normal --d1=normal | --diff=hard] [--size=small|medium]
//        [--pairs=greek:norse,aztec:celtic] [--mode=round|mirror|vs]
//        [--teams=2v2|ffa] [--max=40] [--workers=2] [--json=out.json] [--quiet]
//
// --mode=round (default): every pantheon pair from --pantheons, once per seed,
//   sides swapped on odd seeds. --mode=vs: each pantheon of --pantheons plays
//   the next one in the list (a ring), useful for quick difficulty checks.
//   --mode=mirror: each pantheon against itself.
// --teams=2v2 plays 4-player games (players 0,1 vs 2,3) on a medium map;
// --teams=ffa plays 4-player free-for-all games (one game per listed pantheon).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { createWorld } from '../src/sim/world.js';
import { createAI } from '../src/ai/ai.js';
import { PANTHEON_LIST, getUnitType } from '../src/data/index.js';
import { TICK_RATE } from '../src/config.js';

/**
 * Run one headless game.
 * @param {{ seed, size, players: [{ pantheon, difficulty, team }], maxMinutes }} g
 */
export function runGame(g) {
  const setup = {
    version: '0.1.0',
    seed: g.seed,
    mapSize: g.size || 'small',
    players: g.players.map((p, i) => ({ index: i, name: `AI ${i}`, team: p.team ?? i + 1, pantheon: p.pantheon, color: null, kind: 'ai', difficulty: p.difficulty })),
  };
  const world = createWorld(setup);
  const ais = setup.players.map((p) => createAI(world, p.index, p.difficulty));
  const n = setup.players.length;
  const stat = setup.players.map(() => ({ casts: 0, godCasts: 0, titanCasts: 0, gods: {}, titans: 0, titanDeaths: 0, godDeaths: 0, maxArmyPop: 0, firstTitanAt: null, tier3At: null }));
  const maxTicks = Math.round((g.maxMinutes || 40) * 60 * TICK_RATE);
  const t0 = performance.now();
  let tick = 0;
  for (; tick < maxTicks && !world.gameOver; tick++) {
    for (const ai of ais) ai.tick();
    world.tick();
    for (const e of world.events) {
      if (e.type === 'cast') {
        const u = world.entities.get(e.src);
        if (u && u.owner >= 0 && stat[u.owner]) {
          stat[u.owner].casts++;
          if (u.def.class === 'god') stat[u.owner].godCasts++;
          else if (u.def.class === 'titan') stat[u.owner].titanCasts++;
        }
      } else if (e.type === 'spawn' && e.o >= 0) {
        const d = getUnitType(e.t);
        if (!d) continue;
        if (d.class === 'god') {
          const rec = stat[e.o].gods[e.t] || (stat[e.o].gods[e.t] = { summons: 0, level: 1 });
          rec.summons++;
        } else if (d.class === 'titan') {
          stat[e.o].titans++;
          if (stat[e.o].firstTitanAt === null) stat[e.o].firstTitanAt = world.time;
        }
      } else if (e.type === 'levelUp') {
        const u = world.entities.get(e.id);
        if (u && u.owner >= 0) {
          const rec = stat[u.owner].gods[u.type];
          if (rec) rec.level = Math.max(rec.level, e.level);
        }
      } else if (e.type === 'death' && e.k === 'u' && e.o >= 0) {
        const d = getUnitType(e.t);
        if (d && d.class === 'god') stat[e.o].godDeaths++;
        else if (d && d.class === 'titan') stat[e.o].titanDeaths++;
      } else if (e.type === 'tierUp' && e.tier === 3 && stat[e.player].tier3At === null) {
        stat[e.player].tier3At = world.time;
      }
    }
    world.events.length = 0;
    world.felled.length = 0;
    if (tick % 100 === 0) {
      for (let i = 0; i < n; i++) {
        let pop = 0;
        for (const u of world.unitList) if (!u.dead && u.owner === i && u.def.class !== 'worker' && !u.summoned) pop += u.def.pop;
        stat[i].maxArmyPop = Math.max(stat[i].maxArmyPop, pop);
      }
    }
  }
  const realMs = performance.now() - t0;
  const players = world.players.map((p, i) => {
    let workers = 0;
    let armyPop = 0;
    for (const u of world.unitList) {
      if (u.dead || u.owner !== i || u.summoned) continue;
      if (u.def.class === 'worker') workers++;
      else armyPop += u.def.pop;
    }
    const a = ais[i].ai;
    return {
      index: i,
      pantheon: p.pantheon,
      difficulty: setup.players[i].difficulty,
      team: p.team,
      defeated: p.defeated,
      tier: p.tier,
      workers,
      armyPop,
      buildingsNow: world.buildingList.filter((b) => !b.dead && b.owner === i).length,
      gold: Math.round(p.gold),
      wood: Math.round(p.wood),
      faith: Math.round(p.faith),
      ...p.stats,
      ...stat[i],
      thinkMs: a.stats.thinks ? a.stats.thinkMs / a.stats.thinks : 0,
      aiErrors: a.errors,
    };
  });
  return {
    seed: g.seed,
    size: setup.mapSize,
    minutes: world.time / 60,
    finished: !!world.gameOver,
    winningTeam: world.gameOver ? world.gameOver.winningTeam : null,
    players,
    realSeconds: realMs / 1000,
    msPerTick: realMs / Math.max(1, tick),
  };
}

// ------------------------------------------------------------- worker side
if (!isMainThread) {
  parentPort.on('message', (msg) => {
    if (msg === 'exit') process.exit(0);
    let result;
    try {
      result = runGame(msg.game);
    } catch (err) {
      result = { error: String(err && err.stack ? err.stack : err) };
    }
    parentPort.postMessage({ id: msg.id, result });
  });
}

// --------------------------------------------------------------- main side
function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

function parseSeeds(spec) {
  const out = [];
  for (const part of String(spec).split(',')) {
    const m = /^(\d+)-(\d+)$/.exec(part);
    if (m) for (let i = +m[1]; i <= +m[2]; i++) out.push(i);
    else if (part !== '') out.push(+part);
  }
  return out;
}

function buildGames(opt) {
  const ids = opt.pantheons ? String(opt.pantheons).split(',') : PANTHEON_LIST.map((p) => p.id);
  const seeds = parseSeeds(opt.seeds || '1-2');
  const d0 = opt.d0 || opt.diff || 'normal';
  const d1 = opt.d1 || opt.diff || 'normal';
  const size = opt.size || (opt.teams === '2v2' || opt.teams === 'ffa' ? 'medium' : 'small');
  const maxMinutes = +(opt.max || 40);
  const games = [];
  let pairs = [];
  if (opt.pairs) pairs = String(opt.pairs).split(',').map((s) => s.split(':'));
  else if (opt.mode === 'mirror') pairs = ids.map((id) => [id, id]);
  else if (opt.mode === 'vs') pairs = ids.map((id, i) => [id, ids[(i + 1) % ids.length]]);
  else for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.push([ids[i], ids[j]]);
  for (const seed of seeds) {
    for (const [a, b] of pairs) {
      if (opt.teams === 'ffa') {
        const c = ids.indexOf(a);
        const four = [0, 1, 2, 3].map((k) => ids[(c + k) % ids.length]);
        games.push({ seed, size, maxMinutes, players: four.map((pan, k) => ({ pantheon: pan, difficulty: k % 2 ? d1 : d0, team: k + 1 })) });
        continue;
      }
      if (opt.teams === '2v2') {
        games.push({ seed, size, maxMinutes, players: [
          { pantheon: a, difficulty: d0, team: 1 }, { pantheon: b, difficulty: d0, team: 1 },
          { pantheon: b, difficulty: d1, team: 2 }, { pantheon: a, difficulty: d1, team: 2 },
        ] });
        continue;
      }
      // Swap sides on odd seeds so start positions don't bias a pantheon.
      const swap = seed % 2 === 1 && a !== b;
      const p0 = swap ? { pantheon: b, difficulty: d1, team: 1 } : { pantheon: a, difficulty: d0, team: 1 };
      const p1 = swap ? { pantheon: a, difficulty: d0, team: 2 } : { pantheon: b, difficulty: d1, team: 2 };
      games.push({ seed, size, maxMinutes, players: [p0, p1] });
    }
  }
  return games;
}

function fmtGame(r) {
  if (r.error) return `  ERROR ${r.error}`;
  const win = r.winningTeam === null ? (r.finished ? 'draw' : 'time limit') : `team ${r.winningTeam}`;
  const lines = [`seed ${r.seed} ${r.size}: ${win} after ${r.minutes.toFixed(1)} min (${r.realSeconds.toFixed(1)} s real, ${r.msPerTick.toFixed(2)} ms/tick)`];
  for (const p of r.players) {
    const gods = Object.entries(p.gods).map(([id, g]) => `${id.replace(`${p.pantheon}_`, '')} L${g.level}${g.summons > 1 ? ` x${g.summons}` : ''}`).join(', ') || '-';
    lines.push(`  P${p.index} ${p.pantheon.padEnd(12)} ${p.difficulty.padEnd(6)} T${p.team} ${p.defeated ? 'lost' : 'alive'} tier ${p.tier} | army ${p.armyPop} pop (max ${p.maxArmyPop}) workers ${p.workers} bldg ${p.buildingsNow} | gathered ${p.gathered} trained ${p.unitsTrained} kills ${p.kills} losses ${p.losses} | gods: ${gods} (deaths ${p.godDeaths}) | titans ${p.titans}${p.firstTitanAt ? ` @${(p.firstTitanAt / 60).toFixed(1)}m` : ''} | casts ${p.casts} (gods ${p.godCasts}, titan ${p.titanCasts}) | ai ${p.thinkMs.toFixed(2)} ms/think${p.aiErrors ? ` ERR ${p.aiErrors}` : ''}`);
  }
  return lines.join('\n');
}

function tables(results) {
  const pan = new Map();
  const diff = new Map();
  const bump = (map, key, won) => {
    const r = map.get(key) || { games: 0, wins: 0 };
    r.games++;
    if (won) r.wins++;
    map.set(key, r);
  };
  let lengths = [];
  let titans = 0;
  let casts = 0;
  let timeouts = 0;
  for (const r of results) {
    if (r.error) continue;
    if (!r.finished) timeouts++;
    else lengths.push(r.minutes);
    for (const p of r.players) {
      const won = r.winningTeam !== null && p.team === r.winningTeam;
      bump(pan, p.pantheon, won);
      bump(diff, p.difficulty, won);
      titans += p.titans;
      casts += p.casts;
    }
  }
  const out = [];
  out.push('\nPantheon win rates:');
  for (const [k, v] of [...pan].sort((a, b) => b[1].wins / b[1].games - a[1].wins / a[1].games)) {
    out.push(`  ${k.padEnd(13)} ${String(v.wins).padStart(3)}/${String(v.games).padEnd(3)} ${((100 * v.wins) / v.games).toFixed(0).padStart(3)}%`);
  }
  out.push('Difficulty win rates:');
  for (const [k, v] of diff) out.push(`  ${k.padEnd(13)} ${String(v.wins).padStart(3)}/${String(v.games).padEnd(3)} ${((100 * v.wins) / v.games).toFixed(0).padStart(3)}%`);
  lengths.sort((a, b) => a - b);
  const avg = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  out.push(`Games: ${results.length}, finished ${lengths.length}, time limit ${timeouts}; length avg ${avg.toFixed(1)} min, min ${lengths[0]?.toFixed(1) ?? '-'}, median ${lengths[lengths.length >> 1]?.toFixed(1) ?? '-'}, max ${lengths[lengths.length - 1]?.toFixed(1) ?? '-'}`);
  out.push(`Titans summoned: ${titans}, abilities cast: ${casts}`);
  return out.join('\n');
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  const games = buildGames(opt);
  const nWorkers = Math.max(1, Math.min(2, +(opt.workers || 2), games.length));
  console.log(`Running ${games.length} game(s) on ${nWorkers} worker thread(s)…`);
  const results = new Array(games.length);
  let next = 0;
  let done = 0;
  const file = fileURLToPath(import.meta.url);
  await new Promise((resolve) => {
    if (!games.length) return resolve();
    for (let w = 0; w < nWorkers; w++) {
      const worker = new Worker(file);
      const feed = () => {
        if (next >= games.length) {
          worker.postMessage('exit');
          return;
        }
        const id = next++;
        worker.postMessage({ id, game: games[id] });
      };
      worker.on('message', ({ id, result }) => {
        results[id] = result;
        done++;
        if (!opt.quiet) console.log(`[${done}/${games.length}] ${fmtGame(result)}`);
        if (done === games.length) resolve();
        feed();
      });
      worker.on('error', (err) => {
        console.error('worker error', err);
      });
      feed();
    }
  });
  console.log(tables(results));
  if (opt.json) {
    const fs = await import('node:fs');
    fs.writeFileSync(opt.json, JSON.stringify(results, null, 1));
    console.log(`Wrote ${opt.json}`);
  }
}

if (isMainThread && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
