// Menu de triche réservé au propriétaire.
// Ouverture : F9 ou ² (touche Backquote). Protégé par un code : seule une double empreinte SHA-256 est dans le source.
// NB : tout ce qui tourne côté navigateur reste contournable par un joueur déterminé sur SA propre copie ;
// ce garde-fou empêche l'usage « normal » et le classement en ligne est protégé par le drapeau S.cheated.
export const CH = { god: false, stam: false, dura: false, oneshot: false, fly: false, speed: 1, freeze: false };

const H2 = 'c9acff233df503086dabb023104600952b44e1a15bac1c64ce552a5caed391f2';
const LS = 'eolia_dev_v1';

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function isUnlocked() {
  try { const v = localStorage.getItem(LS); return !!v && (await sha(v)) === H2; } catch { return false; }
}

const CSS = `
#cheat{position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;background:rgba(3,6,14,.78);backdrop-filter:blur(4px)}
#cheat.on{display:flex}
#cheat .box{width:min(880px,94vw);max-height:90vh;overflow:auto;background:rgba(12,18,34,.96);border:1px solid #ff9a3c;border-radius:14px;padding:16px 18px;color:#f4f1e6;font:13px ui-monospace,Menlo,Consolas,monospace;user-select:none}
#cheat h3{margin:0 0 4px;font-size:15px;letter-spacing:.25em;color:#ff9a3c}
#cheat h4{margin:14px 0 6px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#35d8ff}
#cheat .sub{color:#a7b3c4;font-size:11px;margin-bottom:6px}
#cheat .grid{display:flex;flex-wrap:wrap;gap:6px}
#cheat button{font:inherit;cursor:pointer;color:#f4f1e6;background:#1c2742;border:1px solid #33456f;border-radius:7px;padding:6px 10px}
#cheat button:hover{background:#27375e}
#cheat button.on{background:#ff9a3c;color:#1a1208;border-color:#ffc27a;font-weight:700}
#cheat input[type=password]{font:inherit;padding:8px 10px;border-radius:7px;border:1px solid #33456f;background:#0a1020;color:#fff;width:240px}
#cheat input[type=range]{width:240px;vertical-align:middle}
#cheat .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
#cheat .err{color:#ff6a6a;font-size:12px;min-height:16px;margin-top:6px}
`;

