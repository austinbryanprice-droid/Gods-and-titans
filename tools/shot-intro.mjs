#!/usr/bin/env node
// Stills of the intro film (DESIGN 11.1), for tuning the camera, the timing and the sky.
//
//   node tools/shot-intro.mjs [--at 2,6,9.5,12] [--size 960x540] [--quality medium] [--out DIR] [--port 8106]
//   node tools/shot-intro.mjs --at 20 --pose x,y,dist,pitch,yaw,lift,fov   # the camera put where you say (x, y: tiles) at that second
//   node tools/shot-intro.mjs --at 40 --hour 20.5                           # the sky at another hour than the script's
//   node tools/shot-intro.mjs --sheet      # also one contact sheet of every still (sheet.png)
//   node tools/shot-intro.mjs --flow       # the page flow: the film plays on its own clock, Esc skips it
//   node tools/shot-intro.mjs --narration  # the voice: each caption read as it comes up, Esc cuts it, a click unlocks it
//   node tools/shot-intro.mjs --music      # the score, on the page's real audio graph, in real time (about three minutes; --scenes 2 runs one of the four)
//   node tools/shot-intro.mjs --voice      # the recorded narration: real clips decoded and played through the sound engine, each with its caption, Esc stops it
//   node tools/shot-intro.mjs --sound      # a first visit as a browser gives it: the card that waits for a key, and the film with its sound where the browser allows it (about three minutes; --scenes 2 runs one of the four)
//
// The film runs in manual mode (src/ui/intro.js playIntro({ manual: true })): the tool moves it on in
// 0.05 s steps and draws only the seconds asked for, so software GL (a few seconds a frame) is
// enough. The overlay (bars, caption, fades) is in the stills. Starts a static server on the port
// unless one already answers there. Prints page errors; exits non-zero when a check fails.
// (--narration cannot hear anything: a stand-in speech synthesis records what the page asks of it.
// --music cannot either: it reads the real Web Audio graph instead, the mix stage's gain and the level of the
// music's output through an analyser, while a film without a renderer runs in real time with a stand-in voice.
// --sound reads the same graph on the real page, under the browser's autoplay policies: the default (a first visit),
// the policy switched off, and a site set to "Sound: Allow" in a profile.)

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const LAUNCH_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']; // the browser's own autoplay policy: sound only after a key press or a click, as for a first visit
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
    // a first visit: the browser keeps sound off until a key press or a click, so the film waits at its card for one
    await page.waitForSelector('.mw-intro.is-gated', { timeout: 30000 });
    await page.waitForTimeout(1500);
    ok('intro: held at the card, not playing', !(await page.$('.mw-intro.is-playing')));
    await page.keyboard.press('a');
    await page.waitForSelector('.mw-intro.is-playing', { timeout: 120000 });
    ok('intro: a key press begins the film', true);
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
  await page.goto(`${base}?intro=0&voice=browser`);
  await page.waitForSelector('.mw-title-screen');
  await page.mouse.click(5, 5); // the player's first input: from here the browser lets the page sound (on the page itself the card's key press does it), so only the voice's own refusals bring the hint up
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
    await page.goto(`${base}?intro=1&voice=browser`);
    await page.waitForSelector('.mw-intro.is-gated', { timeout: 30000 }); // a first visit: the film waits for a key press or a click
    await page.keyboard.press('a');
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

// ---------------------------------------------------------------- the score

