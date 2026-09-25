# 🍲 Albion — Calculateur Cuisine & Potions

Page web (Vue 3) à trois onglets pour l'économie *Cuisinier* et *Alchimiste* d'Albion Online.

- **📊 Calculateur** — coût de fabrication et profit de chaque recette, en comparant pour
  chaque ingrédient **acheter au marché vs cultiver depuis une graine vs fabriquer**.
- **🎯 Plan de profit** — un plan d'action exécutable dans la journée : quoi acheter et où,
  quoi fabriquer, quoi vendre et où, en quelles quantités, sous contrainte de capital,
  de volume réellement échangé et de diversification.
- **🐟 Poissons** — pour chaque poisson pêché : vaut-il mieux le **vendre tel quel**,
  le **découper en morceaux** ou le **cuisiner en son plat dédié** ?

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

Pages sert la branche `main` à la racine. Le développement se fait sur la branche de version
en cours (`version-4`) ; pour publier une amélioration :

```
git checkout main
git merge version-4
git push
git checkout version-4
```

Le site se met à jour tout seul 30 à 60 secondes après le push.

### Clore une version et ouvrir la suivante

```
git tag -a version-4 -m "Version 4 — description"
git branch version-5 version-4
git checkout version-5
git push origin refs/tags/version-4:refs/tags/version-4
git push -u origin refs/heads/version-5:refs/heads/version-5
```

⚠️ Les refspecs complets (`refs/heads/…`, `refs/tags/…`) sont **nécessaires** : chaque version
porte une branche et un tag de même nom, et `git push origin version-4` échoue alors avec
*src refspec matches more than one*.

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
- **Frais de station** = `nutrition de la recette × tarif/100 × calibration`. La nutrition
  vient des données du jeu, **recette par recette** (champ `nutrition`). Elle a remplacé une
  estimation déduite du tier des ingrédients qui se trompait d'un facteur **8 à 216** selon
  la recette. Le multiplicateur de calibration (défaut **1**) reste *à ajuster en relevant le
  coût réel en jeu* : il absorbe l'incertitude sur l'unité du champ.
- **Profit** = `(prix de vente × quantité produite − taxe) − coût`, taxe **6,5 %** (Premium)
  ou **10,5 %**.
- **Marge** = `profit ÷ coût`. Le tableau ne montre que les recettes au-dessus du seuil
  (défaut 20 %) ; les recettes à prix manquant restent visibles pour saisie manuelle.

Tous les prix sont **modifiables à la main** (clic sur une ligne → détail).

⚠️ Ce tableau **ignore le volume échangé**. Une marge de 60 % sur un objet qui se vend
6 fois par jour ne rapporte rien. C'est exactement ce que corrige l'onglet Plan.

### Écarter par contenu

Huit cases, toutes cochées au départ. **Décocher une case écarte toute recette qui en a
besoin** : c'est un filtre « je n'ai pas ça sous la main », pas une mise en avant.

Le tableau couvre désormais **430 recettes** : les 226 du Cuisinier, les 193 de
l'Alchimiste, les 4 du Moulin (farine et beurres) et les 7 du Boucher (les six viandes
et les morceaux de poisson). Le Boucher n'avait pas sa place tant que le moteur ne
connaissait qu'une source de morceaux sur 41 : la ligne n'aurait rien voulu dire.

| Case | Recettes | Ce que ça écarte |
|---|---|---|
| 🐟 Poisson entier | 191 | tout ce dont la chaîne réclame un poisson |
| 🫙 Sauce de poisson | 162 | les plats enchantés, qui en consomment tous |
| 🥩 Morceaux de poisson | 166 | tout ce qui passe par le Boucher |
| 🥓 Viande d'élevage | 120 | tout ce qui réclame un animal de ferme |
| 🧪 Extrait arcanique | 129 | les potions enchantées |
| 🌊 Algues | 166 | l'algue ne se cultive pas, elle s'achète |
| 🪙 Token d'Avalon | 36 | ni craftable, ni retourné par le RRR |
| 🌱 Passe par la ferme | 374 | tout ce qui demande d'attendre un cycle de 22 h |

