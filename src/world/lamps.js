import * as THREE from 'three';
import { CONFIG } from '../config.js';

/**
 * Sodium street lamps: instanced poles/arms/heads, fake volumetric light
 * cones (additive, fresnel-softened, with drifting rain-dust that halts on
 * freeze), glow sprites, and real point lights on the lamps nearest the action.
 */
export class StreetLamps {
  constructor(scene, timeUniforms, glowTex) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'StreetLamps';
    scene.add(this.group);

    const C = CONFIG.colors;
    const poleX = CONFIG.world.roadHalfWidth + 3.3; // on the sidewalk
    const height = 6.6;
    const armLen = 1.8;
    const positions = [];
    let i = 0;
    for (let z = -99; z <= 99; z += 17, i++) {
      const side = i % 2 === 0 ? -1 : 1;
      positions.push({ side, z });
    }
    this.positions = positions;
    const n = positions.length;

    const metal = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.45, metalness: 0.8 });
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.1, height, 8);
    poleGeo.translate(0, height / 2, 0);
    const armGeo = new THREE.BoxGeometry(armLen, 0.08, 0.08);
    const headGeo = new THREE.BoxGeometry(0.7, 0.14, 0.32);
    const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(C.lamp).multiplyScalar(6) });

    this.poles = new THREE.InstancedMesh(poleGeo, metal, n);
    this.arms = new THREE.InstancedMesh(armGeo, metal, n);
    this.heads = new THREE.InstancedMesh(headGeo, headMat, n);

    // light cone: open cylinder, apex at the lamp head
    const coneH = height - 0.15;
    const coneGeo = new THREE.CylinderGeometry(0.22, 3.0, coneH, 32, 1, true);
    coneGeo.translate(0, -coneH / 2, 0);
    const coneMat = new THREE.ShaderMaterial({
      name: 'LampCone',
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: new THREE.Color(C.lamp).multiplyScalar(0.11) },
        uWorldTime: timeUniforms.uWorldTime,
        uHeight: { value: coneH },
      },
      vertexShader: /* glsl */ `
        varying float vH;
        varying vec3 vNormalW;
        varying vec3 vWorld;
        uniform float uHeight;
        void main() {
          vec4 local = vec4(position, 1.0);
          mat4 im = mat4(1.0);
          #ifdef USE_INSTANCING
            im = instanceMatrix;
          #endif
          vec4 world = modelMatrix * im * local;
          vWorld = world.xyz;
          vH = -position.y / uHeight; // 0 at lamp, 1 at ground
          vNormalW = normalize(mat3(modelMatrix * im) * normal);
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uWorldTime;
        varying float vH;
        varying vec3 vNormalW;
        varying vec3 vWorld;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(17.1, 113.7, 41.3))) * 43758.5453); }
        void main() {
          vec3 V = normalize(cameraPosition - vWorld);
          float edge = pow(abs(dot(normalize(vNormalW), V)), 1.6);
          float fall = pow(1.0 - vH, 1.4) * smoothstep(1.0, 0.85, vH);
          // falling rain specks caught in the beam (freeze with world time)
          vec3 q = vec3(vWorld.x * 9.0, vWorld.y * 2.2 + uWorldTime * 38.0, vWorld.z * 9.0);
          float speck = step(0.985, hash(floor(q))) * 2.5;
          float a = edge * fall * (1.0 + speck);
          gl_FragColor = vec4(uColor * a, 1.0);
        }`,
    });
    this.cones = new THREE.InstancedMesh(coneGeo, coneMat, n);
    this.cones.frustumCulled = false;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const glowPos = [];
    positions.forEach((lp, k) => {
      const x = lp.side * poleX;
      const headX = x - lp.side * (armLen - 0.1);
      q.identity();
      m.compose(p.set(x, 0, lp.z), q, s);
      this.poles.setMatrixAt(k, m);
      m.compose(p.set(x - lp.side * armLen * 0.5, height - 0.05, lp.z), q, s);
      this.arms.setMatrixAt(k, m);
      m.compose(p.set(headX, height - 0.15, lp.z), q, s);
      this.heads.setMatrixAt(k, m);
      m.compose(p.set(headX, height - 0.22, lp.z), q, s);
      this.cones.setMatrixAt(k, m);
      glowPos.push(headX, height - 0.3, lp.z);
      lp.head = new THREE.Vector3(headX, height - 0.35, lp.z);
    });
    for (const im of [this.poles, this.arms, this.heads, this.cones]) {
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      this.group.add(im);
    }

    const gGeo = new THREE.BufferGeometry();
    gGeo.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3));
    this.glow = new THREE.Points(
      gGeo,
      new THREE.PointsMaterial({
        map: glowTex,
        color: new THREE.Color(C.lamp).multiplyScalar(1.6),
        size: 3.2,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.group.add(this.glow);

    // Real lights only on the four lamps closest to the hero moment.
    const sorted = [...positions].sort((a, b) => Math.abs(a.z) - Math.abs(b.z)).slice(0, 4);
    this.lights = sorted.map((lp) => {
      const l = new THREE.PointLight(C.lamp, 190, 32, 2);
      l.position.copy(lp.head);
      this.group.add(l);
      return l;
    });
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.scene.remove(this.group);
  }
}
