// Рельеф: холм с естественной вершиной и скальными выходами, уступы и осыпи
// на склонах, терраса с вырубленным в скале рвом, дорога-серпантин с подпорными
// стенками, извилистая река с неровными берегами, дальние холмы.
import * as THREE from 'three';
import { createNoise2D, fbm, ridged, mulberry32, clamp, lerp, smoothstep } from './noise.js';
import {
  HILL_TOP, GATE_ANGLE, GATE_DIR, GATE_RADIUS, plateauRadius, KEEP_POS, KEEP_RISE,
  DITCH, SPUR, riverZ, riverHalfWidth, RIVER, WORLD, insideTower, GATEHOUSE, GATE_PASSAGE, MOAT,
} from './layout.js';
import { textureArrays, macroNoiseTexture, pbrMaterial } from './textures.js';
import { triplanarMaterial, TRIPLANAR_GLSL, AUTUMN } from './materials.js';
import { Q } from './quality.js';

const nPlain = createNoise2D(101);
const nHill = createNoise2D(202);
const nRock = createNoise2D(303);
const nFar = createNoise2D(404);
const nTop = createNoise2D(505);
const nWarp = createNoise2D(606);
const nBank = createNoise2D(707);

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function smin(a, b, k) {
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}

// ---------------------------------------------------------------------------
// Составляющие рельефа
// ---------------------------------------------------------------------------
function plainHeight(x, z) {
  let h = 2.6 + fbm(nPlain, x / 260, z / 260, 4) * 2.4 + fbm(nPlain, x / 45 + 7, z / 45, 3) * 0.35;
  h = 0.9 + Math.log1p(Math.exp((h - 0.9) * 2)) / 2; // мягкое ограничение снизу
  const r = Math.hypot(x, z);
  const far = smoothstep(420, 1500, r);
  if (far > 0) {
    const f = fbm(nFar, x / 950, z / 950, 5) * 0.5 + 0.5;
    const rid = ridged(nFar, x / 600 + 3, z / 600, 4);
    h += far * (Math.pow(f, 1.5) * 210 + rid * 45);
  }
  return h;
}

function gateFactor(theta) {
  return Math.exp(-Math.pow(angDiff(theta, GATE_ANGLE) / 0.75, 2)); // 1 — южная, более пологая сторона
}
// 1 на кромке площадки → 0 у подножия
function hillProfile(e, theta) {
  const gf = gateFactor(theta);
  const L = 180 + 20 * gf;
  const pw = 2.2 - 0.85 * gf;
  const x = e / L;
  if (x >= 1) return 0;
  return Math.pow(1 - x, pw);
}

// Поверхность вершины: пологие перепады, самая высокая точка — у донжона,
// по краю — выходы коренной породы.
function topHeight(x, z, eP) {
  const dk = (x - KEEP_POS.x) ** 2 + (z - KEEP_POS.z) ** 2;
  let h = HILL_TOP + KEEP_RISE * Math.exp(-dk / (2 * 18 * 18));
  h += fbm(nTop, x / 45, z / 45, 3) * 1.3 + fbm(nTop, x / 14 + 5, z / 14, 2) * 0.25;
  h -= smoothstep(-25, 0, eP) * 0.8; // лёгкий уклон от центра к краям
  const band = smoothstep(-7, -2, eP) * (1 - smoothstep(0, 4, eP));
  if (band > 0) {
    const rb = ridged(nRock, x / 9, z / 9, 3);
    const patch = smoothstep(0.0, 0.35, fbm(nRock, x / 35 + 3, z / 35, 2));
    h += band * patch * Math.max(0, rb - 0.35) * 3.2;
  }
  return h;
}

// «Скальность»: обрывы под кромкой и пятна выходов породы на склонах
function rockiness(e, theta, x, z) {
  if (e < -1) return 0;
  const gf = gateFactor(theta);
  const cliff = smoothstep(-1, 2, e) * (1 - smoothstep(12 - gf * 5, 28 - gf * 10, e));
  const patch = smoothstep(0.05, 0.4, fbm(nRock, x / 60, z / 60, 3));
  const band = smoothstep(6, 14, e) * (1 - smoothstep(70, 130, e));
  const bands2 = smoothstep(0.25, 0.5, fbm(nRock, x / 34 + 9, z / 34, 3)) * band;
  return Math.max(cliff * (0.55 + 0.45 * patch), band * patch * 0.75 * (1 - gf * 0.5), bands2 * 0.9);
}

// Терраса перед воротами: знаковое расстояние до скруглённого прямоугольника
export function shelfDistance(along, across) {
  const cx = SPUR.length / 2 - 4;
  const hx = SPUR.length / 2 + 4 - SPUR.corner;
  const hz = SPUR.halfWidth - SPUR.corner;
  const qx = Math.abs(along - cx) - hx;
  const qz = Math.abs(across) - hz;
  const out = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
  return out + Math.min(Math.max(qx, qz), 0) - SPUR.corner;
}

