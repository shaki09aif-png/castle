// Ещё больше жизни: ночной дозор с факелами и костёр у ворот, учения стражи и
// лучники, сокольничий на стене, дети с обручем и деревянными мечами, сад,
// кладбище у часовни, прачки у реки, виноградник, каменоломня, потайной ход,
// темница под донжоном и шахта колодца. Подземелья видны только на своих
// точках экскурсии; свет в них «запечён» в цвета вершин — ламп нет, FPS не падает.
import * as THREE from 'three';
import { M, GEO, makeWalker, walkerMaterial, WALKERS, fire, cow, findFlat } from './extras.js';
import { ColorBuilder, person } from './people.js';
import { chicken } from './details.js';
import { horse } from './yard.js';
import { Smoke, cart, Frame } from './courtyard.js';
import { KEEP, WELL, BUILDINGS, riverZ, riverHalfWidth, insideTower } from './layout.js';
import { AUTUMN } from './materials.js';
import { mulberry32 } from './noise.js';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);

// ---------------------------------------------------------------------------
// «Запечённый» свет для подземелий: геометрия без освещения сцены, яркость
// вершин считается один раз от факелов
// ---------------------------------------------------------------------------
class Baked {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.curLimb = [0, 0]; }
  add(geo, m, color = 0xffffff, _sway, _seed, flip = false, uvScale = null) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), guv = g.getAttribute('uv');
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new V3(), w = new V3();
    const c = new THREE.Color(color);
    const cnt = p.count;
    const idx = [];
    for (let i = 0; i < cnt; i++) idx.push(i);
    if (flip) for (let i = 0; i < cnt; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    for (const i of idx) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      w.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      if (flip) w.negate();
      this.p.push(v.x, v.y, v.z);
      this.n.push(w.x, w.y, w.z);
      // развёртка по мировым координатам (кладка ложится одинаково на все грани)
      const ax = Math.abs(w.x), ay = Math.abs(w.y), az = Math.abs(w.z);
      if (uvScale) this.uv.push(guv.getX(i) * uvScale[0], guv.getY(i) * uvScale[1]);
      else if (ay >= ax && ay >= az) this.uv.push(v.x / 2.2, v.z / 2.2);
      else if (ax >= az) this.uv.push(v.z / 2.2, v.y / 2.2);
      else this.uv.push(v.x / 2.2, v.y / 2.2);
      this.c.push(c.r, c.g, c.b);
    }
  }
  // lights: [{p: V3, i: сила, r: радиус, c: [r,g,b]}], amb — рассеянный свет, extra(p, n) — свой вклад
  build(lights, amb = 0.12, extra = null) {
    const g = new THREE.BufferGeometry();
    const P = this.p, N = this.n, C = this.c;
    const v = new V3(), nrm = new V3(), d = new V3();
    for (let i = 0; i < P.length; i += 3) {
      v.set(P[i], P[i + 1], P[i + 2]);
      nrm.set(N[i], N[i + 1], N[i + 2]);
      let r = amb, gg = amb, b = amb;
      for (const L of lights) {
        d.copy(L.p).sub(v);
        const dist = d.length();
        const k = L.i * Math.max(0.12, nrm.dot(d.divideScalar(dist || 1))) / (1 + (dist / L.r) ** 2);
        r += k * L.c[0]; gg += k * L.c[1]; b += k * L.c[2];
      }
      if (extra) { const e = extra(v, nrm); r += e; gg += e; b += e; }
      C[i] *= Math.min(1.4, r); C[i + 1] *= Math.min(1.4, gg); C[i + 2] *= Math.min(1.4, b);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    g.computeBoundingSphere();
    return g;
  }
}

let STONE_TEX = null;
function stoneTexture() {
  if (STONE_TEX) return STONE_TEX;
  const S = 256, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#2e2924';
  g.fillRect(0, 0, S, S);
  const r = mulberry32(41);
  for (let row = 0; row < 8; row++) {
    let x = -r() * 40;
    const y = row * 32;
    while (x < S) {
      const w = 36 + r() * 52, v = 120 + r() * 60;
      g.fillStyle = `rgb(${v | 0},${(v * 0.93) | 0},${(v * 0.83) | 0})`;
      for (const ox of [0, S]) g.fillRect(x + 2 - ox, y + 2, w - 4, 28);
      x += w;
    }
  }
  for (let i = 0; i < 4000; i++) {
    const v = r() * 60 - 30;
    g.fillStyle = v > 0 ? `rgba(255,245,230,${v / 300})` : `rgba(0,0,0,${-v / 200})`;
    g.fillRect(r() * S, r() * S, 2, 2);
  }
  STONE_TEX = new THREE.CanvasTexture(cv);
  STONE_TEX.wrapS = STONE_TEX.wrapT = THREE.RepeatWrapping;
  STONE_TEX.colorSpace = THREE.SRGBColorSpace;
  STONE_TEX.anisotropy = 4;
  return STONE_TEX;
}

function bakedMeshes(scene, stoneB, propB, lights, amb, extra, name) {
  const grp = new THREE.Group();
  grp.name = name;
  if (stoneB.p.length) grp.add(new THREE.Mesh(stoneB.build(lights, amb, extra), new THREE.MeshBasicMaterial({ map: stoneTexture(), vertexColors: true, fog: false, side: THREE.DoubleSide })));
  if (propB.p.length) grp.add(new THREE.Mesh(propB.build(lights, amb, extra), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide })));
  grp.visible = false;
  scene.add(grp);
  return grp;
}

// пламя факела (светится само); flames — отдельная сетка, чтобы мерцать
function torchFlame(glow, p, s = 1) {
  glow.add(GEO.flame, M(p.x, p.y + 0.14 * s, p.z, 0, 0.07 * s, 0.3 * s, 0.07 * s), 0xffa43a);
  glow.add(GEO.flame, M(p.x, p.y + 0.1 * s, p.z, 1, 0.045 * s, 0.2 * s, 0.045 * s), 0xffe38a);
}

// «рама» в плоскости: начало o, ось вперёд D (горизонтальная), вбок S
function frameAt(o, D) {
  const d = D.clone().setY(0).normalize();
  const s = new V3(d.z, 0, -d.x);
  const basis = new THREE.Matrix4().makeBasis(s, UP, d);
  return {
    o, d, s,
    p: (u, h, v) => o.clone().addScaledVector(d, u).addScaledVector(s, v).add(new V3(0, h, 0)),
    m: (u, h, v, sx = 1, sy = 1, sz = 1, yaw = 0) => {
      const q = new THREE.Quaternion().setFromRotationMatrix(basis).multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
      return new THREE.Matrix4().compose(o.clone().addScaledVector(d, u).addScaledVector(s, v).add(new V3(0, h, 0)), q, new V3(sx, sy, sz));
    },
    yaw: Math.atan2(d.x, d.z),
  };
}

