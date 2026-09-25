// Интерьеры построек: кухня, казарма, часовня, склад, амбар, мельница и
// крестьянские дома. Каждое здание — своя маленькая группа сеток, которая
// рисуется, только когда камера рядом (вдали интерьеры не стоят ни кадра).
import * as THREE from 'three';
import { GeoBuilder } from './walls.js';
import { ColorBuilder, person } from './people.js';
import { INTERIORS } from './courtyard.js';
import { mulberry32 } from './noise.js';
import { pbrMaterial, materialTextures } from './textures.js';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
  cylLo: new THREE.CylinderGeometry(1, 1, 1, 7),
  sph: new THREE.SphereGeometry(1, 10, 7),
  cone: new THREE.ConeGeometry(1, 1, 8),
  flame: new THREE.ConeGeometry(1, 1, 7),
  barrel: (() => {
    const pts = [];
    for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push(new THREE.Vector2(0.29 + 0.07 * Math.sin(t * Math.PI), t * 0.95)); }
    return new THREE.LatheGeometry(pts, 12);
  })(),
  sack: (() => { const g = new THREE.SphereGeometry(1, 10, 8); const p = g.getAttribute('position'); for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setXYZ(i, p.getX(i) * (1 - 0.25 * Math.max(0, y)), y, p.getZ(i) * (1 - 0.25 * Math.max(0, y))); } g.computeVertexNormals(); return g; })(),
};

// Всё для одного здания: локальные координаты (lx вдоль, lz поперёк — к фасаду +, y абсолютная)
function kit(it, woodTile, stoneTile) {
  const { f } = it;
  const stone = new GeoBuilder(stoneTile), wood = new GeoBuilder(woodTile);
  const col = new ColorBuilder(), glow = new ColorBuilder();
  const basis = new THREE.Matrix4().makeBasis(f.X, UP, f.N);
  const qB = new THREE.Quaternion().setFromRotationMatrix(basis);
  const M = (lx, y, lz, sx = 1, sy = 1, sz = 1, yaw = 0, rx = 0, rz = 0) =>
    new THREE.Matrix4().compose(f.p(lx, y, lz), qB.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, yaw, rz, 'YXZ'))), new V3(sx, sy, sz));
  const K = {
    f, stone, wood, col, glow, M,
    // цветная коробка: центр, полуразмеры
    cb: (lx, y, lz, hx, hy, hz, c, yaw = 0) => col.add(G.box, M(lx, y, lz, hx * 2, hy * 2, hz * 2, yaw), c),
    // деревянная коробка (текстура дерева)
    wb: (lx, y, lz, hx, hy, hz, grainAlong = 'x') => {
      const ax = grainAlong === 'y' ? [UP, f.X, f.N] : grainAlong === 'z' ? [f.N, UP, f.X] : [f.X, UP, f.N];
      const hs = grainAlong === 'y' ? [hy, hx, hz] : grainAlong === 'z' ? [hz, hy, hx] : [hx, hy, hz];
      wood.box(f.p(lx, y, lz), ax[0], ax[1], ax[2], hs[0], hs[1], hs[2], { grain: true });
    },
    sb: (lx, y, lz, hx, hy, hz) => stone.box(f.p(lx, y, lz), f.X, UP, f.N, hx, hy, hz),
    fire: (lx, y, lz, s, rnd) => {
      for (let k = 0; k < 7; k++) {
        const a = rnd() * 6.28, r = rnd() * 0.22 * s, h = (0.3 + rnd() * 0.45) * s, w = (0.05 + rnd() * 0.05) * s;
        glow.add(G.flame, M(lx + Math.cos(a) * r, y + h / 2, lz + Math.sin(a) * r, w, h, w, rnd() * 3), k < 2 ? 0xffe38a : k < 5 ? 0xffa43a : 0xff6a1a);
      }
      glow.add(G.cylLo, M(lx, y + 0.02, lz, 0.3 * s, 0.03, 0.3 * s), 0xb03a14);
    },
    candle: (lx, y, lz) => {
      col.add(G.cylLo, M(lx, y + 0.08, lz, 0.025, 0.16, 0.025), 0xe8e0c8);
      glow.add(G.flame, M(lx, y + 0.2, lz, 0.015, 0.06, 0.015), 0xffd070);
    },
    npc: (lx, y, lz, yaw, o) => { const p = f.p(lx, y, lz); person(col, { x: p.x, y: p.y, z: p.z, yaw: f.yaw * 0 + Math.atan2(f.N.x, f.N.z) + yaw, ...o }); },
    barrel: (lx, y, lz, s = 1) => wood.addGeometry(G.barrel, M(lx, y, lz, s, s, s)),
    sack: (lx, y, lz, s, rnd) => col.add(G.sack, M(lx, y + 0.28 * s, lz, 0.26 * s, 0.32 * s, 0.22 * s, rnd() * 3), [0xc8b48a, 0xb8a47a, 0xd4c49a][Math.floor(rnd() * 3)]),
  };
  return K;
}

