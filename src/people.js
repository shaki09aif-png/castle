// Люди: стража на стенах и у ворот, лучники, кузнец, священник, рыцарь,
// слуги, крестьяне в деревне и на полях. Простые фигуры в одежде XIII века
// (туника, шоссы, капюшон, шлемы-шапели, сюрко) собраны в одну сетку с
// цветами вершин — один вызов отрисовки на всех. Лёгкое «дыхание» и
// покачивание делает шейдер.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

const V3 = THREE.Vector3;

// Общее время для покачивания хвостов (коровы, лошади) в статичных сетках
export const SWAY_TIME = { value: 0 };
// GLSL: хвосты (aSway.x = 2, aSway.y — высота корня хвоста) описывают петлю
export const TAIL_GLSL = `
  if (aSway.x > 1.5 && aSway.x < 2.5) {
    float tk = clamp((aSway.y - transformed.y) / 0.9, 0.0, 1.0);
    float ph = uSwayTime * 1.9 + aSway.y * 7.3 + position.x * 0.0;
    transformed.x += sin(ph) * 0.2 * tk;
    transformed.z += cos(ph * 0.8) * 0.14 * tk;
  }`;
// добавить покачивание хвостов в материал с цветами вершин
export function addTailSway(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uSwayTime = SWAY_TIME;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aSway;\nuniform float uSwayTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + TAIL_GLSL);
  };
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.customProgramCacheKey = () => 'tail-' + key();
  return mat;
}

export class ColorBuilder {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.aux = []; this.idx = []; this.limb = []; this.curLimb = [0, 0]; this.piv = []; this.curPiv = [0, 0]; this.mat = []; this.curMat = 0; }
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
      this.piv.push(this.curPiv[0], this.curPiv[1]); // шея фигуры (x, z) — ось поворота головы
      this.mat.push(this.curMat); // из чего поверхность: 1 ткань, 2 кожа, 3 металл, 4 волосы, 5 выделанная кожа, 6 кольчуга, 7 ткань с узором
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }
  // затенить только что добавленную геометрию по её исходным координатам
  // (складки ткани темнее, низ одежды темнее верха) — «запечённый» объём
  shadeLast(geo, fn) {
    const p = geo.getAttribute('position'), n = p.count, base = this.col.length / 3 - n;
    for (let i = 0; i < n; i++) {
      const k = fn(p.getX(i), p.getY(i), p.getZ(i));
      for (let c = 0; c < 3; c++) this.col[(base + i) * 3 + c] *= typeof k === 'number' ? k : k[c];
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.aux, 2));
    if (this.limb.some((v) => v !== 0)) g.setAttribute('aLimb', new THREE.Float32BufferAttribute(this.limb, 2));
    if (this.piv.some((v) => v !== 0)) g.setAttribute('aPivot', new THREE.Float32BufferAttribute(this.piv, 2));
    if (this.mat.some((v) => v !== 0)) g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// Поверхности людей: ткань с плетением нитей и неровным окрасом, кожа с тёплым
