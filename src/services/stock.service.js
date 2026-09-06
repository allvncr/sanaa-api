const mongoose = require('mongoose');
const StockMouvement = require('../models/StockMouvement');
const ApiError = require('../utils/ApiError');
const withTransaction = require('../utils/withTransaction');

/**
 * Niveau de stock courant = somme des mouvements du journal (section 3.6),
 * jamais stocké de façon autoritaire. Le "réservé" correspond aux mouvements de
 * type reservation, le "disponible" au solde global moins le réservé.
 */
async function niveaux({ pays_id, variante_id }) {
  const match = {};
  if (pays_id) match.pays_id = new mongoose.Types.ObjectId(pays_id);
  if (variante_id) match.variante_id = new mongoose.Types.ObjectId(variante_id);

  // stock_physique agrège tout SAUF les réservations (entrées, sorties,
  // ajustements, transferts) ; reserve agrège séparément les réservations. Les
  // deux sont additionnés ici plutôt que dans un seul $sum global pour éviter de
  // compter une réservation deux fois dans le disponible.
  const resultats = await StockMouvement.aggregate([
    { $match: match },
    {
      $group: {
        _id: { produit_id: '$produit_id', variante_id: '$variante_id', pays_id: '$pays_id' },
        stock_physique: {
          $sum: { $cond: [{ $eq: ['$type', 'reservation'] }, 0, '$quantite'] },
        },
        reserve: {
          $sum: { $cond: [{ $eq: ['$type', 'reservation'] }, { $multiply: ['$quantite', -1] }, 0] },
        },
      },
    },
    {
      $project: {
        _id: 0,
        produit_id: '$_id.produit_id',
        variante_id: '$_id.variante_id',
        pays_id: '$_id.pays_id',
        stock_total: '$stock_physique',
        reserve: '$reserve',
        disponible: { $subtract: ['$stock_physique', '$reserve'] },
      },
    },
    { $sort: { pays_id: 1 } },
  ]);

  return resultats;
}

async function listerMouvements({ pays_id, variante_id, produit_id, date_de, date_a } = {}) {
  const filtre = {};
  if (pays_id) filtre.pays_id = pays_id;
  if (variante_id) filtre.variante_id = variante_id;
  if (produit_id) filtre.produit_id = produit_id;
  if (date_de || date_a) {
    filtre.date = {};
    if (date_de) filtre.date.$gte = new Date(date_de);
    if (date_a) filtre.date.$lte = new Date(date_a);
  }
  return StockMouvement.find(filtre).sort({ date: -1 }).limit(500);
}

async function enregistrerMouvement(data, req) {
  return StockMouvement.create({ ...data, saisi_par: req.user.id, date: data.date || new Date() });
}

/**
 * Transfert entre deux pays (section 3, point 6 des clarifications) : génère deux
 * écritures liées (sortie côté source, entrée côté destination) dans une
 * transaction multi-documents.
 */
async function creerTransfert(data, req) {
  if (String(data.pays_source_id) === String(data.pays_destination_id)) {
    throw ApiError.badRequest('Le pays source et le pays destination doivent être différents');
  }

  return withTransaction(async (session) => {
    const sortie = await StockMouvement.create(
      [
        {
          produit_id: data.produit_id,
          variante_id: data.variante_id,
          pays_id: data.pays_source_id,
          type: 'transfert_sortant',
          quantite: -Math.abs(data.quantite),
          pays_lie_id: data.pays_destination_id,
          commentaire: data.commentaire,
          saisi_par: req.user.id,
        },
      ],
      { session }
    );

    const entree = await StockMouvement.create(
      [
        {
          produit_id: data.produit_id,
          variante_id: data.variante_id,
          pays_id: data.pays_destination_id,
          type: 'transfert_entrant',
          quantite: Math.abs(data.quantite),
          pays_lie_id: data.pays_source_id,
          commentaire: data.commentaire,
          saisi_par: req.user.id,
        },
      ],
      { session }
    );

    return { sortie: sortie[0], entree: entree[0] };
  });
}

module.exports = { niveaux, listerMouvements, enregistrerMouvement, creerTransfert };
