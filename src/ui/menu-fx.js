// Animated menu backdrop: a night sky with a glowing moon and a faint galactic
// band, twinkling and shooting stars, layered mountain ridges crowned by a lit
// temple, and embers rising from the fires below.
//
// Four stacked canvases keep it cheap: the sky and the mountains are painted
// once per resize (the mountains drift with the mouse via a CSS transform, a
// compositor-only change); only the star and ember layers redraw each frame.
//
// Two further savings: behind the busy screens (lobby, settings...) the
// backdrop runs in a 'calm' mode with fewer embers and a lower frame rate, and
// if the browser cannot keep up (software rendering, a huge screen on a weak
// GPU) it steps down on its own, first to 20 fps, then to a still picture, so
// the menu itself stays responsive.

const MAX_BACKING_WIDTH = 2200; // cap backing resolution; CSS scales it up on 4K
/** Per-mode frame cap and share of embers. */
const MODES = {
  full: { minMs: 1000 / 45, embers: 1 },
  calm: { minMs: 1000 / 30, embers: 0.5 },
};
const SLOW_FPS = 14; // below this (averaged over SLOW_WINDOW_MS) the backdrop steps down
const SLOW_WINDOW_MS = 2000;

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/** Soft round glow sprite used for embers and bright stars. */
function glowSprite(size, inner, outer) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.25, outer);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Smooth value noise on [0, 1) sampled at u (knots = random array). */
function vnoise(knots, u) {
  const n = knots.length - 1;
  const x = Math.max(0, Math.min(n - 1e-6, u * n));
  const i = Math.floor(x);
  const f = x - i;
  const sm = f * f * (3 - 2 * f);
  return knots[i] * (1 - sm) + knots[i + 1] * sm;
}

/** A mountain ridge: [[x, y], …] from octaves of value noise plus a few broad peaks. */
function ridge(w, base, amp, rand, { peaks = 3, jag = 0.18 } = {}) {
  const oct = [8, 19, 47].map((n) => Array.from({ length: n + 1 }, () => rand()));
  const centers = Array.from({ length: peaks }, () => ({ c: rand(), wdt: 0.06 + rand() * 0.1, hgt: 0.6 + rand() * 0.8 }));
  const pts = [];
  const step = Math.max(2, w / 500);
  for (let x = 0; x <= w + step; x += step) {
    const u = Math.min(1, x / w);
    let y = 0.62 * vnoise(oct[0], u) + 0.28 * vnoise(oct[1], u) + jag * vnoise(oct[2], u);
    for (const p of centers) {
      const d = (u - p.c) / p.wdt;
      y += p.hgt * Math.max(0, 1 - Math.abs(d)) ** 1.6 * 0.7;
    }
    pts.push([x, base - amp * y]);
  }
  return pts;
}

function fillRidge(g, pts, h, fill) {
  g.beginPath();
  g.moveTo(0, h);
  for (const [x, y] of pts) g.lineTo(x, y);
  g.lineTo(pts[pts.length - 1][0], h);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}

