// Этап 1: холм с неровным рельефом и скальными выходами, отрог с сухим рвом,
// дорога-серпантин с подпорными стенками, река у подножия, дальние холмы.
import * as THREE from 'three';
import { createNoise2D, fbm, ridged, mulberry32, clamp, lerp, smoothstep } from './noise.js';
import {
  HILL_TOP, GATE_ANGLE, GATE_DIR, GATE_RADIUS, plateauRadius, KEEP_POS, KEEP_RISE,
  DITCH, SPUR, riverZ, RIVER, WORLD,
} from './layout.js';
import {
  grassTexture, rockTexture, dirtTexture, sandTexture, macroNoiseTexture, roadTexture,
  waterNormal, masonry,
} from './textures.js';
import { triplanarMaterial } from './materials.js';

const nPlain = createNoise2D(101);
const nHill = createNoise2D(202);
const nRock = createNoise2D(303);
const nFar = createNoise2D(404);
const nTop = createNoise2D(505);

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// гладкий максимум двух высот
function smax(a, b, k) {
  const h = clamp(0.5 + 0.5 * (a - b) / k, 0, 1);
  return lerp(b, a, h) + k * h * (1 - h);
}

// ---------------------------------------------------------------------------
// Высота «естественного» рельефа (без дороги)
// ---------------------------------------------------------------------------
function plainHeight(x, z) {
  let h = 2.6 + fbm(nPlain, x / 260, z / 260, 4) * 2.4 + fbm(nPlain, x / 45 + 7, z / 45, 3) * 0.3;
  h = 0.9 + Math.log1p(Math.exp((h - 0.9) * 2)) / 2; // мягкое ограничение снизу: без луж на равнине
  // дальние холмы
  const r = Math.hypot(x, z);
  const far = smoothstep(420, 1500, r);
  if (far > 0) {
    const f = fbm(nFar, x / 950, z / 950, 5) * 0.5 + 0.5;
    const rid = ridged(nFar, x / 600 + 3, z / 600, 4);
    h += far * (Math.pow(f, 1.5) * 210 + rid * 45);
  }
  return h;
}

// Форма склона холма: 1 на кромке площадки → 0 у подножия.
// Верх крутой (скалы), книзу склон вогнуто выполаживается.
function gateFactor(theta) {
  return Math.exp(-Math.pow(angDiff(theta, GATE_ANGLE) / 0.75, 2)); // 1 — южная, более пологая сторона
}
function hillProfile(e, theta) {
  const gf = gateFactor(theta);
  const L = 175 + 20 * gf;
  const pw = 2.3 - 0.95 * gf;
  const x = e / L;
  if (x >= 1) return 0;
  return Math.pow(1 - x, pw);
}

// Рельеф поверхности площадки на вершине
function topHeight(x, z) {
  const dk = (x - KEEP_POS.x) ** 2 + (z - KEEP_POS.z) ** 2;
  return HILL_TOP + KEEP_RISE * Math.exp(-dk / (2 * 17 * 17)) + fbm(nTop, x / 25, z / 25, 3) * 0.35;
}

// Сколько «скальности» в точке (выходы породы на крутых верхних склонах)
function rockiness(e, theta, x, z) {
  if (e < -1) return 0;
  const gf = gateFactor(theta);
  const cliff = smoothstep(-1, 2, e) * (1 - smoothstep(10 - gf * 5, 26 - gf * 10, e));
  const patch = smoothstep(0.05, 0.4, fbm(nRock, x / 60, z / 60, 3));
  const band = smoothstep(4, 12, e) * (1 - smoothstep(60, 110, e));
  return Math.max(cliff * (0.55 + 0.45 * patch), band * patch * 0.85 * (1 - gf * 0.6));
}

// Уступ к югу от ворот: знаковое расстояние до скруглённого прямоугольника
// (отрицательное — внутри), в координатах along/across.
function shelfDistance(along, across) {
  const cx = SPUR.length / 2 - 4;
  const hx = SPUR.length / 2 + 4 - SPUR.corner;
  const hz = SPUR.halfWidth - SPUR.corner;
  const qx = Math.abs(along - cx) - hx;
  const qz = Math.abs(across) - hz;
  const out = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
  return out + Math.min(Math.max(qx, qz), 0) - SPUR.corner;
}

function smin(a, b, k) {
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}

// Сухой ров поперёк отрога
function ditchCut(along, across) {
  // стенки рва неровные: следы вырубки и сколы пластов
  const j0 = fbm(nRock, across / 9, 1.3, 3) * 0.9;
  const j1 = fbm(nRock, across / 9, 7.7, 3) * 0.9;
  const din = Math.min(along - (DITCH.alongStart + j0), DITCH.alongEnd + j1 - along);
  if (din < -1.5) return Infinity;
  const floor = HILL_TOP - DITCH.depth + fbm(nRock, along / 5, across / 5, 3) * 0.6;
  const wall = 1 - smoothstep(-0.6, 1.2, din);
  let h = floor + DITCH.depth * 1.5 * wall;
  h += wall * (1 - wall) * 4 * ridged(nRock, along / 3, across / 3, 2) * 1.2; // уступы на стенках
  h += smoothstep(DITCH.halfLength - 8, DITCH.halfLength, Math.abs(across)) * 40;
  return h;
}

