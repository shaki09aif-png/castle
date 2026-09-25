// Растительность: густая трава на GPU (инстансинг, ветер), деревья нескольких
// пород и кусты. Густота убывает к вершине холма; у реки трава сочнее.
import * as THREE from 'three';
import { mulberry32, createNoise2D, fbm, smoothstep, clamp, lerp } from './noise.js';
import { plateauRadius, GATE_DIR, GATE_RADIUS, DITCH, insideTower, GATEHOUSE, GATE_PASSAGE, BARBICAN } from './layout.js';
import { shelfDistance, riverInfo } from './terrain.js';
import { pbrMaterial, foliageTexture, macroNoiseTexture } from './textures.js';
import { SUN_DIR } from './lighting.js';
import { AUTUMN } from './materials.js';
import { Q } from './quality.js';

const WIND = { uTime: { value: 0 } };

// ---------------------------------------------------------------------------
// Карта земли для травы: высота + плотность травы + «сочность» + «сухость»
// ---------------------------------------------------------------------------
const GROUND_HALF = 420;
const GROUND_RES = 512;

function buildGroundTexture(terrain, exclude) {
  const S = GROUND_RES;
  const data = new Uint16Array(S * S * 4);
  const toH = THREE.DataUtils.toHalfFloat;
  for (let j = 0; j < S; j++) {
    const z = -GROUND_HALF + ((j + 0.5) / S) * 2 * GROUND_HALF;
    for (let i = 0; i < S; i++) {
      const x = -GROUND_HALF + ((i + 0.5) / S) * 2 * GROUND_HALF;
      const g = terrain.groundAt(x, z);
      let dens = g.grass * (1 - smoothstep(0.2, 0.45, g.slope)) * (1 - g.road);
      if (g.eP < -2) dens *= 0.12; // внутри стен — вытоптано, трава только местами
      if (g.river < 0.4) dens = 0;
      if (insideTower(x, z, 1.0)) dens = 0; // в башнях и в проезде ворот травы нет
      if (exclude) dens *= 1 - exclude(x, z); // постройки двора и мостовая
      if (Math.abs(x - GATEHOUSE.x) < 3 && z > GATE_PASSAGE.rampEndZ && z < BARBICAN.zS + 2) dens = 0; // мостовая, мост
      const lush = 1 - smoothstep(0, 18, g.river);
      const dry = smoothstep(35, 80, g.h) * (1 - lush);
      const k = (j * S + i) * 4;
      data[k] = toH(g.h);
      data[k + 1] = toH(clamp(dens, 0, 1));
      data[k + 2] = toH(lush);
      data[k + 3] = toH(dry);
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Трава: пучок изогнутых травинок; тысячи пучков рисуются одним вызовом.
// Позиции «привязаны к миру» (ячейки сетки), поэтому при движении камеры
// трава не прыгает — просто появляется впереди и исчезает позади.
// ---------------------------------------------------------------------------
function clumpGeometry(blades, segs, height, width, radius, seed) {
  const rnd = mulberry32(seed);
  const pos = [], uv = [], nrm = [], idx = [];
  for (let b = 0; b < blades; b++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * radius;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const yaw = rnd() * Math.PI * 2;
    const dx = Math.cos(yaw), dz = Math.sin(yaw);
    const h = height * (0.6 + rnd() * 0.6);
    const bend = (0.25 + rnd() * 0.45) * h;
    const w = width * (0.7 + rnd() * 0.6);
    const base = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const y = h * t;
      const fwd = bend * t * t;
      const ww = w * Math.pow(1 - t, 0.8) * 0.5;
      const cx = bx + dz * fwd, cz = bz - dx * fwd;
      if (s < segs) {
        pos.push(cx - dx * ww, y, cz - dz * ww, cx + dx * ww, y, cz + dz * ww);
        uv.push(0, t, 1, t);
        nrm.push(dz, 0.6, -dx, dz, 0.6, -dx);
      } else {
        pos.push(cx, y, cz);
        uv.push(0.5, 1);
        nrm.push(dz, 0.6, -dx);
      }
    }
    for (let s = 0; s < segs - 1; s++) {
      const a0 = base + s * 2;
      idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
    }
    const last = base + (segs - 1) * 2;
    idx.push(last, last + 1, last + 2);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

function grassLayer(groundTex, { spacing, radius, inner, blades, segs, height, width, clumpR, seed }) {
  const N = Math.ceil((radius * 2) / spacing);
  const geo = clumpGeometry(blades, segs, height, width, clumpR, seed);
  const cells = new Float32Array(N * N * 2);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    cells[(j * N + i) * 2] = i;
    cells[(j * N + i) * 2 + 1] = j;
  }
  geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
  geo.instanceCount = N * N;
  const uniforms = {
    tGround: { value: groundTex },
    tMacro: { value: macroNoiseTexture() },
    uCam: { value: new THREE.Vector2() },
    uSpacing: { value: spacing },
    uHalfN: { value: N / 2 },
    uRadius: { value: radius },
    uInner: { value: inner },
    uGroundHalf: { value: GROUND_HALF },
    uTime: WIND.uTime,
  };
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.uniforms.uAutumn = AUTUMN;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec2 aCell;
        uniform sampler2D tGround, tMacro;
        uniform vec2 uCam;
        uniform float uSpacing, uHalfN, uRadius, uInner, uGroundHalf, uTime;
        varying vec3 vTint;
        varying float vH;
        varying vec3 vFlower;
        float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `vec2 cellI = floor(uCam / uSpacing) + aCell - uHalfN;
        vec2 jit = hash22(cellI);
        vec2 wxz = (cellI + jit) * uSpacing;
        vec4 gd = texture2D(tGround, (wxz + uGroundHalf) / (2.0 * uGroundHalf));
        float dist = length(wxz - uCam);
        float fade = (1.0 - smoothstep(uRadius * 0.7, uRadius, dist)) * smoothstep(uInner * 0.75, uInner, dist);
        float rnd = hash12(cellI + 17.3);
        // у кромок (стены, дороги, мостовая) трава не вытоптана — выше
        float edge = gd.g * (1.0 - gd.g) * 4.0;
        float show = step(rnd, gd.g * 1.15) * fade;
        float scl = show * (0.65 + 0.7 * hash12(cellI + 3.1)) * (1.0 + gd.b * 0.6 + edge * 0.15) * (1.0 - gd.a * 0.35);
        // кое-где в траве цветы: белые, жёлтые, лиловые, голубые
        float fl = hash12(cellI + 41.7);
        vFlower = fl > 0.93 && gd.a < 0.6 ? (fl > 0.985 ? vec3(0.35, 0.45, 0.9) : fl > 0.97 ? vec3(0.6, 0.3, 0.75) : fl > 0.955 ? vec3(0.95, 0.8, 0.15) : vec3(0.95, 0.95, 0.9)) : vec3(0.0);
        float ang = hash12(cellI + 9.7) * 6.2832;
        mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
        vec3 objectNormal = normalize(vec3(rot * normal.xz, normal.y).xzy * vec3(1.0, 1.0, 1.0));
        objectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), 0.85));
        // оттенок: сухая трава на вершине, сочная у воды, пятна по макрошуму
        float m = texture2D(tMacro, wxz * 0.004).g;
        // (линейные значения цвета, сопоставимые с текстурой травы на земле)
        vec3 tint = mix(vec3(0.085, 0.15, 0.03), vec3(0.15, 0.17, 0.045), m);
        tint = mix(tint, vec3(0.25, 0.21, 0.08), gd.a * 0.75);
        tint = mix(tint, vec3(0.06, 0.14, 0.028), gd.b * 0.6);
        tint *= 0.85 + 0.3 * hash12(cellI + 5.5);
        vTint = tint;
        vH = uv.y;`
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = position;
        transformed.xz = rot * transformed.xz;
        transformed *= scl;
        // ветер: плавные волны порывов + мелкая дрожь, сильнее у кончиков
        float t2 = uv.y * uv.y;
        float gust = texture2D(tMacro, wxz * 0.01 - vec2(uTime * 0.03, uTime * 0.012)).r;
        float wave = sin(uTime * 1.6 + wxz.x * 0.21 + wxz.y * 0.13) * 0.5 + sin(uTime * 3.7 + wxz.x * 0.7) * 0.18;
        float sway = (wave + (gust - 0.45) * 2.2) * t2 * 0.28 * scl;
        transformed.x += sway;
        transformed.z += sway * 0.45;
        transformed.y -= abs(sway) * 0.25;
        transformed += vec3(wxz.x, gd.r - 0.05, wxz.y);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTint;\nvarying float vH;\nvarying vec3 vFlower;\nuniform float uAutumn;')
      .replace(
        '#include <normal_fragment_begin>',
        'float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;'
      )
      .replace(
        '#include <map_fragment>',
        `diffuseColor.rgb = vTint * mix(0.7, 1.3, vH);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 1.0, 0.5), uAutumn * 0.8); // осенняя подсохшая трава
        if (vFlower.r + vFlower.g > 0.1) diffuseColor.rgb = mix(diffuseColor.rgb, vFlower * 0.6, smoothstep(0.78, 0.9, vH) * (1.0 - uAutumn));`
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= mix(0.6, 1.0, vH);
        reflectedLight.directDiffuse *= mix(0.8, 1.0, vH);
        // просвечивание травинок на солнце
        totalEmissiveRadiance += diffuseColor.rgb * 0.25 * vH * vH;`
      );
  };
  mat.customProgramCacheKey = () => 'grass-' + seed;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.layers.set(1); // трава не отражается в воде (экономия)
  mesh.name = 'grass';
  return { mesh, uniforms };
}

// ---------------------------------------------------------------------------
// Деревья: процедурный ствол и ветви (трубки) + листва из карточек с альфой
// ---------------------------------------------------------------------------
function tubeGeometry(points, radii, radial) {
  const pos = [], nrm = [], uv = [], idx = [];
  let prevN = null;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const t = new THREE.Vector3().subVectors(points[Math.min(points.length - 1, i + 1)], points[Math.max(0, i - 1)]).normalize();
    let n = prevN ? prevN.clone().sub(t.clone().multiplyScalar(prevN.dot(t))).normalize() : new THREE.Vector3(1, 0, 0).cross(t).normalize();
    if (n.lengthSq() < 0.1) n = new THREE.Vector3(0, 0, 1).cross(t).normalize();
    prevN = n;
    const b = new THREE.Vector3().crossVectors(t, n);
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const dir = n.clone().multiplyScalar(Math.cos(a)).add(b.clone().multiplyScalar(Math.sin(a)));
      pos.push(p.x + dir.x * radii[i], p.y + dir.y * radii[i], p.z + dir.z * radii[i]);
      nrm.push(dir.x, dir.y, dir.z);
      uv.push((k / radial) * Math.max(1, radii[0] * 6), i * 0.6);
    }
  }
  for (let i = 0; i < points.length - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * (radial + 1) + k, b2 = a + radial + 1;
      idx.push(a, b2, a + 1, a + 1, b2, b2 + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function mergeGeometries(list) {
  let vCount = 0, iCount = 0;
  for (const g of list) { vCount += g.getAttribute('position').count; iCount += g.index.count; }
  const attrs = Object.keys(list[0].attributes);
  const out = new THREE.BufferGeometry();
  for (const name of attrs) {
    const size = list[0].getAttribute(name).itemSize;
    const arr = new Float32Array(vCount * size);
    let off = 0;
    for (const g of list) { arr.set(g.getAttribute(name).array, off); off += g.getAttribute(name).array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const idx = new Uint32Array(iCount);
  let io = 0, vo = 0;
  for (const g of list) {
    const ia = g.index.array;
    for (let i = 0; i < ia.length; i++) idx[io + i] = ia[i] + vo;
    io += ia.length;
    vo += g.getAttribute('position').count;
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// Карточки листвы вокруг центра кроны; нормали — «сферические» от центра пучка,
// поэтому крона освещается мягко и объёмно, а не как набор плоскостей.
function leafClump(center, radius, cards, cardSize, rnd, out, droop = 0, tint = 1) {
  for (let k = 0; k < cards; k++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2;
    const r = radius * Math.cbrt(0.2 + rnd() * 0.8);
    const s = Math.sqrt(1 - u * u);
    const p = new THREE.Vector3(center.x + Math.cos(a) * s * r, center.y + u * r * 0.8, center.z + Math.sin(a) * s * r);
    const nrm = p.clone().sub(center).normalize();
    // ориентация карточки: случайная, но скорее «лицом» наружу
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm.clone().add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5 - droop, rnd() - 0.5)).normalize());
    const sz = cardSize * (0.7 + rnd() * 0.6);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const base = out.pos.length / 3;
    // оттенок карточки: внутри кроны и снизу темнее, снаружи и сверху светлее
    const shade = tint * (0.72 + 0.28 * (r / radius)) * (0.85 + 0.25 * (u * 0.5 + 0.5));
    for (const [cx, cy] of corners) {
      const v = new THREE.Vector3(cx * sz * 0.5, cy * sz * 0.5, 0).applyQuaternion(q).add(p);
      out.pos.push(v.x, v.y, v.z);
      const vn = v.clone().sub(center).normalize();
      out.nrm.push(vn.x, vn.y, vn.z);
      out.uv.push((cx + 1) / 2, (cy + 1) / 2);
      if (out.col) out.col.push(shade, shade * (1.0 + (tint - 1) * 0.5), shade * 0.95);
    }
    out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function leafGeometry(out) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(out.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(out.col && out.col.length ? out.col : new Array(out.pos.length).fill(1), 3));
  g.setIndex(out.idx);
  return g;
}

// Описание пород
const SPECIES = {
  oak: {
    height: [8, 13], trunkR: 0.34, branches: 6, branchStart: 0.38, spread: 0.75, crownR: 1.9,
    clumpCards: 26, card: 1.25, bark: 'bark', leafHue: [0.19, 0.3, 0.09], leaf: 'broad', droop: 0,
  },
  beech: {
    height: [11, 16], trunkR: 0.3, branches: 7, branchStart: 0.45, spread: 0.6, crownR: 2.1,
    clumpCards: 24, card: 1.2, bark: 'bark', leafHue: [0.22, 0.33, 0.08], leaf: 'broad', droop: 0.1,
  },
  birch: {
    height: [9, 13], trunkR: 0.17, branches: 5, branchStart: 0.45, spread: 0.35, crownR: 1.3,
    clumpCards: 18, card: 1.0, bark: 'birchBark', leafHue: [0.27, 0.37, 0.1], leaf: 'broad', droop: 0.5,
  },
  pine: {
    height: [12, 18], trunkR: 0.26, branches: 6, branchStart: 0.65, spread: 0.45, crownR: 1.6,
    clumpCards: 18, card: 1.4, bark: 'bark', leafHue: [0.13, 0.22, 0.1], leaf: 'needle', droop: 0.2,
  },
  bush: {
    height: [1.2, 2.2], trunkR: 0.05, branches: 4, branchStart: 0.05, spread: 1.1, crownR: 0.9,
    clumpCards: 16, card: 0.9, bark: 'bark', leafHue: [0.17, 0.27, 0.08], leaf: 'broad', droop: 0, bush: true,
  },
};

function buildSpecies(name, variant) {
  const sp = SPECIES[name];
  const rnd = mulberry32(1000 + variant * 97 + name.length * 13);
  const H = lerp(sp.height[0], sp.height[1], 0.5);
  const trunks = [];
  const leaves = { pos: [], nrm: [], uv: [], idx: [], col: [] };
  const leavesFar = { pos: [], nrm: [], uv: [], idx: [], col: [] };
  const trunkFar = [];
  // ствол с лёгким изгибом
  const tp = [], tr = [];
  const lean = new THREE.Vector2((rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3);
  const trunkTop = sp.bush ? H * 0.3 : H * (name === 'pine' ? 0.95 : 0.8);
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    tp.push(new THREE.Vector3(lean.x * t * t * H * 0.3 + Math.sin(t * 5 + variant) * 0.08, t * trunkTop, lean.y * t * t * H * 0.3));
    tr.push(sp.trunkR * (1 - t * 0.7) * (i === 0 ? 1.35 : 1));
  }
  trunks.push(tubeGeometry(tp, tr, sp.bush ? 4 : 7));
  trunkFar.push(tubeGeometry([tp[0], tp[4], tp[8]], [tr[0], tr[4], tr[8]], 4));
  // ветви и кроны
  const clumps = [];
  for (let b = 0; b < sp.branches; b++) {
    const t0 = sp.branchStart + (b / sp.branches) * (0.9 - sp.branchStart) + rnd() * 0.05;
    const start = tp[Math.min(8, Math.round(t0 * 8))].clone();
    const a = (b / sp.branches) * Math.PI * 2 + rnd() * 0.8;
    const len = H * sp.spread * (0.35 + rnd() * 0.25) * (name === 'pine' ? 1 - t0 * 0.6 : 1);
    const up = name === 'pine' ? 0.1 + rnd() * 0.2 : 0.55 + rnd() * 0.4;
    const dir = new THREE.Vector3(Math.cos(a), up, Math.sin(a)).normalize();
    const mid = start.clone().addScaledVector(dir, len * 0.5).add(new THREE.Vector3(0, len * 0.08, 0));
    const end = start.clone().addScaledVector(dir, len);
    const bp = [start, mid, end];
    const br = sp.trunkR * 0.45 * (1 - t0 * 0.4);
    trunks.push(tubeGeometry(bp, [br, br * 0.6, br * 0.25], sp.bush ? 3 : 5));
    clumps.push(end.clone().add(new THREE.Vector3(0, sp.crownR * 0.3, 0)));
    if (!sp.bush && rnd() > 0.3) clumps.push(mid.clone().add(new THREE.Vector3(0, sp.crownR * 0.6, 0)));
  }
  // верхушка
  clumps.push(tp[8].clone().add(new THREE.Vector3(0, sp.crownR * (name === 'pine' ? 0.5 : 0.2), 0)));
  if (name === 'pine') clumps.push(tp[7].clone().add(new THREE.Vector3(0.8, 0, 0.4)), tp[7].clone().add(new THREE.Vector3(-0.7, 0.3, -0.5)));
  for (const c of clumps) {
    const r = sp.crownR * (0.8 + rnd() * 0.5);
    const tint = 0.88 + rnd() * 0.24;
    // крона из нескольких неровных пучков разного размера — без ровного «шара»
    const subs = sp.bush ? 2 : 3;
    for (let k = 0; k < subs; k++) {
      const a = rnd() * Math.PI * 2, d = r * (0.25 + rnd() * 0.3);
      const sc = c.clone().add(new THREE.Vector3(Math.cos(a) * d, (rnd() - 0.4) * r * 0.5, Math.sin(a) * d));
      leafClump(sc, r * (0.52 + rnd() * 0.22), Math.round(sp.clumpCards / subs), sp.card * 0.95, rnd, leaves, sp.droop, tint * (0.92 + rnd() * 0.16));
    }
    leafClump(c, r * 0.9, Math.max(5, Math.round(sp.clumpCards / 4)), sp.card * 1.8, rnd, leavesFar, sp.droop, tint);
  }
  return {
    trunk: mergeGeometries(trunks),
    trunkFar: mergeGeometries(trunkFar),
    leaves: leafGeometry(leaves),
    leavesFar: leafGeometry(leavesFar),
    height: H,
  };
}

// Материал листвы: альфа-отсечение, ветер, просвечивание на солнце, оттенок экземпляра
// направление «просвета» листвы; длина вектора — сила эффекта (ночью почти 0)
export const FOLIAGE_SUN = SUN_DIR.clone();

function foliageMaterial(tex, evergreen = false) {
  const mat = new THREE.MeshStandardMaterial({
    map: tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, metalness: 0, vertexColors: true,
  });
  const sun = FOLIAGE_SUN; // общий для всех крон: ночью ослабляется (нет просвета листвы)
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = WIND.uTime;
    shader.uniforms.uSun = { value: sun };
    shader.uniforms.uAutumn = AUTUMN;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vLeafH;\nvarying vec3 vLeafW;')
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
        #else
          vec3 ip = vec3(0.0);
        #endif
        float ph = ip.x * 0.13 + ip.z * 0.17;
        float hk = max(0.0, position.y) * 0.08;
        transformed.x += sin(uTime * 1.3 + ph + position.y * 0.3) * 0.12 * hk + sin(uTime * 4.1 + position.x * 2.0) * 0.03 * hk;
        transformed.z += cos(uTime * 1.1 + ph) * 0.08 * hk;
        vLeafH = position.y;`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        #ifdef USE_INSTANCING
          vLeafW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vLeafW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSun;\nuniform float uAutumn;\nvarying float vLeafH;\nvarying vec3 vLeafW;')
      .replace(
        '#include <normal_fragment_begin>',
        'float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;'
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        ${evergreen ? '' : `// осенью каждое дерево желтеет или краснеет по-своему
        {
          float hh = fract(sin(dot(floor(vLeafW.xz / 5.0), vec2(12.9898, 78.233))) * 43758.5);
          vec3 autC = hh < 0.4 ? vec3(0.9, 0.62, 0.12) : hh < 0.75 ? vec3(0.85, 0.36, 0.08) : vec3(0.62, 0.14, 0.06);
          float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
          diffuseColor.rgb = mix(diffuseColor.rgb, autC * (0.45 + lum * 1.8), uAutumn * 0.85);
        }`}
        // внутренняя часть кроны темнее, на просвет — тёплое свечение листвы
        vec3 vd = normalize(vLeafW - cameraPosition);
        float back = pow(max(dot(vd, uSun), 0.0), 3.0);
        totalEmissiveRadiance += diffuseColor.rgb * vec3(1.1, 1.2, 0.6) * back * 0.8;
        reflectedLight.indirectDiffuse *= 0.75;`
      );
  };
  mat.customProgramCacheKey = () => 'foliage' + (evergreen ? '-e' : '');
  return mat;
}

// ---------------------------------------------------------------------------
// Расстановка деревьев и кустов
// ---------------------------------------------------------------------------
function scatterTrees(terrain, excludeTrees) {
  const rnd = mulberry32(4242);
  const nForest = createNoise2D(4343);
  const out = { oak: [], beech: [], birch: [], pine: [], bush: [] };
  const tryPlace = (x, z, far) => {
    if (excludeTrees && excludeTrees(x, z)) return; // поля, огороды, дворы деревни
    const g = terrain.groundAt(x, z);
    if (g.road > 0.02 || g.river < 3 || g.rock > 0.35 || g.gravel > 0.4 || g.slope > 0.45) return;
    const th = Math.atan2(z, x);
    const eEdge = Math.hypot(x, z) - plateauRadius(th);
    if (eEdge < 4 || insideTower(x, z, 5)) return; // на вершине — замок
    const along = x * GATE_DIR.x + z * GATE_DIR.z - GATE_RADIUS;
    const across = x * GATE_DIR.z - z * GATE_DIR.x;
    if (shelfDistance(along, across) < 6) return;
    if (along > DITCH.alongStart - 4 && along < DITCH.alongEnd + 4 && Math.abs(across) < DITCH.halfLength + 4) return;
    const rd = terrain.roadNearest(x, z);
    if (rd && rd.d < 5) return;
    // густота: рощи по шуму, реже к вершине (склоны у стен расчищены для обороны)
    const forest = smoothstep(-0.15, 0.35, fbm(nForest, x / 160, z / 160, 3));
    const altK = 1 - smoothstep(18, 70, g.h);
    const nearCastle = smoothstep(10, 45, eEdge);
    const lush = 1 - smoothstep(0, 25, g.river);
    let p = (0.03 + 0.97 * forest * forest) * (0.2 + 0.8 * altK) * nearCastle + lush * 0.3;
    if (far) p *= forest;
    if (rnd() > p) return;
    // выбор породы
    const r = rnd();
    let sp;
    if (lush > 0.3 && r < 0.5) sp = 'birch';
    else if (g.h > 40 || g.rock > 0.1) sp = r < 0.45 ? 'pine' : r < 0.8 ? 'bush' : 'oak';
    else sp = r < 0.35 ? 'oak' : r < 0.6 ? 'beech' : r < 0.72 ? 'birch' : r < 0.82 ? 'pine' : 'bush';
    const s = sp === 'bush' ? 0.7 + rnd() * 0.8 : 0.75 + rnd() * 0.5;
    out[sp].push({ x, y: g.h - 0.15, z, s, rot: rnd() * Math.PI * 2, tint: 0.8 + rnd() * 0.4, v: Math.floor(rnd() * 3) });
  };
  const n1 = Math.round(26000 * Q.treeCount);
  for (let i = 0; i < n1; i++) tryPlace((rnd() - 0.5) * 820, (rnd() - 0.5) * 820, false);
  // кусты отдельно — их больше и они поднимаются выше по склону
  for (let i = 0; i < n1 * 0.4; i++) {
    const th = rnd() * Math.PI * 2;
    const R = plateauRadius(th);
    const r = R + 6 + rnd() * 140;
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    const g = terrain.groundAt(x, z);
    if (g.road > 0.02 || g.rock > 0.5 || g.slope > 0.5 || g.river < 3 || insideTower(x, z, 2.5)) continue;
    if (excludeTrees && excludeTrees(x, z)) continue;
    if (rnd() > 0.25) continue;
    const along = x * GATE_DIR.x + z * GATE_DIR.z - GATE_RADIUS;
    const across = x * GATE_DIR.z - z * GATE_DIR.x;
    if (shelfDistance(along, across) < 4) continue;
    const rd = terrain.roadNearest(x, z);
    if (rd && rd.d < 4) continue;
    out.bush.push({ x, y: g.h - 0.1, z, s: 0.6 + rnd() * 0.9, rot: rnd() * Math.PI * 2, tint: 0.8 + rnd() * 0.4, v: Math.floor(rnd() * 3) });
  }
  return out;
}

function createTrees(scene, terrain, excludeTrees, extraTrees = []) {
  const placed = scatterTrees(terrain, excludeTrees);
  // отдельные деревья (например, старая липа во дворе замка)
  for (const t of extraTrees) {
    placed[t.sp].push({ x: t.x, y: terrain.heightAt(t.x, t.z) - 0.15, z: t.z, s: t.s, rot: t.rot || 0, tint: 1, v: t.v || 0 });
  }
  const groups = [];
  const barkMats = { bark: pbrMaterial('bark'), birchBark: pbrMaterial('birchBark') };
  for (const [name, list] of Object.entries(placed)) {
    if (!list.length) continue;
    const sp = SPECIES[name];
    const leafMat = foliageMaterial(foliageTexture(sp.leaf, sp.leafHue), name === 'pine');
    // 3 варианта формы на породу, у каждого ближний и дальний уровни детализации
    for (let v = 0; v < 3; v++) {
      const inst = list.filter((t) => t.v === v);
      if (!inst.length) continue;
      const geo = buildSpecies(name, v);
      const mk = (g, m, cast) => {
        const im = new THREE.InstancedMesh(g, m, inst.length);
        im.count = 0;
        im.castShadow = cast;
        if (!cast) im.layers.set(2); // дальние деревья не отражаются в воде
        im.name = 'tree';
        im.receiveShadow = true;
        im.frustumCulled = false;
        im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(inst.length * 3), 3);
        scene.add(im);
        return im;
      };
      groups.push({
        inst,
        near: [mk(geo.trunk, barkMats[sp.bark], true), mk(geo.leaves, leafMat, true)],
        far: [mk(geo.trunkFar, barkMats[sp.bark], false), mk(geo.leavesFar, leafMat, false)],
      });
    }
  }
  // Матрицы и цвета считаются один раз; при движении камеры в буферы копируются
  // только деревья, попавшие в поле зрения (отсечение по пирамиде видимости) —
  // деревья за спиной и сбоку больше не рисуются.
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  for (const g of groups) {
    g.mat = new Float32Array(g.inst.length * 16);
    g.col = new Float32Array(g.inst.length * 3);
    g.inst.forEach((t, i) => {
      q.setFromAxisAngle(up, t.rot);
      m.compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
      m.toArray(g.mat, i * 16);
      col.setRGB(t.tint, t.tint * (0.95 + (t.tint - 1) * 0.3), t.tint * 0.9);
      col.toArray(g.col, i * 3);
    });
  }
  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  const lastPos = new THREE.Vector3(Infinity, 0, 0);
  const lastDir = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const copyTo = (im, g, src, dst) => {
    im.instanceMatrix.array.set(g.mat.subarray(src * 16, src * 16 + 16), dst * 16);
    im.instanceColor.array.set(g.col.subarray(src * 3, src * 3 + 3), dst * 3);
  };
  function relod(camera) {
    const camPos = camera.position;
    camera.getWorldDirection(dir);
    // пересчёт — только при заметном сдвиге или повороте камеры
    if (camPos.distanceTo(lastPos) < 4 && dir.dot(lastDir) > 0.998) return;
    lastPos.copy(camPos);
    lastDir.copy(dir);
    camera.updateMatrixWorld();
    // пирамида чуть шире кадра, чтобы при повороте края не «проявлялись»
    const fov = camera.fov;
    camera.fov = Math.min(120, fov * 1.35);
    camera.updateProjectionMatrix();
    pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    frustum.setFromProjectionMatrix(pv);
    const R = Q.treeDetailDistance;
    const near = Math.min(R, 45); // в тени нужны и ближние деревья вне кадра
    for (const g of groups) {
      let nn = 0, nf = 0;
      for (let i = 0; i < g.inst.length; i++) {
        const t = g.inst[i];
        const d = Math.hypot(t.x - camPos.x, t.z - camPos.z, t.y - camPos.y);
        sphere.center.set(t.x, t.y + 5 * t.s, t.z);
        sphere.radius = 9 * t.s;
        if (d > near && !frustum.intersectsSphere(sphere)) continue;
        if (d < R) { for (const im of g.near) copyTo(im, g, i, nn); nn++; }
        else { for (const im of g.far) copyTo(im, g, i, nf); nf++; }
      }
      for (const im of g.near) { im.count = nn; im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; }
      for (const im of g.far) { im.count = nf; im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; }
    }
  }
  const total = Object.values(placed).reduce((a, l) => a + l.length, 0);
  return { relod, total };
}

// ---------------------------------------------------------------------------
export function createVegetation(scene, terrain, { exclude, excludeTrees, extraTrees } = {}) {
  const groundTex = buildGroundTexture(terrain, exclude);
  const d = Q.grassDensity;
  const inner = grassLayer(groundTex, {
    spacing: 0.34 / Math.sqrt(d), radius: 22, inner: 0, blades: 8, segs: 2, height: 0.34, width: 0.07, clumpR: 0.2, seed: 1,
  });
  const outer = grassLayer(groundTex, {
    spacing: 1.0 / Math.sqrt(d), radius: Q.grassRadius, inner: 20, blades: 8, segs: 2, height: 0.42, width: 0.08, clumpR: 0.45, seed: 2,
  });
  scene.add(inner.mesh, outer.mesh);
  const trees = createTrees(scene, terrain, excludeTrees, extraTrees);
  return {
    trees,
    // 2 — вся трава, 1 — только ближняя, 0 — без травы (автоупрощение)
    setGrassLevel(l) { outer.mesh.visible = l >= 2; inner.mesh.visible = l >= 1; },
    update(t, camera) {
      WIND.uTime.value = t;
      // трава рисуется вокруг камеры; если камера высоко — вокруг точки под ней
      inner.uniforms.uCam.value.set(camera.position.x, camera.position.z);
      outer.uniforms.uCam.value.set(camera.position.x, camera.position.z);
      trees.relod(camera);
    },
  };
}
