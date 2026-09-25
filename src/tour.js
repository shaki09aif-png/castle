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

  const P = extras.places || {};
  const G1 = 'Укрепления', G2 = 'Двор замка', G3 = 'Под землёй', G4 = 'Округа', G5 = 'События';
  return [
    // ======================= УКРЕПЛЕНИЯ =======================
    {
      group: G1, main: true,
      title: 'Замок на холме',
      text: 'Замок XIII века строили на высоком месте: с холма видно округу, а штурмовать его вверх по склону трудно. У подножия — деревня, поля и река, которые кормили замок.',
      tgt: V(0, HILL_TOP - 14, 20),
      pos: V(175, 150, 310),
    },
    {
      group: G1,
      title: 'Дорога, мост и река',
      text: 'К замку ведёт одна дорога — серпантин по склону. Поворачивая, она подставляет защитникам правый бок нападающих, не прикрытый щитом. Мост через реку — единственная переправа поблизости.',
      tgt: V(bm.x, terrain.heightAt(bm.x, bm.z) + 2, bm.z),
      pos: V(bm.x + 55, terrain.heightAt(bm.x, bm.z) + 38, bm.z + 60),
    },
    {
      group: G1, main: true,
      title: 'Барбакан и ворота',
      text: 'Барбакан — передовое укрепление перед воротами. Враг, прорвавшийся в него, оказывался в тесном дворике под обстрелом со всех сторон. Дальше — ров с водой: его можно пересечь только по подъёмному мосту.',
      tgt: V(0, HILL_TOP - 2, (GATEHOUSE.z + barbZ) / 2),
      pos: V(34, HILL_TOP + 16, barbZ + 34),
      then: [{
        wait: 6, dur: 3,
        title: 'Надвратная башня',
        text: 'Ворота — самое уязвимое место, поэтому их защищали сильнее всего: подъёмный мост на цепях, опускная решётка (герса) и дубовые створки. Через машикули на врага бросали камни. Кнопка «Закрыть ворота» (G) покажет, как их запирали.',
        tgt: V(GATEHOUSE.x, HILL_TOP + 4, GATEHOUSE.z + 3),
        pos: V(GATEHOUSE.x + 7, HILL_TOP + 9, BARBICAN.zS - 2),
      }],
    },
    {
      group: G1, main: true,
      title: 'Стены и башни',
      text: 'Стены с зубцами и деревянным боевым ходом. Башни выступают вперёд, чтобы стрелять вдоль стены по тем, кто подошёл к её подножию. Деревянные галереи-хурды нависают над стеной для того же.',
      tgt: V(westTower.x, HILL_TOP + 8, westTower.z),
      pos: V(westTower.x - 60, HILL_TOP + 22, westTower.z + 38),
    },
    {
      group: G1, main: true,
      title: 'Донжон',
      text: 'Донжон — главная башня и последний рубеж обороны. Вход сделан на втором этаже: лестницу можно убрать или сломать. В нижнем этаже хранили припасы, выше жил сеньор.',
      tgt: V(KEEP.x, kg + 15, KEEP.z),
      pos: V(KEEP.x + 44, kg + 20, KEEP.z + 38),
    },
    // ======================= ДВОР =======================
    {
      group: G2, main: true,
      title: 'Двор замка',
      text: 'Во дворе шла повседневная жизнь: конюшня, кузница, казармы, склады и амбар. Колодец был важнее всего — без своей воды замок не выдержал бы осады.',
      tgt: V(WELL.x - 4, HILL_TOP + 2, WELL.z - 2),
      pos: V(WELL.x + 22, HILL_TOP + 14, WELL.z + 24),
    },
    {
      group: G2,
      title: 'Рынок у ворот',
      text: 'В ярмарочные дни во двор пускали торговцев: хлеб, горшки, ткани, овощи, рыба. С каждого прилавка сеньор брал пошлину — это был важный доход замка.',
      tgt: V(-2, HILL_TOP + 1.2, 14.5),
      pos: V(10, HILL_TOP + 7.5, 4),
    },
    {
      group: G2,
      title: 'Конюшня и скотный двор',
      text: 'Боевой конь рыцаря стоил как целая деревня, за лошадьми ухаживали конюхи. Рядом — свинарник и куры: мясо и яйца запасали на зиму и на случай осады.',
      tgt: local(stable, -0.5, 1.3, stable.W / 2 + 3.4),
      pos: local(stable, -6.5, 4.2, stable.W / 2 + 13),
    },
    {
      group: G2,
      title: 'Кухня и кузница',
      text: 'Кухню ставили отдельно — из-за пожаров. Во дворе на треноге варили похлёбку. Дров замку требовалось очень много, поэтому у кухни всегда росла поленница.',
      tgt: local(kitchen, 0, 1.0, kitchen.W / 2 + 2.2),
      pos: local(kitchen, 2.5, 4.2, kitchen.W / 2 + 10.5),
      then: [{
        wait: 6, dur: 3,
        title: 'Кузница',
        text: 'Кузнец был одним из самых нужных людей в замке: ковал подковы, гвозди, петли и замки, чинил оружие и доспехи. Горн раздували мехами, раскалённое железо остужали в корыте с водой.',
        tgt: local(forge, -0.6, 1.1, forge.W / 2 + 0.6),
        pos: local(forge, 3.5, 3.4, forge.W / 2 + 8.5),
      }],
    },
    {
      group: G2, main: true,
      title: 'Большой зал',
      text: 'Большой зал — сердце замковой жизни. Здесь сеньор пировал с рыцарями, принимал гостей, вершил суд. Сейчас заглянем внутрь.',
      ...facing(hall, 24, 9, 5),
      ...(HALL.f ? { then: [{
        wait: 5, dur: 3,
        title: 'В большом зале',
        text: 'Внутри — высокий стол сеньора на помосте, длинные столы для рыцарей, очаг посреди зала (дым уходил через дымник в крыше), гобелены на стенах. Идёт пир: слуги несут блюда, играет менестрель.',
        tgt: HALL.f.p(-5.8, HALL.floorY + 1.6, 0),
        pos: HALL.f.p(6.6, HALL.floorY + 3.0, 2.2),
      }] } : {}),
    },
    {
      group: G2,
      title: 'Часовня, сад и кладбище',
      text: 'В каждом замке была своя часовня. Её алтарь обращён на восток. Колокол созывал на службу и поднимал тревогу.',
      ...facing(chapel, 17, 6, 7),
      ...(P.garden ? { then: [{
        wait: 6, dur: 3,
        title: 'Сад и кладбище',
        text: 'У часовни хоронили обитателей замка — под простыми каменными и деревянными крестами. Рядом разбивали сад: грядки с лекарственными травами, яблони и груши, ульи. Мёд был главной сладостью Средневековья.',
        ...P.garden,
      }] } : {}),
    },
    ...(P.training ? [{
      group: G2,
      title: 'Учения стражи',
      text: 'Стражники упражнялись каждый день: бились на мечах и стреляли из лука по соломенным мишеням. Опытный лучник выпускал до десяти стрел в минуту.',
      ...P.training,
      ...(P.falconer ? { then: [{
        wait: 6, dur: 3.5,
        title: 'Сокольничий на стене',
        text: 'Соколиная охота была любимой забавой знати. Птицу годами приучали возвращаться на кожаную перчатку хозяина. Хорошего охотничьего сокола ценили очень дорого — их дарили королям.',
        tgt: P.falconer.tgt, pos: P.falconer.pos,
      }] } : {}),
    }] : []),
    // ======================= ПОД ЗЕМЛЁЙ =======================
    ...(P.dungeon ? [{
      group: G3, main: true,
      title: 'Темница под донжоном',
      text: 'В подвале донжона хранили припасы, а часть отводили под темницу: узников держали за решёткой на соломе, иногда на цепи. Английское слово dungeon — «подземная тюрьма» — произошло как раз от французского «донжон».',
      tgt: P.dungeon.tgt, pos: P.dungeon.pos, under: true,
      limit: P.dungeon.limit,
      onEnter: () => { P.dungeon.grp.visible = true; },
      onLeave: () => { P.dungeon.grp.visible = false; },
    }] : []),
    ...(P.well ? (() => {
      const w = P.well, t = w.top;
      return [{
        group: G3,
        title: 'Колодец',
        text: 'Колодец — самое важное место при осаде: без воды замок не продержался бы и недели. Шахту пробивали в скале на десятки метров вниз, до воды. Ведро поднимали воротом. Сейчас мы спустимся внутрь.',
        tgt: V(WELL.x, t - 0.4, WELL.z),
        pos: V(WELL.x + 4.2, t + 2.4, WELL.z + 4.2),
        then: [
          { pos: V(WELL.x + 0.3, t + 0.45, WELL.z + 0.35), tgt: V(WELL.x - 0.1, t - 8, WELL.z - 0.1), dur: 2.2, wait: 2 },
          { pos: V(WELL.x + 0.3, t - 14, WELL.z + 0.3), tgt: V(WELL.x - 0.2, t - 26, WELL.z - 0.15), dur: 7, under: true },
        ],
        limit: w.limit,
        onEnter: () => { w.grp.visible = true; if (w.water) w.water.visible = false; },
        onLeave: () => { w.grp.visible = false; if (w.water) w.water.visible = true; },
      }];
    })() : []),
    ...(P.tunnel ? (() => {
      const T = P.tunnel;
      return [{
        group: G3,
        title: 'Потайной ход',
        text: 'По преданиям, из многих замков к реке вёл потайной ход. Через него тайно посылали гонца, носили воду или уходили при осаде. Вход снаружи прятали среди камней и кустов. Сейчас мы войдём внутрь.',
        ...T.outside,
        then: [{ ...T.inside, dur: 3.5, under: true, wait: 3 }],
        limit: T.limit,
        onEnter: () => { T.grp.visible = true; },
        onLeave: () => { T.grp.visible = false; },
      }];
    })() : []),
    // ======================= ОКРУГА =======================
    {
      group: G4, main: true,
      title: 'Деревня, мельница и прачки',
      text: 'Крестьяне жили у подножия в домах с соломенными крышами и работали на полях, поделённых на полосы. Водяная мельница принадлежала сеньору, и за помол платили ему.',
      tgt: V(mill.x, terrain.heightAt(mill.x, mill.z) + 3, mill.z),
      pos: V(mill.x + 38, terrain.heightAt(mill.x, mill.z) + 24, mill.z + 36),
      ...(P.washers ? { then: [{
        wait: 6, dur: 4,
        title: 'Прачки у реки',
        text: 'Бельё стирали в реке: замачивали, тёрли, отбивали деревянными вальками на мостках и сушили на верёвках и кустах. Вместо мыла часто брали щёлок — воду, настоянную на золе.',
        tgt: P.washers.tgt, pos: P.washers.pos,
      }] } : {}),
    },
    ...(extras.pasture ? [{
      group: G4,
      title: 'Пастбище',
      text: 'Коровы давали молоко, сыр и масло, быков запрягали в плуг. Скот пасли на общем лугу у деревни, за ним присматривал пастух. По реке рыбаки ходили на лодках — рыба была главной едой в постные дни.',
      tgt: extras.pasture.clone().setY(terrain.heightAt(extras.pasture.x, extras.pasture.z) + 1),
      pos: extras.pasture.clone().add(V(22, 0, 16)).setY(terrain.heightAt(extras.pasture.x + 22, extras.pasture.z + 16) + 9),
    }] : []),
    ...(P.vineyard ? [{
      group: G4,
      title: 'Виноградник',
      text: 'На солнечных склонах разводили виноград. Вино было нужно для церковной службы и для стола сеньора. Осенью урожай собирали в корзины и везли давить в больших чанах.',
      tgt: P.vineyard.tgt, pos: P.vineyard.pos,
    }] : []),
    ...(P.quarry ? [{
      group: G4,
      title: 'Каменоломня',
      text: 'Камень для стен добывали поблизости — возить его издалека было слишком дорого. Каменотёсы откалывали блоки кирками и клиньями, обтёсывали их, тяжёлые камни поднимали деревянным краном и везли на волах.',
      tgt: P.quarry.tgt, pos: P.quarry.pos,
    }] : []),
    // ======================= СОБЫТИЯ =======================
    ...(extras.camp ? [{
      group: G5, main: true,
      title: 'Осадный лагерь',
      text: 'Замок редко брали штурмом — чаще осаждали. Враг ставил лагерь, строил требушет, метавший камни на сотни шагов, таран под навесом и лестницы, а сам лагерь прикрывал частоколом. Осада могла длиться месяцами.',
      tgt: V(0, 0, 0).copy(extras.camp.at(3, 2)).setY(extras.camp.gh(extras.camp.at(3, 2).x, extras.camp.at(3, 2).z) + 3),
      pos: V(0, 0, 0).copy(extras.camp.at(42, 20)).setY(extras.camp.gh(extras.camp.at(42, 20).x, extras.camp.at(42, 20).z) + 17),
    }] : []),
    ...(extras.siege ? [{
      group: G5, main: true,
      title: 'Под стенами при штурме',
      text: 'Нажмите «Штурм» (B): требушет бросает камни в стену, со стен отвечают лучники, из машикулей над воротами льют кипящую смолу. Толстые стены из камня выдерживали много таких ударов.',
      tgt: extras.siege.target.clone().setY(extras.siege.target.y + 2),
      pos: extras.siege.target.clone().addScaledVector(extras.siege.toCamp, 38).add(V(12, 0, 0)).setY(extras.siege.target.y + 10),
    }] : []),
    ...(extras.tourney ? [{
      group: G5,
      title: 'Рыцарский турнир',
      text: 'На турнирах рыцари упражнялись и показывали силу: двое всадников с копьями мчались навстречу вдоль барьера и старались выбить друг друга из седла. Зрители сидели на трибунах, знатные дамы вручали награды.',
      tgt: extras.tourney.clone().setY(terrain.heightAt(extras.tourney.x, extras.tourney.z) + 1.5),
      pos: extras.tourney.clone().add(V(-6, 0, -34)).setY(terrain.heightAt(extras.tourney.x - 6, extras.tourney.z - 34) + 11),
    }] : []),
    ...(extras.ruinsCtl ? [{
      group: G5, main: true,
      title: 'Замок сегодня',
      text: 'Так выглядят многие замки через семьсот лет: крыши и деревянные постройки сгорели или сгнили, камень растащили на стройки, стены заросли мхом. Но толстые каменные стены и башни стоят до сих пор.',
      tgt: V(0, HILL_TOP + 4, 4),
      pos: V(92, HILL_TOP + 42, 118),
      onEnter: () => extras.ruinsCtl.enter(),
      onLeave: () => extras.ruinsCtl.leave(),
    }] : []),
  ].map((s) => {
    // камера не должна оказаться под землёй
    const g = terrain.heightAt(s.pos.x, s.pos.z) + 1.5;
    if (s.pos.y < g && !s.under) s.pos.y = g;
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

  // список разбит на разделы; открыт только раздел текущей точки
  const groups = new Map();
  const openGroup = (name) => { for (const [n, g] of groups) { g.box.classList.toggle('open', n === name); g.head.classList.toggle('open', n === name); } };
  const buttons = stops.map((s, i) => {
    const gname = s.group || 'Экскурсия';
    if (!groups.has(gname)) {
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'tour-group';
      const box = document.createElement('div');
      box.className = 'tour-sec';
      head.addEventListener('click', () => { const was = box.classList.contains('open'); openGroup(was ? null : gname); });
      list.appendChild(head);
      list.appendChild(box);
      groups.set(gname, { head, box, n: 0 });
    }
    const g = groups.get(gname);
    g.n++;
    g.head.innerHTML = `${gname}<em>${g.n}</em>`;
    const el = document.createElement('button');
    el.type = 'button';
    el.innerHTML = `<span>${i + 1}</span>${s.title}`;
    el.addEventListener('click', () => { stopAuto(); go(i); });
    g.box.appendChild(el);
    return el;
  });
  openGroup(stops[0].group);
  const order = stops.map((_, i) => i);

  let flight = null; // текущий перелёт
  let current = -1;
  let auto = false, autoWait = 0;
  const AUTO_PAUSE = 9; // секунд на точке в автоэкскурсии

  function go(i) {
    if (cam.mode === 'fly') cam.setMode('orbit');
    cam.limit = null;
    if (current >= 0 && current !== i && stops[current].onLeave) stops[current].onLeave();
    current = i;
    if (stops[i].onEnter) stops[i].onEnter();
    const s = stops[i];
    const p0 = camera.position.clone();
    const t0 = cam.orbit.target.clone();
    const dist = p0.distanceTo(s.pos);
    // дуга вверх, чтобы не пролетать сквозь стены и холм
    const mid = p0.clone().lerp(s.pos, 0.5);
    mid.y = Math.max(p0.y, s.pos.y) + Math.min(90, dist * 0.35);
    flight = { p0, t0, mid, s, dest: s, seg: 0, t: 0, dur: Math.min(4.5, Math.max(1.6, dist / 70)) };
    cam.orbit.enabled = false;
    buttons.forEach((b, k) => b.classList.toggle('active', k === i));
    openGroup(s.group);
    capNum.textContent = `${i + 1} / ${stops.length}`;
    capTitle.textContent = s.title;
    capText.textContent = s.text;
    caption.classList.add('show');
  }

  // автоэкскурсия: коротко (главные точки, для доклада) или полностью
  // автоэкскурсия по всем точкам подряд
  function startAuto() {
    auto = true;
    playBtn.textContent = '■ Остановить';
    const pos = order.indexOf(current);
    go(order[pos < 0 || pos >= order.length - 1 ? 0 : pos + 1]);
  }
  function stopAuto() {
    auto = false;
    playBtn.textContent = '▶ Экскурсия';
  }
  playBtn.addEventListener('click', () => (auto ? stopAuto() : startAuto()));
  const leaveCurrent = () => { cam.limit = null; flight = null; cam.orbit.enabled = true; if (current >= 0 && stops[current].onLeave) stops[current].onLeave(); current = -1; };
  document.getElementById('caption-close').addEventListener('click', () => { caption.classList.remove('show'); stopAuto(); leaveCurrent(); });
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
      leaveCurrent();
      caption.classList.remove('show');
      stopAuto();
    }
  });

  const a = new THREE.Vector3(), b = new THREE.Vector3();
  function update(dt) {
    if (flight) {
      const f = flight;
      if (f.wait > 0) { f.wait -= dt; return true; }
      if (f.shown === false) {
        f.shown = true;
        if (f.dest.title) { capTitle.textContent = f.dest.title; capText.textContent = f.dest.text || ''; }
      }
      f.t = Math.min(1, f.t + dt / f.dur);
      const k = ease(f.t);
      // квадратичная кривая Безье через приподнятую середину
      if (f.mid) {
        a.copy(f.p0).lerp(f.mid, k);
        b.copy(f.mid).lerp(f.dest.pos, k);
        camera.position.copy(a.lerp(b, k));
      } else camera.position.copy(f.p0).lerp(f.dest.pos, k); // спуск/вход — по прямой
      const g = terrain.heightAt(camera.position.x, camera.position.z) + 1.5;
      if (camera.position.y < g && !f.dest.under && !(f.mid && f.t > 0.6 && f.dest.under)) camera.position.y = g;
      cam.orbit.target.copy(f.t0).lerp(f.dest.tgt, f.mid ? ease(Math.min(1, f.t * 1.25)) : k);
      camera.lookAt(cam.orbit.target);
      if (f.t >= 1) {
        const next = f.s.then && f.s.then[f.seg];
        if (next) {
          // следующий участок: сначала пауза на прежнем виде, потом плавный переход
          flight = { p0: camera.position.clone(), t0: cam.orbit.target.clone(), mid: null, s: f.s, dest: next, seg: f.seg + 1, t: 0, dur: next.dur || 2, wait: next.wait || 0, shown: false };
          return true;
        }
        if (f.s.limit) cam.limit = f.s.limit;
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
        const pos = order.indexOf(current);
        if (pos >= 0 && pos < order.length - 1) go(order[pos + 1]);
        else stopAuto();
      }
    }
    return false;
  }

  return { update, go, stops, get busy() { return !!flight; } };
}
