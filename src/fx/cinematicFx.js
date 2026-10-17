import * as THREE from 'three';
import { CONFIG, REDUCED_MOTION } from '../config.js';
import { TimeState } from '../core/timeSystem.js';
import { clamp, damp, easeOutCubic, easeInOutCubic } from '../utils/math.js';

/**
 * The "director": converts time-state transitions into camera language and
 * post-processing parameters. Runs entirely on REAL time.
 *
 *  freeze onset  -> dolly-zoom FOV kick, aberration spike, cold flash,
 *                   letterbox slides in, DOF racks to the hero, grade goes cold
 *  frozen        -> tighter vignette, stronger streaks, held breath
 *  resume        -> shockwave ring, aberration spike, impact shake, warm flash,
 *                   letterbox slides out
 */
export class CinematicDirector {
  constructor(pipeline, camera, time, focus) {
    this.pipeline = pipeline;
    this.camera = camera;
    this.time = time;
    this.focus = focus;
    this.cfg = CONFIG.fx;
    this.rm = REDUCED_MOTION;
    const motion = this.rm ? 0.25 : 1;
    this.motionScale = motion;
    this.flashScale = this.rm ? 0.3 : 1;

    this.baseFov = CONFIG.camera.fov;
    this.kickT = -1;
    this.shockT = -1;
    this.caSpike = 0;
    this.trauma = 0;
    this.flash = 0;
    this.flashColor = new THREE.Color();
    this.letterbox = 0;
    this.dofAmount = 0;
    this.streakEnabled = true;
    this.shakeTime = 0;

    this._fwd = new THREE.Vector3();
    this._proj = new THREE.Vector3();

    time.on('freeze', () => {
      this.kickT = 0;
      this.caSpike = 1;
      this.flash = 0.22 * this.flashScale;
      this.flashColor.setRGB(0.55, 0.75, 1.0);
      this.trauma = Math.min(1, this.trauma + 0.25);
    });
    time.on('resume', () => {
      this.shockT = 0;
      this.caSpike = 1;
      this.flash = 0.16 * this.flashScale;
      this.flashColor.setRGB(1.0, 0.9, 0.8);
    });
    time.on('running', () => {
      this.trauma = Math.min(1, this.trauma + 0.55);
    });
  }

  /** World explosion: camera shake scaled by proximity. */
  onExplosion(position, synced) {
    const d = this.camera.position.distanceTo(position);
    this.trauma = Math.min(1, this.trauma + clamp(9 / (d + 3), 0.1, 0.8) * (synced ? 0.5 : 1));
    if (!synced) {
      this.flash = Math.max(this.flash, 0.08 * this.flashScale);
      this.flashColor.setRGB(1.0, 0.6, 0.3);
    }
  }

