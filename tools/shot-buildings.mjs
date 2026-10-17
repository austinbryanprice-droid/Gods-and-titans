#!/usr/bin/env node
// Screenshots of tools/gallery-buildings.html for visual checks of the building
// and prop models.
//
//   node tools/shot-buildings.mjs [--port 8102] [--out DIR] [--only grid,row-greek,...] [--width 1600] [--height 1000]
//
// Starts a static server on the port unless one already answers there, then
// captures: the full grid (registry pantheons), one close row per pantheon, the
// roster styles with gallery colors, every style value, the town center tiers,
// construction stages, close-ups of temples / titan gates / cities, the nature
// patch and a real generated map. Prints console errors from the page.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const port = Number(opt('port', '8102'));
const out = opt('out', join(tmpdir(), 'mythicwar-building-shots'));
const only = opt('only', '') ? opt('only', '').split(',') : null;
const width = Number(opt('width', '1600'));
const height = Number(opt('height', '1000'));
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = `http://localhost:${port}/tools/gallery-buildings.html`;

const PANTHEONS = ['greek', 'norse', 'egyptian', 'hindu', 'japanese', 'chinese', 'aztec', 'celtic', 'mesopotamian', 'west_african'];
const shots = [
  { name: 'grid', q: 't=1.2&labels=1', w: 1900, h: 1500 },
  ...PANTHEONS.map((p) => ({ name: `row-${p}`, q: `pantheon=${p}&t=1.2&units=1` })),
  { name: 'roster', q: 'src=roster&t=1.2', w: 1900, h: 1500 },
  { name: 'values', q: 'src=values&t=1.2', w: 1900, h: 1700 },
  { name: 'tiers-a', q: 'types=tc1,tc2,tc3&pantheon=greek,norse,egyptian,hindu,japanese&t=1.2' },
  { name: 'tiers-b', q: 'types=tc1,tc2,tc3&pantheon=chinese,aztec,celtic,mesopotamian,west_african&t=1.2' },
  { name: 'temples-a', q: 'types=shrine,temple,titan_gate&pantheon=greek,norse,egyptian,hindu,japanese&t=1.2' },
  { name: 'temples-b', q: 'types=shrine,temple,titan_gate&pantheon=chinese,aztec,celtic,mesopotamian,west_african&t=1.2' },
  { name: 'small-a', q: 'types=house,storehouse,tower,barracks&pantheon=greek,norse,egyptian,hindu,japanese&t=1.2' },
  { name: 'small-b', q: 'types=house,storehouse,tower,barracks&pantheon=chinese,aztec,celtic,mesopotamian,west_african&t=1.2' },
  { name: 'construction', q: 'view=construction&pantheon=greek,norse,egyptian,japanese,west_african&t=1.2' },
  { name: 'nature', q: 'view=nature&t=1.2' },
  { name: 'nature-shadows', q: 'view=nature&t=1.2&shadows=1' },
  { name: 'map', q: 'view=map&seed=7&size=medium&t=1.2' },
  { name: 'map-overview', q: 'view=map&seed=7&size=medium&overview=1&t=1.2' },
  { name: 'mix-team', q: 'team=mix&types=tc3,temple,tower&t=1.2' },
];

async function serverUp() {
  try {
    const r = await fetch(`http://localhost:${port}/tools/gallery-buildings.html`);
    return r.ok;
  } catch {
    return false;
  }
}

let server = null;
if (!(await serverUp())) {
  server = spawn('npx', ['http-server', '.', '-p', String(port), '-c-1', '--silent'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await serverUp()); i++) await new Promise((r) => setTimeout(r, 200));
}

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failures = 0;
try {
  for (const s of shots) {
    if (only && !only.includes(s.name)) continue;
    const page = await browser.newPage({ viewport: { width: s.w || width, height: s.h || height } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    const t0 = Date.now();
    await page.goto(`${base}?${s.q}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
    await page.evaluate(() => window.renderAt && window.renderAt(1.2));
    const file = join(out, `${s.name}.png`);
    await page.screenshot({ path: file });
    const stats = await page.evaluate(() => document.getElementById('stats').textContent);
    const errText = await page.evaluate(() => document.getElementById('err').textContent);
    console.log(`${s.name.padEnd(16)} ${String(Date.now() - t0).padStart(6)} ms  ${stats}  → ${file}`);
    for (const e of [...errors, ...(errText ? [errText] : [])]) {
      failures++;
      console.log(`  ERROR ${e}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  if (server) server.kill();
}
process.exitCode = failures ? 1 : 0;
