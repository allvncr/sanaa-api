const Commande = require('../models/Commande');
const Client = require('../models/Client');
const Depense = require('../models/Depense');
const CategorieDepense = require('../models/CategorieDepense');
const Produit = require('../models/Produit');
const Pays = require('../models/Pays');
const Devise = require('../models/Devise');
const deviseService = require('./devise.service');
const { toDecimal, sum } = require('../utils/money');
const { resoudrePeriode } = require('../utils/periode');
const { getCurrentUser } = require('../utils/requestContext');

/**
 * Pays sur lesquels agréger : le pays demandé s'il est précisé, sinon "tous
 * les pays" (retour V0.1 — vue consolidée) restreint aux pays autorisés de
 * l'utilisateur courant. Un appel API sans pays_id ne doit jamais renvoyer
 * plus que ce que l'utilisateur est autorisé à voir, même si aucune requête
 * Mongoose explicite sur `pays_id` ne serait filtrée ensuite par le plugin de
 * scoping (celui-ci s'efface dès qu'un filtre pays_id explicite est déjà
 * présent — ce qui est justement le cas ici, puisqu'on boucle pays par pays).
 */
async function paysCiblesPourAgregation(paysId) {
  if (paysId) {
    const pays = await Pays.findById(paysId);
    if (!pays) throw new Error('Pays introuvable');
    return [pays];
  }
  const utilisateur = getCurrentUser();
  const filtre = { actif: true };
  if (utilisateur && !utilisateur.porteeGlobale) {
    filtre._id = { $in: utilisateur.paysAutorises || [] };
  }
  return Pays.find(filtre);
}

async function resoudreDeviseCible(deviseAffichage) {
  const code = (deviseAffichage || require('../config/env').deviseReferenceGlobale).toUpperCase();
  const devise = await Devise.findOne({ code });
  if (!devise) throw new Error(`Devise d'affichage inconnue : ${code}`);
  return devise;
}

// Un utilisateur "Tous les pays" mélange plusieurs devises locales : chaque
// montant doit être converti au taux en vigueur à SA date de transaction
// (jamais un taux unique global — section 2.5, 10). Mis en cache par paire de
// devises et par jour pour limiter les allers-retours base de données.
function creerCacheTaux() {
  const cache = new Map();
  return async function taux(deviseSourceId, deviseCibleId, date) {
    const cle = `${deviseSourceId}|${deviseCibleId}|${new Date(date).toISOString().slice(0, 10)}`;
    if (!cache.has(cle)) {
      cache.set(cle, await deviseService.tauxApplicable(deviseSourceId, deviseCibleId, date));
    }
    return cache.get(cle);
  };
}

function formaterDatePeriode(date, parMois) {
  const iso = new Date(date).toISOString();
  return parMois ? iso.slice(0, 7) : iso.slice(0, 10);
}

/**
 * Convertit et additionne une liste de montants datés vers une devise cible, en
 * utilisant à chaque fois le taux en vigueur à la date de LA transaction concernée
 * (jamais un taux unique appliqué globalement) — section 2.5, 10, critère de
 * réussite section 11. Le taux est mis en cache par jour pour limiter les
 * requêtes répétées sur une même journée.
 */
async function convertirEtSommer(items, deviseSourceId, deviseCibleId) {
  const cache = new Map();
  let total = toDecimal(0);
  for (const { montant, date } of items) {
    const cle = `${new Date(date).toISOString().slice(0, 10)}`;
    let taux = cache.get(cle);
    if (taux === undefined) {
      taux = await deviseService.tauxApplicable(deviseSourceId, deviseCibleId, date);
      cache.set(cle, taux);
    }
    if (taux === null) continue; // pas de taux connu à cette date : montant exclu, signalé au niveau UI
    total = total.plus(toDecimal(montant).times(taux));
  }
  return total;
}

