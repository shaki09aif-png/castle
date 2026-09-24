import * as THREE from 'three';
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
import { createCourtyard } from './courtyard.js';
import { createVillage } from './village.js';
import { createDetails } from './details.js';
import { insideBuilding } from './layout.js';
import { createPostFX } from './postfx.js';
import { createCameraControls } from './camera.js';
import { Q, QUALITY_LEVEL } from './quality.js';

const STAGE = 'Этап 7: деревня, мост, мельница, поля, люди, мелкие детали';

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

  // Без постобработки (низкое качество) сглаживание и тональная компрессия
  // делаются самим рендерером — это намного дешевле.
  const renderer = new THREE.WebGLRenderer({ antialias: !Q.post, powerPreference: 'high-performance', stencil: false });
  const maxRatio = Math.min(window.devicePixelRatio, Q.pixelRatio);
  renderer.setPixelRatio(maxRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = Q.post ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping; // с постобработкой ACES делает она
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
  await step('постройки двора');
  const court = createCourtyard(scene, terrain, walls);
  await step('деревня у подножия');
  const village = createVillage(scene, terrain, walls);
  await step('мелкие детали и люди');
  const details = createDetails(scene, terrain, walls, village);
  await step('трава и деревья');
  const vegetation = createVegetation(scene, terrain, {
    exclude: (x, z) => (insideBuilding(x, z, 0.4) ? 1 : Math.max(court.paveMask(x, z), village.exclude(x, z), details.exclude(x, z))),
    excludeTrees: (x, z) => village.exclude(x, z) > 0,
    extraTrees: details.extraTrees,
  });
  await step('постобработка');
  const post = Q.post
    ? createPostFX(renderer, scene, camera)
    : { setSize() {}, render() { renderer.render(scene, camera); } };

  const cam = createCameraControls(camera, renderer.domElement, terrain);
  const controls = cam.orbit; // для отладки и скриншотов
  // точка, вокруг которой строятся тени: цель орбиты или место впереди в полёте
  const focus = new THREE.Vector3();
  function shadowFocus() {
    if (cam.mode === 'orbit') return controls.target;
    camera.getWorldDirection(focus);
    focus.multiplyScalar(25).add(camera.position);
    focus.y = Math.max(focus.y, terrain.heightAt(focus.x, focus.z));
    return focus;
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
    if (fps < 32) next = Math.max(Q.minPixelRatio, ratio - 0.1);
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
    const dt = timer.getDelta();
    cam.update(dt);
    lighting.update(t, camera, shadowFocus());
    river.update(t);
    vegetation.update(t, camera);
    walls.update(t);
    towers.update(t);
    gate.update(t);
    keep.update(t);
    court.update(t);
    village.update(t);
    details.update(t);
    post.render(dt);

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
    scene, camera, controls, cam, renderer, terrain, assets,
    snapshot() {
      frame();
      return renderer.domElement.toDataURL('image/jpeg', 0.9);
    },
  };
}
