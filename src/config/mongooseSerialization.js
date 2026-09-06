const mongoose = require('mongoose');

/**
 * Les montants financiers sont stockés en Decimal128 (section 2.3, 3.9) pour la
 * précision des calculs côté serveur, mais Decimal128 sérialise par défaut en
 * JSON comme { $numberDecimal: "..." } — inutilisable tel quel côté frontend
 * (affichage, filtres de montant). Ce plugin global convertit systématiquement
 * tout champ Decimal128 en chaîne de caractères dans les réponses JSON de l'API,
 * y compris dans les sous-documents imbriqués (lignes, paiements, variantes,
 * prix_pays…) puisque `mongoose.plugin()` s'applique à tout schéma — y compris
 * les schémas de sous-documents — créé après ce require.
 *
 * Doit être chargé avant tout `require('../models/...')` pour s'appliquer à
 * l'ensemble des schémas (d'où le require en toute première ligne de app.js).
 */
// Parcourt récursivement (objets et tableaux) pour couvrir aussi les champs
// Mixed à structure libre (ex. journal_activite.avant/apres) qui peuvent
// contenir des Decimal128 imbriqués sans schéma propre.
function convertirRecursif(valeur, profondeur = 0) {
  if (profondeur > 8 || valeur === null || valeur === undefined) return valeur;
  if (valeur instanceof mongoose.Types.Decimal128) return valeur.toString();
  if (Array.isArray(valeur)) return valeur.map((v) => convertirRecursif(v, profondeur + 1));
  if (valeur instanceof Date || valeur instanceof mongoose.Types.ObjectId) return valeur;
  if (typeof valeur === 'object') {
    for (const cle of Object.keys(valeur)) {
      valeur[cle] = convertirRecursif(valeur[cle], profondeur + 1);
    }
    return valeur;
  }
  return valeur;
}

function convertirDecimal128(doc, ret) {
  return convertirRecursif(ret);
}

// Appliqué à `toJSON()` (utilisé implicitement par res.json()/JSON.stringify sur
// un Document) ET à `toObject()` (utilisé explicitement par certains services
// avant transformation métier, ex. commande.service.js) pour qu'aucun des deux
// chemins ne laisse fuiter un Decimal128 brut vers l'API.
mongoose.plugin((schema) => {
  schema.set('toJSON', { transform: convertirDecimal128 });
  schema.set('toObject', { transform: convertirDecimal128 });
});

module.exports = mongoose;
