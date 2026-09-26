// Следы жизни: копоть на стене над каждым факелом и вытоптанная земля перед
// дверями. Это полупрозрачные «наклейки» (две сетки на всё), почти бесплатно.
import * as THREE from 'three';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);

function gradTexture(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createWear(scene, terrain, torchList, doorList) {
  // копоть: вытянутое вверх тёмное пятно с рваными краями
  const sootTex = gradTexture((x) => {
    const img = x.createImageData(64, 64);
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
      const u = (i - 32) / 32, v = j / 63; // v: 0 — верх, 1 — низ (у факела)
      const w = 0.35 + 0.65 * v;
      const edge = Math.max(0, 1 - Math.abs(u) / w);
      const n = 0.75 + 0.25 * Math.sin(i * 1.7 + j * 0.9) * Math.sin(j * 0.45 + i * 0.3);
      const a = Math.pow(edge, 1.5) * Math.pow(v, 0.6) * (1 - Math.pow(v, 6) * 0.6) * n;
      const k = (j * 64 + i) * 4;
      img.data[k] = 12; img.data[k + 1] = 9; img.data[k + 2] = 7; img.data[k + 3] = Math.min(255, a * 170);
    }
    x.putImageData(img, 0, 0);
  });
  const sootMat = new THREE.MeshBasicMaterial({ map: sootTex, transparent: true, depthWrite: false, fog: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const sg = new THREE.PlaneGeometry(0.75, 1.5);
  const sm = new THREE.InstancedMesh(sg, sootMat, Math.max(1, torchList.length));
  const q = new THREE.Quaternion();
  torchList.forEach(({ p, n }, i) => {
    q.setFromUnitVectors(new V3(0, 0, 1), n);
    sm.setMatrixAt(i, new THREE.Matrix4().compose(p.clone().addScaledVector(n, 0.012).addScaledVector(UP, 0.95), q, new V3(0.9 + Math.random() * 0.3, 1, 1)));
  });
  sm.count = torchList.length;
  sm.name = 'soot';
  scene.add(sm);

  // вытоптанная земля перед дверями: тёмное пятно, темнее посередине
  const dirtTex = gradTexture((x) => {
    const g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(40,30,20,0.55)'); g.addColorStop(0.6, 'rgba(45,34,22,0.3)'); g.addColorStop(1, 'rgba(50,38,25,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  });
  const dirtMat = new THREE.MeshBasicMaterial({ map: dirtTex, transparent: true, depthWrite: false, fog: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const dg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const doors = doorList.filter((d) => d.center && d.n);
  const dm = new THREE.InstancedMesh(dg, dirtMat, Math.max(1, doors.length));
  doors.forEach((d, i) => {
    const c = d.center.clone().addScaledVector(d.n, 1.0);
    const y = terrain.heightAt(c.x, c.z);
    if (Math.abs(y - (d.hinge ? d.hinge.y : y)) > 1.5) { dm.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); return; } // вход высоко над землёй
    const yaw = Math.atan2(d.n.x, d.n.z);
    dm.setMatrixAt(i, new THREE.Matrix4().compose(new V3(c.x, y + 0.04, c.z), new THREE.Quaternion().setFromAxisAngle(UP, yaw), new V3(d.w * 1.8 + 0.6, 1, 2.2)));
  });
  dm.count = doors.length;
  dm.name = 'trodden';
  scene.add(dm);
}