// Сухой ров поперёк террасы
function ditchCut(along, across) {
  const j0 = fbm(nRock, across / 9, 1.3, 3) * 0.9;
  const j1 = fbm(nRock, across / 9, 7.7, 3) * 0.9;
  const din = Math.min(along - (DITCH.alongStart + j0), DITCH.alongEnd + j1 - along);
  if (din < -1.5) return Infinity;
  const floor = HILL_TOP - DITCH.depth + fbm(nRock, along / 5, across / 5, 3) * 0.6;
  const wall = 1 - smoothstep(-0.6, 1.2, din);
  let h = floor + DITCH.depth * 1.5 * wall;
  h += wall * (1 - wall) * 4 * ridged(nRock, along / 3, across / 3, 2) * 1.2;
  h += smoothstep(DITCH.halfLength - 8, DITCH.halfLength, Math.abs(across)) * 40;
  return h;
}

// Река: знаковое расстояние от оси, ширина с учётом неровного берега,
// признак внутренней стороны излучины (там галечные пляжи).
export function riverInfo(x, z) {
  const zr = riverZ(x);
  const d1 = (riverZ(x + 1) - riverZ(x - 1)) / 2;
  const d2 = riverZ(x + 1) - 2 * zr + riverZ(x - 1);
  const sd = (z - zr) / Math.sqrt(1 + d1 * d1);
  const side = sd >= 0 ? 1 : -1;
  const hw = riverHalfWidth(x) + fbm(nBank, x / 22, side * 7.3, 3) * 2.2;
  const inner = clamp(side * d2 * 60, 0, 1); // вогнутая сторона излучины
  return { sd, d: Math.abs(sd), e: Math.abs(sd) - hw, hw, inner, side };
}
export function riverDistance(x, z) {
  return riverInfo(x, z).d;
}

function riverCut(x, z) {
  const ri = riverInfo(x, z);
  if (ri.e > 400) return Infinity;
  const wl = RIVER.waterLevel;
  if (ri.e < 0) {
    const t = clamp(-ri.e / ri.hw, 0, 1);
    return wl + 0.05 - RIVER.depth * smoothstep(0, 0.7, t) + fbm(nBank, x / 6, z / 6, 2) * 0.25;
  }
  // берег: на внешней стороне излучины — крутой обрывчик, на внутренней — пологий пляж
  const steep = lerp(0.55, 0.07, ri.inner) * (0.7 + 0.6 * (fbm(nBank, x / 40, z / 40, 2) * 0.5 + 0.5));
  const e = ri.e;
  // вдали — широкая пологая долина, а не каньон в дальних холмах
  return wl + 0.05 + Math.min(e * steep, 1.4 + e * 0.05) + Math.pow(e / 90, 2) * 9 + Math.pow(e / 160, 3) * 30;
}

function terrace(h, step) {
  const f = h / step;
  const fi = Math.floor(f);
  const fr = f - fi;
  return (fi + smoothstep(0.15, 0.85, fr) * 0.35 + fr * 0.65) * step;
}

// Полное описание точки естественного рельефа (без дороги)
function sampleNatural(x, z) {
  const r = Math.hypot(x, z);
  const theta = Math.atan2(z, x);
  const R = plateauRadius(theta);
  const along = x * GATE_DIR.x + z * GATE_DIR.z - GATE_RADIUS;
  const across = x * GATE_DIR.z - z * GATE_DIR.x;
  const eP = r - R;
  const eS = shelfDistance(along, across);
  const e = smin(eP, eS, 6);
  const ws = smoothstep(-5, 5, eP - eS);
  const shelfTop = HILL_TOP - SPUR.drop - Math.max(0, along) * 0.03 + fbm(nTop, x / 20, z / 20, 2) * 0.35;
  const top = lerp(topHeight(x, z, eP), shelfTop, ws);
  let h;
  let rk = 0;
  if (e <= 0) h = top;
  else {
    // плавное «плечо» у кромки вершины
    const es = e < 8 ? (e * e) / 16 : e - 4;
    // искажённые координаты: неровные лопасти, отроги и ложбины разного масштаба
    const wx = x + fbm(nWarp, x / 150, z / 150, 3) * 45;
    const wz = z + fbm(nWarp, x / 150 + 7, z / 150, 3) * 45;
    const eD = es + fbm(nHill, wx / 120, wz / 120, 3) * 22 * smoothstep(0, 40, e);
    const P = hillProfile(Math.max(0, eD), theta);
    const plain = plainHeight(x, z);
    h = plain + (top - plain) * P;
    const amp = smoothstep(3, 25, e) * Math.sqrt(P);
    h += amp * (fbm(nHill, wx / 65, wz / 65, 4) * 4.5 + fbm(nHill, wx / 21 + 3, wz / 21, 3) * 1.3);
    // редкие неглубокие промоины — только в отдельных местах, не по всему склону
    const gm = smoothstep(0.15, 0.45, fbm(nWarp, x / 200 + 3, z / 200, 2));
    h -= amp * gm * Math.pow(ridged(nHill, wx / 45 + 11, wz / 45, 2), 3) * 3.5;
    rk = rockiness(e, theta, x, z);
    if (rk > 0) {
      h += rk * (ridged(nRock, wx / 26, wz / 26, 4) * 6 - 2.4) * smoothstep(0, 6, e);
      const stepH = 3.5 + 2.5 * (fbm(nRock, x / 90, z / 90, 2) * 0.5 + 0.5);
      h = lerp(h, terrace(h, stepH), rk * 0.8);
    }
    h += fbm(nHill, x / 7, z / 7, 2) * 0.18 * smoothstep(0, 10, e); // мелкие кочки
  }
  // проезд надвратной башни и пологий съезд во двор
  const gp = GATE_PASSAGE;
  if (Math.abs(x - GATEHOUSE.x) < 8 && z > gp.rampEndZ - 3 && z < gp.frontZ + 0.3) {
    const zc = gp.rampEndZ;
    const cy = topHeight(GATEHOUSE.x, zc, Math.hypot(GATEHOUSE.x, zc) - plateauRadius(Math.atan2(zc, GATEHOUSE.x)));
    const t = clamp((gp.backZ - z) / (gp.backZ - gp.rampEndZ), 0, 1);
    const w = (1 - smoothstep(5.2, 7.8, Math.abs(x - GATEHOUSE.x))) * smoothstep(zc - 3, zc, z);
    h = lerp(h, lerp(gp.thresholdY - 0.05, cy, t), w);
  }
  if (Math.abs(across) < DITCH.halfLength + 2) h = Math.min(h, ditchCut(along, across));
  // земляные дамбы в торцах рва держат воду
  if (along > DITCH.alongStart - 3 && along < DITCH.alongEnd + 3) {
    const d = Math.abs(across);
    if (d > MOAT.damStart - 2 && d < 45) {
      const damH = MOAT.level + 1.2 - 7 * (1 - smoothstep(MOAT.damStart, MOAT.damStart + 3.5, d)) - Math.max(0, d - 31) * 0.9
        + fbm(nTop, along / 6, d / 6, 2) * 0.25;
      h = Math.max(h, damH);
    }
  }
  h = Math.min(h, riverCut(x, z));
  return { h, e, eP, theta, rk, along, across };
}

