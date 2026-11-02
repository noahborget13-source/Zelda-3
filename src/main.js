// ÉOLIA — boucle principale : joueur, combat, interactions, épreuves, sauvegarde.
import * as THREE from 'three';
import * as T from './terrain.js';
import { clamp, lerp, mulberry32, angDiff } from './util.js';
import { World } from './world.js';
import { Sky } from './sky.js';
import { PlayerModel, Enemy } from './entities.js';
import { Builder, PARTS } from './build.js';
import { CH, initCheats } from './cheats.js';
import { Particles, Sfx } from './fx.js';
import { WEAPONS, LOOT, FUSE, TUTORIAL } from './data.js';
import { UI, fillBoard } from './ui.js';
import * as net from './net.js';

const $ = (id) => document.getElementById(id);
const R = 0.4, HEIGHT = 1.8, GRAV = 26, LGRAV = 6, JUMP = 9.3, WALK = 5.6, RUN = 9.8, SWIM = 3.8;
const SAVE_KEY = 'eolia_save_v1';

/* ============================== Rendu ============================== */
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.3, 3200);
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
});

/* ============================== État ============================== */
let world, sky, fx, builder, model, ui, tele;
const sfx = new Sfx();
const keys = {}, mouse = {}, just = {};
let mode = 'loading';     // loading | title | play | pause | map | dead
let S = null;             // état de la sauvegarde
let camYaw = 0, camPitch = 0.35, camDist = 5.6, sens = 1, shadowsOn = true;
let last = 0, tAnim = 0, shake = 0, saveT = 0, hudT = 0, miniT = 0, lastCell = '';
const weather = { on: false, t: 50 };
const enemies = [], campEnemies = [], night = { v: false };
let boss = null, trial = null, wander = 0, cheats = null;
const ring = []; // anneaux d'épreuve

const P = {
  x: 0, y: 0, z: 14, vx: 0, vy: 0, vz: 0, yaw: 0, mode: 'ground', onGround: true, stamina: 100, exhausted: false, regenT: 0,
  inv: 0, roll: 0, rdx: 0, rdz: 1, atk: -1, atkCD: 0, atkDur: 0.4, hitDone: false, glide: false, launched: false, dead: false, hp: 12,
  tower: null, ta: 0, coyote: 0, drive: false, fall: 0, climbing: 0,
};

const newState = (name) => ({
  v: 1, name, hearts: 3, hp: 12, stamMax: 100, orbs: 0, towers: Array(T.TOWERS.length).fill(false), shrines: Array(T.SHRINES.length).fill(false),
  chests: Array(T.CHESTS.length).fill(false), lumis: Array(T.LUMIS.length).fill(false), camps: Array(T.CAMPS.length).fill(false), boss: false,
  apple: 2, mushroom: 0, fire: 0, ice: 0, weapons: [{ id: 'branch', dur: WEAPONS.branch.dur }], sel: 0, time: 0.3, play: 0, kills: 0,
  pos: { x: 0, y: 13, z: 14 }, yaw: 0, rev: '', taken: [], tut: false, lumiOrbs: 0, cheated: false,
});
const count = (a) => a.filter(Boolean).length;
const maxHp = () => S.hearts * 4;
const weapon = () => S.weapons[S.sel] || null;
const fuseOf = (w) => (w && w.fuse ? FUSE[w.fuse] : null);

function score() {
  return Math.round(count(S.towers) * 600 + count(S.shrines) * 400 + count(S.lumis) * 40 + count(S.camps) * 300 + (S.boss ? 3000 : 0) +
    count(S.chests) * 50 + S.kills * 10 + ui.exploredPct() * 10);
}

/* ============================== Sauvegarde ============================== */
function readSave() { try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); return s && s.v === 1 ? s : null; } catch { return null; } }
function saveGame() {
  if (!S) return;
  S.pos = { x: P.x, y: P.y, z: P.z }; S.yaw = camYaw; S.hp = P.hp; S.rev = ui.revString();
  S.taken = world.pickups.filter((p) => p.taken && p.kind !== 'weapon' && !p.data).map((p) => p.id);
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch {}
}

function applyState() {
  P.hp = clamp(S.hp, 1, maxHp()); P.stamina = S.stamMax; P.exhausted = false; P.dead = false;
  P.x = S.pos.x; P.z = S.pos.z; P.y = Math.max(S.pos.y, world.surfaceHeight(P.x, P.z, S.pos.y + 1) ); P.vx = P.vy = P.vz = 0;
  P.mode = 'ground'; P.onGround = true; P.glide = false; P.launched = false; P.roll = 0; P.atk = -1; P.inv = 0;
  camYaw = S.yaw; P.yaw = S.yaw;
  S.towers.forEach((on, i) => world.setTowerActive(i, on));
  S.shrines.forEach((on, i) => world.setShrineState(i, on ? 1 : 0));
  S.chests.forEach((on, i) => { if (on) world.openChest(i); });
  S.lumis.forEach((on, i) => { if (on) world.collectLumi(i); });
  S.camps.forEach((on, i) => { if (on) world.setCampCleared(i); });
  const taken = new Set(S.taken || []);
  world.pickups.forEach((p) => { if (taken.has(p.id) && !p.taken) world.removePickup(p); });
  ui.loadRev(S.rev);
  if (!S.rev) { ui.reveal(0, 0, 120); }
  S.towers.forEach((on, i) => { if (on) ui.reveal(T.TOWERS[i].x, T.TOWERS[i].z, 300); });
  refreshWeaponModel();
}

/* ============================== Entrées ============================== */
const locked = () => document.pointerLockElement === canvas;
window.addEventListener('keydown', (e) => {
  if (mode === 'title' || mode === 'loading') return;
  if ((e.code === 'F9' || e.code === 'Backquote') && (mode === 'play' || mode === 'cheat')) { e.preventDefault(); if (!e.repeat) toggleCheat(); return; }
  if (e.code === 'Escape' && mode === 'cheat') { toggleCheat(); return; }
  if (e.code === 'KeyM' && (mode === 'play' || mode === 'map')) { toggleMap(); e.preventDefault(); return; }
  if (e.code === 'Escape' && mode === 'map') { toggleMap(); return; }
  if (e.code === 'Tab') { e.preventDefault(); if (mode === 'play') openPause(); else if (mode === 'pause') resume(); return; }
  if (mode !== 'play') return;
  // Bloque l'action par défaut de TOUTES les touches de jeu (y compris les répétitions) :
  // évite le menu des accents de macOS quand on maintient une touche, le défilement, etc.
  // Les raccourcis navigateur (Cmd/Ctrl/Alt + touche, F1-F12) restent possibles.
  if (!e.metaKey && !e.ctrlKey && !e.altKey && !/^F\d+$/.test(e.code)) e.preventDefault();
  if (!e.repeat) just[e.code] = true;
  keys[e.code] = true;
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; for (const k in mouse) mouse[k] = false; });
window.addEventListener('mousemove', (e) => {
  if (mode !== 'play' || !locked()) return;
  camYaw -= e.movementX * 0.0024 * sens;
  camPitch = clamp(camPitch + e.movementY * 0.0021 * sens, -0.45, 1.35);
});
canvas.addEventListener('mousedown', (e) => {
  if (mode !== 'play') return;
  sfx.ensure();
  if (!locked()) { canvas.requestPointerLock && canvas.requestPointerLock(); return; }
  mouse[e.button] = true; just['Mouse' + e.button] = true;
});
window.addEventListener('mouseup', (e) => { mouse[e.button] = false; });
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('wheel', (e) => {
  if (mode !== 'play') return;
  const dir = Math.sign(e.deltaY);
  if (builder && builder.held) { if (e.shiftKey) builder.adjustDist(-dir * 0.8); else builder.rotateHeld(dir * Math.PI / 8); }
  else if (S && S.weapons.length > 1) { S.sel = (S.sel + dir + S.weapons.length) % S.weapons.length; refreshWeaponModel(); ui.toast(WEAPONS[weapon().id].name, 1200); }
}, { passive: true });
document.addEventListener('pointerlockchange', () => { if (!locked() && mode === 'play') openPause(); });

