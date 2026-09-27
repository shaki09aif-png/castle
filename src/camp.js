// Осадный лагерь за рекой (переделан): шатры из настоящей парусины (текстура
// льна со швами, фестоны-«зубцы» по кромке, растяжки с колышками), улицы из
// рядов палаток, коновязь, обоз, котлы на треногах, частокол с проходом,
// щиты-павезы перед машиной и противовесный требушет по образцу XIII века:
// станина из лежней и стоек с раскосами, ось на железе, сужающийся рычаг
// с оковкой, подвесной ящик-противовес с камнями, праща в жёлобе, ворот.
import * as THREE from 'three';
import { GeoBuilder } from './walls.js';
import { ColorBuilder } from './people.js';
import { pbrMaterial } from './textures.js';
import { horse } from './yard.js';
import { cart, Smoke } from './courtyard.js';
import { M, GEO, fire } from './extras.js';
import { OBSTACLES } from './walkable.js';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);

// ---------------------------------------------------------------------------
// Построитель ткани: позиции, нормали, UV в метрах, цвет вершин (оттенок ткани)
// ---------------------------------------------------------------------------
class ClothB {
  constructor(tile) { this.tile = tile; this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.idx = []; }
  v(p, n, u, v, c) {
    this.pos.push(p.x, p.y, p.z); this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u / this.tile, v / this.tile); this.col.push(c[0], c[1], c[2]);
    return this.pos.length / 3 - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}
const rgbOf = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
// ткань внизу забрызгана грязью, к верху чуть светлее (выгорает на солнце)
const soil = (c, yLocal) => {
  const k = 0.62 + 0.38 * Math.min(1, Math.max(0, yLocal / 0.55));
  const top = 1 + Math.min(0.06, Math.max(0, (yLocal - 2) * 0.02));
  return [c[0] * k * top, c[1] * k * top * 0.98, c[2] * k * top * 0.95];
};

// Поверхность вращения: профиль [[r, y], ...] от низа к верху, n сегментов.
// color(j, y) — цвет полотнища j; skip(j) — пропустить сегмент (дверь).
function revolve(B, c, prof, n, { color, skip = null, a0 = 0 }) {
  const len = [0];
  for (let i = 1; i < prof.length; i++) len.push(len[i - 1] + Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]));
  for (let j = 0; j < n; j++) {
    if (skip && skip(j)) continue;
    const aa = [a0 + (j / n) * Math.PI * 2, a0 + ((j + 1) / n) * Math.PI * 2];
    for (let i = 0; i < prof.length - 1; i++) {
      const [r0, y0] = prof[i], [r1, y1] = prof[i + 1];
      const dr = r1 - r0, dy = y1 - y0, l = Math.hypot(dr, dy) || 1;
      const ids = [];
      for (const [r, y, vv] of [[r0, y0, len[i]], [r1, y1, len[i + 1]]]) {
        for (const [k, a] of aa.entries()) {
          const ca = Math.cos(a), sa = Math.sin(a);
          const nn = new V3(ca * dy / l, -dr / l, sa * dy / l);
          // швы полотнищ сходятся к макушке: u — дуга по окружности
          const u = (k ? 1 : 0) * (Math.PI * 2 / n) * Math.max(r, 0.3) + j * 0.37;
          ids.push(B.v(new V3(c.x + ca * r, c.y + y, c.z + sa * r), nn, u, vv, soil(color(j, y), y)));
        }
      }
      B.quad(ids[0], ids[2], ids[3], ids[1]);
    }
  }
}

// фестоны («зубцы») по кромке навеса: полоса и треугольные язычки вниз
function valance(B, c, r, y, h, n, col, a0 = 0) {
  for (let j = 0; j < n; j++) {
    const a = a0 + (j / n) * Math.PI * 2, b = a0 + ((j + 1) / n) * Math.PI * 2, m = (a + b) / 2;
    const P = (ang, yy) => new V3(c.x + Math.cos(ang) * r, c.y + yy, c.z + Math.sin(ang) * r);
    const N = (ang) => new V3(Math.cos(ang), 0, Math.sin(ang));
    const w = (Math.PI * 2 / n) * r;
    const cc = rgbOf(col);
    const i0 = B.v(P(a, y), N(a), 0, h, cc), i1 = B.v(P(b, y), N(b), w, h, cc);
    const i2 = B.v(P(b, y - h * 0.55), N(b), w, h * 0.45, cc), i3 = B.v(P(a, y - h * 0.55), N(a), 0, h * 0.45, cc);
    B.quad(i3, i2, i1, i0);
    const i4 = B.v(P(m, y - h), N(m), w / 2, 0, cc);
    B.tri(i3, i4, i2);
  }
}

