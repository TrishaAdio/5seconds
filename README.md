# FIVE SECONDS

A real-time, cinematic 3D web experience. You walk a rain-soaked neon street at night, where a car has just exploded. Press **SPACE** and time stops for exactly five seconds. Rain, sparks, fire, glass, cars and people all hang in mid-air, and you can fly through the frozen moment. Then time snaps back.

Built with Vite, Three.js (r186), and the Web Audio API. All geometry, textures and sound are generated procedurally, so there are no assets to download.

## Setup

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
npm run preview  # serve the build
```

Add `?debug` to the URL to show FPS, draw calls, triangles, time state, timeScale, the precise length of the last freeze, the hero clock and the quality level.

## Controls

| Desktop | Action |
|---|---|
| W A S D / arrows | Walk (fly while frozen) |
| Mouse | Look (Pointer Lock; click to re-lock) |
| SPACE | Stop time |
| Q / E | Down / up (while frozen) |
| Shift | Run, or slow precision flight while frozen |
| Hold right mouse | Orbit-lock around the explosion (wheel zooms) |
| P | Save the current frame as a PNG |
| H | Hide/show the HUD |
| M | Mute |
| X | Toggle "held freeze" micro-drift |

| Mobile | Action |
|---|---|
| Left thumb | Floating joystick |
| Right thumb | Drag to look |
| STOP button / two-finger tap | Stop time |
| ▲ ▼ | Rise / sink while frozen |

## Architecture

```
src/
  main.js              bootstrap and per-frame orchestration
  config.js            ALL tunables
  styles.css
  core/
    timeSystem.js      two clocks + RUNNING/FREEZING/FROZEN/RESUMING state machine
    loop.js            rAF driver, raw + clamped delta
    renderer.js        WebGLRenderer (ACES Filmic, sRGB)
    input.js           keyboard, mouse, pointer lock, action dispatch
    cameraRig.js       walk / bullet-time fly / orbit-lock camera (real time)
    quality.js         adaptive quality manager
  world/
    world.js           assembles the set and routes worldDelta
    environment.js     sky dome (drifting clouds), fog, procedural env map
    city.js            merged buildings, shopfronts, neon signs, cables, billboard
    lamps.js           instanced street lamps, volumetric cones, point lights
    ground.js          planar-reflection wet street with rain ripples + puddle mask
    rain.js            up to 10k GPU instanced streaks
    particles.js       analytic GPU fire, smoke, embers, steam, spark streaks
    heroScene.js       the explosion: car flip, door, tyre, debris, glass, blast core
    character.js       procedural articulated figure diving clear
    traffic.js         cars with braking, batched headlight glows/pools/beams
    pedestrians.js     instanced walkers with (LED) umbrellas
    ambient.js         tumbling paper, haze sprites
    carModel.js        shared procedural car geometry
  fx/
    postprocessing.js  HDR pipeline
    cinematicFx.js     "director": FOV dolly-zoom, shake, letterbox, CA, shockwave, DOF
    shaders/           dofShader, lensShader, gradeShader
  audio/audioEngine.js procedural sound design
  ui/                  hud, startScreen, touchControls, debugPanel
  utils/               math, procedural textures, material helpers
