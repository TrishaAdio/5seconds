import * as THREE from 'three';
import { CONFIG } from '../config.js';

/** Creates the WebGL renderer configured for a filmic HDR pipeline. */
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // MSAA happens on the HDR scene target instead
    alpha: false,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Tone mapping is applied by OutputPass at the end of the HDR chain.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = CONFIG.fx.exposure;
  renderer.shadowMap.enabled = false;
  renderer.info.autoReset = false; // we reset once per frame (multi-pass)
  renderer.setClearColor(0x000000, 1);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  return renderer;
}

/** Device pixel ratio capped by config. */
export function basePixelRatio() {
  return Math.min(window.devicePixelRatio || 1, CONFIG.quality.maxDpr);
}
