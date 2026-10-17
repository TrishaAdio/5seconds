import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { CONFIG } from '../config.js';
import { createAsphaltTextures, createSidewalkTexture } from '../utils/textures.js';

/**
 * Wet street.
 * Layer 1: a planar Reflector (half-res-ish) with a custom shader that adds
 *          vertical "wet road" smearing and rain ripples. Ripples are driven
 *          by world time — they visibly halt during the freeze.
 * Layer 2: a lit asphalt overlay (MeshStandardMaterial) whose alpha comes from
 *          a puddle mask, so puddles are near-perfect mirrors while dry patches
 *          show rough asphalt with a faint reflection.
 * Sidewalks/curbs are wet concrete boxes lit by the scene and env map.
 */
const WetReflectorShader = {
  name: 'WetReflector',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uRipple: { value: 1 },
    uFogColor: { value: new THREE.Color() },
    uFogDensity: { value: 0.02 },
    uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uRipple;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    uniform vec2 uTexel;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <logdepthbuf_pars_fragment>

    vec2 hash22(vec2 p) {
      p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
      return fract(sin(p) * 43758.5453);
    }

    // Expanding rain rings in a jittered grid. Pure function of uTime.
    vec2 ripples(vec2 p, float t) {
      vec2 acc = vec2(0.0);
      for (int l = 0; l < 2; l++) {
        float sc = l == 0 ? 1.6 : 2.7;
        vec2 q = p * sc + float(l) * 13.7;
        vec2 cell = floor(q);
        vec2 f = fract(q);
        vec2 h = hash22(cell);
        vec2 c = 0.25 + 0.5 * h;
        float ph = fract(t * (0.8 + h.y * 0.6) + h.x * 9.0);
        vec2 d = f - c;
        float r = length(d);
        float ring = (r - ph * 0.45) * 28.0;
        float w = exp(-ring * ring) * (1.0 - ph) * (1.0 - ph);
        acc += (d / max(r, 1e-3)) * w;
      }
      return acc;
    }

    void main() {
      #include <logdepthbuf_fragment>
      vec2 rp = ripples(vWorld.xz, uTime) * uRipple;
      vec2 wob = vec2(sin(vWorld.z * 1.9 + vWorld.x * 0.4), cos(vWorld.x * 1.4 - vWorld.z * 0.6)) * 0.0035;
      vec4 uv = vUv;
      uv.xy += (rp * 0.018 + wob) * uv.w;

      // Vertical smear: wet asphalt stretches reflections toward the viewer.
      vec3 acc = vec3(0.0);
      float wsum = 0.0;
      for (int i = -3; i <= 4; i++) {
        float fi = float(i);
        float w = exp(-fi * fi * 0.12);
        vec4 o = uv + vec4(0.0, fi * uTexel.y * 3.2 * uv.w, 0.0, 0.0);
        acc += texture2DProj(tDiffuse, o).rgb * w;
        wsum += w;
      }
      vec3 col = acc / wsum * color;

      float dist = length(vWorld - cameraPosition);
      float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
      col = mix(col, uFogColor, fog);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export class Ground {
  constructor(scene, timeUniforms) {
    this.scene = scene;
    this.timeUniforms = timeUniforms;
    this.group = new THREE.Group();
    this.group.name = 'Ground';
    scene.add(this.group);

    const W = CONFIG.world;
    const L = W.streetHalfLength * 2 + 40;
    const totalW = (W.roadHalfWidth + W.sidewalkWidth + 1) * 2;

    // ------------------------------------------------------------ mirror
    this.reflectScale = 0.4;
    this.reflector = new Reflector(new THREE.PlaneGeometry(totalW, L), {
      clipBias: 0.003,
      textureWidth: 512,
      textureHeight: 512,
      color: 0xb8c2d6,
      multisample: 0,
      shader: WetReflectorShader,
    });
    this.reflector.rotation.x = -Math.PI / 2;
    this.reflector.position.y = 0;
    const ru = this.reflector.material.uniforms;
    ru.uFogColor.value.set(CONFIG.colors.fog);
    ru.uFogDensity.value = W.fogDensity;
    this.group.add(this.reflector);

    // Hooks so particle shaders size themselves against the mirror's
    // render target (smaller) while it renders, then restore.
    this.onReflectBegin = null;
    this.onReflectEnd = null;
    const origBefore = this.reflector.onBeforeRender;
    const self = this;
    this.reflector.onBeforeRender = function (renderer, scene, camera, ...rest) {
      if (self.onReflectBegin) self.onReflectBegin(self.reflector.getRenderTarget());
      origBefore.call(this, renderer, scene, camera, ...rest);
      if (self.onReflectEnd) self.onReflectEnd();
    };

    // ----------------------------------------------------------- asphalt
    const asphalt = createAsphaltTextures(4);
    this.textures = [asphalt.map, asphalt.mask];
    const rep = L / 28;
    for (const t of this.textures) t.repeat.set(1, rep);
    this.asphaltMat = new THREE.MeshStandardMaterial({
      map: asphalt.map,
      alphaMap: asphalt.mask,
      roughnessMap: asphalt.mask,
      roughness: 0.75,
      metalness: 0.0,
      transparent: true,
      depthWrite: false,
      envMapIntensity: 0.45,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    this.asphalt = new THREE.Mesh(new THREE.PlaneGeometry(W.roadHalfWidth * 2, L), this.asphaltMat);
    this.asphalt.rotation.x = -Math.PI / 2;
    this.asphalt.position.y = 0.002;
    this.asphalt.renderOrder = -10; // before every other transparent object
    this.group.add(this.asphalt);

    // --------------------------------------------------------- sidewalks
    const swTex = createSidewalkTexture(9);
    swTex.repeat.set(1, L / 4);
    this.textures.push(swTex);
    const swMat = new THREE.MeshStandardMaterial({ map: swTex, roughness: 0.28, metalness: 0.05, envMapIntensity: 0.9 });
    const curbMat = new THREE.MeshStandardMaterial({ color: 0x3a3c42, roughness: 0.4 });
    this.materials = [swMat, curbMat];
    const swGeo = new THREE.BoxGeometry(W.sidewalkWidth + 1, 0.16, L);
    const curbGeo = new THREE.BoxGeometry(0.22, 0.18, L);
    this.geometries = [swGeo, curbGeo];
    for (const side of [-1, 1]) {
      const sw = new THREE.Mesh(swGeo, swMat);
      sw.position.set(side * (W.roadHalfWidth + (W.sidewalkWidth + 1) / 2), 0.08, 0);
      this.group.add(sw);
      const curb = new THREE.Mesh(curbGeo, curbMat);
      curb.position.set(side * (W.roadHalfWidth + 0.11), 0.09, 0);
      this.group.add(curb);
    }

    // ---------------------------------------------------------- manholes
    this.ventPositions = [new THREE.Vector3(3.2, 0, -13), new THREE.Vector3(-2.6, 0, 8.5), new THREE.Vector3(4.8, 0, -36), new THREE.Vector3(-3.4, 0, 26)];
    const mhGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.03, 24);
    const mhMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.35, metalness: 0.9 });
    this.geometries.push(mhGeo);
    this.materials.push(mhMat);
    for (const v of this.ventPositions) {
      const mh = new THREE.Mesh(mhGeo, mhMat);
      mh.position.set(v.x, 0.012, v.z);
      this.group.add(mh);
    }
  }

  /** Resize mirror target. scale = fraction of the main render resolution. */
  setReflectionSize(width, height, scale) {
    this.reflectScale = scale;
    const w = Math.max(64, Math.floor(width * scale));
    const h = Math.max(64, Math.floor(height * scale));
    this.reflector.getRenderTarget().setSize(w, h);
    this.reflector.material.uniforms.uTexel.value.set(1 / w, 1 / h);
  }

  update() {
    this.reflector.material.uniforms.uTime.value = this.timeUniforms.uWorldTime.value;
  }

  dispose() {
    this.reflector.dispose();
    this.reflector.geometry.dispose();
    this.asphalt.geometry.dispose();
    this.asphaltMat.dispose();
    this.textures.forEach((t) => t.dispose());
    this.materials.forEach((m) => m.dispose());
    this.geometries.forEach((g) => g.dispose());
    this.scene.remove(this.group);
  }
}
