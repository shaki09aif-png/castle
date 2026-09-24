#!/usr/bin/env node
// Скачивает бесплатные CC0-текстуры и HDRI с Poly Haven (https://polyhaven.com)
// в папку public/assets и записывает public/assets/manifest.json со списком
// файлов и авторов. Запуск:  npm run assets   (нужен Node.js 18+ и интернет)
//
// Для каждого слота перечислено несколько подходящих ассетов: берётся первый,
// который удалось скачать. Если Poly Haven переименует ассет, скрипт просто
// перейдёт к следующему варианту.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'assets');
const RES = process.env.PH_RES || '2k'; // разрешение текстур: 1k, 2k, 4k
const HDRI_RES = process.env.PH_HDRI_RES || '4k';

// слот -> кандидаты (id ассетов Poly Haven)
const TEXTURES = {
  wallStone: ['castle_wall_slates', 'castle_brick_07', 'medieval_blocks_02', 'stone_brick_wall_001', 'stone_wall'],
  rubbleStone: ['stone_wall_04', 'castle_wall_varriation', 'stone_wall', 'rock_wall_08'],
  rock: ['rock_face', 'rock_wall_08', 'rocky_terrain_02', 'rock_wall_10'],
  grass: ['leafy_grass', 'aerial_grass_rock', 'forrest_ground_01', 'brown_mud_leaves_01'],
  dirt: ['rocky_trail', 'forrest_ground_01', 'brown_mud_02', 'dirt'],
  gravel: ['gravelly_sand', 'coast_sand_rocks_02', 'aerial_rocks_02', 'gravel_floor'],
  wood: ['weathered_planks', 'wood_planks', 'brown_planks_03', 'old_planks_02'],
  roof: ['roof_tiles_14', 'clay_roof_tiles_02', 'red_slate_roof_tiles_01', 'roof_09'],
  cobble: ['cobblestone_floor_08', 'cobblestone_05', 'cobblestone_large_01', 'cobblestone_floor_01'],
};
const HDRIS = {
  sky: ['kloofendal_48d_partly_cloudy_puresky', 'kloofendal_43d_clear_puresky', 'qwantani_puresky'],
};

// названия карт в API Poly Haven и запасные имена файлов на dl.polyhaven.org
const MAPS = {
  color: { keys: ['Diffuse', 'diff', 'Color'], file: 'diff' },
  normal: { keys: ['nor_gl', 'Normal'], file: 'nor_gl' },
  roughness: { keys: ['Rough', 'rough', 'Roughness'], file: 'rough' },
  ao: { keys: ['AO', 'ao'], file: 'ao' },
};

async function getJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'castle-school-project' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function download(url, file) {
  const r = await fetch(url, { headers: { 'User-Agent': 'castle-school-project' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buf);
  return buf.length;
}

function pickUrl(files, keys, ext) {
  for (const k of keys) {
    const byRes = files[k];
    if (!byRes) continue;
    const res = byRes[RES] || byRes['2k'] || byRes['1k'];
    const f = res && (res[ext] || res.jpg || res.png);
    if (f && f.url) return f.url;
  }
  return null;
}

function authors(info) {
  return info && info.authors ? Object.keys(info.authors) : [];
}

async function fetchTexture(slot, id) {
  let files = null;
  let info = null;
  try {
    files = await getJSON(`https://api.polyhaven.com/files/${id}`);
    info = await getJSON(`https://api.polyhaven.com/info/${id}`);
  } catch (e) {
    files = null; // попробуем прямые ссылки
  }
  const out = {};
  for (const [kind, m] of Object.entries(MAPS)) {
    const url = (files && pickUrl(files, m.keys, 'jpg')) ||
      `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/${RES}/${id}/${id}_${m.file}_${RES}.jpg`;
    const rel = `textures/${slot}/${kind}${path.extname(new URL(url).pathname) || '.jpg'}`;
    try {
      await download(url, path.join(OUT, rel));
      out[kind] = rel;
    } catch (e) {
      if (kind === 'color' || kind === 'normal') throw e; // без цвета и нормалей набор бесполезен
    }
  }
  const dims = info && info.dimensions; // в миллиметрах
  return {
    id,
    name: (info && info.name) || id,
    authors: authors(info),
    url: `https://polyhaven.com/a/${id}`,
    license: 'CC0',
    tileMeters: dims && dims[0] ? dims[0] / 1000 : null,
    files: out,
  };
}

async function fetchHdri(slot, id) {
  let url = null;
  let info = null;
  try {
    const files = await getJSON(`https://api.polyhaven.com/files/${id}`);
    const res = files.hdri && (files.hdri[HDRI_RES] || files.hdri['2k']);
    url = res && res.hdr && res.hdr.url;
    info = await getJSON(`https://api.polyhaven.com/info/${id}`);
  } catch (e) {
    /* прямая ссылка ниже */
  }
  url = url || `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/${HDRI_RES}/${id}_${HDRI_RES}.hdr`;
  const rel = `hdri/${slot}.hdr`;
  await download(url, path.join(OUT, rel));
  return { id, name: (info && info.name) || id, authors: authors(info), url: `https://polyhaven.com/a/${id}`, license: 'CC0', file: rel };
}

async function main() {
  const manifest = { source: 'Poly Haven (https://polyhaven.com), CC0', generated: new Date().toISOString(), textures: {}, hdri: {} };
  for (const [slot, ids] of Object.entries(TEXTURES)) {
    for (const id of ids) {
      try {
        process.stdout.write(`${slot}: ${id} … `);
        manifest.textures[slot] = await fetchTexture(slot, id);
        console.log('ok');
        break;
      } catch (e) {
        console.log(`нет (${e.message})`);
      }
    }
  }
  for (const [slot, ids] of Object.entries(HDRIS)) {
    for (const id of ids) {
      try {
        process.stdout.write(`hdri ${slot}: ${id} … `);
        manifest.hdri[slot] = await fetchHdri(slot, id);
        console.log('ok');
        break;
      } catch (e) {
        console.log(`нет (${e.message})`);
      }
    }
  }
  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('\nГотово. Список ассетов и авторов: public/assets/manifest.json');
  for (const [slot, t] of Object.entries({ ...manifest.textures, ...manifest.hdri })) {
    console.log(`  ${slot.padEnd(12)} ${t.name} — ${t.authors.join(', ') || 'Poly Haven'} (${t.url}, CC0)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
