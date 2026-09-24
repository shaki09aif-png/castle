// Постобработка (EffectComposer из библиотеки postprocessing):
// SSAO (N8AO), лучи солнца (god rays), лёгкий bloom для солнца и факелов,
// тональная компрессия ACES, цветокоррекция, лёгкая виньетка, сглаживание SMAA.
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode,
  VignetteEffect, BrightnessContrastEffect, HueSaturationEffect, SMAAEffect, SMAAPreset,
  GodRaysEffect, KernelSize,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { SUN_DIR } from './lighting.js';
import { Q } from './quality.js';

export function createPostFX(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
    multisampling: Q.msaa,
  });
  composer.addPass(new RenderPass(scene, camera));

  let ao = null;
  if (Q.ao) {
    ao = new N8AOPostPass(scene, camera, size.x, size.y);
    Object.assign(ao.configuration, {
      aoRadius: 2.2,
      distanceFalloff: 0.8,
      intensity: 2.6,
      halfRes: Q.aoHalfRes,
      depthAwareUpsampling: true,
      gammaCorrection: false,
      color: new THREE.Color(0.02, 0.025, 0.03),
    });
    ao.setQualityMode(Q.aoHalfRes ? 'Low' : 'Medium');
    composer.addPass(ao);
  }

  const effects = [];
  // «Солнце» для лучей: яркий диск далеко по направлению на солнце
  const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(70, 16, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe6b8, transparent: true, fog: false, depthWrite: false })
  );
  sunMesh.frustumCulled = false;
  if (Q.godRays) {
    effects.push(
      new GodRaysEffect(camera, sunMesh, {
        samples: 60, density: 0.95, decay: 0.93, weight: 0.32, exposure: 0.38,
        clampMax: 1, blur: true, kernelSize: KernelSize.SMALL, resolutionScale: 0.5,
      })
    );
  }
  if (Q.bloom) {
    effects.push(new BloomEffect({ intensity: 0.55, luminanceThreshold: 0.9, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.72 }));
  }
  effects.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }));
  effects.push(new HueSaturationEffect({ saturation: 0.06 }));
  effects.push(new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.07 }));
  effects.push(new VignetteEffect({ offset: 0.32, darkness: 0.42 }));
  composer.addPass(new EffectPass(camera, ...effects));
  if (!Q.msaa) composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));

  return {
    composer,
    setSize(w, h) {
      composer.setSize(w, h);
    },
    render(dt) {
      sunMesh.position.copy(camera.position).addScaledVector(SUN_DIR, 4000);
      sunMesh.updateMatrixWorld();
      composer.render(dt);
    },
  };
}
