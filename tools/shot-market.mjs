#!/usr/bin/env node
// The team market: a 2v2 vs AI game with the Market panel open (teammate picked, an amount
// entered), then the whole map from the minimap corner to show teammates on one side.
//   node tools/shot-market.mjs [--port 8302] [--out DIR] [--quality low]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const port = Number(opt('port', '8302'));
const out = opt('out', join(tmpdir(), 'mythicwar-market'));
const quality = opt('quality', 'low');
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
const shot = async (name, clip) => { const f = join(out, `market-${name}.png`); await page.screenshot({ path: f, clip }); console.log(f); };
try {
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForSelector('.mw-title-screen');
  await page.click('text=Play vs AI');
  await page.waitForSelector('.mw-lobby', { timeout: 8000 });
  await page.click('[data-preset="2v2"]');
  await page.waitForTimeout(400);
  await shot('lobby');
  await page.click('.mw-btn--start');
  await page.waitForFunction(() => window.__game && window.__game.stats && window.__game.stats.frames > 5, null, { timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.click('.hud-market-btn');
  await page.click('text=+100');
  await page.click('text=+50');
  await page.waitForTimeout(400);
  await shot('panel');
  await page.click('.hud-market-send');
  await page.waitForTimeout(1500);
  await shot('sent');
} finally {
  await browser.close();
  server.kill();
}
