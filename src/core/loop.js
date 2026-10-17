import { CONFIG } from '../config.js';

/**
 * requestAnimationFrame driver.
 * Supplies both the raw delta (for FPS measurement) and a clamped delta
 * (for simulation) so a tab switch never produces a giant time step.
 */
export class Loop {
  constructor(onFrame) {
    this.onFrame = onFrame;
    this.running = false;
    this._last = 0;
    this._raf = 0;
    this._tick = this._tick.bind(this);
    this._onVisibility = () => {
      // Reset the reference timestamp so the first frame back is small.
      if (!document.hidden) this._last = performance.now();
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  _tick(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._tick);
    const raw = Math.max(0, (now - this._last) / 1000);
    this._last = now;
    const dt = Math.min(raw, CONFIG.time.maxDelta);
    this.onFrame(dt, raw, now);
  }

  dispose() {
    this.stop();
    document.removeEventListener('visibilitychange', this._onVisibility);
  }
}
