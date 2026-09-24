// Этап 2: крепостная стена по кромке вершины.
// Каменная кладка (PBR), скошенный цоколь, зубцы с бойницами, деревянный
// боевой ход с перилами на кронштейнах, хурды (деревянные галереи) на части
// стен, каменные лестницы со двора, мох у основания и потёки на кладке.
import * as THREE from 'three';
import { plateauRadius, WALL, WALL_NODES, insideTower } from './layout.js';
import { pbrMaterial, macroNoiseTexture } from './textures.js';
import { createNoise2D, mulberry32 } from './noise.js';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);
const nWall = createNoise2D(8080);

// ---------------------------------------------------------------------------
// Построитель геометрии: четырёхугольники и брусья с UV в метрах
// ---------------------------------------------------------------------------
class GeoBuilder {
  constructor(tile) {
    this.tile = tile; // метров на повтор текстуры
    this.pos = []; this.nrm = []; this.uv = []; this.aux = []; this.idx = [];
  }
  vert(p, n, u, v, a) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u / this.tile, v / this.tile);
    this.aux.push(a);
    return this.pos.length / 3 - 1;
  }
  // p0..p3 — по контуру; n — нужная нормаль; uvs — в метрах; a — «высота над землёй» (для мха)
  quad(p0, p1, p2, p3, n, uvs, a = [9, 9, 9, 9]) {
    const e1 = new V3().subVectors(p1, p0), e2 = new V3().subVectors(p3, p0);
    const flip = new V3().crossVectors(e1, e2).dot(n) < 0;
    const i0 = this.vert(p0, n, uvs[0][0], uvs[0][1], a[0]);
    const i1 = this.vert(p1, n, uvs[1][0], uvs[1][1], a[1]);
    const i2 = this.vert(p2, n, uvs[2][0], uvs[2][1], a[2]);
    const i3 = this.vert(p3, n, uvs[3][0], uvs[3][1], a[3]);
    if (flip) this.idx.push(i0, i2, i1, i0, i3, i2);
    else this.idx.push(i0, i1, i2, i0, i2, i3);
  }
  // четырёхугольник с отдельной нормалью в каждой вершине (гладкие круглые поверхности)
  quad4(ps, ns, uvs, as = [9, 9, 9, 9]) {
    const avg = ns[0].clone().add(ns[1]).add(ns[2]).add(ns[3]);
    const e1 = new V3().subVectors(ps[1], ps[0]), e2 = new V3().subVectors(ps[3], ps[0]);
    const flip = new V3().crossVectors(e1, e2).dot(avg) < 0;
    const ids = ps.map((p, k) => this.vert(p, ns[k], uvs[k][0], uvs[k][1], as[k]));
    if (flip) this.idx.push(ids[0], ids[2], ids[1], ids[0], ids[3], ids[2]);
    else this.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
  }
  // добавить готовую геометрию (с матрицей преобразования)
  addGeometry(geo, matrix) {
    const g = geo.index ? geo : geo;
    const pos = g.getAttribute('position'), nrm = g.getAttribute('normal'), uv = g.getAttribute('uv');
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const base = this.pos.length / 3;
    const p = new V3(), n = new V3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      n.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(n.x, n.y, n.z);
      this.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      this.aux.push(9);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < pos.count; i++) this.idx.push(base + i);
  }
  // Брус: центр c, оси ax/ay/az (единичные), полуразмеры h. Развёртка по граням
  // в мировых координатах; волокна дерева (ось v) идут вдоль длинной оси бруса.
  box(c, ax, ay, az, hx, hy, hz, { grain = false, a = 9, skipBottom = false } = {}) {
    const axes = [[ax, hx], [ay, hy], [az, hz]];
    const longest = hx >= hy && hx >= hz ? 0 : hy >= hz ? 1 : 2;
    for (let f = 0; f < 3; f++) {
      const [N, hn] = axes[f];
      let [A, ha] = axes[(f + 1) % 3];
      let [B, hb] = axes[(f + 2) % 3];
      // для камня: v — по вертикали, если грань вертикальная; для дерева — вдоль волокон
      if (grain ? (f + 1) % 3 === longest : Math.abs(A.y) > Math.abs(B.y)) {
        [A, ha, B, hb] = [B, hb, A, ha];
      }
      for (const s of [1, -1]) {
        if (skipBottom && N.y * s < -0.9) continue;
        const nn = N.clone().multiplyScalar(s);
        const fc = c.clone().addScaledVector(N, hn * s);
        const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) =>
          fc.clone().addScaledVector(A, ha * i).addScaledVector(B, hb * j)
        );
        const uvs = pts.map((p) => [p.dot(A), p.dot(B)]);
        this.quad(pts[0], pts[1], pts[2], pts[3], nn, uvs, [a, a, a, a]);
      }
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aGround', new THREE.Float32BufferAttribute(this.aux, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------------------
// Трасса стены: узлы (башни, ворота) + промежуточные изломы по кромке вершины
// ---------------------------------------------------------------------------
function wallPoint(deg) {
  const t = (deg * Math.PI) / 180;
  const r = plateauRadius(t) - WALL.inset;
  return new V3(Math.cos(t) * r, 0, Math.sin(t) * r);
}

