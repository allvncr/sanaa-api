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

  // Retour du 09/10/2026 : le CA compte TOUTES les commandes passées sur la
  // période (net de réduction), pas seulement les livrées — il doit rester fixe
  // d'un jour à l'autre pour un mois donné. Perçu et reste portent sur ces
  // mêmes commandes, donc CA = perçu + reste + surcoûts de livraison.
  const commandesCA = commandes.filter((c) => statutsInclus.includes(c.statut_commande));
  const bilans = commandesCA.map((c) => {
    const net = toDecimal(c.total).minus(toDecimal(c.reduction || 0));
    const paye = sum(c.paiements.filter((p) => !p.annule).map((p) => p.montant));
    const surcout = toDecimal(c.ajustement_livraison || 0);
    const percu = paye.lt(net) ? paye : net; // un surplus versé pour les frais de livraison n'est pas du CA
    const reste = net.minus(surcout).minus(paye);
    return { c, net, percu, surcout, reste: reste.isNegative() ? toDecimal(0) : reste };
  });
  const ca = { montant: sum(bilans.map((b) => b.net)), devise_id: pays.devise_locale_id };

  const paiementsDatés = bilans.map((b) => ({ montant: b.percu, date: b.c.createdAt }));
  const encaissements = { montant: sum(paiementsDatés.map((p) => p.montant)), devise_id: pays.devise_locale_id };

  const resteARecevoir = sum(bilans.map((b) => b.reste));

  // Écart de frais de livraison supporté par SANAA : un coût réel, compté avec
  // les dépenses pour que le bénéfice reflète l'argent réellement gardé.
  const surcoutsLivraison = sum(bilans.map((b) => b.surcout));
  const depenses = await Depense.find({ pays_id: paysId, date: { $gte: debut, $lte: fin } });
  const totalDepenses = {
    montant: sum(depenses.map((d) => d.montant)).plus(surcoutsLivraison),
    devise_id: pays.devise_locale_id,
  };

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
    // Mêmes commandes que le CA (annulées exclues) : le panier moyen = CA / commandes
    // reste cohérent. Articles = total des pièces (une commande peut en contenir plusieurs).
    nombre_commandes: commandesCA.length,
    nombre_articles: commandesCA.reduce((somme, c) => somme + (c.lignes || []).reduce((n, l) => n + Number(l.quantite || 0), 0), 0),
    taux_livraison_pct: ((livrees / totalCommandes) * 100).toFixed(2),
    taux_annulation_pct: ((annulees / totalCommandes) * 100).toFixed(2),
    taux_retour_pct: ((retours / totalCommandes) * 100).toFixed(2),
    _paiements: paiementsDatés,
    surcouts_livraison: surcoutsLivraison.toFixed(2),
    _commandesCA: bilans.map((b) => ({ montant: b.net, date: b.c.createdAt })),
    _depenses: [
      ...depenses.map((d) => ({ montant: d.montant, date: d.date })),
      ...bilans.filter((b) => !b.surcout.isZero()).map((b) => ({ montant: b.surcout, date: b.c.createdAt })),
    ],
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
      nombre_articles: brut.nombre_articles,
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
  const { debut, fin, precedent } = resoudrePeriode(periode, { date, periode_debut, periode_fin });
  const paysListe = await paysCiblesPourAgregation(pays_id);
  const nombreJours = (fin.getTime() - debut.getTime()) / (24 * 60 * 60 * 1000);
  const parMois = nombreJours > 62;
  const deviseCible = pays_id ? null : await resoudreDeviseCible(devise_affichage);
  const obtenirTaux = creerCacheTaux();

  // CA et nombre de commandes par jour (ou par mois) sur une période donnée.
  async function cumuler(du, au) {
    const points = new Map();
    for (const pays of paysListe) {
      const statutsInclus = pays.ca_statuts_inclus || ['Confirmee'];
      const commandes = await Commande.find({
        pays_id: pays._id,
        createdAt: { $gte: du, $lte: au },
        statut_commande: { $in: statutsInclus },
      }).select('total reduction createdAt').lean();

      for (const c of commandes) {
        let montant = toDecimal(c.total).minus(toDecimal(c.reduction || 0));
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
    return points;
  }

  // Tous les jours (ou mois) de la période, y compris sans commande : un jour
  // à zéro doit apparaître comme tel et permet d'aligner la période précédente.
  // On s'arrête à aujourd'hui pour ne pas afficher de futur à zéro.
  function cles(du, au, jusquAMaintenant) {
    const limite = jusquAMaintenant ? Math.min(au.getTime(), Date.now()) : au.getTime();
    const liste = [];
    const d = new Date(Date.UTC(du.getUTCFullYear(), du.getUTCMonth(), parMois ? 1 : du.getUTCDate()));
    while (d.getTime() <= limite) {
      liste.push(formaterDatePeriode(d, parMois));
      if (parMois) d.setUTCMonth(d.getUTCMonth() + 1);
      else d.setUTCDate(d.getUTCDate() + 1);
    }
    return liste;
  }

  const cumulActuel = await cumuler(debut, fin);
  const clesActuelles = cles(debut, fin, true);
  const points = clesActuelles.map((cle) => {
    const v = cumulActuel.get(cle);
    return { periode: cle, ca: v ? Number(v.ca.toFixed(2)) : 0, nombre_commandes: v ? v.nombre_commandes : 0 };
  });

  // Période précédente équivalente, alignée jour par jour (1er jour contre 1er
  // jour…) et limitée à la longueur déjà écoulée de la période en cours.
  let comparaison = null;
  if (precedent) {
    const cumulPrecedent = await cumuler(precedent.debut, precedent.fin);
    const clesPrecedentes = cles(precedent.debut, precedent.fin, false);
    comparaison = clesActuelles.map((_, k) => {
      const cle = clesPrecedentes[k];
      const v = cle ? cumulPrecedent.get(cle) : null;
      return {
        periode: cle || null,
        ca: v ? Number(v.ca.toFixed(2)) : 0,
        nombre_commandes: v ? v.nombre_commandes : 0,
      };
    });
  }

  return {
    granularite: parMois ? 'mois' : 'jour',
    devise: deviseCible ? deviseCible.code : null,
    points,
    comparaison,
  };
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
 * Clients de la période, définis à partir des COMMANDES (retour du 28/10/2026) :
 * - nouveaux = clients dont la toute première commande tombe dans la période ;
 * - récurrents = clients qui commandent dans la période alors qu'ils avaient déjà
 *   commandé avant ;
 * - taux de repeat = récurrents / clients ayant commandé dans la période.
 * La date de création de la fiche client ne sert plus : elle comptait des clients
 * sans commande (fiches créées à la main, import…) et pouvait dépasser le nombre
 * de commandes. Mêmes commandes que le CA (annulées exclues).
 */
async function nouveauxClients({ pays_id, periode, date, periode_debut, periode_fin }) {
  const { debut, fin, precedent } = resoudrePeriode(periode, { date, periode_debut, periode_fin });
  const paysListe = await paysCiblesPourAgregation(pays_id);
  const nombreJours = (fin.getTime() - debut.getTime()) / (24 * 60 * 60 * 1000);
  const parMois = nombreJours > 62;
  const format = parMois ? '%Y-%m' : '%Y-%m-%d';
  const statutsParPays = paysListe.map((p) => ({ pays_id: p._id, statut_commande: { $in: p.ca_statuts_inclus || ['Confirmee'] } }));
  if (statutsParPays.length === 0) return { total: 0, comparaison: null, actifs: 0, recurrents: 0, taux_repeat: 0, taux_repeat_precedent: null, granularite: parMois ? 'mois' : 'jour', points: [] };

  async function compter(du, au) {
    const [r] = await Commande.aggregate([
      { $match: { $or: statutsParPays, createdAt: { $lte: au } } },
      { $group: { _id: '$client_id', premiere: { $min: '$createdAt' }, active: { $max: { $cond: [{ $gte: ['$createdAt', du] }, 1, 0] } } } },
      { $match: { active: 1 } },
      { $group: { _id: null, actifs: { $sum: 1 }, nouveaux: { $sum: { $cond: [{ $gte: ['$premiere', du] }, 1, 0] } } } },
    ]);
    const actifs = r ? r.actifs : 0;
    const nouveaux = r ? r.nouveaux : 0;
    const recurrents = actifs - nouveaux;
    return { actifs, nouveaux, recurrents, taux: actifs > 0 ? Number(((recurrents / actifs) * 100).toFixed(1)) : 0 };
  }

  const [actuel, avant, points] = await Promise.all([
    compter(debut, fin),
    precedent ? compter(precedent.debut, precedent.fin) : Promise.resolve(null),
    // Courbe : nouveaux clients par jour (ou par mois) = clients groupés par jour de leur première commande.
    Commande.aggregate([
      { $match: { $or: statutsParPays, createdAt: { $lte: fin } } },
      { $group: { _id: '$client_id', premiere: { $min: '$createdAt' } } },
      { $match: { premiere: { $gte: debut } } },
      { $group: { _id: { $dateToString: { format, date: '$premiere' } }, nombre: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, periode: '$_id', nombre: 1 } },
    ]),
  ]);

  return {
    total: actuel.nouveaux,
    comparaison: avant ? avant.nouveaux : null,
    actifs: actuel.actifs,
    recurrents: actuel.recurrents,
    taux_repeat: actuel.taux,
    taux_repeat_precedent: avant ? avant.taux : null,
    granularite: parMois ? 'mois' : 'jour',
    points,
  };
}

/**
 * Dépenses de la période réparties par type (catégorie de dépense) — retour du
 * 09/10/2026. Les surcoûts de livraison supportés par SANAA (frais gardés par
 * le livreur au-delà de ceux annoncés au client) sont un coût réel : ils
 * apparaissent comme un type à part, pour que le total corresponde à la carte
 * « Dépenses ». En mode « tous les pays », chaque montant est converti vers
 * devise_affichage au taux de sa date.
 */
async function repartitionDepenses({ pays_id, periode, date, periode_debut, periode_fin, devise_affichage }) {
  const { debut, fin } = resoudrePeriode(periode, { date, periode_debut, periode_fin });
  const paysListe = await paysCiblesPourAgregation(pays_id);
  const deviseCible = pays_id ? null : await resoudreDeviseCible(devise_affichage);
  const obtenirTaux = creerCacheTaux();

  const categories = await CategorieDepense.find().select('nom').lean();
  const nomParId = new Map(categories.map((c) => [String(c._id), c.nom]));
  const parType = new Map();
  const ajouter = (type, montant) => parType.set(type, (parType.get(type) || toDecimal(0)).plus(montant));

  for (const pays of paysListe) {
    const statutsInclus = pays.ca_statuts_inclus || ['Confirmee'];
    const [depenses, commandes] = await Promise.all([
      Depense.find({ pays_id: pays._id, date: { $gte: debut, $lte: fin } }).select('montant categorie_id date').lean(),
      Commande.find({
        pays_id: pays._id,
        createdAt: { $gte: debut, $lte: fin },
        statut_commande: { $in: statutsInclus },
        ajustement_livraison: { $nin: [null, 0] },
      }).select('ajustement_livraison createdAt').lean(),
    ]);

    const convertir = async (montant, dateRef) => {
      if (!deviseCible) return montant;
      const taux = await obtenirTaux(pays.devise_locale_id, deviseCible._id, dateRef);
      return taux === null ? null : montant.times(taux);
    };
    for (const d of depenses) {
      const m = await convertir(toDecimal(d.montant), d.date);
      if (m !== null) ajouter(nomParId.get(String(d.categorie_id)) || 'Autres', m);
    }
    for (const c of commandes) {
      const m = await convertir(toDecimal(c.ajustement_livraison), c.createdAt);
      if (m !== null) ajouter('Surcoût de livraison (pris en charge)', m);
    }
  }

  return [...parType.entries()]
    .map(([type, montant]) => ({ type, montant: Number(montant.toFixed(2)) }))
    .filter((r) => r.montant !== 0)
    .sort((a, b) => b.montant - a.montant);
}

/**
 * Suivi CA / Publicité / Confection (retour V0.1, repris le 22/10/2026) : trois
 * séries sur les mêmes périodes pour relier l'effort publicitaire et le coût de
 * confection au chiffre d'affaires généré (les dépenses totales écrasaient
 * l'échelle : on ne suit que les deux postes demandés). Les catégories de dépense
 * sont repérées par leur nom (librement renommables/ajoutables par SANAA — voir
 * catalogue.service.js — donc pas d'ID en dur) : publicité = « publicité », « pub »,
 * Facebook, TikTok, Meta ; confection = « confection ».
 */
const sansAccent = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const EST_PUBLICITE = /publicit|\bpub\b|facebook|tiktok|\bmeta\b/;
const EST_CONFECTION = /confection/;

async function analyseCaPubDepenses({ pays_id, periode, date, periode_debut, periode_fin, devise_affichage }) {
  const { debut, fin } = resoudrePeriode(periode, { date, periode_debut, periode_fin });
  const paysListe = await paysCiblesPourAgregation(pays_id);
  const nombreJours = (fin.getTime() - debut.getTime()) / (24 * 60 * 60 * 1000);
  const parMois = nombreJours > 62;
  const deviseCible = pays_id ? null : await resoudreDeviseCible(devise_affichage);
  const obtenirTaux = creerCacheTaux();

  const categories = await CategorieDepense.find().select('nom').lean();
  const idsParNom = (motif) => new Set(categories.filter((c) => motif.test(sansAccent(c.nom))).map((c) => String(c._id)));
  const idsPublicite = idsParNom(EST_PUBLICITE);
  const idsConfection = idsParNom(EST_CONFECTION);

  const points = new Map();
  function accumuler(cle, champ, montant) {
    const entree = points.get(cle) || { ca: toDecimal(0), publicite: toDecimal(0), confection: toDecimal(0) };
    entree[champ] = entree[champ].plus(montant);
    points.set(cle, entree);
  }

  for (const pays of paysListe) {
    const statutsInclus = pays.ca_statuts_inclus || ['Confirmee'];
    const [commandes, depenses] = await Promise.all([
      Commande.find({ pays_id: pays._id, createdAt: { $gte: debut, $lte: fin }, statut_commande: { $in: statutsInclus } })
        .select('total reduction createdAt').lean(),
      Depense.find({ pays_id: pays._id, date: { $gte: debut, $lte: fin } }).select('montant categorie_id date').lean(),
    ]);

    for (const c of commandes) {
      let montant = toDecimal(c.total).minus(toDecimal(c.reduction || 0));
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
      if (idsPublicite.has(String(d.categorie_id))) accumuler(cle, 'publicite', montant);
      else if (idsConfection.has(String(d.categorie_id))) accumuler(cle, 'confection', montant);
    }
  }

  const resultats = [...points.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([periode2, v]) => ({
      periode: periode2,
      ca: Number(v.ca.toFixed(2)),
      publicite: Number(v.publicite.toFixed(2)),
      confection: Number(v.confection.toFixed(2)),
    }));

  return { granularite: parMois ? 'mois' : 'jour', devise: deviseCible ? deviseCible.code : null, points: resultats };
}

/**
 * Rentabilité de la publicité (retour du 23/10/2026) : sur la période et la
 * période précédente équivalente, la dépense publicitaire totale, le coût de
 * pub par commande et le « retour sur pub » (CA généré pour 1 unité de pub).
 * Même définition du CA et de la « publicité » que le suivi CA / Pub /
 * Confection. Montants dans la devise du pays, ou dans devise_affichage en
 * mode « tous les pays » (conversion au taux de chaque jour).
 */
async function rentabilitePub({ pays_id, periode, date, periode_debut, periode_fin, devise_affichage }) {
  const { debut, fin, precedent } = resoudrePeriode(periode, { date, periode_debut, periode_fin });
  const paysListe = await paysCiblesPourAgregation(pays_id);
  const deviseCible = pays_id ? null : await resoudreDeviseCible(devise_affichage);
  const obtenirTaux = creerCacheTaux();

  const categories = await CategorieDepense.find().select('nom').lean();
  const idsPublicite = new Set(categories.filter((c) => EST_PUBLICITE.test(sansAccent(c.nom))).map((c) => String(c._id)));

  async function totaux(du, au) {
    let ca = toDecimal(0);
    let publicite = toDecimal(0);
    let commandesNb = 0;
    for (const pays of paysListe) {
      const statutsInclus = pays.ca_statuts_inclus || ['Confirmee'];
      const [commandes, depenses] = await Promise.all([
        Commande.find({ pays_id: pays._id, createdAt: { $gte: du, $lte: au }, statut_commande: { $in: statutsInclus } })
          .select('total reduction createdAt').lean(),
        Depense.find({ pays_id: pays._id, date: { $gte: du, $lte: au } }).select('montant categorie_id date').lean(),
      ]);
      const convertir = async (montant, dateRef) => {
        if (!deviseCible) return montant;
        const taux = await obtenirTaux(pays.devise_locale_id, deviseCible._id, dateRef);
        return taux === null ? null : montant.times(taux);
      };
      for (const c of commandes) {
        const m = await convertir(toDecimal(c.total).minus(toDecimal(c.reduction || 0)), c.createdAt);
        if (m === null) continue;
        ca = ca.plus(m);
        commandesNb += 1;
      }
      for (const d of depenses) {
        if (!idsPublicite.has(String(d.categorie_id))) continue;
        const m = await convertir(toDecimal(d.montant), d.date);
        if (m !== null) publicite = publicite.plus(m);
      }
    }
    return {
      publicite: Number(publicite.toFixed(2)),
      ca: Number(ca.toFixed(2)),
      nombre_commandes: commandesNb,
      cout_par_commande: commandesNb > 0 && publicite.gt(0) ? Number(publicite.div(commandesNb).toFixed(2)) : null,
      retour_sur_pub: publicite.gt(0) ? Number(ca.div(publicite).toFixed(2)) : null,
    };
  }

  return {
    devise: deviseCible ? deviseCible.code : null,
    ...(await totaux(debut, fin)),
    comparaison: precedent ? await totaux(precedent.debut, precedent.fin) : null,
  };
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
  rentabilitePub,
  repartitionDepenses,
};
