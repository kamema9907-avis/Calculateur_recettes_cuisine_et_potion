// ============================================================================
//  planner.js — solveur « quoi faire aujourd'hui pour gagner N silver »
//
//  Le tableau du calculateur classe par marge. C'est trompeur pour agir :
//  une marge de 60% sur un item qui s'échange à 6 unités/jour ne rapporte rien.
//  Ce solveur ajoute les trois contraintes qui manquent : la liquidité réelle
//  du marché (produit fini ET ingrédients), le capital, et la diversification.
// ============================================================================

import { methodsFor, craftCost, rrrFor, SPECIALTY } from './engine.js';

// Motifs de rejet, affichés tels quels dans l'encadré « écartées »
export const MOTIFS = {
  coutInconnu: 'coût inconnu (un ingrédient sans prix)',
  pasDePrix: 'aucun vendeur dans cette ville',
  prixPerime: 'prix trop ancien',
  pasHistorique: 'aucune transaction relevée',
  volumeFaible: 'volume quotidien insuffisant',
  nonRentable: 'non rentable au prix réellement transigé',
};

// ---------------------------------------------------------------------------
//  Remonte la liste des achats réels nécessaires pour produire `qteFinie`
//  unités du produit. Récursif : si un ingrédient est fabriqué plutôt
//  qu'acheté, on descend chercher SES ingrédients achetés.
//  Sert à deux choses : la liste de courses, et la borne de liquidité.
// ---------------------------------------------------------------------------
function collecterAchats(recetteId, qteFinie, ctx, acc = {}, seen = new Set()) {
  const r = ctx.byId[recetteId];
  if (!r || seen.has(recetteId)) return acc;
  const s2 = new Set(seen); s2.add(recetteId);
  const rrr = rrrFor(r.station, ctx);

  // La liste de courses doit nommer la variante sur laquelle le coût a été
  // calculé. Sans ce rappel à craftCost, elle enverrait acheter un gardon
  // rouge (première variante des morceaux de poisson) alors que le prix
  // retenu vient peut-être d'un crabe mantou, trente fois plus productif.
  const c = craftCost(recetteId, seen, ctx);
  const v = (c && c.variant) || r;
  const nbCrafts = qteFinie / v.quantity;

  for (const ing of v.ingredients) {
    const options = methodsFor(ing.id, s2, ctx);
    if (!options.length) continue;
    const choisi = options.reduce((a, b) => b.cost < a.cost ? b : a);
    const exclu = (v.excludeFromRRR || []).includes(ing.id);
    const besoin = ing.quantity * nbCrafts * (exclu ? 1 : (1 - rrr));

    if (choisi.method === 'craft') {
      collecterAchats(ing.id, besoin, ctx, acc, s2);
    } else {
      if (!acc[ing.id]) acc[ing.id] = { id: ing.id, qte: 0, ville: choisi.where, prixU: choisi.cost, methode: choisi.method };
      acc[ing.id].qte += besoin;
    }
  }
  return acc;
}

// ---------------------------------------------------------------------------
//  Prix auquel on accepte de valoriser une vente dans une ville donnée.
//
//  Le juge de paix : on ne valorise jamais au-dessus du prix réellement
//  transigé. `sell_price_min` est le prix DEMANDÉ le plus bas, qu'un joueur
//  isolé peut fixer à n'importe quoi ; relevé en production, un plat affiché
//  39 130 000 pour 88 852 réels. Un ordre isolé à 440× le prix réel ne vaut
//  pas 440×.
//
//  Extrait de construireLignes pour que l'onglet Poissons applique la même
//  prudence sans la réécrire : deux copies divergeraient au premier ajustement.
//  Retourne soit { motif, detail } quand la vente n'est pas valorisable, soit
//  le prix retenu et de quoi l'expliquer à l'écran.
// ---------------------------------------------------------------------------
export function prixVente(id, ville, ctx, volumes, opts = {}) {
  const { undercut = 0.03, volumeMin = 0, seuilAberrant = 1.3 } = opts;
  const p = (ctx.prices[id] || {})[ville];
  if (!p || !(p.sell > 0)) return { motif: MOTIFS.pasDePrix };
  if (ctx.maxAgeH != null && p.ageH > ctx.maxAgeH)
    return { motif: MOTIFS.prixPerime, detail: Math.round(p.ageH) + ' h' };
  const h = (volumes[id] || {})[ville];
  if (!h || !h.avgPrice) return { motif: MOTIFS.pasHistorique };
  if (h.vol < volumeMin) return { motif: MOTIFS.volumeFaible, detail: Math.round(h.vol) + '/jour' };
  const ratio = p.sell / h.avgPrice;
  return {
    prixAffiche: p.sell, prixReel: h.avgPrice,
    prixRetenu: Math.min(p.sell, h.avgPrice) * (1 - undercut),
    ratio, aberrant: ratio > seuilAberrant, vol: h.vol, ageH: p.ageH,
  };
}

