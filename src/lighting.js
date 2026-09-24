// Небо, солнце с мягкими тенями, окружающее освещение из HDRI,
// объёмный (высотный) туман с подсветкой от солнца и дымка у горизонта.
import * as THREE from 'three';
import { Q } from './quality.js';

// Направление на солнце: послеполуденное, с юго-запада.
// Если загружена HDRI неба с Poly Haven, направление берётся из неё.
export const SUN_DIR = new THREE.Vector3(-0.62, 0.6, 0.5).normalize();
export const SUN_COLOR = new THREE.Color(1.0, 0.93, 0.82);

const HORIZON = new THREE.Color(0.6, 0.68, 0.78);
const ZENITH = new THREE.Color(0.12, 0.28, 0.6);

// ---------------------------------------------------------------------------
// Объёмный туман: плотность убывает с высотой, в сторону солнца туман
// подсвечивается тёплым светом, вдали — голубоватая воздушная дымка.
// Заменяем стандартные фрагменты шейдеров Three.js, поэтому эффект
// применяется ко всем материалам (рельеф, стены, вода, трава).
// ---------------------------------------------------------------------------
export const FOG = {
  density: 0.0014, // плотность у земли
  base: 0, // высота, от которой считается плотность
  falloff: 0.03, // как быстро туман редеет с высотой
  haze: 0.00007, // воздушная перспектива (не зависит от высоты)
};

function installFogChunks() {
  const v3 = (v) => `vec3(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`;
  const c3 = (c) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
  THREE.ShaderChunk.fog_pars_vertex = `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif`;
  THREE.ShaderChunk.fog_vertex = `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorldPos = cameraPosition + ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  vec3 castleFog( vec3 col, vec3 wp ) {
    vec3 ray = wp - cameraPosition;
    float dist = length( ray );
    vec3 dir = ray / max( dist, 1e-4 );
    const float k = ${FOG.falloff.toFixed(5)};
    float camH = max( cameraPosition.y - ${FOG.base.toFixed(2)}, -50.0 );
    float dy = ray.y;
    float integ = abs( dy ) > 0.05 ? exp( -k * camH ) * ( 1.0 - exp( -k * dy ) ) / ( k * dy ) : exp( -k * camH );
    #ifdef FOG_EXP2
      float dens = fogDensity;
    #else
      float dens = ${FOG.density.toFixed(5)};
    #endif
    float optical = dens * dist * integ + dist * ${FOG.haze.toFixed(6)};
    float f = 1.0 - exp( -optical );
    float sunAmt = pow( max( dot( dir, ${v3(SUN_DIR)} ), 0.0 ), 6.0 );
    vec3 fc = mix( fogColor, ${c3(SUN_COLOR)} * 1.25, sunAmt * 0.55 );
    return mix( col, fc, clamp( f, 0.0, 1.0 ) );
  }
#endif`;
  THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  gl_FragColor.rgb = castleFog( gl_FragColor.rgb, vFogWorldPos );
#endif`;
}