Deux points comptent pour bien les lire.

**La règle est un ET, pas un OU.** 337 recettes sur 430 portent plusieurs étiquettes : la
soupe de palourdes noirebières enchantée en cumule six (🐟 🫙 🥩 🥓 🌊 🌱). Elle disparaît
dès qu'**une seule** des six est décochée. C'est la seule règle honnête : décocher 🥓 parce
qu'on n'a pas de viande doit faire disparaître cette soupe, même si elle reste cochée
par 🐟.

**Les étiquettes suivent le chemin que le moteur retient, pas la recette sur le papier.**
Si la sauce de poisson est moins chère à l'achat qu'à la fabrication, la recette qui en
consomme garde 🫙 mais perd 🐟, 🥩 et 🌊 : on n'a plus à se les procurer. Les choix forcés
à la main sont pris en compte. Corollaire : 🐟 coche 191 recettes et non les 97 qui
demandent un poisson entier nommément, puisque fabriquer ses morceaux implique d'acheter
du poisson. Pour isoler les 25 recettes qui réclament **ce** poisson précis, il suffit de
décocher 🥩.

Techniquement, les étiquettes sont un masque de bits qui remonte le long de l'arbre
pendant la descente que `decomposer` fait déjà : pas de second parcours, pas d'allocation.

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

## 🐟 L'onglet Poissons

Un poisson pêché a trois sorties, et le tableau les met côte à côte en **revenu net de
taxe**. Pas en marge : le poisson est déjà dans le sac, son coût d'acquisition est nul.
La question n'est pas « est-ce rentable » mais « laquelle paie le mieux ».

| Sortie | Ce qui est compté |
|---|---|
| **Vendre tel quel** | prix retenu, net de taxe |
| **En morceaux** | N morceaux × prix retenu. **Aucun retour de ressources** : les données du jeu excluent explicitement le poisson chez le Boucher |
| **En plat dédié** | nombre de plats obtenus × prix retenu, **moins** les autres ingrédients et les frais de station |

Le rendement en morceaux va de **1** pour un gardon rouge T1 à **200** pour un requin.
Chaque poisson rare a **exactement un** plat, en quatre niveaux d'enchantement ; l'onglet
retient le plus rentable des quatre. Les 16 poissons communs n'ont pas de plat : pour eux
la question est binaire.

### La ville de référence décide de tout

Le sélecteur *« je suis à »* fixe **à la fois** le lieu de vente et la station de craft.
Il pilote donc aussi le retour de ressources, qui change le nombre de plats tirés d'un
poisson :

| Situation | Retour | Plats pour 1 poisson |
|---|---|---|
| Caerleon (spécialité cuisine), sans focus | 24,8 % | 1,33 |
| Ailleurs, sans focus | 15,3 % | 1,18 |
| Caerleon, avec focus | 47,9 % | 1,92 |
| Ailleurs, avec focus | 43,5 % | 1,77 |

Le poisson **est** rendu chez le Cuisinier, contrairement au Boucher. Activer le focus
suffit à faire basculer plusieurs poissons de « découper » vers « cuisiner ».

### Ce que l'onglet refuse de faire

- **Il ne désigne pas de gagnant quand une seule colonne est chiffrable.** Un débouché
  sans prix n'est pas un débouché perdant, c'est un débouché inconnu. La ligne affiche
  alors *seule option chiffrée*.
- **Il ne valorise jamais au-dessus du prix réellement transigé**, exactement comme le
  Plan : `min(prix affiché, moyenne pondérée sur 7 j)` moins l'undercut. La fonction
  `prixVente` a été extraite de `planner.js` pour que les deux onglets partagent le même
  juge de paix plutôt que deux copies qui divergeraient.
- **Il ne cache pas le temps d'écoulement.** Une colonne donne le nombre de jours requis
  pour vendre la production sans dépasser la part du volume quotidien qu'on s'autorise.
  Un revenu qui demande trois semaines n'en est pas vraiment un.
