// Настройки качества графики: низкое / среднее / высокое.

const PRESETS = {
  low: {
    label: 'Низкое',
    pixelRatio: 1,
    shadowMapSize: 2048,
    shadowRadius: 2,
    msaa: 0,
    ao: false,
    aoHalfRes: true,
    godRays: false,
    bloom: true,
    grassDensity: 0.35,
    grassRadius: 45,
    treeDetailDistance: 90,
    treeCount: 0.5,
    waterReflection: false,
    reflectionSize: 256,
    reflectionEvery: 2,
    textureSize: 512,
    terrainDetail: 0.75,
  },
  medium: {
    label: 'Среднее',
    pixelRatio: 1.25,
    shadowMapSize: 4096,
    shadowRadius: 3,
    msaa: 0,
    ao: true,
    aoHalfRes: true,
    godRays: true,
    bloom: true,
    grassDensity: 0.65,
    grassRadius: 65,
    treeDetailDistance: 150,
    treeCount: 0.8,
    waterReflection: true,
    reflectionSize: 384,
    reflectionEvery: 2,
    textureSize: 1024,
    terrainDetail: 1,
  },
  high: {
    label: 'Высокое',
    pixelRatio: 2,
    shadowMapSize: 4096,
    shadowRadius: 4,
    msaa: 4,
    ao: true,
    aoHalfRes: false,
    godRays: true,
    bloom: true,
    grassDensity: 1,
    grassRadius: 85,
    treeDetailDistance: 220,
    treeCount: 1,
    waterReflection: true,
    reflectionSize: 768,
    reflectionEvery: 1,
    textureSize: 1024,
    terrainDetail: 1,
  },
};

// Уровень выбирается параметром адреса: ?quality=low | medium | high
// (по умолчанию — среднее). Кнопок в интерфейсе нет намеренно.
function readLevel() {
  const url = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('quality') : null;
  return url && PRESETS[url] ? url : 'medium';
}

export const QUALITY_LEVEL = readLevel();
export const Q = PRESETS[QUALITY_LEVEL];
