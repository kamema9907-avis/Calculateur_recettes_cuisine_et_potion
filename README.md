# 🍲 Albion — Calculateur Cuisine & Potions

Page web (Vue 3) à deux onglets pour l'économie *Cuisinier* et *Alchimiste* d'Albion Online.

- **📊 Calculateur** — coût de fabrication et profit de chaque recette, en comparant pour
  chaque ingrédient **acheter au marché vs cultiver depuis une graine vs fabriquer**.
- **🎯 Plan de profit** — un plan d'action exécutable dans la journée : quoi acheter et où,
  quoi fabriquer, quoi vendre et où, en quelles quantités, sous contrainte de capital,
  de volume réellement échangé et de diversification.

Serveur de jeu : **Europe**. Prix : **albion-online-data**.

---

## 🚀 Lancer en local

Le navigateur bloque `fetch()` sur les fichiers ouverts en `file://`, il faut donc un
petit serveur HTTP (aucune installation, juste Python déjà présent) :

- **Windows** : double-clique sur **`Lancer.bat`** → ouvre http://localhost:8765
- **Manuel** : dans le dossier, `python -m http.server 8765` puis ouvre
  http://localhost:8765/index.html

Aucun `npm`, aucun build : Vue 3 est chargé via CDN.

---

## 🌐 En ligne (GitHub Pages)

👉 **https://kamema9907-avis.github.io/Calculateur_recettes_cuisine_et_potion/**

Utilisable depuis n'importe quel appareil : PC, tablette, smartphone (l'interface bascule en
cartes sur petit écran). Sur mobile, *Ajouter à l'écran d'accueil* donne un accès en un tap.

Pages sert la branche `main` à la racine. Le développement se fait sur `version-3` ; pour
publier une amélioration :

```
git checkout main
git merge version-3
git push
git checkout version-3
```

Le site se met à jour tout seul 30 à 60 secondes après le push.

Les appels à l'API de prix fonctionnent depuis GitHub Pages (CORS autorisé, tout en HTTPS).

---

## 🧮 Comment fonctionne le calcul

- **Coût d'un ingrédient** = le moins cher entre :
  - *Acheter* : meilleur `sell order min` parmi les villes cochées (la ville est affichée).
  - *Cultiver* : `prix graine × (1 − taux de retour) ÷ rendement`. Graine = la moins
    chère entre **Marchand PNJ** (prix par tier) et **Marketplace** (réglable).
    Rendement ≈ 9 (premium) / 4,5 (sinon). Arrosée au focus, le retour de graine
    dépasse 100 % → coût ≈ 0. Couvre légumes ET herbes d'alchimie.
  - *Fabriquer* : récursivement, à partir de ses propres sous-ingrédients.
- **Retour de ressources (RRR)** : `RRR = 1 − 1/(1 + bonus/100)`, où
  `bonus = 18 (base) + 15 (spécialité ville) + 59 (focus) + 0/10/20 (événement)`.
  Spécialité : **Caerleon = cuisine**, **Brecilien = potions**.
  Les ingrédients listés dans `excludeFromRRR` ne sont pas retournés.
- **Frais de station** = `Item Value × 0,1125 × tarif/100` (tarif par défaut **400**,
  Item Value déduit des tiers ; *à calibrer en jeu*).
- **Profit** = `(prix de vente × quantité produite − taxe) − coût`, taxe **6,5 %** (Premium)
  ou **10,5 %**.
- **Marge** = `profit ÷ coût`. Le tableau ne montre que les recettes au-dessus du seuil
  (défaut 20 %) ; les recettes à prix manquant restent visibles pour saisie manuelle.

Tous les prix sont **modifiables à la main** (clic sur une ligne → détail).

⚠️ Ce tableau **ignore le volume échangé**. Une marge de 60 % sur un objet qui se vend
6 fois par jour ne rapporte rien. C'est exactement ce que corrige l'onglet Plan.

---

## 🎯 L'onglet Plan de profit

Tu saisis ton capital et ton objectif, il te sort la tournée à faire dans la journée.

