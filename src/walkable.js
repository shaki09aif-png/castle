// Хождение пешком (режим от первого лица): где можно стоять и куда нельзя пройти.
// Без тяжёлых лучей по сеткам — только по плану замка: здания, башни, стена,
// проход ворот и мост, полы домов и подземный ход.
import { insideBuilding, insideTower, GATE_PASSAGE, GATEHOUSE, BARBICAN, WALL } from './layout.js';
import { INTERIORS } from './courtyard.js';

// круглые препятствия (шатры): { x, z, r, door: [dx, dz] | null } — через вход можно пройти
export const OBSTACLES = [];

export function createWalkable(terrain, walls, zones = []) {
  const inObstacle = (x, z) => {
    for (const o of OBSTACLES) {
      const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz);
      if (d > o.r + 0.25 || d < o.r - 0.45) continue; // только кольцо стенки: внутри шатра ходить можно
      if (o.door && (dx * o.door[0] + dz * o.door[1]) / (d || 1) > 0.94) continue; // проём входа
      return true;
    }
    return false;
  };
  const P = walls.points;
  const G = GATE_PASSAGE;
  const gx = GATEHOUSE.x;
  const inGate = (x, z) => Math.abs(x - gx) < G.width / 2 - 0.25 && z > G.rampEndZ - 1 && z < BARBICAN.zS + 1;
  const local = (I, x, z) => {
    const dx = x - I.f.C.x, dz = z - I.f.C.z;
    return [dx * I.f.X.x + dz * I.f.X.z, dx * I.f.N.x + dz * I.f.N.z];
  };
  const interiorAt = (x, z, m = 0) => {
    for (const I of INTERIORS) {
      if (!I.f || !I.f.C) continue;
      const [lx, lz] = local(I, x, z);
      if (Math.abs(lx) < I.L / 2 + m && Math.abs(lz) < I.W / 2 + m) return I;
    }
    return null;
  };
  // стена: расстояние до осевой линии меньше половины толщины (кроме ворот);
  // сверху по стене можно идти по боевому ходу (полоса от настила до парапета)
  const halfT = WALL.thickness / 2 + 0.35;
  const WK = walls.walk, SN = walls.segNrm, band = walls.walkBand || { inner: 2.15, outer: 0.6 };
  const wallInfo = (x, z) => {
    let best = null;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      const ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
      const px = a.x + ex * t, pz = a.z + ez * t;
      const d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) {
        const n = SN[Math.min(i, SN.length - 1)];
        best = { d, c: (x - px) * n.x + (z - pz) * n.z, h: WK[i] + (WK[i + 1] - WK[i]) * t };
      }
    }
    return best;
  };
  const nearWall = (x, z, y) => {
    const w = wallInfo(x, z);
    if (!w || w.d >= Math.max(halfT, band.inner + 0.05)) return false;
    // на боевом ходу — можно (если уже наверху)
    if (y !== undefined && y > w.h - 0.7 && w.c > -band.inner && w.c < band.outer) return false;
    return w.d < halfT;
  };
  // лестницы со двора на стену: высота ступени под точкой
  const stairAt = (x, z) => {
    for (const st of walls.stairs || []) {
      const dx = x - st.top.x, dz = z - st.top.z;
      const al = dx * st.D.x + dz * st.D.z, ac = dx * st.N.x + dz * st.N.z;
      if (Math.abs(ac) > st.width / 2 + 0.05) continue;
      if (al > 1.25 || al < -st.run * st.steps - 0.2) continue;
      if (al > 0) return st.yTop; // верхняя площадка
      const k = Math.max(0, Math.round(-al / st.run));
      return st.yTop - k * st.rise;
    }
    return null;
  };
  const walkTop = (x, z) => {
    const w = wallInfo(x, z);
    if (w && w.c > -band.inner && w.c < band.outer) return w.h;
    return null;
  };
  // стенки барбакана (кроме проёма ворот на юге)
  const B = BARBICAN;
  const nearBarbican = (x, z) => {
    const t = B.thick / 2 + 0.3;
    if (z > B.zN - t && z < B.zS + t) {
      if (Math.abs(x - B.x0) < t || Math.abs(x - B.x1) < t) return true;
    }
    if (x > B.x0 - t && x < B.x1 + t && Math.abs(z - B.zS) < t && Math.abs(x) > B.gateHalf) return true;
    return false;
  };
  const solid = (x, z, y) => {
    if (inGate(x, z)) return false;
    return !!(insideBuilding(x, z, 0.3) || insideTower(x, z, 0.3) || interiorAt(x, z, 0.3) || nearWall(x, z, y) || nearBarbican(x, z) || inObstacle(x, z));
  };
  const zoneFloor = (x, z) => {
    for (const zz of zones) if (zz.floorAt) { const f = zz.floorAt(x, z); if (f !== null && f !== undefined) return f; }
    return null;
  };
  const api = {
    doors: [],
    // у открытой двери можно подняться на порог повыше (полы домов выше земли)
    nearOpenDoor(x, z) {
      for (const d of api.doors) if (d.open > 0.5 && Math.hypot(x - d.center.x, z - d.center.z) < 1.3) return true;
      return false;
    },
    // можно ли перейти из (x0,z0) в (x1,z1): внутрь препятствия войти нельзя,
    // выйти (если оказались внутри — через дверь) можно
    canMove(x0, z0, x1, z1, y) {
      if (zoneFloor(x1, z1) !== null) return true;
      if (solid(x1, z1, y) && !solid(x0, z0, y)) {
        // в открытую дверь можно войти самому, пешком
        for (const d of api.doors) {
          if (d.open < 0.5) continue;
          const c = d.center;
          if (Math.hypot(x1 - c.x, z1 - c.z) < Math.max(0.9, d.w * 0.7) && Math.abs(c.y - d.h / 2 - (y === undefined ? c.y - d.h / 2 : y)) < 1.3) return true;
        }
        return false;
      }
      return true;
    },
    // пол под ногами; y — где ноги сейчас (выбирается поверхность, на которую можно встать)
    floorAt(x, z, y = Infinity) {
      const zf = zoneFloor(x, z);
      if (zf !== null) return zf;
      if (inGate(x, z) && z > G.backZ - 0.5 && z < B.zN + 0.5) return G.thresholdY;
      const I = interiorAt(x, z, -0.2);
      if (I && I.floorY !== undefined) return I.floorY;
      let best = terrain.heightAt(x, z);
      const st = stairAt(x, z);
      if (st !== null && st <= y + 0.7 && st > best) best = st;
      const wt = walkTop(x, z);
      if (wt !== null && wt <= y + 0.7 && wt > best) best = wt;
      return best;
    },
    solid,
  };
  return api;
}
