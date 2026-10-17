import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createRng } from '../utils/math.js';

/**
 * GPU rain: up to 10k instanced, camera-facing streak quads.
 *
 * Every drop's position is a pure function of uWorldTime, wrapped in a box
 * that follows the camera — so when world time stops, every drop stops in
 * place and you can fly between them. Streak length is tied to uTimeScale
 * (motion blur), so frozen rain collapses into glinting suspended beads.
 */
export class Rain {
  constructor(scene, timeUniforms) {
    this.scene = scene;
    const W = CONFIG.world;
    const max = W.rainMax;
    const rng = createRng(9001);

    const base = new THREE.PlaneGeometry(1, 1, 1, 1);
    base.translate(0, 0.5, 0); // y in [0,1] along the streak
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);

    const offsets = new Float32Array(max * 3);
    const rand = new Float32Array(max * 2);
    for (let i = 0; i < max; i++) {
      offsets[i * 3] = rng();
      offsets[i * 3 + 1] = rng();
      offsets[i * 3 + 2] = rng();
      rand[i * 2] = rng();
      rand[i * 2 + 1] = rng();
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rand, 2));
    geo.instanceCount = max;
    this.baseGeo = base;
    this.geometry = geo;

    this.material = new THREE.ShaderMaterial({
      name: 'Rain',
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uWorldTime: timeUniforms.uWorldTime,
        uRealTime: timeUniforms.uRealTime,
        uTimeScale: timeUniforms.uTimeScale,
        uShimmer: timeUniforms.uShimmer,
        uFreeze: timeUniforms.uFreeze,
        uArea: { value: new THREE.Vector3(W.rainArea.x, W.rainArea.y, W.rainArea.z) },
        uWind: { value: new THREE.Vector3(W.wind.x, 0, W.wind.z) },
        uSpeed: { value: W.rainSpeed },
        uColor: { value: new THREE.Color(0.55, 0.65, 0.85) },
      },
      vertexShader: /* glsl */ `
        uniform float uWorldTime;
        uniform float uRealTime;
        uniform float uTimeScale;
        uniform float uShimmer;
        uniform vec3 uArea;
        uniform vec3 uWind;
        uniform float uSpeed;
        attribute vec3 aOffset;
        attribute vec2 aRand;
        varying float vAlpha;
        varying vec2 vQuad;
        varying float vTint;

        void main() {
          float speed = uSpeed * (0.8 + 0.4 * aRand.x);
          vec3 vel = vec3(uWind.x, -speed, uWind.z);

          // Box anchored around the camera; never below the street.
          vec3 origin = cameraPosition - uArea * vec3(0.5, 0.0, 0.5);
          origin.y = max(0.0, cameraPosition.y - uArea.y * 0.45);

          vec3 p = aOffset * uArea + vel * uWorldTime;
          p = mod(p - origin, uArea) + origin;

          vec3 dir = normalize(vel);
          float stretch = clamp(uTimeScale, 0.0, 1.3);
          float len = mix(0.035, 0.75, stretch) * (0.7 + 0.6 * aRand.y);
          float width = mix(0.014, 0.009, stretch);

          vec3 toCam = normalize(cameraPosition - p);
          vec3 side = normalize(cross(dir, toCam));
          vec3 wp = p + dir * (position.y - 0.5) * len + side * position.x * width;

          // the "held" freeze: a barely perceptible tremble
          wp += vec3(sin(uRealTime * 2.3 + aRand.x * 40.0), cos(uRealTime * 1.7 + aRand.y * 30.0), 0.0) * 0.004 * uShimmer;

          float d = length(p - cameraPosition);
          vAlpha = smoothstep(0.25, 1.6, d) * (1.0 - smoothstep(uArea.x * 0.3, uArea.x * 0.5, d));
          vQuad = vec2(position.x, position.y);
          vTint = aRand.y;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uTimeScale;
        uniform float uFreeze;
        varying float vAlpha;
        varying vec2 vQuad;
        varying float vTint;
        void main() {
          float stretch = clamp(uTimeScale, 0.0, 1.0);
          float across = 1.0 - abs(vQuad.x * 2.0);
          float tail = mix(1.0, mix(0.15, 1.0, vQuad.y), stretch);
          float bead = mix(2.6, 1.0, stretch); // frozen beads catch more light
          vec3 tint = mix(vec3(1.0, 0.75, 0.95), vec3(0.75, 0.95, 1.05), vTint);
          vec3 col = uColor * tint * across * tail * vAlpha * bead * 0.42;
          col *= mix(1.0, 1.25, uFreeze);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'Rain';
    scene.add(this.mesh);
  }

  setDensity(fraction) {
    this.geometry.instanceCount = Math.max(500, Math.floor(CONFIG.world.rainMax * fraction));
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.baseGeo.dispose();
    this.material.dispose();
  }
}
