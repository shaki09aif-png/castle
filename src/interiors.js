// Интерьеры построек: кухня, казарма, часовня, склад, амбар, мельница и
// крестьянские дома. Каждое здание — своя маленькая группа сеток, которая
// рисуется, только когда камера рядом (вдали интерьеры не стоят ни кадра).
// Свет внутри «запечён» в вершины: тёплый отсвет очага и свечей, дневной свет
// из дверей и окон, темнее в углах и под закопчённой крышей. Огонь мерцает в
// шейдере — настоящих источников света нет, поэтому это почти бесплатно.
import * as THREE from 'three';
import { GeoBuilder } from './walls.js';
import { ColorBuilder, person } from './people.js';
import { INTERIORS } from './courtyard.js';
import { chicken } from './details.js';
import { mulberry32 } from './noise.js';
import { pbrMaterial } from './textures.js';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
  cylLo: new THREE.CylinderGeometry(1, 1, 1, 7),
  cyl5: new THREE.CylinderGeometry(1, 1, 1, 5),
  sph: new THREE.SphereGeometry(1, 10, 7),
  sphLo: new THREE.SphereGeometry(1, 7, 5),
  cone: new THREE.ConeGeometry(1, 1, 8),
  flame: new THREE.ConeGeometry(1, 1, 7),
  torus: new THREE.TorusGeometry(1, 0.35, 5, 10),
  barrel: (() => {
    const pts = [];
    for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push(new THREE.Vector2(0.29 + 0.07 * Math.sin(t * Math.PI), t * 0.95)); }
    return new THREE.LatheGeometry(pts, 12);
  })(),
  // глиняный кувшин и горшок (профиль вращения)
  jug: new THREE.LatheGeometry([[0, 0], [0.55, 0], [0.8, 0.2], [0.85, 0.45], [0.6, 0.72], [0.38, 0.85], [0.42, 1.0], [0.36, 1.0]].map(([x, y]) => new THREE.Vector2(x, y)), 10),
  pot: new THREE.LatheGeometry([[0, 0], [0.6, 0.02], [0.95, 0.35], [0.9, 0.7], [0.75, 0.9], [0.82, 1.0], [0.7, 1.0]].map(([x, y]) => new THREE.Vector2(x, y)), 12),
  bowl: new THREE.LatheGeometry([[0, 0], [0.55, 0], [0.9, 0.45], [1.0, 1.0], [0.9, 1.0], [0.5, 0.35], [0, 0.3]].map(([x, y]) => new THREE.Vector2(x, y)), 12),
  sack: (() => { const g = new THREE.SphereGeometry(1, 10, 8); const p = g.getAttribute('position'); for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setXYZ(i, p.getX(i) * (1 - 0.25 * Math.max(0, y)), y, p.getZ(i) * (1 - 0.25 * Math.max(0, y))); } g.computeVertexNormals(); return g; })(),
  // одеяло со складками: пластина с волнистым верхом
  blanket: (() => { const g = new THREE.BoxGeometry(1, 1, 1, 8, 1, 3); const p = g.getAttribute('position'); for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); if (p.getY(i) > 0) p.setY(i, 0.5 + 0.35 * (0.6 * Math.sin(x * 19 + z * 3) + 0.4 * Math.cos(z * 9))); } g.computeVertexNormals(); return g; })(),
};

// Всё для одного здания: локальные координаты (lx вдоль, lz поперёк — к фасаду +, y абсолютная)
function kit(it, tiles) {
  const { f } = it;
  const stone = new GeoBuilder(tiles.stone), wood = new GeoBuilder(tiles.wood);
  const daub = new GeoBuilder(tiles.daub), thatch = new GeoBuilder(tiles.thatch), dirt = new GeoBuilder(tiles.dirt);
  const col = new ColorBuilder(), glow = new ColorBuilder(), win = new ColorBuilder();
  const basis = new THREE.Matrix4().makeBasis(f.X, UP, f.N);
  const qB = new THREE.Quaternion().setFromRotationMatrix(basis);
  const M = (lx, y, lz, sx = 1, sy = 1, sz = 1, yaw = 0, rx = 0, rz = 0) =>
    new THREE.Matrix4().compose(f.p(lx, y, lz), qB.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, yaw, rz, 'YXZ'))), new V3(sx, sy, sz));
  const lights = [], day = [];
  // брус между двумя точками (локальные [lx, y, lz]); возвращает базис для цветных версий
  const beamBasis = (a, b) => {
    const pa = f.p(a[0], a[1], a[2]), pb = f.p(b[0], b[1], b[2]);
    const d = pb.clone().sub(pa);
    const len = d.length();
    d.normalize();
    const side = Math.abs(d.y) > 0.9 ? f.X.clone() : UP.clone();
    const n3 = new V3().crossVectors(d, side).normalize();
    const s2 = new V3().crossVectors(n3, d).normalize();
    return { c: pa.lerp(pb, 0.5), d, s2, n3, len };
  };
  const K = {
    f, stone, wood, daub, thatch, dirt, col, glow, win, M, lights, day,
    // цветная коробка: центр, полуразмеры
    cb: (lx, y, lz, hx, hy, hz, c, yaw = 0, rx = 0, rz = 0) => col.add(G.box, M(lx, y, lz, hx * 2, hy * 2, hz * 2, yaw, rx, rz), c),
    // деревянная коробка (текстура дерева)
    wb: (lx, y, lz, hx, hy, hz, grainAlong = 'x') => {
      const ax = grainAlong === 'y' ? [UP, f.X, f.N] : grainAlong === 'z' ? [f.N, UP, f.X] : [f.X, UP, f.N];
      const hs = grainAlong === 'y' ? [hy, hx, hz] : grainAlong === 'z' ? [hz, hy, hx] : [hx, hy, hz];
      wood.box(f.p(lx, y, lz), ax[0], ax[1], ax[2], hs[0], hs[1], hs[2], { grain: true });
    },
    sb: (lx, y, lz, hx, hy, hz) => stone.box(f.p(lx, y, lz), f.X, UP, f.N, hx, hy, hz),
    // деревянный брус от точки до точки
    beam: (a, b, t = 0.07, t2 = t) => { const q = beamBasis(a, b); wood.box(q.c, q.d, q.s2, q.n3, q.len / 2, t2, t, { grain: true }); },
    // цветной «брусок» от точки до точки (верёвки, ножки, черенки)
    rod: (a, b, r, c, geo = G.cyl5) => {
      const q = beamBasis(a, b);
      const m = new THREE.Matrix4().makeBasis(q.s2, q.d, q.n3).scale(new V3(r, q.len, r)).setPosition(q.c);
      col.add(geo, m, c);
    },
    // тонкая пластина от точки до точки (ткань): полуширина w вдоль X, полутолщина t
    slab: (a, b, w, t, c) => {
      const q = beamBasis(a, b);
      col.add(G.box, new THREE.Matrix4().makeBasis(q.s2, q.d, q.n3).scale(new V3(w * 2, q.len, t * 2)).setPosition(q.c), c);
    },
    // четырёхугольник, разбитый на сетку (чтобы запечённый свет ложился плавно).
    // a, b, c, d — локальные точки по контуру, n — локальная нормаль
    grid: (B, a, b, c, d, n, step = 0.45) => {
      const P = [a, b, c, d].map((q) => f.p(q[0], q[1], q[2]));
      const nw = f.d(n[0], n[1], n[2]);
      const lu = P[1].distanceTo(P[0]), lv = P[3].distanceTo(P[0]);
      const nu = Math.max(1, Math.ceil(lu / step)), nv = Math.max(1, Math.ceil(lv / step));
      const e1 = P[1].clone().sub(P[0]), e2 = P[3].clone().sub(P[0]);
      const flip = new V3().crossVectors(e1, e2).dot(nw) < 0;
      const base = B.pos.length / 3;
      const q = new V3(), r = new V3();
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
        const u = i / nu, v = j / nv;
        q.copy(P[0]).lerp(P[1], u);
        r.copy(P[3]).lerp(P[2], u);
        q.lerp(r, v);
        B.vert(q, nw, u * lu, v * lv, 9);
      }
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const i0 = base + j * (nu + 1) + i, i1 = i0 + 1, i3 = i0 + nu + 1, i2 = i3 + 1;
        if (flip) B.idx.push(i0, i2, i1, i0, i3, i2);
        else B.idx.push(i0, i1, i2, i0, i2, i3);
      }
    },
    // цветная плоскость-сетка (пол)
    plane: (lx, y, lz, hx, hz, c) => col.add(new THREE.PlaneGeometry(1, 1, Math.ceil(hx / 0.25), Math.ceil(hz / 0.25)), M(lx, y, lz, hx * 2, hz * 2, 1, 0, -Math.PI / 2), c),
    fire: (lx, y, lz, s, rnd) => {
      for (let k = 0; k < 7; k++) {
        const a = rnd() * 6.28, r = rnd() * 0.22 * s, h = (0.3 + rnd() * 0.45) * s, w = (0.05 + rnd() * 0.05) * s;
        glow.add(G.flame, M(lx + Math.cos(a) * r, y + h / 2, lz + Math.sin(a) * r, w, h, w, rnd() * 3), k < 2 ? 0xffe38a : k < 5 ? 0xffa43a : 0xff6a1a);
      }
      glow.add(G.cylLo, M(lx, y + 0.02, lz, 0.3 * s, 0.03, 0.3 * s), 0xb03a14);
      lights.push({ p: f.p(lx, y + 0.45 * s, lz), k: 2.0 * Math.min(1.2, s), r: 2.3 * s + 0.7 });
    },
    candle: (lx, y, lz, light = true) => {
      col.add(G.cylLo, M(lx, y + 0.08, lz, 0.025, 0.16, 0.025), 0xe8e0c8);
      glow.add(G.flame, M(lx, y + 0.2, lz, 0.015, 0.06, 0.015), 0xffd070);
      if (light) lights.push({ p: f.p(lx, y + 0.22, lz), k: 0.3, r: 0.9 });
    },
    npc: (lx, y, lz, yaw, o) => { const p = f.p(lx, y, lz); person(col, { x: p.x, y: p.y, z: p.z, yaw: Math.atan2(f.N.x, f.N.z) + yaw, ...o }); },
    hen: (lx, y, lz, yaw, rnd) => { const p = f.p(lx, y, lz); chicken(col, p.x, p.y, p.z, Math.atan2(f.N.x, f.N.z) + yaw, rnd); },
    barrel: (lx, y, lz, s = 1) => wood.addGeometry(G.barrel, M(lx, y, lz, s, s, s)),
    sack: (lx, y, lz, s, rnd) => col.add(G.sack, M(lx, y + 0.28 * s, lz, 0.26 * s, 0.32 * s, 0.22 * s, rnd() * 3), [0xc8b48a, 0xb8a47a, 0xd4c49a][Math.floor(rnd() * 3)]),
  };
  return K;
}

