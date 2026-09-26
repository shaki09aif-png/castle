// Погода: ясно, дождь, туман, снег. Капли и снежинки — частицы в коробке вокруг
// камеры (движение считает шейдер), после дождя на мостовой остаются лужи,
// снег постепенно ложится на крыши и землю, ров и река замерзают.
import * as THREE from 'three';
import { AUTUMN } from './materials.js';
import { SWAY_TIME } from './people.js';

// Сила ветра по погоде: флаги, дым и деревья колышутся быстрее в непогоду
export const WIND_K = { value: 1 };
const WIND_BY = { clear: 1, rain: 2.3, fog: 0.4, snow: 1.6, autumn: 1.7 };

const BOX = new THREE.Vector3(70, 45, 70);

function precipitation(count, isSnow) {
  const off = [], end = [];
  const rnd = Math.random;
  for (let i = 0; i < count; i++) {
    const x = rnd() * BOX.x, y = rnd() * BOX.y, z = rnd() * BOX.z, s = rnd();
    if (isSnow) { off.push(x, y, z, s); end.push(0); }
    else { off.push(x, y, z, s, x, y, z, s); end.push(0, 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(end.length * 3), 3));
  g.setAttribute('aOff', new THREE.Float32BufferAttribute(off, 4));
  g.setAttribute('aEnd', new THREE.Float32BufferAttribute(end, 1));
  const uniforms = {
    uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: BOX.clone() },
    uAlpha: { value: 0 }, uPx: { value: 1 },
  };
  const vs = /* glsl */ `
    attribute vec4 aOff;
    attribute float aEnd;
    uniform float uTime, uPx;
    uniform vec3 uCam, uBox;
    varying float vA;
    void main() {
      vec3 p = aOff.xyz;
      ${isSnow
        ? 'p.y -= uTime * (1.1 + aOff.w * 0.8); p.x += sin(uTime * 0.7 + aOff.w * 30.0) * 1.2 + uTime * 0.6; p.z += cos(uTime * 0.5 + aOff.w * 20.0) * 1.0;'
        : 'p.y -= uTime * (17.0 + aOff.w * 5.0); p.x += uTime * 2.2;'}
      p = mod(p - uCam + uBox * 0.5, uBox) + uCam - uBox * 0.5;
      ${isSnow ? '' : 'p -= aEnd * vec3(0.12, 0.75 + aOff.w * 0.3, 0.0);'}
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      // вдали частицы бледнее
      vA = 1.0 - smoothstep(18.0, 34.0, length(p - uCam));
      ${isSnow ? 'gl_PointSize = uPx * (0.06 + aOff.w * 0.05) * 600.0 / -mv.z;' : ''}
    }`;
  const fs = /* glsl */ `
    uniform float uAlpha;
    varying float vA;
    void main() {
      ${isSnow
        ? 'vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard; gl_FragColor = vec4(vec3(0.95, 0.97, 1.0), uAlpha * vA * smoothstep(0.5, 0.2, d));'
        : 'gl_FragColor = vec4(0.72, 0.76, 0.82, uAlpha * vA * 0.45);'}
    }`;
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false });
  const obj = isSnow ? new THREE.Points(g, mat) : new THREE.LineSegments(g, mat);
  obj.frustumCulled = false;
  obj.visible = false;
  obj.renderOrder = 20;
  obj.name = isSnow ? 'snow' : 'rain';
  return { obj, uniforms };
}

