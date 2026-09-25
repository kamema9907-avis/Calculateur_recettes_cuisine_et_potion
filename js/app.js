// ============================================================================
//  app.js — état partagé, réglages, et les deux onglets.
//  Vue 3 est chargé en global par le CDN ; on le lit sur window.
// ============================================================================
import * as E from './engine.js';
import * as M from './market.js';
import * as P from './planner.js';
import * as F from './fish.js';

const { createApp, reactive, ref, computed, watch, onMounted } = window.Vue;
const CITIES = E.CITIES;
const CLE_REGLAGES = 'albion.reglages';

createApp({
  setup() {
    const ready = ref(false);
    const loading = ref(false);
    const error = ref('');
    const statusText = ref('');
    const onglet = ref('calc');              // 'calc' | 'plan' | 'fish'

    const data = reactive({ recipes: [], names: {}, farm: {}, byId: {}, economy: {} });
    const prices = reactive({});             // id -> { ville: {sell, buy, ageH} }
    const volumes = reactive({});            // id -> { ville: {vol, avgPrice} }
    const manual = reactive({});             // id -> prix manuel
    const methodOverride = reactive({});     // "recetteId|ingId" -> méthode forcée
    const expanded = reactive({});
    const pricesVersion = ref(0);            // incrémenté à chaque chargement de prix

    // ---- Réglages onglet Calculateur (inchangés depuis la v2) ----
    const TIERS = [1, 2, 3, 4, 5, 6, 7, 8];
    const ENCH = [0, 1, 2, 3];
    const STATIONS = ['cook', 'alchemist'];
    // Étiquettes de contenu, définies par le moteur qui les calcule.
    const ETIQUETTES = E.ETIQUETTES;
    const CONTENU = ETIQUETTES.map(e => e.cle);

    const s = reactive({
      priceCities: [...CITIES], craftCity: 'auto', eventBonus: 0, stationFee: 400,
      facteurNutrition: 1,     // calibration des frais de station, à ajuster en jeu
      marginThreshold: 20, stationFilter: 'all', tiers: [...TIERS], enchFilter: [...ENCH],
      contenu: [...CONTENU],   // tout coché : on n'écarte rien tant qu'on ne décoche pas
      lang: 'fr', focus: false, premium: true, showMissing: true,
      seedSource: 'cheapest', npcDiscount: 100, sortKey: 'margin', sortDir: 'desc',
    });

    // ---- Réglages onglet Plan ----
    const p = reactive({
      capital: 20000000,
      objectif: 3000000,
      partVolume: 10,          // % du volume quotidien que l'on pense capter
      volumeMin: 50,           // ventes/jour minimum pour retenir un marché
      maxAgeH: 12,             // fraîcheur maximale du prix, en heures
      partMaxItem: 15,         // % du bénéfice maximum sur un même item
      undercut: 3,             // % retiré au prix pour passer sous le vendeur le moins cher
      villesAchat: [...CITIES],
      villesVente: [...CITIES],
      craftCity: 'auto',
      tiers: [...TIERS],
      ench: [...ENCH],
      stations: [...STATIONS],
    });

    // ---- Réglages onglet Poissons ----
    // La ville de référence sert à la fois de lieu de vente et de station de
    // craft : on compare ce qu'on peut faire sans bouger. Relevé le 2026-09-20,
    // Martlock et Lymhurst cotent plus de 35 poissons sur 41, Caerleon 8, d'où
    // ce défaut.
    const f = reactive({
      ville: 'Martlock',
      quantite: 10,            // nombre de poissons pêchés, met tout à l'échelle
      partVolume: 10,          // % du volume quotidien qu'on pense capter
      undercut: 3,             // % retiré au prix pour passer sous le vendeur le moins cher
      triCle: 'meilleur',
      triDir: 'desc',
      rarete: ['Commun', 'Rare', 'Boss'],
      // Les autres ingrédients du plat s'achètent par défaut dans la seule
      // ville de référence : l'onglet répond à « je ne bouge pas d'ici ».
      // Cocher élargit aux villes retenues dans le Calculateur, ce qui chiffre
      // plus de plats mais suppose une tournée.
      achatPartout: false,
    });

    // ---- Persistance : une douzaine de champs, les ressaisir serait pénible ----
    try {
      const sauv = JSON.parse(localStorage.getItem(CLE_REGLAGES) || 'null');
      if (sauv) {
        Object.assign(s, sauv.s || {});
        Object.assign(p, sauv.p || {});
        Object.assign(f, sauv.f || {});
        // Migration : le filtre de tier était un menu déroulant ('all' ou un
        // nombre). Sans cette conversion, un filtre actif disparaîtrait en silence.
        if (typeof (sauv.s || {}).tierFilter === 'number') s.tiers = [sauv.s.tierFilter];
        delete s.tierFilter;
      }
    } catch { /* réglages corrompus : on garde les défauts */ }
    watch([s, p, f], () => {
      try { localStorage.setItem(CLE_REGLAGES, JSON.stringify({ s, p, f })); } catch {}
    }, { deep: true });

    // ---- Chargement des données ----
    onMounted(async () => {
      try {
        const d = await (await fetch('data/recipes-data.json')).json();
        data.recipes = d.recipes; data.names = d.names; data.farm = d.farm; data.economy = d.economy;
        d.recipes.forEach(r => data.byId[r.id] = r);
        ready.value = true;
        fetchPrices();
      } catch (e) {
        error.value = 'Impossible de charger data/recipes-data.json — sers le dossier via un serveur HTTP.';
      }
    });

    const nameOf = id => {
      const n = data.names[id]; if (!n) return id;
      return n[s.lang] || n.fr || n.en || id;
    };

    // Toutes les variantes, sinon les 16 poissons communs n'auraient jamais de
    // prix : ils ne servent qu'à faire des morceaux et n'apparaissent dans
    // aucune autre recette, donc ils ne sont ingrédients que de variantes.
    function allPriceIds() {
      const set = new Set();
      for (const r of data.recipes) {
        set.add(r.id);
        for (const v of E.variantesDe(r)) for (const i of v.ingredients) set.add(i.id);
      }
      for (const f of Object.values(data.farm)) set.add(f.seedId);
      return [...set];
    }
    // Les stations dont les produits s'achètent et se vendent au marché, donc
    // dignes d'une ligne dans le tableau. Le Moulin produit la farine et les
    // trois beurres ; le Boucher les six viandes et les morceaux de poisson.
    // Ce dernier n'avait pas sa place ici tant que le moteur ne connaissait
    // qu'une source de morceaux sur 41 : la ligne n'aurait rien voulu dire.
    const STATIONS_VENDABLES = ['cook', 'alchemist', 'mill', 'butcher'];
    const ciblesVendables = () => data.recipes
      .filter(r => STATIONS_VENDABLES.includes(r.station)).map(r => r.id);

    async function fetchPrices(forcer = false) {
      if (!ready.value) return;
      loading.value = true; error.value = '';
      try {
        const { data: px, depuisCache } = await M.chargerPrix(allPriceIds(), CITIES, {
          forcer,
          onProgress: (f, t) => statusText.value = `Prix ${f}/${t}…`,
        });
        Object.keys(prices).forEach(k => delete prices[k]);
        Object.assign(prices, px);
        pricesVersion.value++;
        const n = Object.keys(px).length;
        statusText.value = `Prix : ${n} objets${depuisCache ? ' (cache)' : ''} · ${new Date().toLocaleTimeString('fr-FR')}`;
      } catch (e) {
        error.value = 'API prix indisponible (' + e.message + '). Tu peux saisir les prix à la main.';
      } finally { loading.value = false; }
    }

    // Les volumes ne servent qu'à l'onglet Plan : chargés à la demande pour ne
    // pas ralentir l'ouverture du calculateur.
    const volumesCharges = ref(false);
    const chargementVolumes = ref(false);
    async function fetchVolumes(forcer = false) {
      if (!ready.value || chargementVolumes.value) return;
      chargementVolumes.value = true; error.value = '';
      try {
        // produits finis ET ingrédients : la borne de liquidité porte sur les deux
        const ids = [...new Set([...ciblesVendables(), ...allPriceIds()])];
        const { data: v, depuisCache } = await M.chargerVolumes(ids, CITIES, {
          forcer,
          onProgress: (f, t) => statusText.value = `Volumes ${f}/${t}…`,
        });
        Object.keys(volumes).forEach(k => delete volumes[k]);
        Object.assign(volumes, v);
        volumesCharges.value = true;
        statusText.value = `Volumes : ${Object.keys(v).length} objets${depuisCache ? ' (cache)' : ''}`;
        calculerPlan();
      } catch (e) {
        error.value = 'Historique indisponible (' + e.message + ').';
      } finally { chargementVolumes.value = false; }
    }

    // L'onglet Poissons n'a besoin que de 170 identifiants là où le Plan en
    // demande plus de 500 : neuf requêtes d'historique au lieu de vingt-sept.
    // Les deux jeux vivent dans le même objet réactif mais dans deux caches
    // distincts, et celui-ci FUSIONNE au lieu d'écraser pour ne pas effacer ce
    // que le Plan a déjà chargé.
    const volumesPoissonsCharges = ref(false);
    async function fetchVolumesPoissons(forcer = false) {
      if (!ready.value || chargementVolumes.value) return;
      chargementVolumes.value = true; error.value = '';
      try {
        const ids = F.identifiantsUtiles(data.byId);
        const { data: v, depuisCache } = await M.chargerVolumes(ids, CITIES, {
          forcer, cleCache: M.CLE_VOLUMES_POISSONS,
          onProgress: (a, b) => statusText.value = `Historique poissons ${a}/${b}…`,
        });
        Object.assign(volumes, v);
        volumesPoissonsCharges.value = true;
        statusText.value = `Poissons : ${Object.keys(v).length} objets${depuisCache ? ' (cache)' : ''}`;
      } catch (e) {
        error.value = 'Historique indisponible (' + e.message + ').';
      } finally { chargementVolumes.value = false; }
    }

    function setManual(id, ev) {
      const v = parseFloat(ev.target.value);
      if (isNaN(v) || v <= 0) delete manual[id]; else manual[id] = v;
    }

    // ---- Contextes du moteur ----
    // Onglet Calculateur : comportement v2 à l'identique (culture autorisée,
    // aucun filtre de fraîcheur).
    function ctxCalc() {
      return {
        byId: data.byId, farm: data.farm, prices, manual,
        villesAchat: s.priceCities, craftCity: s.craftCity,
        eventBonus: s.eventBonus, stationFee: s.stationFee,
        facteurNutrition: s.facteurNutrition,
        focus: s.focus, premium: s.premium,
        seedSource: s.seedSource, npcDiscount: s.npcDiscount,
        autoriserCulture: true, maxAgeH: null,
      };
    }
    // Onglet Plan : pas de culture (cycle 22 h), pas de focus (pool limité),
    // et les prix périmés sont écartés.
    function ctxPlan() {
      return {
        byId: data.byId, farm: data.farm, prices, manual,
        villesAchat: p.villesAchat, craftCity: p.craftCity,
        eventBonus: s.eventBonus, stationFee: s.stationFee,
        facteurNutrition: s.facteurNutrition,
        focus: false, premium: s.premium,
        seedSource: s.seedSource, npcDiscount: s.npcDiscount,
        autoriserCulture: false, maxAgeH: p.maxAgeH,
      };
    }

    // Onglet Poissons : la ville de référence est à la fois le lieu de vente
    // et la station de craft, donc elle décide aussi du retour de ressources.
    // Pas de culture : on veut savoir quoi faire du poisson maintenant, pas
    // dans vingt-deux heures.
    function ctxFish() {
      return {
        byId: data.byId, farm: data.farm, prices, manual,
        villesAchat: f.achatPartout ? s.priceCities : [f.ville],
        villeRef: f.ville, craftCity: f.ville,
        eventBonus: s.eventBonus, stationFee: s.stationFee,
        facteurNutrition: s.facteurNutrition,
        focus: s.focus, premium: s.premium,
        seedSource: s.seedSource, npcDiscount: s.npcDiscount,
        autoriserCulture: false, maxAgeH: null,
      };
    }

    // ================= ONGLET CALCULATEUR =================
    const rows = computed(() => {
      void [pricesVersion.value, s.priceCities, s.craftCity, s.eventBonus, s.stationFee,
        s.facteurNutrition, s.focus, s.premium, s.lang, s.seedSource, s.npcDiscount,
        JSON.stringify(manual), JSON.stringify(methodOverride)];
      const ctx = ctxCalc();
      const tax = s.premium ? data.economy.taxPremium : data.economy.taxFree;
      const out = [];
      for (const r of data.recipes) {
        if (!STATIONS_VENDABLES.includes(r.station)) continue;
        const dec = E.decomposer(r, ctx, methodOverride);
        const b = E.bestBuy(r.id, ctx);
        const sell = b ? b.price : null;
        // dec.quantity et non r.quantity : la variante retenue décide combien
        // d'unités sortent d'un craft (de 1 à 200 pour les morceaux de poisson).
        const qte = dec.quantity;
        const netRevenue = sell != null ? sell * qte * (1 - tax) : null;
        const profitCraft = (netRevenue != null && dec.craftCost != null) ? netRevenue - dec.craftCost : null;
        out.push({
          id: r.id, name: nameOf(r.id), station: r.station, tier: r.tier,
          enchantment: r.enchantment, quantity: qte,
          tags: dec.tags,
          cost: dec.cost, craftCost: dec.craftCost, sell, netRevenue,
          profit: profitCraft != null ? profitCraft / qte : null,
          profitCraft,
          margin: (profitCraft != null && dec.craftCost > 0) ? (profitCraft / dec.craftCost * 100) : null,
          stationFee: dec.stationFee, rrr: dec.rrr,
          breakdown: dec.breakdown.map(i => ({ ...i, name: nameOf(i.id) })),
        });
      }
      return out;
    });

    const totalDisplayable = computed(() =>
      data.recipes.filter(r => STATIONS_VENDABLES.includes(r.station)).length);
    const ignoreThreshold = ref(false);

    // Les recettes qui passent tout SAUF les cases de contenu. Sert de base au
    // filtre de contenu et aux compteurs affichés à côté de chaque case, qui
    // restent ainsi stables quand on coche et décoche.
    const baseContenu = computed(() => rows.value.filter(r => {
      if (s.stationFilter !== 'all' && r.station !== s.stationFilter) return false;
      if (!s.tiers.includes(r.tier)) return false;
      if (!s.enchFilter.includes(r.enchantment)) return false;
      return true;
    }));

    // Décocher une case veut dire « je ne veux aucune recette qui en contient ».
    // On accumule donc les bits des cases DÉCOCHÉES, et une recette passe si
    // elle n'en porte aucun. Une recette qui cumule six étiquettes disparaît
    // dès que l'une des six est décochée, ce qui est le seul comportement
    // honnête : 337 recettes sur 430 en portent plusieurs.
    const masqueRejet = computed(() =>
      ETIQUETTES.reduce((m, e) => s.contenu.includes(e.cle) ? m : (m | E.BIT[e.cle]), 0));

    const compteEtiquettes = computed(() => {
      const c = {};
      for (const e of ETIQUETTES) c[e.cle] = 0;
      for (const r of baseContenu.value)
        for (const e of ETIQUETTES) if (r.tags & E.BIT[e.cle]) c[e.cle]++;
      return c;
    });

    const ecarteesParContenu = computed(() =>
      baseContenu.value.filter(r => r.tags & masqueRejet.value).length);

    const categoryRows = computed(() => baseContenu.value.filter(r => {
      if (r.tags & masqueRejet.value) return false;
      if (r.margin == null) return s.showMissing;
      return true;
    }));
    const hiddenByMargin = computed(() =>
      categoryRows.value.filter(r => r.margin != null && r.margin < s.marginThreshold).length);

    const displayRows = computed(() => {
      let list = categoryRows.value.filter(r =>
        r.margin == null ? true : (ignoreThreshold.value || r.margin >= s.marginThreshold));
      const dir = s.sortDir === 'asc' ? 1 : -1, key = s.sortKey;
      return list.slice().sort((a, b) => {
        if (key === 'name') {
          const av = a.name.toLowerCase(), bv = b.name.toLowerCase();
          return av < bv ? -dir : av > bv ? dir : 0;
        }
        const av = a[key], bv = b[key];
        if (av == null) return 1; if (bv == null) return -1;
        return (av - bv) * dir;
      });
    });

    // ================= ONGLET POISSONS =================
    const analysePoissons = computed(() => {
      void [pricesVersion.value, volumesPoissonsCharges.value, f.ville, f.quantite,
        f.undercut, f.partVolume, f.achatPartout, s.focus, s.premium, s.stationFee,
        s.eventBonus, s.facteurNutrition, JSON.stringify(manual)];
      if (!ready.value) return { lignes: [], rrr: 0, couverture: { total: 0, comparables: 0, aucune: 0 } };
      const tax = s.premium ? data.economy.taxPremium : data.economy.taxFree;
      return F.analyser(ctxFish(), volumes, {
        taxe: tax,
        undercut: f.undercut / 100,
        partVolume: f.partVolume / 100,
        quantite: f.quantite,
      });
    });

    // Où le marché du poisson existe vraiment. Sans ce repère, un tableau
    // presque vide passerait pour une panne alors que c'est la ville choisie
    // qui ne cote presque aucun poisson.
    const couverturePoissons = computed(() => {
      if (!ready.value || !volumesPoissonsCharges.value) return [];
      return F.couvertureParVille(ctxFish(), volumes, CITIES);
    });

    const revenuDe = (l, cle) => {
      const o = cle === 'brut' ? l.brut : cle === 'morceaux' ? l.morceaux : l.plat;
      return (o && !o.motif && o.revenu != null) ? o.revenu : null;
    };

    const lignesPoissons = computed(() => {
      const list = analysePoissons.value.lignes
        .filter(l => f.rarete.includes(l.rarete));
      const dir = f.triDir === 'asc' ? 1 : -1;
      const val = l => {
        switch (f.triCle) {
          case 'nom': return nameOf(l.id).toLowerCase();
          case 'tier': return l.tier;
          case 'morceauxParPoisson': return l.morceauxParPoisson;
          case 'meilleur': return revenuDe(l, l.meilleur);
          default: return revenuDe(l, f.triCle);
        }
      };
      return list.slice().sort((a, b) => {
        const av = val(a), bv = val(b);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;            // les lignes sans chiffre en bas
        if (bv == null) return -1;
        if (typeof av === 'string') return av < bv ? -dir : av > bv ? dir : 0;
        return (av - bv) * dir;
      });
    });

    function trierPoissons(cle) {
      if (f.triCle === cle) f.triDir = f.triDir === 'asc' ? 'desc' : 'asc';
      else { f.triCle = cle; f.triDir = cle === 'nom' ? 'asc' : 'desc'; }
    }
    const flechePoissons = cle => f.triCle === cle ? (f.triDir === 'asc' ? '▲' : '▼') : '';

    const RARETES = ['Commun', 'Rare', 'Boss'];

    // ================= ONGLET PLAN =================
    const plan = ref(null);
    const ecartees = ref([]);
    const calculEnCours = ref(false);

    function calculerPlan() {
      if (!ready.value || !volumesCharges.value) return;
      calculEnCours.value = true;
      try {
        const ctx = ctxPlan();
        const tax = s.premium ? data.economy.taxPremium : data.economy.taxFree;
        const { lignes, ecartees: ec } = P.construireLignes(ctx, volumes, {
          villesVente: p.villesVente,
          volumeMin: p.volumeMin,
          undercut: p.undercut / 100,
          taxe: tax,
          tiers: p.tiers,
          ench: p.ench,
          stations: p.stations,
        });
        ecartees.value = ec;
        plan.value = P.resoudre(lignes, ctx, volumes, {
          capital: p.capital,
          objectif: p.objectif,
          partVolume: p.partVolume / 100,
          partMaxItem: p.partMaxItem / 100,
        });
      } finally { calculEnCours.value = false; }
    }

    // Recalcul automatique une fois le premier plan établi : cocher une case doit
    // se voir tout de suite. Le délai groupe les clics rapides (le lien « tout »
    // modifie le tableau d'un coup, mais huit clics manuels sinon).
    // Les réglages partagés qui pèsent sur le coût sont suivis explicitement, pour
    // ne pas recalculer le plan à chaque frappe dans l'onglet Calculateur.
    let timerPlan = null;
    watch([p, () => s.premium, () => s.stationFee, () => s.eventBonus,
      () => s.facteurNutrition], () => {
      if (!plan.value) return;
      clearTimeout(timerPlan);
      timerPlan = setTimeout(calculerPlan, 250);
    }, { deep: true });

    // Le plan groupé par ville de vente : l'ordre d'une tournée en jeu.
    const planParVille = computed(() => {
      if (!plan.value) return [];
      const g = {};
      for (const l of plan.value.retenues) {
        (g[l.villeVente] = g[l.villeVente] || []).push(l);
      }
      return Object.entries(g)
        .map(([ville, lignes]) => ({
          ville, lignes: lignes.sort((a, b) => b.profit - a.profit),
          profit: lignes.reduce((a, b) => a + b.profit, 0),
          investi: lignes.reduce((a, b) => a + b.investi, 0),
        }))
        .sort((a, b) => b.profit - a.profit);
    });

    // La liste de courses, groupée par ville d'achat.
    const coursesParVille = computed(() => {
      if (!plan.value) return [];
      const g = {};
      for (const a of plan.value.achats) (g[a.ville] = g[a.ville] || []).push(a);
      return Object.entries(g)
        .map(([ville, items]) => ({
          ville, items: items.sort((x, y) => y.cout - x.cout),
          cout: items.reduce((x, y) => x + y.cout, 0),
        }))
        .sort((a, b) => b.cout - a.cout);
    });

    // Exposition par item, pour vérifier d'un coup d'œil la règle des 15%.
    const expositionItems = computed(() => {
      if (!plan.value) return [];
      return Object.entries(plan.value.parItem)
        .map(([id, profit]) => ({
          id, name: nameOf(id), profit,
          part: plan.value.profitTotal > 0 ? profit / plan.value.profitTotal * 100 : 0,
          plafondAtteint: profit >= plan.value.plafond * 0.999,
        }))
        .sort((a, b) => b.profit - a.profit);
    });

    // Regroupement des motifs de rejet, pour l'encadré « écartées ».
    const ecarteesResume = computed(() => {
      const g = {};
      for (const e of ecartees.value) (g[e.motif] = g[e.motif] || []).push(e);
      return Object.entries(g)
        .map(([motif, items]) => ({ motif, n: items.length, exemples: items.slice(0, 6) }))
        .sort((a, b) => b.n - a.n);
    });

    // Les lignes valorisées bien en dessous de leur prix affiché : c'est ici que
    // se voit le travail de la correction anti-ordre-aberrant.
    const lignesCorrigees = computed(() => {
      if (!plan.value) return [];
      return plan.value.retenues.filter(l => l.aberrant).sort((a, b) => b.ratio - a.ratio);
    });

    watch(onglet, o => { if (o === 'plan' && !volumesCharges.value) fetchVolumes(); });

    // ---- Helpers d'affichage ----
    const fmt = v => v == null ? '—' : Math.round(v).toLocaleString('fr-FR');
    const fmtM = v => v == null ? '—' : (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + ' M' : fmt(v));
    const signed = v => (v > 0 ? '+' : '') + fmt(v);
    const pct = v => v == null ? '—' : (v * 100).toFixed(1) + '%';
    // Un ratio de 1,46 ne doit pas s'afficher « 1× » : une décimale sous 10.
    const ratioFmt = v => v == null ? '—' : v.toFixed(v < 10 ? 1 : 0);
    const profClass = v => v == null ? 'na' : (v >= 0 ? 'pos' : 'neg');
    // Délai d'écoulement. Le formatage vit ici et non dans le template : un
    // « < » dans une interpolation se fait avaler par le parseur HTML, qui lit
    // le gabarit avant Vue.
    const joursFmt = j => j == null ? '—' : (j < 0.1 ? '≤ 0,1 j' : j.toFixed(1) + ' j');
    const img = id => E.RENDER(id);
    function imgErr(ev, id) {
      if (ev.target.dataset.fb) return;
      ev.target.dataset.fb = 1;
      ev.target.src = E.RENDER(id.split('@')[0]);
    }
    const methodLabel = m => ({ buy: 'Acheter', grow: 'Cultiver', craft: 'Fabriquer' })[m] || m;
    const stationLabel = st =>
      ({ cook: 'Cuisine', alchemist: 'Alchimie', mill: 'Moulin', butcher: 'Boucher' })[st] || st;

    // Raccourcis des groupes de cases à cocher : cinq groupes dans l'onglet Plan,
    // isoler un seul niveau demanderait sinon sept clics.
    const cocherTout = (obj, cle, valeurs) => obj[cle] = [...valeurs];
    const cocherAucun = (obj, cle) => obj[cle] = [];

    // Un groupe vidé ne produit aucune ligne : on veut le dire explicitement
    // plutôt que d'afficher un plan à zéro sans explication.
    const filtresVides = computed(() => {
      const vides = [];
      if (!p.tiers.length) vides.push('niveau');
      if (!p.ench.length) vides.push('enchantement');
      if (!p.stations.length) vides.push('station');
      if (!p.villesVente.length) vides.push('ville de vente');
      if (!p.villesAchat.length) vides.push('ville d\'achat');
      return vides;
    });
    function sortBy(k) {
      if (s.sortKey === k) s.sortDir = s.sortDir === 'asc' ? 'desc' : 'asc';
      else { s.sortKey = k; s.sortDir = k === 'name' ? 'asc' : 'desc'; }
    }
    const arrow = k => s.sortKey === k ? (s.sortDir === 'asc' ? '▲' : '▼') : '';
    const toggle = id => expanded[id] = !expanded[id];
    function chooseMethod(recipeId, ingId, method) {
      const key = recipeId + '|' + ingId;
      if (methodOverride[key] === method) delete methodOverride[key];
      else methodOverride[key] = method;
    }
    function viderCache() { M.viderCache(); statusText.value = 'Cache vidé.'; }

    return {
      // état
      ready, loading, error, statusText, onglet, s, p, CITIES, TIERS, ENCH, STATIONS,
      ETIQUETTES, CONTENU, compteEtiquettes, ecarteesParContenu,
      prices, manual, expanded,
      volumesCharges, chargementVolumes, calculEnCours, filtresVides,
      cocherTout, cocherAucun, stationLabel,
      // calculateur
      displayRows, totalDisplayable, hiddenByMargin, ignoreThreshold,
      fetchPrices, setManual, sortBy, arrow, toggle, chooseMethod,
      // plan
      plan, planParVille, coursesParVille, expositionItems, ecarteesResume, lignesCorrigees,
      fetchVolumes, calculerPlan, viderCache, nameOf,
      // poissons
      f, RARETES, analysePoissons, lignesPoissons, couverturePoissons,
      volumesPoissonsCharges, fetchVolumesPoissons, trierPoissons, flechePoissons, revenuDe,
      // helpers
      fmt, fmtM, signed, pct, ratioFmt, profClass, img, imgErr, methodLabel, joursFmt,
    };
  },
}).mount('#app');