/* ============================== Menus ============================== */
function show(id, on) { $(id).classList.toggle('hidden', !on); }
function openPause() {
  mode = 'pause'; saveGame(); show('pause', true);
  $('orbCount').textContent = S.orbs; $('scoreNow').textContent = score();
  $('btnHeart').disabled = $('btnStam').disabled = S.orbs < 1 || (S.hearts >= 10 && false);
  net.fetchTop(8).then((r) => fillBoard($('pauseBoard'), r)).catch(() => {});
  if (document.exitPointerLock) document.exitPointerLock();
}
function resume() {
  show('pause', false); mode = 'play';
  if (canvas.requestPointerLock) { try { canvas.requestPointerLock(); } catch {} }
}
function toggleMap() {
  if (mode === 'map') { show('mapScreen', false); mode = 'play'; return; }
  mode = 'map'; show('mapScreen', true);
  if (document.exitPointerLock) document.exitPointerLock();
  ui.drawFullMap(P.x, P.z, camYaw, S, -1);
}
$('mapC').addEventListener('mousemove', (e) => {
  const r = $('mapC').getBoundingClientRect(), k = $('mapC').width / r.width;
  ui.drawFullMap(P.x, P.z, camYaw, S, ui.pickFast((e.clientX - r.left) * k, (e.clientY - r.top) * k));
});
$('mapC').addEventListener('click', (e) => {
  const r = $('mapC').getBoundingClientRect(), k = $('mapC').width / r.width;
  const i = ui.pickFast((e.clientX - r.left) * k, (e.clientY - r.top) * k);
  if (i < 0) return;
  const f = ui.fast[i];
  toggleMap();
  teleport(f.x, f.z, f.name);
});
$('btnResume').addEventListener('click', resume);
$('btnHeart').addEventListener('click', () => {
  if (S.orbs < 1 || S.hearts >= 10) return;
  S.orbs--; S.hearts++; P.hp = maxHp(); $('orbCount').textContent = S.orbs; sfx.jingle(); ui.toast('Un cœur de plus !');
  $('btnHeart').disabled = $('btnStam').disabled = S.orbs < 1;
});
$('btnStam').addEventListener('click', () => {
  if (S.orbs < 1) return;
  S.orbs--; S.stamMax += 25; P.stamina = S.stamMax; $('orbCount').textContent = S.orbs; sfx.jingle(); ui.toast('Endurance accrue !');
  $('btnHeart').disabled = $('btnStam').disabled = S.orbs < 1;
});
$('sensRange').addEventListener('input', (e) => { sens = +e.target.value; });
$('volRange').addEventListener('input', (e) => { sfx.vol = +e.target.value; });
$('shadowChk').addEventListener('change', (e) => { shadowsOn = e.target.checked; });
$('qualitySel').addEventListener('change', (e) => { renderer.setPixelRatio(Math.min((window.devicePixelRatio || 1) * +e.target.value, 2)); renderer.setSize(window.innerWidth, window.innerHeight, false); });
$('btnPublish').addEventListener('click', async () => {
  const st = $('pubStatus');
  if (S.cheated) { st.textContent = 'Mode développeur utilisé : publication désactivée pour cette partie.'; return; }
  st.textContent = 'Envoi…';
  try {
    await net.submitScore({ name: S.name, score: score(), towers: count(S.towers), shrines: count(S.shrines), lumis: count(S.lumis) });
    st.textContent = net.ONLINE ? 'Score publié en ligne ✔' : 'Score enregistré localement ✔ (config.js non rempli)';
    net.fetchTop(8).then((r) => fillBoard($('pauseBoard'), r)).catch(() => {});
  } catch { st.textContent = 'Échec de la publication.'; }
});
$('btnSaveQuit').addEventListener('click', () => { saveGame(); location.reload(); });
$('btnRespawn').addEventListener('click', respawn);

/* ============================== Mode développeur ============================== */
function toggleCheat() {
  if (!cheats) return;
  if (mode === 'play') {
    mode = 'cheat'; for (const k in keys) keys[k] = false; for (const k in mouse) mouse[k] = false;
    if (document.exitPointerLock) document.exitPointerLock();
    cheats.open();
  } else if (mode === 'cheat') {
    cheats.close(); mode = 'play';
    if (canvas.requestPointerLock) { try { canvas.requestPointerLock(); } catch {} }
  }
}
function cheatApi() {
  const ahead = (d) => [P.x + Math.sin(P.yaw) * d, P.z + Math.cos(P.yaw) * d];
  return {
    mark: () => { if (!S.cheated) { S.cheated = true; ui.toast('Mode développeur : publication du score désactivée', 3500); } },
    toast: (t, ms) => ui.toast(t, ms), close: () => toggleCheat(),
    fly: (on) => { if (!on) { P.vy = 0; } },
    heal: () => { P.hp = maxHp(); P.dead = false; },
    heart: () => { S.hearts = Math.min(20, S.hearts + 1); P.hp = maxHp(); },
    stamMax: () => { S.stamMax += 25; P.stamina = S.stamMax; },
    orbs: () => { S.orbs += 10; },
    weapons: () => { S.weapons = []; ['radiant', 'knight', 'spear', 'club', 'rusty'].forEach((id) => addWeapon(id)); S.sel = 0; refreshWeaponModel(); },
    food: (k, n) => { S[k] = (S[k] || 0) + n; },
    hour: () => S.time * 24, setHour: (h) => { S.time = (h / 24) % 1; },
    rain: (on) => { weather.on = on; weather.t = on ? 9999 : 60; },
    reveal: () => { for (let x = -800; x <= 800; x += 120) for (let z = -800; z <= 800; z += 120) ui.reveal(x, z, 160); },
    towers: () => T.TOWERS.forEach((t) => { S.towers[t.id] = true; world.setTowerActive(t.id, true); ui.reveal(t.x, t.z, 300); }),
    shrines: () => T.SHRINES.forEach((t) => { S.shrines[t.id] = true; world.setShrineState(t.id, 1); ui.reveal(t.x, t.z, 110); }),
    lumis: () => { S.lumis = S.lumis.map(() => true); S.lumis.forEach((_, i) => world.collectLumi(i)); },
    killAll: () => { for (const e of enemies) if (!e.dead && e.hurt(1e6, 0, 0, { kb: 0 })) onKill(e); },
    spawn: (kind) => { const [x, z] = ahead(9); spawnEnemy(kind, x, z, -2); },
    part: (key) => { const [x, z] = ahead(6); builder.addGroup(key, x, world.surfaceHeight(x, z, P.y + 6) + PARTS[key].size[1] / 2 + 0.5, z); },
    teleport: (x, z, name) => teleport(x, z, name),
    places: () => [
      { label: 'Départ', x: 0, z: 14 }, { label: 'Atelier', x: T.WORKSHOP.x - 6, z: T.WORKSHOP.z + 8 }, { label: 'Colosse', x: T.BOSS.x + 30, z: T.BOSS.z },
      ...T.TOWERS.map((t) => ({ label: t.name, x: t.x, z: t.z })),
      ...T.SHRINES.map((t) => ({ label: t.name, x: t.x, z: t.z + 6 })),
      ...T.ISLANDS.map((t, i) => ({ label: 'Île céleste ' + (i + 1), x: t.x, z: t.z })),
    ],
  };
}

function startGame(fresh) {
  sfx.ensure();
  const name = ($('nameInput').value.trim() || 'Voyageur').slice(0, 16);
  const saved = fresh ? null : readSave();
  S = saved || newState(name); S.name = name;
  if (fresh) { try { localStorage.removeItem(SAVE_KEY); } catch {} }
  world.pickups.forEach((p) => { if (p.taken && !p.data) { p.taken = false; scene.add(p.mesh); } });
  applyState();
  show('title', false); show('hud', true); mode = 'play';
  if (!S.tut) { S.tut = true; TUTORIAL.forEach((t, i) => setTimeout(() => mode !== 'loading' && ui.toast(t, 5200), 1500 + i * 5600)); }
  try { canvas.requestPointerLock && canvas.requestPointerLock(); } catch {}
}

