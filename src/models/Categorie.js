const mongoose = require('mongoose');
const { Schema } = mongoose;

// "collections" au sens commercial du cahier de cadrage (Colliers, Bracelets…) —
// à ne pas confondre avec le terme technique de collection MongoDB (section 3.3).
const CategorieSchema = new Schema(
  {
    nom: { type: String, required: true, unique: true, trim: true },
  },
  { timestamps: true, collection: 'collections' }
);

module.exports = mongoose.model('Categorie', CategorieSchema);
