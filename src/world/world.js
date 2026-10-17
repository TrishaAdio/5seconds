import * as THREE from 'three';
import { Environment } from './environment.js';
import { City } from './city.js';
import { StreetLamps } from './lamps.js';
import { Ground } from './ground.js';
import { Rain } from './rain.js';
import { ParticleSystems } from './particles.js';
import { HeroScene } from './heroScene.js';
import { Traffic } from './traffic.js';
import { Pedestrians } from './pedestrians.js';
import { Ambient } from './ambient.js';
import { disposeCarShared } from './carModel.js';
import { createGlowTexture } from '../utils/textures.js';

/**
 * Assembles the city and routes the two clocks:
 *   update(time) passes time.worldDelta / time.worldTime to every simulation.
 * Nothing in here ever reads realDelta.
 */
export class World {
  constructor(scene, renderer, time) {
    this.scene = scene;
    this.time = time;

    // Uniforms owned by the hero event, shared with particle shaders.
    this.heroUniforms = {
      uHeroT: { value: 0 },
      uBurstOrigin: { value: new THREE.Vector3() },
      uWreckOrigin: { value: new THREE.Vector3() },
      uViewportH: { value: window.innerHeight },
    };
    this.viewportH = window.innerHeight;

    this.glowTex = createGlowTexture();
    this.environment = new Environment(scene, renderer, time.uniforms);
    this.ground = new Ground(scene, time.uniforms);
    this.city = new City(scene, time.uniforms);
    this.city.setGlowTexture(this.glowTex);
    this.lamps = new StreetLamps(scene, time.uniforms, this.glowTex);
    this.hero = new HeroScene(scene, time.uniforms, this.heroUniforms);
    this.particles = new ParticleSystems(scene, time.uniforms, this.heroUniforms, this.ground.ventPositions);
    this.rain = new Rain(scene, time.uniforms);
    this.traffic = new Traffic(scene, time.uniforms, this.glowTex);
    this.pedestrians = new Pedestrians(scene);
    this.ambient = new Ambient(scene);

    // Point sprites are sized in pixels: while the mirror renders into its
    // smaller target, tell the shaders its height, then restore.
    this.ground.onReflectBegin = (rt) => {
      this.heroUniforms.uViewportH.value = rt.height;
    };
    this.ground.onReflectEnd = () => {
      this.heroUniforms.uViewportH.value = this.viewportH;
    };
  }

  get heroFocus() {
    return this.hero.focus;
  }

  setViewport(width, height, reflectionScale) {
    this.viewportH = height;
    this.heroUniforms.uViewportH.value = height;
    this.ground.setReflectionSize(width, height, reflectionScale);
  }

  setQuality(level) {
    this.rain.setDensity(level.rain);
    this.particles.setDensity(level.particles);
    this.hero.setDensity(Math.max(0.6, level.particles));
  }

  update(time, camera) {
    const wd = time.worldDelta;
    const wt = time.worldTime;
    this.environment.update(camera);
    this.ground.update();
    this.city.update(wt);
    this.hero.update(wd, wt);
    this.traffic.update(wd, camera.position);
    this.pedestrians.update(wd);
    this.ambient.update(wd, wt);
  }

  dispose() {
    this.ambient.dispose();
    this.pedestrians.dispose();
    this.traffic.dispose();
    this.rain.dispose();
    this.particles.dispose();
    this.hero.dispose();
    this.lamps.dispose();
    this.city.dispose();
    this.ground.dispose();
    this.environment.dispose();
    disposeCarShared();
    this.glowTex.dispose();
  }
}
