const mongoose = require('mongoose');
const { Schema } = mongoose;

// Séries journalières, en collection séparée pour ne pas faire grossir indéfiniment
// le document de campagne (section 3.0, 3.7) — candidate à une collection time
// series MongoDB 5.0+ si le volume le justifie.
const MesureMarketingSchema = new Schema(
  {
    campagne_id: { type: Schema.Types.ObjectId, ref: 'CampagneMarketing', required: true, index: true },
    date: { type: Date, required: true, index: true },
    depense: { type: Schema.Types.Decimal128, default: 0 },
    impressions: { type: Number, default: 0 },
    clics: { type: Number, default: 0 },
    messages: { type: Number, default: 0 },
  },
  { timestamps: true }
);

MesureMarketingSchema.index({ campagne_id: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('MesureMarketing', MesureMarketingSchema);
