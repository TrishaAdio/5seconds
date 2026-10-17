import * as THREE from 'three';

/**
 * Final grade (display-referred, after ACES tone mapping + sRGB):
 *  - Teal/orange split-toning baseline
 *  - FROZEN look: ~60% desaturation, cold blue-silver tint, higher contrast,
 *    with a little saturation kept in hot highlights (fire, neon) so the
 *    frozen frame still reads as a blockbuster still
 *  - Vignette, film grain, flash, and animated 2.39:1 letterbox bars
 */
export const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uAspect: { value: 1.777 },
    uTime: { value: 0 },
    uFreeze: { value: 0 },
    uVignette: { value: 0.38 },
    uGrain: { value: 0.05 },
    uLetterbox: { value: 0 },
    uTargetAspect: { value: 2.39 },
    uMinBar: { value: 0.055 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
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
    uniform float uTime;
    uniform float uFreeze;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uLetterbox;
    uniform float uTargetAspect;
    uniform float uMinBar;
    uniform float uFlash;
    uniform vec3 uFlashColor;
    varying vec2 vUv;

    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));

      // --- baseline teal / orange
      vec3 shadowTint = vec3(-0.012, 0.018, 0.03);
      vec3 highTint = vec3(0.035, 0.008, -0.03);
      c += shadowTint * (1.0 - smoothstep(0.0, 0.45, l)) + highTint * smoothstep(0.35, 0.95, l);
      c = mix(vec3(l), c, 1.08);

      // --- frozen grade
      float f = uFreeze;
      float keep = smoothstep(0.55, 0.95, l) * 0.35;
      float sat = mix(1.0, 0.4 + keep, f);
      l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, sat);
      c = mix(c, c * vec3(0.84, 0.95, 1.14) + vec3(0.0, 0.008, 0.025), f);
      float contrast = mix(1.04, 1.26, f);
      c = (c - 0.4) * contrast + 0.4;

      // --- vignette
      float d = length(vUv - 0.5) * 1.41421356; // 0 centre -> 1 corners
      c *= 1.0 - uVignette * smoothstep(0.3, 1.05, d);

      // --- flash
      c += uFlashColor * uFlash;

      // --- grain (luma-weighted, animated on REAL time so a frozen frame still breathes)
      float n = hash(vUv * uResolution + fract(uTime * 7.31) * 517.0) - 0.5;
      c += n * uGrain * (1.0 - 0.6 * clamp(l, 0.0, 1.0));

      // --- letterbox
      float bar = max(uMinBar, (1.0 - uAspect / uTargetAspect) * 0.5) * uLetterbox;
      float px = 1.0 / uResolution.y;
      float m = smoothstep(bar - px, bar + px, vUv.y) * smoothstep(bar - px, bar + px, 1.0 - vUv.y);
      c *= m;

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};
