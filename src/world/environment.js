import * as THREE from 'three';
import { CONFIG } from '../config.js';

/**
 * Sky dome, fog, image-based lighting and ambient fill.
 * The env map is rendered once from a tiny procedural "neon room" so wet
 * surfaces pick up pink/cyan/amber glints without any downloaded HDRI.
 */
export class Environment {
  constructor(scene, renderer, timeUniforms) {
    this.scene = scene;
    const C = CONFIG.colors;

    scene.background = new THREE.Color(C.skyTop);
    scene.fog = new THREE.FogExp2(C.fog, CONFIG.world.fogDensity);

    // ------------------------------------------------------------ sky dome
    const skyMat = new THREE.ShaderMaterial({
      name: 'SkyDome',
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(C.skyTop) },
        uHorizon: { value: new THREE.Color(C.skyHorizon) },
        uWorldTime: timeUniforms.uWorldTime,
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform float uWorldTime;
        varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0; float a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
          return v;
        }
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uTop, pow(h, 0.45));
          // low clouds lit from below by the city; drift freezes with world time
          vec2 uv = vDir.xz / max(vDir.y + 0.15, 0.05);
          float c = fbm(uv * 0.6 + vec2(uWorldTime * 0.012, uWorldTime * 0.004));
          c = smoothstep(0.45, 0.85, c) * (1.0 - smoothstep(0.1, 0.7, h));
          col += c * vec3(0.10, 0.045, 0.12);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(380, 32, 16), skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -100;
    scene.add(this.sky);

    // ------------------------------------------------------- env map (IBL)
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x020308);
    const panel = (color, intensity, w, h, x, y, z) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide })
      );
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      envScene.add(m);
      return m;
    };
    panel(C.pink, 3.5, 3, 6, -8, 3, -4);
    panel(C.cyan, 3.0, 3, 5, 8, 2, 3);
    panel(C.amber, 2.5, 6, 2, 0, 5, 9);
    panel(C.violet, 2.0, 8, 3, 0, 4, -9);
    panel(0xffffff, 0.6, 12, 1, 0, 9, 0);
    panel(C.skyHorizon, 1.2, 30, 6, 0, 0, -14);
    const envRT = pmrem.fromScene(envScene, 0.035);
    this.envRT = envRT;
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.85;
    envScene.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
    pmrem.dispose();

    // ---------------------------------------------------------- fill light
    this.hemi = new THREE.HemisphereLight(0x2a3d66, 0x120810, 0.9);
    scene.add(this.hemi);
  }

  update(camera) {
    this.sky.position.copy(camera.position);
  }

  dispose() {
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.envRT.dispose();
    this.scene.remove(this.sky, this.hemi);
  }
}
