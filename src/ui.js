// Interface : HUD, cartes, menus.
import * as T from './terrain.js';
import { clamp, smoothstep } from './util.js';

const $ = (id) => document.getElementById(id);
const MAPPX = 512, CELL = 20, GRID = Math.ceil(T.SIZE / CELL);
const w2m = (v) => ((v + T.HALF) / T.SIZE) * MAPPX;

export class UI {
  constructor() {
    this.el = {};
    for (const id of ['hud', 'hearts', 'stam', 'objectives', 'weapons', 'miniC', 'clock', 'prompt', 'toasts', 'bossbar', 'bossname', 'bossfill',
      'trial', 'banner', 'bannerT', 'bannerS', 'floaters', 'vignette', 'mapC', 'mapScreen', 'hint']) this.el[id] = $(id);
    this.sctx = this.el.stam.getContext('2d');
    this.mctx = this.el.miniC.getContext('2d');
    this.fctx = this.el.mapC.getContext('2d');
    this.rev = new Uint8Array(GRID * GRID);
    this.base = document.createElement('canvas'); this.base.width = this.base.height = MAPPX;
    this.mask = document.createElement('canvas'); this.mask.width = this.mask.height = MAPPX;
    this.mk = this.mask.getContext('2d');
    this.resetMask();
    this.lastHearts = ''; this.stamShown = 0; this.bannerT = 0;
    this.fast = []; // points de voyage rapide affichés sur la carte
  }

