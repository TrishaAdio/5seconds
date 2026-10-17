import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createRng, damp } from '../utils/math.js';
import { createCar } from './carModel.js';
import { createBeamTexture } from '../utils/textures.js';

/**
 * Passing traffic. Each car integrates on worldDelta (so it freezes mid-lane),
 * keeps distance to the car ahead and brakes for the player standing in its
 * lane. Headlight/taillight glows, wet-road light pools and volumetric beams
 * are batched into three draw calls for the whole fleet.
 */
export class Traffic {
  constructor(scene, timeUniforms, glowTex) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'Traffic';
    scene.add(this.group);
    const W = CONFIG.world;
    this.L = W.streetHalfLength;
    const rng = createRng(77);
    const colors = [0x1b1d22, 0x9a9da3, 0x0e2a44, 0x5a0f16, 0xe8e8ea, 0x101012, 0x2b3a2e];

    this.cars = [];
    const n = W.trafficCars;
    for (let i = 0; i < n; i++) {
      const lane = W.lanes[i % 2];
      const dir = lane > 0 ? -1 : 1; // + lane drives away from the start camera
      const mesh = createCar(colors[i % colors.length]);
      mesh.rotation.y = dir < 0 ? Math.PI / 2 : -Math.PI / 2;
      const cruise = rng.range(11, 15.5);
      const car = {
        mesh,
        lane,
        dir,
        cruise,
        speed: cruise,
        z: -this.L + ((i * 2 + rng()) / (n * 2)) * this.L * 2,
        brake: 0,
      };
      mesh.position.set(lane, 0, car.z);
      this.group.add(mesh);
      this.cars.push(car);
    }

