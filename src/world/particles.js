import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createRng } from '../utils/math.js';

/**
 * Analytic GPU particle systems.
 *
 * No particle is integrated on the CPU. Every particle's state is a closed-form
 * function of a time uniform:
 *   - "burst" systems read uHeroT (the hero cycle clock, advanced by worldDelta)
 *   - "loop" systems read uWorldTime
 * Both clocks stop when timeScale hits 0, so fire, sparks, smoke, embers and
 * steam all hang in mid-air — and stay perfectly stable while you fly around.
 * uShimmer adds a sub-centimetre tremble during the "held" freeze.
 */

const POINT_COMMON = /* glsl */ `
  uniform float uViewportH;
  uniform float uRealTime;
  uniform float uShimmer;
  float pointSize(float worldSize, vec4 mv) {
    return clamp(worldSize * projectionMatrix[1][1] * uViewportH * 0.5 / max(-mv.z, 0.05), 0.0, 400.0);
  }
  vec3 shimmer(float seed) {
    return vec3(sin(uRealTime * 2.1 + seed * 51.0), cos(uRealTime * 1.6 + seed * 37.0), sin(uRealTime * 1.9 + seed * 23.0)) * 0.006 * uShimmer;
  }
  #define CULL_POINT { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
`;

const FIRE_RAMP = /* glsl */ `
  vec3 fireRamp(float t) {
    vec3 c1 = vec3(6.0, 4.6, 2.6);
    vec3 c2 = vec3(4.4, 1.7, 0.32);
    vec3 c3 = vec3(1.7, 0.32, 0.05);
    vec3 c4 = vec3(0.10, 0.035, 0.02);
    if (t < 0.22) return mix(c1, c2, t / 0.22);
    if (t < 0.6) return mix(c2, c3, (t - 0.22) / 0.38);
    return mix(c3, c4, (t - 0.6) / 0.4);
  }
`;

const SOFT_POINT_FRAG = /* glsl */ `
  float softDisc(vec2 pc, float seed) {
    vec2 c = pc - 0.5;
    float r = length(c) * 2.0;
    float ang = atan(c.y, c.x);
    float wob = 0.82 + 0.18 * sin(ang * 5.0 + seed * 40.0) * sin(ang * 3.0 - seed * 13.0);
    return pow(clamp(1.0 - r / wob, 0.0, 1.0), 1.5);
  }
`;

function randomDir(rng, out, upBias = 0) {
  const u = rng() * 2 - 1;
  const th = rng() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  out.set(s * Math.cos(th), Math.abs(u) * (1 - upBias) + upBias * (0.5 + rng() * 0.5), s * Math.sin(th));
  return out.normalize();
}

export class ParticleSystems {
  constructor(scene, timeUniforms, heroUniforms, ventPositions) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'Particles';
    scene.add(this.group);
    this.systems = []; // { mesh, max, instanced }
    const P = CONFIG.particles;
    const rng = createRng(555);
    const v = new THREE.Vector3();

    const common = {
      uViewportH: heroUniforms.uViewportH,
      uRealTime: timeUniforms.uRealTime,
      uShimmer: timeUniforms.uShimmer,
      uWorldTime: timeUniforms.uWorldTime,
      uTimeScale: timeUniforms.uTimeScale,
      uHeroT: heroUniforms.uHeroT,
      uBurstOrigin: heroUniforms.uBurstOrigin,
      uWreckOrigin: heroUniforms.uWreckOrigin,
    };