/** A speech synthesis that takes real time (runs in the page): a line lasts 0.4 s and 70 ms a letter, then it ends; cancel() cuts it. */
function installTimedSpeech() {
  const calls = [];
  const queue = [];
  let current = null;
  window.__speech = { calls };
  window.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  const next = () => {
    if (current || !queue.length) return;
    const u = queue.shift();
    const rec = { text: u.text, at: performance.now(), ms: 400 + 70 * u.text.length };
    calls.push(rec);
    current = { u, rec, timers: [] };
    current.timers.push(setTimeout(() => u.onstart && u.onstart({}), 40));
    current.timers.push(setTimeout(() => {
      rec.end = performance.now();
      current = null;
      if (u.onend) u.onend({});
      next();
    }, rec.ms));
  };
  const synth = {
    speaking: false,
    pending: false,
    speak(u) {
      queue.push(u);
      next();
    },
    cancel() {
      const cut = [...(current ? [current.u] : []), ...queue];
      if (current) {
        current.timers.forEach(clearTimeout);
        current.rec.cut = performance.now();
      }
      current = null;
      queue.length = 0;
      for (const u of cut) if (u.onerror) u.onerror({ error: 'interrupted' });
    },
    getVoices: () => [],
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
}

/**
 * Runs in the page: the page's own overlay, narrator, score and music engine over a film with no renderer, in real
 * time, set up the way main.js's watchIntro does it (the music cleared, the title theme back at the hand-over). A
 * sampler writes down every 50 ms the film's second, the mix stage's and the stingers' gain (the live Web Audio
 * parameters), the music's output level (an analyser on the node the music leaves through) and which run is playing.
 */
async function runLightFilm({ narrate }) {
  const { playIntro } = await import('/src/ui/intro.js');
  const { FILM_LENGTH, fadeAt, barsAt, captionAt } = await import('/src/intro/script.js');
  const { quietMusic, playTitleMusic } = await import('/src/audio/audio.js');
  const { music } = await import('/src/audio/music.js');
  class LightFilm {
    constructor() {
      this.t = 0;
      this.view = { t: 0, fade: 1, bars: 0, caption: null };
    }
    get done() {
      return this.t >= FILM_LENGTH;
    }
    advance(dt) {
      this.t = Math.min(FILM_LENGTH, this.t + dt);
      this.view = { t: this.t, fade: fadeAt(this.t), bars: barsAt(this.t), caption: captionAt(this.t) };
    }
    draw() {}
    resize() {}
    dispose() {}
  }
  const trace = [];
  window.__trace = trace;
  window.__handover = null;
  window.__outcome = null;
  let tap = null;
  let runs = 0;
  const samples = new Float32Array(2048);
  const sampler = setInterval(() => {
    const env = music.env;
    if (env && !tap) {
      tap = music.ctx.createAnalyser();
      tap.fftSize = 2048;
      env.nodes.hide.connect(tap);
    }
    let rms = null;
    if (tap) {
      tap.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const x of samples) sum += x * x;
      rms = Math.sqrt(sum / samples.length);
    }
    if (music.run && !music.run.__id) music.run.__id = ++runs;
    const film = window.__intro && window.__intro.film;
    const st = music.state();
    trace.push({ at: performance.now(), t: film ? film.t : null, stage: env ? env.nodes.stage.gain.value : null, duck: env ? env.nodes.duck.gain.value : null, rms, run: music.run ? music.run.__id : null, level: st.level, wanted: st.wanted, playing: st.playing, ctxState: music.ctx ? music.ctx.state : null });
  }, 50);
  window.__stopSampler = () => clearInterval(sampler);
  quietMusic();
  const intro = playIntro({
    guard: false,
    narrate,
    quality: 'low',
    volume: 0.6,
    load: async () => ({ IntroFilm: LightFilm, Renderer: class {} }),
    onHandover: () => {
      window.__handover = performance.now();
      playTitleMusic();
    },
  });
  window.__intro = intro;
  intro.done.then((o) => (window.__outcome = o));
  await intro.ready;
}

