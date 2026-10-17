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
//        [--trace] [--brief]
//
// --mode=round (default): every pantheon pair from --pantheons, once per seed,
//   sides swapped on odd seeds. --mode=vs: each pantheon of --pantheons plays
//   the next one in the list (a ring), useful for quick difficulty checks.
//   --mode=mirror: each pantheon against itself.
// --teams=2v2 plays 4-player games (players 0,1 vs 2,3) on a medium map;
// --teams=ffa plays 4-player free-for-all games (one game per listed pantheon).
// --trace prints a one-line-per-minute economy timeline of every player (bank,
//   income, workers by job, miners waiting, army pop, tier, owned mines);
// --brief prints one line per game instead of the full per-player report.
// The summary adds side bias (player 0 vs 1 of 1v1 games), difficulty
// head-to-head, game length spread, first expansion times, bank stalls
// (longest stretch with ≥ 1500 gold, or wood with gold to pair it, unspent
// while ≥ 15 pop below the cap and below the AI's own army cap, i.e. money it
// could spend) and
// AI / sim error counts.
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
  const stat = setup.players.map(() => ({
    casts: 0, godCasts: 0, titanCasts: 0, gods: {}, titans: 0, titanDeaths: 0, godDeaths: 0, maxArmyPop: 0, firstTitanAt: null, tier3At: null,
    expandAt: null, stallMax: 0, stallNow: 0, stallInfo: null, maxBank: 0, waitSum: 0, idleSum: 0, samples: 0, goldIn: 0, workersAt5: 0, workersAt10: 0,
    abil: {}, made: {}, // casts per ability id, spawns per unit type (JSON only)
  }));
  const n0 = setup.players.length;
  const lastRes = world.players.map((p) => ({ gold: p.gold, wood: p.wood, faith: p.faith }));
  const minute = world.players.map(() => ({ gold: 0, wood: 0, faith: 0 }));
  const trace = g.trace ? [] : null;
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
          stat[u.owner].abil[e.ability] = (stat[u.owner].abil[e.ability] || 0) + 1;
          if (u.def.class === 'god') stat[u.owner].godCasts++;
          else if (u.def.class === 'titan') stat[u.owner].titanCasts++;
        }
      } else if (e.type === 'spawn' && e.o >= 0) {
        const d = getUnitType(e.t);
        if (!d) continue;
        if (stat[e.o]) stat[e.o].made[e.t] = (stat[e.o].made[e.t] || 0) + 1;
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
    for (let i = 0; i < n0; i++) {
      const p = world.players[i];
      const l = lastRes[i];
      for (const k of ['gold', 'wood', 'faith']) {
        const d = p[k] - l[k];
        if (d > 0) minute[i][k] += d;
        l[k] = p[k];
      }
    }
    if (tick % 100 === 0) {
      const sec = world.time;
      for (let i = 0; i < n; i++) {
        const st = stat[i];
        const p = world.players[i];
        let pop = 0;
        let workers = 0;
        let wait = 0;
        let idle = 0;
        const jobs = { g: 0, w: 0, p: 0, b: 0, i: 0, o: 0 };
        for (const u of world.unitList) {
          if (u.dead || u.owner !== i || u.summoned) continue;
          if (u.def.class !== 'worker') {
            pop += u.def.pop;
            continue;
          }
          workers++;
          const o = u.order;
          if (!o) {
            idle++;
            jobs.i++;
          } else if (o.type === 'gather' || o.type === 'return') {
            const r = o.type === 'return' ? o.resume : o;
            if (r && r.mine) jobs.g++;
            else jobs.w++;
            if (o.type === 'gather' && o.phase === 'wait') wait++;
          } else if (o.type === 'pray') jobs.p++;
          else if (o.type === 'build') jobs.b++;
          else jobs.o++;
        }
        st.maxArmyPop = Math.max(st.maxArmyPop, pop);
        if (p.defeated) continue;
        st.samples++;
        st.waitSum += wait;
        st.idleSum += idle;
        const ai = ais[i].ai;
        if (st.expandAt === null && ai.pairs && ai.pairs.length >= 2) st.expandAt = sec;
        const bank = p.gold + p.wood;
        st.maxBank = Math.max(st.maxBank, bank);
        // A stall is money that could be spent: 1500+ gold (or 1500+ wood with gold to
        // pair it), at least 15 pop of room below the cap, below this AI's own army cap,
        // and someone left to spend it.
        const capped = ai.prof && ai.s && ai.s.armyPop >= ai.prof.armyCap * 0.9;
        const rich = p.gold >= 1500 || (p.wood >= 1500 && p.gold >= 300);
        if (rich && p.popUsed <= 135 && !capped && workers + pop > 0) st.stallNow += 5;
        else st.stallNow = 0;
        if (st.stallNow > st.stallMax) {
          st.stallMax = st.stallNow;
          st.stallInfo = { at: Math.round(sec), gold: Math.round(p.gold), wood: Math.round(p.wood), pop: p.popUsed, cap: p.popCap, tier: p.tier, workers, army: pop, mode: ai.mil ? ai.mil.mode : '' };
        }
        if (Math.abs(sec - 300) < 2.6) st.workersAt5 = workers;
        if (Math.abs(sec - 600) < 2.6) st.workersAt10 = workers;
        if (tick % 1200 === 0 && tick > 0) {
          const inc = minute[i];
          st.goldIn += inc.gold;
          if (trace) trace.push(`  ${(sec / 60).toFixed(0).padStart(2)}m P${i} ${p.pantheon.slice(0, 8).padEnd(8)} bank ${Math.round(p.gold)}g ${Math.round(p.wood)}w ${Math.round(p.faith)}f | +${Math.round(inc.gold)}g +${Math.round(inc.wood)}w +${Math.round(inc.faith)}f /min | wk ${workers} (g${jobs.g} w${jobs.w} p${jobs.p} b${jobs.b} i${jobs.i} o${jobs.o}) wait ${wait} | army ${pop} pop ${p.popUsed}/${p.popCap} tier ${p.tier} mines ${ai.pairs ? ai.pairs.length : 0} | ${ai.mil ? ai.mil.mode : ''}`);
          minute[i] = { gold: 0, wood: 0, faith: 0 };
        }
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
      avgWait: stat[i].samples ? stat[i].waitSum / stat[i].samples : 0,
      avgIdle: stat[i].samples ? stat[i].idleSum / stat[i].samples : 0,
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
    commandErrors: world.perf ? world.perf.commandErrors : 0,
    lastCommandError: world.perf ? world.perf.lastCommandError : '',
    trace,
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
  const trace = !!opt.trace;
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
        games.push({ seed, size, maxMinutes, trace, players: four.map((pan, k) => ({ pantheon: pan, difficulty: k % 2 ? d1 : d0, team: k + 1 })) });
        continue;
      }
      if (opt.teams === '2v2') {
        games.push({ seed, size, maxMinutes, trace, players: [
          { pantheon: a, difficulty: d0, team: 1 }, { pantheon: b, difficulty: d0, team: 1 },
          { pantheon: b, difficulty: d1, team: 2 }, { pantheon: a, difficulty: d1, team: 2 },
        ] });
        continue;
      }
      // Swap sides on odd seeds so start positions don't bias a pantheon.
      const swap = seed % 2 === 1 && a !== b;
      const p0 = swap ? { pantheon: b, difficulty: d1, team: 1 } : { pantheon: a, difficulty: d0, team: 1 };
      const p1 = swap ? { pantheon: a, difficulty: d0, team: 2 } : { pantheon: b, difficulty: d1, team: 2 };
      games.push({ seed, size, maxMinutes, trace, players: [p0, p1] });
    }
  }
  return games;
}

