import * as THREE from 'three';
import { createRng } from './math.js';

/** Procedural canvas textures — no external assets are downloaded. */

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c, { srgb = true, repeat = false, anisotropy = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

const css = (hex, a = 1) => {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
};

/**
 * Building facade atlas: a 32x32 grid of window bays. Returns a base color
 * map (wall + dark glass) and an emissive map (lit windows only).
 * Texel (0..1/32, 0..1/32) region is guaranteed to be plain wall (used by roofs).
 */
export function createWindowTextures(seed = 7) {
  const rng = createRng(seed);
  const size = 1024;
  const cells = 32;
  const cell = size / cells;
  const base = canvas(size, size);
  const emit = canvas(size, size);
  const b = base.getContext('2d');
  const e = emit.getContext('2d');

  b.fillStyle = '#0d0f15';
  b.fillRect(0, 0, size, size);
  e.fillStyle = '#000';
  e.fillRect(0, 0, size, size);

  const warm = ['#ffd6a0', '#ffc27a', '#ffe7c4', '#ffb35c'];
  const cool = ['#a8dcff', '#c9ecff', '#8fc8ff'];
  const neon = ['#ff5ad9', '#4df2ff', '#b18cff'];

  for (let row = 0; row < cells; row++) {
    // Whole floors tend to be lit or dark together: more believable.
    const floorLit = rng() < 0.55 ? 0.42 : 0.12;
    for (let col = 0; col < cells; col++) {
      const x = col * cell;
      const y = row * cell;
      // subtle panel variation
      b.fillStyle = rng() < 0.5 ? '#10131a' : '#0b0d12';
      b.fillRect(x, y, cell, cell);
      if (row === cells - 1 && col === 0) continue; // keep roof texel clean (canvas y is flipped)
      const wx = x + 5;
      const wy = y + 7;
      const ww = cell - 10;
      const wh = cell - 12;
      b.fillStyle = '#141a26';
      b.fillRect(wx, wy, ww, wh);
      b.fillStyle = 'rgba(120,140,170,0.08)';
      b.fillRect(wx, wy, ww, wh * 0.35);
      if (rng() < floorLit) {
        const r = rng();
        const color = r < 0.72 ? rng.pick(warm) : r < 0.95 ? rng.pick(cool) : rng.pick(neon);
        const g = e.createLinearGradient(0, wy, 0, wy + wh);
        const k = 0.55 + rng() * 0.45;
        g.addColorStop(0, css(color, 0.55 * k));
        g.addColorStop(0.6, css(color, k));
        g.addColorStop(1, css(color, 0.8 * k));
        e.fillStyle = g;
        e.fillRect(wx, wy, ww, wh);
        // blinds / silhouettes
        if (rng() < 0.35) {
          e.fillStyle = 'rgba(0,0,0,0.55)';
          const bl = Math.floor(rng() * 4) + 2;
          for (let i = 0; i < bl; i++) e.fillRect(wx, wy + (wh / bl) * i, ww, 1.5);
        }
        if (rng() < 0.15) {
          e.fillStyle = 'rgba(0,0,0,0.7)';
          e.fillRect(wx + ww * rng() * 0.6, wy + wh * 0.35, ww * 0.25, wh * 0.65);
        }
        b.fillStyle = css(color, 0.25);
        b.fillRect(wx, wy, ww, wh);
      }
    }
  }
  return {
    map: toTexture(base, { repeat: true }),
    emissiveMap: toTexture(emit, { repeat: true }),
  };
}

/**
 * Asphalt for the road: color (with lane markings) + puddle mask used as
 * alphaMap/roughnessMap (dark = puddle = mirror).
 * Tile covers 14m x 28m.
 */
export function createAsphaltTextures(seed = 3) {
  const rng = createRng(seed);
  const w = 512;
  const h = 1024;
  const col = canvas(w, h);
  const mask = canvas(w, h);
  const c = col.getContext('2d');
  const m = mask.getContext('2d');

  // grain
  const img = c.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const n = 16 + rng() * 14 + (rng() < 0.03 ? 18 : 0);
    img.data[i * 4] = n;
    img.data[i * 4 + 1] = n + 1;
    img.data[i * 4 + 2] = n + 4;
    img.data[i * 4 + 3] = 255;
  }
  c.putImageData(img, 0, 0);

  // tar seams / cracks
  c.strokeStyle = 'rgba(0,0,0,0.5)';
  for (let i = 0; i < 26; i++) {
    c.lineWidth = 1 + rng() * 2;
    c.beginPath();
    let x = rng() * w;
    let y = rng() * h;
    c.moveTo(x, y);
    for (let k = 0; k < 8; k++) {
      x += (rng() - 0.5) * 60;
      y += (rng() - 0.3) * 50;
      c.lineTo(x, y);
    }
    c.stroke();
  }

  const px = w / 14; // pixels per metre
  // centre dashed line
  c.fillStyle = 'rgba(225,225,215,0.75)';
  for (let z = 0; z < 28; z += 7) c.fillRect(w / 2 - 0.07 * px, (z + 1) * px, 0.14 * px, 3.5 * px);
  // edge lines
  c.fillStyle = 'rgba(230,200,120,0.6)';
  c.fillRect(0.4 * px, 0, 0.12 * px, h);
  c.fillRect(w - 0.52 * px, 0, 0.12 * px, h);

  // puddle mask: light = asphalt, dark = standing water
  m.fillStyle = 'rgb(200,200,200)';
  m.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = 20 + rng() * 90;
    const g = m.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(20,20,20,0.95)');
    g.addColorStop(0.6, 'rgba(40,40,40,0.6)');
    g.addColorStop(1, 'rgba(200,200,200,0)');
    m.fillStyle = g;
    m.beginPath();
    m.ellipse(x, y, r * (0.6 + rng()), r, rng() * Math.PI, 0, Math.PI * 2);
    m.fill();
  }
  // water collects in the tyre tracks
  m.fillStyle = 'rgba(60,60,60,0.35)';
  for (const lx of [3.0, 6.1, 7.9, 11.0]) m.fillRect(lx * px, 0, 0.9 * px, h);

  return {
    map: toTexture(col, { repeat: true }),
    mask: toTexture(mask, { srgb: false, repeat: true }),
  };
}

