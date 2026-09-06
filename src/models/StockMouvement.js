const mongoose = require('mongoose');
const { Schema } = mongoose;
const paysScopePlugin = require('../plugins/paysScopePlugin');

// Journal append-only (section 3.0, 3.6) — le niveau de stock courant est calculé
// par agrégation à partir de ce journal, jamais stocké de façon autoritaire.
const StockMouvementSchema = new Schema(
  {
    produit_id: { type: Schema.Types.ObjectId, ref: 'Produit', required: true, index: true },
    variante_id: { type: Schema.Types.ObjectId, required: true, index: true },
    pays_id: { type: Schema.Types.ObjectId, ref: 'Pays', required: true, index: true },
    type: {
      type: String,
      enum: ['entree', 'sortie', 'reservation', 'transfert_sortant', 'transfert_entrant', 'ajustement'],
      required: true,
    },
    quantite: { type: Number, required: true },
    pays_lie_id: { type: Schema.Types.ObjectId, ref: 'Pays' },
    reference_commande_id: { type: Schema.Types.ObjectId, ref: 'Commande' },
    commentaire: { type: String },
    saisi_par: { type: Schema.Types.ObjectId, ref: 'Utilisateur' },
    date: { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: true }
);

StockMouvementSchema.index({ pays_id: 1, produit_id: 1, variante_id: 1, date: -1 });
StockMouvementSchema.plugin(paysScopePlugin);

module.exports = mongoose.model('StockMouvement', StockMouvementSchema);
