// Этап 7: мелкие детали и «жизнь» во дворе. Старая липа со скамьёй, огород за
// плетнём, шатры-павильоны, курятник с курами, учебный столб-квинтана и столбы
// для отработки ударов, стол с лавками, мешки и дрова; плющ на стенах; люди.
import * as THREE from 'three';
import { BUILDINGS, WELL, KEEP, BARBICAN, GATE_PASSAGE, WALL } from './layout.js';
import { GeoBuilder } from './walls.js';
import { Frame, strawMaterial, buildBarrels } from './courtyard.js';
import { addYardLife, yardExclude, SACK } from './yard.js';
import { wattleFence, gardenBeds } from './village.js';
import { ColorBuilder, createPeople, addTailSway } from './people.js';
import { pbrMaterial, makeCanvas, toTexture, foliageTexture } from './textures.js';
import { mulberry32 } from './noise.js';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);

export const COURT_EXTRAS = {
  linden: { x: 22, z: -3 },
  garden: { x: -35, z: -2, w: 9, d: 7 },
  tents: [{ x: 16.5, z: -20, r: 2.5, c: 0x9c1b1b }, { x: 24.5, z: -24.5, r: 2.2, c: 0x1f3f9a }],
  coop: { x: -32.5, z: 19 },
  quintain: { x: 27, z: 18 },
  table: { x: 7.5, z: 15 },
};

// ---------------------------------------------------------------------------
function stripeTexture(color) {
  const c = makeCanvas(256, 128);
  const g = c.getContext('2d');
  const col = new THREE.Color(color);
  for (let i = 0; i < 16; i++) {
    g.fillStyle = i % 2 ? '#e9e2cf' : `#${col.getHexString()}`;
    g.fillRect(i * 16, 0, 16, 128);
  }
  // складки и пятна на ткани
  const rnd = mulberry32(color);
  for (let k = 0; k < 900; k++) {
    g.fillStyle = `rgba(0,0,0,${rnd() * 0.06})`;
    g.fillRect(rnd() * 256, rnd() * 128, 1 + rnd() * 3, 4 + rnd() * 20);
  }
  const t = toTexture(c);
  return t;
}

// Шатёр-павильон: полосатые стены, конусная крыша, фестоны, растяжки и вымпел
function pavilion(scene, wood, terrain, { x, z, r, c }, iron) {
  const g = terrain.heightAt(x, z);
  const tex = stripeTexture(c);
  const cloth = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 });
  const H = 2.2, RH = 1.9;
  // стена с открытым входом
  const wallG = new THREE.CylinderGeometry(r, r * 1.02, H, 32, 1, true, 0.5, Math.PI * 2 - 1.0);
  const wall = new THREE.Mesh(wallG, cloth);
  wall.position.set(x, g + H / 2, z);
  wall.rotation.y = -Math.PI / 2;
  // крыша
  const roofTex = tex.clone();
  roofTex.repeat.set(1, 1);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(r + 0.25, RH, 32, 1, true), cloth);
  roof.position.set(x, g + H + RH / 2 - 0.05, z);
  // фестоны по краю крыши (зубчатая кромка)
  const val = makeCanvas(256, 32);
  const vg = val.getContext('2d');
  vg.fillStyle = `#${new THREE.Color(c).getHexString()}`;
  for (let i = 0; i < 16; i++) {
    vg.beginPath();
    vg.moveTo(i * 16, 0); vg.lineTo(i * 16 + 16, 0); vg.lineTo(i * 16 + 16, 14); vg.quadraticCurveTo(i * 16 + 8, 34, i * 16, 14); vg.fill();
  }
  const valTex = toTexture(val, { repeat: false });
  valTex.wrapS = THREE.RepeatWrapping;
  valTex.repeat.set(3, 1);
  const valance = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.26, r + 0.26, 0.35, 32, 1, true),
    new THREE.MeshStandardMaterial({ map: valTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }));
  valance.position.set(x, g + H - 0.12, z);
  for (const m of [wall, roof, valance]) { m.castShadow = m.receiveShadow = true; scene.add(m); }
  // центральный шест с шаром и вымпелом
  wood.addGeometry(new THREE.CylinderGeometry(0.06, 0.07, H + RH + 1.2, 8), new THREE.Matrix4().makeTranslation(x, g + (H + RH + 1.2) / 2, z));
  const pen = new THREE.Shape();
  pen.moveTo(0, 0); pen.lineTo(1.1, -0.15); pen.lineTo(0, -0.35); pen.lineTo(0, 0);
  const pm = new THREE.Mesh(new THREE.ShapeGeometry(pen), new THREE.MeshStandardMaterial({ color: c, side: THREE.DoubleSide, roughness: 0.8 }));
  pm.position.set(x, g + H + RH + 1.15, z);
  pm.rotation.y = -0.6;
  scene.add(pm);
  // растяжки к колышкам
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    if (Math.abs(((a + Math.PI) % (Math.PI * 2)) - Math.PI) < 0.35) continue; // у входа
    const top = new V3(x + Math.cos(a) * (r + 0.2), g + H + 0.1, z + Math.sin(a) * (r + 0.2));
    const peg = new V3(x + Math.cos(a) * (r + 1.4), 0, z + Math.sin(a) * (r + 1.4));
    peg.y = terrain.heightAt(peg.x, peg.z);
    const d = peg.clone().sub(top);
    const len = d.length();
    const rope = new THREE.CylinderGeometry(0.008, 0.008, len, 4);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize());
    wood.addGeometry(rope, new THREE.Matrix4().compose(top.clone().addScaledVector(d, len / 2), q, new V3(1, 1, 1)));
    wood.box(peg.clone().setY(peg.y + 0.1), UP, new V3(1, 0, 0), new V3(0, 0, 1), 0.15, 0.03, 0.03);
  }
  void iron;
}

