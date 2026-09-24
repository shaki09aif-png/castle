// Этап 8: факелы у ворот, дверей и на стенах двора. Держатель — кованая
// скоба и деревянная рукоять; огонь — анимированный шейдер на
// «крестовине» из двух плоскостей; тёплое мерцающее пятно света на стене.
// Все языки пламени рисуются одним вызовом (InstancedMesh), точечных
// источников света нет — это очень дёшево даже для слабых компьютеров.
import * as THREE from 'three';
import { GATEHOUSE, GATE_PASSAGE, BARBICAN, BUILDINGS, KEEP, WALL } from './layout.js';
import { GeoBuilder } from './walls.js';
import { Frame } from './courtyard.js';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);

const flameVS = /* glsl */ `
  attribute float aSeed;
  varying vec2 vUv;
  varying float vSeed;
  uniform float uTime;
  void main() {
    vUv = uv;
    vSeed = aSeed;
    vec3 p = position;
    // язык пламени покачивается, кончик сильнее
    float k = uv.y * uv.y;
    p.x += sin(uTime * 7.0 + aSeed * 10.0) * 0.05 * k;
    p.z += cos(uTime * 5.3 + aSeed * 7.0) * 0.04 * k;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  }
`;
const flameFS = /* glsl */ `
  varying vec2 vUv;
  varying float vSeed;
  uniform float uTime;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  void main() {
    vec2 uv = vUv;
    float t = uTime * 2.2 + vSeed * 13.0;
    // бегущий вверх шум — «языки»
    float n = noise(vec2(uv.x * 5.0, uv.y * 3.5 - t * 1.8)) * 0.65 + noise(vec2(uv.x * 11.0, uv.y * 7.0 - t * 3.1)) * 0.35;
    float w = (1.0 - uv.y) * 0.42 + 0.05;
    float d = abs(uv.x - 0.5) / w;
    float shape = (1.0 - smoothstep(0.55, 1.0, d + (n - 0.5) * 0.9)) * smoothstep(0.0, 0.1, uv.y) * (1.0 - smoothstep(0.55, 1.0, uv.y + (n - 0.5) * 0.4));
    float core = (1.0 - smoothstep(0.0, 0.55, d)) * (1.0 - smoothstep(0.1, 0.6, uv.y));
    vec3 col = mix(vec3(1.0, 0.25, 0.03), vec3(1.0, 0.72, 0.25), shape);
    col = mix(col, vec3(1.0, 0.95, 0.75), core);
    float flick = 0.85 + 0.15 * sin(uTime * 17.0 + vSeed * 31.0);
    gl_FragColor = vec4(col * (2.2 + core * 2.5) * flick, shape);
    if (gl_FragColor.a < 0.02) discard;
  }
`;
const glowFS = /* glsl */ `
  varying vec2 vUv;
  varying float vSeed;
  uniform float uTime;
  uniform float uBoost;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float flick = 0.8 + 0.12 * sin(uTime * 9.0 + vSeed * 20.0) + 0.08 * sin(uTime * 23.0 + vSeed * 7.0);
    float a = pow(max(0.0, 1.0 - d), 2.2) * 0.35 * flick * uBoost;
    gl_FragColor = vec4(vec3(1.0, 0.55, 0.2) * a, 1.0);
  }
`;
const glowVS = /* glsl */ `
  attribute float aSeed;
  varying vec2 vUv;
  varying float vSeed;
  void main() {
    vUv = uv;
    vSeed = aSeed;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

export function createTorches(scene, terrain, walls) {
  const list = []; // { p: точка на стене, n: нормаль стены }
  const add = (p, n) => list.push({ p: p.clone(), n: n.clone().normalize() });
  const G = GATEHOUSE, P = GATE_PASSAGE;
  const floorY = P.thresholdY;
  // надвратная башня: по обе стороны арки снаружи и со двора
  for (const sx of [-1, 1]) {
    add(new V3(G.x + sx * (P.width / 2 + 1.45), floorY + 2.9, P.frontZ), new V3(0, 0, 1));
    add(new V3(G.x + sx * (P.width / 2 + 0.9), floorY + 2.7, P.backZ), new V3(0, 0, -1));
  }
  // ворота барбакана
  const bz = BARBICAN.zS + BARBICAN.thick / 2;
  const bg = terrain.heightAt(0, bz + 1);
  for (const sx of [-1, 1]) add(new V3(sx * (BARBICAN.gateHalf + 0.8), bg + 2.6, bz), new V3(0, 0, 1));
  // донжон: по сторонам поднятого входа
  const kn = new V3(Math.cos(KEEP.yaw), 0, Math.sin(KEEP.yaw)), kt = new V3(-Math.sin(KEEP.yaw), 0, Math.cos(KEEP.yaw));
  const kg = terrain.heightAt(KEEP.x + kn.x * (KEEP.r + 1.5), KEEP.z + kn.z * (KEEP.r + 1.5));
  for (const s of [-3.6, -0.8]) add(new V3(KEEP.x, 0, KEEP.z).addScaledVector(kn, KEEP.r).addScaledVector(kt, s).setY(kg + 9.2), kn);
  // двери построек двора
  const doorAt = { hall: [6.4, 1.5], chapel: [-4.6, 1.1], barracks: [-3.6, 1.0], kitchen: [-1.4, 1.0], store: [0, 1.8] };
  for (const b of BUILDINGS) {
    const d = doorAt[b.id];
    if (!d) continue;
    const f = new Frame(b);
    const base = f.p(d[0], 0, b.W / 2);
    const g = terrain.heightAt(base.x + f.N.x, base.z + f.N.z);
    const lift = b.id === 'hall' ? 1.1 : b.id === 'chapel' ? 0.5 : 0.2;
    for (const s of b.id === 'hall' ? [-1, 1] : [1]) add(f.p(d[0] + s * d[1], g + lift + 2.5, b.W / 2), f.N);
  }
  // внутренние стороны крепостной стены (под боевым ходом)
  const Pw = walls.points, Nw = walls.segNrm;
  for (let i = 1; i < Pw.length - 2; i += 4) {
    const c = Pw[i].clone().lerp(Pw[i + 1], 0.5).addScaledVector(Nw[i], -WALL.thickness / 2);
    if (BUILDINGS.some((b) => Math.hypot(c.x - b.x, c.z - b.z) < Math.max(b.L, b.W) / 2 + 2)) continue;
    add(c.setY(terrain.heightAt(c.x - Nw[i].x * 1.5, c.z - Nw[i].z * 1.5) + 2.7), Nw[i].clone().negate());
  }

  // держатели: скоба из железа + рукоять из дерева
  const iron = new GeoBuilder(1), wood = new GeoBuilder(walls.woodMaterial.userData.tileMeters);
  const flames = [], glows = [];
  for (const { p, n } of list) {
    const t = new V3().crossVectors(UP, n).normalize();
    iron.box(p.clone().addScaledVector(n, 0.03), t, UP, n, 0.07, 0.14, 0.03); // настенная пластина
    const arm = n.clone().multiplyScalar(0.8).addScaledVector(UP, 0.6).normalize();
    iron.box(p.clone().addScaledVector(n, 0.16).addScaledVector(UP, 0.1), t, arm, new V3().crossVectors(t, arm), 0.025, 0.17, 0.025);
    const cup = p.clone().addScaledVector(n, 0.3).addScaledVector(UP, 0.22);
    iron.addGeometry(new THREE.CylinderGeometry(0.07, 0.05, 0.1, 8, 1, true), new THREE.Matrix4().makeTranslation(cup.x, cup.y, cup.z));
    // рукоять слегка наклонена от стены
    const ax = UP.clone().addScaledVector(n, 0.25).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, ax);
    wood.addGeometry(new THREE.CylinderGeometry(0.035, 0.028, 0.6, 7), new THREE.Matrix4().compose(cup.clone().addScaledVector(ax, 0.15), q, new V3(1, 1, 1)));
    const head = cup.clone().addScaledVector(ax, 0.45);
    iron.addGeometry(new THREE.CylinderGeometry(0.055, 0.045, 0.12, 8), new THREE.Matrix4().compose(head, q, new V3(1, 1, 1)));
    flames.push(head.clone().addScaledVector(ax, 0.05));
    glows.push({ c: p.clone().addScaledVector(n, 0.02).addScaledVector(UP, 0.5), n });
  }
  for (const [b, mat, name] of [[iron, new THREE.MeshStandardMaterial({ color: 0x2a2724, metalness: 0.8, roughness: 0.55 }), 'torch-iron'], [wood, walls.woodMaterial, 'torch-wood']]) {
    const m = new THREE.Mesh(b.build(), mat);
    m.castShadow = true;
    m.name = name;
    m.layers.set(1);
    scene.add(m);
  }

  const uTime = { value: 0 };
  const seeds = new Float32Array(list.length).map((_, i) => (i * 0.618) % 1);
  // пламя: две скрещённые плоскости
  const fg = new THREE.PlaneGeometry(0.34, 0.7, 1, 4);
  fg.translate(0, 0.35, 0);
  const fg2 = fg.clone().rotateY(Math.PI / 2);
  const flameGeo = new THREE.BufferGeometry();
  const merge = (a, b) => {
    for (const name of ['position', 'uv']) {
      const A = a.getAttribute(name).array, B = b.getAttribute(name).array;
      const arr = new Float32Array(A.length + B.length);
      arr.set(A); arr.set(B, A.length);
      flameGeo.setAttribute(name, new THREE.BufferAttribute(arr, name === 'uv' ? 2 : 3));
    }
    const off = a.getAttribute('position').count;
    flameGeo.setIndex([...a.index.array, ...Array.from(b.index.array, (i) => i + off)]);
  };
  merge(fg, fg2);
  flameGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  const flameMat = new THREE.ShaderMaterial({
    uniforms: { uTime }, vertexShader: flameVS, fragmentShader: flameFS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const fm = new THREE.InstancedMesh(flameGeo, flameMat, flames.length);
  flames.forEach((p, i) => fm.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
  fm.frustumCulled = false;
  fm.renderOrder = 10;
  fm.layers.set(1);
  scene.add(fm);
  // тёплое пятно света на стене вокруг факела
  const gg = new THREE.PlaneGeometry(3.2, 3.2);
  gg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  const uBoost = { value: 1 };
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uTime, uBoost }, vertexShader: glowVS, fragmentShader: glowFS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const gm = new THREE.InstancedMesh(gg, glowMat, glows.length);
  glows.forEach(({ c, n }, i) => {
    const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), n);
    gm.setMatrixAt(i, new THREE.Matrix4().compose(c, q, new V3(1, 1, 1)));
  });
  gm.frustumCulled = false;
  gm.renderOrder = 9;
  gm.layers.set(1);
  scene.add(gm);

  // ночью — световые пятна на земле перед факелами (включаются только в темноте)
  const pools = [];
  for (const { c, n } of glows) {
    const pc = c.clone().addScaledVector(n, 1.6);
    const g = terrain.heightAt(pc.x, pc.z);
    if (c.y - g < 4.5) pools.push(pc.setY(g + 0.06));
  }
  const uPool = { value: 0 };
  const pg = new THREE.PlaneGeometry(7, 7).rotateX(-Math.PI / 2);
  pg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds.slice(0, Math.max(1, pools.length)), 1));
  const poolMat = new THREE.ShaderMaterial({
    uniforms: { uTime, uBoost: uPool }, vertexShader: glowVS, fragmentShader: glowFS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const pm = new THREE.InstancedMesh(pg, poolMat, Math.max(1, pools.length));
  pools.forEach((c, i) => pm.setMatrixAt(i, new THREE.Matrix4().makeTranslation(c.x, c.y, c.z)));
  pm.count = pools.length;
  pm.frustumCulled = false;
  pm.renderOrder = 9;
  pm.layers.set(1);
  pm.visible = false;
  scene.add(pm);

  return {
    count: list.length,
    update(t) { uTime.value = t; },
    // k: 0 — день, 1 — ночь. Ночью пятна света от факелов ярче и больше.
    setNight(k) {
      uBoost.value = 1 + k * 2.6;
      uPool.value = k * 1.4;
      pm.visible = k > 0.02;
    },
  };
}