async function score(browser, errors, only = [1, 2, 3]) {
  const { results, ok } = reporter();
  mkdirSync(out, { recursive: true });
  const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const between = (trace, a, b) => trace.filter((r) => r.at >= a && r.at <= b);
  const fixed = (x, n = 2) => (Number.isFinite(x) ? x.toFixed(n) : 'n/a');
  /** A page on the title screen; `click` is the player's first click (the browser allows audio after it). */
  const open = async (click) => {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
    await ctx.addInitScript(installTimedSpeech);
    const page = await ctx.newPage();
    watchErrors(page, errors);
    await page.goto(`${base}?intro=0&voice=browser`);
    await page.waitForSelector('.mw-title-screen');
    await page.addStyleTag({ content: '.mw-intro-loading { display: none !important; }' });
    if (click) {
      await page.mouse.click(5, 5);
      await page.waitForFunction(async () => (await import('/src/audio/music.js')).music.state().playing, null, { timeout: 20000 });
      await page.waitForTimeout(2000); // the title music's own run, to be cleared by the film as it is in the page
    }
    return { ctx, page };
  };
  const filmT = (page) => page.evaluate(() => (window.__intro && window.__intro.film ? window.__intro.film.t : -1));
  const outcome = (page) => page.waitForFunction(() => window.__outcome !== null, null, { timeout: 120000, polling: 250 });
  console.log('score:');

  // 1. the whole film, narrated, to its end
  if (only.includes(1)) {
    const { ctx, page } = await open(true);
    await page.evaluate(runLightFilm, { narrate: true });
    await outcome(page);
    await page.waitForTimeout(9000); // the title screen has the piece now
    const victoryAt = await page.evaluate(async () => {
      const { sfx } = await import('/src/audio/sfx.js');
      const at = performance.now();
      sfx.play('victory', { volume: 0.7 });
      return at;
    });
    await page.waitForTimeout(1200);
    const d = await page.evaluate(() => ({ trace: window.__trace, calls: window.__speech.calls, handover: window.__handover, outcome: window.__outcome }));
    const trace = d.trace.filter((r) => r.stage !== null);
    const lines = d.calls.map((c) => ({ text: c.text, from: c.at + 40, to: c.at + c.ms }));
    ok('the film ran to its end and handed over once', d.outcome === 'finished' && d.handover !== null);
    ok('one line is said for each caption', lines.length === 5, lines.map((l) => `"${l.text}"`).join(', '));
    const first = trace.find((r) => r.t !== null && r.t > 0.5);
    ok('the score is up with the film: the title theme, in the film\'s mix, on a running context', first && first.wanted === 'menu' && first.ctxState === 'running' && first.stage > 1.3, first ? `stage ${fixed(first.stage)}` : 'no sample');
    const stages = trace.map((r) => r.stage);
    ok('the page\'s Web Audio parameter moves with the mix (Chrome reports the automation in .value)', Math.min(...stages) < 0.5 && Math.max(...stages) > 1.3, `from ${fixed(Math.min(...stages))} to ${fixed(Math.max(...stages))}`);
    console.log('    line                          under the voice (stage, music dBFS)   between the lines (stage, music dBFS)   gap');
    let allUnder = true;
    let allGap = true;
    let quieter = Infinity;
    lines.forEach((l, i) => {
      const nextStart = i + 1 < lines.length ? lines[i + 1].from : d.handover;
      const under = between(trace, l.from + 500, l.to);
      const gap = between(trace, l.to + 2300, nextStart - 100);
      const su = mean(under.map((r) => r.stage));
      const sg = mean(gap.map((r) => r.stage));
      const ru = db(mean(under.map((r) => r.rms)));
      const rg = db(mean(gap.map((r) => r.rms)));
      allUnder = allUnder && su < 0.45;
      allGap = allGap && sg > 1.3;
      quieter = Math.min(quieter, rg - ru);
      console.log(`    ${l.text.padEnd(28)}  ${fixed(su)}  ${fixed(ru, 1).padStart(6)}                      ${fixed(sg)}  ${fixed(rg, 1).padStart(6)}                          ${fixed(rg - ru, 1)} dB`);
    });
    ok('the stage is down under every line', allUnder);
    ok('and back up between them', allGap);
    ok('the music that comes out is quieter under every line than between (by at least 4 dB, the story\'s own swings included)', quieter >= 4, `least: ${fixed(quieter, 1)} dB`);
    ok('the film\'s own sounds do not make the music step back (the stingers are off during the film)', !trace.filter((r) => r.t !== null).some((r) => r.duck < 0.99));
    const dipped = Math.min(...between(trace, victoryAt, victoryAt + 1200).map((r) => r.duck));
    ok('and the game\'s do again after it', dipped < 0.6, `a victory fanfare dips the music to ${fixed(dipped)}`);
    const lastLive = [...trace].reverse().find((r) => r.t !== null && r.t > 46);
    const after = trace.filter((r) => r.at > d.handover + 500);
    ok('the title screen carries on with the very same piece, at the title\'s intensity', lastLive && after.length > 0 && after.every((r) => r.run === lastLive.run && r.wanted === 'menu' && r.playing), lastLive ? `run ${lastLive.run}, level ${fixed(lastLive.level)}` : 'no sample');
    const settled = trace.filter((r) => r.at > victoryAt - 1000 && r.at < victoryAt);
    ok('the lift has glided away a few seconds after', Math.abs(mean(settled.map((r) => r.stage)) - 1) < 0.03, `stage ${fixed(mean(settled.map((r) => r.stage)), 3)}`);
    const edge = trace.filter((r) => r.at > d.handover - 500 && r.at < d.handover + 1500).map((r) => r.rms);
    ok('with no hole or blast in the music at the hand-over', Math.min(...edge) > 0.003 && Math.max(...edge) < 3 * mean(edge), `${fixed(db(Math.min(...edge)), 1)}..${fixed(db(Math.max(...edge)), 1)} dBFS`);
    // the picture of the mix, one row a second and a half, for the notes
    const rows = [];
    for (let s = 0; s <= 47; s += 1.5) {
      const r = trace.find((x) => x.t !== null && x.t >= s);
      if (r) rows.push(`${s.toFixed(1).padStart(4)}s stage ${fixed(r.stage)} music ${fixed(db(r.rms), 1).padStart(6)} dBFS level ${fixed(r.level)}`);
    }
    console.log(`    ${rows.join('\n    ')}`);
    writeFileSync(join(out, 'score-trace.json'), JSON.stringify({ lines, handover: d.handover, trace }));
    await ctx.close();
  }

  // 2. Esc in the middle of the second line: the music is gone inside the dip, the title's own comes in clean
  if (only.includes(2)) {
    const { ctx, page } = await open(true);
    await page.evaluate(runLightFilm, { narrate: true });
    await page.waitForFunction(() => window.__intro.film && window.__intro.film.t >= 10.4, null, { timeout: 60000, polling: 50 });
    const pressedAt = await page.evaluate(() => performance.now());
    await page.keyboard.press('Escape');
    await outcome(page);
    await page.waitForTimeout(3500);
    const d = await page.evaluate(() => ({ trace: window.__trace, calls: window.__speech.calls, handover: window.__handover, outcome: window.__outcome }));
    const trace = d.trace.filter((r) => r.stage !== null);
    const before = between(trace, pressedAt - 400, pressedAt);
    const levelBefore = mean(before.map((r) => r.rms));
    ok('a line was being said, and the stage was under it', before.length > 5 && mean(before.map((r) => r.stage)) < 0.45, `stage ${fixed(mean(before.map((r) => r.stage)))}, ${fixed(db(levelBefore), 1)} dBFS`);
    ok('the voice was cut', d.calls.length >= 2 && !!d.calls[1].cut);
    const quiet = between(trace, d.handover - 100, d.handover);
    ok('the music is 12 dB down or more by the time the dip to black ends and the title begins (the hall\'s reverb rings on a little)', quiet.length > 0 && Math.max(...quiet.map((r) => r.rms)) < 0.25 * levelBefore, `${fixed(db(Math.max(...quiet.map((r) => r.rms))), 1)} dBFS against ${fixed(db(levelBefore), 1)} before, the hand-over ${Math.round(d.handover - pressedAt)} ms after Esc`);
    const filmRun = before.at(-1).run;
    const atHandover = trace.find((r) => r.at >= d.handover + 100);
    ok('the title screen starts a piece of its own', atHandover && atHandover.wanted === 'menu' && atHandover.run !== filmRun && atHandover.run !== null, `run ${filmRun} then ${atHandover && atHandover.run}`);
    const late = between(trace, pressedAt + 2800, pressedAt + 3500);
    ok('the stage is back to 1 and the title\'s music is up', late.length > 0 && Math.abs(mean(late.map((r) => r.stage)) - 1) < 0.02 && mean(late.map((r) => r.rms)) > 0.003, `stage ${fixed(mean(late.map((r) => r.stage)), 3)}, ${fixed(db(mean(late.map((r) => r.rms))), 1)} dBFS`);
    const around = between(trace, pressedAt, pressedAt + 1500);
    ok('nothing swells on the way: the title\'s piece fades in under its settled level', Math.max(...around.map((r) => r.rms)) <= mean(late.map((r) => r.rms)) * 1.25, `${fixed(db(Math.max(...around.map((r) => r.rms))), 1)} against ${fixed(db(mean(late.map((r) => r.rms))), 1)} dBFS`);
    await ctx.close();
  }

  // 3. a first visit: nothing sounds and the film says so; the first click lets the score in at the story's moment
  if (only.includes(3)) {
    const { ctx, page } = await open(false);
    await page.evaluate(runLightFilm, { narrate: true });
    await page.waitForFunction(() => window.__intro.film && window.__intro.film.t >= 2.2, null, { timeout: 60000, polling: 50 });
    const hinted = () => page.evaluate(() => document.querySelector('.mw-intro').classList.contains('needs-click'));
    ok('before any click the hint is up', await hinted());
    const cold = await page.evaluate(() => window.__trace.slice(-3));
    ok('and the audio context the page made at load is still suspended: the browser has not allowed it', cold.length > 0 && cold.every((r) => r.ctxState === 'suspended'), cold.map((r) => r.ctxState).join(', '));
    const clickedAt = await page.evaluate(() => performance.now());
    await page.mouse.click(320, 180);
    await page.waitForFunction(() => document.querySelector('.mw-intro') && !document.querySelector('.mw-intro').classList.contains('needs-click'), null, { timeout: 10000 });
    ok('a click on the film takes the hint down', !(await hinted()));
    await page.waitForTimeout(2500);
    const t = await filmT(page);
    const d = await page.evaluate(() => window.__trace);
    const heard = between(d, clickedAt + 1500, clickedAt + 2500);
    ok('and the score is playing under it from that moment, at the story\'s intensity', heard.length > 0 && heard.every((r) => r.playing && r.ctxState === 'running') && mean(heard.map((r) => r.rms)) > 0.001, `film at ${fixed(t, 1)} s, level ${fixed(heard.at(-1).level)}, ${fixed(db(mean(heard.map((r) => r.rms))), 1)} dBFS`);
    await page.evaluate(() => window.__intro.skip());
    await outcome(page);
    await ctx.close();
  }

  // 4. a first visit whose click comes late: the score comes in on the section the story is in (the titans), not the first
  if (only.includes(4)) {
    const { ctx, page } = await open(false);
    await page.evaluate(runLightFilm, { narrate: true });
    await page.waitForFunction(() => window.__intro.film && window.__intro.film.t >= 31.8, null, { timeout: 90000, polling: 50 });
    const clickedAt = await page.evaluate(() => performance.now());
    await page.mouse.click(320, 180);
    await page.waitForFunction(async () => (await import('/src/audio/music.js')).music.state().playing, null, { timeout: 10000 });
    await page.waitForTimeout(700);
    const joined = await page.evaluate(async () => {
      const { music } = await import('/src/audio/music.js');
      const s = music.run.score;
      return { section: s.section.index, mode: s.section.mode, tune: !!s.section.tune, shift: s.section.shift, bars: music.run.bars, film: window.__intro.film.t, level: music.state().level };
    });
    ok('a click at 32 s brings the score in on the titans\' section (the third), a tense one, not on the first bar of the piece', joined.section === 2 && joined.mode === 'tense' && joined.bars >= 9, `film at ${fixed(joined.film, 1)} s, section ${joined.section} ${joined.mode}${joined.tune ? ' with the tune' : ''}${joined.shift ? ' an octave up' : ''}, ${joined.bars} bars composed, level ${fixed(joined.level)}`);
    await page.waitForTimeout(1800);
    const heard = between(await page.evaluate(() => window.__trace), clickedAt + 1500, clickedAt + 2500);
    ok('and it is the battle that is heard, at the story\'s intensity', heard.length > 0 && heard.every((r) => r.playing && r.ctxState === 'running') && heard.at(-1).level > 0.9 && mean(heard.map((r) => r.rms)) > 0.001, heard.length ? `level ${fixed(heard.at(-1).level)}, ${fixed(db(mean(heard.map((r) => r.rms))), 1)} dBFS` : 'no sample');
    await page.evaluate(() => window.__intro.skip());
    await outcome(page);
    await ctx.close();
  }
  return results;
}

