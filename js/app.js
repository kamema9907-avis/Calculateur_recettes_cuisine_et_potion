// ============================================================================
//  app.js — état partagé, réglages, et les deux onglets.
//  Vue 3 est chargé en global par le CDN ; on le lit sur window.
// ============================================================================
import * as E from './engine.js';
import * as M from './market.js';
import * as P from './planner.js';

const { createApp, reactive, ref, computed, watch, onMounted } = window.Vue;
const CITIES = E.CITIES;
const CLE_REGLAGES = 'albion.reglages';

createApp({
  setup() {
    const ready = ref(false);
    const loading = ref(false);
    const error = ref('');
    const statusText = ref('');
    const onglet = ref('calc');              // 'calc' | 'plan'

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

    const s = reactive({
      priceCities: [...CITIES], craftCity: 'auto', eventBonus: 0, stationFee: 400,
      marginThreshold: 20, stationFilter: 'all', tiers: [...TIERS], enchFilter: [...ENCH],
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

    // ---- Persistance : une douzaine de champs, les ressaisir serait pénible ----
    try {
      const sauv = JSON.parse(localStorage.getItem(CLE_REGLAGES) || 'null');
      if (sauv) {
        Object.assign(s, sauv.s || {});
        Object.assign(p, sauv.p || {});
        // Migration : le filtre de tier était un menu déroulant ('all' ou un
        // nombre). Sans cette conversion, un filtre actif disparaîtrait en silence.
        if (typeof (sauv.s || {}).tierFilter === 'number') s.tiers = [sauv.s.tierFilter];
        delete s.tierFilter;
      }
    } catch { /* réglages corrompus : on garde les défauts */ }
    watch([s, p], () => {
      try { localStorage.setItem(CLE_REGLAGES, JSON.stringify({ s, p })); } catch {}
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

    function allPriceIds() {
      const set = new Set();
      for (const r of data.recipes) { set.add(r.id); for (const i of r.ingredients) set.add(i.id); }
      for (const f of Object.values(data.farm)) set.add(f.seedId);
      return [...set];
    }
    const ciblesVendables = () => data.recipes
      .filter(r => r.station === 'cook' || r.station === 'alchemist').map(r => r.id);

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
        focus: false, premium: s.premium,
        seedSource: s.seedSource, npcDiscount: s.npcDiscount,
        autoriserCulture: false, maxAgeH: p.maxAgeH,
      };
    }

    // ================= ONGLET CALCULATEUR =================
    const rows = computed(() => {
      void [pricesVersion.value, s.priceCities, s.craftCity, s.eventBonus, s.stationFee,
        s.focus, s.premium, s.lang, s.seedSource, s.npcDiscount,
        JSON.stringify(manual), JSON.stringify(methodOverride)];
      const ctx = ctxCalc();
      const tax = s.premium ? data.economy.taxPremium : data.economy.taxFree;
      const out = [];
      for (const r of data.recipes) {
        if (r.station !== 'cook' && r.station !== 'alchemist') continue;
        const dec = E.decomposer(r, ctx, methodOverride);
        const b = E.bestBuy(r.id, ctx);
        const sell = b ? b.price : null;
        const netRevenue = sell != null ? sell * r.quantity * (1 - tax) : null;
        const profitCraft = (netRevenue != null && dec.craftCost != null) ? netRevenue - dec.craftCost : null;
        out.push({
          id: r.id, name: nameOf(r.id), station: r.station, tier: r.tier,
          enchantment: r.enchantment, quantity: r.quantity,
          cost: dec.cost, craftCost: dec.craftCost, sell, netRevenue,
          profit: profitCraft != null ? profitCraft / r.quantity : null,
          profitCraft,
          margin: (profitCraft != null && dec.craftCost > 0) ? (profitCraft / dec.craftCost * 100) : null,
          stationFee: dec.stationFee, rrr: dec.rrr,
          breakdown: dec.breakdown.map(i => ({ ...i, name: nameOf(i.id) })),
        });
      }
      return out;
    });

    const totalDisplayable = computed(() =>
      data.recipes.filter(r => r.station === 'cook' || r.station === 'alchemist').length);
    const ignoreThreshold = ref(false);

    const categoryRows = computed(() => rows.value.filter(r => {
      if (s.stationFilter !== 'all' && r.station !== s.stationFilter) return false;
      if (!s.tiers.includes(r.tier)) return false;
      if (!s.enchFilter.includes(r.enchantment)) return false;
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
    watch([p, () => s.premium, () => s.stationFee, () => s.eventBonus], () => {
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
    const img = id => E.RENDER(id);
    function imgErr(ev, id) {
      if (ev.target.dataset.fb) return;
      ev.target.dataset.fb = 1;
      ev.target.src = E.RENDER(id.split('@')[0]);
    }
    const methodLabel = m => ({ buy: 'Acheter', grow: 'Cultiver', craft: 'Fabriquer' })[m] || m;
    const stationLabel = st => ({ cook: 'Cuisine', alchemist: 'Alchimie' })[st] || st;

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
      prices, manual, expanded,
      volumesCharges, chargementVolumes, calculEnCours, filtresVides,
      cocherTout, cocherAucun, stationLabel,
      // calculateur
      displayRows, totalDisplayable, hiddenByMargin, ignoreThreshold,
      fetchPrices, setManual, sortBy, arrow, toggle, chooseMethod,
      // plan
      plan, planParVille, coursesParVille, expositionItems, ecarteesResume, lignesCorrigees,
      fetchVolumes, calculerPlan, viderCache, nameOf,
      // helpers
      fmt, fmtM, signed, pct, ratioFmt, profClass, img, imgErr, methodLabel,
    };
  },
}).mount('#app');
