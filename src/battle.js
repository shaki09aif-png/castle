// БОЙ ПРИ ШТУРМЕ. По тревоге из ворот вылетает конница (20 всадников) и за ней
// пешие (10), из лагеря навстречу выходит отряд осаждающих (36). На поле между
// лагерем и мостом они сходятся и бьются, убитые падают. Исход случайный:
// в 9 случаях из 10 побеждают рыцари (враги бегут в лагерь), в 1 из 10 —
// осаждающие: рыцари отступают в замок, враги идут на приступ с лестницами.
// Толпы рисуются инстансами (одна сетка на вид фигуры) — это дёшево для видеокарты.
import * as THREE from 'three';
import { ColorBuilder, person, addPersonShading, SWAY_TIME, TAIL_GLSL } from './people.js';
import { riderBuild } from './extras.js';
import { GATE_PASSAGE, BARBICAN, KEEP, insideBuilding, insideTower, riverZ, riverHalfWidth } from './layout.js';
import { mulberry32 } from './noise.js';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);

// материал толпы: те же качания ног и рук, что у ходящих, но фаза шага и размах —
// свои у каждого экземпляра (атрибуты iPhase, iAmp)
function crowdMaterial(human) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSwayTime = SWAY_TIME;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aLimb;\nattribute vec2 aSway;\nattribute float iPhase;\nattribute float iAmp;\nuniform float uSwayTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float uPhase = iPhase, uAmp = iAmp, uHuman = ${human.toFixed(2)};
        ${TAIL_GLSL}
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
        if (aSway.x > 2.5 && aSway.x < 3.5) {
          float na = sin(uPhase * 2.0 + 0.6) * 0.07 * uAmp / 0.45;
          float c = cos(na), s = sin(na);
          vec2 q = vec2(transformed.y - aSway.y, transformed.z - 0.6);
          transformed.y = aSway.y + q.x * c - q.y * s;
          transformed.z = 0.6 + q.x * s + q.y * c;
        }`);
  };
  mat.customProgramCacheKey = () => 'crowd' + human;
  addPersonShading(mat);
  return mat;
}

class Crowd {
  constructor(scene, build, n, human) {
    const B = new ColorBuilder();
    build(B);
    const geo = B.build();
    this.phase = new Float32Array(n);
    this.amp = new Float32Array(n);
    geo.setAttribute('iPhase', new THREE.InstancedBufferAttribute(this.phase, 1));
    geo.setAttribute('iAmp', new THREE.InstancedBufferAttribute(this.amp, 1));
    this.mesh = new THREE.InstancedMesh(geo, crowdMaterial(human), n);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false; this.mesh.receiveShadow = true;
    this.mesh.name = 'walker';
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.n = n;
  }
}

export function createBattle(scene, ctx, terrain, siege) {
  const camp = ctx.campSite, T = ctx.treb;
  const road = terrain.road;
  if (!camp || !T || !road || !siege) return { update() {} };
  const gh = terrain.heightAt;
  const rnd = mulberry32(4711);
  // ---------- поле боя: за мостом, между мостом и лагерем ----------
  const bi = road.findIndex((q, i) => i > 0 && road[i - 1].bridge && !q.bridge);
  const bEnd = bi > 0 ? new V3(road[bi + 3].x, 0, road[bi + 3].z) : new V3(road[Math.floor(road.length / 2)].x, 0, road[Math.floor(road.length / 2)].z);
  const campFront = T.pivot.clone().addScaledVector(T.A, 12).setY(0);
  // поле — на стороне лагеря, подальше от реки (чтобы свалка не заходила в воду)
  let Mp = bEnd.clone().lerp(campFront, 0.55);
  for (let k = 0.3; k <= 0.9; k += 0.05) {
    const q = bEnd.clone().lerp(campFront, k);
    if (Math.abs(q.z - riverZ(q.x)) - riverHalfWidth(q.x) > 26) { Mp = q; break; }
  }
  const toCamp = campFront.clone().sub(Mp).setY(0).normalize();
  const toCamp0 = toCamp;
  const side = new V3(-toCamp.z, 0, toCamp.x);
  // ---------- путь конницы: двор → ворота → барбакан → дорога до моста → поле ----------
  const G = GATE_PASSAGE, ty = G.thresholdY + 0.05;
  let holdIdx = 0; // точка за мостом: здесь пешие держат переправу
  const basePath = [
    new V3(0, 0, G.rampEndZ - 7), new V3(0, 0, G.rampEndZ), new V3(0, ty, G.backZ), new V3(0, ty, G.frontZ),
    new V3(0, ty, BARBICAN.zN), new V3(0, 0, BARBICAN.zS + 0.5),
  ];
  // по дороге ~170 м (самый крутой спуск), дальше напрямик через луг к мосту
  {
    let acc = 0, i = 2;
    const lim = bi > 0 ? bi - 2 : Math.floor(road.length / 2);
    for (; i <= lim && acc < 170; i += 3) {
      const q = road[i], pr = basePath[basePath.length - 1];
      acc += Math.hypot(q.x - pr.x, q.z - pr.z);
      basePath.push(new V3(q.x, q.h + 0.05, q.z));
    }
    const a = basePath[basePath.length - 1].clone();
    const bs = bi > 0 ? road[Math.max(0, bi - 8)] : road[lim];
    const b = new V3(bs.x, 0, bs.z);
    const n = Math.max(2, Math.round(a.distanceTo(b) / 8));
    for (let k = 1; k <= n; k++) { const p = a.clone().lerp(b, k / n); p.y = 0; basePath.push(p); }
    if (bi > 0) for (let j = bi - 7; j <= bi + 3; j++) basePath.push(new V3(road[j].x, road[j].h + 0.05, road[j].z));
    // от моста — галопом прямо к месту сшибки
    holdIdx = basePath.length - 1;
    {
      const a2 = basePath[basePath.length - 1].clone().setY(0);
      const b2 = Mp.clone().addScaledVector(toCamp0, -14);
      const n2 = Math.max(1, Math.round(a2.distanceTo(b2) / 8));
      for (let k = 1; k <= n2; k++) { const p = a2.clone().lerp(b2, k / n2); p.y = 0; basePath.push(p); }
    }
  }
  basePath.forEach((p) => { if (!p.y) p.y = gh(p.x, p.z); });
  const mkPath = (off) => {
    // смещение поперёк пути (колонна по двое-трое); в воротах — уже
    const out = [];
    for (let i = 0; i < basePath.length; i++) {
      const a = basePath[Math.max(0, i - 1)], b = basePath[Math.min(basePath.length - 1, i + 1)];
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      const k = i < 6 ? 0.5 : 1;
      out.push(new V3(basePath[i].x - dz / l * off * k, basePath[i].y, basePath[i].z + dx / l * off * k));
    }
    const len = [0];
    for (let i = 1; i < out.length; i++) len.push(len[i - 1] + out[i].distanceTo(out[i - 1]));
    return { pts: out, len, total: len[len.length - 1] };
  };
  const along = (P, s, o) => {
    s = Math.max(0, Math.min(P.total, s));
    let i = 1;
    while (i < P.len.length - 1 && P.len[i] < s) i++;
    const u = (s - P.len[i - 1]) / Math.max(1e-6, P.len[i] - P.len[i - 1]);
    o.copy(P.pts[i - 1]).lerp(P.pts[i], u);
    return P.pts[i].clone().sub(P.pts[i - 1]);
  };

  // ---------- толпы ----------
  const riderCols = [[0xe8e0d0, 0x1d3f8a], [0x2a1e16, 0x7a1c1c], [0x6a4424, 0xd6a632], [0x8a8a8a, 0x1d3f8a]];
  const riders = riderCols.map(([hc, cap], k) => new Crowd(scene, (B) => riderBuild(B, { horseCol: hc, role: k % 2 ? 'champR' : 'champB', seed: 1800 + k, item: k < 2 ? 'lance' : 'sword', caparison: cap, rnd: mulberry32(1800 + k) }), 5, 0));
  const footK = [0, 1].map((k) => new Crowd(scene, (B) => person(B, { x: 0, y: 0, z: 0, yaw: 0, role: k ? 'guard' : 'knight', seed: 1850 + k, item: k ? 'spear' : 'sword' }), 5, 1));
  const foes = [0, 1, 2].map((k) => new Crowd(scene, (B) => person(B, { x: 0, y: 0, z: 0, yaw: 0, role: 'foe', seed: 1900 + k, item: k === 2 ? 'sword' : 'spear' }), 12, 1));
  // жители двора: по тревоге бегут прятаться в донжон
  const civ = [0, 1, 2].map((k) => new Crowd(scene, (B) => person(B, { x: 0, y: 0, z: 0, yaw: 0, role: ['townswoman', 'peasant', 'merchant'][k], seed: 1950 + k, pose: 'stand' }), 5, 1));
  const civU = [];
  civ.forEach((c) => { for (let i = 0; i < c.n; i++) {
    let x = 0, z = 0;
    for (let k = 0; k < 60; k++) { const a = rnd() * Math.PI * 2, r = 10 + rnd() * 24; x = Math.cos(a) * r; z = Math.sin(a) * r; if (!insideBuilding(x, z, 1.5) && !insideTower(x, z, 2) && Math.hypot(x - KEEP.x, z - KEEP.z) > 14) break; }
    civU.push({ c, i, p0: new V3(x, 0, z), p: new V3(), yaw: 0, ph: rnd() * 6, amp: 0, seed: rnd(), done: false });
  } });
  const units = [];
  const addUnits = (crowds, team, kind) => crowds.forEach((c) => { for (let i = 0; i < c.n; i++) units.push({ c, i, team, kind, p: new V3(), yaw: 0, ph: rnd() * 6, amp: 0, alive: true, lie: 0, s: 0, state: 'home', path: null, lag: 0, tgt: new V3(), seed: rnd() }); });
  addUnits(riders, 'K', 'rider');
  addUnits(footK, 'K', 'foot');
  addUnits(foes, 'F', 'foot');
  const K = units.filter((u) => u.team === 'K'), F = units.filter((u) => u.team === 'F');
  // места в строю
  K.forEach((u, n) => {
    const col = u.kind === 'rider' ? (n % 3) - 1 : (n % 2) - 0.5;
    u.path = mkPath(col * 2.2);
    u.lag = u.kind === 'rider' ? Math.floor(n / 3) * 1.1 : 6 + Math.floor((n - 20) / 2) * 1.2;
    u.speed = u.kind === 'rider' ? 17 : 6.5;
    u.holdS = u.kind === 'foot' ? Math.max(20, u.path.len[holdIdx] - 4 - Math.floor((n - 20) / 2) * 1.6) : 1e9;
    const row = u.kind === 'rider' ? Math.floor(n / 5) : 4 + Math.floor((n - 20) / 5);
    u.slot = Mp.clone().addScaledVector(toCamp, -6 - row * 3).addScaledVector(side, ((n % 5) - 2) * 3.2);
  });
  F.forEach((u, n) => {
    const row = Math.floor(n / 9), c = (n % 9) - 4;
    u.home = T.pivot.clone().addScaledVector(T.A, 10 - row * 1.6).addScaledVector(T.R, c * 1.8 + (row % 2) * 0.9);
    u.slot = Mp.clone().addScaledVector(toCamp, 6 + row * 2).addScaledVector(side, c * 2.2);
    u.speed = 2.9 + rnd() * 0.4;
  });
  // лестницы для приступа (появляются, если победили осаждающие)
  const ladderGeo = new THREE.BufferGeometry();
  {
    const g = [];
    for (const sx of [-0.28, 0.28]) g.push(new THREE.BoxGeometry(0.07, 7.5, 0.07).translate(sx, 3.75, 0));
    for (let k = 0; k < 16; k++) g.push(new THREE.BoxGeometry(0.56, 0.05, 0.05).translate(0, 0.3 + k * 0.45, 0));
    const pos = [], nrm = [];
    for (const b of g) { const nb = b.toNonIndexed(); pos.push(...nb.getAttribute('position').array); nrm.push(...nb.getAttribute('normal').array); }
    ladderGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    ladderGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  }
  const ladders = new THREE.InstancedMesh(ladderGeo, new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.9 }), 4);
  ladders.visible = false; ladders.name = 'walker'; ladders.frustumCulled = false;
  scene.add(ladders);
  const ladderPts = [-6.5, -3, 3, 6.5].map((x) => new V3(x, 0, BARBICAN.zS + 0.95));
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new V3(1, 0, 0), -0.28);
    ladderPts.forEach((p, i) => { m.compose(new V3(p.x, gh(p.x, p.z + 1.2), p.z + 1.9), q, new V3(1, 1, 1)); ladders.setMatrixAt(i, m); });
  }

  // ---------- состояние боя ----------
  let force = null; // для проверки: castle.extras.battle.force = false
  let clock = 0, phase = 'idle', win = true, tick = 0, endT = 0, wonT = 0;
  const reset = () => {
    for (const u of units) { u.alive = true; u.lie = 0; u.state = 'home'; u.s = 0; u.climb = undefined; }
    clock = 0; phase = 'idle'; ladders.visible = false; wonT = 0;
    for (const u of K) { u.speed = u.kind === 'rider' ? 17 : 6.5; u.foe = null; }
    for (const u of F) u.foe = null;
    siege.assault = false;
  };
  reset();
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), qLie = new THREE.Quaternion(), one = new V3(1, 1, 1), tmp = new V3();
  const face = (u, dx, dz, dt, rate = 6) => {
    const t = Math.atan2(dx, dz);
    let d = t - u.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    u.yaw += d * Math.min(1, dt * rate);
  };
  const stepTo = (u, tx, tz, sp, dt, stride) => {
    const dx = tx - u.p.x, dz = tz - u.p.z, d = Math.hypot(dx, dz);
    if (d < 0.05) { u.amp = Math.max(0, u.amp - dt * 2); return true; }
    const st = Math.min(d, sp * dt);
    u.p.x += dx / d * st; u.p.z += dz / d * st;
    u.p.y = gh(u.p.x, u.p.z);
    face(u, dx, dz, dt);
    u.ph += st / stride * Math.PI * 2;
    u.amp = u.kind === 'rider' ? 0.7 : 0.55;
    return d < 0.6;
  };
  const alive = (arr) => arr.filter((u) => u.alive);
  const center = (arr) => { const c = new V3(); arr.forEach((u) => c.add(u.p)); return arr.length ? c.multiplyScalar(1 / arr.length) : c; };

  function update(dt, t) {
    const on = siege.active;
    if (!on && phase === 'idle') return;
    if (!on) { // штурм выключили — все вернулись по местам
      endT += dt;
      if (endT > 0.5) { reset(); for (const c of [...riders, ...footK, ...foes, ...civ]) c.mesh.visible = false; }
      return;
    }
    endT = 0;
    if (phase === 'idle') { phase = 'march'; win = force !== null ? force : Math.random() < 0.9; clock = 0; tick = 0; for (const c of [...riders, ...footK, ...foes, ...civ]) c.mesh.visible = true; for (const u of civU) u.done = false; }
    clock += dt;
    // жители бегут к донжону и скрываются внутри
    for (const u of civU) {
      if (u.done) continue;
      if (clock < 0.3) { u.p.copy(u.p0); u.p.y = gh(u.p.x, u.p.z); }
      if (clock > 0.6 + u.seed * 1.5) {
        const dx = KEEP.x - u.p.x, dz = KEEP.z - u.p.z, d = Math.hypot(dx, dz);
        if (d < KEEP.r + 1.5) { u.done = true; continue; }
        const st = 3.6 * dt;
        u.p.x += dx / d * st; u.p.z += dz / d * st; u.p.y = gh(u.p.x, u.p.z);
        u.yaw = Math.atan2(dx, dz); u.ph += st / 1.4 * Math.PI * 2; u.amp = 0.6;
      }
    }
    for (const u of civU) {
      q4.setFromAxisAngle(UP, u.yaw);
      m4.compose(u.p, q4, u.done ? new V3(0, 0, 0) : one);
      u.c.mesh.setMatrixAt(u.i, m4); u.c.phase[u.i] = u.ph; u.c.amp[u.i] = u.amp;
    }
    for (const c of civ) { c.mesh.instanceMatrix.needsUpdate = true; c.mesh.geometry.getAttribute('iPhase').needsUpdate = true; c.mesh.geometry.getAttribute('iAmp').needsUpdate = true; }
    const Ka = alive(K), Fa = alive(F);
    // --- осаждающие ---
    for (const u of F) {
      if (!u.alive) continue;
      if (u.state === 'home') { u.p.copy(u.home); u.p.y = gh(u.p.x, u.p.z); u.yaw = Math.atan2(T.A.x, T.A.z); if (clock > 2 + u.seed * 2) u.state = 'march'; continue; }
      if (u.state === 'march') { if (stepTo(u, u.slot.x, u.slot.z, u.speed, dt, 1.5)) u.state = 'wait'; continue; }
      if (u.state === 'wait') { face(u, -toCamp.x, -toCamp.z, dt); u.amp = Math.max(0, u.amp - dt * 2); continue; }
      if (u.state === 'flee') { stepTo(u, u.home.x, u.home.z, 4.5, dt, 1.7); continue; }
      if (u.state === 'assault0') { // бегом к дороге, дальше — по дороге к замку
        if (!u.apath) u.apath = mkPath((u.seed - 0.5) * 5);
        const e = u.apath.pts[u.apath.pts.length - 1];
        if (stepTo(u, e.x, e.z, 5.5, dt, 1.6)) { u.state = 'assault1'; u.s = u.apath.total; }
        continue;
      }
      if (u.state === 'assault1') {
        u.s -= 7 * dt;
        const d = along(u.apath, u.s, u.p);
        face(u, -d.x, -d.z, dt, 8);
        u.ph += 7 * dt / 1.7 * Math.PI * 2; u.amp = 0.7;
        if (u.s <= u.apath.len[6]) u.state = 'assault';
        continue;
      }
      if (u.state === 'assault') {
        const L = ladderPts[u.i % 4];
        if (u.climb === undefined) { if (stepTo(u, L.x + (u.seed - 0.5) * 3, L.z + 2.5 + u.seed * 5, 3.2, dt, 1.5) && u.seed < 0.5) u.climb = 0; }
        else { u.climb = Math.min(6.8, u.climb + dt * 0.9); u.p.set(L.x, gh(L.x, L.z + 1.2) + u.climb, L.z + 1.9 - u.climb * 0.28); u.yaw = Math.PI; u.ph += dt * 5; u.amp = 0.5; if (u.climb >= 6.8) { u.climb = undefined; u.state = 'inside'; } }
        continue;
      }
    }
    // --- рыцари ---
    for (const u of K) {
      if (!u.alive) continue;
      if (u.state === 'home') { u.s = 0; along(u.path, 0, u.p); u.yaw = 0; if (clock > u.lag) u.state = 'ride'; continue; }
      if (u.state === 'ride') {
        u.s += u.speed * dt;
        const d = along(u.path, u.s, u.p);
        face(u, d.x, d.z, dt, 8);
        u.ph += u.speed * dt / (u.kind === 'rider' ? 2.6 : 1.5) * Math.PI * 2;
        u.amp = u.kind === 'rider' ? 0.75 : 0.6;
        if (u.s >= u.path.total) u.state = 'field';
        if (u.s >= u.holdS) { u.s = u.holdS; u.state = 'hold'; }
        continue;
      }
      if (u.state === 'field' && phase === 'fight' && u.p.distanceTo(Mp) < 45) { u.state = 'fight'; continue; }
      if (u.state === 'field') { if (stepTo(u, u.slot.x, u.slot.z, u.kind === 'rider' ? 9 : 4, dt, u.kind === 'rider' ? 2.6 : 1.5)) u.state = 'ready'; continue; }
      if (u.state === 'ready') { face(u, toCamp.x, toCamp.z, dt); u.amp = Math.max(0, u.amp - dt * 2); continue; }
      if (u.state === 'home2') { const e = u.path.pts[u.path.pts.length - 1]; const fast = phase === 'lost'; if (stepTo(u, e.x, e.z, u.kind === 'rider' ? (fast ? 9 : 5) : (fast ? 4 : 2.5), dt, u.kind === 'rider' ? 2.6 : 1.5)) { u.state = 'back'; u.s = u.path.total; u.speed = u.kind === 'rider' ? (fast ? 9 : 6) : (fast ? 4 : 3); } continue; }
      if (u.state === 'hold') { // пешие стоят стеной у моста, щиты к врагу
        face(u, toCamp.x, toCamp.z, dt, 3); u.amp = Math.max(0, u.amp - dt * 2);
        if (phase === 'lost' || (phase === 'won' && wonT > 12 + u.seed * 3)) { u.state = 'back'; u.speed = phase === 'lost' ? 5 : 3; }
        continue;
      }
      if (u.state === 'back') { u.s -= u.speed * 0.8 * dt; const d = along(u.path, u.s, u.p); face(u, -d.x, -d.z, dt, 8); u.ph += u.speed * dt / 2.4 * Math.PI * 2; if (u.s <= 0) { u.state = 'gone'; } continue; }
    }
    // --- ход боя ---
    const kReady = Ka.filter((u) => u.state === 'ready' || u.state === 'fight').length;
    const fReady = Fa.filter((u) => u.state === 'wait' || u.state === 'fight').length;
    // бой начинается, как только конница вышла на поле (пешие подтягиваются по ходу)
    const kNear = Ka.filter((u) => (u.state === 'ready' || u.state === 'field') && u.p.distanceTo(Mp) < 40).length;
    if (phase === 'march' && ((kNear >= Math.min(10, Ka.length) && fReady >= Math.min(18, Fa.length)) || clock > 75)) {
      phase = 'fight'; tick = 0;
      for (const u of Ka) if (u.state === 'ready' || (u.state === 'field' && u.p.distanceTo(Mp) < 45)) u.state = 'fight';
      for (const u of Fa) if (u.state === 'wait' || u.state === 'march') u.state = 'fight';
    }
    if (phase === 'fight') {
      const kF = Ka.filter((u) => u.state === 'fight'), fF = Fa.filter((u) => u.state === 'fight');
      // каждый выбирает ближайшего противника и сходится с ним в поединке
      for (const u of [...kF, ...fF]) {
        const opp = u.team === 'K' ? fF : kF;
        if (!u.foe || !u.foe.alive || u.foe.state !== 'fight' || (u.retarget = (u.retarget || 0) - dt) < 0) {
          u.retarget = 1.5 + u.seed;
          let best = null, bd = 1e9;
          for (const v of opp) { const d = (v.p.x - u.p.x) ** 2 + (v.p.z - u.p.z) ** 2 + (v.foe === u ? -20 : 0); if (d < bd) { bd = d; best = v; } }
          u.foe = best;
        }
        const e = u.foe;
        if (!e) { face(u, (u.team === 'K' ? 1 : -1) * toCamp.x, (u.team === 'K' ? 1 : -1) * toCamp.z, dt); u.amp = Math.max(0, u.amp - dt); continue; }
        const dx = e.p.x - u.p.x, dz = e.p.z - u.p.z, d = Math.hypot(dx, dz) || 1;
        const reach = (u.kind === 'rider' ? 2.4 : 1.3) + (e.kind === 'rider' ? 0.9 : 0);
        if (d > reach + 0.4) {
          // всадник кружит вокруг пешего, пеший идёт прямо
          const sw = u.kind === 'rider' ? 0.35 * (u.seed < 0.5 ? 1 : -1) : 0;
          const tx = e.p.x - (dx / d) * reach - (dz / d) * sw * d, tz = e.p.z - (dz / d) * reach + (dx / d) * sw * d;
          stepTo(u, tx, tz, u.kind === 'rider' ? (d > 12 ? 9 : 5) : (d > 8 ? 4.2 : 2.6), dt, u.kind === 'rider' ? 2.6 : 1.5);
        } else {
          face(u, dx, dz, dt, 6);
          // рубка: быстрые взмахи с паузами, лёгкий подскок коня
          const sw = Math.sin(t * 3.1 + u.seed * 9);
          u.ph += dt * (sw > 0 ? 9 : 2); u.amp = sw > 0 ? 0.85 : 0.35;
          if (u.kind === 'rider') { u.p.x += Math.sin(t * 1.3 + u.seed * 7) * dt * 0.8; u.p.z += Math.cos(t * 1.1 + u.seed * 5) * dt * 0.8; u.p.y = gh(u.p.x, u.p.z); }
        }
      }
      tick += dt;
      if (tick > 0.55) {
        tick = 0;
        const kDies = Math.random() < (win ? 0.2 : 0.72);
        // гибнут только те, кто уже в схватке рядом с противником
        const pool = (kDies ? kF : fF).filter((v) => v.foe && v.foe.p.distanceTo(v.p) < 5);
        if (pool.length) { const v = pool[Math.floor(Math.random() * pool.length)]; v.alive = false; v.lie = 0.001; v.fallYaw = v.yaw; }
      }
      const kLeft = K.filter((u) => u.alive && u.kind === 'rider').length / K.filter((u) => u.kind === 'rider').length, fLeft = alive(F).length / F.length;
      if (win && fLeft < 0.3) { phase = 'won'; for (const u of alive(F)) u.state = 'flee'; for (const u of alive(K)) { if (u.state === 'ride') { u.state = 'back'; u.speed = u.kind === 'rider' ? 6 : 3; } else if (u.state !== 'back' && u.state !== 'hold') u.state = 'ready'; } }
      if (!win && kLeft < 0.35) {
        phase = 'lost'; ladders.visible = true; siege.assault = true;
        for (const u of alive(K)) { if (u.state === 'ride') u.state = 'back'; else if (u.state !== 'back' && u.state !== 'hold') u.state = 'home2'; u.speed = u.kind === 'rider' ? 9 : 4; }
        for (const u of alive(F)) u.state = 'assault0';
      }
    }
    if (phase === 'won') {
      wonT += dt;
      // победа: постояли на поле и шагом вернулись в замок
      for (const u of alive(K)) {
        if (u.state === 'ready') { face(u, toCamp.x, toCamp.z, dt); u.amp = Math.max(0, u.amp - dt); if (wonT > 10 + u.seed * 4) { u.state = 'home2'; } }
      }
    }
    // --- запись в инстансы ---
    const zero = new V3(0, 0, 0);
    for (const u of units) {
      const hidden = u.state === 'gone' || u.state === 'inside';
      if (!u.alive) u.lie = Math.min(1, u.lie + dt * 2.2);
      q4.setFromAxisAngle(UP, u.alive ? u.yaw : u.fallYaw);
      let pos = u.p;
      if (!u.alive) {
        // пеший падает навзничь или ничком; конь с всадником валится на бок
        const ax = u.kind === 'rider' ? new V3(Math.sin(u.fallYaw), 0, Math.cos(u.fallYaw)) : new V3(Math.cos(u.fallYaw), 0, -Math.sin(u.fallYaw));
        qLie.setFromAxisAngle(ax, u.lie * (u.kind === 'rider' ? 1.3 : 1.5) * (u.seed < 0.5 ? 1 : -1));
        q4.premultiply(qLie);
        pos = tmp.copy(u.p); pos.y = gh(u.p.x, u.p.z) + (u.kind === 'rider' ? 0.35 : 0.12) * u.lie;
      }
      m4.compose(pos, q4, hidden ? zero : one);
      u.c.mesh.setMatrixAt(u.i, m4);
      u.c.phase[u.i] = u.ph;
      u.c.amp[u.i] = u.alive ? u.amp : 0;
    }
    for (const c of [...riders, ...footK, ...foes]) {
      c.mesh.instanceMatrix.needsUpdate = true;
      c.mesh.geometry.getAttribute('iPhase').needsUpdate = true;
      c.mesh.geometry.getAttribute('iAmp').needsUpdate = true;
    }
  }
  return {
    update,
    get alarm() { return phase !== 'idle'; },
    get dbg() { return { clock: +clock.toFixed(1), total: +K[0].path.total.toFixed(0), dK: K.slice(0, 20).map((u) => +u.p.distanceTo(Mp).toFixed(0)), mpToCamp: +Mp.distanceTo(campFront).toFixed(0), kAlive: alive(K).length, fAlive: alive(F).length }; },
    get phase() { return phase + ' K:' + K.map((u) => u.state[0]).join('') + ' F:' + F.map((u) => u.state[0]).join('') + ' ' + (K[0].path ? K[0].path.total.toFixed(0) : ''); },
    get win() { return win; },
    set force(v) { force = v; },
    field: Mp,
  };
}
