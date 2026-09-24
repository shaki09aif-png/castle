// Процедурные текстуры: всё рисуется в <canvas> пикселями, никаких файлов.
// Каждая текстура бесшовная (тайлится), к большинству строится карта нормалей.
import * as THREE from 'three';
import { createTileNoise, mulberry32, clamp, smoothstep } from './noise.js';

let ANISO = 8;
export function setAnisotropy(n) {
  ANISO = n;
}

const cache = new Map();
function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(canvas, { srgb = true, repeat = true } = {}) {
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

// Записать массив цветов (Float32 RGB 0..1) в canvas.
function rgbToCanvas(rgb, w, h) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0, j = 0; i < w * h; i++, j += 3) {
    img.data[i * 4] = clamp(rgb[j] * 255, 0, 255);
    img.data[i * 4 + 1] = clamp(rgb[j + 1] * 255, 0, 255);
    img.data[i * 4 + 2] = clamp(rgb[j + 2] * 255, 0, 255);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Карта нормалей из карты высот (бесшовно, с заворачиванием краёв).
export function heightToNormalCanvas(height, w, h, strength = 2) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w;
    const yp = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w;
      const xp = (x + 1) % w;
      const dx = (height[y * w + xp] - height[y * w + xm]) * strength;
      const dy = (height[yp + x] - height[ym + x]) * strength;
      let nx = -dx, ny = dy, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------------------
// Трава
// ---------------------------------------------------------------------------
export function grassTexture() {
  return cached('grass', () => {
    const S = 512;
    const n = createTileNoise(11);
    const rnd = mulberry32(12);
    const rgb = new Float32Array(S * S * 3);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const big = n.fbm(u, v, 4, 4);
        const mid = n.fbm(u + 0.37, v + 0.11, 16, 3);
        const dry = smoothstep(0.55, 0.75, n.fbm(u + 0.7, v + 0.2, 8, 3));
        const grain = rnd();
        let r = 0.25 + 0.08 * big + 0.05 * mid;
        let g = 0.31 + 0.09 * big + 0.07 * mid;
        let b = 0.13 + 0.03 * mid;
        // сухие желтоватые пятна
        r += dry * 0.13; g += dry * 0.06; b += dry * 0.02;
        const k = 0.78 + grain * 0.35;
        const i = (y * S + x) * 3;
        rgb[i] = r * k; rgb[i + 1] = g * k; rgb[i + 2] = b * k;
      }
    }
    const c = rgbToCanvas(rgb, S, S);
    const ctx = c.getContext('2d');
    // травинки
    const blade = (x, y, len, ang, col) => {
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        const px = x + ox, py = y + oy;
        if (px < -20 || px > S + 20 || py < -20 || py > S + 20) continue;
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
        ctx.stroke();
      }
    };
    ctx.lineWidth = 1;
    for (let i = 0; i < 9000; i++) {
      const x = rnd() * S, y = rnd() * S;
      const light = rnd();
      const col = light > 0.5
        ? `rgba(${120 + light * 60 | 0},${150 + light * 50 | 0},${50 + light * 20 | 0},0.35)`
        : `rgba(${20 + light * 20 | 0},${45 + light * 40 | 0},${10},0.4)`;
      blade(x, y, 3 + rnd() * 6, -Math.PI / 2 + (rnd() - 0.5) * 1.4, col);
    }
    // редкие полевые цветы
    for (let i = 0; i < 160; i++) {
      const x = rnd() * S, y = rnd() * S;
      const t = rnd();
      ctx.fillStyle = t < 0.4 ? 'rgba(235,235,220,0.8)' : t < 0.7 ? 'rgba(230,200,60,0.8)' : 'rgba(170,120,200,0.7)';
      ctx.fillRect(x, y, 1.6, 1.6);
    }
    return toTexture(c);
  });
}