// ---------------------------------------------------------------- the sound of a first visit

/**
 * Runs in the page before its own scripts: writes down, with the time, what the page asks of the browser's audio and
 * voice (the audio context made and each state it takes, each line the voice is asked to speak and how the browser
 * answers, each effect the sound engine schedules), and whether the card that waits for a key ever showed.
 */
function installSoundLog() {
  const log = [];
  window.__log = log;
  const note = (what, extra = {}) => log.push({ at: Math.round(performance.now()), what, ...extra });
  const Native = window.AudioContext;
  window.AudioContext = class extends Native {
    constructor(...a) {
      super(...a);
      note('context', { state: this.state });
      this.addEventListener('statechange', () => note('state', { state: this.state }));
    }
  };
  const speak = speechSynthesis.speak.bind(speechSynthesis);
  speechSynthesis.speak = (u) => {
    note('speak', { text: u.text });
    u.addEventListener('error', (e) => note('speak error', { error: e.error }));
    u.addEventListener('start', () => note('speak start'));
    return speak(u);
  };
  import('/src/audio/sfx.js').then(({ sfx }) => sfx.onPlay((name) => note('sfx', { name }))).catch(() => {});
  new MutationObserver(() => {
    const root = document.querySelector('.mw-intro');
    if (root && root.classList.contains('is-gated')) window.__gated = true;
  }).observe(document, { subtree: true, attributes: true, childList: true });
  try {
    if (!localStorage.getItem('mythicwar-settings')) localStorage.setItem('mythicwar-settings', JSON.stringify({ quality: 'low' })); // low, for the sake of software GL
  } catch {
    // a frame with no storage keeps the defaults
  }
}

