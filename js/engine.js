// ============================================================================
//  engine.js — moteur de coût
//  Extrait tel quel de index.html (v2) : la logique de calcul n'a pas changé,
//  seules les dépendances passent désormais par un contexte explicite `ctx`
//  au lieu d'être lues dans la portée du composant Vue.
// ============================================================================

export const CITIES = ['Caerleon', 'Bridgewatch', 'Lymhurst', 'Martlock', 'Fort Sterling', 'Thetford', 'Brecilien'];

// Ville donnant le +15% de retour de ressources par catégorie
export const SPECIALTY = { cook: 'Caerleon', alchemist: 'Brecilien' };

// Prix du Marchand fermier (PNJ des îles) — graines, identique pour tous les
// types d'un même tier. Valeurs relevées en jeu (sujettes au Global Discount).
export const NPC_SEED = { 1: 2312, 2: 3468, 3: 5780, 4: 8670, 5: 11560, 6: 17340, 7: 26010, 8: 34680 };

export const RENDER = id => `https://render.albiononline.com/v1/item/${id}.png?quality=1`;

// ---------------------------------------------------------------------------
//  Étiquettes de contenu
//
//  Elles répondent à « que dois-je aller chercher pour fabriquer ça ». Elles
//  décrivent donc le chemin RÉELLEMENT retenu par le moteur, choix forcés à la
//  main compris, et non la recette sur le papier : si la sauce de poisson est
//  moins chère à l'achat qu'à la fabrication, la recette qui en consomme garde
//  l'étiquette « sauce » mais perd « poisson », « morceaux » et « algues », que
//  l'on n'a plus besoin de se procurer.
//
//  Stockées en masque de bits plutôt qu'en Set : elles remontent le long de
//  chaque arbre de recette, à chaque recalcul, pour 423 recettes. Un entier
//  n'alloue rien et se teste d'un ET binaire.
// ---------------------------------------------------------------------------
export const ETIQUETTES = [
  { cle: 'poisson',  icone: '🐟', label: 'Poisson entier',      test: id => /^T[0-9]+_FISH_/.test(id) },
  { cle: 'sauce',    icone: '🫙', label: 'Sauce de poisson',    test: id => /FISHSAUCE/.test(id) },
  { cle: 'morceaux', icone: '🥩', label: 'Morceaux de poisson', test: id => /FISHCHOPS/.test(id) },
  { cle: 'viande',   icone: '🥓', label: "Viande d'élevage",    test: id => /^T[0-9]+_MEAT$/.test(id) },
  { cle: 'extrait',  icone: '🧪', label: 'Extrait arcanique',   test: id => /EXTRACT/.test(id) },
  // Le motif est ancré : /SEAWEED/ tout court attraperait aussi la salade
  // d'algues, qui est un plat et non un ingrédient.
  { cle: 'algues',   icone: '🌊', label: 'Algues',              test: id => /^T[0-9]+_SEAWEED$/.test(id) },
  { cle: 'token',    icone: '🪙', label: "Token d'Avalon",      test: id => /TOKEN/.test(id) },
  // Posée par la méthode choisie (culture) et non par un identifiant.
  { cle: 'ferme',    icone: '🌱', label: 'Passe par la ferme',  test: null },
];

export const BIT = {};
ETIQUETTES.forEach((e, i) => BIT[e.cle] = 1 << i);

const cacheBits = new Map();

// Étiquettes portées par un identifiant lui-même, hors de tout contexte.
export function bitsDe(id) {
  let b = cacheBits.get(id);
  if (b === undefined) {
    b = 0;
    for (const e of ETIQUETTES) if (e.test && e.test(id)) b |= BIT[e.cle];
    cacheBits.set(id, b);
  }
  return b;
}

// Les clés des étiquettes présentes dans un masque, dans l'ordre d'affichage.
export function clesDe(bits) {
  return ETIQUETTES.filter(e => bits & BIT[e.cle]).map(e => e.cle);
}

// ---------------------------------------------------------------------------
//  Le contexte attendu par toutes les fonctions ci-dessous :
//
//  ctx = {
//    byId,             // { itemId: recette }
//    farm,             // data.farm
//    prices,           // { itemId: { ville: { sell, buy, ageH } } }
//    manual,           // { itemId: prix forcé à la main }
//    villesAchat,      // string[]  villes où l'on accepte d'acheter
//    craftCity,        // 'auto' | nom de ville | 'none'
//    eventBonus,       // 0 | 10 | 20
//    stationFee,       // silver / 100 nutrition
//    focus, premium,   // booléens
//    seedSource,       // 'cheapest' | 'npc' | 'market'
//    npcDiscount,      // % du prix PNJ
//    autoriserCulture, // false => la branche « cultiver » est ignorée
//    maxAgeH,          // null = pas de filtre, sinon âge max du prix en heures
//  }
// ---------------------------------------------------------------------------

