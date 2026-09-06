const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { Schema } = mongoose;
const activityLogPlugin = require('../plugins/activityLogPlugin');

const UtilisateurSchema = new Schema(
  {
    nom: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    mot_de_passe_hash: { type: String, required: true, select: false },
    role_id: { type: Schema.Types.ObjectId, ref: 'Role', required: true },
    pays_autorises: { type: [Schema.Types.ObjectId], ref: 'Pays', default: [] },
    actif: { type: Boolean, default: true },
    derniere_connexion: { type: Date },
    refresh_token_hash: { type: String, select: false },
    tentatives_echouees: { type: Number, default: 0, select: false },
    verrouille_jusqu_a: { type: Date, select: false },
  },
  { timestamps: true }
);

UtilisateurSchema.methods.verifierMotDePasse = function verifierMotDePasse(motDePasse) {
  return bcrypt.compare(motDePasse, this.mot_de_passe_hash);
};

UtilisateurSchema.statics.hasherMotDePasse = function hasherMotDePasse(motDePasse) {
  return bcrypt.hash(motDePasse, 12);
};

UtilisateurSchema.plugin(activityLogPlugin, {
  entite: 'Utilisateur',
  exclure: ['mot_de_passe_hash', 'refresh_token_hash', 'tentatives_echouees', 'verrouille_jusqu_a'],
});

module.exports = mongoose.model('Utilisateur', UtilisateurSchema);