/** Runs in the page: what the overlay and the audio are doing now (a function of its own, for the tool to send either way). */
async function readSound() {
  const { sfx } = await import('/src/audio/sfx.js');
  const { music } = await import('/src/audio/music.js');
  const root = document.querySelector('.mw-intro');
  const begin = root && root.querySelector('.mw-intro-begin');
  const st = music.state();
  return {
    shown: !!root,
    gated: !!root && root.classList.contains('is-gated'),
    playing: !!root && root.classList.contains('is-playing'),
    hint: !!root && root.classList.contains('needs-click'),
    title: !!document.querySelector('.mw-title-screen'),
    prompt: begin ? Number(getComputedStyle(begin).opacity) : null,
    ctx: sfx.ctx ? sfx.ctx.state : null,
    music: st.playing ? 'playing' : st.waiting ? 'waiting' : 'off',
    everGated: !!window.__gated,
    log: window.__log.slice(),
  };
}

/**
 * A first visit as each kind of browser gives it: the sound the page can have from nothing but the page load, a key
 * press or a click. Real Chromium, the real page and its real audio graph (nothing is heard here: the tool reads the
 * context's state, the effects the engine schedules and what the voice is asked and answered).
 *   1. the browser's own policy: the card holds the film, mouse movement, scrolling and Shift do not start it, a key does
 *   2. the same policy: a click starts it too, and Esc at the card skips the film for the title screen
 *   3. the policy off (--autoplay-policy=no-user-gesture-required): no card, the film plays with its sound at once
 *   4. a site set to "Sound: Allow" (a profile's content settings): the same
 * Until the input under test, the page is read through the protocol without a user gesture (`look`): Playwright's own
 * evaluate, wait and screenshot calls count as a gesture to Chromium, which would unlock the very audio being watched.
 */
