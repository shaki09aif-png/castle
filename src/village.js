// Этап 7: деревня у подножия холма. Деревянный мост через реку, крестьянские
// дома (фахверк с обмазкой, соломенные крыши), огороды за плетнями, водяная
// мельница с вращающимся колесом, поля узкими полосами (средневековая
// трёхпольная система: пашня, всходы, спелая пшеница, пар).
import * as THREE from 'three';
import { WINDOWS } from './towers.js';
import { GeoBuilder } from './walls.js';
import { riverInfo } from './terrain.js';
import { riverZ, RIVER } from './layout.js';
import { pbrMaterial, materialTextures, macroNoiseTexture } from './textures.js';
import { Frame, Smoke, haystack, strawMaterial, plankDoor, buildBarrels, cart } from './courtyard.js';
import { mulberry32, createNoise2D } from './noise.js';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);

// ---------------------------------------------------------------------------
// Мост: деревянный настил на рядах свай (опорах), перила, каменные устои
// ---------------------------------------------------------------------------
function buildBridge(wood, stone, metal, terrain, road) {
  const bp = road.filter((q) => q.bridge);
  const a = new V3(bp[0].x, 0, bp[0].z), b = new V3(bp[bp.length - 1].x, 0, bp[bp.length - 1].z);
  const D = b.clone().sub(a);
  const L = D.length();
  D.normalize();
  const N = new V3(-D.z, 0, D.x);
  const deck = bp[0].h + 0.05;
  const hw = 2.2;
  const at = (s, o = 0) => a.clone().addScaledVector(D, s).addScaledVector(N, o);
  // настил: поперечные доски, чуть разной высоты
  const rnd = mulberry32(88);
  for (let s = -1.5; s < L + 1.5; s += 0.3) {
    wood.box(at(s).setY(deck - 0.05 + (rnd() - 0.5) * 0.015), N, UP, D, hw, 0.05, 0.14, { grain: true });
  }
  // продольные балки-прогоны
  for (const o of [-1.6, -0.55, 0.55, 1.6]) wood.box(at(L / 2, o).setY(deck - 0.22), D, UP, N, L / 2 + 1.5, 0.12, 0.12, { grain: true });
  // опоры: по три сваи, насадка, подкосы
  const bents = Math.max(2, Math.round(L / 4.5));
  for (let k = 0; k <= bents; k++) {
    const s = (k / bents) * L;
    let bottom = Infinity;
    for (const o of [-1.7, 0, 1.7]) bottom = Math.min(bottom, terrain.heightAt(at(s, o).x, at(s, o).z) - 0.6);
    for (const o of [-1.7, 0, 1.7]) {
      const p = at(s, o);
      const g = Math.min(bottom, terrain.heightAt(p.x, p.z) - 0.5);
      const pile = new THREE.CylinderGeometry(0.16, 0.18, deck - 0.34 - g, 8);
      wood.addGeometry(pile, new THREE.Matrix4().makeTranslation(p.x, (deck - 0.34 + g) / 2, p.z));
    }
    wood.box(at(s).setY(deck - 0.4), N, UP, D, hw + 0.2, 0.1, 0.14, { grain: true });
    const ax = N.clone().multiplyScalar(1.7).addScaledVector(UP, -(deck - 0.4 - RIVER.waterLevel) * 0.8).normalize();
    wood.box(at(s, 0.85).setY(deck - 0.4 - (deck - 0.4 - RIVER.waterLevel) * 0.4), ax, D, new V3().crossVectors(ax, D).normalize(),
      Math.hypot(1.7, (deck - 0.4 - RIVER.waterLevel) * 0.8) / 2, 0.06, 0.06, { grain: true });
  }
  // перила
  for (const o of [-hw + 0.08, hw - 0.08]) {
    for (let s = -1.2; s <= L + 1.2; s += 2.2) wood.box(at(s, o).setY(deck + 0.55), UP, D, N, 0.55, 0.07, 0.07, { grain: true });
    wood.box(at(L / 2, o).setY(deck + 1.05), D, UP, N, L / 2 + 1.3, 0.05, 0.05, { grain: true });
    wood.box(at(L / 2, o).setY(deck + 0.55), D, UP, N, L / 2 + 1.3, 0.035, 0.035, { grain: true });
  }
  // каменные устои на берегах
  for (const s of [-1.8, L + 1.8]) {
    const p = at(s);
    const g = terrain.heightAt(p.x, p.z) - 1.2;
    stone.box(p.clone().setY((g + deck - 0.3) / 2), D, UP, N, 1.0, (deck - 0.3 - g) / 2, hw + 0.4);
  }
  void metal;
  return { a, b };
}

