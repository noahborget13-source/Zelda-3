# ÉOLIA — Terres ouvertes

Jeu d'aventure en monde ouvert 3D (navigateur), **inspiré** de Breath of the Wild / Tears of the Kingdom, avec son propre univers, ses propres noms et ses propres graphismes.

## Contenu du jeu

- **Monde procédural de 1,6 km × 1,6 km** : prairies, forêts, désert, massifs rocheux à falaises, neige, lacs, océan. Cycle jour/nuit, pluie.
- **Escalade libre** des parois et des tours (endurance ; plus glissant sous la pluie), **parapente**, **nage**, roulade.
- **5 Tours du Ciel** : les activer dévoile la carte, puis elles te lancent vers des **îles célestes** (coffres, sanctuaires, lumis).
- **8 sanctuaires** (épreuve d'anneaux chronométrée) → esprits d'orbe → +cœurs / +endurance.
- **Combat** : armes qui se brisent, **Fusion** (cristal de feu / de gel sur une arme), roulade esquive, Gluants, Rôdeurs d'ombre (plus nombreux la nuit), **camps** à nettoyer, **boss : le Colosse de pierre**.
- **Pouvoirs de construction** : *Main-Mère* (saisir, tourner, coller des objets), **hélices**, **ballons**, **tonneaux** (flottent), **Rappel** (remonte le temps d'un objet). Les assemblages sont pilotables.
- **Carte** avec brouillard d'exploration, **voyage rapide** (tours, sanctuaires), **sauvegarde automatique**.
- **Classement mondial** (Supabase) : score = exploration + tours + sanctuaires + lumis + camps + boss.

## Commandes

| Touche | Action |
|---|---|
| ZQSD / WASD, Maj | Se déplacer, sprint |
| Espace | Sauter · en l'air : parapente |
| Vers une paroi | Escalader |
| Clic gauche / Q | Attaquer / roulade |
| E / H / F | Interagir / manger / fusionner un cristal |
| Clic droit (tenir) | Main-Mère : saisir · molette : tourner · clic gauche : coller |
| X (tenir) / V / B | Rappel / détacher une pièce / moteur du véhicule |
| 1-5 ou molette | Changer d'arme |
| M / Tab | Carte / menu pause |

Un atelier t'attend près de l'étang, à l'est du point de départ : caisses, planches, tonneaux, hélices, ballons.

## Lancer en local

Les modules ES nécessitent un petit serveur (pas `file://`) :

```bash
python3 -m http.server 8000     # puis ouvre http://localhost:8000
```

Three.js est chargé automatiquement depuis un CDN (jsdelivr, puis unpkg). **Pour un jeu 100 % autonome**, place la version locale :

```bash
npm i three@0.160.0
cp node_modules/three/build/three.module.js vendor/three.module.min.js
```
(le jeu utilise `vendor/three.module.min.js` s'il existe.)

## Mise en ligne

1. **Supabase** : crée un projet, exécute `supabase/schema.sql` (SQL Editor), copie *Project URL* et la clé **anon** dans `config.js`.
2. **GitHub** : `git init && git add . && git commit -m "Éolia" && git branch -M main && git remote add origin <url> && git push -u origin main`
3. **Vercel** : *Add New > Project*, importe le dépôt, preset **Other**, aucune commande de build. Deploy.

Sans Supabase, le classement reste local au navigateur.

## Sécurité

La clé `anon` est publique par conception ; la protection vient des règles RLS (lecture + ajout seulement, valeurs bornées). Un score envoyé du navigateur reste falsifiable : pour un classement fiable, valider côté serveur (Edge Function).

## Structure

```
index.html        page + interface + chargement de Three.js
config.js         URL + clé anon Supabase
src/terrain.js    relief, biomes, points d'intérêt (sans dépendance)
src/world.js      monde 3D (terrain, tours, sanctuaires, îles, végétation)
src/sky.js        ciel, jour/nuit, nuages, pluie
src/entities.js   modèle du joueur, ennemis, boss
src/build.js      Main-Mère, assemblages, Rappel, véhicules
src/main.js       boucle de jeu, joueur, combat, épreuves, sauvegarde
src/ui.js         HUD, carte, menus
src/net.js        classement Supabase (REST)
supabase/         schema.sql
vercel.json
```