async function kpisBrutsPays(paysId, debut, fin) {
  const pays = await Pays.findById(paysId);
  if (!pays) throw new Error('Pays introuvable');

  const commandes = await Commande.find({ pays_id: paysId, createdAt: { $gte: debut, $lte: fin } });
  const statutsInclus = pays.ca_statuts_inclus || ['Confirmee'];

  const commandesCA = commandes.filter((c) => statutsInclus.includes(c.statut_commande));
  const ca = { montant: sum(commandesCA.map((c) => c.total)), devise_id: pays.devise_locale_id };

  const paiementsDatés = [];
  for (const c of commandes) {
    for (const p of c.paiements) {
      if (!p.annule && p.date_paiement >= debut && p.date_paiement <= fin) {
        paiementsDatés.push({ montant: p.montant, date: p.date_paiement });
      }
    }
  }
  const encaissements = { montant: sum(paiementsDatés.map((p) => p.montant)), devise_id: pays.devise_locale_id };

  const resteARecevoir = sum(
    commandesCA.map((c) => {
      const paye = sum(c.paiements.filter((p) => !p.annule).map((p) => p.montant));
      return toDecimal(c.total).minus(toDecimal(c.reduction || 0)).minus(paye);
    })
  );

  const depenses = await Depense.find({ pays_id: paysId, date: { $gte: debut, $lte: fin } });
  const totalDepenses = { montant: sum(depenses.map((d) => d.montant)), devise_id: pays.devise_locale_id };

  const benefice = ca.montant.minus(totalDepenses.montant);
  const marge = ca.montant.gt(0) ? benefice.div(ca.montant).times(100) : toDecimal(0);

  const totalCommandes = commandes.length || 1;
  const livrees = commandes.filter((c) => c.statut_livraison === 'Livree').length;
  const annulees = commandes.filter((c) => c.statut_commande === 'Annulee').length;
  const retours = commandes.filter((c) => c.statut_livraison === 'Retour_echec').length;

  return {
    pays: { id: pays._id, code: pays.code, nom: pays.nom, devise_id: pays.devise_locale_id },
    periode: { debut, fin },
    ca,
    encaissements,
    reste_a_recevoir: { montant: resteARecevoir, devise_id: pays.devise_locale_id },
    depenses: totalDepenses,
    benefice: { montant: benefice, devise_id: pays.devise_locale_id },
    marge_pct: marge.toFixed(2),
    nombre_commandes: commandes.length,
    taux_livraison_pct: ((livrees / totalCommandes) * 100).toFixed(2),
    taux_annulation_pct: ((annulees / totalCommandes) * 100).toFixed(2),
    taux_retour_pct: ((retours / totalCommandes) * 100).toFixed(2),
    _paiements: paiementsDatés,
    _commandesCA: commandesCA.map((c) => ({ montant: c.total, date: c.createdAt })),
    _depenses: depenses.map((d) => ({ montant: d.montant, date: d.date })),
  };
}

function formaterMontants(brut) {
  const out = { ...brut };
  for (const cle of ['ca', 'encaissements', 'reste_a_recevoir', 'depenses', 'benefice']) {
    out[cle] = { ...out[cle], montant: out[cle].montant.toFixed(2) };
  }
  delete out._paiements;
  delete out._commandesCA;
  delete out._depenses;
  return out;
}

/**
 * KPI d'un pays sur une période, avec comparaison automatique à la période
 * précédente équivalente (retour V0.1 : jour vs veille, semaine vs semaine
 * précédente, mois vs mois précédent, année vs année précédente — pas de
 * comparaison pour une plage personnalisée, qui n'a pas d'équivalent évident).
 */
async function kpis({ pays_id, periode, date, periode_debut, periode_fin }) {
  if (!pays_id) throw new Error('pays_id requis pour /dashboard/kpis (utiliser /dashboard/comparaison-pays pour le global)');
  const { debut, fin, precedent } = resoudrePeriode(periode, { date, periode_debut, periode_fin });

  const actuel = formaterMontants(await kpisBrutsPays(pays_id, debut, fin));
  const comparaison = precedent
    ? formaterMontants(await kpisBrutsPays(pays_id, precedent.debut, precedent.fin))
    : null;

  return { ...actuel, comparaison };
}

/**
 * Comparaison multi-pays (section 5.11, 19) : tableau juxtaposant les KPI de
 * chaque pays sur une période, avec conversion vers la devise d'affichage choisie
 * au taux applicable à la date de chaque transaction. Chaque ligne porte aussi
 * sa part du CA consolidé (retour V0.1) pour visualiser d'un coup d'œil le poids
 * de chaque pays dans l'activité globale.
 */
