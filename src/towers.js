// Этап 3: башни. Круглые и квадратные, разной высоты; кладка со скошенным
// цоколем, бойницы на нескольких ярусах (часть — крестообразные), зубчатый
// парапет (у части башен — на каменных консолях), конические и шатровые
// крыши из черепицы, видимой отдельными рядами, флюгеры, двери с железными
// полосами и петлями, окна со ставнями.
import * as THREE from 'three';
import { addWeathering } from './materials.js';
import { TOWERS, WALL } from './layout.js';
import { GeoBuilder } from './walls.js';
import { pbrMaterial, assetSource } from './textures.js';
import { mulberry32 } from './noise.js';
import { createFlag } from './flags.js';

const V3 = THREE.Vector3;
const smoothstep01 = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const UP = new V3(0, 1, 0);
export const TILE_W = 0.26; // ширина одной черепицы, м
export const ROW_H = 0.3; // шаг рядов черепицы по скату, м

// ---------------------------------------------------------------------------
// Контур башни: для круглой — одна замкнутая линия с радиальными нормалями,
// для квадратной — 4 грани с плоскими нормалями. off — смещение наружу.
// u — развёртка (метры вдоль контура) для текстуры кладки.
// ---------------------------------------------------------------------------
export function outline(tw, off, segs = 56) {
  const C = new V3(tw.x, 0, tw.z);
  if (tw.shape === 'round') {
    const line = [];
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const n = new V3(Math.cos(a), 0, Math.sin(a));
      line.push({ p: C.clone().addScaledVector(n, tw.r + off), n, u: a * tw.r });
    }
    return [line];
  }
  const lines = [];
  for (let f = 0; f < 4; f++) {
    const a = tw.yaw + (f * Math.PI) / 2;
    const n = new V3(Math.cos(a), 0, Math.sin(a));
    const t = new V3(-Math.sin(a), 0, Math.cos(a));
    const half = tw.r + off;
    const cnt = Math.max(2, Math.ceil((2 * tw.r) / 1.0)); // одинаково для всех смещений
    const line = [];
    for (let k = 0; k <= cnt; k++) {
      const s = -half + (k / cnt) * 2 * half;
      line.push({ p: C.clone().addScaledVector(n, half).addScaledVector(t, s), n, u: s + f * 17 });
    }
    lines.push(line);
  }
  return lines;
}

// Вертикальная «лента» по контуру между высотами y0(pt) и y1(pt)
export function band(b, lines, y0, y1, { facing = 1, tilt = 0 } = {}) {
  for (const line of lines) {
    for (let j = 0; j < line.length - 1; j++) {
      const a = line[j], c = line[j + 1];
      const na = a.n.clone().multiplyScalar(facing).addScaledVector(UP, tilt).normalize();
      const nc = c.n.clone().multiplyScalar(facing).addScaledVector(UP, tilt).normalize();
      const pa0 = a.p.clone(); pa0.y = y0(a);
      const pc0 = c.p.clone(); pc0.y = y0(c);
      const pc1 = c.p.clone(); pc1.y = y1(c);
      const pa1 = a.p.clone(); pa1.y = y1(a);
      b.quad4([pa0, pc0, pc1, pa1], [na, nc, nc, na], [[a.u, pa0.y], [c.u, pc0.y], [c.u, pc1.y], [a.u, pa1.y]]);
    }
  }
}

// Горизонтальное кольцо между двумя контурами (верх парапета, выступ пояска, пол)
export function ring(b, inner, outer, y, normal) {
  for (let l = 0; l < inner.length; l++) {
    const A = inner[l], B = outer[l];
    for (let j = 0; j < A.length - 1; j++) {
      const p0 = A[j].p.clone(), p1 = A[j + 1].p.clone(), p2 = B[j + 1].p.clone(), p3 = B[j].p.clone();
      for (const p of [p0, p1, p2, p3]) p.y = y;
      b.quad(p0, p1, p2, p3, normal, [[p0.x, p0.z], [p1.x, p1.z], [p2.x, p2.z], [p3.x, p3.z]]);
    }
  }
}

// Точки на поверхности башни, куда можно поставить бойницу/окно/дверь
function surfacePoint(tw, dir, off = 0) {
  const C = new V3(tw.x, 0, tw.z);
  if (tw.shape === 'round') return { p: C.clone().addScaledVector(dir, tw.r + off), n: dir.clone() };
  // квадратная: ближайшая грань
  let best = null, bd = -2;
  for (let f = 0; f < 4; f++) {
    const a = tw.yaw + (f * Math.PI) / 2;
    const n = new V3(Math.cos(a), 0, Math.sin(a));
    const d = n.dot(dir);
    if (d > bd) { bd = d; best = n; }
  }
  const t = new V3(-best.z, 0, best.x);
  const s = Math.max(-tw.r + 1, Math.min(tw.r - 1, dir.dot(t) / Math.max(0.3, bd) * tw.r));
  return { p: C.clone().addScaledVector(best, tw.r + off).addScaledVector(t, s), n: best.clone() };
}

