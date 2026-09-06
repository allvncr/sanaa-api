const Alerte = require('../models/Alerte');

async function lister({ pays_id, statut } = {}) {
  const filtre = {};
  if (pays_id) filtre.pays_id = pays_id;
  if (statut) filtre.statut = statut;
  return Alerte.find(filtre).sort({ createdAt: -1 });
}

async function creer(data) {
  return Alerte.create(data);
}

async function marquer(id, statut) {
  return Alerte.findByIdAndUpdate(id, { statut }, { new: true });
}

module.exports = { lister, creer, marquer };
