const Pays = require('../models/Pays');
const ApiError = require('../utils/ApiError');
const { construireMoyensPaiementStandard } = require('../utils/moyensPaiementStandard');

async function lister({ actif } = {}) {
  const filtre = {};
  if (actif !== undefined) filtre.actif = actif === 'true' || actif === true;
  return Pays.find(filtre).populate('devise_locale_id').sort({ nom: 1 });
}

async function obtenir(id) {
  const pays = await Pays.findById(id).populate('devise_locale_id');
  if (!pays) throw ApiError.notFound('Pays introuvable');
  return pays;
}

// Les moyens de paiement ne sont plus saisis librement (retour V0.1) : tout
// pays reçoit systématiquement les quatre options standard, quelle que soit la
// valeur envoyée par le client de l'API pour ce champ.
async function creer(data) {
  const { moyens_paiement, ...reste } = data;
  return Pays.create({ ...reste, moyens_paiement: construireMoyensPaiementStandard() });
}

async function modifier(id, data) {
  const { moyens_paiement, ...reste } = data; // toujours ignoré à la modification, voir creer()
  const pays = await Pays.findByIdAndUpdate(id, reste, { new: true, runValidators: true });
  if (!pays) throw ApiError.notFound('Pays introuvable');
  return pays;
}

/**
 * Suppression d'un pays — refusée si des données lui sont déjà rattachées
 * (commandes, clients, dépenses, stock, achats fournisseurs, campagnes), pour
 * ne jamais casser silencieusement l'historique financier. Un pays inutilisé
 * peut être supprimé définitivement ; sinon, `modifier(id, { actif: false })`
 * reste la voie pour le désactiver sans perte de données.
 */
async function supprimer(id) {
  const pays = await Pays.findById(id);
  if (!pays) throw ApiError.notFound('Pays introuvable');

  const [Commande, Client, Depense, StockMouvement, CommandeFournisseur, CampagneMarketing] = [
    require('../models/Commande'),
    require('../models/Client'),
    require('../models/Depense'),
    require('../models/StockMouvement'),
    require('../models/CommandeFournisseur'),
    require('../models/CampagneMarketing'),
  ];

  const verifications = [
    { modele: Commande, champ: 'pays_id', libelle: 'des commandes' },
    { modele: Client, champ: 'pays_id', libelle: 'des clients' },
    { modele: Depense, champ: 'pays_id', libelle: 'des dépenses' },
    { modele: StockMouvement, champ: 'pays_id', libelle: 'des mouvements de stock' },
    { modele: CommandeFournisseur, champ: 'pays_destination_id', libelle: "des commandes fournisseur" },
    { modele: CampagneMarketing, champ: 'pays_id', libelle: 'des campagnes marketing' },
  ];

  for (const { modele, champ, libelle } of verifications) {
    const existe = await modele.exists({ [champ]: id });
    if (existe) {
      throw ApiError.conflict(
        `Suppression impossible : ${libelle} sont déjà rattachées à ce pays. Désactivez-le plutôt (modifier → actif = false).`
      );
    }
  }

  await Pays.deleteOne({ _id: id });
  return { supprime: true };
}

module.exports = { lister, obtenir, creer, modifier, supprimer };