// ---------------------------------------------------------------------------
// Бойница: щель в рамке из тёсаного камня; cross — с поперечной прорезью
// ---------------------------------------------------------------------------
export function arrowSlit(stone, dark, p, n, y, cross) {
  const t = new V3().crossVectors(UP, n).normalize();
  const c = new V3(p.x, y, p.z);
  dark.box(c.clone().addScaledVector(n, 0.012), t, UP, n, 0.06, 0.62, 0.02);
  if (cross) dark.box(c.clone().addScaledVector(n, 0.012).addScaledVector(UP, 0.15), t, UP, n, 0.24, 0.05, 0.02);
  const fa = stone.forceA;
  stone.forceA = 1000;
  for (const sd of [-1, 1]) stone.box(c.clone().addScaledVector(t, sd * 0.17).addScaledVector(n, 0.07), t, UP, n, 0.1, 0.74, 0.09);
  stone.box(c.clone().addScaledVector(UP, 0.74).addScaledVector(n, 0.07), t, UP, n, 0.28, 0.1, 0.1);
  stone.box(c.clone().addScaledVector(UP, -0.74).addScaledVector(n, 0.07), t, UP, n, 0.28, 0.1, 0.1);
  stone.forceA = fa;
}

// ---------------------------------------------------------------------------
// Дверь со стрельчатым верхом: доски, железные полосы, петли, кольцо-ручка,
// рама из тёсаного камня с клинчатой аркой
// ---------------------------------------------------------------------------
export function door(stone, wood, metal, p, n, baseY, w = 1.1, h = 2.3) {
  const t = new V3().crossVectors(UP, n).normalize();
  const hs = h - 0.866 * w; // высота пят арки
  const archY = (x) => hs + Math.sqrt(Math.max(0, w * w - (Math.abs(x) + w / 2) ** 2)) - 0.0;
  const c = new V3(p.x, baseY, p.z).addScaledVector(n, 0.07);
  // доски полотна
  const planks = 5;
  for (let k = 0; k < planks; k++) {
    const x = -w / 2 + (k + 0.5) * (w / planks);
    const top = Math.min(archY(x - w / planks / 2), archY(x + w / planks / 2), archY(x));
    const pc = c.clone().addScaledVector(t, x);
    wood.box(new V3(pc.x, baseY + top / 2, pc.z), UP, t, n, top / 2, w / planks / 2 - 0.006, 0.04, { grain: true });
  }
  // железные полосы с петлями и кольцо
  for (const y of [0.35, 1.0, hs - 0.15]) {
    const sc = c.clone().addScaledVector(n, 0.05);
    metal.box(new V3(sc.x, baseY + y, sc.z), t, UP, n, w / 2 - 0.04, 0.035, 0.012);
    const hinge = sc.clone().addScaledVector(t, -w / 2 + 0.02);
    metal.box(new V3(hinge.x, baseY + y, hinge.z), UP, t, n, 0.09, 0.035, 0.03);
    for (let k = 0; k < 5; k++) {
      const nail = sc.clone().addScaledVector(t, -w / 2 + 0.12 + k * (w - 0.24) / 4).addScaledVector(n, 0.015);
      metal.box(new V3(nail.x, baseY + y, nail.z), t, UP, n, 0.018, 0.018, 0.012);
    }
  }
  const ringGeo = new THREE.TorusGeometry(0.075, 0.012, 6, 14);
  const ringPos = c.clone().addScaledVector(t, w * 0.28).addScaledVector(n, 0.08);
  const m = new THREE.Matrix4().makeBasis(t, UP, n).setPosition(ringPos.x, baseY + 1.05, ringPos.z);
  metal.addGeometry(ringGeo, m);
  // каменная рама: косяки, клинчатая стрельчатая арка (две дуги радиусом w), порог
  const fa = stone.forceA;
  stone.forceA = 1000;
  const fr = c.clone().addScaledVector(n, 0.02);
  for (const sd of [-1, 1]) {
    const jc = fr.clone().addScaledVector(t, sd * (w / 2 + 0.13));
    stone.box(new V3(jc.x, baseY + hs / 2, jc.z), t, UP, n, 0.13, hs / 2, 0.14);
  }
  const per = 5;
  for (const sd of [1, -1]) {
    for (let k = 0; k < per; k++) {
      const phi = ((k + 0.5) / per) * (Math.PI / 3);
      // дуга с центром в противоположной пяте арки
      const x = sd * (-w / 2 + w * Math.cos(phi));
      const y = hs + w * Math.sin(phi);
      const rad = new V3().addScaledVector(t, sd * Math.cos(phi)).addScaledVector(UP, Math.sin(phi)).normalize();
      const tang = new V3().crossVectors(n, rad).normalize();
      const vc = fr.clone().addScaledVector(t, x).addScaledVector(rad, 0.14);
      stone.box(new V3(vc.x, baseY + y + rad.y * 0.14, vc.z), tang, rad, n, 0.12, 0.14, 0.14);
    }
  }
  stone.box(new V3(fr.x, baseY - 0.05, fr.z).addScaledVector(n, 0.1), t, UP, n, w / 2 + 0.3, 0.07, 0.25);
  stone.forceA = fa;
}

