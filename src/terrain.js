// Génération procédurale du monde : relief, biomes, points d'intérêt.
// Aucune dépendance à Three.js : testable sous Node.
import { Noise, clamp, lerp, smoothstep, mulberry32, TAU } from './util.js';

export const SIZE = 1600;
export const HALF = SIZE / 2;
export const WATER = 0;           // altitude de l'eau
export const STEEP = 1.15;        // pente (dy/dx) au-delà de laquelle on glisse / on escalade
export const TOWER_H = 46;

const nA = new Noise(11), nM = new Noise(23), nL = new Noise(37), nD = new Noise(51), nT = new Noise(67), nR = new Noise(83);

function climate(x, z) {
  const mm = smoothstep(0.0, 0.42, nM.fbm(x * 0.0009 + 5, z * 0.0009 + 9, 3));
  const temp = nT.fbm(x * 0.0012 + 3, z * 0.0012 - 8, 3) * 1.3 + (x / HALF) * 1.05 - 0.3;
  const des = smoothstep(0.16, 0.38, temp) * (1 - mm);
  return { mm, des };
}

export function heightAt(x, z) {
  const { mm, des } = climate(x, z);
  let h = 18 + nA.fbm(x * 0.0016, z * 0.0016, 4) * 34;
  const ridge = clamp(1 - Math.abs(nM.fbm(x * 0.004, z * 0.004, 3) * 1.7), 0, 1);
  let hm = h + mm * (26 + ridge * ridge * 120);
  // terrasses : falaises à la manière des grands massifs
  const step = 15, f = hm / step, fl = Math.floor(f);
  hm = lerp(hm, (fl + smoothstep(0.62, 0.96, f - fl)) * step, clamp(mm * 1.3, 0, 0.8));
  // lacs
  const lake = nL.fbm(x * 0.0032 + 40, z * 0.0032 - 70, 3);
  hm -= smoothstep(0.1, 0.38, lake) * 40 * (1 - mm * 0.8);
  // désert : plaines et dunes
  const dunes = nD.fbm(x * 0.012, z * 0.012, 2) * 6 + Math.sin((x + z * 0.4) * 0.045) * 2.2;
  hm = lerp(hm, 11 + dunes, des * 0.85);
  // bord de la carte : plongée dans l'océan
  const e = smoothstep(0.68, 1.0, Math.max(Math.abs(x), Math.abs(z)) / HALF);
  hm -= e * 100;
  // prairie de départ
  const sp = smoothstep(120, 42, Math.hypot(x, z));
  hm = lerp(hm, 13 + nD.fbm(x * 0.02, z * 0.02, 2) * 2.2, sp);
  // étang de l'atelier
  const pond = smoothstep(58, 16, Math.hypot(x - 135, z - 12));
  hm = lerp(hm, -3.6, pond * 0.96);
  return hm;
}

export function slopeAt(x, z, e = 2) {
  return Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
}

// Direction de la plus grande montée (vecteur unitaire horizontal)
export function uphillAt(x, z, e = 2) {
  const gx = heightAt(x + e, z) - heightAt(x - e, z), gz = heightAt(x, z + e) - heightAt(x, z - e);
  const l = Math.hypot(gx, gz) || 1;
  return [gx / l, gz / l];
}

export const BIOME = { WATER: 0, SAND: 1, GRASS: 2, FOREST: 3, DESERT: 4, ROCK: 5, SNOW: 6 };

export function biomeAt(x, z, h = heightAt(x, z), slope = slopeAt(x, z)) {
  const { des } = climate(x, z);
  const snowLine = 78 + nR.fbm(x * 0.01, z * 0.01, 2) * 10;
  if (h < WATER - 0.3) return BIOME.WATER;
  if (h > snowLine && slope < 1.6) return BIOME.SNOW;
  if (slope > 0.95 || h > snowLine) return BIOME.ROCK;
  if (h < WATER + 1.6) return BIOME.SAND;
  if (des > 0.5) return BIOME.DESERT;
  const moist = nR.fbm(x * 0.006 + 200, z * 0.006 + 80, 3);
  return moist > 0.04 ? BIOME.FOREST : BIOME.GRASS;
}

const PAL = {
  [BIOME.WATER]: [0.55, 0.50, 0.38], [BIOME.SAND]: [0.90, 0.83, 0.58], [BIOME.GRASS]: [0.52, 0.74, 0.30],
  [BIOME.FOREST]: [0.30, 0.55, 0.24], [BIOME.DESERT]: [0.88, 0.73, 0.44], [BIOME.ROCK]: [0.52, 0.49, 0.46],
  [BIOME.SNOW]: [0.95, 0.97, 1.0],
};
export function colorAt(x, z, h, slope) {
  const b = biomeAt(x, z, h, slope);
  const c = PAL[b], j = 0.92 + nD.n(x * 0.09, z * 0.09) * 0.16;
  return [c[0] * j, c[1] * j, c[2] * j, b];
}