// ---------------------------------------------------------------------------
// Анимированная фигура без ходьбы по пути: своё движение, ноги и руки — в шейдере
// ---------------------------------------------------------------------------
function rig(scene, build, amp = 0.45) {
  const B = new ColorBuilder();
  build(B);
  const { mat, uPhase, uAmp } = walkerMaterial();
  uAmp.value = amp;
  const mesh = new THREE.Mesh(B.build(), mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'walker';
  scene.add(mesh);
  WALKERS.push(mesh);
  return { mesh, uPhase, uAmp };
}

export function createLife3(scene, ctx, village, walls) {
  const { terrain, wood, stone, metal, straw, colorB, glowB, people, rnd } = ctx;
  const gh = terrain.heightAt;
  const upd = [];
  const out = { update() {}, setNight() {}, places: {}, ctl: {}, areas: [] };
  const b = (id) => BUILDINGS.find((q) => q.id === id);
  const movers = [];

  // =========================== НОЧНОЙ ДОЗОР ===========================
  const night = [];
  {
    const Pw = walls.points, Nw = walls.segNrm, Wk = walls.walk;
    const near = (x, z) => { let bi = 0, bd = 1e9; Pw.forEach((p, i) => { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; bi = i; } }); return bi; };
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb04a, fog: true });
    const flameGeo = new THREE.ConeGeometry(0.08, 0.34, 7).translate(0, 0.17, 0);
    for (const [ax, az, bx, bz, seed] of [[-40, 10, -20, -36, 601], [30, -30, 44, 10, 602]]) {
      let i0 = near(ax, az), i1 = near(bx, bz);
      if (i0 > i1) [i0, i1] = [i1, i0];
      const path = [];
      for (let i = i0; i <= i1; i++) {
        const p = Pw[i].clone().addScaledVector(Nw[Math.min(i, Nw.length - 1)], -0.55);
        path.push(new V3(p.x, Wk[i] + 0.1, p.z));
      }
      if (path.length < 2) continue;
      let hand = null;
      const w = makeWalker(scene, (B) => { hand = person(B, { x: 0, y: 0, z: 0, yaw: 0, role: 'guard', seed, item: 'torch' }).hands[0]; }, path, { loop: false, speed: 0.7, y: true });
      const fl = new THREE.Mesh(flameGeo, flameMat);
      fl.position.copy(hand).add(new V3(0, 0.5, 0));
      w.mesh.add(fl);
      movers.push(w);
      night.push(w.mesh);
      w.mesh.userData.night = false;
      upd.push((t) => { fl.scale.set(1 + Math.sin(t * 17 + seed) * 0.12, 1 + Math.sin(t * 11 + seed) * 0.2, 1); });
    }
    // костёр у ворот, вокруг греются стражники
    const c = new V3(-5.5, 0, 25.5), cy = gh(c.x, c.z);
    fire(glowB, c.x, cy, c.z, 1.1, rnd);
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; stone.addGeometry(new THREE.DodecahedronGeometry(0.16, 0), M(c.x + Math.cos(a) * 0.55, cy + 0.06, c.z + Math.sin(a) * 0.55, a)); }
    for (let k = 0; k < 3; k++) {
      const a = 0.9 + k * 1.9, lx = c.x + Math.cos(a) * 1.7, lz = c.z + Math.sin(a) * 1.7;
      const yaw = Math.atan2(c.x - lx, c.z - lz);
      wood.addGeometry(new THREE.CylinderGeometry(0.2, 0.2, 1.3, 8), M(lx, gh(lx, lz) + 0.2, lz, yaw + Math.PI / 2, 1, 1, 1, 0, Math.PI / 2));
      people.push({ x: lx, y: gh(lx, lz) + 0.42, z: lz, yaw, role: 'guard', pose: 'sit', item: null });
    }
    ctx.smokes.push(new Smoke(scene, new V3(c.x, cy + 1.2, c.z), { count: 10, size: 0.5, grow: 2.2, alpha: 0.3, life: 6 }));
  }

  // =========================== УЧЕНИЯ СТРАЖИ ===========================
  {
    // двое бьются на мечах
    const c = new V3(34.5, 0, -3.5);
    const fighters = [];
    for (const [sd, seed] of [[1, 611], [-1, 612]]) {
      const r = rig(scene, (B) => person(B, { x: 0, y: 0, z: 0, yaw: 0, role: 'guard', seed, item: 'sword' }), 0.5);
      const yaw = sd > 0 ? Math.PI : 0;
      r.mesh.rotation.y = yaw;
      fighters.push({ r, sd, yaw, seed });
    }
    upd.push((t) => {
      fighters.forEach(({ r, sd, seed }, k) => {
        const lunge = Math.sin(t * 2.2 + k * Math.PI) * 0.35;
        const z = c.z + sd * (1.05 + lunge);
        r.mesh.position.set(c.x + Math.sin(t * 0.7 + k) * 0.25, gh(c.x, z), z);
        r.mesh.rotation.y = (sd > 0 ? Math.PI : 0) + Math.sin(t * 1.3 + seed) * 0.15;
        r.uPhase.value = Math.sin(t * 4.4 + k * 1.3) * 1.4;
      });
    });
    // стрельбище: мишени у стены, двое лучников
    const tgt = [];
    for (const x of [29.5, 31.8]) {
      const tp = new V3(x, 0, -14.5), ty = gh(tp.x, tp.z);
      straw.addGeometry(new THREE.CylinderGeometry(0.62, 0.62, 0.32, 16), M(tp.x, ty + 1.1, tp.z, 0, 1, 1, 1, Math.PI / 2));
      for (const [rr, col] of [[0.5, 0xe8e0c8], [0.34, 0x7a1c1c], [0.16, 0xd6a632]]) colorB.add(new THREE.CircleGeometry(rr, 18), M(tp.x, ty + 1.1, tp.z + 0.165 + (0.5 - rr) * 0.01), col);
      for (const sd of [-1, 1]) wood.box(new V3(tp.x + sd * 0.45, ty + 0.55, tp.z - 0.2), UP, new V3(1, 0, 0), new V3(0, 0, 1), 0.6, 0.04, 0.04, { grain: true });
      tgt.push(new V3(tp.x, ty + 1.1, tp.z + 0.2));
    }
    const arrowGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.8, 4).rotateX(Math.PI / 2);
    const arrowMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1e });
    [[29.5, 1.0, 621], [31.8, 1.4, 622]].forEach(([x, dz, seed], k) => {
      const z = dz, y = gh(x, z);
      people.push({ x, y, z, yaw: Math.PI, role: 'archer', seed });
      const from = new V3(x + 0.1, y + 1.42, z - 0.6), to = tgt[k].clone().add(new V3((k - 0.5) * 0.2, 0.05, 0));
      const ar = new THREE.Mesh(arrowGeo, arrowMat);
      ar.castShadow = true;
      scene.add(ar);
      WALKERS.push(ar);
      const per = 3.2 + k * 0.7;
      upd.push((t) => {
        const u = ((t + k * 1.3) % per) / 0.55; // полёт 0,55 с, потом торчит в мишени
        const q = Math.min(1, u);
        ar.position.copy(from).lerp(to, q);
        ar.position.y += Math.sin(q * Math.PI) * 0.5;
        ar.lookAt(to.x, to.y + (1 - q) * 0.6, to.z);
        ar.visible = u > 0.05 && u < (per - 0.5) / 0.55;
      });
    });
    // стойка с оружием и сундук
    wood.box(new V3(37.5, gh(37.5, -9) + 0.9, -9), UP, new V3(1, 0, 0), new V3(0, 0, 1), 0.9, 0.05, 0.6, { grain: true });
    out.places.training = { tgt: new V3(33, gh(33, -5) + 1.2, -5), pos: new V3(20, gh(20, 4) + 7.5, 7) };
  }

  // =========================== СОКОЛЬНИЧИЙ ===========================
  {
    const Pw = walls.points, Nw = walls.segNrm, Wk = walls.walk;
    let i = 0, bd = 1e9;
    for (let k = 0; k < Pw.length - 1 && k < Nw.length; k++) {
      const m = Pw[k].clone().lerp(Pw[k + 1], 0.5);
      if (insideTower(m.x, m.z, 2)) continue;
      const d = Math.hypot(m.x - 22, m.z + 36);
      if (d < bd) { bd = d; i = k; }
    }
    const p = Pw[i].clone().lerp(Pw[i + 1], 0.5).addScaledVector(Nw[i], -0.6);
    const fy = (Wk[i] + Wk[i + 1]) / 2 + 0.1;
    const outward = Nw[i].clone().setY(0).normalize();
    const yaw = Math.atan2(outward.x, outward.z);
    const B = new ColorBuilder();
    const res = person(B, { x: 0, y: 0, z: 0, yaw: 0, role: 'noble', seed: 631, item: 'falcon' });
    const man = new THREE.Mesh(B.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    man.position.set(p.x, fy, p.z);
    man.rotation.y = yaw;
    man.castShadow = true;
    man.name = 'walker';
    scene.add(man);
    WALKERS.push(man);
    man.updateMatrixWorld();
    const fist = res.hands[1].clone().applyMatrix4(man.matrixWorld).add(new V3(0, 0.1, 0));
    // сокол: тело и два крыла (крылья машут)
    const FB = new ColorBuilder();
    FB.add(new THREE.SphereGeometry(0.1, 8, 6).scale(0.9, 0.9, 1.9), new THREE.Matrix4(), 0x6a4a2a);
    FB.add(new THREE.SphereGeometry(0.06, 8, 6), new THREE.Matrix4().makeTranslation(0, 0.05, 0.19), 0x5a3a1e);
    FB.add(new THREE.ConeGeometry(0.02, 0.06, 5).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(0, 0.04, 0.26), 0xd6a632);
    FB.add(new THREE.BoxGeometry(0.12, 0.02, 0.18), new THREE.Matrix4().makeTranslation(0, 0, -0.26), 0x4a3220);
    const fmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    const bird = new THREE.Mesh(FB.build(), fmat);
    const wingG = new THREE.BoxGeometry(0.42, 0.015, 0.16).translate(0.21, 0, 0);
    const wings = [1, -1].map((sd) => { const w = new THREE.Mesh(wingG, new THREE.MeshStandardMaterial({ color: 0x5a3e22 })); w.scale.x = sd; w.position.set(sd * 0.05, 0.03, 0.02); bird.add(w); return w; });
    bird.castShadow = true;
    scene.add(bird);
    WALKERS.push(bird);
    const center = fist.clone().addScaledVector(outward, 13);
    const circ = (a, h) => new V3(center.x + Math.cos(a) * 11, fist.y + h, center.z + Math.sin(a) * 11);
    upd.push((t) => {
      const T = t % 26;
      let pos, look, flap = 0, fold = 1;
      if (T < 7) { pos = fist.clone(); look = fist.clone().addScaledVector(outward, 1); fold = 1; }
      else {
        const a0 = Math.atan2(fist.z - center.z, fist.x - center.x);
        if (T < 9.5) { // взлёт по дуге
          const u = (T - 7) / 2.5;
          pos = fist.clone().lerp(circ(a0 + 0.8, 9), u * u * (3 - 2 * u));
          look = circ(a0 + 1.2, 9);
          flap = 1; fold = 0;
        } else if (T < 22.5) {
          const a = a0 + 0.8 + (T - 9.5) * 0.55;
          pos = circ(a, 9 + Math.sin(T * 0.8) * 1.5);
          look = circ(a + 0.2, 9);
          flap = Math.sin(T * 0.9) > 0.3 ? 1 : 0; fold = 0;
        } else { // возвращается на перчатку
          const u = (T - 22.5) / 3.5;
          const a = a0 + 0.8 + 13 * 0.55;
          pos = circ(a, 9).lerp(fist, u * u * (3 - 2 * u));
          look = fist.clone();
          flap = u > 0.7 ? 1 : 0.3; fold = u > 0.95 ? 1 : 0;
        }
      }
      bird.position.copy(pos);
      if (look.distanceToSquared(pos) > 1e-4) bird.lookAt(look);
      const wa = fold ? -1.3 : flap ? Math.sin(t * 16) * 0.7 : 0.05;
      wings[0].rotation.z = wa; wings[1].rotation.z = -wa;
      wings.forEach((w) => { w.scale.z = fold ? 0.5 : 1; });
    });
    const side = new V3(outward.z, 0, -outward.x);
    out.places.falconer = { man, tgt: fist.clone().addScaledVector(outward, 4).add(new V3(0, 1.2, 0)), pos: fist.clone().addScaledVector(outward, -6).addScaledVector(side, 2.5).add(new V3(0, 2.4, 0)) };
  }

  // =========================== ДЕТИ ===========================
  {
    const c = new V3(-22.5, 0, 9.5), ring = [];
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; ring.push(new V3(c.x + Math.cos(a) * 2.6, 0, c.z + Math.sin(a) * 2.2)); }
    const pp = (seed, item) => (B) => person(B, { x: 0, y: 0, z: 0, yaw: 0, role: 'child', seed, item });
    const L = 2 * Math.PI * 2.4;
    movers.push(makeWalker(scene, pp(641, 'woodsword'), ring, { speed: 2.1, stride: 0.9, amp: 0.7, s0: 0 }));
    movers.push(makeWalker(scene, pp(642, 'woodsword'), ring, { speed: 2.1, stride: 0.9, amp: 0.7, s0: L * 0.45 }));
    // куры удирают от детей
    const cr = mulberry32(643);
    movers.push(makeWalker(scene, (B) => { chicken(B, 0, 0, 0, 0, cr); chicken(B, 0.4, 0, -0.5, 0.2, cr); }, ring, { speed: 2.1, stride: 0.4, amp: 0.2, s0: L * 0.2 }));
    // мальчик катит обруч палкой
    movers.push(makeWalker(scene, (B) => {
      person(B, { x: 0, y: 0, z: 0, yaw: 0, role: 'child', seed: 644, item: null });
      B.add(new THREE.TorusGeometry(0.3, 0.018, 5, 20), M(0.12, 0.32, 0.75, Math.PI / 2 + 0.1), 0x8a6a40);
      B.add(new THREE.CylinderGeometry(0.01, 0.01, 0.6, 4), M(0.18, 0.6, 0.45, 0, 1, 1, 1, 0.9), 0x6a4a28);
    }, [new V3(-30, 0, 2.5), new V3(-24, 0, 4), new V3(-16, 0, 12.5), new V3(-10, 0, 14)], { loop: false, speed: 1.9, stride: 0.9, amp: 0.7 }));
  }

  // =========================== САД ===========================
  {
    const x0 = 1.5, x1 = 12.5, z0 = -19, z1 = -11;
    // плетень вокруг
    const edge = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0 + 3, z1], [x0, z1, x0, z0]];
    for (const [ax, az, bx, bz] of edge) {
      const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 1.1);
      const dir = new V3(bx - ax, 0, bz - az).normalize(), s = new V3(dir.z, 0, -dir.x);
      for (let k = 0; k <= n; k++) {
        const x = ax + (bx - ax) * (k / n), z = az + (bz - az) * (k / n);
        wood.box(new V3(x, gh(x, z) + 0.45, z), UP, dir, s, 0.45, 0.03, 0.03, { grain: true });
      }
      for (const hh of [0.3, 0.6]) {
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        wood.box(new V3(mx, gh(mx, mz) + hh, mz), dir, UP, s, L / 2, 0.02, 0.02, { grain: true });
      }
    }
    // грядки с травами и капустой
    const herbs = [0x4a7a2a, 0x6a8a3a, 0x3a6a3a, 0x7a8a4a, 0x5a7a4a];
    for (let k = 0; k < 4; k++) {
      const z = z1 - 1.3 - k * 1.5, x = 3.3, len = 4.2;
      colorB.add(GEO.box, M(x + len / 2, gh(x + len / 2, z) + 0.06, z, 0, len, 0.14, 0.9), 0x4a3424);
      for (let j = 0; j < 9; j++) {
        const px = x + 0.25 + j * 0.46, py = gh(px, z) + 0.16;
        colorB.add(GEO.bush, M(px, py, z + (rnd() - 0.5) * 0.3, rnd() * 6, 0.2 + rnd() * 0.06, 0.13, 0.2 + rnd() * 0.06), herbs[(k + j) % herbs.length]);
      }
    }
    // яблони и груши
    for (const [x, z] of [[10, -17], [10.5, -13], [8, -15.2]]) {
      const y = gh(x, z);
      wood.addGeometry(new THREE.CylinderGeometry(0.09, 0.13, 1.8, 7), M(x, y + 0.9, z));
      for (let k = 0; k < 6; k++) colorB.add(GEO.bush, M(x + (rnd() - 0.5) * 1.3, y + 2.1 + rnd() * 0.7, z + (rnd() - 0.5) * 1.3, rnd() * 6, 0.7 + rnd() * 0.3, 0.55, 0.7 + rnd() * 0.3), [0x3a6a24, 0x4a7a2a, 0x2e5a1e][k % 3]);
      for (let k = 0; k < 10; k++) { const a = rnd() * 6.28, r = 0.6 + rnd() * 0.5; colorB.add(GEO.sph, M(x + Math.cos(a) * r, y + 1.9 + rnd() * 1.1, z + Math.sin(a) * r, 0, 0.07, 0.07, 0.07), rnd() < 0.5 ? 0xc0301a : 0xd8b030); }
    }
    // ульи-колоды и садовник
    for (const [x, z] of [[2.6, -17.8], [3.6, -18]]) { const y = gh(x, z); straw.addGeometry(new THREE.SphereGeometry(0.34, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.4, 1), M(x, y + 0.02, z)); }
    people.push({ x: 5.5, y: gh(5.5, -14.1), z: -14.1, yaw: 0.3, role: 'peasant', pose: 'work', seed: 651 });
    people.push({ x: 9, y: gh(9, -12), z: -12, yaw: 2.6, role: 'woman', item: 'basket', seed: 652 });
  }

  // =========================== КЛАДБИЩЕ У ЧАПЕЛЬНИ ===========================
  {
    const ch = b('chapel');
    const x0 = ch.x + ch.L / 2 + 1.2, x1 = x0 + 7, z0 = ch.z - 3.2, z1 = ch.z + 3.2;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const x = x0 + 1.2 + i * 2.2, z = z0 + 1.2 + j * 2.1 + (rnd() - 0.5) * 0.3, y = gh(x, z);
      if (rnd() < 0.2) continue;
      colorB.add(GEO.box, M(x, y + 0.05, z - 0.8, 0, 0.6, 0.12, 1.6), 0x4a3a2a); // холмик
      const tilt = (rnd() - 0.5) * 0.12;
      if (rnd() < 0.6) {
        stone.box(new V3(x, y + 0.45, z + 0.05), UP, new V3(1, 0, 0), new V3(0, 0, 1), 0.45, 0.06, 0.08);
        stone.box(new V3(x, y + 0.65, z + 0.05), new V3(1, 0, 0), UP, new V3(0, 0, 1), 0.26, 0.06, 0.08);
      } else {
        wood.box(new V3(x, y + 0.4, z), UP, new V3(Math.cos(tilt), 0, 0), new V3(0, 0, 1), 0.4, 0.04, 0.04, { grain: true });
        wood.box(new V3(x, y + 0.58, z), new V3(1, 0, 0), UP, new V3(0, 0, 1), 0.22, 0.035, 0.035, { grain: true });
      }
    }
    // низкая каменная ограда с калиткой
    for (const [ax, az, bx, bz] of [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1]]) {
      const cx = (ax + bx) / 2, cz = (az + bz) / 2, L = Math.hypot(bx - ax, bz - az);
      const d = new V3(bx - ax, 0, bz - az).normalize();
      const segs = Math.ceil(L / 1.5);
      for (let k = 0; k < segs; k++) {
        if (ax === x1 && k === Math.floor(segs / 2)) continue; // проход
        const t = (k + 0.5) / segs, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        stone.box(new V3(x, gh(x, z) + 0.3, z), d, UP, new V3(-d.z, 0, d.x), L / segs / 2, 0.35, 0.18);
      }
    }
    // тис у часовни
    { const x = x1 - 0.8, z = z1 - 0.8, y = gh(x, z); wood.addGeometry(new THREE.CylinderGeometry(0.12, 0.16, 1.2, 7), M(x, y + 0.6, z)); for (let k = 0; k < 4; k++) colorB.add(GEO.cone, M(x, y + 1.3 + k * 0.6, z, 0, 1.0 - k * 0.2, 1.1, 1.0 - k * 0.2), 0x24401e); }
    out.places.garden = { tgt: new V3(8, gh(8, -21) + 1, -21), pos: new V3(-2, gh(-2, -6) + 11, -6) };
  }

  // ======================= ТЕМНИЦА ПОД ДОНЖОНОМ =======================
  {
    const kg = gh(KEEP.x, KEEP.z);
    const F = kg - 9; // пол темницы
    const c = Math.cos(KEEP.yaw), s = Math.sin(KEEP.yaw);
    const X = new V3(c, 0, s), Z = new V3(-s, 0, c);
    const O = new V3(KEEP.x, F, KEEP.z);
    const basis = new THREE.Matrix4().makeBasis(X, UP, Z);
    const L = (x, y, z) => O.clone().addScaledVector(X, x).addScaledVector(Z, z).add(new V3(0, y, 0));
    const LM = (x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) => new THREE.Matrix4().compose(L(x, y, z), new THREE.Quaternion().setFromRotationMatrix(basis).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz))), new V3(sx, sy, sz));
    const SB = new Baked(), PB = new Baked();
    const a = 5.2, H = 3.2;
    const box = new THREE.BoxGeometry(1, 1, 1);
    // стены, пол и цилиндрический свод
    SB.add(box, LM(0, -0.15, 0, 2 * a + 1, 0.3, 2 * a + 1), 0x8a8078);
    for (const sd of [-1, 1]) {
      SB.add(box, LM(sd * (a + 0.3), H / 2, 0, 0.6, H, 2 * a + 1.2), 0xa09488);
      SB.add(box, LM(0, H / 2, sd * (a + 0.3), 2 * a + 1.2, H, 0.6), 0xa09488);
    }
    const vault = new THREE.CylinderGeometry(a, a, 2 * a + 0.6, 22, 6, true, 0, Math.PI).rotateZ(Math.PI / 2);
    SB.add(vault, LM(0, H, 0, 1, 0.75, 1), 0x9a8e82, 0, 0, true);
    const lune = new THREE.CircleGeometry(a, 22, 0, Math.PI);
    for (const sd of [-1, 1]) SB.add(lune, LM(sd * (a + 0.05), H, 0, 1, 0.75, 1, -sd * Math.PI / 2), 0x9a8e82);
    // три камеры у задней стены: перегородки, решётки, притолоки
    const zc = -2.2;
    for (const x of [-1.75, 1.75]) SB.add(box, LM(x, H / 2, (zc - a) / 2, 0.4, H, a + zc), 0xa09488);
    SB.add(box, LM(0, H - 0.3, zc, 2 * a, 0.6, 0.35), 0xa09488);
    for (let x = -a + 0.1; x < a; x += 0.17) {
      if (Math.abs(Math.abs(x) - 1.75) < 0.25) continue;
      PB.add(GEO.cylLo, LM(x, (H - 0.6) / 2, zc, 0.022, H - 0.6, 0.022), 0x3a3634);
    }
    for (const y of [0.12, 1.3, H - 0.66]) PB.add(box, LM(0, y, zc, 2 * a, 0.05, 0.05), 0x2e2a28);
    for (const x of [-3.5, 0, 3.5]) PB.add(box, LM(x + 0.5, 1.15, zc + 0.05, 0.12, 0.16, 0.08), 0x2a2622); // замки
    for (const x of [-3.5, 0, 3.5]) {
      SB.add(box, LM(x, 0.22, -a + 0.4, 3.0, 0.45, 0.8), 0x8a8078); // каменная лежанка
      PB.add(GEO.box, LM(x + (rnd() - 0.5) * 0.6, 0.02, -3.2, 2.2, 0.04, 1.3), 0x5a4a24); // солома
      for (const dx of [-0.5, 0.5]) for (let k = 0; k < 6; k++) PB.add(new THREE.TorusGeometry(0.045, 0.012, 4, 8), LM(x + dx, 2.3 - k * 0.08, -a + 0.05, 1, 1, 1, 0, 0, k % 2 ? Math.PI / 2 : 0), 0x3a3634); // цепи
      PB.add(GEO.bucketG || new THREE.CylinderGeometry(0.14, 0.11, 0.25, 10), LM(x + 1.1, 0.13, -2.8), 0x5a3a1e);
    }
    // узники и тюремщик
    const pr = (opts) => { const w = L(opts.lx, opts.ly, opts.lz); person(PB, { ...opts, x: w.x, y: w.y, z: w.z, yaw: KEEP.yaw + (opts.ryaw || 0) }); };
    pr({ lx: -3.5, ly: 0.5, lz: -a + 0.55, ryaw: 0, role: 'peasant', pose: 'sit', item: null, seed: 661 });
    pr({ lx: 0.4, ly: 0, lz: zc - 0.45, ryaw: 0, role: 'foe', item: null, seed: 662 });
    pr({ lx: 3.6, ly: 0.5, lz: -a + 0.55, ryaw: 0, role: 'servant', pose: 'sit', seed: 663 });
    let jh = null;
    { const w = L(1.8, 0, 1.3); jh = person(PB, { x: w.x, y: w.y, z: w.z, yaw: KEEP.yaw + Math.PI + 0.4, role: 'guard', item: 'torch', seed: 664 }).hands[0]; }
    // стол, свеча, бочки, лестница наверх
    PB.add(box, LM(-2.8, 0.78, 2.2, 1.6, 0.08, 0.9), 0x6a4a2a);
    for (const [dx, dz] of [[-0.7, -0.35], [0.7, -0.35], [-0.7, 0.35], [0.7, 0.35]]) PB.add(box, LM(-2.8 + dx, 0.38, 2.2 + dz, 0.07, 0.76, 0.07), 0x5a3a1e);
    PB.add(GEO.cyl, LM(-2.5, 0.9, 2.1, 0.03, 0.16, 0.03), 0xe8e0c8);
    PB.add(GEO.cyl, LM(-3.0, 0.83, 2.3, 0.12, 0.04, 0.12), 0x8a8a8a);
    PB.add(GEO.cyl, LM(-3.0, 0.9, 2.3, 0.08, 0.1, 0.08), 0x6a3a1a);
    for (const [x, z] of [[-4.5, 4.2], [-3.7, 4.5], [-4.4, 3.4]]) PB.add(new THREE.CylinderGeometry(0.34, 0.34, 0.9, 12), LM(x, 0.45, z, 1, 1, 1), 0x6a4a2a);
    for (let k = 0; k < 10; k++) SB.add(box, LM(a - 0.55, 0.16 + k * 0.32, 4.8 - k * 0.42, 1.0, 0.32, 0.5), 0x8a8078);
    PB.add(box, LM(a - 0.02, H - 0.3, 1.4, 0.05, 1.8, 1.2), 0x050404); // тёмный проём наверх
    PB.add(box, LM(-0.6, 0.02, 3.3, 0.3, 0.08, 0.12), 0x2a2420); // крыса :)
    PB.add(GEO.sph, LM(-0.45, 0.07, 3.3, 0.09, 0.06, 0.06), 0x3a3230);
    // факелы на стенах
    const lights = [];
    const glow = new ColorBuilder();
    for (const [x, z, n] of [[-a + 0.1, 0.8, 1], [a - 0.1, -1.0, -1], [-1.2, a - 0.1, 0], [2.4, -a + 0.1, 0]]) {
      const bx = x, bz = z;
      PB.add(box, LM(bx, 1.9, bz, 0.08, 0.35, 0.08, 0, n === 0 ? (bz > 0 ? -0.5 : 0.5) : 0, n * 0.5), 0x3a2a1a);
      const tp = L(bx + n * 0.12, 2.1, bz + (n === 0 ? (bz > 0 ? -0.12 : 0.12) : 0));
      torchFlame(glow, tp, 1.1);
      lights.push({ p: tp.clone(), i: 2.2, r: 2.6, c: [1.0, 0.62, 0.3] });
    }
    lights.push({ p: L(-2.5, 1.05, 2.1), i: 0.8, r: 1.3, c: [1, 0.75, 0.4] });
    { const tp = jh.clone().add(new V3(0, 0.46, 0)); torchFlame(glow, tp, 1); lights.push({ p: tp.clone().add(new V3(0, 0.2, 0)), i: 1.6, r: 2.2, c: [1.0, 0.62, 0.3] }); }
    glow.add(GEO.flame, M(L(-2.5, 1.05, 2.1).x, L(-2.5, 1.05, 2.1).y, L(-2.5, 1.05, 2.1).z, 0, 0.02, 0.07, 0.02), 0xffd070);
    const grp = bakedMeshes(scene, SB, PB, lights, 0.09, null, 'dungeon');
    grp.add(new THREE.Mesh(glow.build(), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })));
    const inv = new THREE.Matrix4().copy(basis).invert();
    const tmp = new V3();
    const limit = (cam, tgt) => {
      tmp.copy(cam.position).sub(O).applyMatrix4(inv);
      tmp.x = Math.max(-4.4, Math.min(4.4, tmp.x));
      tmp.y = Math.max(0.6, Math.min(4.6, tmp.y));
      tmp.z = Math.max(-1.7, Math.min(4.6, tmp.z));
      cam.position.copy(tmp.applyMatrix4(basis).add(O));
    };
    out.places.dungeon = { tgt: L(-1.0, 1.0, -3.4), pos: L(3.3, 2.0, 3.8), limit, grp };
  }

  // =========================== ШАХТА КОЛОДЦА ===========================
  {
    const g = gh(WELL.x, WELL.z), top = g + 0.85;
    const r = WELL.r - 0.35, y0 = top - 1.4, depth = 26;
    const SB = new Baked(), PB = new Baked();
    SB.add(new THREE.CylinderGeometry(r, r, depth, 18, 26, true), M(WELL.x, y0 - depth / 2, WELL.z), 0xb0a090, 0, 0, true, [Math.round(2 * Math.PI * r / 1.1), depth / 2.2]);
    // вода на дне и отражение неба
    PB.add(new THREE.CircleGeometry(r, 18).rotateX(-Math.PI / 2), M(WELL.x, y0 - depth + 0.4, WELL.z), 0x1e3036);
    PB.add(new THREE.CircleGeometry(r * 0.35, 18).rotateX(-Math.PI / 2), M(WELL.x + 0.05, y0 - depth + 0.41, WELL.z), 0x9ab4c8);
    // верёвка и ведро на полпути
    PB.add(GEO.cylLo, M(WELL.x, (top + 1.05 + y0 - 16) / 2, WELL.z + 0.02, 0, 0.012, top + 1.05 - (y0 - 16), 0.012), 0x8a7a5a);
    PB.add(new THREE.CylinderGeometry(0.2, 0.16, 0.34, 12), M(WELL.x, y0 - 16.2, WELL.z + 0.02), 0x5a3a1e);
    for (let k = 0; k < 30; k++) { // мох и влажные пятна у воды
      const a = rnd() * 6.28, yy = y0 - depth + 0.5 + rnd() * 4;
      PB.add(GEO.bush, M(WELL.x + Math.cos(a) * (r - 0.03), yy, WELL.z + Math.sin(a) * (r - 0.03), a, 0.06, 0.18 + rnd() * 0.2, 0.18 + rnd() * 0.2), 0x3a4a24);
    }
    const sky = (p) => 1.3 * Math.exp(-(y0 - p.y) / 8) + 0.08;
    const grp = bakedMeshes(scene, SB, PB, [], 0.02, sky, 'well-shaft');
    const cx = WELL.x, cz = WELL.z;
    const limit = (cam) => {
      const p = cam.position;
      if (p.y < top + 0.3) {
        const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
        if (d > r - 0.25) { p.x = cx + dx / d * (r - 0.25); p.z = cz + dz / d * (r - 0.25); }
      }
      p.y = Math.max(y0 - depth + 1.5, Math.min(top + 6, p.y));
    };
    out.places.well = { top, y0, depth, limit, grp };
  }

  // =========================== ПРАЧКИ У РЕКИ ===========================
  if (village) {
    let best = null;
    for (let x = -30; x > -140 && !best; x -= 4) {
      for (const sd of [-1, 1]) {
        const z = riverZ(x) + sd * (riverHalfWidth(x) + 0.7);
        if (sd > 0 && z > riverZ(x) && Math.hypot(x - village.bridge.a.x, z - village.bridge.a.z) < 60) continue;
        if (village.exclude(x, z) > 0) continue;
        const rd = terrain.roadNearest(x, z); if (rd && rd.d < 20) continue;
        if (Math.hypot(x - (ctx.campSite ? ctx.campSite.x : 1e4), z - (ctx.campSite ? ctx.campSite.z : 1e4)) < 60) continue;
        if (sd < 0) { best = { x, z, sd }; break; }
      }
    }
    if (best) {
      const { x, z, sd } = best;
      const D = new V3(0, 0, -sd); // к воде
      const F = frameAt(new V3(x, 0, z), D);
      const hp = (u, v) => { const p = F.p(u, 0, v); return gh(p.x, p.z); };
      // мостки из досок у воды
      for (let k = 0; k < 5; k++) {
        const p = F.p(0.2, 0, -2 + k * 0.9);
        wood.box(new V3(p.x, hp(0.2, -2 + k * 0.9) + 0.12, p.z), F.d, UP, F.s, 0.9, 0.05, 0.4, { grain: true });
      }
      for (let k = 0; k < 3; k++) {
        const v = -1.6 + k * 1.6, p = F.p(-0.4, 0, v);
        people.push({ x: p.x, y: hp(-0.4, v), z: p.z, yaw: F.yaw, role: k === 1 ? 'townswoman' : 'woman', pose: 'work', item: null, seed: 671 + k });
      }
      people.push({ ...(() => { const p = F.p(-3.2, 0, 1.2); return { x: p.x, z: p.z, y: hp(-3.2, 1.2) }; })(), yaw: F.yaw + 2.4, role: 'child', seed: 674 });
      for (const [u, v] of [[-1.8, -2.8], [-1.6, 2.6]]) {
        const p = F.p(u, 0, v), y = hp(u, v);
        colorB.add(new THREE.CylinderGeometry(0.34, 0.26, 0.4, 12, 1, true), M(p.x, y + 0.2, p.z), 0x9a7a44);
        colorB.add(GEO.cyl, M(p.x, y + 0.36, p.z, 0, 0.3, 0.06, 0.3), 0xe8e2d4);
      }
      // верёвка с бельём между двух жердей и бельё на кустах
      const a = F.p(-5, 0, -4), bb = F.p(-5, 0, 4);
      for (const q of [a, bb]) wood.addGeometry(new THREE.CylinderGeometry(0.04, 0.05, 2, 6), M(q.x, gh(q.x, q.z) + 1, q.z));
      const ya = gh(a.x, a.z) + 1.85;
      colorB.add(GEO.box, M((a.x + bb.x) / 2, ya, (a.z + bb.z) / 2, F.yaw + Math.PI / 2, 8, 0.015, 0.015), 0x6a5a40);
      for (let k = 0; k < 6; k++) {
        const t = (k + 0.7) / 7, p = a.clone().lerp(bb, t);
        colorB.add(GEO.box, M(p.x, ya - 0.35, p.z, F.yaw + Math.PI / 2, 0.6 + rnd() * 0.3, 0.7, 0.02), [0xf0ece0, 0xe0d8c4, 0xc8d4dc, 0xe8e0d0][k % 4]);
      }
      for (const [u, v] of [[-3, -6], [-3.5, 6]]) {
        const p = F.p(u, 0, v), y = gh(p.x, p.z);
        for (let k = 0; k < 3; k++) colorB.add(GEO.bush, M(p.x + (rnd() - 0.5), y + 0.4, p.z + (rnd() - 0.5), 0, 0.7, 0.5, 0.7), 0x3a5a24);
        colorB.add(GEO.box, M(p.x, y + 0.88, p.z, rnd() * 3, 1.1, 0.02, 0.8, 0.1), 0xf0ece0);
      }
      const c = F.p(0, 0, 0);
      out.areas.push({ x: c.x, z: c.z, r: 9 });
      out.places.washers = { tgt: F.p(-1, 0, 0).setY(hp(-1, 0) + 0.8), pos: F.p(-12, 0, 7).setY(hp(-12, 7) + 4.5), c };
    }
  }

  // ======================== ПОИСК МЕСТ НА СКЛОНАХ ========================
  const others = () => [
    ...(ctx.campSite ? [{ x: ctx.campSite.x, z: ctx.campSite.z, r: 50 }] : []),
    ...(ctx.pasture ? [{ x: ctx.pasture.x, z: ctx.pasture.z, r: 30 }] : []),
    ...(ctx.tourney ? [{ x: ctx.tourney.x, z: ctx.tourney.z, r: 50 }] : []),
    ...out.areas,
  ];
  const clear = (x, z, R) => {
    if (village && village.exclude(x, z) > 0) return false;
    const rd = terrain.roadNearest(x, z); if (rd && rd.d < R + 6) return false;
    if (Math.abs(z - riverZ(x)) < riverHalfWidth(x) + 10) return false;
    return !others().some((a) => Math.hypot(x - a.x, z - a.z) < a.r + R);
  };
  // направление «в гору» по разности высот
  const upDir = (x, z) => { const e = 2; return new V3(gh(x - e, z) - gh(x + e, z), 0, gh(x, z - e) - gh(x, z + e)).multiplyScalar(-1).normalize(); };

  // =========================== ВИНОГРАДНИК ===========================
  {
    const rr = mulberry32(681);
    let best = null, bestS = -1;
    for (let k = 0; k < 1500; k++) {
      const a = rr() * Math.PI * 2, rad = 85 + rr() * 90;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      if (!clear(x, z, 22)) continue;
      const U = upDir(x, z), S = new V3(U.z, 0, -U.x);
      let ok = true, sl = 0;
      for (const [du, dv] of [[-9, -12], [-9, 12], [9, -12], [9, 12], [0, 0]]) {
        const px = x + U.x * du + S.x * dv, pz = z + U.z * du + S.z * dv;
        const gi = terrain.groundAt(px, pz);
        if (gi.rock > 0.05 || gi.slope > 0.22 || !clear(px, pz, 2)) { ok = false; break; }
        sl += gi.slope;
      }
      if (!ok) continue;
      const score = sl + (z > 0 ? 0.3 : 0) - Math.abs(rad - 110) / 300;
      if (score > bestS) { bestS = score; best = { x, z, U, S }; }
    }
    if (best) {
      const { x, z, U, S } = best;
      const vineB = new ColorBuilder();
      const leaf = [0x3a5a1e, 0x4a6a24, 0x2e4e1a];
      for (let row = 0; row < 8; row++) {
        const du = -8 + row * 2.3;
        for (let dv = -11; dv <= 11; dv += 0.8) {
          const px = x + U.x * du + S.x * dv, pz = z + U.z * du + S.z * dv, py = gh(px, pz);
          if (Math.abs(dv % 2.4) < 0.4) wood.box(new V3(px, py + 0.65, pz), UP, S, U, 0.65, 0.03, 0.03, { grain: true });
          vineB.add(GEO.bush, M(px, py + 0.8, pz, rr() * 6, 0.36 + rr() * 0.12, 0.42, 0.24), leaf[(row + Math.round(dv)) & 1 ? 0 : (rr() < 0.5 ? 1 : 2)]);
          if (rr() < 0.35) vineB.add(GEO.sph, M(px + U.x * 0.22, py + 0.55, pz + U.z * 0.22, 0, 0.06, 0.1, 0.06), 0x3a1a3a);
        }
        const a0 = new V3(x + U.x * du - S.x * 11, 0, z + U.z * du - S.z * 11), a1 = new V3(x + U.x * du + S.x * 11, 0, z + U.z * du + S.z * 11);
        const m = a0.clone().lerp(a1, 0.5);
        colorB.add(GEO.box, M(m.x, (gh(a0.x, a0.z) + gh(a1.x, a1.z)) / 2 + 1.05, m.z, Math.atan2(S.x, S.z), 0.012, 0.012, 22), 0x3a3028);
      }
      const vmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
      const vm = new THREE.Mesh(vineB.build(), vmat);
      vm.castShadow = vm.receiveShadow = true;
      vm.name = 'vineyard';
      scene.add(vm);
      upd.push(() => { const a = AUTUMN.value; vmat.color.setRGB(1 + 1.3 * a, 1 + 0.25 * a, 1 - 0.55 * a); });
      // сборщики с корзинами и воз с чаном
      for (let k = 0; k < 4; k++) {
        const du = -8 + (1 + k * 2) * 2.3 + 1.15, dv = -7 + k * 4.2;
        const px = x + U.x * du + S.x * dv, pz = z + U.z * du + S.z * dv;
        people.push({ x: px, y: gh(px, pz), z: pz, yaw: Math.atan2(-U.x, -U.z) + (k % 2 ? 1.5 : -1.5), role: k % 2 ? 'woman' : 'peasant', pose: 'work', item: 'basket', seed: 691 + k });
      }
      { const du = -10.5, dv = 13; const px = x + U.x * du + S.x * dv, pz = z + U.z * du + S.z * dv;
        const top = cart(wood, metal, terrain, px, pz, Math.atan2(S.z, S.x), rr);
        wood.addGeometry(new THREE.CylinderGeometry(0.55, 0.5, 0.7, 12), M(top.x, top.y + 0.35, top.z));
        colorB.add(GEO.cyl, M(top.x, top.y + 0.66, top.z, 0, 0.5, 0.02, 0.5), 0x3a1030);
        people.push({ x: px + U.x * 1.8, y: gh(px + U.x * 1.8, pz + U.z * 1.8), z: pz + U.z * 1.8, yaw: Math.atan2(U.x, U.z), role: 'peasant', item: 'basket', seed: 699 }); }
      out.areas.push({ x, z, r: 16 });
      const c = new V3(x, gh(x, z), z);
      out.places.vineyard = { c, tgt: c.clone().add(new V3(0, 1, 0)), pos: c.clone().addScaledVector(U, -24).addScaledVector(S, 10).setY(0) };
      out.places.vineyard.pos.y = gh(out.places.vineyard.pos.x, out.places.vineyard.pos.z) + 9;
    }
  }

  // =========================== КАМЕНОЛОМНЯ ===========================
  {
    const rr = mulberry32(701);
    let best = null, bestS = -1;
    for (let k = 0; k < 2000; k++) {
      const a = rr() * Math.PI * 2, rad = 90 + rr() * 110;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      if (!clear(x, z, 18)) continue;
      const U = upDir(x, z), S = new V3(U.z, 0, -U.x);
      const h0 = gh(x, z), h1 = gh(x + U.x * 8, z + U.z * 8), hf = gh(x - U.x * 8, z - U.z * 8);
      const rise = h1 - h0, fall = h0 - hf;
      if (rise < 3 || rise > 9 || fall > 3.5) continue;
      if (Math.abs(gh(x + S.x * 7, z + S.z * 7) - h0) > 2.5 || Math.abs(gh(x - S.x * 7, z - S.z * 7) - h0) > 2.5) continue;
      const rock = terrain.groundAt(x + U.x * 6, z + U.z * 6).rock;
      const score = rock * 2 + rise * 0.1 - fall * 0.2;
      if (score > bestS) { bestS = score; best = { x, z, U, S, h0 }; }
    }
    if (best) {
      const { x, z, U, S, h0 } = best;
      const F = frameAt(new V3(x, 0, z), U);
      // уступы свежего камня: чем дальше в склон, тем выше
      for (const [u0, u1, hh] of [[0, 3, 1.4], [3, 6, 3.0], [6, 10, 4.8]]) {
        for (let v = -6; v < 6; v += 3) {
          const c = F.p((u0 + u1) / 2 + 1, 0, v + 1.5);
          const base = Math.min(gh(c.x, c.z), h0) - 1.5;
          const top = h0 + hh + (rr() - 0.5) * 0.3;
          const sh = 0.82 + rr() * 0.12;
          colorB.add(GEO.box, M(c.x, (base + top) / 2, c.z, F.yaw, 3.02, top - base, u1 - u0 + 2), new THREE.Color(0x7a7262).multiplyScalar(sh).getHex());
          // трещины и следы кирок на срезе
          for (let k = 0; k < 3; k++) { const q = F.p(u0 + 1 - 0.01, 0, v + 0.3 + rr() * 2.4); colorB.add(GEO.box, M(q.x, h0 + rr() * hh, q.z, F.yaw, 0.03, 0.4 + rr() * 0.8, 0.03), 0x6a645a); }
        }
      }
      // вырубленные блоки
      for (let k = 0; k < 14; k++) {
        const u = -2 - rr() * 7, v = (rr() - 0.5) * 12;
        const p = F.p(u, 0, v), y = gh(p.x, p.z);
        const hx = 0.35 + rr() * 0.3, hy = 0.25 + rr() * 0.15, hz = 0.25 + rr() * 0.2;
        const sh = 0.8 + rr() * 0.15;
        colorB.add(GEO.box, M(p.x, y + hy + (k > 10 ? hy * 2 : 0), p.z, F.yaw + (rr() - 0.5) * 0.4, hz * 2, hy * 2, hx * 2), new THREE.Color(0x857c6a).multiplyScalar(sh).getHex());
      }
      for (let k = 0; k < 60; k++) { const p = F.p(-1 - rr() * 6, 0, (rr() - 0.5) * 12); colorB.add(new THREE.DodecahedronGeometry(0.08 + rr() * 0.1, 0), M(p.x, gh(p.x, p.z) + 0.03, p.z, rr() * 6), 0x6a6454); }
      // деревянный кран-«журавль» с подвешенным блоком
      { const p = F.p(-1.5, 0, 4.5), y = gh(p.x, p.z);
        for (const sd of [-1, 1]) { const q = F.p(-1.5, 0, 4.5 + sd * 0.9); wood.addGeometry(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 6), new THREE.Matrix4().compose(new V3(q.x, y + 2, q.z).addScaledVector(S, -sd * 0.45), new THREE.Quaternion().setFromAxisAngle(U, -sd * 0.22), new V3(1, 1, 1))); }
        const tp = new V3(p.x, y + 4.0, p.z);
        const boomEnd = tp.clone().addScaledVector(U, 3.2).add(new V3(0, -0.4, 0));
        const mid = tp.clone().lerp(boomEnd, 0.5);
        wood.addGeometry(new THREE.CylinderGeometry(0.07, 0.07, 3.3, 6), new THREE.Matrix4().compose(mid, new THREE.Quaternion().setFromUnitVectors(UP, boomEnd.clone().sub(tp).normalize()), new V3(1, 1, 1)));
        colorB.add(GEO.cylLo, M(boomEnd.x, boomEnd.y - 1.2, boomEnd.z, 0, 0.015, 2.4, 0.015), 0x8a7a5a);
        stone.box(new V3(boomEnd.x, boomEnd.y - 2.7, boomEnd.z), U, UP, S, 0.5, 0.3, 0.35);
        wood.addGeometry(new THREE.CylinderGeometry(0.6, 0.6, 0.25, 12), new THREE.Matrix4().compose(new V3(p.x, y + 0.7, p.z).addScaledVector(U, -1.2), new THREE.Quaternion().setFromAxisAngle(U, Math.PI / 2), new V3(1, 1, 1))); }
      // каменотёсы
      const w = [[1.5, -3, 'pick', 'stand'], [4.3, 1.5, 'pick', 'stand'], [-3.2, -1.5, null, 'work'], [-5, 3, null, 'work'], [-2.4, 4.6, null, 'stand']];
      w.forEach(([u, v, item, pose], k) => {
        const p = F.p(u, 0, v);
        const onBench = u > 0 ? h0 + (u < 3 ? 1.4 : 3.0) : gh(p.x, p.z);
        people.push({ x: p.x, y: onBench, z: p.z, yaw: F.yaw + (u > 0 ? 0 : Math.PI) + (rr() - 0.5), role: k === 4 ? 'merchant' : 'peasant', item, pose, seed: 711 + k });
      });
      // воз с блоком и волы
      { const p = F.p(-9, 0, -3); const top = cart(wood, metal, terrain, p.x, p.z, Math.atan2(S.z, S.x) + 0.3, rr);
        stone.box(top.clone().add(new V3(0, 0.3, 0)), U, UP, S, 0.5, 0.3, 0.35);
        const X2 = new V3(Math.cos(Math.atan2(S.z, S.x) + 0.3), 0, Math.sin(Math.atan2(S.z, S.x) + 0.3));
        for (const sd of [-0.55, 0.55]) { const o = p.clone().addScaledVector(X2, 3.9).add(new V3(-X2.z * sd, 0, X2.x * sd)); cow(colorB, o.x, gh(o.x, o.z), o.z, Math.atan2(X2.x, X2.z), rr, 0x8a6a4a); } }
      out.areas.push({ x, z, r: 16 });
      const c = new V3(x, h0, z);
      out.places.quarry = { c, tgt: c.clone().addScaledVector(U, 2).add(new V3(0, 2, 0)), pos: F.p(-20, 0, -9) };
      out.places.quarry.pos.y = gh(out.places.quarry.pos.x, out.places.quarry.pos.z) + 7;
    }
  }

  // =========================== ПОТАЙНОЙ ХОД ===========================
  {
    let best = null, bestS = 1e9;
    for (let a = 0; a < Math.PI * 2; a += 0.02) {
      for (let rad = 70; rad < 240; rad += 2) {
        const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
        const dRiver = Math.abs(z - riverZ(x)) - riverHalfWidth(x);
        if (dRiver < 14 || dRiver > 220) continue;
        if (!clear(x, z, 14)) continue;
        const U = new V3(-Math.cos(a), 0, -Math.sin(a)); // к замку
        const h0 = gh(x, z);
        const hi = gh(x + U.x * 3, z + U.z * 3), hi2 = gh(x + U.x * 8, z + U.z * 8), ho = gh(x - U.x * 5, z - U.z * 5);
        if (hi - h0 < 2.2 || hi2 - h0 < 5 || h0 - ho > 3) continue;
        const S = new V3(U.z, 0, -U.x);
        if (Math.abs(gh(x + S.x * 3, z + S.z * 3) - h0) > 2.5 || Math.abs(gh(x - S.x * 3, z - S.z * 3) - h0) > 2.5) continue;
        const score = dRiver + Math.abs(a - 2.2) * 5;
        if (score < bestS) { bestS = score; best = { x, z, U, h0 }; }
      }
    }
    if (best) {
      const { x, z, U, h0 } = best;
      const P = new V3(x, h0, z);
      const F = frameAt(new V3(x, 0, z), U);
      const S = F.s;
      // каменная арка входа, вделанная в склон, и дубовая дверь
      const fy = h0;
      for (const sd of [-1, 1]) stone.box(F.p(-0.3, 0, sd * 1.25).setY(fy + 1.0), U, UP, S, 0.45, 1.6, 0.45);
      stone.box(F.p(-0.3, 0, 0).setY(fy + 2.45), U, UP, S, 0.45, 0.35, 1.7);
      for (const sd of [-1, 1]) stone.box(F.p(-0.2, 0, sd * 2.25).setY(fy + 1.0), U, UP, S, 0.5, 1.8, 0.55);
      stone.box(F.p(-0.25, 0, 0).setY(fy + 3.05), U, UP, S, 0.5, 0.3, 2.8);
      wood.box(F.p(-0.15, 0, 0).setY(fy + 1.05), U, UP, S, 0.05, 1.05, 0.8, { grain: true });
      metal.box(F.p(-0.21, 0, 0).setY(fy + 1.6), U, UP, S, 0.02, 0.05, 0.75);
      metal.box(F.p(-0.21, 0, 0).setY(fy + 0.5), U, UP, S, 0.02, 0.05, 0.75);
      metal.box(F.p(-0.22, 0, -0.55).setY(fy + 1.05), U, UP, S, 0.03, 0.06, 0.06);
      // валуны и кусты вокруг — вход почти не заметен
      for (let k = 0; k < 9; k++) {
        const v = (rnd() - 0.5) * 8, u = -0.5 - rnd() * 2.5;
        if (Math.abs(v) < 1.2 && u > -2) continue;
        const p = F.p(u, 0, v), y = gh(p.x, p.z), r = 0.3 + rnd() * 0.6;
        stone.addGeometry(new THREE.DodecahedronGeometry(r, 0), M(p.x, y + r * 0.4, p.z, rnd() * 6, 1, 0.8, 1.2));
      }
      for (const [u, v, s] of [[-1.3, -1.9, 1], [-1.6, 1.7, 1.1], [-2.8, -0.6, 0.9], [-0.8, 2.6, 0.8], [-0.6, -2.7, 0.9], [0.4, 0, 1.2]]) {
        const p = F.p(u, 0, v), y = u > 0 ? fy + 2.8 : gh(p.x, p.z);
        for (let k = 0; k < 4; k++) colorB.add(GEO.bush, M(p.x + (rnd() - 0.5) * 0.9, y + 0.45 * s, p.z + (rnd() - 0.5) * 0.9, rnd() * 6, 0.7 * s, 0.55 * s, 0.7 * s), [0x2e4a1e, 0x3a5a24, 0x2a421a][k % 3]);
      }
      // ход внутри холма: свод, пол, факелы, ступени к замку
      const SB = new Baked(), PB = new Baked();
      const len = 24, w = 0.85, wallH = 1.5;
      const tM = (u, h, v, sx, sy, sz) => F.m(u, h, v, sx, sy, sz);
      SB.add(new THREE.BoxGeometry(1, 1, 1), tM(len / 2, fy - 0.15, 0, 2 * w + 0.6, 0.3, len + 0.5), 0x7a7068);
      for (const sd of [-1, 1]) SB.add(new THREE.BoxGeometry(1, 1, 1), tM(len / 2, fy + wallH / 2, sd * (w + 0.2), 0.4, wallH, len + 0.5), 0x9a8e82);
      const vault = new THREE.CylinderGeometry(w, w, len + 0.5, 14, 12, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2);
      SB.add(vault, tM(len / 2, fy + wallH, 0, 1, 1, 1), 0x9a8e82, 0, 0, true);
      // обратная сторона двери и ступени в конце
      PB.add(new THREE.BoxGeometry(1, 1, 1), tM(0.25, fy + 1.05, 0, 1.6, 2.1, 0.1), 0x5a3e24);
      for (let k = 0; k < 8; k++) SB.add(new THREE.BoxGeometry(1, 1, 1), tM(len - 3.6 + k * 0.45, fy + 0.12 * (k + 1), 0, 2 * w, 0.24 * (k + 1), 0.45), 0x8a8078);
      PB.add(new THREE.BoxGeometry(1, 1, 1), tM(len + 0.1, fy + 1.6, 0, 2 * w, 3.2, 0.1), 0x050404);
      // капли на полу и корни
      for (let k = 0; k < 12; k++) PB.add(GEO.cyl, tM(1 + rnd() * (len - 5), fy + 0.01, (rnd() - 0.5) * 1.2, 0.2 + rnd() * 0.3, 0.01, 0.15 + rnd() * 0.2), 0x2a3438);
      const glow = new ColorBuilder();
      const lights = [{ p: F.p(0.4, 0, 0).setY(fy + 1.2), i: 0.25, r: 1.2, c: [0.7, 0.8, 1.0] }];
      for (const u of [5, 12, 19]) {
        const sd = u === 12 ? 1 : -1;
        const tp = F.p(u, 0, sd * (w - 0.08)).setY(fy + 1.55);
        PB.add(new THREE.BoxGeometry(1, 1, 1), F.m(u, fy + 1.35, sd * (w - 0.04), 0.06, 0.3, 0.06), 0x3a2a1a);
        torchFlame(glow, tp, 1);
        lights.push({ p: tp.clone(), i: 1.8, r: 2.3, c: [1.0, 0.62, 0.3] });
      }
      const grp = bakedMeshes(scene, SB, PB, lights, 0.06, null, 'tunnel');
      grp.add(new THREE.Mesh(glow.build(), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })));
      const inv = new THREE.Matrix4().makeBasis(S, UP, U).invert(), fwd = new THREE.Matrix4().makeBasis(S, UP, U);
      const tmp = new V3();
      const limit = (cam) => {
        tmp.copy(cam.position).sub(P).applyMatrix4(inv); // x — вбок, y — вверх, z — вглубь
        if (tmp.z < 0.8) return; // снаружи — обычная камера
        tmp.x = Math.max(-w + 0.25, Math.min(w - 0.25, tmp.x));
        tmp.y = Math.max(0.7, Math.min(wallH + w - 0.3, tmp.y));
        tmp.z = Math.min(len - 4, tmp.z);
        cam.position.copy(tmp.applyMatrix4(fwd).add(P));
      };
      out.areas.push({ x, z, r: 7 });
      out.places.tunnel = { P, U, S, fy, grp, limit,
        outside: { tgt: P.clone().add(new V3(0, 1.3, 0)), pos: F.p(-11, 0, -4) },
        inside: { pos: F.p(2.2, 0, 0.1).setY(fy + 1.55), tgt: F.p(14, 0, 0).setY(fy + 1.3) } };
      out.places.tunnel.outside.pos.y = gh(out.places.tunnel.outside.pos.x, out.places.tunnel.outside.pos.z) + 3.2;
    }
  }

  out.update = (t, dt) => {
    for (const m of movers) m.update(dt, gh);
    for (const f of upd) f(t, dt);
  };
  out.setNight = (k) => { for (const m of night) m.userData.night = k > 0.35; };
  out.night = night;
  return out;
}
