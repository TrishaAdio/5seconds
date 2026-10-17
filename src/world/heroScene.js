import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createRng, easeOutCubic, smoothstep, noise1, clamp } from '../utils/math.js';
import { createCar } from './carModel.js';
import { Character } from './character.js';
import { addRimLight } from '../utils/materials.js';

/**
 * THE HERO MOMENT: a car detonates in the middle of the street, flips, and
 * hurls its door, a tyre, metal debris and a cloud of glass outward, while a
 * figure dives clear.
 *
 * The whole event is driven by a single "hero clock" T (seconds since the
 * last detonation) that advances ONLY by worldDelta. Every object below is a
 * closed-form function of T, which is what makes it freeze perfectly and
 * remain rock-stable while the camera flies through it.
 *
 * To add a new frozen object: compute its transform from T (or worldTime) in
 * update(), never from a local accumulator that ignores timeScale.
 */
const G = 9.8;

export class HeroScene {
  constructor(scene, timeUniforms, heroUniforms) {
    this.scene = scene;
    this.cfg = CONFIG.hero;
    this.uniforms = heroUniforms;
    this.group = new THREE.Group();
    this.group.name = 'HeroScene';
    scene.add(this.group);

    this.origin = new THREE.Vector3().fromArray(this.cfg.position);
    this.focus = new THREE.Vector3(this.origin.x, this.origin.y + this.cfg.focusOffsetY, this.origin.z);
    this.heroT = this.cfg.period - 2.2; // first detonation shortly after load
    this.cycle = 0;
    this._listeners = [];
    this.geometries = [];
    this.materials = [];

    const yaw = this.cfg.yaw;
    this.yaw = yaw;
    this.front = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    this.sideV = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));

    // ------------------------------------------------------------- car
    this.bodyMat = addRimLight(
      new THREE.MeshPhysicalMaterial({ color: 0x4a0b10, roughness: 0.4, metalness: 0.7, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 1.2 }),
      0xff7a3a,
      0.5,
      3
    );
    this.materials.push(this.bodyMat);
    this.carOuter = new THREE.Group();
    this.carOuter.position.copy(this.origin);
    this.carOuter.rotation.y = yaw;
    this.carPivot = new THREE.Group();
    this.carPivot.position.y = 0.75;
    const car = createCar(0x4a0b10, { bodyMaterial: this.bodyMat, lights: false });
    car.position.y = -0.75;
    this.carPivot.add(car);
    this.carOuter.add(this.carPivot);
    this.group.add(this.carOuter);
    this.burstOrigin = new THREE.Vector3().copy(this.origin).add(new THREE.Vector3(0, 0.85, 0));
    this.uniforms.uBurstOrigin.value.copy(this.burstOrigin);

    // scorch mark
    const scorchMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.75, depthWrite: false });
    scorchMat.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader.replace(
        '#include <opaque_fragment>',
        'float rr = length(vUvS - 0.5) * 2.0; diffuseColor.a *= smoothstep(1.0, 0.2, rr);\n#include <opaque_fragment>'
      );
      s.fragmentShader = 'varying vec2 vUvS;\n' + s.fragmentShader;
      s.vertexShader = 'varying vec2 vUvS;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvUvS = uv;');
    };
    const scorchGeo = new THREE.PlaneGeometry(9, 9);
    scorchGeo.rotateX(-Math.PI / 2);
    this.scorch = new THREE.Mesh(scorchGeo, scorchMat);
    this.scorch.position.set(this.origin.x, 0.006, this.origin.z);
    this.scorch.renderOrder = -9;
    this.group.add(this.scorch);
    this.geometries.push(scorchGeo);
    this.materials.push(scorchMat);

    // ------------------------------------------------ flying pieces
    const rng = createRng(31337);
    const P = CONFIG.particles;
    this.debris = this._createPieces(rng, P.debris, {
      geo: new THREE.BoxGeometry(1, 1, 1),
      mat: new THREE.MeshStandardMaterial({ color: 0x1a1a1d, roughness: 0.5, metalness: 0.85, envMapIntensity: 1.1 }),
      scale: () => [rng.range(0.06, 0.32), rng.range(0.02, 0.1), rng.range(0.06, 0.4)],
      spawn: (out) => out.set(rng.range(-1.9, 1.9), rng.range(0.4, 1.2), rng.range(-0.8, 0.8)),
      speed: () => rng.range(4, 13),
      up: () => rng.range(2.5, 8.5),
    });
    const shardGeo = new THREE.BufferGeometry();
    shardGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.5, 0, -0.45, -0.4, 0.02, 0.5, -0.3, -0.02], 3));
    shardGeo.computeVertexNormals();
    this.glass = this._createPieces(rng, P.glass, {
      geo: shardGeo,
      mat: new THREE.MeshStandardMaterial({
        color: 0xd8f4ff,
        roughness: 0.04,
        metalness: 1.0,
        envMapIntensity: 3.2,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        emissive: 0x3a6a88,
        emissiveIntensity: 0.35,
      }),
      scale: () => {
        const s = rng.range(0.05, 0.2);
        return [s, s * rng.range(0.7, 1.4), 1];
      },
      spawn: (out) => out.set(rng.range(-1.2, 0.9), rng.range(1.0, 1.45), rng.range(-0.85, 0.85)),
      speed: () => rng.range(3, 12),
      up: () => rng.range(2, 9),
      rest: 0.01,
    });

    // door + tyre (hand-placed "hero" debris)
    const doorGeo = new THREE.BoxGeometry(1.15, 0.85, 0.07);
    this.geometries.push(doorGeo);
    this.door = new THREE.Mesh(doorGeo, this.bodyMat);
    this.group.add(this.door);
    this.doorPiece = this._makePiece(
      new THREE.Vector3(0.25, 0.85, 0.95),
      new THREE.Vector3(1.8, 7.5, 7.0),
      new THREE.Vector3(0.3, 1, 0.5).normalize(),
      7.5,
      0.04
    );
    const tyreGeo = new THREE.TorusGeometry(0.3, 0.12, 8, 20);
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.85 });
    this.geometries.push(tyreGeo);
    this.materials.push(tyreMat);
    this.tyre = new THREE.Mesh(tyreGeo, tyreMat);
    this.group.add(this.tyre);
    this.tyrePiece = this._makePiece(
      new THREE.Vector3(1.45, 0.4, -0.86),
      new THREE.Vector3(5.5, 9.5, -2.5),
      new THREE.Vector3(1, 0.2, 0.1).normalize(),
      11,
      0.12
    );

    // ------------------------------------------------------- blast core
    const coreGeo = new THREE.IcosahedronGeometry(1, 4);
    this.geometries.push(coreGeo);
    this.coreMat = new THREE.ShaderMaterial({
      name: 'BlastCore',
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uHeroT: heroUniforms.uHeroT, uFade: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform float uHeroT;
        varying vec3 vN;
        varying vec3 vW;
        varying float vNoise;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(17.1, 113.7, 41.3))) * 43758.5453); }
        float vnoise(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        void main() {
          float n = vnoise(position * 2.6 + uHeroT * 2.0) * 0.6 + vnoise(position * 5.3 - uHeroT * 3.0) * 0.4;
          vNoise = n;
          vec3 p = position * (0.75 + n * 0.55);
          vec4 w = modelMatrix * vec4(p, 1.0);
          vW = w.xyz;
          vN = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uHeroT;
        uniform float uFade;
        varying vec3 vN;
        varying vec3 vW;
        varying float vNoise;
        vec3 ramp(float t) {
          vec3 a = vec3(7.0, 5.5, 3.0), b = vec3(5.0, 1.9, 0.35), c = vec3(1.4, 0.25, 0.05);
          return t < 0.5 ? mix(a, b, t * 2.0) : mix(b, c, (t - 0.5) * 2.0);
        }
        void main() {
          vec3 V = normalize(cameraPosition - vW);
          float facing = abs(dot(normalize(vN), V));
          float age = clamp(uHeroT / 1.1, 0.0, 1.0);
          vec3 col = ramp(clamp(age * 0.8 + (1.0 - vNoise) * 0.5, 0.0, 1.0));
          float a = pow(facing, 1.2) * (0.35 + vNoise) * uFade;
          gl_FragColor = vec4(col * a * 0.07, 1.0);
        }`,
    });
    this.materials.push(this.coreMat);
    this.core = new THREE.Mesh(coreGeo, this.coreMat);
    this.core.frustumCulled = false;
    this.group.add(this.core);

    // --------------------------------------------------------- shock ring
    const ringGeo = new THREE.RingGeometry(0.85, 1, 64);
    ringGeo.rotateX(-Math.PI / 2);
    this.geometries.push(ringGeo);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.materials.push(this.ringMat);
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.position.set(this.origin.x, 0.08, this.origin.z);
    this.group.add(this.ring);

    // ---------------------------------------------------------- fire light
    this.fireLight = new THREE.PointLight(0xff7a2a, 150, 42, 2);
    this.group.add(this.fireLight);

    // ----------------------------------------------------------- character
    this.character = new Character(this.cfg.characterStart, this.cfg.characterEnd);
    this.group.add(this.character.root);

    // scratch
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._wreck = new THREE.Vector3();

    this.update(0, 0);
  }

  onDetonate(fn) {
    this._listeners.push(fn);
  }

  /** Builds one analytic ballistic piece (positions in hero-local space). */
  _makePiece(localPos, localVel, axis, spin, rest) {
    const p0 = localPos.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).add(this.origin);
    const v = localVel.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const tHit = (v.y + Math.sqrt(v.y * v.y + 2 * G * Math.max(0, p0.y - rest))) / G;
    return { p0, v, axis, spin, rest, tHit };
  }

  _createPieces(rng, count, { geo, mat, scale, spawn, speed, up, rest = null }) {
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.geometries.push(geo);
    this.materials.push(mat);
    const pieces = [];
    const lp = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      spawn(lp);
      const out = new THREE.Vector3(lp.x, 0, lp.z);
      if (out.lengthSq() < 1e-4) out.set(1, 0, 0);
      out.normalize().multiplyScalar(speed());
      out.y = up();
      const sc = scale();
      const axis = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
      const piece = this._makePiece(lp, out, axis, rng.range(4, 18) * (rng() < 0.5 ? -1 : 1), rest ?? sc[1] * 0.5);
      piece.scale = new THREE.Vector3(sc[0], sc[1], sc[2]);
      pieces.push(piece);
    }
    return { mesh, pieces, max: count };
  }

  /** Writes the closed-form state of a piece at hero time T into _p/_q. */
  _evalPiece(pc, T) {
    let t = T;
    if (t <= pc.tHit) {
      this._p.set(pc.p0.x + pc.v.x * t, pc.p0.y + pc.v.y * t - 0.5 * G * t * t, pc.p0.z + pc.v.z * t);
      this._q.setFromAxisAngle(pc.axis, pc.spin * t);
    } else {
      const dt = t - pc.tHit;
      const slide = (1 - Math.exp(-5 * dt)) / 5;
      t = pc.tHit;
      this._p.set(pc.p0.x + pc.v.x * (t + slide * 0.35), pc.rest, pc.p0.z + pc.v.z * (t + slide * 0.35));
      this._q.setFromAxisAngle(pc.axis, pc.spin * (t + slide * 0.2));
    }
  }

  _writePieces(set, T) {
    const { mesh, pieces } = set;
    const n = mesh.count;
    for (let i = 0; i < n; i++) {
      const pc = pieces[i];
      this._evalPiece(pc, T);
      this._m.compose(this._p, this._q, pc.scale);
      mesh.setMatrixAt(i, this._m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  setDensity(fraction) {
    this.debris.mesh.count = Math.max(10, Math.floor(this.debris.max * fraction));
    this.glass.mesh.count = Math.max(10, Math.floor(this.glass.max * fraction));
  }

  _detonate(synced) {
    this.cycle++;
    for (const fn of this._listeners) fn(this.burstOrigin, synced);
  }

  /**
   * Director's sync: called at the instant time-stop is triggered. If the
   * explosion is already spent, cue a fresh detonation (hidden by the freeze
   * flash) so the frozen frame always contains the money shot.
   */
  syncForFreeze() {
    if (!this.cfg.syncOnFreeze) return false;
    if (this.heroT > this.cfg.syncThreshold) {
      this.heroT = this.cfg.syncTime;
      this._detonate(true);
      return true;
    }
    return false;
  }

  update(worldDelta, worldTime) {
    this.heroT += worldDelta;
    while (this.heroT >= this.cfg.period) {
      this.heroT -= this.cfg.period;
      this._detonate(false);
    }
    const T = this.heroT;
    this.uniforms.uHeroT.value = T;

    // ------------------------------------------------ car flip
    const vUp = 6.2;
    const tAir = vUp / 4.9;
    const air = T < tAir ? vUp * T - 4.9 * T * T : 0;
    const roll = Math.PI * 2 * smoothstep(0, tAir, T);
    this.carOuter.position.y = Math.max(0, air);
    this.carPivot.rotation.x = roll;
    this.carPivot.position.y = 0.75 + Math.sin(roll * 0.5) * 0.35;

    // wreck fire follows the engine bay
    this._wreck.copy(this.origin).addScaledVector(this.front, 0.9);
    this._wreck.y = this.carOuter.position.y + 0.85;
    this.uniforms.uWreckOrigin.value.copy(this._wreck);

    // ------------------------------------------------ debris
    this._writePieces(this.debris, T);
    this._writePieces(this.glass, T);
    this._evalPiece(this.doorPiece, T);
    this.door.position.copy(this._p);
    this.door.quaternion.copy(this._q);
    this._evalPiece(this.tyrePiece, T);
    this.tyre.position.copy(this._p);
    this.tyre.quaternion.copy(this._q);
    // door is on the car until it detaches at T=0 (always detached after)

    // ------------------------------------------------ blast core & ring
    const coreLife = 1.15;
    this.core.visible = T < coreLife;
    if (this.core.visible) {
      const s = 0.6 + 4.0 * easeOutCubic(T / 0.95);
      this.core.scale.setScalar(s);
      this.core.position.set(this.burstOrigin.x, this.burstOrigin.y + T * 1.3 + s * 0.25, this.burstOrigin.z);
      this.coreMat.uniforms.uFade.value = (1 - smoothstep(0.25, coreLife, T)) * smoothstep(0, 0.03, T);
    }
    const ringLife = 0.85;
    this.ring.visible = T < ringLife;
    if (this.ring.visible) {
      const u = T / ringLife;
      this.ring.scale.setScalar(0.5 + 17 * easeOutCubic(u));
      const k = (1 - u) * (1 - u) * 2.5;
      this.ringMat.color.setRGB(k * 1.0, k * 0.65, k * 0.4);
    }

    // ------------------------------------------------ fire light
    const flicker = 0.78 + 0.22 * noise1(worldTime * 9.0) + 0.1 * noise1(worldTime * 23.0);
    const flash = 1600 * Math.exp(-T * 7.0) * (T < 2 ? 1 : 0);
    this.fireLight.intensity = 140 * flicker + flash;
    this.fireLight.position.set(this._wreck.x, this._wreck.y + 1.0, this._wreck.z);

    // ------------------------------------------------ character
    this.character.update(T);
  }

  /** 0..1 how "explosive" the current frame is (for camera shake, audio). */
  get blastEnergy() {
    return clamp(Math.exp(-this.heroT * 3.0), 0, 1);
  }

  dispose() {
    this.debris.mesh.dispose();
    this.glass.mesh.dispose();
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.character.dispose();
    this.scene.remove(this.group);
  }
}
