// Хозяйственная жизнь двора: рынок у ворот, лошади у коновязи, свинарник,
// поленница и котёл у кухни, оружейная стойка у казарм, ульи и голубятня у
// огорода, верёвка с бельём, собаки, телега с сеном и новые люди.
// Всё собирается в общие построители деталей двора — новых вызовов отрисовки
// почти не добавляется (один объект на материал), поэтому FPS не проседает.
import * as THREE from 'three';
import { BUILDINGS, WELL } from './layout.js';
import { Frame } from './courtyard.js';
import { wattleFence } from './village.js';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);

// Места на плане двора (м). Двор — примерно круг радиусом 45 м, ворота на юге (+Z).
export const YARD = {
  // рыночные прилавки вдоль дороги от ворот к колодцу: x, z, поворот (куда смотрит прилавок), товар
  stalls: [
    { x: -6.8, z: 11.0, yaw: Math.PI / 2, goods: 'bread', cloth: [0xb02a22, 0xe8dcc0] },
    { x: -6.8, z: 15.4, yaw: Math.PI / 2, goods: 'pots', cloth: [0x2a4a8a, 0xe8dcc0] },
    { x: -6.8, z: 19.6, yaw: Math.PI / 2, goods: 'veg', cloth: [0x3a6a2a, 0xe0d4a0] },
    { x: 5.2, z: 9.2, yaw: -Math.PI / 2, goods: 'cloth', cloth: [0x8a2a6a, 0xe8dcc0] },
    { x: 12.4, z: 12.2, yaw: -Math.PI / 2 - 0.35, goods: 'fish', cloth: [0xc08a20, 0x6a3a1a] },
  ],
  pigpen: { x: -25, z: 1.5, w: 4.4, d: 3.2 },
  laundry: { a: { x: 13.2, z: 4.6 }, b: { x: 17.6, z: 7.4 } },
  hives: { x: -35.5, z: -8.4 },
  dovecote: { x: -30.2, z: -7.2 },
  dogs: [{ x: 3.2, z: 12.8, yaw: 2.2 }, { x: 16.5, z: 0.5, yaw: -0.6, lie: true }],
};

// --- матрица: позиция, поворот вокруг вертикали, масштаб (+ наклоны) ---
function M(x, y, z, yaw = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, yaw, rz, 'YXZ'));
  return new THREE.Matrix4().compose(new V3(x, y, z), q, new V3(sx, sy, sz));
}
// локальная матрица относительно «корня» объекта
const L = (root, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
  root.clone().multiply(new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new V3(sx, sy, sz)));

// Мешок: округлое дно, перехваченная верёвкой горловина
export const SACK = (() => {
  const pts = [[0.0, 0], [0.2, 0.02], [0.25, 0.12], [0.24, 0.32], [0.18, 0.46], [0.08, 0.52], [0.06, 0.56], [0.1, 0.62], [0.0, 0.64]].map(([a, b]) => new THREE.Vector2(a, b));
  const g = new THREE.LatheGeometry(pts, 12);
  g.scale(1, 1, 0.8);
  return g;
})();
const G = {
  sph: new THREE.SphereGeometry(1, 10, 7),
  sphLo: new THREE.SphereGeometry(1, 7, 5),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  cylLo: new THREE.CylinderGeometry(1, 1, 1, 6),
  cone: new THREE.ConeGeometry(1, 1, 8),
  box: new THREE.BoxGeometry(1, 1, 1),
  bowl: new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
};

