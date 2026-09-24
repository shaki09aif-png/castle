// Люди: стража на стенах и у ворот, лучники, кузнец, священник, рыцарь,
// слуги, крестьяне в деревне и на полях. Простые фигуры в одежде XIII века
// (туника, шоссы, капюшон, шлемы-шапели, сюрко) собраны в одну сетку с
// цветами вершин — один вызов отрисовки на всех. Лёгкое «дыхание» и
// покачивание делает шейдер.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

const V3 = THREE.Vector3;

export class ColorBuilder {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.aux = []; this.idx = []; this.limb = []; this.curLimb = [0, 0]; }
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
      this.limb.push(this.curLimb[0], this.curLimb[1]); // для ходьбы: сторона/знак качания и высота шарнира
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
    if (this.limb.some((v) => v !== 0)) g.setAttribute('aLimb', new THREE.Float32BufferAttribute(this.limb, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// общие заготовки геометрии (фигура ~1,7 м; начало координат — между ступнями)
const G = {
  thigh: new THREE.CylinderGeometry(0.074, 0.06, 0.45, 10).translate(0, -0.225, 0),
  shin: new THREE.CylinderGeometry(0.058, 0.045, 0.43, 10).translate(0, -0.215, 0),
  knee: new THREE.SphereGeometry(0.06, 8, 6),
  shoe: (() => { const g = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(0.058, 0.075, 0.135); g.translate(0, 0, 0.035); return g; })(),
  upperArm: new THREE.CylinderGeometry(0.058, 0.05, 0.3, 10).translate(0, -0.15, 0),
  foreArm: new THREE.CylinderGeometry(0.048, 0.04, 0.28, 10).translate(0, -0.14, 0),
  joint: new THREE.SphereGeometry(0.05, 8, 6),
  shoulder: new THREE.SphereGeometry(0.075, 10, 8),
  cuff: new THREE.CylinderGeometry(0.047, 0.047, 0.04, 10),
  hand: (() => { const g = new THREE.SphereGeometry(1, 8, 6); g.scale(0.04, 0.06, 0.028); return g; })(),
  head: (() => { const g = new THREE.SphereGeometry(0.1, 16, 12); g.scale(0.95, 1.12, 1.02); return g; })(),
  jaw: (() => { const g = new THREE.SphereGeometry(0.075, 12, 8, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55); g.scale(1, 0.9, 1.1); return g; })(),
  nose: (() => { const g = new THREE.ConeGeometry(0.018, 0.05, 6); g.rotateX(Math.PI / 2 + 0.5); return g; })(),
  eye: new THREE.SphereGeometry(0.011, 6, 4),
  brow: new THREE.BoxGeometry(0.035, 0.008, 0.01),
  ear: (() => { const g = new THREE.SphereGeometry(1, 6, 5); g.scale(0.012, 0.028, 0.02); return g; })(),
  beard: (() => { const g = new THREE.SphereGeometry(0.085, 12, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.4); g.scale(0.95, 1.2, 1.05); return g; })(),
  neck: new THREE.CylinderGeometry(0.045, 0.052, 0.1, 10),
  belt: new THREE.TorusGeometry(0.19, 0.02, 5, 20).rotateX(Math.PI / 2),
  pouch: new THREE.BoxGeometry(0.08, 0.1, 0.04),
  hem: new THREE.TorusGeometry(1, 0.018, 4, 24).rotateX(Math.PI / 2),
  hair: new THREE.SphereGeometry(0.112, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.56),
  hairBack: (() => { const g = new THREE.SphereGeometry(0.108, 12, 8, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.3, Math.PI * 0.45); return g; })(),
  hood: new THREE.SphereGeometry(0.132, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.62),
  hoodCape: new THREE.CylinderGeometry(0.12, 0.3, 0.2, 16, 1, true),
  liripipe: new THREE.ConeGeometry(0.035, 0.35, 6),
  capeline: new THREE.CylinderGeometry(0.12, 0.13, 0.12, 12),
  brim: new THREE.CylinderGeometry(0.21, 0.21, 0.025, 18),
  helmTop: new THREE.SphereGeometry(0.121, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  coif: new THREE.SphereGeometry(0.128, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.7),
  mailCape: new THREE.CylinderGeometry(0.12, 0.27, 0.16, 16, 1, true),
  wimple: new THREE.SphereGeometry(0.126, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.75),
  veil: new THREE.CylinderGeometry(0.11, 0.2, 0.3, 16, 1, true, Math.PI * 0.6, Math.PI * 1.8),
  shaft: new THREE.CylinderGeometry(0.018, 0.018, 1, 6).translate(0, 0.5, 0),
  tip: new THREE.ConeGeometry(0.04, 0.25, 6),
  bucket: new THREE.CylinderGeometry(0.14, 0.11, 0.25, 12),
};
function tunicGeo(len = 1, flare = 1) {
  // от колен до плеч; подол расширяется, плечи скруглены
  const pts = [
    [0.235 * flare, 0.55 + (1 - len) * 0.25], [0.215 * (0.5 + flare * 0.5), 0.72], [0.195, 0.9], [0.182, 0.99], [0.19, 1.1],
    [0.212, 1.24], [0.228, 1.34], [0.215, 1.41], [0.16, 1.46], [0.07, 1.495], [0.04, 1.5],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 18);
  g.scale(1, 1, 0.7);
  return g;
}
const TUNIC = tunicGeo(), ROBE = tunicGeo(1.9, 1.15), DRESS = tunicGeo(2.1, 1.25);
const HEM_Y = { tunic: 0.55, robe: 0.55 - 0.9 * 0.25, dress: 0.55 - 1.1 * 0.25 };
const shieldShape = (() => {
  const s = new THREE.Shape();
  s.moveTo(-0.26, 0.35); s.lineTo(0.26, 0.35); s.lineTo(0.26, 0.05);
  s.quadraticCurveTo(0.22, -0.35, 0, -0.55); s.quadraticCurveTo(-0.22, -0.35, -0.26, 0.05); s.lineTo(-0.26, 0.35);
  return new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.01, bevelSegments: 1 });
})();

const SKIN = [0xd9a98a, 0xc99474, 0xe2b596, 0xb98266];
const HAIR = [0x2a1c12, 0x4a3320, 0x6b4a2a, 0x8a6a3a, 0x1a1512];
const shade = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();

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
  foe: { tunic: [0x2e4a26, 0x5a5a1e], legs: 0x3a3430, head: 'helm', item: 'spear', shield: true },
  merchant: { tunic: [0x2e5a4a, 0x7a3a1a, 0x5a4a7a, 0x8a6a2a], legs: 0x3a3028, head: 'hood', apron: 0xd8ccb0, item: null },
  townswoman: { tunic: [0x7a2a3a, 0x3d5a7a, 0x6a5a2a, 0x4a6a4a], legs: 0x3a3028, head: 'wimple', dress: true, item: null },
};

