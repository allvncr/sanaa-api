const mongoose = require('mongoose');
const { Schema } = mongoose;

const DeviseSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    nom: { type: String, required: true },
    symbole: { type: String },
    decimales: { type: Number, default: 0, min: 0, max: 6 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Devise', DeviseSchema);
