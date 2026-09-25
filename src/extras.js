// Оживление сцены: ходящие люди и лошадь, стая птиц над башнями, интерьер
// большого зала и осадный лагерь за рекой. Всё собирается в немногие сетки
// (один объект на материал), движение считает шейдер — FPS почти не меняется.
import * as THREE from 'three';
import { GeoBuilder } from './walls.js';
import { ColorBuilder, person, createPeople, SWAY_TIME, TAIL_GLSL, addTailSway } from './people.js';
import { horse } from './yard.js';
import { HALL, Frame, strawMaterial, Smoke, cart, haystack } from './courtyard.js';
import { KEEP, TOWERS, WELL, BUILDINGS, riverZ, riverHalfWidth, GATEHOUSE, GATE_PASSAGE, BARBICAN, RIVER } from './layout.js';
import { WINDOWS } from './towers.js';
import { mulberry32 } from './noise.js';
import { createLife3 } from './life3.js';

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
  bush: new THREE.SphereGeometry(1, 6, 4),
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
    sh.uniforms.uSwayTime = SWAY_TIME;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aLimb;\nattribute vec2 aSway;\nuniform float uPhase;\nuniform float uAmp;\nuniform float uSwayTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${TAIL_GLSL}
        // колено: нога, уходящая назад, сгибается (для ног |aLimb.x| >= 0.7)
        if (abs(aLimb.x) > 0.65) {
          float kneeY = aLimb.y * (abs(aLimb.x) > 0.95 ? 0.5 : 0.59);
          if (transformed.y < kneeY) {
            float kb = max(0.0, -sin(uPhase + 0.9) * sign(aLimb.x)) * 0.75 * uAmp / 0.45;
            float c = cos(kb), s = sin(kb);
            vec3 q = transformed; q.y -= kneeY;
            transformed = vec3(q.x, q.y * c - q.z * s + kneeY, q.y * s + q.z * c);
          }
        }
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

const WALKERS = []; // все ходящие — вдали от камеры не рисуются
function makeWalker(scene, build, path, { speed = 1.1, loop = true, stride = 1.5, amp = 0.45, y = null, s0 = null, hold = null } = {}) {
  const B = new ColorBuilder();
  build(B);
  const { mat, uPhase, uAmp } = walkerMaterial();
  uAmp.value = amp;
  const mesh = new THREE.Mesh(B.build(), mat);
  mesh.receiveShadow = true;
  mesh.name = 'walker';
  scene.add(mesh);
  WALKERS.push(mesh);
  // длины участков пути
  const pts = loop ? [...path, path[0]] : path;
  const seg = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) { const l = pts[i].distanceTo(pts[i + 1]); seg.push(l); total += l; }
  let s = s0 !== null ? s0 : Math.random() * total, dir = 1;
  const pos = new V3();
  return {
    mesh,
    update(dt, heightAt) {
      const waiting = hold && hold(s, dir, total);
      if (!waiting) s += dt * speed * dir;
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
      if (!waiting) uPhase.value += dt * speed / stride * Math.PI * 2;
    },
  };
}

function createWalkers(scene, terrain, walls, ctx = {}) {
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
  // слуги с блюдами ходят по проходу между столами в зале
  if (ctx.hallAisle) {
    const { f, floorY, x0, x1 } = ctx.hallAisle;
    const a = f.p(x0, floorY + 0.04, -0.2), b = f.p(x1, floorY + 0.04, 0.2);
    for (const [seed, off] of [[311, 0], [312, 1]]) {
      const w = makeWalker(scene, (B) => person(B, { x: 0, y: 0, z: 0, yaw: 0, role: 'servant', seed, item: 'tray' }), off ? [b, a] : [a, b], { loop: false, speed: 0.9, y: true });
      out.push(w);
    }
  }
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
  if (ctx.scene) ctx.smokes.push(new Smoke(ctx.scene, new V3(hc.x, floorY + 1.2, hc.z), { count: 10, alpha: 0.18, size: 0.6, grow: 2.5, rise: 1.1, life: 6, color: 0x8a8680 }));
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
  // пир: сеньор с семьёй за высоким столом, рыцари и гости сидят на лавках
  const seat = (lx, lz, dxL, dzL, role, y) => {
    const p = f.p(lx, 0, lz);
    const d = f.X.clone().multiplyScalar(dxL).addScaledVector(f.N, dzL);
    people.push({ x: p.x, y, z: p.z, yaw: Math.atan2(d.x, d.z), role, pose: 'sit' });
  };
  const chairY = floorY + 0.4 + 0.25;
  seat(dx - 0.3, 0, 1, 0, 'noble', chairY);
  seat(dx - 0.3, -1.3, 1, 0, 'townswoman', chairY);
  seat(dx - 0.3, 1.3, 1, 0, 'knight', chairY);
  const benchY = floorY + 0.04;
  for (const tz of [-2.2, 2.2]) {
    for (const s of [-1, 1]) {
      for (let lx = -hl + 4.8; lx < hl - 3.2; lx += 1.45) {
        if (rnd() < 0.25) continue;
        const roles = ['knight', 'noble', 'knight', 'townswoman', 'guard', 'merchant'];
        seat(lx + (rnd() - 0.5) * 0.3, tz + s * 0.85, 0, -s, roles[Math.floor(rnd() * roles.length)], benchY);
      }
    }
  }
  pp(5.0, 1.0, -1, -0.6, 'minstrel'); // менестрель с лютней у очага
  pp(-hl + 3.6, -3.4, 1, 0.3, 'servant'); // виночерпий
  ctx.hallAisle = { f, floorY, x0: -hl + 3.6, x1: hl - 2.2 };
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
    // метательный рычаг: длинное плечо опущено назад, короткое с противовесом поднято.
    // Рычаг собирается отдельно (вокруг оси) — при «штурме» он делает бросок.
    const arm = new V3().copy(A).multiplyScalar(-Math.cos(0.75)).addScaledVector(UP, -Math.sin(0.75)).normalize();
    const pivot = p.clone().setY(axleY);
    const armLen = 9.5, short = 2.6;
    const aw = ctx.armWood, am = ctx.armMetal;
    const mid = pivot.clone().addScaledVector(arm, (armLen - short) / 2);
    aw.addGeometry(new THREE.BoxGeometry(0.34, armLen + short, 0.34), new THREE.Matrix4().compose(mid, new THREE.Quaternion().setFromUnitVectors(UP, arm), new V3(1, 1, 1)));
    const cwTop = pivot.clone().addScaledVector(arm, -short);
    aw.box(cwTop.clone().setY(cwTop.y - 1.2), A, UP, R, 0.9, 0.8, 0.8, { grain: true }); // ящик-противовес
    am.box(cwTop.clone().setY(cwTop.y - 0.3), A, UP, R, 0.12, 0.3, 0.12);
    const tip = pivot.clone().addScaledVector(arm, armLen);
    aw.addGeometry(new THREE.CylinderGeometry(0.015, 0.015, 2.2, 4), M(tip.x, tip.y - 1.0, tip.z));
    ctx.treb = { pivot, A, R, arm, armLen, face };
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
// ШТУРМ: требушет мечет камни в стену (пыль и обломки при ударе), лучники со
// стен стреляют по подступам, из машикулей над воротами льют кипящую смолу
// ===========================================================================
function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
class Puffs {
  constructor(scene, count, color) {
    const tex = puffTexture();
    this.items = [];
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, opacity: 0, fog: true }));
      s.visible = false;
      s.renderOrder = 6;
      scene.add(s);
      this.items.push({ s, life: 0, age: 1, v: new V3(), size: 1, grow: 1, a: 0.6 });
    }
    this.next = 0;
  }
  spawn(pos, vel, size, grow, life, alpha = 0.6) {
    const it = this.items[this.next++ % this.items.length];
    it.s.position.copy(pos);
    it.v.copy(vel);
    Object.assign(it, { size, grow, life, age: 0, a: alpha });
    it.s.visible = true;
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.s.visible) continue;
      it.age += dt;
      const u = it.age / it.life;
      if (u >= 1) { it.s.visible = false; continue; }
      it.s.position.addScaledVector(it.v, dt);
      it.v.multiplyScalar(1 - dt * 0.8);
      const sc = it.size + it.grow * u;
      it.s.scale.set(sc, sc, 1);
      it.s.material.opacity = it.a * Math.min(1, u * 6) * Math.pow(1 - u, 1.3); // быстро появляется, медленно тает
    }
  }
}

