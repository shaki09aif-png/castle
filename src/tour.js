// Экскурсия по замку: кнопки с точками обзора, плавный перелёт камеры
// и короткие исторические пояснения для доклада.
// Клавиши: 1–9, 0 — первые десять точек, ← → — предыдущая/следующая,
// T — автоэкскурсия, Esc — закрыть подпись.
import * as THREE from 'three';
import {
  HILL_TOP, GATEHOUSE, BARBICAN, KEEP, BUILDINGS, WELL, TOWERS,
} from './layout.js';
import { HALL } from './courtyard.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Точки строятся из планировки, поэтому остаются верными при её изменении.
function buildStops(terrain, village, extras) {
  const b = (id) => BUILDINGS.find((q) => q.id === id);
  // вид на постройку со стороны двора: камера отходит от фасада к центру
  const facing = (bld, dist, up, side = 0) => {
    const tgt = V(bld.x, terrain.heightAt(bld.x, bld.z) + 4, bld.z);
    const pos = V(
      bld.x + bld.nx * dist + bld.ax * side,
      0,
      bld.z + bld.nz * dist + bld.az * side
    );
    pos.y = terrain.heightAt(pos.x, pos.z) + up;
    return { tgt, pos };
  };
  // точка в системе координат постройки: lx — вдоль стены, lz — от фасада во двор, h — над землёй
  const local = (bld, lx, h, lz) => {
    const x = bld.x + bld.ax * lx + bld.nx * lz, z = bld.z + bld.az * lx + bld.nz * lz;
    return V(x, terrain.heightAt(x, z) + h, z);
  };
  const hall = b('hall'), chapel = b('chapel'), forge = b('forge'), stable = b('stable'), kitchen = b('kitchen');
  const bridge = village.bridge;
  const bm = bridge.a.clone().add(bridge.b).multiplyScalar(0.5);
  const mill = village.mill;
  const westTower = TOWERS.find((t) => t.deg === 190);
  const kg = terrain.heightAt(KEEP.x, KEEP.z);
  const barbZ = (BARBICAN.zN + BARBICAN.zS) / 2;

  return [
    {
      title: 'Замок на холме',
      text: 'Замок XIII века строили на высоком месте: с холма видно округу, а штурмовать его вверх по склону трудно. У подножия — деревня, поля и река, которые кормили замок.',
      tgt: V(0, HILL_TOP - 14, 20),
      pos: V(175, 150, 310),
    },
    {
      title: 'Дорога, мост и река',
      text: 'К замку ведёт одна дорога — серпантин по склону. Поворачивая, она подставляет защитникам правый бок нападающих, не прикрытый щитом. Мост через реку — единственная переправа поблизости.',
      tgt: V(bm.x, terrain.heightAt(bm.x, bm.z) + 2, bm.z),
      pos: V(bm.x + 55, terrain.heightAt(bm.x, bm.z) + 38, bm.z + 60),
    },
    {
      title: 'Барбакан и ров',
      text: 'Барбакан — передовое укрепление перед воротами. Враг, прорвавшийся в него, оказывался в тесном дворике под обстрелом со всех сторон. Дальше — ров с водой: его можно пересечь только по подъёмному мосту.',
      tgt: V(0, HILL_TOP - 2, (GATEHOUSE.z + barbZ) / 2),
      pos: V(34, HILL_TOP + 16, barbZ + 34),
    },
    {
      title: 'Надвратная башня',
      text: 'Ворота — самое уязвимое место, поэтому их защищали сильнее всего: подъёмный мост на цепях, опускная решётка (герса) и дубовые створки. Через машикули — отверстия в выступающем парапете — на врага бросали камни. Кнопка «Закрыть ворота» (G) покажет, как их запирали.',
      tgt: V(GATEHOUSE.x, HILL_TOP + 4, GATEHOUSE.z + 3),
      pos: V(GATEHOUSE.x + 7, HILL_TOP + 9, BARBICAN.zS - 2),
    },
    {
      title: 'Стены и башни',
      text: 'Стены с зубцами и деревянным боевым ходом. Башни выступают вперёд, чтобы стрелять вдоль стены по тем, кто подошёл к её подножию. Деревянные галереи-хурды нависают над стеной для того же.',
      tgt: V(westTower.x, HILL_TOP + 8, westTower.z),
      pos: V(westTower.x - 60, HILL_TOP + 22, westTower.z + 38),
    },
    {
      title: 'Двор замка',
      text: 'Во дворе шла повседневная жизнь: конюшня, кузница, казармы, склады и амбар. Колодец был важнее всего — без своей воды замок не выдержал бы осады.',
      tgt: V(WELL.x - 4, HILL_TOP + 2, WELL.z - 2),
      pos: V(WELL.x + 22, HILL_TOP + 14, WELL.z + 24),
    },
    {
      title: 'Рынок у ворот',
      text: 'В ярмарочные дни во двор пускали торговцев: хлеб, горшки, ткани, овощи, рыба. С каждого прилавка сеньор брал пошлину — это был важный доход замка.',
      tgt: V(-2, HILL_TOP + 1.2, 14.5),
      pos: V(10, HILL_TOP + 7.5, 4),
    },
    {
      title: 'Конюшня и скотный двор',
      text: 'Боевой конь рыцаря стоил как целая деревня, за лошадьми ухаживали конюхи. Рядом — свинарник и куры: мясо и яйца запасали на зиму и на случай осады.',
      tgt: local(stable, -0.5, 1.3, stable.W / 2 + 3.4),
      pos: local(stable, -6.5, 4.2, stable.W / 2 + 13),
    },
    {
      title: 'Кухня и поленница',
      text: 'Кухню ставили отдельно — из-за пожаров. Во дворе на треноге варили похлёбку. Дров замку требовалось очень много, поэтому у кухни всегда росла поленница.',
      tgt: local(kitchen, 0, 1.0, kitchen.W / 2 + 2.2),
      pos: local(kitchen, 2.5, 4.2, kitchen.W / 2 + 10.5),
    },
    {
      title: 'Кузница',
      text: 'Кузнец был одним из самых нужных людей в замке: ковал подковы, гвозди, петли и замки, чинил оружие и доспехи. Горн раздували мехами, раскалённое железо остужали в корыте с водой.',
      tgt: local(forge, -0.6, 1.1, forge.W / 2 + 0.6),
      pos: local(forge, 3.5, 3.4, forge.W / 2 + 8.5),
    },
    {
      title: 'Большой зал',
      text: 'Большой зал — сердце замковой жизни. Здесь сеньор пировал с рыцарями, принимал гостей, вершил суд. Рядом кухня: её ставили отдельно, чтобы при пожаре не сгорел зал.',
      ...facing(hall, 24, 9, 5),
    },
    ...(HALL.f ? [{
      title: 'В большом зале',
      text: 'Внутри — высокий стол сеньора на помосте, длинные столы для рыцарей, очаг посреди зала (дым уходил через дымник в крыше), гобелены на стенах. Здесь пировали, праздновали и вершили суд.',
      tgt: HALL.f.p(-5.8, HALL.floorY + 1.6, 0),
      pos: HALL.f.p(6.6, HALL.floorY + 3.0, 2.2),
    }] : []),
    {
      title: 'Часовня',
      text: 'В каждом замке была своя часовня. Её алтарь обращён на восток. Колокол созывал на службу и поднимал тревогу.',
      ...facing(chapel, 17, 6, 7),
    },
    {
      title: 'Донжон',
      text: 'Донжон — главная башня и последний рубеж обороны. Вход сделан на втором этаже: лестницу можно убрать или сломать. В нижнем этаже хранили припасы, выше жил сеньор.',
      tgt: V(KEEP.x, kg + 15, KEEP.z),
      pos: V(KEEP.x + 44, kg + 20, KEEP.z + 38),
    },
    {
      title: 'Деревня и мельница',
      text: 'Крестьяне жили у подножия в домах с соломенными крышами и работали на полях, поделённых на полосы. Водяная мельница принадлежала сеньору, и за помол платили ему.',
      tgt: V(mill.x, terrain.heightAt(mill.x, mill.z) + 3, mill.z),
      pos: V(mill.x + 38, terrain.heightAt(mill.x, mill.z) + 24, mill.z + 36),
    },
    ...(extras.camp ? [{
      title: 'Осадный лагерь',
      text: 'Замок редко брали штурмом — чаще осаждали. Враг ставил лагерь, строил требушет, метавший камни на сотни шагов, таран под навесом и лестницы, а сам лагерь прикрывал частоколом. Осада могла длиться месяцами.',
      tgt: V(0, 0, 0).copy(extras.camp.at(3, 2)).setY(extras.camp.gh(extras.camp.at(3, 2).x, extras.camp.at(3, 2).z) + 3),
      pos: V(0, 0, 0).copy(extras.camp.at(42, 20)).setY(extras.camp.gh(extras.camp.at(42, 20).x, extras.camp.at(42, 20).z) + 17),
    }] : []),
  ].map((s) => {
    // камера не должна оказаться под землёй
    const g = terrain.heightAt(s.pos.x, s.pos.z) + 1.5;
    if (s.pos.y < g) s.pos.y = g;
    return s;
  });
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createTour(camera, cam, terrain, village, extras = {}) {
  const stops = buildStops(terrain, village, extras);
  const panel = document.getElementById('tour');
  const list = document.getElementById('tour-list');
  const playBtn = document.getElementById('tour-play');
  const caption = document.getElementById('caption');
  const capTitle = document.getElementById('caption-title');
  const capText = document.getElementById('caption-text');
  const capNum = document.getElementById('caption-num');

  const buttons = stops.map((s, i) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.innerHTML = `<span>${i + 1}</span>${s.title}`;
    el.addEventListener('click', () => { stopAuto(); go(i); });
    list.appendChild(el);
    return el;
  });

  let flight = null; // текущий перелёт
  let current = -1;
  let auto = false, autoWait = 0;
  const AUTO_PAUSE = 9; // секунд на точке в автоэкскурсии

  function go(i) {
    if (cam.mode === 'fly') cam.setMode('orbit');
    current = i;
    const s = stops[i];
    const p0 = camera.position.clone();
    const t0 = cam.orbit.target.clone();
    const dist = p0.distanceTo(s.pos);
    // дуга вверх, чтобы не пролетать сквозь стены и холм
    const mid = p0.clone().lerp(s.pos, 0.5);
    mid.y = Math.max(p0.y, s.pos.y) + Math.min(90, dist * 0.35);
    flight = { p0, t0, mid, s, t: 0, dur: Math.min(4.5, Math.max(1.6, dist / 70)) };
    cam.orbit.enabled = false;
    buttons.forEach((b, k) => b.classList.toggle('active', k === i));
    capNum.textContent = `${i + 1} / ${stops.length}`;
    capTitle.textContent = s.title;
    capText.textContent = s.text;
    caption.classList.add('show');
  }

  function startAuto() {
    auto = true;
    playBtn.textContent = '■ Остановить';
    go(current < 0 || current >= stops.length - 1 ? 0 : current + 1);
  }
  function stopAuto() {
    auto = false;
    playBtn.textContent = '▶ Вся экскурсия';
  }
  playBtn.addEventListener('click', () => (auto ? stopAuto() : startAuto()));
  document.getElementById('caption-close').addEventListener('click', () => { caption.classList.remove('show'); stopAuto(); });
  document.getElementById('tour-toggle').addEventListener('click', () => panel.classList.toggle('collapsed'));
  // любое действие мышью на сцене прерывает автоэкскурсию
  document.querySelector('canvas')?.addEventListener('pointerdown', () => { if (auto && !flight) stopAuto(); });

  window.addEventListener('keydown', (e) => {
    if (cam.mode === 'fly' || e.repeat) return;
    if (/^Digit[0-9]$/.test(e.code)) {
      const n = Number(e.code.slice(5));
      const i = n === 0 ? 9 : n - 1;
      if (i < stops.length) { stopAuto(); go(i); }
    } else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
      const d = e.code === 'ArrowRight' ? 1 : -1;
      stopAuto();
      go((Math.max(current, 0) + d + stops.length) % stops.length);
    } else if (e.code === 'KeyT') {
      auto ? stopAuto() : startAuto();
    } else if (e.code === 'Escape') {
      caption.classList.remove('show');
      stopAuto();
    }
  });

  const a = new THREE.Vector3(), b = new THREE.Vector3();
  function update(dt) {
    if (flight) {
      const f = flight;
      f.t = Math.min(1, f.t + dt / f.dur);
      const k = ease(f.t);
      // квадратичная кривая Безье через приподнятую середину
      a.copy(f.p0).lerp(f.mid, k);
      b.copy(f.mid).lerp(f.s.pos, k);
      camera.position.copy(a.lerp(b, k));
      const g = terrain.heightAt(camera.position.x, camera.position.z) + 1.5;
      if (camera.position.y < g) camera.position.y = g;
      cam.orbit.target.copy(f.t0).lerp(f.s.tgt, ease(Math.min(1, f.t * 1.25)));
      camera.lookAt(cam.orbit.target);
      if (f.t >= 1) {
        flight = null;
        cam.orbit.enabled = true;
        cam.orbit.update();
        autoWait = AUTO_PAUSE;
      }
      return true; // камерой управляет экскурсия
    }
    if (auto) {
      autoWait -= dt;
      if (autoWait <= 0) {
        if (current < stops.length - 1) go(current + 1);
        else stopAuto();
      }
    }
    return false;
  }

  return { update, go, stops, get busy() { return !!flight; } };
}