// ---------------------------------------------------------------------------
// Рыночный прилавок: стол, стойки, полосатый навес, товар
function stall(B, terrain, s, rnd, people) {
  const { wood, colorB } = B;
  const X = new V3(Math.cos(s.yaw), 0, -Math.sin(s.yaw)); // вдоль прилавка
  const N = new V3(Math.sin(s.yaw), 0, Math.cos(s.yaw)); // к покупателю
  const f = new Frame({ x: s.x, z: s.z, ax: X.x, az: X.z, nx: N.x, nz: N.z });
  const g = terrain.heightAt(s.x, s.z);
  const hw = 1.25, hd = 0.5;
  // столешница и ножки
  wood.box(f.p(0, g + 0.86, 0), X, UP, N, hw, 0.04, hd, { grain: true });
  wood.box(f.p(0, g + 0.72, hd - 0.02), X, UP, N, hw, 0.1, 0.02, { grain: true }); // передняя доска
  for (const [lx, lz] of [[-hw + 0.08, -hd + 0.08], [hw - 0.08, -hd + 0.08], [-hw + 0.08, hd - 0.08], [hw - 0.08, hd - 0.08]])
    wood.box(f.p(lx, g + 0.42, lz), UP, X, N, 0.42, 0.04, 0.04, { grain: true });
  // стойки навеса: задние выше передних
  const backY = 2.35, frontY = 1.95;
  for (const sx of [-1, 1]) {
    wood.box(f.p(sx * (hw + 0.05), g + backY / 2, -hd - 0.35), UP, X, N, backY / 2, 0.045, 0.045, { grain: true });
    wood.box(f.p(sx * (hw + 0.05), g + frontY / 2, hd + 0.55), UP, X, N, frontY / 2, 0.045, 0.045, { grain: true });
  }
  // полосатый навес — полосы из тонких брусков двух цветов
  const p0 = f.p(0, g + backY, -hd - 0.35), p1 = f.p(0, g + frontY, hd + 0.55);
  const along = p1.clone().sub(p0);
  const len = along.length();
  along.normalize();
  const nrm = new V3().crossVectors(X, along).normalize();
  const mid = p0.clone().add(p1).multiplyScalar(0.5);
  const yawM = Math.atan2(along.x, along.z);
  const pitch = Math.asin(-along.y);
  const nStripes = 9;
  for (let k = 0; k < nStripes; k++) {
    const t = (k + 0.5) / nStripes - 0.5;
    const c = mid.clone().addScaledVector(X, t * (hw * 2 + 0.3));
    colorB.add(G.box, M(c.x, c.y, c.z, yawM, (hw * 2 + 0.3) / nStripes + 0.005, 0.025, len + 0.2, pitch), s.cloth[k % 2]);
  }
  // фестоны по передней кромке
  for (let k = 0; k < nStripes; k++) {
    const t = (k + 0.5) / nStripes - 0.5;
    const c = p1.clone().addScaledVector(X, t * (hw * 2 + 0.3)).addScaledVector(along, 0.1).addScaledVector(UP, -0.12);
    colorB.add(G.box, M(c.x, c.y, c.z, yawM, (hw * 2 + 0.3) / nStripes - 0.02, 0.22, 0.02), s.cloth[k % 2]);
  }
  void nrm;
  // товар на столе
  const top = g + 0.9;
  const put = (lx, lz) => f.p(lx, top, lz);
  const yawF = Math.atan2(X.x, X.z);
  if (s.goods === 'bread') {
    for (let i = 0; i < 14; i++) {
      const p = put(-1.05 + (i % 7) * 0.35, -0.2 + Math.floor(i / 7) * 0.32);
      colorB.add(G.sph, M(p.x, p.y + 0.06, p.z, yawF + rnd(), 0.15, 0.08, 0.1), rnd() < 0.5 ? 0xb07a3a : 0x9a6428);
    }
    // корзины с хлебом на земле
    for (const lx of [-0.7, 0.6]) {
      const p = f.p(lx, g, hd + 0.9);
      colorB.add(G.cyl, M(p.x, g + 0.17, p.z, 0, 0.26, 0.34, 0.26), 0x8a6a3a);
      for (let i = 0; i < 4; i++) colorB.add(G.sph, M(p.x + (rnd() - 0.5) * 0.25, g + 0.38, p.z + (rnd() - 0.5) * 0.25, rnd() * 3, 0.13, 0.07, 0.09), 0xb07a3a);
    }
  } else if (s.goods === 'pots') {
    for (let i = 0; i < 9; i++) {
      const p = put(-1.0 + (i % 5) * 0.5, -0.18 + Math.floor(i / 5) * 0.38);
      const h = 0.18 + rnd() * 0.18, r = 0.1 + rnd() * 0.07;
      const col = [0xa0522d, 0x8a4a2a, 0xb86a3a, 0x6a5a4a][Math.floor(rnd() * 4)];
      colorB.add(G.sph, M(p.x, p.y + h * 0.55, p.z, 0, r * 1.2, h * 0.6, r * 1.2), col);
      colorB.add(G.cyl, M(p.x, p.y + h * 1.05, p.z, 0, r * 0.7, h * 0.25, r * 0.7), col);
    }
    for (let i = 0; i < 3; i++) { // большие корчаги на земле
      const p = f.p(-0.9 + i * 0.8, g, hd + 0.75 + rnd() * 0.2);
      colorB.add(G.sph, M(p.x, g + 0.24, p.z, 0, 0.19, 0.24, 0.19), 0x8a4a2a);
      colorB.add(G.cyl, M(p.x, g + 0.5, p.z, 0, 0.1, 0.08, 0.1), 0x8a4a2a);
    }
  } else if (s.goods === 'veg') {
    for (let i = 0; i < 4; i++) {
      const p = put(-0.95 + i * 0.63, 0);
      colorB.add(G.cyl, M(p.x, p.y + 0.08, p.z, 0, 0.26, 0.16, 0.26), 0x7a5a30);
      const col = [0x3f7a24, 0xa02a1a, 0xc8a030, 0x6a8a2a][i];
      for (let k = 0; k < 7; k++) colorB.add(G.sphLo, M(p.x + (rnd() - 0.5) * 0.3, p.y + 0.2 + rnd() * 0.05, p.z + (rnd() - 0.5) * 0.3, 0, 0.08, 0.08, 0.08), col);
    }
    for (let i = 0; i < 2; i++) { // мешки
      const p = f.p(-0.8 + i * 1.5, g, hd + 0.8);
      colorB.add(SACK, M(p.x, g, p.z, rnd() * 3), 0x9a8660);
    }
  } else if (s.goods === 'cloth') {
    const cols = [0x8a2a2a, 0x2a4a8a, 0xd8c890, 0x3a6a3a, 0x6a3a7a, 0xe8e0d0];
    for (let i = 0; i < 6; i++) {
      const p = put(-1.0 + i * 0.4, 0);
      colorB.add(G.cyl, M(p.x, p.y + 0.1, p.z, yawF, 0.1, 0.8, 0.1, Math.PI / 2), cols[i]);
    }
    // свисающие отрезы ткани с перекладины
    for (let i = 0; i < 4; i++) {
      const c = f.p(-0.9 + i * 0.6, g + frontY - 0.55, hd + 0.5);
      colorB.add(G.box, M(c.x, c.y, c.z, yawF + Math.PI / 2, 0.02, 0.8, 0.45), cols[(i + 2) % 6]);
    }
  } else if (s.goods === 'fish') {
    for (let i = 0; i < 10; i++) {
      const p = put(-1.0 + (i % 5) * 0.48, -0.15 + Math.floor(i / 5) * 0.32);
      colorB.add(G.sph, M(p.x, p.y + 0.03, p.z, yawF + (rnd() - 0.5) * 0.4, 0.05, 0.035, 0.2), 0x8a969a);
    }
    for (const lx of [-0.6, 0.5]) { // бочки с рыбой
      const p = f.p(lx, g, hd + 0.8);
      colorB.add(G.cyl, M(p.x, g + 0.3, p.z, 0, 0.28, 0.6, 0.28), 0x6a4a2a);
      colorB.add(G.cyl, M(p.x, g + 0.61, p.z, 0, 0.25, 0.02, 0.25), 0x7a868a);
    }
  }
  // торговец за прилавком, покупатели перед ним
  const back = f.p(0.2, 0, -hd - 0.6);
  people.push({ x: back.x, y: terrain.heightAt(back.x, back.z), z: back.z, yaw: Math.atan2(N.x, N.z), role: s.goods === 'bread' || s.goods === 'veg' ? 'woman' : 'merchant' });
  const nb = 1 + Math.floor(rnd() * 2);
  for (let k = 0; k < nb; k++) {
    const q = f.p((k - 0.5) * 1.1 + (rnd() - 0.5) * 0.4, 0, hd + 1.2 + rnd() * 0.4);
    const roles = ['townswoman', 'peasant', 'servant', 'townswoman', 'child', 'noble'];
    people.push({ x: q.x, y: terrain.heightAt(q.x, q.z), z: q.z, yaw: Math.atan2(-N.x, -N.z) + (rnd() - 0.5) * 0.6, role: roles[Math.floor(rnd() * roles.length)] });
  }
}

