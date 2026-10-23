const mongoose = require('mongoose');
const { Schema } = mongoose;
const paysScopePlugin = require('../plugins/paysScopePlugin');

// Trace d'une relance WhatsApp envoyée à un client (retour du 23/10/2026) : sert
// uniquement à ne pas proposer deux fois la même relance (délai de répit par
// type, voir relance.service). Aucun message n'est stocké.
const RelanceSchema = new Schema(
  {
    pays_id: { type: Schema.Types.ObjectId, ref: 'Pays', required: true, index: true },
    type: { type: String, enum: ['reste_a_payer', 'avis', 'fidelisation'], required: true },
    client_id: { type: Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    // Absente pour la fidélisation (relance d'un client, pas d'une commande).
    commande_id: { type: Schema.Types.ObjectId, ref: 'Commande', index: true },
    cree_par: { type: Schema.Types.ObjectId, ref: 'Utilisateur' },
  },
  { timestamps: true }
);

RelanceSchema.index({ type: 1, commande_id: 1, createdAt: -1 });
RelanceSchema.index({ type: 1, client_id: 1, createdAt: -1 });

RelanceSchema.plugin(paysScopePlugin);

module.exports = mongoose.model('Relance', RelanceSchema);