function drawTemple(g, cx, baseY, s, color) {
  // A columned temple silhouette standing on a peak, lit from within.
  const w = 120 * s;
  const colH = 46 * s;
  g.save();
  g.globalCompositeOperation = 'lighter';
  const halo = g.createRadialGradient(cx, baseY - colH * 0.6, 0, cx, baseY - colH * 0.6, 190 * s);
  halo.addColorStop(0, 'rgba(255,170,80,0.32)');
  halo.addColorStop(0.4, 'rgba(255,120,40,0.1)');
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo;
  g.fillRect(cx - 200 * s, baseY - colH - 200 * s, 400 * s, 400 * s);
  // a faint pillar of summoning light rising from the sanctuary
  const top = Math.max(0, baseY - 900 * s);
  const beam = g.createLinearGradient(0, baseY - colH, 0, top);
  beam.addColorStop(0, 'rgba(255,200,120,0.16)');
  beam.addColorStop(0.5, 'rgba(255,190,120,0.05)');
  beam.addColorStop(1, 'rgba(255,190,120,0)');
  g.fillStyle = beam;
  g.beginPath();
  g.moveTo(cx - w * 0.28, baseY - colH);
  g.lineTo(cx - w * 0.12, top);
  g.lineTo(cx + w * 0.12, top);
  g.lineTo(cx + w * 0.28, baseY - colH);
  g.closePath();
  g.fill();
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = color;
  g.fillRect(cx - w / 2 - 12 * s, baseY - 6 * s, w + 24 * s, 14 * s);
  g.fillRect(cx - w / 2 - 5 * s, baseY - 11 * s, w + 10 * s, 6 * s);
  const cols = 6;
  // warm light between the columns
  g.fillStyle = 'rgba(255,186,105,0.75)';
  g.fillRect(cx - w / 2 + 4 * s, baseY - 11 * s - colH * 0.92, w - 8 * s, colH * 0.92);
  g.fillStyle = color;
  for (let i = 0; i < cols; i++) {
    const x = cx - w / 2 + (i + 0.5) * (w / cols);
    g.fillRect(x - 5.5 * s, baseY - 11 * s - colH, 11 * s, colH);
  }
  g.fillRect(cx - w / 2 - 6 * s, baseY - 11 * s - colH - 10 * s, w + 12 * s, 10 * s);
  g.beginPath();
  g.moveTo(cx - w / 2 - 9 * s, baseY - 21 * s - colH);
  g.lineTo(cx, baseY - 21 * s - colH - 26 * s);
  g.lineTo(cx + w / 2 + 9 * s, baseY - 21 * s - colH);
  g.closePath();
  g.fill();
  g.restore();
}

/**
 * Create the animated backdrop inside a container element (it fills the container).
 * `setMode('full' | 'calm')` picks the title-screen show or the quieter variant
 * used behind other screens; `perfLevel` is 0 (full), 1 (reduced) or 2 (still).
 * @param {HTMLElement} container
 * @returns {{ start(): void, stop(): void, resize(): void, dispose(): void,
 *   setMode(mode: 'full' | 'calm'): void, readonly perfLevel: number }}
 */
