#!/usr/bin/env node
// Accessibility check of the interface at one window size (default 1280x720): every visible piece of
// text is measured for its font size and its contrast against what is behind it, on the title screen,
// Settings, the lobby, How to Play, the in-game HUD, the F10 menu and the Keys panel. Also takes
// matched stills of a battle with the standard and the colour-blind-safe team colours.
//
//   node tools/shot-access.mjs [--port 8203] [--out DIR] [--size 1280x720] [--min 10] [--contrast 4.5]
//
// Text smaller than --min px, or below --contrast against its background, is listed (the background is
// the nearest painted ancestor, see-through ones laid over a mid-grey stand-in for the map; a gradient counts
// by its first colour, so a card with a glow at one end can be flagged when it reads well: look at the still). Exits
// non-zero when a page logs an error. The report is <out>/access-report.json.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const port = Number(opt('port', '8203'));
const out = opt('out', join(tmpdir(), 'mythicwar-access'));
const [VW, VH] = opt('size', '1280x720').split('x').map(Number);
const MIN_PX = Number(opt('min', '10'));
const MIN_CONTRAST = Number(opt('contrast', '4.5'));
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = `http://localhost:${port}/index.html`;
const LAUNCH_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function serverUp() {
  try {
    return (await fetch(base)).ok;
  } catch {
    return false;
  }
}
async function ensureServer() {
  if (await serverUp()) return null;
  const child = spawn(process.execPath, [join(root, 'node_modules', 'http-server', 'bin', 'http-server'), root, '-p', String(port), '-c-1', '--silent'], { stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await serverUp()); i++) await wait(100);
  return child;
}

// Runs in the page: every visible element with its own text, its size and its contrast.
function audit([minPx, minContrast]) {
  const parse = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s || '');
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const over = (top, under) => {
    const a = top[3];
    return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
  };
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => {
    const x = lum(a);
    const y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  // the colours painted behind an element, nearest first (a gradient counts by its first colour)
  const behind = (n) => {
    const layers = [];
    for (let e = n; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const bg = parse(cs.backgroundColor);
      const img = cs.backgroundImage && cs.backgroundImage !== 'none' ? parse(cs.backgroundImage) : null;
      const op = Number(cs.opacity);
      for (const c of [img, bg]) if (c && c[3] > 0.02) layers.push([c[0], c[1], c[2], c[3] * (op < 1 ? op : 1)]);
      if (layers.length && layers[layers.length - 1][3] >= 0.98) break;
      if (e.tagName === 'CANVAS') break;
    }
    let col = [58, 58, 58, 1]; // the map, or the menu's art: a mid-grey stand-in
    for (let i = layers.length - 1; i >= 0; i--) col = over(layers[i], col);
    return col;
  };
  const seen = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const text = t.textContent.replace(/\s+/g, ' ').trim();
    if (!text || /^[\p{Extended_Pictographic}‍️\s·•|×✕✖✓›‹…—-]+$/u.test(text)) continue; // icons and separators
    const n = t.parentElement;
    if (!n || n.closest('[hidden], [aria-hidden="true"]')) continue;
    const r = n.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(n);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    let op = 1;
    for (let e = n; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    if (op < 0.2) continue; // fading out
    const size = parseFloat(cs.fontSize);
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = behind(n);
    const c = ratio(over([fg[0], fg[1], fg[2], fg[3] * Math.min(1, op)], bg), bg);
    const bold = Number(cs.fontWeight) >= 700;
    // WCAG: large text (24 px, or 18.66 px bold) needs 3:1
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : minContrast;
    const cls = typeof n.className === 'string' ? n.className.split(' ')[0] : n.tagName;
    seen.push({ text: text.slice(0, 40), cls, size: Math.round(size * 10) / 10, contrast: Math.round(c * 100) / 100, small: size < minPx - 0.05, low: c < need });
  }
  return seen;
}

async function check(page, label, report) {
  const items = await page.evaluate(audit, [MIN_PX, MIN_CONTRAST]);
  const small = items.filter((x) => x.small);
  const low = items.filter((x) => x.low);
  report[label] = { texts: items.length, smallest: Math.min(...items.map((x) => x.size)), small, low };
  console.log(`${label}: ${items.length} texts, smallest ${report[label].smallest}px, ${small.length} under ${MIN_PX}px, ${low.length} under the contrast bar`);
  for (const x of [...small, ...low].slice(0, 12)) console.log(`   ${x.small ? `${x.size}px` : ''}${x.low ? ` ${x.contrast}:1` : ''}  .${x.cls}  "${x.text}"`);
  await page.screenshot({ path: join(out, `${label}.png`) });
}

