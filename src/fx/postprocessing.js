import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CONFIG } from '../config.js';
import { DofShader } from './shaders/dofShader.js';
import { LensShader } from './shaders/lensShader.js';
import { GradeShader } from './shaders/gradeShader.js';

/**
 * HDR render pipeline:
 *
 *   scene ──> sceneRT (HalfFloat, MSAA, depth texture)
 *         ──> [DOF]    reads colour+depth straight from sceneRT
 *         ──> [Bloom]  UnrealBloomPass (neon/fire are authored > 1.0)
 *         ──> [Lens]   shockwave refraction, chromatic aberration, anamorphic streaks
 *         ──> [Output] ACES Filmic tone mapping + sRGB
 *         ──> [Grade]  teal/orange & frozen grade, vignette, grain, flash, letterbox
 */
export class RenderPipeline {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.width = 1;
    this.height = 1;
    this.pixelRatio = 1;

    const depthTexture = new THREE.DepthTexture(1, 1);
    depthTexture.type = THREE.UnsignedIntType;
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: CONFIG.quality.msaa,
      depthBuffer: true,
      depthTexture,
    });
    this.sceneRT.texture.name = 'SceneHDR';

    this.composer = new EffectComposer(renderer);

    this.dofPass = new ShaderPass(DofShader, '__unused');
    this.dofPass.uniforms.tColor.value = this.sceneRT.texture;
    this.dofPass.uniforms.tDepth.value = this.sceneRT.depthTexture;
    this.composer.addPass(this.dofPass);

    const B = CONFIG.fx.bloom;
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), B.strength, B.radius, B.threshold);
    this.composer.addPass(this.bloomPass);

    this.lensPass = new ShaderPass(LensShader);
    this.composer.addPass(this.lensPass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.gradePass = new ShaderPass(GradeShader);
    this.composer.addPass(this.gradePass);

    this.dof = this.dofPass.uniforms;
    this.lens = this.lensPass.uniforms;
    this.grade = this.gradePass.uniforms;
  }

  /** Called on resize and on quality change. */
  setSize(width, height, pixelRatio) {
    this.width = width;
    this.height = height;
    this.pixelRatio = pixelRatio;
    const r = this.renderer;
    r.setPixelRatio(pixelRatio);
    r.setSize(width, height, false);
    const w = Math.max(1, Math.floor(width * pixelRatio));
    const h = Math.max(1, Math.floor(height * pixelRatio));
    this.sceneRT.setSize(w, h);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);

    const aspect = width / height;
    this.dof.uResolution.value.set(w, h);
    this.dof.uMaxBlur.value = h * CONFIG.fx.dof.maxBlurFraction;
    this.lens.uResolution.value.set(w, h);
    this.lens.uAspect.value = aspect;
    this.grade.uResolution.value.set(w, h);
    this.grade.uAspect.value = aspect;
  }

  get renderHeight() {
    return this.sceneRT.height;
  }

  get renderWidth() {
    return this.sceneRT.width;
  }

  setQuality(level) {
    this.bloomPass.enabled = level.bloom;
    if (this.dofPass.material.defines.SAMPLES !== level.dofSamples) {
      this.dofPass.material.defines.SAMPLES = level.dofSamples;
      this.dofPass.material.needsUpdate = true;
    }
    this.streakEnabled = level.streak;
  }

  render(deltaTime) {
    const r = this.renderer;
    this.dof.uNear.value = this.camera.near;
    this.dof.uFar.value = this.camera.far;
    r.setRenderTarget(this.sceneRT);
    r.clear(true, true, false);
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
    this.composer.render(deltaTime);
  }

  dispose() {
    this.sceneRT.depthTexture.dispose();
    this.sceneRT.dispose();
    this.bloomPass.dispose();
    this.dofPass.dispose();
    this.lensPass.dispose();
    this.outputPass.dispose();
    this.gradePass.dispose();
    this.composer.dispose();
  }
}