/* ============================== Armes & objets ============================== */
function refreshWeaponModel() {
  const w = weapon();
  model.setWeapon(w ? WEAPONS[w.id] : null, fuseOf(w) ? fuseOf(w).color : 0);
}
function addWeapon(id, dur) {
  const def = WEAPONS[id];
  if (S.weapons.length < 5) { S.weapons.push({ id, dur: dur || def.dur }); S.sel = S.weapons.length - 1; refreshWeaponModel(); return true; }
  let wi = 0; S.weapons.forEach((w, i) => { if (WEAPONS[w.id].dmg < WEAPONS[S.weapons[wi].id].dmg) wi = i; });
  if (WEAPONS[S.weapons[wi].id].dmg < def.dmg) { S.weapons[wi] = { id, dur: dur || def.dur }; S.sel = wi; refreshWeaponModel(); ui.toast('Arme faible remplacée.'); return true; }
  ui.toast('Inventaire d’armes plein.'); return false;
}
function give(item) {
  if (item === 'apple') { S.apple++; ui.toast('🍎 Pomme'); }
  else if (item === 'mushroom') { S.mushroom++; ui.toast('🍄 Champignon bleu'); }
  else if (item === 'crystal_fire') { S.fire++; ui.toast('🔥 Cristal de feu (F : fusionner)'); }
  else if (item === 'crystal_ice') { S.ice++; ui.toast('❄ Cristal de gel (F : fusionner)'); }
  else if (WEAPONS[item]) { if (!addWeapon(item)) return false; ui.toast('⚔ ' + WEAPONS[item].name); }
  sfx.pickup();
  return true;
}
function eat() {
  const miss = maxHp() - P.hp;
  if (miss <= 0) { ui.toast('Vous êtes en pleine forme.', 1200); return; }
  if (S.mushroom > 0 && miss >= 6) { S.mushroom--; P.hp = Math.min(maxHp(), P.hp + 8); }
  else if (S.apple > 0) { S.apple--; P.hp = Math.min(maxHp(), P.hp + 4); }
  else if (S.mushroom > 0) { S.mushroom--; P.hp = Math.min(maxHp(), P.hp + 8); }
  else { ui.toast('Plus de nourriture.', 1500); return; }
  sfx.pickup(); fx.emit(P.x, P.y + 1.2, P.z, 14, 0xff6a7a, 3, 0.6, -2);
}
function fuse() {
  const w = weapon();
  if (!w) return;
  const kind = S.fire > 0 ? 'fire' : S.ice > 0 ? 'ice' : null;
  if (!kind) { ui.toast('Aucun cristal à fusionner.', 1500); return; }
  if (w.fuse === kind) { ui.toast('Déjà fusionnée.', 1200); return; }
  if (kind === 'fire') S.fire--; else S.ice--;
  w.fuse = kind; refreshWeaponModel(); sfx.glue();
  ui.banner('Fusion !', WEAPONS[w.id].name + ' + ' + FUSE[kind].name, 1800);
}

/* ============================== Joueur ============================== */
function readInput() {
  const ix = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), iz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const len = Math.hypot(ix, iz), k = len > 1 ? 1 / len : 1;
  const s = Math.sin(camYaw), c = Math.cos(camYaw);
  const mag = Math.min(1, len);
  return { mx: (iz * s - ix * c) * k, mz: (iz * c + ix * s) * k, mag, ix, iz };
}

function collide(p, y) {
  let tower = null;
  for (const c of world.nearColliders(p.x, p.z, 3)) {
    if (y >= c.y1 - 0.3 || y + HEIGHT < c.y0) continue;
    const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), rr = c.r + R;
    if (d < rr && d > 0.0001) { p.x = c.x + (dx / d) * rr; p.z = c.z + (dz / d) * rr; if (c.kind === 'tower') tower = c; }
  }
  builder.resolvePlayer({ get x() { return p.x; }, set x(v) { p.x = v; }, get z() { return p.z; }, set z(v) { p.z = v; }, y }, R);
  return tower;
}

function hurtPlayer(dmg, fromX, fromZ) {
  if (P.dead || P.inv > 0 || P.roll > 0 || CH.god) return;
  P.hp -= dmg; P.inv = 1.1; shake = 0.35;
  const dx = P.x - fromX, dz = P.z - fromZ, d = Math.hypot(dx, dz) || 1;
  P.vx += (dx / d) * 9; P.vz += (dz / d) * 9; if (P.onGround) { P.vy = 5; P.onGround = false; }
  P.atk = -1; sfx.hurt(); ui.hurtFlash();
  fx.emit(P.x, P.y + 1.2, P.z, 10, 0xff5060, 4, 0.5);
  if (P.hp <= 0) die();
}
function die() {
  P.hp = 0; P.dead = true; mode = 'dead'; show('dead', true);
  if (builder.held) builder.release();
  if (document.exitPointerLock) document.exitPointerLock();
}
function respawn() {
  let best = { x: 0, z: 14, d: Infinity };
  const consider = (x, z) => { const d = Math.hypot(P.x - x, P.z - z); if (d < best.d) best = { x, z, d }; };
  T.TOWERS.forEach((t) => { if (S.towers[t.id]) consider(t.x + 7, t.z); });
  T.SHRINES.forEach((t) => { if (S.shrines[t.id]) consider(t.x + 6, t.z); });
  P.dead = false; P.hp = maxHp(); P.stamina = S.stamMax; P.exhausted = false;
  P.x = best.x; P.z = best.z; P.y = world.surfaceHeight(P.x, P.z, 1000) + 0.1;
  P.vx = P.vy = P.vz = 0; P.mode = 'ground'; P.onGround = true; P.glide = false; P.launched = false; P.inv = 2;
  if (trial) endTrial(false);
  show('dead', false); mode = 'play';
  if (canvas.requestPointerLock) { try { canvas.requestPointerLock(); } catch {} }
}
function teleport(x, z, name) {
  P.x = x; P.z = z; P.y = world.surfaceHeight(x, z, 5000) + 0.2; P.vx = P.vy = P.vz = 0;
  P.mode = 'ground'; P.onGround = true; P.glide = false; P.launched = false; P.inv = 1;
  ui.banner(name || 'Voyage', 'Voyage rapide', 2200); sfx.tower();
}

const raining = () => sky.rain > 0.35;

function enterTowerClimb(c, ang) {
  P.mode = 'climbT'; P.tower = c.ref; P.ta = ang; P.vx = P.vy = P.vz = 0; P.onGround = false; P.glide = false;
  if (raining()) ui.toast('Il pleut : les prises sont glissantes !', 2500);
}

function updatePlayer(dt, inp, shiftHeld) {
  P.inv = Math.max(0, P.inv - dt); P.atkCD = Math.max(0, P.atkCD - dt); P.regenT = Math.max(0, P.regenT - dt);
  let sprinting = false;
  if (CH.fly) { flyMove(dt, inp); return; }
  switch (P.mode) {
    case 'climbT': climbTower(dt, shiftHeld); break;
    case 'climbW': climbWall(dt, inp, shiftHeld); break;
    case 'swim': swim(dt, inp, shiftHeld); break;
    default: sprinting = moveFree(dt, inp, shiftHeld);
  }
  // endurance
  if (P.regenT <= 0 && P.mode === 'ground' && P.onGround && !sprinting) P.stamina = Math.min(S.stamMax, P.stamina + 24 * dt);
  else if (P.mode === 'ground' && P.glide) P.stamina = Math.min(S.stamMax, P.stamina + 8 * dt);
  if (P.exhausted && P.stamina >= S.stamMax * 0.5) P.exhausted = false;
  P.stamina = clamp(P.stamina, 0, S.stamMax);
  if (CH.stam) { P.stamina = S.stamMax; P.exhausted = false; }
}

function flyMove(dt, inp) {
  const k = CH.speed * 14;
  P.vx = P.vy = P.vz = 0; P.onGround = false; P.glide = false; P.launched = false; P.mode = 'ground'; P.roll = 0;
  P.x = clamp(P.x + inp.mx * k * dt, -T.HALF + 4, T.HALF - 4); P.z = clamp(P.z + inp.mz * k * dt, -T.HALF + 4, T.HALF - 4);
  P.y += ((keys.Space ? 1 : 0) - (keys.KeyC ? 1 : 0)) * k * dt;
  if (Math.hypot(inp.mx, inp.mz) > 0.1) P.yaw += clamp(angDiff(P.yaw, Math.atan2(inp.mx, inp.mz)), -14 * dt, 14 * dt);
}

