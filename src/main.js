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
import { createTorches } from './torches.js';
import { FLAG_TIME } from './flags.js';
import { insideBuilding } from './layout.js';
import { createPostFX } from './postfx.js';
import { REFLECT } from './water.js';
import { createCameraControls } from './camera.js';
import { createTour } from './tour.js';
import { createExtras } from './extras.js';
import { createWeather } from './weather.js';
import { SWAY_TIME } from './people.js';
import { FOLIAGE_SUN } from './vegetation.js';
import { SUN_DIR } from './lighting.js';
import { Q, QUALITY_LEVEL } from './quality.js';


const loading = document.getElementById('loading');
const loadingText = loading.querySelector('small');

// Сообщение на экране загрузки + пауза, чтобы браузер успел его отрисовать
const step = (text) =>
  new Promise((res) => {
    loadingText.textContent = text;
    requestAnimationFrame(() => setTimeout(res, 20));
  });

// На слабых видеокартах PBR-материалы (GGX) заменяются на более простые
// ламбертовы: вид почти тот же (почти всё в сцене матовое), а считать в разы проще.
function toLambert(scene) {
  const cache = new Map();
  const conv = (m) => {
    if (!m || !m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) return m;
    if (cache.has(m)) return cache.get(m);
    const l = new THREE.MeshLambertMaterial();
    for (const k of ['map', 'alphaTest', 'side', 'transparent', 'opacity', 'vertexColors', 'emissiveMap', 'emissiveIntensity',
      'aoMap', 'aoMapIntensity', 'fog', 'depthWrite', 'depthTest', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits',
      'alphaToCoverage', 'flatShading', 'name', 'visible', 'toneMapped', 'blending']) l[k] = m[k];
    l.color.copy(m.color);
    l.emissive.copy(m.emissive);
    if (m.defines) { l.defines = { ...m.defines }; delete l.defines.STANDARD; delete l.defines.PHYSICAL; }
    l.userData = m.userData;
    if (m.onBeforeCompile) l.onBeforeCompile = m.onBeforeCompile;
    const key = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : null;
    if (key) l.customProgramCacheKey = () => 'lam-' + key();
    cache.set(m, l);
    return l;
  };
  scene.traverse((o) => {
    if (!o.material) return;
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
  });
}

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
  const renderer = new THREE.WebGLRenderer({ antialias: !Q.post && !new URLSearchParams(location.search).has('noaa'), powerPreference: 'high-performance', stencil: false });
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
  // объекты двора не видны в воде — убираем их из отражений (слой 1),
  // это заметно ускоряет перерисовку отражений реки и рва
  const toLayer1 = (from) => { for (let i = from; i < scene.children.length; i++) scene.children[i].traverse((o) => o.layers.set(1)); };
  await step('постройки двора');
  let mark = scene.children.length;
  const court = createCourtyard(scene, terrain, walls);
  toLayer1(mark);
  await step('деревня у подножия');
  const village = createVillage(scene, terrain, walls);
  await step('мелкие детали и люди');
  mark = scene.children.length;
  const details = createDetails(scene, terrain, walls, village);
  const torches = createTorches(scene, terrain, walls);
  await step('интерьер зала, осадный лагерь, птицы');
  const extras = createExtras(scene, terrain, walls, village);
  toLayer1(mark);
  // в осадном лагере не растут деревья и трава
  const campEx = (x, z) => ((extras.camp && Math.hypot(x - extras.camp.x, z - extras.camp.z) < 30) || (extras.pasture && Math.hypot(x - extras.pasture.x, z - extras.pasture.z) < 14) ? 1 : 0);
  await step('трава и деревья');
  const vegetation = createVegetation(scene, terrain, {
    exclude: (x, z) => (insideBuilding(x, z, 0.4) ? 1 : Math.max(court.paveMask(x, z), village.exclude(x, z), details.exclude(x, z), campEx(x, z))),
    excludeTrees: (x, z) => village.exclude(x, z) > 0 || campEx(x, z) > 0,
    extraTrees: details.extraTrees,
  });
  if (Q.lambert) toLambert(scene);
  await step('постобработка');
  const direct = { setSize() {}, render() { renderer.render(scene, camera); } };
  let post = Q.post ? createPostFX(renderer, scene, camera) : direct;

  const cam = createCameraControls(camera, renderer.domElement, terrain);
  const controls = cam.orbit; // для отладки и скриншотов
  const tour = createTour(camera, cam, terrain, village, extras);

  // ---- время суток: всё, что зависит от темноты ----
  const glassMeshes = [], waters = [];
  scene.traverse((o) => {
    if (o.name === 'stained-glass') glassMeshes.push(o);
    if ((o.name === 'river' || o.name === 'moat') && o.material.uniforms && o.material.uniforms.sunDirection) waters.push(o.material.uniforms);
  });
  lighting.onChange((night, st) => {
    torches.setNight(night);
    extras.setNight(night);
    FOLIAGE_SUN.copy(SUN_DIR).multiplyScalar(1 - 0.95 * night); // ночью листва не «просвечивает»
    for (const g of glassMeshes) for (const m of [].concat(g.material)) m.emissiveIntensity = 0.55 + night * 1.8; // свечи за витражами
    for (const u of waters) { u.sunDirection.value.copy(SUN_DIR); u.sunColor.value.copy(st.sunCol).multiplyScalar(1 - 0.6 * night); }
  });
  const weather = createWeather(scene, lighting, { paveMask: court.paveMask, heightAt: terrain.heightAt, renderer });
  const weatherBtn = document.getElementById('btn-weather'), siegeBtn = document.getElementById('btn-siege');
  const WEATHER_LABEL = { clear: '☁ Ясно', rain: '🌧 Дождь', fog: '🌫 Туман', snow: '❄ Снег' };
  const cycleWeather = () => { weather.next(); if (weatherBtn) weatherBtn.textContent = WEATHER_LABEL[weather.mode]; };
  const toggleSiege = () => { if (!extras.siege) return; const on = extras.siege.toggle(); if (siegeBtn) siegeBtn.textContent = on ? '⚔ Остановить штурм' : '⚔ Штурм'; };
  if (weatherBtn) weatherBtn.addEventListener('click', cycleWeather);
  if (siegeBtn) siegeBtn.addEventListener('click', toggleSiege);
  const dayBtn = document.getElementById('btn-day'), gateBtn = document.getElementById('btn-gate');
  const DAY_LABEL = { day: '☀ День', sunset: '🌅 Закат', night: '🌙 Ночь' };
  const cycleDay = () => { lighting.nextMode(); if (dayBtn) dayBtn.textContent = DAY_LABEL[lighting.mode]; };
  const toggleGate = () => { gate.toggle(); if (gateBtn) gateBtn.textContent = gate.closed ? '⇅ Открыть ворота' : '⇅ Закрыть ворота'; };
  if (dayBtn) dayBtn.addEventListener('click', cycleDay);
  if (gateBtn) gateBtn.addEventListener('click', toggleGate);
  window.addEventListener('keydown', (e) => {
    if (e.repeat || cam.mode === 'fly' && !['KeyN', 'KeyG', 'KeyP', 'KeyB'].includes(e.code)) return;
    if (e.code === 'KeyN') cycleDay();
    if (e.code === 'KeyG') toggleGate();
    if (e.code === 'KeyP') cycleWeather();
    if (e.code === 'KeyB') toggleSiege();
  });
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

  // Счётчик кадров
  const fpsEl = document.getElementById('fps');
  // счётчик кадров скрыт; показать — параметром адреса ?fps
  if (new URLSearchParams(location.search).has('fps')) fpsEl.style.display = 'block';
  let frames = 0, fpsTime = performance.now();
  // Автоупрощение без «мыла»: если FPS ниже 28, по шагам выключается то, что
  // дороже всего и меньше всего заметно. Разрешение снижается только в конце.
  const steps = [
    ['эффекты', () => { if (post !== direct) { post = direct; renderer.toneMapping = THREE.ACESFilmicToneMapping; scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); }); } }],
    ['отражения', () => { REFLECT.on = false; }],
    ['дальняя трава', () => vegetation.setGrassLevel(1)],
    ['тени', () => { renderer.shadowMap.enabled = false; scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); }); }],
    ['трава', () => vegetation.setGrassLevel(0)],
    // разрешение не снижается никогда — чёткость важнее
  ];
  let stepI = 0, slow = 0, cooldown = 3;
  const simplified = [];
  function adaptQuality(fps) {
    if (cooldown > 0) { cooldown--; return; } // после загрузки и после шага — дать FPS устояться
    slow = fps < 28 ? slow + 1 : 0;
    if (slow >= 2 && stepI < steps.length) {
      const [name, fn] = steps[stepI++];
      fn();
      simplified.push(name);
      slow = 0;
      cooldown = 2;
    }
  }

  const timer = new THREE.Timer();
  const still = new URLSearchParams(location.search).has('still'); // режим для автоматических скриншотов
  const noAdapt = new URLSearchParams(location.search).has('noadapt'); // без автоупрощения (для замеров)
  const frame = () => {
    timer.update();
    const t = timer.getElapsed();
    const dt = timer.getDelta();
    if (!tour.update(Math.min(dt, 0.1))) cam.update(dt);
    lighting.update(t, camera, shadowFocus(), Math.min(dt, 0.1));
    river.update(t);
    vegetation.update(t, camera);
    walls.update(t);
    towers.update(t);
    gate.update(t, Math.min(dt, 0.1));
    if (gate.animating && renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true;
    keep.update(t);
    court.update(t);
    village.update(t);
    details.update(t);
    torches.update(t);
    extras.update(t, dt);
    weather.update(t, Math.min(dt, 0.1), camera);
    SWAY_TIME.value = t;
    FLAG_TIME.value = t;
    post.render(dt);

    frames++;
    const now = performance.now();
    if (now - fpsTime > 1000) {
      const fps = (frames * 1000) / (now - fpsTime);
      if (!still && !noAdapt) adaptQuality(fps);
      fpsEl.textContent = `${Math.round(fps)} FPS · ${QUALITY_LEVEL}` + (simplified.length ? ` · упрощено: ${simplified.join(', ')}` : '');
      frames = 0;
      fpsTime = now;
    }
  };
  if (!still) renderer.setAnimationLoop(frame);

  loading.style.opacity = '0';
  setTimeout(() => loading.remove(), 900);

  // доступ из консоли браузера для отладки
  window.castle = {
    scene, camera, controls, cam, tour, renderer, vegetation, REFLECT, lighting, gate, extras, weather, terrain, assets,
    snapshot() {
      frame();
      return renderer.domElement.toDataURL('image/jpeg', 0.9);
    },
  };
}
