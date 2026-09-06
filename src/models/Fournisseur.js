const mongoose = require('mongoose');
const { Schema } = mongoose;

const FournisseurSchema = new Schema(
  {
    nom: { type: String, required: true, trim: true },
    contact: { type: String },
    notes: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Fournisseur', FournisseurSchema);