async function comparaisonPays({ periode, date, periode_debut, periode_fin, devise_affichage }) {
  const { debut, fin } = resoudrePeriode(periode, { date, periode_debut, periode_fin });
  const paysListe = await paysCiblesPourAgregation();
  const deviseCible = await resoudreDeviseCible(devise_affichage);

  const lignes = [];
  const globalAccum = { ca: toDecimal(0), encaissements: toDecimal(0), depenses: toDecimal(0) };

  for (const pays of paysListe) {
    const brut = await kpisBrutsPays(pays._id, debut, fin);
    const caConverti = await convertirEtSommer(brut._commandesCA, pays.devise_locale_id, deviseCible._id);
    const encaissementsConvertis = await convertirEtSommer(brut._paiements, pays.devise_locale_id, deviseCible._id);
    const depensesConverties = await convertirEtSommer(brut._depenses, pays.devise_locale_id, deviseCible._id);
    const beneficeConverti = caConverti.minus(depensesConverties);

    globalAccum.ca = globalAccum.ca.plus(caConverti);
    globalAccum.encaissements = globalAccum.encaissements.plus(encaissementsConvertis);
    globalAccum.depenses = globalAccum.depenses.plus(depensesConverties);

    lignes.push({
      pays: { id: pays._id, code: pays.code, nom: pays.nom },
      ca_local: brut.ca.montant.toFixed(2),
      ca_converti: caConverti.toFixed(2),
      encaissements_convertis: encaissementsConvertis.toFixed(2),
      depenses_converties: depensesConverties.toFixed(2),
      benefice_converti: beneficeConverti.toFixed(2),
      nombre_commandes: brut.nombre_commandes,
      taux_livraison_pct: brut.taux_livraison_pct,
      taux_annulation_pct: brut.taux_annulation_pct,
      taux_retour_pct: brut.taux_retour_pct,
    });
  }

  const caTotal = globalAccum.ca.gt(0) ? globalAccum.ca : toDecimal(1);
  lignes.forEach((ligne) => {
    ligne.ca_pct = Number(toDecimal(ligne.ca_converti).div(caTotal).times(100).toFixed(2));
  });

  return {
    devise_affichage: deviseCible.code,
    periode: { debut, fin },
    global: {
      ca_converti: globalAccum.ca.toFixed(2),
      encaissements_convertis: globalAccum.encaissements.toFixed(2),
      depenses_converties: globalAccum.depenses.toFixed(2),
      benefice_converti: globalAccum.ca.minus(globalAccum.depenses).toFixed(2),
    },
    pays: lignes,
  };
}

/**
 * Meilleurs produits par chiffre d'affaires (retour V0.1). En mode "tous les
 * pays", le CA de chaque ligne de commande est converti vers devise_affichage
 * au taux en vigueur à la date de LA commande avant d'être cumulé — jamais un
 * taux unique global.
 */
async function performanceProduits({ pays_id, periode, date, periode_debut, periode_fin, devise_affichage }) {
  const { debut, fin } = resoudrePeriode(periode, { date, periode_debut, periode_fin });
  const paysListe = await paysCiblesPourAgregation(pays_id);
  const paysIds = paysListe.map((p) => p._id);
  const paysParId = new Map(paysListe.map((p) => [String(p._id), p]));
  const deviseCible = pays_id ? null : await resoudreDeviseCible(devise_affichage);
  const obtenirTaux = creerCacheTaux();

  const lignes = await Commande.aggregate([
    { $match: { pays_id: { $in: paysIds }, createdAt: { $gte: debut, $lte: fin } } },
    { $unwind: '$lignes' },
    {
      $project: {
        _id: 0,
        produit_id: '$lignes.produit_id',
        quantite: '$lignes.quantite',
        sous_total: '$lignes.sous_total',
        pays_id: 1,
        createdAt: 1,
      },
    },
  ]);

  const parProduit = new Map();
  for (const l of lignes) {
    let montant = toDecimal(l.sous_total);
    if (deviseCible) {
      const pays = paysParId.get(String(l.pays_id));
      const taux = await obtenirTaux(pays.devise_locale_id, deviseCible._id, l.createdAt);
      if (taux === null) continue; // pas de taux connu à cette date : ligne exclue
      montant = montant.times(taux);
    }
    const cle = String(l.produit_id);
    const entree = parProduit.get(cle) || { produit_id: l.produit_id, quantite_vendue: 0, chiffre_affaires: toDecimal(0) };
    entree.quantite_vendue += l.quantite;
    entree.chiffre_affaires = entree.chiffre_affaires.plus(montant);
    parProduit.set(cle, entree);
  }

  const resultats = [...parProduit.values()].sort((a, b) => b.chiffre_affaires.minus(a.chiffre_affaires).toNumber());
  const meilleurs = resultats.slice(0, 20);
  const produits = await Produit.find({ _id: { $in: meilleurs.map((r) => r.produit_id) } }).select('nom').lean();
  const nomParId = new Map(produits.map((p) => [String(p._id), p.nom]));

  return meilleurs.map((r) => ({
    produit_id: r.produit_id,
    nom: nomParId.get(String(r.produit_id)) || null,
    quantite_vendue: r.quantite_vendue,
    chiffre_affaires: Number(r.chiffre_affaires.toFixed(2)),
  }));
}