    // ------------------------------------------------- light glow sprites
    const glowCount = n * 4;
    this.glowPositions = new Float32Array(glowCount * 3);
    this.glowColors = new Float32Array(glowCount * 3);
    const gGeo = new THREE.BufferGeometry();
    gGeo.setAttribute('position', new THREE.BufferAttribute(this.glowPositions, 3).setUsage(THREE.DynamicDrawUsage));
    gGeo.setAttribute('color', new THREE.BufferAttribute(this.glowColors, 3).setUsage(THREE.DynamicDrawUsage));
    this.glow = new THREE.Points(
      gGeo,
      new THREE.PointsMaterial({ map: glowTex, size: 1.5, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.glow.frustumCulled = false;
    this.group.add(this.glow);

    // --------------------------------------------- headlight pools on road
    this.beamTex = createBeamTexture();
    const poolGeo = new THREE.PlaneGeometry(3.2, 9);
    poolGeo.rotateX(-Math.PI / 2);
    poolGeo.translate(0, 0.012, -4.5); // extends forward along -z (local)
    this.pools = new THREE.InstancedMesh(
      poolGeo,
      new THREE.MeshBasicMaterial({ map: this.beamTex, color: new THREE.Color(1, 0.95, 0.85).multiplyScalar(0.55), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      n
    );
    this.pools.frustumCulled = false;
    this.pools.renderOrder = -5;
    this.group.add(this.pools);

    // ------------------------------------------------ volumetric beams
    const beamLen = 14;
    const beamGeo = new THREE.CylinderGeometry(0.08, 1.6, beamLen, 16, 1, true);
    beamGeo.translate(0, -beamLen / 2, 0);
    beamGeo.rotateX(Math.PI / 2); // apex at origin, cone opens toward local -z (forward)
    this.beams = new THREE.InstancedMesh(
      beamGeo,
      new THREE.ShaderMaterial({
        name: 'HeadlightBeam',
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uColor: { value: new THREE.Color(1, 0.95, 0.85).multiplyScalar(0.06) }, uLen: { value: beamLen } },
        vertexShader: /* glsl */ `
          uniform float uLen;
          varying float vT;
          varying vec3 vN;
          varying vec3 vW;
          void main() {
            mat4 im = mat4(1.0);
            #ifdef USE_INSTANCING
              im = instanceMatrix;
            #endif
            vec4 w = modelMatrix * im * vec4(position, 1.0);
            vW = w.xyz;
            vT = clamp(-position.z / uLen, 0.0, 1.0);
            vN = normalize(mat3(modelMatrix * im) * normal);
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          varying float vT;
          varying vec3 vN;
          varying vec3 vW;
          void main() {
            vec3 V = normalize(cameraPosition - vW);
            float edge = pow(abs(dot(normalize(vN), V)), 2.0);
            float a = edge * pow(1.0 - vT, 2.0) * smoothstep(0.0, 0.05, vT);
            gl_FragColor = vec4(uColor * a, 1.0);
          }`,
      }),
      n * 2
    );
    this.beams.frustumCulled = false;
    this.group.add(this.beams);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
    this._p = new THREE.Vector3();
    this._yAxis = new THREE.Vector3(0, 1, 0);
  }

  /** Signed distance ahead of `car` to world z, wrapped around the loop. */
  _ahead(car, z) {
    const span = this.L * 2;
    let d = (z - car.z) * car.dir;
    d = ((d % span) + span) % span;
    return d;
  }

  update(worldDelta, cameraPos) {
    const cars = this.cars;
    const span = this.L * 2;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      let gap = 1e9;
      for (let j = 0; j < cars.length; j++) {
        if (j === i || cars[j].lane !== c.lane) continue;
        const d = this._ahead(c, cars[j].z);
        if (d < gap) gap = d;
      }
      if (Math.abs(cameraPos.x - c.lane) < 1.9 && cameraPos.y < 3.5) {
        const d = this._ahead(c, cameraPos.z) - 2.4;
        if (d >= -1 && d < gap) gap = Math.max(0, d);
      }
      const desired = c.cruise * Math.min(1, Math.max(0, (gap - 7) / 14));
      const braking = desired < c.speed - 0.5;
      c.speed = damp(c.speed, desired, braking ? 2.8 : 0.7, worldDelta);
      c.brake = damp(c.brake, braking ? 1 : 0, 6, worldDelta);
      c.z += c.dir * c.speed * worldDelta;
      if (c.z > this.L) c.z -= span;
      if (c.z < -this.L) c.z += span;
      c.mesh.position.set(c.lane, 0, c.z);
    }
    this._writeLights();
  }

  _writeLights() {
    const pos = this.glowPositions;
    const col = this.glowColors;
    const m = this._m;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      const fz = c.z + c.dir * 2.32;
      const rz = c.z - c.dir * 2.32;
      const o = i * 12;
      // headlights
      pos[o] = c.lane - 0.62; pos[o + 1] = 0.74; pos[o + 2] = fz;
      pos[o + 3] = c.lane + 0.62; pos[o + 4] = 0.74; pos[o + 5] = fz;
      // taillights
      pos[o + 6] = c.lane - 0.7; pos[o + 7] = 0.8; pos[o + 8] = rz;
      pos[o + 9] = c.lane + 0.7; pos[o + 10] = 0.8; pos[o + 11] = rz;
      const hb = 2.2;
      const tb = 0.9 + c.brake * 1.8;
      for (let k = 0; k < 2; k++) {
        col[o + k * 3] = hb; col[o + k * 3 + 1] = hb * 0.95; col[o + k * 3 + 2] = hb * 0.85;
        col[o + 6 + k * 3] = tb; col[o + 6 + k * 3 + 1] = tb * 0.05; col[o + 6 + k * 3 + 2] = tb * 0.07;
      }
      // pools & beams face driving direction (local -z forward)
      this._q.setFromAxisAngle(this._yAxis, c.dir > 0 ? Math.PI : 0);
      m.compose(this._p.set(c.lane, 0, fz), this._q, this._s);
      this.pools.setMatrixAt(i, m);
      m.compose(this._p.set(c.lane - 0.62, 0.74, fz), this._q, this._s);
      this.beams.setMatrixAt(i * 2, m);
      m.compose(this._p.set(c.lane + 0.62, 0.74, fz), this._q, this._s);
      this.beams.setMatrixAt(i * 2 + 1, m);
    }
    this.glow.geometry.attributes.position.needsUpdate = true;
    this.glow.geometry.attributes.color.needsUpdate = true;
    this.pools.instanceMatrix.needsUpdate = true;
    this.beams.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.group.traverse((o) => {
      // car geometry/materials are shared and disposed by carModel
      if (o === this.glow || o === this.pools || o === this.beams) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
    this.beamTex.dispose();
    this.scene.remove(this.group);
  }
}
