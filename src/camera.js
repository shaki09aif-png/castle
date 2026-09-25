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

  // ---------- подсказка ----------
  const help = document.getElementById('help');
  const modeEl = document.getElementById('mode');
  const speedEl = document.getElementById('speed');
  const clickEl = document.getElementById('click-to-fly');
  let helpHidden = false;
  try { helpHidden = localStorage.getItem('castle-ui-hidden') === '1'; } catch (e) { /* нет хранилища */ }
  function refreshUI() {
    document.body.classList.toggle('ui-hidden', helpHidden); // H или кнопка-глаз прячет весь интерфейс
    if (modeEl) modeEl.textContent = mode === 'fly' ? 'Режим: свободный полёт' : 'Режим: орбита';
    if (help) help.dataset.mode = mode;
    if (speedEl) speedEl.textContent = mode === 'fly' ? `Скорость: ${speed < 10 ? speed.toFixed(1) : Math.round(speed)} м/с` : '';
    // флаг isLocked у PointerLockControls меняется уже после события 'lock',
    // поэтому проверяем состояние браузера напрямую
    const locked = document.pointerLockElement === dom;
    if (clickEl) clickEl.style.display = mode === 'fly' && !locked ? 'block' : 'none';
  }

  function setMode(m) {
    if (m === mode) return;
    mode = m;
    if (mode === 'fly') {
      orbit.enabled = false;
      vel.set(0, 0, 0);
      fly.lock();
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
  dom.addEventListener('click', () => { if (mode === 'fly' && document.pointerLockElement !== dom) fly.lock(); });
  if (clickEl) clickEl.addEventListener('click', () => fly.lock());

  // Ctrl + W и подобные сочетания браузер не даёт перехватить; для спуска
  // безопаснее C, но Ctrl тоже работает.
  const code = (e) => e.code;
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const c = code(e);
    if (c === 'KeyF' && !e.repeat) { setMode(mode === 'fly' ? 'orbit' : 'fly'); return; }
    if (c === 'KeyH' && !e.repeat) {
      helpHidden = !helpHidden;
      try { localStorage.setItem('castle-ui-hidden', helpHidden ? '1' : '0'); } catch (err) { /* ignore */ }
      refreshUI();
      return;
    }
    keys.add(c);
    if (mode === 'fly' && ['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ControlLeft', 'ControlRight'].includes(c)) e.preventDefault();
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

  function keepAboveGround() {
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
      if (t.y < tg) t.y = tg;
      keepAboveGround();
      return;
    }
    // полёт: направление взгляда целиком (W ведёт туда, куда смотришь)
    camera.getWorldDirection(fwd);
    right.crossVectors(fwd, camera.up).normalize();
    want.set(0, 0, 0);
    if (keys.has('KeyW') || keys.has('ArrowUp')) want.add(fwd);
    if (keys.has('KeyS') || keys.has('ArrowDown')) want.sub(fwd);
    if (keys.has('KeyD') || keys.has('ArrowRight')) want.add(right);
    if (keys.has('KeyA') || keys.has('ArrowLeft')) want.sub(right);
    if (keys.has('Space') || keys.has('KeyE')) want.y += 1;
    if (keys.has('KeyC') || keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyQ')) want.y -= 1;
    if (want.lengthSq() > 0) want.normalize();
    const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4 : 1;
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
  return {
    orbit, fly, update,
    get mode() { return mode; },
    setMode,
  };
}
