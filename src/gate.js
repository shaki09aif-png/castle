// Этап 4: надвратная башня с проездом, подъёмный мост на цепях, опускная
// решётка (герса), дубовые ворота с железными полосами, машикули над входом,
// вода во рву и барбакан — укреплённый двор перед рвом.
import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { GATEHOUSE, GATE_PASSAGE, BARBICAN, MOAT, DITCH, GATE_RADIUS } from './layout.js';
import { guardReflection } from './water.js';
import { GeoBuilder } from './walls.js';
import { makeTowerContext, finishTowerContext, buildTower, arrowSlit, windowWithShutters } from './towers.js';
import { pbrMaterial, waterNormalTexture } from './textures.js';
import { SUN_DIR, SUN_COLOR } from './lighting.js';
import { mulberry32 } from './noise.js';
import { Q } from './quality.js';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);
const X = new V3(1, 0, 0);
const Z = new V3(0, 0, 1);

// Стрельчатая арка из двух дуг радиуса 0.8·w: высота над пятами в точке x
function archY(x, w) {
  const R = 0.8 * w, d = R - w / 2;
  return Math.sqrt(Math.max(0, R * R - (Math.abs(x) + d) ** 2));
}
function archPoints(w, spring, n = 16) {
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const x = -w / 2 + (k / n) * w;
    pts.push(new THREE.Vector2(x, spring + archY(x, w)));
  }
  return pts;
}

// Плоская стена с проёмом (ShapeGeometry): прямоугольник + отверстие.
// Геометрия строится в плоскости XY, затем ставится в мир по базису (t, UP, n).
function faceWithHole(b, origin, t, n, x0, x1, y0, y1, holePts) {
  const shape = new THREE.Shape([
    new THREE.Vector2(x0, y0), new THREE.Vector2(x1, y0), new THREE.Vector2(x1, y1), new THREE.Vector2(x0, y1),
  ]);
  if (holePts) shape.holes.push(new THREE.Path(holePts));
  const geo = new THREE.ShapeGeometry(shape, 12);
  // UV: метры вдоль стены и по высоте (как у остальной кладки)
  const uv = geo.getAttribute('uv');
  const pos = geo.getAttribute('position');
  for (let i = 0; i < uv.count; i++) {
    const wx = origin.x + t.x * pos.getX(i), wz = origin.z + t.z * pos.getX(i);
    uv.setXY(i, (wx * Math.abs(t.x) + wz * Math.abs(t.z)) / b.tile, pos.getY(i) / b.tile);
  }
  const m = new THREE.Matrix4().makeBasis(t, UP, n).setPosition(origin.x, 0, origin.z);
  b.addGeometry(geo, m);
}

// Свод проезда: полоса по дуге арки вдоль оси (от z0 до z1), нормали — внутрь
function vault(b, cx, z0, z1, w, spring, floorY) {
  const pts = archPoints(w, spring, 14);
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], c = pts[k + 1];
    const mid = new V3((a.x + c.x) / 2, (a.y + c.y) / 2, 0);
    const n = new V3(-mid.x, spring + archY(0, w) * 0.2 - mid.y, 0).normalize();
    const p0 = new V3(cx + a.x, floorY + a.y, z0), p1 = new V3(cx + c.x, floorY + c.y, z0);
    const p2 = new V3(cx + c.x, floorY + c.y, z1), p3 = new V3(cx + a.x, floorY + a.y, z1);
    const s0 = k * 0.4, s1 = (k + 1) * 0.4;
    b.quad(p0, p1, p2, p3, n, [[s0, z0], [s1, z0], [s1, z1], [s0, z1]]);
  }
}

// Цепь из звеньев (InstancedMesh торов)
function chainMesh(links, ironMat) {
  const geo = new THREE.TorusGeometry(0.065, 0.017, 6, 12);
  geo.scale(1, 1.45, 1);
  const im = new THREE.InstancedMesh(geo, ironMat, links.length);
  links.forEach((m, i) => im.setMatrixAt(i, m));
  im.castShadow = true;
  im.receiveShadow = true;
  return im;
}
function chainLinks(a, b) {
  const dir = b.clone().sub(a);
  const len = dir.length();
  dir.normalize();
  const n = Math.floor(len / 0.13);
  const out = [];
  const q0 = new THREE.Quaternion().setFromUnitVectors(UP, dir);
  const twist = new THREE.Quaternion().setFromAxisAngle(dir, Math.PI / 2);
  for (let k = 0; k < n; k++) {
    // лёгкое провисание цепи
    const t = (k + 0.5) / n;
    const p = a.clone().addScaledVector(dir, len * t);
    p.y -= Math.sin(t * Math.PI) * 0.12;
    const q = k % 2 ? q0.clone().premultiply(twist) : q0.clone();
    out.push(new THREE.Matrix4().compose(p, q, new V3(1, 1, 1)));
  }
  return out;
}

