// Этап 6: внутренний двор. Большой зал с витражами, часовня с колокольней,
// кухня с трубой и дымом, колодец с воротом, конюшня со стойлами, кузница
// с горном и наковальней, казармы, склад и амбар; мелочи двора — бочки,
// ящики, телеги, сено, стойки с копьями, мишени; мощение двора булыжником.
import * as THREE from 'three';
import { BUILDINGS, WELL, KEEP, GATEHOUSE, GATE_PASSAGE, insideBuilding, insideTower } from './layout.js';
import { GeoBuilder } from './walls.js';
import {
  makeTowerContext, finishTowerContext, door, windowWithShutters, arrowSlit, pyramidRoof,
  rowUV, ROW_H, outline, band, ring,
} from './towers.js';
import { pbrMaterial, makeCanvas, toTexture, assetSource } from './textures.js';
import { mulberry32, createNoise2D } from './noise.js';
import { Q } from './quality.js';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);

// ---------------------------------------------------------------------------
// Локальная система координат постройки: lx — вдоль стены (−L/2…L/2),
// lz — к двору (фасад на +W/2, задняя стена на −W/2), y — мировая высота.
// ---------------------------------------------------------------------------
// Размеры большого зала (нужны для интерьера)
export const HALL = {};

export class Frame {
  constructor(b) {
    this.b = b;
    this.C = new V3(b.x, 0, b.z);
    this.X = new V3(b.ax, 0, b.az);
    this.N = new V3(b.nx, 0, b.nz);
    this.yaw = Math.atan2(b.az, b.ax);
  }
  p(lx, y, lz) {
    return this.C.clone().addScaledVector(this.X, lx).addScaledVector(this.N, lz).setY(y);
  }
  d(dx, dy, dz) {
    return new V3().addScaledVector(this.X, dx).addScaledVector(UP, dy).addScaledVector(this.N, dz).normalize();
  }
}

// Высота земли под постройкой: минимум и максимум по площади
function groundRange(terrain, f, L, W) {
  let lo = Infinity, hi = -Infinity;
  for (let i = -1; i <= 1; i += 0.25) {
    for (let j = -1; j <= 1; j += 0.25) {
      const p = f.p((i * L) / 2, 0, (j * W) / 2);
      const h = terrain.heightAt(p.x, p.z);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
  }
  return { lo, hi };
}

// ---------------------------------------------------------------------------
// Черепичный скат рядами: прямоугольник от нижней кромки (a0—a1) до верхней (b0—b1)
// ---------------------------------------------------------------------------
function slope(b, a0, a1, b0, b1, photo) {
  const up = b0.clone().sub(a0);
  const Ls = up.length();
  const across = a1.clone().sub(a0);
  const Wd = across.length();
  const n = new V3().crossVectors(across, up).normalize();
  if (n.y < 0) n.negate();
  const rows = Math.max(1, Math.ceil(Ls / ROW_H));
  for (let k = 0; k < rows; k++) {
    const s0 = (k * ROW_H) / Ls, s1 = Math.min(1, ((k + 1) * ROW_H + 0.07) / Ls);
    const lo0 = a0.clone().lerp(b0, s0).addScaledVector(n, 0.045);
    const lo1 = a1.clone().lerp(b1, s0).addScaledVector(n, 0.045);
    const hi0 = a0.clone().lerp(b0, s1), hi1 = a1.clone().lerp(b1, s1);
    const U = Wd / 1.56;
    const uv = photo
      ? [[0, (k * ROW_H) / 1.56], [U, (k * ROW_H) / 1.56], [U, ((k + 1) * ROW_H) / 1.56], [0, ((k + 1) * ROW_H) / 1.56]]
      : [rowUV(k, 0, false), rowUV(k, U, false), rowUV(k, U, true), rowUV(k, 0, true)];
    b.quad4([lo0, lo1, hi1, hi0], [n, n, n, n], uv);
    const in0 = a0.clone().lerp(b0, s0), in1 = a1.clone().lerp(b1, s0);
    const dn = up.clone().normalize().negate();
    b.quad4([in0, in1, lo1, lo0], [dn, dn, dn, dn], [[0, 0.02], [U, 0.02], [U, 0], [0, 0]]);
  }
  return n;
}

// Двускатная крыша с коньком вдоль lx; возвращает высоту конька
export function gableRoof(roofB, woodB, f, L, W, eaveY, pitch, photo, over = 0.55, overEnd = 0.45) {
  const run = W / 2 + over;
  const H = (W / 2) * pitch;
  const ridgeY = eaveY + H;
  const drop = over * pitch;
  const x0 = -L / 2 - overEnd, x1 = L / 2 + overEnd;
  for (const s of [1, -1]) {
    const a0 = f.p(x0, eaveY - drop, s * run), a1 = f.p(x1, eaveY - drop, s * run);
    const b0 = f.p(x0, ridgeY + 0.02, 0), b1 = f.p(x1, ridgeY + 0.02, 0);
    slope(roofB, s > 0 ? a1 : a0, s > 0 ? a0 : a1, s > 0 ? b1 : b0, s > 0 ? b0 : b1, photo);
    // дощатая подшивка снизу
    const dn = f.d(0, -1, -s * pitch * 0.5);
    woodB.quad(a0.clone().addScaledVector(UP, -0.06), a1.clone().addScaledVector(UP, -0.06), b1.clone().addScaledVector(UP, -0.12), b0.clone().addScaledVector(UP, -0.12), dn,
      [[0, 0], [L, 0], [L, run], [0, run]]);
  }
  // конёк
  const rc = f.p(0, ridgeY + 0.1, 0);
  roofB.box(rc, f.X, UP, f.N, (x1 - x0) / 2, 0.1, 0.16, { grain: true });
  // ветровые доски по фронтонам
  for (const e of [x0 + 0.03, x1 - 0.03]) {
    for (const s of [1, -1]) {
      const a = f.p(e, eaveY - drop, s * run), c = f.p(e, ridgeY, 0);
      const ax = c.clone().sub(a);
      const len = ax.length();
      ax.normalize();
      const side = new V3().crossVectors(ax, f.X).normalize();
      woodB.box(a.clone().lerp(c, 0.5), ax, side, f.X, len / 2, 0.12, 0.03, { grain: true });
    }
  }
  return ridgeY;
}

// Односкатная крыша: высокая сторона у крепостной стены
function leanRoof(roofB, woodB, f, L, W, backY, frontY, photo, over = 0.5) {
  const k = (backY - frontY) / W;
  const a0 = f.p(L / 2 + 0.35, frontY - over * k, W / 2 + over), a1 = f.p(-L / 2 - 0.35, frontY - over * k, W / 2 + over);
  const b0 = f.p(L / 2 + 0.35, backY + 0.25 * k, -W / 2 - 0.25), b1 = f.p(-L / 2 - 0.35, backY + 0.25 * k, -W / 2 - 0.25);
  slope(roofB, a0, a1, b0, b1, photo);
  woodB.quad(a1.clone().addScaledVector(UP, -0.06), a0.clone().addScaledVector(UP, -0.06), b0.clone().addScaledVector(UP, -0.06), b1.clone().addScaledVector(UP, -0.06),
    f.d(0, -1, 0), [[0, 0], [L, 0], [L, W], [0, W]]);
  // торцевые доски
  for (const e of [-L / 2 - 0.32, L / 2 + 0.32]) {
    const a = f.p(e, frontY - over * k, W / 2 + over), c = f.p(e, backY + 0.25 * k, -W / 2 - 0.25);
    const ax = c.clone().sub(a);
    const len = ax.length();
    ax.normalize();
    woodB.box(a.clone().lerp(c, 0.5), ax, new V3().crossVectors(ax, f.X).normalize(), f.X, len / 2, 0.1, 0.03, { grain: true });
  }
}

// ---------------------------------------------------------------------------
// Каменная коробка: стены, цоколь, угловые камни (руст), фронтоны
// roof: 'gable' (конёк вдоль lx, фронтоны на торцах) или 'lean' (высокая задняя стена)
// ---------------------------------------------------------------------------
export function stoneBox(stone, f, L, W, floorY, baseY, eaveY, roofType, pitch, backY) {
  const face = (lx0, lz0, lx1, lz1, n, yTop0, yTop1) => {
    const p0 = f.p(lx0, baseY, lz0), p1 = f.p(lx1, baseY, lz1);
    const p2 = f.p(lx1, yTop1, lz1), p3 = f.p(lx0, yTop0, lz0);
    const u0 = lx0 * f.X.x + lz0 * f.N.x + f.C.x * 0.3, u1 = u0 + Math.hypot(lx1 - lx0, lz1 - lz0);
    stone.quad(p0, p1, p2, p3, n, [[u0, baseY], [u1, baseY], [u1, yTop1], [u0, yTop0]],
      [baseY - floorY - 0.2, baseY - floorY - 0.2, yTop1 - floorY, yTop0 - floorY]);
  };
  const hw = W / 2, hl = L / 2;
  const yF = eaveY, yB = roofType === 'lean' ? backY : eaveY;
  face(-hl, hw, hl, hw, f.N.clone(), yF, yF); // фасад
  face(hl, -hw, -hl, -hw, f.N.clone().negate(), yB, yB); // задняя
  face(hl, hw, hl, -hw, f.X.clone(), yF, yB); // торец +
  face(-hl, -hw, -hl, hw, f.X.clone().negate(), yB, yF); // торец −
  if (roofType === 'gable') {
    const ridge = eaveY + hw * pitch;
    for (const s of [1, -1]) {
      const n = f.X.clone().multiplyScalar(s);
      const a = f.p(s * hl, eaveY, hw), b = f.p(s * hl, eaveY, -hw), c = f.p(s * hl, ridge, 0);
      stone.quad(s > 0 ? a : b, s > 0 ? b : a, c, c.clone(), n, [[0, eaveY], [W, eaveY], [W / 2, ridge], [W / 2, ridge]]);
    }
  }
  // цоколь чуть шире стен
  const pc = f.p(0, (baseY + floorY) / 2, 0);
  stone.box(pc, f.X, UP, f.N, hl + 0.14, (floorY - baseY) / 2, hw + 0.14);
  // угловые камни, перевязка через ряд
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      let k = 0;
      for (let y = floorY + 0.15; y < Math.min(yF, yB) - 0.3; y += 0.42, k++) {
        const long = k % 2 === 0;
        const cx = sx * (hl - (long ? 0.35 : 0.2)), cz = sz * (hw - (long ? 0.2 : 0.35));
        stone.box(f.p(cx, y + 0.19, cz).addScaledVector(f.X, sx * 0.03).addScaledVector(f.N, sz * 0.03), f.X, UP, f.N,
          long ? 0.38 : 0.23, 0.18, long ? 0.23 : 0.38);
      }
    }
  }
}

