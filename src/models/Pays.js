const mongoose = require('mongoose');

const { Schema } = mongoose;

const MoyenPaiementSchema = new Schema(
  { nom: { type: String, required: true }, actif: { type: Boolean, default: true } },
  { _id: true }
);

const PaysSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    nom: { type: String, required: true, trim: true },
    devise_locale_id: { type: Schema.Types.ObjectId, ref: 'Devise', required: true },
    parametres: { type: Schema.Types.Mixed, default: {} },
    moyens_paiement: { type: [MoyenPaiementSchema], default: [] },
    est_pays_historique_sans_suffixe: { type: Boolean, default: false },
    ca_statuts_inclus: {
      type: [String],
      enum: ['Nouvelle', 'Confirmee', 'Annulee', 'Refusee'],
      default: ['Confirmee'],
    },
    actif: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Pays', PaysSchema);
