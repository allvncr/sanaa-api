const Fournisseur = require('../models/Fournisseur');
const CommandeFournisseur = require('../models/CommandeFournisseur');
const ApiError = require('../utils/ApiError');
const { toDecimal, toDecimal128, multiply } = require('../utils/money');

async function lister() {
  return Fournisseur.find().sort({ nom: 1 });
}

async function creer(data) {
  return Fournisseur.create(data);
}

async function listerCommandes({ pays_destination_id, statut } = {}) {
  const filtre = {};
  if (pays_destination_id) filtre.pays_destination_id = pays_destination_id;
  if (statut) filtre.statut = statut;
  return CommandeFournisseur.find(filtre).populate('fournisseur_id pays_destination_id').sort({ createdAt: -1 });
}

async function creerCommande(data) {
  const lignes = data.lignes || [];
  const coutLignes = lignes.reduce((acc, l) => acc.plus(multiply(l.cout_unitaire, l.quantite)), toDecimal(0));
  const coutTotal = coutLignes.plus(toDecimal(data.cout_transport || 0));
  return CommandeFournisseur.create({
    ...data,
    lignes,
    cout_total: toDecimal128(coutTotal),
  });
}

async function changerStatut(id, statut) {
  const cmd = await CommandeFournisseur.findByIdAndUpdate(id, { statut }, { new: true, runValidators: true });
  if (!cmd) throw ApiError.notFound('Commande fournisseur introuvable');
  return cmd;
}

module.exports = { lister, creer, listerCommandes, creerCommande, changerStatut };