const server = await ensureServer();
const browser = await chromium.launch({ args: LAUNCH_ARGS });
const errors = [];
const report = {};
try {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
  await ctx.addInitScript(() => {
    try {
      if (!localStorage.getItem('mythicwar-settings')) localStorage.setItem('mythicwar-settings', JSON.stringify({ name: 'Tester', intro: false, quality: 'low' }));
    } catch {}
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base);
  await page.waitForSelector('.mw-title-screen');
  await wait(600);
  await check(page, 'title', report);
  await page.click('text=Settings');
  await page.waitForSelector('.mw-settings');
  await wait(300);
  await check(page, 'settings', report);
  await page.evaluate(() => document.querySelector('.mw-keys')?.scrollIntoView()); // (not on a build before the Keys panel)
  await wait(200);
  await page.screenshot({ path: join(out, 'settings-keys.png') });
  await page.keyboard.press('Escape');
  await page.click('text=How to Play').catch(() => {});
  await wait(400);
  await check(page, 'howto', report);
  await page.keyboard.press('Escape');
  await wait(300);
  await page.click('text=Play vs AI');
  await page.waitForSelector('.mw-lobby', { timeout: 8000 });
  await wait(300);
  await check(page, 'lobby', report);
  await page.click('.mw-btn--start');
  await page.waitForFunction(() => window.__game && window.__game.stats && window.__game.stats.frames > 3, null, { timeout: 60000, polling: 100 });
  await wait(1500);
  // a small battle in view: own and enemy soldiers, some selected
  await page.evaluate(() => {
    const g = window.__game;
    const w = g.session.world;
    const tc = [...g.viewState.entities.values()].find((e) => e.k === 'b' && e.o === g.viewState.myIndex && e.t === 'town_center');
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(w.spawnUnit(0, 'warrior', tc.x + 4 + i, tc.y + 4, { silent: true }).id);
    const foes = [];
    for (let i = 0; i < 3; i++) foes.push(w.spawnUnit(1, 'archer', tc.x + 4.5 + i, tc.y + 7.5, { silent: true }).id);
    g.session.ticker.run(2);
    window.__shotFoes = foes;
    g.renderer.camera.centerOn(tc.x + 5, tc.y + 5);
    g.selection.set(ids);
    window.__shotIds = ids;
  });
  await wait(2500);
  await page.evaluate(() => window.__game.setPaused(true)); // as under the F10 menu: the stills below are drawn paused
  await check(page, 'hud', report);
  await page.screenshot({ path: join(out, 'battle-standard.png') });
  await page.evaluate(() => {
    window.__game.selection.set(window.__shotFoes);
    window.__game.needsRender = true;
  });
  await wait(1200);
  await page.screenshot({ path: join(out, 'enemy-standard.png') });
  await page.evaluate(() => import('/src/settings.js').then((m) => m.saveSettings({ teamColors: 'colorblind' })));
  await wait(3000);
  await page.screenshot({ path: join(out, 'enemy-colorblind.png') });
  await page.evaluate(() => {
    window.__game.selection.set(window.__shotIds);
    window.__game.needsRender = true;
  });
  await wait(1200);
  await page.screenshot({ path: join(out, 'battle-colorblind.png') });
  await page.keyboard.press('F10');
  await wait(500);
  await check(page, 'menu', report);
  if (await page.$('text=Change keys…')) {
    await page.click('text=Change keys…');
    await wait(400);
    await check(page, 'keys', report);
    await page.keyboard.press('Escape');
  }
  await page.keyboard.press('Escape');
  await page.evaluate(() => import('/src/settings.js').then((m) => m.saveSettings({ teamColors: 'standard', cardKeys: 'grid' })));
  await wait(800);
  await page.screenshot({ path: join(out, 'hud-grid-keys.png') });
} finally {
  writeFileSync(join(out, 'access-report.json'), JSON.stringify({ size: `${VW}x${VH}`, minPx: MIN_PX, minContrast: MIN_CONTRAST, report, errors }, null, 2));
  await browser.close();
  if (server) server.kill();
}
if (errors.length) {
  console.log('page errors:', errors.slice(0, 5).join(' | '));
  process.exit(1);
}
console.log(`stills and report in ${out}`);