// ---------------------------------------------------------------------------
export function createGate(scene, terrain, walls) {
  const ctx = makeTowerContext(scene, terrain, walls);
  const { stone, wood, dark, metal } = ctx;
  const oak = new GeoBuilder(walls.woodMaterial.userData.tileMeters); // тёмный дуб: ворота, решётка, мост
  const oakMat = pbrMaterial('wood', { color: 0x6e5a46 });
  const rnd = mulberry32(4040);
  const G = GATEHOUSE, P = GATE_PASSAGE;
  const cx = G.x;
  const floorY = P.thresholdY;
  const w = P.width, spring = P.spring;
  const archTop = spring + archY(0, w);
  const walkY = walls.walkAt(G.node.x, G.node.z);
  const platY = walkY + G.extra;

  // ======================= НАДВРАТНАЯ БАШНЯ =======================
  // Верх (консоли-машикули, парапет, крыша, флюгер), двери на стены, окно во двор
  buildTower(ctx, G, {
    walkY, body: false, slits: false, groundDoor: false,
    outDir: Z.clone(), wallDirs: [X.clone(), X.clone().negate()],
  });

  // Боковые стены (восточная и западная): кладка до площадки, основание по рельефу
  const topY = platY - 0.3;
  for (const sx of [-1, 1]) {
    const xw = cx + sx * G.r;
    const n = X.clone().multiplyScalar(sx);
    const cols = Math.ceil((P.frontZ - P.backZ) / 1.0);
    for (let c = 0; c < cols; c++) {
      const z0 = P.backZ + (c / cols) * (P.frontZ - P.backZ), z1 = P.backZ + ((c + 1) / cols) * (P.frontZ - P.backZ);
      const b0 = terrain.heightAt(xw + sx * 0.8, z0) - 1, b1 = terrain.heightAt(xw + sx * 0.8, z1) - 1;
      const bb0 = Math.min(b0, c === cols - 1 ? 74 : b0), bb1 = Math.min(b1, c === cols - 1 ? 74 : b1);
      stone.quad(new V3(xw, bb0, z0), new V3(xw, bb1, z1), new V3(xw, topY, z1), new V3(xw, topY, z0), n,
        [[z0, bb0], [z1, bb1], [z1, topY], [z0, topY]], [9, 9, 9, 9]);
    }
  }
  // Лицевая сторона (ко рву): ниша для поднятого моста, в ней — арка проезда
  const recessW = w / 2 + 0.75, recessH = 7.0, recessD = 0.4;
  const front = new V3(cx, 0, P.frontZ);
  faceWithHole(stone, front, X, Z, -G.r, G.r, 73.5, topY, [
    new THREE.Vector2(-recessW, floorY), new THREE.Vector2(recessW, floorY),
    new THREE.Vector2(recessW, floorY + recessH), new THREE.Vector2(-recessW, floorY + recessH),
  ]);
  const recessBack = new V3(cx, 0, P.frontZ - recessD);
  faceWithHole(stone, recessBack, X, Z, -recessW, recessW, floorY - 0.3, floorY + recessH, [
    new THREE.Vector2(-w / 2, floorY), new THREE.Vector2(w / 2, floorY),
    ...archPoints(w, floorY + spring).reverse(),
  ]);
  // боковины и верх ниши
  for (const sx of [-1, 1]) {
    const x = cx + sx * recessW;
    stone.quad(new V3(x, floorY, P.frontZ - recessD), new V3(x, floorY, P.frontZ), new V3(x, floorY + recessH, P.frontZ), new V3(x, floorY + recessH, P.frontZ - recessD),
      X.clone().multiplyScalar(-sx), [[0, floorY], [recessD, floorY], [recessD, floorY + recessH], [0, floorY + recessH]]);
  }
  stone.quad(new V3(cx - recessW, floorY + recessH, P.frontZ - recessD), new V3(cx + recessW, floorY + recessH, P.frontZ - recessD),
    new V3(cx + recessW, floorY + recessH, P.frontZ), new V3(cx - recessW, floorY + recessH, P.frontZ), UP.clone().negate(),
    [[-recessW, 0], [recessW, 0], [recessW, recessD], [-recessW, recessD]]);
  // Сторона двора: та же арка без ниши
  faceWithHole(stone, new V3(cx, 0, P.backZ), X.clone().negate(), Z.clone().negate(), -G.r, G.r, floorY - 2, topY, [
    new THREE.Vector2(-w / 2, floorY), new THREE.Vector2(w / 2, floorY),
    ...archPoints(w, floorY + spring).reverse(),
  ]);
  // Стены проезда и стрельчатый свод
  for (const sx of [-1, 1]) {
    const x = cx + sx * (w / 2);
    stone.quad(new V3(x, floorY - 0.2, P.backZ), new V3(x, floorY - 0.2, P.frontZ - recessD), new V3(x, floorY + spring, P.frontZ - recessD), new V3(x, floorY + spring, P.backZ),
      X.clone().multiplyScalar(-sx), [[P.backZ, floorY], [P.frontZ, floorY], [P.frontZ, floorY + spring], [P.backZ, floorY + spring]]);
  }
  vault(stone, cx, P.backZ, P.frontZ - recessD, w, spring, floorY);
  // Мостовая проезда из каменных плит
  for (let z = P.backZ + 0.3; z < P.frontZ - 0.1; z += 0.62) {
    let x = cx - w / 2;
    while (x < cx + w / 2 - 0.05) {
      const pw = Math.min(cx + w / 2 - x, 0.5 + rnd() * 0.6);
      stone.box(new V3(x + pw / 2, floorY - 0.06 + rnd() * 0.03, z), X, UP, Z, pw / 2 - 0.02, 0.08, 0.29);
      x += pw;
    }
  }
  // Пазы для решётки в стенах и щель в своде, отверстия-«убийцы» в своде
  const pz = P.frontZ - recessD - 0.9;
  for (const sx of [-1, 1]) dark.box(new V3(cx + sx * (w / 2 - 0.02), floorY + spring / 2, pz), X, UP, Z, 0.03, spring / 2, 0.1);
  dark.box(new V3(cx, floorY + archTop - 0.02, pz), X, UP, Z, w / 2 - 0.3, 0.03, 0.1);
  for (const dz of [2.6, 4.4, 6.2]) dark.box(new V3(cx, floorY + archTop - 0.02, P.frontZ - dz), X, UP, Z, 0.28, 0.02, 0.28);

  // Подвижные части собираются отдельно, чтобы их можно было анимировать:
  // решётка (сдвиг вниз), створки ворот (поворот на петлях), мост (подъём на цепях)
  const pOak = new GeoBuilder(walls.woodMaterial.userData.tileMeters), pMetal = new GeoBuilder(1);
  // ---------- опускная решётка (герса): дубовые брусья, окованные железом ----------
  const pcBottom = floorY + 2.55; // приподнята: видны острия
  const pcTop = floorY + archTop + 1.2;
  const bars = 7;
  for (let k = 0; k < bars; k++) {
    const x = cx - w / 2 + 0.22 + (k / (bars - 1)) * (w - 0.44);
    const hTop = Math.min(pcTop, floorY + spring + archY(x - cx, w) + 1.0);
    pOak.box(new V3(x, (pcBottom + hTop) / 2, pz), UP, X, Z, (hTop - pcBottom) / 2, 0.055, 0.055, { grain: true });
    const spike = new THREE.ConeGeometry(0.06, 0.28, 6);
    pMetal.addGeometry(spike, new THREE.Matrix4().makeRotationX(Math.PI).setPosition(x, pcBottom - 0.13, pz));
  }
  for (let y = pcBottom + 0.2; y < floorY + spring + 0.8; y += 0.42) {
    pOak.box(new V3(cx, y, pz + 0.07), X, UP, Z, w / 2 - 0.1, 0.05, 0.04, { grain: true });
    for (let k = 0; k < bars; k++) {
      const x = cx - w / 2 + 0.22 + (k / (bars - 1)) * (w - 0.44);
      pMetal.box(new V3(x, y, pz + 0.12), X, UP, Z, 0.07, 0.07, 0.012);
    }
  }

  // ---------- дубовые ворота: две створки, распахнуты внутрь ----------
  const gz = pz - 1.3;
  const doors = [];
  for (const sx of [-1, 1]) {
    const dOak = new GeoBuilder(walls.woodMaterial.userData.tileMeters), dMetal = new GeoBuilder(1);
    const hinge = new V3(cx + sx * (w / 2 - 0.08), 0, gz);
    const along = new V3(0, 0, -1).applyAxisAngle(UP, sx * 0.12).normalize(); // почти вдоль стены
    const nrm = new V3().crossVectors(UP, along).multiplyScalar(-sx).normalize();
    const lw = w / 2 - 0.1, lh = spring + 0.9;
    const planks = 5;
    for (let k = 0; k < planks; k++) {
      const c = hinge.clone().addScaledVector(along, (k + 0.5) * (lw / planks)).addScaledVector(nrm, 0.09);
      dOak.box(new V3(c.x, floorY + lh / 2, c.z), UP, along, nrm, lh / 2, lw / planks / 2 - 0.005, 0.05, { grain: true });
    }
    // железные полосы, гвозди, петли
    for (const y of [0.35, 1.2, 2.1, lh - 0.35]) {
      const c = hinge.clone().addScaledVector(along, lw / 2).addScaledVector(nrm, 0.15);
      dMetal.box(new V3(c.x, floorY + y, c.z), along, UP, nrm, lw / 2 - 0.02, 0.045, 0.012);
      for (let k = 0; k < 6; k++) {
        const nc = hinge.clone().addScaledVector(along, 0.12 + k * (lw - 0.24) / 5).addScaledVector(nrm, 0.165);
        dMetal.box(new V3(nc.x, floorY + y, nc.z), along, UP, nrm, 0.02, 0.02, 0.012);
      }
    }
    // диагональные раскосы с обратной стороны
    const back = hinge.clone().addScaledVector(along, lw / 2).addScaledVector(nrm, 0.01);
    const diag = along.clone().multiplyScalar(lw).addScaledVector(UP, lh * 0.6).normalize();
    const dn = new V3().crossVectors(diag, nrm).normalize();
    dOak.box(new V3(back.x, floorY + lh * 0.45, back.z), diag, dn, nrm, Math.hypot(lw, lh * 0.6) / 2 - 0.1, 0.07, 0.04, { grain: true });
    // кольцо-ручка
    const ringM = new THREE.Matrix4().makeBasis(along, UP, nrm).setPosition(back.x + nrm.x * 0.2 + along.x * lw * 0.3, floorY + 1.2, back.z + nrm.z * 0.2 + along.z * lw * 0.3);
    dMetal.addGeometry(new THREE.TorusGeometry(0.09, 0.014, 6, 14), ringM);
    // угол поворота из открытого положения в закрытое (створка поперёк проезда)
    const closedAlong = new V3(-sx, 0, 0);
    const openAng = Math.atan2(along.x, along.z), closedAng = Math.atan2(closedAlong.x, closedAlong.z);
    let dAng = closedAng - openAng;
    while (dAng > Math.PI) dAng -= Math.PI * 2;
    while (dAng < -Math.PI) dAng += Math.PI * 2;
    doors.push({ oak: dOak, metal: dMetal, pivot: new V3(hinge.x, floorY, hinge.z), dAng });
  }

  // ---------- бойницы на фасаде и боках, отверстия для цепей ----------
  for (const sx of [-1, 1]) {
    arrowSlit(stone, dark, new V3(cx + sx * 3.95, 0, P.frontZ), Z, floorY + 4.2, false);
    arrowSlit(stone, dark, new V3(cx + sx * 3.95, 0, P.frontZ), Z, floorY + 9.6, true);
    arrowSlit(stone, dark, new V3(cx + sx * G.r, 0, P.frontZ - 3), X.clone().multiplyScalar(sx), floorY + 9.6, sx > 0);
    dark.box(new V3(cx + sx * 2.05, floorY + recessH + 0.6, P.frontZ + 0.01), X, UP, Z, 0.12, 0.12, 0.02);
    stone.box(new V3(cx + sx * 2.05, floorY + recessH + 0.6, P.frontZ + 0.03), X, UP, Z, 0.22, 0.22, 0.02);
  }
  // окно со ставнями над аркой со стороны двора
  windowWithShutters(stone, wood, dark, metal, new V3(cx, 0, P.backZ), Z.clone().negate(), floorY + archTop + 2.4);

  // ---------- машикули: отверстия в полу вынесенного парапета над воротами ----------
  {
    const r = G.r, count = Math.round((8 * r) / 1.25);
    const pos = [];
    for (let k = 0; k < count; k++) {
      const f = Math.floor((k / count) * 4);
      if (f !== 0) continue;
      const s = ((k / count) * 4 - f) * 2 * r - r + 0.4;
      if (Math.abs(s) > r - 0.3) continue;
      pos.push(s);
    }
    for (let i = 0; i < pos.length - 1; i++) {
      const s = (pos[i] + pos[i + 1]) / 2;
      // на лицевой грани (yaw = π/2): нормаль +Z, касательная −X
      const px = cx - s;
      dark.box(new V3(px, platY - 0.075, P.frontZ + G.corbelOut / 2), X, UP, Z, 0.22, 0.02, G.corbelOut / 2 - 0.1);
    }
  }

  // ======================= МОСТ ЧЕРЕЗ РОВ =======================
  const deckY = floorY;
  const dbLen = 6.0;
  const z0 = P.frontZ, z1 = P.frontZ + dbLen;
  const bw = w / 2 + 0.1; // полуширина моста
  // подъёмная часть: доски поперёк, два продольных бруса, железные оковки
  const bOak = new GeoBuilder(walls.woodMaterial.userData.tileMeters), bMetal = new GeoBuilder(1);
  for (let z = z0 + 0.12; z < z1 - 0.05; z += 0.26) {
    bOak.box(new V3(cx, deckY - 0.05 + (rnd() - 0.5) * 0.01, z), X, UP, Z, bw, 0.05, 0.12, { grain: true });
  }
  for (const sx of [-1, 1]) {
    bOak.box(new V3(cx + sx * (bw - 0.3), deckY - 0.2, (z0 + z1) / 2), Z, UP, X, dbLen / 2, 0.1, 0.12, { grain: true });
    bMetal.box(new V3(cx + sx * (bw - 0.02), deckY - 0.05, (z0 + z1) / 2), Z, UP, X, dbLen / 2, 0.06, 0.012);
  }
  metal.box(new V3(cx, deckY - 0.15, z0 + 0.05), X, UP, Z, bw + 0.2, 0.08, 0.08); // ось-шарнир
  const hingeP = new V3(cx, deckY - 0.15, z0 + 0.05);
  // каменный устой в воде, на который опирается мост
  const floorD = 75.2;
  stone.box(new V3(cx, (floorD + deckY - 0.15) / 2, z1 + 0.7), X, UP, Z, bw + 0.4, (deckY - 0.15 - floorD) / 2, 0.7);
  // неподвижный деревянный мост на козлах до барбакана
  const zEnd = BARBICAN.zN + 0.2;
  const yEnd = terrain.heightAt(cx, zEnd + 0.5);
  const fz0 = z1 + 1.4;
  const nPl = Math.ceil((zEnd - fz0) / 0.26);
  for (let k = 0; k < nPl; k++) {
    const z = fz0 + (k + 0.5) * ((zEnd - fz0) / nPl);
    const y = deckY + (yEnd - deckY) * ((z - fz0) / (zEnd - fz0));
    oak.box(new V3(cx, y - 0.05, z), X, UP, Z, bw, 0.05, 0.12, { grain: true });
  }
  const trestle = (z) => {
    const y = deckY + (yEnd - deckY) * ((z - fz0) / (zEnd - fz0));
    for (const sx of [-1, 1]) {
      oak.box(new V3(cx + sx * (bw - 0.25), (floorD + y - 0.1) / 2, z), UP, X, Z, (y - 0.1 - floorD) / 2, 0.13, 0.13, { grain: true });
    }
    oak.box(new V3(cx, y - 0.22, z), X, UP, Z, bw + 0.15, 0.12, 0.14, { grain: true });
    const d = new V3(2 * (bw - 0.25), -(y - floorD) * 0.6, 0).normalize();
    oak.box(new V3(cx, y - (y - floorD) * 0.35, z), d, new V3().crossVectors(Z, d), Z, (bw - 0.25) / Math.abs(d.x) - 0.1, 0.07, 0.07, { grain: true });
  };
  trestle(fz0 + (zEnd - fz0) * 0.45);
  for (const sx of [-1, 1]) {
    oak.box(new V3(cx + sx * (bw - 0.3), (deckY + yEnd) / 2 - 0.2, (fz0 + zEnd) / 2), Z, UP, X, (zEnd - fz0) / 2 + 0.3, 0.1, 0.12, { grain: true });
    // перила на неподвижном мосту
    for (let k = 0; k <= 3; k++) {
      const z = fz0 + (k / 3) * (zEnd - fz0);
      const y = deckY + (yEnd - deckY) * (k / 3);
      oak.box(new V3(cx + sx * (bw - 0.05), y + 0.5, z), UP, X, Z, 0.55, 0.06, 0.06, { grain: true });
    }
    oak.box(new V3(cx + sx * (bw - 0.05), (deckY + yEnd) / 2 + 1.0, (fz0 + zEnd) / 2), Z, UP, X, (zEnd - fz0) / 2, 0.05, 0.05, { grain: true });
  }
  // цепи подъёмного моста: от внешнего края моста к отверстиям над нишей
  const chainEnds = [];
  const links = [];
  for (const sx of [-1, 1]) {
    const a = new V3(cx + sx * (bw - 0.05), deckY + 0.05, z1 - 0.15);
    const b = new V3(cx + sx * 2.05, floorY + recessH + 0.6, P.frontZ + 0.05);
    chainEnds.push({ a, b });
    links.push(...chainLinks(a, b));
    bMetal.box(a.clone().add(new V3(0, 0.05, 0)), X, UP, Z, 0.08, 0.06, 0.1);
  }
  const chains = chainMesh(links, ctx.ironMat);
  scene.add(chains);

  // ======================= ВОДА ВО РВУ =======================
  const moat = createMoatWater(scene, terrain);

  // ======================= БАРБАКАН =======================
  buildBarbican(ctx, oak, terrain, rnd);

  const vanes = finishTowerContext(ctx, 'gate');
  const oakMesh = new THREE.Mesh(oak.build(), oakMat);
  oakMesh.castShadow = true;
  oakMesh.receiveShadow = true;
  oakMesh.name = 'gate-oak';
  scene.add(oakMesh);

  // ---------- подвижные части: группа с центром в оси вращения ----------
  const movable = (builders, pivot) => {
    const grp = new THREE.Group();
    grp.position.copy(pivot);
    for (const [b, mat] of builders) {
      if (!b.pos.length) continue;
      const g = b.build();
      g.translate(-pivot.x, -pivot.y, -pivot.z);
      const m = new THREE.Mesh(g, mat);
      m.castShadow = m.receiveShadow = true;
      m.name = 'gate-oak';
      grp.add(m);
    }
    scene.add(grp);
    return grp;
  };
  const portc = movable([[pOak, oakMat], [pMetal, ctx.ironMat]], new V3(cx, floorY, pz));
  const doorGrps = doors.map((d) => ({ grp: movable([[d.oak, oakMat], [d.metal, ctx.ironMat]], d.pivot), dAng: d.dAng }));
  const bridgeGrp = movable([[bOak, oakMat], [bMetal, ctx.ironMat]], hingeP);
  const PC_DROP = pcBottom - floorY - 0.02; // насколько опускается решётка
  const BRIDGE_UP = -1.42; // угол поднятого моста (почти вертикально, в нишу)
  const lm = new THREE.Matrix4(), ta = new V3();
  function placeChains(ang) {
    const rot = new THREE.Matrix4().makeRotationX(ang);
    let n = 0;
    for (const { a, b } of chainEnds) {
      ta.copy(a).sub(hingeP).applyMatrix4(rot).add(hingeP);
      for (const m of chainLinks(ta, b)) chains.setMatrixAt(n++, m);
    }
    chains.count = n;
    chains.instanceMatrix.needsUpdate = true;
  }
  // Состояние: 0 — ворота открыты (как было), 1 — закрыты.
  // Порядок закрытия: створки → решётка → мост; открытие — наоборот.
  const state = { target: 0, t: 0 };
  const seg = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
  const ease = (x) => x * x * (3 - 2 * x);
  function apply(t) {
    const d = ease(seg(t, 0.0, 0.25)), p = ease(seg(t, 0.2, 0.5)), b = ease(seg(t, 0.45, 1.0));
    doorGrps.forEach((g) => { g.grp.rotation.y = g.dAng * d; });
    portc.position.y = floorY - PC_DROP * p;
    bridgeGrp.rotation.x = BRIDGE_UP * b;
    placeChains(BRIDGE_UP * b);
  }
  return {
    // true, пока что-то движется (нужно обновлять тени)
    get animating() { return state.t !== state.target; },
    get closed() { return state.target === 1; },
    toggle() { state.target = state.target ? 0 : 1; },
    update(t, dt = 0.016) {
      vanes(t);
      moat.update(t);
      if (state.t !== state.target) {
        const speed = 1 / 9; // полный цикл ~9 с
        state.t = state.target > state.t ? Math.min(state.target, state.t + dt * speed) : Math.max(state.target, state.t - dt * speed);
        apply(state.t);
      }
    },
  };
}