function createSiege(scene, ctx, walls, terrain, armMats) {
  const T = ctx.treb;
  if (!T) return null;
  const gh = terrain.heightAt;
  // рычаг требушета — отдельная группа вокруг оси
  const armGrp = new THREE.Group();
  armGrp.position.copy(T.pivot);
  for (const [b, mat] of [[ctx.armWood, armMats.wood], [ctx.armMetal, armMats.iron]]) {
    if (!b.pos.length) continue;
    const g = b.build();
    g.translate(-T.pivot.x, -T.pivot.y, -T.pivot.z);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = false; // движется — не участвует в (кэшированных) тенях
    m.receiveShadow = true;
    m.name = 'extras';
    armGrp.add(m);
  }
  scene.add(armGrp);
  // знак поворота: при броске длинное плечо идёт вверх
  const test = T.arm.clone().applyAxisAngle(T.R, 0.1);
  const sgn = test.y > T.arm.y ? 1 : -1;
  const THROW = 2.75, RELEASE = 2.0;
  const armDirAt = (ang) => T.arm.clone().applyAxisAngle(T.R, sgn * ang);

  // цель — внешняя сторона стены, обращённая к лагерю
  const toCamp = new V3(T.pivot.x, 0, T.pivot.z).normalize();
  let best = -1, target = new V3();
  const Pw = walls.points, Nw = walls.segNrm, Wk = walls.walk;
  for (let i = 1; i < Pw.length - 2; i++) {
    const d = Nw[i].dot(toCamp);
    if (d > best) { best = d; target = Pw[i].clone().lerp(Pw[i + 1], 0.5).addScaledVector(Nw[i], 1.3).setY((Wk[i] + Wk[i + 1]) / 2 - 3.5); }
  }
  const stoneGeo = new THREE.DodecahedronGeometry(0.45, 1);
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a8278, roughness: 1 });
  const rock = new THREE.Mesh(stoneGeo, stoneMat);
  rock.visible = false;
  scene.add(rock);
  const dust = new Puffs(scene, 26, 0x9a8a76);
  const steam = new Puffs(scene, 14, 0xd8d4cc);
  // обломки
  const debrisN = 12;
  const deb = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.16, 0), stoneMat, debrisN);
  deb.frustumCulled = false;
  deb.visible = false;
  scene.add(deb);
  const debris = Array.from({ length: debrisN }, () => ({ p: new V3(), v: new V3(), rest: false }));

  // стрелы со стен
  const nArrows = 14;
  const arrowGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.9, 4).rotateX(Math.PI / 2);
  const arrows = new THREE.InstancedMesh(arrowGeo, new THREE.MeshBasicMaterial({ color: 0x2a2018 }), nArrows);
  arrows.frustumCulled = false;
  arrows.visible = false;
  scene.add(arrows);
  const shooters = [];
  for (let i = 1; i < Pw.length - 2; i++) {
    if (Nw[i].dot(toCamp) > 0.2) {
      const c = Pw[i].clone().lerp(Pw[i + 1], 0.5);
      shooters.push(c.addScaledVector(Nw[i], 0.8).setY((Wk[i] + Wk[i + 1]) / 2 + 1.6));
    }
  }
  if (!shooters.length) shooters.push(new V3(0, 95, 40));
  const arrowSt = Array.from({ length: nArrows }, () => ({ p0: new V3(), v: new V3(), t: 0, dur: 0, stuck: 0, on: false }));
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new V3(), fwd = new V3(0, 0, 1);

  // смола из машикулей над воротами
  const P = GATE_PASSAGE, G = GATEHOUSE;
  const platY = walls.walkAt(G.node.x, G.node.z) + G.extra;
  const pitchTop = new V3(G.x + 0.9, platY - 0.2, P.frontZ + (G.corbelOut || 0.6) * 0.6);
  const pitchBottom = P.thresholdY + 0.05;
  const pitchMat = new THREE.MeshBasicMaterial({ color: 0x160c05, fog: true });
  const pitch = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.26, 1, 8).translate(0, -0.5, 0), pitchMat);
  pitch.position.copy(pitchTop);
  pitch.visible = false;
  scene.add(pitch);
  const G_ACC = 14;

  let active = false, clock = 0, flight = null, arrowClock = 0, pitchClock = 0;
  function launch() {
    const p0 = T.pivot.clone().addScaledVector(armDirAt(RELEASE), T.armLen);
    const dur = 5.6; // выше дуга полёта
    const aim = target.clone().add(new V3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3));
    const v = aim.clone().sub(p0).divideScalar(dur).add(new V3(0, 0.5 * G_ACC * dur, 0));
    flight = { p0, v, t: 0, dur, aim };
    rock.visible = true;
  }
  function impact(at) {
    rock.visible = false;
    for (let k = 0; k < 14; k++) {
      const v = new V3((Math.random() - 0.5) * 6, 1 + Math.random() * 4, (Math.random() - 0.5) * 6).addScaledVector(toCamp, 2);
      dust.spawn(at.clone().add(new V3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2)), v, 1.5 + Math.random() * 1.5, 6 + Math.random() * 4, 3 + Math.random() * 2, 0.55);
    }
    deb.visible = true;
    for (const d of debris) {
      d.p.copy(at);
      d.v.set((Math.random() - 0.5) * 7, 2 + Math.random() * 5, (Math.random() - 0.5) * 7).addScaledVector(toCamp, 3 + Math.random() * 3);
      d.rest = false;
    }
  }
  function shootArrow() {
    const a = arrowSt.find((x) => !x.on);
    if (!a) return;
    const from = shooters[Math.floor(Math.random() * shooters.length)];
    const to = new V3((Math.random() - 0.5) * 30, 0, BARBICAN.zS + 8 + Math.random() * 45);
    to.y = gh(to.x, to.z);
    const dur = 1.6 + Math.random() * 0.8;
    a.p0.copy(from);
    a.v.copy(to).sub(from).divideScalar(dur).add(new V3(0, 0.5 * 9.8 * dur, 0));
    Object.assign(a, { t: 0, dur, stuck: 0, on: true });
  }

  return {
    target,
    toCamp,
    get active() { return active; },
    toggle() {
      active = !active;
      if (active) { clock = 0; arrows.visible = true; }
      return active;
    },
    update(dt) {
      dust.update(dt);
      steam.update(dt);
      // требушет: цикл 11 с — бросок, пауза, медленный взвод
      if (active || clock > 0) {
        clock += dt;
        const c = clock % 11;
        let ang;
        if (c < 0.9) { const u = c / 0.9; ang = THROW * u * u; } else if (c < 2) ang = THROW; else if (c < 8) { const u = (c - 2) / 6; ang = THROW * (1 - u * u * (3 - 2 * u)); } else ang = 0;
        if (c >= 0.9 * Math.sqrt(RELEASE / THROW) && !flight && c < 1.2) launch();
        armGrp.quaternion.setFromAxisAngle(T.R, sgn * ang);
        if (!active && c >= 8) clock = 0; // остановились во взведённом положении
      }
      if (flight) {
        flight.t += dt;
        const t = flight.t;
        rock.position.copy(flight.p0).addScaledVector(flight.v, t).add(new V3(0, -0.5 * G_ACC * t * t, 0));
        rock.rotation.x += dt * 5;
        if (t >= flight.dur) { impact(flight.aim); flight = null; }
      }
      if (deb.visible) {
        let moving = false;
        debris.forEach((d, i) => {
          if (!d.rest) {
            d.v.y -= 9.8 * dt;
            d.p.addScaledVector(d.v, dt);
            const g = gh(d.p.x, d.p.z) + 0.1;
            if (d.p.y < g) { d.p.y = g; d.rest = true; } else moving = true;
          }
          deb.setMatrixAt(i, tmpM.makeTranslation(d.p.x, d.p.y, d.p.z));
        });
        deb.instanceMatrix.needsUpdate = true;
        if (!moving && !active) deb.visible = false;
      }
      // стрелы
      if (active) {
        arrowClock -= dt;
        if (arrowClock <= 0) { shootArrow(); arrowClock = 0.25 + Math.random() * 0.4; }
      }
      let anyArrow = false;
      arrowSt.forEach((a, i) => {
        if (!a.on) { arrows.setMatrixAt(i, tmpM.makeScale(0, 0, 0)); return; }
        anyArrow = true;
        let p, dir;
        if (a.t < a.dur) {
          a.t += dt;
          const t = Math.min(a.t, a.dur);
          p = a.p0.clone().addScaledVector(a.v, t).add(new V3(0, -4.9 * t * t, 0));
          dir = a.v.clone().add(new V3(0, -9.8 * t, 0)).normalize();
          a.last = p; a.dir = dir;
        } else {
          a.stuck += dt;
          p = a.last; dir = a.dir;
          if (a.stuck > 4) a.on = false;
        }
        tmpQ.setFromUnitVectors(fwd, dir);
        arrows.setMatrixAt(i, tmpM.compose(p, tmpQ, tmpV.set(1, 1, 1)));
      });
      arrows.instanceMatrix.needsUpdate = true;
      if (!anyArrow && !active) arrows.visible = false;
      // кипящая смола: льётся 3 с каждые 12 с, внизу пар
      if (active) pitchClock += dt; else pitchClock = 0;
      const pc = pitchClock % 12;
      const pouring = active && pc > 3 && pc < 6.5;
      pitch.visible = pouring;
      if (pouring) {
        const len = Math.min(1, (pc - 3) / 0.6) * (pitchTop.y - pitchBottom);
        pitch.scale.set(1, Math.max(0.01, len), 1);
        if (Math.random() < dt * 10) steam.spawn(new V3(pitchTop.x + (Math.random() - 0.5), pitchBottom + 0.3, pitchTop.z + (Math.random() - 0.5)), new V3(0, 1.4, 0), 0.8, 3, 2.5, 0.45);
      }
    },
  };
}