export function riverDistance(x, z) {
  const zr = riverZ(x);
  const dzdx = (riverZ(x + 1) - riverZ(x - 1)) / 2;
  return Math.abs(z - zr) / Math.sqrt(1 + dzdx * dzdx);
}

function riverCut(x, z) {
  const d = riverDistance(x, z);
  const hw = RIVER.halfWidth;
  if (d < hw) return RIVER.waterLevel - RIVER.depth * (1 - Math.pow(d / hw, 2)) + 0.3;
  const e = d - hw;
  return RIVER.waterLevel + 0.3 + e * 0.1 + Math.pow(e / 55, 2) * 12;
}

// Слегка «ступенчатый» рельеф на скальных участках — пласты породы.
function terrace(h, step) {
  const f = h / step;
  const fi = Math.floor(f);
  const fr = f - fi;
  return (fi + smoothstep(0.15, 0.85, fr) * 0.35 + fr * 0.65) * step;
}

export function baseHeight(x, z) {
  const r = Math.hypot(x, z);
  const theta = Math.atan2(z, x);
  const R = plateauRadius(theta);
  const along = x * GATE_DIR.x + z * GATE_DIR.z - GATE_RADIUS;
  const across = x * GATE_DIR.z - z * GATE_DIR.x;
  const eP = r - R;
  const eS = shelfDistance(along, across);
  // терраса-уступ сливается с площадкой в единую вершину
  const e = smin(eP, eS, 6);
  const ws = smoothstep(-5, 5, eP - eS);
  const shelfTop = HILL_TOP - SPUR.drop - Math.max(0, along) * 0.03 + fbm(nTop, x / 20, z / 20, 2) * 0.3;
  const top = lerp(topHeight(x, z), shelfTop, ws);
  const plain = plainHeight(x, z);
  let h;
  if (e <= 0) h = top;
  else {
    // лопасти и отроги: искажаем расстояние до кромки шумом
    const eD = e + fbm(nHill, x / 95, z / 95, 3) * 22 * smoothstep(0, 35, e);
    const P = hillProfile(Math.max(0, eD), theta);
    h = plain + (top - plain) * P;
    // лощины и гребни на склонах
    // лощины вытянуты вниз по склону: шум в полярных координатах
    // (координаты шума: касательная частота высокая, радиальная — низкая; без разрыва на ±π)
    const mid = smoothstep(6, 30, e) * P;
    const kk = 5.5 + e / 150;
    const gully = Math.pow(1 - Math.abs(fbm(nHill, Math.cos(theta) * kk + 40, Math.sin(theta) * kk, 2)), 3);
    h -= mid * gully * 7;
    const rk = rockiness(e, theta, x, z);
    if (rk > 0) {
      h += rk * (ridged(nRock, x / 26, z / 26, 4) * 6 - 2.5) * smoothstep(0, 6, e);
      h = lerp(h, terrace(h, 4.5), rk * 0.85);
    }
    h += fbm(nHill, x / 45, z / 45, 3) * 0.9 * smoothstep(0, 20, e);
  }
  // сухой ров поперёк уступа
  if (Math.abs(across) < DITCH.halfLength + 2) h = Math.min(h, ditchCut(along, across));
  // русло реки
  h = Math.min(h, riverCut(x, z));
  return h;
}

// ---------------------------------------------------------------------------
// Дорога-серпантин
// ---------------------------------------------------------------------------
const ROAD_HW = 2.3; // половина ширины проезжей части
const ROAD_STEP = 1.5;
const ROAD_RIDGE_END = 30; // до этой точки дорога идёт прямо по гребню отрога

function gradient(x, z, eps = 3) {
  return [
    (baseHeight(x + eps, z) - baseHeight(x - eps, z)) / (2 * eps),
    (baseHeight(x, z + eps) - baseHeight(x, z - eps)) / (2 * eps),
  ];
}

