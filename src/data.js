// Données de jeu : armes, butin, textes.
export const WEAPONS = {
  branch:  { id: 'branch',  name: 'Branche',                dmg: 4,  dur: 12, reach: 2.3, speed: 0.42, kind: 'stick', col: 0x8a5a2b },
  rusty:   { id: 'rusty',   name: 'Épée rouillée',          dmg: 8,  dur: 20, reach: 2.6, speed: 0.40, kind: 'sword', col: 0xa0a7b0 },
  club:    { id: 'club',    name: 'Gourdin clouté',         dmg: 11, dur: 18, reach: 2.5, speed: 0.58, kind: 'club',  col: 0x7a5530 },
  spear:   { id: 'spear',   name: 'Lance de garde',         dmg: 10, dur: 22, reach: 3.8, speed: 0.50, kind: 'spear', col: 0xc9ced6 },
  knight:  { id: 'knight',  name: 'Claymore de chevalier',  dmg: 20, dur: 26, reach: 3.0, speed: 0.68, kind: 'sword', col: 0xdde3ee },
  radiant: { id: 'radiant', name: 'Lame d’éclat',           dmg: 30, dur: 45, reach: 3.1, speed: 0.42, kind: 'sword', col: 0x9ff3ff },
};

// Table de butin par niveau de coffre (0 : sol, 1 : camp, 2 : ciel)
export const LOOT = [
  ['rusty', 'club', 'spear', 'apple', 'apple', 'crystal_fire'],
  ['club', 'spear', 'knight', 'crystal_ice', 'crystal_fire', 'mushroom'],
  ['knight', 'radiant', 'radiant', 'crystal_fire', 'crystal_ice', 'knight'],
];

export const FUSE = {
  fire: { name: 'Feu', dmg: 4, color: 0xff4a10 },
  ice: { name: 'Gel', dmg: 2, color: 0x58c8ff },
};

export const TUTORIAL = [
  'Bienvenue à Éolia. Déplace-toi avec ZQSD / WASD, la souris oriente la caméra.',
  'Maj = sprint · Espace = saut · Espace en l’air = parapente.',
  'Contre une paroi raide, avance pour grimper (l’endurance se vide !).',
  'Grimpe une Tour du Ciel pour dévoiler la carte, puis laisse-toi lancer dans les airs.',
  'Près de l’étang, un atelier : maintiens clic droit pour saisir, clic gauche pour coller.',
];