// Окно со ставнями: тёмный проём, каменная рама, распахнутые деревянные ставни
// Все окна со ставнями (башни, донжон, дома деревни) — ночью в них горит свет
export const WINDOWS = [];

export function windowWithShutters(stone, wood, dark, metal, p, n, y, w = 0.7, h = 1.1, openAng = 1.9) {
  const t = new V3().crossVectors(UP, n).normalize();
  const c = new V3(p.x, y, p.z);
  WINDOWS.push({ c: c.clone(), n: n.clone(), w, h });
  dark.box(c.clone().addScaledVector(n, 0.02), t, UP, n, w / 2, h / 2, 0.02);
  const fa = stone.forceA;
  stone.forceA = 1000; // рама из светлого тёсаного камня, выступает — окно кажется глубоким
  // средник-колонка (двойное окно)
  stone.box(c.clone().addScaledVector(n, 0.08), t, UP, n, 0.05, h / 2, 0.08);
  for (const sd of [-1, 1]) stone.box(c.clone().addScaledVector(t, sd * (w / 2 + 0.1)).addScaledVector(n, 0.1), t, UP, n, 0.1, h / 2 + 0.12, 0.12);
  stone.box(c.clone().addScaledVector(UP, h / 2 + 0.12).addScaledVector(n, 0.1), t, UP, n, w / 2 + 0.2, 0.1, 0.13);
  stone.box(c.clone().addScaledVector(UP, h / 2 + 0.27).addScaledVector(n, 0.12), t, UP, n, w / 2 + 0.3, 0.05, 0.14); // слезник
  stone.box(c.clone().addScaledVector(UP, -h / 2 - 0.1).addScaledVector(n, 0.13), t, UP, n, w / 2 + 0.25, 0.07, 0.18);
  stone.forceA = fa;
  // ставни на петлях у краёв проёма, раскрыты наружу
  for (const sd of [-1, 1]) {
    const hinge = c.clone().addScaledVector(t, sd * (w / 2 + 0.2)).addScaledVector(n, 0.2);
    const dirOpen = t.clone().multiplyScalar(sd).applyAxisAngle(UP, -sd * (Math.PI - openAng));
    const panelC = hinge.clone().addScaledVector(dirOpen, w / 4 + 0.02);
    const pn = new V3().crossVectors(UP, dirOpen).normalize();
    wood.box(panelC, UP, dirOpen, pn, h / 2 + 0.05, w / 4 + 0.02, 0.035, { grain: true });
    for (const yy of [-h / 3, h / 3]) {
      const sc = panelC.clone().addScaledVector(UP, yy).addScaledVector(pn, 0.04);
      metal.box(sc, dirOpen, UP, pn, w / 4, 0.025, 0.01);
    }
  }
}

// ---------------------------------------------------------------------------
// Крыши: ряды черепицы ступеньками — каждый ряд чуть выступает над предыдущим
// ---------------------------------------------------------------------------
export function rowUV(k, u, isTop) {
  // полоса ряда k в текстуре (4 ряда в текстуре; v растёт вверх)
  const r = k % 4;
  const v0 = 1 - (r + 1) / 4, v1 = 1 - r / 4;
  return [u, isTop ? v1 : v0];
}

