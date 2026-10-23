const mongoose = require('mongoose');
const { Schema } = mongoose;
const paysScopePlugin = require('../plugins/paysScopePlugin');
const activityLogPlugin = require('../plugins/activityLogPlugin');

// Journal des mouvements d'un bijou en stock. La quantité est signée (+ entrée
// en stock, − sortie) ; une erreur de saisie s'annule (annule = true) au lieu
// d'être supprimée, pour garder la trace. Le stock = somme des mouvements non
// annulés.
const MouvementArticleSchema = new Schema(
  {
    article_id: { type: Schema.Types.ObjectId, ref: 'ArticleStock', required: true, index: true },
    pays_id: { type: Schema.Types.ObjectId, ref: 'Pays', required: true, index: true },
    type: {
      type: String,
      // creation = stock de départ d'un nouveau produit ; entree = achat /
      // réapprovisionnement ; sortie = vente ; retour = bijou revenu (non livré,
      // refusé…) ; ajustement = écart constaté à l'inventaire.
      enum: ['creation', 'entree', 'sortie', 'retour', 'ajustement'],
      required: true,
    },
    quantite: { type: Number, required: true },
    // Note libre : n° de commande Shopify, fournisseur, motif du retour…
    commentaire: { type: String, trim: true },
    date: { type: Date, required: true, default: Date.now, index: true },
    saisi_par: { type: Schema.Types.ObjectId, ref: 'Utilisateur' },
    annule: { type: Boolean, default: false },
    annule_par: { type: Schema.Types.ObjectId, ref: 'Utilisateur' },
    annule_le: { type: Date },
  },
  { timestamps: true }
);

MouvementArticleSchema.index({ article_id: 1, date: -1 });
MouvementArticleSchema.plugin(paysScopePlugin);
MouvementArticleSchema.plugin(activityLogPlugin, { entite: 'MouvementArticle' });

module.exports = mongoose.model('MouvementArticle', MouvementArticleSchema);
