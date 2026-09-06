const mongoose = require('mongoose');
const { Schema } = mongoose;
const paysScopePlugin = require('../plugins/paysScopePlugin');

const LigneCommandeFournisseurSchema = new Schema(
  {
    produit_id: { type: Schema.Types.ObjectId, ref: 'Produit' },
    variante_id: { type: Schema.Types.ObjectId },
    quantite: { type: Number, required: true, min: 1 },
    cout_unitaire: { type: Schema.Types.Decimal128, required: true },
  },
  { _id: true }
);

const CommandeFournisseurSchema = new Schema(
  {
    fournisseur_id: { type: Schema.Types.ObjectId, ref: 'Fournisseur', required: true },
    pays_destination_id: { type: Schema.Types.ObjectId, ref: 'Pays', required: true, index: true },
    date_commande: { type: Date, default: Date.now },
    date_prevue: { type: Date },
    date_reelle: { type: Date },
    cout_transport: { type: Schema.Types.Decimal128, default: 0 },
    cout_total: { type: Schema.Types.Decimal128, default: 0 },
    statut: { type: String, enum: ['Commande', 'En_transit', 'Recu', 'Annule'], default: 'Commande' },
    lignes: { type: [LigneCommandeFournisseurSchema], default: [] },
  },
  { timestamps: true }
);

CommandeFournisseurSchema.plugin(paysScopePlugin, { field: 'pays_destination_id' });

module.exports = mongoose.model('CommandeFournisseur', CommandeFournisseurSchema);