// Контрфорс у фасада
function buttress(stone, f, lx, lzFace, floorY, topY, depth = 0.8) {
  const c = f.p(lx, (floorY + topY) / 2, lzFace + depth / 2);
  stone.box(c, f.X, UP, f.N, 0.35, (topY - floorY) / 2, depth / 2);
  const ax = f.d(0, 1, -1.1);
  const capC = f.p(lx, topY + 0.25, lzFace + depth / 2 - 0.1);
  stone.box(capC, f.X, ax, new V3().crossVectors(f.X, ax).normalize(), 0.38, 0.12, depth / 2 + 0.15);
  // уступ посередине
  stone.box(f.p(lx, floorY + (topY - floorY) * 0.45, lzFace + depth / 2 + 0.08), f.X, UP, f.N, 0.37, 0.1, depth / 2 + 0.08);
}

// ---------------------------------------------------------------------------
// Витражи: стрельчатое окно в каменной раме со свинцовыми переплётами
// ---------------------------------------------------------------------------
function lancetShape(w, h) {
  const R = 0.8 * w, dd = R - w / 2, spring = h - Math.sqrt(R * R - dd * dd);
  const pts = [new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0)];
  for (let k = 0; k <= 12; k++) {
    const x = w / 2 - (k / 12) * w;
    pts.push(new THREE.Vector2(x, spring + Math.sqrt(Math.max(0, R * R - (Math.abs(x) + dd) ** 2))));
  }
  return pts;
}

const glassCache = new Map();
function stainedGlassMaterial(seed) {
  if (glassCache.has(seed)) return glassCache.get(seed);
  const W = 128, H = 256;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const rnd = mulberry32(900 + seed);
  const pal = ['#1f3f9a', '#2a55c0', '#9c1b1b', '#c8322a', '#d6a32e', '#2f7d3a', '#6b2f86', '#e8dfb0'];
  g.fillStyle = '#141210';
  g.fillRect(0, 0, W, H);
  // кусочки стекла: неровная сетка
  const cols = 4, rows = 9;
  const jx = [], jy = [];
  for (let i = 0; i <= cols; i++) { jx.push([]); for (let j = 0; j <= rows; j++) jx[i].push((i / cols) * W + (i > 0 && i < cols ? (rnd() - 0.5) * 10 : 0)); }
  for (let i = 0; i <= cols; i++) { jy.push([]); for (let j = 0; j <= rows; j++) jy[i].push((j / rows) * H + (j > 0 && j < rows ? (rnd() - 0.5) * 12 : 0)); }
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const border = i === 0 || i === cols - 1;
      g.fillStyle = border ? (j % 2 ? pal[0] : pal[3]) : pal[Math.floor(rnd() * pal.length)];
      g.beginPath();
      g.moveTo(jx[i][j] + 2, jy[i][j] + 2);
      g.lineTo(jx[i + 1][j] - 2, jy[i + 1][j] + 2);
      g.lineTo(jx[i + 1][j + 1] - 2, jy[i + 1][j + 1] - 2);
      g.lineTo(jx[i][j + 1] + 2, jy[i][j + 1] - 2);
      g.fill();
    }
  }
  // медальоны со «сценами» (круги с крестом и фигурой)
  for (const cy of [H * 0.3, H * 0.62]) {
    g.fillStyle = '#141210';
    g.beginPath(); g.arc(W / 2, cy, 36, 0, Math.PI * 2); g.fill();
    g.fillStyle = seed % 2 ? '#2a55c0' : '#9c1b1b';
    g.beginPath(); g.arc(W / 2, cy, 32, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e8dfb0';
    g.fillRect(W / 2 - 4, cy - 22, 8, 44);
    g.fillRect(W / 2 - 15, cy - 10, 30, 8);
    g.fillStyle = '#d6a32e';
    g.beginPath(); g.arc(W / 2, cy - 26, 7, 0, Math.PI * 2); g.fill();
  }
  // неоднородность стекла
  for (let k = 0; k < 2500; k++) {
    g.fillStyle = `rgba(255,255,255,${rnd() * 0.08})`;
    g.fillRect(rnd() * W, rnd() * H, 2, 2);
  }
  const tex = toTexture(c, { repeat: false });
  const mat = new THREE.MeshStandardMaterial({
    map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.12, metalness: 0.05,
  });
  glassCache.set(seed, mat);
  return mat;
}

// Окно с витражом: стекло + рама-арка из камня (выдавленная форма) + откос
function lancetWindow(glassList, stone, p, n, y, w, h, seed) {
  const t = new V3().crossVectors(UP, n).normalize();
  const m = new THREE.Matrix4().makeBasis(t, UP, n).setPosition(p.x, y, p.z);
  const glass = new THREE.ShapeGeometry(new THREE.Shape(lancetShape(w, h)));
  const uv = glass.getAttribute('uv'), pos = glass.getAttribute('position');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h);
  glass.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, 0.015).premultiply(m));
  glassList.push({ geo: glass, seed });
  // рама
  const outer = new THREE.Shape(lancetShape(w + 0.34, h + 0.2).map((v) => v.clone().add(new THREE.Vector2(0, -0.1))));
  outer.holes.push(new THREE.Path(lancetShape(w, h)));
  const frame = new THREE.ExtrudeGeometry(outer, { depth: 0.14, bevelEnabled: false, curveSegments: 6 });
  const fuv = frame.getAttribute('uv');
  for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) / stone.tile, fuv.getY(i) / stone.tile);
  frame.applyMatrix4(m);
  stone.addGeometry(frame, new THREE.Matrix4());
  // подоконный слив
  stone.box(new V3(p.x, y - 0.12, p.z).addScaledVector(n, 0.12), t, UP, n, w / 2 + 0.28, 0.08, 0.14);
}

// ---------------------------------------------------------------------------
// Дым из труб: мягкие спрайты поднимаются, растут и тают
// ---------------------------------------------------------------------------
function smokeTexture() {
  const S = 128;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  const rnd = mulberry32(77);
  for (let k = 0; k < 18; k++) {
    const x = S / 2 + (rnd() - 0.5) * 40, y = S / 2 + (rnd() - 0.5) * 40, r = 18 + rnd() * 30;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  }
  return toTexture(c, { repeat: false });
}

