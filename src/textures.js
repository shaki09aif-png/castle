// PBR-наборы текстур: цвет (color), нормали (normal), ORM (R — ambient occlusion,
// G — шероховатость). Если в public/assets лежат фотоскан-текстуры Poly Haven
// (см. README и scripts/download-assets.mjs), берутся они. Иначе — процедурные
// текстуры, которые рисуются здесь же, на <canvas>.
import * as THREE from 'three';
import { createTileNoise, mulberry32, clamp, smoothstep } from './noise.js';

let ANISO = 8;
export function setAnisotropy(n) {
  ANISO = n;
}

let LOADED = {}; // slot -> { color, normal, orm, tileMeters, credit }
export function setLoadedAssets(sets) {
  LOADED = sets || {};
}
export function assetSource(slot) {
  return LOADED[slot] ? 'polyhaven' : 'procedural';
}

const cache = new Map();
function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function toTexture(canvas, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISO;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export function rgbToCanvas(rgb, w, h, alpha = null) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0, j = 0; i < w * h; i++, j += 3) {
    img.data[i * 4] = clamp(rgb[j] * 255, 0, 255);
    img.data[i * 4 + 1] = clamp(rgb[j + 1] * 255, 0, 255);
    img.data[i * 4 + 2] = clamp(rgb[j + 2] * 255, 0, 255);
    img.data[i * 4 + 3] = alpha ? clamp(alpha[i] * 255, 0, 255) : 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Карта нормалей из карты высот (бесшовно). strength — «крутизна» рельефа.
export function heightToNormalCanvas(height, w, h, strength = 2, wrap = true) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const ym = (wrap ? (y - 1 + h) % h : Math.max(0, y - 1)) * w;
    const yp = (wrap ? (y + 1) % h : Math.min(h - 1, y + 1)) * w;
    for (let x = 0; x < w; x++) {
      const xm = wrap ? (x - 1 + w) % w : Math.max(0, x - 1);
      const xp = wrap ? (x + 1) % w : Math.min(w - 1, x + 1);
      const dx = (height[y * w + xp] - height[y * w + xm]) * strength;
      const dy = (height[yp + x] - height[ym + x]) * strength;
      const nx = -dx, ny = dy, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * w + x) * 4;
      img.data[i] = (nx / len * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Размытие (бесшовное) — для вычисления затенения впадин.
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += src[y * w + ((i + w) % w)];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s * k;
      s += src[y * w + ((x + r + 1) % w)] - src[y * w + ((x - r + w) % w)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += tmp[((i + h) % h) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s * k;
      s += tmp[((y + r + 1) % h) * w + x] - tmp[((y - r + h) % h) * w + x];
    }
  }
  return out;
}

// ORM: R — затенение впадин (из карты высот), G — шероховатость.
function ormCanvas(height, rough, w, h, aoStrength = 2.5, radius = 6) {
  const blur = boxBlur(boxBlur(height, w, h, radius), w, h, radius);
  const rgb = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3] = clamp(1 - Math.max(0, blur[i] - height[i]) * aoStrength, 0.25, 1);
    rgb[i * 3 + 1] = typeof rough === 'number' ? rough : rough[i];
    rgb[i * 3 + 2] = 0;
  }
  return rgbToCanvas(rgb, w, h);
}

function finishSet(rgb, hgt, rough, S, { normal = 2, ao = 2.5, aoRadius = 6, tileMeters = 2 } = {}) {
  return {
    color: rgbToCanvas(rgb, S, S),
    normal: heightToNormalCanvas(hgt, S, S, normal),
    orm: ormCanvas(hgt, rough, S, S, ao, aoRadius),
    tileMeters,
    size: S,
    credit: null,
  };
}

