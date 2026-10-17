import { CONFIG } from '../config.js';

/**
 * Adaptive quality.
 * Averages real frame times over a sliding window; if the average FPS drops
 * below `downgradeFps` it steps one level down (pixel ratio, rain/particle
 * counts, reflection resolution, bloom, DOF samples, anamorphic streaks).
 * Sustained headroom steps back up — but never back into a level that
 * already failed, which prevents oscillation.
 */
export class QualityManager {
  constructor(onApply) {
    this.cfg = CONFIG.quality;
    this.levels = this.cfg.levels;
    this.index = this.cfg.startLevel;
    this.onApply = onApply;
    this.fps = 60;
    this._frames = 0;
    this._accum = 0;
    this._settle = this.cfg.settleTime;
    this._goodTime = 0;
    this._ceiling = 0; // highest index (lowest number) allowed
    this.locked = false;
  }

  get level() {
    return this.levels[this.index];
  }

  apply() {
    this.onApply(this.level, this.index);
  }

  setLevel(index) {
    const i = Math.max(0, Math.min(this.levels.length - 1, index));
    if (i === this.index) return;
    this.index = i;
    this._settle = this.cfg.settleTime;
    this._goodTime = 0;
    this.apply();
  }

  /** Call when the tab becomes visible again so stale timings are dropped. */
  reset() {
    this._frames = 0;
    this._accum = 0;
    this._settle = this.cfg.settleTime;
  }

  update(rawDelta) {
    if (rawDelta <= 0 || rawDelta > 0.5) return; // ignore hitches/tab switches
    if (this._settle > 0) {
      this._settle -= rawDelta;
      return;
    }
    this._frames++;
    this._accum += rawDelta;
    if (this._accum < this.cfg.sampleWindow) return;

    this.fps = this._frames / this._accum;
    const windowLen = this._accum;
    this._frames = 0;
    this._accum = 0;
    if (this.locked) return;

    if (this.fps < this.cfg.downgradeFps && this.index < this.levels.length - 1) {
      // Remember that the current level failed: never climb back above it.
      this._ceiling = Math.max(this._ceiling, this.index + 1);
      this.setLevel(this.index + 1);
    } else if (this.fps > this.cfg.upgradeFps && this.index > this._ceiling) {
      this._goodTime += windowLen;
      if (this._goodTime >= this.cfg.upgradeAfter) this.setLevel(this.index - 1);
    } else {
      this._goodTime = 0;
    }
  }
}
