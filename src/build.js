// Pouvoirs de construction : Main-Mère (saisir / assembler), Rappel, hélices, ballons, radeaux...
import * as THREE from 'three';
import * as T from './terrain.js';
import { clamp } from './util.js';

export const PARTS = {
  crate:   { name: 'Caisse',  size: [1.4, 1.4, 1.4], mass: 1.0,  color: 0xa4743c },
  plank:   { name: 'Planche', size: [4.0, 0.35, 1.2], mass: 0.6, color: 0xc29a5e },
  barrel:  { name: 'Tonneau', size: [1.1, 1.4, 1.1], mass: 0.8,  color: 0x7a5530 },
  fan:     { name: 'Hélice',  size: [1.2, 1.2, 1.2], mass: 0.7,  color: 0x5d7a96, fan: true },
  balloon: { name: 'Ballon',  size: [1.8, 2.0, 1.8], mass: 0.15, color: 0xe8483a, balloon: true },
};
const G = 14, HALFPI = Math.PI / 2;
const rotX = (lx, lz, yaw) => lx * Math.cos(yaw) + lz * Math.sin(yaw);
const rotZ = (lx, lz, yaw) => -lx * Math.sin(yaw) + lz * Math.cos(yaw);
const unrotX = (dx, dz, yaw) => dx * Math.cos(yaw) - dz * Math.sin(yaw);
const unrotZ = (dx, dz, yaw) => dx * Math.sin(yaw) + dz * Math.cos(yaw);

let NEXT = 1;

export class Builder {
  constructor(scene, world, fx, sfx) {
    this.scene = scene; this.world = world; this.fx = fx; this.sfx = sfx;
    this.groups = [];
    this.held = null; this.hover = null; this.recalling = null;
    this.holdDist = 6; this.holdYaw = 0;
    world.surfaces.push((x, z, y) => this.surfaceAt(x, z, y));
  }

