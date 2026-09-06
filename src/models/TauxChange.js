const mongoose = require('mongoose');
const { Schema } = mongoose;

// Historique append-only (section 3.1, 3.9, 10) : aucune route de modification ou
// de suppression n'est exposée côté API — voir routes/tauxChange.routes.js.
const TauxChangeSchema = new Schema(
  {
    devise_source_id: { type: Schema.Types.ObjectId, ref: 'Devise', required: true },
    devise_cible_id: { type: Schema.Types.ObjectId, ref: 'Devise', required: true },
    taux: { type: Schema.Types.Decimal128, required: true },
    date_effet: { type: Date, required: true, index: true },
    saisi_par: { type: Schema.Types.ObjectId, ref: 'Utilisateur' },
  },
  { timestamps: true }
);

TauxChangeSchema.index({ devise_source_id: 1, devise_cible_id: 1, date_effet: -1 });

module.exports = mongoose.model('TauxChange', TauxChangeSchema);