// просвечиванием по краям и лёгким блеском, металл и кольчуга с бликами,
// волосы прядями. Мелкий узор виден только вблизи и плавно исчезает с
// расстоянием (чтобы не рябило). Материал определяется атрибутом aMat.
export function addPersonShading(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aMat;\nvarying float vMat;\nvarying vec3 vOP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat;\nvOP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vMat;
        varying vec3 vOP;
        float pHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        float pNoise(vec3 p) {
          vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(pHash(i), pHash(i + vec3(1, 0, 0)), f.x), mix(pHash(i + vec3(0, 1, 0)), pHash(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(pHash(i + vec3(0, 0, 1)), pHash(i + vec3(1, 0, 1)), f.x), mix(pHash(i + vec3(0, 1, 1)), pHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float pm = floor(vMat + 0.5);
        float pd = length(vViewPosition);
        if (pm > 0.5 && pd < 40.0) {
          float near = 1.0 - smoothstep(0.6, 3.5, pd), mid = 1.0 - smoothstep(4.0, 40.0, pd);
          if (pm < 1.5 || pm > 4.5 && pm < 5.5 || pm > 6.5) { // ткань, выделанная кожа, ткань с узором
            float mott = pNoise(vOP * 22.0);
            diffuseColor.rgb *= 1.0 + (mott - 0.5) * 0.2 * mid;
            if (pm > 6.5) { // дорогая ткань: вытканный ромбический узор
              vec2 q = vec2(vOP.y * 26.0, (vOP.x + vOP.z) * 26.0);
              vec2 d = abs(fract(vec2(q.x + q.y, q.x - q.y) * 0.5) - 0.5);
              float lz = smoothstep(0.08, 0.04, abs(d.x + d.y - 0.36));
              diffuseColor.rgb *= 1.0 + lz * 0.22 * mid;
            }
            if (near > 0.0) {
            if (pm < 1.5 || pm > 6.5) {
              float w = sin(vOP.y * 1400.0) * sin((vOP.x + vOP.z) * 1400.0);
              float slub = pNoise(vec3(vOP.y * 900.0, (vOP.x + vOP.z) * 60.0, 0.0));
              diffuseColor.rgb *= 1.0 + (w * 0.09 + (slub - 0.5) * 0.1) * near;
            } else diffuseColor.rgb *= 1.0 + (pNoise(vOP * 300.0) - 0.5) * 0.18 * near;
            }
          } else if (pm < 2.5) { // кожа лица и рук: неровный тон, поры
            diffuseColor.rgb *= 1.0 + (pNoise(vOP * 90.0) - 0.5) * 0.08 * mid;
            if (near > 0.0) diffuseColor.rgb *= 1.0 + (pNoise(vOP * 700.0) - 0.5) * 0.05 * near;
          } else if (pm < 3.5) { // металл: потёртости
            diffuseColor.rgb *= 0.85 + 0.3 * pNoise(vOP * 45.0);
          } else if (pm < 4.5) { // волосы: пряди вдоль роста
            float st = pNoise(vec3(vOP.x * 420.0, vOP.y * 25.0, vOP.z * 420.0));
            diffuseColor.rgb *= 0.78 + 0.42 * st * mid + 0.21 * (1.0 - mid);
          } else { // кольчуга: кольца
            float ring = abs(sin(vOP.y * 520.0) * sin((vOP.x + vOP.z) * 520.0));
            diffuseColor.rgb *= 0.7 + 0.5 * mix(0.5, ring, 1.0 - smoothstep(0.8, 6.0, pd));
          }
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        if (pm > 1.5 && pm < 2.5) roughnessFactor = 0.62;
        else if (pm > 2.5 && pm < 3.5) roughnessFactor = 0.38;
        else if (pm > 3.5 && pm < 4.5) roughnessFactor = 0.66;
        else if (pm > 4.5 && pm < 5.5) roughnessFactor = 0.72;
        else if (pm > 5.5 && pm < 6.5) roughnessFactor = 0.45;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        if (pm > 2.5 && pm < 3.5 || pm > 5.5 && pm < 6.5) metalnessFactor = 0.7;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (pm > 1.5 && pm < 2.5) { // подповерхностное рассеяние: края кожи чуть краснеют на свету
          float rim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.5);
          totalEmissiveRadiance += diffuseColor.rgb * vec3(0.5, 0.16, 0.1) * rim * 0.35;
        }`);
  };
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.customProgramCacheKey = () => 'person-' + key();
  return mat;
}

// простое слияние нескольких геометрий в одну (без индексов)
function mergeSmall(list) {
  const pos = [], nrm = [];
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.getAttribute('position').array);
    nrm.push(...g.getAttribute('normal').array);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}
// кисть: ладонь, согнутые пальцы (одним блоком со «шлицами») и большой палец —
// всего три коробки, чтобы сотни людей не утяжеляли сцену
function handGeometry() {
  // ладонь, четыре пальца (слегка согнуты, разной длины) и большой палец
  const parts = [new THREE.BoxGeometry(0.068, 0.07, 0.028).translate(0, -0.01, 0)];
  [[-0.024, 0.042], [-0.008, 0.048], [0.008, 0.046], [0.024, 0.038]].forEach(([x, L]) => {
    const f = new THREE.BoxGeometry(0.0145, L, 0.016).translate(0, -L / 2, 0);
    f.rotateX(0.35 + Math.abs(x) * 6); f.translate(x, -0.044, 0.002);
    parts.push(f);
  });
  const th = new THREE.BoxGeometry(0.017, 0.046, 0.018).translate(0, -0.022, 0);
  th.rotateZ(-0.6); th.rotateX(0.35); th.translate(0.033, -0.006, 0.012);
  parts.push(th);
  return mergeSmall(parts);
}

// убор, плотно облегающий голову, с вырезом для лица: макушка целиком, по бокам
// и сзади — ткань (или кольчуга), спереди открыто лицо; снизу — полоса под подбородком
function openHood(r, t0, t1, t2, open = 0.9) {
  const cap = new THREE.SphereGeometry(r, 14, 4, 0, Math.PI * 2, 0, t0);
  const ring = new THREE.SphereGeometry(r, 12, 6, Math.PI / 2 + open, Math.PI * 2 - 2 * open, t0, t1 - t0);
  const low = new THREE.SphereGeometry(r, 14, 2, 0, Math.PI * 2, t1, t2 - t1);
  const g = mergeSmall([cap, ring, low]);
  g.scale(1, 1.12, 1.06); // голова вытянута — убор тоже
  return g;
}
// передник, облегающий тело: часть усечённого конуса спереди, завязки на поясе
function apronGeo(len, w = 1.5) {
  const g = new THREE.CylinderGeometry(0.205, 0.25 + len * 0.06, len, 9, 3, true, -w / 2, w);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) { // лёгкие складки к низу
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = (len / 2 - y) / len;
    const f = 1 + 0.03 * k * Math.sin(Math.atan2(x, z) * 11);
    p.setXYZ(i, x * f, y, z * f * 0.74);
  }
  g.computeVertexNormals();
  g.translate(0, -len / 2, 0);
  return g;
}

// общие заготовки геометрии (фигура ~1,7 м; начало координат — между ступнями)
const G = {
  // бедро: полнее сверху и спереди; голень: икра сзади, узкая лодыжка
  thigh: (() => {
    const g = new THREE.CylinderGeometry(0.074, 0.058, 0.45, 10, 3);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) { const y = p.getY(i), z = p.getZ(i), t = (y + 0.225) / 0.45; const k = 1 + 0.08 * Math.sin(t * Math.PI) * (z > 0 ? 1 : 0.4); p.setXYZ(i, p.getX(i) * (1 + 0.03 * Math.sin(t * Math.PI)), y, z * k); }
    g.computeVertexNormals();
    return g.translate(0, -0.225, 0);
  })(),
  shin: (() => {
    const g = new THREE.CylinderGeometry(0.056, 0.036, 0.43, 10, 4);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), z = p.getZ(i), t = (y + 0.215) / 0.43; // 0 — лодыжка, 1 — колено
      const calf = Math.exp(-((t - 0.68) ** 2) / 0.03);
      const k = z < 0 ? 1 + 0.35 * calf : 1 + 0.06 * calf;
      p.setXYZ(i, p.getX(i) * (1 + 0.12 * calf), y, z * k);
    }
    g.computeVertexNormals();
    return g.translate(0, -0.215, 0);
  })(),
  knee: new THREE.SphereGeometry(0.06, 6, 4),
  shoe: (() => { const g = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(0.058, 0.075, 0.135); g.translate(0, 0, 0.035); return g; })(),
  upperArm: (() => { const g = new THREE.CylinderGeometry(0.056, 0.048, 0.3, 10, 3); const p = g.getAttribute('position'); for (let i = 0; i < p.count; i++) { const y = p.getY(i); const k = 1 + 0.08 * Math.sin((y + 0.15) / 0.3 * Math.PI); p.setXYZ(i, p.getX(i) * k, y, p.getZ(i) * k); } g.computeVertexNormals(); return g.translate(0, -0.15, 0); })(),
  foreArm: new THREE.CylinderGeometry(0.047, 0.037, 0.28, 10).translate(0, -0.14, 0),
  joint: new THREE.SphereGeometry(0.05, 6, 4),
  shoulder: (() => { const g = new THREE.SphereGeometry(0.06, 8, 6); g.scale(1.0, 0.95, 1.1); return g; })(),
  // дельтовидная «накладка» — плавный переход от плеча туловища к руке
  deltoid: (() => { const g = new THREE.SphereGeometry(0.07, 8, 3, 0, Math.PI * 2, 0, Math.PI * 0.55); g.scale(1.25, 0.7, 1.05); return g; })(),
  cuff: new THREE.CylinderGeometry(0.047, 0.047, 0.04, 8, 1, true),
  hand: handGeometry(),
  // голова по форме черепа: виски и челюсть уже, затылок выпуклый, надбровье,
  // скулы, глазные впадины
  head: (() => {
    const g = new THREE.SphereGeometry(0.1, 16, 12);
    const p = g.getAttribute('position');
    const gs = (x, y, z, cx, cy, cz, r) => Math.exp(-((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) / (r * r));
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const ny = y / 0.1;
      x *= 1 - 0.1 * Math.max(0, -ny) - 0.06 * gs(0, y, 0, 0, 0.03, 0, 0.05); // уже к подбородку и в висках
      if (z < 0) { z *= 1.08; y += 0.006 * Math.max(0, -z / 0.1); } // затылок
      if (z > 0) {
        z += 0.008 * gs(x, y, 0, 0, 0.045, 0, 0.03) * Math.abs(x) / 0.03; // надбровные дуги
        for (const sd of [-1, 1]) {
          z -= 0.009 * gs(x, y, z, sd * 0.034, 0.02, 0.09, 0.02); // глазные впадины
          x += sd * 0.006 * gs(x, y, z, sd * 0.055, -0.012, 0.07, 0.025); // скулы
        }
        z *= 1 - 0.05 * Math.max(0, ny - 0.3); // покатый лоб
      }
      p.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    g.scale(0.95, 1.12, 1.02);
    return g;
  })(),
  iris: (() => { const g = new THREE.SphereGeometry(0.0062, 6, 3); g.scale(1, 1, 0.45); return g; })(),
  pupil: (() => { const g = new THREE.SphereGeometry(0.003, 5, 2); g.scale(1, 1, 0.45); return g; })(),
  lid: (() => { const g = new THREE.SphereGeometry(0.0145, 6, 2, 0, Math.PI * 2, 0, Math.PI * 0.42); g.scale(1, 0.72, 0.6); return g; })(),
  noseBridge: (() => { const g = new THREE.CylinderGeometry(0.007, 0.013, 0.05, 6); g.rotateX(-0.42); return g; })(),
  noseTip: new THREE.SphereGeometry(0.0125, 6, 4),
  nostril: new THREE.SphereGeometry(0.0085, 5, 3),
  lip: (() => { const g = new THREE.SphereGeometry(1, 7, 4); g.scale(0.019, 0.0048, 0.008); return g; })(),
  jaw: (() => { const g = new THREE.SphereGeometry(0.075, 12, 8, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55); g.scale(1, 0.9, 1.1); return g; })(),
  nose: (() => { const g = new THREE.ConeGeometry(0.018, 0.05, 6); g.rotateX(Math.PI / 2 + 0.5); return g; })(),
  eye: new THREE.SphereGeometry(0.0085, 6, 4),
  eyeWhite: (() => { const g = new THREE.SphereGeometry(0.0135, 6, 4); g.scale(1, 0.6, 0.5); return g; })(),
  brow: (() => { const g = new THREE.SphereGeometry(1, 6, 3); g.scale(0.019, 0.0042, 0.006); return g; })(),
  ear: (() => { const g = new THREE.SphereGeometry(1, 6, 5); g.scale(0.012, 0.028, 0.02); return g; })(),
  beard: (() => { const g = new THREE.SphereGeometry(0.085, 12, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.4); g.scale(0.95, 1.2, 1.05); return g; })(),
  neck: new THREE.CylinderGeometry(0.045, 0.052, 0.1, 10),
  belt: new THREE.TorusGeometry(0.19, 0.02, 5, 20).rotateX(Math.PI / 2),
  pouch: new THREE.BoxGeometry(0.08, 0.1, 0.04),
  hem: new THREE.TorusGeometry(1, 0.018, 3, 20).rotateX(Math.PI / 2),
  hair: new THREE.SphereGeometry(0.112, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.56),
  // шапка волос с линией роста: лоб открыт, виски ниже, на затылке — до шеи
  hairCap: (() => {
    const g = new THREE.SphereGeometry(0.106, 13, 9, 0, Math.PI * 2, 0, Math.PI * 0.78);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(x, z); // 0 — лоб, ±π — затылок
      const front = Math.cos(a);
      const line = front > 0 ? 0.052 - 0.07 * (1 - front) : -0.018 - 0.06 * -front; // высота линии роста
      p.setXYZ(i, x, Math.max(y, line) + (y < line ? 0.002 : 0), z);
    }
    g.computeVertexNormals();
    g.scale(0.97, 1.1, 1.04);
    return g;
  })(),
  lock: (() => { const g = new THREE.SphereGeometry(1, 5, 3); g.translate(0, -1, 0); return g; })(),
  capBand: new THREE.CylinderGeometry(0.121, 0.123, 0.032, 16, 1, true),
  mustache: (() => { const g = new THREE.SphereGeometry(1, 6, 3); g.scale(0.022, 0.006, 0.009); return g; })(),
  hairBack: (() => { const g = new THREE.SphereGeometry(0.108, 12, 8, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.3, Math.PI * 0.45); return g; })(),
  hood: openHood(0.134, Math.PI * 0.28, Math.PI * 0.62, Math.PI * 0.68, 0.95),
  hoodCape: new THREE.CylinderGeometry(0.12, 0.3, 0.2, 16, 1, true),
  liripipe: new THREE.ConeGeometry(0.035, 0.35, 6),
  capeline: new THREE.CylinderGeometry(0.12, 0.13, 0.12, 12),
  brim: new THREE.CylinderGeometry(0.21, 0.21, 0.025, 18),
  helmTop: new THREE.SphereGeometry(0.121, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  coif: openHood(0.128, Math.PI * 0.3, Math.PI * 0.64, Math.PI * 0.72, 0.85),
  mailCape: new THREE.CylinderGeometry(0.12, 0.27, 0.16, 16, 1, true),
  wimple: openHood(0.124, Math.PI * 0.3, Math.PI * 0.66, Math.PI * 0.8, 0.88),
  apron: apronGeo(0.62), apronLong: apronGeo(0.78, 1.7), apronW: apronGeo(0.66, 1.6),
  veil: new THREE.CylinderGeometry(0.11, 0.2, 0.3, 16, 1, true, Math.PI * 0.6, Math.PI * 1.8),
  shaft: new THREE.CylinderGeometry(0.018, 0.018, 1, 6).translate(0, 0.5, 0),
  tip: new THREE.ConeGeometry(0.04, 0.25, 6),
  bucket: new THREE.CylinderGeometry(0.14, 0.11, 0.25, 12),
  // плащ: полукруг ткани от плеч почти до колен, сзади, с мягкими складками
  cloak: (() => {
    const pts = [[0.2, 1.46], [0.26, 1.3], [0.3, 1.0], [0.34, 0.72], [0.37, 0.52]].map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(pts, 14, Math.PI * 0.3, Math.PI * 1.4);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
      const k = 1 + 0.06 * Math.sin(a * 7) * Math.max(0, (1.3 - y) / 0.8);
      p.setXYZ(i, x * k, y, z * k * 0.78);
    }
    g.computeVertexNormals();
    // изнанка (видна спереди, где плащ распахнут)
    const inner = g.toNonIndexed(); inner.scale(0.97, 1, 0.97);
    const ip = inner.getAttribute('position'), inn = inner.getAttribute('normal');
    for (let i = 0; i < ip.count; i += 3) for (const a of [ip, inn]) { const t = [a.getX(i + 1), a.getY(i + 1), a.getZ(i + 1)]; a.setXYZ(i + 1, a.getX(i + 2), a.getY(i + 2), a.getZ(i + 2)); a.setXYZ(i + 2, ...t); }
    for (let i = 0; i < inn.count; i++) inn.setXYZ(i, -inn.getX(i), -inn.getY(i), -inn.getZ(i));
    return mergeSmall([g, inner]);
  })(),
  hatBrim: new THREE.CylinderGeometry(0.25, 0.26, 0.018, 16),
  hatCrown: new THREE.CylinderGeometry(0.09, 0.12, 0.12, 12),
  cap: (() => { const g = new THREE.SphereGeometry(0.118, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.5); g.scale(1, 0.9, 1.05); return g; })(),
  kerchief: new THREE.SphereGeometry(0.124, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62),
  band: new THREE.TorusGeometry(1, 0.012, 4, 14).rotateX(Math.PI / 2),
};
// цвет отделки (каймы, ворота, манжет) — вышитая тесьма у зажиточных
const TRIM = [0xd6a632, 0x7a1c1c, 0x1d3f8a, 0xe8e0c8, 0x2f5a3a, 0x5a2a6a];
const POOR = { peasant: 1, servant: 1, reaper: 1, woman: 1, child: 1, smith: 1 };
function tunicGeo(len = 1, flare = 1, bust = 0) {
  // от колен до плеч; подол расширяется, плечи скруглены
  const pts = [
    [0.235 * flare, 0.55 + (1 - len) * 0.25], [0.215 * (0.5 + flare * 0.5), 0.72], [0.195, 0.9], [0.182, 0.99], [0.19, 1.1],
    [0.212, 1.24], [0.228, 1.34], [0.215, 1.41], [0.16, 1.46], [0.07, 1.495], [0.04, 1.5],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 20);
  // складки ткани: мягкие вертикальные волны, сильнее к подолу, у пояса почти нет
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = Math.max(0, Math.min(1, (0.98 - y) / 0.4)) * 0.05 + Math.max(0, Math.min(1, (y - 1.12) / 0.2)) * 0.012;
    const f = 1 + k * (Math.sin(a * 9) * 0.8 + Math.sin(a * 5 + 1.3) * 0.4);
    // грудь и лопатки: объём спереди на уровне груди, чуть — сзади
    const chest = Math.exp(-((y - 1.26) ** 2) / 0.006);
    const fz = z > 0 ? 1 + (0.06 + bust) * chest * (z / Math.hypot(x, z)) ** 2 : 1 + 0.03 * chest;
    p.setXYZ(i, x * f, y, z * f * fz);
  }
  g.computeVertexNormals();
  g.scale(1, 1, 0.7);
  return g;
}
// объём ткани: вглубь складок темнее, к подолу темнее, под поясом — тень напуска
function clothShade(x, y, z) {
  const a = Math.atan2(z / 0.7, x);
  const fold = Math.sin(a * 9) * 0.8 + Math.sin(a * 5 + 1.3) * 0.4;
  const w = Math.max(0, Math.min(1, (0.98 - y) / 0.4));
  const grad = 0.8 + 0.2 * Math.min(1, Math.max(0, (y - 0.4) / 0.9));
  const belt = y > 0.9 && y < 0.98 ? 0.9 : 1;
  return grad * (1 + 0.12 * fold * w) * belt;
}
const TUNIC = tunicGeo(), ROBE = tunicGeo(1.9, 1.15), DRESS = tunicGeo(2.1, 1.25, 0.1);
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
  reaper: { tunic: [0xd8ccb0, 0x8a7a5a, 0x6a5a3a], legs: 0x5a4a38, head: 'hood', item: 'scythe' },
  minstrel: { tunic: [0x8a2a6a, 0x2a6a4a], legs: 0xc8a040, head: 'hair', item: 'lute' },
  merchant: { tunic: [0x2e5a4a, 0x7a3a1a, 0x5a4a7a, 0x8a6a2a], legs: 0x3a3028, head: 'hood', apron: 0xd8ccb0, item: null },
  townswoman: { tunic: [0x7a2a3a, 0x3d5a7a, 0x6a5a2a, 0x4a6a4a], legs: 0x3a3028, head: 'wimple', dress: true, item: null },
};

// Волосы: шапка с линией роста и пряди-«локоны» по краю (у каждого своя длина),
// у некоторых чёлка. style: 'short' — коротко, 'bob' — до подбородка (типично для XIII века)
function addHair(B, C, headM, hair, style, rnd, sw, under = false) {
  B.add(G.hairCap, C(headM, 0, 0.004, -0.004), hair, 1, sw);
  const bob = style === 'bob';
  const n = bob ? 14 : 10;
  const tuck = bob ? 0.14 : 0.32;
  for (let k = 0; k < n; k++) {
    const a = (-0.7 + 1.4 * (k / (n - 1))) * Math.PI + (rnd() - 0.5) * 0.08;
    const aa = a + Math.PI; // π — затылок, около 0.3π и 1.7π — виски
    const dx = Math.sin(aa), dz = Math.cos(aa);
    if (under && dz > -0.5) continue; // под шапкой видно только затылок
    const y0 = dz > 0 ? 0.052 - 0.07 * (1 - dz) : -0.018 - 0.06 * -dz; // линия роста
    const L = (bob ? 0.062 : 0.026) * (0.75 + rnd() * 0.5) * (dz > 0.2 ? 0.75 : 1);
    const c = new THREE.Color(hair).multiplyScalar(0.86 + rnd() * 0.26).getHex();
    B.add(G.lock, C(headM, dx * 0.097, y0 * 1.1 + 0.022, dz * 0.1, dz * tuck, 0, -dx * tuck)
      .multiply(new THREE.Matrix4().makeRotationY(aa)).multiply(new THREE.Matrix4().makeScale(0.017 + rnd() * 0.006, L * 0.5 + 0.012, 0.0085)), c, 1, sw);
  }
  if (!under && (bob || rnd() < 0.4)) for (let k = 0; k < 4; k++) { // чёлка
    const x = (k - 1.5) * 0.022 + (rnd() - 0.5) * 0.006;
    B.add(G.lock, C(headM, x, 0.083, 0.094 - Math.abs(x) * 0.3, -0.12, 0, x * 2.5)
      .multiply(new THREE.Matrix4().makeScale(0.012, 0.009 + rnd() * 0.008, 0.005)), new THREE.Color(hair).multiplyScalar(0.9 + rnd() * 0.2).getHex(), 1, sw);
  }
}

export function person(B, { x, y, z, yaw = 0, role = 'peasant', seed = 1, pose = 'stand', item: itemArg }) {
  const R = ROLES[role];
  const IT = itemArg !== undefined ? itemArg : R.item; // предмет в руках (можно задать явно)
  // сидя (за столом) и верхом: фигура опускается, ноги согнуты
  const sit = pose === 'sit', ride = pose === 'ride';
  const drop = sit || ride ? 0.43 : 0;
  const rnd = mulberry32(seed * 97 + 13);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const s = (R.scale || 1) * (0.93 + rnd() * 0.12);
  const root = new THREE.Matrix4().compose(new V3(x, y - drop * (R.scale || 1), z), new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), yaw), new V3(s, s, s));
  { const nk = new V3(0, 1.5, 0).applyMatrix4(root); B.curPiv = [nk.x, nk.z]; }
  const rot = (rx = 0, ry = 0, rz = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  const M = (px, py, pz, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
    root.clone().multiply(new THREE.Matrix4().compose(new V3(px, py, pz), rot(rx, ry, rz), new V3(sx, sy, sz)));
  // дочерняя матрица: сдвиг и поворот относительно родителя
  const C = (parent, px, py, pz, rx = 0, ry = 0, rz = 0, sc = 1) =>
    parent.clone().multiply(new THREE.Matrix4().compose(new V3(px, py, pz), rot(rx, ry, rz), new V3(sc, sc, sc)));
  const skin = pick(SKIN), hair = pick(HAIR), tunic = pick(R.tunic);
  const legs = R.legs;
  const female = !!R.dress;
  const child = (R.scale || 1) < 0.8;
  const poor = !!POOR[role];
  const parti = (role === 'noble' || role === 'minstrel') && rnd() < 0.6; // шоссы разного цвета
  const legs2 = parti ? pick(TRIM) : legs;
  const pointy = role === 'noble' || role === 'knight' || role === 'merchant' || role === 'minstrel';
  const wraps = poor && !female && !child && rnd() < 0.6; // обмотки на голенях
  const trim = poor || role === 'priest' ? null : pick(TRIM);
  const sw = seed;
  const MT = (m) => { B.curMat = m; };
  MT(1);

  // ---- ноги: бедро, колено, голень, башмак ----
  const lean = pose === 'work' ? 0.35 : 0;
  for (const sd of [-1, 1]) {
    const step = pose === 'walk' ? sd * 0.3 : 0;
    let kneeBend = pose === 'walk' ? Math.max(0, -step) * 0.9 + 0.05 : pose === 'work' ? 0.25 : 0.03;
    B.curLimb = sit || ride ? [0, 0] : [sd, 0.9 * s]; // нога: качается вокруг бедра
    let hipA = step - (pose === 'work' ? 0.2 : 0);
    let spread = sd * 0.025;
    if (sit) { hipA = -1.5; kneeBend = 1.45; spread = sd * 0.06; }
    if (ride) { hipA = -0.75; kneeBend = 1.0; spread = sd * 0.62; }
    const hip = M(sd * 0.095, 0.9, 0, hipA, 0, spread);
    const lc = sd < 0 ? legs2 : legs;
    B.add(G.thigh, hip, lc, 0, sw);
    const knee = C(hip, 0, -0.45, 0, kneeBend);
    B.add(G.knee, knee, lc, 0, sw);
    B.add(G.shin, knee, lc, 0, sw);
    // пыль дороги на голенях, у бедняков сильнее
    B.shadeLast && B.shadeLast(G.shin, (x, y) => { const d = Math.max(0, Math.min(1, (-0.2 - y) / 0.23)) * (poor ? 0.4 : 0.15); return [1 - d * 0.2, 1 - d * 0.3, 1 - d * 0.45]; });
    if (wraps) for (const yy of [-0.08, -0.17, -0.26, -0.35]) B.add(G.band, C(knee, 0, yy, 0).multiply(new THREE.Matrix4().makeScale(0.055, 1, 0.055)), 0xb8a888, 0, sw);
    const ankle = C(knee, 0, -0.43, 0, -(hipA + kneeBend)); // стопа остаётся горизонтальной
    MT(5);
    B.add(G.shoe, C(ankle, 0, -0.035, pointy ? 0.02 : 0).multiply(new THREE.Matrix4().makeScale(1, 1, pointy ? 1.4 : 1)), pointy ? 0x3a2418 : 0x2a1d14, 0, sw);
  }
  B.curLimb = [0, 0];
  MT(1);

  // ---- туловище: туника / ряса / платье, кайма по подолу, пояс с кошелём ----
  const body = R.dress ? DRESS : R.robe ? ROBE : TUNIC;
  const bodyM = M(0, 0, 0, lean * 0.25);
  const rich = role === 'noble' || role === 'merchant' && rnd() < 0.5 || role === 'minstrel';
  if (rich) MT(7);
  B.add(body, bodyM, tunic, 0.4, sw);
  B.shadeLast && B.shadeLast(body, clothShade);
  // бедняки: пыль и грязь по подолу, выгоревшие на солнце плечи
  if (poor) B.shadeLast && B.shadeLast(body, (x, y) => {
    const dirt = Math.max(0, Math.min(1, (0.85 - y) / 0.35)) * 0.35;
    const sun = Math.max(0, Math.min(1, (y - 1.3) / 0.15)) * 0.1;
    return [(1 - dirt * 0.25) * (1 + sun), (1 - dirt * 0.35) * (1 + sun), (1 - dirt * 0.5) * (1 + sun * 0.8)];
  });
  MT(1);
  const hemKind = R.dress ? 'dress' : R.robe ? 'robe' : 'tunic';
  const flare = R.dress ? 1.25 : R.robe ? 1.15 : 1;
  B.add(G.hem, C(bodyM, 0, HEM_Y[hemKind] + 0.02, 0, 0, 0, 0, 1).multiply(new THREE.Matrix4().makeScale(0.235 * flare, trim ? 2 : 1, 0.235 * flare * 0.7)), trim || shade(tunic, 0.6), 0.4, sw);
  if (trim) B.add(G.hem, C(bodyM, 0, HEM_Y[hemKind] + 0.09, 0).multiply(new THREE.Matrix4().makeScale(0.229 * flare, 0.6, 0.229 * flare * 0.7)), shade(trim, 0.7), 0.4, sw);
  // ворот
  B.add(G.hem, C(bodyM, 0, 1.47, 0).multiply(new THREE.Matrix4().makeScale(0.09, trim ? 2.2 : 1.6, 0.075)), trim || shade(tunic, 0.7), 0.4, sw);
  // разрез ворота у мужской туники
  if (!R.dress && !R.robe && !R.surcoat && !child) B.add(new THREE.BoxGeometry(0.012, 0.085, 0.006), C(bodyM, 0, 1.425, 0.151, -0.42), shade(tunic, 0.45), 0.4, sw);
  // заплаты на одежде бедняков
  if (poor && !child && rnd() < 0.55) for (let k = 0; k < 2; k++) {
    const a = (rnd() - 0.5) * 1.6 + (k ? Math.PI : 0), yy = 0.7 + rnd() * 0.35;
    B.add(new THREE.BoxGeometry(0.09, 0.08, 0.01), M(Math.sin(a) * 0.2, yy, Math.cos(a) * 0.15, 0, a), shade(tunic, rnd() < 0.5 ? 0.72 : 1.25), 0.4, sw);
  }
  // безрукавная котта поверх туники у зажиточных горожан
  if ((role === 'merchant' || role === 'townswoman' || role === 'noble') && rnd() < 0.5) {
    const sc = pick([0x7a1c1c, 0x1d3f8a, 0x2f5a3a, 0x6a4a2a, 0x5a2a6a].filter((c) => c !== tunic));
    B.add(female ? DRESS : TUNIC, M(0, female ? 0.12 : 0.05, 0, lean * 0.25, 0, 0, 1.07, 0.93, 1.1), sc, 0.4, sw);
    B.shadeLast && B.shadeLast(female ? DRESS : TUNIC, clothShade);
    if (trim) B.add(G.hem, C(bodyM, 0, (female ? HEM_Y.dress + 0.14 : HEM_Y.tunic + 0.08), 0).multiply(new THREE.Matrix4().makeScale(0.25 * flare * 1.07, 1.5, 0.25 * flare * 0.77)), trim, 0.4, sw);
  }
  // плащ с застёжкой на груди
  const cloakP = role === 'noble' ? 0.75 : role === 'merchant' ? 0.4 : role === 'townswoman' ? 0.3 : role === 'priest' ? 0.5 : 0;
  if (!ride && !sit && rnd() < cloakP) {
    const cc = role === 'priest' ? 0x2a2622 : pick([0x5a1a1a, 0x1a2a4a, 0x3a3a2a, 0x2a4a2a, 0x6a4a2a]);
    B.add(G.cloak, M(0, 0, -0.01, lean * 0.25), cc, 0.4, sw);
    B.shadeLast && B.shadeLast(G.cloak, (x, y, z) => (0.78 + 0.22 * Math.min(1, (y - 0.5) / 0.9)) * (1 + 0.1 * Math.sin(Math.atan2(z, x) * 7)));
    B.add(new THREE.SphereGeometry(0.025, 6, 4), M(0, 1.4, 0.12), 0xd6a632, 0.4, sw);
  }
  if (R.surcoat) {
    B.add(tunicGeo(1.3, 1.1), M(0, 0.02, 0, lean * 0.25, 0, 0, 1.06, 0.98, 1.08), R.surcoat, 0.4, sw);
    // крест на сюрко
    B.add(new THREE.BoxGeometry(0.05, 0.3, 0.01), M(0, 1.15, 0.165), 0xa01818, 0.4, sw);
    B.add(new THREE.BoxGeometry(0.2, 0.05, 0.01), M(0, 1.2, 0.165), 0xa01818, 0.4, sw);
  }
  if (R.apron) {
    const lg = role === 'smith';
    MT(lg ? 5 : 1);
    B.add(lg ? G.apronLong : G.apron, M(0, 1.02, 0.012, lean * 0.25), R.apron, 0.4, sw);
    if (lg) B.add(new THREE.BoxGeometry(0.2, 0.26, 0.012), M(0, 1.17, 0.145, -0.12), R.apron, 0.4, sw); // нагрудник
    for (const sd of [-1, 1]) B.add(new THREE.BoxGeometry(0.018, 0.16, 0.008), M(sd * 0.05, 0.9, -0.14, 0.1, 0, sd * 0.2), shade(R.apron, 0.85), 0.4, sw); // завязки сзади
  }
  MT(5);
  B.add(G.belt, M(0, 0.98, 0, lean * 0.25, 0, 0, 1, 1, 0.74), 0x2a1d14, 0.4, sw);
  if (!R.robe && !R.dress) B.add(G.pouch, M(0.14, 0.9, 0.08, 0, -0.5), 0x5a3a1e, 0.4, sw);
  if (!female && !child && !R.sword && role !== 'priest') { // нож в ножнах на поясе
    B.add(new THREE.BoxGeometry(0.03, 0.2, 0.02), M(-0.16, 0.88, 0.06, 0, 0, 0.25), 0x3a2418, 0.4, sw);
    B.add(new THREE.BoxGeometry(0.02, 0.07, 0.02), M(-0.135, 1.0, 0.06, 0, 0, 0.25), 0x6a5a3a, 0.4, sw);
  }
  if (female && !child) { // кольцо с ключами и концы пояса
    B.add(new THREE.TorusGeometry(0.03, 0.006, 4, 8), M(0.17, 0.88, 0.07, 0, 0.6), 0x8a8a80, 0.4, sw);
    B.add(new THREE.BoxGeometry(0.025, 0.3, 0.012), M(0.06, 0.82, 0.155, 0.05), 0x2a1d14, 0.4, sw);
  }
  // передник у крестьянок
  MT(1);
  if (role === 'woman' && rnd() < 0.6) B.add(G.apronW, M(0, 1.0, 0.018 + lean * 0.02, lean * 0.3), pick([0xd8d0bc, 0xc8bca0, 0xe0dccf]), 0.4, sw);

  // ---- голова: шея, лицо (нос, глаза, брови, уши), волосы/борода, убор ----
  const hy = 1.6;
  const look = (rnd() - 0.5) * 0.6;
  MT(2);
  B.add(G.neck, M(0, 1.5, 0.01), skin, 1, sw);
  const headM = M(0, hy, 0.01 + lean * 0.12, lean * 0.3, look);
  B.add(G.head, headM, skin, 1, sw);
  B.shadeLast && B.shadeLast(G.head, (x, y, z) => {
    const ch = Math.exp(-((Math.abs(x) - 0.052) ** 2 + (y + 0.02) ** 2) / 0.0006) * Math.max(0, z / 0.1);
    const low = y < -0.06 ? 0.9 : 1;
    return [low * (1 + 0.06 * ch), low * (1 - 0.05 * ch), low * (1 - 0.05 * ch)];
  });
  B.add(G.jaw, C(headM, 0, -0.025, 0.015), skin, 1, sw);
  // тон кожи: нос, щёки и уши теплее, под подбородком тень
  const warm = (k) => new THREE.Color(skin).lerp(new THREE.Color(0xc0605a), k).getHex();
  B.add(G.noseBridge, C(headM, 0, 0.0, 0.1), shade(skin, 0.97), 1, sw);
  B.add(G.noseTip, C(headM, 0, -0.02, 0.111), warm(0.1), 1, sw);
  for (const sd of [-1, 1]) B.add(G.nostril, C(headM, sd * 0.011, -0.024, 0.103), warm(0.08), 1, sw);
  const eyeC = pick([0x4a2e1a, 0x5a3a20, 0x3a5a7a, 0x4a6a5a, 0x5a5e62, 0x2a1c12]);
  for (const sd of [-1, 1]) {
    B.add(G.eyeWhite, C(headM, sd * 0.034, 0.022, 0.086), 0xe6dfd4, 1, sw);
    B.add(G.iris, C(headM, sd * 0.034, 0.021, 0.0915), eyeC, 1, sw);
    B.add(G.pupil, C(headM, sd * 0.034, 0.021, 0.0935), 0x0c0908, 1, sw);
    B.add(G.lid, C(headM, sd * 0.034, 0.024, 0.086, -0.25), shade(skin, 0.9), 1, sw); // верхнее веко
    MT(4);
    B.add(G.brow, C(headM, sd * 0.034, 0.043, 0.098, -0.2, 0, sd * -0.12), shade(hair, 0.8), 1, sw);
    MT(2);
    B.add(G.ear, C(headM, sd * 0.096, 0.005, -0.005), warm(0.12), 1, sw);
  }
  // губы: верхняя темнее, нижняя полнее
  B.add(G.lip, C(headM, 0, -0.046, 0.094), 0x8a4a3e, 1, sw);
  B.add(G.lip, C(headM, 0, -0.056, 0.092).multiply(new THREE.Matrix4().makeScale(0.92, 1.25, 1.1)), 0x9a5a4a, 1, sw);
  const bearded = !female && !child && role !== 'priest' && rnd() < 0.45;
  MT(4);
  if (bearded) {
    const full = rnd() < 0.6;
    B.add(G.beard, C(headM, 0, -0.03, 0.02).multiply(new THREE.Matrix4().makeScale(1, full ? 1 : 0.8, full ? 1 : 0.97)), hair, 1, sw);
    for (const sd of [-1, 1]) B.add(G.mustache, C(headM, sd * 0.016, -0.036, 0.098, 0, 0, sd * 0.35), shade(hair, 0.9), 1, sw);
    if (full) for (let k = 0; k < 4; k++) { // пряди бороды на подбородке
      const x = (k - 1.5) * 0.019;
      B.add(G.lock, C(headM, x, -0.075, 0.07 - Math.abs(x) * 0.6, 0.35, 0, x * 2).multiply(new THREE.Matrix4().makeScale(0.013, 0.02 + rnd() * 0.015, 0.011)),
        new THREE.Color(hair).multiplyScalar(0.85 + rnd() * 0.25).getHex(), 1, sw);
    }
  } else if (!female && !child && role !== 'priest' && rnd() < 0.4) { // щетина
    B.add(G.beard, C(headM, 0, -0.028, 0.017).multiply(new THREE.Matrix4().makeScale(0.99, 0.85, 0.985)), new THREE.Color(skin).lerp(new THREE.Color(hair), 0.35).getHex(), 1, sw);
  }
  switch (R.head) {
    case 'hair':
      addHair(B, C, headM, hair, child || rnd() < 0.55 ? 'bob' : 'short', rnd, sw);
      break;
    case 'tonsure':
      B.add(G.hairBack, C(headM, 0, -0.01, -0.012, 0, Math.PI), 0x5a5048, 1, sw);
      break;
    case 'hood': {
      const hk = rnd();
      if ((role === 'peasant' || role === 'reaper') && hk < 0.35) { // соломенная шляпа
        addHair(B, C, headM, hair, 'short', rnd, sw, true);
        MT(0);
        B.add(G.hatBrim, C(headM, 0, 0.07, 0, -0.08), 0xc8a860, 1, sw);
        B.add(G.hatCrown, C(headM, 0, 0.13, -0.005), 0xc0a058, 1, sw);
        B.add(G.band, C(headM, 0, 0.1, -0.005).multiply(new THREE.Matrix4().makeScale(0.115, 1.6, 0.115)), 0x6a3a1a, 1, sw);
        break;
      }
      if ((role === 'servant' || role === 'peasant') && hk > 0.75) { // белый льняной чепец
        MT(1);
        B.add(G.cap, C(headM, 0, 0.005, -0.01, -0.25), 0xe8e2d4, 1, sw);
        for (const sd of [-1, 1]) B.add(new THREE.BoxGeometry(0.007, 0.085, 0.006), C(headM, sd * 0.062, -0.07, 0.045, 0, 0, sd * 0.45), 0xe8e2d4, 1, sw); // завязки под подбородком
        break;
      }
      if (role === 'merchant' && hk < 0.5) { // войлочная шапка
        addHair(B, C, headM, hair, 'short', rnd, sw, true);
        MT(1);
        B.add(G.cap, C(headM, 0, 0.03, -0.01, -0.15).multiply(new THREE.Matrix4().makeScale(1.05, 1.25, 1.05)), pick([0x5a1a1a, 0x1a2a4a, 0x2a2a2a]), 1, sw);
        B.add(G.capBand, C(headM, 0, 0.035, -0.01, -0.15).multiply(new THREE.Matrix4().makeScale(1.03, 1, 1.07)), shade(trim || 0x5a3a1e, 0.6), 1, sw);
        break;
      }
      MT(1);
      const hc = pick([0x6a3a1a, 0x4a5a3a, 0x7a6a4a, 0x8a2a1a, 0x3a4a6a]);
      B.add(G.hood, C(headM, 0, -0.012, -0.018, -0.08), hc, 1, sw);
      B.add(G.hoodCape, M(0, 1.43, -0.005, lean * 0.25, 0, 0, 1, 1, 0.8), hc, 0.8, sw); // оплечье капюшона
      B.add(G.liripipe, C(headM, 0, 0.02, -0.16, -2.3), hc, 1, sw); // хвост капюшона
      break;
    }
    case 'wimple':
      MT(1);
      if (role === 'woman' && rnd() < 0.45) { // цветной платок, завязанный сзади
        const kc = pick([0x8a3a2a, 0x3d5a7a, 0x6a6a3a, 0xc8b890]);
        B.add(G.kerchief, C(headM, 0, 0.0, -0.015, -0.35), kc, 1, sw);
        B.add(new THREE.ConeGeometry(0.04, 0.12, 5), C(headM, 0, -0.03, -0.13, 2.4), kc, 1, sw);
        if (rnd() < 0.6) { // коса из-под платка
          MT(4);
          for (let k = 0; k < 7; k++) B.add(G.sphLo || G.lock, M(((k % 2) - 0.5) * 0.012, 1.52 - k * 0.055, -0.13 - k * 0.004).multiply(new THREE.Matrix4().makeScale(0.026 - k * 0.0015, 0.034, 0.022)), shade(hair, 0.95 + (k % 2) * 0.1), 1, sw);
          B.add(G.band, M(0, 1.14, -0.155).multiply(new THREE.Matrix4().makeScale(0.018, 2, 0.018)), kc, 1, sw);
        }
        break;
      }
      B.add(G.wimple, C(headM, 0, -0.015, -0.012, -0.04), 0xe8e2d2, 1, sw);
      B.add(G.veil, M(0, 1.48, -0.02, lean * 0.25, 0, 0, 1, 1, 0.85), 0xe0d8c4, 0.8, sw);
      break;
    case 'capeline':
      MT(3);
      B.add(G.helmTop, C(headM, 0, 0.012, 0), 0x6e7074, 1, sw);
      B.add(G.brim, C(headM, 0, 0.01, 0, -0.06, 0, 0), 0x5e6064, 1, sw);
      break;
    case 'helm':
      // шапель — железная каска с широкими полями (типична для XIII века) и кольчужный капюшон
      MT(6);
      B.add(G.coif, C(headM, 0, -0.02, -0.012, -0.04), 0x8a8e94, 1, sw);
      B.add(G.mailCape, M(0, 1.44, 0, 0, 0, 0, 1, 1, 0.8), 0x7e8288, 0.8, sw);
      MT(3);
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
    feast: [[-0.8, 0.14, 0.95], [-0.62, -0.16, 0.75]],
    reins: [[-0.45, 0.12, 1.2], [-0.45, -0.12, 1.2]],
    lance: [[-0.2, 0.12, 1.4], [-0.45, -0.12, 1.2]],
    lute: [[-0.55, 0.25, 1.5], [-0.35, -0.3, 1.25]],
    tray: [[-0.35, 0.3, 1.75], [-0.35, -0.3, 1.75]],
    scythe: [[-0.7, 0.25, 0.9], [-0.35, -0.2, 1.1]],
    torch: [[-0.75, 0.2, 1.1], [0.08, -0.1, 0.18]],
    sword: [[-1.0, 0.15, 0.55], [-0.5, -0.35, 1.3]],
    falcon: [[0.08, 0.1, 0.18], [-0.5, -0.15, 1.45]],
    basket: [[-0.25, 0.3, 1.2], [-0.25, -0.3, 1.2]],
  }[IT === 'torch' ? 'torch' : IT === 'sword' || IT === 'woodsword' ? 'sword' : IT === 'falcon' ? 'falcon' : IT === 'basket' && pose !== 'work' ? 'basket' : IT === 'pick' ? 'hammer' : IT === 'lance' ? 'lance' : IT === 'lute' ? 'lute' : IT === 'tray' ? 'tray' : IT === 'scythe' ? 'scythe' : ride ? 'reins' : sit ? 'feast' : IT === 'spear' ? 'spear' : IT === 'bow' ? 'bow' : pose === 'work' || IT === 'hoe' ? 'work' : IT === 'hammer' ? 'hammer' : IT === 'bucket' ? 'bucket' : 'stand'];
  const sleeve = R.surcoat && !R.sword ? R.surcoat : R.mail ? 0x8a8e94 : tunic;
  const hands = [];
  let armLimb = [0, 0];
  [1, -1].forEach((sd, i) => {
    const [fx, sz, eb] = armPose[i];
    const fixed = ride || sit || ['tray', 'lute', 'lance', 'basket'].includes(IT) || (i === 0 && IT === 'torch') || (i === 1 && IT === 'falcon');
    B.curLimb = fixed ? [0, 0] : [-sd * 0.6, 1.4 * s];
    if (i === 0) armLimb = B.curLimb; // рука — в противофазе с ногой
    const sh = M(sd * 0.2, 1.37, lean * 0.1, fx + lean * 0.3, 0, sd * Math.abs(sz));
    MT(1);
    B.add(G.shoulder, sh, sleeve, 0.6, sw);
    B.add(G.deltoid, M(sd * 0.165, 1.365, lean * 0.1, lean * 0.3, 0, -sd * 0.3), sleeve, 0.6, sw);
    B.add(G.upperArm, sh, sleeve, 0.6, sw);
    const el = C(sh, 0, -0.3, 0, -eb);
    B.add(G.joint, el, sleeve, 0.6, sw);
    B.add(G.foreArm, el, sleeve, 0.6, sw);
    B.add(G.cuff, C(el, 0, -0.26, 0), trim && !R.surcoat ? trim : shade(sleeve, 0.65), 0.6, sw);
    const hm = C(el, 0, -0.33, 0);
    MT(2);
    B.add(G.hand, hm, skin, 0.6, sw);
    hands.push(new V3().setFromMatrixPosition(hm));
  });
  B.curLimb = [0, 0];
  MT(0);

  // ---- предметы ----
  const up = new V3(0, 1, 0);
  if (IT === 'spear') {
    const base = hands[0].clone().add(new V3(0, -1.05 * s, 0));
    B.add(G.shaft, new THREE.Matrix4().compose(base, new THREE.Quaternion(), new V3(1, 2.5 * s, 1)), 0x5a3e24, 0.3, sw);
    B.add(G.tip, new THREE.Matrix4().compose(base.clone().add(new V3(0, 2.5 * s + 0.12, 0)), new THREE.Quaternion(), new V3(1, 1, 1)), 0x9a9ea4, 0.3, sw);
  }
  if (R.shield) {
    const col = pick([0x7a1c1c, 0xd6a632, 0x1d3f8a]);
    B.add(shieldShape, M(-0.05, 1.12, -0.2, 0.08, Math.PI, 0), col, 0.4, sw);
    B.add(new THREE.BoxGeometry(0.06, 0.62, 0.012), M(-0.05, 1.05, -0.245, 0.08, Math.PI, 0), 0xe8e0c8, 0.4, sw);
  }
  if (IT === 'bow') {
    const bow = new THREE.TorusGeometry(0.62, 0.014, 5, 20, Math.PI * 0.9);
    B.add(bow, M(0.15, 1.42, 0.62, 0, Math.PI / 2, Math.PI / 2 - Math.PI * 0.45), 0x6a4a2a, 0.3, sw);
    B.add(new THREE.CylinderGeometry(0.07, 0.06, 0.45, 8), M(0.12, 1.25, -0.16, 0.25), 0x5a3a1e, 0.3, sw); // колчан
  }
  if (IT === 'hammer') {
    const h = hands[0];
    B.add(G.shaft, new THREE.Matrix4().compose(h.clone().add(new V3(0, -0.08, 0)), new THREE.Quaternion(), new V3(1, 0.4, 1)), 0x5a3e24, 0.3, sw);
    B.add(new THREE.BoxGeometry(0.16, 0.07, 0.07), new THREE.Matrix4().compose(h.clone().add(new V3(0, 0.3, 0)), new THREE.Quaternion().setFromAxisAngle(up, yaw), new V3(1, 1, 1)), 0x3a3a3e, 0.3, sw);
  }
  if (IT === 'hoe') {
    const h = hands[0];
    const tilt = new THREE.Quaternion().setFromAxisAngle(new V3(Math.cos(yaw), 0, -Math.sin(yaw)), 0.6);
    const base = h.clone().add(new V3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(-0.8)).add(new V3(0, -0.9, 0));
    B.add(G.shaft, new THREE.Matrix4().compose(base, tilt, new V3(1, 1.7, 1)), 0x6a4a2a, 0.3, sw);
  }
  if (IT === 'lance') { // турнирное копьё вперёд, с расширением у руки
    const base = hands[0];
    const dir = new V3(Math.sin(yaw), 0.05, Math.cos(yaw)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
    B.add(new THREE.CylinderGeometry(0.025, 0.05, 3.6, 7).translate(0, 1.5, 0), new THREE.Matrix4().compose(base, q, new V3(1, 1, 1)), 0xe8e0c8, 0.3, sw);
    B.add(new THREE.ConeGeometry(0.09, 0.28, 8).rotateX(Math.PI), new THREE.Matrix4().compose(base.clone().addScaledVector(dir, 0.1), q, new V3(1, 1, 1)), 0x9a2a2a, 0.3, sw);
  }
  if (IT === 'lute') { // лютня: пузатый корпус и гриф
    const c = hands[0].clone().lerp(hands[1], 0.5).add(new V3(0, -0.05, 0));
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, yaw, 0.9));
    B.add(new THREE.SphereGeometry(0.16, 10, 8).scale(1, 1.25, 0.5), new THREE.Matrix4().compose(c, q, new V3(1, 1, 1)), 0x8a5a2a, 0.3, sw);
    B.add(new THREE.BoxGeometry(0.05, 0.4, 0.03).translate(0, 0.35, 0), new THREE.Matrix4().compose(c, q, new V3(1, 1, 1)), 0x4a2e18, 0.3, sw);
  }
  if (IT === 'tray') { // поднос с блюдом над головой
    const c = hands[0].clone().lerp(hands[1], 0.5).add(new V3(0, 0.05, 0));
    B.add(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 14), new THREE.Matrix4().compose(c, new THREE.Quaternion(), new V3(1, 1, 1)), 0x8a8a8a, 0.3, sw);
    B.add(new THREE.SphereGeometry(0.16, 10, 6).scale(1, 0.55, 0.8), new THREE.Matrix4().compose(c.clone().add(new V3(0, 0.08, 0)), new THREE.Quaternion(), new V3(1, 1, 1)), 0x8a4a22, 0.3, sw);
  }
  if (IT === 'scythe') { // коса: длинное косовище и изогнутое лезвие у земли
    const h = hands[0];
    const fwd = new V3(Math.sin(yaw), 0, Math.cos(yaw)), side = new V3(Math.cos(yaw), 0, -Math.sin(yaw));
    const bottom = h.clone().addScaledVector(fwd, 0.7).addScaledVector(side, -0.3).setY(y + 0.12);
    const top = h.clone().addScaledVector(fwd, -0.2).add(new V3(0, 0.35, 0));
    const d = top.clone().sub(bottom), len = d.length();
    B.add(G.shaft, new THREE.Matrix4().compose(bottom, new THREE.Quaternion().setFromUnitVectors(up, d.normalize()), new V3(1, len, 1)), 0x6a4a2a, 0.3, sw);
    const blade = new THREE.TorusGeometry(0.55, 0.018, 3, 12, Math.PI * 0.55);
    blade.scale(1, 1, 3);
    B.add(blade, new THREE.Matrix4().compose(bottom.clone().add(new V3(0, 0.03, 0)), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, yaw + 2.2)), new V3(1, 1, 1)), 0xb0b4ba, 0.3, sw);
  }
  if (IT === 'bucket') B.add(G.bucket, new THREE.Matrix4().compose(hands[1].clone().add(new V3(0, -0.16, 0)), new THREE.Quaternion(), new V3(1, 1, 1)), 0x6a4a2a, 0.3, sw);
  if (IT === 'torch') { // факел поднят в правой руке
    const h = hands[0];
    B.add(G.shaft, new THREE.Matrix4().compose(h.clone().add(new V3(0, -0.18, 0)), new THREE.Quaternion(), new V3(1.6, 0.62, 1.6)), 0x4a3220, 0.3, sw);
    B.add(new THREE.CylinderGeometry(0.045, 0.035, 0.12, 7), new THREE.Matrix4().compose(h.clone().add(new V3(0, 0.44, 0)), new THREE.Quaternion(), new V3(1, 1, 1)), 0x2a1a10, 0.3, sw);
  }
  if (IT === 'sword' || IT === 'woodsword') { // меч вперёд-вверх; качается вместе с рукой
    B.curLimb = armLimb;
    const h = hands[0];
    const wood = IT === 'woodsword';
    const dir = new V3(Math.sin(yaw) * 0.8, 0.6, Math.cos(yaw) * 0.8).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
    const L = wood ? 0.55 : 0.85;
    B.add(new THREE.BoxGeometry(0.045, L, 0.012).translate(0, L / 2 + 0.06, 0), new THREE.Matrix4().compose(h, q, new V3(1, 1, 1)), wood ? 0x8a6a40 : 0xc0c4ca, 0.2, sw);
    B.add(new THREE.BoxGeometry(wood ? 0.14 : 0.2, 0.03, 0.035).translate(0, 0.05, 0), new THREE.Matrix4().compose(h, q, new V3(1, 1, 1)), wood ? 0x6a4a28 : 0x6a5a3a, 0.2, sw);
    B.curLimb = [0, 0];
  }
  if (IT === 'falcon') { // сокол на кожаной перчатке левой руки
    const h = hands[1];
    B.add(new THREE.SphereGeometry(0.075, 8, 6).scale(1, 1, 1.2), new THREE.Matrix4().compose(h, new THREE.Quaternion(), new V3(1, 1, 1)), 0x6a4a2a, 0.3, sw);
  }
  if (IT === 'basket') { // корзина: в руках или на земле у работника
    const c = pose === 'work' ? new V3().setFromMatrixPosition(root).add(new V3(Math.sin(yaw) * 0.55 + Math.cos(yaw) * 0.35, 0.14, Math.cos(yaw) * 0.55 - Math.sin(yaw) * 0.35)) : hands[0].clone().lerp(hands[1], 0.5).add(new V3(0, -0.08, 0));
    B.add(new THREE.CylinderGeometry(0.2, 0.15, 0.26, 10, 1, true), new THREE.Matrix4().compose(c, new THREE.Quaternion(), new V3(1, 1, 1)), 0x9a7a44, 0.3, sw);
    B.add(new THREE.CylinderGeometry(0.19, 0.19, 0.02, 10), new THREE.Matrix4().compose(c.clone().add(new V3(0, 0.08, 0)), new THREE.Quaternion(), new V3(1, 1, 1)), 0x4a1a3a, 0.3, sw);
  }
  if (IT === 'pick') { // кирка
    const h = hands[0];
    B.add(G.shaft, new THREE.Matrix4().compose(h.clone().add(new V3(0, -0.2, 0)), new THREE.Quaternion(), new V3(1.3, 0.8, 1.3)), 0x5a3e24, 0.3, sw);
    B.add(new THREE.BoxGeometry(0.5, 0.045, 0.045), new THREE.Matrix4().compose(h.clone().add(new V3(0, 0.56, 0)), new THREE.Quaternion().setFromAxisAngle(up, yaw + Math.PI / 2), new V3(1, 1, 1)), 0x55585c, 0.3, sw);
  }
  if (R.sword) {
    B.add(new THREE.BoxGeometry(0.05, 0.95, 0.015), M(-0.22, 0.55, 0.05, 0, 0, 0.12), 0xb0b4ba, 0.2, sw);
    B.add(new THREE.BoxGeometry(0.22, 0.03, 0.03), M(-0.2, 1.03, 0.05, 0, 0, 0.12), 0x6a5a3a, 0.2, sw);
    B.add(new THREE.SphereGeometry(0.03, 6, 4), M(-0.18, 1.2, 0.05), 0xc8a040, 0.2, sw);
  }
  B.curPiv = [0, 0];
  B.curMat = 0;
  return { hands, root };
}

export function createPeople(scene, list) {
  const B = new ColorBuilder();
  list.forEach((p, i) => person(B, { seed: i + 1, ...p }));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const uTime = { value: 0 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aSway;\nattribute vec2 aPivot;\nuniform float uTime;\nfloat gHeadA;')
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        // иногда человек оглядывается: голова поворачивается вокруг шеи
        {
          float hp = aSway.y * 1.7;
          float lk = sin(uTime * 0.23 + hp * 2.3) + 0.5 * sin(uTime * 0.51 + hp * 5.1);
          gHeadA = 0.55 * sign(lk) * smoothstep(0.45, 0.95, abs(lk)) * step(0.3, fract(hp * 0.37));
          if (aSway.x > 0.95 && aSway.x < 1.05) {
            float c = cos(gHeadA), s = sin(gHeadA);
            objectNormal.xz = mat2(c, -s, s, c) * objectNormal.xz;
          }
        }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (aSway.x > 0.95 && aSway.x < 1.05) {
          float c = cos(gHeadA), s = sin(gHeadA);
          vec2 q = transformed.xz - aPivot;
          transformed.xz = aPivot + mat2(c, -s, s, c) * q;
        }
        // дыхание и лёгкое переминание: каждая фигура в своей фазе
        float ph = aSway.y * 1.7;
        transformed.y += sin(uTime * 1.6 + ph) * 0.006 * aSway.x;
        transformed.x += sin(uTime * 0.5 + ph) * 0.012 * aSway.x;`);
  };
  addPersonShading(mat);
  const mesh = new THREE.Mesh(B.build(), mat);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = 'people';
  scene.add(mesh);
  return { mesh, update(t) { uTime.value = t; } };
}
