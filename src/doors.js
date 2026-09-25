// Двери, которые открываются: полотна всех таких дверей собраны в две сетки
// (дерево и железо), каждая вершина знает номер своей двери, а поворот вокруг
// петель считает шейдер — сколько бы ни было дверей, это два вызова отрисовки.
// Клавиша E открывает или закрывает ближайшую дверь перед камерой.
import * as THREE from 'three';
import { GeoBuilder } from './walls.js';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);
const MAX = 96;

export const DOORS = { list: [], wood: null, metal: null };

// Начать полотно двери. hinge — точка на оси петель (на уровне порога),
// n — наружу от здания, side — в какую сторону от петель (вдоль стены) лежит полотно. Возвращает билдеры, куда класть геометрию полотна.
export function beginDoor(woodTile, hinge, n, w, h, side = 1) {
  if (!DOORS.wood) { DOORS.wood = new GeoBuilder(woodTile); DOORS.metal = new GeoBuilder(1); }
  if (DOORS.list.length >= MAX) return null;
  const d = {
    id: DOORS.list.length, hinge: hinge.clone(), n: n.clone().setY(0).normalize(), w, h, side,
    w0: DOORS.wood.pos.length / 3, m0: DOORS.metal.pos.length / 3, open: 0, target: 0,
  };
  DOORS.list.push(d);
  return { wood: DOORS.wood, metal: DOORS.metal, d };
}
export function endDoor(d) {
  d.w1 = DOORS.wood.pos.length / 3;
  d.m1 = DOORS.metal.pos.length / 3;
  // центр полотна — для поиска ближайшей двери
  const t = new V3().crossVectors(UP, d.n).normalize();
  d.center = d.hinge.clone().addScaledVector(t, d.side * d.w / 2).add(new V3(0, d.h / 2, 0));
  // в какую сторону поворачивать, чтобы дверь открывалась внутрь
  const test = new V3().copy(t).multiplyScalar(d.side).applyAxisAngle(UP, 0.3);
  d.dir = test.dot(d.n) < 0 ? 1 : -1;
}

function doorMaterial(base, uAng, uHinge) {
  const prev = base.onBeforeCompile;
  base.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uDoorA = uAng;
    sh.uniforms.uDoorH = uHinge;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aDoor;
        uniform float uDoorA[${MAX}];
        uniform vec3 uDoorH[${MAX}];`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        int di = int(aDoor + 0.5);
        float da = uDoorA[di];
        float dc = cos(da), ds = sin(da);
        objectNormal.xz = mat2(dc, -ds, ds, dc) * objectNormal.xz;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 hg = uDoorH[di];
          vec2 q = transformed.xz - hg.xz;
          transformed.xz = hg.xz + mat2(dc, -ds, ds, dc) * q;
        }`);
  };
  const key = base.customProgramCacheKey ? base.customProgramCacheKey.bind(base) : () => '';
  base.customProgramCacheKey = () => 'door-' + key();
  return base;
}

// Собрать сетки дверей (вызывается один раз, когда все здания построены)
export function createDoors(scene, woodMat, ironMat, camera) {
  if (!DOORS.wood || !DOORS.list.length) return { update() {} };
  const uAng = { value: new Array(MAX).fill(0) };
  const uHinge = { value: Array.from({ length: MAX }, () => new V3()) };
  DOORS.list.forEach((d) => uHinge.value[d.id].copy(d.hinge));
  const mk = (b, mat, key) => {
    const g = b.build();
    const n = g.getAttribute('position').count;
    const ids = new Float32Array(n);
    for (const d of DOORS.list) for (let i = d[key + '0']; i < d[key + '1']; i++) ids[i] = d.id;
    g.setAttribute('aDoor', new THREE.Float32BufferAttribute(ids, 1));
    const m = new THREE.Mesh(g, doorMaterial(mat, uAng, uHinge));
    m.castShadow = m.receiveShadow = true;
    m.frustumCulled = false; // полотна двигает шейдер
    m.name = 'doors';
    scene.add(m);
    return m;
  };
  mk(DOORS.wood, woodMat, 'w');
  if (DOORS.metal.pos.length) mk(DOORS.metal, ironMat, 'm');

  // подсказка «E — открыть дверь»
  const hint = document.createElement('div');
  hint.id = 'door-hint';
  hint.textContent = 'E — открыть дверь';
  document.body.appendChild(hint);
  let near = null;
  const fwd = new V3(), tmp = new V3();
  const findNear = () => {
    camera.getWorldDirection(fwd);
    let best = null, bs = 1e9;
    for (const d of DOORS.list) {
      tmp.copy(d.center).sub(camera.position);
      const dist = tmp.length();
      if (dist > 12) continue;
      const facing = tmp.dot(fwd) / (dist || 1);
      if (facing < 0.35 && dist > 2.5) continue; // дверь должна быть впереди
      const score = dist * (1.6 - facing);
      if (score < bs) { bs = score; best = d; }
    }
    return best;
  };
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyE' || e.repeat) return;
    const d = findNear();
    if (d) d.target = d.target > 0.5 ? 0 : 1;
  });
  let acc = 0;
  return {
    update(dt) {
      acc += dt;
      if (acc > 0.15) { // поиск ближайшей двери — несколько раз в секунду
        acc = 0;
        near = findNear();
        hint.textContent = near && near.target > 0.5 ? 'E — закрыть дверь' : 'E — открыть дверь';
        hint.classList.toggle('show', !!near);
      }
      for (const d of DOORS.list) {
        if (d.open === d.target) continue;
        const sp = dt * 1.1;
        d.open = d.target > d.open ? Math.min(d.target, d.open + sp) : Math.max(d.target, d.open - sp);
        const e = d.open * d.open * (3 - 2 * d.open);
        uAng.value[d.id] = d.dir * e * 1.65;
      }
    },
    toggleNearest() { const d = findNear(); if (d) d.target = d.target > 0.5 ? 0 : 1; },
    list: DOORS.list,
  };
}