function moveFree(dt, inp, shiftHeld) {
  let sprinting = false;
  const groundNow = world.surfaceHeight(P.x, P.z, P.y);
  const standing = P.onGround ? builder.groupUnder(P.x, P.y, P.z) : null;
  P.drive = !!(standing && standing.power);
  if (P.onGround) P.coyote = 0.12; else P.coyote = Math.max(0, P.coyote - dt);

  // roulade
  if (just.KeyQ && P.roll <= 0 && P.stamina >= 10 && !P.glide) {
    P.roll = 1; P.stamina -= 10; P.regenT = 0.6; P.inv = Math.max(P.inv, 0.45);
    const mm = inp.mag > 0.1 ? [inp.mx, inp.mz] : [Math.sin(P.yaw), Math.cos(P.yaw)];
    P.rdx = mm[0]; P.rdz = mm[1]; P.yaw = Math.atan2(P.rdx, P.rdz); P.atk = -1; sfx.swing();
  }

  // saut / parapente
  if (just.Space && !P.drive) {
    if (P.onGround || P.coyote > 0) { P.vy = JUMP; P.onGround = false; P.coyote = 0; P.glide = false; sfx.swing(); }
    else if (P.glide) P.glide = false;
    else if (P.y - groundNow > 2.4) { P.glide = true; P.launched = false; sfx.glide(); }
  } else if (just.Space && P.drive) { P.vy = JUMP * 0.8; P.onGround = false; standing.power = false; }

  if (P.roll > 0) {
    P.roll -= dt / 0.4;
    P.vx = P.rdx * 12.5; P.vz = P.rdz * 12.5;
    if (P.roll <= 0) P.roll = 0;
  } else if (P.glide) {
    if (inp.mag > 0.1) P.yaw += clamp(angDiff(P.yaw, Math.atan2(inp.mx, inp.mz)), -2.6 * dt, 2.6 * dt);
    const spd = keys.KeyW ? 15 : keys.KeyS ? 7.5 : 11, vyT = keys.KeyW ? -5.6 : keys.KeyS ? -1.6 : -2.5;
    const k = 1 - Math.exp(-dt * 2.5);
    P.vx += (Math.sin(P.yaw) * spd - P.vx) * k; P.vz += (Math.cos(P.yaw) * spd - P.vz) * k;
    P.vy += (vyT - P.vy) * (1 - Math.exp(-dt * 3));
    for (const c of world.camps) {
      if (c.cleared) continue;
      if (Math.hypot(P.x - c.def.x, P.z - c.def.z) < 3.4 && P.y > c.def.y && P.y < c.def.y + 40) P.vy = Math.min(7, P.vy + 40 * dt);
    }
  } else {
    let sp = WALK * CH.speed;
    if (shiftHeld && inp.mag > 0.1 && P.stamina > 0 && !P.exhausted && P.onGround) { sp = RUN * CH.speed; sprinting = true; P.stamina -= 7 * dt; P.regenT = 0.7; if (P.stamina <= 0) { P.stamina = 0; P.exhausted = true; } }
    if (P.atk >= 0) sp *= 0.3;
    if (groundNow < T.WATER - 0.2 && P.onGround) sp *= 0.65; // gué
    let tx = inp.mx * sp, tz = inp.mz * sp;
    if (P.drive || builder.held && false) { tx = 0; tz = 0; }
    if (!(P.launched && !P.onGround)) {
      const k = 1 - Math.exp(-dt * (P.onGround ? 16 : 3.5));
      P.vx += (tx - P.vx) * k; P.vz += (tz - P.vz) * k;
    }
  }
  if (!P.glide) P.vy -= (P.launched ? LGRAV : GRAV) * dt;

  // glissade sur les pentes raides
  if (P.onGround && P.roll <= 0 && !standing) {
    const sl = T.slopeAt(P.x, P.z, 1.5);
    if (sl > T.STEEP) { const u = T.uphillAt(P.x, P.z); P.vx -= u[0] * 38 * dt; P.vz -= u[1] * 38 * dt; }
  }

  // déplacement horizontal
  let nx = P.x + P.vx * dt, nz = P.z + P.vz * dt;
  const np = { x: nx, z: nz };
  const tw = collide(np, P.y);
  if (tw && inp.mag > 0.1 && !P.exhausted && P.stamina > 0 && !P.glide) {
    const tdx = tw.x - P.x, tdz = tw.z - P.z, tl = Math.hypot(tdx, tdz) || 1;
    if ((inp.mx * tdx + inp.mz * tdz) / tl > 0.35) { enterTowerClimb({ ref: tw.ref }, Math.atan2(P.z - tw.z, P.x - tw.x)); return false; }
  }
  nx = np.x; nz = np.z;
  // paroi raide : escalade ou blocage
  if (P.onGround && P.roll <= 0 && T.slopeAt(nx, nz, 1.5) > T.STEEP && T.heightAt(nx, nz) > P.y - 0.02 && !standing) {
    const u = T.uphillAt(nx, nz);
    if (inp.mag > 0.1 && inp.mx * u[0] + inp.mz * u[1] > 0.2 && !P.exhausted && P.stamina > 0) {
      P.mode = 'climbW'; P.vx = P.vy = P.vz = 0; P.onGround = false; P.glide = false;
      if (raining()) ui.toast('Il pleut : les prises sont glissantes !', 2500);
      return false;
    }
    nx = P.x; nz = P.z; P.vx *= 0.2; P.vz *= 0.2;
    if (inp.mag > 0.1 && (P.exhausted || P.stamina <= 0) && Math.random() < dt * 0.6) ui.toast('Trop fatigué pour grimper…', 1200);
  } else if (!P.onGround && T.heightAt(nx, nz) > P.y + 0.8 && !P.glide && world.surfaceHeight(nx, nz, P.y) - P.y > 0.8 && T.slopeAt(nx, nz, 1.5) > T.STEEP) {
    nx = P.x; nz = P.z; P.vx *= 0.3; P.vz *= 0.3;   // heurte une paroi en l'air
  }
  P.x = nx; P.z = nz;
  const lim = T.HALF - 4;
  P.x = clamp(P.x, -lim, lim); P.z = clamp(P.z, -lim, lim);

  // verticalité
  const g = world.surfaceHeight(P.x, P.z, P.y);
  if (P.onGround) {
    if (g >= P.y - 0.6 && P.vy <= 0.01) { P.y = g; P.vy = 0; }
    else P.onGround = false;
    // eau profonde : on nage au lieu de marcher sur le fond
    if (P.onGround && g < T.WATER - 1.1 && !standing) {
      P.mode = 'swim'; P.onGround = false; P.vy = 0; P.y = T.WATER - 0.5;
      fx.emit(P.x, T.WATER, P.z, 14, 0xbfe8ff, 4, 0.6); return false;
    }
  }
  if (!P.onGround) {
    const fallV = -P.vy;
    P.y += P.vy * dt;
    if (P.y <= T.WATER - 0.25 && g < T.WATER - 1.1 && P.vy <= 0) {
      P.mode = 'swim'; P.glide = false; P.launched = false; P.vy = 0; P.y = T.WATER - 0.5;
      fx.emit(P.x, T.WATER, P.z, 18, 0xbfe8ff, 5, 0.6); return false;
    }
    if (P.y <= g && P.vy <= 0) {
      P.y = g; P.vy = 0; P.onGround = true; P.glide = false; P.launched = false;
      if (fallV > 24) { const dmg = Math.floor((fallV - 24) * 0.55) + 1; hurtPlayer(dmg, P.x, P.z); fx.emit(P.x, P.y + 0.2, P.z, 12, 0xcfc4a0, 4, 0.5); }
    }
  }

  // orientation
  if (P.roll <= 0 && !P.glide) {
    if (P.atk >= 0 || builder.held || mouse[2]) P.yaw += clamp(angDiff(P.yaw, camYaw), -14 * dt, 14 * dt);
    else if (Math.hypot(P.vx, P.vz) > 1.2 && !P.drive) P.yaw += clamp(angDiff(P.yaw, Math.atan2(P.vx, P.vz)), -14 * dt, 14 * dt);
  }
  if (sprinting && Math.random() < dt * 14) fx.emit(P.x, P.y + 0.1, P.z, 1, 0xd8cfae, 1.2, 0.4, 2);
  return sprinting;
}

