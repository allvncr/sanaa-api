const mongoose = require('mongoose');
const { Schema } = mongoose;
const { ALL_PERMISSIONS } = require('../utils/permissions');

const RoleSchema = new Schema(
  {
    nom: { type: String, required: true, unique: true, trim: true },
    portee: { type: String, enum: ['global', 'pays'], required: true, default: 'pays' },
    permissions: {
      type: [String],
      default: [],
      validate: {
        validator: (arr) => arr.every((p) => ALL_PERMISSIONS.includes(p)),
        message: 'Permission inconnue dans le tableau permissions',
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Role', RoleSchema);
