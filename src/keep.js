// Этап 5: донжон — главная башня замка в самой высокой точке двора.
// Пять этажей, вход поднят на второй этаж (к нему ведёт деревянная лестница),
// угловые лопатки, каменные пояса между этажами, узкие окна-бойницы внизу и
// парные окна наверху, зубчатый парапет на консолях, угловые башенки-бартизаны,
// выступающая уборная на консолях, дымовая труба и флаг с гербом на вершине.
import * as THREE from 'three';
import { KEEP, WALL } from './layout.js';
import {
  makeTowerContext, finishTowerContext, buildTower, outline, band, ring, arrowSlit, door,
  windowWithShutters, coneRoof,
} from './towers.js';
import { createFlag } from './flags.js';
import { mulberry32 } from './noise.js';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);

export function createKeep(scene, terrain, walls) {
  const ctx = makeTowerContext(scene, terrain, walls);
  const { stone, wood, dark, metal, roof } = ctx;
  const K = KEEP;
  const C = new V3(K.x, 0, K.z);
  const face = (f) => {
    const a = K.yaw + (f * Math.PI) / 2;
    return { n: new V3(Math.cos(a), 0, Math.sin(a)), t: new V3(-Math.sin(a), 0, Math.cos(a)) };
  };
  const F0 = face(0);
  const onFace = (f, s, off = 0) => {
    const { n, t } = face(f);
    return C.clone().addScaledVector(n, K.r + off).addScaledVector(t, s);
  };
  // земля у входа (лицевая сторона)
  const pDoorGround = onFace(0, 0, 1.5);
  const g = terrain.heightAt(pDoorGround.x, pDoorGround.z);

  // тело, консольный пояс, парапет с зубцами, пол площадки
  const top = buildTower(ctx, K, {
    walkY: g, batterAll: true, roof: false, slits: false, walkDoors: false, groundDoor: false, window: false,
    outDir: F0.n,
  });
  const platY = top.platY;
  const lv = [g, g + 6.5, g + 13, g + 19, g + 24.5, platY]; // уровни этажей

  // ---------- угловые лопатки (плоские контрфорсы) ----------
  for (let f = 0; f < 4; f++) {
    const { n, t } = face(f);
    for (const sd of [-1, 1]) {
      const c = C.clone().addScaledVector(n, K.r + 0.2).addScaledVector(t, sd * (K.r - 1.1));
      const y0 = g + 3.3, y1 = platY - 1.12;
      stone.box(new V3(c.x, (y0 + y1) / 2, c.z), t, UP, n, 1.12, (y1 - y0) / 2, 0.24, { skipBottom: true });
      // скошенный уступ лопатки над цоколем
      stone.box(new V3(c.x, y0 - 0.1, c.z).addScaledVector(n, 0.05), t, UP, n, 1.14, 0.12, 0.3);
    }
  }
  // ---------- каменные пояса между этажами ----------
  for (const y of lv.slice(1, 5)) {
    const o0 = outline(K, 0), o1 = outline(K, 0.13);
    band(stone, o1, () => y - 0.14, () => y + 0.14);
    ring(stone, o0, o1, y + 0.14, UP);
    ring(stone, o0, o1, y - 0.14, UP.clone().negate());
  }

  // ---------- окна и бойницы по этажам ----------
  const slit = (f, s, y, cross = false) => {
    const { n } = face(f);
    arrowSlit(stone, dark, onFace(f, s), n, y, cross);
  };
  const win = (f, s, y) => {
    const { n } = face(f);
    windowWithShutters(stone, wood, dark, metal, onFace(f, s), n, y, 0.85, 1.5, 2.0);
  };
  // 1 этаж (кладовая): только узкие щели
  slit(1, 0, g + 4.2); slit(3, 0, g + 4.2);
  // 2 этаж (вход): бойницы
  slit(1, 0, lv[1] + 3.0); slit(2, 0, lv[1] + 3.0); slit(3, 0, lv[1] + 3.0); slit(0, 2.6, lv[1] + 3.2);
  // 3 этаж (зал): парное окно к воротам, бойницы
  win(0, 0, lv[2] + 2.8); slit(1, -2.4, lv[2] + 2.8, true); slit(1, 2.4, lv[2] + 2.8, true); slit(2, 0, lv[2] + 2.8); slit(3, 2.4, lv[2] + 2.8);
  // 4 этаж (покои): окна на две стороны
  win(0, 0, lv[3] + 2.5); win(1, 0, lv[3] + 2.5); slit(2, -2.4, lv[3] + 2.5); slit(3, 1.5, lv[3] + 2.5);
  // 5 этаж (стража): крестообразные бойницы на все стороны
  for (let f = 0; f < 4; f++) for (const s of [-2.6, 2.6]) slit(f, s, lv[4] + 2.2, true);

  // ---------- поднятый вход и деревянная лестница ----------
  const doorS = -2.2;
  const doorY = lv[1] + 0.2;
  door(stone, wood, metal, onFace(0, doorS), F0.n, doorY, 1.2, 2.6);
  const oakW = wood;
  const land = { s0: doorS - 1.2, s1: doorS + 1.1, out: 1.7 };
  // площадка перед дверью на столбах
  {
    const c = onFace(0, (land.s0 + land.s1) / 2, 0.45 + land.out / 2);
    oakW.box(new V3(c.x, doorY - 0.06, c.z), F0.t, UP, F0.n, (land.s1 - land.s0) / 2, 0.06, land.out / 2, { grain: true });
    for (const s of [land.s0 + 0.1, land.s1 - 0.1]) {
      const pp = onFace(0, s, 0.45 + land.out - 0.1);
      const gy = terrain.heightAt(pp.x, pp.z) - 0.3;
      oakW.box(new V3(pp.x, (gy + doorY) / 2, pp.z), UP, F0.t, F0.n, (doorY - gy) / 2, 0.1, 0.1, { grain: true });
      oakW.box(new V3(pp.x, doorY + 0.55, pp.z), UP, F0.t, F0.n, 0.55, 0.06, 0.06, { grain: true });
    }
    const rail = onFace(0, (land.s0 + land.s1) / 2, 0.45 + land.out - 0.1);
    oakW.box(new V3(rail.x, doorY + 1.05, rail.z), F0.t, UP, F0.n, (land.s1 - land.s0) / 2, 0.05, 0.05, { grain: true });
  }
  // марш вниз вдоль стены (от площадки в сторону +s)
  const rise = 0.25, run = 0.29, sw = 1.2;
  const steps = Math.ceil((doorY - g) / rise);
  const offS = 0.45 + 0.1 + sw / 2; // расстояние от стены (над цоколем)
  let lastS = land.s1;
  for (let k = 1; k <= steps; k++) {
    const y = doorY - k * rise;
    const s = land.s1 + (k - 0.5) * run;
    const p = onFace(0, s, offS);
    const gy = terrain.heightAt(p.x, p.z);
    if (y < gy - 0.05) break;
    oakW.box(new V3(p.x, y + 0.04, p.z), F0.n, UP, F0.t, sw / 2, 0.045, run / 2 + 0.02, { grain: true });
    lastS = s;
  }
  // тетивы, столбы и перила марша
  const sA = land.s1, sB = lastS + run / 2;
  const yA = doorY, yB = doorY - (sB - sA) / run * rise;
  const dir = new V3().addScaledVector(F0.t, sB - sA).addScaledVector(UP, yB - yA);
  const len = dir.length();
  dir.normalize();
  const side = new V3().crossVectors(dir, F0.n).normalize();
  for (const o of [offS - sw / 2 + 0.05, offS + sw / 2 - 0.05]) {
    const mid = onFace(0, (sA + sB) / 2, o);
    oakW.box(new V3(mid.x, (yA + yB) / 2 - 0.12, mid.z), dir, side, F0.n, len / 2, 0.14, 0.05, { grain: true });
  }
  const railO = offS + sw / 2 - 0.05;
  for (let k = 0; k <= 3; k++) {
    const s = sA + (k / 3) * (sB - sA);
    const y = yA + (k / 3) * (yB - yA);
    const pp = onFace(0, s, railO);
    const gy = terrain.heightAt(pp.x, pp.z) - 0.3;
    oakW.box(new V3(pp.x, (gy + y + 1.0) / 2, pp.z), UP, F0.t, F0.n, (y + 1.0 - gy) / 2, 0.08, 0.08, { grain: true });
  }
  const rm = onFace(0, (sA + sB) / 2, railO);
  oakW.box(new V3(rm.x, (yA + yB) / 2 + 1.0, rm.z), dir, side, F0.n, len / 2, 0.05, 0.05, { grain: true });

  // ---------- уборная (гардероб) на консолях, задняя сторона ----------
  {
    const f = 2, { n, t } = face(f);
    const s = 2.4, y0 = lv[3] - 0.2, h = 2.5, w = 1.7, out = 1.1;
    const c = onFace(f, s, out / 2);
    stone.box(new V3(c.x, y0 + h / 2, c.z), t, UP, n, w / 2, h / 2, out / 2);
    // каменный скат-крыша
    const rc = onFace(f, s, out / 2 + 0.05);
    const ax = new V3().addScaledVector(n, 1).addScaledVector(UP, -0.55).normalize();
    stone.box(new V3(rc.x, y0 + h + 0.12, rc.z), ax, t, new V3().crossVectors(ax, t).negate(), out / 2 + 0.25, w / 2 + 0.1, 0.1);
    // консоли и отверстие-сток снизу
    for (const sd of [-0.6, 0, 0.6]) {
      for (let k = 0; k < 3; k++) {
        const cc = onFace(f, s + sd, (out * (3 - k)) / 6);
        stone.box(new V3(cc.x, y0 - 0.2 - k * 0.32, cc.z), t, UP, n, 0.17, 0.15, (out * (3 - k)) / 6 + 0.02);
      }
    }
    const hole = onFace(f, s, out / 2);
    dark.box(new V3(hole.x, y0 - 0.005, hole.z), t, UP, n, 0.3, 0.01, 0.25);
    arrowSlit(stone, dark, onFace(f, s, out), n, y0 + 1.4, false);
  }

  // ---------- дымовая труба камина ----------
  {
    const f = 3, { n, t } = face(f);
    const s = -2.4, y0 = lv[2] + 0.5, y1 = platY + WALL.merlonHeight + 1.6, pr = 0.75, w = 1.5;
    const c = onFace(f, s, pr / 2);
    stone.box(new V3(c.x, (y0 + y1) / 2, c.z), t, UP, n, w / 2, (y1 - y0) / 2, pr / 2 + 0.02);
    // скос внизу и оголовок
    const ax = new V3().addScaledVector(n, -1).addScaledVector(UP, 1).normalize();
    const b = onFace(f, s, pr / 2);
    stone.box(new V3(b.x, y0 - 0.35, b.z), t, ax, new V3().crossVectors(t, ax), w / 2, 0.6, 0.12);
    const cap = onFace(f, s, pr / 2);
    stone.box(new V3(cap.x, y1 + 0.12, cap.z), t, UP, n, w / 2 + 0.12, 0.12, pr / 2 + 0.12);
    dark.box(new V3(cap.x, y1 + 0.245, cap.z), t, UP, n, w / 2 - 0.15, 0.01, pr / 2 - 0.12);
  }

  // ---------- угловые башенки-бартизаны ----------
  const iron = ctx.ironMat;
  for (let f = 0; f < 4; f++) {
    const a = face(f), b = face((f + 1) % 4);
    const corner = C.clone().addScaledVector(a.n, K.r).addScaledVector(b.n, K.r);
    const diag = a.n.clone().add(b.n).normalize();
    const tc = corner.clone().addScaledVector(diag, 0.55);
    const tr = 1.45;
    const T = { shape: 'round', x: tc.x, z: tc.z, r: tr };
    const yB = platY - 0.6, yT = platY + WALL.merlonHeight + 1.2;
    // ступенчатая консоль из колец
    for (let k = 0; k < 4; k++) {
      const rr = tr - 0.3 * (k + 1);
      const oIn = outline(T, rr - tr - 0.25, 24), oOut = outline(T, rr - tr, 24);
      band(stone, oOut, () => yB - (k + 1) * 0.35, () => yB - k * 0.35);
      ring(stone, oIn, oOut, yB - (k + 1) * 0.35, UP.clone().negate());
    }
    band(stone, outline(T, 0, 24), () => yB, () => yT);
    // щели в башенке
    for (const ang of [-0.6, 0.6]) {
      const d = diag.clone().applyAxisAngle(UP, ang);
      arrowSlit(stone, dark, tc.clone().addScaledVector(d, tr), d, yB + 1.9, false);
    }
    const apex = coneRoof(roof, tc, tr + 0.3, yT, (tr + 0.3) * 2.6, ctx.photoRoof);
    ctx.metal.addGeometry(new THREE.CylinderGeometry(0.03, 0.05, 1.3, 6), new THREE.Matrix4().makeTranslation(tc.x, apex + 0.4, tc.z));
    ctx.gold.addGeometry(new THREE.SphereGeometry(0.1, 12, 8), new THREE.Matrix4().makeTranslation(tc.x, apex + 0.3, tc.z));
  }

  // ---------- флагшток и флаг ----------
  const uTime = { value: 0 };
  const poleH = 9;
  const poleBase = C.clone().setY(platY);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, poleH, 10), walls.woodMaterial);
  pole.position.copy(poleBase).add(new V3(0, poleH / 2, 0));
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), ctx.goldMat);
  knob.position.copy(poleBase).add(new V3(0, poleH + 0.12, 0));
  pole.castShadow = knob.castShadow = true;
  scene.add(pole, knob);
  // растяжки флагштока к парапету
  for (let k = 0; k < 4; k++) {
    const a = face(k);
    const p0 = poleBase.clone().add(new V3(0, poleH * 0.6, 0));
    const p1 = C.clone().addScaledVector(a.n, K.r - 0.8).setY(platY + 0.9);
    const d = p1.clone().sub(p0);
    const l = d.length();
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, l, 4), iron);
    rope.position.copy(p0).addScaledVector(d, 0.5);
    rope.quaternion.setFromUnitVectors(UP, d.normalize());
    scene.add(rope);
  }
  const flagUpd = createFlag(scene, poleBase.clone().add(new V3(0, poleH - 0.15, 0)), uTime);

  const vanes = finishTowerContext(ctx, 'keep');
  return {
    top: platY,
    update(t) {
      uTime.value = t;
      flagUpd(t);
      vanes(t);
    },
  };
}
