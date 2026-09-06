const mongoose = require('mongoose');
const { Schema } = mongoose;
const paysScopePlugin = require('../plugins/paysScopePlugin');
const activityLogPlugin = require('../plugins/activityLogPlugin');

const ClientSchema = new Schema(
  {
    pays_id: { type: Schema.Types.ObjectId, ref: 'Pays', required: true, index: true },
    // Optionnel (retour V0.1) : SANAA ne conserve pas systématiquement les noms
    // et prénoms des clients — le numéro de téléphone est la clé d'identification
    // réelle (voir index ci-dessous et commande.service.js `trouverOuCreerClient`).
    nom: { type: String, trim: true },
    telephone_whatsapp: { type: String, index: true },
    ville: { type: String },
    adresse: { type: String },
    notes: { type: String },
  },
  { timestamps: true }
);

// Dédoublonnage par téléphone au sein d'un même pays (retour V0.1) : deux
// commandes du même numéro dans le même pays doivent se rattacher au même
// client plutôt que d'en créer un nouveau à chaque saisie rapide.
ClientSchema.index({ pays_id: 1, telephone_whatsapp: 1 });

ClientSchema.plugin(paysScopePlugin);
ClientSchema.plugin(activityLogPlugin, { entite: 'Client' });

module.exports = mongoose.model('Client', ClientSchema);
