// Общая «планировка» замка: форма вершины холма, направление ворот,
// положение рва, реки и донжона. Этими константами пользуются все модули,
// чтобы стены, башни и дорога совпадали с рельефом.

export const HILL_TOP = 84; // высота площадки на вершине, м

// Ворота смотрят на юг (+Z). Здесь от вершины отходит пологий отрог,
// по которому к замку поднимается дорога.
export const GATE_ANGLE = Math.PI / 2;
export const GATE_DIR = { x: Math.cos(GATE_ANGLE), z: Math.sin(GATE_ANGLE) };

// Радиус площадки вершины в зависимости от направления (полярный угол в плане XZ).
// Вытянутая неровная форма — стены замка потом повторят этот контур.
export function plateauRadius(theta) {
  return (
    46 +
    9.5 * Math.cos(2 * theta - 0.25) +
    3.2 * Math.sin(3 * theta + 0.9) +
    1.6 * Math.cos(5 * theta - 1.3) +
    0.8 * Math.sin(7 * theta + 0.4)
  );
}

export const GATE_RADIUS = plateauRadius(GATE_ANGLE);

// Донжон стоит на самой высокой точке площадки (северо-запад).
export const KEEP_POS = { x: -17, z: -10 };
export const KEEP_RISE = 3.2; // насколько эта точка выше остальной площадки

// Сухой ров, вырубленный в скале поперёк отрога перед воротами.
// Координата along отсчитывается от края площадки в сторону ворот.
export const DITCH = {
  alongStart: 3.5,
  alongEnd: 14.5,
  depth: 8.5,
  halfLength: 34, // протяжённость рва поперёк отрога (в обе стороны)
};

// Вода во рву перед воротами (по просьбе): торцы рва перекрыты земляными дамбами.
export const MOAT = {
  level: HILL_TOP - 5.0,
  damStart: 21.5, // от оси ворот (поперёк рва), где начинается дамба
};

// Уступ (нижняя терраса вершины) к югу от ворот: здесь барбакан,
// а поперёк уступа вырублен сухой ров.
export const SPUR = {
  length: 40, // вынос от кромки площадки, м
  halfWidth: 21,
  corner: 14, // радиус скругления углов
  drop: 1.6, // насколько терраса ниже площадки
};

// Река у подножия: извилистое русло к югу от холма (однозначная функция z(x)),
// ширина меняется вдоль течения, берега неровные.
export function riverZ(x) {
  return 318 + 52 * Math.sin(x / 150 + 0.6) + 24 * Math.sin(x / 61 + 1.7) + 9 * Math.sin(x / 29 + 0.3);
}
export function riverHalfWidth(x) {
  return 8 + 3.2 * Math.sin(x / 97 + 1.1) + 1.8 * Math.sin(x / 41 + 2.3);
}
export const RIVER = {
  depth: 2.4,
  waterLevel: -0.35,
  maxHalfWidth: 14,
};

// Переход из «рабочей» зоны вокруг замка к дальним холмам.
export const WORLD = {
  detailHalf: 400, // зона с мелким шагом сетки (±м)
  half: 3600,
};

// Крепостная стена: идёт по кромке вершины с отступом внутрь.
export const WALL = {
  inset: 3.6, // отступ осевой линии стены от кромки площадки
  thickness: 2.4,
  walkHeight: 8.5, // высота боевого хода над двором
  parapetSill: 1.0, // высота бруствера между зубцами
  merlonHeight: 2.05, // верх зубца над боевым ходом
  merlonWidth: 1.7,
  crenelWidth: 0.85,
  parapetThick: 0.6,
  gateHalfGap: 4.8, // проём под надвратную башню (этап 4)
};

// Узлы стены: 6 башен (этап 3) и ворота. Углы — в градусах, как atan2(z, x).
export const WALL_NODES = [
  { deg: 35, type: 'tower' },
  { deg: 90, type: 'gate' },
  { deg: 140, type: 'tower' },
  { deg: 190, type: 'tower' },
  { deg: 237, type: 'tower' },
  { deg: 286, type: 'tower' },
  { deg: 338, type: 'tower' },
];

