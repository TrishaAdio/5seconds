/**
 * TIME SYSTEM — the heart of FIVE SECONDS.
 *
 * The render loop NEVER pauses. Instead, two clocks advance every frame:
 *
 *   realDelta  = actual (clamped) frame time.
 *                Drives the camera, UI, post-processing and audio.
 *   worldDelta = realDelta * timeScale.
 *                Drives EVERY world simulation: rain, particles, vehicles,
 *                pedestrians, the hero explosion and all shader animation
 *                (via the shared uWorldTime uniform).
 *
 * timeScale is owned by a 4-state machine:
 *
 *   RUNNING   timeScale = 1
 *   FREEZING  1 -> 0 over freezeInDuration, exponential ease-out (sharp brake)
 *   FROZEN    0 (or microDriftScale) for exactly freezeDuration seconds of
 *             REAL time, measured against the high-resolution frame clock
 *             (performance.now timeline) — not against summed, clamped deltas.
 *   RESUMING  0 -> 1 over resumeDuration with an easeOutBack overshoot (snap)
 *
 * After RESUMING a cooldown runs before the power can be triggered again.
 *
 * Systems subscribe to transitions with time.on('freeze' | 'frozen' |
 * 'resume' | 'running' | 'ready', fn).
 */
import { CONFIG } from '../config.js';
import { clamp, easeOutBack, easeOutCubic } from '../utils/math.js';

export const TimeState = Object.freeze({
  RUNNING: 'RUNNING',
  FREEZING: 'FREEZING',
  FROZEN: 'FROZEN',
  RESUMING: 'RESUMING',
});

export class TimeSystem {
  constructor(cfg = CONFIG.time) {
    this.cfg = cfg;
    this.state = TimeState.RUNNING;

    this.timeScale = 1;
    this.realDelta = 0;
    this.worldDelta = 0;
    this.realTime = 0;
    this.worldTime = 0;

    /** Real seconds since the current state was entered (clamped clock). */
    this.stateTime = 0;
    /** High-resolution timestamp (ms) at which FROZEN began. */
    this.frozenStartMs = 0;
    this.frozenElapsed = 0;
    this.frozenRemaining = cfg.freezeDuration;
    /** Precise duration of the most recent freeze (for debug verification). */
    this.lastFrozenDuration = 0;

    this.cooldownRemaining = 0;
    this.microDrift = cfg.microDrift;

    /** 0..1 visual blend: how "stopped" the world looks. */
    this.freezeAmount = 0;

    this._listeners = new Map();
    this._nowMs = 0;

    /**
     * Shared uniforms. ShaderMaterials reference these objects directly, so a
     * single write per frame updates every shader in the world.
     */
    this.uniforms = {
      uWorldTime: { value: 0 },
      uRealTime: { value: 0 },
      uTimeScale: { value: 1 },
      uFreeze: { value: 0 },
      uShimmer: { value: 0 },
    };
  }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(fn);
    return () => {
      const list = this._listeners.get(event);
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  _emit(event) {
    const list = this._listeners.get(event);
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i](this);
  }

  get isRunning() {
    return this.state === TimeState.RUNNING;
  }

  /** True while the bullet-time camera should be active. */
  get isStopped() {
    return this.state === TimeState.FREEZING || this.state === TimeState.FROZEN;
  }

  canTrigger() {
    return this.state === TimeState.RUNNING && this.cooldownRemaining <= 0;
  }

  /** Request a time-stop. Returns true when accepted. */
  trigger() {
    if (!this.canTrigger()) return false;
    this._enter(TimeState.FREEZING);
    return true;
  }

  toggleMicroDrift() {
    this.microDrift = !this.microDrift;
    return this.microDrift;
  }

  _enter(state) {
    this.state = state;
    this.stateTime = 0;
    switch (state) {
      case TimeState.FREEZING:
        this._emit('freeze');
        break;
      case TimeState.FROZEN:
        this.frozenStartMs = this._nowMs;
        this.frozenElapsed = 0;
        this.frozenRemaining = this.cfg.freezeDuration;
        this._emit('frozen');
        break;
      case TimeState.RESUMING:
        this._emit('resume');
        break;
      case TimeState.RUNNING:
        this.cooldownRemaining = this.cfg.cooldown;
        this._emit('running');
        break;
      default:
        break;
    }
  }

  /**
   * Advance both clocks.
   * @param {number} dt    clamped real delta in seconds
   * @param {number} nowMs high-resolution timestamp of this frame
   */
  update(dt, nowMs) {
    const cfg = this.cfg;
    this._nowMs = nowMs;
    this.realDelta = dt;
    this.realTime += dt;
    this.stateTime += dt;

    switch (this.state) {
      case TimeState.RUNNING: {
        this.timeScale = 1;
        this.freezeAmount = 0;
        if (this.cooldownRemaining > 0) {
          this.cooldownRemaining -= dt;
          if (this.cooldownRemaining <= 0) {
            this.cooldownRemaining = 0;
            this._emit('ready');
          }
        }
        break;
      }
      case TimeState.FREEZING: {
        const u = clamp(this.stateTime / cfg.freezeInDuration, 0, 1);
        // 1 - easeOutExpo(u): falls off a cliff, then crawls to a stop.
        this.timeScale = u >= 1 ? 0 : Math.pow(2, -10 * u);
        this.freezeAmount = easeOutCubic(u);
        if (u >= 1) this._enter(TimeState.FROZEN);
        break;
      }
      case TimeState.FROZEN: {
        // Exact real-clock measurement, independent of delta clamping.
        this.frozenElapsed = (nowMs - this.frozenStartMs) / 1000;
        this.frozenRemaining = Math.max(0, cfg.freezeDuration - this.frozenElapsed);
        this.timeScale = this.microDrift ? cfg.microDriftScale : 0;
        this.freezeAmount = 1;
        if (this.frozenElapsed >= cfg.freezeDuration) {
          this.lastFrozenDuration = this.frozenElapsed;
          this.frozenRemaining = 0;
          this._enter(TimeState.RESUMING);
          this.timeScale = 0;
        }
        break;
      }
      case TimeState.RESUMING: {
        const u = clamp(this.stateTime / cfg.resumeDuration, 0, 1);
        // Overshoots ~15% above real-time, then settles: the "snap".
        this.timeScale = Math.max(0, easeOutBack(u, cfg.resumeOvershoot));
        this.freezeAmount = 1 - easeOutCubic(u);
        if (u >= 1) {
          this.timeScale = 1;
          this.freezeAmount = 0;
          this._enter(TimeState.RUNNING);
        }
        break;
      }
      default:
        break;
    }

    this.worldDelta = dt * this.timeScale;
    this.worldTime += this.worldDelta;

    const u = this.uniforms;
    u.uWorldTime.value = this.worldTime;
    u.uRealTime.value = this.realTime;
    u.uTimeScale.value = this.timeScale;
    u.uFreeze.value = this.freezeAmount;
    const shimmerTarget = this.state === TimeState.FROZEN && this.microDrift ? 1 : 0;
    u.uShimmer.value += (shimmerTarget - u.uShimmer.value) * (1 - Math.exp(-4 * dt));
  }
}