// Meilleur prix d'achat parmi les villes retenues.
// Un prix plus vieux que `maxAgeH` est considéré comme non fiable et écarté.
export function bestBuy(id, ctx) {
  if (ctx.manual[id] != null) return { price: ctx.manual[id], city: 'manuel' };
  const pd = ctx.prices[id];
  if (!pd) return null;
  let best = null;
  for (const c of ctx.villesAchat) {
    const e = pd[c];
    if (!e || !(e.sell > 0)) continue;
    if (ctx.maxAgeH != null && e.ageH > ctx.maxAgeH) continue;
    if (!best || e.sell < best.price) best = { price: e.sell, city: c };
  }
  return best;
}

// RRR = 1 − 1/(1 + bonus/100).
// bonus = 18 (base) + 15 (spécialité ville) + 59 (focus) + 0/10/20 (événement)
export function rrrFor(station, ctx) {
  let bonus = 18 + ctx.eventBonus + (ctx.focus ? 59 : 0);
  const spec = SPECIALTY[station];
  if (spec && (ctx.craftCity === 'auto' || ctx.craftCity === spec)) bonus += 15;
  return 1 - 1 / (1 + bonus / 100);
}

// Frais d'utilisation de la station.
//
// La nutrition consommee est fournie par le jeu, recette par recette
// (champ `nutrition` de data/recipes-data.json). Elle remplace une estimation
// maison qui la deduisait du tier des ingredients : celle-ci se trompait d'un
// facteur 8 a 216 selon la recette, et ne pouvait pas distinguer les 9 valeurs
// de nutrition que prennent les seules recettes T4.
//
// Le facteur de calibration absorbe l'incertitude sur l'unite du champ, qui ne
// peut se trancher qu'en relevant le cout reel en jeu. Les recettes T1 et T2 ont
// une nutrition nulle, ce qui reproduit d'office l'ancienne regle « tier > 2 ».
//
// Prend une VARIANTE et non une recette : la nutrition est portee par la facon
// de fabriquer. Pour les objets a variante unique, variantesDe() renvoie la
// recette elle-meme et les deux reviennent au meme.
export function fraisStation(v, ctx) {
  return (v.nutrition || 0) * (ctx.stationFee / 100) * (ctx.facteurNutrition ?? 1);
}

function npcSeedPrice(tier, ctx) {
  return NPC_SEED[tier] != null ? NPC_SEED[tier] * (ctx.npcDiscount / 100) : null;
}

// Coût d'une unité obtenue par culture.
// Attention : ce chemin suppose un cycle de croissance de ~22 h et des parcelles
// disponibles. L'onglet Plan le désactive via ctx.autoriserCulture = false.
export function growCost(id, ctx) {
  if (!ctx.autoriserCulture) return null;
  const f = ctx.farm[id];
  if (!f || !f.seedId) return null;
  const cand = [];
  if (ctx.seedSource !== 'market') {
    const npc = npcSeedPrice(f.tier, ctx);
    if (npc != null) cand.push({ price: npc, where: 'graine PNJ' });
  }
  if (ctx.seedSource !== 'npc') {
    const m = bestBuy(f.seedId, ctx);
    if (m) cand.push({ price: m.price, where: 'graine marché ' + m.city });
  }
  if (!cand.length) return null;
  const seed = cand.reduce((a, b) => b.price < a.price ? b : a);
  // Rendement : ~9 récoltes/graine en premium, ~4,5 sans premium.
  const cropYield = ctx.premium ? f.yield : f.yield / 2;
  // Arrosée au focus, le retour de graine dépasse souvent 100% -> graine nette ≈ 0.
  const seedReturn = (f.seedReturn || 0) + (ctx.focus ? (f.nurtureBonus || 0) : 0);
  const netSeeds = Math.max(0, 1 - seedReturn);
  const cost = seed.price * netSeeds / cropYield;
  return { method: 'grow', cost, where: netSeeds <= 0 ? 'cultivé focus ~gratuit' : seed.where, tags: BIT.ferme };
}

// Les façons de fabriquer un objet. La quasi-totalité n'en a qu'une, et le
// champ `variants` n'existe que pour les deux qui en ont plusieurs : les
// morceaux de poisson (41 poissons possibles, de 1 morceau pour un gardon
// rouge T1 à 200 pour un requin) et les restes d'animaux rares (5, 10 ou 25
// selon le tier de la dépouille). Une variante porte sa PROPRE quantité
// produite, sa propre nutrition et ses propres exclusions : c'est elle qu'il
// faut lire, et non la recette, partout où ces trois champs interviennent.
export function variantesDe(r) {
  return r.variants || [r];
}