// Точка осевой линии стены под заданным углом (градусы)
export function wallNodePoint(deg) {
  const t = (deg * Math.PI) / 180;
  const r = plateauRadius(t) - WALL.inset;
  return { x: Math.cos(t) * r, z: Math.sin(t) * r };
}

// Башни (этап 3): круглые и квадратные, разного размера и высоты.
// Центр башни вынесен наружу от линии стены — башня фланкирует стену.
// extra — насколько верхняя площадка выше боевого хода стены.
const TOWER_SPECS = {
  35: { shape: 'round', r: 4.3, extra: 7.5 },
  140: { shape: 'square', r: 3.9, extra: 6.2 },
  190: { shape: 'round', r: 5.0, extra: 10, corbel: true },
  237: { shape: 'square', r: 4.3, extra: 7.4, corbel: true },
  286: { shape: 'round', r: 3.7, extra: 5.8 },
  338: { shape: 'round', r: 4.6, extra: 8.6, corbel: true },
};

export const TOWERS = WALL_NODES.filter((n) => n.type === 'tower').map((n, i) => {
  const spec = TOWER_SPECS[n.deg];
  const t = (n.deg * Math.PI) / 180;
  const node = wallNodePoint(n.deg);
  const push = spec.r * 0.42;
  return {
    id: i,
    deg: n.deg,
    ...spec,
    node,
    x: node.x + Math.cos(t) * push,
    z: node.z + Math.sin(t) * push,
    yaw: t, // квадратные башни развёрнуты «лицом» наружу
  };
});

// Надвратная башня (этап 4): квадратная, стоит на линии стены над проёмом,
// лицевой стороной к рву. yaw = π/2 — «лицо» смотрит на юг (+Z).
const GATE_NODE = wallNodePoint(90);
export const GATEHOUSE = {
  id: 100,
  shape: 'square',
  r: 5.3, // половина стороны
  x: GATE_NODE.x,
  z: GATE_NODE.z + 1.4,
  yaw: Math.PI / 2,
  extra: 7.8,
  corbel: true,
  corbelOut: 0.62, // машикули: парапет вынесен далеко, между консолями — отверстия
  node: GATE_NODE,
};
// Проезд через ворота: ширина, высота пят арки, уровень порога (у рва) и конец во дворе
export const GATE_PASSAGE = {
  width: 3.6,
  spring: 3.1,
  thresholdY: HILL_TOP - 1.7,
  frontZ: GATEHOUSE.z + GATEHOUSE.r,
  backZ: GATEHOUSE.z - GATEHOUSE.r,
  rampEndZ: GATEHOUSE.z - GATEHOUSE.r - 7, // съезд во двор
};

// Барбакан: огороженная площадка перед рвом на террасе (прямоугольник с воротами на юге)
const DITCH_OUT = GATE_RADIUS + DITCH.alongEnd + 1.1;
export const BARBICAN = {
  x0: -8.5, x1: 8.5,
  zN: DITCH_OUT,
  zS: DITCH_OUT + 11,
  thick: 1.7,
  walkH: 5.0,
  gateHalf: 2.0,
};

// Донжон (этап 5): квадратный, в самой высокой точке двора; лицевая сторона
// с поднятым входом обращена к воротам.
export const KEEP = {
  id: 300,
  shape: 'square',
  r: 7.0,
  x: KEEP_POS.x,
  z: KEEP_POS.z,
  yaw: Math.atan2(25, 17),
  extra: 30, // высота до боевой площадки над землёй
  corbel: true,
  corbelOut: 0.45,
  node: KEEP_POS,
};

// Лежит ли точка внутри башни (с запасом m)
export function insideTower(x, z, m = 0) {
  for (const tw of [...TOWERS, GATEHOUSE, KEEP]) {
    const dx = x - tw.x, dz = z - tw.z;
    if (tw.shape === 'round') {
      if (Math.hypot(dx, dz) < tw.r + m) return tw;
    } else {
      const c = Math.cos(tw.yaw), s = Math.sin(tw.yaw);
      const lx = dx * c + dz * s, lz = -dx * s + dz * c;
      if (Math.abs(lx) < tw.r + m && Math.abs(lz) < tw.r + m) return tw;
    }
  }
  return null;
}