function fmtGame(r, brief) {
  if (r.error) return `  ERROR ${r.error}`;
  const win = r.winningTeam === null ? (r.finished ? 'draw' : 'time limit') : `team ${r.winningTeam}`;
  const errs = r.commandErrors ? ` SIM-CMD-ERR ${r.commandErrors} (${r.lastCommandError})` : '';
  if (brief) {
    const ps = r.players.map((p) => `${p.defeated ? '-' : '+'}${p.pantheon}/${p.difficulty[0]} T${p.team}${p.expandAt ? ` x${(p.expandAt / 60).toFixed(1)}` : ''}${p.aiErrors ? ` ERR${p.aiErrors}` : ''}`).join(' ');
    return `seed ${r.seed}: ${win} ${r.minutes.toFixed(1)}m | ${ps}${errs}`;
  }
  const lines = [`seed ${r.seed} ${r.size}: ${win} after ${r.minutes.toFixed(1)} min (${r.realSeconds.toFixed(1)} s real, ${r.msPerTick.toFixed(2)} ms/tick)${errs}`];
  for (const p of r.players) {
    const gods = Object.entries(p.gods).map(([id, g]) => `${id.replace(`${p.pantheon}_`, '')} L${g.level}${g.summons > 1 ? ` x${g.summons}` : ''}`).join(', ') || '-';
    lines.push(`  P${p.index} ${p.pantheon.padEnd(12)} ${p.difficulty.padEnd(6)} T${p.team} ${p.defeated ? 'lost' : 'alive'} tier ${p.tier} | army ${p.armyPop} pop (max ${p.maxArmyPop}) workers ${p.workers} bldg ${p.buildingsNow} | gathered ${p.gathered} trained ${p.unitsTrained} kills ${p.kills} losses ${p.losses} | gods: ${gods} (deaths ${p.godDeaths}) | titans ${p.titans}${p.firstTitanAt ? ` @${(p.firstTitanAt / 60).toFixed(1)}m` : ''} | casts ${p.casts} (gods ${p.godCasts}, titan ${p.titanCasts}) | ai ${p.thinkMs.toFixed(2)} ms/think${p.aiErrors ? ` ERR ${p.aiErrors}` : ''}`);
    lines.push(`     econ: expand ${p.expandAt ? (p.expandAt / 60).toFixed(1) + 'm' : '-'} | workers @5m ${p.workersAt5} @10m ${p.workersAt10} | gold in ${Math.round(p.goldIn)} | waiting miners avg ${p.avgWait.toFixed(1)} idle avg ${p.avgIdle.toFixed(1)} | max bank ${Math.round(p.maxBank)} stall ${p.stallMax}s`);
  }
  if (r.trace) lines.push(...r.trace);
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
  let errors = 0;
  let aiErrors = 0;
  let cmdErrors = 0;
  let side = { games: 0, p0: 0 };
  const h2h = new Map(); // 'hard>normal' -> { games, wins of the first }
  const expand = new Map(); // difficulty -> [minutes]
  const stalls = new Map(); // difficulty -> [seconds]
  const panSide = new Map(); // pantheon -> { games as P0, wins as P0, games as P1, wins as P1 }
  for (const r of results) {
    if (r.error) {
      errors++;
      continue;
    }
    cmdErrors += r.commandErrors || 0;
    if (!r.finished) timeouts++;
    else lengths.push(r.minutes);
    if (r.players.length === 2 && r.winningTeam !== null) {
      const [a, b] = r.players;
      side.games++;
      if (a.team === r.winningTeam) side.p0++;
      for (const p of r.players) {
        const rec = panSide.get(p.pantheon) || { g0: 0, w0: 0, g1: 0, w1: 0 };
        if (p.index === 0) {
          rec.g0++;
          if (p.team === r.winningTeam) rec.w0++;
        } else {
          rec.g1++;
          if (p.team === r.winningTeam) rec.w1++;
        }
        panSide.set(p.pantheon, rec);
      }
      if (a.difficulty !== b.difficulty) {
        const [hi, lo] = ['hard', 'normal', 'easy'].indexOf(a.difficulty) < ['hard', 'normal', 'easy'].indexOf(b.difficulty) ? [a, b] : [b, a];
        const key = `${hi.difficulty} vs ${lo.difficulty}`;
        const rec = h2h.get(key) || { games: 0, wins: 0 };
        rec.games++;
        if (hi.team === r.winningTeam) rec.wins++;
        h2h.set(key, rec);
      }
    }
    for (const p of r.players) {
      const won = r.winningTeam !== null && p.team === r.winningTeam;
      bump(pan, p.pantheon, won);
      bump(diff, p.difficulty, won);
      titans += p.titans;
      casts += p.casts;
      aiErrors += p.aiErrors || 0;
      if (!expand.has(p.difficulty)) expand.set(p.difficulty, []);
      if (p.expandAt !== null && p.expandAt !== undefined) expand.get(p.difficulty).push(p.expandAt / 60);
      if (!stalls.has(p.difficulty)) stalls.set(p.difficulty, []);
      stalls.get(p.difficulty).push(p.stallMax || 0);
    }
  }
  const out = [];
  out.push('\nPantheon win rates:');
  for (const [k, v] of [...pan].sort((a, b) => b[1].wins / b[1].games - a[1].wins / a[1].games)) {
    out.push(`  ${k.padEnd(13)} ${String(v.wins).padStart(3)}/${String(v.games).padEnd(3)} ${((100 * v.wins) / v.games).toFixed(0).padStart(3)}%`);
  }
  out.push('Difficulty win rates:');
  for (const [k, v] of diff) out.push(`  ${k.padEnd(13)} ${String(v.wins).padStart(3)}/${String(v.games).padEnd(3)} ${((100 * v.wins) / v.games).toFixed(0).padStart(3)}%`);
  for (const [k, v] of h2h) out.push(`  ${k.padEnd(16)} ${v.wins}/${v.games} ${((100 * v.wins) / v.games).toFixed(0)}% (stronger side wins)`);
  if (side.games) {
    out.push(`Side bias (1v1 decided games): P0 won ${side.p0}/${side.games} ${((100 * side.p0) / side.games).toFixed(0)}%`);
    const rows = [...panSide].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    out.push('  per pantheon (wins as P0 / as P1): ' + rows.map(([k, v]) => `${k} ${v.w0}/${v.g0}·${v.w1}/${v.g1}`).join(', '));
  }
  lengths.sort((a, b) => a - b);
  const avg = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const pct = (q) => (lengths.length ? lengths[Math.min(lengths.length - 1, Math.floor(q * lengths.length))].toFixed(1) : '-');
  const inBand = lengths.filter((m) => m >= 12 && m <= 30).length;
  out.push(`Games: ${results.length}, finished ${lengths.length}, time limit ${timeouts}, errors ${errors}; length avg ${avg.toFixed(1)} min, min ${lengths[0]?.toFixed(1) ?? '-'}, p10 ${pct(0.1)}, median ${pct(0.5)}, p90 ${pct(0.9)}, max ${lengths[lengths.length - 1]?.toFixed(1) ?? '-'}; in 12–30 min: ${inBand}/${lengths.length}`);
  const stat = (l) => {
    if (!l.length) return '-';
    const a = l.slice().sort((x, y) => x - y);
    return `avg ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)} median ${a[a.length >> 1].toFixed(1)} max ${a[a.length - 1].toFixed(1)}`;
  };
  for (const [k, l] of expand) out.push(`First expansion (${k}): ${l.length} players expanded, ${stat(l)} min`);
  for (const [k, l] of stalls) out.push(`Bank stall (${k}, longest ≥1500 unspent with ≥15 pop room, below the army cap): ${stat(l)} s; players > 120 s: ${l.filter((x) => x > 120).length}/${l.length}`);
  out.push(`Titans summoned: ${titans}, abilities cast: ${casts}; AI errors ${aiErrors}, sim command errors ${cmdErrors}`);
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
        if (!opt.quiet) console.log(`[${done}/${games.length}] ${fmtGame(result, !!opt.brief)}`);
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
