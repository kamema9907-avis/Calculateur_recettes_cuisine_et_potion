# 🍲 Albion — Calculateur Cuisine & Potions

Page web (Vue 3) qui calcule le **coût de fabrication** et le **profit** des recettes
*Cuisinier (cook)* et *Alchimiste (alchemist)* d'Albion Online, en comparant pour
chaque ingrédient **acheter au marché vs cultiver depuis une graine vs fabriquer**.

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
index.html              L'application (Vue 3 CDN, autonome)
data/recipes-data.json  Données réduites générées
scripts/build-data.js   Générateur des données depuis la librairie
Lancer.bat              Lance serveur + navigateur (Windows)
.nojekyll               Désactive Jekyll sur GitHub Pages
```
