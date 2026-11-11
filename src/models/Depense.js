const mongoose = require('mongoose');
const { Schema } = mongoose;
const paysScopePlugin = require('../plugins/paysScopePlugin');
const activityLogPlugin = require('../plugins/activityLogPlugin');

const DepenseSchema = new Schema(
  {
    pays_id: { type: Schema.Types.ObjectId, ref: 'Pays', required: true, index: true },
    categorie_id: { type: Schema.Types.ObjectId, ref: 'CategorieDepense', required: true },
    date: { type: Date, required: true, default: Date.now, index: true },
    montant: { type: Schema.Types.Decimal128, required: true },
    devise_id: { type: Schema.Types.ObjectId, ref: 'Devise' },
    fournisseur_id: { type: Schema.Types.ObjectId, ref: 'Fournisseur' },
    piece_justificative_url: { type: String },
    commentaire: { type: String },
    statut: { type: String, enum: ['en_attente', 'validee'], default: 'en_attente' },
    valide_par: { type: Schema.Types.ObjectId, ref: 'Utilisateur' },
  },
  { timestamps: true }
);

// Liste des dépenses et totaux du tableau de bord : filtre par pays et par période.
DepenseSchema.index({ pays_id: 1, date: -1 });

DepenseSchema.plugin(paysScopePlugin);
DepenseSchema.plugin(activityLogPlugin, { entite: 'Depense' });

module.exports = mongoose.model('Depense', DepenseSchema);