export function buildRoadPath() {
  const pts = []; // {x, z, hairpin, bridge}
  // 1) по гребню отрога от барбакана наружу
  for (let a = DITCH.alongEnd + 1.5; a <= ROAD_RIDGE_END; a += ROAD_STEP) {
    pts.push({ x: GATE_DIR.x * (GATE_RADIUS + a), z: GATE_DIR.z * (GATE_RADIUS + a) });
  }
  // 2) серпантин по южному склону: «идём» с постоянным уклоном
  let p = { ...pts[pts.length - 1] };
  let dir = { x: GATE_DIR.z, z: -GATE_DIR.x }; // сворачиваем вдоль уступа на восток
  let sigma = 1;
  let leg = 0;
  const grade = 0.065;
  let turns = 0;
  for (let step = 0; step < 4000; step++) {
    const h = baseHeight(p.x, p.z);
    if (h < 4.2 && step > 50) break;
    const [gx, gz] = gradient(p.x, p.z, 11); // крупный масштаб: не «сваливаться» в лощины
    const gl = Math.hypot(gx, gz) + 1e-6;
    const u = { x: -gx / gl, z: -gz / gl };
    const t = { x: sigma * u.z, z: -sigma * u.x };
    const s = Math.min(0.9, grade / gl);
    const c = Math.sqrt(1 - s * s);
    // на ровном месте (терраса) просто продолжаем движение
    const flat = smoothstep(grade * 2.5, grade * 1.2, gl);
    const want = {
      x: lerp(t.x * c + u.x * s, dir.x, flat),
      z: lerp(t.z * c + u.z * s, dir.z, flat),
    };
    dir.x = lerp(dir.x, want.x, 0.25);
    dir.z = lerp(dir.z, want.z, 0.25);
    const dl = Math.hypot(dir.x, dir.z);
    dir.x /= dl; dir.z /= dl;
    p = { x: p.x + dir.x * ROAD_STEP, z: p.z + dir.z * ROAD_STEP };
    pts.push({ ...p });
    leg += ROAD_STEP;
    // поперечное смещение от оси ворот: плечи серпантина не уходят за пределы южного склона
    const pa = p.x * GATE_DIR.x + p.z * GATE_DIR.z - GATE_RADIUS;
    const pc = p.x * GATE_DIR.z - p.z * GATE_DIR.x; // >0 — к востоку при воротах на юг
    const W = 30 + Math.max(0, pa) * 0.16 + (turns % 2) * 8;
    if (leg > 40 && ((sigma > 0 && pc > W) || (sigma < 0 && pc < -W))) {
      // шпилька: полуокружность в сторону спуска
      const Rh = 8.5;
      let n = { x: dir.z, z: -dir.x };
      if (n.x * u.x + n.z * u.z < 0) n = { x: -n.x, z: -n.z };
      const cx = p.x + n.x * Rh, cz = p.z + n.z * Rh;
      const nArc = Math.ceil((Math.PI * Rh) / ROAD_STEP);
      for (let k = 1; k <= nArc; k++) {
        const ph = (k / nArc) * Math.PI;
        pts.push({
          x: cx - n.x * Rh * Math.cos(ph) + dir.x * Rh * Math.sin(ph),
          z: cz - n.z * Rh * Math.cos(ph) + dir.z * Rh * Math.sin(ph),
          hairpin: true,
        });
      }
      p = { ...pts[pts.length - 1] };
      dir = { x: -dir.x, z: -dir.z };
      sigma = -sigma;
      leg = 0;
      turns++;
    }
  }
  // 3) к броду/мосту через реку и дальше к деревне
  const last = pts[pts.length - 1];
  const bx = last.x + 25;
  const bridge = { x: bx, z: riverZ(bx) };
  const segTo = (from, to, flag) => {
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    const n = Math.ceil(d / ROAD_STEP);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      pts.push({ x: lerp(from.x, to.x, t), z: lerp(from.z, to.z, t), ...flag });
    }
  };
  // выравниваем подход к мосту перпендикулярно реке
  const dzdx = (riverZ(bx + 1) - riverZ(bx - 1)) / 2;
  const nl = Math.hypot(dzdx, 1);
  const rn = { x: -dzdx / nl, z: 1 / nl }; // нормаль к руслу (на юг)
  const approach = { x: bridge.x - rn.x * 35, z: bridge.z - rn.z * 35 };
  segTo(last, approach);
  const bankA = { x: bridge.x - rn.x * (RIVER.halfWidth + 3), z: bridge.z - rn.z * (RIVER.halfWidth + 3) };
  const bankB = { x: bridge.x + rn.x * (RIVER.halfWidth + 3), z: bridge.z + rn.z * (RIVER.halfWidth + 3) };
  segTo(approach, bankA);
  segTo(bankA, bankB, { bridge: true });
  const beyond = { x: bankB.x + rn.x * 45 + 20, z: bankB.z + rn.z * 45 };
  segTo(bankB, beyond);
  segTo(beyond, { x: beyond.x + 60, z: beyond.z + 30 });

  // сглаживание траектории (кроме участка по гребню)
  const fixed = Math.ceil((ROAD_RIDGE_END - DITCH.alongEnd - 1) / ROAD_STEP);
  for (let it = 0; it < 3; it++) {
    for (let i = fixed; i < pts.length - 1; i++) {
      if (pts[i].bridge) continue;
      pts[i].x = (pts[i - 1].x + pts[i].x * 2 + pts[i + 1].x) / 4;
      pts[i].z = (pts[i - 1].z + pts[i].z * 2 + pts[i + 1].z) / 4;
    }
  }

  // высоты: естественный рельеф, сглаженный вдоль дороги
  const raw = pts.map((q) => baseHeight(q.x, q.z));
  // над рекой — уровень берегов (там будет мост)
  let bi0 = pts.findIndex((q) => q.bridge);
  let bi1 = pts.length - 1 - [...pts].reverse().findIndex((q) => q.bridge);
  const deck = Math.max(raw[bi0 - 1], raw[bi1 + 1]);
  for (let i = bi0; i <= bi1; i++) raw[i] = deck;
  let hs = raw.slice();
  const W = 14;
  for (let it = 0; it < 3; it++) {
    const out = hs.slice();
    for (let i = 0; i < hs.length; i++) {
      if (pts[i].bridge) continue;
      let s = 0, ws = 0;
      for (let k = -W; k <= W; k++) {
        const j = clamp(i + k, 0, hs.length - 1);
        const w = Math.exp(-(k * k) / (W * W * 0.35));
        s += hs[j] * w; ws += w;
      }
      out[i] = s / ws;
    }
    hs = out;
  }
  // у ворот дорога точно на гребне
  for (let i = 0; i < pts.length; i++) {
    pts[i].h = hs[i];
    pts[i].raw = raw[i];
    if (i < fixed) pts[i].h = raw[i];
    else if (i < fixed + 20) pts[i].h = lerp(raw[i], hs[i], (i - fixed) / 20);
  }
  // длина вдоль пути
  let s = 0;
  pts[0].s = 0;
  for (let i = 1; i < pts.length; i++) {
    s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    pts[i].s = s;
  }
  // направление и определение сторон насыпи (нужна подпорная стенка?)
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    pts[i].dx = dx; pts[i].dz = dz;
    const off = ROAD_HW + 1.6;
    const lh = baseHeight(pts[i].x - dz * off, pts[i].z + dx * off);
    const rh = baseHeight(pts[i].x + dz * off, pts[i].z - dx * off);
    pts[i].fillL = pts[i].h - lh;
    pts[i].fillR = pts[i].h - rh;
  }
  return pts;
}