export function coneRoof(b, C, eaveR, eaveY, H, photo) {
  const Ls = Math.hypot(eaveR, H);
  const rows = Math.ceil((Ls - 0.35) / ROW_H);
  const segs = 64;
  const lift = 0.045, overlap = 0.07;
  for (let k = 0; k < rows; k++) {
    const s0 = k * ROW_H, s1 = Math.min(Ls - 0.3, (k + 1) * ROW_H + overlap);
    const r0 = eaveR * (1 - s0 / Ls), r1 = eaveR * (1 - s1 / Ls);
    const y0 = eaveY + H * (s0 / Ls), y1 = eaveY + H * (s1 / Ls);
    const tiles = Math.max(6, Math.round((2 * Math.PI * (r0 + r1) / 2) / TILE_W));
    for (let j = 0; j < segs; j++) {
      const a0 = (j / segs) * Math.PI * 2, a1 = ((j + 1) / segs) * Math.PI * 2;
      const d0 = new V3(Math.cos(a0), 0, Math.sin(a0)), d1 = new V3(Math.cos(a1), 0, Math.sin(a1));
      const n0 = d0.clone().multiplyScalar(H).addScaledVector(UP, eaveR).normalize();
      const n1 = d1.clone().multiplyScalar(H).addScaledVector(UP, eaveR).normalize();
      const lo0 = C.clone().addScaledVector(d0, r0).setY(y0).addScaledVector(n0, lift);
      const lo1 = C.clone().addScaledVector(d1, r0).setY(y0).addScaledVector(n1, lift);
      const hi0 = C.clone().addScaledVector(d0, r1).setY(y1);
      const hi1 = C.clone().addScaledVector(d1, r1).setY(y1);
      const u0 = (j / segs) * (tiles / 6), u1 = ((j + 1) / segs) * (tiles / 6);
      const uv = photo
        ? [[u0 * 1.56, s0 / 1.56], [u1 * 1.56, s0 / 1.56], [u1 * 1.56, s1 / 1.56], [u0 * 1.56, s1 / 1.56]]
        : [rowUV(k, u0, false), rowUV(k, u1, false), rowUV(k, u1, true), rowUV(k, u0, true)];
      b.quad4([lo0, lo1, hi1, hi0], [n0, n1, n1, n0], uv);
      // торец ряда (толщина черепицы)
      const in0 = C.clone().addScaledVector(d0, r0).setY(y0), in1 = C.clone().addScaledVector(d1, r0).setY(y0);
      const down = d0.clone().multiplyScalar(eaveR).addScaledVector(UP, -H).normalize();
      b.quad4([in0, in1, lo1, lo0], [down, down, down, down], [[u0, 0.02], [u1, 0.02], [u1, 0.0], [u0, 0.0]]);
    }
  }
  return eaveY + H;
}

export function pyramidRoof(b, C, yaw, E, eaveY, H, photo) {
  const Ls = Math.hypot(E, H);
  const rows = Math.ceil((Ls - 0.35) / ROW_H);
  const lift = 0.045, overlap = 0.07;
  for (let f = 0; f < 4; f++) {
    const a = yaw + (f * Math.PI) / 2;
    const fn = new V3(Math.cos(a), 0, Math.sin(a));
    const ft = new V3(-Math.sin(a), 0, Math.cos(a));
    const n = fn.clone().multiplyScalar(H).addScaledVector(UP, E).normalize();
    for (let k = 0; k < rows; k++) {
      const s0 = k * ROW_H, s1 = Math.min(Ls - 0.3, (k + 1) * ROW_H + overlap);
      const w0 = E * (1 - s0 / Ls), w1 = E * (1 - s1 / Ls);
      const y0 = eaveY + H * (s0 / Ls), y1 = eaveY + H * (s1 / Ls);
      const pt = (w, s, y) => C.clone().addScaledVector(fn, w).addScaledVector(ft, s).setY(y);
      const lo0 = pt(w0, -w0, y0).addScaledVector(n, lift), lo1 = pt(w0, w0, y0).addScaledVector(n, lift);
      const hi0 = pt(w1, -w1, y1), hi1 = pt(w1, w1, y1);
      const U = (x) => x / 1.56;
      const uv = photo
        ? [[U(-w0), s0 / 1.56], [U(w0), s0 / 1.56], [U(w1), s1 / 1.56], [U(-w1), s1 / 1.56]]
        : [rowUV(k, U(-w0), false), rowUV(k, U(w0), false), rowUV(k, U(w1), true), rowUV(k, U(-w1), true)];
      b.quad4([lo0, lo1, hi1, hi0], [n, n, n, n], uv);
      const in0 = pt(w0, -w0, y0), in1 = pt(w0, w0, y0);
      const down = fn.clone().multiplyScalar(E).addScaledVector(UP, -H).normalize();
      b.quad4([in0, in1, lo1, lo0], [down, down, down, down], [[0, 0.02], [1, 0.02], [1, 0], [0, 0]]);
    }
  }
  // коньковые плитки по рёбрам шатра
  for (let f = 0; f < 4; f++) {
    const a = yaw + (f * Math.PI) / 2 + Math.PI / 4;
    const d = new V3(Math.cos(a), 0, Math.sin(a));
    const corner = C.clone().addScaledVector(d, E * Math.SQRT2).setY(eaveY + 0.05);
    const apex = C.clone().setY(eaveY + H);
    const axis = apex.clone().sub(corner);
    const len = axis.length();
    axis.normalize();
    const side = new V3().crossVectors(axis, UP).normalize();
    const up2 = new V3().crossVectors(side, axis).normalize();
    const mid = corner.clone().add(apex).multiplyScalar(0.5).addScaledVector(up2, 0.07);
    b.box(mid, axis, side, up2, len / 2, 0.13, 0.07, { grain: true });
  }
  return eaveY + H;
}

// Нижняя сторона крыши (видна через проёмы между зубцами): дощатая обшивка
function roofUnderside(wood, C, tw, eaveR, eaveY, H) {
  const lines = outline({ ...tw, x: C.x, z: C.z }, eaveR - tw.r - 0.25, 40);
  for (const line of lines) {
    for (let j = 0; j < line.length - 1; j++) {
      const a = line[j].p.clone().setY(eaveY - 0.05), c = line[j + 1].p.clone().setY(eaveY - 0.05);
      const apex = C.clone().setY(eaveY + H - 0.4);
      const n = line[j].n.clone().multiplyScalar(-H).addScaledVector(UP, -eaveR).normalize();
      wood.quad(a, c, apex, apex.clone(), n, [[line[j].u, 0], [line[j + 1].u, 0], [line[j + 1].u, H], [line[j].u, H]]);
    }
  }
}