// ===========================================================================
// ЖИЗНЬ ВОКРУГ: лодка с рыбаком, гуси у воды, коровы на пастбище, брызги
// у мельничного колеса, огни в окнах ночью
// ===========================================================================
function cow(B, x, y, z, yaw, rnd, color = null) {
  const r = M(x, y, z, yaw);
  const L = (px, py, pz, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) =>
    r.clone().multiply(new THREE.Matrix4().compose(new V3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)), new V3(sx, sy, sz)));
  const spotted = color === null && rnd() < 0.5;
  const base = color !== null ? color : spotted ? 0xe8e2d8 : [0x6a4028, 0x8a5a34, 0x4a3020][Math.floor(rnd() * 3)];
  B.add(new THREE.CapsuleGeometry(0.42, 1.0, 5, 12).rotateX(Math.PI / 2), L(0, 1.05, 0, 1, 1.05, 1), base);
  if (spotted) for (let k = 0; k < 5; k++) B.add(GEO.sph, L((rnd() - 0.5) * 0.7, 1.1 + (rnd() - 0.3) * 0.5, (rnd() - 0.5) * 1.3, 0.25, 0.22, 0.3), 0x1e1a18);
  const graze = rnd() < 0.6;
  const hy = graze ? 0.45 : 1.15, hz = graze ? 1.05 : 1.0;
  B.add(new THREE.CylinderGeometry(0.2, 0.3, 0.6, 10), L(0, (hy + 1.2) / 2, 0.8, 1, 1, 1, graze ? 1.0 : 0.5), base);
  B.add(GEO.box, L(0, hy, hz, 0.3, 0.32, 0.5, graze ? 0.7 : 0.1), base);
  B.add(GEO.box, L(0, hy - (graze ? 0.12 : 0.05), hz + (graze ? 0.2 : 0.26), 0.26, 0.2, 0.16, graze ? 0.7 : 0.1), 0xc89a8a);
  for (const sd of [-1, 1]) {
    B.add(GEO.cone, L(sd * 0.16, hy + 0.2, hz - 0.12, 0.035, 0.18, 0.035, 0, sd * -0.9), 0xe0d8c0);
    B.add(GEO.box, L(sd * 0.2, hy + 0.08, hz - 0.1, 0.14, 0.05, 0.08), base);
  }
  for (const [lx, lz] of [[-0.22, 0.55], [0.22, 0.55], [-0.22, -0.6], [0.22, -0.6]]) {
    B.curLimb = [(lx < 0) === (lz > 0) ? 0.7 : -0.7, 0.72]; // для ходьбы (волы в упряжке)
    B.add(GEO.cylLo, L(lx, 0.36, lz, 0.075, 0.72, 0.075), base);
    B.add(GEO.cylLo, L(lx, 0.04, lz, 0.08, 0.08, 0.08), 0x2a2420);
  }
  B.curLimb = [0, 0];
  B.add(GEO.sph, L(0, 0.6, -0.35, 0.2, 0.14, 0.2), 0xd8a0a0); // вымя
  const tailRoot = y + 1.3;
  B.add(GEO.cylLo, L(0, 0.95, -0.98, 0.03, 0.7, 0.03), base, 2, tailRoot);
  B.add(GEO.sph, L(0, 0.58, -0.98, 0.06, 0.12, 0.06), 0x1e1a18, 2, tailRoot);
}