// Вода во рву: небольшой Water с отражениями (или простой материал на низком качестве)
function createMoatWater(scene, terrain) {
  const a0 = GATE_RADIUS + DITCH.alongStart - 2, a1 = GATE_RADIUS + DITCH.alongEnd + 2;
  const hw = MOAT.damStart + 4;
  // сетка 0.5 м; клетка входит, если хотя бы один угол ниже воды — берег закроет край
  const step = 0.5, pos = [], idx = [];
  const nx = Math.ceil((2 * hw) / step), nz = Math.ceil((a1 - a0) / step);
  const id = new Int32Array((nx + 1) * (nz + 1)).fill(-1);
  const below = (i, j) => terrain.heightAt(-hw + i * step, a0 + j * step) < MOAT.level + 0.05;
  const vert = (i, j) => {
    const k = j * (nx + 1) + i;
    if (id[k] < 0) { id[k] = pos.length / 3; pos.push(-hw + i * step, -(a0 + j * step), 0); }
    return id[k];
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (!(below(i, j) || below(i + 1, j) || below(i, j + 1) || below(i + 1, j + 1))) continue;
    const v00 = vert(i, j), v10 = vert(i + 1, j), v01 = vert(i, j + 1), v11 = vert(i + 1, j + 1);
    idx.push(v00, v10, v01, v10, v11, v01);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  if (geo.getAttribute('normal').getZ(0) < 0) {
    const ia = geo.index.array;
    for (let k = 0; k < ia.length; k += 3) { const t = ia[k + 1]; ia[k + 1] = ia[k + 2]; ia[k + 2] = t; }
    geo.computeVertexNormals();
  }
  let mesh;
  if (Q.waterReflection) {
    mesh = new Water(geo, {
      textureWidth: 256, textureHeight: 256,
      waterNormals: waterNormalTexture(),
      sunDirection: SUN_DIR.clone(),
      sunColor: SUN_COLOR,
      waterColor: 0x1f4a3a,
      distortionScale: 2.6,
      alpha: 0.92,
      fog: true,
    });
    mesh.material.transparent = true;
    mesh.material.uniforms.size.value = 1.1;
    guardReflection(mesh);
    if (Q.reflectionEvery > 1) {
      const orig = mesh.onBeforeRender;
      let n = 0; // со сдвигом относительно реки: отражения обновляются в разных кадрах
      mesh.onBeforeRender = function (...args) {
        if (n === 0 || n % Q.reflectionEvery === 1) orig.apply(this, args);
        n++;
      };
    }
  } else {
    const nm = waterNormalTexture().clone();
    nm.repeat.set(3, 1);
    mesh = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: 0x1b2f22, roughness: 0.06, normalMap: nm, normalScale: new THREE.Vector2(0.3, 0.3) }));
  }
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, MOAT.level, 0);
  mesh.receiveShadow = true;
  mesh.name = 'moat';
  scene.add(mesh);
  return {
    update(t) {
      if (mesh.material.uniforms) mesh.material.uniforms.time.value = t * 0.35;
    },
  };
}

