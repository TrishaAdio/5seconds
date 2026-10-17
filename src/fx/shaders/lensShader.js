import * as THREE from 'three';

/**
 * Lens pass (HDR, before tone mapping):
 *  - Shockwave: a radial refraction ring expanding from uShockCenter
 *  - Chromatic aberration: radial RGB split, spiking on freeze/resume
 *  - Anamorphic streaks: horizontal blue flares from very bright pixels
 */
export const LensShader = {
  name: 'LensShader',
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uAspect: { value: 1.777 },
    uCA: { value: 0.0015 },
    uStreak: { value: 0.3 },
    uStreakThreshold: { value: 1.35 },
    uShockCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uShockRadius: { value: 0 },
    uShockWidth: { value: 0.11 },
    uShockStrength: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uAspect;
    uniform float uCA;
    uniform float uStreak;
    uniform float uStreakThreshold;
    uniform vec2 uShockCenter;
    uniform float uShockRadius;
    uniform float uShockWidth;
    uniform float uShockStrength;
    varying vec2 vUv;

    vec3 bright(vec3 c) {
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      return c * (max(l - uStreakThreshold, 0.0) / max(l, 1e-4));
    }

    void main() {
      vec2 uv = vUv;
      float ring = 0.0;

      if (uShockStrength > 0.0001) {
        vec2 d = uv - uShockCenter;
        d.x *= uAspect;
        float dist = length(d);
        float x = (dist - uShockRadius) / uShockWidth;
        if (abs(x) < 1.0) {
          // asymmetric lens profile: compress in front of the wave, stretch behind
          float prof = sin(x * 3.14159265) * (1.0 - x * x);
          vec2 n = d / max(dist, 1e-4);
          n.x /= uAspect;
          uv -= n * prof * uShockStrength;
          ring = (1.0 - x * x);
        }
      }

      vec2 dir = uv - 0.5;
      float r2 = dot(dir, dir);
      vec2 off = dir * uCA * (0.35 + r2 * 2.6) + dir * ring * uShockStrength * 0.25;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;

      if (uStreak > 0.001) {
        vec3 s = vec3(0.0);
        float stepX = 6.0 / uResolution.x;
        for (int i = 1; i <= 10; i++) {
          float fi = float(i);
          float w = exp(-fi * 0.32);
          vec2 o = vec2(fi * fi * 0.5 * stepX, 0.0);
          s += (bright(texture2D(tDiffuse, uv + o).rgb) + bright(texture2D(tDiffuse, uv - o).rgb)) * w;
        }
        col += s * vec3(0.32, 0.55, 1.0) * uStreak * 0.18;
      }

      col += ring * uShockStrength * vec3(1.2, 1.6, 2.2);
      gl_FragColor = vec4(col, 1.0);
    }`,
};