/**
 * Courbe d'évolution du CA sur la période (retour V0.1). Granularité
 * automatique : par jour si la période fait 62 jours ou moins, par mois
 * au-delà (ex. une année entière), pour rester lisible sur un graphique. En
 * mode "tous les pays", chaque commande est convertie vers devise_affichage
 * au taux en vigueur à sa propre date avant d'être cumulée dans le bucket.
 */
async function evolutionCA({ pays_id, periode, date, periode_debut, periode_fin, devise_affichage }) {
  const { debut, fin } = resoudrePeriode(periode, { date, periode_debut, periode_fin });
  const paysListe = await paysCiblesPourAgregation(pays_id);
  const nombreJours = (fin.getTime() - debut.getTime()) / (24 * 60 * 60 * 1000);
  const parMois = nombreJours > 62;
  const deviseCible = pays_id ? null : await resoudreDeviseCible(devise_affichage);
  const obtenirTaux = creerCacheTaux();

  const points = new Map();
  for (const pays of paysListe) {
    const statutsInclus = pays.ca_statuts_inclus || ['Confirmee'];
    const commandes = await Commande.find({
      pays_id: pays._id,
      createdAt: { $gte: debut, $lte: fin },
      statut_commande: { $in: statutsInclus },
    }).select('total createdAt').lean();

    for (const c of commandes) {
      let montant = toDecimal(c.total);
      if (deviseCible) {
        const taux = await obtenirTaux(pays.devise_locale_id, deviseCible._id, c.createdAt);
        if (taux === null) continue;
        montant = montant.times(taux);
      }
      const cle = formaterDatePeriode(c.createdAt, parMois);
      const entree = points.get(cle) || { ca: toDecimal(0), nombre_commandes: 0 };
      entree.ca = entree.ca.plus(montant);
      entree.nombre_commandes += 1;
      points.set(cle, entree);
    }
  }

  const resultats = [...points.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([periode2, v]) => ({ periode: periode2, ca: Number(v.ca.toFixed(2)), nombre_commandes: v.nombre_commandes }));

  return { granularite: parMois ? 'mois' : 'jour', devise: deviseCible ? deviseCible.code : null, points: resultats };
}

/**
 * Répartition des commandes par statut de livraison sur la période (retour
 * V0.1) — sert le graphique "proportion reçue / livrée / en cours / retour".
 * Simples décomptes, aucune conversion de devise nécessaire.
 */
async function repartitionLivraison({ pays_id, periode, date, periode_debut, periode_fin }) {
  const { debut, fin } = resoudrePeriode(periode, { date, periode_debut, periode_fin });
  const paysListe = await paysCiblesPourAgregation(pays_id);
  const paysIds = paysListe.map((p) => p._id);

  const resultats = await Commande.aggregate([
    { $match: { pays_id: { $in: paysIds }, createdAt: { $gte: debut, $lte: fin } } },
    { $group: { _id: '$statut_livraison', nombre: { $sum: 1 } } },
  ]);

  const total = resultats.reduce((acc, r) => acc + r.nombre, 0) || 1;
  return resultats.map((r) => ({
    statut: r._id,
    nombre: r.nombre,
    pourcentage: Number(((r.nombre / total) * 100).toFixed(2)),
  }));
}

/**
 * Répartition des commandes par canal d'acquisition (Site web / WhatsApp) sur
 * la période (retour V0.1) — aucune conversion de devise nécessaire.
 */
async function repartitionCanal({ pays_id, periode, date, periode_debut, periode_fin }) {
  const { debut, fin } = resoudrePeriode(periode, { date, periode_debut, periode_fin });
  const paysListe = await paysCiblesPourAgregation(pays_id);
  const paysIds = paysListe.map((p) => p._id);

  const resultats = await Commande.aggregate([
    { $match: { pays_id: { $in: paysIds }, createdAt: { $gte: debut, $lte: fin } } },
    { $group: { _id: '$canal_vente', nombre: { $sum: 1 } } },
  ]);

  const total = resultats.reduce((acc, r) => acc + r.nombre, 0) || 1;
  return resultats.map((r) => ({
    canal: r._id,
    nombre: r.nombre,
    pourcentage: Number(((r.nombre / total) * 100).toFixed(2)),
  }));
}

/**
 * Nouveaux clients sur la période, avec comparaison à la période précédente
 * (retour V0.1) et une courbe d'évolution (même granularité que le CA) — pour
 * suivre l'acquisition, pas seulement les ventes.
 */
