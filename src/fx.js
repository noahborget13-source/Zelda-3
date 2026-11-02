// Particules et effets sonores (WebAudio synthétique, sans fichiers)
import * as THREE from 'three';

export class Particles {
  constructor(scene, max = 500) {
    this.max = max; this.n = 0; this.head = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.base = new Float32Array(max * 3); this.grav = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.28, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.pts.frustumCulled = false;
    scene.add(this.pts);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -9999;
  }
  emit(x, y, z, n, hex, speed = 4, life = 0.6, grav = 9) {
    const c = new THREE.Color(hex);
    for (let k = 0; k < n; k++) {
      const i = this.head; this.head = (this.head + 1) % this.max;
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, r = Math.sqrt(1 - u * u), s = speed * (0.4 + Math.random() * 0.8);
      this.pos.set([x, y, z], i * 3);
      this.vel.set([Math.cos(a) * r * s, u * s + speed * 0.3, Math.sin(a) * r * s], i * 3);
      this.base.set([c.r, c.g, c.b], i * 3);
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.6);
      this.grav[i] = grav;
    }
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -9999; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      for (let a = 0; a < 3; a++) {
        this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt;
        this.col[i * 3 + a] = this.base[i * 3 + a] * k;
      }
    }
    this.pts.geometry.attributes.position.needsUpdate = true;
    this.pts.geometry.attributes.color.needsUpdate = true;
  }
}

export class Sfx {
  constructor() { this.ctx = null; this.vol = 0.5; }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.ctx = null; }
  }
  tone(freq, dur, type = 'sine', vol = 0.2, slide = 0, delay = 0) {
    const c = this.ctx; if (!c || this.vol <= 0) return;
    const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol * this.vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur, vol = 0.2, delay = 0) {
    const c = this.ctx; if (!c || this.vol <= 0) return;
    const len = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = c.createBufferSource(), g = c.createGain();
    s.buffer = buf; g.gain.value = vol * this.vol;
    s.connect(g).connect(c.destination); s.start(c.currentTime + delay);
  }
  pickup() { this.tone(660, 0.12, 'triangle', 0.25); this.tone(990, 0.18, 'triangle', 0.22, 0, 0.08); }
  lumi() { this.tone(880, 0.1, 'sine', 0.2); this.tone(1320, 0.22, 'sine', 0.2, 0, 0.06); }
  hit() { this.noise(0.12, 0.35); this.tone(140, 0.12, 'square', 0.18, -60); }
  swing() { this.noise(0.1, 0.12); }
  hurt() { this.tone(180, 0.25, 'sawtooth', 0.25, -90); }
  jingle() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.22, 0, i * 0.12)); }
  tower() { [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.4, 'sine', 0.2, 0, i * 0.1)); }
  chest() { this.tone(300, 0.15, 'square', 0.15, 300); this.tone(600, 0.3, 'triangle', 0.2, 0, 0.12); }
  glide() { this.noise(0.25, 0.1); }
  glue() { this.tone(240, 0.12, 'square', 0.18, 200); }
  broke() { this.noise(0.3, 0.4); this.tone(110, 0.3, 'sawtooth', 0.25, -60); }
  launch() { this.noise(0.8, 0.3); this.tone(200, 0.9, 'sawtooth', 0.2, 600); }
}