// Разбросать по тайлу «камешки» — округлые купола со своим цветом.
function scatterStones(rgb, hgt, rough, S, n, rnd, { rMin, rMax, colorFn, heightK = 1, roughV = 0.7, flat = 1 }) {
  for (let k = 0; k < n; k++) {
    const cx = rnd() * S, cy = rnd() * S;
    const r = rMin + (rMax - rMin) * Math.pow(rnd(), 2);
    const ry = r * (0.6 + rnd() * 0.4);
    const ang = rnd() * Math.PI;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const col = colorFn(rnd);
    const hh = r * heightK * 0.06;
    for (let yy = Math.floor(cy - r - 1); yy <= cy + r + 1; yy++) {
      for (let xx = Math.floor(cx - r - 1); xx <= cx + r + 1; xx++) {
        const dx = xx - cx, dy = yy - cy;
        const u = (dx * ca + dy * sa) / r, v = (-dx * sa + dy * ca) / ry;
        const d = u * u + v * v;
        if (d >= 1) continue;
        const x = ((xx % S) + S) % S, y = ((yy % S) + S) % S;
        const i = y * S + x;
        const dome = Math.pow(1 - d, 0.5 / flat) * hh;
        if (dome + 0.02 < hgt[i]) continue;
        hgt[i] = dome + 0.02;
        const sh = 0.8 + 0.25 * (1 - d) - 0.12 * u;
        rgb[i * 3] = col[0] * sh; rgb[i * 3 + 1] = col[1] * sh; rgb[i * 3 + 2] = col[2] * sh;
        if (rough) rough[i] = roughV;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Процедурные наборы
// ---------------------------------------------------------------------------
const GENERATORS = {
  // Луговая трава с землёй между кустиками
  grass() {
    const S = 512;
    const n = createTileNoise(11);
    const rnd = mulberry32(12);
    const rgb = new Float32Array(S * S * 3);
    const hgt = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const big = n.fbm(u, v, 4, 4);
        const mid = n.fbm(u + 0.37, v + 0.11, 16, 3);
        const dry = smoothstep(0.55, 0.75, n.fbm(u + 0.7, v + 0.2, 8, 3));
        const soil = smoothstep(0.62, 0.78, n.fbm(u + 0.1, v + 0.5, 16, 3));
        let r = 0.2 + 0.07 * big + 0.05 * mid;
        let g = 0.27 + 0.08 * big + 0.06 * mid;
        let b = 0.1 + 0.03 * mid;
        r += dry * 0.12; g += dry * 0.05; b += dry * 0.02;
        r = r * (1 - soil * 0.6) + soil * 0.6 * 0.28;
        g = g * (1 - soil * 0.6) + soil * 0.6 * 0.23;
        b = b * (1 - soil * 0.6) + soil * 0.6 * 0.15;
        const k = 0.8 + rnd() * 0.3;
        const i = y * S + x;
        rgb[i * 3] = r * k; rgb[i * 3 + 1] = g * k; rgb[i * 3 + 2] = b * k;
        hgt[i] = mid * 0.3 - soil * 0.4 + rnd() * 0.1;
      }
    }
    // травинки: короткие штрихи со своей высотой
    for (let k = 0; k < 16000; k++) {
      let x = rnd() * S, y = rnd() * S;
      const len = 4 + rnd() * 9;
      const ang = -Math.PI / 2 + (rnd() - 0.5) * 1.6;
      const light = rnd();
      const cr = 0.16 + light * 0.2, cg = 0.25 + light * 0.25, cb = 0.06 + light * 0.08;
      for (let s = 0; s < len; s++) {
        const px = ((Math.round(x) % S) + S) % S, py = ((Math.round(y) % S) + S) % S;
        const i = py * S + px;
        const t = s / len;
        hgt[i] = Math.max(hgt[i], 0.4 + t * 0.6);
        rgb[i * 3] = cr * (0.7 + t * 0.5); rgb[i * 3 + 1] = cg * (0.7 + t * 0.5); rgb[i * 3 + 2] = cb;
        x += Math.cos(ang); y += Math.sin(ang);
      }
    }
    return finishSet(rgb, hgt, 0.92, S, { normal: 3, ao: 1.4, aoRadius: 3, tileMeters: 2.2 });
  },

  // Известняковая скала: пласты, трещины, лишайник
  rock() {
    const S = 512;
    const n = createTileNoise(21);
    const rnd = mulberry32(22);
    const rgb = new Float32Array(S * S * 3);
    const hgt = new Float32Array(S * S);
    const rough = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const base = n.fbm(u, v, 4, 6, 0.55);
        const warp = n.fbm(u + 0.5, v + 0.3, 4, 3);
        const layer = (v * 5 + warp * 0.9) % 1;
        const strata = smoothstep(0.0, 0.1, layer) * (1 - smoothstep(0.88, 1.0, layer));
        const rn = 1 - Math.abs(n.fbm(u + 0.13, v + 0.71, 4, 4) * 2 - 1);
        const crack = smoothstep(0.95, 0.99, rn) * smoothstep(0.45, 0.65, n.fbm(u + 0.4, v, 8, 2));
        const pits = smoothstep(0.62, 0.72, n.fbm(u + 0.21, v + 0.37, 32, 3));
        const lichen = smoothstep(0.66, 0.74, n.fbm(u + 0.9, v + 0.4, 16, 3)) * 0.8;
        const moss = smoothstep(0.62, 0.8, n.fbm(u + 0.2, v + 0.8, 4, 4) * 0.75 + (1 - strata) * 0.25);
        let t = 0.45 + 0.28 * (base - 0.5) + (rnd() - 0.5) * 0.07;
        t *= 0.84 + 0.16 * strata;
        t *= 1 - pits * 0.18;
        let r = t * 1.04, g = t * 1.0, b = t * 0.9;
        const warm = smoothstep(0.45, 0.7, n.fbm(u + 0.33, v + 0.66, 4, 3));
        r += warm * 0.07; g += warm * 0.025; b -= warm * 0.02;
        r *= 1 - crack * 0.4; g *= 1 - crack * 0.4; b *= 1 - crack * 0.36;
        r += (0.66 - r) * lichen * 0.4; g += (0.64 - g) * lichen * 0.4; b += (0.46 - b) * lichen * 0.4;
        r += (0.26 - r) * moss * 0.45; g += (0.32 - g) * moss * 0.45; b += (0.13 - b) * moss * 0.45;
        const i = y * S + x;
        rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
        hgt[i] = base * 1.4 + strata * 0.35 + n.fbm(u, v, 32, 3) * 0.3 - crack * 0.8 - pits * 0.15;
        rough[i] = 0.82 + 0.1 * pits - moss * 0.05 + (1 - strata) * 0.05;
      }
    }
    return finishSet(rgb, hgt, rough, S, { normal: 4, ao: 2.2, aoRadius: 8, tileMeters: 4 });
  },

  // Утоптанная земля дороги/тропы с камешками
  dirt() {
    const S = 512;
    const n = createTileNoise(31);
    const rnd = mulberry32(32);
    const rgb = new Float32Array(S * S * 3);
    const hgt = new Float32Array(S * S);
    const rough = new Float32Array(S * S).fill(0.95);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const a = n.fbm(u, v, 8, 5);
        const b2 = n.fbm(u + 0.4, v + 0.2, 32, 3);
        const t = 0.3 + 0.16 * (a - 0.5) + 0.07 * (b2 - 0.5) + (rnd() - 0.5) * 0.05;
        const i = y * S + x;
        rgb[i * 3] = t * 1.22; rgb[i * 3 + 1] = t * 1.0; rgb[i * 3 + 2] = t * 0.74;
        hgt[i] = a * 0.25 + b2 * 0.12;
      }
    }
    scatterStones(rgb, hgt, rough, S, 900, rnd, {
      rMin: 1.2, rMax: 7, heightK: 1.2, roughV: 0.75,
      colorFn: (r) => { const g = 0.35 + r() * 0.3; return [g * 1.02, g * 0.97, g * 0.86]; },
    });
    return finishSet(rgb, hgt, rough, S, { normal: 5, ao: 3, aoRadius: 4, tileMeters: 3 });
  },

  // Галька и ил у воды, осыпи
  gravel() {
    const S = 512;
    const n = createTileNoise(51);
    const rnd = mulberry32(52);
    const rgb = new Float32Array(S * S * 3);
    const hgt = new Float32Array(S * S);
    const rough = new Float32Array(S * S).fill(0.6);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const a = n.fbm(u, v, 8, 5);
        const t = 0.24 + 0.1 * (a - 0.5) + (rnd() - 0.5) * 0.05;
        const i = y * S + x;
        rgb[i * 3] = t * 1.1; rgb[i * 3 + 1] = t * 1.0; rgb[i * 3 + 2] = t * 0.82;
        hgt[i] = a * 0.1;
      }
    }
    scatterStones(rgb, hgt, rough, S, 2600, rnd, {
      rMin: 3, rMax: 14, heightK: 1, roughV: 0.55, flat: 0.8,
      colorFn: (r) => {
        const g = 0.3 + r() * 0.35, w = (r() - 0.5) * 0.08;
        return [g + w, g * 0.97, g * 0.9 - w];
      },
    });
    return finishSet(rgb, hgt, rough, S, { normal: 5, ao: 3.5, aoRadius: 5, tileMeters: 1.6 });
  },

  // Тёсаная и полутёсаная кладка стен из известняка
  wallStone() {
    return makeMasonry({
      seed: 7, courseMin: 34, courseMax: 72, lenMin: 0.8, lenMax: 2.3, mortar: 2.4, jitter: 3.2,
      base: [0.6, 0.56, 0.48], tint: 0.12, mortarColor: [0.6, 0.57, 0.5], tileMeters: 3.8,
    });
  },

  // Бутовая кладка подпорных стенок
  rubbleStone() {
    return makeMasonry({
      seed: 17, courseMin: 34, courseMax: 64, lenMin: 0.8, lenMax: 2.0, rubble: 1, mortar: 3,
      base: [0.55, 0.52, 0.46], tint: 0.16, tileMeters: 2.6,
    });
  },

  // Дубовые доски: волокна, сучки, щели между досками
  wood() {
    const S = 512;
    const n = createTileNoise(81);
    const rnd = mulberry32(82);
    const rgb = new Float32Array(S * S * 3);
    const hgt = new Float32Array(S * S);
    const rough = new Float32Array(S * S);
    const PL = 4; // досок на тайл
    const planks = [];
    for (let p = 0; p < PL; p++) planks.push({ tone: 0.85 + rnd() * 0.3, off: rnd(), knots: [[rnd(), rnd()], [rnd(), rnd()]] });
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const pi = Math.floor(u * PL);
        const pl = planks[pi];
        const lu = u * PL - pi;
        const gap = smoothstep(0.0, 0.025, lu) * smoothstep(1.0, 0.975, lu);
        const warp = n.fbm(u, v + pl.off, 4, 3) * 0.15;
        let knot = 0;
        for (const [kx, ky] of pl.knots) {
          const dx = lu - kx, dy = v - ky;
          const d = Math.sqrt(dx * dx + dy * dy * 1.5) * 12;
          knot = Math.max(knot, Math.exp(-d * d));
        }
        const grain = Math.sin((lu * 18 + warp * 40 + knot * 3) * Math.PI) * 0.5 + 0.5;
        const fine = n.fbm(u * 0.25, v + pl.off, 64, 3);
        let t = (0.34 + 0.08 * grain + 0.06 * fine) * pl.tone;
        t *= 1 - knot * 0.35;
        const weather = smoothstep(0.5, 0.8, n.fbm(u + 0.3, v, 8, 3));
        let r = t * 1.12, g = t * 0.9, b = t * 0.66;
        r += (t - r) * weather * 0.5; b += (t * 0.95 - b) * weather * 0.5; // серые выветренные места
        const i = y * S + x;
        const k = gap < 0.5 ? 0.25 : 1;
        rgb[i * 3] = r * k; rgb[i * 3 + 1] = g * k; rgb[i * 3 + 2] = b * k;
        hgt[i] = gap * (0.6 + grain * 0.12 + fine * 0.1) - knot * 0.1;
        rough[i] = 0.78 + weather * 0.12;
      }
    }
    return finishSet(rgb, hgt, rough, S, { normal: 3, ao: 2, aoRadius: 3, tileMeters: 1.2 });
  },

  // Черепица «бобровый хвост»: 4 ряда по 6 плиток со смещением, разные оттенки,
  // лишайник и сажа. Каждый ряд геометрии крыши берёт одну полосу текстуры.
  roof() {
    return tileRoof({ seed: 141, per: 6, round: true, palette: (l, age) => (age > 0.85 ? [0.36 * l, 0.26 * l, 0.2 * l] : [0.55 * l, 0.29 * l + age * 0.04, 0.19 * l]) });
  },

  // Деревянная дранка (лемех): узкие дощечки, серо-коричневые, выветренные
  shingle() {
    return tileRoof({ seed: 171, per: 9, round: false, grain: true, palette: (l, age) => {
      const g = (0.34 + age * 0.12) * l;
      return [g * 1.08, g * 0.98, g * 0.86];
    } });
  },


  // Булыжная мостовая: окатанные камни, утопленные в утоптанную землю
  cobble() {
    const S = 512;
    const n = createTileNoise(151);
    const rnd = mulberry32(152);
    const rgb = new Float32Array(S * S * 3);
    const hgt = new Float32Array(S * S);
    const rough = new Float32Array(S * S).fill(0.95);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const a = n.fbm(u, v, 16, 4);
        const t = 0.2 + 0.08 * (a - 0.5) + (rnd() - 0.5) * 0.04;
        const i = y * S + x;
        rgb[i * 3] = t * 1.2; rgb[i * 3 + 1] = t * 1.02; rgb[i * 3 + 2] = t * 0.78;
        hgt[i] = a * 0.05;
      }
    }
    scatterStones(rgb, hgt, rough, S, 1500, rnd, {
      rMin: 11, rMax: 20, heightK: 0.7, roughV: 0.7, flat: 0.7,
      colorFn: (r) => {
        const g = 0.26 + r() * 0.2, w = r() * 0.06;
        return [g + w, g * 0.94 + w * 0.4, g * 0.8];
      },
    });
    // мох и земля в швах
    for (let i = 0; i < S * S; i++) {
      if (hgt[i] < 0.1) {
        const m = n.fbm((i % S) / S + 0.3, Math.floor(i / S) / S, 8, 3);
        if (m > 0.55) { rgb[i * 3] *= 0.7; rgb[i * 3 + 1] *= 0.95; rgb[i * 3 + 2] *= 0.6; }
      }
    }
    return finishSet(rgb, hgt, rough, S, { normal: 3, ao: 4, aoRadius: 5, tileMeters: 2.4 });
  },

  // Кора дуба/бука: продольные борозды
  bark() {
    const S = 256;
    const n = createTileNoise(91);
    const rnd = mulberry32(92);
    const rgb = new Float32Array(S * S * 3);
    const hgt = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const warp = n.fbm(u, v, 4, 3) * 0.25;
        const ridge = Math.abs(Math.sin((u * 7 + warp) * Math.PI));
        const cracks = smoothstep(0.0, 0.25, ridge);
        const f = n.fbm(u + 0.3, v * 0.3, 32, 3);
        const moss = smoothstep(0.6, 0.75, n.fbm(u + 0.5, v, 4, 3));
        let t = (0.2 + 0.12 * cracks + 0.06 * f) * (0.9 + rnd() * 0.15);
        let r = t * 1.05, g = t * 0.92, b = t * 0.78;
        r += (0.2 - r) * moss * 0.5; g += (0.26 - g) * moss * 0.5; b += (0.1 - b) * moss * 0.5;
        const i = y * S + x;
        rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
        hgt[i] = cracks * 0.8 + f * 0.3;
      }
    }
    return finishSet(rgb, hgt, 0.95, S, { normal: 6, ao: 2.5, aoRadius: 3, tileMeters: 1 });
  },

  // Берёзовая кора: белая с чёрными чечевичками
  birchBark() {
    const S = 256;
    const n = createTileNoise(95);
    const rnd = mulberry32(96);
    const rgb = new Float32Array(S * S * 3);
    const hgt = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const lent = smoothstep(0.72, 0.8, n.fbm(u * 0.3 + 0.2, v * 3, 16, 3)); // горизонтальные штрихи
        const dark = smoothstep(0.6, 0.75, n.fbm(u, v, 4, 3));
        let t = 0.78 - 0.1 * n.fbm(u, v, 32, 2) + (rnd() - 0.5) * 0.04;
        t *= 1 - lent * 0.75;
        t *= 1 - dark * 0.55;
        const i = y * S + x;
        rgb[i * 3] = t * 1.0; rgb[i * 3 + 1] = t * 0.98; rgb[i * 3 + 2] = t * 0.93;
        hgt[i] = 1 - lent * 0.6 - dark * 0.3;
      }
    }
    return finishSet(rgb, hgt, 0.8, S, { normal: 3, ao: 1.5, aoRadius: 2, tileMeters: 1 });
  },
};