// ---------------------------------------------------------------------------
// Крестьянский дом: каменный цоколь, фахверк с обмазкой, соломенная крыша
// ---------------------------------------------------------------------------
function thatchRoof(thatch, wood, f, L, W, eaveY, pitch, over = 0.7, overEnd = 0.45) {
  const run = W / 2 + over, H = (W / 2) * pitch, ridge = eaveY + H;
  const drop = over * pitch, x0 = -L / 2 - overEnd, x1 = L / 2 + overEnd;
  const T = 0.32; // толщина соломы
  const slen = Math.hypot(run, H + drop);
  for (const s of [1, -1]) {
    const a0 = f.p(x0, eaveY - drop, s * run), a1 = f.p(x1, eaveY - drop, s * run);
    const b0 = f.p(x0, ridge + 0.05, 0), b1 = f.p(x1, ridge + 0.05, 0);
    const n = f.d(0, run, s * (H + drop));
    const lift = (p) => p.clone().addScaledVector(n, T);
    // верх ската
    thatch.quad(lift(a0), lift(a1), lift(b1), lift(b0), n, [[x0, 0], [x1, 0], [x1, slen], [x0, slen]]);
    // низ ската (подшивка)
    const dn = n.clone().negate();
    wood.quad(a0, a1, b1, b0, dn, [[x0, 0], [x1, 0], [x1, slen], [x0, slen]]);
    // торец соломы у свеса — видна толщина
    thatch.quad(a0, a1, lift(a1), lift(a0), f.d(0, -H - drop, s * run), [[x0, 0], [x1, 0], [x1, 0.3], [x0, 0.3]]);
    // края у фронтонов
    for (const e of [x0, x1]) {
      const sgn = e > 0 ? 1 : -1;
      const p0 = f.p(e, eaveY - drop, s * run), p1 = f.p(e, ridge + 0.05, 0);
      thatch.quad(p0, p1, lift(p1), lift(p0), f.X.clone().multiplyScalar(sgn), [[0, 0], [slen, 0], [slen, 0.3], [0, 0.3]]);
    }
  }
  // конёк: связанный пучок соломы
  thatch.box(f.p(0, ridge + T + 0.05, 0), f.X, UP, f.N, (x1 - x0) / 2 + 0.05, 0.16, 0.34, { grain: true });
  for (let x = x0 + 0.4; x < x1; x += 0.8) wood.box(f.p(x, ridge + T + 0.22, 0), f.N, UP, f.X, 0.38, 0.02, 0.02, { grain: true });
  return ridge + T;
}