// ---------------------------------------------------------------------------
//  Construit les lignes candidates : une par couple (recette, ville de vente).
//  `volumes` = { itemId: { ville: { vol, avgPrice } } }
// ---------------------------------------------------------------------------
export function construireLignes(ctx, volumes, opts) {
  const {
    villesVente, volumeMin = 50, seuilAberrant = 1.3,
    undercut = 0.03, taxe = 0.065,
    tiers = null, ench = null, stations = null,
  } = opts;

  const lignes = [], ecartees = [];
  const noter = (id, ville, motif, detail) => ecartees.push({ id, ville, motif, detail });

  for (const r of Object.values(ctx.byId)) {
    if (r.station !== 'cook' && r.station !== 'alchemist') continue;

    // Filtres de contenu : on écarte AVANT le calcul de coût (la décomposition
    // récursive est l'opération la plus lourde de cette boucle), et sans passer
    // par noter() — l'encadré « écartées » sert à expliquer les rejets d'une
    // opportunité viable, pas à lister ce que l'utilisateur a lui-même décoché.
    if (stations && !stations.includes(r.station)) continue;
    if (tiers && !tiers.includes(r.tier)) continue;
    if (ench && !ench.includes(r.enchantment || 0)) continue;

    const c = craftCost(r.id, new Set(), ctx);
    if (!c) { noter(r.id, null, MOTIFS.coutInconnu, null); continue; }

    for (const ville of villesVente) {
      const v = prixVente(r.id, ville, ctx, volumes, { undercut, volumeMin, seuilAberrant });
      if (v.motif) { noter(r.id, ville, v.motif, v.detail || null); continue; }

      const profitU = v.prixRetenu * (1 - taxe) - c.cost;
      if (profitU <= 0) {
        noter(r.id, ville, MOTIFS.nonRentable,
          v.aberrant ? 'prix affiché ' + v.ratio.toFixed(0) + '× le réel' : null);
        continue;
      }

      lignes.push({
        id: r.id, station: r.station, tier: r.tier, enchantment: r.enchantment,
        // Celle de la variante retenue par craftCost, pas celle de la recette :
        // l'encadré du plan en déduit le nombre de crafts à lancer.
        quantity: c.quantity != null ? c.quantity : r.quantity, villeVente: ville,
        coutU: c.cost, prixAffiche: v.prixAffiche, prixReel: v.prixReel, prixRetenu: v.prixRetenu,
        ratio: v.ratio, aberrant: v.aberrant,
        vol: v.vol, ageH: v.ageH,
        profitU, roi: profitU / c.cost,
      });
    }
  }
  return { lignes, ecartees };
}

// ---------------------------------------------------------------------------
//  Borne de liquidité côté ingrédients : combien d'unités de produit fini
//  peut-on soutenir sans rafler plus que `part` du marché quotidien d'un de
//  ses ingrédients ? L'API ne publie pas la profondeur du carnet d'ordres,
//  c'est le meilleur garde-fou disponible contre le glissement du prix d'achat.
// ---------------------------------------------------------------------------
function bornerParIngredients(ligne, ctx, volumes, part) {
  const achats = collecterAchats(ligne.id, 1, ctx, {}, new Set()); // pour 1 unité finie
  let borne = Infinity, limitant = null;
  for (const a of Object.values(achats)) {
    if (a.qte <= 0) continue;
    const h = (volumes[a.id] || {})[a.ville];
    if (!h || !(h.vol > 0)) continue;      // ingrédient sans historique : non contraint
    const maxUnites = (h.vol * part) / a.qte;
    if (maxUnites < borne) { borne = maxUnites; limitant = { id: a.id, ville: a.ville, vol: h.vol }; }
  }
  return { borne, limitant, achats };
}

