// Общие материалы и шейдерные вставки для MeshStandardMaterial.
import * as THREE from 'three';
import { materialTextures, macroNoiseTexture } from './textures.js';
import { Q } from './quality.js';

// GLSL: трипланарная выборка цвета, ORM и нормали (смешивание нормалей «whiteout»).
// Текстура проецируется по трём мировым осям — нет растяжения на отвесных гранях.
// Осень: 0 — лето, 1 — золотая осень (общий uniform для травы, листвы, рельефа, полей)
export const AUTUMN = { value: 0 };

export const TRIPLANAR_GLSL = (Q.cheapShading ? '#define CHEAP_SHADING\n' : '') + /* glsl */ `
  vec3 triBlend(vec3 n) {
    #ifdef CHEAP_SHADING
    // резкий переход: почти везде одна проекция вместо двух-трёх
    vec3 b = max(abs(n) - 0.45, 0.0001);
    b = b * b * b;
    #else
    vec3 b = pow(abs(n), vec3(4.0));
    #endif
    return b / (b.x + b.y + b.z);
  }
  // для обычных 2D-текстур; производные считаются заранее (выборка внутри ветвлений)
  void triSample(sampler2D tC, sampler2D tN, sampler2D tO, vec3 p, vec3 n, vec3 bw, float nStr,
                 out vec3 col, out vec3 orm, out vec3 nrm) {
    vec3 dx = dFdx(p), dy = dFdy(p);
    col = vec3(0.0); orm = vec3(0.0);
    vec3 nx = vec3(0.0), ny = vec3(0.0), nz = vec3(0.0);
    if (bw.x > 0.01) {
      vec2 uv = p.zy;
      col += textureGrad(tC, uv, dx.zy, dy.zy).rgb * bw.x; orm += textureGrad(tO, uv, dx.zy, dy.zy).rgb * bw.x;
      #ifdef CHEAP_SHADING
      vec3 t = vec3(0.0, 0.0, 1.0);
      #else
      vec3 t = textureGrad(tN, uv, dx.zy, dy.zy).xyz * 2.0 - 1.0; t.xy *= nStr;
      #endif
      nx = vec3(t.xy + n.zy, abs(t.z) * n.x);
    }
    if (bw.y > 0.01) {
      vec2 uv = p.xz;
      col += textureGrad(tC, uv, dx.xz, dy.xz).rgb * bw.y; orm += textureGrad(tO, uv, dx.xz, dy.xz).rgb * bw.y;
      #ifdef CHEAP_SHADING
      vec3 t = vec3(0.0, 0.0, 1.0);
      #else
      vec3 t = textureGrad(tN, uv, dx.xz, dy.xz).xyz * 2.0 - 1.0; t.xy *= nStr;
      #endif
      ny = vec3(t.xy + n.xz, abs(t.z) * n.y);
    }
    if (bw.z > 0.01) {
      vec2 uv = p.xy;
      col += textureGrad(tC, uv, dx.xy, dy.xy).rgb * bw.z; orm += textureGrad(tO, uv, dx.xy, dy.xy).rgb * bw.z;
      #ifdef CHEAP_SHADING
      vec3 t = vec3(0.0, 0.0, 1.0);
      #else
      vec3 t = textureGrad(tN, uv, dx.xy, dy.xy).xyz * 2.0 - 1.0; t.xy *= nStr;
      #endif
      nz = vec3(t.xy + n.xy, abs(t.z) * n.z);
    }
    nrm = normalize(nx.zyx * bw.x + ny.xzy * bw.y + nz.xyz * bw.z + n * 1e-4);
  }
  // одна проекция сверху (для пологих слоёв: трава, земля, галька) — в 3 раза дешевле
  void planarSampleArr(sampler2DArray tC, sampler2DArray tN, sampler2DArray tO, float L, vec3 p, vec3 dx, vec3 dy,
                       vec3 n, float nStr, out vec3 col, out vec3 orm, out vec3 nrm) {
    vec3 uv = vec3(p.xz, L);
    col = textureGrad(tC, uv, dx.xz, dy.xz).rgb;
    orm = textureGrad(tO, uv, dx.xz, dy.xz).rgb;
    #ifdef CHEAP_SHADING
    nrm = n;
    #else
    vec3 t = textureGrad(tN, uv, dx.xz, dy.xz).xyz * 2.0 - 1.0; t.xy *= nStr;
    nrm = normalize(vec3(t.xy + n.xz, abs(t.z) * n.y).xzy);
    #endif
  }
  // то же для текстурного массива (слой L)
  void triSampleArr(sampler2DArray tC, sampler2DArray tN, sampler2DArray tO, float L, vec3 p, vec3 dx, vec3 dy,
                    vec3 n, vec3 bw, float nStr, out vec3 col, out vec3 orm, out vec3 nrm) {
    col = vec3(0.0); orm = vec3(0.0);
    vec3 nx = vec3(0.0), ny = vec3(0.0), nz = vec3(0.0);
    if (bw.x > 0.01) {
      vec3 uv = vec3(p.zy, L);
      col += textureGrad(tC, uv, dx.zy, dy.zy).rgb * bw.x; orm += textureGrad(tO, uv, dx.zy, dy.zy).rgb * bw.x;
      #ifdef CHEAP_SHADING
      vec3 t = vec3(0.0, 0.0, 1.0);
      #else
      vec3 t = textureGrad(tN, uv, dx.zy, dy.zy).xyz * 2.0 - 1.0; t.xy *= nStr;
      #endif
      nx = vec3(t.xy + n.zy, abs(t.z) * n.x);
    }
    if (bw.y > 0.01) {
      vec3 uv = vec3(p.xz, L);
      col += textureGrad(tC, uv, dx.xz, dy.xz).rgb * bw.y; orm += textureGrad(tO, uv, dx.xz, dy.xz).rgb * bw.y;
      #ifdef CHEAP_SHADING
      vec3 t = vec3(0.0, 0.0, 1.0);
      #else
      vec3 t = textureGrad(tN, uv, dx.xz, dy.xz).xyz * 2.0 - 1.0; t.xy *= nStr;
      #endif
      ny = vec3(t.xy + n.xz, abs(t.z) * n.y);
    }
    if (bw.z > 0.01) {
      vec3 uv = vec3(p.xy, L);
      col += textureGrad(tC, uv, dx.xy, dy.xy).rgb * bw.z; orm += textureGrad(tO, uv, dx.xy, dy.xy).rgb * bw.z;
      #ifdef CHEAP_SHADING
      vec3 t = vec3(0.0, 0.0, 1.0);
      #else
      vec3 t = textureGrad(tN, uv, dx.xy, dy.xy).xyz * 2.0 - 1.0; t.xy *= nStr;
      #endif
      nz = vec3(t.xy + n.xy, abs(t.z) * n.z);
    }
    nrm = normalize(nx.zyx * bw.x + ny.xzy * bw.y + nz.xyz * bw.z + n * 1e-4);
  }
`;