function buildTrace() {
  const nodes = WALL_NODES.map((n) => ({ ...n, p: wallPoint(n.deg) }));
  const pts = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i], b = nodes[(i + 1) % nodes.length];
    pts.push({ p: a.p, node: a });
    let d1 = b.deg - a.deg;
    if (d1 < 0) d1 += 360;
    // излом там, где прямая заметно отходит от кромки
    for (const f of [0.33, 0.66]) {
      const deg = a.deg + d1 * f;
      const edge = wallPoint(deg);
      const onLine = a.p.clone().lerp(b.p, f);
      if (edge.distanceTo(onLine) > 1.6) pts.push({ p: edge, node: null });
    }
  }
  // разрыв у ворот: трасса начинается и заканчивается у проёма
  const gi = pts.findIndex((q) => q.node && q.node.type === 'gate');
  const ordered = [...pts.slice(gi + 1), ...pts.slice(0, gi)];
  const g = pts[gi].p;
  const next = ordered[0].p, prev = ordered[ordered.length - 1].p;
  const start = g.clone().add(next.clone().sub(g).setLength(WALL.gateHalfGap));
  const end = g.clone().add(prev.clone().sub(g).setLength(WALL.gateHalfGap));
  return [{ p: start, node: null, cap: true }, ...ordered, { p: end, node: null, cap: true }];
}