/* ------------------------------ Points d'intérêt ------------------------------ */
function findSpot(x0, z0, ok, maxR = 320) {
  for (let r = 0; r <= maxR; r += 10) {
    const n = Math.max(1, Math.floor(r / 5));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + r * 0.7;
      const x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r;
      if (ok(x, z)) return { x, z };
    }
  }
  return { x: x0, z: z0 };
}
const landOK = (min, max, ms) => (x, z) => {
  if (Math.abs(x) > HALF * 0.8 || Math.abs(z) > HALF * 0.8) return false;
  const h = heightAt(x, z);
  return h > min && h < max && slopeAt(x, z, 4) < ms;
};

const rnd = mulberry32(20261101);
const R = (a, b) => a + rnd() * (b - a);

const TOWER_NAMES = ['Tour de l’Aube', 'Tour des Dunes', 'Tour du Givre', 'Tour des Brumes', 'Tour du Levant'];
const TOWER_TARGETS = [[-85, -75], [430, 250], [-520, -380], [-390, 470], [480, -470]];
export const TOWERS = TOWER_TARGETS.map(([tx, tz], i) => {
  const p = findSpot(tx, tz, landOK(6, 70, 0.3));
  const y = heightAt(p.x, p.z);
  return { id: i, name: TOWER_NAMES[i], x: p.x, z: p.z, y, top: y + TOWER_H, r: 4.2 };
});

// Îles célestes (une par tour : la tour y envoie le joueur)
export const ISLANDS = TOWERS.map((t, i) => {
  const a = 0.9 + i * 1.35;
  let x = t.x + Math.cos(a) * 200, z = t.z + Math.sin(a) * 200;
  x = clamp(x, -HALF * 0.75, HALF * 0.75); z = clamp(z, -HALF * 0.75, HALF * 0.75);
  return { id: i, x, z, y: 178 + i * 11, r: 38 + (i % 3) * 8 };
});

const SHRINE_NAMES = ['Sanctuaire Zéphyr', 'Sanctuaire Ambre', 'Sanctuaire Onyx', 'Sanctuaire Lierre', 'Sanctuaire Brume',
  'Sanctuaire Nuée', 'Sanctuaire Éclat', 'Sanctuaire Firmament'];
const groundShrines = [];
const ST = [[-30, 110], [250, -130], [330, 420], [-300, 120], [60, -380], [-180, -330]];
ST.forEach(([sx, sz]) => {
  const p = findSpot(sx, sz, landOK(5, 85, 0.3));
  groundShrines.push({ x: p.x, z: p.z, y: heightAt(p.x, p.z), island: -1 });
});
const islandShrines = [0, 1].map((k) => {
  const is = ISLANDS[k + 1];
  return { x: is.x, z: is.z + 4, y: is.y, island: is.id };
});
export const SHRINES = [...groundShrines, ...islandShrines].map((s, i) => ({ ...s, id: i, name: SHRINE_NAMES[i], r: 3.6, seed: 900 + i * 37 }));

export const BOSS = (() => {
  const p = findSpot(-260, 280, landOK(6, 60, 0.18));
  return { x: p.x, z: p.z, y: heightAt(p.x, p.z), name: 'Le Colosse de pierre' };
})();

export const CAMPS = (() => {
  const T = [[150, 190], [-200, -120], [300, -20], [-110, 330], [120, -270], [-430, 60]];
  return T.map(([cx, cz], i) => {
    const p = findSpot(cx, cz, landOK(5, 75, 0.2));
    return { id: i, x: p.x, z: p.z, y: heightAt(p.x, p.z), n: 3 + (i % 3) };
  });
})();

export const WORKSHOP = (() => {
  const x = 100, z = -4;
  return { x, z, y: Math.max(heightAt(x, z), 1.2) };
})();

export const LUMIS = (() => {
  const out = [];
  let tries = 0;
  while (out.length < 36 && tries++ < 4000) {
    const x = R(-HALF * 0.78, HALF * 0.78), z = R(-HALF * 0.78, HALF * 0.78);
    const h = heightAt(x, z);
    if (h > 3 && h < 95) out.push({ x, z, y: h + R(0.8, 2.2) });
  }
  ISLANDS.forEach((is) => out.push({ x: is.x + 6, z: is.z - 8, y: is.y + 2.5 }));
  return out.map((l, i) => ({ ...l, id: i }));
})();

export const CHESTS = (() => {
  const out = [];
  let tries = 0;
  while (out.length < 14 && tries++ < 4000) {
    const x = R(-HALF * 0.75, HALF * 0.75), z = R(-HALF * 0.75, HALF * 0.75);
    const h = heightAt(x, z);
    if (h > 4 && h < 80 && slopeAt(x, z, 3) < 0.35) out.push({ x, z, y: h });
  }
  CAMPS.forEach((c) => out.push({ x: c.x + 5, z: c.z - 4, y: heightAt(c.x + 5, c.z - 4), camp: c.id }));
  ISLANDS.forEach((is) => out.push({ x: is.x - 9, z: is.z + 6, y: is.y, sky: true }));
  return out.map((c, i) => ({ ...c, id: i, tier: c.sky ? 2 : c.camp !== undefined ? 1 : 0 }));
})();

// Hauteur d'une île au point (x,z) (disque plat), ou null si hors de l'île.
export function islandTop(is, x, z) {
  return Math.hypot(x - is.x, z - is.z) > is.r ? null : is.y;
}
