// Погода: ясно, дождь, туман, снег. Капли и снежинки — частицы в коробке вокруг
// камеры (движение считает шейдер), после дождя на мостовой остаются лужи,
// снег постепенно ложится на крыши и землю, ров и река замерзают.
import * as THREE from 'three';

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

export function createWeather(scene, lighting, { paveMask, heightAt, renderer }) {
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
  const pg = new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2);
  const pMat = new THREE.MeshBasicMaterial({ color: 0x55606a, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
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

  const ORDER = ['clear', 'rain', 'fog', 'snow'];
  let mode = 'clear';
  let wet = 0, snowAmt = 0, rainA = 0, snowA = 0;
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
      for (const [p, a] of [[rain, rainA], [snow, snowA]]) {
        p.obj.visible = a > 0.02;
        p.uniforms.uAlpha.value = a;
        p.uniforms.uTime.value = t;
        p.uniforms.uCam.value.copy(camera.position);
      }
      pm.visible = wet > 0.03 && snowAmt < 0.3;
      pMat.opacity = 0.6 * wet;
      const frozen = snowAmt > 0.5;
      for (const { ice, water } of ices) { ice.visible = frozen; water.visible = !frozen; }
    },
  };
}