// Атлас листвы с прозрачностью: kind = 'broad' (дуб, бук, берёза) или 'needle' (сосна)
export function foliageTexture(kind, hue = [0.2, 0.32, 0.1]) {
  return cached('leaf:' + kind + hue.join(), () => {
    const S = 512;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    const rnd = mulberry32(kind === 'needle' ? 131 : 121);
    const col = (k) => {
      const l = 0.7 + rnd() * 0.6;
      return `rgb(${Math.min(255, hue[0] * l * 255 * k) | 0},${Math.min(255, hue[1] * l * 255 * k) | 0},${Math.min(255, hue[2] * l * 255 * k) | 0})`;
    };
    if (kind === 'needle') {
      // пучки хвои вдоль веточек
      for (let b = 0; b < 26; b++) {
        const x0 = S * (0.15 + rnd() * 0.7), y0 = S * (0.15 + rnd() * 0.7);
        const a = rnd() * Math.PI * 2, len = S * (0.12 + rnd() * 0.15);
        ctx.strokeStyle = 'rgb(70,50,30)';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len); ctx.stroke();
        for (let k = 0; k < 60; k++) {
          const t = rnd();
          const px = x0 + Math.cos(a) * len * t, py = y0 + Math.sin(a) * len * t;
          const na = a + (rnd() > 0.5 ? 1 : -1) * (0.5 + rnd() * 0.6);
          const nl = 10 + rnd() * 16;
          ctx.strokeStyle = col(1);
          ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl); ctx.stroke();
        }
      }
    } else {
      // широкие листья: эллипсы с заострёнными концами и прожилкой
      for (let k = 0; k < 420; k++) {
        const x = S * (0.08 + rnd() * 0.84), y = S * (0.08 + rnd() * 0.84);
        const dx = x / S - 0.5, dy = y / S - 0.5;
        if (dx * dx + dy * dy > 0.2) continue; // скругляем пучок
        const a = rnd() * Math.PI * 2, L = 16 + rnd() * 14, W = L * (0.38 + rnd() * 0.15);
        ctx.save();
        ctx.translate(x, y); ctx.rotate(a);
        ctx.fillStyle = col(1);
        ctx.beginPath();
        ctx.moveTo(-L, 0);
        ctx.quadraticCurveTo(0, -W, L, 0);
        ctx.quadraticCurveTo(0, W, -L, 0);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(L, 0); ctx.stroke();
        ctx.restore();
      }
    }
    const t = toTexture(c, { repeat: false });
    t.premultiplyAlpha = false;
    return t;
  });
}