// Внутренняя оболочка: стены, потолок из досок на балках, пол
function shell(K, it, { inset = 0.3, floor = null } = {}) {
  const { L, W, floorY } = it;
  const hl = L / 2 - inset, hw = W / 2 - inset;
  const top = (it.eaveY || floorY + 3) - 0.05;
  // стена вдоль X на lz, с проёмами (lx, w, h); nz — нормаль внутрь
  const wall = (lz, x0, x1, holes, nz) => {
    const xs = [x0];
    const hs = [...holes].sort((a, b) => a.lx - b.lx);
    for (const h of hs) xs.push(h.lx - h.w / 2, h.lx + h.w / 2);
    xs.push(x1);
    for (let i = 0; i < xs.length - 1; i++) {
      const a = Math.max(x0, xs[i]), b = Math.min(x1, xs[i + 1]);
      if (b - a < 0.01) continue;
      const hole = i % 2 === 1 ? hs[(i - 1) / 2] : null;
      const y0 = hole ? floorY + hole.h : floorY;
      if (top - y0 < 0.01) continue;
      K.grid(K.stone, [a, y0, lz], [b, y0, lz], [b, top, lz], [a, top, lz], [0, 0, nz]);
    }
  };
  wall(hw, -hl, hl, it.doors || [], -1);
  wall(-hw, -hl, hl, it.backDoor ? [it.backDoor] : [], 1);
  for (const sd of [-1, 1]) K.grid(K.stone, [sd * hl, floorY, -hw], [sd * hl, floorY, hw], [sd * hl, top, hw], [sd * hl, top, -hw], [-sd, 0, 0]);
  // потолок: доски поперёк и балки
  for (let x = -hl; x < hl; x += 0.34) K.wb(x + 0.17, top - 0.02, 0, 0.16, 0.02, hw, 'z');
  for (let x = -hl + 1.2; x < hl - 0.6; x += 2.4) K.wb(x, top - 0.14, 0, 0.1, 0.1, hw, 'z');
  if (floor) { const B = K[floor], fy = floorY + 0.012; K.grid(B, [-hl, fy, hw], [hl, fy, hw], [hl, fy, -hw], [-hl, fy, -hw], [0, 1, 0], 0.5); }
  return { hl, hw, top };
}

// ------------------------- ОБСТАНОВКА ПО ТИПАМ -------------------------
function kitchen(K, it, rnd) {
  const { hl, hw, top } = shell(K, it, { floor: 'stone' });
  const y = it.floorY;
  // очаг у торца (+X): каменный под, колпак, огонь, котёл на цепи
  K.sb(hl - 0.6, y + 0.25, -0.6, 0.55, 0.25, 1.1);
  K.sb(hl - 0.55, y + 1.8, -0.6, 0.6, 0.12, 1.25);
  K.sb(hl - 0.35, (y + 1.9 + top) / 2, -0.6, 0.35, (top - y - 1.9) / 2, 0.8);
  K.fire(hl - 0.6, y + 0.5, -0.6, 1.2, rnd);
  K.col.add(G.sph, K.M(hl - 0.6, y + 1.0, -0.6, 0.32, 0.26, 0.32), 0x2a2622);
  K.col.add(G.cylLo, K.M(hl - 0.6, y + 1.45, -0.6, 0.01, 0.7, 0.01), 0x3a3634);
  // большой стол с едой и две лавки
  K.wb(-0.6, y + 0.8, -0.2, 1.4, 0.05, 0.5);
  for (const [dx, dz] of [[-1.25, -0.4], [1.25, -0.4], [-1.25, 0.4], [1.25, 0.4]]) K.wb(-0.6 + dx, y + 0.38, -0.2 + dz, 0.05, 0.38, 0.05, 'y');
  for (const dz of [-0.95, 0.55]) K.wb(-0.6, y + 0.42, -0.2 + dz, 1.3, 0.04, 0.14);
  for (let k = 0; k < 7; k++) {
    const kind = k % 3;
    const lx = -1.8 + k * 0.4, lz = -0.2 + (rnd() - 0.5) * 0.5;
    if (kind === 0) K.col.add(G.sph, K.M(lx, y + 0.9, lz, 0.14, 0.08, 0.1), 0xb0783a); // хлеб
    else if (kind === 1) { K.col.add(G.cyl, K.M(lx, y + 0.87, lz, 0.13, 0.03, 0.13), 0x8a6a4a); K.col.add(G.sph, K.M(lx, y + 0.9, lz, 0.09, 0.04, 0.09), 0x6a3a1a); }
    else K.col.add(G.cyl, K.M(lx, y + 0.92, lz, 0.06, 0.18, 0.06), 0x7a5a3a); // кувшин
  }
  // полки с горшками у задней стены
  for (const sy of [1.3, 1.8]) {
    K.wb(-1.8, y + sy, -hw + 0.18, 1.3, 0.025, 0.16);
    for (let k = 0; k < 6; k++) K.col.add(G.cyl, K.M(-2.9 + k * 0.42, y + sy + 0.12, -hw + 0.18, 0.1, 0.2, 0.1), [0x8a4a2a, 0x6a5a4a, 0x9a6a3a][k % 3]);
  }
  // окорока и пучки трав под балками
  for (let k = 0; k < 5; k++) {
    const lx = -2.4 + k * 0.9;
    K.col.add(G.cylLo, K.M(lx, top - 0.35, 0.8, 0.005, 0.4, 0.005), 0x6a5a40);
    if (k % 2) K.col.add(G.sph, K.M(lx, top - 0.7, 0.8, 0.12, 0.2, 0.1), 0x8a3a24);
    else K.col.add(G.cone, K.M(lx, top - 0.65, 0.8, 0.1, 0.3, 0.1, 0, Math.PI), 0x5a7a3a);
  }
  for (const [lx, lz] of [[-hl + 0.4, -hw + 0.4], [-hl + 0.4, -hw + 1.05]]) K.barrel(lx, y, lz);
  K.sack(-hl + 1.1, y, -hw + 0.4, 1, rnd);
  K.npc(0.4, y, -0.9, Math.PI, { role: 'woman', pose: 'work', item: null, seed: 801 });
  K.npc(hl - 1.6, y, 0.4, -Math.PI / 2, { role: 'servant', item: 'bucket', seed: 802 });
}

