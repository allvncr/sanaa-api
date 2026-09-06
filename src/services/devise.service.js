const Devise = require('../models/Devise');
const TauxChange = require('../models/TauxChange');
const { toDecimal } = require('../utils/money');

async function lister() {
  return Devise.find().sort({ code: 1 });
}

async function creer(data) {
  return Devise.create(data);
}

async function listerTaux({ devise_source_id, devise_cible_id, date_de, date_a } = {}) {
  const filtre = {};
  if (devise_source_id) filtre.devise_source_id = devise_source_id;
  if (devise_cible_id) filtre.devise_cible_id = devise_cible_id;
  if (date_de || date_a) {
    filtre.date_effet = {};
    if (date_de) filtre.date_effet.$gte = new Date(date_de);
    if (date_a) filtre.date_effet.$lte = new Date(date_a);
  }
  return TauxChange.find(filtre).sort({ date_effet: -1 }).populate('devise_source_id devise_cible_id');
}

async function ajouterTaux(data, utilisateurId) {
  return TauxChange.create({ ...data, saisi_par: utilisateurId, date_effet: data.date_effet || new Date() });
}

/**
 * Renvoie le taux applicable entre deux devises à une date donnée (le plus récent
 * taux dont date_effet <= date) — section 2.5, 10 : jamais un taux unique global,
 * toujours celui en vigueur à la date de la transaction consolidée.
 */
async function tauxApplicable(deviseSourceId, deviseCibleId, date) {
  if (String(deviseSourceId) === String(deviseCibleId)) return toDecimal(1);
  const taux = await TauxChange.findOne({
    devise_source_id: deviseSourceId,
    devise_cible_id: deviseCibleId,
    date_effet: { $lte: date || new Date() },
  }).sort({ date_effet: -1 });
  if (!taux) return null;
  return toDecimal(taux.taux);
}

module.exports = { lister, creer, listerTaux, ajouterTaux, tauxApplicable };