function peasantHouse(B, terrain, x, z, yaw, L, W, rnd) {
  const f = new Frame({ x, z, ax: Math.cos(yaw), az: Math.sin(yaw), nx: -Math.sin(yaw), nz: Math.cos(yaw) });
  let lo = Infinity, hi = -Infinity;
  for (let i = -1; i <= 1; i += 0.5) for (let j = -1; j <= 1; j += 0.5) {
    const p = f.p((i * L) / 2, 0, (j * W) / 2);
    const h = terrain.heightAt(p.x, p.z);
    lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  const floorY = hi + 0.35, baseY = lo - 0.4;
  const eaveY = floorY + 2.5;
  const pitch = 1.35 + rnd() * 0.2;
  const hl = L / 2, hw = W / 2;
  // каменный цоколь
  B.stone.box(f.p(0, (baseY + floorY) / 2, 0), f.X, UP, f.N, hl + 0.08, (floorY - baseY) / 2, hw + 0.08);
  // стены из обмазки
  const face = (lx0, lz0, lx1, lz1, n, y0, y1a, y1b, apex) => {
    const p0 = f.p(lx0, y0, lz0), p1 = f.p(lx1, y0, lz1), p2 = f.p(lx1, y1b, lz1), p3 = f.p(lx0, y1a, lz0);
    const u0 = 0, u1 = Math.hypot(lx1 - lx0, lz1 - lz0);
    B.daub.quad(p0, p1, p2, p3, n, [[u0, y0], [u1, y0], [u1, y1b], [u0, y1a]]);
    if (apex) {
      const c = f.p((lx0 + lx1) / 2, apex, (lz0 + lz1) / 2);
      B.daub.quad(p3, p2, c, c.clone(), n, [[u0, y1a], [u1, y1b], [u1 / 2, apex], [u1 / 2, apex]]);
    }
  };
  const ridge = eaveY + hw * pitch;
  face(-hl, hw, hl, hw, f.N.clone(), floorY, eaveY, eaveY);
  face(hl, -hw, -hl, -hw, f.N.clone().negate(), floorY, eaveY, eaveY);
  face(hl, hw, hl, -hw, f.X.clone(), floorY, eaveY, eaveY, ridge);
  face(-hl, -hw, -hl, hw, f.X.clone().negate(), floorY, eaveY, eaveY, ridge);
  // фахверк: нижняя и верхняя обвязки, стойки, ригель, раскосы
  const W8 = B.wood;
  const beam = (a, b, t = 0.09) => {
    const d = b.clone().sub(a);
    const len = d.length();
    d.normalize();
    const side = Math.abs(d.y) > 0.9 ? f.X : UP;
    const n3 = new V3().crossVectors(d, side).normalize();
    W8.box(a.clone().lerp(b, 0.5), d, side, n3, len / 2, t, t, { grain: true });
  };
  const walls = [
    { a: [-hl, hw], b: [hl, hw], n: f.N },
    { a: [hl, -hw], b: [-hl, -hw], n: f.N.clone().negate() },
    { a: [hl, hw], b: [hl, -hw], n: f.X },
    { a: [-hl, -hw], b: [-hl, hw], n: f.X.clone().negate() },
  ];
  for (const w of walls) {
    const o = 0.05;
    const P = (lx, lz, y) => f.p(lx, y, lz).addScaledVector(w.n, o);
    const [ax, az] = w.a, [bx, bz] = w.b;
    const len = Math.hypot(bx - ax, bz - az);
    beam(P(ax, az, floorY + 0.08), P(bx, bz, floorY + 0.08), 0.1);
    beam(P(ax, az, eaveY - 0.08), P(bx, bz, eaveY - 0.08), 0.1);
    beam(P(ax, az, floorY + 1.15), P(bx, bz, floorY + 1.15), 0.07);
    const posts = Math.max(2, Math.round(len / 1.6));
    for (let k = 0; k <= posts; k++) {
      const t = k / posts;
      const lx = ax + (bx - ax) * t, lz = az + (bz - az) * t;
      beam(P(lx, lz, floorY + 0.1), P(lx, lz, eaveY - 0.1), 0.08);
    }
    // угловые раскосы
    const t1 = 1 / posts;
    beam(P(ax, az, floorY + 0.15), P(ax + (bx - ax) * t1, az + (bz - az) * t1, floorY + 1.1), 0.06);
    beam(P(bx, bz, floorY + 0.15), P(bx - (bx - ax) * t1, bz - (bz - az) * t1, floorY + 1.1), 0.06);
  }
  // дверь и окна со ставнями на фасаде
  const doorX = (rnd() - 0.5) * (L - 3);
  plankDoor(W8, B.metal, f.p(doorX, 0, hw + 0.04), f.N, floorY, 0.95, 1.95);
  B.stone.box(f.p(doorX, floorY - 0.12, hw + 0.4), f.X, UP, f.N, 0.6, 0.12, 0.3); // ступень
  for (const wx of [doorX > 0 ? doorX - 2.1 : doorX + 2.1]) {
    if (Math.abs(wx) > hl - 0.6) continue;
    const c = f.p(wx, floorY + 1.55, hw + 0.03);
    B.dark.box(c, f.X, UP, f.N, 0.3, 0.28, 0.02);
    WINDOWS.push({ c: c.clone(), n: f.N.clone(), w: 0.6, h: 0.56 });
    for (const sd of [-1, 1]) {
      const hinge = c.clone().addScaledVector(f.X, sd * 0.32);
      const open = f.X.clone().multiplyScalar(sd).applyAxisAngle(UP, -sd * 0.5);
      const pn = new V3().crossVectors(UP, open).normalize();
      W8.box(hinge.clone().addScaledVector(open, 0.16).addScaledVector(f.N, 0.06), UP, open, pn, 0.3, 0.16, 0.025, { grain: true });
    }
  }
  const top = thatchRoof(B.thatch, W8, f, L, W, eaveY, pitch);
  return { f, floorY, ridge: top, L, W };
}

// Плетень: колья и переплетённые прутья (волной, то спереди, то сзади кольев)
export function wattleFence(wood, terrain, pts, h = 1.0) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const d = b.clone().sub(a).setY(0);
    const len = d.length();
    d.normalize();
    const n = new V3(-d.z, 0, d.x);
    const posts = Math.max(1, Math.round(len / 0.7));
    for (let k = 0; k <= posts; k++) {
      const p = a.clone().addScaledVector(d, (k / posts) * len);
      const g = terrain.heightAt(p.x, p.z);
      wood.box(p.clone().setY(g + h / 2), UP, d, n, h / 2 + 0.1, 0.035, 0.035, { grain: true });
      if (k === posts) continue;
      for (let r = 0; r < 5; r++) {
        const y = g + 0.2 + r * ((h - 0.25) / 4);
        const s = ((k + r) % 2 ? 1 : -1) * 0.035;
        const c = a.clone().addScaledVector(d, ((k + 0.5) / posts) * len).addScaledVector(n, s);
        const gy = terrain.heightAt(c.x, c.z);
        wood.box(c.setY(y - g + gy), d, UP, n, len / posts / 2 + 0.04, 0.025, 0.02, { grain: true });
      }
    }
  }
}

