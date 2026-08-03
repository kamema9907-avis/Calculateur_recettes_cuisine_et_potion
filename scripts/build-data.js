/*
 * build-data.js
 * -----------------------------------------------------------------------------
 * Genere le fichier de donnees REDUIT consomme par index.html.
 *
 * Source : ../Albion_librairie_des_recettes_du_jeu/data (librairie complete, ~12 Mo)
 * Sortie : data/recipes-data.json (quelques dizaines de Ko)
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

const LIB = path.resolve(__dirname, '..', '..', 'Albion_librairie_des_recettes_du_jeu', 'data');
const OUT = path.resolve(__dirname, '..', 'data', 'recipes-data.json');

function load(rel) {
  return JSON.parse(fs.readFileSync(path.join(LIB, rel), 'utf8'));
}

console.log('Lecture de la librairie depuis :', LIB);

const allRecipes = load('all-recipes.json').recipes;
const cook = load('recipes/cook.json').recipes;
const alch = load('recipes/alchemist.json').recipes;
const farm = load('farm.json');
const names = load('names.json').items;
const meta = load('meta.json');

// Index de TOUTES les recettes du jeu par id (1ere occurrence) — pour resoudre
// les sous-ingredients craftables (ex: T1_FISHCHOPS = produit du boucher).
const recipeById = {};
for (const r of allRecipes) {
  if (!recipeById[r.id]) recipeById[r.id] = r;
}

// Index des cultures par produit adulte (uniquement celles cultivables = avec graine).
const farmByAdult = {};
for (const c of (farm.crops || [])) {
  if (c.babyId) farmByAdult[c.adultId] = c;
}

// --- Fermeture des dependances -------------------------------------------------
// Depart : recettes cook + alch. On descend dans chaque ingredient :
//   - s'il est craftable (recette connue) -> on l'inclut et on continue
//   - sinon -> feuille (achat / culture)
const targets = [...cook, ...alch];
const includedRecipes = {};       // id -> recette (cibles + sous-recettes)
const referencedItems = new Set(); // tous les ids a nommer
const usedFarm = {};              // adultId -> entree farm (cultures utilisees)

// Le dump ajoute un suffixe d'enchantement aux extraits arcaniques
// (T1_ALCHEMY_EXTRACT_LEVEL1@1) alors que le niveau est deja porte par
// LEVEL1/2/3. Ces identifiants n'existent pas sur le marche : verifie via
// l'API de prix, seule la forme sans suffixe a des offres (4996 silver contre
// aucune cotation). Sans cette normalisation, les 120 recettes de potions
// enchantees ont un ingredient sans prix et deviennent incalculables.
function normaliserId(id) {
  return /ALCHEMY_EXTRACT_LEVEL\d+@\d+$/.test(id) ? id.split('@')[0] : id;
}

function slimRecipe(r) {
  return {
    id: r.id,
    station: r.station,
    tier: r.tier,
    enchantment: r.enchantment,
    quantity: r.quantity,
    // Nutrition consommee par craft, telle que fournie par le jeu. Remplace
    // l'estimation maison qui la deduisait du tier des ingredients et se
    // trompait d'un facteur 8 a 216 selon la recette.
    nutrition: r.nutrition || 0,
    excludeFromRRR: (r.excludeFromRRR || []).map(normaliserId),
    ingredients: r.ingredients.map(i => ({
      id: normaliserId(i.id),
      tier: i.tier,
      enchantment: i.enchantment,
      quantity: i.quantity,
    })),
  };
}

const stack = [];
for (const r of targets) {
  includedRecipes[r.id] = slimRecipe(r);
  referencedItems.add(r.id);
  for (const ing of r.ingredients) stack.push(normaliserId(ing.id));
}

const visited = new Set();
while (stack.length) {
  const id = stack.pop();
  referencedItems.add(id);
  if (visited.has(id)) continue;
  visited.add(id);

  // Culture ? (produit issu d'une graine)
  if (farmByAdult[id]) {
    usedFarm[id] = farmByAdult[id];
    referencedItems.add(farmByAdult[id].babyId); // la graine doit etre nommee
  }

  // Sous-recette craftable ?
  const rec = recipeById[id];
  if (rec && !includedRecipes[id]) {
    includedRecipes[id] = slimRecipe(rec);
    for (const ing of rec.ingredients) stack.push(normaliserId(ing.id));
  }
}

// --- Noms FR / EN --------------------------------------------------------------
// Pour un id enchante (T..._X@2) sans entree dediee, on retombe sur l'id de base.
function nameOf(id) {
  let n = names[id];
  if (!n) n = names[id.split('@')[0]];
  if (!n) return null;
  return { fr: n['FR-FR'] || n['EN-US'] || id, en: n['EN-US'] || id };
}

const outNames = {};
let missingNames = 0;
for (const id of referencedItems) {
  const n = nameOf(id);
  if (n) outNames[id] = n;
  else { outNames[id] = { fr: id, en: id }; missingNames++; }
}

// --- Cultures (format epure) ---------------------------------------------------
const outFarm = {};
for (const [adultId, c] of Object.entries(usedFarm)) {
  outFarm[adultId] = {
    seedId: c.babyId,
    tier: c.tier,
    yield: c.quantity,            // recolte par graine en PREMIUM (~9) ; /2 sans premium
    seedReturn: c.baseYield,      // taux de retour de graine de base (0..1+)
    nurtureBonus: c.nurtureBonus, // retour de graine supplementaire si arrosage (focus)
  };
}

// --- Ecriture ------------------------------------------------------------------
const out = {
  version: meta.version,
  generatedAt: new Date().toISOString(),
  source: meta.source,
  economy: meta.economy,
  api: meta.api,
  recipes: Object.values(includedRecipes),
  farm: outFarm,
  names: outNames,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));

const sizeKo = (fs.statSync(OUT).size / 1024).toFixed(1);
const displayable = out.recipes.filter(r => r.station === 'cook' || r.station === 'alchemist').length;
console.log('--- Donnees generees ---');
console.log('Recettes incluses        :', out.recipes.length, '(dont', displayable, 'cook/alch affichables)');
console.log('Cultures utilisees       :', Object.keys(outFarm).length);
console.log('Items nommes             :', Object.keys(outNames).length, '(' + missingNames + ' sans nom officiel)');
console.log('Taille du fichier        :', sizeKo, 'Ko ->', OUT);