// ---------------------------------------------------------------------------
export function createWalls(scene, terrain) {
  const trace = buildTrace();
  const n = trace.length;
  const P = trace.map((t) => t.p);
  // нормали сегментов (наружу — от центра) и «митры» в узлах
  const segDir = [], segNrm = [], segLen = [];
  for (let i = 0; i < n - 1; i++) {
    const d = P[i + 1].clone().sub(P[i]);
    segLen.push(d.length());
    d.normalize();
    segDir.push(d);
    let nn = new V3(d.z, 0, -d.x);
    const mid = P[i].clone().add(P[i + 1]).multiplyScalar(0.5);
    if (nn.dot(mid) < 0) nn.negate();
    segNrm.push(nn);
  }
  const miter = [];
  for (let i = 0; i < n; i++) {
    const a = segNrm[Math.max(0, i - 1)], b = segNrm[Math.min(n - 2, i)];
    const m = a.clone().add(b).normalize();
    miter.push(m.multiplyScalar(1 / Math.max(0.5, m.dot(b))));
  }
  const off = (i, d) => P[i].clone().addScaledVector(miter[i], d);
  const T = WALL.thickness;

  // высота боевого хода: земля во дворе + 8.5 м, сглаженная вдоль стены
  let walk = P.map((p, i) => {
    const inside = off(i, -T / 2 - 2);
    return terrain.heightAt(inside.x, inside.z) + WALL.walkHeight;
  });
  for (let it = 0; it < 4; it++) walk = walk.map((w, i) => (walk[Math.max(0, i - 1)] + w * 2 + walk[Math.min(n - 1, i + 1)]) / 4);
  // длина вдоль стены (для развёртки текстуры)
  const sAt = [0];
  for (let i = 0; i < n - 1; i++) sAt.push(sAt[i] + segLen[i]);

  const stoneMat = wallMaterial();
  const woodMat = pbrMaterial('wood', { color: 0x9a8a78 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0b0a09, roughness: 1 });
  const stone = new GeoBuilder(stoneMat.userData.tileMeters);
  const wood = new GeoBuilder(woodMat.userData.tileMeters);
  const dark = new GeoBuilder(1);
  const rnd = mulberry32(2024);

  const sill = WALL.parapetSill, mTop = WALL.merlonHeight, pT = WALL.parapetThick;
  // уровень земли снаружи и внутри в точке стены
  const groundOut = (p, nrm) => Math.min(
    terrain.heightAt(p.x + nrm.x * 0.6, p.z + nrm.z * 0.6),
    terrain.heightAt(p.x + nrm.x * 2.0, p.z + nrm.z * 2.0)
  ) - 0.9;
  const groundIn = (p, nrm) => terrain.heightAt(p.x - nrm.x * 0.6, p.z - nrm.z * 0.6) - 0.5;
  // лёгкая неровность кладки (выпуклости ±4 см)
  const bump = (p) => nWall(p.x * 0.35 + p.y * 0.2, p.z * 0.35 - p.y * 0.25) * 0.04;

  // ---------- основная масса стены: сегмент за сегментом ----------
  for (let i = 0; i < n - 1; i++) {
    const N = segNrm[i];
    const L = segLen[i];
    const cols = Math.max(2, Math.ceil(L / 1.0));
    for (let c = 0; c < cols; c++) {
      const t0 = c / cols, t1 = (c + 1) / cols;
      const lerpOff = (t, d) => off(i, d).lerp(off(i + 1, d), t);
      const wy = (t) => walk[i] + (walk[i + 1] - walk[i]) * t;
      const s0 = sAt[i] + L * t0, s1 = sAt[i] + L * t1;
      // --- внешняя грань: цоколь со скосом + стена до бруствера ---
      const o0 = lerpOff(t0, T / 2), o1 = lerpOff(t1, T / 2);
      const b0 = groundOut(o0, N), b1 = groundOut(o1, N);
      const top0 = wy(t0) + sill, top1 = wy(t1) + sill;
      const batterH = 2.6, batter = 0.55;
      // ряды по высоте (для неровности и мха)
      const rowsY = (b, top) => {
        const ys = [b, Math.min(top, b + 0.8), Math.min(top, b + batterH)];
        for (let y = b + batterH + 1.6; y < top - 0.4; y += 1.6) ys.push(y);
        ys.push(top);
        return ys;
      };
      const ya = rowsY(b0, top0), yb = rowsY(b1, top1);
      const rows = Math.max(ya.length, yb.length);
      const yAt = (arr, k, top) => (k < arr.length ? arr[k] : top);
      for (let k = 0; k < rows - 1; k++) {
        const y00 = yAt(ya, k, top0), y01 = yAt(ya, k + 1, top0);
        const y10 = yAt(yb, k, top1), y11 = yAt(yb, k + 1, top1);
        const outAt = (o, y, b, t) => {
          const h = y - b;
          const extra = h < batterH ? batter * (1 - h / batterH) : 0;
          const p = o.clone().addScaledVector(N, extra);
          p.y = y;
          // неровность кладки; на стыках сегментов — ноль, чтобы не было щелей
          if (h > 0.9 && y < top0 - 0.3 && t > 0 && t < 1) p.addScaledVector(N, bump(p));
          return p;
        };
        const q0 = outAt(o0, y00, b0, t0), q1 = outAt(o1, y10, b1, t1), q2 = outAt(o1, y11, b1, t1), q3 = outAt(o0, y01, b0, t0);
        const nq = N.clone();
        if (y01 - b0 < batterH + 0.01) nq.addScaledVector(UP, batter / batterH).normalize();
        stone.quad(q0, q1, q2, q3, nq, [[s0, y00], [s1, y10], [s1, y11], [s0, y01]], [y00 - b0 - 0.9, y10 - b1 - 0.9, y11 - b1 - 0.9, y01 - b0 - 0.9]);
      }
      // --- внутренняя грань (со двора) до уровня боевого хода ---
      const i0 = lerpOff(t0, -T / 2), i1 = lerpOff(t1, -T / 2);
      const g0 = groundIn(i0, N), g1 = groundIn(i1, N);
      const w0 = wy(t0), w1 = wy(t1);
      const iy = (g, w) => { const ys = [g]; for (let y = g + 1.6; y < w - 0.4; y += 1.6) ys.push(y); ys.push(w); return ys; };
      const ia = iy(g0, w0), ib = iy(g1, w1);
      const irows = Math.max(ia.length, ib.length);
      for (let k = 0; k < irows - 1; k++) {
        const y00 = yAt(ia, k, w0), y01 = yAt(ia, k + 1, w0), y10 = yAt(ib, k, w1), y11 = yAt(ib, k + 1, w1);
        const at = (p0, y, t) => { const p = p0.clone(); p.y = y; if (y > g0 + 0.5 && t > 0 && t < 1) p.addScaledVector(N, -bump(p)); return p; };
        stone.quad(at(i0, y00, t0), at(i1, y10, t1), at(i1, y11, t1), at(i0, y01, t0), N.clone().negate(),
          [[s0, y00], [s1, y10], [s1, y11], [s0, y01]], [y00 - g0 - 0.5, y10 - g1 - 0.5, y11 - g1 - 0.5, y01 - g0 - 0.5]);
      }
      // --- верх стены под настилом и внутренняя сторона бруствера ---
      const pi0 = lerpOff(t0, T / 2 - pT), pi1 = lerpOff(t1, T / 2 - pT);
      const top = (p, y) => { const q = p.clone(); q.y = y; return q; };
      stone.quad(top(i0, w0), top(i1, w1), top(pi1, w1), top(pi0, w0), UP, [[s0, 0], [s1, 0], [s1, T - pT], [s0, T - pT]]);
      stone.quad(top(pi0, w0), top(pi1, w1), top(pi1, w1 + sill), top(pi0, w0 + sill), N.clone().negate(), [[s0, w0], [s1, w1], [s1, w1 + sill], [s0, w0 + sill]]);
      // верх бруствера (между зубцами) — покрывающий камень
      stone.quad(top(pi0, w0 + sill), top(pi1, w1 + sill), top(o1, w1 + sill), top(o0, w0 + sill), UP, [[s0, 0], [s1, 0], [s1, pT], [s0, pT]]);
    }

    // ---------- зубцы с бойницами ----------
    const step = WALL.merlonWidth + WALL.crenelWidth;
    const count = Math.floor((L - 1.2) / step);
    const start = (L - (count * step - WALL.crenelWidth)) / 2;
    const D = segDir[i];
    for (let m = 0; m < count; m++) {
      const a0 = start + m * step, a1 = a0 + WALL.merlonWidth;
      const tc = (a0 + a1) / 2 / L;
      const baseY = walk[i] + (walk[i + 1] - walk[i]) * tc + sill;
      const hTop = walk[i] + (walk[i + 1] - walk[i]) * tc + mTop + (rnd() - 0.5) * 0.06;
      const center = P[i].clone().addScaledVector(D, (a0 + a1) / 2).addScaledVector(N, T / 2 - pT / 2);
      if (insideTower(center.x, center.z, 1.0)) continue;
      const hw = WALL.merlonWidth / 2, hd = pT / 2 + 0.01;
      const slit = m % 2 === 1;
      if (!slit) {
        stone.box(new V3(center.x, (baseY + hTop) / 2, center.z), D, UP, N, hw, (hTop - baseY) / 2, hd, { skipBottom: true });
      } else {
        // бойница: узкая щель через зубец (видно небо насквозь)
        const sw = 0.07, s0y = baseY + 0.25, s1y = hTop - 0.3;
        for (const side of [-1, 1]) {
          const cx = center.clone().addScaledVector(D, side * (hw + sw) / 2);
          stone.box(new V3(cx.x, (baseY + hTop) / 2, cx.z), D, UP, N, (hw - sw) / 2, (hTop - baseY) / 2, hd, { skipBottom: true });
        }
        stone.box(new V3(center.x, (baseY + s0y) / 2, center.z), D, UP, N, sw, (s0y - baseY) / 2, hd, { skipBottom: true });
        stone.box(new V3(center.x, (s1y + hTop) / 2, center.z), D, UP, N, sw, (hTop - s1y) / 2, hd);
      }
      // слегка выступающий камень-покрытие на зубце
      stone.box(new V3(center.x, hTop + 0.07, center.z), D, UP, N, hw + 0.05, 0.08, hd + 0.05);
    }

    // ---------- бойницы в теле стены (узкие щели в рамке из тёсаного камня) ----------
    const nSlits = Math.floor(L / 7);
    for (let k = 0; k < nSlits; k++) {
      const a = (k + 0.5) * (L / nSlits);
      const tt = a / L;
      const base = P[i].clone().addScaledVector(D, a).addScaledVector(N, T / 2);
      if (insideTower(base.x, base.z, 1.0)) continue;
      const gy = groundOut(base, N) + 0.9;
      const wy0 = walk[i] + (walk[i + 1] - walk[i]) * tt;
      const y = Math.max(gy + 3.2, wy0 - 3.4);
      if (y > wy0 - 1.2) continue;
      const c = new V3(base.x, y, base.z);
      dark.box(c.clone().addScaledVector(N, 0.005), D, UP, N, 0.06, 0.6, 0.02);
      for (const sd of [-1, 1]) stone.box(c.clone().addScaledVector(D, sd * 0.16).addScaledVector(N, 0.02), D, UP, N, 0.1, 0.72, 0.04);
      stone.box(c.clone().addScaledVector(UP, 0.72).addScaledVector(N, 0.02), D, UP, N, 0.26, 0.1, 0.05);
      stone.box(c.clone().addScaledVector(UP, -0.72).addScaledVector(N, 0.02), D, UP, N, 0.26, 0.1, 0.05);
    }
  }

  // ---------- торцы стены у проёма ворот ----------
  for (const [i, sgn] of [[0, -1], [n - 1, 1]]) {
    const D = (i === 0 ? segDir[0] : segDir[n - 2]).clone().multiplyScalar(sgn);
    const N = i === 0 ? segNrm[0] : segNrm[n - 2];
    const o = off(i, T / 2), inn = off(i, -T / 2);
    const b = Math.min(groundOut(o, N), groundIn(inn, N));
    const w = walk[i];
    const c = P[i].clone();
    stone.box(new V3(c.x, (b + w + sill) / 2, c.z), N, UP, D, T / 2, (w + sill - b) / 2, 0.01);
  }

  // ---------- деревянный боевой ход: настил, кронштейны, перила ----------
  const over = 0.95; // вынос настила внутрь двора
  for (let i = 0; i < n - 1; i++) {
    const N = segNrm[i], D = segDir[i], L = segLen[i];
    const inner = -T / 2 - over, outer = T / 2 - pT;
    const nPieces = Math.max(1, Math.round(L / 1.5));
    for (let k = 0; k < nPieces; k++) {
      const a0 = (k / nPieces) * L, a1 = ((k + 1) / nPieces) * L;
      const tm = (a0 + a1) / 2 / L;
      const y = walk[i] + (walk[i + 1] - walk[i]) * tm + 0.05;
      const c = P[i].clone().addScaledVector(D, (a0 + a1) / 2).addScaledVector(N, (inner + outer) / 2);
      if (insideTower(c.x, c.z, 0.2)) continue;
      // настил: доски вдоль стены
      wood.box(new V3(c.x, y, c.z), D, UP, N, (a1 - a0) / 2 + 0.02, 0.05, (outer - inner) / 2, { grain: true });
    }
    // кронштейны (балки с подкосами) и стойки перил
    const nPosts = Math.max(2, Math.round(L / 1.9));
    for (let k = 0; k <= nPosts; k++) {
      const a = 0.25 + (k / nPosts) * (L - 0.5);
      const tt = a / L;
      const y = walk[i] + (walk[i + 1] - walk[i]) * tt;
      const face = P[i].clone().addScaledVector(D, a).addScaledVector(N, -T / 2);
      if (insideTower(face.x - N.x * over, face.z - N.z * over, 0.3)) continue;
      // балка под настилом
      const beamC = face.clone().addScaledVector(N, -over / 2 + 0.25);
      wood.box(new V3(beamC.x, y - 0.12, beamC.z), N, UP, D, over / 2 + 0.25, 0.1, 0.08, { grain: true });
      // подкос
      const br = face.clone().addScaledVector(N, -over * 0.45);
      const bAxis = new V3().addScaledVector(N, -0.62).addScaledVector(UP, 0.78).normalize();
      const bSide = new V3().crossVectors(bAxis, D).normalize();
      wood.box(new V3(br.x, y - 0.75, br.z), bAxis, D, bSide, 0.62, 0.06, 0.06, { grain: true });
      // стойка перил
      const post = face.clone().addScaledVector(N, -over + 0.06);
      wood.box(new V3(post.x, y + 0.55, post.z), UP, D, N, 0.55, 0.055, 0.055, { grain: true });
    }
    // поручни (верхний и средний) — отрезками между стойками, чтобы не заходить в башни
    const slope = new V3().addScaledVector(D, L).addScaledVector(UP, walk[i + 1] - walk[i]).normalize();
    const nRail = Math.max(1, Math.round(L / 1.9));
    for (let k = 0; k < nRail; k++) {
      const a = ((k + 0.5) / nRail) * L;
      const c = P[i].clone().addScaledVector(D, a).addScaledVector(N, -T / 2 - over + 0.06);
      if (insideTower(c.x, c.z, 0.4)) continue;
      const yb = walk[i] + (walk[i + 1] - walk[i]) * (a / L);
      for (const [h, r] of [[1.05, 0.05], [0.55, 0.035]]) {
        wood.box(new V3(c.x, yb + h, c.z), slope, UP, N, L / nRail / 2 + 0.02, r, r, { grain: true });
      }
    }
  }

  // ---------- хурды: деревянные галереи снаружи на двух участках ----------
  const hoardSegs = pickHoardingSegments(trace, segLen, segNrm);
  for (const i of hoardSegs) buildHoarding(wood, stone, P[i], segDir[i], segNrm[i], segLen[i], walk[i], walk[i + 1], T);

  // ---------- каменные лестницы со двора на стену ----------
  const stairSegs = pickStairSegments(segLen, segNrm, trace);
  for (const i of stairSegs) buildStairs(stone, terrain, P[i], segDir[i], segNrm[i], segLen[i], walk[i], walk[i + 1], T, over);

  const meshes = [
    new THREE.Mesh(stone.build(), stoneMat),
    new THREE.Mesh(wood.build(), woodMat),
    new THREE.Mesh(dark.build(), darkMat),
  ];
  for (const m of meshes) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = 'walls';
    scene.add(m);
  }
  // высота боевого хода в ближайшей точке трассы (для башен и ворот)
  function walkAt(x, z) {
    let best = 0, bd = Infinity;
    P.forEach((p, i) => { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = i; } });
    return walk[best];
  }
  return {
    trace, walk, walkAt, segDir, segNrm, points: P,
    stoneMaterial: stoneMat, woodMaterial: woodMat,
    update() {},
  };
}

