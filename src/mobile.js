// Версия для телефона (?phone или phone.html). Качество графики то же —
// меняется управление и раскладка интерфейса под сенсорный экран:
// - орбита: один палец вращает, два — приближают и сдвигают (OrbitControls);
// - полёт: джойстик слева, кнопки ▲ ▼ справа, взгляд — пальцем по экрану;
// - дверь открывается нажатием на подсказку, экскурсия и кнопки — в панели;
// - кнопка-глаз прячет весь интерфейс, как и на компьютере.
import { PHONE } from './camera.js';

export { PHONE };

export function setupPhone({ cam, camera, doors, dom, onResize }) {
  if (!PHONE) return;
  document.body.classList.add('phone');
  // запретить масштабирование страницы жестами (двойной тап, щипок)
  const vp = document.querySelector('meta[name=viewport]');
  if (vp) vp.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  dom.style.touchAction = 'none';

  const el = (tag, id, html, parent = document.body) => {
    const e = document.createElement(tag);
    if (id) e.id = id;
    if (html) e.innerHTML = html;
    parent.appendChild(e);
    return e;
  };

  // ---- верхний ряд: полёт/орбита и полный экран (рядом с кнопкой-глазом)
  const bar = el('div', 'm-bar');
  const modeBtn = el('button', 'm-mode', '✈ Полёт', bar);
  modeBtn.type = 'button';
  modeBtn.addEventListener('click', () => {
    cam.touch.x = cam.touch.y = cam.touch.lift = 0;
    knob.style.transform = '';
    cam.setMode(cam.mode === 'fly' ? 'orbit' : 'fly');
  });
  const root = document.documentElement;
  if (root.requestFullscreen || root.webkitRequestFullscreen) {
    const fs = el('button', 'm-full', '⛶', bar);
    fs.type = 'button';
    fs.title = 'Во весь экран';
    fs.addEventListener('click', () => {
      const on = document.fullscreenElement || document.webkitFullscreenElement;
      if (on) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else {
        const p = (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
        // в полном экране — альбомная ориентация, если телефон разрешает
        if (p && p.then) p.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
      }
    });
  }

  // ---- джойстик движения
  const joy = el('div', 'm-joy');
  const knob = el('div', 'm-knob', '', joy);
  let joyId = null, jc = { x: 0, y: 0 };
  const R = 52;
  const setKnob = (dx, dy) => {
    const d = Math.hypot(dx, dy), k = d > R ? R / d : 1;
    dx *= k; dy *= k;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    cam.touch.x = dx / R;
    cam.touch.y = -dy / R;
  };
  joy.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    joyId = e.pointerId;
    try { joy.setPointerCapture(e.pointerId); } catch (err) { /* нет захвата */ }
    const r = joy.getBoundingClientRect();
    jc = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    setKnob(e.clientX - jc.x, e.clientY - jc.y);
  });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) setKnob(e.clientX - jc.x, e.clientY - jc.y); });
  const joyEnd = (e) => { if (e.pointerId !== joyId) return; joyId = null; setKnob(0, 0); };
  joy.addEventListener('pointerup', joyEnd);
  joy.addEventListener('pointercancel', joyEnd);

  // ---- подъём и спуск
  const lift = el('div', 'm-lift');
  for (const [txt, v] of [['▲', 1], ['▼', -1]]) {
    const b = el('button', null, txt, lift);
    b.type = 'button';
    const on = (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) { /* нет захвата */ } cam.touch.lift = v; b.classList.add('on'); };
    const off = () => { if (cam.touch.lift === v) cam.touch.lift = 0; b.classList.remove('on'); };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
  }

  // ---- взгляд в полёте: палец по экрану
  let lookId = null, lx = 0, ly = 0;
  dom.addEventListener('pointerdown', (e) => {
    if (cam.mode !== 'fly' || lookId !== null) return;
    lookId = e.pointerId; lx = e.clientX; ly = e.clientY;
  });
  dom.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookId || cam.mode !== 'fly') return;
    cam.look(e.clientX - lx, e.clientY - ly);
    lx = e.clientX; ly = e.clientY;
  });
  const lookEnd = (e) => { if (e.pointerId === lookId) lookId = null; };
  dom.addEventListener('pointerup', lookEnd);
  dom.addEventListener('pointercancel', lookEnd);

  // ---- дверь: нажать на подсказку
  const hint = document.getElementById('door-hint');
  if (hint && doors && doors.toggleNearest) hint.addEventListener('click', () => doors.toggleNearest());

  // ---- подпись режима на кнопке и сброс джойстика при смене режима
  let last = null;
  const sync = () => {
    if (cam.mode !== last) {
      last = cam.mode;
      modeBtn.textContent = cam.mode === 'fly' ? '⟳ Орбита' : '✈ Полёт';
    }
    requestAnimationFrame(sync);
  };
  sync();

  // ---- панель экскурсии сначала свёрнута, чтобы не закрывать сцену
  const tourEl = document.getElementById('tour');
  if (tourEl) tourEl.classList.add('collapsed');

  // ---- в портретной ориентации угол обзора шире
  const fit = () => {
    const a = window.innerWidth / window.innerHeight;
    camera.fov = a < 1 ? 72 : a < 1.5 ? 58 : 50;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', () => { if (onResize) onResize(); fit(); });
  fit();

  // ---- короткая подсказка при запуске
  const tip = el('div', 'm-tip', 'Один палец — вращать · два — приблизить<br>✈ Полёт — джойстик и ▲ ▼ · 👁 — скрыть всё');
  setTimeout(() => tip.classList.add('gone'), 7000);
  dom.addEventListener('pointerdown', () => tip.classList.add('gone'), { once: true });
}
