import * as THREE from 'three';

/**
 * Depth of field (gather, golden-angle spiral).
 * Reads the HDR scene colour + depth directly from the scene render target.
 * Circle of confusion ~ |z - focus| / z (thin-lens approximation), scaled by
 * uAmount (0 while running, 1 when frozen). Foreground samples only bleed if
 * their own CoC reaches the pixel, which avoids sharp-subject halos.
 */
export const DofShader = {
  name: 'DofShader',
  defines: { SAMPLES: 24 },
  uniforms: {
    tColor: { value: null },
    tDepth: { value: null },
    uNear: { value: 0.1 },
    uFar: { value: 400 },
    uFocus: { value: 10 },
    uAmount: { value: 0 },
    uMaxBlur: { value: 10 },
    uResponse: { value: 1.7 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tColor;
    uniform sampler2D tDepth;
    uniform float uNear;
    uniform float uFar;
    uniform float uFocus;
    uniform float uAmount;
    uniform float uMaxBlur;
    uniform float uResponse;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float linearDepth(vec2 uv) {
      float d = texture2D(tDepth, uv).x;
      return -perspectiveDepthToViewZ(d, uNear, uFar);
    }
    float coc(float z) {
      return clamp(abs(z - uFocus) / max(z, 0.001) * uResponse, 0.0, 1.0) * uMaxBlur * uAmount;
    }

    void main() {
      vec4 base = texture2D(tColor, vUv);
      if (uAmount < 0.002) { gl_FragColor = base; return; }
      float z = linearDepth(vUv);
      float radius = coc(z);
      if (radius < 0.6) { gl_FragColor = base; return; }

      vec3 acc = base.rgb;
      float wsum = 1.0;
      for (int i = 0; i < SAMPLES; i++) {
        float fi = float(i) + 0.5;
        float r = sqrt(fi / float(SAMPLES)) * radius;
        float th = fi * 2.39996323;
        vec2 suv = vUv + vec2(cos(th), sin(th)) * r / uResolution;
        vec3 s = texture2D(tColor, suv).rgb;
        float sz = linearDepth(suv);
        float w = sz >= z - 0.5 ? 1.0 : clamp(coc(sz) / max(r, 0.001), 0.0, 1.0);
        // gentle highlight boost = rounder, brighter bokeh
        w *= 1.0 + 0.15 * min(dot(s, vec3(0.2126, 0.7152, 0.0722)), 4.0);
        acc += s * w;
        wsum += w;
      }
      gl_FragColor = vec4(acc / wsum, base.a);
    }`,
};
