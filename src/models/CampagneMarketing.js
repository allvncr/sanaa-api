const mongoose = require('mongoose');
const { Schema } = mongoose;
const paysScopePlugin = require('../plugins/paysScopePlugin');

const CampagneMarketingSchema = new Schema(
  {
    pays_id: { type: Schema.Types.ObjectId, ref: 'Pays', required: true, index: true },
    plateforme: { type: String },
    campagne: { type: String, required: true },
    ad_set: { type: String },
    publicite: { type: String },
    budget: { type: Schema.Types.Decimal128, default: 0 },
    actif: { type: Boolean, default: true },
  },
  { timestamps: true }
);

CampagneMarketingSchema.plugin(paysScopePlugin);

module.exports = mongoose.model('CampagneMarketing', CampagneMarketingSchema);