async function sound(browser, errors, only = [1, 2, 3, 4]) {
  const { results, ok } = reporter();
  mkdirSync(out, { recursive: true });
  const viewport = { width: 960, height: 540 };
  const sfxOf = (log) => log.filter((r) => r.what === 'sfx').map((r) => r.name);
  const spoken = (log) => log.filter((r) => r.what === 'speak');
  const refused = (log) => log.filter((r) => r.what === 'speak error' && r.error === 'not-allowed');
  const named = (log) => log.map((r) => (r.what === 'context' ? `made ${r.state}` : r.what === 'state' ? `went ${r.state}` : r.what === 'sfx' ? `sfx ${r.name}` : r.what === 'speak error' ? `speak error ${r.error}` : r.what)).join(', ');
  const done = (page) => page.waitForFunction(() => window.__log.some((r) => r.what === 'sfx') && window.__log.some((r) => r.what === 'speak'), null, { timeout: 120000 });
  /** A page with the film asked for (?intro=1) in a context of the kind under test, and `look` to read it with no gesture. */
  const visit = async (ctx) => {
    await ctx.addInitScript(installSoundLog);
    const page = await ctx.newPage();
    watchErrors(page, errors);
    const cdp = await ctx.newCDPSession(page);
    const read = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: false });
      if (r.exceptionDetails) throw new Error(`reading the page: ${r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text}`);
      return r.result.value;
    };
    const look = {
      read,
      snapshot: () => read(`(${readSound})()`),
      /** Wait (polling, with no gesture) until the snapshot satisfies `test`. */
      async until(test, timeout = 180000) {
        const t0 = Date.now();
        for (;;) {
          const s = await look.snapshot();
          if (test(s)) return s;
          if (Date.now() - t0 > timeout) throw new Error(`timed out waiting: ${JSON.stringify({ ...s, log: named(s.log) })}`);
          await wait(150);
        }
      },
      async shot(name) {
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(join(out, name), Buffer.from(data, 'base64'));
      },
    };
    await page.goto(`${base}?intro=1&voice=browser`);
    await look.until((s) => s.shown, 30000);
    return { page, look };
  };
  /** What a browser that lets the page sound with no input at all must show: the film plays by itself, with everything on. */
  const allowed = async (label, page) => {
    await page.waitForSelector('.mw-intro.is-playing', { timeout: 120000 });
    await done(page);
    await page.waitForTimeout(800);
    const s = await page.evaluate(readSound);
    const made = s.log.find((r) => r.what === 'context');
    ok(`${label}: the film plays on its own, with no key press and no click`, s.playing && !s.gated);
    ok(`${label}: the card never showed`, !s.everGated);
    ok(`${label}: the audio context was running the moment the page made it`, !!made && made.state === 'running' && s.ctx === 'running', made ? `made ${made.state}, now ${s.ctx}` : 'no context');
    ok(`${label}: the opening horn sounds`, sfxOf(s.log)[0] === 'horn', named(s.log));
    ok(`${label}: the voice reads the first line and the browser does not refuse it`, spoken(s.log).length >= 1 && refused(s.log).length === 0, named(s.log));
    ok(`${label}: the score is playing, and no hint asks for a click`, s.music === 'playing' && !s.hint, `music ${s.music}`);
  };
  const gone = (page) => page.waitForSelector('.mw-intro', { state: 'detached', timeout: 180000 }); // (software GL: the renderer is freed after the backlog of frames)
  console.log('sound:');

  // 1. the browser's own policy, a first visit: the card, and a key press
  if (only.includes(1)) {
    const ctx = await browser.newContext({ viewport });
    const { page, look } = await visit(ctx);
    await look.until((s) => s.gated, 30000);
    await wait(2500); // the film loads behind the card meanwhile
    const held = await look.snapshot();
    ok('the film is held at its card: not playing, and the prompt shows', held.gated && !held.playing && held.prompt > 0.9, `prompt opacity ${held.prompt}`);
    await look.shot('sound-card.png');
    const made = held.log.find((r) => r.what === 'context');
    ok('the audio context was made at load, and the browser keeps it suspended', !!made && made.state === 'suspended' && held.ctx === 'suspended', made ? `made ${made.state}, now ${held.ctx}` : 'no context');
    ok('nothing has sounded: no effect, no voice, no score', sfxOf(held.log).length === 0 && spoken(held.log).length === 0 && held.music === 'off', named(held.log));
    // none of these is an input the browser counts, and none starts the film
    await page.mouse.move(120, 90);
    await page.mouse.move(400, 300);
    await page.mouse.wheel(0, 240);
    await page.keyboard.press('Shift');
    await wait(800);
    const idle = await look.snapshot();
    ok('mouse movement, scrolling and Shift alone leave it as it was: held at the card, the audio still off', idle.gated && !idle.playing && idle.ctx === 'suspended', `context ${idle.ctx}`);
    await page.keyboard.press('a');
    await page.waitForSelector('.mw-intro.is-playing', { timeout: 120000 });
    const begun = await page.evaluate(readSound);
    ok('a key press begins the film, and the browser lets the audio run', begun.playing && !begun.gated && begun.ctx === 'running', `context ${begun.ctx}`);
    await done(page);
    await page.waitForTimeout(800);
    const heard = await page.evaluate(readSound);
    ok('the opening horn sounds', sfxOf(heard.log)[0] === 'horn', named(heard.log));
    ok('the voice reads the first line and the browser does not refuse it', spoken(heard.log).length >= 1 && refused(heard.log).length === 0, named(heard.log));
    ok('the score is playing, and no hint asks for a click', heard.music === 'playing' && !heard.hint, `music ${heard.music}`);
    await page.keyboard.press('Escape');
    await gone(page);
    ok('Esc still leaves the film for the title screen', !!(await page.$('.mw-title-screen')));
    await ctx.close();
  }

  // 2. the same policy: a click starts the film too, and Esc at the card skips it
  if (only.includes(2)) {
    {
      const ctx = await browser.newContext({ viewport });
      const { page, look } = await visit(ctx);
      await look.until((s) => s.gated, 30000);
      await wait(1500);
      await page.mouse.click(480, 270);
      await page.waitForSelector('.mw-intro.is-playing', { timeout: 120000 });
      await page.waitForFunction(() => window.__log.some((r) => r.what === 'sfx'), null, { timeout: 120000 });
      const s = await page.evaluate(readSound);
      ok('a click on the card begins the film too, with the audio running and the horn sounding', s.playing && !s.gated && s.ctx === 'running' && sfxOf(s.log)[0] === 'horn', `now ${s.ctx}: ${named(s.log)}`);
      await ctx.close();
    }
    {
      const ctx = await browser.newContext({ viewport });
      const { page, look } = await visit(ctx);
      await look.until((s) => s.gated, 30000);
      await wait(1500);
      await page.keyboard.press('Escape');
      const s = await look.until((x) => !x.shown, 60000);
      ok('Esc at the card skips the film: the title screen comes up', s.title);
      ok('nothing sounded, and the browser still keeps the audio off (Esc is no input to it)', sfxOf(s.log).length === 0 && spoken(s.log).length === 0 && s.ctx === 'suspended', `${named(s.log) || 'nothing logged'}; now ${s.ctx}`);
      await page.mouse.click(5, 5);
      await page.waitForFunction(async () => (await import('/src/audio/music.js')).music.state().playing, null, { timeout: 20000 });
      ok('and the first click on the title screen starts its music, as it always did', true);
      await ctx.close();
    }
  }

  // 3. the browser's autoplay policy switched off
  if (only.includes(3)) {
    const flagged = await chromium.launch({ args: [...LAUNCH_ARGS, '--autoplay-policy=no-user-gesture-required'] });
    try {
      const ctx = await flagged.newContext({ viewport });
      const { page } = await visit(ctx);
      await allowed('autoplay allowed', page);
      await page.keyboard.press('Escape');
      await gone(page);
      ok('autoplay allowed: Esc leaves the film for the title screen', !!(await page.$('.mw-title-screen')));
      await ctx.close();
    } finally {
      await flagged.close();
    }
  }

  // 4. a site set to "Sound: Allow", the one-time setting in the browser (a profile's content settings)
  if (only.includes(4)) {
    const dir = mkdtempSync(join(tmpdir(), 'mythicwar-sound-'));
    mkdirSync(join(dir, 'Default'), { recursive: true });
    writeFileSync(join(dir, 'Default', 'Preferences'), JSON.stringify({ profile: { content_settings: { exceptions: { sound: { [`${new URL(base).origin},*`]: { setting: 1 } } } } } }));
    const ctx = await chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true, args: LAUNCH_ARGS, viewport });
    try {
      const { page } = await visit(ctx);
      await allowed('sound allowed for the site', page);
    } finally {
      await ctx.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return results;
}