/** Wet concrete sidewalk tiles (1m grid). Tile = 4m x 4m. */
export function createSidewalkTexture(seed = 11) {
  const rng = createRng(seed);
  const s = 256;
  const c = canvas(s, s);
  const g = c.getContext('2d');
  g.fillStyle = '#2a2c31';
  g.fillRect(0, 0, s, s);
  const t = s / 4;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const v = 34 + Math.floor(rng() * 14);
      g.fillStyle = `rgb(${v},${v + 1},${v + 5})`;
      g.fillRect(x * t + 1, y * t + 1, t - 2, t - 2);
    }
  }
  return toTexture(c, { repeat: true });
}

/** Soft radial glow sprite. */
export function createGlowTexture(inner = 'rgba(255,255,255,1)') {
  const s = 128;
  const c = canvas(s, s);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.2, 'rgba(255,255,255,0.45)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  return toTexture(c, { anisotropy: 1 });
}

/** Wispy haze blob for fake volumetric fog sprites. */
export function createHazeTexture(seed = 5) {
  const rng = createRng(seed);
  const s = 256;
  const c = canvas(s, s);
  const g = c.getContext('2d');
  for (let i = 0; i < 40; i++) {
    const x = s / 2 + (rng() - 0.5) * s * 0.5;
    const y = s / 2 + (rng() - 0.5) * s * 0.35;
    const r = s * (0.1 + rng() * 0.25);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.12)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  }
  return toTexture(c, { anisotropy: 1 });
}

/** Headlight pool on the wet road: elongated gradient. */
export function createBeamTexture() {
  const w = 128;
  const h = 256;
  const c = canvas(w, h);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(w / 2, h * 0.95, 0, w / 2, h * 0.95, h * 0.95);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  return toTexture(c, { anisotropy: 4 });
}

/**
 * Neon tube lettering. Drawn as glow + hot white core on black, meant for
 * additive blending with an HDR color multiplier.
 */
export function createNeonTexture(text, color, vertical = false, font = 'sans-serif') {
  const w = vertical ? 128 : 512;
  const h = vertical ? 512 : 128;
  const c = canvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  const col = css(color, 1);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';

  const drawText = (fn) => {
    if (vertical) {
      const letters = text.split('');
      const step = Math.min(92, (h - 40) / letters.length);
      g.font = `600 ${Math.floor(step * 0.86)}px ${font}`;
      const start = h / 2 - ((letters.length - 1) * step) / 2;
      letters.forEach((ch, i) => fn(ch, w / 2, start + i * step));
    } else {
      let size = 88;
      g.font = `600 ${size}px ${font}`;
      while (g.measureText(text).width > w - 50 && size > 20) {
        size -= 4;
        g.font = `600 ${size}px ${font}`;
      }
      fn(text, w / 2, h / 2 + 4);
    }
  };

  // outer glow
  g.shadowColor = col;
  g.shadowBlur = 28;
  g.strokeStyle = col;
  g.lineWidth = 10;
  drawText((t, x, y) => g.strokeText(t, x, y));
  g.shadowBlur = 12;
  g.lineWidth = 6;
  drawText((t, x, y) => g.strokeText(t, x, y));
  // hot core
  g.shadowBlur = 4;
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 2;
  drawText((t, x, y) => g.strokeText(t, x, y));

  // tube frame
  g.shadowBlur = 16;
  g.strokeStyle = col;
  g.lineWidth = 4;
  g.strokeRect(10, 10, w - 20, h - 20);

  return toTexture(c, { anisotropy: 4 });
}

/** Big end-of-street billboard. */
export function createBillboardTexture() {
  const w = 1024;
  const h = 512;
  const c = canvas(w, h);
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#2a0838');
  bg.addColorStop(0.5, '#090d2b');
  bg.addColorStop(1, '#03222c');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  // face silhouette circle
  const rad = g.createRadialGradient(w * 0.74, h * 0.5, 10, w * 0.74, h * 0.5, 230);
  rad.addColorStop(0, 'rgba(255,90,200,0.9)');
  rad.addColorStop(0.5, 'rgba(120,40,200,0.35)');
  rad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,0.85)';
  g.beginPath();
  g.ellipse(w * 0.74, h * 0.56, 80, 110, 0, 0, Math.PI * 2);
  g.fill();
  g.fillRect(w * 0.74 - 130, h * 0.8, 260, 140);
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.shadowColor = '#19e6ff';
  g.shadowBlur = 30;
  g.fillStyle = '#e8fbff';
  g.font = '200 120px sans-serif';
  g.fillText('CHRONO', 60, 220);
  g.shadowColor = '#ff2bd6';
  g.fillStyle = '#ffd6f6';
  g.font = '600 54px sans-serif';
  g.fillText('EVERY SECOND COUNTS', 64, 300);
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.font = '300 26px sans-serif';
  g.fillText('NEO-DISTRICT 05  //  OPEN ALL NIGHT', 66, 360);
  // scanlines
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
  return toTexture(c, { anisotropy: 8 });
}