async function nouveauxClients({ pays_id, periode, date, periode_debut, periode_fin }) {
  const { debut, fin, precedent } = resoudrePeriode(periode, { date, periode_debut, periode_fin });
  const paysListe = await paysCiblesPourAgregation(pays_id);
  const paysIds = paysListe.map((p) => p._id);
  const nombreJours = (fin.getTime() - debut.getTime()) / (24 * 60 * 60 * 1000);
  const parMois = nombreJours > 62;
  const format = parMois ? '%Y-%m' : '%Y-%m-%d';

  const [total, totalPrecedent, points] = await Promise.all([
    Client.countDocuments({ pays_id: { $in: paysIds }, createdAt: { $gte: debut, $lte: fin } }),
    precedent
      ? Client.countDocuments({ pays_id: { $in: paysIds }, createdAt: { $gte: precedent.debut, $lte: precedent.fin } })
      : Promise.resolve(null),
    Client.aggregate([
      { $match: { pays_id: { $in: paysIds }, createdAt: { $gte: debut, $lte: fin } } },
      { $group: { _id: { $dateToString: { format, date: '$createdAt' } }, nombre: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, periode: '$_id', nombre: 1 } },
    ]),
  ]);

  return { total, comparaison: totalPrecedent, granularite: parMois ? 'mois' : 'jour', points };
}

/**
 * Analyse CA / Publicité / Dépenses (retour V0.1) : trois courbes sur les mêmes
 * périodes pour visualiser d'un coup d'œil la relation entre l'effort publicitaire,
 * les dépenses totales et le chiffre d'affaires généré. Les catégories de dépense
 * "publicité" sont repérées par leur nom (elles sont librement renommables/
 * ajoutables par SANAA — voir catalogue.service.js — donc pas d'ID en dur).
 */
async function analyseCaPubDepenses({ pays_id, periode, date, periode_debut, periode_fin, devise_affichage }) {
  const { debut, fin } = resoudrePeriode(periode, { date, periode_debut, periode_fin });
  const paysListe = await paysCiblesPourAgregation(pays_id);
  const nombreJours = (fin.getTime() - debut.getTime()) / (24 * 60 * 60 * 1000);
  const parMois = nombreJours > 62;
  const deviseCible = pays_id ? null : await resoudreDeviseCible(devise_affichage);
  const obtenirTaux = creerCacheTaux();

  const categories = await CategorieDepense.find().select('nom').lean();
  const idsPublicite = new Set(categories.filter((c) => /publicit/i.test(c.nom)).map((c) => String(c._id)));

  const points = new Map();
  function accumuler(cle, champ, montant) {
    const entree = points.get(cle) || { ca: toDecimal(0), publicite: toDecimal(0), depenses: toDecimal(0) };
    entree[champ] = entree[champ].plus(montant);
    points.set(cle, entree);
  }

  for (const pays of paysListe) {
    const statutsInclus = pays.ca_statuts_inclus || ['Confirmee'];
    const [commandes, depenses] = await Promise.all([
      Commande.find({ pays_id: pays._id, createdAt: { $gte: debut, $lte: fin }, statut_commande: { $in: statutsInclus } })
        .select('total createdAt').lean(),
      Depense.find({ pays_id: pays._id, date: { $gte: debut, $lte: fin } }).select('montant categorie_id date').lean(),
    ]);

    for (const c of commandes) {
      let montant = toDecimal(c.total);
      if (deviseCible) {
        const taux = await obtenirTaux(pays.devise_locale_id, deviseCible._id, c.createdAt);
        if (taux === null) continue;
        montant = montant.times(taux);
      }
      accumuler(formaterDatePeriode(c.createdAt, parMois), 'ca', montant);
    }
    for (const d of depenses) {
      let montant = toDecimal(d.montant);
      if (deviseCible) {
        const taux = await obtenirTaux(pays.devise_locale_id, deviseCible._id, d.date);
        if (taux === null) continue;
        montant = montant.times(taux);
      }
      const cle = formaterDatePeriode(d.date, parMois);
      accumuler(cle, 'depenses', montant);
      if (idsPublicite.has(String(d.categorie_id))) accumuler(cle, 'publicite', montant);
    }
  }

  const resultats = [...points.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([periode2, v]) => ({
      periode: periode2,
      ca: Number(v.ca.toFixed(2)),
      publicite: Number(v.publicite.toFixed(2)),
      depenses: Number(v.depenses.toFixed(2)),
    }));

  return { granularite: parMois ? 'mois' : 'jour', devise: deviseCible ? deviseCible.code : null, points: resultats };
}

module.exports = {
  kpis,
  comparaisonPays,
  performanceProduits,
  evolutionCA,
  repartitionLivraison,
  repartitionCanal,
  nouveauxClients,
  analyseCaPubDepenses,
};
