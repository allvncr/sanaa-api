const mongoose = require('mongoose');
const { Schema } = mongoose;
const paysScopePlugin = require('../plugins/paysScopePlugin');

const AlerteSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['stock_faible', 'commande_bloquee', 'commande_non_confirmee', 'livraison_retard', 'budget_anormal'],
      required: true,
    },
    pays_id: { type: Schema.Types.ObjectId, ref: 'Pays', index: true },
    entite_id: { type: Schema.Types.ObjectId },
    message: { type: String },
    statut: { type: String, enum: ['nouvelle', 'vue', 'traitee'], default: 'nouvelle' },
  },
  { timestamps: true }
);

AlerteSchema.plugin(paysScopePlugin);

module.exports = mongoose.model('Alerte', AlerteSchema);
