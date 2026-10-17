import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createRng } from '../utils/math.js';
import { addRimLight } from '../utils/materials.js';

/**
 * Stylised pedestrians with umbrellas (some with LED rims, a nod to neo-noir).
 * Rendered as 6 InstancedMeshes total; poses are recomputed from worldDelta,
 * so every walker halts mid-stride when time stops.
 */
export class Pedestrians {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'Pedestrians';
    scene.add(this.group);
    const n = CONFIG.world.pedestrians;
    const C = CONFIG.colors;
    const rng = createRng(4242);
    this.zRange = 72;

    const coatMat = addRimLight(new THREE.MeshStandardMaterial({ color: 0x16171c, roughness: 0.7, metalness: 0.05 }), 0x5fb7ff, 0.35, 2.5);
    const skinMat = new THREE.MeshStandardMaterial({ color: 0x2b211d, roughness: 0.6 });
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.1, side: THREE.DoubleSide, envMapIntensity: 1.2 });
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    const bodyGeo = new THREE.CapsuleGeometry(0.21, 0.72, 4, 10);
    bodyGeo.scale(1.08, 1, 0.8);
    const headGeo = new THREE.SphereGeometry(0.11, 12, 8);
    const legGeo = new THREE.CapsuleGeometry(0.068, 0.6, 3, 6);
    legGeo.translate(0, -0.37, 0);
    const canopyGeo = new THREE.SphereGeometry(0.62, 18, 6, 0, Math.PI * 2, 0, Math.PI * 0.32);
    const stickGeo = new THREE.CylinderGeometry(0.012, 0.012, 1.1, 5);
    const rimGeo = new THREE.TorusGeometry(0.523, 0.012, 4, 36);
    rimGeo.rotateX(Math.PI / 2);
    this.geometries = [bodyGeo, headGeo, legGeo, canopyGeo, stickGeo, rimGeo];
    this.materials = [coatMat, skinMat, canopyMat, ledMat];

    const mk = (geo, mat, count) => {
      const im = new THREE.InstancedMesh(geo, mat, count);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      this.group.add(im);
      return im;
    };
    this.body = mk(bodyGeo, coatMat, n);
    this.head = mk(headGeo, skinMat, n);
    this.legs = mk(legGeo, coatMat, n * 2);
    this.canopy = mk(canopyGeo, canopyMat, n);
    this.stick = mk(stickGeo, ledMat, n);
    this.rim = mk(rimGeo, ledMat, n);

    const sidewalkCenter = CONFIG.world.roadHalfWidth + CONFIG.world.sidewalkWidth / 2 + 0.2;
    const ledColors = [C.pink, C.cyan, C.amber, C.violet];
    const col = new THREE.Color();
    this.peds = [];
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const dir = rng() < 0.5 ? -1 : 1;
      const led = rng() < 0.45;
      const ped = {
        x: side * (sidewalkCenter + rng.range(-1.2, 1.2)),
        z: rng.range(-this.zRange, this.zRange),
        dir,
        speed: rng.range(1.0, 1.55),
        phase: rng() * 10,
        height: rng.range(0.94, 1.06),
      };
      this.peds.push(ped);
      if (led) {
        const c = rng.pick(ledColors);
        col.set(c).multiplyScalar(0.25);
        this.canopy.setColorAt(i, col);
        col.set(c).multiplyScalar(4);
        this.rim.setColorAt(i, col);
        this.stick.setColorAt(i, col.multiplyScalar(0.6));
      } else {
        col.set(rng.pick([0x0b0c10, 0x13151c, 0x1c0f14, 0x0f1820]));
        this.canopy.setColorAt(i, col);
        col.setRGB(0.02, 0.02, 0.025);
        this.rim.setColorAt(i, col);
        this.stick.setColorAt(i, col);
      }
    }
    this.canopy.instanceColor.needsUpdate = true;
    this.rim.instanceColor.needsUpdate = true;
    this.stick.instanceColor.needsUpdate = true;

    // scratch
    this._base = new THREE.Matrix4();
    this._local = new THREE.Matrix4();
    this._out = new THREE.Matrix4();
    this._rot = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._yAxis = new THREE.Vector3(0, 1, 0);
    this.update(0);
  }

  _set(mesh, index, x, y, z) {
    this._local.makeTranslation(x, y, z);
    this._out.multiplyMatrices(this._base, this._local);
    mesh.setMatrixAt(index, this._out);
  }

  update(worldDelta) {
    const span = this.zRange * 2;
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i];
      p.z += p.dir * p.speed * worldDelta;
      if (p.z > this.zRange) p.z -= span;
      if (p.z < -this.zRange) p.z += span;
      p.phase += worldDelta * p.speed * 3.4;
      const swing = Math.sin(p.phase) * 0.5;
      const bob = Math.abs(Math.cos(p.phase)) * 0.035;

      this._q.setFromAxisAngle(this._yAxis, p.dir > 0 ? 0 : Math.PI);
      this._s.set(p.height, p.height, p.height);
      this._base.compose(this._p.set(p.x, bob, p.z), this._q, this._s);

      this._set(this.body, i, 0, 1.12, 0);
      this._set(this.head, i, 0, 1.66, 0.02);
      this._set(this.canopy, i, 0.08, 1.64, 0.14);
      this._set(this.rim, i, 0.08, 1.97, 0.14);
      this._set(this.stick, i, 0.08, 1.68, 0.14);

      for (let k = 0; k < 2; k++) {
        const s = k === 0 ? swing : -swing;
        this._rot.makeRotationX(s);
        this._local.makeTranslation(k === 0 ? 0.1 : -0.1, 0.78, 0);
        this._local.multiply(this._rot);
        this._out.multiplyMatrices(this._base, this._local);
        this.legs.setMatrixAt(i * 2 + k, this._out);
      }
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.head.instanceMatrix.needsUpdate = true;
    this.legs.instanceMatrix.needsUpdate = true;
    this.canopy.instanceMatrix.needsUpdate = true;
    this.stick.instanceMatrix.needsUpdate = true;
    this.rim.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.group.children.forEach((c) => c.dispose && c.dispose());
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.scene.remove(this.group);
  }
}
