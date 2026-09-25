/*
 * build-data.js
 * -----------------------------------------------------------------------------
 * Genere le fichier de donnees REDUIT consomme par index.html.
 *
 * Source : ../../donnees/base
 *          (dumps officiels du jeu, ao-data/ao-bin-dumps)
 * Sortie : data/recipes-data.json (quelques centaines de Ko)
 *
 * MIGRATION DU 2026-09-20
 *   Ce script lisait data/ de la librairie, issu de Jaccak/AlbionRecipes, une
 *   source morte depuis novembre 2024. Il lit desormais base/, extrait des
 *   fichiers du jeu. Trois consequences :
 *
 *   1. normaliserId() a disparu. Elle corrigeait les identifiants d'extraits
 *      arcaniques que Jaccak suffixait a tort (T1_ALCHEMY_EXTRACT_LEVEL1@1,
 *      inexistant sur le marche). Les identifiants de base/ sont deja propres.
 *   2. excludeFromRRR n'est plus recopie d'une liste, il est deduit du drapeau
 *      exclusDuRetour que la librairie pose ingredient par ingredient. Elle y
 *      corrige deux erreurs de Jaccak sur les montures.
 *   3. yield des cultures se calcule au lieu d'etre lu : base/ferme.json donne
 *      la fourchette brute du jeu (3 a 6), le premium la double.
 *
 *   Le FORMAT DE SORTIE est inchange : app.js, engine.js et planner.js n'ont
 *   pas ete touches.
 *
 * Contenu de la sortie :
 *   - recipes   : toutes les recettes "cook" + "alchemist" PLUS la fermeture
 *                 des sous-recettes craftables (boucher, intermediaires) dont
 *                 elles dependent (pour le calcul recursif acheter-vs-fabriquer).
 *   - farm      : cultures (graine -> produit, rendement, bonus de nurture)
 *                 limitees a celles reellement utilisees par nos recettes.
 *   - names     : noms FR + EN de chaque item reference (item, ingredient, graine).
 *   - economy   : taux de taxes / serveur (depuis meta.json).
 *
 * Usage : node scripts/build-data.js
 * Aucune dependance npm (modules natifs uniquement).
 */

const fs = require('fs');
const path = require('path');

const LIB = path.resolve(__dirname, '..', '..', '..', 'donnees', 'base');
const OUT = path.resolve(__dirname, '..', 'data', 'recipes-data.json');

function load(rel) {
  return JSON.parse(fs.readFileSync(path.join(LIB, rel), 'utf8'));
}

console.log('Lecture de la librairie depuis :', LIB);

const lignes = load('recettes.json').recettes;
const noms   = load('noms.json').items;
const ferme  = load('ferme.json');
const meta   = load('meta.json');

// Index de TOUTES les recettes du jeu par id — pour resoudre les sous-ingredients
// craftables (ex: T1_FISHCHOPS = produit du boucher).
const ligneParId = {};
for (const l of lignes) if (!ligneParId[l.id]) ligneParId[l.id] = l;

// Index des cultures par produit recolte.
const cultureParProduit = {};
for (const c of ferme.cultures) if (c.produit) cultureParProduit[c.produit] = c;

// base/ ne repete pas le tier sur chaque ingredient : il est dans l'identifiant.
function tierDe(id) {
  const m = /^T(\d+)_/.exec(id);
  return m ? Number(m[1]) : null;
}

// --- Conversion vers le format attendu par le front ----------------------------
// base/ groupe sous un seul identifiant toutes les facons de fabriquer un objet.
function slimVariante(r) {
  return {
    quantity: r.quantiteProduite,
    // Nutrition CONSOMMEE par la fabrication, qui sert aux frais de station.
    // Ne pas prendre l.nutrition : c'est ce que l'objet APPORTE quand on le
    // mange. Une soupe T5 apporte 756 de nutrition et en coute 6,48 a produire,
    // soit un facteur 117 d'ecart sur les frais.
    nutrition: r.nutritionCraft || 0,
    // Ingredients prives de retour de ressources. La librairie pose le drapeau
    // recette par recette et non objet par objet, parce que le poisson est rendu
    // chez le Cuisinier mais consomme chez le Boucher.
    excludeFromRRR: r.ingredients.filter(i => i.exclusDuRetour).map(i => i.id),
    ingredients: r.ingredients.map(i => ({
      id: i.id,
      tier: tierDe(i.id),
      enchantment: i.enchantement || 0,
      quantity: i.quantite,
    })),
  };
}

// Deux objets du jeu se fabriquent a partir de sources interchangeables :
//   - T1_FISHCHOPS, 41 variantes (1 morceau pour un gardon rouge T1, 200 pour
//     un requin), toutes au Boucher ;
//   - T1_ALCHEMY_COMMON, 21 variantes (5, 10 ou 25 restes selon le tier de la
//     depouille).
// Ce script n'en gardait que la premiere, si bien que le moteur ne connaissait
// que la source la moins rentable des 41 et ratait les bonnes. On expose
// desormais la liste complete dans `variants`, et `quantity`/`ingredients`
// restent ceux de la premiere variante pour ne rien casser chez les
// consommateurs qui les lisent directement.
function slimRecipe(l) {
  const out = {
    id: l.id,
    station: l.station,
    tier: l.tier,
    enchantment: l.enchantement,
    ...slimVariante(l.recettes[0]),
  };
  if (l.recettes.length > 1) out.variants = l.recettes.map(slimVariante);
  return out;
}