// ---------------------------------------------------------------------------
// Флюгер: шпиль, позолоченный шар и вращающийся флажок-вымпел
// ---------------------------------------------------------------------------
export function weathervane(ctx, apex, seed) {
  // неподвижные части сливаются в общие сетки (меньше вызовов отрисовки)
  const at = (x, y, z) => new THREE.Matrix4().makeTranslation(apex.x + x, apex.y + y, apex.z + z);
  ctx.metal.addGeometry(new THREE.CylinderGeometry(0.035, 0.06, 2.6, 8), at(0, 1.0, 0));
  ctx.metal.addGeometry(new THREE.ConeGeometry(0.22, 0.5, 12), at(0, 0.05, 0));
  ctx.metal.addGeometry(new THREE.BoxGeometry(0.9, 0.02, 0.02), at(0, 1.35, 0));
  ctx.metal.addGeometry(new THREE.BoxGeometry(0.02, 0.02, 0.9), at(0, 1.35, 0));
  ctx.gold.addGeometry(new THREE.SphereGeometry(0.13, 16, 10), at(0, 0.75, 0));
  // вращающийся вымпел — одна сетка
  if (!ctx.vaneGeo) {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.18);
    shape.lineTo(0.75, -0.2);
    shape.lineTo(0.62, 0);
    shape.lineTo(0.75, 0.2);
    shape.lineTo(0, 0.18);
    shape.lineTo(0, -0.18);
    const vb = new GeoBuilder(1);
    vb.addGeometry(new THREE.ExtrudeGeometry(shape, { depth: 0.015, bevelEnabled: false }), new THREE.Matrix4().makeTranslation(0.05, 0, -0.0075));
    vb.addGeometry(new THREE.ConeGeometry(0.05, 0.3, 8), new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(-0.2, 0, 0));
    ctx.vaneGeo = vb.build();
  }
  const vane = new THREE.Mesh(ctx.vaneGeo, ctx.ironMat);
  vane.position.set(apex.x, apex.y + 1.85, apex.z);
  vane.castShadow = true;
  ctx.scene.add(vane);
  const rnd = mulberry32(seed);
  const phase = rnd() * 10;
  return (t) => {
    // ветер с юго-запада, флюгер покачивается от порывов
    vane.rotation.y = 0.6 + Math.sin(t * 0.37 + phase) * 0.35 + Math.sin(t * 2.1 + phase) * 0.06;
  };
}

// ---------------------------------------------------------------------------
// Общие материалы и построители для башен (и надвратной башни, и барбакана)
export function makeTowerContext(scene, terrain, walls) {
  const stoneMat = walls.stoneMaterial;
  const woodMat = walls.woodMaterial;
  const ctx = {
    scene, terrain, walls,
    stoneMat, woodMat,
    roofMat: addWeathering(pbrMaterial('roof'), 'roof'),
    photoRoof: assetSource('roof') === 'polyhaven',
    darkMat: new THREE.MeshStandardMaterial({ color: 0x0a0908, roughness: 1 }),
    ironMat: new THREE.MeshStandardMaterial({ color: 0x2c2926, metalness: 0.85, roughness: 0.5 }),
    goldMat: new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.28 }),
    vanes: [],
  };
  ctx.stone = new GeoBuilder(stoneMat.userData.tileMeters);
  ctx.wood = new GeoBuilder(woodMat.userData.tileMeters);
  ctx.dark = new GeoBuilder(1);
  ctx.metal = new GeoBuilder(1);
  ctx.roof = new GeoBuilder(1);
  ctx.gold = new GeoBuilder(1);
  return ctx;
}

export function finishTowerContext(ctx, name) {
  const meshes = [
    new THREE.Mesh(ctx.stone.build(), ctx.stoneMat),
    new THREE.Mesh(ctx.wood.build(), ctx.woodMat),
    new THREE.Mesh(ctx.dark.build(), ctx.darkMat),
    new THREE.Mesh(ctx.metal.build(), ctx.ironMat),
    new THREE.Mesh(ctx.roof.build(), ctx.roofMat),
    new THREE.Mesh(ctx.gold.build(), ctx.goldMat),
  ];
  for (const m of meshes) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = name;
    ctx.scene.add(m);
  }
  return (t) => { for (const v of ctx.vanes) v(t); };
}