// Курица: тело, хвост, голова, гребешок, клюв, лапки
function chicken(B, x, y, z, yaw, rnd) {
  const col = [0xf2ede0, 0x8a5a2a, 0x5a3a1c, 0xd8c7a0][Math.floor(rnd() * 4)];
  const root = new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, yaw), new V3(1, 1, 1));
  const M = (px, py, pz, sx, sy, sz, rx = 0) => root.clone().multiply(new THREE.Matrix4().compose(new V3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), new V3(sx, sy, sz)));
  const sph = new THREE.SphereGeometry(1, 10, 8);
  const peck = rnd() < 0.3;
  B.add(sph, M(0, 0.2, 0, 0.12, 0.11, 0.17), col);
  B.add(sph, M(0, 0.27, -0.14, 0.06, 0.1, 0.06, -0.6), col);
  const hy = peck ? 0.1 : 0.36, hz = peck ? 0.2 : 0.14;
  B.add(sph, M(0, hy, hz, 0.055, 0.065, 0.06), col);
  B.add(new THREE.BoxGeometry(0.015, 0.05, 0.06), M(0, hy + 0.07, hz, 1, 1, 1), 0xc0201a);
  B.add(new THREE.ConeGeometry(0.018, 0.05, 5), M(0, hy, hz + 0.07, 1, 1, 1, Math.PI / 2), 0xe0a020);
  for (const sd of [-1, 1]) B.add(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 4), M(sd * 0.04, 0.06, 0, 1, 1, 1), 0xd09a30);
}

// Плющ: веточки и листья-карточки, растущие по стене пятном от земли вверх
function ivyPatch(leaves, stems, terrain, base, along, nrm, width, height, rnd) {
  const g = terrain.heightAt(base.x, base.z);
  const n = Math.round(width * height * 28);
  for (let k = 0; k < n; k++) {
    const u = (rnd() - 0.5) * width;
    const vmax = height * Math.sqrt(Math.max(0, 1 - (2 * u / width) ** 2)) * (0.7 + rnd() * 0.3);
    const v = Math.pow(rnd(), 0.8) * vmax;
    const p = base.clone().addScaledVector(along, u).addScaledVector(nrm, 0.04 + rnd() * 0.12);
    p.y = g + v - 0.1;
    const s = 0.22 + rnd() * 0.18;
    const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), nrm.clone().addScaledVector(UP, (rnd() - 0.3) * 0.8).addScaledVector(along, (rnd() - 0.5) * 0.8).normalize());
    leaves.addGeometry(new THREE.PlaneGeometry(s, s), new THREE.Matrix4().compose(p, q, new V3(1, 1, 1)));
  }
  // несколько стеблей
  for (let k = 0; k < Math.round(width * 1.5); k++) {
    const u = (rnd() - 0.5) * width * 0.8;
    const h = height * (0.5 + rnd() * 0.5);
    const p = base.clone().addScaledVector(along, u).addScaledVector(nrm, 0.03).setY(g + h / 2 - 0.1);
    stems.box(p, UP, along, nrm, h / 2, 0.018, 0.018, { grain: true });
  }
}