// ---------------------------------------------------------------------------
// Лошадь: бочкообразное туловище, грудь и круп, изогнутая шея, голова с
// мордой, ноги с суставами и копытами, грива, хвост, седло и уздечка
const HG = {
  barrel: (() => { const g = new THREE.CapsuleGeometry(0.34, 0.9, 6, 14); g.rotateX(Math.PI / 2); g.scale(0.95, 1.08, 1); return g; })(),
  neck: new THREE.CylinderGeometry(0.13, 0.24, 0.78, 12).translate(0, 0.39, 0),
  head: (() => { const g = new THREE.CylinderGeometry(0.075, 0.125, 0.52, 10).translate(0, -0.26, 0); g.scale(0.85, 1, 1.15); return g; })(),
  cheek: new THREE.SphereGeometry(0.12, 10, 8),
  muzzle: new THREE.SphereGeometry(0.085, 10, 8),
  upper: new THREE.CylinderGeometry(0.1, 0.065, 0.46, 8).translate(0, -0.23, 0),
  lower: new THREE.CylinderGeometry(0.045, 0.04, 0.4, 8).translate(0, -0.2, 0),
  joint: new THREE.SphereGeometry(0.058, 8, 6),
  hoof: new THREE.CylinderGeometry(0.055, 0.07, 0.09, 10),
  ear: new THREE.ConeGeometry(0.035, 0.13, 6),
  eye: new THREE.SphereGeometry(0.02, 6, 4),
  tail: new THREE.ConeGeometry(0.07, 0.42, 8).translate(0, -0.21, 0),
};
export function horse(colorB, x, y, z, yaw, col, rnd) {
  const r = M(x, y, z, yaw);
  const dark = 0x1a1612, mane = col === 0xe8e0d0 ? 0xd8d0c0 : 0x1e1812;
  const sh = new THREE.Color(col).multiplyScalar(0.8).getHex();
  colorB.add(HG.barrel, L(r, 0, 1.25, -0.02), col); // туловище
  colorB.add(G.sph, L(r, 0, 1.3, 0.55, 0.33, 0.38, 0.34), col); // грудь
  colorB.add(G.sph, L(r, 0, 1.33, -0.6, 0.35, 0.37, 0.38), col); // круп
  colorB.add(G.sph, L(r, 0, 1.52, -0.45, 0.28, 0.12, 0.3), col); // верх крупа
  const down = rnd() < 0.5 ? 0.3 : 0;
  // шея наклонена вперёд, голова вниз
  const neck = L(r, 0, 1.45, 0.62, 0.55 + down * 0.6);
  colorB.add(HG.neck, neck, col);
  const poll = neck.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.74, 0));
  // голова смотрит вперёд-вниз (ось головы — локальная −Y, темя — локальная +Z)
  const head = poll.clone().multiply(new THREE.Matrix4().makeRotationX(-1.35 + down * 0.2));
  colorB.add(HG.cheek, head.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.08, -0.02)), col);
  colorB.add(HG.head, head, col);
  colorB.add(HG.muzzle, head.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.52, 0.01)), col === 0xe8e0d0 ? 0x9a8a80 : sh);
  for (const sd of [-1, 1]) {
    colorB.add(HG.ear, head.clone().multiply(new THREE.Matrix4().compose(new V3(sd * 0.065, 0.03, 0.1), new THREE.Quaternion().setFromEuler(new THREE.Euler(1.2, 0, sd * -0.25)), new V3(1, 1, 1))), col);
    colorB.add(HG.eye, head.clone().multiply(new THREE.Matrix4().makeTranslation(sd * 0.105, -0.13, 0.05)), dark);
  }
  // уздечка: ремни вокруг морды и за ушами, поводья
  colorB.add(new THREE.TorusGeometry(0.1, 0.012, 4, 12), head.clone().multiply(new THREE.Matrix4().compose(new V3(0, -0.38, 0.0), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new V3(1, 1, 1.2))), 0x3a2414);
  colorB.add(new THREE.TorusGeometry(0.13, 0.012, 4, 12), head.clone().multiply(new THREE.Matrix4().compose(new V3(0, -0.02, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new V3(1, 1, 1.1))), 0x3a2414);
  // грива — ряд прядей вдоль шеи
  for (let k = 0; k < 7; k++) {
    const t = k / 6;
    colorB.add(G.box, neck.clone().multiply(new THREE.Matrix4().compose(new V3(0, 0.08 + t * 0.66, -0.13 - (1 - t) * 0.08), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, 0, (k % 2 ? 0.25 : -0.25))), new V3(0.05, 0.14, 0.09))), mane);
  }
  // ноги: передние прямые, задние с изгибом в скакательном суставе
  for (const [lx, lz, hind] of [[-0.19, 0.55, 0], [0.19, 0.55, 0], [-0.19, -0.62, 1], [0.19, -0.62, 1]]) {
    colorB.curLimb = [(lx < 0) === !hind ? 0.7 : -0.7, 1.12]; // диагональные пары ног шагают вместе
    const hip = L(r, lx, 1.12, lz, hind ? -0.25 : 0.03);
    colorB.add(HG.upper, hip, col);
    const knee = hip.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.46, 0)).multiply(new THREE.Matrix4().makeRotationX(hind ? 0.3 : -0.03));
    colorB.add(HG.joint, knee, col);
    colorB.add(HG.lower, knee, col);
    const fet = knee.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.4, 0));
    colorB.add(HG.joint, fet.clone().multiply(new THREE.Matrix4().makeScale(0.85, 0.85, 0.85)), col);
    const p = new V3().setFromMatrixPosition(fet);
    colorB.add(HG.hoof, M(p.x, y + 0.045, p.z, yaw), dark);
  }
  colorB.curLimb = [0, 0];
  // хвост из двух частей
  const tr = L(r, 0, 1.45, -0.95, 0.5);
  colorB.add(new THREE.CylinderGeometry(0.05, 0.06, 0.2, 8).translate(0, -0.1, 0), tr, mane);
  colorB.add(HG.tail, tr.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.18, 0)).multiply(new THREE.Matrix4().makeRotationX(-0.45)), mane);
  colorB.add(HG.tail, tr.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.5, -0.05)).multiply(new THREE.Matrix4().makeRotationX(-0.1)).multiply(new THREE.Matrix4().makeScale(0.8, 1.2, 0.8)), mane);
  // попона, седло с лукой, стремена
  const cloth = [0x7a1c1c, 0x1d3f8a, 0x3a5a2a][Math.floor(rnd() * 3)];
  colorB.add(new THREE.CylinderGeometry(0.4, 0.4, 0.62, 16, 1, true, -Math.PI * 0.45, Math.PI * 0.9).rotateX(Math.PI / 2), L(r, 0, 1.28, 0.02, 0, 0, 0, 1.0), cloth);
  colorB.add(G.box, L(r, 0, 1.66, 0.05, 0.3, 0.05, 0.4), 0x4a2e18);
  colorB.add(G.box, L(r, 0, 1.73, 0.22, 0.2, 0.07, 0.05), 0x4a2e18);
  colorB.add(G.box, L(r, 0, 1.72, -0.13, 0.26, 0.09, 0.05), 0x4a2e18);
  for (const sd of [-1, 1]) {
    colorB.add(G.box, L(r, sd * 0.37, 1.35, 0.05, 0.015, 0.5, 0.03), 0x2a1a10);
    colorB.add(new THREE.TorusGeometry(0.05, 0.01, 4, 10), L(r, sd * 0.37, 1.06, 0.05, 1, 1, 1, 0, 0), 0x6a6a70);
  }
}

