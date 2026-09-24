// Настройки качества графики: низкое / среднее / высокое.

const PRESETS = {
  // для школьных компьютеров и встроенной графики: без постобработки и отражений
  low: {
    label: 'Низкое',
    post: false,
    pixelRatio: 1,
    minPixelRatio: 0.5,
    shadowMapSize: 2048,
    shadowRadius: 1,
    msaa: 0,
    ao: false,
    aoHalfRes: true,
    godRays: false,
    bloom: false,
    grassDensity: 0.3,
    grassRadius: 32,
    treeDetailDistance: 60,
    treeCount: 0.32,
    waterReflection: false,
    reflectionSize: 256,
    reflectionEvery: 2,
    textureSize: 512,
    terrainDetail: 0.6,
    rockDetail: false,
    pointLights: false,
    lambert: true, // простые матовые материалы вместо PBR
    envLight: false, // вместо HDRI-освещения — полусферический свет
    cheapShading: true, // без карт нормалей и с резким трипланаром — вдвое меньше выборок текстур
  },
  medium: {
    label: 'Среднее',
    lambert: false,
    envLight: true,
    cheapShading: false,
    post: true,
    pixelRatio: 1,
    minPixelRatio: 0.6,
    shadowMapSize: 2048,
    shadowRadius: 2,
    msaa: 0,
    ao: false,
    aoHalfRes: true,
    godRays: false,
    bloom: true,
    grassDensity: 0.45,
    grassRadius: 45,
    treeDetailDistance: 110,
    treeCount: 0.75,
    waterReflection: true,
    reflectionSize: 256,
    reflectionEvery: 3,
    textureSize: 1024,
    terrainDetail: 0.85,
    rockDetail: true,
    pointLights: true,
  },
  // Высокое, но облегчённое: чёткость (разрешение экрана + MSAA) полная,
  // а дорогие и малозаметные эффекты убраны или урезаны.
  high: {
    label: 'Высокое',
    lambert: false,
    envLight: true,
    cheapShading: false,
    post: true,
    pixelRatio: 2, // полное разрешение экрана — не снижать, иначе «мыло»
    minPixelRatio: 1,
    shadowMapSize: 2048,
    shadowRadius: 2,
    msaa: 4, // сглаживание — не снижать
    ao: false, // SSAO — самый дорогой эффект
    aoHalfRes: true,
    godRays: false,
    bloom: true,
    grassDensity: 0.7,
    grassRadius: 60,
    treeDetailDistance: 180,
    treeCount: 0.85,
    waterReflection: true,
    reflectionSize: 512,
    reflectionEvery: 2,
    textureSize: 1024,
    terrainDetail: 1.0,
    rockDetail: true,
    pointLights: true,
  },
  // Прежнее максимальное качество — только по адресу ?quality=ultra
  ultra: {
    label: 'Максимальное',
    lambert: false,
    envLight: true,
    cheapShading: false,
    post: true,
    pixelRatio: 2,
    minPixelRatio: 1,
    shadowMapSize: 4096,
    shadowRadius: 3,
    msaa: 4,
    ao: true,
    aoHalfRes: false,
    godRays: true,
    bloom: true,
    grassDensity: 1.3,
    grassRadius: 95,
    treeDetailDistance: 320,
    treeCount: 1,
    waterReflection: true,
    reflectionSize: 1024,
    reflectionEvery: 1,
    textureSize: 1024,
    terrainDetail: 1.15,
    rockDetail: true,
    pointLights: true,
  },
};

// Автовыбор: встроенная графика (Intel, AMD Radeon Vega/Graphics в ноутбуках,
// программная отрисовка) — низкое качество, отдельная видеокарта — среднее.
function detectLevel() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return 'low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    if (/intel|uhd|iris|hd graphics|swiftshader|llvmpipe|mesa|microsoft basic|radeon\(tm\) graphics|vega|adreno|mali|apple gpu/i.test(name)) return 'low';
    return 'high'; // отдельная видеокарта — облегчённое высокое; при нехватке FPS сработает автоупрощение
  } catch (e) {
    return 'low';
  }
}

// Уровень выбирается параметром адреса: ?quality=low | medium | high | ultra
// (по умолчанию — автовыбор по видеокарте). Кнопок в интерфейсе нет намеренно.
function readLevel() {
  const url = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('quality') : null;
  if (url && PRESETS[url]) return url;
  return typeof document !== 'undefined' ? detectLevel() : 'medium';
}

export const QUALITY_LEVEL = readLevel();
export const Q = { ...PRESETS[QUALITY_LEVEL] };
// Для замеров: любой параметр можно переопределить в адресе, например ?q_msaa=2&q_bloom=0
if (typeof location !== 'undefined') {
  for (const [k, v] of new URLSearchParams(location.search)) {
    if (!k.startsWith('q_') || !(k.slice(2) in Q)) continue;
    const key = k.slice(2);
    Q[key] = typeof Q[key] === 'boolean' ? v === '1' || v === 'true' : Number(v);
  }
}