// ---------------------------------------------------------------------------
export function createDetails(scene, terrain, walls, village) {
  const rnd = mulberry32(8181);
  const wood = new GeoBuilder(walls.woodMaterial.userData.tileMeters);
  const stone = new GeoBuilder(walls.stoneMaterial.userData.tileMeters);
  const metal = new GeoBuilder(1);
  const soil = new GeoBuilder(1), plants = new GeoBuilder(1), straw = new GeoBuilder(1), shingle = new GeoBuilder(1);
  const colorB = new ColorBuilder();
  const leaves = new GeoBuilder(1), stems = new GeoBuilder(1);
  const iron = new THREE.MeshStandardMaterial({ color: 0x2c2926, metalness: 0.85, roughness: 0.5 });
  const E = COURT_EXTRAS;
  const X = new V3(1, 0, 0), Z = new V3(0, 0, 1);

  // ---- скамья вокруг старой липы ----
  {
    const { x, z } = E.linden;
    const g = terrain.heightAt(x, z);
    const R = 1.6, segs = 10;
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      const d = new V3(Math.cos(a), 0, Math.sin(a)), t = new V3(-Math.sin(a), 0, Math.cos(a));
      const c = new V3(x, 0, z).addScaledVector(d, R);
      wood.box(c.clone().setY(g + 0.45), t, UP, d, R * Math.PI / segs + 0.02, 0.04, 0.2, { grain: true });
      wood.box(c.clone().setY(g + 0.22), UP, t, d, 0.22, 0.05, 0.05, { grain: true });
    }
    // камни-бордюр вокруг ствола
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      stone.box(new V3(x + Math.cos(a) * 0.95, g + 0.1, z + Math.sin(a) * 0.95), new V3(-Math.sin(a), 0, Math.cos(a)), UP, new V3(Math.cos(a), 0, Math.sin(a)), 0.24, 0.12, 0.12);
    }
  }

  // ---- огород (травы и овощи) за плетнём ----
  {
    const { x, z, w, d } = E.garden;
    const f = new Frame({ x, z, ax: 1, az: 0, nx: 0, nz: 1 });
    const c = (lx, lz) => f.p(lx, 0, lz);
    wattleFence(wood, terrain, [c(-1, d / 2), c(-w / 2, d / 2), c(-w / 2, -d / 2), c(w / 2, -d / 2), c(w / 2, d / 2), c(1, d / 2)], 0.9);
    gardenBeds(soil, plants, terrain, f, -w / 2 + 0.5, -d / 2 + 0.5, w - 1, d - 1, rnd);
  }

  // ---- шатры ----
  for (const t of E.tents) pavilion(scene, wood, terrain, t, iron);

  // ---- курятник: домик на ножках, лесенка, загон из плетня, куры ----
  {
    const { x, z } = E.coop;
    const g = terrain.heightAt(x, z);
    const f = new Frame({ x, z, ax: 1, az: 0, nx: 0, nz: 1 });
    for (const [lx, lz] of [[-0.8, -0.55], [0.8, -0.55], [-0.8, 0.55], [0.8, 0.55]]) wood.box(f.p(lx, g + 0.3, lz), UP, X, Z, 0.3, 0.05, 0.05, { grain: true });
    wood.box(f.p(0, g + 0.62, 0), X, UP, Z, 0.9, 0.04, 0.65, { grain: true });
    for (const [lx, lz, ax, hl] of [[0, -0.62, X, 0.9], [0, 0.62, X, 0.9], [-0.88, 0, Z, 0.62], [0.88, 0, Z, 0.62]]) {
      const n = new V3().crossVectors(UP, ax).normalize();
      wood.box(f.p(lx, g + 1.05, lz), ax, UP, n, hl, 0.42, 0.025, { grain: true });
    }
    for (const s of [1, -1]) {
      const ax = new V3(0, 0.55, s).normalize();
      shingle.box(f.p(0, g + 1.72, s * 0.4), X, ax, new V3().crossVectors(X, ax).normalize(), 1.05, 0.03, 0.5, { grain: true });
    }
    const ramp = new V3(0, 0.62, 1).normalize();
    wood.box(f.p(0.3, g + 0.3, 1.1), X, ramp, new V3().crossVectors(X, ramp).normalize(), 0.18, 0.02, 0.6, { grain: true });
    const run = [f.p(-2.6, 0, -1.3), f.p(-2.6, 0, 3.3), f.p(2.6, 0, 3.3), f.p(2.6, 0, -1.3)];
    wattleFence(wood, terrain, run, 0.75);
    straw.box(f.p(0, g + 0.02, 1.2), X, UP, Z, 2.4, 0.02, 2.0);
    for (let k = 0; k < 9; k++) {
      const p = f.p((rnd() - 0.5) * 4.4, 0, 1 + (rnd() - 0.5) * 3.6);
      chicken(colorB, p.x, terrain.heightAt(p.x, p.z) + 0.02, p.z, rnd() * 6.28, rnd);
    }
    // пара кур гуляет по двору
    for (let k = 0; k < 4; k++) {
      const p = new V3(-24 + rnd() * 6, 0, 12 + rnd() * 4);
      chicken(colorB, p.x, terrain.heightAt(p.x, p.z) + 0.02, p.z, rnd() * 6.28, rnd);
    }
  }

  // ---- квинтана (вращающийся учебный столб) и столбы-«пеллы» ----
  {
    const { x, z } = E.quintain;
    const g = terrain.heightAt(x, z);
    wood.box(new V3(x, g + 1.3, z), UP, X, Z, 1.3, 0.1, 0.1, { grain: true });
    for (const a of [0, 1.57, 3.14, 4.71]) {
      const d = new V3(Math.cos(a), 0, Math.sin(a));
      const ax = d.clone().addScaledVector(UP, 1).normalize();
      wood.box(new V3(x, g + 0.3, z).addScaledVector(d, 0.3), ax, new V3().crossVectors(ax, d).normalize().cross(ax), new V3().crossVectors(ax, UP).normalize(), 0.42, 0.05, 0.05, { grain: true });
    }
    const arm = new V3(0.8, 0, 0.6).normalize();
    wood.box(new V3(x, g + 2.35, z), arm, UP, new V3().crossVectors(UP, arm), 1.1, 0.06, 0.06, { grain: true });
    // щит на одном конце, мешок с песком на другом
    const sh = new V3(x, g + 2.15, z).addScaledVector(arm, 1.05);
    wood.box(sh, new V3().crossVectors(UP, arm), UP, arm, 0.32, 0.42, 0.03, { grain: true });
    metal.box(sh.clone().addScaledVector(arm, 0.035), new V3().crossVectors(UP, arm), UP, arm, 0.08, 0.08, 0.02);
    const bagTop = new V3(x, g + 2.35, z).addScaledVector(arm, -1.05);
    const rope = new THREE.CylinderGeometry(0.01, 0.01, 0.6, 4);
    wood.addGeometry(rope, new THREE.Matrix4().makeTranslation(bagTop.x, bagTop.y - 0.3, bagTop.z));
    const bag = new THREE.SphereGeometry(0.22, 10, 8);
    straw.addGeometry(bag, new THREE.Matrix4().compose(bagTop.clone().setY(bagTop.y - 0.75), new THREE.Quaternion(), new V3(1, 1.3, 1)));
    // пеллы — столбы для ударов мечом
    for (let k = 0; k < 3; k++) {
      const p = new V3(x - 5 + k * 1.8, 0, z + 1.5);
      const gy = terrain.heightAt(p.x, p.z);
      wood.box(p.clone().setY(gy + 0.9), UP, X, Z, 0.9, 0.12, 0.12, { grain: true });
    }
  }

  // ---- стол на козлах с лавками, кувшин и миски ----
  {
    const { x, z } = E.table;
    const g = terrain.heightAt(x, z);
    const a = 0.5;
    const ax = new V3(Math.cos(a), 0, Math.sin(a)), nz = new V3(-Math.sin(a), 0, Math.cos(a));
    const C = new V3(x, 0, z);
    wood.box(C.clone().setY(g + 0.76), ax, UP, nz, 1.25, 0.04, 0.42, { grain: true });
    for (const s of [-1, 1]) {
      const leg = C.clone().addScaledVector(ax, s * 0.9);
      for (const t of [-1, 1]) {
        const d = UP.clone().addScaledVector(nz, t * 0.35).normalize();
        wood.box(leg.clone().addScaledVector(nz, t * 0.14).setY(g + 0.37), d, ax, new V3().crossVectors(d, ax), 0.4, 0.04, 0.04, { grain: true });
      }
      const bench = C.clone().addScaledVector(nz, s * 0.85);
      wood.box(bench.clone().setY(g + 0.45), ax, UP, nz, 1.2, 0.04, 0.16, { grain: true });
      for (const t of [-0.95, 0.95]) wood.box(bench.clone().addScaledVector(ax, t).setY(g + 0.22), UP, ax, nz, 0.22, 0.04, 0.12, { grain: true });
    }
    const jug = new THREE.LatheGeometry([[0.001, 0], [0.08, 0], [0.1, 0.08], [0.07, 0.2], [0.05, 0.26], [0.06, 0.3]].map(([r, y]) => new THREE.Vector2(r, y)), 12);
    colorB.add(jug, new THREE.Matrix4().makeTranslation(x, g + 0.8, z), 0x8a5a3a);
    for (let k = 0; k < 4; k++) {
      const p = C.clone().addScaledVector(ax, -0.9 + k * 0.55).addScaledVector(nz, (k % 2 ? 1 : -1) * 0.22);
      colorB.add(new THREE.CylinderGeometry(0.09, 0.06, 0.05, 10), new THREE.Matrix4().makeTranslation(p.x, g + 0.805, p.z), 0x6a4a2a);
    }
  }

  // ---- мешки у склада и амбара, дрова у кузницы ----
  const byId = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));
  for (const [id, lx0] of [['store', 3.2], ['granary', -3.0]]) {
    const f = new Frame(byId[id]);
    // три мешка в ряд и один лежит сверху (форма мешка — с перевязанной горловиной)
    for (let k = 0; k < 4; k++) {
      const lying = k === 3;
      const p = f.p(lx0 + (lying ? 0.55 : k * 0.55), 0, byId[id].W / 2 + 0.6);
      const g = terrain.heightAt(p.x, p.z);
      const q = lying ? new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, rnd() * 0.4, 0)) : new THREE.Quaternion().setFromAxisAngle(UP, rnd() * 3);
      colorB.add(SACK, new THREE.Matrix4().compose(p.setY(g + (lying ? 0.72 : 0)), q, new V3(1, 1, 1)), [0x9a8660, 0x8a7654, 0xa8946c][k % 3]);
    }
  }
  {
    const f = new Frame(byId.forge);
    const log = new THREE.CylinderGeometry(0.1, 0.1, 0.8, 7).rotateZ(Math.PI / 2);
    for (let r = 0; r < 4; r++) for (let k = 0; k < 7 - r; k++) {
      const p = f.p(byId.forge.L / 2 + 0.7, 0, -1.2 + k * 0.21 + r * 0.1);
      wood.addGeometry(log, new THREE.Matrix4().makeBasis(f.N, UP, f.X).setPosition(p.x, terrain.heightAt(p.x, p.z) + 0.1 + r * 0.18, p.z));
    }
  }
  // коновязь у конюшни
  {
    const f = new Frame(byId.stable);
    const c = f.p(0, 0, byId.stable.W / 2 + 2.4);
    const g = terrain.heightAt(c.x, c.z);
    for (const s of [-1.6, 1.6]) wood.box(f.p(s, g + 0.55, byId.stable.W / 2 + 2.4), UP, f.X, f.N, 0.55, 0.07, 0.07, { grain: true });
    wood.box(c.clone().setY(g + 1.05), f.X, UP, f.N, 1.8, 0.05, 0.05, { grain: true });
  }

  // ---- плющ на внутренних сторонах стен и у донжона ----
  {
    const P = walls.points, N = walls.segNrm, T = WALL.thickness;
    for (let i = 1; i < P.length - 2; i += 3) {
      const t = 0.3 + rnd() * 0.4;
      const base = P[i].clone().lerp(P[i + 1], t).addScaledVector(N[i], -T / 2);
      const along = P[i + 1].clone().sub(P[i]).normalize();
      if (BUILDINGS.some((b) => Math.hypot(base.x - b.x, base.z - b.z) < Math.max(b.L, b.W) / 2 + 3)) continue;
      ivyPatch(leaves, stems, terrain, base, along, N[i].clone().negate(), 2.5 + rnd() * 2.5, 3 + rnd() * 3.5, rnd);
    }
    const kn = new V3(Math.cos(KEEP.yaw + Math.PI), 0, Math.sin(KEEP.yaw + Math.PI));
    const kt = new V3(-kn.z, 0, kn.x);
    ivyPatch(leaves, stems, terrain, new V3(KEEP.x, 0, KEEP.z).addScaledVector(kn, KEEP.r + 0.5).addScaledVector(kt, 2), kt, kn, 4, 7, rnd);
  }

  // ---- люди ----
  const people = [];
  const add = (p) => people.push(p);
  const g = (x, z) => terrain.heightAt(x, z);
  const face = (fx, fz) => Math.atan2(fx, fz);
  // стража на боевом ходу — смотрит наружу
  {
    const P = walls.points, N = walls.segNrm, Wk = walls.walk;
    for (const i of [2, 6, 10, 14, 18]) {
      if (i >= P.length - 1) continue;
      const t = 0.45;
      const p = P[i].clone().lerp(P[i + 1], t).addScaledVector(N[i], -0.55);
      add({ x: p.x, y: Wk[i] + (Wk[i + 1] - Wk[i]) * t + 0.1, z: p.z, yaw: face(N[i].x, N[i].z), role: i % 4 === 2 ? 'archer' : 'guard' });
    }
  }
  // у ворот
  for (const s of [-1, 1]) add({ x: s * 2.6, y: g(s * 2.6, GATE_PASSAGE.rampEndZ + 1.5), z: GATE_PASSAGE.rampEndZ + 1.5, yaw: Math.PI, role: 'guard' });
  for (const s of [-1, 1]) {
    const z = BARBICAN.zS + 1.6;
    add({ x: s * 2.7, y: g(s * 2.7, z), z, yaw: 0, role: 'guard' });
  }
  // кузнец у наковальни
  {
    const f = new Frame(byId.forge);
    const p = f.p(-1.0, 0, 1.6);
    add({ x: p.x, y: g(p.x, p.z) + 0.1, z: p.z, yaw: face(-f.N.x, -f.N.z), role: 'smith' });
  }
  // у колодца: женщина с ведром и дети
  add({ x: WELL.x + 0.3, y: g(WELL.x, WELL.z + 2), z: WELL.z + 2.1, yaw: Math.PI, role: 'woman' });
  add({ x: WELL.x - 3.5, y: g(WELL.x - 3.5, WELL.z + 3), z: WELL.z + 3, yaw: 2.2, role: 'child', pose: 'walk' });
  add({ x: WELL.x - 2.4, y: g(WELL.x - 2.4, WELL.z + 4.4), z: WELL.z + 4.4, yaw: -2.4, role: 'child' });
  // лучники на рубеже
  for (const [x, z] of [[14, -6], [15.6, -4.8]]) add({ x, y: g(x, z), z, yaw: face(31 - x, -13 - z), role: 'archer' });
  // у большого зала: рыцарь и знатный гость, слуга
  {
    const b = byId.hall, f = new Frame(b);
    const p = f.p(6.4, 0, b.W / 2 + 4.2), q = f.p(5.2, 0, b.W / 2 + 5.0);
    add({ x: p.x, y: g(p.x, p.z), z: p.z, yaw: face(q.x - p.x, q.z - p.z), role: 'knight' });
    add({ x: q.x, y: g(q.x, q.z), z: q.z, yaw: face(p.x - q.x, p.z - q.z), role: 'noble' });
  }
  // священник у часовни
  {
    const b = byId.chapel, f = new Frame(b);
    const p = f.p(-4.6, 0, b.W / 2 + 2.6);
    add({ x: p.x, y: g(p.x, p.z), z: p.z, yaw: face(f.N.x, f.N.z), role: 'priest' });
  }
  // у кухни, склада, конюшни — слуги; у казарм — двое стражников беседуют
  for (const [id, lx, lz] of [['kitchen', 1.0, 1.6], ['store', 2.0, 2.2], ['stable', 1.5, 2.0], ['granary', 1.0, 2.2]]) {
    const b = byId[id], f = new Frame(b);
    const p = f.p(lx, 0, b.W / 2 + lz);
    add({ x: p.x, y: g(p.x, p.z), z: p.z, yaw: face(f.N.x, f.N.z) + (rnd() - 0.5) * 1.5, role: 'servant', pose: rnd() < 0.4 ? 'walk' : 'stand' });
  }
  {
    const b = byId.barracks, f = new Frame(b);
    const p = f.p(-0.5, 0, b.W / 2 + 2.5), q = f.p(0.6, 0, b.W / 2 + 3.2);
    add({ x: p.x, y: g(p.x, p.z), z: p.z, yaw: face(q.x - p.x, q.z - p.z), role: 'guard' });
    add({ x: q.x, y: g(q.x, q.z), z: q.z, yaw: face(p.x - q.x, p.z - q.z), role: 'guard' });
  }
  // во дворе: у шатров, у стола, у квинтаны, в огороде
  add({ x: 19.5, y: g(19.5, -17.6), z: -17.6, yaw: 0.6, role: 'knight' });
  add({ x: E.table.x + 0.2, y: g(E.table.x, E.table.z + 1.4), z: E.table.z + 1.4, yaw: Math.PI, role: 'servant' });
  add({ x: E.quintain.x - 2.2, y: g(E.quintain.x - 2.2, E.quintain.z - 1), z: E.quintain.z - 1, yaw: 1.2, role: 'guard' });
  add({ x: E.garden.x + 1, y: g(E.garden.x + 1, E.garden.z), z: E.garden.z, yaw: 0.3, role: 'woman', pose: 'work' });
  add({ x: 2, y: g(2, 10), z: 10, yaw: 2.8, role: 'peasant', pose: 'walk' });
  // деревня: у домов, в огородах, на мосту
  if (village) {
    village.houses.forEach((h, i) => {
      const f = h.f;
      if (i % 2 === 0) {
        const p = f.p(1.2, 0, h.W / 2 + 1.6);
        add({ x: p.x, y: g(p.x, p.z), z: p.z, yaw: face(f.N.x, f.N.z), role: i % 4 === 0 ? 'woman' : 'peasant' });
      }
      if (i % 3 === 1) {
        const p = f.p(0.5, 0, -h.W / 2 - 4.5);
        add({ x: p.x, y: g(p.x, p.z), z: p.z, yaw: rnd() * 6, role: 'peasant', pose: 'work' });
      }
      if (i % 5 === 2) {
        const p = f.p(-2, 0, h.W / 2 + 3);
        add({ x: p.x, y: g(p.x, p.z), z: p.z, yaw: rnd() * 6, role: 'child', pose: 'walk' });
      }
    });
    const { a, b } = village.bridge;
    const m = a.clone().lerp(b, 0.4);
    const bd = b.clone().sub(a).normalize();
    add({ x: m.x, y: terrain.road.find((q) => q.bridge).h + 0.05, z: m.z, yaw: face(-bd.x, -bd.z), role: 'peasant', pose: 'walk' });
  }
  // хозяйственная жизнь двора: рынок, лошади, свиньи, поленница и т. д.
  const yardBarrels = [];
  addYardLife({ terrain, wood, metal, straw, colorB, stone, people, rnd, barrels: yardBarrels });
  if (yardBarrels.length) buildBarrels(scene, terrain, yardBarrels, walls.woodMaterial, iron, rnd);
  const peopleUpd = createPeople(scene, people);

  // ---- сборка ----
  const plantMat = new THREE.MeshStandardMaterial({ color: 0x46702a, roughness: 0.8 });
  const soilMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 1 });
  const ivyMat = new THREE.MeshStandardMaterial({ map: foliageTexture('broad', [0.1, 0.2, 0.06]), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7 });
  const colorMat = addTailSway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  for (const [bld, mat] of [
    [wood, walls.woodMaterial], [stone, walls.stoneMaterial], [metal, iron], [soil, soilMat], [plants, plantMat],
    [straw, strawMaterial()], [shingle, pbrMaterial('shingle')], [colorB, colorMat], [leaves, ivyMat], [stems, walls.woodMaterial],
  ]) {
    if (!bld.pos.length) continue;
    const m = new THREE.Mesh(bld.build(), mat);
    m.castShadow = m.receiveShadow = true;
    m.name = 'details';
    scene.add(m);
  }
  return {
    extraTrees: [{ x: E.linden.x, z: E.linden.z, sp: 'oak', s: 1.35, rot: 0.7, v: 1 }],
    exclude: (x, z) => {
      const G2 = E.garden;
      if (Math.abs(x - G2.x) < G2.w / 2 + 0.5 && Math.abs(z - G2.z) < G2.d / 2 + 0.5) return 1;
      for (const t of E.tents) if (Math.hypot(x - t.x, z - t.z) < t.r) return 1;
      if (Math.hypot(x - E.coop.x, z - E.coop.z - 1) < 3) return 0.7;
      return yardExclude(x, z);
    },
    update(t) { peopleUpd.update(t); },
  };
}