// Набор для шатров: круглый шатёр с фестонами и двускатная палатка
function tentKit({ terrain, wood, metal, colorB }, cloth, face) {
  const gh = (x, z) => terrain.heightAt(x, z);
  const fw = new V3(Math.sin(face), 0, Math.cos(face)), rt = new V3(Math.cos(face), 0, -Math.sin(face));
  const ropeGeo = new THREE.CylinderGeometry(1, 1, 1, 4);
  const rope = (a, b, r = 0.012, col = 0x8f8062) => {
    const d = b.clone().sub(a), l = d.length();
    colorB.add(ropeGeo, new THREE.Matrix4().compose(a.clone().addScaledVector(d, 0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), new V3(r, l, r)), col);
  };
  const peg = (p) => wood.box(p.clone().setY(gh(p.x, p.z) + 0.12), UP, fw, rt, 0.16, 0.03, 0.03, { grain: true });
  const low = (p, R) => { let m = gh(p.x, p.z); for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; m = Math.min(m, gh(p.x + Math.cos(a) * R, p.z + Math.sin(a) * R)); } return m - 0.06; };

  // ------------------------- круглый шатёр -------------------------
  const roundTent = (p, { R, hw, hr, n = 16, cols, stripe = false, val, door = 0, pennant }) => {
    const y0 = low(p, R + 0.3);
    const c = p.clone().setY(y0);
    OBSTACLES.push({ x: p.x, z: p.z, r: R, door: [Math.sin(door), Math.cos(door)] });
    // дверь смотрит по направлению yaw = door; сегмент 0 — проём
    const a0 = Math.atan2(Math.cos(door), Math.sin(door)) - (Math.PI * 2 / n) * 0.5;
    const col = (j) => rgbOf(stripe ? cols[j % 2] : cols[0]);
    revolve(cloth, c, [[R, -0.1], [R, hw * 0.5], [R * 1.005, hw]], n, { color: col, skip: (j) => j === 0, a0 });
    // крыша с лёгким провисом между швами
    const prof = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      prof.push([(R + 0.3) * (1 - t) + 0.12 * t, hw - 0.05 + hr * t - Math.sin(t * Math.PI) * hr * 0.07]);
    }
    revolve(cloth, c, prof, n, { color: col, a0 });
    valance(cloth, c, R + 0.31, hw - 0.04, 0.42, n * 2, val, a0);
    // откинутые и подвязанные полы входа
    const aL = a0, aR = a0 + Math.PI * 2 / n;
    for (const [a, s] of [[aL, 1], [aR, -1]]) {
      const base = new V3(c.x + Math.cos(a) * R, 0, c.z + Math.sin(a) * R);
      const out = new V3(Math.cos(a), 0, Math.sin(a));
      const tang = new V3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(-s);
      const cc = soil(col(0), 0.8);
      const pts = [base.clone().setY(c.y + hw), base.clone().addScaledVector(tang, 0.5).addScaledVector(out, 0.25).setY(c.y + 0.9), base.clone().addScaledVector(tang, 0.15).setY(c.y - 0.05), base.clone().setY(c.y - 0.05)];
      const nn = out.clone().addScaledVector(tang, -0.4).normalize();
      const ids = pts.map((q, k) => cloth.v(q, nn, [0, 0.6, 0.2, 0][k], [hw, 1, 0, 0][k], cc));
      cloth.quad(ids[0], ids[1], ids[2], ids[3]);
    }
    // центральный шест с навершием и флажком
    const top = c.y + hw + hr;
    wood.addGeometry(new THREE.CylinderGeometry(0.06, 0.07, hw + hr + 0.7, 6), M(c.x, c.y + (hw + hr + 0.7) / 2, c.z));
    metal.addGeometry(new THREE.SphereGeometry(0.09, 8, 6), M(c.x, top + 0.72, c.z));
    if (pennant) colorB.add(new THREE.ConeGeometry(0.22, 1.1, 3).rotateZ(-Math.PI / 2), M(c.x + rt.x * 0.55, top + 0.52, c.z + rt.z * 0.55, face + Math.PI / 2, 1, 1, 0.08), pennant);
    // растяжки к колышкам
    for (let k = 0; k < 8; k++) {
      const a = a0 + (k / 8 + 1 / 16) * Math.PI * 2;
      const e = new V3(c.x + Math.cos(a) * (R + 0.3), c.y + hw - 0.05, c.z + Math.sin(a) * (R + 0.3));
      const g = new V3(c.x + Math.cos(a) * (R + 1.5), 0, c.z + Math.sin(a) * (R + 1.5));
      g.y = gh(g.x, g.z) + 0.2;
      rope(e, g); peg(g);
    }
  };

  // ------------------------- двускатная палатка -------------------------
  // вход — с торца, обращённого к «улице» (+ось d)
  const ridgeTent = (p, yaw, { L, W, H, wall = 0.45, col }) => {
    const d = new V3(Math.sin(yaw), 0, Math.cos(yaw)), s = new V3(Math.cos(yaw), 0, -Math.sin(yaw));
    const y0 = low(p, Math.max(L, W) / 2);
    const P = (x, y, z) => p.clone().addScaledVector(s, x).addScaledVector(d, z).setY(y0 + y);
    const cc = rgbOf(col);
    const hw = W / 2, hl = L / 2;
    // скаты с провисом между стойками (3 ряда вдоль длины)
    for (const sd of [-1, 1]) {
      const segs = 4;
      const nrm = s.clone().multiplyScalar(sd * (H - wall)).addScaledVector(UP, hw).normalize();
      const nW = s.clone().multiplyScalar(sd);
      for (let k = 0; k < segs; k++) {
        const z0 = -hl + (k / segs) * L, z1 = -hl + ((k + 1) / segs) * L;
        const sag = (z) => Math.sin(((z + hl) / L) * Math.PI) * 0.08;
        const r0 = [P(sd * hw, wall, z0), P(sd * hw, wall, z1), P(0, H - sag(z1), z1), P(0, H - sag(z0), z0)];
        const sl = Math.hypot(hw, H - wall);
        const ids = r0.map((q, i) => cloth.v(q, nrm, [z0, z1, z1, z0][i], [0, 0, sl, sl][i], soil(cc, q.y - y0)));
        cloth.quad(ids[0], ids[1], ids[2], ids[3]);
        const w0 = [P(sd * hw, -0.05, z0), P(sd * hw, -0.05, z1), P(sd * hw, wall, z1), P(sd * hw, wall, z0)];
        const wi = w0.map((q, i) => cloth.v(q, nW, [z0, z1, z1, z0][i], [0, 0, wall, wall][i], soil(cc, q.y - y0)));
        cloth.quad(wi[0], wi[1], wi[2], wi[3]);
      }
    }
    // задний торец — глухой пятиугольник
    {
      const nB = d.clone().negate();
      const pts = [P(-hw, -0.05, -hl), P(hw, -0.05, -hl), P(hw, wall, -hl), P(0, H, -hl), P(-hw, wall, -hl)];
      const ids = pts.map((q) => cloth.v(q, nB, q.clone().sub(p).dot(s), q.y - y0, soil(cc, q.y - y0)));
      cloth.quad(ids[0], ids[1], ids[2], ids[4]); cloth.tri(ids[4], ids[2], ids[3]);
    }
    // передний торец: полы распахнуты и подвязаны к стенкам
    for (const sd of [-1, 1]) {
      const pts = [P(0, H, hl), P(sd * hw, wall, hl), P(sd * hw, -0.05, hl), P(sd * hw * 0.55, -0.05, hl + 0.35), P(sd * hw * 0.35, H * 0.45, hl + 0.3)];
      const nn = d.clone().addScaledVector(s, sd * 0.3).normalize();
      const ids = pts.map((q) => cloth.v(q, nn, q.clone().sub(p).dot(s), q.y - y0, soil(cc, q.y - y0)));
      cloth.tri(ids[0], ids[1], ids[4]); cloth.quad(ids[1], ids[2], ids[3], ids[4]);
    }
    // стойки, конёк, растяжки
    for (const z of [-hl, hl]) wood.addGeometry(new THREE.CylinderGeometry(0.045, 0.05, H + 0.25, 6), M(P(0, 0, z).x, y0 + (H + 0.25) / 2, P(0, 0, z).z));
    wood.box(P(0, H + 0.03, 0), d, UP, s, hl + 0.1, 0.04, 0.04, { grain: true });
    for (const z of [-hl, hl]) {
      const e = P(0, H, z), g = P(0, 0, z + Math.sign(z) * 1.4); g.y = gh(g.x, g.z) + 0.15;
      rope(e, g); peg(g);
    }
    for (const sd of [-1, 1]) for (const z of [-hl * 0.8, 0, hl * 0.8]) {
      const e = P(sd * hw, wall, z), g = P(sd * (hw + 0.9), 0, z); g.y = gh(g.x, g.z) + 0.15;
      rope(e, g, 0.01); peg(g);
    }
  };

  return { roundTent, ridgeTent, rope, peg, low };
}