// --- Fermeture des dependances -------------------------------------------------
// Depart : recettes cook + alch. On descend dans chaque ingredient :
//   - s'il est craftable (recette connue) -> on l'inclut et on continue
//   - sinon -> feuille (achat / culture)
// Le Moulin est ajoute aux cibles parce que la farine et les trois beurres y
// sont fabriques. L'ancienne source les rangeait a tort chez le Cuisinier et ils
// etaient donc affiches ; les garder ici preserve ce comportement tout en
// nommant correctement leur station.
const STATIONS_CIBLES = new Set(['cook', 'alchemist', 'mill']);
const targets = lignes.filter(l => STATIONS_CIBLES.has(l.station));
const includedRecipes = {};        // id -> recette (cibles + sous-recettes)
const referencedItems = new Set(); // tous les ids a nommer
const usedFarm = {};               // produit -> culture utilisee

// Toutes les variantes comptent : ne descendre que dans la premiere laisserait
// hors du fichier les 16 poissons communs, qui ne servent qu'a faire des
// morceaux et n'apparaissent dans aucune autre recette. Sans prix pour eux,
// l'onglet Poissons n'aurait rien a comparer.
const ingredientsDe = l => l.recettes.flatMap(v => v.ingredients);

const stack = [];
for (const l of targets) {
  includedRecipes[l.id] = slimRecipe(l);
  referencedItems.add(l.id);
  for (const ing of ingredientsDe(l)) stack.push(ing.id);
}

const visited = new Set();
while (stack.length) {
  const id = stack.pop();
  referencedItems.add(id);
  if (visited.has(id)) continue;
  visited.add(id);

  // Culture ? (produit issu d'une graine)
  const culture = cultureParProduit[id];
  if (culture) {
    usedFarm[id] = culture;
    referencedItems.add(culture.graine); // la graine doit etre nommee
  }

  // Sous-recette craftable ?
  const l = ligneParId[id];
  if (l && !includedRecipes[id]) {
    includedRecipes[id] = slimRecipe(l);
    for (const ing of ingredientsDe(l)) stack.push(ing.id);
  }
}

// --- Noms FR / EN --------------------------------------------------------------
// Pour un id enchante (T..._X@2) sans entree dediee, on retombe sur l'id de base.
// Les descriptions de base/noms.json sont volontairement laissees de cote : le
// front ne les affiche pas et elles tripleraient le poids du fichier.
const outNames = {};
let missingNames = 0;
for (const id of referencedItems) {
  const n = noms[id] || noms[id.split('@')[0]];
  if (n) outNames[id] = { fr: n.fr, en: n.en };
  else { outNames[id] = { fr: id, en: id }; missingNames++; }
}

// --- Cultures (format epure) ---------------------------------------------------
const outFarm = {};
for (const [produit, c] of Object.entries(usedFarm)) {
  outFarm[produit] = {
    seedId: c.graine,
    tier: c.tier,
    // base/ donne la fourchette brute du jeu ; le premium double la recolte.
    // (3+6)/2 x 2 = 9, le chiffre unique que fournissait l'ancienne source.
    yield: (c.rendementMin + c.rendementMax) / 2 * 2,
    seedReturn: c.retourGraine,   // taux de retour de graine de base (0..1+)
    nurtureBonus: c.bonusSoin,    // retour de graine supplementaire si arrosage (focus)
  };
}

// --- Ecriture ------------------------------------------------------------------
const out = {
  version: meta.version,
  generatedAt: new Date().toISOString(),
  source: meta.source,
  // base/meta.json nomme ses champs en francais ; le front attend les anciens.
  economy: {
    taxPremium: meta.economie.taxePremium,
    taxFree: meta.economie.taxeSansPremium,
    defaultReturnRate: meta.economie.tauxRetourBase,
  },
  api: { baseUrl: meta.api.prix, servers: meta.api.serveurs },
  recipes: Object.values(includedRecipes),
  farm: outFarm,
  names: outNames,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));

const sizeKo = (fs.statSync(OUT).size / 1024).toFixed(1);
const displayable = out.recipes.filter(r => STATIONS_CIBLES.has(r.station)).length;
console.log('--- Donnees generees ---');
console.log('Recettes incluses        :', out.recipes.length, '(dont', displayable, 'cook/alch affichables)');
console.log('Cultures utilisees       :', Object.keys(outFarm).length);
console.log('Items nommes             :', Object.keys(outNames).length, '(' + missingNames + ' sans nom officiel)');
console.log('Taille du fichier        :', sizeKo, 'Ko ->', OUT);