// Черепица/дранка рядами: 4 ряда по PER плиток со смещением
function tileRoof({ seed, per, round, grain: grain0 = false, palette }) {
  const S = 512, ROWS = 4, PER = per;
  const rh = S / ROWS, tw = S / PER;
  const n = createTileNoise(seed);
  const rnd = mulberry32(seed + 1);
  const rgb = new Float32Array(S * S * 3);
  const hgt = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const tiles = [];
  for (let r = 0; r < ROWS; r++) {
    tiles.push([]);
    for (let i = 0; i < PER; i++) {
      const age = rnd();
      const l = 0.8 + rnd() * 0.4;
      tiles[r].push({
        col: palette(l, age),
        tilt: (rnd() - 0.5) * 0.3,
        seed: rnd() * 10,
      });
    }
  }
  for (let y = 0; y < S; y++) {
    const r = Math.floor(y / rh);
    const ly = (y - r * rh) / rh; // 0 — верх полосы, 1 — нижняя кромка плитки
    const off = (r % 2) * tw * 0.5;
    for (let x = 0; x < S; x++) {
      const xs = (x - off + S) % S;
      const ti = Math.floor(xs / tw);
      const lx = (xs - ti * tw) / tw;
      const t = tiles[r][ti];
      const u = x / S, v = y / S;
      // форма плитки: зазоры по бокам, скруглённый низ
      const dx = (lx - 0.5) * 2;
      const bottom = round ? 0.72 + 0.28 * Math.sqrt(Math.max(0, 1 - dx * dx)) : 0.97 - Math.abs(dx) * 0.03;
      const inTile = lx > 0.035 && lx < 0.965 && ly < bottom;
      const i = y * S + x;
      if (!inTile) {
        const k = 0.35 + 0.2 * ly;
        rgb[i * 3] = 0.2 * k; rgb[i * 3 + 1] = 0.13 * k; rgb[i * 3 + 2] = 0.1 * k;
        hgt[i] = 0.05;
        rough[i] = 0.95;
        continue;
      }
      const grain = grain0 ? n.fbm(u * 0.15 + t.seed, v * 2, 64, 3) : n.fbm(u + t.seed, v, 32, 3);
      const lichen = smoothstep(0.64, 0.72, n.fbm(u + 0.5, v + 0.2, 16, 3));
      const soot = smoothstep(0.5, 0.8, n.fbm(u * 0.5 + 0.3, v, 4, 3)) * 0.35;
      let sh = (0.78 + 0.3 * grain) * (0.85 + 0.25 * ly) * (1 - soot);
      sh *= 1 + t.tilt * (lx - 0.5);
      let cr = t.col[0] * sh, cg = t.col[1] * sh, cb = t.col[2] * sh;
      cr += (0.62 - cr) * lichen * 0.55; cg += (0.6 - cg) * lichen * 0.55; cb += (0.45 - cb) * lichen * 0.55;
      rgb[i * 3] = cr; rgb[i * 3 + 1] = cg; rgb[i * 3 + 2] = cb;
      // плитка утолщается к нижней кромке
      hgt[i] = 0.25 + ly * 0.6 + grain * 0.12 + t.tilt * (lx - 0.5) * 0.3;
      rough[i] = 0.72 + lichen * 0.2;
    }
  }
  return finishSet(rgb, hgt, rough, S, { normal: 3.5, ao: 2.4, aoRadius: 4, tileMeters: 1.56 });
}

