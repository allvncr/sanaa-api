const mongoose = require('mongoose');
const Commande = require('../models/Commande');
const Livraison = require('../models/Livraison');

// Délais communiqués aux clients (mêmes que la page de suivi) : 7 jours de
// fabrication après confirmation, 5 jours de transit après la fabrication.
const JOURS_FABRICATION = 7;
const JOURS_TRANSIT = 5;
const LIMITE_PAR_SECTION = 50;
const JOUR_MS = 24 * 60 * 60 * 1000;

const joursEntre = (depuis, jusqua) => Math.floor((jusqua.getTime() - depuis.getTime()) / JOUR_MS);
const ajouterJours = (date, n) => new Date(new Date(date).getTime() + n * JOUR_MS);
const cleJour = (date) => date.toISOString().slice(0, 10);
const formatFr = (date) => new Date(date).toISOString().slice(0, 10).split('-').reverse().join('/');

function ligne(c, jours, detail, montant) {
  const client = c.client_id || {};
  return {
    _id: c._id,
    numero: c.numero,
    client: client.nom || null,
    telephone: client.telephone_whatsapp || null,
    pays: c.pays_id && c.pays_id.code ? c.pays_id.code : null,
    jours,
    detail,
    montant: montant === undefined ? null : montant,
  };
}

function section(cle, titre, description, urgence, lignes) {
  const triees = lignes.sort((a, b) => b.jours - a.jours);
  return { cle, titre, description, urgence, total: triees.length, items: triees.slice(0, LIMITE_PAR_SECTION) };
}

/**
 * Tableau « À traiter aujourd'hui » (retour du 09/10/2026) : tout ce qui
 * demande une action de l'équipe, rangé par étape du parcours d'une commande —
 * envoi à l'usine, retards de fabrication et de transit, colis arrivés à
 * planifier, échecs à reprendre, livraisons prévues mais non confirmées, et
 * livrées pas encore soldées. Seules les commandes Confirmées comptent.
 */