// Свинья: вытянутое туловище, пятачок, висячие уши, хвостик-завиток
function pig(colorB, x, y, z, yaw, rnd) {
  const r = M(x, y, z, yaw);
  const c = rnd() < 0.3 ? 0x5a4038 : 0xdca494;
  const sn = rnd() < 0.3 ? 0x7a5a50 : 0xc88070;
  colorB.add(new THREE.CapsuleGeometry(0.24, 0.42, 5, 12).rotateX(Math.PI / 2), L(r, 0, 0.4, 0, 1, 0.95, 1), c);
  colorB.add(G.sph, L(r, 0, 0.42, 0.42, 0.18, 0.17, 0.17), c);
  colorB.add(G.cyl, L(r, 0, 0.38, 0.6, 0.075, 0.07, 0.065, Math.PI / 2), sn);
  for (const sd of [-1, 1]) {
    colorB.add(G.sphLo, L(r, sd * 0.1, 0.54, 0.42, 0.06, 0.02, 0.08, 0.6, 0, sd * 0.3), c); // уши
    colorB.add(G.sphLo, L(r, sd * 0.08, 0.46, 0.55, 0.012, 0.012, 0.012), 0x1a1410); // глаза
  }
  for (const [lx, lz] of [[-0.12, 0.28], [0.12, 0.28], [-0.12, -0.28], [0.12, -0.28]]) {
    colorB.add(G.cylLo, L(r, lx, 0.1, lz, 0.05, 0.2, 0.05), c);
    colorB.add(G.cylLo, L(r, lx, 0.015, lz, 0.052, 0.03, 0.052), 0x3a2a22);
  }
  colorB.add(new THREE.TorusGeometry(0.035, 0.01, 4, 8, Math.PI * 1.6), L(r, 0, 0.47, -0.5, 1, 1, 1, 0, Math.PI / 2), c);
}