// Хурды — на длинных сегментах напротив ворот (северная сторона)
function pickHoardingSegments(trace, segLen, segNrm) {
  const out = [];
  segNrm.forEach((nrm, i) => {
    if (segLen[i] > 12 && nrm.z < -0.35) out.push(i);
  });
  return out.slice(0, 3);
}

function pickStairSegments(segLen, segNrm, trace) {
  const cand = segLen.map((L, i) => ({ L, i })).filter((q) => q.L > 16);
  // по одной лестнице на восточной, западной и северной сторонах
  const pick = [];
  for (const test of [(v) => v.x > 0.5, (v) => v.x < -0.5, (v) => v.z < -0.6]) {
    const c = cand.find((q) => test(segNrm[q.i]) && !pick.includes(q.i));
    if (c) pick.push(c.i);
  }
  return pick;
}

function buildHoarding(wood, stone, P0, D, N, L, w0, w1, T) {
  const out = 1.7; // вынос галереи
  const H = 2.5;
  let a0 = 1.5, a1 = L - 1.5;
  const at = (a) => P0.clone().addScaledVector(D, a).addScaledVector(N, T / 2 + 0.8);
  while (a0 < L / 2 && insideTower(at(a0).x, at(a0).z, 1.2)) a0 += 0.25;
  while (a1 > L / 2 && insideTower(at(a1).x, at(a1).z, 1.2)) a1 -= 0.25;
  if (a1 - a0 < 4) return;
  const n = Math.max(2, Math.round((a1 - a0) / 1.6));
  const yAt = (a) => w0 + (w1 - w0) * (a / L);
  const face = (a) => P0.clone().addScaledVector(D, a).addScaledVector(N, T / 2);
  for (let k = 0; k <= n; k++) {
    const a = a0 + (k / n) * (a1 - a0);
    const y = yAt(a);
    const f = face(a);
    // консольная балка, пропущенная сквозь стену, и подкос к кладке
    const bc = f.clone().addScaledVector(N, out / 2);
    wood.box(new V3(bc.x, y - 0.25, bc.z), N, UP, D, out / 2 + 0.3, 0.12, 0.1, { grain: true });
    const brAxis = new V3().addScaledVector(N, 0.6).addScaledVector(UP, 0.8).normalize();
    const brSide = new V3().crossVectors(brAxis, D).normalize();
    const brc = f.clone().addScaledVector(N, out * 0.4);
    wood.box(new V3(brc.x, y - 1.0, brc.z), brAxis, D, brSide, 0.8, 0.07, 0.07, { grain: true });
    // стойка внешней стенки
    const pc = f.clone().addScaledVector(N, out - 0.05);
    wood.box(new V3(pc.x, y - 0.1 + H / 2, pc.z), UP, D, N, H / 2, 0.08, 0.08, { grain: true });
  }
  // пол, внешняя стенка из вертикальных досок с бойницами, крыша
  const pieces = Math.max(1, Math.round((a1 - a0) / 2));
  for (let k = 0; k < pieces; k++) {
    const s0 = a0 + (k / pieces) * (a1 - a0), s1 = a0 + ((k + 1) / pieces) * (a1 - a0);
    const am = (s0 + s1) / 2, y = yAt(am);
    const hl = (s1 - s0) / 2;
    const fl = face(am).addScaledVector(N, out / 2);
    wood.box(new V3(fl.x, y - 0.1, fl.z), D, UP, N, hl + 0.01, 0.05, out / 2, { grain: true });
    const wl = face(am).addScaledVector(N, out);
    // стенка с узкой смотровой щелью посередине
    const gap = 0.12;
    for (const side of [-1, 1]) {
      const c = wl.clone().addScaledVector(D, side * (hl + gap) / 2);
      wood.box(new V3(c.x, y - 0.05 + H / 2, c.z), UP, D, N, H / 2, (hl - gap) / 2, 0.04, { grain: true });
    }
    wood.box(new V3(wl.x, y + 0.35, wl.z), UP, D, N, 0.4, gap / 2 + 0.01, 0.04, { grain: true });
    wood.box(new V3(wl.x, y + H - 0.3, wl.z), UP, D, N, 0.25, gap / 2 + 0.01, 0.04, { grain: true });
    // односкатная крыша от стены наружу
    const r0 = face(am).addScaledVector(N, -0.2);
    r0.y = y + WALL.merlonHeight + 0.6;
    const r1 = face(am).addScaledVector(N, out + 0.35);
    r1.y = y + H - 0.15;
    const rc = r0.clone().add(r1).multiplyScalar(0.5);
    const along = r1.clone().sub(r0);
    const rl = along.length() / 2;
    along.normalize();
    const rn = new V3().crossVectors(D, along).normalize();
    wood.box(rc, along, D, rn.y < 0 ? rn.negate() : rn, rl, hl + 0.02, 0.04, { grain: true });
  }
  // торцевые стенки галереи
  for (const a of [a0, a1]) {
    const y = yAt(a);
    const c = face(a).addScaledVector(N, out / 2);
    wood.box(new V3(c.x, y - 0.05 + H / 2, c.z), UP, N, D, H / 2, out / 2, 0.04, { grain: true });
  }
}

