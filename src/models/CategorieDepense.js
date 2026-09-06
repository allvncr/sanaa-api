const mongoose = require('mongoose');
const { Schema } = mongoose;

const CategorieDepenseSchema = new Schema(
  {
    nom: { type: String, required: true, unique: true, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CategorieDepense', CategorieDepenseSchema);
