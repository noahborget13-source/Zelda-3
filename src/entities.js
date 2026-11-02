// Modèle du joueur et ennemis (Gluants, Rôdeurs d'ombre, Colosse de pierre)
import * as THREE from 'three';
import * as T from './terrain.js';
import { angDiff, clamp } from './util.js';

const MAT = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
const box = (w, h, d, m) => { const x = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); x.castShadow = true; return x; };

/* ============================== JOUEUR ============================== */
export class PlayerModel {
  constructor() {
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    const skin = MAT(0xf0c8a0), tunic = MAT(0x2a8f8f), pants = MAT(0x4a3a2a), scarfM = MAT(0xe8742a, { side: THREE.DoubleSide }), hair = MAT(0xd9a24a), boots = MAT(0x3a2a1c);
    const torso = box(0.62, 0.72, 0.36, tunic); torso.position.y = 1.08; this.body.add(torso);
    const belt = box(0.64, 0.12, 0.38, MAT(0x5a3b22)); belt.position.y = 0.78; this.body.add(belt);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 10), skin); head.position.y = 1.68; head.castShadow = true; this.body.add(head);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hair); cap.position.y = 1.72; cap.rotation.x = -0.25; this.body.add(cap);
    for (const sx of [-0.09, 0.09]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), MAT(0x1a1a22)); eye.position.set(sx, 1.69, 0.23); this.body.add(eye);
    }
    const sc = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.07, 6, 12), scarfM); sc.rotation.x = Math.PI / 2; sc.position.y = 1.43; this.body.add(sc);
    this.tail = new THREE.Group(); this.tail.position.set(0, 1.4, -0.2);
    const tailM = box(0.16, 0.08, 0.8, scarfM); tailM.position.z = -0.4; this.tail.add(tailM); this.body.add(this.tail);

    const limb = (w, h, d, m, x, y) => {
      const p = new THREE.Group(); p.position.set(x, y, 0);
      const c = box(w, h, d, m); c.position.y = -h / 2; p.add(c); this.body.add(p); return p;
    };
    this.armL = limb(0.17, 0.62, 0.17, tunic, -0.4, 1.38);
    this.armR = limb(0.17, 0.62, 0.17, tunic, 0.4, 1.38);
    this.legL = limb(0.22, 0.72, 0.22, pants, -0.16, 0.74);
    this.legR = limb(0.22, 0.72, 0.22, pants, 0.16, 0.74);
    const bl = box(0.24, 0.16, 0.3, boots); bl.position.set(0, -0.68, 0.03); this.legL.add(bl);
    const br = box(0.24, 0.16, 0.3, boots); br.position.set(0, -0.68, 0.03); this.legR.add(br);
    this.hand = new THREE.Group(); this.hand.position.set(0, -0.62, 0.05); this.armR.add(this.hand);

    // parapente
    this.glider = new THREE.Group();
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.05, 2.4), MAT(0xe8742a, { side: THREE.DoubleSide }));
    cloth.castShadow = true; this.glider.add(cloth);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 2.42), MAT(0x2fc0d8)); this.glider.add(stripe);
    for (const sx of [-0.9, 0.9]) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 4), MAT(0x3a2a1c));
      rod.position.set(sx, -0.7, 0); this.glider.add(rod);
    }
    this.glider.position.set(0, 2.9, -0.15); this.glider.rotation.x = 0.28;
    this.glider.visible = false;
    this.body.add(this.glider);
    this.phase = 0; this.weaponMesh = null;
  }

  setWeapon(def, fuseColor) {
    if (this.weaponMesh) { this.hand.remove(this.weaponMesh); this.weaponMesh = null; }
    if (!def) return;
    const g = new THREE.Group();
    const m = MAT(def.col, fuseColor ? { emissive: fuseColor, emissiveIntensity: 0.9 } : {});
    if (def.kind === 'stick') { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 1.0, 6), m); s.position.y = 0.4; g.add(s); }
    else if (def.kind === 'sword') {
      const bl = box(0.09, 1.05, 0.025, m); bl.position.y = 0.6; g.add(bl);
      const gd = box(0.38, 0.06, 0.08, MAT(0x6a4a26)); gd.position.y = 0.08; g.add(gd);
      const gr = box(0.06, 0.2, 0.06, MAT(0x3a2a1c)); gr.position.y = -0.04; g.add(gr);
    } else if (def.kind === 'club') {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.17, 0.95, 7), m); c.position.y = 0.4; g.add(c);
      for (let k = 0; k < 4; k++) { const sp = box(0.05, 0.05, 0.05, MAT(0xbfc4cc)); sp.position.set(Math.cos(k * 1.6) * 0.17, 0.6 + (k % 2) * 0.15, Math.sin(k * 1.6) * 0.17); g.add(sp); }
    } else {
      const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.9, 6), MAT(0x7a5530)); sh.position.y = 0.6; g.add(sh);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.35, 6), m); tip.position.y = 1.7; g.add(tip);
    }
    g.rotation.x = Math.PI / 2 * 0.9; // pointe vers l'avant
    this.hand.add(g); this.weaponMesh = g;
  }

  // st = { speed (0..1), mode, attack (0..1 ou -1), roll (0..1), t }
  animate(dt, st) {
    const { mode } = st;
    this.glider.visible = mode === 'glide';
    this.phase += dt * (6 + st.speed * 8);
    const s = Math.sin(this.phase), amp = Math.min(1, st.speed) * 0.95;
    let aL = 0, aR = 0, lL = 0, lR = 0, bodyX = 0, bodyY = 0, bodyZ = 0;
    if (mode === 'ground') { aL = s * amp; aR = -s * amp; lL = -s * amp; lR = s * amp; }
    else if (mode === 'air') { aL = -0.6; aR = -0.6; lL = 0.3; lR = -0.3; }
    else if (mode === 'glide') { aL = -2.9; aR = -2.9; lL = 0.25; lR = -0.1; }
    else if (mode === 'climb') { const c = Math.sin(this.phase * 0.6) * st.speed; aL = -2.6 + c * 0.6; aR = -2.6 - c * 0.6; lL = -0.5 + c * 0.5; lR = -0.5 - c * 0.5; }
    else if (mode === 'swim') { bodyX = 1.25; bodyY = -0.5; aL = -2.3 + s * 0.8; aR = -2.3 - s * 0.8; lL = s * 0.4; lR = -s * 0.4; }
    else if (mode === 'dead') { bodyX = -1.5; bodyY = -0.7; }
    if (st.roll > 0) { bodyX = st.roll * Math.PI * 2; bodyY = 0.4; lL = lR = 0.8; aL = aR = -1.2; }
    // attaque : l'épée balaie
    if (st.attack >= 0) {
      const a = st.attack;
      aR = a < 0.3 ? -2.4 * (a / 0.3) : -2.4 + 3.4 * ((a - 0.3) / 0.7);
      this.body.rotation.y = a < 0.3 ? 0.4 : -0.6 * Math.sin(a * 3);
    } else this.body.rotation.y *= 0.8;
    const k = Math.min(1, dt * 18);
    this.armL.rotation.x += (aL - this.armL.rotation.x) * k;
    this.armR.rotation.x += (aR - this.armR.rotation.x) * k;
    this.legL.rotation.x += (lL - this.legL.rotation.x) * k;
    this.legR.rotation.x += (lR - this.legR.rotation.x) * k;
    this.body.rotation.x += (bodyX - this.body.rotation.x) * Math.min(1, dt * 12);
    this.body.position.y += (bodyY - this.body.position.y) * Math.min(1, dt * 12);
    this.tail.rotation.x = -0.2 - st.speed * 0.5 + Math.sin(st.t * 9) * 0.18;
    this.tail.rotation.y = Math.sin(st.t * 5) * 0.15;
  }
}