// ---------------------------------------------------------------------------
//  Résolution gloutonne par ROI décroissant.
//  Le capital n'étant jamais saturant en pratique, un solveur linéaire exact
//  n'apporterait rien de mesurable et coûterait en lisibilité.
// ---------------------------------------------------------------------------
export function resoudre(lignes, ctx, volumes, opts) {
  const {
    capital = 20e6, objectif = 3e6, partVolume = 0.10, partMaxItem = 0.15,
  } = opts;
  const plafond = objectif * partMaxItem;

  const candidats = lignes.slice().sort((a, b) => b.roi - a.roi);
  let capRestant = capital, profitTotal = 0;
  const parItem = {}, retenues = [], bloquees = [];

  for (const l of candidats) {
    if (profitTotal >= objectif) break;
    const dejaItem = parItem[l.id] || 0;
    if (dejaItem >= plafond) { bloquees.push({ ...l, motif: 'plafond 15% atteint' }); continue; }

    const { borne, limitant, achats } = bornerParIngredients(l, ctx, volumes, partVolume);

    const qVolume = Math.floor(l.vol * partVolume);
    const qIngredients = Math.floor(borne);
    const qCapital = Math.floor(capRestant / l.coutU);
    // floor et non ceil : dépasser le plafond violerait la règle des 15%
    const qPlafond = Math.floor((plafond - dejaItem) / l.profitU);

    const q = Math.min(qVolume, qIngredients, qCapital, qPlafond);
    if (q < 1) {
      const cause = q === qIngredients ? 'liquidité des ingrédients'
        : q === qVolume ? 'volume du produit'
        : q === qCapital ? 'capital épuisé' : 'plafond 15%';
      bloquees.push({ ...l, motif: 'quantité nulle (' + cause + ')' });
      continue;
    }

    const prof = q * l.profitU, inv = q * l.coutU;
    parItem[l.id] = dejaItem + prof;
    capRestant -= inv;
    profitTotal += prof;

    // liste de courses pour cette ligne, à l'échelle de q
    const courses = Object.values(collecterAchats(l.id, q, ctx, {}, new Set()))
      .map(a => ({ ...a, qte: Math.ceil(a.qte), cout: a.qte * a.prixU }));

    retenues.push({
      ...l, q, profit: prof, investi: inv,
      partMarche: l.vol > 0 ? q / l.vol : null,
      brideePar: q === qIngredients && limitant ? limitant : null,
      courses,
    });
  }

  // Agrégations utiles à l'exécution en jeu
  const parVille = {}, achatsParVille = {};
  for (const r of retenues) {
    parVille[r.villeVente] = (parVille[r.villeVente] || 0) + r.profit;
    for (const a of r.courses) {
      const cle = a.ville + '|' + a.id;
      if (!achatsParVille[cle]) achatsParVille[cle] = { ville: a.ville, id: a.id, qte: 0, cout: 0, prixU: a.prixU };
      achatsParVille[cle].qte += a.qte;
      achatsParVille[cle].cout += a.cout;
    }
  }

  return {
    retenues, bloquees, parItem, parVille,
    achats: Object.values(achatsParVille).sort((a, b) => b.cout - a.cout),
    profitTotal,
    capitalUtilise: capital - capRestant,
    objectifAtteint: profitTotal >= objectif,
    nbItems: Object.keys(parItem).length,
    plafond,
  };
}

// Ville de fabrication conseillée : celle qui porte le bonus de spécialité.
export const villeCraftIdeale = station => SPECIALTY[station] || null;
