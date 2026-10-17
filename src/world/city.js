import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { createRng, hash1 } from '../utils/math.js';
import { createWindowTextures, createNeonTexture, createBillboardTexture } from '../utils/textures.js';

const SIGN_WORDS = ['HOTEL', 'BAR', 'RAMEN', '24H', 'NOODLES', 'KARAOKE', 'OPEN', 'CLUB', 'PHARMACY', 'ARCADE', 'LIQUOR', 'SUSHI', 'NOIR', 'MOTEL', 'TATTOO', 'CYBER', 'PACHINKO', 'DINER', 'JAZZ', 'NEON'];
const BLADE_WORDS = ['HOTEL', 'BAR', 'RAMEN', 'CLUB', 'SUSHI', 'NOIR', 'JAZZ', 'OPEN', 'DINER', 'MOTEL'];

/**
 * The street set: merged building blocks with emissive window atlases,
 * shopfront glows, awnings, neon signage (with deterministic world-time
 * flicker), overhead cables, rooftop beacons and a giant end-of-street
 * billboard. Everything static is merged to keep draw calls low.
 */
export class City {
  constructor(scene, timeUniforms) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'City';
    scene.add(this.group);
    this.timeUniforms = timeUniforms;
    this.signs = [];
    this.textures = [];

    const rng = createRng(1337);
    const W = CONFIG.world;
    const C = CONFIG.colors;
    const facadeX = W.roadHalfWidth + W.sidewalkWidth + 0.4; // 11.4
    this.facadeX = facadeX;
    const L = W.streetHalfLength;

    // --------------------------------------------------------- buildings
    const win = createWindowTextures(21);
    this.textures.push(win.map, win.emissiveMap);
    const buildingGeos = [];
    const storefrontGeos = [];
    const awningGeos = [];
    const palette = [C.pink, C.cyan, C.amber, C.violet, 0xffffff, C.red];

    const addBuilding = (cx, cz, dx, dz, h, facing) => {
      const g = new THREE.BoxGeometry(dx, h, dz);
      g.translate(cx, h / 2, cz);
      const uv = g.attributes.uv;
      const perM = 1 / 96; // 3m per bay, 32 bays per atlas
      const offU = Math.floor(rng() * 32) / 32;
      const offV = Math.floor(rng() * 32) / 32;
      for (let f = 0; f < 6; f++) {
        for (let k = 0; k < 4; k++) {
          const i = f * 4 + k;
          if (f === 2 || f === 3) {
            uv.setXY(i, 0.004 + uv.getX(i) * 0.02, 0.004 + uv.getY(i) * 0.02);
            continue;
          }
          const dimU = f < 2 ? dz : dx;
          uv.setXY(i, uv.getX(i) * dimU * perM + offU, uv.getY(i) * h * perM + offV);
        }
      }
      buildingGeos.push(g);

      if (facing === 0) return;
      // shopfront glow on the street-facing facade
      const sfW = dz - 1.2;
      if (sfW > 2 && rng() < 0.85) {
        const sf = new THREE.PlaneGeometry(sfW, 2.6);
        sf.rotateY(-facing * Math.PI / 2);
        sf.translate(facing * (facadeX - 0.03), 1.6, cz);
        const col = new THREE.Color(rng.pick(palette)).multiplyScalar(rng.range(0.25, 1.1));
        // warm interior bias
        col.lerp(new THREE.Color(0xffc890), 0.35);
        paint(sf, col);
        storefrontGeos.push(sf);
        // neon strip under the awning
        if (rng() < 0.6) {
          const strip = new THREE.BoxGeometry(0.05, 0.05, sfW * 0.9);
          strip.translate(facing * (facadeX - 1.25), 3.12, cz);
          paint(strip, new THREE.Color(rng.pick([C.pink, C.cyan, C.amber])).multiplyScalar(4));
          storefrontGeos.push(strip);
        }
        const aw = new THREE.BoxGeometry(1.3, 0.1, sfW * 0.92);
        aw.rotateZ(facing * 0.12);
        aw.translate(facing * (facadeX - 0.65), 3.25, cz);
        awningGeos.push(aw);
      }
    };

    for (const side of [-1, 1]) {
      let z = -L;
      while (z < L) {
        const w = rng.range(9, 19);
        const d = rng.range(10, 18);
        const nearHero = Math.abs(z + w / 2) < 40;
        const h = nearHero ? rng.range(14, 46) : rng.range(12, 64);
        addBuilding(side * (facadeX + d / 2), z + w / 2, d, w, h, side);
        z += w + (rng() < 0.22 ? rng.range(2, 4) : 0.05);
      }
      // skyline towers behind the street wall
      for (let i = 0; i < 9; i++) {
        const tz = -L + (i + rng()) * ((2 * L) / 9);
        addBuilding(side * rng.range(36, 58), tz, rng.range(14, 22), rng.range(14, 22), rng.range(55, 125), 0);
      }
    }
    // end blocks close the vista in both directions
    addBuilding(0, -L - 14, 70, 24, 78, 0);
    addBuilding(0, L + 14, 70, 24, 70, 0);

