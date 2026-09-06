const Depense = require('../models/Depense');
const CategorieDepense = require('../models/CategorieDepense');
const ApiError = require('../utils/ApiError');

async function listerCategories() {
  return CategorieDepense.find().sort({ nom: 1 });
}

async function creerCategorie(data) {
  return CategorieDepense.create(data);
}

async function lister({ pays_id, categorie_id, date_de, date_a } = {}) {
  const filtre = {};
  if (pays_id) filtre.pays_id = pays_id;
  if (categorie_id) filtre.categorie_id = categorie_id;
  if (date_de || date_a) {
    filtre.date = {};
    if (date_de) filtre.date.$gte = new Date(date_de);
    if (date_a) filtre.date.$lte = new Date(date_a);
  }
  return Depense.find(filtre).populate('categorie_id fournisseur_id').sort({ date: -1 });
}

async function creer(data) {
  return Depense.create(data);
}

async function valider(id, utilisateurId) {
  const depense = await Depense.findByIdAndUpdate(
    id,
    { statut: 'validee', valide_par: utilisateurId },
    { new: true }
  );
  if (!depense) throw ApiError.notFound('Dépense introuvable');
  return depense;
}

module.exports = { listerCategories, creerCategorie, lister, creer, valider };