// Внутренняя оболочка: стены, потолок из досок на балках, пол
function shell(K, it, { inset = 0.3, plaster = null, floorCol = null } = {}) {
  const { L, W, floorY } = it;
  const hl = L / 2 - inset, hw = W / 2 - inset;
  const top = (it.eaveY || floorY + 3) - 0.05;
  const wall = (lz, x0, x1, holes = []) => {
    const xs = [x0];
    const hs = [...holes].sort((a, b) => a.lx - b.lx);
    for (const h of hs) xs.push(h.lx - h.w / 2, h.lx + h.w / 2);
    xs.push(x1);
    for (let i = 0; i < xs.length - 1; i++) {
      const a = Math.max(x0, xs[i]), b = Math.min(x1, xs[i + 1]);
      if (b - a < 0.01) continue;
      const hole = i % 2 === 1 ? hs[(i - 1) / 2] : null;
      const seg = (y0, y1) => {
        if (y1 - y0 < 0.01) return;
        if (plaster) K.cb((a + b) / 2, (y0 + y1) / 2, lz, (b - a) / 2, (y1 - y0) / 2, 0.03, plaster);
        else K.sb((a + b) / 2, (y0 + y1) / 2, lz, (b - a) / 2, (y1 - y0) / 2, 0.03);
      };
      if (!hole) seg(floorY, top); else seg(floorY + hole.h, top);
    }
  };
  const side = (lx) => {
    if (plaster) K.cb(lx, (floorY + top) / 2, 0, 0.03, (top - floorY) / 2, hw, plaster);
    else K.sb(lx, (floorY + top) / 2, 0, 0.03, (top - floorY) / 2, hw);
  };
  wall(hw, -hl, hl, it.doors);
  wall(-hw, -hl, hl, it.backDoor ? [it.backDoor] : []);
  side(-hl); side(hl);
  // потолок: доски поперёк и две балки
  for (let x = -hl; x < hl; x += 0.34) K.wb(x + 0.17, top - 0.02, 0, 0.16, 0.02, hw, 'z');
  for (let x = -hl + 1.2; x < hl - 0.6; x += 2.4) K.wb(x, top - 0.14, 0, 0.1, 0.1, hw, 'z');
  if (floorCol) K.cb(0, floorY + 0.012, 0, hl, 0.012, hw, floorCol);
  return { hl, hw, top };
}

// ------------------------- ОБСТАНОВКА ПО ТИПАМ -------------------------
function kitchen(K, it, rnd) {
  const { hl, hw, top } = shell(K, it, { floorCol: 0x5a5048 });
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
  const { hl, hw } = shell(K, it, { floorCol: 0x4a4038 });
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
}

