// ============================================================================
//  fish.js — que faire d'un poisson qu'on vient de pêcher ?
//
//  Trois débouchés, chiffrés en REVENU NET et non en marge : le poisson est
//  déjà dans le sac, son coût d'acquisition est nul. La question n'est pas
//  « est-ce rentable » mais « laquelle des trois sorties paie le mieux ».
//
//   1. le vendre tel quel ;
//   2. le découper au Boucher — de 1 morceau pour un gardon rouge T1 à 200
//      pour un requin, et AUCUN retour de ressources, le poisson y étant
//      explicitement exclu par les données du jeu ;
//   3. le cuisiner en son plat dédié — chaque poisson rare en a exactement un,
//      décliné en quatre niveaux d'enchantement, et là le retour de ressources
//      s'applique : un poisson sort 1,33 plat à Caerleon sans focus, 1,92 avec.
//      Il faut en revanche payer les autres ingrédients et la station.
//
//  Les 16 poissons communs n'ont pas de plat : pour eux la question est binaire.
// ============================================================================

import { rrrFor, fraisStation, unitCost, variantesDe } from './engine.js';
import { prixVente } from './planner.js';

const EST_POISSON = id => /^T[0-9]+_FISH_/.test(id);

// ---------------------------------------------------------------------------
//  Index poisson -> plats qui le consomment entier. Chaque poisson rare en a
//  un seul, en quatre niveaux d'enchantement ; on les garde tous et on retient
//  le plus rentable au moment du calcul.
// ---------------------------------------------------------------------------
export function platsParPoisson(byId) {
  const index = {};
  for (const r of Object.values(byId)) {
    if (r.station !== 'cook') continue;
    for (const ing of r.ingredients) {
      if (!EST_POISSON(ing.id)) continue;
      (index[ing.id] = index[ing.id] || []).push({ recette: r, qtePoisson: ing.quantity });
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
//  Les 41 poissons, lus dans les variantes de la recette de morceaux : c'est
//  la seule source du jeu qui donne le rendement de chacun.
// ---------------------------------------------------------------------------
export function poissonsConnus(byId) {
  const chops = byId['T1_FISHCHOPS'];
  if (!chops) return [];
  return variantesDe(chops)
    .filter(v => v.ingredients.length === 1 && EST_POISSON(v.ingredients[0].id))
    .map(v => ({ id: v.ingredients[0].id, morceaux: v.quantity / v.ingredients[0].quantity }));
}

// Décompose l'identifiant : T5_FISH_FRESHWATER_SWAMP_RARE -> tier 5, eau douce,
// marais, rare. Sert au tri et au regroupement de l'écran.
export function decrire(id) {
  const m = /^T([0-9]+)_FISH_(FRESHWATER|SALTWATER)_(.+?)_(COMMON|RARE|BOSS_SHARK)$/.exec(id);
  if (!m) return { tier: null, eau: null, biome: null, rarete: null };
  const BIOMES = {
    ALL: 'Partout', FOREST: 'Forêt', STEPPE: 'Steppe', MOUNTAIN: 'Montagne',
    HIGHLANDS: 'Hautes terres', SWAMP: 'Marais', AVALON: 'Avalon',
    DRAGON_AREA: 'Terres du dragon',
  };
  return {
    tier: Number(m[1]),
    eau: m[2] === 'FRESHWATER' ? 'Eau douce' : 'Mer',
    biome: BIOMES[m[3]] || m[3],
    rarete: m[4] === 'COMMON' ? 'Commun' : m[4] === 'RARE' ? 'Rare' : 'Boss',
  };
}

// Jours nécessaires pour écouler `qte` unités sans dépasser `part` du volume
// quotidien du marché. null quand le volume est inconnu.
function joursPourEcouler(qte, vol, part) {
  if (!(vol > 0) || !(part > 0)) return null;
  return qte / (vol * part);
}

// ---------------------------------------------------------------------------
//  Le cœur : une ligne par poisson.
//
//  ctx.villeRef est la ville de référence. Elle sert À LA FOIS de lieu de vente
//  et de station de craft, donc elle décide aussi du retour de ressources : à
//  Martlock on n'a pas les 15 % du Cuisinier qu'offre Caerleon. L'appelant doit
//  donc aussi poser ctx.craftCity = ctx.villeRef.
//
//  `quantite` est le nombre de poissons pêchés : il met à l'échelle les
//  montants et les délais d'écoulement, sans changer le classement.
// ---------------------------------------------------------------------------
// Le Plan alerte dès que le prix affiché dépasse 1,3 fois le prix transigé,
// parce qu'il doit écarter des lignes. Ici on n'écarte rien, on explique : le
// prix retenu est déjà corrigé quoi qu'il arrive. Or les morceaux de poisson
// s'échangent à plus de 200 000 unités par jour, et 1,4 fois la moyenne
// pondérée sur sept jours y est banal. Avec 1,3, le pictogramme s'allumerait
// sur toutes les lignes et ne voudrait plus rien dire ; à 2 il signale un
// vrai décrochage.
const SEUIL_ALERTE = 2;

export function analyser(ctx, volumes, opts) {
  const { taxe = 0.065, undercut = 0.03, partVolume = 0.10, quantite = 1 } = opts;
  const net = px => px * (1 - taxe);
  const index = platsParPoisson(ctx.byId);
  const rrr = rrrFor('cook', ctx);

  // Les morceaux sont un objet unique quel que soit le poisson d'origine :
  // un seul prix de marché pour les 41 lignes.
  const vChops = prixVente('T1_FISHCHOPS', ctx.villeRef, ctx, volumes, { undercut, seuilAberrant: SEUIL_ALERTE });

  const lignes = [];
  for (const p of poissonsConnus(ctx.byId)) {
    const d = decrire(p.id);

    // --- 1. vendre le poisson tel quel -------------------------------------
    const vBrut = prixVente(p.id, ctx.villeRef, ctx, volumes, { undercut, seuilAberrant: SEUIL_ALERTE });
    const brut = vBrut.motif ? { motif: vBrut.motif, detail: vBrut.detail } : {
      ...vBrut,
      revenu: net(vBrut.prixRetenu) * quantite,
      jours: joursPourEcouler(quantite, vBrut.vol, partVolume),
    };

    // --- 2. le découper en morceaux ----------------------------------------
    // Aucun retour de ressources : les données du jeu excluent explicitement
    // le poisson chez le Boucher. N morceaux, ni plus ni moins.
    const nbMorceaux = p.morceaux * quantite;
    const morceaux = vChops.motif ? { motif: vChops.motif, detail: vChops.detail } : {
      ...vChops,
      n: p.morceaux,
      revenu: net(vChops.prixRetenu) * nbMorceaux,
      jours: joursPourEcouler(nbMorceaux, vChops.vol, partVolume),
    };

    // --- 3. le cuisiner en son plat dédié ----------------------------------
    let plat = null;
    for (const { recette: r, qtePoisson } of (index[p.id] || [])) {
      const v = prixVente(r.id, ctx.villeRef, ctx, volumes, { undercut, seuilAberrant: SEUIL_ALERTE });
      if (v.motif) { if (!plat) plat = { motif: v.motif, detail: v.detail, id: r.id }; continue; }

      // Le poisson EST rendu chez le Cuisinier, contrairement au Boucher : un
      // craft n'en consomme réellement que qtePoisson x (1 - retour).
      const exclu = (r.excludeFromRRR || []).includes(p.id);
      const consoNette = qtePoisson * (exclu ? 1 : (1 - rrr));
      if (!(consoNette > 0)) continue;          // retour >= 100 % : cas théorique
      const crafts = quantite / consoNette;
      const produits = crafts * r.quantity;

      // Les autres ingrédients restent à notre charge, eux.
      let autres = 0, chiffrable = true;
      for (const ing of r.ingredients) {
        if (ing.id === p.id) continue;
        const c = unitCost(ing.id, new Set([r.id]), ctx);
        if (c == null) { chiffrable = false; break; }
        const ex = (r.excludeFromRRR || []).includes(ing.id);
        autres += c.cost * ing.quantity * (ex ? 1 : (1 - rrr));
      }
      if (!chiffrable) {
        if (!plat) plat = { motif: 'un ingrédient sans prix', id: r.id };
        continue;
      }

      const frais = fraisStation(r, ctx) * crafts;
      const cand = {
        ...v, id: r.id, enchantment: r.enchantment,
        produits, crafts,
        revenuBrut: net(v.prixRetenu) * produits,
        coutAutres: autres * crafts,
        frais,
        revenu: net(v.prixRetenu) * produits - autres * crafts - frais,
        jours: joursPourEcouler(produits, v.vol, partVolume),
      };
      // On garde le niveau d'enchantement le plus rentable des quatre.
      if (plat == null || plat.motif || cand.revenu > plat.revenu) plat = cand;
    }

    // --- le meilleur des trois ---------------------------------------------
    // Un débouché sans prix n'est pas un débouché perdant, c'est un débouché
    // inconnu. Désigner un gagnant quand une seule colonne est chiffrable
    // ferait croire à un arbitrage là où il n'y a qu'un trou de données : à
    // Caerleon, 8 poissons sur 41 seulement sont cotés.
    const chiffrables = Object.entries({ brut, morceaux, plat })
      .filter(([, o]) => o && !o.motif && o.revenu != null);
    let meilleur = null, meilleurRevenu = -Infinity;
    for (const [cle, o] of chiffrables) {
      if (o.revenu > meilleurRevenu) { meilleurRevenu = o.revenu; meilleur = cle; }
    }

    // Écart au deuxième débouché : dit si le choix se joue à presque rien,
    // auquel cas la liquidité ou le temps passé tranchent mieux que le silver.
    const nets = chiffrables.map(([, o]) => o.revenu).sort((a, b) => b - a);
    const ecart = nets.length > 1 && nets[1] > 0 ? (nets[0] - nets[1]) / nets[1] * 100 : null;

    lignes.push({
      id: p.id, morceauxParPoisson: p.morceaux, ...d, brut, morceaux, plat,
      meilleur, ecart,
      nbChiffrables: chiffrables.length,
      // Vrai quand le « meilleur » n'est en fait comparé à rien.
      seule: chiffrables.length === 1,
    });
  }
  return {
    lignes, rrr,
    couverture: {
      total: lignes.length,
      comparables: lignes.filter(l => l.nbChiffrables >= 2).length,
      aucune: lignes.filter(l => l.nbChiffrables === 0).length,
    },
  };
}

// ---------------------------------------------------------------------------
//  Combien de poissons sont réellement cotés dans chaque ville ?
//
//  Le marché du poisson est très inégal d'une ville à l'autre : relevé le
//  2026-09-20, 37 poissons cotés à Lymhurst et 36 à Martlock, contre 8 à
//  Caerleon. Sans ce repère, un tableau presque vide passerait pour une panne
//  alors que c'est la ville choisie qui n'a pas de marché du poisson.
// ---------------------------------------------------------------------------
export function couvertureParVille(ctx, volumes, villes) {
  const poissons = poissonsConnus(ctx.byId);
  return villes
    .map(ville => ({
      ville,
      n: poissons.filter(p => !prixVente(p.id, ville, ctx, volumes, {}).motif).length,
      total: poissons.length,
    }))
    .sort((a, b) => b.n - a.n);
}

// Les identifiants dont l'onglet a besoin côté prix et historique : les 41
// poissons, les morceaux, les plats dédiés et les autres ingrédients de ces
// plats. Bien plus court que les 526 identifiants du Calculateur.
export function identifiantsUtiles(byId) {
  const set = new Set(['T1_FISHCHOPS']);
  const index = platsParPoisson(byId);
  for (const p of poissonsConnus(byId)) {
    set.add(p.id);
    for (const { recette } of (index[p.id] || [])) {
      set.add(recette.id);
      for (const ing of recette.ingredients) set.add(ing.id);
    }
  }
  return [...set];
}
