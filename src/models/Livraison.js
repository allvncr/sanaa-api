const mongoose = require('mongoose');
const { Schema } = mongoose;
const paysScopePlugin = require('../plugins/paysScopePlugin');
const activityLogPlugin = require('../plugins/activityLogPlugin');

// Livraison PRÉVUE : rattache une commande à un jour du calendrier des livraisons.
// Le statut de haut niveau (livrée, retour…) reste porté par commande.statut_livraison
// (source de vérité pour le reste à payer et le parcours client) ; les champs
// livree_le/livree_par/montant_recu/frais_livraison ci-dessous sont propres à CETTE
// tentative de livraison — retour V0.1, section "livreurs" (26/09/2026) : ils
// permettent un rapprochement quotidien (quelle somme un livreur a réellement
// remise) sans avoir à recroiser les paiements de chaque commande. Un report se
// traduit par la suppression de l'entrée puis sa recréation à une autre date.
const LivraisonSchema = new Schema(
  {
    commande_id: { type: Schema.Types.ObjectId, ref: 'Commande', required: true, index: true },
    pays_id: { type: Schema.Types.ObjectId, ref: 'Pays', required: true, index: true },
    // Jour calendaire "yyyy-MM-dd" (et non un Date) : pas de décalage de fuseau horaire.
    jour: { type: String, required: true, match: [/^\d{4}-\d{2}-\d{2}$/, 'Date de livraison invalide'], index: true },
    cree_par: { type: Schema.Types.ObjectId, ref: 'Utilisateur' },
    livree: { type: Boolean, default: false },
    livree_le: { type: Date },
    livree_par: { type: Schema.Types.ObjectId, ref: 'Utilisateur' },
    // Dénormalisé depuis le paiement "solde" enregistré au même moment (voir
    // livraison.service.marquerLivree) : évite de recroiser les paiements de la
    // commande pour un total quotidien par livreur.
    montant_recu: { type: Schema.Types.Decimal128, default: 0 },
    // Frais de livraison perçus par le livreur en plus du prix de la commande —
    // hors reste à payer : ne touche jamais commande.paiements, sert seulement
    // au rapprochement (section 6.2 étendue).
    frais_livraison: { type: Schema.Types.Decimal128, default: 0 },
  },
  { timestamps: true }
);

LivraisonSchema.index({ commande_id: 1, jour: 1 }, { unique: true });
LivraisonSchema.index({ pays_id: 1, jour: 1 });

LivraisonSchema.plugin(paysScopePlugin);
LivraisonSchema.plugin(activityLogPlugin, { entite: 'Livraison' });

module.exports = mongoose.model('Livraison', LivraisonSchema);
