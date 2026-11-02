// Construction du monde 3D : relief, eau, végétation, tours, sanctuaires, îles célestes...
import * as THREE from 'three';
import * as T from './terrain.js';
import { mulberry32, clamp } from './util.js';

const CELL = 24;
const lin = (c) => Math.pow(c, 2.2); // palette sRGB -> espace linéaire pour les couleurs de sommets
const MAT = (color, o = {}) => new THREE.MeshLambertMaterial({ color, ...o });
const BASIC = (color, o = {}) => new THREE.MeshBasicMaterial({ color, ...o });
const dummy = new THREE.Object3D();

export class World {
  constructor(scene) {
    this.scene = scene;
    this.grid = new Map();
    this.surfaces = [];          // fonctions (x,z,y) => hauteur | null (plates-formes dynamiques)
    this.interactables = [];
    this.towers = []; this.shrines = []; this.chests = []; this.camps = []; this.pickups = [];
    this.time = 0;
    this.buildTerrain();
    this.buildWater();
    this.buildTowers();
    this.buildShrines();
    this.buildIslands();
    this.buildCamps();
    this.buildBossArena();
    this.buildChests();
    this.buildLumis();
    this.buildWorkshop();
    this.buildVegetation();
  }

  /* ------------------------------ Collisions ------------------------------ */
  addCollider(c) {
    const k = Math.floor(c.x / CELL) + ',' + Math.floor(c.z / CELL);
    let a = this.grid.get(k);
    if (!a) { a = []; this.grid.set(k, a); }
    a.push(c);
    return c;
  }
  nearColliders(x, z, r) {
    const out = [];
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const a = this.grid.get(i + ',' + j);
      if (a) for (const c of a) out.push(c);
    }
    return out;
  }

  // Plus haute surface sur laquelle on peut se tenir en (x,z) pour un objet à la hauteur y
  surfaceHeight(x, z, y, skipDyn = false) {
    let best = T.heightAt(x, z);
    const step = y + 0.9;
    for (const t of this.towers) {
      if (Math.hypot(x - t.def.x, z - t.def.z) < 7.2) {
        const s = t.def.top + 0.6;
        if (s <= step && s > best) best = s;
      }
    }
    for (const is of T.ISLANDS) {
      const s = T.islandTop(is, x, z);
      if (s !== null && s <= step && s > best) best = s;
    }
    for (const c of this.nearColliders(x, z, 1)) {
      if (c.stand && Math.hypot(x - c.x, z - c.z) < c.r) {
        if (c.y1 <= step && c.y1 > best) best = c.y1;
      }
    }
    for (const f of skipDyn ? [] : this.surfaces) {
      const s = f(x, z, y);
      if (s !== null && s !== undefined && s <= step && s > best) best = s;
    }
    return best;
  }

  /* ------------------------------ Relief ------------------------------ */
  buildTerrain() {
    const SEG = 400;
    const geo = new THREE.PlaneGeometry(T.SIZE, T.SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, n = pos.count;
    const H = new Float32Array(n);
    for (let i = 0; i < n; i++) H[i] = T.heightAt(pos.getX(i), pos.getZ(i));
    const col = new Float32Array(n * 3), W = SEG + 1, cell = T.SIZE / SEG;
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const ix = i % W, iz = (i / W) | 0;
      const hx = H[Math.min(W - 1, ix + 1) + iz * W] - H[Math.max(0, ix - 1) + iz * W];
      const hz = H[ix + Math.min(W - 1, iz + 1) * W] - H[ix + Math.max(0, iz - 1) * W];
      const slope = Math.hypot(hx, hz) / (2 * cell);
      pos.setY(i, H[i]);
      const c = T.colorAt(x, z, H[i], slope);
      col[i * 3] = lin(c[0]); col[i * 3 + 1] = lin(c[1]); col[i * 3 + 2] = lin(c[2]);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    this.terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);
  }

  buildWater() {
    const g = new THREE.PlaneGeometry(6000, 6000);
    g.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(g, new THREE.MeshPhongMaterial({
      color: 0x2f9fc4, transparent: true, opacity: 0.8, shininess: 110, specular: 0x9fd8ff,
    }));
    this.water.position.y = T.WATER - 0.15;
    this.water.renderOrder = 1;
    this.scene.add(this.water);
  }

  /* ------------------------------ Végétation ------------------------------ */
  buildVegetation() {
    const rnd = mulberry32(555);
    const avoid = [[0, 0, 22], [T.WORKSHOP.x, T.WORKSHOP.z, 28], [T.BOSS.x, T.BOSS.z, 36],
      ...T.TOWERS.map((t) => [t.x, t.z, 14]), ...T.SHRINES.filter((s) => s.island < 0).map((s) => [s.x, s.z, 12]),
      ...T.CAMPS.map((c) => [c.x, c.z, 18]), ...T.CHESTS.filter((c) => !c.sky).map((c) => [c.x, c.z, 3])];
    const blocked = (x, z) => avoid.some((a) => Math.hypot(x - a[0], z - a[1]) < a[2]);

    const trees = []; // {x,y,z,s,type,col}
    const cacti = [], rocks = [];
    const col = new THREE.Color();
    const addApples = (x, y, z) => {
      for (let k = 0; k < 2; k++) {
        const a = rnd() * 6.28;
        this.addPickup('apple', x + Math.cos(a) * 1.6, y, z + Math.sin(a) * 1.6);
      }
    };

    for (let gz = -690; gz <= 690; gz += 9) for (let gx = -690; gx <= 690; gx += 9) {
      const x = gx + (rnd() - 0.5) * 8, z = gz + (rnd() - 0.5) * 8;
      const r = rnd();
      if (r > 0.65) continue;
      const h = T.heightAt(x, z);
      if (h < 1.8 || h > 98) continue;
      const slope = T.slopeAt(x, z, 2);
      if (slope > 0.55 || blocked(x, z)) continue;
      const b = T.biomeAt(x, z, h, slope);
      const s = 0.8 + rnd() * 0.9;
      if (b === T.BIOME.FOREST && r < 0.6) {
        const pine = rnd() < 0.35, autumn = !pine && rnd() < 0.12;
        if (pine) col.setHSL(0.36 + rnd() * 0.04, 0.4, 0.2 + rnd() * 0.07);
        else if (autumn) col.setHSL(0.05 + rnd() * 0.04, 0.7, 0.45);
        else col.setHSL(0.24 + rnd() * 0.07, 0.5, 0.3 + rnd() * 0.08);
        trees.push({ x, y: h, z, s, type: pine ? 1 : 0, c: col.clone() });
        if (!pine && !autumn && rnd() < 0.07) addApples(x, h, z);
      } else if (b === T.BIOME.GRASS && r < 0.07) {
        col.setHSL(0.26 + rnd() * 0.05, 0.5, 0.36);
        trees.push({ x, y: h, z, s, type: 0, c: col.clone() });
      } else if (b === T.BIOME.SNOW && r < 0.12) {
        col.setHSL(0.5, 0.15, 0.82);
        trees.push({ x, y: h, z, s, type: 1, c: col.clone() });
      } else if (b === T.BIOME.ROCK && r < 0.03) {
        col.setHSL(0.37, 0.3, 0.2);
        trees.push({ x, y: h, z, s, type: 1, c: col.clone() });
      } else if (b === T.BIOME.DESERT && r < 0.05) {
        cacti.push({ x, y: h, z, s });
      }
      if (b === T.BIOME.FOREST && r > 0.62 && rnd() < 0.12) this.addPickup('mushroom', x, h, z);
    }
    // arbres décoratifs sur les îles
    T.ISLANDS.forEach((is, i) => {
      const r2 = mulberry32(300 + i);
      for (let k = 0; k < 7; k++) {
        const a = r2() * 6.28, d = 14 + r2() * (is.r - 18);
        col.setHSL(0.25 + r2() * 0.08, 0.55, 0.36);
        trees.push({ x: is.x + Math.cos(a) * d, y: is.y, z: is.z + Math.sin(a) * d, s: 0.9 + r2() * 0.6, type: r2() < 0.3 ? 1 : 0, c: col.clone() });
      }
    });

    // rochers
    for (let k = 0; k < 900 && rocks.length < 520; k++) {
      const x = (rnd() - 0.5) * 1300, z = (rnd() - 0.5) * 1300;
      const h = T.heightAt(x, z);
      if (h < 1.2 || h > 105 || blocked(x, z)) continue;
      const slope = T.slopeAt(x, z, 2);
      const b = T.biomeAt(x, z, h, slope);
      if (b !== T.BIOME.ROCK && b !== T.BIOME.SNOW && rnd() > 0.2) continue;
      const sx = 1.3 + rnd() * 3.6, sy = 0.9 + rnd() * 2.8, sz = sx * (0.7 + rnd() * 0.5);
      const g = 0.45 + rnd() * 0.12;
      const c = b === T.BIOME.DESERT || b === T.BIOME.SAND ? new THREE.Color(0.7, 0.55, 0.38) : b === T.BIOME.SNOW ? new THREE.Color(0.85, 0.88, 0.95) : new THREE.Color(g, g * 0.98, g * 0.93);
      rocks.push({ x, y: h, z, sx, sy, sz, rot: rnd() * 6.28, c });
    }

    // --- Instanced meshes ---
    const mk = (geo, mat, list, place, color) => {
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      list.forEach((it, i) => {
        place(it);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
        if (color) m.setColorAt(i, color(it));
      });
      m.count = list.length;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
      this.scene.add(m);
      return m;
    };
    const trunkG = new THREE.CylinderGeometry(0.28, 0.42, 1, 6); trunkG.translate(0, 0.5, 0);
    const roundG = new THREE.IcosahedronGeometry(1, 1);
    const coneA = new THREE.ConeGeometry(1.9, 3.6, 7), coneB = new THREE.ConeGeometry(1.3, 3.0, 7);
    const trunkMat = MAT(0x6b4a2c);
    const foliage = MAT(0xffffff, { flatShading: true });
    mk(trunkG, trunkMat, trees, (t) => {
      dummy.position.set(t.x, t.y - 0.3, t.z); dummy.rotation.set(0, 0, 0);
      dummy.scale.set(t.s, (t.type ? 4.2 : 3.2) * t.s, t.s);
    });
    const round = trees.filter((t) => t.type === 0), pine = trees.filter((t) => t.type === 1);
    mk(roundG, foliage, round, (t) => {
      dummy.position.set(t.x, t.y + 3.6 * t.s, t.z); dummy.rotation.set(0, t.x, 0);
      dummy.scale.set(2.4 * t.s, 2.0 * t.s, 2.4 * t.s);
    }, (t) => t.c);
    mk(coneA, foliage, pine, (t) => {
      dummy.position.set(t.x, t.y + 3.4 * t.s, t.z); dummy.rotation.set(0, 0, 0);
      dummy.scale.set(t.s, t.s, t.s);
    }, (t) => t.c);
    mk(coneB, foliage, pine, (t) => {
      dummy.position.set(t.x, t.y + 5.6 * t.s, t.z); dummy.rotation.set(0, 0, 0);
      dummy.scale.set(t.s, t.s, t.s);
    }, (t) => t.c);
    trees.forEach((t) => this.addCollider({ x: t.x, z: t.z, r: 0.55 * t.s + 0.1, y0: t.y - 1, y1: t.y + 14, kind: 'tree' }));

    if (cacti.length) {
      const cg = new THREE.CylinderGeometry(0.45, 0.5, 1, 7); cg.translate(0, 0.5, 0);
      mk(cg, MAT(0x4f9a4a), cacti, (c) => {
        dummy.position.set(c.x, c.y - 0.2, c.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(c.s, 3.4 * c.s, c.s);
      });
      cacti.forEach((c) => this.addCollider({ x: c.x, z: c.z, r: 0.6 * c.s, y0: c.y - 1, y1: c.y + 4, kind: 'cactus' }));
    }

    const rockG = new THREE.DodecahedronGeometry(1, 0);
    mk(rockG, MAT(0xffffff, { flatShading: true }), rocks, (r) => {
      dummy.position.set(r.x, r.y + r.sy * 0.35, r.z); dummy.rotation.set(0, r.rot, 0); dummy.scale.set(r.sx, r.sy, r.sz);
    }, (r) => r.c);
    rocks.forEach((r) => this.addCollider({ x: r.x, z: r.z, r: Math.max(r.sx, r.sz) * 0.8, y0: r.y - 1, y1: r.y + r.sy * 1.05, stand: true, kind: 'rock' }));
  }

  /* ------------------------------ Tours ------------------------------ */
  buildTowers() {
    T.TOWERS.forEach((d) => {
      const g = new THREE.Group();
      g.position.set(d.x, d.y, d.z);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 4.6, T.TOWER_H + 3, 8), MAT(0xb9b2a4, { flatShading: true }));
      body.position.y = (T.TOWER_H + 3) / 2 - 3; body.castShadow = body.receiveShadow = true;
      g.add(body);
      const glow = BASIC(0xff9a3c);
      for (let k = 1; k <= 4; k++) {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(4.0 + (1 - k / 5) * 0.4, 4.0 + (1 - k / 5) * 0.4, 0.5, 8), glow);
        ring.position.y = k * 9; g.add(ring);
      }
      const plat = new THREE.Mesh(new THREE.CylinderGeometry(7.4, 6.2, 1.2, 14), MAT(0x9d9588, { flatShading: true }));
      plat.position.y = T.TOWER_H; plat.castShadow = plat.receiveShadow = true; g.add(plat);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.5), MAT(0x8a8376));
        post.position.set(Math.cos(a) * 7, T.TOWER_H + 1.4, Math.sin(a) * 7); g.add(post);
      }
      const orb = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 12), glow.clone());
      orb.position.y = T.TOWER_H + 3.8; g.add(orb);
      const beamMat = BASIC(0xff9a3c, { transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 500, 8, 1, true), beamMat);
      beam.position.y = T.TOWER_H + 250; g.add(beam);
      this.scene.add(g);
      this.addCollider({ x: d.x, z: d.z, r: d.r + 0.1, y0: d.y - 3, y1: d.top, kind: 'tower', ref: d });
      const rec = { def: d, group: g, glow, orb, beamMat, active: false };
      this.towers.push(rec);
      this.interactables.push({ kind: 'tower', id: d.id, x: d.x, y: d.top + 0.6, z: d.z, r: 7.0 });
    });
  }
  setTowerActive(i, on = true) {
    const t = this.towers[i]; if (!t) return;
    t.active = on;
    const c = on ? 0x35d8ff : 0xff9a3c;
    t.glow.color.setHex(c); t.orb.material.color.setHex(c); t.beamMat.color.setHex(c);
  }

  /* ------------------------------ Sanctuaires ------------------------------ */
  buildShrines() {
    T.SHRINES.forEach((d) => {
      const g = new THREE.Group();
      g.position.set(d.x, d.y, d.z);
      g.rotation.y = (d.seed % 628) / 100;
      const stone = MAT(0x7c8794, { flatShading: true });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.4, 0.9, 12), stone);
      base.position.y = 0.2; base.receiveShadow = base.castShadow = true; g.add(base);
      for (const sx of [-2.2, 2.2]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(1, 5.2, 1), stone);
        p.position.set(sx, 3.1, 0); p.castShadow = true; g.add(p);
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(5.8, 1, 1.2), stone);
      lintel.position.y = 6; lintel.castShadow = true; g.add(lintel);
      const glow = BASIC(0xff9a3c, { side: THREE.DoubleSide });
      const door = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 5), glow);
      door.position.set(0, 3.1, 0); g.add(door);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.7), glow);
      gem.position.y = 7.3; g.add(gem);
      const beamMat = BASIC(0xff9a3c, { transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 400, 8, 1, true), beamMat);
      beam.position.y = 200; g.add(beam);
      this.scene.add(g);
      this.shrines.push({ def: d, group: g, glow, gem, beamMat, state: 0 });
      this.interactables.push({ kind: 'shrine', id: d.id, x: d.x, y: d.y, z: d.z, r: 5.5 });
    });
  }
  // 0 = inconnu (orange), 1 = épreuve réussie (cyan)
  setShrineState(i, s) {
    const sh = this.shrines[i]; if (!sh) return;
    sh.state = s;
    const c = s ? 0x35d8ff : 0xff9a3c;
    sh.glow.color.setHex(c); sh.beamMat.color.setHex(c);
  }

  /* ------------------------------ Îles célestes ------------------------------ */
  buildIslands() {
    T.ISLANDS.forEach((is, i) => {
      const g = new THREE.Group();
      g.position.set(is.x, is.y, is.z);
      const top = new THREE.Mesh(
        new THREE.CylinderGeometry(is.r, is.r * 0.95, 3, 28),
        [MAT(0x7a5c3c, { flatShading: true }), MAT(0x78b043), MAT(0x7a5c3c)]
      );
      top.position.y = -1.5; top.receiveShadow = top.castShadow = true; g.add(top);
      const under = new THREE.Mesh(new THREE.ConeGeometry(is.r * 0.95, is.r * 1.15, 12), MAT(0x6d5a48, { flatShading: true }));
      under.rotation.x = Math.PI; under.position.y = -3 - is.r * 0.575; under.castShadow = true; g.add(under);
      // cristaux
      const crystalMat = BASIC(0x7ff3ff, { transparent: true, opacity: 0.9 });
      for (let k = 0; k < 4; k++) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.7 + k * 0.1, 3 + k * 0.8, 5), crystalMat);
        const a = k * 1.7 + i;
        c.position.set(Math.cos(a) * (is.r * 0.55) + 4, 1.4 + k * 0.3, Math.sin(a) * (is.r * 0.55)); c.rotation.z = (k - 1.5) * 0.15;
        g.add(c);
      }
      // roches flottantes
      for (let k = 0; k < 6; k++) {
        const r = 1.2 + (k % 3) * 0.9;
        const f = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), MAT(0x77695a, { flatShading: true }));
        const a = k * 1.05 + i * 0.7, d = is.r + 8 + (k % 2) * 7;
        f.position.set(Math.cos(a) * d, -4 + (k % 3) * 4, Math.sin(a) * d); g.add(f);
      }
      this.scene.add(g);
    });
  }

  /* ------------------------------ Camps ennemis ------------------------------ */
  buildCamps() {
    T.CAMPS.forEach((d) => {
      const g = new THREE.Group();
      g.position.set(d.x, d.y, d.z);
      const cloth = [MAT(0x7a3b2e), MAT(0x5b4a2e), MAT(0x6a2f4a)];
      for (let k = 0; k < 3; k++) {
        const a = k * 2.1 + d.id, tent = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.8, 5), cloth[k]);
        tent.position.set(Math.cos(a) * 7, 1.2, Math.sin(a) * 7); tent.castShadow = true; g.add(tent);
      }
      const fireMat = BASIC(0xff7a1c);
      const fire = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.4, 6), fireMat);
      fire.position.y = 0.8; g.add(fire);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.22, 6, 10), MAT(0x555555));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.2; g.add(ring);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 5), MAT(0x4a3220));
      pole.position.set(-4, 3, 4); g.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.2), MAT(0x8a1a2a, { side: THREE.DoubleSide }));
      flag.position.set(-3, 5.3, 4); g.add(flag);
      for (let k = 0; k < 3; k++) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), MAT(0x9a6b3a));
        c.position.set(3 + k * 1.2, 0.55, -3 + (k % 2)); c.rotation.y = k; c.castShadow = true; g.add(c);
      }
      this.scene.add(g);
      this.camps.push({ def: d, group: g, fireMat, cleared: false });
    });
  }
  setCampCleared(i) {
    const c = this.camps[i]; if (!c) return;
    c.cleared = true; c.fireMat.color.setHex(0x333333);
  }

  buildBossArena() {
    const b = T.BOSS, stone = MAT(0x6f6c68, { flatShading: true });
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2, x = b.x + Math.cos(a) * 27, z = b.z + Math.sin(a) * 27;
      const h = T.heightAt(x, z);
      const s = new THREE.Mesh(new THREE.BoxGeometry(2, 7 + (k % 3) * 2, 1.4), stone);
      s.position.set(x, h + 3, z); s.rotation.y = -a; s.castShadow = true; this.scene.add(s);
      this.addCollider({ x, z, r: 1.2, y0: h - 1, y1: h + 8, kind: 'stone' });
    }
  }

  /* ------------------------------ Coffres ------------------------------ */
  buildChests() {
    const woods = [0x8a5a2b, 0x9fa6b0, 0xd9a82a];
    T.CHESTS.forEach((d) => {
      const g = new THREE.Group();
      g.position.set(d.x, d.y, d.z);
      g.rotation.y = d.id * 1.9;
      const m = MAT(woods[d.tier]);
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 1), m);
      body.position.y = 0.45; body.castShadow = true; g.add(body);
      const lidPivot = new THREE.Group(); lidPivot.position.set(0, 0.9, -0.5);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 10, 1, false, 0, Math.PI), m);
      lid.rotation.z = Math.PI / 2; lid.rotation.y = Math.PI / 2; lid.position.set(0, 0, 0.5);
      lidPivot.add(lid);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, 1.05), MAT(0x333a44));
      band.position.set(0, 0.45, 0); g.add(band);
      g.add(lidPivot);
      const gl = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), BASIC(d.tier === 2 ? 0x7ff3ff : d.tier === 1 ? 0xffe27a : 0xffffff));
      gl.position.set(0, 1.6, 0); g.add(gl);
      this.scene.add(g);
      this.chests.push({ def: d, group: g, lid: lidPivot, gem: gl, open: false, t: 0 });
      this.interactables.push({ kind: 'chest', id: d.id, x: d.x, y: d.y, z: d.z, r: 2.6 });
    });
  }
  openChest(i) {
    const c = this.chests[i]; if (!c) return;
    c.open = true; c.gem.visible = false;
  }

  /* ------------------------------ Lumis (esprits lumineux) ------------------------------ */
  buildLumis() {
    const n = T.LUMIS.length;
    this.lumiCore = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.3), BASIC(0xc8fbff), n);
    this.lumiGlow = new THREE.InstancedMesh(new THREE.SphereGeometry(0.8, 8, 6),
      BASIC(0x4fe3ff, { transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending }), n);
    this.lumiCore.frustumCulled = this.lumiGlow.frustumCulled = false;
    this.lumiGone = new Array(n).fill(false);
    this.scene.add(this.lumiCore, this.lumiGlow);
    this.updateLumis(0);
  }
  updateLumis(t) {
    T.LUMIS.forEach((l, i) => {
      if (this.lumiGone[i]) dummy.scale.set(0, 0, 0);
      else dummy.scale.set(1, 1, 1);
      dummy.position.set(l.x, l.y + Math.sin(t * 2 + i) * 0.35, l.z);
      dummy.rotation.set(t, t * 1.3 + i, 0);
      dummy.updateMatrix();
      this.lumiCore.setMatrixAt(i, dummy.matrix);
      this.lumiGlow.setMatrixAt(i, dummy.matrix);
    });
    this.lumiCore.instanceMatrix.needsUpdate = true;
    this.lumiGlow.instanceMatrix.needsUpdate = true;
  }
  collectLumi(i) { this.lumiGone[i] = true; }

  /* ------------------------------ Atelier de départ ------------------------------ */
  buildWorkshop() {
    const w = T.WORKSHOP;
    const dock = new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, 7), MAT(0x9b7142));
    dock.position.set(w.x, w.y + 0.02, w.z); dock.receiveShadow = true; this.scene.add(dock);
    this.addCollider({ x: w.x, z: w.z, r: 3.4, y0: w.y - 1, y1: w.y + 0.17, stand: true, kind: 'dock' });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.6, 6), MAT(0x4a3220));
    post.position.set(w.x - 5, w.y + 1.3, w.z + 3); this.scene.add(post);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.8, 0.12), MAT(0xc79a58));
    sign.position.set(w.x - 5, w.y + 2.3, w.z + 3); this.scene.add(sign);
  }

  /* ------------------------------ Objets à ramasser ------------------------------ */
  addPickup(kind, x, y, z, data) {
    let mesh;
    if (kind === 'apple') mesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), MAT(0xd8332a));
    else if (kind === 'mushroom') mesh = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.4, 7), MAT(0x4aa5e8, { emissive: 0x112244 }));
    else if (kind === 'weapon') mesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.2, 0.15), MAT(0xc9ced6));
    else mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), BASIC(kind === 'crystal_fire' ? 0xff6a2a : 0x8fe8ff));
    mesh.position.set(x, y + (kind === 'weapon' ? 0.9 : 0.45), z);
    mesh.castShadow = true;
    this.scene.add(mesh);
    const p = { kind, x, y, z, mesh, data, taken: false, id: this.pickups.length };
    this.pickups.push(p);
    return p;
  }
  removePickup(p) { p.taken = true; this.scene.remove(p.mesh); }

  ring(color = 0xffc23c) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(3, 0.22, 8, 28), BASIC(color, { transparent: true, opacity: 0.95 }));
    m.visible = false; this.scene.add(m);
    return m;
  }

  /* ------------------------------ Animation ------------------------------ */
  update(dt, tNow, focus) {
    this.time = tNow;
    this.updateLumis(tNow);
    for (const t of this.towers) t.orb.rotation.y += dt;
    for (const s of this.shrines) { s.gem.rotation.y += dt * 1.5; s.gem.position.y = 7.3 + Math.sin(tNow * 2 + s.def.id) * 0.2; }
    for (const c of this.chests) {
      const target = c.open ? 1 : 0;
      c.t += (target - c.t) * Math.min(1, dt * 5);
      c.lid.rotation.x = -c.t * 1.7;
      if (!c.open) c.gem.position.y = 1.6 + Math.sin(tNow * 3 + c.def.id) * 0.1;
    }
    for (const p of this.pickups) {
      if (p.taken) continue;
      p.mesh.rotation.y += dt * 1.6;
      p.mesh.position.y = p.y + (p.kind === 'weapon' ? 0.9 : 0.45) + Math.sin(tNow * 2.5 + p.id) * 0.06;
    }
    this.water.material.opacity = 0.78 + Math.sin(tNow * 0.8) * 0.03;
    this.water.position.x = Math.round(focus.x / 40) * 0; // l'eau couvre tout : pas de suivi nécessaire
  }
}
