const mongoose = require('mongoose');
const { Schema } = mongoose;
const paysScopePlugin = require('../plugins/paysScopePlugin');
const activityLogPlugin = require('../plugins/activityLogPlugin');

// Bijou « en stock » (retour du 23/10/2026) : modèle unique, non personnalisé,
// acheté en quantité et livré le jour même après appel de confirmation. Ces
// articles sont volontairement SÉPARÉS du catalogue et des commandes : ils ne
// se choisissent pas dans une commande, la vente (venue de Shopify) se note
// seulement comme une sortie de stock. Le niveau de stock se calcule à partir du
// journal des mouvements (MouvementArticle), jamais stocké ici.
const ArticleStockSchema = new Schema(
  {
    pays_id: { type: Schema.Types.ObjectId, ref: 'Pays', required: true, index: true },
    nom: { type: String, required: true, trim: true },
    reference: { type: String, trim: true },
    // Couleur / matière / taille : texte libre, pour distinguer deux articles du même modèle.
    couleur: { type: String, trim: true },
    // En dessous (ou égal) : « stock bas ». 0 = pas d'alerte avant la rupture.
    seuil_alerte: { type: Number, min: 0, default: 0 },
    notes: { type: String, trim: true },
    actif: { type: Boolean, default: true },
    cree_par: { type: Schema.Types.ObjectId, ref: 'Utilisateur' },
  },
  { timestamps: true }
);

ArticleStockSchema.index({ pays_id: 1, nom: 1 });
ArticleStockSchema.plugin(paysScopePlugin);
ArticleStockSchema.plugin(activityLogPlugin, { entite: 'ArticleStock' });

module.exports = mongoose.model('ArticleStock', ArticleStockSchema);