// ---------------------------------------------------------------------------
// Скала (известняк/песчаник): слои, трещины, лишайник
// ---------------------------------------------------------------------------
function rockData() {
  return cached('rockData', () => {
    const S = 512;
    const n = createTileNoise(21);
    const rnd = mulberry32(22);
    const rgb = new Float32Array(S * S * 3);
    const hgt = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const base = n.fbm(u, v, 4, 6, 0.55);
        const warp = n.fbm(u + 0.5, v + 0.3, 4, 3);
        // горизонтальные пласты известняка
        const layer = (v * 7 + warp * 0.9) % 1;
        const strata = smoothstep(0.0, 0.08, layer) * (1 - smoothstep(0.9, 1.0, layer));
        // трещины: гребни «хребтового» шума, редкие и тонкие
        const rn = 1 - Math.abs(n.fbm(u + 0.13, v + 0.71, 4, 4) * 2 - 1);
        const crack = smoothstep(0.955, 0.99, rn) * smoothstep(0.45, 0.65, n.fbm(u + 0.4, v, 8, 2));
        const pits = smoothstep(0.62, 0.72, n.fbm(u + 0.21, v + 0.37, 32, 3));
        const lichen = smoothstep(0.66, 0.74, n.fbm(u + 0.9, v + 0.4, 16, 3)) * 0.8;
        const moss = smoothstep(0.6, 0.8, n.fbm(u + 0.2, v + 0.8, 4, 4) * 0.75 + (1 - strata) * 0.25);
        let t = 0.47 + 0.3 * (base - 0.5) + (rnd() - 0.5) * 0.07;
        t *= 0.84 + 0.16 * strata;
        t *= 1 - pits * 0.18;
        let r = t * 1.04, g = t * 1.0, b = t * 0.9;
        // тёплый охристый оттенок местами (окислы железа)
        const warm = smoothstep(0.45, 0.7, n.fbm(u + 0.33, v + 0.66, 4, 3));
        r += warm * 0.07; g += warm * 0.025; b -= warm * 0.02;
        r *= 1 - crack * 0.42; g *= 1 - crack * 0.42; b *= 1 - crack * 0.38;
        // лишайник (светлый, желтоватый) и мох (в щелях между пластами)
        r = lerp3(r, 0.66, lichen * 0.45); g = lerp3(g, 0.64, lichen * 0.45); b = lerp3(b, 0.46, lichen * 0.45);
        r = lerp3(r, 0.3, moss * 0.4); g = lerp3(g, 0.35, moss * 0.4); b = lerp3(b, 0.16, moss * 0.4);
        const i = y * S + x;
        rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
        hgt[i] = base * 1.1 + strata * 0.3 - crack * 0.7 - pits * 0.1;
      }
    }
    return { rgb, hgt, S };
  });
}
const lerp3 = (a, b, t) => a + (b - a) * t;

export function rockTexture() {
  return cached('rock', () => {
    const { rgb, S } = rockData();
    return toTexture(rgbToCanvas(rgb, S, S));
  });
}

export function rockNormal() {
  return cached('rockN', () => {
    const { hgt, S } = rockData();
    return toTexture(heightToNormalCanvas(hgt, S, S, 3.5), { srgb: false });
  });
}

