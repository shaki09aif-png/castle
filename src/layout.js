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
  level: HILL_TOP - 3.2, // до настила моста ≈1,5 м
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
  35: { shape: 'round', r: 4.3, extra: 7.5, flag: true, flagColor: '#7a1c1c' },
  140: { shape: 'square', r: 3.9, extra: 6.2, flag: true, flagColor: '#1f3f8a' },
  190: { shape: 'round', r: 5.0, extra: 10, corbel: true, flag: true, flagColor: '#1f3f8a' },
  237: { shape: 'square', r: 4.3, extra: 7.4, corbel: true, flag: true, flagColor: '#7a1c1c' },
  286: { shape: 'round', r: 3.7, extra: 5.8, flag: true, flagColor: '#1f3f8a' },
  338: { shape: 'round', r: 4.6, extra: 8.6, corbel: true, flag: true },
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
  flag: true,
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

// Трасса крепостной стены (осевая линия): узлы + изломы там, где кромка вершины
// отходит от прямой. Начинается и заканчивается у проёма ворот.
export function wallTrace() {
  const nodes = WALL_NODES.map((n) => ({ ...n, p: wallNodePoint(n.deg) }));
  const pts = [];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i], b = nodes[(i + 1) % nodes.length];
    pts.push({ p: a.p, node: a });
    let d1 = b.deg - a.deg;
    if (d1 < 0) d1 += 360;
    for (const f of [0.33, 0.66]) {
      const edge = wallNodePoint(a.deg + d1 * f);
      const onLine = { x: a.p.x + (b.p.x - a.p.x) * f, z: a.p.z + (b.p.z - a.p.z) * f };
      if (dist(edge, onLine) > 1.6) pts.push({ p: edge, node: null });
    }
  }
  const gi = pts.findIndex((q) => q.node && q.node.type === 'gate');
  const ordered = [...pts.slice(gi + 1), ...pts.slice(0, gi)];
  const g = pts[gi].p;
  const toward = (q) => {
    const d = dist(q, g);
    return { x: g.x + ((q.x - g.x) / d) * WALL.gateHalfGap, z: g.z + ((q.z - g.z) / d) * WALL.gateHalfGap };
  };
  return [
    { p: toward(ordered[0].p), node: null, cap: true },
    ...ordered,
    { p: toward(ordered[ordered.length - 1].p), node: null, cap: true },
  ];
}

// ---------------------------------------------------------------------------
// Постройки двора (этап 6). Большинство примыкает задней стеной к крепостной
// стене: deg — место на стене, t — сдвиг вдоль участка стены (−0.5…0.5),
// L — длина вдоль стены, W — глубина, gap — отступ задней стены от оси стены
// (под деревянным боевым ходом остаётся проход).
// ---------------------------------------------------------------------------
const BUILDING_SPECS = [
  { id: 'hall', deg: 5, t: -0.22, L: 17, W: 10.5, gap: 3.0 },
  { id: 'kitchen', deg: 26, t: 0.12, L: 8, W: 6.5, gap: 3.0 },
  { id: 'barracks', deg: 60, t: 0.05, L: 12, W: 6, gap: 2.9 },
  { id: 'store', deg: 107, t: 0.05, L: 8, W: 5.5, gap: 2.9 },
  { id: 'forge', deg: 124, t: -0.12, L: 7, W: 5.2, gap: 2.9 },
  { id: 'stable', deg: 162, t: 0.0, L: 12, W: 5.2, gap: 2.9 },
  { id: 'granary', deg: 218, t: 0.05, L: 8.5, W: 5.5, gap: 2.9 },
];

function segmentNear(trace, px, pz) {
  let best = null, bd = Infinity;
  for (let i = 0; i < trace.length - 1; i++) {
    const a = trace[i].p, b = trace[i + 1].p;
    const ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez;
    const t = Math.max(0, Math.min(1, ((px - a.x) * ex + (pz - a.z) * ez) / l2));
    const d = Math.hypot(px - (a.x + ex * t), pz - (a.z + ez * t));
    if (d < bd) { bd = d; best = { a, b }; }
  }
  return best;
}

function placeBuildings() {
  const trace = wallTrace();
  const out = BUILDING_SPECS.map((s) => {
    const wp = wallNodePoint(s.deg);
    const { a, b } = segmentNear(trace, wp.x, wp.z);
    let dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    dx /= len; dz /= len;
    let nx = -dz, nz = dx; // внутрь двора (к центру)
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    if (nx * -mx + nz * -mz < 0) { nx = -nx; nz = -nz; }
    const along = len / 2 + s.t * len;
    const off = s.gap + s.W / 2;
    return {
      ...s,
      x: a.x + dx * along + nx * off,
      z: a.z + dz * along + nz * off,
      ax: dx, az: dz, // вдоль стены
      nx, nz, // лицом во двор
    };
  });
  // Часовня стоит отдельно у северной стены, ориентирована алтарём на восток
  out.push({ id: 'chapel', L: 12.5, W: 7, x: -1.5, z: -25.6, ax: 1, az: 0, nx: 0, nz: 1 });
  return out;
}
export const BUILDINGS = placeBuildings();
export const WELL = { x: 9, z: 3, r: 1.3 };

// Лежит ли точка внутри постройки (с запасом m)
export function insideBuilding(x, z, m = 0) {
  for (const b of BUILDINGS) {
    const dx = x - b.x, dz = z - b.z;
    const la = dx * b.ax + dz * b.az, ln = dx * b.nx + dz * b.nz;
    if (Math.abs(la) < b.L / 2 + m && Math.abs(ln) < b.W / 2 + m) return b;
  }
  if (Math.hypot(x - WELL.x, z - WELL.z) < WELL.r + 1.2 + m) return WELL;
  return null;
}
