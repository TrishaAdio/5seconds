import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp, damp } from '../utils/math.js';

/**
 * Camera controller. Runs exclusively on REAL time, so it stays fully
 * responsive while the world is frozen.
 *
 * Modes:
 *  - attract : slow cinematic drift behind the title card
 *  - walk    : grounded first-person walk with damping and head-bob
 *  - fly     : bullet-time free-fly (WASD + mouse, Q/E vertical, Shift precision)
 *              Hold right mouse to orbit-lock around the hero moment.
 */
export class CameraRig {
  constructor(camera, input, heroFocus) {
    this.camera = camera;
    this.input = input;
    this.cfg = CONFIG.camera;
    this.focus = heroFocus; // Vector3 (hero centre)

    const s = this.cfg.start;
    this.pos = new THREE.Vector3(s.x, this.cfg.eyeHeight, s.z);
    this.vel = new THREE.Vector3();
    this.yaw = s.yaw;
    this.pitch = s.pitch;
    this.targetYaw = s.yaw;
    this.targetPitch = s.pitch;

    this.mode = 'attract';
    this.attractTime = 0;
    this.bobPhase = 0;
    this.bobAmount = 0;

    this.orbit = { active: false, theta: 0, phi: 1.2, radius: 8, tTheta: 0, tPhi: 1.2, tRadius: 8 };

    // scratch (no allocations per frame)
    this._look = { x: 0, y: 0, tx: 0, ty: 0 };
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._wish = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
  }

  start() {
    this.mode = 'walk';
  }

  setFlying(fly) {
    if (this.mode === 'attract') return;
    if (fly && this.mode !== 'fly') this.mode = 'fly';
    else if (!fly && this.mode === 'fly') {
      this.mode = 'walk';
      this.orbit.active = false;
    }
  }

  _beginOrbit() {
    const o = this.orbit;
    this._tmp.subVectors(this.pos, this.focus);
    o.radius = o.tRadius = clamp(this._tmp.length(), this.cfg.orbitMinRadius, this.cfg.orbitMaxRadius);
    o.theta = o.tTheta = Math.atan2(this._tmp.x, this._tmp.z);
    o.phi = o.tPhi = Math.acos(clamp(this._tmp.y / Math.max(this._tmp.length(), 1e-4), -1, 1));
    o.active = true;
  }

  update(dt) {
    const cfg = this.cfg;
    const input = this.input;
    const look = input.consumeLook(this._look);

    if (this.mode === 'attract') {
      // Slow push-in drift used behind the start screen.
      this.attractTime += dt;
      const t = this.attractTime;
      this.pos.set(cfg.start.x + Math.sin(t * 0.11) * 1.2, cfg.eyeHeight + 0.35 + Math.sin(t * 0.17) * 0.2, cfg.start.z + 3 - Math.sin(t * 0.07) * 2);
      this.yaw = this.targetYaw = cfg.start.yaw + Math.sin(t * 0.09) * 0.08;
      this.pitch = this.targetPitch = cfg.start.pitch + Math.sin(t * 0.13) * 0.02;
      this._apply();
      return;
    }

    const lookX = look.x * cfg.lookSensitivity + look.tx * cfg.touchLookSensitivity;
    const lookY = look.y * cfg.lookSensitivity + look.ty * cfg.touchLookSensitivity;

    // ---------------------------------------------------- orbit lock (fly only)
    const wantsOrbit = this.mode === 'fly' && input.rightMouse;
    if (wantsOrbit && !this.orbit.active) this._beginOrbit();
    if (!wantsOrbit && this.orbit.active) {
      this.orbit.active = false;
      this.targetYaw = this.yaw;
      this.targetPitch = this.pitch;
      this.vel.set(0, 0, 0);
    }

    if (this.orbit.active) {
      const o = this.orbit;
      o.tTheta -= lookX * 1.4;
      o.tPhi = clamp(o.tPhi - lookY * 1.4, 0.2, 1.62);
      o.tRadius = clamp(o.tRadius * (1 + input.consumeWheel() * 0.1) - input.moveForward * dt * 6, cfg.orbitMinRadius, cfg.orbitMaxRadius);
      o.theta = damp(o.theta, o.tTheta, 10, dt);
      o.phi = damp(o.phi, o.tPhi, 10, dt);
      o.radius = damp(o.radius, o.tRadius, 8, dt);
      const sp = Math.sin(o.phi);
      this.pos.set(
        this.focus.x + o.radius * sp * Math.sin(o.theta),
        this.focus.y + o.radius * Math.cos(o.phi),
        this.focus.z + o.radius * sp * Math.cos(o.theta)
      );
      this._clampBounds(dt, true);
      this._tmp.subVectors(this.focus, this.pos).normalize();
      this.yaw = this.targetYaw = Math.atan2(-this._tmp.x, -this._tmp.z);
      this.pitch = this.targetPitch = Math.asin(clamp(this._tmp.y, -1, 1));
      this._apply();
      return;
    }
    input.consumeWheel();

    // ---------------------------------------------------------------- look
    const pitchLimit = this.mode === 'fly' ? 1.5 : 1.25;
    this.targetYaw -= lookX;
    this.targetPitch = clamp(this.targetPitch - lookY, -pitchLimit, pitchLimit);
    this.yaw = damp(this.yaw, this.targetYaw, cfg.lookDamping, dt);
    this.pitch = damp(this.pitch, this.targetPitch, cfg.lookDamping, dt);

    // ---------------------------------------------------------------- move
    const f = input.moveForward;
    const r = input.moveRight;
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);

