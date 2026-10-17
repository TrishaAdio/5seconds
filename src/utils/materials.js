import * as THREE from 'three';

/**
 * Adds a fresnel rim light to a MeshStandard/Physical material.
 * Gives dark silhouettes (characters, wreck) that crisp cinematic edge.
 */
export function addRimLight(material, color = 0x66ccff, strength = 1.0, power = 3.0) {
  const rimColor = new THREE.Color(color).multiplyScalar(strength);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: rimColor };
    shader.uniforms.uRimPower = { value: power };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimPower;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), uRimPower);
          totalEmissiveRadiance += uRimColor * rimF;
        }`
      );
  };
  material.customProgramCacheKey = () => `rim-${power}`;
  return material;
}

/** Recursively disposes geometries, materials and textures under an Object3D. */
export function disposeObject(root) {
  const seen = new Set();
  root.traverse((o) => {
    if (o.geometry && !seen.has(o.geometry)) {
      seen.add(o.geometry);
      o.geometry.dispose();
    }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      for (const key of Object.keys(m)) {
        const v = m[key];
        if (v && v.isTexture && !seen.has(v)) {
          seen.add(v);
          v.dispose();
        }
      }
      if (m.uniforms) {
        for (const u of Object.values(m.uniforms)) {
          if (u && u.value && u.value.isTexture && !seen.has(u.value)) {
            seen.add(u.value);
            u.value.dispose();
          }
        }
      }
      m.dispose();
    }
    if (o.isInstancedMesh) o.dispose();
  });
}
