// Общие материалы и шейдерные «вставки» для стандартного PBR-материала Three.js.
import * as THREE from 'three';

// Трипланарное текстурирование: текстура проецируется по мировым осям X/Y/Z
// и смешивается по нормали — нет растяжения на отвесных гранях скал.
// Работает и для InstancedMesh.
export function triplanarMaterial({ map, scale = 0.2, color = 0xffffff, roughness = 0.92, tintNoise = null, tintAmount = 0.25 }) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tTri = { value: map };
    shader.uniforms.triScale = { value: scale };
    shader.uniforms.tTint = { value: tintNoise };
    shader.uniforms.tintAmount = { value: tintNoise ? tintAmount : 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriNrm;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 tp = vec4(transformed, 1.0);
          vec3 tn = normal;
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
        uniform sampler2D tTri;
        uniform sampler2D tTint;
        uniform float triScale;
        uniform float tintAmount;`
      )
      .replace(
        '#include <map_fragment>',
        `{
          vec3 bw = pow(abs(normalize(vTriNrm)), vec3(4.0));
          bw /= (bw.x + bw.y + bw.z);
          vec3 p = vTriPos * triScale;
          vec3 c = texture2D(tTri, p.zy).rgb * bw.x + texture2D(tTri, p.xz).rgb * bw.y + texture2D(tTri, p.xy).rgb * bw.z;
          if (tintAmount > 0.0) {
            float n = texture2D(tTint, vTriPos.xz * 0.013).r;
            c *= 1.0 + (n - 0.5) * tintAmount * 2.0;
          }
          diffuseColor.rgb *= c;
        }`
      );
  };
  return mat;
}
