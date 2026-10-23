const mongoose = require('mongoose');
const Commande = require('../models/Commande');
const Client = require('../models/Client');
const Relance = require('../models/Relance');
const ApiError = require('../utils/ApiError');

const JOUR_MS = 24 * 60 * 60 * 1000;
const LIMITE = 200;

// Fenêtres et délais de répit (retour du 23/10/2026) :
// - reste à payer : colis livré avec un solde dû ; pas deux relances en moins de 3 jours.
// - avis : 2 à 14 jours après la livraison, une seule fois par commande.
// - fidélisation : dernière commande vieille de 30 à 90 jours ; pas deux relances en moins de 30 jours.
const REGLES = {
  reste_a_payer: { repit_jours: 3 },
  avis: { apres_livraison_min: 2, apres_livraison_max: 14, repit_jours: null },
  fidelisation: { inactif_min: 30, inactif_max: 90, repit_jours: 30 },
};

const joursDepuis = (date, maintenant) => Math.floor((maintenant.getTime() - new Date(date).getTime()) / JOUR_MS);

/** Ids déjà relancés (même type) dans le délai de répit — `repitJours` null = jamais plus. */
async function dejaRelances(type, champ, ids, repitJours, maintenant) {
  if (ids.length === 0) return new Set();
  const filtre = { type, [champ]: { $in: ids } };
  if (repitJours) filtre.createdAt = { $gte: new Date(maintenant.getTime() - repitJours * JOUR_MS) };
  const relances = await Relance.find(filtre).select(champ).lean();
  return new Set(relances.map((r) => String(r[champ])));
}

function ligne(c, client, jours, detail, extra = {}) {
  return {
    cle: extra.cle || String(c._id),
    commande_id: c._id ? String(c._id) : null,
    client_id: client ? String(client._id) : null,
    numero: c.numero || null,
    nom: client ? client.nom || null : null,
    telephone: client ? client.telephone_whatsapp || null : null,
    pays_id: String(c.pays_id),
    jours,
    detail,
    montant: extra.montant === undefined ? null : extra.montant,
  };
}

async function resteAPayer(paysFiltre, maintenant) {
  const montantsPaiements = {
    $sum: {
      $map: {
        input: { $filter: { input: '$paiements', cond: { $ne: ['$$this.annule', true] } } },
        in: '$$this.montant',
      },
    },
  };
  const brut = await Commande.aggregate([
    { $match: { ...paysFiltre, statut_commande: 'Confirmee', statut_livraison: 'Livree' } },
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
  await Commande.populate(brut, { path: 'client_id', select: 'nom telephone_whatsapp' });
  const exclus = await dejaRelances('reste_a_payer', 'commande_id', brut.map((c) => c._id), REGLES.reste_a_payer.repit_jours, maintenant);
  return brut
    .filter((c) => !exclus.has(String(c._id)))
    .map((c) => {
      const j = joursDepuis(c.date_livraison || c.updatedAt, maintenant);
      return ligne(c, c.client_id, j, `Livrée il y a ${j} j`, { montant: Number(c.reste.toString()) });
    });
}

async function avis(paysFiltre, maintenant) {
  const { apres_livraison_min: min, apres_livraison_max: max } = REGLES.avis;
  const commandes = await Commande.find({
    ...paysFiltre,
    statut_commande: 'Confirmee',
    statut_livraison: 'Livree',
    date_livraison: { $gte: new Date(maintenant.getTime() - max * JOUR_MS), $lte: new Date(maintenant.getTime() - min * JOUR_MS) },
  })
    .select('numero client_id pays_id date_livraison')
    .populate('client_id', 'nom telephone_whatsapp')
    .lean();
  const exclus = await dejaRelances('avis', 'commande_id', commandes.map((c) => c._id), REGLES.avis.repit_jours, maintenant);
  return commandes
    .filter((c) => !exclus.has(String(c._id)))
    .map((c) => {
      const j = joursDepuis(c.date_livraison, maintenant);
      return ligne(c, c.client_id, j, `Livrée il y a ${j} j`);
    });
}

async function fidelisation(paysFiltre, maintenant) {
  const { inactif_min: min, inactif_max: max } = REGLES.fidelisation;
  const groupes = await Commande.aggregate([
    { $match: { ...paysFiltre, statut_commande: 'Confirmee' } },
    {
      $group: {
        _id: '$client_id',
        derniere: { $max: '$createdAt' },
        nombre: { $sum: 1 },
        pays_id: { $first: '$pays_id' },
        numero: { $last: '$numero' },
      },
    },
    {
      $match: {
        derniere: { $gte: new Date(maintenant.getTime() - max * JOUR_MS), $lte: new Date(maintenant.getTime() - min * JOUR_MS) },
      },
    },
  ]);
  await Commande.populate(groupes, { path: '_id', model: 'Client', select: 'nom telephone_whatsapp' });
  const clients = groupes.filter((g) => g._id && g._id.telephone_whatsapp);
  const exclus = await dejaRelances('fidelisation', 'client_id', clients.map((g) => g._id._id), REGLES.fidelisation.repit_jours, maintenant);
  return clients
    .filter((g) => !exclus.has(String(g._id._id)))
    .map((g) => {
      const j = joursDepuis(g.derniere, maintenant);
      return ligne(
        { _id: null, numero: g.numero, pays_id: g.pays_id },
        g._id,
        j,
        `Dernière commande il y a ${j} j · ${g.nombre} commande${g.nombre > 1 ? 's' : ''}`,
        { cle: String(g._id._id) }
      );
    });
}

const TYPES = { reste_a_payer: resteAPayer, avis, fidelisation };

/**
 * Relances WhatsApp à proposer (retour du 23/10/2026). Chaque ligne est un
 * client à contacter ; l'envoi reste manuel (lien wa.me ouvert côté frontend),
 * puis `enregistrer` mémorise la relance pour ne pas la reproposer.
 */
async function lister({ type, pays_id } = {}) {
  const fonction = TYPES[type];
  if (!fonction) throw ApiError.badRequest('Type de relance invalide (reste_a_payer, avis ou fidelisation)');
  const paysFiltre = pays_id ? { pays_id: new mongoose.Types.ObjectId(String(pays_id)) } : {};
  const lignes = await fonction(paysFiltre, new Date());
  const triees = lignes.sort((a, b) => b.jours - a.jours);
  return { type, total: triees.length, items: triees.slice(0, LIMITE) };
}

async function enregistrer({ type, commande_id, client_id }, req) {
  if (!TYPES[type]) throw ApiError.badRequest('Type de relance invalide');
  if (!client_id) throw ApiError.badRequest('client_id requis');
  if (type !== 'fidelisation' && !commande_id) throw ApiError.badRequest('commande_id requis pour ce type de relance');

  let pays_id;
  if (commande_id) {
    const commande = await Commande.findById(commande_id).select('pays_id');
    if (!commande) throw ApiError.notFound('Commande introuvable');
    pays_id = commande.pays_id;
  } else {
    const client = await Client.findById(client_id).select('pays_id');
    if (!client) throw ApiError.notFound('Client introuvable');
    pays_id = client.pays_id;
  }
  const relance = await Relance.create({
    pays_id,
    type,
    client_id,
    commande_id: commande_id || undefined,
    cree_par: req && req.user && req.user.id,
  });
  return { _id: relance._id, type, createdAt: relance.createdAt };
}

module.exports = { lister, enregistrer, REGLES };