  /** Applies camera FX on top of the rig's base transform, then sets post uniforms. */
  update(dt) {
    const cfg = this.cfg;
    const cam = this.camera;
    const t = this.time;
    const stopped = t.state === TimeState.FREEZING || t.state === TimeState.FROZEN;

    // ------------------------------------------------ dolly zoom (vertigo)
    let fov = this.baseFov;
    let dolly = 0;
    if (this.kickT >= 0) {
      this.kickT += dt;
      const k = this.kickT;
      let env;
      if (k < cfg.fovKickIn) env = easeOutCubic(k / cfg.fovKickIn);
      else env = 1 - easeInOutCubic((k - cfg.fovKickIn) / cfg.fovKickOut);
      if (k > cfg.fovKickIn + cfg.fovKickOut) {
        this.kickT = -1;
        env = 0;
      }
      fov = this.baseFov + cfg.fovKick * env * this.motionScale;
      // Keep the subject's framing constant: d' = d * tan(f0/2) / tan(f1/2)
      const d = clamp(cam.position.distanceTo(this.focus), 2, 40);
      const ratio = Math.tan(THREE.MathUtils.degToRad(this.baseFov) / 2) / Math.tan(THREE.MathUtils.degToRad(fov) / 2);
      dolly = Math.min(cfg.dollyMax, d - d * ratio);
    }
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.getWorldDirection(this._fwd);
    if (dolly > 0) cam.position.addScaledVector(this._fwd, dolly);

    // ------------------------------------------------ shake (trauma^2)
    this.trauma = Math.max(0, this.trauma - dt * cfg.shake.decay);
    this.shakeTime += dt;
    const sh = this.trauma * this.trauma * this.motionScale * (this.rm ? 0 : 1);
    if (sh > 0.0001) {
      const s = this.shakeTime * 28;
      cam.position.x += (Math.sin(s * 1.1) + Math.sin(s * 2.3) * 0.5) * cfg.shake.maxOffset * sh * 0.6;
      cam.position.y += (Math.sin(s * 1.7 + 1.3) + Math.sin(s * 3.1) * 0.5) * cfg.shake.maxOffset * sh * 0.6;
      cam.rotation.z += Math.sin(s * 1.3 + 2.1) * cfg.shake.maxRoll * sh;
    }
    cam.updateMatrixWorld();

    // ------------------------------------------------ post parameters
    const P = this.pipeline;
    const f = t.freezeAmount;

    this.letterbox = damp(this.letterbox, stopped ? 1 : 0, cfg.letterboxSpeed, dt);
    this.caSpike = damp(this.caSpike, 0, 4.5, dt);
    this.flash = damp(this.flash, 0, 6, dt);
    this.dofAmount = damp(this.dofAmount, stopped ? 1 : 0, stopped ? 3 : 7, dt);

    P.dof.uAmount.value = this.dofAmount;
    P.dof.uFocus.value = cam.position.distanceTo(this.focus);
    P.dof.uResponse.value = cfg.dof.response;

    const caScale = this.rm ? 0.5 : 1;
    P.lens.uCA.value = (cfg.chromaticBase + (cfg.chromaticFrozen - cfg.chromaticBase) * f + cfg.chromaticSpike * this.caSpike) * caScale;
    P.lens.uStreak.value = P.streakEnabled === false ? 0 : cfg.streakBase + (cfg.streakFrozen - cfg.streakBase) * f;
    P.lens.uStreakThreshold.value = cfg.streakThreshold;

    // shockwave
    if (this.shockT >= 0) {
      this.shockT += dt;
      const u = this.shockT / cfg.shockwave.duration;
      if (u >= 1) {
        this.shockT = -1;
        P.lens.uShockStrength.value = 0;
      } else {
        this._proj.copy(this.focus).project(cam);
        const onScreen = this._proj.z < 1 && Math.abs(this._proj.x) < 1.2 && Math.abs(this._proj.y) < 1.2;
        if (onScreen) P.lens.uShockCenter.value.set(this._proj.x * 0.5 + 0.5, this._proj.y * 0.5 + 0.5);
        else P.lens.uShockCenter.value.set(0.5, 0.5);
        P.lens.uShockRadius.value = easeOutCubic(u) * 1.6;
        P.lens.uShockWidth.value = cfg.shockwave.width * (0.6 + u);
        P.lens.uShockStrength.value = cfg.shockwave.strength * (1 - u) * (1 - u) * (this.rm ? 0.4 : 1);
      }
    }

    P.grade.uFreeze.value = f;
    P.grade.uVignette.value = cfg.vignetteBase + (cfg.vignetteFrozen - cfg.vignetteBase) * f;
    P.grade.uGrain.value = cfg.grain * (1 + f * 0.4);
    P.grade.uLetterbox.value = easeInOutCubic(this.letterbox);
    P.grade.uTargetAspect.value = cfg.letterboxAspect;
    P.grade.uMinBar.value = cfg.letterboxMin;
    P.grade.uTime.value = t.realTime;
    P.grade.uFlash.value = this.flash;
    P.grade.uFlashColor.value.copy(this.flashColor);

    P.bloomPass.strength = CONFIG.fx.bloom.strength * (1 + 0.25 * f);
  }
}
