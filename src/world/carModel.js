import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural low-poly sedan. Geometry is built once and shared by every car:
 * each car is 5 meshes (body, glass, trim/wheels, headlights, taillights).
 * Car length runs along local +X (front at +X).
 */
let shared = null;

function buildShared() {
  const body = [];
  const glass = [];
  const dark = [];
  const head = [];
  const tail = [];

  // lower body
  const lower = new THREE.BoxGeometry(4.5, 0.62, 1.86);
  lower.translate(0, 0.6, 0);
  body.push(lower);
  // hood wedge: taper front-top vertices down
  const hood = new THREE.BoxGeometry(1.25, 0.16, 1.8);
  hood.translate(1.55, 0.98, 0);
  body.push(hood);
  // cabin (glass), tapered toward the roof
  const cabin = new THREE.BoxGeometry(2.35, 0.56, 1.62, 1, 1, 1);
  const p = cabin.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) {
      p.setX(i, p.getX(i) * 0.72 - 0.12);
      p.setZ(i, p.getZ(i) * 0.86);
    }
  }
  cabin.computeVertexNormals();
  cabin.translate(-0.25, 1.18, 0);
  glass.push(cabin);
  // roof
  const roof = new THREE.BoxGeometry(1.62, 0.06, 1.36);
  roof.translate(-0.37, 1.47, 0);
  body.push(roof);
  // bumpers / skirts
  const fb = new THREE.BoxGeometry(0.16, 0.26, 1.9);
  fb.translate(2.28, 0.42, 0);
  dark.push(fb);
  const rb = fb.clone();
  rb.translate(-4.56, 0, 0);
  dark.push(rb);
  const skirt = new THREE.BoxGeometry(3.0, 0.12, 1.9);
  skirt.translate(0, 0.3, 0);
  dark.push(skirt);
  // wheels
  for (const [x, z] of [[1.45, 0.86], [1.45, -0.86], [-1.45, 0.86], [-1.45, -0.86]]) {
    const w = new THREE.CylinderGeometry(0.37, 0.37, 0.26, 16);
    w.rotateX(Math.PI / 2);
    w.translate(x, 0.37, z);
    dark.push(w);
  }
  // headlights + DRL strip
  for (const z of [0.62, -0.62]) {
    const h = new THREE.BoxGeometry(0.06, 0.12, 0.42);
    h.translate(2.26, 0.74, z);
    head.push(h);
  }
  const drl = new THREE.BoxGeometry(0.04, 0.03, 1.5);
  drl.translate(2.27, 0.86, 0);
  head.push(drl);
  // taillights: full-width bar
  const tl = new THREE.BoxGeometry(0.05, 0.08, 1.7);
  tl.translate(-2.26, 0.8, 0);
  tail.push(tl);

  const merge = (arr) => {
    const g = mergeGeometries(arr);
    arr.forEach((a) => a.dispose());
    return g;
  };
  shared = {
    body: merge(body),
    glass: merge(glass),
    dark: merge(dark),
    head: merge(head),
    tail: merge(tail),
    glassMat: new THREE.MeshStandardMaterial({ color: 0x05070b, roughness: 0.05, metalness: 0.9, envMapIntensity: 1.6 }),
    darkMat: new THREE.MeshStandardMaterial({ color: 0x070708, roughness: 0.75, metalness: 0.2 }),
    headMat: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.96, 0.9).multiplyScalar(9) }),
    tailMat: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.05, 0.08).multiplyScalar(5) }),
    bodyMats: new Map(),
  };
  return shared;
}

export function getCarShared() {
  return shared || buildShared();
}

export function getBodyMaterial(color) {
  const s = getCarShared();
  if (!s.bodyMats.has(color)) {
    s.bodyMats.set(
      color,
      new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0.65, clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 1.3 })
    );
  }
  return s.bodyMats.get(color);
}

/** Builds a car Group. Pass a custom bodyMaterial for one-off cars (the hero). */
export function createCar(color = 0x22252c, { bodyMaterial = null, lights = true } = {}) {
  const s = getCarShared();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(s.body, bodyMaterial || getBodyMaterial(color)));
  g.add(new THREE.Mesh(s.glass, s.glassMat));
  g.add(new THREE.Mesh(s.dark, s.darkMat));
  if (lights) {
    g.add(new THREE.Mesh(s.head, s.headMat));
    g.add(new THREE.Mesh(s.tail, s.tailMat));
  }
  return g;
}

export function disposeCarShared() {
  if (!shared) return;
  ['body', 'glass', 'dark', 'head', 'tail'].forEach((k) => shared[k].dispose());
  ['glassMat', 'darkMat', 'headMat', 'tailMat'].forEach((k) => shared[k].dispose());
  shared.bodyMats.forEach((m) => m.dispose());
  shared = null;
}