export function initCheats(api) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const root = document.createElement('div'); root.id = 'cheat';
  const box = document.createElement('div'); box.className = 'box'; root.appendChild(box);
  document.body.appendChild(root);
  let built = false;

  const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); kids.forEach((k) => e.append(k)); return e; };
  const btn = (label, fn, extra = {}) => el('button', { textContent: label, onclick: (ev) => { ev.stopPropagation(); fn(ev.currentTarget); }, ...extra });
  const section = (title, items, sub) => { const s = el('div'); s.append(el('h4', { textContent: title })); if (sub) s.append(el('div', { className: 'sub', textContent: sub })); const g = el('div', { className: 'grid' }); items.forEach((i) => g.append(i)); s.append(g); return s; };
  const toggle = (label, key, onSet) => {
    const b = btn(label, () => { CH[key] = !CH[key]; if (CH[key]) api.mark(); b.classList.toggle('on', CH[key]); if (onSet) onSet(CH[key]); api.toast(label + (CH[key] ? ' : activé' : ' : désactivé'), 1200); });
    b.classList.toggle('on', CH[key]); return b;
  };
  const act = (label, fn) => btn(label, () => { api.mark(); fn(); api.toast(label, 1200); });

  function build() {
    box.textContent = '';
    box.append(el('h3', { textContent: 'MODE DÉVELOPPEUR' }), el('div', { className: 'sub', textContent: 'F9 / ² ou Échap pour fermer · les actions bloquent la publication du score pour cette partie' }));

    const speedBtn = btn('Vitesse ×' + CH.speed, () => { CH.speed = CH.speed >= 4 ? 1 : CH.speed * 2; if (CH.speed > 1) api.mark(); speedBtn.textContent = 'Vitesse ×' + CH.speed; speedBtn.classList.toggle('on', CH.speed > 1); });
    speedBtn.classList.toggle('on', CH.speed > 1);
    box.append(section('Joueur', [
      toggle('Invincible', 'god'), toggle('Endurance infinie', 'stam'), toggle('Armes increvables', 'dura'), toggle('1 coup = 1 kill', 'oneshot'),
      toggle('Vol (Espace ↑ · C ↓)', 'fly', (on) => api.fly(on)), speedBtn,
      act('Soigner', api.heal), act('+1 cœur', api.heart), act('+25 endurance max', api.stamMax), act('+10 orbes', api.orbs),
    ]));
    box.append(section('Inventaire', [
      act('Toutes les armes', api.weapons), act('+10 pommes', () => api.food('apple', 10)), act('+5 champignons', () => api.food('mushroom', 5)),
      act('+5 cristaux de feu', () => api.food('fire', 5)), act('+5 cristaux de gel', () => api.food('ice', 5)),
    ]));

    const hour = el('input', { type: 'range', min: 0, max: 24, step: 0.25, value: api.hour() });
    const hl = el('span', { textContent: ' ' + api.hour().toFixed(1) + ' h' });
    hour.oninput = () => { api.mark(); api.setHour(+hour.value); hl.textContent = ' ' + (+hour.value).toFixed(1) + ' h'; };
    const hrow = el('div', { className: 'row' }, [el('span', { textContent: 'Heure' }), hour, hl]);
    const w = section('Monde', [
      toggle('Figer le temps', 'freeze'), act('Pluie ON', () => api.rain(true)), act('Pluie OFF', () => api.rain(false)),
      act('Révéler la carte', api.reveal), act('Activer les tours', api.towers), act('Réussir les sanctuaires', api.shrines),
      act('Ramasser tous les lumis', api.lumis), act('Tuer tous les ennemis', api.killAll),
    ]);
    w.prepend(hrow); box.append(w);

    box.append(section('Apparitions (devant toi)', [
      act('Gluant', () => api.spawn('slime')), act('Rôdeur d’ombre', () => api.spawn('brute')),
      act('Caisse', () => api.part('crate')), act('Planche', () => api.part('plank')), act('Tonneau', () => api.part('barrel')),
      act('Hélice', () => api.part('fan')), act('Ballon', () => api.part('balloon')),
    ]));
    box.append(section('Téléportation', api.places().map((p) => btn(p.label, () => { api.mark(); api.close(); api.teleport(p.x, p.z, p.label); }))));
    box.append(el('div', { style: 'margin-top:14px', className: 'row' }, [
      btn('Fermer', () => api.close()),
      btn('Verrouiller (oublier le code)', () => { try { localStorage.removeItem(LS); } catch {} api.close(); api.toast('Menu verrouillé', 1500); }),
    ]));
    built = true;
  }

  function showLock() {
    box.textContent = '';
    const input = el('input', { type: 'password', placeholder: 'Code', autocomplete: 'off', spellcheck: false });
    const err = el('div', { className: 'err' });
    const go = async () => {
      if (!(crypto && crypto.subtle)) { err.textContent = 'Contexte non sécurisé (https requis).'; return; }
      const h1 = await sha(input.value.trim());
      if ((await sha(h1)) === H2) { try { localStorage.setItem(LS, h1); } catch {} build(); }
      else { err.textContent = 'Code incorrect.'; input.value = ''; }
    };
    input.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); if (e.key === 'Escape') api.close(); };
    box.append(el('h3', { textContent: 'ACCÈS RESTREINT' }), el('div', { className: 'row', style: 'margin-top:10px' }, [input, btn('Entrer', go)]), err);
    setTimeout(() => input.focus(), 30);
  }

  return {
    async open() {
      root.classList.add('on');
      if (await isUnlocked()) build(); else showLock();
    },
    close() { root.classList.remove('on'); },
    get isOpen() { return root.classList.contains('on'); },
  };
}