/* ============================== ENNEMIS ============================== */
export const ENEMY = {
  slime: { name: 'Gluant', hp: 24, speed: 5.0, aggro: 22, dmg: 4, radius: 0.8, score: 1 },
  brute: { name: 'Rôdeur d’ombre', hp: 42, speed: 4.6, aggro: 26, dmg: 8, radius: 0.7, score: 2 },
  boss: { name: 'Colosse de pierre', hp: 460, speed: 3.2, aggro: 55, dmg: 12, radius: 3.2, score: 20 },
};

export class Enemy {
  constructor(kind, x, z, y, scene, campId = -1) {
    this.kind = kind; this.def = ENEMY[kind];
    this.hp = this.max = this.def.hp;
    this.x = x; this.y = y; this.z = z; this.hx = x; this.hz = z; this.campId = campId;
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.yaw = Math.random() * 6.28; this.state = kind === 'boss' ? 'sleep' : 'idle';
    this.timer = Math.random() * 2; this.dead = false; this.flash = 0; this.burn = 0; this.slow = 0; this.stagger = 0;
    this.hitDone = false; this.fade = 1; this.shown = 0; this.tele = null;
    this.group = new THREE.Group();
    this.mats = [];
    const M = (c, o) => { const m = MAT(c, o); this.mats.push(m); return m; };
    if (kind === 'slime') {
      const hue = [0x56c25a, 0x4fa7d8, 0xc65ad0][campId >= 0 ? campId % 3 : 0];
      this.core = new THREE.Mesh(new THREE.SphereGeometry(0.8, 14, 10), M(hue, { transparent: true, opacity: 0.88 }));
      this.core.position.y = 0.7; this.core.scale.set(1, 0.85, 1); this.core.castShadow = true; this.group.add(this.core);
      for (const sx of [-0.25, 0.25]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), MAT(0x101018)); e.position.set(sx, 0.85, 0.7); this.group.add(e); }
    } else if (kind === 'brute') {
      const dark = M(0x5a3d6e), skin = M(0x7b5a8a);
      const t = box(0.9, 1.0, 0.55, dark); t.position.y = 1.2; this.group.add(t);
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), skin); h.position.y = 1.95; h.castShadow = true; this.group.add(h);
      for (const sx of [-0.2, 0.2]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.35, 5), MAT(0xe8dcc0)); horn.position.set(sx, 2.3, 0); horn.rotation.z = -sx * 1.2; this.group.add(horn);
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff3030 })); eye.position.set(sx * 0.7, 1.98, 0.3); this.group.add(eye);
      }
      this.legL = box(0.3, 0.75, 0.3, dark); this.legL.position.set(-0.22, 0.38, 0); this.group.add(this.legL);
      this.legR = box(0.3, 0.75, 0.3, dark); this.legR.position.set(0.22, 0.38, 0); this.group.add(this.legR);
      this.arm = new THREE.Group(); this.arm.position.set(0.6, 1.55, 0);
      const am = box(0.24, 0.8, 0.24, skin); am.position.y = -0.4; this.arm.add(am);
      const club = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 1.2, 7), MAT(0x6a4a2a)); club.position.set(0, -0.8, 0.5); club.rotation.x = Math.PI / 2; this.arm.add(club);
      this.group.add(this.arm);
      const am2 = box(0.24, 0.8, 0.24, skin); am2.position.set(-0.6, 1.15, 0); this.group.add(am2);
    } else {
      const rock = M(0x6c6a66, { flatShading: true }), moss = M(0x5b7a44, { flatShading: true });
      const t = box(4.2, 4.6, 2.8, rock); t.position.y = 5.4; this.group.add(t);
      const sh = box(5.6, 1.3, 3.2, moss); sh.position.y = 7.7; this.group.add(sh);
      const h = box(1.8, 1.7, 1.8, rock); h.position.y = 8.9; this.group.add(h);
      for (const sx of [-0.5, 0.5]) { const e = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.1), new THREE.MeshBasicMaterial({ color: 0xff7a1c })); e.position.set(sx, 9.0, 0.92); this.group.add(e); }
      this.core = new THREE.Mesh(new THREE.OctahedronGeometry(0.8), new THREE.MeshBasicMaterial({ color: 0x7ff3ff }));
      this.core.position.set(0, 5.6, 1.45); this.group.add(this.core);
      this.legL = box(1.5, 3.1, 1.5, rock); this.legL.position.set(-1.2, 1.55, 0); this.group.add(this.legL);
      this.legR = box(1.5, 3.1, 1.5, rock); this.legR.position.set(1.2, 1.55, 0); this.group.add(this.legR);
      this.arm = new THREE.Group(); this.arm.position.set(3.2, 7.2, 0);
      const a1 = box(1.4, 4.4, 1.4, rock); a1.position.y = -2.2; this.arm.add(a1); this.group.add(this.arm);
      this.armL = new THREE.Group(); this.armL.position.set(-3.2, 7.2, 0);
      const a2 = box(1.4, 4.4, 1.4, rock); a2.position.y = -2.2; this.armL.add(a2); this.group.add(this.armL);
      this.group.scale.setScalar(1);
    }
    // barre de vie
    this.bar = new THREE.Group();
    const bgm = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.14), new THREE.MeshBasicMaterial({ color: 0x220a0a, depthTest: false, transparent: true }));
    this.fill = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 0.1), new THREE.MeshBasicMaterial({ color: 0xff4a4a, depthTest: false, transparent: true }));
    this.fill.position.z = 0.001; bgm.renderOrder = 998; this.fill.renderOrder = 999;
    this.bar.add(bgm, this.fill);
    this.bar.position.y = kind === 'boss' ? 12 : kind === 'brute' ? 2.8 : 1.8;
    if (kind === 'boss') this.bar.scale.setScalar(4);
    this.bar.visible = false;
    this.group.add(this.bar);
    this.group.position.set(x, y, z);
    scene.add(this.group);
    this.scene = scene;
  }

  hurt(dmg, dirx, dirz, opts = {}) {
    if (this.dead) return false;
    if (this.state === 'sleep') this.state = 'chase';
    this.hp -= dmg; this.flash = 0.18; this.shown = 6;
    const kb = this.kind === 'boss' ? 0 : opts.kb ?? 6;
    this.vx += dirx * kb; this.vz += dirz * kb;
    if (this.kind !== 'boss') { this.stagger = 0.35; if (this.state === 'wind') this.state = 'chase'; }
    if (opts.burn) this.burn = 3.5;
    if (opts.slow) this.slow = 3;
    if (this.hp <= 0) { this.dead = true; this.state = 'dead'; this.timer = 0; return true; }
    return false;
  }

  _move(world, tx, tz, speed, dt) {
    const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz) || 1;
    const sp = speed * (this.slow > 0 ? 0.4 : 1) * (this.stagger > 0 ? 0.2 : 1);
    let nx = this.x + (dx / d) * sp * dt, nz = this.z + (dz / d) * sp * dt;
    if (T.slopeAt(nx, nz, 2) > T.STEEP || T.heightAt(nx, nz) < T.WATER - 0.4) { nx = this.x; nz = this.z; }
    this.x = nx; this.z = nz;
  }

  update(dt, ctx) {
    const { world, player } = ctx;
    const d = ENEMY[this.kind];
    this.timer += dt;
    this.flash = Math.max(0, this.flash - dt); this.stagger = Math.max(0, this.stagger - dt); this.slow = Math.max(0, this.slow - dt);
    this.shown = Math.max(0, this.shown - dt);
    if (this.burn > 0) {
      this.burn -= dt;
      if (!this.dead && this.hurt(3 * dt, 0, 0, { kb: 0 })) ctx.onKill(this);
      if (Math.random() < dt * 14) ctx.fx.emit(this.x, this.y + 1.2, this.z, 1, 0xff7a1c, 1.5, 0.5, -2);
    }
    if (this.dead) {
      this.fade -= dt * 1.4;
      this.group.rotation.x = Math.min(1.4, this.group.rotation.x + dt * 5);
      this.group.position.y = this.y;
      if (this.fade <= 0) { this.scene.remove(this.group); this.gone = true; }
      for (const m of this.mats) { m.transparent = true; m.opacity = Math.max(0, this.fade); }
      return;
    }
    const pdx = player.x - this.x, pdz = player.z - this.z, pd = Math.hypot(pdx, pdz);
    const aggro = d.aggro * (ctx.night ? 1.25 : 1);
    const seen = pd < aggro && Math.abs(player.y - this.y) < 30 && !player.dead;

    // physique de base (pesanteur, élan)
    this.x += this.vx * dt; this.z += this.vz * dt;
    const k = Math.exp(-dt * (this.state === 'strike' && this.kind === 'slime' ? 0.6 : 6));
    this.vx *= k; this.vz *= k;
    const ground = world.surfaceHeight(this.x, this.z, this.y + 1);
    this.vy -= 26 * dt; this.y += this.vy * dt;
    if (this.y < ground) { this.y = ground; this.vy = 0; }

    switch (this.state) {
      case 'sleep':
        if (pd < 42) { this.state = 'chase'; ctx.onBossWake && ctx.onBossWake(this); }
        break;
      case 'idle':
        if (seen) { this.state = 'chase'; break; }
        if (this.timer > 2.5) { this.timer = 0; this.wx = this.hx + (Math.random() - 0.5) * 16; this.wz = this.hz + (Math.random() - 0.5) * 16; }
        if (this.wx !== undefined && Math.hypot(this.wx - this.x, this.wz - this.z) > 1) {
          this.yaw = Math.atan2(this.wx - this.x, this.wz - this.z); this._move(world, this.wx, this.wz, d.speed * 0.3, dt);
        }
        break;
      case 'chase': {
        if (!seen || Math.hypot(this.x - this.hx, this.z - this.hz) > 85) {
          if (Math.hypot(this.x - this.hx, this.z - this.hz) > 6) { this.yaw = Math.atan2(this.hx - this.x, this.hz - this.z); this._move(world, this.hx, this.hz, d.speed, dt); }
          else this.state = 'idle';
          break;
        }
        this.yaw = Math.atan2(pdx, pdz);
        const reach = this.kind === 'slime' ? 4.2 : this.kind === 'brute' ? 2.6 : 7.5;
        if (pd > reach * 0.7) this._move(world, player.x, player.z, d.speed, dt);
        if (pd < reach && this.stagger <= 0) {
          if (this.kind === 'boss') { this.attack = Math.random() < 0.5 ? 'slam' : 'sweep'; }
          this.state = 'wind'; this.timer = 0; this.hitDone = false;
        }
        break;
      }
      case 'wind': {
        this.yaw = Math.atan2(pdx, pdz);
        const w = this.kind === 'slime' ? 0.55 : this.kind === 'brute' ? 0.7 : this.attack === 'slam' ? 1.3 : 1.0;
        if (this.kind === 'boss' && this.attack === 'slam') {
          this.tele = { x: this.x + Math.sin(this.yaw) * 5.5, z: this.z + Math.cos(this.yaw) * 5.5, r: 7.5, t: this.timer / w };
        }
        if (this.timer >= w) {
          this.state = 'strike'; this.timer = 0;
          if (this.kind === 'slime') { this.vx = Math.sin(this.yaw) * 14; this.vz = Math.cos(this.yaw) * 14; this.vy = 7; }
          this.tele = null;
        }
        break;
      }
      case 'strike': {
        const dur = this.kind === 'slime' ? 0.6 : this.kind === 'brute' ? 0.35 : 0.5;
        if (!this.hitDone) {
          let hit = false;
          if (this.kind === 'slime') hit = pd < 1.8;
          else if (this.kind === 'brute') hit = this.timer > 0.1 && pd < 2.9 && Math.abs(angDiff(this.yaw, Math.atan2(pdx, pdz))) < 1.1;
          else if (this.attack === 'slam') {
            const cx = this.x + Math.sin(this.yaw) * 5.5, cz = this.z + Math.cos(this.yaw) * 5.5;
            if (this.timer > 0.05) { hit = Math.hypot(player.x - cx, player.z - cz) < 7.5 && player.y - this.y < 3; if (!hit) this.hitDone = true; ctx.fx.emit(cx, this.y + 0.5, cz, 30, 0xb0a890, 9, 0.7); ctx.shake(0.5); }
          } else hit = this.timer > 0.15 && pd < 8.5 && Math.abs(angDiff(this.yaw, Math.atan2(pdx, pdz))) < 1.2;
          if (hit) { this.hitDone = true; ctx.hurtPlayer(d.dmg, this.x, this.z); }
        }
        if (this.timer >= dur) { this.state = 'recover'; this.timer = 0; }
        break;
      }
      case 'recover':
        if (this.timer > (this.kind === 'boss' ? 1.1 : 0.7)) { this.state = 'chase'; this.timer = 0; }
        break;
    }

    // collisions avec les arbres, rochers...
    for (const c of world.nearColliders(this.x, this.z, 4)) {
      if (c.kind === 'tower' || this.y > c.y1 - 0.3) continue;
      const dx = this.x - c.x, dz = this.z - c.z, dd = Math.hypot(dx, dz), rr = c.r + d.radius;
      if (dd < rr && dd > 0.001) { this.x = c.x + (dx / dd) * rr; this.z = c.z + (dz / dd) * rr; }
    }

    // rendu
    const g = this.group;
    g.position.set(this.x, this.y, this.z);
    g.rotation.y = this.yaw; g.rotation.x = 0;
    const tt = ctx.time;
    if (this.kind === 'slime') {
      let sq = 1 + Math.sin(tt * 6 + this.x) * 0.05, sh = 0.85;
      if (this.state === 'wind') { const p = this.timer / 0.55; sh = 0.85 - p * 0.4; sq = 1 + p * 0.35; }
      else if (this.state === 'strike') { sh = 1.15; sq = 0.85; }
      this.core.scale.set(sq, sh, sq); this.core.position.y = 0.8 * sh;
    } else {
      const walk = this.state === 'chase' ? Math.sin(tt * 9) * 0.7 : 0;
      if (this.legL) { this.legL.rotation.x = walk; this.legR.rotation.x = -walk; }
      if (this.arm) {
        if (this.state === 'wind') this.arm.rotation.x = -2.8 * Math.min(1, this.timer / 0.7);
        else if (this.state === 'strike') this.arm.rotation.x = -2.8 + 4.2 * Math.min(1, this.timer / 0.3);
        else this.arm.rotation.x = walk * 0.6;
        if (this.armL) this.armL.rotation.x = this.state === 'wind' && this.attack === 'slam' ? -2.8 * Math.min(1, this.timer / 1.3) : this.arm.rotation.x * -0.5;
      }
      if (this.core) this.core.rotation.y += dt * 2;
    }
    const f = this.flash > 0 ? 1 : 0;
    for (const m of this.mats) { m.emissive.setRGB(f * 0.9 + (this.burn > 0 ? 0.35 : 0), f * 0.15 + (this.burn > 0 ? 0.1 : 0), f * 0.15 + (this.slow > 0 ? 0.5 : 0)); }
    this.bar.visible = this.shown > 0 && this.hp < this.max;
    if (this.bar.visible) {
      this.bar.quaternion.copy(ctx.camQuat);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
      this.bar.quaternion.premultiply(q);
      const r = clamp(this.hp / this.max, 0, 1);
      this.fill.scale.x = Math.max(0.001, r); this.fill.position.x = -(1 - r) * 0.68;
    }
  }
}