    if (this.mode === 'fly') {
      const cp = Math.cos(this.pitch);
      this._fwd.set(-sy * cp, Math.sin(this.pitch), -cy * cp);
      this._right.set(cy, 0, -sy);
      const speed = input.modifier ? cfg.flySlowSpeed : cfg.flySpeed;
      this._wish.set(0, 0, 0).addScaledVector(this._fwd, f).addScaledVector(this._right, r);
      if (this._wish.lengthSq() > 1) this._wish.normalize();
      this._wish.multiplyScalar(speed);
      this._wish.y += input.moveUp * (input.modifier ? cfg.flySlowSpeed : cfg.verticalSpeed);
      this.vel.x = damp(this.vel.x, this._wish.x, cfg.moveDamping, dt);
      this.vel.y = damp(this.vel.y, this._wish.y, cfg.moveDamping, dt);
      this.vel.z = damp(this.vel.z, this._wish.z, cfg.moveDamping, dt);
      this.pos.addScaledVector(this.vel, dt);
      this.bobAmount = damp(this.bobAmount, 0, 6, dt);
    } else {
      this._fwd.set(-sy, 0, -cy);
      this._right.set(cy, 0, -sy);
      const speed = input.modifier ? cfg.runSpeed : cfg.walkSpeed;
      this._wish.set(0, 0, 0).addScaledVector(this._fwd, f).addScaledVector(this._right, r);
      if (this._wish.lengthSq() > 1) this._wish.normalize();
      this._wish.multiplyScalar(speed);
      this.vel.x = damp(this.vel.x, this._wish.x, cfg.moveDamping, dt);
      this.vel.z = damp(this.vel.z, this._wish.z, cfg.moveDamping, dt);
      this.vel.y = 0;
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;

      // Glide back to eye height (e.g. after flying during the freeze).
      const planar = Math.hypot(this.vel.x, this.vel.z);
      this.bobPhase += dt * (5.5 + planar * 1.6) * Math.min(1, planar);
      this.bobAmount = damp(this.bobAmount, Math.min(1, planar / cfg.walkSpeed), 6, dt);
      this.pos.y = damp(this.pos.y, cfg.eyeHeight, cfg.returnDamping, dt);
      this._avoidHero();
    }

    this._clampBounds(dt, this.mode === 'fly');
    this._apply();
  }

  /** Soft push-out so the walker can't stand inside the burning car. */
  _avoidHero() {
    const dx = this.pos.x - this.focus.x;
    const dz = this.pos.z - this.focus.z;
    const d = Math.hypot(dx, dz);
    const minD = 2.6;
    if (d < minD && d > 1e-4) {
      const push = (minD - d) * 0.25;
      this.pos.x += (dx / d) * push;
      this.pos.z += (dz / d) * push;
    }
  }

  /** Soft bounds: springs back when the camera leaves the playable volume. */
  _clampBounds(dt, allowHeight) {
    const b = this.cfg.bounds;
    const k = 1 - Math.exp(-10 * dt);
    const p = this.pos;
    if (p.x < b.minX) p.x += (b.minX - p.x) * k;
    if (p.x > b.maxX) p.x += (b.maxX - p.x) * k;
    if (p.z < b.minZ) p.z += (b.minZ - p.z) * k;
    if (p.z > b.maxZ) p.z += (b.maxZ - p.z) * k;
    const maxY = allowHeight ? b.maxY : this.cfg.eyeHeight + 30;
    if (p.y < b.minY) p.y += (b.minY - p.y) * Math.min(1, k * 3);
    if (p.y > maxY) p.y += (maxY - p.y) * k;
    // Hard outer shell (never leave the set).
    p.x = clamp(p.x, b.minX - 1.2, b.maxX + 1.2);
    p.z = clamp(p.z, b.minZ - 2, b.maxZ + 2);
    p.y = clamp(p.y, 0.12, b.maxY + 2);
  }

  _apply() {
    const cam = this.camera;
    const bob = this.mode === 'walk' ? this.bobAmount * this.cfg.headBob : 0;
    cam.position.set(this.pos.x, this.pos.y + Math.sin(this.bobPhase * 2) * bob, this.pos.z);
    cam.rotation.set(this.pitch, this.yaw, Math.sin(this.bobPhase) * bob * 0.12, 'YXZ');
  }
}