// ---------------------------------------------------------------------------
// Барбакан: стены с зубцами и каменным боевым ходом, ворота со стрельчатой
// аркой, две круглые башенки на южных углах, деревянная лестница на стену.
// ---------------------------------------------------------------------------
function buildBarbican(ctx, oak, terrain, rnd) {
  const { stone, dark, metal } = ctx;
  const B = BARBICAN;
  const courtY = terrain.heightAt(0, (B.zN + B.zS) / 2);
  const walkY = courtY + B.walkH;
  const T = B.thick, pT = 0.55, sill = 1.0, mTop = 2.0;
  const pts = [new V3(B.x0, 0, B.zN), new V3(B.x0, 0, B.zS), new V3(B.x1, 0, B.zS), new V3(B.x1, 0, B.zN)];
  const center = new V3(0, 0, (B.zN + B.zS) / 2);
  const segs = [];
  for (let i = 0; i < 3; i++) {
    const a = pts[i], b = pts[i + 1];
    const D = b.clone().sub(a);
    const L = D.length();
    D.normalize();
    let N = new V3(D.z, 0, -D.x);
    if (N.dot(a.clone().add(b).multiplyScalar(0.5).sub(center)) < 0) N.negate();
    // южная стена разделена проёмом ворот
    if (i === 1) {
      segs.push({ a, D, N, from: 0, to: L / 2 - B.gateHalf });
      segs.push({ a, D, N, from: L / 2 + B.gateHalf, to: L });
    } else segs.push({ a, D, N, from: i === 0 ? 0 : -T / 2, to: i === 0 ? L + T / 2 : L });
  }
  // северная стена вдоль рва с проходом к мосту — двор барбакана замкнут
  {
    const a = pts[3], b = pts[0];
    const D = b.clone().sub(a);
    const L = D.length();
    D.normalize();
    const N = new V3(0, 0, -1);
    const gap = 2.3;
    segs.push({ a, D, N, from: -T / 2, to: L / 2 - gap });
    segs.push({ a, D, N, from: L / 2 + gap, to: L + T / 2 });
  }
  const yb = (p, N, s) => Math.min(terrain.heightAt(p.x + N.x * s, p.z + N.z * s), terrain.heightAt(p.x, p.z)) - 0.8;
  for (const sg of segs) {
    const { a, D, N } = sg;
    const L = sg.to - sg.from;
    const cols = Math.max(1, Math.ceil(L / 1.0));
    for (let c = 0; c < cols; c++) {
      const s0 = sg.from + (c / cols) * L, s1 = sg.from + ((c + 1) / cols) * L;
      const c0 = a.clone().addScaledVector(D, s0), c1 = a.clone().addScaledVector(D, s1);
      const o0 = c0.clone().addScaledVector(N, T / 2), o1 = c1.clone().addScaledVector(N, T / 2);
      const i0 = c0.clone().addScaledVector(N, -T / 2), i1 = c1.clone().addScaledVector(N, -T / 2);
      const q0 = c0.clone().addScaledVector(N, T / 2 - pT), q1 = c1.clone().addScaledVector(N, T / 2 - pT);
      const bo0 = yb(o0, N, 1.2), bo1 = yb(o1, N, 1.2), bi0 = yb(i0, N, -1), bi1 = yb(i1, N, -1);
      const s = (p, y) => p.clone().setY(y);
      stone.quad(s(o0, bo0), s(o1, bo1), s(o1, walkY + sill), s(o0, walkY + sill), N, [[s0, bo0], [s1, bo1], [s1, walkY + sill], [s0, walkY + sill]], [bo0 - bo0, 0, 9, 9]);
      stone.quad(s(i0, bi0), s(i1, bi1), s(i1, walkY), s(i0, walkY), N.clone().negate(), [[s0, bi0], [s1, bi1], [s1, walkY], [s0, walkY]], [0, 0, 9, 9]);
      stone.quad(s(i0, walkY), s(i1, walkY), s(q1, walkY), s(q0, walkY), UP, [[s0, 0], [s1, 0], [s1, T - pT], [s0, T - pT]]);
      stone.quad(s(q0, walkY), s(q1, walkY), s(q1, walkY + sill), s(q0, walkY + sill), N.clone().negate(), [[s0, walkY], [s1, walkY], [s1, walkY + sill], [s0, walkY + sill]]);
      stone.quad(s(q0, walkY + sill), s(q1, walkY + sill), s(o1, walkY + sill), s(o0, walkY + sill), UP, [[s0, 0], [s1, 0], [s1, pT], [s0, pT]]);
    }
    // зубцы
    const step = 1.5 + 0.8;
    const count = Math.floor((L - 0.6) / step);
    const st = sg.from + (L - (count * step - 0.8)) / 2;
    for (let m = 0; m < count; m++) {
      const cc = a.clone().addScaledVector(D, st + m * step + 0.75).addScaledVector(N, T / 2 - pT / 2);
      if (cc.distanceTo(pts[1]) < 3.2 || cc.distanceTo(pts[2]) < 3.2) continue; // место башенок
      const y0 = walkY + sill, y1 = walkY + mTop;
      stone.box(new V3(cc.x, (y0 + y1) / 2, cc.z), D, UP, N, 0.75, (y1 - y0) / 2, pT / 2 + 0.01, { skipBottom: true });
      stone.box(new V3(cc.x, y1 + 0.07, cc.z), D, UP, N, 0.8, 0.08, pT / 2 + 0.05);
      if (m % 2) {
        const sp = new V3(cc.x, 0, cc.z).addScaledVector(N, pT / 2);
        dark.box(new V3(sp.x, (y0 + y1) / 2, sp.z), D, UP, N, 0.05, 0.35, 0.02);
      }
    }
    // торцы стен у рва и у ворот
    for (const [sEnd, dir] of [[sg.from, -1], [sg.to, 1]]) {
      const cE = a.clone().addScaledVector(D, sEnd);
      const nE = D.clone().multiplyScalar(dir);
      const b0 = Math.min(yb(cE, N, 1), courtY - 0.5);
      stone.box(new V3(cE.x, (b0 + walkY + sill) / 2, cE.z), N, UP, nE, T / 2, (walkY + sill - b0) / 2, 0.01);
    }
  }
  // арка ворот барбакана над проёмом южной стены
  const gA = pts[1].clone().add(pts[2]).multiplyScalar(0.5);
  const gw = B.gateHalf * 2, gSpring = 2.9;
  for (const sgn of [1, -1]) {
    const face = gA.clone().addScaledVector(Z, sgn * T / 2);
    faceWithHole(stone, face, X.clone().multiplyScalar(sgn), Z.clone().multiplyScalar(sgn), -B.gateHalf, B.gateHalf, courtY - 1, walkY + sill, [
      new THREE.Vector2(-gw / 2, courtY - 0.6), new THREE.Vector2(gw / 2, courtY - 0.6),
      ...archPoints(gw, courtY + gSpring).reverse(),
    ]);
  }
  vault(stone, gA.x, gA.z - T / 2, gA.z + T / 2, gw, gSpring, courtY);
  for (const sx of [-1, 1]) {
    const x = gA.x + sx * gw / 2;
    stone.quad(new V3(x, courtY - 0.5, gA.z - T / 2), new V3(x, courtY - 0.5, gA.z + T / 2), new V3(x, courtY + gSpring, gA.z + T / 2), new V3(x, courtY + gSpring, gA.z - T / 2),
      X.clone().multiplyScalar(-sx), [[0, courtY], [T, courtY], [T, courtY + gSpring], [0, courtY + gSpring]]);
  }
  // верх над воротами: боевой ход и зубцы
  stone.quad(new V3(gA.x - B.gateHalf, walkY, gA.z - T / 2), new V3(gA.x + B.gateHalf, walkY, gA.z - T / 2), new V3(gA.x + B.gateHalf, walkY, gA.z + T / 2 - pT), new V3(gA.x - B.gateHalf, walkY, gA.z + T / 2 - pT), UP, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  stone.box(new V3(gA.x, walkY + (sill + mTop) / 2, gA.z + T / 2 - pT / 2), X, UP, Z, 0.75, (mTop - sill) / 2 + sill / 2, pT / 2 + 0.01, { skipBottom: true });
  // створки ворот барбакана, распахнуты внутрь
  for (const sx of [-1, 1]) {
    const hinge = new V3(gA.x + sx * (gw / 2 - 0.06), 0, gA.z - T / 2 + 0.1);
    const along = new V3(0, 0, -1).applyAxisAngle(UP, sx * 0.2).normalize();
    const nrm = new V3().crossVectors(UP, along).multiplyScalar(-sx).normalize();
    const lw = gw / 2 - 0.06, lh = gSpring + 0.6;
    for (let k = 0; k < 4; k++) {
      const c = hinge.clone().addScaledVector(along, (k + 0.5) * lw / 4).addScaledVector(nrm, 0.07);
      oak.box(new V3(c.x, courtY + lh / 2, c.z), UP, along, nrm, lh / 2, lw / 8 - 0.005, 0.045, { grain: true });
    }
    for (const y of [0.4, 1.6, lh - 0.4]) {
      const c = hinge.clone().addScaledVector(along, lw / 2).addScaledVector(nrm, 0.125);
      metal.box(new V3(c.x, courtY + y, c.z), along, UP, nrm, lw / 2 - 0.02, 0.04, 0.012);
    }
  }
  // деревянная лестница на боевой ход вдоль западной стены
  const steps = Math.ceil(B.walkH / 0.26);
  for (let k = 0; k < steps; k++) {
    const y = courtY + (k + 1) * 0.26;
    const z = B.zS - T / 2 - 1.2 - (steps - k) * 0.3;
    oak.box(new V3(B.x0 + T / 2 + 0.55, y - 0.04, z), X, UP, Z, 0.55, 0.04, 0.15, { grain: true });
  }
  for (const dx of [0.08, 1.02]) {
    const zA = B.zS - T / 2 - 1.2 - steps * 0.3, zB = B.zS - T / 2 - 1.2;
    const d = new V3(0, B.walkH, zB - zA).normalize();
    oak.box(new V3(B.x0 + T / 2 + dx, courtY + B.walkH / 2, (zA + zB) / 2), d, X, new V3().crossVectors(d, X), Math.hypot(B.walkH, zB - zA) / 2, 0.05, 0.1, { grain: true });
  }
  // башенки на южных углах
  for (const [i, sx] of [[1, -1], [2, 1]]) {
    const p = pts[i];
    const outDir = new V3(sx, 0, 1).normalize();
    const tw = { id: 200 + i, shape: 'round', r: 2.5, x: p.x + outDir.x * 1.1, z: p.z + outDir.z * 1.1, yaw: 0, extra: 3.6, node: { x: p.x, z: p.z } };
    const wallDirs = [new V3(0, 0, -1), new V3(-sx, 0, 0)];
    buildTower(ctx, tw, { walkY, wallDirs, outDir, window: false, groundDoor: true });
  }
  void rnd;
}