function barracks(K, it, rnd) {
  const { hl, hw } = shell(K, it, { floor: 'wood' });
  const y = it.floorY;
  // двухъярусные нары вдоль задней стены
  for (let k = 0; k < 5; k++) {
    const lx = -hl + 1.2 + k * 2.2;
    for (const lvl of [0, 1]) {
      const by = y + 0.4 + lvl * 1.3;
      K.wb(lx, by, -hw + 0.5, 0.95, 0.06, 0.45);
      K.cb(lx, by + 0.1, -hw + 0.5, 0.9, 0.05, 0.4, 0xb8a46a); // соломенный тюфяк
      K.cb(lx + 0.2, by + 0.16, -hw + 0.5, 0.6, 0.03, 0.42, [0x7a2a24, 0x3a4a6a, 0x5a5a3a][(k + lvl) % 3]); // одеяло
    }
    for (const dx of [-0.95, 0.95]) for (const dz of [0.05, 0.95]) K.wb(lx + dx, y + 1.0, -hw + dz, 0.05, 1.0, 0.05, 'y');
    K.wb(lx, y + 0.2, -hw + 1.15, 0.4, 0.2, 0.2); // сундук
  }
  // стол с кружками и костями, лавки, двое стражников
  K.wb(0, y + 0.78, 0.9, 1.2, 0.05, 0.45);
  for (const [dx, dz] of [[-1.1, -0.35], [1.1, -0.35], [-1.1, 0.35], [1.1, 0.35]]) K.wb(dx, y + 0.37, 0.9 + dz, 0.05, 0.37, 0.05, 'y');
  for (const dz of [0.3, 1.5]) K.wb(0, y + 0.42, dz, 1.1, 0.04, 0.13);
  for (let k = 0; k < 4; k++) K.col.add(G.cylLo, K.M(-0.8 + k * 0.5, y + 0.9, 0.9 + (rnd() - 0.5) * 0.3, 0.05, 0.13, 0.05), 0x8a6a4a);
  for (let k = 0; k < 3; k++) K.cb(0.1 + k * 0.05, y + 0.85, 0.95, 0.015, 0.015, 0.015, 0xe8e0d0);
  K.npc(-0.5, y + 0.47, 0.3, 0, { role: 'guard', pose: 'sit', item: null, seed: 811 });
  K.npc(0.6, y + 0.47, 1.5, Math.PI, { role: 'guard', pose: 'sit', item: null, seed: 812 });
  // стойка с копьями и щиты на торцевой стене
  for (let k = 0; k < 5; k++) K.col.add(G.cylLo, K.M(hl - 0.25, y + 1.2, -1.2 + k * 0.3, 0.02, 2.4, 0.02, 0, 0, 0.08), 0x5a3e24);
  K.wb(hl - 0.25, y + 0.9, -0.6, 0.06, 0.05, 0.9);
  for (let k = 0; k < 3; k++) K.col.add(G.cyl, K.M(hl - 0.08, y + 1.6, 0.6 + k * 0.7, 0.28, 0.03, 0.28, 0, 0, Math.PI / 2), [0x7a1c1c, 0x1d3f8a, 0xd6a632][k]);
  // фонарь на балке
  K.col.add(G.box, K.M(0, it.eaveY - 0.7, 0.9, 0.18, 0.25, 0.18), 0x2a2622);
  K.glow.add(G.flame, K.M(0, it.eaveY - 0.75, 0.9, 0.04, 0.12, 0.04), 0xffc060);
  K.lights.push({ p: K.f.p(0, it.eaveY - 0.75, 0.9), k: 0.9, r: 2.2 });
}

function chapel(K, it, rnd) {
  const { hl, hw } = shell(K, it, { floor: 'stone' });
  const y = it.floorY;
  // алтарь у восточной стены (+X): ступень, камень, покров, крест и свечи
  K.sb(hl - 1.0, y + 0.08, 0, 1.0, 0.08, 1.6);
  K.sb(hl - 0.7, y + 0.6, 0, 0.45, 0.45, 1.0);
  K.cb(hl - 0.7, y + 1.06, 0, 0.47, 0.012, 1.02, 0xf0ece0);
  K.cb(hl - 0.3, y + 1.06, 0, 0.1, 0.12, 1.03, 0x8a1c1c); // алтарный покров спереди
  K.col.add(G.box, K.M(hl - 0.8, y + 1.45, 0, 0.04, 0.7, 0.04), 0xc8a040);
  K.col.add(G.box, K.M(hl - 0.8, y + 1.6, 0, 0.04, 0.04, 0.34), 0xc8a040);
  for (const dz of [-0.7, 0.7]) { K.col.add(G.cyl, K.M(hl - 0.8, y + 1.12, dz, 0.06, 0.08, 0.06), 0xc8a040); K.candle(hl - 0.8, y + 1.16, dz); }
  // скамьи, купель у входа, аналой
  for (let k = 0; k < 4; k++) {
    const lx = -1.5 + k * 1.3;
    for (const sd of [-1, 1]) {
      K.wb(lx, y + 0.45, sd * 1.6, 0.2, 0.03, 1.1);
      for (const dz of [-0.9, 0.9]) K.wb(lx, y + 0.22, sd * 1.6 + dz, 0.18, 0.22, 0.04);
    }
  }
  K.sb(-hl + 1.4, y + 0.45, 1.2, 0.35, 0.45, 0.35);
  K.col.add(G.cyl, K.M(-hl + 1.4, y + 0.92, 1.2, 0.32, 0.04, 0.32), 0x4a6a7a);
  K.wb(hl - 2.2, y + 0.6, -1.5, 0.08, 0.6, 0.08, 'y');
  K.wb(hl - 2.2, y + 1.22, -1.5, 0.25, 0.03, 0.2);
  K.npc(hl - 1.6, y + 0.16, 0, -Math.PI / 2 + Math.PI, { role: 'priest', seed: 821 });
  K.npc(-0.2, y, -1.6, Math.PI / 2 + Math.PI, { role: 'townswoman', pose: 'work', seed: 822 });
  K.npc(1.1, y, 1.6, Math.PI / 2 + Math.PI, { role: 'peasant', item: null, seed: 823 });
  // свечи на стенах
  for (const lx of [-3, 0, 3]) for (const sd of [-1, 1]) {
    K.col.add(G.box, K.M(lx, y + 2.1, sd * (hw - 0.08), 0.1, 0.05, 0.1), 0x3a3634);
    K.candle(lx, y + 2.13, sd * (hw - 0.1));
  }
  // гобелен-хоругви на стене
  for (const lx of [-2.2, 2.2]) K.cb(lx, y + 2.6, -hw + 0.06, 0.45, 0.8, 0.01, lx < 0 ? 0x1d3f8a : 0x7a1c1c);
}

