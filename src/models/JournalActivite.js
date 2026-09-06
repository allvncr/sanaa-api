const mongoose = require('mongoose');
const { Schema } = mongoose;

const JournalActiviteSchema = new Schema(
  {
    utilisateur_id: { type: Schema.Types.ObjectId, ref: 'Utilisateur', index: true },
    action: { type: String, enum: ['creation', 'modification', 'suppression', 'changement_statut'], required: true },
    entite: { type: String, required: true },
    entite_id: { type: Schema.Types.ObjectId, required: true },
    avant: { type: Schema.Types.Mixed },
    apres: { type: Schema.Types.Mixed },
    pays_id: { type: Schema.Types.ObjectId, ref: 'Pays', index: true },
    date: { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: false }
);

JournalActiviteSchema.index({ pays_id: 1, date: -1 });
// Politique de rétention optionnelle (TTL) — désactivée par défaut ; à activer en
// production si le volume le justifie (section 3.8), ex. purge après 24 mois :
// JournalActiviteSchema.index({ date: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 730 });

module.exports = mongoose.model('JournalActivite', JournalActiviteSchema);