// Одна башня. opts: walkY, wallDirs, outDir, body/slits/walkDoors/groundDoor/window = false — пропустить
export function buildTower(ctx, tw, opts = {}) {
  const { stone, wood, dark, metal, roof, vanes, terrain, walls, scene, ironMat, goldMat, photoRoof } = ctx;
  const rnd = mulberry32(500 + tw.id * 31);
  const C = new V3(tw.x, 0, tw.z);
  const walkY = opts.walkY ?? walls.walkAt(tw.node.x, tw.node.z);
  const platY = walkY + tw.extra;
  const batterH = 3.8, bat = 0.75;
  const corbel = !!tw.corbel;
  const pOut = tw.corbelOut ?? (corbel ? 0.38 : 0.0); // вынос парапета на консолях
  const sill = WALL.parapetSill, mTop = WALL.merlonHeight + 0.1;

  const outDir = opts.outDir ? opts.outDir.clone() : new V3(tw.x, 0, tw.z).normalize();
  // --- тело башни: цоколь со скосом и кладка до верхней площадки ---
  if (opts.body !== false) {
  const baseOf = (pt) => {
    const d = pt.n;
    const q1 = pt.p.clone().addScaledVector(d, bat + 0.6), q2 = pt.p.clone().addScaledVector(d, bat + 2.5);
    return Math.min(terrain.heightAt(q1.x, q1.z), terrain.heightAt(q2.x, q2.z), terrain.heightAt(pt.p.x, pt.p.z)) - 1.0;
  };
  const lines = outline(tw, 0);
  // скос цоколя только снаружи; со стороны двора (там дверь) стена вертикальная
  const batOf = (pt) => (opts.batterAll ? bat : bat * smoothstep01((pt.n.dot(outDir) + 0.35) / 0.7));
  for (const line of lines) {
    const bases = line.map(baseOf);
    const levels = (b) => {
      const top = platY - 0.3;
      const ys = [b, b + 0.9, b + batterH];
      const n = Math.max(2, Math.ceil((top - b - batterH) / 1.8));
      for (let k = 1; k <= n; k++) ys.push(b + batterH + ((top - b - batterH) * k) / n);
      return ys;
    };
    const K = Math.max(...bases.map((b) => levels(b).length));
    for (let j = 0; j < line.length - 1; j++) {
      const A = line[j], B = line[j + 1];
      const la = levels(bases[j]), lb = levels(bases[j + 1]);
      const yA = (k) => la[Math.min(k, la.length - 1)], yB = (k) => lb[Math.min(k, lb.length - 1)];
      for (let k = 0; k < K - 1; k++) {
        const off = (pt, y, b) => { const h = y - b; return h < batterH ? batOf(pt) * (1 - h / batterH) : 0; };
        const P = (pt, y, b) => pt.p.clone().addScaledVector(pt.n, off(pt, y, b)).setY(y);
        const ya0 = yA(k), ya1 = yA(k + 1), yb0 = yB(k), yb1 = yB(k + 1);
        if (ya1 - ya0 < 1e-3 && yb1 - yb0 < 1e-3) continue;
        const inBat = ya1 - bases[j] <= batterH + 0.01;
        const nA = A.n.clone().addScaledVector(UP, inBat ? batOf(A) / batterH : 0).normalize();
        const nB = B.n.clone().addScaledVector(UP, inBat ? batOf(B) / batterH : 0).normalize();
        stone.quad4(
          [P(A, ya0, bases[j]), P(B, yb0, bases[j + 1]), P(B, yb1, bases[j + 1]), P(A, ya1, bases[j])],
          [nA, nB, nB, nA],
          [[A.u, ya0], [B.u, yb0], [B.u, yb1], [A.u, ya1]],
          [ya0 - bases[j] - 1, yb0 - bases[j + 1] - 1, yb1 - bases[j + 1] - 1, ya1 - bases[j] - 1]
        );
      }
    }
  }

  }

  // --- поясок или консоли под парапетом ---
  if (!corbel) {
    const o1 = outline(tw, 0.15), o0 = outline(tw, 0);
    band(stone, o1, () => platY - 0.3, () => platY);
    ring(stone, o0, o1, platY - 0.3, UP.clone().negate());
    ring(stone, o0, o1, platY, UP);
  } else {
    // парапет вынесен на ступенчатых каменных консолях
    const oOut = outline(tw, pOut), o0 = outline(tw, 0);
    ring(stone, o0, oOut, platY - 0.05, UP.clone().negate());
    const per = tw.shape === 'round' ? 2 * Math.PI * tw.r : 8 * tw.r;
    const count = Math.round(per / 1.25);
    for (let k = 0; k < count; k++) {
      let p, n;
      if (tw.shape === 'round') {
        const a = (k / count) * Math.PI * 2;
        n = new V3(Math.cos(a), 0, Math.sin(a));
        p = C.clone().addScaledVector(n, tw.r);
      } else {
        const f = Math.floor((k / count) * 4);
        const s = ((k / count) * 4 - f) * 2 * tw.r - tw.r + 0.4;
        if (Math.abs(s) > tw.r - 0.3) continue;
        const a = tw.yaw + (f * Math.PI) / 2;
        n = new V3(Math.cos(a), 0, Math.sin(a));
        p = C.clone().addScaledVector(n, tw.r).addScaledVector(new V3(-n.z, 0, n.x), s);
      }
      const t = new V3().crossVectors(UP, n).normalize();
      // консоль из трёх камней, каждый следующий выступает дальше
      stone.box(p.clone().addScaledVector(n, pOut / 2 - 0.04).setY(platY - 0.25), t, UP, n, 0.2, 0.2, pOut / 2 + 0.04);
      stone.box(p.clone().addScaledVector(n, pOut / 3 - 0.04).setY(platY - 0.62), t, UP, n, 0.2, 0.17, pOut / 3 + 0.04);
      stone.box(p.clone().addScaledVector(n, pOut / 6 - 0.04).setY(platY - 0.94), t, UP, n, 0.2, 0.15, pOut / 6 + 0.04);
    }
  }

  // кладка между телом башни и парапетом
  band(stone, outline(tw, 0), () => platY - 0.35, () => platY + 0.01);
  // --- парапет с зубцами ---
  const pO = outline(tw, pOut), pI = outline(tw, pOut - 0.6);
  band(stone, pO, () => platY - 0.05, () => platY + sill);
  band(stone, pI, () => platY, () => platY + sill, { facing: -1 });
  ring(stone, pI, pO, platY + sill, UP);
  // деревянный пол верхней площадки
  const floorIn = outline(tw, -tw.r + 0.05);
  ring(wood, floorIn, pI, platY + 0.02, UP);
  const merlonR = pOut - 0.3;
  const per = tw.shape === 'round' ? 2 * Math.PI * (tw.r + merlonR) : 8 * (tw.r + merlonR);
  const count = Math.max(8, Math.round(per / (WALL.merlonWidth + 0.95)));
  for (let k = 0; k < count; k++) {
    let p, n;
    if (tw.shape === 'round') {
      const a = ((k + 0.5) / count) * Math.PI * 2;
      n = new V3(Math.cos(a), 0, Math.sin(a));
      p = C.clone().addScaledVector(n, tw.r + merlonR);
    } else {
      const perFace = Math.round(count / 4);
      const f = Math.floor(k / perFace);
      if (f > 3) break;
      const kk = k - f * perFace;
      const half = tw.r + pOut;
      const s = -half + ((kk + 0.5) / perFace) * 2 * half;
      const a = tw.yaw + (f * Math.PI) / 2;
      n = new V3(Math.cos(a), 0, Math.sin(a));
      p = C.clone().addScaledVector(n, tw.r + merlonR).addScaledVector(new V3(-n.z, 0, n.x), s);
    }
    const t = new V3().crossVectors(UP, n).normalize();
    const hw = tw.shape === 'round' ? 0.78 : 0.72;
    const y0 = platY + sill, y1 = platY + mTop;
    if (k % 2 === 0) {
      stone.box(p.clone().setY((y0 + y1) / 2), t, UP, n, hw, (y1 - y0) / 2, 0.3, { skipBottom: true });
    } else {
      const sw = 0.07;
      for (const sd of [-1, 1]) {
        const q = p.clone().addScaledVector(t, sd * (hw + sw) / 2);
        stone.box(q.setY((y0 + y1) / 2), t, UP, n, (hw - sw) / 2, (y1 - y0) / 2, 0.3, { skipBottom: true });
      }
      stone.box(p.clone().setY(y0 + 0.14), t, UP, n, sw, 0.14, 0.3, { skipBottom: true });
      stone.box(p.clone().setY(y1 - 0.15), t, UP, n, sw, 0.15, 0.3);
    }
    stone.box(p.clone().setY(y1 + 0.07), t, UP, n, hw + 0.05, 0.08, 0.35);
  }

  // --- крыша ---
  const eaveOff = pOut + 0.5;
  const eaveY = platY + mTop + 0.16;
  let apexY = eaveY;
  if (opts.roof === false) {
    // без крыши: открытая боевая площадка (донжон)
  } else if (tw.shape === 'round') {
    const eaveR = tw.r + eaveOff;
    const H = eaveR * (2.1 + rnd() * 0.5);
    apexY = coneRoof(roof, C, eaveR, eaveY, H, photoRoof);
    roofUnderside(wood, C, tw, eaveR, eaveY, H);
  } else {
    const E = tw.r + eaveOff;
    const H = E * (2.0 + rnd() * 0.4);
    apexY = pyramidRoof(roof, C, tw.yaw, E, eaveY, H, photoRoof);
    roofUnderside(wood, C, tw, E, eaveY, H);
  }
  if (opts.roof !== false) {
    if (tw.flag || opts.flag) {
      // древко с флагом вместо флюгера
      const h = 4.2;
      ctx.metal.addGeometry(new THREE.CylinderGeometry(0.05, 0.08, h, 8), new THREE.Matrix4().makeTranslation(C.x, apexY - 0.3 + h / 2, C.z));
      ctx.gold.addGeometry(new THREE.SphereGeometry(0.12, 12, 8), new THREE.Matrix4().makeTranslation(C.x, apexY - 0.3 + h + 0.1, C.z));
      vanes.push(createFlag(scene, C.clone().setY(apexY - 0.3 + h - 0.1), undefined, { size: 2.4, field: tw.flagColor }));
    } else vanes.push(weathervane(ctx, C.clone().setY(apexY - 0.3), tw.id));
  }

  // --- бойницы на нескольких ярусах (обращены наружу) ---
  const out = outDir.clone();
  const gIn = terrain.heightAt(tw.node.x - out.x * 3, tw.node.z - out.z * 3);
  const wallDirs = opts.wallDirs ?? neighborDirs(walls, tw);
  const tiers = [walkY - 3.8, walkY + 1.6, walkY + 4.4].filter((y) => y < platY - 1.2 && y > gIn + 1.5);
  if (opts.slits !== false) tiers.forEach((y, ti) => {
    const nSl = tw.shape === 'round' ? 5 : 3;
    for (let k = 0; k < nSl; k++) {
      const ang = Math.atan2(out.z, out.x) + ((k - (nSl - 1) / 2) / nSl) * Math.PI * 1.25 + (ti % 2) * 0.25;
      const dir = new V3(Math.cos(ang), 0, Math.sin(ang));
      if (wallDirs.some((d) => d.dot(dir) > 0.85)) continue; // здесь примыкает стена
      const sp = surfacePoint(tw, dir);
      const bse = terrain.heightAt(sp.p.x + sp.n.x * 2, sp.p.z + sp.n.z * 2);
      if (y < bse + 2.2) continue;
      const pp = sp.p.clone().addScaledVector(sp.n, tw.shape === 'round' ? 0 : 0);
      arrowSlit(stone, dark, pp, sp.n, y, (k + ti) % 2 === 0);
    }
  });

  // --- двери: со стены (на уровне боевого хода) и со двора ---
  for (const d of opts.walkDoors === false ? [] : wallDirs) {
    const hit = rayToSurface(tw, new V3(tw.node.x, 0, tw.node.z), d);
    if (!hit) continue;
    const toInside = out.clone().negate();
    const pos = hit.p.clone().addScaledVector(toInside, 0.45);
    const sp = surfacePoint(tw, pos.clone().sub(C).setY(0).normalize());
    door(stone, wood, metal, sp.p, sp.n, walkY + 0.12, 1.0, 2.15);
  }
  const inDir = out.clone().negate();
  if (opts.groundDoor !== false) {
    const spIn = surfacePoint(tw, inDir);
    const gDoor = terrain.heightAt(spIn.p.x + spIn.n.x * 0.8, spIn.p.z + spIn.n.z * 0.8);
    door(stone, wood, metal, spIn.p, spIn.n, gDoor + 0.05, 1.2, 2.5);
  }

  // --- окно со ставнями (жилой ярус, со стороны двора) ---
  if (opts.window !== false) {
    const wAng = Math.atan2(inDir.z, inDir.x) + (rnd() > 0.5 ? 0.55 : -0.55);
    const spW = surfacePoint(tw, new V3(Math.cos(wAng), 0, Math.sin(wAng)));
    windowWithShutters(stone, wood, dark, metal, spW.p, spW.n, Math.min(platY - 2.2, walkY + 3.4));
  }
  return { platY, walkY, pOut, eaveY, apexY };
}

