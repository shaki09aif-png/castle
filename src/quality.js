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
    treeCount: 0.45,
    waterReflection: false,
    reflectionSize: 256,
    reflectionEvery: 2,
    textureSize: 512,
    terrainDetail: 0.6,
    rockDetail: false,
    pointLights: false,
  },
  medium: {
    label: 'Среднее',
    post: true,
    pixelRatio: 1,
    minPixelRatio: 0.6,
    shadowMapSize: 2048,
    shadowRadius: 2,
    msaa: 0,
    ao: false,
    aoHalfRes: true,
    godRays: true,
    bloom: true,
    grassDensity: 0.55,
    grassRadius: 55,
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
  high: {
    label: 'Высокое',
    post: true,
    pixelRatio: 1.5,
    minPixelRatio: 0.75,
    shadowMapSize: 4096,
    shadowRadius: 3,
    msaa: 0,
    ao: true,
    aoHalfRes: true,
    godRays: true,
    bloom: true,
    grassDensity: 1,
    grassRadius: 80,
    treeDetailDistance: 200,
    treeCount: 1,
    waterReflection: true,
    reflectionSize: 512,
    reflectionEvery: 2,
    textureSize: 1024,
    terrainDetail: 1,
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
    return 'medium';
  } catch (e) {
    return 'low';
  }
}

// Уровень выбирается параметром адреса: ?quality=low | medium | high
// (по умолчанию — автовыбор по видеокарте). Кнопок в интерфейсе нет намеренно.
function readLevel() {
  const url = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('quality') : null;
  if (url && PRESETS[url]) return url;
  return typeof document !== 'undefined' ? detectLevel() : 'medium';
}

export const QUALITY_LEVEL = readLevel();
export const Q = PRESETS[QUALITY_LEVEL];