// ---------------------------------------------------------------------------
// Процедурное небо (используется, если нет HDRI неба)
// ---------------------------------------------------------------------------
const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 sunDir;
  uniform vec3 horizon;
  uniform vec3 zenith;
  uniform vec3 sunColor;
  uniform float time;
  uniform float cloudCover;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 6; i++) { s += a * noise(p); p = r * p * 2.03; a *= 0.5; }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float sd = max(dot(d, sunDir), 0.0);
    // рэлеевский градиент + ми-рассеяние вокруг солнца
    vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.45));
    col += sunColor * (pow(sd, 5.0) * 0.22 + pow(sd, 48.0) * 0.5 + pow(sd, 600.0) * 2.0);
    col = mix(col, horizon * 0.95, smoothstep(0.0, -0.1, h));
    if (h > 0.0) {
      vec2 uv = d.xz / (h + 0.1) * 1.3;
      vec2 wind = vec2(time * 0.004, time * 0.0015);
      float c = fbm(uv + wind);
      float c2 = fbm(uv * 3.1 - wind * 1.7 + 3.0);
      float dens = c * 0.78 + c2 * 0.3;
      float cov = smoothstep(1.0 - cloudCover, 1.0 - cloudCover + 0.28, dens);
      // самозатенение облака: сэмпл в сторону солнца
      float cs = fbm(uv + wind + sunDir.xz * 0.1) * 0.78 + c2 * 0.3;
      float lit = clamp(0.62 + (dens - cs) * 3.5, 0.0, 1.0);
      vec3 cloudCol = mix(vec3(0.46, 0.5, 0.58), vec3(1.12, 1.08, 1.02), lit);
      cloudCol += sunColor * pow(sd, 6.0) * 0.6 * (1.0 - cov * 0.5); // серебристая кромка
      cov *= smoothstep(0.0, 0.2, h);
      col = mix(col, cloudCol, cov * 0.93);
    }
    col += sunColor * smoothstep(0.99945, 0.99975, sd) * 30.0; // солнечный диск
    col = mix(col, horizon, (1.0 - smoothstep(0.0, 0.14, abs(h))) * 0.55);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function makeSkyMesh() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      sunDir: { value: SUN_DIR.clone() },
      horizon: { value: HORIZON.clone() },
      zenith: { value: ZENITH.clone() },
      sunColor: { value: SUN_COLOR.clone() },
      time: { value: 0 },
      cloudCover: { value: 0.5 },
    },
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  return mesh;
}

// Направление на солнце в равнопромежуточной HDRI (самый яркий пиксель верхней половины).
function hdriSunDirection(tex) {
  const { width: w, height: h, data } = tex.image;
  const half = data instanceof Uint16Array;
  const get = (i) => (half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
  let best = -1, bi = 0;
  for (let y = 0; y < h / 2; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = get(i) + get(i + 1) + get(i + 2);
      if (l > best) { best = l; bi = y * w + x; }
    }
  }
  const x = bi % w, y = Math.floor(bi / w);
  const el = (0.5 - (y + 0.5) / h) * Math.PI;
  const az = ((x + 0.5) / w - 0.5) * Math.PI * 2;
  return new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
}

// Средний цвет неба у горизонта (2–8° над ним) — для цвета дымки
function hdriHorizonColor(tex) {
  const { width: w, height: h, data } = tex.image;
  const half = data instanceof Uint16Array;
  const get = (i) => Math.min(4, half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
  const c = new THREE.Color(0, 0, 0);
  let n = 0;
  const y0 = Math.floor(h * (0.5 - 8 / 180)), y1 = Math.floor(h * (0.5 - 2 / 180));
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < w; x += 4) {
      const i = (y * w + x) * 4;
      c.r += get(i); c.g += get(i + 1); c.b += get(i + 2);
      n++;
    }
  }
  return c.multiplyScalar(0.9 / Math.max(1, n));
}

// Погасить солнце в HDRI окружения: его заменяет направленный свет с тенями.
function clampHdri(tex, maxV) {
  const d = tex.image.data;
  for (let i = 0; i < d.length; i += 4) {
    const m = Math.max(d[i], d[i + 1], d[i + 2]);
    if (m > maxV) {
      const k = maxV / m;
      d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
    }
  }
  tex.needsUpdate = true;
}