    // ----------------------------------------------------- fire burst
    {
      const n = P.fireBurst;
      const dir = new Float32Array(n * 3);
      const prm = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        randomDir(rng, v, 0.25);
        v.y *= 0.75;
        dir.set([v.x, v.y, v.z], i * 3);
        const core = rng() < 0.35;
        prm.set([core ? rng.range(2, 6) : rng.range(6, 15), rng() * 0.12, rng.range(0.9, 2.1), rng()], i * 4);
      }
      this._addPoints('FireBurst', n, { aDir: [dir, 3], aParams: [prm, 4] }, common, THREE.AdditiveBlending, /* glsl */ `
        ${POINT_COMMON}
        uniform float uHeroT;
        uniform vec3 uBurstOrigin;
        attribute vec3 aDir;
        attribute vec4 aParams;
        varying float vAge;
        varying float vSeed;
        void main() {
          float t = uHeroT - aParams.y;
          float a = t / aParams.z;
          if (t < 0.0 || a > 1.0) CULL_POINT
          float k = 2.8;
          float r = aParams.x * (1.0 - exp(-k * t)) / k;
          vec3 p = uBurstOrigin + aDir * r;
          p.y += 1.5 * t * t;
          p.y = max(p.y, 0.2 + 0.4 * a);
          p += vec3(sin(t * 3.1 + aParams.w * 30.0), cos(t * 2.3 + aParams.w * 17.0), sin(t * 2.7 + aParams.w * 11.0)) * 0.35 * a;
          p += shimmer(aParams.w);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float size = (0.55 + aParams.x * 0.06) * (0.5 + 2.3 * sqrt(a));
          gl_PointSize = pointSize(size, mv);
          gl_Position = projectionMatrix * mv;
          vAge = a;
          vSeed = aParams.w;
        }`, /* glsl */ `
        ${FIRE_RAMP}
        ${SOFT_POINT_FRAG}
        varying float vAge;
        varying float vSeed;
        void main() {
          float m = softDisc(gl_PointCoord, vSeed);
          float fade = (1.0 - smoothstep(0.55, 1.0, vAge)) * smoothstep(0.0, 0.04, vAge);
          gl_FragColor = vec4(fireRamp(vAge) * m * fade * 0.035, 1.0);
        }`);
    }

    // ----------------------------------------------------- fire loop (wreck)
    {
      const n = P.fireLoop;
      const off = new Float32Array(n * 3);
      const prm = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        off.set([rng.range(-1.6, 1.6), rng.range(0, 0.4), rng.range(-0.7, 0.7)], i * 3);
        prm.set([rng.range(1.2, 2.6), rng.range(0.7, 1.4), rng.range(0.6, 1.3), rng()], i * 4);
      }
      this._addPoints('FireLoop', n, { aOffset: [off, 3], aParams: [prm, 4] }, common, THREE.AdditiveBlending, /* glsl */ `
        ${POINT_COMMON}
        uniform float uWorldTime;
        uniform vec3 uWreckOrigin;
        attribute vec3 aOffset;
        attribute vec4 aParams; // rise, life, size, seed
        varying float vAge;
        varying float vSeed;
        void main() {
          float life = aParams.y;
          float t = mod(uWorldTime + aParams.w * life * 7.0, life);
          float a = t / life;
          vec3 p = uWreckOrigin + aOffset * (1.0 - a * 0.6);
          p.y += aParams.x * t + 0.5 * t * t;
          p.x += sin(t * 4.0 + aParams.w * 20.0) * 0.15 * a - 0.6 * t * t;
          p.z += cos(t * 3.0 + aParams.w * 9.0) * 0.15 * a;
          p += shimmer(aParams.w);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = pointSize(aParams.z * (1.0 - a * 0.5), mv);
          gl_Position = projectionMatrix * mv;
          vAge = a;
          vSeed = aParams.w;
        }`, /* glsl */ `
        ${FIRE_RAMP}
        ${SOFT_POINT_FRAG}
        varying float vAge;
        varying float vSeed;
        void main() {
          float m = softDisc(gl_PointCoord, vSeed);
          float fade = (1.0 - smoothstep(0.5, 1.0, vAge)) * smoothstep(0.0, 0.1, vAge);
          gl_FragColor = vec4(fireRamp(0.12 + vAge * 0.7) * m * fade * 0.07, 1.0);
        }`);
    }

    // ----------------------------------------------------- smoke column
    {
      const n = P.smoke;
      const off = new Float32Array(n * 3);
      const prm = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        off.set([rng.range(-1.2, 1.2), rng.range(0.8, 1.6), rng.range(-0.6, 0.6)], i * 3);
        prm.set([rng.range(1.1, 1.9), rng.range(5, 8), rng.range(1.6, 3.4), rng()], i * 4);
      }
      this._addPoints('Smoke', n, { aOffset: [off, 3], aParams: [prm, 4] }, common, THREE.NormalBlending, /* glsl */ `
        ${POINT_COMMON}
        uniform float uWorldTime;
        uniform vec3 uWreckOrigin;
        attribute vec3 aOffset;
        attribute vec4 aParams; // rise, life, size, seed
        varying float vAge;
        varying float vSeed;
        varying float vHeat;
        void main() {
          float life = aParams.y;
          float t = mod(uWorldTime + aParams.w * life * 11.0, life);
          float a = t / life;
          vec3 p = uWreckOrigin + aOffset;
          p.y += aParams.x * t;
          p.x += -1.1 * t + sin(t * 0.8 + aParams.w * 12.0) * 0.6 * a;
          p.z += 0.4 * t + cos(t * 0.7 + aParams.w * 7.0) * 0.6 * a;
          p += shimmer(aParams.w);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = pointSize(aParams.z * (0.6 + a * 2.2), mv);
          gl_Position = projectionMatrix * mv;
          vAge = a;
          vSeed = aParams.w;
          vHeat = 1.0 - smoothstep(0.0, 0.25, a);
        }`, /* glsl */ `
        ${SOFT_POINT_FRAG}
        varying float vAge;
        varying float vSeed;
        varying float vHeat;
        void main() {
          float m = softDisc(gl_PointCoord, vSeed);
          float fade = smoothstep(0.0, 0.12, vAge) * (1.0 - smoothstep(0.6, 1.0, vAge));
          vec3 col = mix(vec3(0.018, 0.018, 0.024), vec3(0.6, 0.18, 0.04), vHeat * 0.6);
          gl_FragColor = vec4(col, m * fade * 0.42);
        }`);
    }

    // ----------------------------------------------------- embers
    {
      const n = P.embers;
      const off = new Float32Array(n * 3);
      const prm = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        off.set([rng.range(-1.8, 1.8), rng.range(0.4, 1.2), rng.range(-1, 1)], i * 3);
        prm.set([rng.range(1.0, 3.2), rng.range(2.2, 4.5), rng.range(0.03, 0.07), rng()], i * 4);
      }
      this._addPoints('Embers', n, { aOffset: [off, 3], aParams: [prm, 4] }, common, THREE.AdditiveBlending, /* glsl */ `
        ${POINT_COMMON}
        uniform float uWorldTime;
        uniform vec3 uWreckOrigin;
        attribute vec3 aOffset;
        attribute vec4 aParams;
        varying float vAge;
        void main() {
          float life = aParams.y;
          float t = mod(uWorldTime + aParams.w * life * 5.0, life);
          float a = t / life;
          vec3 p = uWreckOrigin + aOffset;
          p.y += aParams.x * t;
          p.x += sin(t * 2.0 + aParams.w * 31.0) * 1.2 * a - 1.0 * t;
          p.z += cos(t * 1.7 + aParams.w * 19.0) * 1.2 * a + 0.3 * t;
          p += shimmer(aParams.w);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = max(1.5, pointSize(aParams.z, mv));
          gl_Position = projectionMatrix * mv;
          vAge = a;
        }`, /* glsl */ `
        varying float vAge;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float m = clamp(1.0 - r, 0.0, 1.0);
          float fade = 1.0 - smoothstep(0.6, 1.0, vAge);
          gl_FragColor = vec4(vec3(6.0, 2.2, 0.4) * m * fade, 1.0);
        }`);
    }

    // ----------------------------------------------------- steam vents
    {
      const per = P.steamPerVent;
      const n = per * ventPositions.length;
      const org = new Float32Array(n * 3);
      const prm = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        const vp = ventPositions[Math.floor(i / per)];
        org.set([vp.x + rng.range(-0.3, 0.3), 0.05, vp.z + rng.range(-0.3, 0.3)], i * 3);
        prm.set([rng.range(0.6, 1.3), rng.range(3, 5.5), rng.range(0.5, 1.1), rng()], i * 4);
      }
      this._addPoints('Steam', n, { aOrigin: [org, 3], aParams: [prm, 4] }, common, THREE.AdditiveBlending, /* glsl */ `
        ${POINT_COMMON}
        uniform float uWorldTime;
        attribute vec3 aOrigin;
        attribute vec4 aParams;
        varying float vAge;
        varying float vSeed;
        void main() {
          float life = aParams.y;
          float t = mod(uWorldTime + aParams.w * life * 9.0, life);
          float a = t / life;
          vec3 p = aOrigin;
          p.y += aParams.x * t;
          p.x += -0.5 * t * t * 0.3 + sin(t * 1.3 + aParams.w * 17.0) * 0.4 * a;
          p.z += 0.2 * t + cos(t * 1.1 + aParams.w * 23.0) * 0.4 * a;
          p += shimmer(aParams.w);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = pointSize(aParams.z * (0.5 + a * 3.0), mv);
          gl_Position = projectionMatrix * mv;
          vAge = a;
          vSeed = aParams.w;
        }`, /* glsl */ `
        ${SOFT_POINT_FRAG}
        varying float vAge;
        varying float vSeed;
        void main() {
          float m = softDisc(gl_PointCoord, vSeed);
          float fade = smoothstep(0.0, 0.15, vAge) * (1.0 - smoothstep(0.4, 1.0, vAge));
          gl_FragColor = vec4(vec3(0.07, 0.065, 0.09) * m * fade, 1.0);
        }`);
    }

    // ----------------------------------------------------- sparks (streaks)
    const sparkVertex = (burst) => /* glsl */ `
      uniform float uWorldTime;
      uniform float uHeroT;
      uniform float uTimeScale;
      uniform float uRealTime;
      uniform float uShimmer;
      uniform vec3 uBurstOrigin;
      uniform vec3 uWreckOrigin;
      attribute vec3 aVel;
      attribute vec4 aParams; // delay, life, seed, size
      varying float vAge;
      varying vec2 vQuad;
      void main() {
        float life = aParams.y;
        ${burst ? 'float t = uHeroT - aParams.x; vec3 origin = uBurstOrigin;' : 'float t = mod(uWorldTime + aParams.z * life * 13.0, life); vec3 origin = uWreckOrigin + vec3(0.0, 0.5, 0.0);'}
        float a = t / life;
        if (t < 0.0 || a > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        float drag = 0.9;
        vec3 g = vec3(0.0, -9.8, 0.0);
        vec3 p = origin + aVel * (1.0 - exp(-drag * t)) / drag + 0.5 * g * t * t;
        vec3 vel = aVel * exp(-drag * t) + g * t;
        if (p.y < 0.03) { p.y = 0.03 + abs(p.y) * 0.18; vel.y = abs(vel.y) * 0.25; vel.xz *= 0.5; }
        float speed = length(vel);
        vec3 dir = vel / max(speed, 1e-3);
        float stretch = clamp(uTimeScale, 0.0, 1.3);
        float len = clamp(speed * 0.03, 0.04, 0.55) * mix(0.4, 1.0, stretch);
        vec3 toCam = normalize(cameraPosition - p);
        vec3 side = normalize(cross(dir, toCam));
        vec3 wp = p + dir * (position.y - 0.5) * len + side * position.x * 0.018 * aParams.w;
        wp += vec3(sin(uRealTime * 2.0 + aParams.z * 40.0), cos(uRealTime * 1.5 + aParams.z * 30.0), 0.0) * 0.005 * uShimmer;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        vAge = a;
        vQuad = position.xy;
      }`;
    const sparkFragment = /* glsl */ `
      varying float vAge;
      varying vec2 vQuad;
      void main() {
        float across = 1.0 - abs(vQuad.x * 2.0);
        float along = mix(0.35, 1.0, vQuad.y);
        vec3 hot = mix(vec3(7.0, 5.0, 2.2), vec3(4.0, 0.9, 0.12), smoothstep(0.0, 0.7, vAge));
        float fade = pow(1.0 - vAge, 1.3);
        gl_FragColor = vec4(hot * across * along * fade, 1.0);
      }`;

    const makeSparks = (name, n, burst) => {
      const vel = new Float32Array(n * 3);
      const prm = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        randomDir(rng, v, burst ? 0.15 : 0.6);
        const sp = burst ? rng.range(4, 19) : rng.range(2, 6);
        vel.set([v.x * sp, v.y * sp * (burst ? 0.8 : 1.0) + (burst ? 2 : 1.5), v.z * sp], i * 3);
        prm.set([burst ? rng() * 0.18 : 0, burst ? rng.range(1.0, 2.6) : rng.range(0.6, 1.4), rng(), rng.range(0.6, 1.4)], i * 4);
      }
      this._addStreaks(name, n, { aVel: [vel, 3], aParams: [prm, 4] }, common, sparkVertex(burst), sparkFragment);
    };
    makeSparks('SparksBurst', P.sparksBurst, true);
    makeSparks('SparksLoop', P.sparksLoop, false);
  }

  _material(name, uniforms, blending, vertexShader, fragmentShader) {
    return new THREE.ShaderMaterial({
      name,
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending,
    });
  }

  _addPoints(name, n, attrs, uniforms, blending, vs, fs) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    for (const [k, [arr, size]] of Object.entries(attrs)) geo.setAttribute(k, new THREE.BufferAttribute(arr, size));
    const mesh = new THREE.Points(geo, this._material(name, uniforms, blending, vs, fs));
    mesh.frustumCulled = false;
    mesh.name = name;
    this.group.add(mesh);
    this.systems.push({ mesh, max: n, instanced: false });
  }

  _addStreaks(name, n, attrs, uniforms, vs, fs) {
    const base = new THREE.PlaneGeometry(1, 1);
    base.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    for (const [k, [arr, size]] of Object.entries(attrs)) geo.setAttribute(k, new THREE.InstancedBufferAttribute(arr, size));
    geo.instanceCount = n;
    const mesh = new THREE.Mesh(geo, this._material(name, uniforms, THREE.AdditiveBlending, vs, fs));
    mesh.frustumCulled = false;
    mesh.name = name;
    this.group.add(mesh);
    this.systems.push({ mesh, max: n, instanced: true, base });
  }

  /** Scales active particle counts without reallocating anything. */
  setDensity(fraction) {
    for (const s of this.systems) {
      const n = Math.max(16, Math.floor(s.max * fraction));
      if (s.instanced) s.mesh.geometry.instanceCount = n;
      else s.mesh.geometry.setDrawRange(0, n);
    }
  }

  dispose() {
    for (const s of this.systems) {
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
      if (s.base) s.base.dispose();
    }
    this.scene.remove(this.group);
  }
}