function climbWall(dt, inp, shiftHeld) {
  P.vx = P.vy = P.vz = 0; P.onGround = false; P.glide = false;
  const u = T.uphillAt(P.x, P.z), slope = T.slopeAt(P.x, P.z, 1.5), tg = [-u[1], u[0]];
  const f = inp.mx * u[0] + inp.mz * u[1], l = inp.mx * tg[0] + inp.mz * tg[1];
  const hs = clamp(2.6 / Math.max(slope, 1), 0.9, 2.4) * (shiftHeld ? 1.45 : 1);
  const nx = P.x + (u[0] * f + tg[0] * l * 0.8) * hs * dt, nz = P.z + (u[1] * f + tg[1] * l * 0.8) * hs * dt;
  const moving = Math.abs(f) + Math.abs(l) > 0.1;
  P.stamina -= (raining() ? 30 : 10) * (shiftHeld && moving ? 1.8 : 1) * (moving ? 1 : 0.35) * dt; P.regenT = 0.8;
  const ns = T.slopeAt(nx, nz, 1.5);
  P.yaw += clamp(angDiff(P.yaw, Math.atan2(u[0], u[1])), -12 * dt, 12 * dt);
  P.climbing = moving ? 1 : 0.2;
  const leave = (vx, vz, vy) => { P.mode = 'ground'; P.vx = vx; P.vz = vz; P.vy = vy; P.onGround = vy === 0; };
  if (ns < T.STEEP * 0.85) {
    P.x = nx; P.z = nz; P.y = world.surfaceHeight(nx, nz, P.y + 2);
    leave(f > 0 ? u[0] * 2.2 : 0, f > 0 ? u[1] * 2.2 : 0, 0); return;
  }
  P.x = nx; P.z = nz; P.y = T.heightAt(nx, nz);
  if (just.Space) { leave(-u[0] * 4.5, -u[1] * 4.5, 5); return; }
  if (P.stamina <= 0) { P.stamina = 0; P.exhausted = true; leave(-u[0] * 2.5, -u[1] * 2.5, 0.5); ui.toast('À bout de souffle !', 1800); }
}

function climbTower(dt, shiftHeld) {
  const tw = P.tower; P.vx = P.vy = P.vz = 0; P.onGround = false; P.glide = false;
  const up = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), lat = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const moving = up !== 0 || lat !== 0, rad = tw.r + 0.6;
  P.y += up * 3.0 * (shiftHeld ? 1.45 : 1) * dt;
  // sens horizontal : « droite » vu depuis le joueur qui fait face à la tour
  const fyaw = Math.atan2(tw.x - P.x, tw.z - P.z), rx = -Math.cos(fyaw), rz = Math.sin(fyaw);
  const s = rx * -Math.sin(P.ta) + rz * Math.cos(P.ta);
  P.ta += lat * s * (2.4 / rad) * dt;
  P.x = tw.x + Math.cos(P.ta) * rad; P.z = tw.z + Math.sin(P.ta) * rad;
  P.yaw = Math.atan2(tw.x - P.x, tw.z - P.z);
  P.stamina -= (raining() ? 27 : 9) * (shiftHeld && moving ? 1.8 : 1) * (moving ? 1 : 0.3) * dt; P.regenT = 0.8;
  P.climbing = moving ? 1 : 0.2;
  if (P.y >= tw.top + 0.5) {
    P.mode = 'ground'; P.onGround = true; P.y = tw.top + 0.6;
    P.x = tw.x + Math.cos(P.ta) * 5.6; P.z = tw.z + Math.sin(P.ta) * 5.6;
    ui.toast('Sommet atteint !', 1500); return;
  }
  const base = T.heightAt(tw.x + Math.cos(P.ta) * rad, tw.z + Math.sin(P.ta) * rad);
  if (P.y <= base + 0.05 && up < 0) { P.mode = 'ground'; P.onGround = true; P.y = base; return; }
  if (just.Space) { P.mode = 'ground'; P.onGround = false; P.vx = Math.cos(P.ta) * 4; P.vz = Math.sin(P.ta) * 4; P.vy = 3; return; }
  if (P.stamina <= 0) { P.stamina = 0; P.exhausted = true; P.mode = 'ground'; P.onGround = false; P.vx = Math.cos(P.ta) * 2; P.vz = Math.sin(P.ta) * 2; ui.toast('À bout de souffle !', 1800); }
}

function swim(dt, inp, shiftHeld) {
  const fast = shiftHeld && P.stamina > 0 && !P.exhausted && inp.mag > 0.1;
  const sp = fast ? 6.2 : SWIM, k = 1 - Math.exp(-dt * 6);
  P.vx += (inp.mx * sp - P.vx) * k; P.vz += (inp.mz * sp - P.vz) * k;
  const np = { x: P.x + P.vx * dt, z: P.z + P.vz * dt };
  collide(np, P.y);
  P.x = clamp(np.x, -T.HALF + 4, T.HALF - 4); P.z = clamp(np.z, -T.HALF + 4, T.HALF - 4);
  P.y += ((T.WATER - 0.85) - P.y) * (1 - Math.exp(-dt * 6));
  P.stamina -= (3 + (fast ? 9 : 0)) * dt; P.regenT = 0.6;
  if (P.stamina <= 0) { P.stamina = 0; P.exhausted = true; P.hp -= 3 * dt; if (P.hp <= 0) die(); }
  if (Math.hypot(P.vx, P.vz) > 0.6) P.yaw += clamp(angDiff(P.yaw, Math.atan2(P.vx, P.vz)), -8 * dt, 8 * dt);
  if (Math.random() < dt * 5 && inp.mag > 0.1) fx.emit(P.x, T.WATER, P.z, 2, 0xbfe8ff, 1.5, 0.5, 4);
  const g = world.surfaceHeight(P.x, P.z, P.y + 1);
  if (g > T.WATER - 1.0) { P.mode = 'ground'; P.onGround = true; P.y = g; return; }
  if (just.Space) { P.mode = 'ground'; P.onGround = false; P.vy = 8.5; P.vx *= 1.3; P.vz *= 1.3; }
}

/* ============================== Combat ============================== */
function screenPos(x, y, z) {
  const v = new THREE.Vector3(x, y, z).project(camera);
  return [(v.x * 0.5 + 0.5) * window.innerWidth, (-v.y * 0.5 + 0.5) * window.innerHeight];
}
function startAttack() {
  const w = weapon(), def = w ? WEAPONS[w.id] : null;
  P.atk = 0; P.hitDone = false; P.atkDur = def ? def.speed : 0.3; P.atkCD = 0;
  P.yaw = camYaw; sfx.swing();
  P.vx += Math.sin(P.yaw) * 2.5; P.vz += Math.cos(P.yaw) * 2.5;
}
function doHit() {
  const w = weapon(), def = w ? WEAPONS[w.id] : { dmg: 2, reach: 1.7 };
  const fz = fuseOf(w), dmg = CH.oneshot ? 99999 : def.dmg + (fz ? fz.dmg : 0) * 1;
  let hit = 0;
  for (const e of enemies) {
    if (e.dead) continue;
    const dx = e.x - P.x, dz = e.z - P.z, d = Math.hypot(dx, dz), rr = def.reach + e.def.radius;
    if (d > rr || Math.abs(e.y - P.y) > (e.kind === 'boss' ? 6 : 3)) continue;
    if (Math.abs(angDiff(P.yaw, Math.atan2(dx, dz))) > 1.3 && d > e.def.radius + 0.6) continue;
    const killed = e.hurt(dmg, dx / (d || 1), dz / (d || 1), { burn: w && w.fuse === 'fire', slow: w && w.fuse === 'ice' });
    hit++;
    const [sx, sy] = screenPos(e.x, e.y + 2, e.z);
    ui.float(sx, sy, String(Math.round(dmg)), w && w.fuse === 'fire' ? '#ffb060' : '#ffffff');
    fx.emit(e.x, e.y + 1.2, e.z, 8, fz ? fz.color : 0xffe9a0, 5, 0.4);
    if (killed) onKill(e);
  }
  if (hit) {
    sfx.hit(); shake = Math.max(shake, 0.12);
    if (w && !CH.dura) { w.dur -= 1; if (w.dur <= 0) { sfx.broke(); ui.banner('Arme brisée !', WEAPONS[w.id].name, 1800); S.weapons.splice(S.sel, 1); S.sel = Math.max(0, Math.min(S.sel, S.weapons.length - 1)); refreshWeaponModel(); } }
  }
}
function onKill(e) {
  S.kills++;
  const r = Math.random(), x = e.x, y = e.y, z = e.z;
  if (e.kind === 'boss') {
    S.boss = true; S.orbs += 3; sfx.jingle();
    ui.banner('Colosse vaincu', 'Éolia respire à nouveau', 5000);
    world.addPickup('weapon', x + 3, y, z, { id: 'radiant', dur: WEAPONS.radiant.dur });
    world.addPickup('crystal_fire', x - 3, y, z);
    ui.toast('+3 esprits d’orbe');
    return;
  }
  if (r < 0.4) world.addPickup('apple', x, y, z, { drop: true });
  else if (r < 0.52) world.addPickup('crystal_fire', x, y, z, { drop: true });
  else if (r < 0.6) world.addPickup('crystal_ice', x, y, z, { drop: true });
  else if (r < 0.72) { const id = e.kind === 'brute' ? 'club' : 'rusty'; world.addPickup('weapon', x, y, z, { id, dur: Math.ceil(WEAPONS[id].dur * 0.6), drop: true }); }
  fx.emit(x, y + 1, z, 16, 0xc8f8c0, 5, 0.6);
}