export function createLighting(scene, renderer, assets) {
  // 1) Небо: HDRI Poly Haven (если скачана) или процедурное
  let sky = null;
  if (assets.sky) {
    assets.sky.mapping = THREE.EquirectangularReflectionMapping;
    SUN_DIR.copy(hdriSunDirection(assets.sky));
    if (SUN_DIR.y < 0.25) SUN_DIR.y = 0.25; // слишком низкое солнце даёт очень длинные тени
    SUN_DIR.normalize();
    scene.background = assets.sky;
  } else {
    sky = makeSkyMesh();
    scene.add(sky);
  }

  installFogChunks();
  scene.fog = new THREE.FogExp2(HORIZON.clone().multiplyScalar(0.95), FOG.density);
  if (assets.sky) scene.fog.color.copy(hdriHorizonColor(assets.sky)); // дымка в цвет горизонта HDRI

  // 2) Окружающее освещение: HDRI → PMREM
  const pmrem = new THREE.PMREMGenerator(renderer);
  if (assets.sky) {
    scene.environment = pmrem.fromEquirectangular(assets.sky).texture;
  } else if (assets.env) {
    const envSun = hdriSunDirection(assets.env);
    clampHdri(assets.env, 6);
    assets.env.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pmrem.fromEquirectangular(assets.env).texture;
    // поворачиваем карту так, чтобы её светлая сторона совпала с нашим солнцем
    const a0 = Math.atan2(envSun.z, envSun.x);
    const a1 = Math.atan2(SUN_DIR.z, SUN_DIR.x);
    scene.environmentRotation = new THREE.Euler(0, a0 - a1, 0);
  } else {
    const envScene = new THREE.Scene();
    envScene.add(makeSkyMesh());
    scene.environment = pmrem.fromScene(envScene, 0.02, 1, 2000).texture;
  }
  scene.environmentIntensity = 1.0;
  pmrem.dispose();

  // 3) Солнце. Теневая «коробка» следует за точкой, на которую смотрит камера,
  // и сжимается при приближении — вблизи тени получаются чёткими.
  const sun = new THREE.DirectionalLight(SUN_COLOR, 3.2);
  const target = new THREE.Object3D();
  scene.add(target);
  sun.target = target;
  sun.castShadow = true;
  sun.shadow.mapSize.set(Q.shadowMapSize, Q.shadowMapSize);
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = Q.shadowRadius;
  sun.shadow.blurSamples = 12;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 1800;
  scene.add(sun);

  const lightRot = new THREE.Matrix4().lookAt(new THREE.Vector3(), SUN_DIR.clone().negate(), new THREE.Vector3(0, 1, 0));
  const lightRotInv = lightRot.clone().invert();
  const tmp = new THREE.Vector3();
  let lastSize = 0;
  // Карта теней пересчитывается не каждый кадр, а только когда теневая область
  // заметно сместилась или изменила размер (солнце неподвижно) — это главная
  // экономия: иначе каждый кадр заново рисуются миллионы треугольников.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  const lastFocus = new THREE.Vector3(1e9, 0, 0);
  function fitShadow(camera, focus) {
    const dist = camera.position.distanceTo(focus);
    const size = Math.min(260, Math.max(28, dist * 0.85));
    const s = Math.pow(2, Math.round(Math.log2(size) * 2) / 2); // ступенями, без дрожания
    if (s === lastSize && focus.distanceTo(lastFocus) < s * 0.15) return;
    lastFocus.copy(focus);
    renderer.shadowMap.needsUpdate = true;
    const cam = sun.shadow.camera;
    if (s !== lastSize) {
      cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s;
      cam.updateProjectionMatrix();
      lastSize = s;
    }
    // привязка центра к текселям теневой карты — тени не «ползут» при движении камеры
    const texel = (2 * s) / Q.shadowMapSize;
    tmp.copy(focus).applyMatrix4(lightRotInv);
    tmp.x = Math.round(tmp.x / texel) * texel;
    tmp.y = Math.round(tmp.y / texel) * texel;
    tmp.applyMatrix4(lightRot);
    target.position.copy(tmp);
    sun.position.copy(tmp).addScaledVector(SUN_DIR, 900);
    target.updateMatrixWorld();
  }

  // лёгкая голубоватая подсветка от неба (дополняет HDRI)
  const hemi = new THREE.HemisphereLight(0xa9c4ff, 0x4a4630, 0.4);
  scene.add(hemi);

  return {
    sun,
    sky,
    update(t, camera, focus) {
      fitShadow(camera, focus);
      if (sky) {
        sky.position.copy(camera.position);
        sky.material.uniforms.time.value = t;
      }
    },
  };
}