// Грядки с овощами (капуста, лук, горох) — комочки зелени
export function gardenBeds(soilB, plantB, terrain, f, x0, z0, w, d, rnd) {
  const beds = Math.max(2, Math.floor(w / 1.4));
  const plant = new THREE.IcosahedronGeometry(0.18, 1);
  for (let k = 0; k < beds; k++) {
    const lx = x0 + (k + 0.5) * (w / beds);
    const c = f.p(lx, 0, z0 + d / 2);
    const g = terrain.heightAt(c.x, c.z);
    soilB.box(c.clone().setY(g + 0.06), f.X, UP, f.N, w / beds / 2 - 0.25, 0.12, d / 2 - 0.2);
    const kind = Math.floor(rnd() * 3);
    for (let r = 0.3; r < d - 0.3; r += 0.45) {
      const p = f.p(lx + (rnd() - 0.5) * 0.3, 0, z0 + r);
      const s = kind === 0 ? 1.1 : kind === 1 ? 0.55 : 0.8;
      plantB.addGeometry(plant, new THREE.Matrix4().compose(p.setY(g + 0.18 + 0.05 * s), new THREE.Quaternion(), new V3(s, s * (kind === 1 ? 1.8 : 0.8), s)));
    }
  }
}

// ---------------------------------------------------------------------------
// Водяная мельница: каменный дом у берега, наливное колесо вращается
// ---------------------------------------------------------------------------
function watermill(B, scene, terrain, xRiver, rnd) {
  const zr = riverZ(xRiver);
  const dz = (riverZ(xRiver + 1) - riverZ(xRiver - 1)) / 2;
  const tl = Math.hypot(1, dz);
  const along = new V3(1 / tl, 0, dz / tl);
  const toNorth = new V3(dz / tl, 0, -1 / tl); // от воды к северному берегу
  const hwR = riverInfo(xRiver, zr - 30).hw; // ширина с северной стороны
  const edge = new V3(xRiver, 0, zr).addScaledVector(toNorth, hwR);
  const W = 6, L = 8;
  const hc = edge.clone().addScaledVector(toNorth, W / 2 + 2.2);
  const yaw = Math.atan2(along.z, along.x);
  const f = new Frame({ x: hc.x, z: hc.z, ax: along.x, az: along.z, nx: -toNorth.x, nz: -toNorth.z });
  let lo = Infinity, hi = -Infinity;
  for (let i = -1; i <= 1; i += 0.5) for (let j = -1; j <= 1; j += 0.5) {
    const p = f.p((i * L) / 2, 0, (j * W) / 2);
    const h = terrain.heightAt(p.x, p.z);
    lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  const floorY = hi + 0.3, baseY = Math.min(lo, RIVER.waterLevel) - 0.8;
  const eaveY = floorY + 3.4;
  // каменные стены (фасад к воде — сплошной, с отверстием для вала)
  const faceQ = (lx0, lz0, lx1, lz1, n, y1, apex) => {
    const p0 = f.p(lx0, baseY, lz0), p1 = f.p(lx1, baseY, lz1), p2 = f.p(lx1, y1, lz1), p3 = f.p(lx0, y1, lz0);
    const u1 = Math.hypot(lx1 - lx0, lz1 - lz0);
    B.stoneMill.quad(p0, p1, p2, p3, n, [[0, baseY], [u1, baseY], [u1, y1], [0, y1]], [0, 0, 9, 9]);
    if (apex) {
      const c = f.p((lx0 + lx1) / 2, apex, (lz0 + lz1) / 2);
      B.stoneMill.quad(p3, p2, c, c.clone(), n, [[0, y1], [u1, y1], [u1 / 2, apex], [u1 / 2, apex]]);
    }
  };
  const hl = L / 2, hw = W / 2, pitch = 1.3;
  const ridge = eaveY + hw * pitch;
  faceQ(-hl, hw, hl, hw, f.N.clone(), eaveY);
  faceQ(hl, -hw, -hl, -hw, f.N.clone().negate(), eaveY);
  faceQ(hl, hw, hl, -hw, f.X.clone(), eaveY, ridge);
  faceQ(-hl, -hw, -hl, hw, f.X.clone().negate(), eaveY, ridge);
  thatchRoof(B.thatch, B.wood, f, L, W, eaveY, pitch);
  plankDoor(B.wood, B.metal, f.p(-1.5, 0, -hw - 0.04), f.N.clone().negate(), floorY, 1.1, 2.1);
  // колесо
  const R = 2.7, width = 1.0;
  const wheelC = f.p(1.2, RIVER.waterLevel + R - 0.45, hw + width / 2 + 0.5);
  const wheel = new THREE.Group();
  wheel.position.copy(wheelC);
  wheel.quaternion.setFromUnitVectors(new V3(0, 0, 1), f.N);
  const wb = new GeoBuilder(B.wood.tile);
  const m = (geo, mat) => new THREE.Mesh(geo, mat);
  for (const zz of [-width / 2, width / 2]) {
    wb.addGeometry(new THREE.TorusGeometry(R - 0.1, 0.08, 6, 36), new THREE.Matrix4().makeTranslation(0, 0, zz));
    wb.addGeometry(new THREE.TorusGeometry(R * 0.55, 0.06, 6, 28), new THREE.Matrix4().makeTranslation(0, 0, zz));
    for (let k = 0; k < 8; k++) {
      const sp = new THREE.BoxGeometry(0.09, R - 0.1, 0.09);
      sp.translate(0, (R - 0.1) / 2, zz);
      sp.rotateZ((k / 8) * Math.PI * 2);
      wb.addGeometry(sp, new THREE.Matrix4());
    }
  }
  for (let k = 0; k < 18; k++) {
    const pd = new THREE.BoxGeometry(0.05, 0.55, width + 0.1);
    pd.translate(0, R - 0.1, 0);
    pd.rotateZ((k / 18) * Math.PI * 2);
    wb.addGeometry(pd, new THREE.Matrix4());
  }
  const axle = new THREE.CylinderGeometry(0.18, 0.18, width + 3.6, 10);
  axle.rotateX(Math.PI / 2);
  axle.translate(0, 0, -1.8);
  wb.addGeometry(axle, new THREE.Matrix4());
  const wm = m(wb.build(), B.woodMat);
  wm.castShadow = wm.receiveShadow = true;
  wheel.add(wm);
  scene.add(wheel);
  // жёлоб-лоток, по которому вода подаётся на колесо
  const chute = wheelC.clone().addScaledVector(f.X, -R - 1.5).setY(wheelC.y + R + 0.2);
  B.wood.box(chute, f.X, UP, f.N, 1.8, 0.05, 0.55, { grain: true });
  for (const s of [-1, 1]) B.wood.box(chute.clone().addScaledVector(f.N, s * 0.55).setY(chute.y + 0.2), f.X, UP, f.N, 1.8, 0.22, 0.03, { grain: true });
  for (const s of [-1.2, 0.6]) {
    const p = chute.clone().addScaledVector(f.X, s);
    const g = Math.min(terrain.heightAt(p.x, p.z), RIVER.waterLevel) - 0.4;
    B.wood.box(p.clone().setY((g + chute.y) / 2), UP, f.X, f.N, (chute.y - g) / 2, 0.1, 0.1, { grain: true });
  }
  void rnd;
  void yaw;
  return { update: (t) => { wm.rotation.z = -t * 0.55; }, center: hc, f, wheel: wheelC.clone(), wheelR: R, chute: chute.clone() };
}

// ---------------------------------------------------------------------------
// Поля: узкие полосы разных культур; внешний вид считает шейдер
// ---------------------------------------------------------------------------
const FIELD_BLOCKS = [
  { cx: 170, cz: 478, ang: 0.35, w: 150, l: 95 },
  { cx: 245, cz: 400, ang: 1.15, w: 110, l: 80 },
  { cx: 55, cz: 450, ang: -0.25, w: 120, l: 85 },
  { cx: 25, cz: 300, ang: 0.1, w: 90, l: 55 },
  { cx: 185, cz: 305, ang: 0.6, w: 80, l: 60 },
];

function fieldMaskFactory(terrain, houses) {
  const nE = createNoise2D(5151);
  // «запас» до ближайшей границы поля (м): >0 — внутри, <0 — снаружи
  const margin = (x, z, bi) => {
    const b = FIELD_BLOCKS[bi];
    const c = Math.cos(b.ang), s = Math.sin(b.ang);
    const dx = x - b.cx, dz = z - b.cz;
    const u = dx * c + dz * s, v = -dx * s + dz * c;
    let m = -(Math.max(Math.abs(u) - b.w / 2, Math.abs(v) - b.l / 2) + nE(x * 0.05, z * 0.05) * 4);
    const rd = terrain.roadNearest(x, z);
    if (rd) m = Math.min(m, rd.d - 5.5);
    m = Math.min(m, riverInfo(x, z).e - 6);
    for (const h of houses) m = Math.min(m, Math.hypot(x - h.x, z - h.z) - h.r);
    return { m, u: u + b.w / 2, v: v + b.l / 2 };
  };
  const mask = (x, z) => {
    for (let bi = 0; bi < FIELD_BLOCKS.length; bi++) {
      const r = margin(x, z, bi);
      if (r.m > 0) return { bi, u: r.u, v: r.v, edge: Math.min(1, r.m / 6) };
    }
    return null;
  };
  mask.margin = margin;
  return mask;
}

function buildFields(scene, terrain, mask) {
  const pos = [], attr = [], idx = [];
  const step = 2.0;
  for (let bi = 0; bi < FIELD_BLOCKS.length; bi++) {
    const b = FIELD_BLOCKS[bi];
    const c = Math.cos(b.ang), s = Math.sin(b.ang);
    const nu = Math.ceil((b.w + 16) / step), nv = Math.ceil((b.l + 16) / step);
    const id = new Int32Array((nu + 1) * (nv + 1)).fill(-1);
    const info = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = -b.w / 2 - 8 + i * step, v = -b.l / 2 - 8 + j * step;
      const x = b.cx + u * c - v * s, z = b.cz + u * s + v * c;
      const r = mask.margin(x, z, bi);
      info.push({ x, z, m: r.m > -3 ? { u: r.u, v: r.v, edge: r.m / 6 } : null });
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const k = [j * (nu + 1) + i, j * (nu + 1) + i + 1, (j + 1) * (nu + 1) + i, (j + 1) * (nu + 1) + i + 1];
      if (k.some((q) => !info[q].m) || k.every((q) => info[q].m.edge <= 0)) continue;
      const v = k.map((q) => {
        if (id[q] >= 0) return id[q];
        const { x, z, m } = info[q];
        pos.push(x, terrain.heightAt(x, z) + 0.07, z);
        // вне поля — прозрачная кромка (u, v продолжаем по сетке блока)
        attr.push(m.u, m.v, bi, m.edge);
        id[q] = pos.length / 3 - 1;
        return id[q];
      });
      idx.push(v[0], v[2], v[1], v[1], v[2], v[3]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aField', new THREE.Float32BufferAttribute(attr, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const dirt = materialTextures('dirt'), grass = materialTextures('grass');
  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.95, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  const angs = FIELD_BLOCKS.map((b) => b.ang);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tDirt = { value: dirt.map };
    sh.uniforms.tGrass = { value: grass.map };
    sh.uniforms.tMacro = { value: macroNoiseTexture() };
    sh.uniforms.angs = { value: angs };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aField;
        varying vec4 vField;
        varying vec3 vFW;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vField = aField;
        vFW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tDirt, tGrass, tMacro;
        uniform float angs[${angs.length}];
        varying vec4 vField;
        varying vec3 vFW;
        float fhash(float n) { return fract(sin(n * 91.345) * 47453.21); }
        vec3 gFieldN;`)
      .replace('#include <map_fragment>', `{
        float stripW = 9.0;
        float strip = floor(vField.x / stripW);
        float bi = floor(vField.z + 0.5);
        float h = fhash(strip + bi * 17.0);
        float type = h < 0.28 ? 0.0 : h < 0.52 ? 1.0 : h < 0.82 ? 2.0 : 3.0;
        float inStrip = fract(vField.x / stripW);
        vec3 soil = texture2D(tDirt, vFW.xz * 0.35).rgb * vec3(0.95, 0.76, 0.55);
        vec3 gr = texture2D(tGrass, vFW.xz * 0.45).rgb;
        float m = texture2D(tMacro, vFW.xz * 0.02).r;
        // борозды вдоль полосы (по v), межа между полосами
        float fur = sin(vField.x * 6.2832 / 0.75);
        float balk = 1.0 - smoothstep(0.0, 0.05, min(inStrip, 1.0 - inStrip));
        vec3 col;
        float nk = 0.0;
        if (type < 0.5) { col = soil * (0.75 + 0.25 * fur); nk = 0.35; }
        else if (type < 1.5) { float row = smoothstep(0.2, 0.7, fur); col = mix(soil, vec3(0.12, 0.26, 0.05) * (0.8 + 0.4 * m), row); nk = 0.2; }
        else if (type < 2.5) { col = vec3(0.5, 0.36, 0.1) * (0.8 + 0.35 * m) * (0.85 + 0.15 * fur); nk = 0.12; }
        else { col = gr * vec3(1.1, 1.05, 0.8); nk = 0.0; }
        col = mix(col, gr * 0.9, balk * 0.8);
        diffuseColor.rgb *= col;
        // неровная кромка поля: межа зарастает травой
        float en = texture2D(tMacro, vFW.xz * 0.08).g;
        diffuseColor.a = smoothstep(0.0, 0.45, vField.w + (en - 0.5) * 0.3);
        // наклон нормали по бороздам
        float bang = angs[int(bi)];
        vec3 across = vec3(cos(bang), 0.0, sin(bang));
        gFieldN = normalize(vec3(0.0, 1.0, 0.0) + across * cos(vField.x * 6.2832 / 0.75) * nk);
      }`)
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(gFieldN, 0.0)).xyz);');
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'fields';
  scene.add(mesh);
}

// ---------------------------------------------------------------------------
export function createVillage(scene, terrain, walls) {
  const rnd = mulberry32(7171);
  const road = terrain.road;
  const woodMat = walls.woodMaterial;
  const B = {
    stone: new GeoBuilder(walls.stoneMaterial.userData.tileMeters),
    stoneMill: new GeoBuilder(walls.stoneMaterial.userData.tileMeters),
    wood: new GeoBuilder(woodMat.userData.tileMeters),
    daub: new GeoBuilder(pbrMaterial('daub').userData.tileMeters),
    thatch: new GeoBuilder(pbrMaterial('thatch').userData.tileMeters),
    metal: new GeoBuilder(1),
    dark: new GeoBuilder(1),
    straw: new GeoBuilder(1),
    soil: new GeoBuilder(1),
    plants: new GeoBuilder(1),
    woodMat,
  };
  const updaters = [];
  const smokes = [];

  // мост
  const br = buildBridge(B.wood, B.stone, B.metal, terrain, road);

  // дома вдоль дороги за мостом
  const bi = road.findIndex((q, i) => i > 0 && road[i - 1].bridge && !q.bridge);
  const houses = [];
  const places = [];
  let side = 1;
  for (let s = road[bi].s + 16; s < road[road.length - 1].s - 5; s += 13 + rnd() * 5) {
    const k = road.findIndex((q) => q.s >= s);
    if (k < 0) break;
    const q = road[k];
    const nx = -q.dz * side, nz = q.dx * side;
    const off = 10 + rnd() * 3;
    const x = q.x + nx * off, z = q.z + nz * off;
    side = -side;
    if (riverInfo(x, z).e < 12) continue;
    const L = 7 + rnd() * 2.5, W = 5 + rnd() * 1;
    // коньком вдоль дороги, фасадом (f.N) к дороге, с небольшим разворотом
    const yaw = Math.atan2(nx, -nz) + (rnd() - 0.5) * 0.2;
    const h = peasantHouse(B, terrain, x, z, yaw, L, W, rnd);
    houses.push({ x, z, r: Math.max(L, W) / 2 + 9 });
    places.push({ h, x, z, back: new V3(nx, 0, nz) });
    { const want = rnd() < 0.6; void want; smokes.push(new Smoke(scene, h.f.p(L * 0.2, h.ridge + 0.3, 0), { count: 8, alpha: 0.22, size: 0.7, grow: 3, rise: 0.9 })); } // дым из каждой трубы
  }
  // огороды за домами, плетни, стога, поленницы
  const barrels = [];
  for (const pl of places) {
    const { h } = pl;
    const f = h.f;
    const gz0 = -h.W / 2 - 1.2, gd = 7, gw = h.L + 2;
    const pts = [f.p(-gw / 2, 0, gz0), f.p(-gw / 2, 0, gz0 - gd), f.p(gw / 2, 0, gz0 - gd), f.p(gw / 2, 0, gz0)];
    wattleFence(B.wood, terrain, pts);
    gardenBeds(B.soil, B.plants, terrain, f, -gw / 2 + 0.6, gz0 - gd + 0.5, gw - 1.2, gd - 1.2, rnd);
    if (rnd() < 0.5) haystack(B.straw, terrain, f.p(h.L / 2 + 2.2, 0, 1), 1.0 + rnd() * 0.5, rnd);
    if (rnd() < 0.6) barrels.push(f.p(-h.L / 2 - 0.7, 0, h.W / 2 - 0.5));
  }
  buildBarrels(scene, terrain, barrels, woodMat, new THREE.MeshStandardMaterial({ color: 0x2c2926, metalness: 0.85, roughness: 0.5 }), rnd);
  // телега у дороги
  if (places.length > 2) {
    const p = places[2].h.f.p(places[2].h.L / 2 + 1.8, 0, places[2].h.W / 2 + 2);
    cart(B.wood, B.metal, terrain, p.x, p.z, rnd() * 3, rnd);
  }

  // водяная мельница выше моста по течению
  const mill = watermill(B, scene, terrain, br.a.x - 45, rnd);
  updaters.push(mill.update);
  houses.push({ x: mill.center.x, z: mill.center.z, r: 12 });

  // поля
  const fieldMask = fieldMaskFactory(terrain, houses);
  buildFields(scene, terrain, fieldMask);
  // стога на сжатых полосах
  for (let k = 0; k < 40; k++) {
    const b = FIELD_BLOCKS[k % FIELD_BLOCKS.length];
    const u = (rnd() - 0.5) * b.w, v = (rnd() - 0.5) * b.l;
    const x = b.cx + u * Math.cos(b.ang) - v * Math.sin(b.ang), z = b.cz + u * Math.sin(b.ang) + v * Math.cos(b.ang);
    const m = fieldMask(x, z);
    if (!m) continue;
    const strip = Math.floor(m.u / 9);
    const hh = (Math.sin((strip + m.bi * 17) * 91.345) * 47453.21) % 1;
    const frac = hh - Math.floor(hh);
    if (frac > 0.52 && frac < 0.82 && rnd() < 0.7) haystack(B.straw, terrain, new V3(x, 0, z), 0.8 + rnd() * 0.4, rnd);
  }

  // сборка сеток
  const daubMat = pbrMaterial('daub');
  const thatchMat = pbrMaterial('thatch');
  const soilMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 1 });
  const plantMat = new THREE.MeshStandardMaterial({ color: 0x3d6b22, roughness: 0.8 });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x2c2926, metalness: 0.85, roughness: 0.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0b0a09, roughness: 1 });
  for (const [bld, mat] of [
    [B.stone, walls.stoneMaterial], [B.stoneMill, walls.stoneMaterial], [B.wood, woodMat], [B.daub, daubMat],
    [B.thatch, thatchMat], [B.metal, ironMat], [B.dark, darkMat], [B.straw, strawMaterial()], [B.soil, soilMat], [B.plants, plantMat],
  ]) {
    if (!bld.pos.length) continue;
    const m = new THREE.Mesh(bld.build(), mat);
    m.castShadow = m.receiveShadow = true;
    m.name = 'village';
    scene.add(m);
  }

  // исключение деревьев и травы на полях, в огородах и у домов
  const exclude = (x, z) => {
    for (const h of houses) if (Math.hypot(x - h.x, z - h.z) < h.r) return 1;
    return fieldMask(x, z) ? 1 : 0;
  };
  return {
    exclude,
    houses: places.map((p) => p.h),
    bridge: br,
    mill: mill.center,
    millWheel: { c: mill.wheel, r: mill.wheelR, chute: mill.chute, f: mill.f },
    update(t) {
      for (const u of updaters) u(t);
      for (const s of smokes) s.update(t);
    },
  };
}