- **Il n'autorise pas la culture** : les légumes du plat sont achetés. Et par défaut ils
  sont achetés **dans la ville de référence uniquement**, puisque l'onglet répond à
  « je ne bouge pas d'ici ». Une case élargit aux villes retenues dans le Calculateur.

### Le marché du poisson est très inégal, et instable

Relevé le 2026-09-20 : **37 poissons cotés sur 41 à Lymhurst, 8 à Caerleon**. Un tableau
presque vide veut dire que la ville choisie n'a pas de marché du poisson, pas que l'outil
est en panne, d'où la liste des villes affichée en tête.

Cette couverture **bouge d'une heure à l'autre** : deux relevés à 40 minutes d'écart ont
donné 36 puis 26 poissons cotés à Martlock. albion-online-data ne connaît que ce que les
joueurs ont scanné récemment.

Enfin, le pictogramme ⚠️ se déclenche ici à **2×** le prix réel et non à 1,3× comme dans
le Plan. Les morceaux s'échangent à plus de 200 000 unités par jour et affichent
couramment 1,4 fois la moyenne pondérée sur sept jours : au seuil du Plan, l'alerte
s'allumerait sur toutes les lignes et ne signalerait plus rien.

L'onglet ne charge l'historique que des **170 objets** qui le concernent, contre plus de
500 pour le Plan, et les deux jeux vivent dans des caches séparés pour ne pas s'écraser.

---

## 🔄 Régénérer les données après un patch du jeu

Les recettes, cultures et noms viennent du dossier `base/` de la librairie voisine
`../../donnees`, alimenté par les dumps officiels du jeu
(`ao-data/ao-bin-dumps`, republiés tous les 3 à 5 jours). Pour reconstruire le
fichier réduit `data/recipes-data.json` :

```
node scripts/build-data.js
```

Le script extrait uniquement les recettes cook, alchemist et mill (et leurs
sous-recettes), les cultures utilisées et les noms FR/EN concernés (~200 Ko au lieu
de ~23 Mo).

### Les recettes à plusieurs variantes

Deux objets du jeu se fabriquent à partir de sources interchangeables, et `base/` les
regroupe sous un seul identifiant :

| Objet | Variantes | Ce qui change |
|---|---|---|
| `T1_FISHCHOPS` — Morceaux de poisson | 41 | 1 morceau pour un gardon rouge T1, 200 pour un requin |
| `T1_ALCHEMY_COMMON` — Restes d'animaux rares | 21 | 5, 10 ou 25 selon le tier de la dépouille |

Le générateur n'en gardait que la **première**. Le moteur ne connaissait donc qu'une
seule façon de faire des morceaux, celle du gardon rouge, qui est le pire ratio des 41 :
il surestimait leur coût ou retombait sur l'achat au marché. Le bug faisait **rater des
opportunités**, il ne créait pas de profit imaginaire.

`build-data.js` expose désormais la liste complète dans un champ `variants`, présent
uniquement quand il y en a plusieurs. `quantity`, `nutrition`, `excludeFromRRR` et
`ingredients` restent ceux de la première variante, si bien que le format ne casse
aucun lecteur existant. Une variante porte ses **propres** quantité produite, nutrition
et exclusions : c'est elle qu'il faut lire, et non la recette, partout où ces champs
interviennent. `variantesDe(r)` renvoie `r.variants` ou `[r]`, et `craftCost` retient la
variante la moins chère.

Trois pièges que cette correction oblige à traiter ensemble :

- **La fermeture des dépendances** doit descendre dans toutes les variantes, sinon les
  **16 poissons communs** restent hors du fichier : ils ne servent qu'à faire des
  morceaux et n'apparaissent dans aucune autre recette.
- **`allPriceIds()`** doit faire de même, sans quoi ces 16 poissons n'auraient jamais
  de prix.
- **La liste de courses du plan** doit nommer la variante sur laquelle le coût a été
  calculé. Sans ça elle envoyait acheter 1 128 gardons rouges là où le prix retenu
  venait de 282 broches écaille-bleue.

