// Общие материалы и шейдерные вставки для MeshStandardMaterial.
import * as THREE from 'three';
import { materialTextures, macroNoiseTexture } from './textures.js';
import { Q } from './quality.js';

// GLSL: трипланарная выборка цвета, ORM и нормали (смешивание нормалей «whiteout»).
// Текстура проецируется по трём мировым осям — нет растяжения на отвесных гранях.
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
export function triplanarMaterial(slot, { scale = 1, tint = 0.25, normalStrength = 1, color = 0xffffff } = {}) {
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
          triSample(tC, tN, tO, vTriPos * triScale, n, triBlend(n), nStr, gTriCol, gTriOrm, gTriNrm);
          float m = texture2D(tMacro, vTriPos.xz * 0.013).r;
          gTriCol *= 1.0 + (m - 0.5) * tintAmount * 2.0;
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
  mat.customProgramCacheKey = () => 'tri-' + slot;
  return mat;
}