    const buildingGeo = mergeGeometries(buildingGeos);
    buildingGeos.forEach((g) => g.dispose());
    const buildingMat = new THREE.MeshStandardMaterial({
      map: win.map,
      emissiveMap: win.emissiveMap,
      emissive: 0xffffff,
      emissiveIntensity: 1.35,
      roughness: 0.7,
      metalness: 0.25,
      envMapIntensity: 0.5,
    });
    this.buildings = new THREE.Mesh(buildingGeo, buildingMat);
    this.group.add(this.buildings);

    const sfGeo = mergeGeometries(storefrontGeos);
    storefrontGeos.forEach((g) => g.dispose());
    this.storefronts = new THREE.Mesh(sfGeo, new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.group.add(this.storefronts);

    const awGeo = mergeGeometries(awningGeos);
    awningGeos.forEach((g) => g.dispose());
    this.awnings = new THREE.Mesh(awGeo, new THREE.MeshStandardMaterial({ color: 0x15161b, roughness: 0.35, metalness: 0.4 }));
    this.group.add(this.awnings);

    // ------------------------------------------------------------- signs
    const backGeos = [];
    const planeH = new THREE.PlaneGeometry(1, 1);
    this.planeGeo = planeH;
    const texCache = new Map();
    const getTex = (word, color, vertical) => {
      const key = `${word}|${color}|${vertical}`;
      if (!texCache.has(key)) {
        const t = createNeonTexture(word, color, vertical);
        texCache.set(key, t);
        this.textures.push(t);
      }
      return texCache.get(key);
    };
    const signColors = [C.pink, C.cyan, C.amber, C.pink, C.cyan, C.violet, C.red];

    const makeSignMaterial = (tex, color, intensity) => {
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        color: new THREE.Color(0xffffff).multiplyScalar(intensity),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      return mat;
    };

    const registerSign = (mat, intensity, seed) => {
      const r = hash1(seed);
      const mode = r < 0.14 ? 'broken' : r < 0.3 ? 'buzz' : 'steady';
      this.signs.push({ mat, base: intensity, seed: seed * 13.37, mode });
    };

    let signSeed = 1;
    for (const side of [-1, 1]) {
      // blade signs (perpendicular to the facade, readable down the street)
      for (let z = -86 + rng() * 8; z < 70; z += rng.range(9, 15)) {
        const color = rng.pick(signColors);
        const word = rng.pick(BLADE_WORDS);
        const tex = getTex(word, color, true);
        const intensity = rng.range(2.6, 4.2);
        const mat = makeSignMaterial(tex, color, intensity);
        const h = rng.range(4.2, 6.4);
        const w = h * 0.25;
        const y = rng.range(5.5, 11) + h / 2;
        const x = side * (facadeX - 0.25 - w / 2);
        for (const face of [1, -1]) {
          const m = new THREE.Mesh(planeH, mat);
          m.scale.set(w, h, 1);
          m.position.set(x, y, z + face * 0.08);
          if (face < 0) m.rotation.y = Math.PI;
          this.group.add(m);
        }
        const back = new THREE.BoxGeometry(w + 0.14, h + 0.14, 0.12);
        back.translate(x, y, z);
        backGeos.push(back);
        const bracket = new THREE.BoxGeometry(0.5, 0.06, 0.06);
        bracket.translate(side * (facadeX - 0.2), y + h * 0.4, z);
        backGeos.push(bracket);
        registerSign(mat, intensity, signSeed++);
      }
      // wall signs (flat on the facade)
      for (let z = -70 + rng() * 10; z < 55; z += rng.range(11, 19)) {
        const color = rng.pick(signColors);
        const word = rng.pick(SIGN_WORDS);
        const tex = getTex(word, color, false);
        const intensity = rng.range(2.2, 3.6);
        const mat = makeSignMaterial(tex, color, intensity);
        const w = rng.range(4.5, 8);
        const m = new THREE.Mesh(planeH, mat);
        m.scale.set(w, w / 4, 1);
        m.position.set(side * (facadeX - 0.06), rng.range(4.2, 9), z);
        m.rotation.y = -side * Math.PI / 2;
        this.group.add(m);
        registerSign(mat, intensity, signSeed++);
      }
    }
    const backGeo = mergeGeometries(backGeos);
    backGeos.forEach((g) => g.dispose());
    this.signBacks = new THREE.Mesh(backGeo, new THREE.MeshStandardMaterial({ color: 0x0a0b0e, roughness: 0.5, metalness: 0.6 }));
    this.group.add(this.signBacks);

    // ---------------------------------------------------------- billboard
    const bbTex = createBillboardTexture();
    this.textures.push(bbTex);
    const bbMat = new THREE.MeshBasicMaterial({ map: bbTex, color: new THREE.Color(1.9, 1.9, 1.9) });
    this.billboard = new THREE.Mesh(new THREE.PlaneGeometry(30, 15), bbMat);
    this.billboard.position.set(0, 34, -L - 1.8);
    this.group.add(this.billboard);
    this.signs.push({ mat: bbMat, base: 1.9, seed: 99, mode: 'steady' });

    // ------------------------------------------------------------- cables
    const cableGeos = [];
    for (let i = 0; i < 12; i++) {
      const z = -80 + i * 14 + rng.range(-4, 4);
      const y0 = rng.range(8.5, 14);
      const y1 = y0 + rng.range(-1.5, 1.5);
      const sag = rng.range(0.8, 2.2);
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(-facadeX, y0, z),
        new THREE.Vector3(0, (y0 + y1) / 2 - sag * 2, z + rng.range(-2, 2)),
        new THREE.Vector3(facadeX, y1, z + rng.range(-3, 3))
      );
      cableGeos.push(new THREE.TubeGeometry(curve, 24, 0.022, 4, false));
    }
    const cableGeo = mergeGeometries(cableGeos);
    cableGeos.forEach((g) => g.dispose());
    this.cables = new THREE.Mesh(cableGeo, new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.6 }));
    this.group.add(this.cables);

    // --------------------------------------------------- rooftop beacons
    const beaconPos = [];
    for (let i = 0; i < 40; i++) {
      const side = rng.sign();
      beaconPos.push(side * rng.range(14, 55), rng.range(30, 120), rng.range(-L, L));
    }
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.Float32BufferAttribute(beaconPos, 3));
    this.beaconMat = new THREE.PointsMaterial({
      color: new THREE.Color(C.red).multiplyScalar(3),
      size: 2.2,
      map: null,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.beacons = new THREE.Points(bGeo, this.beaconMat);
    this.group.add(this.beacons);

    // --------------------------------------------------- neon fill lights
    this.fillLights = [];
    const fills = [
      [C.pink, -10.4, 6.5, -9, 55],
      [C.cyan, 10.4, 5.5, 4, 50],
      [C.amber, -10.2, 4.5, 15, 35],
    ];
    for (const [color, x, y, z, intensity] of fills) {
      const l = new THREE.PointLight(color, intensity, 26, 2);
      l.position.set(x, y, z);
      this.group.add(l);
      this.fillLights.push({ light: l, base: intensity, seed: x * 3.1 + z });
    }
  }

  /** Gives the beacon points a soft glow sprite (shared texture from World). */
  setGlowTexture(tex) {
    this.beaconMat.map = tex;
    this.beaconMat.needsUpdate = true;
  }

  /** All flicker is a pure function of world time: it halts when time stops. */
  update(worldTime) {
    for (let i = 0; i < this.signs.length; i++) {
      const s = this.signs[i];
      let k = 1;
      const t = worldTime + s.seed;
      if (s.mode === 'steady') {
        k = 0.95 + 0.05 * Math.sin(t * 47.0);
      } else if (s.mode === 'buzz') {
        k = hash1(Math.floor(t * 18)) > 0.82 ? 0.35 : 0.92 + 0.08 * Math.sin(t * 90);
      } else {
        const burst = Math.floor(t * 0.45);
        const inBurst = hash1(burst + 0.5) > 0.45 && t * 0.45 - burst < 0.35;
        k = inBurst ? (hash1(Math.floor(t * 24)) > 0.5 ? 1 : 0.05) : 1;
      }
      s.mat.color.setScalar(s.base * k);
    }
    const blink = (Math.sin(worldTime * 2.4) > 0.55 ? 1 : 0.08) * 3;
    this.beaconMat.color.setRGB(blink, blink * 0.12, blink * 0.16);
    for (let i = 0; i < this.fillLights.length; i++) {
      const f = this.fillLights[i];
      f.light.intensity = f.base * (0.92 + 0.08 * Math.sin(worldTime * 31 + f.seed));
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry && o.geometry !== this.planeGeo) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.planeGeo.dispose();
    this.textures.forEach((t) => t.dispose());
    this.scene.remove(this.group);
  }
}

/** Writes a constant (possibly HDR) vertex color into a geometry. */
function paint(geo, color) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}
