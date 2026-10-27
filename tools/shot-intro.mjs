#!/usr/bin/env node
// Stills of the intro film (DESIGN 11.1), for tuning the camera, the timing and the sky.
//
//   node tools/shot-intro.mjs [--at 2,6,9.5,12] [--size 960x540] [--quality medium] [--out DIR] [--port 8106]
//   node tools/shot-intro.mjs --at 20 --pose x,y,dist,pitch,yaw,lift,fov   # the camera put where you say (x, y: tiles) at that second
//   node tools/shot-intro.mjs --at 40 --hour 20.5                           # the sky at another hour than the script's
//   node tools/shot-intro.mjs --sheet      # also one contact sheet of every still (sheet.png)
//   node tools/shot-intro.mjs --flow       # the page flow: the film plays on its own clock, Esc skips it
//   node tools/shot-intro.mjs --narration  # the voice: each caption read as it comes up, Esc cuts it, a click unlocks it
//
// The film runs in manual mode (src/ui/intro.js playIntro({ manual: true })): the tool moves it on in
// 0.05 s steps and draws only the seconds asked for, so software GL (a few seconds a frame) is
// enough. The overlay (bars, caption, fades) is in the stills. Starts a static server on the port
// unless one already answers there. Prints page errors; exits non-zero when a check fails.
// (--narration cannot hear anything: a stand-in speech synthesis records what the page asks of it.)

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const port = Number(opt('port', '8106'));
const out = opt('out', join(tmpdir(), 'mythicwar-intro-shots'));
const [W, H] = opt('size', '960x540').split('x').map(Number);
const quality = opt('quality', 'medium');
const pose = opt('pose', '') ? opt('pose', '').split(',').map(Number) : null; // x, y, dist, pitch, yaw, lift, fov
const hour = opt('hour', '') ? Number(opt('hour', '')) : null;
const times = opt('at', '1,3,6,8,10,12,14,16,18,21,24,26,28,31,33,35,38,41').split(',').map(Number).filter((t) => t >= 0).sort((a, b) => a - b);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = `http://localhost:${port}/index.html`;
const LAUNCH_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
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
  const bin = join(root, 'node_modules', 'http-server', 'bin', 'http-server');
  const child = spawn(process.execPath, [bin, '.', '-p', String(port), '-c-1', '--silent'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    await wait(200);
    if (await serverUp()) return child;
  }
  child.kill();
  throw new Error(`static server did not start on port ${port}`);
}

function watchErrors(page, errors) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
    else if (m.type() === 'warning' && /\[intro\]/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`http ${r.status()}: ${r.url()}`);
  });
}

// ---------------------------------------------------------------- stills