// Собака (стоит или лежит)
function dog(colorB, x, y, z, yaw, lie, rnd) {
  const r = M(x, y, z, yaw);
  const c = [0x8a6a3a, 0x3a2a1a, 0xc8b89a][Math.floor(rnd() * 3)];
  const h = lie ? 0.16 : 0.42;
  colorB.add(G.sph, L(r, 0, h, 0, 0.14, 0.14, 0.34), c);
  colorB.add(G.sph, L(r, 0, h + 0.14, 0.34, 0.1, 0.1, 0.12), c);
  colorB.add(G.box, L(r, 0, h + 0.1, 0.46, 0.07, 0.07, 0.12), c);
  for (const s of [-1, 1]) colorB.add(G.box, L(r, s * 0.06, h + 0.2, 0.3, 0.03, 0.09, 0.04), 0x2a1e14);
  colorB.add(G.cylLo, L(r, 0, h + 0.1, -0.4, 0.025, 0.28, 0.025, lie ? 1.5 : 0.7), c);
  if (lie) {
    for (const s of [-1, 1]) colorB.add(G.cylLo, L(r, s * 0.08, 0.05, 0.35, 0.03, 0.26, 0.03, Math.PI / 2), c);
  } else {
    for (const [lx, lz] of [[-0.08, 0.22], [0.08, 0.22], [-0.08, -0.22], [0.08, -0.22]]) colorB.add(G.cylLo, L(r, lx, 0.15, lz, 0.03, 0.32, 0.03), c);
  }
}

