// Classement en ligne via l'API REST de Supabase (aucun SDK requis).
// Sans configuration (config.js), le classement reste local au navigateur.
const CFG = window.GAME_CONFIG || {};
const url = String(CFG.SUPABASE_URL || '').replace(/\/+$/, '');
const key = String(CFG.SUPABASE_ANON_KEY || '');
export const ONLINE = !!(url && key && !/VOTRE|YOUR/i.test(url + key));

const headers = () => ({ apikey: key, Authorization: 'Bearer ' + key });
const LS = 'eolia_scores_v1';
const readLocal = () => { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch { return []; } };

export async function fetchTop(n = 10) {
  if (!ONLINE) return readLocal().sort((a, b) => b.score - a.score).slice(0, n);
  const r = await fetch(`${url}/rest/v1/scores?select=name,score,towers,shrines,lumis&order=score.desc&limit=${n}`, { headers: headers() });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

export async function submitScore(row) {
  const clean = {
    name: String(row.name || 'Voyageur').slice(0, 16),
    score: Math.max(0, Math.min(1000000, Math.round(row.score))),
    towers: row.towers | 0, shrines: row.shrines | 0, lumis: row.lumis | 0,
  };
  if (!ONLINE) {
    const l = readLocal().filter((x) => x.name !== clean.name);
    l.push(clean);
    try { localStorage.setItem(LS, JSON.stringify(l.sort((a, b) => b.score - a.score).slice(0, 50))); } catch {}
    return;
  }
  const r = await fetch(`${url}/rest/v1/scores`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(clean),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
}