function buildStairs(stone, terrain, P0, D, N, L, w0, w1, T, over) {
  const width = 1.25;
  const rise = 0.24, run = 0.3;
  const aTop = L * 0.62;
  const yTop = w0 + (w1 - w0) * (aTop / L);
  // лестница вдоль внутренней стены, поднимается к боевому ходу (под настил)
  const inner = P0.clone().addScaledVector(D, aTop).addScaledVector(N, -T / 2 - over - width / 2 - 0.05);
  const g = terrain.heightAt(inner.x, inner.z);
  const steps = Math.ceil((yTop - g) / rise);
  for (let k = 0; k < steps; k++) {
    const y = yTop - k * rise;
    const c = inner.clone().addScaledVector(D, -k * run);
    const gy = terrain.heightAt(c.x, c.z) - 0.4;
    if (y < gy + 0.3 || insideTower(c.x, c.z, 1.5)) break;
    stone.box(new V3(c.x, (y + gy) / 2, c.z), D, UP, N, run / 2 + 0.01, (y - gy) / 2, width / 2, { a: 9 });
  }
  // площадка наверху, примыкает к настилу
  const top = P0.clone().addScaledVector(D, aTop + 0.6).addScaledVector(N, -T / 2 - over - width / 2 - 0.05);
  const gy = terrain.heightAt(top.x, top.z) - 0.4;
  stone.box(new V3(top.x, (yTop + gy) / 2, top.z), D, UP, N, 0.6, (yTop - gy) / 2, width / 2);
}