function store(K, it, rnd) {
  const hl = it.L / 2 - 0.2, hw = it.W / 2 - 0.15, y = it.floorY;
  for (let x = -hl; x < hl; x += 0.34) K.wb(x + 0.17, it.eaveY - 0.07, 0, 0.16, 0.02, hw, 'z');
  // штабели ящиков, ряд бочек, мешки, полки, весы
  for (let k = 0; k < 6; k++) {
    const lx = -hl + 0.5 + (k % 3) * 0.75, lvl = Math.floor(k / 3);
    K.wb(lx, y + 0.3 + lvl * 0.6, -hw + 0.5, 0.33, 0.3, 0.33);
  }
  for (let k = 0; k < 4; k++) K.barrel(hl - 0.5, y, -hw + 0.5 + k * 0.7);
  for (let k = 0; k < 3; k++) K.barrel(hl - 0.5, y + 0.95, -hw + 0.85 + k * 0.7, 0.95);
  for (let k = 0; k < 7; k++) K.sack(-0.6 + (k % 4) * 0.45, y + Math.floor(k / 4) * 0.4, -hw + 0.4 + (k % 2) * 0.3, 1, rnd);
  for (const sy of [1.4, 2.0]) K.wb(0, y + sy, -hw + 0.2, 1.2, 0.025, 0.17);
  for (let k = 0; k < 8; k++) K.col.add(G.cyl, K.M(-1.1 + k * 0.3, y + 1.54, -hw + 0.2, 0.09, 0.2, 0.09), [0x8a4a2a, 0x6a5a4a, 0x9a8060][k % 3]);
  K.wb(-1.8, y + 0.8, 0.6, 0.5, 0.04, 0.35);
  for (const [dx, dz] of [[-0.45, -0.3], [0.45, -0.3], [-0.45, 0.3], [0.45, 0.3]]) K.wb(-1.8 + dx, y + 0.39, 0.6 + dz, 0.04, 0.39, 0.04, 'y');
  K.col.add(G.cylLo, K.M(-1.8, y + 1.05, 0.6, 0.015, 0.45, 0.015), 0x3a3634); // весы
  K.col.add(G.box, K.M(-1.8, y + 1.28, 0.6, 0.5, 0.02, 0.02), 0x3a3634);
  for (const dx of [-0.24, 0.24]) K.col.add(G.cyl, K.M(-1.8 + dx, y + 1.08, 0.6, 0.09, 0.015, 0.09), 0xa08040);
  K.npc(-1.2, y, 1.2, Math.PI + 0.6, { role: 'merchant', seed: 831 });
}

function granary(K, it, rnd) {
  const hl = it.L / 2 - 0.2, hw = it.W / 2 - 0.15, y = it.floorY;
  for (let x = -hl; x < hl; x += 0.34) K.wb(x + 0.17, it.eaveY - 0.07, 0, 0.16, 0.02, hw, 'z');
  // закрома с зерном, горка зерна, мешки, лопата
  for (const lx of [-hl + 1.2, hl - 1.2]) {
    K.wb(lx, y + 0.45, -hw + 0.08, 1.1, 0.45, 0.03);
    K.wb(lx - 1.08, y + 0.45, -hw + 0.8, 0.03, 0.45, 0.75);
    K.wb(lx + 1.08, y + 0.45, -hw + 0.8, 0.03, 0.45, 0.75);
    K.wb(lx, y + 0.45, -hw + 1.55, 1.1, 0.45, 0.03);
    K.col.add(G.sph, K.M(lx, y + 0.75, -hw + 0.8, 1.0, 0.25, 0.7), 0xc8a45a);
  }
  K.col.add(G.cone, K.M(0, y + 0.3, 0.2, 0.9, 0.6, 0.7), 0xd0ac60);
  for (let k = 0; k < 8; k++) K.sack(-2.4 + (k % 4) * 0.5, y + Math.floor(k / 4) * 0.42, 1.3, 1, rnd);
  K.col.add(G.cylLo, K.M(0.9, y + 0.6, 0.4, 0.02, 1.3, 0.02, 0, 0, 0.6), 0x6a4a2a);
  K.cb(1.3, y + 0.08, 0.4, 0.14, 0.02, 0.1, 0x6a4a2a);
  K.npc(-0.6, y, 0.6, 0.4, { role: 'peasant', item: null, pose: 'work', seed: 841 });
}

function mill(K, it, rnd) {
  const { hl, hw } = shell(K, it, { floor: 'wood' });
  const y = it.floorY;
  // жернова на помосте, ковш над ними, большая шестерня от вала колеса
  K.wb(0.8, y + 0.5, 0.6, 1.1, 0.5, 1.0);
  K.col.add(G.cyl, K.M(0.8, y + 1.08, 0.6, 0.75, 0.08, 0.75), 0x8a8478);
  K.col.add(G.cyl, K.M(0.8, y + 1.22, 0.6, 0.72, 0.12, 0.72), 0x9a948a);
  K.wb(0.8, y + 1.9, 0.6, 0.05, 0.4, 0.05, 'y');
  K.col.add(G.cone, K.M(0.8, y + 1.75, 0.6, 0.4, 0.5, 0.4, 0, Math.PI), 0x7a5a3a);
  const gear = new THREE.TorusGeometry(1.1, 0.08, 6, 20);
  K.wood.addGeometry(gear, K.M(0.6, y + 1.6, hw - 0.6, 1, 1, 1));
  for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; K.wb(0.6 + Math.cos(a) * 1.18, y + 1.6 + Math.sin(a) * 1.18, hw - 0.6, 0.05, 0.05, 0.08); }
  for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI; K.wood.addGeometry(new THREE.BoxGeometry(2.2, 0.08, 0.08), K.M(0.6, y + 1.6, hw - 0.6, 1, 1, 1, 0, 0, a)); }
  K.col.add(G.cylLo, K.M(0.6, y + 1.6, hw - 0.1, 0.12, 1.0, 0.12, 0, Math.PI / 2), 0x5a4028); // вал
  for (let k = 0; k < 9; k++) K.sack(-hl + 0.6 + (k % 5) * 0.5, y + Math.floor(k / 5) * 0.42, -hw + 0.5, 1, rnd);
  K.npc(-0.7, y, 0.3, -1.2, { role: 'peasant', item: null, seed: 851 });
}