// Получить набор: сначала Poly Haven, иначе процедурный.
export function getSet(slot) {
  if (LOADED[slot]) return LOADED[slot];
  return cached('set:' + slot, () => GENERATORS[slot]());
}

// Текстуры Three.js для обычного PBR-материала.
export function materialTextures(slot) {
  return cached('mat:' + slot, () => {
    const s = getSet(slot);
    const map = toTexture(s.color);
    const normalMap = toTexture(s.normal, { srgb: false });
    const orm = toTexture(s.orm, { srgb: false });
    return { map, normalMap, roughnessMap: orm, aoMap: orm, tileMeters: s.tileMeters };
  });
}

// PBR-материал с текстурами слота. UV геометрии должны быть в метрах / tileMeters.
export function pbrMaterial(slot, opts = {}) {
  const t = materialTextures(slot);
  const mat = new THREE.MeshStandardMaterial({
    map: t.map,
    normalMap: t.normalMap,
    roughnessMap: t.roughnessMap,
    aoMap: t.aoMap,
    aoMapIntensity: 1,
    roughness: 1,
    metalness: 0,
    ...opts,
  });
  mat.userData.tileMeters = t.tileMeters;
  return mat;
}

// Текстурный массив из нескольких наборов (для рельефа): все слои приводятся к size×size.
export function textureArrays(slots, size) {
  const out = {};
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  for (const kind of ['color', 'normal', 'orm']) {
    const data = new Uint8Array(size * size * 4 * slots.length);
    slots.forEach((slot, layer) => {
      const src = getSet(slot)[kind];
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(src, 0, 0, size, size);
      data.set(ctx.getImageData(0, 0, size, size).data, layer * size * size * 4);
    });
    const tex = new THREE.DataArrayTexture(data, size, size, slots.length);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.colorSpace = kind === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = ANISO;
    tex.needsUpdate = true;
    out[kind] = tex;
  }
  out.tileMeters = slots.map((s) => getSet(s).tileMeters);
  return out;
}

