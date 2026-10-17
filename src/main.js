import './styles.css';
import * as THREE from 'three';
import { CONFIG, DEBUG, IS_TOUCH } from './config.js';
import { createRenderer, basePixelRatio } from './core/renderer.js';
import { Loop } from './core/loop.js';
import { TimeSystem } from './core/timeSystem.js';
import { Input } from './core/input.js';
import { CameraRig } from './core/cameraRig.js';
import { QualityManager } from './core/quality.js';
import { World } from './world/world.js';
import { RenderPipeline } from './fx/postprocessing.js';
import { CinematicDirector } from './fx/cinematicFx.js';
import { AudioEngine } from './audio/audioEngine.js';
import { Hud } from './ui/hud.js';
import { StartScreen } from './ui/startScreen.js';
import { TouchControls } from './ui/touchControls.js';
import { DebugPanel } from './ui/debugPanel.js';

/**
 * FIVE SECONDS — bootstrap.
 *
 * Frame order (see README "Architecture"):
 *   time.update      advance real + world clocks, run the time-stop state machine
 *   rig.update       camera on REAL time
 *   world.update     every simulation on WORLD time
 *   director.update  camera FX + post parameters on REAL time
 *   audio/hud        react to time state
 *   pipeline.render  HDR scene -> DOF -> bloom -> lens -> tone map -> grade
 */
function fatal(root, message) {
  const el = document.createElement('div');
  el.className = 'fatal';
  el.innerHTML = message;
  root.appendChild(el);
}

function boot() {
  const canvas = document.getElementById('scene');
  const uiRoot = document.getElementById('ui');

  let renderer;
  try {
    renderer = createRenderer(canvas);
  } catch (err) {
    fatal(uiRoot, 'FIVE SECONDS NEEDS WEBGL 2.<br/>PLEASE TRY A RECENT DESKTOP OR MOBILE BROWSER.');
    return;
  }

  const startScreen = new StartScreen(uiRoot, enter);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, window.innerWidth / window.innerHeight, CONFIG.camera.near, CONFIG.camera.far);
  camera.rotation.order = 'YXZ';

  const time = new TimeSystem();
  const world = new World(scene, renderer, time);
  const pipeline = new RenderPipeline(renderer, scene, camera);
  const input = new Input(canvas);
  const rig = new CameraRig(camera, input, world.heroFocus);
  const director = new CinematicDirector(pipeline, camera, time, world.heroFocus);
  const audio = new AudioEngine();
  audio.bind(time);
  const hud = new Hud(uiRoot);
  const touch = IS_TOUCH ? new TouchControls(uiRoot, input) : null;
  const debug = DEBUG ? new DebugPanel(uiRoot) : null;

  // ------------------------------------------------------------ quality
  let level = CONFIG.quality.levels[CONFIG.quality.startLevel];
  const applySize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = basePixelRatio() * level.pixelRatio;
    pipeline.setSize(w, h, pr);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    world.setViewport(pipeline.renderWidth, pipeline.renderHeight, level.reflection);
  };
  const quality = new QualityManager((lvl) => {
    level = lvl;
    pipeline.setQuality(lvl);
    world.setQuality(lvl);
    applySize();
  });
  quality.apply();
  window.addEventListener('resize', applySize);

  // ------------------------------------------------------- time events
  let started = false;
  time.on('freeze', () => {
    world.hero.syncForFreeze();
    rig.setFlying(true);
    hud.dismissHint();
  });
  time.on('resume', () => rig.setFlying(false));
  time.on('ready', () => {
    if (started) hud.toast('TIME STOP READY');
  });

  world.hero.onDetonate((pos, synced) => {
    director.onExplosion(pos, synced);
    audio.explosion(camera.position.distanceTo(pos), synced);
    if (started && !synced) setTimeout(() => hud.showHint(), 350);
  });

  // ------------------------------------------------------------ actions
  let pendingShot = false;
  input.onAction((action) => {
    if (!started) return;
    switch (action) {
      case 'timestop':
        if (!time.trigger() && time.cooldownRemaining > 0) hud.toast(`RECHARGING · ${time.cooldownRemaining.toFixed(1)}s`, 1);
        break;
      case 'photo':
        pendingShot = true;
        break;
      case 'hud':
        hud.toggle();
        break;
      case 'mute':
        hud.toast(audio.toggleMute() ? 'SOUND OFF' : 'SOUND ON');
        break;
      case 'drift':
        hud.toast(time.toggleMicroDrift() ? 'HELD FREEZE · DRIFT ON' : 'ABSOLUTE FREEZE · DRIFT OFF');
        break;
      default:
        break;
    }
  });

  function capture() {
    try {
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `five-seconds-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      hud.toast('FRAME CAPTURED');
    } catch {
      hud.toast('CAPTURE FAILED');
    }
  }

  function enter() {
    if (started) return;
    started = true;
    audio.init();
    input.enabled = true;
    if (!IS_TOUCH) input.requestLock();
    startScreen.hide();
    hud.show();
    if (touch) touch.show();
    rig.start();
    quality.reset();
  }

  // --------------------------------------------------------- visibility
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audio.suspend();
    else {
      if (started) audio.resume();
      quality.reset();
    }
  });

  // --------------------------------------------------------------- loop
  let readyShown = false;
  const loop = new Loop((dt, raw, now) => {
    renderer.info.reset();
    time.update(dt, now);
    rig.update(time.realDelta);
    world.update(time, camera);
    director.update(time.realDelta);
    audio.update(time, camera.position, world.heroFocus);
    hud.update(time);
    if (touch) {
      touch.setStopEnabled(time.canTrigger());
      touch.setFlyButtons(time.isStopped);
    }
    if (started && !IS_TOUCH) hud.setLockHint(!input.locked && !input.leftDrag);

    pipeline.render(time.realDelta);

    if (pendingShot) {
      pendingShot = false;
      capture();
    }
    if (started) quality.update(raw);
    if (debug) {
      debug.update(raw, {
        time,
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        heroT: world.hero.heroT,
        quality: quality.level.name,
        pixelRatio: pipeline.pixelRatio,
        resolution: `${pipeline.renderWidth}x${pipeline.renderHeight}`,
      });
      hud.setStatus(`${time.state} · ${quality.level.name.toUpperCase()}`);
    }
    if (!readyShown) {
      readyShown = true;
      startScreen.setReady();
    }
  });
  loop.start();

  // ------------------------------------------------------------ cleanup
  window.addEventListener('pagehide', () => {
    loop.dispose();
    input.dispose();
    audio.dispose();
    world.dispose();
    pipeline.dispose();
    renderer.dispose();
  });

  // Exposed for debugging / automated checks.
  if (DEBUG) window.__FIVE = { time, world, pipeline, rig, quality, audio, camera, input };
}

boot();