// Пространственный индекс отрезков дороги
class SegmentGrid {
  constructor(pts, cell, reach) {
    this.pts = pts;
    this.cell = cell;
    this.map = new Map();
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const x0 = Math.floor((Math.min(a.x, b.x) - reach) / cell);
      const x1 = Math.floor((Math.max(a.x, b.x) + reach) / cell);
      const z0 = Math.floor((Math.min(a.z, b.z) - reach) / cell);
      const z1 = Math.floor((Math.max(a.z, b.z) + reach) / cell);
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
        const k = gx * 73856093 ^ gz * 19349663;
        let list = this.map.get(k);
        if (!list) this.map.set(k, (list = []));
        list.push(i);
      }
    }
  }
  nearest(x, z) {
    const k = Math.floor(x / this.cell) * 73856093 ^ Math.floor(z / this.cell) * 19349663;
    const list = this.map.get(k);
    if (!list) return null;
    let best = null, bd = Infinity;
    for (const i of list) {
      const a = this.pts[i], b = this.pts[i + 1];
      const ex = b.x - a.x, ez = b.z - a.z;
      const l2 = ex * ex + ez * ez || 1;
      const t = clamp(((x - a.x) * ex + (z - a.z) * ez) / l2, 0, 1);
      const px = a.x + ex * t, pz = a.z + ez * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < bd) {
        bd = d;
        const side = ex * (z - a.z) - ez * (x - a.x); // >0 — слева
        best = { i, t, d, side };
      }
    }
    return best;
  }
}

// ---------------------------------------------------------------------------
// Сетка рельефа: мелкий шаг вокруг холма, крупный — к горизонту
// ---------------------------------------------------------------------------
const GRID_N = 620;
const U0 = 500 / GRID_N;
const WA = WORLD.detailHalf / U0;
const WC = (WORLD.half - WA) / Math.pow(1 - U0, 3);

function warp(u) {
  const a = Math.abs(u);
  const v = a <= U0 ? WA * a : WA * a + WC * Math.pow(a - U0, 3);
  return Math.sign(u) * v;
}
function unwarp(x) {
  const a = Math.abs(x);
  if (a <= WA * U0) return Math.sign(x) * (a / WA);
  let u = a / WA > 1 ? 1 : a / WA;
  for (let i = 0; i < 30; i++) {
    const f = WA * u + WC * Math.pow(u - U0, 3) - a;
    const df = WA + 3 * WC * Math.pow(u - U0, 2);
    u -= f / df;
  }
  return Math.sign(x) * u;
}