### Ce qu'il corrige par rapport au tableau

1. **Il mesure le volume.** Sur 377 recettes affichables, 273 sont enchantées et
   s'échangent entre 1 et 50 unités par jour. Le plan écarte les marchés trop étroits.
2. **Il ne fait pas confiance au prix affiché.** `sell_price_min` est le prix *demandé*
   le plus bas : un joueur isolé peut y poster n'importe quoi. 10 % des couples
   objet × ville affichent plus de 1,3× le prix réellement transigé, avec des cas à
   **440×**. Le plan retient `min(prix affiché, prix réel moyen sur 7 j)` moins l'undercut,
   et signale chaque ligne corrigée.
3. **Il tient compte de ce qui est faisable en 24 h.** La culture est exclue (cycle de
   22 h), le focus n'est pas utilisé (pool limité, coût dépendant de ta spécialisation).
   Le bénéfice annoncé est donc un **plancher**.

### Les quatre bornes sur chaque quantité

| Borne | Pourquoi |
|---|---|
| % du volume quotidien du produit | tu ne peux pas écouler plus que ce que le marché absorbe |
| % du volume quotidien de **chaque ingrédient** | acheter en masse fait monter ton propre prix d'achat |
| capital restant | évident |
| plafond par objet (15 % du bénéfice) | ne pas dépendre d'un seul produit |

### Ce qu'il affiche

Le bénéfice atteint et le capital réellement mobilisé, la **tournée groupée par ville de
vente**, la **liste de courses groupée par ville d'achat**, l'exposition par objet pour
contrôler la règle des 15 %, les prix corrigés, et les opportunités écartées avec leur motif.

Les réglages sont mémorisés dans le navigateur ; prix et volumes sont mis en cache
(30 min et 6 h) pour éviter de retaper l'API à chaque ouverture.

---

## 🔄 Régénérer les données après un patch du jeu

Les recettes/cultures/noms viennent de la librairie voisine
`../Albion_librairie_des_recettes_du_jeu`. Pour reconstruire le fichier réduit
`data/recipes-data.json` :

```
node scripts/build-data.js
```

Le script extrait uniquement les recettes cook + alchemist (et leurs sous-recettes),
les cultures utilisées et les noms FR/EN concernés (~180 Ko au lieu de ~12 Mo).

---

## 📁 Structure

```
index.html              HTML, styles et les deux onglets
js/engine.js            Moteur de coût (acheter / cultiver / fabriquer)
js/market.js            Prix, volumes, cache localStorage
js/planner.js           Solveur du plan sous contraintes
js/app.js               État, réglages, persistance
data/recipes-data.json  Données réduites générées
scripts/build-data.js   Générateur des données depuis la librairie
Lancer.bat              Lance serveur + navigateur (Windows)
.nojekyll               Désactive Jekyll sur GitHub Pages
```

Modules ES natifs, **aucun build**. Ils imposent en revanche un serveur HTTP :
`Lancer.bat` ou GitHub Pages conviennent, l'ouverture directe du fichier en `file://` non.

---

## ⚠️ Limites assumées

- **Profondeur du carnet d'ordres** : l'API ne publie que le prix de la première unité.
  La borne sur la liquidité des ingrédients limite le glissement, sans l'éliminer.
- **Coût en focus** : dépend de ta spécialisation par recette, donnée absente des fichiers
  du jeu. D'où le choix d'un bénéfice plancher calculé sans focus.
- **Taxe de station** : fixée par les gouverneurs et variable par ville. Réglage global
  (400 par défaut), *à calibrer en jeu*.
- **Risque et temps de transport** : non chiffrables. À gérer via la sélection des villes.
- **Concurrence** : albion-online-data est public. Les marchés liquides et sains sont
  scrutés par beaucoup de joueurs avec les mêmes chiffres.
- **Impact de tes propres ordres** : injecter une part notable du volume quotidien fait
  baisser le prix. Le plan suppose un prix constant, ce qui reste optimiste à la marge.