  /* ---------- carte ---------- */
  renderBaseMap() {
    const ctx = this.base.getContext('2d');
    const img = ctx.createImageData(MAPPX, MAPPX), d = img.data, k = T.SIZE / MAPPX;
    for (let j = 0; j < MAPPX; j++) for (let i = 0; i < MAPPX; i++) {
      const x = -T.HALF + (i + 0.5) * k, z = -T.HALF + (j + 0.5) * k;
      const h = T.heightAt(x, z);
      let r, g, b;
      if (h < T.WATER) {
        const dep = clamp(-h / 40, 0, 1);
        r = 40 - dep * 25; g = 130 - dep * 60; b = 190 - dep * 40;
      } else {
        const c = T.colorAt(x, z, h, T.slopeAt(x, z, 3));
        const sh = clamp(1 + (T.heightAt(x - 6, z - 6) - T.heightAt(x + 6, z + 6)) * 0.035, 0.6, 1.35);
        r = c[0] * 255 * sh; g = c[1] * 255 * sh; b = c[2] * 255 * sh;
      }
      const o = (j * MAPPX + i) * 4;
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  resetMask() {
    this.rev.fill(0);
    this.mk.globalCompositeOperation = 'source-over';
    this.mk.fillStyle = 'rgb(7,10,22)'; this.mk.fillRect(0, 0, MAPPX, MAPPX);
  }
  reveal(x, z, r) {
    const px = w2m(x), pz = w2m(z), pr = (r / T.SIZE) * MAPPX;
    const g = this.mk.createRadialGradient(px, pz, pr * 0.55, px, pz, pr);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    this.mk.globalCompositeOperation = 'destination-out';
    this.mk.fillStyle = g; this.mk.beginPath(); this.mk.arc(px, pz, pr, 0, 6.3); this.mk.fill();
    this.mk.globalCompositeOperation = 'source-over';
    const c0x = Math.floor((x - r + T.HALF) / CELL), c1x = Math.floor((x + r + T.HALF) / CELL);
    const c0z = Math.floor((z - r + T.HALF) / CELL), c1z = Math.floor((z + r + T.HALF) / CELL);
    for (let i = c0x; i <= c1x; i++) for (let j = c0z; j <= c1z; j++) {
      if (i < 0 || j < 0 || i >= GRID || j >= GRID) continue;
      const cx = -T.HALF + (i + 0.5) * CELL, cz = -T.HALF + (j + 0.5) * CELL;
      if (Math.hypot(cx - x, cz - z) < r * 0.85) this.rev[j * GRID + i] = 1;
    }
  }
  isRevealed(x, z) {
    const i = Math.floor((x + T.HALF) / CELL), j = Math.floor((z + T.HALF) / CELL);
    return i >= 0 && j >= 0 && i < GRID && j < GRID && this.rev[j * GRID + i] === 1;
  }
  exploredPct() { let n = 0; for (let i = 0; i < this.rev.length; i++) n += this.rev[i]; return n / this.rev.length * 100; }
  revString() { let s = ''; for (let i = 0; i < this.rev.length; i++) s += this.rev[i]; return s; }
  loadRev(s) {
    this.resetMask();
    if (!s || s.length !== this.rev.length) return;
    this.mk.globalCompositeOperation = 'destination-out';
    const pr = (CELL / T.SIZE) * MAPPX * 1.2;
    for (let i = 0; i < s.length; i++) if (s[i] === '1') {
      this.rev[i] = 1;
      const x = (i % GRID) * CELL + CELL / 2 - T.HALF, z = Math.floor(i / GRID) * CELL + CELL / 2 - T.HALF;
      this.mk.fillStyle = 'rgba(0,0,0,0.9)'; this.mk.beginPath(); this.mk.arc(w2m(x), w2m(z), pr, 0, 6.3); this.mk.fill();
    }
    this.mk.globalCompositeOperation = 'source-over';
  }

  drawMarkers(ctx, scale, s, camYaw, px, pz, big) {
    const mark = (x, z, shape, color, size) => {
      const u = w2m(x) * scale, v = w2m(z) * scale;
      ctx.fillStyle = color; ctx.strokeStyle = '#05060f'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (shape === 'tri') { ctx.moveTo(u, v - size); ctx.lineTo(u + size, v + size * 0.8); ctx.lineTo(u - size, v + size * 0.8); ctx.closePath(); }
      else if (shape === 'dia') { ctx.moveTo(u, v - size); ctx.lineTo(u + size, v); ctx.lineTo(u, v + size); ctx.lineTo(u - size, v); ctx.closePath(); }
      else ctx.arc(u, v, size, 0, 6.3);
      ctx.fill(); ctx.stroke();
    };
    T.TOWERS.forEach((t) => mark(t.x, t.z, 'tri', s.towers[t.id] ? '#35d8ff' : '#ff9a3c', big ? 9 : 5));
    T.SHRINES.forEach((t) => { if (s.shrines[t.id] || this.isRevealed(t.x, t.z)) mark(t.x, t.z, 'dia', s.shrines[t.id] ? '#35d8ff' : '#ff9a3c', big ? 7 : 4); });
    T.CAMPS.forEach((c) => { if (!s.camps[c.id] && this.isRevealed(c.x, c.z)) mark(c.x, c.z, 'dot', '#e03a3a', big ? 6 : 3); });
    if (this.isRevealed(T.BOSS.x, T.BOSS.z) && !s.boss) mark(T.BOSS.x, T.BOSS.z, 'dot', '#a020d0', big ? 8 : 4);
    // joueur
    const u = px * scale, v = pz * scale;
    ctx.save(); ctx.translate(u, v); ctx.rotate(Math.PI - camYaw);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#0a0a18'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -(big ? 11 : 7)); ctx.lineTo(big ? 8 : 5, big ? 9 : 6); ctx.lineTo(0, big ? 4 : 3); ctx.lineTo(-(big ? 8 : 5), big ? 9 : 6); ctx.closePath();
    ctx.fill(); ctx.stroke(); ctx.restore();
  }

  drawMini(px, pz, camYaw, s) {
    const c = this.mctx, S = 160, span = 130; // px de carte visibles
    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 2, 0, 6.3); c.clip();
    c.fillStyle = '#05060f'; c.fillRect(0, 0, S, S);
    c.translate(S / 2, S / 2);
    c.rotate(camYaw - Math.PI);
    const sc = S / span, mx = w2m(px), mz = w2m(pz);
    c.scale(sc, sc);
    c.translate(-mx, -mz);
    c.imageSmoothingEnabled = true;
    c.drawImage(this.base, 0, 0); c.drawImage(this.mask, 0, 0);
    c.restore();
    c.save(); c.translate(S / 2, S / 2); c.rotate(camYaw - Math.PI); c.scale(sc, sc); c.translate(-mx, -mz);
    this.drawMarkers(c, 1, s, camYaw, 0, 0, false);
    c.restore();
    c.save(); c.translate(S / 2, S / 2);
    c.fillStyle = '#fff'; c.strokeStyle = '#0a0a18'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -9); c.lineTo(6, 7); c.lineTo(0, 3); c.lineTo(-6, 7); c.closePath(); c.fill(); c.stroke();
    c.restore();
  }

