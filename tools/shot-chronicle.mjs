#!/usr/bin/env node
// The after-game chronicle: a 2v2 vs AI game, a made-up 24-minute history written into the
// chronicle and the players' stats, then the victory screen on each of its four tabs.
//   node tools/shot-chronicle.mjs [--port 8303] [--out DIR] [--quality low]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const port = Number(opt('port', '8303'));
const out = opt('out', join(tmpdir(), 'mythicwar-chronicle'));
const quality = opt('quality', 'low');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(out, { recursive: true });
const server = spawn(join(root, 'node_modules/.bin/http-server'), ['.', '-p', String(port), '-c-1', '--silent'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const launch = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.addInitScript((q) => {
  try {
    const s = JSON.parse(localStorage.getItem('mythicwar-settings') || '{}');
    s.quality = q; s.tipsDismissed = true; localStorage.setItem('mythicwar-settings', JSON.stringify(s));
  } catch {}
}, quality);
const shot = async (name) => { const f = join(out, `chronicle-${name}.png`); await page.screenshot({ path: f }); console.log(f); };
try {
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForSelector('.mw-title-screen');
  await page.click('text=Play vs AI');
  await page.waitForSelector('.mw-lobby', { timeout: 8000 });
  await page.click('[data-preset="2v2"]');
  await page.click('.mw-btn--start');
  await page.waitForFunction(() => window.__game && window.__game.stats && window.__game.stats.frames > 5, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const g = window.__game;
    const vs = g.viewState;
    g.setPaused(true);
    const end = 24 * 60;
    // Each player's shape over the match: how fast the economy grew, when the fighting began.
    const shape = [
      { eco: 1.0, army: 1.0, kill: 1.0, raze: 9 },
      { eco: 0.8, army: 0.7, kill: 0.5, raze: 3 },
      { eco: 0.9, army: 0.8, kill: 0.6, raze: 1 },
      { eco: 0.7, army: 0.6, kill: 0.4, raze: 0 },
    ];
    const statsAt = (i, t) => {
      const s = shape[i % shape.length];
      const f = t / end;
      const gathered = Math.round(s.eco * 26000 * f ** 1.3);
      const kills = Math.round(s.kill * 140 * Math.max(0, f - 0.3) ** 1.2);
      return {
        gathered, gold: Math.round(gathered * 0.6), wood: Math.round(gathered * 0.4), faith: Math.round(s.eco * 4200 * f ** 1.5),
        unitsTrained: Math.round(s.army * 160 * f), kills, losses: Math.round(kills * (1.4 - s.kill)), buildings: Math.round(8 + 30 * s.eco * f),
        razed: Math.round(s.raze * f ** 2), killValue: kills * 95, lostValue: Math.round(kills * 95 * (1.4 - s.kill)),
        army: Math.round(s.army * 90 * Math.sin(Math.min(1, f * 1.4) * Math.PI * 0.85) + 4 * Math.sin(t / 50)),
      };
    };
    const c = g.chronicle;
    c.reset();
    for (let t = 0; t <= end; t += 30) {
      c.observe({ time: t, gameOver: null, players: vs.players.map((p, i) => ({ ...p, tier: t > 600 ? 3 : t > 300 ? 2 : 1, up: Array.from({ length: Math.floor(t / 90) }), stats: statsAt(i, t) })) });
    }
    vs.players.forEach((p, i) => { p.stats = statsAt(i, end); p.tier = 3; p.up = Array.from({ length: 12 }); p.defeated = p.team !== vs.myTeam; });
    vs.time = end;
    g.hud.overlays.showGameOver({ result: 'victory', winningTeam: vs.myTeam });
  });
  await page.waitForSelector('.hud-chronicle');
  await page.waitForTimeout(4000); // the screen fades in, slowly under software GL
  await shot('summary');
  for (const tab of ['economy', 'military', 'timeline']) {
    await page.click(`.hud-ch-tabs [data-tab="${tab}"]`);
    await page.waitForTimeout(300);
    await shot(tab);
  }
  await page.click('.hud-ch-metrics >> text=Army');
  await page.waitForTimeout(300);
  await shot('timeline-army');
} finally {
  await browser.close();
  server.kill();
}