// Крестьянский дом: обмазка по фахверку, открытая стропильная крыша с соломой,
// земляной пол с камышом, очаг посредине, кровать-короб, стол на козлах,
// ткацкий станок, утварь, связки трав и лука под балками, куры у двери.
function house(K, it, rnd) {
  const { L, W, floorY: y, ridgeY, pitch } = it;
  const hl = L / 2 - 0.12, hw = W / 2 - 0.12;
  const door = it.doors[0], doorX = door.lx, s = doorX > 0 ? 1 : -1;
  const X = (u) => -s * u; // u > 0 — дальний от двери конец дома
  const roofY = (lz) => ridgeY - Math.abs(lz) * pitch - 0.04; // низ соломы
  const wallTop = roofY(hw);
  const winX = doorX - s * 2.1, hasWin = Math.abs(winX) <= L / 2 - 0.6, winY = y + 1.55;
  const seed = it.seed;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const WOODC = 0x5a4430, DARKW = 0x3e2e20;

  // ---- стены: обмазка изнутри, проёмы двери и окна
  const holes = [{ x0: doorX - door.w / 2, x1: doorX + door.w / 2, y0: y, y1: y + door.h }];
  if (hasWin) holes.push({ x0: winX - 0.3, x1: winX + 0.3, y0: winY - 0.28, y1: winY + 0.28 });
  const front = (x0, x1, y0, y1) => K.grid(K.daub, [x0, y0, hw], [x1, y0, hw], [x1, y1, hw], [x0, y1, hw], [0, 0, -1]);
  const xs = [-hl, hl, ...holes.flatMap((h) => [h.x0, h.x1])].sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], b = xs[i + 1];
    if (b - a < 0.01) continue;
    const m = (a + b) / 2, h = holes.find((q) => m > q.x0 && m < q.x1);
    if (!h) front(a, b, y, wallTop);
    else { if (h.y0 > y + 0.01) front(a, b, y, h.y0); front(a, b, h.y1, wallTop); }
  }
  K.grid(K.daub, [-hl, y, -hw], [hl, y, -hw], [hl, wallTop, -hw], [-hl, wallTop, -hw], [0, 0, 1]);
  for (const sd of [-1, 1]) {
    const x = sd * hl;
    K.grid(K.daub, [x, y, -hw], [x, y, hw], [x, wallTop, hw], [x, wallTop, -hw], [-sd, 0, 0]);
    K.grid(K.daub, [x, wallTop, -hw], [x, wallTop, hw], [x, roofY(0), 0], [x, roofY(0), 0], [-sd, 0, 0]);
  }
  // откосы проёмов — деревянные коробки на всю толщину стены
  const rz = (hw + W / 2) / 2, rh = (W / 2 - hw) / 2 + 0.03;
  for (const h of holes) {
    for (const x of [h.x0 - 0.05, h.x1 + 0.05]) K.wb(x, (h.y0 + h.y1) / 2 + 0.03, rz, 0.06, (h.y1 - h.y0) / 2 + 0.09, rh, 'y');
    K.wb((h.x0 + h.x1) / 2, h.y1 + 0.06, rz, (h.x1 - h.x0) / 2 + 0.11, 0.06, rh);
    if (h.y0 > y + 0.01) K.wb((h.x0 + h.x1) / 2, h.y0 - 0.04, rz + 0.02, (h.x1 - h.x0) / 2 + 0.11, 0.04, rh + 0.03);
  }
  // окно: за проёмом — «небо» (цвет меняется днём и ночью), свет на подоконник
  if (hasWin) {
    K.win.add(G.box, K.M(winX, winY, W / 2 - 0.012, 0.62, 0.58, 0.01), 0xffffff);
    K.wb(winX, winY, W / 2 - 0.03, 0.015, 0.28, 0.015, 'y'); // средник
    K.day.push({ p: K.f.p(winX, winY, hw - 0.15), k: 0.55, r: 1.3 });
  }

  // ---- пол: утоптанная земля и разбросанный камыш
  K.grid(K.dirt, [-hl, y + 0.012, hw], [hl, y + 0.012, hw], [hl, y + 0.012, -hw], [-hl, y + 0.012, -hw], [0, 1, 0], 0.5);
  const hx = X(0.35), hz = -0.25; // очаг
  for (let k = 0; k < 34; k++) {
    const lx = (rnd() * 2 - 1) * (hl - 0.2), lz = (rnd() * 2 - 1) * (hw - 0.2);
    if (Math.hypot(lx - hx, lz - hz) < 0.85) continue;
    K.cb(lx, y + 0.018, lz, 0.08 + rnd() * 0.1, 0.004, 0.006, pick([0x8a7a48, 0x7a6a40, 0x6a6038, 0x9a8656]), rnd() * 6.28);
  }

  // ---- фахверк изнутри: обвязки, стойки, ригели, раскосы
  const iz = hw - 0.05;
  const inDoor = (lx) => Math.abs(lx - doorX) < door.w / 2 + 0.14;
  const inWin = (lx) => hasWin && Math.abs(lx - winX) < 0.44;
  for (const sd of [1, -1]) {
    const lz = sd * iz;
    // нижняя обвязка (у двери разорвана) и верхняя
    if (sd > 0) {
      K.beam([-hl, y + 0.07, lz], [doorX - door.w / 2 - 0.1, y + 0.07, lz], 0.07);
      K.beam([doorX + door.w / 2 + 0.1, y + 0.07, lz], [hl, y + 0.07, lz], 0.07);
    } else K.beam([-hl, y + 0.07, lz], [hl, y + 0.07, lz], 0.07);
    K.beam([-hl, wallTop - 0.1, lz], [hl, wallTop - 0.1, lz], 0.09);
    // ригель (не через проёмы)
    const segs = [[-hl, hl]];
    if (sd > 0) for (const h of holes) {
      const out = [];
      for (const [a, b] of segs) {
        if (h.x1 + 0.1 < a || h.x0 - 0.1 > b || h.y0 > y + 1.15 || h.y1 < y + 1.15) { out.push([a, b]); continue; }
        if (h.x0 - 0.1 > a) out.push([a, h.x0 - 0.1]);
        if (h.x1 + 0.1 < b) out.push([h.x1 + 0.1, b]);
      }
      segs.splice(0, segs.length, ...out);
    }
    for (const [a, b] of segs) if (b - a > 0.2) K.beam([a, y + 1.15, lz], [b, y + 1.15, lz], 0.055);
    const n = Math.max(3, Math.round((2 * hl) / 1.5));
    for (let k = 0; k <= n; k++) {
      const lx = -hl + 0.05 + (k / n) * (2 * hl - 0.1);
      if (sd > 0 && (inDoor(lx) || inWin(lx))) continue;
      K.beam([lx, y + 0.1, lz], [lx, wallTop - 0.15, lz], 0.065, 0.055);
    }
    // раскосы у углов
    for (const e of [-1, 1]) {
      const x0 = e * (hl - 0.05), x1 = e * (hl - 0.05 - 2 * hl / n);
      if (sd > 0 && (inDoor(x1) || inDoor(x0) || inWin(x1))) continue;
      K.beam([x0, y + 0.15, lz], [x1, y + 1.12, lz], 0.05);
    }
  }
  for (const e of [-1, 1]) {
    const lx = e * (hl - 0.05);
    K.beam([lx, y + 0.07, -hw], [lx, y + 0.07, hw], 0.07);
    K.beam([lx, y + 1.15, -hw], [lx, y + 1.15, hw], 0.055);
    for (const lz of [-hw / 2, 0, hw / 2]) K.beam([lx, y + 0.1, lz], [lx, roofY(lz) - 0.08, lz], 0.065, 0.055);
  }

  // ---- крыша изнутри: солома по стропилам, прогоны, конёк, затяжки с бабками
  for (const sd of [-1, 1]) {
    K.grid(K.thatch, [-hl, wallTop, sd * hw], [hl, wallTop, sd * hw], [hl, roofY(0), 0], [-hl, roofY(0), 0], [0, -1, -sd * pitch], 0.5);
    for (let x = -hl + 0.2; x <= hl - 0.1; x += 0.55) K.beam([x, wallTop - 0.06, sd * (hw - 0.02)], [x, roofY(0) - 0.1, 0], 0.045, 0.04);
    const zp = sd * hw * 0.5;
    K.beam([-hl, roofY(zp) - 0.12, zp], [hl, roofY(zp) - 0.12, zp], 0.075);
    // жерди для сушки под скатами
    K.beam([-hl + 0.4, roofY(sd * hw * 0.78) - 0.2, sd * hw * 0.78], [hl - 0.4, roofY(sd * hw * 0.78) - 0.2, sd * hw * 0.78], 0.025);
  }
  K.beam([-hl, roofY(0) - 0.18, 0], [hl, roofY(0) - 0.18, 0], 0.09);
  const ties = [hx];
  for (let x = hx + 2.3; x < hl - 0.5; x += 2.3) ties.push(x);
  for (let x = hx - 2.3; x > -hl + 0.5; x -= 2.3) ties.push(x);
  const tieY = wallTop - 0.16;
  for (const tx of ties) {
    K.beam([tx, tieY, -hw], [tx, tieY, hw], 0.09, 0.08);
    K.beam([tx, tieY + 0.08, 0], [tx, roofY(0) - 0.2, 0], 0.065);
    for (const sd of [-1, 1]) K.beam([tx, tieY + 0.1, sd * 0.1], [tx, roofY(hw * 0.5) - 0.18, sd * hw * 0.5], 0.045);
  }
  // под затяжками — травы, лук, окорок, корзина
  for (const tx of ties) for (const lz of [-hw + 0.7, hw - 0.9]) {
    const kind = Math.floor(rnd() * 4), top = tieY - 0.09;
    const hang = (len) => K.rod([tx, top, lz], [tx, top - len, lz], 0.006, 0x8a7a58);
    if (kind === 0) for (let j = 0; j < 3; j++) { // пучки трав
      const dx = (j - 1) * 0.18;
      K.rod([tx + dx, top, lz], [tx + dx, top - 0.2, lz], 0.005, 0x8a7a58);
      K.col.add(G.cone, K.M(tx + dx, top - 0.38, lz, 0.07, 0.3, 0.07, rnd() * 3, Math.PI), pick([0x5a7a3a, 0x6a6a2e, 0x7a6a3a, 0x4a6a3a]));
    } else if (kind === 1) { // связка лука
      hang(0.25);
      for (let j = 0; j < 7; j++) K.col.add(G.sphLo, K.M(tx + (j % 2 ? 0.035 : -0.035), top - 0.3 - j * 0.07, lz, 0.045, 0.05, 0.045), pick([0xc89a4a, 0xb8843a, 0xd8b070]));
    } else if (kind === 2) { // окорок
      hang(0.3);
      K.col.add(G.sph, K.M(tx, top - 0.48, lz, 0.1, 0.17, 0.08), 0x5a2e1e);
      K.col.add(G.sphLo, K.M(tx, top - 0.33, lz, 0.05, 0.06, 0.05), 0xe0d0b0);
    } else { // корзина
      hang(0.35);
      K.col.add(G.bowl, K.M(tx, top - 0.62, lz, 0.2, 0.22, 0.2), 0x9a7a4a);
    }
  }

  // ---- очаг: каменный под, угли, поленья, котёл на цепи
  K.sb(hx, y + 0.06, hz, 0.62, 0.06, 0.55);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * 6.28;
    K.stone.addGeometry(new THREE.DodecahedronGeometry(0.1, 0), K.M(hx + Math.cos(a) * 0.55, y + 0.15, hz + Math.sin(a) * 0.47, 1.2, 0.8, 1, a));
  }
  K.col.add(G.cyl, K.M(hx, y + 0.125, hz, 0.42, 0.01, 0.36), 0x5a5550);
  for (let k = 0; k < 9; k++) K.glow.add(G.sphLo, K.M(hx + (rnd() - 0.5) * 0.5, y + 0.14, hz + (rnd() - 0.5) * 0.4, 0.05, 0.02, 0.05), pick([0xff5a14, 0xc03a10, 0xff8a2a]));
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + 0.3;
    K.rod([hx + Math.cos(a) * 0.35, y + 0.14, hz + Math.sin(a) * 0.3], [hx - Math.cos(a) * 0.05, y + 0.24, hz - Math.sin(a) * 0.05], 0.04, 0x3a2a1c, G.cylLo);
  }
  K.fire(hx, y + 0.13, hz, 0.75, rnd);
  K.rod([hx, tieY - 0.09, hz], [hx, y + 0.93, hz], 0.008, 0x2a2622);
  K.col.add(G.pot, K.M(hx, y + 0.58, hz, 0.24, 0.3, 0.24), 0x2a2724);
  K.col.add(G.torus, K.M(hx, y + 0.9, hz, 0.2, 0.2, 0.2, 0, 0, 0), 0x2a2724);
  K.col.add(G.cyl, K.M(hx, y + 0.86, hz, 0.2, 0.01, 0.2), 0x6a4a28); // похлёбка
  K.col.add(G.pot, K.M(hx + 0.52, y + 0.12, hz + 0.3, 0.1, 0.14, 0.1), 0x8a5a3a);
  K.rod([hx + 0.15, y + 0.85, hz + 0.05], [hx + 0.45, y + 1.05, hz + 0.15], 0.012, 0x6a4a2a); // черпак
  // поленница у задней стены
  const fx = X(-0.55);
  for (let row = 0; row < 3; row++) for (let k = 0; k < 4 - row; k++) {
    const lx = fx + (k - (3 - row) / 2) * 0.13;
    K.rod([lx, y + 0.07 + row * 0.11, -hw + 0.05], [lx, y + 0.07 + row * 0.11, -hw + 0.65], 0.055, pick([0x6a4a2a, 0x5a3e24, 0x7a5a38]), G.cylLo);
  }

  // ---- кровать-короб у дальнего торца
  const bx = X(hl - 0.55), bz = -hw + 1.1;
  for (const e of [-1, 1]) K.wb(bx + e * 0.47, y + 0.3, bz, 0.03, 0.16, 1.0, 'z');
  K.wb(bx, y + 0.52, -hw + 0.1, 0.5, 0.5, 0.03);
  K.wb(bx, y + 0.34, bz + 1.0, 0.5, 0.22, 0.03);
  for (const e of [-1, 1]) { K.wb(bx + e * 0.47, y + 0.55, -hw + 0.1, 0.045, 0.55, 0.045, 'y'); K.wb(bx + e * 0.47, y + 0.3, bz + 1.0, 0.045, 0.3, 0.045, 'y'); }
  K.cb(bx, y + 0.34, bz, 0.43, 0.08, 0.95, 0xb8a46a);
  K.cb(bx, y + 0.43, bz - 0.05, 0.44, 0.015, 0.88, 0xe4dccb);
  const blC = pick([0x6a2a24, 0x4a5a3a, 0x3a4a6a, 0x7a5a2a, 0x5a3a4a]);
  K.col.add(G.blanket, K.M(bx, y + 0.47, bz + 0.25, 0.92, 0.05, 1.35), blC);
  K.cb(bx, y + 0.5, bz - 0.44, 0.465, 0.02, 0.08, new THREE.Color(blC).multiplyScalar(1.25).getHex());
  K.col.add(G.sack, K.M(bx, y + 0.5, -hw + 0.38, 0.32, 0.075, 0.17), 0xe8e0d0);
  K.col.add(G.sph, K.M(X(hl - 1.45), y + 0.02, bz + 0.1, 0.3, 0.025, 0.45), 0xb8ac90); // овчина
  // сундук в изножье
  const cx = X(hl - 0.55), cz = bz + 1.35;
  K.wb(cx, y + 0.22, cz, 0.4, 0.22, 0.24);
  K.wb(cx, y + 0.47, cz, 0.42, 0.035, 0.26);
  for (const e of [-0.25, 0.25]) K.cb(cx + e, y + 0.26, cz, 0.025, 0.25, 0.255, 0x2a2622);
  K.cb(cx, y + 0.36, cz + 0.255, 0.04, 0.05, 0.01, 0x2a2622);
  // колыбель
  if (seed % 3 === 0) {
    const kx = X(hl - 1.55), kz = -hw + 0.45;
    K.wb(kx, y + 0.28, kz, 0.4, 0.14, 0.22);
    K.cb(kx, y + 0.43, kz, 0.36, 0.02, 0.18, 0xe4dccb);
    for (const e of [-0.3, 0.3]) K.col.add(G.torus, K.M(kx + e, y + 0.16, kz, 0.2, 0.2, 0.3, Math.PI / 2, 0, 0), WOODC);
    K.col.add(G.sph, K.M(kx - 0.22, y + 0.47, kz, 0.06, 0.06, 0.06), 0xe8b898);
    K.col.add(G.sph, K.M(kx + 0.02, y + 0.45, kz, 0.2, 0.05, 0.12), 0xd8ccb0);
  }

  // ---- стол на козлах, лавка, табуреты, еда
  const tx = X(hl - 1.55), tz = hw - 1.05;
  K.wb(tx, y + 0.74, tz, 0.75, 0.035, 0.36);
  for (const e of [-0.55, 0.55]) {
    for (const sz of [-1, 1]) K.beam([tx + e, y, tz + sz * 0.3], [tx + e, y + 0.71, tz + sz * 0.04], 0.035);
    K.beam([tx + e, y + 0.35, tz - 0.2], [tx + e, y + 0.35, tz + 0.2], 0.03);
  }
  K.beam([tx - 0.55, y + 0.35, tz], [tx + 0.55, y + 0.35, tz], 0.03);
  K.wb(tx, y + 0.42, hw - 0.42, 0.75, 0.035, 0.14);
  for (const e of [-0.6, 0.6]) K.wb(tx + e, y + 0.2, hw - 0.42, 0.03, 0.2, 0.12, 'y');
  const stool = (lx, lz) => {
    K.wood.addGeometry(G.cyl, K.M(lx, y + 0.42, lz, 0.16, 0.04, 0.16));
    for (let k = 0; k < 3; k++) { const a = k * 2.09; K.rod([lx + Math.cos(a) * 0.1, y + 0.4, lz + Math.sin(a) * 0.1], [lx + Math.cos(a) * 0.19, y, lz + Math.sin(a) * 0.19], 0.02, WOODC); }
  };
  stool(tx - 0.35, tz - 0.62);
  stool(X(-0.55), hz + 0.05);
  K.col.add(G.sph, K.M(tx - 0.45, y + 0.8, tz + 0.05, 0.15, 0.07, 0.1, 0.4), 0x9a6a34); // каравай
  K.col.add(new THREE.CylinderGeometry(1, 1, 1, 12, 1, false, 0, 4.2), K.M(tx - 0.1, y + 0.8, tz + 0.18, 0.1, 0.06, 0.1), 0xe0c060); // сыр
  for (let k = 0; k < 3; k++) {
    const lx = tx + 0.05 + k * 0.22, lz = tz - 0.14 + (k % 2) * 0.1;
    K.col.add(G.bowl, K.M(lx, y + 0.775, lz, 0.09, 0.05, 0.09), 0x7a5a3a);
    K.col.add(G.cyl, K.M(lx, y + 0.805, lz, 0.075, 0.005, 0.075), 0x8a6a3a);
    K.cb(lx + 0.08, y + 0.78, lz + 0.05, 0.06, 0.005, 0.012, 0x6a4a2a, 0.5);
  }
  K.col.add(G.jug, K.M(tx + 0.55, y + 0.775, tz + 0.12, 0.1, 0.24, 0.1), 0x8a4a2a);
  for (const e of [0.35, 0.6]) K.col.add(G.cylLo, K.M(tx + e, y + 0.82, tz - 0.2, 0.035, 0.08, 0.035), 0x7a5a3a);
  K.cb(tx - 0.2, y + 0.78, tz - 0.12, 0.09, 0.004, 0.012, 0x9a9a98, 0.7); // нож
  K.candle(tx + 0.25, y + 0.775, tz + 0.18);

  // ---- ткацкий станок у задней стены (со стороны двери)
  const hasLoom = seed % 2 === 0;
  const lx0 = X(-(hl - 1.05));
  if (hasLoom) {
    const z0 = -hw + 0.55, z1 = -hw + 0.1, top = y + 2.05;
    const zAt = (yy) => z0 + (z1 - z0) * ((yy - y) / (top - y));
    for (const e of [-0.7, 0.7]) K.beam([lx0 + e, y, z0], [lx0 + e, top, z1], 0.045);
    K.beam([lx0 - 0.82, y + 1.85, zAt(y + 1.85) + 0.06], [lx0 + 0.82, y + 1.85, zAt(y + 1.85) + 0.06], 0.05);
    K.beam([lx0 - 0.75, y + 1.05, zAt(y + 1.05) + 0.1], [lx0 + 0.75, y + 1.05, zAt(y + 1.05) + 0.1], 0.02);
    const cA = pick([0x8a2a24, 0x2a4a7a, 0x6a7a3a, 0xc8b890]), cB = pick([0xe0d6c0, 0x3a2a24, 0xc8a040]);
    for (let j = 0; j < 5; j++) {
      const ya = y + 1.8 - j * 0.1, yb = ya - 0.1;
      K.slab([lx0, ya, zAt(ya) + 0.09], [lx0, yb, zAt(yb) + 0.09], 0.64, 0.006, j % 2 ? cB : cA);
    }
    for (let j = 0; j < 22; j++) {
      const lx = lx0 - 0.62 + j * (1.24 / 21);
      K.rod([lx, y + 1.3, zAt(y + 1.3) + 0.09], [lx, y + 0.34, zAt(y + 0.34) + 0.1 + (j % 2) * 0.05], 0.004, 0xd8cfb8);
      if (j % 2 === 0) K.col.add(G.torus, K.M(lx, y + 0.3, zAt(y + 0.3) + 0.1 + (j % 4 === 0 ? 0.05 : 0), 0.045, 0.045, 0.045), 0x9a6a4a);
    }
  }

  // ---- полка с горшками, плащ на колышке, инструмент у торца
  const shx = X(1.35);
  K.wb(shx, y + 1.55, -hw + 0.16, 0.55, 0.02, 0.13);
  for (const e of [-0.4, 0.4]) K.wb(shx + e, y + 1.45, -hw + 0.1, 0.02, 0.1, 0.07, 'y');
  for (let k = 0; k < 4; k++) {
    const lx = shx - 0.4 + k * 0.27;
    if (k % 2) K.col.add(G.jug, K.M(lx, y + 1.57, -hw + 0.16, 0.08, 0.2, 0.08), pick([0x8a4a2a, 0x9a6a3a, 0x6a5a4a]));
    else K.col.add(G.pot, K.M(lx, y + 1.57, -hw + 0.16, 0.1, 0.15, 0.1), pick([0x8a5a3a, 0x5a4a3a, 0x9a7a5a]));
  }
  K.col.add(G.bowl, K.M(shx + 0.3, y + 1.03, -hw + 0.2, 0.12, 0.05, 0.12), 0x7a5a3a);
  const peg = X(-1.2);
  if (Math.abs(peg) < hl - 0.3) {
    K.rod([peg, y + 1.65, -hw], [peg, y + 1.66, -hw + 0.12], 0.015, WOODC);
    K.col.add(G.box, K.M(peg, y + 1.3, -hw + 0.08, 0.34, 0.7, 0.04, 0, -0.05), pick([0x5a4a3a, 0x3a3a2a, 0x6a2a24, 0x4a4a5a]));
  }
  const ex = s * (hl - 0.07);
  const tool = (lz, len, head) => {
    K.rod([s * (hl - 0.38), y, lz], [ex, y + len, lz + 0.08], 0.018, 0x7a5a3a);
    head(lz);
  };
  tool(-0.7, 1.7, (lz) => { for (let j = -1; j <= 1; j++) K.rod([ex, y + 1.68, lz + 0.08 + j * 0.05], [ex + s * 0.02, y + 1.95, lz + 0.08 + j * 0.06], 0.008, 0x6a6a68); });
  tool(-0.2, 1.5, (lz) => K.col.add(G.cone, K.M(s * (hl - 0.36), y + 0.14, lz, 0.1, 0.3, 0.08), 0xb8a060)); // метла
  tool(0.35, 1.65, (lz) => K.cb(ex - s * 0.02, y + 1.66, lz + 0.08, 0.02, 0.02, 0.2, 0x7a5a3a));
  // бочка с водой и ведро у двери
  let wx = doorX + s * 0.95;
  if (Math.abs(wx) > hl - 0.35) wx = doorX - s * 0.95;
  K.barrel(wx, y, hw - 0.38, 0.85);
  K.col.add(G.cyl, K.M(wx, y + 0.78, hw - 0.38, 0.25, 0.005, 0.25), 0x3a4a4a);
  K.wood.addGeometry(G.barrel, K.M(wx + s * 0.1, y, hw - 0.85, 0.45, 0.4, 0.45));

  // ---- куры у двери
  for (let k = 0; k < 1 + (seed % 2); k++) K.hen(doorX - s * (0.4 + k * 0.5), y, hw - 1.55 - k * 0.3, rnd() * 6.28, rnd);

  // ---- люди: хозяйка у котла, хозяин за столом, ткачиха, старик или ребёнок у огня
  K.npc(hx, y, hz + 0.85, Math.PI, { role: 'woman', pose: 'work', item: null, seed: 860 + seed });
  if (seed % 4 !== 3) K.npc(tx - 0.3, y + 0.46, hw - 0.42, Math.PI, { role: 'peasant', pose: 'sit', item: null, seed: 880 + seed });
  if (hasLoom) K.npc(lx0, y, -hw + 1.15, Math.PI, { role: 'woman', pose: 'work', item: null, seed: 890 + seed });
  if (seed % 3 === 1) K.npc(X(-0.55), y + 0.45, hz + 0.05, -s * Math.PI / 2, { role: 'child', pose: 'sit', seed: 870 + seed });
  else if (seed % 3 === 2) K.npc(X(-0.55), y + 0.45, hz + 0.05, -s * Math.PI / 2, { role: 'peasant', pose: 'sit', item: null, seed: 875 + seed });
}

