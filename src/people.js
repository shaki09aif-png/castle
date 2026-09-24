// Люди: стража на стенах и у ворот, лучники, кузнец, священник, рыцарь,
// слуги, крестьяне в деревне и на полях. Простые фигуры в одежде XIII века
// (туника, шоссы, капюшон, шлемы-шапели, сюрко) собраны в одну сетку с
// цветами вершин — один вызов отрисовки на всех. Лёгкое «дыхание» и
// покачивание делает шейдер.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

const V3 = THREE.Vector3;

export class ColorBuilder {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.aux = []; this.idx = []; }
  add(geo, m, color, sway = 0, seed = 0) {
    const g = geo.index ? geo : geo;
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const base = this.pos.length / 3;
    const v = new V3();
    const c = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.nrm.push(v.x, v.y, v.z);
      this.col.push(c.r, c.g, c.b);
      this.aux.push(sway, seed);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.aux, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// общие заготовки геометрии
const G = {
  leg: new THREE.CylinderGeometry(0.068, 0.055, 0.84, 8).translate(0, -0.42, 0),
  shoe: new THREE.BoxGeometry(0.1, 0.07, 0.25),
  arm: new THREE.CylinderGeometry(0.058, 0.045, 0.6, 8).translate(0, -0.3, 0),
  hand: new THREE.SphereGeometry(0.048, 8, 6),
  head: new THREE.SphereGeometry(0.105, 14, 10),
  neck: new THREE.CylinderGeometry(0.05, 0.055, 0.1, 8),
  belt: new THREE.TorusGeometry(0.19, 0.022, 5, 18).rotateX(Math.PI / 2),
  hair: new THREE.SphereGeometry(0.113, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  hood: new THREE.SphereGeometry(0.135, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62),
  capeline: new THREE.CylinderGeometry(0.12, 0.13, 0.12, 12),
  brim: new THREE.CylinderGeometry(0.21, 0.21, 0.025, 16),
  helmTop: new THREE.SphereGeometry(0.121, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  wimple: new THREE.SphereGeometry(0.128, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.75),
  shaft: new THREE.CylinderGeometry(0.018, 0.018, 1, 6).translate(0, 0.5, 0),
  tip: new THREE.ConeGeometry(0.04, 0.25, 6),
  bucket: new THREE.CylinderGeometry(0.14, 0.11, 0.25, 10),
};
function tunicGeo(len = 1, flare = 1) {
  // от колен до плеч; подол расширяется
  const pts = [
    [0.23 * flare, 0.55 + (1 - len) * 0.25], [0.2, 0.8], [0.185, 0.97], [0.205, 1.18], [0.235, 1.36], [0.17, 1.45], [0.06, 1.49],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 14);
  g.scale(1, 1, 0.72);
  return g;
}
const TUNIC = tunicGeo(), ROBE = tunicGeo(1.9, 1.15), DRESS = tunicGeo(2.1, 1.25);
const shieldShape = (() => {
  const s = new THREE.Shape();
  s.moveTo(-0.26, 0.35); s.lineTo(0.26, 0.35); s.lineTo(0.26, 0.05);
  s.quadraticCurveTo(0.22, -0.35, 0, -0.55); s.quadraticCurveTo(-0.22, -0.35, -0.26, 0.05); s.lineTo(-0.26, 0.35);
  return new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false });
})();

const SKIN = [0xd9a98a, 0xc99474, 0xe2b596, 0xb98266];
const HAIR = [0x2a1c12, 0x4a3320, 0x6b4a2a, 0x8a6a3a, 0x1a1512];

// Роли: цвета одежды, головной убор, предметы в руках
const ROLES = {
  guard: { tunic: [0x7a1c1c, 0x8a2020], legs: 0x3a3430, head: 'helm', item: 'spear', shield: true },
  archer: { tunic: [0x4e5a2e, 0x5d4a2a], legs: 0x4a4038, head: 'capeline', item: 'bow' },
  smith: { tunic: [0x4a3a2a], legs: 0x2e2a26, head: 'hair', apron: 0x3a2618, item: 'hammer' },
  priest: { tunic: [0x151313], legs: 0x151313, head: 'tonsure', robe: true },
  knight: { tunic: [0x1d3f8a], legs: 0x5a5a5e, head: 'hair', surcoat: 0xe8e0c8, sword: true },
  noble: { tunic: [0x6b2f86, 0x2a5a8a], legs: 0x2a2a30, head: 'hair', robe: true },
  servant: { tunic: [0x8a7a5a, 0x6e6a58, 0x7d5a3a], legs: 0x4a4038, head: 'hood', item: null },
  woman: { tunic: [0x6e4a2a, 0x3d5a7a, 0x8a3a2a], legs: 0x3a3028, head: 'wimple', dress: true, item: 'bucket' },
  peasant: { tunic: [0x7d6a4a, 0x6a5a3a, 0x8a7a5a, 0x5e6040], legs: 0x5a4a38, head: 'hood', item: 'hoe' },
  child: { tunic: [0x8a6a3a, 0x5a6a3a], legs: 0x4a4038, head: 'hair', scale: 0.62 },
  merchant: { tunic: [0x2e5a4a, 0x7a3a1a, 0x5a4a7a, 0x8a6a2a], legs: 0x3a3028, head: 'hood', apron: 0xd8ccb0, item: null },
  townswoman: { tunic: [0x7a2a3a, 0x3d5a7a, 0x6a5a2a, 0x4a6a4a], legs: 0x3a3028, head: 'wimple', dress: true, item: null },
};

function person(B, { x, y, z, yaw = 0, role = 'peasant', seed = 1, pose = 'stand' }) {
  const R = ROLES[role];
  const rnd = mulberry32(seed * 97 + 13);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const s = (R.scale || 1) * (0.93 + rnd() * 0.12);
  const root = new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), yaw), new V3(s, s, s));
  const M = (px, py, pz, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
    root.clone().multiply(new THREE.Matrix4().compose(new V3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new V3(sx, sy, sz)));
  const skin = pick(SKIN), hair = pick(HAIR), tunic = pick(R.tunic);
  const sw = seed;
  // ноги
  const bend = pose === 'work' ? 0.25 : 0;
  for (const sd of [-1, 1]) {
    const step = pose === 'walk' ? sd * 0.28 : 0;
    B.add(G.leg, M(sd * 0.095, 0.88, 0, step, 0, sd * 0.03), R.legs, 0, sw);
    B.add(G.shoe, M(sd * 0.095, 0.035, 0.05 + Math.sin(step) * 0.4), 0x2a1d14, 0, sw);
  }
  // туника / ряса / платье (слегка «дышит»)
  const body = R.dress ? DRESS : R.robe ? ROBE : TUNIC;
  const lean = pose === 'work' ? 0.35 : 0;
  const bodyM = M(0, 0, 0, lean * 0.25);
  B.add(body, bodyM, tunic, 0.4, sw);
  if (R.surcoat) B.add(tunicGeo(1.3, 1.1), M(0, 0.02, 0, 0, 0, 0, 1.06, 0.98, 1.08), R.surcoat, 0.4, sw);
  if (R.apron) B.add(new THREE.BoxGeometry(0.34, 0.6, 0.02), M(0, 0.85, 0.16), R.apron, 0.4, sw);
  B.add(G.belt, M(0, 0.98, 0, 0, 0, 0, 1, 1, 0.75), 0x2a1d14, 0.4, sw);
  // голова
  const hy = 1.58;
  const look = (rnd() - 0.5) * 0.6;
  B.add(G.neck, M(0, 1.49, 0.01), skin, 1, sw);
  B.add(G.head, M(0, hy, 0.01 + lean * 0.12, 0, look), skin, 1, sw);
  switch (R.head) {
    case 'hair': B.add(G.hair, M(0, hy + 0.01, -0.012 + lean * 0.12, -0.25, look), hair, 1, sw); break;
    case 'tonsure': B.add(G.hair, M(0, hy - 0.005, -0.02, -0.55, look), 0x5a5048, 1, sw); break;
    case 'hood': B.add(G.hood, M(0, hy - 0.02, -0.025 + lean * 0.12, -0.35, look), pick([0x6a3a1a, 0x4a5a3a, 0x7a6a4a, 0x8a2a1a]), 1, sw); break;
    case 'wimple': B.add(G.wimple, M(0, hy - 0.02, -0.02, -0.3, look), 0xe8e2d2, 1, sw); break;
    case 'capeline':
      B.add(G.helmTop, M(0, hy + 0.01, 0), 0x6e7074, 1, sw);
      break;
    case 'helm':
      // шапель — железная каска с широкими полями (типична для XIII века)
      B.add(G.helmTop, M(0, hy + 0.01, 0), 0x6e7074, 1, sw);
      B.add(G.brim, M(0, hy + 0.01, 0, -0.08), 0x5e6064, 1, sw);
      B.add(G.hood, M(0, hy - 0.035, -0.02, -0.2), 0x8a8e94, 1, sw); // кольчужный капюшон
      break;
  }
  // руки
  const armPose = {
    stand: [[0.08, 0.12], [0.08, -0.12]],
    spear: [[-0.9, 0.15], [0.05, -0.1]],
    bow: [[-1.45, 0.05], [-1.4, -0.35]],
    work: [[-0.9, 0.2], [-0.8, -0.2]],
    hammer: [[-1.1, 0.25], [0.1, -0.1]],
    bucket: [[0.05, 0.1], [0.1, -0.15]],
  }[R.item === 'spear' ? 'spear' : R.item === 'bow' ? 'bow' : pose === 'work' || R.item === 'hoe' ? 'work' : R.item === 'hammer' ? 'hammer' : R.item === 'bucket' ? 'bucket' : 'stand'];
  const hands = [];
  [1, -1].forEach((sd, i) => {
    const [fx, sz] = armPose[i];
    const sm = M(sd * 0.25, 1.4, lean * 0.1, fx, 0, sd * Math.abs(sz));
    B.add(G.arm, sm, R.surcoat && !R.sword ? R.surcoat : tunic, 0.6, sw);
    const hp = new V3(0, -0.62, 0).applyMatrix4(sm);
    B.add(G.hand, new THREE.Matrix4().compose(hp, new THREE.Quaternion(), new V3(s, s, s)), skin, 0.6, sw);
    hands.push(hp);
  });
  // предметы
  const up = new V3(0, 1, 0);
  if (R.item === 'spear') {
    const base = hands[0].clone().add(new V3(0, -1.1 * s, 0));
    B.add(G.shaft, new THREE.Matrix4().compose(base, new THREE.Quaternion(), new V3(1, 2.5 * s, 1)), 0x5a3e24, 0.3, sw);
    B.add(G.tip, new THREE.Matrix4().compose(base.clone().add(new V3(0, 2.5 * s + 0.12, 0)), new THREE.Quaternion(), new V3(1, 1, 1)), 0x9a9ea4, 0.3, sw);
  }
  if (R.shield) B.add(shieldShape, M(-0.05, 1.12, -0.2, 0.08, Math.PI, 0), pick([0x7a1c1c, 0xd6a632]), 0.4, sw);
  if (R.item === 'bow') {
    const bow = new THREE.TorusGeometry(0.62, 0.014, 5, 20, Math.PI * 0.9);
    B.add(bow, M(0.15, 1.42, 0.62, 0, Math.PI / 2, Math.PI / 2 - Math.PI * 0.45), 0x6a4a2a, 0.3, sw);
  }
  if (R.item === 'hammer') {
    const h = hands[0];
    B.add(G.shaft, new THREE.Matrix4().compose(h.clone().add(new V3(0, -0.05, 0)), new THREE.Quaternion(), new V3(1, 0.4, 1)), 0x5a3e24, 0.3, sw);
    B.add(new THREE.BoxGeometry(0.16, 0.07, 0.07), new THREE.Matrix4().compose(h.clone().add(new V3(0, 0.33, 0)), new THREE.Quaternion().setFromAxisAngle(up, yaw), new V3(1, 1, 1)), 0x3a3a3e, 0.3, sw);
  }
  if (R.item === 'hoe') {
    const h = hands[0];
    const tilt = new THREE.Quaternion().setFromAxisAngle(new V3(Math.cos(yaw), 0, -Math.sin(yaw)), 0.6);
    const base = h.clone().add(new V3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(-0.8)).add(new V3(0, -0.9, 0));
    B.add(G.shaft, new THREE.Matrix4().compose(base, tilt, new V3(1, 1.7, 1)), 0x6a4a2a, 0.3, sw);
  }
  if (R.item === 'bucket') B.add(G.bucket, new THREE.Matrix4().compose(hands[1].clone().add(new V3(0, -0.15, 0)), new THREE.Quaternion(), new V3(1, 1, 1)), 0x6a4a2a, 0.3, sw);
  if (R.sword) {
    B.add(new THREE.BoxGeometry(0.05, 0.95, 0.015), M(-0.22, 0.55, 0.05, 0, 0, 0.12), 0xb0b4ba, 0.2, sw);
    B.add(new THREE.BoxGeometry(0.22, 0.03, 0.03), M(-0.2, 1.03, 0.05, 0, 0, 0.12), 0x6a5a3a, 0.2, sw);
  }
}

export function createPeople(scene, list) {
  const B = new ColorBuilder();
  list.forEach((p, i) => person(B, { seed: i + 1, ...p }));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const uTime = { value: 0 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aSway;\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // дыхание и лёгкое переминание: каждая фигура в своей фазе
        float ph = aSway.y * 1.7;
        transformed.y += sin(uTime * 1.6 + ph) * 0.006 * aSway.x;
        transformed.x += sin(uTime * 0.5 + ph) * 0.012 * aSway.x;`);
  };
  const mesh = new THREE.Mesh(B.build(), mat);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = 'people';
  scene.add(mesh);
  return { update(t) { uTime.value = t; } };
}