// Трипланарный PBR-материал на основе слота текстур (скала, камень).
// Работает и для InstancedMesh.
export function triplanarMaterial(slot, { scale = 1, tint = 0.25, normalStrength = 1, color = 0xffffff, faceted = false } = {}) {
  const t = materialTextures(slot);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 });
  const uniforms = {
    tC: { value: t.map },
    tN: { value: t.normalMap },
    tO: { value: t.aoMap },
    tMacro: { value: macroNoiseTexture() },
    triScale: { value: scale / t.tileMeters },
    tintAmount: { value: tint },
    nStr: { value: normalStrength },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriNrm;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 tp = vec4(transformed, 1.0);
          vec3 tn = objectNormal;
          #ifdef USE_INSTANCING
            tp = instanceMatrix * tp;
            tn = mat3(instanceMatrix) * tn;
          #endif
          vTriPos = (modelMatrix * tp).xyz;
          vTriNrm = normalize(mat3(modelMatrix) * tn);
        }`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTriPos;
        varying vec3 vTriNrm;
        uniform sampler2D tC, tN, tO, tMacro;
        uniform float triScale, tintAmount, nStr;
        vec3 gTriCol, gTriOrm, gTriNrm;
        ${TRIPLANAR_GLSL}`
      )
      .replace(
        '#include <map_fragment>',
        `{
          vec3 n = normalize(vTriNrm);
          ${faceted ? `// резкие грани: нормаль грани по производным (камень будто сколот)
          vec3 fn = normalize(cross(dFdx(vTriPos), dFdy(vTriPos)));
          if (dot(fn, n) < 0.0) fn = -fn;
          n = normalize(mix(n, fn, 0.8));` : ''}
          triSample(tC, tN, tO, vTriPos * triScale, n, triBlend(n), nStr, gTriCol, gTriOrm, gTriNrm);
          float m = texture2D(tMacro, vTriPos.xz * 0.013).r;
          gTriCol *= 1.0 + (m - 0.5) * tintAmount * 2.0;
          ${faceted ? `// трещины: тонкие тёмные изломы
          {
            float cr = texture2D(tMacro, vTriPos.xz * 0.06 + vTriPos.y * 0.09).g;
            float cr2 = texture2D(tMacro, vec2(vTriPos.x + vTriPos.z, vTriPos.y) * 0.08).b;
            float crack = (1.0 - smoothstep(0.0, 0.016, abs(cr - 0.5))) + (1.0 - smoothstep(0.0, 0.012, abs(cr2 - 0.5))) * 0.7;
            gTriCol *= 1.0 - min(1.0, crack) * 0.55;
            gTriCol *= 0.9 + 0.2 * smoothstep(-0.2, 0.8, n.y); // верх светлее, низ в тени
          }` : ''}
          diffuseColor.rgb *= gTriCol;
        }`
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * gTriOrm.g;')
      .replace(
        '#include <normal_fragment_maps>',
        'normal = normalize((viewMatrix * vec4(gTriNrm, 0.0)).xyz);'
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= gTriOrm.r;
        reflectedLight.indirectSpecular *= gTriOrm.r;`
      );
  };
  mat.customProgramCacheKey = () => 'tri-' + slot + (faceted ? '-f' : '');
  return mat;
}

// ---------------------------------------------------------------------------
// «Старение» материалов: мох и потемнения на крышах, выгоревшее и посеревшее
// дерево, тёмные пятна на соломе. Считается по мировым координатам и
// макрошуму — без дополнительных текстур и геометрии.
// ---------------------------------------------------------------------------
const WEATHER_GLSL = {
  roof: `
    // мох и лишайник пятнами, сильнее на пологих местах; потемнение у свеса и потёки
    float mossR = smoothstep(0.55, 0.78, wm1.b) * smoothstep(0.3, 0.8, vWthN.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.2, 0.07) * (0.75 + wm2.g * 0.5), mossR * 0.55);
    diffuseColor.rgb *= 0.86 + 0.24 * wm1.r;
    float streakR = smoothstep(0.6, 0.85, wm2.r) * 0.25;
    diffuseColor.rgb *= 1.0 - streakR;`,
  wood: `
    // старое дерево: на солнце и ветру сереет, внизу темнеет от сырости
    float lumW = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
    float grey = smoothstep(0.35, 0.75, wm1.g) * 0.45;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lumW) * vec3(0.95, 0.95, 0.92), grey);
    diffuseColor.rgb *= 0.82 + 0.3 * wm2.r;
    diffuseColor.rgb *= 1.0 - (1.0 - smoothstep(0.0, 0.8, vWthW.y - wGround)) * 0.25;`,
  thatch: `
    // солома: старые тёмные участки, свежие заплаты, зеленоватый налёт
    diffuseColor.rgb *= 0.78 + 0.35 * wm1.r;
    float patchT = smoothstep(0.62, 0.75, wm2.b);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 1.15, 0.8), patchT * 0.6);
    float mossT = smoothstep(0.6, 0.8, wm1.b) * smoothstep(0.2, 0.7, vWthN.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.22, 0.1), mossT * 0.4);`,
};
export function addWeathering(mat, kind, { ground = -1e4 } = {}) {
  const prev = mat.onBeforeCompile;
  const macro = macroNoiseTexture();
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.tWthMacro = { value: macro };
    sh.uniforms.wGround = { value: ground };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWthW;\nvarying vec3 vWthN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          vec3 wn = objectNormal;
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp; wn = mat3(instanceMatrix) * wn;
          #endif
          vWthW = (modelMatrix * wp).xyz;
          vWthN = normalize(mat3(modelMatrix) * wn);
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tWthMacro;\nuniform float wGround;\nvarying vec3 vWthW;\nvarying vec3 vWthN;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 wm1 = texture2D(tWthMacro, vWthW.xz * 0.06 + vWthW.y * 0.03).rgb;
          vec3 wm2 = fract(wm1.gbr * 3.7 + wm1.brg * 1.3); // вторая «случайная» величина без лишней выборки
          ${WEATHER_GLSL[kind]}
        }`);
  };
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  const pk = prev ? prev.toString().length : 0;
  mat.customProgramCacheKey = () => 'wth-' + kind + '-' + pk + '-' + key();
  return mat;
}