/* ============================== Ennemis ============================== */
const ectx = {
  world: null, player: P, fx: null, time: 0, night: false, camQuat: null,
  hurtPlayer, onKill, shake: (s) => { shake = Math.max(shake, s); },
  onBossWake: () => ui.banner('Le Colosse de pierre', 'S’éveille !', 3000),
};
function spawnEnemy(kind, x, z, campId) {
  const y = world.surfaceHeight(x, z, 5000);
  const e = new Enemy(kind, x, z, y, scene, campId);
  enemies.push(e); return e;
}
function manageSpawns(dt) {
  T.CAMPS.forEach((c, i) => {
    if (S.camps[i]) return;
    const d = Math.hypot(P.x - c.x, P.z - c.z);
    if (!campEnemies[i] && d < 130) {
      campEnemies[i] = [];
      for (let k = 0; k < c.n; k++) {
        const a = k * 2.3 + i, r = 5 + (k % 3) * 2;
        campEnemies[i].push(spawnEnemy(i >= 3 || k % 3 === 2 ? 'brute' : 'slime', c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, i));
      }
    } else if (campEnemies[i] && d > 240) {
      campEnemies[i].forEach((e) => { scene.remove(e.group); e.gone = true; }); campEnemies[i] = null;
    } else if (campEnemies[i] && campEnemies[i].every((e) => e.dead)) {
      S.camps[i] = true; world.setCampCleared(i); campEnemies[i] = null;
      ui.banner('Camp nettoyé', `${count(S.camps)}/${T.CAMPS.length}`, 2500); sfx.jingle();
    }
  });
  // colosse
  const bd = Math.hypot(P.x - T.BOSS.x, P.z - T.BOSS.z);
  if (!S.boss && !boss && bd < 140) { boss = spawnEnemy('boss', T.BOSS.x, T.BOSS.z, -1); }
  else if (boss && !boss.dead && bd > 260 && boss.state === 'sleep') { scene.remove(boss.group); boss.gone = true; boss = null; }
  // rôdeurs nocturnes
  wander -= dt;
  if (night.v && wander <= 0) {
    wander = 7;
    const roamers = enemies.filter((e) => e.campId === -2 && !e.dead).length;
    if (roamers < 3) {
      const a = Math.random() * 6.28, r = 55 + Math.random() * 30, x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
      const h = T.heightAt(x, z);
      if (h > 2 && T.slopeAt(x, z, 3) < 0.6 && Math.abs(x) < T.HALF - 40 && Math.abs(z) < T.HALF - 40) spawnEnemy('slime', x, z, -2);
    }
  }
  if (!night.v) enemies.forEach((e) => { if (e.campId === -2 && !e.dead && Math.hypot(P.x - e.x, P.z - e.z) > 40) { scene.remove(e.group); e.gone = true; } });
  for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].gone) { if (enemies[i] === boss) boss = null; enemies.splice(i, 1); }
}

/* ============================== Interactions ============================== */
function findInteract() {
  let best = null, bd = 1e9;
  const consider = (o, d) => { if (d < bd) { bd = d; best = o; } };
  for (const it of world.interactables) {
    const dx = P.x - it.x, dz = P.z - it.z, d = Math.hypot(dx, dz);
    if (d > it.r) continue;
    if (it.kind === 'tower' && (P.y < it.y - 2 || P.mode !== 'ground')) continue;
    if (it.kind === 'shrine' && (Math.abs(P.y - it.y) > 5 || S.shrines[it.id] || (trial && trial.id === it.id))) continue;
    if (it.kind === 'chest' && S.chests[it.id]) continue;
    consider({ ...it }, d);
  }
  for (const p of world.pickups) {
    if (p.taken) continue;
    const d = Math.hypot(P.x - p.x, P.z - p.z);
    if (d < 2.3 && Math.abs(P.y - p.y) < 2.2) consider({ kind: 'pickup', p }, d - 0.5);
  }
  return best;
}
const PNAME = { apple: 'Pomme', mushroom: 'Champignon bleu', crystal_fire: 'Cristal de feu', crystal_ice: 'Cristal de gel' };
function promptFor(it) {
  if (!it) return null;
  if (it.kind === 'chest') return '[E] Ouvrir le coffre';
  if (it.kind === 'tower') return S.towers[it.id] ? '[E] Se faire lancer vers le ciel' : '[E] Activer la tour';
  if (it.kind === 'shrine') return '[E] Commencer l’épreuve du sanctuaire';
  if (it.kind === 'pickup') return '[E] Ramasser : ' + (it.p.kind === 'weapon' ? WEAPONS[it.p.data.id].name : PNAME[it.p.kind]);
  return null;
}
function activate(it) {
  if (it.kind === 'chest') {
    const ch = world.chests[it.id], rnd = mulberry32(1000 + it.id), table = LOOT[ch.def.tier];
    const item = table[Math.floor(rnd() * table.length)];
    world.openChest(it.id); S.chests[it.id] = true; sfx.chest();
    fx.emit(ch.def.x, ch.def.y + 1.2, ch.def.z, 14, 0xffe27a, 4, 0.7);
    give(item);
  } else if (it.kind === 'tower') {
    if (!S.towers[it.id]) {
      S.towers[it.id] = true; world.setTowerActive(it.id, true);
      const t = T.TOWERS[it.id];
      ui.reveal(t.x, t.z, 300); sfx.tower();
      ui.banner(t.name, 'Région cartographiée', 4000);
      fx.emit(t.x, t.top + 3, t.z, 40, 0x35d8ff, 10, 1.2, 2);
    } else launchFromTower(T.TOWERS[it.id]);
  } else if (it.kind === 'shrine') startTrial(it.id);
  else if (it.kind === 'pickup') {
    const p = it.p;
    let ok = true;
    if (p.kind === 'weapon') ok = addWeapon(p.data.id, p.data.dur) && (ui.toast('⚔ ' + WEAPONS[p.data.id].name), sfx.pickup(), true);
    else ok = give(p.kind);
    if (ok) world.removePickup(p);
  }
}
function launchFromTower(t) {
  const is = T.ISLANDS[t.id];
  const apex = is.y + 22, vy = Math.sqrt(2 * LGRAV * Math.max(10, apex - P.y)), T1 = vy / LGRAV, T2 = Math.sqrt(2 * 22 / LGRAV), TT = T1 + T2;
  P.vy = vy; P.vx = (is.x - P.x) / TT; P.vz = (is.z - P.z) / TT; P.onGround = false; P.launched = true; P.glide = false;
  P.yaw = Math.atan2(P.vx, P.vz); camYaw = P.yaw;
  sfx.launch(); fx.emit(P.x, P.y, P.z, 30, 0x9fe8ff, 8, 0.8);
  ui.banner('Envol !', 'Espace : parapente', 3000);
}

