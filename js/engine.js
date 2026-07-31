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

export const ivTier = t => Math.max(0, Math.pow(2, t) - 2);

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
  return { method: 'grow', cost, where: netSeeds <= 0 ? 'cultivé focus ~gratuit' : seed.where };
}

// Coût d'une unité fabriquée, récursivement sur les sous-ingrédients.
// `seen` coupe les cycles de recettes.
export function craftCost(id, seen, ctx) {
  const r = ctx.byId[id];
  if (!r || seen.has(id)) return null;
  const s2 = new Set(seen); s2.add(id);
  const rrr = rrrFor(r.station, ctx);
  let mat = 0, iv = 0;
  for (const ing of r.ingredients) {
    const c = unitCost(ing.id, s2, ctx);
    if (c == null) return null;   // un ingrédient sans prix => coût inconnu
    const excluded = (r.excludeFromRRR || []).includes(ing.id);
    mat += c.cost * ing.quantity * (excluded ? 1 : (1 - rrr));
    iv += ivTier(ing.tier) * ing.quantity;
  }
  const fee = r.tier > 2 ? iv * 0.1125 * (ctx.stationFee / 100) : 0;
  return { method: 'craft', cost: (mat + fee) / r.quantity, perCraft: mat + fee, fee, rrr };
}

export function methodsFor(id, seen, ctx) {
  const opts = [];
  const b = bestBuy(id, ctx);
  if (b) opts.push({ method: 'buy', cost: b.price, where: b.city });
  const g = growCost(id, ctx);
  if (g) opts.push(g);                       // porte déjà son propre `where`
  const c = craftCost(id, seen, ctx);
  if (c) opts.push({ method: 'craft', cost: c.cost, where: null });
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
  let mat = 0, iv = 0, costable = true;
  const breakdown = r.ingredients.map(ing => {
    const options = methodsFor(ing.id, new Set([r.id]), ctx);
    const cheapest = options.length ? options.reduce((a, b) => b.cost < a.cost ? b : a) : null;
    const ov = methodOverride[r.id + '|' + ing.id];
    const forced = ov ? options.find(o => o.method === ov) : null;
    const chosenOpt = forced || cheapest;
    const excluded = (r.excludeFromRRR || []).includes(ing.id);
    if (chosenOpt == null) costable = false;
    else mat += chosenOpt.cost * ing.quantity * (excluded ? 1 : (1 - rrr));
    iv += ivTier(ing.tier) * ing.quantity;
    return {
      id: ing.id, qty: ing.quantity, excluded,
      options: options.map(o => ({ method: o.method, cost: o.cost, where: o.where })),
      chosen: chosenOpt ? chosenOpt.method : null,
      chosenCost: chosenOpt ? chosenOpt.cost : null,
      chosenWhere: chosenOpt ? chosenOpt.where : null,
      overridden: !!forced,
    };
  });
  const fee = r.tier > 2 ? iv * 0.1125 * (ctx.stationFee / 100) : 0;
  const craftPerCraft = costable ? mat + fee : null;
  return {
    breakdown, rrr, stationFee: fee,
    craftCost: craftPerCraft,
    cost: craftPerCraft != null ? craftPerCraft / r.quantity : null,
  };
}