export class Smoke {
  constructor(scene, pos, { count = 22, life = 9, rise = 1.3, size = 1.2, grow = 5, color = 0x8a8680, alpha = 0.5 } = {}) {
    this.pos = pos.clone();
    this.items = [];
    const tex = smokeTexture();
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, opacity: 0, fog: true });
      const s = new THREE.Sprite(mat);
      s.renderOrder = 5;
      s.layers.set(1); // дым не рисуется в отражениях воды
      scene.add(s);
      this.items.push({ s, off: i / count, spin: (i * 1.7) % 6.28 });
    }
    Object.assign(this, { life, rise, size, grow, alpha });
  }
  update(t) {
    for (const it of this.items) {
      const u = (t / this.life + it.off) % 1;
      const age = u * this.life;
      // ветер с юго-запада, как у флюгеров, лёгкое завихрение
      const wx = 0.55 * age + Math.sin(age * 0.9 + it.spin) * 0.3;
      const wz = -0.35 * age + Math.cos(age * 0.7 + it.spin) * 0.3;
      it.s.position.set(this.pos.x + wx, this.pos.y + this.rise * age - 0.03 * age * age, this.pos.z + wz);
      const sc = this.size + this.grow * u;
      it.s.scale.set(sc, sc, 1);
      it.s.material.opacity = this.alpha * Math.sin(Math.PI * Math.min(1, u * 1.3)) * (1 - u);
      it.s.material.rotation = it.spin + age * 0.1;
    }
  }
}

// ---------------------------------------------------------------------------
// Простые деревянные изделия
// ---------------------------------------------------------------------------
export function plankDoor(wood, metal, p, n, y0, w, h) {
  const t = new V3().crossVectors(UP, n).normalize();
  const k = Math.max(3, Math.round(w / 0.28));
  for (let i = 0; i < k; i++) {
    const c = p.clone().addScaledVector(t, -w / 2 + (i + 0.5) * (w / k)).addScaledVector(n, 0.05);
    wood.box(c.setY(y0 + h / 2), UP, t, n, h / 2, w / k / 2 - 0.006, 0.035, { grain: true });
  }
  for (const yy of [0.35, h - 0.35]) {
    const c = p.clone().addScaledVector(n, 0.1).setY(y0 + yy);
    metal.box(c, t, UP, n, w / 2 - 0.05, 0.035, 0.01);
    metal.box(c.clone().addScaledVector(t, -w / 2 + 0.12), t, UP, n, 0.14, 0.05, 0.02);
  }
}

// Деревянный навес/сарай: столбы, обвязки, дощатые стены (фасад по желанию открыт)
function timberShed(wood, f, L, W, floorY, backY, frontY, { openFront = true, sides = true } = {}) {
  const hw = W / 2, hl = L / 2;
  const bays = Math.max(2, Math.round(L / 2.6));
  const yAt = (lz) => frontY + (backY - frontY) * ((hw - lz) / W);
  // столбы
  for (let i = 0; i <= bays; i++) {
    const lx = -hl + (i / bays) * L;
    for (const lz of [hw - 0.12, -hw + 0.12]) {
      const top = yAt(lz);
      wood.box(f.p(lx, (floorY + top) / 2, lz), UP, f.X, f.N, (top - floorY) / 2, 0.11, 0.11, { grain: true });
    }
    // подкосы у фасада
    if (openFront && i > 0 && i < bays) {
      for (const sd of [-1, 1]) {
        const ax = f.d(sd * 0.7, 0.7, 0);
        const c = f.p(lx + sd * 0.35, yAt(hw) - 0.4, hw - 0.12);
        wood.box(c, ax, new V3().crossVectors(ax, f.N).normalize(), f.N, 0.5, 0.05, 0.05, { grain: true });
      }
    }
    // поперечные балки
    wood.box(f.p(lx, (yAt(hw) + yAt(-hw)) / 2 - 0.1, 0), f.d(0, (backY - frontY) / W, -1), f.X,
      new V3().crossVectors(f.d(0, (backY - frontY) / W, -1), f.X).normalize(), Math.hypot(W, backY - frontY) / 2, 0.08, 0.1, { grain: true });
  }
  // верхние обвязки
  for (const lz of [hw - 0.12, -hw + 0.12]) wood.box(f.p(0, yAt(lz) - 0.1, lz), f.X, UP, f.N, hl + 0.12, 0.1, 0.12, { grain: true });
  // дощатые стены: задняя и торцы (вертикальные доски)
  const planks = (a0, a1, lz0, lz1, topFn) => {
    const len = Math.hypot(a1 - a0, lz1 - lz0);
    const n = Math.ceil(len / 0.3);
    for (let k = 0; k < n; k++) {
      const s = (k + 0.5) / n;
      const lx = a0 + (a1 - a0) * s, lz = lz0 + (lz1 - lz0) * s;
      const top = topFn(lz) - 0.05;
      const tang = f.d(a1 - a0, 0, lz1 - lz0);
      const nrm = new V3().crossVectors(UP, tang).normalize();
      wood.box(f.p(lx, (floorY + top) / 2, lz), UP, tang, nrm, (top - floorY) / 2, len / n / 2 - 0.008, 0.025, { grain: true });
    }
  };
  planks(-hl, hl, -hw + 0.02, -hw + 0.02, yAt);
  if (sides) {
    planks(-hl + 0.02, -hl + 0.02, -hw, hw, yAt);
    planks(hl - 0.02, hl - 0.02, -hw, hw, yAt);
  }
  if (!openFront) planks(-hl, hl, hw - 0.02, hw - 0.02, yAt);
}

// Бочка: профиль вращения с обручами
function barrelGeometry() {
  const pts = [];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10;
    pts.push(new THREE.Vector2(0.29 + 0.07 * Math.sin(t * Math.PI), t * 0.95));
  }
  const g = new THREE.LatheGeometry(pts, 16);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.6, uv.getY(i) * 0.8);
  return g;
}

// Колесо телеги: обод, ступица, спицы
function wheel(wood, metal, c, axis, r) {
  const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), axis);
  const m = new THREE.Matrix4().compose(c, q, new V3(1, 1, 1));
  wood.addGeometry(new THREE.TorusGeometry(r - 0.05, 0.06, 6, 24), m);
  metal.addGeometry(new THREE.TorusGeometry(r, 0.025, 4, 28), m);
  const hub = new THREE.CylinderGeometry(0.1, 0.1, 0.3, 10);
  hub.rotateX(Math.PI / 2);
  wood.addGeometry(hub, m);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const sp = new THREE.BoxGeometry(0.04, r - 0.1, 0.05);
    sp.translate(0, (r - 0.1) / 2, 0);
    sp.rotateZ(a);
    wood.addGeometry(sp, m);
  }
}

// Телега: кузов, оглобли, два колеса
export function cart(wood, metal, terrain, x, z, yaw, rnd) {
  const X = new V3(Math.cos(yaw), 0, Math.sin(yaw)), N = new V3(-Math.sin(yaw), 0, Math.cos(yaw));
  const g = terrain.heightAt(x, z);
  const r = 0.6;
  const C = new V3(x, g + r + 0.15, z);
  // кузов
  wood.box(C.clone(), X, UP, N, 1.3, 0.04, 0.7, { grain: true });
  for (const s of [-1, 1]) {
    wood.box(C.clone().addScaledVector(N, s * 0.68).addScaledVector(UP, 0.25), X, UP, N, 1.3, 0.22, 0.03, { grain: true });
    wood.box(C.clone().addScaledVector(X, s * 1.28).addScaledVector(UP, 0.2), N, UP, X, 0.7, 0.18, 0.03, { grain: true });
    wheel(wood, metal, new V3(x, g + r, z).addScaledVector(N, s * 0.85), N, r);
  }
  // оглобли опущены на землю
  const tilt = Math.atan2(r + 0.1, 2.4);
  for (const s of [-1, 1]) {
    const ax = X.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(UP, -Math.sin(tilt)).normalize();
    const c = C.clone().addScaledVector(N, s * 0.45).addScaledVector(X, 1.3 + 1.2 * Math.cos(tilt)).addScaledVector(UP, -1.2 * Math.sin(tilt) - 0.05);
    wood.box(c, ax, UP, N, 1.3, 0.04, 0.04, { grain: true });
  }
  void rnd;
  return C;
}