// ---------------------------------------------------------------------------
// Вспомогательные текстуры
// ---------------------------------------------------------------------------
export function macroNoiseTexture() {
  return cached('macro', () => {
    const S = 256;
    const n = createTileNoise(61);
    const rgb = new Float32Array(S * S * 3);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const i = (y * S + x) * 3;
        rgb[i] = n.fbm(u, v, 4, 5);
        rgb[i + 1] = n.fbm(u + 0.5, v + 0.5, 8, 4);
        rgb[i + 2] = n.fbm(u + 0.25, v + 0.75, 2, 4);
      }
    }
    return toTexture(rgbToCanvas(rgb, S, S), { srgb: false });
  });
}

// Рябь на воде — карта нормалей для Water.js.
export function waterNormalTexture() {
  return cached('waterN', () => {
    const S = 512;
    const n = createTileNoise(71);
    const h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        h[y * S + x] = n.fbm(u, v, 8, 5, 0.5) + 0.3 * n.fbm(u + 0.5, v, 32, 3);
      }
    }
    return toTexture(heightToNormalCanvas(h, S, S, 10), { srgb: false });
  });
}

// ---------------------------------------------------------------------------
// Каменная кладка: отдельные камни разного размера и оттенка, раствор в швах.
// ---------------------------------------------------------------------------
function makeMasonry({
  S = 512, seed = 7, courseMin = 30, courseMax = 58, lenMin = 0.9, lenMax = 2.6, mortar = 2.6,
  jitter = 3.5, base = [0.56, 0.52, 0.45], tint = 0.12, mortarColor = [0.62, 0.59, 0.52], rubble = 0,
  tileMeters = 3,
}) {
  const W = S, H = S;
  const rnd = mulberry32(seed);
  const n = createTileNoise(seed + 100);
  const rgb = new Float32Array(W * H * 3);
  const hgt = new Float32Array(W * H);
  const rough = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const m = n.fbm(u, v, 32, 3);
      const i = y * W + x;
      const k = 0.8 + 0.3 * m;
      rgb[i * 3] = mortarColor[0] * k; rgb[i * 3 + 1] = mortarColor[1] * k; rgb[i * 3 + 2] = mortarColor[2] * k;
      hgt[i] = 0.05 * m;
      rough[i] = 0.97;
    }
  }
  const courses = [];
  let yAcc = 0;
  while (yAcc < H) {
    let ch = courseMin + rnd() * (courseMax - courseMin);
    if (H - yAcc - ch < courseMin) ch = H - yAcc;
    courses.push([yAcc, ch]);
    yAcc += ch;
  }
  for (const [cy, ch] of courses) {
    const x0 = rnd() * W;
    let xAcc = 0;
    const stones = [];
    while (xAcc < W) {
      let len = ch * (lenMin + rnd() * (lenMax - lenMin));
      if (W - xAcc - len < ch * lenMin * 0.8) len = W - xAcc;
      stones.push([x0 + xAcc, len]);
      xAcc += len;
    }
    for (const [sx, len] of stones) {
      const parts = rubble > 0 || rnd() > 0.85 ? splitStone(sx, cy, len, ch, rnd, rubble) : [[sx, cy, len, ch]];
      for (const [px, py, pw, ph] of parts) {
        const col = stoneColor(base, tint, rnd);
        const bulge = 0.6 + rnd() * 0.5;
        const tilt = (rnd() - 0.5) * 0.4;
        const rough0 = 0.72 + rnd() * 0.2;
        const cornerR = Math.min(pw, ph) * (0.15 + rubble * 0.3);
        const seedOff = rnd() * 10;
        const chip = rnd();
        for (let yy = Math.floor(py); yy < py + ph; yy++) {
          const y = ((yy % H) + H) % H;
          for (let xx = Math.floor(px); xx < px + pw; xx++) {
            const x = ((xx % W) + W) % W;
            const lx = xx - px, ly = yy - py;
            const dxE = Math.min(lx, pw - lx);
            const dyE = Math.min(ly, ph - ly);
            let d;
            if (dxE < cornerR && dyE < cornerR) d = cornerR - Math.hypot(cornerR - dxE, cornerR - dyE);
            else d = Math.min(dxE, dyE);
            const u = x / W, v = y / H;
            d += (n.noise(u + seedOff, v, 64) - 0.5) * jitter * 2 + (n.noise(u, v + seedOff, 16) - 0.5) * jitter * (1 + rubble * 2);
            if (d < mortar) continue;
            const i = y * W + x;
            const edge = smoothstep(mortar, mortar + 7, d);
            const surf = n.fbm(u + seedOff * 0.1, v, 32, 4);
            const fine = n.noise(u * 4 + seedOff, v * 4, 64);
            // сколы на гранях
            const chipped = chip > 0.6 ? smoothstep(0.55, 0.7, n.noise(u + seedOff, v + seedOff, 32)) * (1 - edge * 0.5) : 0;
            const h = edge * bulge + surf * 0.35 + fine * 0.1 + tilt * (lx / pw - 0.5) - chipped * 0.4;
            hgt[i] = 0.25 + h;
            const shade = (0.8 + 0.35 * surf + 0.08 * fine) * (0.75 + 0.25 * edge) * (1 - chipped * 0.15);
            rgb[i * 3] = col[0] * shade; rgb[i * 3 + 1] = col[1] * shade; rgb[i * 3 + 2] = col[2] * shade;
            rough[i] = rough0;
          }
        }
      }
    }
  }
  // потёки, грязь, лишайник
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const grime = smoothstep(0.5, 0.8, n.fbm(u + 0.3, v * 0.35 + 0.6, 4, 4));
      const lichen = smoothstep(0.7, 0.78, n.fbm(u + 0.8, v + 0.1, 16, 3));
      const i = y * W + x;
      const k = 1 - grime * 0.28;
      rgb[i * 3] *= k; rgb[i * 3 + 1] *= k; rgb[i * 3 + 2] *= k * 0.97;
      rgb[i * 3] += (0.6 - rgb[i * 3]) * lichen * 0.3;
      rgb[i * 3 + 1] += (0.6 - rgb[i * 3 + 1]) * lichen * 0.3;
      rgb[i * 3 + 2] += (0.42 - rgb[i * 3 + 2]) * lichen * 0.3;
    }
  }
  return finishSet(rgb, hgt, rough, S, { normal: 2.6, ao: 2.2, aoRadius: 6, tileMeters });
}

function stoneColor(base, tint, rnd) {
  const l = 1 + (rnd() - 0.5) * tint * 2.6;
  const warm = (rnd() - 0.35) * tint * 0.5; // в основном тёплые оттенки известняка, изредка сероватые
  return [base[0] * l + warm, base[1] * l + warm * 0.5, base[2] * l - warm * 0.4];
}

function splitStone(x, y, w, h, rnd, rubble) {
  if (rubble > 0) {
    const out = [];
    const nx = w > h * 1.6 ? 2 : 1;
    let cx = x;
    for (let i = 0; i < nx; i++) {
      const pw = i === nx - 1 ? x + w - cx : (w / nx) * (0.7 + rnd() * 0.6);
      if (rnd() < 0.45 && h > 20) {
        const s = h * (0.35 + rnd() * 0.3);
        out.push([cx, y, pw, s], [cx, y + s, pw, h - s]);
      } else out.push([cx, y, pw, h]);
      cx += pw;
    }
    return out;
  }
  const s = h * (0.4 + rnd() * 0.2);
  return [[x, y, w, s], [x, y + s, w, h - s]];
}