async function stills(browser, errors) {
  mkdirSync(out, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  watchErrors(page, errors);
  page.on('console', (m) => {
    if (/^\[shot\]/.test(m.text())) console.log(`  ${m.text()}`);
  });
  await page.goto(`${base}?intro=0`);
  await page.waitForSelector('.mw-title-screen');
  await page.addStyleTag({ content: '.mw-intro-loading { display: none !important; }' }); // the card fades by the clock; the stills have none
  const started = Date.now();
  await page.evaluate(async (q) => {
    const { playIntro } = await import('/src/ui/intro.js');
    const intro = playIntro({ manual: true, guard: false, narrate: false, quality: q, wait: () => Promise.resolve() });
    window.__intro = intro;
    await intro.ready;
  }, quality);
  console.log(`film ready in ${((Date.now() - started) / 1000).toFixed(1)} s (${W}x${H}, ${quality})`);
  const places = await page.evaluate(() => {
    const stage = window.__intro.film.stage;
    const m = stage.world.mapData;
    return { map: `${m.width}x${m.height}`, ...Object.fromEntries(Object.entries(stage.anchors).map(([k, v]) => [k, `${v.x.toFixed(1)},${v.y.toFixed(1)}`])) };
  });
  console.log(`  places: ${JSON.stringify(places)}`);
  const files = [];
  for (const t of times) {
    const info = await page.evaluate(({ target, p, hr }) => {
      const intro = window.__intro;
      const film = intro.film;
      if (!film) return { error: 'the film is gone (it ended)' };
      while (film.t < target - 1e-6) intro.advance(Math.min(0.05, target - film.t));
      if (Number.isFinite(hr)) {
        film.renderer.atmo.setMode(hr);
        film.renderer.update(0);
        film.paintSky();
      }
      if (p) {
        // a camera of our own for this still: the pose the script would give, replaced
        const keys = ['x', 'y', 'dist', 'pitch', 'yaw', 'lift', 'fov'];
        keys.forEach((k, i) => { if (Number.isFinite(p[i])) film.pose[k] = p[i]; });
        film.renderer.update(0);
      }
      const t0 = performance.now();
      intro.draw();
      const gl = film.renderer.renderer.getContext();
      gl.finish();
      const st = film.renderer.getStats ? film.renderer.getStats() : {};
      return { t: film.t, shot: film.shot.id, drawMs: Math.round(performance.now() - t0), calls: st.drawCalls, tris: st.triangles, hour: film.renderer.atmo.hour ?? null };
    }, { target: t, p: pose, hr: hour });
    if (info.error) {
      console.log(`  ${t}s: ${info.error}`);
      break;
    }
    const name = `t${String(t).padStart(5, '0').replace('.', '_')}.png`;
    await page.screenshot({ path: join(out, name) });
    files.push({ t, name });
    console.log(`  t=${info.t.toFixed(2)} ${info.shot.padEnd(7)} draw ${info.drawMs} ms, ${info.calls} calls, ${(info.tris / 1000).toFixed(0)}k tris → ${name}`);
  }
  await ctx.close();
  return files;
}

/** One image with every still in a grid (a timeline to judge the cuts and the pacing at a glance). */
async function sheet(browser, files) {
  const cols = 3;
  const w = Math.round(W * 0.5);
  const h = Math.round(H * 0.5);
  const cells = files.map((f) => `<figure><img src="data:image/png;base64,${readFileSync(join(out, f.name)).toString('base64')}" width="${w}" height="${h}"><figcaption>${f.t}s</figcaption></figure>`).join('');
  const html = `<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},${w}px);gap:4px;padding:4px;width:${cols * w + (cols + 1) * 4}px;font:12px sans-serif;color:#ddd"><style>figure{margin:0;position:relative}figcaption{position:absolute;left:6px;top:4px;background:#000a;padding:1px 5px;border-radius:3px}img{display:block}</style>${cells}</body>`;
  const ctx = await browser.newContext({ viewport: { width: cols * w + (cols + 1) * 4, height: 600 } });
  const page = await ctx.newPage();
  await page.setContent(html);
  await wait(300);
  await page.screenshot({ path: join(out, 'sheet.png'), fullPage: true });
  await ctx.close();
  console.log(`contact sheet: ${join(out, 'sheet.png')}`);
}

// ---------------------------------------------------------------- the page flow

/** Checks that print as they go: ok(name, condition, detail), and the list of results. */
function reporter() {
  const results = [];
  const ok = (name, cond, detail = '') => {
    results.push({ name, pass: !!cond });
    console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  };
  return { results, ok };
}

async function flow(browser, errors) {
  const { results, ok } = reporter();
  mkdirSync(out, { recursive: true });

  // the film plays when asked (?intro=1), shows over a hidden menu, and Esc hands over to the title
  {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
    const page = await ctx.newPage();
    watchErrors(page, errors);
    await page.goto(`${base}?intro=1`);
    await page.waitForSelector('.mw-intro');
    const menuHidden = await page.evaluate(() => document.getElementById('menu-root').hidden);
    ok('intro: the menu is hidden while the film loads', menuHidden);
    await page.waitForSelector('.mw-intro.is-playing', { timeout: 120000 });
    ok('intro: the film is playing', true);
    await page.screenshot({ path: join(out, 'flow-playing.png') });
    const before = await page.evaluate(() => document.getElementById('menu-root').hidden);
    ok('intro: the menu stays hidden during the film', before);
    await page.keyboard.press('Escape');
    // software GL draws far slower than the page submits: freeing the renderer waits for the backlog (half a minute here, nothing on a GPU)
    await page.waitForSelector('.mw-intro', { state: 'detached', timeout: 180000 });
    const title = await page.$('.mw-title-screen');
    ok('intro: Esc leaves the film for the title screen', !!title);
    ok('intro: the menu is visible again', !(await page.evaluate(() => document.getElementById('menu-root').hidden)));
    const canvases = await page.$$eval('canvas', (els) => els.length);
    ok('intro: the film canvas is gone (the menu backdrop has its own)', (await page.$('.mw-intro-canvas')) === null, `${canvases} canvases`);
    await page.screenshot({ path: join(out, 'flow-title.png') });
    await ctx.close();
  }

  // Settings: the toggle is saved, and "Watch it now" plays the film and comes back to Settings (not the title)
  {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const page = await ctx.newPage();
    watchErrors(page, errors);
    await page.goto(`${base}?intro=0`);
    await page.waitForSelector('.mw-title-screen');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.waitForSelector('.mw-intro-watch');
    const row = page.locator('.mw-toggle', { hasText: 'Play it when the game opens' });
    const box = row.locator('input');
    ok('settings: the intro toggle starts on', await box.isChecked());
    await page.screenshot({ path: join(out, 'flow-settings.png') });
    await row.click(); // the checkbox itself is hidden under its styled track
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mythicwar-settings')).intro);
    ok('settings: turning it off is saved', saved === false);
    await row.click();
    ok('settings: and on again', await box.isChecked());
    await page.click('.mw-intro-watch');
    await page.waitForSelector('.mw-intro.is-playing', { timeout: 120000 });
    ok('settings: "Watch it now" plays the film', true);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.mw-intro', { state: 'detached', timeout: 180000 });
    ok('settings: Esc comes back to the Settings screen', !!(await page.$('.mw-intro-watch')) && !(await page.$('.mw-title-screen')));
    await ctx.close();
  }

  // an automated browser and a ?join link skip the film by themselves; ?intro=0 always does
  for (const [label, q] of [['default (webdriver)', ''], ['?join=', '?join=ABCDE'], ['?intro=0', '?intro=0']]) {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
    const page = await ctx.newPage();
    watchErrors(page, errors);
    await page.goto(`${base}${q}`);
    await page.waitForSelector('.mw-title-screen, .mw-join');
    ok(`intro: skipped for ${label}`, (await page.$('.mw-intro')) === null);
    await ctx.close();
  }
  return results;
}

// ---------------------------------------------------------------- the narration

/**
 * A speech synthesis for the page to talk to (runs in the page). It records every call with the caption on the screen
 * and the film's second, and refuses to speak while `__speech.allowed` is false, as Chrome does before the page has
 * had a click.
 */
function installSpeechStandIn() {
  const calls = [];
  window.__speech = { calls, allowed: true };
  window.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  const synth = {
    speaking: false,
    pending: false,
    speak(u) {
      const cap = document.querySelector('.mw-intro-caption');
      calls.push({ call: 'speak', text: u.text, caption: cap ? cap.textContent : null, t: window.__intro && window.__intro.film ? window.__intro.film.t : null, lang: u.lang, volume: u.volume, rate: u.rate, pitch: u.pitch, at: performance.now() });
      if (!window.__speech.allowed) {
        setTimeout(() => u.onerror && u.onerror({ error: 'not-allowed' }), 0); // the refusal arrives in a task of its own
        return;
      }
      synth.speaking = true;
      setTimeout(() => u.onstart && u.onstart({}), 0);
    },
    cancel() {
      calls.push({ call: 'cancel', at: performance.now() });
      synth.speaking = false;
    },
    getVoices: () => [],
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
}

async function narration(browser, errors) {
  const { results, ok } = reporter();
  mkdirSync(out, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  await ctx.addInitScript(installSpeechStandIn);
  const page = await ctx.newPage();
  watchErrors(page, errors);
  await page.goto(`${base}?intro=0`);
  await page.waitForSelector('.mw-title-screen');
  await page.addStyleTag({ content: '.mw-intro-loading { display: none !important; }' }); // the card fades by the clock; these runs have none
  const film = () => page.evaluate(async () => {
    const { playIntro } = await import('/src/ui/intro.js');
    window.__handover = null;
    const intro = playIntro({ manual: true, guard: false, quality: 'low', volume: 0.6, onHandover: () => (window.__handover = performance.now()) });
    window.__intro = intro;
    await intro.ready;
  });
  /** Step the film (on a clock of its own, nothing drawn) to second `target`. */
  const stepTo = (target) => page.evaluate((to) => {
    const intro = window.__intro;
    while (intro.film && intro.film.t < to - 1e-6) intro.advance(Math.min(0.05, to - intro.film.t));
  }, target);
  const calls = () => page.evaluate(() => window.__speech.calls);
  const reset = (allowed = true) => page.evaluate((a) => {
    window.__speech.calls.length = 0;
    window.__speech.allowed = a;
  }, allowed);
  const gone = () => page.waitForSelector('.mw-intro', { state: 'detached', timeout: 180000 });
  const captions = await page.evaluate(async () => (await import('/src/intro/script.js')).CAPTIONS);
  const hint = () => page.evaluate(() => document.querySelector('.mw-intro').classList.contains('needs-click'));
  console.log('narration:');

  // 1. the whole script: each caption is read once, word for word, while it is on the screen
  await film();
  await stepTo(46.9);
  const said = (await calls()).filter((c) => c.call === 'speak');
  ok('one line is read for each caption, in order', JSON.stringify(said.map((c) => c.text)) === JSON.stringify(captions.map((c) => c.text)), said.map((c) => `"${c.text}"`).join(', '));
  ok('each is the caption on the screen as it is read', said.length > 0 && said.every((c) => c.caption === c.text));
  ok('each starts with its caption', said.length === captions.length && said.every((c, i) => c.t >= captions[i].from && c.t < captions[i].from + 0.1), said.map((c) => c.t.toFixed(2)).join(' '));
  ok('in English, at the setting\'s volume, a little slower than talk', said.length > 0 && said.every((c) => c.lang === 'en-US' && c.volume === 0.6 && c.rate < 1 && c.rate > 0.5));
  ok('the hint for a click stays down while the browser speaks', !(await hint()));
  await page.evaluate(() => window.__intro.skip());
  await gone();

  // 2. Esc in the middle of a line cuts the voice before the dip to black is over
  await reset();
  await film();
  await stepTo(10.4); // the second line, "Pray. Summon the gods.", began at 9.6
  const before = await calls();
  ok('a line is being said when Esc comes', before.length === 2 && before[1].text === captions[1].text, JSON.stringify(before.map((c) => c.text || c.call)));
  await page.keyboard.press('Escape');
  const during = await calls();
  ok('Esc cuts the voice in the same breath', during.length === 3 && during[2].call === 'cancel');
  await gone();
  const after = await calls();
  const handover = await page.evaluate(() => window.__handover);
  ok('the cut comes before the title does (the dip to black takes 320 ms)', handover !== null && handover - during[2].at > 250, `${Math.round(handover - during[2].at)} ms`);
  ok('and nothing more is said', after.length === 3);

  // 3. a browser that will not speak before a click: the hint comes up, and any click on the film starts the voice
  await reset(false);
  await film();
  await stepTo(3);
  await page.waitForTimeout(100); // the refusal comes in a task of its own
  ok('refused, the hint comes up', await hint());
  await page.evaluate(() => window.__intro.draw());
  await page.waitForTimeout(700); // it fades in over half a second
  const shown = await page.evaluate(() => getComputedStyle(document.querySelector('.mw-intro-hint')).opacity);
  ok('and shows', Number(shown) > 0.95, `opacity ${shown}`);
  await page.screenshot({ path: join(out, 'narration-hint.png') });
  await page.evaluate(() => (window.__speech.allowed = true));
  await page.mouse.click(320, 180);
  const clicked = await calls();
  ok('a click on the film says the line on the screen', clicked.length === 2 && clicked[1].text === captions[0].text && clicked[1].caption === captions[0].text, JSON.stringify(clicked.map((c) => c.text || c.call)));
  ok('and the hint goes', !(await hint()));
  await stepTo(10);
  const next = (await calls()).filter((c) => c.call === 'speak');
  ok('the next line is read without another click', next.length === 3 && next[2].text === captions[1].text, next.map((c) => `"${c.text}"`).join(', '));
  await page.evaluate(() => window.__intro.skip());
  await gone();

  // 4. the page as a player gets it: on its own clock, the setting decides whether the film is read (low quality, for the sake of software GL)
  for (const on of [true, false]) {
    await reset();
    await page.evaluate((narrate) => localStorage.setItem('mythicwar-settings', JSON.stringify({ quality: 'low', narration: narrate })), on);
    await page.goto(`${base}?intro=1`);
    await page.waitForSelector('.mw-intro.is-playing', { timeout: 120000 });
    await page.waitForFunction(() => document.querySelector('.mw-intro-caption').textContent !== '', null, { timeout: 120000 }); // past 1.4 s of film
    await page.waitForTimeout(500);
    const heard = (await calls()).filter((c) => c.call === 'speak');
    if (on) ok('narration on in Settings: the film is read as it plays', heard.length >= 1 && heard[0].text === captions[0].text && heard[0].caption === captions[0].text, JSON.stringify(heard.map((c) => c.text)));
    else ok('narration off in Settings: not a word is said', heard.length === 0);
    await page.keyboard.press('Escape');
    const cut = await calls();
    if (on) ok('Esc cuts it', cut.at(-1).call === 'cancel');
    else ok('and nothing is cut, for nothing was started', cut.length === 0);
    await gone(); // (software GL: the renderer is freed after the backlog of frames, half a minute here)
  }
  await ctx.close();
  return results;
}

// ---------------------------------------------------------------- main

const server = await ensureServer();
const browser = await chromium.launch({ args: LAUNCH_ARGS });
const errors = [];
let failed = 0;
try {
  if (flag('flow')) {
    console.log('page flow:');
    failed = (await flow(browser, errors)).filter((r) => !r.pass).length;
  } else if (flag('narration')) {
    failed = (await narration(browser, errors)).filter((r) => !r.pass).length;
  } else {
    console.log(`stills at ${times.join(', ')} s:`);
    const files = await stills(browser, errors);
    if (flag('sheet') && files.length) await sheet(browser, files);
    writeFileSync(join(out, 'times.json'), JSON.stringify(files));
  }
} catch (err) {
  console.error(err);
  failed++;
} finally {
  await browser.close();
  if (server) server.kill();
}
if (errors.length) {
  console.log('\npage errors:');
  for (const e of errors) console.log(`  ${e}`);
}
console.log(`\nshots in ${out}`);
process.exit(failed || errors.some((e) => e.startsWith('pageerror')) ? 1 : 0);
