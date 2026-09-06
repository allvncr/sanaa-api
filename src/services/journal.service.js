const JournalActivite = require('../models/JournalActivite');

async function lister({ pays_id, entite, date_de, date_a, page = 1, limite = 50 } = {}) {
  const filtre = {};
  if (pays_id) filtre.pays_id = pays_id;
  if (entite) filtre.entite = entite;
  if (date_de || date_a) {
    filtre.date = {};
    if (date_de) filtre.date.$gte = new Date(date_de);
    if (date_a) filtre.date.$lte = new Date(date_a);
  }

  const skip = (Number(page) - 1) * Number(limite);
  const [items, total] = await Promise.all([
    JournalActivite.find(filtre)
      .populate('utilisateur_id', 'nom email')
      .sort({ date: -1 })
      .skip(skip)
      .limit(Number(limite)),
    JournalActivite.countDocuments(filtre),
  ]);

  return { items, meta: { page: Number(page), limite: Number(limite), total } };
}

module.exports = { lister };