function createCountryLife(scene, ctx, village) {
  const { terrain, colorB, rnd } = ctx;
  const gh = terrain.heightAt;
  const movers = [];
  if (!village) return { update() {} };
  const br = village.bridge;
  // --- лодка с рыбаком: неспешно ходит вдоль реки ниже моста ---
  {
    const path = [];
    for (let k = 0; k <= 8; k++) {
      const x = br.a.x + 30 + k * 14;
      const z = riverZ(x) + Math.sin(k * 0.9) * 2;
      path.push(new V3(x, RIVER.waterLevel + 0.05, z));
    }
    const hull = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    const w = makeWalker(scene, (B) => {
      B.add(hull, M(0, 0.32, 0, 0, 0.72, 0.42, 2.3), 0x5a3a1e);
      B.add(GEO.box, M(0, 0.3, 0, 0, 1.36, 0.04, 4.1), 0x3a2414);
      B.add(GEO.box, M(0, 0.45, 0.6, 0, 1.3, 0.05, 0.25), 0x6a4a2a);
      for (const sd of [-1, 1]) B.add(GEO.cylLo, M(sd * 1.0, 0.45, 0.3, 0, 0.02, 1.9, 0.02, 1.2, sd * 1.1), 0x6a4a2a);
      person(B, { x: 0, y: 0.32, z: -0.7, yaw: Math.PI / 2, role: 'servant', seed: 401, pose: 'work' });
      B.add(GEO.cylLo, M(1.3, 1.9, -0.7, 0, 0.012, 3.0, 0.012, 0, -0.9), 0x6a4a2a); // удочка
      B.add(GEO.cylLo, M(2.55, 1.2, -0.7, 0, 0.003, 2.0, 0.003), 0xe0e0e0); // леска
    }, path, { speed: 0.7, loop: false, amp: 0, y: true });
    w.mesh.receiveShadow = true;
    movers.push({ w, bob: 0.06 });
  }
  // --- гуси бродят у берега ---
  {
    const x0 = br.a.x - 20;
    const ring = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const x = x0 + Math.cos(a) * 6;
      const zb = riverZ(x) - (riverHalfWidth(x) + 4) + Math.sin(a) * 2.5;
      ring.push(new V3(x, 0, zb));
    }
    for (let i = 0; i < 5; i++) {
      const w = makeWalker(scene, (B) => {
        B.curLimb = [0, 0];
        B.add(GEO.sph, M(0, 0.32, 0, 0, 0.17, 0.16, 0.28), 0xf0ece4);
        B.add(GEO.cyl, M(0, 0.5, 0.2, 0, 0.045, 0.3, 0.045, -0.35), 0xf0ece4);
        B.add(GEO.sph, M(0, 0.66, 0.27, 0, 0.065, 0.06, 0.08), 0xf0ece4);
        B.add(GEO.cone, M(0, 0.65, 0.37, 0, 0.025, 0.09, 0.025, Math.PI / 2), 0xe08a20);
        for (const sd of [-1, 1]) { B.curLimb = [sd, 0.18]; B.add(GEO.cylLo, M(sd * 0.06, 0.09, 0, 0, 0.012, 0.18, 0.012), 0xe08a20); }
        B.curLimb = [0, 0];
      }, ring, { speed: 0.35, stride: 0.25, amp: 0.4 });
      movers.push({ w });
    }
  }
  // --- коровы на пастбище у деревни ---
  {
    let center = null;
    // ровный луг недалеко от моста, не на полях и не у домов (ищем всё шире)
    for (let k = 0; k < 3000 && !center; k++) {
      const spread = 120 + k * 0.12;
      const x = br.b.x + (rnd() - 0.5) * spread * 2, z = br.b.z + (rnd() - 0.5) * spread * 2;
      const g = terrain.groundAt(x, z);
      if (village.exclude(x, z) || g.slope > 0.2 || g.road > 0.01) continue;
      if (Math.abs(z - riverZ(x)) < riverHalfWidth(x) + 10) continue;
      if (Math.hypot(x, z) < 150) continue; // не на склоне замкового холма
      let ok = true;
      for (let j = 0; j < 8 && ok; j++) {
        const a = (j / 8) * Math.PI * 2;
        const px = x + Math.cos(a) * 9, pz = z + Math.sin(a) * 9;
        if (village.exclude(px, pz) || terrain.groundAt(px, pz).slope > 0.25 || Math.abs(pz - riverZ(px)) < riverHalfWidth(px) + 6) ok = false;
      }
      if (ok) center = new V3(x, 0, z);
    }
    if (center) {
      for (let i = 0; i < 6; i++) {
        const x = center.x + (rnd() - 0.5) * 16, z = center.z + (rnd() - 0.5) * 16;
        cow(colorB, x, gh(x, z) - 0.02, z, rnd() * Math.PI * 2, rnd);
      }
      const p = center.clone().add(new V3(6, 0, -5));
      ctx.people.push({ x: p.x, y: gh(p.x, p.z), z: p.z, yaw: rnd() * 6, role: 'peasant' }); // пастух
      ctx.pasture = center;
    }
  }
  // --- брызги у мельничного колеса ---
  const mw = village.millWheel;
  const spray = mw ? new Puffs(scene, 22, 0xe8f0f4) : null;
  let sprayClock = 0;
  return {
    update(t, dt) {
      for (const m of movers) {
        m.w.update(dt, gh);
        if (m.bob) { m.w.mesh.position.y += Math.sin(t * 1.3) * m.bob; m.w.mesh.rotation.z = Math.sin(t * 1.1) * 0.03; }
      }
      if (spray) {
        sprayClock -= dt;
        if (sprayClock <= 0) {
          sprayClock = 0.12;
          const p = mw.c.clone().addScaledVector(mw.f.N, (Math.random() - 0.5) * 1.2);
          p.y = RIVER.waterLevel + 0.25;
          p.addScaledVector(mw.f.X, (Math.random() - 0.3) * mw.r * 0.8);
          spray.spawn(p, new V3((Math.random() - 0.5) * 0.8, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 0.8), 0.4, 1.4, 1.2, 0.35);
        }
        spray.update(dt);
      }
    },
  };
}

