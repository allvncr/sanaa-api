const mongoose = require('mongoose');
const Commande = require('../models/Commande');
const Depense = require('../models/Depense');
const Pays = require('../models/Pays');
const Devise = require('../models/Devise');
const deviseService = require('./devise.service');
const { toDecimal, sum } = require('../utils/money');
const { resoudrePeriode } = require('../utils/periode');

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
 * au taux applicable à la date de chaque transaction.
 */
async function comparaisonPays({ periode, date, periode_debut, periode_fin, devise_affichage }) {
  const { debut, fin } = resoudrePeriode(periode, { date, periode_debut, periode_fin });
  const paysListe = await Pays.find({ actif: true });
  const codeCible = devise_affichage || require('../config/env').deviseReferenceGlobale;
  const deviseCible = await Devise.findOne({ code: codeCible.toUpperCase() });
  if (!deviseCible) throw new Error(`Devise d'affichage inconnue : ${codeCible}`);

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

async function performanceProduits({ pays_id, periode, date, periode_debut, periode_fin }) {
  const { debut, fin } = resoudrePeriode(periode, { date, periode_debut, periode_fin });
  const filtre = { createdAt: { $gte: debut, $lte: fin } };
  if (pays_id) filtre.pays_id = pays_id;

  const resultats = await Commande.aggregate([
    { $match: filtre },
    { $unwind: '$lignes' },
    {
      $group: {
        _id: { produit_id: '$lignes.produit_id' },
        quantite_vendue: { $sum: '$lignes.quantite' },
        chiffre_affaires: { $sum: { $toDouble: '$lignes.sous_total' } },
      },
    },
    { $sort: { chiffre_affaires: -1 } },
    { $limit: 20 },
    {
      $lookup: { from: 'produits', localField: '_id.produit_id', foreignField: '_id', as: 'produit' },
    },
    { $unwind: { path: '$produit', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        produit_id: '$_id.produit_id',
        nom: '$produit.nom',
        quantite_vendue: 1,
        chiffre_affaires: { $round: ['$chiffre_affaires', 2] },
      },
    },
  ]);

  return resultats;
}

/**
 * Courbe d'évolution du CA sur la période (retour V0.1). Granularité
 * automatique : par jour si la période fait 62 jours ou moins, par mois
 * au-delà (ex. une année entière), pour rester lisible sur un graphique.
 */
async function evolutionCA({ pays_id, periode, date, periode_debut, periode_fin }) {
  if (!pays_id) throw new Error('pays_id requis');
  const { debut, fin } = resoudrePeriode(periode, { date, periode_debut, periode_fin });
  const pays = await Pays.findById(pays_id);
  if (!pays) throw new Error('Pays introuvable');
  const statutsInclus = pays.ca_statuts_inclus || ['Confirmee'];

  const nombreJours = (fin.getTime() - debut.getTime()) / (24 * 60 * 60 * 1000);
  const parMois = nombreJours > 62;
  const format = parMois ? '%Y-%m' : '%Y-%m-%d';

  const resultats = await Commande.aggregate([
    { $match: { pays_id: pays._id, createdAt: { $gte: debut, $lte: fin }, statut_commande: { $in: statutsInclus } } },
    {
      $group: {
        _id: { $dateToString: { format, date: '$createdAt' } },
        ca: { $sum: { $toDouble: '$total' } },
        nombre_commandes: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, periode: '$_id', ca: { $round: ['$ca', 2] }, nombre_commandes: 1 } },
  ]);

  return { granularite: parMois ? 'mois' : 'jour', points: resultats };
}

/**
 * Répartition des commandes par statut de livraison sur la période (retour
 * V0.1) — sert le graphique "proportion reçue / livrée / en cours / retour".
 */
async function repartitionLivraison({ pays_id, periode, date, periode_debut, periode_fin }) {
  if (!pays_id) throw new Error('pays_id requis');
  const { debut, fin } = resoudrePeriode(periode, { date, periode_debut, periode_fin });

  const resultats = await Commande.aggregate([
    { $match: { pays_id: new mongoose.Types.ObjectId(pays_id), createdAt: { $gte: debut, $lte: fin } } },
    { $group: { _id: '$statut_livraison', nombre: { $sum: 1 } } },
  ]);

  const total = resultats.reduce((acc, r) => acc + r.nombre, 0) || 1;
  return resultats.map((r) => ({
    statut: r._id,
    nombre: r.nombre,
    pourcentage: Number(((r.nombre / total) * 100).toFixed(2)),
  }));
}

module.exports = { kpis, comparaisonPays, performanceProduits, evolutionCA, repartitionLivraison };
