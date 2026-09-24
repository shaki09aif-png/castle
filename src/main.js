import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { setAnisotropy } from './textures.js';
import { createLighting } from './lighting.js';
import { createTerrain } from './terrain.js';
import { HILL_TOP } from './layout.js';

const STAGE = 'Этап 1: холм, скалы, дорога-серпантин, сухой ров, река, небо';

const loading = document.getElementById('loading');
document.getElementById('stage').textContent = STAGE;

// даём браузеру отрисовать экран загрузки до тяжёлой генерации
requestAnimationFrame(() => setTimeout(init, 30));

function init() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.appendChild(renderer.domElement);
  setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.25, 9000);
  camera.position.set(170, 140, 300);

  const lighting = createLighting(scene, renderer);
  const terrain = createTerrain(scene);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, HILL_TOP - 8, 25);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.5;
  controls.maxDistance = 1300;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.zoomSpeed = 1.2;
  controls.update();

  // камера не должна уходить под землю, а точка вращения — далеко от замка
  function clampCamera() {
    const t = controls.target;
    const r = Math.hypot(t.x, t.z);
    if (r > 700) { t.x *= 700 / r; t.z *= 700 / r; }
    const tg = terrain.heightAt(t.x, t.z) + 0.3;
    if (t.y < tg) t.y = tg;
    const g = terrain.heightAt(camera.position.x, camera.position.z) + 1.2;
    if (camera.position.y < g) camera.position.y = g;
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // счётчик кадров
  const fpsEl = document.getElementById('fps');
  let frames = 0, fpsTime = performance.now();

  const timer = new THREE.Timer();
  // ?still — режим без анимационного цикла (для автоматических скриншотов)
  const still = new URLSearchParams(location.search).has('still');
  const frame = () => {
    timer.update();
    const t = timer.getElapsed();
    controls.update();
    clampCamera();
    lighting.update(t, camera);
    terrain.update(t);
    renderer.render(scene, camera);

    frames++;
    const now = performance.now();
    if (now - fpsTime > 500) {
      fpsEl.textContent = `${Math.round((frames * 1000) / (now - fpsTime))} FPS`;
      frames = 0;
      fpsTime = now;
    }
  };
  if (!still) renderer.setAnimationLoop(frame);

  loading.style.opacity = '0';
  setTimeout(() => loading.remove(), 900);

  // доступ из консоли браузера для отладки
  window.castle = {
    scene, camera, controls, renderer, terrain,
    snapshot() {
      frame();
      return renderer.domElement.toDataURL('image/jpeg', 0.9);
    },
  };
}