export function createTowers(scene, terrain, walls) {
  const ctx = makeTowerContext(scene, terrain, walls);
  for (const tw of TOWERS) buildTower(ctx, tw);
  const update = finishTowerContext(ctx, 'towers');
  return { update };
}

// Направления от узла башни вдоль примыкающих стен
function neighborDirs(walls, tw) {
  const P = walls.points;
  let bi = 0, bd = Infinity;
  P.forEach((p, i) => { const d = Math.hypot(p.x - tw.node.x, p.z - tw.node.z); if (d < bd) { bd = d; bi = i; } });
  const out = [];
  for (const j of [bi - 1, bi + 1]) {
    if (j < 0 || j >= P.length) continue;
    out.push(new V3(P[j].x - P[bi].x, 0, P[j].z - P[bi].z).normalize());
  }
  return out;
}

// Где луч из узла вдоль стены выходит из башни
function rayToSurface(tw, origin, dir) {
  for (let s = 0; s < 12; s += 0.05) {
    const p = origin.clone().addScaledVector(dir, s);
    const dx = p.x - tw.x, dz = p.z - tw.z;
    let inside;
    if (tw.shape === 'round') inside = Math.hypot(dx, dz) < tw.r;
    else {
      const c = Math.cos(tw.yaw), si = Math.sin(tw.yaw);
      inside = Math.abs(dx * c + dz * si) < tw.r && Math.abs(-dx * si + dz * c) < tw.r;
    }
    if (!inside) return { p, s };
  }
  return null;
}