**Effet mesuré** (prix du 2026-09-20, réglages par défaut) : sur 422 recettes
affichables chiffrables, **299 voient leur coût baisser**, de **6,1 % en moyenne**, et
**aucune ne monte** — ajouter des options à un minimum ne peut que le faire baisser.
Une seule dépasse 10 % : les restes d'animaux rares, à **−39,5 %**. Le gain reste
modeste sur le poisson parce que le marché est efficient : la plupart des 41 poissons
reviennent entre 214 et 280 silver le morceau, pour un morceau coté 267.

**Migration du 2026-09-20.** La librairie lisait `Jaccak/AlbionRecipes`, dépôt mort
depuis novembre 2024. Le format de `recipes-data.json` n'a pas changé et le moteur
de calcul n'a pas été touché : sur les 384 recettes communes, aucun écart
d'ingrédients, de quantité produite ni d'exclusion du retour de ressources. Deux
corrections tout de même, l'ancienne source se trompant : la soupe T5 coûte 6,48 de
nutrition et non 64,8, et la farine et les beurres se fabriquent au **Moulin** et non
chez le Cuisinier, d'où la troisième station acceptée par `ciblesVendables()`.

---

## 📁 Structure

```
index.html              HTML, styles et les trois onglets
js/engine.js            Moteur de coût (acheter / cultiver / fabriquer) + étiquettes
js/market.js            Prix, volumes, cache localStorage
js/planner.js           Solveur du plan sous contraintes + prixVente
js/fish.js              Les trois débouchés d'un poisson pêché
js/app.js               État, réglages, persistance
data/recipes-data.json  Données réduites générées
scripts/build-data.js   Générateur des données depuis la librairie
Lancer.bat              Lance serveur + navigateur (Windows)
.nojekyll               Désactive Jekyll sur GitHub Pages
```

Modules ES natifs, **aucun build**. Ils imposent en revanche un serveur HTTP :
`Lancer.bat` ou GitHub Pages conviennent, l'ouverture directe du fichier en `file://` non.

---

## 🔍 Audit des données (version 4)

Constantes croisées avec le dépôt wiki `Albion/reference` (44 323 entrées) et la
librairie de dumps du jeu.

**Confirmé exact :** la formule du RRR, les bonus 18 / +15 / +59, Caerleon = cuisine et
Brecilien = potions, les 377 noms français, et l'exclusion des artefacts du retour de
ressources (36 recettes à token, aucune erreur).

**Trois erreurs corrigées :**

1. **Identifiants d'extraits arcaniques.** Le dump nomme l'ingrédient
   `T1_ALCHEMY_EXTRACT_LEVEL1@1`, alors que le marché ne connaît que
   `T1_ALCHEMY_EXTRACT_LEVEL1` — le niveau est déjà porté par `LEVEL1/2/3`. Ces identifiants
   n'ayant jamais de prix, **120 recettes de potions enchantées étaient incalculables** et
   disparaissaient du plan. `build-data.js` normalise désormais l'identifiant.
2. **Frais de station** (voir ci-dessus) : nutrition réelle au lieu d'une Item Value inventée.
3. **Recettes à variantes tronquées** (voir ci-dessous) : le générateur ne gardait qu'une
   façon de fabriquer sur 41.

**Non vérifiable faute de source :** prix des graines PNJ, rendement des cultures
(`farming.json` ne couvre que les animaux), taxes de vente, et Item Value des consommables.
Le dépôt wiki couvre l'équipement, pas la cuisine ni l'alchimie : `recipes.json` ne contient
aucune recette de plat ou de potion.

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
- **Capacité de fabrication** : chaque craft consomme la moitié de la valeur de l'objet
  produit dans la capacité du bâtiment, qui ne se recharge complètement qu'en 24 h. Les
  grosses quantités du plan peuvent donc demander plusieurs stations. Non modélisé : la
  capacité de départ des bâtiments n'est ni dans le wiki ni dans les dumps.
