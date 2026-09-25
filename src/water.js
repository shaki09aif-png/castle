// Река: вода с отражениями и волнами (Water из three/examples) вдоль русла.
import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { riverZ, riverHalfWidth, RIVER } from './layout.js';
import { waterNormalTexture } from './textures.js';
import { SUN_DIR, SUN_COLOR } from './lighting.js';
import { Q } from './quality.js';

// Защита от вложенных отражений: пока одна вода рисует своё отражение,
// другая (река/ров) своё отражение не пересчитывает.
let inReflection = false;
export const REFLECT = { on: true }; // выключается автоупрощением
export function guardReflection(mesh) {
  const orig = mesh.onBeforeRender;
  mesh.onBeforeRender = function (...args) {
    if (inReflection || !REFLECT.on) return;
    inReflection = true;
    try {
      orig.apply(this, args);
    } finally {
      inReflection = false;
    }
  };
}

// Лента поверх русла. Строится в плоскости XY и поворачивается на −90° вокруг X:
// Water.js ожидает плоскость с нормалью (0,0,1) в локальных координатах.
function riverGeometry(x0, x1, step) {
  const positions = [], uvs = [], idx = [];
  let vi = 0;
  for (let x = x0; x <= x1; x += step) {
    const z = riverZ(x);
    const d = (riverZ(x + 1) - riverZ(x - 1)) / 2;
    const l = Math.hypot(1, d);
    const nx = -d / l, nz = 1 / l;
    const hw = riverHalfWidth(x) + 5.5;
    // локальные (x, -z): после поворота получится мировое (x, 0, z)
    positions.push(x - nx * hw, -(z - nz * hw), 0, x + nx * hw, -(z + nz * hw), 0);
    uvs.push(x - nx * hw, z - nz * hw, x + nx * hw, z + nz * hw);
    if (vi > 0) idx.push(vi - 2, vi - 1, vi, vi - 1, vi + 1, vi);
    vi += 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (g.getAttribute('normal').getZ(0) < 0) {
    const ia = g.index.array;
    for (let k = 0; k < ia.length; k += 3) { const t = ia[k + 1]; ia[k + 1] = ia[k + 2]; ia[k + 2] = t; }
    g.computeVertexNormals();
  }
  g.computeBoundingSphere();
  return g;
}

// Мелководье и пена у берегов: полупрозрачная лента вдоль кромки воды —
// переход от воды к берегу мягче, у берега бегут белые барашки
function shoreFoam(scene) {
  const pos = [], uv = [], idx = [];
  let vi = 0;
  for (const side of [-1, 1]) {
    let first = true;
    for (let x = -520; x <= 640; x += 3) {
      const z = riverZ(x), d = (riverZ(x + 1) - riverZ(x - 1)) / 2, l = Math.hypot(1, d);
      const nx = -d / l * side, nz = 1 / l * side;
      const hw = riverHalfWidth(x);
      for (const [off, u] of [[hw - 3.2, 0], [hw + 1.2, 1]]) {
        pos.push(x + nx * off, RIVER.waterLevel + 0.03, z + nz * off);
        uv.push(u, x / 5);
      }
      if (!first) idx.push(vi - 2, vi - 1, vi, vi - 1, vi + 1, vi);
      first = false;
      vi += 2;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  const uT = { value: 0 };
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uT = uT;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSU;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSU = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vSU;
        uniform float uT;
        float hS(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float nS(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hS(i), hS(i + vec2(1, 0)), f.x), mix(hS(i + vec2(0, 1)), hS(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float u = vSU.x;
          float n = nS(vec2(u * 6.0 + uT * 0.4, vSU.y * 3.0 - uT * 0.25)) * 0.6 + nS(vec2(u * 14.0 - uT * 0.7, vSU.y * 8.0)) * 0.4;
          float shallow = smoothstep(0.1, 0.85, u) * (1.0 - smoothstep(0.9, 1.0, u));
          float wave = 0.5 + 0.5 * sin(uT * 1.3 + vSU.y * 1.7 - u * 6.0);
          float foam = smoothstep(0.62, 0.8, u) * (1.0 - smoothstep(0.84, 0.97, u)) * smoothstep(0.45, 0.75, n + wave * 0.25);
          vec3 shallowC = vec3(0.28, 0.33, 0.26);
          diffuseColor.rgb = mix(shallowC, vec3(0.9, 0.93, 0.92), clamp(foam * 1.6, 0.0, 1.0));
          diffuseColor.a = max(shallow * 0.32, foam * 0.7);
        }`);
  };
  mat.customProgramCacheKey = () => 'shore-foam';
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 3;
  m.name = 'shore';
  m.frustumCulled = false;
  scene.add(m);
  // пятно пены (у мельничного колеса, у камней): в центре пена гуще
  const addSpot = (x, z, r) => {
    const p2 = [x, RIVER.waterLevel + 0.04, z], u2 = [0.8, 0], i2 = [];
    for (let k = 0; k <= 20; k++) {
      const a = (k / 20) * Math.PI * 2, rr = r * (0.8 + 0.2 * Math.sin(k * 2.7));
      p2.push(x + Math.cos(a) * rr, RIVER.waterLevel + 0.04, z + Math.sin(a) * rr); u2.push(0.3, k / 5);
      if (k > 0) i2.push(0, k, k + 1);
    }
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute(p2, 3));
    g2.setAttribute('uv', new THREE.Float32BufferAttribute(u2, 2));
    g2.setAttribute('normal', new THREE.Float32BufferAttribute(p2.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g2.setIndex(i2);
    const sm = new THREE.Mesh(g2, mat);
    sm.renderOrder = 3;
    scene.add(sm);
  };
  return { mesh: m, uT, addSpot };
}

export function createRiver(scene) {
  const geo = riverGeometry(-2400, 2400, 3);
  let mesh;
  if (Q.waterReflection) {
    mesh = new Water(geo, {
      textureWidth: Q.reflectionSize,
      textureHeight: Q.reflectionSize,
      waterNormals: waterNormalTexture(),
      sunDirection: SUN_DIR.clone(),
      sunColor: SUN_COLOR,
      waterColor: 0x14302c,
      distortionScale: 2.2,
      alpha: 0.93,
      fog: true,
    });
    mesh.material.transparent = true;
    mesh.material.uniforms.size.value = 1.6;
    guardReflection(mesh);
    // на среднем качестве отражение обновляется через кадр (заметно только при резком повороте)
    if (Q.reflectionEvery > 1) {
      const orig = mesh.onBeforeRender;
      let n = 0;
      mesh.onBeforeRender = function (...args) {
        if (n++ % Q.reflectionEvery === 0) orig.apply(this, args);
      };
    }
  } else {
    const nm = waterNormalTexture().clone();
    nm.repeat.set(0.08, 0.08);
    mesh = new THREE.Mesh(
      geo,
      new THREE.MeshPhysicalMaterial({
        color: 0x1a3a36, roughness: 0.04, metalness: 0, normalMap: nm,
        normalScale: new THREE.Vector2(0.4, 0.4), transparent: true, opacity: 0.9,
      })
    );
  }
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = RIVER.waterLevel;
  mesh.receiveShadow = true;
  mesh.name = 'river';
  scene.add(mesh);
  const shore = shoreFoam(scene);
  return {
    mesh,
    addFoam: shore.addSpot,
    update(t) {
      shore.uT.value = t;
      if (mesh.material.uniforms) mesh.material.uniforms.time.value = t * 0.6;
      else mesh.material.normalMap.offset.set(t * 0.01, t * 0.02);
    },
  };
}
