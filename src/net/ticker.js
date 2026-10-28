// Fixed-rate metronome for the host simulation (DESIGN 7). In the browser the
// pulses come from a tiny Blob-URL Worker, because a page's own timers are
// throttled to ~1 Hz (or worse) in a background tab while worker timers keep
// running; in Node (or if workers are unavailable) setInterval is used. Ticks
// are counted against performance.now(), so the long-run rate is exact; after
// a stall at most `maxCatchUp` ticks run in one go and the rest is dropped.
import { TICK_RATE } from '../config.js';

const WORKER_SRC = `let h = null;
onmessage = (e) => {
  const d = e.data || {};
  if (h !== null) { clearInterval(h); h = null; }
  if (d.cmd === 'start') h = setInterval(() => postMessage(0), d.ms);
};`;

let workerUrl = null;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function canUseWorker() {
  return typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
    && typeof window !== 'undefined';
}

/**
 * Call `fn` every `ms` milliseconds, keeping time in background tabs.
 * @param {() => void} fn
 * @param {number} ms
 * @param {{ useWorker?: boolean }} [opts]
 * @returns {{ stop(): void, worker: boolean }}
 */
export function createPulse(fn, ms, opts = {}) {
  const wantWorker = opts.useWorker ?? true;
  if (wantWorker && canUseWorker()) {
    try {
      if (!workerUrl) workerUrl = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
      const w = new Worker(workerUrl);
      w.onmessage = () => fn();
      w.postMessage({ cmd: 'start', ms });
      return {
        worker: true,
        stop() {
          w.postMessage({ cmd: 'stop' });
          w.terminate();
        },
      };
    } catch {
      // CSP or sandbox forbids blob workers: fall back to a plain interval.
    }
  }
  const h = setInterval(fn, ms);
  if (h && typeof h.unref === 'function') h.unref();
  return { worker: false, stop: () => clearInterval(h) };
}

export class Ticker {
  /**
   * @param {object} opts
   * @param {() => void} opts.onTick called once per simulation tick
   * @param {(ticksRun: number) => void} [opts.onBatch] called after the ticks of one wake-up
   * @param {number} [opts.rate] ticks per second (TICK_RATE)
   * @param {number} [opts.maxCatchUp] max ticks per wake-up (5)
   * @param {boolean} [opts.useWorker] allow the worker metronome (default true in browsers)
   */
  constructor({ onTick, onBatch = null, rate = TICK_RATE, maxCatchUp = 5, useWorker = true } = {}) {
    this.onTick = onTick;
    this.onBatch = onBatch;
    this.rate = rate;
    this.speed = 1; // game speed (single player): ticks run this many times faster than `rate`
    this.interval = 1000 / rate;
    this.maxCatchUp = maxCatchUp;
    this.useWorker = useWorker;
    this.running = false;
    this.ticks = 0; // ticks run since start
    this.dropped = 0; // ticks skipped by the catch-up cap
    this.pulse = null;
    this.t0 = 0;
    this.due = 0; // ticks owed according to the clock
    this.usesWorker = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.t0 = now();
    this.due = 0;
    // Pulse twice per tick so a tick is never more than half an interval late.
    this.pulse = createPulse(() => this.wake(), Math.max(4, this.interval / 2), { useWorker: this.useWorker });
    this.usesWorker = this.pulse.worker;
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.pulse.stop();
    this.pulse = null;
  }

  /**
   * Run the simulation `m` times faster (or slower) than its tick rate: the ticks themselves
   * stay the same length in game time, only more (or fewer) of them run each real second.
   * A running ticker re-anchors its clock at the new pace.
   */
  setSpeed(m) {
    const speed = Number.isFinite(m) && m > 0 ? m : 1;
    if (speed === this.speed) return;
    this.speed = speed;
    this.interval = 1000 / (this.rate * speed);
    if (this.running) {
      this.stop();
      this.start();
    }
  }

  /** Run the ticks the clock says are owed (at most maxCatchUp). Called by the pulse. */
  wake(at = now()) {
    if (!this.running) return 0;
    const owed = Math.floor((at - this.t0) / this.interval) - this.due;
    if (owed <= 0) return 0;
    let n = owed;
    if (n > this.maxCatchUp) {
      this.dropped += n - this.maxCatchUp;
      n = this.maxCatchUp;
    }
    this.due += owed;
    return this.run(n);
  }

  /** Run `n` ticks right now (also used by tests to step deterministically). */
  run(n = 1) {
    const wasRunning = this.running;
    let done = 0;
    for (let i = 0; i < n; i++) {
      this.onTick();
      this.ticks++;
      done++;
      if (wasRunning && !this.running) break; // stopped from inside a tick
    }
    if (done > 0 && this.onBatch) this.onBatch(done);
    return done;
  }
}