export function baseHeight(x, z) {
  return sampleNatural(x, z).h;
}

// ---------------------------------------------------------------------------
// Дорога-серпантин (идёт с постоянным уклоном, в конце петли — шпилька)
// ---------------------------------------------------------------------------
const ROAD_HW = 2.3;
const ROAD_STEP = 1.5;
const ROAD_RIDGE_END = 33;

function gradient(x, z, eps = 3) {
  return [
    (baseHeight(x + eps, z) - baseHeight(x - eps, z)) / (2 * eps),
    (baseHeight(x, z + eps) - baseHeight(x, z - eps)) / (2 * eps),
  ];
}

export function buildRoadPath() {
  const pts = [];
  for (let a = DITCH.alongEnd + 1.5; a <= ROAD_RIDGE_END; a += ROAD_STEP) {
    pts.push({ x: GATE_DIR.x * (GATE_RADIUS + a), z: GATE_DIR.z * (GATE_RADIUS + a) });
  }
  let p = { ...pts[pts.length - 1] };
  let dir = { x: GATE_DIR.z, z: -GATE_DIR.x };
  let sigma = 1;
  let leg = 0;
  const grade = 0.065;
  let turns = 0;
  for (let step = 0; step < 4000; step++) {
    const h = baseHeight(p.x, p.z);
    if (h < 4.2 && step > 50) break;
    const [gx, gz] = gradient(p.x, p.z, 11);
    const gl = Math.hypot(gx, gz) + 1e-6;
    const u = { x: -gx / gl, z: -gz / gl };
    const t = { x: sigma * u.z, z: -sigma * u.x };
    const s = Math.min(0.9, grade / gl);
    const c = Math.sqrt(1 - s * s);
    const flat = smoothstep(grade * 2.5, grade * 1.2, gl);
    const want = { x: lerp(t.x * c + u.x * s, dir.x, flat), z: lerp(t.z * c + u.z * s, dir.z, flat) };
    dir.x = lerp(dir.x, want.x, 0.25);
    dir.z = lerp(dir.z, want.z, 0.25);
    const dl = Math.hypot(dir.x, dir.z);
    dir.x /= dl; dir.z /= dl;
    p = { x: p.x + dir.x * ROAD_STEP, z: p.z + dir.z * ROAD_STEP };
    pts.push({ ...p });
    leg += ROAD_STEP;
    const pa = p.x * GATE_DIR.x + p.z * GATE_DIR.z - GATE_RADIUS;
    const pc = p.x * GATE_DIR.z - p.z * GATE_DIR.x;
    const W = 30 + Math.max(0, pa) * 0.16 + (turns % 2) * 8;
    if (leg > 40 && ((sigma > 0 && pc > W) || (sigma < 0 && pc < -W))) {
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
  // к мосту через реку и дальше к деревне
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
  const dzdx = (riverZ(bx + 1) - riverZ(bx - 1)) / 2;
  const nl = Math.hypot(dzdx, 1);
  const rn = { x: -dzdx / nl, z: 1 / nl };
  const span = riverHalfWidth(bx) + 5;
  const approach = { x: bridge.x - rn.x * 35, z: bridge.z - rn.z * 35 };
  segTo(last, approach);
  const bankA = { x: bridge.x - rn.x * span, z: bridge.z - rn.z * span };
  const bankB = { x: bridge.x + rn.x * span, z: bridge.z + rn.z * span };
  segTo(approach, bankA);
  segTo(bankA, bankB, { bridge: true });
  const beyond = { x: bankB.x + rn.x * 45 + 20, z: bankB.z + rn.z * 45 };
  segTo(bankB, beyond);
  segTo(beyond, { x: beyond.x + 60, z: beyond.z + 30 });

  const fixed = Math.ceil((ROAD_RIDGE_END - DITCH.alongEnd - 1) / ROAD_STEP);
  for (let it = 0; it < 3; it++) {
    for (let i = fixed; i < pts.length - 1; i++) {
      if (pts[i].bridge) continue;
      pts[i].x = (pts[i - 1].x + pts[i].x * 2 + pts[i + 1].x) / 4;
      pts[i].z = (pts[i - 1].z + pts[i].z * 2 + pts[i + 1].z) / 4;
    }
  }
  const raw = pts.map((q) => baseHeight(q.x, q.z));
  const bi0 = pts.findIndex((q) => q.bridge);
  const bi1 = pts.length - 1 - [...pts].reverse().findIndex((q) => q.bridge);
  const deck = Math.max(raw[bi0 - 1], raw[bi1 + 1], RIVER.waterLevel + 2);
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
  for (let i = 0; i < pts.length; i++) {
    pts[i].h = hs[i];
    pts[i].raw = raw[i];
    if (i < fixed) pts[i].h = raw[i];
    else if (i < fixed + 20) pts[i].h = lerp(raw[i], hs[i], (i - fixed) / 20);
  }
  let s = 0;
  pts[0].s = 0;
  for (let i = 1; i < pts.length; i++) {
    s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    pts[i].s = s;
  }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    pts[i].dx = dx; pts[i].dz = dz;
    const off = ROAD_HW + 1.6;
    pts[i].fillL = pts[i].h - baseHeight(pts[i].x - dz * off, pts[i].z + dx * off);
    pts[i].fillR = pts[i].h - baseHeight(pts[i].x + dz * off, pts[i].z - dx * off);
  }
  return pts;
}

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
        const k = (gx * 73856093) ^ (gz * 19349663);
        let list = this.map.get(k);
        if (!list) this.map.set(k, (list = []));
        list.push(i);
      }
    }
  }
  nearest(x, z) {
    const k = (Math.floor(x / this.cell) * 73856093) ^ (Math.floor(z / this.cell) * 19349663);
    const list = this.map.get(k);
    if (!list) return null;
    let best = null, bd = Infinity;
    for (const i of list) {
      const a = this.pts[i], b = this.pts[i + 1];
      const ex = b.x - a.x, ez = b.z - a.z;
      const l2 = ex * ex + ez * ez || 1;
      const t = clamp(((x - a.x) * ex + (z - a.z) * ez) / l2, 0, 1);
      const d = Math.hypot(x - (a.x + ex * t), z - (a.z + ez * t));
      if (d < bd) {
        bd = d;
        best = { i, t, d, side: ex * (z - a.z) - ez * (x - a.x) };
      }
    }
    return best;
  }
}

