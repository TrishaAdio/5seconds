import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createRng } from '../utils/math.js';
import { createHazeTexture } from '../utils/textures.js';

/**
 * Ambient life: drifting paper/trash tumbling in the wind (integrated on
 * worldDelta) and large fake-volumetric haze sprites lit by the neon.
 */
export class Ambient {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'Ambient';
    scene.add(this.group);
    const rng = createRng(2024);
    const C = CONFIG.colors;

    // ------------------------------------------------------------ trash
    const n = CONFIG.world.trash;
    const paperGeo = new THREE.PlaneGeometry(0.22, 0.3, 2, 1);
    // slight crease
    const pp = paperGeo.attributes.position;
    for (let i = 0; i < pp.count; i++) if (Math.abs(pp.getX(i)) < 0.01) pp.setZ(i, 0.02);
    paperGeo.computeVertexNormals();
    this.paperGeo = paperGeo;
    this.paperMat = new THREE.MeshStandardMaterial({ color: 0xbfb8a8, roughness: 0.85, side: THREE.DoubleSide });
    this.paper = new THREE.InstancedMesh(paperGeo, this.paperMat, n);
    this.paper.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.paper.frustumCulled = false;
    const col = new THREE.Color();
    this.items = [];
    for (let i = 0; i < n; i++) {
      this.items.push({
        pos: new THREE.Vector3(rng.range(-10, 10), rng.range(0.02, 1.2), rng.range(-40, 25)),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(rng() * 6, rng() * 6, rng() * 6),
        spin: new THREE.Vector3(rng.range(-3, 3), rng.range(-3, 3), rng.range(-3, 3)),
        phase: rng() * 10,
        lift: rng.range(0.3, 1.6),
        seed: rng() * 100,
      });
      col.setHSL(0.1, 0.1, rng.range(0.35, 0.8));
      this.paper.setColorAt(i, col);
    }
    this.paper.instanceColor.needsUpdate = true;
    this.group.add(this.paper);

    // ------------------------------------------------------------ haze
    this.hazeTex = createHazeTexture(8);
    this.haze = [];
    const tints = [C.pink, C.cyan, C.amber, C.violet, 0x8899bb];
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.hazeTex,
        color: new THREE.Color(rng.pick(tints)).multiplyScalar(0.55),
        transparent: true,
        opacity: rng.range(0.25, 0.5),
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const s = new THREE.Sprite(mat);
      const scale = rng.range(10, 20);
      s.scale.set(scale * 1.6, scale, 1);
      s.position.set(rng.range(-9, 9), rng.range(1.5, 7), rng.range(-70, 40));
      s.userData.base = s.position.clone();
      s.userData.seed = rng() * 10;
      this.group.add(s);
      this.haze.push(s);
    }

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._one = new THREE.Vector3(1, 1, 1);
    this.update(0, 0);
  }

  update(worldDelta, worldTime) {
    const wind = CONFIG.world.wind;
    const gust = 0.6 + 0.4 * Math.sin(worldTime * 0.37) + 0.3 * Math.sin(worldTime * 1.13);
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const tx = wind.x * 1.6 * gust + Math.sin(worldTime * 0.9 + it.seed) * 0.8;
      const tz = wind.z * 1.6 * gust + Math.cos(worldTime * 0.7 + it.seed) * 0.8;
      const k = 1 - Math.exp(-1.4 * worldDelta);
      it.vel.x += (tx - it.vel.x) * k;
      it.vel.z += (tz - it.vel.z) * k;
      it.pos.x += it.vel.x * worldDelta;
      it.pos.z += it.vel.z * worldDelta;
      it.phase += worldDelta * (1.2 + gust);
      it.pos.y = 0.02 + Math.abs(Math.sin(it.phase)) * it.lift * gust * 0.6;
      it.rot.x += it.spin.x * worldDelta * gust;
      it.rot.y += it.spin.y * worldDelta * gust;
      it.rot.z += it.spin.z * worldDelta * gust;
      if (it.pos.x < -10.5) it.pos.x += 21;
      if (it.pos.x > 10.5) it.pos.x -= 21;
      if (it.pos.z < -40) it.pos.z += 65;
      if (it.pos.z > 25) it.pos.z -= 65;
      this._q.setFromEuler(it.rot);
      this._m.compose(it.pos, this._q, this._one);
      this.paper.setMatrixAt(i, this._m);
    }
    this.paper.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < this.haze.length; i++) {
      const s = this.haze[i];
      const b = s.userData.base;
      const sd = s.userData.seed;
      s.position.set(b.x + Math.sin(worldTime * 0.05 + sd) * 2.5, b.y + Math.sin(worldTime * 0.08 + sd * 2) * 0.6, b.z);
      s.material.rotation = Math.sin(worldTime * 0.03 + sd) * 0.3;
    }
  }

  dispose() {
    this.paper.dispose();
    this.paperGeo.dispose();
    this.paperMat.dispose();
    this.haze.forEach((s) => s.material.dispose());
    this.hazeTex.dispose();
    this.scene.remove(this.group);
  }
}