// ---------------------------------------------------------------- the recorded voice

/**
 * Runs in the page: tags each downloaded clip with its file name through fetch and decodeAudioData, and records every
 * buffer source started or stopped (with the clip, the caption on the screen and the film's second), and every speak
 * asked of the browser's own voice (there should be none).
 */
function installVoiceProbe() {
  const log = [];
  window.__voice = { log };
  const names = new WeakMap();
  const fetch0 = window.fetch.bind(window);
  window.fetch = async (url, ...rest) => {
    const r = await fetch0(url, ...rest);
    const m = String(url).match(/narration\/([^/?]+)$/);
    if (!m) return r;
    const ab = r.arrayBuffer.bind(r);
    r.arrayBuffer = async () => {
      const data = await ab();
      names.set(data, m[1]);
      return data;
    };
    return r;
  };
  const decode0 = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = function (data, ...rest) {
    const name = names.get(data);
    return decode0.call(this, data, ...rest).then((buf) => {
      if (name) buf.__clip = name;
      return buf;
    });
  };
  const here = () => {
    const cap = document.querySelector('.mw-intro-caption');
    return { caption: cap ? cap.textContent : null, t: window.__intro && window.__intro.film ? window.__intro.film.t : null, at: performance.now() };
  };
  const start0 = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when, ...rest) {
    if (this.buffer && this.buffer.__clip) log.push({ what: 'clip', clip: this.buffer.__clip, seconds: this.buffer.duration, delay: (when || 0) - this.context.currentTime, state: this.context.state, ...here() });
    return start0.call(this, when, ...rest);
  };
  const stop0 = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.stop = function (...rest) {
    if (this.buffer && this.buffer.__clip) log.push({ what: 'stop', clip: this.buffer.__clip, ...here() });
    return stop0.apply(this, rest);
  };
  if (window.speechSynthesis) {
    const speak0 = speechSynthesis.speak.bind(speechSynthesis);
    speechSynthesis.speak = (u) => {
      log.push({ what: 'speak', text: u.text, ...here() });
      return speak0(u);
    };
  }
}