/* ============================== Épreuves de sanctuaire ============================== */
function startTrial(id) {
  if (trial) endTrial(false);
  const sh = T.SHRINES[id], rnd = mulberry32(sh.seed), base = sh.y;
  const rings = [];
  for (let k = 0; k < 5; k++) {
    const a = k * 1.3 + rnd() * 1.2, d = 18 + k * 9 + rnd() * 8;
    let x = sh.x + Math.cos(a) * d, z = sh.z + Math.sin(a) * d;
    let y;
    if (sh.island >= 0) {
      const is = T.ISLANDS[sh.island], dd = Math.hypot(x - is.x, z - is.z);
      if (dd > is.r - 6) { x = is.x + (x - is.x) / dd * (is.r - 6); z = is.z + (z - is.z) / dd * (is.r - 6); }
      y = is.y + [3, 9, 4, 14, 5][k];
    } else y = T.heightAt(x, z) + [3, 14, 4, 22, 5][k];
    rings.push({ x, y, z });
  }
  rings.push({ x: sh.x, y: base + 3, z: sh.z });
  trial = { id, rings, idx: 0, time: 85 };
  while (ring.length < 6) ring.push(world.ring(0xffc23c));
  ring.forEach((r, i) => { r.visible = i < rings.length; if (i < rings.length) r.position.set(rings[i].x, rings[i].y, rings[i].z); });
  ui.banner('Épreuve', 'Traverse les anneaux avant la fin du temps !', 3000); sfx.tower();
}
function endTrial(ok) {
  if (!trial) return;
  const id = trial.id; ring.forEach((r) => (r.visible = false)); trial = null; ui.trial('');
  if (ok) {
    S.shrines[id] = true; world.setShrineState(id, 1); S.orbs++; sfx.jingle();
    ui.banner(T.SHRINES[id].name, 'Épreuve accomplie · +1 esprit d’orbe', 4500);
    ui.reveal(T.SHRINES[id].x, T.SHRINES[id].z, 110);
  } else ui.toast('Épreuve échouée…', 2000);
}
function updateTrial(dt, t) {
  if (!trial) return;
  trial.time -= dt;
  ui.trial(`⏱ ${Math.max(0, trial.time).toFixed(1)} s · anneau ${trial.idx + 1}/${trial.rings.length}`);
  const r = trial.rings[trial.idx];
  ring.forEach((m, i) => {
    if (i >= trial.rings.length) return;
    m.visible = i >= trial.idx;
    m.material.color.setHex(i === trial.idx ? 0xffc23c : 0x6a7a90);
    m.material.opacity = i === trial.idx ? 0.95 : 0.35;
    m.rotation.y += dt * 0.8;
    m.scale.setScalar(i === trial.idx ? 1 + Math.sin(t * 6) * 0.06 : 0.85);
  });
  if (Math.hypot(P.x - r.x, P.y + 1 - r.y, P.z - r.z) < 3.6) {
    sfx.lumi(); fx.emit(r.x, r.y, r.z, 20, 0xffc23c, 6, 0.6);
    trial.idx++;
    if (trial.idx >= trial.rings.length) endTrial(true);
  } else if (trial.time <= 0) endTrial(false);
}

/* ============================== Lumis ============================== */
function updateLumis() {
  for (let i = 0; i < T.LUMIS.length; i++) {
    if (S.lumis[i]) continue;
    const l = T.LUMIS[i];
    const dx = P.x - l.x, dz = P.z - l.z;
    if (dx * dx + dz * dz > 6) continue;
    if (Math.abs(P.y + 1 - l.y) > 2.6) continue;
    S.lumis[i] = true; world.collectLumi(i); sfx.lumi(); fx.emit(l.x, l.y, l.z, 14, 0x7ff3ff, 4, 0.7, -1);
    const n = count(S.lumis);
    ui.toast(`✦ Lumi ${n}/${T.LUMIS.length}`, 1800);
    if (n % 12 === 0) { S.orbs++; ui.banner('Esprit d’orbe', `${n} lumis rassemblés`, 3000); sfx.jingle(); }
  }
}

/* ============================== Caméra & boucle ============================== */
function camDir() {
  const cp = Math.cos(camPitch);
  return { x: Math.sin(camYaw) * cp, y: -Math.sin(camPitch), z: Math.cos(camYaw) * cp };
}
function updateCamera(dt) {
  const head = { x: P.x, y: P.y + (P.mode === 'swim' ? 0.5 : 1.55), z: P.z };
  const want = P.mode === 'climbT' ? 7.2 : P.glide ? 8.5 : P.launched ? 9 : 5.6;
  camDist += (want - camDist) * Math.min(1, dt * 3);
  const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
  let cx = head.x - Math.sin(camYaw) * cp * camDist, cy = head.y + sp * camDist, cz = head.z - Math.cos(camYaw) * cp * camDist;
  const gh = world.surfaceHeight(cx, cz, cy + 2, true) + 0.7;
  if (cy < gh) cy = gh;
  if (shake > 0) { cx += (Math.random() - 0.5) * shake * 0.8; cy += (Math.random() - 0.5) * shake * 0.8; shake = Math.max(0, shake - dt); }
  camera.position.set(cx, cy, cz);
  camera.lookAt(head.x, head.y, head.z);
  const spd = Math.hypot(P.vx, P.vz), fov = 68 + clamp(spd - 8, 0, 14) * 0.7 + (P.glide ? 6 : 0);
  if (Math.abs(camera.fov - fov) > 0.1) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
  return head;
}