// ---------------------------------------------------------------------------
export function createCourtyard(scene, terrain, walls) {
  const ctx = makeTowerContext(scene, terrain, walls);
  const { stone, wood, dark, metal, roof } = ctx;
  const photo = ctx.photoRoof;
  const shingleB = new GeoBuilder(1); // дранка (деревянная кровля) на хозяйственных постройках
  const strawB = new GeoBuilder(1); // солома, сено
  const glassList = [];
  const doors = []; // точки у дверей — к ним ведут мощёные дорожки
  const smokes = [];
  const updaters = [];
  const rnd = mulberry32(6060);
  const byId = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));

  // ======================= БОЛЬШОЙ ЗАЛ =======================
  {
    const b = byId.hall, f = new Frame(b);
    const { lo, hi } = groundRange(terrain, f, b.L, b.W);
    const floorY = hi + 0.9, baseY = lo - 0.6;
    const eaveY = floorY + 7.2, pitch = 1.35;
    stoneBox(stone, f, b.L, b.W, floorY, baseY, eaveY, 'gable', pitch);
    const ridge = gableRoof(roof, wood, f, b.L, b.W, eaveY, pitch, photo, 0.6, 0.35);
    const hw = b.W / 2;
    Object.assign(HALL, { b, f, floorY, eaveY, pitch, ridge });
    // контрфорсы и высокие витражи на фасаде
    const bayX = [-6.4, -3.2, 0, 3.2, 6.4];
    for (const lx of [-8.1, -4.8, -1.6, 1.6, 4.8, 8.1]) buttress(stone, f, Math.max(-8.1, Math.min(8.1, lx)), hw, floorY, eaveY - 1.4, 0.75);
    bayX.forEach((lx, i) => {
      if (i === 4) return; // здесь дверь
      lancetWindow(glassList, stone, f.p(lx, 0, hw), f.N, floorY + 2.3, 1.05, 3.6, i);
    });
    // вход: дверь, ступени, окно-розетка над дверью
    const dx = 6.4;
    door(stone, wood, metal, f.p(dx, 0, hw), f.N, floorY, 1.5, 3.0);
    const steps = Math.ceil((floorY - (terrain.heightAt(f.p(dx, 0, hw + 2).x, f.p(dx, 0, hw + 2).z))) / 0.2);
    for (let k = 0; k < steps; k++) {
      const y = floorY - k * 0.2;
      const p = f.p(dx, 0, hw + 0.35 + k * 0.32);
      const gy = terrain.heightAt(p.x, p.z) - 0.3;
      stone.box(new V3(p.x, (y + gy) / 2, p.z), f.X, UP, f.N, 1.2, (y - gy) / 2, 0.17 + 0.01);
    }
    doors.push(f.p(dx, 0, hw + 0.5 + steps * 0.32));
    lancetWindow(glassList, stone, f.p(dx, 0, hw), f.N, floorY + 4.3, 0.7, 1.8, 7);
    // торцы: высокие окна во фронтонах
    for (const s of [1, -1]) {
      lancetWindow(glassList, stone, f.p(s * b.L / 2, 0, 0), f.X.clone().multiplyScalar(s), floorY + 3.2, 1.3, 4.6, 10 + s);
      arrowSlit(stone, dark, f.p(s * b.L / 2, 0, 0), f.X.clone().multiplyScalar(s), eaveY + 2.4, true);
    }
    // задняя стена (к крепостной стене): узкие окна
    for (const lx of [-4.8, 0, 4.8]) arrowSlit(stone, dark, f.p(lx, 0, -hw), f.N.clone().negate(), floorY + 3.5, false);
    // фонарь-дымник на коньке: над центральным очагом
    const lc = f.p(0, ridge - 0.2, 0);
    const lh = 1.3, ls = 0.9;
    for (let k = 0; k < 4; k++) {
      const a = f.yaw + (k * Math.PI) / 2;
      const n = new V3(Math.cos(a), 0, Math.sin(a)), t = new V3(-Math.sin(a), 0, Math.cos(a));
      wood.box(lc.clone().addScaledVector(n, ls).addScaledVector(t, ls).setY(ridge + lh / 2), UP, t, n, lh / 2 + 0.2, 0.07, 0.07, { grain: true });
      for (let j = 0; j < 4; j++) {
        const sc = lc.clone().addScaledVector(n, ls).setY(ridge + 0.25 + j * 0.28);
        const ax = new V3().copy(t);
        const tilt = n.clone().multiplyScalar(-0.5).addScaledVector(UP, 1).normalize();
        wood.box(sc, ax, tilt, new V3().crossVectors(ax, tilt).normalize(), ls, 0.1, 0.015, { grain: true });
      }
      dark.box(lc.clone().addScaledVector(n, ls - 0.1).setY(ridge + 0.65), t, UP, n, ls - 0.1, 0.5, 0.01);
    }
    pyramidRoof(roof, lc, f.yaw, ls + 0.35, ridge + lh + 0.1, 1.5, photo);
    smokes.push(new Smoke(scene, lc.clone().setY(ridge + lh + 1.2), { count: 12, alpha: 0.18, size: 1.5, grow: 4, rise: 1.0 }));
  }

  // ======================= ЧАСОВНЯ С КОЛОКОЛЬНЕЙ =======================
  {
    const b = byId.chapel, f = new Frame(b);
    const { lo, hi } = groundRange(terrain, f, b.L + 4, b.W);
    const floorY = hi + 0.35, baseY = lo - 0.6;
    const eaveY = floorY + 6.2, pitch = 1.2;
    stoneBox(stone, f, b.L, b.W, floorY, baseY, eaveY, 'gable', pitch);
    gableRoof(roof, wood, f, b.L, b.W, eaveY, pitch, photo, 0.5, 0.3);
    const hw = b.W / 2;
    // южный фасад: контрфорсы и витражи
    for (const lx of [-2.2, 1.4, 5.0]) buttress(stone, f, lx, hw, floorY, eaveY - 1.2, 0.7);
    for (const lx of [-0.4, 3.2]) lancetWindow(glassList, stone, f.p(lx, 0, hw), f.N, floorY + 2.2, 0.8, 2.8, 20 + lx);
    for (const lx of [-0.4, 3.2]) lancetWindow(glassList, stone, f.p(lx, 0, -hw), f.N.clone().negate(), floorY + 2.6, 0.6, 2.2, 24 + lx);
    // восточная стена (алтарная): три витража, средний выше
    const east = f.X.clone();
    lancetWindow(glassList, stone, f.p(b.L / 2, 0, -1.2), east, floorY + 2.2, 0.75, 3.0, 30);
    lancetWindow(glassList, stone, f.p(b.L / 2, 0, 0), east, floorY + 2.0, 0.9, 3.8, 31);
    lancetWindow(glassList, stone, f.p(b.L / 2, 0, 1.2), east, floorY + 2.2, 0.75, 3.0, 32);
    // каменный крест на восточном фронтоне
    const ridgeY = eaveY + hw * pitch;
    const cp = f.p(b.L / 2 + 0.1, ridgeY + 0.6, 0);
    stone.box(cp, f.X, UP, f.N, 0.12, 0.6, 0.12);
    stone.box(cp.clone().addScaledVector(UP, 0.2), f.X, UP, f.N, 0.12, 0.12, 0.42);
    // вход в южной стене у колокольни
    door(stone, wood, metal, f.p(-4.6, 0, hw), f.N, floorY, 1.3, 2.7);
    for (let k = 0; k < 3; k++) {
      const p = f.p(-4.6, 0, hw + 0.3 + k * 0.32);
      stone.box(new V3(p.x, floorY - 0.1 - k * 0.12 - 0.3, p.z), f.X, UP, f.N, 1.1, 0.3, 0.17);
    }
    doors.push(f.p(-4.6, 0, hw + 1.8));

    // колокольня у западного торца
    const s = 1.8, twX = -b.L / 2 - s + 0.1;
    const TC = f.p(twX, 0, 0);
    const T = { shape: 'square', x: TC.x, z: TC.z, r: s, yaw: f.yaw };
    const belfryY = ridgeY + 0.6, belfryH = 2.6;
    const tg = Math.min(lo, terrain.heightAt(TC.x, TC.z)) - 0.6;
    band(stone, outline(T, 0), () => tg, () => belfryY);
    for (let k = 0; k < 4; k++) {
      const a = f.yaw + (k * Math.PI) / 2;
      const n = new V3(Math.cos(a), 0, Math.sin(a)), t = new V3(-Math.sin(a), 0, Math.cos(a));
      // угловые опоры звонницы
      for (const sd of [-1, 1]) {
        stone.box(TC.clone().addScaledVector(n, s - 0.35).addScaledVector(t, sd * (s - 0.35)).setY(belfryY + belfryH / 2), t, UP, n, 0.35, belfryH / 2, 0.35);
      }
      // перемычка-арка над проёмом (упрощённо) и парапетик
      stone.box(TC.clone().addScaledVector(n, s - 0.3).setY(belfryY + belfryH + 0.35), t, UP, n, s, 0.38, 0.3);
      stone.box(TC.clone().addScaledVector(n, s - 0.3).setY(belfryY + 0.3), t, UP, n, s, 0.3, 0.3);
      arrowSlit(stone, dark, TC.clone().addScaledVector(n, s), n, (tg + belfryY) / 2 + 1.5, k % 2 === 0);
    }
    stone.box(TC.clone().setY(belfryY + 0.02), f.X, UP, f.N, s - 0.3, 0.05, s - 0.3);
    pyramidRoof(roof, TC, f.yaw, s + 0.3, belfryY + belfryH + 0.75, (s + 0.3) * 2.2, photo);
    const crossY = belfryY + belfryH + 0.75 + (s + 0.3) * 2.2;
    metal.box(TC.clone().setY(crossY + 0.5), f.X, UP, f.N, 0.04, 0.55, 0.04);
    metal.box(TC.clone().setY(crossY + 0.72), f.X, UP, f.N, 0.04, 0.04, 0.26);
    // колокол на дубовой балке, покачивается
    wood.box(TC.clone().setY(belfryY + belfryH - 0.15), f.N, UP, f.X, s - 0.2, 0.12, 0.12, { grain: true });
    const bellPts = [];
    for (let k = 0; k <= 14; k++) {
      const t = k / 14;
      const r = 0.12 + 0.45 * Math.pow(t, 1.8) + (t > 0.9 ? (t - 0.9) * 1.2 : 0);
      bellPts.push(new THREE.Vector2(r, -t * 0.95));
    }
    const bronze = new THREE.MeshStandardMaterial({ color: 0x9a6b35, metalness: 1, roughness: 0.38 });
    const bell = new THREE.Mesh(new THREE.LatheGeometry(bellPts, 20), bronze);
    const bellPivot = new THREE.Group();
    bellPivot.position.copy(TC).setY(belfryY + belfryH - 0.28);
    bellPivot.rotation.y = f.yaw;
    bellPivot.add(bell);
    bell.castShadow = true;
    scene.add(bellPivot);
    // колокол звонит каждые 30 с: раскачивается ~8 с, потом затихает
    updaters.push((t) => {
      const c = t % 30;
      const amp = c < 8 ? 0.55 * Math.sin((c / 8) * Math.PI) : 0.03;
      bellPivot.rotation.z = Math.sin(t * 2.6) * amp;
    });
    doors.push(null);
  }

  // ======================= КУХНЯ =======================
  {
    const b = byId.kitchen, f = new Frame(b);
    const { lo, hi } = groundRange(terrain, f, b.L, b.W);
    const floorY = hi + 0.2, baseY = lo - 0.6;
    const eaveY = floorY + 4.6, pitch = 1.1;
    stoneBox(stone, f, b.L, b.W, floorY, baseY, eaveY, 'gable', pitch);
    const ridge = gableRoof(roof, wood, f, b.L, b.W, eaveY, pitch, photo);
    const hw = b.W / 2;
    door(stone, wood, metal, f.p(-1.4, 0, hw), f.N, floorY, 1.2, 2.3);
    doors.push(f.p(-1.4, 0, hw + 1.5));
    windowWithShutters(stone, wood, dark, metal, f.p(1.8, 0, hw), f.N, floorY + 2.0, 0.7, 0.9, 1.9);
    // большая труба на торце: очаг внутри на всю ширину
    const cw = 2.2, cd = 1.1;
    const chimTop = ridge + 2.2;
    const cc = f.p(b.L / 2 + cd / 2 - 0.05, 0, -0.6);
    stone.box(cc.clone().setY((baseY + eaveY) / 2), f.X, UP, f.N, cd / 2, (eaveY - baseY) / 2, cw / 2);
    stone.box(cc.clone().setY((eaveY + chimTop) / 2).addScaledVector(f.X, -0.35), f.X, UP, f.N, 0.55, (chimTop - eaveY) / 2, 0.75);
    const ax = f.d(-1, 1, 0);
    stone.box(cc.clone().setY(eaveY + 0.1).addScaledVector(f.X, 0.2), f.N, ax, new V3().crossVectors(f.N, ax).normalize(), cw / 2, 0.5, 0.12);
    const capP = cc.clone().setY(chimTop + 0.1).addScaledVector(f.X, -0.35);
    stone.box(capP, f.X, UP, f.N, 0.7, 0.12, 0.9);
    dark.box(capP.clone().setY(chimTop + 0.225), f.X, UP, f.N, 0.35, 0.01, 0.5);
    smokes.push(new Smoke(scene, capP.clone().setY(chimTop + 0.6), { count: 24, alpha: 0.45, size: 1.0, grow: 5.5, rise: 1.4 }));
    // поленница у стены
    const logGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.9, 7);
    logGeo.rotateX(Math.PI / 2);
    for (let row = 0; row < 5; row++) {
      for (let k = 0; k < 12 - row; k++) {
        const p = f.p(-b.L / 2 + 0.6 + k * 0.23 + row * 0.11, 0, hw + 0.6);
        const g = terrain.heightAt(p.x, p.z);
        const m = new THREE.Matrix4().makeBasis(f.X, UP, f.N).setPosition(p.x, g + 0.11 + row * 0.2, p.z);
        wood.addGeometry(logGeo, m);
      }
    }
  }

  // ======================= КАЗАРМЫ =======================
  {
    const b = byId.barracks, f = new Frame(b);
    const { lo, hi } = groundRange(terrain, f, b.L, b.W);
    const floorY = hi + 0.2, baseY = lo - 0.6;
    const frontY = floorY + 4.2, backY = floorY + 6.4;
    stoneBox(stone, f, b.L, b.W, floorY, baseY, frontY, 'lean', 0, backY);
    leanRoof(roof, wood, f, b.L, b.W, backY, frontY, photo);
    const hw = b.W / 2;
    for (const lx of [-3.6, 3.6]) {
      door(stone, wood, metal, f.p(lx, 0, hw), f.N, floorY, 1.1, 2.2);
      doors.push(f.p(lx, 0, hw + 1.4));
    }
    for (const lx of [-5.2, -1.2, 1.2, 5.2]) windowWithShutters(stone, wood, dark, metal, f.p(lx, 0, hw), f.N, floorY + 2.4, 0.55, 0.8, 1.8);
    // стойки с копьями перед казармой
    for (const lx of [-1.8, 1.8]) spearRack(wood, metal, terrain, f.p(lx, 0, hw + 1.3), f.X, rnd);
  }

  // ======================= СКЛАД =======================
  {
    const b = byId.store, f = new Frame(b);
    const { lo, hi } = groundRange(terrain, f, b.L, b.W);
    const floorY = hi + 0.15, baseY = lo - 0.4;
    stone.box(f.p(0, (baseY + floorY) / 2, 0), f.X, UP, f.N, b.L / 2 + 0.1, (floorY - baseY) / 2, b.W / 2 + 0.1);
    timberShed(wood, f, b.L, b.W, floorY, floorY + 5.2, floorY + 3.6, { openFront: false });
    leanRoof(shingleB, wood, f, b.L, b.W, floorY + 5.2, floorY + 3.6, false);
    // двустворчатая дверь
    for (const sd of [-1, 1]) plankDoor(wood, metal, f.p(sd * 0.75, 0, b.W / 2), f.N, floorY, 1.45, 2.6);
    doors.push(f.p(0, 0, b.W / 2 + 1.6));
  }

  // ======================= КУЗНИЦА =======================
  {
    const b = byId.forge, f = new Frame(b);
    const { lo, hi } = groundRange(terrain, f, b.L, b.W);
    const floorY = hi + 0.1, baseY = lo - 0.4;
    stone.box(f.p(0, (baseY + floorY) / 2, 0), f.X, UP, f.N, b.L / 2 + 0.1, (floorY - baseY) / 2, b.W / 2 + 0.1);
    const backY = floorY + 4.6, frontY = floorY + 3.3;
    timberShed(wood, f, b.L, b.W, floorY, backY, frontY, { openFront: true });
    leanRoof(shingleB, wood, f, b.L, b.W, backY, frontY, false);
    // горн: каменный стол с углями, над ним вытяжной колпак и труба
    const hz = -b.W / 2 + 0.9;
    const hp = f.p(-1.2, 0, hz);
    stone.box(hp.clone().setY(floorY + 0.45), f.X, UP, f.N, 1.0, 0.45, 0.7);
    const coalMat = new THREE.MeshStandardMaterial({ color: 0x1a0d06, emissive: 0xff5a14, emissiveIntensity: 2.2, roughness: 0.9 });
    const coals = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.6), coalMat);
    coals.position.copy(hp).setY(floorY + 0.93);
    coals.rotation.y = -f.yaw;
    scene.add(coals);
    const hoodAx = f.d(0, 1, 0.9);
    stone.box(hp.clone().setY(floorY + 2.2).addScaledVector(f.N, 0.1), f.X, hoodAx, new V3().crossVectors(f.X, hoodAx).normalize(), 1.0, 0.6, 0.1);
    stone.box(hp.clone().setY((floorY + 2.6 + backY + 1.8) / 2).addScaledVector(f.N, -0.3), f.X, UP, f.N, 0.45, (backY + 1.8 - floorY - 2.6) / 2, 0.4);
    smokes.push(new Smoke(scene, hp.clone().setY(backY + 2.2).addScaledVector(f.N, -0.3), { count: 14, alpha: 0.35, size: 0.6, grow: 3, rise: 1.3, color: 0x6e6a66 }));
    // свет от горна (мерцает)
    // точечный свет заставляет каждый материал сцены считать ещё один источник —
    // на слабом компьютере горн только светится сам, без света вокруг
    const light = new THREE.PointLight(0xff7a2a, 12, 9, 2);
    light.position.copy(hp).setY(floorY + 1.4).addScaledVector(f.N, 0.8);
    if (Q.pointLights) scene.add(light);
    updaters.push((t) => {
      const fl = 0.8 + 0.2 * Math.sin(t * 11.3) * Math.sin(t * 7.1 + 1.3);
      light.intensity = 12 * fl;
      coalMat.emissiveIntensity = 1.8 + 0.8 * fl;
    });
    // меха (клин из досок с кожей)
    const bp = f.p(0.25, 0, hz);
    wood.box(bp.clone().setY(floorY + 0.95), f.X, f.d(0, 1, 0.15), f.N, 0.6, 0.03, 0.3, { grain: true });
    wood.box(bp.clone().setY(floorY + 0.7), f.X, UP, f.N, 0.6, 0.03, 0.3, { grain: true });
    dark.box(bp.clone().setY(floorY + 0.82), f.X, UP, f.N, 0.5, 0.1, 0.27);
    // наковальня на пне
    const ap = f.p(-1.0, 0, 0.9);
    const stump = new THREE.CylinderGeometry(0.33, 0.38, 0.6, 12);
    wood.addGeometry(stump, new THREE.Matrix4().makeTranslation(ap.x, floorY + 0.3, ap.z));
    const iron = metal;
    iron.box(ap.clone().setY(floorY + 0.68), f.X, UP, f.N, 0.18, 0.08, 0.13);
    iron.box(ap.clone().setY(floorY + 0.84), f.X, UP, f.N, 0.3, 0.08, 0.12);
    const horn = new THREE.ConeGeometry(0.08, 0.35, 8);
    horn.rotateZ(Math.PI / 2);
    iron.addGeometry(horn, new THREE.Matrix4().makeBasis(f.X, UP, f.N).setPosition(...ap.clone().addScaledVector(f.X, -0.47).setY(floorY + 0.86).toArray()));
    iron.box(ap.clone().setY(floorY + 0.95).addScaledVector(f.X, 0.12), f.X, UP, f.N, 0.12, 0.02, 0.03); // молот
    wood.box(ap.clone().setY(floorY + 0.95).addScaledVector(f.X, 0.12).addScaledVector(f.N, 0.2), f.N, UP, f.X, 0.2, 0.02, 0.02, { grain: true });
    // инструменты на задней стене
    for (let k = 0; k < 5; k++) {
      const tp = f.p(1.3 + k * 0.3, 0, -b.W / 2 + 0.2).setY(floorY + 2.0);
      iron.box(tp, UP, f.X, f.N, 0.35, 0.02, 0.015);
    }
    doors.push(f.p(0, 0, b.W / 2 + 1.5));
  }

  // ======================= КОНЮШНЯ =======================
  {
    const b = byId.stable, f = new Frame(b);
    const { lo, hi } = groundRange(terrain, f, b.L, b.W);
    const floorY = hi + 0.1, baseY = lo - 0.4;
    stone.box(f.p(0, (baseY + floorY) / 2, 0), f.X, UP, f.N, b.L / 2 + 0.1, (floorY - baseY) / 2, b.W / 2 + 0.1);
    const backY = floorY + 4.4, frontY = floorY + 3.0;
    timberShed(wood, f, b.L, b.W, floorY, backY, frontY, { openFront: true });
    leanRoof(shingleB, wood, f, b.L, b.W, backY, frontY, false);
    // солома на полу
    strawB.box(f.p(0, floorY + 0.03, 0), f.X, UP, f.N, b.L / 2 - 0.15, 0.03, b.W / 2 - 0.15);
    // стойла: перегородки из досок, ясли с сеном у задней стены
    const stalls = 4;
    for (let k = 0; k <= stalls; k++) {
      const lx = -b.L / 2 + (k / stalls) * b.L;
      if (k > 0 && k < stalls) {
        for (let j = 0; j < 4; j++) {
          wood.box(f.p(lx, floorY + 0.3 + j * 0.32, -0.6), f.N, UP, f.X, (b.W - 1.8) / 2, 0.13, 0.03, { grain: true });
        }
        wood.box(f.p(lx, floorY + 0.85, b.W / 2 - 1.55), UP, f.N, f.X, 0.85, 0.07, 0.07, { grain: true });
      }
      if (k < stalls) {
        const cx = lx + b.L / stalls / 2;
        // ясли
        wood.box(f.p(cx, floorY + 1.1, -b.W / 2 + 0.45), f.X, UP, f.N, b.L / stalls / 2 - 0.2, 0.05, 0.3, { grain: true });
        wood.box(f.p(cx, floorY + 1.3, -b.W / 2 + 0.72), f.X, UP, f.N, b.L / stalls / 2 - 0.2, 0.22, 0.03, { grain: true });
        strawB.box(f.p(cx, floorY + 1.3, -b.W / 2 + 0.45), f.X, UP, f.N, b.L / stalls / 2 - 0.3, 0.18, 0.25);
      }
    }
    // поилка у фасада
    const tp = f.p(-b.L / 2 + 1.5, 0, b.W / 2 + 0.9);
    const tg = terrain.heightAt(tp.x, tp.z);
    wood.box(tp.clone().setY(tg + 0.3), f.X, UP, f.N, 1.0, 0.3, 0.3, { grain: true });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.5), new THREE.MeshStandardMaterial({ color: 0x1c2a28, roughness: 0.05 }));
    water.rotation.set(-Math.PI / 2, 0, -f.yaw);
    water.position.copy(tp).setY(tg + 0.61);
    scene.add(water);
    doors.push(f.p(0, 0, b.W / 2 + 1.6));
    // стог сена и телега с сеном рядом
    haystack(strawB, terrain, f.p(b.L / 2 - 0.5, 0, b.W / 2 + 3.2), 1.6, rnd);
    const cc = cart(wood, metal, terrain, ...f.p(b.L / 2 - 4.5, 0, b.W / 2 + 3.6).toArray().filter((_, i) => i !== 1), f.yaw + 0.3, rnd);
    haystack(strawB, terrain, cc.clone().setY(cc.y + 0.15), 0.9, rnd, true);
  }

  // ======================= АМБАР (на каменных опорах) =======================
  {
    const b = byId.granary, f = new Frame(b);
    const { lo, hi } = groundRange(terrain, f, b.L, b.W);
    const floorY = hi + 0.8;
    // «грибовидные» каменные опоры защищают зерно от мышей
    for (const lx of [-b.L / 2 + 0.4, 0, b.L / 2 - 0.4]) {
      for (const lz of [-b.W / 2 + 0.4, b.W / 2 - 0.4]) {
        const p = f.p(lx, 0, lz);
        const g = terrain.heightAt(p.x, p.z) - 0.2;
        stone.box(p.clone().setY((g + floorY - 0.15) / 2), f.X, UP, f.N, 0.2, (floorY - 0.15 - g) / 2, 0.2);
        stone.box(p.clone().setY(floorY - 0.1), f.X, UP, f.N, 0.38, 0.06, 0.38);
      }
    }
    wood.box(f.p(0, floorY + 0.05, 0), f.X, UP, f.N, b.L / 2, 0.08, b.W / 2, { grain: true });
    timberShed(wood, f, b.L, b.W, floorY + 0.1, floorY + 4.6, floorY + 3.3, { openFront: false });
    leanRoof(shingleB, wood, f, b.L, b.W, floorY + 4.6, floorY + 3.3, false);
    plankDoor(wood, metal, f.p(0, 0, b.W / 2), f.N, floorY + 0.12, 1.3, 2.2);
    // деревянные ступени
    for (let k = 0; k < 4; k++) wood.box(f.p(0, floorY - 0.1 - k * 0.22, b.W / 2 + 0.3 + k * 0.28), f.X, UP, f.N, 0.7, 0.04, 0.15, { grain: true });
    doors.push(f.p(0, 0, b.W / 2 + 1.8));
  }

  // ======================= КОЛОДЕЦ =======================
  {
    const W0 = WELL;
    const C = new V3(W0.x, 0, W0.z);
    const g = terrain.heightAt(W0.x, W0.z);
    const T = { shape: 'round', x: W0.x, z: W0.z, r: W0.r };
    const top = g + 0.85;
    band(stone, outline(T, 0, 24), () => g - 0.4, () => top);
    band(stone, outline(T, -0.35, 24), () => top - 1.4, () => top, { facing: -1 });
    ring(stone, outline(T, -0.35, 24), outline(T, 0.06, 24), top, UP);
    const water = new THREE.Mesh(new THREE.CircleGeometry(W0.r - 0.34, 24), new THREE.MeshStandardMaterial({ color: 0x0b1210, roughness: 0.03, metalness: 0.2 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(W0.x, top - 1.3, W0.z);
    scene.add(water);
    // стойки, ворот с верёвкой и рукоятью
    const X = new V3(1, 0, 0), Z = new V3(0, 0, 1);
    for (const sd of [-1, 1]) {
      wood.box(C.clone().addScaledVector(X, sd * (W0.r + 0.05)).setY(top + 0.95), UP, X, Z, 1.25, 0.09, 0.09, { grain: true });
    }
    const drumM = new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(W0.x, top + 1.05, W0.z);
    wood.addGeometry(new THREE.CylinderGeometry(0.13, 0.13, W0.r * 2 + 0.2, 10), drumM);
    dark.addGeometry(new THREE.CylinderGeometry(0.16, 0.16, 0.7, 10), drumM); // намотанная верёвка
    metal.box(C.clone().addScaledVector(X, W0.r + 0.25).setY(top + 1.05), X, UP, Z, 0.1, 0.02, 0.02);
    metal.box(C.clone().addScaledVector(X, W0.r + 0.35).setY(top + 0.85), UP, X, Z, 0.22, 0.02, 0.02);
    wood.box(C.clone().addScaledVector(X, W0.r + 0.45).setY(top + 0.64), X, UP, Z, 0.12, 0.03, 0.03, { grain: true });
    // верёвка и ведро на краю
    const bucketP = C.clone().addScaledVector(Z, W0.r - 0.12).setY(top + 0.2);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 5), ctx.darkMat);
    rope.position.copy(C).setY(top + 0.62).addScaledVector(Z, 0.55);
    rope.rotation.x = 0.55;
    scene.add(rope);
    const bucket = new THREE.CylinderGeometry(0.2, 0.16, 0.34, 12, 1, true);
    wood.addGeometry(bucket, new THREE.Matrix4().makeTranslation(bucketP.x, bucketP.y, bucketP.z));
    for (const yy of [-0.1, 0.1]) metal.addGeometry(new THREE.TorusGeometry(0.19 - yy * 0.1, 0.012, 4, 16), new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(bucketP.x, bucketP.y + yy, bucketP.z));
    // двускатная крыша над колодцем
    const fw = new Frame({ x: W0.x, z: W0.z, ax: 1, az: 0, nx: 0, nz: 1 });
    gableRoof(shingleB, wood, fw, W0.r * 2 + 0.3, 1.5, top + 2.1, 0.9, false, 0.3, 0.2);
    wood.box(C.clone().setY(top + 2.1), X, UP, Z, W0.r + 0.3, 0.07, 0.07, { grain: true });
  }

  // ======================= МЕЛОЧИ ДВОРА =======================
  // бочки и ящики у склада, кухни, амбара и кузницы
  const barrels = [], crates = [];
  const near = (id, lx, lz) => new Frame(byId[id]).p(lx, 0, lz);
  const pile = (id, lx0, lz0, nb, nc) => {
    const f = new Frame(byId[id]);
    for (let k = 0; k < nb; k++) barrels.push(f.p(lx0 + (k % 3) * 0.75 + (rnd() - 0.5) * 0.1, 0, lz0 + Math.floor(k / 3) * 0.75));
    for (let k = 0; k < nc; k++) crates.push({ p: f.p(lx0 - 1.6 - (k % 2) * 0.85, 0, lz0 + (k % 3) * 0.2), stack: k >= 4 ? 1 : 0, yaw: f.yaw + (rnd() - 0.5) * 0.4 });
  };
  pile('store', -2.6, byId.store.W / 2 + 0.9, 5, 6);
  pile('kitchen', 2.2, byId.kitchen.W / 2 + 1.0, 3, 2);
  pile('granary', 3.0, byId.granary.W / 2 + 0.9, 4, 3);
  barrels.push(near('forge', 1.6, 0.6));
  barrels.push(near('stable', -byId.stable.L / 2 + 3.2, byId.stable.W / 2 + 0.9));
  buildBarrels(scene, terrain, barrels, walls.woodMaterial, ctx.ironMat, rnd);
  buildCrates(scene, terrain, crates, walls.woodMaterial);
  // вторая телега у склада
  cart(wood, metal, terrain, ...near('store', 3.5, byId.store.W / 2 + 3.4).toArray().filter((_, i) => i !== 1), byId.store.ax ? Math.atan2(byId.store.az, byId.store.ax) - 0.5 : 0, rnd);
  // стрельбище: мишени у восточной части двора, к ним ведёт утоптанная полоса
  const targets = [new V3(33, 0, -17), new V3(31, 0, -13.2), new V3(29, 0, -9.4)];
  const shootFrom = new V3(14, 0, -6);
  for (const tp of targets) archeryTarget(scene, strawB, wood, terrain, tp, shootFrom);
  // стойка с копьями у стрельбища
  spearRack(wood, metal, terrain, new V3(15, 0, -9), new V3(0.5, 0, -0.86).normalize(), rnd);

  // ======================= МОЩЕНИЕ ДВОРА =======================
  const gateIn = new V3(GATEHOUSE.x, 0, GATE_PASSAGE.rampEndZ + 1);
  const keepN = new V3(Math.cos(KEEP.yaw), 0, Math.sin(KEEP.yaw)), keepT = new V3(-Math.sin(KEEP.yaw), 0, Math.cos(KEEP.yaw));
  const keepStair = new V3(KEEP.x, 0, KEEP.z).addScaledVector(keepN, KEEP.r + 2.6).addScaledVector(keepT, 3.4);
  const well = new V3(WELL.x, 0, WELL.z);
  const paths = [[gateIn, well]];
  for (const d of doors) if (d) paths.push([well, d]);
  paths.push([well, keepStair]);
  const pave = buildPaving(scene, terrain, paths, [{ c: well, r: 6.5 }, { c: gateIn, r: 4.5 }]);

  // ======================= СБОРКА =======================
  const vanes = finishTowerContext(ctx, 'courtyard');
  const shingleMat = pbrMaterial('shingle');
  const strawMat = strawMaterial();
  for (const [bld, mat, name] of [[shingleB, shingleMat, 'shingles'], [strawB, strawMat, 'straw']]) {
    const m = new THREE.Mesh(bld.build(), mat);
    m.castShadow = m.receiveShadow = true;
    m.name = name;
    scene.add(m);
  }
  // витражи: по материалу на рисунок
  const bySeed = new Map();
  for (const { geo, seed } of glassList) {
    const k = Math.abs(Math.round(seed)) % 6;
    if (!bySeed.has(k)) bySeed.set(k, []);
    bySeed.get(k).push(geo);
  }
  for (const [k, geos] of bySeed) {
    const m = new THREE.Mesh(mergeSimple(geos), stainedGlassMaterial(k));
    m.receiveShadow = true;
    m.name = 'stained-glass';
    scene.add(m);
  }

  return {
    paveMask: pave.mask,
    update(t) {
      vanes(t);
      for (const s of smokes) s.update(t);
      for (const u of updaters) u(t);
    },
  };
}