const BUILD = { kitchen, barracks, chapel, store, granary, mill, house };

// Запечь освещение в вершины: x — отсвет огня, y — затенение (углы, пол,
// копоть под крышей), z — дневной свет из дверей и окон
function bake(geo, K, it) {
  const pos = geo.getAttribute('position'), nrm = geo.getAttribute('normal');
  const n = pos.count, out = new Float32Array(n * 3);
  const { f } = it;
  const hl = it.L / 2, hw = it.W / 2, y0 = it.floorY, eave = it.eaveY || y0 + 3;
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const p = new V3(), nn = new V3(), d = new V3();
  const light = (list) => {
    let sum = 0;
    for (const Lq of list) {
      d.copy(Lq.p).sub(p);
      const dist = d.length() || 1e-3;
      const face = 0.3 + 0.7 * Math.max(0, nn.dot(d) / dist);
      sum += (Lq.k * face) / (1 + (dist * dist) / (Lq.r * Lq.r));
    }
    return sum;
  };
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    nn.fromBufferAttribute(nrm, i);
    const rx = p.x - f.C.x, rz = p.z - f.C.z;
    const lx = rx * f.X.x + rz * f.X.z, lz = rx * f.N.x + rz * f.N.z;
    const dw = Math.min(hl - Math.abs(lx), hw - Math.abs(lz));
    const dx = hl - Math.abs(lx), dz = hw - Math.abs(lz);
    let amb = 0.5 + 0.5 * ss(0.05, 1.1, dw);
    amb *= 0.75 + 0.25 * ss(0.1, 0.9, Math.max(dx, dz)); // углы темнее
    amb *= 0.72 + 0.28 * ss(0.0, 0.3, p.y - y0);
    amb *= 1 - 0.4 * ss(eave - 0.5, eave + 1.2, p.y); // копоть под крышей
    out[i * 3] = Math.min(2.2, light(K.lights));
    out[i * 3 + 1] = amb;
    out[i * 3 + 2] = Math.min(1.4, light(K.day));
  }
  geo.setAttribute('aLit', new THREE.BufferAttribute(out, 3));
}