// Coût d'une unité fabriquée, récursivement sur les sous-ingrédients.
// `seen` coupe les cycles de recettes. Quand plusieurs variantes existent on
// retient la moins chère : faire ses morceaux avec un crabe mantou (30 d'un
// coup) n'a rien à voir avec les faire avec un gardon rouge (1 seul).
export function craftCost(id, seen, ctx) {
  const r = ctx.byId[id];
  if (!r || seen.has(id)) return null;
  const s2 = new Set(seen); s2.add(id);
  const rrr = rrrFor(r.station, ctx);
  let best = null;
  for (const v of variantesDe(r)) {
    let mat = 0, costable = true, tags = 0;
    for (const ing of v.ingredients) {
      const c = unitCost(ing.id, s2, ctx);
      if (c == null) { costable = false; break; }   // ingrédient sans prix
      const excluded = (v.excludeFromRRR || []).includes(ing.id);
      mat += c.cost * ing.quantity * (excluded ? 1 : (1 - rrr));
      // L'ingrédient porte toujours sa propre étiquette, quelle que soit la
      // façon de l'obtenir ; celles de SON arbre ne remontent que si on le
      // fabrique, puisque l'acheter dispense d'aller chercher ses composants.
      tags |= bitsDe(ing.id) | (c.tags || 0);
    }
    if (!costable) continue;                        // variante inchiffrable
    const fee = fraisStation(v, ctx);
    const cost = (mat + fee) / v.quantity;
    if (best == null || cost < best.cost) {
      best = { method: 'craft', cost, perCraft: mat + fee, fee, rrr, variant: v, quantity: v.quantity, tags };
    }
  }
  return best;   // null si aucune variante n'est chiffrable
}

export function methodsFor(id, seen, ctx) {
  const opts = [];
  const b = bestBuy(id, ctx);
  if (b) opts.push({ method: 'buy', cost: b.price, where: b.city });
  const g = growCost(id, ctx);
  if (g) opts.push(g);                       // porte déjà son propre `where`
  const c = craftCost(id, seen, ctx);
  if (c) opts.push({ method: 'craft', cost: c.cost, where: null, tags: c.tags });
  return opts;
}

// Coût pour obtenir 1 unité de `id` : le moins cher entre acheter / cultiver / fabriquer.
export function unitCost(id, seen, ctx) {
  const opts = methodsFor(id, seen, ctx);
  if (!opts.length) return null;
  return opts.reduce((a, b) => b.cost < a.cost ? b : a);
}

// ---------------------------------------------------------------------------
//  Décomposition complète d'une recette : utilisée par l'onglet Calculateur
//  (avec les choix forcés) et par l'onglet Plan (sans).
// ---------------------------------------------------------------------------
export function decomposer(r, ctx, methodOverride = {}) {
  const rrr = rrrFor(r.station, ctx);

  // Une variante à la fois, on garde la moins chère. `quantity` et `variant`
  // sont remontés parce que l'appelant ne peut plus se fier à r.quantity : la
  // variante retenue pour les morceaux de poisson en produit de 1 à 200.
  const evaluer = v => {
    let mat = 0, costable = true, tags = 0;
    const breakdown = v.ingredients.map(ing => {
      const options = methodsFor(ing.id, new Set([r.id]), ctx);
      const cheapest = options.length ? options.reduce((a, b) => b.cost < a.cost ? b : a) : null;
      const ov = methodOverride[r.id + '|' + ing.id];
      const forced = ov ? options.find(o => o.method === ov) : null;
      const chosenOpt = forced || cheapest;
      const excluded = (v.excludeFromRRR || []).includes(ing.id);
      if (chosenOpt == null) costable = false;
      else {
        mat += chosenOpt.cost * ing.quantity * (excluded ? 1 : (1 - rrr));
        // Suit le choix forcé quand il y en a un : décocher une étiquette doit
        // écarter la recette d'après le chemin que l'utilisateur a imposé.
        tags |= bitsDe(ing.id) | (chosenOpt.tags || 0);
      }
      return {
        id: ing.id, qty: ing.quantity, excluded,
        options: options.map(o => ({ method: o.method, cost: o.cost, where: o.where })),
        chosen: chosenOpt ? chosenOpt.method : null,
        chosenCost: chosenOpt ? chosenOpt.cost : null,
        chosenWhere: chosenOpt ? chosenOpt.where : null,
        overridden: !!forced,
      };
    });
    const fee = fraisStation(v, ctx);
    const craftPerCraft = costable ? mat + fee : null;
    return {
      breakdown, rrr, stationFee: fee,
      craftCost: craftPerCraft,
      cost: craftPerCraft != null ? craftPerCraft / v.quantity : null,
      quantity: v.quantity, variant: v, tags,
    };
  };

  const variantes = variantesDe(r);
  // Repli sur la première : si aucune n'est chiffrable, l'interface a quand
  // même besoin d'un détail à afficher pour permettre la saisie manuelle.
  let best = evaluer(variantes[0]);
  for (let i = 1; i < variantes.length; i++) {
    const cand = evaluer(variantes[i]);
    if (cand.cost == null) continue;
    if (best.cost == null || cand.cost < best.cost) best = cand;
  }
  return best;
}
