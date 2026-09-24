// Флаги с гербом (золотой замок), колышутся на ветру прямо в вершинном шейдере.
import * as THREE from 'three';
import { makeCanvas, toTexture } from './textures.js';
import { mulberry32 } from './noise.js';

// Флаг: красное поле с золотым замком (геральдическая фигура), бахрома у края
const texCache = new Map();
function bannerTexture(field = '#8a1a1c') {
  if (texCache.has(field)) return texCache.get(field);
  const W = 512, H = 320;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = field;
  g.fillRect(0, 0, W, H);
  // лёгкая фактура ткани
  const rnd = mulberry32(55);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(0,0,0,${rnd() * 0.06})`;
    g.fillRect(rnd() * W, rnd() * H, 2, 1);
  }
  // кайма
  g.strokeStyle = '#d6a632';
  g.lineWidth = 10;
  g.strokeRect(12, 12, W - 24, H - 24);
  // золотой замок: три башни с зубцами и ворота
  const gold = '#e0b23a', cx = W / 2 + 20, base = H * 0.78;
  g.fillStyle = gold;
  g.fillRect(cx - 110, base - 95, 220, 95); // стена
  for (const [tx, tw, th] of [[-110, 60, 170], [-30, 60, 205], [50, 60, 170]]) {
    g.fillRect(cx + tx, base - th, tw, th);
    for (let k = 0; k < 3; k++) g.fillRect(cx + tx + k * 22, base - th - 16, 14, 16); // зубцы
  }
  g.fillStyle = field;
  g.beginPath(); // ворота
  g.moveTo(cx - 22, base);
  g.lineTo(cx - 22, base - 40);
  g.quadraticCurveTo(cx, base - 72, cx + 22, base - 40);
  g.lineTo(cx + 22, base);
  g.fill();
  for (const tx of [-80, 0, 80]) g.fillRect(cx + tx - 6, base - 150 + (tx === 0 ? -30 : 0), 12, 26); // окна
  const t = toTexture(c, { repeat: false });
  texCache.set(field, t);
  return t;
}

// Флаг колышется на ветру прямо в вершинном шейдере
export const FLAG_TIME = { value: 0 };

// Флаг на древке; size — ширина в метрах, field — цвет поля
export function createFlag(scene, pos, uTime = FLAG_TIME, { size = 3.8, field } = {}) {
  const W = size, H = size * 0.63;
  const geo = new THREE.PlaneGeometry(W, H, 28, 14);
  geo.translate(W / 2, -H / 2, 0);
  const mat = new THREE.MeshStandardMaterial({ map: bannerTexture(field), side: THREE.DoubleSide, roughness: 0.85 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        float flagZ(vec2 p) {
          float k = p.x / ${W.toFixed(2)};
          return (sin(p.x * 1.9 - uTime * 5.5 + p.y * 0.5) * 0.45 + sin(p.x * 4.3 - uTime * 8.7 + p.y * 1.3) * 0.1) * (0.25 + k);
        }`)
      .replace('#include <beginnormal_vertex>', `
        float e = 0.05;
        float dzdx = (flagZ(position.xy + vec2(e, 0.0)) - flagZ(position.xy - vec2(e, 0.0))) / (2.0 * e);
        float dzdy = (flagZ(position.xy + vec2(0.0, e)) - flagZ(position.xy - vec2(0.0, e))) / (2.0 * e);
        vec3 objectNormal = normalize(vec3(-dzdx, -dzdy, 1.0));`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = position;
        transformed.z += flagZ(position.xy);
        transformed.x -= abs(flagZ(position.xy)) * 0.25;
        transformed.y -= (position.x / ${W.toFixed(2)}) * 0.18; // край флага чуть провисает`);
  };
  const flag = new THREE.Mesh(geo, mat);
  flag.castShadow = true;
  const group = new THREE.Group();
  group.position.copy(pos);
  group.add(flag);
  scene.add(group);
  const ph = pos.x * 0.1;
  return (t) => {
    group.rotation.y = 0.6 + Math.sin(t * 0.37 + ph) * 0.25; // по ветру, как флюгеры
  };
}