// Огни в окнах (башни, донжон, дома деревни) — включаются ночью
function createWindowLights(scene) {
  if (!WINDOWS.length) return { set() {} };
  const g = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffb04a, fog: true });
  const im = new THREE.InstancedMesh(g, mat, WINDOWS.length);
  const q = new THREE.Quaternion();
  WINDOWS.forEach((w, i) => {
    q.setFromUnitVectors(new V3(0, 0, 1), w.n);
    const flick = 0.75 + Math.random() * 0.25;
    im.setMatrixAt(i, new THREE.Matrix4().compose(w.c.clone().addScaledVector(w.n, 0.045), q, new V3(w.w * 0.92, w.h * 0.92, 1)));
    im.setColorAt(i, new THREE.Color(1, 0.8 * flick, 0.45 * flick).multiplyScalar(flick));
  });
  im.visible = false;
  im.name = 'window-lights';
  scene.add(im);
  return { set(k) { im.visible = k > 0.35; } };
}

// ===========================================================================
// ВОКРУГ ЗАМКА: рыцарский турнир, отряд всадников на дороге, работы в поле,
// валуны и кусты у дороги, развалины для «замка сегодня»
// ===========================================================================
function findFlat(terrain, village, { cx, cz, spread, needR, avoid = [], minCastle = 150 }, rnd) {
  for (let k = 0; k < 4000; k++) {
    const sp = spread * (0.4 + k / 4000);
    const x = cx + (rnd() - 0.5) * sp * 2, z = cz + (rnd() - 0.5) * sp * 2;
    if (Math.hypot(x, z) < minCastle) continue;
    if (avoid.some((a) => Math.hypot(x - a.x, z - a.z) < a.r + needR)) continue;
    let ok = true, lo = Infinity, hi = -Infinity;
    for (let j = 0; j < 16 && ok; j++) {
      const a = (j / 16) * Math.PI * 2;
      for (const r of [needR * 0.5, needR]) {
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        const h = terrain.heightAt(px, pz);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
        if (village.exclude(px, pz) || Math.abs(pz - riverZ(px)) < riverHalfWidth(px) + 8) ok = false;
        const rd = terrain.roadNearest(px, pz);
        if (rd && rd.d < 6) ok = false;
      }
    }
    if (ok && hi - lo < needR * 0.12) return new V3(x, 0, z);
  }
  return null;
}

function riderBuild(B, { horseCol, role, seed, item, caparison, rnd }) {
  horse(B, 0, 0, 0, 0, horseCol, rnd);
  if (caparison) { // попона до земли — турнирный наряд коня
    B.add(new THREE.CylinderGeometry(0.46, 0.5, 0.9, 16, 1, true).rotateX(Math.PI / 2).scale(1, 1.15, 1.25), M(0, 1.05, 0), caparison);
  }
  person(B, { x: 0, y: 1.28, z: 0.02, yaw: 0, role, seed, pose: 'ride', item });
}

