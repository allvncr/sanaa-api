const mongoose = require('mongoose');
const { Schema } = mongoose;
const paysScopePlugin = require('../plugins/paysScopePlugin');
const activityLogPlugin = require('../plugins/activityLogPlugin');

// Une ligne = un produit personnalisé commandé, prix figé à la création
// (sections 5 et 24 du cahier de cadrage, section 3.5 et 3.9 de l'architecture).
// prix_unitaire_applique et devise_id sont `immutable` : Mongoose rejette toute
// tentative de modification après la création initiale du sous-document.
const LigneCommandeSchema = new Schema(
  {
    produit_id: { type: Schema.Types.ObjectId, ref: 'Produit', required: true },
    variante_id: { type: Schema.Types.ObjectId, required: true },
    couleur_choisie: { type: String },
    personnalisation: {
      type: [{ texte: String, police: String, position: Number }],
      default: [],
    },
    quantite: { type: Number, required: true, min: 1 },
    prix_unitaire_applique: { type: Schema.Types.Decimal128, required: true, immutable: true },
    devise_id: { type: Schema.Types.ObjectId, ref: 'Devise', immutable: true },
    sous_total: { type: Schema.Types.Decimal128, required: true },
  },
  { _id: true, timestamps: true }
);

// Chaque avance/solde est un paiement historisé et daté (section 7 du cadrage).
// montant et date_paiement sont immutables : une correction s'exprime par un
// nouveau paiement (éventuellement négatif), jamais par une édition rétroactive
// (section 3.5, 3.9, 6.2).
const PaiementSchema = new Schema(
  {
    moyen_paiement: { type: String, required: true },
    type: { type: String, enum: ['avance', 'solde'], required: true },
    montant: { type: Schema.Types.Decimal128, required: true, immutable: true },
    date_paiement: { type: Date, required: true, immutable: true, default: Date.now },
    reference: { type: String },
    saisi_par: { type: Schema.Types.ObjectId, ref: 'Utilisateur' },
    annule: { type: Boolean, default: false },
  },
  { _id: true, timestamps: true }
);

const CommandeSchema = new Schema(
  {
    numero: { type: String, required: true, unique: true, index: true },
    pays_id: { type: Schema.Types.ObjectId, ref: 'Pays', required: true, index: true },
    client_id: { type: Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    // Simplifié à la demande de SANAA (retour V0.1) : uniquement les deux canaux
    // réellement utilisés, WhatsApp par défaut.
    canal_vente: { type: String, enum: ['WhatsApp', 'Site web'], default: 'WhatsApp' },
    campagne_id: { type: Schema.Types.ObjectId, ref: 'CampagneMarketing' },

    // Point 1, section 1. Retour V0.1 : la saisie rapide crée directement une
    // commande confirmée (le flux réel de SANAA saisit des ventes déjà actées,
    // pas des brouillons) — Nouvelle/Refusee restent possibles pour un usage
    // manuel ultérieur mais ne sont plus la valeur par défaut.
    statut_commande: {
      type: String,
      enum: ['Nouvelle', 'Confirmee', 'Annulee', 'Refusee'],
      default: 'Confirmee',
      index: true,
    },
    // Idem : la fabrication démarre directement (retour V0.1). "Erreur" couvre
    // un défaut constaté à la réception en usine/pays.
    statut_fabrication: {
      type: String,
      enum: ['A_produire', 'En_fabrication', 'Terminee', 'Erreur'],
      default: 'En_fabrication',
    },
    statut_livraison: {
      type: String,
      enum: ['A_expedier', 'Recue_en_pays', 'En_livraison', 'Livree', 'Retour_echec'],
      default: 'A_expedier',
    },

    total: { type: Schema.Types.Decimal128, required: true, default: 0 },
    // Réduction optionnelle sur le total de la commande (retour V0.1) — dans la
    // devise de la commande, déduite du total pour le calcul du reste à payer.
    reduction: { type: Schema.Types.Decimal128, default: 0 },
    devise_id: { type: Schema.Types.ObjectId, ref: 'Devise' },
    commentaires: { type: String },
    cree_par: { type: Schema.Types.ObjectId, ref: 'Utilisateur' },

    // Horodatage des jalons clés (retour V0.1 : SANAA veut savoir "quand" pour
    // chaque étape, pas seulement l'état courant). Renseignés automatiquement
    // par commande.service.js à chaque transition concernée.
    date_fabrication_terminee: { type: Date },
    date_fabrication_erreur: { type: Date },
    date_debut_livraison: { type: Date },
    date_livraison: { type: Date },
    date_retour_echec: { type: Date },

    lignes: { type: [LigneCommandeSchema], default: [] },
    paiements: { type: [PaiementSchema], default: [] },
  },
  { timestamps: true }
);

CommandeSchema.index({ pays_id: 1, createdAt: -1 });
CommandeSchema.index({ pays_id: 1, statut_commande: 1 });

CommandeSchema.plugin(paysScopePlugin);
CommandeSchema.plugin(activityLogPlugin, { entite: 'Commande' });

module.exports = mongoose.model('Commande', CommandeSchema);
module.exports.LigneCommandeSchema = LigneCommandeSchema;
module.exports.PaiementSchema = PaiementSchema;