// ---------------------------------------------------------------------------
export function addYardLife(ctx) {
  const { terrain, wood, metal, straw, colorB, stone, people, rnd, barrels } = ctx;
  void straw;
  const B = { wood, colorB };
  const byId = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));
  const gh = (x, z) => terrain.heightAt(x, z);

  // ---- рынок ----
  for (const s of YARD.stalls) stall(B, terrain, s, rnd, people);
  // мешки между прилавками (по одному-два)
  for (const [x, z, n] of [[-7.4, 13.2, 2], [-7.6, 17.6, 1], [6.0, 11.4, 1], [11.0, 14.2, 2]]) {
    for (let k = 0; k < n; k++) colorB.add(SACK, M(x + k * 0.55, gh(x, z), z + (rnd() - 0.5) * 0.3, rnd() * 3, 1, 0.9 + rnd() * 0.2, 1), [0x9a8660, 0x8a7654, 0xa8946c][k % 3]);
  }
  // гуляющие по рынку
  for (const [x, z, yaw, role] of [[-1.5, 14, 0.4, 'townswoman'], [1.6, 17.5, 2.9, 'peasant'], [-2.8, 8.6, -2.2, 'noble'], [2.6, 6.5, 3.6, 'child']])
    people.push({ x, y: gh(x, z), z, yaw, role, pose: 'walk' });

  // ---- лошади у коновязи конюшни ----
  {
    const b = byId.stable, f = new Frame(b);
    const face = Math.atan2(-f.N.x, -f.N.z);
    const cols = [0x5a3a1e, 0x2a1e16, 0xe8e0d0];
    [-1.2, 1.3].forEach((lx, i) => {
      const p = f.p(lx, 0, b.W / 2 + 3.6);
      horse(colorB, p.x, gh(p.x, p.z), p.z, face, cols[i], rnd);
    });
    // конюх с третьей лошадью у ворот конюшни
    const h3 = f.p(-4.2, 0, b.W / 2 + 3.2);
    horse(colorB, h3.x, gh(h3.x, h3.z), h3.z, face + 1.2, cols[2], rnd);
    const gp = f.p(-3.0, 0, b.W / 2 + 4.3);
    people.push({ x: gp.x, y: gh(gp.x, gp.z), z: gp.z, yaw: face + 2.4, role: 'servant' });
    // корыто с водой и сено у коновязи
    const t = f.p(3.3, 0, b.W / 2 + 3.0);
    wood.box(new V3(t.x, gh(t.x, t.z) + 0.25, t.z), f.X, UP, f.N, 0.9, 0.25, 0.3, { grain: true });
    colorB.add(G.box, M(t.x, gh(t.x, t.z) + 0.46, t.z, Math.atan2(f.X.x, f.X.z), 0.5, 0.02, 1.6), 0x2a4a4a);
  }

  // ---- свинарник: плетень, корыто, свиньи, свинопас ----
  {
    const { x, z, w, d } = YARD.pigpen;
    const pts = [new V3(x - w / 2, 0, z - d / 2), new V3(x + w / 2, 0, z - d / 2), new V3(x + w / 2, 0, z + d / 2), new V3(x - w / 2 + 1.2, 0, z + d / 2)];
    wattleFence(wood, terrain, pts, 0.9);
    wattleFence(wood, terrain, [new V3(x - w / 2, 0, z + d / 2), new V3(x - w / 2, 0, z - d / 2)], 0.9);
    wood.box(new V3(x + 1, gh(x + 1, z - 1) + 0.15, z - 1), new V3(1, 0, 0), UP, new V3(0, 0, 1), 0.7, 0.15, 0.22, { grain: true });
    for (let k = 0; k < 4; k++) {
      const px = x + (rnd() - 0.5) * (w - 1.2), pz = z + (rnd() - 0.5) * (d - 1.2);
      pig(colorB, px, gh(px, pz), pz, rnd() * 6.28, rnd);
    }
    // грязь в загоне
    colorB.add(G.box, M(x, gh(x, z) + 0.01, z, 0, w - 0.3, 0.02, d - 0.3), 0x3a2a1a);
    people.push({ x: x - w / 2 - 0.8, y: gh(x - w / 2 - 0.8, z + 1.5), z: z + 1.5, yaw: 1.4, role: 'peasant' });
  }

  // ---- у кухни: поленница, колода с топором, котёл на треноге ----
  {
    const b = byId.kitchen, f = new Frame(b);
    const log = new THREE.CylinderGeometry(0.11, 0.11, 0.9, 7).rotateZ(Math.PI / 2);
    for (let r = 0; r < 4; r++) for (let k = 0; k < 9 - r; k++) {
      const p = f.p(-b.L / 2 - 1.0, 0, -1.6 + k * 0.23 + r * 0.11);
      wood.addGeometry(log, new THREE.Matrix4().makeBasis(f.N, UP, f.X).setPosition(p.x, gh(p.x, p.z) + 0.11 + r * 0.2, p.z));
    }
    const blk = f.p(-b.L / 2 + 0.6, 0, b.W / 2 + 2.0);
    const bg = gh(blk.x, blk.z);
    wood.addGeometry(new THREE.CylinderGeometry(0.3, 0.33, 0.55, 10), M(blk.x, bg + 0.27, blk.z));
    wood.addGeometry(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 5), M(blk.x + 0.1, bg + 0.75, blk.z, 0, 1, 1, 1, 0.5));
    metal.addGeometry(new THREE.BoxGeometry(0.03, 0.14, 0.18), M(blk.x + 0.1, bg + 0.58, blk.z - 0.05, 0, 1, 1, 1, 0.5));
    // поленья вокруг колоды
    for (let k = 0; k < 6; k++) {
      const a = rnd() * 6.28;
      wood.addGeometry(new THREE.CylinderGeometry(0.07, 0.08, 0.4, 5), M(blk.x + Math.cos(a) * 0.8, bg + 0.07, blk.z + Math.sin(a) * 0.8, a, 1, 1, 1, Math.PI / 2));
    }
    people.push({ x: blk.x - 0.9, y: bg, z: blk.z + 0.3, yaw: 1.3, role: 'servant', pose: 'work' });
    // котёл на треноге над кострищем
    const c = f.p(b.L / 2 - 1.0, 0, b.W / 2 + 2.6);
    const cg = gh(c.x, c.z);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const foot = new V3(c.x + Math.cos(a) * 0.75, cg, c.z + Math.sin(a) * 0.75);
      const topP = new V3(c.x, cg + 1.5, c.z);
      const d = topP.clone().sub(foot);
      const len = d.length();
      const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize());
      wood.addGeometry(new THREE.CylinderGeometry(0.035, 0.04, len, 5), new THREE.Matrix4().compose(foot.clone().addScaledVector(d, len / 2), q, new V3(1, 1, 1)));
    }
    metal.addGeometry(new THREE.CylinderGeometry(0.008, 0.008, 0.7, 4), M(c.x, cg + 1.15, c.z));
    metal.addGeometry(G.bowl, M(c.x, cg + 0.8, c.z, 0, 0.36, 0.32, 0.36));
    colorB.add(G.cylLo, M(c.x, cg + 0.79, c.z, 0, 0.33, 0.01, 0.33), 0x5a4a2a); // похлёбка
    for (let k = 0; k < 9; k++) { // камни очага
      const a = (k / 9) * Math.PI * 2;
      stone.addGeometry(new THREE.DodecahedronGeometry(0.13, 0), M(c.x + Math.cos(a) * 0.5, cg + 0.06, c.z + Math.sin(a) * 0.5, a));
    }
    colorB.add(G.cylLo, M(c.x, cg + 0.03, c.z, 0, 0.38, 0.03, 0.38), 0x2a2622); // зола
    const cook = f.p(b.L / 2 - 2.0, 0, b.W / 2 + 2.8);
    people.push({ x: cook.x, y: gh(cook.x, cook.z), z: cook.z, yaw: Math.atan2(c.x - cook.x, c.z - cook.z), role: 'woman' });
  }

  // ---- у казарм: оружейная стойка с копьями и щитами ----
  {
    const b = byId.barracks, f = new Frame(b);
    const c = f.p(-b.L / 2 + 1.6, 0, b.W / 2 + 1.0);
    const g = gh(c.x, c.z);
    for (const s of [-1, 1]) wood.box(f.p(-b.L / 2 + 1.6 + s * 1.1, g + 0.8, b.W / 2 + 1.0), UP, f.X, f.N, 0.8, 0.05, 0.05, { grain: true });
    wood.box(new V3(c.x, g + 1.45, c.z), f.X, UP, f.N, 1.15, 0.04, 0.05, { grain: true });
    wood.box(new V3(c.x, g + 0.35, c.z), f.X, UP, f.N, 1.15, 0.04, 0.05, { grain: true });
    const tilt = new THREE.Quaternion().setFromAxisAngle(f.X, -0.12);
    for (let k = 0; k < 7; k++) {
      const p = f.p(-b.L / 2 + 0.7 + k * 0.3, 0, b.W / 2 + 0.95);
      wood.addGeometry(new THREE.CylinderGeometry(0.02, 0.02, 2.6, 5), new THREE.Matrix4().compose(new V3(p.x, g + 1.3, p.z), tilt, new V3(1, 1, 1)));
      const tip = new V3(p.x, g + 2.62, p.z).addScaledVector(f.N, 0.16);
      metal.addGeometry(new THREE.ConeGeometry(0.035, 0.22, 5), new THREE.Matrix4().compose(tip, tilt, new V3(1, 1, 1)));
    }
    // щиты у стены казармы
    for (let k = 0; k < 4; k++) {
      const p = f.p(1.5 + k * 0.8, 0, b.W / 2 + 0.2);
      const yaw = Math.atan2(f.N.x, f.N.z);
      colorB.add(G.cyl, M(p.x, gh(p.x, p.z) + 0.4, p.z, yaw, 0.36, 0.04, 0.36, Math.PI / 2 - 0.2), k % 2 ? 0x7a1c1c : 0x1d3f8a);
      colorB.add(G.cylLo, M(p.x, gh(p.x, p.z) + 0.4, p.z, yaw, 0.08, 0.06, 0.08, Math.PI / 2 - 0.2), 0x9a9ea4);
    }
    // бочки с водой и точильный круг
    barrels.push(f.p(b.L / 2 - 0.6, 0, b.W / 2 + 0.7), f.p(b.L / 2 - 1.3, 0, b.W / 2 + 0.6));
    const gw = f.p(-b.L / 2 - 0.8, 0, b.W / 2 + 2.2);
    const gg = gh(gw.x, gw.z);
    stone.addGeometry(new THREE.CylinderGeometry(0.35, 0.35, 0.12, 14), M(gw.x, gg + 0.75, gw.z, Math.atan2(f.X.x, f.X.z), 1, 1, 1, 0, Math.PI / 2));
    for (const s of [-1, 1]) wood.box(new V3(gw.x, gg + 0.4, gw.z).addScaledVector(f.X, s * 0.12), UP, f.X, f.N, 0.4, 0.03, 0.2, { grain: true });
    people.push({ x: gw.x + f.N.x * 0.7, y: gg, z: gw.z + f.N.z * 0.7, yaw: Math.atan2(-f.N.x, -f.N.z), role: 'guard', pose: 'work' });
  }

  // ---- ульи и голубятня у огорода ----
  {
    const { x, z } = YARD.hives;
    const g = gh(x, z);
    wood.box(new V3(x, g + 0.35, z), new V3(1, 0, 0), UP, new V3(0, 0, 1), 1.5, 0.04, 0.3, { grain: true });
    for (const s of [-1, 1]) wood.box(new V3(x + s * 1.3, g + 0.17, z), UP, new V3(1, 0, 0), new V3(0, 0, 1), 0.17, 0.05, 0.25, { grain: true });
    for (let k = 0; k < 4; k++) {
      const hx = x - 1.1 + k * 0.73;
      straw.addGeometry(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2 + 0.3), M(hx, g + 0.42, z, rnd() * 6, 1, 1.35, 1));
    }
    const d = YARD.dovecote;
    const dg = gh(d.x, d.z);
    wood.box(new V3(d.x, dg + 1.6, d.z), UP, new V3(1, 0, 0), new V3(0, 0, 1), 1.6, 0.08, 0.08, { grain: true });
    wood.box(new V3(d.x, dg + 3.45, d.z), new V3(1, 0, 0), UP, new V3(0, 0, 1), 0.5, 0.3, 0.5, { grain: true });
    wood.addGeometry(new THREE.ConeGeometry(0.72, 0.7, 4).rotateY(Math.PI / 4), M(d.x, dg + 4.1, d.z));
    for (let k = 0; k < 4; k++) { // летки и голуби
      const a = (k / 4) * Math.PI * 2;
      colorB.add(G.box, M(d.x + Math.cos(a) * 0.51, dg + 3.45, d.z + Math.sin(a) * 0.51, a, 0.02, 0.14, 0.12), 0x0e0c0a);
      colorB.add(G.sphLo, M(d.x + Math.cos(a) * 0.62, dg + 3.23, d.z + Math.sin(a) * 0.62, a, 0.06, 0.06, 0.1), 0xb8bcc4);
    }
    people.push({ x: x + 0.3, y: gh(x + 0.3, z + 1.1), z: z + 1.1, yaw: Math.PI, role: 'priest' }); // монах-пасечник
  }

  // ---- верёвка с бельём и прачка ----
  {
    const { a, b } = YARD.laundry;
    const ga = gh(a.x, a.z), gb = gh(b.x, b.z);
    for (const [p, g] of [[a, ga], [b, gb]]) wood.box(new V3(p.x, g + 1.0, p.z), UP, new V3(1, 0, 0), new V3(0, 0, 1), 1.0, 0.04, 0.04, { grain: true });
    const A = new V3(a.x, ga + 1.9, a.z), Bp = new V3(b.x, gb + 1.9, b.z);
    const d = Bp.clone().sub(A);
    const len = d.length();
    const yaw = Math.atan2(d.x, d.z);
    wood.addGeometry(new THREE.CylinderGeometry(0.008, 0.008, len, 4), new THREE.Matrix4().compose(A.clone().addScaledVector(d, 0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize()), new V3(1, 1, 1)));
    const cols = [0xece6d8, 0x8aa0c0, 0xd8c890, 0xece6d8, 0xa0503a, 0xe0dccc];
    for (let k = 0; k < 6; k++) {
      const t = (k + 0.6) / 6.6;
      const p = A.clone().addScaledVector(d, t);
      const sag = Math.sin(t * Math.PI) * 0.15;
      const h = 0.45 + rnd() * 0.35;
      colorB.add(G.box, M(p.x, p.y - sag - h / 2, p.z, yaw, 0.02, h, len / 6.6 - 0.08), cols[k]);
    }
    colorB.add(G.cyl, M(a.x + 0.9, gh(a.x + 0.9, a.z + 0.8) + 0.2, a.z + 0.8, 0, 0.35, 0.36, 0.35), 0x7a5a30); // корзина
    people.push({ x: a.x + 1.4, y: gh(a.x + 1.4, a.z + 1.3), z: a.z + 1.3, yaw: yaw - Math.PI / 2, role: 'woman', pose: 'work' });
  }

  // ---- у кузницы: подковка лошади, корыто для закалки, подковы, прутья железа, подмастерье у мехов ----
  {
    const b = byId.forge, f = new Frame(b);
    const along = Math.atan2(f.X.x, f.X.z);
    const hp = f.p(2.6, 0, b.W / 2 + 2.7);
    horse(colorB, hp.x, gh(hp.x, hp.z), hp.z, along + Math.PI, 0x6a4424, rnd);
    const fp = f.p(1.7, 0, b.W / 2 + 1.9);
    people.push({ x: fp.x, y: gh(fp.x, fp.z), z: fp.z, yaw: Math.atan2(hp.x - fp.x, hp.z - fp.z), role: 'smith', pose: 'work' });
    // корыто с водой для закалки
    const tq = f.p(-2.3, 0, b.W / 2 + 0.9);
    wood.box(new V3(tq.x, gh(tq.x, tq.z) + 0.3, tq.z), f.X, UP, f.N, 0.55, 0.3, 0.28, { grain: true });
    colorB.add(G.box, M(tq.x, gh(tq.x, tq.z) + 0.58, tq.z, along, 0.46, 0.02, 1.0), 0x1e3032);
    // доска с подковами у входа
    const hb = f.p(0.3, 0, b.W / 2 + 0.25);
    const hg = gh(hb.x, hb.z);
    wood.box(new V3(hb.x, hg + 1.3, hb.z), f.X, UP, f.N, 0.5, 0.25, 0.025, { grain: true });
    for (let k = 0; k < 6; k++) {
      const p = f.p(0.3 - 0.36 + (k % 3) * 0.36, 0, b.W / 2 + 0.29);
      metal.addGeometry(new THREE.TorusGeometry(0.06, 0.013, 4, 10, Math.PI * 1.3), M(p.x, hg + 1.42 - Math.floor(k / 3) * 0.2, p.z, along + Math.PI / 2, 1, 1, 1, 0, Math.PI * 1.15));
    }
    // прутья железа
    const ib = f.p(-b.L / 2 + 0.6, 0, b.W / 2 + 1.3);
    for (let k = 0; k < 8; k++) metal.box(new V3(ib.x, gh(ib.x, ib.z) + 0.05 + Math.floor(k / 4) * 0.05, ib.z).addScaledVector(f.N, (k % 4) * 0.06), f.X, UP, f.N, 0.7, 0.02, 0.02);
    // подмастерье у мехов
    const ap = f.p(0.4, 0, -b.W / 2 + 1.65);
    people.push({ x: ap.x, y: gh(ap.x, ap.z) + 0.1, z: ap.z, yaw: Math.atan2(-f.N.x, -f.N.z), role: 'servant', pose: 'work' });
  }

  // ---- собаки ----
  for (const d of YARD.dogs) dog(colorB, d.x, gh(d.x, d.z), d.z, d.yaw, !!d.lie, rnd);

  // ---- ящики и бочки у склада и амбара ----
  for (const id of ['store', 'granary']) {
    const b = byId[id], f = new Frame(b);
    for (let k = 0; k < 3; k++) barrels.push(f.p(-b.L / 2 + 0.6 + k * 0.7, 0, b.W / 2 + 0.6));
  }
  void WELL;
}

// Что нельзя засаживать травой (загон, прилавки, очаг)
export function yardExclude(x, z) {
  for (const s of YARD.stalls) if (Math.hypot(x - s.x, z - s.z) < 1.8) return 0.8;
  const p = YARD.pigpen;
  if (Math.abs(x - p.x) < p.w / 2 && Math.abs(z - p.z) < p.d / 2) return 1;
  return 0;
}