// ---------------------------------------------------------------------------
// Земля / утоптанная грунтовка с камешками
// ---------------------------------------------------------------------------
export function dirtTexture() {
  return cached('dirt', () => {
    const S = 512;
    const n = createTileNoise(31);
    const rnd = mulberry32(32);
    const rgb = new Float32Array(S * S * 3);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const a = n.fbm(u, v, 8, 5);
        const b2 = n.fbm(u + 0.4, v + 0.2, 32, 3);
        const t = 0.3 + 0.18 * (a - 0.5) + 0.08 * (b2 - 0.5) + (rnd() - 0.5) * 0.05;
        const i = (y * S + x) * 3;
        rgb[i] = t * 1.25; rgb[i + 1] = t * 1.02; rgb[i + 2] = t * 0.72;
      }
    }
    const c = rgbToCanvas(rgb, S, S);
    const ctx = c.getContext('2d');
    // мелкие камешки
    for (let i = 0; i < 1400; i++) {
      const x = rnd() * S, y = rnd() * S, r = 0.8 + rnd() * rnd() * 4;
      const g = 90 + rnd() * 90 | 0;
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        if (Math.abs(x + ox - S / 2) > S / 2 + 6 || Math.abs(y + oy - S / 2) > S / 2 + 6) continue;
        ctx.fillStyle = `rgba(20,15,10,0.35)`;
        ctx.beginPath(); ctx.ellipse(x + ox + 0.8, y + oy + 0.8, r, r * 0.75, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgb(${g},${g * 0.93 | 0},${g * 0.82 | 0})`;
        ctx.beginPath(); ctx.ellipse(x + ox, y + oy, r, r * 0.75, rnd() * 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    return toTexture(c);
  });
}

// Дорога: U — поперёк (вся ширина), V — вдоль (повторяется). Колеи, камни, травка по краям.
export function roadTexture() {
  return cached('road', () => {
    const W = 256, H = 512;
    const n = createTileNoise(41);
    const rnd = mulberry32(42);
    const rgb = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W, v = y / H;
        const a = n.fbm(u * 0.5, v, 8, 5);
        const rut = Math.exp(-Math.pow((u - 0.3) / 0.05, 2)) + Math.exp(-Math.pow((u - 0.7) / 0.05, 2));
        const edge = smoothstep(0.36, 0.5, Math.abs(u - 0.5));
        const grassy = edge * smoothstep(0.35, 0.6, n.fbm(u * 0.5 + 0.3, v, 16, 3) + edge * 0.3);
        let t = 0.36 + 0.16 * (a - 0.5) + (rnd() - 0.5) * 0.06 - rut * 0.07;
        let r = t * 1.2, g = t * 1.02, b = t * 0.76;
        r = r * (1 - grassy) + grassy * 0.2;
        g = g * (1 - grassy) + grassy * 0.3;
        b = b * (1 - grassy) + grassy * 0.1;
        const i = (y * W + x) * 3;
        rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b;
      }
    }
    const c = rgbToCanvas(rgb, W, H);
    const ctx = c.getContext('2d');
    for (let i = 0; i < 700; i++) {
      const x = W * (0.12 + rnd() * 0.76), y = rnd() * H, r = 0.8 + rnd() * rnd() * 5;
      const g = 95 + rnd() * 80 | 0;
      for (const oy of [-H, 0, H]) {
        ctx.fillStyle = 'rgba(25,18,10,0.35)';
        ctx.beginPath(); ctx.ellipse(x + 1, y + oy + 1, r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgb(${g},${g * 0.94 | 0},${g * 0.84 | 0})`;
        ctx.beginPath(); ctx.ellipse(x, y + oy, r, r * 0.8, rnd() * 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    return toTexture(c);
  });
}

// Прибрежный ил/песок
export function sandTexture() {
  return cached('sand', () => {
    const S = 256;
    const n = createTileNoise(51);
    const rnd = mulberry32(52);
    const rgb = new Float32Array(S * S * 3);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const a = n.fbm(u, v, 8, 5);
        const t = 0.4 + 0.14 * (a - 0.5) + (rnd() - 0.5) * 0.08;
        const i = (y * S + x) * 3;
        rgb[i] = t * 1.12; rgb[i + 1] = t * 1.02; rgb[i + 2] = t * 0.8;
      }
    }
    return toTexture(rgbToCanvas(rgb, S, S));
  });
}

// Крупномасштабный шум (одноканальный) для разнообразия цвета на больших площадях.
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

// Рябь на воде — карта нормалей.
export function waterNormal() {
  return cached('waterN', () => {
    const S = 256;
    const n = createTileNoise(71);
    const h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        h[y * S + x] = n.fbm(u, v, 8, 5, 0.55);
      }
    }
    return toTexture(heightToNormalCanvas(h, S, S, 6), { srgb: false });
  });
}

// ---------------------------------------------------------------------------
// Каменная кладка: отдельные камни разного размера и оттенка, раствор в швах.
// Возвращает { map, normalMap, roughnessMap }. Размер тайла в метрах — tileW×tileH.
// ---------------------------------------------------------------------------
export function masonry(key, opts = {}) {
  return cached('masonry:' + key, () => makeMasonry(opts));
}