function chapel(K, it, rnd) {
  const { hl, hw } = shell(K, it, { floorCol: 0x6a625a });
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
  const { hl, hw } = shell(K, it, { floorCol: 0x6a5a44 });
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

function house(K, it, rnd) {
  const { hl, hw } = shell(K, it, { inset: 0.12, plaster: 0xcdbd9c, floorCol: 0x4a3a2a });
  const y = it.floorY;
  const doorX = it.doors[0].lx;
  // очаг посреди дома: кольцо камней, огонь, котёл на треноге
  const hx = doorX > 0 ? -0.8 : 0.8;
  for (let k = 0; k < 9; k++) { const a = (k / 9) * 6.28; K.stone.addGeometry(new THREE.DodecahedronGeometry(0.12, 0), K.M(hx + Math.cos(a) * 0.45, y + 0.06, -0.3 + Math.sin(a) * 0.45)); }
  K.fire(hx, y + 0.02, -0.3, 0.8, rnd);
  for (let k = 0; k < 3; k++) { const a = (k / 3) * 6.28; K.col.add(G.cylLo, K.M(hx + Math.cos(a) * 0.35, y + 0.55, -0.3 + Math.sin(a) * 0.35, 0.02, 1.2, 0.02, 0, Math.sin(a) * 0.3, -Math.cos(a) * 0.3), 0x3a2a1c); }
  K.col.add(G.sph, K.M(hx, y + 0.62, -0.3, 0.2, 0.17, 0.2), 0x2a2622);
  // кровать с соломенным тюфяком и одеялом у дальней стены
  const bx = -hx * 1.6;
  K.wb(bx, y + 0.3, -hw + 0.55, 0.9, 0.05, 0.5);
  for (const dx of [-0.85, 0.85]) for (const dz of [0.1, 1.0]) K.wb(bx + dx, y + 0.15, -hw + dz, 0.05, 0.15, 0.05, 'y');
  K.cb(bx, y + 0.42, -hw + 0.55, 0.85, 0.08, 0.45, 0xb8a46a);
  K.cb(bx + 0.2, y + 0.5, -hw + 0.55, 0.6, 0.03, 0.47, [0x6a2a24, 0x4a5a3a, 0x3a4a6a][it.seed % 3]);
  // стол, лавка, миски, сундук, полка с горшками
  const tx = hx * -0.2 + (doorX > 0 ? 1.2 : -1.2) * 0.6;
  K.wb(tx, y + 0.72, 0.6, 0.6, 0.04, 0.35);
  for (const [dx, dz] of [[-0.55, -0.3], [0.55, -0.3], [-0.55, 0.3], [0.55, 0.3]]) K.wb(tx + dx, y + 0.35, 0.6 + dz, 0.04, 0.35, 0.04, 'y');
  K.wb(tx, y + 0.4, 0.05, 0.6, 0.035, 0.12);
  for (let k = 0; k < 3; k++) K.col.add(G.cyl, K.M(tx - 0.3 + k * 0.3, y + 0.78, 0.6, 0.09, 0.03, 0.09), 0x7a5a3a);
  K.wb(hl - 0.4, y + 0.25, -hw + 0.4, 0.3, 0.25, 0.22);
  K.wb(-hl + 0.2, y + 1.4, -0.4, 0.16, 0.02, 0.6);
  for (let k = 0; k < 3; k++) K.col.add(G.cyl, K.M(-hl + 0.2, y + 1.52, -0.8 + k * 0.4, 0.08, 0.2, 0.08), [0x8a4a2a, 0x6a5a4a, 0x9a6a3a][k]);
  // хозяйка у очага, иногда ребёнок
  K.npc(hx + 0.8, y, -0.3, -Math.PI / 2 * Math.sign(hx) - Math.PI / 2, { role: 'woman', pose: 'work', item: null, seed: 860 + it.seed });
  if (it.seed % 2) K.npc(tx, y + 0.45, 0.05, 0, { role: 'child', pose: 'sit', seed: 870 + it.seed });
}

const BUILD = { kitchen, barracks, chapel, store, granary, mill, house };

export function createInteriors(scene, walls) {
  const rnd = mulberry32(7070);
  // внутри тень от крыши — материалы интерьера чуть «подсвечены» тёплым светом очага и окон
  const warm = new THREE.Color(0.42, 0.34, 0.26);
  const colMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, emissive: warm.clone().multiplyScalar(0.35) });
  colMat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= diffuseColor.rgb * 2.5;'); };
  colMat.customProgramCacheKey = () => 'interior-col';
  const texMat = (slot, color) => pbrMaterial(slot, { color, emissive: warm, emissiveIntensity: 0.55, emissiveMap: materialTextures(slot).map });
  const stoneMat = texMat('wallStone'), woodMat = texMat('wood', 0x9a8a78);
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  const groups = [];
  for (const it of INTERIORS) {
    const fn = BUILD[it.id];
    if (!fn) continue;
    const K = kit(it, walls.woodMaterial.userData.tileMeters, walls.stoneMaterial.userData.tileMeters);
    fn(K, it, rnd);
    const g = new THREE.Group();
    g.name = 'interior-' + it.id;
    for (const [b, mat, cast] of [[K.stone, stoneMat, true], [K.wood, woodMat, true], [K.col, colMat, true], [K.glow, glowMat, false]]) {
      if (!b.pos.length) continue;
      const m = new THREE.Mesh(b.build(), mat);
      m.castShadow = cast; m.receiveShadow = true;
      g.add(m);
    }
    g.visible = false;
    scene.add(g);
    groups.push({ g, c: it.f.p(0, it.floorY, 0), r: Math.max(it.L, it.W) / 2 });
  }
  return {
    count: groups.length,
    // интерьер рисуется, только когда камера рядом с домом и невысоко над ним
    update(camera) {
      const p = camera.position;
      for (const q of groups) {
        const d = Math.hypot(p.x - q.c.x, p.z - q.c.z) - q.r;
        q.g.visible = d < 24 && p.y - q.c.y < 14;
      }
    },
  };
}
