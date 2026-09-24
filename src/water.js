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
  return {
    mesh,
    update(t) {
      if (mesh.material.uniforms) mesh.material.uniforms.time.value = t * 0.6;
      else mesh.material.normalMap.offset.set(t * 0.01, t * 0.02);
    },
  };
}