export function siegeCamp(ctx, village, findCampSite) {
  // своя геометрия лагеря (отдельные сетки): вдали от лагеря они отсекаются
  // по видимости, а не рисуются вместе с остальными мелочами всего мира
  const CB = {
    wood: new GeoBuilder(ctx.wood.tile), metal: new GeoBuilder(ctx.metal.tile), stone: new GeoBuilder(ctx.stone.tile),
    straw: new GeoBuilder(ctx.straw.tile), colorB: new ColorBuilder(),
  };
  ctx.campBuilders = CB;
  const cc = { ...ctx, ...CB };
  const { terrain, wood, colorB, glowB, straw, people, rnd, metal, scene } = cc;
  const site = findCampSite(terrain, village);
  if (!site) return null;
  const { x: cx, z: cz } = site;
  const gh = (x, z) => terrain.heightAt(x, z);
  const face = Math.atan2(-cx, -(cz - 20));
  const fw = new V3(Math.sin(face), 0, Math.cos(face)), rt = new V3(Math.cos(face), 0, -Math.sin(face));
  const at = (f, r) => new V3(cx + fw.x * f + rt.x * r, 0, cz + fw.z * f + rt.z * r);
  const cloth = new ClothB(1.6);
  const { roundTent, ridgeTent, rope, peg, low } = tentKit(cc, cloth, face);

  // ------------------------- улицы лагеря -------------------------
  const linen = 0xe6dcc6, linen2 = 0xd8ccb0, green = 0x3f6a34, ochre = 0xc79a3c;
  const toStreet = (f0) => (f0 < -18 ? face : face + Math.PI); // двери смотрят на проход между рядами
  // ряд 1 (ближний к замку)
  roundTent(at(-13, -11), { R: 2.1, hw: 1.5, hr: 2.0, cols: [linen, green], stripe: true, val: green, door: face + Math.PI, pennant: ochre });
  ridgeTent(at(-13, -4.5), toStreet(-13), { L: 3.6, W: 2.4, H: 2.1, col: linen });
  ridgeTent(at(-13, 1.5), toStreet(-13), { L: 3.2, W: 2.2, H: 2.0, col: linen2 });
  roundTent(at(-13, 8.5), { R: 1.9, hw: 1.4, hr: 1.9, cols: [linen], val: ochre, door: face + Math.PI, pennant: green });
  // ряд 2
  ridgeTent(at(-23, -6), toStreet(-23), { L: 3.8, W: 2.5, H: 2.2, col: linen2 });
  roundTent(at(-23, 1), { R: 2.2, hw: 1.5, hr: 2.1, cols: [ochre, linen], stripe: true, val: linen, door: face, pennant: green });
  ridgeTent(at(-23, 8), toStreet(-23), { L: 3.4, W: 2.3, H: 2.0, col: linen });
  ridgeTent(at(-23, 13.5), toStreet(-23), { L: 3.0, W: 2.2, H: 1.9, col: 0xcfc2a4 });
  // шатёр предводителя: большой, полосатый, с фестонами и навесом-крыльцом
  {
    const p = at(-22, -17);
    roundTent(p, { R: 3.4, hw: 2.3, hr: 2.7, n: 24, cols: [green, 0xe8dec4], stripe: true, val: ochre, door: face, pennant: ochre });
    const y0 = low(p, 3.7);
    const dA = new V3(fw.x, 0, fw.z), sA = rt;
    const P = (x, y, z) => p.clone().addScaledVector(sA, x).addScaledVector(dA, z).setY(y0 + y);
    // навес над входом
    const cc = rgbOf(0xe8dec4);
    const pts = [P(-1.6, 2.35, 3.2), P(1.6, 2.35, 3.2), P(1.6, 2.1, 5.6), P(-1.6, 2.1, 5.6)];
    const nrm = UP.clone().addScaledVector(dA, 0.1).normalize();
    const ids = pts.map((q, i) => cloth.v(q, nrm, [0, 3.2, 3.2, 0][i], [0, 0, 2.4, 2.4][i], cc));
    cloth.quad(ids[0], ids[3], ids[2], ids[1]);
    for (const x of [-1.6, 1.6]) {
      const b = P(x, 0, 5.6);
      wood.addGeometry(new THREE.CylinderGeometry(0.05, 0.06, 2.3, 6), M(b.x, y0 + 1.15, b.z));
      const g = P(x * 1.4, 0, 7.0); g.y = gh(g.x, g.z) + 0.15;
      rope(P(x, 2.1, 5.6), g); peg(g);
    }
    // стол с картой и скамья под навесом
    const t = P(0, 0.75, 4.4);
    wood.box(t, sA, UP, dA, 0.8, 0.03, 0.45, { grain: true });
    for (const [x, z] of [[-0.7, -0.35], [0.7, -0.35], [-0.7, 0.35], [0.7, 0.35]]) wood.box(P(x, 0.37, 4.4 + z), UP, sA, dA, 0.37, 0.03, 0.03, { grain: true });
    colorB.add(GEO.box, M(t.x, t.y + 0.035, t.z, face, 0.7, 0.005, 0.5), 0xd8c8a0);
    wood.box(P(0, 0.42, 3.6), sA, UP, dA, 0.7, 0.03, 0.14, { grain: true });
    people.push({ ...(() => { const q = P(-0.4, 0, 5.0); return { x: q.x, y: gh(q.x, q.z), z: q.z }; })(), yaw: face + Math.PI, role: 'knight' });
    people.push({ ...(() => { const q = P(0.5, 0, 5.1); return { x: q.x, y: gh(q.x, q.z), z: q.z }; })(), yaw: face + Math.PI - 0.4, role: 'noble' });
    const gd = P(2.4, 0, 3.9);
    people.push({ x: gd.x, y: gh(gd.x, gd.z), z: gd.z, yaw: face, role: 'foe' });
  }

  // ------------------------- требушет -------------------------
  {
    const p = at(8, -2), g = gh(p.x, p.z);
    const A = fw, R = rt;
    const P = (f, y, r) => p.clone().addScaledVector(A, f).addScaledVector(R, r).setY(g + y);
    const beam = (a, b, t = 0.26, bld = wood) => {
      const d = b.clone().sub(a), l = d.length(); d.normalize();
      const side = Math.abs(d.dot(R)) > 0.9 ? A : R;
      const ay = new V3().crossVectors(side, d).normalize();
      const az = new V3().crossVectors(d, ay).normalize();
      bld.box(a.clone().addScaledVector(d, l / 2), d, ay, az, l / 2, t / 2, t / 2, { grain: true });
    };
    const axleH = 6.0, halfW = 1.05;
    // станина: два длинных лежня, поперечины, выносные упоры в стороны
    for (const s of [-1, 1]) beam(P(-5.2, 0.2, s * halfW), P(5.2, 0.2, s * halfW), 0.36);
    for (const f of [-4.8, -1.8, 1.8, 4.8]) beam(P(f, 0.52, -halfW - 0.25), P(f, 0.52, halfW + 0.25), 0.28);
    for (const s of [-1, 1]) beam(P(0, 0.2, s * (halfW + 0.2)), P(0, 0.2, s * 3.4), 0.3);
    // стойки к оси и раскосы вперёд, назад и вбок
    for (const s of [-1, 1]) {
      const r = s * halfW;
      beam(P(0, 0.35, r), P(0, axleH + 0.45, r), 0.38);
      for (const f of [-4.2, 4.2]) beam(P(f, 0.4, r), P(Math.sign(f) * 0.25, axleH - 1.1, r), 0.26);
      beam(P(0, 0.4, s * 3.2), P(0, axleH - 1.9, r + s * 0.2), 0.24);
      // схватки между стойкой и раскосами
      beam(P(-3.1, 1.5, r), P(3.1, 1.5, r), 0.2);
      // подушка оси с железной оковкой
      metal.box(P(0, axleH, r), A, UP, R, 0.28, 0.24, 0.22);
    }
    for (const f of [-3.1, 3.1]) beam(P(f, 1.5, -halfW), P(f, 1.5, halfW), 0.2);
    metal.addGeometry(new THREE.CylinderGeometry(0.13, 0.13, halfW * 2 + 0.7, 10).rotateZ(Math.PI / 2), M(P(0, axleH, 0).x, g + axleH, P(0, axleH, 0).z, face));
    // жёлоб для пращи между лежнями
    for (const s of [-0.35, 0.35]) beam(P(-8.4, 0.12, s), P(-2.4, 0.12, s), 0.12);
    wood.box(P(-5.4, 0.06, 0), A, UP, R, 3.0, 0.03, 0.3, { grain: true });
    // ворот: барабан на лежнях, крест-накрест вставлены рычаги
    const drum = P(-4.1, 1.0, 0);
    wood.addGeometry(new THREE.CylinderGeometry(0.26, 0.26, halfW * 2 - 0.1, 12).rotateZ(Math.PI / 2), M(drum.x, drum.y, drum.z, face));
    for (const s of [-1, 1]) {
      const e = drum.clone().addScaledVector(R, s * (halfW + 0.35));
      wood.addGeometry(new THREE.CylinderGeometry(0.1, 0.1, 0.7, 8).rotateZ(Math.PI / 2), M(e.x, e.y, e.z, face));
      for (const a of [0, Math.PI / 2]) {
        const dir = A.clone().multiplyScalar(Math.cos(a)).addScaledVector(UP, Math.sin(a));
        beam(e.clone().addScaledVector(dir, -1.1).addScaledVector(R, s * 0.2), e.clone().addScaledVector(dir, 1.1).addScaledVector(R, s * 0.2), 0.08);
      }
      beam(P(-4.1, 0.35, s * halfW), P(-4.1, 1.0, s * halfW), 0.2);
    }
    // рычаг в покое: длинное плечо опущено назад, конец у земли над жёлобом
    const armLen = 9.2, short = 2.7;
    const pivot = P(0, axleH, 0);
    const restA = Math.asin((axleH - 0.85) / armLen);
    const arm = A.clone().multiplyScalar(-Math.cos(restA)).addScaledVector(UP, -Math.sin(restA)).normalize();
    const aw = ctx.armWood, am = ctx.armMetal;
    const q = new THREE.Quaternion().setFromUnitVectors(UP, arm);
    const taper = (l0, l1, r0, r1, bld) => {
      const gg = new THREE.CylinderGeometry(r1, r0, l1 - l0, 4, 1).rotateY(Math.PI / 4).translate(0, (l0 + l1) / 2, 0);
      const uv = gg.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r0 * 5.6 / 1.2, uv.getY(i) * (l1 - l0) / 1.2);
      bld.addGeometry(gg, new THREE.Matrix4().compose(pivot, q, new V3(1, 1, 1)));
    };
    taper(-short - 0.3, 0, 0.34, 0.32, aw);
    taper(0, armLen, 0.32, 0.15, aw);
    // железные бандажи на рычаге и крюк на конце
    for (const t of [-short + 0.2, -0.6, 0.6, 2.6, 5, 7.4]) {
      const r = 0.34 - Math.max(0, t) / armLen * 0.17 + 0.02;
      am.addGeometry(new THREE.CylinderGeometry(r, r, 0.08, 4).rotateY(Math.PI / 4).translate(0, t, 0), new THREE.Matrix4().compose(pivot, q, new V3(1, 1, 1)));
    }
    am.addGeometry(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6).translate(0, armLen + 0.2, 0), new THREE.Matrix4().compose(pivot, q, new V3(1, 1, 1)));
    // противовес: шарнир на коротком плече; ящик висит на двух тягах (отдельная группа)
    const hinge = pivot.clone().addScaledVector(arm, -short);
    const cw = ctx.cwWood, cm = ctx.cwMetal, cs = ctx.cwStone;
    const H0 = hinge.clone();
    const L = (f, y, r) => H0.clone().addScaledVector(A, f).addScaledVector(R, r).setY(H0.y + y);
    for (const s of [-1, 1]) {
      cm.box(L(0, -0.45, s * 0.52), A, UP, R, 0.07, 0.45, 0.03);
      for (const f of [-0.75, 0.75]) cw.box(L(f * 0.9, -0.95, s * 0.72), UP, A, R, 0.62, 0.07, 0.07, { grain: true });
    }
    // стенки ящика из досок, обитые железом по углам
    const bx = 0.95, bz = 0.72, by0 = -2.3, by1 = -0.9;
    for (const s of [-1, 1]) {
      cw.box(L(s * bx, (by0 + by1) / 2, 0), R, UP, A, bz, (by1 - by0) / 2, 0.05, { grain: true });
      cw.box(L(0, (by0 + by1) / 2, s * bz), A, UP, R, bx, (by1 - by0) / 2, 0.05, { grain: true });
      for (const t of [-1, 1]) cm.box(L(s * bx, (by0 + by1) / 2, t * bz), UP, A, R, (by1 - by0) / 2 + 0.02, 0.06, 0.06);
    }
    cw.box(L(0, by0, 0), A, UP, R, bx, 0.06, bz, { grain: true });
    cm.box(L(0, 0, 0), R, UP, A, 0.6, 0.06, 0.06); // ось шарнира
    for (let k = 0; k < 14; k++) {
      const s0 = L((rnd() - 0.5) * 1.5, by1 - 0.05 + rnd() * 0.15, (rnd() - 0.5) * 1.1);
      cs.addGeometry(new THREE.DodecahedronGeometry(0.22 + rnd() * 0.12, 0), M(s0.x, s0.y, s0.z, rnd() * 6, 1, 0.8, 1));
    }
    ctx.treb = { pivot, A, R, arm, armLen, face, short, hinge: H0, drum: drum.clone().setY(drum.y + 0.26) };
    // запас снарядов: груда тёсаных ядер у жёлоба
    for (let k = 0; k < 22; k++) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * 1.3;
      const q0 = P(-6.5 + Math.cos(a) * rr, 0, 3.2 + Math.sin(a) * rr);
      const hh = (1.3 - rr) * 0.45;
      cc.stone.addGeometry(new THREE.IcosahedronGeometry(0.26 + rnd() * 0.06, 1), M(q0.x, gh(q0.x, q0.z) + 0.24 + hh, q0.z, rnd() * 3));
    }
    // обслуга: двое у ворота, один подносит ядро, мастер-инженер
    for (const [f, r, role, yaw, pose] of [[-4.1, 2.3, 'foe', -Math.PI / 2, 'work'], [-4.1, -2.3, 'foe', Math.PI / 2, 'work'], [-6.2, 2.1, 'peasant', Math.PI, 'work'], [-2.2, 3.6, 'noble', -Math.PI / 2 - 0.4, 'stand']]) {
      const q0 = P(f, 0, r);
      people.push({ x: q0.x, y: gh(q0.x, q0.z), z: q0.z, yaw: face + yaw, role, pose });
    }
    // щиты-павезы перед машиной: плетёные из лозы, на подпорках
    for (let k = -2; k <= 2; k++) {
      const c0 = P(7.2, 0, k * 2.3), gg = gh(c0.x, c0.z);
      const lean = new THREE.Quaternion().setFromAxisAngle(R, -0.18);
      const mm = new THREE.Matrix4().compose(c0.clone().setY(gg + 0.95), new THREE.Quaternion().setFromAxisAngle(UP, face).premultiply(lean), new V3(1, 1, 1));
      for (let j = 0; j < 17; j++) straw.addGeometry(new THREE.CylinderGeometry(0.055, 0.055, 1.9, 5).rotateZ(Math.PI / 2).translate(0, -0.85 + j * 0.105, (j % 2) * 0.03), mm);
      for (const x of [-0.85, -0.42, 0, 0.42, 0.85]) wood.addGeometry(new THREE.CylinderGeometry(0.04, 0.04, 2.1, 5).translate(x, 0.05, 0.015), mm);
      wood.box(c0.clone().addScaledVector(A, -0.6).setY(gg + 0.55), UP.clone().addScaledVector(A, 0.9).normalize(), R, new V3().crossVectors(UP.clone().addScaledVector(A, 0.9).normalize(), R), 0.7, 0.04, 0.04, { grain: true });
    }
  }

  // ------------------------- таран под навесом из шкур -------------------------
  {
    const p = at(4, 12), g = gh(p.x, p.z);
    const A = fw, R = rt;
    for (const s of [-1, 1]) for (const f of [-2, 2]) {
      const w = p.clone().addScaledVector(A, f).addScaledVector(R, s * 1.3);
      wood.addGeometry(new THREE.CylinderGeometry(0.45, 0.45, 0.18, 14).rotateZ(Math.PI / 2), M(w.x, g + 0.45, w.z, face));
      metal.addGeometry(new THREE.CylinderGeometry(0.47, 0.47, 0.1, 14, 1, true).rotateZ(Math.PI / 2), M(w.x, g + 0.45, w.z, face));
      wood.box(w.clone().addScaledVector(R, -s * 0.12).setY(g + 1.75), UP, A, R, 1.25, 0.09, 0.09, { grain: true });
    }
    for (const s of [-1, 1]) wood.box(p.clone().addScaledVector(R, s * 1.18).setY(g + 0.75), A, UP, R, 2.7, 0.13, 0.13, { grain: true });
    for (const s of [-1, 1]) wood.box(p.clone().addScaledVector(R, s * 1.18).setY(g + 3.0), A, UP, R, 2.7, 0.08, 0.08, { grain: true });
    wood.box(p.clone().setY(g + 3.65), A, UP, R, 2.8, 0.09, 0.09, { grain: true });
    // крыша из сырых шкур (от огня), внахлёст
    const hide = rgbOf(0x6e5034);
    for (const s of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const f0 = -2.9 + k * 1.45, f1 = f0 + 1.55;
        const Q = (f, rr, y) => p.clone().addScaledVector(A, f).addScaledVector(R, rr).setY(g + y);
        const pts = [Q(f0, s * 1.45, 2.75), Q(f1, s * 1.45, 2.75), Q(f1, 0, 3.75), Q(f0, 0, 3.75)];
        const nrm = R.clone().multiplyScalar(s).addScaledVector(UP, 1.45).normalize();
        const tone = 0.85 + ((k * 7 + (s > 0 ? 3 : 0)) % 5) * 0.06;
        const ids = pts.map((q0, i) => cloth.v(q0, nrm, [0, 1.5, 1.5, 0][i], [0, 0, 1.8, 1.8][i], hide.map((v) => v * tone)));
        cloth.quad(ids[0], ids[1], ids[2], ids[3]);
      }
    }
    // бревно тарана на цепях с железной «бараньей головой»
    wood.addGeometry(new THREE.CylinderGeometry(0.27, 0.3, 6.4, 12).rotateX(Math.PI / 2), M(p.x, g + 1.5, p.z, face));
    for (const f of [-1.6, 1.6]) {
      const c0 = p.clone().addScaledVector(A, f);
      rope(c0.clone().setY(g + 1.75), c0.clone().setY(g + 3.6), 0.03, 0x3a3634);
      metal.addGeometry(new THREE.CylinderGeometry(0.31, 0.31, 0.12, 12, 1, true).rotateX(Math.PI / 2), M(c0.x, g + 1.5, c0.z, face));
    }
    const head = p.clone().addScaledVector(A, 3.35);
    metal.addGeometry(new THREE.CylinderGeometry(0.2, 0.32, 0.5, 12).rotateX(Math.PI / 2), M(head.x, g + 1.5, head.z, face));
  }

  // ------------------------- обоз: телега с бочками, лестницы, дрова -------------------------
  {
    const p = at(-3, 19);
    const top = cart(wood, metal, terrain, p.x, p.z, face + Math.PI / 2, rnd);
    for (let k = 0; k < 3; k++) {
      const b0 = top.clone().addScaledVector(fw, (k - 1) * 0.7);
      const lat = new THREE.LatheGeometry([[0.26, 0], [0.31, 0.2], [0.33, 0.4], [0.31, 0.6], [0.26, 0.8]].map(([x, y]) => new THREE.Vector2(x, y)), 10);
      wood.addGeometry(lat, M(b0.x, b0.y, b0.z));
      for (const hy of [0.12, 0.68]) metal.addGeometry(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 10, 1, true), M(b0.x, b0.y + hy, b0.z));
    }
    for (const [f, r] of [[-6, 21], [-7.2, 21.4]]) {
      const q0 = at(f, r), gg = gh(q0.x, q0.z);
      for (const s of [-1, 1]) wood.box(q0.clone().addScaledVector(fw, s * 0.3).setY(gg + 0.08), rt, UP, fw, 3.5, 0.05, 0.05, { grain: true });
      for (let k = -3; k <= 3; k++) wood.box(q0.clone().addScaledVector(rt, k * 0.45).setY(gg + 0.1), fw, UP, rt, 0.32, 0.03, 0.03, { grain: true });
    }
    // поленница
    const wp = at(-17, 17), gw = gh(wp.x, wp.z);
    for (let row = 0; row < 4; row++) for (let k = 0; k < 7 - row; k++) {
      const q0 = wp.clone().addScaledVector(rt, (k - (6 - row) / 2) * 0.22).setY(gw + 0.11 + row * 0.19);
      wood.addGeometry(new THREE.CylinderGeometry(0.1, 0.11, 1.1, 7).rotateX(Math.PI / 2), M(q0.x, q0.y, q0.z, face));
    }
  }

  // ------------------------- частокол с проходом -------------------------
  for (let k = -46; k <= 46; k++) {
    if (Math.abs(k) < 5) continue; // проход
    const r = k * 0.4;
    const p = at(18 + Math.abs(r) * 0.12 + (rnd() - 0.5) * 0.08, r), g = gh(p.x, p.z);
    const hgt = 2.0 + rnd() * 0.35;
    const lean = new THREE.Quaternion().setFromAxisAngle(rt, 0.22);
    wood.addGeometry(new THREE.CylinderGeometry(0.11, 0.13, hgt, 6), new THREE.Matrix4().compose(p.clone().setY(g + hgt / 2 - 0.25), lean, new V3(1, 1, 1)));
    const tip = p.clone().addScaledVector(fw, Math.sin(0.22) * (hgt - 0.25)).setY(g + Math.cos(0.22) * (hgt - 0.25) + 0.12);
    wood.addGeometry(new THREE.ConeGeometry(0.11, 0.38, 6), new THREE.Matrix4().compose(tip, lean, new V3(1, 1, 1)));
  }
  for (const s of [-1, 1]) for (const y of [0.6, 1.4]) {
    const a = at(18 + 0.25 + 2.0 * 0.12, s * 2.0), b = at(18 + 18.4 * 0.12 + 0.25, s * 18.4);
    const ga = gh(a.x, a.z), gb = gh(b.x, b.z);
    const aa = a.clone().addScaledVector(fw, Math.sin(0.22) * y).setY(ga + y - 0.25), bb = b.clone().addScaledVector(fw, Math.sin(0.22) * y).setY(gb + y - 0.25);
    const d = bb.clone().sub(aa), l = d.length(); d.normalize();
    wood.box(aa.clone().addScaledVector(d, l / 2).addScaledVector(fw, -0.15), d, UP, new V3().crossVectors(d, UP), l / 2, 0.05, 0.05, { grain: true });
  }

  // ------------------------- костры: котёл на треноге, бревно-скамья -------------------------
  for (const [f, r] of [[-8, 5], [-8, -8], [-18, 3.5], [-18, -12]]) {
    const p = at(f, r), g = gh(p.x, p.z);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      cc.stone.addGeometry(new THREE.DodecahedronGeometry(0.16, 0), M(p.x + Math.cos(a) * 0.62, g + 0.08, p.z + Math.sin(a) * 0.62, a));
    }
    for (let k = 0; k < 4; k++) wood.addGeometry(new THREE.CylinderGeometry(0.06, 0.07, 0.8, 6), M(p.x, g + 0.1, p.z, k * 0.8, 1, 1, 1, Math.PI / 2 - 0.2));
    fire(glowB, p.x, g + 0.1, p.z, 0.8, rnd);
    // дым костра (виден издалека — лагерь «живой»)
    { const sm = new Smoke(scene, new V3(p.x, g + 1.4, p.z), { count: 6, size: 0.6, grow: 3, alpha: 0.28, life: 7, rise: 1.1 }); ctx.smokes.push(sm); (ctx.campSmokes = ctx.campSmokes || []).push(sm); }
    // тренога и котёл
    const topP = new V3(p.x, g + 1.75, p.z);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.4;
      const foot = new V3(p.x + Math.cos(a) * 0.95, g, p.z + Math.sin(a) * 0.95);
      const d = topP.clone().sub(foot), l = d.length() + 0.15; d.normalize();
      wood.addGeometry(new THREE.CylinderGeometry(0.035, 0.045, l, 5), new THREE.Matrix4().compose(foot.clone().addScaledVector(d, l / 2), new THREE.Quaternion().setFromUnitVectors(UP, d), new V3(1, 1, 1)));
    }
    rope(topP, new V3(p.x, g + 1.05, p.z), 0.012, 0x2e2a28);
    metal.addGeometry(new THREE.SphereGeometry(0.3, 12, 6, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), M(p.x, g + 1.02, p.z));
    colorB.add(new THREE.CircleGeometry(0.27, 12).rotateX(-Math.PI / 2), M(p.x, g + 0.98, p.z), 0x5a4a2a); // похлёбка
    // бревно-скамья
    const la = rnd() * Math.PI * 2;
    const lb = new V3(p.x + Math.cos(la) * 1.9, 0, p.z + Math.sin(la) * 1.9);
    wood.addGeometry(new THREE.CylinderGeometry(0.18, 0.2, 1.8, 8).rotateZ(Math.PI / 2), M(lb.x, gh(lb.x, lb.z) + 0.18, lb.z, -la));
    for (let k = 0; k < 3; k++) {
      const a = la + Math.PI * 0.7 + k * 0.8;
      const q0 = new V3(p.x + Math.cos(a) * 1.7, 0, p.z + Math.sin(a) * 1.7);
      people.push({ x: q0.x, y: gh(q0.x, q0.z), z: q0.z, yaw: Math.atan2(p.x - q0.x, p.z - q0.z), role: k === 2 ? 'archer' : 'foe' });
    }
    { const q0 = new V3(lb.x - Math.sin(la) * 0.1, 0, lb.z); people.push({ x: q0.x, y: gh(q0.x, q0.z) + 0.05, z: q0.z, yaw: Math.atan2(p.x - q0.x, p.z - q0.z), role: 'foe', pose: 'sit' }); }
  }

  // ------------------------- коновязь -------------------------
  {
    const a = at(-12, -21), b = at(-12, -31);
    for (const q0 of [a, b]) {
      const gg = gh(q0.x, q0.z);
      wood.addGeometry(new THREE.CylinderGeometry(0.08, 0.09, 1.6, 6), M(q0.x, gg + 0.8, q0.z));
    }
    rope(a.clone().setY(gh(a.x, a.z) + 1.45), b.clone().setY(gh(b.x, b.z) + 1.45), 0.018);
    const cols = [0x3a2418, 0x8a6a4a, 0x2a1e16, 0x6a4424, 0xb8a890];
    for (let k = 0; k < 5; k++) {
      const q0 = a.clone().lerp(b, (k + 0.5) / 5).addScaledVector(fw, -1.6 + (rnd() - 0.5) * 0.3);
      horse(colorB, q0.x, gh(q0.x, q0.z), q0.z, face + (rnd() - 0.5) * 0.25, cols[k], rnd);
    }
    const hs = at(-8.5, -26);
    straw.addGeometry(new THREE.IcosahedronGeometry(1, 2), M(hs.x, gh(hs.x, hs.z) + 0.35, hs.z, 0, 1.6, 0.6, 1.0));
    const pg = at(-10.2, -24.5);
    people.push({ x: pg.x, y: gh(pg.x, pg.z), z: pg.z, yaw: face + Math.PI / 2, role: 'servant', pose: 'work' });
  }

  // ------------------------- часовые, знамёна, стойка с копьями -------------------------
  for (const r of [-12, -3.4, 3.4, 12]) {
    const p = at(16.5, r);
    people.push({ x: p.x, y: gh(p.x, p.z), z: p.z, yaw: face, role: 'foe' });
  }
  for (const [f, r] of [[12, -8], [12, 8], [-6, 0]]) {
    const p = at(f, r), gg = gh(p.x, p.z);
    wood.addGeometry(new THREE.CylinderGeometry(0.05, 0.05, 5, 5), M(p.x, gg + 2.5, p.z));
    colorB.add(GEO.box, M(p.x + rt.x * 0.55, gg + 4.4, p.z + rt.z * 0.55, face + Math.PI / 2, 1.1, 1.4, 0.02), 0x2e4a26);
    colorB.add(GEO.box, M(p.x + rt.x * 0.56, gg + 4.4, p.z + rt.z * 0.56, face + Math.PI / 2, 0.4, 0.9, 0.025), 0xc8a040);
  }
  {
    const p = at(-9, 12), gg = gh(p.x, p.z);
    for (const s of [-1, 1]) wood.box(p.clone().addScaledVector(rt, s * 0.9).setY(gg + 0.6), UP, rt, fw, 0.6, 0.04, 0.04, { grain: true });
    wood.box(p.clone().setY(gg + 1.1), rt, UP, fw, 1.0, 0.035, 0.035, { grain: true });
    for (let k = 0; k < 6; k++) {
      const q0 = p.clone().addScaledVector(rt, -0.75 + k * 0.3).addScaledVector(fw, 0.25);
      const tilt = new THREE.Quaternion().setFromAxisAngle(rt, -0.2);
      wood.addGeometry(new THREE.CylinderGeometry(0.02, 0.025, 2.6, 5), new THREE.Matrix4().compose(q0.clone().setY(gg + 1.3), tilt, new V3(1, 1, 1)));
      metal.addGeometry(new THREE.ConeGeometry(0.035, 0.22, 5), new THREE.Matrix4().compose(q0.clone().addScaledVector(fw, -0.26).setY(gg + 2.68), tilt, new V3(1, 1, 1)));
    }
  }

  // сетка шатров: одна, с текстурой парусины (оттенок — цвет вершин)
  const mat = pbrMaterial('canvas', { vertexColors: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(cloth.build(), mat);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = 'extras';
  scene.add(mesh);
  return { x: cx, z: cz, face, fw, rt, at, gh };
}

// Шатёр во дворе замка (один, вместо двух «цирковых»): круглый павильон рыцаря
// с фестонами, вход к середине двора; внутри — походная кровать, сундук, стойка
// с кольчугой и шлемом, стол со свечой и табурет, ковёр, щит и копья.
export function yardPavilion(scene, ctx, x, z, doorYaw) {
  const { terrain, wood, metal, colorB } = ctx;
  const cloth = new ClothB(1.6);
  const kit = tentKit(ctx, cloth, doorYaw);
  const p = new V3(x, 0, z);
  const R = 3.3;
  kit.roundTent(p, { R, hw: 2.2, hr: 2.5, n: 20, cols: [0xe4d8be], val: 0x1f3a6a, door: doorYaw, pennant: 0x1f3a6a });
  // настил на уровне самой высокой точки под шатром (на склоне не утонет в земле)
  let hi = -1e9, lo = 1e9;
  for (let k = 0; k < 12; k++) for (const rr of [0, R * 0.5, R - 0.2]) {
    const a = (k / 12) * Math.PI * 2, h = terrain.heightAt(x + Math.cos(a) * rr, z + Math.sin(a) * rr);
    hi = Math.max(hi, h); lo = Math.min(lo, h);
  }
  const y0 = hi + 0.02;
  const d = new V3(Math.sin(doorYaw), 0, Math.cos(doorYaw)), s = new V3(Math.cos(doorYaw), 0, -Math.sin(doorYaw));
  const P = (u, h, v) => p.clone().addScaledVector(d, u).addScaledVector(s, v).setY(y0 + h);
  const M4 = (u, h, v, sx, sy, sz, yaw = 0) => new THREE.Matrix4().compose(P(u, h, v), new THREE.Quaternion().setFromAxisAngle(UP, doorYaw + yaw), new V3(sx, sy, sz));
  // пол: дощатый настил и ковёр
  wood.box(P(0, (lo - y0) / 2 + 0.03, 0), d, UP, s, R - 0.25, (y0 - lo) / 2 + 0.03, R - 0.25, { grain: true });
  colorB.add(GEO.box, M4(-0.3, 0.065, 0, 3.2, 0.01, 2.2), 0x6a1e22);
  colorB.add(GEO.box, M4(-0.3, 0.07, 0, 2.8, 0.01, 1.8), 0x9a6a2a);
  colorB.add(GEO.box, M4(-0.3, 0.075, 0, 2.2, 0.01, 1.2), 0x1f3a5a);
  // походная кровать с тюфяком и шерстяным одеялом
  const bu = -1.9, bv = -1.2;
  wood.box(P(bu, 0.3, bv), s, UP, d, 1.0, 0.05, 0.45, { grain: true });
  for (const [a, b] of [[-0.9, -0.4], [0.9, -0.4], [-0.9, 0.4], [0.9, 0.4]]) wood.box(P(bu + b, 0.15, bv + a), UP, d, s, 0.15, 0.04, 0.04, { grain: true });
  colorB.add(GEO.box, M4(bu, 0.42, bv, 1.95, 0.14, 0.85), 0xcdbf9a);
  colorB.add(GEO.box, M4(bu, 0.5, bv + 0.2, 1.5, 0.06, 0.9), 0x5a2a2a);
  colorB.add(GEO.box, M4(bu, 0.54, bv - 0.75, 0.35, 0.12, 0.6), 0xe8dcc8); // подушка
  // сундук с железными полосами
  const cu = -2.3, cv = 1.1;
  wood.box(P(cu, 0.3, cv), s, UP, d, 0.45, 0.3, 0.3, { grain: true });
  for (const k of [-0.3, 0.3]) metal.box(P(cu, 0.3, cv + k), s, UP, d, 0.02, 0.31, 0.31);
  metal.box(P(cu + 0.31, 0.45, cv), s, UP, d, 0.06, 0.07, 0.02);
  // стойка с кольчугой и шлемом
  const au = -0.4, av = 2.1;
  wood.box(P(au, 0.75, av), UP, d, s, 0.75, 0.04, 0.04, { grain: true });
  wood.box(P(au, 1.35, av), s, UP, d, 0.35, 0.04, 0.04, { grain: true });
  wood.box(P(au, 0.03, av), d, UP, s, 0.3, 0.03, 0.3, { grain: true });
  // кольчуга, накинутая на перекладину: складки свисают
  for (let k = 0; k < 7; k++) colorB.add(new THREE.CylinderGeometry(0.05, 0.07, 0.7, 6), M4(au, 1.0, av - 0.3 + k * 0.1, 1, 1, 1), k % 2 ? 0x7e8288 : 0x8e9298);
  colorB.add(new THREE.CylinderGeometry(0.16, 0.17, 0.3, 12), M4(au, 1.62, av, 1, 1, 1), 0x9a9ea4); // шлем-топхельм
  colorB.add(new THREE.CircleGeometry(0.16, 12).rotateX(-Math.PI / 2), M4(au, 1.775, av, 1, 1, 1), 0x9a9ea4);
  colorB.add(GEO.box, M4(au - 0.16, 1.64, av, 0.02, 0.025, 0.24), 0x1a1a1a); // смотровая щель
  // щит у стойки и копья у шеста
  colorB.add(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 3).rotateX(Math.PI / 2), M4(au + 0.15, 0.45, av + 0.55, 1, 1.4, 1, -0.3), 0x1f3a6a);
  for (let k = 0; k < 3; k++) {
    const q = P(0.25 + k * 0.08, 0, -0.25);
    wood.addGeometry(new THREE.CylinderGeometry(0.022, 0.028, 3.2, 5), new THREE.Matrix4().compose(q.clone().setY(y0 + 1.6), new THREE.Quaternion().setFromAxisAngle(s, 0.08 * (k - 1)), new V3(1, 1, 1)));
  }
  // стол, свеча, пергамент, кубок; табурет
  const tu = 0.9, tv = -1.8;
  wood.box(P(tu, 0.74, tv), d, UP, s, 0.45, 0.03, 0.35, { grain: true });
  for (const [a, b] of [[-0.38, -0.28], [0.38, -0.28], [-0.38, 0.28], [0.38, 0.28]]) wood.box(P(tu + a, 0.37, tv + b), UP, d, s, 0.37, 0.03, 0.03, { grain: true });
  colorB.add(GEO.cyl, M4(tu - 0.2, 0.83, tv + 0.1, 0.025, 0.14, 0.025), 0xece2c8);
  ctx.glowB.add(GEO.flame, M4(tu - 0.2, 0.93, tv + 0.1, 0.018, 0.06, 0.018), 0xffc060);
  colorB.add(GEO.box, M4(tu + 0.1, 0.775, tv - 0.05, 0.36, 0.005, 0.26, 0.2), 0xd8c8a0);
  colorB.add(new THREE.CylinderGeometry(0.035, 0.025, 0.1, 8), M4(tu + 0.3, 0.82, tv + 0.2, 1, 1, 1), 0xc9a13c);
  wood.addGeometry(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 10), M4(tu + 0.2, 0.45, tv + 0.65, 1, 1, 1));
  for (let k = 0; k < 3; k++) { const a = k * 2.1; wood.addGeometry(new THREE.CylinderGeometry(0.025, 0.025, 0.45, 5), M4(tu + 0.2 + Math.cos(a) * 0.13, 0.22, tv + 0.65 + Math.sin(a) * 0.13, 1, 1, 1)); }
  // оруженосец у входа, рыцарь за столом пишет письмо
  const e = P(R + 0.9, 0, 1.2);
  ctx.people.push({ x: e.x, y: terrain.heightAt(e.x, e.z), z: e.z, yaw: doorYaw + 0.3, role: 'servant' });
  const kn = P(tu + 0.2, 0, tv + 0.65);
  ctx.people.push({ x: kn.x, y: y0 + 0.5, z: kn.z, yaw: Math.atan2(-s.x, -s.z), role: 'knight', pose: 'sit', seed: 1777 });
  const mat = pbrMaterial('canvas', { vertexColors: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(cloth.build(), mat);
  // парусина просвечивает: шатёр не затеняет сам себя, внутри светло
  mesh.castShadow = false; mesh.receiveShadow = true;
  mesh.name = 'yard-pavilion';
  scene.add(mesh);
  // точка экскурсии: заглянуть в шатёр через вход
  const tgt = P(-1.2, 1.0, 0), pos = P(R + 3.2, 2.0, 1.6);
  return { mesh, stop: { tgt, pos } };
}

// Набор ткани для других мест (турнир): шатры и навесы из той же парусины
export function clothKit(ctx, face = 0) {
  const cloth = new ClothB(1.6);
  const kit = tentKit(ctx, cloth, face);
  const quad = (pts, nrm, col) => {
    const cc = rgbOf(col);
    const d01 = pts[0].distanceTo(pts[1]), d03 = pts[0].distanceTo(pts[3]);
    const ids = pts.map((q, i) => cloth.v(q, nrm, [0, d01, d01, 0][i], [0, 0, d03, d03][i], cc));
    // лицевая сторона — туда, куда смотрит нормаль (иначе при двусторонней ткани верх тёмный)
    const gn = pts[1].clone().sub(pts[0]).cross(pts[3].clone().sub(pts[0]));
    if (gn.dot(nrm) >= 0) cloth.quad(ids[0], ids[1], ids[2], ids[3]);
    else cloth.quad(ids[0], ids[3], ids[2], ids[1]);
  };
  return {
    ...kit, quad, cloth,
    finish(scene, name = 'extras') {
      if (!cloth.pos.length) return null;
      const mesh = new THREE.Mesh(cloth.build(), pbrMaterial('canvas', { vertexColors: true, side: THREE.DoubleSide }));
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = name;
      scene.add(mesh);
      return mesh;
    },
  };
}