async function aTraiter({ pays_id } = {}) {
  const maintenant = new Date();
  const aujourdhui = cleJour(maintenant);
  const filtrePays = pays_id ? { pays_id } : {};

  // Tout ce qui n'est pas encore livré.
  const enCours = await Commande.find({ ...filtrePays, statut_commande: 'Confirmee', statut_livraison: { $ne: 'Livree' } })
    .populate('client_id', 'nom telephone_whatsapp')
    .populate('pays_id', 'code')
    .lean();

  const aEnvoyer = [];
  const fabricationRetard = [];
  const arriveeRetard = [];
  const aPlanifier = [];
  const echecs = [];
  const enLivraison = [];

  for (const c of enCours) {
    const age = joursEntre(new Date(c.createdAt), maintenant);
    if (c.statut_livraison === 'Retour_echec') {
      const depuis = new Date(c.date_retour_echec || c.updatedAt);
      echecs.push(ligne(c, joursEntre(depuis, maintenant), `Échec il y a ${joursEntre(depuis, maintenant)} j — à replanifier`));
    } else if (c.statut_livraison === 'En_livraison') {
      enLivraison.push(c);
    } else if (c.statut_livraison === 'Recue_en_pays') {
      const depuis = new Date(c.date_recue_en_pays || c.updatedAt);
      const j = joursEntre(depuis, maintenant);
      aPlanifier.push(ligne(c, j, `Reçue en pays depuis ${j} j — pas encore planifiée en livraison`));
    } else if (c.statut_fabrication === 'A_produire') {
      aEnvoyer.push(ligne(c, age, `Confirmée il y a ${age} j — pas encore envoyée à l'usine`));
    } else if (c.statut_fabrication === 'En_fabrication') {
      const echeance = ajouterJours(c.createdAt, JOURS_FABRICATION);
      if (echeance < maintenant) {
        const retard = joursEntre(echeance, maintenant);
        fabricationRetard.push(ligne(c, retard, `Fabrication prévue le ${formatFr(echeance)} — ${retard} j de retard`));
      }
    } else if (c.statut_fabrication === 'Terminee') {
      // Fabriquée mais pas encore reçue en pays (A_expedier).
      const fin = c.date_fabrication_terminee ? new Date(c.date_fabrication_terminee) : ajouterJours(c.createdAt, JOURS_FABRICATION);
      const echeance = ajouterJours(fin, JOURS_TRANSIT);
      if (echeance < maintenant) {
        const retard = joursEntre(echeance, maintenant);
        arriveeRetard.push(ligne(c, retard, `Arrivée prévue le ${formatFr(echeance)} — ${retard} j de retard`));
      }
    } else if (c.statut_fabrication === 'Erreur') {
      aEnvoyer.push(ligne(c, age, 'Erreur de fabrication signalée — à traiter avec l\'usine'));
    }
  }

  // Livraisons prévues (calendrier) : retard = jour prévu dépassé sans confirmation.
  const livraisonsPrevues = enLivraison.length
    ? await Livraison.find({ commande_id: { $in: enLivraison.map((c) => c._id) } }).select('commande_id jour').lean()
    : [];
  const joursParCommande = new Map();
  for (const l of livraisonsPrevues) {
    const liste = joursParCommande.get(String(l.commande_id)) || [];
    liste.push(l.jour);
    joursParCommande.set(String(l.commande_id), liste);
  }
  const livraisonsNonConfirmees = [];
  let livraisonsAujourdhui = 0;
  for (const c of enLivraison) {
    const jours = (joursParCommande.get(String(c._id)) || []).sort();
    const dernier = jours[jours.length - 1];
    if (dernier === aujourdhui) livraisonsAujourdhui += 1;
    if (!dernier) {
      livraisonsNonConfirmees.push(ligne(c, 0, 'En livraison sans jour prévu au calendrier'));
    } else if (dernier < aujourdhui) {
      const retard = joursEntre(new Date(`${dernier}T00:00:00Z`), new Date(`${aujourdhui}T00:00:00Z`));
      livraisonsNonConfirmees.push(ligne(c, retard, `Prévue le ${dernier.split('-').reverse().join('/')} — non confirmée (${retard} j)`));
    }
  }

  // Livrées avec un reste à payer : calculé par la base (paiements non annulés).
  const montantsPaiements = {
    $sum: {
      $map: {
        input: { $filter: { input: '$paiements', cond: { $ne: ['$$this.annule', true] } } },
        in: '$$this.montant',
      },
    },
  };
  const matchImpayes = { statut_commande: 'Confirmee', statut_livraison: 'Livree' };
  if (pays_id) matchImpayes.pays_id = new mongoose.Types.ObjectId(String(pays_id));
  const impayesBruts = await Commande.aggregate([
    { $match: matchImpayes },
    {
      $addFields: {
        reste: {
          $subtract: [
            { $subtract: [{ $subtract: ['$total', { $ifNull: ['$reduction', 0] }] }, { $ifNull: ['$ajustement_livraison', 0] }] },
            montantsPaiements,
          ],
        },
      },
    },
    { $match: { reste: { $gt: 0 } } },
    { $project: { numero: 1, client_id: 1, pays_id: 1, reste: 1, date_livraison: 1, updatedAt: 1 } },
  ]);
  await Commande.populate(impayesBruts, [
    { path: 'client_id', select: 'nom telephone_whatsapp' },
    { path: 'pays_id', select: 'code' },
  ]);
  const impayes = impayesBruts.map((c) => {
    const depuis = new Date(c.date_livraison || c.updatedAt);
    const j = joursEntre(depuis, maintenant);
    return ligne(c, j, `Livrée il y a ${j} j — reste à payer`, Number(c.reste.toString()));
  });

  const sections = [
    section('echecs', 'Échecs de livraison à reprendre', 'Le livreur n\'a pas pu livrer : à replanifier au calendrier.', 'haute', echecs),
    section('livraisons_non_confirmees', 'Livraisons prévues non confirmées', 'Le jour prévu est passé sans confirmation du livreur.', 'haute', livraisonsNonConfirmees),
    section('a_planifier', 'Reçues en pays, à planifier en livraison', 'Colis arrivés : à placer sur le calendrier des livraisons.', 'normale', aPlanifier),
    section('impayes', 'Livrées avec un reste à payer', 'Argent encore dû sur des colis déjà livrés.', 'haute', impayes),
    section('arrivee_retard', 'Colis non reçus en retard', `Fabrication terminée mais pas reçue en pays au-delà de ${JOURS_TRANSIT} jours de transit.`, 'normale', arriveeRetard),
    section('fabrication_retard', 'Fabrication en retard', `En fabrication depuis plus de ${JOURS_FABRICATION} jours.`, 'normale', fabricationRetard),
    section('a_envoyer', 'À envoyer à l\'usine', 'Confirmées et encore « À produire » (ou en erreur de fabrication).', 'normale', aEnvoyer),
  ];

  return {
    date: aujourdhui,
    total: sections.reduce((s, x) => s + x.total, 0),
    livraisons_aujourdhui: livraisonsAujourdhui,
    sections,
  };
}

module.exports = { aTraiter };
