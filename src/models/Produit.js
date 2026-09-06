const mongoose = require('mongoose');
const { Schema } = mongoose;
const activityLogPlugin = require('../plugins/activityLogPlugin');

// Surcharge commerciale par pays — matérialise l'héritage puis la personnalisation
// (section 5 du cahier de cadrage, section 3.3 de l'architecture).
const PrixPaysSchema = new Schema(
  {
    pays_id: { type: Schema.Types.ObjectId, ref: 'Pays', required: true },
    prix: { type: Schema.Types.Decimal128, required: true },
    devise_id: { type: Schema.Types.ObjectId, ref: 'Devise' },
    actif: { type: Boolean, default: true },
    date_debut_validite: { type: Date, default: Date.now },
  },
  { _id: true, timestamps: true }
);

// Déclinaison vendable d'un produit (couleur, matière…) portant son propre tableau
// de prix par pays (section 3.0, 3.3).
const VarianteSchema = new Schema(
  {
    couleur: { type: String },
    // Nom chinois de la couleur/matière (retour V0.1) — utilisé tel quel dans
    // la colonne 宝石材质 des exports usine et interne (voir export.service.js).
    couleur_zh: { type: String, trim: true },
    attributs: { type: Schema.Types.Mixed, default: {} },
    actif: { type: Boolean, default: true },
    prix_pays: { type: [PrixPaysSchema], default: [] },
  },
  { _id: true, timestamps: true }
);

const ProduitSchema = new Schema(
  {
    categorie_id: { type: Schema.Types.ObjectId, ref: 'Categorie' },
    nom: { type: String, required: true, trim: true },
    // Nom chinois du modèle (retour V0.1) — utilisé comme "nom de modèle" (模型)
    // dans les exports usine, l'usine ne travaillant qu'en chinois. Saisi à la
    // création du produit, à côté du nom français.
    nom_zh: { type: String, trim: true },
    reference_sku: { type: String, unique: true, sparse: true, trim: true },
    nb_prenoms_max: { type: Number, min: 0, default: 1 },
    options_personnalisation: { type: Schema.Types.Mixed, default: {} },
    photos: { type: [String], default: [] },
    cout_revient_estime: { type: Schema.Types.Decimal128 },
    statut: { type: String, enum: ['actif', 'inactif'], default: 'actif' },
    variantes: { type: [VarianteSchema], default: [] },
  },
  { timestamps: true }
);

ProduitSchema.index({ nom: 'text' });
ProduitSchema.plugin(activityLogPlugin, { entite: 'Produit' });

module.exports = mongoose.model('Produit', ProduitSchema);
module.exports.VarianteSchema = VarianteSchema;
module.exports.PrixPaysSchema = PrixPaysSchema;