// ---------------------------------------------------------------------------
function spearRack(wood, metal, terrain, p, along, rnd) {
  const g = terrain.heightAt(p.x, p.z);
  const X = along.clone().normalize(), Z = new V3(-X.z, 0, X.x);
  for (const sd of [-1, 1]) wood.box(p.clone().addScaledVector(X, sd * 0.9).setY(g + 0.65), UP, X, Z, 0.65, 0.06, 0.06, { grain: true });
  wood.box(p.clone().setY(g + 1.25), X, UP, Z, 1.0, 0.05, 0.05, { grain: true });
  for (let k = 0; k < 5; k++) {
    // копья приставлены к верхней перекладине
    const b = p.clone().addScaledVector(X, -0.7 + k * 0.35).addScaledVector(Z, -0.5).setY(g + 0.02);
    const tilt = UP.clone().addScaledVector(Z, 0.42).addScaledVector(X, (k - 2) * 0.06).normalize();
    const len = 2.4 + rnd() * 0.3;
    const c = b.clone().addScaledVector(tilt, len / 2);
    wood.box(c, tilt, X, new V3().crossVectors(tilt, X).normalize(), len / 2, 0.03, 0.03, { grain: true });
    const tip = new THREE.ConeGeometry(0.06, 0.4, 4);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, tilt);
    metal.addGeometry(tip, new THREE.Matrix4().compose(b.clone().addScaledVector(tilt, len + 0.12), q, new V3(1, 1, 1)));
  }
}