// ---------------------------------------------------------------------------
// Сетка: мелкий шаг вокруг холма и реки, крупный — к горизонту
// ---------------------------------------------------------------------------
const GRID_N = Math.round(620 * Q.terrainDetail);
const U0 = (GRID_N - 120) / GRID_N;
const WA = WORLD.detailHalf / U0;
const WC = (WORLD.half - WA) / Math.pow(1 - U0, 3);
function warp(u) {
  const a = Math.abs(u);
  return Math.sign(u) * (a <= U0 ? WA * a : WA * a + WC * Math.pow(a - U0, 3));
}
function unwarp(x) {
  const a = Math.abs(x);
  if (a <= WA * U0) return Math.sign(x) * (a / WA);
  let u = Math.min(1, a / WA);
  for (let i = 0; i < 30; i++) {
    const f = WA * u + WC * Math.pow(u - U0, 3) - a;
    u -= f / (WA + 3 * WC * Math.pow(u - U0, 2));
  }
  return Math.sign(x) * u;
}

// слои материала рельефа
const LAYERS = ['grass', 'rock', 'dirt', 'gravel'];

export function createTerrain(scene) {
  const road = buildRoadPath();
  const grid = new SegmentGrid(road, 10, 22);
  const walls = computeWallRuns(road);

  function carve(x, z, h0) {
    const q = grid.nearest(x, z);
    if (!q || q.d > 22) return { h: h0, road: 0 };
    const a = road[q.i], b = road[q.i + 1];
    if (a.bridge && b.bridge) return { h: h0, road: 0 };
    const rh = lerp(a.h, b.h, q.t);
    const inner = ROAD_HW + 0.9;
    const walled = q.side > 0 ? a.wallL || b.wallL : a.wallR || b.wallR;
    const diff = rh - h0;
    const F = diff > 0 ? (walled ? 0.7 : Math.max(3, diff * 1.7)) : Math.max(2.5, -diff * 0.8);
    const w = 1 - smoothstep(inner, inner + F, q.d);
    const nearRiver = riverInfo(x, z).e < 1.5;
    return { h: nearRiver ? h0 : lerp(h0, rh, w), road: 1 - smoothstep(ROAD_HW - 0.3, ROAD_HW + 2.2, q.d) };
  }

  // --- геометрия ---
  const N = GRID_N;
  const V = N + 1;
  const xs = new Float32Array(V);
  for (let i = 0; i <= N; i++) xs[i] = warp((i / N) * 2 - 1);
  const pos = new Float32Array(V * V * 3);
  const heights = new Float32Array(V * V);
  const info = new Float32Array(V * V * 4); // дорога, скальность, расстояние до кромки, до реки
  for (let j = 0; j < V; j++) {
    const z = xs[j];
    for (let i = 0; i < V; i++) {
      const x = xs[i];
      const sN = sampleNatural(x, z);
      const c = carve(x, z, sN.h);
      const k = j * V + i;
      heights[k] = c.h;
      info[k * 4] = c.road;
      info[k * 4 + 1] = sN.rk;
      info[k * 4 + 2] = sN.eP;
      info[k * 4 + 3] = Math.abs(x) < 900 && Math.abs(z) < 900 ? riverInfo(x, z).e : 999;
      pos[k * 3] = x; pos[k * 3 + 1] = c.h; pos[k * 3 + 2] = z;
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

  // --- веса слоёв: трава / скала / земля / галька ---
  const nrm = geo.getAttribute('normal');
  const splat = new Float32Array(V * V * 4);
  for (let k = 0; k < V * V; k++) {
    const x = pos[k * 3], z = pos[k * 3 + 2], h = pos[k * 3 + 1];
    const slope = 1 - nrm.getY(k); // 0 — горизонталь
    const roadW = info[k * 4], rk = info[k * 4 + 1], eP = info[k * 4 + 2], re = info[k * 4 + 3];
    // по крутизне: трава держится до ~40°, круче — скала
    let rock = smoothstep(0.24, 0.42, slope);
    rock = Math.max(rock, rk * smoothstep(0.1, 0.26, slope));
    if (eP > -7 && eP < 3) rock = Math.max(rock, smoothstep(0.06, 0.16, slope) * 0.9); // выходы по кромке
    const along = x * GATE_DIR.x + z * GATE_DIR.z - GATE_RADIUS;
    const across = x * GATE_DIR.z - z * GATE_DIR.x;
    if (along > DITCH.alongStart - 1.5 && along < DITCH.alongEnd + 1.5 && Math.abs(across) < MOAT.damStart && h < HILL_TOP - 1) rock = 1;
    // осыпи: мелкий камень под скальными поясами
    const theta = Math.atan2(z, x);
    const eHere = Math.hypot(x, z) - plateauRadius(theta);
    const above = eHere > 0 ? rockiness(eHere - 14, theta, x, z) : 0;
    let gravel = smoothstep(0.3, 0.7, above) * smoothstep(0.08, 0.2, slope) * (1 - rock) * 0.9;
    // берега: у самой воды ил и галька, на внутренних излучинах — пляж
    if (re < 6) {
      const ri = riverInfo(x, z);
      gravel = Math.max(gravel, (1 - smoothstep(0.3, 1.2 + ri.inner * 6, re)) * (0.55 + ri.inner * 0.45));
    }
    // дорога и вытоптанная земля; двор замка — утоптанная земля с травой
    let dirt = roadW * 0.95;
    if (eP < -4) dirt = Math.max(dirt, 0.35);
    rock *= 1 - gravel * 0.5;
    dirt *= 1 - rock * 0.8;
    const grass = Math.max(0, 1 - rock - dirt - gravel);
    const sum = grass + rock + dirt + gravel || 1;
    splat[k * 4] = grass / sum;
    splat[k * 4 + 1] = rock / sum;
    splat[k * 4 + 2] = dirt / sum;
    splat[k * 4 + 3] = gravel / sum;
  }
  geo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
  geo.computeBoundingSphere();

  const mat = makeTerrainMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  // рельеф не рисуется в карту теней: это самый «тяжёлый» объект, а склоны,
  // отвёрнутые от солнца, и так затеняются по освещению
  mesh.castShadow = false;
  mesh.name = 'terrain';
  scene.add(mesh);

  // --- выборка высоты сетки (совпадает с треугольниками) ---
  function cellOf(x, z) {
    const u = ((unwarp(x) + 1) / 2) * N;
    const v = ((unwarp(z) + 1) / 2) * N;
    const i = clamp(Math.floor(u), 0, N - 1);
    const j = clamp(Math.floor(v), 0, N - 1);
    return {
      i, j,
      fx: clamp((x - xs[i]) / (xs[i + 1] - xs[i]), 0, 1),
      fz: clamp((z - xs[j]) / (xs[j + 1] - xs[j]), 0, 1),
    };
  }
  function heightAt(x, z) {
    const { i, j, fx, fz } = cellOf(x, z);
    const h00 = heights[j * V + i], h10 = heights[j * V + i + 1];
    const h01 = heights[(j + 1) * V + i], h11 = heights[(j + 1) * V + i + 1];
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }
  // сведения о поверхности для расстановки растительности
  function groundAt(x, z) {
    const { i, j, fx, fz } = cellOf(x, z);
    const k = (fz < 0.5 ? j : j + 1) * V + (fx < 0.5 ? i : i + 1);
    return {
      h: heightAt(x, z),
      grass: splat[k * 4], rock: splat[k * 4 + 1], dirt: splat[k * 4 + 2], gravel: splat[k * 4 + 3],
      slope: 1 - nrm.getY(k),
      eP: info[k * 4 + 2],
      river: info[k * 4 + 3],
      road: info[k * 4],
    };
  }

  scene.add(buildRoadMesh(road));
  scene.add(buildRetainingWalls(road, walls, heightAt));
  buildRocks(heightAt, grid, groundAt).forEach((r) => scene.add(r));

  return { mesh, heightAt, groundAt, road, roadNearest: (x, z) => grid.nearest(x, z) };
}

// ---------------------------------------------------------------------------
// Материал рельефа: 4 PBR-слоя в текстурных массивах, трипланарная проекция,
// смешивание по весам с учётом «высоты» текстуры (трава прорастает между камнями).
// ---------------------------------------------------------------------------
function makeTerrainMaterial() {
  const arr = textureArrays(LAYERS, Q.textureSize);
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  const uniforms = {
    tArrC: { value: arr.color },
    tArrN: { value: arr.normal },
    tArrO: { value: arr.orm },
    tMacro: { value: macroNoiseTexture() },
    tileInv: { value: new THREE.Vector4(...arr.tileMeters.map((m) => 1 / m)) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.uniforms.uAutumn = AUTUMN;
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
        vWNrm = normalize(mat3(modelMatrix) * objectNormal);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2DArray tArrC, tArrN, tArrO;
        uniform sampler2D tMacro;
        uniform vec4 tileInv;
        uniform float uAutumn;
        varying vec4 vSplat;
        varying vec3 vWPos;
        varying vec3 vWNrm;
        vec3 gCol, gOrm, gNrm;
        ${TRIPLANAR_GLSL}`
      )
      .replace(
        '#include <map_fragment>',
        `{
          vec3 n = normalize(vWNrm);
          vec3 bw = triBlend(n);
          vec3 dx = dFdx(vWPos), dy = dFdy(vWPos);
          vec4 w = vSplat;
          vec3 macro = texture2D(tMacro, vWPos.xz * 0.0021).rgb;
          vec3 macro2 = texture2D(tMacro, vWPos.xz * 0.011).rgb;
          vec3 c0 = vec3(0.0), c1 = vec3(0.0), c2 = vec3(0.0), c3 = vec3(0.0);
          vec3 o0 = vec3(1.0, 1.0, 0.0), o1 = o0, o2 = o0, o3 = o0;
          vec3 n0 = n, n1 = n, n2 = n, n3 = n;
          float sc;
          // зоны перехода между слоями делаем «рваными» — без ступенек по треугольникам сетки
          float edgeN = texture2D(tMacro, vWPos.xz * 0.045).g - 0.5 + (macro2.r - 0.5) * 0.6;
          w.y = clamp(w.y + edgeN * 0.9 * w.y * (1.0 - w.y) * 4.0, 0.0, 1.0);
          w.w = clamp(w.w - edgeN * 0.6 * w.w * (1.0 - w.w) * 4.0, 0.0, 1.0);
          w /= max(1e-4, w.x + w.y + w.z + w.w);
          if (w.x > 0.004) { sc = tileInv.x; planarSampleArr(tArrC, tArrN, tArrO, 0.0, vWPos * sc, dx * sc, dy * sc, n, 0.55, c0, o0, n0); }
          if (w.y > 0.004) {
            sc = tileInv.y; triSampleArr(tArrC, tArrN, tArrO, 1.0, vWPos * sc, dx * sc, dy * sc, n, bw, 1.3, c1, o1, n1);
            #ifdef ROCK_DETAIL
            // второй, крупный масштаб скалы — без заметных повторов
            vec3 cb, ob, nb; float s2 = sc * 0.23;
            triSampleArr(tArrC, tArrN, tArrO, 1.0, vWPos * s2 + 0.37, dx * s2, dy * s2, n, bw, 1.0, cb, ob, nb);
            c1 = mix(c1, cb, 0.45);
            n1 = normalize(n1 + nb - n);
            #endif
            c1 *= mix(0.85, 1.1, macro2.b);
          }
          if (w.z > 0.004) { sc = tileInv.z; planarSampleArr(tArrC, tArrN, tArrO, 2.0, vWPos * sc, dx * sc, dy * sc, n, 1.0, c2, o2, n2); }
          if (w.w > 0.004) { sc = tileInv.w; planarSampleArr(tArrC, tArrN, tArrO, 3.0, vWPos * sc, dx * sc, dy * sc, n, 1.0, c3, o3, n3); }

          // трава: крупные пятна оттенков, сухость на высоте, леса на дальних холмах
          c0 *= mix(vec3(0.82, 0.88, 0.8), vec3(1.1, 1.05, 0.92), macro.r);
          c0 = mix(c0, c0 * vec3(1.28, 1.08, 0.72), smoothstep(0.5, 0.72, macro.g) * 0.6);
          c0 = mix(c0, c0 * vec3(0.72, 0.84, 0.7), smoothstep(0.55, 0.3, macro.g) * 0.45);
          float alt = smoothstep(40.0, 84.0, vWPos.y) * (1.0 - smoothstep(160.0, 220.0, length(vWPos.xz)));
          c0 = mix(c0, c0 * vec3(1.12, 1.0, 0.78), alt * 0.5);
          float farK = smoothstep(420.0, 900.0, length(vWPos.xz));
          float forest = smoothstep(0.46, 0.56, texture2D(tMacro, vWPos.xz * 0.0009 + 0.2).b) * farK;
          c0 = mix(c0, vec3(0.07, 0.1, 0.045) * (0.8 + 0.5 * macro2.r), forest);
          // осень: трава буреет, пятна опавшей листвы
          vec3 autG = mix(c0 * vec3(1.15, 0.95, 0.55), vec3(0.5, 0.26, 0.08) * (0.7 + 0.5 * macro.r), smoothstep(0.6, 0.72, macro2.g) * 0.8);
          c0 = mix(c0, autG, uAutumn * 0.75);

          // смешивание по «высоте»: камни и кочки проступают сквозь соседний слой
          vec4 hgt = vec4(o0.r, o1.r * 0.8 + 0.2, o2.r, o3.r);
          vec4 hw = w + hgt * 0.35 * step(vec4(0.004), w);
          float ma = max(max(hw.x, hw.y), max(hw.z, hw.w)) - 0.3;
          vec4 b = max(hw - ma, 0.0);
          b /= max(1e-4, b.x + b.y + b.z + b.w);

          gCol = c0 * b.x + c1 * b.y + c2 * b.z + c3 * b.w;
          gOrm = o0 * b.x + o1 * b.y + o2 * b.z + o3 * b.w;
          gNrm = normalize(n0 * b.x + n1 * b.y + n2 * b.z + n3 * b.w);
          diffuseColor.rgb *= gCol;
        }`
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * gOrm.g;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(gNrm, 0.0)).xyz);')
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= gOrm.r;
        reflectedLight.indirectSpecular *= gOrm.r;
        reflectedLight.directDiffuse *= mix(1.0, gOrm.r, 0.5);`
      );
  };
  if (Q.rockDetail) mat.defines = { ROCK_DETAIL: '' };
  mat.customProgramCacheKey = () => 'terrain-v3' + (Q.rockDetail ? 'd' : '');
  return mat;
}

// ---------------------------------------------------------------------------
// Полотно дороги: утоптанная земля с колеями, края плавно растворяются в рельефе
// ---------------------------------------------------------------------------
function buildRoadMesh(road) {
  const positions = [], uvs = [], colors = [], idx = [];
  // [смещение поперёк, непрозрачность, яркость — колеи темнее]
  const across = [
    [-1.0, 0.0, 1.0], [-0.72, 0.9, 1.0], [-0.42, 1.0, 0.82], [0, 1.0, 1.0], [0.42, 1.0, 0.82], [0.72, 0.9, 1.0], [1.0, 0.0, 1.0],
  ];
  const tile = 3;
  let vi = 0;
  let open = false;
  const K = across.length;
  for (let i = 0; i < road.length; i++) {
    const q = road[i];
    if (q.bridge) { open = false; continue; }
    const nx = -q.dz, nz = q.dx;
    for (const [o, a, br] of across) {
      const w = o * (ROAD_HW + 0.8);
      const y = q.h + 0.06 - Math.abs(o) * 0.05 - (br < 0.9 ? 0.03 : 0);
      positions.push(q.x + nx * w, y, q.z + nz * w);
      uvs.push(w / tile, q.s / tile);
      colors.push(br, br, br, a);
    }
    if (open) {
      for (let k = 0; k < K - 1; k++) {
        const a = vi - K + k, b = a + 1, c = vi + k, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    vi += K;
    open = true;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  if (geo.getAttribute('normal').getY(0) < 0) {
    const ia = geo.index.array;
    for (let k = 0; k < ia.length; k += 3) { const t = ia[k + 1]; ia[k + 1] = ia[k + 2]; ia[k + 2] = t; }
    geo.computeVertexNormals();
  }
  const mat = pbrMaterial('dirt', {
    vertexColors: true, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.name = 'road';
  return mesh;
}

// ---------------------------------------------------------------------------
// Подпорные стенки там, где полотно дороги на насыпи (особенно на поворотах)
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
  for (const r of runs) {
    r.from = Math.max(0, r.from - 2);
    r.to = Math.min(road.length - 1, r.to + 2);
    for (let i = r.from; i <= r.to; i++) road[i]['wall' + r.side] = true;
  }
  return runs;
}

function buildRetainingWalls(road, runs, heightAt) {
  const positions = [], uvs = [], idx = [];
  let vi = 0;
  const mat = pbrMaterial('rubbleStone', { side: THREE.DoubleSide });
  const TILE = mat.userData.tileMeters;
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
    for (let k = 0; k < rows.length; k++) {
      const w = rows[k];
      const u = w.s / TILE;
      positions.push(w.ox, w.top, w.oz, w.ox + w.nx * w.batter, w.ground, w.oz + w.nz * w.batter);
      uvs.push(u, w.top / TILE, u, w.ground / TILE);
      positions.push(w.ix, w.top, w.iz, w.ox, w.top, w.oz);
      uvs.push(u, 0, u, thick / TILE);
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
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'retaining-walls';
  return mesh;
}

// ---------------------------------------------------------------------------
// Скалы, валуны, осыпи и камни у реки (InstancedMesh)
// ---------------------------------------------------------------------------
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

export function rockGeometry(seed, detail) {
  const g = mergeVerticesSimple(new THREE.IcosahedronGeometry(1, detail));
  const n = createNoise2D(seed);
  const n2 = createNoise2D(seed + 1);
  const rnd = mulberry32(seed * 13);
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
      if (dist > pl.d) {
        v.x -= pl.nx * (dist - pl.d) * 0.85;
        v.y -= pl.ny * (dist - pl.d) * 0.85;
        v.z -= pl.nz * (dist - pl.d) * 0.85;
      }
    }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function buildRocks(heightAt, roadGrid, groundAt) {
  const rnd = mulberry32(77);
  // крупные глыбы, валуны, мелкие камни осыпей
  const d = Q.rockDetail ? 0 : 1; // на низком качестве камни проще
  const kinds = [
    { geo: rockGeometry(1, 3 - d), list: [] },
    { geo: rockGeometry(2, 3 - d), list: [] },
    { geo: rockGeometry(3, 2 - d), list: [] },
    { geo: rockGeometry(4, 2 - d), list: [] },
    { geo: rockGeometry(5, 1), list: [] },
    { geo: rockGeometry(6, 1), list: [] },
  ];
  const mat = triplanarMaterial('rock', { scale: 1.6, tint: 0.3, normalStrength: 1.2 });
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const place = (x, z, scale, flat, kind, opts = {}) => {
    const rd = roadGrid.nearest(x, z);
    if (rd && rd.d < ROAD_HW + 1.5 + scale) return false;
    const along = x * GATE_DIR.x + z * GATE_DIR.z - GATE_RADIUS;
    const across = x * GATE_DIR.z - z * GATE_DIR.x;
    if (along > -3 && along < DITCH.alongEnd + 3 && Math.abs(across) < 16) return false;
    const th = Math.atan2(z, x);
    if (!opts.allowTop && Math.hypot(x, z) < plateauRadius(th) + 1.5) return false;
    if (shelfDistance(along, across) < 2) return false;
    if (insideTower(x, z, scale + 1.5)) return false;
    if (!opts.allowWater && riverInfo(x, z).e < scale) return false;
    const sx = scale * (0.8 + rnd() * 0.6);
    const sy = scale * flat * (0.6 + rnd() * 0.5);
    const sz = scale * (0.8 + rnd() * 0.6);
    const rr = Math.max(sx, sz) * 0.8;
    let y = heightAt(x, z);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      y = Math.min(y, heightAt(x + Math.cos(a) * rr, z + Math.sin(a) * rr));
    }
    const yaw = opts.alongSlope ? th + Math.PI / 2 + (rnd() - 0.5) * 0.5 : rnd() * Math.PI * 2;
    e.set((rnd() - 0.5) * 0.3, yaw, (rnd() - 0.5) * 0.3, 'YXZ');
    q.setFromEuler(e);
    pos.set(x, y - sy * (opts.sink || 0.15), z);
    scl.set(opts.alongSlope ? sx * 1.5 : sx, sy, sz);
    m.compose(pos, q, scl);
    kinds[kind].list.push(m.clone());
    return true;
  };
  // скальные пласты-выступы под кромкой площадки
  for (let i = 0; i < 800; i++) {
    const th = rnd() * Math.PI * 2;
    const R = plateauRadius(th);
    const r = R + 2 + rnd() * 18;
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    if (rnd() > rockiness(r - R, th, x, z) * 0.55) continue;
    place(x, z, 1.6 + rnd() * rnd() * 3.5, 0.5, Math.floor(rnd() * 2), { alongSlope: true });
  }
  // глыбы, торчащие из земли у самого края площадки
  for (let i = 0; i < 160; i++) {
    const th = rnd() * Math.PI * 2;
    const R = plateauRadius(th);
    const r = R - 1 + rnd() * 3;
    place(Math.cos(th) * r, Math.sin(th) * r, 0.8 + rnd() * 1.4, 0.55, 2 + Math.floor(rnd() * 2), { allowTop: true, sink: 0.35 });
  }
  // валуны на склонах, реже — у подножия
  for (let i = 0; i < 1800; i++) {
    const th = rnd() * Math.PI * 2;
    const R = plateauRadius(th);
    const r = R + 5 + Math.pow(rnd(), 1.6) * 190;
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    if (rnd() > 0.08 + rockiness(r - R, th, x, z) * 0.5) continue;
    place(x, z, 0.3 + rnd() * rnd() * 1.8, 0.75, 2 + Math.floor(rnd() * 2));
  }
  // осыпи: много мелких камней там, где слой «галька» на склонах
  for (let i = 0; i < 40000; i++) {
    const th = rnd() * Math.PI * 2;
    const R = plateauRadius(th);
    const r = R + 8 + rnd() * 150;
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    const g = groundAt(x, z);
    if (g.river < 30 || rnd() > g.gravel * 0.9) continue;
    place(x, z, 0.12 + rnd() * rnd() * 0.5, 0.7, 4 + Math.floor(rnd() * 2), { sink: 0.3 });
  }
  // камни на берегах и в воде
  for (let i = 0; i < 9000; i++) {
    const x = (rnd() - 0.5) * 800;
    const zr = riverZ(x);
    const off = (rnd() - 0.5) * 2 * (riverHalfWidth(x) + 5);
    const z = zr + off;
    const r2 = riverInfo(x, z);
    if (r2.e < -2.5 || r2.e > 3.5) continue;
    if (rnd() > 0.25) continue;
    place(x, z, 0.2 + rnd() * rnd() * 0.9, 0.6, 2 + Math.floor(rnd() * 4), { allowWater: true, sink: 0.3 });
  }
  return kinds.map((k, ki) => {
    const im = new THREE.InstancedMesh(k.geo, mat, Math.max(1, k.list.length));
    k.list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.count = k.list.length;
    // мелкие камни осыпей не отбрасывают тень и не отражаются в воде (экономия)
    im.castShadow = ki < 4;
    if (ki >= 4) im.layers.set(2);
    im.receiveShadow = true;
    im.computeBoundingSphere();
    im.name = 'rocks';
    return im;
  });
}