export function person(B, { x, y, z, yaw = 0, role = 'peasant', seed = 1, pose = 'stand' }) {
  const R = ROLES[role];
  const rnd = mulberry32(seed * 97 + 13);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const s = (R.scale || 1) * (0.93 + rnd() * 0.12);
  const root = new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), yaw), new V3(s, s, s));
  const rot = (rx = 0, ry = 0, rz = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  const M = (px, py, pz, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
    root.clone().multiply(new THREE.Matrix4().compose(new V3(px, py, pz), rot(rx, ry, rz), new V3(sx, sy, sz)));
  // дочерняя матрица: сдвиг и поворот относительно родителя
  const C = (parent, px, py, pz, rx = 0, ry = 0, rz = 0, sc = 1) =>
    parent.clone().multiply(new THREE.Matrix4().compose(new V3(px, py, pz), rot(rx, ry, rz), new V3(sc, sc, sc)));
  const skin = pick(SKIN), hair = pick(HAIR), tunic = pick(R.tunic);
  const legs = R.legs;
  const sw = seed;
  const female = !!R.dress;
  const child = (R.scale || 1) < 0.8;

  // ---- ноги: бедро, колено, голень, башмак ----
  const lean = pose === 'work' ? 0.35 : 0;
  for (const sd of [-1, 1]) {
    const step = pose === 'walk' ? sd * 0.3 : 0;
    const kneeBend = pose === 'walk' ? Math.max(0, -step) * 0.9 + 0.05 : pose === 'work' ? 0.25 : 0.03;
    B.curLimb = [sd, 0.9 * s]; // нога: качается вокруг бедра
    const hipA = step - (pose === 'work' ? 0.2 : 0);
    const hip = M(sd * 0.095, 0.9, 0, hipA, 0, sd * 0.025);
    B.add(G.thigh, hip, legs, 0, sw);
    const knee = C(hip, 0, -0.45, 0, kneeBend);
    B.add(G.knee, knee, legs, 0, sw);
    B.add(G.shin, knee, legs, 0, sw);
    const ankle = C(knee, 0, -0.43, 0, -(hipA + kneeBend)); // стопа остаётся горизонтальной
    B.add(G.shoe, C(ankle, 0, -0.035, 0), 0x2a1d14, 0, sw);
  }
  B.curLimb = [0, 0];

  // ---- туловище: туника / ряса / платье, кайма по подолу, пояс с кошелём ----
  const body = R.dress ? DRESS : R.robe ? ROBE : TUNIC;
  const bodyM = M(0, 0, 0, lean * 0.25);
  B.add(body, bodyM, tunic, 0.4, sw);
  const hemKind = R.dress ? 'dress' : R.robe ? 'robe' : 'tunic';
  const flare = R.dress ? 1.25 : R.robe ? 1.15 : 1;
  B.add(G.hem, C(bodyM, 0, HEM_Y[hemKind] + 0.02, 0, 0, 0, 0, 1).multiply(new THREE.Matrix4().makeScale(0.235 * flare, 1, 0.235 * flare * 0.7)), shade(tunic, 0.6), 0.4, sw);
  // ворот
  B.add(G.hem, C(bodyM, 0, 1.47, 0).multiply(new THREE.Matrix4().makeScale(0.09, 1.6, 0.075)), shade(tunic, 0.7), 0.4, sw);
  if (R.surcoat) {
    B.add(tunicGeo(1.3, 1.1), M(0, 0.02, 0, lean * 0.25, 0, 0, 1.06, 0.98, 1.08), R.surcoat, 0.4, sw);
    // крест на сюрко
    B.add(new THREE.BoxGeometry(0.05, 0.3, 0.01), M(0, 1.15, 0.165), 0xa01818, 0.4, sw);
    B.add(new THREE.BoxGeometry(0.2, 0.05, 0.01), M(0, 1.2, 0.165), 0xa01818, 0.4, sw);
  }
  if (R.apron) B.add(new THREE.BoxGeometry(0.34, 0.62, 0.02), M(0, 0.84, 0.15, 0.06), R.apron, 0.4, sw);
  B.add(G.belt, M(0, 0.98, 0, lean * 0.25, 0, 0, 1, 1, 0.74), 0x2a1d14, 0.4, sw);
  if (!R.robe && !R.dress) B.add(G.pouch, M(0.14, 0.9, 0.08, 0, -0.5), 0x5a3a1e, 0.4, sw);

  // ---- голова: шея, лицо (нос, глаза, брови, уши), волосы/борода, убор ----
  const hy = 1.6;
  const look = (rnd() - 0.5) * 0.6;
  B.add(G.neck, M(0, 1.5, 0.01), skin, 1, sw);
  const headM = M(0, hy, 0.01 + lean * 0.12, lean * 0.3, look);
  B.add(G.head, headM, skin, 1, sw);
  B.add(G.jaw, C(headM, 0, -0.025, 0.015), skin, 1, sw);
  B.add(G.nose, C(headM, 0, -0.005, 0.108), shade(skin, 0.93), 1, sw);
  for (const sd of [-1, 1]) {
    B.add(G.eye, C(headM, sd * 0.034, 0.022, 0.092), 0x1a1410, 1, sw);
    B.add(G.brow, C(headM, sd * 0.034, 0.042, 0.096, 0, 0, sd * -0.12), shade(hair, 0.8), 1, sw);
    B.add(G.ear, C(headM, sd * 0.096, 0.005, -0.005), shade(skin, 0.95), 1, sw);
  }
  // губы
  B.add(new THREE.BoxGeometry(0.034, 0.008, 0.01), C(headM, 0, -0.05, 0.094), 0x8a4a3a, 1, sw);
  const bearded = !female && !child && role !== 'priest' && rnd() < 0.45;
  if (bearded) B.add(G.beard, C(headM, 0, -0.03, 0.02), hair, 1, sw);
  switch (R.head) {
    case 'hair':
      B.add(G.hair, C(headM, 0, 0.012, -0.012, -0.25), hair, 1, sw);
      B.add(G.hairBack, C(headM, 0, -0.005, -0.01, 0, Math.PI), hair, 1, sw);
      break;
    case 'tonsure':
      B.add(G.hairBack, C(headM, 0, -0.01, -0.012, 0, Math.PI), 0x5a5048, 1, sw);
      break;
    case 'hood': {
      const hc = pick([0x6a3a1a, 0x4a5a3a, 0x7a6a4a, 0x8a2a1a, 0x3a4a6a]);
      B.add(G.hood, C(headM, 0, -0.02, -0.025, -0.35), hc, 1, sw);
      B.add(G.hoodCape, M(0, 1.43, -0.005, lean * 0.25, 0, 0, 1, 1, 0.8), hc, 0.8, sw); // оплечье капюшона
      B.add(G.liripipe, C(headM, 0, 0.02, -0.16, -2.3), hc, 1, sw); // хвост капюшона
      break;
    }
    case 'wimple':
      B.add(G.wimple, C(headM, 0, -0.02, -0.02, -0.3), 0xe8e2d2, 1, sw);
      B.add(G.veil, M(0, 1.48, -0.02, lean * 0.25, 0, 0, 1, 1, 0.85), 0xe0d8c4, 0.8, sw);
      break;
    case 'capeline':
      B.add(G.helmTop, C(headM, 0, 0.012, 0), 0x6e7074, 1, sw);
      B.add(G.brim, C(headM, 0, 0.01, 0, -0.06, 0, 0), 0x5e6064, 1, sw);
      break;
    case 'helm':
      // шапель — железная каска с широкими полями (типична для XIII века) и кольчужный капюшон
      B.add(G.coif, C(headM, 0, -0.03, -0.018, -0.2), 0x8a8e94, 1, sw);
      B.add(G.mailCape, M(0, 1.44, 0, 0, 0, 0, 1, 1, 0.8), 0x7e8288, 0.8, sw);
      B.add(G.helmTop, C(headM, 0, 0.018, 0), 0x6e7074, 1, sw);
      B.add(G.brim, C(headM, 0, 0.018, 0, -0.08), 0x5e6064, 1, sw);
      break;
  }

  // ---- руки: плечо, локоть, предплечье, манжета, кисть ----
  const armPose = { // [вперёд, в сторону, сгиб в локте]
    stand: [[0.08, 0.1, 0.18], [0.08, -0.1, 0.18]],
    spear: [[-0.35, 0.12, 1.0], [0.05, -0.1, 0.25]],
    bow: [[-1.45, 0.05, 0.1], [-1.2, -0.35, 1.2]],
    work: [[-0.6, 0.2, 0.7], [-0.5, -0.2, 0.7]],
    hammer: [[-0.6, 0.25, 1.4], [0.1, -0.1, 0.3]],
    bucket: [[0.05, 0.1, 0.1], [0.08, -0.14, 0.12]],
  }[R.item === 'spear' ? 'spear' : R.item === 'bow' ? 'bow' : pose === 'work' || R.item === 'hoe' ? 'work' : R.item === 'hammer' ? 'hammer' : R.item === 'bucket' ? 'bucket' : 'stand'];
  const sleeve = R.surcoat && !R.sword ? R.surcoat : R.mail ? 0x8a8e94 : tunic;
  const hands = [];
  [1, -1].forEach((sd, i) => {
    const [fx, sz, eb] = armPose[i];
    B.curLimb = [-sd * 0.6, 1.4 * s]; // рука — в противофазе с ногой
    const sh = M(sd * 0.225, 1.4, lean * 0.1, fx + lean * 0.3, 0, sd * Math.abs(sz));
    B.add(G.shoulder, sh, sleeve, 0.6, sw);
    B.add(G.upperArm, sh, sleeve, 0.6, sw);
    const el = C(sh, 0, -0.3, 0, -eb);
    B.add(G.joint, el, sleeve, 0.6, sw);
    B.add(G.foreArm, el, sleeve, 0.6, sw);
    B.add(G.cuff, C(el, 0, -0.26, 0), shade(sleeve, 0.65), 0.6, sw);
    const hm = C(el, 0, -0.33, 0);
    B.add(G.hand, hm, skin, 0.6, sw);
    hands.push(new V3().setFromMatrixPosition(hm));
  });
  B.curLimb = [0, 0];

  // ---- предметы ----
  const up = new V3(0, 1, 0);
  if (R.item === 'spear') {
    const base = hands[0].clone().add(new V3(0, -1.05 * s, 0));
    B.add(G.shaft, new THREE.Matrix4().compose(base, new THREE.Quaternion(), new V3(1, 2.5 * s, 1)), 0x5a3e24, 0.3, sw);
    B.add(G.tip, new THREE.Matrix4().compose(base.clone().add(new V3(0, 2.5 * s + 0.12, 0)), new THREE.Quaternion(), new V3(1, 1, 1)), 0x9a9ea4, 0.3, sw);
  }
  if (R.shield) {
    const col = pick([0x7a1c1c, 0xd6a632, 0x1d3f8a]);
    B.add(shieldShape, M(-0.05, 1.12, -0.2, 0.08, Math.PI, 0), col, 0.4, sw);
    B.add(new THREE.BoxGeometry(0.06, 0.62, 0.012), M(-0.05, 1.05, -0.245, 0.08, Math.PI, 0), 0xe8e0c8, 0.4, sw);
  }
  if (R.item === 'bow') {
    const bow = new THREE.TorusGeometry(0.62, 0.014, 5, 20, Math.PI * 0.9);
    B.add(bow, M(0.15, 1.42, 0.62, 0, Math.PI / 2, Math.PI / 2 - Math.PI * 0.45), 0x6a4a2a, 0.3, sw);
    B.add(new THREE.CylinderGeometry(0.07, 0.06, 0.45, 8), M(0.12, 1.25, -0.16, 0.25), 0x5a3a1e, 0.3, sw); // колчан
  }
  if (R.item === 'hammer') {
    const h = hands[0];
    B.add(G.shaft, new THREE.Matrix4().compose(h.clone().add(new V3(0, -0.08, 0)), new THREE.Quaternion(), new V3(1, 0.4, 1)), 0x5a3e24, 0.3, sw);
    B.add(new THREE.BoxGeometry(0.16, 0.07, 0.07), new THREE.Matrix4().compose(h.clone().add(new V3(0, 0.3, 0)), new THREE.Quaternion().setFromAxisAngle(up, yaw), new V3(1, 1, 1)), 0x3a3a3e, 0.3, sw);
  }
  if (R.item === 'hoe') {
    const h = hands[0];
    const tilt = new THREE.Quaternion().setFromAxisAngle(new V3(Math.cos(yaw), 0, -Math.sin(yaw)), 0.6);
    const base = h.clone().add(new V3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(-0.8)).add(new V3(0, -0.9, 0));
    B.add(G.shaft, new THREE.Matrix4().compose(base, tilt, new V3(1, 1.7, 1)), 0x6a4a2a, 0.3, sw);
  }
  if (R.item === 'bucket') B.add(G.bucket, new THREE.Matrix4().compose(hands[1].clone().add(new V3(0, -0.16, 0)), new THREE.Quaternion(), new V3(1, 1, 1)), 0x6a4a2a, 0.3, sw);
  if (R.sword) {
    B.add(new THREE.BoxGeometry(0.05, 0.95, 0.015), M(-0.22, 0.55, 0.05, 0, 0, 0.12), 0xb0b4ba, 0.2, sw);
    B.add(new THREE.BoxGeometry(0.22, 0.03, 0.03), M(-0.2, 1.03, 0.05, 0, 0, 0.12), 0x6a5a3a, 0.2, sw);
    B.add(new THREE.SphereGeometry(0.03, 6, 4), M(-0.18, 1.2, 0.05), 0xc8a040, 0.2, sw);
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
