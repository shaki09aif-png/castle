// Оживление сцены: ходящие люди и лошадь, стая птиц над башнями, интерьер
// большого зала и осадный лагерь за рекой. Всё собирается в немногие сетки
// (один объект на материал), движение считает шейдер — FPS почти не меняется.
import * as THREE from 'three';
import { GeoBuilder } from './walls.js';
import { ColorBuilder, person, createPeople, SWAY_TIME, TAIL_GLSL, addTailSway, addPersonShading, CHEER } from './people.js';
import { horse } from './yard.js';
import { HALL, Frame, strawMaterial, Smoke, cart, haystack, INTERIORS } from './courtyard.js';
import { KEEP, TOWERS, WELL, BUILDINGS, riverZ, riverHalfWidth, GATEHOUSE, GATE_PASSAGE, BARBICAN, RIVER } from './layout.js';
import { WINDOWS } from './towers.js';
import { mulberry32 } from './noise.js';
import { createLife3 } from './life3.js';
import { siegeCamp, yardPavilion, clothKit } from './camp.js';
import { COURT_EXTRAS } from './details.js';

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
  const uHuman = { value: 0 };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPhase = uPhase;
    sh.uniforms.uAmp = uAmp;
    sh.uniforms.uSwayTime = SWAY_TIME;
    sh.uniforms.uHuman = uHuman;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aLimb;\nattribute vec2 aSway;\nuniform float uPhase;\nuniform float uAmp;\nuniform float uSwayTime;\nuniform float uHuman;')
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
        transformed.y += abs(cos(uPhase)) * 0.025 * uAmp;
        float ak = uAmp / 0.45;
        if (uHuman > 0.5) {
          // плечи поворачиваются навстречу шагу, корпус переносит вес с ноги на ногу
          float tw = sin(uPhase) * 0.09 * ak * smoothstep(0.9 * uHuman, 1.35 * uHuman, transformed.y) * step(abs(aLimb.x), 0.65);
          float c = cos(tw), s = sin(tw);
          transformed.xz = mat2(c, -s, s, c) * transformed.xz;
          transformed.x += sin(uPhase) * 0.022 * ak * smoothstep(0.2 * uHuman, 0.9 * uHuman, transformed.y);
          transformed.z += 0.03 * ak * smoothstep(0.9 * uHuman, 1.6 * uHuman, transformed.y); // лёгкий наклон вперёд
        }
        if (aSway.x > 2.5 && aSway.x < 3.5) {
          // лошадь кивает головой в такт шагу (шарнир у основания шеи)
          float na = sin(uPhase * 2.0 + 0.6) * 0.07 * ak;
          float c = cos(na), s = sin(na);
          vec2 q = vec2(transformed.y - aSway.y, transformed.z - 0.6);
          transformed.y = aSway.y + q.x * c - q.y * s;
          transformed.z = 0.6 + q.x * s + q.y * c;
        }`);
  };
  mat.customProgramCacheKey = () => 'walker';
  addPersonShading(mat);
  return { mat, uPhase, uAmp, uHuman };
}

const WALKERS = []; // все ходящие — вдали от камеры не рисуются
function makeWalker(scene, build, path, { speed = 1.1, loop = true, stride = 1.5, amp = 0.45, y = null, s0 = null, hold = null } = {}) {
  const B = new ColorBuilder();
  build(B);
  const { mat, uPhase, uAmp, uHuman } = walkerMaterial();
  const geo = B.build();
  geo.computeBoundingBox();
  const bs = geo.boundingBox.getSize(new V3());
  // пешеход: размах ног подбирается под длину шага, чтобы ступни не скользили по земле
  if (bs.y > 0.9 && bs.y < 2.3 && Math.max(bs.x, bs.z) < 1.3 && geo.getAttribute('aLimb')) {
    const sc = Math.min(1, bs.y / 1.78);
    uHuman.value = sc;
    // у каждого своя походка: кто-то идёт быстрее и шире шагает, кто-то медленнее
    if (loop) { const v = 0.88 + Math.random() * 0.24; speed *= v; stride *= Math.sqrt(v); }
    amp = Math.asin(Math.min(0.8, stride / (4 * 0.9 * sc)));
  }
  uAmp.value = amp;
  const mesh = new THREE.Mesh(geo, mat);
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
      // тело (клюв, хвост, веер хвоста) и крылья из двух частей: у тела и концевая
      const verts = [[0, 0, 0.25, 0], [0, 0, -0.16, 0], [-0.09, 0, -0.3, 0], [0.09, 0, -0.3, 0],
        [-0.28, 0, 0.03, -0.45], [-0.62, 0, -0.1, -1], [0.28, 0, 0.03, 0.45], [0.62, 0, -0.1, 1]];
      for (const [x, y, z, w] of verts) {
        pos.push(x, y, z);
        aBird.push(fl.c.x, fl.c.y + hOff, fl.c.z, rad);
        aWing.push(w, phase, spd, 0);
      }
      idx.push(v, v + 4, v + 1, v + 4, v + 5, v + 1, v, v + 1, v + 6, v + 6, v + 1, v + 7, v + 1, v + 2, v + 3);
      v += 8;
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
        // серия взмахов сменяется парением; концы крыльев отстают от внутренней части
        float glide = smoothstep(-0.2, 0.4, sin(uTime * 0.45 + aWing.y * 3.0));
        float fa = abs(aWing.x);
        float flap = sin(uTime * 9.0 + aWing.y * 13.0 - fa * 0.9) * 0.5 * fa * glide + fa * 0.08 * (1.0 - glide);
        // крен внутрь круга
        vec3 up = normalize(vec3(0.0, 1.0, 0.0) - rgt * 0.35 * sign(aWing.z));
        vec3 rg2 = normalize(cross(fwd, up));
        vec3 transformed = ctr + rg2 * position.x + fwd * position.z + up * flap;
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
  // дополнения (камыш на полу, собаки, блюда на высоком столе, ореолы огня) — в интерьерах
  INTERIORS.push({ id: 'hall', f, L: b.L, W: b.W, floorY, eaveY, doors: [], hearth: [1.2, 0], dais: dx, chandeliers: [-2.2, 3.0] });
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
  // ящик-противовес висит на шарнире и всегда смотрит вниз (с раскачкой)
  const cwGrp = new THREE.Group();
  if (T.hinge) {
    cwGrp.position.copy(T.hinge);
    for (const [b, mat] of [[ctx.cwWood, armMats.wood], [ctx.cwMetal, armMats.iron], [ctx.cwStone, armMats.stone]]) {
      if (!b || !b.pos.length) continue;
      const g = b.build();
      g.translate(-T.hinge.x, -T.hinge.y, -T.hinge.z);
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true; m.name = 'extras';
      cwGrp.add(m);
    }
    scene.add(cwGrp);
  }
  // праща: две верёвки и кожаный кошель с ядром; в покое лежит в жёлобе
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.95 });
  const slingGrp = new THREE.Group();
  const SL = 3.0;
  for (const sd of [-1, 1]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, SL, 4).translate(sd * 0.1, SL / 2, 0), ropeMat);
    slingGrp.add(r);
  }
  const pouch = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 5, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5).scale(1, 0.6, 1).rotateX(Math.PI).translate(0, SL + 0.05, 0), new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.9, side: THREE.DoubleSide }));
  slingGrp.add(pouch);
  const loadedStone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4, 1).translate(0, SL + 0.1, 0), new THREE.MeshStandardMaterial({ color: 0x8a8278, roughness: 1 }));
  slingGrp.add(loadedStone);
  slingGrp.name = 'extras';
  scene.add(slingGrp);
  // канат ворота к концу рычага (виден, пока рычаг взводят и держат взведённым)
  const winchRope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 5).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x7a6a4a, roughness: 0.95 }));
  winchRope.name = 'extras';
  scene.add(winchRope);
  let curAng = 0, prevAng = 0, prevVel = 0, sw = 0, swV = 0, loaded = true;
  const DOWN = new V3(0, -1, 0), YUP = new V3(0, 1, 0);
  const restSling = T.A.clone().addScaledVector(DOWN, 0.2).normalize();
  const poseMachine = (dt, c) => {
    const tip = T.pivot.clone().addScaledVector(armDirAt(curAng), T.armLen + 0.35);
    // противовес: шарнир на коротком плече, раскачка от ускорения рычага
    if (T.hinge) {
      cwGrp.position.copy(T.pivot).addScaledVector(armDirAt(curAng), -T.short);
      const vel = dt > 0 ? (curAng - prevAng) / dt : 0;
      const acc = dt > 0 ? (vel - prevVel) / dt : 0;
      prevVel = vel;
      swV += (-sw * 18 - swV * 2.2 - acc * 0.02 * sgn) * dt;
      sw += swV * dt;
      sw = Math.max(-0.9, Math.min(0.9, sw));
      cwGrp.quaternion.setFromAxisAngle(T.R, sw);
    }
    prevAng = curAng;
    // праща
    let dir;
    if (c !== null && c < 0.9) {
      const k = Math.min(1, Math.max(0, (curAng - 0.15) / (RELEASE - 0.15)));
      dir = restSling.clone().lerp(armDirAt(curAng + 0.6 * k), k * k).normalize();
    } else if (curAng > 0.6) dir = DOWN.clone().addScaledVector(T.A, -0.05).normalize();
    else dir = restSling.clone().lerp(DOWN, curAng / 0.6).normalize();
    slingGrp.position.copy(tip);
    slingGrp.quaternion.setFromUnitVectors(YUP, dir);
    loadedStone.visible = loaded;
    // канат ворота
    const cocking = c === null || c >= 2;
    winchRope.visible = !!T.drum && cocking && curAng < THROW - 0.05;
    if (winchRope.visible) {
      const d = tip.clone().sub(T.drum), l = d.length();
      winchRope.position.copy(T.drum);
      winchRope.quaternion.setFromUnitVectors(YUP, d.normalize());
      winchRope.scale.set(1, l, 1);
    }
  };
  poseMachine(0, null);

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
  const nArrows = 28;
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
  // стрелки на стенах (дозорные-лучники из life3) дают свои точки выстрела
  const extraShooters = [];
  function shootArrow() {
    const a = arrowSt.find((x) => !x.on);
    if (!a) return;
    let from = null, to;
    if (Math.random() < 0.3) {
      // лучники осаждающих отвечают из-за частокола — стрелы бьют в стену и зубцы
      from = T.pivot.clone().addScaledVector(T.A, 9 + Math.random() * 7).addScaledVector(T.R, (Math.random() - 0.5) * 30);
      from.y = gh(from.x, from.z) + 1.5;
      const s0 = shooters[Math.floor(Math.random() * shooters.length)];
      to = s0.clone().add(new V3((Math.random() - 0.5) * 4, -0.6 - Math.random() * 3, (Math.random() - 0.5) * 4)).addScaledVector(toCamp, 0.9);
    } else {
      if (extraShooters.length && Math.random() < 0.75) from = extraShooters[Math.floor(Math.random() * extraShooters.length)]();
      if (!from) from = shooters[Math.floor(Math.random() * shooters.length)];
      // бьют по осадному лагерю: по щитам перед требушетом, частоколу и прислуге
      to = T.pivot.clone().addScaledVector(T.A, 4 + Math.random() * 16).addScaledVector(T.R, (Math.random() - 0.5) * 34);
      to.y = gh(to.x, to.z) + 0.3;
    }
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const dur = dist / 62 + Math.random() * 0.4;
    a.p0.copy(from);
    a.v.copy(to).sub(from).divideScalar(dur).add(new V3(0, 0.5 * 9.8 * dur, 0));
    Object.assign(a, { t: 0, dur, stuck: 0, on: true });
  }

  return {
    target,
    toCamp,
    extraShooters,
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
        if (c >= 0.9 * Math.sqrt(RELEASE / THROW) && !flight && c < 1.2 && loaded) { launch(); loaded = false; }
        if (c >= 8) loaded = true; // заряжено новое ядро
        armGrp.quaternion.setFromAxisAngle(T.R, sgn * ang);
        curAng = ang;
        poseMachine(dt, c);
        if (!active && c >= 8) clock = 0; // остановились во взведённом положении
      } else if (Math.abs(sw) > 0.001 || Math.abs(swV) > 0.001) poseMachine(dt, null);
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
        if (arrowClock <= 0) { shootArrow(); arrowClock = 0.18 + Math.random() * 0.3; }
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
          if (a.stuck > 6) a.on = false;
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
  const dark = new THREE.Color(base).multiplyScalar(0.72).getHex();
  // туловище с холкой, маклоками и отвислым брюхом
  B.add(COWG.body, L(0, 1.05, 0, 1, 1.05, 1), base);
  B.add(GEO.sph, L(0, 1.32, 0.45, 0.3, 0.16, 0.34), base); // холка
  for (const sd of [-1, 1]) B.add(GEO.sph, L(sd * 0.2, 1.3, -0.62, 0.12, 0.1, 0.12), base); // маклоки
  B.add(GEO.sph, L(0, 0.86, 0.05, 0.36, 0.2, 0.6), base); // брюхо
  if (spotted) for (let k = 0; k < 6; k++) B.add(GEO.sph, L((rnd() - 0.5) * 0.72, 1.1 + (rnd() - 0.3) * 0.45, (rnd() - 0.5) * 1.3, 0.25, 0.2, 0.3), 0x1e1a18);
  const graze = rnd() < 0.6;
  const hy = graze ? 0.45 : 1.15, hz = graze ? 1.05 : 1.0, tilt = graze ? 0.75 : 0.15;
  // шея с подгрудком
  B.add(new THREE.CylinderGeometry(0.2, 0.3, 0.62, 12), L(0, (hy + 1.2) / 2, 0.8, 1, 1, 1, graze ? 1.0 : 0.5), base);
  B.add(GEO.sph, L(0, (hy + 1.0) / 2 - 0.08, 0.86, 0.08, 0.22, 0.2, graze ? 0.9 : 0.4), base);
  // голова: широкий лоб, сужение к морде, влажный нос, глаза, уши, рога (жуёт и кивает — шейдер)
  B.curAnim = [4, 0, rnd()];
  B.add(COWG.skull, L(0, hy + 0.04, hz - 0.06, 1, 1, 1, tilt), base);
  B.add(COWG.snout, L(0, hy - (graze ? 0.14 : 0.04), hz + (graze ? 0.16 : 0.2), 1, 1, 1, tilt + Math.PI / 2 - 0.2), base);
  B.add(GEO.sph, L(0, hy - (graze ? 0.26 : 0.08), hz + (graze ? 0.25 : 0.36), 0.13, 0.09, 0.08, tilt), 0xc89a8a);
  for (const sd of [-1, 1]) {
    B.add(GEO.sph, L(sd * 0.05, hy - (graze ? 0.26 : 0.07), hz + (graze ? 0.31 : 0.43), 0.025, 0.02, 0.012, tilt), 0x2a1a18); // ноздри
    B.add(GEO.sph, L(sd * 0.14, hy + 0.1, hz + 0.04, 0.028, 0.03, 0.02), 0x14100e); // глаза
    B.add(GEO.cone, L(sd * 0.16, hy + 0.22, hz - 0.12, 0.03, 0.2, 0.03, 0, sd * -1.0), 0xe0d8c0);
    B.add(GEO.cone, L(sd * 0.25, hy + 0.3, hz - 0.12, 0.015, 0.07, 0.015, 0, sd * 0.3), 0x3a3028);
    B.add(COWG.ear, L(sd * 0.23, hy + 0.1, hz - 0.1, 1, 1, 1, 0, sd * -1.25), base);
  }
  B.curAnim = [0, 0, 0];
  // ноги: бедро, скакательный/запястный сустав, голень, раздвоенное копыто
  for (const [lx, lz] of [[-0.22, 0.55], [0.22, 0.55], [-0.22, -0.6], [0.22, -0.6]]) {
    B.curLimb = [(lx < 0) === (lz > 0) ? 0.7 : -0.7, 0.72]; // для ходьбы (волы в упряжке)
    const hind = lz < 0;
    B.add(COWG.upper, L(lx, 0.72, lz + (hind ? -0.03 : 0), 1, 1, 1, hind ? -0.12 : 0.05), base);
    B.add(GEO.sph, L(lx, 0.42, lz, 0.075, 0.07, 0.08), base);
    B.add(COWG.lower, L(lx, 0.42, lz, 1, 1, 1), base);
    for (const s2 of [-1, 1]) B.add(GEO.box, L(lx + s2 * 0.028, 0.04, lz + 0.015, 0.045, 0.08, 0.1), 0x2a2420);
  }
  B.curLimb = [0, 0];
  B.add(GEO.sph, L(0, 0.64, -0.35, 0.2, 0.14, 0.2), 0xd8a0a0); // вымя
  const tailRoot = y + 1.3;
  B.add(GEO.cylLo, L(0, 0.95, -0.98, 0.03, 0.7, 0.03), base, 2, tailRoot);
  B.add(GEO.sph, L(0, 0.58, -0.98, 0.06, 0.12, 0.06), dark === base ? 0x1e1a18 : 0x1e1a18, 2, tailRoot);
}
const COWG = {
  body: new THREE.CapsuleGeometry(0.42, 1.0, 6, 16).rotateX(Math.PI / 2),
  skull: (() => { const g = new THREE.SphereGeometry(0.17, 12, 9); g.scale(1.05, 1, 1.25); return g; })(),
  snout: new THREE.CylinderGeometry(0.1, 0.15, 0.3, 12),
  ear: (() => { const g = new THREE.SphereGeometry(0.08, 8, 5); g.scale(1, 0.4, 0.6); return g; })(),
  upper: new THREE.CylinderGeometry(0.1, 0.075, 0.6, 10).translate(0, -0.0, 0),
  lower: new THREE.CylinderGeometry(0.06, 0.05, 0.38, 8).translate(0, -0.19, 0),
};

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
        const grey = i % 3 === 2;
        const wc = grey ? 0x8a8a84 : 0xf0ece4, wd = grey ? 0x6a6a64 : 0xd8d2c6;
        B.add(GEO.sph, M(0, 0.32, 0, 0, 0.17, 0.16, 0.28), wc);
        for (const sd of [-1, 1]) B.add(GEO.sph, M(sd * 0.13, 0.36, -0.03, 0, 0.05, 0.1, 0.24, -0.15), wd); // сложенные крылья
        B.add(GEO.cone, M(0, 0.4, -0.3, 0, 0.08, 0.14, 0.05, -1.2), wd); // хвост
        B.add(GEO.cyl, M(0, 0.5, 0.2, 0, 0.045, 0.3, 0.045, -0.35), wc);
        B.add(GEO.sph, M(0, 0.66, 0.27, 0, 0.065, 0.06, 0.08), wc);
        B.add(GEO.cone, M(0, 0.65, 0.37, 0, 0.025, 0.09, 0.025, Math.PI / 2), 0xe08a20);
        B.add(GEO.sph, M(0, 0.66, 0.335, 0, 0.022, 0.02, 0.02), 0xe08a20); // шишка у клюва
        for (const sd of [-1, 1]) B.add(GEO.sph, M(sd * 0.04, 0.68, 0.3, 0, 0.01, 0.01, 0.01), 0x141010);
        for (const sd of [-1, 1]) { B.curLimb = [sd, 0.18]; B.add(GEO.cylLo, M(sd * 0.06, 0.09, 0, 0, 0.012, 0.18, 0.012), 0xe08a20); B.add(GEO.box, M(sd * 0.06, 0.008, 0.04, 0, 0.07, 0.012, 0.09), 0xe08a20); }
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
  // свет очага за окном мерцает, у каждого окна по-своему
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSwayTime = SWAY_TIME;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uSwayTime;\nvarying float vFlk;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat fi = float(gl_InstanceID);\nvFlk = 0.84 + 0.1 * sin(uSwayTime * 6.3 + fi * 1.7) * sin(uSwayTime * 3.1 + fi * 4.3) + 0.06 * sin(uSwayTime * 13.0 + fi);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFlk;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vFlk;');
  };
  mat.customProgramCacheKey = () => 'window-flicker';
  const base = mat.color.clone();
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
  // k: 0 — день, 1 — ночь; в сумерках окна уже светятся, но тусклее
  return { set(k) { im.visible = k > 0.05; mat.color.copy(base).multiplyScalar(0.35 + 0.65 * Math.min(1, k)); } };
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
    const cloth = clothKit(ctx, 0);
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
            people.push({ x: q.x, y: g + tier * 0.55 + 0.35, z: q.z, yaw: Math.atan2(-Vn.x * face, -Vn.z * face), role: roles[Math.floor(rnd() * roles.length)], pose: 'sit', cheer: true });
          }
        }
      }
      // навес над трибуной — полосатая парусина, чуть провисает между стойками
      for (let k = 0; k < 11; k++) {
        const u0 = -11 + k * 2, u1 = u0 + 2;
        const yF = (u) => { const c = at(u, v0 + face * 1.2); return gh(c.x, c.z) + 3.6; };
        const P4 = [at(u0, v0 - face * 0.5), at(u1, v0 - face * 0.5), at(u1, v0 + face * 2.9), at(u0, v0 + face * 2.9)];
        const ys = [yF(u0) + 0.25, yF(u1) + 0.25, yF(u1) - 0.25, yF(u0) - 0.25];
        P4.forEach((q, i) => { q.y = ys[i] - (i % 3 === 0 ? 0 : 0) - (k % 2 ? 0.03 : 0); });
        cloth.quad(P4, UP.clone().addScaledVector(Vn, -face * 0.12).normalize(), k % 2 ? 0x8c2020 : 0xd6a632);
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
      people.push({ x: p.x, y: gh(p.x, p.z), z: p.z, yaw: Math.atan2(Vn.x, Vn.z), role: roles[Math.floor(rnd() * roles.length)], cheer: true });
    }
    for (const u of [-30, -15, 15, 30]) {
      const p = at(u, -11.6), g = gh(p.x, p.z);
      wood.addGeometry(new THREE.CylinderGeometry(0.05, 0.05, 5, 5), M(p.x, g + 2.5, p.z));
      colorB.add(GEO.box, M(p.x + U.x * 0.5, g + 4.4, p.z + U.z * 0.5, yawU + Math.PI / 2, 0.9, 1.3, 0.02), u < 0 ? 0x1d3f8a : 0x7a1c1c);
    }
    // шатры рыцарей на концах поля (та же парусина, что в лагере): синий и красный
    for (const [u, c] of [[-38, 0x1d3f8a], [38, 0x7a1c1c]]) {
      const p = at(u, 4), g = gh(p.x, p.z);
      cloth.roundTent(p, { R: 2.4, hw: 1.9, hr: 2.2, n: 16, cols: [c, 0xe8e0c8], stripe: true, val: c, door: Math.atan2(-U.x * Math.sign(u), -U.z * Math.sign(u)), pennant: c });
      void g;
      people.push({ x: p.x + Vn.x * 3.2, y: gh(p.x + Vn.x * 3.2, p.z + Vn.z * 3.2), z: p.z + Vn.z * 3.2, yaw: yawU + (u < 0 ? 0 : Math.PI), role: 'servant' });
    }
    // герольд у барьера
    { const p = at(0, -3.2); people.push({ x: p.x, y: gh(p.x, p.z), z: p.z, yaw: Math.atan2(-Vn.x, -Vn.z), role: 'noble' }); }
    cloth.finish(scene);
    // ПОЕДИНКИ: 2 рыцаря синих против 2 красных.
    // 1) сшибка на копьях у барьера: разгон, удар в щит, щепки, отдача, разворот;
    // 2) пеший бой на мечах в углу ристалища: удары, блоки, отходы.
    const jr = mulberry32(900);
    const sm = (a, b, x) => { const q = Math.min(1, Math.max(0, (x - a) / (b - a))); return q * q * (3 - 2 * q); };
    const mkRig = (build, amp) => {
      const B = new ColorBuilder(); build(B);
      const { mat, uPhase, uAmp, uHuman } = walkerMaterial();
      uAmp.value = amp;
      const mesh = new THREE.Mesh(B.build(), mat);
      mesh.receiveShadow = true; mesh.castShadow = false; mesh.name = 'walker';
      scene.add(mesh); WALKERS.push(mesh);
      return { mesh, uPhase, uAmp, uHuman };
    };
    const jousters = [
      { r: mkRig((B) => riderBuild(B, { horseCol: 0xe8e0d0, role: 'champB', seed: 501, item: 'lance', caparison: 0x1d3f8a, rnd: jr }), 0.7), v: -1.6, sd: -1 },
      { r: mkRig((B) => riderBuild(B, { horseCol: 0x2a1e16, role: 'champR', seed: 502, item: 'lance', caparison: 0x7a1c1c, rnd: jr }), 0.7), v: 1.6, sd: 1 },
    ];
    // щепки от сломанного копья
    const chipGeo = new THREE.BoxGeometry(0.05, 0.05, 0.5);
    const chips = new THREE.InstancedMesh(chipGeo, new THREE.MeshLambertMaterial({ color: 0xcdb48a }), 18);
    chips.frustumCulled = false; chips.visible = false; scene.add(chips); WALKERS.push(chips);
    const chipV = [], chipP = [], chipR = [];
    for (let k = 0; k < 18; k++) { chipV.push(new V3()); chipP.push(new V3()); chipR.push(new V3()); }
    const dm = new THREE.Matrix4(), dq = new THREE.Quaternion(), de = new THREE.Euler(), one = new V3(1, 1, 1);
    let hitAt = -99, lastRun = -1;
    const RUN = 7.5, WAIT = 3.2, PER = RUN + WAIT, L = 27;
    const hitPt = at(0, 0);
    // пешие бойцы
    const fc = at(-20, -6.5);
    const foot = [[1, 'champB', 511], [-1, 'champR', 512]].map(([sd, role, seed]) => ({ sd, r: mkRig((B) => person(B, { x: 0, y: 0, z: 0, yaw: 0, role, seed, item: 'sword' }), 0.8) }));
    let tJ = 0;
    ctx.tourneyUpdate = (dt) => {
      tJ += dt;
      const run = Math.floor(tJ / PER), u = tJ % PER;
      // сшибка
      const dir = run % 2 ? -1 : 1;
      for (const j of jousters) {
        const m = j.r.mesh;
        let uu;
        if (u < RUN) uu = j.sd * dir * (L - 2 * L * Math.min(1, u / RUN));
        else uu = -j.sd * dir * L;
        const p = at(uu, j.v);
        m.position.set(p.x, gh(p.x, p.z), p.z);
        // направление: во время скачки — вдоль поля, на паузе разворот к новому заезду
        const going = -j.sd * dir;
        const yGo = Math.atan2(U.x * going, U.z * going);
        const yaw = u < RUN ? yGo : yGo + Math.PI * sm(RUN + 0.6, PER - 0.4, u);
        m.rotation.y = yaw;
        const gal = u < RUN ? 1 : 0.15 * (1 - sm(RUN, RUN + 1, u)) + 0.25 * sm(RUN + 0.6, PER - 0.4, u) * (1 - sm(PER - 0.6, PER, u));
        j.r.uPhase.value += dt * (gal * 7 + 0.5) / 2.6 * Math.PI * 2;
        j.r.uAmp.value = 0.15 + 0.6 * gal;
        // отдача от удара: всадник с конём вздрагивает, тот, в чей щит попали, сильнее
        const since = tJ - hitAt;
        const hurt = (run % 2 ? j.sd > 0 : j.sd < 0) ? 1 : 0.35;
        const jolt = since > 0 && since < 0.9 ? Math.sin(since * 11) * Math.exp(-since * 5) * hurt : 0;
        m.rotation.z = jolt * 0.12 * j.sd; m.rotation.x = -jolt * 0.08;
      }
      if (u >= RUN / 2 && run !== lastRun) {
        lastRun = run; hitAt = tJ;
        CHEER.value = SWAY_TIME.value; // зрители кричат «ура»
        const y = gh(hitPt.x, hitPt.z) + 2.3;
        for (let q = 0; q < 18; q++) {
          chipP[q].set(hitPt.x, y, hitPt.z);
          chipV[q].set((Math.random() - 0.5) * 5, 1.5 + Math.random() * 4, (Math.random() - 0.5) * 5);
          chipR[q].set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        }
      }
      const st = tJ - hitAt;
      chips.visible = st < 2.2;
      if (chips.visible) {
        for (let q = 0; q < 18; q++) {
          chipV[q].y -= 9.8 * dt;
          chipP[q].addScaledVector(chipV[q], dt);
          const g = gh(chipP[q].x, chipP[q].z) + 0.03;
          if (chipP[q].y < g) { chipP[q].y = g; chipV[q].set(0, 0, 0); } else chipR[q].addScalar(dt * 8);
          dm.compose(chipP[q], dq.setFromEuler(de.set(chipR[q].x, chipR[q].y, chipR[q].z)), one);
          chips.setMatrixAt(q, dm);
        }
        chips.instanceMatrix.needsUpdate = true;
      }
      // пеший бой: по очереди атакуют — замах, удар с выпадом; второй блокирует и отступает
      const T = 2.3, cyc = Math.floor(tJ / T), w = (tJ % T) / T, attacker = cyc % 2;
      const circle = Math.sin(tJ * 0.3) * 0.8;
      foot.forEach(({ r, sd }, i) => {
        const att = i === attacker;
        let swing, fwd;
        if (att) {
          swing = w < 0.45 ? -sm(0, 0.45, w) : w < 0.58 ? -1 + 2 * sm(0.45, 0.58, w) : 1 - 1.2 * sm(0.62, 1, w);
          fwd = w < 0.45 ? -0.12 * sm(0, 0.45, w) : w < 0.62 ? 0.5 * sm(0.45, 0.6, w) : 0.5 * (1 - sm(0.62, 1, w));
        } else {
          swing = -0.55 * sm(0.3, 0.5, w) * (1 - sm(0.7, 1, w));
          fwd = -0.35 * sm(0.45, 0.6, w) * (1 - sm(0.65, 1, w));
        }
        const d = 1.2 - fwd, ang = circle + (sd > 0 ? 0 : Math.PI);
        const x = fc.x + Math.sin(ang) * d, z = fc.z + Math.cos(ang) * d;
        r.mesh.position.set(x, gh(x, z), z);
        r.mesh.rotation.y = Math.atan2(fc.x - x, fc.z - z) + (att ? swing * 0.12 : -0.15 * sm(0.45, 0.6, w) * (1 - sm(0.7, 1, w)));
        r.uPhase.value = Math.asin(Math.max(-1, Math.min(1, swing)));
        r.uAmp.value = att ? 0.9 : 0.7;
      });
    };
    // оруженосцы с запасными копьями у концов барьера
    for (const [uu, vv, sd] of [[-30, -2.6, 1], [30, 2.6, -1]]) {
      const p = at(uu, vv);
      people.push({ x: p.x, y: gh(p.x, p.z), z: p.z, yaw: Math.atan2(U.x * sd, U.z * sd), role: 'servant', item: 'spear' });
    }
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
      if (ctx.tourneyUpdate) ctx.tourneyUpdate(Math.min(dt, 0.1));
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
  const cwWood = new GeoBuilder(walls.woodMaterial.userData.tileMeters), cwMetal = new GeoBuilder(1), cwStone = new GeoBuilder(walls.stoneMaterial.userData.tileMeters);
  const ctx = { terrain, wood, stone, metal, straw, colorB, glowB, people, rnd, armWood, armMetal, cwWood, cwMetal, cwStone, scene, smokes: [] };
  hallInterior(ctx);
  const camp = siegeCamp(ctx, village, findCampSite);
  for (const t of COURT_EXTRAS.tents) ctx.pavilion = yardPavilion(scene, ctx, t.x, t.z, Math.atan2(-t.x, -t.z)).stop; // вход — к середине двора
  if (camp) ctx.campSite = { x: camp.x, z: camp.z };
  const country = createCountryLife(scene, ctx, village); // коровы — в общую сетку, поэтому до сборки
  ctx.stoneTile = walls.stoneMaterial.userData.tileMeters;
  const life2 = createLife2(scene, ctx, village, walls);
  const life3 = createLife3(scene, ctx, village, walls);
  const iron = new THREE.MeshStandardMaterial({ color: 0x2c2926, metalness: 0.85, roughness: 0.5 });
  const colorMat = addPersonShading(addTailSway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })));
  // огонь, свечи, пламя костров — светятся сами (без источников света)
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  // пламя костров и свечей колышется и мерцает
  glowMat.onBeforeCompile = (sh) => {
    sh.uniforms.uT = SWAY_TIME;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uT;\nvarying float vFlick;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float fph = position.x * 3.1 + position.z * 2.3;
        transformed.x += sin(uT * 11.0 + fph + position.y * 9.0) * 0.025;
        transformed.z += cos(uT * 9.0 + fph * 1.3 + position.y * 7.0) * 0.02;
        transformed.y += sin(uT * 7.0 + fph) * 0.02;
        vFlick = 0.82 + 0.12 * sin(uT * 13.0 + fph) + 0.08 * sin(uT * 29.0 + fph * 2.0);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFlick;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vFlick;');
  };
  glowMat.customProgramCacheKey = () => 'glow-flick';
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
  // сетки осадного лагеря — отдельно (отсекаются, когда лагерь вне кадра или далеко)
  const campMeshes = [];
  if (ctx.campBuilders) {
    const CB = ctx.campBuilders;
    for (const [bld, mat, far] of [[CB.wood, walls.woodMaterial, 700], [CB.stone, walls.stoneMaterial, 220], [CB.metal, iron, 220], [CB.straw, strawMaterial(), 220], [CB.colorB, colorMat, 220]]) {
      if (!bld.pos.length) continue;
      const m = new THREE.Mesh(bld.build(), mat);
      m.userData.far = far; // мелочи лагеря (лошади, верёвки, камни) издалека не видны
      m.castShadow = m.receiveShadow = true;
      m.name = 'extras';
      scene.add(m);
      campMeshes.push(m);
    }
  }
  if (ctx.ruinRubble && ctx.ruinRubble.pos.length) {
    const rm = new THREE.Mesh(ctx.ruinRubble.build(), walls.stoneMaterial);
    rm.name = 'ruin-rubble';
    rm.castShadow = rm.receiveShadow = true;
    rm.visible = false;
    scene.add(rm);
  }
  const siege = createSiege(scene, ctx, walls, terrain, { wood: walls.woodMaterial, iron, stone: walls.stoneMaterial });
  life3.siege = siege;
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
        for (const m of WALKERS) m.visible = Math.hypot(m.position.x - cp.x, m.position.z - cp.z) < (m.userData.maxDist || 190) && !(ctxRuins.on) && m.userData.night !== false;
        for (const g of peopleGroups) if (g.c && g.upd.mesh) g.upd.mesh.visible = Math.hypot(g.c.x - cp.x, g.c.z - cp.z) < (g.c.x === 0 && g.c.z === 0 ? 340 : 220) && !(ctxRuins.on); // за 220 м фигурки в пару пикселей
        if (camp) { const dc = Math.hypot(camp.x - cp.x, camp.z - cp.z); for (const m of campMeshes) m.visible = dc < m.userData.far && !ctxRuins.on; }
      }
      peopleUpd.update(t);
      walkers.update(dt);
      birds.update(t);
      if (siege) siege.update(dt);
      country.update(t, dt);
      for (const sm of ctx.smokes) sm.update(t);
      if (life2) life2.update(t, dt);
      life3.update(t, dt, camera);
    },
    setNight(k) { birds.mesh.visible = k < 0.5; life3.setNight(k); },
    setWindows(k) { windows.set(k); },
    places: life3.places,
    areas: life3.areas,
    get pasture() { return ctx.pasture; },
    set ruinsOn(v) { ctxRuins.on = v; },
    get tourney() { return ctx.tourney; },
    cheerNow(ago = 0) { CHEER.value = SWAY_TIME.value - ago; },
    setGate(g) { life2.setGate(g); life3.gate = g; },
  };
}

export { M, GEO, makeWalker, walkerMaterial, WALKERS, fire, cow, findFlat, riderBuild };
