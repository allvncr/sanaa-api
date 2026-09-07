const mongoose = require('mongoose');
const { Schema } = mongoose;
const paysScopePlugin = require('../plugins/paysScopePlugin');

// Un export déjà généré n'est jamais modifié ; seule une nouvelle version peut être
// créée (section 3.8, 3.9, 7.3, 11.4).
const ExportSchema = new Schema(
  {
    // Retour V0.1 : l'export usine est désormais généré par pays comme
    // l'export interne (l'usine reçoit un bordereau par pays), pays_id est
    // donc toujours renseigné.
    pays_id: { type: Schema.Types.ObjectId, ref: 'Pays', required: true, index: true },
    date_export: { type: Date, required: true, index: true },
    type: { type: String, enum: ['interne', 'usine'], required: true },
    version: { type: Number, default: 1 },
    nom_fichier: { type: String, required: true },
    chemin_fichier: { type: String, required: true },
    genere_par: { type: Schema.Types.ObjectId, ref: 'Utilisateur' },
  },
  { timestamps: true }
);

ExportSchema.index({ pays_id: 1, date_export: 1, type: 1, version: 1 });
ExportSchema.plugin(paysScopePlugin);

module.exports = mongoose.model('Export', ExportSchema);