```

**Frame order:** `time.update` → `rig.update` (real time) → `world.update` (world time) → `director.update` (real time) → audio/HUD → `pipeline.render`.

**Render pipeline:** scene → HalfFloat MSAA target with a depth texture → DOF (reads color and depth) → UnrealBloom → Lens (shockwave, chromatic aberration, anamorphic streaks) → OutputPass (ACES + sRGB) → Grade (teal/orange or frozen grade, vignette, grain, flash, 2.39:1 letterbox).

**Audio graph:** world sounds (rain, traffic, drone, fire, explosions) go through a single low-pass `worldFilter`. Freeze sweeps it to 300 Hz and pitches the loops down. Resume snaps it open. Ticks and heartbeats are scheduled on the AudioContext clock when FROZEN begins. The AudioContext is created by the Enter click, which satisfies autoplay policy, and is suspended while the tab is hidden.

## Design notes: the time-stop architecture

1. **The render loop never pauses.** `TimeSystem` advances two clocks every frame:
   - `realDelta` drives the camera, UI, post-processing and audio.
   - `worldDelta = realDelta × timeScale` drives *everything* in the world.
2. **`timeScale` belongs to a state machine.**
   - FREEZING: `2^(-10u)` over 0.6 s, an exponential ease-out (a sharp brake).
   - FROZEN: 0, or 0.004 with micro-drift on.
   - RESUMING: `easeOutBack` over 0.35 s, which briefly overshoots to about 1.15× for the snap.
   - After resuming, an 8 s cooldown runs before the power is ready again.
3. **FROZEN is timed against the high-resolution frame clock** (`now − frozenStartMs`), not against summed, clamped deltas. Delta clamping (for tab switches) therefore can't stretch the five seconds. The HUD reads the same `frozenRemaining` value. The state ends on the first frame at or after 5.000 s, so it is accurate to one frame (about 16 ms at 60 FPS). The debug panel shows the measured length.
4. **Shared uniforms.** `time.uniforms.uWorldTime / uTimeScale / uFreeze / uShimmer` are referenced, not copied, by every ShaderMaterial. When world time stops, rain, ripples, clouds, steam, fire and lamp-beam specks stop too. Rain and spark streak length scales with `uTimeScale`, so frozen rain collapses into glinting beads.
5. **Closed-form simulation.** The explosion is driven by one hero clock `T` (advanced only by `worldDelta`). Every piece of debris, glass shard, fire particle, spark, the car flip and the character pose is a pure function of `T`, which keeps the frozen frame perfectly stable as you fly around it.
6. **Director's sync** (`CONFIG.hero.syncOnFreeze`). If you trigger the freeze after the explosion has spent itself, a fresh detonation is cued under the freeze flash so the frozen frame always lands on the money shot. Set it to `false` for a fully honest simulation.

### Adding a new frozen object

- **CPU-animated:** update it from `time.worldDelta` / `time.worldTime` in an `update()` that `World.update` calls. Never use `realDelta` or `performance.now()` for world motion. A closed-form function of `worldTime` or `heroT` is best, because it is perfectly stable under micro-drift.
- **Shader-animated:** add `uWorldTime: time.uniforms.uWorldTime` to your ShaderMaterial's uniforms (pass the object itself, not a copy). Optionally add `uShimmer` for the held-freeze tremble.
- **Instanced / particles:** add attributes for the initial state and evaluate position from time in the vertex shader (see `particles.js`). Register it in `setDensity` so adaptive quality can scale it.

## Tuning guide (`src/config.js`)

| Group | Key values |
|---|---|
| `time` | `freezeDuration` (5.0), `freezeInDuration`, `resumeDuration`, `resumeOvershoot`, `cooldown`, `microDrift`, `microDriftScale` |
| `camera` | `fov`, walk/run/fly speeds, `lookSensitivity`, damping, `bounds`, orbit radius |
| `fx` | `exposure`, `bloom`, `fovKick` and timings, `dollyMax`, `letterboxAspect`, chromatic aberration (base/frozen/spike), vignette, grain, streaks, `dof`, `shockwave`, `shake` |
| `colors` | neon palette, fog, sky |
| `world` | street size, fog density, `rainMax`, `rainSpeed`, `wind`, crowd and traffic counts |
| `hero` | position, cycle `period`, director's-sync threshold/time, character path |
| `particles` | per-system maximum counts |
| `quality` | levels (pixel ratio, rain, particles, reflection resolution, bloom, DOF samples, streaks), thresholds (45 FPS down / 58 up), MSAA |
| `audio` | master volume, frozen cutoff, frozen world gain |

The adaptive quality system averages FPS over 2 s windows. It steps down below 45 FPS and steps up after 8 s above 58 FPS, but it never climbs back into a level that already failed. Changing quality only changes draw counts and render-target sizes; nothing is reallocated. `devicePixelRatio` is capped at 2. `prefers-reduced-motion` reduces the FOV kick to 25%, disables shake, and softens flashes, aberration and the shockwave.

## Stretch ideas

1. **Hands of God:** while frozen, grab and reposition shards, debris or the diving figure (raycast and drag). On resume, the moved objects continue with their original momentum.
2. **Walk through bullets:** a gunfight variant where the freeze reveals tracer rounds with heat-haze trails. Rotate bullets in frozen time to redirect them, and see the outcome after resume.
3. **WebXR bullet-time:** `renderer.xr` with room-scale walking through the frozen explosion. The two-clock design already separates head tracking (real time) from the world (world time).