export function createWeather(scene, lighting, { paveMask, heightAt, renderer, road = [] }) {
  const rain = precipitation(5000, false);
  const snow = precipitation(3500, true);
  snow.uniforms.uPx.value = renderer.getPixelRatio();
  scene.add(rain.obj, snow.obj);

  // лужи на мостовой двора (видны, пока земля мокрая)
  const puddles = [];
  for (let k = 0; k < 400 && puddles.length < 34; k++) {
    const x = (Math.random() - 0.5) * 70, z = (Math.random() - 0.5) * 70;
    if (paveMask(x, z) > 0.7) puddles.push([x, z]);
  }
  // лужи и на дороге (в колеях), кроме моста
  for (let k = 0; k < road.length && puddles.length < 110; k += 3) {
    const q = road[k];
    if (q.bridge || Math.random() < 0.35) continue;
    const nx = road[Math.min(road.length - 1, k + 1)].x - q.x, nz = road[Math.min(road.length - 1, k + 1)].z - q.z;
    const L = Math.hypot(nx, nz) || 1;
    const o = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.7);
    puddles.push([q.x - (nz / L) * o, q.z + (nx / L) * o]);
  }
  // неровный край лужи
  const pg = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  { const p = pg.getAttribute('position'); for (let i = 1; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)); const k = 1 + 0.18 * Math.sin(a * 3 + 1.3) + 0.1 * Math.sin(a * 7); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } }
  // вода в лужах отражает небо; по ней расходятся круги от капель
  const pMat = new THREE.MeshStandardMaterial({ color: 0x3a4248, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, envMap: lighting.envTex, envMapIntensity: 1.3 });
  const pU = { uRain: { value: 0 }, uIce: { value: 0 } };
  pMat.onBeforeCompile = (sh) => {
    sh.uniforms.uSwayTime = SWAY_TIME; sh.uniforms.uRain = pU.uRain; sh.uniforms.uIce = pU.uIce;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvPW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uSwayTime, uRain, uIce;
      varying vec3 vPW;
      float pH(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      vec2 ripples(vec2 p, float t) {
        vec2 g = vec2(0.0);
        for (int k = 0; k < 2; k++) {
          vec2 q = p * (3.0 + float(k) * 1.7) + float(k) * 7.3;
          vec2 c = floor(q), f = fract(q) - 0.5;
          float h = pH(c + float(k));
          vec2 d = f - (vec2(pH(c + 3.1), pH(c + 5.7)) - 0.5) * 0.6;
          float ph = fract(t * (0.8 + h * 0.6) + h);
          float r = length(d), w = r - ph * 0.45;
          float a = sin(w * 55.0) * exp(-abs(w) * 18.0) * (1.0 - ph) * step(0.35, fract(h * 7.1));
          g += normalize(d + 1e-4) * a;
        }
        return g;
      }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 rp = ripples(vPW.xz, uSwayTime) * 0.35 * uRain * (1.0 - uIce);
          normal = normalize(normal + (viewMatrix * vec4(rp.x, 0.0, rp.y, 0.0)).xyz);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.35, uIce);')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72, 0.8, 0.86), uIce);');
  };
  pMat.customProgramCacheKey = () => 'puddle';
  const pm = new THREE.InstancedMesh(pg, pMat, Math.max(1, puddles.length));
  puddles.forEach(([x, z], i) => {
    const s = 0.5 + Math.random() * 1.1;
    pm.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(x, heightAt(x, z) + 0.05, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 3), new THREE.Vector3(s * 1.4, 1, s)));
  });
  pm.count = puddles.length;
  pm.visible = false;
  pm.layers.set(1);
  scene.add(pm);

  // лёд вместо воды во рву и реке (для снега)
  const ices = [];
  scene.traverse((o) => {
    if ((o.name === 'river' || o.name === 'moat') && o.isMesh) {
      const ice = new THREE.Mesh(o.geometry, new THREE.MeshStandardMaterial({ color: 0xc8d4dc, roughness: 0.35, metalness: 0.05 }));
      ice.position.copy(o.position); ice.rotation.copy(o.rotation); ice.scale.copy(o.scale);
      ice.position.y += 0.02;
      ice.receiveShadow = true;
      ice.visible = false;
      ice.name = 'ice';
      scene.add(ice);
      ices.push({ ice, water: o });
    }
  });

  const ORDER = ['clear', 'rain', 'fog', 'snow', 'autumn'];
  let mode = 'clear';
  let wet = 0, snowAmt = 0, rainA = 0, snowA = 0, iceLeft = 0;
  function setMode(m) {
    if (!ORDER.includes(m)) return;
    mode = m;
    lighting.setWeather(m);
  }
  return {
    get mode() { return mode; },
    setMode,
    next() { setMode(ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]); return mode; },
    update(t, dt, camera) {
      // интенсивность осадков, влажность и снежный покров меняются плавно
      rainA += ((mode === 'rain' ? 1 : 0) - rainA) * Math.min(1, dt * 0.8);
      snowA += ((mode === 'snow' ? 1 : 0) - snowA) * Math.min(1, dt * 0.8);
      wet = mode === 'rain' ? Math.min(1, wet + dt / 12) : Math.max(0, wet - dt / 45);
      snowAmt = mode === 'snow' ? Math.min(1, snowAmt + dt / 15) : Math.max(0, snowAmt - dt / 10);
      lighting.setSurface(wet * (1 - snowAmt), snowAmt);
      AUTUMN.value += ((mode === 'autumn' ? 1 : 0) - AUTUMN.value) * Math.min(1, dt * 0.4);
      WIND_K.value += ((WIND_BY[mode] || 1) - WIND_K.value) * Math.min(1, dt * 0.5);
      for (const [p, a] of [[rain, rainA], [snow, snowA]]) {
        p.obj.visible = a > 0.02;
        p.uniforms.uAlpha.value = a;
        p.uniforms.uTime.value = t;
        p.uniforms.uCam.value.copy(camera.position);
      }
      // лужи: при снеге замерзают (лёд), высыхают медленно
      pm.visible = wet > 0.03 || (snowAmt > 0.2 && iceLeft > 0.03);
      if (mode === 'rain') iceLeft = wet;
      pU.uIce.value = Math.min(1, snowAmt * 2);
      pU.uRain.value = rainA;
      pMat.opacity = snowAmt > 0.2 ? 0.85 * Math.min(1, iceLeft * 2) : 0.8 * wet;
      const frozen = snowAmt > 0.5;
      for (const { ice, water } of ices) { ice.visible = frozen; water.visible = !frozen; }
    },
  };
}