export function haystack(strawB, terrain, p, s, rnd, noGround = false) {
  const g = new THREE.IcosahedronGeometry(1, 4);
  const n = createNoise2D(Math.floor(rnd() * 1000));
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 1 + 0.12 * n(x * 2 + y, z * 2);
    pos.setXYZ(i, x * k * 1.3, Math.max(-0.15, y) * k * 0.75, z * k);
  }
  g.computeVertexNormals();
  const gy = noGround ? p.y : terrain.heightAt(p.x, p.z);
  strawB.addGeometry(g, new THREE.Matrix4().compose(new V3(p.x, gy + 0.05, p.z), new THREE.Quaternion().setFromAxisAngle(UP, rnd() * 6), new V3(s, s, s)));
}

export function strawMaterial() {
  const S = 256;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  g.fillStyle = '#a88a45';
  g.fillRect(0, 0, S, S);
  const rnd = mulberry32(31);
  for (let k = 0; k < 4000; k++) {
    const l = 120 + rnd() * 110;
    g.strokeStyle = `rgba(${l},${l * 0.82 | 0},${l * 0.42 | 0},0.7)`;
    g.lineWidth = 1;
    const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14); g.stroke();
  }
  const tex = toTexture(c);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
  // проекция сверху и сбоку, без UV
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSW;')
      .replace('#include <map_fragment>', 'diffuseColor.rgb *= texture2D(map, vSW.xz * 0.9 + vSW.y * 0.4).rgb;');
  };
  return mat;
}

