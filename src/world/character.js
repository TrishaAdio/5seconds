import * as THREE from 'three';
import { addRimLight } from '../utils/materials.js';
import { clamp, smoothstep, lerp } from '../utils/math.js';

/**
 * Procedural articulated silhouette performing an action-movie dive away
 * from the explosion. The pose is a pure function of the hero clock T, so it
 * freezes perfectly mid-air.
 *
 * Local facing is +Z. Joint rotations are in radians around local X
 * (negative = limb swings forward).
 */
const D = Math.PI / 180;

// Keyframed poses: [time, pose]
const POSES = [
  [0.0, { pitch: 18, lift: 0.86, torso: 10, head: -10, shL: 40, elL: -60, shR: 50, elR: -70, hipL: -55, knL: 80, hipR: -20, knR: 40, spread: 12 }],
  [0.14, { pitch: 42, lift: 0.9, torso: 6, head: -30, shL: -120, elL: -20, shR: -100, elR: -30, hipL: -10, knL: 20, hipR: 35, knR: 30, spread: 10 }],
  [0.5, { pitch: 80, lift: 0.62, torso: 4, head: -58, shL: -168, elL: -8, shR: -160, elR: -14, hipL: 6, knL: 18, hipR: -12, knR: 75, spread: 18 }],
  [0.95, { pitch: 70, lift: 0.6, torso: 8, head: -52, shL: -150, elL: -30, shR: -140, elR: -40, hipL: -10, knL: 40, hipR: -30, knR: 85, spread: 22 }],
  [1.22, { pitch: 30, lift: 0.5, torso: 30, head: -20, shL: -70, elL: -60, shR: -40, elR: -80, hipL: -95, knL: 125, hipR: -60, knR: 120, spread: 26 }],
  [1.7, { pitch: 8, lift: 0.52, torso: 26, head: 18, shL: -30, elL: -50, shR: -80, elR: -20, hipL: -105, knL: 135, hipR: -40, knR: 120, spread: 30 }],
];

export class Character {
  constructor(start, end) {
    this.start = new THREE.Vector3().fromArray(start);
    this.end = new THREE.Vector3().fromArray(end);
    this.root = new THREE.Group();
    this.root.name = 'HeroCharacter';

    const mat = addRimLight(new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.55, metalness: 0.2 }), 0x7fd8ff, 1.4, 2.2);
    const skin = addRimLight(new THREE.MeshStandardMaterial({ color: 0x1d1612, roughness: 0.6 }), 0xffb07a, 0.8, 2.5);
    this.materials = [mat, skin];
    const geos = {
      torso: new THREE.CapsuleGeometry(0.17, 0.42, 4, 10),
      head: new THREE.SphereGeometry(0.115, 14, 10),
      upper: new THREE.CapsuleGeometry(0.058, 0.22, 3, 8),
      fore: new THREE.CapsuleGeometry(0.05, 0.22, 3, 8),
      thigh: new THREE.CapsuleGeometry(0.078, 0.34, 3, 8),
      shin: new THREE.CapsuleGeometry(0.064, 0.36, 3, 8),
      coat: new THREE.CylinderGeometry(0.2, 0.3, 0.55, 12, 1, true),
    };
    this.geometries = Object.values(geos);
    const mesh = (g, m, y) => {
      const o = new THREE.Mesh(g, m);
      o.position.y = y;
      return o;
    };

    this.pelvis = new THREE.Group();
    this.root.add(this.pelvis);
    this.torso = new THREE.Group();
    this.pelvis.add(this.torso);
    this.torso.add(mesh(geos.torso, mat, 0.3));
    const coat = mesh(geos.coat, mat, -0.08);
    coat.material = mat;
    this.pelvis.add(coat);
    this.coat = coat;
    this.neck = new THREE.Group();
    this.neck.position.y = 0.62;
    this.torso.add(this.neck);
    this.neck.add(mesh(geos.head, skin, 0.1));

    const limb = (parent, x, y, upperGeo, lowerGeo, upperLen, m) => {
      const j1 = new THREE.Group();
      j1.position.set(x, y, 0);
      parent.add(j1);
      j1.add(mesh(upperGeo, m, -upperLen / 2));
      const j2 = new THREE.Group();
      j2.position.y = -upperLen;
      j1.add(j2);
      j2.add(mesh(lowerGeo, m, -upperLen / 2));
      return [j1, j2];
    };
    [this.shL, this.elL] = limb(this.torso, 0.23, 0.52, geos.upper, geos.fore, 0.3, mat);
    [this.shR, this.elR] = limb(this.torso, -0.23, 0.52, geos.upper, geos.fore, 0.3, mat);
    [this.hipL, this.knL] = limb(this.pelvis, 0.1, 0, geos.thigh, geos.shin, 0.46, mat);
    [this.hipR, this.knR] = limb(this.pelvis, -0.1, 0, geos.thigh, geos.shin, 0.46, mat);

    const dir = new THREE.Vector3().subVectors(this.end, this.start);
    this.yaw = Math.atan2(dir.x, dir.z);
    this._pose = { ...POSES[0][1] };
    this.update(0);
  }

  _samplePose(T) {
    let i = 0;
    while (i < POSES.length - 1 && T > POSES[i + 1][0]) i++;
    const [t0, a] = POSES[i];
    if (i === POSES.length - 1) return Object.assign(this._pose, a);
    const [t1, b] = POSES[i + 1];
    const u = smoothstep(0, 1, (T - t0) / (t1 - t0));
    for (const k in a) this._pose[k] = lerp(a[k], b[k], u);
    return this._pose;
  }

  /** T = hero cycle time (seconds since detonation). */
  update(T) {
    const pose = this._samplePose(T);
    // ballistic arc of the leap
    const airStart = 0.08;
    const airDur = 1.12;
    const u = clamp((T - airStart) / airDur, 0, 1);
    const arc = 4 * 1.25 * u * (1 - u);
    const slide = T > airStart + airDur ? smoothstep(0, 0.5, T - airStart - airDur) * 0.6 : 0;
    const k = smoothstep(0, 1, u);
    this.root.position.set(
      lerp(this.start.x, this.end.x, k) + Math.sin(this.yaw) * slide,
      0,
      lerp(this.start.z, this.end.z, k) + Math.cos(this.yaw) * slide
    );
    this.root.rotation.y = this.yaw + (T > 1.5 ? smoothstep(1.5, 2.2, T) * -2.4 : 0); // turns to look back

    this.pelvis.position.y = pose.lift + arc;
    this.pelvis.rotation.x = pose.pitch * D;
    this.torso.rotation.x = pose.torso * D;
    this.neck.rotation.x = pose.head * D;
    this.shL.rotation.set(pose.shL * D, 0, pose.spread * D);
    this.shR.rotation.set(pose.shR * D, 0, -pose.spread * D);
    this.elL.rotation.x = pose.elL * D;
    this.elR.rotation.x = pose.elR * D;
    this.hipL.rotation.set(pose.hipL * D, 0, pose.spread * 0.3 * D);
    this.hipR.rotation.set(pose.hipR * D, 0, -pose.spread * 0.3 * D);
    this.knL.rotation.x = pose.knL * D; // knees fold backward (+X)
    this.knR.rotation.x = pose.knR * D;
    // coat flares while airborne
    const flare = 1 + arc * 0.6;
    this.coat.scale.set(flare, 1, flare);
    this.coat.rotation.x = -arc * 0.4;
  }

  dispose() {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}
