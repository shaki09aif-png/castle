// Загрузка внешних ресурсов (CC0): фотоскан-текстуры и HDRI с Poly Haven.
// Если файлов нет (скрипт npm run assets не запускался), сцена использует
// процедурные текстуры и встроенную HDRI — всё продолжает работать.
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { makeCanvas } from './textures.js';

const BASE = 'assets/';

// Встроенная HDRI для окружающего освещения (лежит в репозитории).
export const BUILTIN_ENV = {
  id: 'rooitou_park',
  name: 'Rooitou Park',
  authors: [],
  url: 'https://polyhaven.com/a/rooitou_park',
  file: 'hdri/rooitou_park_1k.hdr',
};

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('не удалось загрузить ' + url));
    img.src = url;
  });
}

// Упаковать шероховатость и AO в одну текстуру ORM (R — AO, G — roughness).
function packOrm(rough, ao) {
  const w = rough.width, h = rough.height;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(rough, 0, 0, w, h);
  const r = ctx.getImageData(0, 0, w, h);
  let a = null;
  if (ao) {
    ctx.drawImage(ao, 0, 0, w, h);
    a = ctx.getImageData(0, 0, w, h);
  }
  for (let i = 0; i < w * h; i++) {
    const rough8 = r.data[i * 4];
    r.data[i * 4] = a ? a.data[i * 4] : 255;
    r.data[i * 4 + 1] = rough8;
    r.data[i * 4 + 2] = 0;
    r.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(r, 0, 0);
  return c;
}

async function loadManifest() {
  try {
    const r = await fetch(BASE + 'manifest.json', { cache: 'no-cache' });
    if (!r.ok) return null;
    const text = await r.text();
    if (!text.trim().startsWith('{')) return null; // dev-сервер мог вернуть index.html
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

const DEFAULT_TILE = { wallStone: 3, rubbleStone: 2.5, rock: 3, grass: 2, dirt: 2.5, gravel: 2, wood: 2, roof: 2, cobble: 2.5 };

export async function loadAssets() {
  const manifest = await loadManifest();
  const sets = {};
  const credits = [];
  if (manifest && manifest.textures) {
    await Promise.all(
      Object.entries(manifest.textures).map(async ([slot, t]) => {
        try {
          const f = t.files;
          const [color, normal, rough, ao] = await Promise.all([
            loadImage(BASE + f.color),
            loadImage(BASE + f.normal),
            f.roughness ? loadImage(BASE + f.roughness) : null,
            f.ao ? loadImage(BASE + f.ao) : null,
          ]);
          const orm = rough ? packOrm(rough, ao) : packOrm(color, null);
          sets[slot] = {
            color, normal, orm,
            tileMeters: t.tileMeters || DEFAULT_TILE[slot] || 2,
            size: color.width,
            credit: t,
          };
          credits.push({ slot, ...t });
        } catch (e) {
          console.warn('Poly Haven: набор', slot, 'не загружен, используется процедурный', e);
        }
      })
    );
  }

  const loadHdr = (file, type = THREE.HalfFloatType) =>
    new Promise((res, rej) => new HDRLoader().setDataType(type).load(BASE + file, res, undefined, rej));
  let env = null;
  try {
    env = await loadHdr(BUILTIN_ENV.file, THREE.FloatType); // Float — чтобы можно было «погасить» солнце в карте
    credits.push({ slot: 'env', ...BUILTIN_ENV });
  } catch (e) {
    console.warn('HDRI окружения не загружена', e);
  }
  let sky = null;
  if (manifest && manifest.hdri && manifest.hdri.sky) {
    try {
      sky = await loadHdr(manifest.hdri.sky.file);
      credits.push({ slot: 'sky', ...manifest.hdri.sky });
    } catch (e) {
      console.warn('HDRI неба не загружена', e);
    }
  }
  return { sets, env, sky, credits };
}
