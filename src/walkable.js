// Хождение пешком (режим от первого лица): где можно стоять и куда нельзя пройти.
// Без тяжёлых лучей по сеткам — только по плану замка: здания, башни, стена,
// проход ворот и мост, полы домов и подземный ход.
import { insideBuilding, insideTower, GATE_PASSAGE, GATEHOUSE, BARBICAN, WALL } from './layout.js';
import { INTERIORS } from './courtyard.js';

export function createWalkable(terrain, walls, zones = []) {
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
  // стена: расстояние до осевой линии меньше половины толщины (кроме ворот)
  const halfT = WALL.thickness / 2 + 0.35;
  const nearWall = (x, z) => {
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      const ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
      if (Math.hypot(x - (a.x + ex * t), z - (a.z + ez * t)) < halfT) return true;
    }
    return false;
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
  const solid = (x, z) => {
    if (inGate(x, z)) return false;
    return !!(insideBuilding(x, z, 0.3) || insideTower(x, z, 0.3) || interiorAt(x, z, 0.3) || nearWall(x, z) || nearBarbican(x, z));
  };
  const zoneFloor = (x, z) => {
    for (const zz of zones) if (zz.floorAt) { const f = zz.floorAt(x, z); if (f !== null && f !== undefined) return f; }
    return null;
  };
  return {
    // можно ли перейти из (x0,z0) в (x1,z1): внутрь препятствия войти нельзя,
    // выйти (если оказались внутри — через дверь) можно
    canMove(x0, z0, x1, z1) {
      if (zoneFloor(x1, z1) !== null) return true;
      if (solid(x1, z1) && !solid(x0, z0)) return false;
      return true;
    },
    floorAt(x, z) {
      const zf = zoneFloor(x, z);
      if (zf !== null) return zf;
      if (inGate(x, z) && z > G.backZ - 0.5 && z < B.zN + 0.5) return G.thresholdY;
      const I = interiorAt(x, z, -0.2);
      if (I && I.floorY !== undefined) return I.floorY;
      return terrain.heightAt(x, z);
    },
    solid,
  };
}
