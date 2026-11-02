// Ciel, cycle jour/nuit, nuages, pluie.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, mulberry32 } from './util.js';

const C = (r, g, b) => new THREE.Color(r, g, b);
const PAL = {
  day: { top: C(0.10, 0.30, 0.78), mid: C(0.40, 0.65, 0.92), bot: C(0.62, 0.78, 0.90) },
  dusk: { top: C(0.08, 0.10, 0.30), mid: C(0.85, 0.40, 0.22), bot: C(0.80, 0.45, 0.30) },
  night: { top: C(0.002, 0.004, 0.02), mid: C(0.01, 0.02, 0.06), bot: C(0.01, 0.015, 0.04) },
  rain: { top: C(0.18, 0.2, 0.24), mid: C(0.28, 0.31, 0.35), bot: C(0.3, 0.33, 0.37) },
};
const tmp = new THREE.Color();
function mix3(out, a, b, c, wa, wb, wc) {
  out.r = a.r * wa + b.r * wb + c.r * wc;
  out.g = a.g * wa + b.g * wb + c.g * wc;
  out.b = a.b * wa + b.b * wb + c.b * wc;
}

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene;
    this.rain = 0;       // 0..1 intensité effective
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.elev = 1;

    const uni = { top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, bot: { value: new THREE.Color() } };
    this.uni = uni;
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(1500, 24, 14),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false, uniforms: uni,
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;' +
          'void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.55)) : mix(mid, bot, pow(-h, 0.5));' +
          'gl_FragColor = vec4(c, 1.0);' +
          '#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
      })
    );
    this.dome.frustumCulled = false; this.dome.renderOrder = -10;
    scene.add(this.dome);

    // étoiles
    const rnd = mulberry32(7), n = 700, sp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      sp[i * 3] = Math.cos(a) * r * 1400; sp[i * 3 + 1] = Math.abs(u) * 1400 * 0.98 + 20; sp[i * 3 + 2] = Math.sin(a) * r * 1400;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false; this.stars.renderOrder = -9;
    scene.add(this.stars);

    this.sun = new THREE.Mesh(new THREE.SphereGeometry(36, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff1c4, fog: false }));
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(26, 16, 12), new THREE.MeshBasicMaterial({ color: 0xcfe0ff, fog: false }));
    this.sun.frustumCulled = this.moon.frustumCulled = false;
    scene.add(this.sun, this.moon);

    // lumières
    this.hemi = new THREE.HemisphereLight(0xbcd8ff, 0x6a5a3a, 0.8);
    this.dir = new THREE.DirectionalLight(0xfff0d0, 2.4);
    this.dir.castShadow = true;
    this.dir.shadow.mapSize.set(2048, 2048);
    const sc = this.dir.shadow.camera;
    sc.left = sc.bottom = -75; sc.right = sc.top = 75; sc.near = 1; sc.far = 500;
    this.dir.shadow.bias = -0.0004; this.dir.shadow.normalBias = 0.6;
    this.moonLight = new THREE.DirectionalLight(0x6a86d0, 0.0);
    scene.add(this.hemi, this.dir, this.dir.target, this.moonLight, this.moonLight.target);

    scene.fog = new THREE.Fog(0xaec8e0, 90, 1500);

    // nuages
    const cg = new THREE.IcosahedronGeometry(1, 1);
    this.cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, fog: false });
    this.clouds = new THREE.InstancedMesh(cg, this.cloudMat, 70);
    this.clouds.frustumCulled = false;
    this.cloudData = [];
    const r2 = mulberry32(99);
    for (let i = 0; i < 70; i++) {
      this.cloudData.push({ x: (r2() - .5) * 2800, z: (r2() - .5) * 2800, y: i < 40 ? 120 + r2() * 40 : 300 + r2() * 60, sx: 50 + r2() * 70, sy: 9 + r2() * 9, sz: 30 + r2() * 40 });
    }
    scene.add(this.clouds);
    this._m = new THREE.Object3D();

    // pluie
    const N = 1400;
    this.rainPos = new Float32Array(N * 6);
    this.rainVel = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - .5) * 60, y = Math.random() * 40, z = (Math.random() - .5) * 60;
      this.rainPos.set([x, y, z, x, y - 1.2, z], i * 6);
      this.rainVel[i] = 28 + Math.random() * 12;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rainMesh = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xb8cce8, transparent: true, opacity: 0.0, fog: false }));
    this.rainMesh.frustumCulled = false; this.rainMesh.visible = false;
    scene.add(this.rainMesh);
    this.windX = 0;
  }

  // t: 0..1 (0 = minuit, 0.5 = midi)
  update(t, focus, cam, dt, rain) {
    this.rain = lerp(this.rain, rain, Math.min(1, dt * 0.6));
    const ang = (t - 0.25) * Math.PI * 2;
    const elev = Math.sin(ang);
    this.elev = elev;
    this.sunDir.set(Math.cos(ang) * 0.82, elev, 0.42).normalize();

    const wDay = smoothstep(-0.02, 0.3, elev);
    const wNight = smoothstep(0.02, -0.22, elev);
    let wDusk = Math.max(0, 1 - wDay - wNight);
    const s = wDay + wNight + wDusk || 1;
    const k = 1 - this.rain * 0.8;
    for (const key of ['top', 'mid', 'bot']) {
      mix3(this.uni[key].value, PAL.day[key], PAL.night[key], PAL.dusk[key], wDay / s, wNight / s, wDusk / s);
      // pluie : ciel gris (plus sombre la nuit)
      tmp.copy(PAL.rain[key]).multiplyScalar(lerp(0.12, 1, wDay + wDusk * 0.5));
      this.uni[key].value.lerp(tmp, 1 - k);
    }
    const bot = this.uni.bot.value;
    this.scene.fog.color.copy(bot);
    this.scene.fog.far = lerp(1500, 420, this.rain);
    this.scene.fog.near = lerp(90, 25, this.rain);

    this.dome.position.copy(cam.position);
    this.stars.position.copy(cam.position);
    this.stars.material.opacity = clamp(wNight * 1.2, 0, 1) * (1 - this.rain);
    this.sun.position.copy(cam.position).addScaledVector(this.sunDir, 1300);
    this.moon.position.copy(cam.position).addScaledVector(this.sunDir, -1300);
    this.sun.visible = elev > -0.12; this.moon.visible = elev < 0.12;
    this.sun.material.color.setRGB(1, lerp(0.55, 0.95, wDay), lerp(0.3, 0.8, wDay));

    // lumières
    const sunI = clamp(elev * 3.2, 0, 1) * 2.6 * (1 - this.rain * 0.7);
    this.dir.intensity = sunI;
    this.dir.color.setRGB(1, lerp(0.62, 0.95, wDay), lerp(0.42, 0.85, wDay));
    this.dir.position.copy(focus).addScaledVector(this.sunDir, 220);
    this.dir.target.position.copy(focus);
    this.dir.castShadow = sunI > 0.05;
    this.moonLight.intensity = clamp(-elev * 2, 0, 1) * 0.55;
    this.moonLight.position.copy(focus).addScaledVector(this.sunDir, -200);
    this.moonLight.target.position.copy(focus);
    this.hemi.intensity = lerp(0.22, 0.95, clamp(wDay + wDusk * 0.5, 0, 1)) * (1 - this.rain * 0.3);
    this.hemi.color.copy(this.uni.top.value).lerp(tmp.setRGB(1, 1, 1), 0.35);

    // nuages
    this.windX += dt * 6;
    const m = this._m;
    const lum = clamp(wDay + wDusk * 0.6 + 0.12, 0.1, 1);
    this.cloudMat.color.setRGB(lum, lum, lum * 1.02);
    this.cloudMat.opacity = lerp(0.92, 0.98, this.rain);
    for (let i = 0; i < this.cloudData.length; i++) {
      const c = this.cloudData[i];
      let x = ((c.x + this.windX + 1400) % 2800) - 1400;
      m.position.set(x + focus.x * 0.0, c.y, c.z);
      m.scale.set(c.sx, c.sy * (1 + this.rain * 0.5), c.sz);
      m.updateMatrix();
      this.clouds.setMatrixAt(i, m.matrix);
    }
    this.clouds.instanceMatrix.needsUpdate = true;

    // pluie
    const rv = this.rain > 0.03;
    this.rainMesh.visible = rv;
    if (rv) {
      this.rainMesh.material.opacity = this.rain * 0.55;
      this.rainMesh.position.set(focus.x, focus.y - 8, focus.z);
      const p = this.rainPos;
      for (let i = 0; i < this.rainVel.length; i++) {
        let y = p[i * 6 + 1] - this.rainVel[i] * dt;
        if (y < -2) y += 42;
        p[i * 6 + 1] = y; p[i * 6 + 4] = y - 1.4;
        p[i * 6] = p[i * 6 + 3] + 0; // vertical (le vent est négligeable)
      }
      this.rainMesh.geometry.attributes.position.needsUpdate = true;
    }
  }
}
