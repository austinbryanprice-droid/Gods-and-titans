#!/usr/bin/env node
// Render the game's music offline in a real browser and write WAV files, for measuring levels
// and spectra (ffmpeg's ebur128 / astats / showspectrumpic) and for listening without a match.
//
//   node tools/music-render.mjs --out DIR [--themes greek,norse | all] [--seconds 60]
//                                [--level 0.1] [--curve flat|story] [--seed 1] [--volume 0.5]
//                                [--only perc,war]   solo some layers (pad drone bass arp lead perc war fx)
//                                [--dry]             no reverb (to time the voices alone)
//   node tools/music-render.mjs --film --out DIR [--volume 0.5] [--speech 1.4-3.8,9.6-11.5,...] [--seed N] [--dry]
//                                the intro film's score (src/intro/score.js) instead of a theme: film-score.wav, with the
//                                mix stepping back over the speech windows (film seconds; a guess from the captions by
//                                default) and film-speech.json, the windows that were used
//
// Starts a small static server for the repo, opens tools/music-lab.html in headless Chromium
// and calls its renderTheme(). Prints peak and RMS per file. Needs Playwright (global or local).
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = opt('out', join(process.env.TMPDIR || '/tmp', 'mythicwar-music'));
const seconds = Number(opt('seconds', '60'));
const level = Number(opt('level', '0'));
const curve = opt('curve', 'flat');
const seed = Number(opt('seed', '1'));
const volume = Number(opt('volume', '0.5'));
const wanted = opt('themes', 'all');
const only = opt('only', '') ? opt('only', '').split(',') : null;
const reverb = !args.includes('--dry');
const film = args.includes('--film');
const speech = opt('speech', '') ? opt('speech', '').split(',').map((w) => w.split('-').map(Number)) : null;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let failed = false;
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => {
    failed = true;
    console.error('pageerror:', e.message);
  });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.error(`[${m.type()}]`, m.text());
  });
  await page.goto(`${base}/tools/music-lab.html`);
  await page.waitForFunction(() => window.__lab);
  const ids = film ? [] : wanted === 'all' ? await page.evaluate(() => window.__lab.themes) : wanted.split(',');
  await mkdir(out, { recursive: true });
  const db = (v) => (20 * Math.log10(Math.max(v, 1e-9))).toFixed(1);
  if (film) {
    const t0 = Date.now();
    const r = await page.evaluate(async ({ volume, speech, seed, reverb }) => {
      const r = await window.__lab.renderFilm({ volume, speech, reverb, ...(seed === null ? {} : { seed }) });
      let s = '';
      const chunk = 0x8000;
      for (let i = 0; i < r.wav.length; i += chunk) s += String.fromCharCode(...r.wav.subarray(i, i + chunk));
      return { peak: r.peak, rms: r.rms, windows: r.windows, b64: btoa(s) };
    }, { volume, speech, seed: opt('seed', '') === '' ? null : seed, reverb });
    const file = join(out, 'film-score.wav');
    await writeFile(file, Buffer.from(r.b64, 'base64'));
    await writeFile(join(out, 'film-speech.json'), JSON.stringify(r.windows));
    console.log(`film score    peak ${db(r.peak)} dBFS  rms ${db(r.rms)} dBFS  (${((Date.now() - t0) / 1000).toFixed(1)} s)  ${file}`);
    console.log(`speech windows ${JSON.stringify(r.windows.map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)]))}`);
  }
  for (const id of ids) {
    const t0 = Date.now();
    const b64 = await page.evaluate(async ({ id, seconds, level, curve, seed, volume, only, reverb }) => {
      const r = await window.__lab.renderTheme(id, { seconds, level, curve, seed, volume, only, reverb });
      let s = '';
      const chunk = 0x8000;
      for (let i = 0; i < r.wav.length; i += chunk) s += String.fromCharCode(...r.wav.subarray(i, i + chunk));
      return { peak: r.peak, rms: r.rms, b64: btoa(s) };
    }, { id, seconds, level, curve, seed, volume, only, reverb });
    const file = join(out, `${id}-${curve === 'story' ? 'story' : `L${level}`}${only ? `-${only.join('+')}` : ''}.wav`);
    await writeFile(file, Buffer.from(b64.b64, 'base64'));
    console.log(`${id.padEnd(13)} peak ${db(b64.peak)} dBFS  rms ${db(b64.rms)} dBFS  (${((Date.now() - t0) / 1000).toFixed(1)} s)  ${file}`);
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
