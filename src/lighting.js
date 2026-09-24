// Небо с облаками, солнце с мягкими тенями, рассеянный свет и дымка.
import * as THREE from 'three';

// Направление на солнце: послеполуденное, с юго-запада.
export const SUN_DIR = new THREE.Vector3(-0.62, 0.62, 0.48).normalize();

const HORIZON = new THREE.Color(0.62, 0.7, 0.8);
const ZENITH = new THREE.Color(0.13, 0.3, 0.62);

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // всегда на дальней плоскости
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 sunDir;
  uniform vec3 horizon;
  uniform vec3 zenith;
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
    vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.5));
    // ниже горизонта — дымка
    col = mix(col, horizon * 0.92, smoothstep(0.0, -0.08, h));
    float sd = max(dot(d, sunDir), 0.0);
    col += vec3(1.0, 0.82, 0.55) * (pow(sd, 6.0) * 0.18 + pow(sd, 60.0) * 0.35);
    // облака: проекция на «потолок» облачного слоя
    if (h > 0.0) {
      vec2 uv = d.xz / (h + 0.12) * 1.6;
      vec2 wind = vec2(time * 0.006, time * 0.002);
      float c = fbm(uv + wind);
      float c2 = fbm(uv * 2.7 - wind * 1.7 + 3.0);
      float dens = c * 0.8 + c2 * 0.25;
      float cov = smoothstep(1.0 - cloudCover, 1.0 - cloudCover + 0.3, dens);
      // освещённость: в сторону солнца облако тоньше
      float cs = fbm(uv + wind + sunDir.xz * 0.12);
      float lit = clamp(0.65 + (c - cs) * 4.0, 0.0, 1.0);
      vec3 cloudCol = mix(vec3(0.5, 0.55, 0.63), vec3(1.05, 1.0, 0.94), lit);
      cloudCol += vec3(1.0, 0.8, 0.5) * pow(sd, 8.0) * 0.4;
      cov *= smoothstep(0.0, 0.18, h);
      col = mix(col, cloudCol, cov * 0.92);
    }
    // солнечный диск
    col += vec3(1.0, 0.9, 0.7) * smoothstep(0.9993, 0.9997, sd) * 12.0;
    // лёгкая дымка у горизонта поверх облаков
    col = mix(col, horizon, (1.0 - smoothstep(0.0, 0.12, abs(h))) * 0.6);
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
      time: { value: 0 },
      cloudCover: { value: 0.52 },
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

export function createLighting(scene, renderer) {
  const sky = makeSkyMesh();
  scene.add(sky);

  scene.fog = new THREE.FogExp2(HORIZON.clone(), 0.00055);

  // окружающее освещение из неба (image-based lighting)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = makeSkyMesh();
  envSky.material.uniforms.cloudCover.value = 0.45;
  envScene.add(envSky);
  const envRT = pmrem.fromScene(envScene, 0.02, 1, 2000);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();

  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x5a5236, 0.35);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff0dc, 2.9);
  const target = new THREE.Object3D();
  target.position.set(0, 50, 20);
  scene.add(target);
  sun.target = target;
  sun.position.copy(target.position).addScaledVector(SUN_DIR, 400);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const S = 190;
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 50, far: 800 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.5;
  sun.shadow.radius = 3;
  scene.add(sun);

  return {
    sun,
    sky,
    update(t, camera) {
      sky.position.copy(camera.position);
      sky.material.uniforms.time.value = t;
    },
  };
}