  /* ---------- création ---------- */
  makeMesh(def) {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: def.color });
    const [w, h, d] = def.size;
    let spin = null;
    if (def === PARTS.barrel) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, h, 10), mat); b.castShadow = true; g.add(b);
      for (const y of [-0.35, 0.35]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.57, 0.57, 0.1, 10), new THREE.MeshLambertMaterial({ color: 0x333a44 })); r.position.y = y; g.add(r); }
    } else if (def === PARTS.balloon) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.9, 14, 10), mat); b.scale.y = 1.1; b.castShadow = true; g.add(b);
      const k = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.3, 6), mat); k.position.y = -1.05; k.rotation.x = Math.PI; g.add(k);
    } else if (def === PARTS.fan) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d * 0.6), mat); b.castShadow = true; g.add(b);
      spin = new THREE.Group(); spin.position.z = d * 0.36;
      for (let i = 0; i < 3; i++) {
        const bl = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, 0.05), new THREE.MeshLambertMaterial({ color: 0xdfe6ee }));
        bl.position.y = 0.5; const holder = new THREE.Group(); holder.rotation.z = (i / 3) * Math.PI * 2; holder.add(bl); spin.add(holder);
      }
      g.add(spin);
      const hub = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshLambertMaterial({ color: 0x333a44 })); hub.position.z = d * 0.36; g.add(hub);
    } else {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); b.castShadow = b.receiveShadow = true; g.add(b);
      if (def === PARTS.crate) {
        const edge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.12, d + 0.04), new THREE.MeshLambertMaterial({ color: 0x6a4a26 }));
        edge.position.y = 0; g.add(edge);
      }
    }
    return { mesh: g, mat, spin };
  }

  addGroup(defKey, x, y, z, yaw = 0) {
    const def = PARTS[defKey];
    const gr = { id: NEXT++, x, y, z, yaw, vx: 0, vy: 0, vz: 0, parts: [], power: false, held: false, hist: [], histT: 0, throttle: 0, mass: 1, fans: 0, balloons: 0 };
    gr.node = new THREE.Group();
    gr.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 6), new THREE.MeshBasicMaterial({ color: 0xffd23c }));
    gr.arrow.rotation.x = HALFPI; gr.arrow.visible = false; gr.node.add(gr.arrow);
    this.scene.add(gr.node);
    this.addPart(gr, def, 0, 0, 0, 0);
    this.refresh(gr);
    this.groups.push(gr);
    return gr;
  }
  addPart(gr, def, ox, oy, oz, pq) {
    const m = this.makeMesh(def);
    m.mesh.position.set(ox, oy, oz); m.mesh.rotation.y = pq * HALFPI;
    gr.node.add(m.mesh);
    const p = { def, ox, oy, oz, pq, mesh: m.mesh, mat: m.mat, spin: m.spin };
    gr.parts.push(p);
    return p;
  }
  half(p) { const [w, h, d] = p.def.size; const odd = p.pq & 1; return [(odd ? d : w) / 2, h / 2, (odd ? w : d) / 2]; }
  refresh(gr) {
    gr.mass = 0; gr.fans = 0; gr.balloons = 0;
    let maxZ = 0, topY = -1e9;
    for (const p of gr.parts) {
      gr.mass += p.def.mass; if (p.def.fan) gr.fans++; if (p.def.balloon) gr.balloons++;
      const h = this.half(p); maxZ = Math.max(maxZ, p.oz + h[2]); topY = Math.max(topY, p.oy + h[1]);
    }
    gr.arrow.visible = gr.fans > 0;
    gr.arrow.position.set(0, topY + 0.4, maxZ + 0.2);
  }

  spawnWorkshop() {
    const w = T.WORKSHOP, base = w.y + 0.3;
    const list = [['crate', -3.4, -1.6], ['crate', -1.6, -1.8], ['crate', 0.2, -1.7], ['crate', 2.0, -1.6], ['plank', -3, 1.6], ['plank', 1.5, 1.8], ['plank', 4.2, 1.2],
      ['barrel', 4.2, -1.5], ['barrel', 5.5, -0.2], ['fan', -4.2, 0.2], ['fan', -4.2, 1.6], ['balloon', 0.2, 0.2], ['balloon', 2.2, 0.2]];
    list.forEach(([k, dx, dz], i) => {
      const def = PARTS[k];
      this.addGroup(k, w.x + dx, base + def.size[1] / 2, w.z + dz, (i % 3) * 0.05);
    });
  }

  /* ---------- géométrie ---------- */
  partWorld(gr, p) { return { x: gr.x + rotX(p.ox, p.oz, gr.yaw), y: gr.y + p.oy, z: gr.z + rotZ(p.ox, p.oz, gr.yaw) }; }
  toLocal(gr, x, z) { const dx = x - gr.x, dz = z - gr.z; return { x: unrotX(dx, dz, gr.yaw), z: unrotZ(dx, dz, gr.yaw) }; }
  toWorld(gr, lx, lz) { return { x: gr.x + rotX(lx, lz, gr.yaw), z: gr.z + rotZ(lx, lz, gr.yaw) }; }

  raycast(ox, oy, oz, dx, dy, dz, maxD = 18) {
    let best = null;
    for (const gr of this.groups) {
      const rx = ox - gr.x, rz = oz - gr.z;
      const o = [unrotX(rx, rz, gr.yaw), oy - gr.y, unrotZ(rx, rz, gr.yaw)];
      const d = [unrotX(dx, dz, gr.yaw), dy, unrotZ(dx, dz, gr.yaw)];
      for (const p of gr.parts) {
        const h = this.half(p), c = [p.ox, p.oy, p.oz];
        let t0 = 0, t1 = maxD, ok = true;
        for (let a = 0; a < 3; a++) {
          const lo = c[a] - h[a], hi = c[a] + h[a];
          if (Math.abs(d[a]) < 1e-8) { if (o[a] < lo || o[a] > hi) { ok = false; break; } }
          else {
            let ta = (lo - o[a]) / d[a], tb = (hi - o[a]) / d[a];
            if (ta > tb) [ta, tb] = [tb, ta];
            t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
            if (t0 > t1) { ok = false; break; }
          }
        }
        if (ok && (!best || t0 < best.t)) best = { group: gr, part: p, t: t0 };
      }
    }
    return best;
  }

  /* ---------- saisir / relâcher ---------- */
  grab(gr, dist, camYaw) {
    this.held = gr; gr.held = true; gr.power = false;
    this.holdDist = clamp(dist, 3, 16); this.holdYaw = gr.yaw - camYaw;
    this.sfx.glue();
  }
  release() {
    if (!this.held) return;
    this.held.held = false; this.held.vx = this.held.vy = this.held.vz = 0;
    this.held = null;
  }
  rotateHeld(d) { this.holdYaw += d; }
  adjustDist(d) { this.holdDist = clamp(this.holdDist + d, 3, 16); }
  updateHeld(camPos, dir, camYaw) {
    const g = this.held; if (!g) return;
    g.x = camPos.x + dir.x * this.holdDist; g.y = camPos.y + dir.y * this.holdDist; g.z = camPos.z + dir.z * this.holdDist;
    g.yaw = camYaw + this.holdYaw;
    let minB = 1e9;
    for (const p of g.parts) minB = Math.min(minB, p.oy - this.half(p)[1]);
    const floor = this.world.surfaceHeight(g.x, g.z, g.y + 5, true) + 0.05;
    if (g.y + minB < floor) g.y = floor - minB;
  }

  gap(a, pa, b, pb, q) {
    const wa = this.partWorld(a, pa), wb = this.partWorld(b, pb);
    const dx = wb.x - wa.x, dz = wb.z - wa.z;
    const l = [unrotX(dx, dz, a.yaw), wb.y - wa.y, unrotZ(dx, dz, a.yaw)];
    const ha = this.half(pa), hb = this.half({ def: pb.def, pq: (pb.pq + q) & 3 });
    const s = [ha[0] + hb[0], ha[1] + hb[1], ha[2] + hb[2]];
    const g = [Math.abs(l[0]) - s[0], Math.abs(l[1]) - s[1], Math.abs(l[2]) - s[2]];
    return { l, s, g, gap: Math.max(g[0], g[1], g[2]) };
  }

  // Colle le groupe tenu au groupe le plus proche. Renvoie true si réussi.
  glue() {
    const b = this.held; if (!b) return false;
    let best = null;
    for (const a of this.groups) {
      if (a === b) continue;
      const q = Math.round((b.yaw - a.yaw) / HALFPI);
      for (const pa of a.parts) for (const pb of b.parts) {
        const r = this.gap(a, pa, b, pb, q);
        if (!best || r.gap < best.r.gap) best = { a, q, pa, pb, r };
      }
    }
    if (!best || best.r.gap > 1.1) return false;
    const { a, q, r } = best;
    // axe de séparation = celui où l'écart est maximal
    let ax = 0; for (let i = 1; i < 3; i++) if (r.g[i] > r.g[ax]) ax = i;
    const nl = r.l.slice();
    nl[ax] = Math.sign(r.l[ax] || 1) * r.s[ax];
    for (let i = 0; i < 3; i++) if (i !== ax) nl[i] = Math.abs(r.l[i]) < 0.5 ? 0 : Math.round(r.l[i] / 0.35) * 0.35;
    b.yaw = a.yaw + q * HALFPI;
    const dl = [nl[0] - r.l[0], nl[1] - r.l[1], nl[2] - r.l[2]];
    b.x += rotX(dl[0], dl[2], a.yaw); b.z += rotZ(dl[0], dl[2], a.yaw); b.y += dl[1];
    for (const p of b.parts) {
      const w = this.partWorld(b, p), lc = this.toLocal(a, w.x, w.z);
      const np = this.addPart(a, p.def, lc.x, w.y - a.y, lc.z, (p.pq + q) & 3);
      np.mat.emissive.setHex(0x113322);
    }
    this.scene.remove(b.node);
    this.groups.splice(this.groups.indexOf(b), 1);
    this.held = null; a.held = false;
    this.refresh(a);
    this.sfx.glue();
    this.fx.emit(a.x, a.y + 1, a.z, 14, 0xffd23c, 3, 0.5);
    return true;
  }

  detach(hit) {
    const g = hit.group; if (g.parts.length < 2) return false;
    const p = hit.part, w = this.partWorld(g, p);
    g.parts.splice(g.parts.indexOf(p), 1); g.node.remove(p.mesh);
    const ng = this.addGroup(Object.keys(PARTS).find((k) => PARTS[k] === p.def), w.x, w.y, w.z, g.yaw + p.pq * HALFPI);
    ng.vy = 2; ng.x += 0.3;
    this.refresh(g);
    this.sfx.glue();
    return true;
  }

  /* ---------- surfaces & collisions avec le joueur ---------- */
  surfaceAt(x, z, y) {
    let best = null;
    for (const gr of this.groups) {
      if (gr.held) continue;
      const l = this.toLocal(gr, x, z);
      for (const p of gr.parts) {
        const h = this.half(p);
        if (Math.abs(l.x - p.ox) <= h[0] && Math.abs(l.z - p.oz) <= h[2]) {
          const top = gr.y + p.oy + h[1];
          if (top <= y + 0.9 && (best === null || top > best)) best = top;
        }
      }
    }
    return best;
  }
  groupUnder(x, y, z) {
    for (const gr of this.groups) {
      if (gr.held) continue;
      const l = this.toLocal(gr, x, z);
      for (const p of gr.parts) {
        const h = this.half(p);
        if (Math.abs(l.x - p.ox) <= h[0] && Math.abs(l.z - p.oz) <= h[2] && Math.abs(gr.y + p.oy + h[1] - y) < 0.25) return gr;
      }
    }
    return null;
  }
  // repousse le joueur hors des côtés des pièces
  resolvePlayer(p, radius = 0.4) {
    for (const gr of this.groups) {
      if (gr.held) continue;
      const l = this.toLocal(gr, p.x, p.z);
      let moved = false, lx = l.x, lz = l.z;
      for (const part of gr.parts) {
        const h = this.half(part), top = gr.y + part.oy + h[1], bot = gr.y + part.oy - h[1];
        if (p.y >= top - 0.3 || p.y + 1.7 <= bot) continue;
        const ex = h[0] + radius, ez = h[2] + radius;
        const ddx = lx - part.ox, ddz = lz - part.oz;
        if (Math.abs(ddx) < ex && Math.abs(ddz) < ez) {
          if (ex - Math.abs(ddx) < ez - Math.abs(ddz)) lx = part.ox + Math.sign(ddx || 1) * ex;
          else lz = part.oz + Math.sign(ddz || 1) * ez;
          moved = true;
        }
      }
      if (moved) { const w = this.toWorld(gr, lx, lz); p.x = w.x; p.z = w.z; }
    }
  }

  /* ---------- Rappel ---------- */
  startRecall(gr) { if (gr && !gr.held) { this.recalling = gr; gr.power = false; } }
  stopRecall() {
    const g = this.recalling; if (!g) return;
    g.vx = g.vy = g.vz = 0; this.recalling = null;
    for (const p of g.parts) p.mat.emissive.setHex(0x000000);
  }

  /* ---------- simulation ---------- */
  setHover(gr) {
    if (this.hover === gr) return;
    if (this.hover) for (const p of this.hover.parts) p.mat.emissive.setHex(0x000000);
    this.hover = gr;
    if (gr) for (const p of gr.parts) p.mat.emissive.setHex(0x1b3a52);
  }

  update(dt, drive, t) {
    for (const gr of this.groups) {
      // ventilateurs : rotation visuelle
      for (const p of gr.parts) if (p.spin) p.spin.rotation.z += dt * (gr.power ? 30 : 1.2);
      gr.node.position.set(gr.x, gr.y, gr.z); gr.node.rotation.y = gr.yaw;
      if (gr.held) continue;

      if (this.recalling === gr) {
        gr.histT = 0;
        const n = Math.min(gr.hist.length, Math.max(1, Math.round(dt * 60 * 1.4)));
        for (let i = 0; i < n && gr.hist.length; i++) { const s = gr.hist.pop(); gr.x = s.x; gr.y = s.y; gr.z = s.z; gr.yaw = s.yaw; }
        if (!gr.hist.length) this.stopRecall();
        for (const p of gr.parts) p.mat.emissive.setHex(0x1a7a8a);
        continue;
      }

      // forces
      let lift = 0, sub = 0, any = false;
      for (const p of gr.parts) {
        const h = this.half(p), w = this.partWorld(gr, p);
        const bottom = w.y - h[1];
        const frac = clamp((T.WATER - bottom) / (2 * h[1]), 0, 1);
        if (frac > 0) { any = true; sub += frac; }
        const vol = 8 * h[0] * h[1] * h[2];
        lift += frac * vol * 0.55;
        if (p.def.balloon) lift += 1.9;
      }
      const ay = G * (lift - gr.mass) / gr.mass;
      gr.vy += ay * dt;
      // moteur
      if (gr.power && gr.fans > 0) {
        const acc = (gr.fans * 9 * clamp(drive.throttle, -0.6, 1)) / (1 + gr.mass * 0.3);
        gr.vx += Math.sin(gr.yaw) * acc * dt; gr.vz += Math.cos(gr.yaw) * acc * dt;
        gr.yaw += drive.steer * dt * (any || gr.balloons > 0 ? 1.0 : 0.4);
        if (Math.abs(drive.throttle) > 0.1 && Math.random() < dt * 18) this.fx.emit(gr.x - Math.sin(gr.yaw) * 2, gr.y + 0.5, gr.z - Math.cos(gr.yaw) * 2, 1, 0xcfe8ff, 1.5, 0.5, -1);
      }
      const drag = any ? Math.exp(-dt * 1.3) : Math.exp(-dt * 0.18);
      gr.vx *= drag; gr.vz *= drag;
      if (any) gr.vy *= Math.exp(-dt * 2.4);
      const sp = Math.hypot(gr.vx, gr.vz);
      if (sp > 16) { gr.vx *= 16 / sp; gr.vz *= 16 / sp; }
      gr.vy = clamp(gr.vy, -40, 14);
      gr.x += gr.vx * dt; gr.y += gr.vy * dt; gr.z += gr.vz * dt;

      // contact avec le sol
      let pen = -1e9;
      for (const p of gr.parts) {
        const h = this.half(p), w = this.partWorld(gr, p), bottom = w.y - h[1];
        for (const [sx, sz] of [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const cx = w.x + rotX(sx * h[0], sz * h[2], gr.yaw), cz = w.z + rotZ(sx * h[0], sz * h[2], gr.yaw);
          pen = Math.max(pen, this.world.surfaceHeight(cx, cz, bottom + 1.2, true) - bottom);
        }
      }
      if (pen > 0) {
        gr.y += pen; if (gr.vy < 0) gr.vy = 0;
        const f = Math.exp(-dt * (gr.power ? 1.5 : 5)); gr.vx *= f; gr.vz *= f;
      }
      if (gr.y < -60) { gr.x = T.WORKSHOP.x; gr.z = T.WORKSHOP.z; gr.y = T.WORKSHOP.y + 4; gr.vx = gr.vy = gr.vz = 0; }

      // historique pour Rappel (toutes les 50 ms, 6 s max)
      gr.histT += dt;
      if (gr.histT >= 0.05) {
        gr.histT = 0;
        const L = gr.hist[gr.hist.length - 1];
        if (!L || Math.hypot(L.x - gr.x, L.y - gr.y, L.z - gr.z) > 0.01 || Math.abs(L.yaw - gr.yaw) > 0.001) {
          gr.hist.push({ x: gr.x, y: gr.y, z: gr.z, yaw: gr.yaw });
          if (gr.hist.length > 120) gr.hist.shift();
        }
      }
      gr.node.position.set(gr.x, gr.y, gr.z); gr.node.rotation.y = gr.yaw;
    }
  }
}