function tick(dt, now) {
  S.play += dt;
  if (!CH.freeze) S.time = (S.time + dt / 540) % 1;
  // météo
  weather.t -= dt;
  if (weather.t <= 0) {
    if (weather.on) { weather.on = false; weather.t = 60 + Math.random() * 120; }
    else { weather.on = Math.random() < 0.3; weather.t = weather.on ? 50 + Math.random() * 70 : 40 + Math.random() * 80; if (weather.on) ui.toast('Il commence à pleuvoir…', 2500); }
  }
  night.v = sky.elev < -0.05;

  const inp = readInput();
  const shiftHeld = !!(keys.ShiftLeft || keys.ShiftRight);
  const dir = camDir();
  const head = { x: P.x, y: P.y + 1.55, z: P.z };

  // clavier : caméra, armes, objets
  if (keys.ArrowLeft) camYaw += 2.2 * dt; if (keys.ArrowRight) camYaw -= 2.2 * dt;
  if (keys.ArrowUp) camPitch = clamp(camPitch - 1.4 * dt, -0.45, 1.35); if (keys.ArrowDown) camPitch = clamp(camPitch + 1.4 * dt, -0.45, 1.35);
  for (let i = 1; i <= 5; i++) if (just['Digit' + i] && S.weapons[i - 1]) { S.sel = i - 1; refreshWeaponModel(); ui.toast(WEAPONS[weapon().id].name, 1200); }
  if (just.KeyH) eat();
  if (just.KeyF) fuse();

  // Main-Mère (saisir / coller / poser) et Rappel
  if (just.Mouse2 && !builder.held && !P.dead) {
    const hit = builder.raycast(head.x, head.y, head.z, dir.x, dir.y, dir.z, 16);
    if (hit) builder.grab(hit.group, hit.t, camYaw);
  }
  if (builder.held) {
    if (!mouse[2]) builder.release();
    else {
      builder.updateHeld(head, dir, camYaw);
      if (just.Mouse0) { if (!builder.glue()) ui.toast('Approche l’objet d’un autre pour le coller.', 1800); }
    }
  } else {
    const hit = builder.raycast(head.x, head.y, head.z, dir.x, dir.y, dir.z, 16);
    builder.setHover(builder.recalling ? null : hit ? hit.group : null);
    if (keys.KeyX && !builder.recalling) { const h2 = builder.raycast(head.x, head.y, head.z, dir.x, dir.y, dir.z, 26); if (h2) { builder.startRecall(h2.group); ui.hint('Rappel…'); } }
    if (!keys.KeyX && builder.recalling) builder.stopRecall();
    if (just.KeyV && hit && !builder.detach(hit)) ui.toast('Rien à détacher.', 1200);
  }
  if (just.KeyB) {
    let g = builder.groupUnder(P.x, P.y, P.z);
    if (!g) { let bd = 8; for (const o of builder.groups) { const d = Math.hypot(o.x - P.x, o.z - P.z); if (d < bd && o.fans > 0) { bd = d; g = o; } } }
    if (g) { if (g.fans === 0) ui.toast('Aucune hélice sur cet assemblage.', 1800); else { g.power = !g.power; ui.toast(g.power ? 'Moteur en marche · ZQSD pour piloter' : 'Moteur coupé', 1800); sfx.glue(); } }
  }

  // véhicule + transport du joueur
  const under = P.onGround && P.mode === 'ground' ? builder.groupUnder(P.x, P.y, P.z) : null;
  let loc = null, yaw0 = 0;
  if (under) { loc = builder.toLocal(under, P.x, P.z); yaw0 = under.yaw; }
  const drive = { throttle: 0, steer: 0 };
  if (under && under.power) { drive.throttle = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 0.6 : 0); drive.steer = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0); }
  builder.update(dt, drive, now);
  if (under) {
    const w = builder.toWorld(under, loc.x, loc.z); P.x = w.x; P.z = w.z; P.yaw += under.yaw - yaw0;
    const s = builder.surfaceAt(P.x, P.z, P.y + 0.6); if (s !== null) P.y = s;
  }

  // attaque
  if (just.Mouse0 && !builder.held && P.atk < 0 && P.atkCD <= 0 && P.roll <= 0 && P.mode === 'ground' && !P.glide) startAttack();
  if (P.atk >= 0) {
    P.atk += dt / P.atkDur;
    if (!P.hitDone && P.atk > 0.45) { P.hitDone = true; doHit(); }
    if (P.atk >= 1) { P.atk = -1; P.atkCD = 0.1; }
  }

  updatePlayer(dt, inp, shiftHeld);

  // monde
  const camHead = updateCamera(dt);
  ectx.time = now; ectx.night = night.v; ectx.camQuat = camera.quaternion;
  manageSpawns(dt);
  for (const e of enemies) if (Math.hypot(e.x - P.x, e.z - P.z) < 300) e.update(dt, ectx);
  // gabarit de télégraphie du colosse
  if (boss && boss.tele) { tele.visible = true; tele.position.set(boss.tele.x, T.heightAt(boss.tele.x, boss.tele.z) + 0.2, boss.tele.z); tele.scale.setScalar(boss.tele.r); tele.material.opacity = 0.2 + boss.tele.t * 0.4; }
  else tele.visible = false;
  world.update(dt, now, P);
  const rainTarget = weather.on ? 1 : 0;
  sky.update(S.time, camHead, camera, dt, rainTarget);
  sky.dir.castShadow = sky.dir.castShadow && shadowsOn;
  fx.update(dt);
  updateTrial(dt, now);
  updateLumis();

  // exploration de la carte
  const cell = Math.floor(P.x / 40) + ',' + Math.floor(P.z / 40);
  if (cell !== lastCell) { lastCell = cell; ui.reveal(P.x, P.z, 75); }

  // interaction
  const it = P.dead ? null : findInteract();
  ui.prompt(it ? promptFor(it) : null);
  if (it && just.KeyE) activate(it);

  // modèle du joueur
  const m = P.mode === 'swim' ? 'swim' : P.mode === 'climbT' || P.mode === 'climbW' ? 'climb' : P.glide ? 'glide' : !P.onGround ? 'air' : 'ground';
  model.group.position.set(P.x, P.y, P.z); model.group.rotation.y = P.yaw;
  model.group.visible = P.inv <= 0 || Math.floor(P.inv * 14) % 2 === 0 || P.dead;
  model.animate(dt, {
    speed: m === 'climb' ? P.climbing : Math.min(1, Math.hypot(P.vx, P.vz) / RUN), mode: P.dead ? 'dead' : m,
    attack: P.atk, roll: P.roll > 0 ? 1 - P.roll : 0, t: now,
  });

  // HUD
  ui.setHearts(Math.ceil(P.hp), maxHp());
  ui.drawStamina(P.stamina, S.stamMax, P.exhausted, P.mode === 'climbT' || P.mode === 'climbW' || P.mode === 'swim' || P.stamina < S.stamMax - 1);
  hudT -= dt;
  if (hudT <= 0) {
    hudT = 0.4; ui.setObjectives(S, ui.exploredPct()); ui.clock(S.time);
    ui.setWeapons(S.weapons, S.sel, WEAPONS, S);
    let h = '';
    if (builder.held) h = 'Molette : tourner · Maj+molette : distance · Clic gauche : coller · Relâcher : poser';
    else if (builder.hover) h = 'Clic droit (tenir) : saisir · V : détacher · X : Rappel';
    else if (builder.groupUnder(P.x, P.y, P.z)) h = '[B] Moteur (si hélices)';
    else if (!locked()) h = 'Clique dans le jeu pour capturer la souris';
    else if (P.glide) h = 'ZQSD : diriger · W : piquer · S : freiner';
    ui.hint(h);
  }
  miniT -= dt;
  if (miniT <= 0) { miniT = 0.1; ui.drawMini(P.x, P.z, camYaw, S); }
  const bs = boss && !boss.dead && boss.state !== 'sleep' ? boss : null;
  ui.boss(bs ? 'Colosse de pierre' : '', bs ? bs.hp / bs.max : null);

  saveT += dt;
  if (saveT > 15) { saveT = 0; saveGame(); }
  for (const k in just) just[k] = false;
}

function titleScene(dt) {
  tAnim += dt;
  const a = tAnim * 0.06, cx = Math.cos(a) * 55, cz = Math.sin(a) * 55, y = T.heightAt(cx, cz);
  camera.position.set(cx, Math.max(y, 14) + 14, cz);
  camera.lookAt(0, 16, 0);
  model.group.position.set(0, T.heightAt(0, 0), 0);
  model.animate(dt, { speed: 0, mode: 'ground', attack: -1, roll: 0, t: tAnim });
  world.update(dt, tAnim, { x: 0, y: 14, z: 0 });
  sky.update(0.33, { x: 0, y: 14, z: 0 }, camera, dt, 0);
  fx.update(dt);
}

function frame(now) {
  requestAnimationFrame(frame);
  const t = now / 1000, dt = Math.min(0.05, Math.max(0, t - last)); last = t;
  if (mode === 'play') tick(dt, t);
  else if (mode === 'title') titleScene(dt);
  else if (mode === 'pause' || mode === 'map' || mode === 'dead' || mode === 'cheat') { world.update(0, t, P); }
  if (mode !== 'loading') renderer.render(scene, camera);
}

/* ============================== Démarrage ============================== */
async function boot() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  ui = new UI();
  await wait(40);
  world = new World(scene);
  ectx.world = world;
  sky = new Sky(scene, renderer);
  fx = new Particles(scene); ectx.fx = fx;
  builder = new Builder(scene, world, fx, sfx);
  builder.spawnWorkshop();
  model = new PlayerModel(); scene.add(model.group); model.setWeapon(WEAPONS.branch);
  tele = new THREE.Mesh(new THREE.CircleGeometry(1, 36), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.35, depthWrite: false }));
  tele.rotation.x = -Math.PI / 2; tele.visible = false; scene.add(tele);
  $('loadMsg').textContent = 'Cartographie…';
  await wait(30);
  ui.renderBaseMap();
  cheats = initCheats(cheatApi());

  const sv = readSave();
  $('btnContinue').disabled = !sv;
  if (sv) $('nameInput').value = sv.name || '';
  $('btnNew').addEventListener('click', () => startGame(true));
  $('btnContinue').addEventListener('click', () => startGame(false));
  $('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') startGame(!readSave()); });
  net.fetchTop(10).then((r) => { fillBoard($('titleBoard'), r); $('titleBoardStatus').textContent = net.ONLINE ? 'Classement en ligne (Supabase)' : 'Classement local (renseigne config.js pour le mode en ligne)'; })
    .catch(() => { $('titleBoardStatus').textContent = 'Classement indisponible.'; });
  show('titleMenu', true); $('loadMsg').textContent = '';
  mode = 'title';
  window.addEventListener('beforeunload', () => { if (S && mode !== 'title') saveGame(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && S && mode === 'play') saveGame(); });
  last = performance.now() / 1000;
  requestAnimationFrame(frame);
}
$('titleMenu').classList.add('hidden');
boot();

// Accès de débogage / tests
if (window.__EOLIA_TEST__) window.__eolia = { get cheats() { return cheats; }, CH, get trial() { return trial; }, setYaw: (v) => { camYaw = v; }, activate, findInteract, get S() { return S; }, P, get mode() { return mode; }, T, teleport, startGame, tick: (dt = 0.016) => tick(dt, performance.now() / 1000), get world() { return world; }, get builder() { return builder; }, get enemies() { return enemies; }, setTime: (t) => { S.time = t; }, keys, just, mouse, camera, score };
