const mongoose = require('mongoose');
const { Schema } = mongoose;
const paysScopePlugin = require('../plugins/paysScopePlugin');
const activityLogPlugin = require('../plugins/activityLogPlugin');

// Livraison PRÉVUE : rattache une commande à un jour du calendrier des livraisons.
// Le suivi réel (livrée, retour…) reste porté par commande.statut_livraison ; ici on
// ne garde que la promesse "cette commande doit être livrée tel jour". Un report se
// traduit par la suppression de l'entrée puis sa recréation à une autre date.
const LivraisonSchema = new Schema(
  {
    commande_id: { type: Schema.Types.ObjectId, ref: 'Commande', required: true, index: true },
    pays_id: { type: Schema.Types.ObjectId, ref: 'Pays', required: true, index: true },
    // Jour calendaire "yyyy-MM-dd" (et non un Date) : pas de décalage de fuseau horaire.
    jour: { type: String, required: true, match: [/^\d{4}-\d{2}-\d{2}$/, 'Date de livraison invalide'], index: true },
    cree_par: { type: Schema.Types.ObjectId, ref: 'Utilisateur' },
  },
  { timestamps: true }
);

LivraisonSchema.index({ commande_id: 1, jour: 1 }, { unique: true });
LivraisonSchema.index({ pays_id: 1, jour: 1 });

LivraisonSchema.plugin(paysScopePlugin);
LivraisonSchema.plugin(activityLogPlugin, { entite: 'Livraison' });

module.exports = mongoose.model('Livraison', LivraisonSchema);