  drawFullMap(px, pz, camYaw, s, hoverIdx) {
    const c = this.fctx, S = this.el.mapC.width, sc = S / MAPPX;
    c.clearRect(0, 0, S, S);
    c.imageSmoothingEnabled = true;
    c.drawImage(this.base, 0, 0, S, S); c.drawImage(this.mask, 0, 0, S, S);
    // grille
    c.strokeStyle = 'rgba(255,255,255,0.07)'; c.lineWidth = 1;
    for (let i = 1; i < 8; i++) { c.beginPath(); c.moveTo(i * S / 8, 0); c.lineTo(i * S / 8, S); c.moveTo(0, i * S / 8); c.lineTo(S, i * S / 8); c.stroke(); }
    // points de voyage rapide
    this.fast = [];
    const add = (x, z, name) => this.fast.push({ x, z, name, u: w2m(x) * sc, v: w2m(z) * sc });
    add(0, 14, 'Prairie de départ');
    T.TOWERS.forEach((t) => { if (s.towers[t.id]) add(t.x, t.z, t.name); });
    T.SHRINES.forEach((t) => { if (s.shrines[t.id]) add(t.x, t.z, t.name); });
    this.drawMarkers(c, sc, s, camYaw, w2m(px), w2m(pz), true);
    this.fast.forEach((f, i) => {
      c.strokeStyle = i === hoverIdx ? '#ffd23c' : 'rgba(255,255,255,0.55)'; c.lineWidth = i === hoverIdx ? 3 : 1.5;
      c.beginPath(); c.arc(f.u, f.v, 13, 0, 6.3); c.stroke();
    });
    if (hoverIdx >= 0) {
      const f = this.fast[hoverIdx];
      c.font = '700 14px ui-monospace, monospace'; c.textAlign = 'center';
      c.fillStyle = '#000a'; c.fillRect(f.u - 90, f.v - 42, 180, 22);
      c.fillStyle = '#ffd23c'; c.fillText('Voyager : ' + f.name, f.u, f.v - 26);
    }
  }
  pickFast(mx, my) {
    let best = -1, bd = 18;
    this.fast.forEach((f, i) => { const d = Math.hypot(f.u - mx, f.v - my); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  /* ---------- HUD ---------- */
  setHearts(hp, max) {
    const n = Math.ceil(max / 4), key = hp + '/' + max;
    if (key === this.lastHearts) return;
    this.lastHearts = key;
    let h = '';
    for (let i = 0; i < n; i++) {
      const p = clamp((hp - i * 4) / 4, 0, 1) * 100;
      h += `<span class="heart" style="--p:${p}%">♥</span>`;
    }
    this.el.hearts.innerHTML = h;
  }
  drawStamina(cur, max, exhausted, active) {
    const target = (cur < max - 0.5 || active) ? 1 : 0;
    this.stamShown += (target - this.stamShown) * 0.15;
    const c = this.sctx, S = 96, r = 34;
    c.clearRect(0, 0, S, S);
    if (this.stamShown < 0.03) return;
    c.globalAlpha = this.stamShown;
    c.lineWidth = 11; c.lineCap = 'round';
    c.strokeStyle = 'rgba(8,16,10,0.65)'; c.beginPath(); c.arc(S / 2, S / 2, r, 0, 6.3); c.stroke();
    const f = clamp(cur / max, 0, 1);
    c.strokeStyle = exhausted ? '#ff4a4a' : f < 0.3 ? '#ffd23c' : '#7be85a';
    c.beginPath(); c.arc(S / 2, S / 2, r, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); c.stroke();
    c.globalAlpha = 1;
  }
  setWeapons(list, sel, defs, food) {
    let h = '';
    list.forEach((w, i) => {
      const d = defs[w.id], pct = clamp(w.dur / d.dur, 0, 1) * 100;
      h += `<div class="slot ${i === sel ? 'sel' : ''}"><b>${i + 1}</b><span>${d.name}${w.fuse ? ' ✦' + (w.fuse === 'fire' ? 'Feu' : 'Gel') : ''}</span><i style="width:${pct}%;background:${pct < 30 ? '#ff4a4a' : '#7be85a'}"></i></div>`;
    });
    h += `<div class="food">🍎 ${food.apple} &nbsp; 🍄 ${food.mushroom} &nbsp; 🔥 ${food.fire} &nbsp; ❄ ${food.ice}</div>`;
    this.el.weapons.innerHTML = h;
  }
  setObjectives(s, pct) {
    const n = (a) => a.filter(Boolean).length;
    this.el.objectives.innerHTML =
      `<b>Éolia</b><br>Tours du Ciel <em>${n(s.towers)}/${T.TOWERS.length}</em><br>Sanctuaires <em>${n(s.shrines)}/${T.SHRINES.length}</em><br>` +
      `Lumis <em>${n(s.lumis)}/${T.LUMIS.length}</em><br>Camps nettoyés <em>${n(s.camps)}/${T.CAMPS.length}</em><br>Colosse <em>${s.boss ? '✔' : '—'}</em><br>Carte <em>${pct.toFixed(0)}%</em>`;
  }
  clock(t) {
    const h = Math.floor(t * 24), m = Math.floor((t * 24 - h) * 60);
    this.el.clock.textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  prompt(text) {
    const p = this.el.prompt;
    if (text) { if (p.textContent !== text) p.textContent = text; p.style.opacity = 1; } else p.style.opacity = 0;
  }
  toast(text, ms = 3200) {
    const d = document.createElement('div');
    d.className = 'toast'; d.textContent = text;
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 4) this.el.toasts.removeChild(this.el.toasts.firstChild);
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 500); }, ms);
  }
  banner(title, sub = '', ms = 3500) {
    this.el.bannerT.textContent = title; this.el.bannerS.textContent = sub;
    this.el.banner.classList.add('show');
    clearTimeout(this._bt);
    this._bt = setTimeout(() => this.el.banner.classList.remove('show'), ms);
  }
  boss(name, frac) {
    if (frac === null) { this.el.bossbar.style.display = 'none'; return; }
    this.el.bossbar.style.display = 'block'; this.el.bossname.textContent = name;
    this.el.bossfill.style.width = clamp(frac, 0, 1) * 100 + '%';
  }
  trial(text) { this.el.trial.style.display = text ? 'block' : 'none'; if (text) this.el.trial.textContent = text; }
  hurtFlash() { const v = this.el.vignette; v.style.opacity = 0.9; setTimeout(() => (v.style.opacity = 0), 140); }
  float(sx, sy, text, color = '#fff') {
    const d = document.createElement('div');
    d.className = 'float'; d.textContent = text; d.style.color = color;
    d.style.left = sx + 'px'; d.style.top = sy + 'px';
    this.el.floaters.appendChild(d);
    setTimeout(() => d.remove(), 900);
  }
  hint(text) { this.el.hint.textContent = text; this.el.hint.style.opacity = text ? 1 : 0; }
}

export function fillBoard(ol, rows) {
  ol.innerHTML = '';
  if (!rows || !rows.length) { ol.innerHTML = '<li class="empty">Aucun score pour l’instant.</li>'; return; }
  rows.forEach((r) => {
    const li = document.createElement('li');
    const n = document.createElement('span'); n.className = 'n'; n.textContent = r.name;
    const s = document.createElement('span'); s.className = 's'; s.textContent = r.score;
    li.append(n, s); ol.append(li);
  });
}