async function voice(browser, errors) {
  const { results, ok } = reporter();
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  await ctx.addInitScript(installVoiceProbe);
  const page = await ctx.newPage();
  watchErrors(page, errors);
  const clips = await (async () => {
    await page.goto(`${base}?intro=0`);
    await page.waitForSelector('.mw-title-screen');
    return page.evaluate(async () => (await import('/src/intro/voiceover.js')).VOICE_CLIPS);
  })();
  const captions = await page.evaluate(async () => (await import('/src/intro/script.js')).CAPTIONS);
  const log = () => page.evaluate(() => window.__voice.log);
  const gone = () => page.waitForSelector('.mw-intro', { state: 'detached', timeout: 180000 });
  console.log('recorded voice:');

  // 1. the whole script on the film's own manual clock: each caption's clip, decoded from the real file, in order
  await page.mouse.click(5, 5); // the player's first input: the browser lets the page sound
  await page.addStyleTag({ content: '.mw-intro-loading { display: none !important; }' });
  await page.evaluate(async () => {
    const { playIntro } = await import('/src/ui/intro.js');
    const intro = playIntro({ manual: true, guard: false, quality: 'low', volume: 0.6 });
    window.__intro = intro;
    await intro.ready;
  });
  await page.waitForTimeout(1500); // the clips download and decode while the film loads
  const began = Date.now(); // in real time, so a line is over before the next comes, as on the page
  for (let to = 0.5; to <= 47; to += 0.5) {
    await page.evaluate((target) => {
      const intro = window.__intro;
      while (intro.film && intro.film.t < target - 1e-6) intro.advance(Math.min(0.05, target - intro.film.t));
    }, to);
    await page.waitForTimeout(Math.max(0, began + to * 1000 - Date.now()));
  }
  const all = await log();
  const played = all.filter((r) => r.what === 'clip');
  ok('one clip for each caption, in order', JSON.stringify(played.map((r) => r.clip)) === JSON.stringify(captions.map((c) => clips[c.text])), played.map((r) => r.clip).join(', '));
  ok('each starts with its caption on the screen', played.length === captions.length && played.every((r, i) => r.caption === captions[i].text && r.t >= captions[i].from && r.t < captions[i].from + 0.6), played.map((r) => `${r.t.toFixed(2)} "${r.caption}"`).join('; '));
  ok('each is a real recording, 1 to 4 seconds long', played.length > 0 && played.every((r) => r.seconds > 1 && r.seconds < 4), played.map((r) => r.seconds.toFixed(2)).join(' '));
  ok('on a running context, a moment after the hand-over', played.every((r) => r.state === 'running' && r.delay > 0.05 && r.delay < 0.5), played.map((r) => `${r.state} +${r.delay.toFixed(2)}`).join(' '));
  ok('the browser\'s own voice is never asked', !all.some((r) => r.what === 'speak'));
  await page.evaluate(() => window.__intro.skip());
  await gone();

  // 2. the page as a player gets it: a first visit, the card, a key, the first line; Esc stops it
  await page.goto(`${base}?intro=1`);
  await page.waitForSelector('.mw-intro.is-gated', { timeout: 30000 });
  await page.keyboard.press('a');
  await page.waitForSelector('.mw-intro.is-playing', { timeout: 120000 });
  await page.waitForFunction(() => window.__voice.log.some((r) => r.what === 'clip'), null, { timeout: 120000 });
  const first = (await log()).find((r) => r.what === 'clip');
  ok('after the key, the first line is the first clip, with its caption up', first.clip === clips[captions[0].text] && first.caption === captions[0].text, `${first.clip} "${first.caption}"`);
  await page.keyboard.press('Escape');
  const cut = await log();
  ok('Esc stops the clip at once', cut.some((r) => r.what === 'stop' && r.clip === first.clip), cut.map((r) => `${r.what} ${r.clip || r.text}`).join(', '));
  ok('and the browser\'s voice was never asked', !cut.some((r) => r.what === 'speak'));
  await gone();
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
  } else if (flag('music')) {
    failed = (await score(browser, errors, opt('scenes', '1,2,3,4').split(',').map(Number))).filter((r) => !r.pass).length;
  } else if (flag('voice')) {
    failed = (await voice(browser, errors)).filter((r) => !r.pass).length;
  } else if (flag('sound')) {
    failed = (await sound(browser, errors, opt('scenes', '1,2,3,4').split(',').map(Number))).filter((r) => !r.pass).length;
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