export function createMenuBackdrop(container) {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const layer = (cls) => {
    const c = document.createElement('canvas');
    c.className = `mw-sky-layer ${cls}`;
    container.appendChild(c);
    return c;
  };
  const skyC = layer('is-sky');
  const starC = layer('is-stars');
  const mountC = layer('is-mountains');
  const emberC = layer('is-embers');
  const starG = starC.getContext('2d');
  const emberG = emberC.getContext('2d');
  const emberSprite = glowSprite(64, 'rgba(255,236,190,1)', 'rgba(255,140,40,0.55)');
  const starSprite = glowSprite(32, 'rgba(255,255,255,1)', 'rgba(170,200,255,0.35)');

  let W = 0;
  let H = 0;
  let scale = 1;
  let stars = [];
  let embers = [];
  let meteors = [];
  let raf = 0;
  let running = false;
  let lastT = 0;
  let lastDraw = 0;
  let nextMeteor = 2.5;
  let mouseX = 0;
  let mouseY = 0;
  let parX = 0;
  let parY = 0;
  let mode = MODES.full;
  let perf = 0; // 0 full, 1 reduced (20 fps, fewer embers), 2 still
  let winStart = 0;
  let winFrames = 0;

  const animating = () => running && !reduced && perf < 2;
  const frameMinMs = () => Math.max(mode.minMs, perf >= 1 ? 1000 / 20 : 0);
  const emberShare = () => mode.embers * (perf >= 1 ? 0.5 : 1);

  function paintSky() {
    const rand = mulberry(7);
    skyC.width = W;
    skyC.height = H;
    const s = skyC.getContext('2d');
    const grd = s.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#03050b');
    grd.addColorStop(0.36, '#0a1128');
    grd.addColorStop(0.6, '#1a1938');
    grd.addColorStop(0.78, '#36223a');
    grd.addColorStop(1, '#4e2b20');
    s.fillStyle = grd;
    s.fillRect(0, 0, W, H);
    // galactic band: many faint blobs along a diagonal
    s.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 90; i++) {
      const u = rand();
      const x = u * W * 1.2 - W * 0.1;
      const y = H * (0.1 + 0.4 * (1 - u)) + (rand() - 0.5) * H * 0.12;
      const r = (0.04 + rand() * 0.1) * Math.max(W, H);
      const hue = rand() < 0.5 ? '120,90,200' : '70,110,200';
      const b = s.createRadialGradient(x, y, 0, x, y, r);
      b.addColorStop(0, `rgba(${hue},${0.028 + rand() * 0.025})`);
      b.addColorStop(1, 'rgba(0,0,0,0)');
      s.fillStyle = b;
      s.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // moon with a wide halo
    const mx = W * 0.8;
    const my = H * 0.2;
    const mr = Math.min(W, H) * 0.055;
    const halo = s.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 7);
    halo.addColorStop(0, 'rgba(255,230,170,0.22)');
    halo.addColorStop(0.3, 'rgba(200,170,255,0.07)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    s.fillStyle = halo;
    s.fillRect(mx - mr * 7, my - mr * 7, mr * 14, mr * 14);
    s.globalCompositeOperation = 'source-over';
    const disc = s.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.1, mx, my, mr);
    disc.addColorStop(0, '#fff8e4');
    disc.addColorStop(0.65, '#f3dfb0');
    disc.addColorStop(1, '#d8b882');
    s.fillStyle = disc;
    s.beginPath();
    s.arc(mx, my, mr, 0, Math.PI * 2);
    s.fill();
    // soft maria
    s.save();
    s.beginPath();
    s.arc(mx, my, mr, 0, Math.PI * 2);
    s.clip();
    for (let i = 0; i < 7; i++) {
      const cx = mx + (rand() - 0.55) * mr * 1.3;
      const cy = my + (rand() - 0.45) * mr * 1.3;
      const cr = mr * (0.15 + rand() * 0.3);
      const m = s.createRadialGradient(cx, cy, 0, cx, cy, cr);
      m.addColorStop(0, 'rgba(170,135,95,0.22)');
      m.addColorStop(1, 'rgba(170,135,95,0)');
      s.fillStyle = m;
      s.fillRect(cx - cr, cy - cr, cr * 2, cr * 2);
    }
    s.restore();
    // warm horizon glow (the fires of the cities)
    const hg = s.createRadialGradient(W * 0.5, H * 1.08, 0, W * 0.5, H * 1.08, H * 0.75);
    hg.addColorStop(0, 'rgba(255,120,40,0.32)');
    hg.addColorStop(1, 'rgba(0,0,0,0)');
    s.fillStyle = hg;
    s.fillRect(0, 0, W, H);

    // stars (drawn on their own layer)
    const count = Math.round(Math.min(420, (W * H) / 5000));
    stars = Array.from({ length: count }, () => {
      const big = rand() < 0.07;
      return {
        x: rand() * W,
        y: Math.pow(rand(), 1.25) * H * 0.8,
        r: (big ? 1.6 + rand() * 1.4 : 0.6 + rand() * 0.9) * scale,
        a: 0.35 + rand() * 0.65,
        tw: 0.4 + rand() * 2.2,
        ph: rand() * Math.PI * 2,
        big,
      };
    });
  }

  function paintMountains() {
    const rand = mulberry(11);
    const pad = Math.round(40 * scale);
    const RW = W + pad * 2;
    const RH = H + pad;
    mountC.width = RW;
    mountC.height = RH;
    const m = mountC.getContext('2d');
    const far = ridge(RW, RH * 0.74, RH * 0.2, rand, { peaks: 4, jag: 0.12 });
    const farGrd = m.createLinearGradient(0, RH * 0.5, 0, RH);
    farGrd.addColorStop(0, '#24213f');
    farGrd.addColorStop(1, '#141329');
    fillRidge(m, far, RH, farGrd);
    const mid = ridge(RW, RH * 0.86, RH * 0.2, rand, { peaks: 3, jag: 0.16 });
    const midGrd = m.createLinearGradient(0, RH * 0.6, 0, RH);
    midGrd.addColorStop(0, '#15142b');
    midGrd.addColorStop(1, '#0a0918');
    fillRidge(m, mid, RH, midGrd);
    // temple on the highest point of the mid ridge, right of the menu column
    let best = null;
    for (const p of mid) if (p[0] > RW * 0.74 && p[0] < RW * 0.9 && (!best || p[1] < best[1])) best = p;
    if (best) drawTemple(m, best[0], best[1] + 4 * scale, Math.max(0.42, Math.min(1.1, W / 2400)), '#0e0d1f');
    const near = ridge(RW, RH * 1.0, RH * 0.17, rand, { peaks: 3, jag: 0.22 });
    const nearGrd = m.createLinearGradient(0, RH * 0.75, 0, RH);
    nearGrd.addColorStop(0, '#08080f');
    nearGrd.addColorStop(1, '#030306');
    fillRidge(m, near, RH, nearGrd);
    // faint rim of firelight along the bottom
    m.globalCompositeOperation = 'lighter';
    const rim = m.createLinearGradient(0, RH * 0.84, 0, RH);
    rim.addColorStop(0, 'rgba(0,0,0,0)');
    rim.addColorStop(1, 'rgba(120,50,20,0.22)');
    m.fillStyle = rim;
    m.fillRect(0, RH * 0.84, RW, RH * 0.16);
    m.globalCompositeOperation = 'source-over';
    // the CSS box is the same proportion as the backing store
    const cssScale = (container.clientWidth || window.innerWidth) / W;
    mountC.style.width = `${RW * cssScale}px`;
    mountC.style.height = `${RH * cssScale}px`;
    mountC.style.left = `${-pad * cssScale}px`;
    mountC.style.top = '0px';
  }

  function spawnEmber(initial) {
    return {
      x: Math.random() * W,
      y: initial ? H * (0.55 + Math.random() * 0.5) : H + 10 * scale,
      vy: -(14 + Math.random() * 30) * scale,
      vx: (Math.random() - 0.5) * 10 * scale,
      sway: 0.6 + Math.random() * 1.6,
      ph: Math.random() * Math.PI * 2,
      size: (5 + Math.random() * 9) * scale,
      life: 0,
      maxLife: 5 + Math.random() * 7,
    };
  }

  function resize() {
    const dpr = Math.min(1.5, globalThis.devicePixelRatio || 1);
    const cssW = Math.max(1, container.clientWidth || window.innerWidth);
    const cssH = Math.max(1, container.clientHeight || window.innerHeight);
    let w = Math.round(cssW * dpr);
    let h = Math.round(cssH * dpr);
    if (w > MAX_BACKING_WIDTH) {
      h = Math.round(h * (MAX_BACKING_WIDTH / w));
      w = MAX_BACKING_WIDTH;
    }
    if (w === W && h === H && stars.length) return;
    W = w;
    H = h;
    scale = (W / cssW) * Math.max(1, cssW / 1600);
    paintSky();
    paintMountains();
    starC.width = W;
    starC.height = H;
    emberC.width = W;
    emberC.height = H;
    const emberCount = reduced ? 0 : Math.round(Math.min(80, 26 + W / 45));
    embers = Array.from({ length: emberCount }, () => spawnEmber(true));
    embers.forEach((e) => (e.life = Math.random() * e.maxLife * 0.8));
    draw(performance.now() / 1000);
  }

  function draw(t) {
    // stars
    starG.clearRect(0, 0, W, H);
    starG.globalCompositeOperation = 'lighter';
    starG.fillStyle = '#dfe8ff';
    for (const s of stars) {
      starG.globalAlpha = s.a * (reduced ? 1 : 0.62 + 0.38 * Math.sin(t * s.tw + s.ph));
      if (s.big) {
        const r = s.r * 4;
        starG.drawImage(starSprite, s.x - r, s.y - r, r * 2, r * 2);
      } else starG.fillRect(s.x, s.y, s.r, s.r);
    }
    starG.globalAlpha = 1;
    starG.lineWidth = 1.6 * scale;
    for (const m of meteors) {
      const k = m.life / m.maxLife;
      const a = Math.sin(Math.PI * k);
      const x = m.x + m.vx * m.life;
      const y = m.y + m.vy * m.life;
      const grd = starG.createLinearGradient(x, y, x - m.vx * 0.14, y - m.vy * 0.14);
      grd.addColorStop(0, `rgba(255,240,210,${0.9 * a})`);
      grd.addColorStop(1, 'rgba(255,240,210,0)');
      starG.strokeStyle = grd;
      starG.beginPath();
      starG.moveTo(x, y);
      starG.lineTo(x - m.vx * 0.14, y - m.vy * 0.14);
      starG.stroke();
    }
    // embers
    emberG.clearRect(0, 0, W, H);
    emberG.globalCompositeOperation = 'lighter';
    const nEmbers = Math.round(embers.length * emberShare());
    for (let i = 0; i < nEmbers; i++) {
      const e = embers[i];
      const k = e.life / e.maxLife;
      const a = Math.min(1, k * 4) * (1 - k) * (1 - k);
      if (a <= 0.01) continue;
      emberG.globalAlpha = a * 0.9;
      const sz = e.size * (1 - k * 0.5);
      emberG.drawImage(emberSprite, e.x - sz / 2, e.y - sz / 2, sz, sz);
    }
    emberG.globalAlpha = 1;
    mountC.style.transform = `translate3d(${(-parX).toFixed(2)}px, ${(-parY * 0.6).toFixed(2)}px, 0)`;
  }

  function step(dt, t) {
    for (const e of embers) {
      e.life += dt;
      e.y += e.vy * dt;
      e.x += (e.vx + Math.sin(t * e.sway + e.ph) * 12 * scale) * dt;
      if (e.life >= e.maxLife || e.y < -20) Object.assign(e, spawnEmber(false));
    }
    nextMeteor -= dt;
    if (nextMeteor <= 0) {
      nextMeteor = 5 + Math.random() * 9;
      const dir = Math.random() < 0.5 ? -1 : 1;
      meteors.push({
        x: W * (0.15 + Math.random() * 0.7),
        y: H * (0.04 + Math.random() * 0.22),
        vx: dir * (500 + Math.random() * 400) * scale,
        vy: (160 + Math.random() * 160) * scale,
        life: 0,
        maxLife: 0.6 + Math.random() * 0.5,
      });
    }
    for (const m of meteors) m.life += dt;
    meteors = meteors.filter((m) => m.life < m.maxLife);
    // ease the mountain parallax toward the mouse (CSS pixels)
    const k = Math.min(1, dt * 2.5);
    parX += (mouseX * 16 - parX) * k;
    parY += (mouseY * 9 - parY) * k;
  }

  /** Count frames the browser actually delivers; step down when it is too slow. */
  function measure(now) {
    if (!winStart) {
      winStart = now;
      winFrames = 0;
      return;
    }
    winFrames++;
    const elapsed = now - winStart;
    if (elapsed < SLOW_WINDOW_MS) return;
    const fps = (winFrames * 1000) / elapsed;
    winStart = now;
    winFrames = 0;
    if (fps < SLOW_FPS && perf < 2) {
      perf++;
      if (perf >= 2) {
        cancelAnimationFrame(raf);
        draw(now / 1000);
      }
    }
  }

  function frame(now) {
    if (!animating()) return;
    raf = requestAnimationFrame(frame);
    measure(now);
    if (!animating()) return;
    if (now - lastDraw < frameMinMs()) return;
    lastDraw = now;
    const t = now / 1000;
    const dt = Math.min(0.06, lastT ? t - lastT : 0.016);
    lastT = t;
    step(dt, t);
    draw(t);
  }

  const onMouse = (e) => {
    mouseX = e.clientX / Math.max(1, window.innerWidth) - 0.5;
    mouseY = e.clientY / Math.max(1, window.innerHeight) - 0.5;
  };
  const onResize = () => resize();
  // a hidden tab delivers no frames; do not mistake the pause for slowness
  const onVisibility = () => {
    winStart = 0;
  };

  return {
    start() {
      if (running) return;
      running = true;
      resize();
      window.addEventListener('resize', onResize);
      window.addEventListener('pointermove', onMouse, { passive: true });
      document.addEventListener('visibilitychange', onVisibility);
      lastT = 0;
      winStart = 0;
      if (animating()) raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onMouse);
      document.removeEventListener('visibilitychange', onVisibility);
    },
    resize,
    setMode(name) {
      const next = MODES[name] || MODES.full;
      if (next === mode) return;
      mode = next;
      winStart = 0;
      if (running && W) draw(performance.now() / 1000);
    },
    get perfLevel() {
      return perf;
    },
    dispose() {
      this.stop();
      container.textContent = '';
    },
  };
}
