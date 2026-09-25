// Подписи на карте: когда камера поднимается высоко над округой, над главными
// местами появляются названия (замок, деревня, мельница, мост, лагерь и т. д.).
import * as THREE from 'three';
import { riverZ } from './layout.js';

export function createLabels(camera, { village, extras, terrain }) {
  const places = [{ name: 'Замок', p: new THREE.Vector3(0, 125, 0) }];
  if (village) {
    const br = village.bridge;
    places.push({ name: 'Мост', p: br.a.clone().lerp(br.b, 0.5).setY(12) });
    if (village.mill) places.push({ name: 'Мельница', p: village.mill.clone().setY(16) });
    if (village.houses && village.houses.length) {
      const c = new THREE.Vector3();
      for (const h of village.houses) c.add(h.f.C);
      c.divideScalar(village.houses.length).setY(20);
      places.push({ name: 'Деревня', p: c });
    }
    const rx = br.a.x + 140;
    places.push({ name: 'Река', p: new THREE.Vector3(rx, 6, riverZ(rx)) });
  }
  if (extras.camp) places.push({ name: 'Осадный лагерь', p: new THREE.Vector3(extras.camp.x, 18, extras.camp.z) });
  if (extras.pasture) places.push({ name: 'Пастбище', p: extras.pasture.clone().setY(12) });
  if (extras.tourney) places.push({ name: 'Турнир', p: extras.tourney.clone().setY(14) });

  const root = document.createElement('div');
  root.id = 'map-labels';
  Object.assign(root.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 4, opacity: 0, transition: 'opacity 0.6s' });
  document.body.appendChild(root);
  const els = places.map((pl) => {
    const e = document.createElement('div');
    e.textContent = pl.name;
    Object.assign(e.style, {
      position: 'absolute', transform: 'translate(-50%, -100%)', color: '#fff', font: '15px Georgia, serif',
      textShadow: '0 1px 3px #000, 0 0 8px rgba(0,0,0,0.7)', whiteSpace: 'nowrap', padding: '2px 8px',
      borderBottom: '1px solid rgba(255,217,138,0.8)',
    });
    root.appendChild(e);
    return e;
  });
  const v = new THREE.Vector3();
  let shown = false;
  return {
    update() {
      // подписи видны, когда камера высоко или далеко от замка
      const above = camera.position.y - (terrain ? terrain.heightAt(camera.position.x, camera.position.z) : 0);
      const far = above > 150 || Math.hypot(camera.position.x, camera.position.z) > 700;
      if (far !== shown) { shown = far; root.style.opacity = far ? 1 : 0; }
      if (!far) return;
      const w = window.innerWidth, h = window.innerHeight;
      places.forEach((pl, i) => {
        v.copy(pl.p).project(camera);
        const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
        els[i].style.display = vis ? 'block' : 'none';
        if (vis) { els[i].style.left = ((v.x + 1) / 2) * w + 'px'; els[i].style.top = ((1 - v.y) / 2) * h + 'px'; }
      });
    },
  };
}
