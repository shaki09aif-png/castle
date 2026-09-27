// Управление камерой: орбитальный режим (вращение вокруг точки) и свободный
// полёт (PointerLockControls). F — переключение, в полёте клик захватывает мышь,
// Esc отпускает. WASD — движение, мышь — обзор, Space — вверх, C или Ctrl — вниз,
// Shift — ускорение, колёсико — скорость полёта. H — скрыть подсказку.
// Камера никогда не опускается под землю.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { HILL_TOP } from './layout.js';

const MIN_SPEED = 1, MAX_SPEED = 250;
// версия для телефона: ?phone в адресе (или страница phone.html)
export const PHONE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('phone');

export function createCameraControls(camera, dom, terrain) {
  // ---------- орбитальный режим ----------
  const orbit = new OrbitControls(camera, dom);
  orbit.target.set(0, HILL_TOP - 6, 20);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.minDistance = 1.5;
  orbit.maxDistance = 1300;
  orbit.maxPolarAngle = Math.PI * 0.495;
  orbit.zoomSpeed = 1.2;
  orbit.update();

  // ---------- свободный полёт ----------
  const fly = new PointerLockControls(camera, dom);
  fly.pointerSpeed = 0.8;
  let mode = 'orbit';
  let speed = 12; // м/с, меняется колёсиком
  const keys = new Set();
  const vel = new THREE.Vector3();
  // сенсорное управление полётом (телефон): джойстик, подъём/спуск, взгляд пальцем
  const touch = { x: 0, y: 0, lift: 0, hold: 0 };
  const eul = new THREE.Euler(0, 0, 0, 'YXZ');
  function look(dx, dy) {
    eul.setFromQuaternion(camera.quaternion);
    eul.y -= dx * 0.0042;
    eul.x = Math.max(-1.5, Math.min(1.5, eul.x - dy * 0.0042));
    camera.quaternion.setFromEuler(eul);
  }

  // ---------- подсказка ----------
  const help = document.getElementById('help');
  const modeEl = document.getElementById('mode');
  const speedEl = document.getElementById('speed');
  const clickEl = document.getElementById('click-to-fly');
  let helpHidden = false;
  try { helpHidden = localStorage.getItem('castle-ui-hidden') === '1'; } catch (e) { /* нет хранилища */ }
  function refreshUI() {
    document.body.classList.toggle('ui-hidden', helpHidden); // H или кнопка-глаз прячет весь интерфейс
    if (modeEl) modeEl.textContent = mode === 'fly' ? 'Режим: свободный полёт' : mode === 'walk' ? 'Режим: пешком (от первого лица)' : 'Режим: орбита';
    if (help) help.dataset.mode = mode;
    if (speedEl) speedEl.textContent = mode === 'fly' ? `Скорость: ${speed < 10 ? speed.toFixed(1) : Math.round(speed)} м/с` : '';
    // флаг isLocked у PointerLockControls меняется уже после события 'lock',
    // поэтому проверяем состояние браузера напрямую
    const locked = document.pointerLockElement === dom;
    if (clickEl) clickEl.style.display = mode !== 'orbit' && !locked && !PHONE ? 'block' : 'none';
    document.body.classList.toggle('fly-mode', mode !== 'orbit');
    document.body.classList.toggle('walk-mode', mode === 'walk');
  }

  function setMode(m) {
    if (m === mode) return;
    const from = mode;
    mode = m;
    if (mode === 'walk') {
      orbit.enabled = false;
      vel.set(0, 0, 0);
      startWalk(from);
      if (!PHONE) fly.lock();
    } else if (mode === 'fly') {
      orbit.enabled = false;
      vel.set(0, 0, 0);
      if (!PHONE) fly.lock();
    } else {
      if (fly.isLocked) fly.unlock();
      // точка вращения — впереди по направлению взгляда
      const dir = camera.getWorldDirection(new THREE.Vector3());
      const dist = Math.max(8, Math.min(120, camera.position.y - terrain.heightAt(camera.position.x, camera.position.z) + 20));
      orbit.target.copy(camera.position).addScaledVector(dir, dist);
      orbit.enabled = true;
      orbit.update();
    }
    refreshUI();
  }

  document.addEventListener('pointerlockchange', refreshUI);
  // клик по сцене в режиме полёта снова захватывает мышь
  dom.addEventListener('click', () => { if (!PHONE && mode !== 'orbit' && document.pointerLockElement !== dom) fly.lock(); });
  if (clickEl) clickEl.addEventListener('click', () => fly.lock());

  // Ctrl + W и подобные сочетания браузер не даёт перехватить; для спуска
  // безопаснее C, но Ctrl тоже работает.
  const code = (e) => e.code;
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const c = code(e);
    if (c === 'KeyF' && !e.repeat) { setMode(mode === 'fly' ? 'orbit' : 'fly'); return; }
    if (c === 'KeyV' && !e.repeat) { setMode(mode === 'walk' ? 'orbit' : 'walk'); return; }
    if (c === 'Space' && mode === 'walk' && !e.repeat) jump = true;
    if (c === 'KeyH' && !e.repeat) {
      helpHidden = !helpHidden;
      try { localStorage.setItem('castle-ui-hidden', helpHidden ? '1' : '0'); } catch (err) { /* ignore */ }
      refreshUI();
      return;
    }
    keys.add(c);
    if (mode !== 'orbit' && ['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ControlLeft', 'ControlRight'].includes(c)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(code(e)));
  window.addEventListener('blur', () => keys.clear());
  dom.addEventListener('wheel', (e) => {
    if (mode !== 'fly') return;
    e.preventDefault();
    speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed * (e.deltaY > 0 ? 0.85 : 1.18)));
    refreshUI();
  }, { passive: false });

  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), want = new THREE.Vector3();
  // ---------- пешком (от первого лица) ----------
  // Модели игрока нет: камера на высоте глаз, идёт по земле, полам домов и ходам;
  // здания, башни и стены не пускают (проходы — через двери и ворота).
  const EYE = 1.65;
  const feet = new THREE.Vector3(), expect = new THREE.Vector3();
  let vy = 0, grounded = true, bob = 0, jump = false, crouch = 0;
  const W = () => api.walkable;
  const floorAt = (x, z, y) => (W() ? W().floorAt(x, z, y) : terrain.heightAt(x, z));
  function startWalk(from) {
    let x = camera.position.x, z = camera.position.z;
    if (from === 'orbit') { x = orbit.target.x; z = orbit.target.z; }
    // если под точкой здание или стена — ищем свободное место рядом
    if (W() && W().solid(x, z)) {
      search: for (let r = 1; r < 40; r += 1) {
        for (let a = 0; a < Math.PI * 2; a += 0.4) {
          const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
          if (!W().solid(px, pz)) { x = px; z = pz; break search; }
        }
      }
    }
    feet.set(x, floorAt(x, z), z);
    vy = 0; grounded = true;
    // взгляд — горизонтально, в прежнем направлении
    const d = camera.getWorldDirection(new THREE.Vector3());
    eul.set(0, Math.atan2(-d.x, -d.z), 0, 'YXZ');
    camera.quaternion.setFromEuler(eul);
    camera.position.set(feet.x, feet.y + EYE, feet.z);
    expect.copy(camera.position);
  }
  function updateWalk(dt) {
    // камеру передвинули снаружи (вход в дом, экскурсия) — ноги встают под неё
    if (camera.position.distanceTo(expect) > 0.3) {
      feet.set(camera.position.x, floorAt(camera.position.x, camera.position.z, camera.position.y - 1.0), camera.position.z);
      vy = 0;
    }
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    right.set(-fwd.z, 0, fwd.x);
    want.set(0, 0, 0);
    if (keys.has('KeyW') || keys.has('ArrowUp')) want.add(fwd);
    if (keys.has('KeyS') || keys.has('ArrowDown')) want.sub(fwd);
    if (keys.has('KeyD') || keys.has('ArrowRight')) want.add(right);
    if (keys.has('KeyA') || keys.has('ArrowLeft')) want.sub(right);
    const tm = Math.hypot(touch.x, touch.y);
    if (tm > 0.05) want.addScaledVector(fwd, touch.y).addScaledVector(right, touch.x);
    if (want.lengthSq() > 1) want.normalize();
    const run = keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.hold > 1;
    touch.hold = tm > 0.92 ? touch.hold + dt : 0;
    const sp = run ? 5.2 : 1.8;
    want.multiplyScalar(sp);
    vel.lerp(want.setY(0), 1 - Math.exp(-dt * (grounded ? 10 : 2)));
    // шаг по осям отдельно — чтобы скользить вдоль стен, а не застревать
    const nx = feet.x + vel.x * dt, nz = feet.z + vel.z * dt;
    const ok = (x0, z0, x1, z1) => {
      if (W() && !W().canMove(x0, z0, x1, z1, feet.y)) return false;
      // слишком крутой подъём (обрыв, стена рва) — не пройти
      const g0 = floorAt(x0, z0, feet.y), g1 = floorAt(x1, z1, feet.y);
      // и не шагнуть с края стены или лестницы (там перила / было бы падение)
      if (grounded && g1 < Math.min(g0, feet.y) - 1.0) return false;
      const stepMax = W() && W().nearOpenDoor(x1, z1) ? 1.3 : 0.65;
      return g1 - Math.max(g0, feet.y) < stepMax + Math.hypot(x1 - x0, z1 - z0) * 1.2;
    };
    if (ok(feet.x, feet.z, nx, feet.z)) feet.x = nx; else vel.x = 0;
    if (ok(feet.x, feet.z, feet.x, nz)) feet.z = nz; else vel.z = 0;
    // сила тяжести и прыжок
    const g = floorAt(feet.x, feet.z, feet.y);
    if ((jump || touch.lift > 0) && grounded) { vy = 4.2; grounded = false; }
    jump = false;
    vy -= 9.8 * dt;
    feet.y += vy * dt;
    if (feet.y <= g) {
      // на ступеньку/склон — мягко, вниз — падаем
      feet.y = g; vy = 0; grounded = true;
    } else if (feet.y - g < 0.25 && vy <= 0) { feet.y = g; vy = 0; grounded = true; } else grounded = false;
    // присесть (C/Ctrl) — ниже глаза, медленнее
    const wantCrouch = keys.has('KeyC') || keys.has('ControlLeft') || keys.has('ControlRight') || touch.lift < 0 ? 1 : 0;
    crouch += (wantCrouch - crouch) * Math.min(1, dt * 8);
    // покачивание при ходьбе
    const hs = Math.hypot(vel.x, vel.z);
    if (grounded) bob += hs * dt * 1.9;
    const bobY = grounded ? Math.sin(bob * 2) * 0.03 * Math.min(1, hs / 1.8) : 0;
    const bobX = grounded ? Math.cos(bob) * 0.02 * Math.min(1, hs / 1.8) : 0;
    camera.position.set(feet.x + right.x * bobX, feet.y + EYE - crouch * 0.6 + bobY, feet.z + right.z * bobX);
    // в подземных ходах — своя граница (стены, потолок)
    for (const zz of api.zones) zz(camera);
    expect.copy(camera.position);
  }


  function keepAboveGround() {
    // в подземельях (темница, колодец, потайной ход) камеру держит своя граница
    if (api.limit) { api.limit(camera, orbit.target); return; }
    // подземные ходы, куда можно зайти самому: там своя граница вместо земли
    for (const z of api.zones) if (z(camera)) return;
    const g = terrain.heightAt(camera.position.x, camera.position.z) + 1.2;
    if (camera.position.y < g) camera.position.y = g;
    // не улетать за пределы мира
    const r = Math.hypot(camera.position.x, camera.position.z);
    if (r > 2500) { camera.position.x *= 2500 / r; camera.position.z *= 2500 / r; }
    if (camera.position.y > 1500) camera.position.y = 1500;
  }

  function update(dt) {
    dt = Math.min(dt, 0.1);
    if (mode === 'orbit') {
      orbit.update();
      const t = orbit.target;
      const r = Math.hypot(t.x, t.z);
      if (r > 700) { t.x *= 700 / r; t.z *= 700 / r; }
      const tg = terrain.heightAt(t.x, t.z) + 0.3;
      if (t.y < tg && !api.limit && !api.zones.some((z) => z({ position: t.clone() }))) t.y = tg;
      keepAboveGround();
      return;
    }
    if (mode === 'walk') { updateWalk(dt); return; }
    // полёт: направление взгляда целиком (W ведёт туда, куда смотришь)
    camera.getWorldDirection(fwd);
    right.crossVectors(fwd, camera.up).normalize();
    want.set(0, 0, 0);
    if (keys.has('KeyW') || keys.has('ArrowUp')) want.add(fwd);
    if (keys.has('KeyS') || keys.has('ArrowDown')) want.sub(fwd);
    if (keys.has('KeyD') || keys.has('ArrowRight')) want.add(right);
    if (keys.has('KeyA') || keys.has('ArrowLeft')) want.sub(right);
    if (keys.has('Space')) want.y += 1; // E теперь открывает двери
    if (keys.has('KeyC') || keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyQ')) want.y -= 1;
    if (want.lengthSq() > 0) want.normalize();
    let boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4 : 1;
    // джойстик: сила — насколько отклонён; если долго держать до упора, полёт ускоряется
    const tm = Math.hypot(touch.x, touch.y);
    if (tm > 0.05 || touch.lift) {
      want.addScaledVector(fwd, touch.y).addScaledVector(right, touch.x);
      want.y += touch.lift;
      if (want.length() > 1) want.normalize();
      touch.hold = tm > 0.92 ? touch.hold + dt : 0;
      boost = 1 + Math.min(3, Math.max(0, touch.hold - 1) * 1.5);
    } else touch.hold = 0;
    want.multiplyScalar(speed * boost);
    // плавный разгон и торможение
    vel.lerp(want, 1 - Math.exp(-dt * 8));
    camera.position.addScaledVector(vel, dt);
    keepAboveGround();
  }

  const uiBtn = document.getElementById('ui-toggle');
  if (uiBtn) uiBtn.addEventListener('click', () => {
    helpHidden = !helpHidden;
    try { localStorage.setItem('castle-ui-hidden', helpHidden ? '1' : '0'); } catch (err) { /* ignore */ }
    refreshUI();
  });
  refreshUI();
  const api = {
    orbit, fly, update, touch, look,
    get mode() { return mode; },
    setMode,
    limit: null,
    zones: [],
    walkable: null,
  };
  return api;
}