function createLife2(scene, ctx, village, walls) {
  const { terrain, wood, stone, colorB, straw, people, rnd } = ctx;
  const gh = terrain.heightAt;
  const movers = [];
  const out = { update() {}, setGate() {} };
  if (!village) return out;
  const br = village.bridge;
  const avoid = [];
  if (ctx.pasture) avoid.push({ x: ctx.pasture.x, z: ctx.pasture.z, r: 20 });
  if (ctx.campSite) avoid.push({ x: ctx.campSite.x, z: ctx.campSite.z, r: 40 });

  // ---------------- рыцарский турнир ----------------
  const T = findFlat(terrain, village, { cx: br.b.x + 60, cz: br.b.z + 40, spread: 220, needR: 34, avoid }, rnd);
  if (T) {
    ctx.tourney = T;
    const U = new V3(1, 0, 0.35).normalize(), Vn = new V3(-U.z, 0, U.x);
    const at = (u, v) => T.clone().addScaledVector(U, u).addScaledVector(Vn, v);
    const yawU = Math.atan2(U.x, U.z);
    // барьер между всадниками: столбы и полосатая перекладина
    for (let u = -26; u <= 26; u += 2.6) {
      const p = at(u, 0), g = gh(p.x, p.z);
      wood.box(p.clone().setY(g + 0.7), UP, U, Vn, 0.7, 0.07, 0.07, { grain: true });
      if (u < 26) {
        const c = at(u + 1.3, 0);
        colorB.add(GEO.box, M(c.x, gh(c.x, c.z) + 1.35, c.z, yawU, 0.09, 0.14, 2.6), Math.round((u + 26) / 2.6) % 2 ? 0x1d3f8a : 0xe8e0c8);
      }
    }
    // ограда ристалища
    for (const v of [-11, 11]) for (let u = -32; u <= 32; u += 3.2) {
      const p = at(u, v), g = gh(p.x, p.z);
      wood.box(p.clone().setY(g + 0.55), UP, U, Vn, 0.55, 0.06, 0.06, { grain: true });
      if (u < 32) { const c = at(u + 1.6, v); wood.box(c.clone().setY(gh(c.x, c.z) + 0.95), U, UP, Vn, 1.62, 0.04, 0.04, { grain: true }); }
    }
    // трибуна со зрителями и навесом
    const stand = (v0, face) => {
      for (let tier = 0; tier < 3; tier++) {
        const v = v0 + face * tier * 0.9;
        for (let u = -10; u <= 10; u += 2) {
          const p = at(u, v), g = gh(p.x, p.z);
          wood.box(p.clone().setY(g + 0.3 + tier * 0.55), U, UP, Vn, 1.02, 0.05, 0.42, { grain: true });
          wood.box(p.clone().setY(g + (0.3 + tier * 0.55) / 2), UP, U, Vn, (0.3 + tier * 0.55) / 2, 0.06, 0.06, { grain: true });
          const roles = ['noble', 'townswoman', 'peasant', 'townswoman', 'merchant', 'child', 'knight'];
          if (rnd() < 0.75) {
            const q = p.clone().addScaledVector(U, (rnd() - 0.5) * 1.2);
            people.push({ x: q.x, y: g + tier * 0.55 + 0.35, z: q.z, yaw: Math.atan2(-Vn.x * face, -Vn.z * face), role: roles[Math.floor(rnd() * roles.length)], pose: 'sit' });
          }
        }
      }
      // навес над трибуной
      for (let k = 0; k < 11; k++) {
        const c = at(-10 + k * 2, v0 + face * 1.2);
        colorB.add(GEO.box, M(c.x, gh(c.x, c.z) + 3.6, c.z, yawU, 3.4, 0.04, 2.02, 0, face * 0.15), k % 2 ? 0x7a1c1c : 0xd6a632);
      }
      for (const u of [-10, 10]) for (const dv of [0, 2.4]) {
        const p = at(u, v0 + face * dv), g = gh(p.x, p.z);
        wood.box(p.clone().setY(g + 1.8), UP, U, Vn, 1.8, 0.06, 0.06, { grain: true });
      }
    };
    stand(13, 1);
    // зрители вдоль другой стороны и знамёна
    for (let u = -24; u <= 24; u += 2.2) {
      if (rnd() < 0.4) continue;
      const p = at(u + (rnd() - 0.5), -12.4 - rnd() * 1.2);
      const roles = ['peasant', 'townswoman', 'child', 'servant', 'guard'];
      people.push({ x: p.x, y: gh(p.x, p.z), z: p.z, yaw: Math.atan2(Vn.x, Vn.z), role: roles[Math.floor(rnd() * roles.length)] });
    }
    for (const u of [-30, -15, 15, 30]) {
      const p = at(u, -11.6), g = gh(p.x, p.z);
      wood.addGeometry(new THREE.CylinderGeometry(0.05, 0.05, 5, 5), M(p.x, g + 2.5, p.z));
      colorB.add(GEO.box, M(p.x + U.x * 0.5, g + 4.4, p.z + U.z * 0.5, yawU + Math.PI / 2, 0.9, 1.3, 0.02), u < 0 ? 0x1d3f8a : 0x7a1c1c);
    }
    // шатры рыцарей на концах поля
    for (const [u, c] of [[-38, 0x1d3f8a], [38, 0x7a1c1c]]) {
      const p = at(u, 4), g = gh(p.x, p.z);
      for (let k = 0; k < 10; k++) {
        const col = k % 2 ? c : 0xe8e0c8;
        colorB.add(new THREE.CylinderGeometry(2.4, 2.4, 2, 2, 1, true, (k / 10) * Math.PI * 2, Math.PI / 5 + 0.01), M(p.x, g + 1, p.z), col);
        colorB.add(new THREE.ConeGeometry(2.7, 1.8, 2, 1, true, (k / 10) * Math.PI * 2, Math.PI / 5 + 0.01), M(p.x, g + 2.9, p.z), col);
      }
      people.push({ x: p.x + Vn.x * 3.2, y: gh(p.x + Vn.x * 3.2, p.z + Vn.z * 3.2), z: p.z + Vn.z * 3.2, yaw: yawU + (u < 0 ? 0 : Math.PI), role: 'servant' });
    }
    // герольд у барьера
    { const p = at(0, -3.2); people.push({ x: p.x, y: gh(p.x, p.z), z: p.z, yaw: Math.atan2(-Vn.x, -Vn.z), role: 'noble' }); }
    // два рыцаря скачут навстречу друг другу вдоль барьера
    const lane = (v, from, to) => {
      const pts = [];
      for (let k = 0; k <= 8; k++) { const p = at(from + (to - from) * (k / 8), v); pts.push(new V3(p.x, gh(p.x, p.z), p.z)); }
      return pts;
    };
    const jr = mulberry32(900);
    movers.push(makeWalker(scene, (B) => riderBuild(B, { horseCol: 0xe8e0d0, role: 'knight', seed: 501, item: 'lance', caparison: 0x1d3f8a, rnd: jr }), lane(-1.6, -28, 28), { loop: false, speed: 6.5, stride: 2.6, amp: 0.7, s0: 0 }));
    movers.push(makeWalker(scene, (B) => riderBuild(B, { horseCol: 0x2a1e16, role: 'foe', seed: 502, item: 'lance', caparison: 0x7a1c1c, rnd: jr }), lane(1.6, 28, -28), { loop: false, speed: 6.5, stride: 2.6, amp: 0.7, s0: 0 }));
  }

  // ---------------- отряд всадников на дороге к замку ----------------
  let gateRef = null;
  {
    const road = terrain.road;
    const pts = [];
    for (let i = road.length - 1; i >= 0; i -= 3) pts.push(new V3(road[i].x, road[i].h + 0.05, road[i].z));
    const total = pts.reduce((a, p, i) => (i ? a + p.distanceTo(pts[i - 1]) : 0), 0);
    const riders = [
      { role: 'guard', item: 'spear', col: 0x5a3a1e },
      { role: 'knight', item: undefined, col: 0xe8e0d0, cap: 0x1d3f8a },
      { role: 'noble', item: undefined, col: 0x2a1e16 },
      { role: 'guard', item: 'spear', col: 0x6a4424 },
    ];
    const rr = mulberry32(777);
    riders.forEach((r, i) => {
      const lag = i * 4.5;
      movers.push(makeWalker(scene, (B) => riderBuild(B, { horseCol: r.col, role: r.role, seed: 520 + i, item: r.item, caparison: r.cap, rnd: rr }), pts, {
        loop: false, speed: 1.7, stride: 1.7, amp: 0.4, y: true, s0: Math.max(0, total * 0.35 - lag),
        // если ворота закрыты — отряд ждёт перед мостом через ров
        hold: (s, dir, tot) => !!(gateRef && gateRef.closed && dir > 0 && s > tot - 14 - lag),
      }));
    });
  }

  // ---------------- работы в поле ----------------
  const fm = village.fieldMask;
  if (fm) {
    const spots = [];
    for (let k = 0; k < 4000 && spots.length < 3; k++) {
      const x = br.b.x + (rnd() - 0.5) * 260, z = br.b.z + (rnd() - 0.5) * 260;
      const m = fm(x, z);
      if (!m || m.edge < 1) continue;
      if (spots.some((q) => Math.hypot(q.x - x, q.z - z) < 40)) continue;
      spots.push(new V3(x, 0, z));
    }
    spots.forEach((c, si) => {
      if (si < 2) {
        // косари и снопы-суслоны
        for (let k = 0; k < 4; k++) {
          const x = c.x + (k - 1.5) * 2.4, z = c.z + (rnd() - 0.5) * 2;
          people.push({ x, y: gh(x, z), z, yaw: 0.3 + (rnd() - 0.5) * 0.3, role: k === 3 ? 'woman' : 'reaper', pose: k === 3 ? 'work' : 'stand' });
        }
        for (let k = 0; k < 10; k++) {
          const x = c.x + (rnd() - 0.5) * 16, z = c.z - 4 - rnd() * 10;
          for (let j = 0; j < 4; j++) {
            const a = (j / 4) * Math.PI * 2;
            straw.addGeometry(new THREE.CylinderGeometry(0.12, 0.2, 1.0, 6), M(x + Math.cos(a) * 0.18, gh(x, z) + 0.45, z + Math.sin(a) * 0.18, 0, 1, 1, 1, Math.sin(a) * 0.25, -Math.cos(a) * 0.25));
          }
        }
        // воз со снопами и волы
        if (si === 0) {
          const p = new V3(c.x + 8, 0, c.z + 3);
          const top = cart(wood, ctx.metal, terrain, p.x, p.z, 0.4, rnd);
          haystack(straw, terrain, top.clone().setY(top.y + 0.05), 0.9, rnd, true);
          const X2 = new V3(Math.cos(0.4), 0, Math.sin(0.4));
          for (const sd of [-0.55, 0.55]) {
            const o = p.clone().addScaledVector(X2, 3.9).add(new V3(-X2.z * sd, 0, X2.x * sd));
            cow(colorB, o.x, gh(o.x, o.z), o.z, Math.atan2(X2.x, X2.z), rnd, 0x7a5030);
          }
        }
      } else {
        // пахарь с волами ходит взад-вперёд по полосе
        const a = new V3(c.x - 14, 0, c.z), b = new V3(c.x + 14, 0, c.z);
        movers.push(makeWalker(scene, (B) => {
          for (const sd of [-0.55, 0.55]) cow(B, sd, 0, 2.2, 0, rnd, 0x6a4028);
          B.add(GEO.box, M(0, 1.25, 2.9, 0, 1.6, 0.1, 0.12), 0x5a3a1e); // ярмо
          B.add(GEO.box, M(0, 0.7, 0.9, 0, 0.08, 0.08, 2.4, -0.25), 0x5a3a1e); // дышло
          B.add(GEO.box, M(0, 0.35, -0.2, 0, 0.12, 0.6, 0.12, 0.5), 0x5a3a1e); // соха
          B.add(GEO.cone, M(0, 0.08, 0.05, 0, 0.06, 0.3, 0.06, Math.PI / 2 + 0.4), 0x6a6a70);
          person(B, { x: 0, y: 0, z: -1.2, yaw: 0, role: 'peasant', seed: 540 });
        }, [a, b], { loop: false, speed: 0.7, stride: 1.0, amp: 0.35 }));
      }
    });
  }

  // ---------------- валуны и кусты вдоль дороги ----------------
  {
    const road = terrain.road;
    for (let i = 12; i < road.length; i += 4) {
      const q = road[i], nq = road[Math.min(road.length - 1, i + 1)];
      if (q.bridge) continue;
      const dx = nq.x - q.x, dz = nq.z - q.z, l = Math.hypot(dx, dz) || 1;
      for (const sd of [-1, 1]) {
        if (rnd() < 0.45) continue;
        const off = 4.2 + rnd() * 2.5;
        const x = q.x - (dz / l) * off * sd, z = q.z + (dx / l) * off * sd;
        if (village.exclude(x, z)) continue;
        if (rnd() < 0.5) {
          const r = 0.25 + rnd() * 0.45;
          stone.addGeometry(new THREE.DodecahedronGeometry(r, 0), M(x, gh(x, z) + r * 0.5, z, rnd() * 6, 1, 0.7, 1.1));
        } else {
          const green = [0x3a5a24, 0x2e4a1e, 0x4a6a2a][Math.floor(rnd() * 3)];
          for (let k = 0; k < 3; k++) colorB.add(GEO.bush, M(x + (rnd() - 0.5) * 0.8, gh(x, z) + 0.35, z + (rnd() - 0.5) * 0.8, 0, 0.55 + rnd() * 0.3, 0.45, 0.55 + rnd() * 0.3), green);
        }
      }
    }
  }

  // ---------------- развалины: груды камней (видны только в «замке сегодня») ----------------
  {
    const rb = new GeoBuilder(ctx.stoneTile);
    const Pw = walls.points, Nw = walls.segNrm;
    for (let i = 1; i < Pw.length - 2; i += 2) {
      const c = Pw[i].clone().lerp(Pw[i + 1], 0.3 + rnd() * 0.4);
      for (const side of [-1, 1]) {
        const base = c.clone().addScaledVector(Nw[i], side * (2.2 + rnd()));
        for (let k = 0; k < 14; k++) {
          const p = base.clone().add(new V3((rnd() - 0.5) * 3.5, 0, (rnd() - 0.5) * 3.5));
          const r = 0.25 + rnd() * 0.5;
          rb.addGeometry(new THREE.DodecahedronGeometry(r, 0), M(p.x, gh(p.x, p.z) + r * 0.4 + rnd() * 0.4, p.z, rnd() * 6, 1, 0.75, 1.2));
        }
      }
    }
    ctx.ruinRubble = rb;
  }

  return {
    setGate(g) { gateRef = g; },
    update(t, dt) {
      for (const m of movers) m.update(dt, gh);
    },
  };
}