export const INTERIOR_U = { uIT: { value: 0 }, uDay: { value: 1 } };
function litMaterial(m) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uIT = INTERIOR_U.uIT;
    sh.uniforms.uDay = INTERIOR_U.uDay;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aLit;\nvarying vec3 vLit;\nvarying vec3 vLP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLit = aLit;\nvLP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLit;\nvarying vec3 vLP;\nuniform float uIT;\nuniform float uDay;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float fl = 0.85 + 0.09 * sin(uIT * 9.0 + vLP.x * 1.3) * sin(uIT * 5.7 + vLP.z * 1.1) + 0.05 * sin(uIT * 17.0 + vLP.y);
        totalEmissiveRadiance = diffuseColor.rgb * (vec3(1.0, 0.55, 0.24) * vLit.x * fl
          + vec3(0.42, 0.34, 0.26) * (0.1 + 0.12 * (1.0 - uDay)) * vLit.y
          + vec3(0.6, 0.66, 0.75) * vLit.z * uDay * 0.3);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.indirectDiffuse *= vLit.y * (0.55 + 0.9 * vLit.z * uDay) * (0.4 + 0.6 * uDay);
        reflectedLight.directDiffuse *= vLit.y;
        reflectedLight.indirectSpecular *= vLit.y * 0.5;`);
  };
  const key = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : () => '';
  m.customProgramCacheKey = () => 'interior-lit-' + key();
  return m;
}

export function createInteriors(scene, walls) {
  const rnd = mulberry32(7070);
  const colMat = litMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  const texMat = (slot, color) => litMaterial(pbrMaterial(slot, color !== undefined ? { color } : {}));
  const stoneMat = texMat('wallStone'), woodMat = texMat('wood', 0x9a8a78);
  const daubMat = texMat('daub', 0xd8ccb4), thatchMat = texMat('thatch', 0x9a8a6a), dirtMat = texMat('dirt', 0x8a7a66);
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  // «небо» в окнах: днём светлое, ночью тёмно-синее
  const winMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, color: 0xc8d4e0 });
  const tiles = {
    stone: walls.stoneMaterial.userData.tileMeters, wood: walls.woodMaterial.userData.tileMeters,
    daub: daubMat.userData.tileMeters, thatch: thatchMat.userData.tileMeters, dirt: dirtMat.userData.tileMeters,
  };
  const groups = [];
  for (const it of INTERIORS) {
    const fn = BUILD[it.id];
    if (!fn) continue;
    const K = kit(it, tiles);
    fn(K, it, rnd);
    for (const d of it.doors || []) K.day.push({ p: it.f.p(d.lx, it.floorY + 1.0, it.W / 2), k: 0.9, r: 1.6 });
    if (it.backDoor) K.day.push({ p: it.f.p(it.backDoor.lx, it.floorY + 1.0, -it.W / 2), k: 0.9, r: 1.6 });
    const g = new THREE.Group();
    g.name = 'interior-' + it.id;
    for (const [b, mat, cast, lit] of [[K.stone, stoneMat, true, true], [K.wood, woodMat, true, true], [K.daub, daubMat, false, true], [K.thatch, thatchMat, false, true],
      [K.dirt, dirtMat, false, true], [K.col, colMat, true, true], [K.glow, glowMat, false, false], [K.win, winMat, false, false]]) {
      if (!b.pos.length) continue;
      const geo = b.build();
      if (lit) bake(geo, K, it);
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast; m.receiveShadow = true;
      g.add(m);
    }
    g.visible = false;
    scene.add(g);
    groups.push({ g, c: it.f.p(0, it.floorY, 0), r: Math.max(it.L, it.W) / 2 });
  }
  const dayCol = new THREE.Color(0xc8d4e0), nightCol = new THREE.Color(0x0c1426);
  return {
    count: groups.length,
    // время суток: 0 — день, 1 — ночь
    setNight(night) {
      INTERIOR_U.uDay.value = 1 - night;
      winMat.color.copy(dayCol).lerp(nightCol, night);
    },
    // интерьер рисуется, только когда камера рядом с домом и невысоко над ним
    update(camera, t = 0) {
      INTERIOR_U.uIT.value = t;
      const p = camera.position;
      for (const q of groups) {
        const d = Math.hypot(p.x - q.c.x, p.z - q.c.z) - q.r;
        q.g.visible = d < 24 && p.y - q.c.y < 14;
      }
    },
  };
}