function archeryTarget(scene, strawB, wood, terrain, p, from) {
  const g = terrain.heightAt(p.x, p.z);
  const dir = from.clone().sub(p).setY(0).normalize();
  const side = new V3(-dir.z, 0, dir.x);
  const C = p.clone().setY(g + 1.25);
  // тренога
  for (const [sx, sz] of [[-0.55, 0.25], [0.55, 0.25], [0, -0.7]]) {
    const foot = p.clone().addScaledVector(side, sx).addScaledVector(dir, sz).setY(g);
    const ax = C.clone().sub(foot);
    const len = ax.length();
    ax.normalize();
    wood.box(foot.clone().lerp(C, 0.5), ax, side, new V3().crossVectors(ax, side).normalize(), len / 2, 0.04, 0.04, { grain: true });
  }
  // соломенный щит (цилиндр) + раскрашенная мишень
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
  const m = new THREE.Matrix4().compose(C, q, new V3(1, 1, 1));
  strawB.addGeometry(new THREE.CylinderGeometry(0.62, 0.62, 0.3, 20), m);
  const tex = targetTexture();
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.6, 32), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  face.position.copy(C).addScaledVector(dir, 0.155);
  face.lookAt(C.clone().addScaledVector(dir, 2));
  face.receiveShadow = true;
  scene.add(face);
  // пара стрел в мишени
  const rnd = mulberry32(Math.floor(p.x * 13 + p.z * 7));
  for (let k = 0; k < 3; k++) {
    const hit = C.clone().addScaledVector(side, (rnd() - 0.5) * 0.6).addScaledVector(UP, (rnd() - 0.5) * 0.6).addScaledVector(dir, 0.15);
    const ad = dir.clone().addScaledVector(UP, 0.05).normalize();
    wood.box(hit.clone().addScaledVector(ad, 0.35), ad, side, new V3().crossVectors(ad, side).normalize(), 0.35, 0.008, 0.008, { grain: true });
  }
}