// ===========================================================================
export function createExtras(scene, terrain, walls, village) {
  const rnd = mulberry32(5151);
  const wood = new GeoBuilder(walls.woodMaterial.userData.tileMeters);
  const stone = new GeoBuilder(walls.stoneMaterial.userData.tileMeters);
  const metal = new GeoBuilder(1), straw = new GeoBuilder(1);
  const colorB = new ColorBuilder(), glowB = new ColorBuilder();
  const people = [];
  const armWood = new GeoBuilder(walls.woodMaterial.userData.tileMeters), armMetal = new GeoBuilder(1);
  const ctx = { terrain, wood, stone, metal, straw, colorB, glowB, people, rnd, armWood, armMetal, scene, smokes: [] };
  hallInterior(ctx);
  const camp = siegeCamp(ctx, village);
  if (camp) ctx.campSite = { x: camp.x, z: camp.z };
  const country = createCountryLife(scene, ctx, village); // коровы — в общую сетку, поэтому до сборки
  ctx.stoneTile = walls.stoneMaterial.userData.tileMeters;
  const life2 = createLife2(scene, ctx, village, walls);
  const life3 = createLife3(scene, ctx, village, walls);
  const iron = new THREE.MeshStandardMaterial({ color: 0x2c2926, metalness: 0.85, roughness: 0.5 });
  const colorMat = addTailSway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
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
  if (ctx.ruinRubble && ctx.ruinRubble.pos.length) {
    const rm = new THREE.Mesh(ctx.ruinRubble.build(), walls.stoneMaterial);
    rm.name = 'ruin-rubble';
    rm.castShadow = rm.receiveShadow = true;
    rm.visible = false;
    scene.add(rm);
  }
  const siege = createSiege(scene, ctx, walls, terrain, { wood: walls.woodMaterial, iron });
  const windows = createWindowLights(scene);
  // люди разбиты на группы по местам: далёкие группы не рисуются (меньше треугольников)
  const anchors = [new V3(0, 0, 0)];
  if (camp) anchors.push(new V3(camp.x, 0, camp.z));
  if (ctx.tourney) anchors.push(ctx.tourney.clone());
  if (ctx.pasture) anchors.push(ctx.pasture.clone());
  for (const k of ['washers', 'vineyard', 'quarry']) if (life3.places[k]) anchors.push(life3.places[k].c.clone());
  const groups = anchors.map(() => []), other = [];
  for (const pp of people) {
    let bi = -1, bd = 1e9;
    anchors.forEach((a, i) => { const d = Math.hypot(pp.x - a.x, pp.z - a.z); if (d < bd) { bd = d; bi = i; } });
    (bd < 90 ? groups[bi] : other).push(pp);
  }
  const peopleGroups = [];
  groups.forEach((g, i) => { if (g.length) peopleGroups.push({ c: anchors[i], upd: createPeople(scene, g) }); });
  if (other.length) peopleGroups.push({ c: null, upd: createPeople(scene, other) });
  const ctxRuins = { on: false };
  const peopleUpd = { update(t) { for (const g of peopleGroups) g.upd.update(t); } };
  const walkers = createWalkers(scene, terrain, walls, ctx);
  const birds = createBirds(scene);
  return {
    camp,
    birds,
    siege,
    update(t, dt, camera) {
      dt = Math.min(dt, 0.1);
      if (camera) {
        const cp = camera.position;
        for (const m of WALKERS) m.visible = Math.hypot(m.position.x - cp.x, m.position.z - cp.z) < 320 && !(ctxRuins.on) && m.userData.night !== false;
        for (const g of peopleGroups) if (g.c && g.upd.mesh) g.upd.mesh.visible = Math.hypot(g.c.x - cp.x, g.c.z - cp.z) < 380 && !(ctxRuins.on);
      }
      peopleUpd.update(t);
      walkers.update(dt);
      birds.update(t);
      if (siege) siege.update(dt);
      country.update(t, dt);
      for (const sm of ctx.smokes) sm.update(t);
      if (life2) life2.update(t, dt);
      life3.update(t, dt);
    },
    setNight(k) { birds.mesh.visible = k < 0.5; windows.set(k); life3.setNight(k); },
    places: life3.places,
    areas: life3.areas,
    get pasture() { return ctx.pasture; },
    set ruinsOn(v) { ctxRuins.on = v; },
    get tourney() { return ctx.tourney; },
    setGate(g) { life2.setGate(g); },
  };
}

export { M, GEO, makeWalker, walkerMaterial, WALKERS, fire, cow, findFlat };
