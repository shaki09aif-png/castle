import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { setAnisotropy, setLoadedAssets } from './textures.js';
import { loadAssets } from './assets.js';
import { createLighting } from './lighting.js';
import { createTerrain } from './terrain.js';
import { createRiver } from './water.js';
import { createVegetation } from './vegetation.js';
import { createWalls } from './walls.js';
import { createTowers } from './towers.js';
import { createGate } from './gate.js';
import { createKeep } from './keep.js';
import { createPostFX } from './postfx.js';
import { HILL_TOP } from './layout.js';
import { Q, QUALITY_LEVEL } from './quality.js';

const STAGE = 'Этап 5: донжон — пять этажей, поднятый вход, бартизаны, флаг';

const loading = document.getElementById('loading');
const loadingText = loading.querySelector('small');
document.getElementById('stage').textContent = STAGE;

// Сообщение на экране загрузки + пауза, чтобы браузер успел его отрисовать
const step = (text) =>
  new Promise((res) => {
    loadingText.textContent = text;
    requestAnimationFrame(() => setTimeout(res, 20));
  });

init().catch((e) => {
  console.error(e);
  loadingText.textContent = 'Ошибка: ' + e.message;
});

async function init() {
  await step('загрузка текстур и HDRI');
  const assets = await loadAssets();
  setLoadedAssets(assets.sets);

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  const maxRatio = Math.min(window.devicePixelRatio, Q.pixelRatio);
  renderer.setPixelRatio(maxRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping; // ACES делается в постобработке
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // мягкая PCF-фильтрация (радиус задан у тени)
  document.body.appendChild(renderer.domElement);
  setAnisotropy(Math.min(16, renderer.capabilities.getMaxAnisotropy()));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.25, 9000);
  camera.position.set(175, 150, 310);
  camera.layers.enable(1); // слои 1–2 — трава, мелкие камни, дальние деревья
  camera.layers.enable(2); // (не попадают в отражения воды)

  const lighting = createLighting(scene, renderer, assets);
  await step('генерация рельефа');
  const terrain = createTerrain(scene);
  const river = createRiver(scene);
  await step('стены замка');
  const walls = createWalls(scene, terrain);
  await step('башни');
  const towers = createTowers(scene, terrain, walls);
  await step('ворота и барбакан');
  const gate = createGate(scene, terrain, walls);
  await step('донжон');
  const keep = createKeep(scene, terrain, walls);
  await step('трава и деревья');
  const vegetation = createVegetation(scene, terrain);
  await step('постобработка');
  const post = createPostFX(renderer, scene, camera);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, HILL_TOP - 6, 20);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.5;
  controls.maxDistance = 1300;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.zoomSpeed = 1.2;
  controls.update();

  // камера не уходит под землю, точка вращения не улетает далеко от замка
  function clampCamera() {
    const t = controls.target;
    const r = Math.hypot(t.x, t.z);
    if (r > 700) { t.x *= 700 / r; t.z *= 700 / r; }
    const tg = terrain.heightAt(t.x, t.z) + 0.3;
    if (t.y < tg) t.y = tg;
    const g = terrain.heightAt(camera.position.x, camera.position.z) + 1.2;
    if (camera.position.y < g) camera.position.y = g;
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    post.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);

  // Счётчик кадров и динамическое разрешение (как в играх): если FPS падает
  // ниже 32, внутреннее разрешение немного снижается, при запасе — возвращается.
  const fpsEl = document.getElementById('fps');
  let frames = 0, fpsTime = performance.now();
  let ratio = maxRatio;
  function adaptResolution(fps) {
    let next = ratio;
    if (fps < 32) next = Math.max(0.6, ratio - 0.1);
    else if (fps > 55) next = Math.min(maxRatio, ratio + 0.05);
    if (Math.abs(next - ratio) > 0.001) {
      ratio = next;
      renderer.setPixelRatio(ratio);
      resize();
    }
  }

  const timer = new THREE.Timer();
  const still = new URLSearchParams(location.search).has('still'); // режим для автоматических скриншотов
  const frame = () => {
    timer.update();
    const t = timer.getElapsed();
    controls.update();
    clampCamera();
    lighting.update(t, camera, controls.target);
    river.update(t);
    vegetation.update(t, camera);
    walls.update(t);
    towers.update(t);
    gate.update(t);
    keep.update(t);
    post.render(timer.getDelta());

    frames++;
    const now = performance.now();
    if (now - fpsTime > 1000) {
      const fps = (frames * 1000) / (now - fpsTime);
      fpsEl.textContent = `${Math.round(fps)} FPS · ${QUALITY_LEVEL}`;
      if (!still) adaptResolution(fps);
      frames = 0;
      fpsTime = now;
    }
  };
  if (!still) renderer.setAnimationLoop(frame);

  loading.style.opacity = '0';
  setTimeout(() => loading.remove(), 900);

  // доступ из консоли браузера для отладки
  window.castle = {
    scene, camera, controls, renderer, terrain, assets,
    snapshot() {
      frame();
      return renderer.domElement.toDataURL('image/jpeg', 0.9);
    },
  };
}