let targetTex = null;
function targetTexture() {
  if (targetTex) return targetTex;
  const S = 256;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  g.fillStyle = '#b89a55';
  g.fillRect(0, 0, S, S);
  const cols = ['#e9e1c8', '#2a2622', '#2d5aa0', '#b22a22', '#e0b83a'];
  cols.forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 8 - i * 24, 0, Math.PI * 2); g.fill();
  });
  const rnd = mulberry32(3);
  for (let k = 0; k < 1500; k++) {
    g.fillStyle = `rgba(90,70,30,${rnd() * 0.25})`;
    g.fillRect(rnd() * S, rnd() * S, 3, 1);
  }
  targetTex = toTexture(c, { repeat: false });
  return targetTex;
}

export function buildBarrels(scene, terrain, list, woodMat, ironMat, rnd) {
  const geo = barrelGeometry();
  const hoops = [];
  for (const y of [0.12, 0.35, 0.6, 0.83]) {
    const r = 0.29 + 0.07 * Math.sin((y / 0.95) * Math.PI) + 0.008;
    const t = new THREE.TorusGeometry(r, 0.012, 4, 20);
    t.rotateX(Math.PI / 2);
    t.translate(0, y, 0);
    hoops.push(t);
  }
  const lid = new THREE.CircleGeometry(0.3, 16);
  lid.rotateX(-Math.PI / 2);
  lid.translate(0, 0.94, 0);
  const im = new THREE.InstancedMesh(geo, woodMat, list.length);
  const imLid = new THREE.InstancedMesh(lid, woodMat, list.length);
  const hoopGeo = mergeSimple(hoops);
  const imH = new THREE.InstancedMesh(hoopGeo, ironMat, list.length);
  const m = new THREE.Matrix4();
  list.forEach((p, i) => {
    const g = terrain.heightAt(p.x, p.z);
    m.compose(new V3(p.x, g - 0.02, p.z), new THREE.Quaternion().setFromAxisAngle(UP, rnd() * 6), new V3(1, 1, 1));
    im.setMatrixAt(i, m); imH.setMatrixAt(i, m); imLid.setMatrixAt(i, m);
  });
  for (const x of [im, imH, imLid]) { x.castShadow = x.receiveShadow = true; scene.add(x); }
}

export function buildCrates(scene, terrain, list, woodMat) {
  const geo = new THREE.BoxGeometry(0.75, 0.62, 0.62);
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.62, uv.getY(i) * 0.55);
  const im = new THREE.InstancedMesh(geo, woodMat, list.length);
  const m = new THREE.Matrix4();
  list.forEach((c, i) => {
    const g = terrain.heightAt(c.p.x, c.p.z);
    m.compose(new V3(c.p.x, g + 0.31 + c.stack * 0.62, c.p.z), new THREE.Quaternion().setFromAxisAngle(UP, -c.yaw), new V3(1, 1, 1));
    im.setMatrixAt(i, m);
  });
  im.castShadow = im.receiveShadow = true;
  scene.add(im);
}

export function mergeSimple(geos) {
  const pos = [], nrm = [], uv = [], idx = [];
  let base = 0;
  for (const g of geos) {
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), u = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i)); uv.push(u.getX(i), u.getY(i)); }
    for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

// ---------------------------------------------------------------------------
// Мощение: сетка, накинутая на рельеф, с «рваными» краями (альфа по вершинам)
// ---------------------------------------------------------------------------
function buildPaving(scene, terrain, paths, plazas) {
  const nEdge = createNoise2D(4545);
  const segDist = (x, z, a, b) => {
    const ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
    return Math.hypot(x - a.x - ex * t, z - a.z - ez * t);
  };
  const mask = (x, z) => {
    let d = Infinity;
    for (const [a, b] of paths) d = Math.min(d, segDist(x, z, a, b) - 1.7);
    for (const p of plazas) d = Math.min(d, Math.hypot(x - p.c.x, z - p.c.z) - p.r);
    d += nEdge(x * 0.35, z * 0.35) * 0.9 + nEdge(x * 1.3, z * 1.3) * 0.3;
    return Math.max(0, Math.min(1, -d / 1.2 + 0.5));
  };
  const x0 = -52, x1 = 58, z0 = -40, z1 = 34, step = 0.55;
  const nx = Math.ceil((x1 - x0) / step) + 1, nz = Math.ceil((z1 - z0) / step) + 1;
  const pos = [], uv = [], col = [], idx = [];
  const id = new Int32Array(nx * nz).fill(-1);
  const alpha = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * step, z = z0 + j * step;
    let a = mask(x, z);
    const bIn = insideBuilding(x, z, -0.2);
    if (insideTower(x, z, 0.3) || (bIn && bIn !== WELL)) a = 0;
    if (Math.hypot(x - WELL.x, z - WELL.z) < WELL.r - 0.1) a = 0;
    alpha[j * nx + i] = a;
  }
  const vert = (i, j) => {
    const k = j * nx + i;
    if (id[k] >= 0) return id[k];
    const x = x0 + i * step, z = z0 + j * step;
    pos.push(x, terrain.heightAt(x, z) + 0.035, z);
    uv.push(x / 2.4, z / 2.4);
    col.push(1, 1, 1, alpha[k]);
    id[k] = pos.length / 3 - 1;
    return id[k];
  };
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = alpha[j * nx + i], b = alpha[j * nx + i + 1], c = alpha[(j + 1) * nx + i], d = alpha[(j + 1) * nx + i + 1];
    if (a + b + c + d === 0) continue;
    const v00 = vert(i, j), v10 = vert(i + 1, j), v01 = vert(i, j + 1), v11 = vert(i + 1, j + 1);
    idx.push(v00, v01, v10, v10, v01, v11);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = pbrMaterial('cobble', {
    vertexColors: true, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  // вершинный цвет используем только как прозрачность; камни «выпадают» по краям
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <color_fragment>',
      `#if defined( USE_COLOR_ALPHA )
        float pa = vColor.a;
        float stoneH = texture2D(aoMap, vAoMapUv).r;
        diffuseColor.a *= smoothstep(0.25, 0.75, pa + (stoneH - 0.6) * 0.8);
      #endif`
    );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.name = 'paving';
  scene.add(mesh);
  return { mask };
}
