// ============================================================================
//  market.js — accès aux données de marché (albion-online-data) + cache local
//
//  Deux sources distinctes, qui ne disent PAS la même chose :
//   • /stats/prices  → le carnet d'ordres actuel. sell_price_min est le prix
//     DEMANDÉ le plus bas. Un seul joueur peut y poster n'importe quoi.
//   • /stats/history → les transactions réellement conclues. avg_price est le
//     prix auquel ça s'est VENDU, item_count le volume échangé.
//
//  Confronter les deux est ce qui permet d'écarter les ordres aberrants
//  (relevé en production : un plat affiché 39 130 000 pour 88 852 réels).
// ============================================================================

const BASE = 'https://europe.albion-online-data.com/api/v2/stats';
const TTL_PRIX = 30 * 60 * 1000;        // 30 min
const TTL_VOLUMES = 6 * 60 * 60 * 1000; // 6 h : les volumes bougent lentement

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Exécute les tâches par paquets de `n` pour aller vite sans saturer l'API
// (albion-online-data tolère 180 requêtes/minute, on reste très en dessous).
async function enParallele(taches, n, onProgress) {
  const out = [];
  let faites = 0;
  for (let i = 0; i < taches.length; i += n) {
    const lot = taches.slice(i, i + n);
    const res = await Promise.all(lot.map(t => t()));
    out.push(...res);
    faites += lot.length;
    if (onProgress) onProgress(faites, taches.length);
    if (i + n < taches.length) await sleep(200);
  }
  return out;
}

async function getJSON(url) {
  for (let essai = 0; essai < 3; essai++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      if (res.status === 429) { await sleep(2000 * (essai + 1)); continue; }
      throw new Error('HTTP ' + res.status);
    } catch (e) {
      if (essai === 2) throw e;
      await sleep(1000 * (essai + 1));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
//  Cache localStorage
// ---------------------------------------------------------------------------
function lire(cle, ttl, signature) {
  try {
    const brut = localStorage.getItem(cle);
    if (!brut) return null;
    const o = JSON.parse(brut);
    if (o.signature !== signature) return null;   // villes changées : invalide
    if (Date.now() - o.t > ttl) return null;
    return o.data;
  } catch { return null; }
}
function ecrire(cle, signature, data) {
  try {
    localStorage.setItem(cle, JSON.stringify({ t: Date.now(), signature, data }));
  } catch { /* quota dépassé : on se passe de cache, ce n'est pas bloquant */ }
}
export function viderCache() {
  try { localStorage.removeItem('albion.prix'); localStorage.removeItem('albion.volumes'); } catch {}
}
export function ageCache(cle) {
  try {
    const o = JSON.parse(localStorage.getItem(cle === 'prix' ? 'albion.prix' : 'albion.volumes'));
    return o ? Date.now() - o.t : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
//  Prix du carnet d'ordres
//  Retourne { itemId: { ville: { sell, buy, ageH } } }
//  `ageH` = ancienneté du relevé en heures, indispensable pour écarter les
//  prix périmés (le calculateur v2 jetait cette information).
// ---------------------------------------------------------------------------
export async function chargerPrix(ids, villes, { onProgress, forcer } = {}) {
  const signature = villes.join(',') + '|' + ids.length;
  if (!forcer) {
    const cache = lire('albion.prix', TTL_PRIX, signature);
    if (cache) return { data: cache, depuisCache: true };
  }
  const loc = encodeURIComponent(villes.join(','));
  const lots = [];
  for (let i = 0; i < ids.length; i += 100) lots.push(ids.slice(i, i + 100));

  const maintenant = Date.now();
  const out = {};
  const reponses = await enParallele(
    lots.map(lot => () => getJSON(`${BASE}/prices/${lot.join(',')}?locations=${loc}&qualities=1`)),
    3, onProgress);

  for (const arr of reponses) {
    for (const row of arr || []) {
      const dt = row.sell_price_min_date;
      const ageH = (!dt || dt[0] === '0') ? Infinity : (maintenant - new Date(dt + 'Z').getTime()) / 3600e3;
      const e = { sell: row.sell_price_min || 0, buy: row.buy_price_max || 0, ageH };
      if (!out[row.item_id]) out[row.item_id] = {};
      const cur = out[row.item_id][row.city];
      // garde le plus bas si plusieurs entrées remontent pour la même ville
      if (cur == null || (e.sell > 0 && e.sell < cur.sell)) out[row.item_id][row.city] = e;
    }
  }
  ecrire('albion.prix', signature, out);
  return { data: out, depuisCache: false };
}

// ---------------------------------------------------------------------------
//  Historique des transactions
//  Retourne { itemId: { ville: { vol, avgPrice } } }
//   • vol      = volume moyen par jour sur les 7 derniers jours
//   • avgPrice = prix moyen PONDÉRÉ PAR LE VOLUME sur ces 7 jours.
//     La pondération compte : une journée à 3 ventes ne doit pas peser autant
//     qu'une journée à 3000 dans la moyenne.
// ---------------------------------------------------------------------------
export async function chargerVolumes(ids, villes, { onProgress, forcer, jours = 7 } = {}) {
  const signature = villes.join(',') + '|' + ids.length + '|' + jours;
  if (!forcer) {
    const cache = lire('albion.volumes', TTL_VOLUMES, signature);
    if (cache) return { data: cache, depuisCache: true };
  }
  const loc = encodeURIComponent(villes.join(','));
  const lots = [];
  // 20 items par requête : au-delà, l'API renvoie des réponses très lourdes
  for (let i = 0; i < ids.length; i += 20) lots.push(ids.slice(i, i + 20));

  const out = {};
  const reponses = await enParallele(
    lots.map(lot => () => getJSON(`${BASE}/history/${lot.join(',')}?locations=${loc}&time-scale=24&qualities=1`)),
    3, onProgress);

  for (const arr of reponses) {
    for (const serie of arr || []) {
      const pts = (serie.data || []).slice(-jours);
      if (!pts.length) continue;
      const volTotal = pts.reduce((a, p) => a + p.item_count, 0);
      if (volTotal <= 0) continue;
      const avgPondere = pts.reduce((a, p) => a + p.avg_price * p.item_count, 0) / volTotal;
      if (!out[serie.item_id]) out[serie.item_id] = {};
      out[serie.item_id][serie.location] = {
        vol: volTotal / pts.length,
        avgPrice: avgPondere,
      };
    }
  }
  ecrire('albion.volumes', signature, out);
  return { data: out, depuisCache: false };
}
