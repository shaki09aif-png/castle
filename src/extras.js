// Оживление сцены: ходящие люди и лошадь, стая птиц над башнями, интерьер
// большого зала и осадный лагерь за рекой. Всё собирается в немногие сетки
// (один объект на материал), движение считает шейдер — FPS почти не меняется.
import * as THREE from 'three';
import { GeoBuilder } from './walls.js';
import { ColorBuilder, person, createPeople } from './people.js';
import { horse } from './yard.js';
import { HALL, Frame, strawMaterial } from './courtyard.js';
import { KEEP, TOWERS, WELL, BUILDINGS, riverZ, riverHalfWidth } from './layout.js';
import { mulberry32 } from './noise.js';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);
const X = new V3(1, 0, 0), Z = new V3(0, 0, 1);

function M(x, y, z, yaw = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, yaw, rz, 'YXZ'));
  return new THREE.Matrix4().compose(new V3(x, y, z), q, new V3(sx, sy, sz));
}
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  cylLo: new THREE.CylinderGeometry(1, 1, 1, 6),
  cone: new THREE.ConeGeometry(1, 1, 10),
  sph: new THREE.SphereGeometry(1, 10, 7),
  flame: new THREE.ConeGeometry(1, 1, 7),
};

// ===========================================================================
// ХОДЯЩИЕ: фигура строится в начале координат, ноги и руки качаются в шейдере
// ===========================================================================
function walkerMaterial() {
  const uPhase = { value: 0 };
  const uAmp = { value: 0.45 };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPhase = uPhase;
    sh.uniforms.uAmp = uAmp;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aLimb;\nuniform float uPhase;\nuniform float uAmp;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (aLimb.x != 0.0) {
          float a = sin(uPhase) * uAmp * aLimb.x;
          float c = cos(a), s = sin(a);
          vec3 p = transformed; p.y -= aLimb.y;
          transformed = vec3(p.x, p.y * c - p.z * s + aLimb.y, p.y * s + p.z * c);
        }
        transformed.y += abs(cos(uPhase)) * 0.025 * uAmp;`);
  };
  mat.customProgramCacheKey = () => 'walker';
  return { mat, uPhase, uAmp };
}

function makeWalker(scene, build, path, { speed = 1.1, loop = true, stride = 1.5, amp = 0.45, y = null } = {}) {
  const B = new ColorBuilder();
  build(B);
  const { mat, uPhase, uAmp } = walkerMaterial();
  uAmp.value = amp;
  const mesh = new THREE.Mesh(B.build(), mat);
  mesh.receiveShadow = true;
  mesh.name = 'walker';
  scene.add(mesh);
  // длины участков пути
  const pts = loop ? [...path, path[0]] : path;
  const seg = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) { const l = pts[i].distanceTo(pts[i + 1]); seg.push(l); total += l; }
  let s = Math.random() * total, dir = 1;
  const pos = new V3();
  return {
    mesh,
    update(dt, heightAt) {
      s += dt * speed * dir;
      if (loop) s = ((s % total) + total) % total;
      else if (s > total) { s = total; dir = -1; } else if (s < 0) { s = 0; dir = 1; }
      let d = s, i = 0;
      while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; }
      const a = pts[i], b = pts[i + 1];
      pos.copy(a).lerp(b, Math.min(1, d / seg[i]));
      mesh.position.set(pos.x, y !== null ? pos.y : heightAt(pos.x, pos.z), pos.z);
      const dx = (b.x - a.x) * dir, dz = (b.z - a.z) * dir;
      const target = Math.atan2(dx, dz);
      let diff = target - mesh.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      mesh.rotation.y += diff * Math.min(1, dt * 6); // плавный разворот на углах
      uPhase.value += dt * speed / stride * Math.PI * 2;
    },
  };
}

function createWalkers(scene, terrain, walls) {
  const out = [];
  const P = (x, z) => new V3(x, 0, z);
  const pp = (role, seed) => (B) => person(B, { x: 0, y: 0, z: 0, yaw: 0, role, seed, pose: 'stand' });
  // покупатели на рынке — круг между прилавками
  out.push(makeWalker(scene, pp('townswoman', 301), [P(-3, 8), P(-3.5, 20), P(2.5, 21), P(3, 8.5)], { speed: 0.9 }));
  out.push(makeWalker(scene, pp('peasant', 302), [P(3, 20.5), P(2.5, 9), P(-2.5, 8.5), P(-3, 19)], { speed: 1.0 }));
  // слуга носит воду от колодца к кухне и обратно
  const kitchen = BUILDINGS.find((b) => b.id === 'kitchen'), kf = new Frame(kitchen);
  const kd = kf.p(0, 0, kitchen.W / 2 + 3.2);
  out.push(makeWalker(scene, pp('woman', 303), [P(WELL.x + 1.5, WELL.z + 1.8), P(15, 9), P(kd.x, kd.z)], { loop: false, speed: 0.85 }));
  // крестьянин идёт от ворот к колодцу
  out.push(makeWalker(scene, pp('servant', 304), [P(0.5, 24), P(1.5, 14), P(6.5, 5.5)], { loop: false, speed: 1.0 }));
  // ребёнок бегает вокруг липы
  const lin = new V3(22, 0, -3), ring = [];
  for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; ring.push(P(lin.x + Math.cos(a) * 3.3, lin.z + Math.sin(a) * 3.3)); }
  out.push(makeWalker(scene, pp('child', 305), ring, { speed: 2.0, stride: 0.9, amp: 0.7 }));
  // стражник обходит боевой ход стены
  {
    const Pw = walls.points, Nw = walls.segNrm, Wk = walls.walk;
    const path = [];
    for (let i = 3; i <= 9 && i < Pw.length - 1; i++) {
      const p = Pw[i].clone().addScaledVector(Nw[Math.min(i, Nw.length - 1)], -0.55);
      path.push(new V3(p.x, Wk[i] + 0.1, p.z));
    }
    if (path.length > 1) {
      const w = makeWalker(scene, pp('knight', 306), path, { loop: false, speed: 0.8, y: true });
      out.push(w);
    }
  }
  // конюх водит лошадь по двору
  {
    const stable = BUILDINGS.find((b) => b.id === 'stable'), f = new Frame(stable);
    const a = f.p(-6, 0, stable.W / 2 + 7), b = f.p(4, 0, stable.W / 2 + 9), c = f.p(8, 0, stable.W / 2 + 14), d = f.p(-3, 0, stable.W / 2 + 13);
    const rnd = mulberry32(77);
    out.push(makeWalker(scene, (B) => {
      horse(B, 0, 0, 0, 0, 0x7a5030, rnd);
      person(B, { x: -0.55, y: 0, z: 1.1, yaw: 0, role: 'servant', seed: 307 });
    }, [a, b, c, d], { speed: 1.0, stride: 1.6, amp: 0.35 }));
  }
  // гонка «y: true» — высота берётся из пути (для боевого хода)
  return {
    update(dt) {
      for (const w of out) w.update(dt, terrain.heightAt);
    },
    meshes: out.map((w) => w.mesh),
  };
}

// ===========================================================================
// ПТИЦЫ: стаи кружат над донжоном и башней; взмахи крыльев — в шейдере
// ===========================================================================
function createBirds(scene) {
  const flocks = [
    { c: new V3(KEEP.x, 138, KEEP.z), n: 11, r: 22 },
    { c: new V3(TOWERS[3].x, 120, TOWERS[3].z), n: 7, r: 15 },
  ];
  const pos = [], aBird = [], aWing = [], idx = [];
  const rnd = mulberry32(99);
  let v = 0;
  for (const fl of flocks) {
    for (let k = 0; k < fl.n; k++) {
      const phase = rnd() * Math.PI * 2, rad = fl.r * (0.6 + rnd() * 0.6), hOff = (rnd() - 0.5) * 8, spd = (0.18 + rnd() * 0.1) * (rnd() < 0.5 ? 1 : -1);
      // тело (2 вершины: клюв и хвост) + два крыла (по вершине на конце)
      const verts = [[0, 0, 0.25, 0], [0, 0, -0.2, 0], [-0.55, 0, 0, -1], [0.55, 0, 0, 1]];
      for (const [x, y, z, w] of verts) {
        pos.push(x, y, z);
        aBird.push(fl.c.x, fl.c.y + hOff, fl.c.z, rad);
        aWing.push(w, phase, spd, 0);
      }
      idx.push(v, v + 2, v + 1, v, v + 1, v + 3);
      v += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aBird', new THREE.Float32BufferAttribute(aBird, 4));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(aWing, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  const uTime = { value: 0 };
  const mat = new THREE.MeshBasicMaterial({ color: 0x1c1a1a, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aBird;\nattribute vec4 aWing;\nuniform float uTime;')
      .replace('#include <begin_vertex>', `
        float ang = uTime * aWing.z + aWing.y;
        vec3 ctr = aBird.xyz + vec3(cos(ang) * aBird.w, sin(ang * 2.0 + aWing.y) * 2.5, sin(ang) * aBird.w);
        vec3 fwd = normalize(vec3(-sin(ang), 0.0, cos(ang)) * sign(aWing.z));
        vec3 rgt = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
        float flap = sin(uTime * 9.0 + aWing.y * 13.0) * 0.45;
        vec3 transformed = ctr + rgt * position.x + fwd * position.z + vec3(0.0, abs(aWing.x) * flap, 0.0);
        transformed *= 1.0;`);
  };
  mat.customProgramCacheKey = () => 'birds';
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.name = 'birds';
  scene.add(mesh);
  return { mesh, update(t) { uTime.value = t; } };
}

// Огонь: несколько тонких языков пламени разной высоты и угли
function fire(glowB, x, y, z, s, rnd) {
  for (let k = 0; k < 9; k++) {
    const a = rnd() * Math.PI * 2, r = rnd() * 0.28 * s;
    const h = (0.35 + rnd() * 0.5) * s * (1 - r / (0.4 * s) * 0.5);
    const w = (0.06 + rnd() * 0.06) * s;
    const c = k < 3 ? 0xffe38a : k < 6 ? 0xffa43a : 0xff6a1a;
    glowB.add(GEO.flame, M(x + Math.cos(a) * r, y + h / 2, z + Math.sin(a) * r, rnd() * 3, w, h, w, (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3), c);
  }
  glowB.add(GEO.cylLo, M(x, y + 0.02, z, 0, 0.36 * s, 0.04, 0.36 * s), 0xc0401a);
}

// ===========================================================================
// ИНТЕРЬЕР БОЛЬШОГО ЗАЛА
// ===========================================================================
function hallInterior(ctx) {
  const { stone, wood, colorB, glowB, people, rnd } = ctx;
  const { b, f, floorY, eaveY, ridge } = HALL;
  if (!b) return;
  const hl = b.L / 2 - 0.25, hw = b.W / 2 - 0.25;
  const inner = (lx, lz) => f.p(lx, 0, lz);
  // внутренние стены с проёмами под окна (окна снаружи видны изнутри)
  const wall = (lz, n, holes, y1 = eaveY) => {
    // вдоль длинной стены lz = const, от −hl до +hl
    const xs = [-hl, ...holes.flatMap((h) => [h.x - h.w / 2, h.x + h.w / 2]), hl];
    const quad = (x0, x1, y0, y1) => {
      const a = inner(x0, lz).setY(y0), bb = inner(x1, lz).setY(y0), c = inner(x1, lz).setY(y1), d = inner(x0, lz).setY(y1);
      stone.quad(a, bb, c, d, n, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    };
    for (let i = 0; i < xs.length - 1; i++) {
      const x0 = xs[i], x1 = xs[i + 1];
      if (x1 - x0 < 0.01) continue;
      const hole = i % 2 === 1 ? holes[(i - 1) / 2] : null;
      if (!hole) quad(x0, x1, floorY, y1);
      else { quad(x0, x1, floorY, hole.y0); quad(x0, x1, hole.y1, y1); }
    }
  };
  const nIn = f.N.clone().negate(), nOut = f.N.clone();
  const fac = [-6.4, -3.2, 0, 3.2].map((x) => ({ x, w: 1.3, y0: floorY + 2.2, y1: floorY + 2.3 + 3.7 }));
  fac.push({ x: 6.4, w: 1.9, y0: floorY + 0.01, y1: floorY + 3.1 }); // дверь
  fac.sort((a, c) => a.x - c.x);
  wall(hw, nIn, fac);
  wall(-hw, nOut, [-4.8, 0, 4.8].map((x) => ({ x, w: 0.3, y0: floorY + 2.9, y1: floorY + 4.1 })));
  // торцы (внутрь) с высоким окном и треугольником фронтона
  for (const s of [1, -1]) {
    const n = f.X.clone().multiplyScalar(-s);
    const lx = s * hl;
    const seg = (z0, z1, y0, y1) => {
      const a = f.p(lx, y0, z0), bb = f.p(lx, y0, z1), c = f.p(lx, y1, z1), d = f.p(lx, y1, z0);
      stone.quad(a, bb, c, d, n, [[z0, y0], [z1, y0], [z1, y1], [z0, y1]]);
    };
    seg(-hw, -0.75, floorY, eaveY); seg(0.75, hw, floorY, eaveY);
    seg(-0.75, 0.75, floorY, floorY + 3.1);
    const a = f.p(lx, eaveY, -hw), c = f.p(lx, eaveY, hw), top = f.p(lx, ridge - 0.35, 0);
    stone.quad(a, c, top, top.clone(), n, [[-hw, eaveY], [hw, eaveY], [0, ridge], [0, ridge]]);
  }
  // потолок: дощатые скаты изнутри и стропильные фермы
  for (const s of [1, -1]) {
    const e0 = f.p(-hl, eaveY, s * hw), e1 = f.p(hl, eaveY, s * hw), r1 = f.p(hl, ridge - 0.35, 0), r0 = f.p(-hl, ridge - 0.35, 0);
    const slope = new V3().subVectors(r0, e0).normalize();
    const n = new V3().crossVectors(f.X, slope).normalize();
    if (n.y > 0) n.negate();
    wood.quad(e0, e1, r1, r0, n, [[-hl, 0], [hl, 0], [hl, hw * 1.6], [-hl, hw * 1.6]]);
  }
  for (let lx = -hl + 1.5; lx < hl - 1; lx += 3.1) {
    wood.box(f.p(lx, eaveY - 0.15, 0), f.N, UP, f.X, hw, 0.14, 0.12, { grain: true }); // затяжка
    wood.box(f.p(lx, (eaveY + ridge) / 2 - 0.2, 0), UP, f.N, f.X, (ridge - eaveY) / 2 - 0.2, 0.1, 0.1, { grain: true }); // бабка
    for (const s of [1, -1]) {
      const a = f.p(lx, eaveY - 0.05, s * (hw - 0.1)), c = f.p(lx, ridge - 0.5, 0);
      const d = new V3().subVectors(c, a), len = d.length();
      d.normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(UP, d);
      wood.addGeometry(new THREE.BoxGeometry(0.2, len, 0.18), new THREE.Matrix4().compose(a.clone().addScaledVector(d, len / 2), q, new V3(1, 1, 1)));
    }
  }
  // деревянный пол
  wood.box(f.p(0, floorY + 0.02, 0), f.X, UP, f.N, hl, 0.02, hw, { grain: true });
  const yaw = Math.atan2(f.X.x, f.X.z); // «вдоль зала»
  const Mf = (lx, y, lz, sx, sy, sz, ry = 0) => { const p = f.p(lx, floorY + y, lz); return M(p.x, p.y, p.z, yaw + ry, sx, sy, sz); };
  // помост с высоким столом и троном у западного торца
  const dx = -hl + 1.6;
  wood.box(f.p(dx, floorY + 0.2, 0), f.X, UP, f.N, 1.5, 0.2, hw - 0.3, { grain: true });
  wood.box(f.p(dx + 0.4, floorY + 1.15, 0), f.X, UP, f.N, 0.45, 0.04, 2.6, { grain: true });
  for (const lz of [-2.4, 2.4]) wood.box(f.p(dx + 0.4, floorY + 0.8, lz), UP, f.X, f.N, 0.36, 0.06, 0.06, { grain: true });
  colorB.add(GEO.box, Mf(dx + 0.4, 1.19, 0, 5.3, 0.02, 1.0), 0x8a1a1a); // скатерть
  // трон с высокой спинкой и два кресла
  for (const [lz, big] of [[0, 1], [-1.3, 0], [1.3, 0]]) {
    const h = big ? 2.2 : 1.5;
    wood.box(f.p(dx - 0.35, floorY + 0.4 + 0.25, lz), f.X, UP, f.N, 0.3, 0.05, 0.32, { grain: true });
    wood.box(f.p(dx - 0.62, floorY + 0.4 + h / 2, lz), UP, f.N, f.X, h / 2, 0.34, 0.05, { grain: true });
    if (big) colorB.add(GEO.box, Mf(dx - 0.56, 0.4 + 1.3, lz, 0.5, 1.1, 0.02), 0x8a1a1a);
    if (big) colorB.add(GEO.cone, Mf(dx - 0.62, 0.4 + h + 0.12, lz, 0.1, 0.24, 0.1), 0xc8a040);
  }
  // знамя над троном
  colorB.add(GEO.box, Mf(-hl + 0.08, 4.6, 0, 1.4, 2.6, 0.03), 0x1d3f8a);
  colorB.add(GEO.box, Mf(-hl + 0.11, 4.6, 0, 0.4, 1.6, 0.03), 0xd6a632);
  // два длинных стола с лавками и угощением
  for (const lz of [-2.2, 2.2]) {
    const x0 = -hl + 4.0, x1 = hl - 2.6, cx = (x0 + x1) / 2, L = (x1 - x0) / 2;
    wood.box(f.p(cx, floorY + 0.8, lz), f.X, UP, f.N, L, 0.04, 0.45, { grain: true });
    for (const lx of [x0 + 0.3, cx, x1 - 0.3]) wood.box(f.p(lx, floorY + 0.4, lz), UP, f.X, f.N, 0.38, 0.05, 0.3, { grain: true });
    for (const s of [-1, 1]) {
      wood.box(f.p(cx, floorY + 0.45, lz + s * 0.85), f.X, UP, f.N, L, 0.03, 0.15, { grain: true });
      for (const lx of [x0 + 0.3, x1 - 0.3]) wood.box(f.p(lx, floorY + 0.22, lz + s * 0.85), UP, f.X, f.N, 0.22, 0.04, 0.1, { grain: true });
    }
    for (let lx = x0 + 0.5; lx < x1 - 0.3; lx += 0.75) {
      for (const s of [-1, 1]) {
        colorB.add(GEO.cylLo, Mf(lx, 0.845, lz + s * 0.25, 0.12, 0.01, 0.12), 0x6a5a4a); // миска
        colorB.add(GEO.cyl, Mf(lx + 0.18, 0.9, lz + s * 0.22, 0.035, 0.1, 0.035), 0x8a6a3a); // кубок
      }
      if (rnd() < 0.5) colorB.add(GEO.sph, Mf(lx + 0.35, 0.87, lz, 0.14, 0.07, 0.1), 0xa06a30); // хлеб
    }
    colorB.add(GEO.sph, Mf(cx, 0.95, lz, 0.28, 0.13, 0.2), 0x8a4a22); // жаркое
  }
  // очаг посреди зала (под дымником): каменное кольцо, поленья, огонь
  const hc = f.p(1.2, floorY, 0);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    stone.addGeometry(new THREE.DodecahedronGeometry(0.2, 0), M(hc.x + Math.cos(a) * 0.9, floorY + 0.1, hc.z + Math.sin(a) * 0.9, a));
  }
  for (let k = 0; k < 5; k++) wood.addGeometry(new THREE.CylinderGeometry(0.07, 0.08, 0.9, 6), M(hc.x, floorY + 0.12, hc.z, k * 0.63, 1, 1, 1, Math.PI / 2 - 0.15));
  fire(glowB, hc.x, floorY + 0.15, hc.z, 1, rnd);
  // гобелены на стенах между окнами
  const tap = [[-4.8, 0x6a1a2a, 0xd6a632], [-1.6, 0x1a3a5a, 0xe8d8a8], [1.6, 0x2a4a2a, 0xd6a632], [4.8, 0x5a2a5a, 0xe8d8a8]];
  for (const [lx, c1, c2] of tap) {
    for (const s of [1, -1]) {
      const lz = s * (hw - 0.05);
      if (s > 0 && Math.abs(lx - 6.4) < 1.5) continue;
      colorB.add(GEO.box, Mf(lx, 3.4, lz, 0.03, 2.6, 1.4), c1);
      colorB.add(GEO.box, Mf(lx, 3.4, lz - s * 0.012, 0.03, 2.2, 1.1), c2);
      colorB.add(GEO.box, Mf(lx, 3.4, lz - s * 0.024, 0.03, 1.9, 0.8), c1);
      wood.box(f.p(lx, floorY + 4.75, lz - s * 0.03), f.X, UP, f.N, 0.8, 0.035, 0.035, { grain: true });
    }
  }
  // кованые люстры со свечами над столами и настенные светильники
  for (const lx of [-2.2, 3.0]) {
    const c = f.p(lx, eaveY - 1.6, 0);
    ctx.metal.addGeometry(new THREE.TorusGeometry(0.7, 0.03, 5, 20).rotateX(Math.PI / 2), M(c.x, c.y, c.z));
    ctx.metal.addGeometry(new THREE.CylinderGeometry(0.01, 0.01, 1.45, 4), M(c.x, c.y + 0.72, c.z));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const p = c.clone().add(new V3(Math.cos(a) * 0.7, 0.08, Math.sin(a) * 0.7));
      colorB.add(GEO.cylLo, M(p.x, p.y, p.z, 0, 0.025, 0.14, 0.025), 0xe8e0c8);
      glowB.add(GEO.flame, M(p.x, p.y + 0.12, p.z, 0, 0.025, 0.07, 0.025), 0xffc860);
    }
  }
  for (const [lx, lz] of [[-5.6, hw - 0.1], [4.0, hw - 0.1], [-5.6, -hw + 0.1], [4.0, -hw + 0.1], [-1.6, -hw + 0.1]]) {
    const p = f.p(lx, floorY + 2.6, lz);
    ctx.metal.addGeometry(new THREE.CylinderGeometry(0.06, 0.04, 0.12, 8), M(p.x, p.y, p.z));
    glowB.add(GEO.flame, M(p.x, p.y + 0.2, p.z, 0, 0.07, 0.28, 0.07), 0xffa040);
  }
  // люди в зале: сеньор на троне (стоит у трона), дама, рыцари, слуги, менестрель
  // направление взгляда задаётся вектором в системе зала (dxL — вдоль зала, dzL — к фасаду)
  const pp = (lx, lz, dxL, dzL, role, pose = 'stand') => {
    const p = f.p(lx, 0, lz);
    const d = f.X.clone().multiplyScalar(dxL).addScaledVector(f.N, dzL);
    people.push({ x: p.x, y: floorY + 0.04 + (lx < -hl + 3.2 ? 0.4 : 0), z: p.z, yaw: Math.atan2(d.x, d.z), role, pose });
  };
  pp(dx - 0.05, 0, 1, 0, 'noble');
  pp(dx - 0.05, -1.3, 1, 0.2, 'townswoman');
  pp(dx + 0.1, 1.3, 1, -0.2, 'knight');
  for (const [lx, lz, dz] of [[-3, -3.1, 1], [-0.6, -3.1, 1], [1.8, -3.1, 1], [-1.8, 3.1, -1], [0.8, 3.1, -1], [3.2, 3.1, -1]]) pp(lx, lz, 0, dz, rnd() < 0.5 ? 'knight' : 'noble');
  pp(-2.5, 0, -1, 0, 'servant', 'walk');
  pp(4.2, -0.6, -1, 0.1, 'servant');
  pp(5.2, 1.2, -1, -0.6, 'merchant'); // менестрель
}

// ===========================================================================
// ОСАДНЫЙ ЛАГЕРЬ за рекой: шатры, требушет, таран, частокол, костры, воины
// ===========================================================================
function findCampSite(terrain, village) {
  let best = null;
  for (let x = -330; x <= 330; x += 15) {
    const zr = riverZ(x);
    for (let z = zr + 55; z <= zr + 190; z += 15) {
      const g = terrain.groundAt(x, z);
      if (g.road > 0.01) continue;
      let lo = Infinity, hi = -Infinity, bad = false;
      for (let k = 0; k < 10 && !bad; k++) {
        const a = (k / 10) * Math.PI * 2;
        for (const r of [14, 28]) {
          const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
          const h = terrain.heightAt(px, pz);
          lo = Math.min(lo, h); hi = Math.max(hi, h);
          if (village && village.exclude(px, pz)) bad = true;
          const rd = terrain.roadNearest(px, pz);
          if (rd && rd.d < 8) bad = true;
          if (Math.abs(pz - riverZ(px)) < riverHalfWidth(px) + 12) bad = true;
        }
      }
      if (bad) continue;
      const flat = hi - lo;
      const score = flat * 3 + Math.abs(Math.hypot(x, z - 60) - 360) * 0.02;
      if (!best || score < best.score) best = { x, z, score, flat };
    }
  }
  return best;
}

function siegeCamp(ctx, village) {
  const { terrain, wood, colorB, glowB, straw, people, rnd, metal } = ctx;
  const site = findCampSite(terrain, village);
  if (!site) return null;
  const { x: cx, z: cz } = site;
  const gh = (x, z) => terrain.heightAt(x, z);
  // лагерь «смотрит» на замок
  const face = Math.atan2(-cx, -(cz - 20));
  const fw = new V3(Math.sin(face), 0, Math.cos(face)), rt = new V3(Math.cos(face), 0, -Math.sin(face));
  const at = (f, r) => new V3(cx + fw.x * f + rt.x * r, 0, cz + fw.z * f + rt.z * r);
  const cloth = [0xd8ccb0, 0x3a5a2a, 0xc8a040, 0xb8ac90, 0x5a6a3a];
  // шатры
  const tents = [[-14, -10], [-14, 0], [-14, 10], [-4, -14], [-4, 14], [-22, -4], [-22, 6], [-8, -2]];
  tents.forEach(([f, r], i) => {
    const p = at(f, r), g = gh(p.x, p.z);
    const R = 1.8 + rnd() * 0.8, H = 2.6 + rnd() * 0.8;
    const c = cloth[i % cloth.length];
    if (i % 3 === 2) { // двускатная палатка
      const yaw = face + Math.PI / 2;
      colorB.add(new THREE.CylinderGeometry(1, 1, 1, 3, 1).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), M(p.x, g + H * 0.28, p.z, yaw, 2.2, H * 0.56, 1.6), c);
    } else {
      colorB.add(GEO.cone, M(p.x, g + H / 2, p.z, rnd() * 3, R, H, R), c);
      colorB.add(GEO.cone, M(p.x, g + H * 0.62, p.z, 0.3, R * 0.62, H * 0.08, R * 0.62), 0x2e4a26); // кайма
    }
    wood.addGeometry(new THREE.CylinderGeometry(0.04, 0.04, H + 0.8, 5), M(p.x, g + (H + 0.8) / 2, p.z));
    colorB.add(GEO.box, M(p.x + 0.35, g + H + 0.55, p.z, rnd() * 3, 0.7, 0.35, 0.02), i % 2 ? 0x2e4a26 : 0xc8a040);
  });
  // шатёр предводителя — большой, полосатый
  {
    const p = at(-20, -16), g = gh(p.x, p.z);
    for (let k = 0; k < 12; k++) {
      colorB.add(new THREE.CylinderGeometry(3.2, 3.2, 2.4, 2, 1, true, (k / 12) * Math.PI * 2, Math.PI / 6 + 0.01), M(p.x, g + 1.2, p.z), k % 2 ? 0x2e4a26 : 0xe0d4b0);
      colorB.add(new THREE.ConeGeometry(3.5, 2.2, 2, 1, true, (k / 12) * Math.PI * 2, Math.PI / 6 + 0.01), M(p.x, g + 3.5, p.z), k % 2 ? 0x2e4a26 : 0xe0d4b0);
    }
    wood.addGeometry(new THREE.CylinderGeometry(0.06, 0.06, 6, 6), M(p.x, g + 3, p.z));
    colorB.add(GEO.box, M(p.x + 0.7, g + 5.6, p.z, face, 1.3, 0.8, 0.02), 0xc8a040);
    people.push({ x: p.x + fw.x * 3.8, y: gh(p.x + fw.x * 3.8, p.z + fw.z * 3.8), z: p.z + fw.z * 3.8, yaw: face, role: 'knight' });
  }
  // требушет, нацеленный на замок
  {
    const p = at(8, -2), g = gh(p.x, p.z);
    const A = fw, R = rt;
    const B = (off, h, hx, hy, hz, ax = A, ay = UP, az = R) => wood.box(p.clone().addScaledVector(A, off.f || 0).addScaledVector(R, off.r || 0).setY(g + h), ax, ay, az, hx, hy, hz, { grain: true });
    for (const s of [-1, 1]) B({ r: s * 1.1 }, 0.25, 3.4, 0.2, 0.2); // продольные лежни
    for (const f of [-3, 0, 3]) B({ f }, 0.5, 0.2, 0.15, 1.35, A, UP, R); // поперечины
    // А-образные стойки к оси
    const axleY = g + 6.2;
    for (const s of [-1, 1]) {
      for (const d of [-1, 1]) {
        const foot = p.clone().addScaledVector(R, s * 1.1).addScaledVector(A, d * 2.6).setY(g + 0.4);
        const top = p.clone().addScaledVector(R, s * 1.1).setY(axleY);
        const dir = top.clone().sub(foot), len = dir.length();
        dir.normalize();
        wood.addGeometry(new THREE.BoxGeometry(0.28, len, 0.28), new THREE.Matrix4().compose(foot.clone().addScaledVector(dir, len / 2), new THREE.Quaternion().setFromUnitVectors(UP, dir), new V3(1, 1, 1)));
      }
    }
    metal.addGeometry(new THREE.CylinderGeometry(0.12, 0.12, 2.6, 8).rotateZ(Math.PI / 2), M(p.x, axleY, p.z, face));
    // метательный рычаг: длинное плечо опущено назад, короткое с противовесом поднято
    const arm = new V3().copy(A).multiplyScalar(-Math.cos(0.75)).addScaledVector(UP, -Math.sin(0.75)).normalize();
    const pivot = p.clone().setY(axleY);
    const armLen = 9.5, short = 2.6;
    const mid = pivot.clone().addScaledVector(arm, (armLen - short) / 2);
    wood.addGeometry(new THREE.BoxGeometry(0.34, armLen + short, 0.34), new THREE.Matrix4().compose(mid, new THREE.Quaternion().setFromUnitVectors(UP, arm), new V3(1, 1, 1)));
    const cwTop = pivot.clone().addScaledVector(arm, -short);
    wood.box(cwTop.clone().setY(cwTop.y - 1.2), A, UP, R, 0.9, 0.8, 0.8, { grain: true }); // ящик-противовес
    metal.box(cwTop.clone().setY(cwTop.y - 0.3), A, UP, R, 0.12, 0.3, 0.12);
    // праща и камни-снаряды
    const tip = pivot.clone().addScaledVector(arm, armLen);
    wood.addGeometry(new THREE.CylinderGeometry(0.015, 0.015, 2.2, 4), M(tip.x, tip.y - 1.0, tip.z));
    for (let k = 0; k < 7; k++) {
      const q = p.clone().addScaledVector(A, -4.5 + (rnd() - 0.5) * 1.5).addScaledVector(R, 2.5 + (rnd() - 0.5) * 1.5);
      ctx.stone.addGeometry(new THREE.DodecahedronGeometry(0.3 + rnd() * 0.12, 0), M(q.x, gh(q.x, q.z) + 0.3, q.z, rnd() * 3));
    }
    for (const [f, r, role] of [[-3.5, 2.2, 'foe'], [-2.5, -2.4, 'peasant'], [1.5, 2.3, 'foe']]) {
      const q = p.clone().addScaledVector(A, f).addScaledVector(R, r);
      people.push({ x: q.x, y: gh(q.x, q.z), z: q.z, yaw: face, role, pose: role === 'peasant' ? 'work' : 'stand' });
    }
  }
  // таран под навесом («черепаха»)
  {
    const p = at(4, 12), g = gh(p.x, p.z);
    const A = fw, R = rt;
    for (const s of [-1, 1]) for (const f of [-2, 2]) {
      const w = p.clone().addScaledVector(A, f).addScaledVector(R, s * 1.2);
      wood.addGeometry(new THREE.CylinderGeometry(0.45, 0.45, 0.2, 12).rotateZ(Math.PI / 2), M(w.x, g + 0.45, w.z, face));
      wood.box(w.clone().setY(g + 1.6), UP, A, R, 1.2, 0.1, 0.1, { grain: true });
    }
    for (const s of [-1, 1]) wood.box(p.clone().addScaledVector(R, s * 1.2).setY(g + 0.75), A, UP, R, 2.6, 0.12, 0.12, { grain: true });
    // двускатная крыша, обтянутая шкурами
    for (const s of [-1, 1]) {
      const c = p.clone().addScaledVector(R, s * 0.7).setY(g + 3.1);
      const ax = R.clone().multiplyScalar(s).addScaledVector(UP, -0.9).normalize();
      colorB.add(GEO.box, new THREE.Matrix4().makeBasis(A, ax, new V3().crossVectors(A, ax)).premultiply(new THREE.Matrix4()).setPosition(c).multiply(new THREE.Matrix4().makeScale(5.6, 1.9, 0.08)), 0x6a4a2a);
    }
    // бревно тарана на цепях с железным наконечником
    wood.addGeometry(new THREE.CylinderGeometry(0.28, 0.3, 6.4, 10).rotateX(Math.PI / 2), M(p.x, g + 1.4, p.z, face));
    const head = p.clone().addScaledVector(A, 3.3);
    metal.addGeometry(new THREE.ConeGeometry(0.34, 0.6, 10).rotateX(Math.PI / 2), M(head.x, g + 1.4, head.z, face));
  }
  // осадные лестницы у телеги
  for (const [f, r] of [[-2, 20], [-3.5, 20.5]]) {
    const p = at(f, r), g = gh(p.x, p.z);
    for (const s of [-1, 1]) wood.box(p.clone().addScaledVector(fw, s * 0.3).setY(g + 0.08), rt, UP, fw, 3.5, 0.05, 0.05, { grain: true });
    for (let k = -3; k <= 3; k++) wood.box(p.clone().addScaledVector(rt, k * 0.45).setY(g + 0.1), fw, UP, rt, 0.32, 0.03, 0.03, { grain: true });
  }
  // частокол со стороны реки (к замку)
  for (let k = -14; k <= 14; k++) {
    const p = at(18 + Math.abs(k) * 0.15, k * 1.3), g = gh(p.x, p.z);
    const lean = new THREE.Quaternion().setFromAxisAngle(rt, 0.35);
    wood.addGeometry(new THREE.CylinderGeometry(0.1, 0.12, 2.2, 6), new THREE.Matrix4().compose(p.clone().setY(g + 0.9), lean, new V3(1, 1, 1)));
    const tip = p.clone().addScaledVector(fw, 0.38).setY(g + 2.05);
    wood.addGeometry(new THREE.ConeGeometry(0.1, 0.35, 6), new THREE.Matrix4().compose(tip, lean, new V3(1, 1, 1)));
  }
  // костры с воинами
  for (const [f, r] of [[-8, 6], [-10, -8], [-18, 2]]) {
    const p = at(f, r), g = gh(p.x, p.z);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      ctx.stone.addGeometry(new THREE.DodecahedronGeometry(0.16, 0), M(p.x + Math.cos(a) * 0.6, g + 0.08, p.z + Math.sin(a) * 0.6, a));
    }
    for (let k = 0; k < 4; k++) wood.addGeometry(new THREE.CylinderGeometry(0.06, 0.07, 0.8, 6), M(p.x, g + 0.1, p.z, k * 0.8, 1, 1, 1, Math.PI / 2 - 0.2));
    fire(glowB, p.x, g + 0.1, p.z, 0.8, rnd);
    for (let k = 0; k < 3; k++) {
      const a = rnd() * Math.PI * 2;
      const q = new V3(p.x + Math.cos(a) * 1.6, 0, p.z + Math.sin(a) * 1.6);
      people.push({ x: q.x, y: gh(q.x, q.z), z: q.z, yaw: Math.atan2(p.x - q.x, p.z - q.z), role: k === 2 ? 'archer' : 'foe' });
    }
  }
  // часовые у частокола, стог сена, лошади
  for (const r of [-9, 0, 9]) {
    const p = at(15.5, r);
    people.push({ x: p.x, y: gh(p.x, p.z), z: p.z, yaw: face, role: 'foe' });
  }
  for (const [f, r, col] of [[-12, -20, 0x3a2418], [-12, -22.5, 0x8a6a4a]]) {
    const p = at(f, r);
    horse(colorB, p.x, gh(p.x, p.z), p.z, face + Math.PI / 2, col, rnd);
  }
  const hs = at(-15, -24);
  const g = new THREE.IcosahedronGeometry(1, 2);
  straw.addGeometry(g, M(hs.x, gh(hs.x, hs.z) + 0.5, hs.z, 0, 1.4, 0.9, 1.2));
  // знамёна осаждающих
  for (const [f, r] of [[12, -8], [12, 8], [-6, 0]]) {
    const p = at(f, r), gg = gh(p.x, p.z);
    wood.addGeometry(new THREE.CylinderGeometry(0.05, 0.05, 5, 5), M(p.x, gg + 2.5, p.z));
    colorB.add(GEO.box, M(p.x + rt.x * 0.55, gg + 4.4, p.z + rt.z * 0.55, face + Math.PI / 2, 1.1, 1.4, 0.02), 0x2e4a26);
    colorB.add(GEO.box, M(p.x + rt.x * 0.56, gg + 4.4, p.z + rt.z * 0.56, face + Math.PI / 2, 0.4, 0.9, 0.025), 0xc8a040);
  }
  return { x: cx, z: cz, face, fw, rt, at, gh };
}

// ===========================================================================
export function createExtras(scene, terrain, walls, village) {
  const rnd = mulberry32(5151);
  const wood = new GeoBuilder(walls.woodMaterial.userData.tileMeters);
  const stone = new GeoBuilder(walls.stoneMaterial.userData.tileMeters);
  const metal = new GeoBuilder(1), straw = new GeoBuilder(1);
  const colorB = new ColorBuilder(), glowB = new ColorBuilder();
  const people = [];
  const ctx = { terrain, wood, stone, metal, straw, colorB, glowB, people, rnd };
  hallInterior(ctx);
  const camp = siegeCamp(ctx, village);
  const iron = new THREE.MeshStandardMaterial({ color: 0x2c2926, metalness: 0.85, roughness: 0.5 });
  const colorMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  // огонь, свечи, пламя костров — светятся сами (без источников света)
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  for (const [bld, mat, name] of [
    [wood, walls.woodMaterial, 'extras'], [stone, walls.stoneMaterial, 'extras'], [metal, iron, 'extras'],
    [straw, strawMaterial(), 'extras'], [colorB, colorMat, 'extras'], [glowB, glowMat, 'extras-glow'],
  ]) {
    if (!bld.pos.length) continue;
    const m = new THREE.Mesh(bld.build(), mat);
    m.castShadow = name !== 'extras-glow';
    m.receiveShadow = true;
    m.name = name;
    scene.add(m);
  }
  const peopleUpd = createPeople(scene, people);
  const walkers = createWalkers(scene, terrain, walls);
  const birds = createBirds(scene);
  return {
    camp,
    birds,
    update(t, dt) {
      peopleUpd.update(t);
      walkers.update(Math.min(dt, 0.1));
      birds.update(t);
    },
    setNight(k) { birds.mesh.visible = k < 0.5; },
  };
}