export function createTerrain(scene) {
  const road = buildRoadPath();
  const grid = new SegmentGrid(road, 10, 22);
  const walls = computeWallRuns(road);

  // финальная высота с учётом полотна дороги
  function carvedHeight(x, z, h0) {
    const q = grid.nearest(x, z);
    if (!q || q.d > 22) return { h: h0, road: 0 };
    const a = road[q.i], b = road[q.i + 1];
    if (a.bridge && b.bridge) return { h: h0, road: 0 };
    const rh = lerp(a.h, b.h, q.t);
    const inner = ROAD_HW + 0.9;
    const left = q.side > 0;
    const walled = left ? a.wallL || b.wallL : a.wallR || b.wallR;
    const diff = rh - h0;
    let F;
    if (diff > 0) F = walled ? 0.7 : Math.max(3, diff * 1.7); // насыпь
    else F = Math.max(2.5, -diff * 0.8); // выемка
    const w = 1 - smoothstep(inner, inner + F, q.d);
    const nearRiver = riverDistance(x, z) < RIVER.halfWidth + 1.5;
    return { h: nearRiver ? h0 : lerp(h0, rh, w), road: 1 - smoothstep(ROAD_HW - 0.5, ROAD_HW + 2.5, q.d) };
  }

  // --- геометрия рельефа ---
  const N = GRID_N;
  const V = N + 1;
  const xs = new Float32Array(V);
  for (let i = 0; i <= N; i++) xs[i] = warp((i / N) * 2 - 1);
  const pos = new Float32Array(V * V * 3);
  const heights = new Float32Array(V * V);
  const roadW = new Float32Array(V * V);
  for (let j = 0; j < V; j++) {
    const z = xs[j];
    for (let i = 0; i < V; i++) {
      const x = xs[i];
      let h = baseHeight(x, z);
      const c = carvedHeight(x, z, h);
      h = c.h;
      const k = j * V + i;
      heights[k] = h;
      roadW[k] = c.road;
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    }
  }
  const index = new Uint32Array(N * N * 6);
  let p = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
      index[p++] = a; index[p++] = c; index[p++] = b;
      index[p++] = b; index[p++] = c; index[p++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();

  // веса материалов: трава, скала, земля, прибрежный песок
  const nrm = geo.getAttribute('normal');
  const splat = new Float32Array(V * V * 4);
  const rnd = mulberry32(9);
  for (let k = 0; k < V * V; k++) {
    const x = pos[k * 3], z = pos[k * 3 + 2], h = pos[k * 3 + 1];
    const slope = 1 - nrm.getY(k);
    const r = Math.hypot(x, z);
    const theta = Math.atan2(z, x);
    const e = r - plateauRadius(theta);
    let rock = smoothstep(0.3, 0.55, slope);
    rock = Math.max(rock, rockiness(e, theta, x, z) * smoothstep(0.12, 0.3, slope));
    // стенки и дно рва — голая скала
    const along = x * GATE_DIR.x + z * GATE_DIR.z - GATE_RADIUS;
    const across = x * GATE_DIR.z - z * GATE_DIR.x;
    if (along > DITCH.alongStart - 1 && along < DITCH.alongEnd + 1 && Math.abs(across) < DITCH.halfLength) {
      rock = Math.max(rock, h < HILL_TOP - 1 ? 0.95 : 0);
    }
    // вытоптанная земля по кромке площадки и у дороги
    let dirt = roadW[k] * 0.9;
    if (e < 2 && e > -6) dirt = Math.max(dirt, 0.35 * smoothstep(-6, 0, e) * (0.5 + rnd() * 0.5));
    if (e <= -6) dirt = Math.max(dirt, 0.25); // площадка — будущий двор
    const rd = riverDistance(x, z);
    const sand = 1 - smoothstep(RIVER.halfWidth + 1, RIVER.halfWidth + 6, rd);
    rock *= 1 - sand;
    dirt *= 1 - rock * 0.7;
    let grass = Math.max(0, 1 - rock - dirt - sand);
    const sum = grass + rock + dirt + sand || 1;
    splat[k * 4] = grass / sum;
    splat[k * 4 + 1] = rock / sum;
    splat[k * 4 + 2] = dirt / sum;
    splat[k * 4 + 3] = sand / sum;
  }
  geo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
  geo.computeBoundingSphere();

  const mat = makeTerrainMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'terrain';
  scene.add(mesh);

  // --- выборка высоты сетки (совпадает с треугольниками) ---
  function heightAt(x, z) {
    const u = (unwarp(x) + 1) / 2 * N;
    const v = (unwarp(z) + 1) / 2 * N;
    const i = clamp(Math.floor(u), 0, N - 1);
    const j = clamp(Math.floor(v), 0, N - 1);
    const fx = clamp((x - xs[i]) / (xs[i + 1] - xs[i]), 0, 1);
    const fz = clamp((z - xs[j]) / (xs[j + 1] - xs[j]), 0, 1);
    const h00 = heights[j * V + i], h10 = heights[j * V + i + 1];
    const h01 = heights[(j + 1) * V + i], h11 = heights[(j + 1) * V + i + 1];
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  const roadMesh = buildRoadMesh(road);
  scene.add(roadMesh);
  const wallMesh = buildRetainingWalls(road, walls, heightAt);
  scene.add(wallMesh);
  const rocks = buildRocks(heightAt, grid);
  rocks.forEach((r) => scene.add(r));
  const water = buildRiver();
  scene.add(water);

  return {
    mesh,
    heightAt,
    road,
    roadNearest: (x, z) => grid.nearest(x, z),
    update(t) {
      const nm = water.material.normalMap;
      nm.offset.set(t * 0.012, t * 0.02);
    },
  };
}

// ---------------------------------------------------------------------------
// Материал рельефа: смешивание процедурных текстур по весам + трипланар для скал
// ---------------------------------------------------------------------------
function makeTerrainMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  const uniforms = {
    tGrass: { value: grassTexture() },
    tRock: { value: rockTexture() },
    tDirt: { value: dirtTexture() },
    tSand: { value: sandTexture() },
    tMacro: { value: macroNoiseTexture() },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 splat;
        varying vec4 vSplat;
        varying vec3 vWPos;
        varying vec3 vWNrm;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vSplat = splat;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNrm = normalize(mat3(modelMatrix) * normal);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D tGrass, tRock, tDirt, tSand, tMacro;
        varying vec4 vSplat;
        varying vec3 vWPos;
        varying vec3 vWNrm;
        vec3 tri(sampler2D t, vec3 p, vec3 bw) {
          return texture2D(t, p.zy).rgb * bw.x + texture2D(t, p.xz).rgb * bw.y + texture2D(t, p.xy).rgb * bw.z;
        }`
      )
      .replace(
        '#include <map_fragment>',
        `{
          vec3 macro = texture2D(tMacro, vWPos.xz * 0.0021).rgb;
          vec3 macro2 = texture2D(tMacro, vWPos.xz * 0.011).rgb;
          vec2 uv = vWPos.xz;
          // трава: два масштаба, чтобы не было заметно повторов
          vec3 g1 = texture2D(tGrass, uv * 0.22).rgb;
          vec3 g2 = texture2D(tGrass, uv * 0.047 + 0.3).rgb;
          vec3 grass = mix(g1, g2, 0.4);
          grass *= mix(vec3(0.8, 0.86, 0.78), vec3(1.12, 1.06, 0.92), macro.r);
          // выгоревшие луговые пятна и более тёмная сочная трава в низинах
          grass = mix(grass, grass * vec3(1.3, 1.1, 0.72), smoothstep(0.5, 0.72, macro.g) * 0.65);
          grass = mix(grass, grass * vec3(0.7, 0.82, 0.68), smoothstep(0.55, 0.3, macro.g) * 0.5);
          // дальние холмы покрыты лесами
          float farK = smoothstep(420.0, 900.0, length(vWPos.xz));
          float forest = smoothstep(0.46, 0.56, texture2D(tMacro, vWPos.xz * 0.0009 + 0.2).b) * farK;
          vec3 forestCol = vec3(0.09, 0.13, 0.06) * (0.8 + 0.5 * texture2D(tMacro, vWPos.xz * 0.02).r);
          grass = mix(grass, forestCol, forest);
          // на вершине трава суше и реже
          float alt = smoothstep(30.0, 62.0, vWPos.y) * (1.0 - smoothstep(140.0, 180.0, length(vWPos.xz)));
          grass = mix(grass, grass * vec3(1.15, 1.0, 0.75), alt * 0.5);
          // дальние склоны — более приглушённые
          vec3 bw = pow(abs(normalize(vWNrm)), vec3(4.0));
          bw /= (bw.x + bw.y + bw.z);
          vec3 rock = tri(tRock, vWPos * 0.09, bw) * 0.6 + tri(tRock, vWPos * 0.023 + 0.5, bw) * 0.4;
          rock *= mix(0.85, 1.1, macro2.b);
          vec3 dirt = texture2D(tDirt, uv * 0.18).rgb * mix(0.9, 1.1, macro2.r);
          vec3 sand = texture2D(tSand, uv * 0.2).rgb;
          vec4 w = vSplat;
          // резкая, «рваная» граница скала/трава
          float rn = macro2.g * 0.5 + texture2D(tGrass, uv * 0.05).g;
          w.y = smoothstep(0.25, 0.75, w.y + (rn - 0.55) * 0.35);
          w /= max(0.0001, w.x + w.y + w.z + w.w);
          vec3 col = grass * w.x + rock * w.y + dirt * w.z + sand * w.w;
          diffuseColor.rgb *= col;
        }`
      );
  };
  return mat;
}

// ---------------------------------------------------------------------------
// Полотно дороги
// ---------------------------------------------------------------------------
function buildRoadMesh(road) {
  const positions = [], uvs = [], idx = [];
  let vi = 0;
  let open = false;
  for (let i = 0; i < road.length; i++) {
    const q = road[i];
    if (q.bridge) { open = false; continue; }
    const nx = -q.dz, nz = q.dx; // влево
    const y = q.h + 0.07;
    positions.push(q.x + nx * ROAD_HW, y, q.z + nz * ROAD_HW, q.x - nx * ROAD_HW, y, q.z - nz * ROAD_HW);
    uvs.push(0, q.s / 7, 1, q.s / 7);
    if (open) {
      const a = vi - 2, b = vi - 1, c = vi, d = vi + 1;
      idx.push(a, c, b, b, c, d);
    }
    vi += 2;
    open = true;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // нормали могли смотреть вниз — проверим и развернём порядок обхода
  if (geo.getAttribute('normal').getY(0) < 0) {
    const ia = geo.index.array;
    for (let k = 0; k < ia.length; k += 3) { const t = ia[k + 1]; ia[k + 1] = ia[k + 2]; ia[k + 2] = t; }
    geo.computeVertexNormals();
  }
  const tex = roadTexture();
  const mat = new THREE.MeshStandardMaterial({
    map: tex, roughness: 0.96, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'road';
  return mesh;
}

// ---------------------------------------------------------------------------
// Подпорные стенки: там, где полотно дороги на насыпи (особенно на поворотах)
// ---------------------------------------------------------------------------
function computeWallRuns(road) {
  const runs = [];
  for (const side of ['L', 'R']) {
    let cur = null;
    for (let i = 0; i < road.length; i++) {
      const q = road[i];
      const fill = side === 'L' ? q.fillL : q.fillR;
      const need = !q.bridge && (fill > 1.3 || (q.hairpin && fill > 0.4));
      if (need) {
        if (!cur) cur = { side, from: i, to: i };
        cur.to = i;
      } else if (cur) {
        if (cur.to - cur.from >= 3) runs.push(cur);
        cur = null;
      }
    }
    if (cur && cur.to - cur.from >= 3) runs.push(cur);
  }
  // расширим прогоны на пару точек и отметим точки дороги
  for (const r of runs) {
    r.from = Math.max(0, r.from - 2);
    r.to = Math.min(road.length - 1, r.to + 2);
    for (let i = r.from; i <= r.to; i++) road[i]['wall' + r.side] = true;
  }
  return runs;
}

function buildRetainingWalls(road, runs, heightAt) {
  const tex = masonry('retaining', {
    seed: 17, courseMin: 34, courseMax: 64, lenMin: 0.8, lenMax: 2.0, rubble: 1,
    base: [0.55, 0.52, 0.46], tint: 0.14, mortar: 3,
  });
  const positions = [], uvs = [], idx = [];
  let vi = 0;
  const TILE = 2.4; // метров на тайл текстуры
  const off = ROAD_HW + 1.0;
  const thick = 0.7;
  for (const r of runs) {
    const sgn = r.side === 'L' ? 1 : -1;
    const rows = [];
    for (let i = r.from; i <= r.to; i++) {
      const q = road[i];
      const nx = -q.dz * sgn, nz = q.dx * sgn;
      const top = q.h + 0.45;
      const ix = q.x + nx * off, iz = q.z + nz * off;
      const ox = q.x + nx * (off + thick), oz = q.z + nz * (off + thick);
      const ground = Math.min(heightAt(ox + nx * 1.5, oz + nz * 1.5), heightAt(ox, oz)) - 0.6;
      const batter = Math.max(0, top - ground) * 0.08;
      rows.push({ ix, iz, ox, oz, top, ground, nx, nz, batter, s: q.s });
    }
    // внешняя грань, верх (парапет-бордюр) и внутренняя кромка
    for (let k = 0; k < rows.length; k++) {
      const w = rows[k];
      const u = w.s / TILE;
      // внешняя грань: верх и низ (низ слегка вынесен — «откос»)
      positions.push(w.ox, w.top, w.oz, w.ox + w.nx * w.batter, w.ground, w.oz + w.nz * w.batter);
      uvs.push(u, w.top / TILE, u, w.ground / TILE);
      // верх
      positions.push(w.ix, w.top, w.iz, w.ox, w.top, w.oz);
      uvs.push(u, 0, u, thick / TILE);
      // внутренняя грань (над дорогой)
      positions.push(w.ix, w.top - 0.6, w.iz, w.ix, w.top, w.iz);
      uvs.push(u, 0, u, 0.6 / TILE);
      if (k > 0) {
        for (let f = 0; f < 3; f++) {
          const a = vi - 6 + f * 2, b = a + 1, c = vi + f * 2, d = c + 1;
          idx.push(a, b, c, b, d, c);
        }
      }
      vi += 6;
    }
    // торцы
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    map: tex.map, normalMap: tex.normalMap, roughnessMap: tex.roughnessMap,
    roughness: 1, metalness: 0, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'retaining-walls';
  return mesh;
}

// ---------------------------------------------------------------------------
// Валуны и скальные выступы (InstancedMesh)
// ---------------------------------------------------------------------------
function rockGeometry(seed, detail) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVerticesSimple(g);
  const n = createNoise2D(seed);
  const n2 = createNoise2D(seed + 1);
  const rnd = mulberry32(seed * 13);
  // несколько плоскостей «скола», которые срезают округлую форму
  const planes = [];
  for (let k = 0; k < 7; k++) {
    const a = rnd() * Math.PI * 2, b = (rnd() - 0.3) * 1.4;
    planes.push({ nx: Math.cos(a) * Math.cos(b), ny: Math.sin(b), nz: Math.sin(a) * Math.cos(b), d: 0.62 + rnd() * 0.3 });
  }
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const dd = 1 + 0.22 * n(v.x * 1.2 + v.y * 0.7, v.z * 1.2 - v.y * 0.5) + 0.07 * n2(v.x * 4, v.z * 4 + v.y * 3);
    v.multiplyScalar(dd);
    for (const pl of planes) {
      const dist = v.x * pl.nx + v.y * pl.ny + v.z * pl.nz;
      if (dist > pl.d) v.addScaledVector(new THREE.Vector3(pl.nx, pl.ny, pl.nz), -(dist - pl.d) * 0.85);
    }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// объединение совпадающих вершин (чтобы нормали были гладкими, а шов не рвался)
function mergeVerticesSimple(g) {
  const p = g.getAttribute('position');
  const map = new Map();
  const verts = [];
  const idx = [];
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    let k = map.get(key);
    if (k === undefined) {
      k = verts.length / 3;
      map.set(key, k);
      verts.push(p.getX(i), p.getY(i), p.getZ(i));
    }
    idx.push(k);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  out.setIndex(idx);
  return out;
}

function buildRocks(heightAt, roadGrid) {
  const rnd = mulberry32(77);
  // крупные глыбы детальнее, мелкие валуны — проще (экономия треугольников)
  const geos = [rockGeometry(1, 3), rockGeometry(2, 3), rockGeometry(3, 2), rockGeometry(4, 2), rockGeometry(5, 2)];
  const mat = triplanarMaterial({ map: rockTexture(), scale: 0.16, roughness: 0.93, tintNoise: macroNoiseTexture(), tintAmount: 0.3 });
  const buckets = geos.map(() => []);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const place = (x, z, scale, flat, big) => {
    const road = roadGrid.nearest(x, z);
    if (road && road.d < ROAD_HW + 2 + scale) return false;
    if (riverDistance(x, z) < RIVER.halfWidth + scale) return false;
    const along = x * GATE_DIR.x + z * GATE_DIR.z - GATE_RADIUS;
    const across = x * GATE_DIR.z - z * GATE_DIR.x;
    if (along > -3 && along < DITCH.alongEnd + 3 && Math.abs(across) < 16) return false; // проход через ров
    const r = Math.hypot(x, z);
    const th = Math.atan2(z, x);
    if (r < plateauRadius(th) + 1.5) return false; // на площадке — будущий двор
    if (shelfDistance(along, across) < 2) return false; // терраса перед воротами — барбакан
    const sx = scale * (0.8 + rnd() * 0.6);
    const sy = scale * flat * (0.6 + rnd() * 0.5);
    const sz = scale * (0.8 + rnd() * 0.6);
    // на склоне камень садится по нижней точке опоры, чтобы не «висеть»
    const rr = Math.max(sx, sz) * 0.8;
    let y = Infinity;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      y = Math.min(y, heightAt(x + Math.cos(a) * rr, z + Math.sin(a) * rr));
    }
    y = Math.min(y, heightAt(x, z));
    // пласты у кромки лежат вдоль склона
    const yaw = big ? th + Math.PI / 2 + (rnd() - 0.5) * 0.5 : rnd() * Math.PI * 2;
    e.set((rnd() - 0.5) * 0.25, yaw, (rnd() - 0.5) * 0.25, 'YXZ');
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, y - sy * 0.15, z), q, new THREE.Vector3(big ? sx * 1.5 : sx, sy, sz));
    const k = big ? Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 3);
    buckets[k].push(m.clone());
    return true;
  };
  // скальные пласты-выступы под кромкой площадки
  for (let i = 0; i < 700; i++) {
    const th = rnd() * Math.PI * 2;
    const R = plateauRadius(th);
    const r = R + 2 + rnd() * 18;
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    const rk = rockiness(r - R, th, x, z);
    if (rnd() > rk * 0.55) continue;
    place(x, z, 1.6 + rnd() * rnd() * 3.5, 0.5, true);
  }
  // валуны на склонах, реже — у подножия
  for (let i = 0; i < 1600; i++) {
    const th = rnd() * Math.PI * 2;
    const R = plateauRadius(th);
    const r = R + 5 + Math.pow(rnd(), 1.6) * 190;
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    const rk = rockiness(r - R, th, x, z);
    if (rnd() > 0.1 + rk * 0.5) continue;
    place(x, z, 0.3 + rnd() * rnd() * 1.8, 0.75, false);
  }
  return geos.map((g, k) => {
    const list = buckets[k];
    const im = new THREE.InstancedMesh(g, mat, Math.max(1, list.length));
    list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.count = list.length;
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    im.name = 'rocks';
    return im;
  });
}

// ---------------------------------------------------------------------------
// Река: лента воды по руслу
// ---------------------------------------------------------------------------
function buildRiver() {
  const positions = [], uvs = [], idx = [];
  const hw = RIVER.halfWidth + 5;
  let vi = 0;
  for (let x = -WORLD.half; x <= WORLD.half; x += 6) {
    const z = riverZ(x);
    const dzdx = (riverZ(x + 1) - riverZ(x - 1)) / 2;
    const l = Math.hypot(1, dzdx);
    const nx = -dzdx / l, nz = 1 / l;
    positions.push(x - nx * hw, RIVER.waterLevel, z - nz * hw, x + nx * hw, RIVER.waterLevel, z + nz * hw);
    uvs.push(x / 30, -hw / 30, x / 30, hw / 30);
    if (vi > 0) idx.push(vi - 2, vi, vi - 1, vi - 1, vi, vi + 1);
    vi += 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  if (geo.getAttribute('normal').getY(0) < 0) {
    const ia = geo.index.array;
    for (let k = 0; k < ia.length; k += 3) { const t = ia[k + 1]; ia[k + 1] = ia[k + 2]; ia[k + 2] = t; }
    geo.computeVertexNormals();
  }
  const nm = waterNormal();
  nm.repeat.set(1, 1);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2e4a4c, roughness: 0.06, metalness: 0.0, normalMap: nm,
    normalScale: new THREE.Vector2(0.35, 0.35), transparent: true, opacity: 0.88,
    envMapIntensity: 1.2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'river';
  return mesh;
}