function makeMasonry({
  W = 512,
  H = 512,
  seed = 7,
  courseMin = 30, // высота ряда, пикс
  courseMax = 58,
  lenMin = 0.9, // длина камня относительно высоты ряда
  lenMax = 2.6,
  mortar = 2.6, // полуширина шва, пикс
  jitter = 3.5, // неровность кромок
  base = [0.56, 0.52, 0.45], // средний цвет камня
  tint = 0.12, // разброс оттенка
  mortarColor = [0.62, 0.59, 0.52],
  rubble = 0, // 0 — тёсаная кладка, 1 — бутовая (неровные камни)
} = {}) {
  const rnd = mulberry32(seed);
  const n = createTileNoise(seed + 100);
  const rgb = new Float32Array(W * H * 3);
  const hgt = new Float32Array(W * H);
  const rough = new Float32Array(W * H);
  const owner = new Int32Array(W * H).fill(-1);

  // заливка раствором
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const m = n.fbm(u, v, 32, 3);
      const i = y * W + x;
      const k = 0.85 + 0.25 * m;
      rgb[i * 3] = mortarColor[0] * k;
      rgb[i * 3 + 1] = mortarColor[1] * k;
      rgb[i * 3 + 2] = mortarColor[2] * k;
      hgt[i] = 0.05 * m;
      rough[i] = 0.95;
    }
  }

  // разбиение на ряды, сумма высот = H (бесшовность по вертикали)
  const courses = [];
  let yAcc = 0;
  while (yAcc < H) {
    let ch = courseMin + rnd() * (courseMax - courseMin);
    if (H - yAcc - ch < courseMin) ch = H - yAcc;
    courses.push([yAcc, ch]);
    yAcc += ch;
  }

  let id = 0;
  for (const [cy, ch] of courses) {
    // камни в ряду, по горизонтали заворачиваются (бесшовность)
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
      // иногда камень делится по высоте на два (разнобой рядов)
      const parts = rubble > 0 || rnd() > 0.85 ? splitStone(sx, cy, len, ch, rnd, rubble) : [[sx, cy, len, ch]];
      for (const [px, py, pw, ph] of parts) {
        const col = stoneColor(base, tint, rnd);
        const bulge = 0.6 + rnd() * 0.5;
        const tilt = (rnd() - 0.5) * 0.4;
        const rough0 = 0.75 + rnd() * 0.2;
        const cornerR = Math.min(pw, ph) * (0.15 + rubble * 0.3);
        const seedOff = rnd() * 10;
        for (let yy = Math.floor(py); yy < py + ph; yy++) {
          const y = ((yy % H) + H) % H;
          for (let xx = Math.floor(px); xx < px + pw; xx++) {
            const x = ((xx % W) + W) % W;
            const lx = xx - px, ly = yy - py;
            // расстояние до края прямоугольника со скруглёнными углами
            const dxE = Math.min(lx, pw - lx);
            const dyE = Math.min(ly, ph - ly);
            let d;
            if (dxE < cornerR && dyE < cornerR) {
              d = cornerR - Math.hypot(cornerR - dxE, cornerR - dyE);
            } else d = Math.min(dxE, dyE);
            const u = x / W, v = y / H;
            d += (n.noise(u + seedOff, v, 64) - 0.5) * jitter * 2 + (n.noise(u, v + seedOff, 16) - 0.5) * jitter * (1 + rubble * 2);
            if (d < mortar) continue;
            const i = y * W + x;
            const edge = smoothstep(mortar, mortar + 7, d);
            const surf = n.fbm(u + seedOff * 0.1, v, 32, 4);
            const fine = n.noise(u * 4 + seedOff, v * 4, 64);
            const h = edge * bulge + surf * 0.35 + fine * 0.08 + tilt * (lx / pw - 0.5);
            hgt[i] = 0.2 + h;
            const shade = (0.8 + 0.35 * surf + 0.08 * fine) * (0.72 + 0.28 * edge);
            rgb[i * 3] = col[0] * shade;
            rgb[i * 3 + 1] = col[1] * shade;
            rgb[i * 3 + 2] = col[2] * shade;
            rough[i] = rough0;
            owner[i] = id;
          }
        }
        id++;
      }
    }
  }

  // пятна грязи/сырости по всей поверхности
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const grime = smoothstep(0.5, 0.8, n.fbm(u + 0.3, v + 0.6, 4, 4));
      const i = y * W + x;
      const k = 1 - grime * 0.25;
      rgb[i * 3] *= k; rgb[i * 3 + 1] *= k; rgb[i * 3 + 2] *= k * 0.97;
    }
  }

  const map = toTexture(rgbToCanvas(rgb, W, H));
  const normalMap = toTexture(heightToNormalCanvas(hgt, W, H, 2.2), { srgb: false });
  const rc = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H; i++) rc[i * 3] = rc[i * 3 + 1] = rc[i * 3 + 2] = rough[i];
  const roughnessMap = toTexture(rgbToCanvas(rc, W, H), { srgb: false });
  return { map, normalMap, roughnessMap };
}

function stoneColor(base, tint, rnd) {
  const l = 1 + (rnd() - 0.5) * tint * 2.4;
  const warm = (rnd() - 0.5) * tint;
  return [base[0] * l + warm, base[1] * l + warm * 0.4, base[2] * l - warm * 0.3];
}

function splitStone(x, y, w, h, rnd, rubble) {
  if (rubble > 0) {
    // бутовая кладка: камни делятся на неровные куски
    const out = [];
    const nx = w > h * 1.6 ? 2 : 1;
    let cx = x;
    for (let i = 0; i < nx; i++) {
      const pw = i === nx - 1 ? x + w - cx : w / nx * (0.7 + rnd() * 0.6);
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
