#!/usr/bin/env node
// Quick look at the whole game: title, lobby, and the live game view with HUD after a short
// AI match warm-up (camera on the home base and pulled in close).
//   node tools/shot-overview.mjs [--port 8301] [--out DIR] [--prefix before] [--quality high]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const port = Number(opt('port', '8301'));
const out = opt('out', join(tmpdir(), 'mythicwar-overview'));
const prefix = opt('prefix', 'shot');
const quality = opt('quality', 'high');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(out, { recursive: true });
const server = spawn(join(root, 'node_modules/.bin/http-server'), ['.', '-p', String(port), '-c-1', '--silent'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.addInitScript((q) => {
  try {
    const s = JSON.parse(localStorage.getItem('mythicwar-settings') || '{}');
    s.quality = q; s.tipsDismissed = true; localStorage.setItem('mythicwar-settings', JSON.stringify(s));
  } catch {}
}, quality);
const shot = async (name) => { const f = join(out, `${prefix}-${name}.png`); await page.screenshot({ path: f }); console.log(f); };
try {
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForSelector('.mw-title-screen');
  await page.waitForTimeout(1500);
  await shot('title');
  await page.click('text=Play vs AI');
  await page.waitForSelector('.mw-lobby', { timeout: 8000 });
  await page.waitForTimeout(500);
  await shot('lobby');
  await page.click('.mw-btn--start');
  await page.waitForFunction(() => window.__game && window.__game.stats && window.__game.stats.frames > 5, null, { timeout: 60000 });
  await page.evaluate(() => { const c = document.querySelector('.hud-tips-close'); if (c) c.click(); });
  // let the match run a bit so the base has workers moving
  await page.waitForTimeout(6000);
  await shot('game');
  await page.keyboard.down('Control'); await page.keyboard.press('a').catch(() => {}); await page.keyboard.up('Control');
  await page.mouse.move(800, 400);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(250); }
  await page.waitForTimeout(1500);
  await shot('game-close');
} finally {
  await browser.close();
  server.kill();
}