// ---------------------------------------------------------------------------
// Материал кладки: PBR-текстура + мох у основания, потёки и выветривание
// ---------------------------------------------------------------------------
function wallMaterial() {
  const mat = pbrMaterial('wallStone');
  const macro = macroNoiseTexture();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tMacro = { value: macro };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGround;\nvarying float vGround;\nvarying vec3 vWallW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = aGround;\nvWallW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tMacro;\nvarying float vGround;\nvarying vec3 vWallW;\nfloat gMoss;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec3 m1 = texture2D(tMacro, vWallW.xz * 0.05 + vWallW.y * 0.02).rgb;
          vec3 m2 = texture2D(tMacro, vec2(vWallW.x * 0.35 + vWallW.z * 0.35, vWallW.y * 0.03)).rgb;
          // разнотонность кладки на больших участках
          diffuseColor.rgb *= 0.88 + 0.24 * m1.r;
          // потёки сверху вниз
          float streak = smoothstep(0.55, 0.8, m2.g) * 0.35;
          diffuseColor.rgb *= 1.0 - streak * vec3(0.45, 0.42, 0.38);
          // мох и сырость у основания
          gMoss = (1.0 - smoothstep(0.0, 1.6 + m1.g * 1.4, vGround)) * smoothstep(0.35, 0.6, m1.b + 0.15);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.14, 0.05) * (0.7 + m2.r * 0.6), gMoss * 0.8);
          diffuseColor.rgb *= 1.0 - (1.0 - smoothstep(0.0, 0.8, vGround)) * 0.25;
        }`
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 1.0, gMoss);');
  };
  mat.customProgramCacheKey = () => 'wall-stone';
  return mat;
}

export { GeoBuilder };
